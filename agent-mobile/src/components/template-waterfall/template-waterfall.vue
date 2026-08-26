<script setup lang="ts">
/**
 * 三列瀑布流（动效清单 #7）：按累计高度分列，图片 fade-in
 * 小程序无法用 CSS columns 可靠布局，这里用比例预估高度做手动分列。
 *
 * 几何来自原型像素测量（魔板.jpg / 首页2.jpg / 首页.jpg 三图交叉一致）：
 *   列边界 35/413、440/819、846/1226 → 页边距 34px≈20rpx、列宽 379px≈226rpx、间距 27px≈16rpx
 *   闭合校验：20 + 3×226 + 2×16 + 20 = 750
 * 卡片是纯图片卡，无标题行、无角标：卡间隙仅 25–31px，装不下文字，文案印在图里。
 * 高度确为不等（col1 第二张 672px vs col2 820px），是真瀑布流而非等高网格。
 */
import { computed } from 'vue'
import type { TemplateItem } from '@/api/types'

const props = withDefaults(
  defineProps<{
    items: TemplateItem[]
    /** 列间距，rpx */
    gap?: number
    /** 页面左右留白，rpx */
    inset?: number
    loading?: boolean
    /** 是否还有更多 */
    hasMore?: boolean
  }>(),
  { gap: 16, inset: 20, loading: false, hasMore: true },
)

/** 不能叫 tap：uni-app 内置原生 tap 会顶掉 emit 的 item（详见 cover-swiper 注释） */
const emit = defineEmits<{ pick: [item: TemplateItem] }>()

const COLUMN_COUNT = 3

/** 列宽 = (750 - 左右留白 - 列间距总和) / 列数 */
const columnWidth = computed(
  () => (750 - props.inset * 2 - props.gap * (COLUMN_COUNT - 1)) / COLUMN_COUNT,
)

const columns = computed(() => {
  const heights = Array.from({ length: COLUMN_COUNT }, () => 0)
  const buckets: TemplateItem[][] = Array.from({ length: COLUMN_COUNT }, () => [])
  props.items.forEach((item) => {
    let index = 0
    for (let i = 1; i < COLUMN_COUNT; i += 1) {
      if (heights[i] < heights[index]) index = i
    }
    buckets[index].push(item)
    heights[index] += columnWidth.value * item.ratio + props.gap
  })
  return buckets
})

function coverStyle(item: TemplateItem) {
  return `height:${Math.round(columnWidth.value * item.ratio)}rpx`
}
</script>

<template>
  <view class="wf-root">
    <view class="wf" :style="`gap:${gap}rpx;padding:0 ${inset}rpx`">
      <view v-for="(column, ci) in columns" :key="ci" class="wf__col" :style="`gap:${gap}rpx`">
        <view v-for="item in column" :key="item.id" class="wf__card" @tap="emit('pick', item)">
          <!-- title 只作无障碍标签，不渲染成可见文字 -->
          <view class="wf__cover" :style="coverStyle(item)" :aria-label="item.title">
            <image class="wf__img" :src="item.cover" mode="aspectFill" lazy-load />
          </view>
        </view>
      </view>
    </view>
    <view v-if="loading" class="wf-more">
      <text class="wf-more__text">加载中...</text>
    </view>
    <view v-else-if="!hasMore && items.length" class="wf-more">
      <text class="wf-more__text">没有更多了</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.wf {
  display: flex;

  &__col {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  &__card {
    width: 100%;
  }

  /* 圆角实测约 28px ≈ 17rpx */
  &__cover {
    position: relative;
    width: 100%;
    border-radius: 17rpx;
    overflow: hidden;
    background: $bg-skeleton;
  }

  &__img {
    width: 100%;
    height: 100%;
    animation: wf-in $dur-base $ease-base;
  }
}

.wf-more {
  padding: 32rpx 0;
  text-align: center;

  &__text {
    font-size: $fs-aux;
    color: $ink-3;
  }
}

@keyframes wf-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
