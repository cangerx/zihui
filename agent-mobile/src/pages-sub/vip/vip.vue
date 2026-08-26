<script setup lang="ts">
/**
 * VIP 套餐购买页：黑金全屏
 * 对照 原型图/套餐购买.jpg
 * 注意：小程序虚拟支付受微信政策限制（iOS 不可直接支付），支付动作先占位，
 * 待产品确认降级方案（H5 支付 / 仅安卓）。见 docs/原型图分析.md §6.2
 */
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getNavMetrics } from '@/utils/system'
import { USE_MOCK } from '@/api/config'
import { balanceTotal, getBillingSnapshot, type MobilePlan, type MobileVipTier } from '@/api/modules/billing'
import { useUserStore } from '@/store/user'
import { useMemberStore } from '@/store/member'
import type { AppBalance } from '@zihui/contracts'

const metrics = getNavMetrics()
const user = useUserStore()
const member = useMemberStore()

const tierIndex = ref(0)
const planIndex = ref(1)
const agreed = ref(false)
const tiers = ref<MobileVipTier[]>([])
const balances = ref<AppBalance[]>([])
const loading = ref(true)
const loadError = ref('')
let loadedForLogin = false

const tier = computed<MobileVipTier>(() => tiers.value[tierIndex.value] || {
  key: 'empty',
  name: '会员套餐',
  slogan: '',
  benefits: [],
  plans: [],
  beanTip: '',
  agreement: '',
  cta: { title: '购买功能尚未开放', sub: '支付能力尚未开放' },
})
const plan = computed<MobilePlan | null>(() => tier.value.plans[planIndex.value] || null)
const hasPlans = computed(() => tiers.value.length > 0 && tier.value.plans.length > 0)
const creditBalance = computed(() => balanceTotal(balances.value, 'credit'))
const tokenBalance = computed(() => balanceTotal(balances.value, 'token'))

/**
 * CTA 文案：不能用 badge 是否存在来判断「试用/开通」——高级会员推荐档的
 * badge 是「省690元」，那样会产出「¥598试用」。
 * tier.cta 描述的是推荐档；选了别的档就按档位价格生成。
 */
const ctaText = computed(() => {
  if (!USE_MOCK) return { title: '购买功能尚未开放', sub: '支付能力尚未开放' }
  if (!plan.value) return tier.value.cta
  if (plan.value.recommend) return tier.value.cta
  return {
    title: `¥${plan.value.price}开通`,
    sub: `${plan.value.name} ${plan.value.perDay || ''}`,
  }
})

const headStyle = computed(() => `padding-top:${metrics.statusBarHeight + 8}px`)

function close() {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: '/pages/mine/mine' })
}

function pickTier(index: number) {
  tierIndex.value = index
  planIndex.value = tiers.value[index]?.plans.findIndex((p) => p.recommend) ?? -1
  if (planIndex.value < 0) planIndex.value = 0
}

async function loadBilling() {
  if (!USE_MOCK && loadedForLogin === user.isLogin && !loading.value) return
  loading.value = true
  loadError.value = ''
  try {
    const snapshot = await getBillingSnapshot(user.isLogin)
    tiers.value = snapshot.tiers
    balances.value = snapshot.balances
    member.beans = creditBalance.value
    if (tierIndex.value >= tiers.value.length) tierIndex.value = 0
    const recommended = tier.value.plans.findIndex((item) => item.recommend)
    planIndex.value = recommended >= 0 ? recommended : 0
    loadedForLogin = user.isLogin
  } catch {
    tiers.value = []
    balances.value = []
    loadError.value = '套餐信息加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

onLoad(loadBilling)
onShow(() => {
  if (!loading.value && loadedForLogin !== user.isLogin) loadBilling()
})

function goLogin() {
  uni.navigateTo({ url: '/pages-sub/login/login' })
}

function pay() {
  if (!USE_MOCK) {
    uni.showToast({ title: '支付功能尚未开放', icon: 'none' })
    return
  }
  if (!user.isLogin) {
    goLogin()
    return
  }
  if (!agreed.value) {
    uni.showToast({ title: '请先勾选会员协议', icon: 'none' })
    return
  }
  uni.showToast({ title: '支付功能尚未开放', icon: 'none' })
}

function openLink(name: string) {
  uni.showToast({ title: `${name}页面待提供`, icon: 'none' })
}

/** 把协议文案按《...》拆成片段，书名号内为可点击高亮链接 */
const agreementParts = computed(() =>
  tier.value.agreement.split(/(《[^》]*》)/).map((text) => ({
    text,
    link: text.startsWith('《'),
  })),
)
</script>

<template>
  <view class="vip">
    <view class="vip__head" :style="headStyle">
      <view class="vip__close" @tap="close">
        <ui-icon name="close" :size="40" color="#f3d9b7" />
      </view>
    </view>

    <scroll-view class="vip__body" scroll-y :show-scrollbar="false">
      <!-- 会员等级 tab -->
      <view v-if="hasPlans" class="vip__tiers">
        <view
          v-for="(item, index) in tiers"
          :key="item.key"
          class="vip__tier"
          :class="{ 'vip__tier--on': index === tierIndex }"
          @tap="pickTier(index)"
        >
          <text class="vip__tier-text">{{ item.name }}</text>
        </view>
      </view>

      <!-- 权益卡 -->
      <view v-if="hasPlans" class="vip__benefit">
        <view class="vip__benefit-left">
          <text class="vip__slogan">{{ tier.slogan }}</text>
          <view v-for="b in tier.benefits" :key="b" class="vip__brow">
            <ui-icon name="check" :size="22" color="#e8b578" />
            <text class="vip__btext">{{ b }}</text>
          </view>
        </view>
        <view class="vip__badge">
          <ui-icon name="vip" :size="70" color="#f5c08c" />
        </view>
      </view>

      <!-- 登录引导 -->
      <view v-if="!user.isLogin" class="vip__login" @tap="goLogin">
        <text class="vip__login-text">登录后可查看会员状态与权益</text>
        <text class="vip__login-btn">立即登录</text>
      </view>

      <view v-else class="vip__balance">
        <text class="vip__balance-item">积分 {{ creditBalance }}</text>
        <text class="vip__balance-item">金币 {{ tokenBalance }}</text>
      </view>

      <!-- 价格卡 -->
      <view v-if="hasPlans" class="vip__plans">
        <view
          v-for="(item, index) in tier.plans"
          :key="item.code || item.id"
          class="vip__plan"
          :class="{ 'vip__plan--on': index === planIndex }"
          @tap="planIndex = index"
        >
          <view v-if="item.badge" class="vip__plan-badge">
            <text class="vip__plan-badge-text">{{ item.badge }}</text>
          </view>
          <text class="vip__plan-name">{{ item.name }}</text>
          <view v-if="item.price > 0" class="vip__plan-price">
            <text class="vip__plan-unit">{{ item.currency === 'CNY' ? '¥' : item.currency }}</text>
            <text class="vip__plan-value">{{ item.price }}</text>
          </view>
          <text v-else class="vip__plan-price-empty">按服务端计价</text>
          <text v-if="item.originPrice" class="vip__plan-origin">¥{{ item.originPrice }}</text>
          <text class="vip__plan-per">{{ item.perDay || `${item.durationDays}天 · 配额以服务端为准` }}</text>
        </view>
      </view>

      <text v-if="hasPlans" class="vip__bean">{{ tier.beanTip }}</text>

      <!-- 协议：书名号片段为可点击高亮链接 -->
      <view v-if="hasPlans" class="vip__agree">
        <view
          class="vip__checkbox"
          :class="{ 'vip__checkbox--on': agreed }"
          @tap="agreed = !agreed"
        >
          <ui-icon v-if="agreed" name="check" :size="18" color="#141414" />
        </view>
        <text class="vip__agree-text">
          <text
            v-for="(part, i) in agreementParts"
            :key="i"
            :class="{ 'vip__agree-link': part.link }"
            @tap="part.link && openLink(part.text)"
          >{{ part.text }}</text>
        </text>
      </view>

      <!-- 支付能力尚未接通，不展示可执行的支付方式选择器。 -->
      <view class="vip__pay-row vip__pay-row--disabled">
        <ui-icon name="question" :size="30" color="#8c7a63" />
        <text class="vip__pay-name">支付功能暂未开放</text>
      </view>

      <view v-if="!loading && !hasPlans" class="vip__empty">
        <ui-icon name="vip" :size="76" color="#b89a78" />
        <text class="vip__empty-title">{{ loadError ? '套餐暂不可用' : '购买功能尚未开放' }}</text>
        <text class="vip__empty-text">{{ loadError || '套餐与支付接口接入后将在这里展示' }}</text>
      </view>

      <view class="vip__safe" />
    </scroll-view>

    <!-- 底部 CTA -->
    <view class="vip__foot">
      <view class="vip__cta" :class="{ 'vip__cta--disabled': !USE_MOCK }" @tap="pay">
        <text class="vip__cta-title">{{ ctaText.title }}</text>
        <text class="vip__cta-sub">{{ ctaText.sub }}</text>
      </view>
      <view class="vip__links">
        <text class="vip__link" @tap="openLink('联系我们')">联系我们</text>
        <text class="vip__link" @tap="openLink('会员协议')">会员协议</text>
        <text class="vip__link" @tap="openLink('隐私条款')">隐私条款</text>
        <text class="vip__link" @tap="openLink('权益兑换')">权益兑换</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.vip {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: linear-gradient(180deg, #2f2a24 0%, $vip-bg 38%);

  &__head {
    display: flex;
    justify-content: flex-end;
    padding: 0 $gap-page 8rpx;
  }

  &__close {
    width: 60rpx;
    height: 60rpx;
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  &__body {
    flex: 1;
    min-height: 0;
  }

  /* 通栏分段控件：整条深灰容器 + 两个等分 item，选中项加高亮块（实测容器高 116px≈69rpx） */
  &__tiers {
    display: flex;
    align-items: center;
    height: 69rpx;
    margin: 8rpx $gap-page 0;
    padding: 5rpx;
    border-radius: $radius-btn;
    background: rgba(255, 255, 255, 0.06);
  }

  &__tier {
    flex: 1;
    height: 100%;
    border-radius: $radius-btn;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background $dur-fast $ease-base;

    &--on {
      background: rgba(245, 192, 140, 0.16);
    }
  }

  &__tier-text {
    font-size: $fs-body;
    color: rgba(243, 217, 183, 0.6);
  }

  &__tier--on &__tier-text {
    color: $vip-text;
    font-weight: 600;
  }

  &__benefit {
    margin: 28rpx $gap-page 0;
    padding: 32rpx $gap-card;
    border-radius: $radius-card;
    background: linear-gradient(120deg, $vip-card, rgba(47, 42, 36, 0.55));
    border: 1px solid rgba(245, 192, 140, 0.2);
    display: flex;
    align-items: center;
  }

  &__benefit-left {
    flex: 1;
    min-width: 0;
  }

  &__slogan {
    display: block;
    margin-bottom: 18rpx;
    font-size: 38rpx;
    font-weight: 700;
    color: $vip-text;
  }

  &__brow {
    display: flex;
    align-items: center;
    gap: 10rpx;
    margin-top: 10rpx;
  }

  &__btext {
    font-size: $fs-aux;
    color: rgba(243, 217, 183, 0.72);
  }

  &__badge {
    width: 140rpx;
    height: 140rpx;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(245, 192, 140, 0.28), transparent 70%);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__login {
    margin: 24rpx $gap-page 0;
    height: 88rpx;
    padding: 0 $gap-card;
    border-radius: 24rpx;
    background: rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__login-text {
    font-size: $fs-aux;
    color: rgba(243, 217, 183, 0.6);
  }

  &__login-btn {
    font-size: $fs-aux;
    font-weight: 600;
    color: $vip-gold-from;
  }

  &__balance {
    display: flex;
    align-items: center;
    gap: 24rpx;
    margin: 24rpx $gap-page 0;
    padding: 18rpx $gap-card;
    border-radius: 16rpx;
    background: rgba(255, 255, 255, 0.05);
  }

  &__balance-item {
    font-size: $fs-aux;
    color: rgba(243, 217, 183, 0.72);
  }

  &__plans {
    display: flex;
    gap: 16rpx;
    padding: 28rpx $gap-page 0;
  }

  &__plan {
    position: relative;
    flex: 1;
    min-width: 0;
    padding: 32rpx 8rpx 22rpx;
    border-radius: 24rpx;
    background: rgba(255, 255, 255, 0.05);
    border: 2rpx solid transparent;
    display: flex;
    flex-direction: column;
    align-items: center;
    transition: all $dur-fast $ease-base;

    &--on {
      background: rgba(245, 192, 140, 0.12);
      border-color: $vip-gold-to;
    }
  }

  &__plan-badge {
    position: absolute;
    top: -16rpx;
    left: 50%;
    transform: translateX(-50%);
    height: 32rpx;
    padding: 0 12rpx;
    border-radius: 16rpx;
    background: linear-gradient(90deg, #ff9a4d, #ff6a3d);
    display: flex;
    align-items: center;
    white-space: nowrap;
  }

  &__plan-badge-text {
    font-size: 18rpx;
    color: #ffffff;
  }

  &__plan-name {
    font-size: $fs-aux;
    color: rgba(243, 217, 183, 0.8);
  }

  &__plan-price {
    display: flex;
    align-items: baseline;
    margin-top: 10rpx;
  }

  &__plan-unit {
    font-size: $fs-aux;
    color: $vip-text;
  }

  &__plan-value {
    font-size: 46rpx;
    font-weight: 700;
    color: $vip-text;
  }

  &__plan-price-empty {
    margin-top: 10rpx;
    font-size: $fs-aux;
    color: $vip-text;
  }

  &__plan-origin {
    margin-top: 4rpx;
    font-size: $fs-mini;
    color: rgba(243, 217, 183, 0.4);
    text-decoration: line-through;
  }

  &__plan-per {
    margin-top: 6rpx;
    font-size: $fs-mini;
    color: rgba(243, 217, 183, 0.55);
  }

  &__bean {
    display: block;
    padding: 24rpx $gap-page 0;
    font-size: $fs-mini;
    line-height: 1.5;
    color: rgba(243, 217, 183, 0.45);
  }

  &__agree {
    display: flex;
    align-items: flex-start;
    gap: 12rpx;
    padding: 24rpx $gap-page 0;
  }

  &__checkbox {
    width: 32rpx;
    height: 32rpx;
    margin-top: 4rpx;
    border-radius: 50%;
    border: 1px solid rgba(243, 217, 183, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;

    &--on {
      background: $vip-gold-from;
      border-color: $vip-gold-from;
    }
  }

  &__agree-text {
    flex: 1;
    font-size: $fs-mini;
    line-height: 1.5;
    color: rgba(243, 217, 183, 0.45);
  }

  &__agree-link {
    color: $vip-gold-from;
  }

  &__pay-row {
    margin: 28rpx $gap-page 0;
    height: 96rpx;
    padding: 0 $gap-card;
    border-radius: 24rpx;
    background: rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: space-between;

    &--disabled {
      justify-content: flex-start;
      gap: 14rpx;
      color: rgba(243, 217, 183, 0.58);
    }
  }

  &__pay-left {
    display: flex;
    align-items: center;
    gap: 14rpx;
  }

  &__pay-name {
    font-size: $fs-body;
    color: $vip-text;
  }

  &__pay-change {
    display: flex;
    align-items: center;
    gap: 4rpx;
  }

  &__pay-change-text {
    font-size: $fs-aux;
    color: rgba(243, 217, 183, 0.6);
  }

  &__safe {
    height: 40rpx;
  }

  &__empty {
    min-height: 460rpx;
    padding: 80rpx $gap-page;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  &__empty-title {
    margin-top: 24rpx;
    font-size: $fs-title;
    font-weight: 600;
    color: $vip-text;
  }

  &__empty-text {
    margin-top: 12rpx;
    font-size: $fs-aux;
    text-align: center;
    color: rgba(243, 217, 183, 0.62);
  }

  &__foot {
    padding: 16rpx $gap-page calc(16rpx + env(safe-area-inset-bottom));
  }

  /* 原型 CTA 为淡金实底 + 深棕字，非橙色渐变 */
  &__cta {
    height: 108rpx;
    border-radius: 54rpx;
    background: $vip-cta;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    &--disabled {
      opacity: 0.58;
    }
  }

  &__cta-title {
    font-size: 32rpx;
    font-weight: 700;
    color: #4a2c10;
  }

  &__cta-sub {
    margin-top: 2rpx;
    font-size: 18rpx;
    color: rgba(74, 44, 16, 0.7);
  }

  &__links {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 24rpx;
    padding-top: 20rpx;
  }

  &__link {
    font-size: $fs-mini;
    color: rgba(243, 217, 183, 0.4);
  }
}
</style>
