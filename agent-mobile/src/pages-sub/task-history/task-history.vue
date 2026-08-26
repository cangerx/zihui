<script setup lang="ts">
/**
 * 最近任务 / 作图记录
 * TODO(design)：原型未给出详图，按现有设计语言补齐
 */
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { listTasks } from '@/api/modules/tasks'
import { extractResultImages } from '@/api/modules/app'
import { USE_MOCK } from '@/api/config'
import { apiErrorCode } from '@/api/v1-client'
import { useUserStore } from '@/store/user'
import type { AppTask, TaskStatus } from '@zihui/contracts'
import type { WorkflowQueryResult } from '@/api/types'

interface TaskHistoryItem {
  id: string
  cover: string
  title: string
  status: TaskStatus
  statusLabel: string
  errorMessage: string
}

const user = useUserStore()
const tabs = ['全部', '生成中', '已完成', '失败']
const activeTab = ref(0)
const items = ref<TaskHistoryItem[]>([])
const isFavorite = ref(false)
let awaitingLogin = false

// tab：全部 / 生成中 / 已完成，按 status 筛。之前 computed 忽略 activeTab、点了无变化
const filtered = computed(() => {
  if (isFavorite.value || activeTab.value === 0) return items.value
  if (activeTab.value === 1) {
    return items.value.filter((item) => item.status === 'queued' || item.status === 'processing')
  }
  if (activeTab.value === 2) return items.value.filter((item) => item.status === 'succeeded')
  return items.value.filter((item) => item.status === 'failed' || item.status === 'cancelled')
})

onLoad((query) => {
  isFavorite.value = query?.type === 'favorite'
  uni.setNavigationBarTitle({ title: isFavorite.value ? '我的收藏' : '最近任务' })
  if (!isFavorite.value) {
    if (!USE_MOCK && !user.isLogin) {
      awaitingLogin = true
      uni.navigateTo({ url: '/pages-sub/login/login' })
      return
    }
    loadTasks()
  }
})

onShow(() => {
  if (awaitingLogin && user.isLogin) {
    awaitingLogin = false
    loadTasks()
  }
})

async function loadTasks() {
  try {
    const tasks = await listTasks({ limit: 50 })
    items.value = tasks.map(toTaskHistoryItem)
  } catch (error) {
    items.value = []
    if (!USE_MOCK && apiErrorCode(error) === 401) {
      user.logout()
      awaitingLogin = true
      uni.navigateTo({ url: '/pages-sub/login/login' })
    } else {
      uni.showToast({ title: '任务加载失败，请稍后重试', icon: 'none' })
    }
  }
}

function toTaskHistoryItem(task: AppTask): TaskHistoryItem {
  const images = extractResultImages(
    (task.result || undefined) as WorkflowQueryResult['result'] | undefined,
  )
  const labels: Record<TaskStatus, string> = {
    queued: '排队中',
    processing: '生成中',
    succeeded: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }
  return {
    id: task.id,
    cover: images[0] || '/static/logo.png',
    title: (task.request as { prompt?: string })?.prompt || 'AI 图片任务',
    status: task.status,
    statusLabel: labels[task.status],
    errorMessage: task.error?.message || '',
  }
}

function preview(item: TaskHistoryItem) {
  if (item.status !== 'succeeded') {
    uni.showToast({ title: item.errorMessage || item.statusLabel, icon: 'none' })
    return
  }
  uni.previewImage({ urls: [item.cover] })
}
</script>

<template>
  <view class="th">
    <tab-underline v-if="!isFavorite" v-model="activeTab" :items="tabs" :scroll="false" />

    <scroll-view v-if="filtered.length" class="th__body" scroll-y :show-scrollbar="false">
      <view class="th__grid">
        <view v-for="item in filtered" :key="item.id" class="th__card" @tap="preview(item)">
          <view class="th__media">
            <image class="th__img" :src="item.cover" mode="aspectFill" lazy-load />
            <text class="th__status" :class="`th__status--${item.status}`">
              {{ item.statusLabel }}
            </text>
          </view>
          <text class="th__title ellipsis">{{ item.title }}</text>
          <text v-if="item.errorMessage" class="th__error ellipsis">{{ item.errorMessage }}</text>
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

  &__media {
    position: relative;
  }

  &__status {
    position: absolute;
    top: 12rpx;
    right: 12rpx;
    padding: 8rpx 14rpx;
    border-radius: 8rpx;
    background: rgba(22, 22, 26, 0.72);
    font-size: 22rpx;
    color: #ffffff;

    &--failed,
    &--cancelled {
      background: rgba(198, 55, 55, 0.9);
    }
  }

  &__title {
    display: block;
    margin-top: 12rpx;
    font-size: $fs-aux;
    color: $ink-2;
  }

  &__error {
    display: block;
    margin-top: 6rpx;
    font-size: 22rpx;
    color: $danger;
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
