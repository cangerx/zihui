import { existsSync, mkdirSync, writeFileSync, renameSync, rmSync, chmodSync } from 'fs'
import { join, dirname } from 'path'
import { spawn, spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { gunzipSync } from 'zlib'
import { getRootDir } from '../data-path'

// ffmpeg 按需交付(D11 三层模型): 优先云控 manifest(SHA256) → 本机 Homebrew 等固定路径
// （Electron 从程序坞启动时 PATH 通常没有 /opt/homebrew/bin）→ 公开静态包兜底。
// 落 设备级 getRootDir()/bin/ → mac chmod+ad-hoc签名 → spawn(绝对路径不走shell)。

export type FfPlatform = 'win32-x64' | 'darwin-x64' | 'darwin-arm64'

/** ffmpeg 未就绪(需安装/下载)。UI 捕获后弹「请安装 ffmpeg」门控。 */
export class FfmpegNotReadyError extends Error {
  reason: string
  constructor(reason: string) {
    super(reason)
    this.name = 'FfmpegNotReadyError'
    this.reason = reason
  }
}

/** 按 process.platform+arch 选包(Rosetta 下 arch 报 x64 → darwin-x64) */
export function platformKey(): FfPlatform | null {
  if (process.platform === 'win32' && process.arch === 'x64') return 'win32-x64'
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64'
  return null
}

function binName(base: 'ffmpeg' | 'ffprobe'): string {
  return process.platform === 'win32' ? `${base}.exe` : base
}

export function defaultBinDir(): string {
  return join(getRootDir(), 'bin')
}

export interface FfmpegStatus {
  ready: boolean
  ffmpeg?: string
  ffprobe?: string
  reason?: string
}

function probe(binPath: string): boolean {
  try {
    const r = spawnSync(binPath, ['-version'], { timeout: 6000, windowsHide: true })
    return r.status === 0
  } catch {
    return false
  }
}

/** GUI 进程 PATH 不含 Homebrew；按目录成对找 ffmpeg+ffprobe。 */
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

function detectPair(ffmpegPath: string, ffprobePath: string): FfmpegStatus | null {
  if (!existsSync(ffmpegPath) || !existsSync(ffprobePath)) return null
  if (probe(ffmpegPath) && probe(ffprobePath)) {
    return { ready: true, ffmpeg: ffmpegPath, ffprobe: ffprobePath }
  }
  return null
}

/**
 * 检测 ffmpeg/ffprobe 是否就绪: 优先 binDir 绝对路径(并 -version 自检),
 * 再 Homebrew 等固定目录, 最后 PATH。
 * skipPathFallback=true 时不回退 PATH / 固定目录(部署方强制用托管二进制 / 测试用)。
 */
export function detect(
  binDir: string = defaultBinDir(),
  opts: { skipPathFallback?: boolean } = {}
): FfmpegStatus {
  const ff = join(binDir, binName('ffmpeg'))
  const fp = join(binDir, binName('ffprobe'))
  if (existsSync(ff) && existsSync(fp)) {
    const pair = detectPair(ff, fp)
    if (pair) return pair
    return { ready: false, reason: 'ffmpeg 已下载但无法执行(可能损坏或未签名), 需重新安装' }
  }
  if (!opts.skipPathFallback) {
    for (const dir of extraBinDirs()) {
      const pair = detectPair(join(dir, binName('ffmpeg')), join(dir, binName('ffprobe')))
      if (pair) return pair
    }
    if (probe('ffmpeg') && probe('ffprobe')) {
      return { ready: true, ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }
    }
  }
  return { ready: false, reason: 'ffmpeg/ffprobe 未安装' }
}

export interface FfmpegManifestEntry {
  platform: FfPlatform
  version: string
  ffmpegUrl: string
  ffmpegSha256: string
  ffprobeUrl: string
  ffprobeSha256: string
}
export interface FfmpegManifest {
  schema_version: number
  builds: FfmpegManifestEntry[]
}
export type FetchBytes = (url: string, signal?: AbortSignal) => Promise<Buffer>

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

/** 与 npm `ffmpeg-static` 同源；仅在云控未上架当前平台时使用。 */
const PUBLIC_FFMPEG_TAG = 'b6.1.1'

function publicGzUrls(key: FfPlatform, bin: 'ffmpeg' | 'ffprobe'): string[] {
  const file = `${bin}-${key}.gz`
  return [
    `https://cdn.npmmirror.com/binaries/ffmpeg-static/${PUBLIC_FFMPEG_TAG}/${file}`,
    `https://github.com/eugeneware/ffmpeg-static/releases/download/${PUBLIC_FFMPEG_TAG}/${file}`
  ]
}

function maybeGunzip(buf: Buffer): Buffer {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf)
  return buf
}

function looksLikeFfBinary(buf: Buffer): boolean {
  if (buf.length < 4) return false
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return true
  if (buf[0] === 0x4d && buf[1] === 0x5a) return true
  const be = buf.readUInt32BE(0)
  return be === 0xcafebabe || be === 0xfeedface || be === 0xfeedfacf || be === 0xcefaedfe || be === 0xcffaedfe
}

async function downloadVerifyPlace(
  url: string,
  expectSha: string,
  dest: string,
  fetchBytes: FetchBytes,
  signal?: AbortSignal
): Promise<void> {
  const raw = await fetchBytes(url, signal)
  const buf = maybeGunzip(raw)
  if (expectSha) {
    const actual = sha256(buf)
    if (actual !== expectSha) {
      throw new Error(`ffmpeg 资源 SHA256 不符(期望 ${expectSha.slice(0, 12)}… 实得 ${actual.slice(0, 12)}…), 拒绝使用`)
    }
  } else if (!looksLikeFfBinary(buf)) {
    throw new Error(`下载内容不是可执行文件: ${url}`)
  }
  mkdirSync(dirname(dest), { recursive: true })
  const tmp = `${dest}.dltmp`
  writeFileSync(tmp, buf)
  try {
    rmSync(dest, { force: true })
  } catch {
    /* ignore */
  }
  renameSync(tmp, dest)
  // mac/linux: 可执行位 + (mac)ad-hoc 签名 + 去隔离
  if (process.platform !== 'win32') {
    chmodSync(dest, 0o755)
    if (process.platform === 'darwin') {
      // arm64 未签名二进制会被内核拒绝执行; 已签名则跳过, 否则本地 ad-hoc 重签(/usr/bin/codesign 自带)
      const verify = spawnSync('codesign', ['--verify', dest], { windowsHide: true })
      if (verify.status !== 0) {
        spawnSync('codesign', ['--force', '--sign', '-', dest], { windowsHide: true })
      }
      spawnSync('xattr', ['-d', 'com.apple.quarantine', dest], { windowsHide: true }) // 失败忽略
    }
  }
}

async function downloadFromMirrors(
  urls: string[],
  dest: string,
  fetchBytes: FetchBytes,
  signal?: AbortSignal
): Promise<void> {
  let last = ''
  for (const url of urls) {
    try {
      await downloadVerifyPlace(url, '', dest, fetchBytes, signal)
      return
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
  }
  throw new Error(last || '公开源下载失败')
}

/** 确保 ffmpeg 就绪: 已就绪直接返回; 否则按平台从 manifest 下载 ffmpeg+ffprobe(强校验+签名)后重测。 */
export async function ensureFfmpeg(
  manifest: FfmpegManifest,
  opts: {
    binDir?: string
    fetchBytes: FetchBytes
    signal?: AbortSignal
    onProgress?: (p: { stage: string }) => void
    skipPathFallback?: boolean
  }
): Promise<FfmpegStatus> {
  const binDir = opts.binDir ?? defaultBinDir()
  const cur = detect(binDir, { skipPathFallback: opts.skipPathFallback })
  if (cur.ready) return cur

  const key = platformKey()
  if (!key) throw new Error('当前平台不支持 ffmpeg 按需安装')
  const entry = manifest.builds.find((b) => b.platform === key)
  const destFf = join(binDir, binName('ffmpeg'))
  const destFp = join(binDir, binName('ffprobe'))

  if (entry) {
    opts.onProgress?.({ stage: '下载 ffmpeg' })
    await downloadVerifyPlace(entry.ffmpegUrl, entry.ffmpegSha256, destFf, opts.fetchBytes, opts.signal)
    opts.onProgress?.({ stage: '下载 ffprobe' })
    await downloadVerifyPlace(entry.ffprobeUrl, entry.ffprobeSha256, destFp, opts.fetchBytes, opts.signal)
  } else {
    opts.onProgress?.({ stage: '云控未上架本机架构，改从公开源下载' })
    try {
      await downloadFromMirrors(publicGzUrls(key, 'ffmpeg'), destFf, opts.fetchBytes, opts.signal)
      opts.onProgress?.({ stage: '下载 ffprobe' })
      await downloadFromMirrors(publicGzUrls(key, 'ffprobe'), destFp, opts.fetchBytes, opts.signal)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      throw new Error(
        `云控未上架 ${key} 的 ffmpeg，公开源也未能安装（${detail}）。可先 brew install ffmpeg，或在云控「AI PPT 资源」拉取该平台构建。`
      )
    }
  }
  return detect(binDir)
}

/** spawn ffmpeg(绝对路径, 不走 shell, 规避中文/空格路径与注入); signal 可中止。 */
export function spawnFfmpeg(
  ffmpegPath: string,
  args: string[],
  opts: { cwd?: string; signal?: AbortSignal } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { cwd: opts.cwd, windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (d) => {
      stderr += d.toString()
      if (stderr.length > 100000) stderr = stderr.slice(-50000)
    })
    opts.signal?.addEventListener('abort', () => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}: ${stderr.slice(-500)}`))
    )
  })
}
