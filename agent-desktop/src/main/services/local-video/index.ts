import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase } from '../../database'
import { getModelProvider, listModelProviders, type ModelProvider } from '../model-provider'
import {
  DEFAULT_LOCAL_VIDEO_CAPABILITIES,
  type LocalVideoCatalogItem,
  type LocalVideoRemoteTask,
  type LocalVideoStatus,
  type SubmitLocalVideoInput,
  validateLocalVideoInput,
} from '../../../shared/local-video'

type Json = Record<string, any>
let pollTimer: ReturnType<typeof setInterval> | null = null
const polling = new Set<string>()

function endpoint(base: string, path: string): string {
  const cleanBase = base.replace(/\/+$/, '')
  const cleanPath = `/${path.replace(/^\/+/, '')}`
  for (const prefix of ['/api/v3', '/api/v1', '/v2', '/v1']) {
    if (cleanBase.endsWith(prefix) && cleanPath.startsWith(`${prefix}/`)) return `${cleanBase}${cleanPath.slice(prefix.length)}`
  }
  return `${cleanBase}${cleanPath}`
}

async function request(provider: ModelProvider, path: string, init: RequestInit = {}): Promise<Json> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(endpoint(provider.api_base, path), {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.api_key}`,
        ...(provider.protocol_adapter === 'dashscope_wan' && init.method === 'POST' ? { 'X-DashScope-Async': 'enable' } : {}),
        ...(init.headers || {}),
      },
    })
    const text = await response.text()
    let body: Json = {}
    try { body = text ? JSON.parse(text) : {} } catch { body = { message: text } }
    if (!response.ok) throw new Error(String(body.message || body.error?.message || `上游请求失败（HTTP ${response.status}）`))
    return body
  } finally {
    clearTimeout(timer)
  }
}

function normalizeStatus(value: unknown): LocalVideoStatus {
  const status = String(value || '').toLowerCase()
  if (['succeeded', 'success', 'completed', 'done'].includes(status)) return 'completed'
  if (['failed', 'error'].includes(status)) return 'failed'
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled'
  if (['running', 'processing', 'in_progress'].includes(status)) return 'processing'
  return 'pending'
}

function normalizedTask(body: Json): LocalVideoRemoteTask {
  const data = body.data || body.output || body.task || body
  const status = normalizeStatus(data.status || data.task_status || body.status)
  return {
    providerTaskId: String(data.id || data.task_id || body.id || body.task_id || ''),
    status,
    progress: Math.max(0, Math.min(100, Number(data.progress || body.progress || (status === 'completed' ? 100 : 0)))),
    remoteUrl: String(data.video_url || data.url || data.result?.video_url || data.content?.url || data.content?.video_url || ''),
    coverUrl: String(data.cover_url || data.result?.cover_url || ''),
    error: String(data.error?.message || data.error || data.message || (status === 'failed' ? body.message || '视频生成失败' : '')),
    raw: body,
  }
}

function submitPath(adapter: string): string {
  if (adapter === 'volcengine_ark') return '/api/v3/contents/generations/tasks'
  if (adapter === 'dashscope_wan') return '/api/v1/services/aigc/video-generation/video-synthesis'
  if (adapter === 'duomi') return '/v1/videos/generations'
  if (adapter === 'openai_video') return '/v1/videos'
  if (adapter === 'minimax_h3') return '/v2/video_generation'
  return '/api/v1/tasks'
}

function queryPath(adapter: string, id: string): string {
  if (adapter === 'volcengine_ark') return `/api/v3/contents/generations/tasks/${encodeURIComponent(id)}`
  if (adapter === 'duomi') return `/v1/videos/tasks/${encodeURIComponent(id)}`
  if (adapter === 'openai_video') return `/v1/videos/${encodeURIComponent(id)}`
  if (adapter === 'minimax_h3') return `/v2/query/video_generation/${encodeURIComponent(id)}`
  return `/api/v1/tasks/${encodeURIComponent(id)}`
}

function submitBody(provider: ModelProvider, input: SubmitLocalVideoInput): Json {
  const common = {
    model: input.modelId,
    prompt: input.prompt,
    negative_prompt: input.negativePrompt || undefined,
    duration: input.durationSeconds,
    resolution: input.resolution,
    ratio: input.aspectRatio,
    image_url: input.referenceImageUrls?.[0],
  }
  if (provider.protocol_adapter === 'dashscope_wan') {
    return { model: input.modelId, input: { prompt: input.prompt, negative_prompt: input.negativePrompt, img_url: input.referenceImageUrls?.[0] }, parameters: { duration: input.durationSeconds, resolution: input.resolution, size: input.aspectRatio } }
  }
  if (provider.protocol_adapter === 'volcengine_ark') {
    return volcengineArkBody(input)
  }
  if (provider.protocol_adapter === 'minimax_h3') {
    return minimaxH3Body(input)
  }
  return common
}

function volcengineArkBody(input: SubmitLocalVideoInput): Json {
  const images = (input.referenceImageUrls || []).filter(Boolean)
  const content: Json[] = []
  if (input.prompt.trim()) content.push({ type: 'text', text: input.prompt })
  if (input.mode === 'first_last_frame' && images.length >= 2) {
    content.push({ type: 'image_url', image_url: { url: images[0] }, role: 'first_frame' })
    content.push({ type: 'image_url', image_url: { url: images[1] }, role: 'last_frame' })
  } else if (images[0]) {
    content.push({ type: 'image_url', image_url: { url: images[0] }, role: input.mode === 'image_to_video' ? 'first_frame' : 'reference_image' })
  }
  const seedance25 = /2[\.\-_]?5/i.test(input.modelId)
  const resolution = normalizeVolcengineResolution(input.resolution, seedance25)
  const duration = normalizeVolcengineDuration(input.durationSeconds, seedance25)
  const hasFrame = content.some((item) => item.role === 'first_frame' || item.role === 'last_frame')
  return {
    model: input.modelId,
    content,
    resolution,
    duration,
    ratio: hasFrame ? 'adaptive' : (input.aspectRatio || '16:9'),
  }
}

function normalizeVolcengineResolution(raw?: string, seedance25 = false): string {
  const value = String(raw || '').trim().toLowerCase().replace(/\s+/g, '')
  if (seedance25) return value === '480p' ? '480p' : '720p'
  if (['480p', '720p', '1080p'].includes(value)) return value
  return '720p'
}

function normalizeVolcengineDuration(raw?: number, seedance25 = false): number {
  const seconds = Number(raw) || 5
  const min = seedance25 ? 4 : 2
  const max = seedance25 ? 30 : 15
  return Math.max(min, Math.min(max, seconds))
}

function volcengineCapabilities(modelId: string) {
  const seedance25 = /2[\.\-_]?5/i.test(modelId)
  return {
    modes: ['text_to_video', 'image_to_video', 'first_last_frame'],
    durations: seedance25 ? [4, 5, 6, 8, 10, 12, 15, 20, 25, 30] : [5, 10, 15],
    resolutions: seedance25 ? ['480p', '720p'] : ['720p', '1080p'],
    aspectRatios: seedance25 ? ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] : ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    maxReferenceImages: seedance25 ? 30 : 9,
    supportsCancel: true,
  }
}

function minimaxH3Body(input: SubmitLocalVideoInput): Json {
  const images = (input.referenceImageUrls || []).filter(Boolean)
  const content: Json[] = [{ type: 'text', text: input.prompt }]
  if (input.mode === 'first_last_frame' && images.length >= 2) {
    content.push({ type: 'image_url', image_url: { url: images[0] }, role: 'first_frame' })
    content.push({ type: 'image_url', image_url: { url: images[1] }, role: 'last_frame' })
  } else if (images[0]) {
    content.push({ type: 'image_url', image_url: { url: images[0] }, role: 'first_frame' })
  }
  const hasImage = images.length > 0
  return {
    model: input.modelId || 'MiniMax-H3',
    content,
    resolution: normalizeMiniMaxResolution(input.resolution),
    duration: Math.max(4, Math.min(15, Number(input.durationSeconds) || 5)),
    ratio: hasImage ? 'adaptive' : (input.aspectRatio && input.aspectRatio !== 'adaptive' ? input.aspectRatio : '16:9'),
  }
}

function normalizeMiniMaxResolution(raw?: string): string {
  const value = String(raw || '').trim().toUpperCase().replace(/\s+/g, '')
  if (value === '2K') return '2K'
  return '768P'
}

function providerCatalog(provider: ModelProvider): LocalVideoCatalogItem[] {
  return provider.models.map((modelId) => ({
    providerId: provider.id,
    providerName: provider.name,
    adapter: provider.protocol_adapter,
    modelId,
    displayName: modelId,
    capabilities: provider.protocol_adapter === 'minimax_h3'
      ? {
          modes: ['text_to_video', 'image_to_video', 'first_last_frame'],
          durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          resolutions: ['768P', '2K'],
          aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
          maxReferenceImages: 2,
          supportsCancel: false,
        }
      : provider.protocol_adapter === 'volcengine_ark'
        ? volcengineCapabilities(modelId)
        : { ...DEFAULT_LOCAL_VIDEO_CAPABILITIES },
  }))
}

export function listCatalog(): LocalVideoCatalogItem[] {
  return listModelProviders()
    .filter((p) => p.purpose === 'video' && p.enabled && p.api_base && p.api_key && p.protocol_adapter !== 'kling_direct')
    .flatMap(providerCatalog)
}

function notify(id: string): void {
  const row = getDatabase().prepare('SELECT * FROM video_generations WHERE id = ?').get(id)
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('videoGen:updated', row)
}

export async function submit(input: SubmitLocalVideoInput): Promise<any> {
  const provider = getModelProvider(input.providerId)
  if (!provider || provider.purpose !== 'video' || !provider.enabled) throw new Error('视频供应商不存在或已停用')
  const catalog = providerCatalog(provider).find((item) => item.modelId === input.modelId)
  if (!catalog) throw new Error('所选模型不属于该供应商')
  validateLocalVideoInput(input, catalog.capabilities)
  const key = input.idempotencyKey?.trim() || randomUUID()
  const db = getDatabase()
  const existing = db.prepare("SELECT * FROM video_generations WHERE idempotency_key = ? AND is_deleted = 0").get(key)
  if (existing) return existing
  const remote = normalizedTask(await request(provider, submitPath(provider.protocol_adapter), { method: 'POST', body: JSON.stringify(submitBody(provider, input)) }))
  if (!remote.providerTaskId) throw new Error('上游未返回任务 ID')
  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO video_generations
    (id, source, provider_id, provider_task_id, protocol_adapter, idempotency_key, request_params, provider_status,
     task_id, provider_protocol, model_id, model_name, mode, duration_seconds, resolution, aspect_ratio, prompt,
     reference_image_urls, status, progress, error, remote_url, cover_url, next_poll_at, created_at, updated_at)
    VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, provider.id, remote.providerTaskId, provider.protocol_adapter, key, JSON.stringify(input), remote.status,
      remote.providerTaskId, provider.protocol_adapter, input.modelId, input.modelId, input.mode || '', input.durationSeconds || 0,
      input.resolution || '', input.aspectRatio || '', input.prompt.trim(), JSON.stringify(input.referenceImageUrls || []),
      remote.status, remote.progress, remote.error || '', remote.remoteUrl || '', remote.coverUrl || '', now, now, now)
  notify(id)
  return db.prepare('SELECT * FROM video_generations WHERE id = ?').get(id)
}

export async function refresh(id: string): Promise<any> {
  if (polling.has(id)) return getDatabase().prepare('SELECT * FROM video_generations WHERE id = ?').get(id)
  polling.add(id)
  try {
    const db = getDatabase()
    const row = db.prepare("SELECT * FROM video_generations WHERE id = ? AND source = 'local' AND is_deleted = 0").get(id) as any
    if (!row) throw new Error('本地视频任务不存在')
    const provider = getModelProvider(row.provider_id)
    if (!provider) throw new Error('任务对应的视频供应商已被删除')
    const remote = normalizedTask(await request(provider, queryPath(row.protocol_adapter, row.provider_task_id)))
    const now = new Date().toISOString()
    const delay = remote.status === 'pending' || remote.status === 'processing' ? 15_000 : 0
    db.prepare(`UPDATE video_generations SET provider_status = ?, status = ?, progress = ?, error = ?, remote_url = ?, cover_url = ?,
      poll_count = poll_count + 1, last_polled_at = ?, next_poll_at = ?, completed_at = ?, download_status = ?, updated_at = ? WHERE id = ?`)
      .run(remote.status, remote.status, remote.progress, remote.error || '', remote.remoteUrl || row.remote_url, remote.coverUrl || row.cover_url,
        now, delay ? new Date(Date.now() + delay).toISOString() : '', remote.status === 'completed' ? now : row.completed_at,
        remote.status === 'completed' ? 'pending' : row.download_status, now, id)
    notify(id)
    return db.prepare('SELECT * FROM video_generations WHERE id = ?').get(id)
  } finally { polling.delete(id) }
}

export async function cancel(id: string): Promise<any> {
  const db = getDatabase()
  const row = db.prepare("SELECT * FROM video_generations WHERE id = ? AND source = 'local'").get(id) as any
  if (!row) throw new Error('本地视频任务不存在')
  const provider = getModelProvider(row.provider_id)
  if (!provider) throw new Error('任务对应的视频供应商已被删除')
  throw new Error(`当前 ${provider.name} 协议未验证取消契约，请在供应商控制台操作`)
}

export async function pollDueTasks(limit = 3): Promise<void> {
  const rows = getDatabase().prepare(`SELECT id FROM video_generations WHERE source = 'local' AND is_deleted = 0
    AND status IN ('pending', 'processing') AND (next_poll_at = '' OR next_poll_at <= ?) ORDER BY created_at LIMIT ?`)
    .all(new Date().toISOString(), limit) as Array<{ id: string }>
  for (const row of rows) await refresh(row.id).catch((error) => console.warn('[LocalVideo] 轮询失败:', row.id, error?.message || error))
}

export function startScheduler(): void {
  if (pollTimer) return
  pollTimer = setInterval(() => { void pollDueTasks() }, 15_000)
  pollTimer.unref?.()
  void pollDueTasks()
}

export function stopScheduler(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  polling.clear()
}
