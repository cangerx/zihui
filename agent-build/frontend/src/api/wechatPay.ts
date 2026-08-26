import { http } from './client'

/** 微信收款配置（自助付费页的收款商户）。存 system_settings group=wechat_pay。 */

export interface WeChatPayConfig {
  enabled: boolean
  mchid: string
  app_id: string
  cert_serial_no: string
  pub_key_id: string
  has_apiv3_key: boolean
  has_private_key: boolean
  has_pub_key: boolean
  has_platform_cert: boolean
  verify_mode: 'public_key' | 'platform_cert'
}

export interface WeChatPayUpdatePayload {
  enabled: boolean
  mchid: string
  app_id: string
  cert_serial_no: string
  /** 留空表示不修改已有值 */
  apiv3_key?: string
  /** 留空表示不修改已有值 */
  private_key?: string
  pub_key_id?: string
  pub_key?: string
  platform_cert?: string
}

export const wechatPayApi = {
  get() {
    return http.get<WeChatPayConfig>('/admin/api/settings/wechat-pay').then((r) => r.data)
  },
  update(payload: WeChatPayUpdatePayload) {
    return http.put<{ status: string }>('/admin/api/settings/wechat-pay', payload).then((r) => r.data)
  },
  test() {
    return http.post<{ ok: boolean; msg: string }>('/admin/api/settings/wechat-pay/test').then((r) => r.data)
  },
}
