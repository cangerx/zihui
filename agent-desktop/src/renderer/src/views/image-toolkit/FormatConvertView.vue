<template>
  <div class="h-full flex flex-col bg-surface-1">
    <header class="h-12 flex items-center justify-between px-4 bg-surface-0 border-b border-surface-3 flex-shrink-0">
      <div class="flex items-center gap-3">
        <button @click="goBack" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors" title="返回">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
        </button>
        <span class="text-sm font-medium text-text-primary">格式转换</span>
        <span class="text-[11px] text-text-tertiary">{{ images.length }} 张</span>
      </div>
      <div class="flex items-center gap-1.5">
        <button @click="addMore" class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors">添加图片</button>
        <button @click="prepareSave" :disabled="images.length === 0 || exporting" class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50">{{ exporting ? `保存 ${exportProgress}/${images.length}` : '保存到图库' }}</button>
      </div>
    </header>

    <div class="flex flex-1 overflow-hidden min-h-0">
      <!-- Left: Settings -->
      <div class="w-60 bg-surface-0 border-r border-surface-3 overflow-y-auto p-3 space-y-4 flex-shrink-0">
        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">目标格式</h4>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="f in formats"
              :key="f.id"
              @click="format = f.id"
              :class="['px-2 py-2 rounded-lg border text-[11px] font-medium transition-colors', format === f.id ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/20' : 'border-surface-3 text-text-secondary hover:bg-surface-2']"
            >{{ f.label }}</button>
          </div>
          <p class="text-[10px] text-text-tertiary mt-2 leading-relaxed">{{ formatHint }}</p>
        </div>

        <div v-if="format === 'jpeg' || format === 'webp'">
          <h4 class="text-xs font-medium text-text-secondary mb-2">质量</h4>
          <div class="flex items-center justify-between mb-1">
            <span class="text-[11px] text-text-secondary">压缩等级</span>
            <span class="text-[10px] text-text-tertiary">{{ Math.round(quality * 100) }}%</span>
          </div>
          <input type="range" min="0.4" max="1" step="0.05" v-model.number="quality" class="w-full h-1 accent-primary-600" />
          <div class="flex justify-between text-[10px] text-text-tertiary mt-1">
            <span>更小</span>
            <span>更清晰</span>
          </div>
        </div>

        <div v-if="format === 'jpeg'">
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" v-model="fillBg" class="w-3 h-3 accent-primary-600" />
            <span class="text-[11px] text-text-secondary">透明区域填充背景色</span>
          </label>
          <div v-if="fillBg" class="flex items-center gap-2 mt-2">
            <input type="color" v-model="bgColor" class="w-7 h-7 rounded border border-surface-3 cursor-pointer" />
            <span class="text-[10px] text-text-tertiary">JPG 不支持透明，半透明像素将与此色合成</span>
          </div>
        </div>
      </div>

      <!-- Center: Preview thumbnails -->
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
              <div class="text-text-tertiary flex items-center gap-1">
                <span class="uppercase">{{ img.ext }}</span>
                <span>→</span>
                <span class="text-primary-600 font-medium uppercase">{{ format }}</span>
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
      :default-name="`转换_${new Date().toISOString().slice(0, 10)}`"
      @confirm="onSaveConfirm"
    />

    <div v-if="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-surface-0 shadow-lg border border-surface-3 text-xs text-text-primary">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useHandoffStore } from '@/stores/handoff'
import ImageSourcePickerDialog from '@/components/ImageSourcePickerDialog.vue'
import GallerySaveDialog from '@/components/GallerySaveDialog.vue'
import { loadAsDataUri, buildOutputName, type LoadedImage } from '@/utils/image-source'
import { useGalleryStore } from '@/stores/gallery'

type Format = 'png' | 'jpeg' | 'webp'

const router = useRouter()
const handoff = useHandoffStore()

const images = ref<LoadedImage[]>([])
const format = ref<Format>('jpeg')
const quality = ref(0.85)
const fillBg = ref(true)
const bgColor = ref('#ffffff')
const exporting = ref(false)
const exportProgress = ref(0)
const toast = ref('')
const pickerVisible = ref(false)

const formats: Array<{ id: Format; label: string }> = [
  { id: 'jpeg', label: 'JPG' },
  { id: 'png', label: 'PNG' },
  { id: 'webp', label: 'WebP' }
]

const formatHint = computed(() => {
  if (format.value === 'jpeg') return 'JPG 体积小但有损压缩，不支持透明背景'
  if (format.value === 'png') return 'PNG 无损压缩，支持透明，体积较大'
  return 'WebP 体积更小，质量介于 JPG 和 PNG 之间，部分老软件不支持'
})

onMounted(async () => {
  const payload = handoff.consume<{ paths: string[] }>('imageToolkit')
  if (!payload?.paths?.length) {
    showToast('未传入图片，请重新选择')
    return
  }
  await loadPaths(payload.paths)
})

async function loadPaths(paths: string[]) {
  // 格式转换不需要二次压缩，直接读原图
  const items = await loadAsDataUri(paths, { maxSize: 4096, quality: 1 })
  images.value.push(...items)
}

function addMore() { pickerVisible.value = true }
async function onAddImages(paths: string[]) {
  if (!paths.length) return
  await loadPaths(paths)
}
function removeImage(idx: number) { images.value.splice(idx, 1) }

async function convertOne(img: LoadedImage): Promise<{ dataUri: string; ext: string }> {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = el.naturalWidth
      canvas.height = el.naturalHeight
      const ctx = canvas.getContext('2d')!
      // JPG 不支持透明：可选用背景色填充半透明像素
      if (format.value === 'jpeg' && fillBg.value) {
        ctx.fillStyle = bgColor.value
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
      ctx.drawImage(el, 0, 0)

      let dataUri: string
      let ext: string
      if (format.value === 'jpeg') {
        dataUri = canvas.toDataURL('image/jpeg', quality.value)
        ext = 'jpg'
      } else if (format.value === 'webp') {
        dataUri = canvas.toDataURL('image/webp', quality.value)
        ext = 'webp'
      } else {
        dataUri = canvas.toDataURL('image/png')
        ext = 'png'
      }
      resolve({ dataUri, ext })
    }
    el.onerror = () => reject(new Error('Image load failed'))
    el.src = img.dataUri
  })
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
      const { dataUri, ext } = await convertOne(img)
      const fname = payload.filename
        ? `${payload.filename}-${i + 1}.${ext}`
        : buildOutputName(img.name, '', ext)
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

function goBack() { router.back() }
function showToast(t: string) {
  toast.value = t
  setTimeout(() => { if (toast.value === t) toast.value = '' }, 2500)
}
</script>
