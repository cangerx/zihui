import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { cloudAuth, cloudClient, setCloudToken, getCloudToken, clearCloudAuth } from '@/utils/cloud-api'
import { MALL_KEYS, mallPolicyKey, mallNameKey } from '@shared/mall-keys'

const BALANCE_REFRESH_THROTTLE_MS = 5000
const BALANCE_FOCUS_STALE_MS = 30000
const BALANCE_VISIBLE_POLL_MS = 60000

export interface CloudUser {
  id: number
  username: string
  email: string
  phone: string
  nickname: string
  role: string
  status: string
  groups: { id: number; name: string }[]
  balances: { type: string; amount: number }[]
}

export interface CloudModel {
  id: number
  model_id: string
  name: string
  type: string
  provider_name: string
  provider_type: string
}

export interface CloudPermissions {
  allow_custom_provider: boolean
  allow_custom_embedding: boolean
  /** 自定义视频模型：开启后桌面端侧栏「视频模型」入口可见。默认 false，独立于 allow_custom_provider */
  allow_custom_video_provider: boolean
  allow_ai_video: boolean
  video_quota_per_day: number
  video_quota_per_month: number
  allow_image_gen: boolean
  allow_knowledge_base: boolean
  max_context_messages: number
  // 「灵感大王」：开启后桌面端创作详情可将作品上传到灵感广场
  inspiration_uploader: boolean
  // v0.6.9+ AI 抠图（阿里 viapi）相关 3 个权限：
  // - allow_image_matting：是否允许使用云接口抠图，关闭后桌面端「AI 抠图」入口隐藏
  // - allow_custom_matting_provider：是否允许桌面端配置自己的阿里 AK/SK 直连，关闭后「抠图接口」tab 隐藏
  // - image_matting_quota_per_month：每月配额（张），0=不限；超出后云接口会拒绝
  allow_image_matting: boolean
  allow_custom_matting_provider: boolean
  image_matting_quota_per_month: number
  // 精细抠图（抠抠图 koukoutu）：是否允许（关闭后桌面端「精细抠图」入口隐藏）+ 月配额（张，0=不限）
  allow_fine_matting: boolean
  fine_matting_quota_per_month: number
  // 去AI标记：是否允许（默认 false，关闭后桌面端「去AI标记」入口隐藏）。本地处理但按次计费。
  allow_ai_mark_removal: boolean
  // 微信 ClawBot：是否允许使用（默认 false 默认拒绝）。仅控制「能否使用」；
  // 菜单显隐由云控端「桌面端设置 → 菜单配置」管理（默认显示），与此权限解耦。
  allow_clawbot: boolean
  // 店铺商品图：开启后桌面端侧栏「店铺商品图」入口可见。默认 false（默认拒绝），
  // 云控端在「桌面端设置 → 店铺商品图」按用户/分组放开；生图仍走现有云端积分计费，不额外计费。
  allow_ewei_shop: boolean
  // 对接的商城/平台对终端用户显示的名称（隐藏底层 ewei 品牌，云控端可自定义）；缺省「商城」。
  ewei_shop_mall_name: string
  // 多商城泛化：点大商城（iappwx）的二级授权与自定义名（与 ewei 平级，下发同结构）。
  allow_dianda_shop: boolean
  dianda_shop_mall_name: string
  // 多商城泛化：全端云商城（qdyun）的二级授权与自定义名（与 ewei/dianda 平级，下发同结构）。
  allow_qdyun_shop: boolean
  qdyun_shop_mall_name: string
  // 按商城聚合下发（推荐消费此结构）：{ [mall_key]: { allowed, mall_name, real_name } }。
  // 平铺的 allow_*_shop / *_shop_mall_name 为向后兼容保留。
  shops: Record<string, { allowed: boolean; mall_name: string; real_name?: string }>
  [key: string]: any
}

export interface CloudBalanceBreakdown {
  wallet: number
  plan: number
  total: number
}

export interface CloudPlanQuota {
  id: number
  user_plan_id: number
  plan_id: number
  plan_code: string
  plan_name: string
  balance_type: string
  granted: number
  consumed: number
  remaining: number
  expires_at: string | null
  status: string
}

export interface CloudUsageCounter {
  counter_key: string
  limit: number
  used: number
  remaining: number | null
  period: string
  reset_at: string
  allowed: boolean
  unlimited: boolean
}

export interface CloudQuotas {
  balances: Record<string, CloudBalanceBreakdown>
  plan_quotas: CloudPlanQuota[]
  usage_counters: Record<string, CloudUsageCounter>
  rate_limits: Record<string, { rpm: number; tpm: number; concurrency: number }>
  policies: Record<string, any>
}

export interface RegisterBonus {
  granted: boolean
  reason?: string
  token?: number
  credit?: number
  plan_id?: number | null
  user_plan_id?: number | null
}

export interface MyPlan {
  id: number
  plan_id: number
  plan_code: string
  plan_name: string
  description: string
  source: string
  activated_at: string | null
  expires_at: string | null
  quota_refill_cycle?: 'none' | 'monthly' | string
  last_quota_refilled_at?: string | null
  next_quota_refill_at?: string | null
  upgraded_from_user_plan_id?: number | null
  status: 'active' | 'expired' | 'revoked'
  token_granted: number
  credit_granted: number
  policies?: Record<string, any>
  rate_limit?: Record<string, any>
  quota_buckets?: CloudPlanQuota[]
  quota_summary?: Record<string, { granted: number; consumed: number; remaining: number }>
  models: { id: number; model_id: string; name: string; type: string }[]
}

export interface Announcement {
  id: number
  title: string
  /** HTML 富文本，桌面端用 v-html 渲染。来源为 admin 后台可控，无需白名单过滤 */
  content: string
  updated_at: string
}

export const useCloudAuthStore = defineStore('cloudAuth', () => {
  const user = ref<CloudUser | null>(null)
  const models = ref<CloudModel[]>([])
  const permissions = ref<CloudPermissions>({
    allow_custom_provider: true,
    allow_custom_embedding: true,
    allow_custom_video_provider: false,
    allow_ai_video: false,
    video_quota_per_day: 0,
    video_quota_per_month: 0,
    allow_image_gen: true,
    allow_knowledge_base: true,
    max_context_messages: 50,
    inspiration_uploader: false,
    allow_image_matting: true,
    allow_custom_matting_provider: false,
    image_matting_quota_per_month: 100,
    allow_fine_matting: true,
    fine_matting_quota_per_month: 100,
    // 去AI标记默认关闭：默认全部用户不可见，需云控端按用户/分组/套餐授权后下发 true
    allow_ai_mark_removal: false,
    // 微信 ClawBot：默认 false（默认拒绝），仅控制「能否使用」；
    // 菜单显示不受此权限控制（由云控端「桌面端设置 → 菜单配置」管理，默认显示）。
    allow_clawbot: false,
    // 默认 false（默认拒绝）：仅当云控端被授权管理端开放该功能、且用户被授权时，云控端才下发 true。
    // 未更新 / 未授权的云控端不返回此键 → 保持 false → 桌面端不显示「店铺商品图」入口。
    allow_ewei_shop: false,
    // 商城显示名缺省值；云控端下发后由 fetchCloudData / refreshBalances 的 policies 合并覆盖。
    ewei_shop_mall_name: '商城',
    allow_dianda_shop: false,
    dianda_shop_mall_name: '商城',
    allow_qdyun_shop: false,
    qdyun_shop_mall_name: '商城',
    shops: {},
  })
  const balances = ref<{ type: string; amount: number }[]>([])
  const quotas = ref<CloudQuotas | null>(null)
  const billingRules = ref<any[]>([])
  const plans = ref<MyPlan[]>([])
  // 云端当前启用的最新一条公告，未登录 / 未拉取 / 无公告时为 null
  const announcement = ref<Announcement | null>(null)
  const tokenPresent = ref(false)
  const isLoggedIn = computed(() => tokenPresent.value)
  const loading = ref(false)
  const pendingBonus = ref<RegisterBonus | null>(null)
  let balanceRefreshPromise: Promise<void> | null = null
  let lastBalanceRefreshAt = 0
  let balancePollTimer: ReturnType<typeof setInterval> | null = null
  let balanceRefreshTimer: ReturnType<typeof setTimeout> | null = null
  let balanceAutoRefreshStarted = false

  function loadCachedUser() {
    const raw = localStorage.getItem('cloud_user')
    if (raw) {
      try { user.value = JSON.parse(raw) } catch { user.value = null }
    }
  }

  function syncTokenState() {
    tokenPresent.value = !!getCloudToken()
  }

  async function login(username: string, password: string) {
    loading.value = true
    try {
      const data = await cloudAuth.login(username, password)
      setCloudToken(data.token)
      syncTokenState()
      user.value = data.user
      localStorage.setItem('cloud_user', JSON.stringify(data.user))
      // 账号隔离：切到该账号数据目录；目录变化时主进程热切换（关旧库开新库 + reload），由 reload 后的 init 接管
      const sw = await window.api?.cloud?.setActiveAccount?.(data.user.id)
      if (sw?.switched) return data.user
      await fetchCloudData()
      return data.user
    } finally {
      loading.value = false
    }
  }

  async function register(username: string, password: string, nickname?: string, phone?: string, code?: string) {
    loading.value = true
    try {
      const data = await cloudAuth.register({ username, password, nickname, phone, code })
      setCloudToken(data.token)
      syncTokenState()
      user.value = data.user
      localStorage.setItem('cloud_user', JSON.stringify(data.user))
      // Capture register bonus for UI to display on next page
      // 持久化到 localStorage：注册会触发账号切换 relaunch，避免奖励提示在重启后丢失
      if (data.bonus) {
        pendingBonus.value = data.bonus as RegisterBonus
        try { localStorage.setItem('pending_register_bonus', JSON.stringify(data.bonus)) } catch {}
      }
      // 账号隔离：切到新账号数据目录；目录变化时主进程热切换（关旧库开新库 + reload），由 reload 后的 init 接管
      const sw = await window.api?.cloud?.setActiveAccount?.(data.user.id)
      if (sw?.switched) return data.user
      await fetchCloudData()
      return data.user
    } finally {
      loading.value = false
    }
  }

  function consumeBonus(): RegisterBonus | null {
    const b = pendingBonus.value
    pendingBonus.value = null
    try { localStorage.removeItem('pending_register_bonus') } catch {}
    return b
  }

  function logout() {
    clearCloudAuth()
    syncTokenState()
    user.value = null
    models.value = []
    balances.value = []
    quotas.value = null
    plans.value = []
    announcement.value = null
    permissions.value = {
      allow_custom_provider: false,
      allow_custom_embedding: true,
      allow_custom_video_provider: false,
      allow_ai_video: false,
      video_quota_per_day: 0,
      video_quota_per_month: 0,
      allow_image_gen: true,
      allow_knowledge_base: true,
      max_context_messages: 50,
      inspiration_uploader: false,
      allow_image_matting: true,
      allow_custom_matting_provider: false,
      image_matting_quota_per_month: 100,
      allow_fine_matting: true,
      fine_matting_quota_per_month: 100,
      allow_ai_mark_removal: false,
      allow_clawbot: false,
      allow_ewei_shop: false,
      ewei_shop_mall_name: '商城',
      allow_dianda_shop: false,
      dianda_shop_mall_name: '商城',
      allow_qdyun_shop: false,
      qdyun_shop_mall_name: '商城',
      shops: {},
    }
    window.api?.cloud?.setPermissions({
      allow_custom_provider: false,
      allow_custom_embedding: true,
    })
    // 清空主进程缓存的云端 embedding 模型与偏好，避免状态泄漏
    window.api?.cloud?.setEmbeddingModels([])
    window.api?.cloud?.setPreferredEmbeddingModel('')
    // 清空主进程缓存的全量云端模型，避免登出后旧账号的 cloud_model_id 被复用
    window.api?.cloud?.setModels([])
    stopBalanceAutoRefresh()
  }

  async function fetchMe() {
    try {
      const data = await cloudAuth.me()
      user.value = data
      localStorage.setItem('cloud_user', JSON.stringify(data))
    } catch (e: any) {
      // AUTH_EXPIRED 同步兜底：cloud-api.ts 内部 refresh 失败时已派发事件让 main.ts 调 logout()；
      // 这里再调一次保证调用方 await fetchMe() 后能立即拿到一致的 store 状态（logout 幂等）。
      if (e.message === 'AUTH_EXPIRED') logout()
      throw e
    }
  }

  async function fetchCloudData() {
    try {
      const [modelsRes, permRes, balRes, quotaRes] = await Promise.all([
        cloudClient.myModels(),
        cloudClient.myPermissions(),
        cloudClient.myBalance(),
        cloudClient.myQuotas().catch(() => null),
      ])
      models.value = modelsRes.models || []
      quotas.value = quotaRes as CloudQuotas | null
      permissions.value = { ...permissions.value, ...(quotaRes?.policies || {}), ...(permRes.permissions || {}) }
      backfillMallFlats()
      balances.value = balRes.balances || []
      lastBalanceRefreshAt = Date.now()
      try {
        const billRes = await cloudClient.myBillingRules()
        billingRules.value = billRes.billing_rules || []
      } catch { billingRules.value = [] }
      try {
        const planRes = await cloudClient.myPlans()
        plans.value = (planRes.plans || []) as MyPlan[]
      } catch { plans.value = [] }
      // 拉取当前公告：接口失败 / 无公告 / 字段缺失统一按 null 处理，避免 UI 出现半残状态
      try {
        const annRes = await cloudClient.currentAnnouncement()
        const a = annRes?.announcement
        announcement.value = a && typeof a === 'object' && a.id
          ? { id: Number(a.id), title: String(a.title || ''), content: String(a.content || ''), updated_at: String(a.updated_at || '') }
          : null
      } catch { announcement.value = null }
      // Sync permissions to main process for LLM routing guard
      window.api?.cloud?.setPermissions({
        allow_custom_provider: permissions.value.allow_custom_provider,
        allow_custom_embedding: permissions.value.allow_custom_embedding,
        allow_clawbot: permissions.value.allow_clawbot,
      })
      // 同步云端 embedding 模型清单到主进程，用于 vectorize 路由 + Settings UI 渲染
      const embeddingModels = (modelsRes.models || [])
        .filter((m: any) => m.type === 'embedding')
        .map((m: any) => ({ id: m.id, model_id: m.model_id, name: m.name }))
      window.api?.cloud?.setEmbeddingModels(embeddingModels)
      // 同步全量云端模型到主进程；main 在 callLLM / 生图 / 向量请求体里附 cloud_model_id 主键，
      // 让云控端按主键精确路由，避免多家服务商同 model_id 时 first() 错位扣费。
      const allModels = (modelsRes.models || []).map((m: any) => ({
        id: m.id,
        model_id: m.model_id,
        name: m.name,
        type: m.type,
        provider_name: m.provider_name,
        provider_type: m.provider_type,
      }))
      window.api?.cloud?.setModels(allModels)
      // 用户偏好的云端 embedding 模型（从 settings 读取，由 SettingsView 写入）
      try {
        const preferred = (await window.api.settings.invoke('get', 'cloud_embedding_model')) as string | undefined
        window.api?.cloud?.setPreferredEmbeddingModel(preferred || '')
      } catch {
        window.api?.cloud?.setPreferredEmbeddingModel('')
      }
      startBalanceAutoRefresh()
    } catch (e: any) {
      console.error('[CloudAuth] fetchCloudData error:', e.message, e)
      // AUTH_EXPIRED 同步兜底，参见 fetchMe 注释
      if (e.message === 'AUTH_EXPIRED') logout()
    }
  }

  async function refreshBalances() {
    if (!getCloudToken()) return
    try {
      const [balRes, quotaRes] = await Promise.all([
        cloudClient.myBalance(),
        cloudClient.myQuotas().catch(() => null),
      ])
      balances.value = balRes.balances || []
      quotas.value = quotaRes as CloudQuotas | null
      if (quotaRes?.policies) {
        permissions.value = { ...permissions.value, ...(quotaRes.policies || {}) }
        backfillMallFlats()
      }
      lastBalanceRefreshAt = Date.now()
    } catch (e: any) {
      if (e.message === 'AUTH_EXPIRED') logout()
      throw e
    }
  }

  function refreshBalancesThrottled(force = false): Promise<void> {
    if (!getCloudToken()) return Promise.resolve()
    const now = Date.now()
    if (!force && now - lastBalanceRefreshAt < BALANCE_REFRESH_THROTTLE_MS) {
      if (!balanceRefreshTimer) {
        balanceRefreshTimer = setTimeout(() => {
          balanceRefreshTimer = null
          refreshBalancesThrottled(true).catch(() => {})
        }, BALANCE_REFRESH_THROTTLE_MS - (now - lastBalanceRefreshAt))
      }
      return balanceRefreshPromise || Promise.resolve()
    }
    if (balanceRefreshPromise) return balanceRefreshPromise
    balanceRefreshPromise = refreshBalances().finally(() => {
      balanceRefreshPromise = null
    })
    return balanceRefreshPromise
  }

  function shouldRefreshBalanceOnFocus(): boolean {
    return !!getCloudToken() && Date.now() - lastBalanceRefreshAt >= BALANCE_FOCUS_STALE_MS
  }

  function handleBalanceFocusRefresh() {
    if (shouldRefreshBalanceOnFocus()) refreshBalancesThrottled(true).catch(() => {})
  }

  function handleBalanceVisibilityRefresh() {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      handleBalanceFocusRefresh()
    }
  }

  function startBalanceAutoRefresh() {
    if (balanceAutoRefreshStarted || typeof window === 'undefined') return
    balanceAutoRefreshStarted = true
    window.addEventListener('focus', handleBalanceFocusRefresh)
    window.addEventListener('online', handleBalanceFocusRefresh)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleBalanceVisibilityRefresh)
    }
    balancePollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      refreshBalancesThrottled().catch(() => {})
    }, BALANCE_VISIBLE_POLL_MS)
  }

  function stopBalanceAutoRefresh() {
    if (!balanceAutoRefreshStarted || typeof window === 'undefined') return
    window.removeEventListener('focus', handleBalanceFocusRefresh)
    window.removeEventListener('online', handleBalanceFocusRefresh)
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleBalanceVisibilityRefresh)
    }
    if (balancePollTimer) {
      clearInterval(balancePollTimer)
      balancePollTimer = null
    }
    if (balanceRefreshTimer) {
      clearTimeout(balanceRefreshTimer)
      balanceRefreshTimer = null
    }
    balanceAutoRefreshStarted = false
    balanceRefreshPromise = null
  }

  async function changePassword(oldPwd: string, newPwd: string) {
    await cloudAuth.changePassword(oldPwd, newPwd)
  }

  // 发送短信验证码（scene: 'register' 注册 | 'reset_password' 找回密码）。失败抛错由调用方提示。
  async function sendSmsCode(scene: 'register' | 'reset_password', mobile: string) {
    return cloudAuth.sendSmsCode(scene, mobile)
  }

  // 找回密码：凭手机号 + 验证码重置；成功后不自动登录，由调用方引导用户用新密码登录。
  async function resetPassword(mobile: string, code: string, newPwd: string) {
    return cloudAuth.resetPassword(mobile, code, newPwd)
  }

  async function refreshToken() {
    try {
      const data = await cloudAuth.refresh()
      setCloudToken(data.token)
      syncTokenState()
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (['Token expired', 'Token invalid', 'Token not provided', 'User not found', 'AUTH_EXPIRED'].includes(msg)) {
        logout()
      }
      throw e
    }
  }

  async function init() {
    loadCachedUser()
    syncTokenState()
    // 注册奖励跨 relaunch 存活：从 localStorage 恢复待展示奖励（触发 RegisterBonusToast 的 watch）
    try {
      const rawBonus = localStorage.getItem('pending_register_bonus')
      if (rawBonus) pendingBonus.value = JSON.parse(rawBonus)
    } catch {}
    const token = getCloudToken()
    if (token) {
      // Sync token to main process for cloud LLM routing
      window.api?.cloud?.setToken(token)
      try {
        await fetchMe()
        // 账号隔离：确认/认领当前账号目录（已登录账号；老用户首次升级在此原地认领历史数据）
        await window.api?.cloud?.setActiveAccount?.(user.value?.id ?? null)
        await fetchCloudData()
      } catch {
        // Token 失效或网络异常：cloud-api.ts 已自动尝试 refresh，失败时已通过事件 + 同步兜底完成 logout，
        // 此处不需要做额外处理，吞错避免污染启动流程。
      }
    }
  }

  // ===== 店铺商品图：按商城授权判定的单一来源（菜单 / 路由 / View 全走这里，消除平铺 vs 聚合漂移）=====
  // 聚合 shops 优先（backend 已算 allowed = 二级 policy AND 一级授权），回退平铺 allow_{mall}_shop。
  function mallAllowed(key: string): boolean {
    const p = permissions.value as any
    const shop = p?.shops?.[key]
    if (shop && typeof shop.allowed === 'boolean') return shop.allowed
    return p?.[mallPolicyKey(key)] === true
  }
  // 任一商城被授权（菜单 / 路由 requireAnyMall 用）。
  const anyMallAllowed = computed(() => MALL_KEYS.some((k) => mallAllowed(k)))
  // 商城显示名（云控端自定义，隐藏底层平台品牌；缺省「商城」）。
  function mallName(key: string): string {
    const p = permissions.value as any
    const shop = p?.shops?.[key]
    if (shop?.mall_name) return shop.mall_name
    return (p?.[mallNameKey(key)] as string) || '商城'
  }
  // 聚合 shops → 平铺位单向回填：云端只下发聚合（不下发平铺）时，仍读平铺位的菜单/旧逻辑不致整片消失
  // （backend 平铺与 shops.allowed 同值，同时下发时回填不改变结果）。
  function backfillMallFlats(): void {
    const p = permissions.value as any
    const shops = p?.shops
    if (!shops) return
    for (const k of MALL_KEYS) {
      const shop = shops[k]
      if (shop && typeof shop.allowed === 'boolean') {
        p[mallPolicyKey(k)] = shop.allowed
        if (shop.mall_name) p[mallNameKey(k)] = shop.mall_name
      }
    }
  }

  return {
    user, models, permissions, balances, quotas, billingRules, plans, announcement,
    isLoggedIn, loading, pendingBonus,
    mallAllowed, anyMallAllowed, mallName,
    login, register, logout, fetchMe, fetchCloudData, refreshBalances, refreshBalancesThrottled, syncTokenState,
    changePassword, sendSmsCode, resetPassword, refreshToken, init, consumeBonus,
  }
})
