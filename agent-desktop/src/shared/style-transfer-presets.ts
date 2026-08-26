export type StyleStrength = 'subtle' | 'balanced' | 'strong'
export type ContentPreserveLevel = 'high' | 'balanced' | 'flexible'

export interface StyleStrengthOption {
  id: StyleStrength
  label: string
  prompt: string
}

export interface ContentPreserveOption {
  id: ContentPreserveLevel
  label: string
  prompt: string
}

export interface ImageTypePreset {
  id: string
  label: string
}

export interface StyleTransferPayload {
  imageType?: string
  styleStrength: StyleStrength
  contentPreserve: ContentPreserveLevel
  extraPrompt?: string
}

export const IMAGE_TYPE_PRESETS: ImageTypePreset[] = [
  { id: 'portrait', label: '人像' },
  { id: 'avatar', label: '头像' },
  { id: 'product', label: '产品图' },
  { id: 'interior', label: '室内' },
  { id: 'architecture', label: '建筑' },
  { id: 'landscape', label: '风景' },
  { id: 'poster', label: '海报' },
  { id: 'illustration', label: '插画' }
]

export const STYLE_STRENGTH_OPTIONS: StyleStrengthOption[] = [
  { id: 'subtle', label: '轻度', prompt: '轻度迁移第一张图的色彩倾向、光影氛围与质感，内容图整体变化克制' },
  { id: 'balanced', label: '均衡', prompt: '均衡迁移第一张图的色彩、光影、材质、笔触和整体氛围' },
  { id: 'strong', label: '强烈', prompt: '强烈迁移第一张图的视觉风格、材质语言、色彩体系、光影关系和艺术表现方式' }
]

export const CONTENT_PRESERVE_OPTIONS: ContentPreserveOption[] = [
  { id: 'high', label: '高', prompt: '严格保留第二张图的主体身份、构图、轮廓、姿态、空间关系和主要细节' },
  { id: 'balanced', label: '中', prompt: '保留第二张图的主体、构图和主要结构，允许局部细节为适配风格自然调整' },
  { id: 'flexible', label: '低', prompt: '保留第二张图的核心主体与大致构图，允许更多细节随风格重绘' }
]

export function composeStyleTransferPrompt(payload: StyleTransferPayload): string {
  const strength = STYLE_STRENGTH_OPTIONS.find(item => item.id === payload.styleStrength) || STYLE_STRENGTH_OPTIONS[1]
  const preserve = CONTENT_PRESERVE_OPTIONS.find(item => item.id === payload.contentPreserve) || CONTENT_PRESERVE_OPTIONS[1]
  const parts = [
    '将第一张参考图的视觉风格迁移到第二张参考图上。',
    '第一张图是风格图，参考其色彩、光影、材质、笔触、质感、氛围和整体美术语言。',
    '第二张图是内容图，以第二张图的主体、构图和空间关系作为输出基础。',
    strength.prompt + '。',
    preserve.prompt + '。'
  ]
  const imageType = (payload.imageType || '').trim()
  if (imageType) parts.push(`输出图片类型：${imageType}。`)
  const extra = (payload.extraPrompt || '').trim()
  if (extra) parts.push(`补充要求：${extra}。`)
  parts.push('不要添加无关元素，不要改变内容图中的核心主体，不要输出拼图或对比图，只输出完成风格迁移后的单张图片。')
  return parts.join(' ')
}
