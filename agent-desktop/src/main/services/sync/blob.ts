import { createHash } from 'crypto'
import { join } from 'path'
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  unlinkSync,
  openSync,
  readSync,
  writeSync,
  closeSync,
  statSync,
} from 'fs'
import { getDatabase } from '../../database'
import { getDataDir } from '../data-path'
import type { BlobRef, SyncCategory, SyncScope } from './types'
import { checkBlobs, uploadBlobFromFile, downloadBlobToFile } from './api'

const HASH_CHUNK = 1024 * 1024 // 1MB 流式哈希/复制缓冲

// 内容寻址媒体缓存：dataDir/sync-media/{sha256}.{ext}
// 上传/下载均以 sha256 去重；本地索引表 sync_blob_local 记录是否已上云。

export class QuotaExceededError extends Error {
  constructor() {
    super('storage_quota_exceeded')
    this.name = 'QuotaExceededError'
  }
}

function mediaDir(): string {
  const dir = join(getDataDir(), 'sync-media')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function blobPath(sha: string, ext: string): string {
  return join(mediaDir(), `${sha}.${ext}`)
}

function registerLocal(sha: string, size: number, category: SyncCategory, ext: string, uploaded: boolean): void {
  const db = getDatabase()
  db.prepare(
    `INSERT INTO sync_blob_local(sha256, size, category, ext, uploaded, created_ms)
     VALUES(?, ?, ?, ?, ?, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
     ON CONFLICT(sha256) DO UPDATE SET uploaded = MAX(sync_blob_local.uploaded, excluded.uploaded)`,
  ).run(sha, size, category, ext, uploaded ? 1 : 0)
}

function markUploaded(sha: string): void {
  getDatabase().prepare('UPDATE sync_blob_local SET uploaded = 1 WHERE sha256 = ?').run(sha)
}

function recordPending(ref: BlobRef): void {
  getDatabase()
    .prepare(
      `INSERT INTO sync_blob_pending(sha256, ext, category, created_ms)
       VALUES(?, ?, ?, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
       ON CONFLICT(sha256) DO NOTHING`,
    )
    .run(ref.sha256, ref.ext, ref.category)
}

function clearPending(sha: string): void {
  getDatabase().prepare('DELETE FROM sync_blob_pending WHERE sha256 = ?').run(sha)
}

function inScope(category: SyncCategory, scope: SyncScope): boolean {
  if (category === 'image') return scope.image
  if (category === 'video') return scope.video
  return true
}

/** 同步分块计算文件 sha256 与大小（不整体入内存）。 */
function hashFileSync(absPath: string): { sha256: string; size: number } {
  const fd = openSync(absPath, 'r')
  try {
    const hash = createHash('sha256')
    const buf = Buffer.allocUnsafe(HASH_CHUNK)
    let size = 0
    let n: number
    // 顺序读取，position=null 从当前偏移连续推进
    while ((n = readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, n))
      size += n
    }
    return { sha256: hash.digest('hex'), size }
  } finally {
    closeSync(fd)
  }
}

/** 同步流式复制（copyFileSync 失败时的兜底，仍不整体入内存）。 */
function copyFileStreamSync(src: string, dest: string): void {
  const inFd = openSync(src, 'r')
  const outFd = openSync(dest, 'w')
  try {
    const buf = Buffer.allocUnsafe(HASH_CHUNK)
    let n: number
    while ((n = readSync(inFd, buf, 0, buf.length, null)) > 0) {
      writeSync(outFd, buf, 0, n)
    }
  } finally {
    closeSync(inFd)
    closeSync(outFd)
  }
}

/** 从路径取扩展名（仅看文件名段；无扩展名回退 bin，避免把整段路径当 ext）。 */
function extOfPath(absPath: string): string {
  const base = absPath.split(/[\\/]/).pop() || ''
  const dot = base.lastIndexOf('.')
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : 'bin'
}

/** 把本地文件登记为 blob（流式哈希 + OS 级复制到缓存），返回 sha256 与大小。serializer 同步调用。 */
export function ingestFile(absPath: string, category: SyncCategory): { sha256: string; size: number } {
  const { sha256: sha, size } = hashFileSync(absPath)
  const ext = extOfPath(absPath)
  const dest = blobPath(sha, ext)
  if (!existsSync(dest)) {
    try {
      copyFileSync(absPath, dest) // OS 级复制，不入 JS 内存
    } catch {
      try {
        copyFileStreamSync(absPath, dest)
      } catch {
        // 复制失败：dest 不存在，上传时会因找不到文件跳过，下次重试
      }
    }
  }
  registerLocal(sha, size, category, ext, false)
  return { sha256: sha, size }
}

/** 把内存字节登记为 blob（data URL 解码后）。 */
export function ingestBytes(bytes: Buffer, category: SyncCategory, ext: string): { sha256: string; size: number } {
  const sha = createHash('sha256').update(bytes).digest('hex')
  const safeExt = (ext || 'bin').toLowerCase()
  const dest = blobPath(sha, safeExt)
  if (!existsSync(dest)) writeFileSync(dest, bytes)
  registerLocal(sha, bytes.length, category, safeExt, false)
  return { sha256: sha, size: bytes.length }
}

/** 同步检查本地是否已有该 blob，有则返回绝对路径，无则空串（不触发网络）。 */
export function ensureLocalBlob(ref: BlobRef): string {
  const p = blobPath(ref.sha256, ref.ext)
  return existsSync(p) ? p : ''
}

function hasLocal(ref: BlobRef): boolean {
  return existsSync(blobPath(ref.sha256, ref.ext))
}

/**
 * 上传一批被引用的 blob（秒传：先 check 云端缺失，再传缺的）。容量超限抛 QuotaExceededError。
 * 返回「本地与云端都不存在、当前不可得」的 sha 集合，调用方应挂起引用它们的变更，
 * 避免推送悬空引用导致其它设备永久 404 重试。
 */
export async function uploadReferenced(
  refs: BlobRef[],
  onProgress?: (done: number, total: number) => void,
): Promise<Set<string>> {
  const unavailable = new Set<string>()
  const uniq = new Map<string, BlobRef>()
  for (const r of refs) if (!uniq.has(r.sha256)) uniq.set(r.sha256, r)
  const list = [...uniq.values()]
  if (list.length === 0) return unavailable

  const check = await checkBlobs(list.map((r) => ({ sha256: r.sha256, size: r.size, category: r.category })))
  if (check.quota_exceeded) throw new QuotaExceededError()
  const missing = new Set(check.missing)

  let done = 0
  for (const ref of list) {
    if (missing.has(ref.sha256)) {
      const p = blobPath(ref.sha256, ref.ext)
      if (existsSync(p)) {
        const size = ref.size > 0 ? ref.size : statSync(p).size
        const ok = await uploadBlobFromFile(ref.sha256, p, size, ref.category, ref.ext)
        if (!ok) throw new QuotaExceededError()
        markUploaded(ref.sha256)
      } else {
        unavailable.add(ref.sha256)
      }
    } else {
      markUploaded(ref.sha256)
    }
    done++
    onProgress?.(done, list.length)
  }
  return unavailable
}

/** 预取一批 blob 到本地缓存（apply 前调用），缺失的从云端下载。失败静默跳过留待重试。 */
export async function prefetchBlobs(
  refs: BlobRef[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const uniq = new Map<string, BlobRef>()
  for (const r of refs) if (!uniq.has(r.sha256)) uniq.set(r.sha256, r)
  const list = [...uniq.values()].filter((r) => !hasLocal(r))
  let done = 0
  for (const ref of list) {
    try {
      const dest = blobPath(ref.sha256, ref.ext)
      await downloadBlobToFile(ref.sha256, dest)
      registerLocal(ref.sha256, statSync(dest).size, ref.category, ref.ext, true)
      clearPending(ref.sha256)
    } catch {
      // 下载失败：登记待取，下次同步重试，避免媒体永久缺失
      recordPending(ref)
    }
    done++
    onProgress?.(done, list.length)
  }
}

/** 重试此前下载失败的 blob（同步开始时调用）。仅取 in-scope 分类。 */
export async function retryPendingBlobs(scope: SyncScope): Promise<void> {
  const rows = getDatabase()
    .prepare('SELECT sha256, ext, category FROM sync_blob_pending')
    .all() as any[]
  for (const row of rows) {
    const ref: BlobRef = {
      sha256: String(row.sha256),
      ext: String(row.ext),
      category: String(row.category) as SyncCategory,
      size: 0,
    }
    if (existsSync(blobPath(ref.sha256, ref.ext))) {
      clearPending(ref.sha256)
      continue
    }
    if (!inScope(ref.category, scope)) continue
    try {
      const dest = blobPath(ref.sha256, ref.ext)
      await downloadBlobToFile(ref.sha256, dest)
      registerLocal(ref.sha256, statSync(dest).size, ref.category, ref.ext, true)
      clearPending(ref.sha256)
    } catch {
      // 仍失败：保留待取，下次再试
    }
  }
}

/**
 * 本地 blob GC：删除「不再被任何业务行引用」的缓存文件。
 * referencedShas 由 engine 扫描所有业务表的 blob 字段后传入。
 */
export function gcLocalBlobs(referencedShas: Set<string>): number {
  const db = getDatabase()
  const rows = db.prepare('SELECT sha256, ext FROM sync_blob_local').all() as any[]
  let removed = 0
  for (const r of rows) {
    if (referencedShas.has(r.sha256)) continue
    const p = blobPath(r.sha256, r.ext)
    try {
      if (existsSync(p)) {
        unlinkSync(p)
      }
      db.prepare('DELETE FROM sync_blob_local WHERE sha256 = ?').run(r.sha256)
      removed++
    } catch {
      // ignore
    }
  }
  return removed
}

export function localBlobStats(): { count: number; bytes: number; uploaded: number } {
  const db = getDatabase()
  const row = db
    .prepare('SELECT COUNT(*) c, COALESCE(SUM(size),0) b, COALESCE(SUM(uploaded),0) u FROM sync_blob_local')
    .get() as any
  return { count: Number(row.c), bytes: Number(row.b), uploaded: Number(row.u) }
}
