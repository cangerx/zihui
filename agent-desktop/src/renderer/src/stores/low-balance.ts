import { defineStore } from 'pinia'
import { ref } from 'vue'

// 全局「余额不足」弹窗状态：任何云端调用命中 402 时，由 cloud-api 派发 cloud-low-balance
// 事件 → main.ts 监听 → 打开此 store → MainLayout 里常驻的 LowBalanceModal 统一展示。
// 这样零散页面无需各自接 LowBalanceModal 即可获得充值引导。
export const useLowBalanceStore = defineStore('lowBalance', () => {
  const visible = ref(false)
  const balanceType = ref<'token' | 'credit'>('credit')
  const required = ref(0)
  const available = ref(0)

  function open(detail?: { balanceType?: string; required?: number; available?: number }): void {
    balanceType.value = detail?.balanceType === 'token' ? 'token' : 'credit'
    required.value = Number(detail?.required || 0)
    available.value = Number(detail?.available || 0)
    visible.value = true
  }

  function close(): void {
    visible.value = false
  }

  return { visible, balanceType, required, available, open, close }
})
