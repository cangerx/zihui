<template>
  <div class="card p-5">
    <h3 class="text-sm font-semibold text-text-primary mb-4">兑换码</h3>

    <div class="flex gap-2">
      <input
        v-model="codeInput"
        type="text"
        placeholder="输入兑换码"
        class="flex-1 px-3 py-2 text-xs bg-surface-2 border border-surface-3 rounded-lg text-text-primary outline-none focus:border-primary-500 uppercase"
        :disabled="submitting"
        @keyup.enter="handleRedeem"
      />
      <button
        type="button"
        class="btn-primary text-xs px-5"
        :disabled="submitting || !codeInput.trim()"
        @click="handleRedeem"
      >
        {{ submitting ? '兑换中...' : '兑换' }}
      </button>
    </div>

    <p class="text-[10px] text-text-tertiary mt-2">兑换码不区分大小写</p>

    <!-- Success -->
    <div v-if="success" class="mt-3 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 rounded-lg px-3 py-2 text-xs">
      <div class="font-semibold mb-1">兑换成功</div>
      <div class="space-x-3">
        <span v-if="(success.token ?? 0) > 0">{{ siteConfig.labels.token }} +{{ formatAmount(success.token) }}</span>
        <span v-if="(success.credit ?? 0) > 0">{{ siteConfig.labels.credit }} +{{ formatAmount(success.credit) }}</span>
        <span v-if="success.user_plan_id">套餐 #{{ success.plan_id }} 已开通</span>
        <span v-else-if="success.plan_archived">套餐 #{{ success.plan_id }} 已归档，未发放</span>
      </div>
    </div>

    <!-- Error -->
    <div v-if="error" class="mt-3 bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-300 rounded-lg px-3 py-2 text-xs">
      {{ error }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { cloudClient } from '@/utils/cloud-api'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useSiteConfigStore } from '@/stores/site-config'

const siteConfig = useSiteConfigStore()

interface RedeemReward {
  token?: number
  credit?: number
  plan_id?: number | null
  user_plan_id?: number | null
  plan_archived?: boolean
}

const store = useCloudAuthStore()

const codeInput = ref('')
const submitting = ref(false)
const success = ref<RedeemReward | null>(null)
const error = ref('')

function formatAmount(value?: number): string {
  if (!value) return '0'
  const n = Number(value)
  if (Number.isNaN(n)) return '0'
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2)
}

async function handleRedeem() {
  const trimmed = codeInput.value.trim()
  if (!trimmed) return

  success.value = null
  error.value = ''
  submitting.value = true

  try {
    const data = await cloudClient.redeem(trimmed)
    success.value = data.reward || {}
    codeInput.value = ''
    await Promise.all([store.fetchMe(), store.fetchCloudData()])
  } catch (e: any) {
    error.value = e?.message || '兑换失败'
  } finally {
    submitting.value = false
  }
}
</script>
