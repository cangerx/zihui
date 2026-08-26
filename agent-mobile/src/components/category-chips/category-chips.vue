<script setup lang="ts">
/**
 * 分类横滑（首页）
 *
 * 原型实测（0d2c…jpg / f621…jpg / 972f…jpg）：
 *   - 白底圆角胶囊 + 浅灰描边 #e4e5e6，选中态换**黑描边**
 *   - 胶囊高 108px ≈ 64rpx，胶囊间距 90px ≈ 54rpx，字号 28rpx
 *   - 尾部有宫格按钮
 * 注：在 首页.jpg 上因胶囊白底叠近白背景，采样测不出填充差异，
 *     一度误判为「无胶囊」；以本组图的描边测量为准。
 */
import { computed } from 'vue'

interface Chip {
  key: string
  name: string
}

const props = withDefaults(
  defineProps<{
    items: Chip[]
    modelValue: string
    /** 尾部宫格按钮 */
    showGrid?: boolean
  }>(),
  { showGrid: false },
)

const emit = defineEmits<{
  'update:modelValue': [key: string]
  grid: []
}>()

/**
 * 选中首个胶囊时不要 scroll-into-view：它会把该胶囊贴到 scroll-view 左边缘，
 * 把 $gap-page 的 32rpx 起始留白吃掉（实测首个胶囊左边界从 56px 掉到 0）。
 */
const scrollInto = computed(() => {
  const key = props.modelValue
  if (!key || key === props.items[0]?.key) return ''
  return `chip-${key}`
})

function pick(key: string) {
  emit('update:modelValue', key === props.modelValue ? '' : key)
}
</script>

<template>
  <view class="chips">
    <scroll-view
      class="chips__scroll"
      scroll-x
      :show-scrollbar="false"
      enable-flex
      :scroll-into-view="scrollInto"
      scroll-with-animation
    >
      <view class="chips__row">
        <view
          v-for="item in items"
          :id="`chip-${item.key}`"
          :key="item.key"
          class="chips__item"
          :class="{ 'chips__item--on': item.key === modelValue }"
          @tap="pick(item.key)"
        >
          <text class="chips__text">{{ item.name }}</text>
        </view>
      </view>
    </scroll-view>
    <view v-if="showGrid" class="chips__grid" @tap="emit('grid')">
      <ui-icon name="grid" :size="34" color="#111111" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.chips {
  display: flex;
  align-items: center;

  &__scroll {
    flex: 1;
    white-space: nowrap;
  }

  &__row {
    display: inline-flex;
    align-items: center;
    padding: 0 $gap-page;
  }

  /*
   * 白底胶囊 + 浅灰描边；选中态换黑描边。
   * 实测（972f/首页 两图一致）：胶囊高 108px≈64rpx；四个胶囊边界
   * x 56–275 / 297–548 / 570–821 / 843–1093 ⇒ **间距 22px≈13rpx**
   * （此前 54rpx 是把胶囊间空白连同描边一起量错，实际宽了约 4 倍）；
   * 四字胶囊 251px 减去 4×42rpx 字宽 ⇒ 左右内边距各 ≈19rpx。
   */
  &__item {
    flex-shrink: 0;
    height: 64rpx;
    padding: 0 19rpx;
    margin-right: 13rpx;
    border-radius: $radius-btn;
    background: #ffffff;
    border: 1px solid #e4e5e6;
    display: flex;
    align-items: center;
    transition: border-color $dur-fast $ease-base;

    &:last-child {
      margin-right: 0;
    }

    &--on {
      border-color: $ink;
    }
  }

  &__text {
    font-size: $fs-body;
    color: $ink;
  }

  &__item--on &__text {
    font-weight: 600;
  }

  &__grid {
    width: 64rpx;
    height: 64rpx;
    margin-right: $gap-page;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
}
</style>
