import { http } from './client'
import type { TemplateVersion } from '@/types'

export interface TemplateCreatePayload {
  version: string
  changelog?: string | null
  released_by?: string | null
}

export interface TemplateUpdatePayload {
  changelog?: string | null
  released_by?: string | null
}

export interface TemplateDraft {
  version: string
  changelog: string
  source?: string
}

export const templatesApi = {
  draft() {
    return http.get<{ draft: TemplateDraft | null }>('/admin/api/templates/draft').then((r) => r.data.draft)
  },
  list() {
    return http
      .get<{ items: TemplateVersion[] }>('/admin/api/templates')
      .then((r) => r.data.items)
  },
  get(id: number) {
    return http.get<TemplateVersion>(`/admin/api/templates/${id}`).then((r) => r.data)
  },
  create(payload: TemplateCreatePayload) {
    return http
      .post<{ id: number; version: string }>('/admin/api/templates', payload)
      .then((r) => r.data)
  },
  update(id: number, payload: TemplateUpdatePayload) {
    return http
      .patch<{ status: string }>(`/admin/api/templates/${id}`, payload)
      .then((r) => r.data)
  },
  remove(id: number) {
    return http
      .delete<{ status: string }>(`/admin/api/templates/${id}`)
      .then((r) => r.data)
  },
  setCurrent(id: number) {
    return http
      .post<{ status: string; id: number; version: string }>(
        `/admin/api/templates/${id}/set-current`,
      )
      .then((r) => r.data)
  },
}
