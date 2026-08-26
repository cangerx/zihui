import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import { callLLM } from './llm'
import { runInEpoch } from './account-epoch'
import { getWorkspace, getActiveWorkspace } from './agent-workspace'
import { getPromptSkillContent, listPromptSkills } from './prompt-skill'
import { notifyDesktop } from './desktop-notify'

export type ScheduleType = 'once' | 'daily' | 'weekly' | 'interval'

export interface ScheduledTask {
  id: string
  title: string
  prompt: string
  schedule_type: ScheduleType
  /** once=ISO；daily=HH:mm；weekly=HH:mm|weekday(0-6)；interval=分钟 */
  schedule_value: string
  enabled: number
  provider_id: string
  model_id: string
  workspace_id: string
  skill_dir: string
  intra_repeat: number
  intra_end: string
  intra_interval_min: number
  next_run_at: string
  last_run_at: string
  created_at: string
  updated_at: string
}

export interface ScheduledTaskRun {
  id: string
  task_id: string
  task_title: string
  status: 'running' | 'ok' | 'error'
  content: string
  error: string
  started_at: string
  finished_at: string
}

export interface CreateTaskInput {
  title: string
  prompt: string
  scheduleType: ScheduleType
  scheduleValue: string
  providerId?: string
  modelId?: string
  enabled?: boolean
  workspaceId?: string
  skillDir?: string
  intraRepeat?: boolean
  intraEnd?: string
  intraIntervalMin?: number
}

function ensureColumns(): void {
  const db = getDatabase()
  const cols = (db.prepare('PRAGMA table_info(scheduled_tasks)').all() as any[]).map((c) => c.name)
  const add = (name: string, ddl: string) => {
    if (!cols.includes(name)) db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN ${ddl}`)
  }
  add('workspace_id', "workspace_id TEXT NOT NULL DEFAULT ''")
  add('skill_dir', "skill_dir TEXT NOT NULL DEFAULT ''")
  add('intra_repeat', 'intra_repeat INTEGER NOT NULL DEFAULT 0')
  add('intra_end', "intra_end TEXT NOT NULL DEFAULT ''")
  add('intra_interval_min', 'intra_interval_min INTEGER NOT NULL DEFAULT 60')
}

function parseHhMm(hhmm: string): { h: number; min: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim())
  return {
    h: m ? Math.min(23, Math.max(0, Number(m[1]))) : 9,
    min: m ? Math.min(59, Math.max(0, Number(m[2]))) : 0
  }
}

function nextDailyAt(hhmm: string, after = new Date()): Date {
  const { h, min } = parseHhMm(hhmm)
  const next = new Date(after)
  next.setSeconds(0, 0)
  next.setHours(h, min, 0, 0)
  if (next.getTime() <= after.getTime()) next.setDate(next.getDate() + 1)
  return next
}

/** weekly value: HH:mm|weekday(0=日..6=六) */
function parseWeekly(value: string): { hhmm: string; weekday: number } {
  const [hhmm, wd] = (value || '').split('|')
  const weekday = Math.min(6, Math.max(0, Number(wd ?? 1) || 1))
  return { hhmm: hhmm || '09:00', weekday }
}

function nextWeeklyAt(value: string, after = new Date()): Date {
  const { hhmm, weekday } = parseWeekly(value)
  const { h, min } = parseHhMm(hhmm)
  const next = new Date(after)
  next.setSeconds(0, 0)
  next.setHours(h, min, 0, 0)
  const delta = (weekday - next.getDay() + 7) % 7
  if (delta === 0 && next.getTime() <= after.getTime()) {
    next.setDate(next.getDate() + 7)
  } else {
    next.setDate(next.getDate() + delta)
  }
  return next
}

/** 周期内重复：同一天 start→end 按间隔推进；越界则跳到下一周期起点 */
function nextIntraAt(
  type: 'daily' | 'weekly',
  startHhmm: string,
  endHhmm: string,
  intervalMin: number,
  after: Date,
  weeklyValue?: string
): Date {
  const start = parseHhMm(startHhmm)
  const end = parseHhMm(endHhmm || '18:00')
  const interval = Math.max(1, Math.min(24 * 60, intervalMin || 60))
  const candidate = new Date(after.getTime() + interval * 60_000)
  candidate.setSeconds(0, 0)

  const endToday = new Date(after)
  endToday.setHours(end.h, end.min, 0, 0)

  if (candidate.getTime() <= endToday.getTime() && candidate.getDate() === after.getDate()) {
    return candidate
  }
  if (type === 'weekly' && weeklyValue) {
    return nextWeeklyAt(weeklyValue, after)
  }
  return nextDailyAt(startHhmm, after)
}

export function computeNextRunAt(
  type: ScheduleType,
  value: string,
  after = new Date(),
  opts?: { intraRepeat?: boolean; intraEnd?: string; intraIntervalMin?: number }
): string {
  if (type === 'once') {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return ''
    return d.toISOString()
  }
  if (type === 'weekly') {
    if (opts?.intraRepeat) {
      const { hhmm } = parseWeekly(value)
      return nextIntraAt(
        'weekly',
        hhmm,
        opts.intraEnd || '18:00',
        opts.intraIntervalMin || 60,
        after,
        value
      ).toISOString()
    }
    return nextWeeklyAt(value, after).toISOString()
  }
  if (type === 'daily') {
    if (opts?.intraRepeat) {
      return nextIntraAt(
        'daily',
        value,
        opts.intraEnd || '18:00',
        opts.intraIntervalMin || 60,
        after
      ).toISOString()
    }
    return nextDailyAt(value, after).toISOString()
  }
  const minutes = Math.max(1, Math.min(7 * 24 * 60, Number(value) || 60))
  return new Date(after.getTime() + minutes * 60_000).toISOString()
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function describeSchedule(
  type: ScheduleType,
  value: string,
  opts?: { intraRepeat?: boolean; intraEnd?: string; intraIntervalMin?: number }
): string {
  let base = ''
  if (type === 'once') {
    const d = new Date(value)
    base = Number.isNaN(d.getTime()) ? '一次性（时间无效）' : `一次性 · ${d.toLocaleString()}`
  } else if (type === 'daily') {
    base = `每天 ${value || '09:00'}`
  } else if (type === 'weekly') {
    const { hhmm, weekday } = parseWeekly(value)
    base = `每${WEEKDAY_LABELS[weekday] || '周'} ${hhmm}`
  } else {
    const n = Number(value) || 60
    base = `每 ${n} 分钟`
  }
  if (opts?.intraRepeat) {
    base += ` · 周期内每 ${opts.intraIntervalMin || 60} 分钟（至 ${opts.intraEnd || '18:00'}）`
  }
  return base
}

function mapRow(row: any): ScheduledTask {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    schedule_type: row.schedule_type,
    schedule_value: row.schedule_value,
    enabled: Number(row.enabled || 0),
    provider_id: row.provider_id || '',
    model_id: row.model_id || '',
    workspace_id: row.workspace_id || '',
    skill_dir: row.skill_dir || '',
    intra_repeat: Number(row.intra_repeat || 0),
    intra_end: row.intra_end || '',
    intra_interval_min: Number(row.intra_interval_min || 60),
    next_run_at: row.next_run_at || '',
    last_run_at: row.last_run_at || '',
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

export function listTasks(): ScheduledTask[] {
  ensureColumns()
  const db = getDatabase()
  return (db.prepare('SELECT * FROM scheduled_tasks ORDER BY updated_at DESC').all() as any[]).map(
    mapRow
  )
}

export function getTask(id: string): ScheduledTask | null {
  ensureColumns()
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as any
  return row ? mapRow(row) : null
}

export function createTask(input: CreateTaskInput): ScheduledTask {
  ensureColumns()
  const now = new Date()
  const id = randomUUID()
  const scheduleType = input.scheduleType
  const scheduleValue = (input.scheduleValue || '').trim()
  const intraRepeat = !!input.intraRepeat
  const intraEnd = (input.intraEnd || '18:00').trim()
  const intraIntervalMin = Math.max(1, Number(input.intraIntervalMin) || 60)
  const nextRun = computeNextRunAt(scheduleType, scheduleValue, now, {
    intraRepeat,
    intraEnd,
    intraIntervalMin
  })
  let workspaceId = (input.workspaceId || '').trim()
  if (!workspaceId) {
    try {
      workspaceId = getActiveWorkspace().id
    } catch {
      workspaceId = ''
    }
  }
  const row: ScheduledTask = {
    id,
    title: (input.title || '未命名任务').trim() || '未命名任务',
    prompt: (input.prompt || '').trim(),
    schedule_type: scheduleType,
    schedule_value: scheduleValue,
    enabled: input.enabled === false ? 0 : 1,
    provider_id: input.providerId || '',
    model_id: input.modelId || '',
    workspace_id: workspaceId,
    skill_dir: (input.skillDir || '').trim(),
    intra_repeat: intraRepeat ? 1 : 0,
    intra_end: intraEnd,
    intra_interval_min: intraIntervalMin,
    next_run_at: nextRun,
    last_run_at: '',
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  }
  const db = getDatabase()
  db.prepare(
    `INSERT INTO scheduled_tasks
      (id, title, prompt, schedule_type, schedule_value, enabled, provider_id, model_id,
       workspace_id, skill_dir, intra_repeat, intra_end, intra_interval_min,
       next_run_at, last_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.title,
    row.prompt,
    row.schedule_type,
    row.schedule_value,
    row.enabled,
    row.provider_id,
    row.model_id,
    row.workspace_id,
    row.skill_dir,
    row.intra_repeat,
    row.intra_end,
    row.intra_interval_min,
    row.next_run_at,
    row.last_run_at,
    row.created_at,
    row.updated_at
  )
  return row
}

export function updateTask(
  id: string,
  patch: Partial<{
    title: string
    prompt: string
    scheduleType: ScheduleType
    scheduleValue: string
    providerId: string
    modelId: string
    enabled: boolean
    workspaceId: string
    skillDir: string
    intraRepeat: boolean
    intraEnd: string
    intraIntervalMin: number
  }>
): ScheduledTask | null {
  ensureColumns()
  const cur = getTask(id)
  if (!cur) return null
  const title = patch.title !== undefined ? patch.title.trim() || cur.title : cur.title
  const prompt = patch.prompt !== undefined ? patch.prompt.trim() : cur.prompt
  const scheduleType = patch.scheduleType ?? cur.schedule_type
  const scheduleValue =
    patch.scheduleValue !== undefined ? patch.scheduleValue.trim() : cur.schedule_value
  const enabled = patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : cur.enabled
  const providerId = patch.providerId !== undefined ? patch.providerId : cur.provider_id
  const modelId = patch.modelId !== undefined ? patch.modelId : cur.model_id
  const workspaceId = patch.workspaceId !== undefined ? patch.workspaceId : cur.workspace_id
  const skillDir = patch.skillDir !== undefined ? patch.skillDir : cur.skill_dir
  const intraRepeat =
    patch.intraRepeat !== undefined ? (patch.intraRepeat ? 1 : 0) : cur.intra_repeat
  const intraEnd = patch.intraEnd !== undefined ? patch.intraEnd.trim() : cur.intra_end
  const intraIntervalMin =
    patch.intraIntervalMin !== undefined
      ? Math.max(1, Number(patch.intraIntervalMin) || 60)
      : cur.intra_interval_min
  const scheduleChanged =
    scheduleType !== cur.schedule_type ||
    scheduleValue !== cur.schedule_value ||
    intraRepeat !== cur.intra_repeat ||
    intraEnd !== cur.intra_end ||
    intraIntervalMin !== cur.intra_interval_min
  const nextRun = scheduleChanged
    ? computeNextRunAt(scheduleType, scheduleValue, new Date(), {
        intraRepeat: !!intraRepeat,
        intraEnd,
        intraIntervalMin
      })
    : cur.next_run_at
  const updatedAt = new Date().toISOString()
  const db = getDatabase()
  db.prepare(
    `UPDATE scheduled_tasks SET
      title=?, prompt=?, schedule_type=?, schedule_value=?, enabled=?,
      provider_id=?, model_id=?, workspace_id=?, skill_dir=?,
      intra_repeat=?, intra_end=?, intra_interval_min=?,
      next_run_at=?, updated_at=?
     WHERE id=?`
  ).run(
    title,
    prompt,
    scheduleType,
    scheduleValue,
    enabled,
    providerId,
    modelId,
    workspaceId,
    skillDir,
    intraRepeat,
    intraEnd,
    intraIntervalMin,
    nextRun,
    updatedAt,
    id
  )
  return getTask(id)
}

export function deleteTask(id: string): boolean {
  const db = getDatabase()
  db.prepare('DELETE FROM scheduled_task_runs WHERE task_id = ?').run(id)
  const r = db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id)
  return r.changes > 0
}

export function listRuns(limit = 100): ScheduledTaskRun[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT r.*, COALESCE(t.title, '') AS task_title
       FROM scheduled_task_runs r
       LEFT JOIN scheduled_tasks t ON t.id = r.task_id
       ORDER BY r.started_at DESC
       LIMIT ?`
    )
    .all(limit) as ScheduledTaskRun[]
}

export function getRun(id: string): ScheduledTaskRun | null {
  const db = getDatabase()
  return (
    (db
      .prepare(
        `SELECT r.*, COALESCE(t.title, '') AS task_title
         FROM scheduled_task_runs r
         LEFT JOIN scheduled_tasks t ON t.id = r.task_id
         WHERE r.id = ?`
      )
      .get(id) as ScheduledTaskRun) || null
  )
}

function advanceAfterRun(task: ScheduledTask, from: Date): string {
  if (task.schedule_type === 'once') return ''
  return computeNextRunAt(task.schedule_type, task.schedule_value, from, {
    intraRepeat: !!task.intra_repeat,
    intraEnd: task.intra_end,
    intraIntervalMin: task.intra_interval_min
  })
}

let runningIds = new Set<string>()

export async function executeTask(
  taskId: string,
  opts?: { manual?: boolean }
): Promise<ScheduledTaskRun> {
  ensureColumns()
  const task = getTask(taskId)
  if (!task) throw new Error('任务不存在')
  if (runningIds.has(taskId)) throw new Error('任务正在执行中')

  const runId = randomUUID()
  const startedAt = new Date().toISOString()
  const db = getDatabase()
  db.prepare(
    `INSERT INTO scheduled_task_runs (id, task_id, status, content, error, started_at, finished_at)
     VALUES (?, ?, 'running', '', '', ?, '')`
  ).run(runId, taskId, startedAt)

  runningIds.add(taskId)
  try {
    if (!task.prompt.trim()) throw new Error('任务提示词为空')
    if (!task.provider_id || !task.model_id) throw new Error('请先为任务选择对话模型')

    let workspacePath = ''
    let workspaceName = ''
    if (task.workspace_id) {
      const ws = getWorkspace(task.workspace_id)
      if (ws) {
        workspacePath = ws.root_path
        workspaceName = ws.name
      }
    }
    if (!workspacePath) {
      try {
        const active = getActiveWorkspace()
        workspacePath = active.root_path
        workspaceName = active.name
      } catch {
        /* ignore */
      }
    }

    let skillBlock = ''
    if (task.skill_dir) {
      try {
        const skill = listPromptSkills().find((s) => s.dirName === task.skill_dir)
        const content = getPromptSkillContent(task.skill_dir)
        if (content) {
          skillBlock = `\n\n[启用的 Skill: ${skill?.name || task.skill_dir}]\n${content}`
        }
      } catch (e) {
        console.error('[scheduled-tasks] load skill failed:', e)
      }
    }

    const systemParts = [
      '你是本地 AI 工作台的自动化执行器。按用户给出的任务说明完成工作，用简洁中文输出结果。',
      workspacePath
        ? `[执行工作区]: ${workspaceName || '工作区'}\n- 根目录: ${workspacePath}\n- 请结合该目录语境完成任务（如需引用路径请用此根目录）`
        : '',
      skillBlock
    ].filter(Boolean)

    const result = await callLLM(
      task.provider_id,
      {
        modelId: task.model_id,
        messages: [
          { role: 'system', content: systemParts.join('\n\n') },
          { role: 'user', content: task.prompt }
        ],
        stream: false,
        notifyStream: false,
        temperature: 0.4,
        max_tokens: 4096
      },
      undefined
    )

    const content = (result.content || '').trim() || '（模型未返回内容）'
    const finishedAt = new Date().toISOString()
    db.prepare(
      `UPDATE scheduled_task_runs SET status='ok', content=?, error='', finished_at=? WHERE id=?`
    ).run(content, finishedAt, runId)

    const nextRun = advanceAfterRun(task, new Date())
    const enabled = task.schedule_type === 'once' ? 0 : task.enabled
    db.prepare(
      `UPDATE scheduled_tasks SET last_run_at=?, next_run_at=?, enabled=?, updated_at=? WHERE id=?`
    ).run(finishedAt, nextRun, enabled, finishedAt, taskId)

    maybeNotifyTaskResult(task, 'ok')
    notifyRenderer()
    return getRun(runId)!
  } catch (e: any) {
    const finishedAt = new Date().toISOString()
    const err = e?.message || String(e)
    db.prepare(
      `UPDATE scheduled_task_runs SET status='error', content='', error=?, finished_at=? WHERE id=?`
    ).run(err, finishedAt, runId)

    const nextRun = opts?.manual ? task.next_run_at : advanceAfterRun(task, new Date())
    const enabled = !opts?.manual && task.schedule_type === 'once' ? 0 : task.enabled
    db.prepare(
      `UPDATE scheduled_tasks SET last_run_at=?, next_run_at=?, enabled=?, updated_at=? WHERE id=?`
    ).run(finishedAt, nextRun, enabled, finishedAt, taskId)

    maybeNotifyTaskResult(task, 'error', err)
    notifyRenderer()
    return getRun(runId)!
  } finally {
    runningIds.delete(taskId)
  }
}

export async function runDueTasks(): Promise<number> {
  ensureColumns()
  const now = new Date().toISOString()
  const db = getDatabase()
  const due = db
    .prepare(
      `SELECT id FROM scheduled_tasks
       WHERE enabled = 1
         AND next_run_at != ''
         AND next_run_at <= ?
       ORDER BY next_run_at ASC
       LIMIT 5`
    )
    .all(now) as Array<{ id: string }>

  let count = 0
  for (const row of due) {
    if (runningIds.has(row.id)) continue
    try {
      await executeTask(row.id)
      count += 1
    } catch (e) {
      console.error('[scheduled-tasks] execute failed:', e)
    }
  }
  return count
}

function notifyRenderer(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.webContents.send('scheduledTasks:changed')
    } catch {
      /* ignore */
    }
  }
}

function anyWindowFocused(): boolean {
  return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible() && w.isFocused())
}

function maybeNotifyTaskResult(task: ScheduledTask, status: 'ok' | 'error', detail?: string): void {
  // 前台聚焦时不打扰；后台/收起时提醒
  if (anyWindowFocused()) return
  if (status === 'ok') {
    notifyDesktop('自动化已完成', task.title || '任务')
  } else {
    notifyDesktop('自动化失败', `${task.title || '任务'}${detail ? `：${detail.slice(0, 80)}` : ''}`)
  }
}

let tickTimer: ReturnType<typeof setInterval> | null = null

/** 自动化（定时任务）暂时下线：不启调度。恢复入口时改 true。 */
const SCHEDULED_TASKS_ENABLED = false

export function startScheduledTasksScheduler(intervalMs = 30_000): void {
  if (!SCHEDULED_TASKS_ENABLED) return
  if (tickTimer) return
  tickTimer = setInterval(() => {
    runInEpoch(() => {
      runDueTasks().catch((e) => console.error('[scheduled-tasks] tick failed:', e))
    })
  }, intervalMs)
  tickTimer.unref?.()
  setTimeout(() => {
    runInEpoch(() => {
      runDueTasks().catch((e) => console.error('[scheduled-tasks] startup tick failed:', e))
    })
  }, 5_000)
}

export function stopScheduledTasksScheduler(): void {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
}
