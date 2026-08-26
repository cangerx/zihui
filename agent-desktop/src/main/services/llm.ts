import { getModelProvider } from './model-provider'
import { BrowserWindow } from 'electron'
import { recordUsage } from './usage-stats'
import {
  getCloudToken,
  getCloudGatewayUrl,
  getAllowCustomProvider,
  resolveCloudModelId,
  refreshCloudToken,
  notifyCloudAuthExpired,
  wasLastCloudTokenRefreshAuthFailure,
  CloudBalanceError,
} from './cloud-token'
import { normalizeApiBase } from './api-base-normalize'
import { getSetting } from './settings'
import { uploadDataUriToCloud } from './cloud-image-asset'
import {
  applyAnthropicStreamEvent,
  anthropicHeaders,
  isAnthropicType,
  parseAnthropicMessage,
  toAnthropicBody
} from './anthropic-protocol'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | any[]
  tool_call_id?: string
  tool_calls?: any[]
}

/**
 * 压实 tool_calls：上游流式常用 index=1 起编或夹空槽，稀疏数组在 for...of 里会扫到 undefined，
 * 随后读 toolCall.function 抛 "Cannot read properties of undefined (reading 'function')"。
 */
export function compactToolCalls(raw: unknown): any[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: any[] = []
  for (const tc of raw) {
    if (!tc || typeof tc !== 'object') continue
    if (!tc.function || typeof tc.function !== 'object') {
      tc.function = {
        name: String(tc.name || ''),
        arguments: typeof tc.arguments === 'string' ? tc.arguments : ''
      }
    }
    out.push(tc)
  }
  return out.length ? out : undefined
}

export interface LLMRequestOptions {
  providerIdOrBase?: string
  modelId: string
  messages: ChatMessage[]
  tools?: any[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
  signal?: AbortSignal
  /** OpenAI-compatible response_format, e.g. { type: 'json_object' } */
  response_format?: { type: string; [k: string]: any }
  /** When true (default), streaming chunks are forwarded via chat:stream.
   *  Set to false for background / non-chat LLM calls to avoid cross-talk. */
  notifyStream?: boolean
  streamContext?: {
    conversationId?: string
    requestId?: string
    /** 后台 LLM 调用的流式增量回调（不经 chat:stream，由调用方自行推送到专用频道，如 AI PPT 大纲流式） */
    onContent?: (piece: string) => void
    onReasoning?: (piece: string) => void
  }
  /**
   * 允许「已产出部分内容后断流」的整次重试。默认 false：有 UI 时重发会让用户看到重复内容。
   * 桥接/后台场景（window=null，如微信 ClawBot）无 UI 重复副作用，应传 true——
   * 否则多轮工具循环里任一轮断流即整轮判死（无人值守场景被放大成高频报错）。
   */
  allowPartialRetry?: boolean
}

export class AbortedError extends Error {
  constructor() {
    super('Aborted')
    this.name = 'AbortedError'
  }
}

class LLMHttpError extends Error {
  status: number

  constructor(status: number, body: string) {
    super(`LLM API error ${status}: ${body}`)
    this.status = status
  }
}

// 把上游 402 响应抠成中文「余额不足」错误（CloudBalanceError，code=INSUFFICIENT_BALANCE）。
// 网关真·余额不足在预检阶段就返回 402，这里统一转成中文，避免各 callLLM 调用方
// （识图 / 提示词优化 / 会话总结 / 头像生成等非对话路径）把后端英文原样透传给用户。
// 兼容新老网关：优先读 balance_type 字段，老网关无该字段时按英文文案回退判断额度类型。
function makeBalanceError(errorText: string): CloudBalanceError {
  let data: any = {}
  try {
    data = JSON.parse(errorText) || {}
  } catch {
    /* 非 JSON 响应：保持空对象，走文案兜底 */
  }
  const balanceType: 'token' | 'credit' =
    data.balance_type === 'token'
      ? 'token'
      : data.balance_type === 'credit'
        ? 'credit'
        : /token/i.test(errorText)
          ? 'token'
          : 'credit'
  const label = balanceType === 'token' ? '金币' : '积分'
  return new CloudBalanceError(`云端${label}余额不足，请充值或购买套餐后重试`, {
    balanceType,
    needed: Number(data.needed || 0),
    current: Number(data.current || 0),
  })
}

export function isAbortedError(err: any): boolean {
  if (!err) return false
  if (err instanceof AbortedError) return true
  if (err.name === 'AbortError') return true
  if (err.cause?.name === 'AbortError') return true
  const code = err.cause?.code || err.code
  return code === 'ABORT_ERR'
}

export interface LLMResponse {
  content: string
  tool_calls?: any[]
  finish_reason: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  /** 推理模型(DeepSeek-R1/QwQ/o 系列等)的思维链；仅用于 UI 展示，不回传模型、不入库 */
  reasoning?: string
}

function getProviderConfig(providerId: string) {
  const provider = getModelProvider(providerId)
  if (!provider) throw new Error(`Model provider not found: ${providerId}`)
  return { apiBase: provider.api_base, apiKey: provider.api_key, type: provider.type }
}

const RETRYABLE_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'EPIPE'
])

function isTransientFetchError(err: any): boolean {
  if (!err) return false
  const cause = err.cause
  if (cause?.code && RETRYABLE_CODES.has(cause.code)) return true
  const msg = String(err.message || err).toLowerCase()
  return msg.includes('fetch failed') || msg.includes('etimedout') || msg.includes('econnreset') || msg.includes('socket hang up')
}

// undici 在 SSE 流读取过程中被对端关闭时抛 `TypeError: terminated`，
// cause 一般是 SocketError(UND_ERR_SOCKET) 或 message 含 'other side closed'。
// 这类错误说明响应阶段被中断，可在尚未产生任何输出时安全重试整条请求。
function isStreamTerminatedError(err: any): boolean {
  if (!err) return false
  const cause = err.cause
  const code = cause?.code || err.code
  if (code === 'UND_ERR_SOCKET' || code === 'UND_ERR_BODY_TIMEOUT' || code === 'ECONNRESET' || code === 'EPIPE') return true
  const name = String(err.name || '').toLowerCase()
  const msg = String(err.message || '').toLowerCase()
  if (name === 'typeerror' && msg === 'terminated') return true
  if (msg.includes('other side closed')) return true
  return false
}

// 本机网络不可用类错误（断网 / DNS 解析失败 / 拒绝连接），区别于"上游中途断流"。
// 给这类错误单独的中文提示，引导用户检查本地网络而非反复重试。
const OFFLINE_CODES = new Set(['ENETUNREACH', 'EAI_AGAIN', 'ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH'])
function isOfflineError(err: any): boolean {
  if (!err) return false
  const code = err.cause?.code || err.code
  if (code && OFFLINE_CODES.has(code)) return true
  const msg = String(err.message || err).toLowerCase()
  return msg.includes('enotfound') || msg.includes('eai_again') || msg.includes('enetunreach') || msg.includes('econnrefused')
}

function describeFetchError(err: any): string {
  if (!err) return 'unknown fetch error'
  const cause = err.cause
  const head = err.message || String(err)
  const code = cause?.code || cause?.errno
  const causeMsg = cause?.message && cause.message !== head ? cause.message : ''
  if (code && causeMsg) return `${head} [${code}]: ${causeMsg}`
  if (code) return `${head} [${code}]`
  if (causeMsg) return `${head}: ${causeMsg}`
  return head
}

async function fetchWithRetry(url: string, init: RequestInit, retries = 2): Promise<Response> {
  let lastErr: any
  const signal = init.signal as AbortSignal | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, init)
      if ((resp.status === 502 || resp.status === 503 || resp.status === 504 || resp.status === 524 || resp.status === 429) && attempt < retries) {
        // 429 尊重 Retry-After（秒，封顶 15s）；其余 5xx 指数退避
        const retryAfter = resp.status === 429 ? Number(resp.headers.get('retry-after')) : NaN
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 15000)
          : 500 * Math.pow(2, attempt)
        console.log(`[llm] fetch ${resp.status} attempt ${attempt + 1}/${retries + 1}, retry in ${delay}ms`)
        await new Promise(r => setTimeout(r, delay))
        if (signal?.aborted) throw new AbortedError()
        continue
      }
      return resp
    } catch (err: any) {
      lastErr = err
      if (signal?.aborted) throw new AbortedError()
      // Never retry user-initiated abort
      if (isAbortedError(err)) throw new AbortedError()
      if (attempt < retries && isTransientFetchError(err)) {
        const delay = 500 * Math.pow(2, attempt)
        console.log(`[llm] fetch attempt ${attempt + 1}/${retries + 1} failed (${describeFetchError(err)}), retry in ${delay}ms`)
        await new Promise(r => setTimeout(r, delay))
        if (signal?.aborted) throw new AbortedError()
        continue
      }
      break
    }
  }
  const enriched = new Error(describeFetchError(lastErr))
  ;(enriched as any).cause = lastErr
  throw enriched
}

/**
 * 视觉发图换 URL：把 messages 里以 dataURI / 裸 base64 内联的图片，统一上传云控端换成
 * https URL 再发给模型。覆盖图生词 / 聊天看图 / 画布关键帧分析等视觉输入场景——链路与
 * 上游日志不再夹带大段 base64；vision 接口原生支持 image_url 传 http URL，无协议障碍。
 * http(s) URL 原样保留；单张上传失败时回退原内联值，不阻断对话。
 */
async function materializeMessageImages(messages: ChatMessage[]): Promise<ChatMessage[]> {
  let changed = false
  const out = await Promise.all(messages.map(async (msg) => {
    if (!Array.isArray(msg.content)) return msg
    let partChanged = false
    const parts = await Promise.all(msg.content.map(async (part: any) => {
      if (part?.type !== 'image_url' || typeof part?.image_url?.url !== 'string') return part
      const url: string = part.image_url.url
      if (/^https?:\/\//i.test(url)) return part
      try {
        const cloudUrl = await uploadDataUriToCloud(url)
        if (cloudUrl && cloudUrl !== url) {
          partChanged = true
          return { ...part, image_url: { ...part.image_url, url: cloudUrl } }
        }
      } catch (e: any) {
        console.warn('[LLM] 视觉图上传云端换 URL 失败，回退内联 base64：', e?.message || e)
      }
      return part
    }))
    if (partChanged) { changed = true; return { ...msg, content: parts } }
    return msg
  }))
  return changed ? out : messages
}

export async function callLLM(
  providerId: string,
  options: LLMRequestOptions,
  window?: BrowserWindow | null
): Promise<LLMResponse> {
  let url: string
  let apiKey: string

  // 渲染层传进来的 modelId 在云端 provider 下可能是复合 key `{model_id}#@{provider_name}`，
  // 用于标识用户实际选择的服务商；上游 OpenAI 协议只认纯 model_id，路由用 cloud_model_id 透传。
  const isCloud = providerId.startsWith('cloud:')
  let bodyModelId = options.modelId
  let cloudModelId: number | null = null
  if (isCloud) {
    const resolved = resolveCloudModelId(options.modelId, 'chat')
    bodyModelId = resolved.pureModelId
    cloudModelId = resolved.cloudModelId
  }

  const localType = isCloud ? '' : getProviderConfig(providerId).type
  const useAnthropic = !isCloud && isAnthropicType(localType)

  if (isCloud) {
    // Cloud model: route through cloud gateway
    const token = getCloudToken()
    if (!token) throw new Error('Cloud login required')
    url = `${getCloudGatewayUrl()}/chat/completions`
    apiKey = token
  } else {
    if (!getCloudToken()) {
      throw new Error('Cloud login required')
    }
    if (!getAllowCustomProvider()) {
      throw new Error('Custom provider is disabled by admin')
    }
    const config = getProviderConfig(providerId)
    url = useAnthropic
      ? `${normalizeApiBase(config.apiBase)}/messages`
      : `${normalizeApiBase(config.apiBase)}/chat/completions`
    apiKey = config.apiKey
  }

  // 视觉发图换 URL：仅云端模型下，把 messages 里内联的 dataURI/base64 图片先上传云控端换
  // https URL 再发，不再内联 base64。自定义直连 provider 保持原样（不引入云控端依赖，
  // 与「自定义模型完全不碰」的策略一致）。
  const outboundMessages = isCloud
    ? await materializeMessageImages(options.messages)
    : options.messages

  const body: any = useAnthropic
    ? toAnthropicBody({ ...options, messages: outboundMessages }, bodyModelId)
    : {
        model: bodyModelId,
        messages: outboundMessages,
        stream: options.stream ?? false
      }
  // 云端网关按 cloud_model_id 主键精确路由到具体服务商，避免同 model_id 多家时 first() 错位
  if (isCloud && cloudModelId !== null) {
    body.cloud_model_id = cloudModelId
  }

  if (!useAnthropic) {
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools
    }
    if (options.temperature !== undefined) {
      body.temperature = options.temperature
    }
    if (options.max_tokens !== undefined) {
      body.max_tokens = options.max_tokens
    }
    if (options.response_format) {
      body.response_format = options.response_format
    }
  }

  const headers: Record<string, string> = useAnthropic
    ? anthropicHeaders(apiKey)
    : { 'Content-Type': 'application/json' }
  if (!useAnthropic && apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  const refreshCloudHeaders = async (reason: string): Promise<boolean> => {
    if (!isCloud) return false
    const token = await refreshCloudToken()
    if (!token) {
      if (wasLastCloudTokenRefreshAuthFailure()) notifyCloudAuthExpired(reason)
      return false
    }
    headers['Authorization'] = `Bearer ${token}`
    return true
  }

  if (options.stream) {
    const notify = options.notifyStream !== false
    const allowPartialRetry = options.allowPartialRetry === true
    try {
      return await streamLLM(url, headers, body, window ?? null, providerId, options.modelId, options.signal, notify, options.streamContext, allowPartialRetry, useAnthropic)
    } catch (e: any) {
      if (e instanceof LLMHttpError && e.status === 401 && await refreshCloudHeaders(e.message)) {
        return streamLLM(url, headers, body, window ?? null, providerId, options.modelId, options.signal, notify, options.streamContext, allowPartialRetry, useAnthropic)
      }
      throw e
    }
  }

  let response = await fetchWithRetry(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options.signal
  })

  if (response.status === 401 && await refreshCloudHeaders('LLM API error 401')) {
    response = await fetchWithRetry(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal
    })
  }

  if (!response.ok) {
    const errorText = await response.text()
    if (response.status === 402) {
      if (providerId.startsWith('cloud:')) throw makeBalanceError(errorText)
      throw new LLMHttpError(response.status, `自定义服务商计费错误（402），请检查该服务商账户余额/额度。原始信息：${errorText.slice(0, 200)}`)
    }
    throw new LLMHttpError(response.status, errorText)
  }

  const data = await response.json()
  if (useAnthropic) {
    const parsed = parseAnthropicMessage(data)
    if (parsed.usage) {
      try {
        recordUsage(
          providerId,
          options.modelId,
          parsed.usage.prompt_tokens || 0,
          parsed.usage.completion_tokens || 0,
          parsed.usage.total_tokens || 0
        )
      } catch {}
    }
    return parsed
  }
  const choice = data.choices?.[0]

  if (data.usage) {
    try {
      recordUsage(
        providerId,
        options.modelId,
        data.usage.prompt_tokens || 0,
        data.usage.completion_tokens || 0,
        data.usage.total_tokens || 0
      )
    } catch {}
  }

  return {
    content: choice?.message?.content || '',
    tool_calls: compactToolCalls(choice?.message?.tool_calls),
    finish_reason: choice?.finish_reason || 'stop',
    usage: data.usage
  }
}

// 流式请求最多重试次数（仅在尚未产生任何输出且错误属于连接中断类时生效）。
const MAX_STREAM_RETRIES = 2

// LLM 流式静默超时：连续 N 秒未收到任何 chunk 就认为连接已悄悄断开。
// 用 reader.cancel() 主动断流 → 抛错；外层若尚未推送过 token 会自动重试整条请求，
// 已推送过则降级为友好错误（连接被中断）。
// 默认 90s（旧版 60s），可由用户在设置里用 stream_idle_timeout_ms 覆盖（钳制 30s~600s），
// 避免推理模型长时间思考被误判为断线。
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 90_000
// 已观察到推理思维链(reasoning)后，模型可能在两段思考之间静默更久，放宽到至少该值。
const REASONING_IDLE_TIMEOUT_MS = 180_000

function resolveStreamIdleTimeout(): number {
  try {
    const raw = getSetting('stream_idle_timeout_ms')
    if (raw) {
      const n = parseInt(String(raw), 10)
      if (Number.isFinite(n) && n > 0) return Math.max(30_000, Math.min(n, 600_000))
    }
  } catch {
    /* 读取失败用默认值 */
  }
  return DEFAULT_STREAM_IDLE_TIMEOUT_MS
}

async function streamLLM(
  url: string,
  headers: Record<string, string>,
  body: any,
  window: BrowserWindow | null,
  providerId: string,
  modelId: string,
  signal?: AbortSignal,
  notifyStream = true,
  streamContext?: LLMRequestOptions['streamContext'],
  allowPartialRetry = false,
  useAnthropic = false
): Promise<LLMResponse> {
  if (!useAnthropic) {
    body.stream_options = { include_usage: true }
  }

  let attempt = 0
  let lastErr: any
  // 空流(silent-200)单独限流：最多额外重试 1 次，区分"网关偶发抖动"与"确实余额不足/限流"，
  // 避免对真欠费场景反复打满重试浪费用户时间。
  let emptyStreamRetried = false
  while (attempt <= MAX_STREAM_RETRIES) {
    if (signal?.aborted) throw new AbortedError()
    try {
      return await streamLLMOnce(url, headers, body, window, providerId, modelId, signal, notifyStream, streamContext, useAnthropic)
    } catch (err: any) {
      if (isAbortedError(err)) throw err
      lastErr = err
      // 已经向 renderer 推送过 content/tool_call 时，重发整条请求会让 UI 出现重复内容，
      // 此时只能降级为友好错误，由用户手动重试。
      // 桥接/后台场景（allowPartialRetry）无 UI 重复副作用，允许已产出断流整次重试。
      const hadOutput = (err as any).__streamHadOutput === true
      const idleTimeout = (err as any).__streamIdleTimeout === true
      const emptyStream = (err as any).__emptyStream === true
      let retryable =
        (!hadOutput || allowPartialRetry) &&
        (idleTimeout || isStreamTerminatedError(err) || isTransientFetchError(err))
      // 空流补一次重试（仅一次）
      if (!retryable && emptyStream && !emptyStreamRetried) {
        retryable = true
        emptyStreamRetried = true
      }
      if (!retryable || attempt >= MAX_STREAM_RETRIES) break
      const delay = 500 * Math.pow(2, attempt)
      console.log(`[llm] stream attempt ${attempt + 1}/${MAX_STREAM_RETRIES + 1} terminated (${describeFetchError(err)}), retry in ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
      attempt++
    }
  }

  // 重试耗尽或本身就不可重试。对连接中断类错误抠成中文友好提示，
  // 避免上层把裸 `terminated` 写进 DB 让用户摸不着头脑。
  // 先识别"本机断网"：给更准确的引导（检查网络）而非泛化的"连接被中断"。
  if (isOfflineError(lastErr)) {
    const offline: any = new Error('网络连接不可用，请检查本机网络后重试')
    offline.cause = lastErr
    if (lastErr?.__partialContent) offline.__partialContent = lastErr.__partialContent
    if (lastErr?.__partialToolCalls) offline.__partialToolCalls = lastErr.__partialToolCalls
    throw offline
  }
  if (isStreamTerminatedError(lastErr) || isTransientFetchError(lastErr)) {
    const friendly: any = new Error('与模型服务的连接被中断，请稍后重试（terminated）')
    friendly.cause = lastErr
    // 透传部分内容，让 chat-engine 把已生成的半截回答连同中断标记一起落库
    if (lastErr?.__partialContent) friendly.__partialContent = lastErr.__partialContent
    if (lastErr?.__partialToolCalls) friendly.__partialToolCalls = lastErr.__partialToolCalls
    throw friendly
  }
  throw lastErr
}

async function streamLLMOnce(
  url: string,
  headers: Record<string, string>,
  body: any,
  window: BrowserWindow | null,
  providerId: string,
  modelId: string,
  signal?: AbortSignal,
  notifyStream = true,
  streamContext?: LLMRequestOptions['streamContext'],
  useAnthropic = false
): Promise<LLMResponse> {
  // 等头看门狗：头部到达前是防护盲区（idle 看门狗要等 reader 创建后才 arm），
  // undici 默认 headersTimeout≈300s 还会被内外层重试叠乘到数十分钟——
  // 用与流式静默同口径的超时（默认 90s，可配）主动掐断等头阶段。
  const headIdleMs = resolveStreamIdleTimeout()
  const headCtrl = new AbortController()
  let headTimedOut = false
  const onExternalAbort = (): void => headCtrl.abort()
  if (signal) {
    if (signal.aborted) headCtrl.abort()
    else signal.addEventListener('abort', onExternalAbort, { once: true })
  }
  const headTimer = setTimeout(() => { headTimedOut = true; headCtrl.abort() }, headIdleMs)
  let response: Response
  try {
    response = await fetchWithRetry(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: headCtrl.signal
    })
  } catch (e: any) {
    if (headTimedOut) {
      const err: any = new Error(`与模型服务连接静默超过 ${Math.round(headIdleMs / 1000)} 秒，已断开（等待响应头）`)
      err.__streamIdleTimeout = true
      throw err
    }
    throw e
  } finally {
    clearTimeout(headTimer)
    signal?.removeEventListener('abort', onExternalAbort)
  }

  if (!response.ok) {
    const errorText = await response.text()
    if (response.status === 402) {
      // 「余额不足」文案只对云端网关成立；自定义直连上游的 402 是厂商自己的计费错误
      if (providerId.startsWith('cloud:')) throw makeBalanceError(errorText)
      throw new LLMHttpError(response.status, `自定义服务商计费错误（402），请检查该服务商账户余额/额度。原始信息：${errorText.slice(0, 200)}`)
    }
    // 必须抛带 status 的 LLMHttpError：callLLM 流式分支的 401 刷新重放链据此判定
    //（此前抛裸 Error 导致 instanceof 恒 false，401 自愈链形同虚设）
    throw new LLMHttpError(response.status, errorText)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  // If user aborts mid-stream, cancel the reader to release the network socket.
  const onAbort = () => {
    try { reader.cancel() } catch {}
  }
  if (signal) {
    if (signal.aborted) {
      try { reader.cancel() } catch {}
      throw new AbortedError()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }

  const decoder = new TextDecoder()
  let fullContent = ''
  let reasoningContent = ''
  let toolCalls: any[] = []
  let finishReason = 'stop'
  let buffer = ''
  let usage: any = null

  // Stream idle watchdog：连续静默超时就 reader.cancel() 主动断开，
  // 让下面的 reader.read() 抛错；catch 里识别 idleTimedOut 并贴标签由外层决定重试 / 报错。
  // 一旦见过 reasoning chunk，放宽窗口，避免推理模型分段思考时被误杀。
  const baseIdleTimeout = resolveStreamIdleTimeout()
  let sawReasoning = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let idleTimedOut = false
  const armIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    const ms = sawReasoning ? Math.max(baseIdleTimeout, REASONING_IDLE_TIMEOUT_MS) : baseIdleTimeout
    idleTimer = setTimeout(() => {
      idleTimedOut = true
      try { reader.cancel(new Error('LLM stream idle timeout')) } catch {}
    }, ms)
  }
  const disarmIdle = (): void => {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = undefined
    }
  }
  armIdle()

  try {
  while (true) {
    if (signal?.aborted) throw new AbortedError()
    const { done, value } = await reader.read()
    armIdle()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6)
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)

        if (useAnthropic) {
          const anthState = {
            fullContent,
            reasoningContent,
            toolCalls,
            finishReason,
            usage
          }
          const applied = applyAnthropicStreamEvent(parsed, anthState)
          fullContent = anthState.fullContent
          reasoningContent = anthState.reasoningContent
          finishReason = anthState.finishReason
          usage = anthState.usage
          if (applied.error) {
            const ge: any = new Error(applied.error)
            ge.__gatewayStreamError = true
            throw ge
          }
          if (applied.reasoningPiece) {
            sawReasoning = true
            streamContext?.onReasoning?.(applied.reasoningPiece)
            if (window && notifyStream) {
              window.webContents.send('chat:stream', {
                type: 'reasoning',
                content: applied.reasoningPiece,
                conversationId: streamContext?.conversationId,
                requestId: streamContext?.requestId
              })
            }
          }
          if (applied.contentPiece) {
            streamContext?.onContent?.(applied.contentPiece)
            if (window && notifyStream) {
              window.webContents.send('chat:stream', {
                type: 'content',
                content: applied.contentPiece,
                conversationId: streamContext?.conversationId,
                requestId: streamContext?.requestId
              })
            }
          }
          continue
        }

        // 上游 / 网关错误事件:OpenAI 流式协议与本网关在失败时都会下发 data: {"error":{...}}。
        // 网关已把上游空响应 / 限流 / 4xx-5xx 统一翻译成中文 error 事件注入流内,
        // 据此抛出精确错误(区别于"静默空流"),由外层 catch 透传给用户,避免被误判为"无响应"。
        if (parsed.error) {
          const detail =
            typeof parsed.error === 'string'
              ? parsed.error
              : parsed.error.message || parsed.error.error || JSON.stringify(parsed.error)
          const ge: any = new Error(String(detail))
          ge.__gatewayStreamError = true
          throw ge
        }

        const delta = parsed.choices?.[0]?.delta
        const reason = parsed.choices?.[0]?.finish_reason

        if (reason) finishReason = reason

        if (parsed.usage) {
          usage = parsed.usage
        }

        // 推理模型思维链：DeepSeek 系用 reasoning_content，部分上游用 reasoning。
        // 实时单独推给 renderer 展示（折叠「思考中」面板）；思维链 chunk 也会触发下方 armIdle，
        // 故长时间思考不会被 60s 静默超时误杀。不并入 content、不回传模型、不入库。
        const reasoningPiece = delta?.reasoning_content ?? delta?.reasoning
        if (reasoningPiece) {
          sawReasoning = true
          reasoningContent += reasoningPiece
          streamContext?.onReasoning?.(reasoningPiece)
          if (window && notifyStream) {
            window.webContents.send('chat:stream', {
              type: 'reasoning',
              content: reasoningPiece,
              conversationId: streamContext?.conversationId,
              requestId: streamContext?.requestId
            })
          }
        }

        if (delta?.content) {
          fullContent += delta.content
          streamContext?.onContent?.(delta.content)
          if (window && notifyStream) {
            window.webContents.send('chat:stream', {
              type: 'content',
              content: delta.content,
              conversationId: streamContext?.conversationId,
              requestId: streamContext?.requestId
            })
          }
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!tc || typeof tc !== 'object') continue
            const idx = tc.index ?? 0
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } }
            }
            if (tc.id) toolCalls[idx].id = tc.id
            if (tc.function?.name) toolCalls[idx].function.name += tc.function.name
            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments
          }
        }
      } catch (e: any) {
        // 网关/上游错误事件需向上抛出（区别于"跳过格式错误的 JSON 行"）
        if (e?.__gatewayStreamError) throw e
        // skip malformed JSON
      }
    }
  }
  } catch (err: any) {
    disarmIdle()
    // 把已流式产出的部分内容 / 工具调用附到 error 上，供外层(chat-engine)在中断或报错时落库，
    // 避免用户已经看到的半截回答在刷新后被 [已中断]/[Error] 覆盖丢失。
    // 「是否已向用户推送过可见内容」决定能否整条重试：content/reasoning 已推送过 → 重发会让 UI 重复；
    // 而 tool_calls 只在内存累积、从未推给渲染端（工具面板等整轮返回才显示），
    // 纯 tool_calls 阶段断流时整条重试对用户零副作用——不置 __streamHadOutput。
    const hadVisibleOutput = fullContent.length > 0 || reasoningContent.length > 0
    const attachPartial = (e: any): any => {
      if (fullContent) e.__partialContent = fullContent
      const partialCalls = compactToolCalls(toolCalls)
      if (partialCalls) e.__partialToolCalls = partialCalls
      if (hadVisibleOutput) e.__streamHadOutput = true
      return e
    }
    if (idleTimedOut) {
      const idleSec = Math.round((sawReasoning ? Math.max(baseIdleTimeout, REASONING_IDLE_TIMEOUT_MS) : baseIdleTimeout) / 1000)
      const idleErr: any = new Error(`与模型服务连接静默超过 ${idleSec} 秒，已断开`)
      idleErr.cause = err
      idleErr.__streamIdleTimeout = true
      throw attachPartial(idleErr)
    }
    if (signal?.aborted || isAbortedError(err)) throw attachPartial(new AbortedError())
    throw attachPartial(err)
  } finally {
    disarmIdle()
    if (signal) signal.removeEventListener('abort', onAbort)
  }

  // idle 看门狗触发的断流必须在这里显式抛错：reader.cancel() 按 WHATWG Streams 规范
  // 会让挂起的 read() 以 {done:true} 正常 resolve——循环干净退出、catch 不执行，
  // 不补这一刀的话半截内容会被当成成功响应落库（无标记、无重试、无「继续生成」入口）。
  if (idleTimedOut) {
    const idleSec = Math.round((sawReasoning ? Math.max(baseIdleTimeout, REASONING_IDLE_TIMEOUT_MS) : baseIdleTimeout) / 1000)
    const idleErr: any = new Error(`与模型服务连接静默超过 ${idleSec} 秒，已断开`)
    idleErr.__streamIdleTimeout = true
    if (fullContent) idleErr.__partialContent = fullContent
    const partialCalls = compactToolCalls(toolCalls)
    if (partialCalls) idleErr.__partialToolCalls = partialCalls
    // 同 catch 内口径：只有「可见产出」(content/reasoning) 才阻止外层整条重试
    if (fullContent.length > 0 || reasoningContent.length > 0) idleErr.__streamHadOutput = true
    throw idleErr
  }

  // silent-200 / 空流识别:HTTP 200 但整条流无任何有效产出(无正文 / 工具调用 / 思维链 / 用量)。
  // 成因是上游限流 / 网关静默失败 / 个别模型 silent-200，与本地余额无关
  // （真·余额不足在网关预检阶段已返回 402，根本到不了这里）。
  // 故文案不再臆测"余额不足"，避免误导用户去查余额。抛友好错误并打 __emptyStream 标记，
  // 由 streamLLM 决定是否补一次重试，同时避免上层把空内容落库毒化会话历史(bug3)。
  if (!fullContent && !compactToolCalls(toolCalls) && !reasoningContent && !usage) {
    const e: any = new Error('模型未返回任何内容（可能上游限流或服务波动），请稍后重试')
    e.__emptyStream = true
    throw e
  }

  if (window && notifyStream) {
    window.webContents.send('chat:stream', { type: 'done', conversationId: streamContext?.conversationId, requestId: streamContext?.requestId })
  }

  if (usage) {
    try {
      recordUsage(
        providerId,
        modelId,
        usage.prompt_tokens || 0,
        usage.completion_tokens || 0,
        usage.total_tokens || 0
      )
    } catch {}
  }

  // tool_call 空 id 兜底：部分上游不下发 id，空 id 会让严格 OpenAI 兼容端 400、
  // 且跨轮回放时配对过滤把自洽的工具结果一并丢弃（工具白做）
  for (const tc of toolCalls) {
    if (tc && !tc.id) tc.id = `call_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    if (tc && '_blockIndex' in tc) delete tc._blockIndex
  }

  return {
    content: fullContent,
    tool_calls: compactToolCalls(toolCalls),
    finish_reason: finishReason,
    usage,
    reasoning: reasoningContent || undefined
  }
}
