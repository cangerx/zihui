<script setup lang="ts">
/**
 * 我的：真实账户、额度、套餐与最近任务入口
 * 对照 原型图/个人中心.jpg
 */
import { computed, ref } from 'vue'
import { onHide, onShow } from '@dcloudio/uni-app'
import { getNavMetrics } from '@/utils/system'
import { useUserStore } from '@/store/user'
import { balanceTotal } from '@/api/modules/billing'
import { getProfileSnapshot, signOut } from '@/api/modules/profile'
import { apiErrorCode, apiErrorInvalidatedSession } from '@/api/v1-client'
import { navigateToLoginOnce } from '@/api/login-navigation'
import type { AppBalance } from '@zihui/contracts'

const metrics = getNavMetrics()
const headStyle = computed(() => `padding-top:${metrics.statusBarHeight + 8}px`)

const user = useUserStore()
const balances = ref<AppBalance[]>([])
const loading = ref(false)
const loadError = ref('')
const signingOut = ref(false)
let refreshSequence = 0

const creditBalance = computed(() => balanceTotal(balances.value, 'credit'))
const tokenBalance = computed(() => balanceTotal(balances.value, 'token'))
const balanceSummary = computed(() => {
  if (loading.value) return '正在同步账户与额度'
  if (loadError.value) return '账户同步失败，请重试'
  return `创作额度 ${creditBalance.value} · Token ${tokenBalance.value}`
})

onShow(() => {
  if (user.isLogin) refreshProfile()
  else resetProfileState()
})

onHide(() => {
  invalidateProfileRefresh()
})

function invalidateProfileRefresh() {
  refreshSequence += 1
  loading.value = false
}

function resetProfileState() {
  invalidateProfileRefresh()
  balances.value = []
  loading.value = false
  loadError.value = ''
}

async function refreshProfile() {
  if (!user.isLogin || loading.value) return
  const requestToken = user.token
  const sequence = ++refreshSequence
  loading.value = true
  loadError.value = ''
  try {
    const snapshot = await getProfileSnapshot()
    if (sequence !== refreshSequence || requestToken !== user.token || !user.isLogin) return
    user.applyAccount(snapshot.account)
    balances.value = snapshot.balances
  } catch (error) {
    if (sequence !== refreshSequence) return
    if (apiErrorCode(error) === 401) {
      if (!apiErrorInvalidatedSession(error)) return
      user.logout()
      resetProfileState()
      navigateToLoginOnce()
      return
    }
    if (requestToken !== user.token || !user.isLogin) return
    balances.value = []
    loadError.value = '暂时无法获取账户信息，请检查网络后重试'
  } finally {
    if (sequence === refreshSequence) loading.value = false
  }
}

function goLogin() {
  if (user.isLogin) return
  navigateToLoginOnce()
}

function goVip() {
  uni.navigateTo({ url: '/pages-sub/vip/vip' })
}

function goSpace() {
  uni.navigateTo({ url: '/pages-sub/task-history/task-history' })
}

function confirmSignOut() {
  if (!user.isLogin || signingOut.value) return
  uni.showModal({
    title: '退出登录',
    content: '退出后仍可浏览公开内容，账户数据不会被删除。',
    confirmText: '退出',
    confirmColor: '#c63737',
    success: (result) => {
      if (result.confirm) void performSignOut()
    },
  })
}

async function performSignOut() {
  if (signingOut.value) return
  const requestToken = user.token
  invalidateProfileRefresh()
  signingOut.value = true
  try {
    await signOut()
  } catch {
    // Local credentials must still be removed when the network or blacklist
    // backend is unavailable. The expired token cannot remain active in UI.
  } finally {
    if (!user.token || user.token === requestToken) {
      user.logout()
      resetProfileState()
    }
    signingOut.value = false
  }
}
</script>

<template>
  <view class="mine">
    <view class="mine__bg" />

    <scroll-view class="mine__scroll" scroll-y :show-scrollbar="false">
      <view class="mine__top" :style="headStyle" />

      <!-- 用户信息 -->
      <view class="mine__user" @tap="goLogin">
        <view class="mine__avatar">
          <image v-if="user.avatar" class="mine__avatar-img" :src="user.avatar" mode="aspectFill" />
          <ui-icon v-else name="mine" :size="56" color="#bbbbbb" />
        </view>
        <view class="mine__user-text">
          <text class="mine__nickname">{{ user.isLogin ? user.nickname || '未设置昵称' : '立即登录' }}</text>
          <text class="mine__sub">{{ user.isLogin ? balanceSummary : '登录后同步你的任务与额度' }}</text>
        </view>
        <ui-icon v-if="!user.isLogin" name="arrow" :size="30" color="#999999" />
      </view>

      <view v-if="user.isLogin && loadError" class="mine__error" @tap="refreshProfile">
        <ui-icon name="refresh" :size="30" color="#c63737" />
        <text class="mine__error-text">{{ loadError }}</text>
        <text class="mine__retry">重试</text>
      </view>

      <!-- 套餐入口只展示服务端已有的套餐与额度语义，不推断会员等级。 -->
      <view class="mine__vip" @tap="goVip">
        <view class="mine__vip-left">
          <ui-icon name="vip" :size="44" color="#f3d9b7" />
          <view class="mine__vip-text">
            <text class="mine__vip-title">套餐与额度</text>
            <text class="mine__vip-sub">查看可用套餐与当前创作额度</text>
          </view>
        </view>
        <view class="mine__vip-btn">
          <text class="mine__vip-btn-text">查看</text>
        </view>
      </view>

      <!-- 最近任务 -->
      <view class="mine__card" @tap="goSpace">
        <view class="mine__card-left">
          <ui-icon name="image" :size="40" color="#5f5ffd" />
          <text class="mine__card-title">最近任务</text>
        </view>
        <ui-icon name="arrow" :size="30" color="#999999" />
      </view>

      <view v-if="user.isLogin" class="mine__menus">
        <view class="mine__menu" @tap="confirmSignOut">
          <view class="mine__menu-left">
            <ui-icon name="back" :size="38" color="#c63737" />
            <text class="mine__menu-name mine__menu-name--danger">
              {{ signingOut ? '正在退出...' : '退出登录' }}
            </text>
          </view>
        </view>
      </view>

      <view class="mine__safe" />
    </scroll-view>
  </view>
</template>

<style lang="scss" scoped>
.mine {
  position: relative;
  height: 100vh;
  overflow: hidden;

  /* 实测顶部为左淡蓝 (227,240,246) → 右黄绿 (207,222,191) 斜向渐变，纵向缓收白约 y500→300rpx */
  &__bg {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 420rpx;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0) 30%, $bg-page 100%),
      linear-gradient(105deg, #dfeaf5 0%, #e2ece8 55%, #d9e7c6 100%);
  }

  &__scroll {
    position: relative;
    height: 100%;
  }

  &__top {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 42rpx;
    padding: 0 $gap-page 8rpx;
  }

  &__user {
    display: flex;
    align-items: center;
    gap: 24rpx;
    padding: 24rpx $gap-page 32rpx;
  }

  /* 实测头像 132px ≈ 80rpx */
  &__avatar {
    width: 80rpx;
    height: 80rpx;
    border-radius: 50%;
    background: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  &__avatar-img {
    width: 100%;
    height: 100%;
  }

  &__user-text {
    flex: 1;
    min-width: 0;
  }

  &__nickname {
    display: block;
    font-size: 36rpx;
    font-weight: 700;
    color: $ink;
  }

  &__sub {
    display: block;
    margin-top: 8rpx;
    font-size: $fs-aux;
    color: $ink-2;
  }

  &__error {
    min-height: 78rpx;
    margin: -12rpx $gap-page 20rpx;
    padding: 14rpx 20rpx;
    border: 1px solid rgba(198, 55, 55, 0.18);
    border-radius: $radius-btn;
    background: rgba(255, 244, 244, 0.92);
    display: flex;
    align-items: center;
    gap: 12rpx;
  }

  &__error-text {
    flex: 1;
    min-width: 0;
    font-size: 24rpx;
    line-height: 1.45;
    color: $danger;
  }

  &__retry {
    font-size: 24rpx;
    font-weight: 600;
    color: $danger;
  }

  &__vip {
    margin: 0 $gap-page;
    height: 152rpx;
    border-radius: $radius-card;
    padding: 0 $gap-card;
    background: linear-gradient(115deg, #2a2118 0%, #141414 60%);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__vip-left {
    display: flex;
    align-items: center;
    gap: 18rpx;
    flex: 1;
    min-width: 0;
  }

  &__vip-title {
    display: block;
    font-size: 32rpx;
    font-weight: 700;
    color: $vip-text;
  }

  &__vip-sub {
    display: block;
    margin-top: 6rpx;
    font-size: $fs-aux;
    color: rgba(243, 217, 183, 0.65);
  }

  &__vip-btn {
    height: 60rpx;
    padding: 0 26rpx;
    border-radius: $radius-btn;
    background: linear-gradient(90deg, $vip-gold-from, $vip-gold-to);
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  &__vip-btn-text {
    font-size: $fs-aux;
    font-weight: 600;
    color: #4a2c10;
  }

  &__card {
    margin: 24rpx $gap-page 0;
    height: 115rpx;
    border-radius: $radius-card;
    padding: 0 $gap-card;
    background: $bg-card;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__card-left {
    display: flex;
    align-items: center;
    gap: 18rpx;
  }

  &__card-title {
    font-size: 32rpx;
    font-weight: 600;
    color: $ink;
  }

  &__menus {
    margin: 24rpx $gap-page 0;
    border-radius: $radius-card;
    background: $bg-card;
    padding: 0 $gap-card;
  }

  &__menu {
    height: 114rpx;
    display: flex;
    align-items: center;
    justify-content: space-between;

    &--line {
      border-bottom: 1px solid $line;
    }
  }

  &__menu-left {
    display: flex;
    align-items: center;
    gap: 20rpx;
  }

  &__menu-name {
    font-size: $fs-body;
    color: $ink;

    &--danger {
      color: $danger;
    }
  }

  &__safe {
    height: 60rpx;
  }
}
</style>
