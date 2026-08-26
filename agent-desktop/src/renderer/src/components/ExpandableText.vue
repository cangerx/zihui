<template>
  <div>
    <p
      ref="textEl"
      class="text-xs text-text-secondary whitespace-pre-line break-words"
      :style="expanded ? undefined : clampStyle"
    >{{ text }}</p>
    <button
      v-if="overflow"
      type="button"
      class="mt-0.5 text-[10px] text-primary-600 hover:text-primary-700 transition-colors"
      @click.stop="expanded = !expanded"
    >{{ expanded ? '收起' : '展开' }}</button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { CSSProperties } from 'vue'

const props = withDefaults(defineProps<{ text: string; lines?: number }>(), {
  lines: 2,
})

const textEl = ref<HTMLElement | null>(null)
const expanded = ref(false)
const overflow = ref(false)

const clampStyle = computed<CSSProperties>(() => ({
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: props.lines,
  overflow: 'hidden',
}))

// 仅在折叠态测量是否被截断：截断时 scrollHeight 大于受限的 clientHeight
async function measure() {
  await nextTick()
  const el = textEl.value
  if (!el || expanded.value) return
  overflow.value = el.scrollHeight > el.clientHeight + 1
}

let ro: ResizeObserver | null = null

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && textEl.value) {
    ro = new ResizeObserver(() => measure())
    ro.observe(textEl.value)
  }
})

onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
})

watch(() => props.text, () => {
  expanded.value = false
  measure()
})
</script>
