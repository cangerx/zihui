import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useCloudAuthStore } from '@/stores/cloud-auth'

/**
 * 精细抠图状态（抠抠图 koukoutu，仅云端中转，按尺寸三档计费）。
 *
 * 与「快速抠图」(stores/matting.ts) 的差异：
 *   - 无本地自定义 provider（凭证只在云控端），故没有 providers 相关逻辑
 *   - cloudQuota 额外带三档单价 + 长边阈值，供按图尺寸预估
 */

export interface FineMattingCloudQuota {
  fine_matting_enabled: boolean
  allow_fine_matting: boolean
  fine_matting_quota_per_month: number
  used_this_month: number
  tier1_credit: number
  tier2_credit: number
  tier3_credit: number
  tier_threshold_1: number
  tier_threshold_2: number
  current_credit_balance: number
  max_file_size_mb: number
  allowed_extensions: string[]
}

export interface FineMattingTaskRow {
  id: string
  sourcePath: string
  status: 'pending' | 'processing' | 'uploading' | 'downloading' | 'completed' | 'failed'
  resultPath?: string
  resultUrl?: string
  requestId?: string
  elapsedMs?: number
  tier?: number
  cost?: number
  error?: string
  startedAt?: number
}

export const useFineMattingStore = defineStore('fineMatting', () => {
  const cloudQuota = ref<FineMattingCloudQuota | null>(null)
  const tasks = ref<FineMattingTaskRow[]>([])

  // ===== Quota =====

  async function fetchCloudQuota(): Promise<void> {
    try {
      const q = await window.api.fineMatting.invoke('fetchCloudQuota')
      cloudQuota.value = (q as FineMattingCloudQuota) || null
    } catch {
      cloudQuota.value = null
    }
  }

  // ===== Tasks =====

  function pushTask(t: FineMattingTaskRow): void {
    tasks.value.unshift(t)
  }

  function updateTask(id: string, patch: Partial<FineMattingTaskRow>): void {
    const t = tasks.value.find((x) => x.id === id)
    if (t) Object.assign(t, patch)
  }

  function removeTask(id: string): void {
    const i = tasks.value.findIndex((x) => x.id === id)
    if (i >= 0) tasks.value.splice(i, 1)
  }

  /**
   * 调用主进程开始精细抠图任务。返回 task 行（结果通过 store 内 task 状态变化感知）。
   */
  async function segment(input: {
    localPath: string
    addToGallery?: boolean
  }): Promise<FineMattingTaskRow> {
    const placeholderId = 'pending-' + crypto.randomUUID()
    const row: FineMattingTaskRow = {
      id: placeholderId,
      sourcePath: input.localPath,
      status: 'uploading',
      startedAt: Date.now(),
    }
    pushTask(row)

    try {
      const out = await window.api.fineMatting.invoke('segment', input) as {
        taskId: string
        status: 'completed' | 'failed'
        resultPath?: string
        resultUrl?: string
        requestId?: string
        elapsedMs?: number
        tier?: number
        cost?: number
        error?: string
      }
      updateTask(placeholderId, {
        id:         out.taskId,
        status:     out.status,
        resultPath: out.resultPath,
        resultUrl:  out.resultUrl,
        requestId:  out.requestId,
        elapsedMs:  out.elapsedMs,
        tier:       out.tier,
        cost:       out.cost,
        error:      out.error,
      })
      // 精细抠图一律走云端，扣费后刷新余额
      useCloudAuthStore().refreshBalancesThrottled().catch(() => {})
      return tasks.value.find((t) => t.id === out.taskId) || row
    } catch (e: any) {
      updateTask(placeholderId, { status: 'failed', error: e?.message || String(e) })
      throw e
    }
  }

  return {
    cloudQuota, tasks,
    fetchCloudQuota,
    segment, pushTask, updateTask, removeTask,
  }
})
