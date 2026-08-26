<script setup lang="ts">
/**
 * 表单区块卡：白底圆角卡 + 「icon + 标题（+ 尾部 icon）」头部 + 插槽内容
 * 对照 docs/电商套图内页.md §1
 *
 * 实测（原型图/9403…jpg 去蒙层后）：
 *   卡 x49–1210 ⇒ 左右内缩 29rpx（按 $gap-page 32rpx 落地，差 2px 内）
 *   卡圆角 41px ≈ 24rpx（$radius-card-sm）
 *   头部 icon 48×42px ≈ 29×25rpx，卡顶 → 头部 ink 顶 56px ≈ 33rpx
 *   标题 ink 高 48px ⇒ $fs-title
 */
defineProps<{
  title: string
  /** 头部左侧图标名 */
  icon?: string
  /** 标题右侧图标名（原型卡1 标题后有一枚说明性图标） */
  tailIcon?: string
}>()

/** 尾部图标点击（如「查看示例」），父级自行决定行为 */
const emit = defineEmits<{ tail: [] }>()
</script>

<template>
  <view class="fsec">
    <view class="fsec__head">
      <ui-icon v-if="icon" :name="icon" :size="29" color="#16161a" />
      <text class="fsec__title">{{ title }}</text>
      <view v-if="tailIcon" class="fsec__tail" @tap="emit('tail')">
        <ui-icon :name="tailIcon" :size="27" color="#9a9aa5" />
      </view>
    </view>
    <slot />
  </view>
</template>

<style lang="scss" scoped>
.fsec {
  border-radius: $radius-card-sm;
  background: $bg-card;
  /*
   * 卡顶 → 头部 ink 顶实测 56px。padding 33rpx 时浏览器量到 62px（字形上方留白算进来了），
   * 故按实测差 −6 设计px 回调到 29rpx。
   * 行内 ink 左起 x96、卡左 x49 ⇒ 卡内左内边距 47px ≈ 28rpx。
   */
  padding: 29rpx 28rpx 25rpx;

  &__head {
    display: flex;
    align-items: center;
    gap: 21rpx;
  }

  &__title {
    font-size: $fs-title;
    font-weight: 600;
    color: $ink;
  }

  /* 实测尾部 icon 紧跟标签（标签右 434 → icon 左 456，间距 22px ≈ 13rpx） */
  &__tail {
    margin-left: 13rpx;
    display: flex;
    align-items: center;
  }
}
</style>
