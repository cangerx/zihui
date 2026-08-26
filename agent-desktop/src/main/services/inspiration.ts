import { app } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import https from 'https'
import http from 'http'
import { getCloudApiBase } from './cloud-token'

export interface Inspiration {
  id: string
  title: string
  prompt_cn: string
  prompt_en: string
  category: string
  tags: string[]
  ref_image?: string
  ref_images?: string[]
  generation_size?: string
  cover_image?: string
  // 网格列表用的封面缩略图 URL（云端可能为空，前端回退 cover_image）
  cover_thumb?: string
  // 云控端自定义灵感中，用户上传的会带上传者昵称；后台手动录入的为空
  uploader_nickname?: string
}

let cachedInspirations: Inspiration[] | null = null

function getInspirationsPath(): string {
  const isProd = app.isPackaged
  if (isProd) {
    return join(process.resourcesPath, 'inspirations.json')
  }
  return join(__dirname, '../../resources/inspirations.json')
}

function loadInspirations(): Inspiration[] {
  if (cachedInspirations) return cachedInspirations

  const filePath = getInspirationsPath()
  if (!existsSync(filePath)) {
    cachedInspirations = []
    return cachedInspirations
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    cachedInspirations = JSON.parse(raw) as Inspiration[]
  } catch {
    cachedInspirations = []
  }
  return cachedInspirations
}

export function listInspirations(options?: {
  category?: string
  search?: string
  page?: number
  pageSize?: number
}): { items: Inspiration[]; total: number; categories: string[] } {
  let items = loadInspirations()
  const allCategories = Array.from(new Set(items.map((i) => i.category).filter(Boolean)))

  if (options?.category) {
    items = items.filter((i) => i.category === options.category)
  }

  if (options?.search) {
    const q = options.search.toLowerCase()
    items = items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.prompt_cn.toLowerCase().includes(q) ||
        i.prompt_en.toLowerCase().includes(q) ||
        i.tags.some((t) => t.toLowerCase().includes(q))
    )
  }

  const total = items.length
  const page = options?.page || 1
  const pageSize = options?.pageSize || 20
  const offset = (page - 1) * pageSize
  items = items.slice(offset, offset + pageSize)

  return { items, total, categories: allCategories }
}

export function getInspiration(id: string): Inspiration | null {
  const items = loadInspirations()
  return items.find((i) => i.id === id) || null
}

export function reloadInspirations(): void {
  cachedInspirations = null
}

function resolveImageUrl(value: string, origin: string): string {
  if (!value) return ''
  return value.startsWith('/') ? origin + value : value
}

function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, (res) => {
      let data = ''
      res.on('data', (chunk: string) => (data += chunk))
      res.on('end', () => {
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

/**
 * 拉云控端自定义灵感。原「百度文心 ERNIE」默认源已下线，
 * 如果云控端未配分类或请求失败，返回空列表 + 空分类。
 */
export async function fetchOnlineInspirations(options?: {
  page?: number
  pageSize?: number
  category?: string
  search?: string
}): Promise<{ items: Inspiration[]; total: number; categories: string[] }> {
  return fetchCustomInspirations(options)
}

async function fetchCustomInspirations(options?: {
  page?: number
  pageSize?: number
  category?: string
  search?: string
}): Promise<{ items: Inspiration[]; total: number; categories: string[] }> {
  const apiBase = getCloudApiBase()
  // Derive the origin (scheme + host) from apiBase for resolving relative image paths
  const originMatch = apiBase.match(/^(https?:\/\/[^/]+)/)
  const origin = originMatch ? originMatch[1] : ''
  const pageSize = options?.pageSize || 40
  const page = options?.page || 1
  const categories = await fetchCustomCategoryOptions(apiBase)
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(pageSize),
  })
  if (options?.category) {
    const matched = categories.find((cat) => cat.name === options.category)
    if (matched) params.set('category_id', String(matched.id))
  }
  if (options?.search) params.set('search', options.search)
  const url = `${apiBase}/public/inspiration/list?${params.toString()}`

  const json = await fetchJson(url)
  const rawItems: any[] = json.items || []
  const items: Inspiration[] = rawItems.map((item) => {
    const coverImage = resolveImageUrl(item.cover_image || '', origin)
    const coverThumb = resolveImageUrl(item.cover_thumb || '', origin)
    const refImages = Array.isArray(item.ref_images)
      ? item.ref_images.map((url: string) => resolveImageUrl(url, origin)).filter(Boolean).slice(0, 8)
      : []
    return {
      id: `custom-${item.id}`,
      title: item.title || '',
      prompt_cn: item.prompt_cn || '',
      prompt_en: item.prompt_en || '',
      category: item.category?.name || '',
      tags: [],
      ref_image: refImages[0],
      ref_images: refImages,
      generation_size: item.generation_size || '',
      cover_image: coverImage || undefined,
      cover_thumb: coverThumb || undefined,
      uploader_nickname: item.uploader_nickname || ''
    }
  })

  return { items, total: json.total || items.length, categories: categories.map((cat) => cat.name) }
}

export async function getInspirationCategories(): Promise<string[]> {
  const apiBase = getCloudApiBase()
  try {
    const json = await fetchJson(`${apiBase}/public/inspiration/categories`)
    return (json.data || []).map((c: any) => c.name)
  } catch {
    return []
  }
}

async function fetchCustomCategoryOptions(apiBase: string): Promise<Array<{ id: number; name: string }>> {
  try {
    const json = await fetchJson(`${apiBase}/public/inspiration/categories`)
    return (json.data || [])
      .map((c: any) => ({ id: Number(c.id), name: String(c.name || '') }))
      .filter((c: { id: number; name: string }) => c.id && c.name)
  } catch {
    return []
  }
}
