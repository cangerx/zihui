<template>
  <Teleport to="body">
    <Transition name="lb-fade">
      <div
        v-if="src"
        ref="rootEl"
        class="fixed inset-0 z-[9600] flex items-center justify-center backdrop-blur-md"
        @click.self="emitClose"
        @wheel.prevent="onWheel"
      >
        <!-- ============ Single mode：单图查看（默认 / 旧调用点零改动） ============
             图片 wrapper 用 inline-flex 让容器尺寸 = 图片 fit-to-screen 后的实际尺寸（max 92vw/92vh）。
             关闭按钮通过 absolute 定位在 wrapper 内部右上角，跟随图片视觉边沿。
             img 自身有 transform 用于缩放/平移，但 transform 不影响 wrapper 的布局尺寸，
             所以按钮位置在缩放 / 拖动后仍稳定。 -->
        <div v-if="mode === 'single'" class="relative inline-flex">
          <img
            :src="currentSingleSrc"
            :alt="alt || ''"
            class="lb-img select-none shadow-[0_0_60px_rgba(0,0,0,0.35)] rounded-md"
            :style="imgStyle"
            @mousedown.prevent="onDragStart"
            @dblclick="onDoubleClick"
            @click.stop
            draggable="false"
          />
          <!-- 当前显示的是参考图时角标提示 -->
          <span
            v-if="hasRefs && activeIndex < resultIdx"
            class="absolute top-2 left-2 px-2 py-1 rounded-md text-[10px] font-medium bg-black/60 text-white pointer-events-none"
          >参考图 {{ activeIndex + 1 }}/{{ refImages?.length }}</span>
          <button
            @click.stop="emitClose"
            @mousedown.stop
            class="lb-close-btn"
            title="关闭 (Esc)"
            aria-label="关闭预览"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <!-- ============ Compare mode：滑动对比（仅在传入 refImages 且有图时启用） ============
             固定 92vw × 92vh 矩形为对比画布；两张 img 都用 contain 居中适配。
             外层 div 的 clip-path 不受 img 的 transform 影响，保证分隔线相对画布固定，
             同时图本身的 zoom/pan 应用到内层 img，两层共享同一 transform → 同步联动。 -->
        <div
          v-else
          ref="compareWrapperEl"
          class="relative"
          :style="{ width: '92vw', height: '92vh' }"
          @mousedown.prevent="onDragStart"
          @dblclick="onDoubleClick"
          @click.stop
        >
          <!-- 底层：参考图（左半显示） -->
          <div
            class="absolute inset-0 flex items-center justify-center overflow-hidden"
            :style="{ clipPath: `inset(0 ${100 - splitPercent}% 0 0)` }"
          >
            <img
              :src="compareLeftSrc"
              :alt="alt || ''"
              class="lb-compare-img"
              :style="imgStyle"
              draggable="false"
            />
            <span class="absolute top-3 left-3 px-2 py-1 rounded-md text-[10px] font-medium bg-black/60 text-white pointer-events-none select-none">
              参考图<template v-if="refImages && refImages.length > 1"> {{ compareRefIndex + 1 }}/{{ refImages.length }}</template>
            </span>
          </div>
          <!-- 顶层：结果图（右半显示） -->
          <div
            class="absolute inset-0 flex items-center justify-center overflow-hidden"
            :style="{ clipPath: `inset(0 0 0 ${splitPercent}%)` }"
          >
            <img
              :src="src"
              :alt="alt || ''"
              class="lb-compare-img"
              :style="imgStyle"
              draggable="false"
            />
            <span class="absolute top-3 right-3 px-2 py-1 rounded-md text-[10px] font-medium bg-black/60 text-white pointer-events-none select-none">结果图</span>
          </div>
          <!-- 分隔线 + 拖拽 handle -->
          <div
            class="absolute top-0 bottom-0 w-px bg-white/85 shadow-[0_0_8px_rgba(0,0,0,0.45)] pointer-events-none"
            :style="{ left: `${splitPercent}%` }"
          ></div>
          <div
            class="absolute top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow-[0_4px_16px_rgba(0,0,0,0.4)] flex items-center justify-center cursor-ew-resize hover:scale-110 transition-transform"
            :style="{ left: `calc(${splitPercent}% - 18px)` }"
            @mousedown.stop.prevent="onSplitDragStart"
            @click.stop
            @dblclick.stop
            title="拖动对比"
          >
            <svg class="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 7l-4 5 4 5M16 7l4 5-4 5" />
            </svg>
          </div>
          <!-- 关闭按钮：固定在视口右上角，避免被对比内容覆盖 -->
          <button
            @click.stop="emitClose"
            @mousedown.stop
            class="lb-close-btn"
            title="关闭 (Esc)"
            aria-label="关闭预览"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <!-- ============ 底部 filmstrip：参考图 + 结果图（仅在有 refImages 时显示） ============
             single 模式：点击切换主图；compare 模式：点参考图切换对比基准、点结果图退出对比。 -->
        <div
          v-if="hasRefs"
          class="fixed left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2 py-1.5 rounded-2xl bg-surface-0 shadow-[0_4px_24px_rgba(0,0,0,0.18)] max-w-[80vw] overflow-x-auto"
          style="bottom: 64px;"
          @click.stop
          @mousedown.stop
          @wheel.stop
        >
          <button
            v-for="(item, idx) in stripItems"
            :key="idx"
            @click="onStripClick(idx)"
            :class="[
              'relative shrink-0 w-12 h-12 rounded-md overflow-hidden border-2 transition-colors',
              isStripActive(idx) ? 'border-primary-500' : 'border-transparent hover:border-surface-3'
            ]"
            :title="stripTitle(idx)"
          >
            <img :src="item.src" class="w-full h-full object-cover" draggable="false" />
            <span v-if="item.kind === 'result'" class="absolute bottom-0 inset-x-0 px-1 py-0.5 text-[9px] text-white text-center bg-black/60 leading-none">结果</span>
          </button>
        </div>

        <!-- ============ 工具栏 ============ -->
        <div
          class="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-2xl bg-surface-0 shadow-[0_4px_24px_rgba(0,0,0,0.18)]"
          @click.stop
          @mousedown.stop
          @wheel.stop
        >
          <button @click="zoomByCenter(1 / 1.25)" class="lb-btn" title="缩小 (-)">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14" /></svg>
          </button>
          <span class="text-[11px] text-text-secondary tabular-nums w-12 text-center font-medium">{{ Math.round(scale * 100) }}%</span>
          <button @click="zoomByCenter(1.25)" class="lb-btn" title="放大 (+)">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14" /></svg>
          </button>
          <button @click="reset" class="lb-btn" title="重置 (0 / 双击)">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M15 9V4.5M15 9h4.5M15 9l5.25-5.25M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 15v4.5M15 15h4.5m-4.5 0 5.25 5.25" /></svg>
          </button>

          <!-- 对比模式开关：仅在传入 refImages 时显示 -->
          <template v-if="hasRefs">
            <div class="w-px h-4 bg-surface-3 mx-0.5" />
            <button
              @click="toggleCompare"
              :class="['lb-btn', mode === 'compare' ? 'lb-btn-active' : '']"
              :title="mode === 'compare' ? '退出对比 (C)' : '与参考图对比 (C)'"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 4.5v15M3 6.75A2.25 2.25 0 0 1 5.25 4.5H9v15H5.25A2.25 2.25 0 0 1 3 17.25V6.75ZM15 4.5h3.75A2.25 2.25 0 0 1 21 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25H15v-15Z" />
              </svg>
            </button>
          </template>

          <template v-if="onCopy || onLocate">
            <div class="w-px h-4 bg-surface-3 mx-0.5" />
            <button v-if="onCopy" @click="onCopy?.()" class="lb-btn" title="复制图片">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" /></svg>
            </button>
            <button v-if="onLocate" @click="onLocate?.()" class="lb-btn" title="打开所在文件夹">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" /></svg>
            </button>
          </template>

          <div class="w-px h-4 bg-surface-3 mx-0.5" />
          <button @click="emitClose" class="lb-btn" title="关闭 (Esc)">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'

type Mode = 'single' | 'compare'

const props = defineProps<{
  /** Image src (主图 / 结果图)；null/'' = 隐藏整个 lightbox */
  src: string | null | undefined
  alt?: string
  /** 可选：参考图列表（base64 data URI / url）。提供后启用底部 filmstrip 与对比模式开关。 */
  refImages?: string[]
  /** Optional toolbar action — shown only when provided. */
  onCopy?: () => void
  /** Optional toolbar action — shown only when provided. */
  onLocate?: () => void
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const MIN_SCALE = 0.1
const MAX_SCALE = 12

const rootEl = ref<HTMLElement | null>(null)
const compareWrapperEl = ref<HTMLElement | null>(null)

// Transform state — image is fit-to-screen at scale=1, centered (tx=ty=0).
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const dragging = ref(false)

// Mode + filmstrip / compare 状态
const mode = ref<Mode>('single')
/** filmstrip 索引：0..refImages.length-1 = 参考图；refImages.length = 结果图 */
const activeIndex = ref(0)
/** compare 模式下底层用第几张参考图 */
const compareRefIndex = ref(0)
const splitPercent = ref(50)

const hasRefs = computed(() => !!(props.refImages && props.refImages.length > 0))
const resultIdx = computed(() => props.refImages?.length || 0)

type StripItem = { src: string; kind: 'ref' | 'result' }
const stripItems = computed<StripItem[]>(() => {
  const items: StripItem[] = []
  if (props.refImages) {
    for (const r of props.refImages) items.push({ src: r, kind: 'ref' })
  }
  if (props.src) items.push({ src: props.src, kind: 'result' })
  return items
})

const currentSingleSrc = computed(() => {
  const items = stripItems.value
  const idx = activeIndex.value
  if (idx < 0 || idx >= items.length) return props.src || ''
  return items[idx].src
})

const compareLeftSrc = computed(() => {
  if (!props.refImages || props.refImages.length === 0) return ''
  const i = Math.max(0, Math.min(props.refImages.length - 1, compareRefIndex.value))
  return props.refImages[i]
})

const imgStyle = computed(() => ({
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`,
  transformOrigin: 'center center',
  // Avoid CSS transition on transform while dragging/zooming via wheel — feels laggy.
  // Reset / dblclick zoom DO want a smooth tween.
  transition: dragging.value ? 'none' : 'transform 120ms ease-out'
}))

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function reset() {
  scale.value = 1
  tx.value = 0
  ty.value = 0
}

function emitClose() {
  emit('close')
}

/** Apply a multiplicative zoom centered on a screen point (mx, my) relative to container center. */
function zoomAt(factor: number, mx: number, my: number) {
  const newScale = clamp(scale.value * factor, MIN_SCALE, MAX_SCALE)
  if (newScale === scale.value) return
  const ratio = newScale / scale.value
  tx.value = mx - (mx - tx.value) * ratio
  ty.value = my - (my - ty.value) * ratio
  scale.value = newScale
}

function zoomByCenter(factor: number) {
  // Toolbar +/- buttons zoom around the visual center (mx=my=0 in our coord system).
  zoomAt(factor, 0, 0)
}

function onWheel(e: WheelEvent) {
  if (!props.src || !rootEl.value) return
  const rect = rootEl.value.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const mx = e.clientX - cx
  const my = e.clientY - cy
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
  zoomAt(factor, mx, my)
}

// ── Drag-to-pan ────────────────────────────────────────────────────────────
let dragStartX = 0
let dragStartY = 0
let dragStartTx = 0
let dragStartTy = 0
let dragMoved = false

function onDragStart(e: MouseEvent) {
  dragging.value = true
  dragMoved = false
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragStartTx = tx.value
  dragStartTy = ty.value
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e: MouseEvent) {
  if (!dragging.value) return
  const dx = e.clientX - dragStartX
  const dy = e.clientY - dragStartY
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true
  tx.value = dragStartTx + dx
  ty.value = dragStartTy + dy
}

function onDragEnd() {
  dragging.value = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
}

function onDoubleClick(e: MouseEvent) {
  if (dragMoved) return
  // Reset if already zoomed, otherwise zoom to 2x at the cursor point.
  if (scale.value !== 1) {
    reset()
    return
  }
  if (!rootEl.value) return
  const rect = rootEl.value.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  zoomAt(2, e.clientX - cx, e.clientY - cy)
}

// ── Split divider drag ─────────────────────────────────────────────────────
let splitDragging = false

function onSplitDragStart(_e: MouseEvent) {
  splitDragging = true
  document.addEventListener('mousemove', onSplitDragMove)
  document.addEventListener('mouseup', onSplitDragEnd)
}

function onSplitDragMove(e: MouseEvent) {
  if (!splitDragging) return
  const wrap = compareWrapperEl.value
  if (!wrap) return
  const rect = wrap.getBoundingClientRect()
  if (rect.width <= 0) return
  const pct = clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100)
  splitPercent.value = pct
}

function onSplitDragEnd() {
  splitDragging = false
  document.removeEventListener('mousemove', onSplitDragMove)
  document.removeEventListener('mouseup', onSplitDragEnd)
}

// ── filmstrip ──────────────────────────────────────────────────────────────
function isStripActive(idx: number): boolean {
  if (mode.value === 'single') return idx === activeIndex.value
  // compare 模式：当前对比的参考图 + 结果图都视作活跃
  if (idx === resultIdx.value) return true
  return idx === compareRefIndex.value
}

function stripTitle(idx: number): string {
  const isResult = idx === resultIdx.value
  if (isResult) return mode.value === 'compare' ? '退出对比，查看结果图' : '查看结果图'
  return mode.value === 'compare' ? `用此参考图对比（参考图 ${idx + 1}）` : `查看参考图 ${idx + 1}`
}

function onStripClick(idx: number) {
  const isResult = idx === resultIdx.value
  if (mode.value === 'single') {
    if (idx === activeIndex.value) return
    activeIndex.value = idx
    reset()
    return
  }
  // compare 模式
  if (isResult) {
    mode.value = 'single'
    activeIndex.value = resultIdx.value
    reset()
  } else {
    if (idx !== compareRefIndex.value) {
      compareRefIndex.value = idx
      reset()
    }
  }
}

function toggleCompare() {
  if (!hasRefs.value) return
  if (mode.value === 'compare') {
    mode.value = 'single'
    activeIndex.value = resultIdx.value
    reset()
    return
  }
  // 进入对比：若 single 当前看的是某张参考图，就用它做对比基准
  if (activeIndex.value < resultIdx.value) {
    compareRefIndex.value = activeIndex.value
  } else {
    compareRefIndex.value = 0
  }
  splitPercent.value = 50
  mode.value = 'compare'
  reset()
}

// ── Keyboard ───────────────────────────────────────────────────────────────
function onKeydown(e: KeyboardEvent) {
  if (!props.src) return
  if (e.key === 'Escape') {
    e.preventDefault()
    emitClose()
  } else if (e.key === '+' || e.key === '=') {
    e.preventDefault()
    zoomByCenter(1.25)
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault()
    zoomByCenter(1 / 1.25)
  } else if (e.key === '0') {
    e.preventDefault()
    reset()
  } else if (e.key === 'ArrowLeft') {
    if (!hasRefs.value) return
    e.preventDefault()
    if (mode.value === 'single') {
      const len = stripItems.value.length
      if (len > 0) {
        activeIndex.value = (activeIndex.value - 1 + len) % len
        reset()
      }
    } else if (props.refImages && props.refImages.length > 0) {
      compareRefIndex.value = (compareRefIndex.value - 1 + props.refImages.length) % props.refImages.length
      reset()
    }
  } else if (e.key === 'ArrowRight') {
    if (!hasRefs.value) return
    e.preventDefault()
    if (mode.value === 'single') {
      const len = stripItems.value.length
      if (len > 0) {
        activeIndex.value = (activeIndex.value + 1) % len
        reset()
      }
    } else if (props.refImages && props.refImages.length > 0) {
      compareRefIndex.value = (compareRefIndex.value + 1) % props.refImages.length
      reset()
    }
  } else if (e.key === 'c' || e.key === 'C') {
    if (!hasRefs.value) return
    e.preventDefault()
    toggleCompare()
  }
}

// Mount/unmount global key listener only when the lightbox is actually open,
// so we don't intercept Esc / +/- / 0 / ←/→ / C for the rest of the app.
watch(
  () => props.src,
  (val) => {
    if (val) {
      reset()
      mode.value = 'single'
      activeIndex.value = resultIdx.value
      compareRefIndex.value = 0
      splitPercent.value = 50
      window.addEventListener('keydown', onKeydown)
    } else {
      window.removeEventListener('keydown', onKeydown)
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  document.removeEventListener('mousemove', onSplitDragMove)
  document.removeEventListener('mouseup', onSplitDragEnd)
})
</script>

<style scoped>
.lb-img {
  /* Fit-to-screen at scale=1: at most 92vw / 92vh, preserving aspect ratio.
     Larger image will be downscaled to fit; smaller image displayed at native size.
     Zooming via wheel/buttons multiplies on top of this baseline. */
  max-width: 92vw;
  max-height: 92vh;
  width: auto;
  height: auto;
  -webkit-user-drag: none;
}

/* Compare 模式下两张图都在 92vw × 92vh 画布内 contain 居中 */
.lb-compare-img {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  -webkit-user-drag: none;
  user-select: none;
}

.lb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--text-secondary, #6b7280);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 120ms ease-out, color 120ms ease-out;
}
.lb-btn:hover {
  background: var(--surface-2, #f3f4f6);
  color: var(--text-primary, #111827);
}
.lb-btn-active {
  background: var(--color-primary-50, #f2f6f5);
  color: var(--color-primary-600, #1f4d46);
}
.lb-btn-active:hover {
  background: var(--color-primary-100, #e6efed);
  color: var(--color-primary-700, #1a3f3a);
}

/* Fade in/out */
.lb-fade-enter-active,
.lb-fade-leave-active {
  transition: opacity 160ms ease-out;
}
.lb-fade-enter-from,
.lb-fade-leave-to {
  opacity: 0;
}

/*
 * 关闭按钮：任何背景色 / 明暗模式都清晰可见。
 *
 * 四层防护：
 *   1. 黑色半透底（bg rgba(0,0,0,0.7)）— 浅色背景上不融合
 *   2. 白色外圈（box-shadow inset 伪装 ring + outline）— 深色背景上仍有边界
 *   3. 白色加粗图标（text-white + stroke-width 2.5）— 视觉量足
 *   4. 悬停变红 + 放大（明确收到点击意图反馈）
 * 位置：top/right 12px 距离系统标题栏关闭按钮更远；40×40px 点击区更大。
 */
.lb-close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  /* 双层边界：内侧白环（深背景可见） + 外侧黑环（白背景可见） + 投射阴影增强立体感 */
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.95),
    0 0 0 3px rgba(0, 0, 0, 0.5),
    0 4px 16px rgba(0, 0, 0, 0.5);
  transition: background 150ms ease-out, transform 150ms ease-out, box-shadow 150ms ease-out;
}
.lb-close-btn:hover {
  background: #dc2626; /* red-600 — 明确点击意图反馈 */
  transform: scale(1.08);
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 1),
    0 0 0 3px rgba(0, 0, 0, 0.5),
    0 6px 20px rgba(220, 38, 38, 0.5);
}
.lb-close-btn:active {
  transform: scale(0.94);
}
.lb-close-btn:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 4px;
}
</style>
