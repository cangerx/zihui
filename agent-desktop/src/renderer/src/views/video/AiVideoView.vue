<template>
  <div class="h-full flex flex-col">
    <header class="page-header justify-end">
      <div class="flex items-center gap-2">
        <button class="btn-secondary text-xs" @click="goToCreations">创作记录</button>
        <button class="btn-secondary text-xs" :disabled="loading" @click="reloadAll">刷新</button>
      </div>
    </header>

    <div class="page-body overflow-y-auto space-y-5">
      <div class="inline-flex rounded-xl border border-surface-3 bg-surface-1 p-1 text-xs">
        <button class="rounded-lg px-4 py-2" :class="generationSource === 'cloud' ? 'bg-primary-600 text-white' : 'text-text-secondary'" @click="generationSource = 'cloud'">云端模型</button>
        <button class="rounded-lg px-4 py-2" :class="generationSource === 'local' ? 'bg-primary-600 text-white' : 'text-text-secondary'" @click="generationSource = 'local'">我的 API（BYOK）</button>
      </div>
      <div v-if="generationSource === 'cloud' && !cloudAuth.isLoggedIn" class="card p-8 text-center">
        <h3 class="text-sm font-semibold text-text-primary">请先登录云控端</h3>
        <p class="text-xs text-text-tertiary mt-2">AI 视频需要通过云控端账号提交和计费。</p>
      </div>

      <template v-else>
        <div class="grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] gap-5">
          <section class="card p-5 space-y-4">
            <div>
              <h3 class="text-sm font-semibold text-text-primary">创建视频</h3>
              <p class="text-xs text-text-tertiary mt-1">{{ generationSource === 'local' ? '使用你在模型页配置的 API Key，费用由供应商直接收取。' : '选择模型规格后输入提示词提交，结果会在右侧自动轮询。' }}</p>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <label class="block">
                <span class="form-label">模型</span>
                <select v-model="selectedModelId" class="input-field" @change="onModelChange">
                  <option value="">请选择模型</option>
                  <option v-for="model in catalogModels" :key="model.model_id" :value="model.model_id">
                    {{ model.display_name }}
                  </option>
                </select>
              </label>
              <label class="block">
                <span class="form-label">生成模式</span>
                <select v-model="selectedMode" class="input-field" :disabled="!modeOptions.length">
                  <option value="">请选择模式</option>
                  <option v-for="mode in modeOptions" :key="mode" :value="mode">
                    {{ modeLabel(mode) }}
                  </option>
                </select>
              </label>
              <label class="block">
                <span class="form-label">视频时长</span>
                <select v-model.number="selectedDuration" class="input-field" :disabled="!durationOptions.length">
                  <option value="">请选择时长</option>
                  <option v-for="duration in durationOptions" :key="duration" :value="duration">
                    {{ duration }} 秒
                  </option>
                </select>
              </label>
              <label class="block">
                <span class="form-label">画面比例</span>
                <select v-model="selectedAspectRatio" class="input-field" :disabled="!aspectRatioOptions.length">
                  <option value="">请选择比例</option>
                  <option v-for="ratio in aspectRatioOptions" :key="ratio" :value="ratio">
                    {{ ratio }}
                  </option>
                </select>
              </label>
              <label class="block">
                <span class="form-label">清晰度</span>
                <select v-model="selectedResolution" class="input-field" :disabled="!resolutionOptions.length">
                  <option value="">请选择清晰度</option>
                  <option v-for="resolution in resolutionOptions" :key="resolution" :value="resolution">
                    {{ resolution }}
                  </option>
                </select>
              </label>
            </div>

            <div v-if="catalogLoaded && !catalogModels.length" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:border-amber-700/40 dark:text-amber-300">
              {{ generationSource === 'local' ? '暂无可用 BYOK 视频模型，请先到「模型 → 视频生成」添加并启用供应商。' : '暂无可用视频模型，请先在云控端启用视频服务商账号，并为视频 SKU 配置扣费。' }}
            </div>

            <div v-if="selectedModel && modelSkus.length && !selectedSku" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:border-amber-700/40 dark:text-amber-300">
              当前规格组合暂不可用，请调整模式、时长、比例或清晰度。
            </div>

            <div v-if="selectedSku" class="rounded-lg border border-surface-3 bg-surface-1 p-3 text-xs text-text-secondary space-y-1">
              <div class="flex justify-between"><span>协议</span><span class="text-text-primary">{{ selectedModel?.provider_protocol }}</span></div>
              <div class="flex justify-between"><span>模式</span><span class="text-text-primary">{{ modeLabel(selectedSku.mode) }}</span></div>
              <div class="flex justify-between"><span>规格</span><span class="text-text-primary">{{ skuSpecLabel(selectedSku) }}</span></div>
              <div class="flex justify-between"><span>预计消耗</span><span class="text-primary-600 font-medium">{{ Number(selectedSku.credit_cost || 0).toFixed(2) }} {{ creditLabel }}</span></div>
            </div>

            <div class="space-y-1.5">
              <div class="flex items-center justify-between gap-3">
                <span class="form-label">视频提示词</span>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="!canOptimizePrompt || optimizingPrompt"
                    :title="optimizeButtonTitle"
                    @click="optimizeVideoPrompt()"
                  >优化</button>
                </div>
              </div>
              <PromptTextarea
                v-model="prompt"
                title="视频提示词"
                placeholder="描述画面主体、动作、镜头、风格和场景"
                :height="150"
                :max-length="8000"
                inline-edit
              />
              <div v-if="optimizingPrompt" class="flex items-center gap-1.5 text-[11px] text-text-tertiary">
                <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                正在优化视频提示词...
              </div>
              <div v-if="optimizeError" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">{{ optimizeError }}</div>
            </div>

            <PromptTextarea
              v-model="negativePrompt"
              title="负面提示词"
              placeholder="不希望出现的元素，可留空"
              :height="80"
              :max-length="8000"
              inline-edit
            />

            <div v-if="generationSource === 'cloud'" class="space-y-2">
              <div class="flex items-center justify-between">
                <span class="form-label">{{ isFirstLastFrameMode ? '首尾帧' : '参考素材' }}</span>
                <div v-if="!isFirstLastFrameMode" class="flex items-center gap-2">
                  <button type="button" class="btn-secondary text-xs" @click="openReferenceGallery()">从图库选择</button>
                  <label class="btn-secondary text-xs cursor-pointer">
                    上传素材
                    <input class="hidden" type="file" :accept="referenceAccept" multiple @change="onPickReferences" />
                  </label>
                </div>
              </div>
              <div v-if="isFirstLastFrameMode" class="grid grid-cols-2 gap-3">
                <div v-for="slot in frameSlots" :key="slot.role" class="rounded-xl border border-surface-3 bg-surface-1 p-3 space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-semibold text-text-primary">{{ slot.label }}</span>
                    <button v-if="frameAsset(slot.role)" class="text-[11px] text-text-tertiary hover:text-red-500" @click="removeAssetByRole(slot.role)">移除</button>
                  </div>
                  <div class="aspect-video overflow-hidden rounded-lg bg-surface-2 border border-surface-3 flex items-center justify-center">
                    <img v-if="frameAsset(slot.role)" :src="frameAsset(slot.role)?.url" :alt="slot.label" class="w-full h-full object-cover" />
                    <span v-else class="text-[11px] text-text-tertiary">{{ slot.label }}</span>
                  </div>
                  <div class="grid grid-cols-2 gap-2">
                    <button type="button" class="btn-secondary text-xs" @click="openReferenceGallery(slot.role)">图库</button>
                    <label class="btn-secondary text-xs cursor-pointer text-center block">
                      {{ frameAsset(slot.role) ? '替换图片' : '上传图片' }}
                      <input class="hidden" type="file" accept="image/*" @change="onPickFrameReference($event, slot.role)" />
                    </label>
                  </div>
                </div>
              </div>
              <div v-else-if="orderedReferenceAssets.length" class="space-y-2">
                <div v-for="asset in orderedReferenceAssets" :key="asset.id" class="rounded-lg border border-surface-3 bg-surface-1 p-3 text-xs space-y-2">
                  <div class="flex items-start gap-3">
                    <div class="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-surface-3 bg-surface-2">
                      <img v-if="asset.asset_type === 'image'" :src="asset.url" :alt="asset.label" class="h-full w-full object-cover" />
                      <div v-else class="h-full w-full flex items-center justify-center text-[10px] text-text-tertiary">{{ referenceAssetTypeLabel(asset.asset_type) }}</div>
                      <span class="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">{{ asset.label }}</span>
                    </div>
                    <div class="min-w-0 flex-1 space-y-2">
                      <div class="flex items-center justify-between gap-2">
                        <span class="truncate font-medium text-text-primary">{{ asset.original_name || asset.url }}</span>
                        <button class="shrink-0 text-text-tertiary hover:text-red-500" @click="removeAsset(asset.id)">移除</button>
                      </div>
                      <select v-if="asset.asset_type === 'image'" :value="asset.role" class="input-field py-1 text-xs" @change="onReferenceRoleChange(asset.id, $event)">
                        <option value="reference">通用参考</option>
                        <option value="subject">主体/角色</option>
                        <option value="scene">场景</option>
                        <option value="style">风格</option>
                      </select>
                      <div v-else class="text-text-tertiary">{{ referenceAssetTypeLabel(asset.asset_type) }}</div>
                    </div>
                  </div>
                </div>
              </div>
              <p v-else class="text-xs text-text-tertiary">{{ referenceHint }}</p>
              <p v-if="referenceGuide" class="text-[11px] text-text-tertiary leading-relaxed">{{ referenceGuide }}</p>
            </div>
            <div v-else class="rounded-lg border border-surface-3 bg-surface-1 px-3 py-2 text-xs text-text-tertiary">BYOK 首版开放文生视频。图生视频将在素材上传到供应商可访问地址后开放，避免提交无效的本地文件路径。</div>

            <div v-if="submitError" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">{{ submitError }}</div>

            <button class="btn-primary w-full" :disabled="!canSubmit" @click="submitTask">
              {{ submitting ? '提交中...' : `提交生成${generationSource === 'cloud' && selectedSku ? ` · ${Number(selectedSku.credit_cost || 0).toFixed(2)} ${creditLabel}` : ''}` }}
            </button>

            <div v-if="generationSource === 'cloud'" class="grid grid-cols-2 gap-3 text-xs">
              <div class="rounded-lg bg-surface-1 border border-surface-3 p-3">
                <div class="text-text-tertiary">{{ creditLabel }}余额</div>
                <div class="text-base font-semibold text-text-primary mt-1">{{ creditBalance.toFixed(2) }}</div>
              </div>
              <div class="rounded-lg bg-surface-1 border border-surface-3 p-3">
                <div class="text-text-tertiary">本月视频配额</div>
                <div class="text-base font-semibold text-text-primary mt-1">{{ monthQuotaLabel }}</div>
              </div>
            </div>
          </section>

          <section class="space-y-5 min-w-0">
            <div class="card p-5 min-h-[360px]">
              <div class="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 class="text-sm font-semibold text-text-primary">当前任务</h3>
                  <p class="text-xs text-text-tertiary mt-1">提交后会自动刷新状态直到完成。</p>
                </div>
                <div v-if="currentTask" class="flex items-center gap-2">
                  <button class="btn-secondary text-xs" :disabled="refreshing" @click="refreshCurrent">刷新</button>
                  <button v-if="isRunning(currentTask.status)" class="btn-secondary text-xs" @click="cancelCurrent">取消</button>
                </div>
              </div>

              <div v-if="!currentTask" class="h-64 rounded-xl border border-dashed border-surface-3 flex items-center justify-center text-xs text-text-tertiary">暂无任务</div>
              <div v-else class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_260px] gap-4">
                <div class="rounded-xl bg-black min-h-64 flex items-center justify-center overflow-hidden">
                  <video v-if="currentVideoUrl" :key="currentVideoUrl" :src="currentVideoUrl" controls class="w-full max-h-[520px]" @error="onVideoPreviewError"></video>
                  <div v-else class="text-xs text-white/70 px-4 text-center">
                    <div class="mb-3">{{ statusLabel(currentTask.status) }}</div>
                    <div class="h-2 w-56 bg-white/20 rounded-full overflow-hidden">
                      <div class="h-full bg-white rounded-full transition-all" :style="{ width: `${currentTask.progress || 0}%` }"></div>
                    </div>
                  </div>
                </div>
                <div class="space-y-3 text-xs">
                  <div class="rounded-lg border border-surface-3 bg-surface-1 p-3 space-y-2">
                    <div class="flex justify-between"><span class="text-text-tertiary">状态</span><span class="font-medium text-text-primary">{{ statusLabel(currentTask.status) }}</span></div>
                    <div class="flex justify-between"><span class="text-text-tertiary">进度</span><span class="text-text-primary">{{ currentTask.progress || 0 }}%</span></div>
                    <div class="flex justify-between"><span class="text-text-tertiary">模型</span><span class="text-text-primary text-right">{{ currentTask.model_name }}</span></div>
                    <div class="flex justify-between"><span class="text-text-tertiary">消耗</span><span class="text-text-primary">{{ Number(currentTask.credits_used || currentTask.estimated_credits || 0).toFixed(2) }} {{ creditLabel }}</span></div>
                    <div v-if="currentTask.status === 'completed'" class="flex justify-between"><span class="text-text-tertiary">保存状态</span><span class="text-text-primary">{{ currentDownloadStatusText }}</span></div>
                  </div>
                  <div v-if="currentTaskNotice" class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700/40 dark:text-amber-300">{{ currentTaskNotice }}</div>
                  <div v-if="videoPreviewError" class="rounded-lg border border-red-200 bg-red-50 p-3 text-red-600 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">{{ videoPreviewError }}</div>
                  <div v-if="currentTaskRecordError" class="rounded-lg border border-red-200 bg-red-50 p-3 text-red-600 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">{{ currentTaskRecordError }}</div>
                  <div v-if="currentLocalRecord?.download_error" class="rounded-lg border border-red-200 bg-red-50 p-3 text-red-600 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">{{ currentLocalRecord.download_error }}</div>
                  <div v-if="currentTask.error_message" class="rounded-lg border border-red-200 bg-red-50 p-3 text-red-600 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">{{ currentTask.error_message }}</div>
                  <button v-if="canSaveCurrentVideo" class="btn-primary w-full text-xs" :disabled="savingVideo" @click="saveCurrentVideo">{{ savingVideo ? '保存中...' : '保存视频' }}</button>
                  <button v-if="canViewCurrentVideo" class="btn-primary w-full text-xs" @click="viewCurrentVideo">查看视频</button>
                  <button v-if="currentTask.prompt" class="btn-secondary w-full text-xs" @click="copyPrompt(currentTask.prompt)">复制提示词</button>
                </div>
              </div>
            </div>

            <div class="card p-5">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-sm font-semibold text-text-primary">最近任务</h3>
                <button class="text-xs text-text-tertiary hover:text-text-primary" :disabled="tasksLoading" @click="loadTasks">刷新</button>
              </div>
              <div v-if="taskListError" class="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">{{ taskListError }}</div>
              <div v-if="tasks.length" class="overflow-x-auto">
                <table class="w-full text-xs">
                  <thead class="text-text-tertiary border-b border-surface-3">
                    <tr><th class="py-2 text-left">模型</th><th class="py-2 text-left">状态</th><th class="py-2 text-left">进度</th><th class="py-2 text-left">时间</th><th class="py-2 text-right">操作</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="task in tasks" :key="task.id" class="border-b border-surface-2 hover:bg-surface-1">
                      <td class="py-2 pr-3 text-text-primary">
                        <div>{{ task.model_name }}</div>
                        <div v-if="taskRecordErrors[task.id]" class="mt-1 text-[11px] text-red-500">{{ taskRecordErrors[task.id] }}</div>
                      </td>
                      <td class="py-2 pr-3 text-text-secondary">{{ statusLabel(task.status) }}</td>
                      <td class="py-2 pr-3 text-text-secondary">{{ task.progress || 0 }}%</td>
                      <td class="py-2 pr-3 text-text-tertiary whitespace-nowrap">{{ formatDate(task.created_at) }}</td>
                      <td class="py-2 text-right"><button class="text-primary-600 hover:underline" @click="selectTask(task)">查看</button></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-else class="text-xs text-text-tertiary py-8 text-center">暂无历史任务</div>
            </div>
          </section>
        </div>
      </template>
    </div>
    <GalleryPicker
      v-model:visible="referenceGalleryVisible"
      :multiple="!referenceGalleryRole"
      @select="onReferenceGallerySelect"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRaw, watch } from 'vue'
import { useRouter } from 'vue-router'
import PromptTextarea from '@/components/PromptTextarea.vue'
import GalleryPicker from '@/components/GalleryPicker.vue'
import { cloudClient } from '@/utils/cloud-api'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useLowBalanceStore } from '@/stores/low-balance'
import { useSiteConfigStore } from '@/stores/site-config'
import { useModelStore } from '@/stores/models'
import { dataUriToBlob, loadAsDataUri } from '@/utils/image-source'
import { compressImage } from '@/utils/compress-image'
import { translateError } from '@/utils/error-message'
import { detectPromptLang } from '@/utils/prompt-lang'
import { groupAndSort } from '@/utils/model-caps'
import { getHintsSync, recordUsage, warmHintsCache } from '@/utils/model-usage-hints'

interface VideoSku {
  id: number
  sku_key: string
  title: string
  mode: string
  duration_seconds: number
  resolution: string
  aspect_ratio: string
  quality: string
  credit_cost: number
  price_label: string
}

interface VideoModel {
  id: number
  provider_key: string
  provider_protocol: string
  model_id: string
  display_name: string
  generation_type: string
  supported_modes: string[]
  supported_durations: number[]
  supported_resolutions: string[]
  supported_aspect_ratios: string[]
  max_reference_images: number
  supported_ref_media?: string[]
  description: string
  skus: VideoSku[]
  runtime_source?: 'cloud' | 'local'
  provider_id?: string
  upstream_model_id?: string
}

interface VideoTask {
  id: string
  task_id: string
  provider_protocol: string
  model_id: string
  model_name: string
  sku_key: string
  sku_title: string
  status: string
  progress: number
  prompt: string
  negative_prompt?: string
  estimated_credits: number
  credits_used: number
  error_message?: string
  created_at: string
  result?: { video_url?: string; remote_url?: string; storage_url?: string; cover_url?: string } | null
  input_assets?: { assets?: ReferenceAsset[]; images?: string[]; videos?: string[]; notes?: string } | null
  request_params?: Record<string, any> | null
  source?: 'cloud' | 'local'
  provider_id?: string
}

type VideoReferenceRole = 'reference' | 'subject' | 'scene' | 'style' | 'first_frame' | 'last_frame'

interface ReferenceAsset {
  id: number | string
  asset_type: 'image' | 'video' | 'audio' | string
  original_name?: string
  url: string
  role: VideoReferenceRole
  index: number
  label: string
}

interface VideoGeneration {
  id: string
  cloud_task_id: string
  status: string
  local_path: string
  local_exists: boolean
  download_status: string
  download_error: string
  remote_url: string
  storage_url: string
  remote_expires_at: string
  downloaded_at: string
}

const cloudAuth = useCloudAuthStore()
const lowBalance = useLowBalanceStore()
const siteConfig = useSiteConfigStore()
const modelStore = useModelStore()
const router = useRouter()
const creditLabel = computed(() => siteConfig.labels.credit)
const loading = ref(false)
const tasksLoading = ref(false)
const submitting = ref(false)
const refreshing = ref(false)
const savingVideo = ref(false)
const optimizingPrompt = ref(false)
const catalogLoaded = ref(false)
const generationSource = ref<'cloud' | 'local'>('cloud')
const submitError = ref('')
const optimizeError = ref('')
const catalogModels = ref<VideoModel[]>([])
const tasks = ref<VideoTask[]>([])
const currentTask = ref<VideoTask | null>(null)
const selectedModelId = ref('')
const selectedMode = ref('')
const selectedDuration = ref<number | ''>('')
const selectedAspectRatio = ref('')
const selectedResolution = ref('')
const prompt = ref('')
const negativePrompt = ref('')
const optimizeProviderId = ref('')
const optimizeModelId = ref('')
const referenceAssets = ref<ReferenceAsset[]>([])
const referenceGalleryVisible = ref(false)
const referenceGalleryRole = ref<Extract<VideoReferenceRole, 'first_frame' | 'last_frame'> | null>(null)
const currentLocalRecord = ref<VideoGeneration | null>(null)
const videoPreviewError = ref('')
const taskListError = ref('')
const currentTaskRecordError = ref('')
const taskRecordErrors = ref<Record<string, string>>({})
let pollTimer: ReturnType<typeof setInterval> | null = null
let unsubscribeVideoUpdated: (() => void) | null = null
let unsubscribeVideoDeleted: (() => void) | null = null

const selectedModel = computed(() => catalogModels.value.find(m => m.model_id === selectedModelId.value) || null)
const modelSkus = computed(() => selectedModel.value?.skus || [])
// L2：SKU 锁定（所有 SKU 该字段非空）= 计费/固定维度，选项取自 SKU；否则该维度由用户在模型 supported_* 内自选。
const skuLocks = (field: 'mode' | 'resolution' | 'aspect_ratio'): boolean =>
  modelSkus.value.length > 0 && modelSkus.value.every(s => String((s as any)[field] ?? '') !== '')
const skuLocksDuration = computed(() => modelSkus.value.length > 0 && modelSkus.value.every(s => Number(s.duration_seconds) > 0))
const modeOptions = computed(() => skuLocks('mode')
  ? uniqueStrings(modelSkus.value.map(s => s.mode))
  : uniqueStrings(selectedModel.value?.supported_modes || []))
const durationOptions = computed(() => skuLocksDuration.value
  ? uniqueNumbers(modelSkus.value.map(s => s.duration_seconds))
  : uniqueNumbers((selectedModel.value?.supported_durations || []).map(v => Number(v))))
const resolutionOptions = computed(() => skuLocks('resolution')
  ? uniqueStrings(modelSkus.value.map(s => s.resolution))
  : uniqueStrings(selectedModel.value?.supported_resolutions || []))
const aspectRatioOptions = computed(() => skuLocks('aspect_ratio')
  ? uniqueStrings(modelSkus.value.map(s => s.aspect_ratio))
  : uniqueStrings(selectedModel.value?.supported_aspect_ratios || []))
// 计费档匹配：仅按 SKU 锁定（非空）的维度匹配；未锁定（空）的维度由用户自选、不参与匹配
const selectedSku = computed(() => modelSkus.value.find(s =>
  (Number(s.duration_seconds) === 0 || Number(s.duration_seconds) === Number(selectedDuration.value)) &&
  (String(s.resolution ?? '') === '' || (s.resolution || s.quality) === selectedResolution.value) &&
  (String(s.mode ?? '') === '' || s.mode === selectedMode.value) &&
  (String(s.aspect_ratio ?? '') === '' || s.aspect_ratio === selectedAspectRatio.value)
) || null)
const isFirstLastFrameMode = computed(() => selectedMode.value === 'first_last_frame')
const frameSlots: Array<{ role: Extract<VideoReferenceRole, 'first_frame' | 'last_frame'>; label: string }> = [
  { role: 'first_frame', label: '首帧图' },
  { role: 'last_frame', label: '尾帧图' },
]
type ProtocolAssetType = 'image' | 'video' | 'audio'
interface ProtocolCapability { assetTypes: ProtocolAssetType[]; firstLastFrameByImage: boolean }
const PROTOCOL_CAPABILITIES: Record<string, ProtocolCapability> = {
  seedance: { assetTypes: ['image', 'video', 'audio'], firstLastFrameByImage: false },
  veo: { assetTypes: ['image'], firstLastFrameByImage: true },
  grok: { assetTypes: ['image'], firstLastFrameByImage: false },
  // 可灵：图生视频单图 + 首尾帧（image + image_tail），故支持 image 与首尾帧
  kling: { assetTypes: ['image'], firstLastFrameByImage: true },
  wan: { assetTypes: ['image', 'video', 'audio'], firstLastFrameByImage: true },
  openai_video: { assetTypes: ['image', 'video'], firstLastFrameByImage: false },
}
const DEFAULT_PROTOCOL_CAPABILITY: ProtocolCapability = { assetTypes: ['image'], firstLastFrameByImage: false }
function protocolCapability(protocol?: string): ProtocolCapability {
  const p = (protocol || '').toLowerCase()
  if (['wan3', 'wan3.0', 'wan3.0-video', 'dashscope', 'dashscope_compatible'].includes(p)) {
    return PROTOCOL_CAPABILITIES.wan
  }
  return PROTOCOL_CAPABILITIES[p] || DEFAULT_PROTOCOL_CAPABILITY
}
const ASSET_ACCEPT_MAP: Record<ProtocolAssetType, string> = { image: 'image/*', video: 'video/*', audio: 'audio/*' }
const ASSET_TYPE_LABEL: Record<ProtocolAssetType, string> = { image: '图片', video: '视频', audio: '音频' }
const VALID_ASSET_TYPES: ProtocolAssetType[] = ['image', 'video', 'audio']
// 参考素材可选类型：优先用服务端下发的 supported_ref_media（与后端 allowedRefMedia 同源，
// 保证前端可选与后端校验一致）；服务端未下发（旧后台）时回退协议默认能力表。
const referenceAssetTypes = computed<ProtocolAssetType[]>(() => {
  const fromModel = (selectedModel.value?.supported_ref_media || []).filter(
    (t): t is ProtocolAssetType => VALID_ASSET_TYPES.includes(t as ProtocolAssetType)
  )
  if (fromModel.length) return fromModel
  return protocolCapability(selectedModel.value?.provider_protocol).assetTypes
})
const orderedReferenceAssets = computed(() =>
  normalizeReferenceAssetList(referenceAssets.value, isFirstLastFrameMode.value)
)
const currentRemoteVideoUrl = computed(() => currentTask.value?.result?.video_url || currentTask.value?.result?.storage_url || currentTask.value?.result?.remote_url || currentLocalRecord.value?.storage_url || currentLocalRecord.value?.remote_url || '')
const currentLocalVideoUrl = computed(() => {
  const path = currentLocalRecord.value?.local_path || ''
  if (!path || !currentLocalRecord.value?.local_exists) return ''
  const isAbsolute = /^[A-Za-z]:|^\//.test(path)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://video?' + param + '=' + encodeURIComponent(path)
})
const currentVideoUrl = computed(() => currentLocalVideoUrl.value || currentRemoteVideoUrl.value)
const canSaveCurrentVideo = computed(() => {
  if (!currentTask.value || currentTask.value.status !== 'completed') return false
  if (!currentRemoteVideoUrl.value) return false
  if (currentLocalRecord.value?.local_exists || currentLocalRecord.value?.download_status === 'downloaded') return false
  return !['downloading', 'expired', 'skipped'].includes(currentLocalRecord.value?.download_status || '')
})
const canViewCurrentVideo = computed(() => Boolean(currentLocalRecord.value?.local_path && currentLocalRecord.value?.local_exists))
const currentTaskNotice = computed(() => {
  if (!currentTask.value) return ''
  if (isRunning(currentTask.value.status)) return '视频生成完成后会自动尝试保存到本地；云端结果通常仅保留 24 小时。'
  if (currentTask.value.status === 'completed' && canViewCurrentVideo.value) return '视频已保存到本地，可直接预览或打开所在文件夹。'
  if (currentTask.value.status === 'completed') return '视频已生成但尚未保存到本地。云端视频通常仅 24 小时有效，请及时点击保存视频。'
  return ''
})
const currentDownloadStatusText = computed(() => downloadStatusLabel(currentLocalRecord.value?.download_status || 'pending'))
const canOptimizePrompt = computed(() => Boolean(prompt.value.trim() && optimizeProviderId.value && optimizeModelId.value && !optimizingPrompt.value))
const optimizeButtonTitle = computed(() => {
  if (!prompt.value.trim()) return '请输入视频提示词后再优化'
  if (!optimizeProviderId.value || !optimizeModelId.value) return '暂无可用提示词优化模型'
  return '根据输入自动识别中文或英文，并优化提示词'
})
const referenceSubmitReady = computed(() => {
  if (generationSource.value === 'local') return true
  if (!isFirstLastFrameMode.value) return true
  return protocolCapability(selectedModel.value?.provider_protocol).firstLastFrameByImage
    ? orderedReferenceAssets.value.some((asset) => asset.asset_type === 'image')
    : Boolean(frameAsset('first_frame') && frameAsset('last_frame'))
})
const canSubmit = computed(() => Boolean(selectedSku.value && prompt.value.trim() && referenceSubmitReady.value && !submitting.value && !loading.value))
const creditBalance = computed(() => Number(cloudAuth.quotas?.balances?.credit?.total ?? cloudAuth.balances.find(b => b.type === 'credit')?.amount ?? 0))
const referenceHint = computed(() => {
  const cap = protocolCapability(selectedModel.value?.provider_protocol)
  if (selectedMode.value === 'image_to_video') return cap.firstLastFrameByImage ? '图生视频支持 1-3 张参考图。' : '图生视频建议上传 1 张参考图。'
  if (selectedMode.value === 'first_last_frame') return cap.firstLastFrameByImage ? '首尾帧模式支持上传 1-2 张图片。' : '首尾帧模式建议上传首帧和尾帧 2 张图。'
  const extra = referenceAssetTypes.value.filter((t) => t !== 'image').map((t) => ASSET_TYPE_LABEL[t])
  return extra.length ? `可选。支持图片、${extra.join('、')}参考素材。` : '可选。当前模型仅支持图片参考素材。'
})
const referenceGuide = computed(() => {
  if (isFirstLastFrameMode.value) return protocolCapability(selectedModel.value?.provider_protocol).firstLastFrameByImage ? '上传两张图时会作为首尾帧；仅上传一张图时由上游按首尾帧模式匹配。' : '首帧图会作为视频开始画面，尾帧图会作为视频结束画面。'
  if (orderedReferenceAssets.value.some((asset) => asset.asset_type === 'image')) return '多张参考图可在提示词中使用“参考图1、参考图2”指定对应关系。'
  return ''
})
const referenceAccept = computed(() => referenceAssetTypes.value.map((t) => ASSET_ACCEPT_MAP[t]).join(','))
const monthQuotaLabel = computed(() => {
  const counter = cloudAuth.quotas?.usage_counters?.video_quota_per_month
  if (!counter || counter.unlimited || counter.limit <= 0) return '不限'
  return `${counter.used} / ${counter.limit}`
})

function goToCreations() {
  router.push('/video-creations')
}

function onModelChange() {
  resetSpecSelection()
  normalizeSpecSelection()
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v))))
}

function uniqueNumbers(values: Array<number | undefined | null>): number[] {
  return Array.from(new Set(values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)))).sort((a, b) => a - b)
}

function modeLabel(mode: string): string {
  return ({
    text_to_video: '文生视频',
    image_to_video: '图生视频',
    first_last_frame: '首尾帧',
    standard: '标准',
    fast: '快速',
  } as Record<string, string>)[mode] || mode || '-'
}

function resetSpecSelection() {
  selectedMode.value = ''
  selectedDuration.value = ''
  selectedAspectRatio.value = ''
  selectedResolution.value = ''
  referenceAssets.value = []
}

function normalizeSpecSelection() {
  if (!modelSkus.value.length) {
    resetSpecSelection()
    return
  }
  if (!modeOptions.value.includes(selectedMode.value)) selectedMode.value = modeOptions.value[0] || ''
  if (!durationOptions.value.includes(Number(selectedDuration.value))) selectedDuration.value = durationOptions.value[0] || ''
  if (!aspectRatioOptions.value.includes(selectedAspectRatio.value)) selectedAspectRatio.value = aspectRatioOptions.value[0] || ''
  if (!resolutionOptions.value.includes(selectedResolution.value)) selectedResolution.value = resolutionOptions.value[0] || ''
}

function skuSpecLabel(sku: VideoSku): string {
  const parts = [sku.duration_seconds ? `${sku.duration_seconds}s` : '', sku.resolution, sku.aspect_ratio, sku.quality].filter(Boolean)
  return parts.join(' · ') || '-'
}

function statusLabel(status: string): string {
  return ({ pending: '排队中', submitting: '提交中', submitted: '已提交', processing: '生成中', running: '生成中', completed: '已完成', failed: '失败', canceled: '已取消', cancelled: '已取消' } as Record<string, string>)[status] || status
}

function downloadStatusLabel(status: string): string {
  return ({ pending: '等待保存', downloading: '保存中', downloaded: '已保存', failed: '保存失败', expired: '云端已过期', skipped: '已跳过' } as Record<string, string>)[status] || status || '等待保存'
}

function isRunning(status: string): boolean {
  return ['pending', 'submitting', 'submitted', 'processing', 'running'].includes(status)
}

function formatDate(v: string): string {
  if (!v) return '-'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function errorMessage(e: any, fallback: string): string {
  const raw = e?.message || e?.error || String(e || '') || fallback
  // 统一过 translateError：余额不足/HTTP 状态码/网络错误等都转成中文友好提示
  return translateError(raw)
}

function referenceAssetTypeLabel(assetType: string): string {
  if (assetType === 'image') return '图片'
  if (assetType === 'video') return '视频'
  if (assetType === 'audio') return '音频'
  return '素材'
}

function referenceRoleLabel(role: VideoReferenceRole): string {
  return ({
    reference: '通用参考',
    subject: '主体/角色',
    scene: '场景',
    style: '风格',
    first_frame: '首帧图',
    last_frame: '尾帧图',
  } as Record<VideoReferenceRole, string>)[role] || '通用参考'
}

function normalizeReferenceAssetList(items: ReferenceAsset[], firstLastMode: boolean): ReferenceAsset[] {
  const valid = items.filter((asset) => asset?.url)
  if (firstLastMode) {
    if (protocolCapability(selectedModel.value?.provider_protocol).firstLastFrameByImage) {
      return valid
        .filter((asset) => asset.asset_type === 'image')
        .slice(0, 2)
        .map((asset, index) => ({
          id: asset.id,
          asset_type: 'image',
          original_name: asset.original_name || '',
          url: asset.url,
          role: asset.role === 'last_frame' ? 'last_frame' : (index === 1 ? 'last_frame' : 'first_frame'),
          index: index + 1,
          label: index === 1 ? '尾帧图' : '首帧图',
        } as ReferenceAsset))
    }
    return frameSlots
      .map((slot, index) => {
        const asset = valid.find((item) => item.role === slot.role && item.asset_type === 'image')
        if (!asset) return null
        return {
          id: asset.id,
          asset_type: 'image',
          original_name: asset.original_name || '',
          url: asset.url,
          role: slot.role,
          index: index + 1,
          label: slot.label,
        } as ReferenceAsset
      })
      .filter((asset): asset is ReferenceAsset => Boolean(asset))
  }

  let imageIndex = 0
  let videoIndex = 0
  let otherIndex = 0
  return valid
    .filter((asset) => asset.role !== 'first_frame' && asset.role !== 'last_frame')
    .map((asset, index) => {
      const assetType = asset.asset_type || 'image'
      const role = assetType === 'image' && ['reference', 'subject', 'scene', 'style'].includes(asset.role)
        ? asset.role
        : 'reference'
      let label = `素材${++otherIndex}`
      if (assetType === 'image') label = `参考图${++imageIndex}`
      else if (assetType === 'video') label = `参考视频${++videoIndex}`
      return {
        id: asset.id,
        asset_type: assetType,
        original_name: asset.original_name || '',
        url: asset.url,
        role,
        index: index + 1,
        label,
      }
    })
}

function normalizeReferenceAssetsForMode() {
  referenceAssets.value = normalizeReferenceAssetList(referenceAssets.value, isFirstLastFrameMode.value)
}

function frameAsset(role: Extract<VideoReferenceRole, 'first_frame' | 'last_frame'>): ReferenceAsset | null {
  return referenceAssets.value.find((asset) => asset.role === role && asset.asset_type === 'image') || null
}

function removeAsset(id: number | string) {
  referenceAssets.value = referenceAssets.value.filter(a => a.id !== id)
  normalizeReferenceAssetsForMode()
}

function onReferenceRoleChange(id: number | string, event: Event) {
  const role = (event.target as HTMLSelectElement).value as VideoReferenceRole
  if (!['reference', 'subject', 'scene', 'style'].includes(role)) return
  referenceAssets.value = referenceAssets.value.map((asset) => asset.id === id ? { ...asset, role } : asset)
  normalizeReferenceAssetsForMode()
}

function removeAssetByRole(role: Extract<VideoReferenceRole, 'first_frame' | 'last_frame'>) {
  referenceAssets.value = referenceAssets.value.filter(a => a.role !== role)
}

function referenceAssetNotes(items: ReferenceAsset[], firstLastMode: boolean): string {
  if (firstLastMode) {
    return '首帧图作为视频开始画面，尾帧图作为视频结束画面，生成两者之间自然连贯的过渡动作。'
  }
  const imageItems = items.filter((asset) => asset.asset_type === 'image')
  if (!imageItems.length) return ''
  return ['参考图说明：', ...imageItems.map((asset) => `- ${asset.label}：${referenceRoleLabel(asset.role)}`)].join('\n')
}

function normalizedReferencePayload() {
  const assets = normalizeReferenceAssetList(referenceAssets.value, isFirstLastFrameMode.value)
  if (isFirstLastFrameMode.value) {
    if (protocolCapability(selectedModel.value?.provider_protocol).firstLastFrameByImage) {
      const imageCount = assets.filter((asset) => asset.asset_type === 'image').length
      if (imageCount < 1 || imageCount > 2) throw new Error('首尾帧模式支持 1 到 2 张图片')
    } else {
      const hasFirst = assets.some((asset) => asset.role === 'first_frame')
      const hasLast = assets.some((asset) => asset.role === 'last_frame')
      if (!hasFirst || !hasLast) throw new Error('首尾帧模式需要分别上传首帧图和尾帧图')
      if (assets.length !== 2) throw new Error('首尾帧模式只能包含首帧图和尾帧图')
    }
  }
  const imageUrls = assets.filter((asset) => asset.asset_type === 'image').map((asset) => asset.url)
  const videoUrls = assets.filter((asset) => asset.asset_type === 'video').map((asset) => asset.url)
  const audioUrls = assets.filter((asset) => asset.asset_type === 'audio').map((asset) => asset.url)
  return {
    assets,
    imageUrls,
    videoUrls,
    audioUrls,
    notes: referenceAssetNotes(assets, isFirstLastFrameMode.value),
  }
}

function structureUploadedAsset(asset: any, role: VideoReferenceRole = 'reference'): ReferenceAsset {
  return {
    id: asset.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    asset_type: asset.asset_type || 'image',
    original_name: asset.original_name || asset.metadata?.original_name || '',
    url: asset.url || asset.storage_url || '',
    role,
    index: 0,
    label: '',
  }
}

function openReferenceGallery(role: Extract<VideoReferenceRole, 'first_frame' | 'last_frame'> | null = null) {
  referenceGalleryRole.value = role
  referenceGalleryVisible.value = true
}

// 参考素材上传前预处理：图片压缩 + 体积拦截。详见 prepareReferenceUploadFile。
const MAX_REFERENCE_UPLOAD_BYTES = 50 * 1024 * 1024

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/**
 * 上传前预处理参考素材：
 *  - 图片：统一压到长边 1600 的 JPEG（顺带剥 EXIF），把几十 MB 的手机原图 / 单反图压到 1~2MB 内，
 *    从根上避免云端把原图转存对象存储时超时 / 内存溢出而回笼统的「服务器错误 500」；
 *    与「从图库选图」走同一压缩档位，体验一致。
 *  - 视频 / 音频：无法压缩，仅做体积上限拦截（与云端 max:51200=50MB 对齐），超限直接提示。
 */
async function prepareReferenceUploadFile(file: File, assetType: ProtocolAssetType): Promise<File> {
  let out = file
  if (assetType === 'image') {
    try {
      const dataUri = await readFileAsDataUri(file)
      const compressed = await compressImage(dataUri, 1600, 0.9)
      const blob = dataUriToBlob(compressed)
      const baseName = file.name.replace(/\.[^.]+$/, '') || 'reference'
      out = new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' })
    } catch {
      out = file
    }
  }
  if (out.size > MAX_REFERENCE_UPLOAD_BYTES) {
    const mb = (out.size / 1024 / 1024).toFixed(1)
    throw new Error(`素材体积过大（${mb}MB，超过 50MB 上限），请压缩或更换更小的文件后再上传`)
  }
  return out
}

async function imagePathToUploadFile(path: string): Promise<File | null> {
  const [item] = await loadAsDataUri([path], { maxSize: 1600, quality: 0.9 })
  if (!item) return null
  const blob = dataUriToBlob(item.dataUri)
  const baseName = item.name.replace(/\.[^.]+$/, '') || 'gallery-image'
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
  return new File([blob], `${baseName}.${ext}`, { type: blob.type || 'image/jpeg' })
}

async function uploadImageReferenceFile(file: File, role: VideoReferenceRole = 'reference') {
  const res = await cloudClient.uploadVideoReference(file, 'image')
  if (!res.asset) return
  if (role === 'first_frame' || role === 'last_frame') {
    referenceAssets.value = referenceAssets.value.filter((asset) => asset.role !== role)
  }
  referenceAssets.value.push(structureUploadedAsset(res.asset, role))
}

async function onReferenceGallerySelect(paths: string[]) {
  if (!paths.length) return
  submitError.value = ''
  try {
    const role = referenceGalleryRole.value
    const selectedPaths = role ? paths.slice(0, 1) : paths
    for (const path of selectedPaths) {
      const file = await imagePathToUploadFile(path)
      if (!file) continue
      await uploadImageReferenceFile(file, role || 'reference')
    }
    normalizeReferenceAssetsForMode()
  } catch (e: any) {
    submitError.value = errorMessage(e, '从图库上传参考图失败')
  } finally {
    referenceGalleryRole.value = null
  }
}

function setTaskRecordError(taskId: string, message: string) {
  const next = { ...taskRecordErrors.value }
  if (message) next[taskId] = message
  else delete next[taskId]
  taskRecordErrors.value = next
  if (currentTask.value?.id === taskId) currentTaskRecordError.value = message
}

function pickDefaultOptimizeModel() {
  if (optimizeProviderId.value && optimizeModelId.value) return
  for (const provider of modelStore.providers) {
    if (!provider.models.length) continue
    const groups = groupAndSort(provider.models, 'chat', {
      cloudTypeOf: (mid) => modelStore.cloudTypeOf(provider.id, mid),
      usageHints: getHintsSync('chat', provider.id)
    })
    const modelId = groups.recommended[0] || groups.others[0]
    if (!modelId) continue
    optimizeProviderId.value = provider.id
    optimizeModelId.value = modelId
    return
  }
}

function hasOptimizeModel(providerId: string, modelId: string): boolean {
  return modelStore.providers.some((provider) => provider.id === providerId && provider.models.includes(modelId))
}

async function initializePromptOptimizer() {
  await Promise.all([modelStore.fetchProviders(), warmHintsCache()])
  const all = await window.api.settings.invoke('getAll') as Record<string, string>
  const providerId = all['aivideo_optimize_provider_id'] || all['imagegen_optimize_provider_id'] || ''
  const modelId = all['aivideo_optimize_model_id'] || all['imagegen_optimize_model_id'] || ''
  if (providerId && modelId && hasOptimizeModel(providerId, modelId)) {
    optimizeProviderId.value = providerId
    optimizeModelId.value = modelId
  }
  pickDefaultOptimizeModel()
}

const OPTIMIZE_VIDEO_CN_PROMPT = `你是一个专业的 AI 视频生成提示词工程师。请将以下描述优化为高质量中文视频生成提示词。

优化要求：
1. 保持原始创意意图不变
2. 补充主体、动作、场景、镜头运动、节奏和视觉风格
3. 让描述适合视频生成，强调连续动作和画面变化
4. 语言清晰具体，避免空泛形容
5. 控制在 260 字以内

请直接输出优化后的提示词，不要包含任何解释。`

const OPTIMIZE_VIDEO_EN_PROMPT = `You are a professional AI video generation prompt engineer. Optimize the following description into a high-quality English video generation prompt.

Requirements:
1. Preserve the original creative intent
2. Add subject, action, scene, camera movement, pacing, and visual style
3. Make it suitable for video generation by emphasizing continuous motion and visual progression
4. Keep the language clear, specific, and production-ready
5. Keep within 180 words

Output only the optimized prompt, no explanations.`

async function optimizeVideoPrompt() {
  if (!prompt.value.trim()) return
  pickDefaultOptimizeModel()
  if (!optimizeProviderId.value || !optimizeModelId.value) {
    optimizeError.value = '暂无可用提示词优化模型'
    return
  }
  const lang = detectPromptLang(prompt.value)
  optimizingPrompt.value = true
  optimizeError.value = ''
  try {
    const messages = [
      { role: 'system', content: lang === 'cn' ? OPTIMIZE_VIDEO_CN_PROMPT : OPTIMIZE_VIDEO_EN_PROMPT },
      { role: 'user', content: prompt.value }
    ]
    const result = await window.api.llm.invoke('call', optimizeProviderId.value, optimizeModelId.value, messages) as string
    if (result?.trim()) {
      prompt.value = result.trim()
      await recordUsage('chat', optimizeProviderId.value, optimizeModelId.value)
      window.api.settings.invoke('set', 'aivideo_optimize_provider_id', optimizeProviderId.value)
      window.api.settings.invoke('set', 'aivideo_optimize_model_id', optimizeModelId.value)
    } else {
      optimizeError.value = 'AI 返回了空结果'
    }
  } catch (e: any) {
    optimizeError.value = translateError(e?.message || e || '优化失败')
  } finally {
    optimizingPrompt.value = false
  }
}

function plainReferenceAssets(items: ReferenceAsset[]): ReferenceAsset[] {
  return normalizeReferenceAssetList(items, isFirstLastFrameMode.value).map((asset) => {
    const raw = toRaw(asset)
    return {
      id: raw.id,
      asset_type: raw.asset_type,
      original_name: raw.original_name || '',
      url: raw.url,
      role: raw.role,
      index: raw.index,
      label: raw.label,
    }
  })
}

function plainVideoTask(task: VideoTask): VideoTask {
  const raw = toRaw(task)
  const result = raw.result ? toRaw(raw.result) : null
  const inputAssets = raw.input_assets ? toRaw(raw.input_assets) : null
  const requestParams = raw.request_params ? toRaw(raw.request_params) : null
  return {
    id: raw.id,
    task_id: raw.task_id,
    provider_protocol: raw.provider_protocol,
    model_id: raw.model_id,
    model_name: raw.model_name,
    sku_key: raw.sku_key,
    sku_title: raw.sku_title,
    status: raw.status,
    progress: raw.progress,
    prompt: raw.prompt,
    negative_prompt: raw.negative_prompt,
    estimated_credits: raw.estimated_credits,
    credits_used: raw.credits_used,
    error_message: raw.error_message,
    created_at: raw.created_at,
    result: result ? {
      video_url: result.video_url,
      remote_url: result.remote_url,
      storage_url: result.storage_url,
      cover_url: result.cover_url,
    } : null,
    input_assets: inputAssets ? {
      assets: Array.isArray(inputAssets.assets) ? inputAssets.assets.map((asset) => ({ ...asset })) : [],
      images: Array.isArray(inputAssets.images) ? [...inputAssets.images] : [],
      videos: Array.isArray(inputAssets.videos) ? [...inputAssets.videos] : [],
      notes: inputAssets.notes || '',
    } : null,
    request_params: requestParams ? { ...requestParams } : null,
  }
}

async function loadCatalog() {
  if (generationSource.value === 'local') {
    const items = await window.api.videoGen.invoke('localCatalog') as Array<any>
    catalogModels.value = items.map((item, index) => ({
      id: -(index + 1), provider_key: item.providerId, provider_protocol: item.adapter,
      model_id: `local:${item.providerId}:${item.modelId}`, display_name: `${item.providerName} · ${item.displayName}`,
      generation_type: 'video', supported_modes: ['text_to_video'], supported_durations: item.capabilities.durations,
      supported_resolutions: item.capabilities.resolutions, supported_aspect_ratios: item.capabilities.aspectRatios,
      max_reference_images: 0, supported_ref_media: [], description: '使用本地保存的供应商凭据直连',
      runtime_source: 'local', provider_id: item.providerId, upstream_model_id: item.modelId,
      skus: [{ id: -(index + 1), sku_key: `local:${item.providerId}:${item.modelId}`, title: item.displayName, mode: '', duration_seconds: 0, resolution: '', aspect_ratio: '', quality: '', credit_cost: 0, price_label: '供应商计费' }],
    }))
    catalogLoaded.value = true
    if (!catalogModels.value.some(m => m.model_id === selectedModelId.value)) {
      selectedModelId.value = catalogModels.value[0]?.model_id || ''
      resetSpecSelection()
    }
    normalizeSpecSelection()
    return
  }
  const data = await cloudClient.videoCatalog()
  catalogModels.value = data.models || []
  catalogLoaded.value = true
  if (!catalogModels.value.some(m => m.model_id === selectedModelId.value)) {
    selectedModelId.value = catalogModels.value[0]?.model_id || ''
    resetSpecSelection()
  }
  normalizeSpecSelection()
}

async function loadTasks() {
  tasksLoading.value = true
  taskListError.value = ''
  try {
    if (generationSource.value === 'local') {
      const result = await window.api.videoGen.invoke('list', { pageSize: 100 }) as { items: Array<any> }
      tasks.value = result.items.filter((row) => row.source === 'local').map((row) => ({
        id: row.id, task_id: row.provider_task_id || row.task_id, provider_protocol: row.protocol_adapter,
        model_id: row.model_id, model_name: row.model_name, sku_key: '', sku_title: '', status: row.status,
        progress: row.progress, prompt: row.prompt, negative_prompt: row.negative_prompt, estimated_credits: 0,
        credits_used: 0, error_message: row.error, created_at: row.created_at,
        result: { video_url: row.remote_url, remote_url: row.remote_url, storage_url: row.storage_url, cover_url: row.cover_url },
        request_params: typeof row.request_params === 'string' ? JSON.parse(row.request_params || '{}') : row.request_params,
        source: 'local', provider_id: row.provider_id,
      }))
      return
    }
    const data = await cloudClient.videoTasks({ per_page: '20' })
    const cloudTasks = data.data || []
    const deletedIds = await window.api.videoGen.invoke('getDeletedIds', cloudTasks.map((task) => task.id)) as string[]
    const deletedSet = new Set(deletedIds)
    tasks.value = cloudTasks.filter((task) => !deletedSet.has(task.id))
    if (currentTask.value && deletedSet.has(currentTask.value.id)) clearCurrentTask()
    await syncTaskRecords(tasks.value)
  } catch (e: any) {
    taskListError.value = errorMessage(e, '拉取任务失败')
  } finally {
    tasksLoading.value = false
  }
}

function buildSyncPayload(task: VideoTask, includeCurrentSelection = false) {
  const currentSku = includeCurrentSelection && task.id === currentTask.value?.id ? selectedSku.value : null
  const plainTask = plainVideoTask(task)
  return {
    task: plainTask,
    referenceAssets: includeCurrentSelection && task.id === currentTask.value?.id ? plainReferenceAssets(referenceAssets.value) : undefined,
    requestParams: {
      mode: plainTask.request_params?.mode || currentSku?.mode || '',
      duration_seconds: plainTask.request_params?.duration || plainTask.request_params?.duration_seconds || currentSku?.duration_seconds || 0,
      resolution: plainTask.request_params?.resolution || currentSku?.resolution || '',
      aspect_ratio: plainTask.request_params?.aspect_ratio || currentSku?.aspect_ratio || '',
      quality: plainTask.request_params?.quality || currentSku?.quality || '',
    },
  }
}

function clearTaskRecordError(taskId: string) {
  const next = { ...taskRecordErrors.value }
  delete next[taskId]
  taskRecordErrors.value = next
  if (currentTask.value?.id === taskId) currentTaskRecordError.value = ''
}

function removeTaskById(taskId: string) {
  tasks.value = tasks.value.filter((task) => task.id !== taskId)
  clearTaskRecordError(taskId)
  if (currentTask.value?.id === taskId) clearCurrentTask()
}

function clearCurrentTask() {
  currentTask.value = null
  currentLocalRecord.value = null
  currentTaskRecordError.value = ''
  videoPreviewError.value = ''
  stopPolling()
}

async function syncTaskRecord(task: VideoTask | null): Promise<VideoGeneration | null> {
  if (!task) return null
  try {
    const record = await window.api.videoGen.invoke('syncTask', buildSyncPayload(task, true)) as VideoGeneration | null
    if (!record) {
      removeTaskById(task.id)
      return null
    }
    setTaskRecordError(task.id, '')
    if (currentTask.value?.id === task.id) currentLocalRecord.value = record
    return record
  } catch (e: any) {
    setTaskRecordError(task.id, errorMessage(e, '同步任务记录失败'))
    return null
  }
}

async function syncTaskRecords(items: VideoTask[]): Promise<void> {
  if (!items.length) return
  try {
    await window.api.videoGen.invoke('syncTasks', items.map((task) => buildSyncPayload(task)))
    for (const task of items) setTaskRecordError(task.id, '')
  } catch (e: any) {
    const message = errorMessage(e, '同步任务记录失败')
    for (const task of items) setTaskRecordError(task.id, message)
  }
  if (currentTask.value) {
    try {
      const record = await window.api.videoGen.invoke('get', currentTask.value.id) as VideoGeneration | null
      currentLocalRecord.value = record
    } catch (e: any) {
      setTaskRecordError(currentTask.value.id, errorMessage(e, '读取任务记录失败'))
    }
  }
}

async function reloadAll() {
  if (generationSource.value === 'cloud' && !cloudAuth.isLoggedIn) return
  loading.value = true
  submitError.value = ''
  try {
    const jobs: Promise<any>[] = [loadCatalog(), loadTasks()]
    if (generationSource.value === 'cloud') jobs.push(cloudAuth.refreshBalancesThrottled(true))
    await Promise.all(jobs)
  } catch (e: any) {
    submitError.value = errorMessage(e, '加载配置失败')
  } finally {
    loading.value = false
  }
}

async function onPickReferences(event: Event) {
  const files = Array.from((event.target as HTMLInputElement).files || [])
  ;(event.target as HTMLInputElement).value = ''
  if (!files.length) return
  submitError.value = ''
  try {
    for (const file of files) {
      const assetType = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image'
      const allowedTypes = referenceAssetTypes.value
      if (!allowedTypes.includes(assetType as ProtocolAssetType)) {
        throw new Error('当前模型支持的参考素材：' + allowedTypes.map((t) => ASSET_TYPE_LABEL[t]).join('、'))
      }
      const uploadFile = await prepareReferenceUploadFile(file, assetType as ProtocolAssetType)
      const res = await cloudClient.uploadVideoReference(uploadFile, assetType as any)
      if (res.asset) referenceAssets.value.push(structureUploadedAsset(res.asset))
    }
    normalizeReferenceAssetsForMode()
  } catch (e: any) {
    submitError.value = errorMessage(e, '上传素材失败')
  }
}

async function onPickFrameReference(event: Event, role: Extract<VideoReferenceRole, 'first_frame' | 'last_frame'>) {
  const file = ((event.target as HTMLInputElement).files || [])[0]
  ;(event.target as HTMLInputElement).value = ''
  if (!file) return
  submitError.value = ''
  try {
    const uploadFile = await prepareReferenceUploadFile(file, 'image')
    const res = await cloudClient.uploadVideoReference(uploadFile, 'image')
    if (res.asset) {
      referenceAssets.value = referenceAssets.value.filter((asset) => asset.role !== role)
      referenceAssets.value.push(structureUploadedAsset(res.asset, role))
      normalizeReferenceAssetsForMode()
    }
  } catch (e: any) {
    submitError.value = errorMessage(e, '上传素材失败')
  }
}

async function submitTask() {
  if (!selectedSku.value) return
  submitError.value = ''
  if (generationSource.value === 'local') {
    submitting.value = true
    try {
      const model = selectedModel.value
      if (!model?.provider_id || !model.upstream_model_id) throw new Error('请选择 BYOK 视频模型')
      const row = await window.api.videoGen.invoke('submitLocal', {
        providerId: model.provider_id, modelId: model.upstream_model_id, prompt: prompt.value.trim(),
        negativePrompt: negativePrompt.value.trim() || undefined, mode: selectedMode.value,
        durationSeconds: Number(selectedDuration.value), resolution: selectedResolution.value, aspectRatio: selectedAspectRatio.value,
      }) as any
      await loadTasks()
      currentTask.value = tasks.value.find((item) => item.id === row.id) || null
      currentLocalRecord.value = row
      startPolling()
    } catch (e: any) { submitError.value = errorMessage(e, '提交失败') }
    finally { submitting.value = false }
    return
  }
  // 前置余额拦截：视频 SKU 单价已知，余额不够直接弹充值引导，不浪费一次提交
  const cost = Number(selectedSku.value.credit_cost || 0)
  if (cost > 0 && creditBalance.value + 1e-6 < cost) {
    lowBalance.open({ balanceType: 'credit', required: cost, available: creditBalance.value })
    return
  }
  submitting.value = true
  try {
    const referencePayload = normalizedReferencePayload()
    referenceAssets.value = referencePayload.assets
    const res = await cloudClient.submitVideoTask({
      sku_key: selectedSku.value.sku_key,
      prompt: prompt.value.trim(),
      negative_prompt: negativePrompt.value.trim() || undefined,
      mode: selectedMode.value || selectedSku.value.mode,
      duration_seconds: Number(selectedDuration.value) || selectedSku.value.duration_seconds,
      resolution: selectedResolution.value || selectedSku.value.resolution,
      aspect_ratio: selectedAspectRatio.value || selectedSku.value.aspect_ratio,
      quality: selectedSku.value.quality,
      reference_assets: referencePayload.assets,
      reference_image_urls: referencePayload.imageUrls,
      reference_video_urls: referencePayload.videoUrls,
      reference_audio_urls: referencePayload.audioUrls,
      reference_asset_notes: referencePayload.notes,
    })
    currentTask.value = res.task
    await syncTaskRecord(currentTask.value)
    await loadTasks()
    startPolling()
  } catch (e: any) {
    submitError.value = errorMessage(e, '提交失败')
  } finally {
    submitting.value = false
  }
}

async function refreshCurrent() {
  const activeTask = currentTask.value
  if (!activeTask) return
  refreshing.value = true
  currentTaskRecordError.value = ''
  try {
    if (activeTask.source === 'local') {
      await window.api.videoGen.invoke('refreshLocal', activeTask.id)
      await loadTasks()
      currentTask.value = tasks.value.find((item) => item.id === activeTask.id) || activeTask
      currentLocalRecord.value = await window.api.videoGen.invoke('get', activeTask.id) as VideoGeneration | null
      if (!isRunning(currentTask.value?.status || '')) stopPolling()
      return
    }
    const res = await cloudClient.refreshVideoTask(activeTask.id)
    currentTask.value = res.task
    await syncTaskRecord(currentTask.value)
    if (!isRunning(currentTask.value?.status || '')) stopPolling()
    if (currentTask.value?.status === 'completed') cloudAuth.refreshBalancesThrottled(true).catch(() => {})
    await loadTasks()
  } catch (e: any) {
    currentTaskRecordError.value = errorMessage(e, '刷新任务失败')
    setTaskRecordError(activeTask.id, currentTaskRecordError.value)
  } finally {
    refreshing.value = false
  }
}

async function cancelCurrent() {
  if (!currentTask.value) return
  if (currentTask.value.source === 'local') {
    const id = currentTask.value.id
    await window.api.videoGen.invoke('cancelLocal', id)
    await loadTasks()
    currentTask.value = tasks.value.find((item) => item.id === id) || null
    stopPolling()
    return
  }
  const res = await cloudClient.cancelVideoTask(currentTask.value.id)
  currentTask.value = res.task
  await syncTaskRecord(currentTask.value)
  stopPolling()
  await loadTasks()
}

async function selectTask(task: VideoTask) {
  currentTask.value = task
  videoPreviewError.value = ''
  currentTaskRecordError.value = taskRecordErrors.value[task.id] || ''
  const record = await window.api.videoGen.invoke('get', task.id) as VideoGeneration | null
  currentLocalRecord.value = record
  if (isRunning(task.status)) startPolling()
  else stopPolling()
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(() => {
    if (!currentTask.value || !isRunning(currentTask.value.status)) {
      stopPolling()
      return
    }
    refreshCurrent().catch(() => {})
  }, 3000)
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

async function saveCurrentVideo() {
  if (!currentTask.value) return
  await syncTaskRecord(currentTask.value)
  savingVideo.value = true
  currentTaskRecordError.value = ''
  try {
    const result = await window.api.videoGen.invoke('save', currentTask.value.id) as { success: boolean; item?: VideoGeneration; error?: string }
    if (result.item) currentLocalRecord.value = result.item
    if (!result.success) {
      currentTaskRecordError.value = result.error || '保存失败'
      setTaskRecordError(currentTask.value.id, currentTaskRecordError.value)
    } else {
      setTaskRecordError(currentTask.value.id, '')
    }
  } catch (e: any) {
    currentTaskRecordError.value = errorMessage(e, '保存失败')
    setTaskRecordError(currentTask.value.id, currentTaskRecordError.value)
  } finally {
    savingVideo.value = false
  }
}

function viewCurrentVideo() {
  if (!currentLocalRecord.value?.local_path) return
  window.api.shell.showItemInFolder(currentLocalRecord.value.local_path)
}

function onVideoPreviewError() {
  if (currentLocalVideoUrl.value) {
    videoPreviewError.value = '本地视频预览失败，请点击“查看视频”打开文件所在目录。'
    return
  }
  videoPreviewError.value = '云端视频暂时无法预览，请先点击“保存视频”拉取到本地后查看。'
}

async function copyPrompt(text: string) {
  try { await navigator.clipboard.writeText(text) } catch {}
}

watch(() => selectedMode.value, () => {
  if (!durationOptions.value.includes(Number(selectedDuration.value))) selectedDuration.value = durationOptions.value[0] || ''
  if (!aspectRatioOptions.value.includes(selectedAspectRatio.value)) selectedAspectRatio.value = aspectRatioOptions.value[0] || ''
  if (!resolutionOptions.value.includes(selectedResolution.value)) selectedResolution.value = resolutionOptions.value[0] || ''
  normalizeReferenceAssetsForMode()
})
watch(() => selectedDuration.value, () => {
  if (!aspectRatioOptions.value.includes(selectedAspectRatio.value)) selectedAspectRatio.value = aspectRatioOptions.value[0] || ''
  if (!resolutionOptions.value.includes(selectedResolution.value)) selectedResolution.value = resolutionOptions.value[0] || ''
})
watch(() => selectedAspectRatio.value, () => {
  if (!resolutionOptions.value.includes(selectedResolution.value)) selectedResolution.value = resolutionOptions.value[0] || ''
})
watch(() => selectedModelId.value, () => normalizeSpecSelection())
watch(() => cloudAuth.isLoggedIn, () => reloadAll())
watch(generationSource, () => {
  clearCurrentTask()
  catalogModels.value = []
  selectedModelId.value = ''
  void reloadAll()
})
watch(() => currentVideoUrl.value, () => {
  videoPreviewError.value = ''
})
onMounted(() => {
  reloadAll()
  initializePromptOptimizer().catch((e) => {
    optimizeError.value = errorMessage(e, '加载提示词优化模型失败')
  })
  unsubscribeVideoUpdated = window.api.videoGen.onUpdated((data) => {
    const record = data as VideoGeneration
    if (record?.id && currentTask.value?.id === record.id) currentLocalRecord.value = record
  })
  unsubscribeVideoDeleted = window.api.videoGen.onDeleted((data) => {
    const id = (data as { id?: string })?.id
    if (id) removeTaskById(id)
  })
})
onUnmounted(() => {
  stopPolling()
  if (unsubscribeVideoUpdated) unsubscribeVideoUpdated()
  if (unsubscribeVideoDeleted) unsubscribeVideoDeleted()
})
</script>
