<script setup lang="ts">
/** 图片上传字段：九宫格选图 + 删除 + 预览 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string[]
    maxCount?: number
    label?: string
  }>(),
  { maxCount: 1 },
)

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const canAdd = computed(() => props.modelValue.length < props.maxCount)

function pick() {
  const remain = props.maxCount - props.modelValue.length
  uni.chooseImage({
    count: remain,
    sizeType: ['compressed'],
    success: (res) => {
      const paths = (res.tempFilePaths as string[]) || []
      emit('update:modelValue', [...props.modelValue, ...paths].slice(0, props.maxCount))
    },
  })
}

function remove(index: number) {
  const next = props.modelValue.slice()
  next.splice(index, 1)
  emit('update:modelValue', next)
}

function preview(index: number) {
  uni.previewImage({ urls: props.modelValue, current: props.modelValue[index] })
}
</script>

<template>
  <view class="fi">
    <view v-for="(img, i) in modelValue" :key="`${img}-${i}`" class="fi__item">
      <image class="fi__img" :src="img" mode="aspectFill" @tap="preview(i)" />
      <view class="fi__del" @tap.stop="remove(i)">
        <ui-icon name="close" :size="22" color="#ffffff" />
      </view>
    </view>
    <view v-if="canAdd" class="fi__add" @tap="pick">
      <ui-icon name="plus" :size="44" color="#aaaaaa" />
      <text class="fi__add-text">{{ modelValue.length }}/{{ maxCount }}</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.fi {
  display: flex;
  flex-wrap: wrap;
  gap: 20rpx;

  &__item {
    position: relative;
    width: 200rpx;
    height: 200rpx;
  }

  &__img {
    width: 100%;
    height: 100%;
    border-radius: 20rpx;
  }

  &__del {
    position: absolute;
    top: -8rpx;
    right: -8rpx;
    width: 36rpx;
    height: 36rpx;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__add {
    width: 200rpx;
    height: 200rpx;
    border-radius: 20rpx;
    background: $bg-fill;
    border: 1px dashed #d6d6e0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8rpx;
  }

  &__add-text {
    font-size: $fs-aux;
    color: $ink-3;
  }
}
</style>
