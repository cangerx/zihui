import { AsyncLocalStorage } from 'async_hooks'

// === 账号代次（epoch）守卫 ===
//
// 账号热切换（不重启进程）的安全基石。每次切换账号时 epoch +1。
// 配合 AsyncLocalStorage：每个任务在其异步调用链（含 await 之后、fire-and-forget 子任务）中
// 携带「启动时的账号代次」。getDatabase() 写库前校验代次——若与当前不符（账号已切换），抛错拒绝。
//
// 这把「切库后旧账号的 inflight 任务 await 之后 getDatabase() 写入新账号库」的串数据风险，
// 转化为安全的抛错失败（任务终止、不写任何库）。是覆盖「await 后才取 db」写库点的唯一收口手段。

let currentEpoch = 0

const als = new AsyncLocalStorage<number>()

export class AccountSwitchedError extends Error {
  readonly accountSwitched = true
  constructor(message = '账号已切换，旧任务的数据库操作已被中止') {
    super(message)
    this.name = 'AccountSwitchedError'
  }
}

export function isAccountSwitchedError(e: unknown): boolean {
  return !!(e && typeof e === 'object' && (e as { accountSwitched?: boolean }).accountSwitched === true)
}

/** 切换账号时调用：代次 +1，使旧上下文的后续写库被 assertEpoch 拦截。返回新代次。 */
export function bumpEpoch(): number {
  currentEpoch += 1
  return currentEpoch
}

export function getCurrentEpoch(): number {
  return currentEpoch
}

/**
 * 在「当前账号代次」上下文中执行任务（含其全部 await / fire-and-forget 子任务）。
 * 所有会写库的任务入口（IPC handler、长期定时器回调）都应经此包裹。
 */
export function runInEpoch<T>(fn: () => T): T {
  return als.run(currentEpoch, fn)
}

/**
 * 数据库写入守卫：若当前异步上下文携带的代次与全局代次不符（账号已切换）则抛错。
 * 无上下文（undefined）放行——兼容启动期、切换编排本身等非任务调用。
 */
export function assertEpoch(): void {
  const e = als.getStore()
  if (e !== undefined && e !== currentEpoch) {
    throw new AccountSwitchedError()
  }
}
