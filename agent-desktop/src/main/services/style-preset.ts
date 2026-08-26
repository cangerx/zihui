import https from 'https'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { getCloudApiBase } from './cloud-token'

/**
 * 生图风格预设（云端分发）拉取服务。
 *
 * 数据来源：云控端 /api/public/style-presets/*（后台「风格管理」维护，无投稿审核）。
 * 策略：
 * - 优先走网络拉取，成功后写本地缓存（userData/style-presets-cache.json）
 * - 网络失败 / 远端未部署该接口（404）时回落到上次缓存
 * - 首次且无缓存时返回空列表（渲染层不显示风格入口）
 * 不做鉴权（公开接口），白标包天然拉各自租户域名的风格库。
 */

export interface StylePreset {
  id: number
  name: string
  prompt_fragment: string
  sample_image: string
  category: string
  sort_order: number
}

export interface StylePresetBundle {
  categories: string[]
  styles: StylePreset[]
  /** true = 来自本地缓存（离线或远端不可达） */
  fromCache: boolean
}

class HttpError extends Error {
  status: number
  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`)
    this.status = status
  }
}

function fetchJson(url: string, timeoutMs = 12000): Promise<any> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, (res) => {
      const status = res.statusCode || 0
      let data = ''
      res.on('data', (chunk: string) => (data += chunk))
      res.on('end', () => {
        if (status >= 400) {
          reject(new HttpError(status, data))
          return
        }
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timeout after ${timeoutMs}ms`))
    })
    req.on('error', reject)
  })
}

function originOf(apiBase: string): string {
  const m = apiBase.match(/^(https?:\/\/[^/]+)/)
  return m ? m[1] : ''
}

function resolveUrl(value: string | undefined, origin: string): string {
  if (!value) return ''
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) return value
  return value.startsWith('/') ? origin + value : value
}

function cacheFile(): string {
  return path.join(app.getPath('userData'), 'style-presets-cache.json')
}

function readCache(): { categories: string[]; styles: StylePreset[] } | null {
  try {
    const raw = fs.readFileSync(cacheFile(), 'utf-8')
    const json = JSON.parse(raw)
    if (!json || !Array.isArray(json.styles)) return null
    return {
      categories: Array.isArray(json.categories) ? json.categories.map(String) : [],
      styles: json.styles,
    }
  } catch {
    return null
  }
}

function writeCache(categories: string[], styles: StylePreset[]): void {
  try {
    fs.writeFileSync(cacheFile(), JSON.stringify({ fetched_at: Date.now(), categories, styles }), 'utf-8')
  } catch (e) {
    console.warn('[style-preset] write cache failed:', e)
  }
}

function mapStyle(raw: any, origin: string): StylePreset {
  return {
    id: Number(raw.id),
    name: String(raw.name || ''),
    prompt_fragment: String(raw.prompt_fragment || ''),
    sample_image: resolveUrl(raw.sample_image, origin),
    category: String(raw.category || ''),
    sort_order: Number(raw.sort_order || 0),
  }
}

/**
 * 拉取风格预设。forceRefresh 仅影响语义（当前实现每次都先试网络）；
 * 任何失败都回落缓存，缓存也没有时返回空列表。
 */
export async function getStylePresets(): Promise<StylePresetBundle> {
  const apiBase = getCloudApiBase()
  if (!apiBase) {
    const cached = readCache()
    return { categories: cached?.categories || [], styles: cached?.styles || [], fromCache: true }
  }
  const origin = originOf(apiBase)
  try {
    const [listJson, catJson] = await Promise.all([
      fetchJson(`${apiBase}/public/style-presets/list`),
      fetchJson(`${apiBase}/public/style-presets/categories`),
    ])
    const styles: StylePreset[] = (listJson?.items || []).map((it: any) => mapStyle(it, origin))
    // 分类以 list 里实际出现的为准（categories 接口兜底），避免空分类占位
    const fromList = [...new Set(styles.map((s) => s.category).filter(Boolean))]
    const fromApi: string[] = Array.isArray(catJson?.data) ? catJson.data.map(String).filter(Boolean) : []
    const categories = fromList.length > 0
      ? fromApi.filter((c) => fromList.includes(c)).concat(fromList.filter((c) => !fromApi.includes(c)))
      : fromApi
    writeCache(categories, styles)
    return { categories, styles, fromCache: false }
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 404) {
      console.warn('[style-preset] fetch failed, fallback to cache:', e instanceof Error ? e.message : e)
    }
    const cached = readCache()
    return { categories: cached?.categories || [], styles: cached?.styles || [], fromCache: true }
  }
}
