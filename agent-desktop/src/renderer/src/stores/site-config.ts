import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { cloudPublic } from '@/utils/cloud-api'
import { applyPrimaryColor, DEFAULT_PRIMARY, resolvePrimaryColor } from '@/utils/theme-color'

/**
 * 站点公开配置 store。无需登录，App 启动时拉取一次。
 *
 * 业务上：
 * - balance_type='token'  -> 现金钱包，默认显示"金币"
 * - balance_type='credit' -> 积分钱包，默认显示"积分"
 *
 * 管理员可在云控后台「设置 → 界面文案」自定义这两个标签。
 */
export interface CurrencyLabels {
  token: string
  credit: string
}

/**
 * 支付通道开关。云控后台关闭后桌面端隐藏对应的支付按钮；两个都关闭时 PaymentDialog
 * 显示「暂无可用的支付方式」。默认都为 true（保留原有行为），拉取到 publicConfig 后用后端值覆盖。
 */
export interface PaymentAvailability {
  wechat: boolean
  tianque: boolean
  xunhupay: boolean
}

export interface FeatureFlags {
  /** 去AI标记 显示开关：开=对所有用户显示入口 */
  aiMarkRemoval: boolean
  /** 去AI标记 全局可用开关：开=所有能看到入口的用户免授权即可使用 */
  aiMarkRemovalUseAll: boolean
}

export interface RegisterAvailability {
  enabled: boolean
  // 注册短信验证开关：开启后注册需手机号 + 短信验证码
  sms_verify_enabled: boolean
}

/**
 * 找回密码开关。云控后台「系统设置 → 短信验证」开启「短信服务」+「允许找回密码」后生效，
 * 桌面端登录页才显示「忘记密码」入口。默认 false（保留原有行为：无找回密码）。
 */
export interface ForgotPasswordAvailability {
  enabled: boolean
}

/**
 * 套餐商城入口开关。云控后台「套餐管理」关闭后，桌面端用户中心隐藏「套餐商城」入口。
 * 默认 true（保留原有行为），拉取到 publicConfig 后用后端值覆盖。
 */
export interface PlansStoreAvailability {
  enabled: boolean
}

/**
 * 充值分类型显隐。云控后台「直充配置」可分别关闭金币（token）/ 积分（credit）充值，
 * 关闭后桌面端隐藏对应入口与充值页 tab。默认都为 true（保留原有行为）。
 */
export interface RechargeAvailability {
  token: boolean
  credit: boolean
}

/**
 * 注册页协议（注册协议、隐私协议）。由云控端「系统设置 → 协议管理」维护，
 * 桌面端在注册前弹窗展示。content 是 HTML 富文本，渲染前用 DOMPurify 过滤。
 */
export interface Agreement {
  title: string
  content: string
}

export interface Agreements {
  register: Agreement
  privacy: Agreement
}

/**
 * 「对话页面默认模型」：由云控端「系统设置 → 对话模型」维护。
 * 桌面端新建会话时把这两个字段填入 conversation.active_model_*；
 * 用户在对话页输入框左下角切换 → 写回 conversation.active_model_*（per-conversation）。
 * 任一字段为空表示未配置，桌面端将回退到本地第一个 chat 类型模型。
 */
export interface ChatDefaultModel {
  provider_id: string
  model_id: string
}

export interface CustomerServiceInfo {
  title: string
  image_url: string
  source?: string
  project_key?: string | null
}

/**
 * 登录页背景图。由云控端「系统设置 → 站点」上传，桌面端登录页全屏背景（cover）。
 * url 为空表示未配置，登录页回退到内置品牌橙光晕背景。
 */
export interface LoginBackground {
  url: string
}

/**
 * 智能体列表页背景图。由云控端「桌面端设置 → 基础设置 → 桌面端外观」上传，
 * 桌面端「智能体」页（启动首页）整页 cover 背景。url 为空回退默认纯色。
 */
export interface BotListBackground {
  url: string
}

/**
 * 全局主题。primary_color 是云控端配置的主色（hex），桌面端据此派生整套
 * primary 50~900 色阶并注入 CSS 变量换肤。空表示用桌面端内置默认橙。
 */
export interface ThemeConfig {
  primary_color: string
}

const DEFAULT_LABELS: CurrencyLabels = { token: '金币', credit: '积分' }
const DEFAULT_PAYMENT: PaymentAvailability = { wechat: true, tianque: true, xunhupay: false }
const DEFAULT_FEATURES: FeatureFlags = { aiMarkRemoval: false, aiMarkRemovalUseAll: false }
const DEFAULT_REGISTER: RegisterAvailability = { enabled: true, sms_verify_enabled: false }
const DEFAULT_FORGOT_PASSWORD: ForgotPasswordAvailability = { enabled: false }
const DEFAULT_PLANS_STORE: PlansStoreAvailability = { enabled: true }
const DEFAULT_RECHARGE: RechargeAvailability = { token: true, credit: true }
const DEFAULT_AGREEMENTS: Agreements = {
  register: { title: '注册协议', content: '' },
  privacy: { title: '隐私协议', content: '' },
}
const DEFAULT_CHAT_MODEL: ChatDefaultModel = { provider_id: '', model_id: '' }
const DEFAULT_CUSTOMER_SERVICE: CustomerServiceInfo | null = null
const DEFAULT_LOGIN_BACKGROUND: LoginBackground = { url: '' }
const DEFAULT_BOT_LIST_BACKGROUND: BotListBackground = { url: '' }
const DEFAULT_THEME: ThemeConfig = { primary_color: DEFAULT_PRIMARY }

const STORAGE_KEY = 'site_config_currency'
const PAYMENT_STORAGE_KEY = 'site_config_payment'
const FEATURES_STORAGE_KEY = 'site_config_features'
const REGISTER_STORAGE_KEY = 'site_config_register'
const FORGOT_PASSWORD_STORAGE_KEY = 'site_config_forgot_password'
const PLANS_STORE_STORAGE_KEY = 'site_config_plans_store'
const RECHARGE_STORAGE_KEY = 'site_config_recharge'
const AGREEMENTS_STORAGE_KEY = 'site_config_agreements'
const CHAT_MODEL_STORAGE_KEY = 'site_config_chat_default_model'
const CUSTOMER_SERVICE_STORAGE_KEY = 'site_config_customer_service'
const LOGIN_BACKGROUND_STORAGE_KEY = 'site_config_login_background'
const BOT_LIST_BACKGROUND_STORAGE_KEY = 'site_config_bot_list_background'
// 注意：此 key 必须与 main.ts 启动防闪注入读取的 key 一致
const THEME_STORAGE_KEY = 'site_config_theme'

function readCache(): CurrencyLabels {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_LABELS }
    const parsed = JSON.parse(raw)
    return {
      token: typeof parsed?.token === 'string' && parsed.token ? parsed.token : DEFAULT_LABELS.token,
      credit: typeof parsed?.credit === 'string' && parsed.credit ? parsed.credit : DEFAULT_LABELS.credit,
    }
  } catch {
    return { ...DEFAULT_LABELS }
  }
}

function writeCache(labels: CurrencyLabels) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(labels))
  } catch {
    // localStorage 不可用时静默失败
  }
}

function readPaymentCache(): PaymentAvailability {
  try {
    const raw = localStorage.getItem(PAYMENT_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PAYMENT }
    const parsed = JSON.parse(raw)
    return {
      wechat: typeof parsed?.wechat === 'boolean' ? parsed.wechat : DEFAULT_PAYMENT.wechat,
      tianque: typeof parsed?.tianque === 'boolean' ? parsed.tianque : DEFAULT_PAYMENT.tianque,
      xunhupay: typeof parsed?.xunhupay === 'boolean' ? parsed.xunhupay : DEFAULT_PAYMENT.xunhupay,
    }
  } catch {
    return { ...DEFAULT_PAYMENT }
  }
}

function writePaymentCache(p: PaymentAvailability) {
  try {
    localStorage.setItem(PAYMENT_STORAGE_KEY, JSON.stringify(p))
  } catch {
    // 静默失败
  }
}

function readFeaturesCache(): FeatureFlags {
  try {
    const raw = localStorage.getItem(FEATURES_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_FEATURES }
    const parsed = JSON.parse(raw)
    return {
      aiMarkRemoval: typeof parsed?.aiMarkRemoval === 'boolean' ? parsed.aiMarkRemoval : DEFAULT_FEATURES.aiMarkRemoval,
      aiMarkRemovalUseAll: typeof parsed?.aiMarkRemovalUseAll === 'boolean' ? parsed.aiMarkRemovalUseAll : DEFAULT_FEATURES.aiMarkRemovalUseAll,
    }
  } catch {
    return { ...DEFAULT_FEATURES }
  }
}

function writeFeaturesCache(f: FeatureFlags) {
  try {
    localStorage.setItem(FEATURES_STORAGE_KEY, JSON.stringify(f))
  } catch {
    // 静默失败
  }
}

function readRegisterCache(): RegisterAvailability {
  try {
    const raw = localStorage.getItem(REGISTER_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_REGISTER }
    const parsed = JSON.parse(raw)
    return {
      enabled: typeof parsed?.enabled === 'boolean' ? parsed.enabled : DEFAULT_REGISTER.enabled,
      sms_verify_enabled: typeof parsed?.sms_verify_enabled === 'boolean' ? parsed.sms_verify_enabled : DEFAULT_REGISTER.sms_verify_enabled,
    }
  } catch {
    return { ...DEFAULT_REGISTER }
  }
}

function writeRegisterCache(r: RegisterAvailability) {
  try {
    localStorage.setItem(REGISTER_STORAGE_KEY, JSON.stringify(r))
  } catch {
    // 静默失败
  }
}

function readForgotPasswordCache(): ForgotPasswordAvailability {
  try {
    const raw = localStorage.getItem(FORGOT_PASSWORD_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_FORGOT_PASSWORD }
    const parsed = JSON.parse(raw)
    return {
      enabled: typeof parsed?.enabled === 'boolean' ? parsed.enabled : DEFAULT_FORGOT_PASSWORD.enabled,
    }
  } catch {
    return { ...DEFAULT_FORGOT_PASSWORD }
  }
}

function writeForgotPasswordCache(f: ForgotPasswordAvailability) {
  try {
    localStorage.setItem(FORGOT_PASSWORD_STORAGE_KEY, JSON.stringify(f))
  } catch {
    // 静默失败
  }
}

function readPlansStoreCache(): PlansStoreAvailability {
  try {
    const raw = localStorage.getItem(PLANS_STORE_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PLANS_STORE }
    const parsed = JSON.parse(raw)
    return {
      enabled: typeof parsed?.enabled === 'boolean' ? parsed.enabled : DEFAULT_PLANS_STORE.enabled,
    }
  } catch {
    return { ...DEFAULT_PLANS_STORE }
  }
}

function writePlansStoreCache(p: PlansStoreAvailability) {
  try {
    localStorage.setItem(PLANS_STORE_STORAGE_KEY, JSON.stringify(p))
  } catch {
    // 静默失败
  }
}

function readRechargeCache(): RechargeAvailability {
  try {
    const raw = localStorage.getItem(RECHARGE_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_RECHARGE }
    const parsed = JSON.parse(raw)
    return {
      token: typeof parsed?.token === 'boolean' ? parsed.token : DEFAULT_RECHARGE.token,
      credit: typeof parsed?.credit === 'boolean' ? parsed.credit : DEFAULT_RECHARGE.credit,
    }
  } catch {
    return { ...DEFAULT_RECHARGE }
  }
}

function writeRechargeCache(r: RechargeAvailability) {
  try {
    localStorage.setItem(RECHARGE_STORAGE_KEY, JSON.stringify(r))
  } catch {
    // 静默失败
  }
}

function readAgreementsCache(): Agreements {
  try {
    const raw = localStorage.getItem(AGREEMENTS_STORAGE_KEY)
    if (!raw) return { register: { ...DEFAULT_AGREEMENTS.register }, privacy: { ...DEFAULT_AGREEMENTS.privacy } }
    const parsed = JSON.parse(raw)
    return {
      register: {
        title: typeof parsed?.register?.title === 'string' && parsed.register.title ? parsed.register.title : DEFAULT_AGREEMENTS.register.title,
        content: typeof parsed?.register?.content === 'string' ? parsed.register.content : '',
      },
      privacy: {
        title: typeof parsed?.privacy?.title === 'string' && parsed.privacy.title ? parsed.privacy.title : DEFAULT_AGREEMENTS.privacy.title,
        content: typeof parsed?.privacy?.content === 'string' ? parsed.privacy.content : '',
      },
    }
  } catch {
    return { register: { ...DEFAULT_AGREEMENTS.register }, privacy: { ...DEFAULT_AGREEMENTS.privacy } }
  }
}

function writeAgreementsCache(a: Agreements) {
  try {
    localStorage.setItem(AGREEMENTS_STORAGE_KEY, JSON.stringify(a))
  } catch {
    // 静默失败
  }
}

function readChatDefaultModelCache(): ChatDefaultModel {
  try {
    const raw = localStorage.getItem(CHAT_MODEL_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CHAT_MODEL }
    const parsed = JSON.parse(raw)
    return {
      provider_id: typeof parsed?.provider_id === 'string' ? parsed.provider_id : '',
      model_id: typeof parsed?.model_id === 'string' ? parsed.model_id : '',
    }
  } catch {
    return { ...DEFAULT_CHAT_MODEL }
  }
}

function writeChatDefaultModelCache(m: ChatDefaultModel) {
  try {
    localStorage.setItem(CHAT_MODEL_STORAGE_KEY, JSON.stringify(m))
  } catch {
    // 静默失败
  }
}

function normalizeCustomerService(raw: unknown): CustomerServiceInfo | null {
  const data = raw as Partial<CustomerServiceInfo> | null
  const title = typeof data?.title === 'string' ? data.title.trim() : ''
  const imageUrl = typeof data?.image_url === 'string' ? data.image_url.trim() : ''
  if (!title || !imageUrl) return null
  return {
    title,
    image_url: imageUrl,
    source: typeof data?.source === 'string' ? data.source : undefined,
    project_key: typeof data?.project_key === 'string' ? data.project_key : null,
  }
}

function readCustomerServiceCache(): CustomerServiceInfo | null {
  try {
    const raw = localStorage.getItem(CUSTOMER_SERVICE_STORAGE_KEY)
    if (!raw) return DEFAULT_CUSTOMER_SERVICE
    return normalizeCustomerService(JSON.parse(raw))
  } catch {
    return DEFAULT_CUSTOMER_SERVICE
  }
}

function writeCustomerServiceCache(info: CustomerServiceInfo | null) {
  try {
    if (info) localStorage.setItem(CUSTOMER_SERVICE_STORAGE_KEY, JSON.stringify(info))
    else localStorage.removeItem(CUSTOMER_SERVICE_STORAGE_KEY)
  } catch {
  }
}

function readLoginBackgroundCache(): LoginBackground {
  try {
    const raw = localStorage.getItem(LOGIN_BACKGROUND_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_LOGIN_BACKGROUND }
    const parsed = JSON.parse(raw)
    return { url: typeof parsed?.url === 'string' ? parsed.url : '' }
  } catch {
    return { ...DEFAULT_LOGIN_BACKGROUND }
  }
}

function writeLoginBackgroundCache(b: LoginBackground) {
  try {
    localStorage.setItem(LOGIN_BACKGROUND_STORAGE_KEY, JSON.stringify(b))
  } catch {
    // 静默失败
  }
}

function readBotListBackgroundCache(): BotListBackground {
  try {
    const raw = localStorage.getItem(BOT_LIST_BACKGROUND_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_BOT_LIST_BACKGROUND }
    const parsed = JSON.parse(raw)
    return { url: typeof parsed?.url === 'string' ? parsed.url : '' }
  } catch {
    return { ...DEFAULT_BOT_LIST_BACKGROUND }
  }
}

function writeBotListBackgroundCache(b: BotListBackground) {
  try {
    localStorage.setItem(BOT_LIST_BACKGROUND_STORAGE_KEY, JSON.stringify(b))
  } catch {
    // 静默失败
  }
}

function readThemeCache(): ThemeConfig {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_THEME }
    const parsed = JSON.parse(raw)
    const color = resolvePrimaryColor(
      typeof parsed?.primary_color === 'string' ? parsed.primary_color : '',
    )
    return { primary_color: color }
  } catch {
    return { ...DEFAULT_THEME }
  }
}

function writeThemeCache(t: ThemeConfig) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(t))
  } catch {
    // 静默失败
  }
}

export const useSiteConfigStore = defineStore('siteConfig', () => {
  // 启动时先用 localStorage 缓存，避免首屏闪烁默认文案
  const labels = ref<CurrencyLabels>(readCache())
  const payment = ref<PaymentAvailability>(readPaymentCache())
  const features = ref<FeatureFlags>(readFeaturesCache())
  const register = ref<RegisterAvailability>(readRegisterCache())
  const forgotPassword = ref<ForgotPasswordAvailability>(readForgotPasswordCache())
  const plansStore = ref<PlansStoreAvailability>(readPlansStoreCache())
  const recharge = ref<RechargeAvailability>(readRechargeCache())
  const agreements = ref<Agreements>(readAgreementsCache())
  const chatDefaultModel = ref<ChatDefaultModel>(readChatDefaultModelCache())
  const customerService = ref<CustomerServiceInfo | null>(readCustomerServiceCache())
  const loginBackground = ref<LoginBackground>(readLoginBackgroundCache())
  const botListBackground = ref<BotListBackground>(readBotListBackgroundCache())
  const theme = ref<ThemeConfig>(readThemeCache())
  const loading = ref(false)
  const lastFetchedAt = ref<number | null>(null)

  /**
   * 根据 balance_type / billing_type 取对应文案。
   * 'credit' -> labels.credit，其他（含 'token'、空、未知值）-> labels.token
   */
  const labelOf = computed(() => (type: string | null | undefined): string => {
    return type === 'credit' ? labels.value.credit : labels.value.token
  })

  /** 存在可用的支付通道 */
  const hasAnyPayment = computed(() => payment.value.wechat || payment.value.tianque || payment.value.xunhupay)

  /** 存在任一可充值类型（金币 / 积分），用于控制充值入口显隐 */
  const hasAnyRecharge = computed(() => recharge.value.token || recharge.value.credit)

  /** 只开一种直充时，钱包按该类型做主货币；两种都开则为 null，保持双栏。 */
  const soloRechargeType = computed<'token' | 'credit' | null>(() => {
    if (recharge.value.credit && !recharge.value.token) return 'credit'
    if (recharge.value.token && !recharge.value.credit) return 'token'
    return null
  })

  async function fetch(): Promise<void> {
    loading.value = true
    try {
      const data = await cloudPublic.siteConfig()
      const next: CurrencyLabels = {
        token: data?.currency?.token || DEFAULT_LABELS.token,
        credit: data?.currency?.credit || DEFAULT_LABELS.credit,
      }
      labels.value = next
      writeCache(next)

      // payment 字段为后加，老后端返回中可能不带。不在时保持当前值（避免老后端 + 新桌面端场景下误以为都关闭）
      if (data?.payment && typeof data.payment === 'object') {
        const nextPayment: PaymentAvailability = {
          wechat: !!data.payment.wechat,
          tianque: !!data.payment.tianque,
          xunhupay: !!data.payment.xunhupay,
        }
        payment.value = nextPayment
        writePaymentCache(nextPayment)
      }

      // features 字段为后加，老后端不带时保持当前值
      if (data?.features && typeof data.features === 'object') {
        const nextFeatures: FeatureFlags = {
          aiMarkRemoval: !!data.features.ai_mark_removal,
          aiMarkRemovalUseAll: !!data.features.ai_mark_removal_use_all,
        }
        features.value = nextFeatures
        writeFeaturesCache(nextFeatures)
      }

      if (data?.register && typeof data.register === 'object') {
        const nextRegister: RegisterAvailability = {
          enabled: typeof data.register.enabled === 'boolean' ? data.register.enabled : DEFAULT_REGISTER.enabled,
          sms_verify_enabled: typeof data.register.sms_verify_enabled === 'boolean' ? data.register.sms_verify_enabled : DEFAULT_REGISTER.sms_verify_enabled,
        }
        register.value = nextRegister
        writeRegisterCache(nextRegister)
      }

      // forgot_password 字段为后加，老后端不带时保持当前值（缓存或默认 false，不误显示找回密码入口）
      if (data?.forgot_password && typeof data.forgot_password === 'object') {
        const nextForgot: ForgotPasswordAvailability = {
          enabled: typeof data.forgot_password.enabled === 'boolean' ? data.forgot_password.enabled : DEFAULT_FORGOT_PASSWORD.enabled,
        }
        forgotPassword.value = nextForgot
        writeForgotPasswordCache(nextForgot)
      }

      // plans_store / recharge 字段为后加，老后端不带时保持当前值（缓存或默认 true，不误隐藏入口）
      if (data?.plans_store && typeof data.plans_store === 'object') {
        const nextPlansStore: PlansStoreAvailability = {
          enabled: typeof data.plans_store.enabled === 'boolean' ? data.plans_store.enabled : DEFAULT_PLANS_STORE.enabled,
        }
        plansStore.value = nextPlansStore
        writePlansStoreCache(nextPlansStore)
      }

      if (data?.recharge && typeof data.recharge === 'object') {
        const nextRecharge: RechargeAvailability = {
          token: typeof data.recharge.token === 'boolean' ? data.recharge.token : DEFAULT_RECHARGE.token,
          credit: typeof data.recharge.credit === 'boolean' ? data.recharge.credit : DEFAULT_RECHARGE.credit,
        }
        recharge.value = nextRecharge
        writeRechargeCache(nextRecharge)
      }

      // agreements 字段为后加，老后端不带时保持当前值（缓存或默认占位）
      if (data?.agreements && typeof data.agreements === 'object') {
        const nextAgreements: Agreements = {
          register: {
            title: (typeof data.agreements?.register?.title === 'string' && data.agreements.register.title) || DEFAULT_AGREEMENTS.register.title,
            content: typeof data.agreements?.register?.content === 'string' ? data.agreements.register.content : '',
          },
          privacy: {
            title: (typeof data.agreements?.privacy?.title === 'string' && data.agreements.privacy.title) || DEFAULT_AGREEMENTS.privacy.title,
            content: typeof data.agreements?.privacy?.content === 'string' ? data.agreements.privacy.content : '',
          },
        }
        agreements.value = nextAgreements
        writeAgreementsCache(nextAgreements)
      }

      // chat_default_model 字段为后加（v0.6.5+），老后端不带时保持当前值（缓存或空占位）
      if (data?.chat_default_model && typeof data.chat_default_model === 'object') {
        const nextChatModel: ChatDefaultModel = {
          provider_id: typeof data.chat_default_model?.provider_id === 'string' ? data.chat_default_model.provider_id : '',
          model_id: typeof data.chat_default_model?.model_id === 'string' ? data.chat_default_model.model_id : '',
        }
        chatDefaultModel.value = nextChatModel
        writeChatDefaultModelCache(nextChatModel)
      }

      if (data && typeof data === 'object' && 'customer_service' in data) {
        const nextCustomerService = normalizeCustomerService(data.customer_service)
        customerService.value = nextCustomerService
        writeCustomerServiceCache(nextCustomerService)
      }

      // 登录页背景图（后加字段，老后端不带时保持当前值）
      if (data?.login_background && typeof data.login_background === 'object') {
        const nextBg: LoginBackground = {
          url: typeof data.login_background.url === 'string' ? data.login_background.url : '',
        }
        loginBackground.value = nextBg
        writeLoginBackgroundCache(nextBg)
      }

      // 智能体列表页背景图（后加字段，老后端不带时保持当前值）
      if (data?.bot_list_background && typeof data.bot_list_background === 'object') {
        const nextBg: BotListBackground = {
          url: typeof data.bot_list_background.url === 'string' ? data.bot_list_background.url : '',
        }
        botListBackground.value = nextBg
        writeBotListBackgroundCache(nextBg)
      }

      // 全局主题主色（后加字段）：解析后即时派生注入 CSS 变量换肤；历史橙/靛回落墨绿
      if (data?.theme && typeof data.theme === 'object') {
        const nextTheme: ThemeConfig = {
          primary_color: resolvePrimaryColor(
            typeof data.theme.primary_color === 'string' ? data.theme.primary_color : '',
          ),
        }
        theme.value = nextTheme
        writeThemeCache(nextTheme)
        applyPrimaryColor(nextTheme.primary_color)
      }

      lastFetchedAt.value = Date.now()
    } catch {
      // 拉取失败保持当前值（缓存或默认）
    } finally {
      loading.value = false
    }
  }

  /**
   * App 启动时调用。已有缓存就立即可用，同时后台异步刷新最新值。
   */
  function init(): void {
    fetch()
  }

  return { labels, payment, features, register, forgotPassword, plansStore, recharge, agreements, chatDefaultModel, customerService, loginBackground, botListBackground, theme, hasAnyPayment, hasAnyRecharge, soloRechargeType, loading, lastFetchedAt, labelOf, fetch, init }
})
