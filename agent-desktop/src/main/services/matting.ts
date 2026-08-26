import { v4 as uuid } from 'uuid'
import { mkdirSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import { getDataDir } from './data-path'
import { addToMatting } from './gallery'
import { segmentLocalFile, testCredentials, type MattingResult } from './aliyun-matting'
import { segmentLocalFileViaCloud } from './cloud-matting'
import { resolveCredentials, updateTestResult } from './matting-providers'

/**
 * AI 抠图统一入口（main 进程）。
 *
 * 两种模式：
 *   - source='cloud'  → 云控端 multipart 中转，凭证不下发桌面（默认）
 *   - source='custom' → 桌面端用本地保存的阿里 AK/SK 直连 viapi
 *
 * 任务流程：
 *   1. 入库 matting_tasks（status=pending）
 *   2. 派发实际调用（同步等待最长 90s）
 *   3. 结果 PNG 下载到本地 dataDir/matting/{taskId}.png（画布场景：dataDir/canvas/{projectId}/{nodeId}_{taskId}.png）
 *   4. 自动归档到 gallery 「我的抠图」分类
 *   5. 更新 matting_tasks.status=completed / failed
 *
 * 进度上报：发送 'matting:progress' IPC 事件到 renderer，data = { taskId, phase: 'uploading'|'processing'|'downloading'|'done', message? }
 */

export interface MattingTask {
  id: string
  source: 'cloud' | 'custom'
  provider_id: string
  source_image_path: string
  result_path: string
  result_url: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  error: string
  aliyun_request_id: string
  elapsed_ms: number
  canvas_project_id: string
  canvas_node_id: string
  created_at: string
}

export interface SegmentInput {
  /** 本地图片绝对路径（必须先落盘） */
  localPath: string
  /** 模式 */
  source: 'cloud' | 'custom'
  /** custom 模式必填，匹配 matting_providers.id */
  providerId?: string
  /** 画布场景：用于结果命名 + 文件夹分流 */
  canvasProjectId?: string
  canvasNodeId?: string
  /** 是否自动归档到「我的抠图」分类，默认 true。画布节点产图 default false（已经显示在节点上） */
  addToGallery?: boolean
}

export interface SegmentOutput {
  taskId: string
  status: 'completed' | 'failed'
  resultPath?: string   // 本地保存的 PNG 绝对路径
  resultUrl?: string    // 阿里临时 URL（trace 用）
  requestId?: string
  elapsedMs?: number
  error?: string
}

// ===== Task CRUD =====

export function listTasks(limit = 50, offset = 0): MattingTask[] {
  const db = getDatabase()
  return db
    .prepare('SELECT * FROM matting_tasks ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as MattingTask[]
}

export function getTask(id: string): MattingTask | null {
  const db = getDatabase()
  return (db.prepare('SELECT * FROM matting_tasks WHERE id = ?').get(id) as MattingTask) || null
}

export function deleteTask(id: string): boolean {
  const db = getDatabase()
  const res = db.prepare('DELETE FROM matting_tasks WHERE id = ?').run(id)
  return res.changes > 0
}

// ===== Storage =====

/**
 * 抠图结果目录：
 *   - 普通页面：dataDir/matting/
 *   - 画布场景：dataDir/canvas/{projectId}/（与画布生图同目录，删节点时统一清理）
 */
function resolveResultPath(taskId: string, canvasProjectId?: string, canvasNodeId?: string): string {
  if (canvasProjectId && canvasNodeId) {
    const dir = join(getDataDir(), 'canvas', canvasProjectId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return join(dir, `${canvasNodeId}_${taskId}.png`)
  }
  const dir = join(getDataDir(), 'matting')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, `${taskId}.png`)
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`下载结果图失败 HTTP ${resp.status}`)
  const buf = Buffer.from(await resp.arrayBuffer())
  if (buf.length === 0) throw new Error('下载结果图为空')
  writeFileSync(dest, buf)
}

// ===== Main entry =====

function broadcastProgress(taskId: string, phase: string, message?: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('matting:progress', { taskId, phase, message })
    } catch { /* ignore */ }
  }
}

export async function segment(input: SegmentInput): Promise<SegmentOutput> {
  if (!input.localPath || !existsSync(input.localPath)) {
    throw new Error('localPath 不存在')
  }
  if (input.source === 'custom' && !input.providerId) {
    throw new Error('custom 模式必须传 providerId')
  }

  const db = getDatabase()
  const taskId = uuid()
  const now = new Date().toISOString()

  db.prepare(`INSERT INTO matting_tasks
    (id, source, provider_id, source_image_path, result_path, result_url, status, error,
     aliyun_request_id, elapsed_ms, canvas_project_id, canvas_node_id, created_at)
    VALUES (?, ?, ?, ?, '', '', 'processing', '', '', 0, ?, ?, ?)`)
    .run(
      taskId,
      input.source,
      input.providerId || '',
      input.localPath,
      input.canvasProjectId || '',
      input.canvasNodeId || '',
      now,
    )

  broadcastProgress(taskId, 'uploading')

  let result: MattingResult
  try {
    if (input.source === 'cloud') {
      result = await segmentLocalFileViaCloud(input.localPath, {
        onProcessing: () => broadcastProgress(taskId, 'processing'),
      })
    } else {
      const creds = resolveCredentials(input.providerId!)
      if (!creds) throw new Error(`Provider 不存在：${input.providerId}`)
      result = await segmentLocalFile(input.localPath, creds)
    }
  } catch (e: any) {
    const msg = e?.message || String(e)
    db.prepare('UPDATE matting_tasks SET status = ?, error = ? WHERE id = ?')
      .run('failed', msg.slice(0, 1000), taskId)
    broadcastProgress(taskId, 'done', msg)
    return { taskId, status: 'failed', error: msg }
  }

  broadcastProgress(taskId, 'downloading')

  const resultPath = resolveResultPath(taskId, input.canvasProjectId, input.canvasNodeId)
  try {
    await downloadToFile(result.image_url, resultPath)
  } catch (e: any) {
    const msg = `下载结果图失败：${e?.message || e}`
    db.prepare('UPDATE matting_tasks SET status = ?, error = ?, result_url = ?, aliyun_request_id = ?, elapsed_ms = ? WHERE id = ?')
      .run('failed', msg, result.image_url, result.request_id, result.elapsed_ms, taskId)
    broadcastProgress(taskId, 'done', msg)
    return {
      taskId,
      status:    'failed',
      error:     msg,
      resultUrl: result.image_url,
      requestId: result.request_id,
      elapsedMs: result.elapsed_ms,
    }
  }

  db.prepare(`UPDATE matting_tasks
    SET status = ?, result_path = ?, result_url = ?, aliyun_request_id = ?, elapsed_ms = ?
    WHERE id = ?`)
    .run('completed', resultPath, result.image_url, result.request_id, result.elapsed_ms, taskId)

  // 默认自动归档到「我的抠图」分类（画布节点产图除外）
  const shouldArchive = input.addToGallery !== false && !input.canvasNodeId
  if (shouldArchive) {
    try { addToMatting(resultPath) } catch { /* best effort */ }
  }

  broadcastProgress(taskId, 'done')

  return {
    taskId,
    status:    'completed',
    resultPath,
    resultUrl: result.image_url,
    requestId: result.request_id,
    elapsedMs: result.elapsed_ms,
  }
}

// ===== Provider test =====

/**
 * 测试一条自定义 provider 是否可用：用「测试图」走端到端。
 * 测试图由 renderer 提供本地临时路径（用户在 UI 上选一张小图测）。
 *
 * 测试成功 / 失败都会更新 matting_providers.last_test_* 字段。
 */
export async function testProvider(
  providerId: string,
  localTestImagePath: string,
): Promise<{ ok: true; result: MattingResult } | { ok: false; error: string }> {
  try {
    const creds = resolveCredentials(providerId)
    if (!creds) throw new Error('Provider 不存在')
    const result = await testCredentials(localTestImagePath, creds)
    updateTestResult(providerId, 'success', `req=${result.request_id} 耗时 ${result.elapsed_ms}ms`)
    return { ok: true, result }
  } catch (e: any) {
    const msg = e?.message || String(e)
    updateTestResult(providerId, 'failed', msg)
    return { ok: false, error: msg }
  }
}
