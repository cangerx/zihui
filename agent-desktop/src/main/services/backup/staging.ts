import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import * as nodeFs from 'fs'
import { join } from 'path'
import { getDataDir } from '../data-path'

/**
 * 备份系统的目录布局工具 + 原子化 rename 辅助。
 *
 * 目录结构（位于 dataDir 下）：
 *   backups/                          ← 用户可见的备份文件 + records.json
 *   backups/.staging/                 ← 正在写入的 .partial 备份
 *   backups/.restore-staging-<ts>/    ← 恢复时的解压暂存
 *   backups/.restore-previous-<ts>/   ← 恢复时把当前数据 rename 进来作保险
 *
 * 全部位于 dataDir 同一卷，rename 才能保持原子性。
 */

const BACKUP_DIR = 'backups'
const STAGING_DIR = '.staging'
const RESTORE_STAGING_PREFIX = '.restore-staging-'
const RESTORE_PREVIOUS_PREFIX = '.restore-previous-'
/** 这些根级条目在恢复时不被纳入 .restore-previous，恢复后保持原样。 */
const RESTORE_PRESERVE_ROOTS = new Set([
  BACKUP_DIR,
  'data-path.json',
  // 账号隔离相关的 root 级条目：legacy 原地账号（getDataDir=root）恢复时不得归档/替换它们，
  // 否则会误伤其他账号目录（accounts/）与设备级文件。新账号目录内本就无这些条目，天然安全。
  'accounts',
  'account-map.json',
  'device-settings.json',
  'device-id.txt'
])
/** 恢复时保险目录的过期天数：超过则后台清理。 */
const PREVIOUS_TTL_DAYS = 7

export function getBackupDir(): string {
  const dir = join(getDataDir(), BACKUP_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getStagingDir(): string {
  const dir = join(getBackupDir(), STAGING_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function newRestoreStagingDir(ts: string): string {
  const dir = join(getBackupDir(), `${RESTORE_STAGING_PREFIX}${ts}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function newRestorePreviousDir(ts: string): string {
  const dir = join(getBackupDir(), `${RESTORE_PREVIOUS_PREFIX}${ts}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 列出 dataDir 下"恢复时需要被保险归档/替换"的根级条目。
 * 排除 backups/ 自身（备份文件不能被自己的恢复操作搬走）和 data-path.json。
 */
export function listRootEntriesForRestore(): string[] {
  const dataDir = getDataDir()
  if (!existsSync(dataDir)) return []
  return readdirSync(dataDir).filter((name) => !RESTORE_PRESERVE_ROOTS.has(name))
}

/**
 * 把 src（可以是文件或目录）原子 rename 到 dest。
 * Windows 下若 dest 存在会失败，先 force 删 dest。
 */
export function moveAtomic(src: string, dest: string): void {
  if (!existsSync(src)) return
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true })
  }
  renameSync(src, dest)
}

/** 安全删除。失败时记录但不抛，避免清理代码本身把恢复流程搞炸。 */
export function safeRemove(path: string): void {
  if (!existsSync(path)) return
  try {
    const st = statSync(path)
    if (st.isDirectory()) rmSync(path, { recursive: true, force: true })
    else unlinkSync(path)
  } catch (e) {
    console.error('[backup] safeRemove failed:', path, e)
  }
}

/**
 * 删除 SQLite 的 WAL/SHM 兄弟文件。
 *
 * 关键：覆盖 .db 之前必须删 .db-wal / .db-shm，否则下次打开 db 时
 * SQLite 会把"旧 WAL 中尚未 checkpoint 的页"应用到刚恢复的 db 上，
 * 导致恢复结果被静默篡改 → 数据损坏。
 */
export function removeSqliteSidecars(dbPath: string): void {
  for (const ext of ['-wal', '-shm']) {
    safeRemove(dbPath + ext)
  }
}

/**
 * 清理过期的 .restore-previous-* 保险目录。
 * 仅在主进程启动后异步调用一次，给用户留 PREVIOUS_TTL_DAYS 天反悔窗口。
 */
export function cleanupExpiredPreviousDirs(): void {
  const backupDir = getBackupDir()
  if (!existsSync(backupDir)) return
  const now = Date.now()
  const ttlMs = PREVIOUS_TTL_DAYS * 24 * 60 * 60 * 1000
  for (const name of readdirSync(backupDir)) {
    if (!name.startsWith(RESTORE_PREVIOUS_PREFIX)) continue
    const full = join(backupDir, name)
    try {
      const st = statSync(full)
      if (now - st.mtimeMs > ttlMs) {
        rmSync(full, { recursive: true, force: true })
      }
    } catch {}
  }
}

/**
 * 启动时清理 .staging/ 下的 .partial 残骸（上次备份被中断或崩溃留下的）。
 */
export function cleanupOrphanedPartials(): void {
  const staging = getStagingDir()
  if (!existsSync(staging)) return
  for (const name of readdirSync(staging)) {
    safeRemove(join(staging, name))
  }
}

// === 恢复中断自愈 ===
//
// 恢复的"替换 dataDir"阶段是多次 rename，理论上很快，但断电/强杀仍可能在
// "当前数据已搬入 previous、新数据尚未全部搬入 dataDir"时中断，留下不完整的 dataDir。
// 为此在替换前写一个标记文件，记录 previous / staging / 受影响条目；
// 下次启动（打开数据库之前）若发现标记，则把 previous 里归档的"恢复前数据"搬回，
// 回滚到恢复前的一致状态（数据安全优先：宁可这次恢复不生效，也不留半成品）。

const RESTORE_MARKER = '.restore-in-progress.json'

export interface RestoreMarker {
  ts: string
  previousDir: string
  stagingDir: string
  entries: string[]
}

export function getRestoreMarkerPath(): string {
  return join(getBackupDir(), RESTORE_MARKER)
}

export function writeRestoreMarker(m: RestoreMarker): void {
  try {
    writeFileSync(getRestoreMarkerPath(), JSON.stringify(m, null, 2), 'utf-8')
  } catch (e) {
    console.error('[backup] write restore marker failed:', e)
  }
}

export function clearRestoreMarker(): void {
  safeRemove(getRestoreMarkerPath())
}

/**
 * 启动自愈：若存在"恢复中断"标记，回滚到恢复前数据。
 * 必须在打开数据库之前【同步】调用，避免新/半成品 db 被打开后产生文件锁，导致回滚失败。
 */
export function recoverInterruptedRestore(): void {
  const markerPath = getRestoreMarkerPath()
  if (!existsSync(markerPath)) return

  let marker: RestoreMarker | null = null
  try {
    marker = JSON.parse(readFileSync(markerPath, 'utf-8')) as RestoreMarker
  } catch {
    // 标记损坏：删掉，避免每次启动卡在这里
    safeRemove(markerPath)
    return
  }
  if (!marker || !marker.previousDir) {
    safeRemove(markerPath)
    return
  }

  console.warn('[backup] 检测到上次恢复被中断，回滚到恢复前数据：', marker.ts)
  const dataDir = getDataDir()
  try {
    if (existsSync(marker.previousDir)) {
      // 把 previous 里归档的"恢复前数据"搬回 dataDir（覆盖可能存在的半成品）
      for (const name of readdirSync(marker.previousDir)) {
        try {
          moveAtomic(join(marker.previousDir, name), join(dataDir, name))
        } catch (e) {
          console.error('[backup] 自愈回滚移动失败：', name, e)
        }
      }
    }
  } finally {
    // 清理半成品 staging + previous + 标记 + 可能残留的新 db sidecar
    if (marker.stagingDir) safeRemove(marker.stagingDir)
    safeRemove(marker.previousDir)
    safeRemove(markerPath)
    removeSqliteSidecars(join(dataDir, 'local-agent.db'))
  }
}

// === 磁盘空间预检 ===

/**
 * 返回 dirPath 所在卷的可用字节数；无法检测（旧 Node / 不支持 statfs）时返回 null。
 * 用 statfsSync（Node 18.15+）；不可用则优雅降级为"不检测"。
 */
export function getFreeSpace(dirPath: string): number | null {
  try {
    const statfs = (nodeFs as any).statfsSync as
      | ((p: string) => { bavail: number | bigint; bsize: number | bigint })
      | undefined
    if (typeof statfs !== 'function') return null
    const st = statfs(dirPath)
    return Number(st.bavail) * Number(st.bsize)
  } catch {
    return null
  }
}

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + ' GB'
  if (n >= 1024 ** 2) return Math.round(n / 1024 ** 2) + ' MB'
  return Math.round(n / 1024) + ' KB'
}

/**
 * 预检：dirPath 所在卷至少要有 needBytes + 余量（max(100MB, needBytes*5%)）的可用空间。
 * 无法检测时不阻塞（直接返回）。空间不足抛出可读中文错误，由上层提前终止，避免中途 ENOSPC。
 */
export function ensureFreeSpace(dirPath: string, needBytes: number): void {
  if (!needBytes || needBytes <= 0) return
  const free = getFreeSpace(dirPath)
  if (free === null) return
  const margin = Math.max(100 * 1024 * 1024, Math.ceil(needBytes * 0.05))
  if (free < needBytes + margin) {
    throw new Error(
      `磁盘空间不足：约需 ${formatBytes(needBytes + margin)}，当前可用 ${formatBytes(free)}。请清理磁盘后重试。`
    )
  }
}

/** 文件名安全的时间戳，精确到毫秒，避免同秒内冲突。 */
export function timestamp(): string {
  const d = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` +
    `-${pad(d.getMilliseconds(), 3)}`
  )
}
