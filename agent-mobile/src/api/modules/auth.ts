/**
 * 认证接口，见 docs/API开发文档.md §3.1
 * 微信登录接口后端未提供，暂按预期契约声明（mock 已覆盖）。
 */
import { request } from '../request'
import type { ApiResponse, ImageCaptchaResult, LoginResult } from '../types'
import type { AppUser } from '@zihui/contracts'
import { apiErrorCode, appV1Client } from '../v1-client'

function failure<T>(error: unknown): ApiResponse<T> {
  return { code: apiErrorCode(error), data: null as T, message: error instanceof Error ? error.message : '请求失败' }
}

function toLoginAccount(user: AppUser): LoginResult['account'] {
  return {
    id: user.id,
    username: user.username,
    email: user.email || undefined,
    phone: user.phone || undefined,
    nickname: user.nickname,
    avatar: user.avatar || undefined,
  }
}

function loginResult(payload: { access_token: string; user: AppUser }): LoginResult {
  return { token: payload.access_token, account: toLoginAccount(payload.user) }
}

export async function emailLogin(email: string, password: string) {
  try {
    const result = await appV1Client.login(email, password)
    return { code: 200, data: loginResult(result) } as ApiResponse<LoginResult>
  } catch (error) {
    return failure<LoginResult>(error)
  }
}

export async function getImageCaptcha(scene = 'send-user-email') {
  return request<ImageCaptchaResult>({
    path: '/system/captcha/GetImageCaptcha',
    argument: { scene },
  })
}

/** 注意：后端路径拼写为 Sed（非 Send），见 §3.1.3 */
export async function sendRegisterEmail(email: string, aes: string, code: string) {
  return request({
    path: '/auth/email/SedRegisterEmail',
    method: 'POST',
    argument: { email, aes, code },
  })
}

export async function emailRegister(payload: {
  email: string
  password: string
}) {
  try {
    const result = await appV1Client.register({
      email: payload.email,
      password: payload.password,
      nickname: payload.email.split('@')[0] || 'Zihui 用户',
    })
    return { code: 200, data: loginResult(result) } as ApiResponse<Partial<LoginResult>>
  } catch (error) {
    return failure<Partial<LoginResult>>(error)
  }
}

/** TODO(api)：微信登录接口待后端提供，字段以 mock 为准 */
export async function wechatLogin(code: string) {
  try {
    const result = await appV1Client.request<{ access_token: string; user: AppUser }>(
      '/auth/wechat/mini/exchange',
      { method: 'POST', body: { code } },
    )
    return { code: 200, data: loginResult(result) } as ApiResponse<LoginResult>
  } catch (error) {
    return failure<LoginResult>(error)
  }
}
