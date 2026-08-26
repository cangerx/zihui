<template>
  <div class="canvas-node" :style="{ borderColor: 'var(--color-primary-500, #23574f)' }" :data-status="data.status">
    <div class="node-header" style="background: var(--color-primary-50, #f2f6f5); color: var(--color-primary-700, #1a3f3a);">
      <span class="node-type-dot" style="background: var(--color-primary-500, #23574f);"></span>
      图片反推
      <span class="text-[10px] font-normal opacity-60 ml-1">#{{ data.nodeIndex }}</span>
      <button @click="deleteNode" :disabled="data.locked" class="node-delete-btn">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div class="node-body">
      <!-- 上游图像状态：用户没连入时给提示，避免点反推后才报错 -->
      <div v-if="!hasUpstreamImage" class="text-[10px] text-text-tertiary mb-2 px-2 py-1.5 bg-surface-2 rounded-lg text-center">
        请连入上游图像节点
      </div>

      <!-- 视觉模型（可折叠，默认折叠用画布默认） -->
      <div class="mb-2">
        <button
          @click.stop="showModel = !showModel"
          :disabled="data.locked"
          class="w-full flex items-center justify-between gap-1.5 px-1 py-0.5 text-[10px] text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-50"
        >
          <span class="flex items-center gap-1">
            <svg class="w-2.5 h-2.5 transition-transform" :class="{ 'rotate-90': showModel }" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
            视觉模型
          </span>
          <span class="text-[9px] opacity-70">{{ modelStatusLabel }}</span>
        </button>
        <div v-if="showModel" class="mt-1.5 space-y-1.5">
          <select
            v-model="visionProviderModel"
            @change="onProviderChange"
            class="node-textarea nodrag w-full"
            :disabled="data.locked"
          >
            <option value="">使用画布默认</option>
            <option v-for="p in modelStore.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <select
            v-if="visionProviderModel"
            v-model="visionModelModel"
            @change="saveModel"
            class="node-textarea nodrag w-full"
            :disabled="data.locked || !modelOptions.recommended.length && !modelOptions.others.length"
          >
            <option value="">-- 选择模型 --</option>
            <optgroup v-if="modelOptions.recommended.length" label="推荐（视觉）">
              <option v-for="m in modelOptions.recommended" :key="m" :value="m">{{ modelStore.optionLabel(visionProviderModel, m) }}</option>
            </optgroup>
            <optgroup v-if="modelOptions.others.length" label="其他">
              <option v-for="m in modelOptions.others" :key="m" :value="m">{{ modelStore.optionLabel(visionProviderModel, m) }}</option>
            </optgroup>
          </select>
          <p class="text-[9px] text-text-disabled leading-snug">
            留空时回退到画布设置中的「视觉模型」。需多模态模型（如 GPT-4o / Claude / Gemini / Qwen-VL）
          </p>
        </div>
      </div>

      <!-- 风格 + 语言（同一组，紧凑横排） -->
      <div class="mb-2 space-y-1.5">
        <div class="flex items-center gap-1.5">
          <span class="text-[9px] text-text-tertiary w-7 flex-shrink-0">风格</span>
          <select
            v-model="stylePresetModel"
            @change="saveStyle"
            class="node-textarea nodrag flex-1"
            :disabled="data.locked"
          >
            <option v-for="s in styleOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-[9px] text-text-tertiary w-7 flex-shrink-0">语言</span>
          <div class="flex-1 grid grid-cols-2 gap-1">
            <button
              v-for="l in langOptions"
              :key="l.value"
              @click.stop="setLang(l.value)"
              :disabled="data.locked || (l.value === 'cn' && forceEnglish)"
              :class="[
                'px-1.5 py-1 text-[10px] rounded-md border transition-colors',
                outputLang === l.value
                  ? 'border-primary-500 bg-primary-50 text-primary-700 font-medium dark:bg-primary-900/30 dark:text-primary-300'
                  : 'border-surface-3 bg-surface-1 text-text-secondary hover:bg-surface-2',
                (l.value === 'cn' && forceEnglish) ? 'opacity-40 cursor-not-allowed' : ''
              ]"
              :title="l.value === 'cn' && forceEnglish ? '该风格仅支持英文' : ''"
            >{{ l.label }}</button>
          </div>
        </div>
      </div>

      <!-- 自定义提示词（可折叠，默认折叠用风格预设） -->
      <div class="mb-2">
        <button
          @click.stop="showCustom = !showCustom"
          :disabled="data.locked"
          class="w-full flex items-center justify-between gap-1.5 px-1 py-0.5 text-[10px] text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-50"
        >
          <span class="flex items-center gap-1">
            <svg class="w-2.5 h-2.5 transition-transform" :class="{ 'rotate-90': showCustom }" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
            自定义提示词
          </span>
          <span class="text-[9px] opacity-70">{{ customStatusLabel }}</span>
        </button>
        <div v-if="showCustom" class="mt-1.5">
          <PromptTextarea
            v-model="customPromptModel"
            @change="saveCustomPrompt"
            title="编辑反推自定义提示词"
            :height="88"
            placeholder="留空使用上方风格预设的内置提示词"
            container-class="nodrag nopan"
            input-class="text-[11px]"
            :disabled="data.locked"
          />
          <div class="flex justify-end mt-1" v-if="customPromptModel">
            <button
              @click.stop="resetCustomPrompt"
              :disabled="data.locked"
              class="text-[9px] text-text-tertiary hover:text-primary-600 transition-colors disabled:opacity-50"
            >恢复默认</button>
          </div>
        </div>
      </div>

      <!-- 运行时状态 / 错误 / 结果 -->
      <div v-if="data.status === 'running'" class="flex items-center gap-1.5 text-[10px] text-amber-600 mb-2">
        <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
        反推中...
      </div>
      <div v-if="data.status === 'error'" class="text-[10px] text-red-500 mb-2 break-words">{{ data.error }}</div>
      <div v-if="data.result" class="text-[10px] text-text-secondary mb-2 p-2 bg-surface-2 rounded-lg max-h-24 overflow-y-auto break-words">{{ data.result }}</div>

      <button
        @click="runReverse"
        :disabled="data.status === 'running' || data.locked || !hasUpstreamImage"
        class="w-full py-1.5 text-[10px] font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 transition-colors"
      >
        反推提示词
      </button>
    </div>
    <Handle type="target" :position="Position.Left" id="image-input" class="handle-image" />
    <Handle
      type="source"
      :position="Position.Right"
      id="output"
      class="handle-text"
      @click="(e: MouseEvent) => onHandleClick?.(e, data.nodeId, 'output', 'text')"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvas'
import { useModelStore } from '@/stores/models'
import { useWorkflowEngine } from '../composables/useWorkflowEngine'
import { groupAndSort } from '@/utils/model-caps'
import { getHintsSync } from '@/utils/model-usage-hints'
import {
  STYLE_OPTIONS as styleOptions,
  LANG_OPTIONS as langOptions,
  isEnOnly,
  type StylePreset,
  type OutputLang,
} from '@/utils/image2prompt-presets'
import PromptTextarea from '@/components/PromptTextarea.vue'

type HandleClickHandler = (e: MouseEvent, nodeId: string, handleId: string, dataType: 'text' | 'image') => void

const props = defineProps<{ data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const modelStore = useModelStore()
const { executeSingleNode } = useWorkflowEngine()
const onHandleClick = inject<HandleClickHandler | null>('onHandleClick', null)

// 折叠区域开合：模型 / 自定义提示词，默认折叠以保持节点高度紧凑
const showModel = ref(false)
const showCustom = ref(false)

// 节点字段的本地 v-model 镜像。直接 v-model="props.data.xxx" 在 Vue Flow 节点里
// 容易因 props 替换断绑定，这里用 ref + watch 同步保险一些。
const visionProviderModel = ref<string>(props.data.vision_provider_id || '')
const visionModelModel = ref<string>(props.data.vision_model_id || '')
const stylePresetModel = ref<StylePreset>((props.data.style_preset as StylePreset) || 'general')
const outputLang = ref<OutputLang>((props.data.output_lang as OutputLang) || 'cn')
const customPromptModel = ref<string>(props.data.custom_prompt || '')

watch(() => props.data.vision_provider_id, (v) => { visionProviderModel.value = v || '' })
watch(() => props.data.vision_model_id, (v) => { visionModelModel.value = v || '' })
watch(() => props.data.style_preset, (v) => { stylePresetModel.value = (v as StylePreset) || 'general' })
watch(() => props.data.output_lang, (v) => { outputLang.value = (v as OutputLang) || 'cn' })
watch(() => props.data.custom_prompt, (v) => { customPromptModel.value = v || '' })

// 强制英文：sd_tag / danbooru 仅支持英文输出，切到这两个风格时强制把 lang 改成 en
const forceEnglish = computed(() => isEnOnly(stylePresetModel.value))
watch(forceEnglish, (en) => {
  if (en && outputLang.value !== 'en') {
    outputLang.value = 'en'
    saveLang()
  }
})

// 上游是否连接了图像节点。注意只判断"有没有连线进 image-input handle"，
// 不验证上游真有数据；执行时 useWorkflowEngine 会再做一次实际数据校验
const hasUpstreamImage = computed(() => {
  if (!props.data.nodeId || !props.data.projectId) return false
  return canvasStore.edges.some(
    (e) =>
      e.project_id === props.data.projectId &&
      e.target_node_id === props.data.nodeId &&
      e.target_handle === 'image-input'
  )
})

// 视觉模型分组（沿用 Image2PromptView 的同款 groupAndSort）
const currentProvider = computed(() =>
  modelStore.providers.find((p) => p.id === visionProviderModel.value) || null
)

const modelOptions = computed(() => {
  if (!currentProvider.value) return { recommended: [] as string[], others: [] as string[] }
  return groupAndSort(currentProvider.value.models, 'vision', {
    cloudTypeOf: (mid) => modelStore.cloudTypeOf(currentProvider.value!.id, mid),
    usageHints: getHintsSync('vision', currentProvider.value.id)
  })
})

const modelStatusLabel = computed(() => {
  if (!visionProviderModel.value) return '画布默认'
  if (!visionModelModel.value) return '未选模型'
  return '已自定义'
})

const customStatusLabel = computed(() => {
  return customPromptModel.value.trim() ? '已自定义' : '默认'
})

function persist(patch: Record<string, any>) {
  if (!props.data.nodeId) return
  canvasStore.updateNode(props.data.nodeId, {
    data: { ...props.data, ...patch }
  })
}

function onProviderChange() {
  // 切服务商时清空模型选择，避免显示其他家的 model id
  visionModelModel.value = ''
  persist({ vision_provider_id: visionProviderModel.value, vision_model_id: '' })
}

function saveModel() {
  persist({ vision_model_id: visionModelModel.value })
}

function saveStyle() {
  persist({ style_preset: stylePresetModel.value })
}

function setLang(v: OutputLang) {
  if (props.data.locked) return
  if (v === 'cn' && forceEnglish.value) return
  outputLang.value = v
  saveLang()
}

function saveLang() {
  persist({ output_lang: outputLang.value })
}

function saveCustomPrompt() {
  persist({ custom_prompt: customPromptModel.value })
}

function resetCustomPrompt() {
  customPromptModel.value = ''
  persist({ custom_prompt: '' })
}

async function runReverse() {
  if (!props.data.nodeId || !props.data.projectId) return
  await executeSingleNode(props.data.nodeId, props.data.projectId)
}

function deleteNode() {
  if (!props.data.nodeId) return
  canvasStore.removeNode(props.data.nodeId)
}
</script>
