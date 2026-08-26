import { nativeImage } from 'electron'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getDataDir } from './data-path'

/**
 * 图片缩略图缓存服务。
 *
 * 设计要点：
 *  - 缓存目录：dataDir/.thumb-cache/<sha1(absPath + mtime)>.jpg
 *  - 命中即返回，未命中调用 Electron 原生 nativeImage 生成 JPEG（85% 质量）
 *  - 失败/解码异常时返回原图字节，避免页面空图
 *  - mtime 编入 hash → 文件被替换后自动失效，无需手动清理
 */

const THUMB_DIR = '.thumb-cache'
const THUMB_MAX = 360 // 网格视图够用，4 列 360 / 6 列 360 都不会糊
const PLACEHOLDER = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="#f1f5f9"/><rect x="6" y="7" width="20" height="18" rx="3" fill="#e2e8f0"/><path d="M8 22l5-6 4 4 3-3 4 5H8z" fill="#cbd5e1"/><circle cx="20.5" cy="12.5" r="2.5" fill="#cbd5e1"/></svg>')
const queue: string[] = []
const pending = new Map<string, { promise: Promise<boolean>; resolve: (ok: boolean) => void }>()
let processing = false

function thumbCacheDir(): string {
  const dir = join(getDataDir(), THUMB_DIR)
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }) } catch {}
  }
  return dir
}

function cacheKey(absPath: string): string {
  let mtime = 0
  try { mtime = statSync(absPath).mtimeMs } catch {}
  return createHash('sha1').update(`${absPath}|${mtime}`).digest('hex')
}

function cachePath(absPath: string): string {
  return join(thumbCacheDir(), cacheKey(absPath) + '.jpg')
}

function generateThumbnailBytes(absPath: string): { data: Buffer; mime: string } | null {
  try {
    // nativeImage 直接读原图 → resize → 输出 JPEG
    // 大图（>20MB）解码会慢，但只发生一次，之后命中缓存
    const img = nativeImage.createFromPath(absPath)
    if (img.isEmpty()) return null

    const size = img.getSize()
    const longSide = Math.max(size.width, size.height)
    const resized = longSide > THUMB_MAX
      ? img.resize({
          width: size.width >= size.height ? THUMB_MAX : Math.round((size.width / size.height) * THUMB_MAX),
          height: size.height > size.width ? THUMB_MAX : Math.round((size.height / size.width) * THUMB_MAX),
          quality: 'good'
        })
      : img

    const buf = resized.toJPEG(85)
    if (!buf.length) return null

    try { writeFileSync(cachePath(absPath), buf) } catch {}
    return { data: buf, mime: 'image/jpeg' }
  } catch (e) {
    console.error('[thumbnail] generate failed for', absPath, e)
    return null
  }
}

function scheduleQueue(): void {
  if (processing) return
  const absPath = queue.shift()
  if (!absPath) return
  processing = true
  setTimeout(() => {
    let ok = false
    try {
      ok = !!getThumbnailBytes(absPath, true)
    } finally {
      const item = pending.get(absPath)
      if (item) {
        item.resolve(ok)
        pending.delete(absPath)
      }
      processing = false
      scheduleQueue()
    }
  }, 16)
}

/**
 * 获取缩略图字节。同步接口，便于直接对接 protocol.handle。
 * 命中缓存时近乎瞬时；首次生成走 Electron nativeImage，单张约 5-30ms。
 */
export function getThumbnailBytes(absPath: string, generateIfMissing = true): { data: Buffer; mime: string } | null {
  if (!existsSync(absPath)) return null

  const cached = cachePath(absPath)
  if (existsSync(cached)) {
    try {
      return { data: readFileSync(cached), mime: 'image/jpeg' }
    } catch {
      // 缓存读失败回退重生成
    }
  }

  if (!generateIfMissing) return null
  return generateThumbnailBytes(absPath)
}

export function getThumbnailPlaceholderBytes(): { data: Buffer; mime: string } {
  return { data: PLACEHOLDER, mime: 'image/svg+xml' }
}

export function queueThumbnail(absPath: string): Promise<boolean> {
  if (!absPath || !existsSync(absPath)) return Promise.resolve(false)
  if (getThumbnailBytes(absPath, false)) return Promise.resolve(true)
  const current = pending.get(absPath)
  if (current) return current.promise

  let resolve!: (ok: boolean) => void
  const promise = new Promise<boolean>((r) => { resolve = r })
  pending.set(absPath, { promise, resolve })
  queue.push(absPath)
  scheduleQueue()
  return promise
}

export async function preloadThumbnails(absPaths: string[]): Promise<{ ready: number; queued: number; failed: number }> {
  const unique = Array.from(new Set(absPaths.filter(Boolean)))
  let ready = 0
  let queued = 0
  const tasks = unique.map((absPath) => {
    if (getThumbnailBytes(absPath, false)) {
      ready++
      return Promise.resolve(true)
    }
    queued++
    return queueThumbnail(absPath)
  })
  const results = await Promise.all(tasks)
  const generated = results.filter(Boolean).length - ready
  return { ready: ready + Math.max(0, generated), queued, failed: results.filter((ok) => !ok).length }
}
