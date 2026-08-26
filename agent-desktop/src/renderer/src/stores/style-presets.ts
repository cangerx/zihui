import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

// 类型与主进程 style-preset.ts 保持一致；不直接 import 主进程类型避免 renderer ↔ main 耦合
export interface StylePreset {
  id: number
  name: string
  prompt_fragment: string
  sample_image: string
  category: string
  sort_order: number
}

interface StylePresetBundle {
  categories: string[]
  styles: StylePreset[]
  fromCache: boolean
}

export const useStylePresetStore = defineStore('style-presets', () => {
  const styles = ref<StylePreset[]>([])
  const categories = ref<string[]>([])
  const fromCache = ref(false)
  const loading = ref(false)
  /** 本会话是否已拉取过（含失败），避免多个入口组件重复请求 */
  const loaded = ref(false)
  let inflight: Promise<void> | null = null

  async function fetchStyles(force = false): Promise<void> {
    if (inflight) return inflight
    if (loaded.value && !force) return
    inflight = (async () => {
      loading.value = true
      try {
        const res = (await window.api.stylePreset.invoke('list')) as StylePresetBundle
        styles.value = Array.isArray(res?.styles) ? res.styles : []
        categories.value = Array.isArray(res?.categories) ? res.categories : []
        fromCache.value = !!res?.fromCache
      } catch (e) {
        console.warn('[style-presets] fetch failed:', e)
      } finally {
        loading.value = false
        loaded.value = true
        inflight = null
      }
    })()
    return inflight
  }

  const hasStyles = computed(() => styles.value.length > 0)

  /** 按 id 取风格；云端已删除/停用的返回 null（调用方按「无风格」降级） */
  function byId(id: number | null | undefined): StylePreset | null {
    if (id === null || id === undefined) return null
    return styles.value.find((s) => s.id === id) || null
  }

  return { styles, categories, fromCache, loading, loaded, hasStyles, fetchStyles, byId }
})
