import { http } from './client'
import type { AdminUser, LoginResponse } from '@/types'

export const authApi = {
  login(username: string, password: string) {
    return http
      .post<LoginResponse>('/admin/api/auth/login', { username, password })
      .then((r) => r.data)
  },
  me() {
    return http.get<AdminUser>('/admin/api/auth/me').then((r) => r.data)
  },
  logout() {
    return http.post<{ status: string }>('/admin/api/auth/logout').then((r) => r.data)
  },
}
