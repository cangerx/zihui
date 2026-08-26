<template>
  <router-link
    to="/user-center"
    class="block rounded-lg border border-surface-3 bg-surface-1 px-3 py-2 hover:bg-surface-2 transition-colors"
  >
    <div v-if="hasLowBalance" class="flex items-center justify-end text-[10px] text-text-tertiary mb-1">
      <span v-if="hasLowBalance" class="text-amber-600 dark:text-amber-400">偏低</span>
    </div>
    <div class="space-y-1">
      <div v-for="item in balanceItems" :key="item.type" class="flex items-center justify-between text-[11px]">
        <span class="text-text-secondary">{{ item.label }}</span>
        <span :class="['font-mono', item.total <= lowThreshold ? 'text-amber-600 dark:text-amber-400' : 'text-text-primary']">
          {{ formatAmount(item.total) }}
        </span>
      </div>
    </div>
  </router-link>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useSiteConfigStore } from '@/stores/site-config'

const store = useCloudAuthStore()
const siteConfig = useSiteConfigStore()
const lowThreshold = 10

const balanceItems = computed(() => {
  const solo = siteConfig.soloRechargeType
  const quotas = store.quotas?.balances || {}
  const raw = Object.keys(quotas).length
    ? Object.entries(quotas).map(([type, value]) => ({
        type,
        label: siteConfig.labelOf(type),
        total: Number(value?.total || 0),
      }))
    : (store.balances || []).map(b => ({
        type: b.type,
        label: siteConfig.labelOf(b.type),
        total: Number(b.amount || 0),
      }))
  return solo ? raw.filter((item) => item.type === solo) : raw
})

const hasLowBalance = computed(() => balanceItems.value.some(item => item.total <= lowThreshold))

function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (value >= 1000) return Math.round(value).toLocaleString()
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2)
}
</script>
