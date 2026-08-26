<script setup lang="ts">
/**
 * AI 输入卡片（首页核心组件）
 * 渐变描边 + 已选图缩略图 + 底部操作排（添加图片/素材库/模板 · 麦克风 · 发送）
 * 动效：聚焦时描边加亮、图片缩略图入场（动效清单 #3 #4）
 */
import { computed, ref } from 'vue'
import { inputValue } from '@/utils/event'

const props = withDefaults(
  defineProps<{
    modelValue: string
    /** 已选图片本地/远端路径 */
    images?: string[]
    placeholder?: string
    /** 是否显示收起按钮 */
    collapsible?: boolean
    maxImages?: number
    imagesEnabled?: boolean
  }>(),
  { images: () => [], placeholder: '输入一句话让我帮你设计', collapsible: false, maxImages: 9, imagesEnabled: true },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:images': [images: string[]]
  send: []
  collapse: []
  material: []
  template: []
  voice: []
  focus: []
  blur: []
}>()

const focused = ref(false)
const canSend = computed(() => props.modelValue.trim().length > 0 || props.images.length > 0)

function onInput(e: Event) {
  emit('update:modelValue', inputValue(e))
}

function pickImage() {
  const remain = props.maxImages - props.images.length
  if (remain <= 0) {
    uni.showToast({ title: `最多选择 ${props.maxImages} 张`, icon: 'none' })
    return
  }
  uni.chooseImage({
    count: remain,
    sizeType: ['compressed'],
    success: (res) => {
      const paths = (res.tempFilePaths as string[]) || []
      emit('update:images', [...props.images, ...paths])
    },
  })
}

function removeImage(index: number) {
  const next = props.images.slice()
  next.splice(index, 1)
  emit('update:images', next)
}

function onFocus() {
  focused.value = true
  emit('focus')
}

function onBlur() {
  focused.value = false
  emit('blur')
}
</script>

<template>
  <view class="aic" :class="{ 'aic--focus': focused }">
    <view class="aic__inner">
      <view class="aic__head">
        <view class="aic__badge">
          <view class="aic__dot" />
          <text class="aic__badge-text">AI团队</text>
        </view>
        <view v-if="collapsible" class="aic__collapse" @tap="emit('collapse')">
          <text class="aic__collapse-text">收起</text>
          <ui-icon name="arrow-up" :size="26" color="#999999" />
        </view>
      </view>

      <view v-if="images.length" class="aic__thumbs">
        <view v-for="(img, i) in images" :key="`${img}-${i}`" class="aic__thumb">
          <image class="aic__thumb-img" :src="img" mode="aspectFill" />
          <view class="aic__thumb-del" @tap.stop="removeImage(i)">
            <ui-icon name="close" :size="20" color="#ffffff" />
          </view>
        </view>
      </view>

      <textarea
        class="aic__input"
        :value="modelValue"
        :placeholder="placeholder"
        placeholder-class="aic__ph"
        :auto-height="true"
        :maxlength="500"
        :show-confirm-bar="false"
        :adjust-position="true"
        :cursor-spacing="24"
        @input="onInput"
        @focus="onFocus"
        @blur="onBlur"
      />

      <view class="aic__foot">
        <view class="aic__actions">
          <!-- 原型：添加图片为描边胶囊，素材库/模板为纯文字 -->
          <view v-if="imagesEnabled" class="aic__action aic__action--outline" @tap="pickImage">
            <ui-icon name="plus" :size="24" color="#16161a" />
            <text class="aic__action-text">添加图片</text>
          </view>
          <text v-if="imagesEnabled" class="aic__plain" @tap="emit('material')">素材库</text>
          <text class="aic__plain" @tap="emit('template')">模板</text>
        </view>
        <view class="aic__right">
          <view class="aic__mic" @tap="emit('voice')">
            <ui-icon name="mic" :size="34" color="#333333" />
          </view>
          <view class="aic__send" :class="{ 'aic__send--on': canSend }" @tap="canSend && emit('send')">
            <ui-icon name="arrow-up" :size="32" :color="canSend ? '#ffffff' : '#bbbbbb'" />
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.aic {
  /* 渐变描边：外层渐变背景 + 内层白底，1px padding 形成描边 */
  padding: 2rpx;
  border-radius: $radius-lg;
  background: linear-gradient(120deg, $grad-ai-from, $grad-ai-to);
  box-shadow: 0 12rpx 40rpx rgba(90, 90, 160, 0.1);
  transition: box-shadow $dur-base $ease-base;

  &--focus {
    box-shadow: 0 12rpx 48rpx rgba(74, 157, 248, 0.28);
  }

  &__inner {
    border-radius: 34rpx;
    background: #ffffff;
    padding: 24rpx 26rpx 18rpx;
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__badge {
    display: flex;
    align-items: center;
    gap: 10rpx;
  }

  &__dot {
    width: 16rpx;
    height: 16rpx;
    border-radius: 50%;
    background: linear-gradient(135deg, $grad-ai-from, $grad-ai-to);
  }

  &__badge-text {
    font-size: $fs-aux;
    color: $ink;
    font-weight: 600;
  }

  &__collapse {
    display: flex;
    align-items: center;
    gap: 6rpx;
  }

  &__collapse-text {
    font-size: $fs-aux;
    color: $ink-3;
  }

  /* 原型状态 B 实测：三张 228×226px ≈ 136×135rpx，间距 29px ≈ 17rpx，左对齐不铺满 */
  &__thumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 17rpx;
    margin-top: 18rpx;
  }

  &__thumb {
    position: relative;
    width: 136rpx;
    height: 135rpx;
    border-radius: $radius-thumb;
    overflow: visible;
    animation: aic-thumb-in $dur-base $ease-base;
  }

  &__thumb-img {
    width: 100%;
    height: 100%;
    border-radius: $radius-thumb;
  }

  &__thumb-del {
    position: absolute;
    top: -8rpx;
    right: -8rpx;
    width: 32rpx;
    height: 32rpx;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__input {
    width: 100%;
    min-height: 76rpx;
    max-height: 260rpx;
    margin-top: 12rpx;
    font-size: $fs-body;
    line-height: 1.5;
    color: $ink;
  }

  &__ph {
    color: $ink-3;
  }

  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8rpx;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 12rpx;
  }

  &__action {
    height: 56rpx;
    padding: 0 20rpx;
    border-radius: 28rpx;
    display: flex;
    align-items: center;
    gap: 6rpx;

    &--outline {
      border: 1px solid #e2e2ea;
    }
  }

  &__action-text {
    font-size: $fs-aux;
    color: $ink;
  }

  &__plain {
    font-size: $fs-aux;
    color: $ink-2;
    padding: 0 6rpx;
  }

  &__right {
    display: flex;
    align-items: center;
    gap: 16rpx;
  }

  &__mic {
    width: 56rpx;
    height: 56rpx;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__send {
    width: 64rpx;
    height: 64rpx;
    border-radius: 50%;
    background: #f0f0f4;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background $dur-fast $ease-base;

    &--on {
      background: $ink;
    }
  }
}

@keyframes aic-thumb-in {
  from {
    opacity: 0;
    transform: scale(0.86);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
