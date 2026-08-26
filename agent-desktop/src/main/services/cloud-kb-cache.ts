import { createHash } from 'crypto'
import { v4 as uuid } from 'uuid'
import { getDatabase } from '../database'

/**
 * 云端知识库检索结果的本地离线缓存（hybrid 降级）。
 *
 * 云端可达时把命中片段写入 cloud_kb_cache；云端不可达/超时/401 时回退最近一次命中的片段，
 * 让对话仍能带上（可能非最新）的知识库上下文。仅缓存片段，不下载整库向量。
 */

export interface CloudKbHit {
  cloud_kb_id: number
  kb_name: string
  chunk_id: number
  document_id?: number
  source_doc: string
  content: string
  score: number
}

/** 缓存有效期：7 天（过期不返回，定期清理） */
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000

/** 归一化 query + 排序 kbIds + topK 生成缓存键 */
export function buildQueryHash(query: string, kbIds: number[], topK: number): string {
  const norm = query.trim().toLowerCase().replace(/\s+/g, ' ')
  const ids = [...kbIds].map(Number).filter((n) => n > 0).sort((a, b) => a - b).join(',')
  return createHash('sha256').update(`${norm}|${ids}|${topK}`).digest('hex')
}

export function getCloudKbCache(queryHash: string): CloudKbHit[] {
  try {
    const db = getDatabase()
    const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString()
    const rows = db
      .prepare('SELECT * FROM cloud_kb_cache WHERE query_hash = ? AND cached_at >= ? ORDER BY rank ASC')
      .all(queryHash, cutoff) as any[]
    return rows.map((r) => ({
      cloud_kb_id: Number(r.cloud_kb_id || 0),
      kb_name: String(r.kb_name || ''),
      chunk_id: Number(r.chunk_id || 0),
      source_doc: String(r.source_doc || ''),
      content: String(r.content || ''),
      score: Number(r.score || 0),
    }))
  } catch {
    return []
  }
}

export function upsertCloudKbCache(queryHash: string, hits: CloudKbHit[]): void {
  try {
    const db = getDatabase()
    const now = new Date().toISOString()
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM cloud_kb_cache WHERE query_hash = ?').run(queryHash)
      const stmt = db.prepare(
        'INSERT INTO cloud_kb_cache (id, query_hash, cloud_kb_id, chunk_id, source_doc, kb_name, content, score, rank, cached_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      hits.forEach((h, i) => {
        stmt.run(
          uuid(),
          queryHash,
          h.cloud_kb_id || 0,
          h.chunk_id || 0,
          h.source_doc || '',
          h.kb_name || '',
          h.content || '',
          h.score || 0,
          i,
          now
        )
      })
    })
    tx()
    pruneExpired(db)
  } catch {
    /* 缓存写入失败不影响主流程 */
  }
}

function pruneExpired(db: ReturnType<typeof getDatabase>): void {
  try {
    const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString()
    db.prepare('DELETE FROM cloud_kb_cache WHERE cached_at < ?').run(cutoff)
  } catch {
    /* ignore */
  }
}
