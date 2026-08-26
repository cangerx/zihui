import { http } from './client'
import type {
  InspirationHubSettings,
  InspirationHubSettingsResponse,
  SharedInspiration,
  SharedInspirationCategory,
  SharedInspirationDetailResponse,
  SharedInspirationListResponse,
  SharedInspirationReportListResponse,
  SharedInspirationReportRow,
  SharedInspirationStatsResponse,
  SharedInspirationStatus,
} from '@/types'

// ===== 灵感池 =====

export interface SharedInspirationListParams {
  page?: number
  page_size?: number
  status?: SharedInspirationStatus
  category_id?: number
  source_client_id?: string
  search?: string
  /** 'all' | '1'/'visible' | '0'/'hidden' */
  visibility?: 'all' | 'visible' | 'hidden'
}

export interface ForceRejectPayload {
  reason: string
}

export interface VisibilityPayload {
  is_visible: boolean
}

export const inspirationsApi = {
  list(params: SharedInspirationListParams = {}) {
    return http
      .get<SharedInspirationListResponse>('/admin/api/shared-inspirations', { params })
      .then((r) => r.data)
  },
  get(id: number) {
    return http
      .get<SharedInspirationDetailResponse>(`/admin/api/shared-inspirations/${id}`)
      .then((r) => r.data)
  },
  forceApprove(id: number) {
    return http
      .post<{ ok: true; status: 'approved' }>(`/admin/api/shared-inspirations/${id}/force-approve`)
      .then((r) => r.data)
  },
  forceReject(id: number, payload: ForceRejectPayload) {
    return http
      .post<{ ok: true; status: 'rejected'; reason: string }>(
        `/admin/api/shared-inspirations/${id}/force-reject`,
        payload,
      )
      .then((r) => r.data)
  },
  setVisibility(id: number, payload: VisibilityPayload) {
    return http
      .put<{ ok: true; is_visible: boolean }>(
        `/admin/api/shared-inspirations/${id}/visibility`,
        payload,
      )
      .then((r) => r.data)
  },
  remove(id: number) {
    return http
      .delete<{ ok: true }>(`/admin/api/shared-inspirations/${id}`)
      .then((r) => r.data)
  },
  batchRemove(ids: number[]) {
    return http
      .post<{ ok: true; deleted_count: number }>('/admin/api/shared-inspirations/batch-delete', { ids })
      .then((r) => r.data)
  },
  stats() {
    return http
      .get<SharedInspirationStatsResponse>('/admin/api/shared-inspirations/stats')
      .then((r) => r.data)
  },
}

// ===== 分类 CRUD =====

export interface CategoryCreatePayload {
  name: string
  slug: string
  sort_order?: number
}

export interface CategoryUpdatePayload {
  name?: string
  slug?: string
  sort_order?: number
}

export const categoriesApi = {
  list() {
    return http
      .get<{ data: SharedInspirationCategory[] }>('/admin/api/shared-inspiration-categories')
      .then((r) => r.data.data)
  },
  create(payload: CategoryCreatePayload) {
    return http
      .post<{ id: number; slug: string }>('/admin/api/shared-inspiration-categories', payload)
      .then((r) => r.data)
  },
  update(id: number, payload: CategoryUpdatePayload) {
    return http
      .patch<{ ok: true }>(`/admin/api/shared-inspiration-categories/${id}`, payload)
      .then((r) => r.data)
  },
  remove(id: number) {
    return http
      .delete<{ ok: true }>(`/admin/api/shared-inspiration-categories/${id}`)
      .then((r) => r.data)
  },
}

// ===== 举报池 =====

export interface ReportsListParams {
  page?: number
  page_size?: number
  reason_code?: string
  shared_id?: number
  /** true = 按 shared_id 聚合视图 */
  grouped?: boolean
}

export const reportsApi = {
  list(params: ReportsListParams = {}) {
    const query: Record<string, string | number | boolean | undefined> = {
      ...params,
      grouped: params.grouped ? 1 : undefined,
    }
    return http
      .get<SharedInspirationReportListResponse>('/admin/api/shared-inspiration-reports', { params: query })
      .then((r) => r.data)
  },
  get(id: number) {
    return http
      .get<SharedInspirationReportRow>(`/admin/api/shared-inspiration-reports/${id}`)
      .then((r) => r.data)
  },
  dismiss(id: number) {
    return http
      .delete<{ ok: true }>(`/admin/api/shared-inspiration-reports/${id}`)
      .then((r) => r.data)
  },
  batchDismiss(ids: number[]) {
    return http
      .post<{ ok: true; deleted_count: number }>(
        '/admin/api/shared-inspiration-reports/batch-dismiss',
        { ids },
      )
      .then((r) => r.data)
  },
}

// ===== 阈值设置 =====

export const hubSettingsApi = {
  get() {
    return http
      .get<InspirationHubSettingsResponse>('/admin/api/inspiration-hub/settings')
      .then((r) => r.data)
  },
  update(payload: Partial<InspirationHubSettings>) {
    return http
      .put<InspirationHubSettingsResponse>('/admin/api/inspiration-hub/settings', payload)
      .then((r) => r.data)
  },
}

// 重新导出类型以便页面 import 一处即可
export type { SharedInspiration, SharedInspirationCategory }
