<template>
  <div class="canvas-node" :style="{ borderColor: 'var(--color-primary-500, #23574f)' }">
    <div class="node-header" style="background: var(--color-primary-50, #f2f6f5); color: var(--color-primary-700, #1a3f3a);">
      <span class="node-type-dot" style="background: var(--color-primary-500, #23574f);"></span>
      参考图
      <span class="text-[10px] font-normal opacity-60 ml-1">#{{ data.nodeIndex }}</span>
      <button @click="deleteNode" :disabled="data.locked" class="node-delete-btn">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div class="node-body">
      <div v-if="imagePreview" class="mb-2">
        <img :src="imagePreview" class="w-full rounded-lg border border-surface-3" />
      </div>
      <div v-else class="mb-2 space-y-1.5">
        <div class="p-4 border-2 border-dashed border-surface-3 rounded-lg text-center transition-colors" :class="data.locked ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:border-emerald-400'" @click="!data.locked && pickImage()" @dragover.prevent @drop.prevent="!data.locked && onDrop($event)">
          <svg class="w-6 h-6 mx-auto mb-1.5 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
          <p class="text-[10px] text-text-tertiary">点击或拖入图片</p>
        </div>
        <button v-if="!data.locked" @click="showGalleryPicker = true" class="w-full py-1.5 text-[10px] text-text-tertiary hover:text-primary-600 border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors">从图库选择</button>
      </div>
      <div v-if="imagePreview" class="flex items-center justify-center gap-3">
        <button
          class="nodrag nopan py-1 text-[10px] text-text-tertiary hover:text-primary-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          :disabled="data.locked"
          @click="openEdit"
        >编辑</button>
        <button
          class="nodrag nopan py-1 text-[10px] text-text-tertiary hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          :disabled="data.locked"
          @click="clearImage"
        >清除图片</button>
      </div>
    </div>
    <Handle
      type="source"
      :position="Position.Right"
      id="output"
      class="handle-image"
      @click="(e: MouseEvent) => onHandleClick?.(e, data.nodeId, 'output', 'image')"
    />
  </div>
  <GalleryPicker v-model:visible="showGalleryPicker" @select="onGallerySelect" />
</template>

<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvas'
import GalleryPicker from '@/components/GalleryPicker.vue'

type HandleClickHandler = (e: MouseEvent, nodeId: string, handleId: string, dataType: 'text' | 'image') => void

const props = defineProps<{ data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const api = () => (window as any).api
const onHandleClick = inject<HandleClickHandler | null>('onHandleClick', null)
const openCanvasImageEditor = inject<((payload: {
  nodeId: string
  sourcePath?: string
  sourceDataUri?: string
  apply: (dataUrl: string) => Promise<void>
}) => void) | null>('openCanvasImageEditor', null)

const imagePreview = computed(() => {
  if (props.data.image_data) return props.data.image_data
  if (props.data.image_path) {
    const path = props.data.image_path
    const isAbsolute = /^[A-Za-z]:|^\//.test(path)
    const param = isAbsolute ? 'p' : 'rel'
    return 'local-file://img?' + param + '=' + encodeURIComponent(path)
  }
  return ''
})

async function persistImage(dataUri: string) {
  if (!props.data.nodeId || !props.data.projectId) return
  try {
    // Persist base64 to disk, store only the relative path in node.data.image_path.
    // This avoids writing large base64 blobs into SQLite on every edit/save.
    const saved = await api().canvas.invoke('saveNodeImage', props.data.projectId, props.data.nodeId, dataUri)
    canvasStore.updateNode(props.data.nodeId, {
      data: { ...props.data, image_data: '', image_path: saved.image_path }
    })
  } catch {
    // Fallback to in-DB base64 if disk save fails, so the user doesn't lose the image
    canvasStore.updateNode(props.data.nodeId, {
      data: { ...props.data, image_data: dataUri, image_path: '' }
    })
  }
}

const showGalleryPicker = ref(false)

async function onGallerySelect(paths: string[]) {
  if (!paths.length) return
  const filePath = paths[0]
  const b64 = await api().chat.invoke('readFileBase64', filePath)
  const ext = (filePath.split('.').pop() || 'png').toLowerCase()
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'webp' ? 'image/webp'
    : ext === 'gif' ? 'image/gif'
    : 'image/png'
  const dataUri = `data:${mime};base64,${b64}`
  await persistImage(dataUri)
}

async function pickImage() {
  const result = await api().dialog.openFile({
    title: '选择参考图片',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths?.length) return
  const filePath = result.filePaths[0]
  const b64 = await api().chat.invoke('readFileBase64', filePath)
  const ext = (filePath.split('.').pop() || 'png').toLowerCase()
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'webp' ? 'image/webp'
    : ext === 'gif' ? 'image/gif'
    : 'image/png'
  const dataUri = `data:${mime};base64,${b64}`
  await persistImage(dataUri)
}

function onDrop(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0]
  if (!file || !file.type.startsWith('image/')) return
  const reader = new FileReader()
  reader.onload = async () => {
    const dataUri = reader.result as string
    await persistImage(dataUri)
  }
  reader.readAsDataURL(file)
}

async function clearImage() {
  if (!props.data.nodeId) return
  // Remove the disk file first (best-effort), then clear the node fields.
  // Ignore IPC errors — we still want the UI state reset even if cleanup fails.
  if (props.data.projectId && props.data.image_path) {
    try {
      await api().canvas.invoke('deleteNodeImage', props.data.projectId, props.data.nodeId)
    } catch {}
  }
  canvasStore.updateNode(props.data.nodeId, {
    data: { ...props.data, image_data: '', image_path: '' }
  })
}

function openEdit() {
  if (props.data.locked || !props.data.nodeId || !openCanvasImageEditor) return
  if (!props.data.image_path && !props.data.image_data) return
  openCanvasImageEditor({
    nodeId: props.data.nodeId,
    sourcePath: props.data.image_path || '',
    sourceDataUri: props.data.image_data || '',
    apply: persistImage
  })
}

function deleteNode() {
  if (!props.data.nodeId) return
  canvasStore.removeNode(props.data.nodeId)
}
</script>
