<template>
  <div class="canvas-node" :style="{ borderColor: 'var(--color-primary-500, #23574f)' }">
    <div class="node-header" style="background: var(--color-primary-50, #f2f6f5); color: var(--color-primary-700, #1a3f3a);">
      <span class="node-type-dot" style="background: var(--color-primary-500, #23574f);"></span>
      视频结果
      <span class="text-[10px] font-normal opacity-60 ml-1">#{{ data.nodeIndex }}</span>
      <button @click="deleteNode" :disabled="data.locked" class="node-delete-btn">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div class="node-body">
      <div v-if="playableSrc" class="mb-2">
        <video :src="playableSrc" controls preload="metadata" :poster="posterSrc" class="w-full rounded-lg border border-surface-3 bg-black"></video>
        <div class="flex gap-1 mt-1.5">
          <button @click="openInFolder" :disabled="!localPath" class="flex-1 py-1 text-[10px] font-medium border border-surface-3 rounded-lg text-text-secondary hover:bg-surface-2 disabled:opacity-40 transition-colors">定位</button>
        </div>
      </div>
      <div v-else class="p-4 text-center">
        <svg class="w-8 h-8 mx-auto mb-1.5 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="4" width="18" height="16" rx="2" stroke-width="1.5"/><path d="m10 9 5 3-5 3V9Z" stroke-width="1.5" stroke-linejoin="round"/></svg>
        <p class="text-[10px] text-text-tertiary">等待上游视频输入</p>
      </div>
    </div>
    <Handle type="target" :position="Position.Left" id="input" class="handle-video" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvas'

const props = defineProps<{ data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const api = () => (window as any).api

// 实时读取上游视频节点的产物（视频完成后自动反映，无需外部同步）
const upstreamNode = computed(() => {
  const edge = canvasStore.edges.find((e) => e.target_node_id === props.data.nodeId && e.target_handle === 'input')
  if (!edge) return null
  return canvasStore.nodes.find((n) => n.id === edge.source_node_id) || null
})

const localPath = computed(() => String(upstreamNode.value?.data?.result_path || props.data.result_path || ''))
const remoteUrl = computed(() => String(upstreamNode.value?.data?.video_url || props.data.video_url || ''))
const posterSrc = computed(() => {
  const cover = upstreamNode.value?.data?.cover_url || props.data.cover_url || ''
  return cover ? String(cover) : undefined
})

const playableSrc = computed(() => (localPath.value ? videoSrc(localPath.value) : remoteUrl.value))

function videoSrc(path: string): string {
  if (!path) return ''
  if (path.startsWith('http') || path.startsWith('blob:') || path.startsWith('data:')) return path
  const isAbsolute = /^[A-Za-z]:|^\//.test(path)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://video?' + param + '=' + encodeURIComponent(path)
}

function openInFolder() {
  if (localPath.value) api().shell.showItemInFolder(localPath.value)
}

function deleteNode() {
  if (!props.data.nodeId) return
  canvasStore.removeNode(props.data.nodeId)
}
</script>
