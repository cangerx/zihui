/**
 * 环境与网关配置
 * 对应 docs/API开发文档.md §1、§9
 */

/** Mock 仅供本地开发使用，生产构建始终访问真实 API。 */
export const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_USE_MOCK !== 'false'

/** 版本化客户端 API 基址，例如 https://api.example.com/api/app/v1。 */
export const API_BASE = ((import.meta.env.VITE_API_BASE as string) || '').replace(/\/$/, '')

export function requireApiBase(): string {
  if (!API_BASE) {
    throw new Error('VITE_API_BASE must be configured when the mobile Mock is disabled')
  }
  return API_BASE
}

/** 本地存储 key */
export const STORAGE_KEYS = {
  token: 'token',
  account: 'account',
} as const
