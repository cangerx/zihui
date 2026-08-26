<template>
  <div class="space-y-5">
    <div class="flex items-center gap-2.5">
      <div class="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center">
        <svg class="w-4 h-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
        </svg>
      </div>
      <div class="min-w-0">
        <h2 class="text-sm font-semibold text-text-primary">钱包</h2>
        <p class="text-[11px] text-text-tertiary">{{ soloType ? `查看${siteConfig.labelOf(soloType)}余额、充值与明细` : '查看额度、充值与购买套餐' }}</p>
      </div>
    </div>

    <div v-if="!cloudAuth.isLoggedIn" class="card p-6 text-center">
      <p class="text-xs text-text-secondary">登录后可查看余额并发起支付</p>
      <button type="button" class="btn-primary text-xs mt-4" @click="goLogin">去登录</button>
    </div>

    <template v-else>
      <div class="flex flex-wrap gap-1 border-b border-surface-2 pb-px">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors"
          :class="activeTab === tab.id
            ? 'border-primary-600 text-primary-700'
            : 'border-transparent text-text-secondary hover:text-text-primary'"
          @click="activeTab = tab.id"
        >{{ tab.label }}</button>
      </div>

      <template v-if="soloType">
        <div v-if="activeTab === 'balance'" class="space-y-4">
          <AssetSummaryCard hero :focus-type="soloType" />
          <div v-if="siteConfig.hasAnyRecharge">
            <RechargeView embedded />
          </div>
          <p v-else class="text-xs text-text-tertiary py-4 text-center">直充暂未开启，可购买套餐获取额度</p>
        </div>
        <div v-else-if="activeTab === 'in'">
          <BalanceLogsList :balance-type="soloType" kind="in" compact :show-filters="false" />
        </div>
        <div v-else-if="activeTab === 'out'">
          <BalanceLogsList :balance-type="soloType" kind="out" compact :show-filters="false" />
        </div>
        <div v-else-if="activeTab === 'plans'">
          <p v-if="!siteConfig.plansStore.enabled" class="text-xs text-text-tertiary py-8 text-center">套餐商城暂未开启</p>
          <PlansStoreView v-else embedded />
        </div>
        <div v-else-if="activeTab === 'mine'" class="space-y-4">
          <MyPlansBox />
          <RedeemBox />
        </div>
      </template>

      <template v-else>
        <AssetSummaryCard v-if="activeTab === 'recharge' || activeTab === 'plans' || activeTab === 'mine'" @open-logs="balanceLogsOpen = true" />

        <div v-if="activeTab === 'recharge'">
          <p v-if="!siteConfig.hasAnyRecharge" class="text-xs text-text-tertiary py-8 text-center">
            直充暂未开启，可购买套餐获取额度
          </p>
          <RechargeView v-else embedded />
        </div>

        <div v-else-if="activeTab === 'plans'">
          <p v-if="!siteConfig.plansStore.enabled" class="text-xs text-text-tertiary py-8 text-center">
            套餐商城暂未开启
          </p>
          <PlansStoreView v-else embedded />
        </div>

        <div v-else-if="activeTab === 'mine'" class="space-y-4">
          <MyPlansBox />
          <RedeemBox />
        </div>
      </template>
    </template>

    <BalanceLogsDialog v-model:visible="balanceLogsOpen" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useSiteConfigStore } from '@/stores/site-config'
import { useSettingsUiStore } from '@/stores/settings-ui'
import AssetSummaryCard from '@/components/AssetSummaryCard.vue'
import BalanceLogsDialog from '@/components/BalanceLogsDialog.vue'
import BalanceLogsList from '@/components/BalanceLogsList.vue'
import MyPlansBox from '@/components/MyPlansBox.vue'
import RedeemBox from '@/components/RedeemBox.vue'
import RechargeView from '@/views/recharge/RechargeView.vue'
import PlansStoreView from '@/views/plans-store/PlansStoreView.vue'

type WalletTab = 'balance' | 'in' | 'out' | 'recharge' | 'plans' | 'mine'

const cloudAuth = useCloudAuthStore()
const siteConfig = useSiteConfigStore()
const settingsUi = useSettingsUiStore()
const router = useRouter()

const balanceLogsOpen = ref(false)
const activeTab = ref<WalletTab>('balance')

const soloType = computed(() => siteConfig.soloRechargeType)

const tabs = computed(() => {
  if (soloType.value) {
    const list: { id: WalletTab; label: string }[] = [
      { id: 'balance', label: '账户余额' },
      { id: 'in', label: '充值记录' },
      { id: 'out', label: '消耗明细' },
    ]
    if (siteConfig.plansStore.enabled) list.push({ id: 'plans', label: '套餐商城' })
    list.push({ id: 'mine', label: '我的套餐' })
    return list
  }
  const list: { id: WalletTab; label: string }[] = []
  if (siteConfig.hasAnyRecharge) list.push({ id: 'recharge', label: '充值' })
  if (siteConfig.plansStore.enabled) list.push({ id: 'plans', label: '套餐商城' })
  list.push({ id: 'mine', label: '我的套餐' })
  return list
})

function pickDefaultTab() {
  const ids = tabs.value.map((t) => t.id)
  if (!ids.includes(activeTab.value)) {
    activeTab.value = ids[0] || 'mine'
  }
}

watch(tabs, pickDefaultTab, { immediate: true })

onMounted(async () => {
  try {
    await siteConfig.fetch()
  } catch { /* 忽略 */ }
  if (cloudAuth.isLoggedIn) {
    cloudAuth.fetchCloudData().catch(() => {})
  }
  pickDefaultTab()
})

function goLogin() {
  settingsUi.hide()
  router.push('/login')
}
</script>
