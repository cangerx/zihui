import { http } from './client'

export type SharedAgentStatus = 'pending' | 'approved' | 'rejected'
export type SharedAgentReportReasonCode = 'invalid_image' | 'inappropriate' | 'duplicate' | 'copyright' | 'other'
export type SharedAgentToolApproval = 'off' | 'destructive' | 'all'

export interface SharedAgentCategory {
  id: number
  name: string
  slug: string
  sort_order: number
  agent_count?: number
  created_at?: string
  updated_at?: string
}

export interface SharedAgent {
  id: number
  category_id: number
  category_name?: string
  category_slug?: string
  name: string
  description: string
  avatar: string
  system_prompt: string
  tool_skill_ids: string[]
  tool_approval: SharedAgentToolApproval | string
  enable_image_gen: boolean | 0 | 1
  tags: string[]
  source_metadata?: Record<string, unknown>
  source_client_id: string
  source_local_id: number | string
  source_site_name: string
  source_domain?: string | null
  source_owner_name?: string | null
  status: SharedAgentStatus
  is_visible: boolean | 0 | 1
  approve_count: number
  reject_count: number
  report_count: number
  download_count: number
  reviewed_at: string | null
  auto_hidden_at: string | null
  created_at: string
  updated_at: string
}

export interface SharedAgentListResponse {
  total: number
  page: number
  page_size: number
  items: SharedAgent[]
}

export interface SharedAgentReviewLog {
  id: number
  reviewer_client_id: string
  reviewer_domain: string | null
  reviewer_owner_name: string | null
  action: 'approve' | 'reject'
  reason: string | null
  created_at: string
}

export interface SharedAgentReportRow {
  id: number
  shared_id: number
  reporter_client_id: string
  reporter_domain: string | null
  reporter_owner_name: string | null
  reason_code: SharedAgentReportReasonCode
  reason_note: string | null
  created_at: string
  shared_name?: string
  shared_avatar?: string
  shared_status?: SharedAgentStatus
  shared_is_visible?: boolean | 0 | 1
  source_site_name?: string
  report_count?: number
}

export interface SharedAgentReportGroupRow {
  shared_id: number
  name: string
  avatar: string
  source_site_name: string
  status: SharedAgentStatus
  is_visible: boolean | 0 | 1
  auto_hidden_at: string | null
  report_count: number
  created_at: string
}

export interface SharedAgentReportListResponse {
  total: number
  page: number
  page_size: number
  items: SharedAgentReportRow[] | SharedAgentReportGroupRow[]
}

export interface SharedAgentDetailResponse {
  agent: SharedAgent
  reviews: SharedAgentReviewLog[]
  reports: SharedAgentReportRow[]
}

export interface AgentHubSettings {
  approve_threshold: number
  reject_threshold: number
  report_threshold: number
  submit_daily_limit: number
}

export interface AgentHubSettingsResponse {
  settings: AgentHubSettings
  defaults: AgentHubSettings
  active_reviewers: number
  warnings: Array<{ code: string; message: string; active_reviewers?: number; threshold?: number }>
}

export interface SharedAgentStatsResponse {
  stats: {
    total: number
    pending: number
    approved: number
    rejected: number
    hidden: number
    reports_open: number
    reviewers: number
  }
  top_sources: Array<{ source_client_id: string; domain: string | null; owner_name: string | null; cnt: number }>
  top_downloaded: Array<{ id: number; name: string; avatar: string; source_site_name: string; download_count: number }>
  trend_7d: Array<{ date: string; count: number }>
}

export interface SharedAgentListParams {
  page?: number
  page_size?: number
  status?: SharedAgentStatus
  category_id?: number
  source_client_id?: string
  search?: string
  visibility?: 'all' | 'visible' | 'hidden'
}

export interface AgentReportsListParams {
  page?: number
  page_size?: number
  reason_code?: string
  shared_id?: number
  grouped?: boolean
}

export interface AgentCategoryPayload {
  name: string
  slug: string
  sort_order?: number
}

export const sharedAgentsApi = {
  list(params: SharedAgentListParams = {}) {
    return http.get<SharedAgentListResponse>('/admin/api/shared-agents', { params }).then((r) => r.data)
  },
  get(id: number) {
    return http.get<SharedAgentDetailResponse>(`/admin/api/shared-agents/${id}`).then((r) => r.data)
  },
  forceApprove(id: number) {
    return http.post<{ ok: true; status: 'approved' }>(`/admin/api/shared-agents/${id}/force-approve`).then((r) => r.data)
  },
  forceReject(id: number, payload: { reason: string }) {
    return http.post<{ ok: true; status: 'rejected'; reason: string }>(`/admin/api/shared-agents/${id}/force-reject`, payload).then((r) => r.data)
  },
  setVisibility(id: number, payload: { is_visible: boolean }) {
    return http.put<{ ok: true; is_visible: boolean }>(`/admin/api/shared-agents/${id}/visibility`, payload).then((r) => r.data)
  },
  remove(id: number) {
    return http.delete<{ ok: true }>(`/admin/api/shared-agents/${id}`).then((r) => r.data)
  },
  batchRemove(ids: number[]) {
    return http.post<{ ok: true; deleted_count: number }>('/admin/api/shared-agents/batch-delete', { ids }).then((r) => r.data)
  },
  stats() {
    return http.get<SharedAgentStatsResponse>('/admin/api/shared-agents/stats').then((r) => r.data)
  },
}

export const sharedAgentCategoriesApi = {
  list() {
    return http.get<{ data: SharedAgentCategory[] }>('/admin/api/shared-agent-categories').then((r) => r.data.data)
  },
  create(payload: AgentCategoryPayload) {
    return http.post<{ id: number; slug: string }>('/admin/api/shared-agent-categories', payload).then((r) => r.data)
  },
  update(id: number, payload: Partial<AgentCategoryPayload>) {
    return http.patch<{ ok: true }>(`/admin/api/shared-agent-categories/${id}`, payload).then((r) => r.data)
  },
  remove(id: number) {
    return http.delete<{ ok: true }>(`/admin/api/shared-agent-categories/${id}`).then((r) => r.data)
  },
}

export const sharedAgentReportsApi = {
  list(params: AgentReportsListParams = {}) {
    return http.get<SharedAgentReportListResponse>('/admin/api/shared-agent-reports', {
      params: { ...params, grouped: params.grouped ? 1 : undefined },
    }).then((r) => r.data)
  },
  get(id: number) {
    return http.get<SharedAgentReportRow>(`/admin/api/shared-agent-reports/${id}`).then((r) => r.data)
  },
  dismiss(id: number) {
    return http.delete<{ ok: true }>(`/admin/api/shared-agent-reports/${id}`).then((r) => r.data)
  },
  batchDismiss(ids: number[]) {
    return http.post<{ ok: true; deleted_count: number }>('/admin/api/shared-agent-reports/batch-dismiss', { ids }).then((r) => r.data)
  },
}

export const agentHubSettingsApi = {
  get() {
    return http.get<AgentHubSettingsResponse>('/admin/api/agent-hub/settings').then((r) => r.data)
  },
  update(payload: Partial<AgentHubSettings>) {
    return http.put<AgentHubSettingsResponse>('/admin/api/agent-hub/settings', payload).then((r) => r.data)
  },
}
