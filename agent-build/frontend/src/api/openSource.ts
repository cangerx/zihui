import { http } from './client'

/**
 * 开源交付 —— 公开接口（免登录）。
 * 走 /api/open-source/*（非 /admin/api），无需 JWT。
 */

export type OpenSourceOrderStatus = 'pending' | 'paid' | 'closed' | 'failed' | 'expired'

export type OpenSourceTier = 'pioneer'

export interface OpenSourceConfig {
  pay_enabled: boolean
  tiers: {
    pioneer: { price: number; currency: string }
  }
}

export interface OpenSourceBuyer {
  buyer_name: string
  buyer_phone: string
  buyer_wechat: string
  buyer_email: string
  buyer_domain: string
}

export interface OpenSourceOrder {
  order_no: string
  tier: OpenSourceTier
  amount: string
  currency: string
  code_url: string | null
  status: OpenSourceOrderStatus
  paid: boolean
  expires_at: string | null
  paid_at: string | null
  reused: boolean
}

export const openSourceApi = {
  config() {
    return http.get<OpenSourceConfig>('/api/open-source/config').then((r) => r.data)
  },
  createOrder(buyer: OpenSourceBuyer, tier: OpenSourceTier = 'pioneer') {
    return http
      .post<OpenSourceOrder>('/api/open-source/order', { ...buyer, tier })
      .then((r) => r.data)
  },
  getOrder(orderNo: string) {
    return http
      .get<OpenSourceOrder>(`/api/open-source/order/${encodeURIComponent(orderNo)}`)
      .then((r) => r.data)
  },
}
