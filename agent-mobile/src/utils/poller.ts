/**
 * 任务轮询：退避 + 超时，用于 /ai/app/worker/Query
 */
export interface PollOptions<T> {
  /** 每次查询 */
  fetch: () => Promise<T | null>
  /** 判定完成 */
  isDone: (data: T) => boolean
  /** 判定失败 */
  isFailed?: (data: T) => boolean
  /** 每次拿到结果的回调（用于进度展示） */
  onTick?: (data: T | null, attempt: number) => void
  /** 请求错误观察器；即使 abort 后响应才落地，也会先通知再丢弃结果 */
  onError?: (error: unknown) => void
  /** 首次间隔，默认 1200ms */
  interval?: number
  /** 最大间隔，默认 3000ms */
  maxInterval?: number
  /** 超时，默认 120s */
  timeout?: number
}

export interface PollResult<T> {
  status: 'done' | 'failed' | 'timeout' | 'aborted'
  data: T | null
}

export function createPoller<T>(options: PollOptions<T>) {
  const { fetch, isDone, isFailed, onTick, onError } = options
  const interval = options.interval ?? 1200
  const maxInterval = options.maxInterval ?? 3000
  const timeout = options.timeout ?? 120000

  let aborted = false
  let timer: ReturnType<typeof setTimeout> | null = null
  /** 当前 sleep 的 resolve，abort 时要主动调用它让挂起的 await 落地 */
  let wake: (() => void) | null = null

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      wake = resolve
      timer = setTimeout(resolve, ms)
    })

  async function start(): Promise<PollResult<T>> {
    const startedAt = Date.now()
    let attempt = 0
    let wait = interval

    while (!aborted) {
      if (Date.now() - startedAt > timeout) return { status: 'timeout', data: null }

      attempt += 1
      let data: T | null
      try {
        data = await fetch()
      } catch (error) {
        // Authentication/session observers must still see an error that arrives
        // after abort(); only page-state propagation is discarded below.
        onError?.(error)
        // fetch() itself may not be abortable. A rejection arriving after this
        // poller was aborted belongs to the discarded request, not the caller.
        if (aborted) return { status: 'aborted', data: null }
        throw error
      }
      // fetch() itself is not abortable. If abort() happened while it was in
      // flight, discard the response before it can mutate page state.
      if (aborted) return { status: 'aborted', data: null }
      onTick?.(data, attempt)

      if (data) {
        if (isFailed?.(data)) return { status: 'failed', data }
        if (isDone(data)) return { status: 'done', data }
      }

      await sleep(wait)
      wait = Math.min(Math.floor(wait * 1.3), maxInterval)
    }
    return { status: 'aborted', data: null }
  }

  function abort() {
    aborted = true
    if (timer) clearTimeout(timer)
    // 关键：唤醒挂起的 sleep，否则 await sleep() 永不返回、start() 死锁、
    // 轮询协程与 running 状态泄漏（onUnmounted 里 abort 命中的正是 sleep 窗口）
    if (wake) {
      wake()
      wake = null
    }
  }

  return { start, abort }
}
