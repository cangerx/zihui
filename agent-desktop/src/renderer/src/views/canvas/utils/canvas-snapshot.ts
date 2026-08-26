// 画布快照序列化
// -----------------------------------------------------------------------------
// 把整张画布（节点 + 连线 + 选区）压缩成一段面向 LLM 的紧凑上下文，供「画布智能体」
// 的 canvas_get_state 工具调用。设计目标：
//   1. 信息完整——节点用 #序号 便于人读、同时带真实 id 供工具操作；含类型/状态/关键
//      data 摘要 + 连线拓扑 + 选区；
//   2. 体积可控——排除大字段（base64 图 / 长路径 / plan_json），文本截断；超出 maxChars
//      时自动降级为摘要，再超则截断节点列表并注明省略数量，避免撞工具结果字数上限。
// 纯函数：调用方传入 canvasStore.nodes / edges（已是渲染端 live 状态）。

import { getNodeTypeDef } from '../composables/useNodeTypes'
import { listActualOutputHandles } from './node-schema'
import type { CanvasNode, CanvasEdge } from '@/stores/canvas'

export interface SerializeOptions {
  /** 当前选中的节点 id（画布上被框选/选中的节点） */
  selection?: string[]
  /** 'full' 含关键 data 摘要（默认）；'summary' 仅类型/状态/拓扑 */
  mode?: 'full' | 'summary'
  /** 只聚焦某个节点（返回它的完整字段，其余仅列拓扑关系）；用于单节点细看 */
  focusNodeId?: string
  /** 输出字数上限，超出自动降级/截断。默认 8000（低于工具结果 12000 上限留余量） */
  maxChars?: number
}

const DEFAULT_MAX_CHARS = 8000

// 运行态与产物字段：不进摘要（对「理解画布结构」无意义，且可能很大）
const RUNTIME_KEYS = new Set([
  'status', 'error', 'progress',
  'generation_id', 'result_path', 'result_url', 'cloud_task_id', 'matting_task_id',
  'video_url', 'cover_url', 'plan_json', 'created_node_ids', 'created_edge_ids',
  'image_data', 'outputContent'
])

/** 截断长文本，保留可读性 */
function truncate(text: string, max = 80): string {
  const s = String(text).replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}

/** 该节点是否已有产出（用于快照标注「有结果」） */
function hasResult(node: CanvasNode): boolean {
  const d = node.data || {}
  return Boolean(d.result || d.result_path || d.result_url || d.video_url || (Array.isArray(d.frames) && d.frames.length))
}

/**
 * 提取一个节点的关键 data 摘要（人类可读的一行），排除运行态/大字段。
 * full=false 时不产出字段摘要，仅由外层给出类型与状态。
 */
function summarizeData(node: CanvasNode): string {
  const d = node.data || {}
  const parts: string[] = []
  for (const [k, v] of Object.entries(d)) {
    if (RUNTIME_KEYS.has(k)) continue
    if (v == null || v === '') continue
    if (Array.isArray(v)) {
      if (v.length === 0) continue
      // 动态子项（rows/frames/shots）与 id 列表只记数量
      parts.push(`${k}=[${v.length}项]`)
      continue
    }
    if (typeof v === 'object') continue
    if (typeof v === 'string') {
      parts.push(`${k}="${truncate(v)}"`)
    } else {
      parts.push(`${k}=${v}`)
    }
  }
  return parts.join(' ')
}

/** 节点状态标签 */
function statusOf(node: CanvasNode): string {
  return (node.data?.status as string) || 'idle'
}

/**
 * 序列化整张画布为紧凑文本。返回可直接塞进工具结果 / 系统提示的字符串。
 */
export function serializeCanvasForLLM(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  opts: SerializeOptions = {}
): string {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS
  const selection = new Set(opts.selection || [])

  // 建立 节点id -> #序号 映射（按节点在数组中的顺序，稳定可读）
  const indexOf = new Map<string, number>()
  nodes.forEach((n, i) => indexOf.set(n.id, i + 1))
  const tag = (id: string) => {
    const idx = indexOf.get(id)
    return idx ? `#${idx}` : id
  }

  // 单节点聚焦模式：返回该节点全部字段 + 它的上下游
  if (opts.focusNodeId) {
    const node = nodes.find((n) => n.id === opts.focusNodeId)
    if (!node) return `节点不存在：${opts.focusNodeId}`
    const def = getNodeTypeDef(node.type)
    const ins = edges.filter((e) => e.target_node_id === node.id)
      .map((e) => `${tag(e.source_node_id)}(${e.source_handle}) → ${e.target_handle}`)
    const outs = edges.filter((e) => e.source_node_id === node.id)
      .map((e) => `${e.source_handle} → ${tag(e.target_node_id)}(${e.target_handle})`)
    const handles = listActualOutputHandles(node).map((h) => h.handle).join(', ')
    const lines = [
      `节点 ${tag(node.id)} ${node.type}(${def?.label || node.type}) id=${node.id}`,
      `状态=${statusOf(node)}${hasResult(node) ? ' 有结果' : ''}`,
      `配置: ${summarizeData(node) || '（默认）'}`,
      `输出口: ${handles || '无'}`,
      `入边: ${ins.length ? ins.join('; ') : '无'}`,
      `出边: ${outs.length ? outs.join('; ') : '无'}`
    ]
    return lines.join('\n')
  }

  const full = (opts.mode ?? 'full') === 'full'

  // 构建节点行
  const buildNodeLines = (withData: boolean): string[] =>
    nodes.map((n) => {
      const def = getNodeTypeDef(n.type)
      const sel = selection.has(n.id) ? ' [选中]' : ''
      const res = hasResult(n) ? ' 有结果' : ''
      const base = `${tag(n.id)} ${n.type}(${def?.label || n.type}) id=${n.id} 状态=${statusOf(n)}${res}${sel}`
      if (!withData) return base
      const summary = summarizeData(n)
      return summary ? `${base} | ${summary}` : base
    })

  // 构建连线行
  const edgeLines = edges.map(
    (e) => `${tag(e.source_node_id)}(${e.source_handle}) → ${tag(e.target_node_id)}(${e.target_handle})`
  )

  const selectionLine = selection.size
    ? nodes.filter((n) => selection.has(n.id)).map((n) => tag(n.id)).join(', ')
    : ''

  const assemble = (nodeLines: string[]): string => {
    const out: string[] = []
    out.push(`画布快照：共 ${nodes.length} 个节点，${edges.length} 条连线。`)
    out.push('【节点】' + (nodeLines.length ? '' : ' 空'))
    out.push(...nodeLines)
    out.push('【连线】' + (edgeLines.length ? '' : ' 无'))
    out.push(...edgeLines)
    if (selectionLine) out.push(`【选区】${selectionLine}`)
    return out.join('\n')
  }

  // 逐级降级控制体积：full -> summary -> 截断节点列表
  if (full) {
    const s = assemble(buildNodeLines(true))
    if (s.length <= maxChars) return s
  }
  const summaryLines = buildNodeLines(false)
  let s = assemble(summaryLines)
  if (s.length <= maxChars) return s

  // 仍超限：截断节点列表，保留连线与选区，注明省略
  let kept = summaryLines.length
  while (kept > 1) {
    kept = Math.floor(kept * 0.8)
    const truncatedNodes = summaryLines.slice(0, kept)
    truncatedNodes.push(`…（还有 ${nodes.length - kept} 个节点未列出，可按类型/状态过滤或聚焦单节点查看）`)
    s = assemble(truncatedNodes)
    if (s.length <= maxChars) return s
  }
  return s.slice(0, maxChars)
}
