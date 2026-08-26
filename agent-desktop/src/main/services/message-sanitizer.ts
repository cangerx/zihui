import type { ChatMessage } from './llm'

/**
 * OpenAI 格式会话历史净化器。
 *
 * 解决"一次失败/中断把会话历史毒化成非法状态、之后每次 replay 都失败、
 * 只有重开会话才正常"的问题(对应 bug2 / bug3)。
 *
 * 作为 chat-engine `repairHistoryHead` 的超集,在每轮 callLLM 之前对
 * "发送给模型的消息副本"做净化(不动数据库,DB 始终全量落库)。
 *
 * 处理项:
 * 1. 删除空消息:content 空白且无 tool_calls 的 assistant、空白 user
 *    —— 这是上游(尤其国产 OpenAI 兼容网关)400 / silent-200 的主因。
 * 2. 修复 tool 配对:删除孤立 tool(无声明它的 assistant.tool_calls 或顺序错位),
 *    为未被应答的 assistant.tool_calls 补合成 tool 结果。
 * 3. 合并相邻的纯文本 user(并发中断可能产生连续 user)。
 *
 * 不改变合法历史的语义,仅在历史已被污染时纠偏。
 */

const SYNTH_TOOL_ERR =
  'Error: tool result missing (session repair). The previous tool call did not complete; continue from here.'

/** content 是否为空(字符串空白 / 空数组 / 数组内无任何有效 part)。 */
export function isEmptyContent(content: ChatMessage['content'] | undefined | null): boolean {
  if (content == null) return true
  if (typeof content === 'string') return content.trim() === ''
  if (Array.isArray(content)) {
    if (content.length === 0) return true
    // 任意非 text part(image_url 等)或非空 text 即视为非空
    return !content.some((p: any) => {
      if (!p || typeof p !== 'object') return false
      if (p.type === 'text') return typeof p.text === 'string' && p.text.trim() !== ''
      return true
    })
  }
  return false
}

/**
 * 净化一条 OpenAI 格式消息列表,返回新数组(不修改入参元素的引用语义:
 * 合并 user 时会浅拷贝被合并项)。system 消息一律保留且不参与配对/合并。
 */
export function sanitizeOpenAIMessages(messages: ChatMessage[]): ChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages

  // Pass 1: 删除空消息(根治毒消息)。
  let msgs: ChatMessage[] = []
  for (const m of messages) {
    if (!m || !m.role) continue
    if (m.role === 'assistant') {
      const hasToolCalls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0
      if (!hasToolCalls && isEmptyContent(m.content)) continue
    } else if (m.role === 'user') {
      if (isEmptyContent(m.content)) continue
    } else if (m.role === 'tool') {
      // 工具可能合法返回空字符串,故不按空内容删除;但必须有 tool_call_id。
      if (!m.tool_call_id) continue
    }
    msgs.push(m)
  }

  // Pass 2: 迭代修复 tool 配对直到稳定(删一个可能孤立另一个)。
  for (let iter = 0; iter < 5; iter++) {
    const declaredAll = new Set<string>()
    const answeredAll = new Set<string>()
    for (const m of msgs) {
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) if (tc?.id) declaredAll.add(tc.id)
      } else if (m.role === 'tool' && m.tool_call_id) {
        answeredAll.add(m.tool_call_id)
      }
    }

    let changed = false
    const next: ChatMessage[] = []
    const seenDeclared = new Set<string>()
    for (const m of msgs) {
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        for (const tc of m.tool_calls) if (tc?.id) seenDeclared.add(tc.id)
        next.push(m)
        // 为未被应答的 tool_calls 紧随其后补合成 tool 结果,保证配对合法。
        const ids: string[] = m.tool_calls.map((tc: any) => tc?.id).filter(Boolean)
        const missing = ids.filter((id) => !answeredAll.has(id))
        if (missing.length > 0) {
          for (const id of missing) {
            next.push({ role: 'tool', content: SYNTH_TOOL_ERR, tool_call_id: id })
            answeredAll.add(id)
          }
          changed = true
        }
        continue
      }
      if (m.role === 'tool') {
        // 孤立 tool:未在任何 assistant 声明,或出现在声明它的 assistant 之前(顺序错位)。
        if (!m.tool_call_id || !declaredAll.has(m.tool_call_id) || !seenDeclared.has(m.tool_call_id)) {
          changed = true
          continue
        }
      }
      next.push(m)
    }
    msgs = next
    if (!changed) break
  }

  // Pass 3: 合并相邻的纯文本 user(防并发中断产生的连续 user;多模态数组不合并)。
  const merged: ChatMessage[] = []
  for (const m of msgs) {
    const prev = merged[merged.length - 1]
    if (
      prev &&
      prev.role === 'user' &&
      m.role === 'user' &&
      typeof prev.content === 'string' &&
      typeof m.content === 'string'
    ) {
      merged[merged.length - 1] = { ...prev, content: `${prev.content}\n${m.content}` }
      continue
    }
    merged.push(m)
  }

  return merged
}
