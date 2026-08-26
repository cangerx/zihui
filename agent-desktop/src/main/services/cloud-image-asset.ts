import { createHash } from 'crypto'
import { getCloudToken, getCloudApiBase } from './cloud-token'

/**
 * 云控端临时图片素材上传 —— 把图片字节换成公网 https URL。
 *
 * 统一供「生图参考图」（多米 / 云端通道）与「视觉发图」（图生词 / 聊天看图 / 画布关键帧分析）
 * 共用：链路上不再把图片以 base64 内联或直传，统一先落云控端临时存储换 URL 再发。
 * 端点 /client/images/reference-assets 落对象存储后返回 URL，临时图 6h 后由云控端
 * video:purge-reference-assets 定时清理，不会堆积。依赖桌面端已登录云控端。
 */

/** 轻量带超时 fetch（上传场景独立实现，不复用 image-generation 的私有版本以免循环依赖） */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function readResponseError(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return `HTTP ${res.status}`
  }
}

function extFromMime(mimeType: string): string {
  const mime = (mimeType || '').toLowerCase()
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  return 'png'
}

/**
 * 把图片字节上传到云控端临时存储，换取公网 https URL。失败抛错由调用方决定回退策略。
 */
export async function uploadImageBytesToCloud(buffer: Buffer, mimeType: string): Promise<string> {
  const token = getCloudToken()
  if (!token) {
    throw new Error('参考图需先上传云端换取 URL，但云端登录已失效，请重新登录后重试')
  }

  const ext = extFromMime(mimeType)
  const form = new FormData()
  // Buffer 作为 Uint8Array 子类运行时可作 BlobPart，编译期类型不互通故 as unknown 断言（同生图 multipart 路径）。
  const blob = new Blob([buffer as unknown as BlobPart], { type: mimeType })
  form.append('file', blob, `ref.${ext}`)

  const uploadUrl = `${getCloudApiBase()}/client/images/reference-assets`
  const res = await fetchWithTimeout(uploadUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: form
  }, 60_000)

  if (!res.ok) {
    throw new Error(`参考图上传失败 HTTP ${res.status}: ${await readResponseError(res)}`)
  }

  const data: any = await res.json().catch(() => null)
  const url = data?.url || data?.asset?.storage_url
  if (!url || typeof url !== 'string') {
    throw new Error('参考图上传响应缺少 url 字段')
  }
  return url
}

// dataURI 内容指纹 → 已换取的云端 URL 缓存：避免多轮对话里同一张内联图被重复上传。
// 临时图云端 6h 过期，缓存 TTL 取 5h 留余量；超时项惰性失效后重新上传换新 URL。
const CACHE_TTL_MS = 5 * 60 * 60 * 1000
const dataUriUrlCache = new Map<string, { url: string; ts: number }>()

function fingerprint(b64: string): string {
  return createHash('sha1').update(b64).digest('hex')
}

/**
 * 解析 dataURI / 裸 base64，上传换 https URL；已是 http(s) URL 的原样返回。
 * 命中内存缓存（按内容指纹 + TTL）则直接复用，避免重复上传。
 */
export async function uploadDataUriToCloud(input: string): Promise<string> {
  const value = (input || '').trim()
  if (!value) return value
  if (/^https?:\/\//i.test(value)) return value

  const match = value.match(/^data:([^;]+);base64,/)
  let mimeType = 'image/png'
  let b64 = value
  if (match) {
    mimeType = match[1]
    b64 = value.slice(match[0].length)
  }
  if (!b64) return value

  const key = fingerprint(b64)
  const cached = dataUriUrlCache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.url
  }

  const buffer = Buffer.from(b64, 'base64')
  if (buffer.length === 0) return value

  const url = await uploadImageBytesToCloud(buffer, mimeType)
  dataUriUrlCache.set(key, { url, ts: Date.now() })
  return url
}
