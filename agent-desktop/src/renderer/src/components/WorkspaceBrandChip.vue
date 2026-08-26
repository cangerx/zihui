<template>
  <div ref="rootRef" class="relative">
    <div class="text-[11px] text-text-tertiary mb-1">当前文件夹</div>
    <button
      type="button"
      class="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-surface-3 bg-surface-1 text-left text-xs text-text-primary hover:bg-surface-2 transition-colors"
      title="换文件夹即换品牌"
      @click="menuOpen = !menuOpen"
    >
      <span class="truncate flex-1">{{ folderName }}</span>
      <svg class="w-3 h-3 flex-shrink-0 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
      </svg>
    </button>
    <p class="mt-1 text-[11px] leading-snug" :class="statusClass">{{ statusText }}</p>
    <button
      v-if="canOpenDocs"
      type="button"
      class="mt-0.5 text-[11px] text-primary-600 hover:text-primary-700"
      @click="openDocs"
    >打开 docs 放入规范</button>

    <div
      v-if="menuOpen"
      class="absolute left-0 right-0 top-full mt-1 z-40 bg-surface-0 border border-surface-3 rounded-xl shadow-modal py-1 max-h-64 overflow-y-auto"
    >
      <button
        v-for="ws in workspaceStore.items"
        :key="ws.id"
        type="button"
        class="w-full text-left px-3 py-2 hover:bg-surface-1 transition-colors"
        @click="selectWs(ws.id)"
      >
        <div class="flex items-center gap-1.5">
          <span
            class="text-xs truncate"
            :class="ws.id === workspaceStore.activeId ? 'text-text-primary font-medium' : 'text-text-secondary'"
          >{{ ws.name }}</span>
          <span
            v-if="ws.is_default"
            class="flex-shrink-0 text-[10px] leading-4 px-1 rounded border border-surface-3 text-text-tertiary"
          >默认</span>
        </div>
        <div class="text-[10px] text-text-tertiary truncate mt-0.5 font-mono">{{ ws.root_path }}</div>
      </button>
      <div class="my-1 border-t border-surface-2" />
      <button
        type="button"
        class="w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-surface-1"
        @click="openExisting"
      >打开现有文件夹…</button>
      <p v-if="error" class="px-3 py-1.5 text-[11px] text-red-600">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRef } from 'vue'
import { useAgentWorkspaceStore } from '@/stores/agent-workspaces'
import { useWorkspaceBrandChip } from '@/composables/useWorkspaceBrandChip'

const props = defineProps<{ prompt: string }>()
const workspaceStore = useAgentWorkspaceStore()
const { canOpenDocs, overridden, ensuring, summary, openDocs, folderName, statusText } =
  useWorkspaceBrandChip(toRef(props, 'prompt'))

const rootRef = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
const error = ref('')

const statusClass = computed(() => {
  if (overridden.value) return 'text-amber-800 dark:text-amber-200'
  if (ensuring.value) return 'text-text-tertiary'
  if (summary.value?.hasHex && summary.value.status !== 'missing') {
    return 'text-emerald-800 dark:text-emerald-200'
  }
  return 'text-text-tertiary'
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
    await workspaceStore.setActive(id)
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
    await workspaceStore.openFolder(result.filePaths[0])
    menuOpen.value = false
  } catch (e: any) {
    error.value = e?.message || String(e)
  }
}

onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>
