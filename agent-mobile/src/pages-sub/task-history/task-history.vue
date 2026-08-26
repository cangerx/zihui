<script setup lang="ts">
/**
 * 最近任务 / 作图记录
 * TODO(design)：原型未给出详图，按现有设计语言补齐
 * TODO(api)：任务列表接口后端未提供，先用空态 + mock
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { makeTemplates, type TemplateItem } from '@/api/mock/data'

const tabs = ['全部', '生成中', '已完成']
const activeTab = ref(0)
const items = ref<TemplateItem[]>([])
const isFavorite = ref(false)

// tab：全部 / 生成中 / 已完成，按 status 筛。之前 computed 忽略 activeTab、点了无变化
const filtered = computed(() => {
  if (isFavorite.value || activeTab.value === 0) return items.value
  const want = activeTab.value === 1 ? 'running' : 'done'
  return items.value.filter((it) => it.status === want)
})

onLoad((query) => {
  isFavorite.value = query?.type === 'favorite'
  uni.setNavigationBarTitle({ title: isFavorite.value ? '我的收藏' : '最近任务' })
  if (isFavorite.value) {
    items.value = makeTemplates(1, 8)
  } else {
    // TODO(api)：任务列表接口未提供，先给 mock 任务（交替生成中/已完成）演示 tab 筛选
    items.value = makeTemplates(1, 6).map((it, i) => ({
      ...it,
      status: i % 2 === 0 ? 'done' : 'running',
    }))
  }
})

function preview(item: TemplateItem) {
  uni.previewImage({ urls: [item.cover] })
}
</script>

<template>
  <view class="th">
    <tab-underline v-if="!isFavorite" v-model="activeTab" :items="tabs" :scroll="false" />

    <scroll-view v-if="filtered.length" class="th__body" scroll-y :show-scrollbar="false">
      <view class="th__grid">
        <view v-for="item in filtered" :key="item.id" class="th__card" @tap="preview(item)">
          <image class="th__img" :src="item.cover" mode="aspectFill" lazy-load />
          <text class="th__title ellipsis">{{ item.title }}</text>
        </view>
      </view>
      <view class="th__safe" />
    </scroll-view>

    <view v-else class="th__empty">
      <view class="th__empty-art">
        <ui-icon name="history" :size="110" color="#d8d8e4" />
      </view>
      <text class="th__empty-text">这里还什么都没有呢~</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.th {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: $bg-card;

  &__body {
    flex: 1;
    min-height: 0;
  }

  &__grid {
    display: flex;
    flex-wrap: wrap;
    gap: 20rpx;
    padding: 24rpx $gap-page;
  }

  &__card {
    width: 333rpx;
  }

  &__img {
    width: 100%;
    height: 400rpx;
    border-radius: 24rpx;
    background: #f2f2f7;
  }

  &__title {
    display: block;
    margin-top: 12rpx;
    font-size: $fs-aux;
    color: $ink-2;
  }

  &__empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding-bottom: 120rpx;
  }

  &__empty-art {
    width: 240rpx;
    height: 240rpx;
    border-radius: 48rpx;
    background: $bg-fill;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__empty-text {
    margin-top: 32rpx;
    font-size: $fs-body;
    color: $ink-3;
  }
}
</style>
