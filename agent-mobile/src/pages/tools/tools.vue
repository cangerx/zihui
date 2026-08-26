<script setup lang="ts">
/**
 * 工具页：全部工具，按分类分区，双列彩色卡片
 * 对照 原型图/工具.jpg
 * 数据走 GET /ai/app/GetAppListByCategory（mock 已覆盖）
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getAppListByCategory } from '@/api/modules/app'
import { getNavMetrics } from '@/utils/system'
import type { AppCategory, AppListItem } from '@/api/types'

const metrics = getNavMetrics()
/** 自定义导航：让出状态栏高度 */
const headPad = computed(() => `padding-top:${metrics.statusBarHeight + 8}px`)

const categories = ref<AppCategory[]>([])
const keyword = ref('')
const searching = ref(false)
const loading = ref(true)

/**
 * 卡片低饱和底色，取自原型像素采样（粉/橙/黄绿/绿/蓝/紫）。
 * 图标在原型里是近黑单色（四张卡采样饱和度 0.08–0.18），不跟底色配彩色。
 */
const TINTS = ['#f6e0e8', '#f7eae1', '#edf1d8', '#e7f0dd', '#ddeaf2', '#f3e2da']
const ICON_COLOR = '#37312f'

/**
 * 原型工具页是平铺列表，无分区标题、无卡内描述文案。
 * 这里把分类结果拍平成单个 grid，分类信息仅保留在数据里不渲染。
 */
const apps = computed<AppListItem[]>(() => {
  const flat = categories.value.flatMap((category) => category.apps)
  const kw = keyword.value.trim()
  return kw ? flat.filter((app) => app.name.includes(kw)) : flat
})

onLoad(async () => {
  categories.value = await getAppListByCategory()
  loading.value = false
})

/** 底色按全局平铺序号轮换，避免分类边界处相邻卡撞色 */
function tintOf(index: number) {
  return TINTS[index % TINTS.length]
}

function onAppTap(app: AppListItem) {
  // 有介绍页的功能先进介绍页，其余直达运行页
  const introApps = ['app-ecommerce-suite', 'app-hot-video', 'app-aplus', 'app-replica']
  const path = introApps.includes(app.uuid) ? 'tool-intro/tool-intro' : 'tool-run/tool-run'
  uni.navigateTo({ url: `/pages-sub/${path}?uuid=${app.uuid}` })
}
</script>

<template>
  <view class="tools" :style="headPad">
    <!-- 标题与搜索图标常驻并存；点搜索展开输入行，不替换标题 -->
    <view class="tools__head">
      <text class="tools__title">全部工具</text>
      <view class="tools__search" @tap="searching = !searching">
        <ui-icon :name="searching ? 'close' : 'search'" :size="34" color="#333333" />
      </view>
    </view>

    <view v-if="searching" class="tools__search-bar">
      <ui-icon name="search" :size="30" color="#999999" />
      <input
        v-model="keyword"
        class="tools__input"
        placeholder="搜索工具"
        placeholder-class="tools__ph"
        focus
        confirm-type="search"
      />
    </view>

    <scroll-view class="tools__body" scroll-y :show-scrollbar="false">
      <view class="tools__grid">
        <view
          v-for="(app, index) in apps"
          :key="app.uuid"
          class="tools__card"
          :style="`background:${tintOf(index)}`"
          @tap="onAppTap(app)"
        >
          <view class="tools__card-head">
            <ui-icon :name="app.icon" :size="35" :color="ICON_COLOR" />
            <text class="tools__card-name ellipsis">{{ app.name }}</text>
          </view>
          <!-- 示例图占卡片主体，贴左右下三边 -->
          <view class="tools__card-figure">
            <image class="tools__card-img" :src="app.poster" mode="aspectFill" lazy-load />
          </view>
        </view>
      </view>

      <view v-if="!loading && !apps.length" class="tools__empty">
        <text class="tools__empty-text">没有找到相关工具</text>
      </view>
      <view class="tools__safe" />
    </scroll-view>
  </view>
</template>

<style lang="scss" scoped>
.tools {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: $bg-card;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8rpx $gap-page 16rpx;
  }

  &__title {
    font-size: $fs-lg;
    font-weight: 700;
    color: $ink;
  }

  &__search-bar {
    display: flex;
    align-items: center;
    gap: 12rpx;
    height: 68rpx;
    margin: 0 $gap-page 12rpx;
    padding: 0 24rpx;
    border-radius: $radius-btn;
    background: $bg-fill;
  }

  &__input {
    flex: 1;
    font-size: $fs-body;
  }

  &__ph {
    color: $ink-3;
  }

  &__search {
    width: 56rpx;
    display: flex;
    justify-content: flex-end;
  }

  &__body {
    flex: 1;
    min-height: 0;
  }

  /* 实测：卡宽 330rpx、列间距 24rpx、行间距 42rpx、页边距 33rpx */
  &__grid {
    display: flex;
    flex-wrap: wrap;
    gap: 42rpx 24rpx;
    padding: 20rpx 33rpx 0;
  }

  /* 卡高实测 424px ≈ 252rpx，圆角实测约 24rpx */
  &__card {
    width: 330rpx;
    height: 252rpx;
    border-radius: 24rpx;
    padding: 22rpx 22rpx 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  &__card-head {
    display: flex;
    align-items: center;
    gap: 12rpx;
  }

  &__card-name {
    font-size: 26rpx;
    font-weight: 600;
    color: $ink;
  }

  /* 示例图：贴着卡片左右下三边，顶部留圆角，占卡片主体 */
  &__card-figure {
    flex: 1;
    margin-top: 16rpx;
    border-radius: 14rpx 14rpx 0 0;
    overflow: hidden;
  }

  &__card-img {
    width: 100%;
    height: 100%;
  }

  &__empty {
    padding: 120rpx 0;
    text-align: center;
  }

  &__empty-text {
    font-size: $fs-body;
    color: $ink-3;
  }

  &__safe {
    height: 40rpx;
  }
}
</style>
