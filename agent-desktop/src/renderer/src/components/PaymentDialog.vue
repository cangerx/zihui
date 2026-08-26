<template>
  <Transition name="fade">
    <div
      v-if="visible"
      class="fixed inset-0 z-[9700] flex items-center justify-center pointer-events-none"
    >
      <div
        class="pointer-events-auto w-[440px] max-w-[92vw] bg-surface-0 border border-surface-3 rounded-2xl shadow-2xl overflow-hidden"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3 border-b border-surface-2">
          <h3 class="text-sm font-semibold text-text-primary">{{ dialogTitle }}</h3>
          <button
            type="button"
            class="text-text-tertiary hover:text-text-primary"
            :disabled="creating"
            @click="handleClose"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="px-6 py-5">
          <!-- 支付方式切换器：pending 状态下可切换，已支付或已关闭后隐藏；有 2 个及以上可用渠道时显示 -->
          <div
            v-if="(!status || status === 'pending') && availableMethodCount >= 2"
            class="grid gap-2 mb-4"
            :class="availableMethodCount >= 3 ? 'grid-cols-3' : 'grid-cols-2'"
          >
            <button
              v-if="siteConfig.payment.wechat"
              type="button"
              class="py-2 text-xs font-medium rounded-lg border transition-colors"
              :class="paymentMethod === 'wechat'
                ? 'border-primary-600 bg-primary-50 text-primary-700'
                : 'border-surface-3 text-text-secondary hover:bg-surface-2'"
              :disabled="creating || switching"
              @click="switchMethod('wechat')"
            >
              微信支付
            </button>
            <button
              v-if="siteConfig.payment.tianque"
              type="button"
              class="py-2 text-xs font-medium rounded-lg border transition-colors"
              :class="paymentMethod === 'tianque'
                ? 'border-primary-600 bg-primary-50 text-primary-700'
                : 'border-surface-3 text-text-secondary hover:bg-surface-2'"
              :disabled="creating || switching"
              @click="switchMethod('tianque')"
            >
              微信/支付宝
            </button>
            <button
              v-if="siteConfig.payment.xunhupay"
              type="button"
              class="py-2 text-xs font-medium rounded-lg border transition-colors"
              :class="paymentMethod === 'xunhupay'
                ? 'border-primary-600 bg-primary-50 text-primary-700'
                : 'border-surface-3 text-text-secondary hover:bg-surface-2'"
              :disabled="creating || switching"
              @click="switchMethod('xunhupay')"
            >
              扫码支付
            </button>
          </div>

          <!-- 都未启用：占位提示，不再尝试创建订单 -->
          <div
            v-if="availableMethodCount === 0"
            class="flex flex-col items-center justify-center py-10 text-center"
          >
            <div class="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mb-3">
              <svg class="w-6 h-6 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p class="text-sm font-semibold text-text-primary mb-1">暂无可用的支付方式</p>
            <p class="text-xs text-text-tertiary">请联系管理员开启支付通道</p>
            <button
              type="button"
              class="mt-5 px-5 py-2 text-xs font-medium border border-surface-3 rounded-lg text-text-secondary hover:bg-surface-2 transition-colors"
              @click="handleClose"
            >
              关闭
            </button>
          </div>

          <!-- Plan summary（仅在有可用渠道时渲染，避免「都未启用」时显示空 plan） -->
          <div v-if="availableMethodCount > 0" class="flex items-baseline justify-between mb-4">
            <div class="min-w-0">
              <div class="text-sm font-semibold text-text-primary truncate">{{ plan?.name || '加载中...' }}</div>
              <div class="text-[11px] text-text-tertiary mt-0.5">
                {{ plan?.duration_days ? plan.duration_days === 0 ? '永久' : `${plan.duration_days} 天` : '' }}
              </div>
            </div>
            <div class="text-right">
              <div class="text-2xl font-bold text-primary-600">{{ formatAmount(amount) }}</div>
              <div class="text-[10px] text-text-tertiary">{{ currency }}</div>
            </div>
          </div>

          <!-- Loading（创建订单中） -->
          <div
            v-if="creating && availableMethodCount > 0"
            class="flex flex-col items-center justify-center py-10 text-xs text-text-tertiary"
          >
            <svg class="w-6 h-6 animate-spin text-primary-600 mb-2" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
            </svg>
            正在创建订单...
          </div>

          <!-- Error（创建失败） -->
          <div
            v-else-if="createError"
            class="bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300 rounded-lg px-3 py-2.5 text-xs"
          >
            {{ createError }}
          </div>

          <!-- QR Code area -->
          <template v-else-if="codeUrl && status === 'pending'">
            <div class="flex justify-center mb-3">
              <div class="bg-white p-3 rounded-xl border border-surface-3">
                <canvas ref="qrCanvas" class="block" width="240" height="240"></canvas>
              </div>
            </div>
            <p class="text-center text-xs text-text-secondary mb-1">
              {{ scanHint }}
            </p>
            <p class="text-center text-[11px] text-text-tertiary">
              剩余 <span class="font-mono text-text-secondary">{{ countdownText }}</span>
            </p>
          </template>

          <!-- Success -->
          <div
            v-else-if="status === 'paid'"
            class="flex flex-col items-center justify-center py-8 text-center"
          >
            <div class="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center mb-3">
              <svg class="w-6 h-6 text-emerald-600 dark:text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p class="text-sm font-semibold text-text-primary mb-1">支付成功</p>
            <p class="text-xs text-text-tertiary">{{ successHint }}</p>
          </div>

          <!-- Expired / Closed / Failed -->
          <div
            v-else-if="status && status !== 'pending'"
            class="flex flex-col items-center justify-center py-8 text-center"
          >
            <div class="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mb-3">
              <svg class="w-6 h-6 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p class="text-sm font-semibold text-text-primary mb-1">{{ statusLabel(status) }}</p>
            <p class="text-xs text-text-tertiary">{{ statusHint(status) }}</p>
          </div>

          <!-- Order info & actions -->
          <div v-if="orderNo" class="mt-4 pt-4 border-t border-surface-2">
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-text-tertiary">订单号</span>
              <div class="flex items-center gap-1.5">
                <span class="font-mono text-text-secondary">{{ orderNo }}</span>
                <button
                  type="button"
                  class="text-text-tertiary hover:text-text-primary"
                  :title="copyTip || '复制'"
                  @click="copyOrderNo"
                >
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </div>

            <div v-if="reused" class="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
              已复用未完成订单
            </div>

            <div v-if="pollErrorTip" class="mt-2 text-[11px] text-red-500 dark:text-red-400">
              {{ pollErrorTip }}
            </div>

            <div class="flex gap-2 mt-4" v-if="status === 'pending'">
              <button
                type="button"
                class="flex-1 py-2 text-xs font-medium border border-surface-3 rounded-lg text-text-secondary hover:bg-surface-2 transition-colors"
                @click="handleCancel"
                :disabled="cancelling"
              >
                {{ cancelling ? '取消中...' : '取消订单' }}
              </button>
              <button
                type="button"
                class="flex-1 py-2 text-xs font-medium border border-surface-3 rounded-lg text-text-secondary hover:bg-surface-2 transition-colors"
                @click="handleRefresh"
                :disabled="refreshing"
              >
                {{ refreshing ? '刷新中...' : '刷新状态' }}
              </button>
            </div>
            <div class="flex mt-4" v-else>
              <button
                type="button"
                class="flex-1 py-2 text-xs font-medium bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
                @click="handleClose"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, nextTick, computed } from 'vue'
import QRCode from 'qrcode'
import { cloudClient } from '@/utils/cloud-api'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useSiteConfigStore } from '@/stores/site-config'

interface PlanLite {
  id: number
  code: string
  name: string
  duration_days: number
  quota_refill_cycle?: string
}

interface OrderResponse {
  order_no: string
  amount: string
  currency: string
  code_url: string | null
  expires_at: string | null
  paid_at?: string | null
  closed_at?: string | null
  status: string
  user_plan_id: number | null
  order_type?: string
  upgrade_from_user_plan_id?: number | null
  plan: PlanLite
  reused?: boolean
}

const props = defineProps<{
  visible: boolean
  planId: number | null
  fromUserPlanId?: number | null
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
const status = ref<string>('')
const orderType = ref<string>('')
const expiresAt = ref<string | null>(null)
const reused = ref(false)
const plan = ref<PlanLite | null>(null)
const cancelling = ref(false)
const refreshing = ref(false)
const copyTip = ref('')
const pollErrorTip = ref('')
const qrCanvas = ref<HTMLCanvasElement | null>(null)

// 支付方式：微信走 Native 扫码，天阙走聚合主扫（同一二维码支持多渠道）。
// 实际可选项由 siteConfig.payment.{wechat,tianque} 决定（云控后台开关）。
const paymentMethod = ref<'wechat' | 'tianque' | 'xunhupay'>('wechat')
const switching = ref(false)
const isUpgrade = computed(() => !!props.fromUserPlanId)

const availableMethodCount = computed(() => {
  let n = 0
  if (siteConfig.payment.wechat) n++
  if (siteConfig.payment.tianque) n++
  if (siteConfig.payment.xunhupay) n++
  return n
})

/** 选首个启用的渠道作为默认值（拉取 publicConfig 后调用） */
function pickDefaultMethod(): 'wechat' | 'tianque' | 'xunhupay' | null {
  if (siteConfig.payment.wechat) return 'wechat'
  if (siteConfig.payment.tianque) return 'tianque'
  if (siteConfig.payment.xunhupay) return 'xunhupay'
  return null
}

const dialogTitle = computed(() => {
  if (orderType.value === 'renew') return '续费套餐'
  if (isUpgrade.value || orderType.value === 'upgrade') return '升级套餐'
  return methodTitle.value
})
const methodTitle = computed(() =>
  paymentMethod.value === 'wechat' ? '微信支付' : '微信/支付宝'
)
const successHint = computed(() => {
  if (orderType.value === 'renew') return '套餐已续费，即将关闭...'
  if (isUpgrade.value || orderType.value === 'upgrade') return '套餐已升级，即将关闭...'
  return '套餐已开通，即将关闭...'
})
const scanHint = computed(() =>
  paymentMethod.value === 'wechat'
    ? '请使用微信扫码支付'
    : paymentMethod.value === 'xunhupay'
      ? '请使用微信 / 支付宝 扫码支付'
      : '微信 / 支付宝 / 云闪付 / 数字人民币 扫码支付'
)

let pollTimer: ReturnType<typeof setInterval> | null = null
let countdownTimer: ReturnType<typeof setInterval> | null = null
let consecutiveFails = 0
let closeTimer: ReturnType<typeof setTimeout> | null = null
let inflightOrderKey: string | null = null

const remainingMs = ref(0)

const countdownText = computed(() => {
  const ms = Math.max(0, remainingMs.value)
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60).toString().padStart(2, '0')
  const s = (total % 60).toString().padStart(2, '0')
  return `${m}:${s}`
})

function formatAmount(value: string | number): string {
  const n = Number(value)
  if (Number.isNaN(n)) return '0.00'
  return n.toFixed(2)
}

function statusLabel(s: string): string {
  switch (s) {
    case 'pending':  return '等待支付'
    case 'paid':     return '支付成功'
    case 'closed':   return '订单已关闭'
    case 'expired':  return '订单已超时'
    case 'failed':   return '订单失败'
    case 'refunded': return '订单已退款'
    default:         return s || '-'
  }
}

function statusHint(s: string): string {
  switch (s) {
    case 'closed':  return '订单已被取消或关闭'
    case 'expired': return '订单已超时，请重新发起购买'
    case 'failed':  return '订单创建失败，请稍后再试'
    default:        return ''
  }
}

async function copyOrderNo() {
  if (!orderNo.value) return
  try {
    await navigator.clipboard.writeText(orderNo.value)
    copyTip.value = '已复制'
    setTimeout(() => (copyTip.value = ''), 1500)
  } catch {
    copyTip.value = '复制失败'
    setTimeout(() => (copyTip.value = ''), 1500)
  }
}

async function renderQrCode(text: string) {
  await nextTick()
  if (!qrCanvas.value) return
  try {
    await QRCode.toCanvas(qrCanvas.value, text, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
  } catch (e) {
    // 渲染失败时不阻塞流程，仅清空画布
    const ctx = qrCanvas.value.getContext('2d')
    ctx?.clearRect(0, 0, qrCanvas.value.width, qrCanvas.value.height)
  }
}

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer)
  if (!expiresAt.value) return
  const targetTs = new Date(expiresAt.value).getTime()
  const tick = () => {
    remainingMs.value = targetTs - Date.now()
    if (remainingMs.value <= 0) {
      remainingMs.value = 0
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
      // L3: 同时停掉 pollTimer 避免与 refresh 并发两个 getOrder 请求
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
      // 倒计时归零后触发一次刷新让后端把状态切到 expired
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
      // 微信：被动轮询本地状态（服务端有异步 notify 同步）
      // 天阙：主动调同步接口推动服务端查天阙 + 同步本地
      // 虎皮椒：有异步 notify，但同时主动 sync 兜底（notify 未达时仍能结算）
      const data = paymentMethod.value === 'wechat'
        ? await cloudClient.getOrder(orderNo.value)
        : paymentMethod.value === 'xunhupay'
          ? await cloudClient.syncXunhupayOrder(orderNo.value)
          : await cloudClient.syncTianqueOrder(orderNo.value)
      consecutiveFails = 0
      pollErrorTip.value = ''
      applyOrderUpdate(data)
    } catch (e) {
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
  if (data.paid_at) {
    // 支付成功
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
    // 后台同步刷新一次套餐与余额数据
    store.fetchCloudData().catch(() => {})
    emit('paid')
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = setTimeout(() => handleClose(), 2500)
  } else if (data.status !== 'pending') {
    // closed / expired / failed
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
    // 若之前因失败暂停了轮询，恢复
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
    if (paymentMethod.value === 'wechat') {
      await cloudClient.cancelOrder(orderNo.value)
    }
    // 天阙暂无 cancel 接口：订单 15 分钟后自动过期，本地直接标记关闭
    status.value = 'closed'
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
  } catch (e: any) {
    pollErrorTip.value = e?.message || '取消失败'
  }
  cancelling.value = false
}

function handleClose() {
  // M1: 订单仍为 pending 时视为“用户放弃”，开始异步 cancel（先复查一次避免与回调竞态）
  const closingOrderNo = orderNo.value
  const wasPending = status.value === 'pending'
  cleanupTimers()
  emit('update:visible', false)

  if (wasPending && closingOrderNo) {
    const closingMethod = paymentMethod.value
    // 天阙暂无 cancel 接口，依赖服务端 15 分钟过期机制，不需 fire-and-forget
    if (closingMethod === 'wechat') {
      // fire-and-forget：检查最新状态、仅当仍是 pending 时 cancel
      void (async () => {
        try {
          const latest = await cloudClient.getOrder(closingOrderNo)
          if (latest?.status === 'pending') {
            await cloudClient.cancelOrder(closingOrderNo).catch(() => {})
          }
        } catch { /* 网络错误忽略，订单超期后会被定时任务关闭 */ }
      })()
    }
  }
}

/**
 * 支付方式切换：如现有 pending 订单先关闭，然后重新创建。
 * 避免同一用户同一 plan 同时有两个未完成订单。
 */
async function switchMethod(m: 'wechat' | 'tianque' | 'xunhupay') {
  if (m === paymentMethod.value || switching.value || creating.value) return
  switching.value = true
  try {
    // 如果有未完成订单，先关掉（避免不同渠道留两个 pending 订单）
    if (status.value === 'pending' && orderNo.value) {
      const closingOrderNo = orderNo.value
      const closingMethod = paymentMethod.value
      void (async () => {
        if (closingMethod === 'wechat') {
          await cloudClient.cancelOrder(closingOrderNo).catch(() => {})
        }
        // 天阙：走服务端过期自清
      })()
    }
    paymentMethod.value = m
    cleanupTimers()
    resetState()
    if (props.planId) await ensureOrder()
  } finally {
    switching.value = false
  }
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
  orderType.value = ''
  expiresAt.value = null
  reused.value = false
  plan.value = null
  remainingMs.value = 0
  consecutiveFails = 0
  pollErrorTip.value = ''
}

async function ensureOrder() {
  if (!props.planId) return

  // 都未启用：直接占位，不创建订单
  const defaultMethod = pickDefaultMethod()
  if (!defaultMethod) {
    resetState()
    return
  }
  // 当前选中渠道若被后台关闭，自动切到可用的那个
  if (
    (paymentMethod.value === 'wechat' && !siteConfig.payment.wechat) ||
    (paymentMethod.value === 'tianque' && !siteConfig.payment.tianque) ||
    (paymentMethod.value === 'xunhupay' && !siteConfig.payment.xunhupay)
  ) {
    paymentMethod.value = defaultMethod
  }

  // H5: 并发保护——同一 plan 已有请求 in-flight 时不再重复触发，但显示 loading 让 UI 不空白
  const orderKey = `${isUpgrade.value ? 'upgrade' : 'purchase'}:${props.fromUserPlanId || 0}:${props.planId}`
  if (inflightOrderKey === orderKey) {
    creating.value = true
    return
  }
  inflightOrderKey = orderKey
  resetState()
  creating.value = true
  try {
    const data = isUpgrade.value
      ? paymentMethod.value === 'wechat'
        ? (await cloudClient.upgradePlan(props.fromUserPlanId!, props.planId)) as OrderResponse
        : paymentMethod.value === 'xunhupay'
          ? (await cloudClient.upgradePlanXunhupay(props.fromUserPlanId!, props.planId)) as OrderResponse
          : (await cloudClient.upgradePlanTianque(props.fromUserPlanId!, props.planId)) as OrderResponse
      : paymentMethod.value === 'wechat'
        ? (await cloudClient.createOrder(props.planId)) as OrderResponse
        : paymentMethod.value === 'xunhupay'
          ? (await cloudClient.createXunhupayOrder(props.planId)) as OrderResponse
          : (await cloudClient.createTianqueOrder(props.planId)) as OrderResponse
    orderNo.value = data.order_no
    codeUrl.value = data.code_url
    amount.value = data.amount
    currency.value = data.currency || 'CNY'
    status.value = data.status || 'pending'
    orderType.value = data.order_type || (isUpgrade.value ? 'upgrade' : 'purchase')
    expiresAt.value = data.expires_at
    reused.value = !!data.reused
    plan.value = data.plan
  } catch (e: any) {
    createError.value = e?.message || '创建订单失败'
  } finally {
    creating.value = false
    inflightOrderKey = null
  }

  // 关键：必须等 creating=false 后 canvas DOM 才会从 v-else-if 分支 mount 出来；
  // 在 try 内调 renderQrCode 时 canvas 还在 v-if="creating" 占位的 loading 块里，
  // qrCanvas.value === null 会让 QRCode.toCanvas 静默跳过，导致二维码永远空白。
  if (codeUrl.value && status.value === 'pending') {
    await renderQrCode(codeUrl.value)
    startCountdown()
    startPolling()
  } else if (status.value === 'paid') {
    // 已支付（理论上不会发生，但防御）
    applyOrderUpdate({ status: 'paid', paid_at: new Date().toISOString() })
  }
}

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      await ensureOrder()
    } else {
      cleanupTimers()
      resetState()
    }
  },
)

onUnmounted(() => {
  cleanupTimers()
})
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
