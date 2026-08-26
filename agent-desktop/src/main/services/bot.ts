import { getDatabase } from '../database'
import { v4 as uuid } from 'uuid'
import type { SkillSelectionMode } from '../../shared/digital-employee'
import { listPromptSkills } from './prompt-skill'
import { parseBindings, resolveEffectiveDirs, type SkillBinding } from './skill-bindings'

export type ToolApproval = 'off' | 'destructive' | 'all'

export interface Bot {
  id: string
  name: string
  description: string
  model_provider_id: string | null
  model_id: string
  persona_id: string | null
  kb_only: number
  kb_category_ids: string[]
  /** 绑定的云端知识库 id 列表（来自云控端智能体预设，市场导入时写入；对话时在线检索） */
  cloud_kb_ids: number[]
  /** 是否仅依据云端知识库回答。0=否、1=是。默认否 */
  cloud_kb_only: number
  /** 云端知识库检索 Top K。默认 5 */
  cloud_kb_top_k: number
  skill_ids: string[]
  mcp_ids: string[]
  prompt_skill_dirs: string[]
  skill_bindings: SkillBinding[]
  skill_selection_mode: SkillSelectionMode
  default_workspace_id: string
  tool_approval: ToolApproval
  /** 是否启用 AI 生图能力（image_gen tool + 「生图：」切换条）。0=关、1=开。默认关。 */
  enable_image_gen: number
  /** 是否启用 AI PPT 能力（deck_* 工具集：规划/生成/图表/评审/导出）。0=关、1=开。默认关。 */
  enable_deck: number
  /** 单轮对话最大工具调用步数(0=用默认 40)。长任务(多页 PPT 等)可调高，避免被步数上限中断。 */
  max_tool_rounds: number
  /** 2:3 形象图本地绝对路径（市场导入时下载落盘；本地创建时也可上传）。空=用首字母占位 */
  avatar: string
  /** 来源：'local' 本地创建 / 'market' 从智能体市场保存 */
  source: string
  /** 市场来源云端 agent id（去重 / 评分用）。0=非市场来源 */
  cloud_agent_id: number
  cloud_template_version: number
  cloud_template_snapshot: Record<string, unknown>
  /** 投稿到市场的审核态：'' 未投稿 / pending / approved / rejected / withdrawn */
  submission_status: string
  submission_reject_reason: string
  submission_reviewed_at: string
  submission_synced_at: string
  created_at: string
  updated_at: string
}

function parseBot(row: any): Bot {
  return {
    ...row,
    kb_category_ids: JSON.parse(row.kb_category_ids || '[]'),
    cloud_kb_ids: (JSON.parse(row.cloud_kb_ids || '[]') as any[]).map(Number).filter((n) => n > 0),
    cloud_kb_only: row.cloud_kb_only ? 1 : 0,
    cloud_kb_top_k: Number(row.cloud_kb_top_k || 5),
    skill_ids: JSON.parse(row.skill_ids || '[]'),
    mcp_ids: JSON.parse(row.mcp_ids || '[]'),
    prompt_skill_dirs: JSON.parse(row.prompt_skill_dirs || '[]'),
    skill_bindings: parseBindings(row.skill_bindings),
    skill_selection_mode: (row.skill_selection_mode || 'legacy_all') as SkillSelectionMode,
    default_workspace_id: row.default_workspace_id || '',
    tool_approval: (row.tool_approval || 'destructive') as ToolApproval,
    enable_image_gen: row.enable_image_gen ? 1 : 0,
    enable_deck: row.enable_deck ? 1 : 0,
    max_tool_rounds: Number(row.max_tool_rounds || 0),
    avatar: row.avatar || '',
    source: row.source || 'local',
    cloud_agent_id: Number(row.cloud_agent_id || 0),
    cloud_template_version: Number(row.cloud_template_version || 0),
    cloud_template_snapshot: JSON.parse(row.cloud_template_snapshot || '{}'),
    submission_status: row.submission_status || '',
    submission_reject_reason: row.submission_reject_reason || '',
    submission_reviewed_at: row.submission_reviewed_at || '',
    submission_synced_at: row.submission_synced_at || ''
  }
}

export function listBots(): Bot[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM bots ORDER BY created_at DESC').all() as any[]
  return rows.map(parseBot)
}

export function getBot(id: string): Bot | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM bots WHERE id = ?').get(id) as any
  if (!row) return null
  return parseBot(row)
}

export function createBot(data: {
  name: string
  description?: string
  model_provider_id?: string
  model_id?: string
  persona_id?: string
  kb_only?: number
  kb_category_ids?: string[]
  cloud_kb_ids?: number[]
  cloud_kb_only?: number
  cloud_kb_top_k?: number
  skill_ids?: string[]
  mcp_ids?: string[]
  prompt_skill_dirs?: string[]
  skill_bindings?: SkillBinding[]
  skill_selection_mode?: SkillSelectionMode
  default_workspace_id?: string
  tool_approval?: ToolApproval
  enable_image_gen?: number
  enable_deck?: number
  max_tool_rounds?: number
  avatar?: string
  source?: string
  cloud_agent_id?: number
  cloud_template_version?: number
  cloud_template_snapshot?: Record<string, unknown>
}): Bot {
  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO bots (id, name, description, model_provider_id, model_id, persona_id, kb_only, kb_category_ids, cloud_kb_ids, cloud_kb_only, cloud_kb_top_k, skill_ids, mcp_ids, prompt_skill_dirs, skill_bindings, skill_selection_mode, default_workspace_id, tool_approval, enable_image_gen, enable_deck, max_tool_rounds, avatar, source, cloud_agent_id, cloud_template_version, cloud_template_snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    data.name,
    data.description || '',
    data.model_provider_id || null,
    data.model_id || '',
    data.persona_id || null,
    data.kb_only || 0,
    JSON.stringify(data.kb_category_ids || []),
    JSON.stringify((data.cloud_kb_ids || []).map(Number).filter((n) => n > 0)),
    data.cloud_kb_only ? 1 : 0,
    data.cloud_kb_top_k || 5,
    JSON.stringify(data.skill_ids || []),
    JSON.stringify(data.mcp_ids || []),
    JSON.stringify(data.prompt_skill_dirs || []),
    JSON.stringify(data.skill_bindings || []),
    data.skill_selection_mode || 'selected',
    data.default_workspace_id || '',
    data.tool_approval || 'destructive',
    data.enable_image_gen ? 1 : 0,
    data.enable_deck ? 1 : 0,
    data.max_tool_rounds || 0,
    data.avatar || '',
    data.source || 'local',
    data.cloud_agent_id || 0,
    data.cloud_template_version || 0,
    JSON.stringify(data.cloud_template_snapshot || {}),
    now,
    now
  )
  return getBot(id)!
}

export function updateBot(
  id: string,
  data: Partial<{
    name: string
    description: string
    model_provider_id: string | null
    model_id: string
    persona_id: string | null
    kb_only: number
    kb_category_ids: string[]
    cloud_kb_ids: number[]
    cloud_kb_only: number
    cloud_kb_top_k: number
    skill_ids: string[]
    mcp_ids: string[]
    prompt_skill_dirs: string[]
    skill_bindings: SkillBinding[]
    skill_selection_mode: SkillSelectionMode
    default_workspace_id: string
    tool_approval: ToolApproval
    enable_image_gen: number
    enable_deck: number
    max_tool_rounds: number
    avatar: string
    cloud_template_version: number
    cloud_template_snapshot: Record<string, unknown>
  }>
): Bot | null {
  const db = getDatabase()
  const existing = getBot(id)
  if (!existing) return null

  const now = new Date().toISOString()
  db.prepare(
    'UPDATE bots SET name=?, description=?, model_provider_id=?, model_id=?, persona_id=?, kb_only=?, kb_category_ids=?, cloud_kb_ids=?, cloud_kb_only=?, cloud_kb_top_k=?, skill_ids=?, mcp_ids=?, prompt_skill_dirs=?, skill_bindings=?, skill_selection_mode=?, default_workspace_id=?, tool_approval=?, enable_image_gen=?, enable_deck=?, max_tool_rounds=?, avatar=?, cloud_template_version=?, cloud_template_snapshot=?, updated_at=? WHERE id=?'
  ).run(
    data.name ?? existing.name,
    data.description ?? existing.description,
    data.model_provider_id !== undefined ? data.model_provider_id : existing.model_provider_id,
    data.model_id ?? existing.model_id,
    data.persona_id !== undefined ? data.persona_id : existing.persona_id,
    data.kb_only !== undefined ? data.kb_only : existing.kb_only,
    JSON.stringify(data.kb_category_ids ?? existing.kb_category_ids),
    JSON.stringify((data.cloud_kb_ids ?? existing.cloud_kb_ids).map(Number).filter((n) => n > 0)),
    data.cloud_kb_only !== undefined ? (data.cloud_kb_only ? 1 : 0) : existing.cloud_kb_only,
    data.cloud_kb_top_k !== undefined ? data.cloud_kb_top_k : existing.cloud_kb_top_k,
    JSON.stringify(data.skill_ids ?? existing.skill_ids),
    JSON.stringify(data.mcp_ids ?? existing.mcp_ids),
    JSON.stringify(data.prompt_skill_dirs ?? existing.prompt_skill_dirs),
    JSON.stringify(data.skill_bindings ?? existing.skill_bindings),
    data.skill_selection_mode ?? existing.skill_selection_mode,
    data.default_workspace_id ?? existing.default_workspace_id,
    data.tool_approval ?? existing.tool_approval,
    data.enable_image_gen !== undefined ? (data.enable_image_gen ? 1 : 0) : existing.enable_image_gen,
    data.enable_deck !== undefined ? (data.enable_deck ? 1 : 0) : existing.enable_deck,
    data.max_tool_rounds !== undefined ? data.max_tool_rounds : existing.max_tool_rounds,
    data.avatar ?? existing.avatar,
    data.cloud_template_version ?? existing.cloud_template_version,
    JSON.stringify(data.cloud_template_snapshot ?? existing.cloud_template_snapshot),
    now,
    id
  )
  return getBot(id)
}

export function deleteBot(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM bots WHERE id = ?').run(id)
  return result.changes > 0
}

/** 内置预设智能体: 数据库初始化时按 name 幂等创建。需在 seedPresetPersonas 之后调用(依赖 persona)。 */
const PPT_BOT_TOOLS = [
  'builtin_current_time',
  'builtin_calculator',
  'builtin_fetch_webpage',
  'builtin_json_tool',
  'builtin_text_tool',
  'builtin_random_generator'
]

export function seedPresetBots(): void {
  try {
    const db = getDatabase()
    // PPT 设计师: 绑 PPT 设计师 persona + 开启 deck 工具集 + 提高工具步数上限(多页 PPT 需多步)
    const exists = db.prepare('SELECT id FROM bots WHERE name = ?').get('PPT 设计师') as
      | { id: string }
      | undefined
    if (exists) {
      // 旧库幂等升级: 已存在但 skill_ids 为空时补上 6 个内置工具(不覆盖用户手动选择); 同时确保生图/AI PPT 能力默认开
      const row = db.prepare('SELECT skill_ids, enable_image_gen, enable_deck FROM bots WHERE id = ?').get(exists.id) as
        | { skill_ids: string; enable_image_gen: number; enable_deck: number }
        | undefined
      let cur: string[] = []
      try {
        cur = JSON.parse(row?.skill_ids || '[]')
      } catch {
        cur = []
      }
      if (cur.length === 0) {
        db.prepare("UPDATE bots SET skill_ids = ?, updated_at = datetime('now') WHERE id = ?").run(
          JSON.stringify(PPT_BOT_TOOLS),
          exists.id
        )
      }
      if (!row?.enable_image_gen) {
        db.prepare("UPDATE bots SET enable_image_gen = 1, updated_at = datetime('now') WHERE id = ?").run(exists.id)
      }
      // enable_deck 列是后加的(旧库 ALTER DEFAULT 0): 若此预设 bot 在加列前就已 seed, 这里幂等补 1, 否则 PPT 设计师丧失 deck 能力且无自愈
      if (!row?.enable_deck) {
        db.prepare("UPDATE bots SET enable_deck = 1, updated_at = datetime('now') WHERE id = ?").run(exists.id)
      }
    } else {
      const persona = db.prepare("SELECT id FROM personas WHERE name = 'PPT 设计师'").get() as { id: string } | undefined
      createBot({
        name: 'PPT 设计师',
        description: '通过多轮对话帮你做专业、可编辑的演示文稿。支持受控模板与 AI 自由设计双引擎，可绑知识库取真实素材。',
        persona_id: persona?.id,
        enable_deck: 1,
        // 默认开启生图能力(deck_gen_image 优先生图, 失败降级自绘 SVG; 同时暴露通用 image_gen 工具)
        enable_image_gen: 1,
        // 默认勾选全部 6 个内置小工具(取当前时间/计算器/抓网页/JSON/文本/随机), 供设计时取数/算数/查资料
        skill_ids: PPT_BOT_TOOLS,
        max_tool_rounds: 60,
        tool_approval: 'destructive',
        source: 'local'
      })
    }
  } catch (e) {
    console.error('Failed to seed preset bots:', e)
  }
}

/** 按市场来源云端 id 查本地 bot（保存到本地去重用） */
export function getBotByCloudAgentId(cloudAgentId: number): Bot | null {
  if (!cloudAgentId) return null
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM bots WHERE cloud_agent_id = ? LIMIT 1').get(cloudAgentId) as any
  return row ? parseBot(row) : null
}

/** 更新某个 bot 投稿到市场的审核态（投稿/状态轮询/撤回时写回） */
export function setBotSubmissionState(
  id: string,
  state: {
    cloudAgentId?: number
    status?: string
    rejectReason?: string
    reviewedAt?: string
    syncedAt?: string
  }
): Bot | null {
  const db = getDatabase()
  const existing = getBot(id)
  if (!existing) return null
  const now = new Date().toISOString()
  db.prepare(
    'UPDATE bots SET cloud_agent_id=?, submission_status=?, submission_reject_reason=?, submission_reviewed_at=?, submission_synced_at=?, updated_at=? WHERE id=?'
  ).run(
    state.cloudAgentId !== undefined ? state.cloudAgentId : existing.cloud_agent_id,
    state.status !== undefined ? state.status : existing.submission_status,
    state.rejectReason !== undefined ? state.rejectReason : existing.submission_reject_reason,
    state.reviewedAt !== undefined ? state.reviewedAt : existing.submission_reviewed_at,
    state.syncedAt !== undefined ? state.syncedAt : (state.status || state.rejectReason !== undefined ? now : existing.submission_synced_at),
    now,
    id
  )
  return getBot(id)
}

export function resolveBotPromptSkillDirs(bot: Bot): string[] {
  const installed = listPromptSkills().map((s) => s.dirName)
  const bindings = bot.skill_bindings && bot.skill_bindings.length
    ? bot.skill_bindings
    : (bot.prompt_skill_dirs || []).map((dir) => ({ source: 'local' as const, dir_name: dir }))
  return resolveEffectiveDirs(bindings, installed)
}

