/**
 * 流式画布视频关键帧抽取（纯前端，零后端依赖）。
 *
 * 关键：本地视频用 `fetch → blob → createObjectURL` 同源加载，规避 `<video>` 直接用
 * local-file:// 作 src 时 canvas.toDataURL 被判 tainted（SecurityError）。
 * 供 videoFrames（抽帧节点）与 videoReverse（视频反推）共用。
 */
export interface ExtractedFrame {
  time: number
  dataUrl: string
}

export interface FrameExtractOptions {
  mode: 'uniform' | 'count' | 'interval' | 'first_last'
  count?: number
  intervalSec?: number
  maxFrames?: number
}

function toVideoSource(videoPath: string): string {
  if (/^(https?:|blob:|data:|file:)/i.test(videoPath)) return videoPath
  const isAbsolute = /^[A-Za-z]:|^\//.test(videoPath)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://video?' + param + '=' + encodeURIComponent(videoPath)
}

function computeTimes(duration: number, opts: FrameExtractOptions): number[] {
  const d = Math.max(0, Number(duration) || 0)
  if (d <= 0) return [0]
  const eps = Math.min(0.1, d * 0.01)
  const last = Math.max(eps, d - eps)
  if (opts.mode === 'first_last') return [eps, last]
  if (opts.mode === 'interval') {
    const step = Math.max(0.2, Number(opts.intervalSec) || 2)
    const cap = Math.max(1, Number(opts.maxFrames) || 30)
    const times: number[] = []
    for (let t = eps; t < d && times.length < cap; t += step) times.push(Math.min(t, last))
    return times.length ? times : [eps]
  }
  // uniform / count：均匀 N 帧
  const n = Math.max(1, Math.min(Number(opts.maxFrames) || 20, Number(opts.count) || 4))
  if (n === 1) return [d / 2]
  const times: number[] = []
  for (let i = 0; i < n; i++) times.push(eps + (last - eps) * (i / (n - 1)))
  return times
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }
    const onSeeked = () => { cleanup(); resolve() }
    const onError = () => { cleanup(); reject(new Error('视频 seek 失败')) }
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    try {
      video.currentTime = t
    } catch (e) {
      cleanup()
      reject(e instanceof Error ? e : new Error('seek 异常'))
    }
  })
}

export function useVideoFrames() {
  async function extractFrames(videoPath: string, opts: FrameExtractOptions): Promise<ExtractedFrame[]> {
    if (!videoPath) throw new Error('缺少视频源')
    const src = toVideoSource(videoPath)

    // 优先 blob 同源（规避 tainted）；fetch 失败兜底直接用 src
    let objectUrl = src
    let createdObjectUrl = false
    try {
      const resp = await fetch(src)
      const blob = await resp.blob()
      objectUrl = URL.createObjectURL(blob)
      createdObjectUrl = true
    } catch {
      objectUrl = src
    }

    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.src = objectUrl

    try {
      await new Promise<void>((resolve, reject) => {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true })
        video.addEventListener('error', () => reject(new Error('无法加载视频（格式不支持或文件损坏）')), { once: true })
      })

      const times = computeTimes(video.duration, opts)
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 1280
      canvas.height = video.videoHeight || 720
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('无法创建画布上下文')

      const frames: ExtractedFrame[] = []
      for (const t of times) {
        await seekTo(video, t)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        frames.push({ time: t, dataUrl: canvas.toDataURL('image/png') })
      }
      return frames
    } finally {
      if (createdObjectUrl && objectUrl) {
        try { URL.revokeObjectURL(objectUrl) } catch { /* ignore */ }
      }
      video.removeAttribute('src')
      video.load()
    }
  }

  return { extractFrames }
}
