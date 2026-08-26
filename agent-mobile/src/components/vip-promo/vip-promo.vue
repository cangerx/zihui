<script setup lang="ts">
/**
 * 会员购买弹窗（1.1 元限时福利）
 * 对照 原型图/会员购买弹窗.jpg
 */
import { onMounted, ref } from 'vue'
import { USE_MOCK } from '@/api/config'

defineProps<{ modelValue: boolean }>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

interface VipPromoContent {
  title: string
  subtitle: string
  benefits: string[]
  cta: string
}

const promo = ref<VipPromoContent>({ title: '', subtitle: '', benefits: [], cta: '' })

onMounted(async () => {
  if (!USE_MOCK) return
  const mock = await import('@/api/mock/data')
  promo.value = mock.vipPromo
})

/** 权益 icon 与文案一一对应 */
const ICONS = ['matting', 'erase', 'image', 'suite', 'gift']

/** 弹窗为暗色主题，需覆盖 popup-sheet 的默认白底，否则安全区那条会漏白 */
const SHEET_BG = '#000000'

function open() {
  emit('update:modelValue', false)
  uni.navigateTo({ url: '/pages-sub/vip/vip' })
}
</script>

<template>
  <!-- 原型为暗色主题：主体纯黑，安全区那条也必须是黑的 -->
  <popup-sheet
    :model-value="modelValue"
    :bg-color="SHEET_BG"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <view class="vp">
      <view class="vp__close" @tap="emit('update:modelValue', false)">
        <ui-icon name="close" :size="32" color="#ffffff" />
      </view>

      <!-- 头图：橙棕→品红→紫 横向渐变，叠加纵向变暗收黑 -->
      <view class="vp__hero">
        <view class="vp__gift">
          <ui-icon name="gift" :size="88" color="#ffffff" />
        </view>
        <text class="vp__title">{{ promo.title }}</text>
        <text class="vp__subtitle">{{ promo.subtitle }}</text>
      </view>

      <view class="vp__body">
        <view class="vp__benefits">
          <view v-for="(item, index) in promo.benefits" :key="item" class="vp__benefit">
            <view class="vp__benefit-icon">
              <ui-icon :name="ICONS[index] || 'star'" :size="38" color="#f0d9c4" />
            </view>
            <text class="vp__benefit-text">{{ item }}</text>
          </view>
        </view>

        <view class="vp__cta" @tap="open">
          <text class="vp__cta-text">{{ promo.cta }}</text>
        </view>
      </view>
    </view>
  </popup-sheet>
</template>

<style lang="scss" scoped>
.vp {
  position: relative;

  /* 原型该处无底圆，只有白色 × 线条 */
  &__close {
    position: absolute;
    top: 24rpx;
    right: 32rpx;
    z-index: 2;
    width: 48rpx;
    height: 48rpx;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* 实测 y1752→2150 约 398px ≈ 237rpx 收黑；横向左 (168,103,71)→中 (207,97,136)→右 (91,74,106) */
  &__hero {
    padding: 56rpx $gap-page 40rpx;
    background:
      linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.35) 55%, #000000 100%),
      linear-gradient(90deg, #a86747 0%, #cf6188 52%, #5b4a6a 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  &__gift {
    width: 148rpx;
    height: 148rpx;
    border-radius: 40rpx;
    background: rgba(255, 255, 255, 0.22);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__title {
    margin-top: 28rpx;
    font-size: 34rpx;
    color: rgba(255, 255, 255, 0.9);
  }

  &__subtitle {
    margin-top: 10rpx;
    font-size: 48rpx;
    font-weight: 700;
    color: #ffffff;
  }

  /* 安全区由 popup-sheet 统一处理，这里不再叠加 */
  &__body {
    background: #000000;
    padding: 36rpx $gap-page 32rpx;
  }

  &__benefits {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }

  &__benefit {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  /* 实测板底为暗灰 #1c1c1c~#252525，约 142×124px → 85×74rpx */
  &__benefit-icon {
    width: 85rpx;
    height: 74rpx;
    border-radius: 20rpx;
    background: rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__benefit-text {
    margin-top: 12rpx;
    font-size: $fs-mini;
    color: rgba(255, 255, 255, 0.72);
    text-align: center;
  }

  /* 实测 (253,206,176)→(255,181,132) 淡桃横向渐变，字为深色 */
  &__cta {
    margin-top: 40rpx;
    height: 104rpx;
    border-radius: 52rpx;
    background: linear-gradient(90deg, #fdceb0 0%, #ffb584 100%);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__cta-text {
    font-size: 34rpx;
    font-weight: 700;
    color: #4a2c10;
  }
}
</style>
