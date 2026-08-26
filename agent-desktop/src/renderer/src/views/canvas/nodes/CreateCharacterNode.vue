<template>
  <div class="canvas-node canvas-node-wide" :style="{ borderColor: 'var(--color-primary-500, #23574f)' }" :data-status="data.status">
    <div class="node-header" style="background: var(--color-primary-50, #f2f6f5); color: var(--color-primary-700, #1a3f3a);">
      <span class="node-type-dot" style="background: var(--color-primary-500, #23574f);"></span>
      创建角色
      <span class="text-[10px] font-normal opacity-60 ml-1">#{{ data.nodeIndex }}</span>
      <span v-if="data.character_id" class="text-[9px] text-primary-500 ml-1">已入库</span>
      <button @click="deleteNode" :disabled="data.locked" class="node-delete-btn">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div class="node-body">
      <div class="mb-2">
        <label class="node-label">角色名</label>
        <input
          v-model="name"
          @change="saveData"
          @blur="saveData"
          :disabled="data.locked"
          type="text"
          placeholder="如：林晚、骑士A..."
          class="char-input nodrag nopan"
        />
      </div>
      <div class="mb-2">
        <label class="node-label">角色描述（也可连接上游文本）</label>
        <PromptTextarea
          v-model="description"
          @change="saveData"
          title="编辑角色描述"
          :height="70"
          placeholder="描述外貌、服饰、气质、年龄等，用于生成定妆图..."
          container-class="nodrag nopan"
          input-class="text-[11px]"
          :disabled="data.locked"
        />
      </div>

      <div v-if="data.status === 'running'" class="flex items-center gap-1.5 text-[10px] text-primary-600 mb-2">
        <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
        生成定妆图...
      </div>
      <div v-if="data.status === 'error'" class="text-[10px] text-red-500 mb-2 break-words">{{ data.error }}</div>

      <div v-if="data.result_path" class="mb-2">
        <img :src="getImageSrc(data.result_path)" class="w-full rounded-lg border border-surface-3 cursor-pointer" @click.stop="previewImage" />
      </div>

      <button
        @click="runGenerate"
        :disabled="data.status === 'running' || data.locked"
        class="w-full py-1.5 text-[10px] font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 transition-colors"
      >
        {{ data.status === 'running' ? '生成中...' : '生成定妆图' }}
      </button>
    </div>

    <Handle type="target" :position="Position.Left" id="text-input" class="handle-text" />
    <Handle
      type="source"
      :position="Position.Right"
      id="output"
      class="handle-image"
      @click="(e: MouseEvent) => onHandleClick?.(e, data.nodeId, 'output', 'image')"
    />
  </div>
  <ImageLightbox
    :src="previewSrc"
    :on-copy="copyImage"
    :on-locate="openInFolder"
    @close="previewSrc = null"
  />
</template>

<script setup lang="ts">
import { ref, inject } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkflowEngine } from '../composables/useWorkflowEngine'
import PromptTextarea from '@/components/PromptTextarea.vue'
import ImageLightbox from '@/components/ImageLightbox.vue'

type HandleClickHandler = (e: MouseEvent, nodeId: string, handleId: string, dataType: 'text' | 'image' | 'video') => void

const props = defineProps<{ data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const { executeSingleNode } = useWorkflowEngine()
const api = () => (window as any).api
const onHandleClick = inject<HandleClickHandler | null>('onHandleClick', null)

const name = ref(String(props.data.name || ''))
const description = ref(String(props.data.description || ''))
const previewSrc = ref<string | null>(null)

function saveData() {
  if (!props.data.nodeId) return
  canvasStore.updateNode(props.data.nodeId, {
    data: { ...props.data, name: name.value, description: description.value }
  })
}

function getImageSrc(path: string): string {
  if (!path) return ''
  if (path.startsWith('data:') || path.startsWith('http')) return path
  const isAbsolute = /^[A-Za-z]:|^\//.test(path)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://img?' + param + '=' + encodeURIComponent(path)
}

function previewImage() {
  if (props.data.result_path) previewSrc.value = getImageSrc(props.data.result_path)
}

function copyImage() {
  if (props.data.result_path) api().clipboard.writeImage(props.data.result_path)
}

function openInFolder() {
  if (props.data.result_path) api().shell.showItemInFolder(props.data.result_path)
}

async function runGenerate() {
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
.char-input {
  width: 100%;
  padding: 4px 8px;
  font-size: 11px;
  border: 1px solid var(--surface-3, #e5e7eb);
  border-radius: 8px;
  background: var(--surface-0, #fff);
  color: var(--text-primary, #111);
}
.char-input:disabled {
  opacity: 0.5;
}
</style>
