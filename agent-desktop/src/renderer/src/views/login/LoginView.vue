<template>
  <div class="login-root h-screen w-screen overflow-y-auto grid place-items-center p-6">
    <!-- 云控端配置的登录页背景图：fixed 铺满视口 + cover 自适应任意窗口尺寸；无图/加载失败时露出 login-root 的品牌橙光晕兜底 -->
    <div
      v-if="loginBgUrl"
      class="fixed inset-0 bg-center bg-cover bg-no-repeat pointer-events-none"
      :style="{ backgroundImage: `url('${loginBgUrl}')` }"
    ></div>
    <div class="relative z-10 w-full max-w-sm bg-surface-0 rounded-2xl shadow-lg p-8">
      <!-- 品牌区：图标 + 名称 + 装饰线副标题，居中竖排 -->
      <div class="flex flex-col items-center text-center mb-7">
        <div class="relative mb-3">
          <img
            v-if="appIconUrl"
            :src="appIconUrl"
            width="64"
            height="64"
            class="w-16 h-16 rounded-2xl object-cover"
            style="width:64px;height:64px"
            alt=""
            draggable="false"
          />
          <div
            v-else
            class="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center"
          >
            <span class="text-white text-lg font-bold">{{ appAbbr }}</span>
          </div>
          <!-- 同色系柔光底：仅作质感衬托，不引入其它色相 -->
          <div class="absolute -inset-3 -z-10 rounded-full bg-primary-500/20 blur-2xl"></div>
        </div>
        <h1 class="text-lg font-bold text-text-primary">{{ appName }}</h1>
        <div class="mt-2 flex items-center gap-2.5">
          <span class="h-px w-7 bg-surface-3"></span>
          <span class="text-xs text-text-tertiary">{{ subtitle }}</span>
          <span class="h-px w-7 bg-surface-3"></span>
        </div>
      </div>

      <form @submit.prevent="handleSubmit" class="space-y-4">
        <!-- 用户名：登录 / 注册 显示；找回密码不需要 -->
        <div v-if="!isForgot">
          <label class="block text-xs font-medium text-text-secondary mb-1.5">用户名</label>
          <div class="relative">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path :d="icons.user" /></svg>
            <input v-model="form.username" type="text" required autocomplete="username"
              class="w-full pl-9 pr-3 py-2.5 text-sm bg-surface-2 border border-surface-3 rounded-lg text-text-primary outline-none focus:border-primary-500 transition-colors"
              :placeholder="isRegister ? '中文 / 英文 / 数字 / 下划线，6-16 位' : '请输入用户名'" />
          </div>
        </div>

        <div v-if="isRegister">
          <label class="block text-xs font-medium text-text-secondary mb-1.5">昵称</label>
          <div class="relative">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path :d="icons.user" /></svg>
            <input v-model="form.nickname" type="text"
              class="w-full pl-9 pr-3 py-2.5 text-sm bg-surface-2 border border-surface-3 rounded-lg text-text-primary outline-none focus:border-primary-500 transition-colors"
              placeholder="中文 / 英文 / 数字 / 下划线，2-30 位（选填，不填默认用用户名）" />
          </div>
        </div>

        <!-- 手机号：找回密码必填；注册时按云控端开关决定是否必填 -->
        <div v-if="isForgot || isRegister">
          <label class="block text-xs font-medium text-text-secondary mb-1.5">
            手机号
            <span v-if="isRegister && !needSms" class="text-text-tertiary">(选填)</span>
          </label>
          <div class="relative">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path :d="icons.phone" /></svg>
            <input v-model="form.phone" type="tel" autocomplete="tel" maxlength="11"
              class="w-full pl-9 pr-3 py-2.5 text-sm bg-surface-2 border border-surface-3 rounded-lg text-text-primary outline-none focus:border-primary-500 transition-colors"
              placeholder="请输入手机号" />
          </div>
        </div>

        <!-- 短信验证码：找回密码必填；注册在开启短信验证时必填 -->
        <div v-if="showSmsCode">
          <label class="block text-xs font-medium text-text-secondary mb-1.5">短信验证码</label>
          <div class="flex gap-2">
            <div class="relative flex-1 min-w-0">
              <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path :d="icons.shield" /></svg>
              <input v-model="form.code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code"
                class="w-full pl-9 pr-3 py-2.5 text-sm bg-surface-2 border border-surface-3 rounded-lg text-text-primary outline-none focus:border-primary-500 transition-colors"
                placeholder="6 位验证码" />
            </div>
            <button type="button" @click="handleSendCode" :disabled="countdown > 0 || sendingCode"
              class="flex-shrink-0 px-3 py-2.5 text-xs font-medium bg-surface-2 border border-surface-3 rounded-lg text-primary-600 hover:border-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
              {{ countdown > 0 ? `${countdown}s 后重发` : (sendingCode ? '发送中...' : '获取验证码') }}
            </button>
          </div>
        </div>

        <!-- 密码：登录 / 注册用「密码」，找回用「新密码」 -->
        <div>
          <label class="block text-xs font-medium text-text-secondary mb-1.5">{{ isForgot ? '新密码' : '密码' }}</label>
          <div class="relative">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path :d="icons.lock" /></svg>
            <input v-model="form.password" type="password" required
              :autocomplete="isRegister || isForgot ? 'new-password' : 'current-password'"
              class="w-full pl-9 pr-3 py-2.5 text-sm bg-surface-2 border border-surface-3 rounded-lg text-text-primary outline-none focus:border-primary-500 transition-colors"
              :placeholder="isRegister || isForgot ? '至少 6 位' : '请输入密码'" />
          </div>
        </div>

        <div v-if="isRegister || isForgot">
          <label class="block text-xs font-medium text-text-secondary mb-1.5">确认密码</label>
          <div class="relative">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path :d="icons.lock" /></svg>
            <input v-model="form.confirmPassword" type="password" required autocomplete="new-password"
              class="w-full pl-9 pr-3 py-2.5 text-sm bg-surface-2 border border-surface-3 rounded-lg text-text-primary outline-none focus:border-primary-500 transition-colors"
              placeholder="再次输入密码" />
          </div>
        </div>

        <!-- 记住账号 / 记住密码 + 忘记密码（仅登录态，忘记密码移至本行右侧） -->
        <div v-if="isLogin" class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-4">
            <label class="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
              <input type="checkbox" v-model="rememberUsername" class="w-3.5 h-3.5 rounded border-surface-3 accent-primary-600" />
              记住账号
            </label>
            <label class="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
              <input type="checkbox" v-model="rememberPassword" class="w-3.5 h-3.5 rounded border-surface-3 accent-primary-600" />
              记住密码
            </label>
          </div>
          <button v-if="siteConfig.forgotPassword.enabled" type="button" @click="goForgot" class="flex-shrink-0 text-xs text-text-tertiary hover:text-primary-600 transition-colors">
            忘记密码？
          </button>
        </div>

        <div v-if="isRegister" class="flex items-start gap-1.5">
          <input
            id="agree-checkbox"
            type="checkbox"
            v-model="agreed"
            class="mt-0.5 w-3.5 h-3.5 rounded border-surface-3 accent-primary-600 cursor-pointer flex-shrink-0"
          />
          <label for="agree-checkbox" class="text-xs text-text-secondary leading-relaxed cursor-pointer">
            我已阅读并同意
            <button type="button" @click="openAgreement('register')" class="text-primary-600 hover:text-primary-700 transition-colors">《{{ siteConfig.agreements.register.title || '注册协议' }}》</button>
            和
            <button type="button" @click="openAgreement('privacy')" class="text-primary-600 hover:text-primary-700 transition-colors">《{{ siteConfig.agreements.privacy.title || '隐私协议' }}》</button>
          </label>
        </div>

        <div v-if="error" class="text-xs text-red-500 bg-red-50 dark:text-red-300 dark:bg-red-900/20 rounded-lg px-3 py-2">{{ error }}</div>
        <div v-if="notice" class="text-xs text-green-600 bg-green-50 dark:text-green-300 dark:bg-green-900/20 rounded-lg px-3 py-2">{{ notice }}</div>

        <!-- 提交按钮：品牌橙同色系微渐变（不引入紫/蓝多色） -->
        <button type="submit" :disabled="submitting || (isRegister && !siteConfig.register.enabled)"
          class="w-full py-3 text-sm font-semibold bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 disabled:opacity-50 disabled:hover:from-primary-500 disabled:hover:to-primary-600 text-white rounded-xl shadow-sm transition-all">
          {{ submitButtonText }}
        </button>
      </form>

      <!-- 底部：找回态返回登录；登录/注册态用「或」分隔的模式切换 -->
      <div class="mt-6">
        <div v-if="isForgot" class="text-center">
          <button @click="backToLogin" class="text-xs text-primary-600 hover:text-primary-700 transition-colors">
            返回登录
          </button>
        </div>
        <template v-else>
          <div class="flex items-center gap-3">
            <span class="h-px flex-1 bg-surface-3"></span>
            <span class="text-xs text-text-tertiary">或</span>
            <span class="h-px flex-1 bg-surface-3"></span>
          </div>
          <div class="mt-4 text-center">
            <button v-if="isRegister || siteConfig.register.enabled" @click="toggleMode" class="text-xs text-primary-600 hover:text-primary-700 transition-colors">
              {{ isRegister ? '已有账号？去登录' : '没有账号？去注册' }}
            </button>
            <span v-else class="text-xs text-text-tertiary">当前暂未开放注册，请联系管理员</span>
          </div>
        </template>
      </div>

      <AgreementDialog
        :open="agreementDialog.open"
        :title="agreementDialog.title"
        :content-html="agreementDialog.content"
        @close="agreementDialog.open = false"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useSiteConfigStore } from '@/stores/site-config'
import AgreementDialog from '@/components/AgreementDialog.vue'
import { appName, appAbbr, appIconUrl } from '@/utils/branding'
import { getHomePath } from '@/utils/home-path'

// 输入框前置线性图标（heroicons outline 风格，描边用 currentColor，统一中性灰）
const icons = {
  user: 'M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.25a8.25 8.25 0 0 1 15 0',
  lock: 'M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-1.5 0h12a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-12a1.5 1.5 0 0 1-1.5-1.5V12a1.5 1.5 0 0 1 1.5-1.5Z',
  phone: 'M9 1.5h6a1.5 1.5 0 0 1 1.5 1.5v18a1.5 1.5 0 0 1-1.5 1.5H9a1.5 1.5 0 0 1-1.5-1.5V3A1.5 1.5 0 0 1 9 1.5Zm1.5 18h3',
  shield: 'M11.998 2.25 4.5 5.25v5.379c0 4.486 3.097 7.32 7.498 8.621 4.401-1.3 7.498-4.135 7.498-8.62V5.25l-7.498-3Z'
}

const router = useRouter()
const store = useCloudAuthStore()
const siteConfig = useSiteConfigStore()

// 登录页背景图（云控端配置，空则用 login-root 的品牌橙光晕兜底）
const loginBgUrl = computed(() => siteConfig.loginBackground.url)

// 三种模式：登录 / 注册 / 找回密码
const isRegister = ref(false)
const isForgot = ref(false)
const isLogin = computed(() => !isRegister.value && !isForgot.value)

const submitting = ref(false)
const error = ref('')
const notice = ref('')
const form = ref({ username: '', password: '', confirmPassword: '', nickname: '', phone: '', code: '' })
const rememberUsername = ref(false)
const rememberPassword = ref(false)
// 注册页协议勾选：默认不勾选，提交前必须勾选。切换模式时重置
const agreed = ref(false)
const agreementDialog = ref<{ open: boolean; title: string; content: string }>({
  open: false,
  title: '',
  content: '',
})

// 验证码倒计时
const countdown = ref(0)
const sendingCode = ref(false)
let countdownTimer: ReturnType<typeof setInterval> | null = null

// 注册是否需要短信验证（云控端「注册短信验证」开关）
const needSms = computed(() => siteConfig.register.sms_verify_enabled)
// 是否展示验证码输入：找回密码恒显示；注册在开启短信验证时显示
const showSmsCode = computed(() => isForgot.value || (isRegister.value && needSms.value))

const subtitle = computed(() => isForgot.value ? '找回密码' : (isRegister.value ? '注册账号' : '登录账号'))
const submitButtonText = computed(() => {
  if (submitting.value) return '请稍候...'
  if (isForgot.value) return '重置密码'
  return isRegister.value ? '注册' : '登录'
})

function openAgreement(type: 'register' | 'privacy') {
  const a = type === 'register' ? siteConfig.agreements.register : siteConfig.agreements.privacy
  agreementDialog.value = {
    open: true,
    title: a.title || (type === 'register' ? '注册协议' : '隐私协议'),
    content: a.content || '',
  }
}

// 切换模式时清理瞬时状态，避免提示 / 勾选 / 验证码残留
function resetTransientState() {
  error.value = ''
  notice.value = ''
  agreed.value = false
  form.value.code = ''
}

function toggleMode() {
  if (!isRegister.value && !siteConfig.register.enabled) {
    error.value = '当前暂未开放注册，请联系管理员'
    return
  }
  isRegister.value = !isRegister.value
  isForgot.value = false
  resetTransientState()
}

function goForgot() {
  isForgot.value = true
  isRegister.value = false
  resetTransientState()
}

function backToLogin() {
  isForgot.value = false
  isRegister.value = false
  resetTransientState()
}

// 与云控端 UserController/AuthController 保持一致：中/英/数/下划线
const NAME_REGEX = /^[a-zA-Z0-9_\u4e00-\u9fa5]+$/
const MOBILE_REGEX = /^1[3-9]\d{9}$/

onMounted(() => {
  void siteConfig.fetch()
  const ru = localStorage.getItem('login_remember_username')
  const rp = localStorage.getItem('login_remember_password')
  if (ru === '1') {
    rememberUsername.value = true
    form.value.username = localStorage.getItem('login_saved_username') || ''
  }
  if (rp === '1') {
    rememberPassword.value = true
    form.value.password = localStorage.getItem('login_saved_password') || ''
  }
})

onBeforeUnmount(() => {
  if (countdownTimer) clearInterval(countdownTimer)
})

watch(rememberUsername, (v) => {
  localStorage.setItem('login_remember_username', v ? '1' : '0')
  if (!v) localStorage.removeItem('login_saved_username')
})
watch(rememberPassword, (v) => {
  localStorage.setItem('login_remember_password', v ? '1' : '0')
  if (!v) localStorage.removeItem('login_saved_password')
})

const LOGIN_ERROR_MAP: Record<string, string> = {
  'Invalid credentials': '用户名或密码错误',
  'Account disabled': '账号已被禁用，请联系管理员',
  'Old password incorrect': '原密码不正确',
  'AUTH_EXPIRED': '登录已过期，请重新登录',
  'The username has already been taken': '该用户名已被注册',
  'The nickname has already been taken': '该昵称已被使用',
  'The email has already been taken': '该邮箱已被使用',
  'Failed to fetch': '网络请求失败，请检查网络连接',
  '网络请求失败': '网络请求失败，请检查网络连接',
}

function translateLoginError(msg: string): string {
  if (!msg) return '操作失败'
  // 浏览器直开 Vite（无 Electron preload）时，部分桌面能力不可用；网络失败给更具体指引
  const inBrowserShell = !(window as unknown as { api?: unknown }).api
  for (const [key, val] of Object.entries(LOGIN_ERROR_MAP)) {
    if (msg.includes(key)) {
      if (inBrowserShell && (key === 'Failed to fetch' || key === '网络请求失败')) {
        return '无法连接云控服务。若在浏览器打开本页，请改用 Electron 桌面窗口登录；或检查本机网络与 API 域名。'
      }
      return val
    }
  }
  return msg
}

function startCountdown(seconds = 60) {
  countdown.value = seconds
  if (countdownTimer) clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0 && countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
  }, 1000)
}

async function handleSendCode() {
  error.value = ''
  notice.value = ''
  const phone = form.value.phone.trim()
  if (!MOBILE_REGEX.test(phone)) {
    error.value = '请输入正确的手机号'
    return
  }
  sendingCode.value = true
  try {
    const scene = isForgot.value ? 'reset_password' : 'register'
    const res = await store.sendSmsCode(scene, phone)
    notice.value = res?.message || '验证码已发送'
    startCountdown(60)
  } catch (e: any) {
    error.value = translateLoginError(e.message || '验证码发送失败')
  } finally {
    sendingCode.value = false
  }
}

function validateRegisterForm(): string | null {
  const username = form.value.username.trim()
  const nickname = form.value.nickname.trim()
  const phone = form.value.phone.trim()

  if (username.length < 6 || username.length > 16) return '用户名长度需 6-16 个字符'
  if (!NAME_REGEX.test(username)) return '用户名只能包含中文 / 英文 / 数字 / 下划线'

  if (nickname) {
    if (nickname.length < 2 || nickname.length > 30) return '昵称长度需 2-30 个字符'
    if (!NAME_REGEX.test(nickname)) return '昵称只能包含中文 / 英文 / 数字 / 下划线'
  }

  // 开启短信验证：手机号 + 验证码必填且格式校验；未开启：手机号选填但填了要合法
  if (needSms.value) {
    if (!MOBILE_REGEX.test(phone)) return '请输入正确的手机号'
    if (!form.value.code.trim()) return '请输入短信验证码'
  } else if (phone && phone.length > 20) {
    return '手机号最多 20 位'
  }

  if (form.value.password.length < 6) return '密码至少 6 位'
  if (form.value.password !== form.value.confirmPassword) return '两次密码不一致'
  if (!agreed.value) return '请勾选并阅读《' + (siteConfig.agreements.register.title || '注册协议') + '》和《' + (siteConfig.agreements.privacy.title || '隐私协议') + '》'
  return null
}

function validateForgotForm(): string | null {
  const phone = form.value.phone.trim()
  if (!MOBILE_REGEX.test(phone)) return '请输入正确的手机号'
  if (!form.value.code.trim()) return '请输入短信验证码'
  if (form.value.password.length < 6) return '新密码至少 6 位'
  if (form.value.password !== form.value.confirmPassword) return '两次密码不一致'
  return null
}

async function handleSubmit() {
  error.value = ''
  notice.value = ''

  // 找回密码流程
  if (isForgot.value) {
    const msg = validateForgotForm()
    if (msg) { error.value = msg; return }
    submitting.value = true
    try {
      await store.resetPassword(form.value.phone.trim(), form.value.code.trim(), form.value.password)
      // 成功后不自动登录：回到登录页并提示用户用新密码登录
      backToLogin()
      notice.value = '密码重置成功，请使用新密码登录'
    } catch (e: any) {
      error.value = translateLoginError(e.message || '重置失败')
    } finally {
      submitting.value = false
    }
    return
  }

  // 登录 / 注册流程
  if (!form.value.username.trim() || !form.value.password.trim()) {
    error.value = '请填写用户名和密码'
    return
  }
  if (isRegister.value) {
    if (!siteConfig.register.enabled) {
      error.value = '当前暂未开放注册，请联系管理员'
      return
    }
    const msg = validateRegisterForm()
    if (msg) { error.value = msg; return }
  }

  submitting.value = true
  try {
    if (isRegister.value) {
      await store.register(
        form.value.username.trim(),
        form.value.password,
        form.value.nickname.trim() || undefined,
        form.value.phone.trim() || undefined,
        needSms.value ? form.value.code.trim() : undefined,
      )
    } else {
      await store.login(form.value.username, form.value.password)
    }
    if (rememberUsername.value) localStorage.setItem('login_saved_username', form.value.username)
    else localStorage.removeItem('login_saved_username')
    if (rememberPassword.value) localStorage.setItem('login_saved_password', form.value.password)
    else localStorage.removeItem('login_saved_password')
    router.replace(getHomePath())
  } catch (e: any) {
    error.value = translateLoginError(e.message || '操作失败')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
/* 登录页背景：极淡品牌橙径向光晕叠加在主题表面色上（方案 b，不引入紫/蓝） */
.login-root {
  background:
    radial-gradient(125% 80% at 50% -12%, rgba(242, 118, 56, 0.1), transparent 60%),
    var(--surface-1);
}
/* 深色模式下光晕更克制，避免发脏 */
:global(.dark) .login-root {
  background:
    radial-gradient(125% 80% at 50% -12%, rgba(242, 118, 56, 0.06), transparent 60%),
    var(--surface-1);
}
</style>
