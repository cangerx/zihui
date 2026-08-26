<template>
  <div class="h-full flex flex-col">
    <div class="flex-1 grid grid-cols-[380px_1fr] min-h-0 border-t border-surface-3">
      <aside class="flex flex-col min-h-0 border-r border-surface-3 bg-surface-0">
        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          <EcomImageUploader v-model="form.referenceImages" :max="10" :cols="4" label="参考图" hint="复刻其构图与风格" />
          <EcomImageUploader v-model="form.productImages" :max="6" :cols="4" label="产品图" hint="替换进参考图的产品" />

          <div>
            <span class="text-sm font-medium text-text-primary">文字内容</span>
            <div class="mt-1.5 flex rounded-md border border-surface-3 overflow-hidden text-xs">
              <button v-for="o in TEXT_CONTENT_MODES" :key="o.value" type="button" class="flex-1 py-1.5 transition-colors" :class="form.textContentMode === o.value ? 'bg-primary-500 text-white' : 'bg-surface-1 text-text-secondary hover:bg-surface-2'" @click="form.textContentMode = o.value as TextContentMode">{{ o.label }}</button>
            </div>
            <input v-if="form.textContentMode === 'custom'" v-model="form.customText" class="mt-2 w-full px-3 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500" placeholder="请输入要替换的文案，如：限时特惠 全场5折起" />
          </div>

          <div>
            <span class="text-sm font-medium text-text-primary">文字排版</span>
            <div class="mt-1.5 flex rounded-md border border-surface-3 overflow-hidden text-xs">
              <button v-for="o in TEXT_LAYOUT_MODES" :key="o.value" type="button" class="flex-1 py-1.5 transition-colors" :class="form.textLayoutMode === o.value ? 'bg-primary-500 text-white' : 'bg-surface-1 text-text-secondary hover:bg-surface-2'" @click="form.textLayoutMode = o.value as TextLayoutMode">{{ o.label }}</button>
            </div>
          </div>

          <label class="block">
            <span class="text-sm font-medium text-text-primary">画面文字语言</span>
            <select v-model="form.language" class="mt-1.5 w-full px-3 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500">
              <option v-for="o in LANGUAGES" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <input v-if="form.language === '自定义'" v-model="form.customLanguage" class="mt-2 w-full px-3 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500" placeholder="请输入自定义语言，如：荷兰语" />
          </label>

          <label class="block">
            <span class="text-sm font-medium text-text-primary">其他要求</span>
            <textarea v-model="form.otherRequirements" rows="2" class="mt-1.5 w-full px-3 py-2 text-xs bg-surface-1 border border-surface-3 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 resize-none" placeholder="如：色调风格、构图偏好、需保留或去除的元素" />
          </label>
          <div class="pt-3 mt-1 border-t border-surface-3">
            <EcomModelBar :params="params" @update:params="Object.assign(params, $event)" />
          </div>
        </div>

        <div class="p-4 border-t border-surface-3 space-y-2">
          <ConsumptionEstimate v-if="estimate.amount > 0" :balance-type="estimate.balanceType" :amount="estimate.amount" />
          <p v-if="gen.lastError.value" class="text-xs text-error">{{ gen.lastError.value }}</p>
          <button class="btn-primary w-full !py-2 disabled:opacity-50 disabled:cursor-not-allowed" :disabled="!canGenerate" @click="onGenerate">
            {{ gen.generating.value ? '生成中…' : `复刻 ${form.referenceImages.length || ''} 张` }}
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
import { useEcomGen, useEcomFormPersist, useEcomModelPref, type GenJob } from './useEcomGen'
import { useImageBilling } from './useImageBilling'
import { ecomClone, LANGUAGES } from './prompts'
import { uid } from './utils'
import { DEFAULT_TIER_ID, DEFAULT_QUALITY_ID } from '@shared/image-size'
import type { EcomCloneForm, EcomGenParams, TextContentMode, TextLayoutMode } from './types'

const TEXT_CONTENT_MODES = [
  { value: 'keep', label: '保留文字' },
  { value: 'custom', label: '自定义文案' },
  { value: 'creative', label: '创意改写' },
]
const TEXT_LAYOUT_MODES = [
  { value: 'keep', label: '保留排版' },
  { value: 'redesign', label: '重新设计' },
]

const gen = useEcomGen('ecom:clone')

const form = reactive<EcomCloneForm>({
  referenceImages: [],
  productImages: [],
  textContentMode: 'keep',
  customText: '',
  textLayoutMode: 'keep',
  language: '简体中文',
  customLanguage: '',
  otherRequirements: '',
})

const params = reactive<EcomGenParams>({
  modelProviderId: '',
  modelId: '',
  size: '1:1',
  tierId: DEFAULT_TIER_ID,
  quality: DEFAULT_QUALITY_ID,
})

// 切走/切回保留表单输入与已选模型尺寸（结果网格 / 进度在 useEcomGen 的 store 分桶里）
useEcomFormPersist('ecom:clone', { form, params })
useEcomModelPref(params)

const canGenerate = computed(
  () => form.referenceImages.length > 0 && form.productImages.length > 0 && !!params.modelId && !gen.generating.value,
)

const { lowBalanceOpen, lowBalanceState, estimateImageCost, ensureEnoughBalance } = useImageBilling()
const estimate = computed(() =>
  estimateImageCost(params.modelProviderId, params.modelId, form.referenceImages.length),
)

/** 一步直出：参考图当模板，多模态生图模型直接换产品。每张参考图生成一张。 */
function buildJobs(): GenJob[] {
  const instruction = `${ecomClone.directTemplate}\n${ecomClone.buildUserPrompt(form)}`
  return form.referenceImages.map((ref, i) => {
    const product = form.productImages[i] || form.productImages[0]
    return {
      id: uid('clone'),
      label: `复刻 ${i + 1}`,
      prompt: instruction,
      refImages: [ref.dataUrl, product.dataUrl],
    }
  })
}

async function onGenerate(): Promise<void> {
  if (!canGenerate.value) return
  if (!ensureEnoughBalance(params.modelProviderId, params.modelId, form.referenceImages.length)) return
  await gen.run(buildJobs(), { ...params }, { concurrency: 3 })
}

async function onRetry(id: string): Promise<void> {
  const idx = gen.tasks.value.findIndex((x) => x.id === id)
  const t = gen.tasks.value[idx]
  const ref = form.referenceImages[idx]
  if (!t || !ref) return
  const product = form.productImages[idx] || form.productImages[0]
  await gen.retry({ id, label: t.label, prompt: t.prompt, refImages: [ref.dataUrl, product.dataUrl] }, { ...params })
}
</script>
