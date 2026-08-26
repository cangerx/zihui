<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="visible"
        class="fixed inset-0 z-[9600] flex items-center justify-center p-6 pointer-events-none"
      >
        <div
          class="w-full max-w-sm bg-surface-0 rounded-2xl shadow-2xl flex flex-col pointer-events-auto"
          @click.stop
        >
          <!-- Header -->
          <div class="flex items-center gap-2 px-5 py-3 border-b border-surface-2">
            <svg
              class="w-4 h-4 text-primary-600 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
            <h3 class="text-sm font-semibold text-text-primary truncate">{{ title || '确认' }}</h3>
          </div>

          <!-- Body -->
          <div class="px-5 py-4 text-xs leading-relaxed text-text-primary whitespace-pre-wrap">{{ message }}</div>

          <!-- Footer -->
          <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-surface-2">
            <button
              type="button"
              @click="emit('cancel')"
              class="px-3 py-1.5 text-xs text-text-secondary rounded-lg border border-surface-3 hover:bg-surface-2 transition-colors"
            >{{ cancelText || '取消' }}</button>
            <button
              type="button"
              ref="confirmBtn"
              @click="emit('confirm')"
              class="px-3 py-1.5 text-xs font-medium text-white rounded-lg bg-primary-600 hover:bg-primary-700 transition-colors"
            >{{ confirmText || '确认' }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

// 打开时自动聚焦确认按钮，便于回车直接确认；按 Esc 取消
const confirmBtn = ref<HTMLButtonElement | null>(null)

function onKeydown(e: KeyboardEvent) {
  if (!props.visible) return
  if (e.key === 'Escape') emit('cancel')
  else if (e.key === 'Enter') emit('confirm')
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      window.addEventListener('keydown', onKeydown)
      nextTick(() => confirmBtn.value?.focus())
    } else {
      window.removeEventListener('keydown', onKeydown)
    }
  }
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 150ms ease, transform 150ms ease;
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
  transform: scale(0.98);
}
</style>
