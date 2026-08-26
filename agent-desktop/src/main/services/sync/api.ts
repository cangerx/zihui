import { openSync, readSync, closeSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync } from 'fs'
import { dirname } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'
import { fetchWithCloudAuth, getCloudApiBase } from '../cloud-token'
import { getDeviceId } from '../device-id'
import type { PushChange, PushResult, RemoteChange, QuotaInfo } from './types'

// 云端同步 API 封装（client/sync/*）。全部走 fetchWithCloudAuth（自动带 JWT + 401 刷新）。

function syncBase(): string {
  return `${getCloudApiBase()}/client/sync`
}

async function postJson<T>(path: string, body: any): Promise<{ status: number; data: T | null }> {
  const res = await fetchWithCloudAuth(`${syncBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data: any = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  return { status: res.status, data }
}

export interface PullResponse {
  changes: RemoteChange[]
  max_seq: number
  has_more: boolean
}

export async function pull(sinceSeq: number, limit = 500): Promise<PullResponse> {
  const { status, data } = await postJson<PullResponse>('/pull', { since_seq: sinceSeq, limit })
  if (status !== 200 || !data) throw new Error(`sync pull failed: HTTP ${status}`)
  return {
    changes: Array.isArray(data.changes) ? data.changes : [],
    max_seq: Number(data.max_seq || sinceSeq),
    has_more: !!data.has_more,
  }
}

export interface PushResponse {
  results: PushResult[]
  new_max_seq: number
  /** 需要先 pull（期间其它设备推过新变更） */
  needPull?: boolean
  serverMaxSeq?: number
  /** 容量超限被拒 */
  quotaExceeded?: boolean
}

export async function push(baseSeq: number, changes: PushChange[]): Promise<PushResponse> {
  let deviceId = ''
  try {
    deviceId = getDeviceId()
  } catch {
    deviceId = ''
  }
  const { status, data } = await postJson<any>('/push', { base_seq: baseSeq, device_id: deviceId, changes })
  if (status === 409) {
    return { results: [], new_max_seq: baseSeq, needPull: true, serverMaxSeq: Number(data?.server_max_seq || baseSeq) }
  }
  if (status === 413) {
    return { results: [], new_max_seq: baseSeq, quotaExceeded: true }
  }
  if (status !== 200 || !data) throw new Error(`sync push failed: HTTP ${status}`)
  return {
    results: Array.isArray(data.results) ? data.results : [],
    new_max_seq: Number(data.new_max_seq || baseSeq),
  }
}

export interface BlobCheckItem {
  sha256: string
  size: number
  category: string
}

export interface BlobCheckResponse {
  missing: string[]
  quota_exceeded: boolean
}

export async function checkBlobs(items: BlobCheckItem[]): Promise<BlobCheckResponse> {
  if (items.length === 0) return { missing: [], quota_exceeded: false }
  const { status, data } = await postJson<BlobCheckResponse>('/blobs/check', { items })
  if (status === 413) return { missing: [], quota_exceeded: true }
  if (status !== 200 || !data) throw new Error(`sync blob check failed: HTTP ${status}`)
  return { missing: Array.isArray(data.missing) ? data.missing : [], quota_exceeded: !!data.quota_exceeded }
}

interface InitResponse {
  upload_id: string
  chunk_size: number
  uploaded_chunks: number[]
}

/**
 * 流式分块断点续传上传一个本地文件 blob（每次仅一个分块入内存，大文件内存友好）。
 * 返回 false 表示容量超限被拒。
 */
export async function uploadBlobFromFile(
  sha256: string,
  absPath: string,
  size: number,
  category: string,
  ext: string,
): Promise<boolean> {
  const initRes = await fetchWithCloudAuth(`${syncBase()}/blobs/${sha256}/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ size, category, ext }),
  })
  if (initRes.status === 413) return false
  if (!initRes.ok) throw new Error(`blob init failed: HTTP ${initRes.status}`)
  const init = (await initRes.json()) as InitResponse
  const chunkSize = Math.max(64 * 1024, Number(init.chunk_size) || 4 * 1024 * 1024)
  const done = new Set((init.uploaded_chunks || []).map(Number))
  const total = Math.max(1, Math.ceil(size / chunkSize))

  const fd = openSync(absPath, 'r')
  try {
    for (let i = 0; i < total; i++) {
      if (done.has(i)) continue
      const start = i * chunkSize
      const len = Math.min(chunkSize, size - start)
      const buf = Buffer.allocUnsafe(len)
      let read = 0
      while (read < len) {
        const n = readSync(fd, buf, read, len - read, start + read)
        if (n <= 0) break
        read += n
      }
      const body = read === len ? buf : buf.subarray(0, read)
      const res = await fetchWithCloudAuth(
        `${syncBase()}/blobs/${sha256}/chunk?upload_id=${encodeURIComponent(init.upload_id)}&index=${i}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(body) },
      )
      if (res.status === 413) return false
      if (!res.ok) throw new Error(`blob chunk ${i} failed: HTTP ${res.status}`)
    }
  } finally {
    closeSync(fd)
  }

  const completeRes = await fetchWithCloudAuth(`${syncBase()}/blobs/${sha256}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_id: init.upload_id, category, ext }),
  })
  if (completeRes.status === 413) return false
  if (!completeRes.ok) throw new Error(`blob complete failed: HTTP ${completeRes.status}`)
  return true
}

/**
 * 流式下载一个 blob 到目标文件（不整体入内存）。服务端对 COS/OSS 返回签名 URL 302，
 * fetch 自动跟随重定向直连对象存储；本地存储则鉴权流式返回。先写 .dltmp 再原子改名。
 */
export async function downloadBlobToFile(sha256: string, destPath: string): Promise<void> {
  const res = await fetchWithCloudAuth(`${syncBase()}/blobs/${sha256}/raw`, { method: 'GET' })
  if (!res.ok) throw new Error(`blob download failed: HTTP ${res.status}`)
  const dir = dirname(destPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${destPath}.dltmp`
  try {
    if (res.body) {
      await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tmp))
    } else {
      const ab = await res.arrayBuffer()
      writeFileSync(tmp, Buffer.from(ab))
    }
    renameSync(tmp, destPath)
  } catch (e) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      // ignore cleanup failure
    }
    throw e
  }
}

export async function getQuota(): Promise<QuotaInfo> {
  const res = await fetchWithCloudAuth(`${syncBase()}/quota`, { method: 'GET' })
  if (!res.ok) throw new Error(`sync quota failed: HTTP ${res.status}`)
  return (await res.json()) as QuotaInfo
}
