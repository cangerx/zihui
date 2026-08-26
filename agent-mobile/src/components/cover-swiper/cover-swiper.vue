<script setup lang="ts">
/**
 * 首页状态 B 的案例卡轮播（动效清单 #1）
 *
 * 原型实测（原型图/972f…jpg，设计稿 1260×2800）：
 *   - 卡片竖长方形 482×741px ≈ 287×441rpx（比例 0.651），三张同时在屏
 *   - 中间卡 x 389–870、y 488–1228；两侧卡同尺寸**不缩放**，下移 69px ≈ 40rpx
 *   - 两侧卡各向外倾斜约 4°（左卡逆时针、右卡顺时针）→ 摊开的扑克牌感
 *   - 卡间步进 575px ≈ 342rpx ⇒ swiper previous/next-margin = 204rpx
 *   - 圆角 45px ≈ 28rpx；卡面为纯图，**无**底部遮罩/标题/放大角标
 *     （实测中间卡底部 120px 内无低于 140 的灰度，两侧卡也未见半透明黑块）
 */
import { computed, ref, watch } from 'vue'
import type { HomeShowcase } from '@/api/mock/data'

const props = withDefaults(
  defineProps<{
    items: HomeShowcase[]
    /** 卡片宽，rpx */
    cardWidth?: number
    /** 卡片高，rpx */
    cardHeight?: number
  }>(),
  { cardWidth: 287, cardHeight: 441 },
)

/**
 * 事件名不能叫 tap：uni-app 把 tap 当**内置原生事件**，
 * 组件上写 @tap 会绑到原生 tap 上、把 emit 的 item 顶掉，
 * 父组件收到的是事件对象而不是案例数据（实测 keys 为 type/target/touches…），
 * 于是回填出 [undefined] 一张图 + 空 prompt，还会让输入卡的 trim() 抛错。
 */
const emit = defineEmits<{ pick: [item: HomeShowcase]; change: [index: number] }>()

const current = ref(0)

// items 变化时（切分类，条数可能从 4 变 3）重置 current，
// 否则 current 停在旧索引 → swiper 夹到末位、offsetOf 又按旧值算，
// 被抬起的卡与实际居中卡错位
watch(
  () => props.items,
  () => {
    current.value = 0
  },
)

/** 中间卡上留 14rpx、两侧卡下移到 54rpx，再给旋转溢出留 15rpx */
const swiperHeight = computed(() => props.cardHeight + 69)

function onChange(e: { detail: { current: number } }) {
  current.value = e.detail.current
  emit('change', e.detail.current)
}

/** 距当前项的偏移量（含循环回绕），决定左/中/右三种姿态 */
function offsetOf(index: number) {
  const total = props.items.length
  if (!total) return 0
  let diff = index - current.value
  if (diff > total / 2) diff -= total
  if (diff < -total / 2) diff += total
  return diff
}
</script>

<template>
  <swiper
    class="cs"
    :style="`height:${swiperHeight}rpx`"
    circular
    previous-margin="204rpx"
    next-margin="204rpx"
    :current="current"
    :display-multiple-items="1"
    @change="onChange"
  >
    <swiper-item v-for="(item, index) in items" :key="item.id" class="cs__item">
      <view
        class="cs__card"
        :class="[
          offsetOf(index) === 0 ? 'cs__card--on' : '',
          offsetOf(index) < 0 ? 'cs__card--left' : '',
          offsetOf(index) > 0 ? 'cs__card--right' : '',
        ]"
        :style="`width:${cardWidth}rpx;height:${cardHeight}rpx`"
        :aria-label="item.title"
        @tap="emit('pick', item)"
      >
        <image class="cs__img" :src="item.cover" mode="aspectFill" />
        <view v-if="item.video" class="cs__play">
          <ui-icon name="play" :size="36" color="#ffffff" />
        </view>
      </view>
    </swiper-item>
  </swiper>
</template>

<style lang="scss" scoped>
.cs {
  width: 100%;

  &__item {
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }

  /* 卡面纯图；标题印在图里，文字只作为 aria-label 不渲染（同模板卡处理） */
  &__card {
    position: relative;
    border-radius: $radius-card;
    overflow: hidden;
    background: $bg-skeleton;
    /* 默认即两侧姿态，避免首帧无 class 时跳动 */
    transform: translateY(54rpx);
    transition: transform $dur-base $ease-base;

    &--on {
      transform: translateY(14rpx);
      box-shadow: 0 20rpx 48rpx rgba(40, 40, 90, 0.18);
    }

    /* 两侧卡向外摊开：左卡逆时针、右卡顺时针，各 4°（实测边线斜率 3.6°–4.8°） */
    &--left {
      transform: translateY(54rpx) rotate(-4deg);
    }

    &--right {
      transform: translateY(54rpx) rotate(4deg);
    }
  }

  &__img {
    width: 100%;
    height: 100%;
  }

  &__play {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 88rpx;
    height: 88rpx;
    margin: -44rpx 0 0 -44rpx;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
  }
}
</style>
