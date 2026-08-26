// 电商生图计费：估算云端模型消耗 + 余额不足前置拦截。
//
// 逻辑对齐现有「AI 生图」(ImageGenView)：
//  - 桌面端自定义模型（providerId !== 'cloud:default'）不计费，估算为 0；
//  - 云端模型按云控端下发的 billingRule.credit_per_call × 张数 估算；
//  - 余额不足时弹出 LowBalanceModal（暴露 lowBalanceOpen / lowBalanceState 供绑定）。

import { ref } from 'vue'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { parseCompositeKey } from '@shared/model-id'

export interface CostEstimate {
  balanceType: string
  amount: number
}

export function useImageBilling() {
  const cloudAuth = useCloudAuthStore()
  const lowBalanceOpen = ref(false)
  const lowBalanceState = ref({ balanceType: 'credit', required: 0, available: 0 })

  /** 命中云端模型的计费规则；本地模型 / 未登录返回 null（即不计费）。 */
  function effectiveBillingRule(providerId: string, modelKey: string): any | null {
    if (providerId !== 'cloud:default' || !modelKey) return null
    const { modelId: pure, providerName } = parseCompositeKey(modelKey)
    const cloudModel = cloudAuth.models.find((m: any) => {
      if (m.model_id !== pure) return false
      return providerName ? m.provider_name === providerName : true
    })
    return (
      cloudAuth.billingRules.find((r: any) => Number(r.cloud_model_id) === Number(cloudModel?.id)) ||
      cloudAuth.billingRules.find((r: any) => r.model_id === pure) ||
      null
    )
  }

  /** 估算本次生成的消耗（张数 × 单价）。 */
  function estimateImageCost(providerId: string, modelKey: string, count: number): CostEstimate {
    const rule = effectiveBillingRule(providerId, modelKey)
    if (!rule) return { balanceType: 'credit', amount: 0 }
    return {
      balanceType: 'credit',
      amount: Number(rule.credit_per_call || 0) * Math.max(1, Number(count || 1)),
    }
  }

  function availableBalance(type: string): number {
    return Number(
      cloudAuth.quotas?.balances?.[type]?.total ??
        cloudAuth.balances.find((b: any) => b.type === type)?.amount ??
        0,
    )
  }

  /** 纯计算：返回本次预计消耗与可用余额，不产生任何副作用（供需要自定弹窗/中止逻辑的调用方）。 */
  function checkBalance(
    providerId: string,
    modelKey: string,
    count: number,
  ): { ok: boolean; balanceType: string; required: number; available: number } {
    const estimate = estimateImageCost(providerId, modelKey, count)
    const available = availableBalance(estimate.balanceType)
    return {
      ok: estimate.amount <= 0 || available + 0.000001 >= estimate.amount,
      balanceType: estimate.balanceType,
      required: estimate.amount,
      available,
    }
  }

  /** 余额是否足够；不足则置位 lowBalanceState 并打开弹窗，返回 false。 */
  function ensureEnoughBalance(providerId: string, modelKey: string, count: number): boolean {
    const estimate = estimateImageCost(providerId, modelKey, count)
    if (estimate.amount <= 0) return true
    const available = availableBalance(estimate.balanceType)
    if (available + 0.000001 >= estimate.amount) return true
    lowBalanceState.value = {
      balanceType: estimate.balanceType,
      required: estimate.amount,
      available,
    }
    lowBalanceOpen.value = true
    return false
  }

  return { lowBalanceOpen, lowBalanceState, estimateImageCost, checkBalance, ensureEnoughBalance }
}
