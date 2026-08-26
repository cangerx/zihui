<template>
  <!-- 项目规则：弹窗只加阴影，不要背景遮罩 -->
  <div class="fixed inset-0 z-[9100] flex items-center justify-center pointer-events-none">
    <div
      ref="dialogEl"
      class="pointer-events-auto w-full max-w-2xl max-h-[80vh] bg-surface-0 border border-surface-3 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-4 border-b border-surface-2">
        <h2 class="text-sm font-semibold text-text-primary">更新日志</h2>
        <button
          @click="$emit('close')"
          class="p-1 -mr-1 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors"
          aria-label="关闭"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto px-5 py-4">
        <div v-if="!CHANGELOG.length" class="text-xs text-text-tertiary text-center py-8">暂无更新记录</div>
        <div v-for="entry in CHANGELOG" :key="entry.version" class="mb-6 last:mb-0">
          <div class="flex items-baseline gap-2 mb-2.5">
            <h3 class="text-sm font-semibold text-text-primary">v{{ entry.version }}</h3>
            <span
              v-if="entry.version === currentVersion"
              class="text-[10px] px-1.5 py-0.5 rounded bg-primary-100 text-primary-700 font-medium"
            >当前</span>
            <span class="text-xs text-text-tertiary ml-auto">{{ entry.date }}</span>
          </div>
          <ul class="space-y-1.5">
            <li
              v-for="(note, idx) in entry.notes"
              :key="idx"
              class="text-xs text-text-secondary leading-relaxed flex gap-2"
            >
              <span class="text-text-disabled select-none flex-shrink-0 mt-0.5">·</span>
              <span>{{ note }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { CHANGELOG } from '@shared/changelog'

defineProps<{ currentVersion: string }>()
const emit = defineEmits<{ close: [] }>()

const dialogEl = ref<HTMLDivElement | null>(null)

// ESC 关闭
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

// 弹窗外点击关闭（项目规则不允许遮罩，所以用 document 监听代替遮罩点击）
function onDocClick(e: MouseEvent) {
  if (!dialogEl.value) return
  if (!dialogEl.value.contains(e.target as Node)) emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  // 延迟一帧绑定，避免触发"打开弹窗的那次点击"
  setTimeout(() => document.addEventListener('mousedown', onDocClick), 0)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('mousedown', onDocClick)
})
</script>
