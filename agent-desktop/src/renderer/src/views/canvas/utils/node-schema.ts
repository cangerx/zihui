// 画布节点契约共享层
// -----------------------------------------------------------------------------
// 从 CanvasEditorView.vue 下沉的节点「默认数据 / 连线合法性 / 禁止组合」以及一批
// 供「画布智能体」使用的新原语（增量改 data / 动态输出 handle / 查询 / 校验 /
// 能力目录）。目的：让画布编辑器与画布智能体工具共用同一份真源，避免两处各写一份
// 导致漂移。本文件为纯函数，不依赖 Vue 响应式，可被组件、composable、工具层任意引用。

import { NODE_TYPE_DEFS, getNodeTypeDef, getHandleType, type NodeTypeDef } from '../composables/useNodeTypes'
import type { CanvasNode } from '@/stores/canvas'

/** 快捷编排「产品工作流」默认指令（原分散在 CanvasEditorView / QuickOrchestratorNode） */
export const QUICK_PRODUCT_DEFAULT_INSTRUCTION =
  '根据参考图，产品是XXXXXX，生成一套产品的多张电商主图，展现产品的不同角度和不同场景的实景。多张电商详情图，分别使用图文的形式突出产品的材质质感、卖点和使用场景等。'

// -----------------------------------------------------------------------------
// 默认数据工厂
// -----------------------------------------------------------------------------

/**
 * 每类节点新建时的初始 data（含全部关键字段与默认值）。
 * 画布智能体新建任意节点时必须以此为蓝本，再浅合并用户/模型指定的字段，
 * 否则节点缺字段会导致渲染或执行异常。
 */
export function getDefaultNodeData(type: string): Record<string, any> {
  switch (type) {
    case 'textInput': return { text: '' }
    case 'aiText': return { text: '', result: '', status: 'idle' }
    case 'agentNode': return { kb_category_ids: [], result: '', status: 'idle', error: '' }
    case 'quickOrchestrator': return {
      mode: 'product_workflow',
      instruction: QUICK_PRODUCT_DEFAULT_INSTRUCTION,
      count: 4,
      main_count: 4,
      detail_count: 3,
      size: '1:1',
      main_size: '1:1',
      detail_size: '4:5',
      tier_id: '2k',
      quality: 'auto',
      require_reference: false,
      detail_consistency_enabled: false,
      outputContent: '',
      plan_json: null,
      created_node_ids: [],
      created_edge_ids: [],
      status: 'idle',
      error: ''
    }
    // 图片反推：默认 general / cn；vision_* 留空表示走画布设置默认视觉模型
    case 'reverse': return {
      vision_provider_id: '',
      vision_model_id: '',
      style_preset: 'general',
      output_lang: 'cn',
      custom_prompt: '',
      result: '',
      status: 'idle',
      error: ''
    }
    case 'imageRecognition': return {
      vision_provider_id: '',
      vision_model_id: '',
      result: '',
      status: 'idle',
      error: ''
    }
    case 'text2img': return { model_provider_id: '', model_id: '', size: '1:1', tier_id: '2k', quality: 'auto', status: 'idle', generation_id: '', result_path: '' }
    case 'img2img': return { model_provider_id: '', model_id: '', size: '1:1', tier_id: '2k', quality: 'auto', status: 'idle', generation_id: '', result_path: '' }
    case 'refImage': return { image_data: '', image_path: '' }
    case 'imageResult': return { generation_id: '', result_path: '', result_url: '' }
    case 'promptSlice': return { rows: [] }
    // v0.6.9+ AI 抠图节点：默认走云接口；用户在「模型服务 → 抠图接口」加了默认接口时自动直连阿里
    case 'matting': return {
      matting_source: 'cloud',
      matting_provider_id: '',
      status: 'idle',
      result_path: '',
      matting_task_id: '',
      error: ''
    }
    case 'aiVideo': return {
      model_id: '', mode: '', duration_seconds: 0, resolution: '', aspect_ratio: '', prompt: '',
      sku_key: '', status: 'idle', progress: 0, error: '', cloud_task_id: '', video_url: '', cover_url: '', result_path: ''
    }
    case 'videoResult': return {}
    case 'videoInput': return { video_path: '' }
    case 'videoFrames': return { mode: 'uniform', count: 4, intervalSec: 2, frames: [], status: 'idle', error: '' }
    case 'videoReverse': return { mode: 'prompt', output_lang: 'cn', frameLimit: 8, vision_provider_id: '', vision_model_id: '', result: '', status: 'idle', error: '' }
    case 'storyboard': return { mode: 'novel', text: '', shots: [], status: 'idle', error: '' }
    case 'createCharacter': return { name: '', description: '', result_path: '', character_id: '', status: 'idle', error: '' }
    case 'characterRef': return { character_id: '', character_name: '', image_path: '' }
    default: return {}
  }
}

// -----------------------------------------------------------------------------
// 连线合法性
// -----------------------------------------------------------------------------

/**
 * 禁止的「源节点类型 → 目标节点类型」组合（与 canConnect 的同源规则保持一致）。
 * 供 handle 建节点菜单在候选层做过滤。新增禁止对时两处一起改。
 */
export function isForbiddenCombination(srcNodeType: string | undefined, targetNodeType: string): boolean {
  if (srcNodeType === 'refImage' && targetNodeType === 'imageResult') return true
  return false
}

/** 连线校验结果：ok=true 表示可连，否则 reason 给出人类可读原因（供工具回报） */
export interface ConnectVerdict {
  ok: boolean
  reason?: string
}

/**
 * 纯数据版连线合法性校验（数据类型匹配 + 禁自连 + 禁 refImage→imageResult）。
 * 不依赖 VueFlow Connection 类型：入参为已解析出的源/目标节点（至少含 id 与 type）
 * 与两端 handle。画布编辑器与画布智能体的连线工具共用此函数。
 */
export function canConnect(
  source: { id: string; type: string } | undefined | null,
  sourceHandle: string | null | undefined,
  target: { id: string; type: string } | undefined | null,
  targetHandle: string | null | undefined
): ConnectVerdict {
  if (!source || !target) return { ok: false, reason: '源节点或目标节点不存在' }
  if (source.id === target.id) return { ok: false, reason: '不能连接节点自身' }
  if (source.type === 'refImage' && target.type === 'imageResult') {
    return { ok: false, reason: '参考图不能直接连到图片结果' }
  }
  const srcType = getHandleType(source.type, sourceHandle || 'output', 'output')
  const tgtType = getHandleType(target.type, targetHandle || 'input', 'input')
  if (srcType === null) return { ok: false, reason: `源节点 ${source.type} 无输出口 ${sourceHandle || 'output'}` }
  if (tgtType === null) return { ok: false, reason: `目标节点 ${target.type} 无输入口 ${targetHandle || 'input'}` }
  if (srcType !== tgtType) {
    return { ok: false, reason: `数据类型不匹配（${srcType} → ${tgtType}），只能同类型相连` }
  }
  return { ok: true }
}

// -----------------------------------------------------------------------------
// 动态输出 handle
// -----------------------------------------------------------------------------

/**
 * 列出某节点当前真实可连的输出 handle。
 * 普通节点直接返回类型定义里的静态 outputs；
 * 动态输出节点（promptSlice / videoFrames / storyboard）的输出口由内部
 * rows/frames/shots 的 id 派生（形如 output-{id}），必须读 data 才能枚举——
 * 智能体连这类节点的输出前必须先调用它拿到真实 handle，不能臆造。
 */
export function listActualOutputHandles(node: CanvasNode): { handle: string; dataType: 'text' | 'image' | 'video' }[] {
  const def = getNodeTypeDef(node.type)
  if (!def) return []
  if (!def.dynamicOutputs) {
    return def.outputs.map((o) => ({ handle: o.handle, dataType: o.dataType }))
  }
  const dataType = def.outputs[0]?.dataType || 'text'
  const rows: any[] =
    node.type === 'promptSlice' ? (node.data?.rows || [])
      : node.type === 'videoFrames' ? (node.data?.frames || [])
        : node.type === 'storyboard' ? (node.data?.shots || [])
          : []
  const ids = rows.map((r) => r?.id).filter((id) => id != null)
  if (ids.length === 0) {
    // 尚无子项时退回静态定义的占位 handle（output-0），与 getHandleType 前缀匹配一致
    return def.outputs.map((o) => ({ handle: o.handle, dataType: o.dataType }))
  }
  return ids.map((id) => ({ handle: `output-${id}`, dataType }))
}

// -----------------------------------------------------------------------------
// 增量改 data / 查询
// -----------------------------------------------------------------------------

/**
 * 字段级增量合并 node.data：仅覆盖 partial 里列出的键，其余保持不变。
 * 返回新对象（不改动入参），供智能体「只改提示词/尺寸」而不误伤其他配置。
 */
export function patchNodeData(current: Record<string, any> | undefined, partial: Record<string, any>): Record<string, any> {
  return { ...(current || {}), ...(partial || {}) }
}

/** 节点查询过滤条件（任一字段可省略，省略即不限制） */
export interface NodeQueryFilter {
  type?: string
  /** 运行态 data.status，如 idle/running/done/error */
  status?: string
  /** 在 type/label/关键文本字段里做不区分大小写的包含匹配 */
  keyword?: string
}

/**
 * 按类型 / 状态 / 关键词过滤节点，避免智能体每次拉回整图自己过滤。
 * 关键词匹配范围：节点类型、类型中文标签、以及常见文本字段（text/prompt/
 * instruction/description/name/result）。
 */
export function queryNodes(nodes: CanvasNode[], filter: NodeQueryFilter): CanvasNode[] {
  const kw = filter.keyword?.trim().toLowerCase()
  return nodes.filter((n) => {
    if (filter.type && n.type !== filter.type) return false
    if (filter.status && (n.data?.status || 'idle') !== filter.status) return false
    if (kw) {
      const label = getNodeTypeDef(n.type)?.label || ''
      const hay = [
        n.type, label,
        n.data?.text, n.data?.prompt, n.data?.instruction,
        n.data?.description, n.data?.name, n.data?.result
      ].filter((v) => typeof v === 'string').join(' ').toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  })
}

// -----------------------------------------------------------------------------
// 节点能力目录（供 canvas_list_node_types 工具输出）
// -----------------------------------------------------------------------------

/** 单个可配置 data 字段的描述 */
export interface NodeDataField {
  key: string
  /** 字段值类型（用于提示模型该填什么） */
  kind: 'string' | 'number' | 'boolean' | 'string[]' | 'ratio' | 'enum'
  desc: string
  /** kind==='enum' 时的确信取值集合；比例/尺寸等取值不完整的字段用 kind='ratio' 或在 desc 里说明 */
  enum?: string[]
}

/**
 * 每类节点「智能体可设置的 data 字段」登记表。
 * 只登记用户/模型有意义去配置的字段，刻意排除运行态与产物字段
 * （如 status、error、result、generation_id、result_path、progress、cloud_task_id、
 * 各类 task_id、plan_json、created_node_ids、created_edge_ids、各类 url），这些由执行引擎写。
 * enum 仅登记确信的取值；尺寸/比例等完整取值集合以节点组件为准，这里用 ratio 或说明标注。
 */
const NODE_DATA_FIELDS: Record<string, NodeDataField[]> = {
  textInput: [{ key: 'text', kind: 'string', desc: '文本内容' }],
  aiText: [{ key: 'text', kind: 'string', desc: '给 AI 的提示词（吃上游文本，输出文本）' }],
  agentNode: [
    { key: 'system_prompt', kind: 'string', desc: '智能体人设 / 系统提示词，留空则按输入自由响应' },
    { key: 'kb_category_ids', kind: 'string[]', desc: '挂载的本地知识库分类 id 列表' }
  ],
  quickOrchestrator: [
    { key: 'mode', kind: 'enum', enum: ['product_workflow', 'batch_image', 'storyboard'], desc: '编排模式：产品工作流 / 批量生图 / 分镜' },
    { key: 'instruction', kind: 'string', desc: '编排指令（自然语言描述要生成什么）' },
    { key: 'main_count', kind: 'number', desc: '主图数量' },
    { key: 'detail_count', kind: 'number', desc: '详情图数量' },
    { key: 'main_size', kind: 'ratio', desc: '主图比例，如 1:1 / 3:4' },
    { key: 'detail_size', kind: 'ratio', desc: '详情图比例，如 4:5' },
    { key: 'tier_id', kind: 'string', desc: '分辨率档位，如 1k / 2k / 4k' },
    { key: 'quality', kind: 'string', desc: '质量，如 auto / high' },
    { key: 'require_reference', kind: 'boolean', desc: '是否必须有参考图' },
    { key: 'detail_consistency_enabled', kind: 'boolean', desc: '详情图是否链式保持风格一致' }
  ],
  text2img: [
    { key: 'model_provider_id', kind: 'string', desc: '生图服务商 id（留空走画布设置）' },
    { key: 'model_id', kind: 'string', desc: '生图模型 id（留空走画布设置）' },
    { key: 'size', kind: 'ratio', desc: '出图比例，如 1:1 / 4:5 / 16:9' },
    { key: 'tier_id', kind: 'string', desc: '分辨率档位，如 1k / 2k / 4k' },
    { key: 'quality', kind: 'string', desc: '质量，如 auto / high' }
  ],
  img2img: [
    { key: 'model_provider_id', kind: 'string', desc: '生图服务商 id（留空走画布设置）' },
    { key: 'model_id', kind: 'string', desc: '生图模型 id（留空走画布设置）' },
    { key: 'prompt', kind: 'string', desc: '改图提示词' },
    { key: 'size', kind: 'ratio', desc: '出图比例' },
    { key: 'tier_id', kind: 'string', desc: '分辨率档位' },
    { key: 'quality', kind: 'string', desc: '质量' }
  ],
  refImage: [{ key: 'image_path', kind: 'string', desc: '参考图路径（通常由用户上传，智能体一般不直接设置）' }],
  reverse: [
    { key: 'style_preset', kind: 'string', desc: '反推风格预设，默认 general' },
    { key: 'output_lang', kind: 'enum', enum: ['cn', 'en'], desc: '输出语言：中文 / 英文' },
    { key: 'custom_prompt', kind: 'string', desc: '自定义反推提示词' },
    { key: 'vision_provider_id', kind: 'string', desc: '视觉服务商 id（留空走画布设置）' },
    { key: 'vision_model_id', kind: 'string', desc: '视觉模型 id（留空走画布设置）' }
  ],
  imageRecognition: [
    { key: 'vision_provider_id', kind: 'string', desc: '视觉服务商 id（留空走画布设置）' },
    { key: 'vision_model_id', kind: 'string', desc: '视觉模型 id（留空走画布设置）' }
  ],
  matting: [
    { key: 'matting_source', kind: 'enum', enum: ['cloud', 'custom'], desc: '抠图来源：云接口 / 自定义接口' },
    { key: 'matting_provider_id', kind: 'string', desc: 'custom 时指向本地抠图 provider id' }
  ],
  aiVideo: [
    { key: 'model_id', kind: 'string', desc: '视频模型 id' },
    { key: 'mode', kind: 'string', desc: '生成模式（随模型规格而定）' },
    { key: 'duration_seconds', kind: 'number', desc: '时长（秒）' },
    { key: 'resolution', kind: 'string', desc: '分辨率（随模型规格而定）' },
    { key: 'aspect_ratio', kind: 'ratio', desc: '画面比例' },
    { key: 'prompt', kind: 'string', desc: '视频提示词' },
    { key: 'sku_key', kind: 'string', desc: '计费规格 key' }
  ],
  videoInput: [{ key: 'video_path', kind: 'string', desc: '视频文件路径' }],
  videoFrames: [
    { key: 'mode', kind: 'enum', enum: ['uniform', 'count', 'interval'], desc: '抽帧模式：均匀 / 按数量 / 按间隔' },
    { key: 'count', kind: 'number', desc: '抽帧数量' },
    { key: 'intervalSec', kind: 'number', desc: '抽帧间隔（秒）' }
  ],
  videoReverse: [
    { key: 'mode', kind: 'string', desc: '反推模式，默认 prompt' },
    { key: 'output_lang', kind: 'enum', enum: ['cn', 'en'], desc: '输出语言' },
    { key: 'frameLimit', kind: 'number', desc: '代表帧数量上限' },
    { key: 'vision_provider_id', kind: 'string', desc: '视觉服务商 id（留空走画布设置）' },
    { key: 'vision_model_id', kind: 'string', desc: '视觉模型 id（留空走画布设置）' }
  ],
  storyboard: [
    { key: 'mode', kind: 'enum', enum: ['novel', 'text'], desc: '分镜来源：小说 / 普通文本' },
    { key: 'text', kind: 'string', desc: '待分镜的文本内容' }
  ],
  createCharacter: [
    { key: 'name', kind: 'string', desc: '角色名称' },
    { key: 'description', kind: 'string', desc: '角色描述（用于生成定妆图）' }
  ],
  characterRef: [
    { key: 'character_id', kind: 'string', desc: '引用的角色 id（来自角色库）' }
  ]
}

/** 一类节点的完整能力描述（handle 契约 + 可配置 data 字段） */
export interface NodeCapability {
  type: string
  label: string
  inputs: { handle: string; dataType: 'text' | 'image' | 'video'; required: boolean }[]
  outputs: { handle: string; dataType: 'text' | 'image' | 'video' }[]
  dynamicOutputs: boolean
  fields: NodeDataField[]
}

/**
 * 生成全部节点类型的能力目录：把 NODE_TYPE_DEFS（handle/dataType/required，机器真源）
 * 与 NODE_DATA_FIELDS（可配置 data 字段，人工登记）合并。供 canvas_list_node_types
 * 工具序列化后喂给模型，让它知道能建什么节点、每类能连什么口、能设哪些字段。
 */
export function getNodeCapabilities(): NodeCapability[] {
  return NODE_TYPE_DEFS.map((def: NodeTypeDef) => ({
    type: def.type,
    label: def.label,
    inputs: def.inputs.map((i) => ({ handle: i.handle, dataType: i.dataType, required: i.required })),
    outputs: def.outputs.map((o) => ({ handle: o.handle, dataType: o.dataType })),
    dynamicOutputs: Boolean(def.dynamicOutputs),
    fields: NODE_DATA_FIELDS[def.type] || []
  }))
}

// -----------------------------------------------------------------------------
// 写入前轻校验
// -----------------------------------------------------------------------------

/**
 * 引擎专属（运行态/产物）data 字段：由执行引擎写入，智能体不允许手动设置。
 * 与 NODE_DATA_FIELDS 登记表「刻意排除运行态与产物字段」的契约对齐——此前创建/更新
 * 白名单以 getDefaultNodeData 键为基底，这些字段被放行，模型可伪造 status:'done' 或
 * 悬空 result_path 等（quickOrchestrator 会因此被幂等守卫静默跳过），故统一在此硬拦。
 * 唯一例外：status:'idle' 放行（用于把 error 节点复位重跑）。
 */
export const ENGINE_OWNED_DATA_KEYS = new Set<string>([
  'status', 'error', 'progress', 'result',
  'result_path', 'result_url', 'generation_id',
  'cloud_task_id', 'matting_task_id', 'video_url', 'cover_url',
  'plan_json', 'created_node_ids', 'created_edge_ids', 'outputContent',
  'image_data', 'frames', 'shots'
])

/** 该字段是否允许智能体写入：引擎字段一律拒绝，仅放行 status:'idle' 复位 */
export function isAgentWritableDataKey(key: string, value: any): boolean {
  if (!ENGINE_OWNED_DATA_KEYS.has(key)) return true
  return key === 'status' && value === 'idle'
}

/** validateNodeData 结果：cleaned 为可安全写库的 data，warnings 收集被剔除/存疑项 */
export interface ValidateResult {
  ok: boolean
  cleaned: Record<string, any>
  warnings: string[]
}

/**
 * 智能体新建节点时对其产出的 data 做一层「轻校验」：以默认 data 为白名单基底，
 * 剔除未知字段、对已登记的 enum 字段做取值提示（不硬拦，宽松保留），最终返回
 * 「默认值 + 已知字段覆盖」的干净对象。目的是挡住明显脏字段导致的渲染/执行异常，
 * 而不是做严格 schema 校验（画布 data 本就是自由 JSON）。
 *
 * 注意：这是给「创建」用的全量校验；「更新」单字段请用 patchNodeData。
 */
export function validateNodeData(type: string, data: Record<string, any> | undefined | null): ValidateResult {
  const warnings: string[] = []
  const def = getNodeTypeDef(type)
  if (!def) {
    return { ok: false, cleaned: {}, warnings: [`未知节点类型：${type}`] }
  }
  const defaults = getDefaultNodeData(type)
  const cleaned: Record<string, any> = { ...defaults }
  const fields = NODE_DATA_FIELDS[type] || []
  // 白名单 = 默认 data 键 ∪ 能力目录登记的可配置字段（后者覆盖默认里没列但合法的字段，
  // 如 agentNode.system_prompt）
  const allowedKeys = new Set<string>([...Object.keys(defaults), ...fields.map((f) => f.key)])
  const enumMap = new Map(fields.filter((f) => f.kind === 'enum').map((f) => [f.key, f.enum || []]))
  const input = data && typeof data === 'object' ? data : {}
  for (const [key, value] of Object.entries(input)) {
    if (!allowedKeys.has(key)) {
      warnings.push(`剔除未知字段：${key}`)
      continue
    }
    // 引擎专属字段（运行态/产物）不接受模型写入，防伪造完成态/悬空产物路径
    if (!isAgentWritableDataKey(key, value)) {
      warnings.push(`字段 ${key} 由执行引擎管理，已忽略（不允许手动设置）`)
      continue
    }
    const allowed = enumMap.get(key)
    if (allowed && allowed.length > 0 && typeof value === 'string' && !allowed.includes(value)) {
      warnings.push(`字段 ${key} 取值「${value}」不在建议范围（${allowed.join('/')}），已按原值保留`)
    }
    cleaned[key] = value
  }
  return { ok: true, cleaned, warnings }
}
