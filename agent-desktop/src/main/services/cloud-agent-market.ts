import https from 'https'
import http from 'http'
import { getCloudApiBase, getCloudToken, fetchWithCloudAuth } from './cloud-token'
import { createBot, getBot, getBotByCloudAgentId, updateBot, type Bot, type ToolApproval } from './bot'
import { createPersona } from './persona'
import { downloadAvatarFromUrl } from './bot-avatar'
import { upsertEmployeeProfile, saveEmployeeAsset, createEmployeeCandidate } from './digital-employee'
import { listPromptSkills } from './prompt-skill'

class HttpError extends Error {
  status: number
  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`)
    this.status = status
  }
}

// 桌面端预设的 6 个内置小工具（builtin_* 全平台固定 ID），市场只承载这一组
const BUILTIN_TOOL_IDS = new Set([
  'builtin_current_time',
  'builtin_calculator',
  'builtin_fetch_webpage',
  'builtin_json_tool',
  'builtin_text_tool',
  'builtin_random_generator',
])

export interface CloudAgent {
  id: number
  name: string
  description: string
  avatar: string
  avatar_thumb: string
  system_prompt: string
  tool_skill_ids: string[]
  tool_approval: ToolApproval
  enable_image_gen: number
  enable_deck: number
  tags: string[]
  /** 市场分类（云控端 agent_categories）；null=未分类 */
  category_id: number | null
  category_name: string
  download_count: number
  rating_avg: number
  rating_count: number
  author_nickname: string
  // 定价：price=0 免费；>0 需购买。price_balance_type：token=金币 / credit=积分
  price: number
  price_balance_type: 'token' | 'credit'
  // 当前登录用户是否已拥有（已购买 / 免费已领取）
  is_owned: boolean
  // 云端知识库绑定（acquire 后下发；桌面端对话时在线检索）
  cloud_kb_ids: number[]
  cloud_kb_only: number
  cloud_kb_top_k: number
  template_schema_version: number
  template_version: number
  role_profile: Record<string, unknown>
  workflow_templates: Array<{ title: string; content: string }>
  acceptance_templates: Array<{ title: string; content: string }>
  recommended_skill_dirs: string[]
  connector_requirements: string[]
  created_at?: string
}

/** 市场分类（GET /public/agents/categories 下发） */
export interface MarketCategory {
  id: number
  name: string
  description?: string
  sort_order?: number
}

/** 市场列表/详情请求：登录则带 token（按身份过滤 + 标记已拥有），未登录匿名（只看公开免费）。 */
function fetchJson(url: string, timeoutMs = 12000): Promise<any> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const token = getCloudToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const req = mod.get(url, { headers }, (res) => {
      const status = res.statusCode || 0
      let data = ''
      res.on('data', (chunk: string) => (data += chunk))
      res.on('end', () => {
        if (status >= 400) {
          reject(new HttpError(status, data))
          return
        }
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Request timeout after ${timeoutMs}ms`)))
    req.on('error', reject)
  })
}

function isNotFound(e: unknown): boolean {
  return e instanceof HttpError && e.status === 404
}

function originOf(apiBase: string): string {
  const m = apiBase.match(/^(https?:\/\/[^/]+)/)
  return m ? m[1] : ''
}

function resolveUrl(value: string | undefined, origin: string): string {
  if (!value) return ''
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) return value
  return value.startsWith('/') ? origin + value : value
}

function normalizeApproval(v: unknown): ToolApproval {
  return v === 'off' || v === 'destructive' || v === 'all' ? v : 'destructive'
}

function mapAgent(raw: any, origin: string): CloudAgent {
  const toolIds = Array.isArray(raw.tool_skill_ids)
    ? raw.tool_skill_ids.map((x: unknown) => String(x)).filter((x: string) => BUILTIN_TOOL_IDS.has(x))
    : []
  return {
    id: Number(raw.id),
    name: String(raw.name || ''),
    description: String(raw.description || ''),
    avatar: resolveUrl(raw.avatar, origin),
    avatar_thumb: resolveUrl(raw.avatar_thumb, origin),
    system_prompt: String(raw.system_prompt || ''),
    tool_skill_ids: toolIds,
    tool_approval: normalizeApproval(raw.tool_approval),
    enable_image_gen: raw.enable_image_gen ? 1 : 0,
    enable_deck: raw.enable_deck ? 1 : 0,
    tags: Array.isArray(raw.tags) ? raw.tags.map((t: unknown) => String(t)) : [],
    category_id: raw.category_id != null && Number(raw.category_id) > 0 ? Number(raw.category_id) : null,
    category_name: String(raw.category_name || ''),
    download_count: Number(raw.download_count || 0),
    rating_avg: Number(raw.rating_avg || 0),
    rating_count: Number(raw.rating_count || 0),
    author_nickname: String(raw.author_nickname || ''),
    price: Number(raw.price || 0),
    price_balance_type: raw.price_balance_type === 'token' ? 'token' : 'credit',
    is_owned: !!raw.is_owned,
    cloud_kb_ids: Array.isArray(raw.cloud_kb_ids)
      ? raw.cloud_kb_ids.map((x: unknown) => Number(x)).filter((n: number) => n > 0)
      : [],
    cloud_kb_only: raw.cloud_kb_only ? 1 : 0,
    cloud_kb_top_k: Number(raw.cloud_kb_top_k || 5),
    template_schema_version: Number(raw.template_schema_version || 1),
    template_version: Number(raw.template_version || 1),
    role_profile: raw.role_profile && typeof raw.role_profile === 'object' && !Array.isArray(raw.role_profile) ? raw.role_profile : {},
    workflow_templates: Array.isArray(raw.workflow_templates) ? raw.workflow_templates : [],
    acceptance_templates: Array.isArray(raw.acceptance_templates) ? raw.acceptance_templates : [],
    recommended_skill_dirs: Array.isArray(raw.recommended_skill_dirs) ? raw.recommended_skill_dirs.map(String) : [],
    connector_requirements: Array.isArray(raw.connector_requirements) ? raw.connector_requirements.map(String) : [],
    created_at: raw.created_at || undefined,
  }
}

export async function fetchMarketAgents(options?: {
  page?: number
  pageSize?: number
  search?: string
  categoryId?: number
}): Promise<{ items: CloudAgent[]; total: number; page: number; pageSize: number }> {
  const apiBase = getCloudApiBase()
  const page = options?.page || 1
  const pageSize = options?.pageSize || 24
  if (!apiBase) return { items: [], total: 0, page, pageSize }
  const origin = originOf(apiBase)
  const params = new URLSearchParams({ page: String(page), per_page: String(pageSize) })
  if (options?.search) params.set('search', options.search)
  if (options?.categoryId && options.categoryId > 0) params.set('category_id', String(options.categoryId))
  const url = `${apiBase}/public/agents?${params.toString()}`
  let json: any
  try {
    json = await fetchJson(url)
  } catch (e) {
    // 远端可能尚未部署智能体市场接口：404 静默降级为空列表，其它错误抛给前端
    if (isNotFound(e)) return { items: [], total: 0, page, pageSize }
    throw e
  }
  const items: any[] = json.items || []
  return {
    items: items.map((it) => mapAgent(it, origin)),
    total: Number(json.total || items.length || 0),
    page,
    pageSize,
  }
}

/** 市场可见分类列表（免登录；远端未部署该接口时静默降级为空，UI 不显示分类行） */
export async function fetchMarketCategories(): Promise<MarketCategory[]> {
  const apiBase = getCloudApiBase()
  if (!apiBase) return []
  try {
    const json = await fetchJson(`${apiBase}/public/agents/categories`)
    const list: any[] = Array.isArray(json?.data) ? json.data : []
    return list
      .map((c: any) => ({
        id: Number(c?.id) || 0,
        name: String(c?.name || ''),
        description: c?.description ? String(c.description) : undefined,
        sort_order: c?.sort_order != null ? Number(c.sort_order) : undefined,
      }))
      .filter((c: MarketCategory) => c.id > 0 && c.name)
  } catch (e) {
    if (isNotFound(e)) return []
    throw e
  }
}

export async function fetchMarketAgent(id: number): Promise<CloudAgent> {
  const apiBase = getCloudApiBase()
  if (!apiBase) throw new Error('云控端未配置')
  const origin = originOf(apiBase)
  const json = await fetchJson(`${apiBase}/public/agents/${id}`)
  return mapAgent(json, origin)
}

export interface AcquireResult {
  ok: boolean
  alreadyOwned?: boolean
  needLogin?: boolean
  needRecharge?: boolean
  forbidden?: boolean
  price?: number
  balanceType?: 'token' | 'credit'
  needed?: number
  current?: number
  error?: string
  // 购买成功后服务端下发的完整数据（含收费智能体购买前隐藏的 system_prompt）
  agent?: any
}

/**
 * 购买/获取智能体（保存到本地前调用）：校验可见性 + 扣费。
 * - 未登录：needLogin
 * - 无权限（受限且不在白名单）：forbidden
 * - 余额不足：needRecharge + needed/current/balanceType
 * - 成功 / 已拥有：ok
 */
export async function acquireAgent(id: number): Promise<AcquireResult> {
  const apiBase = getCloudApiBase()
  if (!apiBase) return { ok: false, error: '云控端未配置' }
  if (!getCloudToken()) return { ok: false, needLogin: true }
  try {
    const res = await fetchWithCloudAuth(
      `${apiBase}/client/agents/${id}/acquire`,
      { method: 'POST' },
      '智能体购买 401',
    )
    const data: any = await res.json().catch(() => ({}))
    if (res.ok) {
      return {
        ok: true,
        alreadyOwned: !!data.already_owned,
        price: Number(data.price) || 0,
        balanceType: data.balance_type === 'token' ? 'token' : 'credit',
        agent: data.agent || null,
      }
    }
    if (res.status === 401) return { ok: false, needLogin: true }
    if (res.status === 403) return { ok: false, forbidden: true, error: data.message || '无权获取该智能体' }
    if (res.status === 402) {
      return {
        ok: false,
        needRecharge: true,
        needed: Number(data.needed) || 0,
        current: Number(data.current) || 0,
        balanceType: data.balance_type === 'token' ? 'token' : 'credit',
        error: data.error || '余额不足',
      }
    }
    return { ok: false, error: data.message || data.error || `请求失败(${res.status})` }
  } catch (e: any) {
    return { ok: false, error: e?.message || '购买失败' }
  }
}

export interface ImportAgentResult {
  ok: boolean
  bot?: Bot
  alreadyExists?: boolean
  updateAvailable?: boolean
  upgraded?: boolean
  // 购买相关失败态（透传给渲染层做引导）
  needLogin?: boolean
  needRecharge?: boolean
  forbidden?: boolean
  needed?: number
  current?: number
  balanceType?: 'token' | 'credit'
  error?: string
}

/**
 * 从市场「保存到本地」：先购买/获取（可见性 + 扣费）→ 建人格（承载 system_prompt）→ 建本地 bot（绑 6 工具）→ 下载形象图落盘。
 * 已保存过（cloud_agent_id 命中）则直接返回现有 bot，不重复创建、不再扣费。
 */
export async function importAgentAsLocal(cloudAgentInput: CloudAgent, applyUpgrade = false): Promise<ImportAgentResult> {
  try {
    const cloud = cloudAgentInput
    if (!cloud || !cloud.id) return { ok: false, error: '市场智能体数据无效' }

    const existing = getBotByCloudAgentId(cloud.id)

    // 购买/获取校验（可见性 + 扣费）。成功后才建本地 bot；服务端记录拥有，删本地后重存不重复扣费。
    const acq = await acquireAgent(cloud.id)
    if (!acq.ok) {
      return {
        ok: false,
        needLogin: acq.needLogin,
        needRecharge: acq.needRecharge,
        forbidden: acq.forbidden,
        needed: acq.needed,
        current: acq.current,
        balanceType: acq.balanceType,
        error: acq.error,
      }
    }

    // 购买后服务端下发完整数据（含收费智能体购买前在公开接口被隐藏的 system_prompt），回退到列表数据
    const full: any = acq.agent || {}
    const name = String(full.name || cloud.name || '未命名智能体')
    const description = String(full.description ?? cloud.description ?? '')
    const systemPrompt = String(full.system_prompt ?? cloud.system_prompt ?? '').trim()
    const toolApproval = normalizeApproval(full.tool_approval ?? cloud.tool_approval)
    const enableImageGen = (full.enable_image_gen ?? cloud.enable_image_gen) ? 1 : 0
    // 透传云端 AI PPT 能力位: 否则市场来源的 PPT 类智能体落本地后 enable_deck 恒为 0, deck 工具集不注入
    const enableDeck = (full.enable_deck ?? cloud.enable_deck) ? 1 : 0
    const avatarUrl = String(full.avatar || cloud.avatar || '')
    const rawToolIds: string[] = Array.isArray(full.tool_skill_ids) && full.tool_skill_ids.length
      ? full.tool_skill_ids.map((x: unknown) => String(x))
      : (cloud.tool_skill_ids || [])

    // 系统提示词经「人格」承载（决定行为）
    let personaId: string | null = null
    if (systemPrompt) {
      const persona = createPersona({ name: name || '市场智能体', system_prompt: systemPrompt })
      personaId = persona.id
    }

    const toolIds = rawToolIds.filter((x) => BUILTIN_TOOL_IDS.has(x))

    // 云端知识库绑定（acquire 下发；权限随智能体授权传递，对话时在线检索）
    const cloudKbIds: number[] = Array.isArray(full.cloud_kb_ids) && full.cloud_kb_ids.length
      ? full.cloud_kb_ids.map((x: unknown) => Number(x)).filter((n: number) => n > 0)
      : (cloud.cloud_kb_ids || [])
    const cloudKbOnly = (full.cloud_kb_only ?? cloud.cloud_kb_only) ? 1 : 0
    const cloudKbTopK = Number(full.cloud_kb_top_k ?? cloud.cloud_kb_top_k ?? 5) || 5
    const templateVersion = Number(full.template_version ?? cloud.template_version ?? 1) || 1
    const roleProfile = full.role_profile && typeof full.role_profile === 'object' && !Array.isArray(full.role_profile)
      ? full.role_profile
      : (cloud.role_profile || {})
    const workflowTemplates = Array.isArray(full.workflow_templates) ? full.workflow_templates : (cloud.workflow_templates || [])
    const acceptanceTemplates = Array.isArray(full.acceptance_templates) ? full.acceptance_templates : (cloud.acceptance_templates || [])
    const recommendedSkillDirs = Array.isArray(full.recommended_skill_dirs)
      ? full.recommended_skill_dirs.map(String)
      : (cloud.recommended_skill_dirs || [])
    const connectorRequirements = Array.isArray(full.connector_requirements)
      ? full.connector_requirements.map(String)
      : (cloud.connector_requirements || [])
    // 推荐能力不是自动授权：只绑定本机已经安装且启用的 Skill。
    const installedSkillDirs = new Set(listPromptSkills().filter((skill) => skill.enabled).map((skill) => skill.dirName))
    const promptSkillDirs = recommendedSkillDirs.filter((dir) => installedSkillDirs.has(dir))

    if (existing) {
      if (templateVersion <= existing.cloud_template_version) return { ok: true, bot: existing, alreadyExists: true }
      if (!applyUpgrade) return { ok: true, bot: existing, alreadyExists: true, updateAvailable: true }
      const profile: any = roleProfile
      for (const text of Array.isArray(profile.responsibilities) ? profile.responsibilities : []) {
        createEmployeeCandidate({ botId: existing.id, type: 'responsibility', scope: 'employee', title: `模板更新：${String(text).slice(0, 40)}`, body: { content: String(text) }, evidence: { cloud_agent_id: cloud.id, template_version: templateVersion } })
      }
      for (const text of Array.isArray(profile.boundaries) ? profile.boundaries : []) {
        createEmployeeCandidate({ botId: existing.id, type: 'boundary', scope: 'employee', title: `模板更新：${String(text).slice(0, 40)}`, body: { content: String(text) }, evidence: { cloud_agent_id: cloud.id, template_version: templateVersion } })
      }
      for (const item of workflowTemplates.slice(0, 50)) {
        if (item?.title && item?.content) createEmployeeCandidate({ botId: existing.id, type: 'workflow', scope: 'employee', title: String(item.title), body: { content: String(item.content) }, evidence: { cloud_agent_id: cloud.id, template_version: templateVersion } })
      }
      for (const item of acceptanceTemplates.slice(0, 50)) {
        if (item?.title && item?.content) createEmployeeCandidate({ botId: existing.id, type: 'acceptance', scope: 'employee', title: String(item.title), body: { content: String(item.content) }, evidence: { cloud_agent_id: cloud.id, template_version: templateVersion } })
      }
      const updated = updateBot(existing.id, {
        cloud_template_version: templateVersion,
        cloud_template_snapshot: { template_schema_version: Number(full.template_schema_version ?? cloud.template_schema_version ?? 1) || 1, template_version: templateVersion, role_profile: roleProfile, workflow_templates: workflowTemplates, acceptance_templates: acceptanceTemplates, recommended_skill_dirs: recommendedSkillDirs, connector_requirements: connectorRequirements }
      })
      return { ok: true, bot: updated || existing, alreadyExists: true, upgraded: true }
    }

    const bot = createBot({
      name,
      description,
      persona_id: personaId || undefined,
      skill_ids: toolIds,
      tool_approval: toolApproval,
      enable_image_gen: enableImageGen,
      enable_deck: enableDeck,
      cloud_kb_ids: cloudKbIds,
      cloud_kb_only: cloudKbOnly,
      cloud_kb_top_k: cloudKbTopK,
      source: 'market',
      cloud_agent_id: cloud.id,
      prompt_skill_dirs: promptSkillDirs,
      skill_selection_mode: 'selected',
      cloud_template_version: templateVersion,
      cloud_template_snapshot: {
        template_schema_version: Number(full.template_schema_version ?? cloud.template_schema_version ?? 1) || 1,
        template_version: templateVersion,
        role_profile: roleProfile,
        workflow_templates: workflowTemplates,
        acceptance_templates: acceptanceTemplates,
        recommended_skill_dirs: recommendedSkillDirs,
        connector_requirements: connectorRequirements
      },
    })

    upsertEmployeeProfile(bot.id, roleProfile as any)
    for (const item of workflowTemplates.slice(0, 50)) {
      if (!item?.title || !item?.content) continue
      saveEmployeeAsset({ botId: bot.id, assetType: 'workflow', title: String(item.title), body: { content: String(item.content) }, sourceType: 'template', sourceRef: `${cloud.id}@${templateVersion}`, changeSummary: '安装云端岗位模板' })
    }
    for (const item of acceptanceTemplates.slice(0, 50)) {
      if (!item?.title || !item?.content) continue
      saveEmployeeAsset({ botId: bot.id, assetType: 'acceptance', title: String(item.title), body: { content: String(item.content) }, sourceType: 'template', sourceRef: `${cloud.id}@${templateVersion}`, changeSummary: '安装云端岗位模板' })
    }

    // 形象图下载落盘（失败降级：bot 仍可用，卡片回退首字母）
    if (avatarUrl) {
      try {
        const localPath = await downloadAvatarFromUrl(avatarUrl)
        if (localPath) updateBot(bot.id, { avatar: localPath })
      } catch {
        /* ignore download failure */
      }
    }

    return { ok: true, bot: getBot(bot.id) || bot, alreadyExists: false }
  } catch (e: any) {
    return { ok: false, error: e?.message || '保存到本地失败' }
  }
}
