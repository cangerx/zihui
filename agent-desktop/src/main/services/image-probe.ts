import { openSync, readSync, closeSync, statSync } from 'fs'

export interface ImageProbeResult {
  width: number
  height: number
  size: number
}

/**
 * 读文件头解析常见图片格式的像素宽高（jpg/png/webp/gif/bmp）。
 * 失败返回 width=0,height=0，不抛异常，不阻塞上层入库流程。
 * 纯原生实现，避免引入额外依赖。
 */
export function probeImage(filePath: string): ImageProbeResult {
  const result: ImageProbeResult = { width: 0, height: 0, size: 0 }
  let fd: number | null = null
  try {
    const stat = statSync(filePath)
    result.size = stat.size
    if (stat.size < 12) return result

    fd = openSync(filePath, 'r')
    // 读前 32KB 足够覆盖 JPEG 的 SOF marker 扫描
    const headerLen = Math.min(32 * 1024, stat.size)
    const buf = Buffer.alloc(headerLen)
    readSync(fd, buf, 0, headerLen, 0)

    // PNG: 89 50 4E 47 0D 0A 1A 0A + IHDR (offset 16: width BE, offset 20: height BE)
    if (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    ) {
      result.width = buf.readUInt32BE(16)
      result.height = buf.readUInt32BE(20)
      return result
    }

    // GIF: "GIF87a" / "GIF89a"，offset 6: width LE, offset 8: height LE
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      result.width = buf.readUInt16LE(6)
      result.height = buf.readUInt16LE(8)
      return result
    }

    // BMP: "BM"，offset 18: width LE (int32), offset 22: height LE (int32, 可能负)
    if (buf[0] === 0x42 && buf[1] === 0x4d) {
      result.width = buf.readInt32LE(18)
      result.height = Math.abs(buf.readInt32LE(22))
      return result
    }

    // WEBP: "RIFF....WEBP"
    if (
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
    ) {
      const chunk = buf.slice(12, 16).toString('ascii')
      if (chunk === 'VP8 ') {
        // Simple Lossy: offset 26 width, offset 28 height (14bit each, masked)
        result.width = buf.readUInt16LE(26) & 0x3fff
        result.height = buf.readUInt16LE(28) & 0x3fff
      } else if (chunk === 'VP8L') {
        // Lossless: 4 bytes at offset 21: bits [0..13]=w-1, [14..27]=h-1
        const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24]
        result.width = 1 + (((b1 & 0x3f) << 8) | b0)
        result.height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
      } else if (chunk === 'VP8X') {
        // Extended: offset 24 width-1 (3 bytes LE), offset 27 height-1 (3 bytes LE)
        result.width = 1 + ((buf[24] | (buf[25] << 8) | (buf[26] << 16)) & 0xffffff)
        result.height = 1 + ((buf[27] | (buf[28] << 8) | (buf[29] << 16)) & 0xffffff)
      }
      return result
    }

    // JPEG: FF D8 开头，扫描 SOF0-SOFn（不含 SOF4/8/12），取 marker 后字节
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2
      const len = buf.length
      while (i < len - 9) {
        if (buf[i] !== 0xff) {
          i++
          continue
        }
        // 跳过填充 FF
        while (i < len && buf[i] === 0xff) i++
        if (i >= len) break
        const marker = buf[i]
        i++
        // SOI/EOI 无数据
        if (marker === 0xd8 || marker === 0xd9) continue
        // SOF markers: 0xC0-0xCF except 0xC4(DHT), 0xC8(JPG), 0xCC(DAC)
        if (
          marker >= 0xc0 && marker <= 0xcf &&
          marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
        ) {
          // segment: [length(2) precision(1) height(2) width(2) ...]
          if (i + 7 >= len) break
          result.height = buf.readUInt16BE(i + 3)
          result.width = buf.readUInt16BE(i + 5)
          return result
        }
        // 其他段：读 2 字节长度后跳过
        if (i + 1 >= len) break
        const segLen = buf.readUInt16BE(i)
        i += segLen
      }
      return result
    }
  } catch {
    // 忽略所有 IO / 解析错误，返回 0 让调用方继续
  } finally {
    if (fd !== null) {
      try { closeSync(fd) } catch {}
    }
  }
  return result
}
