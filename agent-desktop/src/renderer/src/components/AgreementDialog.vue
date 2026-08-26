<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center"
    @click.self="emitClose"
  >
    <div class="bg-surface-0 rounded-2xl shadow-[0_0_30px_rgba(0,0,0,0.18)] w-[560px] max-h-[80vh] flex flex-col overflow-hidden">
      <div class="flex items-center justify-between px-5 py-3 border-b border-surface-3">
        <h3 class="text-sm font-semibold text-text-primary">{{ title }}</h3>
        <button
          @click="emitClose"
          class="text-text-tertiary hover:text-text-primary transition-colors"
          title="关闭"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <div
        class="agreement-content px-5 py-4 overflow-y-auto flex-1 text-sm text-text-primary leading-relaxed"
        v-html="safeHtml"
      />
      <div class="px-5 py-3 border-t border-surface-3 flex justify-end">
        <button
          @click="emitClose"
          class="px-4 py-1.5 text-xs font-medium bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
        >
          我已阅读
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import DOMPurify from 'dompurify'

const props = defineProps<{
  open: boolean
  title: string
  contentHtml: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

function emitClose() {
  emit('close')
}

const safeHtml = computed(() => {
  if (!props.contentHtml) {
    return '<p style="color: var(--text-tertiary, #999)">协议内容暂未配置，请联系管理员在系统设置中维护。</p>'
  }
  return DOMPurify.sanitize(props.contentHtml, {
    USE_PROFILES: { html: true },
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'style'],
  })
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

watch(
  () => props.open,
  (v) => {
    if (v) window.addEventListener('keydown', onKeydown)
    else window.removeEventListener('keydown', onKeydown)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.agreement-content :deep(h1),
.agreement-content :deep(h2),
.agreement-content :deep(h3) {
  font-weight: 600;
  margin: 0.8em 0 0.4em;
}
.agreement-content :deep(h1) { font-size: 1.05rem; }
.agreement-content :deep(h2) { font-size: 1rem; }
.agreement-content :deep(h3) { font-size: 0.95rem; }
.agreement-content :deep(p) { margin: 0.5em 0; }
.agreement-content :deep(ul),
.agreement-content :deep(ol) {
  padding-left: 1.5em;
  margin: 0.5em 0;
}
.agreement-content :deep(li) { margin: 0.25em 0; }
.agreement-content :deep(a) {
  color: var(--color-primary-600, #1f4d46);
  text-decoration: underline;
}
.agreement-content :deep(strong) { font-weight: 600; }
</style>
