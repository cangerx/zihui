<script setup lang="ts">
/**
 * 底部弹窗容器：统一遮罩 fade + 内容 translateY 弹入（动效清单 #6）
 * 所有底部弹窗（会员/模式/资产库）都复用这里，保证动效一致。
 */
import { computed, ref, watch } from 'vue'
import { getNavMetrics } from '@/utils/system'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    /** 内容高度，如 '70vh'；不传则由内容撑开 */
    height?: string
    /** 点击遮罩关闭 */
    maskClosable?: boolean
    /** 圆角背景色 */
    bgColor?: string
    /** 是否显示右上角关闭按钮 */
    closable?: boolean
    title?: string
    /** 顶部圆角，如 '44rpx'；不同弹层实测圆角不一致 */
    radius?: string
  }>(),
  { maskClosable: true, bgColor: '#ffffff', closable: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean]; close: [] }>()

const metrics = getNavMetrics()
/** 渲染开关：关闭动画结束后再卸载，避免闪烁 */
const rendered = ref(props.modelValue)
const active = ref(props.modelValue)
let timer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.modelValue,
  (value) => {
    if (timer) clearTimeout(timer)
    if (value) {
      rendered.value = true
      // 下一帧再加 active，触发过渡
      timer = setTimeout(() => {
        active.value = true
      }, 20)
    } else {
      active.value = false
      timer = setTimeout(() => {
        rendered.value = false
      }, 300)
    }
  },
)

const bodyStyle = computed(() => {
  const h = props.height ? `height:${props.height};` : ''
  const r = props.radius ? `border-radius:${props.radius} ${props.radius} 0 0;` : ''
  return `${h}${r}background:${props.bgColor};padding-bottom:${metrics.safeAreaBottom}px;`
})

function close() {
  emit('update:modelValue', false)
  emit('close')
}

function onMask() {
  if (props.maskClosable) close()
}
</script>

<template>
  <view v-if="rendered" class="sheet" @touchmove.stop.prevent>
    <view class="sheet__mask" :class="{ 'sheet__mask--on': active }" @tap="onMask" />
    <view class="sheet__body" :class="{ 'sheet__body--on': active }" :style="bodyStyle">
      <view v-if="title || closable" class="sheet__head">
        <text class="sheet__title">{{ title }}</text>
        <view v-if="closable" class="sheet__close" @tap="close">
          <ui-icon name="close" :size="34" color="#666666" />
        </view>
      </view>
      <slot />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.sheet {
  position: fixed;
  inset: 0;
  z-index: 1000;

  &__mask {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    opacity: 0;
    transition: opacity $dur-base $ease-base;

    &--on {
      opacity: 1;
    }
  }

  &__body {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 88vh;
    border-radius: $radius-sheet $radius-sheet 0 0;
    transform: translateY(100%);
    transition: transform $dur-base $ease-base;
    overflow: hidden;

    &--on {
      transform: translateY(0);
    }
  }

  &__head {
    position: relative;
    height: 104rpx;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__title {
    font-size: $fs-title;
    font-weight: 600;
    color: $ink;
  }

  &__close {
    position: absolute;
    right: $gap-page;
    top: 34rpx;
  }
}
</style>
