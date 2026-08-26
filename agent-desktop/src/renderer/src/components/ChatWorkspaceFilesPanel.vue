<template>
  <aside class="w-72 flex-shrink-0 border-l border-surface-2 bg-surface-0 flex flex-col min-h-0">
    <div class="h-11 flex-shrink-0 flex items-center gap-1.5 px-3 border-b border-surface-2">
      <div class="min-w-0 flex-1">
        <div class="text-xs font-semibold text-text-primary truncate">工作区文件</div>
        <div class="text-[10px] text-text-tertiary truncate" :title="listing?.root || ''">
          {{ listing?.workspaceName || workspaceName || '—' }}
        </div>
      </div>
      <button
        type="button"
        class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2"
        title="刷新"
        @click="refresh"
      >
        <svg class="w-3.5 h-3.5" :class="loading ? 'animate-spin' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" /></svg>
      </button>
      <button
        type="button"
        class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2"
        title="在访达/资源管理器中打开"
        @click="openRoot"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
      </button>
      <button
        type="button"
        class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2"
        title="关闭"
        @click="$emit('close')"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>

    <div class="flex-shrink-0 px-3 py-2 border-b border-surface-2">
      <button
        type="button"
        class="text-[11px] leading-snug text-left hover:text-primary-700"
        :class="voiceHas ? 'text-emerald-800 dark:text-emerald-200' : 'text-text-tertiary'"
        title="这个文件夹里的对话会按这段口吻说话"
        @click.stop="openVoiceEditor"
      >品牌口吻 · {{ voiceHas ? '已设置' : '未写' }}</button>
    </div>

    <div v-if="listing && listing.relPath !== '.'" class="flex-shrink-0 px-2 py-1.5 border-b border-surface-2">
      <button
        type="button"
        class="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-text-secondary hover:bg-surface-2 rounded-lg truncate"
        @click="goParent"
      >
        <svg class="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
        <span class="truncate font-mono">{{ listing.relPath }}</span>
      </button>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto">
      <div v-if="error" class="px-3 py-6 text-center text-[11px] text-amber-700">{{ error }}</div>
      <div v-else-if="loading && !listing" class="px-3 py-10 text-center text-[11px] text-text-tertiary">加载中…</div>
      <div v-else-if="!entries.length" class="px-3 py-10 text-center text-[11px] text-text-tertiary leading-relaxed">
        当前目录为空<br />约定子目录：docs / assets / output
      </div>
      <ul v-else class="py-1">
        <li v-for="entry in entries" :key="entry.name">
          <button
            type="button"
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-2 group"
            @click="onEntryClick(entry)"
            @dblclick="onEntryDblClick(entry)"
            @contextmenu.prevent="onContext(entry, $event)"
          >
            <span class="w-4 h-4 flex-shrink-0 text-text-tertiary">
              <svg v-if="entry.isDirectory" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" /></svg>
              <svg v-else class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-[12px] text-text-primary truncate">{{ entry.name }}</span>
              <span v-if="!entry.isDirectory" class="block text-[10px] text-text-tertiary">{{ formatSize(entry.size) }}</span>
            </span>
            <span class="opacity-0 group-hover:opacity-100 flex gap-0.5 flex-shrink-0">
              <button
                type="button"
                class="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-3"
                title="打开"
                @click.stop="openEntry(entry)"
              >
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
              </button>
              <button
                type="button"
                class="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-3"
                title="在文件夹中显示"
                @click.stop="revealEntry(entry)"
              >
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" /></svg>
              </button>
            </span>
          </button>
        </li>
      </ul>
    </div>

    <div
      v-if="ctx"
      class="fixed z-[100] min-w-[9rem] py-1 rounded-lg bg-surface-0 border border-surface-3 shadow-modal text-xs"
      :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }"
    >
      <button type="button" class="w-full text-left px-3 py-1.5 hover:bg-surface-2" @click="openEntry(ctx.entry); ctx = null">打开</button>
      <button type="button" class="w-full text-left px-3 py-1.5 hover:bg-surface-2" @click="revealEntry(ctx.entry); ctx = null">在文件夹中显示</button>
    </div>

    <Teleport to="body">
    <div
      v-if="voiceOpen"
      class="fixed inset-0 z-[90] flex items-center justify-center bg-black/30"
      @click.self="voiceOpen = false"
    >
      <div class="w-[420px] max-w-[calc(100vw-2rem)] bg-surface-0 rounded-xl shadow-modal border border-surface-3 p-4">
        <h3 class="text-sm font-semibold text-text-primary">品牌口吻</h3>
        <p class="mt-1.5 text-[11px] leading-relaxed text-text-tertiary">
          写这段话后，这个文件夹里的对话都会按这个口吻说话。人手保存后不会被自动覆盖。
        </p>
        <textarea
          v-model="voiceDraft"
          rows="8"
          maxlength="2000"
          class="mt-3 w-full resize-y rounded-lg border border-surface-3 bg-surface-1 px-2.5 py-2 text-xs text-text-primary leading-relaxed focus:outline-none focus:border-primary-500"
          placeholder="例如：自称「莉莉」；对用户说「你」；语气轻松，少客套，不讲营销腔。"
        />
        <p v-if="voiceError" class="mt-1.5 text-[11px] text-red-600">{{ voiceError }}</p>
        <div class="mt-3 flex justify-end gap-2">
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded-lg border border-surface-3 hover:bg-surface-2"
            @click="voiceOpen = false"
          >取消</button>
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
            :disabled="voiceSaving"
            @click="saveVoice"
          >{{ voiceSaving ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </div>
    </Teleport>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

export interface WorkspaceDirEntry {
  name: string
  isDirectory: boolean
  size: number
  mtime: string
}

interface WorkspaceDirListing {
  root: string
  workspaceName: string
  relPath: string
  absPath: string
  parentRel: string | null
  entries: WorkspaceDirEntry[]
}

const props = defineProps<{
  workspaceId?: string
  workspaceName?: string
}>()

defineEmits<{ close: [] }>()

interface VoiceSummary {
  body: string
  locked: boolean
  hasVoice: boolean
  source_fingerprint: string
  updated_at: string
  note: string
}

const listing = ref<WorkspaceDirListing | null>(null)
const loading = ref(false)
const error = ref('')
const relPath = ref('.')
const ctx = ref<{ x: number; y: number; entry: WorkspaceDirEntry } | null>(null)
const voiceHas = ref(false)
const voiceOpen = ref(false)
const voiceDraft = ref('')
const voiceSaving = ref(false)
const voiceError = ref('')

const entries = computed(() => listing.value?.entries || [])

function formatSize(n: number): string {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function absFor(entry: WorkspaceDirEntry): string {
  const base = listing.value?.absPath || ''
  const sep = base.includes('\\') ? '\\' : '/'
  return `${base.replace(/[\\/]+$/, '')}${sep}${entry.name}`
}

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    if (!window.api?.agentWorkspace?.invoke) {
      error.value = '工作区服务未加载，请重启应用'
      return
    }
    listing.value = (await window.api.agentWorkspace.invoke(
      'listDir',
      relPath.value
    )) as WorkspaceDirListing
  } catch (e: any) {
    error.value = e?.message || String(e)
    listing.value = null
  } finally {
    loading.value = false
  }
}

function goParent() {
  if (!listing.value?.parentRel) return
  relPath.value = listing.value.parentRel
}

function onEntryClick(entry: WorkspaceDirEntry) {
  ctx.value = null
  if (entry.isDirectory) {
    const base = listing.value?.relPath === '.' ? '' : `${listing.value?.relPath}/`
    relPath.value = `${base}${entry.name}`.replace(/^\//, '')
  }
}

function onEntryDblClick(entry: WorkspaceDirEntry) {
  if (!entry.isDirectory) void openEntry(entry)
}

async function openEntry(entry: WorkspaceDirEntry) {
  if (entry.isDirectory) {
    onEntryClick(entry)
    return
  }
  await window.api.shell.openPath(absFor(entry))
}

async function revealEntry(entry: WorkspaceDirEntry) {
  await window.api.shell.showItemInFolder(absFor(entry))
}

async function openRoot() {
  const root = listing.value?.root
  if (root) await window.api.shell.openPath(root)
  else {
    const r = (await window.api.agentWorkspace.invoke('getRoot')) as string
    if (r) await window.api.shell.openPath(r)
  }
}

async function refreshVoice() {
  try {
    const summary = (await window.api.brand.invoke('getVoice')) as VoiceSummary
    voiceHas.value = !!summary?.hasVoice
    if (!voiceOpen.value) voiceDraft.value = summary?.body || ''
  } catch (e) {
    console.warn('[brand] getVoice failed:', e)
  }
}

async function ensureAndRefreshVoice() {
  try {
    const summary = (await window.api.brand.invoke('ensureVoice')) as VoiceSummary
    voiceHas.value = !!summary?.hasVoice
    if (!voiceOpen.value) voiceDraft.value = summary?.body || ''
  } catch (e) {
    console.warn('[brand] ensureVoice failed:', e)
    void refreshVoice()
  }
}

async function openVoiceEditor() {
  voiceError.value = ''
  try {
    const summary = (await window.api.brand.invoke('getVoice')) as VoiceSummary
    voiceHas.value = !!summary?.hasVoice
    voiceDraft.value = summary?.body || ''
  } catch (e: any) {
    voiceError.value = e?.message || String(e)
  }
  voiceOpen.value = true
}

async function saveVoice() {
  voiceSaving.value = true
  voiceError.value = ''
  try {
    const summary = (await window.api.brand.invoke('saveVoice', voiceDraft.value)) as VoiceSummary
    voiceHas.value = !!summary?.hasVoice
    voiceDraft.value = summary?.body || ''
    voiceOpen.value = false
  } catch (e: any) {
    voiceError.value = e?.message || String(e)
  } finally {
    voiceSaving.value = false
  }
}

function onContext(entry: WorkspaceDirEntry, e: MouseEvent) {
  ctx.value = { x: e.clientX, y: e.clientY, entry }
}

function onDocClick() {
  ctx.value = null
}

watch(
  () => props.workspaceId,
  () => {
    relPath.value = '.'
    voiceOpen.value = false
    void refresh()
    void ensureAndRefreshVoice()
  }
)

watch(relPath, () => {
  void refresh()
})

onMounted(() => {
  document.addEventListener('click', onDocClick)
  void refresh()
  void ensureAndRefreshVoice()
})

onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
})

defineExpose({ refresh })
</script>
