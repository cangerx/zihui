<template>
  <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center">
    <div class="bg-surface-0 rounded-xl shadow-2xl border border-surface-3 w-[680px] max-h-[88vh] flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="px-5 py-3 border-b border-surface-3 flex items-center justify-between flex-shrink-0">
        <div>
          <h3 class="text-sm font-medium text-text-primary">AI 换姿势</h3>
          <p class="text-[11px] text-text-tertiary mt-0.5">选择姿势来源与朝向，AI 会保留人物脸部、服装与背景，仅改变姿势</p>
        </div>
        <button @click="cancel" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto p-5 space-y-5">
        <!-- Tab: 姿势来源 -->
        <div>
          <h4 class="text-xs font-medium text-text-secondary mb-2">姿势来源</h4>
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
          <div v-for="cat in POSE_CATEGORIES" :key="cat.id" class="mb-4 last:mb-0">
            <div class="text-[11px] font-medium text-text-tertiary mb-1.5">{{ cat.label }}</div>
            <div class="grid grid-cols-5 gap-2">
              <button
                v-for="p in presetsByCategory(cat.id)"
                :key="p.id"
                @click="selectedPresetId = p.id"
                :title="p.prompt"
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
          <h4 class="text-xs font-medium text-text-secondary mb-2">描述姿势</h4>
          <PromptTextarea
            v-model="customText"
            title="编辑姿势描述"
            :height="88"
            :max-length="IMAGE_PROMPT_MAX_LENGTH"
            placeholder="例如：右手叉腰，左手自然下垂；或者：侧身回眸，身体微微前倾"
            input-class="text-xs"
          />
          <p class="text-[10px] text-text-tertiary mt-1.5">中英文均可。越具体（手脚位置 / 重心 / 视线方向）效果越好。</p>
        </div>

        <!-- 参考姿势图 -->
        <div v-else-if="source === 'ref-image'">
          <h4 class="text-xs font-medium text-text-secondary mb-2">姿势参考图</h4>
          <div v-if="!poseRefDataUri" class="flex items-center gap-3">
            <button
              @click="pickerVisible = true"
              class="flex items-center justify-center w-32 h-32 rounded-lg border-2 border-dashed border-surface-3 hover:border-primary-400 hover:bg-primary-50/40 dark:hover:bg-primary-900/10 text-text-tertiary hover:text-primary-600 transition-colors"
            >
              <div class="flex flex-col items-center gap-1.5">
                <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <span class="text-[11px]">上传姿势图</span>
              </div>
            </button>
            <p class="text-[10px] text-text-tertiary leading-relaxed flex-1">
              挑一张姿势参考图，<br />可以是运动员 / 海报 / 游戏截图等。<br />AI 会参照其姿势重塑你照片中的人物。
            </p>
          </div>
          <div v-else class="flex items-start gap-3">
            <div class="relative w-32 h-32 rounded-lg overflow-hidden border border-surface-3 group flex-shrink-0">
              <img :src="poseRefDataUri" class="w-full h-full object-cover" />
              <button
                @click="poseRefDataUri = ''"
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
              <p class="text-[10px] text-text-tertiary leading-relaxed">已上传姿势参考图。AI 会参照其肢体姿势与构图，重塑下一步选的人物姿势。</p>
            </div>
          </div>
        </div>

        <!-- 身体朝向：预设 / 文字 tab 可选。参考姿势图自带朝向不需要 -->
        <div v-if="source !== 'ref-image'">
          <h4 class="text-xs font-medium text-text-secondary mb-2">
            身体朝向 <span class="text-text-tertiary font-normal">（可选）</span>
          </h4>
          <div class="flex items-center gap-2 flex-wrap">
            <button
              @click="selectedOrientationId = ''"
              :class="[
                'px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors',
                !selectedOrientationId
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700'
                  : 'border-surface-3 text-text-secondary hover:bg-surface-2'
              ]"
            >不指定</button>
            <button
              v-for="o in BODY_ORIENTATIONS"
              :key="o.id"
              @click="selectedOrientationId = o.id"
              :class="[
                'px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors',
                selectedOrientationId === o.id
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700'
                  : 'border-surface-3 text-text-secondary hover:bg-surface-2'
              ]"
            >{{ o.label }}</button>
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
            <p class="text-[10px] text-text-tertiary mb-2">默认全开。关闭某项会让 AI 在该项上有更多自由度（如关闭"服装"允许 AI 适配新姿势调整衣服褶皱与遮挡）。</p>
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
          下一步：点「选择照片」按钮，挑一张人物正面或半身照。AI 会保留人物的脸、服装与背景，仅改变姿势。
        </div>
      </div>

      <!-- Footer -->
      <div class="px-5 py-3 border-t border-surface-3 flex items-center justify-between flex-shrink-0">
        <div class="text-[11px] text-text-tertiary truncate max-w-[60%]">
          已选：<span class="text-text-secondary font-medium">{{ summaryText || '请先选择姿势' }}</span>
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

    <!-- 内嵌：姿势参考图选择器（只在 ref-image tab 用） -->
    <ImageSourcePickerDialog
      v-model:visible="pickerVisible"
      title="选择姿势参考图"
      hint="挑一张人物姿势参考图，运动员、海报、游戏截图均可"
      :multiple="false"
      @select="onPoseRefSelected"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import {
  POSE_CATEGORIES,
  POSE_PRESETS,
  BODY_ORIENTATIONS,
  DEFAULT_PRESERVE_OPTIONS,
  type PoseSource,
  type PoseCategoryId,
  type PosePreserveOptions
} from '@shared/pose-change-presets'
import ImageSourcePickerDialog from './ImageSourcePickerDialog.vue'
import { loadAsDataUri } from '@/utils/image-source'
import PromptTextarea from './PromptTextarea.vue'
import { IMAGE_PROMPT_MAX_LENGTH } from '@shared/prompt-limits'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'confirm', payload: {
    /** 姿势文字描述：预设的 prompt / 用户自定义；ref-image 模式下为空 */
    poseText: string
    /** 身体朝向中文名（如「正面」「左 3/4」），可空 */
    orientationLabel?: string
    /** 身体朝向 prompt 片段（如「正对镜头」），可空 */
    orientationPrompt?: string
    /** 姿势参考图 dataUri（可空） */
    poseRefDataUri?: string
    /** 保留项开关 */
    preserve: PosePreserveOptions
    /** Footer 用的摘要文案 */
    summary: string
    /** 姿势来源 tab */
    source: PoseSource
  }): void
}>()

const tabs: Array<{ id: PoseSource; label: string }> = [
  { id: 'preset', label: '预设动作' },
  { id: 'text', label: '文字描述' },
  { id: 'ref-image', label: '参考姿势图' }
]

const source = ref<PoseSource>('preset')
const selectedPresetId = ref(POSE_PRESETS[0].id)
const customText = ref('')
const poseRefDataUri = ref('')
const pickerVisible = ref(false)

// 身体朝向（单选，空串 = 不指定）
const selectedOrientationId = ref('')

// 高级 / 保留项
const advancedOpen = ref(false)
const preserve = reactive<PosePreserveOptions>({ ...DEFAULT_PRESERVE_OPTIONS })
const preserveItems: Array<{ key: keyof PosePreserveOptions; label: string }> = [
  { key: 'face', label: '脸 / 身份' },
  { key: 'outfit', label: '服装' },
  { key: 'background', label: '背景 / 光线' },
  { key: 'hair', label: '发型' },
  { key: 'bodyShape', label: '体型' }
]

function presetsByCategory(catId: PoseCategoryId) {
  return POSE_PRESETS.filter(p => p.category === catId)
}

// 选中的预设（仅 preset tab 有意义）
const currentPreset = computed(() => POSE_PRESETS.find(p => p.id === selectedPresetId.value))

// 选中的朝向（仅文字 / 预设 tab 有意义）
const currentOrientation = computed(() =>
  BODY_ORIENTATIONS.find(o => o.id === selectedOrientationId.value)
)

// 传给父组件的姿势描述：preset 用预设 prompt（详细），text 用用户原文
const poseText = computed(() => {
  if (source.value === 'preset') return currentPreset.value?.prompt || ''
  if (source.value === 'text') return customText.value.trim()
  return ''
})

// 用户视角的简短摘要（仅 preset 用 label，避免 footer 文字太长）
const poseLabel = computed(() => {
  if (source.value === 'preset') return currentPreset.value?.label || ''
  if (source.value === 'text') return customText.value.trim()
  return ''
})

const summaryText = computed(() => {
  if (source.value === 'ref-image') {
    return poseRefDataUri.value ? '按姿势参考图换姿势' : ''
  }
  const parts: string[] = []
  if (poseLabel.value) parts.push(poseLabel.value)
  if (currentOrientation.value) parts.push(`（${currentOrientation.value.label}）`)
  return parts.join(' ')
})

const canConfirm = computed(() => {
  if (source.value === 'preset') return !!selectedPresetId.value
  if (source.value === 'text') return customText.value.trim().length > 0
  return !!poseRefDataUri.value
})

async function onPoseRefSelected(paths: string[]) {
  if (paths.length === 0) return
  try {
    const items = await loadAsDataUri(paths.slice(0, 1), { maxSize: 1024, quality: 0.8 })
    if (items[0]) poseRefDataUri.value = items[0].dataUri
  } catch (e) {
    console.error('[PoseChangeDialog] failed to load pose ref image', e)
  }
}

function cancel() {
  emit('update:visible', false)
}

function confirm() {
  if (!canConfirm.value) return
  emit('confirm', {
    poseText: poseText.value,
    orientationLabel: currentOrientation.value?.label,
    orientationPrompt: currentOrientation.value?.prompt,
    poseRefDataUri: poseRefDataUri.value || undefined,
    preserve: { ...preserve },
    summary: summaryText.value,
    source: source.value
  })
  emit('update:visible', false)
}
</script>
