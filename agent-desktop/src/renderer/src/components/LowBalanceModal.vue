<template>
  <Transition name="fade">
    <div v-if="visible" class="fixed inset-0 z-[9800] flex items-center justify-center pointer-events-none">
      <div class="pointer-events-auto w-[420px] max-w-[92vw] bg-surface-0 border border-surface-3 rounded-2xl shadow-2xl p-5">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 class="text-sm font-semibold text-text-primary">余额不足</h3>
            <p class="text-xs text-text-tertiary mt-1">当前额度不足以完成本次操作</p>
          </div>
          <button type="button" class="text-text-tertiary hover:text-text-primary" @click="$emit('update:visible', false)">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="rounded-xl bg-surface-1 border border-surface-3 p-4 space-y-2 text-xs">
          <div class="flex items-center justify-between">
            <span class="text-text-tertiary">额度类型</span>
            <span class="text-text-primary font-medium">{{ label }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-text-tertiary">预计需要</span>
            <span class="text-text-primary font-mono">{{ formatAmount(required) }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-text-tertiary">当前可用</span>
            <span class="text-red-500 font-mono">{{ formatAmount(available) }}</span>
          </div>
        </div>

        <div class="flex gap-2 mt-5">
          <button type="button" class="flex-1 py-2 text-xs font-medium border border-surface-3 rounded-lg text-text-secondary hover:bg-surface-2" @click="$emit('update:visible', false)">稍后再说</button>
          <button v-if="siteConfig.plansStore.enabled" type="button" class="flex-1 py-2 text-xs font-medium border border-surface-3 rounded-lg text-text-secondary hover:bg-surface-2" @click="goPlansStore">套餐商城</button>
          <button v-if="rechargeVisible" type="button" class="flex-1 btn-primary text-xs" @click="goRecharge">前往充值</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useSiteConfigStore } from '@/stores/site-config'
import { useSettingsUiStore } from '@/stores/settings-ui'

const props = defineProps<{
  visible: boolean
  balanceType?: string
  required?: number
  available?: number
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
}>()

const siteConfig = useSiteConfigStore()
const settingsUi = useSettingsUiStore()

const label = computed(() => siteConfig.labelOf(props.balanceType || 'credit'))
const required = computed(() => Number(props.required || 0))
const available = computed(() => Number(props.available || 0))
// 该额度类型对应的充值是否开放（金币 → recharge.token / 积分 → recharge.credit）
const rechargeVisible = computed(() =>
  (props.balanceType || 'credit') === 'token' ? siteConfig.recharge.token : siteConfig.recharge.credit
)

function goPlansStore() {
  emit('update:visible', false)
  settingsUi.show('wallet')
}

function goRecharge() {
  emit('update:visible', false)
  settingsUi.show('wallet')
}

function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2)
}
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
