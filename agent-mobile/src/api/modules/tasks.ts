import type { AppTask } from '@zihui/contracts'
import { appV1Client } from '../v1-client'

export async function listTasks(options?: { status?: string; limit?: number }): Promise<AppTask[]> {
  return appV1Client.tasks({ type: 'image', status: options?.status, limit: options?.limit })
}

export async function getTask(id: string): Promise<AppTask> {
  return appV1Client.task(id)
}

export async function cancelTask(id: string): Promise<AppTask> {
  return appV1Client.cancelTask(id)
}
