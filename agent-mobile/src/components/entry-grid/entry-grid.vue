<script setup lang="ts">
/**
 * 首页功能入口：2 行 × 4 列共 8 项，静态不翻页
 *
 * 原型实测（首页.jpg）：
 *   两行标签组各 4 个 —— 114-264 / 409-559 / 701-852 / 989-1130
 *   图标 66×76px ≈ 39×45rpx（非正方）
 *   图标底 → 标签顶 79px ≈ 47rpx；标签字形高 36px ≈ 字号 28rpx
 *   底部指示条为单段装饰条 110×12px ≈ 65×7rpx，色 (145,152,160)
 *   图标是近黑单色（四个图标采样饱和度 0.07–0.11，均值 (42..66)），不是彩色
 */
import type { HomeEntry } from '@/api/mock/data'
import { entryIcon } from '@/utils/entry-icons'

defineProps<{ items: HomeEntry[] }>()

/** 不能叫 tap：uni-app 内置原生 tap 会顶掉 emit 的 item（详见 cover-swiper 注释） */
const emit = defineEmits<{ pick: [item: HomeEntry] }>()

/** 原型图标为近黑单色线稿，不做按入口区分的主题色 */
const ICON_COLOR = '#2f2f35'
</script>

<template>
  <view class="eg">
    <view class="eg__grid">
      <view v-for="item in items" :key="item.key" class="eg__item" @tap="emit('pick', item)">
        <view class="eg__icon">
          <image class="eg__img" :src="entryIcon(item.key, ICON_COLOR)" mode="aspectFit" />
          <view v-if="item.badge" class="eg__badge">
            <text class="eg__badge-text">{{ item.badge }}</text>
          </view>
        </view>
        <text class="eg__name ellipsis">{{ item.name }}</text>
      </view>
    </view>
    <!-- 原型是固定单段装饰条，不是翻页指示点 -->
    <view class="eg__bar" />
  </view>
</template>

<style lang="scss" scoped>
.eg {
  &__grid {
    display: flex;
    flex-wrap: wrap;
    padding: 0 $gap-page;
  }

  &__item {
    width: 25%;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 18rpx 0 0;
  }

  &__icon {
    position: relative;
    width: 39rpx;
    height: 45rpx;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__img {
    width: 100%;
    height: 100%;
  }

  /* 实测 89×46px ≈ 53×27rpx，蓝→绿横向渐变 + 近黑字，位于图标右上外侧 */
  &__badge {
    position: absolute;
    top: -30rpx;
    left: 22rpx;
    width: 53rpx;
    height: 27rpx;
    border-radius: 13rpx;
    background: linear-gradient(90deg, #76e5f9 0%, #29f481 100%);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__badge-text {
    font-size: 18rpx;
    color: #0a1a12;
    font-weight: 600;
    transform: scale(0.94);
  }

  &__name {
    margin-top: 47rpx;
    max-width: 150rpx;
    font-size: 28rpx;
    color: $ink;
    text-align: center;
  }

  &__bar {
    width: 65rpx;
    height: 7rpx;
    border-radius: 4rpx;
    margin: 16rpx auto 0;
    background: #9198a0;
  }
}
</style>
