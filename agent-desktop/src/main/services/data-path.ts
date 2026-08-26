import { app } from 'electron'
import { join, basename, resolve, sep, dirname } from 'path'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  rmSync
} from 'fs'

const CONFIG_FILE = 'data-path.json'
// 数据目录里的标记文件，用于 isFirstLaunch 双重校验：
// 即使 userData/data-path.json 被清掉，只要外部数据目录还在并带 marker，
// 就能识别为"老用户"而不是首次启动。
const DATA_DIR_MARKER = '.local-agent-data'
// 迁移时跳过的扩展名：SQLite 临时/锁文件、备份文件等，避免破坏正在运行的 db。
const MIGRATION_EXCLUDE_EXTS = new Set(['.db-wal', '.db-shm', '.db-journal'])
// 迁移时跳过的根级条目（目录或文件名）。
const MIGRATION_EXCLUDE_NAMES = new Set([CONFIG_FILE])
// 文件数过多时不静默放弃，而是要求 UI 二次确认。
const MIGRATION_FILE_LIMIT = 10000

// 数据根目录缓存（root = 用户可配置的数据根，承载 accounts/、device-id.txt、
// data-path.json、account-map.json、device-settings.json）。
let cachedRootDir: string | null = null
// 当前账号数据子目录（绝对路径）。由 account-context 在启动早期 / 切换账号时注入。
// 为 null 时 getDataDir() 回退到 root（兼容 account-context 尚未初始化的极早期调用）。
let accountSubdir: string | null = null

function getConfigPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE)
}

function getDefaultDataDir(): string {
  return app.getPath('userData')
}

function readConfig(): Record<string, any> {
  const configPath = getConfigPath()
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch {}
  }
  return {}
}

function writeConfig(config: Record<string, any>): void {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
}

function hasExcludedExt(name: string): boolean {
  const lower = name.toLowerCase()
  for (const ext of MIGRATION_EXCLUDE_EXTS) {
    if (lower.endsWith(ext)) return true
  }
  return false
}

function writeMarker(dir: string): void {
  try {
    const markerPath = join(dir, DATA_DIR_MARKER)
    if (!existsSync(markerPath)) {
      writeFileSync(markerPath, JSON.stringify({ createdAt: new Date().toISOString() }, null, 2), 'utf-8')
    }
  } catch {}
}

/**
 * 数据根目录：用户可配置的数据根（config.dataDir）或默认 userData。
 * 承载 accounts/ 子目录、device-id.txt、data-path.json、account-map.json、device-settings.json。
 * 「更换数据目录 / 迁移」等设备级操作都锚定此目录，与具体登录账号无关。
 */
export function getRootDir(): string {
  if (cachedRootDir) return cachedRootDir

  const config = readConfig()
  if (config.dataDir && existsSync(config.dataDir)) {
    cachedRootDir = config.dataDir
    return cachedRootDir!
  }

  cachedRootDir = getDefaultDataDir()
  return cachedRootDir!
}

/**
 * 由 account-context 注入「当前账号数据子目录」绝对路径。
 * 传 null 表示回退到 root（未初始化 / 测试场景）。
 */
export function setAccountSubdir(absDir: string | null): void {
  accountSubdir = absDir
}

/**
 * 当前账号的数据目录（业务库 local-agent.db、images/videos/canvas/backups 等全部落此）。
 * = account-context 注入的账号子目录；未注入时回退 root（兼容极早期调用）。
 */
export function getDataDir(): string {
  return accountSubdir || getRootDir()
}

function isRootDir(dir: string): boolean {
  // 处理 Windows 盘根（带或不带斜杠）、UNC 根、Unix 根
  if (!dir) return true
  if (dir === '/' || dir === '\\') return true
  if (/^[A-Z]:[\\/]?$/i.test(dir)) return true
  if (/^\\\\[^\\]+\\[^\\]+\\?$/.test(dir)) return true
  return false
}

// === 数据目录安全校验 ===
//
// 核心原则：数据目录必须与应用安装目录、系统保留目录完全隔离，否则：
//   - 升级/卸载时数据会被 NSIS 连带清空
//   - Program Files 等系统目录需要管理员权限，非管理员写入会被 UAC VirtualStore 静默重定向，
//     导致"应用看到的路径"与"实际写入的路径"错位

/**
 * 将路径规范化为"可比较形式"：
 * - resolve 为绝对路径（消除相对路径、. / .. 等）
 * - 小写（Windows 文件系统不区分大小写；Linux 虽区分但这里偏保守更安全）
 * - 去尾部分隔符
 */
function normalizeForCompare(dir: string): string {
  return resolve(dir).toLowerCase().replace(/[\\/]+$/, '')
}

/**
 * 判断 child 是否位于 parent 目录内（含相等）。
 *
 * 关键点：必须用 `parent + sep` 做前缀匹配，
 * 否则 'C:\Program Files2' 会被误判为 'C:\Program Files' 的子目录。
 */
function isPathUnder(child: string, parent: string): boolean {
  if (!parent) return false
  const c = normalizeForCompare(child)
  const p = normalizeForCompare(parent)
  if (c === p) return true
  return c.startsWith(p + sep.toLowerCase())
}

export interface UnsafeCheck {
  unsafe: boolean
  reason?: string
}

/**
 * 判断目录作为数据目录是否安全。
 *
 * 拦截场景：
 *   1. 磁盘根 / 系统根 —— 权限问题 + 误伤风险
 *   2. 应用安装目录（app path / exe 目录 / resources）及其子目录 —— 升级/卸载被清空
 *   3. 系统保留目录（Program Files / Windows 等）及其子目录 —— 权限 + VirtualStore 陷阱
 *
 * 注意：前端会自动把 "C:\Program Files" 补成 "C:\Program Files\local-agent"，
 * 因此校验必须走"前缀包含"语义，不能只做精确相等比较。
 */
export function isUnsafeDataDir(dir: string): UnsafeCheck {
  if (!dir || !dir.trim()) return { unsafe: true, reason: '路径为空' }

  if (isRootDir(dir)) {
    return { unsafe: true, reason: '不能使用磁盘根目录作为数据目录' }
  }

  // 应用安装目录及子目录
  const installCandidates: string[] = []
  try { installCandidates.push(app.getAppPath()) } catch {}
  try { installCandidates.push(dirname(app.getPath('exe'))) } catch {}
  if (process.resourcesPath) installCandidates.push(process.resourcesPath)

  for (const c of installCandidates) {
    if (c && isPathUnder(dir, c)) {
      return {
        unsafe: true,
        reason: '该位置位于应用安装目录内，升级或卸载时数据会被清空，请选择其他位置'
      }
    }
  }

  // 系统保留目录（从环境变量拿，兼容非 C 盘系统/32 位应用在 64 位系统上的差异）
  if (process.platform === 'win32') {
    const sysRoots = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.ProgramW6432,
      process.env.windir,
      process.env.SystemRoot
    ].filter((p): p is string => !!p && p.length > 0)

    for (const root of sysRoots) {
      if (isPathUnder(dir, root)) {
        return {
          unsafe: true,
          reason: '该位置位于系统保留目录内（如 Program Files、Windows），不适合作为数据目录'
        }
      }
    }
  }

  return { unsafe: false }
}

export interface SetDataDirResult {
  ok: boolean
  /** 失败时的原因，用于前端 UI 展示 */
  reason?: string
}

/**
 * 写入数据目录配置。
 *
 * @param dir 新的数据目录绝对路径
 * @param options.activate 是否立即把当前进程的 cachedRootDir 切换到新路径。
 *   默认 false——只写 config，等下次启动重读；让调用方负责触发重启。
 *   首次启动场景下，如果用户选了与默认不同的目录，也应保持默认 false 由 renderer
 *   决定是否 relaunch，避免本次会话产生数据切割（DB 在旧目录、文件在新目录）。
 */
export function setDataDir(dir: string, options?: { activate?: boolean }): SetDataDirResult {
  const check = isUnsafeDataDir(dir)
  if (check.unsafe) {
    return { ok: false, reason: check.reason }
  }

  // 先 mkdir 再写 config，避免 mkdir 失败时 data-path.json 已记录"幽灵 dataDir"，
  // 下次启动 getDataDir() 虽有 existsSync 兜底回退默认目录，但 oldDataDir 可能误触发迁移弹窗。
  try {
    mkdirSync(dir, { recursive: true })
  } catch (e: any) {
    return { ok: false, reason: `无法创建数据目录：${e?.message || String(e)}` }
  }

  const activate = options?.activate === true
  const config = readConfig()
  const currentDir = getRootDir()
  if (currentDir !== dir && !isRootDir(currentDir)) {
    config.oldDataDir = currentDir
  }
  config.dataDir = dir
  writeConfig(config)
  writeMarker(dir)
  if (activate) {
    cachedRootDir = dir
  }
  return { ok: true }
}

export function isFirstLaunch(): boolean {
  // 双重判断：仅 data-path.json 不存在还不够。
  // 如果 userData 被清空但用户的外部数据目录仍在（带 marker），则不算首次启动。
  if (existsSync(getConfigPath())) return false
  // 兜底扫描：检查 userData 自身是否已有 marker（用户从未改过目录的老安装）
  try {
    const userData = getDefaultDataDir()
    if (existsSync(join(userData, DATA_DIR_MARKER))) return false
    // 老安装可能没有 marker，但有 db 文件 → 也视为非首次
    if (existsSync(join(userData, 'local-agent.db'))) return false
  } catch {}
  return true
}

export function initDataDir(dir?: string, options?: { activate?: boolean }): SetDataDirResult {
  const dataDir = dir || getDefaultDataDir()
  // 默认 userData 永远安全；只有用户显式传入路径时才需要校验。
  // setDataDir 内部还会再做一次校验作为兜底，这里提前判断只为提供更清晰的错误流。
  return setDataDir(dataDir, options)
}

/**
 * 判断"刚被设置的目录"与"当前进程实际正在使用的目录"是否一致。
 * 用于：renderer 在 confirmSetup / changeDataDir 后判断是否需要触发 relaunch。
 */
export function isDataDirActivated(): boolean {
  const config = readConfig()
  if (!config.dataDir) return true
  return cachedRootDir === config.dataDir
}

// --- Migration ---

function collectFiles(dir: string, base: string = ''): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results
  for (const entry of readdirSync(dir)) {
    // 跳过 sqlite 临时锁文件，以及不应迁移的根级条目（如 data-path.json）
    if (!base && MIGRATION_EXCLUDE_NAMES.has(entry)) continue
    if (hasExcludedExt(entry)) continue
    const full = join(dir, entry)
    const rel = base ? join(base, entry) : entry
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      results.push(...collectFiles(full, rel))
    } else {
      results.push(rel)
    }
  }
  return results
}

export interface MigrationCheckResult {
  needed: boolean
  oldDir: string
  newDir: string
  fileCount: number
  /** 文件数超过 MIGRATION_FILE_LIMIT 时为 true，UI 应展示二次确认。
   *  保留 oldDataDir 记录，不静默丢弃。 */
  tooMany: boolean
  /** 新目录里已存在的、会被覆盖的同名文件相对路径（最多前 50 条）。 */
  conflicts: string[]
  conflictCount: number
}

export function checkMigration(): MigrationCheckResult {
  const empty = (): MigrationCheckResult => ({
    needed: false, oldDir: '', newDir: '', fileCount: 0, tooMany: false, conflicts: [], conflictCount: 0
  })
  const config = readConfig()
  const oldDir = config.oldDataDir
  const newDir = config.dataDir

  if (!oldDir || !newDir || oldDir === newDir) {
    return empty()
  }

  if (!existsSync(oldDir) || isRootDir(oldDir)) {
    // 旧目录已不存在或是根目录 —— 这种情况记录已无意义，可安全清理
    clearOldDataDir()
    return empty()
  }

  const files = collectFiles(oldDir)
  if (files.length === 0) {
    // 旧目录有效但已无可迁移文件
    clearOldDataDir()
    return empty()
  }

  const tooMany = files.length > MIGRATION_FILE_LIMIT

  // 计算冲突列表（新目录已有同名文件）
  const conflicts: string[] = []
  let conflictCount = 0
  if (existsSync(newDir)) {
    for (const rel of files) {
      const dest = join(newDir, rel)
      if (existsSync(dest)) {
        conflictCount++
        if (conflicts.length < 50) conflicts.push(rel)
      }
    }
  }

  return { needed: true, oldDir, newDir, fileCount: files.length, tooMany, conflicts, conflictCount }
}

export interface MigrateOptions {
  /** 同名文件冲突策略：keep-existing 保留新目录已有；overwrite 用旧目录覆盖。默认 keep-existing 更安全。 */
  conflictStrategy?: 'keep-existing' | 'overwrite'
}

export function migrateFiles(
  onProgress: (current: number, total: number, fileName: string) => void,
  options?: MigrateOptions
): { success: boolean; error?: string; copied: number; skipped: number } {
  const config = readConfig()
  const oldDir = config.oldDataDir
  const newDir = config.dataDir
  const strategy = options?.conflictStrategy ?? 'keep-existing'

  if (!oldDir || !newDir || !existsSync(oldDir)) {
    return { success: false, error: 'Old directory not found', copied: 0, skipped: 0 }
  }

  let copied = 0
  let skipped = 0

  try {
    const files = collectFiles(oldDir)
    const total = files.length

    for (let i = 0; i < files.length; i++) {
      const rel = files[i]
      const src = join(oldDir, rel)
      const dest = join(newDir, rel)
      const destDir = join(dest, '..')
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })

      if (existsSync(dest) && strategy === 'keep-existing') {
        skipped++
      } else {
        copyFileSync(src, dest)
        copied++
      }
      onProgress(i + 1, total, basename(rel))
    }

    // 迁移成功后写 marker，方便 isFirstLaunch 判断
    writeMarker(newDir)

    return { success: true, copied, skipped }
  } catch (e: any) {
    return { success: false, error: e?.message || String(e), copied, skipped }
  }
}

export function deleteOldDir(): { success: boolean; error?: string } {
  const config = readConfig()
  const oldDir = config.oldDataDir
  if (!oldDir || !existsSync(oldDir)) {
    clearOldDataDir()
    return { success: true }
  }
  try {
    const userDataDir = app.getPath('userData')
    const isUserData = oldDir.replace(/[\\/]+$/, '').toLowerCase() === userDataDir.replace(/[\\/]+$/, '').toLowerCase()

    if (isUserData) {
      // Delete contents but keep the dir and config file
      for (const entry of readdirSync(oldDir)) {
        if (entry === CONFIG_FILE) continue
        const full = join(oldDir, entry)
        try {
          rmSync(full, { recursive: true, force: true })
        } catch {}
      }
    } else {
      rmSync(oldDir, { recursive: true, force: true })
    }

    clearOldDataDir()
    return { success: true }
  } catch (e: any) {
    // Always clear record to prevent repeated prompts
    clearOldDataDir()
    return { success: false, error: e?.message || String(e) }
  }
}

export function clearOldDataDir(): void {
  const config = readConfig()
  delete config.oldDataDir
  writeConfig(config)
}

/**
 * 跳过本次迁移，但保留 oldDataDir 记录，下次启动仍会提示。
 * 用户可能只是想"现在不处理，等会再说"，不该静默丢失旧数据位置。
 */
export function skipMigration(): void {
  // 故意空实现：保留 config.oldDataDir，下次启动 checkMigration 仍会返回 needed=true。
}

/**
 * 永久放弃旧数据：仅清除 config 中的 oldDataDir 记录，不删除磁盘文件。
 * 用户可在外部文件管理器手动处理旧目录。
 */
export function abandonOldDataDir(): void {
  clearOldDataDir()
}
