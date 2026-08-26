import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { EcomGenTask } from '@/views/ecom/types'

/**
 * 电商生图的全局状态分桶。
 *
 * 背景：电商 5 个功能（批量SKU / 复刻 / 主图 / 详情页 / 海报）原先用组件级 composable
 * 持有 tasks / 进度 / 表单，路由切走组件即销毁 → 这些状态全部丢失；而后台 runPool 仍在跑
 * （图片照常落库），用户却完全看不到，切回是空白页。
 *
 * 这里把每个功能的状态提升到全局 store，按 scopeKey 分桶（应用生命周期内常驻）：
 *   - 切走切回自动恢复结果网格 / 进度 / 错误 / 表单；
 *   - 游离 runPool 回写的是 store 里同一份 tasks（响应式），切回能继续看到实时进度直到完成。
 */
export interface EcomGenScopeState {
  /** 结果网格任务列表 */
  tasks: EcomGenTask[]
  /** 是否出图阶段进行中 */
  generating: boolean
  /** 两步法阶段提示：'optimizing'（生成描述词）| 'generating'（出图）| '' */
  phase: '' | 'optimizing' | 'generating'
  /** 最近一次错误（友好文案） */
  lastError: string
  /** 软取消标志：置位后并发池不再启动新任务（在途请求无法中断，会自然完成） */
  cancelled: boolean
  /** 表单快照（结构因功能而异，做通用对象存储；含 form / params / llm 等键） */
  form: Record<string, any>
}

function createScope(): EcomGenScopeState {
  return { tasks: [], generating: false, phase: '', lastError: '', cancelled: false, form: {} }
}

/**
 * 全局生图 / 描述词模型偏好（localStorage 持久化）。
 * 与 per-scope 内存快照互补：内存快照负责「同一次运行内切走切回」恢复；这里负责
 * 「跨应用重启」记住、且「5 个电商功能之间共享」上次选用的模型，免去每次重选。
 */
export interface EcomModelPref {
  imageProviderId: string
  imageModelId: string
  llmProviderId: string
  llmModelId: string
}

const MODEL_PREF_KEY = 'ecom:model-pref'

function readPref(): EcomModelPref {
  const empty: EcomModelPref = { imageProviderId: '', imageModelId: '', llmProviderId: '', llmModelId: '' }
  try {
    const raw = localStorage.getItem(MODEL_PREF_KEY)
    if (!raw) return empty
    return { ...empty, ...JSON.parse(raw) }
  } catch {
    return empty
  }
}

export const useEcomGenStore = defineStore('ecomGen', () => {
  /** key = 功能标识（如 'ecom:poster'），value = 该功能的运行态 + 表单快照 */
  const scopes = ref<Record<string, EcomGenScopeState>>({})

  /** 取某功能的状态桶，不存在则惰性创建。返回的是响应式对象，供 toRefs 解构使用。 */
  function scope(key: string): EcomGenScopeState {
    if (!scopes.value[key]) scopes.value[key] = createScope()
    return scopes.value[key]
  }

  /** 读取全局模型偏好（跨重启 + 跨功能共享）。 */
  function loadModelPref(): EcomModelPref {
    return readPref()
  }

  /** 合并写回全局模型偏好。 */
  function saveModelPref(part: Partial<EcomModelPref>): void {
    try {
      const next = { ...readPref(), ...part }
      localStorage.setItem(MODEL_PREF_KEY, JSON.stringify(next))
    } catch {
      // localStorage 不可用时静默降级（仍有 per-scope 内存记忆兜底）
    }
  }

  return { scopes, scope, loadModelPref, saveModelPref }
})
