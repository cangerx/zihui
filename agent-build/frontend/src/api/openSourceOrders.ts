import { http } from './client'
import type { OpenSourceOrderStatus, OpenSourceTier } from './openSource'

/**
 * 开源交付订单管理 —— 后台接口（需 JWT）。
 * 走 /admin/api/open-source-orders/*。
 */

export interface AdminOpenSourceOrder {
  id: number
  order_no: string
  tier: OpenSourceTier
  buyer_name: string
  buyer_phone: string
  buyer_wechat: string
  buyer_email: string
  buyer_domain: string | null
  amount: string
  currency: string
  channel: string
  status: OpenSourceOrderStatus
  delivered: boolean
  wx_transaction_id: string | null
  client_ip: string | null
  expires_at: string | null
  paid_at: string | null
  delivered_at: string | null
  closed_at: string | null
  created_at: string | null
  /** 详情接口附带 */
  notify_payload?: string | null
}

export interface OpenSourceOrderListResult {
  total: number
  page: number
  page_size: number
  items: AdminOpenSourceOrder[]
}

export interface OpenSourceOrderListParams {
  page?: number
  page_size?: number
  status?: OpenSourceOrderStatus
  search?: string
}

export const openSourceOrdersApi = {
  list(params: OpenSourceOrderListParams) {
    return http
      .get<OpenSourceOrderListResult>('/admin/api/open-source-orders', { params })
      .then((r) => r.data)
  },
  get(id: number) {
    return http.get<AdminOpenSourceOrder>(`/admin/api/open-source-orders/${id}`).then((r) => r.data)
  },
  sync(id: number) {
    return http
      .post<{ wx_trade_state: string; order: AdminOpenSourceOrder }>(
        `/admin/api/open-source-orders/${id}/sync`,
      )
      .then((r) => r.data)
  },
  close(id: number) {
    return http
      .post<{ status: string; order: AdminOpenSourceOrder }>(`/admin/api/open-source-orders/${id}/close`)
      .then((r) => r.data)
  },
  deliver(id: number, delivered: boolean) {
    return http
      .post<{ order: AdminOpenSourceOrder }>(`/admin/api/open-source-orders/${id}/deliver`, { delivered })
      .then((r) => r.data)
  },
}
