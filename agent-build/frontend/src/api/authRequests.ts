import { http } from './client'
import type { AuthRequestListResponse } from '@/types'

export interface AuthRequestListParams {
  page?: number
  page_size?: number
  result?: 'allowed' | 'denied'
  reason?: string
  host?: string
  client_id?: string
  /** 模糊匹配 origin / host / client_id，用于定位「实际发来的是哪个域名」 */
  keyword?: string
  date_from?: string
  date_to?: string
}

export const authRequestsApi = {
  list(params: AuthRequestListParams = {}) {
    return http
      .get<AuthRequestListResponse>('/admin/api/auth-requests', { params })
      .then((r) => r.data)
  },
  /** 清空全部「被拒」记录（成功记录不受影响） */
  clearDenied() {
    return http
      .post<{ deleted: number }>('/admin/api/auth-requests/clear')
      .then((r) => r.data)
  },
}
