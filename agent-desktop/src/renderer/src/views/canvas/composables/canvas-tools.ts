// 画布智能体工具集
// -----------------------------------------------------------------------------
// createCanvasTools(ctx) 返回 { defs, names, destructive, preview, execute }：
//   - defs：OpenAI function-calling 工具定义数组（喂给 llm:call 的 tools）
//   - names：全部工具名集合
//   - destructive：破坏性 / 需审批的工具名集合（useCanvasAgent 审批门据此在执行前弹确认）
//   - preview(name,args)：为破坏性工具生成人类可读的变更摘要（供确认卡展示）
//   - execute(name, args)：单一执行入口，返回紧凑结果对象（会被 JSON 序列化成 tool 消息）
//
// 所有画布写操作都走 canvasStore（同步响应式 nodes/edges + 落 IPC + UI 即时刷新），
// 读/校验/序列化复用 Phase 0 的 node-schema 与 canvas-snapshot，运行走 useWorkflowEngine。
// 每次改动都会向 ctx.undo 记录逆事务，支持跨轮一键撤销（见 canvas-undo.ts）。

import type { useCanvasStore, CanvasNode, CanvasEdge } from '@/stores/canvas'
import { getNodeTypeDef } from './useNodeTypes'
import {
  getDefaultNodeData,
  validateNodeData,
  canConnect,
  patchNodeData,
  queryNodes,
  listActualOutputHandles,
  getNodeCapabilities,
  isAgentWritableDataKey
} from '../utils/node-schema'
import { serializeCanvasForLLM } from '../utils/canvas-snapshot'
import type { UndoManager, EdgeSnapshot, NodeSnapshot, InverseOp } from './canvas-undo'

type CanvasStore = ReturnType<typeof useCanvasStore>

/** 画布智能体工具执行所需的上下文（由 useCanvasAgent 注入） */
export interface CanvasToolContext {
  store: CanvasStore
  engine: {
    runWorkflow: (projectId: string) => Promise<{ ok: boolean; message: string }>
    executeSingleNode: (nodeId: string, projectId: string) => Promise<any>
    validateConnectivity: (projectId: string) => { valid: boolean; errors: string[] }
    isProjectRunning: (projectId: string) => boolean
  }
  /** 撤销事务管理器（跨轮持久，由 useCanvasAgent 持有） */
  undo: UndoManager
  /** 当前画布 id */
  projectId: () => string
  /** 当前选中的节点 id（无 UI 时返回空数组） */
  getSelection?: () => string[]
  /** 触发画布自动整理布局（由画布视图注入，耦合 VueFlow；无则 canvas_layout 不可用） */
  layout?: () => Promise<void>
  /** 本地知识库检索（面板选了知识库才注入；无则不提供 canvas_kb_search 工具） */
  kbSearch?: (query: string, topK?: number) => Promise<{ results: { score: number; source: string; content: string }[]; error?: string }>
  /** 本轮用户附带的图片（name + dataUri）；有图才提供 canvas_add_reference_image 工具 */
  imageAttachments?: () => { name: string; dataUri: string }[]
  /** 把 dataUri 落盘为节点图片并返回相对路径（面板注入，走 canvas:saveNodeImage） */
  saveNodeImage?: (nodeId: string, dataUri: string) => Promise<{ image_path: string }>
}

/** OpenAI function tool 定义 */
interface ToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, any> }
}

/** 工具执行结果（紧凑，供回填 tool 消息） */
export type ToolResult = Record<string, any>

/** 破坏性 / 需审批的工具（删除、断线、运行）——执行前经审批门确认 */
export const DESTRUCTIVE_CANVAS_TOOLS = new Set<string>([
  'canvas_disconnect',
  'canvas_delete_node',
  'canvas_run'
])

/** 会改画布结构/数据的工具：整图运行期间禁止执行（与手动编辑器的 workflowRunning 门闩一致） */
const WRITE_CANVAS_TOOLS = new Set<string>([
  'canvas_add_node',
  'canvas_build_flow',
  'canvas_update_node_data',
  'canvas_connect',
  'canvas_disconnect',
  'canvas_delete_node',
  'canvas_add_reference_image',
  'canvas_layout',
  'canvas_undo_last'
])

export function createCanvasTools(ctx: CanvasToolContext): {
  defs: ToolDef[]
  names: Set<string>
  destructive: Set<string>
  preview: (name: string, args: Record<string, any>) => string
  execute: (name: string, args: Record<string, any>) => Promise<ToolResult>
} {
  const pid = () => ctx.projectId()
  const projNodes = (): CanvasNode[] => ctx.store.nodes.filter((n) => n.project_id === pid())
  const projEdges = (): CanvasEdge[] => ctx.store.edges.filter((e) => e.project_id === pid())
  const findNode = (id: string): CanvasNode | undefined => ctx.store.nodes.find((n) => n.id === id && n.project_id === pid())
  const labelOf = (n: CanvasNode) => getNodeTypeDef(n.type)?.label || n.type

  // 节点在快照里的 #序号 + 标签，供预览/结果可读
  const tagOf = (id: string): string => {
    const list = projNodes()
    const idx = list.findIndex((n) => n.id === id)
    if (idx < 0) return id
    return `#${idx + 1} ${labelOf(list[idx])}`
  }

  const edgeSnapshot = (e: CanvasEdge): EdgeSnapshot => ({
    source_node_id: e.source_node_id,
    source_handle: e.source_handle,
    target_node_id: e.target_node_id,
    target_handle: e.target_handle
  })
  const nodeSnapshot = (n: CanvasNode): NodeSnapshot => ({
    type: n.type,
    position_x: n.position_x,
    position_y: n.position_y,
    width: n.width,
    height: n.height,
    data: JSON.parse(JSON.stringify(n.data || {}))
  })
  const incidentEdges = (nodeId: string): CanvasEdge[] =>
    projEdges().filter((e) => e.source_node_id === nodeId || e.target_node_id === nodeId)

  const nodeBrief = (n: CanvasNode) => ({
    id: n.id,
    type: n.type,
    label: labelOf(n),
    status: (n.data?.status as string) || 'idle'
  })

  /** 四元组完全相同的既有连线（与编辑器 handle 菜单的 dup 守卫同款判定） */
  const findDupEdge = (srcId: string, sh: string, tgtId: string, th: string): CanvasEdge | undefined =>
    projEdges().find(
      (e) =>
        e.source_node_id === srcId &&
        e.source_handle === sh &&
        e.target_node_id === tgtId &&
        e.target_handle === th
    )

  /**
   * 动态输出节点的输出口存在性硬校验：output-{id} 必须由真实子项（rows/frames/shots）
   * 派生。canConnect 只对前缀做宽松放行（编辑器 UI 用），智能体臆造的 handle 会让
   * 运行期取数静默 miss（边存在但不传任何数据），故写库前必须硬拦。
   * 返回 null=合法，否则为人类可读的错误原因。
   */
  const checkDynamicSourceHandle = (srcNode: CanvasNode, sh: string): string | null => {
    const def = getNodeTypeDef(srcNode.type)
    if (!def?.dynamicOutputs) return null
    const rows: any[] = (srcNode.data?.rows || srcNode.data?.frames || srcNode.data?.shots || []) as any[]
    const ids = rows.map((r) => r?.id).filter((id) => id != null)
    if (ids.length === 0) {
      return `「${labelOf(srcNode)}」是动态输出节点，当前没有任何子项（rows 为空），还没有可连的输出口；请先在节点 data 中配置子项（每个子项需显式带 id），再按 output-{子项id} 连线`
    }
    const valid = ids.map((id) => `output-${id}`)
    if (!valid.includes(sh)) {
      return `输出口 ${sh} 不存在于「${labelOf(srcNode)}」；当前真实输出口：${valid.join('、')}（可用 canvas_list_dynamic_handles 复核）`
    }
    return null
  }

  // 快捷方式节点：智能体应亲手用基础节点搭建，不应外包给这些"用户手动快捷方式"
  const SHORTCUT_TYPES = new Set(['quickOrchestrator', 'agentNode'])
  const shortcutNudge = (type: string): string =>
    SHORTCUT_TYPES.has(type)
      ? `提示：${type} 是给用户手动使用的快捷方式；若目标是生成图片/文本，请改用基础节点（如 textInput→text2img）亲手搭建并写好提示词，不要创建它。`
      : ''

  // ---------------------------------------------------------------------------
  // 工具定义
  // ---------------------------------------------------------------------------
  const defs: ToolDef[] = [
    {
      type: 'function',
      function: {
        name: 'canvas_get_state',
        description: '读取当前画布的结构化快照（节点、连线、状态、选区）。任何涉及理解或修改现有画布的操作都应先调用它。',
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['full', 'summary'], description: 'full=含每个节点的关键配置摘要（默认）；summary=仅类型/状态/拓扑' },
            focusNodeId: { type: 'string', description: '只聚焦查看某个节点的完整信息（含全部字段与上下游）' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'canvas_list_node_types',
        description: '列出全部可用节点类型及其输入/输出接口（数据类型 text/image/video、是否必需）与可设置的 data 字段。不确定能建什么、能连什么时调用。',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'canvas_add_node',
        description: '新建单个节点。缺省参数会自动填默认值，只需在有明确要求时设置 data 字段。返回真实节点 id。',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', description: '节点类型（见 canvas_list_node_types）' },
            data: { type: 'object', description: '要设置的 data 字段（可选，未列字段用默认值）' },
            position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, description: '位置（可选，缺省自动排布）' }
          },
          required: ['type']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'canvas_build_flow',
        description: '一次性批量搭建一组节点与连线（原子操作，任一步失败整体回滚）。搭多节点工作流时优先用它，而不是逐个 add_node。',
        parameters: {
          type: 'object',
          properties: {
            nodes: {
              type: 'array',
              description: '要新建的节点列表；每个用 tempId 供本批次内连线引用',
              items: {
                type: 'object',
                properties: {
                  tempId: { type: 'string', description: '本批次内唯一临时 id（如 t1、t2）' },
                  type: { type: 'string' },
                  data: { type: 'object' },
                  position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } }
                },
                required: ['tempId', 'type']
              }
            },
            edges: {
              type: 'array',
              description: '连线列表；source/target 可为本批次 tempId 或画布上已存在的真实节点 id',
              items: {
                type: 'object',
                properties: {
                  source: { type: 'string' },
                  sourceHandle: { type: 'string', description: '源输出口，缺省 output' },
                  target: { type: 'string' },
                  targetHandle: { type: 'string', description: '目标输入口，缺省 input' }
                },
                required: ['source', 'target']
              }
            }
          },
          required: ['nodes']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'canvas_update_node_data',
        description: '增量修改某节点的 data 字段（只覆盖列出的字段，不动其他配置）。用于改提示词/尺寸/模型/质量等。',
        parameters: {
          type: 'object',
          properties: {
            nodeId: { type: 'string' },
            data: { type: 'object', description: '要覆盖的字段（部分）' }
          },
          required: ['nodeId', 'data']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'canvas_connect',
        description: '连接两个节点的接口。连前会校验数据类型匹配（不匹配会被拒绝）。',
        parameters: {
          type: 'object',
          properties: {
            source: { type: 'string', description: '源节点 id' },
            sourceHandle: { type: 'string', description: '源输出口，缺省 output' },
            target: { type: 'string', description: '目标节点 id' },
            targetHandle: { type: 'string', description: '目标输入口，缺省 input' }
          },
          required: ['source', 'target']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'canvas_disconnect',
        description: '删除连线。给 edgeId 删指定连线，或给 source+sourceHandle 删该输出口的全部连线。[破坏性]',
        parameters: {
          type: 'object',
          properties: {
            edgeId: { type: 'string' },
            source: { type: 'string' },
            sourceHandle: { type: 'string' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'canvas_delete_node',
        description: '删除节点（会级联删除它的所有连线）。[破坏性]',
        parameters: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'canvas_run',
        description: '运行工作流。给 nodeId 只跑单节点，否则跑整张画布。运行前会做连通性自检。[需确认]',
        parameters: { type: 'object', properties: { nodeId: { type: 'string', description: '只运行该节点（可选）' } } }
      }
    },
    {
      type: 'function',
      function: {
        name: 'canvas_query_nodes',
        description: '按类型/状态/关键词查找节点，避免拉回整图自己过滤。',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            status: { type: 'string', description: 'idle/running/done/error 等' },
            keyword: { type: 'string' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'canvas_list_dynamic_handles',
        description: '读取动态输出节点（提示词切片/关键帧抽取/智能分镜）当前真实的输出口列表。连它们的输出前必须先调用。',
        parameters: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'canvas_layout',
        description: '自动整理画布布局（拓扑分层、对齐、去除堆叠）。批量增删节点后可调用它让画布整齐。',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'canvas_undo_last',
        description: '撤销本会话中最近一次画布变更（新建/修改/删除/连断线都可撤）。',
        parameters: { type: 'object', properties: {} }
      }
    }
  ]

  // 仅当用户本轮附带了图片时才提供"落成参考图"工具
  if (ctx.imageAttachments && ctx.imageAttachments().length > 0) {
    defs.push({
      type: 'function',
      function: {
        name: 'canvas_add_reference_image',
        description: '把用户本轮附带的某张图片落成画布上的「参考图(refImage)」节点（返回节点 id，之后可用 canvas_connect 连到生图节点的图片输入口 image-input 做参考）。仅在用户明确要把该图用进工作流时调用，不是每张附带图都要落。',
        parameters: {
          type: 'object',
          properties: {
            index: { type: 'number', description: '第几张附带图片（从 1 开始，对应识别结果里的"图N"）' },
            position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } }
          },
          required: ['index']
        }
      }
    })
  }

  // 仅当用户在面板选了知识库时才提供检索工具
  if (ctx.kbSearch) {
    defs.push({
      type: 'function',
      function: {
        name: 'canvas_kb_search',
        description: '在用户选定的本地知识库里检索资料，作为搭建/写提示词的领域依据。需要产品参数、行业术语、风格规范等背景知识时调用。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '检索关键词/问题' },
            topK: { type: 'number', description: '返回条数，默认 5' }
          },
          required: ['query']
        }
      }
    })
  }

  const names = new Set(defs.map((d) => d.function.name))

  // ---------------------------------------------------------------------------
  // 落点辅助
  // ---------------------------------------------------------------------------
  function autoPosition(offsetIndex = 0): { x: number; y: number } {
    const pnodes = projNodes()
    const maxX = pnodes.length ? Math.max(...pnodes.map((n) => n.position_x)) : 0
    return { x: maxX + 320 + offsetIndex * 320, y: 0 }
  }

  // 坐标兼容：模型常把数值写成字符串（'100'），先 Number() 转再判有限，否则回落。
  // 显式排除 null/''/undefined（Number(null)=0、Number('')=0 会误落到坐标 0）。
  const coordOr = (v: any, fallback: number): number => {
    if (v === null || v === undefined || v === '') return fallback
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }

  // ---------------------------------------------------------------------------
  // 破坏性工具的变更预览（供确认卡）
  // ---------------------------------------------------------------------------
  function preview(name: string, rawArgs: Record<string, any>): string {
    const args = rawArgs || {}
    switch (name) {
      case 'canvas_delete_node': {
        const node = findNode(String(args.nodeId))
        if (!node) return `节点不存在：${args.nodeId}`
        return `将删除节点「${labelOf(node)}」（${tagOf(node.id)}），并级联删除它的 ${incidentEdges(node.id).length} 条连线。`
      }
      case 'canvas_disconnect': {
        if (args.edgeId) {
          const e = projEdges().find((x) => x.id === args.edgeId)
          if (!e) return `连线不存在：${args.edgeId}`
          return `将删除连线：${tagOf(e.source_node_id)} → ${tagOf(e.target_node_id)}。`
        }
        if (args.source && args.sourceHandle) {
          const n = projEdges().filter((e) => e.source_node_id === args.source && e.source_handle === args.sourceHandle).length
          return `将删除「${tagOf(String(args.source))}」输出口 ${args.sourceHandle} 上的 ${n} 条连线。`
        }
        return '将删除连线（参数不足：需 edgeId 或 source+sourceHandle）。'
      }
      case 'canvas_run': {
        if (args.nodeId) {
          const node = findNode(String(args.nodeId))
          return node ? `将单独运行节点「${labelOf(node)}」（${tagOf(node.id)}）。` : `节点不存在：${args.nodeId}`
        }
        const { valid, errors } = ctx.engine.validateConnectivity(pid())
        return `将运行整张画布（${projNodes().length} 个节点）。连通性自检：${valid ? '通过' : '未通过——' + errors.join('；')}。`
      }
      default:
        return ''
    }
  }

  // ---------------------------------------------------------------------------
  // 单一执行入口
  // ---------------------------------------------------------------------------
  async function execute(name: string, rawArgs: Record<string, any>): Promise<ToolResult> {
    const args = rawArgs || {}
    const projectId = pid()
    if (!projectId) return { ok: false, error: '没有打开的画布' }

    // 整图运行期间禁止一切结构/数据写操作（避免运行中改拓扑造成悬空引用、结果与画布不一致）
    if (WRITE_CANVAS_TOOLS.has(name) && ctx.engine.isProjectRunning(projectId)) {
      return { ok: false, error: '画布正在运行工作流，暂不能修改画布；请等运行结束或先停止再操作。' }
    }

    switch (name) {
      case 'canvas_get_state': {
        const snapshot = serializeCanvasForLLM(projNodes(), projEdges(), {
          mode: args.mode,
          focusNodeId: args.focusNodeId,
          selection: ctx.getSelection?.() || []
        })
        return { ok: true, snapshot }
      }

      case 'canvas_list_node_types': {
        return { ok: true, nodeTypes: getNodeCapabilities() }
      }

      case 'canvas_add_node': {
        const type = String(args.type || '')
        if (!getNodeTypeDef(type)) return { ok: false, error: `未知节点类型：${type}` }
        const { cleaned, warnings } = validateNodeData(type, args.data)
        const posSrc = args.position || {}
        const auto = autoPosition()
        const pos = { x: coordOr(posSrc.x, auto.x), y: coordOr(posSrc.y, auto.y) }
        const node = await ctx.store.addNode(projectId, { type, position_x: pos.x, position_y: pos.y, data: cleaned })
        ctx.undo.record({ label: `新建节点「${labelOf(node)}」`, ops: [{ kind: 'removeNode', nodeId: node.id }] })
        const nudge = shortcutNudge(type)
        if (nudge) warnings.push(nudge)
        return { ok: true, nodeId: node.id, type, warnings }
      }

      case 'canvas_build_flow': {
        const inNodes: any[] = Array.isArray(args.nodes) ? args.nodes : []
        const inEdges: any[] = Array.isArray(args.edges) ? args.edges : []
        if (inNodes.length === 0) return { ok: false, error: 'nodes 不能为空' }
        const seenTempIds = new Set<string>()
        for (const n of inNodes) {
          if (!getNodeTypeDef(String(n.type))) return { ok: false, error: `未知节点类型：${n.type}` }
          if (!n.tempId) return { ok: false, error: '每个节点必须带 tempId' }
          if (seenTempIds.has(String(n.tempId))) return { ok: false, error: `tempId 重复：${n.tempId}（同批次内必须唯一）` }
          seenTempIds.add(String(n.tempId))
        }
        const tempToReal = new Map<string, { id: string; type: string }>()
        const createdNodeIds: string[] = []
        const createdEdgeIds: string[] = []
        const warnings: string[] = []
        const base = autoPosition()
        try {
          for (let i = 0; i < inNodes.length; i++) {
            const n = inNodes[i]
            const { cleaned, warnings: w } = validateNodeData(String(n.type), n.data)
            if (w.length) warnings.push(`${n.tempId}: ${w.join('；')}`)
            const nudge = shortcutNudge(String(n.type))
            if (nudge) warnings.push(`${n.tempId}: ${nudge}`)
            const posSrc = n.position || {}
            const pos = { x: coordOr(posSrc.x, base.x + i * 320), y: coordOr(posSrc.y, base.y) }
            const created = await ctx.store.addNode(projectId, { type: String(n.type), position_x: pos.x, position_y: pos.y, data: cleaned })
            tempToReal.set(String(n.tempId), { id: created.id, type: String(n.type) })
            createdNodeIds.push(created.id)
          }
          const resolve = (ref: string): { id: string; type: string } | undefined => {
            const t = tempToReal.get(ref)
            if (t) return t
            const existing = findNode(ref)
            return existing ? { id: existing.id, type: existing.type } : undefined
          }
          for (const e of inEdges) {
            const src = resolve(String(e.source))
            const tgt = resolve(String(e.target))
            if (!src) throw new Error(`连线 source 未找到：${e.source}`)
            if (!tgt) throw new Error(`连线 target 未找到：${e.target}`)
            const sh = e.sourceHandle || 'output'
            const th = e.targetHandle || 'input'
            const verdict = canConnect(src, sh, tgt, th)
            if (!verdict.ok) throw new Error(`连线 ${e.source}→${e.target} 非法：${verdict.reason}`)
            // 动态输出口存在性硬校验（防臆造 output-x，运行期静默丢数据）
            const srcNode = findNode(src.id)
            if (srcNode) {
              const dynErr = checkDynamicSourceHandle(srcNode, sh)
              if (dynErr) throw new Error(`连线 ${e.source}→${e.target} 非法：${dynErr}`)
            }
            // 重复连线去重（编辑器有 dup 守卫，智能体侧同款）
            if (findDupEdge(src.id, sh, tgt.id, th)) {
              warnings.push(`连线 ${e.source}(${sh})→${e.target}(${th}) 已存在，跳过重复创建`)
              continue
            }
            const edge = await ctx.store.addEdge(projectId, {
              source_node_id: src.id, source_handle: sh, target_node_id: tgt.id, target_handle: th
            })
            createdEdgeIds.push(edge.id)
          }
        } catch (err: any) {
          for (const eid of createdEdgeIds) { try { await ctx.store.removeEdge(eid) } catch {} }
          for (const nid of [...createdNodeIds].reverse()) { try { await ctx.store.removeNode(nid) } catch {} }
          return { ok: false, error: err?.message || '搭建失败，已回滚', rolledBack: true }
        }
        // 撤销 = 先删本批次连线，再逆序删本批次节点
        const undoOps: InverseOp[] = [
          ...createdEdgeIds.map((id) => ({ kind: 'removeEdge', edgeId: id } as InverseOp)),
          ...[...createdNodeIds].reverse().map((id) => ({ kind: 'removeNode', nodeId: id } as InverseOp))
        ]
        ctx.undo.record({ label: `新建 ${createdNodeIds.length} 个节点、${createdEdgeIds.length} 条连线`, ops: undoOps })
        const idMap: Record<string, string> = {}
        tempToReal.forEach((v, k) => { idMap[k] = v.id })
        return { ok: true, createdNodeIds: idMap, createdEdgeCount: createdEdgeIds.length, warnings }
      }

      case 'canvas_update_node_data': {
        const node = findNode(String(args.nodeId))
        if (!node) return { ok: false, error: `节点不存在：${args.nodeId}` }
        const partial = args.data && typeof args.data === 'object' ? args.data : {}
        const capFields = getNodeCapabilities().find((c) => c.type === node.type)?.fields.map((f) => f.key) || []
        // 白名单 = 能力目录登记字段 ∪ （默认 data 键 − 引擎专属键），与 node-schema 契约对齐
        const allowed = new Set<string>([
          ...Object.keys(getDefaultNodeData(node.type)).filter((k) => k === 'status' || isAgentWritableDataKey(k, undefined)),
          ...capFields
        ])
        // 引擎专属字段（运行态/产物）硬拦：剔除并告警，防伪造 status/产物路径
        const blockedKeys = Object.keys(partial).filter((k) => !isAgentWritableDataKey(k, partial[k]))
        const cleanedPartial: Record<string, any> = { ...partial }
        for (const k of blockedKeys) delete cleanedPartial[k]
        const warnings = [
          ...blockedKeys.map((k) => `字段 ${k} 由执行引擎管理，已忽略（不允许手动设置）`),
          ...Object.keys(cleanedPartial).filter((k) => !allowed.has(k)).map((k) => `字段 ${k} 不在 ${node.type} 的已知字段内`)
        ]
        if (Object.keys(cleanedPartial).length === 0) {
          return { ok: false, error: '没有可写入的字段（所给字段均为引擎管理的运行态/产物字段）', warnings }
        }
        const oldData = JSON.parse(JSON.stringify(node.data || {}))
        const merged = patchNodeData(node.data, cleanedPartial)
        await ctx.store.updateNode(node.id, { data: merged })
        ctx.undo.record({ label: `修改节点「${labelOf(node)}」`, ops: [{ kind: 'restoreNodeData', nodeId: node.id, data: oldData }] })
        return { ok: true, nodeId: node.id, warnings }
      }

      case 'canvas_connect': {
        const src = findNode(String(args.source))
        const tgt = findNode(String(args.target))
        const sh = args.sourceHandle || 'output'
        const th = args.targetHandle || 'input'
        const verdict = canConnect(src, sh, tgt, th)
        if (!verdict.ok) return { ok: false, error: verdict.reason }
        // 动态输出口存在性硬校验（防臆造 output-x，运行期静默丢数据）
        const dynErr = checkDynamicSourceHandle(src!, sh)
        if (dynErr) return { ok: false, error: dynErr }
        // 重复连线去重：已存在相同四元组则直接返回既有 edgeId，不新建
        const dup = findDupEdge(src!.id, sh, tgt!.id, th)
        if (dup) return { ok: true, edgeId: dup.id, duplicated: true, note: '已存在相同连线，未重复创建' }
        const edge = await ctx.store.addEdge(projectId, {
          source_node_id: src!.id, source_handle: sh, target_node_id: tgt!.id, target_handle: th
        })
        ctx.undo.record({ label: `连线 ${tagOf(src!.id)} → ${tagOf(tgt!.id)}`, ops: [{ kind: 'removeEdge', edgeId: edge.id }] })
        return { ok: true, edgeId: edge.id }
      }

      case 'canvas_disconnect': {
        if (args.edgeId) {
          const e = projEdges().find((x) => x.id === args.edgeId)
          if (!e) return { ok: false, error: `连线不存在：${args.edgeId}` }
          const snap = edgeSnapshot(e)
          await ctx.store.removeEdge(String(args.edgeId))
          ctx.undo.record({ label: '删除连线', ops: [{ kind: 'recreateEdge', edge: snap }] })
          return { ok: true, removed: 1 }
        }
        if (args.source && args.sourceHandle) {
          const matched = projEdges().filter((e) => e.source_node_id === args.source && e.source_handle === args.sourceHandle)
          if (matched.length === 0) return { ok: true, removed: 0 }
          const snaps = matched.map(edgeSnapshot)
          await ctx.store.removeEdgesByHandle(String(args.source), String(args.sourceHandle))
          ctx.undo.record({ label: `删除 ${snaps.length} 条连线`, ops: snaps.map((s) => ({ kind: 'recreateEdge', edge: s } as InverseOp)) })
          return { ok: true, removed: snaps.length }
        }
        return { ok: false, error: '需提供 edgeId 或 source+sourceHandle' }
      }

      case 'canvas_delete_node': {
        const node = findNode(String(args.nodeId))
        if (!node) return { ok: false, error: `节点不存在：${args.nodeId}` }
        const snap = nodeSnapshot(node)
        const edges = incidentEdges(node.id).map(edgeSnapshot)
        const label = labelOf(node)
        await ctx.store.removeNode(node.id)
        ctx.undo.record({ label: `删除节点「${label}」`, ops: [{ kind: 'recreateNode', oldId: node.id, snapshot: snap, edges }] })
        return { ok: true, nodeId: node.id }
      }

      case 'canvas_run': {
        if (ctx.engine.isProjectRunning(projectId)) return { ok: false, error: '该画布正在运行中' }
        if (args.nodeId) {
          const node = findNode(String(args.nodeId))
          if (!node) return { ok: false, error: `节点不存在：${args.nodeId}` }
          await ctx.engine.executeSingleNode(node.id, projectId)
          return { ok: true, ran: 'node', message: `已触发节点 ${node.id} 执行` }
        }
        const { valid, errors } = ctx.engine.validateConnectivity(projectId)
        if (!valid) return { ok: false, ran: false, error: '连通性自检未通过', errors }
        const res = await ctx.engine.runWorkflow(projectId)
        return { ok: res.ok, ran: 'workflow', message: res.message }
      }

      case 'canvas_query_nodes': {
        const matched = queryNodes(projNodes(), { type: args.type, status: args.status, keyword: args.keyword })
        return { ok: true, count: matched.length, nodes: matched.map(nodeBrief) }
      }

      case 'canvas_list_dynamic_handles': {
        const node = findNode(String(args.nodeId))
        if (!node) return { ok: false, error: `节点不存在：${args.nodeId}` }
        return { ok: true, handles: listActualOutputHandles(node) }
      }

      case 'canvas_add_reference_image': {
        const imgs = ctx.imageAttachments?.() || []
        const idx = Number(args.index)
        const att = imgs[idx - 1]
        if (!att) return { ok: false, error: `没有第 ${args.index} 张附带图片（共 ${imgs.length} 张）` }
        const auto = autoPosition()
        const posSrc = args.position || {}
        const pos = { x: coordOr(posSrc.x, auto.x), y: coordOr(posSrc.y, auto.y) }
        const node = await ctx.store.addNode(projectId, { type: 'refImage', position_x: pos.x, position_y: pos.y, data: getDefaultNodeData('refImage') })
        // 优先落盘（避免大 base64 进库）；无 saveNodeImage 回退存 image_data
        if (ctx.saveNodeImage) {
          try {
            const saved = await ctx.saveNodeImage(node.id, att.dataUri)
            await ctx.store.updateNode(node.id, { data: { image_data: '', image_path: saved.image_path } })
          } catch {
            await ctx.store.updateNode(node.id, { data: { image_data: att.dataUri, image_path: '' } })
          }
        } else {
          await ctx.store.updateNode(node.id, { data: { image_data: att.dataUri, image_path: '' } })
        }
        ctx.undo.record({ label: `添加参考图「${att.name}」`, ops: [{ kind: 'removeNode', nodeId: node.id }] })
        return { ok: true, nodeId: node.id, name: att.name }
      }

      case 'canvas_kb_search': {
        if (!ctx.kbSearch) return { ok: false, error: '未选择知识库' }
        const query = String(args.query || '').trim()
        if (!query) return { ok: false, error: '缺少检索关键词' }
        const res = await ctx.kbSearch(query, Number(args.topK) || 5)
        if (res.error) return { ok: false, error: res.error }
        return { ok: true, count: res.results.length, hits: res.results }
      }

      case 'canvas_layout': {
        if (!ctx.layout) return { ok: false, error: '当前环境不支持自动布局' }
        await ctx.layout()
        return { ok: true, message: '已整理布局' }
      }

      case 'canvas_undo_last': {
        const tx = await ctx.undo.undoLast()
        if (!tx) return { ok: false, error: '没有可撤销的变更' }
        return { ok: true, undone: tx.label }
      }

      default:
        return { ok: false, error: `未知工具：${name}` }
    }
  }

  return { defs, names, destructive: DESTRUCTIVE_CANVAS_TOOLS, preview, execute }
}
