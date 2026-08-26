import axios, { type AxiosError, type AxiosInstance } from 'axios'
import { message } from 'antd'
import { authStore } from '@/store/auth'
import type { ApiErrorBody } from '@/types'

const baseURL = import.meta.env.VITE_API_BASE || ''

export const http: AxiosInstance = axios.create({
  baseURL,
  timeout: 30_000,
  headers: {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
})

http.interceptors.request.use((config) => {
  const token = authStore.getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorBody>) => {
    const status = error.response?.status
    const data = error.response?.data

    if (status === 401) {
      const isLoginCall = error.config?.url?.includes('/auth/login')
      // 公开自助页（/buy、/opensource）走免登录的 /self-serve、/open-source 接口，401 不应把访客踢去登录页
      const isPublicCall =
        error.config?.url?.includes('/self-serve/') || error.config?.url?.includes('/open-source/')
      if (!isLoginCall && !isPublicCall) {
        authStore.clear()
        if (window.location.pathname !== '/login') {
          window.location.href = '/login'
        }
      }
    } else if (status === 403) {
      message.error('权限不足')
    } else if (status === 422 && data?.details) {
      const firstField = Object.keys(data.details)[0]
      const firstMsg = firstField ? data.details[firstField]?.[0] : '请求参数不合法'
      message.error(firstMsg || '请求参数不合法')
    } else if (status === 429) {
      message.warning('请求过于频繁，请稍后再试')
    } else if (status && status >= 500) {
      message.error('服务器错误，请稍后再试')
    } else if (data?.error) {
      const friendly = errorMap[data.error] || data.error
      message.error(friendly)
    } else if (!error.response) {
      message.error('网络错误，无法连接到后端')
    }

    return Promise.reject(error)
  },
)

const errorMap: Record<string, string> = {
  invalid_credentials: '用户名或密码错误',
  account_disabled: '账号已停用',
  unauthenticated: '请先登录',
  client_not_found: '客户端不存在',
  client_id_taken: '客户端 ID 已被占用',
  domain_taken: '域名已被注册',
  client_has_active_builds: '该客户端有进行中的打包任务，无法删除',
  build_not_found: '打包记录不存在',
  not_cancellable: '当前状态无法取消',
  only_terminal_failure_retryable: '只有失败/已取消的任务能重试',
  cannot_purge_in_state: '当前状态不可清理',
  client_not_active: '客户端未激活',
  quota_exceeded: '日配额已用完',
  dispatch_failed: 'GitHub dispatch 失败，请稍后重试',
  template_not_found: '模板不存在',
  version_exists: '版本号已存在',
  cannot_delete_current_version: '当前生效版本不可删除',
  cos_not_configured: '腾讯云 COS 尚未配置，请先在「系统设置」填写',
}
