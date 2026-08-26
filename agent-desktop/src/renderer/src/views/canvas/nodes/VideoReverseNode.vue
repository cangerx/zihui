<template>
  <div class="canvas-node canvas-node-wide" :style="{ borderColor: 'var(--color-primary-500, #23574f)' }" :data-status="data.status">
    <div class="node-header" style="background: var(--color-primary-50, #f2f6f5); color: var(--color-primary-700, #1a3f3a);">
      <span class="node-type-dot" style="background: var(--color-primary-500, #23574f);"></span>
      视频反推
      <span class="text-[10px] font-normal opacity-60 ml-1">#{{ data.nodeIndex }}</span>
      <button @click="deleteNode" :disabled="data.locked" class="node-delete-btn">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div class="node-body">
      <div class="mb-2">
        <label class="node-label">输出</label>
        <select v-model="mode" @change="saveData" :disabled="data.locked" class="rev-select nodrag nopan">
          <option value="prompt">整段提示词</option>
          <option value="storyboard">分镜（多行）</option>
        </select>
      </div>
      <div class="mb-2 flex gap-2">
        <div class="flex-1">
          <label class="node-label">语言</label>
          <select v-model="outputLang" @change="saveData" :disabled="data.locked" class="rev-select nodrag nopan">
            <option value="cn">中文</option>
            <option value="en">English</option>
          </select>
        </div>
        <div class="flex-1">
          <label class="node-label">采样帧数</label>
          <input v-model.number="frameLimit" @change="saveData" type="number" min="2" max="12" :disabled="data.locked" class="rev-select nodrag nopan" />
        </div>
      </div>

      <div v-if="data.status === 'running'" class="flex items-center gap-1.5 text-[10px] text-teal-600 mb-2">
        <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
        反推中...
      </div>
      <div v-if="data.status === 'error'" class="text-[10px] text-red-500 mb-2 break-words">{{ data.error }}</div>
      <div v-if="data.result" class="mb-2 p-2 text-[11px] leading-relaxed text-text-secondary bg-surface-1 border border-surface-3 rounded-lg max-h-40 overflow-auto whitespace-pre-wrap nodrag nopan">{{ data.result }}</div>

      <button
        @click="runReverse"
        :disabled="data.status === 'running' || data.locked"
        class="w-full py-1.5 text-[10px] font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 transition-colors"
      >
        {{ data.status === 'running' ? '反推中...' : '反推提示词' }}
      </button>
    </div>

    <Handle type="target" :position="Position.Left" id="video-input" class="handle-video" />
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
import { ref, inject } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkflowEngine } from '../composables/useWorkflowEngine'

type HandleClickHandler = (e: MouseEvent, nodeId: string, handleId: string, dataType: 'text' | 'image' | 'video') => void

const props = defineProps<{ data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const { executeSingleNode } = useWorkflowEngine()
const onHandleClick = inject<HandleClickHandler | null>('onHandleClick', null)

const mode = ref(props.data.mode || 'prompt')
const outputLang = ref(props.data.output_lang || 'cn')
const frameLimit = ref<number>(props.data.frameLimit || 8)

function saveData() {
  if (!props.data.nodeId) return
  canvasStore.updateNode(props.data.nodeId, {
    data: { ...props.data, mode: mode.value, output_lang: outputLang.value, frameLimit: Number(frameLimit.value) || 8 }
  })
}

async function runReverse() {
  if (!props.data.nodeId || !props.data.projectId) return
  saveData()
  await executeSingleNode(props.data.nodeId, props.data.projectId)
}

function deleteNode() {
  if (!props.data.nodeId) return
  canvasStore.removeNode(props.data.nodeId)
}
</script>

<style scoped>
.rev-select {
  width: 100%;
  padding: 4px 8px;
  font-size: 11px;
  border: 1px solid var(--surface-3, #e5e7eb);
  border-radius: 8px;
  background: var(--surface-0, #fff);
  color: var(--text-primary, #111);
}
.rev-select:disabled { opacity: 0.5; }
</style>
