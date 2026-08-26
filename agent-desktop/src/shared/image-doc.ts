/** 轻量图片工程：图层元数据。Fabric 对象通过 data.layerId 绑定。 */

export type ImageLayerType = 'raster' | 'text' | 'draw' | 'sticker' | 'subject'

export const IMAGE_DOC_KIND = 'haohuoban-image' as const
export const IMAGE_DOC_VERSION = 1

export interface ImageLayer {
  id: string
  name: string
  type: ImageLayerType
  visible: boolean
  locked: boolean
  /** 0–100 */
  opacity: number
  blendMode: string
}

export interface ImageDocumentMeta {
  kind: typeof IMAGE_DOC_KIND
  version: number
  originalW: number
  originalH: number
  displayScale: number
  width: number
  height: number
  layers: ImageLayer[]
}

/** 工程文件（JSON + 可选图层 PNG 资产）。PSD/SVG 只作交付导出。 */
export interface ImageDocument {
  kind: typeof IMAGE_DOC_KIND
  version: number
  snapshot: unknown
  layers: ImageLayer[]
  assets?: string[]
}

export const LAYER_ROLES = ['base', 'text', 'draw', 'sticker', 'subject'] as const

export function isDeliverableRole(role: string | undefined): boolean {
  return !!role && (LAYER_ROLES as readonly string[]).includes(role)
}

export function roleToLayerType(role: string | undefined): ImageLayerType | null {
  if (role === 'base') return 'raster'
  if (role === 'text') return 'text'
  if (role === 'draw') return 'draw'
  if (role === 'sticker') return 'sticker'
  if (role === 'subject') return 'subject'
  return null
}

export function defaultLayerName(type: ImageLayerType, index: number): string {
  const labels: Record<ImageLayerType, string> = {
    raster: '底图',
    text: '文字',
    draw: '画笔',
    sticker: '贴图',
    subject: '主体'
  }
  if (type === 'raster' || type === 'subject') return labels[type]
  return `${labels[type]} ${index}`
}

export function newLayerId(): string {
  return `layer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
