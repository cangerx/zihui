<template>
  <div class="canvas-node canvas-node-wide" :style="{ borderColor: 'var(--color-primary-500, #23574f)' }" :data-status="data.status">
    <div class="node-header" style="background: var(--color-primary-50, #f2f6f5); color: var(--color-primary-700, #1a3f3a);">
      <span class="node-type-dot" style="background: var(--color-primary-500, #23574f);"></span>
      AI 视频
      <span class="text-[10px] font-normal opacity-60 ml-1">#{{ data.nodeIndex }}</span>
      <button @click="deleteNode" :disabled="data.locked" class="node-delete-btn">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div class="node-body">
      <div class="mb-2">
        <label class="node-label">模型</label>
        <select v-model="modelId" @change="onModelChange" :disabled="data.locked" class="video-node-select nodrag nopan">
          <option v-if="!catalogModels.length" value="">（无可用视频模型）</option>
          <option v-for="m in catalogModels" :key="m.model_id" :value="m.model_id">{{ m.display_name }}</option>
        </select>
      </div>
      <div v-if="modeOpts.length > 1" class="mb-2">
        <label class="node-label">模式</label>
        <select v-model="mode" :disabled="data.locked" class="video-node-select nodrag nopan">
          <option v-for="o in modeOpts" :key="o" :value="o">{{ modeLabel(o) }}</option>
        </select>
      </div>
      <div v-if="durationOpts.length > 1" class="mb-2">
        <label class="node-label">时长</label>
        <select v-model.number="duration" :disabled="data.locked" class="video-node-select nodrag nopan">
          <option v-for="o in durationOpts" :key="o" :value="o">{{ o }} 秒</option>
        </select>
      </div>
      <div v-if="resolutionOpts.length > 1" class="mb-2">
        <label class="node-label">清晰度</label>
        <select v-model="resolution" :disabled="data.locked" class="video-node-select nodrag nopan">
          <option v-for="o in resolutionOpts" :key="o" :value="o">{{ o }}</option>
        </select>
      </div>
      <div v-if="aspectRatioOpts.length > 1" class="mb-2">
        <label class="node-label">画面比例</label>
        <select v-model="aspectRatio" :disabled="data.locked" class="video-node-select nodrag nopan">
          <option v-for="o in aspectRatioOpts" :key="o" :value="o">{{ o }}</option>
        </select>
      </div>
      <div class="mb-2">
        <label class="node-label">提示词</label>
        <PromptTextarea
          v-model="prompt"
          @change="saveData"
          title="编辑视频提示词"
          :height="60"
          :max-length="IMAGE_PROMPT_MAX_LENGTH"
          placeholder="描述视频内容..."
          container-class="nodrag nopan"
          input-class="text-[11px]"
          :disabled="data.locked"
        />
      </div>
      <div class="text-[10px] text-text-tertiary mb-2">{{ referenceHint }}</div>
      <div v-if="selectedSku" class="text-[10px] text-primary-700 mb-2">计费：{{ formatCredit(selectedSku.credit_cost) }} 积分 / 次</div>
      <div v-else-if="modelId" class="text-[10px] text-amber-600 mb-2">当前规格暂无可用计费档</div>

      <div v-if="data.status === 'running'" class="mb-2">
        <div class="flex items-center gap-1.5 text-[10px] text-primary-600">
          <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
          生成中 {{ data.progress || 0 }}%
        </div>
        <div class="h-1 bg-surface-2 rounded mt-1 overflow-hidden"><div class="h-full bg-primary-500 rounded transition-all" :style="{ width: (data.progress || 0) + '%' }"></div></div>
      </div>
      <div v-if="data.status === 'error'" class="text-[10px] text-red-500 mb-2 break-words">{{ data.error }}</div>

      <div v-if="playableSrc" class="mb-2">
        <video :src="playableSrc" controls preload="metadata" :poster="posterSrc" class="w-full rounded-lg border border-surface-3 bg-black"></video>
      </div>

      <button
        @click="runGenerate"
        :disabled="data.status === 'running' || data.locked || !selectedSku"
        class="w-full py-1.5 text-[10px] font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 transition-colors"
      >
        {{ data.status === 'running' ? '生成中...' : '生成视频' }}
      </button>
    </div>

    <Handle type="target" :position="Position.Left" id="text-input" class="handle-text" style="top: 28%;" />
    <Handle v-if="!isFirstLast" type="target" :position="Position.Left" id="image-input" class="handle-image" style="top: 50%;" />
    <Handle v-if="isFirstLast" type="target" :position="Position.Left" id="first-frame-input" class="handle-image" style="top: 46%;" />
    <Handle v-if="isFirstLast" type="target" :position="Position.Left" id="last-frame-input" class="handle-image" style="top: 64%;" />
    <Handle
      type="source"
      :position="Position.Right"
      id="output"
      class="handle-video"
      @click="(e: MouseEvent) => onHandleClick?.(e, data.nodeId, 'output', 'video')"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, inject, computed, watch, onMounted, onUnmounted } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkflowEngine } from '../composables/useWorkflowEngine'
import { useVideoCatalogSelection } from '../composables/useVideoCatalogSelection'
import PromptTextarea from '@/components/PromptTextarea.vue'
import { IMAGE_PROMPT_MAX_LENGTH } from '@shared/prompt-limits'

type HandleClickHandler = (e: MouseEvent, nodeId: string, handleId: string, dataType: 'text' | 'image' | 'video') => void

const props = defineProps<{ data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const { executeSingleNode, attachVideoTaskPolling } = useWorkflowEngine()
const {
  catalogModels,
  loadCatalog,
  getModel,
  modeOptions,
  durationOptions,
  resolutionOptions,
  aspectRatioOptions,
  matchSku,
  normalizeSelection,
} = useVideoCatalogSelection()
const onHandleClick = inject<HandleClickHandler | null>('onHandleClick', null)
const api = () => (window as any).api

const modelId = ref(String(props.data.model_id || ''))
const mode = ref(String(props.data.mode || ''))
const duration = ref<number | ''>(props.data.duration_seconds || '')
const resolution = ref(String(props.data.resolution || ''))
const aspectRatio = ref(String(props.data.aspect_ratio || ''))
const prompt = ref(String(props.data.prompt || ''))

let offUpdated: (() => void) | null = null
let offDeleted: (() => void) | null = null

const selectedModel = computed(() => getModel(modelId.value))
const modeOpts = computed(() => modeOptions(selectedModel.value))
const durationOpts = computed(() => durationOptions(selectedModel.value))
const resolutionOpts = computed(() => resolutionOptions(selectedModel.value))
const aspectRatioOpts = computed(() => aspectRatioOptions(selectedModel.value))
const isFirstLast = computed(() => mode.value === 'first_last_frame')
const selectedSku = computed(() =>
  matchSku(selectedModel.value, { mode: mode.value, duration: duration.value, resolution: resolution.value, aspect_ratio: aspectRatio.value })
)

const referenceHint = computed(() => {
  if (isFirstLast.value) return '首尾帧：分别连接「首帧」「尾帧」图片节点到对应输入'
  const max = Number(selectedModel.value?.max_reference_images) || 0
  if (max > 0) return `可连接图片节点作为参考图（最多 ${max} 张），及文本节点作为提示词`
  return '可连接文本 / 图片节点作为输入'
})

const playableSrc = computed(() => {
  if (props.data.result_path) return videoSrc(props.data.result_path)
  return props.data.video_url || ''
})
const posterSrc = computed(() => (props.data.cover_url ? props.data.cover_url : undefined))

function videoSrc(path: string): string {
  if (!path) return ''
  if (path.startsWith('http') || path.startsWith('blob:') || path.startsWith('data:')) return path
  const isAbsolute = /^[A-Za-z]:|^\//.test(path)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://video?' + param + '=' + encodeURIComponent(path)
}

function modeLabel(m: string): string {
  return ({
    text_to_video: '文生视频',
    image_to_video: '图生视频',
    first_last_frame: '首尾帧',
    standard: '标准',
    fast: '快速',
  } as Record<string, string>)[m] || m || '-'
}

function formatCredit(v: number): string {
  const n = Number(v) || 0
  return n.toString()
}

function applyNormalized() {
  const norm = normalizeSelection(selectedModel.value, {
    mode: mode.value,
    duration: duration.value,
    resolution: resolution.value,
    aspect_ratio: aspectRatio.value,
  })
  mode.value = norm.mode
  duration.value = norm.duration
  resolution.value = norm.resolution
  aspectRatio.value = norm.aspect_ratio
}

async function saveData() {
  if (!props.data.nodeId) return
  await canvasStore.updateNode(props.data.nodeId, {
    data: {
      ...props.data,
      model_id: modelId.value,
      mode: mode.value,
      duration_seconds: Number(duration.value) || 0,
      resolution: resolution.value,
      aspect_ratio: aspectRatio.value,
      prompt: prompt.value,
      sku_key: selectedSku.value?.sku_key || '',
    },
  })
}

// 规格变更即持久化（避免改了时长/清晰度/比例未生成就切走导致丢失）
watch([mode, duration, resolution, aspectRatio], () => { void saveData() })

function onModelChange() {
  applyNormalized()
  void saveData()
}

async function runGenerate() {
  if (!props.data.nodeId || !props.data.projectId) return
  await saveData()
  await executeSingleNode(props.data.nodeId, props.data.projectId)
}

function deleteNode() {
  if (!props.data.nodeId) return
  canvasStore.removeNode(props.data.nodeId)
}

onMounted(async () => {
  await loadCatalog()
  if (!modelId.value && catalogModels.value.length) modelId.value = catalogModels.value[0].model_id
  applyNormalized()
  await saveData()

  // 重开恢复：有云端任务且未到终态 → 重新登记后台轮询
  const st = String(props.data.status || '')
  if (props.data.cloud_task_id && st !== 'done' && st !== 'error') {
    attachVideoTaskPolling(props.data.nodeId, props.data.projectId, props.data.cloud_task_id)
  }

  // 下载完成后回填本地路径（落盘是异步的）
  offUpdated = api().videoGen.onUpdated((rec: any) => {
    if (rec?.cloud_task_id && rec.cloud_task_id === props.data.cloud_task_id && rec.local_path) {
      canvasStore.updateNode(props.data.nodeId, { data: { ...props.data, result_path: rec.local_path } })
    }
  })
  // 创作记录被删 → 节点回到可重生成
  offDeleted = api().videoGen.onDeleted((d: any) => {
    if (d?.id && d.id === props.data.cloud_task_id) {
      canvasStore.updateNode(props.data.nodeId, {
        data: { ...props.data, status: 'idle', cloud_task_id: '', result_path: '', video_url: '', cover_url: '', error: '' },
      })
    }
  })
})

onUnmounted(() => {
  offUpdated?.()
  offDeleted?.()
})
</script>

<style scoped>
.video-node-select {
  width: 100%;
  padding: 4px 8px;
  font-size: 11px;
  border: 1px solid var(--surface-3, #e5e7eb);
  border-radius: 8px;
  background: var(--surface-0, #fff);
  color: var(--text-primary, #111);
}
.video-node-select:disabled {
  opacity: 0.5;
}
</style>
