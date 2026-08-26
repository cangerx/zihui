import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

function plain<T>(data: T): T {
  return JSON.parse(JSON.stringify(data))
}

export interface AgentWorkspace {
  id: string
  name: string
  root_path: string
  is_default: number
  kb_category_id: string
  gallery_category_id: string
  last_opened_at: string
  created_at: string
  updated_at: string
}

export const useAgentWorkspaceStore = defineStore('agentWorkspaces', () => {
  const items = ref<AgentWorkspace[]>([])
  const active = ref<AgentWorkspace | null>(null)
  const loading = ref(false)
  const OPEN_TABS_KEY = 'agentWorkspace.openTabs'
  const openTabIds = ref<string[]>(loadOpenTabIds())

  const activeId = computed(() => active.value?.id || '')
  const activeName = computed(() => active.value?.name || '工作区')
  const activePath = computed(() => active.value?.root_path || '')
  const openTabs = computed(() => {
    const byId = new Map(items.value.map((w) => [w.id, w]))
    return openTabIds.value.map((id) => byId.get(id)).filter(Boolean) as AgentWorkspace[]
  })

  function loadOpenTabIds(): string[] {
    try {
      const raw = localStorage.getItem(OPEN_TABS_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []
    } catch {
      return []
    }
  }

  function persistOpenTabs() {
    localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(openTabIds.value))
  }

  function ensureTab(id: string) {
    if (!id) return
    if (!openTabIds.value.includes(id)) {
      openTabIds.value = [...openTabIds.value, id]
      persistOpenTabs()
    }
  }

  function pruneOpenTabs() {
    const known = new Set(items.value.map((w) => w.id))
    const next = openTabIds.value.filter((id) => known.has(id))
    if (next.length !== openTabIds.value.length) {
      openTabIds.value = next
      persistOpenTabs()
    }
  }

  async function closeTab(id: string) {
    const remaining = openTabIds.value.filter((x) => x !== id)
    if (!remaining.length) return
    openTabIds.value = remaining
    persistOpenTabs()
    if (active.value?.id === id) {
      await setActive(remaining[remaining.length - 1])
    }
  }

  async function refresh() {
    loading.value = true
    try {
      if (!window.api?.agentWorkspace?.invoke) {
        items.value = []
        active.value = null
        return
      }
      const [list, cur] = await Promise.all([
        window.api.agentWorkspace.invoke('list') as Promise<AgentWorkspace[]>,
        window.api.agentWorkspace.invoke('getActive') as Promise<AgentWorkspace>
      ])
      items.value = list || []
      active.value = cur || null
      pruneOpenTabs()
      if (active.value?.id) ensureTab(active.value.id)
    } finally {
      loading.value = false
    }
  }

  async function setActive(id: string) {
    const ws = (await window.api.agentWorkspace.invoke('setActive', id)) as AgentWorkspace | null
    if (ws) {
      active.value = ws
      ensureTab(ws.id)
      await refresh()
    }
    return ws
  }

  async function openFolder(folderPath: string, name?: string) {
    const ws = (await window.api.agentWorkspace.invoke(
      'openFolder',
      folderPath,
      name
    )) as AgentWorkspace
    active.value = ws
    ensureTab(ws.id)
    await refresh()
    return ws
  }

  async function create(data: { name: string; parentDir?: string }) {
    const ws = (await window.api.agentWorkspace.invoke('create', plain(data))) as AgentWorkspace
    active.value = ws
    ensureTab(ws.id)
    await refresh()
    return ws
  }

  async function remove(id: string) {
    await window.api.agentWorkspace.invoke('delete', id)
    await refresh()
  }

  async function ensureGallery(): Promise<AgentWorkspace | null> {
    try {
      const ws = (await window.api.agentWorkspace.invoke('ensureGallery')) as AgentWorkspace
      if (ws) {
        active.value = ws
        const idx = items.value.findIndex((w) => w.id === ws.id)
        if (idx >= 0) items.value[idx] = ws
        else items.value.push(ws)
      }
      return ws || null
    } catch (e) {
      console.warn('[workspace] ensureGallery failed:', e)
      return active.value
    }
  }

  async function prepareGallery(id: string): Promise<AgentWorkspace | null> {
    try {
      const ws = (await window.api.agentWorkspace.invoke('prepareGallery', id)) as AgentWorkspace
      if (ws) {
        const idx = items.value.findIndex((w) => w.id === ws.id)
        if (idx >= 0) items.value[idx] = ws
        else items.value.push(ws)
        if (active.value?.id === ws.id) active.value = ws
      }
      return ws || null
    } catch (e) {
      console.warn('[workspace] prepareGallery failed:', e)
      return items.value.find((w) => w.id === id) || null
    }
  }

  return {
    items,
    active,
    activeId,
    activeName,
    activePath,
    openTabs,
    loading,
    refresh,
    setActive,
    openFolder,
    create,
    remove,
    closeTab,
    ensureTab,
    ensureGallery,
    prepareGallery
  }
})
