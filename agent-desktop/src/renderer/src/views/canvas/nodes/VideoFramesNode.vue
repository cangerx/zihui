<template>
  <div class="canvas-node canvas-node-wide" :style="{ borderColor: 'var(--color-primary-500, #23574f)' }" :data-status="data.status">
    <div class="node-header" style="background: var(--color-primary-50, #f2f6f5); color: var(--color-primary-700, #1a3f3a);">
      <span class="node-type-dot" style="background: var(--color-primary-500, #23574f);"></span>
      关键帧抽取
      <span class="text-[10px] font-normal opacity-60 ml-1">#{{ data.nodeIndex }}</span>
      <span v-if="frames.length" class="text-[9px] text-cyan-500 ml-1">{{ frames.length }} 帧</span>
      <button @click="deleteNode" :disabled="data.locked" class="node-delete-btn">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div class="node-body">
      <div class="mb-2">
        <label class="node-label">抽帧方式</label>
        <select v-model="mode" @change="saveData" :disabled="data.locked" class="frames-select nodrag nopan">
          <option value="uniform">均匀 N 帧</option>
          <option value="interval">固定间隔</option>
          <option value="first_last">仅首尾帧</option>
        </select>
      </div>
      <div v-if="mode === 'uniform'" class="mb-2">
        <label class="node-label">帧数</label>
        <input v-model.number="count" @change="saveData" type="number" min="2" max="20" :disabled="data.locked" class="frames-select nodrag nopan" />
      </div>
      <div v-if="mode === 'interval'" class="mb-2">
        <label class="node-label">间隔（秒）</label>
        <input v-model.number="intervalSec" @change="saveData" type="number" min="0.5" max="30" step="0.5" :disabled="data.locked" class="frames-select nodrag nopan" />
      </div>

      <div v-if="data.status === 'running'" class="flex items-center gap-1.5 text-[10px] text-cyan-600 mb-2">
        <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
        抽取中...
      </div>
      <div v-if="data.status === 'error'" class="text-[10px] text-red-500 mb-2 break-words">{{ data.error }}</div>

      <div v-if="frames.length" class="grid grid-cols-3 gap-1 mb-2">
        <div v-for="f in frames" :key="f.id" class="relative">
          <img :src="frameSrc(f.path)" class="w-full rounded border border-surface-3" />
          <span class="absolute bottom-0 right-0 text-[8px] bg-black/60 text-white px-0.5 rounded-tl">{{ f.time.toFixed(1) }}s</span>
        </div>
      </div>

      <button
        @click="runExtract"
        :disabled="data.status === 'running' || data.locked"
        class="w-full py-1.5 text-[10px] font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 transition-colors"
      >
        {{ data.status === 'running' ? '抽取中...' : '抽取关键帧' }}
      </button>
    </div>

    <Handle type="target" :position="Position.Left" id="video-input" class="handle-video" />
    <Handle
      v-for="(f, idx) in frames"
      :key="f.id"
      type="source"
      :position="Position.Right"
      :id="`output-${f.id}`"
      class="handle-image"
      :style="{ top: frameHandleTop(idx) }"
      @click="(e: MouseEvent) => onHandleClick?.(e, data.nodeId, `output-${f.id}`, 'image')"
    />
    <Handle v-if="!frames.length" type="source" :position="Position.Right" id="output-0" class="handle-image" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkflowEngine } from '../composables/useWorkflowEngine'

type HandleClickHandler = (e: MouseEvent, nodeId: string, handleId: string, dataType: 'text' | 'image' | 'video') => void
interface Frame { id: string; time: number; path: string }

const props = defineProps<{ data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const { executeSingleNode } = useWorkflowEngine()
const onHandleClick = inject<HandleClickHandler | null>('onHandleClick', null)

const mode = ref(props.data.mode || 'uniform')
const count = ref<number>(props.data.count || 4)
const intervalSec = ref<number>(props.data.intervalSec || 2)
const frames = computed<Frame[]>(() => props.data.frames || [])

function frameSrc(path: string): string {
  if (!path) return ''
  if (/^(https?:|data:|blob:)/i.test(path)) return path
  const isAbsolute = /^[A-Za-z]:|^\//.test(path)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://img?' + param + '=' + encodeURIComponent(path)
}

function frameHandleTop(idx: number): string {
  const n = frames.value.length
  if (n <= 1) return '50%'
  return `${15 + (70 * idx) / (n - 1)}%`
}

function saveData() {
  if (!props.data.nodeId) return
  canvasStore.updateNode(props.data.nodeId, {
    data: { ...props.data, mode: mode.value, count: Number(count.value) || 4, intervalSec: Number(intervalSec.value) || 2 }
  })
}

async function runExtract() {
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
.frames-select {
  width: 100%;
  padding: 4px 8px;
  font-size: 11px;
  border: 1px solid var(--surface-3, #e5e7eb);
  border-radius: 8px;
  background: var(--surface-0, #fff);
  color: var(--text-primary, #111);
}
.frames-select:disabled { opacity: 0.5; }
</style>
