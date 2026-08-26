/**
 * 认证接口，见 docs/API开发文档.md §3.1
 * 微信登录接口后端未提供，暂按预期契约声明（mock 已覆盖）。
 */
import { request } from '../request'
import type { ImageCaptchaResult, LoginResult } from '../types'

export async function emailLogin(email: string, password: string) {
  return request<LoginResult>({
    path: '/auth/email/Login',
    method: 'POST',
    argument: { email, password },
  })
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
  email_code: string
  aes?: string
  code?: string
}) {
  return request<Partial<LoginResult>>({
    path: '/auth/email/Register',
    method: 'POST',
    argument: payload,
  })
}

/** TODO(api)：微信登录接口待后端提供，字段以 mock 为准 */
export async function wechatLogin(code: string) {
  return request<LoginResult>({
    path: '/auth/wechat/Login',
    method: 'POST',
    argument: { code },
  })
}
