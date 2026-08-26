import { getCloudApiBase, fetchWithCloudAuth } from '../cloud-token'
import type { FfmpegManifest, FfmpegManifestEntry, FfPlatform } from './ffmpeg-manager'
import type { TemplateManifest, RemoteTemplateEntry, FetchBytes } from './template-manager'

// 三层分发的桌面端接线: 从【其绑定云控端】拉 deck 资源 manifest, 转成 ffmpeg/template manager 的形态。
// fetchWithCloudAuth 自动带 JWT + X-OEM-Project-Key(云控端据此做 OEM 渠道隔离)。

interface CloudManifestItem {
  kind: string
  asset_key: string
  platform: string
  version: string
  sha256: string
  size: number
  url: string
  meta: {
    name?: string
    category?: string
    description?: string
    schema?: Record<string, unknown>
  } | null
}

/** 下载二进制 / json(manifest item 的 url 是云控端 public 绝对地址) */
export const cloudFetchBytes: FetchBytes = async (url, signal) => {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}: ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

/** 解说 TTS: 经云控端 /audio/synthesize 代理合成(key 留服务端), 返回音频字节。 */
export async function cloudSynth(text: string, voice?: string, speed?: number): Promise<Buffer> {
  const res = await fetchWithCloudAuth(`${getCloudApiBase()}/client/audio/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, speed })
  })
  if (!res.ok) throw new Error(`TTS 合成失败 HTTP ${res.status}`)
  const data = (await res.json()) as { url?: string }
  if (!data.url) throw new Error('TTS 返回无音频 url')
  return cloudFetchBytes(data.url)
}

export interface CloudImageHit {
  url: string
  thumb: string
  width?: number
  height?: number
}

/**
 * 真实素材图搜索(deck 配图三级第一级): 经云控端 /client/image-search 代理 Pixabay。
 * key 在云控端「系统设置」配置、留服务端。未启用/未配/不可达时返回空数组(桌面端降级到生图/SVG)。
 */
export async function cloudImageSearch(query: string, perPage = 8, signal?: AbortSignal): Promise<CloudImageHit[]> {
  try {
    const res = await fetchWithCloudAuth(
      `${getCloudApiBase()}/client/image-search?query=${encodeURIComponent(query)}&per_page=${perPage}`,
      { signal }
    )
    if (!res.ok) return []
    const data = (await res.json()) as { results?: CloudImageHit[] }
    return Array.isArray(data.results) ? data.results : []
  } catch {
    return []
  }
}

async function fetchManifestItems(kind: string, signal?: AbortSignal): Promise<CloudManifestItem[]> {
  const res = await fetchWithCloudAuth(
    `${getCloudApiBase()}/client/deck/resource-manifest?kind=${encodeURIComponent(kind)}`,
    { signal }
  )
  if (!res.ok) throw new Error(`拉取 deck 资源 manifest 失败 HTTP ${res.status}`)
  const data = (await res.json()) as { items?: CloudManifestItem[] }
  return Array.isArray(data.items) ? data.items : []
}

// 云端 ffmpeg 资产的 platform 约定 = FfPlatform(win32-x64 / darwin-x64 / darwin-arm64)。
const FF_PLATFORMS: FfPlatform[] = ['win32-x64', 'darwin-x64', 'darwin-arm64']

/** 云端 ffmpeg 资产(每平台 ffmpeg+ffprobe 两条) → FfmpegManifest(按平台聚合) */
export async function loadFfmpegManifest(signal?: AbortSignal): Promise<FfmpegManifest> {
  const items = await fetchManifestItems('ffmpeg', signal)
  const builds: FfmpegManifestEntry[] = []
  for (const plat of FF_PLATFORMS) {
    const ff = items.find((i) => i.platform === plat && i.asset_key === 'ffmpeg')
    const fp = items.find((i) => i.platform === plat && i.asset_key === 'ffprobe')
    if (ff && fp) {
      builds.push({
        platform: plat,
        version: ff.version || fp.version || '',
        ffmpegUrl: ff.url,
        ffmpegSha256: ff.sha256,
        ffprobeUrl: fp.url,
        ffprobeSha256: fp.sha256
      })
    }
  }
  return { schema_version: 1, builds }
}

/** 云端模板资产 → TemplateManifest(轻量元数据 + schema, 渲染包按需 ensureTemplate 拉) */
export async function loadTemplateManifest(signal?: AbortSignal): Promise<TemplateManifest> {
  const items = await fetchManifestItems('template', signal)
  const templates: RemoteTemplateEntry[] = items.map((i) => ({
    id: i.asset_key,
    version: i.version,
    url: i.url,
    sha256: i.sha256,
    size: i.size,
    name: i.meta?.name ?? i.asset_key,
    category: i.meta?.category ?? '',
    description: i.meta?.description ?? '',
    schema: (i.meta?.schema ?? {}) as RemoteTemplateEntry['schema']
  }))
  return { schema_version: 1, templates }
}
