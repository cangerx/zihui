<template>
  <!-- Teleport 到 body：避免被画布节点的 transform 容器影响（缩放 + fixed 重定位） -->
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="cancel">
      <div class="bg-surface-0 rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.15)] w-full max-w-4xl max-h-[80vh] flex flex-col">
      <div class="flex items-center justify-between px-5 py-3 border-b border-surface-3">
        <h2 class="text-sm font-semibold text-text-primary">{{ pickerTitle }}</h2>
        <div class="flex items-center gap-2">
          <span v-if="multiple && selectedPaths.length" class="text-xs text-text-tertiary">
            已选 {{ selectedPaths.length }} 张
          </span>
          <button class="btn-ghost text-xs px-2 py-1" @click="cancel">取消</button>
          <button class="btn-primary text-xs px-3 py-1" :disabled="!selectedPaths.length" @click="confirm">确定</button>
        </div>
      </div>

      <!-- 来源导航 + 搜索 -->
      <div class="px-4 pt-3 flex items-center gap-2 flex-shrink-0">
        <div v-if="mode === 'creation-reference'" class="flex items-center gap-1 flex-1 overflow-x-auto no-scrollbar">
          <button
            v-for="source in creationSources"
            :key="source.key"
            class="px-2.5 py-1 rounded-lg text-xs whitespace-nowrap transition-colors"
            :class="activeSource === source.key ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 font-medium' : 'text-text-secondary hover:bg-surface-2'"
            @click="switchSource(source.key)"
          >{{ source.label }}</button>
          <select
            v-if="activeSource === 'other'"
            v-model="selectedWorkspaceId"
            class="input-field !w-40 !h-7 !py-0 text-xs"
            @change="switchOtherWorkspace"
          >
            <option value="">选择工作区</option>
            <option v-for="workspace in otherWorkspaces" :key="workspace.id" :value="workspace.id">{{ workspace.name }}</option>
          </select>
        </div>
        <div v-else class="flex items-center gap-1 flex-1 overflow-x-auto no-scrollbar">
          <button
            v-if="!workspaceCatId"
            class="px-2.5 py-1 rounded-lg text-xs whitespace-nowrap transition-colors"
            :class="activeCat === null ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 font-medium' : 'text-text-secondary hover:bg-surface-2'"
            @click="switchCat(null)"
          >全部</button>
          <button
            v-for="cat in categories"
            :key="cat.id"
            class="px-2.5 py-1 rounded-lg text-xs whitespace-nowrap transition-colors"
            :class="activeCat === cat.id ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 font-medium' : 'text-text-secondary hover:bg-surface-2'"
            @click="switchCat(cat.id)"
          >{{ categoryLabel(cat) }}</button>
        </div>
        <div class="relative w-44 flex-shrink-0">
          <input
            v-model="searchText"
            class="input-field pl-7 text-xs h-7"
            placeholder="搜索..."
            @input="onSearch"
          />
          <svg class="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        </div>
      </div>

      <!-- Grid -->
      <div class="flex-1 overflow-y-auto p-4">
        <div v-if="items.length === 0" class="text-center py-12 text-sm text-text-tertiary">{{ emptyHint }}</div>
        <div v-else class="grid grid-cols-6 gap-1.5">
          <div
            v-for="item in items"
            :key="item.id"
            class="relative aspect-square rounded-lg overflow-hidden bg-surface-2 cursor-pointer border transition-colors"
            :class="isSelected(item.file_path) ? 'border-primary-500 ring-2 ring-primary-300' : 'border-surface-3 hover:border-primary-400'"
            @click="toggleItem(item)"
          >
            <img
              :src="toLocalThumbUrl(item.file_path)"
              :alt="item.name"
              class="w-full h-full object-cover"
              :class="isFailed(item.file_path) ? 'opacity-20' : ''"
              loading="lazy"
              decoding="async"
              @error="markFailed(item.file_path)"
            />
            <div v-if="isFailed(item.file_path)" class="absolute inset-0 flex items-center justify-center text-[10px] text-text-tertiary bg-surface-2/80">文件已失效</div>
            <div
              v-if="isSelected(item.file_path)"
              class="absolute top-1 left-1 w-4 h-4 rounded-full bg-primary-500 flex items-center justify-center"
            >
              <svg class="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
          </div>
        </div>

        <!-- Pagination -->
        <div v-if="totalPages > 1" class="flex items-center justify-center gap-2 pt-3">
          <button class="btn-secondary text-xs px-2 py-0.5" :disabled="page <= 1" @click="setPage(page - 1)">上一页</button>
          <span class="text-xs text-text-tertiary">{{ page }} / {{ totalPages }}</span>
          <button class="btn-secondary text-xs px-2 py-0.5" :disabled="page >= totalPages" @click="setPage(page + 1)">下一页</button>
        </div>
      </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAgentWorkspaceStore } from '@/stores/agent-workspaces'

const SYS_CREATION = '__sys_creation__'
const SYS_MATTING = '__sys_matting__'
const SYS_FINE_MATTING = '__sys_fine_matting__'

interface GalleryCategory {
  id: string
  name: string
}

interface GalleryItem {
  id: string
  file_path: string
  name: string
}

const props = withDefaults(defineProps<{
  visible: boolean
  multiple?: boolean
  mode?: 'default' | 'creation-reference'
  /** 打开时预选的图库分类（如品牌图库） */
  initialCategoryId?: string | null
}>(), {
  multiple: false,
  mode: 'default',
  initialCategoryId: null
})

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void
  (e: 'select', paths: string[]): void
}>()

const workspaceStore = useAgentWorkspaceStore()
const mode = computed(() => props.mode)
const categories = ref<GalleryCategory[]>([])
const items = ref<GalleryItem[]>([])
const total = ref(0)
const activeCat = ref<string | null>(null)
const searchText = ref('')
const page = ref(1)
const pageSize = 30
const selectedPaths = ref<string[]>([])
const workspaceCatId = ref('')
const activeSource = ref<'current' | 'history' | 'other'>('current')
const selectedWorkspaceId = ref('')
const failedPaths = ref<string[]>([])
let requestSeq = 0

const creationSources = [
  { key: 'current' as const, label: '当前工作区' },
  { key: 'history' as const, label: '历史创作' },
  { key: 'other' as const, label: '其他工作区' }
]

const otherWorkspaces = computed(() =>
  workspaceStore.items.filter((workspace) => workspace.id !== workspaceStore.activeId)
)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const pickerTitle = computed(() =>
  workspaceStore.activeName ? `当前文件夹图库` : '从图库选择'
)
const emptyHint = computed(() => {
  if (mode.value === 'creation-reference' && activeSource.value === 'other') {
    return selectedWorkspaceId.value ? '该工作区暂无图片' : '请选择一个工作区'
  }
  return '暂无图片'
})

function categoryLabel(cat: GalleryCategory): string {
  if (workspaceCatId.value && cat.id === workspaceCatId.value) {
    return workspaceStore.activeName || '当前文件夹'
  }
  if (cat.id === SYS_CREATION) return '历史创作'
  return cat.name
}

watch(() => props.visible, async (val) => {
  if (val) {
    selectedPaths.value = []
    failedPaths.value = []
    searchText.value = ''
    page.value = 1
    const ws = await workspaceStore.ensureGallery()
    if (mode.value === 'creation-reference') await workspaceStore.refresh()
    workspaceCatId.value = ws?.gallery_category_id || ''
    const all = (await window.api.gallery.invoke('listCategories')) as GalleryCategory[]
    if (mode.value === 'creation-reference') {
      categories.value = all
      activeSource.value = workspaceCatId.value ? 'current' : 'history'
      selectedWorkspaceId.value = ''
      activeCat.value = workspaceCatId.value || SYS_CREATION
    } else {
      categories.value = all.filter((c) => {
        if (workspaceCatId.value && c.id === workspaceCatId.value) return true
        if (c.id === SYS_MATTING || c.id === SYS_FINE_MATTING) return true
        return false
      })
      const prefer = props.initialCategoryId || workspaceCatId.value
      activeCat.value =
        prefer && categories.value.some((c) => c.id === prefer)
          ? prefer
          : categories.value[0]?.id || null
    }
    await fetchItems()
  }
})

async function fetchItems() {
  const seq = ++requestSeq
  if (mode.value === 'creation-reference' && !activeCat.value) {
    items.value = []
    total.value = 0
    return
  }
  const result = (await window.api.gallery.invoke(
    'listItemsPaged',
    activeCat.value,
    searchText.value,
    page.value,
    pageSize
  )) as { items: GalleryItem[]; total: number }
  if (seq !== requestSeq) return
  items.value = result.items
  total.value = result.total
}

function resetQueryState() {
  searchText.value = ''
  page.value = 1
  items.value = []
  total.value = 0
}

function switchSource(source: 'current' | 'history' | 'other') {
  activeSource.value = source
  resetQueryState()
  if (source === 'current') {
    activeCat.value = workspaceCatId.value || null
    void fetchItems()
    return
  }
  if (source === 'history') {
    activeCat.value = SYS_CREATION
    void fetchItems()
    return
  }
  if (!selectedWorkspaceId.value && otherWorkspaces.value[0]) {
    selectedWorkspaceId.value = otherWorkspaces.value[0].id
  }
  void loadOtherWorkspace()
}

async function loadOtherWorkspace() {
  const id = selectedWorkspaceId.value
  if (!id) {
    activeCat.value = null
    resetQueryState()
    return
  }
  const prepared = await workspaceStore.prepareGallery(id)
  activeCat.value = prepared?.gallery_category_id || null
  resetQueryState()
  await fetchItems()
}

function switchOtherWorkspace() {
  void loadOtherWorkspace()
}

function switchCat(id: string | null) {
  activeCat.value = id
  page.value = 1
  fetchItems()
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    fetchItems()
  }, 300)
}

function setPage(p: number) {
  page.value = p
  fetchItems()
}

function isSelected(filePath: string) {
  return selectedPaths.value.includes(filePath)
}

function toggleItem(item: GalleryItem) {
  if (isFailed(item.file_path)) return
  if (props.multiple) {
    if (isSelected(item.file_path)) {
      selectedPaths.value = selectedPaths.value.filter(p => p !== item.file_path)
    } else {
      selectedPaths.value = [...selectedPaths.value, item.file_path]
    }
  } else {
    selectedPaths.value = [item.file_path]
  }
}

function toLocalThumbUrl(filePath: string): string {
  const isAbsolute = /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('/')
  const param = isAbsolute ? 'p' : 'rel'
  const normalized = isAbsolute ? filePath.replace(/\\/g, '/') : filePath
  return `local-file://img?${param}=${encodeURIComponent(normalized)}&thumb=1`
}

function isFailed(filePath: string): boolean {
  return failedPaths.value.includes(filePath)
}

function markFailed(filePath: string) {
  if (!isFailed(filePath)) failedPaths.value = [...failedPaths.value, filePath]
  selectedPaths.value = selectedPaths.value.filter((path) => path !== filePath)
}

function cancel() {
  emit('update:visible', false)
}

function confirm() {
  emit('select', selectedPaths.value.filter((path) => !isFailed(path)))
  emit('update:visible', false)
}
</script>
