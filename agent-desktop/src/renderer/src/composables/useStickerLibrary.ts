import { ref, computed } from 'vue'
import { pickFromLocal, loadAsDataUri } from '@/utils/image-source'

/**
 * 贴图工具的素材库 composable。
 *
 * MVP 提供两个素材源：
 *  - shapes  内置几何形状（SVG 包成 data URL，fabric 直接当 image 用）
 *  - upload  用户从本地选 PNG/JPG/SVG，FileReader 转 dataUri 后入栈缓存
 *
 * 后续可加：从图库选（GalleryPicker） / 我的创作（image_generations）
 *
 * 设计原则：
 *  - 全部贴纸统一用 dataUri 作为接入 fabric 的入口（addSticker(url) 一个签名）
 *  - 内置形状不依赖 emoji 字符，避免触发"AI 化设计"或字体回退问题
 *  - 上传缓存仅在组件存活期内有效（重新打开图片编辑会清空），刻意不持久化避免占用 localStorage
 */

export type StickerTab = 'shapes' | 'upload' | 'gallery'

export interface ShapePreset {
  id: string
  label: string
  /** SVG 内部 markup（不含 <svg> 外层），形状里出现的 currentColor 会被 svg 的 style.color 替换 */
  inner: string
  /** 默认填充色（语义化配色，用户可在后续版本里自定义） */
  defaultColor: string
}

export interface UploadedSticker {
  id: string
  dataUri: string
  name: string
}

/**
 * 内置 12 种基础形状。
 * 选型原则：单色实心 + 高对比，覆盖常见标注需求（指示、强调、装饰、对话）。
 * 颜色刻意走 tailwind 调色板里的中等饱和度色，避免显得"AI 花哨"。
 */
const SHAPE_PRESETS: ShapePreset[] = [
  { id: 'circle',      label: '圆形',   inner: '<circle cx="12" cy="12" r="9" fill="currentColor"/>',                                                                                                                                                          defaultColor: '#ef4444' },
  { id: 'square',      label: '方块',   inner: '<rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor"/>',                                                                                                                                        defaultColor: '#3b82f6' },
  { id: 'triangle',    label: '三角',   inner: '<path d="M12 3 21 20 3 20 Z" fill="currentColor"/>',                                                                                                                                                            defaultColor: '#f59e0b' },
  { id: 'star',        label: '五角星', inner: '<path d="M12 2l2.39 7.36H22l-6.18 4.5L18.21 21 12 16.5 5.79 21l2.39-7.14L2 9.36h7.61z" fill="currentColor"/>',                                                                                                  defaultColor: '#fbbf24' },
  { id: 'heart',       label: '心形',   inner: '<path d="M12 21s-7-4.5-9.5-9C.5 7 4 3 7.5 4 9.85 4.7 12 7 12 7s2.15-2.3 4.5-3C20 3 23.5 7 21.5 12 19 16.5 12 21 12 21z" fill="currentColor"/>',                                                                  defaultColor: '#8f5a45' },
  { id: 'bubble',      label: '气泡',   inner: '<path d="M7 4h10a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4h-5l-5 4v-4H7a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="currentColor"/>',                                                                                              defaultColor: '#23574f' },
  { id: 'bolt',        label: '闪电',   inner: '<path d="M13 2 4 13h6l-1 9 9-11h-6l1-9z" fill="currentColor"/>',                                                                                                                                                defaultColor: '#facc15' },
  { id: 'arrow-right', label: '右箭头', inner: '<path d="M4 12h14m-5-6 6 6-6 6" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',                                                                            defaultColor: '#10b981' },
  { id: 'check',       label: '对勾',   inner: '<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="m6 12 4 4 8-8" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',                                       defaultColor: '#22c55e' },
  { id: 'cross',       label: '叉号',   inner: '<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M8 8l8 8M16 8l-8 8" stroke="white" stroke-width="3" stroke-linecap="round" fill="none"/>',                                                          defaultColor: '#ef4444' },
  { id: 'question',    label: '问号',   inner: '<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-1.5 1.8-2.5 3v1M12 17h.01" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>', defaultColor: '#06b6d4' },
  { id: 'exclaim',     label: '感叹号', inner: '<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 7v6M12 16.5h.01" stroke="white" stroke-width="2.6" stroke-linecap="round" fill="none"/>',                                                       defaultColor: '#f97316' }
]

/**
 * 将形状预设包成完整 SVG 文档并 base64 编码为 data URL。
 * fabric.FabricImage.fromURL() 可直接吃这个返回值，与 PNG 上传走同一条加载路径。
 *
 * @param preset 形状预设
 * @param color  覆盖颜色（不传则用预设默认色）
 * @param size   输出 SVG 的 width/height 像素（影响 fabric 内 image 的原始尺寸）
 */
export function shapeToDataUrl(preset: ShapePreset, color?: string, size = 256): string {
  const c = color || preset.defaultColor
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" style="color:${c}">${preset.inner}</svg>`
  // btoa 仅支持 ASCII；SVG path 字符全 ASCII，安全。
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

export function useStickerLibrary() {
  const currentTab = ref<StickerTab>('shapes')
  const uploadedStickers = ref<UploadedSticker[]>([])

  const shapes = computed(() => SHAPE_PRESETS)

  /**
   * 唤起系统文件对话框选图片，转 dataUri 后加入 uploadedStickers 栈顶。
   * 返回新加入的 dataUri 列表（调用方决定要不要立即 addSticker 上画布）。
   * loadAsDataUri 会压缩到长边 1024，保留 PNG 透明通道。
   */
  async function pickUploadStickers(): Promise<string[]> {
    const paths = await pickFromLocal({ multiple: true, title: '选择贴纸图片' })
    if (!paths.length) return []
    const items = await loadAsDataUri(paths, { maxSize: 1024, quality: 0.9 })
    const newUris: string[] = []
    for (const it of items) {
      const id = 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
      uploadedStickers.value.unshift({ id, dataUri: it.dataUri, name: it.name })
      newUris.push(it.dataUri)
    }
    // 上限 30 张，多余的从尾部淘汰；避免长时间使用累积内存
    if (uploadedStickers.value.length > 30) {
      uploadedStickers.value.length = 30
    }
    return newUris
  }

  function removeUploaded(id: string) {
    uploadedStickers.value = uploadedStickers.value.filter(s => s.id !== id)
  }

  function clearUploaded() {
    uploadedStickers.value = []
  }

  return {
    currentTab,
    shapes,
    uploadedStickers,
    pickUploadStickers,
    removeUploaded,
    clearUploaded
  }
}
