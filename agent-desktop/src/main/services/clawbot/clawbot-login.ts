// 扫码登录状态机：get_bot_qrcode → 长轮询 get_qrcode_status → confirmed 落库。
// 纪律：二维码 TTL 5 分钟（expired 最多刷新 3 次）、总等待上限 8 分钟、
// scaned_but_redirect 切 baseurl、need_verifycode 挂起等用户输入配对码。

import { getBotQrcode, getQrcodeStatus, ILinkAbortedError } from './ilink-api'
import type { QrStatusResponse } from './ilink-types'
import * as store from './clawbot-store'

export type ClawbotLoginPhase =
  | 'idle'             // 未在登录
  | 'qr_ready'         // 二维码已就绪，等待扫码
  | 'scaned'           // 已扫码，等待微信端确认
  | 'need_verifycode'  // 需要输入微信端显示的数字配对码
  | 'confirmed'        // 绑定成功
  | 'error'

export interface ClawbotLoginState {
  phase: ClawbotLoginPhase
  /** qrcode_img_content 链接（渲染层用 qrcode 包转二维码图） */
  qrcodeUrl?: string
  message?: string
}

const MAX_QR_REFRESH = 3
const LOGIN_DEADLINE_MS = 8 * 60_000
const POLL_INTERVAL_MS = 1000

let state: ClawbotLoginState = { phase: 'idle' }
let stateListener: ((s: ClawbotLoginState) => void) | null = null
let running: AbortController | null = null
let verifyCodeWaiter: { resolve: (code: string | null) => void } | null = null

export function getLoginState(): ClawbotLoginState {
  return state
}

/** 桥接层注册：状态变化经 clawbot:status 广播给渲染层 */
export function setLoginStateListener(fn: ((s: ClawbotLoginState) => void) | null): void {
  stateListener = fn
}

function setState(patch: Partial<ClawbotLoginState>): void {
  state = { ...state, ...patch }
  try {
    stateListener?.(state)
  } catch (e) {
    console.error('[clawbot] login state listener error:', e)
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new ILinkAbortedError())
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 等待渲染层提交配对码；cancelLogin 时 resolve(null) */
function waitVerifyCode(): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    verifyCodeWaiter = { resolve }
  })
}

export function submitVerifyCode(code: string): void {
  const waiter = verifyCodeWaiter
  verifyCodeWaiter = null
  waiter?.resolve(code.trim() || null)
}

export function isLoginRunning(): boolean {
  return running !== null
}

export async function startLogin(): Promise<void> {
  if (running) return // 幂等：重复点击不叠加
  running = new AbortController()
  const signal = running.signal
  try {
    await runLoginFlow(signal)
  } catch (e) {
    if (!signal.aborted) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  } finally {
    running = null
    verifyCodeWaiter?.resolve(null)
    verifyCodeWaiter = null
  }
}

export function cancelLogin(): void {
  if (!running) {
    setState({ phase: 'idle' })
    return
  }
  running.abort()
  verifyCodeWaiter?.resolve(null)
  verifyCodeWaiter = null
  setState({ phase: 'idle' })
}

async function runLoginFlow(signal: AbortSignal): Promise<void> {
  let baseurl: string | undefined
  let refreshCount = 0
  const deadline = Date.now() + LOGIN_DEADLINE_MS
  while (!signal.aborted) {
    if (Date.now() > deadline) throw new Error('登录等待超时，请重新发起扫码')
    const qr = await getBotQrcode(signal)
    if (!qr.qrcode || !qr.qrcode_img_content) throw new Error('获取登录二维码失败，请稍后再试')
    setState({ phase: 'qr_ready', qrcodeUrl: qr.qrcode_img_content, message: '请用微信扫码（我 → 设置 → 插件 → 微信 ClawBot）' })
    const result = await pollStatus(baseurl, qr.qrcode, signal, deadline)
    if (result === 'refresh') {
      refreshCount++
      if (refreshCount > MAX_QR_REFRESH) throw new Error('二维码多次过期，请重新发起扫码')
      continue
    }
    // confirmed：落库（token 加密），状态由桥接层接力启动轮询
    store.saveLoginResult({
      ilink_bot_id: result.ilink_bot_id || '',
      ilink_user_id: result.ilink_user_id || '',
      baseurl: result.baseurl || '',
      bot_token: result.bot_token || ''
    })
    setState({ phase: 'confirmed', qrcodeUrl: undefined, message: '绑定成功' })
    return
  }
}

/** 返回 'refresh' 表示需要刷新二维码；返回 QrStatusResponse 表示 confirmed */
async function pollStatus(
  initialBaseurl: string | undefined,
  qrcode: string,
  signal: AbortSignal,
  deadline: number
): Promise<'refresh' | QrStatusResponse> {
  let baseurl = initialBaseurl
  let verifyCode: string | undefined
  while (!signal.aborted) {
    if (Date.now() > deadline) return 'refresh'
    let st: QrStatusResponse
    try {
      st = await getQrcodeStatus(baseurl, qrcode, verifyCode, signal)
    } catch (e) {
      if (e instanceof ILinkAbortedError) {
        if (signal.aborted) throw e
        continue // 长轮询客户端超时/网关抖动按 wait 继续
      }
      // 网络错误也容忍到 deadline，避免抖动打断登录
      await sleep(2000, signal)
      continue
    }
    switch (st.status) {
      case 'confirmed':
        if (!st.bot_token || !st.ilink_bot_id) throw new Error('登录响应缺少凭据字段，请重试')
        return st
      case 'wait':
        await sleep(POLL_INTERVAL_MS, signal)
        break
      case 'scaned':
        verifyCode = undefined
        setState({ phase: 'scaned', message: '已扫码，请在微信中确认登录' })
        break
      case 'need_verifycode': {
        setState({ phase: 'need_verifycode', message: '请输入微信中显示的数字配对码' })
        const code = await waitVerifyCode()
        if (signal.aborted) throw new ILinkAbortedError()
        if (!code) return 'refresh'
        verifyCode = code
        break
      }
      case 'verify_code_blocked':
        return 'refresh'
      case 'scaned_but_redirect':
        if (st.redirect_host) baseurl = `https://${st.redirect_host}`
        break
      case 'binded_redirect':
        throw new Error('该微信已绑定过本实例，无需重复扫码；如需换绑，请先在页面上「解除绑定」')
      case 'expired':
        return 'refresh'
      default:
        await sleep(POLL_INTERVAL_MS, signal)
        break
    }
  }
  throw new ILinkAbortedError()
}
