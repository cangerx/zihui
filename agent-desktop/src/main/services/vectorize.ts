import { BrowserWindow } from 'electron'
import { chunkFile, DocumentParseError } from './chunker'
import { embedBatch, getEmbeddingConfig, EmbeddingUnavailableError } from './embedding'
import { replaceChunks, getVectorStats, getGlobalEmbeddingMeta } from './vector-store'
import { getDatabase } from '../database'
import { createHash } from 'crypto'
import { readFileSync, statSync } from 'fs'

export interface VectorizeProgress {
  knowledgeBaseId: string
  status: 'chunking' | 'embedding' | 'done' | 'error' | 'skipped'
  current: number
  total: number
  message: string
  /** 错误时附带的结构化代码，UI 据此引导用户 */
  errorCode?: 'NO_CLOUD_MODEL' | 'INSUFFICIENT_BALANCE' | 'NOT_CONFIGURED' | 'UNAUTHORIZED' | 'NO_EXTRACTABLE_TEXT' | 'GENERIC'
}

function sendProgress(win: BrowserWindow | null, progress: VectorizeProgress): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send('vectorize:progress', progress)
  }
}

export async function vectorizeDocument(
  knowledgeBaseId: string,
  win: BrowserWindow | null
): Promise<{ chunkCount: number; embeddedCount: number }> {
  const db = getDatabase()

  // Get the knowledge base record
  const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(knowledgeBaseId) as any
  if (!kb) throw new Error('知识文档不存在')
  if (!kb.file_path) throw new Error('文档文件路径为空')

  // 预检：解析当前生效的 embedding 配置（云端 / 本地），失败立即抛
  // EmbeddingUnavailableError，前端按 errorCode 路由到「购买套餐 / 去设置」
  let resolvedConfig
  try {
    resolvedConfig = await getEmbeddingConfig()
  } catch (err: any) {
    sendProgress(win, {
      knowledgeBaseId,
      status: 'error',
      current: 0,
      total: 0,
      message: err?.message || '向量服务不可用',
      errorCode: err instanceof EmbeddingUnavailableError ? err.code : 'GENERIC',
    })
    throw err
  }

  // Update status to processing
  db.prepare('UPDATE knowledge_bases SET status = ? WHERE id = ?').run('processing', knowledgeBaseId)

  try {
    // Step 1: Chunk the document
    sendProgress(win, {
      knowledgeBaseId,
      status: 'chunking',
      current: 0,
      total: 0,
      message: '正在分块文档...'
    })

    let chunks
    try {
      chunks = await chunkFile(kb.file_path, {
        chunkSize: 512,
        chunkOverlap: 100
      })
    } catch (err: any) {
      if (err instanceof DocumentParseError && err.code === 'NO_EXTRACTABLE_TEXT') {
        const fallbackStatus = Number(kb.chunk_count || 0) > 0 ? 'stale' : 'unvectorizable'
        db.prepare('UPDATE knowledge_bases SET status = ?, chunk_count = ? WHERE id = ?').run(
          fallbackStatus,
          Number(kb.chunk_count || 0),
          knowledgeBaseId
        )
        sendProgress(win, {
          knowledgeBaseId,
          status: 'skipped',
          current: 0,
          total: 0,
          message: `已跳过：${kb.name || '该文档'}未提取到可向量化文字，文档内图片内容当前不会被向量化`,
          errorCode: 'NO_EXTRACTABLE_TEXT',
        })
        return { chunkCount: 0, embeddedCount: 0 }
      }
      throw err
    }

    if (chunks.length === 0) {
      db.prepare('UPDATE knowledge_bases SET status = ?, chunk_count = ? WHERE id = ?').run(
        Number(kb.chunk_count || 0) > 0 ? 'stale' : 'unvectorizable',
        Number(kb.chunk_count || 0),
        knowledgeBaseId
      )
      return { chunkCount: 0, embeddedCount: 0 }
    }

    sendProgress(win, {
      knowledgeBaseId,
      status: 'embedding',
      current: 0,
      total: chunks.length,
      message: `正在向量化 0/${chunks.length} 个分块...`
    })

    // Step 2: Embed in batches
    const BATCH_SIZE = 20
    const allChunkData: Array<{
      content: string
      embedding: number[] | null
      tokenCount: number
      index: number
      embeddingModel?: string
      embeddingDim?: number
      embeddingSource?: string
    }> = []

    // 终止性错误：余额不足 / 未配置 / 未授权 → 立即停止后续批次（避免 N 次 402 噪声）
    let fatalError: EmbeddingUnavailableError | null = null
    // 非致命批次错误（云端 404 / 5xx / 网络抖动等）：记录最后一次，用于「全批失败」时上报原因
    let lastBatchError: any = null

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      if (fatalError) {
        // 后续 chunks 直接入库不向量化
        for (const chunk of chunks.slice(i)) {
          allChunkData.push({
            content: chunk.content,
            embedding: null,
            tokenCount: chunk.tokenCount,
            index: chunk.index,
          })
        }
        break
      }

      const batch = chunks.slice(i, i + BATCH_SIZE)
      const texts = batch.map((c) => c.content)

      try {
        const result = await embedBatch(texts, resolvedConfig)
        for (let j = 0; j < batch.length; j++) {
          allChunkData.push({
            content: batch[j].content,
            embedding: result.embeddings[j].embedding,
            tokenCount: result.embeddings[j].tokenCount || batch[j].tokenCount,
            index: batch[j].index,
            embeddingModel: result.meta.model,
            embeddingDim: result.meta.dim,
            embeddingSource: result.meta.source,
          })
        }
      } catch (err: any) {
        // EmbeddingUnavailableError 视为 fatal，普通 5xx/网络错误降级为单批失败
        const isFatal = err instanceof EmbeddingUnavailableError
        if (isFatal) fatalError = err
        else lastBatchError = err

        for (const chunk of batch) {
          allChunkData.push({
            content: chunk.content,
            embedding: null,
            tokenCount: chunk.tokenCount,
            index: chunk.index,
          })
        }
        sendProgress(win, {
          knowledgeBaseId,
          status: 'embedding',
          current: Math.min(i + BATCH_SIZE, chunks.length),
          total: chunks.length,
          message: `向量化批次失败: ${(err.message || '').slice(0, 120)}`,
          errorCode: isFatal ? err.code : 'GENERIC',
        })
      }

      // 致命错误时跳过常规进度更新，避免覆盖刚发出的错误消息
      if (!fatalError) {
        const done = Math.min(i + BATCH_SIZE, chunks.length)
        sendProgress(win, {
          knowledgeBaseId,
          status: 'embedding',
          current: done,
          total: chunks.length,
          message: `正在向量化 ${done}/${chunks.length} 个分块...`
        })
      }
    }

    const embeddedCount = allChunkData.filter((c) => c.embedding !== null).length

    // 致命错误情况下：保留已分块文本，但状态置 error 让用户重新触发
    if (fatalError) {
      db.prepare('UPDATE knowledge_bases SET status = ?, chunk_count = ? WHERE id = ?').run(
        Number(kb.chunk_count || 0) > 0 ? 'stale' : 'error',
        Number(kb.chunk_count || 0),
        knowledgeBaseId,
      )
      sendProgress(win, {
        knowledgeBaseId,
        status: 'error',
        current: embeddedCount,
        total: chunks.length,
        message: fatalError.message,
        errorCode: fatalError.code,
      })
      throw fatalError
    }

    // 全批失败（如云端向量端点 404 / 网络全程失败）：绝不能伪装成「就绪」，
    // 否则知识库看似可用、实则零有效向量，直到对话检索时才暴露。置 error 让用户即时感知并重试。
    if (embeddedCount === 0) {
      db.prepare('UPDATE knowledge_bases SET status = ?, chunk_count = ? WHERE id = ?').run(
        Number(kb.chunk_count || 0) > 0 ? 'stale' : 'error',
        Number(kb.chunk_count || 0),
        knowledgeBaseId,
      )
      const detail = lastBatchError?.message ? `（${String(lastBatchError.message).slice(0, 160)}）` : ''
      throw new Error(`所有分块均未成功向量化，请检查向量服务是否可用${detail}`)
    }

    // 所有解析与 embedding 完成后再原子替换主 chunk + FTS；此前失败时保留旧索引。
    replaceChunks(knowledgeBaseId, allChunkData)
    const sourceStat = statSync(kb.file_path)
    const sourceHash = createHash('sha256').update(readFileSync(kb.file_path)).digest('hex')

    // Update knowledge base status
    db.prepare(`UPDATE knowledge_bases
      SET status = ?, chunk_count = ?, source_mtime = ?, source_size = ?, source_hash = ?,
          last_indexed_at = ?, error_code = '', error_message = ''
      WHERE id = ?`).run(
      'ready',
      allChunkData.length,
      Math.floor(sourceStat.mtimeMs),
      sourceStat.size,
      sourceHash,
      new Date().toISOString(),
      knowledgeBaseId
    )

    sendProgress(win, {
      knowledgeBaseId,
      status: 'done',
      current: chunks.length,
      total: chunks.length,
      message: `完成：${allChunkData.length} 个分块，${embeddedCount} 个已向量化`
    })

    return { chunkCount: allChunkData.length, embeddedCount }
  } catch (err: any) {
    db.prepare('UPDATE knowledge_bases SET status = ? WHERE id = ?').run(
      Number(kb.chunk_count || 0) > 0 ? 'stale' : 'error',
      knowledgeBaseId
    )
    // EmbeddingUnavailableError 已经在上面 sendProgress 过；其它通用错误兜底一次
    if (!(err instanceof EmbeddingUnavailableError)) {
      sendProgress(win, {
        knowledgeBaseId,
        status: 'error',
        current: 0,
        total: 0,
        message: `向量化失败: ${err.message}`,
        errorCode: 'GENERIC',
      })
    }
    throw err
  }
}

export async function vectorizeCategory(
  categoryId: string,
  win: BrowserWindow | null
): Promise<{ processed: number; failed: number }> {
  const db = getDatabase()

  // Get all pending/error knowledge bases in the category
  const kbs = db
    .prepare(
      "SELECT * FROM knowledge_bases WHERE category_id = ? AND status IN ('pending', 'stale', 'error')"
    )
    .all(categoryId) as any[]

  let processed = 0
  let failed = 0

  for (const kb of kbs) {
    try {
      await vectorizeDocument(kb.id, win)
      processed++
    } catch {
      failed++
    }
  }

  return { processed, failed }
}

export async function vectorizeAll(
  win: BrowserWindow | null
): Promise<{ processed: number; failed: number }> {
  const db = getDatabase()

  const kbs = db
    .prepare("SELECT * FROM knowledge_bases WHERE status IN ('pending', 'stale', 'error')")
    .all() as any[]

  let processed = 0
  let failed = 0

  for (const kb of kbs) {
    try {
      await vectorizeDocument(kb.id, win)
      processed++
    } catch {
      failed++
    }
  }

  return { processed, failed }
}

export async function resetAndVectorizeCategory(
  categoryId: string,
  win: BrowserWindow | null
): Promise<{ processed: number; failed: number }> {
  const db = getDatabase()

  // 标记为待刷新，但保留上一版 chunks；每个文档成功后由 replaceChunks 原子替换。
  const kbs = db
    .prepare('SELECT id FROM knowledge_bases WHERE category_id = ?')
    .all(categoryId) as any[]

  for (const kb of kbs) {
    db.prepare("UPDATE knowledge_bases SET status = CASE WHEN chunk_count > 0 THEN 'stale' ELSE 'pending' END WHERE id = ?").run(kb.id)
  }

  // Re-vectorize all
  let processed = 0
  let failed = 0
  for (const kb of kbs) {
    try {
      await vectorizeDocument(kb.id, win)
      processed++
    } catch {
      failed++
    }
  }

  return { processed, failed }
}

/**
 * 检测当前生效 embedding 模型与库中已向量化数据是否一致。
 * 用于 SettingsView 切换源 / 启动时弹出「需重向量化」提示。
 *
 * 返回 mismatch=true 的判定标准（任一满足）：
 *   - 库中存在多种 (model, dim, source) 组合
 *   - 库中唯一组合的 (model, source) 与当前生效配置不一致
 *   - 库中维度与当前生效维度不一致
 *
 * 当库为空时 mismatch=false（无需提示）。
 * 当无法解析当前生效配置（如未登录 + 未配置）时 mismatch=false（前置错误由调用方处理）。
 */
export async function checkEmbeddingModelMismatch(): Promise<{
  mismatch: boolean
  reason: 'empty' | 'multiple_models' | 'model_changed' | 'config_error' | 'consistent'
  current?: { model: string; source: 'cloud' | 'local' }
  legacy?: Array<{ model: string; dim: number; source: string; chunk_count: number }>
  totalChunks: number
}> {
  const meta = getGlobalEmbeddingMeta()
  const totalChunks = meta.reduce((s, m) => s + m.chunk_count, 0)

  if (meta.length === 0) {
    return { mismatch: false, reason: 'empty', totalChunks: 0 }
  }

  let current: { model: string; source: 'cloud' | 'local' } | undefined
  try {
    const cfg = await getEmbeddingConfig()
    current = { model: cfg.model, source: cfg.source }
  } catch {
    // 当前生效配置不可用：不触发 mismatch（用户可能正在切换中）
    return {
      mismatch: false,
      reason: 'config_error',
      legacy: meta.map((m) => ({
        model: m.embedding_model,
        dim: m.embedding_dim,
        source: m.embedding_source,
        chunk_count: m.chunk_count,
      })),
      totalChunks,
    }
  }

  // 多种模型并存（旧数据 + 部分新数据混合）→ 必须重向量化
  if (meta.length > 1) {
    return {
      mismatch: true,
      reason: 'multiple_models',
      current,
      legacy: meta.map((m) => ({
        model: m.embedding_model,
        dim: m.embedding_dim,
        source: m.embedding_source,
        chunk_count: m.chunk_count,
      })),
      totalChunks,
    }
  }

  // 单一组合：与当前生效模型对比
  const only = meta[0]
  // 老数据 model/source 为空时一律视为变更（用户从未带 meta 的版本升级而来）
  const legacyEmpty = !only.embedding_model
  const modelChanged = !legacyEmpty && only.embedding_model !== current.model
  const sourceChanged = !legacyEmpty && only.embedding_source !== current.source

  if (legacyEmpty || modelChanged || sourceChanged) {
    return {
      mismatch: true,
      reason: 'model_changed',
      current,
      legacy: [
        {
          model: only.embedding_model,
          dim: only.embedding_dim,
          source: only.embedding_source,
          chunk_count: only.chunk_count,
        },
      ],
      totalChunks,
    }
  }

  return { mismatch: false, reason: 'consistent', current, totalChunks }
}

/**
 * 全量重向量化：保留旧 chunks，逐文档成功后原子替换。
 * 用于模型变更后的恢复入口。
 */
export async function reembedAll(
  win: BrowserWindow | null,
): Promise<{ processed: number; failed: number }> {
  const db = getDatabase()

  // 1. 标记需要刷新。失败时旧索引仍可用于关键词召回或旧模型查询。
  const allKbs = db.prepare('SELECT id FROM knowledge_bases').all() as Array<{ id: string }>
  for (const kb of allKbs) {
    db.prepare("UPDATE knowledge_bases SET status = CASE WHEN chunk_count > 0 THEN 'stale' ELSE 'pending' END WHERE id = ?").run(kb.id)
  }

  // 2. 顺序重新向量化
  let processed = 0
  let failed = 0
  for (const kb of allKbs) {
    try {
      await vectorizeDocument(kb.id, win)
      processed++
    } catch (err) {
      failed++
      // 致命错误（余额不足等）→ 立即终止全量任务，避免无效重试
      if (err instanceof EmbeddingUnavailableError) {
        break
      }
    }
  }
  return { processed, failed }
}

export function getVectorStatsForUI(): Array<{
  category_id: string
  category_name: string
  total_docs: number
  pending_docs: number
  ready_docs: number
  unvectorizable_docs: number
  error_docs: number
  total_chunks: number
  embedded_chunks: number
  total_tokens: number
}> {
  const db = getDatabase()

  const stats = db
    .prepare(
      `SELECT 
        c.id as category_id,
        c.name as category_name,
        COUNT(kb.id) as total_docs,
        SUM(CASE WHEN kb.status = 'pending' THEN 1 ELSE 0 END) as pending_docs,
        SUM(CASE WHEN kb.status = 'ready' THEN 1 ELSE 0 END) as ready_docs,
        SUM(CASE WHEN kb.status = 'unvectorizable' THEN 1 ELSE 0 END) as unvectorizable_docs,
        SUM(CASE WHEN kb.status = 'error' THEN 1 ELSE 0 END) as error_docs,
        COALESCE(SUM(kb.chunk_count), 0) as total_chunks
      FROM kb_categories c
      LEFT JOIN knowledge_bases kb ON kb.category_id = c.id
      GROUP BY c.id, c.name
      ORDER BY c.created_at DESC`
    )
    .all() as any[]

  // Get vector chunk stats per knowledge base
  const vectorStats = getVectorStats()
  const vectorMap = new Map<string, { embedded: number; tokens: number }>()
  for (const vs of vectorStats) {
    vectorMap.set(vs.knowledge_base_id, {
      embedded: vs.embedded_chunks,
      tokens: vs.total_tokens
    })
  }

  // Get knowledge bases grouped by category to aggregate vector stats
  const kbs = db.prepare('SELECT id, category_id FROM knowledge_bases').all() as any[]
  const catVectorStats = new Map<string, { embedded: number; tokens: number }>()
  for (const kb of kbs) {
    const vs = vectorMap.get(kb.id)
    if (vs) {
      const existing = catVectorStats.get(kb.category_id) || { embedded: 0, tokens: 0 }
      existing.embedded += vs.embedded
      existing.tokens += vs.tokens
      catVectorStats.set(kb.category_id, existing)
    }
  }

  return stats.map((s: any) => {
    const cvs = catVectorStats.get(s.category_id) || { embedded: 0, tokens: 0 }
    return {
      ...s,
      embedded_chunks: cvs.embedded,
      total_tokens: cvs.tokens
    }
  })
}
