<template>
  <div class="h-full flex flex-col bg-surface-1">
    <header class="h-12 flex items-center justify-between px-4 bg-surface-0 border-b border-surface-3 flex-shrink-0">
      <div class="flex items-center gap-3">
        <button @click="goBack" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors" title="返回">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
        </button>
        <span class="text-sm font-medium text-text-primary">GIF 制作</span>
        <span class="text-[11px] text-text-tertiary">{{ frames.length }} 帧</span>
      </div>
      <div class="flex items-center gap-1.5">
        <button @click="addMore" class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors">添加图片</button>
        <button
          @click="exportGif"
          :disabled="frames.length < 2 || encoding"
          class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50"
        >{{ encoding ? `编码中 ${encodeProgress}/${frames.length}` : '保存到图库' }}</button>
      </div>
    </header>

    <div class="flex flex-1 overflow-hidden min-h-0">
      <!-- Left: Settings -->
      <div class="w-60 bg-surface-0 border-r border-surface-3 overflow-y-auto p-3 space-y-4 flex-shrink-0">
        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">动画参数</h4>
          <div class="space-y-3">
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-text-secondary">帧间隔</span>
                <span class="text-[10px] text-text-tertiary">{{ delay }}ms / 帧 ({{ Math.round(1000 / delay * 10) / 10 }} fps)</span>
              </div>
              <input type="range" min="40" max="2000" step="20" v-model.number="delay" class="w-full h-1 accent-primary-600" />
              <div class="grid grid-cols-4 gap-1 mt-1.5">
                <button v-for="d in delayPresets" :key="d.ms" @click="delay = d.ms" :class="['px-1 py-1 text-[10px] rounded border transition-colors', delay === d.ms ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/20' : 'border-surface-3 text-text-tertiary hover:bg-surface-2']">{{ d.label }}</button>
              </div>
            </div>
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-text-secondary">输出尺寸（长边）</span>
                <span class="text-[10px] text-text-tertiary">{{ maxSize }}px</span>
              </div>
              <input type="range" min="200" max="1024" step="20" v-model.number="maxSize" class="w-full h-1 accent-primary-600" />
              <p class="text-[10px] text-text-tertiary mt-1">GIF 体积与尺寸²成正比，500px 通常足够</p>
            </div>
            <div>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="loop" class="w-3 h-3 accent-primary-600" />
                <span class="text-[11px] text-text-secondary">循环播放</span>
              </label>
            </div>
            <div>
              <span class="text-[11px] text-text-secondary block mb-1">调色板</span>
              <div class="flex gap-1">
                <button
                  v-for="p in [64, 128, 256]"
                  :key="p"
                  @click="paletteSize = p"
                  :class="['flex-1 px-2 py-1 text-[10px] rounded border transition-colors', paletteSize === p ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/20' : 'border-surface-3 text-text-tertiary hover:bg-surface-2']"
                >{{ p }}</button>
              </div>
              <p class="text-[10px] text-text-tertiary mt-1">越多越清晰但体积越大</p>
            </div>
          </div>
        </div>

        <div class="pt-3 border-t border-surface-3 space-y-1">
          <div class="flex items-center gap-2">
            <button @click="previewing ? stopPreview() : startPreview()" :disabled="frames.length < 2" class="flex-1 px-2 py-1.5 text-[11px] border border-surface-3 rounded-lg hover:bg-surface-2 text-text-secondary disabled:opacity-50">
              {{ previewing ? '暂停预览' : '播放预览' }}
            </button>
            <button @click="reversePlay = !reversePlay" :class="['flex-1 px-2 py-1.5 text-[11px] rounded-lg', reversePlay ? 'bg-primary-50 border border-primary-500 text-primary-700 dark:bg-primary-900/20' : 'border border-surface-3 text-text-tertiary hover:bg-surface-2']">
              反向播放
            </button>
          </div>
        </div>

        <div class="pt-3 border-t border-surface-3">
          <h4 class="text-xs font-medium text-text-secondary mb-2">帧顺序（拖拽排序）</h4>
          <div class="space-y-1.5 max-h-72 overflow-y-auto">
            <div
              v-for="(f, i) in frames"
              :key="f.path + i"
              class="flex items-center gap-2 p-1.5 rounded border border-surface-3 bg-surface-1 group"
              draggable="true"
              @dragstart="dragIndex = i"
              @dragover.prevent
              @drop.prevent="onDropFrame(i)"
            >
              <span class="text-[10px] text-text-tertiary w-4 text-center">{{ i + 1 }}</span>
              <img :src="f.dataUri" class="w-8 h-8 object-cover rounded flex-shrink-0" />
              <span class="text-[10px] text-text-secondary flex-1 truncate" :title="f.name">{{ f.name }}</span>
              <button @click="removeFrame(i)" class="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-red-500 transition-opacity">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Center: Preview -->
      <div class="flex-1 flex flex-col items-center justify-center overflow-auto bg-[#f0f0f0] dark:bg-surface-2 p-6 gap-3">
        <div v-if="frames.length === 0" class="text-center text-text-tertiary text-xs">请先添加图片</div>
        <template v-else>
          <canvas ref="canvasRef" class="max-w-full max-h-[60vh] shadow-md rounded bg-white"></canvas>
          <div class="text-[11px] text-text-tertiary">
            第 {{ currentFrame + 1 }} / {{ frames.length }} 帧
            <span v-if="frames[currentFrame]" class="ml-2 truncate inline-block max-w-xs align-bottom">{{ frames[currentFrame].name }}</span>
          </div>
          <div class="flex items-center gap-2 max-w-md w-full">
            <button @click="currentFrame = Math.max(0, currentFrame - 1)" class="p-1.5 rounded-lg border border-surface-3 text-text-tertiary hover:bg-surface-2">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            </button>
            <input type="range" min="0" :max="frames.length - 1" v-model.number="currentFrame" class="flex-1 h-1 accent-primary-600" />
            <button @click="currentFrame = Math.min(frames.length - 1, currentFrame + 1)" class="p-1.5 rounded-lg border border-surface-3 text-text-tertiary hover:bg-surface-2">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
            </button>
          </div>
        </template>
      </div>
    </div>

    <ImageSourcePickerDialog v-model:visible="pickerVisible" :multiple="true" @select="onAddImages" />

    <GallerySaveDialog
      v-model:visible="saveDialogVisible"
      :preview-data-uri="pendingDataUri"
      :default-name="`GIF_${new Date().toISOString().slice(0, 10)}`"
      @confirm="onSaveConfirm"
    />

    <div v-if="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-surface-0 shadow-lg border border-surface-3 text-xs text-text-primary">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import { useHandoffStore } from '@/stores/handoff'
import ImageSourcePickerDialog from '@/components/ImageSourcePickerDialog.vue'
import GallerySaveDialog from '@/components/GallerySaveDialog.vue'
import { loadAsDataUri, type LoadedImage } from '@/utils/image-source'
import { useGalleryStore } from '@/stores/gallery'

const router = useRouter()
const handoff = useHandoffStore()

const frames = ref<LoadedImage[]>([])
const delay = ref(200)            // 每帧 200ms = 5fps
const maxSize = ref(500)
const loop = ref(true)
// 调色板大小（GIF 限定 ≤ 256；UI 只给三档但用 number 类型方便 v-model.number 绑定）
const paletteSize = ref<number>(128)
const reversePlay = ref(false)

const encoding = ref(false)
const encodeProgress = ref(0)
const toast = ref('')
const pickerVisible = ref(false)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const dragIndex = ref<number | null>(null)
const currentFrame = ref(0)
const previewing = ref(false)
let previewTimer: ReturnType<typeof setInterval> | null = null

const delayPresets = [
  { ms: 100, label: '快' },
  { ms: 200, label: '中' },
  { ms: 500, label: '慢' },
  { ms: 1000, label: '极慢' }
]

/** 实际预览顺序：反向时取反 */
const playOrder = computed<number[]>(() => {
  const n = frames.value.length
  const arr = Array.from({ length: n }, (_, i) => i)
  return reversePlay.value ? arr.reverse() : arr
})

onMounted(async () => {
  const payload = handoff.consume<{ paths: string[] }>('imageToolkit')
  if (!payload?.paths?.length) {
    showToast('未传入图片，请重新选择')
    return
  }
  await loadPaths(payload.paths)
})

onBeforeUnmount(() => stopPreview())

watch([currentFrame, frames], async () => {
  await nextTick()
  redrawCurrent()
}, { deep: true })

async function loadPaths(paths: string[]) {
  const items = await loadAsDataUri(paths, { maxSize: 1600, quality: 0.92 })
  frames.value.push(...items)
  await nextTick()
  redrawCurrent()
}

function addMore() { pickerVisible.value = true }
async function onAddImages(paths: string[]) {
  if (!paths.length) return
  await loadPaths(paths)
}
function removeFrame(idx: number) {
  frames.value.splice(idx, 1)
  if (currentFrame.value >= frames.value.length) currentFrame.value = Math.max(0, frames.value.length - 1)
}

function onDropFrame(targetIdx: number) {
  if (dragIndex.value === null || dragIndex.value === targetIdx) return
  const arr = frames.value.slice()
  const [moved] = arr.splice(dragIndex.value, 1)
  arr.splice(targetIdx, 0, moved)
  frames.value = arr
  dragIndex.value = null
}

function redrawCurrent() {
  if (!canvasRef.value || frames.value.length === 0) return
  const f = frames.value[currentFrame.value]
  if (!f) return
  const el = new Image()
  const draw = () => {
    if (!canvasRef.value) return
    canvasRef.value.width = el.naturalWidth
    canvasRef.value.height = el.naturalHeight
    const ctx = canvasRef.value.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvasRef.value.width, canvasRef.value.height)
    ctx.drawImage(el, 0, 0)
  }
  el.onload = draw
  el.src = f.dataUri
  // 如果是 data URI 且浏览器立即同步出 naturalWidth（冷启不会），onload 不会再触发，手动补一次
  if (el.complete && el.naturalWidth > 0) draw()
}

// ---- Preview ----
function startPreview() {
  if (frames.value.length < 2 || previewTimer) return
  previewing.value = true
  let i = 0
  previewTimer = setInterval(() => {
    const order = playOrder.value
    currentFrame.value = order[i % order.length]
    i++
  }, delay.value)
}

function stopPreview() {
  if (previewTimer) {
    clearInterval(previewTimer)
    previewTimer = null
  }
  previewing.value = false
}

// 参数变化时重启预览以应用新 delay
watch([delay, reversePlay], () => {
  if (previewing.value) {
    stopPreview()
    startPreview()
  }
})

// ---- GIF Export ----
/**
 * 用 gifenc 编码 GIF：每帧渲染到统一尺寸的临时 canvas，量化得到调色板 + 索引，
 * 写入编码器后输出 Uint8Array → blob URL → 下载。
 *
 * 注意点：
 *  - 所有帧必须同尺寸；以第一帧的等比缩放为基准（按 maxSize 长边）
 *  - 透明像素：通过 fillStyle 白底覆盖，避免 GIF 透明色锯齿（GIF 只支持 1-bit alpha）
 *  - quantize/applyPalette 是 CPU 密集；放到 microtask 之间 await 让出主线程，避免 UI 卡死
 */
async function exportGif() {
  if (frames.value.length < 2 || encoding.value) return
  stopPreview()
  encoding.value = true
  encodeProgress.value = 0

  try {
    // 1) 算统一尺寸：以第一帧为基准
    const firstEl = await loadHtmlImage(frames.value[0].dataUri)
    const baseRatio = firstEl.naturalWidth / firstEl.naturalHeight
    let W: number, H: number
    if (baseRatio >= 1) {
      W = Math.min(maxSize.value, firstEl.naturalWidth)
      H = Math.round(W / baseRatio)
    } else {
      H = Math.min(maxSize.value, firstEl.naturalHeight)
      W = Math.round(H * baseRatio)
    }
    // GIF 尺寸最好为偶数（部分播放器更稳定）
    W = W - (W % 2)
    H = H - (H % 2)

    // 2) 准备 encoder
    const gif = GIFEncoder()
    const order = playOrder.value

    // 3) 逐帧编码
    const tmp = document.createElement('canvas')
    tmp.width = W
    tmp.height = H
    const ctx = tmp.getContext('2d', { willReadFrequently: true })!

    for (let i = 0; i < order.length; i++) {
      const f = frames.value[order[i]]
      const el = await loadHtmlImage(f.dataUri)

      // 白底覆盖透明 + 居中 contain 缩放
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)
      const sRatio = el.naturalWidth / el.naturalHeight
      const dRatio = W / H
      let dw = W, dh = H, dx = 0, dy = 0
      if (sRatio > dRatio) {
        dh = W / sRatio
        dy = (H - dh) / 2
      } else {
        dw = H * sRatio
        dx = (W - dw) / 2
      }
      ctx.drawImage(el, dx, dy, dw, dh)

      const imageData = ctx.getImageData(0, 0, W, H)
      const data = imageData.data
      // 量化 + 应用调色板
      const palette = quantize(data, paletteSize.value)
      const index = applyPalette(data, palette)
      // gifenc 未随包发布 .d.ts；writeFrame 选项类型用 any 兑现。
      // repeat 仅第一帧起作用：loop=true 设 0（无限），否则 -1（不循环）；
      // dispose=2（还原背景）避免透明区在后一帧遗留上一帧像素。
      gif.writeFrame(index, W, H, {
        palette,
        delay: delay.value,
        dispose: 2,
        repeat: i === 0 ? (loop.value ? 0 : -1) : undefined
      } as any)

      encodeProgress.value = i + 1
      // 让出主线程，让进度 UI 更新
      await new Promise<void>(r => setTimeout(r, 0))
    }

    gif.finish()
    const bytes = gif.bytes()
    // O4: 不再直接下载，转为 dataUri 打开保存到图库弹窗
    pendingDataUri.value = bytesToDataUri(bytes)
    pendingByteSize.value = bytes.length
    saveDialogVisible.value = true
  } catch (e: any) {
    console.error(e)
    showToast('编码失败：' + (e.message || ''))
  } finally {
    encoding.value = false
  }
}

// O4: 将 Uint8Array 转为 image/gif data URI
function bytesToDataUri(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return 'data:image/gif;base64,' + btoa(bin)
}

const gallery = useGalleryStore()
const saveDialogVisible = ref(false)
const pendingDataUri = ref('')
const pendingByteSize = ref(0)

async function onSaveConfirm(payload: { categoryId: string; filename: string }) {
  if (!pendingDataUri.value) return
  try {
    const name = (payload.filename || `gif_${Date.now()}`) + '.gif'
    await gallery.addFromDataUri(payload.categoryId, pendingDataUri.value, name)
    showToast(`已保存到图库（${(pendingByteSize.value / 1024).toFixed(0)} KB）`)
  } catch (e: any) {
    showToast('保存失败：' + (e.message || ''))
  } finally {
    pendingDataUri.value = ''
    pendingByteSize.value = 0
  }
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Image load failed'))
    el.src = src
  })
}

function goBack() { router.back() }
function showToast(t: string) {
  toast.value = t
  setTimeout(() => { if (toast.value === t) toast.value = '' }, 2500)
}
</script>
