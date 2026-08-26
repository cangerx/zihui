import { createHash } from 'crypto'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { v4 as uuid } from 'uuid'
import { getDatabase } from '../database'
import { getBot, updateBot } from './bot'
import { getWorkspace, setWorkspaceKbCategory } from './agent-workspace'
import { resolveWorkspaceContext } from './workspace-context'
import {
  createCategory,
  createKnowledgeBase,
  getCategory,
  getKnowledgeBaseByPath
} from './knowledge'
import { vectorizeDocument } from './vectorize'
import { createPromptSkillFromContent } from './prompt-skill'
import { getSetting } from './settings'
import type {
  DigitalEmployeeAsset,
  DigitalEmployeeAssetVersion,
  DigitalEmployeeCandidate,
  DigitalEmployeeProfile,
  EmployeeAssetType,
  EmployeeCandidateType,
  EmployeeScope
} from '../../shared/digital-employee'

const ASSET_TYPES = new Set<EmployeeAssetType>(['responsibility', 'boundary', 'workflow', 'acceptance'])
const CANDIDATE_TYPES = new Set<EmployeeCandidateType>([
  'knowledge', 'skill', 'workflow', 'responsibility', 'boundary', 'acceptance'
])
const SCOPES = new Set<EmployeeScope>(['employee', 'workspace', 'organization'])
const SENSITIVE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /(?:api[_-]?key|access[_-]?token|secret|password|passwd)\s*[:=]\s*['"]?[^\s'"]{8,}/i,
  /\bsk-[a-z0-9_-]{16,}\b/i,
  /\b(?:ghp|github_pat)_[a-z0-9_]{16,}\b/i,
  /\bBearer\s+[a-z0-9._~+/=-]{16,}\b/i,
  /(?:^|[;\s])(?:session|cookie|auth)[_-]?(?:id|token)?\s*=\s*[^;\s]{16,}/i
]

function safeObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return JSON.parse(JSON.stringify(raw)) as Record<string, unknown>
}

function safeList(raw: unknown, max = 50): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((x) => String(x || '').trim()).filter(Boolean).slice(0, max)
}

function parseJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw || '') as T } catch { return fallback }
}

function rowToProfile(row: any): DigitalEmployeeProfile {
  return {
    bot_id: row.bot_id,
    role_summary: row.role_summary || '',
    responsibilities: parseJson(row.responsibilities_json, []),
    boundaries: parseJson(row.boundaries_json, []),
    standard_inputs: parseJson(row.standard_inputs_json, []),
    deliverables: parseJson(row.deliverables_json, []),
    advanced_instructions: row.advanced_instructions || '',
    revision: Number(row.revision || 1),
    created_at: row.created_at || '',
    updated_at: row.updated_at || ''
  }
}

export function getEmployeeProfile(botId: string): DigitalEmployeeProfile | null {
  const row = getDatabase().prepare('SELECT * FROM digital_employee_profiles WHERE bot_id=?').get(botId) as any
  return row ? rowToProfile(row) : null
}

export function upsertEmployeeProfile(botId: string, input: Partial<DigitalEmployeeProfile>): DigitalEmployeeProfile {
  if (!getBot(botId)) throw new Error('数字员工不存在')
  const db = getDatabase()
  const current = getEmployeeProfile(botId)
  const now = new Date().toISOString()
  const next = {
    role_summary: String(input.role_summary ?? current?.role_summary ?? '').trim().slice(0, 500),
    responsibilities: safeList(input.responsibilities ?? current?.responsibilities),
    boundaries: safeList(input.boundaries ?? current?.boundaries),
    standard_inputs: safeList(input.standard_inputs ?? current?.standard_inputs),
    deliverables: safeList(input.deliverables ?? current?.deliverables),
    advanced_instructions: String(input.advanced_instructions ?? current?.advanced_instructions ?? '').slice(0, 20000),
    revision: (current?.revision || 0) + 1
  }
  db.prepare(`
    INSERT INTO digital_employee_profiles
      (bot_id, role_summary, responsibilities_json, boundaries_json, standard_inputs_json, deliverables_json, advanced_instructions, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bot_id) DO UPDATE SET
      role_summary=excluded.role_summary,
      responsibilities_json=excluded.responsibilities_json,
      boundaries_json=excluded.boundaries_json,
      standard_inputs_json=excluded.standard_inputs_json,
      deliverables_json=excluded.deliverables_json,
      advanced_instructions=excluded.advanced_instructions,
      revision=excluded.revision,
      updated_at=excluded.updated_at
  `).run(
    botId, next.role_summary, JSON.stringify(next.responsibilities), JSON.stringify(next.boundaries),
    JSON.stringify(next.standard_inputs), JSON.stringify(next.deliverables), next.advanced_instructions,
    next.revision, current?.created_at || now, now
  )
  return getEmployeeProfile(botId)!
}

function rowToVersion(row: any): DigitalEmployeeAssetVersion {
  return { ...row, version: Number(row.version), body: parseJson(row.body_json, {}) }
}

function rowToAsset(row: any): DigitalEmployeeAsset {
  return {
    ...row,
    current_version: row.version_id ? rowToVersion({
      id: row.version_id,
      asset_id: row.id,
      version: row.version,
      body_json: row.body_json,
      source_type: row.source_type,
      source_ref: row.source_ref,
      change_summary: row.change_summary,
      confirmed_at: row.confirmed_at,
      created_at: row.version_created_at
    }) : null
  }
}

export function listEmployeeAssets(botId: string, workspaceId = '', includeArchived = false): DigitalEmployeeAsset[] {
  const sql = `
    SELECT a.*, v.id AS version_id, v.version, v.body_json, v.source_type, v.source_ref,
      v.change_summary, v.confirmed_at, v.created_at AS version_created_at
    FROM digital_employee_assets a
    LEFT JOIN digital_employee_asset_versions v ON v.id=a.current_version_id
    WHERE a.bot_id=? AND (a.workspace_id='' OR a.workspace_id=?) ${includeArchived ? '' : "AND a.status='active'"}
    ORDER BY a.updated_at DESC`
  return (getDatabase().prepare(sql).all(botId, workspaceId) as any[]).map(rowToAsset)
}

export function saveEmployeeAsset(input: {
  id?: string
  botId: string
  workspaceId?: string
  assetType: EmployeeAssetType
  title: string
  body: Record<string, unknown>
  sourceType?: DigitalEmployeeAssetVersion['source_type']
  sourceRef?: string
  changeSummary?: string
}): DigitalEmployeeAsset {
  if (!ASSET_TYPES.has(input.assetType)) throw new Error('不支持的岗位资产类型')
  if (!getBot(input.botId)) throw new Error('数字员工不存在')
  const db = getDatabase()
  const id = input.id || uuid()
  const title = String(input.title || '').trim().slice(0, 200)
  if (!title) throw new Error('岗位资产标题不能为空')
  const body = safeObject(input.body)
  const now = new Date().toISOString()
  const tx = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM digital_employee_assets WHERE id=?').get(id) as any
    if (existing && existing.bot_id !== input.botId) throw new Error('岗位资产不属于该数字员工')
    if (!existing) {
      db.prepare(`INSERT INTO digital_employee_assets
        (id,bot_id,workspace_id,asset_type,title,current_version_id,status,created_at,updated_at)
        VALUES (?,?,?,?,?,'','active',?,?)`
      ).run(id, input.botId, input.workspaceId || '', input.assetType, title, now, now)
    }
    const last = db.prepare('SELECT MAX(version) AS v FROM digital_employee_asset_versions WHERE asset_id=?').get(id) as any
    const versionId = uuid()
    db.prepare(`INSERT INTO digital_employee_asset_versions
      (id,asset_id,version,body_json,source_type,source_ref,change_summary,confirmed_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(versionId, id, Number(last?.v || 0) + 1, JSON.stringify(body), input.sourceType || 'user', input.sourceRef || '', input.changeSummary || '', now, now)
    db.prepare(`UPDATE digital_employee_assets SET workspace_id=?,asset_type=?,title=?,current_version_id=?,status='active',updated_at=? WHERE id=?`)
      .run(input.workspaceId || '', input.assetType, title, versionId, now, id)
  })
  tx()
  return listEmployeeAssets(input.botId, input.workspaceId || '', true).find((a) => a.id === id)!
}

export function archiveEmployeeAsset(id: string): boolean {
  return getDatabase().prepare("UPDATE digital_employee_assets SET status='archived',updated_at=? WHERE id=?")
    .run(new Date().toISOString(), id).changes > 0
}

export function listEmployeeAssetVersions(assetId: string): DigitalEmployeeAssetVersion[] {
  return (getDatabase().prepare('SELECT * FROM digital_employee_asset_versions WHERE asset_id=? ORDER BY version DESC').all(assetId) as any[])
    .map(rowToVersion)
}

export function restoreEmployeeAssetVersion(assetId: string, versionId: string): DigitalEmployeeAsset {
  const db = getDatabase()
  const asset = db.prepare('SELECT * FROM digital_employee_assets WHERE id=?').get(assetId) as any
  const version = db.prepare('SELECT * FROM digital_employee_asset_versions WHERE id=? AND asset_id=?').get(versionId, assetId) as any
  if (!asset || !version) throw new Error('岗位资产版本不存在')
  return saveEmployeeAsset({
    id: assetId,
    botId: asset.bot_id,
    workspaceId: asset.workspace_id,
    assetType: asset.asset_type,
    title: asset.title,
    body: parseJson(version.body_json, {}),
    sourceType: 'restore',
    sourceRef: versionId,
    changeSummary: `恢复到版本 ${version.version}`
  })
}

function fingerprint(input: { type: string; scope: string; title: string; body: Record<string, unknown> }): string {
  const normalized = `${input.type}|${input.scope}|${input.title.trim().toLowerCase()}|${JSON.stringify(input.body)}`
  return createHash('sha256').update(normalized).digest('hex')
}

export function assertNoSensitiveContent(value: unknown): void {
  const text = JSON.stringify(value)
  if (SENSITIVE_PATTERNS.some((re) => re.test(text))) throw new Error('内容疑似包含凭据或敏感密钥，不能沉淀')
}

/** 写入任务历史等审计数据前脱敏；候选沉淀仍使用 assertNoSensitive 直接拒绝。 */
export function redactSensitiveText(value: unknown): string {
  let text = String(value ?? '')
  for (const pattern of SENSITIVE_PATTERNS) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    text = text.replace(new RegExp(pattern.source, flags), '[已隐藏敏感凭据]')
  }
  return text
}

function rowToCandidate(row: any): DigitalEmployeeCandidate {
  return { ...row, body: parseJson(row.body_json, {}), evidence: parseJson(row.evidence_json, {}) }
}

export function listEmployeeCandidates(botId: string, status = 'pending'): DigitalEmployeeCandidate[] {
  return (getDatabase().prepare('SELECT * FROM digital_employee_candidates WHERE bot_id=? AND status=? ORDER BY created_at DESC')
    .all(botId, status) as any[]).map(rowToCandidate)
}

export function createEmployeeCandidate(input: {
  botId: string
  conversationId?: string
  workspaceId?: string
  type: EmployeeCandidateType
  scope?: EmployeeScope
  title: string
  body: Record<string, unknown>
  evidence?: Record<string, unknown>
}): DigitalEmployeeCandidate {
  if (getSetting('digital_employee_learning') === '0') throw new Error('岗位建议功能已关闭')
  if (!CANDIDATE_TYPES.has(input.type)) throw new Error('不支持的沉淀类型')
  const scope = input.scope || 'workspace'
  if (!SCOPES.has(scope)) throw new Error('不支持的作用域')
  if (scope === 'organization') throw new Error('组织模板必须在云控端审核后创建')
  if (input.type === 'knowledge' && scope !== 'workspace') throw new Error('知识候选必须沉淀到工作区')
  if (input.type === 'skill' && scope !== 'employee') throw new Error('Skill 候选必须绑定到数字员工')
  if (!getBot(input.botId)) throw new Error('数字员工不存在')
  const title = String(input.title || '').trim().slice(0, 200)
  const body = safeObject(input.body)
  const evidence = safeObject(input.evidence)
  if (!title) throw new Error('候选标题不能为空')
  const serializedBody = JSON.stringify(body)
  const serializedEvidence = JSON.stringify(evidence)
  if (serializedBody.length > 50000 || serializedEvidence.length > 10000) throw new Error('候选内容过长，请精简后重试')
  assertNoSensitiveContent({ title, body, evidence })
  const db = getDatabase()
  if (input.conversationId) {
    const conversation = db.prepare('SELECT bot_id FROM conversations WHERE id=?').get(input.conversationId) as any
    if (!conversation || conversation.bot_id !== input.botId) throw new Error('候选证据不属于该数字员工会话')
    const messageId = String(evidence.message_id || '')
    if (messageId) {
      const message = db.prepare('SELECT id FROM messages WHERE id=? AND conversation_id=?').get(messageId, input.conversationId)
      if (!message) throw new Error('候选引用的消息不存在或不属于该会话')
    }
  }
  const workspaceId = scope === 'workspace' ? String(input.workspaceId || '') : ''
  if (scope === 'workspace' && !workspaceId) throw new Error('工作区候选必须选择工作区')
  const fp = fingerprint({ type: input.type, scope, title, body })
  const existing = db.prepare(`SELECT * FROM digital_employee_candidates
    WHERE bot_id=? AND workspace_id=? AND fingerprint=? AND status IN ('pending','accepted','rejected')`)
    .get(input.botId, workspaceId, fp) as any
  if (existing) return rowToCandidate(existing)
  const id = uuid()
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO digital_employee_candidates
    (id,bot_id,conversation_id,workspace_id,candidate_type,scope,title,body_json,evidence_json,fingerprint,conflict_ref,risk_level,status,target_type,target_ref,error_message,created_at,decided_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'medium','pending','','','',?,'')`
  ).run(id, input.botId, input.conversationId || '', workspaceId, input.type, scope, title, serializedBody, serializedEvidence, fp, '', now)
  return rowToCandidate(db.prepare('SELECT * FROM digital_employee_candidates WHERE id=?').get(id))
}

export function rejectEmployeeCandidate(id: string): DigitalEmployeeCandidate {
  const db = getDatabase()
  const now = new Date().toISOString()
  const result = db.prepare("UPDATE digital_employee_candidates SET status='rejected',decided_at=?,error_message='' WHERE id=? AND status='pending'").run(now, id)
  if (!result.changes) throw new Error('候选已处理或不存在')
  return rowToCandidate(db.prepare('SELECT * FROM digital_employee_candidates WHERE id=?').get(id))
}

function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').slice(0, 80) || '岗位知识'
}

async function acceptKnowledge(candidate: DigitalEmployeeCandidate): Promise<{ type: string; ref: string }> {
  const ws = getWorkspace(candidate.workspace_id)
  if (!ws) throw new Error('目标工作区不存在')
  const dir = join(ws.root_path, 'docs', '岗位沉淀')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const filePath = join(dir, `${safeFileName(candidate.title)}-${candidate.id.slice(0, 8)}.md`)
  const content = String(candidate.body.content || candidate.body.text || '').trim()
  if (!content) throw new Error('知识候选正文为空')
  writeFileSync(filePath, `# ${candidate.title}\n\n${content}\n`, 'utf-8')
  let categoryId = ws.kb_category_id
  if (!categoryId || !getCategory(categoryId)) {
    categoryId = createCategory({ name: `工作区·${ws.name}`, description: `工作区「${ws.name}」岗位知识` }).id
    setWorkspaceKbCategory(ws.id, categoryId)
  }
  let kb = getKnowledgeBaseByPath(filePath)
  if (!kb) kb = createKnowledgeBase({ category_id: categoryId, name: candidate.title, file_path: filePath, file_type: 'md' })
  try { await vectorizeDocument(kb.id, null) } catch { /* 文件仍保留为 pending，可在知识库重试 */ }
  return { type: 'knowledge', ref: kb.id }
}

function acceptSkill(candidate: DigitalEmployeeCandidate): { type: string; ref: string } {
  const content = String(candidate.body.content || candidate.body.instructions || '').trim()
  if (!content) throw new Error('Skill 候选正文为空')
  const skill = createPromptSkillFromContent(candidate.title, String(candidate.body.description || candidate.title), content)
  const bot = getBot(candidate.bot_id)!
  const dirs = Array.from(new Set([...(bot.prompt_skill_dirs || []), skill.dirName]))
  updateBot(bot.id, { prompt_skill_dirs: dirs, skill_selection_mode: 'selected' })
  return { type: 'skill', ref: skill.dirName }
}

export async function acceptEmployeeCandidate(id: string): Promise<DigitalEmployeeCandidate> {
  const db = getDatabase()
  const row = db.prepare("SELECT * FROM digital_employee_candidates WHERE id=? AND status IN ('pending','failed')").get(id) as any
  if (!row) throw new Error('候选已处理或不存在')
  const claimed = db.prepare("UPDATE digital_employee_candidates SET status='processing',error_message='' WHERE id=? AND status=?")
    .run(id, row.status)
  if (!claimed.changes) throw new Error('候选正在处理或已完成')
  const candidate = rowToCandidate(row)
  assertNoSensitiveContent(candidate)
  try {
    let target: { type: string; ref: string }
    if (candidate.candidate_type === 'knowledge') target = await acceptKnowledge(candidate)
    else if (candidate.candidate_type === 'skill') target = acceptSkill(candidate)
    else {
      const asset = saveEmployeeAsset({
        botId: candidate.bot_id,
        workspaceId: candidate.scope === 'workspace' ? candidate.workspace_id : '',
        assetType: candidate.candidate_type as EmployeeAssetType,
        title: candidate.title,
        body: candidate.body,
        sourceType: 'conversation',
        sourceRef: candidate.conversation_id,
        changeSummary: '从已确认岗位建议创建'
      })
      target = { type: 'asset', ref: asset.id }
    }
    const now = new Date().toISOString()
    db.prepare("UPDATE digital_employee_candidates SET status='accepted',target_type=?,target_ref=?,error_message='',decided_at=? WHERE id=? AND status='processing'")
      .run(target.type, target.ref, now, id)
  } catch (e: any) {
    db.prepare("UPDATE digital_employee_candidates SET status='failed',error_message=? WHERE id=? AND status='processing'")
      .run(String(e?.message || e).slice(0, 500), id)
    throw e
  }
  return rowToCandidate(db.prepare('SELECT * FROM digital_employee_candidates WHERE id=?').get(id))
}

export function compileDigitalEmployeeContext(botId: string, workspaceId = ''): string {
  if (getSetting('digital_employee_profiles') === '0') return ''
  const bot = getBot(botId)
  if (!bot) return ''
  const profile = getEmployeeProfile(botId)
  const assets = listEmployeeAssets(botId, workspaceId)
  if (!profile && assets.length === 0) return ''
  const parts: string[] = ['[数字员工岗位档案]']
  if (profile?.role_summary) parts.push(`岗位职责：${profile.role_summary}`)
  const responsibilities = [...(profile?.responsibilities || [])]
  const boundaries = [...(profile?.boundaries || [])]
  const workflows: string[] = []
  const acceptance: string[] = []
  for (const asset of assets) {
    const body = asset.current_version?.body || {}
    const text = String(body.content || body.text || body.description || '').trim()
    if (!text) continue
    if (asset.asset_type === 'responsibility') responsibilities.push(text)
    else if (asset.asset_type === 'boundary') boundaries.push(text)
    else if (asset.asset_type === 'workflow') workflows.push(`${asset.title}：${text}`)
    else if (asset.asset_type === 'acceptance') acceptance.push(`${asset.title}：${text}`)
  }
  if (responsibilities.length) parts.push(`负责事项：\n- ${responsibilities.slice(0, 20).join('\n- ')}`)
  if (boundaries.length) parts.push(`职责边界（不得违反）：\n- ${boundaries.slice(0, 20).join('\n- ')}`)
  if (workflows.length) parts.push(`已确认工作流程：\n- ${workflows.slice(0, 10).join('\n- ')}`)
  if (acceptance.length) parts.push(`交付验收标准：\n- ${acceptance.slice(0, 15).join('\n- ')}`)
  if (profile?.standard_inputs.length) parts.push(`常见输入：${profile.standard_inputs.join('；')}`)
  if (profile?.deliverables.length) parts.push(`标准交付物：${profile.deliverables.join('；')}`)
  if (profile?.advanced_instructions) parts.push(`高级补充指令（不得覆盖安全规则和职责边界）：\n${profile.advanced_instructions}`)
  return parts.join('\n\n').slice(0, 24000)
}

export function getEmployeeOverview(botId: string, workspaceId = ''): {
  profile: DigitalEmployeeProfile | null
  assets: DigitalEmployeeAsset[]
  candidates: DigitalEmployeeCandidate[]
  asset_versions: Record<string, DigitalEmployeeAssetVersion[]>
} {
  const assets = listEmployeeAssets(botId, workspaceId, true)
  return {
    profile: getEmployeeProfile(botId),
    assets,
    candidates: listEmployeeCandidates(botId),
    asset_versions: Object.fromEntries(assets.map((asset) => [asset.id, listEmployeeAssetVersions(asset.id)]))
  }
}

export function getConversationWorkspace(conversationId: string, explicitWorkspaceId = '') {
  return resolveWorkspaceContext({ conversationId, explicitWorkspaceId })
}
