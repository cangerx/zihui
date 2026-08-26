<script setup lang="ts">
/**
 * 修复前/后对比控件：双图叠放 + 中缝可拖动拖柄。
 * 上层图用宽度裁切（wrapper overflow:hidden）实现，touchmove 改变裁切比例。
 * 小程序不支持 clip-path inset 动态值，改用双层 wrapper 宽度裁切。
 */
import { getCurrentInstance, nextTick, onMounted, ref } from 'vue'

const instance = getCurrentInstance()

const props = withDefaults(
  defineProps<{
    before: string
    after: string
    beforeLabel?: string
    afterLabel?: string
  }>(),
  { beforeLabel: '修复前', afterLabel: '修复后' },
)

/** 分割位置百分比：左侧显示 before，右侧显示 after */
const ratio = ref(50)
let trackLeft = 0
let trackWidth = 0
/** 上层图宽度（px）= 容器实际宽，绑到内层图避免写死 686rpx（容器非该宽时两层错位） */
const boxWidth = ref(0)

function measure(cb?: () => void) {
  uni.createSelectorQuery()
    .in(instance)
    .select('.ic')
    .boundingClientRect((rect) => {
      const box = rect as UniApp.NodeInfo
      if (box) {
        trackLeft = box.left || 0
        trackWidth = box.width || 0
        boxWidth.value = box.width || 0
      }
      cb?.()
    })
    .exec()
}

// 挂载后先量一次：trackWidth/boxWidth 就位，首次拖动不丢帧、上层图宽度不写死
onMounted(() => {
  nextTick(() => measure())
})

function updateFromClientX(clientX: number) {
  if (trackWidth <= 0) return
  const pct = ((clientX - trackLeft) / trackWidth) * 100
  ratio.value = Math.min(Math.max(pct, 4), 96)
}

function onTouchStart(e: TouchEvent) {
  const touch = e.touches?.[0]
  // 已在 onMounted 量过；这里兜底重量（如容器尺寸变化），量到后再套用本次触点
  measure(() => {
    if (touch) updateFromClientX(touch.clientX)
  })
}

function onTouchMove(e: TouchEvent) {
  const touch = e.touches?.[0]
  if (touch) updateFromClientX(touch.clientX)
}
</script>

<template>
  <view
    class="ic"
    @touchstart="onTouchStart"
    @touchmove.stop.prevent="onTouchMove"
  >
    <!-- 底层：修复后（右侧可见） -->
    <image class="ic__img" :src="after" mode="aspectFill" />
    <view class="ic__tag ic__tag--after">
      <text class="ic__tag-text">{{ afterLabel }}</text>
    </view>

    <!-- 上层：修复前，按 ratio 裁切宽度 -->
    <view class="ic__clip" :style="`width:${ratio}%`">
      <image
        class="ic__img ic__img--fixed"
        :style="boxWidth ? `width:${boxWidth}px` : ''"
        :src="before"
        mode="aspectFill"
      />
      <view class="ic__tag ic__tag--before">
        <text class="ic__tag-text">{{ beforeLabel }}</text>
      </view>
    </view>

    <!-- 中缝 + 圆形拖柄 -->
    <view class="ic__handle" :style="`left:${ratio}%`">
      <view class="ic__line" />
      <view class="ic__knob">
        <ui-icon name="back" :size="20" color="#333333" />
        <ui-icon name="arrow" :size="20" color="#333333" />
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ic {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: $radius-card;
  overflow: hidden;
  background: $bg-fill;

  &__img {
    width: 100%;
    height: 100%;
    display: block;
  }

  /* 上层裁切容器：图片固定为容器实际宽（100% of .ic），靠 clip 宽度露出左侧 */
  &__clip {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    overflow: hidden;
  }

  /*
   * 宽度由 JS 测得的容器实际宽（boxWidth px）绑定，见 template inline style。
   * 此处兜底：boxWidth 未就绪时先用 100vw 撑满，避免闪一下 0 宽。
   * 之前写死 686rpx，容器非该宽时上下两层缩放不一致 → 拖动中错位。
   */
  &__img--fixed {
    width: 100vw;
  }

  &__tag {
    position: absolute;
    bottom: 20rpx;
    height: 44rpx;
    padding: 0 18rpx;
    border-radius: 22rpx;
    background: rgba(0, 0, 0, 0.42);
    display: flex;
    align-items: center;

    &--before {
      left: 20rpx;
    }

    &--after {
      right: 20rpx;
    }
  }

  &__tag-text {
    font-size: $fs-mini;
    color: #ffffff;
  }

  &__handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2rpx;
    margin-left: -1rpx;
    background: rgba(255, 255, 255, 0.92);
  }

  &__knob {
    width: 56rpx;
    height: 56rpx;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.18);
    display: flex;
    align-items: center;
    justify-content: center;
  }
}
</style>
