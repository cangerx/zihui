import { getDatabase } from '../database'
import { v4 as uuid } from 'uuid'
import { join } from 'path'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { getDataDir } from './data-path'
import { clearLastTurnOverridesForConversation } from './chat-engine'

export interface Conversation {
  id: string
  bot_id: string
  title: string
  // 「智能体不再绑定模型」改造：每个会话独立持久记忆当前模型
  // - 新建时填入云控端默认（site-config.chat_default_model）；缺省留空
  // - 用户在输入框左下角切换 → updateConversationModel 写回
  // - chat-engine sendMessage 时按 conv → cloud_default → 本地第一个 chat 模型 回退链解析
  active_model_provider_id: string
  active_model_id: string
  // v0.6.6+ 「对话内生图模型独立选择」：会话级记忆生图服务商/模型。
  // - 输入框左下角「生图：」切换器写回
  // - chat-engine 调 image_gen tool 时若 LLM args 未传 provider_id/model_id，回退到这两列
  // - 仍空时让 LLM 自行 list_providers（保持向后兼容）
  active_image_provider_id: string
  active_image_model_id: string
  /**
   * 会话级工具审批档（P1-4）。
   * 空串 = 继承智能体 tool_approval；否则为 'off' | 'destructive' | 'all'。
   */
  tool_approval: string
  /** 用户手动改名后置 1：自动标题生成（第 1/5 条消息）不再覆盖用户命名 */
  title_locked: number
  /** D-20：关联品牌工作区 id；空=普通会话 */
  brand_workspace_id: string
  /** 本次任务实际使用的文件夹工作区；创建后冻结，避免全局切换导致目录漂移 */
  workspace_id: string
  created_at: string
  updated_at: string
}

/**
 * 对话内交互卡片（ask_user 通用询问 / image_params 生图参数确认卡）。
 * 仅用于 UI 渲染与留痕，不回传模型；registry skipColumns 已排除其参与云同步。
 * - pending：等待用户操作（可交互）
 * - answered：用户已确认（留痕，只读）
 * - expired / canceled：超时 / 中止（留痕，只读）
 */
export interface MessageCardOption {
  id: string
  label: string
  value?: any
  desc?: string
}

/** ask_user 分步向导中的单个问题。 */
export interface MessageCardQuestion {
  id: string
  question: string
  options: MessageCardOption[]
  allow_multiple?: boolean
  allow_free_input?: boolean
}

export interface MessageCard {
  type: 'ask_user' | 'image_params'
  request_id: string
  status: 'pending' | 'answered' | 'expired' | 'canceled'
  /** ask_user：问题列表（单题也是 1 元素），前端按分步向导渲染 */
  questions?: MessageCardQuestion[]
  /** ask_user：用户答案，按 question id 索引（answered 时写入） */
  answers?: Record<string, { selected: string[]; free_text?: string }>
  /** image_params：卡片标题文案 */
  question?: string
  /** image_params：预填默认值（prompt / size / tierId / quality / batchCount 等） */
  defaults?: Record<string, any>
  /** image_params：用户最终确认的结构化结果（回传生图参数） */
  result?: Record<string, any>
}

export interface Message {
  id: string
  conversation_id: string
  role: string
  content: string
  attachments: any[]
  tool_calls: any[]
  tool_call_id: string
  /** 推理模型思维链(仅 UI 展示，不回传模型)。 */
  reasoning: string
  /** 交互卡片（ask_user / image_params）；null = 普通消息。仅 UI 用，不回传模型。 */
  card: MessageCard | null
  created_at: string
}

export function listConversations(botId: string): Conversation[] {
  const db = getDatabase()
  const id = String(botId || '')
  const rows = id
    ? (db
        .prepare('SELECT * FROM conversations WHERE bot_id = ? ORDER BY updated_at DESC')
        .all(id) as Conversation[])
    : (db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as Conversation[])
  return rows.map(normalizeConversation)
}

export function getConversation(id: string): Conversation | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation | undefined
  return row ? normalizeConversation(row) : null
}

function normalizeConversation(row: Conversation): Conversation {
  return { ...row, bot_id: row.bot_id || '', workspace_id: row.workspace_id || '' }
}

export function createConversation(
  botId: string,
  title?: string,
  initialModel?: { provider_id: string; model_id: string },
  initialImageModel?: { provider_id: string; model_id: string },
  initialWorkspaceId?: string
): Conversation {
  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()
  // 新建时把云控端默认模型（或显式传入的初始模型）写入 active_model_*；
  // 缺省时留空字符串，chat-engine 解析时再走回退链
  const pid = initialModel?.provider_id || ''
  const mid = initialModel?.model_id || ''
  // 生图模型同理：新建时可选预填（本地第一个 image 类型模型），缺省留空
  const ipid = initialImageModel?.provider_id || ''
  const imid = initialImageModel?.model_id || ''
  let workspaceId = initialWorkspaceId || ''
  if (workspaceId) {
    const workspace = db.prepare('SELECT id FROM agent_workspaces WHERE id = ?').get(workspaceId)
    if (!workspace) throw new Error('工作区不存在，请刷新后重试')
  }
  if (!workspaceId && botId) {
    const row = db.prepare('SELECT default_workspace_id FROM bots WHERE id = ?').get(botId) as any
    workspaceId = row?.default_workspace_id || ''
  }
  if (!workspaceId) {
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'active_workspace_id'").get() as any
      workspaceId = row?.value || ''
    } catch { /* 首次启动可为空 */ }
  }
  // 未绑智能体必须写 NULL：空串会撞 bots 外键
  db.prepare(
    'INSERT INTO conversations (id, bot_id, title, active_model_provider_id, active_model_id, active_image_provider_id, active_image_model_id, workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, botId || null, title || '新对话', pid, mid, ipid, imid, workspaceId, now, now)
  // Eagerly create workspace directory so the "工作区" button works before any tool writes files.
  try {
    const wsDir = join(getDataDir(), 'workspaces', id)
    if (!existsSync(wsDir)) mkdirSync(wsDir, { recursive: true })
  } catch (e) {
    console.error('Failed to create workspace dir:', e)
  }
  return getConversation(id)!
}

export function updateConversationTitle(id: string, title: string, opts?: { manual?: boolean }): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  if (opts?.manual) {
    // 手动改名落 title_locked，自动标题生成不再覆盖
    db.prepare('UPDATE conversations SET title=?, title_locked=1, updated_at=? WHERE id=?').run(title, now, id)
  } else {
    db.prepare('UPDATE conversations SET title=?, updated_at=? WHERE id=?').run(title, now, id)
  }
}

/** 按角色计数（标题/摘要生成的守卫前置：绝大多数轮次不需要全量读消息体） */
export function countConversationMessages(conversationId: string): { user: number; userAssistant: number } {
  const db = getDatabase()
  const row = db
    .prepare("SELECT SUM(CASE WHEN role='user' THEN 1 ELSE 0 END) AS u, SUM(CASE WHEN role IN ('user','assistant') THEN 1 ELSE 0 END) AS ua FROM messages WHERE conversation_id=?")
    .get(conversationId) as any
  return { user: Number(row?.u || 0), userAssistant: Number(row?.ua || 0) }
}

/**
 * 切换会话使用的模型（输入框左下角下拉触发）。
 * 仅写两个字段，不更新 updated_at（避免污染会话列表的排序，切模型不算"有新消息"）
 * provider_id / model_id 任一为空表示清空（恢复回退链）
 */
export function updateConversationModel(
  id: string,
  provider_id: string,
  model_id: string
): void {
  const db = getDatabase()
  db.prepare(
    'UPDATE conversations SET active_model_provider_id=?, active_model_id=? WHERE id=?'
  ).run(provider_id || '', model_id || '', id)
}

/**
 * 切换会话使用的生图模型（输入框左下角「生图：」切换器触发）。
 * 同 updateConversationModel：不更新 updated_at，不污染会话列表排序。
 * 任一为空 → 表示清空，chat-engine 调 image_gen 时让 LLM 自行 list_providers。
 */
export function updateConversationImageModel(
  id: string,
  provider_id: string,
  model_id: string
): void {
  const db = getDatabase()
  db.prepare(
    'UPDATE conversations SET active_image_provider_id=?, active_image_model_id=? WHERE id=?'
  ).run(provider_id || '', model_id || '', id)
}

/** D-20：将会话挂到品牌工作区（空串解除关联） */
export function updateConversationBrandWorkspace(id: string, brandWorkspaceId: string): void {
  const db = getDatabase()
  db.prepare('UPDATE conversations SET brand_workspace_id=? WHERE id=?').run(brandWorkspaceId || '', id)
}

/** 切换本次任务工作区。运行中准入由 chat 层控制；这里只做持久化。 */
export function updateConversationWorkspace(id: string, workspaceId: string): Conversation | null {
  const db = getDatabase()
  const conversation = getConversation(id)
  if (!conversation) return null
  let resolvedId = workspaceId || ''
  if (!resolvedId && conversation.bot_id) {
    const bot = db.prepare('SELECT default_workspace_id FROM bots WHERE id = ?').get(conversation.bot_id) as any
    resolvedId = bot?.default_workspace_id || ''
  }
  if (!resolvedId) {
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'active_workspace_id'").get() as any
    resolvedId = setting?.value || ''
  }
  if (resolvedId) {
    const exists = db.prepare('SELECT id FROM agent_workspaces WHERE id = ?').get(resolvedId)
    if (!exists) throw new Error('工作区不存在，请刷新后重试')
  }
  db.prepare('UPDATE conversations SET workspace_id=? WHERE id=?').run(resolvedId, id)
  return getConversation(id)
}

/**
 * 切换会话工具审批档（输入条权限切换器）。
 * 空串 = 清除覆盖、继承智能体；不更新 updated_at。
 */
export function updateConversationToolApproval(id: string, tool_approval: string): void {
  const db = getDatabase()
  const mode = tool_approval === 'off' || tool_approval === 'destructive' || tool_approval === 'all'
    ? tool_approval
    : ''
  db.prepare('UPDATE conversations SET tool_approval=? WHERE id=?').run(mode, id)
}

export function deleteConversation(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
  // Cleanup workspace directory
  try {
    const wsDir = join(getDataDir(), 'workspaces', id)
    if (existsSync(wsDir)) rmSync(wsDir, { recursive: true, force: true })
  } catch (e) {
    console.error('Failed to cleanup workspace:', e)
  }
  // 同步清理 chat-engine 内的 stash，避免 lastTurnOverrides 残留指向已删会话
  try { clearLastTurnOverridesForConversation(id) } catch (e) { console.error('Failed to clear last-turn overrides:', e) }
  return result.changes > 0
}

export function getMessages(conversationId: string): Message[] {
  const db = getDatabase()
  // 排序兜底 rowid：一轮 agent 调用里 assistant(tool_calls)→tool→tool 是同步连续插入，
  // created_at（ISO 毫秒）常完全相同。仅按 created_at 排序时 SQLite 不保证同值行的顺序，
  // 会导致重建历史时 tool_calls 配对错乱 / 显示乱序。rowid 是隐式自增插入序（等效 seq 列），
  // 作为第二排序键即可稳定复原真实写入顺序，且无需加列、无迁移与并发赋值风险。
  const rows = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(conversationId) as any[]
  return rows.map((r) => ({
    ...r,
    attachments: JSON.parse(r.attachments || '[]'),
    tool_calls: JSON.parse(r.tool_calls || '[]'),
    tool_call_id: r.tool_call_id || '',
    reasoning: r.reasoning || '',
    card: r.card ? JSON.parse(r.card) : null
  }))
}

export function addMessage(data: {
  conversation_id: string
  role: string
  content: string
  attachments?: any[]
  tool_calls?: any[]
  tool_call_id?: string
  reasoning?: string
  card?: MessageCard | null
}): Message {
  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, attachments, tool_calls, tool_call_id, reasoning, card, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    data.conversation_id,
    data.role,
    data.content,
    JSON.stringify(data.attachments || []),
    JSON.stringify(data.tool_calls || []),
    data.tool_call_id || '',
    data.reasoning || '',
    data.card ? JSON.stringify(data.card) : '',
    now
  )
  db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(now, data.conversation_id)
  return {
    id,
    conversation_id: data.conversation_id,
    role: data.role,
    content: data.content,
    attachments: data.attachments || [],
    tool_calls: data.tool_calls || [],
    tool_call_id: data.tool_call_id || '',
    reasoning: data.reasoning || '',
    card: data.card || null,
    created_at: now
  }
}

/**
 * 更新某条消息的交互卡片状态（用户确认后置 answered / 超时置 expired / 中止置 canceled）。
 * 以浅合并方式打补丁到现有 card。card 不参与云同步（registry skipColumns），
 * 故此 UPDATE 不污染 messages 的 append-only 同步语义。
 * 返回更新后的 Message；消息不存在或本无 card 时返回 null。
 */
export function updateMessageCard(id: string, patch: Partial<MessageCard>): Message | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as any
  if (!row) return null
  const current: MessageCard | null = row.card ? JSON.parse(row.card) : null
  if (!current) return null
  const next: MessageCard = { ...current, ...patch }
  db.prepare('UPDATE messages SET card = ? WHERE id = ?').run(JSON.stringify(next), id)
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role,
    content: row.content,
    attachments: JSON.parse(row.attachments || '[]'),
    tool_calls: JSON.parse(row.tool_calls || '[]'),
    tool_call_id: row.tool_call_id || '',
    reasoning: row.reasoning || '',
    card: next,
    created_at: row.created_at
  }
}

// 更新单条消息正文（用于「继续生成」时剥掉 [已中断]/[Error] 标记，保留已产出的半截内容）。
export function updateMessageContent(id: string, content: string): boolean {
  const db = getDatabase()
  const result = db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id)
  return result.changes > 0
}

export function deleteMessage(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM messages WHERE id = ?').run(id)
  return result.changes > 0
}

// 删除指定消息及其之后的所有消息(用于编辑/重新生成时截断历史)。返回删除数量。
export function deleteMessagesFrom(conversationId: string, fromMessageId: string): number {
  const db = getDatabase()
  const msgs = getMessages(conversationId)
  const idx = msgs.findIndex((m) => m.id === fromMessageId)
  if (idx === -1) return 0
  const idsToDelete = msgs.slice(idx).map((m) => m.id)
  const stmt = db.prepare('DELETE FROM messages WHERE id = ?')
  const tx = db.transaction(() => {
    for (const mid of idsToDelete) stmt.run(mid)
  })
  tx()
  return idsToDelete.length
}
