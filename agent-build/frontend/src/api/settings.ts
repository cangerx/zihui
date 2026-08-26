import { http } from './client'
import type {
  CosSettings,
  CosSettingsUpdatePayload,
  CosTestResult,
} from '@/types'

export interface BuildMaintenanceState {
  enabled: boolean
  message: string | null
  default_message: string
  /** 云控端最低版本要求；null 表示不限制 */
  min_admin_version: string | null
}

export interface BuildMaintenanceUpdatePayload {
  enabled: boolean
  message?: string | null
  /** X.Y.Z 格式或空字符串清空；不传该字段则保持原值 */
  min_admin_version?: string | null
}

export interface BuildMaintenanceUpdateResponse {
  enabled: boolean
  message: string | null
  min_admin_version: string | null
}

export type AlertProvider = 'dingtalk' | 'wework' | 'feishu' | 'serverchan' | 'custom'

export interface AlertWorkerState {
  /** mirror worker 最后一次 poll 心跳时间；从未上报为 null */
  last_poll_at: string | null
  /** 在线（心跳新）或忙碌（在下大包）都为 true */
  online: boolean
  /** 心跳已静默但有 build 正在 mirroring（worker 正卡在下大包，属正常现象） */
  busy: boolean
}

export interface AlertSettingsState {
  enabled: boolean
  provider: AlertProvider
  /** 打码后的 webhook，仅展示 */
  webhook_url_masked: string
  has_webhook_url: boolean
  keyword: string | null
  worker: AlertWorkerState
  /** 当前卡在中转（success+pending/mirroring）的打包数 */
  stuck_count: number
}

export interface AlertSettingsUpdatePayload {
  enabled: boolean
  provider: AlertProvider
  /** 留空（不传）表示不修改已有 webhook */
  webhook_url?: string
  keyword?: string | null
}

export interface AlertTestResult {
  ok: boolean
  msg: string
}

export const settingsApi = {
  getCos() {
    return http.get<CosSettings>('/admin/api/settings/cos').then((r) => r.data)
  },
  updateCos(payload: CosSettingsUpdatePayload) {
    return http
      .put<{ status: string }>('/admin/api/settings/cos', payload)
      .then((r) => r.data)
  },
  testCos() {
    return http
      .post<CosTestResult>('/admin/api/settings/cos/test')
      .then((r) => r.data)
      .catch((e) => {
        // 422 时后端把 ok=false 放在 response.data，这里把它正常返回（不抛错）
        const data = e?.response?.data
        if (data && typeof data === 'object' && 'ok' in data) {
          return data as CosTestResult
        }
        throw e
      })
  },
  // 云打包维护开关：开启时云控端「一键云打包」展示维护横幅 + 禁用提交按钮
  getBuildMaintenance() {
    return http
      .get<BuildMaintenanceState>('/admin/api/maintenance/build')
      .then((r) => r.data)
  },
  updateBuildMaintenance(payload: BuildMaintenanceUpdatePayload) {
    return http
      .put<BuildMaintenanceUpdateResponse>(
        '/admin/api/maintenance/build',
        payload,
      )
      .then((r) => r.data)
  },
  // 运维告警通知：mirror 中转卡死 / worker 失联 webhook 推送配置
  getAlert() {
    return http.get<AlertSettingsState>('/admin/api/settings/alert').then((r) => r.data)
  },
  updateAlert(payload: AlertSettingsUpdatePayload) {
    return http
      .put<{ status: string }>('/admin/api/settings/alert', payload)
      .then((r) => r.data)
  },
  testAlert() {
    return http
      .post<AlertTestResult>('/admin/api/settings/alert/test')
      .then((r) => r.data)
      .catch((e) => {
        // 422 时后端把 ok=false 放在 response.data，这里正常返回（不抛错）
        const data = e?.response?.data
        if (data && typeof data === 'object' && 'ok' in data) {
          return data as AlertTestResult
        }
        throw e
      })
  },
}
