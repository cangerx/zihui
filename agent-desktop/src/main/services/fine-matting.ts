import { v4 as uuid } from 'uuid'
import { mkdirSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import { getDataDir } from './data-path'
import { addToFineMatting } from './gallery'
import { segmentLocalFileViaCloud, type FineMattingResult } from './cloud-fine-matting'

/**
 * 精细抠图统一入口（main 进程，仅云端中转模式）。
 *
 * 与「快速抠图」(matting.ts) 的差异：
 *   - 上游是抠抠图 koukoutu（云控端 /gateway/fine-matting/* 中转），不走阿里、无 custom 直连模式
 *   - 按上传图长边尺寸三档计费（计费在云控端完成，结果带回 tier / cost）
 *
 * 任务流程：
 *   1. 入库 fine_matting_tasks（status=processing）
 *   2. 走云控端 multipart 中转（create→poll）
 *   3. 结果 PNG 下载到本地 dataDir/fine-matting/{taskId}.png
 *   4. 自动归档到 gallery「我的精细抠图」分类
 *   5. 更新 fine_matting_tasks.status=completed / failed
 *
 * 进度上报：发送 'fineMatting:progress' IPC 事件，data = { taskId, phase, message? }
 */

export interface FineMattingTask {
  id: string
  source_image_path: string
  result_path: string
  result_url: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  error: string
  request_id: string
  provider_task_id: string
  elapsed_ms: number
  tier: number
  cost: number
  created_at: string
}

export interface SegmentInput {
  /** 本地图片绝对路径（必须先落盘） */
  localPath: string
  /** 是否自动归档到「我的精细抠图」分类，默认 true */
  addToGallery?: boolean
}

export interface SegmentOutput {
  taskId: string
  status: 'completed' | 'failed'
  resultPath?: string
  resultUrl?: string
  requestId?: string
  elapsedMs?: number
  tier?: number
  cost?: number
  error?: string
}

// ===== Task CRUD =====

export function listTasks(limit = 50, offset = 0): FineMattingTask[] {
  const db = getDatabase()
  return db
    .prepare('SELECT * FROM fine_matting_tasks ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as FineMattingTask[]
}

export function getTask(id: string): FineMattingTask | null {
  const db = getDatabase()
  return (db.prepare('SELECT * FROM fine_matting_tasks WHERE id = ?').get(id) as FineMattingTask) || null
}

export function deleteTask(id: string): boolean {
  const db = getDatabase()
  const res = db.prepare('DELETE FROM fine_matting_tasks WHERE id = ?').run(id)
  return res.changes > 0
}

// ===== Storage =====

function resolveResultPath(taskId: string): string {
  const dir = join(getDataDir(), 'fine-matting')
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
      win.webContents.send('fineMatting:progress', { taskId, phase, message })
    } catch { /* ignore */ }
  }
}

export async function segment(input: SegmentInput): Promise<SegmentOutput> {
  if (!input.localPath || !existsSync(input.localPath)) {
    throw new Error('localPath 不存在')
  }

  const db = getDatabase()
  const taskId = uuid()
  const now = new Date().toISOString()

  db.prepare(`INSERT INTO fine_matting_tasks
    (id, source_image_path, result_path, result_url, status, error, request_id, provider_task_id, elapsed_ms, tier, cost, created_at)
    VALUES (?, ?, '', '', 'processing', '', '', '', 0, 0, 0, ?)`)
    .run(taskId, input.localPath, now)

  broadcastProgress(taskId, 'uploading')

  let result: FineMattingResult
  try {
    result = await segmentLocalFileViaCloud(input.localPath, {
      onProcessing: () => broadcastProgress(taskId, 'processing'),
    })
  } catch (e: any) {
    const msg = e?.message || String(e)
    db.prepare('UPDATE fine_matting_tasks SET status = ?, error = ? WHERE id = ?')
      .run('failed', msg.slice(0, 1000), taskId)
    broadcastProgress(taskId, 'done', msg)
    return { taskId, status: 'failed', error: msg }
  }

  broadcastProgress(taskId, 'downloading')

  const resultPath = resolveResultPath(taskId)
  try {
    await downloadToFile(result.image_url, resultPath)
  } catch (e: any) {
    const msg = `下载结果图失败：${e?.message || e}`
    db.prepare('UPDATE fine_matting_tasks SET status = ?, error = ?, result_url = ?, request_id = ?, provider_task_id = ?, elapsed_ms = ?, tier = ?, cost = ? WHERE id = ?')
      .run('failed', msg, result.image_url, result.request_id, result.provider_task_id, result.elapsed_ms, result.tier, result.cost, taskId)
    broadcastProgress(taskId, 'done', msg)
    return {
      taskId,
      status:    'failed',
      error:     msg,
      resultUrl: result.image_url,
      requestId: result.request_id,
      elapsedMs: result.elapsed_ms,
      tier:      result.tier,
      cost:      result.cost,
    }
  }

  db.prepare(`UPDATE fine_matting_tasks
    SET status = ?, result_path = ?, result_url = ?, request_id = ?, provider_task_id = ?, elapsed_ms = ?, tier = ?, cost = ?
    WHERE id = ?`)
    .run('completed', resultPath, result.image_url, result.request_id, result.provider_task_id, result.elapsed_ms, result.tier, result.cost, taskId)

  if (input.addToGallery !== false) {
    try { addToFineMatting(resultPath) } catch { /* best effort */ }
  }

  broadcastProgress(taskId, 'done')

  return {
    taskId,
    status:    'completed',
    resultPath,
    resultUrl: result.image_url,
    requestId: result.request_id,
    elapsedMs: result.elapsed_ms,
    tier:      result.tier,
    cost:      result.cost,
  }
}
