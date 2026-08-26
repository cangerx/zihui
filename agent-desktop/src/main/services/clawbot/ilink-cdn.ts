// iLink CDN 媒体传输：AES-128-ECB 加解密、媒体下载与加密上传。
// 规则（官方 npm 包 src/cdn/*）：
//   - 密钥两编码兼容：aes_key base64 解出 16 字节→直接作 key（图片）；
//     解出 32 字符 hex 串→再 fromhex 得 16 字节（文件/语音/视频）；ImageItem.aeskey(hex) 入站优先。
//   - 密文 = AES-128-ECB(明文) + PKCS7；上传后从响应头 x-encrypted-param 取下载参数（缺失视为失败）。
//   - 上传重试最多 3 次：4xx 立即失败不重试，5xx/网络错误重试。

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { ILINK_CDN_BASE } from './ilink-api'
import type { CDNMedia } from './ilink-types'

const FETCH_TIMEOUT_MS = 30000
const UPLOAD_MAX_RETRY = 3

/** 解析 AES key：入站图片优先传 aesKeyHex（ImageItem.aeskey），否则解析 media.aes_key */
export function resolveAesKey(media?: CDNMedia, aesKeyHex?: string): Buffer | null {
  if (aesKeyHex) {
    const b = Buffer.from(aesKeyHex, 'hex')
    if (b.length === 16) return b
  }
  const b64 = media?.aes_key
  if (!b64) return null
  const raw = Buffer.from(b64, 'base64')
  if (raw.length === 16) return raw
  const asHex = raw.toString('utf8')
  if (/^[0-9a-fA-F]{32}$/.test(asHex)) {
    const b = Buffer.from(asHex, 'hex')
    if (b.length === 16) return b
  }
  return null
}

export function decryptAesEcb(cipher: Buffer, key: Buffer): Buffer {
  const d = createDecipheriv('aes-128-ecb', key, null)
  d.setAutoPadding(true)
  return Buffer.concat([d.update(cipher), d.final()])
}

export function encryptAesEcb(plain: Buffer, key: Buffer): Buffer {
  const c = createCipheriv('aes-128-ecb', key, null)
  c.setAutoPadding(true)
  return Buffer.concat([c.update(plain), c.final()])
}

export function md5Hex(buf: Buffer): string {
  return createHash('md5').update(buf).digest('hex')
}

export function randomAesKeyHex(): string {
  return randomBytes(16).toString('hex')
}

export function randomFilekey(): string {
  return randomBytes(16).toString('hex')
}

async function fetchBuffer(url: string, init: RequestInit, timeoutMs: number): Promise<{ resp: Response; buf: Buffer }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, { ...init, signal: ctrl.signal })
    const ab = await resp.arrayBuffer()
    return { resp, buf: Buffer.from(ab) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 下载并解密入站媒体。full_url 优先；缺省回退拼接 {cdnBase}/download?encrypted_query_param=...。
 * 返回明文 Buffer；无 key 时（个别媒体不加密）返回原始内容。
 */
export async function downloadMedia(media: CDNMedia, aesKeyHex?: string, cdnBase?: string): Promise<Buffer> {
  const url = media.full_url
    || `${(cdnBase || ILINK_CDN_BASE).replace(/\/+$/, '')}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param || '')}`
  const { resp, buf } = await fetchBuffer(url, { method: 'GET' }, FETCH_TIMEOUT_MS)
  if (!resp.ok) throw new Error(`cdn download http ${resp.status}`)
  const key = resolveAesKey(media, aesKeyHex)
  if (!key) return buf
  return decryptAesEcb(buf, key)
}

export interface PreparedUpload {
  /** 16 字节随机 hex */
  filekey: string
  /** 16 字节 key 的 hex（传给 getuploadurl 的 aeskey 字段） */
  aeskeyHex: string
  /** 明文大小 */
  rawsize: number
  /** 明文 MD5 hex */
  rawfilemd5: string
  /** PKCS7 后密文大小 */
  filesize: number
  /** 密文 */
  cipher: Buffer
}

export function prepareUpload(plain: Buffer): PreparedUpload {
  const aeskeyHex = randomAesKeyHex()
  const key = Buffer.from(aeskeyHex, 'hex')
  const cipher = encryptAesEcb(plain, key)
  return {
    filekey: randomFilekey(),
    aeskeyHex,
    rawsize: plain.length,
    rawfilemd5: md5Hex(plain),
    filesize: cipher.length,
    cipher
  }
}

class CdnUploadError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'CdnUploadError'
  }
}

/**
 * 上传密文到 CDN。成功（200）时从响应头 x-encrypted-param 取下载参数（缺失视为失败）；
 * 错误信息在响应头 x-error-message（4xx 回退响应体）。返回 encrypt_query_param（填进出站 item 的 media）。
 */
export async function uploadEncryptedMedia(params: {
  uploadFullUrl?: string
  uploadParam?: string
  filekey: string
  cipher: Buffer
  cdnBase?: string
}): Promise<string> {
  const url = params.uploadFullUrl
    || `${(params.cdnBase || ILINK_CDN_BASE).replace(/\/+$/, '')}/upload?encrypted_query_param=${encodeURIComponent(params.uploadParam || '')}&filekey=${encodeURIComponent(params.filekey)}`
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= UPLOAD_MAX_RETRY; attempt++) {
    try {
      const { resp } = await fetchBuffer(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(params.cipher)
      }, FETCH_TIMEOUT_MS)
      if (resp.ok) {
        const encryptedParam = resp.headers.get('x-encrypted-param')
        if (!encryptedParam) throw new CdnUploadError('cdn upload ok but x-encrypted-param missing')
        return encryptedParam
      }
      const errMsg = resp.headers.get('x-error-message') || `http ${resp.status}`
      throw new CdnUploadError(`cdn upload failed: ${errMsg}`, resp.status)
    } catch (e: any) {
      lastError = e instanceof Error ? e : new Error(String(e))
      // 4xx 立即失败不重试；5xx/网络错误进入下一轮
      if (e instanceof CdnUploadError && e.status !== undefined && e.status >= 400 && e.status < 500) throw e
    }
  }
  throw lastError || new Error('cdn upload failed')
}
