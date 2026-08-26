import { getBot, type Bot } from './bot'

/** 未绑定智能体（或智能体无人设）时注入的身份说明。工具用法仍由 chat-engine 其它段落提供。 */
export const DEFAULT_CHAT_SYSTEM_PROMPT = [
  '你是用户本机上的 AI 工作助手。默认用中文，少客套，先做再解释。',
  '',
  '- 需要读写文件、查资料、操作浏览器时，直接调用工具完成，不要只给步骤',
  '- 默认只在当前工作区文件夹内操作，不改用户没提到的路径',
  '- 不确定就用选项卡问清楚；不要编造文件、数据和结论',
  '- 长回答先给结论，再补必要说明'
].join('\n')

const DEFAULT_BOT_ID = ''

export function getDefaultChatBot(): Bot {
  return {
    id: DEFAULT_BOT_ID,
    name: '默认助手',
    description: '',
    model_provider_id: null,
    model_id: '',
    persona_id: null,
    kb_only: 0,
    kb_category_ids: [],
    cloud_kb_ids: [],
    cloud_kb_only: 0,
    cloud_kb_top_k: 5,
    skill_ids: [],
    mcp_ids: [],
    prompt_skill_dirs: [],
    skill_selection_mode: 'selected',
    default_workspace_id: '',
    tool_approval: 'destructive',
    enable_image_gen: 1,
    enable_deck: 0,
    max_tool_rounds: 0,
    avatar: '',
    source: 'local',
    cloud_agent_id: 0,
    cloud_template_version: 0,
    cloud_template_snapshot: {},
    submission_status: '',
    submission_reject_reason: '',
    submission_reviewed_at: '',
    submission_synced_at: '',
    created_at: '',
    updated_at: ''
  }
}

/** 会话未绑智能体、或智能体已删除时，回退到内置默认助手。 */
export function resolveChatBot(botId?: string | null): Bot {
  const id = String(botId || '')
  if (id) {
    const bot = getBot(id)
    if (bot) return bot
  }
  return getDefaultChatBot()
}
