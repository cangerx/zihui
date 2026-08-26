<script setup lang="ts">
/**
 * AI 生图页：文生图/图生图切换 + 灵感案例三列图片流
 * 对照 原型图/7b027d9513e0484327d1368272a87464.jpg
 */
import { computed, ref } from 'vue'
import { makeTemplates, type TemplateItem } from '@/api/mock/data'

const tabs = ['灵感案例', '文生图', '图生图']
const subCategories = ['家居环境', '女性人物', '美食', '风景', '动物', '物品']

const activeTab = ref(0)
const activeSub = ref(0)

/**
 * 生成方式胶囊与 tab 是同一状态：胶囊「文生图/图生图」= tab 的后两项。
 * 收敛成派生值，避免出现「胶囊=文生图、tab=图生图」的矛盾态。
 */
const genMode = computed<'text' | 'image'>(() => (activeTab.value === 2 ? 'image' : 'text'))

const allItems = ref<TemplateItem[]>(makeTemplates(1, 18))
const loading = ref(false)
const hasMore = ref(true)
const page = ref(2)

/**
 * 按 tab + 子分类过滤。mock 无真实分类维度，用 id 做确定性抽样，
 * 保证切 tab/子分类时列表有可见变化（此前切了没反应）。
 */
const items = computed<TemplateItem[]>(() => {
  const seed = activeTab.value * 7 + activeSub.value * 3
  if (seed === 0) return allItems.value
  return allItems.value.filter((item) => (Number(item.id.replace('tpl-', '')) + seed) % 4 !== 0)
})

/** 三列分栏 */
const columns = computed(() => {
  const buckets: TemplateItem[][] = [[], [], []]
  const heights = [0, 0, 0]
  items.value.forEach((item) => {
    const index = heights.indexOf(Math.min(...heights))
    buckets[index].push(item)
    heights[index] += item.ratio
  })
  return buckets
})

function load() {
  if (loading.value || !hasMore.value) return
  loading.value = true
  allItems.value = allItems.value.concat(makeTemplates(page.value, 18))
  hasMore.value = page.value < 4
  page.value += 1
  loading.value = false
}

/** 胶囊切换 = 切到对应 tab */
function pickMode(mode: 'text' | 'image') {
  activeTab.value = mode === 'image' ? 2 : 1
}

function close() {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: '/pages/home/home' })
}

/** 做同款：带灵感 id 进运行页 */
function makeSame(item: TemplateItem) {
  uni.navigateTo({
    url: `/pages-sub/tool-run/tool-run?uuid=app-goods&prompt=${encodeURIComponent(item.title)}`,
  })
}
</script>

<template>
  <view class="ai">
    <nav-bar close @back="close" />

    <scroll-view class="ai__body" scroll-y :show-scrollbar="false" @scrolltolower="load">
      <!-- 主视觉 -->
      <view class="ai__hero">
        <text class="ai__hero-title">输入描述或参考图</text>
        <text class="ai__hero-title">AI帮你生图</text>
        <view class="ai__modes">
          <view
            class="ai__mode"
            :class="{ 'ai__mode--on': genMode === 'text' }"
            @tap="pickMode('text')"
          >
            <text class="ai__mode-text">文生图</text>
          </view>
          <view
            class="ai__mode"
            :class="{ 'ai__mode--on': genMode === 'image' }"
            @tap="pickMode('image')"
          >
            <text class="ai__mode-text">图生图</text>
          </view>
        </view>
      </view>

      <tab-underline v-model="activeTab" :items="tabs" class="ai__tabs" />

      <scroll-view class="ai__subs" scroll-x :show-scrollbar="false" enable-flex>
        <view class="ai__subs-row">
          <view
            v-for="(sub, index) in subCategories"
            :key="sub"
            class="ai__sub"
            :class="{ 'ai__sub--on': index === activeSub }"
            @tap="activeSub = index"
          >
            <text class="ai__sub-text">{{ sub }}</text>
          </view>
        </view>
      </scroll-view>

      <!-- 三列灵感流 -->
      <view class="ai__grid">
        <view v-for="(column, ci) in columns" :key="ci" class="ai__col">
          <view v-for="item in column" :key="item.id" class="ai__card">
            <image
              class="ai__img"
              :src="item.cover"
              mode="widthFix"
              lazy-load
              @tap="makeSame(item)"
            />
            <view class="ai__same" @tap="makeSame(item)">
              <text class="ai__same-text">做同款</text>
            </view>
          </view>
        </view>
      </view>

      <view class="ai__safe" />
    </scroll-view>
  </view>
</template>

<style lang="scss" scoped>
.ai {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: $bg-card;

  &__body {
    flex: 1;
    min-height: 0;
  }

  &__hero {
    padding: 8rpx $gap-page 24rpx;
  }

  &__hero-title {
    display: block;
    font-size: $fs-hero;
    line-height: 1.3;
    font-weight: 700;
    color: $ink;
  }

  &__modes {
    display: flex;
    align-items: center;
    gap: 16rpx;
    margin-top: 28rpx;
  }

  /* 选中态为深底白字，与下方子分类胶囊一致（原型选中对比强） */
  &__mode {
    height: 72rpx;
    padding: 0 33rpx;
    border-radius: $radius-btn;
    background: $bg-fill;
    display: flex;
    align-items: center;
    transition: all $dur-fast $ease-base;

    &--on {
      background: $brand;
    }
  }

  &__mode-text {
    font-size: $fs-body;
    color: $ink-2;
  }

  &__mode--on &__mode-text {
    color: #ffffff;
    font-weight: 600;
  }

  &__tabs {
    border-bottom: 1px solid $line;
  }

  &__subs {
    white-space: nowrap;
    padding: 20rpx 0 8rpx;
  }

  &__subs-row {
    display: inline-flex;
    align-items: center;
    padding: 0 $gap-page;
    gap: 14rpx;
  }

  &__sub {
    flex-shrink: 0;
    height: 56rpx;
    padding: 0 24rpx;
    border-radius: 28rpx;
    background: $bg-fill;

    display: flex;
    align-items: center;

    &--on {
      background: $ink;
    }
  }

  &__sub-text {
    font-size: $fs-aux;
    color: $ink-2;
  }

  &__sub--on &__sub-text {
    color: #ffffff;
  }

  &__grid {
    display: flex;
    gap: 12rpx;
    padding: 12rpx $gap-page 0;
  }

  &__col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 12rpx;
  }

  &__card {
    position: relative;
    border-radius: 16rpx;
    overflow: hidden;
    background: #f2f2f7;
  }

  &__img {
    width: 100%;
    display: block;
  }

  &__same {
    position: absolute;
    left: 8rpx;
    right: 8rpx;
    bottom: 8rpx;
    height: 48rpx;
    border-radius: 24rpx;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__same-text {
    font-size: $fs-mini;
    color: #ffffff;
  }

  &__safe {
    height: 60rpx;
  }
}
</style>
