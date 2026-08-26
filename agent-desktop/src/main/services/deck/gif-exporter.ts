import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import type { OffscreenRenderer } from './offscreen-renderer'

// GIF 导出(零 ffmpeg): 离屏逐帧 capturePage → RGBA → gifenc 量化+调色板编码。
// 静态页 = 单帧 GIF; 动画页(走 window.__seek 时钟)逐帧采样。

export interface RgbaFrame {
  width: number
  height: number
  data: Uint8Array
}

/** RGBA 帧序列 → GIF (gifenc 两遍调色板, 对齐 huashu palettegen/paletteuse) */
export function encodeGif(frames: RgbaFrame[], opts: { delayMs?: number } = {}): Buffer {
  if (frames.length === 0) throw new Error('encodeGif: 至少需要 1 帧')
  const delay = opts.delayMs ?? 100
  const enc = GIFEncoder()
  for (const f of frames) {
    const palette = quantize(f.data, 256)
    const index = applyPalette(f.data, palette)
    enc.writeFrame(index, f.width, f.height, { palette, delay })
  }
  enc.finish()
  return Buffer.from(enc.bytes())
}

/** 用离屏渲染器把幻灯片 HTML 截图成 GIF(静态=单帧; frames>1 时逐帧采样动画) */
export async function exportSlideGif(
  html: string,
  renderer: OffscreenRenderer,
  opts: { width?: number; height?: number; frames?: number; delayMs?: number } = {}
): Promise<Buffer> {
  const count = Math.max(opts.frames ?? 1, 1)
  const captured: RgbaFrame[] = []
  for (let i = 0; i < count; i++) {
    captured.push(await renderer.renderRgba(html, opts))
  }
  return encodeGif(captured, { delayMs: opts.delayMs })
}
