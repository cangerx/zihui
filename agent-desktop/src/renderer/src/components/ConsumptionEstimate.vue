<template>
  <div class="rounded-xl border border-surface-3 bg-surface-1 px-3 py-2.5 text-xs">
    <div class="flex items-center justify-between gap-3">
      <span class="text-text-secondary">预计消耗</span>
      <span :class="['font-mono font-medium', sufficient ? 'text-text-primary' : 'text-red-500']">
        {{ formatAmount(amount) }} {{ label }}
      </span>
    </div>
    <div class="flex items-center justify-between gap-3 mt-1">
      <span class="text-text-tertiary">当前可用</span>
      <span :class="['font-mono', sufficient ? 'text-text-secondary' : 'text-red-500']">
        {{ formatAmount(available) }}
      </span>
    </div>
    <p v-if="!sufficient" class="mt-2 text-[11px] text-red-500">余额不足，请先购买套餐或充值</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useSiteConfigStore } from '@/stores/site-config'

const props = withDefaults(defineProps<{
  balanceType?: string
  amount?: number
}>(), {
  balanceType: 'credit',
  amount: 0,
})

const store = useCloudAuthStore()
const siteConfig = useSiteConfigStore()

const label = computed(() => siteConfig.labelOf(props.balanceType))
const available = computed(() => Number(store.quotas?.balances?.[props.balanceType]?.total ?? store.balances.find(b => b.type === props.balanceType)?.amount ?? 0))
const amount = computed(() => Number(props.amount || 0))
const sufficient = computed(() => amount.value <= 0 || available.value + 0.000001 >= amount.value)

function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Number.isInteger(value)) return String(value)
  if (Math.abs(value) > 0 && Math.abs(value) < 1) return value.toFixed(4)
  return value.toFixed(2)
}
</script>
