<script setup lang="ts">
/**
 * schema 字段渲染器：按 AppSchemaField.type 分发到具体控件
 * 类型映射见 docs/API开发文档.md §3.2.2
 */
import { computed } from 'vue'
import type { AppSchemaField } from '@/api/types'

const props = defineProps<{
  field: AppSchemaField
  modelValue: unknown
  /** AI 帮写进行中 */
  optimizing?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: unknown]
  optimize: []
}>()

const text = computed(() => (typeof props.modelValue === 'string' ? props.modelValue : ''))
const list = computed(() => (Array.isArray(props.modelValue) ? (props.modelValue as string[]) : []))
const num = computed(() => Number(props.modelValue) || 0)

function step(delta: number) {
  const min = props.field.min ?? 1
  const max = props.field.max ?? 99
  emit('update:modelValue', Math.min(Math.max(num.value + delta, min), max))
}

const pickerIndex = computed(() => {
  const index = props.field.options?.findIndex((o) => o.value === text.value) ?? -1
  return index < 0 ? 0 : index
})

const pickerLabel = computed(
  () => props.field.options?.find((o) => o.value === text.value)?.label || '请选择',
)

function onPicker(e: { detail: { value: string | number } }) {
  const option = props.field.options?.[Number(e.detail.value)]
  if (option) emit('update:modelValue', option.value)
}
</script>

<template>
  <view class="sf">
    <view class="sf__head">
      <text class="sf__label">{{ field.label }}</text>
      <text v-if="field.required" class="sf__required">*</text>
    </view>

    <field-image
      v-if="field.type === 'image'"
      :model-value="list"
      :max-count="field.maxCount || 1"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <field-textarea
      v-else-if="field.type === 'textarea'"
      :model-value="text"
      :placeholder="field.placeholder || `请输入${field.label}`"
      :rows="field.rows || 3"
      :maxlength="field.maxlength || 300"
      :optimize="field.optimize"
      :optimizing="optimizing"
      @update:model-value="emit('update:modelValue', $event)"
      @optimize="emit('optimize')"
    />

    <view v-else-if="field.type === 'number'" class="sf__stepper">
      <view class="sf__step" @tap="step(-1)">
        <text class="sf__step-text">-</text>
      </view>
      <text class="sf__step-value">{{ num }}</text>
      <view class="sf__step" @tap="step(1)">
        <text class="sf__step-text">+</text>
      </view>
    </view>

    <picker
      v-else-if="field.type === 'select'"
      :range="(field.options || []).map((o) => o.label)"
      :value="pickerIndex"
      @change="onPicker"
    >
      <view class="sf__picker">
        <text class="sf__picker-text">{{ pickerLabel }}</text>
        <ui-icon name="arrow-down" :size="26" color="#999999" />
      </view>
    </picker>

    <option-card
      v-else-if="field.type === 'card-select'"
      :options="field.options || []"
      :model-value="text"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <option-card
      v-else-if="field.type === 'card-multi-select'"
      :options="field.options || []"
      :model-value="list"
      multiple
      show-preview
      @update:model-value="emit('update:modelValue', $event)"
    />

    <!-- 兜底：未知类型不能只渲染一个孤立 label，否则页面上是块空白 -->
    <view v-else class="sf__unsupported">
      <text class="sf__unsupported-text">该字段类型暂不支持（{{ field.type }}）</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.sf {
  margin-top: 36rpx;

  &__head {
    display: flex;
    align-items: center;
    gap: 6rpx;
    margin-bottom: 18rpx;
  }

  &__label {
    font-size: $fs-title;
    font-weight: 600;
    color: $ink;
  }

  &__required {
    font-size: $fs-body;
    color: $danger;
  }

  &__stepper {
    display: flex;
    align-items: center;
    gap: 24rpx;
  }

  &__step {
    width: 72rpx;
    height: 72rpx;
    border-radius: 20rpx;
    background: $bg-fill;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__step-text {
    font-size: 36rpx;
    color: $ink;
  }

  &__step-value {
    min-width: 60rpx;
    text-align: center;
    font-size: $fs-title;
    color: $ink;
  }

  &__picker {
    height: 88rpx;
    padding: 0 24rpx;
    border-radius: 20rpx;
    background: $bg-fill;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__picker-text {
    font-size: $fs-body;
    color: $ink;
  }

  &__unsupported {
    height: 88rpx;
    padding: 0 24rpx;
    border-radius: 20rpx;
    background: $bg-fill;
    display: flex;
    align-items: center;
  }

  &__unsupported-text {
    font-size: $fs-aux;
    color: $ink-3;
  }
}
</style>
