<template>
  <div class="canvas-node canvas-node-wide" :style="{ borderColor: 'var(--color-primary-500, #23574f)' }" :data-status="data.status">
    <div class="node-header" style="background: var(--color-primary-50, #f2f6f5); color: var(--color-primary-700, #1a3f3a);">
      <span class="node-type-dot" style="background: var(--color-primary-500, #23574f);"></span>
      文生图
      <span class="text-[10px] font-normal opacity-60 ml-1">#{{ data.nodeIndex }}</span>
      <button @click="deleteNode" :disabled="data.locked" class="node-delete-btn">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div class="node-body">
      <div class="mb-2">
        <label class="node-label">尺寸</label>
        <ImageSizePicker
          v-model="size"
          size="sm"
          accent="amber"
          :columns="6"
          :disabled="data.locked"
          :model-id="projectImageModelId"
          :tier-id="tier"
        />
      </div>
      <div class="mb-2">
        <label class="node-label">分辨率</label>
        <ResolutionTierPicker
          v-model="tier"
          size="sm"
          :model-id="projectImageModelId"
          :size-value="size"
          :disabled="data.locked"
        />
      </div>
      <div class="mb-2">
        <label class="node-label">风格</label>
        <StylePresetPicker v-model="stylePresetId" />
      </div>
      <!-- Status & Result -->
      <div v-if="data.status === 'running'" class="flex items-center gap-1.5 text-[10px] text-amber-600 mb-2">
        <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
        生成中...
      </div>
      <div v-if="data.status === 'error'" class="text-[10px] text-red-500 mb-2 break-words">{{ data.error }}</div>
      <div v-if="data.status === 'done' && data.ref_image_count" class="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-300 dark:bg-amber-900/30 dark:border-amber-800 rounded px-1.5 py-0.5 mb-2 inline-flex items-center gap-1">
        <svg class="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>
        已使用 {{ data.ref_image_count }} 张参考图
      </div>
      <div v-if="data.result_path" class="mb-2">
        <img :src="getImageSrc(data.result_path)" class="w-full rounded-lg border border-surface-3 cursor-pointer" @click.stop="previewImage" />
        <button
          class="nodrag nopan mt-1 w-full py-1 text-[10px] text-text-tertiary hover:text-primary-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          :disabled="data.locked"
          @click="openEdit"
        >编辑</button>
      </div>
      <button
        @click="runGenerate"
        :disabled="data.status === 'running' || data.locked"
        class="w-full py-1.5 text-[10px] font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 transition-colors"
      >
        生成
      </button>
    </div>
    <Handle type="target" :position="Position.Left" id="text-input" class="handle-text" style="top: 35%;" />
    <Handle type="target" :position="Position.Left" id="image-input" class="handle-image" style="top: 65%;" />
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
import { ref, inject, watch, computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkflowEngine } from '../composables/useWorkflowEngine'
import ImageSizePicker from '@/components/ImageSizePicker.vue'
import ResolutionTierPicker from '@/components/ResolutionTierPicker.vue'
import StylePresetPicker from '@/components/StylePresetPicker.vue'
import ImageLightbox from '@/components/ImageLightbox.vue'
import { DEFAULT_TIER_ID } from '@shared/image-size'

type HandleClickHandler = (e: MouseEvent, nodeId: string, handleId: string, dataType: 'text' | 'image') => void

const props = defineProps<{ data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const { executeSingleNode } = useWorkflowEngine()
const api = () => (window as any).api
const onHandleClick = inject<HandleClickHandler | null>('onHandleClick', null)
const openCanvasImageEditor = inject<((payload: {
  nodeId: string
  sourcePath?: string
  sourceDataUri?: string
  apply: (dataUrl: string) => Promise<void>
}) => void) | null>('openCanvasImageEditor', null)

const size = ref(props.data.size || '1:1')
const tier = ref<string>(props.data.tier_id || DEFAULT_TIER_ID)
// 风格预设 id（云端分发；null = 不使用风格，执行时拼接到提示词尾部）
const stylePresetId = ref<number | null>(Number(props.data.style_id) > 0 ? Number(props.data.style_id) : null)
const previewSrc = ref<string | null>(null)

// v-model driven: persist whenever the user picks a preset or confirms a custom value.
watch([size, tier, stylePresetId], () => saveData())

function saveData() {
  if (!props.data.nodeId) return
  canvasStore.updateNode(props.data.nodeId, {
    data: { ...props.data, size: size.value, tier_id: tier.value, style_id: stylePresetId.value }
  })
}

/** 节点展示用：从 canvas 当前项目拿生图模型 id，用于 ImageSizePicker/ResolutionTierPicker 能力域 */
const projectImageModelId = computed(() => canvasStore.currentProject?.image_model_id || '')

function getImageSrc(path: string): string {
  if (!path) return ''
  if (path.startsWith('data:') || path.startsWith('http')) return path
  const isAbsolute = /^[A-Za-z]:|^\//.test(path)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://img?' + param + '=' + encodeURIComponent(path)
}

function previewImage() {
  if (props.data.result_path) {
    previewSrc.value = getImageSrc(props.data.result_path)
  }
}

function copyImage() {
  if (props.data.result_path) {
    api().clipboard.writeImage(props.data.result_path)
  }
}

function openInFolder() {
  if (props.data.result_path) {
    api().shell.showItemInFolder(props.data.result_path)
  }
}

async function runGenerate() {
  if (!props.data.nodeId || !props.data.projectId) return
  await executeSingleNode(props.data.nodeId, props.data.projectId)
}

function deleteNode() {
  if (!props.data.nodeId) return
  canvasStore.removeNode(props.data.nodeId)
}

async function persistEditedResult(dataUrl: string) {
  if (!props.data.nodeId || !props.data.projectId) return
  const res = await api().canvas.invoke('saveNodeResultImage', props.data.projectId, props.data.nodeId, dataUrl)
  canvasStore.updateNode(props.data.nodeId, {
    data: { ...props.data, result_path: res.image_path }
  })
}

function openEdit() {
  if (props.data.locked || !props.data.nodeId || !openCanvasImageEditor) return
  if (!props.data.result_path) return
  openCanvasImageEditor({
    nodeId: props.data.nodeId,
    sourcePath: props.data.result_path,
    apply: persistEditedResult
  })
}

</script>
