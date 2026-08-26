<template>
  <div class="canvas-node" :style="{ borderColor: 'var(--color-primary-500, #23574f)' }">
    <div class="node-header" style="background: var(--color-primary-50, #f2f6f5); color: var(--color-primary-700, #1a3f3a);">
      <span class="node-type-dot" style="background: var(--color-primary-500, #23574f);"></span>
      视频输入
      <span class="text-[10px] font-normal opacity-60 ml-1">#{{ data.nodeIndex }}</span>
      <button @click="deleteNode" :disabled="data.locked" class="node-delete-btn">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div class="node-body">
      <div v-if="videoSrc" class="mb-2">
        <video :src="videoSrc" controls preload="metadata" class="w-full rounded-lg border border-surface-3 bg-black"></video>
        <button @click="clearVideo" :disabled="data.locked" class="w-full mt-1.5 py-1 text-[10px] text-text-tertiary hover:text-red-500 disabled:opacity-30 transition-colors">清除视频</button>
      </div>
      <div v-else class="mb-2 space-y-1.5">
        <div
          class="p-4 border-2 border-dashed border-surface-3 rounded-lg text-center transition-colors"
          :class="data.locked ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:border-sky-400'"
          @click="!data.locked && pickVideo()"
          @dragover.prevent
          @drop.prevent="!data.locked && onDrop($event)"
        >
          <svg class="w-6 h-6 mx-auto mb-1.5 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="4" width="18" height="16" rx="2" stroke-width="1.5"/><path d="m10 9 5 3-5 3V9Z" stroke-width="1.5" stroke-linejoin="round"/></svg>
          <p class="text-[10px] text-text-tertiary">点击或拖入视频</p>
        </div>
        <button
          type="button"
          :disabled="data.locked"
          class="w-full py-1.5 text-[10px] text-primary-600 border border-primary-200 rounded-lg hover:bg-primary-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          @click="!data.locked && (showPicker = true)"
        >从视频创作选择</button>
      </div>
      <p v-if="errorMsg" class="text-[10px] text-red-500 break-words">{{ errorMsg }}</p>
    </div>
    <Handle
      type="source"
      :position="Position.Right"
      id="output"
      class="handle-video"
      @click="(e: MouseEvent) => onHandleClick?.(e, data.nodeId, 'output', 'video')"
    />

    <VideoCreationPickerDialog v-model:visible="showPicker" @select="onPickFromCreations" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvas'
import VideoCreationPickerDialog from '../components/VideoCreationPickerDialog.vue'

type HandleClickHandler = (e: MouseEvent, nodeId: string, handleId: string, dataType: 'text' | 'image' | 'video') => void

const props = defineProps<{ data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const api = () => (window as any).api
const onHandleClick = inject<HandleClickHandler | null>('onHandleClick', null)
const errorMsg = ref('')
const showPicker = ref(false)

const videoSrc = computed(() => {
  const path = props.data.video_path
  if (!path) return ''
  if (/^(https?:|blob:|data:|file:)/i.test(path)) return path
  const isAbsolute = /^[A-Za-z]:|^\//.test(path)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://video?' + param + '=' + encodeURIComponent(path)
})

async function persistVideo(sourcePath: string) {
  if (!props.data.nodeId || !props.data.projectId) return
  errorMsg.value = ''
  try {
    const saved = await api().canvas.invoke('saveNodeVideo', props.data.projectId, props.data.nodeId, sourcePath)
    canvasStore.updateNode(props.data.nodeId, { data: { ...props.data, video_path: saved.video_path } })
  } catch (e: any) {
    errorMsg.value = e?.message || '保存视频失败'
  }
}

async function pickVideo() {
  const result = await api().dialog.openFile({
    title: '选择视频',
    filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths?.length) return
  await persistVideo(result.filePaths[0])
}

/** 从「视频创作」选择已保存到本地的视频：取绝对路径后复用 persistVideo 复制进节点。 */
async function onPickFromCreations(item: { id: string }) {
  errorMsg.value = ''
  try {
    const abs = (await api().videoGen.invoke('resolveLocalPath', item.id)) as string
    if (!abs) {
      errorMsg.value = '该视频未保存到本地，请先在「视频创作」中保存'
      return
    }
    await persistVideo(abs)
  } catch (e: any) {
    errorMsg.value = e?.message || '选择视频失败'
  }
}

function onDrop(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0] as (File & { path?: string }) | undefined
  if (!file) return
  if (!file.type.startsWith('video/')) {
    errorMsg.value = '请拖入视频文件'
    return
  }
  // Electron 渲染进程的拖入 File 带本地 path，直接 copy，避免大视频走 base64
  if (file.path) {
    void persistVideo(file.path)
  } else {
    errorMsg.value = '无法读取视频路径，请用「点击选择」'
  }
}

async function clearVideo() {
  if (!props.data.nodeId) return
  if (props.data.projectId && props.data.video_path) {
    try { await api().canvas.invoke('deleteNodeImage', props.data.projectId, props.data.nodeId) } catch {}
  }
  canvasStore.updateNode(props.data.nodeId, { data: { ...props.data, video_path: '' } })
}

function deleteNode() {
  if (!props.data.nodeId) return
  canvasStore.removeNode(props.data.nodeId)
}
</script>
