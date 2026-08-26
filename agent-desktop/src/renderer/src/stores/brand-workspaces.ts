import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

function plain<T>(data: T): T {
  return JSON.parse(JSON.stringify(data))
}

export interface BrandWorkspace {
  id: string
  name: string
  description: string
  kb_category_id: string
  gallery_category_id: string
  output_dir: string
  default_bot_id: string
  sort_order: number
  created_at: string
  updated_at: string
}

const ACTIVE_KEY = 'brandWorkspace.activeId'

export const useBrandWorkspaceStore = defineStore('brandWorkspaces', () => {
  const items = ref<BrandWorkspace[]>([])
  const loading = ref(false)
  const activeId = ref<string>(localStorage.getItem(ACTIVE_KEY) || '')

  const active = computed(() => items.value.find((x) => x.id === activeId.value) || null)

  async function fetchAll() {
    loading.value = true
    try {
      items.value = (await window.api.brandWorkspace.invoke('list')) as BrandWorkspace[]
      if (activeId.value && !items.value.some((x) => x.id === activeId.value)) {
        setActive('')
      }
    } finally {
      loading.value = false
    }
  }

  async function create(data: { name: string; description?: string; default_bot_id?: string }) {
    const row = (await window.api.brandWorkspace.invoke('create', plain(data))) as BrandWorkspace
    items.value.unshift(row)
    setActive(row.id)
    return row
  }

  async function update(
    id: string,
    data: Partial<{
      name: string
      description: string
      output_dir: string
      default_bot_id: string
      sort_order: number
    }>
  ) {
    const row = (await window.api.brandWorkspace.invoke('update', id, plain(data))) as BrandWorkspace
    const idx = items.value.findIndex((x) => x.id === id)
    if (idx !== -1) items.value[idx] = row
    return row
  }

  async function remove(id: string) {
    await window.api.brandWorkspace.invoke('delete', id)
    items.value = items.value.filter((x) => x.id !== id)
    if (activeId.value === id) setActive('')
  }

  function setActive(id: string) {
    activeId.value = id || ''
    if (activeId.value) localStorage.setItem(ACTIVE_KEY, activeId.value)
    else localStorage.removeItem(ACTIVE_KEY)
  }

  async function get(id: string): Promise<BrandWorkspace | null> {
    const cached = items.value.find((x) => x.id === id)
    if (cached) return cached
    return (await window.api.brandWorkspace.invoke('get', id)) as BrandWorkspace | null
  }

  return {
    items,
    loading,
    activeId,
    active,
    fetchAll,
    create,
    update,
    remove,
    setActive,
    get
  }
})
