import { http } from './client'

export const skillRegistryApi = {
  list: () => http.get('/admin/api/skill-registry').then((r) => r.data),
  pending: () => http.get('/admin/api/skill-registry/pending').then((r) => r.data),
  reports: () => http.get('/admin/api/skill-registry/reports').then((r) => r.data),
  show: (skillId: string) => http.get(`/admin/api/skill-registry/${skillId}`).then((r) => r.data),
  upload: (file: File) => {
    const fd = new FormData()
    fd.append('package', file)
    return http.post('/admin/api/skill-registry/upload', fd).then((r) => r.data)
  },
  review: (versionId: string, action: 'approve' | 'reject', evidence: string) =>
    http.post(`/admin/api/skill-registry/versions/${versionId}/review`, { action, evidence }).then((r) => r.data),
  revoke: (versionId: string, evidence: string) =>
    http.post(`/admin/api/skill-registry/versions/${versionId}/revoke`, { evidence }).then((r) => r.data),
}
