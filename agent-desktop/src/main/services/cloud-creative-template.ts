import https from 'https'
import http from 'http'
import { getCloudApiBase } from './cloud-token'

class HttpError extends Error {
  status: number
  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`)
    this.status = status
  }
}

export interface CloudCreativeTemplateCategory {
  id: number
  name: string
  description: string
  sort_order: number
}

export interface CloudCreativeTemplate {
  id: number
  category_id: number
  category_name?: string
  title: string
  description: string
  cover_image: string
  cover_thumb: string
  example_ref_images: string[]
  requires_ref_image: number
  default_size: string
  prompt_template: string
  variables: Array<{
    key: string
    label: string
    type: 'text' | 'textarea' | 'select' | 'multi_select'
    required: boolean
    placeholder?: string
    default?: string
    options?: string[]
  }>
  sort_order: number
  updated_at?: string
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

function isNotFound(e: unknown): boolean {
  return e instanceof HttpError && e.status === 404
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

function normalizeArrayUrls(value: unknown, origin: string): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const v of value) {
    const url = resolveUrl(typeof v === 'string' ? v : '', origin)
    if (url) out.push(url)
  }
  return out.slice(0, 8)
}

function mapTemplate(raw: any, origin: string): CloudCreativeTemplate {
  return {
    id: Number(raw.id),
    category_id: Number(raw.category_id || raw.category?.id || 0),
    category_name: String(raw.category_name || raw.category?.name || ''),
    title: String(raw.title || ''),
    description: String(raw.description || ''),
    cover_image: resolveUrl(raw.cover_image, origin),
    cover_thumb: resolveUrl(raw.cover_thumb, origin),
    example_ref_images: normalizeArrayUrls(raw.example_ref_images, origin),
    requires_ref_image: raw.requires_ref_image ? 1 : 0,
    default_size: String(raw.default_size || ''),
    prompt_template: String(raw.prompt_template || ''),
    variables: Array.isArray(raw.variables) ? raw.variables : [],
    sort_order: Number(raw.sort_order || 0),
    updated_at: raw.updated_at || undefined,
  }
}

export async function fetchCloudCategories(): Promise<CloudCreativeTemplateCategory[]> {
  const apiBase = getCloudApiBase()
  if (!apiBase) return []
  let json: any
  try {
    json = await fetchJson(`${apiBase}/public/creative-templates/categories`)
  } catch (e) {
    // 远端云控端可能尚未部署 creative-templates 公开接口。
    // 404 时静默返回空列表，让桌面端「云端模板」tab 优雅降级；其它网络错误仍抛给前端展示。
    if (isNotFound(e)) return []
    throw e
  }
  const arr: any[] = json.data || []
  return arr.map((c) => ({
    id: Number(c.id),
    name: String(c.name || ''),
    description: String(c.description || ''),
    sort_order: Number(c.sort_order || 0),
  }))
}

export async function fetchCloudTemplates(options?: {
  page?: number
  pageSize?: number
  categoryId?: number
  search?: string
}): Promise<{ items: CloudCreativeTemplate[]; total: number; page: number; pageSize: number }> {
  const apiBase = getCloudApiBase()
  if (!apiBase) return { items: [], total: 0, page: 1, pageSize: options?.pageSize || 24 }
  const origin = originOf(apiBase)
  const page = options?.page || 1
  const pageSize = options?.pageSize || 24
  const params = new URLSearchParams({ page: String(page), per_page: String(pageSize) })
  if (options?.categoryId) params.set('category_id', String(options.categoryId))
  if (options?.search) params.set('search', options.search)
  const url = `${apiBase}/public/creative-templates/list?${params.toString()}`
  let json: any
  try {
    json = await fetchJson(url)
  } catch (e) {
    if (isNotFound(e)) return { items: [], total: 0, page, pageSize }
    throw e
  }
  const items: any[] = json.items || []
  return {
    items: items.map((it) => mapTemplate(it, origin)),
    total: Number(json.total || items.length || 0),
    page: Number(json.current_page || page),
    pageSize: Number(json.per_page || pageSize),
  }
}

export async function fetchCloudTemplate(id: number): Promise<CloudCreativeTemplate> {
  const apiBase = getCloudApiBase()
  if (!apiBase) throw new Error('云控端未配置')
  const origin = originOf(apiBase)
  const json = await fetchJson(`${apiBase}/public/creative-templates/${id}`)
  return mapTemplate(json, origin)
}
