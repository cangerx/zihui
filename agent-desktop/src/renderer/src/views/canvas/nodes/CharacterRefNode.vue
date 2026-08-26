<template>
  <div class="canvas-node canvas-node-wide" :style="{ borderColor: 'var(--color-primary-500, #23574f)' }" :data-status="data.status">
    <div class="node-header" style="background: var(--color-primary-50, #f2f6f5); color: var(--color-primary-700, #1a3f3a);">
      <span class="node-type-dot" style="background: var(--color-primary-500, #23574f);"></span>
      角色引用
      <span class="text-[10px] font-normal opacity-60 ml-1">#{{ data.nodeIndex }}</span>
      <button @click="deleteNode" :disabled="data.locked" class="node-delete-btn">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div class="node-body">
      <div class="mb-2">
        <div class="flex items-center justify-between mb-1">
          <label class="node-label mb-0">选择角色</label>
          <button @click="loadCharacters" :disabled="loading" class="text-[10px] text-primary-600 hover:text-primary-700 disabled:opacity-40">
            {{ loading ? '刷新中...' : '刷新' }}
          </button>
        </div>
        <select v-model="selectedId" @change="onSelect" :disabled="data.locked" class="char-select nodrag nopan">
          <option v-if="!characters.length" value="">（角色库为空）</option>
          <option v-for="c in characters" :key="c.id" :value="c.id">{{ c.name || '未命名角色' }}</option>
        </select>
      </div>

      <div v-if="!characters.length && !loading" class="text-[10px] text-text-tertiary mb-2">
        角色库为空：请先用「创建角色」节点生成并入库角色
      </div>

      <div v-if="data.image_path" class="mb-2">
        <img :src="getImageSrc(data.image_path)" class="w-full rounded-lg border border-surface-3 cursor-pointer" @click.stop="previewImage" />
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
  <ImageLightbox
    :src="previewSrc"
    :on-copy="copyImage"
    :on-locate="openInFolder"
    @close="previewSrc = null"
  />
</template>

<script setup lang="ts">
import { ref, inject, onMounted } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvas'
import ImageLightbox from '@/components/ImageLightbox.vue'

interface CanvasCharacter { id: string; project_id: string; name: string; description: string; ref_image_path: string; created_at: string }
type HandleClickHandler = (e: MouseEvent, nodeId: string, handleId: string, dataType: 'text' | 'image' | 'video') => void

const props = defineProps<{ data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const api = () => (window as any).api
const onHandleClick = inject<HandleClickHandler | null>('onHandleClick', null)

const characters = ref<CanvasCharacter[]>([])
const selectedId = ref(String(props.data.character_id || ''))
const previewSrc = ref<string | null>(null)
const loading = ref(false)

async function loadCharacters() {
  if (!props.data.projectId) return
  loading.value = true
  try {
    characters.value = (await api().canvas.invoke('listCharacters', props.data.projectId)) || []
  } catch {
    characters.value = []
  } finally {
    loading.value = false
  }
}

function onSelect() {
  if (!props.data.nodeId) return
  const char = characters.value.find((c) => c.id === selectedId.value)
  canvasStore.updateNode(props.data.nodeId, {
    data: {
      ...props.data,
      character_id: char?.id || '',
      character_name: char?.name || '',
      image_path: char?.ref_image_path || ''
    }
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
  if (props.data.image_path) previewSrc.value = getImageSrc(props.data.image_path)
}

function copyImage() {
  if (props.data.image_path) api().clipboard.writeImage(props.data.image_path)
}

function openInFolder() {
  if (props.data.image_path) api().shell.showItemInFolder(props.data.image_path)
}

function deleteNode() {
  if (!props.data.nodeId) return
  canvasStore.removeNode(props.data.nodeId)
}

onMounted(loadCharacters)
</script>

<style scoped>
.char-select {
  width: 100%;
  padding: 4px 8px;
  font-size: 11px;
  border: 1px solid var(--surface-3, #e5e7eb);
  border-radius: 8px;
  background: var(--surface-0, #fff);
  color: var(--text-primary, #111);
}
.char-select:disabled {
  opacity: 0.5;
}
</style>
