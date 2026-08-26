import { join } from 'path'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { spawnSync } from 'child_process'
import { spawnFfmpeg } from './ffmpeg-manager'

// 解说音频流水线: 逐段 TTS(DI) → 统一转 24000Hz mono mp3 → ffprobe 实测时长 → 段间静音 →
// ffmpeg concat 拼接成整条解说音轨, 并产出 timeline(供视频对齐)。
// TTS 合成函数依赖注入(真实=云控端 /audio/synthesize 代理); ffmpeg/ffprobe 来自 ffmpeg-manager.detect。

export type SynthFn = (text: string, voice?: string, speed?: number) => Promise<Buffer>

export interface NarrationChunk {
  text: string
  voice?: string
  speed?: number
  /** 本段之后的停顿(ms) */
  gapMs?: number
}

export interface NarrationSegment {
  index: number
  startMs: number
  endMs: number
  durationMs: number
}

export interface NarrationResult {
  audio: Buffer
  segments: NarrationSegment[]
  totalMs: number
}

const SR = 24000 // 统一采样率
const CH = 1 // 单声道

/** ffprobe 实测音频时长(ms); 失败返回 0 */
function ffprobeDurationMs(ffprobePath: string, file: string): number {
  const r = spawnSync(
    ffprobePath,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    { encoding: 'utf-8', windowsHide: true, timeout: 30000 }
  )
  const sec = parseFloat((r.stdout || '').trim())
  return isFinite(sec) ? Math.round(sec * 1000) : 0
}

/**
 * 逐段合成 + 拼接成整条解说 mp3。
 * 不信 TTS 自报时长, 一律 ffprobe 实测; 段与段之间按 gapMs 插静音。
 */
export async function buildNarration(
  chunks: NarrationChunk[],
  synth: SynthFn,
  ffmpegPath: string,
  ffprobePath: string,
  opts: { signal?: AbortSignal } = {}
): Promise<NarrationResult> {
  const dir = mkdtempSync(join(tmpdir(), 'deck-narr-'))
  try {
    const concatItems: string[] = []
    const segments: NarrationSegment[] = []
    let cursor = 0

    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i]!
      const bytes = await synth(ch.text, ch.voice, ch.speed)
      const raw = join(dir, `raw${i}`)
      writeFileSync(raw, bytes)

      // 统一转 24000Hz mono mp3(规避各段采样率/码率不一致导致 concat 错位)
      const norm = join(dir, `c${i}.mp3`)
      await spawnFfmpeg(
        ffmpegPath,
        ['-y', '-i', raw, '-ar', String(SR), '-ac', String(CH), '-c:a', 'libmp3lame', norm],
        { signal: opts.signal }
      )

      const dur = ffprobeDurationMs(ffprobePath, norm)
      segments.push({ index: i, startMs: cursor, endMs: cursor + dur, durationMs: dur })
      cursor += dur
      concatItems.push(norm)

      const gap = ch.gapMs ?? 0
      if (gap > 0) {
        const sil = join(dir, `s${i}.mp3`)
        await spawnFfmpeg(
          ffmpegPath,
          [
            '-y',
            '-f',
            'lavfi',
            '-i',
            `anullsrc=r=${SR}:cl=mono`,
            '-t',
            (gap / 1000).toString(),
            '-c:a',
            'libmp3lame',
            sil
          ],
          { signal: opts.signal }
        )
        concatItems.push(sil)
        cursor += gap
      }
    }

    if (concatItems.length === 0) {
      throw new Error('解说为空, 无可合成段落')
    }

    // 全部已归一为 24000 mono mp3 → concat demuxer -c copy 无损拼接
    const listFile = join(dir, 'list.txt')
    writeFileSync(
      listFile,
      concatItems.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
    )
    const out = join(dir, 'narration.mp3')
    await spawnFfmpeg(
      ffmpegPath,
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', out],
      { signal: opts.signal }
    )

    return { audio: readFileSync(out), segments, totalMs: cursor }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * 把解说音轨混进已有 MP4。可选 BGM + ducking(解说说话时自动压低背景乐, sidechaincompress)。
 * - 无 bgmPath: 基础 video + narration 合流。
 * - 有 bgmPath: 解说为主、BGM 为辅, BGM 经 sidechaincompress 被解说信号 duck, 再 amix 混合(对齐 huashu cinematic-patterns 双轨制)。
 */
export async function muxNarrationIntoMp4(
  videoPath: string,
  narrationPath: string,
  outPath: string,
  ffmpegPath: string,
  opts: { signal?: AbortSignal; bgmPath?: string; bgmVolume?: number } = {}
): Promise<void> {
  if (opts.bgmPath) {
    // [1]=narration(主), [2]=bgm(辅,先降音量循环) → sidechaincompress(bgm 被 narration duck) → amix
    const bgmVol = opts.bgmVolume ?? 0.25
    const filter =
      `[2:a]volume=${bgmVol},aloop=loop=-1:size=2e9[bgm];` +
      `[bgm][1:a]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[duck];` +
      `[1:a][duck]amix=inputs=2:duration=first:dropout_transition=2[aout]`
    await spawnFfmpeg(
      ffmpegPath,
      [
        '-y', '-i', videoPath, '-i', narrationPath, '-stream_loop', '-1', '-i', opts.bgmPath,
        '-filter_complex', filter,
        '-map', '0:v:0', '-map', '[aout]',
        '-c:v', 'copy', '-c:a', 'aac', '-shortest', outPath
      ],
      { signal: opts.signal }
    )
    return
  }
  await spawnFfmpeg(
    ffmpegPath,
    [
      '-y',
      '-i',
      videoPath,
      '-i',
      narrationPath,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-shortest',
      outPath
    ],
    { signal: opts.signal }
  )
}
