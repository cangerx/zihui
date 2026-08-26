import type { AppTask } from '@zihui/contracts'
import { USE_MOCK } from '../config'
import { appV1Client } from '../v1-client'

const mockTasks: AppTask[] = Array.from({ length: 6 }, (_, index) => {
  const running = index < 3
  const imageNumber = index + 1
  return {
    id: `mock-task-${imageNumber}`,
    type: 'image',
    status: running ? 'processing' : 'succeeded',
    progress: running ? 50 : 100,
    request: { prompt: `AI 图片任务 ${imageNumber}` },
    result: running ? null : { data: [{ url: `/static/mock/m${imageNumber}.jpg` }] },
    error: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  }
})

export async function listTasks(options?: { status?: string; limit?: number }): Promise<AppTask[]> {
  if (USE_MOCK) {
    const filtered = options?.status
      ? mockTasks.filter((task) => task.status === options.status)
      : mockTasks
    return filtered.slice(0, options?.limit || filtered.length)
  }
  return appV1Client.tasks({ type: 'image', status: options?.status, limit: options?.limit })
}

export async function getTask(id: string): Promise<AppTask> {
  if (USE_MOCK) {
    const task = mockTasks.find((item) => item.id === id)
    if (!task) throw new Error('Task not found')
    return task
  }
  return appV1Client.task(id)
}

export async function cancelTask(id: string): Promise<AppTask> {
  if (USE_MOCK) {
    const task = await getTask(id)
    return { ...task, status: 'cancelled', progress: 0 }
  }
  return appV1Client.cancelTask(id)
}
