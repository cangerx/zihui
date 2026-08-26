<template>
  <div class="image-params-card rounded-2xl rounded-bl-md border border-surface-3 bg-surface-0 shadow-card px-4 py-3">
    <div class="text-sm text-text-primary font-medium mb-2.5">{{ card.question || '请确认生图参数' }}</div>

    <div v-if="promptText" class="text-[11px] text-text-tertiary mb-3 line-clamp-2 leading-snug">{{ promptText }}</div>

    <div class="mb-3">
      <div class="text-[11px] text-text-tertiary mb-1.5">尺寸比例</div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="p in sizePresets"
          :key="p.value"
          type="button"
          :disabled="!isInteractive"
          @click="size = p.value"
          :class="[chipBase, size === p.value ? chipActive : chipIdle]"
        >{{ p.label }}</button>
      </div>
    </div>

    <div v-if="tiers.length > 1" class="mb-3">
      <div class="text-[11px] text-text-tertiary mb-1.5">分辨率</div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="t in tiers"
          :key="t.id"
          type="button"
          :disabled="!isInteractive"
          @click="tierId = t.id"
          :class="[chipBase, tierId === t.id ? chipActive : chipIdle]"
        >{{ t.label }}<span v-if="t.note" class="opacity-60 ml-0.5">{{ t.note }}</span></button>
      </div>
    </div>

    <div v-if="qualities.length" class="mb-3">
      <div class="text-[11px] text-text-tertiary mb-1.5">画质</div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="q in qualities"
          :key="q.id"
          type="button"
          :disabled="!isInteractive"
          @click="quality = q.id"
          :class="[chipBase, quality === q.id ? chipActive : chipIdle]"
        >{{ q.label }}</button>
      </div>
    </div>

    <div class="mb-1">
      <div class="text-[11px] text-text-tertiary mb-1.5">数量</div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="n in countOptions"
          :key="n"
          type="button"
          :disabled="!isInteractive"
          @click="batchCount = n"
          :class="[chipBase, batchCount === n ? chipActive : chipIdle]"
        >{{ n }} 张</button>
      </div>
    </div>

    <div class="mt-2.5 flex items-center justify-between">
      <div class="text-[11px] text-text-tertiary">
        <span v-if="card.status === 'answered'">已确认 · {{ summary }}</span>
        <span v-else-if="card.status === 'canceled'">已取消</span>
        <span v-else-if="card.status === 'expired'">已超时</span>
      </div>
      <button
        v-if="isInteractive"
        type="button"
        @click="submit"
        class="px-3.5 py-1.5 text-xs rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
      >开始生成</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { MessageCard } from '@/stores/chat'
import {
  IMAGE_SIZE_PRESETS,
  getAvailableResolutionTiers,
  getModelCapability,
  ensureValidTierIdForSize,
  ensureValidQuality
} from '@shared/image-size'

const props = defineProps<{ card: MessageCard }>()
const emit = defineEmits<{ (e: 'submit', payload: { result: Record<string, any> }): void }>()

const d = props.card.defaults || {}
const modelId = String(d.model_id || '')
const promptText = String(d.prompt || '')

const submitted = ref(false)
const size = ref<string>(String(d.size || '1:1'))
const tierId = ref<string>(String(d.tierId || '2k'))
const quality = ref<string>(String(d.quality || 'auto'))
const batchCount = ref<number>(Number(d.batchCount) || 1)

// 留痕态用已确认 result 回填，保证刷新/重开后显示用户当时的选择
if (props.card.result) {
  const r = props.card.result
  if (r.size) size.value = String(r.size)
  if (r.tierId) tierId.value = String(r.tierId)
  if (r.quality) quality.value = String(r.quality)
  if (r.batchCount) batchCount.value = Number(r.batchCount)
}

const isInteractive = computed(() => props.card.status === 'pending' && !submitted.value)
const sizePresets = IMAGE_SIZE_PRESETS
const tiers = computed(() => getAvailableResolutionTiers(modelId, size.value))
const qualities = computed(() => getModelCapability(modelId).qualities || [])
const countOptions = [1, 2, 4]
const summary = computed(() => `${size.value} · ${String(tierId.value).toUpperCase()} · ${batchCount.value}张`)

// 极端比例（如 21:9）会把可选档位收窄到仅 4K：切换尺寸后把 tierId 收敛到合法值，
// 避免「界面显示 2K、实际提交 4K」的不一致。
watch(size, () => {
  tierId.value = ensureValidTierIdForSize(modelId, tierId.value, size.value)
})

const chipBase = 'px-2.5 py-1 rounded-md border text-xs transition-colors disabled:cursor-default'
const chipActive = 'border-primary-500 bg-primary-50 text-primary-700'
const chipIdle = 'border-surface-3 text-text-secondary hover:bg-surface-2'

function submit(): void {
  if (!isInteractive.value) return
  // 档位/画质随 size + model 合法化，避免越界传给上游
  const validTier = ensureValidTierIdForSize(modelId, tierId.value, size.value)
  const validQuality = ensureValidQuality(modelId, quality.value)
  submitted.value = true
  emit('submit', {
    result: {
      size: size.value,
      tierId: validTier,
      quality: validQuality,
      batchCount: Math.min(Math.max(batchCount.value, 1), 10)
    }
  })
}
</script>
