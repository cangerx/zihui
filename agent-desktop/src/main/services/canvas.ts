import { getDatabase } from '../database'
import { v4 as uuid } from 'uuid'
import { join, extname } from 'path'
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, copyFileSync } from 'fs'
import { getDataDir } from './data-path'
import { removeByRelativePath } from './gallery'
import { deleteGenerationsByCanvasNode } from './video-generation'
import {
  CANVAS_EXPORT_SCHEMA_VERSION,
  type CanvasExportFile,
  type ExportedEdge,
  type ExportedNode,
  type ExportedProject,
  freshRuntimeFields,
  stripRuntimeFields,
  validateExportFile,
} from '../../shared/canvas-export'

export interface CanvasProject {
  id: string
  title: string
  text_provider_id: string
  text_model_id: string
  image_provider_id: string
  image_model_id: string
  /** v0.6.9+ 「图片反推」节点默认视觉模型（节点可覆盖，可为空字符串） */
  vision_provider_id: string
  vision_model_id: string
  concurrency: number
  system_prompt: string
  /** 布局方向：'LR' 左到右（默认）/ 'TB' 上到下。dagre rankdir 的子集 */
  layout_direction: string
  created_at: string
  updated_at: string
}

export interface CanvasNode {
  id: string
  project_id: string
  type: string
  position_x: number
  position_y: number
  width: number
  height: number
  data: Record<string, any>
  created_at: string
}

export interface CanvasEdge {
  id: string
  project_id: string
  source_node_id: string
  source_handle: string
  target_node_id: string
  target_handle: string
  created_at: string
}

function parseNode(row: any): CanvasNode {
  return { ...row, data: JSON.parse(row.data || '{}') }
}

// === Canvas image storage ===
// Ref images are stored on disk under dataDir/canvas/<projectId>/<nodeId>_<ts>.<ext>
// The node.data.image_path field holds the relative path (canvas/<projectId>/...).
// This avoids bloating SQLite with base64 dataURLs.

function getCanvasDir(): string {
  const dir = join(getDataDir(), 'canvas')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 确保 canvas/{projectId}/ 目录存在并返回其绝对路径。
 *
 * v0.6.9+ 改为 export：IPC handler 「打开画布文件夹」需要这个绝对路径调 shell.openPath。
 * 模块内部 saveNodeImage / image-generation 等仍按原逻辑使用。
 */
export function getProjectImageDir(projectId: string): string {
  const dir = join(getCanvasDir(), projectId)
  mkdirSync(dir, { recursive: true })
  return dir
}

function toRelativePath(absPath: string): string {
  const dataDir = getDataDir()
  const prefix = dataDir.endsWith('\\') || dataDir.endsWith('/') ? dataDir : dataDir + (process.platform === 'win32' ? '\\' : '/')
  if (absPath.startsWith(prefix)) return absPath.slice(prefix.length).replace(/\\/g, '/')
  if (absPath.startsWith(dataDir)) return absPath.slice(dataDir.length + 1).replace(/\\/g, '/')
  return absPath.replace(/\\/g, '/')
}

function parseDataUrl(dataUrl: string): { buffer: Buffer; ext: string } {
  const match = /^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/.exec(dataUrl)
  if (!match) throw new Error('Invalid data URL')
  const raw = match[2]
  let ext = match[1].toLowerCase()
  if (ext === 'jpeg') ext = 'jpg'
  // Only allow a small known-good set
  if (!['png', 'jpg', 'webp', 'gif'].includes(ext)) ext = 'png'
  return { buffer: Buffer.from(raw, 'base64'), ext }
}

/**
 * 按 nodeId 前缀清理 canvas/{projectId}/ 下的所有关联文件。
 *
 * 文件名约定（两种）：
 *   - refImage 节点：{nodeId}_{ts}.{ext}                   → saveNodeImage 写入
 *   - text2img / img2img 节点：{nodeId}_{genId}.{ext}    → v0.6.9+ image-generation 写入
 *
 * 同时需联动清理 gallery_items（“我的创作”分类）里的指向记录，
 * 否则除了文件会出现图库孤儿记录。removeByRelativePath 幂等，
 * 不存在则何作为。
 */
function cleanupNodeFiles(projectId: string, nodeId: string): void {
  // v0.7.14+ 级联软删该节点的视频创作记录（独立于物理文件清理，目录不存在也要清 DB 记录）
  try { deleteGenerationsByCanvasNode(projectId, nodeId) } catch {}
  const dir = join(getCanvasDir(), projectId)
  if (!existsSync(dir)) return
  try {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(`${nodeId}_`) || name.startsWith(`${nodeId}.`)) {
        // 先清 gallery 记录再删磁盘文件：
        // image_generations.result_path 与 gallery_items.file_path 都存相对路径
        const relPath = `canvas/${projectId}/${name}`
        try { removeByRelativePath(relPath) } catch {}
        try { rmSync(join(dir, name), { force: true }) } catch {}
      }
    }
  } catch {}
}

export function saveNodeImage(projectId: string, nodeId: string, dataUrl: string): { image_path: string } {
  const { buffer, ext } = parseDataUrl(dataUrl)
  const dir = getProjectImageDir(projectId)
  // Clean any previous image(s) for this node so old files don't accumulate
  cleanupNodeFiles(projectId, nodeId)
  const filename = `${nodeId}_${Date.now()}.${ext}`
  const filePath = join(dir, filename)
  writeFileSync(filePath, buffer)
  return { image_path: toRelativePath(filePath) }
}

/** 文生图/图生图编辑结果：写新文件，不清理该节点已有生成记录 */
export function saveNodeResultImage(projectId: string, nodeId: string, dataUrl: string): { image_path: string } {
  const { buffer, ext } = parseDataUrl(dataUrl)
  const dir = getProjectImageDir(projectId)
  const filename = `${nodeId}_edited_${Date.now()}.${ext}`
  const filePath = join(dir, filename)
  writeFileSync(filePath, buffer)
  return { image_path: toRelativePath(filePath) }
}

/**
 * v0.7.14+ 流式画布视频输入节点：把本地源视频复制进 canvas/{projectId}/，
 * 文件名带 {nodeId}_ 前缀以复用 cleanupNodeFiles 的级联清理。视频体积大，直接 copy
 * 文件而非走 base64，避免内存与 SQLite 膨胀；返回相对路径存入 node.data.video_path。
 */
export function saveNodeVideo(projectId: string, nodeId: string, sourcePath: string): { video_path: string } {
  if (!sourcePath || !existsSync(sourcePath)) throw new Error('源视频文件不存在')
  const dir = getProjectImageDir(projectId)
  cleanupNodeFiles(projectId, nodeId)
  const ext = (extname(sourcePath).replace('.', '').toLowerCase()) || 'mp4'
  const filename = `${nodeId}_${Date.now()}.${ext}`
  const filePath = join(dir, filename)
  copyFileSync(sourcePath, filePath)
  return { video_path: toRelativePath(filePath) }
}

/**
 * v0.7.14+ 关键帧抽取节点：一次性批量落盘多帧。
 * 不能复用 saveNodeImage（它每次都 cleanupNodeFiles 会把前面已落的帧删掉）；
 * 这里只在开头清理一次旧帧，再按 {nodeId}_{frameId} 命名批量写入。
 */
export function saveNodeFrames(projectId: string, nodeId: string, frames: Array<{ id: string; dataUrl: string }>): Array<{ id: string; path: string }> {
  const dir = getProjectImageDir(projectId)
  cleanupNodeFiles(projectId, nodeId)
  const out: Array<{ id: string; path: string }> = []
  for (const f of frames || []) {
    if (!f || !f.id || !f.dataUrl) continue
    const { buffer, ext } = parseDataUrl(f.dataUrl)
    const filename = `${nodeId}_${f.id}.${ext}`
    const filePath = join(dir, filename)
    writeFileSync(filePath, buffer)
    out.push({ id: f.id, path: toRelativePath(filePath) })
  }
  return out
}

// ===== v0.7.14+ 角色一致性库 =====

export interface CanvasCharacter {
  id: string
  project_id: string
  name: string
  description: string
  ref_image_path: string
  created_at: string
}

export function listCharacters(projectId: string): CanvasCharacter[] {
  return getDatabase()
    .prepare('SELECT * FROM canvas_characters WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as CanvasCharacter[]
}

export function createCharacter(projectId: string, data: { name?: string; description?: string; ref_image_path?: string }): CanvasCharacter {
  const id = uuid()
  const now = new Date().toISOString()
  const row: CanvasCharacter = {
    id,
    project_id: projectId,
    name: data.name || '',
    description: data.description || '',
    ref_image_path: data.ref_image_path || '',
    created_at: now,
  }
  getDatabase()
    .prepare('INSERT INTO canvas_characters (id, project_id, name, description, ref_image_path, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.id, row.project_id, row.name, row.description, row.ref_image_path, row.created_at)
  return row
}

export function deleteCharacter(id: string): { ok: true } {
  getDatabase().prepare('DELETE FROM canvas_characters WHERE id = ?').run(id)
  return { ok: true }
}

/**
 * v0.7.14+ 复制画布项目时一并克隆角色库：把源项目的角色行 + 定妆图文件复制到
 * 目标项目目录（定妆图改名为 char_{uuid}，独立于任何节点，不会被 cleanupNodeFiles 误删），
 * 返回旧→新角色 id 映射，供渲染端把 characterRef 节点的 character_id / image_path
 * 重写到新项目，避免引用悬空到源项目。
 */
export function cloneCharacters(
  sourceProjectId: string,
  targetProjectId: string
): Array<{ old_id: string; new_id: string; ref_image_path: string }> {
  const rows = listCharacters(sourceProjectId)
  if (!rows.length) return []
  const dir = getProjectImageDir(targetProjectId)
  const dataDir = getDataDir()
  const db = getDatabase()
  const out: Array<{ old_id: string; new_id: string; ref_image_path: string }> = []
  for (const c of rows) {
    let newRefPath = ''
    if (c.ref_image_path) {
      try {
        const srcFull = join(dataDir, c.ref_image_path)
        if (existsSync(srcFull)) {
          const ext = extname(srcFull).replace('.', '').toLowerCase() || 'png'
          const filePath = join(dir, `char_${uuid()}.${ext}`)
          copyFileSync(srcFull, filePath)
          newRefPath = toRelativePath(filePath)
        }
      } catch {
        newRefPath = ''
      }
    }
    const newId = uuid()
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO canvas_characters (id, project_id, name, description, ref_image_path, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(newId, targetProjectId, c.name, c.description, newRefPath, now)
    out.push({ old_id: c.id, new_id: newId, ref_image_path: newRefPath })
  }
  return out
}

function deleteNodeImageFiles(projectId: string, nodeId: string): void {
  cleanupNodeFiles(projectId, nodeId)
}

export function deleteNodeImage(projectId: string, nodeId: string): { ok: true } {
  deleteNodeImageFiles(projectId, nodeId)
  return { ok: true }
}

function deleteProjectImageDir(projectId: string): void {
  const dir = join(getCanvasDir(), projectId)
  if (existsSync(dir)) {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

// === Projects ===

export function listProjects(): CanvasProject[] {
  const db = getDatabase()
  return db.prepare('SELECT * FROM canvas_projects ORDER BY updated_at DESC').all() as CanvasProject[]
}

export function getProject(id: string): CanvasProject | null {
  const db = getDatabase()
  return (db.prepare('SELECT * FROM canvas_projects WHERE id = ?').get(id) as CanvasProject) || null
}

export function createProject(data: {
  title: string
  text_provider_id?: string
  text_model_id?: string
  image_provider_id?: string
  image_model_id?: string
  vision_provider_id?: string
  vision_model_id?: string
  concurrency?: number
  system_prompt?: string
  layout_direction?: string
}): CanvasProject {
  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO canvas_projects (id, title, text_provider_id, text_model_id, image_provider_id, image_model_id, vision_provider_id, vision_model_id, concurrency, system_prompt, layout_direction, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    data.title || 'New Canvas',
    data.text_provider_id || '',
    data.text_model_id || '',
    data.image_provider_id || '',
    data.image_model_id || '',
    data.vision_provider_id || '',
    data.vision_model_id || '',
    data.concurrency || 1,
    data.system_prompt || '',
    normalizeLayoutDirection(data.layout_direction),
    now,
    now
  )
  return getProject(id)!
}

/** 只接受 'LR' / 'TB'，其他值一律回退到 'LR'（防脟数据脱出 UI 那两个选项） */
function normalizeLayoutDirection(v: string | undefined): 'LR' | 'TB' {
  return v === 'TB' ? 'TB' : 'LR'
}

export function updateProject(id: string, data: Partial<{
  title: string
  text_provider_id: string
  text_model_id: string
  image_provider_id: string
  image_model_id: string
  vision_provider_id: string
  vision_model_id: string
  concurrency: number
  system_prompt: string
  layout_direction: string
}>): CanvasProject | null {
  const db = getDatabase()
  const sets: string[] = ['updated_at = ?']
  const params: any[] = [new Date().toISOString()]
  if (data.title !== undefined) { sets.push('title = ?'); params.push(data.title) }
  if (data.text_provider_id !== undefined) { sets.push('text_provider_id = ?'); params.push(data.text_provider_id) }
  if (data.text_model_id !== undefined) { sets.push('text_model_id = ?'); params.push(data.text_model_id) }
  if (data.image_provider_id !== undefined) { sets.push('image_provider_id = ?'); params.push(data.image_provider_id) }
  if (data.image_model_id !== undefined) { sets.push('image_model_id = ?'); params.push(data.image_model_id) }
  if (data.vision_provider_id !== undefined) { sets.push('vision_provider_id = ?'); params.push(data.vision_provider_id) }
  if (data.vision_model_id !== undefined) { sets.push('vision_model_id = ?'); params.push(data.vision_model_id) }
  if (data.concurrency !== undefined) { sets.push('concurrency = ?'); params.push(data.concurrency) }
  if (data.system_prompt !== undefined) { sets.push('system_prompt = ?'); params.push(data.system_prompt) }
  if (data.layout_direction !== undefined) { sets.push('layout_direction = ?'); params.push(normalizeLayoutDirection(data.layout_direction)) }
  params.push(id)
  db.prepare(`UPDATE canvas_projects SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  return getProject(id)
}

export function deleteProject(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM canvas_projects WHERE id = ?').run(id)
  // Cascade: drop the entire canvas image directory for this project
  deleteProjectImageDir(id)
  // Cascade: 清理画布助手对话记录
  db.prepare('DELETE FROM canvas_agent_chat WHERE project_id = ?').run(id)
  return result.changes > 0
}

// === 画布助手对话持久化（按画布一个 JSON blob；载回可见消息 + 模型上下文） ===

export function getAgentChat(projectId: string): string | null {
  const row = getDatabase().prepare('SELECT data FROM canvas_agent_chat WHERE project_id = ?').get(projectId) as any
  return row?.data ?? null
}

export function saveAgentChat(projectId: string, data: string): void {
  getDatabase().prepare(
    `INSERT INTO canvas_agent_chat (project_id, data, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(project_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`
  ).run(projectId, String(data || ''))
}

// === Nodes ===

export function listNodes(projectId: string): CanvasNode[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM canvas_nodes WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as any[]
  return rows.map(parseNode)
}

// === 按序导出画布图片 ===
// 把画布里「出图节点」当前展示的图片，按画布上的 #N 序号复制到用户选定目录，
// 文件名 = {类型名}-{NN}.{ext}（如 文生图-01.png），方便用户在目录里按顺序取用
// （做视频 / PPT / 连环画 / 交付等）。
//
// 序号规则与渲染端 CanvasEditorView 的 nodeIndexMap 完全一致：
//   按节点类型分桶、按 created_at 升序、从 1 开始计数，且「含无图节点」——
//   即每个该类型节点都占一个序号，缺图的节点对应序号会被跳过，
//   保证导出文件名里的序号与画布上看到的节点徽章 #N 逐一对应。
const EXPORT_TYPE_LABELS: Record<string, string> = {
  text2img: '文生图',
  img2img: '图生图',
  imageResult: '图片结果',
}

export interface ProjectImageExportItem {
  srcAbsPath: string
  exportName: string
  type: string
  nodeIndex: number
}

/** 数据目录相对路径 → 绝对路径；已是绝对路径（盘符 / 斜杠开头）则原样返回 */
function resolveDataPath(relOrAbs: string): string {
  const isAbs = /^[A-Za-z]:|^\//.test(relOrAbs)
  return isAbs ? relOrAbs : join(getDataDir(), relOrAbs)
}

/**
 * 收集某画布可按序导出的图片清单。仅纳入出图节点（文生图 / 图生图 / 图片结果），
 * 且该节点当前 result_path 指向一个存在的本地文件（dataURL / 远程 URL 无本地文件，跳过）。
 */
export function collectProjectImageExports(projectId: string): ProjectImageExportItem[] {
  const nodes = listNodes(projectId) // 已 ORDER BY created_at ASC
  const perTypeIndex: Record<string, number> = {}
  const out: ProjectImageExportItem[] = []
  // 去重：「图片结果」节点的 result_path 直接复用上游生成图（同一物理文件），
  // 不去重会导出多份内容相同、仅文件名不同的图。按规范化绝对路径去重，
  // 保留按 created_at 最先出现的节点（通常是真正产图的文生图 / 图生图节点）。
  const seenFiles = new Set<string>()
  for (const n of nodes) {
    const label = EXPORT_TYPE_LABELS[n.type]
    if (!label) continue
    // 每个该类型节点都占一个序号（无论是否有图），与画布 #N 徽章对应
    perTypeIndex[n.type] = (perTypeIndex[n.type] || 0) + 1
    const nodeIndex = perTypeIndex[n.type]
    const relPath = typeof n.data?.result_path === 'string' ? n.data.result_path.trim() : ''
    if (!relPath || relPath.startsWith('data:') || relPath.startsWith('http')) continue
    const abs = resolveDataPath(relPath)
    if (!existsSync(abs)) continue
    const dedupKey = abs.replace(/\\/g, '/').toLowerCase() // Windows 路径大小写 / 斜杠归一
    if (seenFiles.has(dedupKey)) continue
    seenFiles.add(dedupKey)
    const ext = extname(abs).replace('.', '').toLowerCase() || 'png'
    const seq = String(nodeIndex).padStart(2, '0')
    out.push({ srcAbsPath: abs, exportName: `${label}-${seq}.${ext}`, type: n.type, nodeIndex })
  }
  return out
}

/**
 * 把画布出图节点的图片按 #N 序号复制到 targetDir。
 * 返回 { exported（实际复制数）, total（清单数）, files（导出文件名列表） }。
 * 文件名理论上由 类型+序号 唯一，极端重名时追加 (2) (3) 兜底。
 */
export function exportProjectImagesTo(
  projectId: string,
  targetDir: string
): { exported: number; total: number; files: string[] } {
  const plan = collectProjectImageExports(projectId)
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
  const used = new Set<string>()
  const files: string[] = []
  let exported = 0
  for (const it of plan) {
    let name = it.exportName
    if (used.has(name)) {
      const ext = extname(name)
      const base = name.slice(0, name.length - ext.length)
      let k = 2
      while (used.has(`${base}(${k})${ext}`)) k++
      name = `${base}(${k})${ext}`
    }
    used.add(name)
    try {
      copyFileSync(it.srcAbsPath, join(targetDir, name))
      files.push(name)
      exported++
    } catch (e) {
      console.error('[canvas] exportProjectImagesTo copy failed:', it.srcAbsPath, '→', name, e)
    }
  }
  return { exported, total: plan.length, files }
}

export function getNode(id: string): CanvasNode | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM canvas_nodes WHERE id = ?').get(id) as any
  return row ? parseNode(row) : null
}

export function createNode(projectId: string, data: {
  type: string
  position_x: number
  position_y: number
  width?: number
  height?: number
  data?: Record<string, any>
}): CanvasNode {
  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO canvas_nodes (id, project_id, type, position_x, position_y, width, height, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, projectId, data.type, data.position_x, data.position_y, data.width || 240, data.height || 0, JSON.stringify(data.data || {}), now)
  touchProject(projectId)
  return getNode(id)!
}

export function updateNode(id: string, data: Partial<{
  position_x: number
  position_y: number
  width: number
  height: number
  data: Record<string, any>
}>): CanvasNode | null {
  const db = getDatabase()
  const sets: string[] = []
  const params: any[] = []
  if (data.position_x !== undefined) { sets.push('position_x = ?'); params.push(data.position_x) }
  if (data.position_y !== undefined) { sets.push('position_y = ?'); params.push(data.position_y) }
  if (data.width !== undefined) { sets.push('width = ?'); params.push(data.width) }
  if (data.height !== undefined) { sets.push('height = ?'); params.push(data.height) }
  if (data.data !== undefined) { sets.push('data = ?'); params.push(JSON.stringify(data.data)) }
  if (sets.length === 0) return getNode(id)
  params.push(id)
  db.prepare(`UPDATE canvas_nodes SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  const node = getNode(id)
  if (node) touchProject(node.project_id)
  return node
}

export function updateNodePositions(updates: { id: string; position_x: number; position_y: number }[]): void {
  const db = getDatabase()
  const stmt = db.prepare('UPDATE canvas_nodes SET position_x = ?, position_y = ? WHERE id = ?')
  const transaction = db.transaction(() => {
    for (const u of updates) {
      stmt.run(u.position_x, u.position_y, u.id)
    }
  })
  transaction()
}

export function deleteNode(id: string): boolean {
  const db = getDatabase()
  const node = getNode(id)
  const result = db.prepare('DELETE FROM canvas_nodes WHERE id = ?').run(id)
  if (node) {
    // v0.6.9+ 级联清理所有节点类型的磁盘文件 + gallery 记录。
    // cleanupNodeFiles 按 `${nodeId}_` 前缀匹配，文件名约定覆盖：
    //   - refImage:        {nodeId}_{ts}.{ext}
    //   - text2img/img2img:{nodeId}_{genId}.{ext}（v0.6.9+ 落盘到 canvas/{projectId}/ 后）
    // 无图节点（aiText / textInput / reverse 等）扫不到匹配项，是 no-op。
    deleteNodeImageFiles(node.project_id, id)
    touchProject(node.project_id)
  }
  return result.changes > 0
}

// === Edges ===

export function listEdges(projectId: string): CanvasEdge[] {
  const db = getDatabase()
  return db.prepare('SELECT * FROM canvas_edges WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as CanvasEdge[]
}

export function createEdge(projectId: string, data: {
  source_node_id: string
  source_handle: string
  target_node_id: string
  target_handle: string
}): CanvasEdge {
  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO canvas_edges (id, project_id, source_node_id, source_handle, target_node_id, target_handle, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, projectId, data.source_node_id, data.source_handle, data.target_node_id, data.target_handle, now)
  touchProject(projectId)
  return db.prepare('SELECT * FROM canvas_edges WHERE id = ?').get(id) as CanvasEdge
}

export function deleteEdge(id: string): boolean {
  const db = getDatabase()
  const edge = db.prepare('SELECT project_id FROM canvas_edges WHERE id = ?').get(id) as any
  const result = db.prepare('DELETE FROM canvas_edges WHERE id = ?').run(id)
  if (edge) touchProject(edge.project_id)
  return result.changes > 0
}

export function deleteEdgesByNodeId(nodeId: string): number {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM canvas_edges WHERE source_node_id = ? OR target_node_id = ?').run(nodeId, nodeId)
  return result.changes
}

// === Bulk save (auto-save) ===

export function saveProjectState(projectId: string, nodes: { id: string; position_x: number; position_y: number; data: Record<string, any> }[]): void {
  const db = getDatabase()
  const nodeStmt = db.prepare('UPDATE canvas_nodes SET position_x = ?, position_y = ?, data = ? WHERE id = ? AND project_id = ?')
  const transaction = db.transaction(() => {
    for (const n of nodes) {
      nodeStmt.run(n.position_x, n.position_y, JSON.stringify(n.data), n.id, projectId)
    }
  })
  transaction()
  touchProject(projectId)
}

function touchProject(projectId: string): void {
  const db = getDatabase()
  db.prepare('UPDATE canvas_projects SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), projectId)
}

// === Export / Import (v1) ===
//
// 设计参见 src/shared/canvas-export.ts。核心要点：
//   - 文件 JSON-only，不打包图片字节（用户明确选择「只要 prompt + 节点结构」）
//   - provider/model 按显示名导出/匹配，跨设备共享时本地 UUID 不会失配
//   - edge 用节点数组下标引用，避免 ID 映射表
//   - node.data 由 stripRuntimeFields/freshRuntimeFields 通用处理（黑名单方式）

/**
 * 通过 provider id 反查 provider 显示名 + 该 provider 内 model 的显示名。
 * model_providers.models 字段是 JSON 数组，元素可能是 string 也可能是 { id, name } 对象。
 */
function resolveProviderModelNames(
  providerId: string,
  modelId: string
): { providerName: string; modelName: string } {
  if (!providerId) return { providerName: '', modelName: '' }
  const db = getDatabase()
  const row = db
    .prepare('SELECT name, models FROM model_providers WHERE id = ?')
    .get(providerId) as { name: string; models: string } | undefined
  if (!row) return { providerName: '', modelName: '' }
  let modelName = ''
  try {
    const models = JSON.parse(row.models || '[]')
    if (Array.isArray(models)) {
      for (const m of models) {
        const mid = typeof m === 'string' ? m : m?.id ?? ''
        if (mid === modelId) {
          modelName = typeof m === 'string' ? m : (m?.name ?? mid)
          break
        }
      }
    }
  } catch {
    // ignore parse errors
  }
  return { providerName: row.name, modelName: modelName || modelId }
}

/**
 * 按显示名反查本机 provider id + model id。匹配不上返回空字符串，
 * 由前端提示用户在导入后手工重选 provider/model。
 */
function resolveProviderModelIds(
  providerName: string,
  modelName: string
): { providerId: string; modelId: string } {
  if (!providerName) return { providerId: '', modelId: '' }
  const db = getDatabase()
  const row = db
    .prepare('SELECT id, models FROM model_providers WHERE name = ?')
    .get(providerName) as { id: string; models: string } | undefined
  if (!row) return { providerId: '', modelId: '' }
  if (!modelName) return { providerId: row.id, modelId: '' }
  let modelId = ''
  try {
    const models = JSON.parse(row.models || '[]')
    if (Array.isArray(models)) {
      for (const m of models) {
        const name = typeof m === 'string' ? m : (m?.name ?? m?.id ?? '')
        const id = typeof m === 'string' ? m : (m?.id ?? '')
        if (name === modelName || id === modelName) {
          modelId = id
          break
        }
      }
    }
  } catch {
    // ignore parse errors
  }
  return { providerId: row.id, modelId }
}

/**
 * 导出一组项目为可分享的 JSON 文件结构。不写盘，由 IPC handler 弹保存对话框后写盘。
 *
 * @param ids 要导出的 project_id 列表（顺序保持）
 * @param appVersion 写入文件 exportedFrom 字段的程序版本号
 */
export function exportProjects(ids: string[], appVersion: string): CanvasExportFile {
  const projects: ExportedProject[] = []

  for (const id of ids) {
    const project = getProject(id)
    if (!project) continue

    const textRefs = resolveProviderModelNames(project.text_provider_id, project.text_model_id)
    const imageRefs = resolveProviderModelNames(project.image_provider_id, project.image_model_id)

    const nodes = listNodes(id)
    const edges = listEdges(id)

    const exportedNodes: ExportedNode[] = nodes.map((n) => ({
      type: n.type,
      position_x: n.position_x,
      position_y: n.position_y,
      width: n.width,
      height: n.height,
      data: stripRuntimeFields(n.data || {}),
    }))

    const nodeIndexById = new Map<string, number>()
    nodes.forEach((n, idx) => nodeIndexById.set(n.id, idx))

    const exportedEdges: ExportedEdge[] = edges.flatMap((e) => {
      const si = nodeIndexById.get(e.source_node_id)
      const ti = nodeIndexById.get(e.target_node_id)
      if (si === undefined || ti === undefined) return []
      return [{
        source_node_index: si,
        target_node_index: ti,
        source_handle: e.source_handle,
        target_handle: e.target_handle,
      }]
    })

    projects.push({
      title: project.title,
      system_prompt: project.system_prompt || '',
      concurrency: project.concurrency || 1,
      text_provider_name: textRefs.providerName,
      text_model_name: textRefs.modelName,
      image_provider_name: imageRefs.providerName,
      image_model_name: imageRefs.modelName,
      nodes: exportedNodes,
      edges: exportedEdges,
    })
  }

  return {
    schemaVersion: CANVAS_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    exportedFrom: `local-agent ${appVersion}`,
    projects,
  }
}

export interface ImportUnmatchedRef {
  project: string
  field: 'text_provider' | 'text_model' | 'image_provider' | 'image_model'
  name: string
}

export interface ImportResult {
  newProjectIds: string[]
  newProjectTitles: string[]
  unmatched: ImportUnmatchedRef[]
}

/**
 * 导入一份已校验的 export 文件。每个项目都会生成新 UUID + 新 title 后缀，
 * 永远不覆盖已有项目，避免误操作。
 */
export function importProjects(file: CanvasExportFile): ImportResult {
  const error = validateExportFile(file)
  if (error) throw new Error(error)

  const newProjectIds: string[] = []
  const newProjectTitles: string[] = []
  const unmatched: ImportUnmatchedRef[] = []

  for (const exported of file.projects) {
    const textRefs = resolveProviderModelIds(exported.text_provider_name, exported.text_model_name)
    const imageRefs = resolveProviderModelIds(exported.image_provider_name, exported.image_model_name)

    if (exported.text_provider_name && !textRefs.providerId) {
      unmatched.push({ project: exported.title, field: 'text_provider', name: exported.text_provider_name })
    }
    if (exported.text_model_name && !textRefs.modelId) {
      unmatched.push({ project: exported.title, field: 'text_model', name: exported.text_model_name })
    }
    if (exported.image_provider_name && !imageRefs.providerId) {
      unmatched.push({ project: exported.title, field: 'image_provider', name: exported.image_provider_name })
    }
    if (exported.image_model_name && !imageRefs.modelId) {
      unmatched.push({ project: exported.title, field: 'image_model', name: exported.image_model_name })
    }

    const newTitle = makeUniqueImportTitle(exported.title)

    const project = createProject({
      title: newTitle,
      text_provider_id: textRefs.providerId,
      text_model_id: textRefs.modelId,
      image_provider_id: imageRefs.providerId,
      image_model_id: imageRefs.modelId,
      concurrency: exported.concurrency || 1,
      system_prompt: exported.system_prompt || '',
    })

    // 节点：导出的下标 → 新 nodeId 映射
    const newNodeIds: string[] = []
    for (const en of exported.nodes) {
      const refilled = freshRuntimeFields(en.type, en.data || {})
      const created = createNode(project.id, {
        type: en.type,
        position_x: en.position_x,
        position_y: en.position_y,
        width: en.width || 240,
        height: en.height || 0,
        data: refilled,
      })
      newNodeIds.push(created.id)
    }

    // 边：用下标查新 nodeId
    for (const ee of exported.edges) {
      const sourceId = newNodeIds[ee.source_node_index]
      const targetId = newNodeIds[ee.target_node_index]
      if (!sourceId || !targetId) continue
      try {
        createEdge(project.id, {
          source_node_id: sourceId,
          source_handle: ee.source_handle,
          target_node_id: targetId,
          target_handle: ee.target_handle,
        })
      } catch {
        // 跳过单条冲突边，不阻塞整批导入
      }
    }

    newProjectIds.push(project.id)
    newProjectTitles.push(newTitle)
  }

  return { newProjectIds, newProjectTitles, unmatched }
}

/**
 * 生成不和已有项目重名的标题。第一次冲突加 " (导入)"，再冲突加 " (导入 2)" / " (导入 3)" ...
 */
function makeUniqueImportTitle(base: string): string {
  const db = getDatabase()
  const stmt = db.prepare('SELECT id FROM canvas_projects WHERE title = ?')
  let candidate = `${base} (导入)`
  if (!stmt.get(candidate)) return candidate
  for (let n = 2; n < 1000; n++) {
    candidate = `${base} (导入 ${n})`
    if (!stmt.get(candidate)) return candidate
  }
  return `${base} (导入 ${Date.now()})`
}
