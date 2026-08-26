import { defineStore } from 'pinia'
import { ref } from 'vue'

function plain<T>(data: T): T {
  return JSON.parse(JSON.stringify(data))
}

export interface KBCategory {
  id: string
  name: string
  description: string
  watch_paths: string[]
  created_at: string
}

export interface KnowledgeBase {
  id: string
  category_id: string
  name: string
  file_path: string
  file_type: string
  chunk_count: number
  status: string
  source_mtime: number
  source_size: number
  source_hash: string
  last_indexed_at: string
  error_code: string
  error_message: string
  created_at: string
}

export const useKnowledgeStore = defineStore('knowledge', () => {
  const categories = ref<KBCategory[]>([])
  const knowledgeBases = ref<KnowledgeBase[]>([])
  const loading = ref(false)

  async function fetchCategories() {
    loading.value = true
    try {
      categories.value = (await window.api.knowledge.invoke('listCategories')) as KBCategory[]
    } finally {
      loading.value = false
    }
  }

  async function createCategory(data: { name: string; description?: string }) {
    const result = (await window.api.knowledge.invoke('createCategory', plain(data))) as KBCategory
    categories.value.unshift(result)
    return result
  }

  async function updateCategory(id: string, data: Partial<KBCategory>) {
    const result = (await window.api.knowledge.invoke('updateCategory', id, plain(data))) as KBCategory
    const idx = categories.value.findIndex((c) => c.id === id)
    if (idx !== -1) categories.value[idx] = result
    return result
  }

  async function deleteCategory(id: string) {
    await window.api.knowledge.invoke('deleteCategory', id)
    categories.value = categories.value.filter((c) => c.id !== id)
  }

  async function fetchKnowledgeBases(categoryId?: string) {
    knowledgeBases.value = (await window.api.knowledge.invoke('list', categoryId)) as KnowledgeBase[]
  }

  async function createKnowledgeBase(data: {
    category_id: string
    name: string
    file_path: string
    file_type: string
  }) {
    const result = (await window.api.knowledge.invoke('create', plain(data))) as KnowledgeBase
    knowledgeBases.value.unshift(result)
    return result
  }

  async function deleteKnowledgeBase(id: string) {
    await window.api.knowledge.invoke('delete', id)
    knowledgeBases.value = knowledgeBases.value.filter((k) => k.id !== id)
  }

  const pagedItems = ref<KnowledgeBase[]>([])
  const pagedTotal = ref(0)

  async function fetchKnowledgeBasesPaged(categoryId: string, page: number, pageSize: number) {
    const result = (await window.api.knowledge.invoke('listPaged', categoryId, page, pageSize)) as { items: KnowledgeBase[]; total: number }
    pagedItems.value = result.items
    pagedTotal.value = result.total
    return result
  }

  async function bindFolder(categoryId: string, folderPath: string) {
    return (await window.api.knowledge.invoke('bindFolder', categoryId, folderPath)) as KBCategory
  }

  async function unbindFolder(categoryId: string, folderPath: string) {
    return (await window.api.knowledge.invoke('unbindFolder', categoryId, folderPath)) as KBCategory
  }

  async function syncCategory(categoryId: string) {
    return (await window.api.knowledge.invoke('sync', categoryId)) as { added: number; removed: number; modified: number }
  }

  return {
    categories,
    knowledgeBases,
    pagedItems,
    pagedTotal,
    loading,
    fetchCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    fetchKnowledgeBases,
    fetchKnowledgeBasesPaged,
    createKnowledgeBase,
    deleteKnowledgeBase,
    bindFolder,
    unbindFolder,
    syncCategory
  }
})
