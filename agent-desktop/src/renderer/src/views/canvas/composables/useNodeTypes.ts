export interface NodeTypeDef {
  type: string
  label: string
  color: string
  inputs: { handle: string; dataType: 'text' | 'image' | 'video'; required: boolean }[]
  outputs: { handle: string; dataType: 'text' | 'image' | 'video' }[]
  dynamicOutputs?: boolean
}

export const NODE_TYPE_DEFS: NodeTypeDef[] = [
  {
    type: 'textInput',
    label: '文本输入',
    color: '#23574f',
    inputs: [],
    outputs: [{ handle: 'output', dataType: 'text' }]
  },
  {
    type: 'aiText',
    label: 'AI 文本',
    color: '#3d6b63',
    inputs: [{ handle: 'input', dataType: 'text', required: true }],
    outputs: [{ handle: 'output', dataType: 'text' }]
  },
  // 智能体节点：节点级对话模型 + 人设(系统提示词) + 本地知识库多选。执行时先对本地库做一次
  // 直接检索并前置拼接到系统提示，再调对话模型；无技能/MCP/流式，契合画布同步单轮语义。
  {
    type: 'agentNode',
    label: '智能体',
    color: '#2f5f6b',
    inputs: [{ handle: 'input', dataType: 'text', required: false }],
    outputs: [{ handle: 'output', dataType: 'text' }]
  },
  {
    type: 'quickOrchestrator',
    label: '快捷编排',
    color: '#1a3f3a',
    inputs: [
      { handle: 'text-input', dataType: 'text', required: false },
      { handle: 'image-input', dataType: 'image', required: false }
    ],
    outputs: [{ handle: 'output', dataType: 'text' }]
  },
  {
    type: 'text2img',
    label: '文生图',
    color: '#a67c52',
    inputs: [
      { handle: 'text-input', dataType: 'text', required: true },
      { handle: 'image-input', dataType: 'image', required: false }
    ],
    outputs: [{ handle: 'output', dataType: 'image' }]
  },
  {
    type: 'img2img',
    label: '图生图',
    color: '#8f5a45',
    inputs: [
      { handle: 'image-input', dataType: 'image', required: true },
      { handle: 'text-input', dataType: 'text', required: false }
    ],
    outputs: [{ handle: 'output', dataType: 'image' }]
  },
  {
    type: 'refImage',
    label: '参考图',
    color: '#5f8f7f',
    inputs: [],
    outputs: [{ handle: 'output', dataType: 'image' }]
  },
  {
    type: 'imageResult',
    label: '图片结果',
    color: '#4a7c74',
    inputs: [{ handle: 'input', dataType: 'image', required: true }],
    outputs: []
  },
  {
    type: 'promptSlice',
    label: '提示词切片',
    color: '#6b7a5a',
    inputs: [],
    outputs: [{ handle: 'output-0', dataType: 'text' }],
    dynamicOutputs: true
  },
  // v0.6.9+：图片反推。把上游 image 反推为可直接用于生图模型的 prompt 文本。
  // 输入 image → 输出 text，是画布上唯一的 image→text 桥；解锁「参考图风格迁移」「多图融合」等工作流。
  // 视觉模型优先级：node.data.vision_provider_id > project.vision_provider_id；都为空时报错。
  {
    type: 'reverse',
    label: '图片反推',
    color: '#3d6b63',
    inputs: [{ handle: 'image-input', dataType: 'image', required: true }],
    outputs: [{ handle: 'output', dataType: 'text' }]
  },
  {
    type: 'imageRecognition',
    label: '识图',
    color: '#2f5f6b',
    inputs: [{ handle: 'image-input', dataType: 'image', required: true }],
    outputs: [{ handle: 'output', dataType: 'text' }]
  },
  // 快速抠图入口已下线；画布「AI 抠图」节点同步隐藏（旧画布节点仍可加载，不可新建）
  // {
  //   type: 'matting',
  //   label: 'AI 抠图',
  //   color: '#5a6b63',
  //   inputs: [{ handle: 'image-input', dataType: 'image', required: true }],
  //   outputs: [{ handle: 'output', dataType: 'image' }]
  // },
  // v0.7.14+ AI 视频：上游文本/图片 → 视频（dataType 'video'）。
  // 图片输入按模式分槽：image-input=参考图（图生视频，可多连）；first/last-frame-input=首尾帧（各 1 张）。
  // 规格/计费走 L2 catalog；异步任务由 useVideoTaskPolling 轮询、完成后落盘到 canvas/{projectId}/。
  {
    type: 'aiVideo',
    label: 'AI 视频',
    color: '#4a5c58',
    inputs: [
      { handle: 'text-input', dataType: 'text', required: false },
      { handle: 'image-input', dataType: 'image', required: false },
      { handle: 'first-frame-input', dataType: 'image', required: false },
      { handle: 'last-frame-input', dataType: 'image', required: false }
    ],
    outputs: [{ handle: 'output', dataType: 'video' }]
  },
  {
    type: 'videoResult',
    label: '视频结果',
    color: '#4a5c58',
    inputs: [{ handle: 'input', dataType: 'video', required: true }],
    outputs: []
  },
  // v0.7.14+ 视频创作链：视频源 → 关键帧/反推 → 回喂 aiVideo；小说 → 智能分镜
  {
    type: 'videoInput',
    label: '视频输入',
    color: '#2f5f6b',
    inputs: [],
    outputs: [{ handle: 'output', dataType: 'video' }]
  },
  // 关键帧抽取：video → 多张 image（动态输出，每帧一个 output-{frameId}）
  {
    type: 'videoFrames',
    label: '关键帧抽取',
    color: '#3d6b63',
    inputs: [{ handle: 'video-input', dataType: 'video', required: true }],
    outputs: [{ handle: 'output-0', dataType: 'image' }],
    dynamicOutputs: true
  },
  // 视频反推：video → text（抽代表帧 + 多模态拆解为提示词/分镜）
  {
    type: 'videoReverse',
    label: '视频反推',
    color: '#0d9488',
    inputs: [{ handle: 'video-input', dataType: 'video', required: true }],
    outputs: [{ handle: 'output', dataType: 'text' }]
  },
  // 智能分镜：text(小说/剧情) → 多条镜头提示词 text（动态输出，每镜头一个 output-{shotId}）
  {
    type: 'storyboard',
    label: '智能分镜',
    color: '#1a3f3a',
    inputs: [{ handle: 'text-input', dataType: 'text', required: false }],
    outputs: [{ handle: 'output-0', dataType: 'text' }],
    dynamicOutputs: true
  },
  // 角色一致性：创建角色（生成定妆图 + 入库）/ 角色引用（选库中角色输出参考图）
  {
    type: 'createCharacter',
    label: '创建角色',
    color: '#8f5a45',
    inputs: [{ handle: 'text-input', dataType: 'text', required: false }],
    outputs: [{ handle: 'output', dataType: 'image' }]
  },
  {
    type: 'characterRef',
    label: '角色引用',
    color: '#8f5a45',
    inputs: [],
    outputs: [{ handle: 'output', dataType: 'image' }]
  }
]

export function getNodeTypeDef(type: string): NodeTypeDef | undefined {
  return NODE_TYPE_DEFS.find((d) => d.type === type)
}

/** 加号菜单 / 面板是否提供该节点。抠图节点已从 NODE_TYPE_DEFS 注释掉；视频节点已恢复。 */
export function isPaletteNodeType(_type: string): boolean {
  return true
}

export function paletteNodeTypeDefs(): NodeTypeDef[] {
  return NODE_TYPE_DEFS.filter((d) => isPaletteNodeType(d.type))
}

export function getHandleType(
  nodeType: string,
  handleId: string,
  direction: 'input' | 'output'
): 'text' | 'image' | 'video' | null {
  const def = getNodeTypeDef(nodeType)
  if (!def) return null

  if (direction === 'input') {
    const input = def.inputs.find((i) => i.handle === handleId)
    return input?.dataType || null
  } else {
    // Dynamic outputs: match any handle with the same prefix pattern
    if (def.dynamicOutputs && handleId.startsWith('output-')) {
      return def.outputs[0]?.dataType || null
    }
    const output = def.outputs.find((o) => o.handle === handleId)
    return output?.dataType || null
  }
}
