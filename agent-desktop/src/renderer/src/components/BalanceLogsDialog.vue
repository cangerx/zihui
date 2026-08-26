<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="visible"
        class="fixed inset-0 z-[9600] flex items-center justify-center p-6"
        @click.self="close"
      >
        <div class="w-full max-w-xl bg-surface-0 rounded-2xl shadow-2xl flex flex-col max-h-[80vh]">
          <div class="flex items-center justify-between px-5 py-3 border-b border-surface-2">
            <h3 class="text-sm font-semibold text-text-primary">账单明细</h3>
            <button type="button" class="text-text-tertiary hover:text-text-primary" @click="close">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="px-5 py-3 min-h-0 flex-1 overflow-hidden">
            <BalanceLogsList v-if="visible" class="h-full" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import BalanceLogsList from './BalanceLogsList.vue'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'update:visible', v: boolean): void }>()

function close() {
  emit('update:visible', false)
}
</script>

<style scoped>
.dialog-enter-active,
.dialog-leave-active { transition: opacity 0.2s ease; }
.dialog-enter-from,
.dialog-leave-to { opacity: 0; }
</style>
