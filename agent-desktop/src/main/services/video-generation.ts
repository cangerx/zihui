import { BrowserWindow } from 'electron'
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs'
import { basename, extname, isAbsolute, join, parse, relative, resolve } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { getDatabase } from '../database'
import { getDataDir } from './data-path'
import { runInEpoch } from './account-epoch'

export type VideoDownloadStatus = 'pending' | 'downloading' | 'downloaded' | 'failed' | 'expired' | 'skipped'

export interface VideoReferenceAsset {
  id?: number | string
  asset_type: string
  original_name?: string
  url: string
  role?: string
  index?: number
  label?: string
}

export interface VideoGeneration {
  id: string
  source: string
  provider_id: string
  provider_task_id: string
  protocol_adapter: string
  request_params: Record<string, any>
  cloud_task_id: string
  task_id: string
  provider_protocol: string
  model_id: string
  model_name: string
  sku_key: string
  sku_title: string
  mode: string
  duration_seconds: number
  resolution: string
  aspect_ratio: string
  quality: string
  prompt: string
  negative_prompt: string
  reference_assets: VideoReferenceAsset[]
  reference_image_urls: string[]
  reference_video_urls: string[]
  status: string
  progress: number
  estimated_credits: number
  credits_used: number
  error: string
  remote_url: string
  storage_url: string
  cover_url: string
  local_path: string
  local_exists: boolean
  file_size: number
  mime_type: string
  download_status: VideoDownloadStatus
  download_error: string
  download_attempts: number
  remote_expires_at: string
  created_at: string
  completed_at: string
  downloaded_at: string
  is_deleted: boolean
  deleted_at: string
  canvas_project_id: string
  canvas_node_id: string
  updated_at: string
}

export interface VideoGenerationListOptions {
  page?: number
  pageSize?: number
  search?: string
  status?: string
  downloadStatus?: string
}

export interface SyncVideoTaskInput {
  task: any
  referenceAssets?: VideoReferenceAsset[]
  requestParams?: {
    mode?: string
    duration_seconds?: number
    resolution?: string
    aspect_ratio?: string
    quality?: string
  }
  // v0.7.14+ 流式画布视频节点来源：传入后落盘到 canvas/{projectId}/，文件名带 nodeId 前缀
  canvasProjectId?: string
  canvasNodeId?: string
}

const downloadingIds = new Set<string>()
const queuedDownloadIds = new Set<string>()
let schedulerTimer: ReturnType<typeof setInterval> | null = null
// 首次启动延迟下载定时器 + 所有 queueAutoDownload 排队定时器：账号热切换时需一并清理，
// 避免切库后旧账号的下载任务继续触发写库（配合 epoch 守卫双保险）。
let firstDownloadTimer: ReturnType<typeof setTimeout> | null = null
const queuedTimers = new Set<ReturnType<typeof setTimeout>>()

function nowIso(): string {
  return new Date().toISOString()
}

function addHoursIso(value: string, hours: number): string {
  const base = new Date(value)
  const date = Number.isNaN(base.getTime()) ? new Date() : base
  date.setHours(date.getHours() + hours)
  return date.toISOString()
}

function toStringValue(value: any): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function toNumberValue(value: any): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function parseArray<T = any>(value: any): T[] {
  if (Array.isArray(value)) return value as T[]
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function toBooleanValue(value: any): boolean {
  return value === true || value === 1 || value === '1'
}

function stringifyArray(value: any[]): string {
  return JSON.stringify(Array.isArray(value) ? value : [])
}

function safeFilename(name: string): string {
  const cleaned = String(name || '').replace(/[\\/:*?"<>|\r\n\t]+/g, '_').replace(/\s+/g, ' ').trim()
  return cleaned || `ai-video-${Date.now()}`
}

function videoExtensionFromMime(mime: string): string {
  const normalized = mime.toLowerCase().split(';')[0].trim()
  if (normalized.includes('webm')) return '.webm'
  if (normalized.includes('quicktime')) return '.mov'
  if (normalized.includes('x-matroska')) return '.mkv'
  if (normalized.includes('mpeg')) return '.mpeg'
  if (normalized.includes('mp4')) return '.mp4'
  return '.mp4'
}

function videoExtensionFromUrl(url: string): string {
  try {
    const parsedUrl = new URL(url)
    const ext = extname(parsedUrl.pathname).toLowerCase()
    if (['.mp4', '.mov', '.webm', '.mkv', '.mpeg', '.mpg'].includes(ext)) return ext
  } catch {}
  return ''
}

function ensureVideosDir(): string {
  const dir = join(getDataDir(), 'videos')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

// v0.7.14+ 画布视频节点落盘到 canvas/{projectId}/，与画布生图同目录；其余仍落全局 videos/。
function videoOutputDir(canvasProjectId: string): string {
  if (canvasProjectId) {
    const dir = join(getDataDir(), 'canvas', canvasProjectId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }
  return ensureVideosDir()
}

function uniqueTargetPath(fileName: string, baseDir?: string): string {
  const dir = baseDir || ensureVideosDir()
  const parsed = parse(fileName)
  let candidate = join(dir, fileName)
  let index = 1
  while (existsSync(candidate)) {
    candidate = join(dir, `${parsed.name}-${index}${parsed.ext}`)
    index += 1
  }
  return candidate
}

function absoluteLocalPath(localPath: string): string {
  if (!localPath) return ''
  return isAbsolute(localPath) ? localPath : join(getDataDir(), localPath)
}

function relativeLocalPath(absPath: string): string {
  const root = resolve(getDataDir())
  const target = resolve(absPath)
  if (!isSameOrChildPath(root, target)) return absPath
  return relative(root, target)
}

function isSameOrChildPath(rootPath: string, targetPath: string): boolean {
  const rel = relative(resolve(rootPath), resolve(targetPath))
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

function isInsideDataDir(filePath: string): boolean {
  const root = resolve(getDataDir())
  const target = resolve(filePath)
  return isSameOrChildPath(root, target)
}

function preferredRemoteUrl(row: Pick<VideoGeneration, 'storage_url' | 'remote_url'>): string {
  return row.storage_url || row.remote_url || ''
}

function isExpired(row: Pick<VideoGeneration, 'remote_expires_at' | 'local_exists'>): boolean {
  if (!row.remote_expires_at || row.local_exists) return false
  const expiresAt = new Date(row.remote_expires_at).getTime()
  return Number.isFinite(expiresAt) && expiresAt <= Date.now()
}

function normalizeReferenceAssets(input: SyncVideoTaskInput): VideoReferenceAsset[] {
  if (input.referenceAssets?.length) {
    return input.referenceAssets
      .filter((asset) => asset?.url)
      .map((asset, index) => ({
        id: asset.id,
        asset_type: asset.asset_type || 'image',
        original_name: asset.original_name || '',
        url: asset.url,
        role: asset.role || 'reference',
        index: asset.index || index + 1,
        label: asset.label || `参考素材${index + 1}`,
      }))
  }
  const assets = input.task?.input_assets || {}
  const structuredAssets = parseArray<VideoReferenceAsset>(assets.assets || [])
    .filter((asset) => asset?.url)
    .map((asset, index) => ({
      id: asset.id,
      asset_type: asset.asset_type || 'image',
      original_name: asset.original_name || '',
      url: asset.url,
      role: asset.role || 'reference',
      index: asset.index || index + 1,
      label: asset.label || `参考素材${index + 1}`,
    }))
  if (structuredAssets.length) return structuredAssets
  const result: VideoReferenceAsset[] = []
  let imageIndex = 0
  let videoIndex = 0
  for (const url of parseArray<string>(assets.images || assets.reference_images || [])) {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      imageIndex += 1
      result.push({ asset_type: 'image', original_name: basename(url.split('?')[0] || ''), url, role: 'reference', index: result.length + 1, label: `参考图${imageIndex}` })
    }
  }
  for (const url of parseArray<string>(assets.videos || assets.reference_videos || [])) {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      videoIndex += 1
      result.push({ asset_type: 'video', original_name: basename(url.split('?')[0] || ''), url, role: 'reference', index: result.length + 1, label: `参考视频${videoIndex}` })
    }
  }
  return result
}

function normalizeReferenceUrls(input: SyncVideoTaskInput, assets: VideoReferenceAsset[]): { images: string[]; videos: string[] } {
  const taskAssets = input.task?.input_assets || {}
  const images = parseArray<string>(taskAssets.images || input.task?.reference_image_urls || [])
    .filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url))
  const videos = parseArray<string>(taskAssets.videos || input.task?.reference_video_urls || [])
    .filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url))
  for (const asset of assets) {
    if (asset.asset_type === 'video' && /^https?:\/\//i.test(asset.url) && !videos.includes(asset.url)) videos.push(asset.url)
    if (asset.asset_type === 'image' && /^https?:\/\//i.test(asset.url) && !images.includes(asset.url)) images.push(asset.url)
  }
  return { images, videos }
}

function parseRow(row: any): VideoGeneration {
  const localPath = toStringValue(row.local_path)
  const abs = absoluteLocalPath(localPath)
  const localExists = Boolean(abs && existsSync(abs))
  const remoteExpiresAt = toStringValue(row.remote_expires_at)
  let downloadStatus = (toStringValue(row.download_status) || 'pending') as VideoDownloadStatus
  if (!localExists && downloadStatus === 'downloaded') downloadStatus = 'pending'
  if (!localExists && remoteExpiresAt) {
    const expiresAt = new Date(remoteExpiresAt).getTime()
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now() && !['downloading', 'skipped'].includes(downloadStatus)) {
      downloadStatus = 'expired'
    }
  }
  return {
    id: toStringValue(row.id),
    source: toStringValue(row.source) || 'cloud',
    provider_id: toStringValue(row.provider_id),
    provider_task_id: toStringValue(row.provider_task_id),
    protocol_adapter: toStringValue(row.protocol_adapter),
    request_params: (() => { try { return JSON.parse(toStringValue(row.request_params) || '{}') } catch { return {} } })(),
    cloud_task_id: toStringValue(row.cloud_task_id),
    task_id: toStringValue(row.task_id),
    provider_protocol: toStringValue(row.provider_protocol),
    model_id: toStringValue(row.model_id),
    model_name: toStringValue(row.model_name),
    sku_key: toStringValue(row.sku_key),
    sku_title: toStringValue(row.sku_title),
    mode: toStringValue(row.mode),
    duration_seconds: toNumberValue(row.duration_seconds),
    resolution: toStringValue(row.resolution),
    aspect_ratio: toStringValue(row.aspect_ratio),
    quality: toStringValue(row.quality),
    prompt: toStringValue(row.prompt),
    negative_prompt: toStringValue(row.negative_prompt),
    reference_assets: parseArray<VideoReferenceAsset>(row.reference_assets),
    reference_image_urls: parseArray<string>(row.reference_image_urls),
    reference_video_urls: parseArray<string>(row.reference_video_urls),
    status: toStringValue(row.status),
    progress: toNumberValue(row.progress),
    estimated_credits: toNumberValue(row.estimated_credits),
    credits_used: toNumberValue(row.credits_used),
    error: toStringValue(row.error),
    remote_url: toStringValue(row.remote_url),
    storage_url: toStringValue(row.storage_url),
    cover_url: toStringValue(row.cover_url),
    local_path: localPath,
    local_exists: localExists,
    file_size: toNumberValue(row.file_size),
    mime_type: toStringValue(row.mime_type),
    download_status: downloadStatus,
    download_error: toStringValue(row.download_error),
    download_attempts: toNumberValue(row.download_attempts),
    remote_expires_at: remoteExpiresAt,
    created_at: toStringValue(row.created_at),
    completed_at: toStringValue(row.completed_at),
    downloaded_at: toStringValue(row.downloaded_at),
    is_deleted: toBooleanValue(row.is_deleted),
    deleted_at: toStringValue(row.deleted_at),
    canvas_project_id: toStringValue(row.canvas_project_id),
    canvas_node_id: toStringValue(row.canvas_node_id),
    updated_at: toStringValue(row.updated_at),
  }
}

function refreshLocalFileStatuses(): void {
  const db = getDatabase()
  const rows = db.prepare("SELECT id, local_path, remote_expires_at FROM video_generations WHERE is_deleted = 0 AND local_path <> '' AND download_status = 'downloaded'").all() as any[]
  if (!rows.length) return
  const now = nowIso()
  const stmt = db.prepare('UPDATE video_generations SET download_status = ?, download_error = ?, updated_at = ? WHERE id = ?')
  for (const row of rows) {
    const filePath = absoluteLocalPath(toStringValue(row.local_path))
    if (!filePath || existsSync(filePath)) continue
    const expiresAt = new Date(toStringValue(row.remote_expires_at)).getTime()
    const expired = Number.isFinite(expiresAt) && expiresAt <= Date.now()
    stmt.run(expired ? 'expired' : 'pending', expired ? '云端视频已超过有效期，且本地文件不存在' : '本地视频文件不存在，等待重新保存', now, row.id)
  }
}

function recoverStaleDownloads(): void {
  const activeIds = [...downloadingIds]
  const activeClause = activeIds.length ? ` AND id NOT IN (${activeIds.map(() => '?').join(',')})` : ''
  const now = nowIso()
  getDatabase().prepare(`UPDATE video_generations
    SET download_status = ?, download_error = ?, updated_at = ?
    WHERE is_deleted = 0 AND download_status = ?${activeClause}`)
    .run('pending', '上次保存中断，已重新加入待保存队列', now, 'downloading', ...activeIds)
}

function getRawById(id: string, includeDeleted = false): any | null {
  const db = getDatabase()
  const sql = includeDeleted
    ? 'SELECT * FROM video_generations WHERE id = ? OR cloud_task_id = ?'
    : 'SELECT * FROM video_generations WHERE (id = ? OR cloud_task_id = ?) AND is_deleted = 0'
  return db.prepare(sql).get(id, id) || null
}

function notifyUpdated(record: VideoGeneration): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('videoGen:updated', record)
    } catch {}
  }
}

function notifyDeleted(id: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('videoGen:deleted', { id })
    } catch {}
  }
}

async function downloadUrlToLibrary(url: string, defaultName: string, ctx?: { canvasProjectId?: string; canvasNodeId?: string; taskId?: string }): Promise<{ localPath: string; absolutePath: string; fileSize: number; mimeType: string }> {
  const maxVideoBytes = 2 * 1024 * 1024 * 1024
  if (!/^https?:\/\//i.test(url)) throw new Error('无效的视频地址')
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`)
  const mimeType = (res.headers.get('content-type') || 'video/mp4').split(';')[0].trim() || 'video/mp4'
  if (!mimeType.startsWith('video/') && mimeType !== 'application/octet-stream') throw new Error(`下载地址返回的不是视频（${mimeType}）`)
  const declaredSize = Number(res.headers.get('content-length') || 0)
  if (declaredSize > maxVideoBytes) throw new Error('视频超过 2GB 安全上限')
  const ext = videoExtensionFromUrl(url) || videoExtensionFromMime(mimeType) || extname(defaultName).toLowerCase() || '.mp4'
  const canvasProjectId = ctx?.canvasProjectId || ''
  const targetDir = videoOutputDir(canvasProjectId)
  // 画布产物用 {nodeId}_{taskId} 前缀命名，对齐画布生图 cleanupNodeFiles 的按前缀级联清理约定
  const baseName = canvasProjectId && ctx?.canvasNodeId
    ? safeFilename(`${ctx.canvasNodeId}_${ctx.taskId || Date.now()}`)
    : parse(safeFilename(defaultName || `ai-video-${Date.now()}`)).name
  const fileName = `${baseName}${ext}`
  const targetPath = uniqueTargetPath(fileName, targetDir)
  const tempPath = `${targetPath}.${Date.now()}.tmp`
  try {
    let received = 0
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length
        callback(received > maxVideoBytes ? new Error('视频超过 2GB 安全上限') : null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(res.body as any), limiter, createWriteStream(tempPath))
    const stat = statSync(tempPath)
    if (stat.size <= 0) throw new Error('下载的视频文件为空')
    renameSync(tempPath, targetPath)
    return {
      localPath: relativeLocalPath(targetPath),
      absolutePath: targetPath,
      fileSize: stat.size,
      mimeType,
    }
  } catch (e) {
    try { if (existsSync(tempPath)) unlinkSync(tempPath) } catch {}
    throw e
  }
}

function shouldAutoDownload(row: VideoGeneration): boolean {
  if (row.status !== 'completed') return false
  if (!preferredRemoteUrl(row)) return false
  if (row.local_exists) return false
  if (['downloaded', 'downloading', 'expired', 'skipped'].includes(row.download_status)) return false
  if (row.download_attempts >= 5) return false
  if (isExpired(row)) return false
  return true
}

function queueAutoDownload(id: string, delayMs = 1000): void {
  if (downloadingIds.has(id) || queuedDownloadIds.has(id)) return
  queuedDownloadIds.add(id)
  const timer = setTimeout(() => {
    queuedTimers.delete(timer)
    queuedDownloadIds.delete(id)
    // runInEpoch：把本次自动下载（含内部 getDatabase 写库）绑定到当前账号代次，
    // 账号热切换后旧任务写库会被 assertEpoch 拒绝。
    runInEpoch(() => {
      saveGenerationVideo(id, { automatic: true }).catch((e) => {
        console.error('[VideoGen] auto download failed:', e)
      })
    })
  }, delayMs)
  timer.unref?.()
  queuedTimers.add(timer)
}

export function listGenerations(options: VideoGenerationListOptions = {}): { items: VideoGeneration[]; total: number } {
  const db = getDatabase()
  refreshLocalFileStatuses()
  const page = Math.max(1, Number(options.page || 1))
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize || 20)))
  let countSql = 'SELECT COUNT(*) as total FROM video_generations WHERE is_deleted = 0'
  let querySql = 'SELECT * FROM video_generations WHERE is_deleted = 0'
  const params: any[] = []
  if (options.search?.trim()) {
    countSql += ' AND (prompt LIKE ? OR model_name LIKE ? OR sku_title LIKE ?)'
    querySql += ' AND (prompt LIKE ? OR model_name LIKE ? OR sku_title LIKE ?)'
    const value = `%${options.search.trim()}%`
    params.push(value, value, value)
  }
  if (options.status?.trim()) {
    countSql += ' AND status = ?'
    querySql += ' AND status = ?'
    params.push(options.status.trim())
  }
  if (options.downloadStatus?.trim()) {
    countSql += ' AND download_status = ?'
    querySql += ' AND download_status = ?'
    params.push(options.downloadStatus.trim())
  }
  querySql += ' ORDER BY COALESCE(completed_at, created_at) DESC, created_at DESC LIMIT ? OFFSET ?'
  const total = toNumberValue((db.prepare(countSql).get(...params) as any)?.total)
  const rows = db.prepare(querySql).all(...params, pageSize, (page - 1) * pageSize) as any[]
  return { items: rows.map(parseRow), total }
}

export function getGeneration(id: string): VideoGeneration | null {
  const row = getRawById(id)
  return row ? parseRow(row) : null
}

export function getDeletedGenerationIds(ids: string[]): string[] {
  const values = Array.from(new Set((ids || []).map((id) => toStringValue(id).trim()).filter(Boolean)))
  if (!values.length) return []
  const placeholders = values.map(() => '?').join(',')
  const rows = getDatabase()
    .prepare(`SELECT id, cloud_task_id FROM video_generations WHERE is_deleted = 1 AND (id IN (${placeholders}) OR cloud_task_id IN (${placeholders}))`)
    .all(...values, ...values) as Array<{ id: string; cloud_task_id: string }>
  const deleted = new Set<string>()
  for (const row of rows) {
    if (values.includes(row.id)) deleted.add(row.id)
    if (values.includes(row.cloud_task_id)) deleted.add(row.cloud_task_id)
  }
  return [...deleted]
}

export function syncCloudTask(input: SyncVideoTaskInput): VideoGeneration | null {
  const task = input.task || {}
  const cloudTaskId = toStringValue(task.id || task.cloud_task_id || task.task_id)
  if (!cloudTaskId) throw new Error('缺少视频任务 ID')
  const db = getDatabase()
  const existing = getRawById(cloudTaskId, true)
  if (existing && toBooleanValue((existing as any).is_deleted)) return null
  const existingRow = existing ? parseRow(existing) : null
  const now = nowIso()
  const result = task.result || {}
  const remoteUrl = toStringValue(result.remote_url || (!result.storage_url ? result.video_url : '') || existingRow?.remote_url)
  const storageUrl = toStringValue(result.storage_url || existingRow?.storage_url)
  const coverUrl = toStringValue(result.cover_url || existingRow?.cover_url)
  const status = toStringValue(task.status || existingRow?.status || 'pending')
  const completedAt = status === 'completed'
    ? toStringValue(task.completed_at || existingRow?.completed_at || now)
    : toStringValue(existingRow?.completed_at)
  const previousRemoteUrl = existingRow ? preferredRemoteUrl(existingRow) : ''
  const currentRemoteUrl = storageUrl || remoteUrl
  const remoteChanged = Boolean(existingRow && previousRemoteUrl && currentRemoteUrl && previousRemoteUrl !== currentRemoteUrl)
  const remoteExpiresAt = status === 'completed' && currentRemoteUrl
    ? (existingRow?.remote_expires_at && previousRemoteUrl === currentRemoteUrl ? existingRow.remote_expires_at : addHoursIso(completedAt || now, 24))
    : toStringValue(existingRow?.remote_expires_at)
  const referenceAssets = normalizeReferenceAssets(input)
  const referenceUrls = normalizeReferenceUrls(input, referenceAssets)
  let downloadStatus = existingRow?.download_status || 'pending'
  let downloadError = toStringValue(existingRow?.download_error)
  let downloadAttempts = toNumberValue(existingRow?.download_attempts)
  if (existingRow?.local_exists) downloadStatus = 'downloaded'
  if (downloadStatus === 'downloaded' && !existingRow?.local_exists) downloadStatus = 'pending'
  if (remoteChanged && !existingRow?.local_exists) {
    downloadStatus = 'pending'
    downloadError = ''
    downloadAttempts = 0
  }
  const row = {
    id: existingRow?.id || cloudTaskId,
    cloud_task_id: cloudTaskId,
    task_id: toStringValue(task.task_id || existingRow?.task_id),
    provider_protocol: toStringValue(task.provider_protocol || existingRow?.provider_protocol),
    model_id: toStringValue(task.model_id || existingRow?.model_id),
    model_name: toStringValue(task.model_name || existingRow?.model_name),
    sku_key: toStringValue(task.sku_key || existingRow?.sku_key),
    sku_title: toStringValue(task.sku_title || existingRow?.sku_title),
    mode: toStringValue(input.requestParams?.mode || task.request_params?.mode || existingRow?.mode),
    duration_seconds: toNumberValue(input.requestParams?.duration_seconds || task.request_params?.duration || task.result?.duration_seconds || existingRow?.duration_seconds),
    resolution: toStringValue(input.requestParams?.resolution || task.request_params?.resolution || existingRow?.resolution),
    aspect_ratio: toStringValue(input.requestParams?.aspect_ratio || task.request_params?.aspect_ratio || existingRow?.aspect_ratio),
    quality: toStringValue(input.requestParams?.quality || task.request_params?.quality || existingRow?.quality),
    prompt: toStringValue(task.prompt || existingRow?.prompt),
    negative_prompt: toStringValue(task.negative_prompt || existingRow?.negative_prompt),
    reference_assets: referenceAssets.length ? referenceAssets : existingRow?.reference_assets || [],
    reference_image_urls: referenceUrls.images.length ? referenceUrls.images : existingRow?.reference_image_urls || [],
    reference_video_urls: referenceUrls.videos.length ? referenceUrls.videos : existingRow?.reference_video_urls || [],
    status,
    progress: toNumberValue(task.progress ?? existingRow?.progress),
    estimated_credits: toNumberValue(task.estimated_credits ?? existingRow?.estimated_credits),
    credits_used: toNumberValue(task.credits_used ?? existingRow?.credits_used),
    error: toStringValue(task.error_message || task.error || existingRow?.error),
    remote_url: remoteUrl,
    storage_url: storageUrl,
    cover_url: coverUrl,
    local_path: toStringValue(existingRow?.local_path),
    file_size: toNumberValue(result.file_size ?? existingRow?.file_size),
    mime_type: toStringValue(result.mime_type || existingRow?.mime_type),
    download_status: downloadStatus,
    download_error: downloadError,
    download_attempts: downloadAttempts,
    remote_expires_at: remoteExpiresAt,
    created_at: toStringValue(task.created_at || existingRow?.created_at || now),
    completed_at: completedAt,
    downloaded_at: toStringValue(existingRow?.downloaded_at),
    canvas_project_id: toStringValue(input.canvasProjectId || existingRow?.canvas_project_id),
    canvas_node_id: toStringValue(input.canvasNodeId || existingRow?.canvas_node_id),
    updated_at: now,
  }
  if (existingRow) {
    db.prepare(`UPDATE video_generations SET
      cloud_task_id = ?, task_id = ?, provider_protocol = ?, model_id = ?, model_name = ?, sku_key = ?, sku_title = ?,
      mode = ?, duration_seconds = ?, resolution = ?, aspect_ratio = ?, quality = ?, prompt = ?, negative_prompt = ?,
      reference_assets = ?, reference_image_urls = ?, reference_video_urls = ?, status = ?, progress = ?, estimated_credits = ?, credits_used = ?,
      error = ?, remote_url = ?, storage_url = ?, cover_url = ?, local_path = ?, file_size = ?, mime_type = ?, download_status = ?,
      download_error = ?, download_attempts = ?, remote_expires_at = ?, created_at = ?, completed_at = ?, downloaded_at = ?,
      canvas_project_id = ?, canvas_node_id = ?, updated_at = ?
      WHERE id = ?`)
      .run(
        row.cloud_task_id, row.task_id, row.provider_protocol, row.model_id, row.model_name, row.sku_key, row.sku_title,
        row.mode, row.duration_seconds, row.resolution, row.aspect_ratio, row.quality, row.prompt, row.negative_prompt,
        stringifyArray(row.reference_assets), stringifyArray(row.reference_image_urls), stringifyArray(row.reference_video_urls), row.status, row.progress, row.estimated_credits, row.credits_used,
        row.error, row.remote_url, row.storage_url, row.cover_url, row.local_path, row.file_size, row.mime_type, row.download_status,
        row.download_error, row.download_attempts, row.remote_expires_at, row.created_at, row.completed_at, row.downloaded_at,
        row.canvas_project_id, row.canvas_node_id, row.updated_at,
        row.id,
      )
  } else {
    db.prepare(`INSERT INTO video_generations (
      id, cloud_task_id, task_id, provider_protocol, model_id, model_name, sku_key, sku_title,
      mode, duration_seconds, resolution, aspect_ratio, quality, prompt, negative_prompt,
      reference_assets, reference_image_urls, reference_video_urls, status, progress, estimated_credits, credits_used,
      error, remote_url, storage_url, cover_url, local_path, file_size, mime_type, download_status,
      download_error, download_attempts, remote_expires_at, created_at, completed_at, downloaded_at,
      canvas_project_id, canvas_node_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        row.id, row.cloud_task_id, row.task_id, row.provider_protocol, row.model_id, row.model_name, row.sku_key, row.sku_title,
        row.mode, row.duration_seconds, row.resolution, row.aspect_ratio, row.quality, row.prompt, row.negative_prompt,
        stringifyArray(row.reference_assets), stringifyArray(row.reference_image_urls), stringifyArray(row.reference_video_urls), row.status, row.progress, row.estimated_credits, row.credits_used,
        row.error, row.remote_url, row.storage_url, row.cover_url, row.local_path, row.file_size, row.mime_type, row.download_status,
        row.download_error, row.download_attempts, row.remote_expires_at, row.created_at, row.completed_at, row.downloaded_at,
        row.canvas_project_id, row.canvas_node_id, row.updated_at,
      )
  }
  const saved = getGeneration(row.id)!
  notifyUpdated(saved)
  if (shouldAutoDownload(saved)) queueAutoDownload(saved.id)
  return saved
}

export function syncCloudTasks(inputs: SyncVideoTaskInput[]): VideoGeneration[] {
  return inputs.filter((input) => input?.task).map(syncCloudTask).filter((item): item is VideoGeneration => Boolean(item))
}

/**
 * 返回视频记录的本地绝对路径（仅当文件确实存在）；否则返回空串。
 * 供流式画布「视频输入」节点复用已保存到本地的视频（saveNodeVideo 需要绝对路径）。
 */
export function resolveLocalAbsolutePath(id: string): string {
  const row = getGeneration(id)
  if (!row || !row.local_path) return ''
  const abs = absoluteLocalPath(row.local_path)
  return abs && existsSync(abs) ? abs : ''
}

export async function saveGenerationVideo(id: string, options: { automatic?: boolean } = {}): Promise<{ success: boolean; item?: VideoGeneration; path?: string; error?: string }> {
  const row = getGeneration(id)
  if (!row) return { success: false, error: '视频记录不存在' }
  const existingPath = absoluteLocalPath(row.local_path)
  if (row.local_path && existingPath && existsSync(existingPath)) {
    const now = nowIso()
    const db = getDatabase()
    const stat = statSync(existingPath)
    db.prepare('UPDATE video_generations SET download_status = ?, file_size = ?, downloaded_at = CASE WHEN downloaded_at = ? THEN ? ELSE downloaded_at END, updated_at = ? WHERE id = ?')
      .run('downloaded', stat.size, '', now, now, row.id)
    const item = getGeneration(row.id)!
    notifyUpdated(item)
    return { success: true, item, path: item.local_path }
  }
  const url = preferredRemoteUrl(row)
  if (!url) return { success: false, item: row, error: '缺少可下载的视频地址' }
  if (isExpired(row)) {
    const db = getDatabase()
    const now = nowIso()
    db.prepare('UPDATE video_generations SET download_status = ?, download_error = ?, updated_at = ? WHERE id = ?')
      .run('expired', '云端视频已超过有效期，无法自动保存', now, row.id)
    const item = getGeneration(row.id)!
    notifyUpdated(item)
    return { success: false, item, error: '云端视频已超过有效期，无法自动保存' }
  }
  if (downloadingIds.has(row.id)) return { success: false, item: row, error: '视频正在保存中' }
  downloadingIds.add(row.id)
  const db = getDatabase()
  const startedAt = nowIso()
  db.prepare('UPDATE video_generations SET download_status = ?, download_error = ?, updated_at = ? WHERE id = ?')
    .run('downloading', '', startedAt, row.id)
  notifyUpdated(getGeneration(row.id)!)
  try {
    const downloaded = await downloadUrlToLibrary(url, `${row.model_name || row.sku_title || 'ai-video'}-${row.cloud_task_id || row.id}.mp4`, {
      canvasProjectId: row.canvas_project_id,
      canvasNodeId: row.canvas_node_id,
      taskId: row.cloud_task_id || row.id,
    })
    const finishedAt = nowIso()
    db.prepare(`UPDATE video_generations SET
      local_path = ?, file_size = ?, mime_type = ?, download_status = ?, download_error = ?, downloaded_at = ?, updated_at = ?
      WHERE id = ?`)
      .run(downloaded.localPath, downloaded.fileSize, downloaded.mimeType, 'downloaded', '', finishedAt, finishedAt, row.id)
    const item = getGeneration(row.id)!
    notifyUpdated(item)
    return { success: true, item, path: item.local_path }
  } catch (e: any) {
    const message = toStringValue(e?.message || e) || '保存视频失败'
    const failedAt = nowIso()
    db.prepare(`UPDATE video_generations SET
      download_status = ?, download_error = ?, download_attempts = download_attempts + 1, updated_at = ?
      WHERE id = ?`)
      .run('failed', message.slice(0, 1000), failedAt, row.id)
    const item = getGeneration(row.id)!
    notifyUpdated(item)
    if (!options.automatic) return { success: false, item, error: message }
    return { success: false, item, error: message }
  } finally {
    downloadingIds.delete(row.id)
  }
}

export function deleteGeneration(id: string, deleteFile = false): boolean {
  const raw = getRawById(id, true)
  const row = raw ? parseRow(raw) : null
  if (!row) return false
  if (deleteFile && row.local_path) {
    const filePath = absoluteLocalPath(row.local_path)
    try {
      if (filePath && existsSync(filePath) && isInsideDataDir(filePath)) unlinkSync(filePath)
    } catch {}
  }
  const now = nowIso()
  const result = getDatabase().prepare('UPDATE video_generations SET is_deleted = 1, deleted_at = ?, download_status = ?, updated_at = ? WHERE id = ?').run(now, 'skipped', now, row.id)
  if (result.changes > 0) notifyDeleted(row.id)
  return result.changes > 0
}

/**
 * v0.7.14+ 删画布节点时级联软删其视频记录。
 * 物理文件由 canvas.ts 的 cleanupNodeFiles 按 {nodeId}_ 前缀清理，这里只软删 DB 记录并通知前端。
 */
export function deleteGenerationsByCanvasNode(canvasProjectId: string, canvasNodeId: string): number {
  if (!canvasProjectId || !canvasNodeId) return 0
  const db = getDatabase()
  const rows = db.prepare("SELECT id FROM video_generations WHERE canvas_project_id = ? AND canvas_node_id = ? AND is_deleted = 0").all(canvasProjectId, canvasNodeId) as Array<{ id: string }>
  if (!rows.length) return 0
  const now = nowIso()
  const stmt = db.prepare('UPDATE video_generations SET is_deleted = 1, deleted_at = ?, download_status = ?, updated_at = ? WHERE id = ?')
  let count = 0
  for (const row of rows) {
    const result = stmt.run(now, 'skipped', now, row.id)
    if (result.changes > 0) {
      notifyDeleted(row.id)
      count++
    }
  }
  return count
}

export async function runPendingDownloads(limit = 2): Promise<{ attempted: number; downloaded: number; failed: number }> {
  const db = getDatabase()
  recoverStaleDownloads()
  refreshLocalFileStatuses()
  const now = nowIso()
  db.prepare(`UPDATE video_generations
    SET download_status = ?, download_error = ?, updated_at = ?
    WHERE is_deleted = 0 AND status = 'completed' AND local_path = '' AND remote_expires_at <> '' AND remote_expires_at <= ?
      AND download_status NOT IN ('downloaded', 'downloading', 'expired')`)
    .run('expired', '云端视频已超过有效期，无法自动保存', now, now)
  const rows = db.prepare(`SELECT * FROM video_generations
    WHERE status = 'completed'
      AND is_deleted = 0
      AND (remote_url <> '' OR storage_url <> '')
      AND download_status IN ('pending', 'failed', 'downloaded')
      AND download_attempts < 5
      AND (remote_expires_at = '' OR remote_expires_at > ?)
    ORDER BY COALESCE(completed_at, created_at) DESC
    LIMIT ?`)
    .all(now, Math.max(1, Math.min(5, Number(limit) || 2))) as any[]
  let downloaded = 0
  let failed = 0
  for (const raw of rows) {
    const item = parseRow(raw)
    if (item.local_exists) continue
    const result = await saveGenerationVideo(item.id, { automatic: true })
    if (result.success) downloaded += 1
    else failed += 1
  }
  return { attempted: rows.length, downloaded, failed }
}

export function startAutoDownloadScheduler(intervalMs = 5 * 60 * 1000): void {
  if (schedulerTimer) return
  firstDownloadTimer = setTimeout(() => {
    firstDownloadTimer = null
    runInEpoch(() => runPendingDownloads().catch((e) => console.error('[VideoGen] startup pending download failed:', e)))
  }, 10000)
  firstDownloadTimer.unref?.()
  schedulerTimer = setInterval(() => {
    runInEpoch(() => runPendingDownloads().catch((e) => console.error('[VideoGen] scheduled pending download failed:', e)))
  }, intervalMs)
  schedulerTimer.unref?.()
}

// 完整停止：清调度 setInterval、首次 setTimeout、所有排队下载 setTimeout，并清空 inflight id 集合。
// 账号热切换前调用，确保旧账号的视频下载任务不会在切库后继续触发写库。
export function stopAutoDownloadScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer)
  schedulerTimer = null
  if (firstDownloadTimer) clearTimeout(firstDownloadTimer)
  firstDownloadTimer = null
  for (const t of queuedTimers) clearTimeout(t)
  queuedTimers.clear()
  downloadingIds.clear()
  queuedDownloadIds.clear()
}
