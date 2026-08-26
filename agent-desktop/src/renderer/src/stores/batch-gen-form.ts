import { defineStore } from 'pinia'
import { ref } from 'vue'
import { DEFAULT_TIER_ID } from '@shared/image-size'

/**
 * 批量生图（BatchGenView）的会话级状态。
 *
 * 包含：
 *  - 默认提示词 + 默认尺寸/分辨率档位
 *  - 生图模型 + 提示词优化模型
 *  - 并发数
 *  - 任务列表（每个任务带参考图、自定义 prompt、状态、结果路径）
 *  - 运行中标记（保留是为了切走/切回时 UI 仍能显示"运行中"）
 *
 * 不写盘——重启 app 后回到默认值，符合"启动状态维持"的预期。
 */

export interface BatchTask {
  id: string
  refImage: string
  customPrompt: string
  customSize: string
  status: 'pending' | 'generating' | 'done' | 'error'
  /** 后端错误原文。UI 展示时调 translateError 转换为友好文案 */
  error: string
  resultPath: string | null
  genId: string | null
  expanded: boolean
}

export const useBatchGenFormStore = defineStore('batchGenForm', () => {
  const defaultPrompt = ref('')

  // 生图模型
  const selectedProviderId = ref('')
  const selectedModelId = ref('')

  // 提示词优化模型
  const optimizeProviderId = ref('')
  const optimizeModelId = ref('')

  // 默认尺寸 / 分辨率
  const defaultSize = ref('1:1')
  const defaultTier = ref<string>(DEFAULT_TIER_ID)

  // 风格预设（云端分发；null = 不使用风格，作用于本批全部任务）
  const stylePresetId = ref<number | null>(null)

  // 并发与运行态
  const concurrency = ref(2)
  const batchRunning = ref(false)

  // 任务列表 + id 自增计数（与 tasks 一同持久才能避免重新挂载时 id 冲突）
  const tasks = ref<BatchTask[]>([])
  const taskIdCounter = ref(0)

  function reset() {
    defaultPrompt.value = ''
    selectedProviderId.value = ''
    selectedModelId.value = ''
    optimizeProviderId.value = ''
    optimizeModelId.value = ''
    defaultSize.value = '1:1'
    defaultTier.value = DEFAULT_TIER_ID
    stylePresetId.value = null
    concurrency.value = 2
    batchRunning.value = false
    tasks.value = []
    taskIdCounter.value = 0
  }

  return {
    defaultPrompt,
    selectedProviderId,
    selectedModelId,
    optimizeProviderId,
    optimizeModelId,
    defaultSize,
    defaultTier,
    stylePresetId,
    concurrency,
    batchRunning,
    tasks,
    taskIdCounter,
    reset,
  }
})
