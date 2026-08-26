import { existsSync } from 'fs'
import { v4 as uuid } from 'uuid'
import { getDatabase } from '../database'
import { listEmployeeAssets, redactSensitiveText } from './digital-employee'

export type EmployeeTaskStatus = 'running' | 'completed' | 'failed' | 'canceled'

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value || '') as T } catch { return fallback }
}

function extractOutputRefs(content: string): string[] {
  const refs = new Set<string>()
  const markdown = /\[[^\]]*\]\(([^)]+)\)|`((?:[A-Za-z]:[\\/]|\/)[^`]+)`/g
  let match: RegExpExecArray | null
  while ((match = markdown.exec(content)) !== null) {
    const value = String(match[1] || match[2] || '').trim()
    if (value && !/^https?:/i.test(value)) refs.add(value)
  }
  return [...refs].slice(0, 100)
}

export function beginEmployeeTask(input: {
  botId: string
  conversationId: string
  workspaceId: string
  goal: string
}): string {
  const id = uuid()
  const now = new Date().toISOString()
  const versionIds = input.botId
    ? listEmployeeAssets(input.botId, input.workspaceId).map((asset) => asset.current_version_id).filter(Boolean)
    : []
  getDatabase().prepare(`INSERT INTO digital_employee_task_runs
    (id,bot_id,conversation_id,workspace_id,goal,asset_version_ids_json,started_at)
    VALUES (?,?,?,?,?,?,?)`
  ).run(id, input.botId || '', input.conversationId, input.workspaceId || '', redactSensitiveText(input.goal).slice(0, 4000), JSON.stringify(versionIds), now)
  return id
}

export function finishEmployeeTask(id: string, status: EmployeeTaskStatus, errorMessage = ''): void {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM digital_employee_task_runs WHERE id=?').get(id) as any
  if (!row || row.status !== 'running') return
  const latest = db.prepare("SELECT content FROM messages WHERE conversation_id=? AND role='assistant' ORDER BY rowid DESC LIMIT 1")
    .get(row.conversation_id) as any
  const outputRefs = extractOutputRefs(String(latest?.content || ''))
  const completed = new Date()
  const duration = Math.max(0, completed.getTime() - new Date(row.started_at).getTime())
  db.prepare(`UPDATE digital_employee_task_runs
    SET status=?,output_refs_json=?,error_message=?,completed_at=?,duration_ms=? WHERE id=?`
  ).run(status, JSON.stringify(outputRefs), redactSensitiveText(errorMessage).slice(0, 1000), completed.toISOString(), duration, id)
}

export function listEmployeeTasks(botId: string, limit = 100) {
  const rows = getDatabase().prepare('SELECT * FROM digital_employee_task_runs WHERE bot_id=? ORDER BY started_at DESC LIMIT ?')
    .all(botId, Math.min(500, Math.max(1, limit))) as any[]
  return rows.map((row) => ({
    ...row,
    asset_version_ids: parseJson(row.asset_version_ids_json, []),
    output_refs: parseJson(row.output_refs_json, []),
    approval_summary: parseJson(row.approval_summary_json, {}),
    output_checks: parseJson<string[]>(row.output_refs_json, []).map((ref) => ({ ref, exists: existsSync(ref) }))
  }))
}

export function getEmployeeTaskMetrics(botId: string) {
  const row = getDatabase().prepare(`SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
    SUM(CASE WHEN status='canceled' THEN 1 ELSE 0 END) AS canceled,
    AVG(CASE WHEN status='completed' THEN duration_ms END) AS average_duration_ms
    FROM digital_employee_task_runs WHERE bot_id=?`).get(botId) as any
  return {
    total: Number(row?.total || 0),
    completed: Number(row?.completed || 0),
    failed: Number(row?.failed || 0),
    canceled: Number(row?.canceled || 0),
    average_duration_ms: Math.round(Number(row?.average_duration_ms || 0))
  }
}
