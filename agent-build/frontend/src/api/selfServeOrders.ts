import { http } from './client'
import type { MallKey } from '@/types'
import type { SelfServeOrderStatus } from './selfServe'

/** 自助付费订单管理（授权管理端后台）。 */

export interface AdminSelfServeOrder {
  id: number
  order_no: string
  domain: string
  client_id: string | null
  mall_keys: MallKey[]
  mall_labels: string[]
  amount: string
  currency: string
  channel: string
  status: SelfServeOrderStatus
  wx_transaction_id: string | null
  client_ip: string | null
  expires_at: string | null
  paid_at: string | null
  closed_at: string | null
  created_at: string | null
  /** 仅详情接口返回 */
  notify_payload?: string | null
}

export interface AdminSelfServeOrderList {
  total: number
  page: number
  page_size: number
  items: AdminSelfServeOrder[]
}

export interface SelfServeOrderListParams {
  page?: number
  page_size?: number
  status?: SelfServeOrderStatus
  search?: string
}

export const selfServeOrdersApi = {
  list(params: SelfServeOrderListParams = {}) {
    return http
      .get<AdminSelfServeOrderList>('/admin/api/self-serve-orders', { params })
      .then((r) => r.data)
  },
  get(id: number) {
    return http.get<AdminSelfServeOrder>(`/admin/api/self-serve-orders/${id}`).then((r) => r.data)
  },
  sync(id: number) {
    return http
      .post<{ wx_trade_state: string; order: AdminSelfServeOrder }>(`/admin/api/self-serve-orders/${id}/sync`)
      .then((r) => r.data)
  },
  close(id: number) {
    return http
      .post<{ status: string; order: AdminSelfServeOrder }>(`/admin/api/self-serve-orders/${id}/close`)
      .then((r) => r.data)
  },
}
