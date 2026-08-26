<template>
  <div class="canvas-node" style="min-width: 300px;" :style="{ borderColor: 'var(--color-primary-600, #1f4d46)' }" :data-status="data.status">
    <div class="node-header" style="background: var(--color-primary-50, #f2f6f5); color: var(--color-primary-700, #1a3f3a);">
      <span class="node-type-dot" style="background: var(--color-primary-600, #1f4d46);"></span>
      智能分镜
      <span class="text-[10px] font-normal opacity-60 ml-1">#{{ data.nodeIndex }}</span>
      <span v-if="shots.length" class="text-[9px] text-primary-400 ml-1">{{ shots.length }} 镜</span>
      <button @click="deleteNode" :disabled="data.locked" class="node-delete-btn">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div class="node-body">
      <div class="mb-2">
        <label class="node-label">小说 / 剧情（也可连接上游文本）</label>
        <PromptTextarea
          v-model="text"
          @change="saveData"
          title="编辑分镜源文本"
          :height="80"
          placeholder="粘贴小说、剧情或脚本，AI 会拆分为镜头..."
          container-class="nodrag nopan"
          input-class="text-[11px]"
          :disabled="data.locked"
        />
      </div>

      <div v-if="data.status === 'running'" class="flex items-center gap-1.5 text-[10px] text-primary-600 mb-2">
        <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
        分镜中...
      </div>
      <div v-if="data.status === 'error'" class="text-[10px] text-red-500 mb-2 break-words">{{ data.error }}</div>

      <div v-if="shots.length" class="space-y-2 mb-2">
        <div v-for="(s, idx) in shots" :key="s.id" class="prompt-slice-row relative flex items-start gap-1.5">
          <span class="text-[10px] text-text-disabled mt-0.5 w-4 text-right flex-shrink-0">{{ idx + 1 }}</span>
          <div class="flex-1 min-w-0">
            <p class="text-[11px] text-text-secondary leading-relaxed break-words">{{ s.prompt }}</p>
            <p v-if="s.shot_size || s.camera || s.mood" class="text-[9px] text-text-disabled mt-0.5">{{ [s.shot_size, s.camera, s.mood].filter(Boolean).join(' · ') }}</p>
          </div>
          <Handle
            type="source"
            :position="Position.Right"
            :id="`output-${s.id}`"
            class="handle-text"
            @click="(e: MouseEvent) => onHandleClick?.(e, data.nodeId, `output-${s.id}`, 'text')"
          />
        </div>
      </div>

      <button
        @click="runStoryboard"
        :disabled="data.status === 'running' || data.locked"
        class="w-full py-1.5 text-[10px] font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 transition-colors"
      >
        {{ data.status === 'running' ? '分镜中...' : 'AI 分镜' }}
      </button>
    </div>

    <Handle type="target" :position="Position.Left" id="text-input" class="handle-text" />
    <Handle v-if="!shots.length" type="source" :position="Position.Right" id="output-0" class="handle-text" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkflowEngine } from '../composables/useWorkflowEngine'
import PromptTextarea from '@/components/PromptTextarea.vue'

type HandleClickHandler = (e: MouseEvent, nodeId: string, handleId: string, dataType: 'text' | 'image' | 'video') => void
interface Shot { id: string; scene_index: number; prompt: string; shot_size?: string; camera?: string; mood?: string }

const props = defineProps<{ data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const { executeSingleNode } = useWorkflowEngine()
const onHandleClick = inject<HandleClickHandler | null>('onHandleClick', null)

const text = ref(props.data.text || '')
const shots = computed<Shot[]>(() => props.data.shots || [])

function saveData() {
  if (!props.data.nodeId) return
  canvasStore.updateNode(props.data.nodeId, { data: { ...props.data, text: text.value } })
}

async function runStoryboard() {
  if (!props.data.nodeId || !props.data.projectId) return
  saveData()
  await executeSingleNode(props.data.nodeId, props.data.projectId)
}

function deleteNode() {
  if (!props.data.nodeId) return
  canvasStore.removeNode(props.data.nodeId)
}
</script>
