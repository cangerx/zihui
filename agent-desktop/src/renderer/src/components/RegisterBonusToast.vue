<template>
  <Transition name="toast">
    <div
      v-if="visible && bonus"
      class="fixed bottom-5 right-5 z-[9500] w-80 bg-surface-0 border border-surface-3 rounded-xl shadow-lg overflow-hidden"
    >
      <div class="flex items-center justify-between px-4 py-3 border-b border-surface-2">
        <span class="text-xs font-semibold text-text-primary">注册成功</span>
        <button @click="dismiss" class="text-text-tertiary hover:text-text-primary">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="px-4 py-3 text-xs">
        <template v-if="bonus.granted">
          <p class="text-text-secondary mb-2">已发放注册赠送</p>
          <div class="space-y-1">
            <div v-if="(bonus.token ?? 0) > 0" class="flex items-center justify-between">
              <span class="text-text-tertiary">{{ siteConfig.labels.token }}</span>
              <span class="font-semibold text-emerald-600 dark:text-emerald-400">+ {{ formatAmount(bonus.token) }}</span>
            </div>
            <div v-if="(bonus.credit ?? 0) > 0" class="flex items-center justify-between">
              <span class="text-text-tertiary">{{ siteConfig.labels.credit }}</span>
              <span class="font-semibold text-emerald-600 dark:text-emerald-400">+ {{ formatAmount(bonus.credit) }}</span>
            </div>
            <div v-if="bonus.user_plan_id" class="flex items-center justify-between">
              <span class="text-text-tertiary">套餐</span>
              <span class="font-semibold text-emerald-600 dark:text-emerald-400">已开通</span>
            </div>
            <div v-else-if="bonus.plan_id" class="flex items-center justify-between">
              <span class="text-text-tertiary">套餐</span>
              <span class="text-text-secondary">待后台处理</span>
            </div>
          </div>
        </template>
        <template v-else-if="bonus.reason === 'device_already_granted'">
          <p class="text-text-secondary">本设备已领取过注册赠送</p>
        </template>
        <template v-else-if="bonus.reason === 'ip_daily_limit'">
          <p class="text-text-secondary">本 IP 今日领奖次数已达上限</p>
        </template>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useSiteConfigStore } from '@/stores/site-config'
import type { RegisterBonus } from '@/stores/cloud-auth'

const store = useCloudAuthStore()
const siteConfig = useSiteConfigStore()
const visible = ref(false)
const bonus = ref<RegisterBonus | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

function formatAmount(value?: number): string {
  if (!value) return '0'
  const n = Number(value)
  if (Number.isNaN(n)) return '0'
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2)
}

function dismiss(): void {
  visible.value = false
  if (timer) { clearTimeout(timer); timer = null }
}

function shouldShow(b: RegisterBonus | null): boolean {
  if (!b) return false
  if (b.granted) return (b.token ?? 0) > 0 || (b.credit ?? 0) > 0 || !!b.plan_id
  return b.reason === 'device_already_granted' || b.reason === 'ip_daily_limit'
}

watch(
  () => store.pendingBonus,
  (b) => {
    if (!shouldShow(b as RegisterBonus | null)) return
    const consumed = store.consumeBonus()
    if (!consumed) return
    bonus.value = consumed
    visible.value = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { visible.value = false }, 6000)
  },
  { immediate: true }
)

onUnmounted(() => {
  if (timer) clearTimeout(timer)
})
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
