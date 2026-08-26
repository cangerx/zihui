<template>
  <div class="h-full flex flex-col">
    <!-- 顶部说明栏：只保留用户关心的两条信息：计费规则（按用户实际） + 并发上限 -->
    <header class="page-header items-start gap-4 !py-3">
      <div class="flex-1 min-w-0">
        <p class="page-desc">
          一键去除背景，输出透明 PNG。
          <span v-if="store.cloudQuota" class="ml-2">
            按 <strong class="text-text-primary">{{ Number(store.cloudQuota.credit_per_call).toFixed(4) }}</strong> {{ creditLabel }} / 张计费，最多并发 <strong class="text-text-primary">3</strong> 张（一次最多提交 {{ MAX_QUEUE }} 张）。
          </span>
          <span v-else class="ml-2">最多并发 <strong class="text-text-primary">3</strong> 张（一次最多提交 {{ MAX_QUEUE }} 张）。</span>
        </p>
      </div>
    </header>

    <!-- 服务状态条：云端服务未启用 / 未开通时提示（自定义接口模式不展示） -->
    <div v-if="serviceBanner" class="px-4 py-2 text-xs text-warn bg-warn/10 border-b border-surface-3">
      {{ serviceBanner }}
    </div>

    <!-- 主体三栏：三栏贴合、无间距、以竖线分隔；中间区以 1fr 自然完占剩余宽 -->
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
            <div v-if="t.error" class="text-[10px] text-error mt-1 line-clamp-2" :title="t.error">
              {{ friendlyMattingError(t.error) }}
            </div>
          </div>
        </div>
      </aside>

      <!-- 中：预览区（随窗口变宽，抠图结果看得更清楚） -->
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
              <img
                :src="resultFileUrl"
                class="absolute inset-0 w-full h-full object-contain"
                alt="结果"
              />
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
            >
              原图
            </div>
            <div
              v-if="currentTask.status === 'completed' && currentTask.resultPath"
              class="absolute top-2 right-2 px-2 py-1 rounded bg-surface-0/90 border border-surface-3 text-[10px] text-text-secondary shadow-sm"
            >
              结果
            </div>
            <div
              v-else-if="currentTask.error"
              class="absolute inset-0 flex items-center justify-center text-xs text-error px-6 text-center bg-surface-0/80"
              :title="currentTask.error"
            >
              {{ friendlyMattingError(currentTask.error) }}
            </div>
            <div
              v-else
              class="absolute inset-0 flex items-center justify-center text-xs text-text-tertiary bg-surface-0/60"
            >
              处理中…
            </div>
          </div>
        </div>

        <!-- 结果操作按钮（移除请求 ID 等接口侧细节，用户不需关心） -->
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

      <!-- 右：输入与设置（不加右边框，贴到全屏右边） -->
      <aside class="flex flex-col bg-surface-0 min-h-0 overflow-hidden">
        <div class="px-3 py-2.5 border-b border-surface-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold">添加任务</h2>
          <span class="text-[10px] text-text-tertiary">{{ pendingFiles.length }} / {{ MAX_QUEUE }}</span>
        </div>
        <div class="flex-1 overflow-y-auto p-3 space-y-3">
          <!-- 上传区（拖拽 + 多选）：达上限时禁用 + 文案变化 -->
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
              accept=".png,.jpg,.jpeg,.bmp"
              multiple
              class="hidden"
              @change="onFileSelect"
            />
            <div class="text-xs text-text-secondary mb-1">
              {{ pendingFiles.length >= MAX_QUEUE ? `已达上限 ${MAX_QUEUE} 张` : '点击或拖入图片' }}
            </div>
            <div v-if="pendingFiles.length < MAX_QUEUE" class="text-[10px] text-text-tertiary">
              支持 PNG / JPG / JPEG / BMP
            </div>
          </div>

          <!-- 从图库选：达上限时禁用 -->
          <button
            class="btn-secondary w-full !text-xs"
            :disabled="pendingFiles.length >= MAX_QUEUE"
            @click="showGalleryPicker = true"
          >
            从图库选择
          </button>

          <!-- 超额 / 重复提示（4s 自消失） -->
          <div v-if="overflowMessage" class="text-[11px] text-warn">{{ overflowMessage }}</div>

          <!-- 待处理图片：缩略图网格 + 移除按钮 + 一键清空 -->
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
                <img
                  :src="filePathToUrl(f.path)"
                  class="w-full h-full object-cover"
                  :alt="f.name"
                  :title="f.name"
                />
                <button
                  class="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  @click.stop="pendingFiles.splice(i, 1)"
                  :title="'移除：' + f.name"
                >×</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部按钮：禁用时 hover 显示原因 tooltip -->
        <div class="px-3 py-2.5 border-t border-surface-3 space-y-2">
          <ConsumptionEstimate
            v-if="mattingEstimate.amount > 0"
            :balance-type="mattingEstimate.balanceType"
            :amount="mattingEstimate.amount"
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
          <button
            v-if="running"
            class="btn-secondary w-full !text-xs"
            @click="cancelRun"
          >
            取消（已开始的会跑完）
          </button>
        </div>
      </aside>
    </div>

    <!-- 图库选择弹窗：直用 GalleryPicker，避免 ImageSourcePickerDialog 里重复出现「本地选」 -->
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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMattingStore, type MattingTaskRow } from '@/stores/matting'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useHandoffStore } from '@/stores/handoff'
import { useSiteConfigStore } from '@/stores/site-config'
import GalleryPicker from '@/components/GalleryPicker.vue'
import ImageLightbox from '@/components/ImageLightbox.vue'
import ConsumptionEstimate from '@/components/ConsumptionEstimate.vue'
import LowBalanceModal from '@/components/LowBalanceModal.vue'
import { friendlyMattingError } from '@/utils/matting-error'

const store = useMattingStore()
const cloudAuth = useCloudAuthStore()
const siteConfig = useSiteConfigStore()
const router = useRouter()
const handoff = useHandoffStore()
const creditLabel = computed(() => siteConfig.labelOf('credit'))
const lowBalanceOpen = ref(false)
const lowBalanceState = ref({ balanceType: 'credit', required: 0, available: 0 })

/**
 * 单次提交上限：60 张 = 单用户并发 3 × 约 20 轮。
 * 服务端并发 3 / QPS 5 会自然序列化执行，这里只约束 UI 堆过峰。
 */
const MAX_QUEUE = 60

// 接口来源自动决策（用户不需要感知）：
//   1. 套餐授权了「自定义抠图接口」+ 本地配置了默认接口 → 直连阿里（不扣云接口积分）
//   2. 否则 → 走云接口
// 用户在「模型服务 → 抠图接口」加默认接口后自动切到直连，无需在 UI 上手动切换。
const mode = computed<'cloud' | 'custom'>(() => {
  const allowCustom = cloudAuth.permissions.allow_custom_matting_provider
  if (allowCustom && store.defaultProvider) return 'custom'
  return 'cloud'
})

// 云端服务状态提示条：仅云接口模式下，服务未启用 / 未开通时提示
const serviceBanner = computed<string>(() => {
  const q = store.cloudQuota
  if (!q || mode.value === 'custom') return ''
  if (q.matting_enabled === false) return '云端抠图服务当前未启用，暂时无法使用'
  if (q.allow_image_matting === false) return '当前账号未开通 AI 抠图功能'
  return ''
})

// ----- 拖拽 / 文件选择 -----
const fileInputRef = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)
const pendingFiles = ref<{ name: string; path: string }[]>([])
/** 4 秒后自动消失的轻提示：超过 9 张或重复添加时显示 */
const overflowMessage = ref('')

function basename(p: string): string {
  if (!p) return ''
  const m = /[/\\]([^/\\]+)$/.exec(p)
  return m ? m[1] : p
}

/**
 * 把路径转成缩略图可读的 URL。
 * Electron 默认 CSP + webSecurity 会拦 file:///，项目有自定义 local-file:// 协议（主进程读着返回），
 * 与 ImageResultNode / Img2ImgNode 等使用方式一致。
 */
function filePathToUrl(p: string): string {
  if (!p) return ''
  if (p.startsWith('data:') || p.startsWith('http')) return p
  const isAbsolute = /^[A-Za-z]:|^\//.test(p)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://img?' + param + '=' + encodeURIComponent(p)
}

/**
 * 把候选项加入队列；超出 MAX_QUEUE 的部分被丢弃，重复路径自动去重，
 * 两种情况都会在 UI 显示 4s 轻提示。
 */
function addPending(items: { name: string; path: string }[]) {
  const existing = new Set(pendingFiles.value.map((f) => f.path))
  let droppedDup = 0
  let droppedFull = 0
  for (const it of items) {
    if (!it.path) continue
    if (existing.has(it.path)) { droppedDup++; continue }
    if (pendingFiles.value.length >= MAX_QUEUE) { droppedFull++; continue }
    pendingFiles.value.push(it)
    existing.add(it.path)
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

// ----- 队列执行 -----
const running = ref(false)
const runProgress = ref(0)
const canceled = ref(false)
const mattingEstimate = computed(() => {
  if (mode.value !== 'cloud') return { balanceType: 'credit', amount: 0 }
  return {
    balanceType: 'credit',
    amount: Number(store.cloudQuota?.credit_per_call || 0) * pendingFiles.value.length,
  }
})

/**
 * 返回不能开始抠图的原因。空字符串 = 可以开始。
 * 优先级：运行中 > 未选图 > 接口不可用 / 抠图未开通 > 月配额超限
 * 只在云接口模式下才检查余额 / 配额；自定义接口走阿里账单，与我们的积分无关。
 */
const runDisabledReason = computed<string>(() => {
  if (running.value) return '任务进行中…'
  if (!pendingFiles.value.length) return '请先选择图片'

  if (mode.value === 'custom') {
    if (!store.defaultProvider) return '未配置默认抠图接口'
    return ''
  }

  // 云接口模式：检查服务总开关 / 权限 / 配额 / 余额
  const q = store.cloudQuota
  if (q && q.matting_enabled === false) return '抠图服务暂未启用，请稍后再试'
  if (q && q.allow_image_matting === false) return '当前账号未开通 AI 抠图'

  if (q && q.image_matting_quota_per_month > 0 && q.used_this_month >= q.image_matting_quota_per_month) {
    return `本月配额已用完（${q.used_this_month} / ${q.image_matting_quota_per_month}）`
  }
  // q 为 null 时不阐拦——可能是未登录 / 服务端未配计费规则，让用户试一下看实际报错。
  return ''
})
const canRun = computed(() => !runDisabledReason.value)

async function runQueue() {
  if (!canRun.value) return
  if (mattingEstimate.value.amount > 0) {
    const available = Number(store.cloudQuota?.current_credit_balance
      ?? cloudAuth.quotas?.balances?.credit?.total
      ?? cloudAuth.balances.find((b) => b.type === 'credit')?.amount
      ?? 0)
    if (available + 0.000001 < mattingEstimate.value.amount) {
      lowBalanceState.value = {
        balanceType: 'credit',
        required: mattingEstimate.value.amount,
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
      const r = await store.segment({
        localPath: f.path,
        source:    mode.value,
        providerId: mode.value === 'custom' ? store.defaultProvider?.id : undefined,
        addToGallery: true,
      })
      if (r?.status === 'failed') failedCount++
    } catch (e) {
      // 单条失败不打断队列，错误已记到 task.error
      failedCount++
      console.warn('[Matting] task failed:', f.path, e)
    }
  }

  pendingFiles.value = []
  running.value = false
  if (failedCount > 0) {
    overflowMessage.value = `${failedCount} 张处理失败，可在左侧队列查看原因`
    const msg = overflowMessage.value
    setTimeout(() => { if (overflowMessage.value === msg) overflowMessage.value = '' }, 5000)
  }
  // 拉一下配额（云接口模式才有变化）
  if (mode.value === 'cloud') {
    store.fetchCloudQuota()
    cloudAuth.refreshBalancesThrottled().catch(() => {})
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
const currentTask = computed<MattingTaskRow | null>(() =>
  store.tasks.find((t) => t.id === selectedTaskId.value) || store.tasks[0] || null,
)
// 自动选中最新一个完成的任务
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
  window.setTimeout(() => {
    suppressNextPreviewClick.value = false
  }, 120)
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
  try {
    await window.api.clipboard.writeImage(lightboxPath.value)
  } catch (e) { console.warn(e) }
}

async function lightboxLocate() {
  if (!lightboxPath.value) return
  try {
    await window.api.shell.showItemInFolder(lightboxPath.value)
  } catch (e) { console.warn(e) }
}

function statusLabel(s: string): string {
  return ({
    pending:     '排队',
    processing:  '处理中',
    uploading:   '上传中',
    downloading: '下载中',
    completed:   '完成',
    failed:      '失败',
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
  try {
    await window.api.clipboard.writeImage(currentTask.value.resultPath)
  } catch (e) { console.warn(e) }
}
async function showResultInFolder() {
  if (!currentTask.value?.resultPath) return
  try {
    await window.api.shell.showItemInFolder(currentTask.value.resultPath)
  } catch (e) { console.warn(e) }
}
function goSlice() {
  const path = currentTask.value?.resultPath
  if (!path) return
  handoff.set('imageToolkit', { paths: [path] })
  router.push({ name: 'imageToolkitSlice' })
}
async function retryTask() {
  if (!currentTask.value) return
  addPending([{
    name: basename(currentTask.value.sourcePath),
    path: currentTask.value.sourcePath,
  }])
  await runQueue()
}

// ----- 进度事件监听 -----
let unsubscribeProgress: (() => void) | null = null

onMounted(async () => {
  await Promise.all([store.loadProviders(), store.fetchCloudQuota()])

  unsubscribeProgress = window.api.matting.onProgress((data) => {
    // 进度信号目前仅用于更细粒度的 status 显示（队列里的 placeholder 已经有 status）
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
