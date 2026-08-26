<template>
  <div class="h-full flex flex-col">
    <div class="flex-1 grid grid-cols-[380px_1fr] min-h-0 border-t border-surface-3">
      <!-- 左：输入 -->
      <aside class="flex flex-col min-h-0 border-r border-surface-3 bg-surface-0">
        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          <EcomImageUploader v-model="templateImages" :max="1" :cols="1" label="SKU 模板图" hint="版式 / 排版参考（图1）" />
          <EcomImageUploader v-model="form.productImages" :max="20" :cols="4" label="产品图" hint="每张独立生成（图2）" />

          <div>
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-sm font-medium text-text-primary">替换指令</span>
              <button class="text-[11px] text-text-tertiary hover:text-primary-600" @click="form.prompt = batchSku.directTemplate">恢复默认</button>
            </div>
            <textarea
              v-model="form.prompt"
              rows="4"
              class="w-full px-3 py-2 text-xs text-text-primary bg-surface-1 border border-surface-3 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              placeholder="内置替换指令，可按需微调"
            />
          </div>
          <div class="pt-3 mt-1 border-t border-surface-3">
            <EcomModelBar :params="params" @update:params="Object.assign(params, $event)" />
          </div>
        </div>

        <div class="p-4 border-t border-surface-3 space-y-2">
          <ConsumptionEstimate v-if="estimate.amount > 0" :balance-type="estimate.balanceType" :amount="estimate.amount" />
          <p v-if="gen.lastError.value" class="text-xs text-error">{{ gen.lastError.value }}</p>
          <button
            class="btn-primary w-full !py-2 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="!canGenerate"
            @click="onGenerate"
          >
            {{ gen.generating.value ? '生成中…' : `生成 ${form.productImages.length || ''} 张 SKU` }}
          </button>
        </div>
      </aside>

      <!-- 右：结果 -->
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
import { batchSku } from './prompts'
import { uid } from './utils'
import { DEFAULT_TIER_ID, DEFAULT_QUALITY_ID } from '@shared/image-size'
import type { BatchSkuForm, EcomGenParams, UploadedImage } from './types'

const gen = useEcomGen('ecom:batchsku')

const form = reactive<BatchSkuForm>({
  templateImage: null,
  productImages: [],
  prompt: batchSku.directTemplate,
})

const params = reactive<EcomGenParams>({
  modelProviderId: '',
  modelId: '',
  size: '1:1',
  tierId: DEFAULT_TIER_ID,
  quality: DEFAULT_QUALITY_ID,
})

// 切走/切回保留表单输入与已选模型尺寸（结果网格 / 进度在 useEcomGen 的 store 分桶里）
useEcomFormPersist('ecom:batchsku', { form, params })
useEcomModelPref(params)

// 单图字段 ↔ Uploader 的数组接口适配
const templateImages = computed<UploadedImage[]>({
  get: () => (form.templateImage ? [form.templateImage] : []),
  set: (v) => {
    form.templateImage = v[0] || null
  },
})

const canGenerate = computed(
  () => !!form.templateImage && form.productImages.length > 0 && !!params.modelId && !gen.generating.value,
)

const { lowBalanceOpen, lowBalanceState, estimateImageCost, ensureEnoughBalance } = useImageBilling()
const estimate = computed(() =>
  estimateImageCost(params.modelProviderId, params.modelId, form.productImages.length),
)

function buildJobs(): GenJob[] {
  const prompt = batchSku.buildDirectPrompt(form)
  const template = form.templateImage!
  return form.productImages.map((p, i) => ({
    id: uid('sku'),
    label: `产品 ${i + 1}·${p.name}`,
    prompt,
    refImages: [template.dataUrl, p.dataUrl],
  }))
}

async function onGenerate(): Promise<void> {
  if (!canGenerate.value) return
  if (!ensureEnoughBalance(params.modelProviderId, params.modelId, form.productImages.length)) return
  await gen.run(buildJobs(), { ...params }, { concurrency: 3 })
}

async function onRetry(id: string): Promise<void> {
  const t = gen.tasks.value.find((x) => x.id === id)
  if (!t || !form.templateImage) return
  // 用 label 中的序号回溯产品图
  const idx = gen.tasks.value.findIndex((x) => x.id === id)
  const product = form.productImages[idx]
  if (!product) return
  await gen.retry({ id, label: t.label, prompt: t.prompt, refImages: [form.templateImage.dataUrl, product.dataUrl] }, { ...params })
}
</script>
