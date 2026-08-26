import { BrowserWindow } from 'electron'
import { join, resolve, isAbsolute, relative } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { v4 as uuid } from 'uuid'
import { type ToolApproval, resolveBotPromptSkillDirs } from './bot'
import { resolveChatBot, DEFAULT_CHAT_SYSTEM_PROMPT } from './default-chat'
import { getProviderSystemPrompt } from './model-provider'
import { getPersona } from './persona'
import { getMessages, addMessage, getConversation, updateConversationTitle, deleteMessagesFrom, updateMessageContent, deleteMessage, countConversationMessages } from './conversation'
import { callLLM, ChatMessage, AbortedError, isAbortedError, compactToolCalls } from './llm'
import { listSkills } from './skill'
import { getMcpServer } from './mcp-server'
import { getSummary, upsertSummary } from './conversation-summary'
import { embedText, embedBatch, cosineSimilarity } from './embedding'
import { searchHybrid } from './vector-store'
import { searchCloudKnowledgeBases } from './cloud-kb-search'
import { listKnowledgeBases, listCategories, type KnowledgeBase } from './knowledge'
import { getBrandWorkspace } from './brand-workspace'
import { getWorkspace, updateWorkspaceBrandMeta } from './agent-workspace'
import { resolveWorkspaceContext } from './workspace-context'
import { compileDigitalEmployeeContext, createEmployeeCandidate } from './digital-employee'
import type { SkillSelectionMode } from '../../shared/digital-employee'
import { beginEmployeeTask, finishEmployeeTask, type EmployeeTaskStatus } from './digital-employee-task'
import { executeSkillSandbox, resolveInWorkspace } from './skill-sandbox'
import { pythonPromptText } from './python-runtime'
import { getSetting } from './settings'
import { callMcpTool, normalizeMcpToolResult } from './mcp-server'
import { listPromptSkills, getPromptSkillByName } from './prompt-skill'
import { coreToolDefs, executeCoreToolCall, CORE_TOOL_NAMES, KB_TOOL_NAMES, previewFileWrite, previewFileRead, type FileWritePreview, type FileReadPreview } from './core-tools'
import { deckToolDefs, executeDeckTool, DECK_TOOL_NAMES } from './deck/deck-tools'
import { sanitizeOpenAIMessages } from './message-sanitizer'
import { type ToolHistoryEntry, hashToolArgs, isToolFailure, checkToolCircuitBreaker } from './tool-circuit-breaker'
import { cancelPendingChoices, cancelAllPendingChoices, registerDeadlineHooks } from './user-choice'
import {
  bindWorkspaceBrandSources,
  compileMustTokens,
  ensureBrandCard,
  formatCardForSystem,
  isBrandOverride,
  isImageGenTurn,
  isVoiceOverride,
  lastTurnWasImageGen,
  rewriteImageRagQuery,
  type BrandCard
} from './brand-card'
import { formatVoiceForSystem, loadVoice } from './workspace-voice'

// 单向注册：user-choice 不反向依赖本模块（避免循环依赖），卡片等待期间暂停硬上限
registerDeadlineHooks({ pause: pauseAgentDeadline, resume: resumeAgentDeadline })

// Per-model context-window table. Values are the *total* model context (prompt + completion).
// We reserve ~25% for the response and pass the rest as the prompt budget.
const MODEL_CONTEXT_LIMITS: { match: RegExp; total: number }[] = [
  // Claude
  { match: /claude-(?:opus|sonnet|haiku)-4|claude-3\.5|claude-3-5/i, total: 200_000 },
  { match: /claude-3/i, total: 200_000 },
  { match: /claude/i, total: 200_000 },
  // GPT-4 / GPT-5
  { match: /gpt-5/i, total: 256_000 },
  { match: /gpt-4\.1/i, total: 1_000_000 },
  { match: /gpt-4o|gpt-4-turbo|gpt-4-1106|gpt-4-0125/i, total: 128_000 },
  { match: /gpt-4-32k/i, total: 32_000 },
  { match: /gpt-4/i, total: 8_000 },
  { match: /o1|o3|o4/i, total: 200_000 },
  // GPT-3.5
  { match: /gpt-3\.5-turbo-16k/i, total: 16_000 },
  { match: /gpt-3\.5/i, total: 16_000 },
  // Gemini
  { match: /gemini-(?:1\.5|2\.0|2\.5)-pro/i, total: 1_000_000 },
  { match: /gemini-(?:1\.5|2\.0|2\.5)-flash/i, total: 1_000_000 },
  { match: /gemini/i, total: 32_000 },
  // DeepSeek
  { match: /deepseek-(?:r1|reasoner)/i, total: 64_000 },
  { match: /deepseek-chat|deepseek-coder|deepseek-v3/i, total: 64_000 },
  { match: /deepseek/i, total: 32_000 },
  // Qwen
  { match: /qwen.*-1m|qwen.*-long/i, total: 1_000_000 },
  { match: /qwen-?(?:plus|max|turbo)|qwen2\.5|qwen3/i, total: 128_000 },
  { match: /qwen/i, total: 32_000 },
  // GLM / ChatGLM
  { match: /glm-4-(?:plus|long|air|0520)/i, total: 128_000 },
  { match: /glm-4/i, total: 128_000 },
  { match: /glm/i, total: 32_000 },
  // Mistral
  { match: /mistral-large/i, total: 128_000 },
  { match: /mistral/i, total: 32_000 },
  // Llama
  { match: /llama-?3\.[12]/i, total: 128_000 },
  { match: /llama-?3/i, total: 8_000 },
  // Yi / Doubao / Baichuan / Moonshot
  { match: /moonshot|kimi/i, total: 128_000 },
  { match: /doubao/i, total: 128_000 },
  { match: /yi-/i, total: 32_000 }
]

const DEFAULT_TOTAL_CONTEXT = 32_000
const RESPONSE_RESERVE_RATIO = 0.25
// Hard deadline as a safety net (30 min) — prevents a runaway agent / LLM loop
// from burning tokens forever, but is NOT a per-task duration limit. Agent can
// keep working until completion or user pressing Stop, as long as每一步都在前进。
// 长时间静默由 llm.ts 的 stream idle timeout 单独识别（见 STREAM_IDLE_TIMEOUT_MS）。
const AGENT_HARD_DEADLINE_MS = 30 * 60_000
// Tool approval popup独立超时（30 min）：用户离开喝水/开会不会被强制拒绝；
// 真正想取消的话用对话面板的「中止」按钮（走 cancelChat → abortController.abort()）。
// 工具审批超时兜底：仅作为「卡片确实丢失且补投也失败」的最后保险。审批卡现已 app 级常驻 +
// 按会话路由 + 进入会话补投（见 listPendingApprovals / chat:toolApprovalResolved），正常不会丢，
// 故从 30 分钟收紧到 10 分钟，缩短极端情况下的静默挂起时长。
const APPROVAL_TIMEOUT_MS = 10 * 60_000
const MAX_TOOL_RESULT_CHARS = 12_000
// 工具执行阶段心跳间隔：慢工具 / MCP 冷启动握手期间没有任何流式输出，靠它周期性给渲染端
// 发「执行中 Ns」反馈，避免长等待被当成挂死。快工具在首个 tick 前就返回，不会显示。
const TOOL_HEARTBEAT_INTERVAL_MS = 5_000
// Agent loop 内上下文压缩：单次回答的多轮工具调用会让 currentMessages 只增不减、逼近模型
// 上下文上限，导致 prefill 变慢 / 请求过重 → 间接触发流式 terminated。进入时的滑动窗口只在
// 「回答之间」生效，管不到 loop 内，故这里单独压缩。下面两个常量控制压缩力度（可调）。
const KEEP_TOOL_RESULT_ROUNDS = 2  // 最近 N 轮工具结果保全文，更早的压成占位
const MIN_KEEP_ROUNDS = 3          // 硬裁兜底：至少保留最近 N 轮（N*2 条核心消息）
// MCP 工具差异化超时：annotations 显式标记 longRunning 的工具放宽到 5 分钟，
// 避免默认 30s RPC 超时把生图 / 长检索类工具直接打断
const MCP_LONG_RUNNING_TIMEOUT_MS = 5 * 60_000

// 按 mcp tool annotations 计算调用超时：annotations.timeoutMs > annotations.longRunning > 默认
function resolveMcpToolTimeoutMs(mcpId: string, toolName: string): number | undefined {
  const server = getMcpServer(mcpId)
  const tool = server?.tools?.find((t: any) => t?.name === toolName) as any
  const ann = tool?.annotations
  if (ann && typeof ann === 'object') {
    const explicit = Number(ann.timeoutMs)
    if (Number.isFinite(explicit) && explicit > 0) return explicit
    if (ann.longRunning === true) return MCP_LONG_RUNNING_TIMEOUT_MS
  }
  return undefined
}

function getModelPromptBudget(modelId: string): number {
  const id = String(modelId || '')
  const found = MODEL_CONTEXT_LIMITS.find((e) => e.match.test(id))
  const total = found?.total ?? DEFAULT_TOTAL_CONTEXT
  return Math.max(2000, Math.floor(total * (1 - RESPONSE_RESERVE_RATIO)))
}

type ActiveChatController = {
  controller: AbortController
  requestId: string
  /** 轮次完全收尾（含 catch 落库）后 resolve；新轮串行门据此等待，防并发写库污染转录 */
  done?: Promise<void>
}

const activeControllers = new Map<string, ActiveChatController>()
const canceledRequestIds = new Set<string>()
const canceledRequestReasons = new Map<string, 'user' | 'replaced'>()

// 取消标记自动清理：避免长时间运行累积无界 Set/Map。
// 后台生图任务最长 ~90s（按 image_gen 注释），给 10 分钟兜底足够覆盖任何
// 异步追加路径；之后即便有迟到事件也会落地为新消息（不会再有同 requestId 流）。
const CANCELED_REQUEST_TTL_MS = 10 * 60_000

function markChatRequestCanceled(requestId?: string, reason: 'user' | 'replaced' = 'user') {
  if (!requestId) return
  canceledRequestIds.add(requestId)
  canceledRequestReasons.set(requestId, reason)
  setTimeout(() => {
    canceledRequestIds.delete(requestId)
    canceledRequestReasons.delete(requestId)
  }, CANCELED_REQUEST_TTL_MS).unref?.()
}

export function isChatRequestCanceled(requestId?: string): boolean {
  return !!requestId && canceledRequestIds.has(requestId)
}

export function cancelChat(conversationId: string, requestId?: string): boolean {
  const active = activeControllers.get(conversationId)
  if (!active) return false
  if (requestId && active.requestId !== requestId) return false
  markChatRequestCanceled(active.requestId, 'user')
  active.controller.abort()
  activeControllers.delete(conversationId)
  // Reject any pending approvals for this conversation
  for (const [, ctx] of pendingApprovals) {
    if (ctx.conversationId === conversationId) {
      ctx.cleanup()
      notifyApprovalResolved(ctx.window, ctx.conversationId, ctx.requestId)
      ctx.resolve('aborted')
    }
  }
  // 同会话挂起的交互卡片选择一并取消（abort 已会触发，这里显式兜底）
  cancelPendingChoices(conversationId)
  return true
}

// 交互卡等待期间的 deadline 控制（user-choice.ts 经 registerDeadlineHooks 反向调用）
const deadlineControls = new Map<string, { pause: () => void; resume: () => void }>()
function pauseAgentDeadline(conversationId: string): void { deadlineControls.get(conversationId)?.pause() }
function resumeAgentDeadline(conversationId: string): void { deadlineControls.get(conversationId)?.resume() }

export function isChatActive(conversationId: string): boolean {
  return activeControllers.has(conversationId)
}

/** 中止所有进行中的对话流 + 解除工具审批（账号热切换前清场用）。返回命中数。 */
export function cancelAllChats(): number {
  let hit = 0
  for (const [, active] of activeControllers) {
    markChatRequestCanceled(active.requestId, 'user')
    try { active.controller.abort() } catch {}
    hit++
  }
  activeControllers.clear()
  for (const [, ctx] of pendingApprovals) {
    try {
      ctx.cleanup()
      notifyApprovalResolved(ctx.window, ctx.conversationId, ctx.requestId)
      ctx.resolve('aborted')
    } catch {}
  }
  cancelAllPendingChoices()
  return hit
}

// === Tool approval ===
/** 审批卡向渲染端投递的载荷（与 chat:toolApproval / listPendingApprovals 返回一致）。 */
interface ApprovalPayload {
  request_id: string
  conversation_id: string
  tool: string
  args: any
  preview?: any
}
/** 审批裁决：区分「用户拒绝 / 超时未答 / 中止」——此前三路共用 resolve(false)，
 *  超时被伪装成用户主动拒绝，模型把「用户没看」当成「用户已拍板」并静默改道任务 */
type ApprovalVerdict = 'approved' | 'rejected' | 'timeout' | 'aborted'
interface PendingApproval {
  conversationId: string
  requestId: string
  window: BrowserWindow | null
  payload: ApprovalPayload
  resolve: (verdict: ApprovalVerdict) => void
  cleanup: () => void
}
const pendingApprovals = new Map<string, PendingApproval>()

/** 通知渲染端某审批已在主进程侧被解决（超时 / 中止），让常驻审批监听清掉对应卡片。 */
function notifyApprovalResolved(win: BrowserWindow | null, conversationId: string, requestId: string): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send('chat:toolApprovalResolved', { request_id: requestId, conversation_id: conversationId })
  }
}

/** 列出某会话仍挂起的审批载荷：渲染端重新进入会话时补投，避免卡片在切走期间丢失后无法恢复。 */
export function listPendingApprovals(conversationId: string): ApprovalPayload[] {
  const out: ApprovalPayload[] = []
  for (const [, ctx] of pendingApprovals) {
    if (ctx.conversationId === conversationId) out.push(ctx.payload)
  }
  return out
}

const DESTRUCTIVE_FILE_OPS = new Set(['write', 'append', 'mkdir', 'delete', 'copy', 'rename', 'write_json'])
// 会读到文件内容或枚举目录条目的读类操作：工作区外读取需用户确认，防静默外泄。
// stat/exists 仅探测元数据、信息量低，不纳入以减少摩擦。
const READ_FILE_OPS = new Set(['read', 'read_json', 'list', 'glob', 'find_latest', 'tree'])

const BROWSER_SAFE_ACTIONS = new Set(['list_profiles', 'snapshot', 'screenshot'])

function isDestructiveTool(name: string, args: any): boolean {
  if (name === 'run_command') return true
  if (name === 'file_ops') return DESTRUCTIVE_FILE_OPS.has(args?.action)
  if (name === 'browser') return !BROWSER_SAFE_ACTIONS.has(String(args?.action || ''))
  if (name === 'use_skill' || name === 'image_gen' || name === 'ask_user' || KB_TOOL_NAMES.includes(name)) return false
  if (name) return true
  return false
}

// 读取「可信目录白名单」：用户在设置里预授权的目录，其内文件 AI 可免确认读取。
function getTrustedReadDirs(): string[] {
  try {
    const raw = getSetting('trusted_read_dirs')
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => resolve(x))
  } catch {
    return []
  }
}

// 跨平台判断 child 是否位于 parent 目录内（Windows 大小写不敏感）。
function isWithinDir(child: string, parent: string): boolean {
  if (!child || !parent) return false
  const c = process.platform === 'win32' ? child.toLowerCase() : child
  const p = process.platform === 'win32' ? parent.toLowerCase() : parent
  const rel = relative(p, c)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

// 模型直接发起的 file_ops 读类操作，其目标是否落在「工作区 ∪ 可信白名单」之外。
// 仅判定读类操作；写类已由 isDestructiveTool 覆盖。无路径或相对路径默认在工作区内。
function isFileOpReadOutsideTrusted(args: any, sandboxDir: string): boolean {
  if (!args || !READ_FILE_OPS.has(args.action)) return false
  const p = args.path
  if (typeof p !== 'string' || !p) return false
  const resolved = resolveInWorkspace(p, sandboxDir)
  if (isWithinDir(resolved, resolve(sandboxDir))) return false
  for (const dir of getTrustedReadDirs()) {
    if (isWithinDir(resolved, dir)) return false
  }
  return true
}

function needsApproval(
  mode: ToolApproval,
  name: string,
  args: any,
  sandboxDir?: string,
  mcpReadOnlyTools?: Set<string>
): boolean {
  // ask_user 本身就是向用户征询选择，不再走工具确认（避免双重弹窗）
  if (name === 'ask_user') return false
  if (mode === 'off') return false
  if (mode === 'all') return true
  // MCP 工具显式声明 readOnlyHint=true 的视为只读查询，destructive 模式下免审批
  //（集合在构建时已排除与核心工具/小工具同名者，防止借同名豁免提权）
  if (mcpReadOnlyTools?.has(name)) return false
  if (isDestructiveTool(name, args)) return true
  // destructive 模式下：file_ops 读取工作区外（且非白名单）文件也需确认，防静默外泄。
  if (name === 'file_ops' && sandboxDir) return isFileOpReadOutsideTrusted(args, sandboxDir)
  return false
}

function requestToolApproval(
  window: BrowserWindow | null,
  conversationId: string,
  toolCall: any,
  parsedArgs: any,
  preview: FileWritePreview | FileReadPreview | null,
  signal: AbortSignal,
  approvalDecider?: (req: { name: string; args: any }) => boolean
): Promise<ApprovalVerdict> {
  return new Promise<ApprovalVerdict>((resolve) => {
    const requestId = uuid()
    const payload: ApprovalPayload = {
      request_id: requestId,
      conversation_id: conversationId,
      tool: toolCall?.function?.name || 'unknown',
      args: parsedArgs,
      preview: preview || undefined
    }
    const cleanup = () => {
      pendingApprovals.delete(requestId)
      signal.removeEventListener('abort', onAbort)
      clearTimeout(timer)
    }
    // 超时 / 中止属「主进程侧解决」：除 resolve 外还要通知渲染端清掉常驻卡片，避免残留。
    // 两者语义分离：超时≠用户拒绝（模型据此选择「向用户说明」而非「改道任务」）
    const resolveBySystem = (verdict: 'timeout' | 'aborted') => {
      const ctx = pendingApprovals.get(requestId)
      if (ctx) {
        cleanup()
        notifyApprovalResolved(window, conversationId, requestId)
        ctx.resolve(verdict)
      }
    }
    const onAbort = () => resolveBySystem('aborted')
    const timer = setTimeout(() => resolveBySystem('timeout'), APPROVAL_TIMEOUT_MS)
    pendingApprovals.set(requestId, { conversationId, requestId, window, payload, resolve, cleanup })
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (window) {
      // 窗口销毁后 send 会抛 'Object has been destroyed'：按 fail-closed 兜底为超时路径
      try {
        if (window.isDestroyed() || window.webContents.isDestroyed()) {
          cleanup()
          resolve('timeout')
          return
        }
        window.webContents.send('chat:toolApproval', payload)
      } catch {
        cleanup()
        resolve('timeout')
        return
      }
    } else if (approvalDecider) {
      // 无窗口但调用方注入了审批决策器（如微信 ClawBot 桥的自动审批白名单）：
      // 由决策器判定，抛错按拒绝处理（fail closed）
      let decided = false
      try {
        decided = approvalDecider({ name: payload.tool, args: parsedArgs }) === true
      } catch {
        decided = false
      }
      cleanup()
      resolve(decided ? 'approved' : 'rejected')
    } else {
      // No window to ask: fail closed
      cleanup()
      resolve('rejected')
    }
  })
}

export function respondToolApproval(requestId: string, approved: boolean): boolean {
  const ctx = pendingApprovals.get(requestId)
  if (!ctx) return false
  ctx.cleanup()
  ctx.resolve(approved ? 'approved' : 'rejected')
  return true
}

function getWorkspaceDir(conversationId: string): string {
  const resolved = resolveWorkspaceContext({ conversationId })
  if (!resolved.available || !resolved.rootPath) {
    throw new Error(resolved.reason || '任务工作区不可用，请重新选择工作区')
  }
  return resolved.rootPath
}

/**
 * After slicing history for the sliding window, the first messages may be orphan
 * tool results (parent assistant.tool_calls got trimmed) or trailing assistant.tool_calls
 * without their matching tool responses. Both cases cause OpenAI to reject the replay, so
 * we repair by trimming those orphans.
 */
function repairHistoryHead(msgs: ChatMessage[]): ChatMessage[] {
  let start = 0
  // Drop leading orphan tool results.
  while (start < msgs.length && msgs[start].role === 'tool') start++
  // Drop a leading assistant whose declared tool_calls aren't all answered below it.
  if (start < msgs.length) {
    const head = msgs[start] as any
    if (head.role === 'assistant' && Array.isArray(head.tool_calls) && head.tool_calls.length > 0) {
      const ids: string[] = head.tool_calls.map((tc: any) => tc?.id).filter(Boolean)
      const tail = msgs.slice(start + 1)
      const answered = ids.every((id) =>
        tail.some((m: any) => m.role === 'tool' && m.tool_call_id === id)
      )
      if (!answered) start++
    }
  }
  let end = msgs.length
  // Drop a trailing assistant.tool_calls whose tool results were sliced off.
  while (end > 0) {
    const last = msgs[end - 1] as any
    if (last?.role === 'assistant' && Array.isArray(last.tool_calls) && last.tool_calls.length > 0) {
      const ids: string[] = last.tool_calls.map((tc: any) => tc?.id).filter(Boolean)
      const tail = msgs.slice(end)
      const answered = ids.every((id) =>
        tail.some((m: any) => m.role === 'tool' && m.tool_call_id === id)
      )
      if (!answered) { end--; continue }
    }
    break
  }
  return msgs.slice(start, end)
}

const RECENT_ROUNDS = 6
// 历史多模态图片保留轮数：仅最近 N 条「带图」user 消息的图片进上下文，更早的转占位文本。
// 避免长对话里历史图片无上限累积撑爆 token / 成本（当前轮新图必然在最近 N 内，不受影响）。
const IMAGE_HISTORY_KEEP_ROUNDS = 3
const DOC_CHUNK_SIZE = 500
const DOC_CHUNK_OVERLAP = 50
const DOC_TOP_K = 8
const DOC_MAX_RESULT_CHARS = 6000

function splitIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize))
    start += chunkSize - overlap
  }
  return chunks
}

async function retrieveRelevantChunks(docText: string, query: string, docName: string, signal?: AbortSignal): Promise<string> {
  const chunks = splitIntoChunks(docText, DOC_CHUNK_SIZE, DOC_CHUNK_OVERLAP)
  if (chunks.length === 0) return docText

  const queryResult = await embedText(query, { signal })
  const chunkResults = await embedBatch(chunks, undefined, { signal })

  const scored = chunks.map((chunk, i) => ({
    chunk,
    score: cosineSimilarity(queryResult.embedding, chunkResults.embeddings[i].embedding)
  }))
  scored.sort((a, b) => b.score - a.score)

  let result = ''
  let count = 0
  for (const item of scored) {
    if (count >= DOC_TOP_K || result.length + item.chunk.length > DOC_MAX_RESULT_CHARS) break
    result += item.chunk + '\n---\n'
    count++
  }
  return `(${docName}: ${chunks.length} chunks, showing top ${count} relevant)\n\n${result}`
}

function limitToolResult(resultStr: string): string {
  if (resultStr.length <= MAX_TOOL_RESULT_CHARS) return resultStr
  return resultStr.slice(0, MAX_TOOL_RESULT_CHARS) + `\n...[tool result truncated, ${resultStr.length} chars total]`
}

// 大工具结果 offload：超过阈值的结果写入会话工作区文件，上下文里只放「预览 + 路径」，模型需要
// 完整内容时用 file_ops 读该路径或 grep 检索。借鉴 Cursor「大输出落盘、按需引用」，从源头避免单个
// 大结果（读大文件 / 终端长输出 / 生成的 SVG 等）撑爆 agent loop 上下文；完整原文留在工作区不丢失。
const TOOL_RESULT_OFFLOAD_DIR = 'tool-outputs'
const TOOL_RESULT_PREVIEW_CHARS = 1500

function offloadOrLimitToolResult(resultStr: string, toolName: string, sandboxDir: string, round: number): string {
  // 防御：调用方序列化异常（如 undefined）时兜成可读串，不在此处抛 TypeError
  if (typeof resultStr !== 'string') resultStr = String(resultStr ?? '(空结果)')
  if (resultStr.length <= MAX_TOOL_RESULT_CHARS) return resultStr
  try {
    const dir = join(sandboxDir, TOOL_RESULT_OFFLOAD_DIR)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const safeName = (toolName || 'tool').replace(/[^a-zA-Z0-9_-]/g, '_')
    const fname = `${safeName}-r${round}-${uuid().slice(0, 8)}.txt`
    writeFileSync(join(dir, fname), resultStr, 'utf-8')
    const rel = `${TOOL_RESULT_OFFLOAD_DIR}/${fname}`
    const preview = resultStr.slice(0, TOOL_RESULT_PREVIEW_CHARS)
    return (
      `[工具结果较大（${resultStr.length} 字符），完整内容已保存到工作区文件：${rel}\n` +
      `需要完整内容时用 file_ops 读取该路径，或 grep 检索关键字。以下为前 ${TOOL_RESULT_PREVIEW_CHARS} 字符预览：]\n` +
      preview +
      `\n...[预览到此截断，完整内容见 ${rel}]`
    )
  } catch {
    // offload 失败（磁盘 / 权限等）回退到原截断逻辑，保证工具链不被阻塞
    return limitToolResult(resultStr)
  }
}

// 中断/异常自愈:若会话最后一条 assistant 带 tool_calls 但缺配对的 tool 结果,
// 补合成 tool 结果落库,保证 DB 历史 tool_call 配对合法(与发送前 sanitize 形成双保险)。
function healDanglingToolCalls(conversationId: string): void {
  try {
    const msgs = getMessages(conversationId)
    if (msgs.length === 0) return
    const last = msgs[msgs.length - 1]
    if (last.role !== 'assistant' || !Array.isArray(last.tool_calls) || last.tool_calls.length === 0) return
    const answered = new Set<string>()
    for (const m of msgs) {
      if (m.role === 'tool' && m.tool_call_id) answered.add(m.tool_call_id)
    }
    for (const tc of last.tool_calls) {
      const id = tc?.id
      if (id && !answered.has(id)) {
        addMessage({
          conversation_id: conversationId,
          role: 'tool',
          // 中性措辞：只陈述「中断、结果未知」，不断言「未完成/失败」——
          // 断言失败会诱导模型盲目重试（工具可能已执行，重试=副作用重复）
          content: '工具调用被中断，结果未知；如需继续，请先检查当前状态再决定是否重试。',
          tool_call_id: id
        })
      }
    }
  } catch (e: any) {
    console.warn('[chat] healDanglingToolCalls failed:', e?.message)
  }
}

/**
 * Agent loop 内上下文压缩。两步（先 B 温和、后 A 兜底）：
 *   B. 把较早轮次的工具结果（role=tool）压成占位，仅保留最近 KEEP_TOOL_RESULT_ROUNDS 轮全文——
 *      工具结果是上下文大头，且 agent 决策主要依赖最近 1-2 步，压它损失最小、收益最大。
 *   A. 若压缩后仍超 budget，从「对话区」头部成组丢最旧消息，保底最近 MIN_KEEP_ROUNDS 轮。
 *
 * 仅压缩「发给模型的 currentMessages」，不动数据库（每轮 addMessage 已落全量），故 DB 历史完整。
 * 每轮调用前 currentMessages 都是 tool_call 配对完整的（工具执行完才进下一轮），裁剪安全。
 *
 * @param messages    完整 currentMessages（前 systemCount 条为 system，恒保留）
 * @param systemCount system 段长度
 * @param budget      对话区 token 预算（= getModelPromptBudget - systemTokens，同滑动窗口口径）
 */
function compactAgentContext(messages: ChatMessage[], systemCount: number, budget: number): ChatMessage[] {
  const system = messages.slice(0, systemCount)
  let convo = messages.slice(systemCount)

  // B：给每条消息标轮号（每遇到一个 assistant.tool_calls 轮号 +1），把较早轮的工具结果压占位。
  let round = 0
  const toolRound: number[] = new Array(convo.length)
  for (let i = 0; i < convo.length; i++) {
    const m: any = convo[i]
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) round++
    toolRound[i] = round
  }
  if (round > KEEP_TOOL_RESULT_ROUNDS) {
    const cutoff = round - KEEP_TOOL_RESULT_ROUNDS
    convo = convo.map((m: any, i): ChatMessage => {
      if (
        m.role === 'tool' &&
        toolRound[i] <= cutoff &&
        typeof m.content === 'string' &&
        !m.content.startsWith('[较早工具结果已省略')
      ) {
        return { ...m, content: `[较早工具结果已省略以节省上下文，原 ${m.content.length} 字符]` }
      }
      return m
    })
  }

  // A：仍超 budget 则从对话区头部成组硬裁，保底最近 MIN_KEEP_ROUNDS 轮，repairHistoryHead 修配对。
  // 任务锚点保护：锚点（最后一条 user 消息）落在 convo[0]/convo[1] 即停——
  // slice(2) 每次删一对，anchor=1 时再裁会把锚点连同前一条一起删掉（off-by-one 丢任务）。
  while (true) {
    let anchor = -1
    for (let i = convo.length - 1; i >= 0; i--) {
      if (convo[i].role === 'user') { anchor = i; break }
    }
    if (anchor >= 0 && anchor <= 1) break // 锚点已在头部，再裁必丢任务——停（超预算由溢出自愈重试兜底）
    const floor = Math.max(MIN_KEEP_ROUNDS * 2, anchor >= 0 ? convo.length - anchor : MIN_KEEP_ROUNDS * 2)
    if (convo.length <= floor || estimateMessagesTokens(convo) <= budget) break
    convo = convo.slice(2)
    convo = repairHistoryHead(convo)
  }

  return [...system, ...convo]
}

/** 上游报错是否为「上下文超长」类（各家文案不一，宽匹配；误判代价仅多压缩重试一次） */
function isContextOverflowError(msg: string): boolean {
  return /context.{0,30}(length|limit|window|overflow|exceed)|maximum context|too many tokens|prompt is too long|request too large|exceeds? the (maximum|max) (context|token|length)|上下文.{0,10}(超长|超限|上限|过长)|(输入|内容|请求).{0,6}过长|超出.{0,6}(上限|长度)/i.test(msg)
}

// 文档 RAG 结果缓存：key=文档内容+query 的指纹。历史消息内容冻结不变，
// 此前每轮对同一文档重复分块+向量化（确定性重复计费），缓存后命中即返。
const docRagCache = new Map<string, string>()
const DOC_RAG_CACHE_CAP = 50
function docRagCacheKey(docText: string, query: string): string {
  const h = createHash('sha256')
  h.update(docText)
  h.update('')
  h.update(query)
  return h.digest('hex')
}

function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g)?.length || 0
  const rest = text.length - cjk
  return Math.ceil(cjk * 1.5 + rest / 4)
}

// 多模态图片 token 估算：固定 300 会严重低估（一张 1024px 图在多数视觉模型约 1000-1600 token），
// 低估会让滑窗误判「未超预算」、最终请求体撑爆模型上下文（上游 400 或被静默截断）。
// 这里按 data URI 体积保守分档（偏高）——宁可少放历史，也不要溢出。
function estimateImageTokens(url: string): number {
  const len = (url || '').length
  if (len > 200_000) return 1600
  if (len > 80_000) return 1100
  if (len > 20_000) return 700
  return 300
}

function estimateMessagesTokens(msgs: ChatMessage[]): number {
  return msgs.reduce((sum, m) => {
    // tool_calls 的参数（file_ops write 可携带几十 KB 全文）必须计入，
    // 否则滑窗/压缩误判「未超预算」，实际请求体撑爆模型上下文（上游 400）
    const tcTokens = (m as any).tool_calls ? estimateTokens(JSON.stringify((m as any).tool_calls)) : 0
    if (typeof m.content === 'string') {
      return sum + estimateTokens(m.content) + tcTokens + 4
    }
    // Multimodal content array: estimate text parts normally, images by data URI size
    let tokens = 4 + tcTokens
    for (const part of m.content as any[]) {
      if (part.type === 'text') {
        tokens += estimateTokens(part.text || '')
      } else if (part.type === 'image_url') {
        tokens += estimateImageTokens(part.image_url?.url || '')
      }
    }
    return sum + tokens
  }, 0)
}

// 写入 system prompt 的 KB 清单上限：避免 prompt 过长撑爆上下文
const KB_SUMMARY_DOCS_PER_CATEGORY = 20

/**
 * 给 system prompt 用的知识库清单：分类名 + 每分类前 N 个文档名（截断时附"等 M 个"）。
 * 让模型直接知道库里大致有什么，能正确回答"知识库里有什么"这类元问题。
 * kbDataByCategory 由 sendMessage 预读传入，避免重复 IO。
 */
function buildKbInventorySummary(
  categoryIds: string[],
  kbDataByCategory: Map<string, KnowledgeBase[]>
): string {
  if (categoryIds.length === 0) return ''
  try {
    const allCats = listCategories()
    const cats = allCats.filter((c) => categoryIds.includes(c.id))
    if (cats.length === 0) return `知识库: 已启用 (${categoryIds.length} 个分类，但分类不可读)`
    const lines: string[] = [`知识库: 已启用 ${cats.length} 个分类`]
    for (const cat of cats) {
      const kbs = kbDataByCategory.get(cat.id) || []
      const ready = kbs.filter((kb) => kb.status === 'ready' || kb.status === 'stale')
      const head = ready.slice(0, KB_SUMMARY_DOCS_PER_CATEGORY).map((kb) => kb.name).join(', ')
      const remaining = ready.length - Math.min(KB_SUMMARY_DOCS_PER_CATEGORY, ready.length)
      const headStr = head ? `: ${head}${remaining > 0 ? `, 等 ${remaining} 个` : ''}` : ''
      const pendingHint = kbs.length > ready.length ? `, 另 ${kbs.length - ready.length} 个待向量化` : ''
      lines.push(`- 分类「${cat.name}」(${ready.length} 个就绪文档${pendingHint})${headStr}`)
    }
    lines.push('当用户询问"知识库里有什么/有哪些文档"时调用 kb_list；当首次召回不够准确时调用 kb_search 用重写后的 query 重查。')
    return lines.join('\n')
  } catch {
    return `知识库: 已启用 (${categoryIds.length} 个分类)`
  }
}

export interface SendMessageOptions {
  conversationId: string
  botId: string
  content: string
  requestId?: string
  attachments?: any[]
  overrideKbCategoryIds?: string[]
  overrideSkillIds?: string[]
  overrideMcpIds?: string[]
  overridePromptSkillDirs?: string[]
  /** 本轮额外系统指令（如对话中创建技能），不落库；regenerate 走 lastTurnOverrides */
  extraSystemPrompt?: string
  /**
   * 无窗口（后台/桥接）场景的工具审批决策器：返回 true=批准，false=拒绝。
   * 仅在 window=null 时生效；不传则保持 fail-closed（需要审批的工具全部自动拒绝）。
   * 微信 ClawBot 桥用它实现「桥内自动审批白名单」（见 services/clawbot/clawbot-bridge.ts）。
   */
  approvalDecider?: (req: { name: string; args: any }) => boolean
  /**
   * 无窗口（后台/桥接）场景的流式进度回调：emitStream 在 window=null 时改走这里。
   * 微信 ClawBot 桥用它给微信发「仍在处理中（已执行 N 步）」的进度文本。
   */
  onProgress?: (payload: Record<string, any>) => void
}

// 缓存每个会话最近一轮 sendMessage 的 overrides，供 regenerate/continue/edit 复用
// 不持久化到 DB，进程重启自然失效，符合「这一次回放沿用最近一次设置」的预期
type LastTurnOverrides = Pick<
  SendMessageOptions,
  'overrideMcpIds' | 'overrideSkillIds' | 'overrideKbCategoryIds' | 'overridePromptSkillDirs' | 'extraSystemPrompt'
>
const lastTurnOverrides = new Map<string, LastTurnOverrides>()

/** 清理指定会话的 lastTurnOverrides 缓存（会话删除时调用，避免 stash 残留指向已删会话） */
export function clearLastTurnOverridesForConversation(conversationId: string): void {
  lastTurnOverrides.delete(conversationId)
}

/** 清空所有会话的 lastTurnOverrides（账号热切换前清场，防止跨账号串数据） */
export function clearAllLastTurnOverrides(): void {
  lastTurnOverrides.clear()
}

function normalizeAttachments(attachments?: any[]): any[] | undefined {
  if (!attachments || attachments.length === 0) return attachments
  return attachments.map((att) => {
    if (!att || typeof att !== 'object') return att
    if (att.id) return att
    return { ...att, id: `att_${uuid()}` }
  })
}

function isImageAttachment(att: any): boolean {
  return !!att && att.type === 'image' && typeof att.data === 'string' && att.data.startsWith('data:image/')
}

function collectImageAttachmentRefs(history: any[], limit = 12): Array<{ id: string; name: string; data: string; messageId: string }> {
  const refs: Array<{ id: string; name: string; data: string; messageId: string }> = []
  const seen = new Set<string>()
  for (let i = history.length - 1; i >= 0 && refs.length < limit; i--) {
    const msg = history[i]
    if (msg?.role !== 'user' || !Array.isArray(msg.attachments)) continue
    for (let j = msg.attachments.length - 1; j >= 0 && refs.length < limit; j--) {
      const att = msg.attachments[j]
      if (!isImageAttachment(att)) continue
      const id = String(att.id || `${msg.id}:${j}`)
      if (seen.has(id)) continue
      seen.add(id)
      refs.push({
        id,
        name: String(att.name || `image-${j + 1}`),
        data: att.data,
        messageId: String(msg.id || '')
      })
    }
  }
  return refs
}

function normalizeStringList(value: any): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean)
  return []
}

function shouldAutoInjectRecentImages(args: any, userContent: string): boolean {
  const text = `${userContent || ''}\n${args?.prompt || ''}`
  // 只认强指代词（「这张图/上一张/刚生成的」）。此前包含「参考|基于|根据|改成|图片|image|edit」
  // 等宽泛词——命中即把无关历史图静默注入并把端点切成 edits（出图语义+计费双变，用户零感知）；
  // 系统提示已教模型要参考时显式传 ref_image_ids，自动兜底只覆盖强指代场景
  return /这张|这幅|该图|这张图|上一张|前一张|刚生成|刚才那张|this image|that image|the previous/i.test(text)
}

function resolveImageGenRefImages(args: any, refs: Array<{ id: string; name: string; data: string; messageId: string }>, currentTurnRefs: Array<{ id: string; name: string; data: string; messageId: string }>, userContent: string): string[] {
  const direct = Array.isArray(args.ref_images)
    ? args.ref_images.filter((v: any) => typeof v === 'string' && v.startsWith('data:image/'))
    : []
  const ids = normalizeStringList(args.ref_image_ids)
  const byId = new Map(refs.map((r) => [r.id, r]))
  const byName = new Map(refs.map((r) => [r.name, r]))
  const resolved = ids
    .map((id) => byId.get(id) || byName.get(id))
    .filter(Boolean)
    .map((r: any) => r.data)
  const autoRefs = direct.length || resolved.length
    ? []
    : (currentTurnRefs.length > 0 || shouldAutoInjectRecentImages(args, userContent) ? (currentTurnRefs.length ? currentTurnRefs : refs).slice(0, 4).map((r) => r.data) : [])
  return Array.from(new Set([...direct, ...resolved, ...autoRefs])).slice(0, 10)
}

export async function sendMessage(
  options: SendMessageOptions,
  window: BrowserWindow | null
): Promise<void> {
  const bot = resolveChatBot(options.botId)
  const requestId = options.requestId || `chat_${uuid()}`
  canceledRequestIds.delete(requestId)
  canceledRequestReasons.delete(requestId)

  // 「智能体不再绑定模型」改造（v0.6.5+）：模型从 conversation.active_model_* 读取
  // - 优先用 conv.active_model_*（用户在输入框左下角切换过的在这里）
  // - 回退：bot.model_*（旧数据：之前绑在 bot 上的模型）
  // - 都为空时报错，提示用户从输入框左下角选模型
  const conv = getConversation(options.conversationId)
  if (!conv) throw new Error('Conversation not found')
  const effectiveProviderId =
    conv.active_model_provider_id || bot.model_provider_id || 'cloud:default'
  const effectiveModelId = conv.active_model_id || bot.model_id || ''
  if (!effectiveModelId) {
    throw new Error('未选择对话模型，请在输入框左下角选择模型')
  }
  // 会话级权限档覆盖智能体（空串 = 继承）
  const effectiveToolApproval: ToolApproval =
    conv.tool_approval === 'off' || conv.tool_approval === 'destructive' || conv.tool_approval === 'all'
      ? conv.tool_approval
      : (bot.tool_approval || 'destructive')

  // 在落用户消息前冻结并校验任务工作区。失效时失败关闭，避免生成一条永远无法执行的孤立消息。
  const resolvedWorkspace = resolveWorkspaceContext({ conversationId: options.conversationId, botId: bot.id })
  if (!resolvedWorkspace.available || !resolvedWorkspace.rootPath) {
    throw new Error(resolvedWorkspace.reason || '任务工作区不可用，请重新选择工作区')
  }

  // Save user message
  const normalizedAttachments = normalizeAttachments(options.attachments)

  // 会话级串行门：先中断并「等待旧轮收尾完成」再落新消息、再开始本轮。
  // 旧实现 abort 后立即继续——旧轮的延迟 catch 收尾（healDanglingToolCalls / 中断标记落库）
  // 与新轮并发写库：转录错位、给新轮在途 tool_calls 插假结果、幽灵中断行劫持「继续生成」。
  // 沙箱已贯穿 signal（executeSkillSandbox），unwind 通常秒级；10s 上限兜底死锁。
  const prevCtrl = activeControllers.get(options.conversationId)
  if (prevCtrl) {
    markChatRequestCanceled(prevCtrl.requestId, 'replaced')
    prevCtrl.controller.abort()
    if (prevCtrl.done) {
      await Promise.race([prevCtrl.done.catch(() => {}), new Promise((r) => setTimeout(r, 10_000))])
    }
  }
  const abortController = new AbortController()
  let doneResolve!: () => void
  const donePromise = new Promise<void>((r) => { doneResolve = r })
  activeControllers.set(options.conversationId, { controller: abortController, requestId, done: donePromise })
  const signal = abortController.signal

  const savedUserMessage = addMessage({
    conversation_id: options.conversationId,
    role: 'user',
    content: options.content,
    attachments: normalizedAttachments
  })
  let employeeTaskId = ''
  let employeeTaskStatus: EmployeeTaskStatus = 'completed'
  let employeeTaskError = ''
  try {
    employeeTaskId = beginEmployeeTask({ botId: bot.id, conversationId: options.conversationId, workspaceId: resolvedWorkspace.workspaceId, goal: options.content })
  } catch (error: any) {
    console.warn('[chat] task run record start failed:', error?.message || error)
  }
  // 首条用户消息立刻给临时标题（侧栏不再长期停在「新对话」）；回合结束后 maybeGenerateTitle 再精炼
  applyProvisionalTitleFromUserMessage(options.conversationId, options.content, window)
  // 不再做整轮 180s 硬超时。只保留 30 分钟 hard deadline 兜底防失控循环。
  // 实际「卡死检测」由 llm.ts 的 stream idle timeout 完成（60s 无 token 即视为静默）。
  // 30 分钟硬上限只统计「Agent 实际工作时间」：等待用户审批弹窗期间暂停计时，
  // 避免用户离开思考时整轮被硬上限误杀（审批本身另有 APPROVAL_TIMEOUT_MS 兜底）。
  let agentTurnTimedOut = false
  let deadlineRemainingMs = AGENT_HARD_DEADLINE_MS
  let deadlineStartedAt = Date.now()
  let agentTurnTimer: ReturnType<typeof setTimeout> | undefined
  const startDeadline = (): void => {
    deadlineStartedAt = Date.now()
    agentTurnTimer = setTimeout(() => {
      agentTurnTimedOut = true
      abortController.abort()
    }, deadlineRemainingMs)
  }
  const pauseDeadline = (): void => {
    if (!agentTurnTimer) return
    clearTimeout(agentTurnTimer)
    agentTurnTimer = undefined
    deadlineRemainingMs = Math.max(0, deadlineRemainingMs - (Date.now() - deadlineStartedAt))
  }
  const resumeDeadline = (): void => {
    if (!agentTurnTimer) startDeadline()
  }
  startDeadline()
  // 交互卡（ask_user/生图参数卡）等待期间暂停硬上限计时（与审批卡同待遇）——
  // 此前只在审批处 pause，交互卡等待会被 30min 硬上限误杀
  deadlineControls.set(options.conversationId, { pause: pauseDeadline, resume: resumeDeadline })
  const emitStream = (payload: Record<string, any>): void => {
    if (!window) {
      // 桥接/后台场景：改走 onProgress 回调（此前整轮工具循环数分钟对调用方零可见输出）
      try { options.onProgress?.({ ...payload, conversationId: options.conversationId, requestId }) } catch { /* 回调异常不影响主流程 */ }
      return
    }
    // 窗口可能已被销毁（默认关窗到托盘）：destroyed 后 send 会抛 'Object has been destroyed'，
    // 降级为静默丢弃——落库不受影响，轮次结束后渲染端从 DB 全量重拉
    try {
      if (window.isDestroyed() || window.webContents.isDestroyed()) return
      // round_done 是轮次终态信号，取消后也要放行（僵尸恢复收尾依赖它）
      if (isChatRequestCanceled(requestId) && payload.type !== 'aborted' && payload.type !== 'round_done') return
      window.webContents.send('chat:stream', {
        ...payload,
        conversationId: options.conversationId,
        requestId
      })
    } catch { /* 窗口销毁竞态：静默 */ }
  }

  try {
  // Build message history
  const history = getMessages(options.conversationId)
  const imageAttachmentRefs = collectImageAttachmentRefs(history)
  const currentTurnImageAttachmentRefs = collectImageAttachmentRefs([savedUserMessage])
  const messages: ChatMessage[] = []

  // Resolve effective config (overrides take precedence)
  const workspaceForTask = resolvedWorkspace.workspaceId ? getWorkspace(resolvedWorkspace.workspaceId) : null
  const baseKbCategoryIds = options.overrideKbCategoryIds ?? bot.kb_category_ids
  // 当前任务工作区知识只在该任务内追加，不写回数字员工通用绑定。
  const effectiveKbCategoryIds = Array.from(new Set([
    ...baseKbCategoryIds,
    ...(workspaceForTask?.kb_category_id ? [workspaceForTask.kb_category_id] : [])
  ]))
  const effectiveSkillIds = options.overrideSkillIds ?? bot.skill_ids
  const effectiveMcpIds = options.overrideMcpIds ?? bot.mcp_ids
  const effectivePromptSkillDirs = options.overridePromptSkillDirs ?? resolveBotPromptSkillDirs(bot)
  const effectivePromptSkillMode: SkillSelectionMode = options.overridePromptSkillDirs !== undefined
    ? 'selected'
    : (bot.skill_selection_mode || 'legacy_all')

  // 记录本轮 overrides，供 regenerate/continue/edit 复用，避免回放时丢失用户当前的工具选择
  lastTurnOverrides.set(options.conversationId, {
    overrideMcpIds: options.overrideMcpIds,
    overrideSkillIds: options.overrideSkillIds,
    overrideKbCategoryIds: options.overrideKbCategoryIds,
    overridePromptSkillDirs: options.overridePromptSkillDirs,
    extraSystemPrompt: options.extraSystemPrompt,
  })
  // 云端知识库绑定（由云控端智能体预设下发，市场导入写入 bot.cloud_kb_ids；对话时在线检索）
  const effectiveCloudKbIds = (bot.cloud_kb_ids || []).filter((n) => n > 0)
  const hasCloudKb = effectiveCloudKbIds.length > 0 && bot.cloud_agent_id > 0

  // 预读启用分类下的全部 KB 数据，供 system prompt 清单 + RAG 检索 + 召回片段来源标注三处复用，避免重复 IO
  const kbDataByCategory = new Map<string, KnowledgeBase[]>()
  if (effectiveKbCategoryIds.length > 0) {
    for (const catId of effectiveKbCategoryIds) {
      kbDataByCategory.set(catId, listKnowledgeBases(catId))
    }
  }

  // D-28：工作区品牌硬卡片。仅生图回合蒸馏/注入；闲聊不带。
  const brandUserOverride = isBrandOverride(options.content)
  const brandImageTurn = isImageGenTurn(options.content, {
    imageGenEnabled: !!bot.enable_image_gen,
    lastWasImageGen: lastTurnWasImageGen(history)
  })
  let brandCard: BrandCard | null = null
  let brandMustTokens = ''
  let brandNote = ''
  let currentWorkspace: ReturnType<typeof getWorkspace> = null
  try {
    currentWorkspace = workspaceForTask
  } catch { /* ignore */ }
  if (brandImageTurn && currentWorkspace) {
    try {
      if (currentWorkspace.kb_category_id) {
        bindWorkspaceBrandSources(currentWorkspace.kb_category_id, currentWorkspace.root_path)
      }
      const prepared = await ensureBrandCard({
        rootPath: currentWorkspace.root_path,
        preferredProviderId: effectiveProviderId,
        preferredModelId: effectiveModelId
      })
      brandCard = prepared.card
      brandNote = prepared.note
      brandMustTokens = brandUserOverride ? '' : compileMustTokens(brandCard, options.content)
      updateWorkspaceBrandMeta(
        currentWorkspace.id,
        brandCard?.status || 'missing',
        brandCard?.source_fingerprint || ''
      )
    } catch (e: any) {
      console.warn('[chat] brand card prepare failed:', e?.message || e)
    }
  }

  // Base system prompt: tool usage guidance + bot identity
  const baseSystemParts: string[] = [
    '你是一个具备工具调用能力的AI助手。当任务需要读写文件、执行命令或调用其他工具时，直接调用对应工具完成操作，不要仅描述步骤或给出建议。'
  ]

  // Bot configuration summary
  const capSummary: string[] = []
  capSummary.push(`名称: ${bot.name}`)
  capSummary.push(`模型: ${effectiveModelId}`)
  capSummary.push('内置浏览器: 可用 browser 工具（open / snapshot / click / type / screenshot）')
  if (effectiveKbCategoryIds.length > 0) {
    capSummary.push(buildKbInventorySummary(effectiveKbCategoryIds, kbDataByCategory))
  }
  if (hasCloudKb) {
    capSummary.push(`云端知识库: 已绑定 ${effectiveCloudKbIds.length} 个线上知识库（对话时自动在线检索；可用 kb_search 工具补充检索）`)
  }
  if (effectiveSkillIds.length > 0) {
    const allSkills = listSkills()
    const skillNames = allSkills.filter(s => effectiveSkillIds.includes(s.id) && s.enabled).map(s => s.function_def?.name || s.name)
    if (skillNames.length > 0) capSummary.push(`小工具: ${skillNames.join(', ')}`)
  }
  {
    const allPS = listPromptSkills().filter(s => s.enabled && (
      effectivePromptSkillMode !== 'selected' || effectivePromptSkillDirs.includes(s.dirName)
    ))
    if (allPS.length > 0) capSummary.push(`Skills技能: ${allPS.map(s => s.name).join(', ')} (通过 use_skill 工具调用)`)
  }
  if (effectiveMcpIds.length > 0) {
    // 仅列出已发现工具的 MCP 服务（防止模型被告知「有 MCP 服务」却无对应工具可调而幻觉编造调用）。
    // always_load=true 的服务：完整列工具名，工具已直接注入 LLM tools，可直接调用。
    // always_load=false 的服务：仅列服务名 + 工具数量，工具未直接注入，需走 mcp_list_servers /
    // mcp_describe_tools / mcp_call 三元元工具按需发现与调用，避免海量工具淹没 prompt。
    const alwaysLines: string[] = []
    const onDemandLines: string[] = []
    for (const id of effectiveMcpIds) {
      const server = getMcpServer(id)
      if (!server || !server.enabled || server.tools.length === 0) continue
      const toolNames = server.tools.map((t: any) => t?.name).filter(Boolean)
      if (toolNames.length === 0) continue
      if (server.always_load) {
        alwaysLines.push(`${server.name}（工具: ${toolNames.join(', ')}）`)
      } else {
        onDemandLines.push(`${server.name}: ${toolNames.length} 个工具`)
      }
    }
    if (alwaysLines.length > 0) capSummary.push(`MCP服务（直接可用）: ${alwaysLines.join('；')}`)
    if (onDemandLines.length > 0) {
      capSummary.push(
        `MCP服务（按需发现，工具未直接注入；用 mcp_list_servers 列出、mcp_describe_tools 查 schema、mcp_call 调用）: ${onDemandLines.join('；')}`
      )
    }
  }
  baseSystemParts.push(`当前配置:\n${capSummary.join('\n')}`)

  // Workspace path: tell the LLM where relative file paths resolve to
  const workspaceDir = getWorkspaceDir(options.conversationId)
  baseSystemParts.push(
    `[工作区目录]: ${workspaceDir}\n` +
    `- 当前任务已绑定的稳定目录；侧栏切换不会改变本轮路径。file_ops / run_command / image_gen 未指定绝对路径时默认在此目录操作\n` +
    `- 路径解析规则:\n` +
    `  · 绝对路径(如 C:\\foo\\bar.txt)按字面解析\n` +
    `  · 相对路径(如 out.md、data/x.json)解析到工作区内\n` +
    `  · '.' 或空字符串表示工作区根\n` +
    `- 查看工作区内容请调用 file_ops({action:'tree', path:'.'}) 或 ({action:'list', path:'.'})\n` +
    `- 向用户交付生成的文件时，在回复里用反引号包裹完整绝对路径（如 \`C:\\foo\\bar.png\`），客户端会自动为该路径生成「打开所在目录」按钮`
  )

  try {
    baseSystemParts.push(pythonPromptText())
  } catch (e: any) {
    console.error('[chat] python runtime context failed:', e?.message || e)
  }

  // D-21 当前文件夹工作区 + D-20 品牌工作区提示
  try {
    const activeWs = currentWorkspace
    if (activeWs) {
      const lines = [
        `[当前工作区]: ${activeWs.name}`,
        `- 根目录: ${activeWs.root_path}`,
        `- file_ops / 生图未指定绝对路径时默认在此目录操作`,
        `- 约定子目录: docs/（文档规范） assets/（参考图） output/（生图产出）`
      ]
      if (activeWs.kb_category_id) {
        lines.push(`- 已绑定文档库分类，相关规范会通过知识库检索注入`)
      }
      baseSystemParts.push(lines.join('\n'))
    }
  } catch (e: any) {
    console.error('[chat] agent workspace context failed:', e?.message || e)
  }

  // D-20 品牌工作区（若会话仍挂旧品牌包）
  if (conv.brand_workspace_id) {
    try {
      const brand = getBrandWorkspace(conv.brand_workspace_id)
      if (brand) {
        const lines = [
          `[品牌工作区]: ${brand.name}`,
          brand.description ? `- 简介: ${brand.description}` : '',
          `- 品牌文档规范已通过知识库检索注入（请据此撰写生图提示词，遵守色值/话术/禁忌）`,
          brand.output_dir
            ? `- 品牌产出目录（跨会话）: ${brand.output_dir}\n  · 本会话生图会自动额外归档到此目录（无需再传 output_dir）\n  · 仍可显式传 output_dir 覆盖会话工作区落点；未指定时默认落在会话工作区 images/`
            : '',
          brand.gallery_category_id
            ? `- 品牌参考图在本地图库分类 id=${brand.gallery_category_id}（用户可从附件/图库选取；勿假设你能直接枚举图库）`
            : ''
        ].filter(Boolean)
        baseSystemParts.push(lines.join('\n'))
      }
    } catch (e: any) {
      console.error('[chat] brand workspace context failed:', e?.message || e)
    }
  }

  // ask_user：需要用户在多个选项间拍板/澄清时，弹内嵌选项卡而非长文罗列。对所有智能体可用。
  baseSystemParts.push(
    `[向用户提问（ask_user 工具）]:\n` +
    `- 当需求有歧义、有多个合理方向、或涉及需要用户决策的取舍（风格/方案/范围等）时，调用 ask_user 弹出可点击的选项卡，让用户选择后再继续\n` +
    `- 强制：凡是要让用户在若干选项里挑选，一律用 ask_user 弹卡；绝不要在回复正文里用「1. 2. 3.」或顿号罗列选项让用户打字回答\n` +
    `- 用法：ask_user({questions:[{question:<问题>, options:[{id?,label,desc?}], allow_multiple?:bool, allow_free_input?:bool}, ...]})——需要用户在多个维度上做选择时，一次把多个问题都放进 questions（用户会逐题作答），不要为每个问题分别多次调用\n` +
    `- 工具会阻塞等待用户选择并把结果返回给你，据此继续；用户取消/超时会返回 canceled，此时不要重试，等待用户进一步指示\n` +
    `- 仅在确实需要用户拍板时使用；可由你自行合理决定的琐碎默认值不要用它来问，避免打扰`
  )

  baseSystemParts.push(
    `[内置浏览器（browser 工具）]:\n` +
    `- 应用会弹出独立浏览器窗口，Cookie 按 Profile 隔离；未指定 profile_id 时用默认 Profile\n` +
    `- 流程：open({url}) 打开页面（返回 elements 与 ref）→ click({ref}) / type({ref,text,submit?})；看不清再用 screenshot（截图落盘，用路径引用，禁止把图片内容读进上下文）\n` +
    `- 登录、验证码、支付、人机校验请让用户在窗口里亲手完成，完成后 snapshot 再继续\n` +
    `- 需要换账号时用 list_profiles，或请用户在侧栏「浏览器」新建 Profile`
  )

  // v0.6.6+ 智能体「调用生图能力」总开关：关时不给 LLM 注入任何生图相关信息（默认默认生图模型、工作流说明），
  // 避免某些小型模型看到 image_gen tool 定义后误调。同时 buildToolsList 也会过滤掉 image_gen tool，双重防护。
  if (bot.enable_image_gen) {
    // 会话默认生图模型：告知 LLM 调 image_gen 时可以跳过 list_providers，减少一轮 tool call。
    // 不告知（conv 未设）时走原本路径：LLM 先 list_providers 拿完整服务商列表再 generate。
    if (conv.active_image_provider_id && conv.active_image_model_id) {
      baseSystemParts.push(
        `[当前会话默认生图模型]:\n` +
        `- model_provider_id: ${conv.active_image_provider_id}\n` +
        `- model_id: ${conv.active_image_model_id}\n` +
        `- 调用 image_gen 工具且用户未明确指定服务商或模型时，直接用此默认值 generate，不必先调 list_providers\n` +
        `- 用户明确说"用某某服务商/某某模型"时应 list_providers 查找后再 generate`
      )
    }

    if (imageAttachmentRefs.length > 0) {
      const refList = imageAttachmentRefs
        .map((r, i) => `${i + 1}. id=${r.id}, name=${r.name}`)
        .join('\n')
      baseSystemParts.push(
        `[可用于生图参考的最近图片附件]:\n${refList}\n` +
        `- 若用户要求基于附件、参考图、修改图片或延续上一张图，调用 image_gen 时可传 ref_image_ids: ["附件id"]\n` +
        `- 若用户本轮刚上传了图片并要求生图/改图，即使不传 ref_image_ids，系统也会自动把本轮图片作为参考图注入\n` +
        `- 不要把图片 data URI/base64 原文写进 ref_images，优先使用 ref_image_ids`
      )
    }

    // 图片生成工作流约定：image_gen 是 fire-and-forget 异步工具，避免阻塞对话 30-90 秒。
    // 工具立即返回 status:'pending'，后台异步生成；完成后系统自动追加图片消息到对话流。
    baseSystemParts.push(
      `[图片生成工作流（异步、不等图）]:\n` +
      `- 用户请求绘图/生成图片时：只要主体明确（如"画只猫"），就直接把需求补全为高质量提示词并调用 image_gen({action:'generate', prompt:<提示词>}) 一次，不要用文字反问一堆问题\n` +
      `- 关于尺寸：用户没明确说尺寸/比例时，务必不要传 size 参数（留空）——系统会自动弹出「生图参数确认卡」让用户选择尺寸/分辨率/画质/张数；只有用户明确指定了尺寸或比例（如"画个 16:9 的"）时才传对应 size\n` +
      `- 不要传 quality / 分辨率 / 张数参数，也不要用文字向用户询问尺寸/清晰度/数量；这些统一由系统的参数确认卡处理\n` +
      `- 若确需先确认创意方向（如风格、用途），用 ask_user 弹卡询问，不要用文字罗列选项\n` +
      `- 工具会**立即返回 status:'pending'**，表示任务已提交。这是正常的——不要等图、不要重试、不要再次调用\n` +
      `- 收到 pending 后用一句话简短告诉用户："已为你提交生图任务，约 30-90 秒后图片会自动出现在对话和右上角"，然后立即结束本轮回复\n` +
      `- 不要在回复里嵌入 markdown 图片：图片还没生成完，url 此刻并不存在\n` +
      `- 生成完成后系统会自动追加一条 assistant 消息（含 markdown 图片）到对话，无需你做任何操作\n` +
      `- 用户在等待期间可以继续聊天，你正常回应即可。新一轮请求若再次需要画图，再次调用 image_gen\n` +
      `- 不要在调用前列出 providers，不要重复调用\n` +
      `- 失败时（tool 返回 error 字段）：简要说明原因并给出建议，不要重试`
    )
    if (brandImageTurn && brandUserOverride) {
      baseSystemParts.push('[品牌硬卡片]\n- 本轮用户覆盖品牌约束，不要把品牌色/禁忌写入 image_gen.prompt。')
    } else if (brandImageTurn && brandCard) {
      baseSystemParts.push(formatCardForSystem(brandCard, brandMustTokens, brandNote))
    } else if (brandImageTurn && brandNote) {
      baseSystemParts.push(`[品牌硬卡片]\n- ${brandNote}`)
    }
  }

  // 服务商默认系统提示词（如 JanusOS 格式约束），放在人设之前、工具说明之后
  const modelSystemPrompt = getProviderSystemPrompt(effectiveProviderId)
  if (modelSystemPrompt) {
    baseSystemParts.push(modelSystemPrompt)
  }

  // System prompt from persona；未绑智能体且服务商未写提示词时用默认身份
  const employeeContext = compileDigitalEmployeeContext(bot.id, resolvedWorkspace.workspaceId)
  if (employeeContext) baseSystemParts.push(employeeContext)
  let hasBotPersona = false
  if (bot.persona_id) {
    const persona = getPersona(bot.persona_id)
    if (persona) {
      baseSystemParts.push(persona.system_prompt)
      hasBotPersona = true
    } else if (!modelSystemPrompt) {
      baseSystemParts.push(DEFAULT_CHAT_SYSTEM_PROMPT)
    }
  } else if (!modelSystemPrompt) {
    baseSystemParts.push(DEFAULT_CHAT_SYSTEM_PROMPT)
  }

  if (!isVoiceOverride(options.content) && currentWorkspace) {
    const voiceBlock = formatVoiceForSystem(loadVoice(currentWorkspace.root_path), hasBotPersona)
    if (voiceBlock) baseSystemParts.push(voiceBlock)
  }

  messages.push({ role: 'system', content: baseSystemParts.join('\n\n') })

  if (options.extraSystemPrompt) {
    messages.push({ role: 'system', content: options.extraSystemPrompt })
  }

  // RAG: retrieve relevant knowledge base context
  if (effectiveKbCategoryIds.length > 0) {
    try {
      // Collect all KB IDs for the bot's categories（复用预读数据）
      const kbIds: string[] = []
      for (const catId of effectiveKbCategoryIds) {
        const kbs = kbDataByCategory.get(catId) || []
        for (const kb of kbs) {
          if (kb.status === 'ready' || kb.status === 'stale') kbIds.push(kb.id)
        }
      }

      if (kbIds.length > 0) {
        // Build enhanced query: combine recent history for multi-turn context
        //（复用入口已读入的 history，不再重复全量 getMessages）
        const recentPairs = history
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .slice(-4) // last 2 rounds
        const historyContext = recentPairs
          .map((m) => (m.role === 'user' ? `Q: ${m.content}` : `A: ${m.content}`))
          .join('\n')
        const ragUserQuery =
          brandImageTurn && brandCard && !brandUserOverride
            ? rewriteImageRagQuery(options.content, brandCard)
            : options.content
        const enhancedQuery = historyContext
          ? `${historyContext}\nQ: ${ragUserQuery}`
          : ragUserQuery
        const queryEmbed = await embedText(enhancedQuery, { signal })
        const results = searchHybrid(queryEmbed.embedding, ragUserQuery, kbIds, 5, 0.3)

        if (results.length > 0) {
          // 收集 KB id → name 映射，便于在召回片段里附上"来源文档名"（复用预读数据）
          const kbNameMap = new Map<string, string>()
          for (const catId of effectiveKbCategoryIds) {
            for (const kb of kbDataByCategory.get(catId) || []) {
              if (kb.status === 'ready' || kb.status === 'stale') kbNameMap.set(kb.id, kb.name)
            }
          }
          const context = results
            .map((r, i) => {
              const score = Math.round(r.score * 1000) / 1000
              const source = kbNameMap.get(r.chunk.knowledge_base_id) || '未知文档'
              return `[${i + 1}] (相关度 ${score}, 来源: ${source})\n${r.chunk.content}`
            })
            .join('\n\n')
          const ragRules =
            brandImageTurn && !brandUserOverride
              ? '使用规则：\n' +
                '- 片段只补充题材与文案；色值、禁用、Logo 以品牌硬卡片为准，冲突时丢片段；\n' +
                '- 不要把片段原文写入 image_gen.prompt，只把 [品牌must_tokens] 写入 prompt 末尾；\n' +
                '- 若片段与当前生图主题无关可忽略。'
              : '使用规则：\n' +
                '- 若上述片段已能回答用户问题，请基于片段直接回答，并在结尾用「来源：xxx」形式标注被引用的文档；\n' +
                '- 若上述片段相关度普遍偏低（score < 0.4）或与用户当前问题方向不符，请调用 kb_search 用重写过的 query 重新检索；\n' +
                '- 若用户问的是"知识库里有什么/有哪些文档"等元问题，请调用 kb_list 列出清单；不要凭这 5 个片段瞎猜全库内容。'
          messages.push({
            role: 'system',
            content:
              `以下是从知识库初次检索到的 ${results.length} 个片段（按相关性降序）：\n\n${context}\n\n` +
              ragRules
          })
          const topScore = Math.round(results[0].score * 1000) / 1000
          console.log(`[chat] RAG: found ${results.length} relevant chunks from ${kbIds.length} KBs (top score=${topScore})`)
        } else {
          // 0 命中也要告知模型，避免它误以为"没注入就是没启用"
          messages.push({
            role: 'system',
            content:
              '本次基于用户问题的初次检索未命中任何知识库片段（topK=5, threshold=0.3）。\n' +
              '如果用户问题确实与知识库主题相关，请调用 kb_search 用重写过的 query 重新检索；' +
              '如果是元问题（"库里有什么"），请调用 kb_list。'
          })
          console.log(`[chat] RAG: 0 chunks matched from ${kbIds.length} KBs`)
        }
      }
    } catch (e: any) {
      if (signal.aborted) throw new AbortedError()
      // 静默失败会让用户误以为"模型在用知识库实际没用"。把失败原因通过 system 告诉模型，让它能向用户澄清。
      console.log(`[chat] RAG retrieval failed: ${e.message}`)
      messages.push({
        role: 'system',
        content:
          `本次知识库初次检索失败（原因：${e.message || '未知错误'}）。\n` +
          '如果用户问题与知识库相关，请调用 kb_search 重试；如果重试仍失败，请明确告知用户"知识库检索暂时不可用"，不要假装查到了内容。'
      })
    }

    // Knowledge-base-only constraint
    if (bot.kb_only && effectiveKbCategoryIds.length > 0) {
      messages.push({
        role: 'system',
        content:
          '重要约束：你只能根据知识库内容回答问题。\n' +
          '- 如果初次召回的片段足够准确，直接基于片段回答并标注来源；\n' +
          '- 如果初次召回不足或不相关，必须先调用 kb_search 至少一次用重写过的 query 重新检索后再判断；\n' +
          '- 仅当多次检索仍无相关内容时，才回答"知识库中未找到相关信息"，不要凭常识或预训练知识编造或推测答案。'
      })
    }
  }

  // Cloud KB RAG: 在线检索云控端线上知识库（hybrid：云端为主 + 本地缓存降级），与本地 RAG 并列注入
  if (hasCloudKb) {
    try {
      const cloudRes = await searchCloudKnowledgeBases({
        agentId: bot.cloud_agent_id,
        query: options.content,
        kbIds: effectiveCloudKbIds,
        topK: bot.cloud_kb_top_k || 5,
        signal
      })
      if (signal.aborted) throw new AbortedError()

      if (cloudRes.hits.length > 0) {
        const offlineTag = cloudRes.source === 'cache' ? '（离线缓存，可能非最新）' : ''
        const context = cloudRes.hits
          .map((h, i) => {
            const score = Math.round(h.score * 1000) / 1000
            const source = [h.kb_name, h.source_doc].filter(Boolean).join(' / ') || '云端知识库'
            return `[${i + 1}] (相关度 ${score}, 来源: ${source})\n${h.content}`
          })
          .join('\n\n')
        messages.push({
          role: 'system',
          content:
            `以下是从云端线上知识库检索到的 ${cloudRes.hits.length} 个片段${offlineTag}（按相关性降序）：\n\n${context}\n\n` +
            '使用规则：\n' +
            '- 若片段已能回答用户问题，请基于片段直接回答，并在结尾用「来源：xxx」标注被引用的文档；\n' +
            '- 若片段相关度偏低或方向不符，可调用 kb_search 用重写过的 query 重新检索（会同时检索云端知识库）。'
        })
        console.log(`[chat] Cloud KB RAG: ${cloudRes.hits.length} hits (source=${cloudRes.source})`)
      } else if (cloudRes.unavailableReason) {
        // 余额不足等导致云端检索停用：如实告知 LLM，避免它以为"知识库为空"而编造
        messages.push({
          role: 'system',
          content:
            `云端线上知识库当前不可用（原因：${cloudRes.unavailableReason}）。\n` +
            '请如实告知用户"线上知识库暂时不可用（云端余额不足），请充值后重试"，不要编造知识库内容。'
        })
        console.log(`[chat] Cloud KB RAG unavailable: ${cloudRes.unavailableReason}`)
      } else {
        messages.push({
          role: 'system',
          content:
            '本次云端知识库初次检索未命中（或云端暂不可用）。\n' +
            '如果用户问题与知识库相关，请调用 kb_search 用重写过的 query 重新检索。'
        })
        console.log('[chat] Cloud KB RAG: 0 hits')
      }
    } catch (e: any) {
      if (signal.aborted) throw new AbortedError()
      console.log(`[chat] Cloud KB RAG failed: ${e.message}`)
      messages.push({
        role: 'system',
        content:
          `本次云端知识库检索失败（原因：${e.message || '未知错误'}）。\n` +
          '如果用户问题与知识库相关，请调用 kb_search 重试；若仍失败请如实告知用户"线上知识库暂时不可用"，不要编造内容。'
      })
    }

    // 云端知识库 kb_only 约束
    if (bot.cloud_kb_only) {
      messages.push({
        role: 'system',
        content:
          '重要约束：你应优先依据云端线上知识库内容回答；召回不足时先调用 kb_search 重新检索，多次无果才回答"知识库中未找到相关信息"，不要凭常识编造。'
      })
    }
  }

  // Inject prompt skill guidance
  const allPromptSkills = listPromptSkills().filter((s) => s.enabled)
  const botPromptSkills = effectivePromptSkillMode === 'selected'
    ? allPromptSkills.filter((s) => effectivePromptSkillDirs.includes(s.dirName))
    : allPromptSkills
  if (botPromptSkills.length > 0) {
    const names = botPromptSkills.map((s) => s.name).join(', ')
    messages.push({
      role: 'system',
      content: `你有以下 Skills 技能可用：${names}。当用户的请求与某个技能的能力匹配时，必须先调用 use_skill 工具加载该技能的完整指令，然后严格按照技能指令来完成任务。不要跳过技能直接回答。`
    })
  }

  // Inject existing summary as context
  const existingSummary = getSummary(options.conversationId)
  if (existingSummary && existingSummary.summary) {
    messages.push({
      role: 'system',
      content: `以下是之前对话的摘要，请在回答时参考：\n${existingSummary.summary}`
    })
  }

  // 历史图片衰减：仅保留最近 IMAGE_HISTORY_KEEP_ROUNDS 条「带图」user 消息的图片进上下文，
  // 更早的以占位文本替代（生图参考图另走 imageAttachmentRefs，不受此影响）。
  const imageKeepMsgIds = new Set<string>()
  {
    let keptImageRounds = 0
    for (let i = history.length - 1; i >= 0 && keptImageRounds < IMAGE_HISTORY_KEEP_ROUNDS; i--) {
      const m = history[i]
      if (m.role === 'user' && Array.isArray(m.attachments) && m.attachments.some((a: any) => a.type === 'image')) {
        imageKeepMsgIds.add(m.id)
        keptImageRounds++
      }
    }
  }

  // 文档 RAG 只对「窗口内」的消息执行：此前对全量历史的每个大文档都重跑分块+向量化，
  // 产物又被窗口切片丢弃（窗口外纯白算）、窗口内因 query 冻结逐轮完全相同（确定性重复计费）。
  // 处理边界与窗口同口径（最近 RECENT_ROUNDS 个 user 消息起）。
  const ragWindowStart = (() => {
    let seen = 0
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i]
      if (m.role === 'user' && !m.card) {
        seen++
        if (seen > RECENT_ROUNDS) return i + 1
      }
    }
    return 0
  })()
  let historyIdx = -1

  // Convert history to ChatMessage array
  const historyMessages: ChatMessage[] = []
  for (const msg of history) {
    historyIdx++
    // UI-only 交互卡片消息（ask_user / 生图参数卡）不发给模型：它只承载渲染留痕，
    // 且夹在 assistant.tool_calls 与 tool 结果之间，混入会破坏 OpenAI 的 tool 配对。
    if (msg.card) continue
    const inRagWindow = historyIdx >= ragWindowStart
    if (msg.role === 'user') {
      if (msg.attachments && msg.attachments.length > 0) {
        const contentParts: any[] = [{ type: 'text', text: msg.content }]
        for (const att of msg.attachments) {
          if (att.type === 'image') {
            if (inRagWindow && imageKeepMsgIds.has(msg.id)) {
              contentParts.push({
                type: 'image_url',
                image_url: { url: att.data }
              })
            } else {
              contentParts.push({ type: 'text', text: `[历史图片已省略：${att.name || 'image'}]` })
            }
          } else if (att.type === 'document' && att.data) {
            const MAX_DOC_CHARS = 8000
            if (!inRagWindow) {
              // 窗口外文档：不重跑向量召回（产物注定被窗口切片丢弃），直接省略占位
              contentParts.push({ type: 'text', text: `[历史文档已省略：${att.name || 'document'}]` })
            } else if (att.data.length <= MAX_DOC_CHARS) {
              contentParts.push({ type: 'text', text: `[${att.name}]\n${att.data}` })
            } else {
              // Large doc: try RAG retrieval (content-fingerprint cached), fallback to truncation
              let docText: string
              const cacheKey = docRagCacheKey(att.data, String(msg.content || ''))
              const cached = docRagCache.get(cacheKey)
              try {
                if (cached !== undefined) {
                  docText = cached
                } else {
                  docText = await retrieveRelevantChunks(att.data, msg.content, att.name, signal)
                  docRagCache.set(cacheKey, docText)
                  if (docRagCache.size > DOC_RAG_CACHE_CAP) {
                    const first = docRagCache.keys().next().value
                    if (first !== undefined) docRagCache.delete(first)
                  }
                }
              } catch (e) {
                if (signal.aborted) throw e
                docText = att.data.slice(0, MAX_DOC_CHARS) + `\n...(truncated, ${att.data.length} chars total)`
              }
              contentParts.push({ type: 'text', text: `[${att.name}]\n${docText}` })
            }
          }
        }
        historyMessages.push({ role: 'user', content: contentParts })
      } else {
        historyMessages.push({ role: 'user', content: msg.content })
      }
    } else if (msg.role === 'assistant') {
      const replayToolCalls = compactToolCalls(msg.tool_calls)
      if (replayToolCalls && replayToolCalls.length > 0) {
        // Replay full assistant.tool_calls block — but only if every tool_call has a paired tool result
        // later in history (otherwise the OpenAI API rejects it).
        const toolCallIds = replayToolCalls.map((tc: any) => tc?.id).filter(Boolean)
        const allPaired = toolCallIds.length > 0 && toolCallIds.every((id: string) =>
          history.some((m) => m.role === 'tool' && m.tool_call_id === id)
        )
        if (allPaired) {
          historyMessages.push({
            role: 'assistant',
            content: msg.content || '',
            tool_calls: replayToolCalls
          } as any)
        }
        continue
      }
      historyMessages.push({ role: 'assistant', content: msg.content })
    } else if (msg.role === 'tool') {
      // Replay tool result paired to a previously-emitted assistant tool_call.
      if (!msg.tool_call_id) continue
      const lastAssistant = [...historyMessages].reverse().find((m) => m.role === 'assistant') as any
      const isPairedAbove = lastAssistant?.tool_calls?.some((tc: any) => tc?.id === msg.tool_call_id)
      if (!isPairedAbove) continue
      historyMessages.push({
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.tool_call_id
      } as any)
    }
  }

  // Sliding window: keep recent rounds, trim if exceeding the model's prompt budget.
  const systemTokens = estimateMessagesTokens(messages)
  const promptBudget = getModelPromptBudget(effectiveModelId)
  const budget = promptBudget - systemTokens
  // 按「轮」切（user 消息为界）：保留最近 RECENT_ROUNDS 个用户提问及其完整应答链。
  // 此前按「12 条全角色消息」切——工具密集轮里 tool 消息挤占窗口，把用户原始请求顶出去
  let included: ChatMessage[]
  {
    const userIdx: number[] = []
    historyMessages.forEach((m, i) => { if (m.role === 'user') userIdx.push(i) })
    const startIdx = userIdx.length > RECENT_ROUNDS ? userIdx[userIdx.length - RECENT_ROUNDS] : 0
    included = repairHistoryHead(historyMessages.slice(startIdx))
  }
  while (included.length > 2 && estimateMessagesTokens(included) > budget) {
    included = included.slice(2)
    included = repairHistoryHead(included)
  }
  messages.push(...included)

  // Build tools list from skills and MCP (KB tools auto-included when KB enabled)
  const tools = buildToolsList(effectiveSkillIds, effectiveMcpIds, effectivePromptSkillDirs, effectivePromptSkillMode, effectiveKbCategoryIds, !!bot.enable_image_gen, effectiveCloudKbIds, !!bot.enable_deck)

  const systemCount = messages.length - included.length
  console.log(`[chat] context: ${systemCount} system + ${included.length} history msgs, ~${estimateMessagesTokens([...messages])} tokens, ${tools.length} tools`)

  // Call LLM with multi-round tool call loop (agent mode)
  // 25 轮上限对齐主流 AI 编辑器（Cursor agent ~25）。整轮真正卡死由
  // stream idle timeout（llm.ts）+ 30 分钟 hard deadline 兜底检测。
  // 单轮工具调用步数上限:默认 40(对长任务更友好)，bot 可通过 max_tool_rounds 覆盖(0=用默认)。
  // 到顶不静默丢弃，而是追加"可续跑"提示(见下方 round >= MAX_TOOL_ROUNDS 分支)，配合修复 bug1。
  const DEFAULT_MAX_TOOL_ROUNDS = 40
  const MAX_TOOL_ROUNDS = bot.max_tool_rounds && bot.max_tool_rounds > 0 ? bot.max_tool_rounds : DEFAULT_MAX_TOOL_ROUNDS
  /** 上下文溢出自愈只重试一次（防死循环） */
  let overflowRetried = false
    // 脱离沙箱白名单工具：能任意读写文件 / 执行任意命令，安全级别等同 run_command。
    // 即便智能体审批模式为 off 也强制弹一次确认，作为越权操作的安全兜底。
    const unsandboxedToolNames = new Set<string>(
      listSkills()
        .filter((s) => effectiveSkillIds.includes(s.id) && s.enabled && !s.is_builtin && s.unsandboxed)
        .map((s) => s.function_def?.name as string)
        .filter(Boolean)
    )
    // MCP 工具中显式声明 readOnlyHint=true 的免审批集合（destructive 模式下纯查询免确认，降低交互摩擦）。
    // 排除与核心工具 / use_skill / 已启用小工具同名者：executeToolCall 按名路由时这些优先命中，
    // 不能让 MCP 工具借同名声明把高危工具「洗」成免审批。
    const enabledSkillToolNames = new Set<string>(
      listSkills()
        .filter((s) => effectiveSkillIds.includes(s.id) && s.enabled)
        .map((s) => s.function_def?.name as string)
        .filter(Boolean)
    )
    const mcpReadOnlyToolNames = new Set<string>()
    for (const mcpId of effectiveMcpIds) {
      const mcpServer = getMcpServer(mcpId)
      if (!mcpServer || !mcpServer.enabled) continue
      for (const t of mcpServer.tools) {
        const n = t?.name
        if (!n || CORE_TOOL_NAMES.includes(n) || n === 'use_skill' || enabledSkillToolNames.has(n)) continue
        if (t?.annotations?.readOnlyHint === true) mcpReadOnlyToolNames.add(n)
      }
    }
    // 元工具中 mcp_list_servers / mcp_describe_tools 是纯只读发现接口（仅读本地 mcp_servers 表
    // 与已缓存的 tools schema，不发起 MCP RPC），免审批；mcp_call 不加入此集合，审批时按
    // args.tool 反查目标工具的 readOnlyHint 动态判定（见 needsApproval 调用处）。
    mcpReadOnlyToolNames.add('mcp_list_servers')
    mcpReadOnlyToolNames.add('mcp_describe_tools')
    let currentMessages: ChatMessage[] = [...messages]
    let round = 0
    // 工具失败熔断历史(贯穿本次 sendMessage 的整个工具循环)
    const toolHistory: ToolHistoryEntry[] = []
    let criticalBreakerReason: string | null = null

    while (round <= MAX_TOOL_ROUNDS) {
      if (signal.aborted) throw new AbortedError()
      // 每轮调用前压缩 loop 内累积的上下文（先压旧工具结果，仍超预算再硬裁），防止逼近上限 → terminated。
      currentMessages = compactAgentContext(currentMessages, systemCount, budget)
      // 发送前净化:删空消息 / 修 tool 配对 / 合并连续 user，防止脏历史导致 replay 持续失败(bug2/bug3)
      currentMessages = sanitizeOpenAIMessages(currentMessages)
      const t0 = Date.now()
      let response: any
      try {
        response = await callLLM(
          effectiveProviderId,
          {
            modelId: effectiveModelId,
            messages: currentMessages,
            tools: tools.length > 0 ? tools : undefined,
            stream: true,
            signal,
            streamContext: { conversationId: options.conversationId, requestId },
            // 桥接/后台（window=null）：允许「已产出后断流」整次重试，避免任一轮断流整轮判死
            allowPartialRetry: !window
          },
          window
        )
      } catch (llmErr: any) {
        // 上下文溢出自愈：对话区砍半后重试一次（此前 400 直接整轮判死，且窗口封顶致次次复发）
        if (!overflowRetried && isContextOverflowError(String(llmErr?.message || ''))) {
          overflowRetried = true
          console.warn('[chat] context overflow, shrink conversation area and retry once')
          const tail = repairHistoryHead(currentMessages.slice(systemCount).slice(-4))
          currentMessages = [...currentMessages.slice(0, systemCount), ...tail]
          currentMessages = sanitizeOpenAIMessages(currentMessages)
          response = await callLLM(
            effectiveProviderId,
            {
              modelId: effectiveModelId,
              messages: currentMessages,
              tools: tools.length > 0 ? tools : undefined,
              stream: true,
              signal,
              streamContext: { conversationId: options.conversationId, requestId },
              allowPartialRetry: !window
            },
            window
          )
        } else {
          throw llmErr
        }
      }

      response.tool_calls = compactToolCalls(response.tool_calls)
      console.log(`[chat] round ${round}: LLM response in ${Date.now() - t0}ms, content: ${response.content.length} chars, tool_calls: ${response.tool_calls?.length || 0}`)

      // No tool calls → final response, save and break
      if (!response.tool_calls || response.tool_calls.length === 0) {
        let finalContent = response.content
        let finalReasoning = response.reasoning || ''
        // 空响应防护:绝不落空 assistant（空消息会毒化历史，导致后续每轮 replay 持续失败，
        // 即 bug2/bug3 的根因之一）。先重试一次强制出文本，仍空则落一条友好提示（非空合法消息）。
        if (!finalContent || !finalContent.trim()) {
          console.warn('[chat] empty assistant response, retrying once')
          try {
            if (signal.aborted) throw new AbortedError()
            const retry = await callLLM(
              effectiveProviderId,
              {
                modelId: effectiveModelId,
                messages: currentMessages,
                stream: true,
                signal,
                streamContext: { conversationId: options.conversationId, requestId },
                allowPartialRetry: !window
              },
              window
            )
            finalContent = retry.content
            finalReasoning = retry.reasoning || finalReasoning
          } catch (e: any) {
            if (isAbortedError(e)) throw e
            // 可分类硬错误（余额/鉴权/限流/4xx）向上抛走 [Error] 落库路径——
            // 不吞成伪装正常的道歉回复（那会把系统故障归因给用户、诱导无效改写）
            const em = String(e?.message || '')
            if (/余额不足|INSUFFICIENT_BALANCE|Token expired|Cloud login required|rate limit|Rate limit|LLM API error 4\d\d/i.test(em)) throw e
            console.warn('[chat] empty-response retry failed:', e?.message)
          }
          if (!finalContent || !finalContent.trim()) {
            finalContent = '模型这次没有返回内容，请稍后重试。'
            emitStream({ type: 'content', content: finalContent })
          }
        }
        addMessage({
          conversation_id: options.conversationId,
          role: 'assistant',
          content: finalContent,
          reasoning: finalReasoning
        })
        break
      }

      // Save assistant message with tool calls
      addMessage({
        conversation_id: options.conversationId,
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls
      })

      // Append assistant message to context
      currentMessages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls
      })

      // Notify renderer which tools are being called
      const toolNames = response.tool_calls.map((tc: any) => tc?.function?.name || 'unknown')
      emitStream({ type: 'tool_start', tools: toolNames })

      // Pass 1 (serial): approval gate, collect rejections eagerly so the user sees them paired with the right call.
      type Plan = { toolCall: any; fnName: string; argsHash?: string; noRecord?: boolean; result?: any; resultStr?: string }
      const plans: Plan[] = []
      const sandboxDir = getWorkspaceDir(options.conversationId)
      for (const toolCall of response.tool_calls) {
        if (signal.aborted) throw new AbortedError()
        if (!toolCall?.function) continue
        const fnName = toolCall.function?.name || 'unknown'
        let parsedArgs: any = {}
        try { parsedArgs = JSON.parse(toolCall.function?.arguments || '{}') } catch {}

        if (fnName === 'image_gen' && parsedArgs?.action === 'generate') {
          let mutated = false
          if (!parsedArgs.model_provider_id && conv.active_image_provider_id) {
            parsedArgs.model_provider_id = conv.active_image_provider_id
            mutated = true
          }
          if (!parsedArgs.model_id && conv.active_image_model_id) {
            parsedArgs.model_id = conv.active_image_model_id
            mutated = true
          }
          if (parsedArgs.quality !== 'auto') {
            parsedArgs.quality = 'auto'
            mutated = true
          }
          const refImages = resolveImageGenRefImages(parsedArgs, imageAttachmentRefs, currentTurnImageAttachmentRefs, options.content)
          if (refImages.length > 0) {
            parsedArgs.ref_images = refImages
            mutated = true
          }
          if (mutated && toolCall.function) {
            toolCall.function.arguments = JSON.stringify(parsedArgs)
            console.log(`[chat] image_gen args normalized: provider=${parsedArgs.model_provider_id || ''}, model=${parsedArgs.model_id || ''}, refs=${parsedArgs.ref_images?.length || 0}`)
          }
        }

        // 工具失败熔断 / 循环检测:同参反复失败或重复调用时提前止损，避免烧满轮数与大量 token
        const argsHash = hashToolArgs(parsedArgs)
        const breaker = checkToolCircuitBreaker(toolHistory, fnName, argsHash)
        if (breaker.stop) {
          console.warn(`[chat] tool circuit breaker: ${breaker.reason}`)
          // 记录为失败:使持续的重复/失败调用累积升级到 critical 中止，而非每轮一次 LLM 调用烧满轮数
          toolHistory.push({ name: fnName, argsHash, success: false })
          plans.push({
            toolCall,
            fnName,
            argsHash,
            noRecord: true,
            resultStr: JSON.stringify({ error: breaker.reason, tool: fnName })
          })
          emitStream({ type: 'tool_result', tool: fnName, summary: '[已熔断]' })
          if (breaker.critical) criticalBreakerReason = breaker.reason
          continue
        }

        // mcp_call 元工具：审批语义按目标 MCP 工具的 readOnlyHint 判定（不能让收敛入口
        // 把高危工具洗成默认免审批，也不能把只读工具变成每次都弹审批）。
        // 把目标工具名映射给 needsApproval 判定，命中 mcpReadOnlyToolNames 则 destructive 模式免审批。
        let approvalToolName = fnName
        let approvalToolArgs = parsedArgs
        if (fnName === 'mcp_call') {
          const targetName = String(parsedArgs?.tool || '')
          if (targetName) {
            approvalToolName = targetName
            approvalToolArgs = parsedArgs?.args && typeof parsedArgs.args === 'object' ? parsedArgs.args : {}
          }
        }
        // 脱离沙箱工具强制确认（忽略审批模式）；其余按智能体审批策略。
        if (unsandboxedToolNames.has(fnName) || needsApproval(effectiveToolApproval, approvalToolName, approvalToolArgs, sandboxDir, mcpReadOnlyToolNames)) {
          const preview = fnName === 'file_ops'
            ? (previewFileWrite(parsedArgs, sandboxDir) || previewFileRead(parsedArgs, sandboxDir))
            : null
          pauseDeadline()
          let verdict: ApprovalVerdict
          try {
            verdict = await requestToolApproval(window, options.conversationId, toolCall, parsedArgs, preview, signal, options.approvalDecider)
          } finally {
            resumeDeadline()
          }
          if (signal.aborted) throw new AbortedError()
          if (verdict !== 'approved') {
            // 超时可辨识：模型应「向用户说明并等待指示」而非按「用户已拍板」改道
            const errText = verdict === 'timeout'
              ? '等待用户确认超时（10 分钟），用户未看到或未回应。请勿重试同一操作，先向用户说明情况并等待指示。'
              : verdict === 'aborted'
                ? '操作已被中止'
                : '用户拒绝了该工具调用'
            plans.push({
              toolCall,
              fnName,
              argsHash,
              noRecord: true,
              resultStr: JSON.stringify({ error: errText, tool: fnName })
            })
            emitStream({ type: 'tool_result', tool: fnName, summary: verdict === 'timeout' ? '[确认超时]' : verdict === 'aborted' ? '[已中止]' : '[已拒绝]' })
            continue
          }
        }
        plans.push({ toolCall, fnName, argsHash })
      }

      // Pass 2 (parallel): execute all approved tools concurrently while preserving call order.
      const pendingExecs = plans.map(async (p) => {
        if (p.resultStr !== undefined) return p
        if (signal.aborted) throw new AbortedError()
        const result = await executeToolCall(
          p.toolCall,
          effectiveSkillIds,
          effectiveMcpIds,
          options.conversationId,
          effectiveKbCategoryIds,
          window,
          signal,
          requestId,
          undefined,
          hasCloudKb ? { kbIds: effectiveCloudKbIds, agentId: bot.cloud_agent_id, topK: bot.cloud_kb_top_k || 5 } : undefined,
          effectiveProviderId,
          effectiveModelId
        )
        // 用户自建技能忘写 return 时 result===undefined：JSON.stringify(undefined) 返回 undefined
        //（不是字符串），会在结果截断处抛 TypeError 炸掉整轮——先兜成可读错误对象
        const safeResult = result === undefined ? { error: '工具未返回任何结果（技能代码可能没有 return）' } : result
        // 工具已经返回字符串（如 use_skill 返回的 markdown skill 正文）就直接用；
        // 再 JSON.stringify 会在原文外面再裹一层引号 + 转义全部 \n 和 "，
        // 使 tool message content 变成 "\"# title\\n...\\n...\""，部分 OpenAI 兼容
        // 上游（deepseek/智谱/豆包/Moonshot 等）拿到这种「双重转义字符串」会触发
        // silent 200 + 空 SSE，表现为「调用工具后 AI 不再回复」。
        const rawResultStr = typeof safeResult === 'string' ? safeResult : JSON.stringify(safeResult)
        const resultStr = offloadOrLimitToolResult(rawResultStr, p.fnName, sandboxDir, round)
        const summary = buildToolSummary(p.fnName, safeResult, resultStr)
        emitStream({ type: 'tool_result', tool: p.fnName, summary })
        return { ...p, result: safeResult, resultStr }
      })
      // 工具执行期心跳：周期性向渲染端报「执行中 Ns」，让 MCP 冷启动握手 / 慢工具的长等待有可见反馈。
      const toolBatchStart = Date.now()
      const heartbeat = setInterval(() => {
        emitStream({ type: 'tool_heartbeat', elapsedMs: Date.now() - toolBatchStart })
      }, TOOL_HEARTBEAT_INTERVAL_MS)
      if (typeof heartbeat.unref === 'function') heartbeat.unref()
      let completed: Plan[]
      try {
        const settled = await Promise.allSettled(pendingExecs)
        // race-safe 收集：已 resolve 的真实结果照常落库；rejected 的补「中断/失败」占位——
        // 不再因单个工具中止把整批已完成结果丢弃（成功工具被标「未完成」会诱导模型盲目重试、副作用重复）
        completed = settled.map((s, i) => {
          if (s.status === 'fulfilled') return s.value
          const p = plans[i]
          const err: any = s.reason
          const errMsg = isAbortedError(err)
            ? '该工具调用被中断，结果未知；如需继续，请先检查当前状态再决定是否重试'
            : String(err?.message || '工具执行异常')
          return { ...p, result: { error: errMsg, tool: p.fnName }, resultStr: JSON.stringify({ error: errMsg, tool: p.fnName }) }
        })
      } finally {
        clearInterval(heartbeat)
      }
      if (signal.aborted) throw new AbortedError()

      // Pass 3 (serial): persist + append in original order so the LLM sees a deterministic transcript.
      for (const p of completed) {
        const resultStr = p.resultStr || ''
        addMessage({
          conversation_id: options.conversationId,
          role: 'tool',
          content: resultStr,
          tool_call_id: p.toolCall.id || ''
        })
        currentMessages.push({
          role: 'tool',
          content: resultStr,
          tool_call_id: p.toolCall.id || ''
        })
        // 记录实际执行的工具结果用于熔断(熔断/拒绝的 plan 标记 noRecord，不计入)
        if (!p.noRecord) {
          toolHistory.push({
            name: p.fnName,
            argsHash: p.argsHash || '',
            success: !isToolFailure(p.result)
          })
        }
      }

      const hasPendingImageGen = completed.some((p) =>
        p.fnName === 'image_gen' &&
        p.result &&
        typeof p.result === 'object' &&
        p.result.status === 'pending'
      )
      if (hasPendingImageGen) {
        const content = '已为你提交生图任务，约 30-90 秒后图片会自动出现在对话和右上角。'
        emitStream({ type: 'tool_done' })
        emitStream({ type: 'content', content })
        addMessage({
          conversation_id: options.conversationId,
          role: 'assistant',
          content
        })
        break
      }

      // 工具熔断 critical(同一工具连续失败过多):中止本轮并友好收尾
      if (criticalBreakerReason) {
        emitStream({ type: 'tool_done' })
        emitStream({ type: 'content', content: criticalBreakerReason })
        addMessage({
          conversation_id: options.conversationId,
          role: 'assistant',
          content: criticalBreakerReason
        })
        break
      }

      round++

      // Safety: if max rounds reached, do one final call without tools
      if (round >= MAX_TOOL_ROUNDS) {
        console.log(`[chat] max tool rounds (${MAX_TOOL_ROUNDS}) reached, final call without tools`)
        emitStream({ type: 'tool_done' })
        if (signal.aborted) throw new AbortedError()
        currentMessages = compactAgentContext(currentMessages, systemCount, budget)
        currentMessages = sanitizeOpenAIMessages(currentMessages)
        const finalResponse = await callLLM(
          effectiveProviderId,
          {
            modelId: effectiveModelId,
            messages: currentMessages,
            stream: true,
            signal,
            streamContext: { conversationId: options.conversationId, requestId },
            allowPartialRetry: !window
          },
          window
        )
        let finalContent = finalResponse.content
        if (!finalContent || !finalContent.trim()) {
          finalContent = `已执行 ${round} 步工具操作，达到单轮步数上限。`
        }
        // 到顶不静默丢弃:追加“可续跑”提示，用户回复“继续”即可接续(长任务如多页 PPT 不丢进度)
        const continueHint = '\n\n（已达单轮步数上限，任务可能尚未完成。回复“继续”我会接着往下做。）'
        finalContent += continueHint
        emitStream({ type: 'content', content: continueHint })
        addMessage({
          conversation_id: options.conversationId,
          role: 'assistant',
          content: finalContent,
          reasoning: finalResponse.reasoning || ''
        })
        break
      }

      // Notify renderer that tool execution is done, next round streaming follows
      emitStream({ type: 'tool_done' })
    }
    // 明确信号只生成“待确认建议”，绝不直接修改岗位资产或权限。
    if (bot.id) {
      const signalMatch = options.content.trim().match(/^(?:请)?(记住|保存为流程|保存为技能|保存为职责|保存为边界|保存为验收)(?:[：:，,\s]|$)/)
      if (signalMatch) {
        const typeBySignal: Record<string, 'knowledge' | 'skill' | 'workflow' | 'responsibility' | 'boundary' | 'acceptance'> = {
          '记住': 'knowledge', '保存为流程': 'workflow', '保存为技能': 'skill', '保存为职责': 'responsibility', '保存为边界': 'boundary', '保存为验收': 'acceptance'
        }
        const candidateType = typeBySignal[signalMatch[1]]
        const latestAssistant = [...getMessages(options.conversationId)].reverse().find((message) => message.role === 'assistant' && message.content.trim())
        if (candidateType && latestAssistant) {
          try {
            const workspaceScoped = candidateType !== 'skill'
            createEmployeeCandidate({
              botId: bot.id,
              conversationId: options.conversationId,
              workspaceId: workspaceScoped ? resolvedWorkspace.workspaceId : '',
              type: candidateType,
              scope: workspaceScoped ? 'workspace' : 'employee',
              title: `${options.content.trim().slice(0, 80)} · 待确认`,
              body: { content: latestAssistant.content },
              evidence: { message_id: latestAssistant.id, trigger: signalMatch[1] }
            })
            const candidateHint = '\n\n[已生成岗位建议，请在数字员工编辑页确认后生效]'
            updateMessageContent(latestAssistant.id, latestAssistant.content + candidateHint)
            emitStream({ type: 'content', content: candidateHint })
          } catch (error: any) {
            console.warn('[chat] explicit employee candidate skipped:', error?.message || error)
          }
        }
      }
    }
    // Auto-generate title on 1st or 5th user message
    maybeGenerateTitle(options.conversationId, effectiveProviderId, effectiveModelId, window)
    // Auto-summarize if history exceeds threshold
    maybeGenerateSummary(options.conversationId, effectiveProviderId, effectiveModelId)
  } catch (error: any) {
    employeeTaskStatus = agentTurnTimedOut ? 'failed' : (isAbortedError(error) ? 'canceled' : 'failed')
    employeeTaskError = String(error?.message || error)
    // 中断自愈:先补全悬空的 assistant.tool_calls 的配对 tool 结果，避免下次 replay 历史非法
    healDanglingToolCalls(options.conversationId)
    // 取出 llm 层透传的「已流式产出的部分内容」，连同中断/报错标记一起落库，
    // 避免用户已经看到的半截回答在刷新后被覆盖丢失。前端流式已展示过 partial，
    // 故 emitStream 只下发标记，由 renderer 追加到已有内容尾部（见 chat store）。
    // 顺序纪律：先 addMessage 落库、再 emitStream 推送——窗口已销毁时推送会抛错，
    // 先推送会导致落库被跳过（半截内容与中断标记全丢）
    const partial = typeof (error as any)?.__partialContent === 'string' ? (error as any).__partialContent : ''
    const withPartial = (marker: string): string => (partial ? `${partial}\n\n${marker}` : marker)
    if (agentTurnTimedOut) {
      const message = '本轮 Agent 执行已超过 30 分钟硬上限，已自动中断'
      addMessage({
        conversation_id: options.conversationId,
        role: 'assistant',
        content: withPartial(`[Error] ${message}`)
      })
      emitStream({ type: 'error', error: message })
    } else if (isAbortedError(error)) {
      const reason = canceledRequestReasons.get(requestId)
      const marker = reason === 'replaced' ? '[上一轮已被新消息中断]' : '[已中断]'
      addMessage({
        conversation_id: options.conversationId,
        role: 'assistant',
        content: withPartial(marker)
      })
      emitStream({ type: 'aborted', content: marker })
    } else {
      addMessage({
        conversation_id: options.conversationId,
        role: 'assistant',
        content: withPartial(`[Error] ${error.message}`)
      })
      emitStream({ type: 'error', error: error.message })
    }
  } finally {
    if (employeeTaskId) {
      try { finishEmployeeTask(employeeTaskId, employeeTaskStatus, employeeTaskError) } catch (error: any) { console.warn('[chat] task run record finish failed:', error?.message || error) }
    }
    clearTimeout(agentTurnTimer)
    deadlineControls.delete(options.conversationId)
    // 轮次真正结束信号：渲染端「reload 后恢复的僵尸流式态」据此收尾重拉
    // （正常路径的清理在 IPC resolve 后由 runStreamedRequest 负责，本事件对它无害冗余）
    try { emitStream({ type: 'round_done' }) } catch { /* ignore */ }
    const active = activeControllers.get(options.conversationId)
    if (active?.controller === abortController) {
      activeControllers.delete(options.conversationId)
    }
    // 串行门放行：收尾（含上方 catch 落库）彻底完成后，等待中的新轮才继续
    doneResolve()
  }
}

// 重新生成最后一轮回复:删除最后一条 user 及其后所有消息，用相同内容重新发送。
export async function regenerateLastResponse(
  conversationId: string,
  window: BrowserWindow | null,
  requestId?: string
): Promise<void> {
  const msgs = getMessages(conversationId)
  let lastUserIdx = -1
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') {
      lastUserIdx = i
      break
    }
  }
  if (lastUserIdx === -1) throw new Error('没有可重新生成的消息')
  const lastUser = msgs[lastUserIdx]
  const conv = getConversation(conversationId)
  if (!conv) throw new Error('Conversation not found')
  // 先校验可发送条件再截断——否则截断已提交而重发失败，截断点之后的历史被静默丢失
  const bot = resolveChatBot(conv.bot_id)
  if (!(conv.active_model_id || bot.model_id)) throw new Error('未选择对话模型，无法重新生成')
  deleteMessagesFrom(conversationId, lastUser.id)
  const stash = lastTurnOverrides.get(conversationId) ?? {}
  await sendMessage(
    { ...stash, conversationId, botId: conv.bot_id, content: lastUser.content, attachments: lastUser.attachments, requestId },
    window
  )
}

// 可「继续生成」的中断/报错尾标正则：标记落库时位于正文末尾（`${partial}\n\n${marker}`），
// 故 [已中断]/[上一轮…] 锚定结尾、[Error] 锚定行首，避免正文里内联出现 "[Error]" 被误判为可继续。
const INTERRUPT_TAIL_RES: RegExp[] = [
  /\n*\[已中断\]\s*$/,
  /\n*\[上一轮已被新消息中断\]\s*$/,
  /(?:^|\n)\[Error\][\s\S]*$/
]

// 剥掉中断/报错尾标，返回已产出的半截正文。
function stripInterruptionMarker(content: string): string {
  let s = content
  for (const re of INTERRUPT_TAIL_RES) s = s.replace(re, '')
  return s.trimEnd()
}

// 判断某条消息是否处于「可继续」状态（末尾带中断/报错标记）。供 UI 决定是否显示「继续生成」。
export function isContinuableContent(content: unknown): boolean {
  if (typeof content !== 'string' || !content) return false
  return INTERRUPT_TAIL_RES.some((re) => re.test(content))
}

// 从中断处继续生成：保留已产出的半截回答，追加一轮让模型接着写，
// 避免「重新生成」整条重发并丢弃已产出内容（既省 completion token，也不丢用户已看到的内容）。
export async function continueLastResponse(
  conversationId: string,
  window: BrowserWindow | null,
  requestId?: string
): Promise<void> {
  const msgs = getMessages(conversationId)
  if (msgs.length === 0) throw new Error('没有可继续的回复')
  const last = msgs[msgs.length - 1]
  if (last.role !== 'assistant' || !isContinuableContent(last.content)) {
    throw new Error('最后一条回复不可继续')
  }
  const conv = getConversation(conversationId)
  if (!conv) throw new Error('Conversation not found')

  const partial = stripInterruptionMarker(typeof last.content === 'string' ? last.content : '')
  if (!partial) {
    // 中断前未产出任何内容：等价于重新生成最后一轮回复
    deleteMessage(last.id)
    await regenerateLastResponse(conversationId, window, requestId)
    return
  }
  // 保留半截正文（去掉中断标记），再用一条「继续」消息驱动模型接着写
  updateMessageContent(last.id, partial)
  const stash = lastTurnOverrides.get(conversationId) ?? {}
  await sendMessage(
    { ...stash, conversationId, botId: conv.bot_id, content: '继续', requestId },
    window
  )
}

// 编辑某条用户消息并重发:删除该消息及其后所有消息，用新内容重新发送。
export async function editAndResend(
  conversationId: string,
  messageId: string,
  newContent: string,
  window: BrowserWindow | null,
  requestId?: string
): Promise<void> {
  const msgs = getMessages(conversationId)
  const target = msgs.find((m) => m.id === messageId)
  if (!target) throw new Error('消息不存在')
  if (target.role !== 'user') throw new Error('只能编辑用户消息')
  const conv = getConversation(conversationId)
  if (!conv) throw new Error('Conversation not found')
  // 先校验可发送条件再截断——否则截断已提交而重发失败，截断点之后的历史被静默丢失
  const bot = resolveChatBot(conv.bot_id)
  if (!(conv.active_model_id || bot.model_id)) throw new Error('未选择对话模型，无法重发')
  const attachments = target.attachments
  deleteMessagesFrom(conversationId, messageId)
  const stash = lastTurnOverrides.get(conversationId) ?? {}
  await sendMessage(
    { ...stash, conversationId, botId: conv.bot_id, content: newContent, attachments, requestId },
    window
  )
}

const PLACEHOLDER_TITLES = new Set(['', 'New Chat', '新对话', '未命名对话'])

/** 从首条用户输入截取可读临时标题 */
function deriveTitleFromUserContent(content: string): string {
  const text = String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  const line = text.split('\n')[0].trim() || text
  if (line.length <= 18) return line
  return `${line.slice(0, 16).replace(/[，。,.、；;！!？?\s…]+$/u, '')}…`
}

function emitTitleUpdated(
  conversationId: string,
  title: string,
  window: BrowserWindow | null
): void {
  if (!window || window.isDestroyed()) return
  try {
    window.webContents.send('chat:titleUpdated', { conversationId, title })
  } catch {
    /* ignore */
  }
}

/** 首条用户消息落库后立刻写临时标题，避免侧栏长期显示「New Chat / 新对话」 */
function applyProvisionalTitleFromUserMessage(
  conversationId: string,
  content: string,
  window: BrowserWindow | null
): void {
  try {
    const conv = getConversation(conversationId)
    if (!conv || (conv as any).title_locked) return
    if (!PLACEHOLDER_TITLES.has((conv.title || '').trim())) return
    const counts = countConversationMessages(conversationId)
    if (counts.user !== 1) return
    const title = deriveTitleFromUserContent(content)
    if (!title) return
    updateConversationTitle(conversationId, title)
    emitTitleUpdated(conversationId, title, window)
  } catch {
    /* 非关键路径 */
  }
}

async function maybeGenerateTitle(
  conversationId: string,
  providerId: string,
  modelId: string,
  window: BrowserWindow | null
): Promise<void> {
  try {
    // 先计数守卫（避免每轮都全量读消息体）；用户手动改名（title_locked）的会话不再自动覆盖
    const counts = countConversationMessages(conversationId)
    if (counts.user !== 1 && counts.user !== 5) return
    const conv = getConversation(conversationId)
    if (!conv || (conv as any).title_locked) return

    const allMessages = getMessages(conversationId)
    const recentMsgs = allMessages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(0, counts.user === 1 ? 2 : 10)
      .map((m) => `${m.role === 'user' ? '用户' : 'AI'}: ${typeof m.content === 'string' ? m.content : '[附件]'}`)
      .join('\n')

    if (!recentMsgs.trim()) return

    const result = await callLLM(
      providerId,
      {
        modelId,
        messages: [
          {
            role: 'system',
            content:
              '根据以下对话内容生成一个简短的中文标题，不超过10个字，只输出标题本身，不要引号、标点或其他内容。'
          },
          { role: 'user', content: recentMsgs }
        ],
        stream: false,
        notifyStream: false,
        max_tokens: 30,
        temperature: 0.2
      },
      null
    )

    if (result.content) {
      const title = result.content
        .trim()
        .replace(/^["'「『]|["'」』]$/g, '')
        .replace(/\s+/g, '')
        .slice(0, 15)
      if (title && !PLACEHOLDER_TITLES.has(title)) {
        updateConversationTitle(conversationId, title)
        emitTitleUpdated(conversationId, title, window)
      }
    }
  } catch {
    // Title generation is non-critical；临时标题已由首条消息写入
  }
}

const SUMMARY_THRESHOLD = 10

async function maybeGenerateSummary(
  conversationId: string,
  providerId: string,
  modelId: string
): Promise<void> {
  try {
    // 先计数守卫（绝大多数轮次不需要全量读消息体）
    const counts = countConversationMessages(conversationId)
    if (counts.userAssistant < SUMMARY_THRESHOLD) return

    const existing = getSummary(conversationId)
    const coveredCount = existing?.covered_count || 0
    // 增量摘要：只压缩「已覆盖水位线(coveredCount)之后、滑动窗口(windowStart)之前」的新增段落，
    // 不再每轮把全部历史重喂给摘要模型（旧逻辑成本/延迟随对话长度线性增长）。
    // 把 covered_count 写到 windowStart，使摘要覆盖范围始终紧贴最近窗口，消除记忆空洞。
    const windowStart = Math.max(0, counts.userAssistant - RECENT_ROUNDS * 2)
    if (windowStart <= coveredCount) return // 没有新的、已滑出窗口的消息需要补摘要

    const allMessages = getMessages(conversationId)
    const userAssistantMsgs = allMessages.filter((m) => m.role === 'user' || m.role === 'assistant')
    const messagesToSummarize = userAssistantMsgs
      .slice(coveredCount, windowStart)
      .map((m) => `${m.role === 'user' ? '用户' : 'AI'}: ${typeof m.content === 'string' ? m.content : '[附件]'}`)
      .join('\n')

    if (!messagesToSummarize) return

    const previousSummary = existing?.summary ? `已有摘要：${existing.summary}\n\n` : ''
    const summaryMessages: ChatMessage[] = [
      {
        role: 'system',
        content:
          '你是一个对话摘要助手。请把「已有摘要」与「新增对话」合并压缩为一份连贯的累积摘要，' +
          '保留关键信息、用户偏好和重要决策。摘要控制在 250 字以内。'
      },
      {
        role: 'user',
        content: `${previousSummary}新增对话：\n${messagesToSummarize}`
      }
    ]

    const result = await callLLM(providerId, {
      modelId,
      messages: summaryMessages,
      stream: false
    })

    if (result.content) {
      upsertSummary(conversationId, result.content, estimateTokens(result.content), windowStart)
    }
  } catch {
    // Summary generation is non-critical, silently ignore errors
  }
}

/**
 * 把 OpenAI function schema 兜底成上游能稳定解析的形态。修两类常见缺陷：
 * - parameters 缺失 / 不是对象（例如 MCP tool 用 inputSchema 字段被裸塞过来；用户表单填错）
 *   → 兜成最小合法 { type: 'object', properties: {...} }
 * - properties 缺失 / 为空对象 {} / 不是对象
 *   部分 OpenAI 兼容上游（DeepSeek/智谱/豆包/Moonshot 等）遇到空 properties 会触发 silent 200 + 空 SSE，
 *   塞一个永远不会被模型用到的占位字段就能绕过该 bug，对正常调用无副作用。
 * 不修改输入对象，返回新对象，避免污染 DB / 内存里的原始 function_def。
 */
const MAX_SCHEMA_DEPTH = 12
const MAX_SCHEMA_DESC_LEN = 2048
// 递归会进入的嵌套 schema 容器关键字（其余键值原样保留，不递归——如 enum/required/type 等）
const SCHEMA_NESTED_KEYS = new Set([
  'items', 'additionalProperties', 'oneOf', 'anyOf', 'allOf', 'not',
  'prefixItems', 'contains', 'if', 'then', 'else', 'patternProperties'
])
// 始终剥离的元关键字（部分 OpenAI 兼容上游遇到会解析失败 / silent-200）
const SCHEMA_DROP_KEYS = new Set(['$schema', '$id', '$comment', '$anchor', '$defs', 'definitions'])

/**
 * 递归清洗 JSON Schema，剥离/转换部分 OpenAI 兼容上游（DeepSeek/智谱/豆包/Moonshot/云网关等）
 * 不稳定解析的结构，降低绑定 MCP 后因工具 inputSchema 触发 silent-200 / 挂连接的概率：
 * - 删除 $schema/$id/$comment/$anchor 与根上的 $defs/definitions
 * - 内联内部 $ref（#/$defs/* 或 #/definitions/*）；环引用 / 无法解析则退化为宽松 { type:'object' }
 * - 截断超长 description；限制嵌套深度，超深退化为 { type:'object' }
 * 不修改入参，返回新对象。
 */
function sanitizeJsonSchema(
  node: any,
  defs: Record<string, any>,
  depth: number,
  seenRefs: Set<string>
): any {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) {
    if (depth > MAX_SCHEMA_DEPTH) return []
    return node.map((n) => sanitizeJsonSchema(n, defs, depth + 1, seenRefs))
  }
  if (depth > MAX_SCHEMA_DEPTH) return { type: 'object' }

  // 内联内部 $ref
  if (typeof node.$ref === 'string') {
    const ref = node.$ref
    if (seenRefs.has(ref)) return { type: 'object' } // 防环
    const m = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(ref)
    if (m && defs[m[1]] !== undefined) {
      const next = new Set(seenRefs)
      next.add(ref)
      return sanitizeJsonSchema(defs[m[1]], defs, depth + 1, next)
    }
    return { type: 'object' } // 外部 / 缺失 $ref：退化为宽松对象
  }

  const out: any = {}
  for (const [k, v] of Object.entries(node)) {
    if (SCHEMA_DROP_KEYS.has(k)) continue
    if (k === 'description') {
      out.description = typeof v === 'string' && v.length > MAX_SCHEMA_DESC_LEN ? v.slice(0, MAX_SCHEMA_DESC_LEN) : v
      continue
    }
    if (k === 'properties' && v && typeof v === 'object' && !Array.isArray(v)) {
      const p: any = {}
      for (const [pk, pv] of Object.entries(v)) p[pk] = sanitizeJsonSchema(pv, defs, depth + 1, seenRefs)
      out.properties = p
      continue
    }
    if (SCHEMA_NESTED_KEYS.has(k)) {
      out[k] = sanitizeJsonSchema(v, defs, depth + 1, seenRefs)
      continue
    }
    out[k] = v
  }
  return out
}

function normalizeFunctionSchema(fn: any): any {
  if (!fn || typeof fn !== 'object') return fn
  const rawParams = fn.parameters
  const baseParams =
    rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams) ? rawParams : {}
  // 收集 $defs/definitions 供内部 $ref 内联（清洗后这两个根字段会被剥离）
  const defs: Record<string, any> = {
    ...(baseParams.definitions && typeof baseParams.definitions === 'object' ? baseParams.definitions : {}),
    ...(baseParams.$defs && typeof baseParams.$defs === 'object' ? baseParams.$defs : {})
  }
  const cleaned = sanitizeJsonSchema(baseParams, defs, 0, new Set<string>())
  const normalizedParams: any = {
    ...cleaned,
    type: typeof cleaned.type === 'string' ? cleaned.type : 'object'
  }
  const props = normalizedParams.properties
  const isEmptyProps =
    !props ||
    typeof props !== 'object' ||
    Array.isArray(props) ||
    Object.keys(props).length === 0
  if (isEmptyProps) {
    normalizedParams.properties = {
      _placeholder: {
        type: 'string',
        description: '保留字段，模型无需填充'
      }
    }
  }
  return { ...fn, parameters: normalizedParams }
}

/**
 * MCP 协议 tools/list 返回的工具用 inputSchema 字段，OpenAI function 协议用 parameters。
 * 直接把 MCP tool 当作 OpenAI function 转发会让上游收到没有 parameters 的 function，
 * 部分上游会触发 silent 200。这里做字段映射，name/description 原样保留。
 * 已经是 OpenAI 形态（含 parameters）的不动。
 */
function mcpToolToOpenAIFunction(tool: any): any {
  if (!tool || typeof tool !== 'object') return tool
  if (tool.parameters) return tool
  if (tool.inputSchema) {
    const { inputSchema, ...rest } = tool
    return { ...rest, parameters: inputSchema }
  }
  return tool
}

function buildToolsList(
  skillIds: string[],
  mcpIds: string[],
  promptSkillDirs: string[] = [],
  promptSkillMode: SkillSelectionMode = 'legacy_all',
  kbCategoryIds: string[] = [],
  enableImageGen: boolean = false,
  cloudKbIds: number[] = [],
  enableDeck: boolean = false
): any[] {
  // Core tools 默认全量加入；但会进一步过滤:
  // - 未启用知识库时剔除 kb_* 工具，避免给模型展示无意义入口（本地分类 或 云端知识库 任一启用即保留）
  // - 智能体未开启「调用生图能力」时剔除 image_gen，避免 LLM 误调、节省 prompt
  const filteredCore = coreToolDefs.filter((t: any) => {
    const name = t?.function?.name
    if (!enableImageGen && name === 'image_gen') return false
    if (kbCategoryIds.length === 0 && cloudKbIds.length === 0 && KB_TOOL_NAMES.includes(name)) return false
    return true
  })
  const tools: any[] = filteredCore.map((t: any) => ({
    type: 'function',
    function: normalizeFunctionSchema(t.function)
  }))

  // PPT Agent: 开启 enable_deck 的智能体注入 deck 工具集(规划大纲/逐页生成/图表/图标/评审/导出)
  if (enableDeck) {
    for (const t of deckToolDefs) {
      tools.push({ type: 'function', function: normalizeFunctionSchema(t.function) })
    }
  }

  // Add user skills as tools (skip core tool names to avoid duplicates)
  // 走 normalize 兜底：用户自建小工具的 function_def 可能 properties 为空 {} 或缺失 parameters，
  // 直接转发会让部分上游 silent 200。
  const allSkills = listSkills()
  for (const skill of allSkills) {
    if (skillIds.includes(skill.id) && skill.enabled && !CORE_TOOL_NAMES.includes(skill.function_def?.name)) {
      tools.push({
        type: 'function',
        function: normalizeFunctionSchema(skill.function_def)
      })
    }
  }

  // Add use_skill tool if there are enabled prompt skills (filtered by bot config)
  const allPromptSkills = listPromptSkills().filter((s) => s.enabled)
  const promptSkills = promptSkillMode === 'selected'
    ? allPromptSkills.filter((s) => promptSkillDirs.includes(s.dirName))
    : allPromptSkills
  if (promptSkills.length > 0) {
    const skillList = promptSkills.map((s) => `- ${s.name}: ${s.description}`).join('\n')
    tools.push({
      type: 'function',
      function: {
        name: 'use_skill',
        description: `IMPORTANT: When the user's request matches any available skill below, you MUST call this tool first to load the skill's full instructions before responding. Do NOT attempt to answer directly without loading the skill.\n\nAvailable skills:\n${skillList}`,
        parameters: {
          type: 'object',
          properties: {
            skill_name: {
              type: 'string',
              description: 'Name of the skill to load. Must match one of the available skills.',
              enum: promptSkills.map((s) => s.name)
            }
          },
          required: ['skill_name']
        }
      }
    })
  }

  // Add MCP server tools
  // 双层兜底：先把 MCP 的 inputSchema 字段映射成 OpenAI 的 parameters，再走 normalize
  // 处理空 properties 等剩余 schema 缺陷。
  // 同名去重：与核心工具 / 小工具 / use_skill / 其它 MCP 服务器撞名的跳过（executeToolCall
  // 按名路由时核心和小工具优先命中，重复注入只会让上游报 duplicate function 或模型困惑）。
  // always_load 分流：true 的 server 工具继续按原方式直接注入；false 的 server 仅在系统提示里
  // 由 capSummary 概述存在，工具发现与调用走下方三元元工具，避免海量工具淹没 prompt。
  const existingToolNames = new Set<string>(
    tools.map((t: any) => t?.function?.name).filter(Boolean)
  )
  let hasOnDemandMcp = false
  for (const mcpId of mcpIds) {
    const server = getMcpServer(mcpId)
    if (!server || !server.enabled) continue
    if (!server.always_load) {
      hasOnDemandMcp = true
      continue
    }
    for (const tool of server.tools) {
      const fn = mcpToolToOpenAIFunction(tool)
      const fnName = fn?.name
      if (!fnName || existingToolNames.has(fnName)) continue
      existingToolNames.add(fnName)
      tools.push({
        type: 'function',
        function: normalizeFunctionSchema(fn)
      })
    }
  }

  // 三元 MCP 元工具：当存在「按需发现」的 MCP server 时注入，让模型主动探查 → 看 schema → 调用。
  // 名字固定为内置常量，与核心/小工具/use_skill/MCP 真实工具去重（如撞名直接跳过，正常不会出现）。
  if (hasOnDemandMcp) {
    const meta = buildMcpMetaToolDefs()
    for (const m of meta) {
      if (existingToolNames.has(m.function.name)) continue
      existingToolNames.add(m.function.name)
      tools.push(m)
    }
  }

  return tools
}

// === MCP 三元元工具 ===
// mcp_list_servers / mcp_describe_tools / mcp_call：把「非 always_load」的 MCP 工具收敛到三个入口，
// 避免一次性把所有 MCP 工具 schema 塞进 LLM tools，节省 prompt token、降低模型困惑。

export const MCP_META_TOOL_NAMES = ['mcp_list_servers', 'mcp_describe_tools', 'mcp_call'] as const

function buildMcpMetaToolDefs(): any[] {
  return [
    {
      type: 'function',
      function: {
        name: 'mcp_list_servers',
        description:
          '列出当前对话可用的 MCP 服务器及其工具数量与概述。无参数。需要 MCP 工具但不确定有哪些时先调用此工具。',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      }
    },
    {
      type: 'function',
      function: {
        name: 'mcp_describe_tools',
        description:
          '查询指定 MCP 服务器下的工具列表与完整调用 schema。需要先通过 mcp_list_servers 确定 server。',
        parameters: {
          type: 'object',
          properties: {
            server: {
              type: 'string',
              description: 'MCP server id 或 name（两种均可，优先按 id 精确匹配，否则按 name 匹配）'
            }
          },
          required: ['server'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'mcp_call',
        description:
          '调用指定 MCP 工具。必须先通过 mcp_describe_tools 拿到该工具的 inputSchema 再构造 args，避免参数错误。',
        parameters: {
          type: 'object',
          properties: {
            server: { type: 'string', description: 'MCP server id 或 name' },
            tool: { type: 'string', description: '目标工具名（来自 mcp_describe_tools 返回）' },
            args: { type: 'object', description: '调用参数对象，结构由目标工具 inputSchema 定义', additionalProperties: true }
          },
          required: ['server', 'tool', 'args'],
          additionalProperties: false
        }
      }
    }
  ]
}

/** 元工具调用时根据 args.server 解析到具体 mcpId：优先按 id，再按 name 完全匹配。 */
function resolveMcpServerRef(effectiveMcpIds: string[], ref: string): { id: string; server: any } | null {
  if (!ref || typeof ref !== 'string') return null
  // 先按 id 命中
  if (effectiveMcpIds.includes(ref)) {
    const s = getMcpServer(ref)
    if (s && s.enabled) return { id: ref, server: s }
  }
  // 再按 name 命中（大小写敏感的全等）
  for (const id of effectiveMcpIds) {
    const s = getMcpServer(id)
    if (s && s.enabled && s.name === ref) return { id, server: s }
  }
  return null
}

/**
 * 把 tool result 压成对用户友好的简短文案，用于对话气泡里的工具调用折叠面板。
 * 默认行为：JSON.stringify 后截断 100 字（兼容旧逻辑）；
 * 对 image_gen 工具走专用文案：成功显示"图片已生成 ${basename}"，失败显示"生成失败: ${error}"。
 * 这样用户在折叠面板里看到的不是裸 JSON，体验更好。
 */
function buildToolSummary(toolName: string, result: any, resultStr: string): string {
  if (toolName === 'image_gen' && result && typeof result === 'object') {
    // chat 路径下 image_gen 是异步 fire-and-forget：立即返回 status:'pending'，
    // 实际图片在后台生成，完成后会以独立 assistant 消息追加到对话流。
    if (result.status === 'pending') return '已提交生图任务，正在后台生成…'
    if (result.status === 'canceled') return '已取消生图'
    if (result.error) return `生成失败：${String(result.error).slice(0, 80)}`
    if (result.success) {
      const path = String(result.path || '')
      const fileName = path ? path.split(/[\\/]/).pop() : ''
      return fileName ? `图片已生成 ${fileName}` : '图片已生成'
    }
  }
  if (toolName === 'ask_user' && result && typeof result === 'object') {
    if (result.status === 'canceled') return '用户未作出选择'
    if (result.status === 'answered') {
      const labels = Array.isArray(result.selected_labels) ? result.selected_labels.join('、') : ''
      return labels ? `已选择：${labels.slice(0, 80)}` : '用户已选择'
    }
  }
  if (typeof result === 'string') {
    return result.length > 100 ? result.slice(0, 100) + '...' : result
  }
  return resultStr.length > 100 ? resultStr.slice(0, 100) + '...' : resultStr
}

async function executeToolCall(
  toolCall: any,
  skillIds: string[],
  mcpIds: string[],
  conversationId?: string,
  kbCategoryIds: string[] = [],
  window?: BrowserWindow | null,
  signal?: AbortSignal,
  requestId?: string,
  timeoutMs?: number,
  cloudKb?: { kbIds: number[]; agentId: number; topK: number },
  // deck 子生成的模型回退: 与主对话同口径(conv.active 缺失时回退 bot.model / cloud:default),
  // 避免旧数据 bot(模型绑在 bot.model_* 而非 conv.active_*)发起 PPT 工具时 provider 为空致集体哑火。
  fallbackProviderId?: string,
  fallbackModelId?: string
): Promise<any> {
  if (!toolCall?.function) {
    return { error: '无效的工具调用' }
  }
  const functionName = toolCall.function?.name
  let args: any = {}
  try {
    args = JSON.parse(toolCall.function?.arguments || '{}')
  } catch {}

  // Handle use_skill (prompt skill)
  if (functionName === 'use_skill') {
    const skillName = args.skill_name
    const promptSkill = getPromptSkillByName(skillName)
    if (promptSkill) {
      const workspaceDir = conversationId ? getWorkspaceDir(conversationId) : ''
      const pathInfo = [
        `[Skill资源目录]: ${promptSkill.skillDir}`,
        workspaceDir ? `[工作区目录]: ${workspaceDir}` : '',
        pythonPromptText()
      ].filter(Boolean).join('\n')
      return `[Skill loaded: ${skillName}]\n${pathInfo}\n\nFollow the instructions below to complete the user's request:\n\n${promptSkill.content}`
    }
    return { error: `Skill "${skillName}" not found or disabled` }
  }

  // Try core tools first
  const sandboxDir = conversationId ? getWorkspaceDir(conversationId) : undefined
  const kbContext = {
    kbCategoryIds,
    cloudKbIds: cloudKb?.kbIds || [],
    cloudAgentId: cloudKb?.agentId || 0,
    cloudKbTopK: cloudKb?.topK || 5
  }
  // 生图后台任务的取消判定区分原因：reason='replaced'（用户发了新消息/微信来消息）不代表要取消生图——
  // 图片已计费生成，应照常落库；仅 'user' 主动中止才丢弃
  const isCanceledForImageGen = (rid?: string): boolean =>
    !!rid && isChatRequestCanceled(rid) && canceledRequestReasons.get(rid) !== 'replaced'
  const execContext = { conversationId, requestId, window: window || null, signal, timeoutMs, isCanceled: isCanceledForImageGen }
  const coreResult = await executeCoreToolCall(functionName, args, sandboxDir, kbContext, execContext)
  if (coreResult.handled) return coreResult.result

  // Try deck tools (PPT Agent): 子生成(填槽/自由HTML/图表判断/评审)用对话当前模型
  if (DECK_TOOL_NAMES.includes(functionName)) {
    const conv = conversationId ? getConversation(conversationId) : null
    // 与主对话同口径回退: conv.active 缺失时用主流程已算好的 effective(含 bot.model / cloud:default 兜底)
    const providerId = conv?.active_model_provider_id || fallbackProviderId || undefined
    const modelId = conv?.active_model_id || fallbackModelId || undefined
    const deckResult = await executeDeckTool(functionName, args, {
      conversationId,
      providerId,
      modelId,
      imageProviderId: conv?.active_image_provider_id || undefined,
      imageModelId: conv?.active_image_model_id || undefined,
      window: window || null,
      signal,
      kb: {
        categoryIds: kbCategoryIds,
        cloudKbIds: cloudKb?.kbIds || [],
        cloudAgentId: cloudKb?.agentId || 0,
        topK: cloudKb?.topK || 5
      }
    })
    if (deckResult.handled) return deckResult.result
  }

  // Try user skills
  const allSkills = listSkills()
  const skill = allSkills.find(
    (s) => skillIds.includes(s.id) && s.function_def?.name === functionName
  )

  if (skill) {
    // 脱离沙箱白名单工具：放开路径/命令限制（仍在 vm 隔离内运行）。内置预设永不脱离沙箱。
    const unrestricted = !skill.is_builtin && skill.unsandboxed
    // signal 贯穿：用户中止/被替换时立即释放等待（不再等技能跑满自身超时）
    const result = await executeSkillSandbox(skill.implementation, args, sandboxDir, timeoutMs, unrestricted, signal)
    return result.success ? result.result : { error: result.error }
  }

  // MCP 三元元工具：mcp_list_servers / mcp_describe_tools / mcp_call
  // 把「按需发现」的 MCP 工具收敛到三个入口，always_load=true 的服务依旧裸名直调（走下方循环）。
  if (functionName === 'mcp_list_servers') {
    // 与 capSummary 行为一致：只列出已发现工具的服务，避免模型按列表调 describe 拿到空 tools
    // 引起一轮浪费；正在握手/启动失败的服务在 tools 持久化前不出现，符合产品预期
    const list: any[] = []
    for (const id of mcpIds) {
      const server = getMcpServer(id)
      if (!server || !server.enabled) continue
      const toolCount = Array.isArray(server.tools) ? server.tools.length : 0
      if (toolCount === 0) continue
      list.push({
        server: server.id,
        name: server.name,
        toolCount,
        alwaysLoad: !!server.always_load
      })
    }
    return { servers: list }
  }

  if (functionName === 'mcp_describe_tools') {
    const ref = String(args?.server || '')
    const hit = resolveMcpServerRef(mcpIds, ref)
    if (!hit) return { error: `MCP server "${ref}" 不存在或未启用` }
    const tools = Array.isArray(hit.server.tools) ? hit.server.tools : []
    // 复用 sanitizeJsonSchema 清洗 inputSchema，避免把 $ref / $defs 等 LLM 难处理结构原样回传
    const described = tools.map((t: any) => {
      const rawSchema = t?.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : {}
      const defs: Record<string, any> = {
        ...(rawSchema.definitions && typeof rawSchema.definitions === 'object' ? rawSchema.definitions : {}),
        ...(rawSchema.$defs && typeof rawSchema.$defs === 'object' ? rawSchema.$defs : {})
      }
      return {
        name: t?.name,
        description: t?.description || '',
        inputSchema: sanitizeJsonSchema(rawSchema, defs, 0, new Set<string>())
      }
    }).filter((t: any) => t.name)
    return { server: hit.server.id, name: hit.server.name, tools: described }
  }

  if (functionName === 'mcp_call') {
    const ref = String(args?.server || '')
    const targetTool = String(args?.tool || '')
    const targetArgs = args?.args && typeof args.args === 'object' ? args.args : {}
    if (!targetTool) return { error: 'mcp_call 缺少 tool 参数' }
    const hit = resolveMcpServerRef(mcpIds, ref)
    if (!hit) return { error: `MCP server "${ref}" 不存在或未启用` }
    const meta = (hit.server.tools as any[]).find((t: any) => t?.name === targetTool)
    if (!meta) return { error: `MCP server "${hit.server.name}" 下没有工具 "${targetTool}"` }
    try {
      const effectiveTimeoutMs = timeoutMs ?? resolveMcpToolTimeoutMs(hit.id, targetTool)
      return normalizeMcpToolResult(await callMcpTool(hit.id, targetTool, targetArgs, effectiveTimeoutMs, signal))
    } catch (err: any) {
      const brief = String(err?.message || err).slice(0, 500)
      return { error: `MCP 工具 ${targetTool} 调用失败: ${brief}` }
    }
  }

  // Try MCP tools（always_load=true 的服务直接以原名注入了 LLM tools，按名路由到这里）
  for (const mcpId of mcpIds) {
    const server = getMcpServer(mcpId)
    if (server && server.enabled) {
      const mcpTool = server.tools.find((t: any) => t?.name === functionName)
      if (mcpTool) {
        try {
          // 结果规范化：content 数组拍平为文本 / isError 转 {error}（计入失败熔断）/
          // structuredContent 原样保留，避免协议包装层原样进上下文浪费 token。
          // 透传 signal：用户点「中止」时立即解除在途 MCP RPC / 握手等待，而非干等 30/60s 超时。
          // timeoutMs 形参恒为 undefined（来自调用方），这里按工具 annotations 解析差异化超时
          const effectiveTimeoutMs = timeoutMs ?? resolveMcpToolTimeoutMs(mcpId, functionName)
          return normalizeMcpToolResult(await callMcpTool(mcpId, functionName, args, effectiveTimeoutMs, signal))
        } catch (err: any) {
          // 启动失败的 message 可能带 2KB stderr 诊断：进对话上下文截断即可，全文在 MCP 页面可见
          const brief = String(err?.message || err).slice(0, 500)
          return { error: `MCP 工具 ${functionName} 调用失败: ${brief}` }
        }
      }
    }
  }

  return { error: `Tool ${functionName} not found` }
}
