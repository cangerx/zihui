<template>
  <div class="h-full flex flex-col">
    <header class="page-header justify-between">
      <div class="flex items-center gap-3">
        <span class="text-sm font-medium text-text-secondary">我的创作</span>
        <div class="flex items-center gap-1 ml-2">
          <button
            v-for="p in periodOptions"
            :key="p.value"
            @click="selectedPeriod = p.value; customStart = ''; customEnd = ''; page = 1; fetchData()"
            :class="['px-2.5 py-1 text-[11px] rounded-md transition-colors', selectedPeriod === p.value && !customStart ? 'bg-primary-100 text-primary-700 font-medium' : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-2']"
          >{{ p.label }}</button>
        </div>
        <div class="flex items-center gap-1.5 ml-2">
          <input type="date" v-model="customStart" @change="onCustomDateChange" class="px-2 py-1 text-[11px] border border-surface-3 rounded-md bg-surface-0 outline-none focus:ring-1 focus:ring-primary-500" />
          <span class="text-[10px] text-text-tertiary">~</span>
          <input type="date" v-model="customEnd" @change="onCustomDateChange" class="px-2 py-1 text-[11px] border border-surface-3 rounded-md bg-surface-0 outline-none focus:ring-1 focus:ring-primary-500" />
        </div>
      </div>
      <div class="flex items-center gap-2">
        <template v-if="selectMode">
          <span class="text-[11px] text-text-tertiary">{{ selectedIds.size }} 项已选</span>
          <button @click="toggleSelectAll" class="text-[11px] text-primary-600 hover:text-primary-700">{{ items.length > 0 && items.every(g => selectedIds.has(g.id)) ? '取消本页全选' : '本页全选' }}</button>
          <button v-if="selectedIds.size > 0" @click="deleteSelected" class="text-[11px] text-red-500 hover:text-red-600">删除所选</button>
        </template>
        <button v-if="items.length && !selectMode" @click="toggleSelectMode" class="p-1.5 rounded text-text-tertiary hover:text-text-secondary" title="选择">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
        </button>
        <button v-if="selectMode" @click="toggleSelectMode" class="p-1.5 rounded bg-primary-100 text-primary-600" title="退出选择">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
        </button>
        <button
          v-if="failedCount > 0"
          @click="clearFailed"
          class="px-2.5 py-1.5 rounded-lg text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/20 transition-colors flex items-center gap-1"
          :title="`清理 ${failedCount} 条失败记录`"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165" /></svg>
          <span>清理失败 ({{ failedCount }})</span>
        </button>
        <div class="relative">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
          <input
            v-model="search"
            @input="debouncedFetch"
            placeholder="搜索创作..."
            class="pl-9 pr-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500 w-56"
          />
        </div>
      </div>
    </header>
    <div class="page-body">
      <!-- Empty state -->
      <div v-if="!loading && !items.length" class="empty-state">
        <div class="w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
          <svg class="w-8 h-8 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" /></svg>
        </div>
        <p class="text-sm font-medium text-text-secondary mb-1">暂无创作</p>
        <p class="text-xs text-text-tertiary">前往生图工作台开始创作</p>
      </div>

      <!-- Grid -->
      <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        <div
          v-for="item in items"
          :key="item.id"
          @click="selectMode ? toggleSelect(item.id) : openDetail(item)"
          :class="['cursor-pointer rounded-xl overflow-hidden border bg-surface-0 shadow-sm hover:shadow-md transition-shadow group', selectedIds.has(item.id) ? 'border-primary-500 ring-1 ring-primary-500' : 'border-surface-3']"
        >
          <div class="aspect-square bg-surface-2 overflow-hidden relative">
            <div v-if="selectMode" class="absolute top-1.5 left-1.5 z-10">
              <div :class="['w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors', selectedIds.has(item.id) ? 'bg-primary-600 border-primary-600' : 'bg-white/80 border-surface-4']">
                <svg v-if="selectedIds.has(item.id)" class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="m4.5 12.75 6 6 9-13.5" /></svg>
              </div>
            </div>
            <button v-if="!selectMode" @click.stop="deleteSingle(item.id)" class="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 w-6 h-6 rounded-full bg-black/40 hover:bg-red-500 text-white flex items-center justify-center transition-all" title="删除">
              <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
            <img v-if="item.result_path" :src="localFileUrl(item.result_path, true)" loading="lazy" decoding="async" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
            <div v-if="(item as any).ai_mark_removed && !selectMode" class="absolute top-1.5 left-1.5 z-10 pointer-events-none"><ProcessedBadge /></div>
            <div v-else class="w-full h-full flex items-center justify-center">
              <svg class="w-10 h-10 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" /></svg>
            </div>
            <div v-if="item.result_path" class="absolute bottom-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button @click.stop="copyImage(item.result_path)" class="w-7 h-7 rounded-lg bg-black/50 hover:bg-black/70 text-white flex items-center justify-center" title="复制图片">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" /></svg>
              </button>
              <button @click.stop="editImage(item.id)" class="w-7 h-7 rounded-lg bg-black/50 hover:bg-black/70 text-white flex items-center justify-center" title="编辑">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>
              </button>
            </div>
          </div>
          <div class="p-2.5">
            <p class="text-[11px] text-text-secondary line-clamp-2">{{ item.prompt }}</p>
            <div class="flex items-center justify-between mt-1.5">
              <span class="text-[10px] text-text-tertiary">{{ modelStore.formatModelLabel(item.model_provider_id, item.model_id) }} / {{ item.size }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex items-center justify-center gap-1 mt-6">
        <button
          @click="goToPage(1)"
          :disabled="page <= 1"
          class="px-2.5 py-1.5 text-xs border border-surface-3 rounded-lg disabled:opacity-40 hover:bg-surface-2 transition-colors"
          title="首页"
        >«</button>
        <button
          @click="goToPage(page - 1)"
          :disabled="page <= 1"
          class="px-2.5 py-1.5 text-xs border border-surface-3 rounded-lg disabled:opacity-40 hover:bg-surface-2 transition-colors"
          title="上一页"
        >‹</button>
        <span class="px-2 text-xs text-text-secondary">
          第 <input
            type="number"
            :value="page"
            @change="(e) => goToPage(parseInt((e.target as HTMLInputElement).value) || 1)"
            :min="1"
            :max="totalPages"
            class="w-12 px-1 py-0.5 text-center text-xs border border-surface-3 rounded bg-surface-0 outline-none focus:ring-1 focus:ring-primary-500"
          /> / {{ totalPages }} 页
          <span class="text-text-tertiary ml-2">共 {{ total }} 条</span>
        </span>
        <button
          @click="goToPage(page + 1)"
          :disabled="page >= totalPages"
          class="px-2.5 py-1.5 text-xs border border-surface-3 rounded-lg disabled:opacity-40 hover:bg-surface-2 transition-colors"
          title="下一页"
        >›</button>
        <button
          @click="goToPage(totalPages)"
          :disabled="page >= totalPages"
          class="px-2.5 py-1.5 text-xs border border-surface-3 rounded-lg disabled:opacity-40 hover:bg-surface-2 transition-colors"
          title="末页"
        >»</button>
      </div>
    </div>

    <!-- Toast -->
    <div v-if="copyToast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-surface-0 shadow-lg border border-surface-3 text-xs text-text-primary">{{ copyToast }}</div>

    <CreationDetailModal
      v-if="detailItem"
      :item="detailItem"
      :image-src="detailItem.result_path ? localFileUrl(detailItem.result_path) : ''"
      :model-label="modelStore.formatModelLabel(detailItem.model_provider_id, detailItem.model_id)"
      :created-at-label="formatDate(detailItem.created_at)"
      :can-share-original="cloudAuth.permissions.inspiration_uploader && !!detailItem.result_path && !!detailItem.prompt"
      :can-share-revised="cloudAuth.permissions.inspiration_uploader && !!detailItem.result_path && !!detailItem.revised_prompt"
      @close="detailItem = null"
      @preview="previewDetailItem"
      @copy-image="copyDetailImage"
      @edit="editDetailItem"
      @open-folder="openDetailFolder"
      @reuse-prompt="useAsInspiration"
      @reuse-revised-prompt="useRevisedPrompt"
      @delete="deleteFromDetail"
      @share-original="openUploadDialog('original')"
      @share-revised="openUploadDialog('revised')"
      @copy-prompt="copyText(detailItem.prompt)"
      @copy-revised-prompt="copyText(detailItem.revised_prompt)"
      @open-in-chat="detailItem.result_path && openInChat(detailItem.result_path)"
    />

    <!-- Upload to inspiration plaza dialog -->
    <UploadInspirationDialog
      v-model:open="uploadDialogOpen"
      :result-path="uploadPayload.resultPath"
      :prompt-text="uploadPayload.promptText"
      :ref-images-count="uploadPayload.refImagesCount"
      :ref-images="uploadPayload.refImages"
      :generation-size="uploadPayload.generationSize"
      :default-title="uploadPayload.defaultTitle"
      @success="showToast"
      @error="showToast"
    />

    <!-- Lightbox: 详情 modal 上叠加一层可缩放全屏预览 -->
    <ImageLightbox
      :src="lightboxSrc"
      :ref-images="lightboxRefImages"
      :on-copy="lightboxCopy"
      :on-locate="lightboxLocate"
      @close="closeLightbox"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useModelStore } from '@/stores/models'
import { useHandoffStore } from '@/stores/handoff'
import UploadInspirationDialog from '@/components/UploadInspirationDialog.vue'
import ImageLightbox from '@/components/ImageLightbox.vue'
import CreationDetailModal from '@/components/CreationDetailModal.vue'
import ProcessedBadge from '@/components/ProcessedBadge.vue'

const cloudAuth = useCloudAuthStore()
const modelStore = useModelStore()
const handoff = useHandoffStore()

interface ImageGeneration {
  id: string
  session_id: string
  prompt: string
  revised_prompt: string
  ref_images: string[]
  model_provider_id: string
  model_id: string
  size: string
  quality: string
  result_path: string
  result_url: string
  status: string
  error: string
  /** 失败诊断快照（脱敏后 JSON 字符串）。本视图仅展示 status='done' 的记录，此字段始终为空，仅为类型一致性保留 */
  raw_request: string
  /** 去AI标记：该图是否经过去AI标记处理（1=已处理），用于打「已处理」角标 */
  ai_mark_removed?: number
  created_at: string
}

function localFileUrl(path: string, thumb = false): string {
  // 兼容旧绝对路径数据：以盘符或 / 开头视为绝对路径
  const isAbsolute = /^[A-Za-z]:|^\//.test(path)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://img?' + param + '=' + encodeURIComponent(path) + (thumb ? `&thumb=1&v=${thumbnailVersion.value}` : '')
}

const router = useRouter()
const api = () => (window as any).api

const items = ref<ImageGeneration[]>([])
const search = ref('')
const page = ref(1)
const pageSize = 25
const total = ref(0)
const loading = ref(false)
const detailItem = ref<ImageGeneration | null>(null)
const lightboxSrc = ref<string | null>(null)
const lightboxPath = ref<string>('')
const lightboxRefImages = ref<string[]>([])
const failedCount = ref(0)
const thumbnailVersion = ref(0)

async function preloadThumbnailsForGenerations(generations: ImageGeneration[]) {
  const paths = generations
    .filter((gen) => gen.status === 'done' && !!gen.result_path)
    .map((gen) => gen.result_path)
  if (!paths.length) return
  try {
    await api().imageGen.invoke('preloadThumbnails', JSON.parse(JSON.stringify(paths)))
    thumbnailVersion.value++
  } catch (e) {
    console.error('Failed to preload thumbnails:', e)
  }
}

function openLightbox(path: string, refImages?: string[]) {
  lightboxPath.value = path
  lightboxSrc.value = localFileUrl(path)
  lightboxRefImages.value = refImages && refImages.length > 0 ? [...refImages] : []
}
function closeLightbox() {
  lightboxSrc.value = null
  lightboxPath.value = ''
  lightboxRefImages.value = []
}
function lightboxCopy() {
  if (lightboxPath.value) copyImage(lightboxPath.value)
}
function lightboxLocate() {
  if (lightboxPath.value) openFolder(lightboxPath.value)
}

const periodOptions = [
  { label: '周', value: 'week' },
  { label: '月', value: 'month' },
  { label: '年', value: 'year' },
  { label: '全部', value: 'all' }
]
const selectedPeriod = ref('week')
const customStart = ref('')
const customEnd = ref('')

function getDateRange(): { startDate?: string; endDate?: string } {
  if (customStart.value) {
    const start = customStart.value + 'T00:00:00.000Z'
    const end = customEnd.value ? customEnd.value + 'T23:59:59.999Z' : undefined
    return { startDate: start, endDate: end }
  }
  const now = new Date()
  switch (selectedPeriod.value) {
    case 'week': {
      const d = new Date(now)
      d.setDate(d.getDate() - 7)
      return { startDate: d.toISOString() }
    }
    case 'month': {
      const d = new Date(now)
      d.setMonth(d.getMonth() - 1)
      return { startDate: d.toISOString() }
    }
    case 'year': {
      const d = new Date(now)
      d.setFullYear(d.getFullYear() - 1)
      return { startDate: d.toISOString() }
    }
    default:
      return {}
  }
}

function onCustomDateChange() {
  if (customStart.value) {
    page.value = 1
    fetchData()
  }
}

const totalPages = computed(() => Math.ceil(total.value / pageSize))

let debounceTimer: any = null
function debouncedFetch() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    page.value = 1
    fetchData()
  }, 300)
}

async function fetchData() {
  loading.value = true
  try {
    const { startDate, endDate } = getDateRange()
    const result = await api().imageGen.invoke('listAllGenerations', page.value, pageSize, search.value || undefined, startDate, endDate)
    items.value = result.items
    total.value = result.total
    preloadThumbnailsForGenerations(items.value)
  } catch (e) {
    console.error('Failed to fetch creations:', e)
  } finally {
    loading.value = false
  }
}

async function fetchFailedCount() {
  try {
    failedCount.value = (await api().imageGen.invoke('countFailedGenerations')) as number
  } catch (e) {
    console.error('Failed to count failed generations:', e)
  }
}

function goToPage(p: number) {
  const target = Math.max(1, Math.min(totalPages.value, p))
  if (target !== page.value) {
    page.value = target
    fetchData()
  }
}

async function clearFailed() {
  if (failedCount.value <= 0) return
  if (!confirm(`确定清理 ${failedCount.value} 条失败记录？此操作不可恢复。`)) return
  try {
    const res = await api().imageGen.invoke('clearFailedGenerations') as { deleted: number }
    copyToast.value = `已清理 ${res.deleted} 条失败记录`
    setTimeout(() => { copyToast.value = '' }, 2000)
    failedCount.value = 0
  } catch (e: any) {
    copyToast.value = '清理失败：' + (e?.message || '')
    setTimeout(() => { copyToast.value = '' }, 2000)
  }
}

const selectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())

function toggleSelectMode() {
  selectMode.value = !selectMode.value
  if (!selectMode.value) selectedIds.value = new Set()
}

function toggleSelect(id: string) {
  const s = new Set(selectedIds.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selectedIds.value = s
}

function toggleSelectAll() {
  const pageIds = items.value.map(g => g.id)
  const allSelected = pageIds.every(id => selectedIds.value.has(id))
  const next = new Set(selectedIds.value)
  if (allSelected) {
    pageIds.forEach(id => next.delete(id))
  } else {
    pageIds.forEach(id => next.add(id))
  }
  selectedIds.value = next
}

async function deleteSingle(id: string) {
  await api().imageGen.invoke('deleteGeneration', id)
  items.value = items.value.filter(g => g.id !== id)
  total.value = Math.max(0, total.value - 1)
  if (!items.value.length && total.value > 0) {
    page.value = Math.max(1, Math.min(page.value, Math.ceil(total.value / pageSize)))
    await fetchData()
  }
}

async function deleteSelected() {
  if (!selectedIds.value.size) return
  const ids = [...selectedIds.value]
  await api().imageGen.invoke('deleteGenerations', JSON.parse(JSON.stringify(ids)))
  const idSet = new Set(ids)
  items.value = items.value.filter(g => !idSet.has(g.id))
  total.value = Math.max(0, total.value - ids.length)
  selectedIds.value = new Set()
  if (!items.value.length) selectMode.value = false
  if (!items.value.length && total.value > 0) {
    page.value = Math.max(1, Math.min(page.value, Math.ceil(total.value / pageSize)))
    await fetchData()
  }
}

async function deleteFromDetail() {
  if (!detailItem.value) return
  const id = detailItem.value.id
  detailItem.value = null
  await deleteSingle(id)
}

function openDetail(item: ImageGeneration) {
  detailItem.value = item
}

function previewDetailItem() {
  if (!detailItem.value?.result_path) return
  openLightbox(detailItem.value.result_path, detailItem.value.ref_images)
}

function copyDetailImage() {
  if (!detailItem.value?.result_path) return
  copyImage(detailItem.value.result_path)
}

function editDetailItem() {
  if (!detailItem.value) return
  editImage(detailItem.value.id)
}

function openDetailFolder() {
  if (!detailItem.value?.result_path) return
  openFolder(detailItem.value.result_path)
}

const copyToast = ref('')

function showToast(msg: string) {
  copyToast.value = msg
  setTimeout(() => { copyToast.value = '' }, 2000)
}

async function copyImage(path: string) {
  try {
    const res = await window.api.clipboard.writeImage(path)
    if (res.success) {
      copyToast.value = '已复制到剪贴板'
    } else {
      copyToast.value = '复制失败: ' + (res.error || '')
    }
  } catch (e: any) {
    copyToast.value = '复制失败'
  }
  setTimeout(() => { copyToast.value = '' }, 2000)
}

async function copyText(text: string) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    showToast('已复制')
  } catch {
    showToast('复制失败')
  }
}

function editImage(genId: string) {
  router.push(`/image-edit/${genId}`)
}

async function openInChat(resultPath: string) {
  try {
    const abs = (await (window as any).api.imageGen.invoke('getAbsolutePath', resultPath)) as string
    if (!abs) return
    handoff.set('chatBrandAttachments', { paths: [abs] })
    router.push({ name: 'chat', query: { new: '1' } })
  } catch (e) {
    console.warn('[my-creations] openInChat failed:', e)
  }
}

function openFolder(path: string) {
  ;(window as any).api.shell.showItemInFolder(path)
}

function useAsInspiration() {
  if (!detailItem.value) return
  handoff.set('imageGen', {
    prompt: detailItem.value.prompt,
    presetSize: detailItem.value.size || undefined,
    refImages: detailItem.value.ref_images?.length ? detailItem.value.ref_images : undefined
  })
  detailItem.value = null
  router.push('/image-gen')
}

function useRevisedPrompt() {
  if (!detailItem.value || !detailItem.value.revised_prompt) return
  handoff.set('imageGen', {
    prompt: detailItem.value.revised_prompt,
    presetSize: detailItem.value.size || undefined,
    refImages: detailItem.value.ref_images?.length ? detailItem.value.ref_images : undefined
  })
  detailItem.value = null
  router.push('/image-gen')
}

// 分享到灵感广场弹窗：按按下的按钮切换提示词来源。
// 弹窗基于 props 通信，关闭 / 上传成功后状态自动重置。
const uploadDialogOpen = ref(false)
const uploadPayload = ref<{ resultPath: string; promptText: string; refImagesCount: number; refImages: string[]; generationSize: string; defaultTitle: string }>({
  resultPath: '',
  promptText: '',
  refImagesCount: 0,
  refImages: [],
  generationSize: '',
  defaultTitle: ''
})

function openUploadDialog(source: 'original' | 'revised') {
  if (!detailItem.value) return
  const item = detailItem.value
  const text = source === 'revised' ? item.revised_prompt : item.prompt
  if (!text) return
  // 默认标题取提示词前 30 字符，让用户可编辑
  const defaultTitle = text.length > 30 ? text.slice(0, 30) + '...' : text
  uploadPayload.value = {
    resultPath: item.result_path,
    promptText: text,
    refImagesCount: item.ref_images?.length || 0,
    refImages: item.ref_images || [],
    generationSize: item.size || '',
    defaultTitle
  }
  uploadDialogOpen.value = true
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return dateStr
  }
}

onMounted(() => {
  fetchData()
  fetchFailedCount()
})
</script>
