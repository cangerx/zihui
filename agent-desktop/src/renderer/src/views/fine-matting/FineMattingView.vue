<template>
  <div class="h-full flex flex-col">
    <!-- 顶部说明栏：三档计费 + 并发上限 -->
    <header class="page-header items-start gap-4 !py-3">
      <div class="flex-1 min-w-0">
        <p class="page-desc">
          精细抠图，按图片尺寸三档计费，输出透明 PNG。
          <span v-if="store.cloudQuota" class="ml-2">
            4K 以下 <strong class="text-text-primary">{{ fmt(store.cloudQuota.tier1_credit) }}</strong> {{ creditLabel }} /
            4K-8K <strong class="text-text-primary">{{ fmt(store.cloudQuota.tier2_credit) }}</strong> {{ creditLabel }} /
            8K 以上 <strong class="text-text-primary">{{ fmt(store.cloudQuota.tier3_credit) }}</strong>
            {{ creditLabel }} 每张（一次最多提交 {{ MAX_QUEUE }} 张）。
          </span>
          <span v-else class="ml-2">一次最多提交 {{ MAX_QUEUE }} 张。</span>
        </p>
      </div>
    </header>

    <!-- 服务状态条：精细抠图服务未启用 / 未开通时提示 -->
    <div v-if="serviceBanner" class="px-4 py-2 text-xs text-warn bg-warn/10 border-b border-surface-3">
      {{ serviceBanner }}
    </div>

    <div class="flex-1 grid grid-cols-[280px_1fr_320px] min-h-0 border-t border-surface-3">
      <!-- 左：任务队列 -->
      <aside class="flex flex-col bg-surface-0 min-h-0 border-r border-surface-3">
        <div class="px-3 py-2.5 border-b border-surface-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold">任务队列</h2>
          <button
            v-if="store.tasks.length"
            class="text-xs text-text-tertiary hover:text-error"
            @click="clearAll"
          >清空</button>
        </div>
        <div class="flex-1 overflow-y-auto p-2 space-y-2">
          <div v-if="store.tasks.length === 0" class="text-center text-xs text-text-tertiary mt-8">
            尚未添加任务
          </div>
          <div
            v-for="t in store.tasks"
            :key="t.id"
            class="rounded border cursor-pointer p-2 transition-colors"
            :class="[
              selectedTaskId === t.id ? 'border-primary-400 bg-primary-50/30' : 'border-surface-3 hover:bg-surface-1',
            ]"
            @click="selectedTaskId = t.id"
          >
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-xs font-medium" :class="statusClass(t.status)">{{ statusLabel(t.status) }}</span>
              <span v-if="t.elapsedMs" class="text-[10px] text-text-tertiary">{{ t.elapsedMs }} ms</span>
            </div>
            <div class="text-xs truncate text-text-secondary" :title="t.sourcePath">
              {{ basename(t.sourcePath) }}
            </div>
            <div v-if="t.status === 'completed' && t.tier" class="text-[10px] text-text-tertiary mt-1">
              {{ tierLabelByTier(t.tier) }}<span v-if="t.cost"> · {{ fmt(t.cost) }} {{ creditLabel }}</span>
            </div>
            <div v-if="t.error" class="text-[10px] text-error mt-1 line-clamp-2" :title="t.error">
              {{ friendlyMattingError(t.error) }}
            </div>
          </div>
        </div>
      </aside>

      <!-- 中：预览区 -->
      <section class="flex flex-col bg-surface-0 min-h-0 overflow-hidden border-r border-surface-3">
        <div v-if="!currentTask" class="flex-1 flex items-center justify-center text-text-tertiary text-sm">
          请先在右侧选择图片或拖入图片
        </div>
        <div v-else class="flex-1 p-3 min-h-0 overflow-hidden flex flex-col gap-2">
          <div class="flex items-center justify-between gap-3">
            <div class="text-xs text-text-tertiary flex items-center gap-2">
              <span>覆盖对比</span>
              <span v-if="currentTask.status === 'completed'" class="text-success text-[10px]">完成</span>
              <span v-else-if="currentTask.status === 'failed'" class="text-error text-[10px]">失败</span>
              <span v-else class="text-warn text-[10px]">{{ statusLabel(currentTask.status) }}…</span>
            </div>
          </div>
          <div
            ref="comparePreviewRef"
            class="relative flex-1 min-h-0 rounded border border-surface-3 bg-surface-1 overflow-hidden cursor-zoom-in"
            title="点击查看大图"
            @click="onPreviewClick"
          >
            <img
              v-if="currentSourcePreviewUrl"
              :src="currentSourcePreviewUrl"
              class="absolute inset-0 w-full h-full object-contain"
              alt="原图"
            />
            <div
              v-if="currentTask.status === 'completed' && currentTask.resultPath"
              class="absolute inset-0 checkerboard"
              :style="{ clipPath: `inset(0 ${100 - compareRatio}% 0 0)` }"
            >
              <img :src="resultFileUrl" class="absolute inset-0 w-full h-full object-contain" alt="结果" />
            </div>
            <div
              v-if="currentTask.status === 'completed' && currentTask.resultPath"
              class="absolute inset-y-0 w-px bg-primary-500 shadow-[0_0_0_1px_rgba(255,255,255,0.7)]"
              :style="{ left: compareRatio + '%' }"
            />
            <button
              v-if="currentTask.status === 'completed' && currentTask.resultPath"
              class="absolute top-1/2 z-10 w-8 h-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface-0 border border-surface-3 shadow-[0_4px_16px_rgba(0,0,0,0.18)] flex items-center justify-center cursor-ew-resize hover:scale-105 transition-transform"
              :style="{ left: compareRatio + '%' }"
              title="按住拖动对比"
              @mousedown.stop.prevent="startCompareDrag"
              @click.stop
            >
              <svg class="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8 7l-4 5 4 5M16 7l4 5-4 5" />
              </svg>
            </button>
            <div
              v-if="currentTask.status === 'completed' && currentTask.resultPath"
              class="absolute top-2 left-2 px-2 py-1 rounded bg-surface-0/90 border border-surface-3 text-[10px] text-text-secondary shadow-sm"
            >原图</div>
            <div
              v-if="currentTask.status === 'completed' && currentTask.resultPath"
              class="absolute top-2 right-2 px-2 py-1 rounded bg-surface-0/90 border border-surface-3 text-[10px] text-text-secondary shadow-sm"
            >结果</div>
            <div
              v-else-if="currentTask.error"
              class="absolute inset-0 flex items-center justify-center text-xs text-error px-6 text-center bg-surface-0/80"
              :title="currentTask.error"
            >{{ friendlyMattingError(currentTask.error) }}</div>
            <div
              v-else
              class="absolute inset-0 flex items-center justify-center text-xs text-text-tertiary bg-surface-0/60"
            >处理中…</div>
          </div>
        </div>

        <div
          v-if="currentTask && currentTask.status === 'completed' && currentTask.resultPath"
          class="px-3 py-2 border-t border-surface-3 flex items-center gap-2"
        >
          <button class="btn-secondary !py-1 !text-xs" @click="copyResult">复制图片</button>
          <button class="btn-secondary !py-1 !text-xs" @click="showResultInFolder">在文件夹中显示</button>
          <button class="btn-secondary !py-1 !text-xs" @click="retryTask">重做</button>
          <button class="btn-secondary !py-1 !text-xs" @click="goSlice">去切图</button>
        </div>
      </section>

      <!-- 右：输入与设置 -->
      <aside class="flex flex-col bg-surface-0 min-h-0 overflow-hidden">
        <div class="px-3 py-2.5 border-b border-surface-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold">添加任务</h2>
          <span class="text-[10px] text-text-tertiary">{{ pendingFiles.length }} / {{ MAX_QUEUE }}</span>
        </div>
        <div class="flex-1 overflow-y-auto p-3 space-y-3">
          <div
            class="rounded-md border-2 border-dashed border-surface-3 hover:border-primary-400 transition-colors p-4 text-center cursor-pointer"
            :class="{
              'border-primary-500 bg-primary-50/30': dragOver,
              'opacity-50 pointer-events-none': pendingFiles.length >= MAX_QUEUE,
            }"
            @dragover.prevent="dragOver = true"
            @dragleave.prevent="dragOver = false"
            @drop.prevent="onDrop"
            @click="fileInputRef?.click()"
          >
            <input
              ref="fileInputRef"
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              multiple
              class="hidden"
              @change="onFileSelect"
            />
            <div class="text-xs text-text-secondary mb-1">
              {{ pendingFiles.length >= MAX_QUEUE ? `已达上限 ${MAX_QUEUE} 张` : '点击或拖入图片' }}
            </div>
            <div v-if="pendingFiles.length < MAX_QUEUE" class="text-[10px] text-text-tertiary">
              支持 PNG / JPG / JPEG / WEBP
            </div>
          </div>

          <button
            class="btn-secondary w-full !text-xs"
            :disabled="pendingFiles.length >= MAX_QUEUE"
            @click="showGalleryPicker = true"
          >从图库选择</button>

          <div v-if="overflowMessage" class="text-[11px] text-warn">{{ overflowMessage }}</div>

          <div v-if="pendingFiles.length" class="space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="text-xs text-text-secondary">待处理</span>
              <button
                class="text-[10px] text-text-tertiary hover:text-error transition-colors"
                @click="pendingFiles = []"
                title="移除所有待处理图片"
              >清空</button>
            </div>
            <div class="grid grid-cols-3 gap-2">
              <div
                v-for="(f, i) in pendingFiles"
                :key="f.path + i"
                class="relative aspect-square rounded border border-surface-3 bg-surface-1 overflow-hidden group"
              >
                <img :src="filePathToUrl(f.path)" class="w-full h-full object-cover" :alt="f.name" :title="f.name" />
                <!-- 档位 + 预估价角标；分辨率超限标红提示 -->
                <div
                  class="absolute bottom-0 inset-x-0 text-white text-[9px] px-1 py-0.5 flex items-center justify-between"
                  :class="oversize(f.path) ? 'bg-error/80' : 'bg-black/55'"
                >
                  <span>{{ oversize(f.path) ? '超过 10000px' : tierLabelByMaxSide(maxSideByPath[f.path]) }}</span>
                  <span v-if="store.cloudQuota && !oversize(f.path)">{{ fmt(priceByPath(f.path)) }}</span>
                </div>
                <button
                  class="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  @click.stop="removePending(i)"
                  :title="'移除：' + f.name"
                >×</button>
              </div>
            </div>
          </div>
        </div>

        <div class="px-3 py-2.5 border-t border-surface-3 space-y-2">
          <ConsumptionEstimate
            v-if="fineEstimate.amount > 0"
            :balance-type="fineEstimate.balanceType"
            :amount="fineEstimate.amount"
          />
          <button
            class="btn-primary w-full"
            :disabled="!canRun"
            :title="runDisabledReason"
            @click="runQueue"
          >
            <span v-if="running">处理中…（{{ runProgress }}/{{ pendingFiles.length }}）</span>
            <span v-else-if="runDisabledReason">{{ runDisabledReason }}</span>
            <span v-else>开始抠图（{{ pendingFiles.length }} 张）</span>
          </button>
          <button v-if="running" class="btn-secondary w-full !text-xs" @click="cancelRun">
            取消（已开始的会跑完）
          </button>
        </div>
      </aside>
    </div>

    <GalleryPicker
      v-model:visible="showGalleryPicker"
      :multiple="true"
      @select="onGalleryPickPaths"
    />

    <ImageLightbox
      :src="lightboxSrc"
      :ref-images="lightboxRefImages"
      :on-copy="lightboxCopy"
      :on-locate="lightboxLocate"
      @close="closeLightbox"
    />
    <LowBalanceModal
      v-model:visible="lowBalanceOpen"
      :balance-type="lowBalanceState.balanceType"
      :required="lowBalanceState.required"
      :available="lowBalanceState.available"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useFineMattingStore, type FineMattingTaskRow } from '@/stores/fine-matting'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useHandoffStore } from '@/stores/handoff'
import { useSiteConfigStore } from '@/stores/site-config'
import GalleryPicker from '@/components/GalleryPicker.vue'
import ImageLightbox from '@/components/ImageLightbox.vue'
import ConsumptionEstimate from '@/components/ConsumptionEstimate.vue'
import LowBalanceModal from '@/components/LowBalanceModal.vue'
import { friendlyMattingError } from '@/utils/matting-error'

const store = useFineMattingStore()
const cloudAuth = useCloudAuthStore()
const siteConfig = useSiteConfigStore()
const router = useRouter()
const handoff = useHandoffStore()
const creditLabel = computed(() => siteConfig.labelOf('credit'))
const lowBalanceOpen = ref(false)
const lowBalanceState = ref({ balanceType: 'credit', required: 0, available: 0 })

/** 单次提交上限：精细抠图全站并发 5 / 单用户并发 3，会自然序列化，这里只约束 UI 堆过峰。 */
const MAX_QUEUE = 30
/** 抠抠图分辨率上限（长边像素），与后端 config 一致；前端预检避免无效往返 */
const MAX_RESOLUTION = 10000

// 云端服务状态提示条：服务未启用 / 未开通时提示
const serviceBanner = computed<string>(() => {
  const q = store.cloudQuota
  if (!q) return ''
  if (q.fine_matting_enabled === false) return '精细抠图服务当前未启用，暂时无法使用'
  if (q.allow_fine_matting === false) return '当前账号未开通精细抠图功能'
  return ''
})

function fmt(n: number | undefined | null): string {
  return Number(n || 0).toFixed(4).replace(/\.?0+$/, '') || '0'
}

// ----- 拖拽 / 文件选择 -----
const fileInputRef = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)
const pendingFiles = ref<{ name: string; path: string }[]>([])
const overflowMessage = ref('')
/** path -> 长边像素（异步 probe 填充），用于按尺寸预估档位/价格 */
const maxSideByPath = reactive<Record<string, number>>({})

function basename(p: string): string {
  if (!p) return ''
  const m = /[/\\]([^/\\]+)$/.exec(p)
  return m ? m[1] : p
}

function filePathToUrl(p: string): string {
  if (!p) return ''
  if (p.startsWith('data:') || p.startsWith('http')) return p
  const isAbsolute = /^[A-Za-z]:|^\//.test(p)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://img?' + param + '=' + encodeURIComponent(p)
}

/** 用 Image 加载读 naturalWidth/Height 取长边；失败返回 0（按最低档兜底预估）。 */
function probeMaxSide(path: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(Math.max(img.naturalWidth || 0, img.naturalHeight || 0))
    img.onerror = () => resolve(0)
    img.src = filePathToUrl(path)
  })
}

function addPending(items: { name: string; path: string }[]) {
  const existing = new Set(pendingFiles.value.map((f) => f.path))
  let droppedDup = 0
  let droppedFull = 0
  const added: string[] = []
  for (const it of items) {
    if (!it.path) continue
    if (existing.has(it.path)) { droppedDup++; continue }
    if (pendingFiles.value.length >= MAX_QUEUE) { droppedFull++; continue }
    pendingFiles.value.push(it)
    existing.add(it.path)
    added.push(it.path)
  }
  // 异步测量新增图片的长边尺寸
  for (const p of added) {
    if (maxSideByPath[p] === undefined) {
      probeMaxSide(p).then((ms) => { maxSideByPath[p] = ms })
    }
  }
  if (droppedFull > 0) {
    overflowMessage.value = `单次最多 ${MAX_QUEUE} 张，已忽略 ${droppedFull} 张。`
  } else if (droppedDup > 0) {
    overflowMessage.value = `已忽略 ${droppedDup} 张重复图片。`
  } else {
    overflowMessage.value = ''
  }
  if (overflowMessage.value) {
    const msg = overflowMessage.value
    setTimeout(() => { if (overflowMessage.value === msg) overflowMessage.value = '' }, 4000)
  }
}

function removePending(i: number) {
  pendingFiles.value.splice(i, 1)
}

function onFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files) return
  const items: { name: string; path: string }[] = []
  for (const f of Array.from(input.files)) {
    const p = (f as any).path as string
    if (p) items.push({ name: f.name, path: p })
  }
  addPending(items)
  input.value = ''
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  if (!e.dataTransfer?.files) return
  const items: { name: string; path: string }[] = []
  for (const f of Array.from(e.dataTransfer.files)) {
    const p = (f as any).path as string
    if (p) items.push({ name: f.name, path: p })
  }
  addPending(items)
}

const showGalleryPicker = ref(false)
function onGalleryPickPaths(paths: string[]) {
  addPending(paths.map((p) => ({ name: basename(p), path: p })))
  showGalleryPicker.value = false
}

// ----- 三档定价 -----
function tierOfMaxSide(maxSide: number): number {
  const q = store.cloudQuota
  const t1 = q?.tier_threshold_1 || 4096
  const t2 = q?.tier_threshold_2 || 7680
  if (!maxSide || maxSide <= 0) return 0
  if (maxSide < t1) return 1
  if (maxSide < t2) return 2
  return 3
}

function priceByTier(tier: number): number {
  const q = store.cloudQuota
  if (!q) return 0
  if (tier === 1) return Number(q.tier1_credit || 0)
  if (tier === 2) return Number(q.tier2_credit || 0)
  if (tier === 3) return Number(q.tier3_credit || 0)
  return Number(q.tier1_credit || 0) // 尺寸未知时按最低档预估
}

function priceByPath(path: string): number {
  const ms = maxSideByPath[path] ?? 0
  return priceByTier(tierOfMaxSide(ms) || 1)
}

/** 该图长边是否超过抠抠图分辨率上限（前端预检） */
function oversize(path: string): boolean {
  return (maxSideByPath[path] ?? 0) > MAX_RESOLUTION
}

function tierLabelByTier(tier: number): string {
  return ({ 1: '4K 以下', 2: '4K-8K', 3: '8K 以上' } as Record<number, string>)[tier] || ''
}

function tierLabelByMaxSide(maxSide: number | undefined): string {
  if (maxSide === undefined) return '测量中'
  const t = tierOfMaxSide(maxSide)
  return t ? tierLabelByTier(t) : '测量中'
}

// ----- 队列执行 -----
const running = ref(false)
const runProgress = ref(0)
const canceled = ref(false)
const fineEstimate = computed(() => {
  let amount = 0
  for (const f of pendingFiles.value) {
    amount += priceByPath(f.path)
  }
  return { balanceType: 'credit', amount }
})

const runDisabledReason = computed<string>(() => {
  if (running.value) return '任务进行中…'
  if (!pendingFiles.value.length) return '请先选择图片'
  // 尺寸测量未完成前不允许提交，避免三档预估低估
  if (pendingFiles.value.some((f) => maxSideByPath[f.path] === undefined)) return '正在测量图片尺寸…'
  // 分辨率超限前端预检（抠抠图上限 10000px）
  if (pendingFiles.value.some((f) => oversize(f.path))) return '存在图片分辨率超过 10000px，请移除后再试'

  const q = store.cloudQuota
  if (q && q.fine_matting_enabled === false) return '精细抠图服务暂未启用，请稍后再试'
  if (q && q.allow_fine_matting === false) return '当前账号未开通精细抠图'
  if (q && q.fine_matting_quota_per_month > 0 && q.used_this_month >= q.fine_matting_quota_per_month) {
    return `本月配额已用完（${q.used_this_month} / ${q.fine_matting_quota_per_month}）`
  }
  return ''
})
const canRun = computed(() => !runDisabledReason.value)

async function runQueue() {
  if (!canRun.value) return
  if (fineEstimate.value.amount > 0) {
    const available = Number(store.cloudQuota?.current_credit_balance
      ?? cloudAuth.quotas?.balances?.credit?.total
      ?? cloudAuth.balances.find((b) => b.type === 'credit')?.amount
      ?? 0)
    if (available + 0.000001 < fineEstimate.value.amount) {
      lowBalanceState.value = {
        balanceType: 'credit',
        required: fineEstimate.value.amount,
        available,
      }
      lowBalanceOpen.value = true
      return
    }
  }
  running.value = true
  runProgress.value = 0
  canceled.value = false
  const queue = pendingFiles.value.slice()
  let failedCount = 0

  for (let i = 0; i < queue.length; i++) {
    if (canceled.value) break
    runProgress.value = i + 1
    const f = queue[i]
    try {
      const r = await store.segment({ localPath: f.path, addToGallery: true })
      if (r?.status === 'failed') failedCount++
    } catch (e) {
      failedCount++
      console.warn('[FineMatting] task failed:', f.path, e)
    }
  }

  pendingFiles.value = []
  running.value = false
  store.fetchCloudQuota()
  cloudAuth.refreshBalancesThrottled().catch(() => {})
  if (failedCount > 0) {
    overflowMessage.value = `${failedCount} 张处理失败，可在左侧队列查看原因`
    const msg = overflowMessage.value
    setTimeout(() => { if (overflowMessage.value === msg) overflowMessage.value = '' }, 5000)
  }
}

function cancelRun() { canceled.value = true }
function clearAll() {
  for (const t of [...store.tasks]) store.removeTask(t.id)
}

// ----- 选中任务 + 预览 -----
const selectedTaskId = ref<string>('')
const compareRatio = ref(50)
const comparePreviewRef = ref<HTMLElement | null>(null)
const suppressNextPreviewClick = ref(false)
const currentTask = computed<FineMattingTaskRow | null>(() =>
  store.tasks.find((t) => t.id === selectedTaskId.value) || store.tasks[0] || null,
)
watch(() => store.tasks.length, () => {
  if (!selectedTaskId.value && store.tasks.length) {
    selectedTaskId.value = store.tasks[0].id
  }
})

const currentSourcePreviewUrl = computed(() => {
  if (!currentTask.value) return ''
  return filePathToUrl(currentTask.value.sourcePath)
})

const resultFileUrl = computed(() => {
  if (!currentTask.value?.resultPath) return ''
  return filePathToUrl(currentTask.value.resultPath)
})

function updateCompareRatioByClientX(clientX: number) {
  const el = comparePreviewRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return
  compareRatio.value = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100))
}

function startCompareDrag(e: MouseEvent) {
  suppressNextPreviewClick.value = true
  updateCompareRatioByClientX(e.clientX)
  document.addEventListener('mousemove', onCompareDragMove)
  document.addEventListener('mouseup', stopCompareDrag)
}

function onCompareDragMove(e: MouseEvent) {
  updateCompareRatioByClientX(e.clientX)
}

function stopCompareDrag() {
  document.removeEventListener('mousemove', onCompareDragMove)
  document.removeEventListener('mouseup', stopCompareDrag)
  window.setTimeout(() => { suppressNextPreviewClick.value = false }, 120)
}

const lightboxSrc = ref<string | null>(null)
const lightboxPath = ref('')
const lightboxRefImages = ref<string[]>([])

function openCurrentLightbox() {
  const task = currentTask.value
  if (!task) return
  if (task.status === 'completed' && task.resultPath) {
    lightboxPath.value = task.resultPath
    lightboxSrc.value = filePathToUrl(task.resultPath)
    lightboxRefImages.value = task.sourcePath ? [filePathToUrl(task.sourcePath)] : []
    return
  }
  if (task.sourcePath) {
    lightboxPath.value = task.sourcePath
    lightboxSrc.value = filePathToUrl(task.sourcePath)
    lightboxRefImages.value = []
  }
}

function onPreviewClick() {
  if (suppressNextPreviewClick.value) {
    suppressNextPreviewClick.value = false
    return
  }
  openCurrentLightbox()
}

function closeLightbox() {
  lightboxSrc.value = null
  lightboxPath.value = ''
  lightboxRefImages.value = []
}

async function lightboxCopy() {
  if (!lightboxPath.value) return
  try { await window.api.clipboard.writeImage(lightboxPath.value) } catch (e) { console.warn(e) }
}

async function lightboxLocate() {
  if (!lightboxPath.value) return
  try { await window.api.shell.showItemInFolder(lightboxPath.value) } catch (e) { console.warn(e) }
}

function statusLabel(s: string): string {
  return ({
    pending: '排队', processing: '处理中', uploading: '上传中',
    downloading: '下载中', completed: '完成', failed: '失败',
  } as any)[s] || s
}
function statusClass(s: string): string {
  if (s === 'completed') return 'text-success'
  if (s === 'failed') return 'text-error'
  return 'text-warn'
}

// ----- 结果操作 -----
async function copyResult() {
  if (!currentTask.value?.resultPath) return
  try { await window.api.clipboard.writeImage(currentTask.value.resultPath) } catch (e) { console.warn(e) }
}
async function showResultInFolder() {
  if (!currentTask.value?.resultPath) return
  try { await window.api.shell.showItemInFolder(currentTask.value.resultPath) } catch (e) { console.warn(e) }
}
function goSlice() {
  const path = currentTask.value?.resultPath
  if (!path) return
  handoff.set('imageToolkit', { paths: [path] })
  router.push({ name: 'imageToolkitSlice' })
}
async function retryTask() {
  if (!currentTask.value) return
  addPending([{ name: basename(currentTask.value.sourcePath), path: currentTask.value.sourcePath }])
  await runQueue()
}

// ----- 进度事件监听 -----
let unsubscribeProgress: (() => void) | null = null

onMounted(async () => {
  await store.fetchCloudQuota()
  unsubscribeProgress = window.api.fineMatting.onProgress((data) => {
    if (data.phase === 'uploading' || data.phase === 'processing' || data.phase === 'downloading') {
      const t = store.tasks.find((x) => x.id === data.taskId)
      if (t && !['completed', 'failed'].includes(t.status)) {
        store.updateTask(data.taskId, { status: data.phase as any })
      }
    }
  })
})

onUnmounted(() => {
  if (unsubscribeProgress) unsubscribeProgress()
  stopCompareDrag()
})
</script>

<style scoped>
.checkerboard {
  background-image:
    linear-gradient(45deg, #eee 25%, transparent 25%, transparent 75%, #eee 75%, #eee),
    linear-gradient(45deg, #eee 25%, #fff 25%, #fff 75%, #eee 75%, #eee);
  background-size: 16px 16px;
  background-position: 0 0, 8px 8px;
}
:global(.dark) .checkerboard {
  background-image:
    linear-gradient(45deg, #333 25%, transparent 25%, transparent 75%, #333 75%, #333),
    linear-gradient(45deg, #333 25%, #1f1f1f 25%, #1f1f1f 75%, #333 75%, #333);
}
</style>
