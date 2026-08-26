<script setup lang="ts">
/**
 * 工具介绍页：一套模板承载多个功能，左右横滑切换（动效清单 #11）
 * 对照 原型图/工具介绍页面.jpg、工具功能介绍页.jpg、461ced…、4e7476…、b0eda8…
 * 页面主题色随功能变化，CTA 固定「立即体验」
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { introSlides, type IntroSlide } from '@/api/mock/data'

const slides = ref<IntroSlide[]>([])
const current = ref(0)

const active = computed<IntroSlide | undefined>(() => slides.value[current.value])

/**
 * 两类背景（实测）：
 * top  —— y=0 满色，35% 收白
 * band —— 顶部先白，11% 到峰值色，68% 收白
 */
const bgStyle = computed(() => {
  const theme = active.value?.theme || '#f2f2f7'
  if (active.value?.gradient === 'band') {
    return `background:linear-gradient(180deg, #ffffff 0%, ${theme} 11%, #ffffff 68%)`
  }
  return `background:linear-gradient(180deg, ${theme} 0%, #ffffff 35%)`
})

onLoad((query) => {
  const uuid = (query?.uuid as string) || ''
  // 未命中不再回落到套图（会张冠李戴），保持空数组交给模板兜底
  slides.value = introSlides[uuid] || introSlides['app-ecommerce-suite'] || []
})

function onChange(e: { detail: { current: number } }) {
  current.value = e.detail.current
}

function start() {
  const uuid = active.value?.appUuid
  if (!uuid) return
  uni.navigateTo({ url: `/pages-sub/tool-run/tool-run?uuid=${uuid}` })
}
</script>

<template>
  <view class="intro" :style="bgStyle">
    <nav-bar :title="active?.title || ''" />

    <swiper
      class="intro__swiper"
      :current="current"
      :disable-touch="slides.length <= 1"
      @change="onChange"
    >
      <swiper-item v-for="slide in slides" :key="slide.key">
        <view class="intro__slide">
          <view class="intro__visual">
            <!-- 组合示意：左侧竖排参考/产品缩略 + 连接符 + 右侧大结果图 -->
            <view v-if="slide.visual?.type === 'compose'" class="intro__compose">
              <view class="intro__refs">
                <image
                  v-for="(ref0, ri) in slide.visual.refs"
                  :key="ri"
                  class="intro__ref"
                  :src="ref0"
                  mode="aspectFill"
                />
              </view>
              <text class="intro__connector">{{ slide.visual.connector }}</text>
              <image class="intro__result" :src="slide.visual.result" mode="aspectFill" />
            </view>
            <!-- 单图 -->
            <image
              v-else
              class="intro__img"
              :src="slide.visual?.type === 'single' ? slide.visual.src : slide.cover"
              mode="aspectFill"
            />
          </view>
          <text class="intro__title">{{ slide.title }}</text>
          <text class="intro__desc">{{ slide.desc }}</text>
        </view>
      </swiper-item>
    </swiper>

    <view class="intro__foot">
      <view class="intro__cta" @tap="start">
        <text class="intro__cta-text">立即体验</text>
      </view>
      <!-- 指示点在 CTA 之下，等大圆点仅换色 -->
      <view v-if="slides.length > 1" class="intro__dots">
        <view
          v-for="(_, index) in slides"
          :key="index"
          class="intro__dot"
          :class="{ 'intro__dot--on': index === current }"
        />
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.intro {
  display: flex;
  flex-direction: column;
  height: 100vh;

  &__swiper {
    flex: 1;
    min-height: 0;
  }

  /* 实测：卡顶距导航 126rpx、左右留白 68rpx、标题/描述居中 */
  &__slide {
    height: 100%;
    padding: 126rpx 68rpx 0;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  /* 卡片约 6:7 固定比例，无阴影（实测卡底下方即纯白） */
  &__visual {
    width: 100%;
    aspect-ratio: 0.867;
    border-radius: 56rpx;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.5);
  }

  &__img {
    width: 100%;
    height: 100%;
  }

  &__compose {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    padding: 20rpx;
    gap: 14rpx;
  }

  &__refs {
    display: flex;
    flex-direction: column;
    gap: 14rpx;
    width: 28%;
  }

  &__ref {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 12rpx;
    background: $bg-skeleton;
  }

  &__connector {
    font-size: 40rpx;
    font-weight: 700;
    color: $ink-2;
  }

  &__result {
    flex: 1;
    height: 100%;
    border-radius: 16rpx;
    background: $bg-skeleton;
  }

  &__title {
    margin-top: 98rpx;
    font-size: 56rpx;
    font-weight: 700;
    color: $ink;
    text-align: center;
  }

  &__desc {
    margin-top: 42rpx;
    font-size: 32rpx;
    line-height: 1.45;
    color: $ink-2;
    text-align: center;
  }

  &__foot {
    padding: 92rpx $gap-page calc(32rpx + env(safe-area-inset-bottom));
  }

  &__cta {
    height: 108rpx;
    border-radius: 28rpx;
    background: $ink;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* 等大圆点，仅换色；在 CTA 之下 */
  &__dots {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 13rpx;
    padding: 32rpx 0 0;
  }

  &__dot {
    width: 12rpx;
    height: 12rpx;
    border-radius: 50%;
    background: #dbdbdb;
    transition: background $dur-base $ease-base;

    &--on {
      background: #1d1d1d;
    }
  }

  &__cta-text {
    font-size: 36rpx;
    font-weight: 600;
    color: #ffffff;
  }
}
</style>
