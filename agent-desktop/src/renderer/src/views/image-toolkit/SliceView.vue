<template>
  <div class="h-full flex flex-col bg-surface-1">
    <header class="h-12 flex items-center justify-between px-4 bg-surface-0 border-b border-surface-3 flex-shrink-0">
      <div class="flex items-center gap-3">
        <button @click="goBack" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors" title="返回">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
        </button>
        <span class="text-sm font-medium text-text-primary">切图</span>
        <span v-if="image" class="text-[11px] text-text-tertiary">{{ image.width }} × {{ image.height }}</span>
      </div>
      <div class="flex items-center gap-1.5">
        <button @click="changeImage" class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors">更换图片</button>
        <button @click="goGallery" class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors">前往图库</button>
        <button @click="prepareSave" :disabled="!image || exporting" class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50">{{ exporting ? `保存 ${exportProgress}/${totalSlices}` : `保存 ${totalSlices} 张到图库` }}</button>
      </div>
    </header>

    <div class="flex flex-1 overflow-hidden min-h-0">
      <!-- Left: Settings -->
      <div class="w-60 bg-surface-0 border-r border-surface-3 overflow-y-auto p-3 space-y-4 flex-shrink-0">
        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">切片模式</h4>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="m in modes"
              :key="m.id"
              @click="setMode(m.id)"
              :class="['px-2 py-2 rounded-lg border text-[11px] font-medium transition-colors', mode === m.id ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/20' : 'border-surface-3 text-text-secondary hover:bg-surface-2']"
            >{{ m.label }}</button>
          </div>
        </div>

        <div v-if="mode === 'grid'">
          <h4 class="text-xs font-medium text-text-secondary mb-2">网格</h4>
          <div class="space-y-2">
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-text-secondary">列（横向 N 等分）</span>
                <span class="text-[10px] text-text-tertiary">{{ cols }}</span>
              </div>
              <input type="range" min="1" max="10" v-model.number="cols" class="w-full h-1 accent-primary-600" />
            </div>
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-text-secondary">行（纵向 N 等分）</span>
                <span class="text-[10px] text-text-tertiary">{{ rows }}</span>
              </div>
              <input type="range" min="1" max="10" v-model.number="rows" class="w-full h-1 accent-primary-600" />
            </div>
            <div class="grid grid-cols-3 gap-1.5 pt-2">
              <button v-for="p in gridPresets" :key="p.label" @click="applyPreset(p.cols, p.rows)" class="px-1.5 py-1 text-[10px] border border-surface-3 rounded hover:bg-surface-2 text-text-tertiary">{{ p.label }}</button>
            </div>
          </div>
        </div>

        <div v-else-if="mode === 'free'">
          <h4 class="text-xs font-medium text-text-secondary mb-2">自由网格</h4>
          <div class="space-y-2">
            <div class="grid grid-cols-2 gap-1.5">
              <button @click="addCut('vertical')" class="px-2 py-1.5 text-[10px] border border-surface-3 rounded hover:bg-surface-2 text-text-secondary">添加竖线</button>
              <button @click="addCut('horizontal')" class="px-2 py-1.5 text-[10px] border border-surface-3 rounded hover:bg-surface-2 text-text-secondary">添加横线</button>
              <button @click="resetFreeCutsFromGrid" class="px-2 py-1.5 text-[10px] border border-surface-3 rounded hover:bg-surface-2 text-text-secondary">按网格均分</button>
              <button @click="clearFreeCuts" class="px-2 py-1.5 text-[10px] border border-surface-3 rounded hover:bg-surface-2 text-text-secondary">清空切线</button>
            </div>
            <div class="text-[10px] text-text-tertiary leading-5">
              当前 {{ freeVerticalCutItems.length }} 条竖线、{{ freeHorizontalCutItems.length }} 条横线。拖动预览线调整位置，右键线删除。
            </div>
          </div>
        </div>

        <div v-else-if="mode === 'horizontal'">
          <h4 class="text-xs font-medium text-text-secondary mb-2">横向切（顶向下 N 等分）</h4>
          <div class="flex items-center justify-between mb-1">
            <span class="text-[11px] text-text-secondary">份数</span>
            <span class="text-[10px] text-text-tertiary">{{ rows }}</span>
          </div>
          <input type="range" min="2" max="20" v-model.number="rows" class="w-full h-1 accent-primary-600" />
        </div>

        <div v-else-if="mode === 'vertical'">
          <h4 class="text-xs font-medium text-text-secondary mb-2">纵向切（左向右 N 等分）</h4>
          <div class="flex items-center justify-between mb-1">
            <span class="text-[11px] text-text-secondary">份数</span>
            <span class="text-[10px] text-text-tertiary">{{ cols }}</span>
          </div>
          <input type="range" min="2" max="20" v-model.number="cols" class="w-full h-1 accent-primary-600" />
        </div>

        <div v-else-if="mode === 'fixed'">
          <h4 class="text-xs font-medium text-text-secondary mb-2">按尺寸切（每片相同尺寸）</h4>
          <div class="space-y-2">
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-text-secondary">宽度</span>
                <span class="text-[10px] text-text-tertiary">{{ tileW }}px</span>
              </div>
              <input type="range" min="100" :max="effectiveRect?.w || image?.width || 2000" step="10" v-model.number="tileW" class="w-full h-1 accent-primary-600" />
            </div>
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-text-secondary">高度</span>
                <span class="text-[10px] text-text-tertiary">{{ tileH }}px</span>
              </div>
              <input type="range" min="100" :max="effectiveRect?.h || image?.height || 2000" step="10" v-model.number="tileH" class="w-full h-1 accent-primary-600" />
            </div>
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-2">
            <h4 class="text-xs font-medium text-text-secondary">裁边</h4>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" v-model="trimEnabled" class="accent-primary-600" />
              <span class="text-[11px] text-text-secondary">{{ trimEnabled ? '已开启' : '关闭' }}</span>
            </label>
          </div>
          <div v-if="trimEnabled" class="space-y-2">
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-text-secondary">上</span>
                <span class="text-[10px] text-text-tertiary">{{ trimTop }}px</span>
              </div>
              <input type="range" min="0" :max="trimMaxY" step="1" v-model.number="trimTop" class="w-full h-1 accent-primary-600" />
            </div>
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-text-secondary">右</span>
                <span class="text-[10px] text-text-tertiary">{{ trimRight }}px</span>
              </div>
              <input type="range" min="0" :max="trimMaxX" step="1" v-model.number="trimRight" class="w-full h-1 accent-primary-600" />
            </div>
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-text-secondary">下</span>
                <span class="text-[10px] text-text-tertiary">{{ trimBottom }}px</span>
              </div>
              <input type="range" min="0" :max="trimMaxY" step="1" v-model.number="trimBottom" class="w-full h-1 accent-primary-600" />
            </div>
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-text-secondary">左</span>
                <span class="text-[10px] text-text-tertiary">{{ trimLeft }}px</span>
              </div>
              <input type="range" min="0" :max="trimMaxX" step="1" v-model.number="trimLeft" class="w-full h-1 accent-primary-600" />
            </div>
            <div class="pt-1 flex justify-end">
              <button @click="resetTrim" class="px-2 py-0.5 text-[10px] text-text-tertiary border border-surface-3 rounded hover:bg-surface-2">重置</button>
            </div>
          </div>
        </div>

        <div class="pt-3 border-t border-surface-3 text-[11px] text-text-secondary">
          共生成 <span class="text-primary-600 font-semibold">{{ totalSlices }}</span> 张
          <span v-if="slices[0]" class="block text-[10px] text-text-tertiary mt-0.5">每张约 {{ slices[0].w }} × {{ slices[0].h }}</span>
        </div>
      </div>

      <!-- Center: Preview -->
      <div class="flex-1 flex items-center justify-center overflow-auto bg-[#f0f0f0] dark:bg-surface-2 p-6">
        <div v-if="!image" class="text-center text-text-tertiary text-xs">请先添加图片</div>
        <div v-else class="relative inline-block">
          <img :src="image.dataUri" class="block max-w-full max-h-[calc(100vh-12rem)]" ref="imgEl" @load="onImageLoad" />
          <!-- 覆盖网格 -->
          <svg
            v-if="imgRendered.w"
            :width="imgRendered.w"
            :height="imgRendered.h"
            :class="['absolute top-0 left-0', mode === 'free' ? 'pointer-events-auto' : 'pointer-events-none']"
          >
            <rect
              v-for="(s, i) in slices"
              :key="i"
              :x="(s.x / image.width) * imgRendered.w"
              :y="(s.y / image.height) * imgRendered.h"
              :width="(s.w / image.width) * imgRendered.w"
              :height="(s.h / image.height) * imgRendered.h"
              fill="none"
              stroke="rgb(99 102 241)"
              stroke-width="2"
              stroke-dasharray="4 3"
            />
            <g v-if="trimEnabled" fill="rgba(0,0,0,0.45)">
              <rect x="0" y="0" :width="imgRendered.w" :height="(trimTop / image.height) * imgRendered.h" />
              <rect x="0" :y="((image.height - trimBottom) / image.height) * imgRendered.h" :width="imgRendered.w" :height="(trimBottom / image.height) * imgRendered.h" />
              <rect x="0" :y="(trimTop / image.height) * imgRendered.h" :width="(trimLeft / image.width) * imgRendered.w" :height="((image.height - trimTop - trimBottom) / image.height) * imgRendered.h" />
              <rect :x="((image.width - trimRight) / image.width) * imgRendered.w" :y="(trimTop / image.height) * imgRendered.h" :width="(trimRight / image.width) * imgRendered.w" :height="((image.height - trimTop - trimBottom) / image.height) * imgRendered.h" />
            </g>
            <g v-if="mode === 'free'">
              <g v-for="cut in freeVerticalCutItems" :key="`v-${cut.index}`">
                <line
                  :x1="cut.svgValue"
                  :x2="cut.svgValue"
                  :y1="cut.svgStart"
                  :y2="cut.svgEnd"
                  stroke="rgba(99,102,241,0.01)"
                  stroke-width="14"
                  class="cursor-ew-resize"
                  @mousedown.prevent="startCutDrag('vertical', cut.index, $event)"
                  @contextmenu.prevent="removeCut('vertical', cut.index)"
                />
                <line
                  :x1="cut.svgValue"
                  :x2="cut.svgValue"
                  :y1="cut.svgStart"
                  :y2="cut.svgEnd"
                  stroke="rgb(79 70 229)"
                  stroke-width="2"
                  pointer-events="none"
                />
              </g>
              <g v-for="cut in freeHorizontalCutItems" :key="`h-${cut.index}`">
                <line
                  :x1="cut.svgStart"
                  :x2="cut.svgEnd"
                  :y1="cut.svgValue"
                  :y2="cut.svgValue"
                  stroke="rgba(99,102,241,0.01)"
                  stroke-width="14"
                  class="cursor-ns-resize"
                  @mousedown.prevent="startCutDrag('horizontal', cut.index, $event)"
                  @contextmenu.prevent="removeCut('horizontal', cut.index)"
                />
                <line
                  :x1="cut.svgStart"
                  :x2="cut.svgEnd"
                  :y1="cut.svgValue"
                  :y2="cut.svgValue"
                  stroke="rgb(79 70 229)"
                  stroke-width="2"
                  pointer-events="none"
                />
              </g>
            </g>
          </svg>
        </div>
      </div>
    </div>

    <ImageSourcePickerDialog v-model:visible="pickerVisible" @select="onChangeImage" />

    <GallerySaveDialog
      v-model:visible="saveDialogVisible"
      :count="totalSlices"
      :default-name="image ? `切图_${image.name.replace(/\.[^.]+$/, '')}` : ''"
      @confirm="onSaveConfirm"
    />

    <div v-if="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-surface-0 shadow-lg border border-surface-3 text-xs text-text-primary">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useHandoffStore } from '@/stores/handoff'
import ImageSourcePickerDialog from '@/components/ImageSourcePickerDialog.vue'
import GallerySaveDialog from '@/components/GallerySaveDialog.vue'
import { loadAsDataUri, buildOutputName, type LoadedImage } from '@/utils/image-source'
import { useGalleryStore } from '@/stores/gallery'

type Mode = 'grid' | 'free' | 'horizontal' | 'vertical' | 'fixed'
type CutOrientation = 'vertical' | 'horizontal'
interface Slice { x: number; y: number; w: number; h: number; idx: number; row: number; col: number }
interface FreeCutItem { index: number; value: number; svgValue: number; svgStart: number; svgEnd: number }

const router = useRouter()
const handoff = useHandoffStore()

const image = ref<LoadedImage | null>(null)
const mode = ref<Mode>('grid')
const cols = ref(3)
const rows = ref(3)
const tileW = ref(500)
const tileH = ref(500)
const exporting = ref(false)
const exportProgress = ref(0)
const toast = ref('')
const pickerVisible = ref(false)
const imgEl = ref<HTMLImageElement | null>(null)
const imgRendered = ref({ w: 0, h: 0 })

const trimEnabled = ref(false)
const trimTop = ref(0)
const trimRight = ref(0)
const trimBottom = ref(0)
const trimLeft = ref(0)
const freeVerticalCuts = ref<number[]>([])
const freeHorizontalCuts = ref<number[]>([])
const freeInitialized = ref(false)
const activeCut = ref<{ orientation: CutOrientation; index: number } | null>(null)

const MIN_FREE_SLICE_SIZE = 20

const trimMaxX = computed(() => Math.max(0, Math.floor((image.value?.width || 0) * 0.45)))
const trimMaxY = computed(() => Math.max(0, Math.floor((image.value?.height || 0) * 0.45)))

const effectiveRect = computed(() => {
  if (!image.value) return null
  const W = image.value.width, H = image.value.height
  if (!trimEnabled.value) return { x: 0, y: 0, w: W, h: H }
  const t = Math.max(0, Math.min(trimTop.value, trimMaxY.value))
  const b = Math.max(0, Math.min(trimBottom.value, trimMaxY.value))
  const l = Math.max(0, Math.min(trimLeft.value, trimMaxX.value))
  const r = Math.max(0, Math.min(trimRight.value, trimMaxX.value))
  const w = Math.max(1, W - l - r)
  const h = Math.max(1, H - t - b)
  return { x: l, y: t, w, h }
})

function resetTrim() {
  trimTop.value = 0
  trimRight.value = 0
  trimBottom.value = 0
  trimLeft.value = 0
}

const modes: Array<{ id: Mode; label: string }> = [
  { id: 'grid', label: '网格' },
  { id: 'free', label: '自由' },
  { id: 'horizontal', label: '横切' },
  { id: 'vertical', label: '纵切' },
  { id: 'fixed', label: '定尺寸' }
]

const gridPresets = [
  { label: '2×2', cols: 2, rows: 2 },
  { label: '3×3', cols: 3, rows: 3 },
  { label: '4×4', cols: 4, rows: 4 },
  { label: '2×3', cols: 2, rows: 3 },
  { label: '3×2', cols: 3, rows: 2 },
  { label: '1×9', cols: 1, rows: 9 }
]

const freeVerticalCutItems = computed<FreeCutItem[]>(() => {
  const rect = effectiveRect.value
  if (!rect || !image.value || !imgRendered.value.w) return []
  return normalizedFreeCuts('vertical').map((value, index) => ({
    index,
    value,
    svgValue: (value / image.value!.width) * imgRendered.value.w,
    svgStart: (rect.y / image.value!.height) * imgRendered.value.h,
    svgEnd: ((rect.y + rect.h) / image.value!.height) * imgRendered.value.h
  }))
})

const freeHorizontalCutItems = computed<FreeCutItem[]>(() => {
  const rect = effectiveRect.value
  if (!rect || !image.value || !imgRendered.value.h) return []
  return normalizedFreeCuts('horizontal').map((value, index) => ({
    index,
    value,
    svgValue: (value / image.value!.height) * imgRendered.value.h,
    svgStart: (rect.x / image.value!.width) * imgRendered.value.w,
    svgEnd: ((rect.x + rect.w) / image.value!.width) * imgRendered.value.w
  }))
})

const slices = computed<Slice[]>(() => {
  const rect = effectiveRect.value
  if (!rect) return []
  const { x: ox, y: oy, w: W, h: H } = rect
  const out: Slice[] = []
  let idx = 0

  if (mode.value === 'grid') {
    const cw = Math.floor(W / cols.value)
    const ch = Math.floor(H / rows.value)
    for (let r = 0; r < rows.value; r++) {
      for (let c = 0; c < cols.value; c++) {
        // 最后一行/列吃掉剩余像素，避免整除误差
        const w = c === cols.value - 1 ? W - c * cw : cw
        const h = r === rows.value - 1 ? H - r * ch : ch
        out.push({ x: ox + c * cw, y: oy + r * ch, w, h, idx: idx++, row: r, col: c })
      }
    }
  } else if (mode.value === 'free') {
    const xs = [ox, ...normalizedFreeCuts('vertical'), ox + W]
    const ys = [oy, ...normalizedFreeCuts('horizontal'), oy + H]
    for (let r = 0; r < ys.length - 1; r++) {
      for (let c = 0; c < xs.length - 1; c++) {
        const x = xs[c]
        const y = ys[r]
        out.push({ x, y, w: xs[c + 1] - x, h: ys[r + 1] - y, idx: idx++, row: r, col: c })
      }
    }
  } else if (mode.value === 'horizontal') {
    const ch = Math.floor(H / rows.value)
    for (let r = 0; r < rows.value; r++) {
      const h = r === rows.value - 1 ? H - r * ch : ch
      out.push({ x: ox, y: oy + r * ch, w: W, h, idx: idx++, row: r, col: 0 })
    }
  } else if (mode.value === 'vertical') {
    const cw = Math.floor(W / cols.value)
    for (let c = 0; c < cols.value; c++) {
      const w = c === cols.value - 1 ? W - c * cw : cw
      out.push({ x: ox + c * cw, y: oy, w, h: H, idx: idx++, row: 0, col: c })
    }
  } else if (mode.value === 'fixed') {
    let r = 0
    for (let y = 0; y < H; y += tileH.value) {
      let c = 0
      for (let x = 0; x < W; x += tileW.value) {
        const w = Math.min(tileW.value, W - x)
        const h = Math.min(tileH.value, H - y)
        out.push({ x: ox + x, y: oy + y, w, h, idx: idx++, row: r, col: c })
        c++
      }
      r++
    }
  }

  return out
})

const totalSlices = computed(() => slices.value.length)

onMounted(async () => {
  const payload = handoff.consume<{ paths: string[] }>('imageToolkit')
  if (!payload?.paths?.length) {
    showToast('未传入图片，请重新选择')
    return
  }
  await loadPath(payload.paths[0])
})

onBeforeUnmount(() => {
  stopCutDrag()
})

async function loadPath(path: string) {
  // 切图保留原始尺寸（不能压缩，否则切出来会糊）
  const items = await loadAsDataUri([path], { maxSize: 6000, quality: 1 })
  if (items[0]) {
    image.value = items[0]
    // tile 默认值跟随图片尺寸
    tileW.value = Math.min(500, Math.floor(items[0].width / 3))
    tileH.value = Math.min(500, Math.floor(items[0].height / 3))
    trimEnabled.value = false
    resetTrim()
    clearFreeCuts()
    freeInitialized.value = false
    if (mode.value === 'free') resetFreeCutsFromGrid()
  }
}

function applyPreset(c: number, r: number) {
  cols.value = c
  rows.value = r
}

function setMode(next: Mode) {
  mode.value = next
  if (next === 'free' && !freeInitialized.value) resetFreeCutsFromGrid()
}

function getFreeCuts(orientation: CutOrientation): number[] {
  return orientation === 'vertical' ? freeVerticalCuts.value : freeHorizontalCuts.value
}

function setFreeCuts(orientation: CutOrientation, cuts: number[]) {
  if (orientation === 'vertical') freeVerticalCuts.value = cuts
  else freeHorizontalCuts.value = cuts
}

function normalizedFreeCuts(orientation: CutOrientation): number[] {
  const rect = effectiveRect.value
  if (!rect) return []
  const start = orientation === 'vertical' ? rect.x : rect.y
  const end = orientation === 'vertical' ? rect.x + rect.w : rect.y + rect.h
  const min = start + MIN_FREE_SLICE_SIZE
  const max = end - MIN_FREE_SLICE_SIZE
  if (max <= min) return []
  const out: number[] = []
  for (const raw of getFreeCuts(orientation)) {
    const value = Math.round(Math.max(min, Math.min(max, raw)))
    if (out.every((item) => Math.abs(item - value) >= MIN_FREE_SLICE_SIZE)) out.push(value)
  }
  return out.sort((a, b) => a - b)
}

function resetFreeCutsFromGrid() {
  const rect = effectiveRect.value
  if (!rect) return
  const vertical: number[] = []
  const horizontal: number[] = []
  for (let i = 1; i < cols.value; i++) vertical.push(Math.round(rect.x + (rect.w * i) / cols.value))
  for (let i = 1; i < rows.value; i++) horizontal.push(Math.round(rect.y + (rect.h * i) / rows.value))
  freeVerticalCuts.value = vertical
  freeHorizontalCuts.value = horizontal
  freeInitialized.value = true
}

function clearFreeCuts() {
  freeVerticalCuts.value = []
  freeHorizontalCuts.value = []
  freeInitialized.value = true
}

function addCut(orientation: CutOrientation) {
  const rect = effectiveRect.value
  if (!rect) return
  const cuts = normalizedFreeCuts(orientation)
  const start = orientation === 'vertical' ? rect.x : rect.y
  const end = orientation === 'vertical' ? rect.x + rect.w : rect.y + rect.h
  const edges = [start, ...cuts, end]
  let bestStart = start
  let bestEnd = end
  for (let i = 0; i < edges.length - 1; i++) {
    if (edges[i + 1] - edges[i] > bestEnd - bestStart) {
      bestStart = edges[i]
      bestEnd = edges[i + 1]
    }
  }
  if (bestEnd - bestStart < MIN_FREE_SLICE_SIZE * 2) return
  setFreeCuts(orientation, [...cuts, Math.round((bestStart + bestEnd) / 2)].sort((a, b) => a - b))
  freeInitialized.value = true
}

function removeCut(orientation: CutOrientation, index: number) {
  const cuts = normalizedFreeCuts(orientation)
  cuts.splice(index, 1)
  setFreeCuts(orientation, cuts)
  freeInitialized.value = true
}

function startCutDrag(orientation: CutOrientation, index: number, event: MouseEvent) {
  activeCut.value = { orientation, index }
  updateCutFromMouse(event)
  document.addEventListener('mousemove', updateCutFromMouse)
  document.addEventListener('mouseup', stopCutDrag)
}

function updateCutFromMouse(event: MouseEvent) {
  const active = activeCut.value
  const rect = effectiveRect.value
  if (!active || !rect || !image.value || !imgEl.value) return
  const imageRect = imgEl.value.getBoundingClientRect()
  const cuts = normalizedFreeCuts(active.orientation)
  const start = active.orientation === 'vertical' ? rect.x : rect.y
  const end = active.orientation === 'vertical' ? rect.x + rect.w : rect.y + rect.h
  const raw = active.orientation === 'vertical'
    ? ((event.clientX - imageRect.left) / imageRect.width) * image.value.width
    : ((event.clientY - imageRect.top) / imageRect.height) * image.value.height
  const previous = active.index > 0 ? cuts[active.index - 1] : start
  const next = active.index < cuts.length - 1 ? cuts[active.index + 1] : end
  cuts[active.index] = Math.round(Math.max(previous + MIN_FREE_SLICE_SIZE, Math.min(next - MIN_FREE_SLICE_SIZE, raw)))
  setFreeCuts(active.orientation, cuts)
  freeInitialized.value = true
}

function stopCutDrag() {
  activeCut.value = null
  document.removeEventListener('mousemove', updateCutFromMouse)
  document.removeEventListener('mouseup', stopCutDrag)
}

function changeImage() { pickerVisible.value = true }
async function onChangeImage(paths: string[]) {
  if (!paths.length) return
  await loadPath(paths[0])
}

function onImageLoad() {
  if (!imgEl.value) return
  imgRendered.value = { w: imgEl.value.clientWidth, h: imgEl.value.clientHeight }
}

// O4: 切片保存到图库
const gallery = useGalleryStore()
const saveDialogVisible = ref(false)

function prepareSave() {
  if (!image.value || slices.value.length === 0) return
  saveDialogVisible.value = true
}

async function onSaveConfirm(payload: { categoryId: string; filename: string }) {
  const src = image.value
  if (!src) return
  const sliceSnapshot = slices.value.slice()
  if (sliceSnapshot.length === 0) return
  exporting.value = true
  exportProgress.value = 0
  try {
    const baseEl = new Image()
    await new Promise<void>((resolve, reject) => {
      baseEl.onload = () => resolve()
      baseEl.onerror = () => reject(new Error('Image load failed'))
      baseEl.src = src.dataUri
    })

    const isJpg = src.ext === 'jpg' || src.ext === 'jpeg'
    const ext = isJpg ? 'jpg' : 'png'

    for (let i = 0; i < sliceSnapshot.length; i++) {
      const s = sliceSnapshot[i]
      const tmp = document.createElement('canvas')
      tmp.width = s.w
      tmp.height = s.h
      const ctx = tmp.getContext('2d')!
      ctx.drawImage(baseEl, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h)
      const dataUri = isJpg ? tmp.toDataURL('image/jpeg', 0.92) : tmp.toDataURL('image/png')
      const suffix = `_r${s.row + 1}c${s.col + 1}`
      const fname = payload.filename
        ? `${payload.filename}${suffix}.${ext}`
        : buildOutputName(src.name, suffix, ext)
      await gallery.addFromDataUri(payload.categoryId, dataUri, fname)
      exportProgress.value = i + 1
    }
    showToast(`已保存 ${sliceSnapshot.length} 张到图库`)
  } catch (e: any) {
    showToast('保存失败：' + (e.message || ''))
  } finally {
    exporting.value = false
  }
}

function goBack() { router.back() }
function goGallery() { router.push({ name: 'gallery' }) }
function showToast(t: string) {
  toast.value = t
  setTimeout(() => { if (toast.value === t) toast.value = '' }, 2500)
}
</script>
