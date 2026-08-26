import { http } from './client'
import type {
  BuildClient,
  ClientCreateResponse,
  ClientListResponse,
  ClientStatus,
  MallKey,
  PackagingFeature,
} from '@/types'

export interface ClientListParams {
  page?: number
  page_size?: number
  search?: string
  status?: ClientStatus
}

export interface ClientCreatePayload {
  domain: string
  owner_name: string
  owner_phone?: string | null
  daily_limit?: number
  monthly_limit?: number
  expires_at?: string | null
}

export interface ClientUpdatePayload {
  domain?: string
  owner_name?: string
  owner_phone?: string | null
  daily_limit?: number
  monthly_limit?: number
  status?: ClientStatus
  expires_at?: string | null
}

export interface ClientBatchImportPayload {
  domains: string[]
  owner_name: string
  owner_phone?: string | null
  daily_limit?: number
  monthly_limit?: number
  expires_at?: string | null
}

export type ClientBatchItemStatus = 'ok' | 'duplicate' | 'invalid' | 'not_found' | 'has_active_builds'

export interface ClientBatchItemResult {
  input?: string
  client_id?: string
  domain?: string
  status: ClientBatchItemStatus
  error?: string
  active_count?: number
}

export interface ClientBatchImportResponse {
  success_count: number
  failed_count: number
  results: ClientBatchItemResult[]
}

export interface ClientBatchDeletePayload {
  client_ids: string[]
}

export interface ClientBatchDeleteResponse {
  success_count: number
  failed_count: number
  results: ClientBatchItemResult[]
}

export interface ClientBatchUpdateStatusPayload {
  client_ids: string[]
  status: ClientStatus
}

export interface ClientBatchUpdateStatusResponse {
  success_count: number
  target_status: ClientStatus
}

export type QuotaResetScope = 'today' | 'month' | 'all'

export interface ClientBatchResetQuotaPayload {
  client_ids: string[]
  scope: QuotaResetScope
}

export interface ClientBatchResetQuotaResponse {
  deleted_records: number
  client_count: number
  scope: QuotaResetScope
}

export interface ClientBatchUpdateLimitPayload {
  client_ids: string[]
  /** 留空表示不修改日配额 */
  daily_limit?: number | null
  /** 留空表示不修改月配额 */
  monthly_limit?: number | null
}

export interface ClientBatchUpdateLimitResponse {
  success_count: number
  daily_limit: number | null
  monthly_limit: number | null
}

export interface ClientSetReviewerPayload {
  is_hub_reviewer: boolean
}

export interface ClientSetReviewerResponse {
  ok: true
  client_id: string
  is_hub_reviewer: boolean
}

export interface ClientBatchSetReviewerPayload {
  client_ids: string[]
  is_hub_reviewer: boolean
}

export interface ClientBatchSetReviewerResponse {
  success_count: number
  is_hub_reviewer: boolean
}

export interface ClientSetMaintenanceExemptPayload {
  maintenance_exempt: boolean
}

export interface ClientSetMaintenanceExemptResponse {
  ok: true
  client_id: string
  maintenance_exempt: boolean
}

export interface ClientBatchSetMaintenanceExemptPayload {
  client_ids: string[]
  maintenance_exempt: boolean
}

export interface ClientBatchSetMaintenanceExemptResponse {
  success_count: number
  maintenance_exempt: boolean
}

export interface ClientSetEweiShopPayload {
  can_use_ewei_shop: boolean
}

export interface ClientSetEweiShopResponse {
  ok: true
  client_id: string
  can_use_ewei_shop: boolean
}

export interface ClientBatchSetEweiShopPayload {
  client_ids: string[]
  can_use_ewei_shop: boolean
}

export interface ClientBatchSetEweiShopResponse {
  success_count: number
  can_use_ewei_shop: boolean
}

// 按商城泛化的一级授权（mall_key 死契约：'ewei' | 'dianda'）
export interface ClientSetMallAuthPayload {
  mall_key: MallKey
  authorized: boolean
}

export interface ClientSetMallAuthResponse {
  ok: true
  client_id: string
  mall_key: MallKey
  authorized: boolean
}

export interface ClientBatchSetMallAuthPayload {
  client_ids: string[]
  mall_key: MallKey
  authorized: boolean
}

export interface ClientBatchSetMallAuthResponse {
  success_count: number
  mall_key: MallKey
  authorized: boolean
}

export const clientsApi = {
  list(params: ClientListParams = {}) {
    return http
      .get<ClientListResponse>('/admin/api/clients', { params })
      .then((r) => r.data)
  },
  get(clientId: string) {
    return http
      .get<BuildClient>(`/admin/api/clients/${encodeURIComponent(clientId)}`)
      .then((r) => r.data)
  },
  create(payload: ClientCreatePayload) {
    return http
      .post<ClientCreateResponse>('/admin/api/clients', payload)
      .then((r) => r.data)
  },
  update(clientId: string, payload: ClientUpdatePayload) {
    return http
      .patch<{ status: string }>(`/admin/api/clients/${encodeURIComponent(clientId)}`, payload)
      .then((r) => r.data)
  },
  remove(clientId: string) {
    return http
      .delete<{ status: string }>(`/admin/api/clients/${encodeURIComponent(clientId)}`)
      .then((r) => r.data)
  },
  batchImport(payload: ClientBatchImportPayload) {
    return http
      .post<ClientBatchImportResponse>('/admin/api/clients/batch-import', payload)
      .then((r) => r.data)
  },
  batchDelete(payload: ClientBatchDeletePayload) {
    return http
      .post<ClientBatchDeleteResponse>('/admin/api/clients/batch-delete', payload)
      .then((r) => r.data)
  },
  batchUpdateStatus(payload: ClientBatchUpdateStatusPayload) {
    return http
      .post<ClientBatchUpdateStatusResponse>('/admin/api/clients/batch-update-status', payload)
      .then((r) => r.data)
  },
  batchResetQuota(payload: ClientBatchResetQuotaPayload) {
    return http
      .post<ClientBatchResetQuotaResponse>('/admin/api/clients/batch-reset-quota', payload)
      .then((r) => r.data)
  },
  batchUpdateLimit(payload: ClientBatchUpdateLimitPayload) {
    return http
      .post<ClientBatchUpdateLimitResponse>('/admin/api/clients/batch-update-limit', payload)
      .then((r) => r.data)
  },
  setReviewer(clientId: string, payload: ClientSetReviewerPayload) {
    return http
      .post<ClientSetReviewerResponse>(
        `/admin/api/clients/${encodeURIComponent(clientId)}/set-reviewer`,
        payload,
      )
      .then((r) => r.data)
  },
  batchSetReviewer(payload: ClientBatchSetReviewerPayload) {
    return http
      .post<ClientBatchSetReviewerResponse>('/admin/api/clients/batch-set-reviewer', payload)
      .then((r) => r.data)
  },
  setMaintenanceExempt(clientId: string, payload: ClientSetMaintenanceExemptPayload) {
    return http
      .post<ClientSetMaintenanceExemptResponse>(
        `/admin/api/clients/${encodeURIComponent(clientId)}/set-maintenance-exempt`,
        payload,
      )
      .then((r) => r.data)
  },
  batchSetMaintenanceExempt(payload: ClientBatchSetMaintenanceExemptPayload) {
    return http
      .post<ClientBatchSetMaintenanceExemptResponse>('/admin/api/clients/batch-set-maintenance-exempt', payload)
      .then((r) => r.data)
  },
  setEweiShop(clientId: string, payload: ClientSetEweiShopPayload) {
    return http
      .post<ClientSetEweiShopResponse>(
        `/admin/api/clients/${encodeURIComponent(clientId)}/set-ewei-shop`,
        payload,
      )
      .then((r) => r.data)
  },
  batchSetEweiShop(payload: ClientBatchSetEweiShopPayload) {
    return http
      .post<ClientBatchSetEweiShopResponse>('/admin/api/clients/batch-set-ewei-shop', payload)
      .then((r) => r.data)
  },
  // 按商城泛化的一级授权（mall_key in 'ewei'|'dianda'）
  setMallAuth(clientId: string, payload: ClientSetMallAuthPayload) {
    return http
      .post<ClientSetMallAuthResponse>(
        `/admin/api/clients/${encodeURIComponent(clientId)}/set-mall-auth`,
        payload,
      )
      .then((r) => r.data)
  },
  batchSetMallAuth(payload: ClientBatchSetMallAuthPayload) {
    return http
      .post<ClientBatchSetMallAuthResponse>('/admin/api/clients/batch-set-mall-auth', payload)
      .then((r) => r.data)
  },
  setPackagingAuth(clientId: string, payload: { feature: PackagingFeature; authorized: boolean }) {
    return http
      .post<{ ok: boolean; client_id: string; feature: PackagingFeature; authorized: boolean }>(
        `/admin/api/clients/${encodeURIComponent(clientId)}/set-packaging-auth`,
        payload,
      )
      .then((r) => r.data)
  },
  batchSetPackagingAuth(payload: { client_ids: string[]; feature: PackagingFeature; authorized: boolean }) {
    return http
      .post<{ success_count: number; feature: PackagingFeature; authorized: boolean }>(
        '/admin/api/clients/batch-set-packaging-auth',
        payload,
      )
      .then((r) => r.data)
  },
}
