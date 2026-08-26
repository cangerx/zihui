import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useChatStore } from './chat'

// window.api 是固定类型，未含 clawbot，统一用 any 桥接（与 ewei 一致）。
const clawbot = () => (window as any).api.clawbot

export type ClawbotConnectionStatus = 'offline' | 'connecting' | 'online' | 'paused' | 'expired'

export interface ClawbotConnectionSummary {
  id: string
  ilink_bot_id: string
  ilink_user_id: string
  bot_id: string
  enabled: boolean
  status: ClawbotConnectionStatus
  paused_until: string
  last_error: string
  has_token: boolean
  created_at: string
  updated_at: string
}

export type ClawbotLoginPhase = 'idle' | 'qr_ready' | 'scaned' | 'need_verifycode' | 'confirmed' | 'error'

export interface ClawbotLoginState {
  phase: ClawbotLoginPhase
  qrcodeUrl?: string
  message?: string
}

export interface ClawbotState {
  connection: ClawbotConnectionSummary | null
  running: boolean
  login: ClawbotLoginState
  todaySent: number
  dailyLimit: number
  peerCount: number
}

export interface ClawbotPeerSummary {
  id: string
  peer_id: string
  conversation_id: string
  conversation_title: string
  last_message_at: string
}

export interface ClawbotLog {
  id: string
  connection_id: string
  peer_id: string
  direction: string
  msg_type: string
  summary: string
  status: string
  error: string
  created_at: string
}

export interface ClawbotApprovalPolicy {
  allowWorkspaceWrite: boolean
  allowWorkspaceRead: boolean
  allowOutsideRead: boolean
  allowBuiltinUtils: boolean
  allowMcp: boolean
  allowRunCommand: boolean
}

const LOG_PAGE_SIZE = 50

export const useClawbotStore = defineStore('clawbot', () => {
  const state = ref<ClawbotState | null>(null)
  const peers = ref<ClawbotPeerSummary[]>([])
  const logs = ref<ClawbotLog[]>([])
  const logsExhausted = ref(false)
  const policy = ref<ClawbotApprovalPolicy | null>(null)
  const busy = ref(false)

  // App 级常驻监听幂等标志（照 chat.ts initStreamListener 模式：只装一次，永不随组件卸载退订）
  let listenerReady = false

  async function refreshState(): Promise<void> {
    state.value = (await clawbot().invoke('getState')) as ClawbotState
  }

  async function refreshPeers(): Promise<void> {
    peers.value = (await clawbot().invoke('listPeers')) as ClawbotPeerSummary[]
  }

  async function refreshLogs(): Promise<void> {
    logs.value = (await clawbot().invoke('listLogs')) as ClawbotLog[]
    logsExhausted.value = logs.value.length < LOG_PAGE_SIZE
  }

  async function loadMoreLogs(): Promise<void> {
    if (logsExhausted.value || logs.value.length === 0) return
    const beforeId = logs.value[logs.value.length - 1].id
    const more = (await clawbot().invoke('listLogs', beforeId, LOG_PAGE_SIZE)) as ClawbotLog[]
    logs.value = [...logs.value, ...more]
    logsExhausted.value = more.length < LOG_PAGE_SIZE
  }

  async function refreshPolicy(): Promise<void> {
    policy.value = (await clawbot().invoke('getApprovalPolicy')) as ClawbotApprovalPolicy
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([refreshState(), refreshPeers(), refreshLogs(), refreshPolicy()])
  }

  /**
   * App 级常驻监听（幂等，永不退订）：
   * - clawbot:status：连接/登录状态机推进直接覆盖 state
   * - clawbot:peerMessage：一轮微信对话完成 → 对话页联动刷新（当前会话则重拉消息）+ 会话列表刷新
   */
  function initClawbotListeners(): void {
    if (listenerReady) return
    const api = clawbot()
    if (!api?.onStatus || !api?.onPeerMessage) {
      console.warn('[clawbot] preload API 未就绪，跳过监听（请重启应用）')
      return
    }
    listenerReady = true
    api.onStatus((s: ClawbotState) => {
      state.value = s
    })
    api.onPeerMessage((payload: { connectionId: string; peerId: string; conversationId: string; summary: string }) => {
      try {
        const chatStore = useChatStore()
        if (chatStore.currentConversationId === payload.conversationId) {
          void chatStore.selectConversation(payload.conversationId)
        }
        if (chatStore.currentBotId) {
          void chatStore.fetchConversations(chatStore.currentBotId)
        }
      } catch (e) {
        console.error('[clawbot] peer message refresh failed:', e)
      }
      void refreshState()
      void refreshPeers()
    })
  }

  // ===== 登录 =====

  async function startLogin(): Promise<void> {
    await clawbot().invoke('startLogin')
  }

  async function cancelLogin(): Promise<void> {
    await clawbot().invoke('cancelLogin')
  }

  async function submitVerifyCode(code: string): Promise<void> {
    await clawbot().invoke('submitVerifyCode', code)
  }

  async function logout(): Promise<void> {
    busy.value = true
    try {
      await clawbot().invoke('logout')
      await refreshState()
    } finally {
      busy.value = false
    }
  }

  // ===== 绑定 =====

  async function bindBot(botId: string): Promise<void> {
    await clawbot().invoke('bindBot', botId)
    await refreshState()
  }

  async function createDefaultBot(): Promise<{ botId: string; created: boolean }> {
    const result = (await clawbot().invoke('createDefaultBot')) as { botId: string; created: boolean }
    await refreshState()
    return result
  }

  // ===== 开关与管理 =====

  async function setEnabled(enabled: boolean): Promise<void> {
    await clawbot().invoke('setEnabled', enabled)
    await refreshState()
  }

  async function resetPeerConversation(peerRowId: string): Promise<void> {
    await clawbot().invoke('resetPeerConversation', peerRowId)
    await refreshPeers()
  }

  async function setApprovalPolicy(patch: Partial<ClawbotApprovalPolicy>): Promise<void> {
    policy.value = (await clawbot().invoke('setApprovalPolicy', patch)) as ClawbotApprovalPolicy
  }

  return {
    state,
    peers,
    logs,
    logsExhausted,
    policy,
    busy,
    refreshState,
    refreshPeers,
    refreshLogs,
    loadMoreLogs,
    refreshPolicy,
    refreshAll,
    initClawbotListeners,
    startLogin,
    cancelLogin,
    submitVerifyCode,
    logout,
    bindBot,
    createDefaultBot,
    setEnabled,
    resetPeerConversation,
    setApprovalPolicy
  }
})
