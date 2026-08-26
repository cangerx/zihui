<template>
  <div class="card p-5">
    <template v-if="heroItem">
      <div class="flex items-start justify-between gap-3 mb-4">
        <div class="min-w-0">
          <div class="text-xs text-text-secondary">可用{{ heroItem.label }}</div>
          <div class="mt-1 text-3xl font-bold text-text-primary font-mono tracking-tight">
            {{ formatAmount(heroItem.total) }}
            <span class="text-base font-semibold text-text-secondary">{{ heroItem.label }}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            class="text-xs text-text-tertiary hover:text-text-primary"
            :disabled="refreshing"
            @click="refresh"
          >{{ refreshing ? '刷新中' : '刷新' }}</button>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-xl bg-surface-1 border border-surface-3 px-3 py-3">
          <div class="text-[11px] text-text-tertiary">钱包余额</div>
          <div class="mt-1 text-lg font-semibold text-text-primary font-mono">{{ formatAmount(heroItem.wallet) }}</div>
          <div class="mt-0.5 text-[10px] text-text-tertiary">永久有效</div>
        </div>
        <div class="rounded-xl bg-surface-1 border border-surface-3 px-3 py-3">
          <div class="text-[11px] text-text-tertiary">套餐余量</div>
          <div class="mt-1 text-lg font-semibold text-text-primary font-mono">{{ formatAmount(heroItem.plan) }}</div>
          <div class="mt-0.5 text-[10px] text-text-tertiary">{{ heroItem.plan > 0 ? '随套餐到期' : '暂无套餐' }}</div>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold text-text-primary">账户额度</h3>
        <button
          type="button"
          class="text-xs text-text-tertiary hover:text-text-primary"
          @click="$emit('openLogs')"
        >查看明细</button>
      </div>

      <div v-if="items.length" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div v-for="item in items" :key="item.type" class="rounded-xl bg-surface-1 border border-surface-3 p-4">
          <div class="flex items-center justify-between mb-3">
            <span class="text-xs font-medium text-text-primary">{{ item.label }}</span>
          </div>
          <div class="text-2xl font-bold text-text-primary font-mono">{{ formatAmount(item.total) }}</div>
          <div class="grid grid-cols-2 gap-2 mt-3 text-[11px]">
            <div class="rounded-lg bg-surface-0 px-2 py-1.5">
              <div class="text-text-tertiary">钱包</div>
              <div class="text-text-secondary font-mono">{{ formatAmount(item.wallet) }}</div>
            </div>
            <div class="rounded-lg bg-surface-0 px-2 py-1.5">
              <div class="text-text-tertiary">套餐</div>
              <div class="text-text-secondary font-mono">{{ formatAmount(item.plan) }}</div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="text-xs text-text-tertiary py-4 text-center">暂无额度数据</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useSiteConfigStore } from '@/stores/site-config'

const props = defineProps<{
  focusType?: 'token' | 'credit' | null
  hero?: boolean
}>()

const emit = defineEmits<{
  (e: 'openLogs'): void
}>()
void emit

const store = useCloudAuthStore()
const siteConfig = useSiteConfigStore()
const refreshing = ref(false)

const allItems = computed(() => {
  const quotaBalances = store.quotas?.balances || {}
  if (Object.keys(quotaBalances).length) {
    return Object.entries(quotaBalances).map(([type, value]) => ({
      type,
      label: siteConfig.labelOf(type),
      wallet: Number(value.wallet || 0),
      plan: Number(value.plan || 0),
      total: Number(value.total || 0),
    }))
  }
  return (store.balances || []).map(b => ({
    type: b.type,
    label: siteConfig.labelOf(b.type),
    wallet: Number(b.amount || 0),
    plan: 0,
    total: Number(b.amount || 0),
  }))
})

const items = computed(() => {
  const focus = props.focusType || siteConfig.soloRechargeType
  if (!focus) return allItems.value
  return allItems.value.filter((item) => item.type === focus)
})

const heroItem = computed(() => {
  if (!props.hero) return null
  const focus = props.focusType || siteConfig.soloRechargeType
  if (!focus) return null
  return items.value.find((item) => item.type === focus) || {
    type: focus,
    label: siteConfig.labelOf(focus),
    wallet: 0,
    plan: 0,
    total: 0,
  }
})

async function refresh() {
  refreshing.value = true
  try {
    await store.fetchCloudData()
  } catch { /* 忽略 */ }
  refreshing.value = false
}

function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString()
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2)
}
</script>
