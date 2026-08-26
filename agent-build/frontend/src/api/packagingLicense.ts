import { http } from './client'

export interface PackagingLicenseConfig {
  win_price: number
  mac_price: number
  self_serve_enabled: boolean
}

export interface PackagingQueryResult {
  found: boolean
  domain?: string
  status?: string
  purchasable?: boolean
  self_serve_enabled?: boolean
  can_use_github_packaging?: boolean
  can_use_mac_packaging?: boolean
  prices?: { win: number; mac: number }
}

export interface PackagingOrder {
  order_no: string
  domain: string
  features: Array<'win' | 'mac'>
  amount: string
  currency: string
  code_url?: string | null
  status: 'pending' | 'paid' | 'closed' | 'failed' | 'expired'
  paid: boolean
  expires_at?: string | null
  paid_at?: string | null
  reused?: boolean
  can_use_github_packaging?: boolean
  can_use_mac_packaging?: boolean
}

export interface AdminPackagingOrder extends PackagingOrder {
  id: number
  client_id?: string | null
  channel?: string
  wx_transaction_id?: string | null
  created_at?: string | null
  closed_at?: string | null
  remark?: string | null
  notify_payload?: string | null
}

export const packagingLicenseApi = {
  get() {
    return http.get<PackagingLicenseConfig>('/admin/api/settings/packaging-license').then((r) => r.data)
  },
  update(payload: PackagingLicenseConfig) {
    return http.put<PackagingLicenseConfig>('/admin/api/settings/packaging-license', payload).then((r) => r.data)
  },
}

export const packagingSelfServeApi = {
  query(domain: string) {
    return http
      .get<PackagingQueryResult>('/api/self-serve/packaging/query', { params: { domain } })
      .then((r) => r.data)
  },
  createOrder(domain: string, features: Array<'win' | 'mac'>) {
    return http.post<PackagingOrder>('/api/self-serve/packaging/order', { domain, features }).then((r) => r.data)
  },
  getOrder(orderNo: string) {
    return http.get<PackagingOrder>(`/api/self-serve/packaging/order/${encodeURIComponent(orderNo)}`).then((r) => r.data)
  },
}

export const packagingOrdersApi = {
  list(params: { page?: number; page_size?: number; status?: string; search?: string }) {
    return http
      .get<{ total: number; page: number; page_size: number; items: AdminPackagingOrder[] }>(
        '/admin/api/packaging-license-orders',
        { params },
      )
      .then((r) => r.data)
  },
  get(id: number) {
    return http.get<AdminPackagingOrder>(`/admin/api/packaging-license-orders/${id}`).then((r) => r.data)
  },
  sync(id: number) {
    return http
      .post<{ wx_trade_state: string; order: AdminPackagingOrder }>(`/admin/api/packaging-license-orders/${id}/sync`)
      .then((r) => r.data)
  },
  close(id: number) {
    return http
      .post<{ status: string; order: AdminPackagingOrder }>(`/admin/api/packaging-license-orders/${id}/close`)
      .then((r) => r.data)
  },
}
