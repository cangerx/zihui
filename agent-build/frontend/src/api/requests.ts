import { http } from './client'
import type {
  BuildRequestDetail,
  BuildRequestListResponse,
  BuildStatus,
} from '@/types'

export interface RequestListParams {
  page?: number
  page_size?: number
  status?: BuildStatus
  platform?: 'win' | 'mac'
  build_mode?: 'normal' | 'oem'
  oem_project_key?: string
  client_id?: string
  /** 按域名 / 运维姓名关键字模糊搜索（后端对 authorized_clients.domain / owner_name 做 LIKE） */
  keyword?: string
  date_from?: string
  date_to?: string
}

export const requestsApi = {
  list(params: RequestListParams = {}) {
    return http
      .get<BuildRequestListResponse>('/admin/api/requests', { params })
      .then((r) => r.data)
  },
  get(buildId: string) {
    return http
      .get<BuildRequestDetail>(`/admin/api/requests/${encodeURIComponent(buildId)}`)
      .then((r) => r.data)
  },
  forceCancel(buildId: string) {
    return http
      .post<{ status: string; quota_refunded: boolean }>(
        `/admin/api/requests/${encodeURIComponent(buildId)}/force-cancel`,
      )
      .then((r) => r.data)
  },
  retry(buildId: string) {
    return http
      .post<{ status: string; build_id: string; retried_from: string }>(
        `/admin/api/requests/${encodeURIComponent(buildId)}/retry`,
      )
      .then((r) => r.data)
  },
  forcePurge(buildId: string) {
    return http
      .post<{ status: string }>(`/admin/api/requests/${encodeURIComponent(buildId)}/force-purge`)
      .then((r) => r.data)
  },
}
