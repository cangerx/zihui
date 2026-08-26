// 电商 AI 生图：5 个功能的共享类型定义。
//
// 复刻自 koukoutu 的 5 个能力，但提示词全部内置在桌面端（不展示给用户），
// 生图统一走现有 `api.imageGen.invoke('generate', ...)` 网关，模型可在
// 桌面端自定义模型 / 云端模型之间自由选择（复用 ChatModelSwitcher）。

/** 5 个功能入口。主图 / 详情页共用 ecomgenerator，靠 imageType 区分。 */
export type EcomFeatureKey = 'batchsku' | 'ecomclone' | 'main' | 'detail' | 'poster'

/** 上传的单张图片：dataURL（base64）+ 文件名，便于结果命名与预览。 */
export interface UploadedImage {
  /** base64 dataURL，直接作为 generate 的 refImages 传入 */
  dataUrl: string
  /** 原始文件名（不含扩展名优先），用于结果命名 */
  name: string
}

/** 所有功能共享的生成参数（模型 + 尺寸）。 */
export interface EcomGenParams {
  /** provider id：云端为 'cloud:default'，本地为 provider uuid */
  modelProviderId: string
  /** model id 或复合 key `{model_id}#@{provider_name}`，原样透传给主进程 */
  modelId: string
  /** 尺寸：预设比例 / 自定义比例 / 像素串 */
  size: string
  /** 分辨率档位 1k/2k/4k */
  tierId: string
  /** 画质（仅部分模型生效） */
  quality: string
}

/** 文字内容处理模式（电商图复刻）。 */
export type TextContentMode = 'keep' | 'custom' | 'creative'
/** 文字排版模式（电商图复刻）。 */
export type TextLayoutMode = 'keep' | 'redesign'
/** 主图 / 详情页切换。 */
export type ImageType = 'main' | 'detail'
/** 海报版式：单面 / 双面。 */
export type PosterType = 'single' | 'double'

/** 批量 SKU 生成表单。 */
export interface BatchSkuForm {
  /** SKU 模板图（版式参考，图1） */
  templateImage: UploadedImage | null
  /** 产品图（图2…），每张独立生成一张 SKU */
  productImages: UploadedImage[]
  /** 内置可编辑提示词（默认取 PROMPTS.batchsku.directTemplate） */
  prompt: string
}

/** 电商图复刻表单。 */
export interface EcomCloneForm {
  referenceImages: UploadedImage[]
  productImages: UploadedImage[]
  textContentMode: TextContentMode
  customText: string
  textLayoutMode: TextLayoutMode
  language: string
  customLanguage: string
  otherRequirements: string
}

/** 主图 / 详情页生成表单（两步法）。 */
export interface EcomGeneratorForm {
  productImages: UploadedImage[]
  styleImage: UploadedImage | null
  logoImage: UploadedImage | null
  productName: string
  sellingPoints: string
  language: string
  customLanguage: string
  /** 电商平台调性，对应 PLATFORMS */
  platform: string
  /** 内置风格预设 value（对应 STYLE_PRESETS），空串=不指定 */
  stylePreset: string
  imageCount: number
  imageType: ImageType
  requirements: string
  /** 促销角标 / CTA 文案（仅主图用，如「限时立减50」；详情页忽略） */
  ctaText: string
  /** 详情页模块（仅 imageType==='detail' 生效） */
  detailModules: string[]
  aspectRatio: string
}

/** 海报生成表单（两步法，参数最多）。 */
export interface PosterForm {
  productImages: UploadedImage[]
  styleImage: UploadedImage | null
  logoImage: UploadedImage | null
  /** 是否使用产品图模式（false=纯文字描述生成） */
  hasProductImage: boolean
  productName: string
  sellingPoints: string
  language: string
  customLanguage: string
  posterType: PosterType
  /** 内置风格预设 value（对应 STYLE_PRESETS），空串=不指定 */
  stylePreset: string
  /** 海报用途，对应 POSTER_SCENARIOS */
  scenario: string
  /** 行业，对应 POSTER_INDUSTRIES */
  industry: string
  /** 用户自由描述（可由场景示例预填） */
  userDescription: string
  /** 行动号召文案，如「立即抢购」 */
  ctaText: string
  requirements: string
  imageCount: number
  aspectRatio: string
}

/** 单个生成任务的运行态（结果网格用）。 */
export interface EcomGenTask {
  id: string
  /** 来源产品图序号 / 标签，便于对应 */
  label: string
  /** 实际使用的最终提示词（内部记录，UI 不展示） */
  prompt: string
  status: 'pending' | 'optimizing' | 'loading' | 'success' | 'error'
  /** 结果图本地相对路径（来自 generate 返回的 result_path） */
  resultPath: string
  /** 可直接用于 <img> 的 url */
  url: string
  error: string
}

/** 下拉选项通用结构。 */
export interface Option {
  value: string
  label: string
  desc?: string
}
