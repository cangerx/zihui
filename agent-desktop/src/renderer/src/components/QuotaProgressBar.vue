<template>
  <div class="space-y-1.5">
    <div class="flex items-center justify-between text-[11px]">
      <span class="text-text-secondary font-medium">{{ label }}</span>
      <span class="text-text-tertiary">{{ usageText }}</span>
    </div>
    <div class="h-1.5 rounded-full bg-surface-2 overflow-hidden">
      <div
        :class="['h-full transition-all duration-300', barClass]"
        :style="{ width: `${percent}%` }"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  label: string
  used: number
  total: number
  remaining?: number | null
}>(), {
  remaining: null,
})

const percent = computed(() => {
  if (!props.total || props.total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((props.used / props.total) * 100)))
})

const usageText = computed(() => {
  if (!props.total || props.total <= 0) return '不限量'
  const remain = props.remaining ?? Math.max(0, props.total - props.used)
  return `${formatAmount(remain)} / ${formatAmount(props.total)} 剩余`
})

const barClass = computed(() => {
  if (percent.value >= 90) return 'bg-red-500'
  if (percent.value >= 70) return 'bg-amber-500'
  return 'bg-primary-600'
})

function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2)
}
</script>
