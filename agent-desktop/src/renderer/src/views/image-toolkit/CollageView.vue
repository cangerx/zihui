<template>
  <div class="h-full flex flex-col bg-surface-1">
    <header class="h-12 flex items-center justify-between px-4 bg-surface-0 border-b border-surface-3 flex-shrink-0">
      <div class="flex items-center gap-3">
        <button @click="goBack" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors" title="返回">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
        </button>
        <span class="text-sm font-medium text-text-primary">拼图拼接</span>
        <span class="text-[11px] text-text-tertiary">{{ images.length }} 张</span>
      </div>
      <div class="flex items-center gap-1.5">
        <button @click="addMore" class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors">添加图片</button>
        <button @click="prepareSave" :disabled="images.length === 0 || exporting" class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50">{{ exporting ? '保存中...' : '保存到图库' }}</button>
      </div>
    </header>

    <div class="flex flex-1 overflow-hidden min-h-0">
      <!-- Left: Templates + settings -->
      <div class="w-56 bg-surface-0 border-r border-surface-3 overflow-y-auto p-3 space-y-4 flex-shrink-0">
        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">模板</h4>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="t in templates"
              :key="t.id"
              @click="setTemplate(t.id)"
              :class="['p-2 rounded-lg border text-[11px] transition-colors flex flex-col items-center gap-1', template === t.id ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/20' : 'border-surface-3 text-text-secondary hover:bg-surface-2']"
            >
              <svg class="w-7 h-7" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5">
                <g v-html="t.preview"></g>
              </svg>
              <span>{{ t.label }}</span>
            </button>
          </div>
        </div>

        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">参数</h4>
          <div class="space-y-2">
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-text-secondary">间距</span>
                <span class="text-[10px] text-text-tertiary">{{ gap }}px</span>
              </div>
              <input type="range" min="0" max="40" v-model.number="gap" class="w-full h-1 accent-primary-600" />
            </div>
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-text-secondary">外边距</span>
                <span class="text-[10px] text-text-tertiary">{{ padding }}px</span>
              </div>
              <input type="range" min="0" max="80" v-model.number="padding" class="w-full h-1 accent-primary-600" />
            </div>
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-text-secondary">圆角</span>
                <span class="text-[10px] text-text-tertiary">{{ radius }}px</span>
              </div>
              <input type="range" min="0" max="60" v-model.number="radius" class="w-full h-1 accent-primary-600" />
            </div>
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-text-secondary">输出宽度</span>
                <span class="text-[10px] text-text-tertiary">{{ outputWidth }}px</span>
              </div>
              <input type="range" min="800" max="3000" step="100" v-model.number="outputWidth" class="w-full h-1 accent-primary-600" />
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-text-secondary">背景色</span>
              <input type="color" v-model="bgColor" class="w-7 h-7 rounded border border-surface-3 cursor-pointer" />
              <button @click="bgColor = '#ffffff'" class="text-[10px] text-text-tertiary hover:text-text-secondary">白</button>
              <button @click="bgColor = '#000000'" class="text-[10px] text-text-tertiary hover:text-text-secondary">黑</button>
              <button @click="bgColor = '#f3f4f6'" class="text-[10px] text-text-tertiary hover:text-text-secondary">灰</button>
            </div>
            <label v-if="!isStitch" class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" v-model="cropToFill" class="w-3 h-3 accent-primary-600" />
              <span class="text-[11px] text-text-secondary">填满裁剪（cover）</span>
            </label>
            <label v-if="isStitch" class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" v-model="noUpscale" class="w-3 h-3 accent-primary-600" />
              <span class="text-[11px] text-text-secondary">只缩不放大（保清晰度）</span>
            </label>
          </div>
        </div>

        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">图片列表（拖动排序）</h4>
          <div class="space-y-1.5">
            <div
              v-for="(img, i) in images"
              :key="img.path"
              class="flex items-center gap-2 p-1.5 rounded border border-surface-3 bg-surface-1 group"
              draggable="true"
              @dragstart="dragIndex = i"
              @dragover.prevent
              @drop.prevent="onDropImage(i)"
            >
              <span class="text-[10px] text-text-tertiary w-4 text-center">{{ i + 1 }}</span>
              <img :src="img.dataUri" class="w-8 h-8 object-cover rounded flex-shrink-0" />
              <span class="text-[10px] text-text-secondary flex-1 truncate" :title="img.name">{{ img.name }}</span>
              <button @click="removeImage(i)" class="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-red-500 transition-opacity">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Center: Preview canvas -->
      <div class="flex-1 flex flex-col items-center justify-center overflow-auto bg-[#f0f0f0] dark:bg-surface-2 p-6 gap-3">
        <div v-if="images.length === 0" class="text-center text-text-tertiary text-xs">
          请先添加图片
        </div>
        <template v-else>
          <canvas
            ref="canvasRef"
            class="max-w-full max-h-full shadow-md rounded cursor-grab"
            :class="{ 'cursor-grabbing': dragging }"
            @mousedown="onCanvasMouseDown"
            @mousemove="onCanvasMouseMove"
            @mouseup="onCanvasMouseUp"
            @mouseleave="onCanvasMouseUp"
            @wheel.prevent="onCanvasWheel"
            @dblclick="onCanvasDoubleClick"
          ></canvas>
          <div class="text-[11px] text-text-tertiary text-center">
            在图片上 <span class="text-text-secondary">拖拽</span> 调整位置，<span class="text-text-secondary">滚轮</span> 缩放，<span class="text-text-secondary">双击</span> 重置
          </div>
        </template>
      </div>
    </div>

    <ImageSourcePickerDialog v-model:visible="pickerVisible" :multiple="true" @select="onAddImages" />

    <GallerySaveDialog
      v-model:visible="saveDialogVisible"
      :preview-data-uri="pendingDataUri"
      :default-name="defaultSaveName"
      @confirm="onSaveConfirm"
    />

    <div v-if="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-surface-0 shadow-lg border border-surface-3 text-xs text-text-primary">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, nextTick, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useHandoffStore } from '@/stores/handoff'
import ImageSourcePickerDialog from '@/components/ImageSourcePickerDialog.vue'
import GallerySaveDialog from '@/components/GallerySaveDialog.vue'
import { loadAsDataUri, type LoadedImage } from '@/utils/image-source'
import { useGalleryStore } from '@/stores/gallery'

type Template = 'horizontal' | 'vertical' | 'grid2x2' | 'grid3x3' | 'mosaic' | 'vStitch' | 'hStitch'

const router = useRouter()
const handoff = useHandoffStore()
const gallery = useGalleryStore()

// O4: 保存到图库弹窗状态
const saveDialogVisible = ref(false)
const pendingDataUri = ref('')
const defaultSaveName = ref('')

const images = ref<LoadedImage[]>([])
const template = ref<Template>('vertical')
const gap = ref(8)
const padding = ref(16)
const radius = ref(8)
const outputWidth = ref(1600)
const bgColor = ref('#ffffff')
const cropToFill = ref(true)
// 长图模式（vStitch/hStitch）专属：勾选后图片只缩不放（以最窄/最矮那张为基准，保清晰度）；
// 不勾选则窄图会被放大到统一基准（边缘对齐，可能损失清晰度）
const noUpscale = ref(false)
// 长图模式判定：这两个模板槽位宽高比=图片宽高比，cover/contain 数学上退化相同结果，「填满裁剪」对其无效
const isStitch = computed(() => template.value === 'vStitch' || template.value === 'hStitch')
const exporting = ref(false)
const toast = ref('')
const pickerVisible = ref(false)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const dragIndex = ref<number | null>(null)

// O5: 每个宫格的独立变换（拖动偏移 + 缩放）
// key: 宫格索引累计（与图片顺序一致）；value: { offsetX, offsetY, scale }
// offset 以「原始 cover 对齐后的 dx, dy 」为原点，单位为宫格坐标系 px
const slotTransforms = ref<Record<number, { offsetX: number; offsetY: number; scale: number }>>({})
const dragging = ref(false)
let dragSlot = -1
let dragStart = { x: 0, y: 0, baseOX: 0, baseOY: 0 }
let cachedLayout: { canvasW: number; canvasH: number; slots: Slot[] } | null = null
const imageElCache = new Map<string, HTMLImageElement>()

const templates: Array<{ id: Template; label: string; preview: string }> = [
  { id: 'horizontal', label: '横拼', preview: '<rect x="3" y="10" width="8" height="12" rx="1"/><rect x="12" y="10" width="8" height="12" rx="1"/><rect x="21" y="10" width="8" height="12" rx="1"/>' },
  { id: 'vertical', label: '竖拼', preview: '<rect x="10" y="3" width="12" height="8" rx="1"/><rect x="10" y="12" width="12" height="8" rx="1"/><rect x="10" y="21" width="12" height="8" rx="1"/>' },
  { id: 'vStitch', label: '长图竖拼', preview: '<rect x="9" y="2" width="14" height="7" rx="1"/><rect x="9" y="11" width="14" height="11" rx="1"/><rect x="9" y="24" width="14" height="6" rx="1"/>' },
  { id: 'hStitch', label: '长图横拼', preview: '<rect x="2" y="9" width="7" height="14" rx="1"/><rect x="11" y="9" width="11" height="14" rx="1"/><rect x="24" y="9" width="6" height="14" rx="1"/>' },
  { id: 'grid2x2', label: '2×2', preview: '<rect x="4" y="4" width="11" height="11" rx="1"/><rect x="17" y="4" width="11" height="11" rx="1"/><rect x="4" y="17" width="11" height="11" rx="1"/><rect x="17" y="17" width="11" height="11" rx="1"/>' },
  { id: 'grid3x3', label: '九宫格', preview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="12" y="3" width="7" height="7" rx="1"/><rect x="21" y="3" width="7" height="7" rx="1"/><rect x="3" y="12" width="7" height="7" rx="1"/><rect x="12" y="12" width="7" height="7" rx="1"/><rect x="21" y="12" width="7" height="7" rx="1"/><rect x="3" y="21" width="7" height="7" rx="1"/><rect x="12" y="21" width="7" height="7" rx="1"/><rect x="21" y="21" width="7" height="7" rx="1"/>' },
  { id: 'mosaic', label: '马赛克', preview: '<rect x="3" y="3" width="14" height="14" rx="1"/><rect x="19" y="3" width="10" height="6" rx="1"/><rect x="19" y="11" width="10" height="6" rx="1"/><rect x="3" y="19" width="6" height="10" rx="1"/><rect x="11" y="19" width="6" height="10" rx="1"/><rect x="19" y="19" width="10" height="10" rx="1"/>' }
]

// ---- Lifecycle ----
onMounted(async () => {
  const payload = handoff.consume<{ paths: string[]; toolId?: string }>('imageToolkit')
  if (!payload?.paths?.length) {
    showToast('未传入图片，请重新选择')
    return
  }
  await loadPaths(payload.paths)
})

watch([template, gap, padding, radius, outputWidth, bgColor, cropToFill, noUpscale, images], async () => {
  await nextTick()
  redraw()
}, { deep: true })

// ---- Image management ----
async function loadPaths(paths: string[]) {
  // 拼图保留较大尺寸（2048）以保证导出质量；展示用的小图自动按 canvas 缩放
  const items = await loadAsDataUri(paths, { maxSize: 2048, quality: 0.9 })
  images.value.push(...items)
  await nextTick()
  redraw()
}

function setTemplate(t: Template) {
  template.value = t
  // 模板切换不强制裁掉多余图片：grid2x2 选 5 张时多出来的会忽略；用户可手动删除
  if (t === 'vStitch' || t === 'hStitch') {
    showToast('长图模式：间距 / 外边距 / 圆角调 0 即无缝首尾相连')
  }
}

function addMore() {
  pickerVisible.value = true
}

async function onAddImages(paths: string[]) {
  if (!paths.length) return
  await loadPaths(paths)
}

function removeImage(idx: number) {
  images.value.splice(idx, 1)
  // O5: 同步清理该格及以后的变换（索引会偏移）
  delete slotTransforms.value[idx]
  // 后续索引前移
  const next: Record<number, { offsetX: number; offsetY: number; scale: number }> = {}
  for (const [k, v] of Object.entries(slotTransforms.value)) {
    const i = Number(k)
    if (i < idx) next[i] = v
    else if (i > idx) next[i - 1] = v
  }
  slotTransforms.value = next
}

function onDropImage(targetIdx: number) {
  if (dragIndex.value === null || dragIndex.value === targetIdx) return
  const arr = images.value.slice()
  const [moved] = arr.splice(dragIndex.value, 1)
  arr.splice(targetIdx, 0, moved)
  images.value = arr
  dragIndex.value = null
}

// ---- Layout calculation ----
interface Slot { x: number; y: number; w: number; h: number }

/** O5: 设置某个宫格的变换（增量），不存在时按默认初始化 */
function setSlotTransform(idx: number, patch: Partial<{ offsetX: number; offsetY: number; scale: number }>) {
  const cur = slotTransforms.value[idx] || { offsetX: 0, offsetY: 0, scale: 1 }
  slotTransforms.value[idx] = { ...cur, ...patch }
}

/**
 * 根据模板计算每张图的画布坐标。
 * 所有模板都按 outputWidth 给定的目标宽度排版，画布高度由模板决定。
 * 多余图片（数量超过模板槽位）会被忽略，不显示在拼图里。
 * 例外：长图横拼（hStitch）的画布宽度由内容决定（≈ outputWidth），长图模板不忽略任何图片。
 */
function computeLayout(): { canvasW: number; canvasH: number; slots: Slot[] } {
  const W = outputWidth.value
  const P = padding.value
  const G = gap.value
  const inner = W - P * 2

  const t = template.value
  const slots: Slot[] = []
  let canvasW = W
  let canvasH = 0

  // 防爆保护：浏览器 canvas 单维度上限（Chrome 16384~32767），长图模式累加尺寸可能超限，
  // 超限时按比例收窄基准，保证 toDataURL 能成功导出
  const MAX_DIM = 16000

  if (t === 'horizontal') {
    const n = images.value.length
    const cellW = (inner - G * (n - 1)) / n
    // 每张图按其原始比例换算高度，取最小高度作为统一高度（保证一行视觉一致）
    let minRatio = Infinity
    for (const img of images.value) minRatio = Math.min(minRatio, img.height / img.width)
    const cellH = Math.round(cellW * minRatio)
    for (let i = 0; i < n; i++) {
      slots.push({ x: P + i * (cellW + G), y: P, w: cellW, h: cellH })
    }
    canvasH = P * 2 + cellH
  } else if (t === 'vertical') {
    let minRatio = Infinity
    for (const img of images.value) minRatio = Math.min(minRatio, img.width / img.height)
    const cellH = Math.round(inner * minRatio) // 用最瘦那张决定行高
    const n = images.value.length
    for (let i = 0; i < n; i++) {
      slots.push({ x: P, y: P + i * (cellH + G), w: inner, h: cellH })
    }
    canvasH = P * 2 + n * cellH + (n - 1) * G
  } else if (t === 'vStitch') {
    // 长图竖拼（首尾相连）：每张图等比缩放到统一宽度，高度按各自宽高比自然累加
    // 宽度基准：默认 = 内容宽度 inner（窄图会放大）；「只缩不放大」= inner 与最窄图宽取小
    const n = images.value.length
    let basisW = inner
    if (noUpscale.value && n > 0) {
      let minW = Infinity
      for (const img of images.value) minW = Math.min(minW, img.width)
      if (Number.isFinite(minW)) basisW = Math.min(inner, minW)
    }
    // 防爆：总高超限则按比率收窄基准宽
    let totalH = P * 2 + G * Math.max(0, n - 1)
    for (const img of images.value) totalH += basisW * (img.height / img.width)
    if (totalH > MAX_DIM) basisW = Math.max(50, Math.floor((basisW * MAX_DIM) / totalH))
    let y = P
    for (const img of images.value) {
      const h = basisW * (img.height / img.width)
      slots.push({ x: P + (inner - basisW) / 2, y, w: basisW, h })
      y += h + G
    }
    canvasH = n > 0 ? y - G + P : P * 2
  } else if (t === 'hStitch') {
    // 长图横拼（首尾相连）：每张图等比缩放到统一高度，宽度按各自宽高比自然累加
    // 高度基准：默认使总宽 ≈ outputWidth；「只缩不放大」再与最矮图高取小
    const n = images.value.length
    let ratioSum = 0
    let minH = Infinity
    for (const img of images.value) {
      ratioSum += img.width / img.height
      minH = Math.min(minH, img.height)
    }
    let basisH = ratioSum > 0 ? (inner - G * Math.max(0, n - 1)) / ratioSum : inner
    if (noUpscale.value && Number.isFinite(minH)) basisH = Math.min(basisH, minH)
    // 防爆：总宽超限则按比率收窄基准高
    const totalW = P * 2 + G * Math.max(0, n - 1) + basisH * ratioSum
    if (totalW > MAX_DIM) basisH = Math.max(50, Math.floor((basisH * MAX_DIM) / totalW))
    let x = P
    for (const img of images.value) {
      const w = basisH * (img.width / img.height)
      slots.push({ x, y: P, w, h: basisH })
      x += w + G
    }
    canvasW = n > 0 ? x - G + P : W
    canvasH = P * 2 + basisH
  } else if (t === 'grid2x2') {
    const cellW = (inner - G) / 2
    const cellH = cellW // 方形
    for (let i = 0; i < 4; i++) {
      const r = Math.floor(i / 2), c = i % 2
      slots.push({ x: P + c * (cellW + G), y: P + r * (cellH + G), w: cellW, h: cellH })
    }
    canvasH = P * 2 + cellH * 2 + G
  } else if (t === 'grid3x3') {
    const cellW = (inner - G * 2) / 3
    const cellH = cellW
    for (let i = 0; i < 9; i++) {
      const r = Math.floor(i / 3), c = i % 3
      slots.push({ x: P + c * (cellW + G), y: P + r * (cellH + G), w: cellW, h: cellH })
    }
    canvasH = P * 2 + cellH * 3 + G * 2
  } else if (t === 'mosaic') {
    // 马赛克：1 张大图（左上 2x2 块）+ 右上 2 个长方形 + 左下 3 个方块 + 右下 1 个方块
    // 简化为 6 槽布局（5+ 张图时显示）
    const u = (inner - G * 2) / 3 // 单元格基础大小
    const big = u * 2 + G          // 大图边长
    slots.push({ x: P, y: P, w: big, h: big })                                       // 左上大
    slots.push({ x: P + big + G, y: P, w: u, h: u })                                 // 右上 1
    slots.push({ x: P + big + G, y: P + u + G, w: u, h: u })                         // 右上 2
    slots.push({ x: P, y: P + big + G, w: u, h: u })                                 // 左下 1
    slots.push({ x: P + u + G, y: P + big + G, w: u, h: u })                         // 左下 2
    slots.push({ x: P + (u + G) * 2, y: P + big + G, w: u, h: u })                   // 右下 1
    canvasH = P * 2 + big + G + u
  }

  return { canvasW: Math.round(canvasW), canvasH: Math.round(canvasH), slots }
}

// ---- Render ----
function redraw() {
  if (!canvasRef.value || images.value.length === 0) return
  const layout = computeLayout()
  cachedLayout = layout
  const { canvasW, canvasH, slots } = layout
  const canvas = canvasRef.value
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = bgColor.value
  ctx.fillRect(0, 0, canvasW, canvasH)

  for (let i = 0; i < slots.length && i < images.value.length; i++) {
    const slot = slots[i]
    const img = images.value[i]
    const cached = imageElCache.get(img.dataUri)
    if (cached && cached.complete && cached.naturalWidth > 0) {
      drawImageInSlot(ctx, cached, slot, i)
    } else {
      const el = new Image()
      el.onload = () => {
        imageElCache.set(img.dataUri, el)
        // 调用全量 redraw 避免部分图上下文覆盖问题
        redraw()
      }
      el.src = img.dataUri
      if (el.complete && el.naturalWidth > 0) {
        imageElCache.set(img.dataUri, el)
        drawImageInSlot(ctx, el, slot, i)
      }
    }
  }
}

function drawImageInSlot(ctx: CanvasRenderingContext2D, el: HTMLImageElement, slot: Slot, idx: number) {
  const r = radius.value
  const tr = slotTransforms.value[idx] || { offsetX: 0, offsetY: 0, scale: 1 }
  ctx.save()
  // 圆角裁剪
  if (r > 0) {
    roundRectPath(ctx, slot.x, slot.y, slot.w, slot.h, r)
    ctx.clip()
  }

  if (cropToFill.value) {
    // cover：等比放大填满，超出裁掉（居中） + O5 用户变换
    const sw = el.naturalWidth, sh = el.naturalHeight
    const sRatio = sw / sh
    const dRatio = slot.w / slot.h
    let baseW = slot.w, baseH = slot.h
    if (sRatio > dRatio) {
      baseW = slot.h * sRatio
    } else {
      baseH = slot.w / sRatio
    }
    const drawW = baseW * tr.scale
    const drawH = baseH * tr.scale
    // 默认居中对齐 + 用户偏移
    const dx = slot.x + (slot.w - drawW) / 2 + tr.offsetX
    const dy = slot.y + (slot.h - drawH) / 2 + tr.offsetY
    ctx.drawImage(el, dx, dy, drawW, drawH)
  } else {
    // contain：等比缩放完整显示 + O5 用户变换
    const sRatio = el.naturalWidth / el.naturalHeight
    const dRatio = slot.w / slot.h
    let baseW = slot.w, baseH = slot.h
    if (sRatio > dRatio) {
      baseH = slot.w / sRatio
    } else {
      baseW = slot.h * sRatio
    }
    const drawW = baseW * tr.scale
    const drawH = baseH * tr.scale
    const dx = slot.x + (slot.w - drawW) / 2 + tr.offsetX
    const dy = slot.y + (slot.h - drawH) / 2 + tr.offsetY
    ctx.drawImage(el, dx, dy, drawW, drawH)
  }
  ctx.restore()
}

// ---- O5: Slot 交互 ----
/** 将鼠标事件转为 canvas 内部坐标（应对 CSS 缩放） */
function toCanvasPoint(e: MouseEvent | WheelEvent): { x: number; y: number } | null {
  const canvas = canvasRef.value
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0) return null
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
}

/** 查找某个坐标处的宫格索引，未命中返回 -1 */
function findSlotAt(x: number, y: number): number {
  if (!cachedLayout) return -1
  const max = Math.min(cachedLayout.slots.length, images.value.length)
  for (let i = 0; i < max; i++) {
    const s = cachedLayout.slots[i]
    if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return i
  }
  return -1
}

function onCanvasMouseDown(e: MouseEvent) {
  const p = toCanvasPoint(e)
  if (!p) return
  const idx = findSlotAt(p.x, p.y)
  if (idx < 0) return
  dragging.value = true
  dragSlot = idx
  const tr = slotTransforms.value[idx] || { offsetX: 0, offsetY: 0, scale: 1 }
  dragStart = { x: p.x, y: p.y, baseOX: tr.offsetX, baseOY: tr.offsetY }
}

function onCanvasMouseMove(e: MouseEvent) {
  if (!dragging.value || dragSlot < 0) return
  const p = toCanvasPoint(e)
  if (!p) return
  setSlotTransform(dragSlot, {
    offsetX: dragStart.baseOX + (p.x - dragStart.x),
    offsetY: dragStart.baseOY + (p.y - dragStart.y)
  })
  redraw()
}

function onCanvasMouseUp() {
  if (!dragging.value) return
  dragging.value = false
  dragSlot = -1
}

function onCanvasWheel(e: WheelEvent) {
  const p = toCanvasPoint(e)
  if (!p) return
  const idx = findSlotAt(p.x, p.y)
  if (idx < 0) return
  const cur = slotTransforms.value[idx] || { offsetX: 0, offsetY: 0, scale: 1 }
  // 每格 100px deltaY 对应 0.9 倍或 1/0.9 倍缩放指数中立，限制 [0.3, 6]
  const factor = Math.pow(0.999, e.deltaY)
  const next = Math.max(0.3, Math.min(6, cur.scale * factor))
  setSlotTransform(idx, { scale: next })
  redraw()
}

function onCanvasDoubleClick(e: MouseEvent) {
  const p = toCanvasPoint(e)
  if (!p) return
  const idx = findSlotAt(p.x, p.y)
  if (idx < 0) return
  // 重置该格的变换
  delete slotTransforms.value[idx]
  redraw()
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
}

// ---- O4: Save to gallery ----
async function prepareSave() {
  if (!canvasRef.value) return
  // 等下一帧确保所有 image.onload 完成（保险延迟）
  await new Promise(r => setTimeout(r, 100))
  pendingDataUri.value = canvasRef.value.toDataURL('image/png')
  defaultSaveName.value = `拼图_${new Date().toISOString().slice(0, 10)}`
  saveDialogVisible.value = true
}

async function onSaveConfirm(payload: { categoryId: string; filename: string }) {
  if (!pendingDataUri.value) return
  exporting.value = true
  try {
    const name = payload.filename || defaultSaveName.value
    const item = await gallery.addFromDataUri(payload.categoryId, pendingDataUri.value, name)
    if (item) showToast('已保存到图库')
    else throw new Error('未知错误')
  } catch (e: any) {
    showToast('保存失败：' + (e.message || ''))
  } finally {
    exporting.value = false
    pendingDataUri.value = ''
  }
}

function goBack() {
  router.back()
}

function showToast(text: string) {
  toast.value = text
  setTimeout(() => { if (toast.value === text) toast.value = '' }, 2500)
}
</script>
