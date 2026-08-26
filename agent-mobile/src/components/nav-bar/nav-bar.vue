<script setup lang="ts">
/** 自定义导航栏：占位高度自适应状态栏 + 小程序胶囊避让 */
import { computed } from 'vue'
import { getNavMetrics } from '@/utils/system'

const props = withDefaults(
  defineProps<{
    title?: string
    /** 是否显示返回按钮 */
    back?: boolean
    /** 关闭样式（× 代替 ‹） */
    close?: boolean
    /** 背景透明 */
    transparent?: boolean
    color?: string
    bgColor?: string
    /** 是否固定定位（默认占位不固定） */
    fixed?: boolean
  }>(),
  { back: true, close: false, transparent: true, color: '#111111', bgColor: '#ffffff', fixed: false },
)

const emit = defineEmits<{ back: [] }>()

const metrics = getNavMetrics()

const wrapStyle = computed(() => {
  const bg = props.transparent ? 'transparent' : props.bgColor
  const position = props.fixed ? 'position:fixed;top:0;left:0;right:0;z-index:100;' : ''
  return `${position}padding-top:${metrics.statusBarHeight}px;background:${bg};`
})

const barStyle = computed(
  () => `height:${metrics.navBarHeight}px;padding-right:${metrics.capsuleRight}px;`,
)

function onBack() {
  emit('back')
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
  } else {
    uni.switchTab({ url: '/pages/home/home' })
  }
}
</script>

<template>
  <view class="nav-bar" :style="wrapStyle">
    <view class="nav-bar__bar" :style="barStyle">
      <view v-if="back" class="nav-bar__left" @tap="onBack">
        <ui-icon :name="close ? 'close' : 'back'" :size="close ? 40 : 44" :color="color" />
      </view>
      <view v-else class="nav-bar__left" />
      <text class="nav-bar__title" :style="`color:${color}`">{{ title }}</text>
      <view class="nav-bar__right">
        <slot name="right" />
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.nav-bar {
  width: 100%;

  &__bar {
    display: flex;
    align-items: center;
    padding-left: $gap-page;
  }

  &__left {
    width: 60rpx;
    display: flex;
    align-items: center;
  }

  &__title {
    flex: 1;
    text-align: center;
    font-size: $fs-title;
    font-weight: 600;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &__right {
    min-width: 60rpx;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: $gap-page;
  }
}
</style>
