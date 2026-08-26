import { runSync, getSyncConfig } from './engine'
import { getCloudToken } from '../cloud-token'
import { getOplogWatermark } from './state'

// 自动同步调度：按频率定时跑；realtime 额外轮询 oplog 水位，本地变更后尽快触发。

let timer: NodeJS.Timeout | null = null
let pendingTimer: NodeJS.Timeout | null = null
let lastSeenWatermark = -1

const PENDING_POLL_MS = 30_000

function intervalMs(mode: string): number {
  switch (mode) {
    case 'realtime':
      return 120_000 // 兜底轮询（拉取他设备变更）；本地变更走水位轮询更快
    case 'hourly':
      return 60 * 60_000
    case 'daily':
      return 24 * 60 * 60_000
    default:
      return 0
  }
}

async function safeRun(): Promise<void> {
  if (!getCloudToken()) return
  try {
    await runSync()
  } catch {
    // runSync 内部已记录 last_error
  }
}

export function stopSyncScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (pendingTimer) {
    clearInterval(pendingTimer)
    pendingTimer = null
  }
  lastSeenWatermark = -1
}

export function restartSyncScheduler(): void {
  stopSyncScheduler()
  const { mode } = getSyncConfig()
  const ms = intervalMs(mode)
  if (ms <= 0) return
  timer = setInterval(() => {
    void safeRun()
  }, ms)
  if (mode === 'realtime') {
    // 「实时（变更后自动）」：SQLite 触发器无法回调 JS，改为轮询 oplog 水位。
    // 水位用 MAX(seq)（AUTOINCREMENT 单调不复用），只在出现新变更时触发，
    // 永久挂起的待推项不会造成无限循环同步。
    pendingTimer = setInterval(() => {
      if (!getCloudToken()) return
      try {
        const wm = getOplogWatermark()
        if (lastSeenWatermark === -1) {
          lastSeenWatermark = wm
          return
        }
        if (wm > lastSeenWatermark) {
          lastSeenWatermark = wm
          void safeRun()
        }
      } catch {
        // 账号库切换瞬间等场景：静默，下个周期再查
      }
    }, PENDING_POLL_MS)
  }
}

/** 登录 / 账号就绪后跑一次（先 pull 后 push）。 */
export async function startupSync(): Promise<void> {
  const { mode } = getSyncConfig()
  if (mode === 'off') return
  await safeRun()
}
