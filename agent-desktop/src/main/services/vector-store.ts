import { getDatabase, isSqliteVecAvailable } from '../database'
import { v4 as uuid } from 'uuid'
import { reciprocalRankFusion } from './kb-ranking'

export interface VectorChunk {
  id: string
  knowledge_base_id: string
  chunk_index: number
  content: string
  embedding: number[] | null
  token_count: number
  embedding_model: string
  embedding_dim: number
  embedding_source: string
  created_at: string
}

export interface ChunkEmbeddingMeta {
  knowledge_base_id: string
  embedding_model: string
  embedding_dim: number
  embedding_source: string
  chunk_count: number
}

export interface SearchResult {
  chunk: VectorChunk
  score: number
  channels?: Array<'vector' | 'keyword'>
}

function embeddingToBuffer(embedding: number[]): Buffer {
  const float32 = new Float32Array(embedding)
  return Buffer.from(float32.buffer)
}

function bufferToEmbedding(buf: Buffer): number[] {
  const float32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return Array.from(float32)
}

// 直接在 Float32 BLOB 上计算余弦,避免 Array.from 转换开销(JS fallback 提速)。
function cosineSimilarityF32(query: Float32Array, buf: Buffer): number {
  const v = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  if (v.length !== query.length) return 0
  let dot = 0
  let nq = 0
  let nv = 0
  for (let i = 0; i < query.length; i++) {
    dot += query[i] * v[i]
    nq += query[i] * query[i]
    nv += v[i] * v[i]
  }
  const denom = Math.sqrt(nq) * Math.sqrt(nv)
  return denom === 0 ? 0 : dot / denom
}

// ── sqlite-vec(vec0)KNN 加速;任何环节失败都回退 JS cosine(零降级)──
const _vecReadyDims = new Set<number>()
const _vecBrokenDims = new Set<number>()

function vecTableName(dim: number): string {
  return `vec_chunks_${dim}`
}

// 确保某维度 vec0 表存在;首次建表时懒灌入 vector_chunks 中该维度的全部向量。
// 返回 true 表示该维度 KNN 可用。任何失败标记 broken 并返回 false(回退 JS)。
function ensureVecTable(dim: number): boolean {
  if (!isSqliteVecAvailable() || !dim || dim <= 0) return false
  if (_vecBrokenDims.has(dim)) return false
  if (_vecReadyDims.has(dim)) return true
  const db = getDatabase()
  try {
    const name = vecTableName(dim)
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${name} USING vec0(chunk_id TEXT PRIMARY KEY, kb_id TEXT, embedding float[${dim}] distance_metric=cosine)`
    )
    const cnt = (db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get() as any).c
    if (cnt === 0) {
      const rows = db
        .prepare('SELECT id, knowledge_base_id, embedding FROM vector_chunks WHERE embedding IS NOT NULL AND embedding_dim = ?')
        .all(dim) as any[]
      if (rows.length > 0) {
        const ins = db.prepare(`INSERT OR REPLACE INTO ${name}(chunk_id, kb_id, embedding) VALUES (?, ?, ?)`)
        const tx = db.transaction(() => {
          for (const r of rows) ins.run(r.id, r.knowledge_base_id, r.embedding)
        })
        tx()
        console.log(`[vec] synced ${rows.length} chunks into ${name}`)
      }
    }
    _vecReadyDims.add(dim)
    return true
  } catch (e: any) {
    console.warn(`[vec] ensureVecTable(${dim}) failed, fallback JS cosine:`, e?.message || e)
    _vecBrokenDims.add(dim)
    return false
  }
}

// 用 sqlite-vec KNN 检索;返回 null 表示不可用(交由 JS fallback)。
function searchVec(
  queryEmbedding: number[],
  knowledgeBaseIds: string[],
  topK: number,
  threshold: number
): SearchResult[] | null {
  const dim = queryEmbedding.length
  if (!ensureVecTable(dim)) return null
  const db = getDatabase()
  const name = vecTableName(dim)
  const placeholders = knowledgeBaseIds.map(() => '?').join(',')
  try {
    const queryBuf = embeddingToBuffer(queryEmbedding)
    const rows = db
      .prepare(
        `SELECT chunk_id, kb_id, distance FROM ${name}
         WHERE embedding MATCH ? AND k = ? AND kb_id IN (${placeholders})
         ORDER BY distance`
      )
      .all(queryBuf, topK, ...knowledgeBaseIds) as any[]
    const results: SearchResult[] = []
    for (const r of rows) {
      const score = 1 - r.distance // cosine distance → similarity
      if (score < threshold) continue
      const chunkRow = db.prepare('SELECT * FROM vector_chunks WHERE id = ?').get(r.chunk_id) as any
      if (!chunkRow) continue
      results.push({ chunk: { ...chunkRow, embedding: null }, score })
    }
    return results
  } catch (e: any) {
    console.warn(`[vec] KNN query failed on ${name}, fallback JS cosine:`, e?.message || e)
    _vecBrokenDims.add(dim)
    return null
  }
}

function writeChunks(
  knowledgeBaseId: string,
  chunks: Array<{
    content: string
    embedding: number[] | null
    tokenCount: number
    index: number
    embeddingModel?: string
    embeddingDim?: number
    embeddingSource?: string
  }>,
  replaceExisting: boolean
): string[] {
  const db = getDatabase()
  const stmt = db.prepare(
    'INSERT INTO vector_chunks (id, knowledge_base_id, chunk_index, content, embedding, token_count, embedding_model, embedding_dim, embedding_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )

  const ftsStmt = db.prepare(
    'INSERT INTO vector_chunks_fts (chunk_id, knowledge_base_id, content) VALUES (?, ?, ?)'
  )

  const ids: string[] = []
  const insertMany = db.transaction(() => {
    if (replaceExisting) {
      db.prepare('DELETE FROM vector_chunks_fts WHERE knowledge_base_id = ?').run(knowledgeBaseId)
      db.prepare('DELETE FROM vector_chunks WHERE knowledge_base_id = ?').run(knowledgeBaseId)
    }
    for (const chunk of chunks) {
      const id = uuid()
      const embBuf = chunk.embedding ? embeddingToBuffer(chunk.embedding) : null
      // 仅当成功向量化时才记录模型元数据（embedding === null 视为分块仅入库未向量化）
      const model = chunk.embedding ? chunk.embeddingModel || '' : ''
      const dim = chunk.embedding ? chunk.embeddingDim || chunk.embedding.length : 0
      const source = chunk.embedding ? chunk.embeddingSource || '' : ''
      stmt.run(id, knowledgeBaseId, chunk.index, chunk.content, embBuf, chunk.tokenCount, model, dim, source)
      ftsStmt.run(id, knowledgeBaseId, chunk.content)
      ids.push(id)
    }
  })
  insertMany()
  // 双写 sqlite-vec(best-effort):失败不影响主流程,searchSimilar 会回退 JS
  try {
    const db2 = getDatabase()
    if (replaceExisting) {
      for (const dim of _vecReadyDims) {
        try {
          db2.prepare(`DELETE FROM ${vecTableName(dim)} WHERE kb_id = ?`).run(knowledgeBaseId)
        } catch {
          // 表可能在其它维度初始化流程中被重建，主表仍是事实来源。
        }
      }
    }
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]
      if (!c.embedding) continue
      const dim = c.embeddingDim || c.embedding.length
      if (!ensureVecTable(dim)) continue
      db2
        .prepare(`INSERT OR REPLACE INTO ${vecTableName(dim)}(chunk_id, kb_id, embedding) VALUES (?, ?, ?)`)
        .run(ids[i], knowledgeBaseId, embeddingToBuffer(c.embedding))
    }
  } catch (e: any) {
    console.warn('[vec] dual-write skipped:', e?.message || e)
  }
  return ids
}

export function insertChunks(
  knowledgeBaseId: string,
  chunks: Parameters<typeof writeChunks>[1]
): string[] {
  return writeChunks(knowledgeBaseId, chunks, false)
}

/**
 * 在单个 SQLite 事务中替换主 chunk 与 FTS 数据。
 * 新内容应在调用前完成解析与 embedding；这样远端或解析失败时旧索引仍可使用。
 */
export function replaceChunks(
  knowledgeBaseId: string,
  chunks: Parameters<typeof writeChunks>[1]
): string[] {
  return writeChunks(knowledgeBaseId, chunks, true)
}

/**
 * 列出所有 chunks 用过的 (model, dim, source) 组合及对应数量。
 * 用于检测模型变更后的兼容性：当前生效模型 ≠ 库内任何记录则需重向量化。
 */
export function getChunkEmbeddingMeta(): ChunkEmbeddingMeta[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT 
        knowledge_base_id,
        embedding_model,
        embedding_dim,
        embedding_source,
        COUNT(*) as chunk_count
      FROM vector_chunks
      WHERE embedding IS NOT NULL
      GROUP BY knowledge_base_id, embedding_model, embedding_dim, embedding_source`
    )
    .all() as ChunkEmbeddingMeta[]
}

/**
 * 全局向量元数据汇总：返回库内所有不同的 (model, dim, source) 组合及总分块数。
 * 当返回多条或与当前生效模型不一致时，UI 应提示重向量化。
 */
export function getGlobalEmbeddingMeta(): Array<{
  embedding_model: string
  embedding_dim: number
  embedding_source: string
  chunk_count: number
}> {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT 
        embedding_model,
        embedding_dim,
        embedding_source,
        COUNT(*) as chunk_count
      FROM vector_chunks
      WHERE embedding IS NOT NULL
      GROUP BY embedding_model, embedding_dim, embedding_source
      ORDER BY chunk_count DESC`
    )
    .all() as any[]
}

export function deleteChunksByKnowledgeBaseId(knowledgeBaseId: string): number {
  const db = getDatabase()
  db.prepare('DELETE FROM vector_chunks_fts WHERE knowledge_base_id = ?').run(knowledgeBaseId)
  const result = db
    .prepare('DELETE FROM vector_chunks WHERE knowledge_base_id = ?')
    .run(knowledgeBaseId)
  // 同步从已建的 vec0 表删除(best-effort)
  for (const dim of _vecReadyDims) {
    try {
      db.prepare(`DELETE FROM ${vecTableName(dim)} WHERE kb_id = ?`).run(knowledgeBaseId)
    } catch {
      /* ignore: 下次 ensureVecTable 懒同步会重建一致性 */
    }
  }
  return result.changes
}

export function getChunksByKnowledgeBaseId(knowledgeBaseId: string): VectorChunk[] {
  const db = getDatabase()
  const rows = db
    .prepare('SELECT * FROM vector_chunks WHERE knowledge_base_id = ? ORDER BY chunk_index')
    .all(knowledgeBaseId) as any[]

  return rows.map((row) => ({
    ...row,
    embedding: row.embedding ? bufferToEmbedding(row.embedding) : null,
    embedding_model: row.embedding_model || '',
    embedding_dim: row.embedding_dim || 0,
    embedding_source: row.embedding_source || '',
  }))
}

export function getChunkCountByKnowledgeBaseId(knowledgeBaseId: string): {
  total: number
  embedded: number
} {
  const db = getDatabase()
  const total = (
    db
      .prepare('SELECT COUNT(*) as cnt FROM vector_chunks WHERE knowledge_base_id = ?')
      .get(knowledgeBaseId) as any
  ).cnt
  const embedded = (
    db
      .prepare(
        'SELECT COUNT(*) as cnt FROM vector_chunks WHERE knowledge_base_id = ? AND embedding IS NOT NULL'
      )
      .get(knowledgeBaseId) as any
  ).cnt
  return { total, embedded }
}

export function getVectorStats(): Array<{
  knowledge_base_id: string
  total_chunks: number
  embedded_chunks: number
  total_tokens: number
}> {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT 
        knowledge_base_id,
        COUNT(*) as total_chunks,
        SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) as embedded_chunks,
        SUM(token_count) as total_tokens
      FROM vector_chunks
      GROUP BY knowledge_base_id`
    )
    .all() as any[]
}

export function searchKeyword(
  query: string,
  knowledgeBaseIds: string[],
  topK: number = 5
): SearchResult[] {
  const db = getDatabase()
  if (knowledgeBaseIds.length === 0 || !query.trim()) return []

  const placeholders = knowledgeBaseIds.map(() => '?').join(',')
  const ftsQuery = query.trim().split(/\s+/).map((w) => `"${w}"`).join(' OR ')

  try {
    const rows = db
      .prepare(
        `SELECT f.chunk_id, f.content, f.knowledge_base_id, rank
         FROM vector_chunks_fts f
         WHERE f.knowledge_base_id IN (${placeholders})
           AND vector_chunks_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(...knowledgeBaseIds, ftsQuery, topK) as any[]

    return rows.map((row) => ({
      chunk: {
        id: row.chunk_id,
        knowledge_base_id: row.knowledge_base_id,
        chunk_index: 0,
        content: row.content,
        embedding: null,
        token_count: 0,
        embedding_model: '',
        embedding_dim: 0,
        embedding_source: '',
        created_at: ''
      },
      score: -row.rank
    }))
  } catch {
    return []
  }
}

export function searchHybrid(
  queryEmbedding: number[],
  queryText: string,
  knowledgeBaseIds: string[],
  topK: number = 5,
  threshold: number = 0.3
): SearchResult[] {
  const candidateK = Math.max(topK * 4, 20)
  const vectorResults = searchSimilar(queryEmbedding, knowledgeBaseIds, candidateK, threshold)
  const keywordResults = searchKeyword(queryText, knowledgeBaseIds, candidateK)
  return reciprocalRankFusion(
    [
      { name: 'vector', candidates: vectorResults.map((row) => ({ id: row.chunk.id, value: row })) },
      { name: 'keyword', candidates: keywordResults.map((row) => ({ id: row.chunk.id, value: row })) }
    ],
    topK
  ).map((row) => ({
    chunk: row.value.chunk,
    score: row.score,
    channels: row.channels as Array<'vector' | 'keyword'>
  }))
}

export function searchSimilar(
  queryEmbedding: number[],
  knowledgeBaseIds: string[],
  topK: number = 5,
  threshold: number = 0.3,
  options?: { embeddingDim?: number }
): SearchResult[] {
  const db = getDatabase()

  if (knowledgeBaseIds.length === 0) return []

  // 优先 sqlite-vec KNN(可用时);返回 null 表示不可用，回退 JS cosine。
  const vecResults = searchVec(queryEmbedding, knowledgeBaseIds, topK, threshold)
  if (vecResults !== null) return vecResults

  const placeholders = knowledgeBaseIds.map(() => '?').join(',')
  // 维度过滤：仅与 query 相同维度的 chunks 参与相似度计算，避免跨模型脏召回
  const dim = options?.embeddingDim || queryEmbedding.length
  const rows = db
    .prepare(
      `SELECT * FROM vector_chunks WHERE knowledge_base_id IN (${placeholders}) AND embedding IS NOT NULL AND (embedding_dim = ? OR embedding_dim = 0)`
    )
    .all(...knowledgeBaseIds, dim) as any[]

  const queryF32 = new Float32Array(queryEmbedding)
  const results: SearchResult[] = []
  for (const row of rows) {
    // 直接在 Float32 BLOB 上算余弦,跨维(长度不符)返回 0 被 threshold 过滤
    const score = cosineSimilarityF32(queryF32, row.embedding)
    if (score >= threshold) {
      results.push({
        chunk: { ...row, embedding: bufferToEmbedding(row.embedding) },
        score
      })
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, topK)
}
