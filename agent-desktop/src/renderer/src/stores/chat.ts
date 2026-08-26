import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { translateError } from '@/utils/error-message'
import { useCloudAuthStore } from '@/stores/cloud-auth'

/** IPC / 乐观气泡用：去掉 Vue Proxy，避免 structuredClone 失败 */
function plainClone<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T
}

// 工具执行心跳行前缀（带尾部空格）：onStream 据此原地更新「执行中 Ns」而非追加堆积
const HEARTBEAT_PREFIX = '  工具执行中… '

// 「继续生成」相关：与主进程 chat-engine 的中断/报错尾标正则保持一致
const INTERRUPT_TAIL_RES: RegExp[] = [
  /\n*\[已中断\]\s*$/,
  /\n*\[上一轮已被新消息中断\]\s*$/,
  /(?:^|\n)\[Error\][\s\S]*$/
]

/** 判断一条 assistant 回复是否处于「可继续」状态（末尾带中断/报错标记）。 */
export function isContinuable(content: unknown): boolean {
  if (typeof content !== 'string' || !content) return false
  return INTERRUPT_TAIL_RES.some((re) => re.test(content))
}

/** 去掉中断/报错尾标，仅保留已产出的半截正文（与主进程逻辑一致）。 */
function stripInterruptionMarker(content: string): string {
  let s = content
  for (const re of INTERRUPT_TAIL_RES) s = s.replace(re, '')
  return s.trimEnd()
}

export interface Conversation {
  id: string
  bot_id: string
  title: string
  // 「智能体不再绑定模型」改造（v0.6.5+）：每个会话独立持久记忆当前模型
  // 新建时填入云控端默认（site-config.chat_default_model）；用户切换 → updateConversationModel
  active_model_provider_id: string
  active_model_id: string
  // v0.6.6+ 「对话内生图模型独立选择」：会话级记忆生图服务商/模型。
  // 输入框左下角「生图：」切换器写回；chat-engine 调 image_gen 时作为 LLM args 默认值。
  active_image_provider_id: string
  active_image_model_id: string
  /** 会话级工具审批；空 = 继承智能体 */
  tool_approval?: string
  /** D-20：关联品牌工作区；空 = 普通会话 */
  brand_workspace_id?: string
  /** 数字员工执行目录；创建后固定，用户可在任务级显式切换 */
  workspace_id?: string
  created_at: string
  updated_at: string
}

/** 对话内交互卡片选项。 */
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

/**
 * 对话内交互卡片（ask_user 通用询问 / image_params 生图参数确认卡）。
 * 与主进程 conversation.ts 的 MessageCard 镜像，仅 UI 用。
 */
export interface MessageCard {
  type: 'ask_user' | 'image_params'
  request_id: string
  status: 'pending' | 'answered' | 'expired' | 'canceled'
  /** ask_user：问题列表（单题也是 1 元素），按分步向导渲染 */
  questions?: MessageCardQuestion[]
  /** ask_user：用户答案，按 question id 索引 */
  answers?: Record<string, { selected: string[]; free_text?: string }>
  /** image_params：卡片标题文案 */
  question?: string
  /** image_params：预填默认值 */
  defaults?: Record<string, any>
  /** image_params：用户确认的结构化结果 */
  result?: Record<string, any>
}

export interface Message {
  id: string
  conversation_id: string
  role: string
  content: string
  attachments: any[]
  tool_calls: any[]
  /** DB 持久化的思维链(加载后注入 _reasoning 渲染;不回传模型) */
  reasoning?: string
  /** 交互卡片（ask_user / image_params）；null/缺省 = 普通消息。 */
  card?: MessageCard | null
  created_at: string
  /** 发送失败标记（仅本地渲染态：主进程前置校验失败时保留的乐观气泡），不入库 */
  failed?: boolean
  _toolLogs?: string[]
  _toolActive?: boolean
  _collapsed?: boolean
  // 推理模型思维链（仅本会话内存态，不入库；刷新后丢失属预期）
  _reasoning?: string
  _reasoningActive?: boolean
  _reasoningCollapsed?: boolean
}

/**
 * 对话输入草稿（per-conversation）。会话级维护，重启 app 后丢失，
 * 切换对话 不丢，切走页面 不丢。
 */
export interface ChatDraft {
  inputText: string
  attachments: any[]
  tempKbIds: string[]
  tempSkillIds: string[]
  tempMcpIds: string[]
  tempPromptSkillDirs: string[]
}

/**
 * 进行中的流式回复状态（per-conversation）。
 * 提升为 store 级持久态：切走会话 / 切走页面再回来仍可继续逐字渲染。
 * 由 app 级常驻 onStream 监听更新，sendMessage 在 IPC resolve（本轮落库）后删除。
 */
export interface StreamingState {
  requestId: string
  content: string
  reasoning: string
  reasoningActive: boolean
  /** 本轮思考开始时间，用于「深度思考中 Xs」 */
  reasoningStartedAt?: number
  toolLogs: string[]
  toolActive: boolean
  collapsed: boolean
  /** token 合批缓冲：SSE delta 先进缓冲，30ms 定时合入 content（避免每 token 触发整列表重渲染） */
  pendingContent?: string
  /** 僵尸恢复标记：渲染端 reload 后重建的流式态（requestId 未知，事件匹配放宽） */
  resumed?: boolean
}

/**
 * 工具审批请求（与主进程 chat:toolApproval / listPendingApprovals 载荷镜像）。
 * 提升为 store 级、按 conversation_id 索引：app 级常驻监听更新，
 * 切走会话/页面再回来仍可恢复（配合主进程 listPendingApprovals 补投），不再因 ChatView 卸载丢失。
 */
export interface ApprovalRequest {
  request_id: string
  conversation_id: string
  tool: string
  args: any
  preview?: any
}

function emptyChatDraft(): ChatDraft {
  return {
    inputText: '',
    attachments: [],
    tempKbIds: [],
    tempSkillIds: [],
    tempMcpIds: [],
    tempPromptSkillDirs: [],
  }
}

export const useChatStore = defineStore('chat', () => {
  const conversations = ref<Conversation[]>([])
  const messages = ref<Message[]>([])
  const currentConversationId = ref<string | null>(null)
  const currentBotId = ref<string | null>(null)
  const streamingConvIds = ref<Set<string>>(new Set())
  /** sendMessage 入口到挂上 streaming 之间的短锁，防止 Enter 连按双发 */
  const sendingConvIds = ref<Set<string>>(new Set())
  const activeRequestIds = ref<Record<string, string>>({})
  const canceledRequestIds = ref<Set<string>>(new Set())
  const streamContent = ref('')
  /** 会话级草稿 Map：切走页面 / 切换对话不丢。重启 app 后重置。 */
  const drafts = ref<Record<string, ChatDraft>>({})
  /** 进行中的流式回复（per-conversation）。切走会话/页面再回来不丢，本轮完成后删除。 */
  const streamingStates = ref<Record<string, StreamingState>>({})
  /** 待审批的工具调用（per-conversation）。app 级常驻监听更新，切走/回来不丢。 */
  const pendingApprovals = ref<Record<string, ApprovalRequest>>({})
  /** 已请求取消、等待主进程确认收尾的会话（「中断中」过渡态：不乐观解锁，防新旧轮并发） */
  const cancellingConvIds = ref<Set<string>>(new Set())
  /** token 合批定时器（per-conversation） */
  const contentFlushTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** app 级常驻流式监听只装一次的幂等标志（store 单例，setup 仅执行一次）。 */
  let streamListenerReady = false
  /** app 级常驻审批监听只装一次的幂等标志。 */
  let approvalListenerReady = false

  /** 立即把合批缓冲合入 content（状态切换/收尾前必须调用，防丢尾部 token） */
  function flushContentNow(convId: string): void {
    const t = contentFlushTimers.get(convId)
    if (t) {
      clearTimeout(t)
      contentFlushTimers.delete(convId)
    }
    const st = streamingStates.value[convId]
    if (st?.pendingContent) {
      st.content += st.pendingContent
      st.pendingContent = ''
    }
  }

  /** 30ms 合批：SSE delta 先攒入缓冲，定时合入 content（每 token 一次重渲染 → 每批一次） */
  function scheduleContentFlush(convId: string): void {
    if (contentFlushTimers.has(convId)) return
    const t = setTimeout(() => {
      contentFlushTimers.delete(convId)
      const st = streamingStates.value[convId]
      if (!st) return
      if (st.pendingContent) {
        st.content += st.pendingContent
        st.pendingContent = ''
      }
      if (currentConversationId.value === convId) streamContent.value = st.content
    }, 30)
    contentFlushTimers.set(convId, t)
  }

  const streaming = computed(() => {
    const id = currentConversationId.value
    if (!id) return false
    return streamingConvIds.value.has(id) || sendingConvIds.value.has(id)
  })

  const currentConversation = computed(() =>
    conversations.value.find((c) => c.id === currentConversationId.value) || null
  )

  function refreshCloudBalances() {
    useCloudAuthStore().refreshBalancesThrottled().catch(() => {})
  }

  function createRequestId(convId: string): string {
    return `chat-${convId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  // 把 DB 持久化的 reasoning 注入 _reasoning(渲染态)，默认折叠。仅当 _reasoning 尚未设置时。
  function hydrateReasoning(msgs: Message[]): Message[] {
    for (const m of msgs) {
      if (m.role === 'assistant' && m.reasoning && !m._reasoning) {
        m._reasoning = m.reasoning
        m._reasoningCollapsed = true
        m._reasoningActive = false
      }
    }
    return msgs
  }

  async function fetchConversations(botId: string) {
    currentBotId.value = botId || ''
    conversations.value = (await window.api.chat.invoke('listConversations', botId || '')) as Conversation[]
  }

  async function createConversation(
    botId: string,
    title?: string,
    initialModel?: { provider_id: string; model_id: string },
    initialImageModel?: { provider_id: string; model_id: string },
    initialWorkspaceId?: string
  ) {
    // IPC 只能传结构化克隆数据：必须拆成纯对象，禁止直接传 Vue reactive proxy
    const model = initialModel?.model_id
      ? { provider_id: String(initialModel.provider_id || ''), model_id: String(initialModel.model_id || '') }
      : undefined
    const imageModel = initialImageModel?.model_id
      ? { provider_id: String(initialImageModel.provider_id || ''), model_id: String(initialImageModel.model_id || '') }
      : undefined
    const result = (await window.api.chat.invoke(
      'createConversation',
      botId || '',
      title,
      model,
      imageModel,
      initialWorkspaceId || ''
    )) as Conversation
    currentBotId.value = botId || ''
    conversations.value.unshift(result)
    return result
  }

  /**
   * 切换会话使用的模型（输入框左下角下拉触发）。
   * 写回主进程 + 同步更新本地 conversations 缓存中的对应会话字段，
   * 让 ChatModelSwitcher 显示立即跟随，无需重拉列表。
   */
  async function updateConversationModel(
    conversationId: string,
    provider_id: string,
    model_id: string
  ) {
    await window.api.chat.invoke('updateConversationModel', conversationId, provider_id, model_id)
    const conv = conversations.value.find((c) => c.id === conversationId)
    if (conv) {
      conv.active_model_provider_id = provider_id || ''
      conv.active_model_id = model_id || ''
    }
  }

  /**
   * 切换会话使用的生图模型（输入框左下角「生图：」切换器触发）。
   * 同 updateConversationModel：写回主进程 + 同步本地缓存，让切换器显示立即跟随。
   */
  async function updateConversationImageModel(
    conversationId: string,
    provider_id: string,
    model_id: string
  ) {
    await window.api.chat.invoke('updateConversationImageModel', conversationId, provider_id, model_id)
    const conv = conversations.value.find((c) => c.id === conversationId)
    if (conv) {
      conv.active_image_provider_id = provider_id || ''
      conv.active_image_model_id = model_id || ''
    }
  }

  async function updateConversationToolApproval(conversationId: string, tool_approval: string) {
    await window.api.chat.invoke('updateConversationToolApproval', conversationId, tool_approval)
    const conv = conversations.value.find((c) => c.id === conversationId)
    if (conv) {
      conv.tool_approval = tool_approval || ''
    }
  }

  async function updateConversationWorkspace(conversationId: string, workspaceId: string) {
    const updated = await window.api.chat.invoke('updateConversationWorkspace', conversationId, workspaceId) as Conversation
    const conv = conversations.value.find((c) => c.id === conversationId)
    if (conv) conv.workspace_id = updated.workspace_id || ''
    return updated
  }

  async function selectConversation(id: string) {
    const known = conversations.value.find((c) => c.id === id)
    currentConversationId.value = id
    messages.value = hydrateReasoning((await window.api.chat.invoke('getMessages', id)) as Message[])
    if (known) {
      currentBotId.value = known.bot_id || ''
    } else {
      const conv = (await window.api.chat.invoke('getConversation', id).catch(() => null)) as
        | Conversation
        | null
      if (conv) {
        currentBotId.value = conv.bot_id || ''
        if (!conversations.value.some((c) => c.id === id)) conversations.value.unshift(conv)
      }
    }
    // 补投该会话仍挂起的工具审批（切走/重进时卡片可能丢失，靠主进程权威状态恢复）
    void refetchPendingApprovals(id)
  }

  async function deleteConversation(id: string) {
    await window.api.chat.invoke('deleteConversation', id)
    conversations.value = conversations.value.filter((c) => c.id !== id)
    if (currentConversationId.value === id) {
      currentConversationId.value = null
      messages.value = []
    }
    // 同步清理该对话的草稿（避免微小的内存泄露）
    if (drafts.value[id]) {
      const next = { ...drafts.value }
      delete next[id]
      drafts.value = next
    }
    // 同步清理进行中的流式态
    if (streamingStates.value[id]) {
      const next = { ...streamingStates.value }
      delete next[id]
      streamingStates.value = next
    }
    // 同步清理挂起的审批卡
    if (pendingApprovals.value[id]) {
      const next = { ...pendingApprovals.value }
      delete next[id]
      pendingApprovals.value = next
    }
  }

  /**
   * 读取某对话的草稿。不存在时实时创建空草稿并写回 map，调用方可直接 mutate 返回值。
   */
  function getDraft(convId: string): ChatDraft {
    if (!drafts.value[convId]) {
      drafts.value[convId] = emptyChatDraft()
    }
    return drafts.value[convId]
  }

  /** 批量设置草稿字段。适用于从 view 本地 ref 同步回 store 的场景。 */
  function setDraft(convId: string, patch: Partial<ChatDraft>): void {
    if (!drafts.value[convId]) drafts.value[convId] = emptyChatDraft()
    Object.assign(drafts.value[convId], patch)
  }

  /** 清除某对话的草稿。其他场景（如 send 后手动重置）可能需要。 */
  function clearDraft(convId: string): void {
    if (drafts.value[convId]) {
      const next = { ...drafts.value }
      delete next[convId]
      drafts.value = next
    }
  }

  async function updateTitle(id: string, title: string) {
    await window.api.chat.invoke('updateTitle', id, title)
    const conv = conversations.value.find((c) => c.id === id)
    if (conv) conv.title = title
  }

  /** app 级标题更新监听只装一次 */
  let titleListenerReady = false

  function listenTitleUpdates() {
    if (titleListenerReady) return
    titleListenerReady = true
    window.api.chat.onTitleUpdated((data: any) => {
      const conv = conversations.value.find((c) => c.id === data.conversationId)
      if (conv) conv.title = data.title
    })
  }

  function stopListenTitleUpdates() {
    // 标题监听改为 app 级常驻，不在页面卸载时退订（避免侧栏标题停更）
  }

  /**
   * 监听 image_gen fire-and-forget 完成事件：主进程后台跑完 generateImages 后
   * 发出 chat:appendMessage，此处接收后把消息追加到 messages.value。
   *
   * 仅当 currentConversationId 匹配时追加；切走的会话不影响（消息已写入 DB，下次 selectConversation 会拉到）。
   * 同时也要清理 streaming 状态：图片到达意味着这一轮工具任务完成，
   * 清理 streamingConvIds 让对话气泡的"工具调用进行中"折叠面板复位。
   */
  function listenAppendMessage() {
    window.api.chat.onAppendMessage((data: any) => {
      if (!data?.conversationId || !data?.message) return
      if (data.requestId && canceledRequestIds.value.has(data.requestId)) return
      // 当前正在显示这个 conversation → 立刻追加；否则 DB 已写入，切回时 fetch 即可
      if (currentConversationId.value === data.conversationId) {
        const messageId = data.message.id
        if (!messageId || !messages.value.some((m) => m.id === messageId)) {
          messages.value.push(data.message)
        }
      }
      refreshCloudBalances()
    })
  }

  function stopListenAppendMessage() {
    window.api.chat.offAppendMessage()
  }

  /**
   * 监听 chat:updateMessage：交互卡片（ask_user / 生图参数卡）状态变化时主进程发出，
   * 用 message 覆盖 messages.value 中的同 id 项（仅当 currentConversationId 匹配）。
   * 整体替换数组以确保 Vue 响应式更新；保留前端内存态字段（_reasoning 等）。
   */
  function listenUpdateMessage() {
    window.api.chat.onUpdateMessage((data: any) => {
      if (!data?.conversationId || !data?.message) return
      if (currentConversationId.value !== data.conversationId) return
      const idx = messages.value.findIndex((m) => m.id === data.message.id)
      if (idx === -1) return
      const next = [...messages.value]
      next[idx] = { ...next[idx], ...data.message }
      messages.value = next
    })
  }

  function stopListenUpdateMessage() {
    window.api.chat.offUpdateMessage()
  }

  /** image_gen 等工具 tool_start 的日志行（与旧逻辑保持一致）。 */
  function buildToolStartLogs(tools: unknown): string[] {
    const list = (tools as string[]) || []
    if (!list.length) return []
    const logs: string[] = []
    const others = list.filter((t) => t !== 'image_gen')
    if (list.includes('image_gen')) {
      logs.push('> 提交生图任务…（约 30-90 秒后图片会自动出现在对话和右上角）')
    }
    if (others.length) logs.push(`> calling: ${others.join(', ')}`)
    return logs
  }

  function getStreamingState(convId: string): StreamingState | undefined {
    return streamingStates.value[convId]
  }

  /**
   * App 级常驻流式监听：只装一次，永不随组件卸载退订。
   * 按 conversationId 路由到 streamingStates，使「切走会话/页面再回来」仍能继续逐字渲染。
   * - requestId 不匹配的旧流自动忽略（同会话连发时旧轮被覆盖）。
   * - 取消后仅放行 aborted（与旧逻辑一致）。
   * - 'done' 不在此处理：清理统一在 sendMessage 的 IPC resolve 之后做。
   */
  function initStreamListener() {
    if (streamListenerReady) return
    streamListenerReady = true
    window.api.chat.onStream((data: any) => {
      const convId = data?.conversationId
      if (!convId) return
      const st = streamingStates.value[convId]
      if (!st) return
      // 僵尸恢复态（requestId 未知）放行所有事件；正常态严格按 requestId 匹配
      if (data.requestId && st.requestId && st.requestId !== data.requestId) return
      if (canceledRequestIds.value.has(st.requestId) && data.type !== 'aborted' && data.type !== 'round_done') return

      switch (data.type) {
        case 'content':
          // 首个正文 token 到达 = 思考阶段结束，折叠思维链面板
          if (st.reasoningActive) st.reasoningActive = false
          // 合批：先攒缓冲，30ms 定时合入（每 token 一次整列表重渲染 → 每批一次）
          st.pendingContent = (st.pendingContent || '') + (data.content || '')
          scheduleContentFlush(convId)
          break
        case 'reasoning':
          st.reasoning += data.content || ''
          st.reasoningActive = true
          if (!st.reasoningStartedAt) st.reasoningStartedAt = Date.now()
          break
        case 'tool_start':
          flushContentNow(convId)
          st.content = ''
          if (st.reasoningActive) st.reasoningActive = false
          st.toolActive = true
          st.collapsed = false
          st.toolLogs.push(...buildToolStartLogs(data.tools))
          break
        case 'tool_heartbeat': {
          // 「执行中 Ns」原地更新最后一行（带 HEARTBEAT_PREFIX 标记），不堆积刷屏
          if (!st.toolActive) break
          const secs = Math.max(1, Math.round((data.elapsedMs || 0) / 1000))
          const line = `${HEARTBEAT_PREFIX}${secs}s`
          const logs = st.toolLogs
          if (logs.length && logs[logs.length - 1].startsWith(HEARTBEAT_PREFIX)) {
            logs[logs.length - 1] = line
          } else {
            logs.push(line)
          }
          break
        }
        case 'tool_result':
          // 工具有结果回来：先撤掉尾部心跳占位行，再追加结果
          if (st.toolLogs.length && st.toolLogs[st.toolLogs.length - 1].startsWith(HEARTBEAT_PREFIX)) {
            st.toolLogs.pop()
          }
          st.toolLogs.push(`  ${data.tool}: ${data.summary || 'done'}`)
          break
        case 'tool_done':
          if (st.toolLogs.length && st.toolLogs[st.toolLogs.length - 1].startsWith(HEARTBEAT_PREFIX)) {
            st.toolLogs.pop()
          }
          flushContentNow(convId)
          st.content = ''
          break
        case 'aborted': {
          flushContentNow(convId)
          if (st.reasoningActive) st.reasoningActive = false
          const marker = data.content || '[\u5df2\u4e2d\u65ad]'
          st.content = st.content ? `${st.content}\n\n${marker}` : marker
          break
        }
        case 'error': {
          flushContentNow(convId)
          if (st.reasoningActive) st.reasoningActive = false
          const errLine = `[Error] ${translateError(data.error)}`
          st.content = st.content ? `${st.content}\n\n${errLine}` : errLine
          break
        }
        case 'round_done': {
          // 轮次真正结束：仅「渲染端无活跃 IPC」的僵尸恢复场景由它收尾
          //（正常路径的清理在 runStreamedRequest 的 IPC resolve 后做）
          if (!activeRequestIds.value[convId]) {
            flushContentNow(convId)
            if (currentConversationId.value === convId) {
              void window.api.chat.invoke('getMessages', convId).then((rows: any) => {
                if (currentConversationId.value === convId && Array.isArray(rows)) {
                  messages.value = hydrateReasoning(rows as Message[])
                }
              }).catch(() => {})
            }
            delete streamingStates.value[convId]
            streamingConvIds.value.delete(convId)
            streamingConvIds.value = new Set(streamingConvIds.value)
            cancellingConvIds.value.delete(convId)
            cancellingConvIds.value = new Set(cancellingConvIds.value)
            refreshCloudBalances()
          }
          break
        }
      }
      // 当前停在该会话时镜像给 streamContent（content 分支由合批 flush 自行镜像，此处跳过）
      if (data.type !== 'content' && currentConversationId.value === convId) streamContent.value = st.content
    })
  }

  /**
   * App 级常驻审批监听：只装一次，永不随组件卸载退订（对照 initStreamListener）。
   * - chat:toolApproval 到达 → 按 conversation_id 写入 pendingApprovals（不同会话互不覆盖）。
   * - chat:toolApprovalResolved（主进程超时/中止）→ 清掉对应会话的卡片，避免残留无法操作的浮层。
   */
  function initApprovalListener() {
    if (approvalListenerReady) return
    approvalListenerReady = true
    window.api.chat.onToolApproval((data: any) => {
      const convId = data?.conversation_id
      if (!convId) return
      pendingApprovals.value = { ...pendingApprovals.value, [convId]: data as ApprovalRequest }
    })
    window.api.chat.onToolApprovalResolved((data: any) => {
      const convId = data?.conversation_id
      if (!convId) return
      const cur = pendingApprovals.value[convId]
      // 仅当 request_id 匹配才清，避免误清同会话的下一张卡
      if (cur && (!data.request_id || cur.request_id === data.request_id)) {
        const next = { ...pendingApprovals.value }
        delete next[convId]
        pendingApprovals.value = next
      }
    })
  }

  function getPendingApproval(convId: string | null): ApprovalRequest | null {
    if (!convId) return null
    return pendingApprovals.value[convId] || null
  }

  /** 回应审批：先乐观清掉本地卡片（UI 立即恢复），再回传主进程 resolve 挂起的工具执行。 */
  async function respondApproval(requestId: string, approved: boolean) {
    for (const [cid, ap] of Object.entries(pendingApprovals.value)) {
      if (ap.request_id === requestId) {
        const next = { ...pendingApprovals.value }
        delete next[cid]
        pendingApprovals.value = next
        break
      }
    }
    await window.api.chat.invoke('respondToolApproval', requestId, approved)
  }

  /** 重新进入会话时补投仍挂起的审批（卡片在切走期间可能未送达/被覆盖，靠主进程权威状态恢复）。 */
  async function refetchPendingApprovals(convId: string) {
    if (!convId) return
    try {
      const list = (await window.api.chat.invoke('listPendingApprovals', convId)) as ApprovalRequest[]
      if (Array.isArray(list) && list.length > 0) {
        // 主进程审批门串行，单会话至多一张挂起卡，取最后一张即可
        pendingApprovals.value = { ...pendingApprovals.value, [convId]: list[list.length - 1] }
      } else if (pendingApprovals.value[convId]) {
        // 主进程已无挂起项（已超时/中止）：清掉本地残留
        const next = { ...pendingApprovals.value }
        delete next[convId]
        pendingApprovals.value = next
      }
    } catch {
      /* 拉取失败不致命 */
    }
  }

  // 统一的流式请求执行器:管理 per-conversation 流式态、调用主进程、结束后与 DB seamless swap。
  // 被 sendMessage / regenerate / editMessage 复用(invoke 回调决定具体调用哪个 IPC)。
  async function runStreamedRequest(
    convId: string,
    invoke: (requestId: string) => Promise<any>,
    startedAt?: string
  ) {
    const requestId = createRequestId(convId)
    // startedAt 由调用方在乐观气泡 push 之前捕获传入（否则跨毫秒边界时本轮气泡会被误判为旧消息）
    const startedAtTs = startedAt || new Date().toISOString()
    const previousRequestId = activeRequestIds.value[convId]
    if (previousRequestId && previousRequestId !== requestId) {
      canceledRequestIds.value.add(previousRequestId)
      canceledRequestIds.value = new Set(canceledRequestIds.value)
    }
    activeRequestIds.value = { ...activeRequestIds.value, [convId]: requestId }
    canceledRequestIds.value.delete(requestId)
    streamingConvIds.value.add(convId)
    streamingConvIds.value = new Set(streamingConvIds.value)
    streamContent.value = ''

    // 进行中的流式态提升为 store 级（per-conversation），由 app 级常驻 onStream 监听更新。
    streamingStates.value[convId] = {
      requestId,
      content: '',
      reasoning: '',
      reasoningActive: false,
      toolLogs: [],
      toolActive: true,
      collapsed: false,
    }

    let invokeErrorMsg = ''
    try {
      await invoke(requestId)
    } catch (err: any) {
      // 主进程通常已 catch 并把 error/aborted 落库；此处仅兜底 IPC 通道级失败。
      invokeErrorMsg = translateError(err?.message || '')
      const st = streamingStates.value[convId]
      if (st) st.content = st.content ? `${st.content}\n\n[Error] ${invokeErrorMsg}` : `[Error] ${invokeErrorMsg}`
    } finally {
      const isLatestRequest = activeRequestIds.value[convId] === requestId
      if (isLatestRequest) {
        flushContentNow(convId)
        const st = streamingStates.value[convId]
        const localContent = st?.content || ''
        const localReasoning = st?.reasoning || ''

        // 仅当仍停留在该会话时，从 DB 拉真实消息并与 live 气泡做 seamless swap。
        if (currentConversationId.value === convId) {
          try {
            const dbMessages = hydrateReasoning((await window.api.chat.invoke('getMessages', convId)) as Message[])
            if (dbMessages.length > 0) {
              const lastDb = dbMessages[dbMessages.length - 1]
              if (lastDb.role === 'assistant' && !lastDb.content && !lastDb.card && localContent) {
                lastDb.content = localContent
              }
              if (lastDb.role === 'assistant' && lastDb.content?.startsWith('[Error]')) {
                lastDb.content = `[Error] ${translateError(lastDb.content.slice(8))}`
              }
              // 思维链不入库：把本轮累积 reasoning 贴回最后一条 assistant（切走再回来才会消失）
              if (lastDb.role === 'assistant' && localReasoning) {
                lastDb._reasoning = localReasoning
                lastDb._reasoningCollapsed = true
                lastDb._reasoningActive = false
              }
            }
            // 兜底：IPC 级失败（含主进程前置校验失败）导致本轮无任何新落库时——
            // 保留用户消息（标发送失败）+ 补错误气泡，避免消息与错误双静默。
            // 旧条件「末条非 assistant 或无 content」在有历史的会话中恒不成立（末条必为旧 assistant）。
            const lastDb = dbMessages[dbMessages.length - 1]
            const lastIsFreshAssistant = !!lastDb && lastDb.role === 'assistant' && lastDb.created_at >= startedAtTs
            if (invokeErrorMsg && !lastIsFreshAssistant) {
              // 主进程前置校验失败时用户消息从未落库：把乐观气泡补回并标失败
              const pendingLocal = messages.value.filter((m) => m.id.startsWith('temp-user-') && m.created_at >= startedAtTs)
              for (const m of pendingLocal) {
                if (!dbMessages.some((d) => d.role === 'user' && d.content === m.content && d.created_at >= startedAtTs)) {
                  dbMessages.push({ ...m, failed: true } as Message)
                }
              }
              dbMessages.push({
                id: 'temp-error-' + Date.now(),
                conversation_id: convId,
                role: 'assistant',
                content: `[Error] ${invokeErrorMsg}`,
                attachments: [],
                tool_calls: [],
                created_at: new Date().toISOString()
              })
            }
            // await 期间用户可能已切走：二次确认仍在该会话才覆盖 messages，避免覆盖别的会话
            if (currentConversationId.value === convId) {
              messages.value = dbMessages
            }
          } catch {
            // 拉取失败不致命：下次 selectConversation 会重新从 DB 拉
          }
        }

        // 清理流式态（始终执行，避免卡在 streaming 状态；live 气泡随之消失，已被真实消息替换）
        delete streamingStates.value[convId]
        const next = { ...activeRequestIds.value }
        delete next[convId]
        activeRequestIds.value = next
        streamingConvIds.value.delete(convId)
        streamingConvIds.value = new Set(streamingConvIds.value)
        cancellingConvIds.value.delete(convId)
        cancellingConvIds.value = new Set(cancellingConvIds.value)
        refreshCloudBalances()
      }
    }
  }

  async function sendMessage(content: string, attachments?: any[], overrides?: {
    kbCategoryIds?: string[]
    skillIds?: string[]
    mcpIds?: string[]
    promptSkillDirs?: string[]
    extraSystemPrompt?: string
  }) {
    if (!currentConversationId.value) {
      throw new Error('当前没有对话，请先开始对话')
    }

    const convId = currentConversationId.value!
    // 以会话记录上的 bot_id 为准（可为空 = 默认助手）；currentBotId 仅作缓存
    const known = conversations.value.find((c) => c.id === convId)
    const botId = known ? (known.bot_id || '') : (currentBotId.value || '')
    currentBotId.value = botId

    if (streamingConvIds.value.has(convId) || sendingConvIds.value.has(convId)) {
      throw new Error('当前仍有回复在进行中，请稍候或先点停止')
    }

    sendingConvIds.value.add(convId)
    sendingConvIds.value = new Set(sendingConvIds.value)

    // 乐观插入用户消息（主进程也会立即落库；切走切回靠 getMessages 拿回）
    // startedAt 在 push 之前捕获并传入执行器：失败兜底按它判定「本轮新落库」，
    // 若在执行器内捕获，跨毫秒边界时本轮乐观气泡会被误判为旧消息而丢失
    const startedAt = new Date().toISOString()
    messages.value.push({
      id: 'temp-user-' + Date.now(),
      conversation_id: convId,
      role: 'user',
      content,
      attachments: attachments || [],
      tool_calls: [],
      created_at: new Date().toISOString()
    })

    try {
      await runStreamedRequest(convId, (requestId) =>
        window.api.chat.invoke('sendMessage', plainClone({
          conversationId: convId,
          requestId,
          botId,
          content,
          attachments: attachments || undefined,
          // 四类 override 都按「undefined=未指定走 bot 默认 / 空数组=本轮明确不用」对称下发，
          // 避免 length 守卫把用户清空意图静默回填为 bot 默认（与 MCP 对齐）
          ...(overrides?.kbCategoryIds !== undefined ? { overrideKbCategoryIds: overrides.kbCategoryIds } : {}),
          ...(overrides?.skillIds !== undefined ? { overrideSkillIds: overrides.skillIds } : {}),
          ...(overrides?.mcpIds !== undefined ? { overrideMcpIds: overrides.mcpIds } : {}),
          ...(overrides?.promptSkillDirs !== undefined ? { overridePromptSkillDirs: overrides.promptSkillDirs } : {}),
          ...(overrides?.extraSystemPrompt ? { extraSystemPrompt: overrides.extraSystemPrompt } : {})
        }))
      , startedAt)
    } finally {
      sendingConvIds.value.delete(convId)
      sendingConvIds.value = new Set(sendingConvIds.value)
    }
  }

  // 重新生成最后一轮回复(删除最后一条 user 及其后消息，用相同内容重发)
  async function regenerate() {
    const convId = currentConversationId.value
    if (!convId || streamingConvIds.value.has(convId)) return
    // 乐观:移除本地最后一条 user 之后的旧回答(保留到该 user 含)，立即反映"重新生成";完成后由 DB seamless swap
    const list = messages.value
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === 'user') {
        messages.value = list.slice(0, i + 1)
        break
      }
    }
    await runStreamedRequest(convId, (requestId) =>
      window.api.chat.invoke('regenerate', convId, requestId)
    )
  }

  // 从中断处继续生成:保留已产出的半截回答，让模型接着写(不丢弃已生成内容、省 completion token)
  async function continueGenerate() {
    const convId = currentConversationId.value
    if (!convId || streamingConvIds.value.has(convId)) return
    // 乐观:去掉最后一条 assistant 的中断/报错标记，立即反映"继续中"；完成后由 DB seamless swap
    const list = messages.value
    const last = list[list.length - 1]
    if (last && last.role === 'assistant' && typeof last.content === 'string') {
      const stripped = stripInterruptionMarker(last.content)
      messages.value = [...list.slice(0, -1), { ...last, content: stripped }]
    }
    await runStreamedRequest(convId, (requestId) =>
      window.api.chat.invoke('continue', convId, requestId)
    )
  }

  // 编辑某条用户消息并重发(删除该消息及其后消息，用新内容重发)
  async function editMessage(messageId: string, newContent: string) {
    const convId = currentConversationId.value
    if (!convId || streamingConvIds.value.has(convId)) return
    if (!newContent || !newContent.trim()) return
    // 乐观:截断到该消息之前 + 插入编辑后的 user，立即显示新问题;完成后由 DB seamless swap
    const idx = messages.value.findIndex((m) => m.id === messageId)
    if (idx !== -1) {
      const original = messages.value[idx]
      messages.value = [
        ...messages.value.slice(0, idx),
        { ...original, id: 'temp-user-' + Date.now(), content: newContent }
      ]
    }
    await runStreamedRequest(convId, (requestId) =>
      window.api.chat.invoke('editMessage', convId, messageId, newContent, requestId)
    )
  }

  // 删除单条消息
  async function deleteMessage(messageId: string) {
    await window.api.chat.invoke('deleteMessage', messageId)
    messages.value = messages.value.filter((m) => m.id !== messageId)
  }

  /** 切换智能体时清列表/当前会话，但保留后台流式态（避免打断进行中的回复） */
  function resetConversationView() {
    conversations.value = []
    messages.value = []
    currentConversationId.value = null
    currentBotId.value = null
    streamContent.value = ''
  }

  /**
   * 进入空态新对话：不立刻写库，会话在发出第一条消息时由 ChatView.sendFromEmpty 创建。
   * 避免侧栏堆满空的「新对话」，也让问候空态真正出现。
   */
  const newChatSeq = ref(0)
  function startNewChat() {
    currentConversationId.value = null
    messages.value = []
    streamContent.value = ''
    newChatSeq.value += 1
  }

  function reset() {
    resetConversationView()
    streamingConvIds.value = new Set()
    sendingConvIds.value = new Set()
    activeRequestIds.value = {}
    canceledRequestIds.value = new Set()
    drafts.value = {}
    streamingStates.value = {}
    pendingApprovals.value = {}
    cancellingConvIds.value = new Set()
  }

  function isConversationStreaming(convId: string): boolean {
    return streamingConvIds.value.has(convId)
  }

  function isRequestCanceled(requestId?: string): boolean {
    return !!requestId && canceledRequestIds.value.has(requestId)
  }

  /**
   * 取消：进入「中断中」过渡态——不再乐观立即解锁。
   * 乐观解锁的前提是「abort 毫秒级生效」，但工具执行阶段（沙箱命令等）abort 有延迟，
   * 立即解锁会让用户在新轮与未收尾的旧轮并发写同一会话。改为标记 cancelling，
   * 待主进程轮次真正结束（IPC resolve → runStreamedRequest finally / round_done）再清理。
   */
  async function cancel(convId?: string) {
    const id = convId || currentConversationId.value
    if (!id) return false
    const requestId = activeRequestIds.value[id]
    if (requestId) {
      canceledRequestIds.value.add(requestId)
      canceledRequestIds.value = new Set(canceledRequestIds.value)
    }
    if (streamingConvIds.value.has(id) && !cancellingConvIds.value.has(id)) {
      cancellingConvIds.value.add(id)
      cancellingConvIds.value = new Set(cancellingConvIds.value)
    }
    return (await window.api.chat.invoke('cancel', id, requestId)) as boolean
  }

  /** 「中断中」过渡态查询（ChatView 据此把停止按钮变为禁用态文案） */
  function isCancelling(convId?: string): boolean {
    const id = convId || currentConversationId.value
    return !!id && cancellingConvIds.value.has(id)
  }

  /**
   * 僵尸轮次恢复：渲染端 reload/托盘重开后 pinia 清零，主进程轮次可能仍在跑。
   * 选中会话时调用：命中主进程活跃轮次则重建流式态（续接后续流事件 + 恢复停止按钮），
   * 轮末由 round_done 事件收尾重拉。
   */
  async function resumeStreamingIfActive(convId: string): Promise<void> {
    if (!convId || streamingConvIds.value.has(convId)) return
    try {
      const active = await window.api.chat.invoke('isActive', convId)
      if (!active) return
      streamingStates.value[convId] = {
        requestId: '',
        content: '',
        reasoning: '',
        reasoningActive: false,
        toolLogs: [],
        toolActive: true,
        collapsed: false,
        resumed: true
      }
      streamingConvIds.value.add(convId)
      streamingConvIds.value = new Set(streamingConvIds.value)
    } catch { /* 查询失败忽略 */ }
  }

  return {
    conversations,
    messages,
    currentConversationId,
    currentBotId,
    streaming,
    streamContent,
    isConversationStreaming,
    isRequestCanceled,
    isCancelling,
    resumeStreamingIfActive,
    currentConversation,
    drafts,
    streamingStates,
    getStreamingState,
    initStreamListener,
    pendingApprovals,
    initApprovalListener,
    getPendingApproval,
    respondApproval,
    refetchPendingApprovals,
    fetchConversations,
    newChatSeq,
    startNewChat,
    createConversation,
    updateConversationModel,
    updateConversationImageModel,
    updateConversationToolApproval,
    updateConversationWorkspace,
    selectConversation,
    deleteConversation,
    updateTitle,
    listenTitleUpdates,
    stopListenTitleUpdates,
    listenAppendMessage,
    stopListenAppendMessage,
    listenUpdateMessage,
    stopListenUpdateMessage,
    sendMessage,
    regenerate,
    continueGenerate,
    editMessage,
    deleteMessage,
    cancel,
    getDraft,
    setDraft,
    clearDraft,
    resetConversationView,
    reset
  }
})
