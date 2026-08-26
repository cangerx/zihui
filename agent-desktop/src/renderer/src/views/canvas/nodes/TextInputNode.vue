<template>
  <div class="canvas-node" :style="{ borderColor: !text.trim() ? 'var(--danger-fg)' : 'var(--color-primary-500, #23574f)' }">
    <div class="node-header" style="background: var(--color-primary-50, #f2f6f5); color: var(--color-primary-700, #1a3f3a);">
      <span class="node-type-dot" style="background: var(--color-primary-500, #23574f);"></span>
      文本输入
      <span class="text-[10px] font-normal opacity-60 ml-1">#{{ data.nodeIndex }}</span>
      <button @click.stop="togglePreset" :disabled="data.locked" class="px-1.5 py-0.5 rounded text-[9px] text-primary-600 hover:bg-primary-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" style="margin-left: auto;">预设</button>
      <button @click="deleteNode" :disabled="data.locked" class="node-delete-btn" style="margin-left: 0;">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div class="node-body">
      <PromptTextarea
        v-model="text"
        @change="saveData"
        title="编辑文本提示词"
        :height="96"
        :max-length="IMAGE_PROMPT_MAX_LENGTH"
        placeholder="输入提示词文本..."
        container-class="nodrag nopan"
        input-class="text-[11px]"
        :disabled="data.locked"
      />
      <div v-if="!text.trim()" class="text-[9px] text-red-400 mt-1 px-0.5">未输入文本</div>
    </div>
    <Handle
      type="source"
      :position="Position.Right"
      id="output"
      class="handle-text"
      @click="(e: MouseEvent) => onHandleClick?.(e, data.nodeId, 'output', 'text')"
    />
  </div>

  <Teleport to="body">
    <div v-if="showPreset" class="fixed z-[9999] flex items-center justify-center" :style="presetPosition">
      <div class="w-[420px] max-h-[60vh] bg-surface-0 border border-surface-3 rounded-2xl shadow-xl flex flex-col" v-click-outside="() => showPreset = false">
        <div class="flex items-center justify-between px-5 py-3 border-b border-surface-3">
          <h3 class="text-sm font-semibold text-text-primary">预设提示词</h3>
          <button @click="showPreset = false" class="p-1 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          <template v-if="presetGroups.length">
            <div v-for="cat in presetGroups" :key="cat.id">
              <div class="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">{{ cat.name }}</div>
              <div class="grid grid-cols-2 gap-2">
                <button
                  v-for="item in cat.items"
                  :key="item.id"
                  @click="applyPreset(item.content)"
                  class="text-left p-3 rounded-xl border border-surface-3 hover:border-primary-400 hover:bg-primary-50 transition-colors"
                >
                  <div class="text-xs font-medium text-text-primary mb-1">{{ item.label }}</div>
                  <div class="text-[10px] text-text-tertiary line-clamp-2">{{ item.content }}</div>
                </button>
              </div>
            </div>
          </template>
          <div v-else class="px-3 py-8 text-xs text-text-disabled text-center">暂无预设提示词</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, inject } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvas'
import { usePromptPresetStore } from '@/stores/prompt-presets'
import PromptTextarea from '@/components/PromptTextarea.vue'
import { IMAGE_PROMPT_MAX_LENGTH } from '@shared/prompt-limits'

type HandleClickHandler = (e: MouseEvent, nodeId: string, handleId: string, dataType: 'text' | 'image') => void

const props = defineProps<{ data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const presetStore = usePromptPresetStore()
const onHandleClick = inject<HandleClickHandler | null>('onHandleClick', null)

const text = ref(props.data.text || '')
const showPreset = ref(false)
const presetPosition = ref({ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' })

const presetType = computed(() => {
  if (!props.data.nodeId) return 'image_gen'
  const edges = canvasStore.edges.filter((e: any) => e.source_node_id === props.data.nodeId)
  for (const edge of edges) {
    const target = canvasStore.nodes.find((n: any) => n.id === edge.target_node_id)
    if (target?.type === 'aiText') return 'text'
    if (target?.type === 'text2img' || target?.type === 'img2img') return 'image_gen'
  }
  return 'image_gen'
})

const presetGroups = computed(() => presetStore.visibleGrouped(presetType.value))

watch(() => props.data.text, (v) => { if (v !== text.value) text.value = v || '' })

function saveData() {
  if (!props.data.nodeId) return
  canvasStore.updateNode(props.data.nodeId, {
    data: { ...props.data, text: text.value }
  })
}

function togglePreset(e: MouseEvent) {
  showPreset.value = !showPreset.value
  if (showPreset.value) {
    const btn = e.currentTarget as HTMLElement
    const rect = btn.getBoundingClientRect()
    presetPosition.value = {
      top: `${rect.bottom + 8}px`,
      left: `${rect.left}px`,
      transform: 'none'
    }
  }
}

function applyPreset(content: string) {
  text.value = content
  showPreset.value = false
  saveData()
}

function deleteNode() {
  if (!props.data.nodeId) return
  canvasStore.removeNode(props.data.nodeId)
}

onMounted(() => { presetStore.fetchAll() })

const vClickOutside = {
  mounted(el: HTMLElement, binding: any) {
    (el as any)._clickOutside = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) binding.value()
    }
    setTimeout(() => document.addEventListener('click', (el as any)._clickOutside), 0)
  },
  unmounted(el: HTMLElement) {
    document.removeEventListener('click', (el as any)._clickOutside)
  }
}
</script>
