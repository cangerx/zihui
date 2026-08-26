// 出站回复：markdown 降级清洗 + 长文分段 + 图片抽取（local-file/http）→ 微信 CDN 上传发图。
// 微信侧规则（官方 markdown-filter / send.ts）：
//   - 协议只有 TEXT item，没有 markdown；图片语法整体删除，图片单独走 CDN 上传后发 IMAGE item。
//   - 链接不可点击 → [text](url) 转成 `text: url` 纯文本可读形式。
//   - sendmessage 缺任一必填字段会 HTTP 200 但静默丢失 → 由 ilink-api.buildOutboundMessage 断言。
//   - 每条媒体 item 单独一个 sendmessage 请求（独立 client_id）。

import { readFile } from 'fs/promises'
import { nativeImage } from 'electron'
import { isAbsolute, relative, resolve } from 'path'
import { assertSendResponse, buildOutboundMessage, getUploadUrl, ILinkSendError, sendMessage } from './ilink-api'
import { prepareUpload, uploadEncryptedMedia } from './ilink-cdn'
import { MESSAGE_ITEM_TYPE, UPLOAD_MEDIA_TYPE } from './ilink-types'
import type { ClawbotConnection } from './clawbot-store'
import { getDataDir } from '../data-path'

/** 发送间隔（社区经验值：>1s，防风控；限流实证后放宽到 2s） */
const SEND_INTERVAL_MS = 2000
/** 长文分段阈值（协议无官方上限，防御性分段） */
const TEXT_SEGMENT_MAX = 1800
/** 单条回复最多回传的图片数 */
const MAX_OUTBOUND_IMAGES = 4
/** http 图片下载超时 */
const IMAGE_DOWNLOAD_TIMEOUT_MS = 8000
const IMAGE_MAX_BYTES = 20 * 1024 * 1024
const IMAGE_MAX_SIDE = 4096

// ===== 服务端拒发（ret=-2）熔断器 =====
// 社区实证：ret=-2 = 限流（rate limited）或 context_token 失效（prepare failed）。
// 两种形态下立刻重试都只会加重拒绝（重试风暴），正确做法是停手退避：
// 限流等窗口恢复，token 失效等用户下一条入站刷新。熔断期内发送快速失败，不打服务端。
let consecutiveDeclines = 0
let circuitOpenUntil = 0

/** 熔断基准 60s，按连续拒发次数线性加长（60s/120s/180s），封顶 5 分钟 */
function noteSendDeclined(): void {
  consecutiveDeclines++
  circuitOpenUntil = Date.now() + Math.min(5 * 60_000, 60_000 * consecutiveDeclines)
}

function noteSendOk(): void {
  consecutiveDeclines = 0
  circuitOpenUntil = 0
}

/** 熔断开启中（ret=-2 退避期）：发送快速失败，等窗口恢复/token 刷新 */
export class SendCircuitOpenError extends Error {
  constructor(public readonly remainingMs: number) {
    super(`服务端拒发退避中（剩余 ${Math.ceil(remainingMs / 1000)}s）`)
    this.name = 'SendCircuitOpenError'
  }
}

/** 熔断是否开启中（图片级重试等据此跳过，不烧重试预算） */
export function isSendCircuitOpen(): boolean {
  return Date.now() < circuitOpenUntil
}

function checkCircuit(): void {
  const remain = circuitOpenUntil - Date.now()
  if (remain > 0) throw new SendCircuitOpenError(remain)
}

let lastSendAt = 0
let sendChain: Promise<void> = Promise.resolve()

/** 全局限速门：串行化 + 任意两次 ilink 写请求之间至少间隔 SEND_INTERVAL_MS（多 peer 并发下也不会挤在一起） */
function sendGate(): Promise<void> {
  const run = sendChain.then(async () => {
    const wait = SEND_INTERVAL_MS - (Date.now() - lastSendAt)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastSendAt = Date.now()
  })
  sendChain = run.catch(() => {})
  return run
}

// ===== markdown 降级 =====

export interface OutboundImage {
  alt: string
  url: string
  /** 在原始消息图片序列中的下标（重试时派生 client_id 用——防失败子表重编号后与已发图片撞 id） */
  origIdx?: number
}

/**
 * 抽出 markdown 图片引用（![alt](url)），在清洗前调用。
 * alt 用非贪婪 `[\s\S]*?`：LLM 补全的英文提示词常含 [4k] 等方括号标签，
 * 旧的 `[^\]]*` 遇 ']' 即止导致整体失配——图不抽取且图片语法原样泄漏进微信。
 */
export function extractMarkdownImages(text: string): OutboundImage[] {
  const out: OutboundImage[] = []
  const re = /!\[([\s\S]*?)\]\(([^)\s]+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push({ alt: m[1] || '', url: m[2] })
  return out
}

/**
 * markdown → 微信纯文本（照官方降级规则）：
 * 保留代码块/行内代码/表格/粗体/水平线；剥标题标记与 CJK 斜体标记；
 * 图片语法整体删除（单独发图）；链接转 `text: url`。
 */
export function stripMarkdownForWechat(text: string): string {
  let s = text
  // 图片语法整体删除（与 extractMarkdownImages 同款正则，避免失配残留）
  s = s.replace(/!\[([\s\S]*?)\]\(([^)\s]+)\)/g, '')
  // H1-H6 标题标记剥除（保留标题文字）
  s = s.replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
  // CJK 斜体标记剥除：*含中日韩的文字* → 文字（粗体 ** 保留，与官方一致）
  s = s.replace(/(?<![*\w])\*([^*\n]*[一-鿿][^*\n]*)\*(?!\*)/g, '$1')
  // 链接转纯文本（微信侧不可点击，转成可读形式）
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1: $2')
  // 连续空行收敛
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

/** 按段落分段，单段 ≤1800 字；超长段落先按行切再硬切 */
export function segmentText(text: string, maxLen = TEXT_SEGMENT_MAX): string[] {
  const segments: string[] = []
  let cur = ''
  const pushCur = (): void => {
    const t = cur.trim()
    if (t) segments.push(t)
    cur = ''
  }
  for (const para of text.split(/\n{2,}/)) {
    if (para.length > maxLen) {
      pushCur()
      let rest = para
      while (rest.length > maxLen) {
        let cut = rest.lastIndexOf('\n', maxLen)
        if (cut < maxLen * 0.5) cut = maxLen
        const piece = rest.slice(0, cut).trim()
        if (piece) segments.push(piece)
        rest = rest.slice(cut)
      }
      cur = rest
      continue
    }
    if ((cur + '\n\n' + para).trim().length > maxLen) pushCur()
    cur = cur ? `${cur}\n\n${para}` : para
  }
  pushCur()
  return segments
}

// ===== 图片回传 =====

/** local-file://img?p=<encodeURIComponent(正斜杠绝对路径)> → 磁盘路径（image_gen 回显格式，core-tools.ts:962-968） */
export function resolveLocalFileUrl(url: string): string | null {
  if (!url.startsWith('local-file://')) return null
  try {
    const u = new URL(url)
    const p = u.searchParams.get('p')
    return p || null
  } catch {
    return null
  }
}

/**
 * 防外泄：local-file 只允许发送应用数据目录（getDataDir）内的文件。
 * 回复文本来自模型输出，可能被微信用户 prompt-injection 诱导引用任意磁盘文件
 * （如 ![x](local-file://img?p=C:/Windows/...)），不限制就是把读盘能力暴露给微信对端。
 */
function isLocalPathAllowedForSend(absPath: string): boolean {
  try {
    const root = resolve(getDataDir())
    const p = resolve(absPath)
    const c = process.platform === 'win32' ? p.toLowerCase() : p
    const r = process.platform === 'win32' ? root.toLowerCase() : root
    const rel = relative(r, c)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  } catch {
    return false
  }
}

/** 防 SSRF：http 图片下载拦截明显的内网/环回主机字面量（DNS  rebinding 不在此防御层级，注释说明） */
const PRIVATE_HOST_RE = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i

function isPrivateHost(url: string): boolean {
  try {
    return PRIVATE_HOST_RE.test(new URL(url).hostname)
  } catch {
    return true
  }
}

async function downloadHttpImage(url: string): Promise<Buffer | null> {
  if (isPrivateHost(url)) return null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS)
    try {
      const resp = await fetch(url, { signal: ctrl.signal })
      if (!resp.ok) return null
      const ab = await resp.arrayBuffer()
      const buf = Buffer.from(ab)
      // 防御：超大图不回传
      if (buf.length > IMAGE_MAX_BYTES) return null
      return buf
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

/** 图片 URL → Buffer：支持 local-file://（读盘，限数据目录内）与 http(s)（下载，拦内网主机），其余不支持 */
export async function loadImageBuffer(url: string): Promise<Buffer | null> {
  const localPath = resolveLocalFileUrl(url)
  if (localPath) {
    if (!isLocalPathAllowedForSend(localPath)) {
      console.warn('[clawbot] blocked local-file outside data dir:', localPath)
      return null
    }
    try {
      const buf = await readFile(localPath)
      return buf.length <= IMAGE_MAX_BYTES ? buf : null
    } catch {
      return null
    }
  }
  if (/^https?:\/\//i.test(url)) return downloadHttpImage(url)
  return null
}

/**
 * 微信上传前统一解码并转为基线 JPEG，规避上游返回 AVIF/WebP、异常 ICC/透明通道等
 * 在部分手机客户端无法展示的情况。这里只修正可验证的文件兼容性，不改动媒体协议字段。
 */
export function normalizeImageForWechat(input: Buffer): Buffer | null {
  try {
    if (!input.length || input.length > IMAGE_MAX_BYTES) return null
    let image = nativeImage.createFromBuffer(input)
    if (image.isEmpty()) return null
    const size = image.getSize()
    if (size.width < 1 || size.height < 1) return null
    if (Math.max(size.width, size.height) > IMAGE_MAX_SIDE) {
      const scale = IMAGE_MAX_SIDE / Math.max(size.width, size.height)
      image = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'best' })
    }
    const output = image.toJPEG(88)
    return output.length && output.length <= IMAGE_MAX_BYTES ? output : null
  } catch {
    return null
  }
}

export interface SendContext {
  conn: ClawbotConnection
  token: string
  peerId: string
  /** 该 peer 最新入站消息的 context_token（不可复用旧的） */
  contextToken: string
  signal?: AbortSignal
  /** 逻辑消息幂等键（可选）：分段/重试/图片共享同一前缀派生 client_id
   * （msgKey-t{N} / msgKey-i{N}），服务端可按 client_id 去重，防响应歧义重试造成重复投递 */
  msgKey?: string
  /** 分段断点（可选）：msgKey → 已确认送达的分段数。长回复分段发到一半失败时，
   *  重试/补发从断点继续，已发分段不重发（服务端 client_id 去重不可依赖，社区实证会失效） */
  segDone?: Map<string, number>
  /** 每成功发出一条（text/image）回调，用于写日志/计数 */
  onSent?: (kind: 'text' | 'image', summary: string) => void
}

async function sendTextSegment(ctx: SendContext, text: string, segIdx = 0): Promise<void> {
  checkCircuit()
  const msg = buildOutboundMessage({
    toUserId: ctx.peerId,
    contextToken: ctx.contextToken,
    itemList: [{ type: MESSAGE_ITEM_TYPE.TEXT, text_item: { text } }],
    clientId: ctx.msgKey ? `${ctx.msgKey}-t${segIdx}` : undefined
  })
  await sendGate()
  try {
    const resp = await sendMessage(ctx.conn.baseurl, ctx.token, msg, ctx.signal)
    // 官方语义：空 body/{} = 成功；ret/errcode 非零抛 ILinkSendError
    assertSendResponse(resp)
    noteSendOk()
  } catch (e) {
    if (e instanceof ILinkSendError && e.isDeclined) noteSendDeclined()
    throw e
  }
  ctx.onSent?.('text', text.slice(0, 200))
}

async function sendImageOnce(ctx: SendContext, buf: Buffer, imgIdx = 0): Promise<void> {
  checkCircuit()
  const normalized = normalizeImageForWechat(buf)
  if (!normalized) throw new Error('图片预检失败：无法解码或尺寸超限')
  const prepared = prepareUpload(normalized)
  // getuploadurl 同样过发送门 + 判业务 ret：社区实证限流时它也回 ret=-2（此前不判，
  // 响应无上传参数被误报「缺少上传参数」，且不触发熔断，图片重试循环持续打服务端）
  await sendGate()
  let up
  try {
    up = await getUploadUrl(ctx.conn.baseurl, ctx.token, {
      filekey: prepared.filekey,
      media_type: UPLOAD_MEDIA_TYPE.IMAGE,
      to_user_id: ctx.peerId,
      rawsize: prepared.rawsize,
      rawfilemd5: prepared.rawfilemd5,
      filesize: prepared.filesize,
      no_need_thumb: true,
      aeskey: prepared.aeskeyHex
    }, ctx.signal)
    assertSendResponse(up, 'getuploadurl')
  } catch (e) {
    console.warn('[clawbot] image stage=getuploadurl failed:', e instanceof Error ? e.name : 'UnknownError')
    if (e instanceof ILinkSendError && e.isDeclined) noteSendDeclined()
    throw e
  }
  if (!up.upload_full_url && !up.upload_param) {
    throw new Error('getuploadurl 响应缺少上传参数（未确认）')
  }
  let encryptQueryParam = ''
  try {
    encryptQueryParam = await uploadEncryptedMedia({ uploadFullUrl: up.upload_full_url, uploadParam: up.upload_param, filekey: prepared.filekey, cipher: prepared.cipher })
  } catch (e) {
    console.warn('[clawbot] image stage=upload failed:', e instanceof Error ? e.name : 'UnknownError')
    throw e
  }
  const msg = buildOutboundMessage({
    toUserId: ctx.peerId,
    contextToken: ctx.contextToken,
    itemList: [{
      type: MESSAGE_ITEM_TYPE.IMAGE,
      image_item: {
        media: {
          encrypt_query_param: encryptQueryParam,
          // 出站 aes_key 为 16 字节原始 key 的 base64
          aes_key: Buffer.from(prepared.aeskeyHex, 'hex').toString('base64'),
          encrypt_type: 1
        },
        mid_size: prepared.filesize
      }
    }],
    clientId: ctx.msgKey ? `${ctx.msgKey}-i${imgIdx}` : undefined
  })
  await sendGate()
  try {
    const resp = await sendMessage(ctx.conn.baseurl, ctx.token, msg, ctx.signal)
    assertSendResponse(resp, 'sendmessage(image)')
    noteSendOk()
  } catch (e) {
    console.warn('[clawbot] image stage=sendmessage failed:', e instanceof Error ? e.name : 'UnknownError')
    if (e instanceof ILinkSendError && e.isDeclined) noteSendDeclined()
    throw e
  }
  ctx.onSent?.('image', '[图片]')
}

/** 单张图发送：网络类失败隔 2s 重试一次；服务端拒发（ret=-2）/熔断期不原地重试（退避后由图片级重试驱动），仍败向上抛 */
async function sendImageWithRetry(ctx: SendContext, buf: Buffer, imgIdx = 0): Promise<void> {
  try {
    await sendImageOnce(ctx, buf, imgIdx)
  } catch (e) {
    if (ctx.signal?.aborted) throw e
    if (e instanceof SendCircuitOpenError) throw e
    if (e instanceof ILinkSendError && e.isDeclined) throw e
    await new Promise((r) => setTimeout(r, 2000))
    await sendImageOnce(ctx, buf, imgIdx)
  }
}

export interface OutboundSendResult {
  /** 成功发出的文本分段数 */
  textSegments: number
  /** 加载/发送均失败的图片（由桥做图片级重试与降级；不再毒化整条消息重发文本） */
  failedImages: OutboundImage[]
}

/**
 * 回复回发主入口：清洗 markdown → 分段发文字 → 抽取图片逐张上传发图。
 * 文本发送失败向上抛（桥整条重试）；图片失败不抛、收集进 failedImages（桥按图片级
 * 幂等键重试，避免「图失败 → 整条重发 → 文本刷屏」的毒化循环）。
 */
export async function sendOutboundReply(ctx: SendContext, rawText: string): Promise<OutboundSendResult> {
  const images = extractMarkdownImages(rawText)
  const cleaned = stripMarkdownForWechat(rawText)
  const segments = segmentText(cleaned)
  // 分段断点续发：上次发到一半失败的消息从断点继续（已发分段不重发）
  const fromSeg = (ctx.msgKey && ctx.segDone?.get(ctx.msgKey)) || 0
  for (let i = fromSeg; i < segments.length; i++) {
    await sendTextSegment(ctx, segments[i], i)
    if (ctx.msgKey) ctx.segDone?.set(ctx.msgKey, i + 1)
  }
  if (ctx.msgKey) ctx.segDone?.delete(ctx.msgKey) // 文本段全部送达，清断点
  const failedImages: OutboundImage[] = []
  for (let i = 0; i < Math.min(images.length, MAX_OUTBOUND_IMAGES); i++) {
    const img = images[i]
    const buf = await loadImageBuffer(img.url)
    if (!buf) { failedImages.push({ ...img, origIdx: i }); continue }
    try {
      await sendImageWithRetry(ctx, buf, i)
    } catch (e) {
      console.warn('[clawbot] image send failed:', e instanceof Error ? e.message : e)
      failedImages.push({ ...img, origIdx: i })
    }
  }
  return { textSegments: segments.length, failedImages }
}

/**
 * 仅重发图片（文本已确认送达后的图片级重试），返回仍失败的图片。
 * client_id 沿用 origIdx（与首发一致），不与已发图片撞 id。
 */
export async function sendImagesOnly(ctx: SendContext, images: OutboundImage[]): Promise<OutboundImage[]> {
  const failed: OutboundImage[] = []
  for (let i = 0; i < Math.min(images.length, MAX_OUTBOUND_IMAGES); i++) {
    const img = images[i]
    const idx = img.origIdx ?? i
    const buf = await loadImageBuffer(img.url)
    if (!buf) { failed.push({ ...img, origIdx: idx }); continue }
    try {
      await sendImageWithRetry(ctx, buf, idx)
    } catch (e) {
      console.warn('[clawbot] image resend failed:', e instanceof Error ? e.message : e)
      failed.push({ ...img, origIdx: idx })
    }
  }
  return failed
}

/** 简易纯文本发送（系统提示/错误兜底用） */
export async function sendPlainText(ctx: SendContext, text: string): Promise<void> {
  const segments = segmentText(text)
  for (let i = 0; i < segments.length; i++) {
    await sendTextSegment(ctx, segments[i], i)
  }
}
