import { existsSync, copyFileSync, statSync, readdirSync } from 'fs'
import { join, basename } from 'path'
import { getDataDir } from '../data-path'
import { closeDatabase } from '../../database'
import {
  getBackupDir,
  newRestoreStagingDir,
  newRestorePreviousDir,
  listRootEntriesForRestore,
  moveAtomic,
  safeRemove,
  removeSqliteSidecars,
  cleanupExpiredPreviousDirs,
  cleanupOrphanedPartials,
  ensureFreeSpace,
  writeRestoreMarker,
  clearRestoreMarker,
  timestamp
} from './staging'
import { appendRecord, listValidRecords, removeRecord, readRecords } from './records'
import {
  cleanupOldBackups,
  getAutoBackupInterval,
  getMaxBackupCount,
  setAutoBackupInterval,
  setMaxBackupCount
} from './retention'
import {
  packV1,
  extractV1,
  readManifestV1,
  isV1Backup,
  verifyV1Zip
} from './format-v1'
import {
  isLegacyDbBackup,
  isLegacyFullBackup,
  restoreLegacyDb,
  restoreLegacyFull
} from './format-legacy'
import { checkCompat } from './compatibility'
import { shouldAutoBackup, markAutoBackupDone } from './scheduler'
import type {
  AbortToken,
  BackupInfo,
  BackupSettings,
  BackupType,
  ManifestV1,
  ProgressEvent,
  RestoreResult
} from './types'

// 聚合 API：UI / IPC 调本文件即可，内部逻辑由各子模块负责

// === Re-exports：保持外部 import 接口稳定 ===
export type { BackupInfo, BackupSettings, ProgressEvent, RestoreResult } from './types'
export {
  getAutoBackupInterval,
  setAutoBackupInterval,
  getMaxBackupCount,
  setMaxBackupCount
} from './retention'
export { shouldAutoBackup } from './scheduler'
// 崩溃自愈：主进程在打开数据库前同步调用，回滚被中断的恢复
export { recoverInterruptedRestore } from './staging'

// === 取消令牌 ===
//
// 全局只允许一个备份/恢复任务同时进行；UI 上"备份中"按钮 disabled 已经保证 UI 侧不重入，
// 主进程这里再加一道防御：currentToken 非空时新请求直接报错。
class CancelableToken implements AbortToken {
  private aborted = false
  abort(): void {
    this.aborted = true
  }
  isAborted(): boolean {
    return this.aborted
  }
  throwIfAborted(): void {
    if (this.aborted) throw new Error('操作已取消')
  }
}

let currentToken: CancelableToken | null = null

function acquireToken(): CancelableToken {
  if (currentToken) throw new Error('已有备份或恢复任务正在进行，请先取消或等待完成')
  const t = new CancelableToken()
  currentToken = t
  return t
}

function releaseToken(t: CancelableToken): void {
  if (currentToken === t) currentToken = null
}

/** IPC 'backup:cancel' 调用：撤销当前正在进行的任务。 */
export function cancelCurrent(): boolean {
  if (!currentToken) return false
  currentToken.abort()
  return true
}

// === 备份 ===

/**
 * 仅备份数据库（UI 上的"快速备份"和启动时自动备份共用此函数）。
 *
 * 注意：本函数 *不会* 更新 backup_last_auto 时间戳。
 * 自动调度场景由 caller 在成功后显式调用 markAutoBackupDone()。
 * 这是为了避免手动备份污染自动备份的节奏（旧实现的 bug）。
 */
export async function backupDatabase(
  onProgress?: (e: ProgressEvent) => void
): Promise<BackupInfo> {
  const token = acquireToken()
  try {
    const info = await packV1('auto', token, onProgress)
    appendRecord(info)
    cleanupOldBackups('auto')
    return info
  } finally {
    releaseToken(token)
  }
}

/** 完整备份：数据库 + 数据目录所有用户文件。 */
export async function backupFull(
  onProgress?: (e: ProgressEvent) => void
): Promise<BackupInfo> {
  const token = acquireToken()
  try {
    const info = await packV1('full', token, onProgress)
    appendRecord(info)
    cleanupOldBackups('full')
    return info
  } finally {
    releaseToken(token)
  }
}

// === 恢复 ===

/** 恢复前预检结果，UI 用它显示警告 / 拒绝。 */
export interface VerifyResult {
  ok: boolean
  manifest?: ManifestV1
  compat?: { level: 'ok' | 'warning' | 'blocked'; reason?: string }
  /** ok=false 时的简要原因（zip 损坏 / manifest 缺失等） */
  error?: string
  /** legacy 备份没有 manifest，UI 应给出"无法做完整性校验"提示。 */
  legacy?: boolean
}

/** 恢复前的预检：文件存在、能读 manifest、版本兼容。 */
export async function verifyBackup(fileName: string): Promise<VerifyResult> {
  const filePath = join(getBackupDir(), fileName)
  if (!existsSync(filePath)) return { ok: false, error: '备份文件不存在' }

  if (isLegacyDbBackup(fileName) || isLegacyFullBackup(fileName)) {
    return { ok: true, legacy: true }
  }
  if (!isV1Backup(fileName)) {
    return { ok: false, error: '未知的备份文件格式' }
  }
  try {
    await verifyV1Zip(filePath)
    const manifest = await readManifestV1(filePath)
    const compat = checkCompat(manifest)
    return {
      ok: compat.level !== 'blocked',
      manifest,
      compat,
      error: compat.level === 'blocked' ? compat.reason : undefined
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/**
 * 内部恢复执行函数：含完整的 staging / previous / 回滚机制。
 *
 * @param fileName backups/ 下的文件名
 * @param onProgress 进度回调
 * @param skipPreSnapshot 是否跳过"恢复前 db 快照"（外部恢复 + 用户已确认场景下可选）
 */
async function doRestoreV1(
  fileName: string,
  onProgress: ((e: ProgressEvent) => void) | undefined,
  skipPreSnapshot: boolean
): Promise<void> {
  const filePath = join(getBackupDir(), fileName)
  if (!existsSync(filePath)) throw new Error('备份文件不存在')

  // 1. 兼容性预检
  const verify = await verifyBackup(fileName)
  if (!verify.ok) throw new Error(verify.error || '备份文件不可用')

  // 1b. 磁盘空间预检：解压到 staging 需要 ~totalSize 空间（previous/swap 是 rename 不额外占用）
  if (verify.manifest) {
    ensureFreeSpace(getBackupDir(), verify.manifest.totalSize)
  }

  // 2. 恢复前先做一份 db 快照（type='auto'），给用户反悔窗口
  //    用 packV1 而非 backupDatabase 避免占用 token（doRestoreV1 已持有 token）
  if (!skipPreSnapshot) {
    try {
      const preToken = new CancelableToken()
      const preInfo = await packV1('auto', preToken, (e) =>
        onProgress?.({ ...e, phase: 'snapshot' })
      )
      // 标记为"恢复前自动快照"，方便 UI 区分（fileName 已含时间戳，type 仍为 auto）
      appendRecord(preInfo)
      cleanupOldBackups('auto')
    } catch (e) {
      console.warn('[backup] pre-restore snapshot failed:', e)
      // 预快照失败不阻塞恢复（用户的诉求是恢复，预快照只是保险）
    }
  }

  // 3. 解压到 staging（不直接写 dataDir，确保校验失败时不污染当前数据）
  const ts = timestamp()
  const stagingDir = newRestoreStagingDir(ts)
  let manifest: ManifestV1
  try {
    const fakeToken = currentToken || new CancelableToken()
    manifest = await extractV1(filePath, stagingDir, fakeToken, onProgress)
  } catch (e) {
    // staging 解压失败 → 清理 staging，dataDir 完全没动
    safeRemove(stagingDir)
    throw e
  }

  // 4. 解压成功，开始替换 dataDir
  //    步骤：closeDatabase → 当前 dataDir 内容 rename 到 .restore-previous-<ts>/ → staging 内容 rename 到 dataDir
  closeDatabase()
  // 删除 wal/shm 防止旧 WAL 污染恢复后的 db
  removeSqliteSidecars(join(getDataDir(), 'local-agent.db'))

  const previousDir = newRestorePreviousDir(ts)
  const dataDir = getDataDir()
  // P0：按备份类型缩小替换范围。
  //   - 数据库备份(auto)：只替换 local-agent.db，其余根目录（技能/图片/知识库文件等）原样保留，
  //     与 UI「技能文件和图片不受影响」一致；
  //   - 完整备份(full)：替换全部根级条目（精确镜像）。
  const dbOnly = manifest.type === 'auto'
  const rootEntries = dbOnly ? ['local-agent.db'] : listRootEntriesForRestore()

  // P1：写"恢复中断"标记（必须在移动前）。崩溃后下次启动据此回滚到恢复前数据。
  writeRestoreMarker({ ts, previousDir, stagingDir, entries: rootEntries })

  // 4a. 把当前 dataDir 中的根级条目搬到 previous（保险）
  const movedToPrev: string[] = []
  try {
    for (const name of rootEntries) {
      const src = join(dataDir, name)
      const dest = join(previousDir, name)
      moveAtomic(src, dest)
      movedToPrev.push(name)
      onProgress?.({
        phase: 'apply',
        current: movedToPrev.length,
        total: rootEntries.length,
        fileName: `归档当前数据：${name}`
      })
    }
  } catch (e) {
    // 搬运到 previous 中途失败 → 把已搬的搬回去
    console.error('[backup] failed to archive current data, rolling back:', e)
    for (const name of movedToPrev) {
      try {
        moveAtomic(join(previousDir, name), join(dataDir, name))
      } catch (rollbackErr) {
        console.error('[backup] rollback move failed:', name, rollbackErr)
      }
    }
    clearRestoreMarker()
    safeRemove(previousDir)
    safeRemove(stagingDir)
    throw e
  }

  // 4b. 把 staging 中的根级条目搬到 dataDir
  const stagingEntries = readdirSync(stagingDir)
  const movedToData: string[] = []
  try {
    for (let i = 0; i < stagingEntries.length; i++) {
      const name = stagingEntries[i]
      const src = join(stagingDir, name)
      const dest = join(dataDir, name)
      moveAtomic(src, dest)
      movedToData.push(name)
      onProgress?.({
        phase: 'apply',
        current: i + 1,
        total: stagingEntries.length,
        fileName: `应用新数据：${name}`
      })
    }
  } catch (e) {
    // staging → dataDir 中途失败 → 把已搬的撤回 + previous 还原
    console.error('[backup] failed to apply staging, full rollback:', e)
    for (const name of movedToData) {
      try {
        moveAtomic(join(dataDir, name), join(stagingDir, name))
      } catch {}
    }
    for (const name of movedToPrev) {
      try {
        moveAtomic(join(previousDir, name), join(dataDir, name))
      } catch {}
    }
    clearRestoreMarker()
    safeRemove(previousDir)
    safeRemove(stagingDir)
    throw e
  }

  // 5. 替换成功：清"恢复中断"标记 + 清 staging
  clearRestoreMarker()
  safeRemove(stagingDir)

  // previous 保留 7 天供用户反悔，由 cleanupExpiredPreviousDirs 异步清理
}

/** 从已有备份记录恢复（UI 列表上的"恢复"按钮）。 */
export async function restoreFromRecord(
  fileName: string,
  onProgress?: (e: ProgressEvent) => void
): Promise<RestoreResult> {
  const token = acquireToken()
  try {
    if (isLegacyDbBackup(fileName)) {
      // legacy db：先做新格式快照保险，再覆盖（无 staging 因为 legacy 没 sha256 校验，简化处理）
      try {
        const preToken = new CancelableToken()
        await packV1('auto', preToken, (e) => onProgress?.({ ...e, phase: 'snapshot' }))
      } catch (e) {
        console.warn('[backup] legacy pre-restore snapshot failed:', e)
      }
      await restoreLegacyDb(fileName)
      return { success: true, needsRelaunch: true }
    }
    if (isLegacyFullBackup(fileName)) {
      try {
        const preToken = new CancelableToken()
        await packV1('auto', preToken, (e) => onProgress?.({ ...e, phase: 'snapshot' }))
      } catch (e) {
        console.warn('[backup] legacy pre-restore snapshot failed:', e)
      }
      await restoreLegacyFull(fileName, onProgress)
      return { success: true, needsRelaunch: true }
    }
    if (!isV1Backup(fileName)) {
      return { success: false, error: '未知的备份文件格式' }
    }
    await doRestoreV1(fileName, onProgress, false)
    return { success: true, needsRelaunch: true }
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) }
  } finally {
    releaseToken(token)
  }
}

/**
 * 从外部路径导入并恢复：UI 提供"从文件恢复"入口。
 *
 * 流程：
 *   1. 把外部 .zip 拷贝到 backups/ 下（normalize 文件名）
 *   2. 校验 + 入库 records.json
 *   3. 触发 restoreFromRecord
 */
export async function restoreFromExternal(
  externalZipPath: string,
  onProgress?: (e: ProgressEvent) => void
): Promise<RestoreResult> {
  if (!existsSync(externalZipPath)) {
    return { success: false, error: '所选文件不存在' }
  }
  if (!/\.zip$/i.test(externalZipPath)) {
    return { success: false, error: '仅支持 .zip 备份文件' }
  }

  // 先校验外部 zip 是合法 v1 格式
  let manifest: ManifestV1
  try {
    manifest = await readManifestV1(externalZipPath)
  } catch (e: any) {
    return { success: false, error: `备份文件无效: ${e?.message || e}` }
  }
  const compat = checkCompat(manifest)
  if (compat.level === 'blocked') {
    return { success: false, error: compat.reason }
  }

  // 拷贝到 backups/，文件名带 imported- 前缀防冲突
  const ts = timestamp()
  const baseName = basename(externalZipPath).replace(/\.zip$/i, '')
  const fileName = `imported-${baseName}-${ts}.zip`
  const dest = join(getBackupDir(), fileName)
  try {
    copyFileSync(externalZipPath, dest)
  } catch (e: any) {
    return { success: false, error: `复制备份文件失败: ${e?.message || e}` }
  }

  // 入库（type 取自 manifest）
  const stat = statSync(dest)
  const info: BackupInfo = {
    fileName,
    type: manifest.type,
    size: stat.size,
    // 用"导入时间"而非原始 createdAt：否则按原始（可能很旧）时间会被 retention 提前清理、列表排序也错位
    createdAt: new Date().toISOString(),
    appVersion: manifest.appVersion,
    format: 'v1'
  }
  appendRecord(info)

  return await restoreFromRecord(fileName, onProgress)
}

// === 列表 / 删除 ===

export function listBackups(): BackupInfo[] {
  return listValidRecords()
}

export function deleteBackup(fileName: string): boolean {
  const filePath = join(getBackupDir(), fileName)
  safeRemove(filePath)
  removeRecord(fileName)
  return true
}

/**
 * 把 backups/ 下的指定备份文件复制到用户选择的外部路径。
 * IPC 层只负责弹文件选择对话框，文件操作在这里统一处理。
 */
export function exportBackupTo(
  fileName: string,
  destPath: string
): { success: boolean; error?: string } {
  const src = join(getBackupDir(), fileName)
  if (!existsSync(src)) return { success: false, error: '源文件不存在' }
  try {
    copyFileSync(src, destPath)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) }
  }
}

// === Settings 聚合 ===

export function getSettings(): BackupSettings {
  return {
    interval: getAutoBackupInterval(),
    maxCount: getMaxBackupCount()
  }
}

export function setSettings(s: Partial<BackupSettings>): void {
  if (s.interval !== undefined) setAutoBackupInterval(s.interval)
  if (s.maxCount !== undefined) setMaxBackupCount(s.maxCount)
}

// === 孤儿备份回补 ===

/**
 * 扫描 backups/ 下的备份文件，把"存在于磁盘但不在 records.json"的回补进 records。
 *
 * 触发场景：records.json 曾损坏被隔离（.corrupt-*），导致旧 zip 变成孤儿——
 * 既不在 UI 显示、也不被 retention 清理，永久占空间。回补后即可正常展示与清理。
 * 注意：deleteBackup 会同时删文件+记录，被删的备份无文件 → 不会被错误回补。
 */
async function reconcileOrphanBackups(): Promise<void> {
  const dir = getBackupDir()
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  const tracked = new Set(readRecords().map((r) => r.fileName))
  for (const name of names) {
    const isBackupFile = /\.zip$/i.test(name) || /\.sqlite$/i.test(name) || /\.bak$/i.test(name)
    if (!isBackupFile || tracked.has(name)) continue
    const full = join(dir, name)
    let stat
    try {
      stat = statSync(full)
      if (!stat.isFile()) continue
    } catch {
      continue
    }
    try {
      if (/\.zip$/i.test(name)) {
        const m = await readManifestV1(full)
        appendRecord({
          fileName: name,
          type: m.type,
          size: stat.size,
          createdAt: m.createdAt,
          appVersion: m.appVersion,
          format: 'v1'
        })
      } else {
        const type: BackupType = /\.bak$/i.test(name) ? 'full' : 'auto'
        appendRecord({
          fileName: name,
          type,
          size: stat.size,
          createdAt: new Date(stat.mtimeMs).toISOString(),
          format: 'legacy'
        })
      }
      console.warn('[backup] 回补孤儿备份到 records:', name)
    } catch (e) {
      // 不是合法备份（损坏 / 非本系统 zip）→ 跳过，不污染 records
      console.warn('[backup] 跳过无法识别的备份文件:', name, e)
    }
  }
}

// === 启动钩子 ===

/**
 * 主进程启动时调用：
 *   1. 清理上次崩溃留下的 .partial / .restore-staging-* 残骸
 *   2. 异步清理过期的 .restore-previous-*
 *   3. 回补 records.json 丢失的孤儿备份
 *   4. 如果配置了自动备份且时间到了，跑一次（不阻塞 UI）
 *
 * 注意：恢复中断自愈（recoverInterruptedRestore）由主进程在【打开数据库前】单独同步调用，
 * 不放这里——本函数运行时 DB 可能已打开，会与回滚的文件移动冲突。
 */
export async function runStartupTasks(): Promise<void> {
  try {
    cleanupOrphanedPartials()
  } catch (e) {
    console.error('[backup] cleanup partials failed:', e)
  }
  try {
    cleanupExpiredPreviousDirs()
  } catch (e) {
    console.error('[backup] cleanup previous dirs failed:', e)
  }
  try {
    await reconcileOrphanBackups()
  } catch (e) {
    console.error('[backup] reconcile orphan backups failed:', e)
  }

  if (shouldAutoBackup()) {
    try {
      await backupDatabase()
      markAutoBackupDone()
    } catch (e) {
      console.error('[backup] auto backup failed:', e)
    }
  }
}

