import { BrowserWindow, dialog } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, isAbsolute, join, basename } from 'path'
import { getDataDir } from './data-path'
import { spawn, spawnSync } from 'child_process'
import { detect, spawnFfmpeg } from './deck/ffmpeg-manager'
import { cloudSynth } from './deck/deck-cloud'
import { muxNarrationIntoMp4 } from './deck/narrate-pipeline'
import { getModelProvider } from './model-provider'
import { normalizeApiBase } from './api-base-normalize'
import { getAllowCustomProvider, getCloudToken } from './cloud-token'
import type { TranscriptSegment } from '@shared/clone-doc'

export interface VideoProbe {
  duration: number
  width: number
  height: number
}

export interface ExtractedFrame {
  time: number
  dataUrl: string
}

function parentWindow(event: Electron.IpcMainInvokeEvent) {
  return BrowserWindow.fromWebContents(event.sender)
}

function runBin(bin: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d) => {
      stderr += d.toString()
      if (stderr.length > 80000) stderr = stderr.slice(-40000)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }))
  })
}

function requireFfmpeg() {
  const st = detect()
  if (!st.ready || !st.ffmpeg || !st.ffprobe) {
    throw new Error(st.reason || 'ffmpeg/ffprobe 未安装。可在 AI PPT 导出里安装，或安装系统 ffmpeg。')
  }
  return st
}

export function ffmpegStatus(): { ready: boolean; reason: string } {
  const st = detect()
  return { ready: Boolean(st.ready), reason: st.reason || '' }
}

export async function probeVideo(videoPath: string): Promise<VideoProbe> {
  if (!videoPath || !existsSync(videoPath)) throw new Error('找不到视频文件')
  const st = requireFfmpeg()
  const result = await runBin(st.ffprobe as string, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    videoPath
  ])
  if (result.code !== 0) throw new Error(`读取视频信息失败：${result.stderr.slice(-300)}`)
  let parsed: any = {}
  try {
    parsed = JSON.parse(result.stdout || '{}')
  } catch {
    throw new Error('ffprobe 返回无法解析')
  }
  const duration = Number(parsed.format?.duration || 0)
  const videoStream = Array.isArray(parsed.streams)
    ? parsed.streams.find((s: any) => s.codec_type === 'video')
    : null
  const width = Number(videoStream?.width || 0)
  const height = Number(videoStream?.height || 0)
  if (!(duration > 0)) throw new Error('无法读取视频时长')
  return { duration, width, height }
}

export function frameTimes(duration: number, maxFrames = 16): number[] {
  const d = Math.max(0.2, Number(duration) || 0)
  const cap = Math.max(2, Math.min(maxFrames, 16))
  const n = d <= cap ? Math.max(2, Math.min(cap, Math.floor(d) || 2)) : cap
  const eps = Math.min(0.12, d * 0.01)
  const last = Math.max(eps, d - eps)
  if (n === 1) return [d / 2]
  const times: number[] = []
  for (let i = 0; i < n; i++) times.push(eps + (last - eps) * (i / (n - 1)))
  return times
}

export async function extractKeyframes(videoPath: string, maxFrames = 16): Promise<{
  probe: VideoProbe
  frames: ExtractedFrame[]
}> {
  const probe = await probeVideo(videoPath)
  const st = requireFfmpeg()
  const times = frameTimes(probe.duration, maxFrames)
  const workDir = join(tmpdir(), `haohuoban-clone-${Date.now()}`)
  mkdirSync(workDir, { recursive: true })
  const frames: ExtractedFrame[] = []
  try {
    for (let i = 0; i < times.length; i++) {
      const t = times[i]
      const out = join(workDir, `frame-${String(i).padStart(3, '0')}.jpg`)
      await spawnFfmpeg(st.ffmpeg as string, [
        '-ss', t.toFixed(3),
        '-i', videoPath,
        '-frames:v', '1',
        '-vf', 'scale=720:-2',
        '-q:v', '5',
        '-y',
        out
      ])
      if (!existsSync(out)) continue
      const buf = readFileSync(out)
      frames.push({ time: t, dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}` })
    }
  } finally {
    try { rmSync(workDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  if (!frames.length) throw new Error('未能从视频抽出关键帧')
  return { probe, frames }
}

export async function extractAudio(videoPath: string): Promise<{ wavPath: string }> {
  if (!videoPath || !existsSync(videoPath)) throw new Error('找不到视频文件')
  const st = requireFfmpeg()
  const workDir = join(tmpdir(), `haohuoban-clone-audio-${Date.now()}`)
  mkdirSync(workDir, { recursive: true })
  const wavPath = join(workDir, 'audio.wav')
  await spawnFfmpeg(st.ffmpeg as string, [
    '-i', videoPath,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-t', '600',
    '-y',
    wavPath
  ])
  if (!existsSync(wavPath)) throw new Error('未能抽出音频')
  return { wavPath }
}

function parseTranscript(data: any, fallbackText: string): { text: string; segments: TranscriptSegment[] } {
  const text = String(data?.text || fallbackText || '').trim()
  const rawSegs = Array.isArray(data?.segments) ? data.segments : []
  const segments: TranscriptSegment[] = rawSegs.map((seg: any) => ({
    start: Number(seg.start || 0),
    end: Number(seg.end || seg.start || 0),
    text: String(seg.text || '').trim()
  })).filter((seg: TranscriptSegment) => seg.text)
  return { text, segments }
}

export async function transcribeAudio(
  wavPath: string,
  providerId: string,
  modelId: string
): Promise<{ text: string; segments: TranscriptSegment[] }> {
  if (!wavPath || !existsSync(wavPath)) throw new Error('找不到音频文件')
  if (!providerId || !modelId) throw new Error('请选择语音识别模型')
  if (providerId.startsWith('cloud:')) {
    throw new Error('云端 ASR 尚未接通，请改用本地自定义服务商里的 Whisper / 语音识别模型，或拆完后手改口播。')
  }
  if (!getCloudToken()) throw new Error('请先登录云控端')
  if (!getAllowCustomProvider()) throw new Error('当前账号不允许自定义服务商')
  const provider = getModelProvider(providerId)
  if (!provider) throw new Error('找不到所选服务商')
  const url = `${normalizeApiBase(provider.api_base)}/audio/transcriptions`
  const buf = readFileSync(wavPath)
  const form = new FormData()
  form.append('file', new Blob([Uint8Array.from(buf)], { type: 'audio/wav' }), 'audio.wav')
  form.append('model', modelId)
  form.append('response_format', 'verbose_json')
  form.append('language', 'zh')
  const res = await fetch(url, {
    method: 'POST',
    headers: provider.api_key ? { Authorization: `Bearer ${provider.api_key}` } : undefined,
    body: form
  })
  const raw = await res.text()
  if (!res.ok) {
    throw new Error(`语音识别失败（HTTP ${res.status}）：${raw.slice(0, 240)}`)
  }
  let data: any = {}
  try {
    data = JSON.parse(raw)
  } catch {
    return { text: raw.trim(), segments: [] }
  }
  return parseTranscript(data, '')
}

export async function saveProjectWithDialog(
  event: Electron.IpcMainInvokeEvent,
  payload: { defaultName: string; json: string; defaultDir?: string }
): Promise<{ canceled: boolean; filePath?: string }> {
  const win = parentWindow(event)
  const defaultPath = payload.defaultDir
    ? join(payload.defaultDir, payload.defaultName)
    : payload.defaultName
  const picked = win
    ? await dialog.showSaveDialog(win, {
        defaultPath,
        filters: [{ name: '好伙伴复刻工程', extensions: ['haohuoban-clone.json'] }]
      })
    : await dialog.showSaveDialog({
        defaultPath,
        filters: [{ name: '好伙伴复刻工程', extensions: ['haohuoban-clone.json'] }]
      })
  if (picked.canceled || !picked.filePath) return { canceled: true }
  const jsonPath = picked.filePath.endsWith('.json')
    ? picked.filePath
    : `${picked.filePath}.haohuoban-clone.json`
  mkdirSync(dirname(jsonPath), { recursive: true })
  writeFileSync(jsonPath, payload.json, 'utf8')
  return { canceled: false, filePath: jsonPath }
}

export async function openProjectWithDialog(
  event: Electron.IpcMainInvokeEvent
): Promise<{ canceled: boolean; filePath?: string; json?: string }> {
  const win = parentWindow(event)
  const picked = win
    ? await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: '好伙伴复刻工程', extensions: ['json'] }]
      })
    : await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: '好伙伴复刻工程', extensions: ['json'] }]
      })
  if (picked.canceled || !picked.filePaths?.[0]) return { canceled: true }
  const filePath = picked.filePaths[0]
  const json = readFileSync(filePath, 'utf8')
  return { canceled: false, filePath, json }
}

export function cleanupTempAudio(wavPath: string): void {
  if (!wavPath) return
  try {
    rmSync(dirname(wavPath), { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

export async function extractFrameAt(videoPath: string, time: number): Promise<ExtractedFrame> {
  if (!videoPath || !existsSync(videoPath)) throw new Error('找不到视频文件')
  const st = requireFfmpeg()
  const t = Math.max(0, Number(time) || 0)
  const workDir = join(tmpdir(), `haohuoban-clone-frame-${Date.now()}`)
  mkdirSync(workDir, { recursive: true })
  const out = join(workDir, 'frame.jpg')
  try {
    await spawnFfmpeg(st.ffmpeg as string, [
      '-ss', t.toFixed(3),
      '-i', videoPath,
      '-frames:v', '1',
      '-vf', 'scale=720:-2',
      '-q:v', '4',
      '-y',
      out
    ])
    if (!existsSync(out)) throw new Error('未能抽出该时刻画面')
    const buf = readFileSync(out)
    return { time: t, dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}` }
  } finally {
    try { rmSync(workDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

export function resolveMediaPath(filePath: string): string {
  const raw = String(filePath || '').trim()
  if (!raw) return ''
  if (isAbsolute(raw) && existsSync(raw)) return raw
  const underData = join(getDataDir(), raw)
  if (existsSync(underData)) return underData
  return raw
}

export async function concatVideos(paths: string[], outPath: string): Promise<{ filePath: string }> {
  const abs = paths.map(resolveMediaPath).filter((p) => p && existsSync(p))
  if (abs.length < 1) throw new Error('没有可拼接的镜头视频')
  const st = requireFfmpeg()
  const dest = outPath && isAbsolute(outPath)
    ? outPath
    : join(getDataDir(), 'output', outPath || `clone-${Date.now()}.mp4`)
  mkdirSync(dirname(dest), { recursive: true })
  if (abs.length === 1) {
    await spawnFfmpeg(st.ffmpeg as string, [
      '-i', abs[0],
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y',
      dest
    ])
    return { filePath: dest }
  }
  const workDir = join(tmpdir(), `haohuoban-clone-concat-${Date.now()}`)
  mkdirSync(workDir, { recursive: true })
  try {
    const normalized: string[] = []
    for (let i = 0; i < abs.length; i++) {
      const clip = join(workDir, `n-${String(i).padStart(3, '0')}.mp4`)
      await spawnFfmpeg(st.ffmpeg as string, [
        '-i', abs[i],
        '-an',
        '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-y',
        clip
      ])
      normalized.push(clip)
    }
    const listFile = join(workDir, 'list.txt')
    writeFileSync(
      listFile,
      normalized.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'),
      'utf8'
    )
    await spawnFfmpeg(st.ffmpeg as string, [
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y',
      dest
    ])
    return { filePath: dest }
  } finally {
    try { rmSync(workDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

function extraBinDirs(): string[] {
  if (process.platform !== 'darwin') return []
  const home = process.env.HOME || ''
  const prefix = process.env.HOMEBREW_PREFIX
  return [...new Set([
    prefix ? join(prefix, 'bin') : '',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/opt/local/bin',
    home ? join(home, '.local/bin') : ''
  ].filter(Boolean))]
}

function ytDlpInstallHint(): string {
  if (process.platform === 'darwin') return 'brew install yt-dlp'
  if (process.platform === 'win32') return 'winget install yt-dlp'
  return 'pipx install yt-dlp'
}

function probeYtDlp(binPath: string): boolean {
  try {
    const r = spawnSync(binPath, ['--version'], { timeout: 6000, windowsHide: true })
    return r.status === 0
  } catch {
    return false
  }
}

function detectYtDlp(): { ready: boolean; bin?: string; reason?: string; installHint: string } {
  const hint = ytDlpInstallHint()
  const missing = {
    ready: false,
    reason: `未检测到 yt-dlp。终端执行 ${hint}，完成后完全退出再打开应用，或把视频下载到本地后上传。`,
    installHint: hint
  }
  const names = process.platform === 'win32' ? ['yt-dlp.exe', 'yt-dlp'] : ['yt-dlp']
  for (const dir of extraBinDirs()) {
    for (const name of names) {
      const p = join(dir, name)
      if (existsSync(p) && probeYtDlp(p)) return { ready: true, bin: p, installHint: hint }
    }
  }
  if (probeYtDlp('yt-dlp')) return { ready: true, bin: 'yt-dlp', installHint: hint }
  return missing
}

export function ytDlpStatus(): { ready: boolean; reason: string; installHint: string } {
  const st = detectYtDlp()
  return { ready: st.ready, reason: st.reason || '', installHint: st.installHint }
}

export function isAllowedCloneUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^www\./i, '').toLowerCase()
    return (
      host === 'tiktok.com'
      || host.endsWith('.tiktok.com')
      || host === 'douyin.com'
      || host.endsWith('.douyin.com')
      || host === 'iesdouyin.com'
      || host.endsWith('.iesdouyin.com')
    )
  } catch {
    return false
  }
}

export async function importFromUrl(url: string): Promise<{ path: string; name: string; duration: number; width: number; height: number }> {
  const href = String(url || '').trim()
  if (!href) throw new Error('请粘贴链接')
  if (!isAllowedCloneUrl(href)) throw new Error('只接受 TikTok 或抖音公开链接。不是无水印搬运；拉不到请本地下载后上传。')
  const yt = detectYtDlp()
  if (!yt.ready || !yt.bin) throw new Error(yt.reason || `未检测到 yt-dlp。可执行 ${yt.installHint}，或把视频下载到本地后上传。`)
  const bin = yt.bin
  const dir = join(getDataDir(), 'input')
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, `clone-${Date.now()}.mp4`)
  const st = detect()
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-mtime',
    '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best',
    '--merge-output-format', 'mp4',
    '--max-filesize', '80M',
    '-o', dest,
    href
  ]
  if (st.ffmpeg && st.ffmpeg !== 'ffmpeg') {
    args.splice(0, 0, '--ffmpeg-location', st.ffmpeg)
  }
  let result: { stdout: string; stderr: string; code: number }
  try {
    result = await runBin(bin, args)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/ENOENT|not found/i.test(msg)) {
      throw new Error('未检测到 yt-dlp。可执行 brew install yt-dlp，或把视频下载到本地后上传。')
    }
    throw e
  }
  if (result.code !== 0) {
    const err = (result.stderr || result.stdout || '').slice(-400)
    if (/ENOENT|not found|不是内部或外部命令/i.test(err) || result.code === 127) {
      throw new Error('未检测到 yt-dlp。可执行 brew install yt-dlp，或把视频下载到本地后上传。')
    }
    throw new Error(`链接拉片失败（平台风控或需登录时请改本地上传）：${err || '未知错误'}`)
  }
  if (!existsSync(dest)) throw new Error('链接已请求，但没有得到本地视频。请改用本地上传。')
  const probe = await probeVideo(dest)
  return {
    path: dest,
    name: basename(dest),
    duration: probe.duration,
    width: probe.width,
    height: probe.height
  }
}

export async function muxVoiceover(
  videoPath: string,
  chunks: Array<{ text: string; durationSeconds: number }>,
  destName: string,
  opts: { voice?: string; speed?: number } = {}
): Promise<{ filePath: string }> {
  const abs = resolveMediaPath(videoPath)
  if (!abs || !existsSync(abs)) throw new Error('找不到成片视频')
  const voiced = (chunks || []).map((c) => ({ text: String(c?.text || '').trim(), durationSeconds: Math.max(0.2, Number(c?.durationSeconds) || 1) }))
  if (!voiced.some((c) => c.text)) {
    return { filePath: abs }
  }
  const st = requireFfmpeg()
  const workDir = join(tmpdir(), `haohuoban-clone-tts-${Date.now()}`)
  mkdirSync(workDir, { recursive: true })
  try {
    const concatItems: string[] = []
    for (let i = 0; i < voiced.length; i++) {
      const ch = voiced[i]
      const target = ch.durationSeconds
      if (!ch.text) {
        const sil = join(workDir, `s${i}.mp3`)
        await spawnFfmpeg(st.ffmpeg as string, [
          '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(target), '-c:a', 'libmp3lame', sil
        ])
        concatItems.push(sil)
        continue
      }
      const bytes = await cloudSynth(ch.text, opts.voice || undefined, opts.speed || 1)
      const raw = join(workDir, `raw${i}`)
      writeFileSync(raw, bytes)
      const norm = join(workDir, `c${i}.mp3`)
      await spawnFfmpeg(st.ffmpeg as string, ['-y', '-i', raw, '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', norm])
      concatItems.push(norm)
      const probed = await runBin(st.ffprobe as string, [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', norm
      ])
      const actual = parseFloat((probed.stdout || '').trim())
      const gap = target - (Number.isFinite(actual) ? actual : 0)
      if (gap > 0.12) {
        const sil = join(workDir, `g${i}.mp3`)
        await spawnFfmpeg(st.ffmpeg as string, [
          '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', gap.toFixed(3), '-c:a', 'libmp3lame', sil
        ])
        concatItems.push(sil)
      }
    }
    const listFile = join(workDir, 'list.txt')
    writeFileSync(
      listFile,
      concatItems.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'),
      'utf8'
    )
    const narr = join(workDir, 'narration.mp3')
    await spawnFfmpeg(st.ffmpeg as string, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', narr])
    const dest = destName && isAbsolute(destName)
      ? destName
      : join(getDataDir(), 'output', destName || `clone-vo-${Date.now()}.mp4`)
    mkdirSync(dirname(dest), { recursive: true })
    await muxNarrationIntoMp4(abs, narr, dest, st.ffmpeg as string)
    return { filePath: dest }
  } finally {
    try { rmSync(workDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}
