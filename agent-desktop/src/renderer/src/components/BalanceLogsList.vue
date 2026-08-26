<template>
  <div class="flex flex-col min-h-0" :class="compact ? '' : 'h-full'">
    <div v-if="showFilters" class="pb-3 flex items-center gap-2">
      <select
        v-if="!balanceType"
        v-model="filterType"
        class="text-xs px-2 py-1.5 bg-surface-2 border border-surface-3 rounded-lg text-text-primary outline-none"
        @change="reload"
      >
        <option value="">全部类型</option>
        <option value="token">{{ siteConfig.labels.token }}</option>
        <option value="credit">{{ siteConfig.labels.credit }}</option>
      </select>
      <select
        v-if="kind === 'all'"
        v-model="filterChange"
        class="text-xs px-2 py-1.5 bg-surface-2 border border-surface-3 rounded-lg text-text-primary outline-none"
        @change="reload"
      >
        <option value="">全部变动</option>
        <option value="recharge">充值</option>
        <option value="recharge_bonus">充值赠送</option>
        <option value="register_bonus">注册赠送</option>
        <option value="redeem">兑换码</option>
        <option value="plan_grant">套餐发放</option>
        <option value="plan_adjust">套餐余量调整</option>
        <option value="usage">用量扣费</option>
        <option value="deduct">扣减</option>
        <option value="admin_adjust">管理员调整</option>
      </select>
      <button
        type="button"
        class="ml-auto text-xs text-text-tertiary hover:text-text-primary"
        :disabled="loading"
        @click="reload"
      >刷新</button>
    </div>

    <div :class="compact ? '' : 'flex-1 overflow-y-auto'">
      <div v-if="loading && !visibleLogs.length" class="text-xs text-text-tertiary py-8 text-center">加载中...</div>
      <div v-else-if="!visibleLogs.length" class="text-xs text-text-tertiary py-8 text-center">暂无明细</div>

      <ul v-else class="divide-y divide-surface-2">
        <li v-for="log in visibleLogs" :key="log.id" class="px-1 py-2.5">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span v-if="!balanceType" class="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-secondary">
                  {{ siteConfig.labelOf(log.balance_type) }}
                </span>
                <span class="text-[11px] text-text-secondary">{{ changeTypeLabel(log.change_type) }}</span>
              </div>
              <p v-if="displayLogRemark(log)" class="text-[10px] text-text-tertiary mt-1 truncate">{{ displayLogRemark(log) }}</p>
              <p class="text-[10px] text-text-tertiary mt-0.5">{{ formatLogTime(log.created_at) }}</p>
            </div>
            <div class="text-right whitespace-nowrap">
              <div :class="['text-sm font-semibold', Number(log.change_amount) >= 0 ? 'text-emerald-600' : 'text-red-500']">
                {{ Number(log.change_amount) >= 0 ? '+' : '' }}{{ formatLogAmount(log.change_amount) }}
              </div>
              <div class="text-[10px] text-text-tertiary">余 {{ formatLogAmount(log.balance_after) }}</div>
            </div>
          </div>
        </li>
      </ul>

      <div v-if="hasMore" class="py-3 text-center">
        <button
          type="button"
          class="text-xs text-primary-600 hover:text-primary-700"
          :disabled="loading"
          @click="loadMore"
        >{{ loading ? '加载中...' : '加载更多' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { cloudClient } from '@/utils/cloud-api'
import { useSiteConfigStore } from '@/stores/site-config'
import {
  type BalanceLog,
  type BalanceLogKind,
  changeTypeLabel,
  displayLogRemark,
  formatLogAmount,
  formatLogTime,
  logMatchesKind,
} from '@/utils/balance-logs'

const props = withDefaults(defineProps<{
  balanceType?: string
  kind?: BalanceLogKind
  compact?: boolean
  showFilters?: boolean
}>(), {
  kind: 'all',
  compact: false,
  showFilters: true,
})

const siteConfig = useSiteConfigStore()
const loading = ref(false)
const logs = ref<BalanceLog[]>([])
const filterType = ref('')
const filterChange = ref('')
const page = ref(1)
const lastPage = ref(1)
const hasMore = ref(false)

const visibleLogs = computed(() => logs.value.filter((log) => logMatchesKind(log, props.kind)))

async function fetch(reset: boolean) {
  loading.value = true
  try {
    const params: Record<string, string> = { page: String(reset ? 1 : page.value), per_page: '20' }
    const type = props.balanceType || filterType.value
    if (type) params.balance_type = type
    if (props.kind === 'all' && filterChange.value) params.change_type = filterChange.value
    const res = await cloudClient.myBalanceLogs(params)
    const incoming = (res.data || []) as BalanceLog[]
    if (reset) {
      logs.value = incoming
      page.value = 1
    } else {
      logs.value = [...logs.value, ...incoming]
    }
    lastPage.value = res.last_page || 1
    hasMore.value = page.value < lastPage.value
    if (reset && props.kind !== 'all' && visibleLogs.value.length < 8 && hasMore.value) {
      loading.value = false
      page.value = 2
      await fetch(false)
      return
    }
  } catch {
    if (reset) logs.value = []
  } finally {
    loading.value = false
  }
}

function reload() {
  fetch(true)
}

function loadMore() {
  if (!hasMore.value || loading.value) return
  page.value++
  fetch(false)
}

watch(() => [props.balanceType, props.kind], () => reload())
onMounted(reload)
</script>
