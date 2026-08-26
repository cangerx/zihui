<script setup lang="ts">
/**
 * 下划线 tab（动效清单 #12）：下划线随选中项平移
 * 用于模板页一级分类、资产库、AI 生图页 tab。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    items: string[]
    modelValue: number
    /** 选中文字颜色 */
    activeColor?: string
    color?: string
    /** 下划线颜色，默认主色 */
    lineColor?: string
    /** 是否横向滚动（项多时） */
    scroll?: boolean
    /** 字号，rpx */
    fontSize?: number
  }>(),
  { activeColor: '#111111', color: '#666666', lineColor: '#5b5bf0', scroll: true, fontSize: 30 },
)

const emit = defineEmits<{ 'update:modelValue': [index: number] }>()

const scrollInto = computed(() => `tab-${props.modelValue}`)
</script>

<template>
  <scroll-view
    class="tu"
    :scroll-x="scroll"
    :show-scrollbar="false"
    enable-flex
    :scroll-into-view="scrollInto"
    scroll-with-animation
  >
    <view class="tu__row" :class="{ 'tu__row--fill': !scroll }">
      <view
        v-for="(item, index) in items"
        :id="`tab-${index}`"
        :key="item"
        class="tu__item"
        @tap="emit('update:modelValue', index)"
      >
        <text
          class="tu__text"
          :style="`font-size:${fontSize}rpx;color:${index === modelValue ? activeColor : color};font-weight:${index === modelValue ? 600 : 400}`"
        >
          {{ item }}
        </text>
        <view
          class="tu__line"
          :class="{ 'tu__line--on': index === modelValue }"
          :style="`background:${lineColor}`"
        />
      </view>
    </view>
  </scroll-view>
</template>

<style lang="scss" scoped>
.tu {
  width: 100%;
  white-space: nowrap;

  &__row {
    display: inline-flex;
    align-items: center;

    &--fill {
      display: flex;
      width: 100%;

      .tu__item {
        flex: 1;
      }
    }
  }

  &__item {
    flex-shrink: 0;
    padding: 0 24rpx;
    height: 76rpx;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  &__text {
    transition: color $dur-fast $ease-base;
  }

  &__line {
    margin-top: 8rpx;
    width: 0;
    height: 6rpx;
    border-radius: 3rpx;
    opacity: 0;
    transition: width $dur-base $ease-base, opacity $dur-base $ease-base;

    &--on {
      width: 36rpx;
      opacity: 1;
    }
  }
}
</style>
