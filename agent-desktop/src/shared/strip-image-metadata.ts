/**
 * 剥离 JPEG/PNG 字节流中的元数据段，包括：
 *   - JPEG: APP0~APP15(EXIF/ICC/XMP/Photoshop/Adobe 等)、COM 注释
 *   - PNG:  iCCP/iTXt/tEXt/zTXt/eXIf
 *
 * 目的：阻断 Chromium Canvas 的 color management pipeline，
 * 避免微信/小红书等平台嵌入的非标 ICC v4 mini profile 触发解码异常，
 * 导致 canvas 重编码后像素被污染、上游 /images/edits 拒绝请求。
 *
 * 同时兼容 Node(主进程) 与 Renderer(浏览器)：
 *   - 内部不使用 Buffer，只用 Uint8Array + atob/btoa
 *   - Node 16+ 全局已提供 atob/btoa，Electron 31 用 Node 18+，安全
 */

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  // 分块以避免 String.fromCharCode 在大数组上爆栈
  const CHUNK = 0x8000
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as any)
  }
  return btoa(bin)
}

/**
 * 扫描 JPEG marker，丢弃 APPn(0xE0~0xEF) 与 COM(0xFE) 段，保留其余结构。
 * 注意 SOS(0xDA) 之后是熵编码扫描数据，需按 FF 转义规则透传到 EOI(0xD9)。
 */
function stripJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
  const out: number[] = [0xff, 0xd8]
  let i = 2
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) return bytes // 结构异常，保守原样返回
    while (i < bytes.length - 1 && bytes[i] === 0xff) i++
    const marker = bytes[i]
    i++
    // 单字节 marker：RST0~7、TEM；EOI 终止
    if (marker === 0xd9) {
      out.push(0xff, 0xd9)
      break
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(0xff, marker)
      continue
    }
    if (i + 1 >= bytes.length) return bytes
    const segLen = (bytes[i] << 8) | bytes[i + 1]
    if (segLen < 2 || i + segLen > bytes.length) return bytes
    const segEnd = i + segLen
    const isApp = marker >= 0xe0 && marker <= 0xef
    const isCom = marker === 0xfe
    if (isApp || isCom) {
      i = segEnd
      continue
    }
    // 保留段
    out.push(0xff, marker)
    for (let k = i; k < segEnd; k++) out.push(bytes[k])
    i = segEnd
    if (marker === 0xda) {
      // SOS：透传扫描数据直到 FFD9 (EOI)
      while (i < bytes.length) {
        const b = bytes[i]
        out.push(b)
        i++
        if (b === 0xff && i < bytes.length) {
          const nxt = bytes[i]
          out.push(nxt)
          i++
          if (nxt === 0xd9) return new Uint8Array(out) // EOI
          // FF00 是字节填充；FFD0~D7 是 RST；其余视作异常但仍透传
        }
      }
      break
    }
  }
  return new Uint8Array(out)
}

/**
 * 扫描 PNG chunks，丢弃元数据 chunk，保留 IHDR/PLTE/IDAT/IEND/tRNS/gAMA/cHRM 等渲染必需。
 * iCCP 是色彩 profile，必须丢弃；其它文本/EXIF chunk 一并清掉。
 */
function stripPng(bytes: Uint8Array): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 8) return bytes
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return bytes
  const out: number[] = []
  for (let i = 0; i < 8; i++) out.push(sig[i])
  let i = 8
  // caBX = C2PA 内容凭证在 PNG 中的载体块（去AI标记「全量」需一并清除）
  const DROP = new Set(['iCCP', 'iTXt', 'tEXt', 'zTXt', 'eXIf', 'caBX'])
  while (i + 8 <= bytes.length) {
    const len = ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3]
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7])
    const chunkEnd = i + 8 + len + 4
    if (chunkEnd > bytes.length) return bytes // 结构异常
    if (!DROP.has(type)) {
      for (let k = i; k < chunkEnd; k++) out.push(bytes[k])
    }
    i = chunkEnd
    if (type === 'IEND') break
  }
  return new Uint8Array(out)
}

/**
 * 入参可以是 data URI 或纯 base64：
 *   - `data:image/jpeg;base64,xxxx`
 *   - `data:image/png;base64,xxxx`
 *   - 任何其它类型原样返回（webp/gif 等本身不会触发 ICC 问题）
 */
export function stripImageMetadata(input: string): string {
  const m = input.match(/^data:image\/(jpeg|jpg|png);base64,/i)
  if (!m) return input
  const format = m[1].toLowerCase() === 'png' ? 'png' : 'jpeg'
  const base64 = input.slice(m[0].length)
  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(base64)
  } catch {
    return input
  }
  const stripped = format === 'png' ? stripPng(bytes) : stripJpeg(bytes)
  if (stripped === bytes) return input // 未变更
  const mime = format === 'png' ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${bytesToBase64(stripped)}`
}

/**
 * 主进程便捷版：直接处理 Buffer/base64 字符串，返回相同形态。
 */
export function stripBase64(base64: string, format: 'jpeg' | 'png' = 'jpeg'): string {
  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(base64)
  } catch {
    return base64
  }
  const stripped = format === 'png' ? stripPng(bytes) : stripJpeg(bytes)
  if (stripped === bytes) return base64
  return bytesToBase64(stripped)
}

// ======================================================================
// 去AI标记：在上面「无损剥字节」能力之上，增加「识别命中了哪些标记类别 /
// 尽力识别来源厂商」的扫描，供桌面端「去AI标记」功能展示与角标使用。
//
// 边界（诚实）：只能可靠清除「元数据 / 溯源标识类」标记（C2PA / EXIF / XMP /
// 中国 AIGC 隐式标识 / PNG 文本块 / ICC）；对 Google SynthID 等写进像素的
// ML 鲁棒水印无能为力（本地无 GPU、无解码器）。
// ======================================================================

/** 可被本地清除的标记类别 */
export type AiMarkType = 'c2pa' | 'exif' | 'xmp' | 'aigc' | 'iptc' | 'icc' | 'png_text' | 'comment'

export interface AiMarkScan {
  format: 'jpeg' | 'png' | 'other'
  /** 命中的标记类别（去重） */
  markTypes: AiMarkType[]
  /** 尽力识别的来源厂商展示名（可能为空） */
  vendors: string[]
  /** 是否检测到任何可清除标记 */
  hasAny: boolean
}

const MARK_TYPE_LABELS: Record<AiMarkType, string> = {
  c2pa: 'C2PA 内容凭证',
  exif: 'EXIF 信息',
  xmp: 'XMP 溯源信息',
  aigc: '中国 AIGC 隐式标识',
  iptc: 'IPTC 信息',
  icc: 'ICC 色彩配置',
  png_text: 'PNG 生成参数/文本',
  comment: '注释信息',
}

/** 标记类别 → 中文展示名 */
export function markTypeLabel(t: AiMarkType): string {
  return MARK_TYPE_LABELS[t] || t
}

// 厂商识别需针（在元数据区做小范围 latin1 扫描，命中即认定；纯展示用，允许保守漏判）
const VENDOR_NEEDLES: Array<[RegExp, string]> = [
  [/dall[·\-\. ]?e|openai/i, 'OpenAI'],
  [/gemini|imagen|synthid|nano ?banana|deepmind/i, 'Google'],
  [/firefly/i, 'Adobe Firefly'],
  [/bing image|mai-image|microsoft designer|\bdesigner\b/i, 'Microsoft'],
  [/volcengine|doubao|jimeng|dreamina|byteplus|seedream|bytedance/i, '字节（豆包/即梦）'],
  [/ideogram/i, 'Ideogram'],
  [/stable ?diffusion|stability|sdxl/i, 'Stable Diffusion'],
  [/black ?forest|flux/i, 'FLUX'],
  [/canva/i, 'Canva'],
  [/midjourney/i, 'Midjourney'],
  [/samsung/i, '三星 Galaxy AI'],
  [/grok|aurora|x\.ai|\bxai\b/i, 'xAI Grok'],
  [/novelai/i, 'NovelAI'],
  [/reve\.com/i, 'Reve'],
  [/meta ai|imagined with ai/i, 'Meta AI'],
  [/recraft/i, 'Recraft'],
  [/leonardo/i, 'Leonardo'],
]

// 中国 AIGC 隐式标识需针
const AIGC_NEEDLE = /tc260\.org\.cn|"AIGC"|AIGC\{|trainedAlgorithmicMedia|DigitalSourceType/i

function rangeToLatin1(bytes: Uint8Array, start: number, end: number): string {
  const CHUNK = 0x4000
  let s = ''
  const stop = Math.min(end, bytes.length)
  for (let i = start; i < stop; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, stop)) as any)
  }
  return s
}

/** 扫描 JPEG：返回命中类别 + 元数据区拼接文本（供厂商/AIGC 需针匹配） */
function scanJpeg(bytes: Uint8Array): { marks: Set<AiMarkType>; meta: string } {
  const marks = new Set<AiMarkType>()
  let meta = ''
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { marks, meta }
  let i = 2
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) break
    while (i < bytes.length - 1 && bytes[i] === 0xff) i++
    const marker = bytes[i]
    i++
    if (marker === 0xd9 || marker === 0xda) break // EOI / SOS(进入扫描数据)
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue
    if (i + 1 >= bytes.length) break
    const segLen = (bytes[i] << 8) | bytes[i + 1]
    if (segLen < 2 || i + segLen > bytes.length) break
    const payStart = i + 2
    const segEnd = i + segLen
    const head = rangeToLatin1(bytes, payStart, Math.min(payStart + 40, segEnd))
    if (marker >= 0xe0 && marker <= 0xef) {
      // APPn
      if (marker === 0xe1) {
        if (head.startsWith('Exif')) marks.add('exif')
        else if (/ns\.adobe\.com\/xap|<x:xmpmeta|<\?xpacket/.test(head)) marks.add('xmp')
        else marks.add('xmp')
      } else if (marker === 0xe2 && head.startsWith('ICC_PROFILE')) {
        marks.add('icc')
      } else if (marker === 0xeb) {
        marks.add('c2pa') // JUMBF/C2PA
      } else if (marker === 0xed) {
        marks.add('iptc') // Photoshop 3.0 / IPTC
      }
      meta += rangeToLatin1(bytes, payStart, segEnd)
    } else if (marker === 0xfe) {
      marks.add('comment')
      meta += rangeToLatin1(bytes, payStart, segEnd)
    }
    i = segEnd
  }
  if (AIGC_NEEDLE.test(meta)) marks.add('aigc')
  return { marks, meta }
}

/** 扫描 PNG：返回命中类别 + 文本/元数据块拼接文本 */
function scanPng(bytes: Uint8Array): { marks: Set<AiMarkType>; meta: string } {
  const marks = new Set<AiMarkType>()
  let meta = ''
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 8) return { marks, meta }
  for (let k = 0; k < 8; k++) if (bytes[k] !== sig[k]) return { marks, meta }
  let i = 8
  while (i + 8 <= bytes.length) {
    const len = ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3]
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7])
    const dataStart = i + 8
    const chunkEnd = dataStart + len + 4
    if (chunkEnd > bytes.length) break
    if (type === 'eXIf') marks.add('exif')
    else if (type === 'iCCP') marks.add('icc')
    else if (type === 'caBX') marks.add('c2pa')
    else if (type === 'iTXt' || type === 'tEXt' || type === 'zTXt') {
      const txt = rangeToLatin1(bytes, dataStart, Math.min(dataStart + len, dataStart + 4096))
      if (/ns\.adobe\.com\/xap|<x:xmpmeta|<\?xpacket/.test(txt)) marks.add('xmp')
      else marks.add('png_text')
      meta += txt
    }
    i = chunkEnd
    if (type === 'IEND') break
  }
  if (AIGC_NEEDLE.test(meta)) marks.add('aigc')
  return { marks, meta }
}

function detectFormat(bytes: Uint8Array): 'jpeg' | 'png' | 'other' {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  return 'other'
}

/** 扫描字节流，识别命中的标记类别与尽力识别的来源厂商（不修改数据） */
export function scanAiMarks(bytes: Uint8Array): AiMarkScan {
  const format = detectFormat(bytes)
  let marks = new Set<AiMarkType>()
  let meta = ''
  if (format === 'jpeg') ({ marks, meta } = scanJpeg(bytes))
  else if (format === 'png') ({ marks, meta } = scanPng(bytes))
  const vendors: string[] = []
  if (meta) {
    for (const [re, name] of VENDOR_NEEDLES) {
      if (re.test(meta) && !vendors.includes(name)) vendors.push(name)
    }
  }
  const markTypes = Array.from(marks)
  return { format, markTypes, vendors, hasAny: markTypes.length > 0 }
}

/**
 * 全量去除字节流中的元数据/溯源标识（无损剥字节，不重编码、不动像素）。
 * 返回处理后的字节与本次命中的标记扫描结果（用于展示与角标）。
 */
export function stripAiMarksBytes(bytes: Uint8Array): { bytes: Uint8Array; scan: AiMarkScan } {
  const scan = scanAiMarks(bytes)
  let out = bytes
  if (scan.format === 'jpeg') out = stripJpeg(bytes)
  else if (scan.format === 'png') out = stripPng(bytes)
  return { bytes: out, scan }
}
