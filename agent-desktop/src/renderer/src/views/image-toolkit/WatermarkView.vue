<template>
  <div class="h-full flex flex-col bg-surface-1">
    <header class="h-12 flex items-center justify-between px-4 bg-surface-0 border-b border-surface-3 flex-shrink-0">
      <div class="flex items-center gap-3">
        <button @click="goBack" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors" title="返回">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
        </button>
        <span class="text-sm font-medium text-text-primary">加水印</span>
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
          <h4 class="text-xs font-medium text-text-secondary mb-2">水印内容</h4>
          <input
            v-model="text"
            placeholder="输入水印文字"
            class="w-full px-2 py-1.5 text-xs border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">样式</h4>
          <div class="space-y-2">
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-text-secondary">字号</span>
                <span class="text-[10px] text-text-tertiary">{{ fontSize }}px</span>
              </div>
              <input type="range" min="12" max="120" v-model.number="fontSize" class="w-full h-1 accent-primary-600" />
            </div>
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-text-secondary">透明度</span>
                <span class="text-[10px] text-text-tertiary">{{ opacity }}%</span>
              </div>
              <input type="range" min="10" max="100" v-model.number="opacity" class="w-full h-1 accent-primary-600" />
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-text-secondary">颜色</span>
              <input type="color" v-model="color" class="w-7 h-7 rounded border border-surface-3 cursor-pointer" />
              <button @click="color = '#ffffff'" class="text-[10px] text-text-tertiary hover:text-text-secondary">白</button>
              <button @click="color = '#000000'" class="text-[10px] text-text-tertiary hover:text-text-secondary">黑</button>
            </div>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" v-model="bold" class="w-3 h-3 accent-primary-600" />
              <span class="text-[11px] text-text-secondary">加粗</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" v-model="shadow" class="w-3 h-3 accent-primary-600" />
              <span class="text-[11px] text-text-secondary">投影（暗色背景更清晰）</span>
            </label>
          </div>
        </div>

        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">位置</h4>
          <div class="grid grid-cols-3 gap-1 mb-2">
            <button
              v-for="p in positions"
              :key="p.id"
              @click="position = p.id"
              :class="['aspect-square rounded border text-[10px] transition-colors', position === p.id ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/20' : 'border-surface-3 text-text-tertiary hover:bg-surface-2']"
              :title="p.label"
            >{{ p.symbol }}</button>
          </div>
          <label class="flex items-center gap-1.5 cursor-pointer mb-2">
            <input type="checkbox" v-model="tile" class="w-3 h-3 accent-primary-600" />
            <span class="text-[11px] text-text-secondary">平铺整张图</span>
          </label>
          <div v-if="tile">
            <div class="flex items-center justify-between mb-1">
              <span class="text-[11px] text-text-secondary">旋转</span>
              <span class="text-[10px] text-text-tertiary">{{ rotation }}°</span>
            </div>
            <input type="range" min="-45" max="45" v-model.number="rotation" class="w-full h-1 accent-primary-600" />
            <div class="flex items-center justify-between mb-1 mt-2">
              <span class="text-[11px] text-text-secondary">间距</span>
              <span class="text-[10px] text-text-tertiary">{{ tileGap }}px</span>
            </div>
            <input type="range" min="40" max="400" v-model.number="tileGap" class="w-full h-1 accent-primary-600" />
          </div>
          <div v-else>
            <div class="flex items-center justify-between mb-1">
              <span class="text-[11px] text-text-secondary">边距</span>
              <span class="text-[10px] text-text-tertiary">{{ margin }}px</span>
            </div>
            <input type="range" min="0" max="100" v-model.number="margin" class="w-full h-1 accent-primary-600" />
          </div>
        </div>
      </div>

      <!-- Center: Preview -->
      <div class="flex-1 flex flex-col overflow-hidden bg-[#f0f0f0] dark:bg-surface-2">
        <div class="flex-1 flex items-center justify-center overflow-auto p-6">
          <div v-if="images.length === 0" class="text-center text-text-tertiary text-xs">请先添加图片</div>
          <canvas v-else ref="canvasRef" class="max-w-full max-h-full shadow-md rounded"></canvas>
        </div>
        <div v-if="images.length > 1" class="bg-surface-0 border-t border-surface-3 px-4 py-2 flex items-center gap-2">
          <span class="text-xs text-text-tertiary flex-shrink-0">预览：</span>
          <div class="flex gap-1.5 overflow-x-auto">
            <button
              v-for="(img, i) in images"
              :key="img.path"
              @click="selectedIdx = i"
              :class="['w-12 h-12 rounded border-2 flex-shrink-0 overflow-hidden', selectedIdx === i ? 'border-primary-500' : 'border-surface-3 hover:border-primary-300']"
            >
              <img :src="img.dataUri" class="w-full h-full object-cover" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <ImageSourcePickerDialog v-model:visible="pickerVisible" :multiple="true" @select="onAddImages" />

    <GallerySaveDialog
      v-model:visible="saveDialogVisible"
      :count="images.length"
      :default-name="`水印_${new Date().toISOString().slice(0, 10)}`"
      @confirm="onSaveConfirm"
    />

    <div v-if="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-surface-0 shadow-lg border border-surface-3 text-xs text-text-primary">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useHandoffStore } from '@/stores/handoff'
import ImageSourcePickerDialog from '@/components/ImageSourcePickerDialog.vue'
import GallerySaveDialog from '@/components/GallerySaveDialog.vue'
import { loadAsDataUri, buildOutputName, type LoadedImage } from '@/utils/image-source'
import { useGalleryStore } from '@/stores/gallery'

type PosId = 'tl' | 'tc' | 'tr' | 'cl' | 'cc' | 'cr' | 'bl' | 'bc' | 'br'

const router = useRouter()
const handoff = useHandoffStore()

const images = ref<LoadedImage[]>([])
const selectedIdx = ref(0)
const text = ref('© 我的水印')
const fontSize = ref(36)
const opacity = ref(50)
const color = ref('#ffffff')
const bold = ref(false)
const shadow = ref(true)
const position = ref<PosId>('br')
const margin = ref(20)
const tile = ref(false)
const rotation = ref(-30)
const tileGap = ref(180)
const exporting = ref(false)
const exportProgress = ref(0)
const toast = ref('')
const pickerVisible = ref(false)
const canvasRef = ref<HTMLCanvasElement | null>(null)

const positions: Array<{ id: PosId; label: string; symbol: string }> = [
  { id: 'tl', label: '左上', symbol: '↖' },
  { id: 'tc', label: '上中', symbol: '↑' },
  { id: 'tr', label: '右上', symbol: '↗' },
  { id: 'cl', label: '左中', symbol: '←' },
  { id: 'cc', label: '居中', symbol: '·' },
  { id: 'cr', label: '右中', symbol: '→' },
  { id: 'bl', label: '左下', symbol: '↙' },
  { id: 'bc', label: '下中', symbol: '↓' },
  { id: 'br', label: '右下', symbol: '↘' }
]

const currentImage = computed(() => images.value[selectedIdx.value])

onMounted(async () => {
  const payload = handoff.consume<{ paths: string[] }>('imageToolkit')
  if (!payload?.paths?.length) {
    showToast('未传入图片，请重新选择')
    return
  }
  await loadPaths(payload.paths)
})

watch([text, fontSize, opacity, color, bold, shadow, position, margin, tile, rotation, tileGap, selectedIdx, images], async () => {
  await nextTick()
  redrawPreview()
}, { deep: true })

async function loadPaths(paths: string[]) {
  // 加水印保留较高分辨率，避免加完水印后导出还要二次缩放
  const items = await loadAsDataUri(paths, { maxSize: 2400, quality: 0.92 })
  images.value.push(...items)
  await nextTick()
  redrawPreview()
}

function addMore() { pickerVisible.value = true }
async function onAddImages(paths: string[]) {
  if (!paths.length) return
  await loadPaths(paths)
}

function redrawPreview() {
  if (!canvasRef.value || !currentImage.value) return
  drawWatermark(canvasRef.value, currentImage.value)
}

function drawWatermark(canvas: HTMLCanvasElement, img: LoadedImage) {
  const el = new Image()
  el.onload = () => {
    canvas.width = el.naturalWidth
    canvas.height = el.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(el, 0, 0)
    paintWatermark(ctx, canvas.width, canvas.height)
  }
  el.src = img.dataUri
  // 已加载缓存：onload 不一定再触发，主动调用
  if (el.complete && el.naturalWidth > 0) {
    canvas.width = el.naturalWidth
    canvas.height = el.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(el, 0, 0)
    paintWatermark(ctx, canvas.width, canvas.height)
  }
}

function paintWatermark(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const t = text.value
  if (!t.trim()) return

  ctx.save()
  ctx.globalAlpha = opacity.value / 100
  ctx.fillStyle = color.value
  ctx.font = `${bold.value ? 'bold ' : ''}${fontSize.value}px sans-serif`
  ctx.textBaseline = 'middle'
  if (shadow.value) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)'
    ctx.shadowBlur = 4
    ctx.shadowOffsetX = 1
    ctx.shadowOffsetY = 1
  }

  if (tile.value) {
    // 平铺：旋转 + 网格
    const rad = (rotation.value * Math.PI) / 180
    ctx.translate(W / 2, H / 2)
    ctx.rotate(rad)
    const diag = Math.sqrt(W * W + H * H)
    const m = ctx.measureText(t)
    const tw = m.width
    const step = Math.max(50, tileGap.value)
    for (let y = -diag; y < diag; y += step) {
      for (let x = -diag; x < diag; x += step + tw) {
        ctx.fillText(t, x, y)
      }
    }
  } else {
    // 9 宫格定位
    const th = fontSize.value
    const margin_ = margin.value

    let x = 0, y = 0
    const pos = position.value
    if (pos.startsWith('t')) y = margin_ + th / 2
    else if (pos.startsWith('c')) y = H / 2
    else y = H - margin_ - th / 2
    if (pos.endsWith('l')) { ctx.textAlign = 'left'; x = margin_ }
    else if (pos.endsWith('c')) { ctx.textAlign = 'center'; x = W / 2 }
    else { ctx.textAlign = 'right'; x = W - margin_ }

    ctx.fillText(t, x, y)
  }

  ctx.restore()
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
      const tmp = document.createElement('canvas')
      await new Promise<void>((resolve) => {
        const el = new Image()
        el.onload = () => {
          tmp.width = el.naturalWidth
          tmp.height = el.naturalHeight
          const ctx = tmp.getContext('2d')!
          ctx.drawImage(el, 0, 0)
          paintWatermark(ctx, tmp.width, tmp.height)
          resolve()
        }
        el.onerror = () => resolve()
        el.src = img.dataUri
      })
      const isJpg = img.ext === 'jpg' || img.ext === 'jpeg'
      const out = isJpg ? tmp.toDataURL('image/jpeg', 0.92) : tmp.toDataURL('image/png')
      const ext = isJpg ? 'jpg' : 'png'
      const fname = payload.filename
        ? `${payload.filename}-${i + 1}.${ext}`
        : buildOutputName(img.name, '_watermarked', ext)
      await gallery.addFromDataUri(payload.categoryId, out, fname)
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
