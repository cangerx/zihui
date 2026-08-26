<template>
  <div class="h-full flex flex-col">
    <div class="flex-1 grid grid-cols-[380px_1fr] min-h-0 border-t border-surface-3">
      <aside class="flex flex-col min-h-0 border-r border-surface-3 bg-surface-0">
        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          <EcomImageUploader v-model="form.productImages" :max="6" :cols="4" label="产品图" hint="1-6 张不同角度" />
          <div class="grid grid-cols-2 gap-3">
            <EcomImageUploader v-model="styleImages" :max="1" :cols="1" label="风格参考" hint="可选" />
            <EcomImageUploader v-model="logoImages" :max="1" :cols="1" label="品牌 Logo" hint="可选" />
          </div>

          <label class="block">
            <span class="text-sm font-medium text-text-primary">产品名称</span>
            <input v-model="form.productName" class="mt-1.5 w-full px-3 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500" placeholder="如：便携榨汁杯" />
          </label>
          <label class="block">
            <span class="text-sm font-medium text-text-primary">核心卖点</span>
            <textarea v-model="form.sellingPoints" rows="2" class="mt-1.5 w-full px-3 py-2 text-xs bg-surface-1 border border-surface-3 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 resize-none" placeholder="例：防水、超轻、人体工学设计" />
          </label>

          <div class="grid grid-cols-2 gap-3">
            <label class="block">
              <span class="text-sm font-medium text-text-primary">平台</span>
              <select v-model="form.platform" class="mt-1.5 w-full px-2 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500">
                <option v-for="o in PLATFORMS" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>
            <label class="block">
              <span class="text-sm font-medium text-text-primary">语言</span>
              <select v-model="form.language" class="mt-1.5 w-full px-2 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500">
                <option v-for="o in LANGUAGES" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>
          </div>
          <input v-if="form.language === '自定义'" v-model="form.customLanguage" class="w-full px-3 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500" placeholder="请输入自定义语言" />

          <!-- 画面风格预设 -->
          <div>
            <span class="text-sm font-medium text-text-primary">画面风格</span>
            <div class="mt-1.5 flex flex-wrap gap-1.5">
              <button type="button" class="px-2 py-1 rounded-md text-[11px] border transition-colors" :class="!form.stylePreset ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-3 text-text-secondary hover:bg-surface-2'" @click="form.stylePreset = ''">不指定</button>
              <button v-for="s in STYLE_PRESETS" :key="s.value" type="button" class="px-2 py-1 rounded-md text-[11px] border transition-colors" :class="form.stylePreset === s.value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-3 text-text-secondary hover:bg-surface-2'" :title="s.desc" @click="form.stylePreset = s.value">{{ s.label }}</button>
            </div>
          </div>

          <!-- 详情页：模块多选 + 排序（详情页是有序多屏，顺序即生成与展示顺序） -->
          <div v-if="isDetail">
            <span class="text-sm font-medium text-text-primary">详情页模块</span>
            <p class="text-[11px] text-text-tertiary mt-0.5">点选添加，下方可调整生成顺序</p>
            <div class="mt-1.5 flex flex-wrap gap-1.5">
              <button v-for="m in DETAIL_MODULES" :key="m.value" type="button" class="px-2 py-1 rounded-md text-[11px] border transition-colors" :class="form.detailModules.includes(m.value) ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-3 text-text-secondary hover:bg-surface-2'" :title="m.desc" @click="toggleModule(m.value)">{{ m.label }}</button>
            </div>
            <div v-if="form.detailModules.length" class="mt-2 space-y-1">
              <div v-for="(mod, i) in form.detailModules" :key="mod" class="flex items-center gap-2 px-2 py-1 bg-surface-2 rounded-md text-xs">
                <span class="w-4 text-center text-[11px] text-text-tertiary">{{ i + 1 }}</span>
                <span class="flex-1 truncate text-text-primary">{{ mod }}</span>
                <button type="button" class="px-1 leading-none text-text-tertiary hover:text-primary-600 disabled:opacity-30 disabled:cursor-not-allowed" :disabled="i === 0" title="上移" @click="moveModule(i, -1)">↑</button>
                <button type="button" class="px-1 leading-none text-text-tertiary hover:text-primary-600 disabled:opacity-30 disabled:cursor-not-allowed" :disabled="i === form.detailModules.length - 1" title="下移" @click="moveModule(i, 1)">↓</button>
                <button type="button" class="px-1 leading-none text-text-tertiary hover:text-error" title="移除" @click="toggleModule(mod)">移除</button>
              </div>
            </div>
          </div>

          <!-- 主图：生成数量 + 促销角标 / CTA（主图常带营销角标，单图多候选挑选） -->
          <template v-else>
            <label class="block">
              <span class="text-sm font-medium text-text-primary">生成数量</span>
              <input v-model.number="form.imageCount" type="number" min="1" max="10" class="mt-1.5 w-full px-3 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500" />
            </label>
            <label class="block">
              <span class="text-sm font-medium text-text-primary">促销角标 / CTA 文案</span>
              <input v-model="form.ctaText" class="mt-1.5 w-full px-3 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500" placeholder="如：限时立减50，可留空" />
            </label>
          </template>

          <label class="block">
            <span class="text-sm font-medium text-text-primary">特殊要求</span>
            <textarea v-model="form.requirements" rows="2" class="mt-1.5 w-full px-3 py-2 text-xs bg-surface-1 border border-surface-3 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 resize-none" :placeholder="isDetail ? '例：整套风格统一、深色高级质感' : '例：背景干净、突出主体'" />
          </label>
          <div class="pt-3 mt-1 border-t border-surface-3">
            <EcomModelBar
              :params="params"
              :llm="llm"
              :show-llm="true"
              @update:params="Object.assign(params, $event)"
              @update:llm="Object.assign(llm, $event)"
            />
          </div>
        </div>

        <div class="p-4 border-t border-surface-3 space-y-2">
          <ConsumptionEstimate v-if="estimate.amount > 0" :balance-type="estimate.balanceType" :amount="estimate.amount" />
          <p v-if="phaseText" class="text-xs text-primary-600">{{ phaseText }}</p>
          <p v-if="gen.lastError.value" class="text-xs text-error">{{ gen.lastError.value }}</p>
          <button class="btn-primary w-full !py-2 disabled:opacity-50 disabled:cursor-not-allowed" :disabled="!canGenerate" @click="onGenerate">
            {{ busy ? '生成中…' : generateLabel }}
          </button>
        </div>
      </aside>

      <section class="flex flex-col min-h-0 bg-surface-1">
        <div class="flex-1 overflow-y-auto p-4">
          <EcomResultGrid
            :tasks="gen.tasks.value"
            :generating="gen.generating.value"
            :selectable="pickable"
            :picked-paths="pickedPaths"
            @retry="onRetry"
            @clear="gen.reset()"
            @cancel="gen.cancel()"
            @toggle-pick="emit('toggle-pick', $event)"
          />
        </div>
      </section>
    </div>

    <LowBalanceModal
      v-model:visible="lowBalanceOpen"
      :balance-type="lowBalanceState.balanceType"
      :required="lowBalanceState.required"
      :available="lowBalanceState.available"
    />
  </div>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue'
import EcomImageUploader from './components/EcomImageUploader.vue'
import EcomModelBar from './components/EcomModelBar.vue'
import EcomResultGrid from './components/EcomResultGrid.vue'
import LowBalanceModal from '@/components/LowBalanceModal.vue'
import ConsumptionEstimate from '@/components/ConsumptionEstimate.vue'
import { useEcomGen, useEcomFormPersist, useEcomModelPref, type GenJob, type LlmChoice } from './useEcomGen'
import { useImageBilling } from './useImageBilling'
import { ecomGenerator, buildRefImageInstruction, PLATFORMS, LANGUAGES, DETAIL_MODULES, STYLE_PRESETS } from './prompts'
import { uid } from './utils'
import { useModelStore } from '@/stores/models'
import { hasCap } from '@/utils/model-caps'
import { stripModelId } from '@shared/model-id'
import { DEFAULT_TIER_ID, DEFAULT_QUALITY_ID } from '@shared/image-size'
import type { EcomGeneratorForm, EcomGenParams, UploadedImage } from './types'

// 主图 / 详情页共用本面板，靠 prop 区分；两个壳视图（EcomMainView / EcomDetailView）
// 是不同组件，路由切换不复用，因此各自独立挂载、配各自 scope，表单 / 结果天然隔离。
const props = withDefaults(
  defineProps<{
    imageType: 'main' | 'detail'
    scopeKey: string
    /** 选图模式：结果可点选，向上 emit toggle-pick。供 ewei 商品图工作台复用本面板。默认 false。 */
    pickable?: boolean
    /** 已选中的 result_path 列表（高亮 + 序号）。 */
    pickedPaths?: string[]
  }>(),
  { pickable: false, pickedPaths: () => [] },
)
const emit = defineEmits<{ (e: 'toggle-pick', payload: { path: string; url: string }): void }>()

const isDetailType = props.imageType === 'detail'

// 主图默认 1:1，详情页默认 9:16（竖长图）
function defaultSizeFor(detail: boolean): string {
  return detail ? '9:16' : '1:1'
}

const gen = useEcomGen(props.scopeKey)
const modelStore = useModelStore()

const form = reactive<EcomGeneratorForm>({
  productImages: [],
  styleImage: null,
  logoImage: null,
  productName: '',
  sellingPoints: '',
  language: '简体中文',
  customLanguage: '',
  platform: 'general',
  stylePreset: '',
  imageCount: 3,
  imageType: props.imageType,
  requirements: '',
  ctaText: '',
  detailModules: ['首屏主视觉', '核心卖点图', '使用场景图'],
  aspectRatio: defaultSizeFor(isDetailType),
})

const params = reactive<EcomGenParams>({
  modelProviderId: '',
  modelId: '',
  size: defaultSizeFor(isDetailType),
  tierId: DEFAULT_TIER_ID,
  quality: DEFAULT_QUALITY_ID,
})
const llm = reactive<LlmChoice>({ providerId: '', modelId: '' })

// 切走/切回保留输入（main / detail 各自独立 scope）；模型选择跨重启 + 跨功能共享。
useEcomFormPersist(props.scopeKey, { form, params, llm })
useEcomModelPref(params, llm)
// imageType 固定跟随 prop（防止历史脏快照串类型）
form.imageType = props.imageType
form.aspectRatio = params.size

const isDetail = computed(() => props.imageType === 'detail')
const generateLabel = computed(() => (isDetail.value ? '生成详情页' : '生成主图'))

const styleImages = computed<UploadedImage[]>({
  get: () => (form.styleImage ? [form.styleImage] : []),
  set: (v) => {
    form.styleImage = v[0] || null
  },
})
const logoImages = computed<UploadedImage[]>({
  get: () => (form.logoImage ? [form.logoImage] : []),
  set: (v) => {
    form.logoImage = v[0] || null
  },
})

const busy = computed(() => gen.generating.value || gen.phase.value === 'optimizing')
const phaseText = computed(() => (gen.phase.value === 'optimizing' ? '正在撰写生图描述词…' : ''))
const canGenerate = computed(
  () =>
    (!!form.productName.trim() || form.productImages.length > 0) &&
    !!params.modelId &&
    !!llm.modelId &&
    !busy.value,
)

const { lowBalanceOpen, lowBalanceState, estimateImageCost, ensureEnoughBalance } = useImageBilling()
const estimateCount = computed(() =>
  isDetail.value && form.detailModules.length ? form.detailModules.length : form.imageCount,
)
const estimate = computed(() =>
  estimateImageCost(params.modelProviderId, params.modelId, estimateCount.value),
)

function toggleModule(v: string): void {
  const i = form.detailModules.indexOf(v)
  if (i >= 0) form.detailModules.splice(i, 1)
  else form.detailModules.push(v)
}

/** 调整已选详情页模块的顺序（生成与展示顺序即此顺序）。 */
function moveModule(i: number, dir: -1 | 1): void {
  const j = i + dir
  if (j < 0 || j >= form.detailModules.length) return
  const [m] = form.detailModules.splice(i, 1)
  form.detailModules.splice(j, 0, m)
}

function refImages(): string[] {
  const refs = form.productImages.map((p) => p.dataUrl)
  if (form.styleImage) refs.push(form.styleImage.dataUrl)
  if (form.logoImage) refs.push(form.logoImage.dataUrl)
  return refs
}

/** 描述词模型是否支持视觉输入（决定第一步是否把参考图喂给它）。 */
function llmSupportsVision(): boolean {
  if (!llm.providerId || !llm.modelId) return false
  return hasCap(stripModelId(llm.modelId), 'vision', modelStore.cloudTypeOf(llm.providerId, llm.modelId))
}

/** 给第一步描述词模型看的参考图（产品图 + 风格图；Logo 仅供出图模型叠加，不喂 LLM）。 */
function visionRefs(): string[] {
  const arr = form.productImages.map((p) => p.dataUrl)
  if (form.styleImage) arr.push(form.styleImage.dataUrl)
  return arr
}

async function onGenerate(): Promise<void> {
  if (!canGenerate.value) return
  if (!ensureEnoughBalance(params.modelProviderId, params.modelId, estimateCount.value)) return
  gen.reset()
  form.aspectRatio = params.size // 描述词中的画面比例跟随实际所选尺寸
  const count = isDetail.value && form.detailModules.length ? form.detailModules.length : form.imageCount
  try {
    gen.phase.value = 'optimizing'
    // 描述词模型支持视觉时把产品图/风格图一并喂给它（不支持则 generatePrompts 内部去图回退）
    const visionImages = llmSupportsVision() ? visionRefs() : []
    const prompts = await gen.generatePrompts(
      { providerId: llm.providerId, modelId: llm.modelId },
      ecomGenerator.buildSystemPrompt(form, { withImages: visionImages.length > 0 }),
      ecomGenerator.buildUserPrompt(form),
      count,
      { images: visionImages },
    )
    const refs = refImages()
    const refNote = buildRefImageInstruction({
      productCount: form.productImages.length,
      hasStyle: !!form.styleImage,
      hasLogo: !!form.logoImage,
    })
    // 最终生图 prompt = LLM 描述词 + 硬约束块（确定性字段原样注入）+ 参考图使用说明
    const hard = ecomGenerator.buildHardConstraints(form)
    const jobs: GenJob[] = prompts.map((p, i) => {
      const parts = [p]
      if (hard) parts.push(hard)
      if (refNote) parts.push(refNote)
      return {
        id: uid('gen'),
        label: isDetail.value ? form.detailModules[i] || `第 ${i + 1} 屏` : `主图 ${i + 1}`,
        prompt: parts.join('\n\n'),
        refImages: refs,
      }
    })
    await gen.run(jobs, { ...params }, { concurrency: 3 })
  } catch (e: any) {
    gen.lastError.value = e?.message || '生成失败'
    gen.phase.value = ''
  }
}

async function onRetry(id: string): Promise<void> {
  const t = gen.tasks.value.find((x) => x.id === id)
  if (!t) return
  await gen.retry({ id, label: t.label, prompt: t.prompt, refImages: refImages() }, { ...params })
}
</script>
