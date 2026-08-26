<script setup lang="ts">
/**
 * 我的：未登录/已登录态 + VIP 黑金 banner + 我的空间 + 分组菜单
 * 对照 原型图/个人中心.jpg
 */
import { computed } from 'vue'
import { getNavMetrics } from '@/utils/system'
import { useUserStore } from '@/store/user'
import { useMemberStore } from '@/store/member'
import { mineMenus } from '@/api/mock/data'

const metrics = getNavMetrics()
const headStyle = computed(() => `padding-top:${metrics.statusBarHeight + 8}px`)

const user = useUserStore()
const member = useMemberStore()

const vipLabel = computed(() => {
  if (member.level === 'premium') return '高级会员 · 权益生效中'
  if (member.level === 'basic') return '基础会员 · 权益生效中'
  return '立即开通'
})

function goLogin() {
  if (user.isLogin) return
  uni.navigateTo({ url: '/pages-sub/login/login' })
}

function goVip() {
  uni.navigateTo({ url: '/pages-sub/vip/vip' })
}

function goSpace() {
  uni.navigateTo({ url: '/pages-sub/task-history/task-history' })
}

function onMenuTap(key: string) {
  if (key === 'favorite') {
    // TODO(design)：收藏页原型未给出，先复用作图记录页
    uni.navigateTo({ url: '/pages-sub/task-history/task-history?type=favorite' })
    return
  }
  uni.showToast({ title: '功能开发中', icon: 'none' })
}

function onScan() {
  // #ifdef MP-WEIXIN
  uni.scanCode({ success: () => uni.showToast({ title: '扫码功能开发中', icon: 'none' }) })
  // #endif
  // #ifndef MP-WEIXIN
  uni.showToast({ title: '请在小程序中使用扫码', icon: 'none' })
  // #endif
}
</script>

<template>
  <view class="mine">
    <view class="mine__bg" />

    <scroll-view class="mine__scroll" scroll-y :show-scrollbar="false">
      <view class="mine__top" :style="headStyle">
        <view class="mine__tool" @tap="onScan">
          <ui-icon name="scan" :size="34" color="#333333" />
        </view>
        <view class="mine__tool" @tap="onMenuTap('preference')">
          <ui-icon name="setting" :size="34" color="#333333" />
        </view>
      </view>

      <!-- 用户信息 -->
      <view class="mine__user" @tap="goLogin">
        <view class="mine__avatar">
          <image v-if="user.avatar" class="mine__avatar-img" :src="user.avatar" mode="aspectFill" />
          <ui-icon v-else name="mine" :size="56" color="#bbbbbb" />
        </view>
        <view class="mine__user-text">
          <text class="mine__nickname">{{ user.isLogin ? user.nickname || '未设置昵称' : '立即登录' }}</text>
          <text class="mine__sub">{{ user.isLogin ? `美豆 ${member.beans}` : '登录后同步你的设计与素材' }}</text>
        </view>
        <ui-icon v-if="!user.isLogin" name="arrow" :size="30" color="#999999" />
      </view>

      <!-- VIP banner -->
      <view class="mine__vip" @tap="goVip">
        <view class="mine__vip-left">
          <ui-icon name="vip" :size="44" color="#f3d9b7" />
          <view class="mine__vip-text">
            <text class="mine__vip-title">美图设计室 VIP</text>
            <text class="mine__vip-sub">设计功能，无限畅用</text>
          </view>
        </view>
        <view class="mine__vip-btn">
          <text class="mine__vip-btn-text">{{ vipLabel }}</text>
        </view>
      </view>

      <!-- 我的空间 -->
      <view class="mine__card" @tap="goSpace">
        <view class="mine__card-left">
          <ui-icon name="image" :size="40" color="#5f5ffd" />
          <text class="mine__card-title">我的空间</text>
        </view>
        <ui-icon name="arrow" :size="30" color="#999999" />
      </view>

      <!-- 菜单组 -->
      <view class="mine__menus">
        <view
          v-for="(item, index) in mineMenus"
          :key="item.key"
          class="mine__menu"
          :class="{ 'mine__menu--line': index !== mineMenus.length - 1 }"
          @tap="onMenuTap(item.key)"
        >
          <view class="mine__menu-left">
            <ui-icon :name="item.icon" :size="38" color="#555555" />
            <text class="mine__menu-name">{{ item.name }}</text>
          </view>
          <ui-icon name="arrow" :size="28" color="#cccccc" />
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
  }

  &__safe {
    height: 60rpx;
  }
}
</style>
