import type { AppBalance, AppPlan } from '@zihui/contracts'
import { appV1Client } from '../v1-client'
import { USE_MOCK } from '../config'

export interface MobilePlan {
  id: number | string
  code: string
  name: string
  description: string
  price: number
  currency: string
  durationDays: number
  tokenQuota: number
  creditQuota: number
  originPrice?: number
  perDay?: string
  badge?: string
  recommend?: boolean
}

export interface MobileVipTier {
  key: string
  name: string
  slogan: string
  benefits: string[]
  plans: MobilePlan[]
  beanTip: string
  agreement: string
  cta: { title: string; sub: string }
}

export interface BillingSnapshot {
  tiers: MobileVipTier[]
  balances: AppBalance[]
}

function toMobilePlan(plan: AppPlan): MobilePlan {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    price: Number(plan.price),
    currency: plan.currency || 'CNY',
    durationDays: Number(plan.duration_days),
    tokenQuota: Number(plan.token_quota),
    creditQuota: Number(plan.credit_quota),
  }
}

function groupProductionPlans(plans: AppPlan[]): MobileVipTier[] {
  if (!plans.length) return []
  const mapped = plans.map(toMobilePlan)
  return [
    {
      key: 'available',
      name: '可用套餐',
      slogan: '按需选择创作额度',
      benefits: [],
      plans: mapped,
      beanTip: '额度与有效期以服务端返回为准',
      agreement: '套餐详情与服务条款以服务端展示为准',
      cta: { title: '购买功能尚未开放', sub: '支付能力尚未开放' },
    },
  ]
}

/**
 * 套餐与余额 facade。Mock 通过动态 import 保持开发视觉基线，生产只调用 App v1。
 */
export async function getBillingSnapshot(isAuthenticated: boolean): Promise<BillingSnapshot> {
  if (USE_MOCK) {
    const mock = await import('../mock/data')
    const tiers = mock.vipTiers.map((tier) => ({
      key: tier.key,
      name: tier.name,
      slogan: tier.slogan,
      benefits: tier.benefits,
      plans: tier.plans.map((plan, index) => ({
        id: `${tier.key}-${plan.key}`,
        code: `${tier.key}_${plan.key}`,
        name: plan.name,
        description: plan.perDay,
        price: Number(plan.price),
        currency: 'CNY',
        durationDays: plan.key === 'year' ? 365 : plan.key === 'quarter' ? 90 : 30,
        tokenQuota: 0,
        creditQuota: 0,
        originPrice: Number(plan.originPrice),
        perDay: plan.perDay,
        badge: plan.badge,
        recommend: plan.recommend,
      })),
      beanTip: tier.beanTip,
      agreement: tier.agreement,
      cta: tier.cta,
    }))
    return { tiers, balances: [] }
  }

  const plans = await appV1Client.plans()
  let balances: AppBalance[] = []
  if (isAuthenticated) {
    try {
      balances = await appV1Client.balance()
    } catch {
      // A stale/expired token must not hide public plans; a later auth-state
      // change can retry the protected balance request.
      balances = []
    }
  }
  return { tiers: groupProductionPlans(plans), balances }
}

export function balanceTotal(balances: AppBalance[], type: AppBalance['type'] = 'credit'): number {
  return balances.find((balance) => balance.type === type)?.total || 0
}
