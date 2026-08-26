<script setup lang="ts">
/** 文本字段 + AI 帮写（OptimizeTextToText / OptimizeImageToText） */
import { computed } from 'vue'
import { inputValue } from '@/utils/event'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    rows?: number
    maxlength?: number
    /** 是否显示 AI 帮写按钮 */
    optimize?: boolean
    /** AI 帮写进行中，由父组件控制 */
    optimizing?: boolean
  }>(),
  { placeholder: '请输入', rows: 3, maxlength: 300, optimize: false, optimizing: false },
)

/** 与 uni.scss $brand 一致；模板 :color 绑定无法直接引 SCSS 变量 */
const BRAND = '#5f5ffd'

const emit = defineEmits<{
  'update:modelValue': [value: string]
  optimize: []
}>()

const counter = computed(() => `${props.modelValue.length}/${props.maxlength}`)

function onInput(e: Event) {
  emit('update:modelValue', inputValue(e))
}
</script>

<template>
  <view class="ft">
    <textarea
      class="ft__input"
      :value="modelValue"
      :placeholder="placeholder"
      placeholder-class="ft__ph"
      :maxlength="maxlength"
      :style="`min-height:${rows * 48}rpx`"
      :show-confirm-bar="false"
      :cursor-spacing="24"
      @input="onInput"
    />
    <view class="ft__foot">
      <view
        v-if="optimize"
        class="ft__ai"
        :class="{ 'ft__ai--busy': optimizing }"
        @tap="!optimizing && emit('optimize')"
      >
        <ui-icon name="ai-image" :size="26" :color="optimizing ? '#aaaaaa' : BRAND" />
        <text class="ft__ai-text">{{ optimizing ? '生成中...' : 'AI帮写' }}</text>
      </view>
      <view v-else />
      <text class="ft__counter">{{ counter }}</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ft {
  border-radius: 20rpx;
  background: $bg-fill;
  padding: 20rpx 22rpx 12rpx;

  &__input {
    width: 100%;
    font-size: $fs-body;
    line-height: 1.5;
    color: $ink;
  }

  &__ph {
    color: $ink-3;
  }

  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8rpx;
  }

  &__ai {
    height: 52rpx;
    padding: 0 20rpx;
    border-radius: 26rpx;
    background: rgba(95, 95, 253, 0.1);
    display: flex;
    align-items: center;
    gap: 6rpx;

    &--busy {
      background: #eeeeee;
    }
  }

  &__ai-text {
    font-size: $fs-aux;
    color: $brand;
  }

  &__ai--busy &__ai-text {
    color: $ink-3;
  }

  &__counter {
    font-size: $fs-mini;
    color: $ink-3;
  }
}
</style>
