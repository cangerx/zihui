/**
 * 选图统一工具：把"路径 → base64 dataUri → 压缩"三步抽出来，
 * 给 ImageGenView / ImageEditView / 图像处理工具页等多个调用方复用，
 * 避免在多个 .vue 文件里重复实现 compressImage / readFileBase64 链路。
 *
 * 主流程：
 *   const paths = await pickFromLocal()        // 系统文件对话框
 *   const paths = await openGalleryPicker()    // 弹图库（外部组件）
 *   const items = await loadAsDataUri(paths)   // 读+压缩，得到 dataUri[]
 */

import { stripImageMetadata } from '@shared/strip-image-metadata'

export interface LoadedImage {
  /** 原始路径（绝对路径） */
  path: string
  /** 文件名（不含目录） */
  name: string
  /** 压缩后的 dataUri，可直接喂给 <img :src> 或 API */
  dataUri: string
  /** 加载后的像素宽 */
  width: number
  /** 加载后的像素高 */
  height: number
  /** 文件扩展名（小写） */
  ext: string
}

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg']

/**
 * 通过系统文件对话框选择本地图片，返回绝对路径数组。
 * 用户取消返回 []。
 */
export async function pickFromLocal(options?: { multiple?: boolean; title?: string }): Promise<string[]> {
  const result = await (window as any).api.dialog.openFile({
    title: options?.title || '选择图片',
    filters: [{ name: 'Images', extensions: IMAGE_EXTS }],
    properties: options?.multiple ? ['openFile', 'multiSelections'] : ['openFile']
  }) as { canceled: boolean; filePaths: string[] }
  if (result.canceled || !result.filePaths?.length) return []
  return result.filePaths
}

/**
 * 把图片路径列表读成 base64 dataUri 并压缩。
 * 默认压到 1024px，质量 0.8（与 ImageGenView 保持一致）。
 *
 * 注意：图库返回的路径通常是绝对路径（GalleryPicker 直接给主进程读的就是绝对路径）。
 * 主进程 chat:readFileBase64 只接受绝对路径；相对路径的图库项需要在调用前先转换。
 */
export async function loadAsDataUri(
  filePaths: string[],
  options?: { maxSize?: number; quality?: number }
): Promise<LoadedImage[]> {
  const maxSize = options?.maxSize ?? 1024
  const quality = options?.quality ?? 0.8
  const out: LoadedImage[] = []

  for (const filePath of filePaths) {
    try {
      const ext = (filePath.split('.').pop() || 'png').toLowerCase()
      const mime = ext === 'jpg' ? 'jpeg' : ext
      const raw = await (window as any).api.chat.invoke('readFileBase64', filePath) as string
      const rawDataUri = `data:image/${mime};base64,${raw}`
      const compressed = await compressImage(rawDataUri, maxSize, quality)
      const size = await getImageSize(compressed)
      const name = filePath.split(/[\\/]/).pop() || `image-${Date.now()}`
      out.push({ path: filePath, name, dataUri: compressed, width: size.w, height: size.h, ext })
    } catch (e) {
      console.error('[image-source] failed to load', filePath, e)
    }
  }
  return out
}

/**
 * 通用 canvas 压缩。
 * - 先用 stripImageMetadata 移除 EXIF/ICC/XMP，避免上游 API 因元数据过大被截断
 * - 等比缩放：长边不超过 maxSize；本就更小则保持原尺寸（不放大）
 * - PNG 输入也输出 jpeg？不——保持 PNG 透明通道，jpg 输入才走 jpeg 压缩
 */
export function compressImage(dataUri: string, maxSize: number, quality: number): Promise<string> {
  const cleanUri = stripImageMetadata(dataUri)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      if (width > maxSize || height > maxSize) {
        const r = Math.min(maxSize / width, maxSize / height)
        width = Math.round(width * r)
        height = Math.round(height * r)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      // 优先保留 PNG 的 alpha 通道；非 PNG 一律 JPEG 压缩（更小）
      const isPng = cleanUri.startsWith('data:image/png')
      const out = isPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality)
      resolve(out)
    }
    img.onerror = () => reject(new Error('Failed to load image for compression'))
    img.src = cleanUri
  })
}

/** 读取 dataUri / url 的真实像素尺寸 */
export function getImageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => reject(new Error('Failed to load image for sizing'))
    img.src = src
  })
}

/** 简单 dataUri 转 Blob（导出为文件用） */
export function dataUriToBlob(dataUri: string): Blob {
  const [header, base64] = dataUri.split(',')
  const mime = (header.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream'
  const bin = atob(base64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return new Blob([buf], { type: mime })
}

/** 浏览器下载（用 anchor），fileName 含扩展名 */
export function downloadDataUri(dataUri: string, fileName: string): void {
  const a = document.createElement('a')
  a.href = dataUri
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/** 推断输出文件名：base + suffix + ext，避免 a.png_edited.png 这种丑名字 */
export function buildOutputName(originalName: string, suffix: string, ext: string): string {
  const base = originalName.replace(/\.[^.]+$/, '') || 'image'
  return `${base}${suffix}.${ext}`
}
