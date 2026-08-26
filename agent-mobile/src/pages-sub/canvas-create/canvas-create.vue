<script setup lang="ts">
/**
 * 创建空白画布：比例预览联动 + 自定义尺寸校验 + 推荐尺寸列表
 * 对照 原型图/会员购买弹窗.jpg 底层页面
 */
import { computed, ref } from 'vue'
import { canvasSizes } from '@/api/mock/data'
import { inputValue } from '@/utils/event'

const tabs = ['空白画布', '图片编辑', '拼图', '作图记录']
const activeTab = ref(0)

const MIN = 100
const MAX = 5000

const width = ref(1242)
const height = ref(1656)

/**
 * 输入框的裸文本。必须与数字 width/height 分开存：
 * 用户清空输入框的中间态是空串，若直接写进数字 ref 会变成 0，
 * 导致 ratio 出现 0 或 Infinity，预览框宽高塌成 0/NaN。
 */
const widthText = ref(String(width.value))
const heightText = ref(String(height.value))

function clamp(value: number) {
  if (!Number.isFinite(value)) return MIN
  return Math.min(Math.max(Math.round(value), MIN), MAX)
}

/** 预览框按比例缩放，长边固定 420rpx */
const previewStyle = computed(() => {
  const long = 420
  const ratio = width.value / height.value
  if (!Number.isFinite(ratio) || ratio <= 0) return `width:${long}rpx;height:${long}rpx`
  const w = ratio >= 1 ? long : long * ratio
  const h = ratio >= 1 ? long / ratio : long
  return `width:${Math.round(w)}rpx;height:${Math.round(h)}rpx`
})

const sizeText = computed(() => `${width.value} × ${height.value} px`)

/** 选中的推荐尺寸由当前宽高反查，手输命中时也能回选 */
const activeSize = computed(
  () => canvasSizes.find((item) => item.width === width.value && item.height === height.value)?.key || '',
)

function onWidthInput(e: Event) {
  widthText.value = inputValue(e)
  const next = Number(widthText.value)
  if (Number.isFinite(next) && next > 0) width.value = next
}

function onHeightInput(e: Event) {
  heightText.value = inputValue(e)
  const next = Number(heightText.value)
  if (Number.isFinite(next) && next > 0) height.value = next
}

/** 失焦时才 clamp 到合法区间，并把文本回写成规范值 */
function onBlurSize() {
  width.value = clamp(width.value)
  height.value = clamp(height.value)
  widthText.value = String(width.value)
  heightText.value = String(height.value)
}

function pickSize(key: string) {
  const size = canvasSizes.find((item) => item.key === key)
  if (!size) return
  width.value = size.width
  height.value = size.height
  widthText.value = String(size.width)
  heightText.value = String(size.height)
}

function close() {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: '/pages/home/home' })
}

function create() {
  onBlurSize()
  // TODO(design)：画布编辑器原型未给出，先提示
  uni.showToast({ title: `画布 ${sizeText.value} 创建中`, icon: 'none' })
}

function importImage() {
  uni.chooseImage({
    count: 1,
    success: () => uni.showToast({ title: '图片编辑开发中', icon: 'none' }),
  })
}
</script>

<template>
  <view class="cc">
    <nav-bar title="创建空白画布" close :transparent="false" bg-color="#ffffff" @back="close">
      <template #right>
        <view @tap="importImage">
          <ui-icon name="image" :size="38" color="#333333" />
        </view>
      </template>
    </nav-bar>

    <tab-underline v-model="activeTab" :items="tabs" :scroll="false" class="cc__tabs" />

    <scroll-view class="cc__body" scroll-y :show-scrollbar="false">
      <!-- 画布预览 -->
      <view class="cc__preview-wrap">
        <view class="cc__preview" :style="previewStyle" />
        <text class="cc__size">{{ sizeText }}</text>
      </view>

      <!-- 自定义尺寸 -->
      <view class="cc__custom">
        <text class="cc__label">自定义尺寸</text>
        <view class="cc__inputs">
          <view class="cc__input-box">
            <text class="cc__input-tag">宽</text>
            <input
              class="cc__input"
              type="number"
              :value="widthText"
              @input="onWidthInput"
              @blur="onBlurSize"
            />
          </view>
          <text class="cc__times">×</text>
          <view class="cc__input-box">
            <text class="cc__input-tag">高</text>
            <input
              class="cc__input"
              type="number"
              :value="heightText"
              @input="onHeightInput"
              @blur="onBlurSize"
            />
          </view>
          <view class="cc__unit">
            <text class="cc__unit-text">px</text>
            <ui-icon name="arrow-down" :size="22" color="#666666" />
          </view>
        </view>
        <text class="cc__hint">支持 {{ MIN }} - {{ MAX }} px</text>
      </view>

      <!-- 推荐尺寸 -->
      <view class="cc__recommend">
        <text class="cc__label">推荐尺寸</text>
        <view
          v-for="item in canvasSizes"
          :key="item.key"
          class="cc__size-row"
          :class="{ 'cc__size-row--on': activeSize === item.key }"
          @tap="pickSize(item.key)"
        >
          <view class="cc__size-info">
            <text class="cc__size-name">{{ item.name }}({{ item.ratio }})</text>
            <text class="cc__size-value">{{ item.width }}×{{ item.height }}px</text>
          </view>
          <view class="cc__radio" :class="{ 'cc__radio--on': activeSize === item.key }">
            <ui-icon v-if="activeSize === item.key" name="check" :size="18" color="#ffffff" />
          </view>
        </view>
      </view>

      <view class="cc__safe" />
    </scroll-view>

    <view class="cc__foot">
      <view class="cc__cta" @tap="create">
        <text class="cc__cta-text">创建画布</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.cc {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: $bg-card;

  &__tabs {
    border-bottom: 1px solid $line;
  }

  &__body {
    flex: 1;
    min-height: 0;
  }

  &__preview-wrap {
    padding: 48rpx 0 32rpx;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  &__preview {
    border-radius: 12rpx;
    background: $bg-fill;
    border: 1px solid #e2e3ec;
    transition: width $dur-base $ease-base, height $dur-base $ease-base;
  }

  &__size {
    margin-top: 24rpx;
    font-size: $fs-aux;
    color: $ink-2;
  }

  &__custom {
    padding: 8rpx $gap-page 0;
  }

  &__label {
    display: block;
    margin-bottom: 20rpx;
    font-size: $fs-title;
    font-weight: 600;
    color: $ink;
  }

  &__inputs {
    display: flex;
    align-items: center;
    gap: 14rpx;
  }

  &__input-box {
    flex: 1;
    height: 88rpx;
    padding: 0 20rpx;
    border-radius: 20rpx;
    background: $bg-fill;
    display: flex;
    align-items: center;
    gap: 12rpx;
  }

  &__input-tag {
    font-size: $fs-aux;
    color: $ink-3;
  }

  &__input {
    flex: 1;
    font-size: $fs-body;
    color: $ink;
  }

  &__times {
    font-size: $fs-body;
    color: $ink-3;
  }

  &__unit {
    height: 88rpx;
    padding: 0 18rpx;
    border-radius: 20rpx;
    background: $bg-fill;
    display: flex;
    align-items: center;
    gap: 4rpx;
  }

  &__unit-text {
    font-size: $fs-aux;
    color: $ink-2;
  }

  &__hint {
    display: block;
    margin-top: 12rpx;
    font-size: $fs-mini;
    color: $ink-3;
  }

  &__recommend {
    padding: 40rpx $gap-page 0;
  }

  &__size-row {
    height: 116rpx;
    padding: 0 24rpx;
    margin-bottom: 16rpx;
    border-radius: 20rpx;
    background: $bg-fill;
    border: 2rpx solid transparent;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: all $dur-fast $ease-base;

    &--on {
      background: $brand-light;
      border-color: $brand;
    }
  }

  &__size-info {
    flex: 1;
    min-width: 0;
  }

  &__size-name {
    display: block;
    font-size: $fs-body;
    color: $ink;
  }

  &__size-value {
    display: block;
    margin-top: 6rpx;
    font-size: $fs-mini;
    color: $ink-3;
  }

  &__radio {
    width: 36rpx;
    height: 36rpx;
    border-radius: 50%;
    border: 1px solid #cccccc;
    display: flex;
    align-items: center;
    justify-content: center;

    &--on {
      background: $brand;
      border-color: $brand;
    }
  }

  &__safe {
    height: 40rpx;
  }

  &__foot {
    padding: 16rpx $gap-page calc(20rpx + env(safe-area-inset-bottom));
    border-top: 1px solid $line;
  }

  &__cta {
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
