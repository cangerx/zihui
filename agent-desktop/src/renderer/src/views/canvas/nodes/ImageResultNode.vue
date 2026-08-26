<template>
  <div class="canvas-node" :style="{ borderColor: 'var(--color-primary-500, #23574f)' }">
    <div class="node-header" style="background: var(--color-primary-50, #f2f6f5); color: var(--color-primary-700, #1a3f3a);">
      <span class="node-type-dot" style="background: var(--color-primary-500, #23574f);"></span>
      图片结果
      <span class="text-[10px] font-normal opacity-60 ml-1">#{{ data.nodeIndex }}</span>
      <button @click="deleteNode" :disabled="data.locked" class="node-delete-btn">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div class="node-body">
      <div v-if="imageSrc" class="mb-2">
        <img :src="imageSrc" class="w-full rounded-lg border border-surface-3 cursor-pointer" @click.stop="previewSrc = imageSrc" />
        <div class="flex gap-1 mt-1.5">
          <button @click="copyImage" class="flex-1 py-1 text-[10px] font-medium border border-surface-3 rounded-lg text-text-secondary hover:bg-surface-2 transition-colors">复制</button>
          <button @click="openInFolder" class="flex-1 py-1 text-[10px] font-medium border border-surface-3 rounded-lg text-text-secondary hover:bg-surface-2 transition-colors">定位</button>
        </div>
      </div>
      <div v-else class="p-4 text-center">
        <svg class="w-8 h-8 mx-auto mb-1.5 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" stroke-width="1.5"/><circle cx="8.5" cy="8.5" r="1.5" stroke-width="1.5"/><path d="m21 15-5-5L5 21" stroke-width="1.5"/></svg>
        <p class="text-[10px] text-text-tertiary">等待上游图片输入</p>
      </div>
    </div>
    <Handle type="target" :position="Position.Left" id="input" class="handle-image" />
  </div>
  <ImageLightbox
    :src="previewSrc"
    :on-copy="copyImage"
    :on-locate="openInFolder"
    @close="previewSrc = null"
  />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvas'
import ImageLightbox from '@/components/ImageLightbox.vue'

const props = defineProps<{ data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const api = () => (window as any).api
const previewSrc = ref<string | null>(null)

const imageSrc = computed(() => {
  if (props.data.result_path) {
    const path = props.data.result_path
    if (path.startsWith('data:') || path.startsWith('http')) return path
    const isAbsolute = /^[A-Za-z]:|^\//.test(path)
    const param = isAbsolute ? 'p' : 'rel'
    return 'local-file://img?' + param + '=' + encodeURIComponent(path)
  }
  if (props.data.result_url) return props.data.result_url
  return ''
})

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

function deleteNode() {
  if (!props.data.nodeId) return
  canvasStore.removeNode(props.data.nodeId)
}
</script>
