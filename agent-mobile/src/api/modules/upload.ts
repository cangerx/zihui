/**
 * 文件上传：Prepare → 直传 → Complete，见 docs/API开发文档.md §3.3
 * 小程序无 File 对象，统一以本地临时路径 + uni.getFileInfo 处理。
 */
import { request, uploadFile } from '../request'
import { requireApiBase, USE_MOCK } from '../config'
import { appV1Client } from '../v1-client'
import type { AppAsset } from '@zihui/contracts'
import type { PrepareUploadResult, UploadedFile } from '../types'

function extOf(path: string): string {
  const match = /\.([a-zA-Z0-9]+)(?:\?|#|$)/.exec(path)
  return match ? match[1].toLowerCase() : 'jpg'
}

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
}

/** 文件大小 + md5（小程序 getFileInfo 支持 digestAlgorithm: 'md5'） */
function getFileInfo(filePath: string): Promise<{ size: number; digest: string }> {
  return new Promise((resolve) => {
    // #ifdef MP-WEIXIN
    uni.getFileInfo({
      filePath,
      digestAlgorithm: 'md5',
      success: (res) => resolve({ size: res.size || 0, digest: (res as { digest?: string }).digest || '' }),
      fail: () => resolve({ size: 0, digest: '' }),
    })
    // #endif
    // #ifndef MP-WEIXIN
    uni.getFileInfo({
      filePath,
      success: (res) => resolve({ size: res.size || 0, digest: '' }),
      fail: () => resolve({ size: 0, digest: '' }),
    })
    // #endif
  })
}

function resolveUploadUrl(uploadUrl: string): string {
  if (/^https?:\/\//.test(uploadUrl)) return uploadUrl
  return `${requireApiBase()}/filesystem${uploadUrl}`
}

/**
 * 读本地文件为 ArrayBuffer（put-presigned 直传需要二进制体）。
 * 之前 put-presigned 分支直接 `data: filePath`，PUT 上去的是路径字符串而非文件内容。
 * 注：真实后端返回 put-presigned 时才走到这里，mock 不触发，本改动只验编译，
 * 运行时待联调真实对象存储验证。
 */
function readFileBuffer(filePath: string): Promise<ArrayBuffer | null> {
  // #ifdef MP-WEIXIN
  return new Promise((resolve) => {
    uni.getFileSystemManager().readFile({
      filePath,
      success: (res) => resolve(res.data as ArrayBuffer),
      fail: () => resolve(null),
    })
  })
  // #endif
  // #ifndef MP-WEIXIN
  // H5：filePath 是 blob/临时 URL，fetch 后取 arrayBuffer
  return fetch(filePath)
    .then((r) => r.arrayBuffer())
    .catch(() => null)
  // #endif
}

/** put-presigned / post-policy 直传，不走签名头 */
async function directUpload(prepare: PrepareUploadResult, filePath: string): Promise<boolean> {
  const url = resolveUploadUrl(prepare.upload_url || '')
  if (prepare.upload_type === 'put-presigned') {
    const buffer = await readFileBuffer(filePath)
    if (!buffer) return false
    return new Promise((resolve) => {
      uni.request({
        url,
        method: 'PUT',
        header: prepare.headers || {},
        // PUT 文件二进制（ArrayBuffer），不是路径字符串
        data: buffer,
        success: (res) => resolve(res.statusCode >= 200 && res.statusCode < 300),
        fail: () => resolve(false),
      })
    })
  }
  // post-policy：FormData
  return new Promise((resolve) => {
    uni.uploadFile({
      url,
      filePath,
      name: 'file',
      formData: (prepare.fields || {}) as Record<string, never>,
      success: (res) => resolve(res.statusCode >= 200 && res.statusCode < 300),
      fail: () => resolve(false),
    })
  })
}

function normalize(file: Record<string, unknown> | undefined, fallbackName: string): UploadedFile {
  const raw = file || {}
  return {
    uuid: String(raw.uuid || raw.file_uuid || ''),
    url: String(raw.url || raw.file_url || ''),
    size: Number(raw.size || 0),
    filename: String(raw.filename || raw.original_name || fallbackName),
    name: String(raw.name || raw.filename || fallbackName),
    mime: String(raw.mime || raw.mime_type || ''),
  }
}

/**
 * 上传单张图片，返回远端可用 URL
 * mock 模式下直接回传本地临时路径，保证 UI 链路可走通
 */
export async function uploadImage(filePath: string): Promise<UploadedFile | null> {
  if (USE_MOCK) {
    const info = await getFileInfo(filePath)
    return {
      uuid: `mock-${Date.now()}`,
      url: filePath,
      size: info.size,
      filename: filePath.split('/').pop() || 'image.jpg',
      name: filePath.split('/').pop() || 'image.jpg',
      mime: MIME_MAP[extOf(filePath)] || 'image/jpeg',
    }
  }

  const info = await getFileInfo(filePath)
  const extension = extOf(filePath)
  const originalName = filePath.split('/').pop() || `image.${extension}`

  const prepareRes = await request<PrepareUploadResult>({
    path: '/filesystem/file/PrepareUpload',
    method: 'POST',
    argument: {
      provider_key: '',
      scene: 'image',
      parent_uuid: '',
      parent_path: '/',
      original_name: originalName,
      extension,
      mime_type: MIME_MAP[extension] || 'image/jpeg',
      size: info.size,
      md5: info.digest,
    },
  })
  if (prepareRes.code !== 200 || !prepareRes.data) return null
  const prepare = prepareRes.data

  // 秒传
  if (prepare.mode === 'instant') {
    return normalize(prepare.file as Record<string, unknown>, originalName)
  }

  if (prepare.upload_type === 'kit-direct') {
    const res = await uploadFile({
      path: prepare.upload_url || '/filesystem/file/Upload',
      filePath,
      formData: { upload_ticket: prepare.upload_ticket || '' },
    })
    if (res.code !== 200) return null
  } else {
    const ok = await directUpload(prepare, filePath)
    if (!ok) {
      uni.showToast({ title: '图片上传失败', icon: 'none' })
      return null
    }
  }

  const completeRes = await request<Record<string, unknown>>({
    path: '/filesystem/file/CompleteUpload',
    method: 'POST',
    argument: { upload_ticket: prepare.upload_ticket || '' },
  })
  if (completeRes.code !== 200) return null
  return normalize(completeRes.data, originalName)
}

/** 批量上传，任一失败返回 null */
export async function uploadImages(filePaths: string[]): Promise<string[] | null> {
  const urls: string[] = []
  for (const path of filePaths) {
    // 已是远端地址则跳过
    if (/^https?:\/\//.test(path)) {
      urls.push(path)
      continue
    }
    const uploaded = await uploadImage(path)
    if (!uploaded) return null
    urls.push(uploaded.url)
  }
  return urls
}

/** App v1 生产资产上传：presign -> signed binary PUT -> complete。 */
export async function uploadAppAsset(filePath: string): Promise<AppAsset | null> {
  if (USE_MOCK) {
    const uploaded = await uploadImage(filePath)
    if (!uploaded) return null
    return {
      id: uploaded.uuid,
      kind: 'image',
      status: 'ready',
      mime: uploaded.mime,
      size: uploaded.size,
      sha256: '',
      display_url: uploaded.url,
      display_url_expires_at: new Date(Date.now() + 600000).toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }
  }

  const info = await getFileInfo(filePath)
  const extension = extOf(filePath)
  const mime = MIME_MAP[extension] || 'image/jpeg'
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) || !info.size) return null
  const filename = filePath.split('/').pop() || `image.${extension}`
  const instruction = await appV1Client.presignAsset({ filename, mime_type: mime as 'image/jpeg' | 'image/png' | 'image/webp', size: info.size })
  const buffer = await readFileBuffer(filePath)
  if (!buffer) return null
  await appV1Client.uploadAssetContent(instruction.upload_url, buffer, instruction.headers)
  return appV1Client.completeAsset(instruction.id)
}

export async function uploadAppAssets(filePaths: string[]): Promise<AppAsset[] | null> {
  const assets: AppAsset[] = []
  for (const path of filePaths) {
    if (/^https?:\/\//.test(path)) return null
    const asset = await uploadAppAsset(path)
    if (!asset) return null
    assets.push(asset)
  }
  return assets
}
