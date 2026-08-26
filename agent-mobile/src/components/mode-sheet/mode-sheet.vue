<script setup lang="ts">
/**
 * 模式选择弹窗：普通/高级模式 + 美豆价目表
 * 对照 原型图/b7b5da7a9ba2adf9caa084a7910a5d56.jpg
 */
import { runModes } from '@/api/mock/data'

const props = defineProps<{
  modelValue: boolean
  mode: 'normal' | 'advanced'
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:mode': [value: 'normal' | 'advanced']
}>()

function pick(key: string) {
  emit('update:mode', key as 'normal' | 'advanced')
}
</script>

<template>
  <popup-sheet
    :model-value="modelValue"
    title="选择模式"
    closable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <view class="ms">
      <view
        v-for="item in runModes.options"
        :key="item.key"
        class="ms__item"
        :class="{ 'ms__item--on': mode === item.key }"
        @tap="pick(item.key)"
      >
        <view class="ms__row">
          <text class="ms__name">{{ item.name }}</text>
          <view v-if="item.badge" class="ms__badge">
            <text class="ms__badge-text">{{ item.badge }}</text>
          </view>
        </view>
        <text class="ms__desc">{{ item.desc }}</text>
        <view v-if="mode === item.key" class="ms__check">
          <ui-icon name="check" :size="22" color="#ffffff" />
        </view>
      </view>

      <view class="ms__table">
        <view class="ms__tr ms__tr--head">
          <text class="ms__td ms__td--name" />
          <text class="ms__td">普通模式</text>
          <text class="ms__td">高级模式</text>
        </view>
        <view v-for="row in runModes.table" :key="row.name" class="ms__tr">
          <text class="ms__td ms__td--name">{{ row.name }}</text>
          <text class="ms__td">{{ row.normal }}</text>
          <text class="ms__td">{{ row.advanced || '-' }}</text>
        </view>
      </view>

      <view class="ms__cta" @tap="emit('update:modelValue', false)">
        <text class="ms__cta-text">确认</text>
      </view>
    </view>
  </popup-sheet>
</template>

<style lang="scss" scoped>
.ms {
  padding: 0 $gap-page 32rpx;

  &__item {
    position: relative;
    margin-bottom: 20rpx;
    padding: 24rpx;
    border-radius: 24rpx;
    background: $bg-fill;
    border: 2rpx solid transparent;
    transition: all $dur-fast $ease-base;

    &--on {
      background: $brand-light;
      border-color: $brand;
    }
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 12rpx;
  }

  &__name {
    font-size: 32rpx;
    font-weight: 600;
    color: $ink;
  }

  &__badge {
    height: 32rpx;
    padding: 0 12rpx;
    border-radius: 16rpx;
    background: linear-gradient(90deg, #ff9a4d, #ff6a3d);
    display: flex;
    align-items: center;
  }

  &__badge-text {
    font-size: $fs-mini;
    color: #ffffff;
  }

  &__desc {
    display: block;
    margin-top: 10rpx;
    font-size: $fs-aux;
    color: $ink-2;
  }

  &__check {
    position: absolute;
    top: 24rpx;
    right: 24rpx;
    width: 36rpx;
    height: 36rpx;
    border-radius: 50%;
    background: $brand;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__table {
    margin-top: 12rpx;
    border-radius: 20rpx;
    background: $bg-table-row;
    overflow: hidden;
  }

  &__tr {
    display: flex;
    align-items: center;
    height: 76rpx;

    &--head {
      background: $bg-table-head;
    }
  }

  &__td {
    flex: 1;
    text-align: center;
    font-size: $fs-aux;
    color: $ink-2;

    &--name {
      flex: 1.2;
      text-align: left;
      padding-left: 24rpx;
      color: $ink;
    }
  }

  &__cta {
    margin-top: 28rpx;
    height: 96rpx;
    border-radius: 48rpx;
    background: $brand;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__cta-text {
    font-size: 32rpx;
    font-weight: 600;
    color: #ffffff;
  }
}
</style>
