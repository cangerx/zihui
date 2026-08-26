import { readFileSync, existsSync, statSync } from 'fs'
import { join, extname } from 'path'
import { nativeImage } from 'electron'
import { getDataDir } from './data-path'
import { getCloudApiBase, getCloudToken, fetchWithCloudAuth, cloudErrorText } from './cloud-token'
import { makeUploadThumbnailBlob } from './thumbnail-upload'

/**
 * 桌面端用户「上传创作到灵感广场」服务（主进程侧）。
 *
 * 渲染端通过 IPC 调用此函数，由主进程：
 *  1. 拼接 getDataDir() + result_path 读字节（兼容旧绝对路径）
 *  2. 用 Node 18+ 原生 FormData + Blob 组装 multipart 请求
 *  3. 带 Bearer token POST 到云控端 /client/inspirations
 *  4. 云控端 controller 内部走 StorageService::upload —— local 或 COS 自动适配
 *
 * 不依赖第三方 form-data 库，借助 Electron 主进程的 Node 18+ 全局 fetch / FormData / Blob。
 */

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp'])

export interface UploadInspirationParams {
  resultPath: string
  title: string
  categoryId: number
  promptLang: 'cn' | 'en'
  promptText: string
  refImages?: string[]
  generationSize?: string
}

export interface UploadInspirationResult {
  ok: boolean
  error?: string
  data?: any
  /** 原图超过 MAX_BYTES 触发自动 JPEG 阶梯压缩后上传时为 true，前端可据此提示用户 */
  compressed?: boolean
}

/**
 * 当原图超过 MAX_BYTES 时，使用 Electron 内置 nativeImage 按 85 / 70 / 55 阶梯
 * 重编码为 JPEG，命中第一个 ≤ MAX_BYTES 的档位即返回。
 *
 * 返回 { error } 表示无法决码或所有档位都超限，调用方按对应文案提示。
 * 注意：toJPEG 会丢失 PNG / WEBP 的 alpha 通道，但 AI 创作图基本不透明，
 * 这是为了零依赖的合理折中（替代方案 sharp 会带来数十 MB binary 依赖）。
 */
function maybeCompress(buf: Buffer, ext: string): {
  buf: Buffer
  ext: string
  mime: string
  compressed: boolean
  error?: 'cannot_decode' | 'still_too_large'
} {
  if (buf.length <= MAX_BYTES) {
    return { buf, ext, mime: mimeOfExt(ext), compressed: false }
  }

  let img
  try {
    img = nativeImage.createFromBuffer(buf)
    if (!img || img.isEmpty()) {
      return { buf, ext, mime: mimeOfExt(ext), compressed: false, error: 'cannot_decode' }
    }
  } catch {
    return { buf, ext, mime: mimeOfExt(ext), compressed: false, error: 'cannot_decode' }
  }

  for (const quality of [85, 70, 55]) {
    let jpeg: Buffer
    try { jpeg = img.toJPEG(quality) } catch { continue }
    if (jpeg && jpeg.length > 0 && jpeg.length <= MAX_BYTES) {
      return { buf: jpeg, ext: 'jpg', mime: 'image/jpeg', compressed: true }
    }
  }

  return { buf, ext, mime: mimeOfExt(ext), compressed: false, error: 'still_too_large' }
}

function mimeOfExt(ext: string): string {
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    default: return 'application/octet-stream'
  }
}

function resolveAbsolutePath(p: string): string {
  // image_generations.result_path 历史上既可能是绝对路径（盘符 / Unix /），也可能是相对数据目录
  const isAbsolute = /^[A-Za-z]:|^\//.test(p)
  return isAbsolute ? p : join(getDataDir(), p)
}

function decodeDataUri(dataUri: string): { buf: Buffer; ext: string; mime: string } | null {
  const m = dataUri.match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i)
  if (!m) return null
  const mime = m[1].toLowerCase().replace('image/jpg', 'image/jpeg')
  const ext = mime === 'image/jpeg' ? 'jpg' : mime.replace('image/', '')
  try {
    return { buf: Buffer.from(m[2], 'base64'), ext, mime }
  } catch {
    return null
  }
}

function normalizeImageMime(mime: string): { ext: string; mime: string } | null {
  const value = (mime || '').split(';')[0].trim().toLowerCase().replace('image/jpg', 'image/jpeg')
  if (value === 'image/png') return { ext: 'png', mime: value }
  if (value === 'image/jpeg') return { ext: 'jpg', mime: value }
  if (value === 'image/webp') return { ext: 'webp', mime: value }
  return null
}

async function fetchImageForUpload(url: string): Promise<{ buf: Buffer; ext: string; mime: string } | null> {
  const resp = await fetch(url, { method: 'GET' })
  if (!resp.ok) return null
  const info = normalizeImageMime(resp.headers.get('content-type') || '')
  if (!info) return null
  const buf = Buffer.from(await resp.arrayBuffer())
  return { buf, ext: info.ext, mime: info.mime }
}

async function loadImageForUpload(input: string): Promise<{
  buf: Buffer
  ext: string
  mime: string
  compressed: boolean
  error?: string
}> {
  if (input.startsWith('data:')) {
    const decoded = decodeDataUri(input)
    if (!decoded) return { buf: Buffer.alloc(0), ext: 'png', mime: 'image/png', compressed: false, error: '参考图格式无法解析' }
    const cmp = maybeCompress(decoded.buf, decoded.ext)
    if (cmp.error === 'cannot_decode') return { buf: Buffer.alloc(0), ext: decoded.ext, mime: decoded.mime, compressed: false, error: '参考图格式无法解析' }
    if (cmp.error === 'still_too_large') return { buf: Buffer.alloc(0), ext: decoded.ext, mime: decoded.mime, compressed: false, error: `参考图过大，自动压缩后仍超过 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB` }
    return { buf: cmp.buf, ext: cmp.ext, mime: cmp.mime, compressed: cmp.compressed }
  }

  if (/^https?:\/\//i.test(input)) {
    let downloaded: { buf: Buffer; ext: string; mime: string } | null = null
    try {
      downloaded = await fetchImageForUpload(input)
    } catch (e: any) {
      return { buf: Buffer.alloc(0), ext: 'png', mime: 'image/png', compressed: false, error: '下载参考图失败：' + (e?.message || e) }
    }
    if (!downloaded) return { buf: Buffer.alloc(0), ext: 'png', mime: 'image/png', compressed: false, error: '下载参考图失败或格式不支持' }
    const cmp = maybeCompress(downloaded.buf, downloaded.ext)
    if (cmp.error === 'cannot_decode') return { buf: Buffer.alloc(0), ext: downloaded.ext, mime: downloaded.mime, compressed: false, error: '参考图格式无法解析' }
    if (cmp.error === 'still_too_large') return { buf: Buffer.alloc(0), ext: downloaded.ext, mime: downloaded.mime, compressed: false, error: `参考图过大，自动压缩后仍超过 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB` }
    return { buf: cmp.buf, ext: cmp.ext, mime: cmp.mime, compressed: cmp.compressed }
  }

  const absPath = resolveAbsolutePath(input)
  if (!existsSync(absPath)) return { buf: Buffer.alloc(0), ext: 'png', mime: 'image/png', compressed: false, error: '参考图文件不存在或已被删除' }
  let stat: ReturnType<typeof statSync>
  try { stat = statSync(absPath) } catch (e: any) { return { buf: Buffer.alloc(0), ext: 'png', mime: 'image/png', compressed: false, error: '读取参考图失败：' + (e?.message || e) } }
  if (!stat.isFile()) return { buf: Buffer.alloc(0), ext: 'png', mime: 'image/png', compressed: false, error: '参考图路径不是一个文件' }
  const ext = extname(absPath).slice(1).toLowerCase()
  if (!ALLOWED_EXTS.has(ext)) return { buf: Buffer.alloc(0), ext: 'png', mime: 'image/png', compressed: false, error: '参考图仅支持 PNG / JPEG / WEBP 格式' }
  let buf: Buffer
  try { buf = readFileSync(absPath) } catch (e: any) { return { buf: Buffer.alloc(0), ext, mime: mimeOfExt(ext), compressed: false, error: '读取参考图失败：' + (e?.message || e) } }
  const cmp = maybeCompress(buf, ext)
  if (cmp.error === 'cannot_decode') return { buf: Buffer.alloc(0), ext, mime: mimeOfExt(ext), compressed: false, error: '参考图格式无法解析，请检查文件是否损坏' }
  if (cmp.error === 'still_too_large') return { buf: Buffer.alloc(0), ext, mime: mimeOfExt(ext), compressed: false, error: `参考图过大，自动压缩后仍超过 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB` }
  return { buf: cmp.buf, ext: cmp.ext, mime: cmp.mime, compressed: cmp.compressed }
}

export async function uploadInspiration(params: UploadInspirationParams): Promise<UploadInspirationResult> {
  const { resultPath, title, categoryId, promptLang, promptText, refImages = [], generationSize } = params

  // ---- 入参基础校验（前端已校验过，这里兜底防御）----
  if (!resultPath) return { ok: false, error: '创作图片路径为空' }
  if (!title || !title.trim()) return { ok: false, error: '标题不能为空' }
  if (!categoryId) return { ok: false, error: '请选择分类' }
  if (promptLang !== 'cn' && promptLang !== 'en') return { ok: false, error: '提示词语言无效' }
  if (!promptText || !promptText.trim()) return { ok: false, error: '提示词内容为空' }

  const token = getCloudToken()
  if (!token) return { ok: false, error: '未登录云控账号，无法上传' }

  // ---- 读本地图片字节 ----
  const absPath = resolveAbsolutePath(resultPath)
  if (!existsSync(absPath)) return { ok: false, error: '本地图片文件不存在或已被删除' }

  let stat: ReturnType<typeof statSync>
  try { stat = statSync(absPath) } catch (e: any) { return { ok: false, error: '读取图片失败：' + (e?.message || e) } }
  if (!stat.isFile()) return { ok: false, error: '路径不是一个文件' }

  const ext = extname(absPath).slice(1).toLowerCase()
  if (!ALLOWED_EXTS.has(ext)) return { ok: false, error: '仅支持 PNG / JPEG / WEBP 格式' }

  let buf: Buffer
  try { buf = readFileSync(absPath) } catch (e: any) { return { ok: false, error: '读取图片失败：' + (e?.message || e) } }

  // ---- 过大自动 JPEG 阶梯压缩 ----
  const cmp = maybeCompress(buf, ext)
  if (cmp.error === 'cannot_decode') {
    return { ok: false, error: '图片格式无法解析，请检查文件是否损坏' }
  }
  if (cmp.error === 'still_too_large') {
    return { ok: false, error: `原图过大，自动压缩后仍超过 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB，请手动调整尺寸后重试` }
  }
  const finalBuf = cmp.buf
  const finalExt = cmp.ext
  const finalMime = cmp.mime

  // ---- 构造 multipart/form-data ----
  const filename = 'creation.' + (finalExt === 'jpg' ? 'jpg' : finalExt)
  const blob = new Blob([new Uint8Array(finalBuf)], { type: finalMime })
  const fd = new FormData()
  fd.append('category_id', String(categoryId))
  fd.append('title', title.trim())
  fd.append('prompt_lang', promptLang)
  fd.append('prompt_text', promptText)
  if (generationSize?.trim()) {
    fd.append('generation_size', generationSize.trim())
  }
  fd.append('cover_image', blob, filename)

  // 附带封面缩略图（网格列表用），失败则跳过、云端回退原图
  const coverThumb = makeUploadThumbnailBlob(finalBuf, 720)
  if (coverThumb) {
    fd.append('cover_thumb', coverThumb.blob, coverThumb.filename)
  }

  let refCompressed = false
  for (const [index, refImage] of refImages.slice(0, 8).entries()) {
    if (!refImage) continue
    const loaded = await loadImageForUpload(refImage)
    if (loaded.error) return { ok: false, error: loaded.error }
    refCompressed = refCompressed || loaded.compressed
    const refBlob = new Blob([new Uint8Array(loaded.buf)], { type: loaded.mime })
    fd.append('ref_images[]', refBlob, `ref-${index + 1}.${loaded.ext === 'jpg' ? 'jpg' : loaded.ext}`)
  }

  // ---- POST 到云控端 ----
  const url = `${getCloudApiBase()}/client/inspirations`
  let resp: Response
  try {
    resp = await fetchWithCloudAuth(url, {
      method: 'POST',
      body: fd,
    }, '灵感广场上传 401')
  } catch (e: any) {
    return { ok: false, error: '网络请求失败：' + (e?.message || '未知错误') }
  }

  // ---- 解析响应 ----
  let json: any = null
  try { json = await resp.json() } catch { /* 非 JSON 响应 */ }

  if (resp.status === 401) {
    return { ok: false, error: '登录已过期，请重新登录' }
  }
  if (resp.status === 403) {
    return { ok: false, error: json?.message || '当前账号未开启灵感大王权限' }
  }
  if (resp.status === 422) {
    const details = json?.details
    if (details && typeof details === 'object') {
      const firstKey = Object.keys(details)[0]
      const firstMsg = Array.isArray(details[firstKey]) ? details[firstKey][0] : ''
      return { ok: false, error: firstMsg || '参数校验失败' }
    }
    return { ok: false, error: '参数校验失败' }
  }
  if (!resp.ok) {
    return { ok: false, error: cloudErrorText(resp.status, json, '上传失败') }
  }

  return { ok: true, data: json, compressed: cmp.compressed || refCompressed }
}
