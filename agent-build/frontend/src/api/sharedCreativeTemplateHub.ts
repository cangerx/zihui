import { http } from './client'

export type SharedCreativeTemplateStatus = 'pending' | 'approved' | 'rejected'
export type SharedCreativeTemplateReportReasonCode = 'invalid_image' | 'inappropriate' | 'duplicate' | 'copyright' | 'other'

export interface SharedCreativeTemplateCategory {
  id: number
  name: string
  slug: string
  sort_order: number
  template_count?: number
  created_at?: string
  updated_at?: string
}

export interface SharedCreativeTemplateVariable {
  key: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'multi_select'
  required: boolean
  placeholder?: string
  default?: string
  options?: string[]
}

export interface SharedCreativeTemplate {
  id: number
  category_id: number
  category_name?: string
  category_slug?: string
  title: string
  description: string
  cover_image: string
  example_ref_images: string[]
  requires_ref_image: boolean | 0 | 1
  default_size: string
  prompt_template: string
  variables: SharedCreativeTemplateVariable[]
  source_type: 'manual' | 'image' | 'inspiration' | string
  source_image: string
  source_inspiration_id?: number | null
  source_metadata?: Record<string, unknown>
  source_client_id: string
  source_local_id: number
  source_site_name: string
  source_domain?: string | null
  source_owner_name?: string | null
  status: SharedCreativeTemplateStatus
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

export interface SharedCreativeTemplateListResponse {
  total: number
  page: number
  page_size: number
  items: SharedCreativeTemplate[]
}

export interface SharedCreativeTemplateReviewLog {
  id: number
  reviewer_client_id: string
  reviewer_domain: string | null
  reviewer_owner_name: string | null
  action: 'approve' | 'reject'
  reason: string | null
  created_at: string
}

export interface SharedCreativeTemplateReportRow {
  id: number
  shared_id: number
  reporter_client_id: string
  reporter_domain: string | null
  reporter_owner_name: string | null
  reason_code: SharedCreativeTemplateReportReasonCode
  reason_note: string | null
  created_at: string
  shared_title?: string
  shared_cover?: string
  shared_status?: SharedCreativeTemplateStatus
  shared_is_visible?: boolean | 0 | 1
  source_site_name?: string
  report_count?: number
}

export interface SharedCreativeTemplateReportGroupRow {
  shared_id: number
  title: string
  cover_image: string
  source_site_name: string
  status: SharedCreativeTemplateStatus
  is_visible: boolean | 0 | 1
  auto_hidden_at: string | null
  report_count: number
  created_at: string
}

export interface SharedCreativeTemplateReportListResponse {
  total: number
  page: number
  page_size: number
  items: SharedCreativeTemplateReportRow[] | SharedCreativeTemplateReportGroupRow[]
}

export interface SharedCreativeTemplateDetailResponse {
  template: SharedCreativeTemplate
  reviews: SharedCreativeTemplateReviewLog[]
  reports: SharedCreativeTemplateReportRow[]
}

export interface CreativeTemplateHubSettings {
  approve_threshold: number
  reject_threshold: number
  report_threshold: number
  submit_daily_limit: number
}

export interface CreativeTemplateHubSettingsResponse {
  settings: CreativeTemplateHubSettings
  defaults: CreativeTemplateHubSettings
  active_reviewers: number
  warnings: Array<{ code: string; message: string; active_reviewers?: number; threshold?: number }>
}

export interface SharedCreativeTemplateStatsResponse {
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
  top_downloaded: Array<{ id: number; title: string; cover_image: string; source_site_name: string; download_count: number }>
  trend_7d: Array<{ date: string; count: number }>
}

export interface SharedCreativeTemplateListParams {
  page?: number
  page_size?: number
  status?: SharedCreativeTemplateStatus
  category_id?: number
  source_client_id?: string
  source_type?: string
  search?: string
  visibility?: 'all' | 'visible' | 'hidden'
}

export interface CreativeTemplateReportsListParams {
  page?: number
  page_size?: number
  reason_code?: string
  shared_id?: number
  grouped?: boolean
}

export interface CreativeTemplateCategoryPayload {
  name: string
  slug: string
  sort_order?: number
}

export const sharedCreativeTemplatesApi = {
  list(params: SharedCreativeTemplateListParams = {}) {
    return http.get<SharedCreativeTemplateListResponse>('/admin/api/shared-creative-templates', { params }).then((r) => r.data)
  },
  get(id: number) {
    return http.get<SharedCreativeTemplateDetailResponse>(`/admin/api/shared-creative-templates/${id}`).then((r) => r.data)
  },
  forceApprove(id: number) {
    return http.post<{ ok: true; status: 'approved' }>(`/admin/api/shared-creative-templates/${id}/force-approve`).then((r) => r.data)
  },
  forceReject(id: number, payload: { reason: string }) {
    return http.post<{ ok: true; status: 'rejected'; reason: string }>(`/admin/api/shared-creative-templates/${id}/force-reject`, payload).then((r) => r.data)
  },
  setVisibility(id: number, payload: { is_visible: boolean }) {
    return http.put<{ ok: true; is_visible: boolean }>(`/admin/api/shared-creative-templates/${id}/visibility`, payload).then((r) => r.data)
  },
  remove(id: number) {
    return http.delete<{ ok: true }>(`/admin/api/shared-creative-templates/${id}`).then((r) => r.data)
  },
  batchRemove(ids: number[]) {
    return http.post<{ ok: true; deleted_count: number }>('/admin/api/shared-creative-templates/batch-delete', { ids }).then((r) => r.data)
  },
  stats() {
    return http.get<SharedCreativeTemplateStatsResponse>('/admin/api/shared-creative-templates/stats').then((r) => r.data)
  },
}

export const sharedCreativeTemplateCategoriesApi = {
  list() {
    return http.get<{ data: SharedCreativeTemplateCategory[] }>('/admin/api/shared-creative-template-categories').then((r) => r.data.data)
  },
  create(payload: CreativeTemplateCategoryPayload) {
    return http.post<{ id: number; slug: string }>('/admin/api/shared-creative-template-categories', payload).then((r) => r.data)
  },
  update(id: number, payload: Partial<CreativeTemplateCategoryPayload>) {
    return http.patch<{ ok: true }>(`/admin/api/shared-creative-template-categories/${id}`, payload).then((r) => r.data)
  },
  remove(id: number) {
    return http.delete<{ ok: true }>(`/admin/api/shared-creative-template-categories/${id}`).then((r) => r.data)
  },
}

export const sharedCreativeTemplateReportsApi = {
  list(params: CreativeTemplateReportsListParams = {}) {
    return http.get<SharedCreativeTemplateReportListResponse>('/admin/api/shared-creative-template-reports', {
      params: { ...params, grouped: params.grouped ? 1 : undefined },
    }).then((r) => r.data)
  },
  get(id: number) {
    return http.get<SharedCreativeTemplateReportRow>(`/admin/api/shared-creative-template-reports/${id}`).then((r) => r.data)
  },
  dismiss(id: number) {
    return http.delete<{ ok: true }>(`/admin/api/shared-creative-template-reports/${id}`).then((r) => r.data)
  },
  batchDismiss(ids: number[]) {
    return http.post<{ ok: true; deleted_count: number }>('/admin/api/shared-creative-template-reports/batch-dismiss', { ids }).then((r) => r.data)
  },
}

export const creativeTemplateHubSettingsApi = {
  get() {
    return http.get<CreativeTemplateHubSettingsResponse>('/admin/api/creative-template-hub/settings').then((r) => r.data)
  },
  update(payload: Partial<CreativeTemplateHubSettings>) {
    return http.put<CreativeTemplateHubSettingsResponse>('/admin/api/creative-template-hub/settings', payload).then((r) => r.data)
  },
}
