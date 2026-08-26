import { v4 as uuid } from 'uuid'
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { join, basename } from 'path'
import { getDatabase } from '../database'
import { getDataDir } from './data-path'

// ────── 类型 ──────

export type CreativeTemplateSource = 'manual' | 'image' | 'inspiration'
export type CreativeTemplateSubmissionStatus = '' | 'pending' | 'approved' | 'rejected' | 'withdrawn'

export type CreativeTemplateFieldType = 'text' | 'textarea' | 'select' | 'multi_select'

export interface CreativeTemplateVariable {
  key: string
  label: string
  type: CreativeTemplateFieldType
  required: boolean
  placeholder?: string
  default?: string
  options?: string[]
}

export interface CreativeTemplateCategory {
  id: string
  name: string
  description: string
  sort_order: number
  is_visible: number
  created_at: string
  updated_at: string
}

export interface CreativeTemplate {
  id: string
  category_id: string
  title: string
  description: string
  cover_image: string
  example_ref_images: string[]
  requires_ref_image: number
  default_size: string
  prompt_template: string
  variables: CreativeTemplateVariable[]
  source_type: CreativeTemplateSource
  source_image: string
  source_inspiration_id: string
  cloud_template_id: number
  submission_status: CreativeTemplateSubmissionStatus
  submission_reject_reason: string
  submission_reviewed_at: string
  submission_published_at: string
  submission_synced_at: string
  sort_order: number
  is_visible: number
  created_at: string
  updated_at: string
}

interface RawCategory {
  id: string
  name: string
  description: string
  sort_order: number
  is_visible: number
  created_at: string
  updated_at: string
}

interface RawTemplate extends Omit<CreativeTemplate, 'example_ref_images' | 'variables'> {
  example_ref_images: string
  variables: string
}

interface NormalizedVariableResult {
  variables: CreativeTemplateVariable[]
  keyMap: Map<string, string>
  usedKeys: Set<string>
}

const FIELD_TYPES: CreativeTemplateFieldType[] = ['text', 'textarea', 'select', 'multi_select']

const UPLOAD_DIR_NAME = 'creative-template-uploads'
const OPTIONAL_EMPTY_MARKER = '\uE000'

// ────── 工具 ──────

function safeParseArray<T>(value: string | null | undefined, fallback: T[]): T[] {
  if (!value) return fallback
  try {
    const v = JSON.parse(value)
    return Array.isArray(v) ? (v as T[]) : fallback
  } catch {
    return fallback
  }
}

function normalizeVariableEntries(input: unknown): NormalizedVariableResult {
  if (!Array.isArray(input)) return { variables: [], keyMap: new Map(), usedKeys: new Set() }
  const result: CreativeTemplateVariable[] = []
  const keyMap = new Map<string, string>()
  const usedKeys = new Set<string>()
  for (let i = 0; i < input.length && result.length < 10; i++) {
    const raw = input[i] as Record<string, unknown>
    if (!raw || typeof raw !== 'object') continue
    const rawKey = String(raw.key || '').trim()
    const key = normalizeVariableKey(rawKey, `field_${i + 1}`, usedKeys)
    if (rawKey) keyMap.set(rawKey, key)
    keyMap.set(key, key)
    let type = String(raw.type || 'text') as CreativeTemplateFieldType
    if (!FIELD_TYPES.includes(type)) type = 'text'
    const options = Array.isArray(raw.options)
      ? Array.from(new Set(
          (raw.options as unknown[])
            .map(o => String(o).trim())
            .filter(o => o.length > 0)
            .slice(0, 20)
        ))
      : []
    if ((type === 'select' || type === 'multi_select') && options.length === 0) {
      type = 'text'
    }
    result.push({
      key,
      label: String(raw.label || key).slice(0, 30) || key,
      type,
      required: Boolean(raw.required ?? true),
      placeholder: String(raw.placeholder || '').slice(0, 120),
      default: String(raw.default || '').slice(0, 500),
      options,
    })
  }
  return { variables: result, keyMap, usedKeys }
}

function normalizeVariableKey(value: string, fallback: string, usedKeys: Set<string>): string {
  let key = value.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_')
  if (!key) key = fallback
  if (!/^[a-z]/.test(key)) key = `field_${key}`
  if (!/^[a-z][a-z0-9_]*$/.test(key)) key = fallback
  const base = key
  let suffix = 2
  while (usedKeys.has(key)) {
    key = `${base}_${suffix}`
    suffix++
  }
  usedKeys.add(key)
  return key
}

function normalizeTemplateContent(promptTemplate: unknown, inputVariables: unknown): { prompt_template: string; variables: CreativeTemplateVariable[] } {
  const normalized = normalizeVariableEntries(inputVariables)
  const prompt = String(promptTemplate || '').replace(/\{\{\s*([^{}\r\n]+?)\s*\}\}/g, (_match, rawName) => {
    const rawKey = String(rawName || '').trim()
    let key = normalized.keyMap.get(rawKey)
    if (!key && normalized.variables.length < 10) {
      key = normalizeVariableKey(rawKey, `field_${normalized.variables.length + 1}`, normalized.usedKeys)
      normalized.keyMap.set(rawKey, key)
      normalized.keyMap.set(key, key)
      normalized.variables.push({
        key,
        label: String(rawKey || key).slice(0, 30) || key,
        type: 'text',
        required: true,
        placeholder: '',
        default: '',
        options: [],
      })
    }
    return key ? `{{${key}}}` : ''
  })
  const usedKeys = new Set(extractPlaceholders(prompt).filter((key) => /^[a-z][a-z0-9_]*$/.test(key)))
  return {
    prompt_template: prompt,
    variables: normalized.variables.filter((v) => usedKeys.has(v.key)),
  }
}

function extractPlaceholders(text: string): string[] {
  return Array.from(text.matchAll(/\{\{\s*([^{}\r\n]+?)\s*\}\}/g))
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean)
}

function normalizeRefImages(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const item of input) {
    if (typeof item !== 'string') continue
    const v = item.trim()
    if (v && !out.includes(v)) out.push(v)
    if (out.length >= 8) break
  }
  return out
}

function rowToCategory(row: RawCategory): CreativeTemplateCategory {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    sort_order: row.sort_order || 0,
    is_visible: row.is_visible ? 1 : 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function rowToTemplate(row: RawTemplate): CreativeTemplate {
  const content = normalizeTemplateContent(row.prompt_template, safeParseArray<CreativeTemplateVariable>(row.variables, []))
  return {
    id: row.id,
    category_id: row.category_id,
    title: row.title,
    description: row.description || '',
    cover_image: row.cover_image || '',
    example_ref_images: safeParseArray<string>(row.example_ref_images, []),
    requires_ref_image: row.requires_ref_image ? 1 : 0,
    default_size: row.default_size || '',
    prompt_template: content.prompt_template,
    variables: content.variables,
    source_type: (row.source_type as CreativeTemplateSource) || 'manual',
    source_image: row.source_image || '',
    source_inspiration_id: row.source_inspiration_id || '',
    cloud_template_id: Number(row.cloud_template_id) || 0,
    submission_status: (row.submission_status as CreativeTemplateSubmissionStatus) || '',
    submission_reject_reason: row.submission_reject_reason || '',
    submission_reviewed_at: row.submission_reviewed_at || '',
    submission_published_at: row.submission_published_at || '',
    submission_synced_at: row.submission_synced_at || '',
    sort_order: row.sort_order || 0,
    is_visible: row.is_visible ? 1 : 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

// ────── 文件持久化（封面 / 参考图 / 反推源图） ──────

const SUPPORTED_MIMES: Record<string, string> = {
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpg',
  webp: 'webp',
  gif: 'gif',
}

function uploadDir(): string {
  const dir = join(getDataDir(), UPLOAD_DIR_NAME)
  try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
  return dir
}

/**
 * 把 data URI / 远程 URL / 已是绝对路径的图像统一落到本地 dataDir/UPLOAD_DIR_NAME。
 * 已是本地绝对路径或 http(s)/file URL 时原样返回（不复制，避免占用磁盘）。
 * 桌面端「云端模板」拉到的 http(s) URL 直接保留；本地编辑器粘贴/上传时通常是 data URI。
 */
export async function persistImageInput(value: string): Promise<string> {
  if (!value) return ''
  if (value.startsWith('data:')) {
    const match = /^data:image\/([a-zA-Z]+);base64,(.+)$/.exec(value)
    if (!match) return ''
    const ext = SUPPORTED_MIMES[match[1].toLowerCase()] || 'png'
    const buf = Buffer.from(match[2], 'base64')
    const filename = `${Date.now()}_${uuid().slice(0, 8)}.${ext}`
    const full = join(uploadDir(), filename)
    writeFileSync(full, buf)
    return full
  }
  return value
}

async function persistManyImageInputs(items: string[]): Promise<string[]> {
  const out: string[] = []
  for (const item of items.slice(0, 8)) {
    const stored = await persistImageInput(item)
    if (stored) out.push(stored)
  }
  return out
}

/**
 * 只删除本地 UPLOAD_DIR_NAME 下的文件（保护：不会删 http(s)、其它目录的本地路径）。
 * 删除策略与云控端一致，避免误删用户图库或灵感图。
 */
function tryDeleteLocalUpload(path: string): void {
  if (!path) return
  if (/^https?:|^data:/.test(path)) return
  const localDir = uploadDir()
  if (!path.startsWith(localDir)) return
  try { if (existsSync(path)) unlinkSync(path) } catch { /* ignore */ }
}

function diffRemovedRefs(oldRefs: string[], newRefs: string[]): void {
  const next = new Set(newRefs)
  for (const ref of oldRefs) {
    if (!next.has(ref)) tryDeleteLocalUpload(ref)
  }
}

// ────── 分类 CRUD ──────

export function listCategories(): CreativeTemplateCategory[] {
  const db = getDatabase()
  const rows = db
    .prepare('SELECT * FROM creative_template_categories ORDER BY sort_order ASC, created_at ASC')
    .all() as RawCategory[]
  return rows.map(rowToCategory)
}

export function getCategory(id: string): CreativeTemplateCategory | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM creative_template_categories WHERE id = ?').get(id) as RawCategory | undefined
  return row ? rowToCategory(row) : null
}

export interface CategoryInput {
  name: string
  description?: string
  sort_order?: number
  is_visible?: boolean | number
}

export function createCategory(data: CategoryInput): CreativeTemplateCategory {
  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO creative_template_categories (id, name, description, sort_order, is_visible, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    String(data.name || '未命名分类').slice(0, 50),
    String(data.description || '').slice(0, 500),
    Number(data.sort_order) || 0,
    data.is_visible === false || data.is_visible === 0 ? 0 : 1,
    now,
    now,
  )
  return getCategory(id)!
}

export function updateCategory(id: string, data: Partial<CategoryInput>): CreativeTemplateCategory | null {
  const cat = getCategory(id)
  if (!cat) return null
  const db = getDatabase()
  const sets: string[] = []
  const params: unknown[] = []
  if (data.name !== undefined) { sets.push('name = ?'); params.push(String(data.name).slice(0, 50)) }
  if (data.description !== undefined) { sets.push('description = ?'); params.push(String(data.description).slice(0, 500)) }
  if (data.sort_order !== undefined) { sets.push('sort_order = ?'); params.push(Number(data.sort_order) || 0) }
  if (data.is_visible !== undefined) { sets.push('is_visible = ?'); params.push(data.is_visible === false || data.is_visible === 0 ? 0 : 1) }
  if (!sets.length) return cat
  sets.push('updated_at = ?')
  params.push(new Date().toISOString())
  params.push(id)
  db.prepare(`UPDATE creative_template_categories SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  return getCategory(id)
}

export function deleteCategory(id: string): boolean {
  const cat = getCategory(id)
  if (!cat) return false
  // 收集级联删除前的模板文件清单，删除后再清理
  const templates = listTemplates({ categoryId: id })
  const db = getDatabase()
  const result = db.prepare('DELETE FROM creative_template_categories WHERE id = ?').run(id)
  if (result.changes > 0) {
    for (const t of templates) {
      cleanupTemplateFiles(t)
    }
  }
  return result.changes > 0
}

// ────── 模板 CRUD ──────

export interface TemplateInput {
  category_id: string
  title: string
  description?: string
  cover_image?: string
  example_ref_images?: string[]
  requires_ref_image?: boolean | number
  default_size?: string
  prompt_template: string
  variables: CreativeTemplateVariable[] | unknown[]
  source_type?: CreativeTemplateSource
  source_image?: string
  source_inspiration_id?: string
  sort_order?: number
  is_visible?: boolean | number
}

export interface TemplateSubmissionStateInput {
  cloudTemplateId?: number
  status?: CreativeTemplateSubmissionStatus
  rejectReason?: string
  reviewedAt?: string
  publishedAt?: string
}

export interface ListTemplatesOptions {
  categoryId?: string
  search?: string
  visibleOnly?: boolean
}

export function listTemplates(options: ListTemplatesOptions = {}): CreativeTemplate[] {
  const db = getDatabase()
  const where: string[] = []
  const params: unknown[] = []
  if (options.categoryId) { where.push('category_id = ?'); params.push(options.categoryId) }
  if (options.visibleOnly) { where.push('is_visible = 1') }
  if (options.search) {
    where.push('(title LIKE ? OR description LIKE ? OR prompt_template LIKE ?)')
    const pat = `%${options.search}%`
    params.push(pat, pat, pat)
  }
  const sql = `SELECT * FROM creative_templates${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY sort_order ASC, created_at DESC`
  const rows = db.prepare(sql).all(...params) as RawTemplate[]
  return rows.map(rowToTemplate)
}

export function getTemplate(id: string): CreativeTemplate | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM creative_templates WHERE id = ?').get(id) as RawTemplate | undefined
  return row ? rowToTemplate(row) : null
}

export async function createTemplate(data: TemplateInput): Promise<CreativeTemplate> {
  const cat = getCategory(data.category_id)
  if (!cat) throw new Error('分类不存在或已被删除')
  const id = uuid()
  const now = new Date().toISOString()
  const cover = await persistImageInput(String(data.cover_image || ''))
  const sourceImage = await persistImageInput(String(data.source_image || ''))
  const refs = await persistManyImageInputs(normalizeRefImages(data.example_ref_images))
  const content = normalizeTemplateContent(data.prompt_template, data.variables)
  const db = getDatabase()
  db.prepare(
    `INSERT INTO creative_templates (
      id, category_id, title, description, cover_image, example_ref_images, default_size,
      requires_ref_image, prompt_template, variables, source_type, source_image, source_inspiration_id,
      sort_order, is_visible, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.category_id,
    String(data.title || '未命名模板').slice(0, 100),
    String(data.description || '').slice(0, 500),
    cover || (refs[0] || ''),
    JSON.stringify(refs),
    String(data.default_size || '').slice(0, 50),
    data.requires_ref_image === true || data.requires_ref_image === 1 ? 1 : 0,
    content.prompt_template,
    JSON.stringify(content.variables),
    (data.source_type as CreativeTemplateSource) || 'manual',
    sourceImage,
    String(data.source_inspiration_id || '').slice(0, 100),
    Number(data.sort_order) || 0,
    data.is_visible === false || data.is_visible === 0 ? 0 : 1,
    now,
    now,
  )
  return getTemplate(id)!
}

export async function updateTemplate(id: string, data: Partial<TemplateInput>): Promise<CreativeTemplate | null> {
  const existing = getTemplate(id)
  if (!existing) return null
  if (data.category_id && !getCategory(data.category_id)) {
    throw new Error('目标分类不存在')
  }
  const db = getDatabase()
  const sets: string[] = []
  const params: unknown[] = []
  if (data.category_id !== undefined) { sets.push('category_id = ?'); params.push(data.category_id) }
  if (data.title !== undefined) { sets.push('title = ?'); params.push(String(data.title).slice(0, 100)) }
  if (data.description !== undefined) { sets.push('description = ?'); params.push(String(data.description).slice(0, 500)) }

  let newCover = existing.cover_image
  if (data.cover_image !== undefined) {
    newCover = await persistImageInput(String(data.cover_image || ''))
    sets.push('cover_image = ?')
    params.push(newCover)
  }

  let newRefs = existing.example_ref_images
  if (data.example_ref_images !== undefined) {
    newRefs = await persistManyImageInputs(normalizeRefImages(data.example_ref_images))
    sets.push('example_ref_images = ?')
    params.push(JSON.stringify(newRefs))
  }
  if (data.requires_ref_image !== undefined) { sets.push('requires_ref_image = ?'); params.push(data.requires_ref_image === true || data.requires_ref_image === 1 ? 1 : 0) }
  if (data.default_size !== undefined) { sets.push('default_size = ?'); params.push(String(data.default_size).slice(0, 50)) }
  if (data.prompt_template !== undefined || data.variables !== undefined) {
    const content = normalizeTemplateContent(
      data.prompt_template !== undefined ? data.prompt_template : existing.prompt_template,
      data.variables !== undefined ? data.variables : existing.variables
    )
    sets.push('prompt_template = ?')
    params.push(content.prompt_template)
    sets.push('variables = ?')
    params.push(JSON.stringify(content.variables))
  }
  if (data.source_type !== undefined) { sets.push('source_type = ?'); params.push(data.source_type) }
  let newSourceImage = existing.source_image
  if (data.source_image !== undefined) {
    newSourceImage = await persistImageInput(String(data.source_image || ''))
    sets.push('source_image = ?')
    params.push(newSourceImage)
  }
  if (data.source_inspiration_id !== undefined) { sets.push('source_inspiration_id = ?'); params.push(String(data.source_inspiration_id || '').slice(0, 100)) }
  if (data.sort_order !== undefined) { sets.push('sort_order = ?'); params.push(Number(data.sort_order) || 0) }
  if (data.is_visible !== undefined) { sets.push('is_visible = ?'); params.push(data.is_visible === false || data.is_visible === 0 ? 0 : 1) }
  const contentChanged = [
    'category_id',
    'title',
    'description',
    'cover_image',
    'example_ref_images',
    'requires_ref_image',
    'default_size',
    'prompt_template',
    'variables',
    'source_type',
    'source_image',
    'source_inspiration_id',
  ].some((key) => Object.prototype.hasOwnProperty.call(data, key))
  if (contentChanged) {
    sets.push('cloud_template_id = ?')
    params.push(0)
    sets.push('submission_status = ?')
    params.push('')
    sets.push('submission_reject_reason = ?')
    params.push('')
    sets.push('submission_reviewed_at = ?')
    params.push('')
    sets.push('submission_published_at = ?')
    params.push('')
    sets.push('submission_synced_at = ?')
    params.push('')
  }
  if (!sets.length) return existing
  sets.push('updated_at = ?')
  params.push(new Date().toISOString())
  params.push(id)
  db.prepare(`UPDATE creative_templates SET ${sets.join(', ')} WHERE id = ?`).run(...params)

  if (data.cover_image !== undefined && existing.cover_image && existing.cover_image !== newCover) {
    tryDeleteLocalUpload(existing.cover_image)
  }
  if (data.example_ref_images !== undefined) {
    diffRemovedRefs(existing.example_ref_images, newRefs)
  }
  if (data.source_image !== undefined && existing.source_image && existing.source_image !== newSourceImage) {
    tryDeleteLocalUpload(existing.source_image)
  }
  return getTemplate(id)
}

export function updateTemplateSubmissionState(id: string, state: TemplateSubmissionStateInput): CreativeTemplate | null {
  const existing = getTemplate(id)
  if (!existing) return null
  const db = getDatabase()
  db.prepare(
    `UPDATE creative_templates
     SET cloud_template_id = ?,
         submission_status = ?,
         submission_reject_reason = ?,
         submission_reviewed_at = ?,
         submission_published_at = ?,
         submission_synced_at = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    Number(state.cloudTemplateId ?? existing.cloud_template_id ?? 0) || 0,
    String(state.status ?? existing.submission_status ?? '').slice(0, 30),
    String(state.rejectReason ?? existing.submission_reject_reason ?? '').slice(0, 500),
    String(state.reviewedAt ?? existing.submission_reviewed_at ?? ''),
    String(state.publishedAt ?? existing.submission_published_at ?? ''),
    new Date().toISOString(),
    new Date().toISOString(),
    id,
  )
  return getTemplate(id)
}

export function deleteTemplate(id: string): boolean {
  const existing = getTemplate(id)
  if (!existing) return false
  const db = getDatabase()
  const result = db.prepare('DELETE FROM creative_templates WHERE id = ?').run(id)
  if (result.changes > 0) cleanupTemplateFiles(existing)
  return result.changes > 0
}

function cleanupTemplateFiles(template: CreativeTemplate): void {
  if (template.cover_image) tryDeleteLocalUpload(template.cover_image)
  if (template.source_image) tryDeleteLocalUpload(template.source_image)
  for (const ref of template.example_ref_images || []) tryDeleteLocalUpload(ref)
}

/**
 * 渲染模板提示词。
 * 简单实现：把所有 {{key}} 占位符按 values 替换；未填写的变量保留原占位符避免静默丢失。
 */
export function renderTemplatePrompt(template: CreativeTemplate, values: Record<string, unknown>): string {
  const raw = template.prompt_template || ''
  const variableMap = new Map(template.variables.map((v) => [v.key, v]))
  const rendered = raw.replace(/\{\{\s*([^{}\r\n]+?)\s*\}\}/g, (match: string, rawKey: string) => {
    const key = String(rawKey || '').trim()
    const variable = variableMap.get(key)
    const v = values[key]
    if (v === undefined || v === null) return variable && !variable.required ? OPTIONAL_EMPTY_MARKER : match
    if (Array.isArray(v)) {
      const joined = v.map((x) => String(x).trim()).filter(Boolean).join(', ')
      return joined || (variable && !variable.required ? OPTIONAL_EMPTY_MARKER : match)
    }
    const s = String(v).trim()
    return s || (variable && !variable.required ? OPTIONAL_EMPTY_MARKER : match)
  })
  return cleanupRenderedPrompt(rendered)
}

function cleanupRenderedPrompt(text: string): string {
  const markerPattern = new RegExp(`(^|[，,；;、])[^，,；;、\\n]*${OPTIONAL_EMPTY_MARKER}[^，,；;、\\n]*`, 'g')
  const markerOnlyPattern = new RegExp(OPTIONAL_EMPTY_MARKER, 'g')
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(markerPattern, '').replace(markerOnlyPattern, '').replace(/^[\s，,；;、]+|[\s，,；;、]+$/g, '').trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * 渲染时如果模板要求 required 字段缺失，返回缺失的字段 key 列表。
 */
export function findMissingRequired(template: CreativeTemplate, values: Record<string, unknown>): string[] {
  const missing: string[] = []
  for (const v of template.variables) {
    if (!v.required) continue
    const raw = values[v.key]
    if (raw === undefined || raw === null) { missing.push(v.key); continue }
    if (Array.isArray(raw) && raw.length === 0) { missing.push(v.key); continue }
    if (typeof raw === 'string' && raw.trim() === '') { missing.push(v.key); continue }
  }
  return missing
}

/**
 * 把模板拷贝到「我的模板」（用户对云端模板「另存到本地」时使用）。
 * 远程图直接保留 URL 不下载，保持简单；用户后续编辑时如果改了再走 persistImageInput。
 */
export async function importTemplateAsLocal(
  source: Partial<CreativeTemplate>,
  targetCategoryId: string
): Promise<CreativeTemplate> {
  const cat = getCategory(targetCategoryId)
  if (!cat) throw new Error('目标分类不存在')
  const title = String(source.title || '新模板').slice(0, 100)
  return await createTemplate({
    category_id: targetCategoryId,
    title,
    description: source.description || '',
    cover_image: source.cover_image || '',
    example_ref_images: normalizeRefImages(source.example_ref_images || []),
    requires_ref_image: source.requires_ref_image || 0,
    default_size: source.default_size || '',
    prompt_template: source.prompt_template || '',
    variables: source.variables || [],
    source_type: 'manual',
    source_image: '',
    source_inspiration_id: '',
    sort_order: 0,
    is_visible: true,
  })
}

// ────── seed 数据：首次启动给本地一个默认分类 ──────

export function seedCreativeTemplatePresets(): void {
  const cats = listCategories()
  if (cats.length > 0) return
  createCategory({
    name: '我的模板',
    description: '默认本地分类，用于保存常用的提示词模板',
    sort_order: 0,
    is_visible: true,
  })
}

// 文件名 helper（IPC 上传时拿到文件名时用）
export function suggestFilenameForUpload(originalName: string): string {
  const base = basename(originalName || '').replace(/[^a-zA-Z0-9_.-]/g, '_')
  return `${Date.now()}_${uuid().slice(0, 8)}_${base || 'upload.png'}`
}
