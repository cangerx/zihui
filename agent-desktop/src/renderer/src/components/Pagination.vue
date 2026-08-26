<template>
  <div v-if="totalPages > 1" class="flex items-center justify-center gap-1 text-xs">
    <button
      :disabled="modelValue <= 1"
      class="px-2.5 py-1.5 rounded-md border border-surface-3 text-text-secondary hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      @click="$emit('update:modelValue', modelValue - 1)"
    >
      上一页
    </button>
    <template v-for="p in pages" :key="p">
      <span v-if="p === '...'" class="px-1.5 py-1.5 text-text-tertiary">...</span>
      <button
        v-else
        :class="['px-2.5 py-1.5 rounded-md border transition-colors', p === modelValue ? 'bg-primary-600 text-white border-primary-600' : 'border-surface-3 text-text-secondary hover:bg-surface-2']"
        @click="$emit('update:modelValue', p as number)"
      >
        {{ p }}
      </button>
    </template>
    <button
      :disabled="modelValue >= totalPages"
      class="px-2.5 py-1.5 rounded-md border border-surface-3 text-text-secondary hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      @click="$emit('update:modelValue', modelValue + 1)"
    >
      下一页
    </button>
    <span class="ml-2 text-text-tertiary">共 {{ total }} 条</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue: number
  total: number
  pageSize: number
}>()

defineEmits<{
  'update:modelValue': [page: number]
}>()

const totalPages = computed(() => Math.ceil(props.total / props.pageSize))

const pages = computed(() => {
  const tp = totalPages.value
  const cur = props.modelValue
  if (tp <= 7) return Array.from({ length: tp }, (_, i) => i + 1)
  const result: (number | string)[] = [1]
  if (cur > 3) result.push('...')
  for (let i = Math.max(2, cur - 1); i <= Math.min(tp - 1, cur + 1); i++) {
    result.push(i)
  }
  if (cur < tp - 2) result.push('...')
  result.push(tp)
  return result
})
</script>
