import { http } from './client'

export interface SiteUpdateRelease {
  id: number
  channel: string
  version: string
  changelog: string | null
  zip_path: string | null
  zip_url: string | null
  sha256: string | null
  size: number
  min_upgradable_from: string | null
  breaking: boolean
  is_current: boolean
  released_by: string | null
  released_at: string | null
}

export interface SiteUpdateDraft {
  version: string
  changelog: string
  source?: string
}

export const siteUpdatesApi = {
  draft() {
    return http.get<{ draft: SiteUpdateDraft | null }>('/admin/api/site-update-releases/draft').then((r) => r.data.draft)
  },
  list(channel = 'admin') {
    return http
      .get<{ items: SiteUpdateRelease[] }>('/admin/api/site-update-releases', { params: { channel } })
      .then((r) => r.data.items)
  },
  create(form: FormData) {
    return http
      .post<{ item: SiteUpdateRelease; zip_url: string }>('/admin/api/site-update-releases', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300_000,
      })
      .then((r) => r.data)
  },
  update(id: number, payload: Partial<Pick<SiteUpdateRelease, 'changelog' | 'zip_url' | 'min_upgradable_from' | 'breaking'>>) {
    return http.patch<{ item: SiteUpdateRelease }>(`/admin/api/site-update-releases/${id}`, payload).then((r) => r.data)
  },
  setCurrent(id: number) {
    return http
      .post<{ item: SiteUpdateRelease }>(`/admin/api/site-update-releases/${id}/set-current`)
      .then((r) => r.data)
  },
  remove(id: number) {
    return http.delete(`/admin/api/site-update-releases/${id}`)
  },
}
