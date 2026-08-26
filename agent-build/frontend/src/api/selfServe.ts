import { http } from './client'
import type { MallKey } from '@/types'

/**
 * 自助付费开通商城授权 —— 公开接口（免登录）。
 * 走 /api/self-serve/mall-auth/*（非 /admin/api），无需 JWT。
 */

export type SelfServeOrderStatus = 'pending' | 'paid' | 'closed' | 'failed' | 'expired'

export interface SelfServeQueryResult {
  found: boolean
  domain?: string
  status?: string
  purchasable?: boolean
  malls?: Record<MallKey, boolean>
  labels?: Record<MallKey, string>
  prices?: { single: number; bundle: number }
}

export interface SelfServeOrder {
  order_no: string
  domain: string
  mall_keys: MallKey[]
  amount: string
  currency: string
  code_url: string | null
  status: SelfServeOrderStatus
  paid: boolean
  expires_at: string | null
  paid_at: string | null
  reused: boolean
  /** 已支付时回带：该域名最新授权态 */
  malls?: Record<MallKey, boolean>
}

export const selfServeApi = {
  query(domain: string) {
    return http
      .get<SelfServeQueryResult>('/api/self-serve/mall-auth/query', { params: { domain } })
      .then((r) => r.data)
  },
  createOrder(domain: string, mall_keys: MallKey[]) {
    return http
      .post<SelfServeOrder>('/api/self-serve/mall-auth/order', { domain, mall_keys })
      .then((r) => r.data)
  },
  getOrder(orderNo: string) {
    return http
      .get<SelfServeOrder>(`/api/self-serve/mall-auth/order/${encodeURIComponent(orderNo)}`)
      .then((r) => r.data)
  },
}
