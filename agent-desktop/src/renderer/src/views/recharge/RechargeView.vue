<template>
  <div :class="embedded ? 'flex flex-col' : 'h-full flex flex-col'">
    <header v-if="!embedded" class="page-header">
      <button
        type="button"
        class="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-primary"
        @click="goBack"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
        返回用户中心
      </button>
    </header>

    <div :class="embedded ? '' : 'page-body'">
      <div :class="embedded ? 'space-y-4' : 'max-w-3xl'">
        <div v-if="!embedded" class="mb-5">
          <h2 class="text-base font-semibold text-text-primary">充值</h2>
          <p class="text-xs text-text-tertiary mt-1">按金额或快捷档位充值，支付后自动到账</p>
        </div>

        <div v-if="loading" class="flex items-center justify-center py-12 text-xs text-text-tertiary">
          <svg class="w-5 h-5 animate-spin text-primary-600 mr-2" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
          </svg>
          正在加载...
        </div>
        <div v-else-if="loadError" class="bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300 rounded-lg px-4 py-3 text-xs">
          {{ loadError }}
          <button type="button" class="ml-2 underline" @click="load">重试</button>
        </div>
        <div v-else-if="!config || !config.enabled || !balanceTypes.length" class="text-center py-12 text-xs text-text-tertiary">
          充值功能暂未开启
        </div>

        <template v-else>
          <div v-if="embedded" class="mb-3">
            <div class="text-sm font-semibold text-text-primary">充值</div>
            <p class="text-[11px] text-text-tertiary mt-1">
              1 元 = {{ fmt(currentRatio) }} {{ labelOf(balanceType) }}，到账后不可提现、不可转让
            </p>
          </div>
          <div v-if="balanceTypes.length > 1" class="flex gap-2 mb-4">
            <button
              v-for="t in balanceTypes"
              :key="t"
              type="button"
              class="px-4 py-1.5 text-xs font-medium rounded-lg border transition-colors"
              :class="balanceType === t ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-surface-3 text-text-secondary hover:bg-surface-2'"
              @click="balanceType = t"
            >{{ labelOf(t) }}</button>
          </div>

          <div v-if="currentPackages.length" class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
            <button
              v-for="p in currentPackages"
              :key="p.id"
              type="button"
              class="card p-4 text-left hover:border-primary-400 transition-colors"
              @click="buyPackage(p)"
            >
              <div class="text-lg font-bold text-primary-600">¥{{ Number(p.pay_amount).toFixed(2) }}</div>
              <div class="text-xs text-text-secondary mt-1">到账 {{ fmt(p.base_amount) }} {{ labelOf(balanceType) }}</div>
              <div v-if="Number(p.bonus_amount) > 0" class="text-[11px] text-green-600 mt-0.5">赠 {{ fmt(p.bonus_amount) }}</div>
              <div v-if="p.title" class="text-[11px] text-text-tertiary mt-1 truncate">{{ p.title }}</div>
            </button>
          </div>

          <div class="card p-5">
            <div class="text-sm font-semibold text-text-primary mb-3">自定义金额</div>
            <div class="flex items-center gap-3">
              <input
                v-model.number="customAmount"
                type="number"
                :min="config.min_amount"
                step="1"
                placeholder="输入金额（元）"
                class="flex-1 px-3 py-2 text-sm rounded-lg border border-surface-3 bg-surface-1 text-text-primary focus:border-primary-500 outline-none"
              />
              <button class="btn-primary text-xs px-5" :disabled="!canBuyCustom" @click="buyCustom">充值</button>
            </div>
            <p class="text-xs text-text-tertiary mt-2">
              单笔最低 ¥{{ fmt(config.min_amount) }}
              <template v-if="!embedded">；1 元 = {{ fmt(currentRatio) }} {{ labelOf(balanceType) }}</template>
            </p>
            <p v-if="Number(customAmount) > 0" class="text-xs text-text-secondary mt-1">
              预计到账 {{ fmt(preview.base) }}<span v-if="preview.bonus > 0" class="text-green-600"> + 赠 {{ fmt(preview.bonus) }}</span> = {{ fmt(preview.total) }} {{ labelOf(balanceType) }}
            </p>
          </div>
        </template>
      </div>
    </div>

    <RechargeDialog v-model:visible="payOpen" :payload="payload" @paid="onPaid" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { cloudClient } from '@/utils/cloud-api'
import { useSiteConfigStore } from '@/stores/site-config'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import RechargeDialog from '@/components/RechargeDialog.vue'

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const router = useRouter()
const siteConfig = useSiteConfigStore()
const cloudAuth = useCloudAuthStore()

const loading = ref(false)
const loadError = ref('')
const config = ref<any>(null)
const balanceType = ref<'token' | 'credit'>('credit')
const customAmount = ref<number | ''>('')
const payOpen = ref(false)
const payload = ref<any>(null)

// 仅展示云控端开启的充值类型（config.token.enabled / config.credit.enabled）；老后端不带该字段时默认展示
const balanceTypes = computed<Array<'token' | 'credit'>>(() => {
  const cfg = config.value
  const out: Array<'token' | 'credit'> = []
  const tokenOn = siteConfig.recharge.token && (!cfg || cfg.token?.enabled !== false)
  const creditOn = siteConfig.recharge.credit && (!cfg || cfg.credit?.enabled !== false)
  if (tokenOn) out.push('token')
  if (creditOn) out.push('credit')
  return out
})
const labelOf = (t: string) => (t === 'token' ? siteConfig.labels.token : siteConfig.labels.credit)
const fmt = (v: any) => {
  const n = Number(v)
  if (!n) return '0'
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

const currentPackages = computed(() => (config.value?.packages || []).filter((p: any) => p.balance_type === balanceType.value))
const currentRatio = computed(() => (balanceType.value === 'token' ? Number(config.value?.token?.ratio || 0) : Number(config.value?.credit?.ratio || 0)))
const currentRules = computed(() => (balanceType.value === 'token' ? (config.value?.token?.bonus_rules || []) : (config.value?.credit?.bonus_rules || [])))

const preview = computed(() => {
  const amt = Number(customAmount.value) || 0
  if (amt <= 0) return { base: 0, bonus: 0, total: 0 }
  const base = Math.floor(amt * currentRatio.value * 10000) / 10000
  let bonus = 0
  for (const r of currentRules.value) {
    if (amt + 1e-9 >= Number(r.threshold)) bonus = Number(r.bonus)
  }
  return { base, bonus, total: base + bonus }
})
const canBuyCustom = computed(() => {
  const amt = Number(customAmount.value)
  return amt > 0 && amt >= Number(config.value?.min_amount || 0)
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    config.value = await cloudClient.getRechargeConfig()
    // 当前选中类型被云控端关闭时，自动切到第一个可用类型
    if (!balanceTypes.value.includes(balanceType.value) && balanceTypes.value.length) {
      balanceType.value = balanceTypes.value[0]
    }
  } catch (e: any) {
    loadError.value = e?.message || '加载失败'
  }
  loading.value = false
}
onMounted(load)

function goBack() {
  router.push('/user-center')
}

function buyPackage(p: any) {
  payload.value = {
    balance_type: balanceType.value,
    package_id: p.id,
    base: Number(p.base_amount),
    bonus: Number(p.bonus_amount),
    total: Number(p.base_amount) + Number(p.bonus_amount),
  }
  payOpen.value = true
}
function buyCustom() {
  if (!canBuyCustom.value) return
  payload.value = {
    balance_type: balanceType.value,
    amount: Number(customAmount.value),
    base: preview.value.base,
    bonus: preview.value.bonus,
    total: preview.value.total,
  }
  payOpen.value = true
}
function onPaid() {
  cloudAuth.fetchCloudData().catch(() => {})
}
</script>
