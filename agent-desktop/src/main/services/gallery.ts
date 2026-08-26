import { getDatabase } from '../database'
import { v4 as uuid } from 'uuid'
import { existsSync, statSync, readdirSync, mkdirSync, writeFileSync } from 'fs'
import { join, basename, extname } from 'path'
import { probeImage } from './image-probe'
import { getDataDir } from './data-path'

// ────── Types ──────

export interface GalleryCategory {
  id: string
  name: string
  description: string
  is_system: number
  sort_order: number
  created_at: string
}

export interface GalleryItem {
  id: string
  category_id: string
  name: string
  file_path: string
  file_type: string
  file_size: number
  width: number
  height: number
  source: string
  folder_root: string
  folder_recursive: number
  created_at: string
}

export interface PagedResult<T> {
  items: T[]
  total: number
}

const SYSTEM_CREATION_ID = '__sys_creation__'
const SYSTEM_MATTING_ID  = '__sys_matting__'
const SYSTEM_FINE_MATTING_ID = '__sys_fine_matting__'

export const GALLERY_SYSTEM_IDS = {
  CREATION: SYSTEM_CREATION_ID,
  MATTING:  SYSTEM_MATTING_ID,
  FINE_MATTING: SYSTEM_FINE_MATTING_ID,
}

const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'
])

function isImageFile(name: string): boolean {
  const ext = extname(name).slice(1).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

// ────── Category CRUD ──────

export function listCategories(): GalleryCategory[] {
  const db = getDatabase()
  return db
    .prepare('SELECT * FROM gallery_categories ORDER BY sort_order ASC, created_at ASC')
    .all() as GalleryCategory[]
}

export function getCategory(id: string): GalleryCategory | null {
  const db = getDatabase()
  return (db.prepare('SELECT * FROM gallery_categories WHERE id = ?').get(id) as GalleryCategory) || null
}

export function createCategory(data: { name: string; description?: string }): GalleryCategory {
  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO gallery_categories (id, name, description, is_system, sort_order, created_at) VALUES (?, ?, ?, 0, 0, ?)'
  ).run(id, data.name, data.description || '', now)
  return getCategory(id)!
}

export function updateCategory(id: string, data: { name?: string; description?: string }): GalleryCategory | null {
  const db = getDatabase()
  const cat = getCategory(id)
  if (!cat) return null
  if (cat.is_system) throw new Error('系统分类不可编辑')
  const sets: string[] = []
  const params: any[] = []
  if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name) }
  if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description) }
  if (!sets.length) return cat
  params.push(id)
  db.prepare(`UPDATE gallery_categories SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  return getCategory(id)
}

export function deleteCategory(id: string): boolean {
  const db = getDatabase()
  const cat = getCategory(id)
  if (!cat) return false
  if (cat.is_system) throw new Error('系统分类不可删除')
  const result = db.prepare('DELETE FROM gallery_categories WHERE id = ?').run(id)
  return result.changes > 0
}

export function getCategoryItemCount(categoryId: string): number {
  const db = getDatabase()
  const row = db.prepare('SELECT COUNT(*) as cnt FROM gallery_items WHERE category_id = ?').get(categoryId) as any
  return row?.cnt || 0
}

// ────── Item CRUD ──────

export function listItemsPaged(
  categoryId: string | null,
  search: string,
  page: number,
  pageSize: number
): PagedResult<GalleryItem> {
  const db = getDatabase()
  let countSql = 'SELECT COUNT(*) as total FROM gallery_items WHERE 1=1'
  let querySql = 'SELECT * FROM gallery_items WHERE 1=1'
  const params: any[] = []

  if (categoryId) {
    countSql += ' AND category_id = ?'
    querySql += ' AND category_id = ?'
    params.push(categoryId)
  }
  if (search) {
    countSql += ' AND name LIKE ?'
    querySql += ' AND name LIKE ?'
    params.push(`%${search}%`)
  }

  querySql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
  const total = (db.prepare(countSql).get(...params) as any).total
  const offset = (page - 1) * pageSize
  const items = db.prepare(querySql).all(...params, pageSize, offset) as GalleryItem[]
  return { items, total }
}

export function getItem(id: string): GalleryItem | null {
  const db = getDatabase()
  return (db.prepare('SELECT * FROM gallery_items WHERE id = ?').get(id) as GalleryItem) || null
}

/**
 * 添加单张图片到指定分类。
 * filePath 必须是绝对路径。同分类+同路径去重。
 */
export function addFile(categoryId: string, filePath: string): GalleryItem | null {
  const db = getDatabase()
  // 去重：同分类同路径
  const existing = db
    .prepare('SELECT id FROM gallery_items WHERE category_id = ? AND file_path = ?')
    .get(categoryId, filePath) as any
  if (existing) return getItem(existing.id)

  const name = basename(filePath)
  const ext = extname(filePath).slice(1).toLowerCase()
  const probe = probeImage(filePath)
  const id = uuid()
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO gallery_items (id, category_id, name, file_path, file_type, file_size, width, height, source, folder_root, folder_recursive, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'file', '', 0, ?)`
  ).run(id, categoryId, name, filePath, ext, probe.size, probe.width, probe.height, now)

  return getItem(id)
}

/**
 * 批量导入文件夹中的图片到指定分类。
 * recursive=true 时穿透子文件夹。
 *
 * 性能优化：
 *  1) 先递归 readdir 收集候选文件路径（无 DB 操作）
 *  2) 一次性 SELECT 拉出该分类所有 file_path 做内存去重，避免 N 次 SELECT
 *  3) 所有 INSERT 包在单事务里 — 让 SQLite 一次 fsync 而非 N 次
 *  4) probeImage 仍是 per-file IO，但与 N 次 fsync 相比已不是瓶颈
 */
export function addFolder(
  categoryId: string,
  folderPath: string,
  recursive: boolean
): { added: number; skipped: number } {
  const db = getDatabase()

  // 1. 收集候选文件路径
  const candidates: string[] = []
  function scanDir(dir: string): void {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory() && recursive) {
          scanDir(fullPath)
        } else if (stat.isFile() && isImageFile(entry)) {
          candidates.push(fullPath)
        }
      } catch {
        // 跳过无法访问的条目
      }
    }
  }
  scanDir(folderPath)

  if (!candidates.length) return { added: 0, skipped: 0 }

  // 2. 一次性预加载该分类已有路径，做内存去重
  const existingRows = db
    .prepare('SELECT file_path FROM gallery_items WHERE category_id = ?')
    .all(categoryId) as { file_path: string }[]
  const existing = new Set(existingRows.map((r) => r.file_path))

  // 3. 准备待插入数据（probe 在事务外进行，避免长事务持锁）
  type Row = {
    id: string
    name: string
    fullPath: string
    ext: string
    size: number
    width: number
    height: number
    now: string
  }
  const rows: Row[] = []
  let skipped = 0
  const recursiveFlag = recursive ? 1 : 0
  for (const fullPath of candidates) {
    if (existing.has(fullPath)) {
      skipped++
      continue
    }
    try {
      const probe = probeImage(fullPath)
      const name = basename(fullPath)
      rows.push({
        id: uuid(),
        name,
        fullPath,
        ext: extname(name).slice(1).toLowerCase(),
        size: probe.size,
        width: probe.width,
        height: probe.height,
        now: new Date().toISOString()
      })
    } catch {
      skipped++
    }
  }

  if (!rows.length) return { added: 0, skipped }

  // 4. 单事务批量插入
  const stmt = db.prepare(
    `INSERT INTO gallery_items (id, category_id, name, file_path, file_type, file_size, width, height, source, folder_root, folder_recursive, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'folder', ?, ?, ?)`
  )
  const insertMany = db.transaction((data: Row[]) => {
    for (const r of data) {
      stmt.run(r.id, categoryId, r.name, r.fullPath, r.ext, r.size, r.width, r.height, folderPath, recursiveFlag, r.now)
    }
  })
  insertMany(rows)

  return { added: rows.length, skipped }
}

/**
 * 移除图库项（仅删记录，不碰磁盘文件）
 */
export function removeItems(ids: string[]): number {
  if (!ids.length) return 0
  const db = getDatabase()
  const placeholders = ids.map(() => '?').join(',')
  const result = db.prepare(`DELETE FROM gallery_items WHERE id IN (${placeholders})`).run(...ids)
  return result.changes
}

/**
 * 按 file_path 移除图库项（用于联动删除：我的创作删除 → 同步删图库记录）。
 * 幂等：若不存在则返回 0。
 */
export function removeByFilePath(filePath: string): number {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM gallery_items WHERE file_path = ?').run(filePath)
  return result.changes
}

/**
 * 按 file_path（相对路径）移除图库项。
 * image_generations 存的是相对路径，需要拼接数据目录后匹配。
 */
export function removeByRelativePath(relPath: string): number {
  if (!relPath) return 0
  const isAbsolute = /^[A-Za-z]:|^\//.test(relPath)
  const absPath = isAbsolute ? relPath : join(getDataDir(), relPath)
  return removeByFilePath(absPath)
}

/**
 * 同步检测：检查图片文件是否仍然存在，删除失效记录。
 * categoryId 为空时扫全部。
 */
export function sync(categoryId?: string): { removed: number; checked: number } {
  const db = getDatabase()
  let sql = 'SELECT id, file_path FROM gallery_items'
  const params: any[] = []
  if (categoryId) {
    sql += ' WHERE category_id = ?'
    params.push(categoryId)
  }
  const items = db.prepare(sql).all(...params) as { id: string; file_path: string }[]
  const toRemove: string[] = []

  for (const item of items) {
    if (!existsSync(item.file_path)) {
      toRemove.push(item.id)
    }
  }

  if (toRemove.length > 0) {
    const placeholders = toRemove.map(() => '?').join(',')
    db.prepare(`DELETE FROM gallery_items WHERE id IN (${placeholders})`).run(...toRemove)
  }

  return { removed: toRemove.length, checked: items.length }
}

/**
 * O4: 从 data URI 把图片存到磁盘并入库。
 * - 解析 data:image/{png|jpeg|webp|gif|bmp};base64,... 提取 MIME + 数据
 * - 在 dataDir/gallery-uploads/ 下生成唯一文件名（uuid + 扩展名）
 * - 写入磁盘，然后调 addFile 写入指定分类
 * - displayName 仅用作 UI 提示，不进文件名，避免非法字符 / 编码问题
 *
 * 返回值：GalleryItem 或 null（解析失败 / 写盘失败）
 */
export function addFromDataUri(categoryId: string, dataUri: string, displayName: string): GalleryItem | null {
  const m = /^data:image\/(png|jpeg|jpg|webp|gif|bmp);base64,(.+)$/i.exec(dataUri)
  if (!m) return null
  const mime = m[1].toLowerCase()
  const ext = mime === 'jpeg' ? 'jpg' : mime
  const b64 = m[2]
  let buf: Buffer
  try { buf = Buffer.from(b64, 'base64') } catch { return null }
  if (buf.length === 0) return null

  const dir = join(getDataDir(), 'gallery-uploads')
  try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
  const filename = `${Date.now()}_${uuid().slice(0, 8)}.${ext}`
  const fullPath = join(dir, filename)
  try {
    writeFileSync(fullPath, buf)
  } catch (e) {
    console.error('addFromDataUri write failed:', e)
    return null
  }

  // displayName 写到 gallery_items.name 列；这里 addFile 用 basename(fullPath) 作为 name，
  // 我们覆盖一下让用户看到自己起的名（保留扩展名以便辨识图片类型）
  const item = addFile(categoryId, fullPath)
  if (item && displayName) {
    const cleanName = displayName.trim().slice(0, 120) || basename(fullPath)
    const finalName = cleanName.toLowerCase().endsWith('.' + ext) ? cleanName : `${cleanName}.${ext}`
    const db = getDatabase()
    db.prepare('UPDATE gallery_items SET name = ? WHERE id = ?').run(finalName, item.id)
    return getItem(item.id)
  }
  return item
}

// ────── 创作分类联动入库 ──────

/**
 * 将已生成的图片自动归入系统「创作」分类。
 * filePath 可以是绝对路径或相对路径。
 * 去重：同路径已存在则跳过。
 */
export function addToCreation(filePath: string): GalleryItem | null {
  if (!filePath) return null
  const isAbsolute = /^[A-Za-z]:|^\//.test(filePath)
  const absPath = isAbsolute ? filePath : join(getDataDir(), filePath)
  if (!existsSync(absPath)) return null
  return addFile(SYSTEM_CREATION_ID, absPath)
}

/**
 * v0.6.9+ 将抠图结果自动归入系统「我的抠图」分类（透明 PNG）。
 * 与 addToCreation 同等的接口，只是落到不同分类。
 */
export function addToMatting(filePath: string): GalleryItem | null {
  if (!filePath) return null
  const isAbsolute = /^[A-Za-z]:|^\//.test(filePath)
  const absPath = isAbsolute ? filePath : join(getDataDir(), filePath)
  if (!existsSync(absPath)) return null
  return addFile(SYSTEM_MATTING_ID, absPath)
}

/**
 * 将精细抠图（抠抠图）结果自动归入系统「我的精细抠图」分类（透明 PNG）。
 * 与 addToMatting 同等接口，只是落到不同分类。
 */
export function addToFineMatting(filePath: string): GalleryItem | null {
  if (!filePath) return null
  const isAbsolute = /^[A-Za-z]:|^\//.test(filePath)
  const absPath = isAbsolute ? filePath : join(getDataDir(), filePath)
  if (!existsSync(absPath)) return null
  return addFile(SYSTEM_FINE_MATTING_ID, absPath)
}

/**
 * 一次性回填：把已存在的 image_generations.result_path 全部归档到「创作」分类。
 * 用 settings 表的 gallery_backfill_done 作为幂等标记，跑完一次永不重跑。
 * 失败的单条不阻断整体（best-effort）。
 */
export function backfillCreationGallery(): { added: number; skipped: number; total: number } {
  const db = getDatabase()
  const flag = db.prepare("SELECT value FROM settings WHERE key = ?").get('gallery_backfill_done') as { value: string } | undefined
  if (flag?.value === '1') return { added: 0, skipped: 0, total: 0 }

  const rows = db
    .prepare("SELECT result_path FROM image_generations WHERE result_path IS NOT NULL AND result_path != ''")
    .all() as { result_path: string }[]

  let added = 0
  let skipped = 0
  for (const row of rows) {
    try {
      const result = addToCreation(row.result_path)
      if (result) added++
      else skipped++
    } catch (e) {
      skipped++
      console.error('Backfill gallery failed for:', row.result_path, e)
    }
  }

  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('gallery_backfill_done', '1')
  return { added, skipped, total: rows.length }
}
