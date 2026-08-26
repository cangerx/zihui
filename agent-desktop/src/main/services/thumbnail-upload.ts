import { nativeImage } from 'electron'

/**
 * 生成用于「上传到云端」的缩略图（JPEG）。
 *
 * 用于灵感广场 / 创意模板 / 智能体市场三处投稿：上传端在发原图的同时附带一张缩略图，
 * 云控端原样存为独立文件（对存储后端零特性要求）。失败返回 null，调用方据此跳过缩略图字段，
 * 云端与桌面端均会优雅回退到原图，不阻断主流程。
 *
 * 等比缩放到长边 <= maxSide（只缩不放）。封面建议 720，头像建议 512。
 */
export function makeUploadThumbnail(buf: Buffer, maxSide = 720, quality = 82): Buffer | null {
  try {
    const img = nativeImage.createFromBuffer(buf)
    if (!img || img.isEmpty()) return null
    const { width, height } = img.getSize()
    if (!width || !height) return null
    const longSide = Math.max(width, height)
    const resized = longSide > maxSide
      ? img.resize({
          width: width >= height ? maxSide : Math.round((width / height) * maxSide),
          height: height > width ? maxSide : Math.round((height / width) * maxSide),
          quality: 'good'
        })
      : img
    const jpeg = resized.toJPEG(Math.max(1, Math.min(100, quality)))
    return jpeg && jpeg.length > 0 ? jpeg : null
  } catch {
    return null
  }
}

/** 直接产出可 append 到 FormData 的缩略图 Blob；失败返回 null。 */
export function makeUploadThumbnailBlob(
  buf: Buffer,
  maxSide = 720,
  quality = 82
): { blob: Blob; filename: string } | null {
  const jpeg = makeUploadThumbnail(buf, maxSide, quality)
  if (!jpeg) return null
  return { blob: new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), filename: 'thumb.jpg' }
}
