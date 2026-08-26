import { existsSync, readFileSync, statSync } from 'fs'
import { extname } from 'path'
import { nativeImage } from 'electron'
import { fetchWithCloudAuth, getCloudApiBase, getCloudToken, cloudErrorText } from './cloud-token'
import { getTemplate, updateTemplateSubmissionState } from './creative-template'
import { makeUploadThumbnailBlob } from './thumbnail-upload'

const MAX_BYTES = 8 * 1024 * 1024
const ALLOWED_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp'])

export interface SubmitCreativeTemplateParams {
  templateId: string
  cloudCategoryId: number
}

export interface SubmitCreativeTemplateResult {
  ok: boolean
  error?: string
  data?: any
  compressed?: boolean
}

export interface SyncCreativeTemplateSubmissionResult {
  ok: boolean
  error?: string
  items?: any[]
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

function normalizeImageMime(mime: string): { ext: string; mime: string } | null {
  const value = (mime || '').split(';')[0].trim().toLowerCase().replace('image/jpg', 'image/jpeg')
  if (value === 'image/png') return { ext: 'png', mime: value }
  if (value === 'image/jpeg') return { ext: 'jpg', mime: value }
  if (value === 'image/webp') return { ext: 'webp', mime: value }
  return null
}

function decodeDataUri(dataUri: string): { buf: Buffer; ext: string; mime: string } | null {
  const m = dataUri.match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i)
  if (!m) return null
  const info = normalizeImageMime(m[1])
  if (!info) return null
  try {
    return { buf: Buffer.from(m[2], 'base64'), ext: info.ext, mime: info.mime }
  } catch {
    return null
  }
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
  if (!input) return { buf: Buffer.alloc(0), ext: 'png', mime: 'image/png', compressed: false, error: '图片路径为空' }

  if (input.startsWith('data:')) {
    const decoded = decodeDataUri(input)
    if (!decoded) return { buf: Buffer.alloc(0), ext: 'png', mime: 'image/png', compressed: false, error: '图片格式无法解析' }
    const cmp = maybeCompress(decoded.buf, decoded.ext)
    if (cmp.error === 'cannot_decode') return { buf: Buffer.alloc(0), ext: decoded.ext, mime: decoded.mime, compressed: false, error: '图片格式无法解析' }
    if (cmp.error === 'still_too_large') return { buf: Buffer.alloc(0), ext: decoded.ext, mime: decoded.mime, compressed: false, error: `图片过大，自动压缩后仍超过 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB` }
    return { buf: cmp.buf, ext: cmp.ext, mime: cmp.mime, compressed: cmp.compressed }
  }

  if (/^https?:\/\//i.test(input)) {
    let downloaded: { buf: Buffer; ext: string; mime: string } | null = null
    try {
      downloaded = await fetchImageForUpload(input)
    } catch (e: any) {
      return { buf: Buffer.alloc(0), ext: 'png', mime: 'image/png', compressed: false, error: '下载图片失败：' + (e?.message || e) }
    }
    if (!downloaded) return { buf: Buffer.alloc(0), ext: 'png', mime: 'image/png', compressed: false, error: '下载图片失败或格式不支持' }
    const cmp = maybeCompress(downloaded.buf, downloaded.ext)
    if (cmp.error === 'cannot_decode') return { buf: Buffer.alloc(0), ext: downloaded.ext, mime: downloaded.mime, compressed: false, error: '图片格式无法解析' }
    if (cmp.error === 'still_too_large') return { buf: Buffer.alloc(0), ext: downloaded.ext, mime: downloaded.mime, compressed: false, error: `图片过大，自动压缩后仍超过 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB` }
    return { buf: cmp.buf, ext: cmp.ext, mime: cmp.mime, compressed: cmp.compressed }
  }

  if (!existsSync(input)) return { buf: Buffer.alloc(0), ext: 'png', mime: 'image/png', compressed: false, error: '本地图片文件不存在或已被删除' }
  let stat: ReturnType<typeof statSync>
  try { stat = statSync(input) } catch (e: any) { return { buf: Buffer.alloc(0), ext: 'png', mime: 'image/png', compressed: false, error: '读取图片失败：' + (e?.message || e) } }
  if (!stat.isFile()) return { buf: Buffer.alloc(0), ext: 'png', mime: 'image/png', compressed: false, error: '图片路径不是一个文件' }
  const ext = extname(input).slice(1).toLowerCase()
  if (!ALLOWED_EXTS.has(ext)) return { buf: Buffer.alloc(0), ext: 'png', mime: 'image/png', compressed: false, error: '图片仅支持 PNG / JPEG / WEBP 格式' }
  let buf: Buffer
  try { buf = readFileSync(input) } catch (e: any) { return { buf: Buffer.alloc(0), ext, mime: mimeOfExt(ext), compressed: false, error: '读取图片失败：' + (e?.message || e) } }
  const cmp = maybeCompress(buf, ext)
  if (cmp.error === 'cannot_decode') return { buf: Buffer.alloc(0), ext, mime: mimeOfExt(ext), compressed: false, error: '图片格式无法解析，请检查文件是否损坏' }
  if (cmp.error === 'still_too_large') return { buf: Buffer.alloc(0), ext, mime: mimeOfExt(ext), compressed: false, error: `图片过大，自动压缩后仍超过 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB` }
  return { buf: cmp.buf, ext: cmp.ext, mime: cmp.mime, compressed: cmp.compressed }
}

function appendImage(fd: FormData, field: string, loaded: { buf: Buffer; ext: string; mime: string }, filename: string): void {
  const blob = new Blob([new Uint8Array(loaded.buf)], { type: loaded.mime })
  fd.append(field, blob, `${filename}.${loaded.ext === 'jpg' ? 'jpg' : loaded.ext}`)
}

export async function submitCreativeTemplate(params: SubmitCreativeTemplateParams): Promise<SubmitCreativeTemplateResult> {
  const token = getCloudToken()
  if (!token) return { ok: false, error: '未登录云控账号，无法投稿' }

  const template = getTemplate(params.templateId)
  if (!template) return { ok: false, error: '模板不存在或已被删除' }
  if (!params.cloudCategoryId) return { ok: false, error: '请选择云端分类' }
  if (!template.title.trim()) return { ok: false, error: '模板标题不能为空' }
  if (!template.prompt_template.trim()) return { ok: false, error: '模板提示词不能为空' }

  const fd = new FormData()
  fd.append('local_template_id', template.id)
  fd.append('category_id', String(params.cloudCategoryId))
  fd.append('title', template.title.trim())
  fd.append('description', template.description || '')
  fd.append('requires_ref_image', template.requires_ref_image ? '1' : '0')
  fd.append('default_size', template.default_size || '')
  fd.append('prompt_template', template.prompt_template)
  fd.append('variables', JSON.stringify(template.variables || []))
  fd.append('source_type', template.source_type || 'manual')
  if (/^\d+$/.test(String(template.source_inspiration_id || ''))) {
    fd.append('source_inspiration_id', String(template.source_inspiration_id))
  }

  let compressed = false
  const coverSource = template.cover_image || template.example_ref_images[0] || ''
  if (coverSource) {
    const loaded = await loadImageForUpload(coverSource)
    if (loaded.error) return { ok: false, error: '封面图：' + loaded.error }
    compressed = compressed || loaded.compressed
    appendImage(fd, 'cover_image', loaded, 'cover')
    // 附带封面缩略图（网格列表用），失败则跳过、云端回退原图
    const coverThumb = makeUploadThumbnailBlob(loaded.buf, 720)
    if (coverThumb) {
      fd.append('cover_thumb', coverThumb.blob, coverThumb.filename)
    }
  }

  if (template.source_image) {
    const loaded = await loadImageForUpload(template.source_image)
    if (loaded.error) return { ok: false, error: '来源图：' + loaded.error }
    compressed = compressed || loaded.compressed
    appendImage(fd, 'source_image', loaded, 'source')
  }

  for (const [index, refImage] of (template.example_ref_images || []).slice(0, 8).entries()) {
    const loaded = await loadImageForUpload(refImage)
    if (loaded.error) return { ok: false, error: `示例参考图 ${index + 1}：` + loaded.error }
    compressed = compressed || loaded.compressed
    appendImage(fd, 'example_ref_images[]', loaded, `ref-${index + 1}`)
  }

  const url = `${getCloudApiBase()}/client/creative-templates/submit`
  let resp: Response
  try {
    resp = await fetchWithCloudAuth(url, { method: 'POST', body: fd }, '创意模板投稿 401')
  } catch (e: any) {
    return { ok: false, error: '网络请求失败：' + (e?.message || '未知错误') }
  }

  let json: any = null
  try { json = await resp.json() } catch {}

  if (resp.status === 401) return { ok: false, error: '登录已过期，请重新登录' }
  if (resp.status === 403) return { ok: false, error: json?.message || '当前账号未开启灵感大王权限' }
  if (resp.status === 409) {
    updateTemplateSubmissionState(template.id, {
      cloudTemplateId: Number(json?.cloud_template_id || 0),
      status: String(json?.submission_status || 'pending') as any,
      rejectReason: '',
      reviewedAt: '',
      publishedAt: '',
    })
    return { ok: false, error: '该模板已投稿，请等待审核或刷新状态', data: json }
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
  if (!resp.ok) return { ok: false, error: cloudErrorText(resp.status, json, '请求失败') }

  updateTemplateSubmissionState(template.id, {
    cloudTemplateId: Number(json?.cloud_template_id || 0),
    status: String(json?.submission_status || 'pending') as any,
    rejectReason: '',
    reviewedAt: '',
    publishedAt: '',
  })

  return { ok: true, data: json, compressed }
}

export async function syncCreativeTemplateSubmissionStatus(templateIds: string[]): Promise<SyncCreativeTemplateSubmissionResult> {
  const token = getCloudToken()
  if (!token) return { ok: false, error: '未登录云控账号' }
  const ids = Array.from(new Set(templateIds.map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 100)
  if (!ids.length) return { ok: true, items: [] }

  const url = `${getCloudApiBase()}/client/creative-templates/status-batch`
  let resp: Response
  try {
    resp = await fetchWithCloudAuth(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }, '创意模板投稿状态 401')
  } catch (e: any) {
    return { ok: false, error: '网络请求失败：' + (e?.message || '未知错误') }
  }

  let json: any = null
  try { json = await resp.json() } catch {}
  if (!resp.ok) return { ok: false, error: cloudErrorText(resp.status, json, '请求失败') }

  const items = Array.isArray(json?.items) ? json.items : []
  for (const item of items) {
    const localId = String(item?.local_template_id || '')
    if (!localId) continue
    updateTemplateSubmissionState(localId, {
      cloudTemplateId: Number(item?.cloud_template_id || 0),
      status: String(item?.submission_status || '') as any,
      rejectReason: String(item?.reject_reason || ''),
      reviewedAt: String(item?.reviewed_at || ''),
      publishedAt: String(item?.published_at || ''),
    })
  }
  return { ok: true, items }
}

export async function withdrawCreativeTemplateSubmission(templateId: string): Promise<SubmitCreativeTemplateResult> {
  const token = getCloudToken()
  if (!token) return { ok: false, error: '未登录云控账号' }
  const template = getTemplate(templateId)
  if (!template) return { ok: false, error: '模板不存在或已被删除' }

  const url = `${getCloudApiBase()}/client/creative-templates/${encodeURIComponent(template.id)}/submit`
  let resp: Response
  try {
    resp = await fetchWithCloudAuth(url, { method: 'DELETE' }, '创意模板撤回 401')
  } catch (e: any) {
    return { ok: false, error: '网络请求失败：' + (e?.message || '未知错误') }
  }

  let json: any = null
  try { json = await resp.json() } catch {}
  if (!resp.ok) return { ok: false, error: cloudErrorText(resp.status, json, '请求失败') }

  updateTemplateSubmissionState(template.id, {
    status: 'withdrawn',
    rejectReason: '',
    reviewedAt: '',
    publishedAt: '',
  })
  return { ok: true, data: json }
}
