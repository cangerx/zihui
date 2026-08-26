import { listKnowledgeBases } from './knowledge'
import { embedText, EmbeddingUnavailableError } from './embedding'
import { searchHybrid } from './vector-store'

// 与 core-tools.kb_search 的本地检索阈值保持一致
const KB_SEARCH_THRESHOLD = 0.3

export interface LocalKbHit {
  score: number
  source: string
  content: string
}

/**
 * 本地知识库「直接检索」（不经对话工具循环）：给 query + 分类 id，返回命中片段。
 *
 * 供画布「智能体节点」在调对话模型前做一次前置检索，把命中内容拼进系统提示。
 * 复用与 core-tools.kb_search 相同的 embedText + searchHybrid 向量混合检索底座与阈值，
 * 只保留本地库部分（云端库需 agent_id，画布智能体节点按产品决策仅用本地库）。
 */
export async function searchLocalKb(
  query: string,
  categoryIds: string[],
  topK = 5,
  signal?: AbortSignal
): Promise<{ results: LocalKbHit[]; error?: string }> {
  const q = String(query || '').trim()
  if (!q) return { results: [] }
  if (!Array.isArray(categoryIds) || categoryIds.length === 0) return { results: [] }

  const k = Math.max(1, Math.min(20, Number(topK) || 5))
  const kbIds: string[] = []
  const kbNameMap = new Map<string, string>()
  for (const catId of categoryIds.map(String)) {
    for (const kb of listKnowledgeBases(catId)) {
      if (kb.status === 'ready' || kb.status === 'stale') {
        kbIds.push(kb.id)
        kbNameMap.set(kb.id, kb.name)
      }
    }
  }
  if (kbIds.length === 0) return { results: [] }

  try {
    const queryEmbed = await embedText(q, { signal })
    const hits = searchHybrid(queryEmbed.embedding, q, kbIds, k, KB_SEARCH_THRESHOLD)
    return {
      results: hits.map((h) => ({
        score: Math.round(h.score * 1000) / 1000,
        source: kbNameMap.get(h.chunk.knowledge_base_id) || '本地文档',
        content: h.chunk.content || ''
      }))
    }
  } catch (e: any) {
    if (e instanceof EmbeddingUnavailableError) {
      return { results: [], error: `本地向量服务不可用 (${e.code})` }
    }
    return { results: [], error: `本地检索失败: ${e.message || String(e)}` }
  }
}
