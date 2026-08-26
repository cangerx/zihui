<template>
  <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center">
    <div class="bg-surface-0 rounded-xl shadow-2xl border border-surface-3 w-[640px] max-h-[85vh] flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="px-5 py-3 border-b border-surface-3 flex items-center justify-between flex-shrink-0">
        <div>
          <h3 class="text-sm font-medium text-text-primary">AI 证件照</h3>
          <p class="text-[11px] text-text-tertiary mt-0.5">选择规格与背景色，AI 会自动生成对应版式</p>
        </div>
        <button @click="cancel" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto p-5 space-y-5">
        <!-- 规格 -->
        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">规格尺寸</h4>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="s in styles"
              :key="s.id"
              @click="selectedStyleId = s.id"
              :class="[
                'p-2.5 rounded-lg border text-left transition-colors',
                selectedStyleId === s.id
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-surface-3 bg-surface-1 hover:bg-surface-2'
              ]"
            >
              <div class="flex items-center gap-2 mb-1">
                <div
                  class="border border-surface-3 flex-shrink-0 bg-white"
                  :style="getThumbStyle(s)"
                ></div>
                <span class="text-[11px] font-medium text-text-primary truncate">{{ s.label }}</span>
              </div>
              <div class="text-[10px] text-text-tertiary leading-snug">{{ s.mm }} · 比例 {{ s.ratio }}</div>
            </button>
          </div>
        </div>

        <!-- 背景色 -->
        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">背景色</h4>
          <div class="flex items-center gap-2 flex-wrap">
            <button
              v-for="c in bgPresets"
              :key="c.value"
              @click="selectedBg = c.value; customBgEnabled = false"
              :class="[
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors',
                !customBgEnabled && selectedBg === c.value
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700'
                  : 'border-surface-3 text-text-secondary hover:bg-surface-2'
              ]"
            >
              <span class="w-3 h-3 rounded border border-surface-3" :style="{ background: c.value }"></span>
              {{ c.label }}
            </button>
            <label
              :class="[
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors cursor-pointer',
                customBgEnabled
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700'
                  : 'border-surface-3 text-text-secondary hover:bg-surface-2'
              ]"
            >
              <input
                type="color"
                v-model="customBg"
                @input="customBgEnabled = true; selectedBg = customBg"
                class="w-3 h-3 p-0 border-none cursor-pointer"
              />
              自定义
            </label>
          </div>
          <p class="text-[10px] text-text-tertiary mt-1.5">不同用途要求的底色：白（通用）/ 蓝（学籍、求职、社保）/ 红（党政、护照通用版）</p>
        </div>

        <!-- 服装 -->
        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">服装</h4>
          <div class="flex items-center gap-2 flex-wrap mb-2">
            <button
              v-for="o in outfitPresets"
              :key="o.id"
              @click="selectedOutfitId = o.id; customOutfit = ''"
              :class="[
                'px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors',
                selectedOutfitId === o.id && !customOutfit
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700'
                  : 'border-surface-3 text-text-secondary hover:bg-surface-2'
              ]"
            >{{ o.label }}</button>
          </div>
          <PromptTextarea
            v-model="customOutfit"
            title="编辑证件照服装描述"
            :height="56"
            :max-length="IMAGE_PROMPT_MAX_LENGTH"
            placeholder="自定义服装描述（填写后将覆盖上方选项）"
            input-class="text-xs"
            @change="selectedOutfitId = ''"
          />
          <p class="text-[10px] text-text-tertiary mt-1.5">例如：纯色领带 + 深蓝西装、报考照指定的黑色西装等</p>
        </div>

        <!-- 提示 -->
        <div class="text-[10px] text-text-tertiary bg-surface-1 rounded-lg p-2.5 leading-relaxed">
          下一步：点「选择照片」按钮，挑选一张正脸照片即可。AI 会按所选规格与背景色重新生成，保留人物相貌。
        </div>
      </div>

      <!-- Footer -->
      <div class="px-5 py-3 border-t border-surface-3 flex items-center justify-between flex-shrink-0">
        <div class="text-[11px] text-text-tertiary truncate max-w-[60%]">
          已选：<span class="text-text-secondary font-medium">{{ currentStyle.label }}</span>
          <span class="text-text-tertiary"> · </span>
          <span class="inline-flex items-center gap-1">
            <span class="w-2.5 h-2.5 rounded border border-surface-3 align-middle" :style="{ background: selectedBg }"></span>
            <span class="text-text-secondary">{{ bgLabel }}</span>
          </span>
          <span class="text-text-tertiary"> · </span>
          <span class="text-text-secondary">{{ outfitText || '保留原图服装' }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <button @click="cancel" class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors">取消</button>
          <button @click="confirm" class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors">选择照片</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  ID_PHOTO_STYLES,
  ID_PHOTO_BG_PRESETS,
  ID_PHOTO_OUTFIT_PRESETS,
  type IDPhotoStyle
} from '@shared/id-photo-styles'
import PromptTextarea from './PromptTextarea.vue'
import { IMAGE_PROMPT_MAX_LENGTH } from '@shared/prompt-limits'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'confirm', payload: { style: IDPhotoStyle; bgColor: string; bgLabel: string; outfit: string }): void
}>()

const styles = ID_PHOTO_STYLES
const bgPresets = ID_PHOTO_BG_PRESETS
const outfitPresets = ID_PHOTO_OUTFIT_PRESETS

const selectedStyleId = ref(styles[0].id)
const selectedBg = ref(bgPresets[0].value)
const customBg = ref('#000000')
const customBgEnabled = ref(false)
// 服装：默认第一项预设；customOutfit 非空时优先生效
const selectedOutfitId = ref(outfitPresets[0].id)
const customOutfit = ref('')

const currentStyle = computed(() => styles.find(s => s.id === selectedStyleId.value)!)
const bgLabel = computed(() => {
  if (customBgEnabled.value) return '自定义'
  return bgPresets.find(c => c.value === selectedBg.value)?.label ?? '自定义'
})
const outfitText = computed(() => {
  const c = customOutfit.value.trim()
  if (c) return c
  return outfitPresets.find(o => o.id === selectedOutfitId.value)?.label ?? ''
})

/** 缩略图尺寸：按 ratio 等比例缩到 24px 范围 */
function getThumbStyle(s: IDPhotoStyle): Record<string, string> {
  const [aStr, bStr] = s.ratio.split(':')
  const a = Number(aStr), b = Number(bStr)
  const maxSize = 22
  const w = a >= b ? maxSize : Math.round(maxSize * a / b)
  const h = b >= a ? maxSize : Math.round(maxSize * b / a)
  return { width: `${w}px`, height: `${h}px` }
}

function cancel() {
  emit('update:visible', false)
}
function confirm() {
  emit('confirm', {
    style: currentStyle.value,
    bgColor: selectedBg.value,
    bgLabel: bgLabel.value,
    outfit: outfitText.value
  })
  emit('update:visible', false)
}
</script>
