<template>
  <div v-if="options.length" class="inline-flex items-center gap-1.5" role="radiogroup" aria-label="画质">
    <button
      v-for="opt in options"
      :key="opt.id"
      type="button"
      role="radio"
      :aria-checked="opt.id === modelValue"
      :disabled="disabled"
      :class="buttonClass(opt.id === modelValue)"
      :title="opt.note ? `${opt.label}（${opt.note}）` : opt.label"
      @click="onPick(opt.id)"
    >
      <span class="font-medium leading-none">{{ opt.label }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { getModelCapability, ensureValidQuality } from '@shared/image-size'

interface Props {
  /** 当前选中的画质 id（auto/low/medium/high 等） */
  modelValue: string
  /** 模型 id，决定可选画质列表 */
  modelId?: string
  disabled?: boolean
  /** 按钮尺寸：sm = 节点内紧凑，md = 生图页标准 */
  size?: 'sm' | 'md'
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  size: 'md'
})

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
}>()

const options = computed(() => getModelCapability(props.modelId).qualities ?? [])

/**
 * 模型切换后当前 quality 可能不再合法（如从 gpt-image-2 切到未注册模型），
 * 自动降级到 DEFAULT_QUALITY_ID（'auto'）或首档。
 */
watch(
  () => [props.modelId, props.modelValue] as const,
  ([modelId, current]) => {
    const valid = ensureValidQuality(modelId, current)
    if (valid !== current) emit('update:modelValue', valid)
  },
  { immediate: true }
)

function onPick(id: string): void {
  if (props.disabled || id === props.modelValue) return
  emit('update:modelValue', id)
}

function buttonClass(active: boolean): string[] {
  const base = [
    'rounded-lg',
    'border',
    'transition-colors',
    'inline-flex',
    'items-center',
    'justify-center',
    'disabled:opacity-40',
    'disabled:cursor-not-allowed'
  ]
  if (props.size === 'sm') {
    base.push('px-2', 'py-1', 'text-[10px]', 'min-w-[40px]')
  } else {
    base.push('px-3', 'py-1.5', 'text-xs', 'min-w-[48px]')
  }
  if (active) {
    base.push('border-primary-500', 'bg-primary-50', 'text-primary-700', 'font-medium')
  } else {
    base.push('border-surface-3', 'bg-surface-1', 'text-text-secondary', 'hover:bg-surface-2')
  }
  return base
}
</script>
