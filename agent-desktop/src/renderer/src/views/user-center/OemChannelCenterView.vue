<template>
  <div class="h-full flex flex-col">
    <header class="page-header items-center justify-between">
      <div class="min-w-0">
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
      </div>
      <button type="button" class="btn-secondary text-xs" :disabled="loading" @click="reloadAll">刷新</button>
    </header>

    <div class="page-body max-w-6xl space-y-5">
      <div v-if="profileLoaded && !hasChannel" class="card p-8 text-center">
        <h3 class="text-sm font-semibold text-text-primary">暂无渠道身份</h3>
        <p class="text-xs text-text-tertiary mt-2">当前账号尚未绑定 OEM 项目，绑定后可查看渠道订单和佣金。</p>
      </div>

      <template v-else>
        <div class="flex items-center justify-between gap-3">
          <div class="text-xs text-text-tertiary">汇总月份：{{ selectedPeriodLabel }}</div>
          <div class="flex items-center gap-2">
            <select v-model="selectedYear" class="filter-input w-24" @change="loadSummary">
              <option v-for="year in yearOptions" :key="year" :value="year">{{ year }}年</option>
            </select>
            <select v-model="selectedMonth" class="filter-input w-20" @change="loadSummary">
              <option v-for="month in monthOptions" :key="month" :value="month">{{ month }}月</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div class="card p-4">
            <div class="text-[11px] text-text-tertiary">累计订单额</div>
            <div class="text-xl font-semibold text-text-primary mt-1">{{ money(summary.total_order_amount) }}</div>
          </div>
          <div class="card p-4">
            <div class="text-[11px] text-text-tertiary">累计佣金</div>
            <div class="text-xl font-semibold text-primary-600 mt-1">{{ money(summary.total_commission_amount) }}</div>
          </div>
          <div class="card p-4">
            <div class="text-[11px] text-text-tertiary">{{ selectedPeriodLabel }}订单额</div>
            <div class="text-xl font-semibold text-text-primary mt-1">{{ money(summary.month_order_amount) }}</div>
          </div>
          <div class="card p-4">
            <div class="text-[11px] text-text-tertiary">{{ selectedPeriodLabel }}佣金</div>
            <div class="text-xl font-semibold text-primary-600 mt-1">{{ money(summary.month_commission_amount) }}</div>
          </div>
        </div>

        <div class="card p-5">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-text-primary">我的 OEM 项目</h3>
            <span class="text-[10px] text-text-tertiary">{{ projects.length }} 个</span>
          </div>
          <div v-if="projects.length" class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div v-for="p in projects" :key="p.project_key" class="rounded-xl border border-surface-3 bg-surface-1 p-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-sm font-medium text-text-primary truncate">{{ p.name }}</div>
                  <div class="text-[10px] text-text-tertiary font-mono mt-0.5 truncate">{{ p.project_key }}</div>
                </div>
                <span :class="['text-[10px] px-2 py-0.5 rounded-full', p.commission_enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-surface-2 text-text-tertiary']">
                  {{ p.commission_enabled ? `${rateText(p.commission_rate)} 佣金` : '未启用佣金' }}
                </span>
              </div>
              <div class="text-[11px] text-text-tertiary mt-2">身份：{{ roleLabel(p.role) }}</div>
            </div>
          </div>
          <div v-else class="text-xs text-text-tertiary">暂无项目</div>
        </div>

        <div class="card p-5">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-sm font-semibold text-text-primary">渠道订单</h3>
            <button type="button" class="text-xs text-text-tertiary hover:text-text-primary" :disabled="ordersLoading" @click="loadOrders(true)">刷新</button>
          </div>
          <div class="flex flex-wrap gap-2 mb-3">
            <input v-model="orderFilters.keyword" placeholder="订单号 / 用户 / 套餐" class="filter-input w-44" @keyup.enter="loadOrders(true)" />
            <select v-model="orderFilters.oem_project_key" class="filter-input w-40" @change="loadOrders(true)">
              <option value="">全部项目</option>
              <option v-for="p in projects" :key="p.project_key" :value="p.project_key">{{ p.name }}</option>
            </select>
            <select v-model="orderFilters.order_status" class="filter-input w-32" @change="loadOrders(true)">
              <option value="">订单状态</option>
              <option value="pending">待支付</option>
              <option value="paid">已支付</option>
              <option value="closed">已关闭</option>
              <option value="failed">失败</option>
              <option value="refunded">已退款</option>
            </select>
            <select v-model="orderFilters.commission_status" class="filter-input w-32" @change="loadOrders(true)">
              <option value="">佣金状态</option>
              <option value="none">无佣金</option>
              <option value="pending">待确认</option>
              <option value="confirmed">已确认</option>
              <option value="settled">已结算</option>
              <option value="cancelled">已取消</option>
            </select>
            <select v-model="orderFilters.order_type" class="filter-input w-32" @change="loadOrders(true)">
              <option value="">订单类型</option>
              <option value="purchase">购买</option>
              <option value="renew">续费</option>
              <option value="upgrade">升级</option>
            </select>
            <button type="button" class="btn-secondary text-xs" @click="loadOrders(true)">搜索</button>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="text-left text-text-tertiary border-b border-surface-3">
                  <th class="py-2 pr-4 font-medium">订单</th>
                  <th class="py-2 pr-4 font-medium">项目</th>
                  <th class="py-2 pr-4 font-medium">买家</th>
                  <th class="py-2 pr-4 font-medium">套餐</th>
                  <th class="py-2 pr-4 font-medium text-right">金额</th>
                  <th class="py-2 pr-4 font-medium text-right">佣金</th>
                  <th class="py-2 pr-4 font-medium">状态</th>
                  <th class="py-2 font-medium">支付时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="ordersLoading && !orders.length"><td colspan="8" class="py-8 text-center text-text-tertiary">加载中...</td></tr>
                <tr v-else-if="!orders.length"><td colspan="8" class="py-8 text-center text-text-tertiary">暂无订单</td></tr>
                <tr v-for="o in orders" :key="o.id" class="border-b border-surface-2 text-text-secondary">
                  <td class="py-2 pr-4 font-mono text-[11px]">{{ o.order_no }}</td>
                  <td class="py-2 pr-4">{{ o.oem_project_name || o.oem_project_key || '-' }}</td>
                  <td class="py-2 pr-4">{{ userName(o.user) }}</td>
                  <td class="py-2 pr-4">{{ o.plan?.name || '-' }}</td>
                  <td class="py-2 pr-4 text-right">{{ money(o.amount) }}</td>
                  <td class="py-2 pr-4 text-right">{{ money(o.commission_amount) }}</td>
                  <td class="py-2 pr-4"><span :class="statusClass(o.derived_status || o.status)">{{ statusLabel(o.derived_status || o.status) }}</span></td>
                  <td class="py-2">{{ formatTime(o.paid_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="ordersHasMore" class="text-center pt-3">
            <button type="button" class="text-xs text-primary-600 hover:text-primary-700" :disabled="ordersLoading" @click="loadMoreOrders">加载更多</button>
          </div>
        </div>

        <div class="card p-5">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-sm font-semibold text-text-primary">佣金记录</h3>
            <button type="button" class="text-xs text-text-tertiary hover:text-text-primary" :disabled="commissionsLoading" @click="loadCommissions(true)">刷新</button>
          </div>
          <div class="flex flex-wrap gap-2 mb-3">
            <input v-model="commissionFilters.keyword" placeholder="订单号 / 用户 / 套餐" class="filter-input w-44" @keyup.enter="loadCommissions(true)" />
            <select v-model="commissionFilters.oem_project_key" class="filter-input w-40" @change="loadCommissions(true)">
              <option value="">全部项目</option>
              <option v-for="p in projects" :key="p.project_key" :value="p.project_key">{{ p.name }}</option>
            </select>
            <select v-model="commissionFilters.status" class="filter-input w-32" @change="loadCommissions(true)">
              <option value="">状态</option>
              <option value="pending">待确认</option>
              <option value="confirmed">已确认</option>
              <option value="settled">已结算</option>
              <option value="cancelled">已取消</option>
            </select>
            <button type="button" class="btn-secondary text-xs" @click="loadCommissions(true)">搜索</button>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="text-left text-text-tertiary border-b border-surface-3">
                  <th class="py-2 pr-4 font-medium">订单</th>
                  <th class="py-2 pr-4 font-medium">项目</th>
                  <th class="py-2 pr-4 font-medium">买家</th>
                  <th class="py-2 pr-4 font-medium">套餐</th>
                  <th class="py-2 pr-4 font-medium text-right">订单金额</th>
                  <th class="py-2 pr-4 font-medium text-right">佣金</th>
                  <th class="py-2 pr-4 font-medium">状态</th>
                  <th class="py-2 font-medium">确认时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="commissionsLoading && !commissions.length"><td colspan="8" class="py-8 text-center text-text-tertiary">加载中...</td></tr>
                <tr v-else-if="!commissions.length"><td colspan="8" class="py-8 text-center text-text-tertiary">暂无佣金记录</td></tr>
                <tr v-for="c in commissions" :key="c.id" class="border-b border-surface-2 text-text-secondary">
                  <td class="py-2 pr-4 font-mono text-[11px]">{{ c.order_no }}</td>
                  <td class="py-2 pr-4">{{ c.oem_project_name || c.oem_project_key || '-' }}</td>
                  <td class="py-2 pr-4">{{ userName(c.buyer) }}</td>
                  <td class="py-2 pr-4">{{ c.plan?.name || '-' }}</td>
                  <td class="py-2 pr-4 text-right">{{ money(c.order_amount) }}</td>
                  <td class="py-2 pr-4 text-right text-primary-600 font-medium">{{ money(c.commission_amount) }}</td>
                  <td class="py-2 pr-4"><span :class="commissionClass(c.status)">{{ commissionLabel(c.status) }}</span></td>
                  <td class="py-2">{{ formatTime(c.confirmed_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="commissionsHasMore" class="text-center pt-3">
            <button type="button" class="text-xs text-primary-600 hover:text-primary-700" :disabled="commissionsLoading" @click="loadMoreCommissions">加载更多</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { cloudClient } from '@/utils/cloud-api'

interface ProjectItem {
  project_key: string
  name: string
  app_name: string
  status: string
  commission_rate: number
  commission_enabled: boolean
  role: string
  bound_at: string | null
}

interface SummaryData {
  total_order_amount: number
  total_commission_amount: number
  month_order_amount: number
  month_commission_amount: number
  paid_order_count: number
  commission_count: number
  period_year?: number
  period_month?: number
}

const router = useRouter()
const profileLoaded = ref(false)
const loading = ref(false)
const projects = ref<ProjectItem[]>([])
const currentDate = new Date()
const selectedYear = ref(currentDate.getFullYear())
const selectedMonth = ref(currentDate.getMonth() + 1)
const summary = ref<SummaryData>({
  total_order_amount: 0,
  total_commission_amount: 0,
  month_order_amount: 0,
  month_commission_amount: 0,
  paid_order_count: 0,
  commission_count: 0,
})

const orders = ref<any[]>([])
const ordersLoading = ref(false)
const ordersPage = ref(1)
const ordersTotal = ref(0)
const orderFilters = reactive({ keyword: '', oem_project_key: '', order_status: '', commission_status: '', order_type: '' })

const commissions = ref<any[]>([])
const commissionsLoading = ref(false)
const commissionsPage = ref(1)
const commissionsTotal = ref(0)
const commissionFilters = reactive({ keyword: '', oem_project_key: '', status: '' })

const hasChannel = computed(() => projects.value.length > 0)
const ordersHasMore = computed(() => orders.value.length < ordersTotal.value)
const commissionsHasMore = computed(() => commissions.value.length < commissionsTotal.value)
const yearOptions = computed(() => {
  const currentYear = currentDate.getFullYear()
  return Array.from({ length: 6 }, (_, index) => currentYear - index)
})
const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1)
const selectedPeriodLabel = computed(() => `${selectedYear.value}年${String(selectedMonth.value).padStart(2, '0')}月`)

function goBack() {
  router.push('/user-center')
}

async function reloadAll() {
  loading.value = true
  try {
    const [profile, summaryRes] = await Promise.all([
      cloudClient.oemChannelProfile(),
      fetchSummary().catch(() => null),
    ])
    projects.value = profile.projects || []
    if (summaryRes?.summary) summary.value = summaryRes.summary
    profileLoaded.value = true
    if (projects.value.length) {
      await Promise.all([loadOrders(true), loadCommissions(true)])
    }
  } finally {
    loading.value = false
  }
}

function summaryParams(): Record<string, string> {
  return {
    year: String(selectedYear.value),
    month: String(selectedMonth.value),
  }
}

async function fetchSummary() {
  return cloudClient.oemChannelSummary(summaryParams())
}

async function loadSummary() {
  loading.value = true
  try {
    const res = await fetchSummary()
    if (res?.summary) summary.value = res.summary
  } finally {
    loading.value = false
  }
}

function cleanParams(source: Record<string, string>, page: number): Record<string, string> {
  const params: Record<string, string> = { page: String(page), per_page: '20' }
  for (const [key, value] of Object.entries(source)) {
    if (value) params[key] = value
  }
  return params
}

async function loadOrders(reset: boolean) {
  ordersLoading.value = true
  try {
    const nextPage = reset ? 1 : ordersPage.value
    const res = await cloudClient.oemChannelOrders(cleanParams(orderFilters, nextPage))
    const rows = res.data || []
    orders.value = reset ? rows : [...orders.value, ...rows]
    ordersPage.value = nextPage
    ordersTotal.value = Number(res.total || rows.length)
  } finally {
    ordersLoading.value = false
  }
}

function loadMoreOrders() {
  if (ordersLoading.value || !ordersHasMore.value) return
  ordersPage.value++
  loadOrders(false)
}

async function loadCommissions(reset: boolean) {
  commissionsLoading.value = true
  try {
    const nextPage = reset ? 1 : commissionsPage.value
    const res = await cloudClient.oemChannelCommissions(cleanParams(commissionFilters, nextPage))
    const rows = res.data || []
    commissions.value = reset ? rows : [...commissions.value, ...rows]
    commissionsPage.value = nextPage
    commissionsTotal.value = Number(res.total || rows.length)
  } finally {
    commissionsLoading.value = false
  }
}

function loadMoreCommissions() {
  if (commissionsLoading.value || !commissionsHasMore.value) return
  commissionsPage.value++
  loadCommissions(false)
}

function money(value: unknown): string {
  const n = Number(value || 0)
  return Number.isNaN(n) ? '0.00' : n.toFixed(2)
}

function rateText(value: unknown): string {
  const n = Number(value || 0)
  return Number.isNaN(n) ? '0.00%' : `${(n * 100).toFixed(2)}%`
}

function roleLabel(role: string): string {
  if (role === 'manager') return '协管人'
  return '负责人'
}

function userName(user: any): string {
  if (!user) return '-'
  return user.nickname || user.username || `#${user.id}`
}

function formatTime(value?: string | null): string {
  if (!value) return '-'
  try {
    const d = new Date(value)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${day} ${h}:${min}`
  } catch {
    return value
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pending': return '待支付'
    case 'paid': return '已支付'
    case 'closed': return '已关闭'
    case 'expired': return '已超时'
    case 'failed': return '失败'
    case 'refunded': return '已退款'
    default: return status || '-'
  }
}

function statusClass(status: string): string {
  if (status === 'paid') return 'text-emerald-600'
  if (status === 'pending') return 'text-amber-600'
  if (status === 'failed') return 'text-red-500'
  return 'text-text-tertiary'
}

function commissionLabel(status: string): string {
  switch (status) {
    case 'pending': return '待确认'
    case 'confirmed': return '已确认'
    case 'settled': return '已结算'
    case 'cancelled': return '已取消'
    case 'none': return '无佣金'
    default: return status || '-'
  }
}

function commissionClass(status: string): string {
  if (status === 'confirmed') return 'text-emerald-600'
  if (status === 'settled') return 'text-primary-600'
  if (status === 'pending') return 'text-amber-600'
  if (status === 'cancelled') return 'text-red-500'
  return 'text-text-tertiary'
}

onMounted(() => {
  reloadAll()
})
</script>

<style scoped>
.filter-input {
  @apply text-xs px-2 py-1.5 bg-surface-2 border border-surface-3 rounded-lg text-text-primary outline-none focus:border-primary-500;
}
</style>
