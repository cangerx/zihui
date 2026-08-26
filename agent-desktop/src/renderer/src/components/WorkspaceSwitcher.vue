<template>
  <div class="relative no-drag flex items-center min-w-0 gap-0.5" ref="rootRef">
    <div class="flex items-center min-w-0 overflow-x-auto">
      <button
        v-for="ws in store.openTabs"
        :key="ws.id"
        type="button"
        class="group flex items-center gap-1.5 h-8 max-w-[11rem] pl-2.5 pr-1.5 text-xs rounded-lg flex-shrink-0 transition-colors"
        :class="ws.id === store.activeId
          ? 'bg-surface-1 text-text-primary font-medium'
          : 'text-text-secondary hover:bg-surface-1 hover:text-text-primary'"
        :title="ws.root_path"
        @click="selectWs(ws.id)"
      >
        <svg class="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.06-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
        </svg>
        <span class="truncate">{{ ws.name }}</span>
        <span
          v-if="store.openTabs.length > 1"
          class="w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-text-primary hover:bg-surface-2"
          title="关闭标签"
          @click.stop="closeTab(ws.id)"
        >
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
        </span>
      </button>
    </div>

    <button
      type="button"
      class="h-8 w-8 flex items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-1 transition-colors flex-shrink-0"
      title="打开工作区"
      @click="menuOpen = !menuOpen"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
    </button>

    <div
      v-if="menuOpen"
      class="absolute top-full left-0 mt-1.5 w-64 bg-surface-0 border border-surface-3 rounded-xl shadow-modal z-50 py-1 overflow-hidden"
    >
      <div class="px-3 py-1.5 text-[10px] text-text-tertiary">打开为标签</div>
      <button
        v-for="ws in unopened"
        :key="ws.id"
        type="button"
        class="w-full text-left px-3 py-2 hover:bg-surface-1 transition-colors"
        @click="selectWs(ws.id)"
      >
        <div class="text-xs font-medium text-text-primary truncate">{{ ws.name }}</div>
        <div class="text-[10px] text-text-tertiary truncate mt-0.5 font-mono">{{ ws.root_path }}</div>
      </button>
      <p v-if="!unopened.length" class="px-3 py-2 text-[11px] text-text-tertiary">侧栏工作区都已打开</p>
      <div class="my-1 border-t border-surface-2" />
      <button
        type="button"
        class="w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-surface-1 flex items-center gap-2"
        @click="openExisting"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
        打开现有文件夹
      </button>
      <button
        type="button"
        class="w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-surface-1 flex items-center gap-2"
        @click="startCreate"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        创建新工作区
      </button>
      <p v-if="error" class="px-3 py-2 text-[11px] text-red-600">{{ error }}</p>
    </div>

    <div
      v-if="showCreate"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
      @click.self="showCreate = false"
    >
      <div class="w-full max-w-sm rounded-2xl bg-surface-0 shadow-panel p-5 space-y-3">
        <h3 class="text-sm font-semibold text-text-primary">创建新工作区</h3>
        <input
          v-model="createName"
          class="input-field text-sm"
          placeholder="名称，如 LiLitime"
          @keydown.enter="confirmCreate"
        />
        <p class="text-[11px] text-text-tertiary">将在本地数据目录下新建文件夹，并生成 docs / assets / output 子目录。</p>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary text-sm" @click="showCreate = false">取消</button>
          <button class="btn-primary text-sm" :disabled="!createName.trim() || busy" @click="confirmCreate">
            {{ busy ? '创建中…' : '创建' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAgentWorkspaceStore } from '@/stores/agent-workspaces'

const store = useAgentWorkspaceStore()
const menuOpen = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const error = ref('')
const showCreate = ref(false)
const createName = ref('')
const busy = ref(false)

const unopened = computed(() => {
  const open = new Set(store.openTabs.map((w) => w.id))
  return store.items.filter((w) => !open.has(w.id))
})

function onDocClick(e: MouseEvent) {
  if (!menuOpen.value) return
  const el = rootRef.value
  if (el && !el.contains(e.target as Node)) menuOpen.value = false
}

async function selectWs(id: string) {
  error.value = ''
  menuOpen.value = false
  try {
    await store.setActive(id)
  } catch (e: any) {
    error.value = e?.message || String(e)
  }
}

async function closeTab(id: string) {
  try {
    await store.closeTab(id)
  } catch (e: any) {
    error.value = e?.message || String(e)
  }
}

async function openExisting() {
  error.value = ''
  try {
    const result = (await window.api.dialog.openFile({
      title: '选择工作区文件夹',
      properties: ['openDirectory']
    })) as { canceled: boolean; filePaths: string[] }
    if (result.canceled || !result.filePaths.length) return
    await store.openFolder(result.filePaths[0])
    menuOpen.value = false
  } catch (e: any) {
    error.value = e?.message || String(e)
  }
}

function startCreate() {
  createName.value = ''
  showCreate.value = true
  menuOpen.value = false
}

async function confirmCreate() {
  if (!createName.value.trim() || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await store.create({ name: createName.value.trim() })
    showCreate.value = false
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  store.refresh().catch(() => {})
  document.addEventListener('click', onDocClick)
})
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>
