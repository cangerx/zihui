import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import { getConversation, getMessages, countConversationMessages } from './conversation'
import { getBot } from './bot'
import { callLLM } from './llm'
import { getDeviceSetting, setDeviceSetting } from './device-settings'
import {
  bindFolder,
  createCategory,
  createKnowledgeBase,
  getCategory,
  getKnowledgeBaseByPath,
  updateKnowledgeBaseStatus
} from './knowledge'
import { getActiveWorkspace, setWorkspaceKbCategory } from './agent-workspace'
import { vectorizeDocument } from './vectorize'
import { deleteChunksByKnowledgeBaseId } from './vector-store'

export type DistillMode = 'ask' | 'auto' | 'off'

export interface DistillRecord {
  conversation_id: string
  kb_id: string
  file_path: string
  covered_count: number
  status: 'ok' | 'skipped' | 'error'
  updated_at: string
}

export interface DistillResult {
  ok: boolean
  skipped?: boolean
  reason?: string
  filePath?: string
  kbId?: string
  vectorized?: boolean
  warning?: string
  coveredCount?: number
}

const MODE_KEY = 'distill_mode'
const MIN_CHARS = 400
const MAX_DIGEST = 24000
const running = new Set<string>()

function ensureTable(): void {
  const db = getDatabase()
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_distills (
      conversation_id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL DEFAULT '',
      covered_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    )
  `)
}

export function getDistillMode(): DistillMode {
  const v = (getDeviceSetting(MODE_KEY) || 'ask').trim()
  if (v === 'auto' || v === 'off' || v === 'ask') return v
  return 'ask'
}

export function setDistillMode(mode: DistillMode): DistillMode {
  const next: DistillMode = mode === 'auto' || mode === 'off' ? mode : 'ask'
  setDeviceSetting(MODE_KEY, next)
  return next
}

export function getDistillRecord(conversationId: string): DistillRecord | null {
  ensureTable()
  const row = getDatabase()
    .prepare('SELECT * FROM conversation_distills WHERE conversation_id = ?')
    .get(conversationId) as DistillRecord | undefined
  return row || null
}

function upsertRecord(row: DistillRecord): void {
  ensureTable()
  getDatabase()
    .prepare(
      `INSERT INTO conversation_distills (conversation_id, kb_id, file_path, covered_count, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         kb_id=excluded.kb_id, file_path=excluded.file_path, covered_count=excluded.covered_count,
         status=excluded.status, updated_at=excluded.updated_at`
    )
    .run(row.conversation_id, row.kb_id, row.file_path, row.covered_count, row.status, row.updated_at)
}

function collectDigest(conversationId: string): {
  text: string
  chars: number
  user: number
  assistant: number
  ua: number
} {
  const msgs = getMessages(conversationId)
  const parts: string[] = []
  let chars = 0
  let user = 0
  let assistant = 0
  for (const m of msgs) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    if (m.card) continue
    const body = String(m.content || '').trim()
    if (!body) continue
    if (m.role === 'user') user++
    else assistant++
    const line = `${m.role === 'user' ? '用户' : '助手'}: ${body}`
    if (chars + line.length > MAX_DIGEST) break
    parts.push(line)
    chars += line.length + 1
  }
  return { text: parts.join('\n\n'), chars, user, assistant, ua: user + assistant }
}

export function inspectDistill(conversationId: string): {
  eligible: boolean
  reason: string
  ua: number
  coveredCount: number
  record: DistillRecord | null
  mode: DistillMode
} {
  const mode = getDistillMode()
  const counts = countConversationMessages(conversationId)
  const record = getDistillRecord(conversationId)
  const digest = collectDigest(conversationId)
  if (digest.user < 1 || digest.assistant < 1 || digest.chars < MIN_CHARS) {
    return {
      eligible: false,
      reason: '对话还比较短，没有足够可沉淀的内容',
      ua: counts.userAssistant,
      coveredCount: record?.covered_count || 0,
      record,
      mode
    }
  }
  if (record && record.covered_count >= counts.userAssistant && record.status !== 'error') {
    return {
      eligible: false,
      reason: record.status === 'ok' ? '这次对话已经沉淀过' : '已跳过，有新内容后再提示',
      ua: counts.userAssistant,
      coveredCount: record.covered_count,
      record,
      mode
    }
  }
  return {
    eligible: true,
    reason: '',
    ua: counts.userAssistant,
    coveredCount: record?.covered_count || 0,
    record,
    mode
  }
}

function ensureMemorySink(): { categoryId: string; dir: string; workspaceId: string } {
  const ws = getActiveWorkspace()
  const dir = join(ws.root_path, 'docs', '记忆')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  let categoryId = ws.kb_category_id
  if (!categoryId || !getCategory(categoryId)) {
    const cat = createCategory({
      name: `${ws.name}·对话记忆`,
      description: '从对话蒸馏的可复用笔记（结论、决策、偏好、待办）'
    })
    categoryId = cat.id
    setWorkspaceKbCategory(ws.id, categoryId)
  }
  try {
    bindFolder(categoryId, dir)
  } catch (e) {
    console.error('[distill] bindFolder failed:', e)
  }
  return { categoryId, dir, workspaceId: ws.id }
}

function resolveModel(conversationId: string): { providerId: string; modelId: string } | null {
  const conv = getConversation(conversationId)
  if (!conv) return null
  const bot = getBot(conv.bot_id)
  const providerId = conv.active_model_provider_id || bot?.model_provider_id || 'cloud:default'
  const modelId = conv.active_model_id || bot?.model_id || ''
  if (!modelId) return null
  return { providerId, modelId }
}

async function distillMarkdown(title: string, digest: string, providerId: string, modelId: string): Promise<string> {
  const result = await callLLM(
    providerId,
    {
      modelId,
      messages: [
        {
          role: 'system',
          content:
            '你把对话蒸馏成可写入知识库的中文笔记。只保留以后还能用的内容：结论、决策、用户偏好、关键事实、待办。去掉寒暄、过程吐槽、工具日志和不确定猜测。用 Markdown，小标题简洁。若确实没有可沉淀要点，只输出 SKIP。不要编造对话里没有的事实。'
        },
        {
          role: 'user',
          content: `会话标题：${title}\n\n对话摘录：\n${digest}\n\n请输出笔记。`
        }
      ],
      stream: false,
      notifyStream: false,
      temperature: 0.2,
      max_tokens: 2048
    },
    undefined
  )
  return String(result.content || '').trim()
}

export async function skipDistill(conversationId: string): Promise<DistillRecord> {
  const counts = countConversationMessages(conversationId)
  const existing = getDistillRecord(conversationId)
  const row: DistillRecord = {
    conversation_id: conversationId,
    kb_id: existing?.kb_id || '',
    file_path: existing?.file_path || '',
    covered_count: counts.userAssistant,
    status: 'skipped',
    updated_at: new Date().toISOString()
  }
  upsertRecord(row)
  return row
}

export async function runDistill(
  conversationId: string,
  opts: { force?: boolean; window?: BrowserWindow | null } = {}
): Promise<DistillResult> {
  if (running.has(conversationId)) {
    return { ok: false, reason: '正在沉淀，请稍候' }
  }
  const conv = getConversation(conversationId)
  if (!conv) return { ok: false, reason: '对话不存在' }

  const inspect = inspectDistill(conversationId)
  if (!opts.force && !inspect.eligible) {
    return { ok: true, skipped: true, reason: inspect.reason, coveredCount: inspect.coveredCount }
  }

  const digest = collectDigest(conversationId)
  if (digest.user < 1 || digest.assistant < 1 || digest.chars < MIN_CHARS) {
    return { ok: true, skipped: true, reason: '对话还比较短，没有足够可沉淀的内容' }
  }

  const model = resolveModel(conversationId)
  if (!model) return { ok: false, reason: '请先选择对话模型，再沉淀到知识库' }

  running.add(conversationId)
  const counts = countConversationMessages(conversationId)
  try {
    const note = await distillMarkdown(conv.title || '对话', digest.text, model.providerId, model.modelId)
    if (!note || note === 'SKIP' || /^SKIP\s*$/i.test(note)) {
      upsertRecord({
        conversation_id: conversationId,
        kb_id: '',
        file_path: '',
        covered_count: counts.userAssistant,
        status: 'skipped',
        updated_at: new Date().toISOString()
      })
      return { ok: true, skipped: true, reason: '这次对话没有可沉淀的要点', coveredCount: counts.userAssistant }
    }

    const sink = ensureMemorySink()
    const filePath = join(sink.dir, `对话记忆-${conversationId.slice(0, 8)}.md`)
    const title = conv.title && conv.title !== '新对话' && conv.title !== 'New Chat' ? conv.title : '对话记忆'
    const body =
      `---\nconversation_id: ${conversationId}\nupdated: ${new Date().toISOString()}\n---\n\n` +
      `# ${title}\n\n${note.trim()}\n`
    writeFileSync(filePath, body, 'utf-8')

    let kb = getKnowledgeBaseByPath(filePath)
    if (!kb) {
      kb = createKnowledgeBase({
        category_id: sink.categoryId,
        name: `${title}（对话记忆）`,
        file_path: filePath,
        file_type: 'md'
      })
    } else {
      deleteChunksByKnowledgeBaseId(kb.id)
      updateKnowledgeBaseStatus(kb.id, 'pending', 0)
    }

    let vectorized = false
    let warning = ''
    try {
      await vectorizeDocument(kb.id, opts.window || null)
      vectorized = true
    } catch (e: any) {
      warning = e?.message || '笔记已保存，但向量化未完成，暂时无法被对话检索'
    }

    upsertRecord({
      conversation_id: conversationId,
      kb_id: kb.id,
      file_path: filePath,
      covered_count: counts.userAssistant,
      status: 'ok',
      updated_at: new Date().toISOString()
    })
    return {
      ok: true,
      filePath,
      kbId: kb.id,
      vectorized,
      warning: warning || undefined,
      coveredCount: counts.userAssistant
    }
  } catch (e: any) {
    upsertRecord({
      conversation_id: conversationId,
      kb_id: getDistillRecord(conversationId)?.kb_id || '',
      file_path: getDistillRecord(conversationId)?.file_path || '',
      covered_count: getDistillRecord(conversationId)?.covered_count || 0,
      status: 'error',
      updated_at: new Date().toISOString()
    })
    return { ok: false, reason: e?.message || '沉淀失败' }
  } finally {
    running.delete(conversationId)
  }
}
