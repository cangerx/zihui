<template>
  <div class="h-full flex flex-col bg-surface-1">
    <header class="h-12 flex items-center justify-between px-4 bg-surface-0 border-b border-surface-3 flex-shrink-0">
      <div class="flex items-center gap-3">
        <button @click="goBack" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors" title="返回">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
        </button>
        <span class="text-sm font-medium text-text-primary">去AI标记</span>
        <span class="text-[11px] text-text-tertiary">{{ images.length }} 张</span>
      </div>
      <div class="flex items-center gap-1.5">
        <button @click="addMore" class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors">添加图片</button>
        <button
          @click="runRemoval"
          :disabled="!canRun"
          class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50"
        >{{ processing ? `处理中 ${processedCount}/${images.length}` : '去除标记' }}</button>
      </div>
    </header>

    <!-- 常驻风险提示 -->
    <div class="px-4 py-2 bg-amber-50 dark:bg-amber-900/15 border-b border-amber-200/60 dark:border-amber-800/40 text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed flex-shrink-0">
      本功能清除图片的元数据与溯源标识（C2PA / EXIF / XMP / 中国 AIGC 标签等），不修改画面像素。处理会直接修改所选图片文件；部分地区对去除 AI 生成标识有法律限制，请自行合规使用。
    </div>

    <!-- 未授权使用：入口可见（由全局开关控制），但当前账号无使用权限，提示开通 -->
    <div v-if="!canUse" class="px-4 py-2 bg-surface-2 border-b border-surface-3 text-[11px] text-text-secondary leading-relaxed flex-shrink-0">
      当前账号未开通「去AI标记」的使用权限，可先浏览下方支持范围说明；如需使用，请联系管理员在云控端为你的账号或所在分组开通。
    </div>

    <div class="flex flex-1 overflow-hidden min-h-0">
      <!-- Left: 支持范围说明（诚实三档） -->
      <div class="w-64 bg-surface-0 border-r border-surface-3 overflow-y-auto p-3 space-y-4 flex-shrink-0">
        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">支持去除标记的 AI 模型</h4>
          <p class="text-[10px] text-text-tertiary leading-relaxed mb-2">以下 AI 模型生图内嵌的标记，本工具均可清除：</p>
          <div v-for="tier in TIERS" :key="tier.title" class="mb-3">
            <div class="flex items-center gap-1.5 mb-1">
              <span :class="['inline-block w-1.5 h-1.5 rounded-full', tier.dot]"></span>
              <span class="text-[11px] font-medium text-text-secondary">{{ tier.title }}</span>
            </div>
            <p class="text-[10px] text-text-tertiary leading-relaxed">{{ tier.desc }}</p>
            <p class="text-[10px] text-text-primary/80 leading-relaxed mt-0.5">{{ tier.models }}</p>
          </div>
        </div>
      </div>

      <!-- Center: 缩略图 + 每图检测结果 -->
      <div class="flex-1 overflow-y-auto p-4">
        <div v-if="images.length === 0" class="text-center text-text-tertiary text-xs py-12">
          请添加图片，工具会自动检测其中的 AI 标记
        </div>
        <div v-else class="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          <div
            v-for="(img, i) in images"
            :key="img.path"
            class="bg-surface-0 border border-surface-3 rounded-lg overflow-hidden"
          >
            <div class="aspect-square bg-surface-2 relative">
              <img :src="img.dataUri" class="w-full h-full object-contain" />
              <div v-if="img.processed" class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-primary-600 text-white text-[10px] leading-none">已处理</div>
              <button @click="removeImage(i)" class="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-red-500 transition-colors">
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div class="p-2 text-[11px] space-y-1">
              <div class="text-text-primary truncate font-medium" :title="img.name">{{ img.name }}</div>
              <div v-if="img.scanning" class="text-text-tertiary">检测中…</div>
              <template v-else-if="img.processed">
                <div class="text-emerald-600">已清除 {{ img.markLabels.length }} 项标记</div>
              </template>
              <template v-else-if="img.markLabels.length">
                <div class="text-text-tertiary">检测到标记：</div>
                <div class="flex flex-wrap gap-1">
                  <span v-for="m in img.markLabels" :key="m" class="px-1 py-0.5 rounded bg-surface-2 text-text-secondary text-[10px] leading-none">{{ m }}</span>
                </div>
                <div v-if="img.vendors.length" class="text-text-tertiary text-[10px]">疑似来源：{{ img.vendors.join('、') }}</div>
              </template>
              <div v-else class="text-text-tertiary">未检测到可清除的标记</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ImageSourcePickerDialog v-model:visible="pickerVisible" :multiple="true" @select="onAddImages" />

    <!-- 首次使用须知：只加阴影、不加背景遮罩 -->
    <div v-if="showNotice" class="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div class="pointer-events-auto w-[420px] max-w-[90vw] bg-surface-0 rounded-xl shadow-2xl border border-surface-3 p-5">
        <div class="text-sm font-medium text-text-primary mb-2">使用须知</div>
        <div class="text-xs text-text-secondary leading-relaxed space-y-2">
          <p>本功能清除图片的元数据与溯源标识（C2PA 内容凭证、EXIF / XMP、PNG 文本块、中国 AIGC 隐式标识等），不改变画面像素，按次计费。</p>
          <p>请仅处理你拥有合法权利的图片，并遵守所在地区法律法规与平台规则。</p>
        </div>
        <div class="flex justify-end mt-4">
          <button @click="dismissNotice" class="px-4 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors">我已知晓</button>
        </div>
      </div>
    </div>

    <div v-if="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-surface-0 shadow-lg border border-surface-3 text-xs text-text-primary">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useHandoffStore } from '@/stores/handoff'
import ImageSourcePickerDialog from '@/components/ImageSourcePickerDialog.vue'
import { loadAsDataUri, type LoadedImage } from '@/utils/image-source'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useSiteConfigStore } from '@/stores/site-config'

interface MarkItem extends LoadedImage {
  scanning: boolean
  processed: boolean
  markTypes: string[]
  markLabels: string[]
  vendors: string[]
}

interface ScanResult {
  path: string
  markTypes: string[]
  markLabels: string[]
  vendors: string[]
  hasAny: boolean
}
interface ProcessResult extends ScanResult {
  removed: boolean
  error?: string
}

const router = useRouter()
const handoff = useHandoffStore()
const cloudAuth = useCloudAuthStore()
const siteConfig = useSiteConfigStore()

const images = ref<MarkItem[]>([])
const processing = ref(false)
const processedCount = ref(0)
const toast = ref('')
const pickerVisible = ref(false)
const NOTICE_KEY = 'ai_mark_removal_notice_v1'
const showNotice = ref(false)

// 能否使用：系统设置「全局可用」开 → 所有人可用；否则需被授权 allow_ai_mark_removal
const canUse = computed(() => Boolean(siteConfig.features?.aiMarkRemovalUseAll) || Boolean((cloudAuth.permissions as any)?.allow_ai_mark_removal))
const canRun = computed(() => canUse.value && images.value.length > 0 && !processing.value && images.value.some((i) => !i.processed && i.markLabels.length > 0))

const TIERS = [
  {
    title: '支持去除标记的模型',
    dot: 'bg-emerald-500',
    desc: '清除写在文件里的元数据与溯源标识（C2PA 内容凭证 / EXIF / XMP / PNG 生成参数 / 中国 AIGC 标签等）。',
    models: 'OpenAI、Adobe Firefly、微软 Bing/Designer、三星 Galaxy AI、xAI Grok、Ideogram、Recraft、Canva、Stability、Stable Diffusion / SDXL、FLUX、Midjourney，以及豆包/即梦、可灵、通义万相、混元、文心、海螺、智谱、美图 的 AIGC 隐式标识。',
  },
]

onMounted(async () => {
  if (!localStorage.getItem(NOTICE_KEY)) showNotice.value = true
  const payload = handoff.consume<{ paths: string[] }>('imageToolkit')
  if (payload?.paths?.length) await loadPaths(payload.paths)
})

function dismissNotice() {
  localStorage.setItem(NOTICE_KEY, '1')
  showNotice.value = false
}

async function loadPaths(paths: string[]) {
  // 预览用原图，不压缩不重编码
  const items = await loadAsDataUri(paths, { maxSize: 4096, quality: 1 })
  const start = images.value.length
  for (const it of items) {
    images.value.push({ ...it, scanning: true, processed: false, markTypes: [], markLabels: [], vendors: [] })
  }
  await scanRange(start, paths)
}

// 逐张扫描命中的标记（不修改文件）
async function scanRange(startIndex: number, paths: string[]) {
  try {
    const results = (await window.api.aiMarkRemoval.invoke('scan', paths)) as ScanResult[]
    const byPath = new Map(results.map((r) => [r.path, r]))
    for (let i = startIndex; i < images.value.length; i++) {
      const img = images.value[i]
      const r = byPath.get(img.path)
      img.scanning = false
      if (r) {
        img.markTypes = r.markTypes
        img.markLabels = r.markLabels
        img.vendors = r.vendors
      }
    }
  } catch (e: any) {
    for (let i = startIndex; i < images.value.length; i++) images.value[i].scanning = false
    showToast('检测失败：' + (e?.message || ''))
  }
}

function addMore() { pickerVisible.value = true }
async function onAddImages(paths: string[]) {
  if (paths.length) await loadPaths(paths)
}
function removeImage(idx: number) { images.value.splice(idx, 1) }

function newRequestId(): string {
  try { return crypto.randomUUID() } catch { return 'aimark-' + Date.now() + '-' + Math.random().toString(16).slice(2) }
}

async function runRemoval() {
  if (!canRun.value) return
  processing.value = true
  processedCount.value = 0
  // 只处理「检测到标记且未处理」的图
  const targets = images.value.filter((i) => !i.processed && i.markLabels.length > 0)
  const paths = targets.map((i) => i.path)
  try {
    const results = (await window.api.aiMarkRemoval.invoke('process', paths)) as ProcessResult[]
    const byPath = new Map(results.map((r) => [r.path, r]))
    const removedMarks = new Set<string>()
    let removedCount = 0
    for (const img of targets) {
      const r = byPath.get(img.path)
      processedCount.value++
      if (r?.removed) {
        img.processed = true
        img.markTypes = r.markTypes
        img.markLabels = r.markLabels
        r.markTypes.forEach((m) => removedMarks.add(m))
        removedCount++
      }
    }
    if (removedCount === 0) {
      showToast('未发现可清除的标记')
      return
    }
    // 处理成功后按次扣费（request_id 幂等）
    try {
      const res = (await window.api.aiMarkRemoval.invoke('charge', {
        request_id: newRequestId(),
        marks: Array.from(removedMarks).join(','),
        image_count: removedCount,
      })) as { cost?: number }
      const cost = Number(res?.cost || 0)
      showToast(cost > 0 ? `已清除 ${removedCount} 张图片的标记，扣费 ${cost} 积分` : `已清除 ${removedCount} 张图片的标记`)
      try { (cloudAuth as any).refreshBalancesThrottled?.() } catch { /* 忽略余额刷新失败 */ }
    } catch (e: any) {
      // 已完成本地清除，但计费失败（余额不足/未开通/网络）——如实告知，不阻断结果
      showToast('已清除标记，但计费失败：' + (e?.message || '请稍后重试'))
    }
  } catch (e: any) {
    showToast('处理失败：' + (e?.message || ''))
  } finally {
    processing.value = false
  }
}

function goBack() { router.back() }
function showToast(t: string) {
  toast.value = t
  setTimeout(() => { if (toast.value === t) toast.value = '' }, 2800)
}
</script>
