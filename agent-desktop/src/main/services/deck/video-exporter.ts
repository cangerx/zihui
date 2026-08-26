import { join } from 'path'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import type { OffscreenRenderer } from './offscreen-renderer'
import { spawnFfmpeg } from './ffmpeg-manager'

// MP4 导出: 离屏逐帧 capturePage(动画走 window.__seek 时钟) → PNG 序列 → ffmpeg libx264。
// 依赖 ffmpeg 二进制(经 ffmpeg-manager 检测/按需下载得到 ffmpegPath)。

export interface Mp4Options {
  fps?: number
  seconds?: number
  width?: number
  height?: number
  signal?: AbortSignal
  crf?: number
}

export async function exportSlideMp4(
  html: string,
  renderer: OffscreenRenderer,
  ffmpegPath: string,
  opts: Mp4Options = {}
): Promise<Buffer> {
  const fps = opts.fps ?? 30
  const totalFrames = Math.max(Math.round((opts.seconds ?? 3) * fps), 1)
  const times = Array.from({ length: totalFrames }, (_, i) => i / fps)

  const frames = await renderer.renderFrames(html, times, {
    width: opts.width,
    height: opts.height
  })

  const dir = mkdtempSync(join(tmpdir(), 'deck-mp4-'))
  try {
    frames.forEach((png, i) => {
      writeFileSync(join(dir, `f_${String(i).padStart(5, '0')}.png`), png)
    })
    await spawnFfmpeg(
      ffmpegPath,
      [
        '-y',
        '-framerate',
        String(fps),
        '-i',
        'f_%05d.png',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-crf',
        String(opts.crf ?? 18),
        '-preset',
        'medium',
        '-movflags',
        '+faststart',
        'out.mp4'
      ],
      { cwd: dir, signal: opts.signal }
    )
    return readFileSync(join(dir, 'out.mp4'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 整套 deck → 一个 MP4: 每页定格 secondsPerSlide 秒, 连续帧序列一次性 ffmpeg 编码。 */
export async function exportDeckMp4(
  slidesHtml: string[],
  renderer: OffscreenRenderer,
  ffmpegPath: string,
  opts: { fps?: number; secondsPerSlide?: number; width?: number; height?: number; signal?: AbortSignal; crf?: number } = {}
): Promise<Buffer> {
  const fps = opts.fps ?? 30
  const perSlide = Math.max(Math.round((opts.secondsPerSlide ?? 2.5) * fps), 1)
  const times = Array.from({ length: perSlide }, (_, i) => i / fps)

  const dir = mkdtempSync(join(tmpdir(), 'deck-mp4-'))
  try {
    let idx = 0
    for (const html of slidesHtml) {
      const frames = await renderer.renderFrames(html, times, {
        width: opts.width,
        height: opts.height
      })
      for (const png of frames) {
        writeFileSync(join(dir, `f_${String(idx).padStart(6, '0')}.png`), png)
        idx++
      }
    }
    await spawnFfmpeg(
      ffmpegPath,
      [
        '-y',
        '-framerate',
        String(fps),
        '-i',
        'f_%06d.png',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-crf',
        String(opts.crf ?? 20),
        '-preset',
        'medium',
        '-movflags',
        '+faststart',
        'out.mp4'
      ],
      { cwd: dir, signal: opts.signal }
    )
    return readFileSync(join(dir, 'out.mp4'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
