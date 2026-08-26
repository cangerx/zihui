<template>
  <div class="space-y-3">
    <!-- 生图模型（两级下拉，与 AI 生图一致：服务商 + 模型 + 手输兜底） -->
    <div>
      <span class="block text-xs font-medium text-text-secondary mb-1.5">生图模型</span>
      <select
        :value="params.modelProviderId"
        class="w-full px-3 py-2 text-xs bg-surface-1 border border-surface-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        @change="onImageProviderChange(($event.target as HTMLSelectElement).value)"
      >
        <option value="">-- 选择服务商 --</option>
        <option v-for="p in modelStore.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <select
        :value="params.modelId"
        :disabled="!imageProviderModels.length"
        class="w-full mt-2 px-3 py-2 text-xs bg-surface-1 border border-surface-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
        @change="patch({ modelId: ($event.target as HTMLSelectElement).value })"
      >
        <option value="">-- 选择模型 --</option>
        <optgroup v-if="imageModelGroups.recommended.length" label="推荐（生图）">
          <option v-for="m in imageModelGroups.recommended" :key="m" :value="m">{{ modelStore.optionLabel(params.modelProviderId, m) }}</option>
        </optgroup>
      </select>
      <input
        v-if="params.modelProviderId && !imageProviderModels.length"
        :value="params.modelId"
        placeholder="输入模型名称"
        class="w-full mt-2 px-3 py-2 text-xs bg-surface-1 border border-surface-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        @input="patch({ modelId: ($event.target as HTMLInputElement).value })"
      />
    </div>

    <!-- 描述词模型（两步法功能：先让对话模型写生图描述词） -->
    <div v-if="showLlm">
      <span class="block text-xs font-medium text-text-secondary mb-1.5">描述词模型</span>
      <select
        :value="llm.providerId"
        class="w-full px-3 py-2 text-xs bg-surface-1 border border-surface-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        @change="onLlmProviderChange(($event.target as HTMLSelectElement).value)"
      >
        <option value="">-- 选择服务商 --</option>
        <option v-for="p in modelStore.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <select
        :value="llm.modelId"
        :disabled="!llmProviderModels.length"
        class="w-full mt-2 px-3 py-2 text-xs bg-surface-1 border border-surface-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
        @change="onLlmModelChange(($event.target as HTMLSelectElement).value)"
      >
        <option value="">-- 选择模型 --</option>
        <optgroup v-if="llmModelGroups.recommended.length" label="推荐（对话）">
          <option v-for="m in llmModelGroups.recommended" :key="m" :value="m">{{ modelStore.optionLabel(llm.providerId, m) }}</option>
        </optgroup>
      </select>
      <input
        v-if="llm.providerId && !llmProviderModels.length"
        :value="llm.modelId"
        placeholder="输入模型名称"
        class="w-full mt-2 px-3 py-2 text-xs bg-surface-1 border border-surface-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        @input="onLlmModelChange(($event.target as HTMLInputElement).value)"
      />
    </div>

    <!-- 尺寸（与 AI 生图统一：ImageSizePicker） -->
    <div>
      <span class="block text-xs font-medium text-text-secondary mb-1.5">尺寸</span>
      <ImageSizePicker
        :model-value="params.size"
        :columns="4"
        :model-id="pureModel"
        :tier-id="params.tierId"
        show-hint
        @update:model-value="patch({ size: $event })"
      />
    </div>

    <!-- 分辨率档位（1K / 2K / 4K，随模型能力变化） -->
    <div>
      <span class="block text-xs font-medium text-text-secondary mb-1.5">分辨率</span>
      <ResolutionTierPicker
        :model-value="params.tierId"
        :model-id="pureModel"
        :size-value="params.size"
        @update:model-value="patch({ tierId: $event })"
      />
    </div>

    <!-- 画质（仅模型支持画质档位时显示，如 gpt-image-2） -->
    <div v-if="qualities.length">
      <span class="block text-xs font-medium text-text-secondary mb-1.5">画质</span>
      <QualityPicker
        :model-value="params.quality"
        :model-id="pureModel"
        @update:model-value="patch({ quality: $event })"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import ImageSizePicker from '@/components/ImageSizePicker.vue'
import ResolutionTierPicker from '@/components/ResolutionTierPicker.vue'
import QualityPicker from '@/components/QualityPicker.vue'
import { useModelStore } from '@/stores/models'
import { groupAndSort } from '@/utils/model-caps'
import { getHintsSync } from '@/utils/model-usage-hints'
import { stripModelId } from '@shared/model-id'
import { getModelCapability } from '@shared/image-size'
import type { EcomGenParams } from '../types'
import type { LlmChoice } from '../useEcomGen'

const props = withDefaults(
  defineProps<{
    params: EcomGenParams
    llm?: LlmChoice
    showLlm?: boolean
  }>(),
  {
    llm: () => ({ providerId: '', modelId: '' }),
    showLlm: false,
  },
)

const emit = defineEmits<{
  (e: 'update:params', v: EcomGenParams): void
  (e: 'update:llm', v: LlmChoice): void
}>()

const modelStore = useModelStore()

// 复合 key `{model_id}#@{provider_name}` 需 strip 成纯 id 才能查能力 / 匹配预设
const pureModel = computed(() => stripModelId(props.params.modelId))
const qualities = computed(() => getModelCapability(pureModel.value).qualities ?? [])

// ===== 生图模型（type=image）=====
const imageProvider = computed(
  () => modelStore.providers.find((p) => p.id === props.params.modelProviderId) || null,
)
const imageProviderModels = computed(() => imageProvider.value?.models ?? [])
const imageModelGroups = computed<{ recommended: string[]; others: string[] }>(() => {
  if (!imageProvider.value) return { recommended: [], others: [] }
  return groupAndSort(imageProvider.value.models, 'image', {
    cloudTypeOf: (mid: string) => modelStore.cloudTypeOf(imageProvider.value!.id, mid),
    usageHints: getHintsSync('image', imageProvider.value.id),
  })
})

// ===== 描述词模型（type=chat）=====
const llmProvider = computed(
  () => modelStore.providers.find((p) => p.id === props.llm.providerId) || null,
)
const llmProviderModels = computed(() => llmProvider.value?.models ?? [])
const llmModelGroups = computed<{ recommended: string[]; others: string[] }>(() => {
  if (!llmProvider.value) return { recommended: [], others: [] }
  return groupAndSort(llmProvider.value.models, 'chat', {
    cloudTypeOf: (mid: string) => modelStore.cloudTypeOf(llmProvider.value!.id, mid),
    usageHints: getHintsSync('chat', llmProvider.value.id),
  })
})

function patch(part: Partial<EcomGenParams>): void {
  emit('update:params', { ...props.params, ...part })
}
// 切服务商清空已选模型（与 AI 生图一致）；档位 / 画质合法性由各 Picker 自身 watch 校正
function onImageProviderChange(providerId: string): void {
  emit('update:params', { ...props.params, modelProviderId: providerId, modelId: '' })
}
function onLlmProviderChange(providerId: string): void {
  emit('update:llm', { providerId, modelId: '' })
}
function onLlmModelChange(modelId: string): void {
  emit('update:llm', { providerId: props.llm.providerId, modelId })
}

onMounted(() => {
  if (!modelStore.providers.length) modelStore.fetchProviders()
})
</script>
