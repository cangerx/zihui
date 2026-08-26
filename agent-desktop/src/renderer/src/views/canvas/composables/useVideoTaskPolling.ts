import { cloudClient } from '@/utils/cloud-api'

/**
 * 画布视频任务统一轮询（模块级单例）。
 *
 * 单一定时器 + 多任务登记：所有运行中的视频节点共享一个 interval，逐个 refreshVideoTask，
 * 命中终态自动注销。AiVideoView 那种「每实例一个 pollTimer」在画布多节点场景会爆定时器，
 * 这里收敛为一个。扣费由后端完成（refresh 命中 completed 即 chargeAndRecord + 兜底命令），
 * 本轮询只负责把任务推进到终态并回调节点更新落盘。
 *
 * 单次 refresh 失败（网络抖动）不注销，下轮重试；即使前端始终失败，后端 video:settle-pending
 * 也会兜底结算，保证「完成必扣」。
 */
interface PollEntry {
  taskId: string
  onUpdate: (task: any) => void | Promise<void>
}

const POLL_INTERVAL_MS = 6000

const entries = new Map<string, PollEntry>()
let timer: ReturnType<typeof setInterval> | null = null
let ticking = false

function stop(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function start(): void {
  if (timer) return
  timer = setInterval(() => {
    void tick()
  }, POLL_INTERVAL_MS)
}

async function tick(): Promise<void> {
  if (ticking) return
  if (entries.size === 0) {
    stop()
    return
  }
  ticking = true
  try {
    for (const entry of [...entries.values()]) {
      // 注册可能在迭代中被并发注销
      if (!entries.has(entry.taskId)) continue
      try {
        const res = await cloudClient.refreshVideoTask(entry.taskId)
        const task = res?.task
        if (task) {
          await entry.onUpdate(task)
          if (['completed', 'failed', 'canceled'].includes(task.status)) {
            entries.delete(entry.taskId)
          }
        }
      } catch (e) {
        // 保留登记，下轮重试；后端兜底命令也会结算
        console.warn('[useVideoTaskPolling] refresh failed:', entry.taskId, e)
      }
    }
  } finally {
    ticking = false
    if (entries.size === 0) stop()
  }
}

export function useVideoTaskPolling() {
  /** 登记一个运行中的任务；onUpdate 在每轮 refresh 后被调用（含终态那次）。 */
  function register(taskId: string, onUpdate: (task: any) => void | Promise<void>): void {
    if (!taskId) return
    entries.set(taskId, { taskId, onUpdate })
    start()
  }

  function unregister(taskId: string): void {
    entries.delete(taskId)
    if (entries.size === 0) stop()
  }

  function isPolling(taskId: string): boolean {
    return entries.has(taskId)
  }

  /** 立即对某个已登记任务刷新一次（用于提交后尽快反映状态，不必等首个 interval）。 */
  async function pokeOnce(taskId: string): Promise<void> {
    const entry = entries.get(taskId)
    if (!entry) return
    try {
      const res = await cloudClient.refreshVideoTask(taskId)
      const task = res?.task
      if (task) {
        await entry.onUpdate(task)
        if (['completed', 'failed', 'canceled'].includes(task.status)) {
          entries.delete(taskId)
          if (entries.size === 0) stop()
        }
      }
    } catch {
      // 忽略，交给定时轮询重试
    }
  }

  return { register, unregister, isPolling, pokeOnce }
}
