<script setup lang="ts">
/**
 * AI 帮写弹层：把商品图 + 已填设置交给 AI，产出结构化商品信息文案
 * 对照 docs/电商套图内页.md §2（原型图/9403…jpg 下半，弹层未被蒙层压暗）
 *
 * 实测：顶部圆角 R74px ≈ 44rpx（比常规弹窗 40rpx 更圆，故 popup-sheet 传 radius）
 *       头部 icon 48×36px、标题左对齐（非居中）、右侧圆钮 66×64px ≈ 39rpx
 *       头下 1px 分隔线，x60–1199
 *       正文 8 行、行距 77px ≈ 46rpx、左内缩 70px ≈ 42rpx，**无灰底**（采样纯白）
 *       底部按钮 683×100rpx；原型定格在 loading 态，底色 #777779 白字
 */
const props = withDefaults(
  defineProps<{
    modelValue: boolean
    /** 已生成的文案；空串 = 还没写过 */
    text?: string
    /** 正在帮写 */
    loading?: boolean
  }>(),
  { text: '', loading: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 触发（重新）帮写 */
  write: []
  /** 采用当前文案 */
  apply: [text: string]
}>()

function close() {
  emit('update:modelValue', false)
}

function onPrimary() {
  if (props.loading) return
  if (props.text) emit('apply', props.text)
  else emit('write')
}
</script>

<template>
  <popup-sheet
    :model-value="modelValue"
    radius="44rpx"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <view class="aws">
      <view class="aws__head">
        <ui-icon name="ai-image" :size="29" color="#16161a" />
        <text class="aws__title">帮写</text>
        <view class="aws__close" @tap="close">
          <ui-icon name="close" :size="39" color="#9a9aa5" />
        </view>
      </view>

      <view class="aws__line" />

      <scroll-view class="aws__body" scroll-y :show-scrollbar="false">
        <text v-if="text" class="aws__text">{{ text }}</text>
        <text v-else class="aws__empty">
          点下方按钮，AI 会读取你上传的商品图与生成设置，写出品名、核心卖点、目标受众与使用场景。
        </text>
      </scroll-view>

      <view class="aws__actions">
        <!-- 已有文案时给「重写」出口，否则首次帮写后 write 事件不可达、只能采用或关掉 -->
        <view v-if="text && !loading" class="aws__rewrite" @tap="emit('write')">
          <text class="aws__rewrite-text">重写</text>
        </view>
        <view class="aws__btn" :class="{ 'aws__btn--loading': loading }" @tap="onPrimary">
          <text class="aws__btn-text">
            {{ loading ? '正在帮写请稍后...' : text ? '采用这段文案' : '开始帮写' }}
          </text>
        </view>
      </view>
    </view>
  </popup-sheet>
</template>

<style lang="scss" scoped>
.aws {
  /* sheet 顶 1407 → 头部 ink 顶 1489 = 82px；49rpx 时浏览器量到 89px，回调 4rpx */
  padding-top: 45rpx;

  &__head {
    display: flex;
    align-items: center;
    /* icon 右 104 → 标题左 125，间距 21px ≈ 12rpx */
    gap: 12rpx;
    /* 头部 icon 左起 57px ≈ 34rpx */
    padding: 0 34rpx;
  }

  &__title {
    flex: 1;
    font-size: $fs-title;
    font-weight: 600;
    color: $ink;
  }

  &__close {
    display: flex;
    align-items: center;
  }

  /*
   * 分隔线 x60–1199 ⇒ 左右内缩 36rpx；标题 ink 底 1533 → 线 1617 = 84px。
   * 50rpx 时浏览器量到 90px（字形下方留白），回调 4rpx。
   */
  &__line {
    height: 1px;
    margin: 46rpx 36rpx 0;
    background: $line;
  }

  &__body {
    /*
     * 正文 ink 左起 x118（设计px）⇒ 118 × 0.595 ≈ 70rpx。
     * 线 1619 → 正文 ink 顶 1689 = 70 设计px；但 line-height 1.64 会在首行字形上方
     * 留约 (46−28)/2 ≈ 9 设计px 的半行距，所以 padding-top 写 35rpx 才量到 70。
     */
    max-height: 640rpx;
    padding: 35rpx 70rpx 0;
  }

  &__text,
  &__empty {
    display: block;
    font-size: $fs-body;
    /* 行距 77px ≈ 46rpx ⇒ line-height 46/28 ≈ 1.64 */
    line-height: 1.64;
    white-space: pre-wrap;
  }

  &__text {
    color: $ink;
  }

  &__empty {
    color: $ink-3;
  }

  /* 正文 ink 底 2275 → 按钮顶 2443，间距 168px ≈ 100rpx */
  /* 原型是单主按钮居中；加「重写」后改成一行，主按钮占满剩余宽 */
  &__actions {
    display: flex;
    align-items: center;
    gap: 20rpx;
    /* 保持与原型相同的上下留白与左右内缩（683rpx 居中 ⇒ 两侧各约 34rpx） */
    margin: 100rpx 34rpx 24rpx;
  }

  &__rewrite {
    height: 100rpx;
    padding: 0 40rpx;
    border-radius: $radius-btn;
    background: $bg-fill;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__rewrite-text {
    font-size: $fs-title;
    color: $ink-2;
  }

  &__btn {
    flex: 1;
    height: 100rpx;
    border-radius: $radius-btn;
    background: $brand;
    display: flex;
    align-items: center;
    justify-content: center;

    /* 原型定格态：底色实测 (119,119,121) */
    &--loading {
      background: $btn-loading;
    }
  }

  &__btn-text {
    font-size: $fs-title;
    font-weight: 600;
    color: #ffffff;
  }
}
</style>
