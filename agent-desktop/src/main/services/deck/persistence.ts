import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { getDatabase } from '../../database'

// deck 持久化：deck_projects / deck_slides / deck_assets 的 CRUD。
// 核心函数用依赖注入(db 参数, 默认取 getDatabase()), 便于以内存库单测。
// 账号代次守卫由 getDatabase() 内的 assertEpoch() 提供(防热切账号串数据)。

type DB = Database.Database

export interface DeckProjectRow {
  id: string
  title: string
  text_provider_id: string
  text_model_id: string
  image_provider_id: string
  image_model_id: string
  theme_id: string
  template_id: string
  style_family: string
  grammar: string
  outline: string
  status: string
  aspect_ratio: string
  system_prompt: string
  created_at: string
  updated_at: string
}

export interface DeckSlideRow {
  id: string
  project_id: string
  sort_order: number
  layout: string
  ir: string
  html: string
  notes: string
  image_path: string
  render_path: string
  review: string
  status: string
  created_at: string
  updated_at: string
}

export interface DeckAssetRow {
  id: string
  project_id: string
  kind: string
  local_path: string
  file_size: number
  status: string
  error: string
  created_at: string
}

export interface CreateProjectInput {
  title?: string
  theme_id?: string
  template_id?: string
  style_family?: string
  text_provider_id?: string
  text_model_id?: string
  image_provider_id?: string
  image_model_id?: string
  aspect_ratio?: string
  system_prompt?: string
}

// ---------------- projects ----------------

export function createProject(input: CreateProjectInput = {}, db: DB = getDatabase()): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO deck_projects
       (id,title,theme_id,template_id,style_family,text_provider_id,text_model_id,image_provider_id,image_model_id,aspect_ratio,system_prompt)
     VALUES (@id,@title,@theme_id,@template_id,@style_family,@text_provider_id,@text_model_id,@image_provider_id,@image_model_id,@aspect_ratio,@system_prompt)`
  ).run({
    id,
    title: input.title ?? '未命名演示',
    theme_id: input.theme_id ?? 'editorial-serif',
    template_id: input.template_id ?? '',
    style_family: input.style_family ?? '',
    text_provider_id: input.text_provider_id ?? '',
    text_model_id: input.text_model_id ?? '',
    image_provider_id: input.image_provider_id ?? '',
    image_model_id: input.image_model_id ?? '',
    aspect_ratio: input.aspect_ratio ?? '16:9',
    system_prompt: input.system_prompt ?? ''
  })
  return id
}

export function getProject(id: string, db: DB = getDatabase()): DeckProjectRow | undefined {
  return db.prepare('SELECT * FROM deck_projects WHERE id = ?').get(id) as DeckProjectRow | undefined
}

export function listProjects(db: DB = getDatabase()): DeckProjectRow[] {
  return db
    .prepare('SELECT * FROM deck_projects ORDER BY updated_at DESC')
    .all() as DeckProjectRow[]
}

export function updateProjectOutline(id: string, outline: unknown, db: DB = getDatabase()): void {
  db.prepare("UPDATE deck_projects SET outline = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(outline),
    id
  )
}

/** 写入/更新 deck 级 grammar(showcase 确立后贯穿全 deck 的设计语法) */
export function updateProjectGrammar(id: string, grammar: unknown, db: DB = getDatabase()): void {
  db.prepare("UPDATE deck_projects SET grammar = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(grammar),
    id
  )
}

const PROJECT_PATCH_FIELDS = [
  'title',
  'theme_id',
  'template_id',
  'style_family',
  'status',
  'aspect_ratio',
  'system_prompt'
] as const

export function updateProject(
  id: string,
  patch: Partial<Pick<DeckProjectRow, (typeof PROJECT_PATCH_FIELDS)[number]>>,
  db: DB = getDatabase()
): void {
  const sets: string[] = []
  const vals: unknown[] = []
  for (const f of PROJECT_PATCH_FIELDS) {
    const v = patch[f]
    if (v !== undefined) {
      sets.push(`${f} = ?`)
      vals.push(v)
    }
  }
  if (sets.length === 0) return
  sets.push("updated_at = datetime('now')")
  vals.push(id)
  db.prepare(`UPDATE deck_projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function deleteProject(id: string, db: DB = getDatabase()): void {
  // FK ON DELETE CASCADE 级联清理 slides/assets(需 pragma foreign_keys=ON, 主库已开)
  db.prepare('DELETE FROM deck_projects WHERE id = ?').run(id)
}

// ---------------- slides ----------------

export interface CreateSlideInput {
  project_id: string
  sort_order?: number
  layout?: string
  ir?: unknown
  html?: string
  notes?: string
}

export function createSlide(input: CreateSlideInput, db: DB = getDatabase()): string {
  const id = randomUUID()
  const order =
    input.sort_order ??
    ((
      db
        .prepare('SELECT COALESCE(MAX(sort_order)+1,0) n FROM deck_slides WHERE project_id = ?')
        .get(input.project_id) as { n: number }
    ).n)
  db.prepare(
    `INSERT INTO deck_slides (id,project_id,sort_order,layout,ir,html,notes)
     VALUES (@id,@project_id,@sort_order,@layout,@ir,@html,@notes)`
  ).run({
    id,
    project_id: input.project_id,
    sort_order: order,
    layout: input.layout ?? '',
    ir: JSON.stringify(input.ir ?? {}),
    html: input.html ?? '',
    notes: input.notes ?? ''
  })
  return id
}

export function listSlides(projectId: string, db: DB = getDatabase()): DeckSlideRow[] {
  return db
    .prepare('SELECT * FROM deck_slides WHERE project_id = ? ORDER BY sort_order ASC')
    .all(projectId) as DeckSlideRow[]
}

const SLIDE_PATCH_FIELDS = [
  'sort_order',
  'layout',
  'html',
  'notes',
  'image_path',
  'render_path',
  'status'
] as const

export function updateSlide(
  id: string,
  patch: Partial<Pick<DeckSlideRow, (typeof SLIDE_PATCH_FIELDS)[number]>> & {
    ir?: unknown
    review?: unknown
  },
  db: DB = getDatabase()
): void {
  const sets: string[] = []
  const vals: unknown[] = []
  for (const f of SLIDE_PATCH_FIELDS) {
    const v = patch[f]
    if (v !== undefined) {
      sets.push(`${f} = ?`)
      vals.push(v)
    }
  }
  if (patch.ir !== undefined) {
    sets.push('ir = ?')
    vals.push(JSON.stringify(patch.ir))
  }
  if (patch.review !== undefined) {
    sets.push('review = ?')
    vals.push(JSON.stringify(patch.review))
  }
  if (sets.length === 0) return
  sets.push("updated_at = datetime('now')")
  vals.push(id)
  db.prepare(`UPDATE deck_slides SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function deleteSlide(id: string, db: DB = getDatabase()): void {
  db.prepare('DELETE FROM deck_slides WHERE id = ?').run(id)
}

/** 按给定 id 顺序重排 sort_order(事务) */
export function reorderSlides(projectId: string, orderedIds: string[], db: DB = getDatabase()): void {
  const stmt = db.prepare(
    "UPDATE deck_slides SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?"
  )
  const tx = db.transaction((ids: string[]) => {
    ids.forEach((sid, i) => stmt.run(i, sid, projectId))
  })
  tx(orderedIds)
}

// ---------------- assets ----------------

export function addAsset(
  input: { project_id: string; kind: string; local_path: string; file_size?: number; status?: string },
  db: DB = getDatabase()
): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO deck_assets (id,project_id,kind,local_path,file_size,status)
     VALUES (@id,@project_id,@kind,@local_path,@file_size,@status)`
  ).run({
    id,
    project_id: input.project_id,
    kind: input.kind,
    local_path: input.local_path,
    file_size: input.file_size ?? 0,
    status: input.status ?? 'ready'
  })
  return id
}

export function listAssets(projectId: string, db: DB = getDatabase()): DeckAssetRow[] {
  return db
    .prepare('SELECT * FROM deck_assets WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as DeckAssetRow[]
}
