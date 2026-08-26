<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center" @click.self="$emit('close')">
    <div class="w-[1020px] h-[680px] max-w-[96vw] max-h-[92vh] flex flex-col bg-surface-0 border border-surface-3 rounded-2xl shadow-2xl overflow-hidden">
      <!-- 头部 -->
      <div class="h-12 flex-shrink-0 flex items-center gap-3 px-4 border-b border-surface-3">
        <h3 class="text-sm font-semibold text-text-primary flex-1">{{ title }}</h3>
        <span class="text-[11px] text-text-tertiary">{{ multiple ? '可多选' : '单选' }}</span>
        <button class="ewei-chip" @click="$emit('close')">关闭</button>
      </div>

      <!-- 来源 tab -->
      <div class="flex items-center gap-1 px-4 py-2.5 flex-shrink-0 bg-surface-0 border-b border-surface-3">
        <button v-for="t in tabs" :key="t.key" class="px-3 py-1.5 rounded-lg text-xs transition-colors" :class="tab === t.key ? 'bg-primary-50 text-primary-700 font-medium' : 'text-text-secondary hover:bg-surface-2'" @click="tab = t.key">{{ t.label }}</button>
      </div>

      <!-- 主体 -->
      <div class="flex-1 min-h-0 flex flex-col">
        <div v-show="tab === 'generate'" class="flex-1 min-h-0 overflow-hidden">
          <EcomGeneratorPanel
            class="h-full"
            :image-type="imageType"
            :scope-key="scopeKey"
            :pickable="true"
            :picked-paths="pickedPaths"
            @toggle-pick="onPanelPick"
          />
        </div>

        <div v-show="tab === 'gallery'" class="flex-1 min-h-0 overflow-y-auto p-4">
          <div class="flex items-center gap-2 mb-3">
            <select v-model="galleryCategory" class="ewei-input !w-44" @change="loadGallery(1)">
              <option value="">全部分类</option>
              <option v-for="c in galleryCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <input v-model="gallerySearch" class="ewei-input flex-1" placeholder="搜索图片名" @keyup.enter="loadGallery(1)" />
            <button class="ewei-chip" @click="loadGallery(1)">查询</button>
          </div>
          <div v-if="galleryLoading" class="text-center text-text-tertiary text-[11px] py-10">加载中…</div>
          <div v-else-if="!galleryItems.length" class="text-center text-text-tertiary text-[11px] py-10">图库暂无图片</div>
          <div v-else class="grid grid-cols-6 gap-3">
            <div v-for="it in galleryItems" :key="it.id" class="relative aspect-square rounded-lg overflow-hidden border bg-surface-2 cursor-pointer" :class="isPicked(it.file_path) ? 'border-primary-500 ring-2 ring-primary-400' : 'border-surface-3'" @click="toggle(it.file_path, thumbUrl(it.file_path))">
              <img :src="thumbUrl(it.file_path)" class="w-full h-full object-cover" loading="lazy" decoding="async" alt="" />
              <span v-if="isPicked(it.file_path)" class="absolute top-1 left-1 text-[10px] bg-primary-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow">{{ idx(it.file_path) + 1 }}</span>
            </div>
          </div>
          <!-- 图库分页：每页 36 张，否则只能看到第一页、第 37 张起永远选不到 -->
          <div v-if="galleryTotal > galleryPageSize" class="flex items-center justify-center gap-2 mt-4 text-[11px] text-text-tertiary">
            <button class="ewei-chip" :disabled="galleryPage <= 1 || galleryLoading" @click="loadGallery(galleryPage - 1)">上一页</button>
            <span>{{ galleryPage }} / {{ galleryTotalPages }}（共 {{ galleryTotal }}）</span>
            <button class="ewei-chip" :disabled="galleryPage >= galleryTotalPages || galleryLoading" @click="loadGallery(galleryPage + 1)">下一页</button>
          </div>
        </div>

        <div v-show="tab === 'file'" class="flex-1 min-h-0 overflow-y-auto p-4">
          <button class="ewei-chip mb-3" @click="pickFiles">选择本地图片</button>
          <div v-if="!fileItems.length" class="text-center text-text-tertiary text-[11px] py-10">从电脑选择图片文件</div>
          <div v-else class="grid grid-cols-6 gap-3">
            <div v-for="p in fileItems" :key="p" class="relative aspect-square rounded-lg overflow-hidden border bg-surface-2 cursor-pointer" :class="isPicked(p) ? 'border-primary-500 ring-2 ring-primary-400' : 'border-surface-3'" @click="toggle(p, thumbUrl(p))">
              <img :src="thumbUrl(p)" class="w-full h-full object-cover" loading="lazy" decoding="async" alt="" />
              <span v-if="isPicked(p)" class="absolute top-1 left-1 text-[10px] bg-primary-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow">{{ idx(p) + 1 }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部 -->
      <div class="flex-shrink-0 border-t border-surface-3 px-4 py-3 flex items-center gap-3">
        <div v-if="picked.length" class="flex gap-1.5 overflow-x-auto flex-1">
          <div v-for="p in picked" :key="p.localPath" class="relative w-10 h-10 rounded overflow-hidden border border-surface-3 flex-shrink-0">
            <img :src="p.previewUrl" class="w-full h-full object-cover" alt="" />
            <button class="absolute top-0 right-0 w-[14px] h-[14px] bg-black/55 text-white text-[9px] leading-[14px] text-center" @click="toggle(p.localPath, p.previewUrl)">×</button>
          </div>
        </div>
        <span v-else class="flex-1 text-[11px] text-text-tertiary">点选图片加入</span>
        <button class="ewei-chip" @click="$emit('close')">取消</button>
        <button class="btn-primary !py-1.5 !px-5 text-xs disabled:opacity-50" :disabled="!picked.length" @click="confirm">确定（{{ picked.length }}）</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import EcomGeneratorPanel from '@/views/ecom/EcomGeneratorPanel.vue'

const props = withDefaults(
  defineProps<{
    multiple?: boolean
    imageType?: 'main' | 'detail'
    title?: string
    scopeKey?: string
  }>(),
  { multiple: false, imageType: 'main', title: '选择图片', scopeKey: 'ewei:picker' },
)
const emit = defineEmits<{ (e: 'confirm', picks: { localPath: string; previewUrl: string }[]): void; (e: 'close'): void }>()

const tabs = [
  { key: 'generate', label: 'AI 生成' },
  { key: 'gallery', label: '本地图库' },
  { key: 'file', label: '本地文件' },
] as const
const tab = ref<'generate' | 'gallery' | 'file'>('generate')

function thumbUrl(p: string): string {
  if (!p) return ''
  return 'local-file://img?p=' + encodeURIComponent(p.replace(/\\/g, '/')) + '&thumb=1'
}

const picked = ref<{ localPath: string; previewUrl: string }[]>([])
const pickedPaths = ref<string[]>([])
function syncPaths(): void {
  pickedPaths.value = picked.value.map((p) => p.localPath)
}
function isPicked(p: string): boolean {
  return picked.value.some((x) => x.localPath === p)
}
function idx(p: string): number {
  return picked.value.findIndex((x) => x.localPath === p)
}
function toggle(localPath: string, previewUrl: string): void {
  if (!localPath) return
  const i = idx(localPath)
  if (i >= 0) {
    picked.value.splice(i, 1)
  } else {
    if (!props.multiple) picked.value = []
    picked.value.push({ localPath, previewUrl })
  }
  syncPaths()
}
function onPanelPick(payload: { path: string; url: string }): void {
  toggle(payload.path, payload.url)
}
function confirm(): void {
  if (!picked.value.length) return
  emit('confirm', picked.value.slice())
}

// 图库
const galleryCategories = ref<any[]>([])
const galleryItems = ref<any[]>([])
const galleryCategory = ref('')
const gallerySearch = ref('')
const galleryLoading = ref(false)
const galleryPage = ref(1)
const galleryTotal = ref(0)
const galleryPageSize = 36
const galleryTotalPages = computed(() => Math.max(1, Math.ceil(galleryTotal.value / galleryPageSize)))
async function loadGalleryCategories(): Promise<void> {
  try {
    galleryCategories.value = (await (window as any).api.gallery.invoke('listCategories')) || []
  } catch {
    galleryCategories.value = []
  }
}
async function loadGallery(page = 1): Promise<void> {
  galleryLoading.value = true
  try {
    const r = await (window as any).api.gallery.invoke('listItemsPaged', galleryCategory.value || null, gallerySearch.value.trim(), page, galleryPageSize)
    galleryItems.value = r?.items || []
    galleryTotal.value = r?.total || 0
    galleryPage.value = page
    const paths = galleryItems.value.map((it: any) => it.file_path).filter(Boolean)
    if (paths.length) (window as any).api.imageGen.invoke('preloadThumbnails', paths).catch(() => {})
  } catch {
    galleryItems.value = []
    galleryTotal.value = 0
  } finally {
    galleryLoading.value = false
  }
}

// 本地文件
const fileItems = ref<string[]>([])
async function pickFiles(): Promise<void> {
  const res = await (window as any).api.dialog.openFile({
    title: '选择图片',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
  })
  if (res && !res.canceled && Array.isArray(res.filePaths)) {
    fileItems.value = [...new Set([...fileItems.value, ...res.filePaths])]
  }
}

onMounted(() => {
  loadGalleryCategories()
  loadGallery(1)
})
</script>

<style scoped>
.ewei-input {
  @apply px-3 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500;
}
.ewei-chip {
  @apply px-2.5 py-1 rounded-md text-[11px] border border-surface-3 text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed;
}
</style>
