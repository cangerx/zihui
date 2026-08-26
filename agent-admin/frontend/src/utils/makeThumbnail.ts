/**
 * 浏览器端把图片缩成 JPEG 缩略图 Blob，随原图一起上传到云控端（网格列表用）。
 *
 * 等比缩放到长边 <= maxSide（只缩不放），透明通道铺白底（JPEG 无 alpha）。
 * 失败返回 null，调用方据此跳过 thumb 字段，云端与客户端均会回退原图，不阻断上传。
 */
export async function makeThumbnailBlob(
  file: Blob,
  maxSide = 720,
  quality = 0.82
): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = bitmap
    if (!width || !height) {
      bitmap.close?.()
      return null
    }
    const scale = Math.min(1, maxSide / Math.max(width, height))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close?.()
      return null
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
    })
  } catch {
    return null
  }
}
