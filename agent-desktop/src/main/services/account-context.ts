import { BrowserWindow } from 'electron'
import { join, resolve } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'fs'
import { getRootDir, getDataDir, setAccountSubdir } from './data-path'
import { closeDatabase, getDatabase } from '../database'
import { stopAllMcpServers, warmupEnabledMcpServers } from './mcp-server'
import { stopAutoDownloadScheduler, startAutoDownloadScheduler } from './video-generation'
import { stopScheduler as stopLocalVideoScheduler, startScheduler as startLocalVideoScheduler } from './local-video'
import {
  stopScheduledTasksScheduler,
  startScheduledTasksScheduler
} from './scheduled-tasks'
import { cancelAllGenerations, cleanupStaleGenerations } from './image-generation'
import { cancelAllChats, clearAllLastTurnOverrides } from './chat-engine'
import { bumpEpoch } from './account-epoch'
import { stopSyncScheduler, onAccountReady } from './sync'
import { startClawbotBridge, stopClawbotBridge, clawbotStartupMaintenance } from './clawbot/clawbot-bridge'
import { closeAllBrowserWindows, isBrowserAutomationWindow } from './browser-automation'

// === 账号本地数据隔离：目录上下文 ===
//
// 每个云端账号在数据根（getRootDir）下拥有独立子目录，承载该账号专属的
// local-agent.db 与全部落盘资源（images/videos/canvas/backups/...）。
//
// 切换账号走「写映射 + 运行中热切换」（performAccountSwitchHotSwap，不重启进程）：bump 账号代次
// （epoch）拦截旧任务写库 + 中止对话/生图、停下载调度器/MCP、关旧库开新库，再 reload 渲染层。
// 配合 account-epoch 的 getDatabase 守卫，彻底规避切库瞬间「旧任务写进新账号库」的串数据风险。
//
// 映射文件 account-map.json（位于 root）：
//   { "active": "acc-1001", "dirs": { "acc-1001": ".", "acc-1002": "accounts/acc-1002" } }
// dirs[key] 为相对 root 的子目录；特殊值 "." 表示「继承 root 本身」（老用户首个登录账号认领历史数据，零搬迁）。

const ACCOUNT_MAP_FILE = 'account-map.json'
const ACCOUNTS_DIR = 'accounts'
const GUEST_KEY = '_guest'

interface AccountMap {
  active: string | null
  dirs: Record<string, string>
}

let activeKey: string | null = null
// 老布局（root 直接有 local-agent.db 且无 account-map）等待首个登录账号认领。
let legacyPending = false
// 账号是否已确定（可开库）。全新且从未登录时为 false：桌面端必须登录才能用，
// 未登录不建任何库（无 guest），登录后热切换（切目录开新库 + reload）即就绪。
let accountReady = false

function accountMapPath(): string {
  return join(getRootDir(), ACCOUNT_MAP_FILE)
}

function readMap(): AccountMap | null {
  try {
    const p = accountMapPath()
    if (existsSync(p)) {
      const m = JSON.parse(readFileSync(p, 'utf-8'))
      if (m && typeof m === 'object') {
        return { active: m.active ?? null, dirs: m.dirs && typeof m.dirs === 'object' ? m.dirs : {} }
      }
    }
  } catch (e) {
    console.error('[account] read account-map failed:', e)
  }
  return null
}

// 原子写：先写 .tmp 再 rename 覆盖目标。
// 账号映射损坏会导致路由退回 legacy/guest（多账号用户可能误认领/误入 guest），
// 故必须避免「直写过程中崩溃留下半截 JSON」。Node 20 / Electron 31 在 Windows 上
// renameSync 走 MoveFileEx(REPLACE_EXISTING)，对已存在目标可原子替换。
// rename 失败（极少数文件系统）时回退直写以保证可用性。
function writeMap(m: AccountMap): void {
  const target = accountMapPath()
  const tmp = target + '.tmp'
  const data = JSON.stringify(m, null, 2)
  try {
    writeFileSync(tmp, data, 'utf-8')
    renameSync(tmp, target)
  } catch (e) {
    console.error('[account] atomic write account-map failed, fallback to direct write:', e)
    try {
      writeFileSync(target, data, 'utf-8')
    } catch (e2) {
      console.error('[account] direct write account-map failed:', e2)
    }
    try { if (existsSync(tmp)) rmSync(tmp, { force: true }) } catch {}
  }
}

function keyForId(id: number | string | null): string {
  if (id === null || id === undefined || id === '') return GUEST_KEY
  return `acc-${id}`
}

function resolveDir(key: string, m: AccountMap | null): string {
  const sub = m?.dirs?.[key]
  if (sub === '.') return getRootDir()
  if (sub) return resolve(getRootDir(), sub)
  return join(getRootDir(), ACCOUNTS_DIR, key)
}

function normalizePath(p: string): string {
  return resolve(p).replace(/[\\/]+$/, '').toLowerCase()
}

/**
 * 启动早期解析当前账号目录并注入 data-path。
 * 时序硬约束：必须在 recoverInterruptedRestore() 与 getDatabase() 之前调用，
 * 否则恢复自愈/开库会落到错误目录。
 */
export function initAccountContext(): void {
  const m = readMap()
  if (m && m.active) {
    activeKey = m.active
    legacyPending = false
    accountReady = true
    applyAccountDir(resolveDir(activeKey, m))
    return
  }
  // 无映射：区分「老布局（root 直接有 db）」与「全新且从未登录」
  const rootDb = join(getRootDir(), 'local-agent.db')
  if (existsSync(rootDb)) {
    // 升级老用户：老数据原地可读，等首个登录账号认领（自动归属，无弹窗）
    legacyPending = true
    activeKey = null
    accountReady = true
    applyAccountDir(getRootDir())
  } else {
    // 全新且从未登录：桌面端必须登录才能用，未登录不建任何库（无 guest 目录）。
    // accountSubdir 保持 null（getDataDir 回退 root 仅供 dataDir.get 显示路径，不会触发开库）；
    // 用户登录后 setActiveAccount 写映射并热切换（bump 代次 + 切目录开新库 + reload），即进入「已就绪」分支。
    legacyPending = false
    activeKey = null
    accountReady = false
  }
}

/**
 * 确保账号目录存在再注入 data-path。
 * better-sqlite3 不会自动创建父目录；账号子目录（accounts/...）首次使用前必须 mkdir，
 * 否则 new Database() 会因目录不存在抛 "unable to open database file"。
 */
function applyAccountDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true })
  } catch (e) {
    console.error('[account] mkdir account dir failed:', e)
  }
  setAccountSubdir(dir)
}

export function getActiveAccountKey(): string | null {
  return activeKey
}

export function isLegacyPending(): boolean {
  return legacyPending
}

/** 账号是否已确定、可安全开库（已登录用户 / 老用户原地继承）。全新未登录返回 false。 */
export function isAccountReady(): boolean {
  return accountReady
}

/**
 * 切换当前账号。id 为 null 表示登出（无目标账号，回到未就绪态）。
 * - 目标目录与当前进程目录一致 -> 仅更新映射，无需切换（init / reload 回流后的幂等确认走此路）。
 * - 不一致 -> 运行中热切换（不重启进程）：见 performAccountSwitchHotSwap。
 *
 * 老用户首个登录账号若处于 legacyPending，则把其目录落定为 root（'.'），原地继承历史数据。
 */
export function setActiveAccount(id: number | string | null): { switched: boolean } {
  const targetKey = keyForId(id)
  const m = readMap() || { active: null, dirs: {} }

  if (!m.dirs[targetKey]) {
    if (legacyPending && id !== null && id !== undefined && id !== '') {
      // 首个登录账号认领老数据：继承 root（零搬迁、零路径重写、零裂图）
      m.dirs[targetKey] = '.'
    } else {
      m.dirs[targetKey] = join(ACCOUNTS_DIR, targetKey)
    }
  }
  m.active = targetKey

  const targetDir = resolveDir(targetKey, m)
  const currentDir = getDataDir()
  writeMap(m)

  if (normalizePath(currentDir) === normalizePath(targetDir)) {
    activeKey = targetKey
    legacyPending = false
    accountReady = true
    applyAccountDir(targetDir)
    // 账号目录已就绪（无需热切换）：此刻启动云同步，确保在正确账号库上运行。
    // 覆盖：app 启动 init、登录直挂当前目录、以及热切换 reload 后的回流确认。
    try {
      onAccountReady()
    } catch (e) {
      console.error('[account] sync onAccountReady failed:', e)
    }
    return { switched: false }
  }

  performAccountSwitchHotSwap(targetKey, targetDir)
  return { switched: true }
}

/**
 * 运行中热切换账号（不重启进程）。步骤：
 * 1. bumpEpoch：此后旧账号的 inflight 任务在 await 之后调 getDatabase() 会被 assertEpoch 拒绝，
 *    把「切库后旧任务写进新账号库」的串数据风险转成安全的抛错失败。
 *    本函数经未包裹的 cloud:setActiveAccount handler 调用，自身无 als 代次上下文，
 *    故下面的 closeDatabase / getDatabase 不受守卫拦截（assertEpoch 对 undefined 上下文放行）。
 * 2. 清场：中止进行中的对话/生图、停视频下载调度器（含排队 timer）、停 MCP 子进程。
 * 3. 关旧库 -> 切到新账号目录（mkdir + 注入 data-path）-> 开新库（首次自动建表播种）
 *    -> 清理该账号库遗留的「排队/生成中」图片任务（热切换不重启进程，需主动补这项启动级清理，
 *    否则切回该账号 reload 后这些已死任务会在 UI 永久转圈；relaunch 版靠重启跑 cleanupStaleGenerations）。
 * 4. 重启视频下载调度器（指向新账号库），并 reload 所有窗口：渲染层重新 init() 按新账号加载数据
 *    （token 在 localStorage，reload 不丢，登录态自动恢复；回流的 setActiveAccount 因目录一致成为幂等 no-op）。
 */
function performAccountSwitchHotSwap(targetKey: string, targetDir: string): void {
  bumpEpoch()
  try { cancelAllChats() } catch (e) { console.error('[account] cancelAllChats failed:', e) }
  try { cancelAllGenerations() } catch (e) { console.error('[account] cancelAllGenerations failed:', e) }
  try { stopAutoDownloadScheduler() } catch (e) { console.error('[account] stop scheduler failed:', e) }
  try { stopLocalVideoScheduler() } catch (e) { console.error('[account] stop local video scheduler failed:', e) }
  try { stopScheduledTasksScheduler() } catch (e) { console.error('[account] stop scheduled tasks failed:', e) }
  try { stopSyncScheduler() } catch (e) { console.error('[account] stop sync scheduler failed:', e) }
  try { stopAllMcpServers() } catch (e) { console.error('[account] stop mcp failed:', e) }
  // 停微信 ClawBot 桥（长轮询/发送队列），防止旧账号凭据在新库上继续收发
  try { stopClawbotBridge() } catch (e) { console.error('[account] stop clawbot failed:', e) }
  try { closeAllBrowserWindows() } catch (e) { console.error('[account] close browser windows failed:', e) }
  // 清空 chat-engine 内的 stash，避免上一账号会话的 overrides 残留串到新账号
  try { clearAllLastTurnOverrides() } catch (e) { console.error('[account] clear last-turn overrides failed:', e) }
  try { closeDatabase() } catch (e) { console.error('[account] close db failed:', e) }

  activeKey = targetKey
  legacyPending = false
  accountReady = true
  applyAccountDir(targetDir)
  try { getDatabase() } catch (e) { console.error('[account] open new db failed:', e) }
  // 补做启动级清理：把新账号库上次遗留的「排队/生成中」图片任务标记为失败，避免切回后 UI 永久转圈。
  // 此刻新账号尚未发起任何新生成（reload 后才会），不会误伤；与正常启动的 cleanupStaleGenerations 等价。
  try { cleanupStaleGenerations() } catch (e) { console.error('[account] cleanup stale generations failed:', e) }
  try { startAutoDownloadScheduler() } catch (e) { console.error('[account] restart scheduler failed:', e) }
  try { startLocalVideoScheduler() } catch (e) { console.error('[account] restart local video scheduler failed:', e) }
  try { startScheduledTasksScheduler() } catch (e) { console.error('[account] restart scheduled tasks failed:', e) }
  // 微信 ClawBot 桥：新账号库僵尸清理 + 重启长轮询（热切换不重启进程，启动级清理必须在此补做）
  try { clawbotStartupMaintenance() } catch (e) { console.error('[account] clawbot maintenance failed:', e) }
  try { void startClawbotBridge().catch((e) => console.error('[account] start clawbot failed:', e)) } catch (e) { console.error('[account] start clawbot failed:', e) }

  // reload 所有窗口渲染层：renderer 重新 init() 加载新账号数据（token 在 localStorage 不丢）
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    if (isBrowserAutomationWindow(win)) continue
    try { win.webContents.reload() } catch (e) { console.error('[account] reload window failed:', e) }
  }
  // 新账号目录下重新预热 MCP，与 main/index.ts 启动路径一致延迟 1500ms，避免与 reload 期 IO 抢资源
  setTimeout(() => {
    try { warmupEnabledMcpServers() } catch (e) { console.error('[account] warmup mcp failed:', e) }
  }, 1500)
}
