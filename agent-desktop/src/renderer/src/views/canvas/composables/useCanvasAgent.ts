// 画布智能体 · 渲染层多轮工具循环
// -----------------------------------------------------------------------------
// 参照 chat-engine 的 Agent while-loop，但整个循环放在渲染层、贴着画布真源
// （canvasStore / useWorkflowEngine / node-schema），工具直连本地画布，无需主进程桥。
// 每轮：带 tools 调对话模型 → 有 tool_calls 则逐个执行画布工具、回填 tool 消息 → 无
// tool_calls 即为最终答复。模型统一走画布设置里的对话模型（project.text_provider_id/
// text_model_id），人设固化内置不可自定义。
//
// 安全层：破坏性工具（删节点/断线/运行）执行前经 onApproval 确认卡；每次改动
// 记入跨轮持久的撤销事务，面板可一键撤销（undoLast）。
//
// 健壮性（对齐 chat-engine，此前移植时遗漏）：
//  - 上下文压缩 compactContext：较早轮工具结果压占位 + 超字符预算从头成组丢，
//    tool_call 配对安全；发送前与返回落盘前都生效，历史不再无界膨胀。
//  - 溢出自愈：模型报上下文超长时硬裁一半历史自动重试一次，不再永久卡死只能手动清空。
//  - 同参重复熔断：完全相同参数的调用第 3 次软警告、第 4 次硬熔断进收尾总结。
//  - 瞬时错误退避重试一次（超时/余额类不重试）；单轮失败返回已配对历史，
//    面板据此保留「已落地的画布改动」记录，模型与画布不再脱节。
//  - cancel 同时调用 engine.cancelWorkflow 软取消整图工作流（此前只 abort 在飞的
//    LLM 请求，已批准的 canvas_run 会把整图跑完）。
//  - 流式：每轮 notifyStream + requestId（onRequestStart 通知面板），面板按 requestId
//    订阅 chat:stream 做 token 级增量渲染；onToken 保留作轮末整段结算/兜底。

import { ref } from 'vue'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkflowEngine } from './useWorkflowEngine'
import { createCanvasTools, DESTRUCTIVE_CANVAS_TOOLS } from './canvas-tools'
import { CANVAS_AGENT_PERSONA } from './canvas-agent-persona'
import { createUndoManager, type UndoManager, type UndoTransaction } from './canvas-undo'

const api = () => (window as any).api

/** 对话消息（OpenAI 兼容） */
export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: any[]
  tool_call_id?: string
}

/** 破坏性动作审批请求（面板据此弹确认卡） */
export interface ApprovalRequest {
  tool: string
  args: Record<string, any>
  /** 人类可读的变更预览 */
  preview: string
}

/** 循环过程事件（供面板可视化） */
export interface CanvasAgentEvents {
  onToken?: (text: string) => void
  /** 每轮（含收尾）LLM 请求开始前触发：面板据此把该 reqId 纳入流式订阅集合 */
  onRequestStart?: (reqId: string) => void
  onToolStart?: (name: string, args: Record<string, any>) => void
  onToolResult?: (name: string, result: Record<string, any>) => void
  onRound?: (round: number) => void
  onError?: (message: string) => void
}

export interface SendParams {
  /** 用户本轮输入 */
  input: string
  /** 目标画布 id */
  projectId: string
  /** 历史消息（不含本轮 input，不含 system；跨轮对话由调用方维护） */
  history?: AgentMessage[]
  /** 当前选中的节点 id */
  getSelection?: () => string[]
  /** 触发画布自动整理布局（画布视图注入，供 canvas_layout 工具） */
  layout?: () => Promise<void>
  /** 本地知识库检索（面板选了知识库才传；决定是否提供 canvas_kb_search 工具） */
  kbSearch?: (query: string, topK?: number) => Promise<{ results: { score: number; source: string; content: string }[]; error?: string }>
  /** 本轮附带图片（决定是否提供 canvas_add_reference_image 工具） */
  imageAttachments?: () => { name: string; dataUri: string }[]
  /** 把 dataUri 落盘为节点图片（走 canvas:saveNodeImage） */
  saveNodeImage?: (nodeId: string, dataUri: string) => Promise<{ image_path: string }>
  /** 破坏性动作确认门：返回 true 才执行，false 则取消并回报模型。缺省 fail-closed（无确认通道则拒绝执行破坏性动作） */
  onApproval?: (req: ApprovalRequest) => Promise<boolean>
  events?: CanvasAgentEvents
}

export interface SendResult {
  ok: boolean
  /** 最终助手文本 */
  text: string
  /** 完整消息序列（含本轮 user、assistant、tool），供调用方续接下一轮；已做 pairing 安全的上下文压缩 */
  messages: AgentMessage[]
  error?: string
}

/** 单次 send 内的最大工具轮次（防死循环） */
const MAX_TOOL_ROUNDS = 25
/** 单次模型调用硬超时 */
const LLM_TIMEOUT_MS = 120000
/** 发给模型的上下文字符预算（约 1.6 万-3 万 token）：超出先压老工具结果、再从头成组丢 */
const MAX_CONTEXT_CHARS = 32000
/** 工具结果全文保留的最近轮数（更早的压成占位摘要） */
const KEEP_TOOL_RESULT_ROUNDS = 4
/** 单条工具结果硬上限（防 kb 全文/大快照无界回填；与画布快照 8000 上限对齐） */
const MAX_TOOL_RESULT_CHARS = 8000
/** 同参重复调用：第 3 次软警告（结果附提示），达到本次数硬熔断进收尾 */
const SAME_CALL_BREAKER = 4

let reqSeq = 0

// -----------------------------------------------------------------------------
// 上下文压缩（轻量移植自 chat-engine：repairHistoryHead / compactAgentContext）
// -----------------------------------------------------------------------------

/** 粗略估算一组消息的字符体积（content + tool_calls 序列化） */
function estimateChars(msgs: AgentMessage[]): number {
  let n = 0
  for (const m of msgs) {
    n += (m.content?.length || 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0)
  }
  return n
}

/**
 * 裁掉切片后产生的孤儿：开头无主的 tool 结果、以及 tool 结果被裁掉的悬空 assistant.tool_calls。
 * 两种形态都会被 OpenAI 兼容端 400 拒收。
 */
function repairHistoryHead(msgs: AgentMessage[]): AgentMessage[] {
  let start = 0
  while (start < msgs.length && msgs[start].role === 'tool') start++
  if (start < msgs.length) {
    const head = msgs[start] as any
    if (head.role === 'assistant' && Array.isArray(head.tool_calls) && head.tool_calls.length > 0) {
      const ids: string[] = head.tool_calls.map((tc: any) => tc?.id).filter(Boolean)
      const tail = msgs.slice(start + 1)
      const answered = ids.every((id) => tail.some((m: any) => m.role === 'tool' && m.tool_call_id === id))
      if (!answered) start++
    }
  }
  let end = msgs.length
  while (end > 0) {
    const last = msgs[end - 1] as any
    if (last?.role === 'assistant' && Array.isArray(last.tool_calls) && last.tool_calls.length > 0) {
      const ids: string[] = last.tool_calls.map((tc: any) => tc?.id).filter(Boolean)
      const tail = msgs.slice(end)
      const answered = ids.every((id) => tail.some((m: any) => m.role === 'tool' && m.tool_call_id === id))
      if (!answered) { end--; continue }
    }
    break
  }
  return msgs.slice(start, end)
}

/** 单条工具结果硬截断（标注原长度，模型可理解） */
function limitToolResultStr(s: string): string {
  if (s.length <= MAX_TOOL_RESULT_CHARS) return s
  return s.slice(0, MAX_TOOL_RESULT_CHARS) + `\n...[工具结果已截断，原 ${s.length} 字符]`
}

/**
 * 上下文压缩（不动调用方数组，返回新数组；system 恒保留）：
 *  B. 较早轮（超过 KEEP_TOOL_RESULT_ROUNDS）的 tool 结果压成占位——工具结果是膨胀大头，
 *     且决策主要依赖最近一两步；
 *  A. 仍超预算则从对话区头部成组丢最旧消息（保底最近 6 条），repairHistoryHead 修配对。
 * 发送模型前与返回落盘前都调用，跨 turn 历史因此有界。
 */
function compactContext(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length <= 2) return messages
  const system = messages[0]?.role === 'system' ? [messages[0]] : []
  let convo = messages.slice(system.length)

  // B：给每条消息标轮号（每遇一个 assistant.tool_calls 轮号 +1），老轮 tool 结果压占位
  let round = 0
  const toolRound: number[] = new Array(convo.length).fill(0)
  for (let i = 0; i < convo.length; i++) {
    const m = convo[i]
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) round++
    toolRound[i] = round
  }
  if (round > KEEP_TOOL_RESULT_ROUNDS) {
    const cutoff = round - KEEP_TOOL_RESULT_ROUNDS
    convo = convo.map((m, i): AgentMessage => {
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

  // A：仍超预算则从头部成组硬裁，保底最近 6 条
  const floor = 6
  while (convo.length > floor && estimateChars(convo) > MAX_CONTEXT_CHARS) {
    convo = convo.slice(2)
    convo = repairHistoryHead(convo)
  }

  return [...system, ...convo]
}

/** 溢出自愈的硬裁：原地保留 system + 后半段对话（修配对） */
function shrinkMessagesHard(messages: AgentMessage[]): void {
  const system = messages[0]?.role === 'system' ? messages[0] : null
  let convo = messages.slice(system ? 1 : 0)
  convo = repairHistoryHead(convo.slice(Math.floor(convo.length / 2)))
  messages.splice(0, messages.length, ...(system ? [system] : []), ...convo)
}

/** 模型报错是否为「上下文超长」类（各家文案不一，尽量宽匹配；误判代价仅多压缩一次） */
function isContextOverflowError(msg: string): boolean {
  return /context.{0,30}(length|limit|window|overflow|exceed)|maximum context|too many tokens|prompt is too long|request too large|exceeds? the (maximum|max) (context|token|length)|上下文.{0,10}(超长|超限|上限|过长)|(输入|内容|请求).{0,6}过长|超出.{0,6}(上限|长度)/i.test(msg)
}

/** 不值得重试的错误（余额/鉴权/配置类，重试只会浪费时间） */
function isNonRetryableError(msg: string): boolean {
  return /余额|balance|402|鉴权|未授权|无权|invalid api key|apikey|api key|未配置|不存在/i.test(msg)
}

export function useCanvasAgent() {
  const store = useCanvasStore()
  const engine = useWorkflowEngine()

  const running = ref(false)
  // 撤销栈跨 send 持久（面板「撤销上次 AI 变更」按钮据此工作）
  let undoMgr: UndoManager | null = null
  const currentProjectId = ref('')
  /** 可撤销的事务数（响应式，供面板启用/禁用撤销按钮） */
  const undoCount = ref(0)

  let currentReqId = ''
  let canceled = false

  function ensureUndo(): UndoManager {
    if (!undoMgr) undoMgr = createUndoManager(store, () => currentProjectId.value)
    return undoMgr
  }

  function cancel(): void {
    canceled = true
    if (currentReqId) {
      try { api().llm.invoke('cancel', currentReqId) } catch {}
    }
    // 同时软取消本画布正在跑的整图工作流：此前只 abort 在飞的 LLM 请求，
    // 已批准的 canvas_run 阻塞在 runWorkflow 上时「停止」完全无效（最长僵 30 分钟）。
    try { if (currentProjectId.value) engine.cancelWorkflow(currentProjectId.value) } catch {}
  }

  /** 撤销最近一次画布变更；返回被撤销的事务（无则 null） */
  async function undoLast(): Promise<UndoTransaction | null> {
    const mgr = ensureUndo()
    const tx = await mgr.undoLast()
    undoCount.value = mgr.size()
    return tx
  }

  const lastUndoLabel = (): string | null => (undoMgr ? undoMgr.lastLabel() : null)

  async function send(params: SendParams): Promise<SendResult> {
    const { input, projectId, history = [], getSelection, layout, kbSearch, imageAttachments, saveNodeImage, events } = params

    const project = store.currentProject
    if (!project || project.id !== projectId) {
      const msg = '画布未就绪'
      events?.onError?.(msg)
      return { ok: false, text: '', messages: [], error: msg }
    }
    if (!project.text_provider_id || !project.text_model_id) {
      const msg = '尚未配置对话模型，请到画布设置里选择「文本处理服务商 / 文本模型」。'
      events?.onError?.(msg)
      return { ok: false, text: '', messages: [], error: msg }
    }

    currentProjectId.value = projectId
    const undo = ensureUndo()
    const tools = createCanvasTools({
      store,
      engine: {
        runWorkflow: engine.runWorkflow,
        executeSingleNode: engine.executeSingleNode,
        validateConnectivity: engine.validateConnectivity,
        isProjectRunning: engine.isProjectRunning
      },
      undo,
      projectId: () => projectId,
      getSelection,
      layout,
      kbSearch,
      imageAttachments,
      saveNodeImage
    })

    // 组装消息：system(固化人设) + 历史 + 本轮 user。
    // history 来自面板的响应式 conversation ref，其元素是 Vue reactive Proxy，
    // 直接经 IPC(llm:call) 结构化克隆会抛「An object could not be cloned」——先深拷贝剥离响应式。
    // 跨 turn 历史先做一次压缩（含 pairing 修复），保证起点有界。
    const plainHistory: AgentMessage[] = history.length ? JSON.parse(JSON.stringify(history)) : []
    const messages: AgentMessage[] = compactContext([
      { role: 'system', content: CANVAS_AGENT_PERSONA },
      ...plainHistory,
      { role: 'user', content: input }
    ])

    // 返回出口统一压缩（落盘前裁剪）：面板持久化的上下文始终有界
    const finish = (r: SendResult): SendResult => ({ ...r, messages: compactContext(r.messages) })

    // 同参重复熔断（连续计数语义，对齐 chat-engine 的 tool-circuit-breaker）：
    // 仅统计「连续完全相同参数」的调用，不同工具/不同参数介入即断档清零——
    // 搭建→检查→修改→检查的正当复查不会误触发（整次 send 累计计数会把人设强制的
    // canvas_get_state 复查误杀，且熔断连带终止整轮，爆炸半径过大）
    let lastCallKey = ''
    let sameCallStreak = 0
    let breakerStop = false

    running.value = true
    canceled = false
    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (canceled) return finish({ ok: false, text: '', messages, error: '已中止' })
        events?.onRound?.(round + 1)

        currentReqId = `canvas-agent-${Date.now()}-${++reqSeq}`
        events?.onRequestStart?.(currentReqId)

        // 带一次「溢出自愈」与一次「瞬时错误退避重试」的模型调用
        let resp: any = null
        let overflowRetried = false
        let transientRetried = false
        for (;;) {
          try {
            resp = await api().llm.invoke('call', project.text_provider_id, project.text_model_id, compactContext(messages), {
              tools: tools.defs,
              returnToolCalls: true,
              stream: true,
              notifyStream: true,
              requestId: currentReqId,
              timeoutMs: LLM_TIMEOUT_MS
            })
            break
          } catch (err: any) {
            if (canceled) return finish({ ok: false, text: '', messages, error: '已中止' })
            const rawMsg = err?.message || '模型调用失败'
            // 上下文超长：硬裁一半历史自动重试一次（此前只能手动清空对话才能恢复）
            if (!overflowRetried && isContextOverflowError(rawMsg)) {
              overflowRetried = true
              shrinkMessagesHard(messages)
              continue
            }
            // 瞬时错误（网络抖动/5xx/网关波动）：退避 1.5s 重试一次；超时(Aborted)与余额/鉴权类不重试
            if (!transientRetried && rawMsg !== 'Aborted' && !isContextOverflowError(rawMsg) && !isNonRetryableError(rawMsg)) {
              transientRetried = true
              await new Promise((r) => setTimeout(r, 1500))
              if (canceled) return finish({ ok: false, text: '', messages, error: '已中止' })
              continue
            }
            // 120s 硬超时在主进程是 ac.abort() → AbortedError('Aborted')，翻译成可读文案
            const msg = rawMsg === 'Aborted' ? '模型响应超时（120 秒），请重试或更换更快的模型' : rawMsg
            events?.onError?.(msg)
            // 返回已配对历史（失败点前的 assistant+tool 轮次完整），面板据此保留
            // 「已落地的画布改动」记录，模型与画布不再脱节
            return finish({ ok: false, text: '', messages, error: msg })
          }
        }

        // 兼容返回形状：{content,tool_calls} | 纯字符串
        const content: string = typeof resp === 'string' ? resp : (resp?.content || '')
        const rawCalls = typeof resp === 'object' ? resp?.tool_calls : undefined
        const toolCalls: any[] | undefined = Array.isArray(rawCalls)
          ? rawCalls.filter((tc: any) => tc && typeof tc === 'object')
          : undefined

        messages.push({ role: 'assistant', content, tool_calls: toolCalls && toolCalls.length ? toolCalls : undefined })
        if (content) events?.onToken?.(content)

        if (!toolCalls || toolCalls.length === 0) {
          return finish({ ok: true, text: content, messages })
        }

        // 关键：无论中途取消/出错，都必须给每个 tool_call 回填一条 role:'tool' 消息，
        // 否则末尾 assistant.tool_calls 悬空、下一轮会被 provider 400 拒并污染历史。
        let aborted = false
        for (const tc of toolCalls) {
          const tcId = tc?.id
          if (canceled) aborted = true
          if (aborted || breakerStop) {
            // 已中止/已熔断：仍回填占位结果以保证 tool_calls 与 tool 消息严格配对
            messages.push({
              role: 'tool',
              tool_call_id: tcId,
              content: JSON.stringify(aborted ? { ok: false, canceled: true } : { ok: false, skipped: true, reason: '已熔断，跳过执行' })
            })
            continue
          }
          const fname: string = tc?.function?.name || ''
          let fargs: Record<string, any> = {}
          try {
            const raw = tc?.function?.arguments
            fargs = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {}
          } catch {
            fargs = {}
          }
          events?.onToolStart?.(fname, fargs)

          let result: Record<string, any>
          // 同参重复熔断（连续计数）：完全相同的 (工具+参数) 连续反复调用才是死循环特征；
          // 中间夹了其他调用即断档清零（复查画布状态等正当多步工作流不受影响）
          const callKey = fname + '|' + JSON.stringify(fargs)
          if (callKey === lastCallKey) sameCallStreak++
          else { sameCallStreak = 1; lastCallKey = callKey }
          const seen = sameCallStreak

          if (!tools.names.has(fname)) {
            result = { ok: false, error: `未知工具：${fname}` }
          } else if (seen >= SAME_CALL_BREAKER) {
            result = {
              ok: false,
              error: `已熔断：完全相同参数的「${fname}」调用已重复 ${seen} 次，继续重复不会得到新信息。请停止重复调用，基于已有信息总结并给出下一步建议。`
            }
            breakerStop = true
          } else if (tools.destructive.has(fname)) {
            // 破坏性动作：先弹确认卡；无确认通道（onApproval）则 fail-closed 拒绝执行
            let previewText = ''
            try { previewText = tools.preview(fname, fargs) } catch { previewText = `将执行：${fname}` }
            const approved = params.onApproval ? await params.onApproval({ tool: fname, args: fargs, preview: previewText }) : false
            if (canceled) {
              aborted = true
              result = { ok: false, canceled: true }
            } else if (!approved) {
              result = { ok: false, canceled: true, error: params.onApproval ? '用户取消了此操作' : '该动作需要用户确认，但当前环境无确认通道' }
            } else {
              try {
                result = await tools.execute(fname, fargs)
              } catch (err: any) {
                result = { ok: false, error: err?.message || '工具执行异常' }
              }
            }
          } else {
            try {
              result = await tools.execute(fname, fargs)
            } catch (err: any) {
              result = { ok: false, error: err?.message || '工具执行异常' }
            }
          }
          // 软警告：第 3 次同参调用仍放行，但提示模型停止重复
          if (seen === SAME_CALL_BREAKER - 1 && !breakerStop) {
            result = {
              ...result,
              note: `提示：这是你第 ${seen} 次以相同参数调用本工具，结果与前几次相同；如已拿到所需信息请停止重复调用，再重复将被熔断。`
            }
          }
          events?.onToolResult?.(fname, result)
          messages.push({ role: 'tool', tool_call_id: tcId, content: limitToolResultStr(JSON.stringify(result)) })
        }
        if (aborted) return finish({ ok: false, text: '', messages, error: '已中止' })
        if (breakerStop) break // 熔断：跳出工具轮循环，进收尾总结
      }

      // 达到最大轮次（或被熔断）：再做一次不带 tools 的收尾总结
      currentReqId = `canvas-agent-${Date.now()}-${++reqSeq}`
      events?.onRequestStart?.(currentReqId)
      let finalText = ''
      try {
        const resp = await api().llm.invoke('call', project.text_provider_id, project.text_model_id, [
          ...compactContext(messages),
          {
            role: 'user',
            content: breakerStop
              ? '（检测到相同参数的重复工具调用，已为你提前停止。请用一段话总结你已完成的动作，以及还需要用户做什么。）'
              : '（已达到本轮操作上限，请用一段话总结你已完成的动作，以及还需要用户做什么。）'
          }
        ], { stream: true, notifyStream: true, requestId: currentReqId, timeoutMs: LLM_TIMEOUT_MS })
        finalText = typeof resp === 'string' ? resp : (resp?.content || '')
      } catch { /* 收尾失败忽略 */ }
      const wrap = finalText || '本轮操作较多已达上限，已尽力完成，请检查画布或继续下一步指令。'
      messages.push({ role: 'assistant', content: wrap })
      // 收尾总结同样展示给用户（此前只进历史不进界面，造成模型上下文与可见对话错位）
      events?.onToken?.(wrap)
      return finish({ ok: true, text: wrap, messages })
    } finally {
      running.value = false
      currentReqId = ''
      undoCount.value = undo.size()
    }
  }

  return { running, send, cancel, undoLast, undoCount, lastUndoLabel, DESTRUCTIVE_CANVAS_TOOLS }
}
