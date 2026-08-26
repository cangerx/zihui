import { getDatabase } from '../database'
import { v4 as uuid } from 'uuid'
import { skillPresets } from './skill-presets'

export interface Skill {
  id: string
  name: string
  description: string
  function_def: any
  implementation: string
  source: string
  version: string
  enabled: boolean
  is_builtin: boolean
  /** 脱离沙箱：1=放开文件/命令路径限制（仍在 vm 隔离中运行）。仅自定义工具可开。 */
  unsandboxed: boolean
  created_at: string
}

/**
 * 内置 skill 不允许删除时抛出的错误标识。
 * IPC handler 捕获后转成用户可读提示。
 */
export class BuiltinSkillProtectedError extends Error {
  constructor(message = '内置预设不可删除') {
    super(message)
    this.name = 'BuiltinSkillProtectedError'
  }
}

/**
 * function_def.name 已被占用时抛出。
 * 拦截「同一预设多次添加」「import 重复条目」「自定义新建撞内置名」等场景。
 */
export class SkillNameConflictError extends Error {
  constructor(public readonly fnName: string) {
    super(`已存在同名工具：${fnName}`)
    this.name = 'SkillNameConflictError'
  }
}

function parseSkill(row: any): Skill {
  return {
    ...row,
    function_def: JSON.parse(row.function_def || '{}'),
    enabled: Boolean(row.enabled),
    is_builtin: Boolean(row.is_builtin),
    unsandboxed: Boolean(row.unsandboxed)
  }
}

export function listSkills(): Skill[] {
  const db = getDatabase()
  // 内置预设置顶，其它按创建时间倒序
  const rows = db
    .prepare('SELECT * FROM skills ORDER BY is_builtin DESC, created_at DESC')
    .all() as any[]
  return rows.map(parseSkill)
}

export function getSkill(id: string): Skill | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as any
  if (!row) return null
  return parseSkill(row)
}

/**
 * 根据 function_def.name 查找已存在的 skill（用于查重）。
 * 用 json_extract 而非 LIKE，避免误匹配 description 里出现同名字符串。
 */
function findSkillByFunctionName(fnName: string): Skill | null {
  if (!fnName) return null
  const db = getDatabase()
  const row = db
    .prepare("SELECT * FROM skills WHERE json_extract(function_def, '$.name') = ?")
    .get(fnName) as any
  if (!row) return null
  return parseSkill(row)
}

export function createSkill(data: {
  name: string
  description: string
  function_def: any
  implementation: string
  source?: string
  version?: string
  unsandboxed?: boolean
}): Skill {
  const fnName = data.function_def?.name as string | undefined
  if (fnName && findSkillByFunctionName(fnName)) {
    throw new SkillNameConflictError(fnName)
  }
  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO skills (id, name, description, function_def, implementation, source, version, unsandboxed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    data.name,
    data.description,
    JSON.stringify(data.function_def),
    data.implementation,
    data.source || 'local',
    data.version || '1.0.0',
    data.unsandboxed ? 1 : 0,
    now
  )
  return getSkill(id)!
}

/**
 * 启动时注入内置 skill 预设。
 * 用预设固定 ID 做 INSERT OR IGNORE：
 *   - id 已存在 → 跳过，保留用户已编辑的实现
 *   - id 不存在 + function_def.name 已被用户占用 → 也跳过，避免重名冲突
 * 这样老用户的存量数据完全不受影响。
 */
export function seedBuiltinSkillPresets(): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  const insert = db.prepare(
    'INSERT OR IGNORE INTO skills (id, name, description, function_def, implementation, source, version, enabled, is_builtin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  // 兼容修复：早期开发版本可能写入了 builtin_* ID 但 is_builtin = 0
  // 仅对 ID 完全命中预设的行回填标志，不影响用户自建数据
  const fixBuiltinFlag = db.prepare(
    "UPDATE skills SET is_builtin = 1, source = 'builtin' WHERE id = ? AND is_builtin = 0"
  )
  for (const preset of skillPresets) {
    const existing = db.prepare('SELECT id, is_builtin FROM skills WHERE id = ?').get(preset.id) as
      | { id: string; is_builtin: number }
      | undefined
    if (existing) {
      if (!existing.is_builtin) fixBuiltinFlag.run(preset.id)
      continue
    }
    // 用户已用 UUID 自建了同 function name 的 skill：保留用户的，不再注入内置
    if (findSkillByFunctionName(preset.function_def.name)) continue
    insert.run(
      preset.id,
      preset.name,
      preset.description,
      JSON.stringify(preset.function_def),
      preset.implementation,
      'builtin',
      '1.0.0',
      1,
      1,
      now
    )
  }
}

export function updateSkill(
  id: string,
  data: Partial<{
    name: string
    description: string
    function_def: any
    implementation: string
    enabled: boolean
    unsandboxed: boolean
  }>
): Skill | null {
  const db = getDatabase()
  const existing = getSkill(id)
  if (!existing) return null

  // 安全约束：内置预设强制留在沙箱内，不允许通过本接口被改成脱离沙箱。
  const nextUnsandboxed = existing.is_builtin
    ? false
    : data.unsandboxed !== undefined
      ? data.unsandboxed
      : existing.unsandboxed

  db.prepare(
    'UPDATE skills SET name=?, description=?, function_def=?, implementation=?, enabled=?, unsandboxed=? WHERE id=?'
  ).run(
    data.name ?? existing.name,
    data.description ?? existing.description,
    JSON.stringify(data.function_def ?? existing.function_def),
    data.implementation ?? existing.implementation,
    data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled ? 1 : 0,
    nextUnsandboxed ? 1 : 0,
    id
  )
  return getSkill(id)
}

export function deleteSkill(id: string): boolean {
  const db = getDatabase()
  const existing = getSkill(id)
  if (!existing) return false
  if (existing.is_builtin) {
    throw new BuiltinSkillProtectedError()
  }
  const result = db.prepare('DELETE FROM skills WHERE id = ?').run(id)
  if (result.changes > 0) {
    const bots = db.prepare("SELECT id, skill_ids FROM bots WHERE skill_ids LIKE '%' || ? || '%'").all(id) as any[]
    for (const bot of bots) {
      const ids: string[] = JSON.parse(bot.skill_ids || '[]')
      const filtered = ids.filter((sid: string) => sid !== id)
      if (filtered.length !== ids.length) {
        db.prepare('UPDATE bots SET skill_ids = ? WHERE id = ?').run(JSON.stringify(filtered), bot.id)
      }
    }
  }
  return result.changes > 0
}
