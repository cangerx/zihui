import { existsSync, readFileSync } from 'fs'
import { extname } from 'path'
import { fetchWithCloudAuth, getCloudApiBase, getCloudToken, cloudErrorText } from './cloud-token'
import { getBot, setBotSubmissionState } from './bot'
import { getPersona } from './persona'
import { makeUploadThumbnailBlob } from './thumbnail-upload'
import { assertNoSensitiveContent, getEmployeeProfile, listEmployeeAssets } from './digital-employee'

const BUILTIN_TOOL_IDS = new Set([
  'builtin_current_time',
  'builtin_calculator',
  'builtin_fetch_webpage',
  'builtin_json_tool',
  'builtin_text_tool',
  'builtin_random_generator',
])

export interface AgentSubmitResult {
  ok: boolean
  error?: string
  data?: any
}

export interface AgentSyncResult {
  ok: boolean
  error?: string
  items?: any[]
}

function loadAvatarBlob(path: string): { blob: Blob; filename: string; buf: Buffer } | null {
  if (!path || !existsSync(path)) return null
  const raw = extname(path).slice(1).toLowerCase()
  const ext = raw === 'jpeg' ? 'jpg' : raw
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
  const buf = readFileSync(path)
  return { blob: new Blob([new Uint8Array(buf)], { type: mime }), filename: `avatar.${ext}`, buf }
}

/** 把本地 bot 发布（投稿）到智能体市场 */
export async function submitAgentToMarket(localBotId: string): Promise<AgentSubmitResult> {
  const token = getCloudToken()
  if (!token) return { ok: false, error: '未登录云控账号，无法发布' }

  const bot = getBot(localBotId)
  if (!bot) return { ok: false, error: '智能体不存在或已被删除' }
  if (!bot.name.trim()) return { ok: false, error: '智能体名称不能为空' }
  if (!bot.avatar) return { ok: false, error: '请先为该智能体设置 2:3 形象图后再发布' }

  const avatar = loadAvatarBlob(bot.avatar)
  if (!avatar) return { ok: false, error: '形象图文件丢失，请重新设置后再发布' }

  // 系统提示词来自绑定的人格
  const systemPrompt = bot.persona_id ? (getPersona(bot.persona_id)?.system_prompt || '') : ''
  // 工具只保留跨机器固定可用的 6 个内置小工具
  const toolIds = (bot.skill_ids || []).filter((id) => BUILTIN_TOOL_IDS.has(id))
  const roleProfile = getEmployeeProfile(bot.id)
  const assets = listEmployeeAssets(bot.id, bot.default_workspace_id || '')
  const templateBody = (asset: typeof assets[number]) => ({
    title: asset.title,
    ...(asset.current_version?.body || {})
  })
  const workflowTemplates = assets.filter((asset) => asset.asset_type === 'workflow').map(templateBody)
  const acceptanceTemplates = assets.filter((asset) => asset.asset_type === 'acceptance').map(templateBody)
  const recommendedSkillDirs = bot.prompt_skill_dirs || []
  try {
    assertNoSensitiveContent({ systemPrompt, roleProfile, workflowTemplates, acceptanceTemplates, recommendedSkillDirs })
  } catch {
    return { ok: false, error: '岗位模板疑似包含 API Key、Token、密码或私钥，请移除后再发布' }
  }

  const fd = new FormData()
  fd.append('local_agent_id', bot.id)
  fd.append('name', bot.name.trim())
  fd.append('description', bot.description || '')
  fd.append('system_prompt', systemPrompt)
  fd.append('tool_skill_ids', JSON.stringify(toolIds))
  fd.append('tool_approval', bot.tool_approval || 'destructive')
  fd.append('enable_image_gen', bot.enable_image_gen ? '1' : '0')
  fd.append('role_profile', JSON.stringify(roleProfile ? {
    role_summary: roleProfile.role_summary,
    responsibilities: roleProfile.responsibilities,
    boundaries: roleProfile.boundaries,
    standard_inputs: roleProfile.standard_inputs,
    deliverables: roleProfile.deliverables,
    advanced_instructions: roleProfile.advanced_instructions
  } : {}))
  fd.append('workflow_templates', JSON.stringify(workflowTemplates))
  fd.append('acceptance_templates', JSON.stringify(acceptanceTemplates))
  fd.append('recommended_skill_dirs', JSON.stringify(recommendedSkillDirs))
  fd.append('avatar', avatar.blob, avatar.filename)
  // 附带形象图缩略图（市场网格用），失败则跳过、云端回退原图
  const avatarThumb = makeUploadThumbnailBlob(avatar.buf, 512)
  if (avatarThumb) {
    fd.append('avatar_thumb', avatarThumb.blob, avatarThumb.filename)
  }

  const url = `${getCloudApiBase()}/client/agents/submit`
  let resp: Response
  try {
    resp = await fetchWithCloudAuth(url, { method: 'POST', body: fd }, '智能体投稿 401')
  } catch (e: any) {
    return { ok: false, error: '网络请求失败：' + (e?.message || '未知错误') }
  }

  let json: any = null
  try { json = await resp.json() } catch { /* ignore */ }

  if (resp.status === 401) return { ok: false, error: '登录已过期，请重新登录' }
  if (resp.status === 409) {
    setBotSubmissionState(bot.id, {
      cloudAgentId: Number(json?.cloud_agent_id || 0),
      status: String(json?.submission_status || 'pending'),
      rejectReason: '',
      reviewedAt: '',
    })
    return { ok: false, error: '该智能体已发布，请等待审核或刷新状态', data: json }
  }
  if (resp.status === 422) {
    const details = json?.details
    if (details && typeof details === 'object') {
      const firstKey = Object.keys(details)[0]
      const firstMsg = Array.isArray(details[firstKey]) ? details[firstKey][0] : ''
      return { ok: false, error: firstMsg || '参数校验失败' }
    }
    return { ok: false, error: '参数校验失败' }
  }
  if (!resp.ok) return { ok: false, error: cloudErrorText(resp.status, json, '请求失败') }

  setBotSubmissionState(bot.id, {
    cloudAgentId: Number(json?.cloud_agent_id || 0),
    status: String(json?.submission_status || 'pending'),
    rejectReason: '',
    reviewedAt: '',
  })
  return { ok: true, data: json }
}

/** 轮询本地投稿过的 bot 的审核态 */
export async function syncAgentSubmissionStatus(localBotIds: string[]): Promise<AgentSyncResult> {
  const token = getCloudToken()
  if (!token) return { ok: false, error: '未登录云控账号' }
  const ids = Array.from(new Set(localBotIds.map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 100)
  if (!ids.length) return { ok: true, items: [] }

  const url = `${getCloudApiBase()}/client/agents/status-batch`
  let resp: Response
  try {
    resp = await fetchWithCloudAuth(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }, '智能体投稿状态 401')
  } catch (e: any) {
    return { ok: false, error: '网络请求失败：' + (e?.message || '未知错误') }
  }

  let json: any = null
  try { json = await resp.json() } catch { /* ignore */ }
  if (!resp.ok) return { ok: false, error: cloudErrorText(resp.status, json, '请求失败') }

  const items = Array.isArray(json?.items) ? json.items : []
  for (const item of items) {
    const localId = String(item?.local_agent_id || '')
    if (!localId) continue
    setBotSubmissionState(localId, {
      cloudAgentId: Number(item?.cloud_agent_id || 0),
      status: String(item?.submission_status || ''),
      rejectReason: String(item?.reject_reason || ''),
      reviewedAt: String(item?.reviewed_at || ''),
    })
  }
  return { ok: true, items }
}

/** 撤回投稿 */
export async function withdrawAgentSubmission(localBotId: string): Promise<AgentSubmitResult> {
  const token = getCloudToken()
  if (!token) return { ok: false, error: '未登录云控账号' }
  const bot = getBot(localBotId)
  if (!bot) return { ok: false, error: '智能体不存在或已被删除' }

  const url = `${getCloudApiBase()}/client/agents/${encodeURIComponent(bot.id)}/submit`
  let resp: Response
  try {
    resp = await fetchWithCloudAuth(url, { method: 'DELETE' }, '智能体撤回 401')
  } catch (e: any) {
    return { ok: false, error: '网络请求失败：' + (e?.message || '未知错误') }
  }

  let json: any = null
  try { json = await resp.json() } catch { /* ignore */ }
  if (!resp.ok) return { ok: false, error: cloudErrorText(resp.status, json, '请求失败') }

  setBotSubmissionState(bot.id, { status: 'withdrawn', rejectReason: '', reviewedAt: '' })
  return { ok: true, data: json }
}

/** 对市场智能体评分（需登录） */
export async function rateAgent(cloudAgentId: number, score: number, comment?: string): Promise<AgentSubmitResult> {
  const token = getCloudToken()
  if (!token) return { ok: false, error: '请先登录云控账号后再评分' }
  if (!cloudAgentId) return { ok: false, error: '该智能体不是市场来源，无法评分' }
  const s = Math.max(1, Math.min(5, Math.round(Number(score) || 0)))

  const url = `${getCloudApiBase()}/client/agents/${cloudAgentId}/rate`
  let resp: Response
  try {
    resp = await fetchWithCloudAuth(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: s, comment: comment || '' }),
    }, '智能体评分 401')
  } catch (e: any) {
    return { ok: false, error: '网络请求失败：' + (e?.message || '未知错误') }
  }

  let json: any = null
  try { json = await resp.json() } catch { /* ignore */ }
  if (resp.status === 401) return { ok: false, error: '登录已过期，请重新登录' }
  if (!resp.ok) return { ok: false, error: cloudErrorText(resp.status, json, '请求失败') }
  return { ok: true, data: json }
}
