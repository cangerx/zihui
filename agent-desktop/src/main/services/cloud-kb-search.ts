import { getCloudApiBase, fetchWithCloudAuth } from './cloud-token'
import { buildQueryHash, getCloudKbCache, upsertCloudKbCache, type CloudKbHit } from './cloud-kb-cache'

/**
 * 云端知识库在线检索（hybrid：云端为主 + 本地缓存降级）。
 *
 * 调云控端 POST /api/client/knowledge-bases/search（鉴权随智能体授权传递）。
 * 命中后写本地缓存；云端不可达/超时/未登录时回退缓存，让对话仍带（可能非最新）知识。
 */

export interface CloudKbSearchOptions {
  agentId: number
  query: string
  kbIds: number[]
  topK?: number
  signal?: AbortSignal
}

export interface CloudKbSearchResult {
  hits: CloudKbHit[]
  /** 'cloud' 实时命中 / 'cache' 离线缓存降级 / 'none' 无结果 */
  source: 'cloud' | 'cache' | 'none'
  /** 云端检索不可用的原因（如余额不足）：非空时调用方应把它带给 LLM/用户，避免静默用陈旧缓存 */
  unavailableReason?: string
}

const SEARCH_TIMEOUT_MS = 12000

export async function searchCloudKnowledgeBases(opts: CloudKbSearchOptions): Promise<CloudKbSearchResult> {
  const agentId = Number(opts.agentId || 0)
  const query = (opts.query || '').trim()
  const kbIds = (opts.kbIds || []).map(Number).filter((n) => n > 0)
  const topK = opts.topK && opts.topK > 0 ? opts.topK : 5
  if (!agentId || !query || kbIds.length === 0) {
    return { hits: [], source: 'none' }
  }

  const queryHash = buildQueryHash(query, kbIds, topK)
  const apiBase = getCloudApiBase()
  if (!apiBase) {
    const cached = getCloudKbCache(queryHash)
    return { hits: cached, source: cached.length ? 'cache' : 'none' }
  }

  // 超时控制 + 透传外部取消信号
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), SEARCH_TIMEOUT_MS)
  const onAbort = () => ac.abort()
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort()
    else opts.signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    const res = await fetchWithCloudAuth(
      `${apiBase}/client/knowledge-bases/search`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, query, kb_ids: kbIds, top_k: topK }),
        signal: ac.signal,
      },
      '云端知识库检索 401'
    )
    if (!res.ok) {
      const cached = getCloudKbCache(queryHash)
      // 402 余额不足：不再静默降级，带回原因让对话层告知用户（知识库已停更/欠费）
      if (res.status === 402) {
        return {
          hits: cached,
          source: cached.length ? 'cache' : 'none',
          unavailableReason: '云端余额不足，知识库实时检索已暂停' + (cached.length ? '（当前返回离线缓存，可能非最新）' : ''),
        }
      }
      return { hits: cached, source: cached.length ? 'cache' : 'none' }
    }
    const json: any = await res.json()
    const hits: CloudKbHit[] = Array.isArray(json?.hits)
      ? json.hits.map((h: any) => ({
          cloud_kb_id: Number(h.cloud_kb_id || 0),
          kb_name: String(h.kb_name || ''),
          chunk_id: Number(h.chunk_id || 0),
          document_id: Number(h.document_id || 0),
          source_doc: String(h.source_doc || ''),
          content: String(h.content || ''),
          score: Number(h.score || 0),
        }))
      : []
    if (hits.length) {
      upsertCloudKbCache(queryHash, hits)
    }
    return { hits, source: 'cloud' }
  } catch {
    // 网络错误 / 超时 / 未登录：降级到本地缓存
    const cached = getCloudKbCache(queryHash)
    return { hits: cached, source: cached.length ? 'cache' : 'none' }
  } finally {
    clearTimeout(timer)
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort)
  }
}
