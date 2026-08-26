import { getDatabase } from '../database'
import { v4 as uuid } from 'uuid'
import { getModelProvider, type ModelProvider } from './model-provider'
import { createImageSession } from './image-session'
import { getDataDir } from './data-path'
import { getCloudToken, getCloudGatewayUrl, resolveCloudModelId, refreshCloudToken, notifyCloudAuthExpired, wasLastCloudTokenRefreshAuthFailure, getCloudModels } from './cloud-token'
import { basename, join } from 'path'
import { copyFileSync, mkdirSync, writeFileSync, unlinkSync, existsSync } from 'fs'
import { addGeneratedImageToWorkspaceGallery, getActiveWorkspaceRoot } from './agent-workspace'
import {
  appendMustTokens,
  compileMustTokens,
  isBrandOverride,
  loadBrandCard
} from './brand-card'
import { BrowserWindow, nativeImage } from 'electron'
import { recordUsage } from './usage-stats'
import { ensureValidTierIdForSize, resolveSizeToPixels, getModelMode } from '@shared/image-size'
import { stripModelId } from '@shared/model-id'
import { normalizeApiBase } from './api-base-normalize'
import { probeImage } from './image-probe'
import { removeByRelativePath } from './gallery'
import { assertImagePromptLength } from '@shared/prompt-limits'
import {
  buildRequestSnapshot,
  describeFormData,
  attachSnapshotToError,
  extractRawRequest
} from './request-snapshot'
import { uploadImageBytesToCloud } from './cloud-image-asset'

// ---- Global concurrency limit (Bug #3) ----
// 所有入口（ImageGenView / BatchGenView / ImageEditView / Canvas / Chat 工具）共享此上限，
// 防止多入口同时打到上游服务商触发 429 / 账号风控。
// 6 是经验值：常见服务商单账号 RPM 限制 30~60，单请求 5~30s，6 并发约 1~3 RPS。
const MAX_CONCURRENT_API_CALLS = 6
const ACQUIRE_SLOT_TIMEOUT_MS = 600_000 // 10 分钟兜底：避免某次任务异常未 release 时后续永远等
let _activeApiCalls = 0
const _apiWaitQueue: Array<{ resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = []

async function acquireApiSlot(): Promise<void> {
  if (_activeApiCalls < MAX_CONCURRENT_API_CALLS) {
    _activeApiCalls++
    return
  }
  return new Promise<void>((resolve, reject) => {
    const entry: { resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout } = {
      resolve: () => {
        clearTimeout(entry.timer)
        _activeApiCalls++
        resolve()
      },
      reject,
      timer: setTimeout(() => {
        // 等待超时：从队列摘除自身，抛错让调用方失败而非永久阻塞
        const idx = _apiWaitQueue.indexOf(entry)
        if (idx >= 0) _apiWaitQueue.splice(idx, 1)
        reject(new Error(`生图并发等待超时（>${ACQUIRE_SLOT_TIMEOUT_MS / 1000}s），可能存在未释放的并发槽位，请稍后重试`))
      }, ACQUIRE_SLOT_TIMEOUT_MS)
    }
    _apiWaitQueue.push(entry)
  })
}

function releaseApiSlot(): void {
  // 防御性下界：极端情况下避免计数变负
  _activeApiCalls = Math.max(0, _activeApiCalls - 1)
  const next = _apiWaitQueue.shift()
  if (next) next.resolve()
}

// ---- generation cancellation (manual abort) ----
/**
 * 用户手动中止生成时抛出的标记错误。与"超时 / 网络错误"区分：
 *  - fetchWithRetry 识别后不再退避重试，立即冒泡
 *  - pollAsyncTask 识别后不计入瞬态失败，立即终止轮询
 *  - generateImages.runOne 识别后把该项标记 status='canceled' 而非 'error'
 */
class GenerationCanceledError extends Error {
  readonly canceled = true
  constructor(message = '生成已手动中止') {
    super(message)
    this.name = 'GenerationCanceledError'
  }
}

function isCanceledError(e: any): boolean {
  return !!(e && (e.canceled === true || e?.name === 'GenerationCanceledError'))
}

/**
 * genId → AbortController 注册表。generateImages 为每个生成项注册，
 * cancelGeneration(genId) 触发对应 controller.abort()，沿 fetch / 轮询链路冒泡中止。
 * runOne 的 finally 负责注销，避免泄漏。
 */
const inflightAbortControllers = new Map<string, AbortController>()

/** 手动中止单个生成项。返回是否命中一个仍在跑的任务 */
export function cancelGeneration(genId: string): boolean {
  const controller = inflightAbortControllers.get(genId)
  if (!controller) return false
  controller.abort()
  return true
}

/** 批量中止；返回实际命中的任务数 */
export function cancelGenerations(genIds: string[]): number {
  let hit = 0
  for (const id of genIds) if (cancelGeneration(id)) hit++
  return hit
}

/** 中止所有进行中的生成项（账号热切换前清场用）。返回命中数。 */
export function cancelAllGenerations(): number {
  let hit = 0
  for (const [, controller] of inflightAbortControllers) {
    try { controller.abort() } catch {}
    hit++
  }
  inflightAbortControllers.clear()
  return hit
}

/** 可被 AbortSignal 打断的 sleep：中止时立即 reject(GenerationCanceledError)，不必等满间隔 */
function interruptibleSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GenerationCanceledError())
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new GenerationCanceledError())
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
  })
}

// ---- fetch with timeout (Bug #4) ----
/**
 * 带超时的 fetch。内部 AbortController 负责超时；externalSignal 负责用户手动中止。
 * 两者任一触发都会 abort fetch；通过 externalSignal.aborted 区分二者：
 * 手动中止抛 GenerationCanceledError，超时抛"请求超时"。
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number, externalSignal?: AbortSignal): Promise<Response> {
  if (externalSignal?.aborted) throw new GenerationCanceledError()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onExternalAbort = () => controller.abort()
  if (externalSignal) externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (e: any) {
    // 外部中止优先于超时判定：用户点了中止，就报"已手动中止"而非"请求超时"
    if (externalSignal?.aborted) throw new GenerationCanceledError()
    if (e?.name === 'AbortError') {
      throw new Error(`请求超时 (${timeoutMs}ms): ${url}`)
    }
    throw e
  } finally {
    clearTimeout(timer)
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * 读取错误响应体并提取人类可读 message：先按 JSON 解析 `{error:{message}}` / `{error}` / `{message}`，
 * 失败回退 text。HTML/超长内容由 truncateError 兜底。避免向上抛 `Unexpected token <` 这种解析错误。
 */
async function readResponseError(res: Response): Promise<string> {
  let raw = ''
  try {
    raw = await res.text()
  } catch {
    return `HTTP ${res.status}`
  }
  if (!raw) return `HTTP ${res.status}`
  try {
    const j = JSON.parse(raw)
    const inner =
      (j && typeof j === 'object' && j.error && typeof j.error === 'object' && j.error.message) ||
      (j && typeof j === 'object' && typeof j.error === 'string' ? j.error : undefined) ||
      (j && typeof j === 'object' && typeof j.message === 'string' ? j.message : undefined)
    if (inner) {
      // inner 短（≤50 字符的错误码，如多米 'fail_to_submit_task'）且 raw 还有其他字段时，
      // 附带 raw 全文，避免丢失 details / description / reason / data 等上下文（排错关键）。
      const innerStr = String(inner)
      if (innerStr.length <= 50 && raw.length > innerStr.length + 30) {
        return truncateError(`${innerStr} | raw: ${raw}`)
      }
      return truncateError(innerStr)
    }
  } catch {}
  return truncateError(raw)
}

/** 错误信息截断（Bug #9）：上游可能返回几 MB HTML，避免污染 DB / IPC / UI */
function truncateError(text: string, max = 500): string {
  if (!text) return ''
  return text.length <= max ? text : text.slice(0, max) + `... (truncated, total ${text.length} chars)`
}

/** HTTP 状态码是否值得退避重试：429（限流）+ 5xx（服务端临时故障） */
function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

/** 网络层错误（fetchWithTimeout 抛出的非 HTTP 错误）是否值得重试：超时、连接重置、DNS 抖动等 */
function isRetriableNetworkError(e: any): boolean {
  const msg: string = String(e?.message || e || '')
  if (msg.startsWith('请求超时')) return true
  if (/ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_SOCKET|socket hang up|fetch failed/i.test(msg)) return true
  return false
}

/**
 * 带退避重试的 fetch。对 429 / 5xx HTTP 响应与网络层临时错误自动重试。
 * 4xx（除 429）一次失败即抛错，避免无效重试浪费配额。
 *
 * 重试间隔：1.5s → 4s → 8s（指数退避，含轻微抖动）。
 * 最终失败时若是 HTTP 响应，抛出 `${prefix} ${status}: ${message}` 风格错误。
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  opts: { retries?: number; errorPrefix?: string; signal?: AbortSignal } = {}
): Promise<Response> {
  const retries = Math.max(0, opts.retries ?? 2)
  const errorPrefix = opts.errorPrefix || 'API'
  let lastErr: any
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw new GenerationCanceledError()
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs, opts.signal)
      if (res.ok) return res
      // HTTP 错误：可重试码退避，不可重试码立即抛
      if (isRetriableStatus(res.status) && attempt < retries) {
        const body = await readResponseError(res).catch(() => `HTTP ${res.status}`)
        console.warn(`[ImageGen] ${errorPrefix} ${res.status} (attempt ${attempt + 1}/${retries + 1}), retrying:`, body)
        const delay = 1500 * Math.pow(2, attempt) + Math.floor(Math.random() * 500)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      // 不可重试 4xx 或最后一次重试失败：抛出真实错误
      const message = await readResponseError(res)
      throw new Error(`${errorPrefix} ${res.status}: ${message}`)
    } catch (e: any) {
      // 用户手动中止：不退避重试，立即冒泡
      if (isCanceledError(e)) throw e
      lastErr = e
      // 业务层 throw 出来的（已经带 errorPrefix 的）直接终止
      if (typeof e?.message === 'string' && e.message.startsWith(`${errorPrefix} `)) throw e
      if (isRetriableNetworkError(e) && attempt < retries) {
        console.warn(`[ImageGen] ${errorPrefix} network error (attempt ${attempt + 1}/${retries + 1}):`, e?.message || e)
        const delay = 1500 * Math.pow(2, attempt) + Math.floor(Math.random() * 500)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      throw e
    }
  }
  throw lastErr || new Error(`${errorPrefix} retry exhausted`)
}

/** 单次生图超时上限。统一 15 分钟，与云控端 gateway.timeouts.image=900s 对齐：
 *  1k / 2k / 4k 各档位一视同仁，多米异步 + OpenAI 同步都够用。
 *  tierId 参数保留是为了兼容历史调用签名，未来如需分档调控可在此处分支。 */
function getImageApiTimeout(_tierId?: string): number {
  return 900_000  // 15 分钟
}

// ---- Disk file cleanup (Bug #5) ----
/** 安全删除一个绝对路径下的文件；不存在或失败都吞掉，仅日志 */
function safeDeleteFile(absPath: string): void {
  try {
    if (existsSync(absPath)) unlinkSync(absPath)
  } catch (e) {
    console.error('[ImageGen] Failed to delete file:', absPath, e)
  }
}

/** 按数据库存的相对路径删除磁盘文件；兼容旧数据中残留的绝对路径 */
function deleteImageByRelPath(relPath: string | null | undefined): void {
  if (!relPath) return
  const isAbs = /^[A-Za-z]:|^\//.test(relPath)
  const absPath = isAbs ? relPath : join(getDataDir(), relPath)
  safeDeleteFile(absPath)
}

export interface ImageGeneration {
  id: string
  session_id: string
  prompt: string
  revised_prompt: string
  ref_images: string[]
  model_provider_id: string
  model_id: string
  size: string
  quality: string
  /** 分辨率档位 id（1k/2k/4k）：重新生成时复现原档位，避免静默回退默认 2K */
  tier_id: string
  result_path: string
  result_url: string
  status: string
  error: string
  /**
   * 失败诊断用：发送给上游 API 的原始请求快照（脱敏后 JSON 字符串）。
   * 成功记录通常为空；仅失败记录在 status='error' 时同步写入，
   * 供 ErrorDetailDialog 展示与一键复制。
   */
  raw_request: string
  created_at: string
}

export interface GenerateImageOptions {
  sessionId?: string
  prompt: string
  refImages?: string[]
  mask?: string
  modelProviderId: string
  modelId: string
  size: string
  /** 分辨率档位 id（1k/2k/4k），配合 modelId 决定发出前的最终像素 */
  tierId?: string
  quality?: string
  batchCount?: number
  /**
   * 进度事件附加上下文：让前端能区分调用来源（chat 工具 / ImageGenView 等），
   * 并按会话 id 做 scope，避免多会话浮窗串台。
   */
  progressContext?: {
    conversationId?: string
    requestId?: string
    source?: 'chat' | 'image-gen' | 'batch' | 'edit' | 'canvas'
  }
  /**
   * v0.6.9+ 来自流式画布节点的生图调用：传入后图片落盘到 canvas/{projectId}/，
   * 而非默认的 images/{sessionId}/。文件名前缀使用 canvasNodeId，让
   * deleteNode 时的 cleanupNodeFiles 能按 nodeId 前缀级联清理（避免孤儿文件）。
   */
  canvasProjectId?: string
  canvasNodeId?: string
  /**
   * 外部中止信号（向后兼容，可选）。传入后会与每个生成项内部的 AbortController 联动：
   * signal.abort() 触发后沿 fetch / 轮询链路尽快终止，对应项标记 status='canceled'。
   * 典型用途：deck-generator 的 resolveFigure 持有整轮 PPT 生成的 signal，用户中止后
   * 不必等云端把整张图轮询跑完（30~90s 空跑）。不传时行为与原先完全一致。
   */
  signal?: AbortSignal
  /**
   * D-29：opt-in 追加当前工作区 must_tokens，并把成品再拷一份到工作区 output/。
   * 默认 false，避免电商/画布/编辑/PPT 误吃品牌。
   */
  applyWorkspaceBrand?: boolean
  /** 对话路径：用户原文已声明覆盖品牌时由调用方传入，避免 LLM 写词不含覆盖句。 */
  brandUserOverride?: boolean
}

/**
 * v0.6.9+ 生图落盘上下文：把"图存到哪、文件叫啥"两件事抽出来。
 *
 * - 普通调用（image-gen 页 / chat 工具）：dir = images/{sessionId}/，filename = {genId}.{ext}
 * - 画布调用（text2img/img2img 节点）：dir = canvas/{projectId}/，filename = {nodeId}_{genId}.{ext}
 *
 * 文件名加 nodeId 前缀的目的：与 canvas.ts 的 cleanupNodeFiles 约定对齐，
 * 节点被删除时 `${nodeId}_` 前缀匹配能一次清掉所有关联生成图。
 */
interface OutputContext {
  sessionId: string
  canvasProjectId?: string
  canvasNodeId?: string
}

function getOutputDir(ctx: OutputContext): string {
  if (ctx.canvasProjectId) {
    const dir = join(getDataDir(), 'canvas', ctx.canvasProjectId)
    mkdirSync(dir, { recursive: true })
    return dir
  }
  return getImageDir(ctx.sessionId)
}

function buildOutputFilename(ctx: OutputContext, genId: string, ext: string): string {
  if (ctx.canvasNodeId) return `${ctx.canvasNodeId}_${genId}.${ext}`
  return `${genId}.${ext}`
}

/** 解析 UI 传入的 size（预设 / 比例 / 像素）为上游 API 接受的 "WxH" 像素串。
 * 传入 modelId+tierId 时按对应能力域 clamp；非法值直接抛错。 */
function resolvePixels(size: string, modelId?: string, tierId?: string): string {
  const effectiveTierId = modelId ? ensureValidTierIdForSize(modelId, tierId, size) : tierId
  const px = resolveSizeToPixels(size, { modelId, tierId: effectiveTierId })
  if (!px) throw new Error(`尺寸格式非法：${size}`)
  return px
}

function resolveWorkspaceBrandPrompt(prompt: string, opts: { apply?: boolean; userOverride?: boolean }): string {
  if (!opts.apply) return prompt
  if (opts.userOverride || isBrandOverride(prompt)) return prompt
  try {
    const root = getActiveWorkspaceRoot()
    const card = loadBrandCard(root)
    const tokens = compileMustTokens(card, prompt)
    return appendMustTokens(prompt, tokens)
  } catch (e) {
    console.warn('[ImageGen] workspace brand tokens skipped:', e)
    return prompt
  }
}

function copyToActiveWorkspaceOutput(absoluteSource: string): string | null {
  if (!absoluteSource || !existsSync(absoluteSource)) return null
  try {
    const root = getActiveWorkspaceRoot()
    if (!root) return null
    const destDir = join(root, 'output')
    mkdirSync(destDir, { recursive: true })
    const filename = basename(absoluteSource)
    const ext = filename.split('.').pop() || 'png'
    let dest = join(destDir, filename)
    if (existsSync(dest) && dest !== absoluteSource) {
      const stem = filename.replace(/\.[^.]+$/, '')
      dest = join(destDir, `${stem}-${Date.now()}.${ext}`)
    }
    if (dest !== absoluteSource) copyFileSync(absoluteSource, dest)
    return dest
  } catch (e) {
    console.error('[ImageGen] copy to workspace output failed (non-fatal):', e)
    return null
  }
}

export function getGenerationByResultPath(resultPath: string): ImageGeneration | null {
  const raw = String(resultPath || '').trim()
  if (!raw) return null
  const dataDir = getDataDir()
  const candidates = new Set<string>()
  candidates.add(raw)
  candidates.add(raw.replace(/\\/g, '/'))
  if (raw.startsWith(dataDir)) {
    const rel = raw.slice(dataDir.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
    if (rel) candidates.add(rel)
  }
  const db = getDatabase()
  for (const key of candidates) {
    const row = db
      .prepare('SELECT * FROM image_generations WHERE result_path = ? ORDER BY created_at DESC LIMIT 1')
      .get(key) as any
    if (row) return parseRow(row)
  }
  const tail = raw.replace(/\\/g, '/').split('/').slice(-2).join('/')
  if (tail) {
    const row = db
      .prepare('SELECT * FROM image_generations WHERE result_path LIKE ? ORDER BY created_at DESC LIMIT 1')
      .get(`%${tail}`) as any
    if (row) return parseRow(row)
  }
  return null
}

function parseRow(row: any): ImageGeneration {
  return {
    ...row,
    ref_images: JSON.parse(row.ref_images || '[]')
  }
}

export function listGenerations(sessionId: string): ImageGeneration[] {
  const db = getDatabase()
  const rows = db
    .prepare('SELECT * FROM image_generations WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as any[]
  return rows.map(parseRow)
}

export function listRecentGenerations(limit: number = 100): ImageGeneration[] {
  const db = getDatabase()
  const rows = db
    .prepare('SELECT * FROM image_generations ORDER BY created_at DESC LIMIT ?')
    .all(limit) as any[]
  return rows.map(parseRow).reverse()
}

function getOrCreateDefaultSession(): string {
  const db = getDatabase()
  const row = db.prepare('SELECT id FROM image_sessions ORDER BY created_at ASC LIMIT 1').get() as any
  if (row) return row.id
  const session = createImageSession({ title: 'default' })
  return session.id
}

export function getGeneration(id: string): ImageGeneration | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM image_generations WHERE id = ?').get(id) as any
  if (!row) return null
  return parseRow(row)
}

export function listAllGenerations(page: number, pageSize: number, search?: string, startDate?: string, endDate?: string): { items: ImageGeneration[]; total: number } {
  const db = getDatabase()
  let countSql = 'SELECT COUNT(*) as total FROM image_generations WHERE status = ?'
  let querySql = 'SELECT * FROM image_generations WHERE status = ?'
  const params: any[] = ['done']

  if (search) {
    countSql += ' AND prompt LIKE ?'
    querySql += ' AND prompt LIKE ?'
    params.push(`%${search}%`)
  }

  if (startDate) {
    countSql += ' AND created_at >= ?'
    querySql += ' AND created_at >= ?'
    params.push(startDate)
  }

  if (endDate) {
    countSql += ' AND created_at <= ?'
    querySql += ' AND created_at <= ?'
    params.push(endDate)
  }

  querySql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'

  const total = (db.prepare(countSql).get(...params) as any).total
  const offset = (page - 1) * pageSize
  const rows = db.prepare(querySql).all(...params, pageSize, offset) as any[]

  return { items: rows.map(parseRow), total }
}

export function countFailedGenerations(): number {
  const db = getDatabase()
  const row = db.prepare('SELECT COUNT(*) as total FROM image_generations WHERE status = ?').get('error') as any
  return row?.total || 0
}

/**
 * 应用启动时清理上一次会话残留的 pending / generating 任务（Bug #8）。
 * 应用崩溃 / 主进程被杀 / 强制退出会让 generateImages 的 finally 没机会跑，
 * DB 留下"永久生成中"的僵尸记录，UI 一直转圈。
 *
 * 策略：标记为 'error' + 错误信息说明上次异常关闭。保留 result_url 字段（如已写入）。
 */
export function cleanupStaleGenerations(): number {
  try {
    const db = getDatabase()
    const result = db.prepare(
      "UPDATE image_generations SET status = 'error', error = ? WHERE status IN ('pending','generating')"
    ).run('应用上次异常关闭，任务未完成')
    if (result.changes > 0) {
      console.log(`[ImageGen] Cleaned up ${result.changes} stale pending/generating records on startup`)
    }
    return result.changes
  } catch (e) {
    console.error('[ImageGen] Failed to cleanup stale generations:', e)
    return 0
  }
}

export function clearFailedGenerations(): { deleted: number } {
  const db = getDatabase()
  // Bug #5: 清理磁盘上残留的失败图片（罕见但保险）
  try {
    const rows = db.prepare("SELECT result_path FROM image_generations WHERE status = 'error'").all() as { result_path?: string }[]
    for (const row of rows) {
      if (row.result_path) {
        try { removeByRelativePath(row.result_path) } catch {}
        deleteImageByRelPath(row.result_path)
      }
    }
  } catch {}
  const result = db.prepare('DELETE FROM image_generations WHERE status = ?').run('error')
  return { deleted: result.changes }
}

export function deleteGeneration(id: string): boolean {
  const db = getDatabase()
  // 联动删除：清理图库引用 + 磁盘文件（Bug #5）+ 数据库行
  try {
    const row = db.prepare('SELECT result_path FROM image_generations WHERE id = ?').get(id) as { result_path?: string } | undefined
    if (row?.result_path) {
      try { removeByRelativePath(row.result_path) } catch (e) { console.error('Failed to remove from gallery on delete:', e) }
      deleteImageByRelPath(row.result_path)
    }
  } catch {}
  const result = db.prepare('DELETE FROM image_generations WHERE id = ?').run(id)
  return result.changes > 0
}

export function deleteGenerations(ids: string[]): number {
  if (!ids.length) return 0
  const db = getDatabase()
  // 联动删除：图库引用 + 磁盘文件（Bug #5）+ 数据库行
  try {
    const placeholders = ids.map(() => '?').join(',')
    const rows = db.prepare(`SELECT result_path FROM image_generations WHERE id IN (${placeholders})`).all(...ids) as { result_path?: string }[]
    for (const row of rows) {
      if (row.result_path) {
        try { removeByRelativePath(row.result_path) } catch (e) { console.error('Failed to remove from gallery on batch delete:', e) }
        deleteImageByRelPath(row.result_path)
      }
    }
  } catch {}
  const placeholders = ids.map(() => '?').join(',')
  const result = db.prepare(`DELETE FROM image_generations WHERE id IN (${placeholders})`).run(...ids)
  return result.changes
}

function getImageDir(sessionId: string): string {
  const dir = join(getDataDir(), 'images', sessionId)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 将绝对路径转为相对于数据目录的路径 */
function toRelativePath(absolutePath: string): string {
  const dataDir = getDataDir()
  return absolutePath.replace(/\\/g, '/').replace(dataDir.replace(/\\/g, '/'), '').replace(/^\//, '')
}

type ImageAPIResult = { b64_json?: string; url?: string; revised_prompt?: string }

function isGptImageModel(modelId: string): boolean {
  return /^gpt-image(?:-|$)|^chatgpt-image-latest$/i.test(stripModelId(modelId))
}

/**
 * 把用户在 ModelProvider 上配置的 custom_params + request_override_patch 叠加到生图请求 body 上。
 * 顺序：先 custom_params（逐条 set），再 request_override_patch（最终覆盖）。
 *
 * - JSON body：直接 body[name]=value
 * - FormData：form.set(name, value)；对象类型 JSON.stringify 后下发（上游通常自己解析）
 * - 空字符串 value 视为占位不下发；undefined 同理
 * - value 字符串会尝试 coerceValue 转 number/boolean/JSON 对象（覆盖 patch 已是 typed value 不二次转换）
 *
 * 仅作用于自定义 provider 与多米分支；云端走固定网关协议，不参与叠加。
 */
function applyProviderPatches(body: Record<string, any> | FormData, provider: ModelProvider): void {
  for (const p of provider.custom_params) {
    if (!p.name || p.value === '') continue
    setBodyField(body, p.name, coerceParamValue(p.value))
  }
  for (const [k, v] of Object.entries(provider.request_override_patch)) {
    if (v === undefined) continue
    setBodyField(body, k, v)
  }
}

/**
 * multipart 路径下，下面这些 key 用 `set` 会清掉前面 append 的多张参考图 / 蒙版
 *（FormData.set 会移除同名所有 entry，再写入新值）。
 *
 * 历史踩坑：用户 customParams 里随手配了 name=image / name=images / name=mask 后，
 * applyProviderPatches → setBodyField → form.set('image', ...) 会把前面
 * for img of refImages 循环 append 进去的所有 image entry **全部清空**，
 * 真实表现是「参考图悄悄丢了，上游还报 missing image」。
 *
 * 这里硬性保留：multipart 路径下这些字段不让 customParams / request_override_patch 覆盖。
 */
const FORM_RESERVED_KEYS = new Set(['image', 'images', 'mask'])

function setBodyField(body: Record<string, any> | FormData, key: string, value: any): void {
  if (body instanceof FormData) {
    if (value == null) return
    if (FORM_RESERVED_KEYS.has(key)) {
      console.warn(`[ImageGen] customParam "${key}" 是 multipart 保留字段（参考图 / 蒙版），已忽略以避免覆盖`)
      return
    }
    if (typeof value === 'object') body.set(key, JSON.stringify(value))
    else body.set(key, String(value))
  } else {
    body[key] = value
  }
}

/**
 * custom_params 的 value 是 string，按形态推断转换：
 * - 'true' / 'false' → boolean
 * - 纯数字 → number
 * - 以 { 或 [ 开头并合法 JSON → 对象 / 数组
 * - 其他 → 原字符串
 * 故意不抛错：解析失败回落字符串，上游通常能接受字符串。
 */
function coerceParamValue(s: string): any {
  const t = s.trim()
  if (t === '') return ''
  if (t === 'true') return true
  if (t === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t)
    if (Number.isFinite(n)) return n
  }
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try { return JSON.parse(t) } catch {}
  }
  return s
}

/**
 * 异步生图任务轮询通用器。
 *
 * 设计目标：把云端 / 多米两套几乎一样的轮询逻辑合并 — 它们仅在三个点上不同：
 *  1. 状态字段路径（`status` vs `state`）
 *  2. 成功/失败的状态值（`completed` vs `succeeded`；`failed` vs `failed/error/cancelled`）
 *  3. 结果数据形状（`result.data` items vs `data.images` items）
 * 这些差异由调用方通过 `parseStatus` 注入。
 *
 * 行为：
 *  - 401/403：立即抛"鉴权失败"（永久错误，重试无意义）
 *  - 404：立即抛"任务不存在或已过期"
 *  - 其他 4xx/5xx + 网络异常 + 响应解析失败：视为瞬态错误。
 *      - 未设置 `maxConsecutiveTransientFailures` → 一直软重试到 `maxWaitMs` deadline（云端策略）
 *      - 设置后 → 连续 N 次失败提前抛错（多米策略，避免上游持续不可用时白等）
 *  - `parseStatus` 返回 null → 继续轮询；返回数组 → 任务成功；抛错 → 任务失败
 *  - 超过 `maxWaitMs` → 抛超时错误（带最后一次瞬态错误信息，方便排查）
 */
interface PollTaskConfig {
  statusUrl: string
  headers: Record<string, string>
  taskId: string
  errorPrefix: string
  refreshHeaders?: (reason: string) => Promise<Record<string, string> | null>
  /** 解析响应：成功 → 返回结果数组；进行中 → 返回 null 继续轮询；失败 → 抛错 */
  parseStatus: (statusData: any) => ImageAPIResult[] | null
  /**
   * 可选：从合法状态响应里抽取一段诊断字符串（如多米的 `state`、云端的 `status`），
   * 仅用于超时错误信息回带，帮助用户分辨"卡在 pending"还是"卡在 running"。
   * 抛错由 parseStatus 负责，此函数不应抛错。
   */
  extractDiagnostic?: (statusData: any) => string | undefined
  maxWaitMs?: number
  pollIntervalMs?: number
  pollTimeoutMs?: number
  /** 连续瞬态失败上限。undefined = 不限（直到 deadline）；正整数 = 达到即抛错 */
  maxConsecutiveTransientFailures?: number
  /** 用户手动中止信号：aborted 时立即终止轮询并抛 GenerationCanceledError */
  signal?: AbortSignal
}

async function pollAsyncTask(config: PollTaskConfig): Promise<ImageAPIResult[]> {
  // 默认总等 15 分钟，与单次生图 timeout 同档（云控端 gateway.timeouts.image=900s 对齐）。
  // 多米异步任务实际通常 30s ~ 3min 完成，15min 兜底覆盖 4K + 排队高峰。
  const maxWait = config.maxWaitMs ?? 900_000
  const pollInterval = config.pollIntervalMs ?? 3_000
  const pollTimeout = config.pollTimeoutMs ?? 30_000
  const maxConsecutive = config.maxConsecutiveTransientFailures
  const start = Date.now()
  let lastTransientError: string | undefined
  let lastDiagnostic: string | undefined
  let consecutiveTransientFailures = 0

  const bumpTransient = (msg: string): void => {
    lastTransientError = msg
    consecutiveTransientFailures++
    if (maxConsecutive !== undefined && consecutiveTransientFailures >= maxConsecutive) {
      throw new Error(`${config.errorPrefix} 持续不可用（连续 ${consecutiveTransientFailures} 次轮询失败，task_id=${config.taskId}）：${msg}`)
    }
    console.log(`[ImageGen] ${config.errorPrefix} poll transient:`, msg)
  }

  while (Date.now() - start < maxWait) {
    if (config.signal?.aborted) throw new GenerationCanceledError()
    await interruptibleSleep(pollInterval, config.signal)

    let statusRes: Response
    try {
      statusRes = await fetchWithTimeout(config.statusUrl, {
        method: 'GET',
        headers: config.headers
      }, pollTimeout, config.signal)
    } catch (e: any) {
      // 用户手动中止：立即终止轮询，不计入瞬态失败
      if (isCanceledError(e)) throw e
      bumpTransient(String(e?.message || e))
      continue
    }

    if (statusRes.status === 401 && config.refreshHeaders) {
      const nextHeaders = await config.refreshHeaders(`${config.errorPrefix} 401: ${await readResponseError(statusRes)}`)
      if (nextHeaders) {
        config.headers = nextHeaders
        continue
      }
    }
    if (statusRes.status === 401 || statusRes.status === 403) {
      throw new Error(`${config.errorPrefix} ${statusRes.status}: ${await readResponseError(statusRes)}`)
    }
    if (statusRes.status === 404) {
      throw new Error(`${config.errorPrefix} 404: 任务不存在或已过期 (task_id=${config.taskId})`)
    }
    if (!statusRes.ok) {
      const body = await readResponseError(statusRes).catch(() => `HTTP ${statusRes.status}`)
      bumpTransient(body)
      continue
    }

    let statusData: any
    try {
      statusData = await statusRes.json()
    } catch {
      bumpTransient('响应解析失败')
      continue
    }
    consecutiveTransientFailures = 0  // 拿到合法响应即重置

    // 先抽取诊断信息（不影响业务逻辑，仅用于超时错误回带）
    if (config.extractDiagnostic) {
      try {
        const d = config.extractDiagnostic(statusData)
        if (d) lastDiagnostic = d
      } catch { /* 诊断提取失败不影响轮询 */ }
    }

    const result = config.parseStatus(statusData)  // 抛错由调用方决定（终止态）
    if (result !== null) return result
    // null = 还在进行中，继续轮询
  }

  // 超时错误信息：可能同时带 last_status（任务卡住的状态）和 last_error（最后一次瞬态错误），
  // 帮助用户排查到底是"任务长时间未完成"还是"上游持续不可用"。
  const diag = lastDiagnostic ? `, last_status=${lastDiagnostic}` : ''
  const err = lastTransientError ? `, last_error=${lastTransientError}` : ''
  throw new Error(`${config.errorPrefix} 任务超时（>${maxWait / 1000}s 未完成，task_id=${config.taskId}${diag}${err}）`)
}

async function callImageAPI(
  providerId: string,
  modelId: string,
  prompt: string,
  size: string,
  quality: string,
  refImages?: string[],
  mask?: string,
  tierId?: string,
  n: number = 1,
  signal?: AbortSignal
): Promise<ImageAPIResult[]> {
  // 渲染端 cloud:default 下的 modelId 可能是复合 key `{model_id}#@{provider_name}`，
  // 上游真实 API 不识别；云端分支用 resolveCloudModelId 同时拿到纯 model_id 与 cloud_model_id 主键，
  // 后者作为 body.cloud_model_id 让云控端按主键精确路由到对应服务商；
  // 本地 provider 的 modelId 不含分隔符，stripModelId 是 no-op。
  const isCloud = providerId.startsWith('cloud:')
  let cloudModelId: number | null = null
  if (isCloud) {
    const resolved = resolveCloudModelId(modelId, 'image')
    modelId = resolved.pureModelId
    cloudModelId = resolved.cloudModelId
    // 防启动竞态错路由：刚登录、cloudModels 还没从渲染端 IPC 同步到主进程时，cloudModelId
    // 必为 null，此时若照发请求，云端只能按 model_id 兜底（多家同名会错路由 / 错扣费）。
    // 仅在「完全没有模型缓存」（明确未同步）时拦截并提示重试；多家同名等场景交由云端
    // 返回 ambiguous_model 明确报错，避免误伤合法的单家路由。
    if (cloudModelId === null && getCloudModels().length === 0) {
      throw new Error('云端模型尚未同步完成，请稍候几秒后重试')
    }
  } else {
    modelId = stripModelId(modelId)
  }
  // Bug #3: 全局 semaphore — 所有入口共享上限
  await acquireApiSlot()
  try {
    // 等待 semaphore 排队期间用户可能已点中止：拿到 slot 后先判一次
    if (signal?.aborted) throw new GenerationCanceledError()
    if (isCloud) {
      return await callCloudImageAPI(modelId, prompt, size, quality, refImages, mask, tierId, n, cloudModelId, signal)
    }

    const provider = getModelProvider(providerId)
    if (!provider) throw new Error(`Model provider not found: ${providerId}`)

    // 多米 API：与 OpenAI 协议差异大（裸 token 鉴权 + 强制异步 + 轮询 /tasks/{id}），走专用函数
    if (provider.type === 'duomi') {
      return await callDuoMiImageAPI(provider, modelId, prompt, size, refImages, tierId, n, signal)
    }

    const apiBase = normalizeApiBase(provider.api_base)
    const apiKey = provider.api_key

    const hasRefImages = refImages && refImages.length > 0
    const url = hasRefImages ? `${apiBase}/images/edits` : `${apiBase}/images/generations`

    const headers: Record<string, string> = {}
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    let fetchOptions: RequestInit
    // 失败诊断快照：根据 multipart / JSON 路径分别保留请求体描述
    // multipart：await describeFormData 把 FormData 转为 { __multipart: true, parts: [...] }
    // JSON：直接保留 body 对象，buildRequestSnapshot 内部会 sanitize
    let snapshotBody: unknown

    let resolvedPx: string | null = null
    if (hasRefImages) {
      // Use multipart form for /images/edits
      resolvedPx = resolvePixels(size, modelId, tierId)
      const form = new FormData()
      form.append('model', modelId)
      form.append('prompt', prompt)
      form.append('n', String(n))
      form.append('size', resolvedPx)
      form.append('quality', quality)
      if (!isGptImageModel(modelId)) form.append('response_format', 'b64_json')
      console.log('[ImageGen] request', {
        channel: 'custom',
        endpoint: 'edits',
        model: modelId,
        size,
        tierId,
        resolvedPx,
        refCount: refImages.length,
        hasMask: !!mask,
        qualitySent: true
      })

      for (const img of refImages) {
        // 直接 base64 → Buffer 透传原始字节，不再 stripBase64。
        // 历史原因：stripJpeg 会丢掉 APP0(JFIF)/APP1(EXIF) 等所有 APPn 段，产出"裸 JPEG"。
        // 实测苍 api / sub2api 等中间网关对裸 JPEG 严格校验时会 502 / 400 拒收，
        // lingmi-ai 等同类项目也直接 io.Copy 透传原始字节。stripBase64 原本是为了
        // Chromium Canvas 重编码场景设计的（注释见 strip-image-metadata.ts），
        // 而 multipart 直传链路不经过 Canvas，原始字节透传更稳。
        // 体积兜底由 shrinkRefImageIfTooLarge 接管，仅在 > 2MB 时用 nativeImage 重编码。
        const { buffer, mimeType } = await prepareRefImageForUpload(img, 'image/png')
        // Node 22+ / Electron 31+ 严格 TS 类型下，Buffer.buffer 是 ArrayBufferLike 而
        // BlobPart 要求 ArrayBuffer，类型可赋值严格不互通；运行时 Buffer 作为 Uint8Array
        // 子类 100% 可作为 BlobPart（Node undici / Blob 实现支持），只是编译期报错。
        const blob = new Blob([buffer as unknown as BlobPart], { type: mimeType })
        const ext = mimeType.includes('png') ? 'png' : 'jpg'
        form.append('image', blob, `ref.${ext}`)
      }

      if (mask) {
        // mask 保留原始 PNG 字节：OpenAI 要求 alpha 通道标识编辑区域，
        // 不能 toJPEG 重编码（会丢 alpha）；mask 通常远小于主图，无需压缩兜底。
        const maskMatch = mask.match(/^data:([^;]+);base64,/)
        const maskRaw = maskMatch ? mask.slice(maskMatch[0].length) : mask
        const maskBuffer = Buffer.from(maskRaw, 'base64')
        const maskBlob = new Blob([maskBuffer as unknown as BlobPart], { type: 'image/png' })
        form.append('mask', maskBlob, 'mask.png')
      }

      // 用户 customParams + requestOverridePatch 叠加（最后写入，可覆盖系统默认字段）
      applyProviderPatches(form, provider)
      if (isGptImageModel(modelId)) form.delete('response_format')

      fetchOptions = { method: 'POST', headers, body: form }
      snapshotBody = await describeFormData(form)
    } else {
      headers['Content-Type'] = 'application/json'
      resolvedPx = resolvePixels(size, modelId, tierId)
      const body: any = {
        model: modelId,
        prompt,
        n,
        size: resolvedPx,
        quality
      }
      if (!isGptImageModel(modelId)) body.response_format = 'b64_json'
      // 用户 customParams + requestOverridePatch 叠加（最后写入，可覆盖系统默认字段）
      applyProviderPatches(body, provider)
      if (isGptImageModel(modelId)) delete body.response_format
      fetchOptions = { method: 'POST', headers, body: JSON.stringify(body) }
      snapshotBody = body
    }

    // 失败诊断：在 fetch 前构造脱敏后的请求快照；catch 块挂载到 error.rawRequest，
    // 由 generateImages.runOne 写入 image_generations.raw_request 列供 UI 展示与复制。
    const snapshot = buildRequestSnapshot({
      channel: 'custom',
      url,
      method: 'POST',
      headers,
      body: snapshotBody
    })

    try {
      // 单次 15min timeout + 5xx/429 自动退避重试（已统一为全档位 15min，tierId 仅为兼容签名）
      const response = await fetchWithRetry(url, fetchOptions, getImageApiTimeout(tierId), {
        retries: 2,
        errorPrefix: 'Image API error',
        signal
      })

      // 响应体也可能是非法 JSON（如某些代理返回 HTML 200）— 安全解析
      let data: any
      try {
        data = await response.json()
      } catch (e: any) {
        throw new Error(`Image API 响应解析失败：${truncateError(String(e?.message || e))}`)
      }

      if (data.usage) {
        try {
          recordUsage(
            providerId,
            modelId,
            data.usage.prompt_tokens || 0,
            data.usage.completion_tokens || 0,
            data.usage.total_tokens || 0
          )
        } catch {}
      }

      const items = data.data as any[]
      if (!items || items.length === 0) throw new Error('No image data in response')

      return items.map((item: any) => ({
        b64_json: item.b64_json,
        url: item.url,
        revised_prompt: item.revised_prompt
      }))
    } catch (e: any) {
      attachSnapshotToError(e, snapshot)
      throw e
    }
  } finally {
    releaseApiSlot()
  }
}

async function callCloudImageAPI(
  modelId: string,
  prompt: string,
  size: string,
  quality: string,
  refImages?: string[],
  mask?: string,
  tierId?: string,
  n: number = 1,
  cloudModelId: number | null = null,
  signal?: AbortSignal
): Promise<ImageAPIResult[]> {
  const token = getCloudToken()
  if (!token) throw new Error('Cloud login required')
  const gatewayUrl = getCloudGatewayUrl()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  }

  const hasRefImages = refImages && refImages.length > 0
  const endpoint = hasRefImages ? '/images/edits' : '/images/generations'
  const body: any = {
    model: modelId,
    prompt,
    n,
    size: resolvePixels(size, modelId, tierId),
    quality
  }
  if (!isGptImageModel(modelId)) body.response_format = 'b64_json'
  console.log('[ImageGen] request', {
    channel: 'cloud',
    endpoint: hasRefImages ? 'edits' : 'generations',
    model: modelId,
    size,
    tierId,
    resolvedPx: body.size,
    refCount: refImages?.length || 0,
    hasMask: !!mask,
    qualitySent: true,
    cloudModelId
  })
  // 云端网关按 cloud_model_id 主键精确路由到具体服务商，避免同 model_id 多家时 first() 错位
  if (cloudModelId !== null) {
    body.cloud_model_id = cloudModelId
  }

  if (hasRefImages) {
    // 云端生图参考图改为先上传云控端换 https URL，以 image_urls 提交，不再内联 base64；
    // 已是 http(s) URL 的直接透传（不重复上传）。云控端网关按 image_urls 读回字节再转发上游。
    body.image_urls = await Promise.all(refImages.map(async (img) => {
      if (/^https?:\/\//i.test(img.trim())) return img.trim()
      const { buffer, mimeType } = await prepareRefImageForUpload(img, 'image/jpeg')
      return await uploadRefImageToCloud(buffer, mimeType)
    }))
  }

  if (mask) {
    // mask 同样换 URL：PNG 必须保留 alpha，故用 readRefImageBytes 取原始字节（不经 shrink 重编码），
    // 上传换 URL 后以 mask_url 提交。
    if (/^https?:\/\//i.test(mask.trim())) {
      body.mask_url = mask.trim()
    } else {
      const { buffer, mimeType } = await readRefImageBytes(mask, 'image/png')
      body.mask_url = await uploadRefImageToCloud(buffer, mimeType)
    }
  }

  const submitUrl = `${gatewayUrl}${endpoint}`
  // 失败诊断：在 fetch 前构造脱敏后的请求快照，catch 块挂载到 error.rawRequest
  const snapshot = buildRequestSnapshot({
    channel: 'cloud',
    url: submitUrl,
    method: 'POST',
    headers,
    body
  })

  try {
    // Step 1: Submit task — 60s 超时 + 5xx/429 退避重试
    let submitRes: Response
    try {
      submitRes = await fetchWithRetry(submitUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      }, 60_000, { retries: 2, errorPrefix: 'Image API error', signal })
    } catch (e: any) {
      if (!String(e?.message || '').startsWith('Image API error 401:')) throw e
      const nextToken = await refreshCloudToken()
      if (!nextToken) {
        if (wasLastCloudTokenRefreshAuthFailure()) notifyCloudAuthExpired(e.message)
        throw e
      }
      headers['Authorization'] = `Bearer ${nextToken}`
      submitRes = await fetchWithRetry(submitUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      }, 60_000, { retries: 2, errorPrefix: 'Image API error', signal })
    }

    let submitData: any
    try {
      submitData = await submitRes.json()
    } catch (e: any) {
      throw new Error(`云端生图响应解析失败：${truncateError(String(e?.message || e))}`)
    }
    const taskId = submitData.task_id
    if (!taskId) {
      // Direct response (no async)
      const items = submitData.data as any[]
      if (!items || items.length === 0) throw new Error('No image data in response')
      return items.map((item: any) => ({ b64_json: item.b64_json, url: item.url, revised_prompt: item.revised_prompt }))
    }

    // Step 2: Poll for result — 软重试到 deadline（429/5xx/网络/解析错误持续重试，不早退）
    console.log('[ImageGen] Cloud task submitted:', taskId)
    // 注意：必须 await，否则 pollAsyncTask 内的 reject 不会被外层 try/catch 捕获，
    // 导致轮询失败时丢失快照挂载。
    return await pollAsyncTask({
      statusUrl: `${gatewayUrl}/images/status/${taskId}`,
      headers: { 'Authorization': headers['Authorization'] },
      taskId,
      errorPrefix: 'Image API error',
      signal,
      refreshHeaders: async (reason) => {
        const nextToken = await refreshCloudToken()
        if (!nextToken) {
          if (wasLastCloudTokenRefreshAuthFailure()) notifyCloudAuthExpired(reason)
          return null
        }
        return { 'Authorization': `Bearer ${nextToken}` }
      },
      extractDiagnostic: (statusData) => statusData?.status,
      parseStatus: (statusData) => {
        if (statusData.status === 'completed') {
          const items = (statusData.result?.data || statusData.data) as any[]
          if (!items || items.length === 0) throw new Error('No image data in response')
          return items.map((item: any) => ({ b64_json: item.b64_json, url: item.url, revised_prompt: item.revised_prompt }))
        }
        if (statusData.status === 'failed') {
          throw new Error(truncateError(statusData.error || 'Image generation failed'))
        }
        return null  // 进行中，继续轮询
      }
    })
  } catch (e: any) {
    attachSnapshotToError(e, snapshot)
    throw e
  }
}

/**
 * 把 UI size + tierId 解析为多米接受的实际像素串（如 '3840x2160' / '2048x1152'）。
 *
 * v0.6.6+ 重设：多米实测支持标准 gpt-image-2 规则的任意像素串（上限 3840×2160，
 * 在 capability 表中的 maxTotalPixels=8_294_400），原先反向 snap 到比例 enum 会丢掉用户选的
 * 2K/4K 档位。现在直接用 resolvePixels （与 OpenAI 路径一致），让档位生效。
 *
 * 兑底：解析失败（非法 size）返回 'auto'，多米会用默认尺寸渲染。
 */
function resolveDuoMiSize(size: string, tierId?: string): string {
  const s = (size || '').toLowerCase().trim()
  if (s === '' || s === 'auto') return 'auto'
  try {
    return resolvePixels(size, 'gpt-image-2', tierId)
  } catch {
    return 'auto'
  }
}

/**
 * 参考图体积兜底：base64/Buffer 字节数超阈值时，用 nativeImage 重编码为较小 JPEG。
 *
 * 阈值取 100KB 字节的精确算法依据：
 *   多米 /v1/images/generations 对 image 字段 base64 长度有硬性上限（实测 140K chars
 *   触发 400 fail_to_submit_task）。100KB 字节 → base64 ≈ 133K chars，给多米 140K 上限
 *   留 5% 安全余量。同链路（苍 api / sub2api / 云控端 cloud_model_id 路由到多米类后端）
 *   都受同一上限约束，统一一个阈值兼顾三条路径。
 *
 * 注意：100KB 比"画质优先"的直觉小很多——很多生图参考图（高质量小图）都会被压缩。
 *   但参考图本来就是给模型做风格/构图引导，不需要原画质，损失可接受。
 *
 * 设计要点：
 *   1. 阈值 100KB：精确卡在多米 140K base64 chars 上限下方
 *   2. 超阈值时长边收敛到 ≤ 1024px，JPEG 质量 80→65→50 递降
 *   3. 二轮兜底：长边降到 768 + q=65（极端微信原图等场景）
 *   4. 已 ≤ 阈值 / 解码失败：原样返回 —— 不冒重编码风险
 *
 * 故意不做 EXIF/ICC 段剥离：实测 sub2api（苍 api）等中间网关对"裸 JPEG（无 JFIF
 * 段）"严格校验时会拒收，反而把合法图弄成不合法图。原始字节透传是最稳的策略；
 * 真要去 ICC 也由 nativeImage 重编码顺带完成（输出标准 JFIF JPEG）。
 */
function shrinkRefImageIfTooLarge(
  buffer: Buffer,
  mimeType: string
): { buffer: Buffer; mimeType: string } {
  const MAX_BYTES = 100 * 1024 // 100KB → base64 ~133K chars，留 5% 余量在多米 140K chars 上限下

  if (buffer.length <= MAX_BYTES) {
    return { buffer, mimeType }
  }

  let img = nativeImage.createFromBuffer(buffer)
  if (img.isEmpty()) {
    console.warn(`[ImageGen] shrinkRef: nativeImage 无法解码 ${mimeType} (${buffer.length} bytes), 原样透传由上游决定`)
    return { buffer, mimeType }
  }

  const origSize = img.getSize()
  if (origSize.width > 1024 || origSize.height > 1024) {
    img = origSize.width >= origSize.height
      ? img.resize({ width: 1024, quality: 'good' })
      : img.resize({ height: 1024, quality: 'good' })
  }

  for (const q of [80, 65, 50]) {
    const out = img.toJPEG(q)
    if (out.length > 0 && out.length <= MAX_BYTES) {
      const sz = img.getSize()
      console.log(`[ImageGen] shrinkRef: ${buffer.length} → ${out.length} bytes (${origSize.width}x${origSize.height} → ${sz.width}x${sz.height} jpeg q=${q})`)
      return { buffer: out, mimeType: 'image/jpeg' }
    }
  }

  // 二轮：长边再降到 768 + q=65 兜底
  const cur = img.getSize()
  img = cur.width >= cur.height
    ? img.resize({ width: 768, quality: 'good' })
    : img.resize({ height: 768, quality: 'good' })
  const finalOut = img.toJPEG(65)
  const finalSize = img.getSize()
  console.log(`[ImageGen] shrinkRef (二轮): ${buffer.length} → ${finalOut.length} bytes (${origSize.width}x${origSize.height} → ${finalSize.width}x${finalSize.height} jpeg q=65)`)
  return { buffer: finalOut, mimeType: 'image/jpeg' }
}

function normalizeImageMime(mimeType: string, fallback: string): string {
  const mime = (mimeType || '').split(';')[0].trim().toLowerCase()
  if (!mime.startsWith('image/')) return fallback
  return mime === 'image/jpg' ? 'image/jpeg' : mime
}

async function readRefImageBytes(input: string, fallbackMime: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const value = (input || '').trim()
  if (!value) {
    return { buffer: Buffer.alloc(0), mimeType: fallbackMime }
  }

  const match = value.match(/^data:([^;]+);base64,/)
  if (match) {
    return {
      buffer: Buffer.from(value.slice(match[0].length), 'base64'),
      mimeType: normalizeImageMime(match[1], fallbackMime)
    }
  }

  if (/^https?:\/\//i.test(value)) {
    const res = await fetchWithTimeout(value, { method: 'GET' }, 30_000)
    if (!res.ok) {
      throw new Error(`参考图下载失败 HTTP ${res.status}: ${value}`)
    }
    const mimeType = normalizeImageMime(res.headers.get('content-type') || '', fallbackMime)
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      mimeType
    }
  }

  return { buffer: Buffer.from(value, 'base64'), mimeType: fallbackMime }
}

async function prepareRefImageForUpload(input: string, fallbackMime: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const { buffer, mimeType } = await readRefImageBytes(input, fallbackMime)
  return shrinkRefImageIfTooLarge(buffer, mimeType)
}

/**
 * 把参考图字节上传到云控端临时存储，换取公网 https URL。
 *
 * 多米图片 API 只可靠接受图片 URL，本地直连路径无法直接送 base64/dataUri（上游会拒收或
 * 静默忽略参考图）。云控端 /client/images/reference-assets 落对象存储后返回 URL，素材
 * 6h 过期由 video:purge-reference-assets 自动清理。依赖桌面端整体已登录云控端。
 */
async function uploadRefImageToCloud(buffer: Buffer, mimeType: string): Promise<string> {
  // 统一走共享上传模块（与视觉发图共用同一端点 /client/images/reference-assets）。
  return uploadImageBytesToCloud(buffer, mimeType)
}

/**
 * 多米 API（duomiapi.com）图片生成 — 官方文档 https://duomiapi.com/doc/55。
 *
 * 官方当前**仅支持 gpt-image-2 一个模型**。请求 body 仅 4 个字段：model / prompt / size / image。
 *
 * 与 OpenAI 协议的差异点：
 *   1. 鉴权头是裸 token（`Authorization: <key>`），不带 Bearer 前缀
 *   2. 仅支持异步：POST /v1/images/generations?async=true 返回 { id }，再 GET /v1/tasks/{id} 轮询
 *   3. size 字段接受标准 gpt-image-2 规则的任意 WxH 像素串（上限 3840×2160 = 8.29M 像素）以及
 *      比例字符串 / 'auto'。UI 档位（1k/2k/4k）生效，由 resolvePixels 按 capability 计算真实像素。
 *   4. 不支持 n>1。
 *   5. 参考图：用单数 `image` 字段（schema 允许 string 或 string[]），元素必须是 https URL。
 *      多米上游不可靠接受 dataUri / 裸 base64（会拒收或静默忽略参考图），故本地参考图先
 *      上传到云控端 /client/images/reference-assets 换成 URL 再提交。仍走 /generations + JSON。
 *
 * model_id 防护：本地 provider.models 如果不是 gpt-image-2（例如老数据 / 手工编辑），
 * submit 前自动覆盖为 gpt-image-2，与 Adapter 层 cleanseDuoMiBody 一致。
 *
 * 返回形态：[{ url }]，上层 generateImages 会调 downloadImageToFile 下载到本地。
 */
async function callDuoMiImageAPI(
  provider: ModelProvider,
  modelId: string,
  prompt: string,
  size: string,
  refImages?: string[],
  tierId?: string,
  n: number = 1,
  signal?: AbortSignal
): Promise<ImageAPIResult[]> {
  const apiBase = normalizeApiBase(provider.api_base)
  const apiKey = provider.api_key

  if (n > 1) {
    console.warn('[ImageGen] 多米 API 不支持单次 n>1，已强制 n=1（上层 batchCount 路径会多次调用）')
    n = 1
  }

  // v0.6.6+ 多米 size 接受标准 gpt-image-2 规则的真实像素串（如 '3840x2160'），与 OpenAI 路径一致走
  // resolvePixels 计算：UI 档位（1k/2k/4k）、比例、预设、自定义像素都转成代码使用 capability
  // 表 maxTotalPixels=8_294_400 上限兑底。原先反向 snap 到比例 enum 会丢掉用户的 2K/4K 档位。
  const duomiSize = resolveDuoMiSize(size, tierId)

  // 多米官方文档仅列 gpt-image-2 一个模型。本地 provider.models 与之不一致时自动覆盖，
  // 兼容历史不规范数据（UI 层 ModelView.vue 已锁定，此处是异常路径兑底）。
  if (modelId !== 'gpt-image-2') {
    console.warn(`[ImageGen] 多米 API 官方仅支持 gpt-image-2，自动覆盖 modelId: ${modelId} → gpt-image-2`)
  }

  const submitUrl = `${apiBase}/images/generations?async=true`
  const submitBody: Record<string, any> = { model: 'gpt-image-2', prompt, size: duomiSize }

  // 参考图处理：多米图片 API 只可靠接受图片 URL —— dataUri / 裸 base64 会被上游拒收
  // （fail_to_submit_task）或静默忽略参考图。因此先把参考图（经 shrinkRefImageIfTooLarge
  // 压缩到 ≤2MB）上传到云控端临时存储换成 https URL，再交给多米；临时图 6h 后由云控端
  // video:purge-reference-assets 定时清理，不会堆积。
  if (refImages && refImages.length > 0) {
    submitBody.image = await Promise.all(refImages.map(async (img) => {
      // 已是 http(s) URL：直接透传，不重复上传
      if (/^https?:\/\//i.test(img.trim())) return img.trim()
      const { buffer, mimeType } = await prepareRefImageForUpload(img, (img.match(/^data:([^;]+);base64,/)?.[1]) || 'image/png')
      return await uploadRefImageToCloud(buffer, mimeType)
    }))
  }

  // 用户 customParams + requestOverridePatch 叠加（最后写入，可覆盖系统默认字段）
  applyProviderPatches(submitBody, provider)

  // 提交前打印请求摘要（不含完整 base64）：失败排错时配合 readResponseError 的 raw 一并定位字段问题
  const imageSummary = Array.isArray(submitBody.image)
    ? submitBody.image.map((s: any, i: number) => {
        const str = typeof s === 'string' ? s : String(s)
        return `[${i}] ${str.slice(0, 64)}... len=${str.length}`
      })
    : []
  console.log('[ImageGen] DuoMi submit body summary:', {
    url: submitUrl,
    model: submitBody.model,
    size: submitBody.size,
    promptLen: typeof submitBody.prompt === 'string' ? submitBody.prompt.length : 0,
    imageCount: imageSummary.length,
    imageSummary,
    extraKeys: Object.keys(submitBody).filter(k => !['model', 'prompt', 'size', 'image'].includes(k))
  })

  // 失败诊断：在 fetch 前构造脱敏后的请求快照；catch 块挂载到 error.rawRequest，
  // 由 generateImages.runOne 写入 image_generations.raw_request 列供 UI 展示与复制。
  const snapshot = buildRequestSnapshot({
    channel: 'duomi',
    url: submitUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey
    },
    body: submitBody
  })

  try {
    const submitRes = await fetchWithRetry(submitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey
      },
      body: JSON.stringify(submitBody)
    }, 60_000, { retries: 2, errorPrefix: '多米 API 提交失败', signal })

    let submitData: any
    try {
      submitData = await submitRes.json()
    } catch (e: any) {
      throw new Error(`多米 API 响应解析失败：${truncateError(String(e?.message || e))}`)
    }
    const taskId: string | undefined = submitData?.id
    if (!taskId) {
      throw new Error(`多米 API 响应缺少 task id：${truncateError(JSON.stringify(submitData))}`)
    }

    // 轮询任务状态 — 多米策略：连续 12 次瞬态失败提前抛错（避免上游持续不可用时白等 5 分钟）
    console.log('[ImageGen] DuoMi task submitted:', taskId)
    // 注意：必须 await，否则 pollAsyncTask 内的 reject 不会被外层 try/catch 捕获，
    // 导致轮询失败时丢失快照挂载。
    return await pollAsyncTask({
      statusUrl: `${apiBase}/tasks/${taskId}`,
      headers: { 'Authorization': apiKey },  // 多米是裸 token，无 Bearer 前缀
      taskId,
      errorPrefix: '多米 API',
      signal,
      maxConsecutiveTransientFailures: 12,  // 12 * 3s ≈ 36s 持续失败后早退
      extractDiagnostic: (statusData) => statusData?.state,
      parseStatus: (statusData) => {
        const state: string | undefined = statusData?.state
        if (state === 'succeeded') {
          const images = Array.isArray(statusData?.data?.images) ? statusData.data.images : []
          const out: ImageAPIResult[] = []
          for (const img of images) {
            if (img?.url) out.push({ url: String(img.url) })
          }
          if (out.length === 0) {
            throw new Error(`多米 API 任务声明成功但未返回图片 URL（task_id=${taskId}）`)
          }
          return out
        }
        if (state === 'failed' || state === 'error' || state === 'cancelled') {
          const msg = statusData?.data?.description || statusData?.message || '任务执行失败'
          throw new Error(`多米 API 任务失败（state=${state}, task_id=${taskId}）：${truncateError(String(msg))}`)
        }
        // pending / running / processing / queued / 未知 → 继续轮询
        return null
      }
    })
  } catch (e: any) {
    attachSnapshotToError(e, snapshot)
    throw e
  }
}

function saveImageToFile(ctx: OutputContext, genId: string, b64Data: string): string {
  // Detect format from base64 header or default to png
  let ext = 'png'
  let rawBase64 = b64Data
  if (b64Data.startsWith('data:')) {
    const match = b64Data.match(/^data:image\/(\w+);base64,/)
    if (match) {
      ext = match[1] === 'jpeg' ? 'jpg' : match[1]
      rawBase64 = b64Data.slice(match[0].length)
    }
  }
  const dir = getOutputDir(ctx)
  const filename = buildOutputFilename(ctx, genId, ext)
  const filePath = join(dir, filename)
  const buffer = Buffer.from(rawBase64, 'base64')
  writeFileSync(filePath, buffer)
  return toRelativePath(filePath)   // 返回相对路径
}

async function downloadImageToFile(ctx: OutputContext, genId: string, imageUrl: string): Promise<string> {
  // 3 分钟覆盖 4K / 多张大文件场景；retries=1：图片 URL 通常时效短（多米 ~15min），
  // 多次重试反而拖延错误反馈。1 次足够覆盖偶发网络抖动；URL 失效（403/410/404）直接抛错。
  const response = await fetchWithRetry(imageUrl, { method: 'GET' }, 180_000, {
    retries: 1,
    errorPrefix: 'Image download error'
  })
  if (!response.ok) throw new Error(`Failed to download image: ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  const contentType = response.headers.get('content-type') || 'image/png'
  let ext = 'png'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg'
  else if (contentType.includes('webp')) ext = 'webp'
  const dir = getOutputDir(ctx)
  const filename = buildOutputFilename(ctx, genId, ext)
  const filePath = join(dir, filename)
  writeFileSync(filePath, buffer)
  return toRelativePath(filePath)   // 返回相对路径
}

function insertGeneration(data: {
  id: string
  session_id: string
  prompt: string
  revised_prompt: string
  ref_images: string[]
  model_provider_id: string
  model_id: string
  size: string
  quality: string
  /** 分辨率档位 id（1k/2k/4k）：重新生成时复现原档位 */
  tier_id?: string
  result_path: string
  result_url: string
  status: string
  error: string
  /** 可选：预创建 pending 记录时默认空字符串；失败时由 updateGenerationStatus 写入 */
  raw_request?: string
}): ImageGeneration {
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO image_generations (id, session_id, prompt, revised_prompt, ref_images, model_provider_id, model_id, size, quality, tier_id, result_path, result_url, status, error, raw_request, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.id,
    data.session_id,
    data.prompt,
    data.revised_prompt,
    JSON.stringify(data.ref_images),
    data.model_provider_id,
    data.model_id,
    data.size,
    data.quality,
    data.tier_id || '',
    data.result_path,
    data.result_url,
    data.status,
    data.error,
    data.raw_request || '',
    now
  )
  // Update session timestamp
  db.prepare('UPDATE image_sessions SET updated_at=? WHERE id=?').run(now, data.session_id)
  return getGeneration(data.id)!
}

/**
 * 保存生图结果到本地：base64 直接落盘，URL 模式先把 URL 写库再下载，
 * 下载失败时确保 DB 里 result_url 不丢（用户可手动救）并抛错让外层标 'error'。
 * 返回 { result_path, result_url } 仅在成功路径下使用。
 */
async function saveOrDownloadResult(
  ctx: OutputContext,
  genId: string,
  apiResult: ImageAPIResult
): Promise<{ result_path: string; result_url: string }> {
  let resultPath = ''
  let resultUrl = ''
  if (apiResult.b64_json) {
    resultPath = saveImageToFile(ctx, genId, apiResult.b64_json)
  } else if (apiResult.url) {
    resultUrl = apiResult.url
    // 先持久化 URL，避免 download 失败时 catch 里没机会回填
    try {
      const db = getDatabase()
      db.prepare('UPDATE image_generations SET result_url = ? WHERE id = ?').run(resultUrl, genId)
    } catch (e) {
      console.error('[ImageGen] Failed to persist result_url before download:', e)
    }
    try {
      resultPath = await downloadImageToFile(ctx, genId, apiResult.url)
    } catch (e: any) {
      const detail = truncateError(String(e?.message || e))
      throw new Error(`图片下载失败：${detail}（已保留原 URL，可手动复制访问）`)
    }
  }
  if (!resultPath && !resultUrl) {
    throw new Error('服务商返回的图片数据为空：缺少 b64_json 或 url')
  }
  return { result_path: resultPath, result_url: resultUrl }
}

function updateGenerationStatus(id: string, status: string, updates: Partial<{ result_path: string; result_url: string; revised_prompt: string; error: string; raw_request: string }>): void {
  const db = getDatabase()
  const sets: string[] = ['status = ?']
  const params: any[] = [status]
  if (updates.result_path !== undefined) { sets.push('result_path = ?'); params.push(updates.result_path) }
  if (updates.result_url !== undefined) { sets.push('result_url = ?'); params.push(updates.result_url) }
  if (updates.revised_prompt !== undefined) { sets.push('revised_prompt = ?'); params.push(updates.revised_prompt) }
  if (updates.error !== undefined) { sets.push('error = ?'); params.push(updates.error) }
  // raw_request 仅在失败路径写入：generateImages.runOne 的 catch 块从 error.rawRequest 读取
  if (updates.raw_request !== undefined) { sets.push('raw_request = ?'); params.push(updates.raw_request) }
  params.push(id)
  db.prepare(`UPDATE image_generations SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export async function generateImages(
  options: GenerateImageOptions,
  window?: BrowserWindow | null
): Promise<ImageGeneration[]> {
  const prompt = resolveWorkspaceBrandPrompt(options.prompt, {
    apply: !!options.applyWorkspaceBrand,
    userOverride: !!options.brandUserOverride
  })
  assertImagePromptLength(prompt, '生图提示词')
  // 前置：模型工作模式校验（mode = 'edit_only' / 'text2img' / 'both'）
  // 在创建 DB 记录与发送 API 请求之前拦截，提供友好提示（避免上游返回生涩英文报错）。
  // 默认 'both' = 任意请求都放行；只有显式注册了 mode 的模型才会拦截。
  const _refCount = options.refImages?.length || 0
  const _hasMask = !!options.mask
  const _mode = getModelMode(options.modelId)
  if (_mode === 'edit_only' && _refCount === 0 && !_hasMask) {
    throw new Error(`模型「${options.modelId}」仅支持编辑模式，请先提供参考图或蒙版后再生成。`)
  }
  if (_mode === 'text2img' && (_refCount > 0 || _hasMask)) {
    throw new Error(`模型「${options.modelId}」仅支持纯文生图，不能携带参考图或蒙版。请切换到支持编辑的模型，或移除参考图/蒙版。`)
  }

  const sessionId = options.sessionId || getOrCreateDefaultSession()
  const batchCount = Math.min(Math.max(options.batchCount || 1, 1), 10)
  const quality = options.quality || 'auto'
  const results: ImageGeneration[] = []
  const progressCtx = options.progressContext || {}

  // 统一进度事件发送：自动附加 progressContext（conversationId / source），
  // 让前端能按来源过滤（chat 浮窗 vs ImageGenView）。
  function emitProgress(payload: Record<string, any>): void {
    if (!window) return
    try {
      window.webContents.send('imageGen:progress', {
        ...payload,
        sessionId,
        conversationId: progressCtx.conversationId,
        requestId: progressCtx.requestId,
        source: progressCtx.source || 'image-gen'
      })
    } catch (e) {
      console.error('[ImageGen] emitProgress failed:', e)
    }
  }

  // Pre-create all generation records as pending
  const genIds: string[] = []
  for (let i = 0; i < batchCount; i++) {
    const genId = uuid()
    genIds.push(genId)
    insertGeneration({
      id: genId,
      session_id: sessionId,
      prompt,
      revised_prompt: '',
      ref_images: options.refImages || [],
      model_provider_id: options.modelProviderId,
      model_id: options.modelId,
      size: options.size,
      quality,
      tier_id: options.tierId,
      result_path: '',
      result_url: '',
      status: 'pending',
      error: ''
    })
  }

  // Send initial progress
  emitProgress({ type: 'start', total: batchCount, completed: 0, prompt })

  // 独立 API 调用模式（n=1 each）。
  // worker 数量直接取 batchCount（上限 10），全局 semaphore（默认 6）天然限流，
  // 无需再向上层暴露 concurrency 概念。
  {
    const ordered: (ImageGeneration | null)[] = new Array(batchCount).fill(null)
    let cursor = 0
    let completedCount = 0

    async function runOne(i: number): Promise<void> {
      const genId = genIds[i]
      // 注册中止句柄：cancelGeneration(genId) 会 abort 此 controller，沿 fetch / 轮询链路终止
      const abortController = new AbortController()
      inflightAbortControllers.set(genId, abortController)
      // 外部 signal（options.signal）与本项内部 controller 联动：任一中止都 abort 同一个
      // controller，使下游 callImageAPI → pollAsyncTask → interruptibleSleep/fetchWithTimeout
      // 全链路保持不变即可尽快终止。已 aborted 则立即透传，避免下面再发起请求。
      const externalSignal = options.signal
      const onExternalAbort = () => abortController.abort()
      if (externalSignal) {
        if (externalSignal.aborted) abortController.abort()
        else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
      }
      try {
        updateGenerationStatus(genId, 'generating', {})
        emitProgress({
          type: 'generating',
          index: i,
          total: batchCount,
          completed: completedCount,
          genId,
          prompt
        })

        const apiResults = await callImageAPI(
          options.modelProviderId,
          options.modelId,
          prompt,
          options.size,
          quality,
          options.refImages,
          options.mask,
          options.tierId,
          1,
          abortController.signal
        )
        const apiResult = apiResults[0]
        if (!apiResult) throw new Error('服务商未返回图片数据')

        // 下载失败时 saveOrDownloadResult 抛错，进 worker 外层 catch 标 'error'；
        // result_url 已在 helper 内提前写库，便于用户手动救援。
        // OutputContext 控制落盘路径：画布调用传了 canvasProjectId/canvasNodeId 则进 canvas/{projectId}/，
        // 其他调用者（image-gen 页 / chat 工具）不传则保持原 images/{sessionId}/ 行为不变。
        const outputCtx: OutputContext = {
          sessionId,
          canvasProjectId: options.canvasProjectId,
          canvasNodeId: options.canvasNodeId
        }
        const { result_path, result_url } = await saveOrDownloadResult(outputCtx, genId, apiResult)
        if (result_path) {
          const absoluteResultPath = getAbsolutePath(result_path)
          const galleryPath =
            options.canvasProjectId
              ? absoluteResultPath
              : copyToActiveWorkspaceOutput(absoluteResultPath) || absoluteResultPath
          const imageInfo = probeImage(absoluteResultPath)
          console.log('[ImageGen] result', {
            genId,
            resultPath: result_path,
            width: imageInfo.width,
            height: imageInfo.height,
            bytes: imageInfo.size
          })
          try {
            addGeneratedImageToWorkspaceGallery(galleryPath)
          } catch (e) {
            console.error('Failed to add to workspace gallery:', e)
          }
        }

        updateGenerationStatus(genId, 'done', {
          result_path,
          result_url,
          revised_prompt: apiResult.revised_prompt || ''
        })

        const gen = getGeneration(genId)!
        ordered[i] = gen
        completedCount++

        emitProgress({
          type: 'completed',
          index: i,
          total: batchCount,
          completed: completedCount,
          genId,
          generation: gen
        })
      } catch (e: any) {
        // 用户手动中止：标记 canceled（区别于 error），发 canceled 事件让前端把占位卡转为"已取消"。
        // 计费不返还——已提交到上游的异步任务上游可能仍执行扣费，桌面端只负责停止本地等待 / 落盘。
        if (isCanceledError(e)) {
          updateGenerationStatus(genId, 'canceled', { error: '已手动中止' })
          const gen = getGeneration(genId)!
          ordered[i] = gen
          completedCount++
          emitProgress({
            type: 'canceled',
            index: i,
            total: batchCount,
            completed: completedCount,
            genId,
            generation: gen
          })
          return
        }
        const errorMsg = e?.message || 'Unknown error'
        // 失败诊断：从 error.rawRequest 提取 callXxxImageAPI 在 fetch 前抓的请求快照（已脱敏 JSON 字符串），
        // 与 error 字段一同写入数据库；UI 端 ErrorDetailDialog 据此展示「原始请求」并支持复制。
        // 历史失败记录及非生图路径错误（无快照挂载）会写入空字符串。
        const rawRequest = extractRawRequest(e)
        updateGenerationStatus(genId, 'error', { error: errorMsg, raw_request: rawRequest })

        const gen = getGeneration(genId)!
        ordered[i] = gen
        completedCount++

        // raw_request 同时通过 progress 事件回传渲染端：
        // 失败的生成项始终留在 store.inFlight 中（不会触发 fetchPage 重新拉 DB），
        // 因此必须从 IPC 直接带进 store，否则 ErrorDetailDialog 拿不到。
        // 快照已脱敏（base64 替换为占位符），通常 < 5KB，IPC 传输无压力。
        emitProgress({
          type: 'error',
          index: i,
          total: batchCount,
          completed: completedCount,
          genId,
          error: errorMsg,
          raw_request: rawRequest
        })
      } finally {
        inflightAbortControllers.delete(genId)
        // 正常结束时摘除外部 signal 监听，避免长生命周期 signal 累积监听器泄漏
        if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
      }
    }

    async function worker(): Promise<void> {
      while (true) {
        const i = cursor++
        if (i >= batchCount) return
        await runOne(i)
      }
    }

    const workers = Array.from({ length: Math.min(10, batchCount) }, () => worker())
    await Promise.all(workers)
    for (const g of ordered) if (g) results.push(g)
  }

  // Send done
  emitProgress({ type: 'done', total: batchCount, completed: batchCount })

  return results
}

export function getAbsolutePath(relPath: string): string {
  const isAbsolute = /^[A-Za-z]:|^\//.test(relPath)
  if (isAbsolute) return relPath
  return join(getDataDir(), relPath)
}

/**
 * 本地图库编辑保存：从本地图库点编辑后保存，创建独立的新 image_generation 记录，
 * 不会修改原图、不会自动加入图库（B 方案：避免本地图库出现"两张相同"的视觉问题）。
 *
 * 与 saveEditedImage 的区别：
 *  - saveEditedImage 用于"我的创作"页内编辑：覆盖该 generation 的 result_path
 *  - saveLocalEdited 用于本地图库编辑：新建独立 generation，仅出现在"我的创作"页面
 */
export function saveLocalEdited(sourcePath: string, base64Data: string): ImageGeneration {
  const sessionId = getOrCreateDefaultSession()
  const id = uuid()

  // 解析 base64 + 写盘
  let ext = 'png'
  let rawBase64 = base64Data
  if (base64Data.startsWith('data:')) {
    const match = base64Data.match(/^data:image\/(\w+);base64,/)
    if (match) {
      ext = match[1] === 'jpeg' ? 'jpg' : match[1]
      rawBase64 = base64Data.slice(match[0].length)
    }
  }
  const dir = getImageDir(sessionId)
  const filename = `${id}.${ext}`
  const filePath = join(dir, filename)
  writeFileSync(filePath, Buffer.from(rawBase64, 'base64'))
  const relPath = toRelativePath(filePath)

  // 从源文件名提取标识，方便用户在「我的创作」识别来源
  const sourceName = sourcePath.split(/[\\/]/).pop() || ''
  const prompt = sourceName ? `本地编辑：${sourceName}` : '本地编辑'

  return insertGeneration({
    id,
    session_id: sessionId,
    prompt,
    revised_prompt: '',
    ref_images: [],
    model_provider_id: '',
    model_id: '',
    size: '1:1',
    quality: 'auto',
    result_path: relPath,
    result_url: '',
    status: 'done',
    error: ''
  })
  // 注意：不调 addToCreation！本地图库的图片已经在 gallery_items 表里，
  // 如果这里再加一次，"我的创作"分类会出现两张视觉上几乎相同的图。
}

export function saveEditedImage(id: string, base64Data: string): ImageGeneration | null {
  const gen = getGeneration(id)
  if (!gen) throw new Error('Generation not found: ' + id)

  const dir = getImageDir(gen.session_id)
  let ext = 'png'
  let rawBase64 = base64Data
  if (base64Data.startsWith('data:')) {
    const match = base64Data.match(/^data:image\/(\w+);base64,/)
    if (match) {
      ext = match[1] === 'jpeg' ? 'jpg' : match[1]
      rawBase64 = base64Data.slice(match[0].length)
    }
  }
  const filename = `${id}_edited.${ext}`
  const filePath = join(dir, filename)
  writeFileSync(filePath, Buffer.from(rawBase64, 'base64'))

  const relPath = toRelativePath(filePath)

  // Bug #5: 如旧 result_path 是不同扩展名的 _edited 衍生品，删除孤儿文件。
  // 不删原始 ${id}.${ext}（保留作为重置基准）。
  const oldPath = gen.result_path
  if (oldPath && oldPath !== relPath && oldPath.includes('_edited.')) {
    deleteImageByRelPath(oldPath)
  }

  const db = getDatabase()
  db.prepare('UPDATE image_generations SET result_path = ? WHERE id = ?').run(relPath, id)

  return getGeneration(id)
}

