import { randomUUID } from 'crypto'
import { getDatabase } from '../database'
import { callLLM } from './llm'

export type DailyReviewKind = 'daily' | 'deep'

export interface DailyReview {
  id: string
  kind: DailyReviewKind
  title: string
  range_start: string
  range_end: string
  content: string
  status: 'ok' | 'error'
  error: string
  provider_id: string
  model_id: string
  conversation_count: number
  message_count: number
  created_at: string
}

export interface GenerateReviewInput {
  kind: DailyReviewKind
  providerId: string
  modelId: string
  /** ISO 本地日起点；缺省按 kind 推算 */
  rangeStart?: string
  rangeEnd?: string
}

interface DigestResult {
  text: string
  conversationCount: number
  messageCount: number
}

function startOfLocalDay(d = new Date()): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function defaultRange(kind: DailyReviewKind): { start: Date; end: Date } {
  const end = new Date()
  if (kind === 'daily') {
    return { start: startOfLocalDay(end), end }
  }
  const start = startOfLocalDay(end)
  start.setDate(start.getDate() - 6)
  return { start, end }
}

function formatRangeTitle(kind: DailyReviewKind, start: Date, end: Date): string {
  const fmt = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`
  if (kind === 'daily') return `[每日回顾] ${fmt(start)}`
  return `[深度分析] ${fmt(start)}-${fmt(end)}`
}

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

/** 汇总时间窗内的 user/assistant 消息，供回顾生成 */
export function collectConversationDigest(rangeStart: string, rangeEnd: string): DigestResult {
  const db = getDatabase()
  const rows = db
    .prepare(
      `SELECT c.id AS conv_id, c.title AS conv_title, m.role, m.content, m.created_at
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.created_at >= ? AND m.created_at <= ?
         AND m.role IN ('user', 'assistant')
         AND TRIM(m.content) != ''
       ORDER BY m.created_at ASC
       LIMIT 600`
    )
    .all(rangeStart, rangeEnd) as Array<{
    conv_id: string
    conv_title: string
    role: string
    content: string
    created_at: string
  }>

  if (!rows.length) {
    return { text: '', conversationCount: 0, messageCount: 0 }
  }

  const convIds = new Set<string>()
  const parts: string[] = []
  let totalChars = 0
  const MAX_TOTAL = 28000

  for (const row of rows) {
    convIds.add(row.conv_id)
    const line = `[${row.created_at}] (${row.conv_title || '未命名'}) ${row.role}: ${truncate(row.content, 400)}`
    if (totalChars + line.length > MAX_TOTAL) break
    parts.push(line)
    totalChars += line.length + 1
  }

  return {
    text: parts.join('\n'),
    conversationCount: convIds.size,
    messageCount: rows.length
  }
}

function buildPrompt(kind: DailyReviewKind, digest: string, rangeLabel: string): { system: string; user: string } {
  if (kind === 'daily') {
    return {
      system:
        '你是本地 AI 工作台的每日回顾助手。根据用户当日对话摘录，用简洁中文输出回顾。结构建议：今日进展、待办/遗漏、关键决策、明日建议。不要编造摘录中没有的事实。',
      user: `时间范围：${rangeLabel}\n\n对话摘录：\n${digest}\n\n请生成今日回顾。`
    }
  }
  return {
    system:
      '你是本地 AI 工作台的深度分析助手。根据多日对话摘录，输出主题聚类、推进节奏、风险与建议。用中文，条理清晰。不要编造摘录中没有的事实。',
    user: `时间范围：${rangeLabel}\n\n对话摘录：\n${digest}\n\n请生成深度分析。`
  }
}

function insertReview(row: DailyReview): void {
  const db = getDatabase()
  db.prepare(
    `INSERT INTO daily_reviews
      (id, kind, title, range_start, range_end, content, status, error, provider_id, model_id, conversation_count, message_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.kind,
    row.title,
    row.range_start,
    row.range_end,
    row.content,
    row.status,
    row.error,
    row.provider_id,
    row.model_id,
    row.conversation_count,
    row.message_count,
    row.created_at
  )
}

export async function generateReview(input: GenerateReviewInput): Promise<DailyReview> {
  const kind = input.kind
  const range = input.rangeStart && input.rangeEnd
    ? { start: new Date(input.rangeStart), end: new Date(input.rangeEnd) }
    : defaultRange(kind)

  const rangeStart = range.start.toISOString()
  const rangeEnd = range.end.toISOString()
  const title = formatRangeTitle(kind, range.start, range.end)
  const digest = collectConversationDigest(rangeStart, rangeEnd)
  const createdAt = new Date().toISOString()
  const id = randomUUID()

  if (!digest.messageCount) {
    const row: DailyReview = {
      id,
      kind,
      title,
      range_start: rangeStart,
      range_end: rangeEnd,
      content: '',
      status: 'error',
      error: '生成失败：指定时间范围内没有找到对话',
      provider_id: input.providerId || '',
      model_id: input.modelId || '',
      conversation_count: 0,
      message_count: 0,
      created_at: createdAt
    }
    insertReview(row)
    return row
  }

  if (!input.providerId || !input.modelId) {
    const row: DailyReview = {
      id,
      kind,
      title,
      range_start: rangeStart,
      range_end: rangeEnd,
      content: '',
      status: 'error',
      error: '请先选择用于生成回顾的对话模型',
      provider_id: '',
      model_id: '',
      conversation_count: digest.conversationCount,
      message_count: digest.messageCount,
      created_at: createdAt
    }
    insertReview(row)
    return row
  }

  const rangeLabel = `${range.start.toLocaleString()} ~ ${range.end.toLocaleString()}`
  const { system, user } = buildPrompt(kind, digest.text, rangeLabel)

  try {
    const result = await callLLM(
      input.providerId,
      {
        modelId: input.modelId,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        stream: false,
        notifyStream: false,
        temperature: 0.4,
        max_tokens: 4096
      },
      undefined
    )
    const content = (result.content || '').trim()
    const row: DailyReview = {
      id,
      kind,
      title,
      range_start: rangeStart,
      range_end: rangeEnd,
      content: content || '（模型未返回内容）',
      status: 'ok',
      error: '',
      provider_id: input.providerId,
      model_id: input.modelId,
      conversation_count: digest.conversationCount,
      message_count: digest.messageCount,
      created_at: createdAt
    }
    insertReview(row)
    return row
  } catch (e: any) {
    const row: DailyReview = {
      id,
      kind,
      title,
      range_start: rangeStart,
      range_end: rangeEnd,
      content: '',
      status: 'error',
      error: `生成失败：${e?.message || e}`,
      provider_id: input.providerId,
      model_id: input.modelId,
      conversation_count: digest.conversationCount,
      message_count: digest.messageCount,
      created_at: createdAt
    }
    insertReview(row)
    return row
  }
}

export function listReviews(): DailyReview[] {
  const db = getDatabase()
  return db
    .prepare('SELECT * FROM daily_reviews ORDER BY created_at DESC LIMIT 100')
    .all() as DailyReview[]
}

export function getReview(id: string): DailyReview | null {
  const db = getDatabase()
  return (db.prepare('SELECT * FROM daily_reviews WHERE id = ?').get(id) as DailyReview) || null
}

export function deleteReview(id: string): boolean {
  const db = getDatabase()
  const r = db.prepare('DELETE FROM daily_reviews WHERE id = ?').run(id)
  return r.changes > 0
}

export function previewDigest(kind: DailyReviewKind): DigestResult & { rangeStart: string; rangeEnd: string } {
  const { start, end } = defaultRange(kind)
  const rangeStart = start.toISOString()
  const rangeEnd = end.toISOString()
  return { ...collectConversationDigest(rangeStart, rangeEnd), rangeStart, rangeEnd }
}
