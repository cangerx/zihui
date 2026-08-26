import { defineStore } from 'pinia'
import { ref } from 'vue'

function plain<T>(data: T): T {
  return JSON.parse(JSON.stringify(data))
}

export interface GalleryCategory {
  id: string
  name: string
  description: string
  is_system: number
  sort_order: number
  created_at: string
}

export interface GalleryItem {
  id: string
  category_id: string
  name: string
  file_path: string
  file_type: string
  file_size: number
  width: number
  height: number
  source: string
  folder_root: string
  folder_recursive: number
  created_at: string
}

export const useGalleryStore = defineStore('gallery', () => {
  const categories = ref<GalleryCategory[]>([])
  const items = ref<GalleryItem[]>([])
  const total = ref(0)
  const loading = ref(false)

  const activeCategoryId = ref<string | null>(null)
  const search = ref('')
  const page = ref(1)
  const pageSize = ref(30)

  // ────── Categories ──────

  async function fetchCategories() {
    categories.value = (await window.api.gallery.invoke('listCategories')) as GalleryCategory[]
  }

  async function createCategory(data: { name: string; description?: string }) {
    const result = (await window.api.gallery.invoke('createCategory', plain(data))) as GalleryCategory
    categories.value.push(result)
    return result
  }

  async function updateCategory(id: string, data: { name?: string; description?: string }) {
    const result = (await window.api.gallery.invoke('updateCategory', id, plain(data))) as GalleryCategory
    const idx = categories.value.findIndex((c) => c.id === id)
    if (idx !== -1) categories.value[idx] = result
    return result
  }

  async function deleteCategory(id: string) {
    await window.api.gallery.invoke('deleteCategory', id)
    categories.value = categories.value.filter((c) => c.id !== id)
    if (activeCategoryId.value === id) {
      activeCategoryId.value = null
      await fetchItems()
    }
  }

  async function getCategoryItemCount(categoryId: string): Promise<number> {
    return (await window.api.gallery.invoke('getCategoryItemCount', categoryId)) as number
  }

  // ────── Items ──────

  async function fetchItems() {
    loading.value = true
    try {
      const result = (await window.api.gallery.invoke(
        'listItemsPaged',
        activeCategoryId.value,
        search.value,
        page.value,
        pageSize.value
      )) as { items: GalleryItem[]; total: number }
      items.value = result.items
      total.value = result.total
    } finally {
      loading.value = false
    }
  }

  async function getItem(id: string): Promise<GalleryItem | null> {
    return (await window.api.gallery.invoke('getItem', id)) as GalleryItem | null
  }

  async function addFile(categoryId: string, filePath: string) {
    const result = (await window.api.gallery.invoke('addFile', categoryId, filePath)) as GalleryItem | null
    if (result && (!activeCategoryId.value || activeCategoryId.value === categoryId)) {
      await fetchItems()
    }
    return result
  }

  /**
   * O4: 工具页保存生成结果到图库。
   * dataUri 必须是 data:image/(png|jpeg|webp|gif|bmp);base64,... 形式。
   * 写盘成功后会自动 refresh 当前列表（如果当前查看的就是该分类）。
   */
  async function addFromDataUri(categoryId: string, dataUri: string, displayName: string) {
    const result = (await window.api.gallery.invoke(
      'addFromDataUri',
      categoryId,
      dataUri,
      displayName
    )) as GalleryItem | null
    if (result && (!activeCategoryId.value || activeCategoryId.value === categoryId)) {
      await fetchItems()
    }
    return result
  }

  async function addFolder(categoryId: string, folderPath: string, recursive: boolean) {
    const result = (await window.api.gallery.invoke('addFolder', categoryId, folderPath, recursive)) as {
      added: number
      skipped: number
    }
    if (!activeCategoryId.value || activeCategoryId.value === categoryId) {
      await fetchItems()
    }
    return result
  }

  async function removeItems(ids: string[]) {
    const count = (await window.api.gallery.invoke('removeItems', ids)) as number
    await fetchItems()
    return count
  }

  async function sync(categoryId?: string) {
    const result = (await window.api.gallery.invoke('sync', categoryId)) as {
      removed: number
      checked: number
    }
    await fetchItems()
    return result
  }

  // ────── Pagination helpers ──────

  function setPage(p: number) {
    page.value = p
    return fetchItems()
  }

  function setCategory(id: string | null) {
    activeCategoryId.value = id
    page.value = 1
    return fetchItems()
  }

  function setSearch(s: string) {
    search.value = s
    page.value = 1
    return fetchItems()
  }

  return {
    categories,
    items,
    total,
    loading,
    activeCategoryId,
    search,
    page,
    pageSize,
    fetchCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    getCategoryItemCount,
    fetchItems,
    getItem,
    addFile,
    addFromDataUri,
    addFolder,
    removeItems,
    sync,
    setPage,
    setCategory,
    setSearch
  }
})
