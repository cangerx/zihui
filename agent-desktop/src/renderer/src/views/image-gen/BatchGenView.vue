<template>
  <div class="h-full flex overflow-hidden">
    <!-- Left: Global Config -->
    <div class="w-72 flex-shrink-0 border-r border-surface-3 bg-surface-0 flex flex-col overflow-y-auto">
      <div class="p-4 space-y-5">
        <h3 class="text-xs font-semibold text-text-primary tracking-wide uppercase">批量生图配置</h3>

        <!-- Default Prompt -->
        <div>
          <WorkspaceBrandChip :prompt="defaultPrompt" />
          <div class="flex items-center justify-between mb-1.5 mt-2">
            <div class="flex items-center gap-1.5">
              <label class="text-xs font-medium text-text-secondary">默认提示词</label>
              <button
                @click="showPresetPopup = !showPresetPopup"
                class="px-1.5 py-0.5 rounded text-[10px] text-text-tertiary hover:text-primary-600 hover:bg-surface-2 transition-colors"
              >预设</button>
              <button
                type="button"
                class="px-1.5 py-0.5 rounded text-[10px] text-text-tertiary hover:text-primary-600 hover:bg-surface-2 transition-colors"
                title="管理生图预设"
                @click="goManagePresets"
              >管理</button>
              <button
                type="button"
                class="px-1.5 py-0.5 rounded text-[10px] text-text-tertiary hover:text-primary-600 hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="把当前提示词存为预设"
                :disabled="!defaultPrompt.trim()"
                @click="openSavePreset(defaultPrompt)"
              >存为</button>
            </div>
            <div class="flex items-center gap-1.5">
              <button
                v-if="defaultPrompt.trim() && optimizeProviderId && optimizeModelId"
                @click="optimizeDefaultPrompt()"
                :disabled="optimizing"
                class="px-2 py-1 rounded-md text-xs font-medium text-text-tertiary hover:text-primary-600 hover:bg-surface-2 transition-colors"
                title="根据输入自动识别中文或英文并优化"
              >优化</button>
            </div>
          </div>
          <PromptTextarea
            v-model="defaultPrompt"
            title="编辑默认提示词"
            :height="112"
            :max-length="IMAGE_PROMPT_MAX_LENGTH"
            placeholder="所有参考图的默认提示词..."
          />
          <!-- 风格选择单独一排：标题行空间让给优化按钮 -->
          <div class="mt-1.5">
            <StylePresetPicker v-model="stylePresetId" />
          </div>
          <div v-if="optimizing" class="flex items-center gap-1.5 mt-1 text-[10px] text-text-tertiary">
            <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
            正在优化提示词...
          </div>
        </div>

        <!-- Model Selection：记住上次选用，需要换时再点 -->
        <div>
          <label class="text-xs font-medium text-text-secondary mb-1.5 block">生图模型</label>
          <ChatModelSwitcher
            :provider-id="selectedProviderId"
            :model-id="selectedModelId"
            type="image"
            direction="down"
            block
            prefix=""
            @change="onImageModelPick"
          />
        </div>

        <div>
          <label class="text-xs font-medium text-text-secondary mb-1.5 block">提示词优化模型</label>
          <ChatModelSwitcher
            :provider-id="optimizeProviderId"
            :model-id="optimizeModelId"
            type="chat"
            direction="down"
            block
            prefix=""
            @change="onOptimizeModelPick"
          />
        </div>

        <!-- Default Size -->
        <div>
          <label class="text-xs font-medium text-text-secondary mb-1.5 block">默认尺寸</label>
          <ImageSizePicker
            v-model="defaultSize"
            :columns="6"
            :model-id="pureSelectedModelId"
            :tier-id="defaultTier"
            show-hint
          />
        </div>

        <!-- Default Resolution Tier -->
        <div>
          <label class="text-xs font-medium text-text-secondary mb-1.5 block">默认分辨率</label>
          <ResolutionTierPicker
            v-model="defaultTier"
            :model-id="pureSelectedModelId"
            :size-value="defaultSize"
          />
        </div>


        <!-- Add Reference Images -->
        <div>
          <div v-if="isDuomiProvider" class="mb-1.5 text-[10px] text-amber-600 dark:text-amber-400">
            多米参考图生图适配中
          </div>
          <div class="flex gap-2">
            <button
              @click="pickRefImages"
              :disabled="isDuomiProvider"
              :title="isDuomiProvider ? '多米参考图生图适配中' : ''"
              :class="['flex-1 px-3 py-2.5 text-xs font-medium border-2 border-dashed border-surface-4 rounded-lg text-text-tertiary transition-colors flex items-center justify-center gap-2', isDuomiProvider ? 'opacity-40 cursor-not-allowed' : 'hover:text-text-secondary hover:border-surface-5']"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              添加参考图
            </button>
            <button
              @click="showGalleryPicker = true"
              :disabled="isDuomiProvider"
              :title="isDuomiProvider ? '多米参考图生图适配中' : ''"
              :class="['flex-1 px-3 py-2.5 text-xs font-medium border-2 border-dashed border-surface-4 rounded-lg text-text-tertiary transition-colors flex items-center justify-center gap-2', isDuomiProvider ? 'opacity-40 cursor-not-allowed' : 'hover:text-text-secondary hover:border-surface-5']"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" stroke-width="2"/><polyline points="21 15 16 10 5 21" stroke-width="2"/></svg>
              图库选图
            </button>
          </div>
        </div>

        <!-- Concurrency -->
        <div v-if="tasks.length > 1">
          <div class="flex items-center justify-between mb-1.5">
            <label class="text-xs font-medium text-text-secondary" title="同时发起的请求数。过高可能触发服务商限流">并发数</label>
            <span class="text-xs font-semibold text-primary-600">{{ concurrency }}</span>
          </div>
          <input type="range" v-model.number="concurrency" :min="1" :max="Math.min(10, tasks.length)" step="1" class="w-full h-1.5 bg-surface-3 rounded-full appearance-none cursor-pointer accent-primary-600" />
          <div class="flex justify-between text-[10px] text-text-tertiary mt-1">
            <span>1（串行）</span>
            <span>{{ Math.min(10, tasks.length) }}</span>
          </div>
        </div>

        <!-- Start All -->
        <button
          @click="startAll"
          :disabled="!canStart || batchRunning"
          :class="['w-full py-3 rounded-xl text-xs font-semibold transition-all', canStart && !batchRunning ? 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm' : 'bg-surface-2 text-text-disabled cursor-not-allowed']"
        >
          {{ batchRunning ? `生成中 (${completedCount}/${tasks.length})` : `开始生成 (${tasks.length} 张)` }}
        </button>
      </div>
    </div>

    <!-- Right: Task List -->
    <div class="flex-1 flex flex-col bg-surface-1 overflow-hidden">
      <div class="flex items-center justify-between px-4 py-2.5 border-b border-surface-3 bg-surface-0">
        <div class="flex items-center gap-2">
          <h3 class="text-xs font-semibold text-text-primary">任务列表</h3>
          <span class="text-[10px] text-text-tertiary">{{ tasks.length }} 张参考图</span>
        </div>
        <div class="flex items-center gap-2">
          <button v-if="tasks.length && !batchRunning" @click="clearAll" class="text-[10px] text-text-tertiary hover:text-red-500 transition-colors">清空全部</button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-4">
        <!-- Empty state -->
        <div v-if="!tasks.length" class="flex-1 flex flex-col items-center justify-center py-20">
          <div class="w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
            <svg class="w-8 h-8 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" /></svg>
          </div>
          <p class="text-sm font-medium text-text-secondary mb-1">添加参考图开始批量生图</p>
          <p class="text-xs text-text-tertiary">在左侧点击"添加参考图"上传多张图片</p>
        </div>

        <!-- Task cards -->
        <div v-else class="grid grid-cols-2 gap-3">
          <div
            v-for="(task, idx) in tasks"
            :key="task.id"
            :class="['rounded-xl border bg-surface-0 overflow-hidden transition-shadow', task.status === 'error' ? 'border-red-300 dark:border-red-800' : task.status === 'done' ? 'border-green-300 dark:border-green-800' : 'border-surface-3']"
          >
            <div class="flex gap-3 p-3">
              <!-- Reference image thumbnail -->
              <div class="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-surface-2">
                <img :src="task.refImage" class="w-full h-full object-cover" />
              </div>

              <!-- Task info -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-[11px] font-medium text-text-primary">#{{ idx + 1 }}</span>
                  <div class="flex items-center gap-1.5">
                    <!-- Status badge -->
                    <span v-if="task.status === 'pending'" class="text-[10px] text-text-tertiary px-1.5 py-0.5 rounded bg-surface-2">待生成</span>
                    <span v-else-if="task.status === 'generating'" class="text-[10px] text-primary-600 px-1.5 py-0.5 rounded bg-primary-50 flex items-center gap-1">
                      <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                      生成中
                    </span>
                    <span v-else-if="task.status === 'done'" class="text-[10px] text-green-600 px-1.5 py-0.5 rounded bg-green-50 dark:text-green-300 dark:bg-green-900/30">完成</span>
                    <span v-else-if="task.status === 'error'" class="text-[10px] text-red-500 px-1.5 py-0.5 rounded bg-red-50 dark:text-red-300 dark:bg-red-900/30">失败</span>
                    <!-- Remove button -->
                    <button v-if="!batchRunning" @click="removeTask(idx)" class="p-0.5 text-text-tertiary hover:text-red-500 transition-colors">
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                </div>

                <!-- Custom prompt (or show default) -->
                <p class="text-[11px] text-text-secondary line-clamp-2 mb-1.5">{{ task.customPrompt || defaultPrompt || '(未设置提示词)' }}</p>

                <!-- Size display（批量场景必带参考图，画质对 /edits 无效不展示） -->
                <div class="flex items-center gap-2 text-[10px] text-text-tertiary">
                  <span>{{ task.customSize || defaultSize }}</span>
                </div>
              </div>

              <!-- Result thumbnail -->
              <div v-if="task.status === 'done' && task.resultPath" class="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-surface-2 relative group/result">
                <img :src="localFileUrl(task.resultPath!)" class="w-full h-full object-cover cursor-pointer" @click="openPreview(task.resultPath!)" />
                <div class="absolute inset-0 flex items-center justify-center gap-1 opacity-0 group-hover/result:opacity-100 transition-opacity bg-black/30">
                  <button @click.stop="copyImage(task.resultPath!)" class="w-7 h-7 rounded-lg bg-black/50 hover:bg-black/70 text-white flex items-center justify-center" title="复制图片">
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" /></svg>
                  </button>
                  <button v-if="task.genId" @click.stop="editImage(task.genId)" class="w-7 h-7 rounded-lg bg-black/50 hover:bg-black/70 text-white flex items-center justify-center" title="编辑">
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>
                  </button>
                </div>
              </div>
            </div>

            <!-- Expandable custom settings -->
            <div v-if="!batchRunning" class="border-t border-surface-2">
              <button @click="task.expanded = !task.expanded" class="w-full px-3 py-1.5 text-[10px] text-text-tertiary hover:text-text-secondary flex items-center justify-center gap-1 transition-colors">
                <svg :class="['w-3 h-3 transition-transform', task.expanded ? 'rotate-180' : '']" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                {{ task.expanded ? '收起' : '自定义设置' }}
              </button>
              <div v-if="task.expanded" class="px-3 pb-3 space-y-3">
                <div>
                  <label class="text-[10px] font-medium text-text-tertiary mb-1 block">自定义提示词 (留空使用默认)</label>
                  <PromptTextarea
                    v-model="task.customPrompt"
                    title="编辑单图自定义提示词"
                    :height="72"
                    :max-length="IMAGE_PROMPT_MAX_LENGTH"
                    placeholder="留空使用默认提示词..."
                    input-class="text-[11px]"
                  />
                </div>
                <div>
                  <label class="text-[10px] font-medium text-text-tertiary mb-1 block">尺寸</label>
                  <ImageSizePicker
                    v-model="task.customSize"
                    layout="select"
                    allow-inherit
                    :inherit-label="`默认 (${defaultSize})`"
                    :model-id="pureSelectedModelId"
                    :tier-id="defaultTier"
                  />
                </div>
              </div>
            </div>

            <!-- Error message -->
            <div v-if="task.status === 'error' && task.error" class="px-3 pb-2 flex items-start gap-2">
              <p class="flex-1 min-w-0 text-[10px] text-red-500 line-clamp-2">{{ translateError(task.error) }}</p>
              <button
                type="button"
                @click.stop="openErrorDialog(task)"
                class="flex-shrink-0 px-1.5 py-0.5 text-[10px] text-red-600 border border-red-300 rounded-md hover:bg-red-50 dark:text-red-300 dark:border-red-800 dark:hover:bg-red-900/20 transition-colors"
              >详情</button>
              <button
                type="button"
                @click.stop="askRetry(task)"
                :disabled="batchRunning"
                class="flex-shrink-0 px-1.5 py-0.5 text-[10px] text-primary-700 border border-primary-300 rounded-md hover:bg-primary-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >重试</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Preset Prompt Modal -->
    <div v-if="showPresetPopup" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="showPresetPopup = false">
      <div class="w-[480px] max-h-[70vh] bg-surface-0 border border-surface-3 rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] flex flex-col">
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-surface-3">
          <h3 class="text-sm font-semibold text-text-primary">预设提示词</h3>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="text-[11px] text-primary-600 hover:text-primary-700"
              @click="goManagePresets"
            >管理</button>
            <button @click="showPresetPopup = false" class="p-1 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          <div v-for="cat in promptPresets" :key="cat.id">
            <div class="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">{{ cat.name }}</div>
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="item in cat.items"
                :key="item.id"
                @click="defaultPrompt = item.content; showPresetPopup = false"
                class="text-left p-3 rounded-xl border border-surface-3 hover:border-primary-400 hover:bg-primary-50 transition-colors"
              >
                <div class="text-xs font-medium text-text-primary mb-1">{{ item.label }}</div>
                <div class="text-[10px] text-text-tertiary line-clamp-2">{{ item.content }}</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <div v-if="copyToast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-surface-0 shadow-lg border border-surface-3 text-xs text-text-primary">{{ copyToast }}</div>

    <SavePresetModal
      :open="savePresetOpen"
      type="image_gen"
      :content="savePresetContent"
      @close="savePresetOpen = false"
      @saved="onPresetSaved"
    />

    <!-- Image Preview Overlay -->
    <ImageLightbox
      :src="previewImage"
      :on-copy="copyPreviewImage"
      @close="closePreview"
    />

    <!-- Error detail dialog -->
    <ErrorDetailDialog
      :visible="errorDialog.visible"
      :raw-error="errorDialog.rawError"
      title="生成失败详情"
      @close="errorDialog.visible = false"
    />

    <!-- Retry confirm dialog -->
    <ConfirmDialog
      :visible="confirmDialog.visible"
      title="重试当前任务"
      message="将以原参数重新执行此条任务，是否继续？"
      confirm-text="重试"
      @confirm="confirmRetry"
      @cancel="cancelRetry"
    />
    <GalleryPicker v-model:visible="showGalleryPicker" :multiple="true" mode="creation-reference" @select="onGalleryRefSelect" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, reactive } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useImageGenStore } from '@/stores/image-gen'
import { useBatchGenFormStore } from '@/stores/batch-gen-form'
import type { BatchTask as BatchGenTask } from '@/stores/batch-gen-form'
import { useModelStore } from '@/stores/models'
import { stripModelId } from '@shared/model-id'
import { usePromptPresetStore } from '@/stores/prompt-presets'
import { useHandoffStore } from '@/stores/handoff'
import { useSiteConfigStore } from '@/stores/site-config'
import { recordUsage, warmHintsCache } from '@/utils/model-usage-hints'
import { resolveStudioModel } from '@/utils/image-gen-models'
import ImageSizePicker from '@/components/ImageSizePicker.vue'
import ResolutionTierPicker from '@/components/ResolutionTierPicker.vue'
import { DEFAULT_QUALITY_ID } from '@shared/image-size'
import { stripImageMetadata } from '@shared/strip-image-metadata'
import ErrorDetailDialog from '@/components/ErrorDetailDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import GalleryPicker from '@/components/GalleryPicker.vue'
import ImageLightbox from '@/components/ImageLightbox.vue'
import { translateError, isBalanceError } from '@/utils/error-message'
import PromptTextarea from '@/components/PromptTextarea.vue'
import StylePresetPicker from '@/components/StylePresetPicker.vue'
import WorkspaceBrandChip from '@/components/WorkspaceBrandChip.vue'
import ChatModelSwitcher from '@/components/ChatModelSwitcher.vue'
import SavePresetModal from '@/components/SavePresetModal.vue'
import { useStylePresetStore } from '@/stores/style-presets'
import { composePromptWithStyle } from '@shared/style-prompt'
import { IMAGE_PROMPT_MAX_LENGTH } from '@shared/prompt-limits'
import { fetchBrandOptimizeAddon } from '@/utils/brand-optimize'
import { detectPromptLang } from '@/utils/prompt-lang'
import { useImageBilling } from '@/views/ecom/useImageBilling'
import { useLowBalanceStore } from '@/stores/low-balance'

// BatchTask 类型已提到 stores/batch-gen-form.ts，下面作为本地别名使用
type BatchTask = BatchGenTask

const router = useRouter()
const store = useImageGenStore()
const modelStore = useModelStore()
const siteConfigStore = useSiteConfigStore()
const { checkBalance } = useImageBilling()
const lowBalance = useLowBalanceStore()
const presetStore = usePromptPresetStore()
const handoff = useHandoffStore()

// 会话级表单+任务草稿：路由切换不丢，重启 app 后重置
const formStore = useBatchGenFormStore()
const {
  defaultPrompt,
  selectedProviderId,
  selectedModelId,
  optimizeProviderId,
  optimizeModelId,
  defaultSize,
  defaultTier,
  stylePresetId,
  concurrency,
  batchRunning,
  tasks,
  taskIdCounter,
} = storeToRefs(formStore)

// 风格预设：选中风格的提示词片段（失效 id 自动降级为空串 = 无风格）
const stylePresetStore = useStylePresetStore()
const styleFragment = computed(() => stylePresetStore.byId(stylePresetId.value)?.prompt_fragment || '')

// selectedModelId 可能是复合 key `gpt-image-2#@多米`，Picker 内部按纯关键字匹配，必须 strip
// 后才能正确识别型号专属参数（如 gpt-image-2 的 size/tier 选项）。
const pureSelectedModelId = computed(() => stripModelId(selectedModelId.value))

// 错误详情弹窗：仅存原文，友好翻译由 ErrorDetailDialog 内部派生
const errorDialog = ref<{ visible: boolean; rawError: string }>({
  visible: false,
  rawError: ''
})
function openErrorDialog(task: Pick<BatchTask, 'error'>) {
  errorDialog.value = { visible: true, rawError: task.error || '' }
}

// 确认弹窗：避免误点直接触发重试
const confirmDialog = ref<{ visible: boolean; pending: BatchTask | null }>({
  visible: false,
  pending: null
})
function askRetry(task: BatchTask) {
  if (batchRunning.value) return
  if (!selectedProviderId.value || !selectedModelId.value) return
  confirmDialog.value = { visible: true, pending: task }
}
async function confirmRetry() {
  const task = confirmDialog.value.pending
  confirmDialog.value = { visible: false, pending: null }
  if (!task) return
  await retryTask(task)
}
function cancelRetry() {
  confirmDialog.value = { visible: false, pending: null }
}

const promptPresets = computed(() => presetStore.visibleGrouped('image_gen'))

const optimizing = ref(false)
const showPresetPopup = ref(false)
const savePresetOpen = ref(false)
const savePresetContent = ref('')

function openSavePreset(text: string) {
  const content = String(text || '').trim()
  if (!content) return
  savePresetContent.value = content
  savePresetOpen.value = true
}

function onPresetSaved() {
  copyToast.value = '已存为预设'
  setTimeout(() => { copyToast.value = '' }, 2000)
}

function goManagePresets() {
  showPresetPopup.value = false
  router.push({ path: '/prompts', query: { type: 'image_gen' } })
}
const previewImage = ref<string | null>(null)
const previewPath = ref<string>('')

function localFileUrl(path: string): string {
  const isAbsolute = /^[A-Za-z]:|^\//.test(path)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://img?' + param + '=' + encodeURIComponent(path)
}

const selectedProvider = computed(() =>
  modelStore.providers.find(p => p.id === selectedProviderId.value) || null
)
// 多米参考图协议仍在适配中（同 ImageGenView 注释）。BatchGenView 全流程基于参考图，
// 选多米时实际上整个批量入口不可用；按用户口径仅禁用「添加参考图 / 图库选图」按钮 + 提示。
const isDuomiProvider = computed(() => selectedProvider.value?.type === 'duomi')

function onImageModelPick(val: { provider_id: string; model_id: string }) {
  selectedProviderId.value = val.provider_id
  selectedModelId.value = val.model_id
}

function onOptimizeModelPick(val: { provider_id: string; model_id: string }) {
  optimizeProviderId.value = val.provider_id
  optimizeModelId.value = val.model_id
}

const canStart = computed(() =>
  tasks.value.length > 0 &&
  (defaultPrompt.value.trim() || tasks.value.every(t => t.customPrompt.trim())) &&
  // 长度按拼接风格片段后的最终提示词计（默认词与逐任务自定义词都生效）
  composePromptWithStyle(defaultPrompt.value, styleFragment.value).length <= IMAGE_PROMPT_MAX_LENGTH &&
  tasks.value.every(t => !t.customPrompt.trim() || composePromptWithStyle(t.customPrompt, styleFragment.value).length <= IMAGE_PROMPT_MAX_LENGTH) &&
  selectedProviderId.value &&
  selectedModelId.value
)

const completedCount = computed(() =>
  tasks.value.filter(t => t.status === 'done' || t.status === 'error').length
)

function compressImage(dataUri: string, maxSize: number, quality: number): Promise<string> {
  const cleanUri = stripImageMetadata(dataUri)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    img.src = cleanUri
  })
}


async function pickRefImages() {
  try {
    const result = await (window as any).api.dialog.openFile({
      title: '选择参考图片',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || !result.filePaths.length) return

    for (const filePath of result.filePaths) {
      const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
      const raw = await (window as any).api.chat.invoke('readFileBase64', filePath)
      const dataUri = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${raw}`
      const compressed = await compressImage(dataUri, 1024, 0.8)
      tasks.value.push(reactive({
        id: `batch-${++taskIdCounter.value}`,
        refImage: compressed,
        customPrompt: '',
        customSize: '',
        status: 'pending' as const,
        error: '',
        resultPath: null,
        genId: null,
        expanded: false
      }))
    }
  } catch (e) {
    console.error('Failed to pick ref images:', e)
  }
}

const showGalleryPicker = ref(false)

async function onGalleryRefSelect(paths: string[]) {
  if (!paths.length) return
  try {
    for (const filePath of paths) {
      const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
      const raw = await (window as any).api.chat.invoke('readFileBase64', filePath)
      const dataUri = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${raw}`
      const compressed = await compressImage(dataUri, 1024, 0.8)
      tasks.value.push(reactive({
        id: `batch-${++taskIdCounter.value}`,
        refImage: compressed,
        customPrompt: '',
        customSize: '',
        status: 'pending' as const,
        error: '',
        resultPath: null,
        genId: null,
        expanded: false
      }))
    }
  } catch (e) {
    console.error('Failed to load gallery ref images:', e)
  }
}

function removeTask(idx: number) {
  tasks.value.splice(idx, 1)
}

function clearAll() {
  tasks.value = []
}

const OPTIMIZE_CN_PROMPT = `你是一个专业的 AI 图片生成提示词工程师。请将以下描述优化为高质量的中文生图提示词。

优化要求：
1. 保持原始创意意图不变
2. 补充画面构图、光影、色调、风格等专业描述
3. 增加细节描述（材质、纹理、氛围等）
4. 结构清晰，主体描述在前，风格修饰在后
5. 控制在 200 字以内

请直接输出优化后的提示词，不要包含任何解释。`

const OPTIMIZE_EN_PROMPT = `You are a professional AI image generation prompt engineer. Optimize the following description into a high-quality English image generation prompt.

Requirements:
1. Preserve the original creative intent
2. Add composition, lighting, color tone, and style descriptors
3. Include detail descriptions (materials, textures, atmosphere)
4. Structure: subject first, then style modifiers
5. Keep within 200 words

Output only the optimized prompt, no explanations.`

async function optimizeDefaultPrompt() {
  if (!defaultPrompt.value.trim() || !optimizeProviderId.value || !optimizeModelId.value) return
  const lang = detectPromptLang(defaultPrompt.value)
  optimizing.value = true
  try {
    const systemPrompt =
      (lang === 'cn' ? OPTIMIZE_CN_PROMPT : OPTIMIZE_EN_PROMPT) +
      (await fetchBrandOptimizeAddon(defaultPrompt.value))
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: defaultPrompt.value }
    ]
    // 保留复合 key 传给 main，main 端按服务商反查 cloud_model_id 精确路由
    const result = await (window as any).api.llm.invoke('call', optimizeProviderId.value, optimizeModelId.value, messages)
    if (result) defaultPrompt.value = result
    await recordUsage('chat', optimizeProviderId.value, optimizeModelId.value)
  } catch (e: any) {
    console.error('Optimize failed:', e)
  } finally {
    optimizing.value = false
  }
}

// 单条执行。提到顶层供 startAll 和 retryTask 共用，避免重复实现。
// task.error 始终保留后端原文，展示层由 translateError 现场派生友好翻译。
async function runOne(task: BatchTask): Promise<void> {
  task.status = 'generating'
  task.error = ''
  try {
    const prompt = composePromptWithStyle(task.customPrompt.trim() || defaultPrompt.value.trim(), styleFragment.value)
    const size = task.customSize || defaultSize.value

    const results = await store.generate({
      prompt,
      refImages: [task.refImage],
      modelProviderId: selectedProviderId.value,
      modelId: selectedModelId.value,
      size,
      tierId: defaultTier.value,
      quality: DEFAULT_QUALITY_ID,
      batchCount: 1,
      applyWorkspaceBrand: true
    })

    const gen = (results || [])[0]
    if (gen && gen.status === 'done' && gen.result_path) {
      task.status = 'done'
      task.resultPath = gen.result_path
      task.genId = gen.id
    } else {
      task.status = 'error'
      task.error = gen?.error || '生成失败'
    }
  } catch (e: any) {
    task.status = 'error'
    task.error = e?.message || '生成失败'
  }
}

async function startAll() {
  if (!canStart.value || batchRunning.value) return

  const queue = tasks.value.filter(t => t.status !== 'done')
  // 前置余额拦截：按「单价 × 张数」估算整批消耗，不够直接弹充值引导，不浪费整队失败请求
  const bal = checkBalance(selectedProviderId.value, selectedModelId.value, queue.length)
  if (!bal.ok) {
    lowBalance.open({ balanceType: bal.balanceType, required: bal.required, available: bal.available })
    return
  }

  batchRunning.value = true
  for (const t of queue) { t.status = 'pending'; t.error = '' }
  const limit = Math.max(1, Math.min(concurrency.value, queue.length, 10))
  let cursor = 0
  let balanceStopped = false

  async function worker() {
    while (cursor < queue.length && !balanceStopped) {
      const task = queue[cursor++]
      if (!task) break
      await runOne(task)
      // 跑批途中余额耗尽：立即停队，避免后续每条都失败刷满红字
      if (task.status === 'error' && isBalanceError(task.error)) {
        balanceStopped = true
        lowBalance.open({ balanceType: 'credit', required: 0, available: 0 })
      }
    }
  }

  const workers = Array.from({ length: limit }, () => worker())
  await Promise.all(workers)

  // 因余额中止：把还没跑的任务标注清楚，避免用户以为它们悄悄成功了
  if (balanceStopped) {
    for (const t of queue) {
      if (t.status === 'pending') { t.status = 'error'; t.error = '余额不足，已暂停后续生成' }
    }
  }

  batchRunning.value = false
  // Record usage after at least one success so the image model bubbles up next time
  if (tasks.value.some(t => t.status === 'done')) {
    await recordUsage('image', selectedProviderId.value, selectedModelId.value)
  }
}

// 单条重试：复用 runOne，包装 batchRunning 状态以避免与批量执行并发
async function retryTask(task: BatchTask) {
  if (batchRunning.value) return
  if (!selectedProviderId.value || !selectedModelId.value) return
  batchRunning.value = true
  try {
    await runOne(task)
    if (task.status === 'done') {
      await recordUsage('image', selectedProviderId.value, selectedModelId.value)
    }
  } finally {
    batchRunning.value = false
  }
}

const copyToast = ref('')

function openPreview(path: string) {
  previewPath.value = path
  previewImage.value = localFileUrl(path)
}
function closePreview() {
  previewImage.value = null
  previewPath.value = ''
}
function copyPreviewImage() {
  if (previewPath.value) copyImage(previewPath.value)
}

async function copyImage(path: string) {
  try {
    const res = await window.api.clipboard.writeImage(path)
    if (res.success) {
      copyToast.value = '已复制到剪贴板'
    } else {
      copyToast.value = '复制失败: ' + (res.error || '')
    }
  } catch (e: any) {
    copyToast.value = '复制失败'
  }
  setTimeout(() => { copyToast.value = '' }, 2000)
}

function editImage(genId: string) {
  router.push(`/image-edit/${genId}`)
}

watch(selectedModelId, (v) => {
  if (v) {
    window.api.settings.invoke('set', 'imagegen_provider_id', selectedProviderId.value)
    window.api.settings.invoke('set', 'imagegen_model_id', v)
  }
})
watch(defaultTier, (v) => {
  if (v) window.api.settings.invoke('set', 'imagegen_tier_id', v)
})
watch(optimizeModelId, (v) => {
  if (v) {
    window.api.settings.invoke('set', 'imagegen_optimize_provider_id', optimizeProviderId.value)
    window.api.settings.invoke('set', 'imagegen_optimize_model_id', v)
  }
})

onMounted(async () => {
  store.listenProgress()
  // BatchGenView 自己维护 tasks 数组，不消费 store.generations / items，
  // 因此不需要 fetch 历史记录；仅保留 listenProgress 以获取每条生成的进度事件。
  await Promise.all([modelStore.fetchProviders(), presetStore.fetchAll('image_gen'), warmHintsCache()])

  const all = (await window.api.settings.invoke('getAll')) as Record<string, string>
  const imagePick = resolveStudioModel(modelStore, {
    provider_id: selectedProviderId.value || all['imagegen_provider_id'],
    model_id: selectedModelId.value || all['imagegen_model_id']
  }, 'image')
  selectedProviderId.value = imagePick.provider_id
  selectedModelId.value = imagePick.model_id
  const optimizePick = resolveStudioModel(
    modelStore,
    {
      provider_id: optimizeProviderId.value || all['imagegen_optimize_provider_id'],
      model_id: optimizeModelId.value || all['imagegen_optimize_model_id']
    },
    'chat',
    siteConfigStore
  )
  optimizeProviderId.value = optimizePick.provider_id
  optimizeModelId.value = optimizePick.model_id
  if (all['imagegen_tier_id']) defaultTier.value = all['imagegen_tier_id']

  const pending = handoff.consume<{ prompt?: string }>('batchGen')
  if (pending?.prompt) defaultPrompt.value = pending.prompt
})

onUnmounted(() => {
  store.stopListenProgress()
})
</script>
