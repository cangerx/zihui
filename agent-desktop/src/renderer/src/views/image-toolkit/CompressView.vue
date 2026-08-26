<template>
  <div class="h-full flex flex-col bg-surface-1">
    <header class="h-12 flex items-center justify-between px-4 bg-surface-0 border-b border-surface-3 flex-shrink-0">
      <div class="flex items-center gap-3">
        <button @click="goBack" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors" title="返回">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
        </button>
        <span class="text-sm font-medium text-text-primary">图片压缩</span>
        <span class="text-[11px] text-text-tertiary">{{ images.length }} 张</span>
      </div>
      <div class="flex items-center gap-1.5">
        <button @click="addMore" class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors">添加图片</button>
        <button @click="estimateAll" :disabled="images.length === 0 || estimating" class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors disabled:opacity-50">{{ estimating ? '预估中...' : '预估大小' }}</button>
        <button @click="prepareSave" :disabled="images.length === 0 || exporting" class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50">{{ exporting ? `保存 ${exportProgress}/${images.length}` : '保存到图库' }}</button>
      </div>
    </header>

    <div class="flex flex-1 overflow-hidden min-h-0">
      <!-- Left: Settings -->
      <div class="w-60 bg-surface-0 border-r border-surface-3 overflow-y-auto p-3 space-y-4 flex-shrink-0">
        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">压缩参数</h4>
          <div class="space-y-3">
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-text-secondary">质量</span>
                <span class="text-[10px] text-text-tertiary">{{ Math.round(quality * 100) }}%</span>
              </div>
              <input type="range" min="0.3" max="1" step="0.05" v-model.number="quality" class="w-full h-1 accent-primary-600" />
            </div>
            <div>
              <label class="flex items-center gap-1.5 cursor-pointer mb-1">
                <input type="checkbox" v-model="resize" class="w-3 h-3 accent-primary-600" />
                <span class="text-[11px] text-text-secondary">同时缩放</span>
              </label>
              <div v-if="resize" class="pl-5 space-y-1">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-[11px] text-text-secondary">最大长边</span>
                  <span class="text-[10px] text-text-tertiary">{{ maxSize }}px</span>
                </div>
                <input type="range" min="400" max="4096" step="100" v-model.number="maxSize" class="w-full h-1 accent-primary-600" />
              </div>
            </div>
            <div>
              <span class="text-[11px] text-text-secondary block mb-1">输出格式</span>
              <div class="flex gap-1.5">
                <button
                  v-for="f in (['keep', 'jpeg', 'webp'] as const)"
                  :key="f"
                  @click="outputFormat = f"
                  :class="['flex-1 px-2 py-1 text-[10px] rounded border transition-colors', outputFormat === f ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/20' : 'border-surface-3 text-text-tertiary hover:bg-surface-2']"
                >{{ f === 'keep' ? '保持' : f.toUpperCase() }}</button>
              </div>
              <p class="text-[10px] text-text-tertiary mt-1">{{ outputFormat === 'keep' ? 'PNG 仍是 PNG，JPG 仍是 JPG' : (outputFormat === 'webp' ? 'WebP 通常体积比 JPG 更小' : '强制 JPG，PNG 透明背景将丢失') }}</p>
            </div>
          </div>
        </div>

        <div v-if="totalOrigSize" class="pt-3 border-t border-surface-3">
          <div class="text-[11px] text-text-secondary mb-1">总大小</div>
          <div class="flex items-baseline gap-2">
            <span class="text-xs text-text-tertiary">{{ formatSize(totalOrigSize) }}</span>
            <span class="text-text-tertiary text-xs">→</span>
            <span class="text-sm font-semibold text-primary-600">{{ totalEstSize ? formatSize(totalEstSize) : '—' }}</span>
          </div>
          <div v-if="totalEstSize" class="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">
            压缩约 {{ Math.round((1 - totalEstSize / totalOrigSize) * 100) }}%
          </div>
        </div>
      </div>

      <!-- Center: thumbnails -->
      <div class="flex-1 overflow-y-auto p-4">
        <div v-if="images.length === 0" class="text-center text-text-tertiary text-xs py-12">
          请先添加图片
        </div>
        <div v-else class="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          <div
            v-for="(img, i) in images"
            :key="img.path"
            class="bg-surface-0 border border-surface-3 rounded-lg overflow-hidden"
          >
            <div class="aspect-square bg-surface-2 relative">
              <img :src="img.dataUri" class="w-full h-full object-contain" />
              <button @click="removeImage(i)" class="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-red-500 transition-colors">
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div class="p-2 text-[11px] space-y-0.5">
              <div class="text-text-primary truncate font-medium" :title="img.name">{{ img.name }}</div>
              <div v-if="origSizes[img.path]" class="flex items-center gap-1 text-text-tertiary">
                <span>{{ formatSize(origSizes[img.path]) }}</span>
                <span v-if="estSizes[img.path]">
                  <span>→</span>
                  <span class="text-primary-600 font-medium ml-1">{{ formatSize(estSizes[img.path]) }}</span>
                </span>
              </div>
              <div class="text-text-tertiary">{{ img.width }} × {{ img.height }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ImageSourcePickerDialog v-model:visible="pickerVisible" :multiple="true" @select="onAddImages" />

    <GallerySaveDialog
      v-model:visible="saveDialogVisible"
      :count="images.length"
      :default-name="`压缩_${new Date().toISOString().slice(0, 10)}`"
      @confirm="onSaveConfirm"
    />

    <div v-if="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-surface-0 shadow-lg border border-surface-3 text-xs text-text-primary">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useHandoffStore } from '@/stores/handoff'
import ImageSourcePickerDialog from '@/components/ImageSourcePickerDialog.vue'
import GallerySaveDialog from '@/components/GallerySaveDialog.vue'
import { loadAsDataUri, buildOutputName, dataUriToBlob, type LoadedImage } from '@/utils/image-source'
import { useGalleryStore } from '@/stores/gallery'

type OutputFormat = 'keep' | 'jpeg' | 'webp'

const router = useRouter()
const handoff = useHandoffStore()

const images = ref<LoadedImage[]>([])
const quality = ref(0.75)
const resize = ref(false)
const maxSize = ref(2048)
const outputFormat = ref<OutputFormat>('keep')

const origSizes = ref<Record<string, number>>({})
const estSizes = ref<Record<string, number>>({})

const exporting = ref(false)
const exportProgress = ref(0)
const estimating = ref(false)
const toast = ref('')
const pickerVisible = ref(false)

const totalOrigSize = computed(() => Object.values(origSizes.value).reduce((a, b) => a + b, 0))
const totalEstSize = computed(() => {
  const vals = Object.values(estSizes.value)
  if (vals.length !== images.value.length) return 0
  return vals.reduce((a, b) => a + b, 0)
})

// 参数变化清空预估，避免显示陈旧数据
watch([quality, resize, maxSize, outputFormat], () => { estSizes.value = {} })

onMounted(async () => {
  const payload = handoff.consume<{ paths: string[] }>('imageToolkit')
  if (!payload?.paths?.length) {
    showToast('未传入图片，请重新选择')
    return
  }
  await loadPaths(payload.paths)
})

async function loadPaths(paths: string[]) {
  const items = await loadAsDataUri(paths, { maxSize: 4096, quality: 1 })
  for (const it of items) {
    images.value.push(it)
    origSizes.value[it.path] = dataUriToBlob(it.dataUri).size
  }
}

function addMore() { pickerVisible.value = true }
async function onAddImages(paths: string[]) {
  if (!paths.length) return
  await loadPaths(paths)
}
function removeImage(idx: number) {
  const img = images.value[idx]
  delete origSizes.value[img.path]
  delete estSizes.value[img.path]
  images.value.splice(idx, 1)
}

/** 压缩单张并返回 dataUri + 选定的扩展名 */
async function compressOne(img: LoadedImage): Promise<{ dataUri: string; ext: string }> {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => {
      let { naturalWidth: w, naturalHeight: h } = el
      if (resize.value && (w > maxSize.value || h > maxSize.value)) {
        const r = Math.min(maxSize.value / w, maxSize.value / h)
        w = Math.round(w * r); h = Math.round(h * r)
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(el, 0, 0, w, h)

      let mime: string
      let ext: string
      if (outputFormat.value === 'webp') { mime = 'image/webp'; ext = 'webp' }
      else if (outputFormat.value === 'jpeg') { mime = 'image/jpeg'; ext = 'jpg' }
      else {
        const isPng = img.ext === 'png'
        mime = isPng ? 'image/png' : 'image/jpeg'
        ext = isPng ? 'png' : 'jpg'
      }
      // PNG 没有质量参数，传也无害
      const dataUri = canvas.toDataURL(mime, quality.value)
      resolve({ dataUri, ext })
    }
    el.onerror = () => reject(new Error('Image load failed'))
    el.src = img.dataUri
  })
}

async function estimateAll() {
  if (images.value.length === 0) return
  estimating.value = true
  try {
    const next: Record<string, number> = {}
    for (const img of images.value) {
      const { dataUri } = await compressOne(img)
      next[img.path] = dataUriToBlob(dataUri).size
    }
    estSizes.value = next
  } finally {
    estimating.value = false
  }
}

// O4: 批量保存到图库
const gallery = useGalleryStore()
const saveDialogVisible = ref(false)

function prepareSave() {
  if (images.value.length === 0) return
  saveDialogVisible.value = true
}

async function onSaveConfirm(payload: { categoryId: string; filename: string }) {
  exporting.value = true
  exportProgress.value = 0
  try {
    for (let i = 0; i < images.value.length; i++) {
      const img = images.value[i]
      const { dataUri, ext } = await compressOne(img)
      const fname = payload.filename
        ? `${payload.filename}-${i + 1}.${ext}`
        : buildOutputName(img.name, '_compressed', ext)
      await gallery.addFromDataUri(payload.categoryId, dataUri, fname)
      exportProgress.value = i + 1
    }
    showToast(`已保存 ${images.value.length} 张到图库`)
  } catch (e: any) {
    showToast('保存失败：' + (e.message || ''))
  } finally {
    exporting.value = false
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function goBack() { router.back() }
function showToast(t: string) {
  toast.value = t
  setTimeout(() => { if (toast.value === t) toast.value = '' }, 2500)
}
</script>
