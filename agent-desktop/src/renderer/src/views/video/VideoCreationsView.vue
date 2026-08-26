<template>
  <div class="h-full flex flex-col">
    <header class="page-header">
      <div>
        <p class="text-xs text-text-tertiary">记录提示词、参考素材、生成参数和本地保存状态。</p>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn-secondary text-xs" @click="goCreate">创建视频</button>
        <button class="btn-secondary text-xs" :disabled="loading" @click="reload">刷新</button>
      </div>
    </header>

    <div class="page-body overflow-y-auto space-y-5">
      <section class="card p-4 space-y-3">
        <div class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_160px_160px] gap-3">
          <input v-model="search" class="input-field" placeholder="搜索提示词、模型或规格" @keyup.enter="reload" />
          <select v-model="statusFilter" class="input-field" @change="reload">
            <option value="">全部任务状态</option>
            <option value="pending">排队中</option>
            <option value="running">生成中</option>
            <option value="completed">已完成</option>
            <option value="failed">失败</option>
            <option value="canceled">已取消</option>
          </select>
          <select v-model="downloadFilter" class="input-field" @change="reload">
            <option value="">全部保存状态</option>
            <option value="pending">等待保存</option>
            <option value="downloading">保存中</option>
            <option value="downloaded">已保存</option>
            <option value="failed">保存失败</option>
            <option value="expired">云端已过期</option>
          </select>
        </div>
      </section>

      <section v-if="items.length" class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5 min-h-0">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 content-start">
          <article
            v-for="item in items"
            :key="item.id"
            class="card overflow-hidden cursor-pointer hover:border-primary-300 transition-colors"
            :class="selected?.id === item.id ? 'ring-2 ring-primary-400' : ''"
            @click="selectItem(item)"
          >
            <div class="aspect-video bg-black flex items-center justify-center overflow-hidden">
              <video v-if="localVideoUrl(item)" :src="localVideoUrl(item)" muted preload="metadata" class="w-full h-full object-contain"></video>
              <div v-else class="text-white/70 text-xs text-center px-4">
                <div class="font-medium">{{ statusLabel(item.status) }}</div>
                <div class="mt-2">{{ downloadStatusLabel(item.download_status) }}</div>
              </div>
            </div>
            <div class="p-4 space-y-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <h3 class="text-sm font-semibold text-text-primary truncate">{{ item.model_name || item.sku_title || 'AI 视频' }}</h3>
                  <p class="text-xs text-text-tertiary mt-1">{{ formatDate(item.created_at) }}</p>
                </div>
                <span class="shrink-0 rounded-full px-2 py-1 text-[11px]" :class="statusClass(item)">{{ statusLabel(item.status) }}</span>
              </div>
              <p class="text-xs text-text-secondary line-clamp-2 min-h-[2.5rem]">{{ item.prompt || '无提示词' }}</p>
              <div class="flex flex-wrap gap-2 text-[11px] text-text-tertiary">
                <span class="rounded bg-surface-1 border border-surface-3 px-2 py-1">{{ item.duration_seconds || '-' }} 秒</span>
                <span class="rounded bg-surface-1 border border-surface-3 px-2 py-1">{{ item.aspect_ratio || '-' }}</span>
                <span class="rounded bg-surface-1 border border-surface-3 px-2 py-1">{{ item.resolution || item.quality || '-' }}</span>
                <span class="rounded bg-surface-1 border border-surface-3 px-2 py-1">{{ downloadStatusLabel(item.download_status) }}</span>
              </div>
            </div>
          </article>
        </div>

        <aside class="card p-5 h-fit sticky top-0">
          <template v-if="selected">
            <div class="space-y-4">
              <div class="rounded-xl bg-black overflow-hidden aspect-video flex items-center justify-center">
                <video v-if="selectedVideoUrl" :key="selectedVideoUrl" :src="selectedVideoUrl" controls class="w-full h-full object-contain" @error="previewError = '视频预览失败，请打开所在目录查看文件。'"></video>
                <div v-else class="text-xs text-white/70 text-center px-4">{{ selected.status === 'completed' ? '视频尚未保存到本地' : statusLabel(selected.status) }}</div>
              </div>

              <div v-if="selectedNotice" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:border-amber-700/40 dark:text-amber-300">{{ selectedNotice }}</div>
              <div v-if="previewError" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">{{ previewError }}</div>
              <div v-if="selected.download_error" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">{{ selected.download_error }}</div>

              <div class="grid grid-cols-2 gap-2">
                <button v-if="canSave(selected)" class="btn-primary text-xs" :disabled="savingId === selected.id" @click="saveSelected">{{ savingId === selected.id ? '保存中...' : '保存视频' }}</button>
                <button v-if="selected.local_exists" class="btn-primary text-xs" @click="showInFolder(selected)">查看视频</button>
                <button class="btn-secondary text-xs" @click="copyText(selected.prompt)">复制提示词</button>
                <button class="btn-secondary text-xs" @click="deleteSelected">删除记录</button>
              </div>

              <div class="space-y-3 text-xs">
                <InfoRow label="任务状态" :value="statusLabel(selected.status)" />
                <InfoRow label="保存状态" :value="downloadStatusLabel(selected.download_status)" />
                <InfoRow label="模型" :value="selected.model_name" />
                <InfoRow label="规格" :value="specLabel(selected)" />
                <InfoRow label="消耗" :value="Number(selected.credits_used || selected.estimated_credits || 0).toFixed(2)" />
                <InfoRow label="生成时间" :value="formatDate(selected.created_at)" />
                <InfoRow v-if="selected.completed_at" label="完成时间" :value="formatDate(selected.completed_at)" />
                <InfoRow v-if="selected.downloaded_at" label="保存时间" :value="formatDate(selected.downloaded_at)" />
                <InfoRow v-if="selected.local_path" label="本地路径" :value="selected.local_path" />
              </div>

              <div>
                <h4 class="text-xs font-semibold text-text-primary mb-2">提示词</h4>
                <div class="rounded-lg border border-surface-3 bg-surface-1 p-3 text-xs text-text-secondary whitespace-pre-wrap max-h-40 overflow-y-auto">{{ selected.prompt || '-' }}</div>
              </div>

              <div v-if="selected.negative_prompt">
                <h4 class="text-xs font-semibold text-text-primary mb-2">负面提示词</h4>
                <div class="rounded-lg border border-surface-3 bg-surface-1 p-3 text-xs text-text-secondary whitespace-pre-wrap max-h-28 overflow-y-auto">{{ selected.negative_prompt }}</div>
              </div>

              <div v-if="selected.reference_assets.length || selected.reference_image_urls.length || selected.reference_video_urls.length">
                <h4 class="text-xs font-semibold text-text-primary mb-2">参考素材</h4>
                <div class="space-y-3">
                  <div v-if="referenceImageItems(selected).length" class="grid grid-cols-3 gap-2">
                    <div v-for="image in referenceImageItems(selected)" :key="image.url" class="overflow-hidden rounded-lg border border-surface-3 bg-surface-1">
                      <div class="aspect-square bg-surface-2">
                        <img :src="image.url" :alt="image.label" class="h-full w-full object-cover" loading="lazy" referrerpolicy="no-referrer" />
                      </div>
                      <div class="px-2 py-1.5">
                        <div class="truncate text-[11px] text-text-primary">{{ image.label }}</div>
                        <div class="truncate text-[10px] text-text-tertiary">{{ image.roleLabel }}</div>
                      </div>
                    </div>
                  </div>
                  <div v-for="asset in referenceNonImageAssets(selected)" :key="asset.url" class="rounded-lg border border-surface-3 bg-surface-1 px-3 py-2 text-xs text-text-secondary truncate">
                    {{ referenceTypeLabel(asset.asset_type, asset.url) }} · {{ asset.original_name || asset.url }}
                  </div>
                  <div v-for="url in extraReferenceVideoUrls(selected)" :key="url" class="rounded-lg border border-surface-3 bg-surface-1 px-3 py-2 text-xs text-text-secondary truncate">
                    视频 · {{ url }}
                  </div>
                </div>
              </div>
            </div>
          </template>
          <div v-else class="text-xs text-text-tertiary text-center py-12">选择一条视频记录查看详情</div>
        </aside>
      </section>

      <div v-else class="card p-12 text-center">
        <h3 class="text-sm font-semibold text-text-primary">暂无视频创作记录</h3>
        <p class="text-xs text-text-tertiary mt-2">AI 视频任务完成后会自动记录到这里，并自动尝试保存到本地。</p>
        <button class="btn-primary text-xs mt-4" @click="goCreate">创建视频</button>
      </div>

      <div v-if="total > pageSize" class="flex items-center justify-center gap-3 text-xs">
        <button class="btn-secondary text-xs" :disabled="page <= 1" @click="changePage(page - 1)">上一页</button>
        <span class="text-text-tertiary">{{ page }} / {{ totalPages }}</span>
        <button class="btn-secondary text-xs" :disabled="page >= totalPages" @click="changePage(page + 1)">下一页</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

interface VideoReferenceAsset {
  id?: number | string
  asset_type: string
  original_name?: string
  url: string
  role?: string
  index?: number
  label?: string
}

interface VideoGeneration {
  id: string
  cloud_task_id: string
  model_name: string
  sku_title: string
  mode: string
  duration_seconds: number
  resolution: string
  aspect_ratio: string
  quality: string
  prompt: string
  negative_prompt: string
  reference_assets: VideoReferenceAsset[]
  reference_image_urls: string[]
  reference_video_urls: string[]
  status: string
  progress: number
  estimated_credits: number
  credits_used: number
  error: string
  remote_url: string
  storage_url: string
  local_path: string
  local_exists: boolean
  file_size: number
  download_status: string
  download_error: string
  remote_expires_at: string
  created_at: string
  completed_at: string
  downloaded_at: string
}

const InfoRow = defineComponent({
  props: {
    label: { type: String, required: true },
    value: { type: [String, Number], default: '' },
  },
  setup(props) {
    return () => h('div', { class: 'flex justify-between gap-4 border-b border-surface-2 pb-2 last:border-0' }, [
      h('span', { class: 'text-text-tertiary shrink-0' }, props.label),
      h('span', { class: 'text-text-primary text-right break-all' }, String(props.value || '-')),
    ])
  },
})

const router = useRouter()
const loading = ref(false)
const items = ref<VideoGeneration[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const search = ref('')
const statusFilter = ref('')
const downloadFilter = ref('')
const selected = ref<VideoGeneration | null>(null)
const savingId = ref('')
const previewError = ref('')
let unsubscribeUpdated: (() => void) | null = null
let unsubscribeDeleted: (() => void) | null = null

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const selectedVideoUrl = computed(() => selected.value ? localVideoUrl(selected.value) : '')
const selectedNotice = computed(() => {
  if (!selected.value) return ''
  if (['pending', 'submitting', 'submitted', 'running'].includes(selected.value.status)) return '视频生成完成后会自动尝试保存到本地；云端结果通常仅保留 24 小时。'
  if (selected.value.status === 'completed' && selected.value.local_exists) return '视频已保存到本地，可直接预览或打开所在文件夹。'
  if (selected.value.status === 'completed') return '视频已生成但尚未保存到本地。云端视频通常仅 24 小时有效，请及时点击保存视频。'
  return ''
})

function localVideoUrl(item: VideoGeneration): string {
  if (!item.local_path || !item.local_exists) return ''
  const isAbsolute = /^[A-Za-z]:|^\//.test(item.local_path)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://video?' + param + '=' + encodeURIComponent(item.local_path)
}

function statusLabel(status: string): string {
  return ({ pending: '排队中', submitting: '提交中', submitted: '已提交', running: '生成中', completed: '已完成', failed: '失败', canceled: '已取消' } as Record<string, string>)[status] || status || '-'
}

function downloadStatusLabel(status: string): string {
  return ({ pending: '等待保存', downloading: '保存中', downloaded: '已保存', failed: '保存失败', expired: '云端已过期', skipped: '已跳过' } as Record<string, string>)[status] || status || '等待保存'
}

function statusClass(item: VideoGeneration): string {
  if (item.status === 'completed') return item.local_exists ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
  if (item.status === 'failed') return 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
  if (item.status === 'canceled') return 'bg-surface-2 text-text-tertiary'
  return 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
}

function formatDate(v: string): string {
  if (!v) return '-'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function specLabel(item: VideoGeneration): string {
  return [item.mode, item.duration_seconds ? `${item.duration_seconds} 秒` : '', item.aspect_ratio, item.resolution || item.quality].filter(Boolean).join(' · ') || '-'
}

function canSave(item: VideoGeneration): boolean {
  return item.status === 'completed' && !item.local_exists && !['downloading', 'expired', 'skipped'].includes(item.download_status) && Boolean(item.remote_url || item.storage_url)
}

function isImageReference(assetType: string, url: string): boolean {
  const type = String(assetType || '').toLowerCase()
  if (type.includes('image') || type.includes('图')) return true
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(url || '')
}

function isVideoReference(assetType: string, url: string): boolean {
  const type = String(assetType || '').toLowerCase()
  if (type.includes('video') || type.includes('视频')) return true
  return /\.(mp4|mov|webm|avi|mkv|m4v)(\?|#|$)/i.test(url || '')
}

function referenceRoleLabel(role?: string): string {
  return ({
    reference: '通用参考',
    subject: '主体/角色',
    scene: '场景',
    style: '风格',
    first_frame: '首帧图',
    last_frame: '尾帧图',
  } as Record<string, string>)[role || 'reference'] || '通用参考'
}

function referenceImageItems(item: VideoGeneration): Array<{ url: string; label: string; roleLabel: string }> {
  const seen = new Set<string>()
  const images: Array<{ url: string; label: string; roleLabel: string }> = []
  for (const asset of item.reference_assets) {
    if (!asset.url || !isImageReference(asset.asset_type, asset.url) || seen.has(asset.url)) continue
    seen.add(asset.url)
    images.push({ url: asset.url, label: asset.label || asset.original_name || `参考图${images.length + 1}`, roleLabel: referenceRoleLabel(asset.role) })
  }
  for (const url of item.reference_image_urls) {
    if (!url || seen.has(url)) continue
    seen.add(url)
    images.push({ url, label: `参考图${images.length + 1}`, roleLabel: '通用参考' })
  }
  return images
}

function referenceNonImageAssets(item: VideoGeneration): VideoReferenceAsset[] {
  return item.reference_assets.filter((asset) => asset.url && !isImageReference(asset.asset_type, asset.url))
}

function extraReferenceVideoUrls(item: VideoGeneration): string[] {
  const known = new Set(item.reference_assets.map((asset) => asset.url))
  return Array.from(new Set(item.reference_video_urls.filter((url) => url && !known.has(url))))
}

function referenceTypeLabel(assetType: string, url: string): string {
  if (isVideoReference(assetType, url)) return '视频'
  return '素材'
}

function selectItem(item: VideoGeneration) {
  selected.value = item
  previewError.value = ''
}

function goCreate() {
  router.push('/ai-video')
}

async function reload() {
  loading.value = true
  try {
    const result = await window.api.videoGen.invoke('list', {
      page: page.value,
      pageSize,
      search: search.value,
      status: statusFilter.value,
      downloadStatus: downloadFilter.value,
    }) as { items: VideoGeneration[]; total: number }
    items.value = result.items || []
    total.value = result.total || 0
    if (selected.value) {
      selected.value = items.value.find((item) => item.id === selected.value?.id) || items.value[0] || null
    } else {
      selected.value = items.value[0] || null
    }
  } finally {
    loading.value = false
  }
}

function changePage(nextPage: number) {
  page.value = Math.min(totalPages.value, Math.max(1, nextPage))
  reload()
}

async function saveSelected() {
  if (!selected.value) return
  savingId.value = selected.value.id
  try {
    const result = await window.api.videoGen.invoke('save', selected.value.id) as { success: boolean; item?: VideoGeneration; error?: string }
    if (result.item) {
      selected.value = result.item
      items.value = items.value.map((item) => item.id === result.item?.id ? result.item : item)
    }
    if (!result.success && result.error) previewError.value = result.error
  } finally {
    savingId.value = ''
  }
}

function showInFolder(item: VideoGeneration) {
  if (!item.local_path) return
  window.api.shell.showItemInFolder(item.local_path)
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text || '') } catch {}
}

async function deleteSelected() {
  const item = selected.value
  if (!item) return
  let deleteFile = false
  if (item.local_exists && item.local_path) {
    const alsoDeleteFile = window.confirm('该记录已有本地视频文件，是否同时删除视频文件？\n\n选择“确定”会删除记录和本地视频文件；选择“取消”只删除记录。')
    deleteFile = alsoDeleteFile
  } else if (!window.confirm('确定删除这条视频记录吗？')) {
    return
  }
  const ok = await window.api.videoGen.invoke('delete', item.id, deleteFile) as boolean
  if (!ok) {
    previewError.value = '删除记录失败'
    return
  }
  items.value = items.value.filter((row) => row.id !== item.id)
  total.value = Math.max(0, total.value - 1)
  selected.value = null
  await reload()
}

watch([search, statusFilter, downloadFilter], () => {
  page.value = 1
})

onMounted(() => {
  reload()
  unsubscribeUpdated = window.api.videoGen.onUpdated((data) => {
    const item = data as VideoGeneration
    if (!item?.id) return
    const index = items.value.findIndex((row) => row.id === item.id)
    if (index >= 0) items.value[index] = item
    if (selected.value?.id === item.id) selected.value = item
  })
  unsubscribeDeleted = window.api.videoGen.onDeleted((data) => {
    const id = (data as { id?: string })?.id
    if (!id) return
    items.value = items.value.filter((row) => row.id !== id)
    total.value = Math.max(0, total.value - 1)
    if (selected.value?.id === id) selected.value = items.value[0] || null
  })
})

onUnmounted(() => {
  if (unsubscribeUpdated) unsubscribeUpdated()
  if (unsubscribeDeleted) unsubscribeDeleted()
})
</script>
