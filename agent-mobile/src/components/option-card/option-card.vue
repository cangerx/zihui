<script setup lang="ts">
/**
 * 选项卡片组（动效清单 #9）：单选/多选，选中态紫描边
 * 对照 原型图/功能页面.jpg 的「通用 / 场景」选项组
 */
interface Option {
  label: string
  value: string
  preview?: string
}

const props = withDefaults(
  defineProps<{
    options: Option[]
    /** 单选传 string，多选传 string[] */
    modelValue: string | string[]
    multiple?: boolean
    /** 显示预览图（internal_prompt 带 preview 时） */
    showPreview?: boolean
    /** 每行个数 */
    columns?: number
  }>(),
  { multiple: false, showPreview: false, columns: 3 },
)

const emit = defineEmits<{ 'update:modelValue': [value: string | string[]] }>()

function isOn(value: string) {
  return props.multiple
    ? Array.isArray(props.modelValue) && props.modelValue.includes(value)
    : props.modelValue === value
}

function pick(value: string) {
  if (props.multiple) {
    const list = Array.isArray(props.modelValue) ? props.modelValue.slice() : []
    const index = list.indexOf(value)
    if (index >= 0) list.splice(index, 1)
    else list.push(value)
    emit('update:modelValue', list)
    return
  }
  emit('update:modelValue', props.modelValue === value ? '' : value)
}

function itemStyle() {
  const gapTotal = 16 * (props.columns - 1)
  return `width:calc((100% - ${gapTotal}rpx) / ${props.columns})`
}
</script>

<template>
  <view class="oc">
    <view
      v-for="item in options"
      :key="item.value"
      class="oc__item"
      :class="{ 'oc__item--on': isOn(item.value) }"
      :style="itemStyle()"
      @tap="pick(item.value)"
    >
      <image
        v-if="showPreview && item.preview"
        class="oc__preview"
        :src="item.preview"
        mode="aspectFill"
      />
      <text class="oc__label ellipsis">{{ item.label }}</text>
      <view v-if="isOn(item.value)" class="oc__check">
        <ui-icon name="check" :size="20" color="#ffffff" />
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.oc {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;

  &__item {
    position: relative;
    min-height: 92rpx;
    padding: 20rpx 16rpx;
    border-radius: $radius-sm;
    background: $bg-fill;
    border: 2rpx solid transparent;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    transition: all $dur-fast $ease-base;

    &--on {
      background: $brand-light;
      border-color: $brand;
    }
  }

  &__preview {
    width: 100%;
    height: 120rpx;
    border-radius: 14rpx;
    margin-bottom: 12rpx;
  }

  &__label {
    max-width: 100%;
    font-size: $fs-body;
    color: $ink;
    text-align: center;
  }

  &__item--on &__label {
    color: $brand;
    font-weight: 600;
  }

  &__check {
    position: absolute;
    top: -2rpx;
    right: -2rpx;
    width: 34rpx;
    height: 34rpx;
    border-radius: 0 $radius-sm 0 $radius-sm;
    background: $brand;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}
</style>
