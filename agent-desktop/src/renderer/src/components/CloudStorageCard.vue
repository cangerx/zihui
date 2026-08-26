<template>
  <div v-if="show" class="card p-5">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-sm font-semibold text-text-primary">云存储</h3>
      <span v-if="quota.total > 0" class="text-[11px] text-text-tertiary">
        {{ formatBytes(quota.used) }} / {{ formatBytes(quota.total) }}
      </span>
      <span v-else class="text-[11px] text-text-tertiary">已用 {{ formatBytes(quota.used) }}（不限）</span>
    </div>
    <QuotaProgressBar
      v-if="quota.total > 0"
      label="云存储空间"
      :used="quota.used"
      :total="quota.total"
      :remaining="Math.max(0, quota.total - quota.used)"
    />
    <p class="text-[11px] text-text-tertiary mt-2">
      在「设置 → 云同步」开启自动同步、选择同步范围与冲突策略。
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import QuotaProgressBar from '@/components/QuotaProgressBar.vue'

const loaded = ref(false)
const quota = reactive({ used: 0, total: 0, base_quota: 0, extra_quota: 0, percent: 0 })

const show = computed(() => loaded.value && (quota.total > 0 || quota.used > 0))

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

onMounted(async () => {
  try {
    const q = await window.api?.sync?.getQuota?.()
    if (q && !(q as any).error) {
      Object.assign(quota, q)
    }
  } catch {
    // 忽略：未开通同步 / 网络异常时不展示
  } finally {
    loaded.value = true
  }
})
</script>
