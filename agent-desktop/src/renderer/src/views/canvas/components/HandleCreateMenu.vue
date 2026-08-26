<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="fixed z-[9998] w-[240px] bg-surface-0 border border-surface-3 rounded-xl shadow-xl overflow-hidden"
      :style="menuStyle"
      @click.stop
      @pointerdown.stop
      @wheel.stop
    >
      <div class="px-3 py-2 border-b border-surface-3 flex items-center justify-between">
        <span class="text-[11px] font-semibold text-text-secondary">
          {{ sourceDataType === 'text' ? '文本输出' : sourceDataType === 'video' ? '视频输出' : '图像输出' }}
        </span>
        <button
          @click="$emit('close')"
          class="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors"
          title="关闭"
        >
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="max-h-[360px] overflow-y-auto">
        <!-- Create new node -->
        <div v-if="candidates.length > 0">
          <div class="px-3 pt-2 pb-1 text-[9px] font-semibold text-text-tertiary uppercase tracking-wide">
            创建新节点
          </div>
          <button
            v-for="c in candidates"
            :key="c.type"
            @click="$emit('create', c.type)"
            class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-2 transition-colors"
          >
            <span class="w-2 h-2 rounded-full flex-shrink-0" :style="{ background: c.color }"></span>
            <div class="flex-1 min-w-0">
              <div class="text-xs font-medium text-text-primary">{{ c.label }}</div>
              <div class="text-[10px] text-text-tertiary truncate">
                接入 <span class="font-mono">{{ c.targetHandle }}</span>
              </div>
            </div>
          </button>
        </div>

        <!-- Connect to / disconnect existing node -->
        <div v-if="existing.length > 0" class="border-t border-surface-3">
          <div class="px-3 pt-2 pb-1 text-[9px] font-semibold text-text-tertiary uppercase tracking-wide">
            连接到已有节点
          </div>
          <button
            v-for="e in existing"
            :key="e.nodeId"
            @click="onItemClick(e)"
            @mouseenter="$emit('hover', e.nodeId)"
            @mouseleave="$emit('hover', null)"
            class="group w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-2 transition-colors"
            :class="e.connected ? 'bg-surface-1' : ''"
          >
            <span
              class="w-2 h-2 rounded-full flex-shrink-0"
              :class="e.connected ? 'ring-2 ring-offset-1 ring-offset-surface-0' : ''"
              :style="{ background: e.color, ...(e.connected ? { boxShadow: `0 0 0 2px ${e.color}33` } : {}) }"
            ></span>
            <div class="flex-1 min-w-0">
              <div class="text-xs font-medium text-text-primary truncate">
                {{ e.label }}
                <span class="text-text-tertiary font-normal ml-0.5">#{{ e.index }}</span>
              </div>
              <div class="text-[10px] text-text-tertiary truncate">
                {{ e.preview || '—' }}
              </div>
            </div>
            <span
              v-if="e.connected"
              class="flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded border whitespace-nowrap transition-colors border-surface-3 text-text-tertiary group-hover:border-red-300 group-hover:text-red-500 group-hover:bg-red-50 dark:group-hover:border-red-800 dark:group-hover:text-red-300 dark:group-hover:bg-red-900/30"
            >
              <span class="group-hover:hidden">已连接</span>
              <span class="hidden group-hover:inline">点击断开</span>
            </span>
          </button>
        </div>

        <div v-if="candidates.length === 0 && existing.length === 0" class="px-3 py-4 text-center text-[10px] text-text-disabled">
          没有可连接的节点类型
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'

interface Candidate {
  type: string
  label: string
  color: string
  targetHandle: string
}

interface ExistingNode {
  nodeId: string
  label: string
  index: number
  color: string
  preview: string
  connected: boolean
  edgeId: string
}

const props = defineProps<{
  visible: boolean
  position: { x: number; y: number }
  sourceDataType: 'text' | 'image' | 'video'
  candidates: Candidate[]
  existing: ExistingNode[]
}>()

const emit = defineEmits<{
  (e: 'create', nodeType: string): void
  (e: 'connect', nodeId: string): void
  (e: 'disconnect', edgeId: string): void
  (e: 'hover', nodeId: string | null): void
  (e: 'close'): void
}>()

// Toggle behavior: clicking a connected target removes the edge,
// clicking an unconnected target adds it. Menu stays open either way.
function onItemClick(item: ExistingNode) {
  if (item.connected) emit('disconnect', item.edgeId)
  else emit('connect', item.nodeId)
}

const menuRef = ref<HTMLElement | null>(null)
const adjustedPos = ref({ x: 0, y: 0 })

const menuStyle = computed(() => ({
  left: `${adjustedPos.value.x}px`,
  top: `${adjustedPos.value.y}px`
}))

// Clamp menu to viewport so the list never gets clipped off-screen.
async function recomputePosition() {
  await nextTick()
  const el = menuRef.value
  if (!el) {
    adjustedPos.value = { ...props.position }
    return
  }
  const rect = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const margin = 8
  let x = props.position.x + 12
  let y = props.position.y - 12
  if (x + rect.width + margin > vw) x = props.position.x - rect.width - 12
  if (y + rect.height + margin > vh) y = vh - rect.height - margin
  if (x < margin) x = margin
  if (y < margin) y = margin
  adjustedPos.value = { x, y }
}

watch(() => [props.visible, props.position.x, props.position.y], () => {
  if (props.visible) recomputePosition()
})

// Always clear spotlight when the menu closes — the parent might forget to.
watch(() => props.visible, (v) => {
  if (!v) emit('hover', null)
})

function onDocumentPointerDown(e: PointerEvent) {
  if (!props.visible) return
  const el = menuRef.value
  if (!el) return
  if (!el.contains(e.target as Node)) emit('close')
}

function onEsc(e: KeyboardEvent) {
  if (props.visible && e.key === 'Escape') emit('close')
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  document.addEventListener('keydown', onEsc)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  document.removeEventListener('keydown', onEsc)
})
</script>
