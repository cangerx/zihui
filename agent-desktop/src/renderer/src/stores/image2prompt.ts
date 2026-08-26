import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 图片反推（Image2PromptView）的会话级状态。
 *
 * 包含：
 *  - 视觉模型选择（provider + model）
 *  - 输出语言 / 风格预设 / 系统提示词
 *  - 并发数
 *  - 任务列表（图片 + 反推结果）
 *
 * 不写盘——重启 app 后回到默认值，符合"启动状态维持"的预期。
 */

export interface Task {
  id: string
  image: string
  name: string
  status: 'pending' | 'running' | 'done' | 'error'
  result: string
  error: string
}

export const useImage2PromptStore = defineStore('image2prompt', () => {
  const visionProviderId = ref('')
  const visionModelId = ref('')
  const outputLang = ref<'cn' | 'en'>('cn')
  const stylePreset = ref<'general' | 'sd_phrase' | 'sd_tag' | 'mj' | 'danbooru'>('general')
  const systemPrompt = ref('')
  const concurrency = ref(2)
  const tasks = ref<Task[]>([])

  // 任务 id 自增计数器；和 tasks 一起持久才能避免重新挂载时 id 冲突
  const idCounter = ref(0)
  function nextTaskId(): string {
    idCounter.value += 1
    return `t${Date.now()}-${idCounter.value}`
  }

  function reset() {
    visionProviderId.value = ''
    visionModelId.value = ''
    outputLang.value = 'cn'
    stylePreset.value = 'general'
    systemPrompt.value = ''
    concurrency.value = 2
    tasks.value = []
    idCounter.value = 0
  }

  return {
    visionProviderId,
    visionModelId,
    outputLang,
    stylePreset,
    systemPrompt,
    concurrency,
    tasks,
    idCounter,
    nextTaskId,
    reset,
  }
})
