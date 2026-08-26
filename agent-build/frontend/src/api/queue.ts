import { http } from './client'
import type { QueueStatus } from '@/types'

export const queueApi = {
  status() {
    return http.get<QueueStatus>('/admin/api/queue/status').then((r) => r.data)
  },
  pause() {
    return http.post<{ paused: boolean }>('/admin/api/queue/pause').then((r) => r.data)
  },
  resume() {
    return http.post<{ paused: boolean }>('/admin/api/queue/resume').then((r) => r.data)
  },
}
