<template>
  <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center">
    <div class="bg-surface-0 rounded-xl shadow-2xl border border-surface-3 w-[680px] max-h-[88vh] flex flex-col overflow-hidden">
      <div class="px-5 py-3 border-b border-surface-3 flex items-center justify-between flex-shrink-0">
        <div>
          <h3 class="text-sm font-medium text-text-primary">风格迁移</h3>
          <p class="text-[11px] text-text-tertiary mt-0.5">上传风格图，再选择内容图，AI 会将第一张图的风格迁移到第二张图</p>
        </div>
        <button @click="cancel" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-5 space-y-5">
        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">风格参考图</h4>
          <div v-if="!styleRefDataUri" class="flex items-center gap-3">
            <button
              @click="pickerVisible = true"
              class="flex items-center justify-center w-32 h-32 rounded-lg border-2 border-dashed border-surface-3 hover:border-primary-400 hover:bg-primary-50/40 dark:hover:bg-primary-900/10 text-text-tertiary hover:text-primary-600 transition-colors"
            >
              <div class="flex flex-col items-center gap-1.5">
                <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <span class="text-[11px]">上传风格图</span>
              </div>
            </button>
            <p class="text-[10px] text-text-tertiary leading-relaxed flex-1">
              选择一张提供画风、色彩、材质、光影或质感的图片。下一步会选择需要保留内容结构的图片。
            </p>
          </div>
          <div v-else class="flex items-start gap-3">
            <div class="relative w-32 h-32 rounded-lg overflow-hidden border border-surface-3 group flex-shrink-0">
              <img :src="styleRefDataUri" class="w-full h-full object-cover" />
              <button
                @click="styleRefDataUri = ''"
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
              <p class="text-[10px] text-text-tertiary leading-relaxed">已上传风格参考图。AI 会参考这张图的色彩、光影、材质、笔触和整体氛围。</p>
            </div>
          </div>
        </div>

        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">
            图片类型 <span class="text-text-tertiary font-normal">（可选）</span>
          </h4>
          <div class="flex items-center gap-1.5 flex-wrap mb-2">
            <button
              @click="resetType"
              :class="[
                'px-2.5 py-1 rounded-lg border text-[11px] transition-colors',
                !selectedType && !customType.trim()
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700'
                  : 'border-surface-3 text-text-secondary hover:bg-surface-2'
              ]"
            >不指定</button>
            <button
              v-for="item in IMAGE_TYPE_PRESETS"
              :key="item.id"
              @click="selectType(item.label)"
              :class="[
                'px-2.5 py-1 rounded-lg border text-[11px] transition-colors',
                selectedType === item.label && !customType.trim()
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700'
                  : 'border-surface-3 text-text-secondary hover:bg-surface-2'
              ]"
            >{{ item.label }}</button>
          </div>
          <input
            v-model="customType"
            placeholder="也可以手动填写，例如：国潮包装图、儿童绘本、写实产品海报"
            class="w-full px-3 py-2 text-xs bg-surface-1 border border-surface-3 rounded-lg outline-none focus:ring-1 focus:ring-primary-500 text-text-primary placeholder:text-text-disabled"
          />
        </div>

        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">风格强度</h4>
          <div class="flex items-center gap-2 flex-wrap">
            <button
              v-for="item in STYLE_STRENGTH_OPTIONS"
              :key="item.id"
              @click="styleStrength = item.id"
              :class="[
                'px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors',
                styleStrength === item.id
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700'
                  : 'border-surface-3 text-text-secondary hover:bg-surface-2'
              ]"
            >{{ item.label }}</button>
          </div>
        </div>

        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">内容保持度</h4>
          <div class="flex items-center gap-2 flex-wrap">
            <button
              v-for="item in CONTENT_PRESERVE_OPTIONS"
              :key="item.id"
              @click="contentPreserve = item.id"
              :class="[
                'px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors',
                contentPreserve === item.id
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700'
                  : 'border-surface-3 text-text-secondary hover:bg-surface-2'
              ]"
            >{{ item.label }}</button>
          </div>
        </div>

        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">
            补充要求 <span class="text-text-tertiary font-normal">（可选）</span>
          </h4>
          <PromptTextarea
            v-model="extraPrompt"
            title="编辑风格迁移补充要求"
            :height="88"
            :max-length="IMAGE_PROMPT_MAX_LENGTH"
            placeholder="例如：保留背景构图、不要改变人物五官、画面更写实"
            input-class="text-xs"
          />
        </div>

        <div class="text-[10px] text-text-tertiary bg-surface-1 rounded-lg p-2.5 leading-relaxed">
          下一步：点「选择内容图」按钮，挑一张需要保留主体、构图和结构的图片。生图页会带入两张参考图：第一张为风格图，第二张为内容图。
        </div>
      </div>

      <div class="px-5 py-3 border-t border-surface-3 flex items-center justify-between flex-shrink-0">
        <div class="text-[11px] text-text-tertiary truncate max-w-[60%]">
          已选：<span class="text-text-secondary font-medium">{{ summaryText }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <button @click="cancel" class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors">取消</button>
          <button
            @click="confirm"
            :disabled="!canConfirm"
            class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 disabled:bg-surface-3 disabled:cursor-not-allowed rounded-lg transition-colors"
          >选择内容图</button>
        </div>
      </div>
    </div>

    <ImageSourcePickerDialog
      v-model:visible="pickerVisible"
      title="选择风格参考图"
      hint="挑一张提供画风、色彩、材质或光影氛围的图片"
      :multiple="false"
      @select="onStyleRefSelected"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  CONTENT_PRESERVE_OPTIONS,
  IMAGE_TYPE_PRESETS,
  STYLE_STRENGTH_OPTIONS,
  type ContentPreserveLevel,
  type StyleStrength
} from '@shared/style-transfer-presets'
import ImageSourcePickerDialog from './ImageSourcePickerDialog.vue'
import { loadAsDataUri } from '@/utils/image-source'
import PromptTextarea from './PromptTextarea.vue'
import { IMAGE_PROMPT_MAX_LENGTH } from '@shared/prompt-limits'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'confirm', payload: {
    styleRefDataUri: string
    imageType?: string
    styleStrength: StyleStrength
    contentPreserve: ContentPreserveLevel
    extraPrompt?: string
    summary: string
  }): void
}>()

const styleRefDataUri = ref('')
const pickerVisible = ref(false)
const selectedType = ref('')
const customType = ref('')
const styleStrength = ref<StyleStrength>('balanced')
const contentPreserve = ref<ContentPreserveLevel>('high')
const extraPrompt = ref('')

const imageType = computed(() => customType.value.trim() || selectedType.value)
const canConfirm = computed(() => !!styleRefDataUri.value)
const summaryText = computed(() => {
  const parts = [styleRefDataUri.value ? '已上传风格图' : '请先上传风格图']
  if (imageType.value) parts.push(imageType.value)
  const strengthLabel = STYLE_STRENGTH_OPTIONS.find(item => item.id === styleStrength.value)?.label
  const preserveLabel = CONTENT_PRESERVE_OPTIONS.find(item => item.id === contentPreserve.value)?.label
  if (strengthLabel) parts.push(`风格${strengthLabel}`)
  if (preserveLabel) parts.push(`保持${preserveLabel}`)
  return parts.join(' / ')
})

function selectType(label: string) {
  selectedType.value = label
  customType.value = ''
}

function resetType() {
  selectedType.value = ''
  customType.value = ''
}

watch(() => props.visible, (visible) => {
  if (!visible) return
  styleRefDataUri.value = ''
  pickerVisible.value = false
  selectedType.value = ''
  customType.value = ''
  styleStrength.value = 'balanced'
  contentPreserve.value = 'high'
  extraPrompt.value = ''
})

async function onStyleRefSelected(paths: string[]) {
  if (paths.length === 0) return
  try {
    const items = await loadAsDataUri(paths.slice(0, 1), { maxSize: 1024, quality: 0.8 })
    if (items[0]) styleRefDataUri.value = items[0].dataUri
  } catch (e) {
    console.error('[StyleTransferDialog] failed to load style ref image', e)
  }
}

function cancel() {
  emit('update:visible', false)
}

function confirm() {
  if (!canConfirm.value) return
  emit('confirm', {
    styleRefDataUri: styleRefDataUri.value,
    imageType: imageType.value || undefined,
    styleStrength: styleStrength.value,
    contentPreserve: contentPreserve.value,
    extraPrompt: extraPrompt.value.trim() || undefined,
    summary: summaryText.value
  })
  emit('update:visible', false)
}
</script>
