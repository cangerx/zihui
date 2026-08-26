// iLink 协议 HTTP 封装：公共请求头 + base_info + 七个端点 + 超时纪律。
// 纯协议层：不碰 DB、不碰 Electron，方便独立自测。
// 参考：官方 npm 包 @tencent-weixin/openclaw-weixin（src/api/api.ts）。

import type {
  GetBotQrcodeResponse,
  GetConfigResponse,
  GetUpdatesResponse,
  GetUploadUrlRequest,
  GetUploadUrlResponse,
  ILinkBaseInfo,
  OutboundMessage,
  QrStatusResponse,
  SendMessageResponse,
  WeixinMessage
} from './ilink-types'

export const ILINK_DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'
export const ILINK_CDN_BASE = 'https://novac2c.cdn.weixin.qq.com/c2c'
// 对齐官方 npm 包 @tencent-weixin/openclaw-weixin 的最新版本（base_info.channel_version / ClientVersion）
export const ILINK_CHANNEL_VERSION = '2.4.6'

/** iLink-App-ClientVersion：0x00MMNNPP（2.4.6 → 132102） */
const CLIENT_VERSION_UINT32 = (2 << 16) | (4 << 8) | 6
const BOT_AGENT = 'local-agent-desktop/clawbot-bridge'

/** 长轮询挂起时长（服务端 hold 35s），客户端超时须比它多留余量 */
export const LONG_POLL_SERVER_MS = 35000

function baseInfo(): ILinkBaseInfo {
  return { channel_version: ILINK_CHANNEL_VERSION, bot_agent: BOT_AGENT }
}

/** X-WECHAT-UIN：随机 uint32 十进制串的 base64，每次请求重新生成（防重放） */
function randomUin(): string {
  return Buffer.from(String(Math.floor(Math.random() * 0xffffffff)), 'utf8').toString('base64')
}

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomUin(),
    'iLink-App-Id': 'bot',
    'iLink-App-ClientVersion': String(CLIENT_VERSION_UINT32)
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export class ILinkHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'ILinkHttpError'
  }
}

/** 请求被外部/超时中止（长轮询场景属正常路径，调用方按「空结果」处理） */
export class ILinkAbortedError extends Error {
  constructor() {
    super('ilink request aborted')
    this.name = 'ILinkAbortedError'
  }
}

interface RawJsonResult {
  status: number
  data: any
  /** 原始响应体（截断 300 字）：sendmessage 联调期取证用（官方空 body/{} 表成功） */
  raw?: string
}

/**
 * POST JSON 并解析响应。超时/外部 signal 都会转成 ILinkAbortedError。
 * 注意：iLink 部分失败会返回 HTTP 200 但 body 为空 {}（静默丢失），
 * 所以这里不假设 body 必存在，调用方对关键字段自行断言。
 */
async function postJson(
  url: string,
  token: string | undefined,
  body: Record<string, any>,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<RawJsonResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  // 外部中止（服务停止/账号切换）联动
  const onExternalAbort = (): void => ctrl.abort()
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer)
      throw new ILinkAbortedError()
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(token),
      body: JSON.stringify({ ...body, base_info: baseInfo() }),
      signal: ctrl.signal
    })
    const text = await resp.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
    }
    if (!resp.ok) throw new ILinkHttpError(resp.status, `ilink http ${resp.status}: ${text.slice(0, 200)}`)
    return { status: resp.status, data: data ?? {}, raw: text.slice(0, 300) }
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new ILinkAbortedError()
    throw e
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}

async function getJson(
  url: string,
  token: string | undefined,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<RawJsonResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const onExternalAbort = (): void => ctrl.abort()
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer)
      throw new ILinkAbortedError()
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  try {
    const resp = await fetch(url, { headers: buildHeaders(token), signal: ctrl.signal })
    const text = await resp.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
    }
    if (!resp.ok) throw new ILinkHttpError(resp.status, `ilink http ${resp.status}: ${text.slice(0, 200)}`)
    return { status: resp.status, data: data ?? {} }
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new ILinkAbortedError()
    throw e
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}

function apiUrl(baseurl: string | undefined, path: string): string {
  const base = (baseurl || ILINK_DEFAULT_BASE_URL).replace(/\/+$/, '')
  return `${base}/ilink/bot${path}`
}

// ===== 登录 =====

export async function getBotQrcode(signal?: AbortSignal): Promise<GetBotQrcodeResponse> {
  // 官方契约为 POST + { local_token_list }（本地已登录 token 列表，最多 10 个，用于服务端去重）；
  // 我们不保存历史 token，传空数组（无本地账号的标准形态）
  const { data } = await postJson(apiUrl(undefined, '/get_bot_qrcode?bot_type=3'), undefined, { local_token_list: [] }, 15000, signal)
  return data as GetBotQrcodeResponse
}

/**
 * 轮询二维码状态（35s 长轮询）。
 * 中止/超时由调用方捕获 ILinkAbortedError 后按 'wait' 继续。
 */
export async function getQrcodeStatus(
  baseurl: string | undefined,
  qrcode: string,
  verifyCode?: string,
  signal?: AbortSignal
): Promise<QrStatusResponse> {
  let url = apiUrl(baseurl, `/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`)
  if (verifyCode) url += `&verify_code=${encodeURIComponent(verifyCode)}`
  const { data } = await getJson(url, undefined, LONG_POLL_SERVER_MS + 5000, signal)
  return data as QrStatusResponse
}

// ===== 长轮询收消息 =====

/**
 * getupdates：服务器 hold 最多 35s，无消息也返回空 msgs。
 * 中止（含客户端超时）抛 ILinkAbortedError，调用方视为「本轮无消息」继续。
 */
export async function getUpdates(
  baseurl: string | undefined,
  token: string,
  getUpdatesBuf: string,
  signal?: AbortSignal
): Promise<GetUpdatesResponse> {
  const { data } = await postJson(
    apiUrl(baseurl, '/getupdates'),
    token,
    { get_updates_buf: getUpdatesBuf || '' },
    LONG_POLL_SERVER_MS + 5000,
    signal
  )
  return data as GetUpdatesResponse
}

/** sendmessage 业务拒绝错误：ret/errcode 非零。code=-2 为服务端拒发（限流/上下文失效等） */
export class ILinkSendError extends Error {
  constructor(
    public readonly code: number,
    public readonly errmsg: string,
    what: string
  ) {
    super(`${what} 失败 ret=${code}${errmsg ? ` ${errmsg}` : ''}`.trim())
    this.name = 'ILinkSendError'
  }
  /**
   * -2 = 服务端拒发（社区实证两种形态：errmsg=rate limited 限流 / prepare failed 上下文失效）。
   * 此类错误立刻重试只会加重限流（重试风暴），调用方应熔断退避、等下一条入站刷新 context_token。
   */
  get isDeclined(): boolean {
    return this.code === -2
  }
}

// ===== 发消息 =====

export async function sendMessage(
  baseurl: string | undefined,
  token: string,
  msg: OutboundMessage,
  signal?: AbortSignal
): Promise<SendMessageResponse> {
  const { data, status, raw } = await postJson(apiUrl(baseurl, '/sendmessage'), token, { msg }, 15000, signal)
  // 联调取证：记录真实响应形态（成功=空 body 或 {}；失败=带 ret/errmsg 的 JSON）
  console.debug('[clawbot] sendmessage resp:', status, raw || '(empty)')
  return data as SendMessageResponse
}

/**
 * sendmessage 响应判读（对齐官方 2.4.6 api.ts 语义）：
 * - 成功：HTTP 200 + 空 body 或 `{}`（ret 缺失即为成功；官方测试套件的成功 mock 就是 "{}"）
 * - 失败：ret 或 errcode 为非零数字 → 抛 ILinkSendError
 * 注意：此前把空 body 判失败（「静默丢失」推测），真机联调证实该推测不成立——
 * 误判会把已送达消息重试补发（重复投递 + 放大限流）。必填字段防呆由 buildOutboundMessage 断言承担。
 */
export function assertSendResponse(resp: SendMessageResponse, what = 'sendmessage'): void {
  if (!resp || typeof resp !== 'object') return // 空响应 = 成功（官方语义）
  const ret = Number(resp.ret)
  const errcode = Number(resp.errcode)
  const code = ret !== 0 && !Number.isNaN(ret) ? ret : !Number.isNaN(errcode) && errcode !== 0 ? errcode : 0
  if (code === 0) return
  throw new ILinkSendError(code, typeof resp.errmsg === 'string' ? resp.errmsg : '', what)
}

/** 便捷构造出站消息骨架（必填字段缺一即静默丢失，统一在此断言） */
export function buildOutboundMessage(params: {
  toUserId: string
  contextToken: string
  itemList: WeixinMessage['item_list']
  /** 稳定幂等键（可选）：同一逻辑消息的重试/分段共享同一前缀派生 id，供服务端按 client_id 去重，
   *  防「响应歧义 → 重试 → 重复投递」（此前每次重试都重新生成随机 id，协议层无任何幂等键） */
  clientId?: string
}): OutboundMessage {
  if (!params.toUserId) throw new Error('buildOutboundMessage: toUserId required')
  if (!params.contextToken) throw new Error('buildOutboundMessage: contextToken required')
  if (!params.itemList || params.itemList.length === 0) throw new Error('buildOutboundMessage: item_list required')
  return {
    from_user_id: '',
    to_user_id: params.toUserId,
    client_id: params.clientId || `local-agent-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`,
    message_type: 2, // BOT
    message_state: 2, // FINISH
    context_token: params.contextToken,
    item_list: params.itemList
  }
}

// ===== 媒体上传 =====

export async function getUploadUrl(
  baseurl: string | undefined,
  token: string,
  req: GetUploadUrlRequest,
  signal?: AbortSignal
): Promise<GetUploadUrlResponse> {
  const { data } = await postJson(apiUrl(baseurl, '/getuploadurl'), token, { ...req }, 15000, signal)
  return data as GetUploadUrlResponse
}

// ===== 输入状态 =====

export async function getConfig(
  baseurl: string | undefined,
  token: string,
  ilinkUserId: string,
  contextToken?: string,
  signal?: AbortSignal
): Promise<GetConfigResponse> {
  const { data } = await postJson(
    apiUrl(baseurl, '/getconfig'),
    token,
    { ilink_user_id: ilinkUserId, ...(contextToken ? { context_token: contextToken } : {}) },
    10000,
    signal
  )
  return data as GetConfigResponse
}

export async function sendTyping(
  baseurl: string | undefined,
  token: string,
  ilinkUserId: string,
  typingTicket: string,
  status: 1 | 2,
  signal?: AbortSignal
): Promise<void> {
  await postJson(
    apiUrl(baseurl, '/sendtyping'),
    token,
    { ilink_user_id: ilinkUserId, typing_ticket: typingTicket, status },
    10000,
    signal
  )
}

// ===== 会话开始/结束通知（尽力而为，失败忽略） =====

export async function notifyStart(baseurl: string | undefined, token: string, signal?: AbortSignal): Promise<void> {
  try {
    await postJson(apiUrl(baseurl, '/msg/notifystart'), token, {}, 10000, signal)
  } catch {
    /* 尽力而为 */
  }
}

export async function notifyStop(baseurl: string | undefined, token: string, signal?: AbortSignal): Promise<void> {
  try {
    await postJson(apiUrl(baseurl, '/msg/notifystop'), token, {}, 10000, signal)
  } catch {
    /* 尽力而为 */
  }
}
