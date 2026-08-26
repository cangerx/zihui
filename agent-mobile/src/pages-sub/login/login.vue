<script setup lang="ts">
/**
 * 登录页：小程序走微信授权，H5 走邮箱登录/注册
 * 接口见 docs/API开发文档.md §3.1（微信登录接口待后端提供，mock 已占位）
 * TODO(design)：原型未提供登录页，按现有设计语言补齐
 */
import { computed, onUnmounted, ref } from 'vue'
import {
  emailLogin,
  emailRegister,
  getImageCaptcha,
  sendRegisterEmail,
  wechatLogin,
} from '@/api/modules/auth'
import { useUserStore } from '@/store/user'
import type { LoginResult } from '@/api/types'

const user = useUserStore()

/** login | register */
const mode = ref<'login' | 'register'>('login')
const email = ref('')
const password = ref('')
const emailCode = ref('')
const captchaCode = ref('')
const captcha = ref({ aes: '', image: '' })
const agreed = ref(false)
const submitting = ref(false)
const countdown = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

const isRegister = computed(() => mode.value === 'register')
const canSubmit = computed(() => {
  if (!email.value || !password.value) return false
  if (isRegister.value && !emailCode.value) return false
  return agreed.value
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

function back() {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: '/pages/home/home' })
}

function switchMode(next: 'login' | 'register') {
  mode.value = next
  if (next === 'register' && !captcha.value.aes) loadCaptcha()
}

async function loadCaptcha() {
  const res = await getImageCaptcha()
  if (res.code === 200 && res.data) captcha.value = res.data
}

function startCountdown() {
  countdown.value = 60
  timer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }, 1000)
}

async function sendCode() {
  if (countdown.value > 0) return
  if (!email.value) {
    uni.showToast({ title: '请先填写邮箱', icon: 'none' })
    return
  }
  const res = await sendRegisterEmail(email.value, captcha.value.aes, captchaCode.value)
  if (res.code === 200) {
    uni.showToast({ title: '验证码已发送', icon: 'none' })
    startCountdown()
  }
}

function applyAndBack(data: LoginResult) {
  user.applyLogin(data)
  uni.showToast({ title: '登录成功', icon: 'none' })
  setTimeout(back, 600)
}

async function submit() {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true

  if (isRegister.value) {
    const res = await emailRegister({
      email: email.value,
      password: password.value,
      email_code: emailCode.value,
      aes: captcha.value.aes || undefined,
      code: captchaCode.value || undefined,
    })
    if (res.code === 200) {
      // data 含 token 视为注册并自动登录，否则切回登录面板
      if (res.data?.token && res.data.account) {
        applyAndBack(res.data as LoginResult)
      } else {
        uni.showToast({ title: '注册成功，请登录', icon: 'none' })
        mode.value = 'login'
      }
    }
  } else {
    const res = await emailLogin(email.value, password.value)
    if (res.code === 200 && res.data?.token) applyAndBack(res.data)
  }
  submitting.value = false
}

/** 小程序微信授权登录 */
function wxLogin() {
  if (!agreed.value) {
    uni.showToast({ title: '请先同意用户协议', icon: 'none' })
    return
  }
  uni.login({
    provider: 'weixin',
    success: async (res) => {
      const result = await wechatLogin(res.code)
      if (result.code === 200 && result.data?.token) applyAndBack(result.data)
    },
    fail: () => uni.showToast({ title: '微信授权失败', icon: 'none' }),
  })
}
</script>

<template>
  <view class="login">
    <nav-bar close @back="back" />

    <view class="login__head">
      <text class="login__title">欢迎使用 AI 商业设计</text>
      <text class="login__sub">登录后同步你的设计、素材与会员权益</text>
    </view>

    <!-- 小程序：微信一键登录 -->
    <!-- #ifdef MP-WEIXIN -->
    <view class="login__wx-wrap">
      <view class="login__wx" @tap="wxLogin">
        <ui-icon name="wechat" :size="40" color="#ffffff" />
        <text class="login__wx-text">微信一键登录</text>
      </view>
    </view>
    <!-- #endif -->

    <!-- H5：邮箱登录/注册 -->
    <!-- #ifndef MP-WEIXIN -->
    <view class="login__form">
      <view class="login__tabs">
        <text
          class="login__tab"
          :class="{ 'login__tab--on': !isRegister }"
          @tap="switchMode('login')"
        >
          登录
        </text>
        <text
          class="login__tab"
          :class="{ 'login__tab--on': isRegister }"
          @tap="switchMode('register')"
        >
          注册
        </text>
      </view>

      <view class="login__field">
        <input v-model="email" class="login__input" type="text" placeholder="邮箱" />
      </view>

      <template v-if="isRegister">
        <view class="login__field login__field--row">
          <input v-model="captchaCode" class="login__input" placeholder="图片验证码" />
          <image
            v-if="captcha.image"
            class="login__captcha"
            :src="captcha.image"
            mode="aspectFit"
            @tap="loadCaptcha"
          />
          <view v-else class="login__captcha login__captcha--empty" @tap="loadCaptcha">
            <text class="login__captcha-text">点击获取</text>
          </view>
        </view>

        <view class="login__field login__field--row">
          <input v-model="emailCode" class="login__input" placeholder="邮箱验证码" />
          <view class="login__code" @tap="sendCode">
            <text class="login__code-text">
              {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
            </text>
          </view>
        </view>
      </template>

      <view class="login__field">
        <input v-model="password" class="login__input" password placeholder="密码" />
      </view>

      <view class="login__submit" :class="{ 'login__submit--on': canSubmit }" @tap="submit">
        <text class="login__submit-text">{{ isRegister ? '注册并登录' : '登录' }}</text>
      </view>
    </view>
    <!-- #endif -->

    <view class="login__agree" @tap="agreed = !agreed">
      <view class="login__checkbox" :class="{ 'login__checkbox--on': agreed }">
        <ui-icon v-if="agreed" name="check" :size="18" color="#ffffff" />
      </view>
      <text class="login__agree-text">已阅读并同意《用户协议》与《隐私政策》</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.login {
  min-height: 100vh;
  background: linear-gradient(180deg, $grad-home-top 0%, $bg-card 46%);

  &__head {
    padding: 40rpx $gap-page 48rpx;
  }

  &__title {
    display: block;
    font-size: $fs-hero;
    font-weight: 700;
    color: $ink;
  }

  &__sub {
    display: block;
    margin-top: 14rpx;
    font-size: $fs-aux;
    color: $ink-2;
  }

  &__wx-wrap {
    padding: 0 $gap-page;
  }

  &__wx {
    height: 104rpx;
    border-radius: 52rpx;
    background: $success;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14rpx;
  }

  &__wx-text {
    font-size: 32rpx;
    font-weight: 600;
    color: #ffffff;
  }

  &__form {
    padding: 0 $gap-page;
  }

  &__tabs {
    display: flex;
    align-items: center;
    gap: 40rpx;
    margin-bottom: 32rpx;
  }

  &__tab {
    font-size: $fs-title;
    color: $ink-3;

    &--on {
      font-size: 38rpx;
      font-weight: 700;
      color: $ink;
    }
  }

  &__field {
    height: 96rpx;
    margin-bottom: 20rpx;
    padding: 0 26rpx;
    border-radius: 24rpx;
    background: $bg-fill;
    display: flex;
    align-items: center;

    &--row {
      gap: 16rpx;
    }
  }

  &__input {
    flex: 1;
    font-size: $fs-body;
    color: $ink;
  }

  &__captcha {
    width: 180rpx;
    height: 68rpx;
    border-radius: 12rpx;
    background: #ffffff;

    &--empty {
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }

  &__captcha-text {
    font-size: $fs-mini;
    color: $ink-3;
  }

  &__code {
    padding: 0 20rpx;
    height: 68rpx;
    border-radius: 34rpx;
    background: $brand-light;
    display: flex;
    align-items: center;
  }

  &__code-text {
    font-size: $fs-aux;
    color: $brand;
  }

  &__submit {
    margin-top: 20rpx;
    height: 104rpx;
    border-radius: 52rpx;
    background: #d9d9e6;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background $dur-fast $ease-base;

    &--on {
      background: $brand;
    }
  }

  &__submit-text {
    font-size: 32rpx;
    font-weight: 600;
    color: #ffffff;
  }

  &__agree {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12rpx;
    padding: 40rpx $gap-page;
  }

  &__checkbox {
    width: 32rpx;
    height: 32rpx;
    border-radius: 50%;
    border: 1px solid #cccccc;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;

    &--on {
      background: $brand;
      border-color: $brand;
    }
  }

  &__agree-text {
    font-size: $fs-mini;
    color: $ink-2;
  }
}
</style>
