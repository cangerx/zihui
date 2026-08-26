/**
 * AI 换装：服装预设 + 颜色 + 风格 + Prompt 合成器。
 *
 * 配套 `@/components/OutfitChangeDialog.vue`：用户在弹窗里以三 tab 切换
 * 「预设 / 文字 / 参考服装图」+ 可选颜色 / 风格 + 高级折叠里的保留项开关，
 * 由 `composeOutfitChangePrompt()` 合成 prompt 跳 `/image-gen`。
 *
 * 与 `id-photo-styles.ts` 的关键差异：
 *  - 证件照固定输出比例（5:7 / 1:1 等），AI 换装走 autoSize 保留原图比例
 *  - 证件照重构整张图，AI 换装强约束「只换衣服」
 *  - 证件照「无服装要求」可走默认深色西装兜底，AI 换装服装必须有来源
 */

export type OutfitSource = 'preset' | 'text' | 'ref-image'

export type OutfitCategoryId = 'formal' | 'casual' | 'ethnic' | 'scene'

export interface OutfitCategory {
  id: OutfitCategoryId
  label: string
}

export interface OutfitPreset {
  id: string
  label: string
  category: OutfitCategoryId
}

export const OUTFIT_CATEGORIES: OutfitCategory[] = [
  { id: 'formal', label: '正装' },
  { id: 'casual', label: '休闲' },
  { id: 'ethnic', label: '民族 · 古装' },
  { id: 'scene', label: '场景' }
]

export const OUTFIT_PRESETS: OutfitPreset[] = [
  // 正装
  { id: 'suit-dark', label: '西装', category: 'formal' },
  { id: 'shirt-white', label: '衬衫', category: 'formal' },
  { id: 'biz-suit', label: '职业套装', category: 'formal' },
  { id: 'evening-gown', label: '礼服', category: 'formal' },
  { id: 'tuxedo', label: '燕尾服', category: 'formal' },
  // 休闲
  { id: 'tshirt', label: 'T 恤', category: 'casual' },
  { id: 'hoodie', label: '卫衣', category: 'casual' },
  { id: 'denim-jacket', label: '牛仔外套', category: 'casual' },
  { id: 'parka', label: '连帽夹克', category: 'casual' },
  { id: 'polo', label: 'Polo 衫', category: 'casual' },
  // 民族 · 古装
  { id: 'hanfu', label: '汉服', category: 'ethnic' },
  { id: 'tangzhuang', label: '唐装', category: 'ethnic' },
  { id: 'qipao', label: '旗袍', category: 'ethnic' },
  { id: 'kimono', label: '和服', category: 'ethnic' },
  { id: 'song-ruqun', label: '宋制襦裙', category: 'ethnic' },
  // 场景
  { id: 'wedding', label: '婚纱', category: 'scene' },
  { id: 'graduation', label: '学位服', category: 'scene' },
  { id: 'sport', label: '运动装', category: 'scene' },
  { id: 'uniform', label: '工装制服', category: 'scene' },
  { id: 'leather', label: '机车皮衣', category: 'scene' }
]

export interface OutfitColorPreset {
  label: string
  /** hex 值；用于色块预览 + 拼进 prompt 增强模型对颜色的识别 */
  value: string
}

export const OUTFIT_COLOR_PRESETS: OutfitColorPreset[] = [
  { label: '黑色', value: '#222222' },
  { label: '白色', value: '#F8F8F8' },
  { label: '灰色', value: '#888888' },
  { label: '米色', value: '#E5D5B8' },
  { label: '藏蓝', value: '#1E3A5F' },
  { label: '酒红', value: '#722F37' },
  { label: '墨绿', value: '#2E4E3F' },
  { label: '粉色', value: '#E8B4C7' }
]

export const OUTFIT_STYLE_KEYWORDS: string[] = [
  '极简',
  '复古',
  '商务',
  '街头',
  '可爱',
  'Ins 风',
  '优雅'
]

/** 保留项开关：默认全开 */
export interface OutfitPreserveOptions {
  face: boolean        // 脸 / 五官 / 身份
  hair: boolean        // 发型
  pose: boolean        // 姿势 / 身体比例
  background: boolean  // 背景 / 构图 / 光线
  accessories: boolean // 眼镜 / 帽子 / 项链等配饰
}

export const DEFAULT_PRESERVE_OPTIONS: OutfitPreserveOptions = {
  face: true,
  hair: true,
  pose: true,
  background: true,
  accessories: true
}

export interface OutfitChangePayload {
  /** 服装来源 tab */
  source: OutfitSource
  /** 服装文字描述：预设的 label / 用户自定义文本；source = 'ref-image' 时可为空 */
  outfitText: string
  /** 颜色中文名（如「藏蓝」「自定义」）；不指定颜色时留空 */
  colorLabel?: string
  /** 颜色 hex；与 colorLabel 配套出现 */
  colorHex?: string
  /** 风格关键词（如 ['商务', '极简']），可空 */
  styles: string[]
  /** 是否提供了服装参考图——决定 prompt 走「参照第二张图」还是「按描述」分支 */
  hasOutfitRefImage: boolean
  /** 保留项开关 */
  preserve: OutfitPreserveOptions
}

/**
 * 合成 AI 换装 prompt（中文）。
 *
 * 设计目标：
 *  - 强约束「只换衣服」，最大程度保留人脸 / 发型 / 姿势 / 背景 / 光线
 *  - 提供服装参考图时主指令切到「参照第二张图的款式、颜色与材质」
 *  - 颜色与风格仅在用户显式选择时附加；不强行兜底
 *  - preserve 项逐条展开——模型对显式约束响应更稳
 */
export function composeOutfitChangePrompt(p: OutfitChangePayload): string {
  // 主指令
  let main: string
  if (p.hasOutfitRefImage) {
    main = '将第一张图中人物身上的服装替换为第二张图中的服装款式、颜色与材质'
  } else {
    const colorPart = p.colorLabel ? `${p.colorLabel}的` : ''
    const stylePart = p.styles.length > 0 ? `（${p.styles.join('、')}风格）` : ''
    const outfitText = (p.outfitText || '').trim() || '得体服装'
    main = `将照片中人物身上的服装替换为${colorPart}${outfitText}${stylePart}`
  }

  // 保留项约束
  const keep: string[] = []
  if (p.preserve.face) keep.push('严格保留人物的脸部五官、肤色与身份特征')
  if (p.preserve.hair) keep.push('保留原有发型')
  if (p.preserve.pose) keep.push('保留原有姿势、身体比例与朝向')
  if (p.preserve.background) keep.push('保留原图背景、构图、光线方向与相机角度')
  if (p.preserve.accessories) keep.push('保留眼镜、帽子、项链等配饰')

  const parts = [main + '。']
  if (keep.length > 0) parts.push('要求：' + keep.join('；') + '。')
  parts.push('服装需与人物姿势贴合自然，褶皱与阴影合理，光照方向与原图一致。')
  parts.push('不要改变图片中除服装以外的任何部分。')
  return parts.join(' ')
}
