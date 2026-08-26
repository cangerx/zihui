<template>
  <div class="h-full overflow-y-auto px-6 py-4">
    <div v-if="loading" class="text-xs text-text-tertiary py-12 text-center">加载中…</div>
    <div v-else-if="!rows.length" class="text-xs text-text-tertiary py-12 text-center">暂无用量数据</div>
    <div v-else class="space-y-4 max-w-2xl">
      <div
        v-for="row in rows"
        :key="row.provider_id"
        class="rounded-2xl border border-surface-2 bg-surface-0 p-4"
      >
        <div class="flex items-center justify-between mb-3">
          <div class="text-sm font-medium text-text-primary">{{ row.provider_name }}</div>
          <div class="text-[11px] text-text-tertiary">{{ row.call_count }} 次调用</div>
        </div>
        <div class="grid grid-cols-3 gap-2 mb-3">
          <div class="rounded-xl bg-surface-1 px-3 py-2 text-center">
            <div class="text-sm font-semibold text-text-primary">{{ formatNumber(row.total_tokens) }}</div>
            <div class="text-[10px] text-text-tertiary mt-0.5">总 Tokens</div>
          </div>
          <div class="rounded-xl bg-surface-1 px-3 py-2 text-center">
            <div class="text-sm font-semibold text-text-primary">{{ formatNumber(row.prompt_tokens) }}</div>
            <div class="text-[10px] text-text-tertiary mt-0.5">输入</div>
          </div>
          <div class="rounded-xl bg-surface-1 px-3 py-2 text-center">
            <div class="text-sm font-semibold text-text-primary">{{ formatNumber(row.completion_tokens) }}</div>
            <div class="text-[10px] text-text-tertiary mt-0.5">输出</div>
          </div>
        </div>
        <div v-if="row.models?.length" class="space-y-1">
          <div
            v-for="m in row.models"
            :key="m.model"
            class="flex items-center justify-between px-2 py-1.5 rounded-lg text-xs"
          >
            <span class="truncate text-text-secondary max-w-[220px]" :title="m.model">{{ m.model }}</span>
            <span class="text-text-tertiary tabular-nums">{{ formatNumber(m.total_tokens) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

interface UsageRow {
  provider_id: string
  provider_name: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  call_count: number
  models: { model: string; total_tokens: number; call_count: number }[]
}

const loading = ref(true)
const rows = ref<UsageRow[]>([])

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

onMounted(async () => {
  loading.value = true
  try {
    rows.value = ((await window.api.usage.invoke('getAll')) as UsageRow[]) || []
  } catch (e) {
    console.error('Failed to load usage stats:', e)
    rows.value = []
  } finally {
    loading.value = false
  }
})
</script>
