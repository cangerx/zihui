<template>
  <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center">
    <div class="bg-surface-0 rounded-xl shadow-2xl border border-surface-3 w-[400px] max-h-[80vh] flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="px-5 py-3 border-b border-surface-3 flex items-center justify-between flex-shrink-0">
        <div>
          <h3 class="text-sm font-medium text-text-primary">设置生图模型</h3>
          <p class="text-[11px] text-text-tertiary mt-0.5">AI 局部重绘、AI 改图功能将使用此模型</p>
        </div>
        <button @click="cancel" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto p-5 space-y-3">
        <!-- Provider -->
        <div>
          <label class="text-[11px] font-medium text-text-secondary mb-1 block">服务商</label>
          <select
            v-model="providerId"
            @change="modelId = ''"
            class="w-full px-3 py-2 text-xs bg-surface-1 border border-surface-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">-- 选择服务商 --</option>
            <option v-for="p in modelStore.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>

        <!-- Model -->
        <div>
          <label class="text-[11px] font-medium text-text-secondary mb-1 block">模型</label>
          <select
            v-model="modelId"
            :disabled="!providerModels.length && !!providerId === false"
            class="w-full px-3 py-2 text-xs bg-surface-1 border border-surface-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
          >
            <option value="">-- 选择模型 --</option>
            <optgroup v-if="modelGroups.recommended.length" label="推荐（生图）">
              <option
                v-for="m in modelGroups.recommended"
                :key="'rec-' + m"
                :value="m"
              >{{ modelStore.optionLabel(providerId, m) }}</option>
            </optgroup>
            <optgroup v-if="modelGroups.others.length" label="其他">
              <option
                v-for="m in modelGroups.others"
                :key="'oth-' + m"
                :value="m"
              >{{ modelStore.optionLabel(providerId, m) }}</option>
            </optgroup>
          </select>
          <input
            v-if="providerId && !providerModels.length"
            v-model="modelId"
            placeholder="输入模型名称"
            class="w-full mt-2 px-3 py-2 text-xs bg-surface-1 border border-surface-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <div class="text-[10px] text-text-tertiary bg-surface-1 rounded-lg p-2.5 leading-relaxed">
          所选模型会保存在本地配置，下次打开图片编辑时自动恢复。
        </div>
      </div>

      <!-- Footer -->
      <div class="px-5 py-3 border-t border-surface-3 flex items-center justify-end gap-1.5 flex-shrink-0">
        <button @click="cancel" class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors">取消</button>
        <button
          @click="confirm"
          :disabled="!providerId || !modelId"
          class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >保存</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useModelStore } from '@/stores/models'
import { groupAndSort } from '@/utils/model-caps'
import { getHintsSync, warmHintsCache } from '@/utils/model-usage-hints'

const props = defineProps<{
  visible: boolean
  initialProviderId: string
  initialModelId: string
}>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'confirm', payload: { providerId: string; modelId: string }): void
}>()

const modelStore = useModelStore()
const providerId = ref('')
const modelId = ref('')
// 用于触发 modelGroups computed 重新计算（warm 完 hints 后 ++）
const hintsTick = ref(0)

// 弹窗打开时同步初值，并 warm hints 缓存（与 ImageGenView/BatchGenView 规范一致）
watch(
  () => props.visible,
  (v) => {
    if (v) {
      providerId.value = props.initialProviderId || ''
      modelId.value = props.initialModelId || ''
      warmHintsCache().then(() => { hintsTick.value++ })
    }
  },
  { immediate: true }
)

const provider = computed(() => modelStore.providers.find(p => p.id === providerId.value) || null)
const providerModels = computed<string[]>(() => provider.value?.models ?? [])

const modelGroups = computed<{ recommended: string[]; others: string[] }>(() => {
  hintsTick.value
  if (!provider.value) return { recommended: [], others: [] }
  return groupAndSort(provider.value.models, 'image', {
    cloudTypeOf: (mid) => modelStore.cloudTypeOf(provider.value!.id, mid),
    usageHints: getHintsSync('image', provider.value.id)
  })
})

function cancel() {
  emit('update:visible', false)
}
function confirm() {
  if (!providerId.value || !modelId.value) return
  emit('confirm', { providerId: providerId.value, modelId: modelId.value })
  emit('update:visible', false)
}
</script>
