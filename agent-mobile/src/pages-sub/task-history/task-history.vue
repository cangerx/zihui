<script setup lang="ts">
/**
 * 最近任务 / 作图记录
 * TODO(design)：原型未给出详图，按现有设计语言补齐
 */
import { computed, onUnmounted, ref } from 'vue'
import { onHide, onLoad, onShow } from '@dcloudio/uni-app'
import { cancelTask, deleteTask, getTask, listTasks } from '@/api/modules/tasks'
import { extractResultImages } from '@/api/modules/task-result'
import { USE_MOCK } from '@/api/config'
import { apiErrorCode, apiErrorInvalidatedSession } from '@/api/v1-client'
import { navigateToLoginOnce } from '@/api/login-navigation'
import { createPoller } from '@/utils/poller'
import { useUserStore } from '@/store/user'
import type { AppTask, TaskStatus } from '@zihui/contracts'
import type { WorkflowQueryResult } from '@/api/types'

interface TaskHistoryItem {
  id: string
  images: string[]
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
const busyTaskId = ref('')
let awaitingLogin = false
let loadSequence = 0
let needsReload = true
const pollers = new Map<string, ReturnType<typeof createPoller<AppTask>>>()

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
      navigateToLoginOnce()
      return
    }
    loadTasks()
  }
})

onShow(() => {
  if (awaitingLogin && user.isLogin) {
    awaitingLogin = false
    loadTasks()
    return
  }
  if (!isFavorite.value && needsReload && (USE_MOCK || user.isLogin)) loadTasks()
})

onHide(() => {
  needsReload = true
  loadSequence += 1
  stopPolling()
})

onUnmounted(() => stopPolling())

async function loadTasks() {
  const requestToken = user.token
  const sequence = ++loadSequence
  needsReload = false
  stopPolling()
  try {
    const tasks = await listTasks({ limit: 50 })
    if (sequence !== loadSequence) return
    if (!isCurrentSession(requestToken)) return
    items.value = tasks.map(toTaskHistoryItem)
    startPolling(sequence, requestToken)
  } catch (error) {
    if (sequence !== loadSequence) return
    if (handleSessionError(error)) return
    if (!isCurrentSession(requestToken)) return
    items.value = []
    uni.showToast({ title: '任务加载失败，请稍后重试', icon: 'none' })
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
  const title = (task.request as { prompt?: string })?.prompt || 'AI 图片任务'
  return {
    id: task.id,
    images,
    cover: images[0] || '/static/logo.png',
    title,
    status: task.status,
    statusLabel: labels[task.status],
    errorMessage: task.error?.message || '',
  }
}

function isPollingStatus(status: TaskStatus): boolean {
  return status === 'queued' || status === 'processing'
}

function isTerminalStatus(status: TaskStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

function isCurrentSession(requestToken: string): boolean {
  return USE_MOCK || (Boolean(user.isLogin) && requestToken === user.token)
}

function startPolling(sequence: number, requestToken: string) {
  for (const item of items.value) {
    if (!isPollingStatus(item.status)) continue
    startTaskPolling(item.id, sequence, requestToken)
  }
}

function startTaskPolling(id: string, sequence: number, requestToken: string) {
  if (pollers.has(id)) return
  const poller = createPoller<AppTask>({
    fetch: async () => {
      // Do not let a response from a hidden page or old token reach the UI.
      if (sequence !== loadSequence || !isCurrentSession(requestToken)) {
        throw new Error('stale_task_history_session')
      }
      return getTask(id)
    },
    isDone: (task) => !isPollingStatus(task.status),
    isFailed: (task) => task.status === 'failed',
    onTick: (task) => {
      if (!task || sequence !== loadSequence || !isCurrentSession(requestToken)) return
      updateItem(task)
    },
    onError: (error) => {
      // The API client proves whether this request invalidated the current token.
      // Observe that proof even if the page was hidden or the poller was aborted.
      handleSessionError(error)
    },
    interval: 1200,
    maxInterval: 3000,
    timeout: 120000,
  })
  pollers.set(id, poller)
  void poller.start().then(({ data, status }) => {
    if (pollers.get(id) === poller) pollers.delete(id)
    if (sequence !== loadSequence || !isCurrentSession(requestToken)) return
    if (data) updateItem(data)
    if (status === 'timeout') {
      uni.showToast({ title: '任务状态查询超时，可稍后刷新', icon: 'none' })
    }
  }).catch((error) => {
    if (pollers.get(id) === poller) pollers.delete(id)
    if (sequence !== loadSequence) return
    if (handleSessionError(error)) return
    if (!isCurrentSession(requestToken)) return
    uni.showToast({ title: '任务状态查询失败，可稍后刷新', icon: 'none' })
  })
}

function updateItem(task: AppTask) {
  const index = items.value.findIndex((item) => item.id === task.id)
  if (index < 0) return
  items.value[index] = toTaskHistoryItem(task)
}

function stopPolling() {
  for (const poller of pollers.values()) poller.abort()
  pollers.clear()
}

function stopPollingFor(id: string) {
  const poller = pollers.get(id)
  if (!poller) return
  poller.abort()
  pollers.delete(id)
}

function handleSessionError(error: unknown): boolean {
  const isUnauthorized = apiErrorCode(error) === 401
  if (USE_MOCK || !isUnauthorized) return false
  // An old request can return 401 after another request has rotated the token;
  // only the API client's current-token invalidation proof may log the user out.
  if (!apiErrorInvalidatedSession(error)) return true
  loadSequence += 1
  needsReload = true
  stopPolling()
  user.logout()
  awaitingLogin = true
  navigateToLoginOnce()
  return true
}

function preview(item: TaskHistoryItem) {
  if (item.status !== 'succeeded') {
    uni.showToast({ title: item.errorMessage || item.statusLabel, icon: 'none' })
    return
  }
  if (!item.images.length) {
    uni.showToast({ title: '任务没有可预览的图片', icon: 'none' })
    return
  }
  uni.previewImage({ urls: item.images, current: item.images[0] })
}

function confirmCancel(item: TaskHistoryItem) {
  if (item.status !== 'queued' || busyTaskId.value) return
  uni.showModal({
    title: '取消任务',
    content: '确定取消这个排队中的任务吗？',
    success: ({ confirm }) => {
      if (confirm) void cancel(item)
    },
  })
}

async function cancel(item: TaskHistoryItem) {
  if (item.status !== 'queued' || busyTaskId.value) return
  const requestToken = user.token
  busyTaskId.value = item.id
  stopPollingFor(item.id)
  try {
    const task = await cancelTask(item.id)
    if (!isCurrentSession(requestToken)) return
    updateItem(task)
  } catch (error) {
    if (handleSessionError(error)) return
    if (!isCurrentSession(requestToken)) return
    // A failed cancellation leaves a queued task eligible for polling again.
    const current = items.value.find((candidate) => candidate.id === item.id)
    if (current && isPollingStatus(current.status)) {
      startTaskPolling(current.id, loadSequence, requestToken)
    }
    uni.showToast({ title: '任务取消失败，请稍后重试', icon: 'none' })
  } finally {
    if (busyTaskId.value === item.id) busyTaskId.value = ''
  }
}

function confirmDelete(item: TaskHistoryItem) {
  if (!isTerminalStatus(item.status) || busyTaskId.value) return
  uni.showModal({
    title: '删除任务',
    content: '删除后将无法恢复，确定继续吗？',
    success: ({ confirm }) => {
      if (confirm) void remove(item)
    },
  })
}

async function remove(item: TaskHistoryItem) {
  if (!isTerminalStatus(item.status) || busyTaskId.value) return
  const requestToken = user.token
  busyTaskId.value = item.id
  try {
    await deleteTask(item.id)
    if (!isCurrentSession(requestToken)) return
    items.value = items.value.filter((candidate) => candidate.id !== item.id)
  } catch (error) {
    if (handleSessionError(error)) return
    if (!isCurrentSession(requestToken)) return
    uni.showToast({ title: '任务删除失败，请稍后重试', icon: 'none' })
  } finally {
    if (busyTaskId.value === item.id) busyTaskId.value = ''
  }
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
            <text v-if="item.images.length > 1" class="th__count">{{ item.images.length }} 张</text>
          </view>
          <text class="th__title ellipsis">{{ item.title }}</text>
          <text v-if="item.errorMessage" class="th__error ellipsis">{{ item.errorMessage }}</text>
          <view v-if="item.status === 'queued' || isTerminalStatus(item.status)" class="th__actions">
            <view
              v-if="item.status === 'queued'"
              class="th__action"
              :class="{ 'th__action--busy': busyTaskId === item.id }"
              @tap.stop="confirmCancel(item)"
            >
              <ui-icon name="close" :size="24" color="#666670" />
              <text>取消</text>
            </view>
            <view
              v-else
              class="th__action th__action--danger"
              :class="{ 'th__action--busy': busyTaskId === item.id }"
              @tap.stop="confirmDelete(item)"
            >
              <ui-icon name="trash" :size="24" color="#c63737" />
              <text>删除</text>
            </view>
          </view>
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

  &__count {
    position: absolute;
    bottom: 12rpx;
    left: 12rpx;
    padding: 6rpx 12rpx;
    border-radius: 8rpx;
    background: rgba(22, 22, 26, 0.72);
    font-size: 22rpx;
    color: #ffffff;
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

  &__actions {
    display: flex;
    justify-content: flex-end;
    min-height: 42rpx;
    margin-top: 8rpx;
  }

  &__action {
    display: inline-flex;
    align-items: center;
    gap: 6rpx;
    padding: 4rpx 0 4rpx 12rpx;
    font-size: 22rpx;
    color: #666670;

    &--danger {
      color: $danger;
    }

    &--busy {
      opacity: 0.45;
    }
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
