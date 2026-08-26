import { http } from './client'
import type { DashboardStats } from '@/types'

export const dashboardApi = {
  stats(range: 'day' | 'week' | 'month' = 'week') {
    return http
      .get<DashboardStats>('/admin/api/dashboard/stats', { params: { range } })
      .then((r) => r.data)
  },
}
