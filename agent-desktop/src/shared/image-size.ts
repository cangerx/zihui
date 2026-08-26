/**
 * 生图尺寸：单一真源 + 纯函数，前后端共用。
 *
 * 支持三类 value：
 *  - 预设比例 value（如 "1:1" / "9:21"）→ 走权威像素
 *  - 自定义比例（如 "7:3"）→ 按长边策略换算为 snap 到 PIXEL_SNAP 倍数
 *  - 自定义像素（如 "960x1280" / "960×1280"）→ 原样透传（snap 到 PIXEL_SNAP 倍数）
 */

export interface ImageSizePreset {
  /** UI 显示文本（通常等于 value） */
  label: string
  /** 持久化与 UI 绑定值 */
  value: string
  /** 规范像素串 "WxH" */
  pixels: string
  /** 解析后的比例 [w, h]，方便 UI 渲染缩略图 */
  ratio: [number, number]
}

/**
 * 权威预设表。新增预设只需在这里追加一行，前后端自动同步。
 * 像素映射遵循"竖向保持长边 1792"风格（与 16:9 / 9:16 / 21:9 保持一致）。
 */
export const IMAGE_SIZE_PRESETS: readonly ImageSizePreset[] = [
  { label: '1:1', value: '1:1', pixels: '1024x1024', ratio: [1, 1] },
  { label: '2:1', value: '2:1', pixels: '1792x896', ratio: [2, 1] },
  { label: '3:1', value: '3:1', pixels: '1536x512', ratio: [3, 1] },
  { label: '3:2', value: '3:2', pixels: '1536x1024', ratio: [3, 2] },
  { label: '4:3', value: '4:3', pixels: '1024x768', ratio: [4, 3] },
  { label: '5:4', value: '5:4', pixels: '1024x816', ratio: [5, 4] },
  { label: '16:9', value: '16:9', pixels: '1792x1024', ratio: [16, 9] },
  { label: '21:9', value: '21:9', pixels: '1792x768', ratio: [21, 9] },
  { label: '1:2', value: '1:2', pixels: '896x1792', ratio: [1, 2] },
  { label: '1:3', value: '1:3', pixels: '512x1536', ratio: [1, 3] },
  { label: '2:3', value: '2:3', pixels: '1024x1536', ratio: [2, 3] },
  { label: '3:4', value: '3:4', pixels: '768x1024', ratio: [3, 4] },
  { label: '4:5', value: '4:5', pixels: '816x1024', ratio: [4, 5] },
  { label: '9:16', value: '9:16', pixels: '1024x1792', ratio: [9, 16] },
  { label: '9:21', value: '9:21', pixels: '768x1792', ratio: [9, 21] }
] as const

const PRESET_BY_VALUE: Record<string, ImageSizePreset> = Object.fromEntries(
  IMAGE_SIZE_PRESETS.map((p) => [p.value, p])
)
const PRESET_VALUE_SET: ReadonlySet<string> = new Set(IMAGE_SIZE_PRESETS.map((p) => p.value))

/** 像素边界：防止畸形输入把上游 API 搞崩 */
export const PIXEL_MIN = 64
export const PIXEL_MAX = 4096
/** 比例分子/分母上限：避免 "1000:1" 这种不合理输入 */
export const RATIO_MAX = 64
/** 像素 snap 基数：上游 gpt-image-2 实测按 16 对齐，使用更小的 step 会被服务端二次降级 */
export const PIXEL_SNAP = 16
export const CUSTOM_ASPECT_RATIO_MIN = 1 / 3
export const CUSTOM_ASPECT_RATIO_MAX = 3
export const FOUR_K_TIER_ID = '4k'
export const EXTREME_RESOLUTION_RATIO_MIN = 9 / 21
export const EXTREME_RESOLUTION_RATIO_MAX = 21 / 9

/**
 * 上游模型的"通用能力档位"边界。
 *  - 短边 < 512 时多数商用生图模型拒绝或超时（观测：224x1792 → Upstream request failed）
 *  - 长边 > 2048 时显存/计算超限同样会失败
 *  - 比例超出 LONG_EDGE_MAX / SHORT_EDGE_MIN = 4（即 1:4 或 4:1）时无法同时满足上面两点，会被压缩到极限档位
 */
export const SHORT_EDGE_MIN = 512
export const LONG_EDGE_MAX = 2048

/** 分辨率档位定义（1K/2K/4K 等） */
export interface ImageResolutionTier {
  id: string
  label: string
  /** 该档位的长边像素上限 */
  longSide: number
  /** 按钮标签后的小字提示，如"较慢" */
  note?: string
}

/** 画质档位定义（auto/low/medium/high 等） */
export interface ImageQualityOption {
  /** 透传给上游 API 的原值，如 'auto' / 'low' / 'medium' / 'high' / 'standard' / 'hd' */
  id: string
  /** UI 显示文本 */
  label: string
  /** 按钮标签后的小字提示 */
  note?: string
}

/**
 * 模型支持的工作模式。
 * - 'both'（默认）：支持纯文生图 + 带参考图编辑（gpt-image-* / 多数通用模型）
 * - 'edit_only'：必须带参考图或 mask，UI 应前置校验拦截无参考图请求（如 flux-kontext / gemini-3-pro-image）
 * - 'text2img'：仅支持纯文生图，携带参考图会被服务端拒绝（如部分纯文生图模型）
 */
export type ImageModelMode = 'text2img' | 'edit_only' | 'both'

/** 某个生图模型的尺寸能力域 */
export interface ModelImageCapability {
  /** 可选档位列表（顺序与 UI 一致） */
  tiers: ImageResolutionTier[]
  /** 长短边比上限，默认 4（1:4 或 4:1） */
  maxRatio?: number
  /** 总像素上限（防止上游"尺寸超限静默降级"），undefined = 不限制 */
  maxTotalPixels?: number
  /**
   * 上游 API 接受的 quality 档位。undefined / 空数组 = 上游不区分画质，UI 不显示该控件。
   * 注意：参考图（/images/edits）场景下 UI 应隐藏画质控件并强制发送 'auto'。
   */
  qualities?: ImageQualityOption[]
  /**
   * 模型工作模式（默认 'both'）。用于在 generateImages 入口前置校验请求与模型能力匹配，
   * 给用户友好提示（避免上游返回生涩英文报错）。
   */
  mode?: ImageModelMode
}

/** 默认选中档位 id，首次进入生图 / 模型切换后的回退值 */
export const DEFAULT_TIER_ID = '2k'
/** 默认画质 id，所有未注册 qualities 或模型切换后的回退值 */
export const DEFAULT_QUALITY_ID = 'auto'

/**
 * 默认能力：未注册模型支持 1K / 2K / 4K（覆盖电商作图等需要高清出图的场景）。
 * 加 maxTotalPixels 上限，避免 4K 方形（约 14.7M 像素）这类请求被上游静默降级。
 * 不注册画质，UI 默认不显示。
 */
const DEFAULT_CAPABILITY: ModelImageCapability = {
  tiers: [
    { id: '1k', label: '1K', longSide: 1024 },
    { id: '2k', label: '2K', longSide: 2048 },
    { id: '4k', label: '4K', longSide: 3840, note: '较慢' }
  ],
  maxRatio: CUSTOM_ASPECT_RATIO_MAX,
  maxTotalPixels: 8_294_400
}

/** gpt-image 系列的标准画质档位（官方 API 支持 auto/low/medium/high） */
const GPT_IMAGE_QUALITIES: ImageQualityOption[] = [
  { id: 'auto', label: '自动' },
  { id: 'low', label: '低' },
  { id: 'medium', label: '中' },
  { id: 'high', label: '高', note: '较慢' }
]

/**
 * 已知模型的能力注册表。新增模型只需在此加一行。
 * 后续可迁移到管理后台 cloud_models.image_capability 字段。
 */
const CAPABILITIES: Record<string, ModelImageCapability> = {
  // 云端网关的 gpt-image-2：实测上限 = 3840×2160 = 8_294_400 像素，超出会被静默降级
  'gpt-image-2': {
    tiers: [
      { id: '2k', label: '2K', longSide: 2048 },
      { id: '4k', label: '4K', longSide: 3840, note: '较慢' }
    ],
    maxRatio: CUSTOM_ASPECT_RATIO_MAX,
    maxTotalPixels: 8_294_400,
    qualities: GPT_IMAGE_QUALITIES
  },
  'gpt-image-2-2026-04-21': {
    tiers: [
      { id: '2k', label: '2K', longSide: 2048 },
      { id: '4k', label: '4K', longSide: 3840, note: '较慢' }
    ],
    maxRatio: CUSTOM_ASPECT_RATIO_MAX,
    maxTotalPixels: 8_294_400,
    qualities: GPT_IMAGE_QUALITIES
  },
  'gpt-image-1.5': {
    tiers: [
      { id: '1k', label: '1K', longSide: 1024 }
    ],
    maxRatio: CUSTOM_ASPECT_RATIO_MAX,
    qualities: GPT_IMAGE_QUALITIES
  },
  'gpt-image-1': {
    tiers: [
      { id: '1k', label: '1K', longSide: 1024 }
    ],
    maxRatio: CUSTOM_ASPECT_RATIO_MAX,
    qualities: GPT_IMAGE_QUALITIES
  },
  'gpt-image-1-mini': {
    tiers: [
      { id: '1k', label: '1K', longSide: 1024 }
    ],
    maxRatio: CUSTOM_ASPECT_RATIO_MAX,
    qualities: GPT_IMAGE_QUALITIES
  },
  'chatgpt-image-latest': {
    tiers: [
      { id: '1k', label: '1K', longSide: 1024 }
    ],
    maxRatio: CUSTOM_ASPECT_RATIO_MAX,
    qualities: GPT_IMAGE_QUALITIES
  }
}

const GPT_STANDARD_IMAGE_MODEL_IDS = new Set([
  'gpt-image-1.5',
  'gpt-image-1',
  'gpt-image-1-mini',
  'chatgpt-image-latest'
])

function getBaseModelId(modelId?: string): string {
  return (modelId || '').split('#@')[0].trim().toLowerCase()
}

function isGptStandardImageModel(modelId?: string): boolean {
  return GPT_STANDARD_IMAGE_MODEL_IDS.has(getBaseModelId(modelId))
}

function resolveGptStandardSize(w: number, h: number): { pixels: string; w: number; h: number } {
  const ratio = w / h
  if (ratio >= 1.225) return { pixels: '1536x1024', w: 1536, h: 1024 }
  if (ratio <= 0.816) return { pixels: '1024x1536', w: 1024, h: 1536 }
  return { pixels: '1024x1024', w: 1024, h: 1024 }
}

/** 查某个模型的能力域。未注册返回 DEFAULT_CAPABILITY。 */
export function getModelCapability(modelId?: string): ModelImageCapability {
  if (!modelId) return DEFAULT_CAPABILITY
  return CAPABILITIES[getBaseModelId(modelId)] ?? DEFAULT_CAPABILITY
}

/**
 * 查某个模型的工作模式。未声明 mode 时返回 'both'（默认支持文生图 + 参考图）。
 * 用于 generateImages 入口的前置校验。
 */
export function getModelMode(modelId?: string): ImageModelMode {
  return getModelCapability(modelId).mode ?? 'both'
}

/** 保证 tierId 合法，否则回退到 DEFAULT_TIER_ID 或首档。用于模型切换后的自动降级。 */
export function ensureValidTierId(modelId: string | undefined, tierId: string | undefined): string {
  const cap = getModelCapability(modelId)
  if (tierId && cap.tiers.find((t) => t.id === tierId)) return tierId
  if (cap.tiers.find((t) => t.id === DEFAULT_TIER_ID)) return DEFAULT_TIER_ID
  return cap.tiers[0]?.id ?? DEFAULT_TIER_ID
}

export function getSizeAspectRatio(size?: string): number | null {
  if (!size) return null
  const preset = PRESET_BY_VALUE[size] ?? PRESET_BY_VALUE[normalizeSizeInput(size)]
  if (preset) return preset.ratio[0] / preset.ratio[1]
  const px = parsePixels(size)
  if (px) return px.w / px.h
  const ratio = parseRatio(size)
  if (ratio) return ratio.w / ratio.h
  return null
}

export function isExtremeResolutionAspectRatio(size?: string): boolean {
  const ratio = getSizeAspectRatio(size)
  return ratio !== null && (ratio < EXTREME_RESOLUTION_RATIO_MIN || ratio > EXTREME_RESOLUTION_RATIO_MAX)
}

export function getAvailableResolutionTiers(modelId?: string, size?: string): ImageResolutionTier[] {
  const tiers = getModelCapability(modelId).tiers
  if (!isExtremeResolutionAspectRatio(size)) return tiers
  const fourK = tiers.find((t) => t.id === FOUR_K_TIER_ID)
  return fourK ? [fourK] : tiers
}

export function ensureValidTierIdForSize(
  modelId: string | undefined,
  tierId: string | undefined,
  size?: string
): string {
  const tiers = getAvailableResolutionTiers(modelId, size)
  if (tierId && tiers.find((t) => t.id === tierId)) return tierId
  if (tiers.find((t) => t.id === DEFAULT_TIER_ID)) return DEFAULT_TIER_ID
  return tiers[0]?.id ?? DEFAULT_TIER_ID
}

/**
 * 保证 qualityId 在指定模型能力域内合法。
 * - 模型未注册 qualities → 始终返回 DEFAULT_QUALITY_ID（'auto'）
 * - qualityId 不在列表内 → 优先回退到 DEFAULT_QUALITY_ID，再回退到首档
 */
export function ensureValidQuality(modelId: string | undefined, qualityId: string | undefined): string {
  const cap = getModelCapability(modelId)
  const list = cap.qualities
  if (!list || list.length === 0) return DEFAULT_QUALITY_ID
  if (qualityId && list.find((q) => q.id === qualityId)) return qualityId
  if (list.find((q) => q.id === DEFAULT_QUALITY_ID)) return DEFAULT_QUALITY_ID
  return list[0]?.id ?? DEFAULT_QUALITY_ID
}

/** 模型是否有可选画质档位，UI 据此决定是否渲染画质控件。 */
export function hasQualityOptions(modelId?: string): boolean {
  const cap = getModelCapability(modelId)
  return !!cap.qualities && cap.qualities.length > 0
}

/** 取指定模型+档位的长边像素值。 */
export function getTierLongSide(modelId: string | undefined, tierId: string | undefined): number {
  const cap = getModelCapability(modelId)
  const id = ensureValidTierId(modelId, tierId)
  const tier = cap.tiers.find((t) => t.id === id)
  return tier ? tier.longSide : LONG_EDGE_MAX
}

/** 是否命中预设表 */
export function isPresetValue(v: string): boolean {
  return PRESET_VALUE_SET.has(v)
}

/** 把用户输入归一化：去空白，× → x，小写 */
export function normalizeSizeInput(v: string): string {
  if (!v) return ''
  return v.trim().replace(/\s+/g, '').replace(/[×X]/g, 'x').toLowerCase()
}

/**
 * 解析比例字符串 "A:B"。返回 { w, h }，非法返回 null。
 * 约束：A、B 均为 1~RATIO_MAX 的正整数。
 */
export function parseRatio(v: string): { w: number; h: number } | null {
  if (!v) return null
  const s = normalizeSizeInput(v)
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(s)
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null
  if (w < 1 || h < 1 || w > RATIO_MAX || h > RATIO_MAX) return null
  return { w, h }
}

/**
 * 解析像素字符串 "WxH"（支持 × / X）。非法返回 null。
 * 约束：PIXEL_MIN ~ PIXEL_MAX。不强制 snap，由 resolveSizeToPixels 去 snap。
 */
export function parsePixels(v: string): { w: number; h: number } | null {
  if (!v) return null
  const s = normalizeSizeInput(v)
  const m = /^(\d{2,4})x(\d{2,4})$/.exec(s)
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null
  if (w < PIXEL_MIN || h < PIXEL_MIN || w > PIXEL_MAX || h > PIXEL_MAX) return null
  return { w, h }
}

export function isWithinCustomAspectRatioRange(w: number, h: number): boolean {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false
  const ratio = w / h
  return ratio >= CUSTOM_ASPECT_RATIO_MIN && ratio <= CUSTOM_ASPECT_RATIO_MAX
}

/**
 * snap 到 step 倍数（向下），并 clamp 到 [min, max]。
 * 向下取整可保证 snap 后的值不会超过 clamp 已经满足的总像素上限。
 */
function snap(n: number, step: number, min: number, max: number): number {
  const v = Math.floor(n / step) * step
  return Math.max(min, Math.min(max, v))
}

export interface ResolveOptions {
  /** 自定义比例换算时的长边。与 modelId+tierId 冲突时后者优先。默认回退 1792。 */
  longSide?: number
  /** snap 基数，默认 PIXEL_SNAP */
  snap?: number
  /** 模型 id，用于查 capability（决定长边上限、总像素上限、比例上限） */
  modelId?: string
  /** 选中档位 id（1k/2k/4k），决定 longSide */
  tierId?: string
}

/** clampToCapableRange 的可选边界配置 */
export interface ClampOptions {
  /** 长边上限，默认 LONG_EDGE_MAX */
  longEdgeMax?: number
  /** 短边下限，默认 SHORT_EDGE_MIN */
  shortEdgeMin?: number
  /** 长短边比上限，默认 longEdgeMax / shortEdgeMin */
  maxRatio?: number
  /** 总像素上限，undefined = 不限制 */
  maxTotalPixels?: number
}

/**
 * 在保持原始比例的前提下，把 (w, h) 夹持到能力域边界：
 *   短边 >= shortEdgeMin && 长边 <= longEdgeMax && 总像素 <= maxTotalPixels
 * 若原始比例超出 maxRatio 则压缩到比例边界（如 1:4）。
 * 返回的 clamped 标志表示是否发生了调整（供 UI 层回显 "实际出图" 提示用）。
 */
export function clampToCapableRange(
  w: number,
  h: number,
  options?: ClampOptions
): { w: number; h: number; clamped: boolean } {
  const longMax = options?.longEdgeMax ?? LONG_EDGE_MAX
  const shortMin = options?.shortEdgeMin ?? SHORT_EDGE_MIN
  const ratioCap = options?.maxRatio ?? CUSTOM_ASPECT_RATIO_MAX
  const totalMax = options?.maxTotalPixels

  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { w: shortMin, h: shortMin, clamped: true }
  }
  const isWide = w >= h
  const short = isWide ? h : w
  const long = isWide ? w : h
  const ratio = long / short

  let newShort: number
  let newLong: number

  if (ratio > ratioCap) {
    // 比例过于极端：压缩到比例边界
    newShort = shortMin
    newLong = Math.min(longMax, shortMin * ratioCap)
  } else {
    // 保持比例，先保证短边下限
    newShort = Math.max(short, shortMin)
    newLong = newShort * ratio
    // 再保证长边上限（触发时会回头微调短边）
    if (newLong > longMax) {
      newLong = longMax
      newShort = newLong / ratio
    }
  }

  // 总像素上限（防止 4K 1:1 这种上游静默降级）
  if (totalMax && newLong * newShort > totalMax) {
    const scale = Math.sqrt(totalMax / (newLong * newShort))
    newLong *= scale
    newShort *= scale
  }

  const outW = isWide ? newLong : newShort
  const outH = isWide ? newShort : newLong
  const clamped = Math.round(outW) !== Math.round(w) || Math.round(outH) !== Math.round(h)
  return { w: Math.round(outW), h: Math.round(outH), clamped }
}

/** 详细解析结果：除像素串外，给 UI 层提供 "是否来自预设 / 是否被 clamp / 原始值" 元数据。 */
export interface SizeResolution {
  pixels: string
  w: number
  h: number
  /** 是否命中预设（预设不经过 clamp） */
  fromPreset: boolean
  /** 最终像素相对"未受能力域限制的原始换算"是否被调整 */
  clamped: boolean
}

/**
 * 把任意合法 size 规范化为像素串 "WxH"。非法返回 null。
 *
 * 解析顺序：
 *  1. 命中预设 → 预设 pixels（不 clamp）
 *  2. 像素格式 → clamp 到能力域后 snap
 *  3. 比例格式 → 按 longSide 换算 → clamp → snap
 *  4. 都不是 → null
 */
export function resolveSizeToPixelsDetailed(size: string, opts?: ResolveOptions): SizeResolution | null {
  if (!size) return null
  const s = normalizeSizeInput(size)

  if (isGptStandardImageModel(opts?.modelId)) {
    const preset = PRESET_BY_VALUE[size] ?? PRESET_BY_VALUE[s]
    if (preset) {
      const [rw, rh] = preset.ratio
      const mapped = resolveGptStandardSize(rw, rh)
      return { ...mapped, fromPreset: true, clamped: mapped.pixels !== preset.pixels }
    }
    const px = parsePixels(s)
    if (px) {
      if (!isWithinCustomAspectRatioRange(px.w, px.h)) return null
      const mapped = resolveGptStandardSize(px.w, px.h)
      return { ...mapped, fromPreset: false, clamped: mapped.pixels !== `${px.w}x${px.h}` }
    }
    const ratio = parseRatio(s)
    if (ratio) {
      if (!isWithinCustomAspectRatioRange(ratio.w, ratio.h)) return null
      const mapped = resolveGptStandardSize(ratio.w, ratio.h)
      return { ...mapped, fromPreset: false, clamped: true }
    }
    return null
  }

  const snapStep = opts?.snap ?? PIXEL_SNAP

  // 档位 + 能力域：优先级 modelId+tierId > longSide > 默认 1792
  const hasCapability = opts?.modelId != null
  const cap = hasCapability ? getModelCapability(opts!.modelId) : null
  const effectiveTierId = hasCapability ? ensureValidTierIdForSize(opts!.modelId, opts?.tierId, size) : opts?.tierId
  const tierLongSide = hasCapability ? getTierLongSide(opts!.modelId, effectiveTierId) : null
  const longSide = tierLongSide ?? opts?.longSide ?? 1792
  const clampOpts: ClampOptions | undefined = cap
    ? {
        longEdgeMax: tierLongSide!,
        shortEdgeMin: SHORT_EDGE_MIN,
        maxRatio: cap.maxRatio,
        maxTotalPixels: cap.maxTotalPixels
      }
    : undefined

  // 1. 预设
  const preset = PRESET_BY_VALUE[size] ?? PRESET_BY_VALUE[s]
  if (preset) {
    // 传了 modelId+tierId 时按档位重算；否则返回预设固定像素
    if (cap) {
      const [rw, rh] = preset.ratio
      const maxR = Math.max(rw, rh)
      const minR = Math.min(rw, rh)
      const shortRaw = (longSide * minR) / maxR
      const rawW = rw >= rh ? longSide : shortRaw
      const rawH = rw >= rh ? shortRaw : longSide
      const c = clampToCapableRange(rawW, rawH, clampOpts)
      const w = snap(c.w, snapStep, PIXEL_MIN, PIXEL_MAX)
      const h = snap(c.h, snapStep, PIXEL_MIN, PIXEL_MAX)
      return { pixels: `${w}x${h}`, w, h, fromPreset: true, clamped: c.clamped }
    }
    const [pw, ph] = preset.pixels.split('x').map(Number)
    return { pixels: preset.pixels, w: pw, h: ph, fromPreset: true, clamped: false }
  }

  // 2. 像素格式
  const px = parsePixels(s)
  if (px) {
    if (!isWithinCustomAspectRatioRange(px.w, px.h)) return null
    const c = clampToCapableRange(px.w, px.h, clampOpts)
    const w = snap(c.w, snapStep, PIXEL_MIN, PIXEL_MAX)
    const h = snap(c.h, snapStep, PIXEL_MIN, PIXEL_MAX)
    const clamped = c.clamped || w !== px.w || h !== px.h
    return { pixels: `${w}x${h}`, w, h, fromPreset: false, clamped }
  }

  // 3. 比例格式
  const r = parseRatio(s)
  if (r) {
    if (!isWithinCustomAspectRatioRange(r.w, r.h)) return null
    const long = Math.min(longSide, PIXEL_MAX)
    const maxR = Math.max(r.w, r.h)
    const minR = Math.min(r.w, r.h)
    const shortRaw = (long * minR) / maxR
    const rawW = r.w >= r.h ? long : shortRaw
    const rawH = r.w >= r.h ? shortRaw : long
    const c = clampToCapableRange(rawW, rawH, clampOpts)
    const w = snap(c.w, snapStep, PIXEL_MIN, PIXEL_MAX)
    const h = snap(c.h, snapStep, PIXEL_MIN, PIXEL_MAX)
    if (w < PIXEL_MIN || h < PIXEL_MIN) return null
    return { pixels: `${w}x${h}`, w, h, fromPreset: false, clamped: c.clamped }
  }

  return null
}

/** 向后兼容的简洁接口：仅返回像素串。 */
export function resolveSizeToPixels(size: string, opts?: ResolveOptions): string | null {
  const r = resolveSizeToPixelsDetailed(size, opts)
  return r ? r.pixels : null
}

/**
 * UI 回显用：给定模型 / size / 分辨率档位，返回「实际出图像素」与是否被能力域自动调整（clamped）。
 * clamped=true 常见于接近方形比例选 4K 时被单张总像素上限收窄（如 1:1 4K→2880×2880），
 * 用于向用户回显实际出图尺寸，消除「选了 4K 却没生效」的误解。size 不可解析时返回 null。
 */
export function getResolvedPixelsForSizeTier(
  modelId: string | undefined,
  size: string,
  tierId?: string
): { pixels: string; clamped: boolean } | null {
  const r = resolveSizeToPixelsDetailed(size, { modelId, tierId })
  if (!r) return null
  return { pixels: r.pixels, clamped: !!r.clamped }
}

/**
 * UI 层校验：size 是否可被 resolveSizeToPixels 解析。
 * 包含预设、自定义比例、自定义像素三类合法值。
 */
export function isValidSizeValue(v: string): boolean {
  if (!v) return false
  if (isPresetValue(v)) return true
  const px = parsePixels(v)
  if (px) return isWithinCustomAspectRatioRange(px.w, px.h)
  const ratio = parseRatio(v)
  if (ratio) return isWithinCustomAspectRatioRange(ratio.w, ratio.h)
  return false
}

/**
 * 把存储值格式化为适合 UI 展示的短文本。
 *  - 预设：直接返回 label（通常等于 value）
 *  - 像素：返回 "WxH"（归一后形式）
 *  - 比例：返回 "A:B"
 *  - 非法：原样返回
 */
export function formatSizeForDisplay(v: string): string {
  if (!v) return ''
  const preset = PRESET_BY_VALUE[v]
  if (preset) return preset.label
  const s = normalizeSizeInput(v)
  const px = parsePixels(s)
  if (px) return `${px.w}x${px.h}`
  const r = parseRatio(s)
  if (r) return `${r.w}:${r.h}`
  return v
}

