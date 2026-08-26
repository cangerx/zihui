<script setup lang="ts">
/** 线性图标：内部走 data URI，小程序 / H5 通用 */
import { computed } from 'vue'
import { icon } from '@/utils/icons'

const props = withDefaults(
  defineProps<{
    name: string
    /** 尺寸，单位 rpx */
    size?: number
    color?: string
  }>(),
  { size: 40, color: '#111111' },
)

const src = computed(() => icon(props.name, props.color))
const style = computed(() => `width:${props.size}rpx;height:${props.size}rpx`)
</script>

<template>
  <image class="ui-icon" :src="src" :style="style" mode="aspectFit" />
</template>

<style lang="scss" scoped>
.ui-icon {
  display: block;
  flex-shrink: 0;
}
</style>
