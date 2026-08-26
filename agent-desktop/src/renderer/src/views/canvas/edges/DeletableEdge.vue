<template>
  <BaseEdge :path="path" :style="edgeStyle" :interaction-width="20" />
  <EdgeLabelRenderer>
    <div
      :style="{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all' }"
      class="edge-delete-btn nodrag nopan"
      :class="{ visible: selected }"
      @click.stop="onDelete"
    >
      <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
  </EdgeLabelRenderer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useVueFlow } from '@vue-flow/core'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: any
  targetPosition: any
  selected?: boolean
  style?: Record<string, any>
}>()

const { removeEdges } = useVueFlow()

const pathData = computed(() =>
  getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition
  })
)

const path = computed(() => pathData.value[0])
const labelX = computed(() => pathData.value[1])
const labelY = computed(() => pathData.value[2])

const edgeStyle = computed(() => {
  if (props.selected) {
    return { stroke: 'var(--color-primary-600, #1f4d46)', strokeWidth: 3, transition: 'stroke 0.15s, stroke-width 0.15s' }
  }
  // No inline stroke/strokeWidth — let CSS .vue-flow__edge:hover handle hover styling
  return { transition: 'stroke 0.15s, stroke-width 0.15s' }
})

function onDelete() {
  removeEdges([props.id])
}
</script>

<style>
.edge-delete-btn {
  position: absolute;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border: 1.5px solid #d1d5db;
  border-radius: 50%;
  color: #9ca3af;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, border-color 0.15s, color 0.15s;
}
.edge-delete-btn.visible {
  opacity: 1;
}
.edge-delete-btn:hover {
  border-color: #ef4444;
  color: #ef4444;
  background: #fef2f2;
}
</style>
