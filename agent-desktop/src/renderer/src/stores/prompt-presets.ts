import { defineStore } from 'pinia'
import { ref } from 'vue'

function plain<T>(data: T): T {
  return JSON.parse(JSON.stringify(data))
}

export interface PromptCategory {
  id: string
  type: string
  name: string
  sort_order: number
  created_at: string
}

export interface PromptPreset {
  id: string
  category_id: string
  type: string
  label: string
  content: string
  is_builtin: number
  hidden: number
  sort_order: number
  created_at: string
}

const api = () => (window as any).api.promptPreset

export const usePromptPresetStore = defineStore('prompt-presets', () => {
  const categories = ref<PromptCategory[]>([])
  const presets = ref<PromptPreset[]>([])
  const loading = ref(false)

  // Grouped by category for a given type
  function groupedByCategory(type: string) {
    const cats = categories.value.filter((c) => c.type === type)
    return cats.map((cat) => ({
      ...cat,
      items: presets.value.filter((p) => p.category_id === cat.id)
    }))
  }

  // Visible presets (not hidden) grouped by category
  function visibleGrouped(type: string) {
    const cats = categories.value.filter((c) => c.type === type)
    return cats
      .map((cat) => ({
        ...cat,
        items: presets.value.filter((p) => p.category_id === cat.id && !p.hidden)
      }))
      .filter((cat) => cat.items.length > 0)
  }

  async function fetchAll(type?: string) {
    loading.value = true
    try {
      const [cats, items] = await Promise.all([
        api().invoke('listCategories', type),
        api().invoke('listPresets', type)
      ])
      if (type) {
        // Merge: remove old ones of this type, add new
        categories.value = [
          ...categories.value.filter((c) => c.type !== type),
          ...cats
        ]
        presets.value = [
          ...presets.value.filter((p) => p.type !== type),
          ...items
        ]
      } else {
        categories.value = cats
        presets.value = items
      }
    } finally {
      loading.value = false
    }
  }

  // === Category CRUD ===

  async function createCategory(data: { type: string; name: string }) {
    const result = (await api().invoke('createCategory', plain(data))) as PromptCategory
    categories.value.push(result)
    return result
  }

  async function updateCategory(id: string, data: Partial<{ name: string; sort_order: number }>) {
    const result = (await api().invoke('updateCategory', id, plain(data))) as PromptCategory
    const idx = categories.value.findIndex((c) => c.id === id)
    if (idx !== -1) categories.value[idx] = result
    return result
  }

  async function deleteCategory(id: string) {
    await api().invoke('deleteCategory', id)
    categories.value = categories.value.filter((c) => c.id !== id)
    presets.value = presets.value.filter((p) => p.category_id !== id)
  }

  // === Preset CRUD ===

  async function createPreset(data: {
    category_id: string
    type: string
    label: string
    content: string
  }) {
    const result = (await api().invoke('createPreset', plain(data))) as PromptPreset
    presets.value.push(result)
    return result
  }

  async function updatePreset(
    id: string,
    data: Partial<{ label: string; content: string; category_id: string; hidden: number; sort_order: number }>
  ) {
    const result = (await api().invoke('updatePreset', id, plain(data))) as PromptPreset
    const idx = presets.value.findIndex((p) => p.id === id)
    if (idx !== -1) presets.value[idx] = result
    return result
  }

  async function deletePreset(id: string) {
    await api().invoke('deletePreset', id)
    presets.value = presets.value.filter((p) => p.id !== id)
  }

  return {
    categories,
    presets,
    loading,
    groupedByCategory,
    visibleGrouped,
    fetchAll,
    createCategory,
    updateCategory,
    deleteCategory,
    createPreset,
    updatePreset,
    deletePreset
  }
})
