<template>
  <div class="canvas-node" :style="{ borderColor: 'var(--color-primary-500, #23574f)' }" :data-status="data.status">
    <div class="node-header" style="background: var(--color-primary-50, #f2f6f5); color: var(--color-primary-700, #1a3f3a);">
      <span class="node-type-dot" style="background: var(--color-primary-500, #23574f);"></span>
      识图
      <span class="text-[10px] font-normal opacity-60 ml-1">#{{ data.nodeIndex }}</span>
      <button @click="deleteNode" :disabled="data.locked" class="node-delete-btn">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div class="node-body">
      <div v-if="!hasUpstreamImage" class="text-[10px] text-text-tertiary mb-2 px-2 py-1.5 bg-surface-2 rounded-lg text-center">
        请连入上游图像节点
      </div>

      <div class="mb-2">
        <button
          @click.stop="showModel = !showModel"
          :disabled="data.locked"
          class="w-full flex items-center justify-between gap-1.5 px-1 py-0.5 text-[10px] text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-50"
        >
          <span class="flex items-center gap-1">
            <svg class="w-2.5 h-2.5 transition-transform" :class="{ 'rotate-90': showModel }" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
            视觉模型
          </span>
          <span class="text-[9px] opacity-70">{{ modelStatusLabel }}</span>
        </button>
        <div v-if="showModel" class="mt-1.5 space-y-1.5">
          <select
            v-model="visionProviderModel"
            @change="onProviderChange"
            class="node-textarea nodrag w-full"
            :disabled="data.locked"
          >
            <option value="">使用画布默认</option>
            <option v-for="p in modelStore.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <select
            v-if="visionProviderModel"
            v-model="visionModelModel"
            @change="saveModel"
            class="node-textarea nodrag w-full"
            :disabled="data.locked || !modelOptions.recommended.length && !modelOptions.others.length"
          >
            <option value="">-- 选择模型 --</option>
            <optgroup v-if="modelOptions.recommended.length" label="推荐（视觉）">
              <option v-for="m in modelOptions.recommended" :key="m" :value="m">{{ modelStore.optionLabel(visionProviderModel, m) }}</option>
            </optgroup>
            <optgroup v-if="modelOptions.others.length" label="其他">
              <option v-for="m in modelOptions.others" :key="m" :value="m">{{ modelStore.optionLabel(visionProviderModel, m) }}</option>
            </optgroup>
          </select>
          <p class="text-[9px] text-text-disabled leading-snug">
            留空时回退到画布设置中的「视觉模型」。用于客观识别图片内容，不生成生图提示词。
          </p>
        </div>
      </div>

      <div v-if="data.status === 'running'" class="flex items-center gap-1.5 text-[10px] text-sky-600 mb-2">
        <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
        识别中...
      </div>
      <div v-if="data.status === 'error'" class="text-[10px] text-red-500 mb-2 break-words">{{ data.error }}</div>
      <div v-if="data.result" class="text-[10px] text-text-secondary mb-2 p-2 bg-surface-2 rounded-lg max-h-28 overflow-y-auto break-words whitespace-pre-wrap">{{ data.result }}</div>

      <button
        @click="runRecognition"
        :disabled="data.status === 'running' || data.locked || !hasUpstreamImage"
        class="w-full py-1.5 text-[10px] font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 transition-colors"
      >
        识别图片内容
      </button>
    </div>
    <Handle type="target" :position="Position.Left" id="image-input" class="handle-image" />
    <Handle
      type="source"
      :position="Position.Right"
      id="output"
      class="handle-text"
      @click="(e: MouseEvent) => onHandleClick?.(e, data.nodeId, 'output', 'text')"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvas'
import { useModelStore } from '@/stores/models'
import { useWorkflowEngine } from '../composables/useWorkflowEngine'
import { groupAndSort } from '@/utils/model-caps'
import { getHintsSync } from '@/utils/model-usage-hints'

type HandleClickHandler = (e: MouseEvent, nodeId: string, handleId: string, dataType: 'text' | 'image') => void

const props = defineProps<{ data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const modelStore = useModelStore()
const { executeSingleNode } = useWorkflowEngine()
const onHandleClick = inject<HandleClickHandler | null>('onHandleClick', null)

const showModel = ref(false)
const visionProviderModel = ref<string>(props.data.vision_provider_id || '')
const visionModelModel = ref<string>(props.data.vision_model_id || '')

watch(() => props.data.vision_provider_id, (v) => { visionProviderModel.value = v || '' })
watch(() => props.data.vision_model_id, (v) => { visionModelModel.value = v || '' })

const hasUpstreamImage = computed(() => {
  if (!props.data.nodeId || !props.data.projectId) return false
  return canvasStore.edges.some(
    (e) =>
      e.project_id === props.data.projectId &&
      e.target_node_id === props.data.nodeId &&
      e.target_handle === 'image-input'
  )
})

const currentProvider = computed(() =>
  modelStore.providers.find((p) => p.id === visionProviderModel.value) || null
)

const modelOptions = computed(() => {
  if (!currentProvider.value) return { recommended: [] as string[], others: [] as string[] }
  return groupAndSort(currentProvider.value.models, 'vision', {
    cloudTypeOf: (mid) => modelStore.cloudTypeOf(currentProvider.value!.id, mid),
    usageHints: getHintsSync('vision', currentProvider.value.id)
  })
})

const modelStatusLabel = computed(() => {
  if (!visionProviderModel.value) return '画布默认'
  if (!visionModelModel.value) return '未选模型'
  return '已自定义'
})

function persist(patch: Record<string, any>) {
  if (!props.data.nodeId) return
  canvasStore.updateNode(props.data.nodeId, {
    data: { ...props.data, ...patch }
  })
}

function onProviderChange() {
  visionModelModel.value = ''
  persist({ vision_provider_id: visionProviderModel.value, vision_model_id: '' })
}

function saveModel() {
  persist({ vision_model_id: visionModelModel.value })
}

async function runRecognition() {
  if (!props.data.nodeId || !props.data.projectId) return
  await executeSingleNode(props.data.nodeId, props.data.projectId)
}

function deleteNode() {
  if (!props.data.nodeId) return
  canvasStore.removeNode(props.data.nodeId)
}
</script>
