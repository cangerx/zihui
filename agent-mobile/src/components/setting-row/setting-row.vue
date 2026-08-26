<script setup lang="ts">
/**
 * 设置行：标签左 / 值右 / chevron，点击拉起 picker
 * 对照 docs/电商套图内页.md §1（原型「生成设置」三行）
 *
 * 实测：行距 183px ≈ 109rpx；标签与值 ink 高 44px ⇒ $fs-body；
 *       chevron 16×30px ≈ 10×18rpx；行间 1px 分隔线（$line）。
 *
 * 与 schema-field 的 select 区别：那个是「标签在上、灰底 picker 在下」，
 * 本组件是「标签值同行 + chevron」的设置项形态，两者不能互相顶替。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    /** 当前值（提交值） */
    modelValue?: string
    options?: Array<{ label: string; value: string }>
    /** 无值时的占位 */
    placeholder?: string
    /** 是否画底部分隔线 */
    divider?: boolean
  }>(),
  { modelValue: '', options: () => [], placeholder: '请选择', divider: true },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const range = computed(() => props.options.map((o) => o.label))

const current = computed(() => props.options.find((o) => o.value === props.modelValue))

const display = computed(() => current.value?.label || props.placeholder)

const index = computed(() => {
  const i = props.options.findIndex((o) => o.value === props.modelValue)
  return i < 0 ? 0 : i
})

function onChange(e: { detail: { value: string | number } }) {
  const option = props.options[Number(e.detail.value)]
  if (option) emit('update:modelValue', option.value)
}
</script>

<template>
  <picker class="srow-picker" :range="range" :value="index" @change="onChange">
    <view class="srow" :class="{ 'srow--divider': divider }">
      <text class="srow__label">{{ label }}</text>
      <view class="srow__right">
        <text class="srow__value" :class="{ 'srow__value--empty': !current }">{{ display }}</text>
        <ui-icon name="arrow" :size="18" color="#9a9aa5" />
      </view>
    </view>
  </picker>
</template>

<style lang="scss" scoped>
.srow-picker {
  display: block;
}

.srow {
  /* 实测行距 183px ≈ 109rpx */
  height: 109rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;

  &--divider {
    border-bottom: 1px solid $line;
  }

  &__label {
    font-size: $fs-body;
    color: $ink;
  }

  &__right {
    display: flex;
    align-items: center;
    /*
     * 值右边界 1109 → chevron 左 1141，间距 32px ≈ 19rpx。
     * ui-icon 是 aspectFit 的方形图，18rpx 框里 chevron 实际只占中间约 10rpx 宽，
     * 两侧各留约 4rpx 空白，所以视觉间距要按 19 − 4 ≈ 15rpx 写。
     */
    gap: 15rpx;
  }

  &__value {
    font-size: $fs-body;
    color: $ink-2;

    &--empty {
      color: $ink-3;
    }
  }
}
</style>
