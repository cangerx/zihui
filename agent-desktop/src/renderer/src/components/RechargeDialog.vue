<template>
  <Transition name="fade">
    <div v-if="visible" class="fixed inset-0 z-[9700] flex items-center justify-center pointer-events-none">
      <div class="pointer-events-auto w-[440px] max-w-[92vw] bg-surface-0 border border-surface-3 rounded-2xl shadow-2xl overflow-hidden">
        <div class="flex items-center justify-between px-5 py-3 border-b border-surface-2">
          <h3 class="text-sm font-semibold text-text-primary">充值{{ balanceLabel }}</h3>
          <button type="button" class="text-text-tertiary hover:text-text-primary" :disabled="creating" @click="handleClose">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div class="px-6 py-5">
          <div v-if="(!status || status === 'pending') && availableMethodCount >= 2" class="grid gap-2 mb-4" :class="availableMethodCount >= 3 ? 'grid-cols-3' : 'grid-cols-2'">
            <button v-if="siteConfig.payment.wechat" type="button" class="py-2 text-xs font-medium rounded-lg border transition-colors" :class="paymentMethod === 'wechat' ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-surface-3 text-text-secondary hover:bg-surface-2'" :disabled="creating || switching" @click="switchMethod('wechat')">微信支付</button>
            <button v-if="siteConfig.payment.tianque" type="button" class="py-2 text-xs font-medium rounded-lg border transition-colors" :class="paymentMethod === 'tianque' ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-surface-3 text-text-secondary hover:bg-surface-2'" :disabled="creating || switching" @click="switchMethod('tianque')">微信/支付宝</button>
            <button v-if="siteConfig.payment.xunhupay" type="button" class="py-2 text-xs font-medium rounded-lg border transition-colors" :class="paymentMethod === 'xunhupay' ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-surface-3 text-text-secondary hover:bg-surface-2'" :disabled="creating || switching" @click="switchMethod('xunhupay')">扫码支付</button>
          </div>

          <div v-if="availableMethodCount === 0" class="flex flex-col items-center justify-center py-10 text-center">
            <p class="text-sm font-semibold text-text-primary mb-1">暂无可用的支付方式</p>
            <p class="text-xs text-text-tertiary">请联系管理员开启支付通道</p>
            <button type="button" class="mt-5 px-5 py-2 text-xs font-medium border border-surface-3 rounded-lg text-text-secondary hover:bg-surface-2" @click="handleClose">关闭</button>
          </div>

          <div v-if="availableMethodCount > 0" class="flex items-baseline justify-between mb-4">
            <div class="min-w-0">
              <div class="text-sm font-semibold text-text-primary truncate">充值{{ balanceLabel }}</div>
              <div class="text-[11px] text-text-tertiary mt-0.5">
                到账 {{ formatNum(info.base) }}<span v-if="info.bonus > 0" class="text-green-600"> + 赠 {{ formatNum(info.bonus) }}</span> = {{ formatNum(info.total) }} {{ balanceLabel }}
              </div>
            </div>
            <div class="text-right">
              <div class="text-2xl font-bold text-primary-600">{{ formatAmount(amount) }}</div>
              <div class="text-[10px] text-text-tertiary">{{ currency }}</div>
            </div>
          </div>

          <div v-if="creating && availableMethodCount > 0" class="flex flex-col items-center justify-center py-10 text-xs text-text-tertiary">
            <svg class="w-6 h-6 animate-spin text-primary-600 mb-2" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path></svg>
            正在创建订单...
          </div>
          <div v-else-if="createError" class="bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300 rounded-lg px-3 py-2.5 text-xs">{{ createError }}</div>
          <template v-else-if="codeUrl && status === 'pending'">
            <div class="flex justify-center mb-3"><div class="bg-white p-3 rounded-xl border border-surface-3"><canvas ref="qrCanvas" class="block" width="240" height="240"></canvas></div></div>
            <p class="text-center text-xs text-text-secondary mb-1">{{ scanHint }}</p>
            <p class="text-center text-[11px] text-text-tertiary">剩余 <span class="font-mono text-text-secondary">{{ countdownText }}</span></p>
            <div class="flex items-center justify-center gap-4 mt-3">
              <button type="button" class="text-[11px] text-text-tertiary hover:text-text-primary" :disabled="refreshing" @click="handleRefresh">刷新状态</button>
              <button type="button" class="text-[11px] text-text-tertiary hover:text-text-primary" :disabled="cancelling" @click="handleCancel">取消订单</button>
            </div>
            <p v-if="pollErrorTip" class="text-center text-[11px] text-amber-600 mt-2">{{ pollErrorTip }}</p>
          </template>
          <div v-else-if="status === 'paid'" class="flex flex-col items-center justify-center py-8 text-center">
            <div class="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mb-3"><svg class="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg></div>
            <p class="text-sm font-semibold text-text-primary mb-1">充值成功</p>
            <p class="text-xs text-text-tertiary">{{ balanceLabel }}已到账，即将关闭...</p>
          </div>
          <div v-else-if="status && status !== 'pending'" class="flex flex-col items-center justify-center py-8 text-center">
            <p class="text-sm font-semibold text-text-primary mb-1">{{ statusLabel(status) }}</p>
            <p class="text-xs text-text-tertiary mb-4">{{ statusHint(status) }}</p>
            <button type="button" class="px-5 py-2 text-xs font-medium border border-surface-3 rounded-lg text-text-secondary hover:bg-surface-2" @click="handleClose">关闭</button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import QRCode from 'qrcode'
import { cloudClient } from '@/utils/cloud-api'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useSiteConfigStore } from '@/stores/site-config'

interface RechargePayload {
  balance_type: string
  amount?: number
  package_id?: number
  base?: number
  bonus?: number
  total?: number
}

const props = defineProps<{
  visible: boolean
  payload: RechargePayload | null
}>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'paid'): void
}>()

const store = useCloudAuthStore()
const siteConfig = useSiteConfigStore()

const creating = ref(false)
const createError = ref('')
const orderNo = ref('')
const codeUrl = ref<string | null>(null)
const amount = ref('0.00')
const currency = ref('CNY')
const status = ref('')
const expiresAt = ref<string | null>(null)
const cancelling = ref(false)
const refreshing = ref(false)
const pollErrorTip = ref('')
const qrCanvas = ref<HTMLCanvasElement | null>(null)
const info = ref<{ base: number; bonus: number; total: number }>({ base: 0, bonus: 0, total: 0 })

const paymentMethod = ref<'wechat' | 'tianque' | 'xunhupay'>('wechat')
const switching = ref(false)

const balanceLabel = computed(() => (props.payload?.balance_type === 'token' ? siteConfig.labels.token : siteConfig.labels.credit))
const availableMethodCount = computed(() => {
  let n = 0
  if (siteConfig.payment.wechat) n++
  if (siteConfig.payment.tianque) n++
  if (siteConfig.payment.xunhupay) n++
  return n
})
const scanHint = computed(() => (paymentMethod.value === 'wechat' ? '请使用微信扫码支付' : paymentMethod.value === 'xunhupay' ? '请使用微信 / 支付宝 扫码支付' : '微信 / 支付宝 / 云闪付 / 数字人民币 扫码支付'))

let pollTimer: ReturnType<typeof setInterval> | null = null
let countdownTimer: ReturnType<typeof setInterval> | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null
let consecutiveFails = 0
const remainingMs = ref(0)

const countdownText = computed(() => {
  const ms = Math.max(0, remainingMs.value)
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60).toString().padStart(2, '0')
  const s = (total % 60).toString().padStart(2, '0')
  return `${m}:${s}`
})

function formatAmount(v: string | number): string {
  const n = Number(v)
  return Number.isNaN(n) ? '0.00' : n.toFixed(2)
}
function formatNum(v: number): string {
  if (!v) return '0'
  return Number.isInteger(v) ? String(v) : Number(v).toFixed(2)
}
function pickDefaultMethod(): 'wechat' | 'tianque' | 'xunhupay' | null {
  if (siteConfig.payment.wechat) return 'wechat'
  if (siteConfig.payment.tianque) return 'tianque'
  if (siteConfig.payment.xunhupay) return 'xunhupay'
  return null
}

function statusLabel(s: string): string {
  switch (s) {
    case 'closed': return '订单已关闭'
    case 'expired': return '订单已超时'
    case 'failed': return '订单失败'
    default: return s || '-'
  }
}
function statusHint(s: string): string {
  switch (s) {
    case 'closed': return '订单已被取消或关闭'
    case 'expired': return '订单已超时，请重新发起充值'
    case 'failed': return '订单创建失败，请稍后再试'
    default: return ''
  }
}

async function renderQrCode(text: string) {
  await nextTick()
  if (!qrCanvas.value) return
  try {
    await QRCode.toCanvas(qrCanvas.value, text, { width: 240, margin: 1, errorCorrectionLevel: 'M' })
  } catch {
    const ctx = qrCanvas.value.getContext('2d')
    ctx?.clearRect(0, 0, qrCanvas.value.width, qrCanvas.value.height)
  }
}

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer)
  if (!expiresAt.value) return
  const target = new Date(expiresAt.value).getTime()
  const tick = () => {
    remainingMs.value = target - Date.now()
    if (remainingMs.value <= 0) {
      remainingMs.value = 0
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
      handleRefresh()
    }
  }
  tick()
  countdownTimer = setInterval(tick, 1000)
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(async () => {
    if (!orderNo.value || status.value !== 'pending') return
    try {
      const data = paymentMethod.value === 'wechat'
        ? await cloudClient.getOrder(orderNo.value)
        : paymentMethod.value === 'xunhupay'
          ? await cloudClient.syncXunhupayOrder(orderNo.value)
          : await cloudClient.syncTianqueOrder(orderNo.value)
      consecutiveFails = 0
      pollErrorTip.value = ''
      applyOrderUpdate(data)
    } catch {
      consecutiveFails++
      if (consecutiveFails >= 5) {
        pollErrorTip.value = '网络异常，已暂停轮询。请点击刷新状态'
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
      }
    }
  }, 2000)
}

function applyOrderUpdate(data: any) {
  if (!data) return
  status.value = data.status
  if (data.recharge) {
    info.value = {
      base: Number(data.recharge.base_amount || 0),
      bonus: Number(data.recharge.bonus_amount || 0),
      total: Number(data.recharge.total_amount || 0),
    }
  }
  if (data.paid_at) {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
    store.fetchCloudData().catch(() => {})
    emit('paid')
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = setTimeout(() => handleClose(), 2500)
  } else if (data.status !== 'pending') {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
  }
}

async function handleRefresh() {
  if (!orderNo.value) return
  refreshing.value = true
  try {
    const data = paymentMethod.value === 'wechat'
      ? await cloudClient.getOrder(orderNo.value)
      : paymentMethod.value === 'xunhupay'
        ? await cloudClient.syncXunhupayOrder(orderNo.value)
        : await cloudClient.syncTianqueOrder(orderNo.value)
    pollErrorTip.value = ''
    consecutiveFails = 0
    applyOrderUpdate(data)
    if (status.value === 'pending' && !pollTimer) startPolling()
  } catch (e: any) {
    pollErrorTip.value = e?.message || '刷新失败'
  }
  refreshing.value = false
}

async function handleCancel() {
  if (!orderNo.value || cancelling.value) return
  cancelling.value = true
  try {
    if (paymentMethod.value === 'wechat') await cloudClient.cancelOrder(orderNo.value)
    status.value = 'closed'
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
  } catch (e: any) {
    pollErrorTip.value = e?.message || '取消失败'
  }
  cancelling.value = false
}

function cleanupTimers() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
}

function resetState() {
  creating.value = false
  createError.value = ''
  orderNo.value = ''
  codeUrl.value = null
  amount.value = '0.00'
  currency.value = 'CNY'
  status.value = ''
  expiresAt.value = null
  remainingMs.value = 0
  consecutiveFails = 0
  pollErrorTip.value = ''
  info.value = {
    base: Number(props.payload?.base || 0),
    bonus: Number(props.payload?.bonus || 0),
    total: Number(props.payload?.total || 0),
  }
}

function handleClose() {
  const closingOrderNo = orderNo.value
  const wasPending = status.value === 'pending'
  cleanupTimers()
  emit('update:visible', false)
  if (wasPending && closingOrderNo && paymentMethod.value === 'wechat') {
    void (async () => {
      try {
        const latest = await cloudClient.getOrder(closingOrderNo)
        if (latest?.status === 'pending') await cloudClient.cancelOrder(closingOrderNo).catch(() => {})
      } catch { /* 忽略，超期自动关闭 */ }
    })()
  }
}

async function switchMethod(m: 'wechat' | 'tianque' | 'xunhupay') {
  if (m === paymentMethod.value || switching.value || creating.value) return
  switching.value = true
  try {
    if (status.value === 'pending' && orderNo.value && paymentMethod.value === 'wechat') {
      void cloudClient.cancelOrder(orderNo.value).catch(() => {})
    }
    paymentMethod.value = m
    cleanupTimers()
    resetState()
    await ensureOrder()
  } finally {
    switching.value = false
  }
}

async function ensureOrder() {
  if (!props.payload) return
  const def = pickDefaultMethod()
  if (!def) { resetState(); return }
  if ((paymentMethod.value === 'wechat' && !siteConfig.payment.wechat) || (paymentMethod.value === 'tianque' && !siteConfig.payment.tianque) || (paymentMethod.value === 'xunhupay' && !siteConfig.payment.xunhupay)) {
    paymentMethod.value = def
  }
  resetState()
  creating.value = true
  try {
    const body: Record<string, any> = { balance_type: props.payload.balance_type }
    if (props.payload.package_id) body.package_id = props.payload.package_id
    else if (props.payload.amount) body.amount = props.payload.amount
    const data: any = paymentMethod.value === 'wechat'
      ? await cloudClient.createRechargeOrder(body)
      : paymentMethod.value === 'xunhupay'
        ? await cloudClient.createRechargeOrderXunhupay(body)
        : await cloudClient.createRechargeOrderTianque(body)
    orderNo.value = data.order_no
    codeUrl.value = data.code_url
    amount.value = data.amount
    currency.value = data.currency || 'CNY'
    status.value = data.status || 'pending'
    expiresAt.value = data.expires_at
    if (data.recharge) {
      info.value = {
        base: Number(data.recharge.base_amount || 0),
        bonus: Number(data.recharge.bonus_amount || 0),
        total: Number(data.recharge.total_amount || 0),
      }
    }
  } catch (e: any) {
    createError.value = e?.message || '创建订单失败'
  } finally {
    creating.value = false
  }

  if (codeUrl.value && status.value === 'pending') {
    await renderQrCode(codeUrl.value)
    startCountdown()
    startPolling()
  } else if (status.value === 'paid') {
    applyOrderUpdate({ status: 'paid', paid_at: new Date().toISOString() })
  }
}

watch(() => props.visible, async (v) => {
  if (v) await ensureOrder()
  else { cleanupTimers(); resetState() }
})

onUnmounted(() => cleanupTimers())
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }
</style>
