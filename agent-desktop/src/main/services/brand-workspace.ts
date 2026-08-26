import { getDatabase } from '../database'
import { v4 as uuid } from 'uuid'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getDataDir } from './data-path'
import * as knowledgeService from './knowledge'
import * as galleryService from './gallery'

export interface BrandWorkspace {
  id: string
  name: string
  description: string
  kb_category_id: string
  gallery_category_id: string
  output_dir: string
  default_bot_id: string
  sort_order: number
  created_at: string
  updated_at: string
}

function rowToBrand(row: any): BrandWorkspace {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    kb_category_id: row.kb_category_id || '',
    gallery_category_id: row.gallery_category_id || '',
    output_dir: row.output_dir || '',
    default_bot_id: row.default_bot_id || '',
    sort_order: Number(row.sort_order || 0),
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

function ensureDir(dir: string): void {
  if (!dir) return
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  } catch (e) {
    console.error('[brand-workspace] ensureDir failed:', dir, e)
  }
}

function ensureBrandWorkspaceTable(): void {
  const db = getDatabase()
  db.exec(`
    CREATE TABLE IF NOT EXISTS brand_workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      kb_category_id TEXT NOT NULL DEFAULT '',
      gallery_category_id TEXT NOT NULL DEFAULT '',
      output_dir TEXT NOT NULL DEFAULT '',
      default_bot_id TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_brand_workspaces_updated ON brand_workspaces(updated_at DESC);
  `)
}

export function listBrandWorkspaces(): BrandWorkspace[] {
  ensureBrandWorkspaceTable()
  const db = getDatabase()
  const rows = db
    .prepare('SELECT * FROM brand_workspaces ORDER BY sort_order ASC, updated_at DESC')
    .all() as any[]
  return rows.map(rowToBrand)
}

export function getBrandWorkspace(id: string): BrandWorkspace | null {
  ensureBrandWorkspaceTable()
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM brand_workspaces WHERE id = ?').get(id) as any
  return row ? rowToBrand(row) : null
}

/**
 * 新建品牌工作区：自动创建配套的文档知识库分类、图库分类、本机产出目录。
 */
export function createBrandWorkspace(data: {
  name: string
  description?: string
  default_bot_id?: string
}): BrandWorkspace {
  ensureBrandWorkspaceTable()
  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()
  const name = (data.name || '').trim() || '未命名品牌'
  const description = data.description || ''

  const kb = knowledgeService.createCategory({
    name: `品牌·${name}`,
    description: `品牌工作区「${name}」的文档规范（色值/话术/禁忌等）`
  })
  const gallery = galleryService.createCategory({
    name: `品牌·${name}`,
    description: `品牌工作区「${name}」的视觉素材`
  })

  const outputDir = join(getDataDir(), 'brand-workspaces', id, 'output')
  ensureDir(outputDir)

  db.prepare(
    `INSERT INTO brand_workspaces
      (id, name, description, kb_category_id, gallery_category_id, output_dir, default_bot_id, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    name,
    description,
    kb.id,
    gallery.id,
    outputDir,
    data.default_bot_id || '',
    0,
    now,
    now
  )

  const created = getBrandWorkspace(id)
  if (!created) throw new Error('品牌工作区写入后读取失败')
  return created
}

export function updateBrandWorkspace(
  id: string,
  data: Partial<{
    name: string
    description: string
    output_dir: string
    default_bot_id: string
    sort_order: number
  }>
): BrandWorkspace | null {
  const existing = getBrandWorkspace(id)
  if (!existing) return null
  const db = getDatabase()
  const name = data.name !== undefined ? data.name.trim() || existing.name : existing.name
  const description = data.description !== undefined ? data.description : existing.description
  const outputDir = data.output_dir !== undefined ? data.output_dir : existing.output_dir
  const defaultBotId = data.default_bot_id !== undefined ? data.default_bot_id : existing.default_bot_id
  const sortOrder = data.sort_order !== undefined ? data.sort_order : existing.sort_order
  const now = new Date().toISOString()

  if (outputDir) ensureDir(outputDir)

  db.prepare(
    `UPDATE brand_workspaces
     SET name=?, description=?, output_dir=?, default_bot_id=?, sort_order=?, updated_at=?
     WHERE id=?`
  ).run(name, description, outputDir, defaultBotId, sortOrder, now, id)

  // 同步 KB / 图库分类显示名（尽量与品牌名一致）
  if (data.name !== undefined) {
    try {
      if (existing.kb_category_id) {
        knowledgeService.updateCategory(existing.kb_category_id, {
          name: `品牌·${name}`,
          description: `品牌工作区「${name}」的文档规范（色值/话术/禁忌等）`
        })
      }
      if (existing.gallery_category_id) {
        galleryService.updateCategory(existing.gallery_category_id, {
          name: `品牌·${name}`,
          description: `品牌工作区「${name}」的视觉素材`
        })
      }
    } catch (e) {
      console.error('[brand-workspace] sync category names failed:', e)
    }
  }

  return getBrandWorkspace(id)
}

/**
 * 删除品牌工作区。不级联删 KB/图库内容（避免误删用户素材）；会话上的 brand_workspace_id 置空。
 */
export function deleteBrandWorkspace(id: string): boolean {
  const db = getDatabase()
  const existing = getBrandWorkspace(id)
  if (!existing) return false

  try {
    const convCols = db.prepare('PRAGMA table_info(conversations)').all() as any[]
    if (convCols.some((c) => c.name === 'brand_workspace_id')) {
      db.prepare("UPDATE conversations SET brand_workspace_id='' WHERE brand_workspace_id=?").run(id)
    }
  } catch (e) {
    console.error('[brand-workspace] clear conversation links failed:', e)
  }

  const result = db.prepare('DELETE FROM brand_workspaces WHERE id = ?').run(id)
  return result.changes > 0
}

export function touchBrandWorkspace(id: string): void {
  const db = getDatabase()
  db.prepare('UPDATE brand_workspaces SET updated_at=? WHERE id=?').run(new Date().toISOString(), id)
}
