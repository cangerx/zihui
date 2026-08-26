<script setup lang="ts">
/**
 * 生成中占位态（动效清单 #10）
 * 大占位卡 + 居中 spinner + 状态文案 + 副文案 + 已用时。
 * 不显示百分比：原型/视频里没有 xx% 数字，之前的 progress 是每轮 +8 封顶 92 的假进度。
 */
import { computed, onUnmounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 主状态文案，如「排队中」「AI 正在生成」 */
    statusText: string
    /** 是否计时 */
    active?: boolean
  }>(),
  { active: true },
)

const elapsed = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

function stop() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

watch(
  () => props.active,
  (on) => {
    stop()
    if (on) {
      elapsed.value = 0
      timer = setInterval(() => {
        elapsed.value += 1
      }, 1000)
    }
  },
  { immediate: true },
)

onUnmounted(stop)

const hint = computed(() => `已用时 ${elapsed.value}s · 请勿离开页面`)
</script>

<template>
  <view class="rp">
    <view class="rp__card">
      <view class="rp__spinner" />
      <text class="rp__status">{{ statusText || 'AI 正在生成中' }}</text>
      <text class="rp__hint">{{ hint }}</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.rp {
  padding: 24rpx $gap-page 0;

  /* 大占位卡，浅紫渐变底带呼吸感，非纯灰骨架 */
  &__card {
    position: relative;
    height: 720rpx;
    border-radius: $radius-card;
    background: linear-gradient(160deg, #eef0ff 0%, #f5f0ff 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    animation: rp-breathe 2.4s ease-in-out infinite;
  }

  &__spinner {
    width: 72rpx;
    height: 72rpx;
    border-radius: 50%;
    border: 6rpx solid rgba(95, 95, 253, 0.18);
    border-top-color: $brand;
    animation: rp-spin 0.8s linear infinite;
  }

  &__status {
    margin-top: 28rpx;
    font-size: $fs-body;
    font-weight: 600;
    color: $ink;
  }

  &__hint {
    margin-top: 12rpx;
    font-size: $fs-aux;
    color: $ink-3;
  }
}

@keyframes rp-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes rp-breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.82;
  }
}
</style>
