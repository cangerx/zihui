// Unified model capability detection + grouping/sorting.
// Source of truth for all model selection dropdowns across the app.
//
// 识别策略（自动，零手动）：
//   1. 云端模型（cloudType 有值）→ 完全按云控后台 cloud_models.type 字段识别（单一真值）
//   2. 本地模型（cloudType 为 undefined）→ 按下方关键字识别表
//   3. 无论哪种来源，都不会"隐藏"模型 — 落到"其他可用"组照样能选；
//      用户成功使用过一次后，model-usage-hints 会自动反向兜底，下次进推荐区。

export type ModelCap = 'chat' | 'vision' | 'image' | 'embedding' | 'tts' | 'asr' | 'rerank'

/**
 * 子类一票否决关键字：命中即独占（这些模型一定不是 chat）。
 * 来源：常见模型类别速查表（覆盖 2024-2025 主流国内外厂商）。
 */
const SUBTYPE_KEYWORDS: Record<Exclude<ModelCap, 'chat' | 'vision'>, string[]> = {
  // 重排（必须先于 embedding 判定，因为 'bge-reranker-large' 同时含 'bge-' 与 'rerank'）
  rerank: ['rerank', 'reranker'],

  // 文本向量
  embedding: [
    'embedding', 'embed-',
    'bge-', 'gte-', 'e5-', 'm3e-', 'jina-embed', 'voyage-'
  ],

  // 语音合成
  tts: [
    'tts-', '-tts', 'audio-speech', 'speech-synthesis',
    'cosyvoice', 'eleven-', 'seed-tts'
  ],

  // 语音识别
  asr: [
    'whisper', 'speech-recognition', 'speech-to-text',
    'sense-voice', 'paraformer'
  ],

  // 图像生成
  image: [
    // OpenAI / Google
    'dall-e', 'gpt-image', 'imagen',
    // Black Forest Labs / Stability
    'flux', 'stable-diffusion', 'sd3', 'sd-3', 'sdxl',
    // 其他海外厂商
    'midjourney', 'mj-', 'ideogram', 'recraft', 'playground-v',
    'kandinsky', 'pixart', 'omnigen',
    // 国产厂商
    'cogview', 'wanx', 'wan2', 'kolors',
    'jimeng', 'seedream', 'kling',
    'hunyuan-image', 'hunyuan-dit'
  ]
}

/**
 * 多模态视觉关键字：与 chat 共存（命中后叠加 vision 标志）。
 * 注：claude-3.5-haiku 实际不支持 vision，但 'claude-3' 关键字会让它进 vision 推荐 —
 * 这是命中率与简洁性的权衡，用户用错时会在调用处报错（且能在"其他可用"里选别的）。
 */
const VISION_KEYWORDS: string[] = [
  // 命名模式
  '-vl', 'vl-', 'vl2', 'vl3', '-vision', 'multimodal', 'omni',
  // OpenAI（4o/gpt-4-turbo/gpt-4-vision 全系带 vision）
  '4o', 'gpt-4o', 'gpt-4-turbo', 'gpt-4-vision',
  // Anthropic / Google（claude-3+ / sonnet / opus / gemini 全系带 vision）
  'claude-3', 'claude-4', 'sonnet', 'opus', 'gemini',
  // 国产
  'qwen-vl', 'qwen2-vl', 'qwen2.5-vl', 'qwen3-vl',
  'glm-4v', 'glm-4-v', 'glm-4.5v',
  'doubao-vision', 'doubao-1-5-vision', 'doubao-1.5-vision',
  'yi-vl', 'step-1v', 'step-2v',
  'hunyuan-vision',
  // 开源多模态
  'internvl', 'cogvlm', 'minicpm-v', 'llava', 'pixtral', 'molmo', 'idefics'
]

function hasAny(lower: string, list: string[]): boolean {
  return list.some(k => lower.includes(k))
}

/**
 * 按模型 id 关键字识别能力（仅本地服务商使用）。
 *
 * 规则：
 *   1. 命中 rerank/embedding/tts/asr/image 任一关键字 → 独占该 cap（绝不可能是 chat）
 *   2. 否则默认 chat，并按 vision 关键字叠加 vision 标志
 *
 * 这是"非排除即 chat"兜底策略，避免 chat 白名单永远跟不上新模型（如 qwen3-coder / o4-mini-text）
 * 或私有部署模型（my-internal-llm）落不进推荐区的问题。
 */
export function detectCapsByName(modelId: string): ModelCap[] {
  const lower = (modelId || '').toLowerCase()
  if (!lower) return []

  // 一票否决：顺序敏感（rerank > embedding > tts > asr > image）
  if (hasAny(lower, SUBTYPE_KEYWORDS.rerank)) return ['rerank']
  if (hasAny(lower, SUBTYPE_KEYWORDS.embedding)) return ['embedding']
  if (hasAny(lower, SUBTYPE_KEYWORDS.tts)) return ['tts']
  if (hasAny(lower, SUBTYPE_KEYWORDS.asr)) return ['asr']
  if (hasAny(lower, SUBTYPE_KEYWORDS.image)) return ['image']

  // 兜底：默认 chat，按 vision 关键字叠加 vision
  const caps: ModelCap[] = ['chat']
  if (hasAny(lower, VISION_KEYWORDS)) caps.push('vision')
  return caps
}

/**
 * 按云控端 cloud_models.type 字段识别能力（仅云端模型使用）。
 * 这是云端模型的单一真值，不与名字识别合并。
 *
 * 当前后台支持的 type 取值：chat / image / embedding / tts / asr / rerank / vision
 *
 * 注：云控后台目前只配 chat / image 两种 type，没有独立的 vision type。
 * 主流云端 chat 模型（GPT-4o / Claude-3+ / Gemini / Qwen-VL 等）多数原生支持视觉输入，
 * 因此 chat 类型同时叠加 vision 标志，让图片反推等 vision 入口能选到云端模型；
 * 极少数纯文本 chat 模型若被误选会在调用处报错（与本地模型按关键字识别同样的"命中率与简洁性权衡"）。
 */
export function capsFromCloudType(cloudType: string | undefined): ModelCap[] {
  if (!cloudType) return []
  const t = cloudType.toLowerCase()
  if (t === 'chat') return ['chat', 'vision']
  if (t === 'image') return ['image']
  if (t === 'embedding') return ['embedding']
  if (t === 'tts') return ['tts']
  if (t === 'asr') return ['asr']
  if (t === 'rerank') return ['rerank']
  if (t === 'vision') return ['vision']
  return []
}

/**
 * 综合识别（按数据来源分流，不做合并）：
 *   - 云端模型（cloudType 有值）→ 完全按 cloud_models.type 识别（单一真值）
 *   - 本地模型（cloudType 为 undefined）→ 按关键字识别表
 */
export function getModelCaps(modelId: string, cloudType?: string): ModelCap[] {
  if (cloudType !== undefined) {
    return capsFromCloudType(cloudType)
  }
  return detectCapsByName(modelId)
}

export function hasCap(modelId: string, cap: ModelCap, cloudType?: string): boolean {
  return getModelCaps(modelId, cloudType).includes(cap)
}

/**
 * Group models into "recommended" vs "others" for a given capability.
 * - recommended = caps-detected OR in usageHints（用户用过的会反向覆盖识别）
 * - others = the rest, alphabetical
 * Never hides anything — every model in the input appears in exactly one group.
 */
export function groupAndSort(
  models: string[],
  cap: ModelCap,
  opts: {
    cloudTypeOf?: (modelId: string) => string | undefined
    usageHints?: string[]
  } = {}
): { recommended: string[]; others: string[] } {
  const cloudTypeOf = opts.cloudTypeOf || (() => undefined)
  const hints = opts.usageHints || []
  const hintRank = new Map<string, number>()
  hints.forEach((id, i) => hintRank.set(id, i))

  const recommended: string[] = []
  const others: string[] = []

  for (const m of models) {
    const capable = hasCap(m, cap, cloudTypeOf(m))
    const inHints = hintRank.has(m)
    if (capable || inHints) recommended.push(m)
    else others.push(m)
  }

  // Sort recommended: hints first (by rank), then caps-only alphabetical
  recommended.sort((a, b) => {
    const ra = hintRank.has(a) ? hintRank.get(a)! : Infinity
    const rb = hintRank.has(b) ? hintRank.get(b)! : Infinity
    if (ra !== rb) return ra - rb
    return a.localeCompare(b)
  })
  others.sort((a, b) => a.localeCompare(b))

  return { recommended, others }
}
