<template>
  <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center">
    <div class="bg-surface-0 rounded-xl shadow-2xl border border-surface-3 w-[680px] max-h-[88vh] flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="px-5 py-3 border-b border-surface-3 flex items-center justify-between flex-shrink-0">
        <div>
          <h3 class="text-sm font-medium text-text-primary">AI 换装</h3>
          <p class="text-[11px] text-text-tertiary mt-0.5">选择服装来源与风格，AI 会保留人物姿势与背景，仅替换服装</p>
        </div>
        <button @click="cancel" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto p-5 space-y-5">
        <!-- Tab: 服装来源 -->
        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">服装来源</h4>
          <div class="inline-flex border border-surface-3 rounded-lg p-0.5 bg-surface-1">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              @click="source = tab.id"
              :class="[
                'px-3 py-1.5 rounded-md text-xs transition-colors',
                source === tab.id
                  ? 'bg-surface-0 shadow-sm text-text-primary font-medium'
                  : 'text-text-tertiary hover:text-text-secondary'
              ]"
            >{{ tab.label }}</button>
          </div>
        </div>

        <!-- 预设网格 -->
        <div v-if="source === 'preset'">
          <div v-for="cat in OUTFIT_CATEGORIES" :key="cat.id" class="mb-4 last:mb-0">
            <div class="text-[11px] font-medium text-text-tertiary mb-1.5">{{ cat.label }}</div>
            <div class="grid grid-cols-5 gap-2">
              <button
                v-for="p in presetsByCategory(cat.id)"
                :key="p.id"
                @click="selectedPresetId = p.id"
                :class="[
                  'px-2 py-1.5 rounded-lg border text-[11px] transition-colors',
                  selectedPresetId === p.id
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700'
                    : 'border-surface-3 text-text-secondary hover:bg-surface-2'
                ]"
              >{{ p.label }}</button>
            </div>
          </div>
        </div>

        <!-- 文字描述 -->
        <div v-else-if="source === 'text'">
          <h4 class="text-xs font-medium text-text-secondary mb-2">描述服装</h4>
          <PromptTextarea
            v-model="customText"
            title="编辑服装描述"
            :height="88"
            :max-length="IMAGE_PROMPT_MAX_LENGTH"
            placeholder="例如：复古色调的米色风衣搭配棕色皮带；或者：白色泡泡袖连衣裙，收腰，过膝"
            input-class="text-xs"
          />
          <p class="text-[10px] text-text-tertiary mt-1.5">中英文均可。越具体（款式 / 材质 / 细节）效果越好。</p>
        </div>

        <!-- 参考服装图 -->
        <div v-else>
          <h4 class="text-xs font-medium text-text-secondary mb-2">服装参考图</h4>
          <div v-if="!outfitRefDataUri" class="flex items-center gap-3">
            <button
              @click="pickerVisible = true"
              class="flex items-center justify-center w-32 h-32 rounded-lg border-2 border-dashed border-surface-3 hover:border-primary-400 hover:bg-primary-50/40 dark:hover:bg-primary-900/10 text-text-tertiary hover:text-primary-600 transition-colors"
            >
              <div class="flex flex-col items-center gap-1.5">
                <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <span class="text-[11px]">上传服装图</span>
              </div>
            </button>
            <p class="text-[10px] text-text-tertiary leading-relaxed flex-1">
              挑一张想要的服装样图，<br />可以是平铺图 / 模特上身图。<br />AI 会参照款式、颜色与材质。
            </p>
          </div>
          <div v-else class="flex items-start gap-3">
            <div class="relative w-32 h-32 rounded-lg overflow-hidden border border-surface-3 group flex-shrink-0">
              <img :src="outfitRefDataUri" class="w-full h-full object-cover" />
              <button
                @click="outfitRefDataUri = ''"
                class="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 hover:bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title="移除"
              >
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="flex flex-col gap-1.5 pt-1">
              <button @click="pickerVisible = true" class="text-[11px] text-primary-600 hover:underline text-left">更换图片</button>
              <p class="text-[10px] text-text-tertiary leading-relaxed">已上传服装参考图。AI 会参照其款式、颜色与材质，将其穿到下一步选的人物身上。</p>
            </div>
          </div>
        </div>

        <!-- 颜色：仅预设 / 文字 tab 有意义 -->
        <div v-if="source !== 'ref-image'">
          <h4 class="text-xs font-medium text-text-secondary mb-2">
            颜色 <span class="text-text-tertiary font-normal">（可选）</span>
          </h4>
          <div class="flex items-center gap-2 flex-wrap">
            <button
              @click="resetColor"
              :class="[
                'px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors',
                !customColorEnabled && selectedColorIdx === -1
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700'
                  : 'border-surface-3 text-text-secondary hover:bg-surface-2'
              ]"
            >不指定</button>
            <button
              v-for="(c, idx) in OUTFIT_COLOR_PRESETS"
              :key="c.label"
              @click="selectColorPreset(idx)"
              :class="[
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors',
                !customColorEnabled && selectedColorIdx === idx
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
                customColorEnabled
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700'
                  : 'border-surface-3 text-text-secondary hover:bg-surface-2'
              ]"
            >
              <input
                type="color"
                v-model="customColor"
                @input="customColorEnabled = true; selectedColorIdx = -1"
                class="w-3 h-3 p-0 border-none cursor-pointer"
              />
              自定义
            </label>
          </div>
        </div>

        <!-- 风格：仅预设 / 文字 tab -->
        <div v-if="source !== 'ref-image'">
          <h4 class="text-xs font-medium text-text-secondary mb-2">
            风格 <span class="text-text-tertiary font-normal">（可多选）</span>
          </h4>
          <div class="flex items-center gap-1.5 flex-wrap">
            <button
              v-for="s in OUTFIT_STYLE_KEYWORDS"
              :key="s"
              @click="toggleStyle(s)"
              :class="[
                'px-2.5 py-1 rounded-lg border text-[11px] transition-colors',
                stylesSet.has(s)
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700'
                  : 'border-surface-3 text-text-secondary hover:bg-surface-2'
              ]"
            >{{ s }}</button>
          </div>
        </div>

        <!-- 高级折叠：保留项 -->
        <div>
          <button
            @click="advancedOpen = !advancedOpen"
            class="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <svg
              class="w-3 h-3 transition-transform"
              :class="advancedOpen ? 'rotate-90' : ''"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
            高级（保留项）
          </button>
          <div v-if="advancedOpen" class="mt-2 p-3 bg-surface-1 rounded-lg">
            <p class="text-[10px] text-text-tertiary mb-2">默认全开。关闭某项会让 AI 在该项上有更多自由度（如关闭"姿势"允许 AI 调整人物身体角度以适配新服装）。</p>
            <div class="flex items-center gap-1.5 flex-wrap">
              <button
                v-for="item in preserveItems"
                :key="item.key"
                @click="preserve[item.key] = !preserve[item.key]"
                :class="[
                  'px-2.5 py-1 rounded-lg border text-[11px] transition-colors',
                  preserve[item.key]
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700'
                    : 'border-surface-3 text-text-tertiary hover:bg-surface-2'
                ]"
              >保留{{ item.label }}</button>
            </div>
          </div>
        </div>

        <!-- 流程提示 -->
        <div class="text-[10px] text-text-tertiary bg-surface-1 rounded-lg p-2.5 leading-relaxed">
          下一步：点「选择照片」按钮，挑一张人物正面或半身照。AI 会保留人物的脸、姿势与背景，仅替换服装。
        </div>
      </div>

      <!-- Footer -->
      <div class="px-5 py-3 border-t border-surface-3 flex items-center justify-between flex-shrink-0">
        <div class="text-[11px] text-text-tertiary truncate max-w-[60%]">
          已选：<span class="text-text-secondary font-medium">{{ summaryText || '请先选择服装' }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <button @click="cancel" class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors">取消</button>
          <button
            @click="confirm"
            :disabled="!canConfirm"
            class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 disabled:bg-surface-3 disabled:cursor-not-allowed rounded-lg transition-colors"
          >选择照片</button>
        </div>
      </div>
    </div>

    <!-- 内嵌：服装参考图选择器（只在 ref-image tab 用） -->
    <ImageSourcePickerDialog
      v-model:visible="pickerVisible"
      title="选择服装参考图"
      hint="挑一张服装图，可以是平铺图或模特上身图"
      :multiple="false"
      @select="onOutfitRefSelected"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import {
  OUTFIT_CATEGORIES,
  OUTFIT_PRESETS,
  OUTFIT_COLOR_PRESETS,
  OUTFIT_STYLE_KEYWORDS,
  DEFAULT_PRESERVE_OPTIONS,
  type OutfitSource,
  type OutfitCategoryId,
  type OutfitPreserveOptions
} from '@shared/outfit-change-presets'
import ImageSourcePickerDialog from './ImageSourcePickerDialog.vue'
import { loadAsDataUri } from '@/utils/image-source'
import PromptTextarea from './PromptTextarea.vue'
import { IMAGE_PROMPT_MAX_LENGTH } from '@shared/prompt-limits'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'confirm', payload: {
    /** 服装文字描述：预设的 label / 用户自定义；ref-image 模式下为空 */
    outfitText: string
    /** 颜色中文名（可空） */
    colorLabel?: string
    /** 颜色 hex（与 colorLabel 配套） */
    colorHex?: string
    /** 风格关键词 */
    styles: string[]
    /** 服装参考图 dataUri（可空） */
    outfitRefDataUri?: string
    /** 保留项开关 */
    preserve: OutfitPreserveOptions
    /** Footer 用的摘要文案，可直接拼进 toast / 标题 */
    summary: string
    /** 服装来源 tab，便于父组件后续合成 prompt */
    source: OutfitSource
  }): void
}>()

const tabs: Array<{ id: OutfitSource; label: string }> = [
  { id: 'preset', label: '预设服装' },
  { id: 'text', label: '文字描述' },
  { id: 'ref-image', label: '参考服装图' }
]

const source = ref<OutfitSource>('preset')
const selectedPresetId = ref(OUTFIT_PRESETS[0].id)
const customText = ref('')
const outfitRefDataUri = ref('')
const pickerVisible = ref(false)

// 颜色
const selectedColorIdx = ref(-1)
const customColor = ref('#888888')
const customColorEnabled = ref(false)

function resetColor() {
  selectedColorIdx.value = -1
  customColorEnabled.value = false
}
function selectColorPreset(idx: number) {
  selectedColorIdx.value = idx
  customColorEnabled.value = false
}

// 风格（多选）
const stylesSet = reactive(new Set<string>())
function toggleStyle(s: string) {
  if (stylesSet.has(s)) stylesSet.delete(s)
  else stylesSet.add(s)
}

// 高级 / 保留项
const advancedOpen = ref(false)
const preserve = reactive<OutfitPreserveOptions>({ ...DEFAULT_PRESERVE_OPTIONS })
const preserveItems: Array<{ key: keyof OutfitPreserveOptions; label: string }> = [
  { key: 'face', label: '脸 / 身份' },
  { key: 'hair', label: '发型' },
  { key: 'pose', label: '姿势' },
  { key: 'background', label: '背景 / 光线' },
  { key: 'accessories', label: '配饰' }
]

function presetsByCategory(catId: OutfitCategoryId) {
  return OUTFIT_PRESETS.filter(p => p.category === catId)
}

const outfitText = computed(() => {
  if (source.value === 'preset') {
    const p = OUTFIT_PRESETS.find(x => x.id === selectedPresetId.value)
    return p?.label || ''
  }
  if (source.value === 'text') return customText.value.trim()
  return ''
})

const currentColor = computed<{ label: string; hex: string } | null>(() => {
  if (customColorEnabled.value) return { label: '自定义', hex: customColor.value }
  if (selectedColorIdx.value < 0) return null
  const c = OUTFIT_COLOR_PRESETS[selectedColorIdx.value]
  return { label: c.label, hex: c.value }
})

const summaryText = computed(() => {
  if (source.value === 'ref-image') {
    return outfitRefDataUri.value ? '按服装参考图换装' : ''
  }
  const parts: string[] = []
  if (currentColor.value) parts.push(currentColor.value.label)
  if (outfitText.value) parts.push(outfitText.value)
  if (stylesSet.size > 0) parts.push('（' + Array.from(stylesSet).join('、') + '）')
  return parts.join(' ')
})

const canConfirm = computed(() => {
  if (source.value === 'preset') return !!selectedPresetId.value
  if (source.value === 'text') return customText.value.trim().length > 0
  return !!outfitRefDataUri.value
})

async function onOutfitRefSelected(paths: string[]) {
  if (paths.length === 0) return
  try {
    const items = await loadAsDataUri(paths.slice(0, 1), { maxSize: 1024, quality: 0.8 })
    if (items[0]) outfitRefDataUri.value = items[0].dataUri
  } catch (e) {
    console.error('[OutfitChangeDialog] failed to load outfit ref image', e)
  }
}

function cancel() {
  emit('update:visible', false)
}

function confirm() {
  if (!canConfirm.value) return
  emit('confirm', {
    outfitText: outfitText.value,
    colorLabel: currentColor.value?.label,
    colorHex: currentColor.value?.hex,
    styles: Array.from(stylesSet),
    outfitRefDataUri: outfitRefDataUri.value || undefined,
    preserve: { ...preserve },
    summary: summaryText.value,
    source: source.value
  })
  emit('update:visible', false)
}
</script>
