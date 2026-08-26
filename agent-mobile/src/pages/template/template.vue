<script setup lang="ts">
/**
 * 模板页：搜索栏 + 一级分类 tab + 筛选行 + 双列瀑布流
 * 对照 原型图/魔板.jpg、首页2.jpg
 * 动效：#7 瀑布流懒加载 #12 tab 下划线滑动
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getNavMetrics } from '@/utils/system'
import { USE_MOCK } from '@/api/config'
import { getTemplatePage, type DiscoveryTemplateItem } from '@/api/modules/discovery'

const metrics = getNavMetrics()
const headStyle = computed(() => `padding-top:${metrics.statusBarHeight + 8}px`)

const templateTabs = ['全部', 'VIP', '爆款视频', '电商', '社交媒体', '教育培训', '餐饮美食']
const templateFilters = [
  { key: 'industry', name: '行业' },
  { key: 'usage', name: '用途' },
  { key: 'layout', name: '版式' },
  { key: 'more', name: '更多' },
]
const templateSorts = ['综合排序', '最新', '最热']

const keyword = ref('')
const activeTab = ref(0)
const sortIndex = ref(0)
/** 已选筛选项：key → 展示文案 */
const filterValues = ref<Record<string, string>>({})

const templates = ref<DiscoveryTemplateItem[]>([])
const page = ref(1)
const loading = ref(false)
const hasMore = ref(true)
const loadError = ref('')

onLoad(() => {
  load(true)
})

async function load(reset = false) {
  if (loading.value) return
  if (!reset && !hasMore.value) return
  loading.value = true
  loadError.value = ''
  if (reset) {
    page.value = 1
    hasMore.value = true
  }
  try {
    const result = await getTemplatePage({
      page: page.value,
      size: 12,
      keyword: keyword.value,
      tab: templateTabs[activeTab.value],
      filters: filterValues.value,
      sort: templateSorts[sortIndex.value],
    })
    templates.value = reset ? result.items : templates.value.concat(result.items)
    hasMore.value = result.hasMore
    page.value += 1
  } catch {
    templates.value = reset ? [] : templates.value
    hasMore.value = false
    loadError.value = '模板暂时无法加载，请稍后重试'
  } finally {
    loading.value = false
  }
}

function onTabChange(index: number) {
  activeTab.value = index
  load(true)
}

function onFilterTap(_key: string, name: string) {
  // TODO(api)：筛选面板原型未给详图，分类字典待后端提供。
  // 之前用「行业A/行业B」假选项会直接暴露给用户，这里先给明确提示，不塞假数据。
  uni.showToast({ title: `「${name}」筛选待接入`, icon: 'none' })
}

function onSortTap() {
  uni.showActionSheet({
    itemList: templateSorts,
    success: (res) => {
      sortIndex.value = res.tapIndex
      load(true)
    },
  })
}

function onCamera() {
  uni.chooseImage({
    count: 1,
    success: () => uni.showToast({ title: '识图搜模板开发中', icon: 'none' }),
  })
}

function onTemplateTap(item: DiscoveryTemplateItem) {
  // 生产模板接口尚未开放；防止残留/深链数据跳入未启用工具。
  if (!USE_MOCK) return
  uni.navigateTo({ url: `/pages-sub/tool-run/tool-run?template=${item.id}` })
}

function filterLabel(key: string, name: string) {
  return filterValues.value[key] || name
}
</script>

<template>
  <view class="tpl">
    <view class="tpl__head" :style="headStyle">
      <!-- 相机在胶囊内部右侧，非独立按钮；胶囊通栏 -->
      <view class="tpl__search">
        <ui-icon name="search" :size="30" color="#999999" />
        <input
          v-model="keyword"
          class="tpl__input"
          placeholder="直播封面"
          placeholder-class="tpl__ph"
          confirm-type="search"
          @confirm="load(true)"
        />
        <view class="tpl__camera" @tap.stop="onCamera">
          <ui-icon name="camera" :size="30" color="#333333" />
        </view>
      </view>
    </view>

    <tab-underline
      :model-value="activeTab"
      :items="templateTabs"
      class="tpl__tabs"
      @update:model-value="onTabChange"
    />

    <view class="tpl__filters">
      <view class="tpl__filter-left">
        <view
          v-for="item in templateFilters"
          :key="item.key"
          class="tpl__filter"
          :class="{ 'tpl__filter--on': filterValues[item.key] }"
          @tap="onFilterTap(item.key, item.name)"
        >
          <text class="tpl__filter-text">{{ filterLabel(item.key, item.name) }}</text>
          <ui-icon name="arrow-down" :size="22" color="#666666" />
        </view>
      </view>
      <view class="tpl__sort" @tap="onSortTap">
        <text class="tpl__filter-text">{{ templateSorts[sortIndex] }}</text>
        <ui-icon name="arrow-down" :size="22" color="#666666" />
      </view>
    </view>

    <scroll-view class="tpl__list" scroll-y :show-scrollbar="false" @scrolltolower="load(false)">
      <template-waterfall
        :items="templates"
        :loading="loading"
        :has-more="hasMore"
        @pick="onTemplateTap"
      />
      <view v-if="!loading && !templates.length" class="tpl__empty">
        <ui-icon name="image" :size="80" color="#c5c5d0" />
        <text class="tpl__empty-title">模板功能尚未开放</text>
        <text class="tpl__empty-text">
          {{ loadError || (USE_MOCK ? '暂无符合条件的模板' : '模板接口接入后将在这里展示') }}
        </text>
      </view>
      <view class="tpl__safe" />
    </scroll-view>
  </view>
</template>

<style lang="scss" scoped>
.tpl {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: $bg-card;

  &__head {
    display: flex;
    align-items: center;
    padding: 0 $gap-page 16rpx;
  }

  /* 通栏胶囊，高实测 108px ≈ 64rpx */
  &__search {
    flex: 1;
    height: 64rpx;
    padding: 0 24rpx;
    border-radius: $radius-btn;
    background: $bg-fill;
    display: flex;
    align-items: center;
    gap: 12rpx;
  }

  &__input {
    flex: 1;
    font-size: $fs-body;
    color: $ink;
  }

  &__ph {
    color: $ink-3;
  }

  &__camera {
    width: 40rpx;
    display: flex;
    justify-content: center;
    flex-shrink: 0;
  }

  &__tabs {
    border-bottom: 1px solid $line;
  }

  &__filters {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20rpx $gap-page;
  }

  &__filter-left {
    display: flex;
    align-items: center;
    gap: 12rpx;
  }

  /* 原型筛选行是纯文字 + ▾，无胶囊底；选中态靠文字变色 */
  &__filter,
  &__sort {
    height: 56rpx;
    display: flex;
    align-items: center;
    gap: 4rpx;
  }

  &__filter--on &__filter-text {
    color: $brand;
    font-weight: 600;
  }

  &__filter-text {
    font-size: $fs-aux;
    color: $ink-2;
  }

  &__list {
    flex: 1;
    min-height: 0;
  }

  &__empty {
    min-height: 520rpx;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  &__empty-title {
    margin-top: 26rpx;
    font-size: $fs-title;
    font-weight: 600;
    color: $ink;
  }

  &__empty-text {
    margin-top: 12rpx;
    font-size: $fs-aux;
    color: $ink-3;
  }

  &__safe {
    height: 40rpx;
  }
}
</style>
