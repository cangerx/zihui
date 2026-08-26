/**
 * 渲染端图片压缩工具：把任意 dataURI 缩放并重压成 JPEG。
 *
 * 用途：上传给视觉模型前压缩，避免单图体积过大导致云端推理时间超过 Cloudflare
 * 网关 100 秒上限触发 524；同时省流量。
 *
 * 历史：原本嵌在 Image2PromptView.vue 里。v0.6.9 流式画布的「图片反推」节点
 * 也需要同样压缩链路，因此抽到共享 utils 作为 single source of truth。
 *
 * 默认参数沿用独立反推页：长边 1280px、JPEG 质量 0.85，是兼顾画质与体积的经验值。
 */

import { stripImageMetadata } from '@shared/strip-image-metadata'

/** 长边像素：超过则等比缩放，否则保持原尺寸（不会上采样） */
export const DEFAULT_MAX_SIZE = 1280
/** JPEG 质量：0~1，0.85 在视觉模型反推场景下细节足够 */
export const DEFAULT_QUALITY = 0.85

/**
 * 压缩 dataURI 图片。
 *
 * 流程：
 *   1. `stripImageMetadata` 剥离 EXIF / ICC（避免 SD 风格输出色偏与隐私泄露）
 *   2. 解码到 Image，按 maxSize 等比缩放到 canvas
 *   3. `canvas.toDataURL('image/jpeg', quality)` 重压成 JPEG dataURI
 *
 * 注意：
 *   - 仅渲染端可用（依赖 DOM 的 Image / canvas）。主进程要压缩请用 sharp 等服务端库。
 *   - 输入若不是合法 dataURI，会触发 img.onerror reject。
 */
export function compressImage(
  dataUri: string,
  maxSize: number = DEFAULT_MAX_SIZE,
  quality: number = DEFAULT_QUALITY
): Promise<string> {
  const cleanUri = stripImageMetadata(dataUri)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    img.src = cleanUri
  })
}
