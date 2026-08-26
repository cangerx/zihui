import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useCloudAuthStore } from '@/stores/cloud-auth'

/**
 * AI 抠图状态（v0.6.9+，阿里 viapi SegmentHDCommonImage）。
 *
 * 状态结构：
 *   - providers: 本地保存的自定义阿里 provider 列表（不含 secret 密文）
 *   - cloudQuota: 拉取云控端拿到的本月配额状态
 *   - tasks: 内存中的进行中 / 最近完成任务列表（页面级，刷新会丢，靠主进程持久化）
 */

export interface MattingProviderSummary {
  id: string
  name: string
  type: 'aliyun_viapi'
  access_key_id_masked: string
  endpoint: string
  region_id: string
  is_default: boolean
  remark: string
  last_test_at: string
  last_test_status: string
  last_test_message: string
  created_at: string
  updated_at: string
}

export interface MattingCloudQuota {
  /** v1.5.0+ 服务端 SystemSetting.matting_enabled 总开关；为 false 时所有用户请求都会被云端 503 */
  matting_enabled: boolean
  allow_image_matting: boolean
  allow_custom_matting_provider: boolean
  image_matting_quota_per_month: number
  used_this_month: number
  credit_per_call: number
  current_credit_balance: number
}

export interface MattingTaskRow {
  /** 任务 ID（前端 uuid，跟主进程 matting_tasks.id 对齐） */
  id: string
  /** 输入图原路径 */
  sourcePath: string
  /** 来源：'cloud' | 'custom' */
  source: 'cloud' | 'custom'
  /** custom 模式才有 */
  providerId?: string
  /** 状态机 */
  status: 'pending' | 'processing' | 'uploading' | 'downloading' | 'completed' | 'failed'
  /** 完成时填充 */
  resultPath?: string
  resultUrl?: string
  requestId?: string
  elapsedMs?: number
  error?: string
  /** UI 计时器（开始处理时间） */
  startedAt?: number
}

export const useMattingStore = defineStore('matting', () => {
  const providers = ref<MattingProviderSummary[]>([])
  const cloudQuota = ref<MattingCloudQuota | null>(null)
  const tasks = ref<MattingTaskRow[]>([])

  const defaultProvider = computed(
    () => providers.value.find((p) => p.is_default) || providers.value[0] || null,
  )

  const activeTasks = computed(() =>
    tasks.value.filter((t) => !['completed', 'failed'].includes(t.status)),
  )

  // ===== Providers =====

  async function loadProviders(): Promise<void> {
    const list = await window.api.matting.invoke('listProviders')
    providers.value = (list as MattingProviderSummary[]) || []
  }

  async function createProvider(data: {
    name: string
    access_key_id: string
    access_key_secret: string
    endpoint?: string
    region_id?: string
    is_default?: boolean
    remark?: string
  }): Promise<MattingProviderSummary> {
    const created = (await window.api.matting.invoke('createProvider', data)) as MattingProviderSummary
    await loadProviders()
    return created
  }

  async function updateProvider(id: string, data: {
    name?: string
    access_key_id?: string
    access_key_secret?: string // 留空表示不修改
    endpoint?: string
    region_id?: string
    is_default?: boolean
    remark?: string
  }): Promise<MattingProviderSummary> {
    const updated = (await window.api.matting.invoke('updateProvider', id, data)) as MattingProviderSummary
    await loadProviders()
    return updated
  }

  async function deleteProvider(id: string): Promise<void> {
    await window.api.matting.invoke('deleteProvider', id)
    await loadProviders()
  }

  async function testProvider(providerId: string, testImagePath: string): Promise<
    | { ok: true; result: { image_url: string; request_id: string; elapsed_ms: number } }
    | { ok: false; error: string }
  > {
    const r = await window.api.matting.invoke('testProvider', providerId, testImagePath)
    await loadProviders() // 更新 last_test_*
    return r as any
  }

  // ===== Quota =====

  async function fetchCloudQuota(): Promise<void> {
    try {
      const q = await window.api.matting.invoke('fetchCloudQuota')
      cloudQuota.value = (q as MattingCloudQuota) || null
    } catch {
      cloudQuota.value = null
    }
  }

  // ===== Tasks =====

  function pushTask(t: MattingTaskRow): void {
    tasks.value.unshift(t)
  }

  function updateTask(id: string, patch: Partial<MattingTaskRow>): void {
    const t = tasks.value.find((x) => x.id === id)
    if (t) Object.assign(t, patch)
  }

  function removeTask(id: string): void {
    const i = tasks.value.findIndex((x) => x.id === id)
    if (i >= 0) tasks.value.splice(i, 1)
  }

  /**
   * 调用主进程开始抠图任务。返回 taskId（同步），结果通过 store 内 task 状态变化感知。
   */
  async function segment(input: {
    localPath: string
    source: 'cloud' | 'custom'
    providerId?: string
    addToGallery?: boolean
    canvasProjectId?: string
    canvasNodeId?: string
  }): Promise<MattingTaskRow> {
    const placeholderId = 'pending-' + crypto.randomUUID()
    const row: MattingTaskRow = {
      id: placeholderId,
      sourcePath: input.localPath,
      source: input.source,
      providerId: input.providerId,
      status: 'uploading',
      startedAt: Date.now(),
    }
    pushTask(row)

    try {
      const out = await window.api.matting.invoke('segment', input) as {
        taskId: string
        status: 'completed' | 'failed'
        resultPath?: string
        resultUrl?: string
        requestId?: string
        elapsedMs?: number
        error?: string
      }
      // 替换 placeholderId 为真实 taskId
      updateTask(placeholderId, {
        id:         out.taskId,
        status:     out.status,
        resultPath: out.resultPath,
        resultUrl:  out.resultUrl,
        requestId:  out.requestId,
        elapsedMs:  out.elapsedMs,
        error:      out.error,
      })
      if (input.source === 'cloud') {
        useCloudAuthStore().refreshBalancesThrottled().catch(() => {})
      }
      return tasks.value.find((t) => t.id === out.taskId) || row
    } catch (e: any) {
      updateTask(placeholderId, { status: 'failed', error: e?.message || String(e) })
      throw e
    }
  }

  return {
    providers, cloudQuota, tasks,
    defaultProvider, activeTasks,
    loadProviders, createProvider, updateProvider, deleteProvider, testProvider,
    fetchCloudQuota,
    segment, removeTask, updateTask,
  }
})
