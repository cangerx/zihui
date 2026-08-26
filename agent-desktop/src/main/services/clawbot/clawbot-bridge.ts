// ClawBot 主编排（模块级单例）：
//   启动/停止 → 每连接一个 getupdates 长轮询循环 → 入站消息按微信用户 FIFO 排队 →
//   注入主进程对话引擎（sendMessage window=null 纯后台跑）→ 完成后取回复 → sendmessage 回发。
// 关键纪律（对照开发计划）：
//   - 游标 get_updates_buf 每轮先持久化再处理消息（崩溃最多重放一轮，配合 message_id 去重）
//   - 同会话连发会触发引擎 replaced 打断 → 同一微信用户的消息严格串行
//   - window=null 时工具审批由注入的 approvalDecider 按桥内白名单自动裁决
//   - errcode=-14：暂停 60 分钟自动重试一次，仍失效则置 expired 等用户重扫
//   - 循环体经 runInEpoch 包裹：账号热切换后旧循环读库即抛 AccountSwitchedError 自然死亡

import { BrowserWindow } from 'electron'
import { isAbsolute, join, relative, resolve } from 'path'
import { v4 as uuid } from 'uuid'
import * as api from './ilink-api'
import { ILinkAbortedError } from './ilink-api'
import * as store from './clawbot-store'
import * as login from './clawbot-login'
import type { ClawbotConnection, ClawbotConnectionSummary } from './clawbot-store'
import { processInboundMessage } from './clawbot-inbound'
import { sendOutboundReply, sendImagesOnly, sendPlainText, SendCircuitOpenError, isSendCircuitOpen, type OutboundImage } from './clawbot-outbound'
import { ERRCODE_SESSION_TIMEOUT, MESSAGE_TYPE, TYPING_STATUS } from './ilink-types'
import type { WeixinMessage } from './ilink-types'
import { sendMessage as engineSendMessage, cancelChat as engineCancelChat } from '../chat-engine'
import { createConversation, getConversation, getMessages, updateConversationImageModel } from '../conversation'
import { createBot, getBot, listBots } from '../bot'
import { getCloudApiBase, getCloudModels, getAllowClawbot, refreshCloudToken } from '../cloud-token'
import { getSetting, setSetting } from '../settings'
import { getDataDir } from '../data-path'
import { getDatabase } from '../../database'
import { runInEpoch } from '../account-epoch'
import { onAssistantAppended } from '../events'
import { CLOUD_KEY_SEP } from '@shared/model-id'
import type { Conversation } from '../conversation'
import { notifyDesktop } from '../desktop-notify'
import { IMAGE_PARAM_OPTIONS, imageParamInstruction, imageParamMenu, isImageRequest, parseImageParams } from './clawbot-image-params'

// ===== 运行态 =====

interface Runtime {
  connectionId: string
  abort: AbortController
  /** 按微信用户的 FIFO 队列（同 peer 串行，防引擎 replaced 打断） */
  peerQueues: Map<string, Promise<void>>
  /** 入站去重（message_id），上限 500 条滚动 */
  seenIds: Set<string>
  /** typing_ticket 按用户缓存（TTL 24h） */
  typingTickets: Map<string, { ticket: string; expiresAt: number }>
  /** 桥发起的引擎轮次（conversationId → requestId），stop 时精确取消（不误伤桌面端同会话的轮次） */
  activeRounds: Map<string, string>
  /** 已发送到微信的 assistant 消息 id 集合（按会话）。不用 created_at 水位线：
   *  同一轮内多条消息常共享同一毫秒（conversation.ts 注释确认），> 比较会把同毫秒的后继消息整批跳过 */
  sentIdsByConv: Map<string, Set<string>>
  /** 异步补发 watcher（conversationId → AbortController）：生图等 fire-and-forget 追加消息的补发窗口 */
  replyWatchers: Map<string, AbortController>
  /** 同会话 flush 互斥链（watcher/事件/新轮并发时防同一消息重复发送） */
  flushChains: Map<string, Promise<number>>
  /** 事件驱动 flush 防抖计时器（conversationId → timer）：一轮多条 append 合并成一次 flush */
  flushTimers: Map<string, NodeJS.Timeout>
  /** 消息级投递失败计数（msgId → 连续失败次数）：达上限跳过该条防坏消息堵死队列 */
  flushAttempts: Map<string, number>
  /** 长回复分段断点（msgId → 已送达分段数）：分段途中失败后续发不重发已送达段 */
  flushSegDone: Map<string, number>
  /** 图片级重试态（msgId → 任务）：图失败不再毒化整条消息重发文本 */
  pendingImageRetries: Map<string, { peerId: string; images: OutboundImage[]; attempts: number; lastAttemptAt: number }>
  /** 错误文案冷却（`${peerId}:${kind}` → 上次发送时间戳）：持久态错误不刷屏 */
  errorNotices: Map<string, number>
  /** peer 级 60 秒生图参数选择；首条只发菜单，不进入引擎，因此不会重复计费。 */
  pendingImageParams: Map<string, { content: string; expiresAt: number }>
  /** 桌面「重新登录」通知上次弹出时间（冷却用） */
  lastLoginAlertAt: number
  /** 事件总线退订函数（assistant 落库 → 事件驱动补发） */
  unsubAppend: (() => void) | null
  loopDone: Promise<void> | null
}

export interface ClawbotState {
  connection: ClawbotConnectionSummary | null
  running: boolean
  login: login.ClawbotLoginState
  todaySent: number
  dailyLimit: number
  peerCount: number
}

const SEEN_IDS_CAP = 500
const SESSION_PAUSE_MS = 60 * 60_000
const DEFAULT_DAILY_LIMIT = 450
const DEFAULT_BOT_NAME = '微信助手'
/** 持久态错误（登录失效/余额不足）对同一微信用户的发送冷却：不刷屏，记日志即可 */
const ERROR_NOTICE_COOLDOWN_MS = 30 * 60_000
/** 桌面「重新登录」通知冷却 */
const LOGIN_ALERT_COOLDOWN_MS = 30 * 60_000
/** 单次 flush 最多补发条数（防重启水位恢复后历史积压刷屏；更早的直接放弃） */
const MAX_FLUSH_PER_ROUND = 20
/** 长任务进度文本间隔（typing 之外的真实进度反馈） */
const PROGRESS_NOTICE_INTERVAL_MS = 45_000
/** 图片级重试次数上限，耗尽后降级发文字说明 */
const IMAGE_RETRY_MAX = 3
/** 单条消息投递失败次数上限（跨 flush 累计）：达顶跳过该条，防一条坏消息把队列永久堵死 */
const MAX_MESSAGE_DELIVER_ATTEMPTS = 5
/** 事件驱动 flush 防抖窗口：一轮对话多条 append（工具前言/最终回复/生图完成）合并成一次 flush */
const EVENT_FLUSH_DEBOUNCE_MS = 1500

let runtime: Runtime | null = null

// ===== 通用小件 =====

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolvePromise()
    }, ms)
    ;(timer as any).unref?.()
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new ILinkAbortedError())
    }
    if (signal) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

// ===== 状态广播 =====

export function getClawbotState(): ClawbotState {
  const conn = store.getPrimaryConnectionSummary()
  return {
    connection: conn,
    running: runtime !== null,
    login: login.getLoginState(),
    todaySent: safeCount(() => store.countTodayOutgoing()),
    dailyLimit: getDailyLimit(),
    peerCount: conn ? safeCount(() => store.countPeers(conn.id)) : 0
  }
}

function safeCount(fn: () => number): number {
  try {
    return fn()
  } catch {
    return 0
  }
}

function getDailyLimit(): number {
  const n = Number(getSetting('clawbot_daily_send_limit'))
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_LIMIT
}

/** 全窗口广播（ewei:progress 同款惯例）：关窗到托盘时自然静默 */
function broadcastStatus(): void {
  const payload = getClawbotState()
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('clawbot:status', payload)
    } catch {
      /* 窗口销毁竞态忽略 */
    }
  }
}

function broadcastPeerMessage(payload: { connectionId: string; peerId: string; conversationId: string; summary: string }): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('clawbot:peerMessage', payload)
    } catch {
      /* ignore */
    }
  }
}

// ===== 启动 / 停止 =====

export async function startClawbotBridge(): Promise<void> {
  login.setLoginStateListener(() => broadcastStatus())
  // 使用权限门控（allow_clawbot，默认拒绝）：无权限时桥不启动；菜单显示与此解耦
  if (!getAllowClawbot()) {
    stopClawbotBridge()
    broadcastStatus()
    return
  }
  const conn = store.getPrimaryConnection()
  if (!conn || !conn.enabled || !conn.bot_token_enc) {
    stopClawbotBridge()
    broadcastStatus()
    return
  }
  // expired 终态不自动重起：token 已死，重跑只会再走一轮 -14 暂停循环并重复弹掉线通知，
  // 必须等用户重新扫码（saveLoginResult 会把 status 置回 online）
  if (conn.status === 'expired') {
    broadcastStatus()
    return
  }
  // 幂等：同一连接已在跑直接返回（cloud:setToken 登录回流等重复触发场景）
  if (runtime && runtime.connectionId === conn.id) {
    broadcastStatus()
    return
  }
  stopClawbotBridge()
  const abort = new AbortController()
  const rt: Runtime = {
    connectionId: conn.id,
    abort,
    peerQueues: new Map(),
    seenIds: new Set(),
    typingTickets: new Map(),
    activeRounds: new Map(),
    sentIdsByConv: new Map(),
    replyWatchers: new Map(),
    flushChains: new Map(),
    flushTimers: new Map(),
    flushAttempts: new Map(),
    flushSegDone: new Map(),
    pendingImageRetries: new Map(),
    errorNotices: new Map(),
    pendingImageParams: new Map(),
    lastLoginAlertAt: 0,
    unsubAppend: null,
    loopDone: null
  }
  runtime = rt
  store.setConnectionStatus(conn.id, 'connecting')
  broadcastStatus()
  // 事件驱动补发：core-tools 后台任务（生图等）落库即触发 flush，不再只靠轮询 watcher 猜窗口。
  // 防抖合并：一轮对话会产生多条 append（工具前言/最终回复/生图完成），逐条 flush 会在故障期
  // 放大成「同一卡死消息被反复重试」的风暴（真机 11:34 事故），1.5s 窗口合并成一次。
  rt.unsubAppend = onAssistantAppended((conversationId) => {
    const pending = rt.flushTimers.get(conversationId)
    if (pending) clearTimeout(pending)
    const timer = setTimeout(() => {
      rt.flushTimers.delete(conversationId)
      void (async () => {
        const c = store.getPrimaryConnection()
        if (!c || c.id !== rt.connectionId) return
        const peer = store.getPeerByConversation(c.id, conversationId)
        if (!peer || !peer.last_context_token) return
        let token: string
        try { token = store.resolveBotToken(c) } catch { return }
        await flushLocked(rt, conversationId, async () => {
          const r = await flushNewAssistantMessages(rt, c, token, peer.peer_id, peer.last_context_token, conversationId, peer.id)
          await retryPendingImages(rt, c, token)
          return r.sent
        })
      })().catch((e) => console.error('[clawbot] event-driven flush failed:', e))
    }, EVENT_FLUSH_DEBOUNCE_MS)
    ;(timer as any).unref?.()
    rt.flushTimers.set(conversationId, timer)
  })
  // 循环体进 epoch：账号热切换后旧循环读库抛 AccountSwitchedError 自然死亡
  rt.loopDone = runInEpoch(() => pollLoop(rt))
  rt.loopDone
    .catch((e) => {
      console.error('[clawbot] poll loop exited with error:', e)
    })
    .finally(() => {
      if (runtime === rt) {
        runtime = null
        broadcastStatus()
      }
    })
  // notifyStart 尽力而为
  try {
    const token = store.resolveBotToken(conn)
    void api.notifyStart(conn.baseurl, token)
  } catch {
    /* 凭据异常由轮询循环处理 */
  }
  // 云控默认对话模型缓存刷新（与工作台默认同源；失败保留旧缓存）
  void refreshChatDefaultModel()
}

export function stopClawbotBridge(): void {
  const rt = runtime
  if (!rt) return
  runtime = null
  rt.abort.abort()
  // 退订事件总线（防泄漏/防停止后继续补发）
  if (rt.unsubAppend) { try { rt.unsubAppend() } catch { /* ignore */ } rt.unsubAppend = null }
  // 取消桥发起的在途引擎轮次（精确到 requestId，不误伤桌面端用户在同会话里的轮次）
  for (const [conversationId, requestId] of rt.activeRounds) {
    try {
      engineCancelChat(conversationId, requestId)
    } catch {
      /* ignore */
    }
  }
  rt.activeRounds.clear()
  // 停止全部异步补发 watcher
  for (const ctrl of rt.replyWatchers.values()) ctrl.abort()
  rt.replyWatchers.clear()
  rt.pendingImageRetries.clear()
  // 清理事件防抖计时器（防停止后迟到的 flush 再发消息）
  for (const t of rt.flushTimers.values()) clearTimeout(t)
  rt.flushTimers.clear()
  rt.flushAttempts.clear()
  rt.flushSegDone.clear()
  // connecting/online 是进程级暂态，停止后必须降级，避免 DB 里残留假「在线」
  try {
    const status = store.getConnectionStatus(rt.connectionId)
    if (status === 'connecting' || status === 'online') store.setConnectionStatus(rt.connectionId, 'offline')
  } catch {
    /* 库已关闭等场景忽略 */
  }
  // 通知服务端会话结束（尽力）
  try {
    const conn = store.getPrimaryConnection()
    if (conn && conn.bot_token_enc) {
      const token = store.resolveBotToken(conn)
      void api.notifyStop(conn.baseurl, token)
    }
  } catch {
    /* ignore */
  }
}

// ===== 长轮询循环 =====

async function pollLoop(rt: Runtime): Promise<void> {
  const signal = rt.abort.signal
  let failCount = 0
  let sessionFailCount = 0
  while (!signal.aborted) {
    const conn = store.getPrimaryConnection()
    if (!conn || conn.id !== rt.connectionId || !conn.enabled || !conn.bot_token_enc) break

    // -14 暂停期：每 30s 醒来检查一次
    if (conn.paused_until) {
      const until = Date.parse(conn.paused_until)
      if (Number.isFinite(until) && until > Date.now()) {
        await sleep(30_000, signal).catch(() => {})
        continue
      }
    }

    let token: string
    try {
      token = store.resolveBotToken(conn)
    } catch (e) {
      store.setConnectionStatus(conn.id, 'expired', e instanceof Error ? e.message : String(e))
      broadcastStatus()
      break
    }

    try {
      const resp = await api.getUpdates(conn.baseurl, token, conn.get_updates_buf, signal)
      // 注意：failCount 不在此处清零——HTTP 成功但 body 带业务 errcode 时也走这里，
      // 提前清零会让 errcode 分支的退避永不升级（固定 2s 热循环打服务端 + 状态刷屏）

      // 会话失效：先暂停 60 分钟自动重试，再失效则置 expired 等用户重扫
      if (resp.errcode === ERRCODE_SESSION_TIMEOUT || resp.ret === ERRCODE_SESSION_TIMEOUT) {
        sessionFailCount++
        if (sessionFailCount >= 2) {
          store.setConnectionStatus(conn.id, 'expired', '登录态已失效，请重新扫码绑定')
          notifyDesktop('微信 ClawBot 已掉线', '登录态失效，请打开「微信 ClawBot」页重新扫码绑定')
          broadcastStatus()
          break
        }
        store.updateConnectionFields(conn.id, {
          status: 'paused',
          paused_until: new Date(Date.now() + SESSION_PAUSE_MS).toISOString(),
          last_error: '登录态失效，60 分钟后自动重试'
        })
        broadcastStatus()
        continue
      }
      sessionFailCount = 0

      // 非 -14 的非零 ret/errcode：不是有效响应，按失败退避（否则服务端持续报错时会零退避热循环）
      const errcode = resp.errcode ?? resp.ret ?? 0
      if (errcode !== 0) {
        failCount++
        try {
          store.updateConnectionFields(conn.id, { last_error: `getupdates errcode=${errcode} ${resp.errmsg || ''}`.slice(0, 200) })
        } catch {
          /* ignore */
        }
        if (failCount === 1 || failCount % 10 === 0) broadcastStatus()
        await sleep(failCount <= 2 ? 2000 : 30_000, signal).catch(() => {})
        continue
      }

      // 业务成功（errcode 已确认为 0）：退避计数清零，恢复在线
      failCount = 0
      if (store.getConnectionStatus(conn.id) !== 'online') {
        store.setConnectionStatus(conn.id, 'online')
        broadcastStatus()
      }

      // 先持久化游标再处理消息（防重复消费）。
      // 已知权衡：崩溃/退出窗口内（游标已推进、队列未消化）该批消息会丢失；
      // 反向方案（处理后写游标）会在崩溃时重复消费。iLink 无历史消息 API，
      // 两害相权取「不重复」，与官方「重启靠持久化游标续传」的用法一致。
      const newBuf = resp.get_updates_buf
      if (typeof newBuf === 'string' && newBuf && newBuf !== conn.get_updates_buf) {
        store.updateConnectionFields(conn.id, { get_updates_buf: newBuf })
      }

      for (const msg of resp.msgs || []) {
        enqueueInbound(rt, conn, msg)
      }
    } catch (e) {
      if (e instanceof ILinkAbortedError) {
        if (signal.aborted) break
        continue // 客户端 40s 超时 = 正常空轮
      }
      failCount++
      const message = e instanceof Error ? e.message : String(e)
      try {
        store.updateConnectionFields(conn.id, { last_error: message.slice(0, 200) })
      } catch {
        /* ignore */
      }
      if (failCount === 1 || failCount % 10 === 0) broadcastStatus()
      await sleep(failCount <= 2 ? 2000 : 30_000, signal).catch(() => {})
    }
  }
}

// ===== 入站分发 =====

function enqueueInbound(rt: Runtime, conn: ClawbotConnection, msg: WeixinMessage): void {
  if (msg.message_type !== MESSAGE_TYPE.USER) return
  const peerId = msg.from_user_id || ''
  if (!peerId) return
  if (msg.group_id) {
    store.insertLog({
      connection_id: conn.id,
      peer_id: peerId,
      direction: 'in',
      msg_type: 'system',
      summary: '群聊消息（官方未开放，已忽略）',
      status: 'dropped'
    })
    return
  }
  // message_id 去重（崩溃重放/网络重试兜底）
  const mid = msg.message_id || msg.client_id || ''
  if (mid) {
    if (rt.seenIds.has(mid)) return
    rt.seenIds.add(mid)
    if (rt.seenIds.size > SEEN_IDS_CAP) {
      const oldest = rt.seenIds.values().next().value
      if (oldest !== undefined) rt.seenIds.delete(oldest)
    }
  }
  const peer = store.ensurePeer(conn.id, peerId)
  // context_token 始终用最新入站值（不可复用旧消息的）
  if (msg.context_token) store.updatePeerContextToken(peer.id, msg.context_token)
  store.touchPeerMessageAt(peer.id)

  const prev = rt.peerQueues.get(peerId) || Promise.resolve()
  const next = prev
    .then(() => processOne(rt, conn.id, peerId, msg))
    .catch((e) => console.error('[clawbot] processOne failed:', e))
  rt.peerQueues.set(peerId, next)
  // 队列消化完毕后清理 Map 条目（防长期运行下按 peer 只增不减）
  next.then(() => {
    if (rt.peerQueues.get(peerId) === next) rt.peerQueues.delete(peerId)
  })
}

// ===== 单条处理流水线 =====

async function processOne(rt: Runtime, connectionId: string, peerId: string, msg: WeixinMessage): Promise<void> {
  const conn = store.getPrimaryConnection()
  if (!conn || conn.id !== connectionId) return
  const token = store.resolveBotToken(conn)
  const peer = store.getPeer(connectionId, peerId)
  if (!peer) return
  const contextToken = peer.last_context_token || msg.context_token || ''
  if (!contextToken) {
    store.insertLog({
      connection_id: connectionId,
      peer_id: peerId,
      direction: 'in',
      msg_type: 'system',
      summary: '缺少 context_token，无法关联回复，已丢弃',
      status: 'dropped'
    })
    return
  }

  // 1. 解析入站（下载解密媒体可能抛错）
  let parsed
  try {
    parsed = await processInboundMessage(msg)
  } catch (e) {
    store.insertLog({
      connection_id: connectionId,
      peer_id: peerId,
      direction: 'in',
      msg_type: 'unknown',
      summary: '消息解析失败',
      status: 'error',
      error: e instanceof Error ? e.message : String(e)
    })
    await safeSendPlain(conn, token, peerId, contextToken, '处理这条消息时出错了，请稍后再试。', rt.abort.signal)
    return
  }

  if (parsed.kind === 'unsupported') {
    store.insertLog({
      connection_id: connectionId,
      peer_id: peerId,
      direction: 'in',
      msg_type: parsed.msgType,
      summary: parsed.summary,
      status: 'dropped'
    })
    await safeSendPlain(conn, token, peerId, contextToken, parsed.notice || '暂不支持这类消息。', rt.abort.signal)
    return
  }
  store.insertLog({ connection_id: connectionId, peer_id: peerId, direction: 'in', msg_type: parsed.msgType, summary: parsed.summary })

  const pendingParams = rt.pendingImageParams.get(peerId)
  const selectedNumber = parsed.content.trim().match(/^([1-6])$/)?.[1]
  if (pendingParams && pendingParams.expiresAt > Date.now() && selectedNumber) {
    rt.pendingImageParams.delete(peerId)
    parsed.content = pendingParams.content + imageParamInstruction(IMAGE_PARAM_OPTIONS[Number(selectedNumber) - 1])
  } else {
    if (pendingParams) rt.pendingImageParams.delete(peerId)
    if (isImageRequest(parsed.content)) {
      const explicit = parseImageParams(parsed.content)
      if (explicit.size || explicit.batchCount) {
        const defaults = getClawbotImageDefaults()
        parsed.content += imageParamInstruction({ size: explicit.size || defaults.size, batchCount: explicit.batchCount || defaults.batchCount })
      } else {
        rt.pendingImageParams.set(peerId, { content: parsed.content, expiresAt: Date.now() + 60_000 })
        await safeSendPlain(conn, token, peerId, contextToken, imageParamMenu(), rt.abort.signal)
        return
      }
    }
  }

  // 2. 校验绑定智能体（配置类错误按 peer 冷却 30min，不逐条刷屏）
  const botId = conn.bot_id
  if (!botId || !getBot(botId)) {
    if (shouldSendErrorNotice(rt, peerId, 'config_error')) {
      await safeSendPlain(conn, token, peerId, contextToken, '还没有绑定智能体，请在桌面端「微信 ClawBot」页完成绑定后再聊。', rt.abort.signal)
    } else {
      store.insertLog({
        connection_id: connectionId,
        peer_id: peerId,
        direction: 'out',
        msg_type: 'system',
        summary: '未绑定智能体提示冷却中，已抑制',
        status: 'dropped'
      })
    }
    return
  }

  // 3. 取/建会话（会话被删等场景自动重建）；建会话失败（如暂无可用对话模型）冷却提示一次
  let conversationId = peer.conversation_id
  let conv = conversationId ? getConversation(conversationId) : null
  if (!conversationId || !conv) {
    try {
      conv = createConversationForPeer(botId, peerId)
      conversationId = conv.id
      store.updatePeerConversation(peer.id, conversationId)
    } catch (e) {
      const errText = e instanceof Error ? e.message : String(e)
      if (shouldSendErrorNotice(rt, peerId, 'config_error')) {
        await safeSendPlain(conn, token, peerId, contextToken, `暂时无法开启对话：${errText}`, rt.abort.signal)
      } else {
        store.insertLog({
          connection_id: connectionId,
          peer_id: peerId,
          direction: 'out',
          msg_type: 'system',
          summary: `建会话失败提示冷却中，已抑制（${errText.slice(0, 60)}）`,
          status: 'dropped'
        })
      }
      return
    }
  } else if (!conv.active_image_model_id) {
    // 老会话回填默认生图模型（一次性幂等）：此前微信会话未预填生图模型，
    // 导致引擎让 LLM 自由选服务商（与桌面端新建会话行为不一致）
    const imgModel = resolveDefaultImageModel()
    if (imgModel) updateConversationImageModel(conversationId, imgModel.provider_id, imgModel.model_id)
  }

  // 同会话新轮开始：停掉上一轮的异步补发 watcher，避免并发 flush 重复发送
  rt.replyWatchers.get(conversationId)?.abort()
  rt.replyWatchers.delete(conversationId)

  // 初始化已发集合（仅首次）：以持久水位（last_sent_rowid）为界——水位之前的标已发；
  // 水位之后的未发 assistant 属「上一进程周期遗留」，留给本轮 flush 补发（上限 MAX_FLUSH_PER_ROUND）。
  // 旧实现把全部历史标已发，重启后遗留未发消息（含未发出的生图）被永久吞掉。
  if (!rt.sentIdsByConv.has(conversationId)) {
    const baseline = new Set<string>()
    const watermark = peer.last_sent_rowid || 0
    for (const m of listAssistantWithRowid(conversationId)) {
      if (m.rowid <= watermark) baseline.add(m.id)
    }
    rt.sentIdsByConv.set(conversationId, baseline)
  }

  // 日限额引擎预检：触顶后不再跑引擎（否则每条入站都烧一整轮 LLM/生图配额而当日零投递）。
  // 触顶提示按 peer 冷却 30min 发一次，且计入日志/限额口径。
  if (store.countTodayOutgoing() >= getDailyLimit()) {
    if (shouldSendErrorNotice(rt, peerId, 'daily_limit')) {
      await safeSendPlain(conn, token, peerId, contextToken, '今日回复次数已达上限，明天再聊。', rt.abort.signal)
      store.insertLog({
        connection_id: connectionId,
        peer_id: peerId,
        direction: 'out',
        msg_type: 'system',
        summary: '今日回复次数已达上限，明天再聊。'
      })
    }
    return
  }

  // 4. typing 开始（不阻塞主流程：ilink 慢时 getConfig+sendTyping 最多阻塞 ~20s，
  //    此前 await 会让引擎启动白等；失败/迟到都不影响回复。
  //    引擎先结束时若 typing 尚未启动完，stopTypingFn 仍是 noop——then 里检查 typingStopped
  //    立即停掉刚启动的心跳，否则 5s setInterval 会泄漏空转）
  let stopTypingFn: () => void = () => {}
  let typingStopped = false
  void startTyping(rt, conn, token, peerId, contextToken)
    .then((fn) => { if (typingStopped) { fn() } else { stopTypingFn = fn } })
    .catch(() => {})

  // 5. 调对话引擎（window=null 纯后台跑，审批走桥内白名单）；
  //    onProgress 计工具步数 + 进度文本（首发延迟 60s、单轮上限 2 条、计入日志/限额口径——
  //    长任务微信侧不再只有 typing 死等，也不在无收益时刷屏）
  let engineThrow: Error | null = null
  let progressSteps = 0
  let progressSent = 0
  let sawPendingImageGen = false
  const engineStartedAt = Date.now()
  const progressTimer = setInterval(() => {
    void (async () => {
      if (rt.abort.signal.aborted) return
      if (progressSent >= 2) return // 单轮上限 2 条
      if (progressSent === 0 && Date.now() - engineStartedAt < 60_000) return // 首发延迟 60s
      progressSent++
      const text = progressSteps > 0 ? `仍在处理中（已执行 ${progressSteps} 步，请稍等）…` : '还在处理中，请稍等…'
      await safeSendPlain(conn, token, peerId, contextToken, text, rt.abort.signal)
      // 进度消息同样计入出站日志/日限额口径（此前绕开计数，触顶后照发）
      store.insertLog({ connection_id: conn.id, peer_id: peerId, direction: 'out', msg_type: 'system', summary: text })
    })()
  }, PROGRESS_NOTICE_INTERVAL_MS)
  ;(progressTimer as any).unref?.()
  const requestId = `clawbot-${uuid()}`
  rt.activeRounds.set(conversationId, requestId)
  try {
    await engineSendMessage(
      {
        conversationId,
        botId,
        content: parsed.content,
        attachments: parsed.attachments,
        requestId,
        approvalDecider: makeApprovalDecider(conversationId),
        onProgress: (p) => {
          if (p?.type === 'tool_start' || p?.type === 'tool_result') progressSteps++
          // 记录本轮是否留下了 fire-and-forget 生图任务（决定要不要启动补发 watcher）
          if (p?.type === 'tool_result' && p?.tool === 'image_gen' && /后台|提交/.test(String(p?.summary || ''))) sawPendingImageGen = true
        }
      },
      null
    )
  } catch (e) {
    engineThrow = e instanceof Error ? e : new Error(String(e))
  } finally {
    clearInterval(progressTimer)
    typingStopped = true
    if (rt.activeRounds.get(conversationId) === requestId) rt.activeRounds.delete(conversationId)
    stopTypingFn()
  }

  // 6. 回发本轮新 assistant 消息（工具前言已在 flush 内过滤，不上微信；同会话互斥）
  if (engineThrow) {
    await sendErrorText(rt, conn, token, peerId, contextToken, translateEngineThrow(engineThrow))
  } else {
    const fr = await flushLocked(rt, conversationId, () =>
      flushNewAssistantMessages(rt, conn, token, peerId, contextToken, conversationId, peer.id))
    if (fr.sent === 0) {
      if (fr.blockedByLimit) {
        await safeSendPlain(conn, token, peerId, contextToken, '今日回复次数已达上限，明天再聊。', rt.abort.signal)
      } else if (fr.suppressed > 0) {
        // 持久态错误冷却抑制中：不再发任何兜底文案（此前会误发「请再发一次」诱导无效重发）
      } else if (fr.attempted > 0) {
        // 有消息但全部投递失败：区分「没生成」与「发送失败」
        await safeSendPlain(conn, token, peerId, contextToken, '回复发送失败，请稍后重试。', rt.abort.signal)
      } else {
        await safeSendPlain(conn, token, peerId, contextToken, '（没有生成回复，请再发一次试试）', rt.abort.signal)
      }
    }
    // 7. 异步补发 watcher（兜底）：仅本轮确有 pending 生图任务或有图片待重试时启动——
    //    纯文本轮不再无条件空转（事件驱动已覆盖生图完成时刻）
    if (sawPendingImageGen || rt.pendingImageRetries.size > 0) {
      scheduleReplyWatcher(rt, conn, token, peerId, contextToken, conversationId, peer.id)
    }
  }

  // 8. 广播：对话页联动刷新 + 状态计数
  broadcastPeerMessage({ connectionId, peerId, conversationId, summary: parsed.summary.slice(0, 80) })
  broadcastStatus()
}

interface FlushResult {
  sent: number
  blockedByLimit: boolean
  /** 被错误冷却抑制的条数（调用方据此不再发「请再发一次」误导兜底） */
  suppressed: number
  /** 实际尝试投递的条数（区分「没生成」与「发送失败」） */
  attempted: number
}

/**
 * 把未发过的 assistant 消息逐条发给微信（按消息 id 去重；含 [Error]/中断标记转译、日限额拦截、
 * 持久态错误冷却、图片级失败登记、持久水位推进；工具前言 tool_calls 过滤不上微信）。
 * 失败分流：熔断期快速失败静默 break（不算尝试）；ret=-2 服务端拒发不原地重试直接 break（熔断器接管退避）；
 * 网络类失败 2s 补试一次；最终失败累计计数，达 MAX_MESSAGE_DELIVER_ATTEMPTS 跳过该条防堵（保序让位于可用性）。
 */
async function flushNewAssistantMessages(
  rt: Runtime,
  conn: ClawbotConnection,
  token: string,
  peerId: string,
  contextToken: string,
  conversationId: string,
  peerRowId?: string
): Promise<FlushResult> {
  // 每轮 flush 重读该 peer 最新 context_token：调用方传的可能是轮次开始时的快照，
  // 长轮次/退避恢复后可能已被新入站刷新（-2 prepare failed 的主因之一就是旧 token）
  const freshPeer = store.getPeer(conn.id, peerId)
  if (freshPeer?.last_context_token) contextToken = freshPeer.last_context_token
  let sentIds = rt.sentIdsByConv.get(conversationId)
  if (!sentIds) {
    sentIds = new Set<string>()
    rt.sentIdsByConv.set(conversationId, sentIds)
  }
  const sentIdSet: Set<string> = sentIds
  const logSent = (kind: 'text' | 'image', summary: string) =>
    store.insertLog({
      connection_id: conn.id,
      peer_id: peerId,
      direction: 'out',
      msg_type: kind === 'image' ? 'image' : 'text',
      summary
    })

  /** 投递单条：文本失败抛错（外层按类型分流）；图片失败不抛、登记图片级重试；成功后推进水位 */
  const deliver = async (m: { id: string; content: any }): Promise<void> => {
    const text = translateMarkedError(String(m.content)) ?? String(m.content)
    const res = await sendOutboundReply(
      { conn, token, peerId, contextToken, signal: rt.abort.signal, msgKey: m.id, segDone: rt.flushSegDone, onSent: logSent },
      text
    )
    sentIdSet.add(m.id)
    if (res.failedImages.length) {
      rt.pendingImageRetries.set(m.id, { peerId, images: res.failedImages, attempts: 0, lastAttemptAt: Date.now() })
      store.insertLog({
        connection_id: conn.id,
        peer_id: peerId,
        direction: 'out',
        msg_type: 'system',
        summary: `${res.failedImages.length} 张图片发送失败，转入图片级重试`,
        status: 'error'
      })
    }
    // 推进持久水位（重启后 baseline 以此为界，不再吞遗留未发）
    if (peerRowId) {
      const rowid = rowidOfMessage(m.id)
      if (rowid) store.updatePeerLastSentRowid(peerRowId, rowid)
    }
    // 防无界增长：超 500 时丢弃最早的一半（Set 按插入序迭代）
    if (sentIdSet.size > 500) {
      let drop = 250
      for (const id of sentIdSet) {
        if (drop-- <= 0) break
        sentIdSet.delete(id)
      }
    }
  }

  let pending = getMessages(conversationId).filter(
    (m) =>
      m.role === 'assistant' &&
      String(m.content || '').trim() &&
      !sentIdSet.has(m.id) &&
      // 工具前言（带 tool_calls 的中间态 assistant）不上微信：一轮工具调用会产生 N 条前言，
      // 逐条发既是刷屏又直接把发送频率打进限流（真机 11:34 事故的主放大器）。
      // 最终回复天然无 tool_calls，不受影响；微信侧长任务反馈由 typing + 45s 进度文本承担。
      !(Array.isArray(m.tool_calls) && m.tool_calls.length > 0)
  )
  // 积压截断：重启水位恢复后可能积压大量历史，最多补 MAX_FLUSH_PER_ROUND 条（更早的直接放弃，防刷屏）
  if (pending.length > MAX_FLUSH_PER_ROUND) {
    const overflow = pending.slice(0, pending.length - MAX_FLUSH_PER_ROUND)
    for (const m of overflow) sentIdSet.add(m.id)
    pending = pending.slice(-MAX_FLUSH_PER_ROUND)
  }

  let sent = 0
  let blockedByLimit = false
  let suppressed = 0
  let attempted = 0
  for (const m of pending) {
    // 日发送限额（风控）：超限记日志并停止后续
    if (store.countTodayOutgoing() >= getDailyLimit()) {
      blockedByLimit = true
      store.insertLog({
        connection_id: conn.id,
        peer_id: peerId,
        direction: 'out',
        msg_type: 'system',
        summary: '达到日发送上限，回复已拦截',
        status: 'dropped'
      })
      broadcastStatus()
      break
    }
    // 持久态错误冷却：同类错误 30min 只发一次，其余标记已发并记日志（防 watcher 反复尝试）；
    // 抑制同样推进水位——否则重启后曾被抑制的错误会泄漏补发。
    // 分类只作用于真错误消息（[Error]/[已中断] 的转译产物）：正常回复含「余额不足」等
    // 关键词时若误分类抑制 = 正常消息被丢弃。
    const translated = translateMarkedError(String(m.content))
    const cls = translated ? classifyErrorText(translated) : null
    if (cls) {
      if (cls === 'login_expired') maybeAlertRelogin(rt)
      if (!shouldSendErrorNotice(rt, peerId, cls)) {
        sentIdSet.add(m.id)
        suppressed++
        if (peerRowId) {
          const rowid = rowidOfMessage(m.id)
          if (rowid) store.updatePeerLastSentRowid(peerRowId, rowid)
        }
        store.insertLog({
          connection_id: conn.id,
          peer_id: peerId,
          direction: 'out',
          msg_type: 'system',
          summary: `同类错误提示冷却中，已抑制（${cls}）`,
          status: 'dropped'
        })
        continue
      }
    }
    attempted++
    try {
      await deliver(m)
      sent++
      rt.flushAttempts.delete(m.id)
    } catch (e1) {
      // 熔断开启中：发送根本没打服务端（快速失败），不算尝试、不记日志、不触发兜底，静默等退避期结束
      if (e1 instanceof SendCircuitOpenError) {
        attempted--
        break
      }
      let finalErr = e1
      // 服务端拒发（ret=-2：限流/prepare failed）：不原地重试（2s 重试只会加重限流，熔断器已接管退避）；
      // 网络类失败保留一次 2s 补试
      const declined = e1 instanceof api.ILinkSendError && e1.isDeclined
      if (!declined) {
        try {
          await sleep(2000, rt.abort.signal)
          await deliver(m)
          sent++
          rt.flushAttempts.delete(m.id)
          continue
        } catch (e2) {
          if (e2 instanceof SendCircuitOpenError) {
            attempted--
            break
          }
          finalErr = e2
        }
      }
      // 最终失败：累计计数，达顶跳过该条（poison 防堵：此前同一卡死消息被每个 flush 触发源反复
      // 重试，既打不出后续消息又放大限流——真机 11:34 一口气 14 条失败日志即此形态）
      const attempts = (rt.flushAttempts.get(m.id) || 0) + 1
      rt.flushAttempts.set(m.id, attempts)
      if (attempts >= MAX_MESSAGE_DELIVER_ATTEMPTS) {
        sentIdSet.add(m.id)
        rt.flushAttempts.delete(m.id)
        rt.flushSegDone.delete(m.id)
        if (peerRowId) {
          const rowid = rowidOfMessage(m.id)
          if (rowid) store.updatePeerLastSentRowid(peerRowId, rowid)
        }
        store.insertLog({
          connection_id: conn.id,
          peer_id: peerId,
          direction: 'out',
          msg_type: 'system',
          summary: `一条回复连续 ${attempts} 次投递失败，已跳过（防队列堵塞），可在桌面端对话查看`,
          status: 'error',
          error: finalErr instanceof Error ? finalErr.message : String(finalErr)
        })
        continue
      }
      store.insertLog({
        connection_id: conn.id,
        peer_id: peerId,
        direction: 'out',
        msg_type: 'system',
        summary: declined ? '回复被服务端拒发（限流或会话失效），退避后自动补发' : '回复发送失败',
        status: 'error',
        error: finalErr instanceof Error ? finalErr.message : String(finalErr)
      })
      break
    }
  }
  return { sent, blockedByLimit, suppressed, attempted }
}

/** 图片级重试：只重发图片（文本已送达），连续 IMAGE_RETRY_MAX 次失败降级为文字说明。
 *  时间退避：同一任务每分钟至多尝试一次——此前挂在 3s flush 轮次上，3 次预算 ~30s 内烧完，
 *  覆盖不了 CDN/风控的分钟级故障窗口。
 *  返回是否有任务被实际尝试（watcher 据此刷新静默计数，不因纯重试轮被误判静默而早退） */
async function retryPendingImages(rt: Runtime, conn: ClawbotConnection, token: string): Promise<boolean> {
  let progressed = false
  for (const [msgId, task] of rt.pendingImageRetries) {
    if (rt.abort.signal.aborted) return progressed
    if (Date.now() - task.lastAttemptAt < 60_000) continue
    // 熔断期跳过（不烧重试预算：此时发送只会快速失败，预算烧完会误判「多次失败」降级）
    if (isSendCircuitOpen()) continue
    // 用 peer 最新 context_token（旧 token 可能已失效）
    const peer = store.getPeer(conn.id, task.peerId)
    const contextToken = peer?.last_context_token || ''
    if (!contextToken) continue
    task.attempts++
    task.lastAttemptAt = Date.now()
    progressed = true
    let failed: OutboundImage[]
    try {
      failed = await sendImagesOnly(
        {
          conn, token, peerId: task.peerId, contextToken, signal: rt.abort.signal, msgKey: msgId,
          onSent: (kind, summary) =>
            store.insertLog({
              connection_id: conn.id,
              peer_id: task.peerId,
              direction: 'out',
              msg_type: kind === 'image' ? 'image' : 'text',
              summary
            })
        },
        task.images
      )
    } catch {
      failed = task.images
    }
    if (failed.length === 0) { rt.pendingImageRetries.delete(msgId); continue }
    task.images = failed
    if (task.attempts >= IMAGE_RETRY_MAX) {
      await safeSendPlain(conn, token, task.peerId, contextToken, `有 ${failed.length} 张图片多次发送失败，请在桌面端对话中查看。`, rt.abort.signal)
      store.insertLog({
        connection_id: conn.id,
        peer_id: task.peerId,
        direction: 'out',
        msg_type: 'system',
        summary: `图片重试 ${IMAGE_RETRY_MAX} 次仍失败，已降级为文字说明`,
        status: 'error'
      })
      rt.pendingImageRetries.delete(msgId)
    }
  }
  return progressed
}

/** 同会话 flush 互斥：watcher/事件驱动/新轮并发时串行执行，防同一消息被两个 flush 重复发送 */
function flushLocked<T>(rt: Runtime, conversationId: string, fn: () => Promise<T>): Promise<T> {
  const prev = rt.flushChains.get(conversationId) ?? Promise.resolve(0)
  const next = prev.catch(() => 0).then(fn) as Promise<T>
  rt.flushChains.set(conversationId, next as Promise<number>)
  const cleanup = () => {
    if (rt.flushChains.get(conversationId) === (next as unknown as Promise<number>)) rt.flushChains.delete(conversationId)
  }
  next.then(cleanup, cleanup)
  return next
}

/** 持久态错误文案分类（冷却 + 文案去操作化的判定依据；须同时覆盖英文原文与转译后中文） */
function classifyErrorText(text: string): 'login_expired' | 'balance' | 'config_error' | null {
  if (/登录已失效|登录态失效|重新登录|Cloud login required/i.test(text)) return 'login_expired'
  if (/余额不足|balance|insufficient/i.test(text)) return 'balance'
  // 配置类持久错误（未绑定智能体/未配置模型等）：同样按 peer 冷却，不逐条刷屏
  if (/未绑定智能体|没有绑定智能体|绑定的智能体不存在|还没有配置对话模型|未选择对话模型|暂无可用对话模型/i.test(text)) return 'config_error'
  return null
}

/** 同 peer 同类错误 30min 冷却（冷却期内不再发，避免持久态错误刷屏） */
function shouldSendErrorNotice(rt: Runtime, peerId: string, kind: string): boolean {
  const k = `${peerId}:${kind}`
  const last = rt.errorNotices.get(k) || 0
  if (Date.now() - last < ERROR_NOTICE_COOLDOWN_MS) return false
  rt.errorNotices.set(k, Date.now())
  return true
}

/** 登录态失效：尝试静默刷新云控 token + 桌面通知引导（含 refresh 在内整体冷却 30min） */
function maybeAlertRelogin(rt: Runtime): void {
  if (Date.now() - rt.lastLoginAlertAt < LOGIN_ALERT_COOLDOWN_MS) return
  rt.lastLoginAlertAt = Date.now()
  void refreshCloudToken().catch(() => {})
  notifyDesktop('微信 ClawBot 需要重新登录', '云控登录态已失效，请在桌面端重新登录后自动恢复')
}

/** 错误文案发送入口（engineThrow 分支用）：先过持久态冷却 */
async function sendErrorText(
  rt: Runtime,
  conn: ClawbotConnection,
  token: string,
  peerId: string,
  contextToken: string,
  text: string
): Promise<void> {
  const cls = classifyErrorText(text)
  if (cls) {
    if (cls === 'login_expired') maybeAlertRelogin(rt)
    if (!shouldSendErrorNotice(rt, peerId, cls)) {
      store.insertLog({
        connection_id: conn.id,
        peer_id: peerId,
        direction: 'out',
        msg_type: 'system',
        summary: `同类错误提示冷却中，已抑制（${cls}）`,
        status: 'dropped'
      })
      return
    }
  }
  await safeSendPlain(conn, token, peerId, contextToken, text, rt.abort.signal)
}

/** 消息 id → messages.rowid（水位推进用；conversation.ts SELECT * 不含 rowid，单独查） */
function rowidOfMessage(messageId: string): number | null {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT rowid FROM messages WHERE id=?').get(messageId) as any
    return row ? Number(row.rowid) : null
  } catch {
    return null
  }
}

/** 会话全部 assistant 消息的 id + rowid（baseline 水位判定用） */
function listAssistantWithRowid(conversationId: string): { id: string; rowid: number }[] {
  try {
    const db = getDatabase()
    return db
      .prepare("SELECT id, rowid FROM messages WHERE conversation_id=? AND role='assistant' ORDER BY rowid ASC")
      .all(conversationId) as { id: string; rowid: number }[]
  } catch {
    return []
  }
}

/**
 * 异步补发 watcher（兜底）：引擎 resolve 后仍有后台任务（生图等）在跑，其结果以 appendMessage 稍后落库。
 * 事件驱动（emitAssistantAppended → flushLocked）已覆盖完成时刻，本 watcher 只作保险：
 * 窗口最长 300s（60→100 轮 × 3s，慢图留足余量），每 3s 检查一次并顺带做图片级重试；
 * 连续 30s 无新消息且已过 150s 才提前结束。
 */
function scheduleReplyWatcher(
  rt: Runtime,
  conn: ClawbotConnection,
  token: string,
  peerId: string,
  contextToken: string,
  conversationId: string,
  peerRowId?: string
): void {
  const ctrl = new AbortController()
  rt.replyWatchers.set(conversationId, ctrl)
  const startedAt = Date.now()
  let silentRounds = 0
  void (async () => {
    for (let i = 0; i < 100; i++) {
      if (ctrl.signal.aborted || rt.abort.signal.aborted) break
      await sleep(3000, ctrl.signal).catch(() => {})
      if (ctrl.signal.aborted || rt.abort.signal.aborted) break
      let progressed = false
      const sent = await flushLocked(rt, conversationId, async () => {
        const r = await flushNewAssistantMessages(rt, conn, token, peerId, contextToken, conversationId, peerRowId)
        progressed = await retryPendingImages(rt, conn, token)
        return r.sent
      })
      // 有实际投递或图片重试进展都不算静默（否则 watcher 会在图片重试预算耗尽前早退）
      if (sent > 0 || progressed) {
        silentRounds = 0
      } else {
        silentRounds++
      }
      // 有未完成的图片重试任务时不早退（任务驱动到完结或循环上限为止）
      if (silentRounds >= 10 && Date.now() - startedAt >= 150_000 && rt.pendingImageRetries.size === 0) break
    }
    if (rt.replyWatchers.get(conversationId) === ctrl) rt.replyWatchers.delete(conversationId)
  })().catch((e) => console.error('[clawbot] reply watcher failed:', e))
}

async function safeSendPlain(
  conn: ClawbotConnection,
  token: string,
  peerId: string,
  contextToken: string,
  text: string,
  signal?: AbortSignal
): Promise<void> {
  try {
    await sendPlainText({ conn, token, peerId, contextToken, signal }, text)
  } catch (e) {
    console.error('[clawbot] safeSendPlain failed:', e)
  }
}

// ===== 会话与模型 =====

/** 云控站点配置（/public/site-config，免登录）里的对话默认模型缓存 key（settings 表） */
const SITE_CHAT_MODEL_SETTING = 'site_config_chat_default_model'

/** 刷新云控默认对话模型缓存（与工作台默认模型同源）；尽力而为，失败保留旧缓存 */
async function refreshChatDefaultModel(): Promise<void> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    try {
      const resp = await fetch(`${getCloudApiBase()}/public/site-config`, { signal: ctrl.signal })
      if (!resp.ok) return
      const data = await resp.json()
      const m = data?.chat_default_model
      if (m && typeof m.provider_id === 'string' && typeof m.model_id === 'string' && m.model_id) {
        setSetting(SITE_CHAT_MODEL_SETTING, JSON.stringify({ provider_id: m.provider_id, model_id: m.model_id }))
      }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    /* 网络失败保留旧缓存 */
  }
}

function getCachedChatDefaultModel(): { provider_id: string; model_id: string } | null {
  try {
    const raw = getSetting(SITE_CHAT_MODEL_SETTING)
    if (!raw) return null
    const m = JSON.parse(raw)
    if (!m || typeof m.model_id !== 'string' || !m.model_id) return null
    return { provider_id: typeof m.provider_id === 'string' ? m.provider_id : '', model_id: m.model_id }
  } catch {
    return null
  }
}

/**
 * 主进程版默认对话模型解析（镜像 ChatView.resolveDefaultModel，与工作台新会话一致）：
 * 1. 云控端下发的 chat_default_model（主选）：provider_id 固定 'cloud:default'，
 *    裸 model_id 按已授权列表升级为复合 key（model_id#@provider_name），且须仍在已授权 chat 列表内
 * 2. 兜底：已授权云端模型列表第一个 chat 模型（复合 key 精确路由）
 */
function resolveDefaultChatModel(): { provider_id: string; model_id: string } | null {
  const models = getCloudModels()
  const compositeOf = (e: { model_id: string; provider_name: string }): string => `${e.model_id}${CLOUD_KEY_SEP}${e.provider_name}`
  const cached = getCachedChatDefaultModel()
  if (cached && cached.provider_id === 'cloud:default' && cached.model_id) {
    let candidate = cached.model_id
    if (!candidate.includes(CLOUD_KEY_SEP)) {
      const hit = models.find((m) => m.type === 'chat' && m.model_id === candidate)
      candidate = hit ? compositeOf(hit) : ''
    }
    if (candidate && models.some((m) => m.type === 'chat' && compositeOf(m) === candidate)) {
      return { provider_id: 'cloud:default', model_id: candidate }
    }
    // 无权限/已下线 → 落兜底链（与工作台一致，不摆「幽灵模型」）
  }
  const first = models.find((m) => m.type === 'chat')
  if (!first) return null
  return { provider_id: 'cloud:default', model_id: compositeOf(first) }
}

/**
 * 主进程版默认生图模型解析：取已授权云端模型列表第一个 image 模型。
 * 与桌面端新建会话行为对齐（ChatView.resolveDefaultImageModel 同款兜底链）——
 * 不预填的话，会话 active_image_model_id 为空时引擎会让 LLM 自行 list_providers 自由选，
 * 表现为「微信里生图不走桌面端选的服务商/模型」。
 */
function resolveDefaultImageModel(): { provider_id: string; model_id: string } | null {
  const first = getCloudModels().find((m) => m.type === 'image')
  if (!first) return null
  return { provider_id: 'cloud:default', model_id: `${first.model_id}#@${first.provider_name}` }
}

function createConversationForPeer(botId: string, peerId: string): Conversation {
  // peer 显示名：剥 @im.wechat 后缀取后 6 位
  const shortId = peerId.replace(/@im\.wechat$/, '').slice(-6) || 'user'
  // 初始模型与工作台新会话完全同源（云控默认主选 + 已授权第一个 chat 兜底）：
  // v0.6.5 起智能体不再绑定模型，此前读 bot.model_* 导致微信会话模型与工作台默认不一致
  const initialModel = resolveDefaultChatModel()
  if (!initialModel) {
    throw new Error('暂无可用对话模型，请先在「模型服务」确认已授权 chat 模型')
  }
  return createConversation(botId, `微信-${shortId}`, initialModel, resolveDefaultImageModel() ?? undefined)
}

// ===== 回复提取与错误转译 =====

/** [Error] / 中断标记 → 用户可读文案；返回 null 表示不是错误标记 */
function translateMarkedError(content: string): string | null {
  const trimmed = content.trim()
  if (trimmed.startsWith('[Error]')) {
    const msg = trimmed.slice(7).trim()
    if (/余额不足|balance|insufficient/i.test(msg)) return '助理账户余额不足，暂时无法回复，请联系管理员充值。'
    if (/Cloud login required/i.test(msg)) return '助理暂时离线（登录态失效），恢复后会自动继续，请稍后再试。'
    if (/未选择对话模型/.test(msg)) return '绑定的智能体还没有配置对话模型，请在桌面端检查。'
    return `生成回复失败：${msg.slice(0, 150) || '未知错误'}`
  }
  if (trimmed.includes('[上一轮已被新消息中断]') || trimmed.includes('[已中断]')) {
    return '回复被中断了，请再发一次。'
  }
  return null
}

function translateEngineThrow(e: Error): string {
  if (e.message === 'Bot not found') return '绑定的智能体不存在了，请在桌面端「微信 ClawBot」页重新绑定。'
  if (e.message === 'Conversation not found') return '会话丢失了，请再发一次这条消息。'
  if (/未选择对话模型/.test(e.message)) return '绑定的智能体还没有配置对话模型，请在桌面端检查。'
  if (/Cloud login required/i.test(e.message)) return '助理暂时离线（登录态失效），恢复后会自动继续，请稍后再试。'
  return `处理失败：${e.message.slice(0, 150)}`
}

// ===== typing =====

async function startTyping(
  rt: Runtime,
  conn: ClawbotConnection,
  token: string,
  peerId: string,
  contextToken: string
): Promise<() => void> {
  try {
    let cached = rt.typingTickets.get(peerId)
    if (!cached || cached.expiresAt < Date.now()) {
      const resp = await api.getConfig(conn.baseurl, token, peerId, contextToken, rt.abort.signal)
      if (resp?.typing_ticket) {
        cached = { ticket: resp.typing_ticket, expiresAt: Date.now() + 24 * 3600_000 }
        rt.typingTickets.set(peerId, cached)
      }
    }
    if (!cached) return () => {}
    const ticket = cached.ticket
    await api.sendTyping(conn.baseurl, token, peerId, ticket, TYPING_STATUS.TYPING, rt.abort.signal)
    const timer = setInterval(() => {
      api.sendTyping(conn.baseurl, token, peerId, ticket, TYPING_STATUS.TYPING).catch(() => {})
    }, 5000)
    ;(timer as any).unref?.()
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      api.sendTyping(conn.baseurl, token, peerId, ticket, TYPING_STATUS.CANCEL).catch(() => {})
    }
  } catch {
    return () => {}
  }
}

// ===== 审批白名单 =====

export interface ApprovalPolicy {
  /** 工作区内文件写操作自动批（生成文件类任务的最低需求） */
  allowWorkspaceWrite: boolean
  /** 工作区内文件读自动批 */
  allowWorkspaceRead: boolean
  /** 工作区外文件读自动批（默认关：防静默外泄） */
  allowOutsideRead: boolean
  /** 内置小工具（时间/计算器/网页抓取/JSON/文本/随机数）自动批 */
  allowBuiltinUtils: boolean
  /** 非只读 MCP 工具自动批（默认关） */
  allowMcp: boolean
  /** run_command 自动批（默认关：远程触发命令执行风险不可接受） */
  allowRunCommand: boolean
}

const WRITING_FILE_OPS = new Set(['write', 'append', 'mkdir', 'delete', 'copy', 'rename', 'write_json'])
const READING_FILE_OPS = new Set(['read', 'read_json', 'list', 'glob', 'find_latest', 'tree'])
const BUILTIN_SAFE_TOOLS = new Set(['get_current_time', 'calculator', 'fetch_webpage', 'json_tool', 'text_tool', 'random_generator'])

const DEFAULT_POLICY: ApprovalPolicy = {
  allowWorkspaceWrite: true,
  allowWorkspaceRead: true,
  allowOutsideRead: false,
  allowBuiltinUtils: true,
  allowMcp: false,
  allowRunCommand: false
}

export interface ClawbotImageDefaults { size: string; batchCount: number }

export function getClawbotImageDefaults(): ClawbotImageDefaults {
  const size = String(getSetting('clawbot_default_image_size') || '1:1')
  const batchCount = Math.min(4, Math.max(1, Number(getSetting('clawbot_default_image_count')) || 1))
  return { size, batchCount }
}

export function setClawbotImageDefaults(input: Partial<ClawbotImageDefaults>): ClawbotImageDefaults {
  const allowedSizes = new Set(['1:1', '16:9', '9:16', '4:3', '3:4'])
  const current = getClawbotImageDefaults()
  const size = allowedSizes.has(String(input.size || '')) ? String(input.size) : current.size
  const batchCount = Math.min(4, Math.max(1, Number(input.batchCount) || current.batchCount))
  setSetting('clawbot_default_image_size', size)
  setSetting('clawbot_default_image_count', String(batchCount))
  return { size, batchCount }
}

export function getApprovalPolicy(): ApprovalPolicy {
  try {
    const raw = getSetting('clawbot_approval_whitelist')
    if (!raw) return { ...DEFAULT_POLICY }
    return { ...DEFAULT_POLICY, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_POLICY }
  }
}

export function setApprovalPolicy(patch: Partial<ApprovalPolicy>): ApprovalPolicy {
  const next = { ...getApprovalPolicy(), ...patch }
  setSetting('clawbot_approval_whitelist', JSON.stringify(next))
  return next
}

function resolveWithinWorkspace(p: string, sandboxDir: string): string {
  return isAbsolute(p) ? resolve(p) : resolve(sandboxDir, p)
}

/** 跨平台判断 child 是否位于 parent 内（Windows 大小写不敏感），与 chat-engine 同规则 */
function isWithinDir(child: string, parent: string): boolean {
  if (!child || !parent) return false
  const c = process.platform === 'win32' ? child.toLowerCase() : child
  const p = process.platform === 'win32' ? parent.toLowerCase() : parent
  const rel = relative(p, c)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * 桥内自动审批决策器（注入 chat-engine；仅 window=null 时生效）。
 * 默认拒绝一切未点名工具（deck_*、非只读 MCP、unsandboxed 技能等全部落在此类），
 * 白名单只放：工作区内文件读写、内置小工具；run_command 永远默认拒。
 */
function makeApprovalDecider(conversationId: string) {
  const sandboxDir = join(getDataDir(), 'workspaces', conversationId)
  const policy = getApprovalPolicy()
  return ({ name, args }: { name: string; args: any }): boolean => {
    if (name === 'run_command') return policy.allowRunCommand
    if (name === 'mcp_call') return policy.allowMcp
    if (name === 'file_ops') {
      const action = String(args?.action || '')
      if (WRITING_FILE_OPS.has(action)) {
        return policy.allowWorkspaceWrite && allPathsWithin(args, sandboxDir)
      }
      if (READING_FILE_OPS.has(action)) {
        const p = typeof args?.path === 'string' ? args.path : ''
        if (!p) return policy.allowWorkspaceRead
        const inside = isWithinDir(resolveWithinWorkspace(p, sandboxDir), resolve(sandboxDir))
        return inside ? policy.allowWorkspaceRead : policy.allowOutsideRead
      }
      // stat/exists 等元数据操作放行
      return true
    }
    if (BUILTIN_SAFE_TOOLS.has(name)) return policy.allowBuiltinUtils
    return false
  }
}

/** copy/rename 等可能带多路径参数：所有可疑路径字段都必须在工作区内 */
function allPathsWithin(args: any, sandboxDir: string): boolean {
  const PATH_KEYS = ['path', 'from', 'to', 'source', 'destination', 'src', 'dest', 'target', 'new_path', 'old_path']
  const root = resolve(sandboxDir)
  for (const key of PATH_KEYS) {
    const v = args?.[key]
    if (typeof v !== 'string' || !v) continue
    if (!isWithinDir(resolveWithinWorkspace(v, sandboxDir), root)) return false
  }
  return true
}

// ===== IPC 面使用的管理操作 =====

/** 发起扫码登录（fire-and-forget）；confirmed 后自动接力启动桥 */
export async function startLoginFlow(): Promise<void> {
  login.setLoginStateListener(() => broadcastStatus())
  try {
    await login.startLogin()
  } finally {
    broadcastStatus()
    if (login.getLoginState().phase === 'confirmed') {
      try {
        await startClawbotBridge()
      } catch (e) {
        console.error('[clawbot] start after login failed:', e)
      }
    }
  }
}

export function cancelLoginFlow(): void {
  login.cancelLogin()
  broadcastStatus()
}

export function submitVerifyCode(code: string): void {
  login.submitVerifyCode(code)
}

/** 登出：停轮询、清凭据，保留 peer 映射（重扫后上下文可续） */
export function logoutClawbot(): void {
  stopClawbotBridge()
  const conn = store.getPrimaryConnection()
  if (conn) store.clearCredentials(conn.id)
  broadcastStatus()
}

export function bindBot(botId: string): void {
  if (!getBot(botId)) throw new Error('智能体不存在')
  const conn = store.ensurePrimaryConnection()
  store.updateConnectionFields(conn.id, { bot_id: botId })
  broadcastStatus()
}

/** 一键新建默认「微信助手」并绑定（幂等：按名字复用已有） */
export function createDefaultBotAndBind(): { botId: string; created: boolean } {
  let created = false
  let bot = listBots().find((b) => b.name === DEFAULT_BOT_NAME) || null
  if (!bot) {
    const model = resolveDefaultChatModel()
    bot = createBot({
      name: DEFAULT_BOT_NAME,
      description: '微信 ClawBot 默认智能体（自动创建）。工具审批由桥内白名单自动裁决：工作区内文件读写与内置小工具自动批准，命令执行一律拒绝。',
      model_provider_id: model?.provider_id,
      model_id: model?.model_id,
      tool_approval: 'destructive',
      enable_image_gen: 1,
      enable_deck: 0
    })
    created = true
  }
  const conn = store.ensurePrimaryConnection()
  store.updateConnectionFields(conn.id, { bot_id: bot.id })
  broadcastStatus()
  return { botId: bot.id, created }
}

export function setBridgeEnabled(enabled: boolean): void {
  const conn = store.ensurePrimaryConnection()
  store.updateConnectionFields(conn.id, { enabled: enabled ? 1 : 0 })
  if (enabled) {
    startClawbotBridge().catch((e) => console.error('[clawbot] enable start failed:', e))
  } else {
    stopClawbotBridge()
    broadcastStatus()
  }
}

export function resetPeerConversation(peerRowId: string): void {
  store.updatePeerConversation(peerRowId, '')
  broadcastStatus()
}

export function listPeerSummaries(): store.ClawbotPeerSummary[] {
  const conn = store.getPrimaryConnection()
  return conn ? store.listPeers(conn.id) : []
}

export function listBridgeLogs(beforeId?: string, limit?: number): store.ClawbotLog[] {
  return store.listLogs(beforeId, limit)
}

/** 启动/热切换后的僵尸状态清理 + 日志 pruning（main/index 与 account-context 双调用点） */
export function clawbotStartupMaintenance(): void {
  try {
    store.cleanupStaleClawbotState()
    store.pruneClawbotLogs(7)
  } catch (e) {
    console.error('[clawbot] startup maintenance failed:', e)
  }
}
