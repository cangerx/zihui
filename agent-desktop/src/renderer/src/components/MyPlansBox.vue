<template>
  <div class="card p-5">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-sm font-semibold text-text-primary">我的套餐</h3>
      <span class="text-[10px] text-text-tertiary">{{ activePlans.length }} 个生效</span>
    </div>

    <div v-if="!plans.length" class="text-xs text-text-tertiary py-4 text-center">
      暂无套餐
    </div>

    <div v-else class="space-y-3">
      <ul v-if="visiblePlans.length" class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <li
          v-for="p in visiblePlans"
          :key="p.id"
          class="bg-surface-1 rounded-xl p-3 border border-surface-3"
        >
          <div class="flex items-start justify-between gap-3 mb-2">
            <div class="min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-sm font-semibold text-text-primary truncate">{{ p.plan_name }}</span>
              </div>
              <ExpandableText v-if="p.description" :text="p.description" :lines="1" />
            </div>
            <span :class="['text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap', statusClass(effectiveStatus(p))]">
              {{ statusLabel(effectiveStatus(p)) }}
            </span>
          </div>

          <div class="grid grid-cols-2 gap-2 mt-2 text-[11px]">
            <div>
              <span class="text-text-tertiary">来源</span>
              <span class="text-text-primary ml-1">{{ sourceLabel(p.source) }}</span>
            </div>
            <div>
              <span class="text-text-tertiary">{{ p.expires_at ? '剩余' : '有效期' }}</span>
              <span
                v-if="!p.expires_at"
                class="text-text-primary ml-1"
                :title="p.activated_at ? `开通于 ${formatDate(p.activated_at)}` : ''"
              >永久有效</span>
              <span
                v-else
                :class="['ml-1 font-medium', remainingClass(p.expires_at, p.status)]"
                :title="`到期：${formatDate(p.expires_at)}`"
              >{{ remainingText(p.expires_at, p.status) }}</span>
            </div>
            <div v-if="p.token_granted > 0">
              <span class="text-text-tertiary">{{ siteConfig.labels.token }}额度</span>
              <span class="text-text-primary ml-1">{{ formatAmount(p.token_granted) }}</span>
            </div>
            <div v-if="p.credit_granted > 0">
              <span class="text-text-tertiary">{{ siteConfig.labels.credit }}额度</span>
              <span class="text-text-primary ml-1">{{ formatAmount(p.credit_granted) }}</span>
            </div>
            <div>
              <span class="text-text-tertiary">续充</span>
              <span class="text-text-primary ml-1">{{ refillLabel(p.quota_refill_cycle) }}</span>
            </div>
            <div v-if="p.next_quota_refill_at">
              <span class="text-text-tertiary">下次续充</span>
              <span class="text-text-primary ml-1">{{ formatDate(p.next_quota_refill_at) }}</span>
            </div>
          </div>

          <div v-if="p.quota_summary" class="mt-2 space-y-2">
            <QuotaProgressBar
              v-for="item in quotaItems(p)"
              :key="item.type"
              :label="item.label"
              :used="item.consumed"
              :total="item.granted"
              :remaining="item.remaining"
            />
          </div>

          <div v-if="p.policies" class="mt-2">
            <PolicyBadgeList :policies="p.policies" :limit="6" />
          </div>

          <div v-if="p.models?.length" class="mt-2">
            <div class="text-[10px] text-text-tertiary mb-1">包含模型</div>
            <div class="flex flex-wrap gap-1">
              <span
                v-for="m in p.models"
                :key="m.id"
                class="text-[10px] bg-surface-2 text-text-secondary px-2 py-0.5 rounded"
              >
                {{ m.name || m.model_id }}
              </span>
            </div>
          </div>
        </li>
      </ul>

      <button
        v-if="inactivePlans.length"
        type="button"
        class="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-surface-3 bg-surface-1 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors"
        @click="showInactivePlans = !showInactivePlans"
      >
        <span>{{ showInactivePlans ? '收起失效套餐' : `已折叠 ${inactivePlans.length} 个失效套餐` }}</span>
        <span class="text-[10px] text-text-tertiary">{{ showInactivePlans ? '收起' : '展开' }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useSiteConfigStore } from '@/stores/site-config'
import QuotaProgressBar from '@/components/QuotaProgressBar.vue'
import PolicyBadgeList from '@/components/PolicyBadgeList.vue'
import ExpandableText from '@/components/ExpandableText.vue'
import type { MyPlan } from '@/stores/cloud-auth'

const store = useCloudAuthStore()
const siteConfig = useSiteConfigStore()
const showInactivePlans = ref(false)

const plans = computed<MyPlan[]>(() => store.plans || [])
const activePlans = computed(() => plans.value.filter(isActivePlan))
const inactivePlans = computed(() => plans.value.filter(p => !isActivePlan(p)))
const visiblePlans = computed(() => showInactivePlans.value ? [...activePlans.value, ...inactivePlans.value] : activePlans.value)

function isActivePlan(plan: MyPlan): boolean {
  if (plan.status !== 'active') return false
  if (!plan.expires_at) return true
  return new Date(plan.expires_at).getTime() > Date.now()
}

/**
 * 展示用「有效状态」：存储的 status 字段靠云端每小时一次的定时任务才翻转，
 * 到期后短时间内（桌面端甚至更久，因 plans 不随余额轮询刷新）仍是 'active'。
 * 这里按 expires_at 实时派生，避免徽标显示「生效中」绿标与同卡片「已过期」自相矛盾。
 */
function effectiveStatus(plan: MyPlan): string {
  if (
    plan.status === 'active' &&
    plan.expires_at &&
    new Date(plan.expires_at).getTime() <= Date.now()
  ) {
    return 'expired'
  }
  return plan.status
}

function statusClass(status: string): string {
  switch (status) {
    case 'active':  return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
    case 'expired': return 'bg-surface-2 text-text-tertiary'
    case 'revoked': return 'bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-300'
    default:        return 'bg-surface-2 text-text-tertiary'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'active':  return '生效中'
    case 'expired': return '已过期'
    case 'revoked': return '已撤销'
    case 'invalid':
    case 'inactive':
    case 'disabled': return '已失效'
    default:        return status
  }
}

function sourceLabel(src: string): string {
  switch (src) {
    case 'purchase': return '购买'
    case 'redeem':   return '兑换码'
    case 'admin':    return '后台发放'
    case 'register': return '注册赠送'
    case 'upgrade':  return '升级'
    default:         return src
  }
}

function refillLabel(value?: string): string {
  return value === 'monthly' ? '月度续充' : '一次性'
}

function quotaItems(plan: MyPlan) {
  return Object.entries(plan.quota_summary || {})
    .filter(([, value]) => Number(value.granted || 0) > 0)
    .map(([type, value]) => ({
      type,
      label: `${siteConfig.labelOf(type)}使用`,
      granted: Number(value.granted || 0),
      consumed: Number(value.consumed || 0),
      remaining: Number(value.remaining || 0),
    }))
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  } catch { return iso }
}

/**
 * 把到期 ISO 时间转成相对剩余时间（还剩 X 天 / 小时 / 分钟），过期返回"已过期"。
 * status 已是 expired/revoked 时直接返回对应文案，避免与时间计算错位。
 */
function remainingText(iso: string, status: string): string {
  if (status === 'expired') return '已过期'
  if (status === 'revoked') return '已撤销'
  const expires = new Date(iso).getTime()
  if (Number.isNaN(expires)) return '-'
  const diff = expires - Date.now()
  if (diff <= 0) return '已过期'
  const days = Math.floor(diff / 86400000)
  if (days >= 1) return `还剩 ${days} 天`
  const hours = Math.floor(diff / 3600000)
  if (hours >= 1) return `还剩 ${hours} 小时`
  const minutes = Math.max(1, Math.floor(diff / 60000))
  return `还剩 ${minutes} 分钟`
}

/**
 * 剩余时间文本配色：>7 天主色文，3-7 天琥珀，<3 天红色，已过期 / 已撤销 灰色。
 * 与「最近到期预警行」的阈值保持一致。
 */
function remainingClass(iso: string, status: string): string {
  if (status !== 'active') return 'text-text-tertiary'
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'text-text-tertiary'
  const days = diff / 86400000
  if (days >= 7) return 'text-text-primary'
  if (days >= 3) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-500 dark:text-red-400'
}

function formatAmount(value: number | string): string {
  const n = Number(value)
  if (Number.isNaN(n)) return '0'
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2)
}
</script>
