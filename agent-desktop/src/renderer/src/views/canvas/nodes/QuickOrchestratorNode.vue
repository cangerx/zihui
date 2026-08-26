<template>
  <div class="canvas-node canvas-node-wide" :style="{ borderColor: 'var(--color-primary-600, #1f4d46)' }" :data-status="data.status">
    <div class="node-header" style="background: var(--color-primary-50, #f2f6f5); color: var(--color-primary-700, #1a3f3a);">
      <span class="node-type-dot" style="background: var(--color-primary-600, #1f4d46);"></span>
      快捷编排
      <span class="text-[10px] font-normal opacity-60 ml-1">#{{ data.nodeIndex }}</span>
      <button @click="deleteNode" :disabled="data.locked" class="node-delete-btn">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div class="node-body">
      <div class="mb-2">
        <label class="node-label">模式</label>
        <select v-model="mode" @change="saveData" class="node-textarea nodrag w-full" :disabled="data.locked || data.status === 'running'">
          <option value="storyboard">图文分镜</option>
          <option value="batch_image">批量生图方案</option>
          <option value="product_workflow">商品图工作流</option>
        </select>
      </div>

      <div class="mb-2">
        <label class="node-label">需求</label>
        <PromptTextarea
          v-model="instruction"
          @change="saveData"
          title="编辑快捷编排需求"
          :height="112"
          :placeholder="instructionPlaceholder"
          container-class="nodrag nopan"
          input-class="text-[11px]"
          :disabled="data.locked || data.status === 'running'"
        />
      </div>

      <div v-if="mode === 'product_workflow'" class="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label class="node-label">主图数量</label>
          <input v-model.number="mainCount" @change="saveData" type="number" min="1" max="12" class="node-textarea nodrag w-full" :disabled="data.locked || data.status === 'running'" />
        </div>
        <div>
          <label class="node-label">详情图数量</label>
          <input v-model.number="detailCount" @change="saveData" type="number" min="0" max="12" class="node-textarea nodrag w-full" :disabled="data.locked || data.status === 'running'" />
        </div>
      </div>

      <div v-else class="mb-2">
        <label class="node-label">生成数量</label>
        <input v-model.number="count" @change="saveData" type="number" min="1" max="20" class="node-textarea nodrag w-full" :disabled="data.locked || data.status === 'running'" />
      </div>

      <div v-if="mode === 'product_workflow'" class="space-y-2 mb-2">
        <div>
          <label class="node-label">主图比例</label>
          <ImageSizePicker v-model="mainSize" size="sm" accent="primary" :columns="6" :disabled="data.locked || data.status === 'running'" :model-id="projectImageModelId" :tier-id="tier" />
        </div>
        <div>
          <label class="node-label">详情图比例</label>
          <ImageSizePicker v-model="detailSize" size="sm" accent="primary" :columns="6" :disabled="data.locked || data.status === 'running'" :model-id="projectImageModelId" :tier-id="tier" />
        </div>
      </div>

      <div v-else class="mb-2">
        <label class="node-label">图片比例</label>
        <ImageSizePicker v-model="size" size="sm" accent="primary" :columns="6" :disabled="data.locked || data.status === 'running'" :model-id="projectImageModelId" :tier-id="tier" />
      </div>

      <div class="mb-2">
        <label class="node-label">分辨率</label>
        <ResolutionTierPicker v-model="tier" size="sm" :model-id="projectImageModelId" :size-value="resolutionSizeValue" :disabled="data.locked || data.status === 'running'" />
      </div>

      <div class="mb-2">
        <label class="node-label">风格</label>
        <StylePresetPicker v-model="stylePresetId" />
        <p class="text-[9px] text-text-disabled mt-0.5 leading-relaxed">选中的风格会继承到展开出的每个文生图节点</p>
      </div>

      <label v-if="mode !== 'product_workflow'" class="flex items-center gap-1.5 text-[10px] text-text-tertiary mb-2">
        <input v-model="requireReference" @change="saveData" type="checkbox" class="nodrag" :disabled="data.locked || data.status === 'running'" />
        使用上游参考图
      </label>

      <label v-else class="flex items-center gap-1.5 text-[10px] text-text-tertiary mb-2">
        <input v-model="detailConsistencyEnabled" @change="saveData" type="checkbox" class="nodrag" :disabled="data.locked || data.status === 'running'" />
        详情图增强一致性
      </label>

      <div class="flex items-center justify-between gap-2 mb-2 text-[10px]">
        <span class="text-text-tertiary">参考图：{{ referenceStatusText }}</span>
        <span v-if="createdCount" class="text-primary-600">已展开 {{ createdCount }} 个节点</span>
      </div>

      <div v-if="disableReason" class="text-[10px] text-red-500 mb-2 break-words">{{ disableReason }}</div>
      <div v-if="data.status === 'running'" class="flex items-center gap-1.5 text-[10px] text-primary-600 mb-2">
        <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
        生成方案中...
      </div>
      <div v-if="data.status === 'error' && data.error" class="text-[10px] text-red-500 mb-2 break-words">{{ data.error }}</div>
      <div v-if="data.outputContent" class="text-[10px] text-text-secondary mb-2 p-2 bg-surface-2 rounded-lg max-h-28 overflow-y-auto break-words whitespace-pre-wrap">{{ data.outputContent }}</div>

      <button
        @click="runGenerate"
        :disabled="!!disableReason || data.status === 'running' || data.locked"
        class="w-full py-1.5 text-[10px] font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        生成方案并展开
      </button>
      <p class="mt-1.5 text-[9px] text-text-disabled leading-relaxed">只创建节点和连线，不会自动执行生图。检查后点击画布顶部“执行工作流”。</p>
    </div>
    <Handle type="target" :position="Position.Left" id="text-input" class="handle-text" style="top: 32%;" />
    <Handle type="target" :position="Position.Left" id="image-input" class="handle-image" style="top: 58%;" />
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
import { computed, inject, ref, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { DEFAULT_TIER_ID, isExtremeResolutionAspectRatio } from '@shared/image-size'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkflowEngine } from '../composables/useWorkflowEngine'
import ImageSizePicker from '@/components/ImageSizePicker.vue'
import ResolutionTierPicker from '@/components/ResolutionTierPicker.vue'
import StylePresetPicker from '@/components/StylePresetPicker.vue'
import PromptTextarea from '@/components/PromptTextarea.vue'

type HandleClickHandler = (e: MouseEvent, nodeId: string, handleId: string, dataType: 'text' | 'image') => void

const props = defineProps<{ data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const { executeSingleNode } = useWorkflowEngine()
const onHandleClick = inject<HandleClickHandler | null>('onHandleClick', null)
const QUICK_PRODUCT_DEFAULT_INSTRUCTION = '根据参考图，产品是XXXXXX，生成一套产品的多张电商主图，展现产品的不同角度和不同场景的实景。多张电商详情图，分别使用图文的形式突出产品的材质质感、卖点和使用场景等。'

const mode = ref(props.data.mode || 'product_workflow')
const instruction = ref(props.data.instruction || (mode.value === 'product_workflow' ? QUICK_PRODUCT_DEFAULT_INSTRUCTION : ''))
const count = ref(Number(props.data.count || 4))
const mainCount = ref(Number(props.data.main_count || 4))
const detailCount = ref(Number(props.data.detail_count || 3))
const size = ref(props.data.size || '1:1')
const mainSize = ref(props.data.main_size || '1:1')
const detailSize = ref(props.data.detail_size || '4:5')
const tier = ref(props.data.tier_id || DEFAULT_TIER_ID)
const requireReference = ref(Boolean(props.data.require_reference))
const detailConsistencyEnabled = ref(Boolean(props.data.detail_consistency_enabled))
// 风格预设 id（云端分发；null = 不使用风格，展开时继承到每个文生图节点）
const stylePresetId = ref<number | null>(Number(props.data.style_id) > 0 ? Number(props.data.style_id) : null)
const projectImageModelId = computed(() => canvasStore.currentProject?.image_model_id || '')
const resolutionSizeValue = computed(() => {
  if (mode.value !== 'product_workflow') return size.value
  if (isExtremeResolutionAspectRatio(mainSize.value)) return mainSize.value
  return detailSize.value
})

const upstreamImageNodes = computed(() => {
  if (!props.data.nodeId || !props.data.projectId) return []
  const incoming = canvasStore.edges.filter((e) => e.project_id === props.data.projectId && e.target_node_id === props.data.nodeId && e.target_handle === 'image-input')
  return incoming
    .map((edge) => canvasStore.nodes.find((node) => node.id === edge.source_node_id))
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
})

const availableReferenceCount = computed(() => upstreamImageNodes.value.filter(hasImageOutput).length)
const referenceRequired = computed(() => mode.value === 'product_workflow' || requireReference.value)
const referenceStatusText = computed(() => {
  if (availableReferenceCount.value > 0) return `${availableReferenceCount.value} 张可用`
  if (upstreamImageNodes.value.length > 0) return '已连接但暂无图片'
  return '未连接'
})
const createdNodeIds = computed<string[]>(() => Array.isArray(props.data.created_node_ids) ? props.data.created_node_ids : [])
const createdCount = computed(() => createdNodeIds.value.filter((id) => canvasStore.nodes.some((node) => node.id === id)).length)
const instructionPlaceholder = computed(() => {
  if (mode.value === 'product_workflow') return QUICK_PRODUCT_DEFAULT_INSTRUCTION
  if (mode.value === 'storyboard') return '例如：为新品发布生成一组图文分镜，每张图表达不同场景和卖点。'
  return '例如：围绕同一个产品主题，生成多张风格统一但构图不同的生图方案。'
})
const disableReason = computed(() => {
  if (createdCount.value > 0 && props.data.status === 'done') return `已展开 ${createdCount.value} 个节点，避免重复创建`
  if (!canvasStore.currentProject?.text_provider_id || !canvasStore.currentProject?.text_model_id) return '请先在画布设置中配置文本模型'
  if (!canvasStore.currentProject?.image_provider_id || !canvasStore.currentProject?.image_model_id) return '请先在画布设置中配置生图模型'
  if (!instruction.value.trim() && !hasUpstreamText.value) return '请填写需求，或连接上游文本节点'
  if (referenceRequired.value && availableReferenceCount.value === 0) return upstreamImageNodes.value.length > 0 ? '已连接图片类节点，但没有可用图片' : '此模式需要先连接参考图节点或上游图片结果'
  return ''
})
const hasUpstreamText = computed(() => {
  if (!props.data.nodeId || !props.data.projectId) return false
  const incoming = canvasStore.edges.filter((e) => e.project_id === props.data.projectId && e.target_node_id === props.data.nodeId && e.target_handle === 'text-input')
  return incoming.some((edge) => {
    const node = canvasStore.nodes.find((item) => item.id === edge.source_node_id)
    if (node?.type === 'imageRecognition') return false
    if (node?.type === 'promptSlice') {
      const rowId = String(edge.source_handle || '').replace('output-', '')
      return Boolean((node.data?.rows || []).find((row: any) => row.id === rowId)?.text)
    }
    return Boolean(node?.data?.text || node?.data?.result || node?.data?.outputContent)
  })
})

watch(() => props.data.mode, (value) => { if (value && value !== mode.value) mode.value = value })
watch(() => props.data.instruction, (value) => { if ((value || '') !== instruction.value) instruction.value = value || '' })
watch(() => props.data.detail_consistency_enabled, (value) => { detailConsistencyEnabled.value = Boolean(value) })
watch([size, mainSize, detailSize, tier, stylePresetId], () => saveData())

function hasImageOutput(node: any): boolean {
  if (!node) return false
  return Boolean(node.data?.result_path || node.data?.image_path || node.data?.image_data)
}

function clampCount(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function saveData() {
  if (!props.data.nodeId) return
  const nextMode = mode.value || 'product_workflow'
  const nextInstruction = nextMode === 'product_workflow' && !instruction.value.trim()
    ? QUICK_PRODUCT_DEFAULT_INSTRUCTION
    : instruction.value
  if (nextInstruction !== instruction.value) instruction.value = nextInstruction
  canvasStore.updateNode(props.data.nodeId, {
    data: {
      ...props.data,
      mode: nextMode,
      instruction: nextInstruction,
      count: clampCount(count.value, 1, 20, 4),
      main_count: clampCount(mainCount.value, 1, 12, 4),
      detail_count: clampCount(detailCount.value, 0, 12, 3),
      size: size.value,
      main_size: mainSize.value,
      detail_size: detailSize.value,
      tier_id: tier.value,
      require_reference: requireReference.value,
      detail_consistency_enabled: detailConsistencyEnabled.value,
      style_id: stylePresetId.value
    }
  })
}

async function runGenerate() {
  if (disableReason.value || !props.data.nodeId || !props.data.projectId) return
  saveData()
  await executeSingleNode(props.data.nodeId, props.data.projectId)
}

function deleteNode() {
  if (!props.data.nodeId) return
  canvasStore.removeNode(props.data.nodeId)
}
</script>
