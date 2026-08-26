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
      <div :class="embedded ? 'space-y-4' : 'max-w-5xl'">
        <div v-if="!embedded" class="mb-5">
          <h2 class="text-base font-semibold text-text-primary">套餐商城</h2>
          <p class="text-xs text-text-tertiary mt-1">选购合适的套餐解锁更多模型与额度</p>
        </div>

        <!-- Loading -->
        <div
          v-if="loading"
          class="flex items-center justify-center py-12 text-xs text-text-tertiary"
        >
          <svg class="w-5 h-5 animate-spin text-primary-600 mr-2" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
          </svg>
          正在加载套餐...
        </div>

        <!-- Error -->
        <div v-else-if="loadError" class="bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300 rounded-lg px-4 py-3 text-xs">
          {{ loadError }}
          <button
            type="button"
            class="ml-2 underline"
            @click="loadPlans"
          >重试</button>
        </div>

        <template v-else>
          <div v-if="planCategories.length" class="flex flex-wrap gap-2 mb-4">
            <button
              type="button"
              :class="[
                'px-3 py-1.5 text-xs rounded-lg border transition-colors',
                selectedCategoryId === null
                  ? 'bg-primary-600 border-primary-600 text-white'
                  : 'bg-surface-0 border-surface-3 text-text-secondary hover:bg-surface-2 hover:text-text-primary'
              ]"
              @click="selectedCategoryId = null"
            >全部</button>
            <button
              v-for="cat in planCategories"
              :key="cat.id"
              type="button"
              :class="[
                'px-3 py-1.5 text-xs rounded-lg border transition-colors',
                selectedCategoryId === cat.id
                  ? 'bg-primary-600 border-primary-600 text-white'
                  : 'bg-surface-0 border-surface-3 text-text-secondary hover:bg-surface-2 hover:text-text-primary'
              ]"
              @click="selectedCategoryId = cat.id"
            >{{ cat.name }}</button>
          </div>

          <!-- Empty -->
          <div
            v-if="!plans.length"
            class="text-center py-12 text-xs text-text-tertiary"
          >
            暂无可购买的套餐
          </div>

          <!-- Plans grid -->
          <div
            v-else-if="filteredPlans.length"
            class="grid gap-4"
            :class="embedded ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'"
          >
            <div
              v-for="p in filteredPlans"
              :key="p.id"
              class="card p-5 flex flex-col"
            >
              <div class="flex items-start justify-between gap-2 mb-2">
                <div class="min-w-0">
                  <h3 class="text-sm font-semibold text-text-primary truncate">{{ p.name }}</h3>
                  <p v-if="p.category?.name" class="text-[10px] text-text-tertiary mt-0.5">{{ p.category.name }}</p>
                </div>
                <span
                  v-if="p.duration_days === 0"
                  class="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                >永久</span>
                <span
                  v-else
                  class="text-[10px] px-2 py-0.5 rounded-full bg-primary-50 text-primary-700"
                >{{ p.duration_days }} 天</span>
              </div>

              <ExpandableText
                v-if="p.description"
                :text="p.description"
                :lines="2"
                class="mb-3"
              />

              <div class="flex items-baseline gap-1 mb-3">
                <span class="text-2xl font-bold text-primary-600">{{ formatPrice(p.price) }}</span>
                <span class="text-[10px] text-text-tertiary">{{ p.currency || 'CNY' }}</span>
              </div>

              <div class="grid grid-cols-2 gap-2 text-[11px] mb-3">
                <div v-if="p.token_quota > 0">
                  <span class="text-text-tertiary">{{ siteConfig.labels.token }}额度</span>
                  <span class="text-text-primary ml-1 font-medium">{{ formatNum(p.token_quota) }}</span>
                </div>
                <div v-if="p.credit_quota > 0">
                  <span class="text-text-tertiary">{{ siteConfig.labels.credit }}额度</span>
                  <span class="text-text-primary ml-1 font-medium">{{ formatNum(p.credit_quota) }}</span>
                </div>
                <div>
                  <span class="text-text-tertiary">含模型</span>
                  <span class="text-text-primary ml-1 font-medium">{{ p.models?.length || 0 }} 个</span>
                </div>
              </div>

              <div v-if="p.models?.length" class="mb-4">
                <div class="text-[10px] text-text-tertiary mb-1">包含模型</div>
                <div class="flex flex-wrap gap-1">
                  <span
                    v-for="m in p.models.slice(0, 6)"
                    :key="m.id"
                    class="text-[10px] bg-surface-2 text-text-secondary px-2 py-0.5 rounded"
                  >{{ m.name || m.model_id }}</span>
                  <span
                    v-if="p.models.length > 6"
                    class="text-[10px] text-text-tertiary"
                  >+{{ p.models.length - 6 }}</span>
                </div>
              </div>

              <div v-if="currentUserPlan(p)" class="text-[11px] text-text-tertiary mb-3">
                当前套餐
                <span v-if="currentUserPlan(p)?.expires_at" class="text-text-secondary ml-1">
                  到期 {{ formatDate(currentUserPlan(p)?.expires_at) }}
                </span>
                <span v-else class="text-text-secondary ml-1">永久有效</span>
              </div>

              <div class="flex-1"></div>

              <div class="space-y-2">
                <button
                  type="button"
                  class="btn-primary text-xs w-full"
                  :disabled="!canPurchase(p)"
                  @click="handleBuy(p)"
                >
                  {{ purchaseLabel(p) }}
                </button>
                <button
                  v-if="canUpgradeTo(p)"
                  type="button"
                  class="btn-secondary text-xs w-full"
                  @click="handleUpgrade(p)"
                >
                  升级套餐
                </button>
              </div>
            </div>
          </div>

          <div v-else class="text-center py-16 text-xs text-text-tertiary">
            当前分类暂无可购买的套餐
          </div>

          <div v-if="filteredPlans.length" class="card p-5 mt-5 overflow-x-auto">
            <h3 class="text-sm font-semibold text-text-primary mb-3">套餐对比</h3>
            <table class="w-full text-xs">
              <thead>
                <tr class="text-left text-text-tertiary border-b border-surface-3">
                  <th class="py-2 pr-4 font-medium">套餐</th>
                  <th class="py-2 pr-4 font-medium">有效期</th>
                  <th class="py-2 pr-4 font-medium">{{ siteConfig.labels.token }}</th>
                  <th class="py-2 pr-4 font-medium">{{ siteConfig.labels.credit }}</th>
                  <th class="py-2 pr-4 font-medium">续充</th>
                  <th class="py-2 pr-4 font-medium">模型</th>
                  <th class="py-2 font-medium">价格</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in filteredPlans" :key="`compare-${p.id}`" class="border-b border-surface-2 text-text-secondary">
                  <td class="py-2 pr-4 text-text-primary font-medium">{{ p.name }}</td>
                  <td class="py-2 pr-4">{{ p.duration_days === 0 ? '永久' : `${p.duration_days} 天` }}</td>
                  <td class="py-2 pr-4">{{ formatNum(p.token_quota) }}</td>
                  <td class="py-2 pr-4">{{ formatNum(p.credit_quota) }}</td>
                  <td class="py-2 pr-4">{{ refillLabel(p.quota_refill_cycle) }}</td>
                  <td class="py-2 pr-4">{{ p.models?.length || 0 }}</td>
                  <td class="py-2">{{ formatPrice(p.price) }} {{ p.currency || 'CNY' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p v-if="plans.length" class="text-[11px] text-text-tertiary mt-6 text-center">
            支付完成后套餐将自动开通，可在「我的套餐」查看
          </p>
        </template>
      </div>
    </div>

    <!-- Payment dialog -->
    <PaymentDialog
      v-model:visible="payOpen"
      :plan-id="selectedPlanId"
      :from-user-plan-id="selectedFromUserPlanId"
      @paid="onPaid"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { cloudClient } from '@/utils/cloud-api'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useSiteConfigStore } from '@/stores/site-config'
import PaymentDialog from '@/components/PaymentDialog.vue'
import ExpandableText from '@/components/ExpandableText.vue'

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const siteConfig = useSiteConfigStore()
const cloudAuth = useCloudAuthStore()

interface StoreModel {
  id: number
  model_id: string
  name: string
  type: string
}

interface PlanCategory {
  id: number
  name: string
  sort_order?: number
}

interface StorePlan {
  id: number
  category_id?: number | null
  category?: PlanCategory | null
  code: string
  name: string
  description: string
  price: string
  currency: string
  duration_days: number
  token_quota: number
  credit_quota: number
  quota_refill_cycle?: string
  policies?: Record<string, any>
  rate_limit?: Record<string, any>
  sort: number
  models: StoreModel[]
}

const router = useRouter()

const plans = ref<StorePlan[]>([])
const loading = ref(false)
const loadError = ref('')
const selectedCategoryId = ref<number | null>(null)

const payOpen = ref(false)
const selectedPlanId = ref<number | null>(null)
const selectedFromUserPlanId = ref<number | null>(null)

const primaryActivePlan = computed(() => (cloudAuth.plans || []).find(p => p.status === 'active') || null)
const planCategories = computed<PlanCategory[]>(() => {
  const map = new Map<number, PlanCategory>()
  for (const plan of plans.value) {
    const category = plan.category
    if (!category?.id || !category.name) continue
    map.set(category.id, {
      id: category.id,
      name: category.name,
      sort_order: category.sort_order,
    })
  }
  return Array.from(map.values()).sort((a, b) => {
    const bySort = Number(a.sort_order || 0) - Number(b.sort_order || 0)
    return bySort || a.id - b.id
  })
})
const filteredPlans = computed(() => {
  if (selectedCategoryId.value === null) return plans.value
  return plans.value.filter(plan => Number(plan.category_id || 0) === selectedCategoryId.value)
})

function goBack() {
  router.push('/user-center')
}

async function loadPlans() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await cloudClient.listStorePlans()
    plans.value = (data.plans || []) as StorePlan[]
  } catch (e: any) {
    loadError.value = e?.message || '加载失败'
  }
  loading.value = false
}

function canPurchase(p: StorePlan): boolean {
  if (Number(p.price) <= 0) return false
  // 永久套餐允许复购：已拥有时仍可再次购买（每次独立发放一份额度）
  return true
}

function purchaseLabel(p: StorePlan): string {
  if (Number(p.price) <= 0) return '不可在线购买'
  const current = currentUserPlan(p)
  if (current && !current.expires_at) return '再次购买'
  if (current) return '续费'
  if (primaryActivePlan.value) return '新购此套餐'
  return '立即购买'
}

function canUpgradeTo(p: StorePlan): boolean {
  return Number(p.price) > 0 && !!primaryActivePlan.value && !currentUserPlan(p)
}

function handleBuy(p: StorePlan) {
  if (!canPurchase(p)) return
  selectedPlanId.value = p.id
  selectedFromUserPlanId.value = null
  payOpen.value = true
}

function handleUpgrade(p: StorePlan) {
  if (!canUpgradeTo(p) || !primaryActivePlan.value) return
  selectedPlanId.value = p.id
  selectedFromUserPlanId.value = primaryActivePlan.value.id
  payOpen.value = true
}

function onPaid() {
  selectedFromUserPlanId.value = null
  cloudAuth.fetchCloudData().catch(() => {})
  loadPlans()
}

function formatPrice(v: string | number): string {
  const n = Number(v)
  if (Number.isNaN(n)) return '0.00'
  return n.toFixed(2)
}

function formatNum(v: number): string {
  if (!v) return '0'
  if (Number.isInteger(v)) return String(v)
  return Number(v).toFixed(2)
}

function currentUserPlan(p: StorePlan): any | null {
  return (cloudAuth.plans || []).find(up => up.status === 'active' && Number(up.plan_id) === Number(p.id)) || null
}

function formatDate(value?: string | null): string {
  if (!value) return ''
  try {
    const d = new Date(value)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  } catch {
    return value
  }
}

function refillLabel(value?: string): string {
  return value === 'monthly' ? '月度续充' : '一次性'
}

onMounted(() => {
  cloudAuth.fetchCloudData().catch(() => {})
  loadPlans()
})
</script>
