<template>
  <button
    v-if="nextExpiring"
    type="button"
    :class="['flex items-center gap-2 px-2.5 py-1 rounded-md border text-[11px] transition-colors', bannerClass]"
    @click="router.push('/user-center')"
  >
    <span class="font-medium">套餐即将到期</span>
    <span>{{ nextExpiring.plan_name }} {{ nextExpiring.text }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useCloudAuthStore } from '@/stores/cloud-auth'

const router = useRouter()
const store = useCloudAuthStore()

const nextExpiring = computed(() => {
  const candidates = (store.plans || [])
    .filter(p => p.status === 'active' && p.expires_at)
    .sort((a, b) => new Date(a.expires_at!).getTime() - new Date(b.expires_at!).getTime())
  if (!candidates.length) return null
  const p = candidates[0]
  const diff = new Date(p.expires_at!).getTime() - Date.now()
  if (diff <= 0) return null
  const days = diff / 86400000
  if (days >= 7) return null
  return {
    plan_name: p.plan_name,
    text: formatRemaining(diff),
    severity: days < 3 ? 'danger' as const : 'warn' as const,
  }
})

const bannerClass = computed(() => {
  if (nextExpiring.value?.severity === 'danger') {
    return 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:border-red-700/40 dark:text-red-300'
  }
  return 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:border-amber-700/40 dark:text-amber-300'
})

function formatRemaining(diff: number): string {
  const days = Math.floor(diff / 86400000)
  if (days >= 1) return `还剩 ${days} 天`
  const hours = Math.floor(diff / 3600000)
  if (hours >= 1) return `还剩 ${hours} 小时`
  return `还剩 ${Math.max(1, Math.floor(diff / 60000))} 分钟`
}
</script>
