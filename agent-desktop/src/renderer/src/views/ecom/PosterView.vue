<template>
  <div class="h-full flex flex-col">
    <div class="flex-1 grid grid-cols-[380px_1fr] min-h-0 border-t border-surface-3">
      <aside class="flex flex-col min-h-0 border-r border-surface-3 bg-surface-0">
        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          <!-- 产品图 / 纯文字 模式 -->
          <div class="flex rounded-md border border-surface-3 overflow-hidden text-xs">
            <button type="button" class="flex-1 py-1.5 transition-colors" :class="form.hasProductImage ? 'bg-primary-500 text-white' : 'bg-surface-1 text-text-secondary hover:bg-surface-2'" @click="form.hasProductImage = true">产品图模式</button>
            <button type="button" class="flex-1 py-1.5 transition-colors" :class="!form.hasProductImage ? 'bg-primary-500 text-white' : 'bg-surface-1 text-text-secondary hover:bg-surface-2'" @click="form.hasProductImage = false">纯文字模式</button>
          </div>

          <EcomImageUploader v-if="form.hasProductImage" v-model="form.productImages" :max="4" :cols="4" label="产品图" hint="1-4 张" />
          <div class="grid grid-cols-2 gap-3">
            <EcomImageUploader v-model="styleImages" :max="1" :cols="1" label="风格参考" hint="可选" />
            <EcomImageUploader v-model="logoImages" :max="1" :cols="1" label="品牌 Logo" hint="可选" />
          </div>

          <label class="block">
            <span class="text-sm font-medium text-text-primary">主题 / 产品名</span>
            <input v-model="form.productName" class="mt-1.5 w-full px-3 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500" placeholder="如：夏季新品冷泡茶" />
          </label>
          <label class="block">
            <span class="text-sm font-medium text-text-primary">核心信息 / 卖点</span>
            <textarea v-model="form.sellingPoints" rows="2" class="mt-1.5 w-full px-3 py-2 text-xs bg-surface-1 border border-surface-3 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 resize-none" placeholder="例：真果肉、零糖零脂、第2件半价" />
          </label>

          <!-- 单 / 双面 -->
          <div>
            <span class="text-sm font-medium text-text-primary">版式</span>
            <div class="mt-1.5 flex rounded-md border border-surface-3 overflow-hidden text-xs">
              <button type="button" class="flex-1 py-1.5 transition-colors" :class="form.posterType === 'single' ? 'bg-primary-500 text-white' : 'bg-surface-1 text-text-secondary hover:bg-surface-2'" @click="form.posterType = 'single'">单面</button>
              <button type="button" class="flex-1 py-1.5 transition-colors" :class="form.posterType === 'double' ? 'bg-primary-500 text-white' : 'bg-surface-1 text-text-secondary hover:bg-surface-2'" @click="form.posterType = 'double'">双面（正+背）</button>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <label class="block">
              <span class="text-sm font-medium text-text-primary">用途</span>
              <select v-model="form.scenario" class="mt-1.5 w-full px-2 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500">
                <option v-for="o in POSTER_SCENARIOS" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>
            <label class="block">
              <span class="text-sm font-medium text-text-primary">行业</span>
              <select v-model="form.industry" class="mt-1.5 w-full px-2 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500">
                <option v-for="o in POSTER_INDUSTRIES" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>
          </div>

          <!-- 画面风格预设 -->
          <div>
            <span class="text-sm font-medium text-text-primary">画面风格</span>
            <div class="mt-1.5 flex flex-wrap gap-1.5">
              <button type="button" class="px-2 py-1 rounded-md text-[11px] border transition-colors" :class="!form.stylePreset ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-3 text-text-secondary hover:bg-surface-2'" @click="form.stylePreset = ''">不指定</button>
              <button v-for="s in STYLE_PRESETS" :key="s.value" type="button" class="px-2 py-1 rounded-md text-[11px] border transition-colors" :class="form.stylePreset === s.value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-3 text-text-secondary hover:bg-surface-2'" :title="s.desc" @click="form.stylePreset = s.value">{{ s.label }}</button>
            </div>
          </div>

          <label class="block">
            <span class="text-sm font-medium text-text-primary">画面描述</span>
            <textarea v-model="form.userDescription" rows="2" class="mt-1.5 w-full px-3 py-2 text-xs bg-surface-1 border border-surface-3 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 resize-none" placeholder="自由描述你想要的画面，可留空由 AI 发挥" />
          </label>

          <div class="grid grid-cols-2 gap-3">
            <label class="block">
              <span class="text-sm font-medium text-text-primary">CTA 文案</span>
              <input v-model="form.ctaText" class="mt-1.5 w-full px-3 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500" placeholder="如：立即抢购" />
            </label>
            <label class="block">
              <span class="text-sm font-medium text-text-primary">语言</span>
              <select v-model="form.language" class="mt-1.5 w-full px-2 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500">
                <option v-for="o in LANGUAGES" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>
          </div>

          <label v-if="form.posterType === 'single'" class="block">
            <span class="text-sm font-medium text-text-primary">生成数量</span>
            <input v-model.number="form.imageCount" type="number" min="1" max="6" class="mt-1.5 w-full px-3 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500" />
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
            {{ busy ? '生成中…' : '生成海报' }}
          </button>
        </div>
      </aside>

      <section class="flex flex-col min-h-0 bg-surface-1">
        <div class="flex-1 overflow-y-auto p-4">
          <EcomResultGrid :tasks="gen.tasks.value" :generating="gen.generating.value" @retry="onRetry" @clear="gen.reset()" @cancel="gen.cancel()" />
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
import { poster, buildRefImageInstruction, LANGUAGES, POSTER_SCENARIOS, POSTER_INDUSTRIES, STYLE_PRESETS } from './prompts'
import { uid } from './utils'
import { useModelStore } from '@/stores/models'
import { hasCap } from '@/utils/model-caps'
import { stripModelId } from '@shared/model-id'
import { DEFAULT_TIER_ID, DEFAULT_QUALITY_ID } from '@shared/image-size'
import type { PosterForm, EcomGenParams, UploadedImage } from './types'

const gen = useEcomGen('ecom:poster')
const modelStore = useModelStore()

const form = reactive<PosterForm>({
  productImages: [],
  styleImage: null,
  logoImage: null,
  hasProductImage: true,
  productName: '',
  sellingPoints: '',
  language: '简体中文',
  customLanguage: '',
  posterType: 'single',
  stylePreset: '',
  scenario: 'general',
  industry: 'general',
  userDescription: '',
  ctaText: '',
  requirements: '',
  imageCount: 1,
  aspectRatio: '2:3',
})

const params = reactive<EcomGenParams>({
  modelProviderId: '',
  modelId: '',
  size: '2:3',
  tierId: DEFAULT_TIER_ID,
  quality: DEFAULT_QUALITY_ID,
})
const llm = reactive<LlmChoice>({ providerId: '', modelId: '' })

// 切走/切回保留全部输入（结果网格 / 进度状态在 useEcomGen 的 store 分桶里）
useEcomFormPersist('ecom:poster', { form, params, llm })
useEcomModelPref(params, llm)

const busy = computed(() => gen.generating.value || gen.phase.value === 'optimizing')
const phaseText = computed(() => (gen.phase.value === 'optimizing' ? '正在撰写海报描述词…' : ''))
const canGenerate = computed(() => {
  const hasInput = !!form.productName.trim() || !!form.userDescription.trim() || (form.hasProductImage && form.productImages.length > 0)
  return hasInput && !!params.modelId && !!llm.modelId && !busy.value
})

const { lowBalanceOpen, lowBalanceState, estimateImageCost, ensureEnoughBalance } = useImageBilling()
const estimateCount = computed(() => (form.posterType === 'double' ? 2 : form.imageCount))
const estimate = computed(() =>
  estimateImageCost(params.modelProviderId, params.modelId, estimateCount.value),
)

function refImages(): string[] {
  const refs: string[] = []
  if (form.hasProductImage) refs.push(...form.productImages.map((p) => p.dataUrl))
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
  const arr: string[] = []
  if (form.hasProductImage) arr.push(...form.productImages.map((p) => p.dataUrl))
  if (form.styleImage) arr.push(form.styleImage.dataUrl)
  return arr
}

async function onGenerate(): Promise<void> {
  if (!canGenerate.value) return
  if (!ensureEnoughBalance(params.modelProviderId, params.modelId, estimateCount.value)) return
  gen.reset()
  form.aspectRatio = params.size // 描述词中的画面比例跟随实际所选尺寸
  const count = form.posterType === 'double' ? 2 : form.imageCount
  try {
    gen.phase.value = 'optimizing'
    // 描述词模型支持视觉时把产品图/风格图一并喂给它（不支持则 generatePrompts 内部去图回退）
    const visionImages = llmSupportsVision() ? visionRefs() : []
    const prompts = await gen.generatePrompts(
      { providerId: llm.providerId, modelId: llm.modelId },
      poster.buildSystemPrompt(form, { withImages: visionImages.length > 0 }),
      poster.buildUserPrompt(form),
      count,
      { images: visionImages },
    )
    const refs = refImages()
    const refNote = buildRefImageInstruction({
      productCount: form.hasProductImage ? form.productImages.length : 0,
      hasStyle: !!form.styleImage,
      hasLogo: !!form.logoImage,
    })
    // 最终生图 prompt = LLM 描述词 + 硬约束块（确定性字段原样注入）+ 参考图使用说明
    const hard = poster.buildHardConstraints(form)
    const jobs: GenJob[] = prompts.map((p, i) => {
      const parts = [p]
      if (hard) parts.push(hard)
      if (refNote) parts.push(refNote)
      return {
        id: uid('poster'),
        label: form.posterType === 'double' ? (i === 0 ? '正面' : '背面') : `海报 ${i + 1}`,
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

// 单图字段适配
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
</script>
