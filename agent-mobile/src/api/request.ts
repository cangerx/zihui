/**
 * 统一请求层（复刻 design-end 的 take）
 * 规则见 docs/API开发文档.md §2
 *
 * 约定：页面/组件禁止直接 uni.request，一律走这里。
 * 错误码在本层统一处理（toast / 跳登录），调用方不要对同一条 message 重复弹窗。
 */
import { requireApiBase, USE_MOCK } from './config'
import { generateAuthHeader, clearAuth } from './auth-storage'
import type { ApiResponse } from './types'
import { resolveMock } from './mock'
import { useUserStore } from '@/store/user'

export interface RequestOptions {
  /** 相对路径 `/ai/app/GetApp`，或绝对 URL */
  path: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD'
  argument?: Record<string, unknown>
  /** 跳过全局错误提示，由调用方自行处理 */
  silent?: boolean
  /** 强制走真实网络（mock 模式下用于个别已联调接口） */
  forceReal?: boolean
  header?: Record<string, string>
  timeout?: number
}

/** URL 拼接规则，见 §2.3 */
function resolveUrl(path: string): string {
  if (path.startsWith('!!@')) return path.slice(3)
  if (/^https?:\/\//.test(path)) return path
  const apiBase = requireApiBase()
  return `${apiBase}${path.startsWith('/') ? path : `/${path}`}`
}

function toQuery(argument: Record<string, unknown>): string {
  const parts: string[] = []
  Object.keys(argument).forEach((key) => {
    const value = argument[key]
    if (value === undefined || value === null) return
    if (Array.isArray(value)) {
      value.forEach((item) => parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`))
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    }
  })
  return parts.join('&')
}

let loginRedirecting = false

/** 402：清登录态并跳登录 */
function handleUnauthorized() {
  // 走 store.logout()：同时清 storage 与 Pinia 的 token/account ref。
  // 之前只 clearAuth() 清了 storage，store 的 token ref 还在、isLogin 仍 true，
  // UI 继续显示已登录直到冷启动。懒调用确保此刻 pinia 已激活（402 必在 app 初始化后）。
  try {
    useUserStore().logout()
  } catch {
    // 极端情况下 pinia 未就绪，至少清掉 storage 兜底
    clearAuth()
  }
  if (loginRedirecting) return
  loginRedirecting = true
  uni.navigateTo({
    url: '/pages-sub/login/login',
    complete: () => {
      setTimeout(() => {
        loginRedirecting = false
      }, 800)
    },
  })
}

function toast(message?: string) {
  if (!message) return
  uni.showToast({ title: message, icon: 'none', duration: 2000 })
}

/** 全局错误码处理，见 §2.7 */
function handleCode<T>(res: ApiResponse<T>, silent: boolean): ApiResponse<T> {
  if (res.code === 200) return res
  if (res.code === 402) {
    handleUnauthorized()
    return res
  }
  if (!silent) {
    toast(res.message || (res.code === 401 ? '参数校验失败' : '请求失败'))
  }
  return res
}

export async function request<T = unknown>(options: RequestOptions): Promise<ApiResponse<T>> {
  const { path, method = 'GET', argument, silent = false, forceReal = false } = options

  if (USE_MOCK && !forceReal) {
    const mocked = await resolveMock<T>(path, method, argument)
    if (mocked) return handleCode(mocked, silent)
  }

  let url = resolveUrl(path)
  const header: Record<string, string> = {
    ...generateAuthHeader(),
    ...(options.header || {}),
  }

  let data: unknown
  if (method === 'GET' || method === 'HEAD') {
    const query = argument ? toQuery(argument) : ''
    if (query) url += (url.includes('?') ? '&' : '?') + query
  } else if (argument) {
    header['Content-Type'] = 'application/json'
    data = argument
  }

  return new Promise((resolve) => {
    uni.request({
      url,
      method: method as UniApp.RequestOptions['method'],
      header,
      data: data as UniApp.RequestOptions['data'],
      timeout: options.timeout ?? 30000,
      success: (res) => {
        const body = res.data as ApiResponse<T>
        if (!body || typeof body.code !== 'number') {
          if (!silent) toast('响应格式异常')
          resolve({ code: -1, data: null as T, message: '响应格式异常' })
          return
        }
        resolve(handleCode(body, silent))
      },
      fail: (err) => {
        const message = err?.errMsg || '网络异常，请稍后重试'
        if (!silent) toast(message)
        resolve({ code: -1, data: null as T, message })
      },
    })
  })
}

/** 上传文件（FormData），见 §2.2 / §3.3 */
export function uploadFile(options: {
  path: string
  filePath: string
  name?: string
  formData?: Record<string, unknown>
  silent?: boolean
}): Promise<ApiResponse<unknown>> {
  const url = resolveUrl(options.path)
  const header: Record<string, string> = {
    ...generateAuthHeader(),
  }
  return new Promise((resolve) => {
    uni.uploadFile({
      url,
      filePath: options.filePath,
      name: options.name || 'file',
      formData: options.formData as Record<string, never>,
      header,
      success: (res) => {
        try {
          const body = JSON.parse(res.data) as ApiResponse<unknown>
          resolve(handleCode(body, options.silent ?? false))
        } catch {
          resolve({ code: -1, data: null, message: '上传响应解析失败' })
        }
      },
      fail: (err) => {
        const message = err?.errMsg || '上传失败'
        if (!options.silent) toast(message)
        resolve({ code: -1, data: null, message })
      },
    })
  })
}
