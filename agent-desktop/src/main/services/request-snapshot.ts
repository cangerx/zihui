import { createHash } from 'crypto'

/**
 * 请求快照工具：在每次生图 HTTP 调用前抓一份「脱敏 + 占位符化」的请求记录，
 * 失败时通过 Error.rawRequest 挂载冒泡到 generateImages.runOne 的 catch 块，
 * 与错误信息一同写入 image_generations.raw_request 列，供失败详情弹窗展示与复制。
 *
 * 脱敏规则（双重保护：UI 不卡死 + 凭证不外泄）：
 *   1. headers 里的 Authorization / X-API-Key / api-key / api_key 等鉴权字段
 *      仅保留前 8 + 后 4 字符，中间用 '***' 替换；裸 token 同理（多米鉴权头无 Bearer 前缀）
 *   2. body 里的 image / images / image_urls / input_image / mask 等图片字段，
 *      若值是 base64（dataURI 或裸 base64）→ 替换为 <dataURI mime, NNNN bytes, sha256:前12位>；
 *      若值是 http(s):// URL → 保留原样（URL 本身不敏感、对诊断关键）
 *   3. 其他字段（model / prompt / size / quality / 自定义参数）原样保留
 *
 * 这是诊断工具，不是审计日志：sha256 只取前 12 位用于「同一张图重试」比对，
 * 不要求碰撞抗性；纯粹给排错时辨别"是不是同一张参考图反复失败"。
 */

export interface RequestSnapshot {
  /** ISO 8601 时间戳 */
  timestamp: string
  /** 调用通道：cloud=云控端网关 / duomi=多米直连 / custom=自定义 OpenAI 兼容服务商 */
  channel: 'cloud' | 'duomi' | 'custom'
  /** 完整请求 URL（含 query） */
  url: string
  method: string
  headers: Record<string, string>
  /**
   * 请求体：
   *   - JSON 协议：原 body 对象的脱敏副本
   *   - multipart 协议：以 { __multipart: true, parts: [...] } 形式表示，
   *     每个 part 是 { name, kind: 'text'|'file', value | filename + mime + bytes + sha256 }
   */
  body: unknown
}

/** 需要脱敏的鉴权 header 名（小写匹配） */
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'x-api-key',
  'api-key',
  'api_key',
  'apikey',
  'x-auth-token',
  'cookie',
  'set-cookie'
])

/** body 中按 key 名识别的图片/二进制字段（值会被占位符化） */
const IMAGE_FIELD_NAMES = new Set([
  'image',
  'images',
  'image_url',
  'image_urls',
  'input_image',
  'input_images',
  'reference_image',
  'reference_images',
  'init_image',
  'mask',
  'b64_json'
])

/**
 * 脱敏单个 token：保留前 prefixLen + 后 suffixLen 字符，中间替换为 '***'。
 * 短 token（≤ prefixLen + suffixLen + 3）整体替换为 '***'，避免泄漏全部内容。
 */
function maskToken(token: string, prefixLen = 8, suffixLen = 4): string {
  if (!token) return ''
  const total = prefixLen + suffixLen + 3
  if (token.length <= total) return '***'
  return token.slice(0, prefixLen) + '***' + token.slice(-suffixLen)
}

/**
 * 脱敏一个 header 值：
 *   - "Bearer sk-xxx..." → "Bearer sk-xxxxxxx***wxyz"
 *   - 裸 token（多米风格）→ "sk-xxxxxxx***wxyz"
 */
function maskHeaderValue(value: string): string {
  const trimmed = value.trim()
  // Bearer / Basic / Token 等带 scheme 前缀：保留 scheme，仅脱敏 token 部分
  const schemeMatch = trimmed.match(/^(Bearer|Basic|Token|Digest)\s+(.+)$/i)
  if (schemeMatch) {
    return `${schemeMatch[1]} ${maskToken(schemeMatch[2])}`
  }
  return maskToken(trimmed)
}

/**
 * 脱敏 headers 对象：仅对鉴权类 header 替换值，其他原样保留。
 * 返回浅拷贝，不修改入参。
 */
export function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_NAMES.has(key.toLowerCase())) {
      out[key] = maskHeaderValue(value)
    } else {
      out[key] = value
    }
  }
  return out
}

/** 判断字符串是否疑似 base64（仅当较长且字符集合规时才判定，避免误伤短文本） */
function looksLikeBase64(str: string): boolean {
  if (str.length < 256) return false
  // 允许标准 base64 字符 + url-safe 变体
  return /^[A-Za-z0-9+/=_-]+\s*$/.test(str)
}

/** 计算 sha256 前 12 位作为指纹 */
function sha256Short(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12)
}

/**
 * 把一个图片字段值替换为占位符。支持四种输入形态：
 *   1. dataURI: "data:image/png;base64,iVBOR..." → <dataURI image/png, NNN bytes, sha256:xxx>
 *   2. 裸 base64 长字符串 → <base64, NNN bytes, sha256:xxx>
 *   3. http(s):// URL → 保留原样
 *   4. 其他短字符串（< 256）→ 保留原样（可能是 file_id / S3 key 等元数据）
 */
function maskImageString(value: string): string {
  if (!value) return value
  // dataURI
  const dataMatch = value.match(/^data:([^;]+);base64,(.+)$/)
  if (dataMatch) {
    const mime = dataMatch[1]
    const base64 = dataMatch[2]
    const bytes = Math.floor((base64.length * 3) / 4)
    return `<dataURI ${mime}, ${bytes} bytes, sha256:${sha256Short(base64)}>`
  }
  // 公网 URL 直接保留
  if (/^https?:\/\//i.test(value)) return value
  // 裸 base64
  if (looksLikeBase64(value)) {
    const bytes = Math.floor((value.length * 3) / 4)
    return `<base64, ${bytes} bytes, sha256:${sha256Short(value)}>`
  }
  // 短字符串原样
  return value
}

/**
 * 递归脱敏 body 对象：仅对已知图片字段的值做占位符替换。
 * 数组元素同样处理；嵌套对象递归处理。返回深拷贝，不修改入参。
 */
export function sanitizeBody(body: unknown): unknown {
  if (body == null) return body
  if (typeof body === 'string') return body
  if (typeof body !== 'object') return body
  if (Array.isArray(body)) {
    return body.map((item) => sanitizeBody(item))
  }
  const src = body as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(src)) {
    if (IMAGE_FIELD_NAMES.has(key.toLowerCase())) {
      out[key] = maskImageField(value)
    } else if (value && typeof value === 'object') {
      out[key] = sanitizeBody(value)
    } else {
      out[key] = value
    }
  }
  return out
}

/** 处理图片字段的值：字符串走 maskImageString，数组逐元素处理，其他原样 */
function maskImageField(value: unknown): unknown {
  if (typeof value === 'string') return maskImageString(value)
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? maskImageString(item) : sanitizeBody(item)))
  }
  if (value && typeof value === 'object') return sanitizeBody(value)
  return value
}

/**
 * 把 FormData 实例转成可序列化的结构化表示。
 * 文件 part 不读取内容，只记录 filename + mime + 大小 + sha256 指纹。
 * 文本 part 直接保留（鉴权之类的不会经 form-data 传，所以不再二次脱敏）。
 */
export async function describeFormData(form: FormData): Promise<{ __multipart: true; parts: unknown[] }> {
  const parts: unknown[] = []
  for (const [name, value] of form.entries()) {
    if (value instanceof Blob) {
      const filename = (value as any).name || ''
      const mime = value.type || 'application/octet-stream'
      const size = value.size
      let fp = ''
      try {
        const buf = Buffer.from(await value.arrayBuffer())
        fp = sha256Short(buf)
      } catch {
        // 极端情况：流式 Blob 无法 arrayBuffer；指纹缺省即可
      }
      parts.push({ name, kind: 'file', filename, mime, bytes: size, sha256: fp })
    } else {
      parts.push({ name, kind: 'text', value })
    }
  }
  return { __multipart: true, parts }
}

/**
 * 构造请求快照。body 支持：
 *   - object（JSON 路径）：直接 sanitizeBody
 *   - FormData（multipart 路径）：调用方需先 await describeFormData 转成结构化对象再传入
 *   - 字符串（已 JSON.stringify 的 body）：尝试解析后脱敏，失败则原样
 */
export function buildRequestSnapshot(params: {
  channel: RequestSnapshot['channel']
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}): RequestSnapshot {
  let bodyOut: unknown = params.body
  if (typeof params.body === 'string') {
    try {
      bodyOut = sanitizeBody(JSON.parse(params.body))
    } catch {
      bodyOut = params.body
    }
  } else {
    bodyOut = sanitizeBody(params.body)
  }
  return {
    timestamp: new Date().toISOString(),
    channel: params.channel,
    url: params.url,
    method: params.method,
    headers: sanitizeHeaders(params.headers),
    body: bodyOut
  }
}

/** 美化序列化快照为 JSON 字符串，用于持久化与剪贴板复制 */
export function serializeSnapshot(snapshot: RequestSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}

/**
 * 把快照挂载到错误对象上（rawRequest 字段，JSON 字符串形式）。
 * generateImages.runOne 的 catch 块据此把字段写入 image_generations.raw_request 列。
 *
 * 设计要点：始终挂 JSON 字符串而不是对象，避免 Error 在 IPC 边界序列化失败 /
 * 中间层 wrap 错误时丢字段。
 */
export function attachSnapshotToError(error: unknown, snapshot: RequestSnapshot): void {
  if (!error || typeof error !== 'object') return
  // 已经挂过就别覆盖（最内层抛错的快照最贴近真实失败请求）
  if ((error as any).rawRequest) return
  ;(error as any).rawRequest = serializeSnapshot(snapshot)
}

/** 从错误对象中提取已挂载的请求快照 JSON 字符串；没挂则返回空串 */
export function extractRawRequest(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  const raw = (error as any).rawRequest
  return typeof raw === 'string' ? raw : ''
}
