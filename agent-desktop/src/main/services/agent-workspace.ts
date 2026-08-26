import { getDatabase } from '../database'
import { v4 as uuid } from 'uuid'
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { basename, join, relative, resolve, sep } from 'path'
import { getDataDir } from './data-path'
import { getSetting, setSetting } from './settings'
import * as knowledgeService from './knowledge'
import * as galleryService from './gallery'
import { bindWorkspaceBrandSources } from './brand-card'

export interface AgentWorkspace {
  id: string
  name: string
  root_path: string
  is_default: number
  kb_category_id: string
  gallery_category_id: string
  last_opened_at: string
  created_at: string
  updated_at: string
}

const ACTIVE_KEY = 'active_workspace_id'

function ensureTable(): void {
  const db = getDatabase()
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      kb_category_id TEXT NOT NULL DEFAULT '',
      gallery_category_id TEXT NOT NULL DEFAULT '',
      last_opened_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_workspaces_opened ON agent_workspaces(last_opened_at DESC);
  `)
  const cols = db.prepare('PRAGMA table_info(agent_workspaces)').all() as Array<{ name: string }>
  const names = cols.map((c) => c.name)
  if (!names.includes('brand_card_status')) {
    db.exec("ALTER TABLE agent_workspaces ADD COLUMN brand_card_status TEXT NOT NULL DEFAULT ''")
  }
  if (!names.includes('brand_source_fingerprint')) {
    db.exec("ALTER TABLE agent_workspaces ADD COLUMN brand_source_fingerprint TEXT NOT NULL DEFAULT ''")
  }
}

function rowToWs(row: any): AgentWorkspace {
  return {
    id: row.id,
    name: row.name,
    root_path: row.root_path,
    is_default: Number(row.is_default || 0),
    kb_category_id: row.kb_category_id || '',
    gallery_category_id: row.gallery_category_id || '',
    last_opened_at: row.last_opened_at || '',
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

function ensureDir(dir: string): void {
  if (!dir) return
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  } catch (e) {
    console.error('[agent-workspace] mkdir failed:', dir, e)
  }
}

/** 工作区根下标准子目录（品牌/创作约定） */
export function scaffoldWorkspaceDirs(rootPath: string): void {
  ensureDir(rootPath)
  ensureDir(join(rootPath, 'docs'))
  ensureDir(join(rootPath, 'assets'))
  ensureDir(join(rootPath, 'output'))
}

function defaultRootPath(): string {
  return join(getDataDir(), 'workspace')
}

/** 确保至少有一个默认工作区；返回当前激活的工作区 */
export function ensureDefaultWorkspace(): AgentWorkspace {
  ensureTable()
  const db = getDatabase()
  let def = db.prepare('SELECT * FROM agent_workspaces WHERE is_default = 1 LIMIT 1').get() as any
  if (!def) {
    def = db.prepare('SELECT * FROM agent_workspaces ORDER BY created_at ASC LIMIT 1').get() as any
  }
  if (!def) {
    const id = uuid()
    const now = new Date().toISOString()
    const root = defaultRootPath()
    scaffoldWorkspaceDirs(root)
    db.prepare(
      `INSERT INTO agent_workspaces
        (id, name, root_path, is_default, kb_category_id, gallery_category_id, last_opened_at, created_at, updated_at)
       VALUES (?, ?, ?, 1, '', '', ?, ?, ?)`
    ).run(id, '默认工作区', root, now, now, now)
    setSetting(ACTIVE_KEY, id)
    return getWorkspace(id)!
  }
  if (!getSetting(ACTIVE_KEY)) setSetting(ACTIVE_KEY, def.id)
  return rowToWs(def)
}

export function listWorkspaces(): AgentWorkspace[] {
  ensureDefaultWorkspace()
  const db = getDatabase()
  const rows = db
    .prepare(
      `SELECT * FROM agent_workspaces
       ORDER BY is_default DESC, last_opened_at DESC, updated_at DESC`
    )
    .all() as any[]
  return rows.map(rowToWs)
}

export function getWorkspace(id: string): AgentWorkspace | null {
  ensureTable()
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM agent_workspaces WHERE id = ?').get(id) as any
  return row ? rowToWs(row) : null
}

export function getActiveWorkspace(): AgentWorkspace {
  ensureDefaultWorkspace()
  const activeId = getSetting(ACTIVE_KEY) || ''
  if (activeId) {
    const ws = getWorkspace(activeId)
    if (ws) return ws
  }
  return ensureDefaultWorkspace()
}

export function getActiveWorkspaceRoot(): string {
  const ws = getActiveWorkspace()
  ensureDir(ws.root_path)
  return resolve(ws.root_path)
}

export function setActiveWorkspace(id: string): AgentWorkspace | null {
  const ws = getWorkspace(id)
  if (!ws) return null
  setSetting(ACTIVE_KEY, id)
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare('UPDATE agent_workspaces SET last_opened_at=?, updated_at=? WHERE id=?').run(now, now, id)
  return getWorkspace(id)
}

/**
 * 打开现有文件夹为工作区（已存在同路径则激活）。
 */
export function openFolderAsWorkspace(folderPath: string, name?: string): AgentWorkspace {
  ensureTable()
  const root = resolve(folderPath)
  if (!existsSync(root)) throw new Error('文件夹不存在')
  scaffoldWorkspaceDirs(root)

  const db = getDatabase()
  const existing = db.prepare('SELECT * FROM agent_workspaces WHERE root_path = ?').get(root) as any
  if (existing) {
    setActiveWorkspace(existing.id)
    return getWorkspace(existing.id)!
  }

  const id = uuid()
  const now = new Date().toISOString()
  const label = (name || '').trim() || basename(root) || '工作区'
  const kb = knowledgeService.createCategory({
    name: `工作区·${label}`,
    description: `工作区「${label}」文档（建议放在 docs/）`
  })
  try {
    knowledgeService.bindFolder(kb.id, join(root, 'docs'))
  } catch (e) {
    console.error('[agent-workspace] bind docs failed:', e)
  }
  try {
    bindWorkspaceBrandSources(kb.id, root)
  } catch (e) {
    console.error('[agent-workspace] bind brand sources failed:', e)
  }
  const gallery = galleryService.createCategory({
    name: `工作区·${label}`,
    description: `工作区「${label}」素材（建议放在 assets/）`
  })

  db.prepare(
    `INSERT INTO agent_workspaces
      (id, name, root_path, is_default, kb_category_id, gallery_category_id, last_opened_at, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`
  ).run(id, label, root, kb.id, gallery.id, now, now, now)
  setSetting(ACTIVE_KEY, id)
  return getWorkspace(id)!
}

/**
 * 创建新工作区目录（在父目录下建子文件夹，或使用绝对路径）。
 */
export function createWorkspace(data: { name: string; parentDir?: string }): AgentWorkspace {
  const label = (data.name || '').trim() || '新工作区'
  const parent = data.parentDir ? resolve(data.parentDir) : join(getDataDir(), 'workspaces')
  ensureDir(parent)
  // 简单消歧：同名则加短后缀
  let root = join(parent, label)
  if (existsSync(root)) root = join(parent, `${label}-${Date.now().toString(36)}`)
  scaffoldWorkspaceDirs(root)
  return openFolderAsWorkspace(root, label)
}

export function renameWorkspace(id: string, name: string): AgentWorkspace | null {
  const ws = getWorkspace(id)
  if (!ws) return null
  const label = name.trim()
  if (!label) return ws
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare('UPDATE agent_workspaces SET name=?, updated_at=? WHERE id=?').run(label, now, id)
  return getWorkspace(id)
}

export function setWorkspaceKbCategory(id: string, categoryId: string): AgentWorkspace | null {
  const ws = getWorkspace(id)
  if (!ws) return null
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare('UPDATE agent_workspaces SET kb_category_id=?, updated_at=? WHERE id=?').run(
    categoryId || '',
    now,
    id
  )
  return getWorkspace(id)
}

/** 确保指定（或当前）工作区有图库分类；默认工作区也会补建。 */
export function ensureGalleryCategoryId(workspaceId?: string): string {
  const ws = workspaceId ? getWorkspace(workspaceId) : getActiveWorkspace()
  if (!ws) throw new Error('工作区不存在')
  if (ws.gallery_category_id) {
    const cat = galleryService.getCategory(ws.gallery_category_id)
    if (cat) return cat.id
  }
  const gallery = galleryService.createCategory({
    name: `工作区·${ws.name}`,
    description: `工作区「${ws.name}」图库`
  })
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare('UPDATE agent_workspaces SET gallery_category_id=?, updated_at=? WHERE id=?').run(
    gallery.id,
    now,
    ws.id
  )
  return gallery.id
}

export function ensureActiveGalleryCategoryId(): string {
  return ensureGalleryCategoryId()
}

/** 把工作区 assets/output 里已有图片补进该工作区图库，避免「文件夹有图、选择器是空的」。 */
export function prepareWorkspaceGallery(workspaceId: string): AgentWorkspace {
  const ws = getWorkspace(workspaceId)
  if (!ws) throw new Error('工作区不存在')
  const catId = ensureGalleryCategoryId(workspaceId)
  for (const sub of ['assets', 'output']) {
    const dir = join(ws.root_path, sub)
    if (!existsSync(dir)) continue
    try {
      galleryService.addFolder(catId, dir, true)
    } catch (e) {
      console.warn('[agent-workspace] sync gallery folder failed:', dir, e)
    }
  }
  return getWorkspace(workspaceId)!
}

/** 把已生成的图片归入当前工作区图库（不再进全局「创作」）。 */
export function addGeneratedImageToWorkspaceGallery(filePath: string) {
  if (!filePath) return null
  const isAbsolute = /^[A-Za-z]:|^\//.test(filePath)
  const absPath = isAbsolute ? filePath : join(getDataDir(), filePath)
  if (!existsSync(absPath)) return null
  const catId = ensureActiveGalleryCategoryId()
  return galleryService.addFile(catId, absPath)
}

export function updateWorkspaceBrandMeta(id: string, status: string, fingerprint: string): void {
  ensureTable()
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare(
    'UPDATE agent_workspaces SET brand_card_status=?, brand_source_fingerprint=?, updated_at=? WHERE id=?'
  ).run(status || '', fingerprint || '', now, id)
}

export function deleteWorkspace(id: string): boolean {
  const ws = getWorkspace(id)
  if (!ws) return false
  if (ws.is_default) throw new Error('默认工作区不可删除')
  const db = getDatabase()
  // 工作区不是数字员工所有权：删除目录入口不级联删除员工或历史会话。
  // 会话保留原 workspace_id，使解析器明确报告“工作区不可用”，避免静默跳到其它目录。
  const now = new Date().toISOString()
  db.prepare("UPDATE bots SET default_workspace_id='' WHERE default_workspace_id=?").run(id)
  db.prepare("UPDATE digital_employee_assets SET status='archived',updated_at=? WHERE workspace_id=? AND status='active'").run(now, id)
  db.prepare("UPDATE digital_employee_candidates SET status='expired',decided_at=? WHERE workspace_id=? AND status='pending'").run(now, id)
  db.prepare('DELETE FROM agent_workspaces WHERE id = ?').run(id)
  const active = getSetting(ACTIVE_KEY)
  if (active === id) {
    const def = ensureDefaultWorkspace()
    setSetting(ACTIVE_KEY, def.id)
  }
  return true
}

const HIDDEN_NAMES = new Set(['.DS_Store', 'Thumbs.db', '.git', '.svn', 'node_modules'])

export interface WorkspaceDirEntry {
  name: string
  isDirectory: boolean
  size: number
  mtime: string
}

export interface WorkspaceDirListing {
  root: string
  workspaceName: string
  relPath: string
  absPath: string
  parentRel: string | null
  entries: WorkspaceDirEntry[]
}

function assertInsideWorkspace(root: string, target: string): void {
  const normalizedRoot = resolve(root)
  const normalizedTarget = resolve(target)
  const rel = relative(normalizedRoot, normalizedTarget)
  if (rel.startsWith('..') || rel === `..${sep}` || rel.includes(`${sep}..${sep}`)) {
    throw new Error('路径超出工作区')
  }
}

/** 列出当前激活工作区内某相对目录的条目（只读，供对话旁文件分栏）。 */
export function listActiveWorkspaceDir(relPath = '.'): WorkspaceDirListing {
  const ws = getActiveWorkspace()
  const root = resolve(ws.root_path)
  ensureDir(root)

  const raw = (relPath || '.').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  const target = !raw || raw === '.' ? root : resolve(root, raw)
  assertInsideWorkspace(root, target)

  if (!existsSync(target)) throw new Error('目录不存在')
  if (!statSync(target).isDirectory()) throw new Error('不是目录')

  const entries: WorkspaceDirEntry[] = []
  for (const e of readdirSync(target, { withFileTypes: true })) {
    if (HIDDEN_NAMES.has(e.name) || e.name.startsWith('.')) continue
    const full = join(target, e.name)
    let size = 0
    let mtime = ''
    try {
      const s = statSync(full)
      size = e.isDirectory() ? 0 : s.size
      mtime = s.mtime.toISOString()
    } catch {
      /* ignore broken symlink etc. */
    }
    entries.push({
      name: e.name,
      isDirectory: e.isDirectory(),
      size,
      mtime
    })
  }
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })

  const relCheck = relative(root, target).replace(/\\/g, '/')
  const currentRel = !relCheck || relCheck === '.' ? '.' : relCheck
  let parentRel: string | null = null
  if (currentRel !== '.') {
    const parts = currentRel.split('/')
    parts.pop()
    parentRel = parts.length ? parts.join('/') : '.'
  }

  return {
    root,
    workspaceName: ws.name,
    relPath: currentRel,
    absPath: target,
    parentRel,
    entries
  }
}
