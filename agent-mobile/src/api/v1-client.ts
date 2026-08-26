import { createApiClient, ApiClientError } from '@zihui/api-client'
import type { AppChannel } from '@zihui/contracts'
import { API_BASE, STORAGE_KEYS } from './config'

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
        new Headers(init.headers).forEach((value, key) => { result[key] = value })
        return result
      })(),
      success: (result) => {
        const headers = new Headers()
        const responseHeaders = (result.header || {}) as Record<string, string>
        Object.entries(responseHeaders).forEach(([key, value]) => headers.set(key, value))
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
  baseUrl: API_BASE || '/api/app/v1',
  channel: resolveChannel(),
  fetchImpl: uniFetch as typeof fetch,
  getAccessToken: getStoredToken,
  setAccessToken: (token) => {
    if (token) uni.setStorageSync(STORAGE_KEYS.token, token)
    else uni.removeStorageSync(STORAGE_KEYS.token)
  },
})

export function apiErrorCode(error: unknown): number {
  return error instanceof ApiClientError ? error.status || 500 : 500
}
