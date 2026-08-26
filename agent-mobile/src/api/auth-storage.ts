/**
 * 登录态读写
 * 对应 docs/API开发文档.md §5
 */
import { STORAGE_KEYS } from './config'
import type { LoginAccount } from './types'

export function getToken(): string {
  try {
    return uni.getStorageSync(STORAGE_KEYS.token) || ''
  } catch {
    return ''
  }
}

export function getAccount(): LoginAccount | null {
  try {
    return uni.getStorageSync(STORAGE_KEYS.account) || null
  } catch {
    return null
  }
}

export function setAuth(token: string, account: LoginAccount) {
  uni.setStorageSync(STORAGE_KEYS.token, token)
  uni.setStorageSync(STORAGE_KEYS.account, account)
}

export function clearAuth() {
  uni.removeStorageSync(STORAGE_KEYS.token)
  uni.removeStorageSync(STORAGE_KEYS.account)
}

/** 请求头中的登录态 */
export function generateAuthHeader(): Record<string, string> {
  const token = getToken()
  return token ? { 'x-token': token } : {}
}
