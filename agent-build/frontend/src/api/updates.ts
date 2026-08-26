import { http } from './client'

// ============================================================
// 在线更新 SDK（agent-build 后台 → /admin/api/updates/*）
// 与 agent-admin 的 updateApi 同构，仅 baseURL 前缀不同。
// ============================================================

export interface WritableInfo {
  ok: boolean
  base_path: string
  php_user: string
  message: string
  fix_script: string
  bad_paths: string[]
}

export interface CheckResp {
  current: string
  current_released_at?: string
  latest: string
  released_at?: string
  upgradable: boolean
  is_latest?: boolean
  too_old?: boolean
  min_upgradable_from?: string
  breaking?: boolean
  zip_url: string
  sha256: string
  size: number
  changelog: string[]
  previous_versions?: { version: string; url?: string; sha256?: string; size?: number }[]
  running_log_id?: number | null
  writable?: WritableInfo
  error?: string
}

export interface UpdateLogItem {
  id: number
  from_version: string
  to_version: string
  status: 'running' | 'success' | 'failed'
  phase: string
  progress_percent: number
  zip_url: string
  zip_sha256: string
  zip_size: number
  backup_path: string
  operator_id: number
  operator_name: string
  started_at: string | null
  finished_at: string | null
  duration_seconds: number | null
  error_message: string | null
  created_at: string
  log: string | null
}

export interface ProgressResp {
  log: UpdateLogItem | null
  message?: string
}

export interface HistoryResp {
  data: UpdateLogItem[]
  total: number
  per_page: number
  current_page: number
}

export interface ApplyResp {
  log_id: number
  from_version: string
  to_version: string
  status: string
  phase: string
  progress_percent: number
  started_at: string | null
  message: string
}

export interface DbCheckData {
  ok: boolean
  migrations_total: number
  migrations_ran: number
  pending_migrations: string[]
  expected_tables: string[]
  missing_tables: string[]
  extra_tables: string[]
  checked_at: string
}

export interface DbRepairResult {
  success: boolean
  error: string
  output: string
  before: DbCheckData
  after: DbCheckData
}

export interface ReleaseItem {
  version: string
  released_at: string
  breaking: boolean
  changelog: string[]
  size: number
  sha256: string
  zip_url: string
}

export interface ReleasesResp {
  source: string
  updated_at: string
  current: string
  releases: ReleaseItem[]
  error: string
}

export const updateApi = {
  current: () => http.get<{ version: string; released_at: string; name: string; writable: WritableInfo }>('/admin/api/updates/current'),
  check: () => http.get<CheckResp>('/admin/api/updates/check'),
  apply: () => http.post<ApplyResp>('/admin/api/updates/apply'),
  progress: (logId?: number) =>
    http.get<ProgressResp>('/admin/api/updates/progress', { params: logId ? { log_id: logId } : {} }),
  history: (params?: Record<string, any>) => http.get<HistoryResp>('/admin/api/updates/history', { params }),
  dbCheck: () => http.get<DbCheckData>('/admin/api/updates/db-check'),
  dbRepair: () => http.post<DbRepairResult>('/admin/api/updates/db-repair'),
  releases: () => http.get<ReleasesResp>('/admin/api/updates/releases'),
}
