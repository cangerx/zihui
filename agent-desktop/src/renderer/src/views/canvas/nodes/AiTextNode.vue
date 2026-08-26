<template>
  <div class="canvas-node" :style="{ borderColor: 'var(--color-primary-400, #6a9a92)' }" :data-status="data.status">
    <div class="node-header" style="background: var(--color-primary-50, #f2f6f5); color: var(--color-primary-700, #1a3f3a);">
      <span class="node-type-dot" style="background: var(--color-primary-400, #6a9a92);"></span>
      AI 文本
      <span class="text-[10px] font-normal opacity-60 ml-1">#{{ data.nodeIndex }}</span>
      <button @click="deleteNode" :disabled="data.locked" class="node-delete-btn">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div class="node-body">
      <!-- 系统提示词可折叠区域：默认折叠，点击展开以自定义默认行为 -->
      <div class="mb-2">
        <button
          @click.stop="showSystemPrompt = !showSystemPrompt"
          :disabled="data.locked"
          class="w-full flex items-center justify-between gap-1.5 px-1 py-0.5 text-[10px] text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-50"
        >
          <span class="flex items-center gap-1">
            <svg class="w-2.5 h-2.5 transition-transform" :class="{ 'rotate-90': showSystemPrompt }" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
            系统提示词
          </span>
          <span class="text-[9px] opacity-70">{{ systemPromptStatusLabel }}</span>
        </button>
        <div v-if="showSystemPrompt" class="mt-1.5">
          <PromptTextarea
            v-model="systemPromptModel"
            @change="saveSystemPrompt"
            title="编辑 AI 文本系统提示词"
            :height="88"
            placeholder="默认：扩写为图像生成提示词。留空可让 AI 按输入自由响应。"
            container-class="nodrag nopan"
            input-class="text-[11px]"
            :disabled="data.locked"
          />
          <div class="flex items-center justify-between mt-1">
            <span class="text-[9px] text-text-disabled">留空让 AI 按用户输入自由响应</span>
            <button
              v-if="data.system_prompt !== undefined"
              @click.stop="resetSystemPrompt"
              :disabled="data.locked"
              class="text-[9px] text-text-tertiary hover:text-primary-600 transition-colors disabled:opacity-50"
            >
              恢复默认
            </button>
          </div>
        </div>
      </div>
      <div v-if="data.status === 'running'" class="flex items-center gap-1.5 text-[10px] text-amber-600 mb-2">
        <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
        AI 润色中...
      </div>
      <div v-if="data.status === 'error'" class="text-[10px] text-red-500 mb-2 break-words">{{ data.error }}</div>
      <div v-if="data.result" class="text-[10px] text-text-secondary mb-2 p-2 bg-surface-2 rounded-lg max-h-24 overflow-y-auto break-words">{{ data.result }}</div>
      <button
        @click="runAiText"
        :disabled="data.status === 'running' || data.locked"
        class="w-full py-1.5 text-[10px] font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 transition-colors"
      >
        AI 润色
      </button>
    </div>
    <Handle type="target" :position="Position.Left" id="input" class="handle-text" />
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
import { useWorkflowEngine } from '../composables/useWorkflowEngine'
import PromptTextarea from '@/components/PromptTextarea.vue'

type HandleClickHandler = (e: MouseEvent, nodeId: string, handleId: string, dataType: 'text' | 'image') => void

const props = defineProps<{ data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const { executeSingleNode } = useWorkflowEngine()
const onHandleClick = inject<HandleClickHandler | null>('onHandleClick', null)

// system_prompt 状态微妙三态：
//   undefined  → 默认模板（兑底中文 system prompt）
//   ''         → 不传 system，让 LLM 自由响应
//   '其他'      → 用户自定义
const showSystemPrompt = ref(false)
const systemPromptModel = ref<string>(props.data.system_prompt ?? '')

watch(
  () => props.data.system_prompt,
  (val) => {
    systemPromptModel.value = val ?? ''
  }
)

const systemPromptStatusLabel = computed(() => {
  const v = props.data.system_prompt
  if (v === undefined) return '默认'
  if (v === '') return '已禁用'
  return '已自定义'
})

function saveSystemPrompt() {
  if (!props.data.nodeId) return
  canvasStore.updateNode(props.data.nodeId, {
    data: { ...props.data, system_prompt: systemPromptModel.value }
  })
}

function resetSystemPrompt() {
  if (!props.data.nodeId) return
  const next = { ...props.data }
  delete next.system_prompt
  canvasStore.updateNode(props.data.nodeId, { data: next })
  systemPromptModel.value = ''
}

async function runAiText() {
  if (!props.data.nodeId || !props.data.projectId) return
  await executeSingleNode(props.data.nodeId, props.data.projectId)
}

function deleteNode() {
  if (!props.data.nodeId) return
  canvasStore.removeNode(props.data.nodeId)
}
</script>
