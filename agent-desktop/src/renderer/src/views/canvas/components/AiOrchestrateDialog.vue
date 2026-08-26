<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none">
      <div
        class="pointer-events-auto w-[640px] max-h-[90vh] bg-surface-0 rounded-2xl shadow-2xl border border-surface-3 flex flex-col"
        @click.stop
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-surface-3 flex-shrink-0">
          <div>
            <h3 class="text-base font-semibold text-text-primary">智能编排 · 生成画布骨架</h3>
            <p class="text-xs text-text-secondary mt-1">结构由配置决定，AI 只填提示词内容</p>
          </div>
          <button
            @click="onCancel"
            :disabled="running"
            class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 disabled:opacity-30 transition-colors"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto p-6 space-y-5">
          <!-- Project description -->
          <div>
            <div class="flex items-center justify-between mb-1.5 gap-3">
              <div class="flex items-center gap-2 min-w-0">
                <label class="text-sm font-medium text-text-primary flex-shrink-0">项目整体描述</label>
                <button
                  @click="onInfer"
                  :disabled="!projectDescription.trim() || inferring || running"
                  :title="!projectDescription.trim() ? '先填入项目描述后才能智能填充' : '调用 AI 拆解描述为分组配置，仅回填表单'"
                  class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-primary-300 text-primary-600 hover:bg-primary-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <svg v-if="inferring" class="w-3.5 h-3.5 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  <svg v-else class="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                  </svg>
                  {{ inferring ? '填充中...' : 'AI 智能填充' }}
                </button>
              </div>
              <span class="text-xs text-text-tertiary flex-shrink-0">AI 以此为基础生成提示词</span>
            </div>
            <PromptTextarea
              v-model="projectDescription"
              :disabled="running"
              title="编辑项目整体描述"
              :height="96"
              placeholder="例如：XX 商品电商图，整体风格简约现代，主色调明亮，强调商品质感..."
              input-class="text-sm"
            />
          </div>

          <!-- Groups -->
          <div>
            <div class="flex items-baseline justify-between mb-2">
              <label class="text-sm font-medium text-text-primary">分组</label>
              <span class="text-xs text-text-tertiary">每组独立的参考策略与业务图</span>
            </div>

            <div class="space-y-3">
              <div
                v-for="(group, gIdx) in groups"
                :key="group._id"
                class="border border-surface-3 rounded-xl p-4 bg-surface-1 space-y-3"
              >
                <!-- Group title row -->
                <div class="flex items-center gap-2">
                  <span class="text-sm font-semibold text-text-secondary w-8 flex-shrink-0">#{{ gIdx + 1 }}</span>
                  <input
                    v-model="group.name"
                    :disabled="running"
                    maxlength="20"
                    placeholder="组名，如 轮播图 / 详情页 / 管理端"
                    class="flex-1 text-sm text-text-primary bg-surface-0 border border-surface-3 rounded-lg px-3 py-2 outline-none focus:border-primary-400 transition-colors"
                  />
                  <button
                    v-if="groups.length > 1"
                    @click="removeGroup(gIdx)"
                    :disabled="running"
                    class="p-1.5 rounded text-text-tertiary hover:text-red-500 hover:bg-surface-2 disabled:opacity-30 transition-colors"
                    title="删除分组"
                  >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <!-- Reference strategy -->
                <div>
                  <div class="text-xs font-medium text-text-secondary mb-1.5">参考策略</div>
                  <div class="grid grid-cols-3 gap-2">
                    <button
                      v-for="opt in refOptions"
                      :key="opt.value"
                      @click="group.refStrategy = opt.value"
                      :disabled="running"
                      class="px-3 py-2 text-left rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      :class="group.refStrategy === opt.value
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-surface-3 bg-surface-0 text-text-secondary hover:bg-surface-2'"
                    >
                      <div class="text-sm font-medium">{{ opt.label }}</div>
                      <div
                        class="text-xs mt-0.5 font-normal"
                        :class="group.refStrategy === opt.value ? 'text-primary-600' : 'text-text-tertiary'"
                      >{{ opt.desc }}</div>
                    </button>
                  </div>
                </div>

                <!-- Business count + group-level size/quality -->
                <div class="flex items-center gap-3 flex-wrap">
                  <label class="text-xs font-medium text-text-secondary">业务图数</label>
                  <input
                    v-model.number="group.businessCount"
                    :disabled="running"
                    type="number"
                    min="1"
                    max="20"
                    class="w-20 text-sm text-text-primary bg-surface-0 border border-surface-3 rounded-lg px-2.5 py-1.5 outline-none focus:border-primary-400"
                  />
                  <span class="text-xs text-text-tertiary">1 ~ 20</span>
                  <label class="text-xs font-medium text-text-secondary ml-2">比例</label>
                  <div class="w-28">
                    <ImageSizePicker
                      v-model="group.size"
                      layout="select"
                      :disabled="running"
                      :model-id="projectImageModelId"
                      :tier-id="group.tier"
                    />
                  </div>
                  <label class="text-xs font-medium text-text-secondary">分辨率</label>
                  <ResolutionTierPicker
                    :model-value="group.tier || DEFAULT_TIER_ID"
                    @update:model-value="(v) => (group.tier = v)"
                    size="sm"
                    :disabled="running"
                    :model-id="projectImageModelId"
                    :size-value="group.size"
                  />
                  <label class="text-xs font-medium text-text-secondary">质量</label>
                  <select
                    v-model="group.quality"
                    :disabled="running"
                    class="text-sm text-text-primary bg-surface-0 border border-surface-3 rounded-lg px-2 py-1.5 outline-none focus:border-primary-400"
                  >
                    <option v-for="opt in qualityOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                  </select>
                  <span class="ml-auto text-xs text-text-tertiary">
                    预计 <span class="text-text-primary font-semibold">{{ estimateGroupNodes(group) }}</span> 节点
                  </span>
                </div>

                <!-- Group description -->
                <div>
                  <label class="text-xs font-medium text-text-secondary mb-1.5 block">组内细节描述（可选）</label>
                  <PromptTextarea
                    v-model="group.description"
                    :disabled="running"
                    title="编辑组内细节描述"
                    :height="72"
                    placeholder="这一组图的主题、风格要求、差异化方向...当提示词留空时用于引导 AI 撰写"
                    input-class="text-sm"
                  />
                </div>

                <!-- Reference text (only for textgen) -->
                <div v-if="group.refStrategy === 'textgen'">
                  <div class="flex items-center justify-between mb-1.5">
                    <label class="text-xs font-medium text-text-secondary">参考页提示词（可选）</label>
                    <span class="text-[10px] text-text-tertiary">{{ group.referenceText?.trim() ? '用户原文·跳过 AI' : '留空 → AI 自动生成' }}</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <PromptTextarea
                      :model-value="group.referenceText || ''"
                      @update:model-value="group.referenceText = $event"
                      :disabled="running"
                      title="编辑参考页提示词"
                      :height="88"
                      :max-length="IMAGE_PROMPT_MAX_LENGTH"
                      placeholder="填入原文将作为参考图的提示词，不调 AI；留空则由 AI 根据组内细节描述自动撰写"
                      container-class="flex-1"
                      input-class="text-sm"
                    />
                    <div class="flex flex-col gap-1.5 flex-shrink-0 w-28">
                      <ImageSizePicker
                        :model-value="group.referenceSize ?? ''"
                        @update:model-value="(v) => group.referenceSize = v || undefined"
                        layout="select"
                        allow-inherit
                        :inherit-label="`继承 ${group.size}`"
                        :disabled="running"
                        :model-id="projectImageModelId"
                        :tier-id="group.tier"
                      />
                      <select
                        v-model="group.referenceQuality"
                        :disabled="running"
                        :title="group.referenceQuality ? '参考图质量覆盖' : '继承组级质量'"
                        class="text-[11px] bg-surface-0 rounded px-1.5 py-1 outline-none focus:border-primary-400 border"
                        :class="group.referenceQuality ? 'border-primary-300 text-primary-700' : 'border-surface-3 text-text-tertiary'"
                      >
                        <option value="">继承 {{ qualityLabel(group.quality) }}</option>
                        <option v-for="opt in qualityOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                      </select>
                    </div>
                  </div>
                </div>

                <!-- Business texts -->
                <div v-if="(group.businessCount || 0) > 0">
                  <div class="flex items-center justify-between mb-1.5">
                    <label class="text-xs font-medium text-text-secondary">业务图提示词（可选）</label>
                    <span class="text-[10px] text-text-tertiary">每张独立文案、比例、质量；留空 → AI 自动生成</span>
                  </div>
                  <div class="space-y-2">
                    <div
                      v-for="i in Math.max(1, Math.min(20, group.businessCount || 1))"
                      :key="i"
                      class="flex items-start gap-2"
                    >
                      <span class="text-[11px] font-medium text-text-tertiary flex-shrink-0 w-6 mt-2 text-right">{{ i }}.</span>
                      <PromptTextarea
                        :model-value="getBizText(group, i - 1)"
                        @update:model-value="setBizText(group, i - 1, $event)"
                        :disabled="running"
                        :title="`编辑第 ${i} 张业务图提示词`"
                        :height="72"
                        :max-length="IMAGE_PROMPT_MAX_LENGTH"
                        :placeholder="`第 ${i} 张图：填入原文将直用，留空由 AI 撰写`"
                        container-class="flex-1"
                        input-class="text-sm"
                      />
                      <div class="flex flex-col gap-1.5 flex-shrink-0 w-28">
                        <ImageSizePicker
                          :model-value="getBizSize(group, i - 1)"
                          @update:model-value="(v) => setBizSize(group, i - 1, v)"
                          layout="select"
                          allow-inherit
                          :inherit-label="`继承 ${group.size}`"
                          :disabled="running"
                          :model-id="projectImageModelId"
                          :tier-id="group.tier"
                        />
                        <select
                          :value="getBizQuality(group, i - 1)"
                          @change="setBizQuality(group, i - 1, ($event.target as HTMLSelectElement).value)"
                          :disabled="running"
                          :title="getBizQuality(group, i - 1) ? '此图质量覆盖' : '继承组级质量'"
                          class="text-[11px] bg-surface-0 rounded px-1.5 py-1 outline-none focus:border-primary-400 border"
                          :class="getBizQuality(group, i - 1) ? 'border-primary-300 text-primary-700' : 'border-surface-3 text-text-tertiary'"
                        >
                          <option value="">继承 {{ qualityLabel(group.quality) }}</option>
                          <option v-for="opt in qualityOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <button
                @click="addGroup"
                :disabled="running || groups.length >= 10"
                class="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-text-secondary border border-dashed border-surface-3 rounded-xl hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                添加分组{{ groups.length >= 10 ? '（已达上限 10）' : '' }}
              </button>
            </div>
          </div>

          <!-- Summary / Status -->
          <div
            v-if="summary || progressMessage || errorMessage"
            class="rounded-xl border p-3 text-sm"
            :class="errorMessage
              ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
              : progressMessage
                ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300'
                : 'border-surface-3 bg-surface-1 text-text-secondary'"
          >
            <div v-if="errorMessage" class="flex items-start gap-2">
              <svg class="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              <div class="break-words">{{ errorMessage }}</div>
            </div>
            <div v-else-if="progressMessage" class="flex items-center gap-2">
              <svg class="w-4 h-4 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <span>{{ progressMessage }}</span>
            </div>
            <div v-else-if="summary" class="flex items-baseline gap-1">
              <span>总计：</span>
              <span class="font-semibold text-text-primary">{{ summary.nodes }}</span>
              <span>节点</span>
              <span class="text-text-tertiary">·</span>
              <span class="font-semibold text-text-primary">{{ summary.edges }}</span>
              <span>连线</span>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between gap-3 px-6 py-4 border-t border-surface-3 flex-shrink-0">
          <div class="text-xs text-text-tertiary flex-1">
            生成后不会自动执行，请自行检查后再运行
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <button
              @click="onCancel"
              class="px-4 py-2 text-sm text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors"
            >
              取消
            </button>
            <button
              @click="onSubmit"
              :disabled="running || !canSubmit"
              class="px-5 py-2 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {{ running ? '编排中...' : '开始编排' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  useAiOrchestrator,
  ORCHESTRATE_QUALITY_OPTIONS,
  type OrchestrateGroup,
  type OrchestrateRefStrategy
} from '../composables/useAiOrchestrator'
import ImageSizePicker from '@/components/ImageSizePicker.vue'
import ResolutionTierPicker from '@/components/ResolutionTierPicker.vue'
import PromptTextarea from '@/components/PromptTextarea.vue'
import { useCanvasStore } from '@/stores/canvas'
import { DEFAULT_TIER_ID } from '@shared/image-size'
import { IMAGE_PROMPT_MAX_LENGTH } from '@shared/prompt-limits'

const canvasStore = useCanvasStore()
/** 从当前项目拿生图模型 id，用于所有能力域相关的渲染 */
const projectImageModelId = computed(() => canvasStore.currentProject?.image_model_id || '')

interface GroupForm extends OrchestrateGroup {
  // Stable id for Vue's :key during re-ordering/removal
  _id: string
}

const props = withDefaults(defineProps<{
  visible: boolean
  projectId: string
  initialDescription?: string
}>(), {
  initialDescription: ''
})

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'done', result: { nodeIds: string[]; edgeIds: string[] }): void
}>()

const refOptions: { value: OrchestrateRefStrategy; label: string; desc: string }[] = [
  { value: 'textgen', label: 'AI 文生参考', desc: '生成参考文本 + 参考图' },
  { value: 'upload', label: '上传参考图', desc: '后续手动拖入图片' },
  { value: 'none', label: '无参考', desc: '每张图独立生成' }
]

const qualityOptions = ORCHESTRATE_QUALITY_OPTIONS
const qualityLabelMap: Record<string, string> = Object.fromEntries(
  qualityOptions.map((o) => [o.value, o.label])
)
function qualityLabel(v: string): string {
  return qualityLabelMap[v] || v
}

function newGroup(): GroupForm {
  return {
    _id: Math.random().toString(36).slice(2, 10),
    name: '',
    refStrategy: 'textgen',
    businessCount: 3,
    description: '',
    size: '1:1',
    quality: 'auto',
    tier: DEFAULT_TIER_ID,
    referenceText: '',
    businessTexts: [],
    businessSizes: [],
    businessQualities: []
  }
}

/** Safe getter for business text at index i; returns '' when array is shorter. */
function getBizText(g: GroupForm, i: number): string {
  return g.businessTexts?.[i] ?? ''
}

/** Setter that lazily grows businessTexts to cover index i.
 * Keeps the array's leading indices intact so other rows don't shift. */
function setBizText(g: GroupForm, i: number, val: string) {
  if (!g.businessTexts) g.businessTexts = []
  while (g.businessTexts.length <= i) g.businessTexts.push('')
  g.businessTexts[i] = val
}

/** Safe getter for per-node size/quality override; '' represents inherit. */
function getBizSize(g: GroupForm, i: number): string {
  return g.businessSizes?.[i] ?? ''
}
function getBizQuality(g: GroupForm, i: number): string {
  return g.businessQualities?.[i] ?? ''
}
/** Setter for per-node override; empty string means inherit group-level. */
function setBizSize(g: GroupForm, i: number, val: string) {
  if (!g.businessSizes) g.businessSizes = []
  while (g.businessSizes.length <= i) g.businessSizes.push(undefined)
  g.businessSizes[i] = val || undefined
}
function setBizQuality(g: GroupForm, i: number, val: string) {
  if (!g.businessQualities) g.businessQualities = []
  while (g.businessQualities.length <= i) g.businessQualities.push(undefined)
  g.businessQualities[i] = val || undefined
}

const projectDescription = ref('')
const groups = ref<GroupForm[]>([newGroup()])
const running = ref(false)
const inferring = ref(false)
const progressMessage = ref('')
const errorMessage = ref('')

const { orchestrate, inferGroups, buildSkeleton } = useAiOrchestrator()
const api = () => (window as any).api

let inferReqId = ''
let orchestrateReqId = ''
function genReqId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}
function cancelPendingRequests() {
  if (inferReqId) { api().llm.invoke('cancel', inferReqId); inferReqId = '' }
  if (orchestrateReqId) { api().llm.invoke('cancel', orchestrateReqId); orchestrateReqId = '' }
}

// Reset form when dialog opens, so reopening after a successful run starts clean.
watch(
  () => props.visible,
  (v) => {
    if (v) {
      projectDescription.value = props.initialDescription || ''
      groups.value = [newGroup()]
      progressMessage.value = ''
      errorMessage.value = ''
      running.value = false
      inferring.value = false
    } else {
      cancelPendingRequests()
    }
  }
)

// Ask the LLM to populate the groups list from the free-form description.
// This ONLY mutates the form — it never writes to the canvas. The user must
// still click 「开始编排」 to actually generate nodes.
async function onInfer() {
  if (!projectDescription.value.trim() || inferring.value || running.value) return
  errorMessage.value = ''
  inferring.value = true
  cancelPendingRequests()
  const reqId = genReqId('infer')
  inferReqId = reqId
  try {
    const inferred = await inferGroups(projectDescription.value, reqId)
    // Replace the entire groups list with the AI suggestion. We deliberately
    // overwrite even if the user already edited groups manually — they asked
    // for a fresh inference. They can keep undo'ing by closing/reopening the
    // dialog (since visible-watch resets state).
    groups.value = inferred.map((g) => ({
      _id: Math.random().toString(36).slice(2, 10),
      name: g.name,
      refStrategy: g.refStrategy,
      businessCount: g.businessCount,
      description: g.description,
      size: g.size || '1:1',
      quality: g.quality || 'auto',
      tier: g.tier || DEFAULT_TIER_ID,
      referenceText: g.referenceText || '',
      referenceSize: g.referenceSize,
      referenceQuality: g.referenceQuality,
      businessTexts: Array.isArray(g.businessTexts)
        ? [...g.businessTexts]
        : Array(g.businessCount).fill(''),
      businessSizes: Array.isArray(g.businessSizes) ? [...g.businessSizes] : [],
      businessQualities: Array.isArray(g.businessQualities) ? [...g.businessQualities] : []
    }))
  } catch (err: any) {
    if (err?.message === 'Aborted' || err?.message?.includes('aborted')) return
    errorMessage.value = (err as Error)?.message || 'AI 智能填充失败'
  } finally {
    if (inferReqId === reqId) inferReqId = ''
    inferring.value = false
  }
}

function addGroup() {
  if (groups.value.length >= 10) return
  groups.value.push(newGroup())
}

function removeGroup(idx: number) {
  if (groups.value.length <= 1) return
  groups.value.splice(idx, 1)
}

/** How many nodes this single group will produce, for inline feedback. */
function estimateGroupNodes(group: GroupForm): number {
  const biz = 2 * Math.max(0, Math.min(20, group.businessCount || 0))
  if (group.refStrategy === 'upload') return biz + 1
  if (group.refStrategy === 'textgen') return biz + 2
  return biz
}

/** Live summary of the full graph — uses the same buildSkeleton the executor
 * uses, so what the user sees before submit matches what actually gets created.
 * Wrapped in try/catch because during editing the config can transiently be
 * invalid (e.g. businessCount = 0) and we don't want to surface those noises.
 */
const summary = computed(() => {
  if (running.value || errorMessage.value) return null
  try {
    const { nodes, edges } = buildSkeleton(
      {
        projectDescription: projectDescription.value,
        groups: groups.value.map((g) => ({
          name: g.name,
          refStrategy: g.refStrategy,
          businessCount: Math.max(1, Math.min(20, g.businessCount || 1)),
          description: g.description,
          size: g.size || '1:1',
          quality: g.quality || 'auto',
          tier: g.tier || DEFAULT_TIER_ID,
          referenceText: g.referenceText,
          referenceSize: g.referenceSize,
          referenceQuality: g.referenceQuality,
          businessTexts: g.businessTexts,
          businessSizes: g.businessSizes,
          businessQualities: g.businessQualities
        }))
      },
      'preview',
      'preview'
    )
    return { nodes: nodes.length, edges: edges.length }
  } catch {
    return null
  }
})

const canSubmit = computed(() => {
  if (!groups.value.length) return false
  return groups.value.every((g) => {
    const c = Number(g.businessCount)
    return Number.isFinite(c) && c >= 1 && c <= 20
  })
})

function onCancel() {
  cancelPendingRequests()
  running.value = false
  inferring.value = false
  emit('close')
}

async function onSubmit() {
  if (!canSubmit.value || running.value || !props.projectId) return
  errorMessage.value = ''
  progressMessage.value = ''
  running.value = true

  cancelPendingRequests()
  const reqId = genReqId('orch')
  orchestrateReqId = reqId
  try {
    const result = await orchestrate(
      props.projectId,
      {
        projectDescription: projectDescription.value,
        groups: groups.value.map((g) => {
          const count = Math.max(1, Math.min(20, g.businessCount || 1))
          const bizSizes = Array.from({ length: count }, (_, i) => g.businessSizes?.[i] || undefined)
          const bizQualities = Array.from({ length: count }, (_, i) => g.businessQualities?.[i] || undefined)
          return {
            name: g.name.trim(),
            refStrategy: g.refStrategy,
            businessCount: count,
            description: g.description.trim(),
            size: g.size || '1:1',
            quality: g.quality || 'auto',
            tier: g.tier || DEFAULT_TIER_ID,
            referenceText: g.referenceText?.trim() || undefined,
            referenceSize: g.referenceSize || undefined,
            referenceQuality: g.referenceQuality || undefined,
            businessTexts: g.businessTexts && g.businessTexts.some((t) => t.trim())
              ? Array.from({ length: count }, (_, i) => (g.businessTexts?.[i] ?? '').trim())
              : undefined,
            businessSizes: bizSizes.some((v) => v) ? bizSizes : undefined,
            businessQualities: bizQualities.some((v) => v) ? bizQualities : undefined
          }
        })
      },
      (p) => {
        if (p.stage === 'error') errorMessage.value = p.message
        else if (p.stage === 'done') progressMessage.value = ''
        else progressMessage.value = p.message
      },
      reqId
    )
    emit('done', result)
    emit('close')
  } catch (err: any) {
    const msg = (err as Error)?.message || ''
    if (msg === 'Aborted' || msg.includes('aborted')) return
    if (!errorMessage.value) {
      errorMessage.value = msg || '编排失败'
    }
  } finally {
    if (orchestrateReqId === reqId) orchestrateReqId = ''
    running.value = false
    progressMessage.value = ''
  }
}
</script>
