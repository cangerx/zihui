<script setup lang="ts">
/**
 * 资产库弹窗：最近保存 / 套图配方 / 模特库 + 空态
 * 对照 原型图/a0ffffe0b43d9bd618f1b1175b0a923d.jpg
 */
import { computed, ref } from 'vue'
import { assetLibrary, assetTabs } from '@/api/mock/data'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    /** 各 tab 的素材，键为 tab 序号；不传则用 mock */
    assets?: Record<number, string[]>
  }>(),
  { assets: undefined },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  pick: [url: string]
}>()

const activeTab = ref(0)

const list = computed(() => (props.assets || assetLibrary)[activeTab.value] || [])

function pick(url: string) {
  emit('pick', url)
  emit('update:modelValue', false)
}
</script>

<template>
  <popup-sheet
    :model-value="modelValue"
    title="资产库"
    closable
    height="63vh"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <view class="as">
      <tab-underline v-model="activeTab" :items="assetTabs" :scroll="false" />

      <scroll-view v-if="list.length" class="as__body" scroll-y :show-scrollbar="false">
        <view class="as__grid">
          <image
            v-for="url in list"
            :key="url"
            class="as__item"
            :src="url"
            mode="aspectFill"
            @tap="pick(url)"
          />
        </view>
      </scroll-view>

      <view v-else class="as__empty">
        <view class="as__empty-art">
          <ui-icon name="image" :size="120" color="#d8d8e4" />
        </view>
        <text class="as__empty-text">这里还什么都没有呢~</text>
      </view>
    </view>
  </popup-sheet>
</template>

<style lang="scss" scoped>
.as {
  height: 100%;
  display: flex;
  flex-direction: column;

  &__body {
    flex: 1;
    min-height: 0;
  }

  &__grid {
    display: flex;
    flex-wrap: wrap;
    gap: 16rpx;
    padding: 24rpx $gap-page;
  }

  &__item {
    width: 218rpx;
    height: 218rpx;
    border-radius: 20rpx;
    background: #f2f2f7;
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
