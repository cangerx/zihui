import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useCloudAuthStore } from '@/stores/cloud-auth'

export interface VectorProgress {
  knowledgeBaseId: string
  status: 'chunking' | 'embedding' | 'done' | 'error' | 'skipped'
  current: number
  total: number
  message: string
  /** 错误时附带的结构化代码，UI 据此引导用户跳转购买/设置等 */
  errorCode?: 'NO_CLOUD_MODEL' | 'INSUFFICIENT_BALANCE' | 'NOT_CONFIGURED' | 'UNAUTHORIZED' | 'NO_EXTRACTABLE_TEXT' | 'GENERIC'
}

export interface CategoryStats {
  category_id: string
  category_name: string
  total_docs: number
  pending_docs: number
  ready_docs: number
  unvectorizable_docs: number
  error_docs: number
  total_chunks: number
  embedded_chunks: number
  total_tokens: number
}

export const useVectorizeStore = defineStore('vectorize', () => {
  const stats = ref<CategoryStats[]>([])
  const loading = ref(false)
  const vectorizing = ref(false)
  const progress = ref<VectorProgress | null>(null)

  async function fetchStats() {
    loading.value = true
    try {
      stats.value = (await window.api.vectorize.invoke('stats')) as CategoryStats[]
    } finally {
      loading.value = false
    }
  }

  async function vectorizeDocument(knowledgeBaseId: string) {
    vectorizing.value = true
    progress.value = null

    window.api.vectorize.onProgress((data: unknown) => {
      progress.value = data as VectorProgress
    })

    try {
      const result = await window.api.vectorize.invoke('document', knowledgeBaseId)
      await fetchStats()
      useCloudAuthStore().refreshBalancesThrottled().catch(() => {})
      return result
    } finally {
      vectorizing.value = false
      window.api.vectorize.offProgress()
    }
  }

  async function vectorizeCategory(categoryId: string) {
    vectorizing.value = true
    progress.value = null

    window.api.vectorize.onProgress((data: unknown) => {
      progress.value = data as VectorProgress
    })

    try {
      const result = await window.api.vectorize.invoke('category', categoryId)
      await fetchStats()
      useCloudAuthStore().refreshBalancesThrottled().catch(() => {})
      return result
    } finally {
      vectorizing.value = false
      window.api.vectorize.offProgress()
    }
  }

  async function vectorizeAll() {
    vectorizing.value = true
    progress.value = null

    window.api.vectorize.onProgress((data: unknown) => {
      progress.value = data as VectorProgress
    })

    try {
      const result = await window.api.vectorize.invoke('all')
      await fetchStats()
      useCloudAuthStore().refreshBalancesThrottled().catch(() => {})
      return result
    } finally {
      vectorizing.value = false
      window.api.vectorize.offProgress()
    }
  }

  async function resetCategory(categoryId: string) {
    vectorizing.value = true
    progress.value = null

    window.api.vectorize.onProgress((data: unknown) => {
      progress.value = data as VectorProgress
    })

    try {
      const result = await window.api.vectorize.invoke('resetCategory', categoryId)
      await fetchStats()
      return result
    } finally {
      vectorizing.value = false
      window.api.vectorize.offProgress()
    }
  }

  /**
   * 全量清空已有向量并重新生成。用于模型变更后的恢复入口。
   */
  async function reembedAll() {
    vectorizing.value = true
    progress.value = null

    window.api.vectorize.onProgress((data: unknown) => {
      progress.value = data as VectorProgress
    })

    try {
      const result = await window.api.vectorize.reembedAll()
      await fetchStats()
      useCloudAuthStore().refreshBalancesThrottled().catch(() => {})
      return result
    } finally {
      vectorizing.value = false
      window.api.vectorize.offProgress()
    }
  }

  return {
    stats,
    loading,
    vectorizing,
    progress,
    fetchStats,
    vectorizeDocument,
    vectorizeCategory,
    resetCategory,
    vectorizeAll,
    reembedAll
  }
})
