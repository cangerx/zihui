import { createApiClient, ApiClientError } from '@zihui/api-client'
import type { AppChannel } from '@zihui/contracts'
import { API_BASE, STORAGE_KEYS, USE_MOCK, requireApiBase } from './config'
import { useUserStore } from '@/store/user'

function getStoredToken(): string | null {
  return (uni.getStorageSync(STORAGE_KEYS.token) as string) || null
}

function resolveChannel(): AppChannel {
  try {
    const platform = (uni.getSystemInfoSync?.() as { uniPlatform?: string }).uniPlatform
    return platform === 'mp-weixin' ? 'mini_program' : 'h5'
  } catch {
    return 'h5'
  }
}

function uniFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input)
  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method: (init.method || 'GET') as UniApp.RequestOptions['method'],
      data: init.body === undefined || init.body === null
        ? undefined
        : init.body as string | ArrayBuffer | Record<string, unknown>,
      header: (() => {
        const result: Record<string, string> = {}
        const inputHeaders = init.headers
        if (Array.isArray(inputHeaders)) {
          inputHeaders.forEach(([key, value]) => { result[key] = value })
        } else if (inputHeaders && typeof (inputHeaders as Headers).forEach === 'function') {
          ;(inputHeaders as Headers).forEach((value, key) => { result[key] = value })
        } else if (inputHeaders) {
          Object.entries(inputHeaders).forEach(([key, value]) => { result[key] = String(value) })
        }
        return result
      })(),
      success: (result) => {
        const responseHeaders = (result.header || {}) as Record<string, string>
        const headers = {
          get(name: string) {
            const key = Object.keys(responseHeaders).find((item) => item.toLowerCase() === name.toLowerCase())
            return key ? String(responseHeaders[key]) : null
          },
        }
        const body = typeof result.data === 'string' ? result.data : JSON.stringify(result.data ?? null)
        resolve({
          ok: result.statusCode >= 200 && result.statusCode < 300,
          status: result.statusCode,
          headers,
          text: async () => body,
        } as Response)
      },
      fail: (error) => reject(error),
    })
  })
}

export const appV1Client = createApiClient({
  baseUrl: USE_MOCK ? (API_BASE || '/api/app/v1') : requireApiBase(),
  channel: resolveChannel(),
  fetchImpl: uniFetch as typeof fetch,
  getAccessToken: getStoredToken,
  setAccessToken: (token) => {
    if (token) uni.setStorageSync(STORAGE_KEYS.token, token)
    else {
      try {
        useUserStore().logout()
      } catch {
        uni.removeStorageSync(STORAGE_KEYS.token)
        uni.removeStorageSync(STORAGE_KEYS.account)
      }
    }
  },
})

export function apiErrorCode(error: unknown): number {
  return error instanceof ApiClientError ? error.status || 500 : 500
}

export function apiErrorInvalidatedSession(error: unknown): boolean {
  return error instanceof ApiClientError && error.accessTokenInvalidated
}
