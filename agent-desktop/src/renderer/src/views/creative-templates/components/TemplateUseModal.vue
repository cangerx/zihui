<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-6 pointer-events-none"
  >
    <div
      class="bg-surface-0 rounded-2xl shadow-[0_10px_50px_rgba(0,0,0,0.18)] w-[720px] max-w-[95vw] max-h-[90vh] flex flex-col pointer-events-auto"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-surface-2">
        <div>
          <h3 class="text-sm font-semibold text-text-primary truncate">{{ template.title }}</h3>
          <p v-if="template.description" class="text-[10px] text-text-tertiary mt-0.5 line-clamp-1">{{ template.description }}</p>
        </div>
        <button class="text-text-tertiary hover:text-text-primary" @click="emit('close')">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto p-5 text-xs">
        <!-- 变量填写 -->
        <p class="text-text-secondary mb-2">填写变量</p>
        <div v-if="!template.variables?.length" class="text-text-tertiary text-center py-3 bg-surface-2 rounded-lg">该模板没有可填变量</div>
        <div v-else class="space-y-3">
          <div v-for="v in template.variables" :key="v.key">
            <label class="block">
              <span class="text-text-secondary">{{ v.label }}{{ v.required ? ' *' : '' }}<span class="ml-1 text-text-tertiary">{{ v.key }}</span></span>
              <PromptTextarea
                v-if="v.type === 'textarea'"
                :model-value="stringValue(v.key)"
                @update:model-value="setStringValue(v.key, $event)"
                :title="`编辑${v.label || v.key}`"
                :height="88"
                :placeholder="v.placeholder || ''"
              />
              <div
                v-else-if="v.type === 'select'"
                class="mt-1 space-y-2"
              >
                <div v-if="optionList(v).length" class="flex flex-wrap gap-1.5">
                  <button
                    v-for="opt in optionList(v)"
                    :key="opt"
                    type="button"
                    class="px-2.5 py-1 text-[11px] rounded-lg border transition-colors"
                    :class="values[v.key] === opt ? 'bg-primary-600 text-white border-primary-600' : 'bg-surface-0 text-text-secondary border-surface-3 hover:bg-surface-1'"
                    @click="selectOption(v.key, opt)"
                  >{{ opt }}</button>
                </div>
                <input
                  v-model="values[v.key]"
                  class="w-full px-3 py-2 border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500"
                  :placeholder="v.placeholder || (optionList(v).length ? '也可以输入自定义内容' : '请输入自定义内容')"
                />
              </div>
              <div v-else-if="v.type === 'multi_select'" class="mt-1 space-y-2">
                <div v-if="optionList(v).length" class="flex flex-wrap gap-1.5">
                  <button
                    v-for="opt in optionList(v)"
                    :key="opt"
                    type="button"
                    class="px-2.5 py-1 text-[11px] rounded-lg border transition-colors"
                    :class="multiHas(v.key, opt) ? 'bg-primary-600 text-white border-primary-600' : 'bg-surface-0 text-text-secondary border-surface-3 hover:bg-surface-1'"
                    @click="toggleMulti(v.key, opt)"
                  >{{ opt }}</button>
                </div>
                <div class="flex gap-2">
                  <input
                    :value="customMultiInputs[v.key] || ''"
                    class="flex-1 px-3 py-2 border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="输入自定义选项后回车"
                    @input="customMultiInputs[v.key] = ($event.target as HTMLInputElement).value"
                    @keydown.enter.prevent="addCustomMulti(v.key)"
                  />
                  <button
                    type="button"
                    class="px-3 py-2 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-1"
                    @click="addCustomMulti(v.key)"
                  >添加</button>
                </div>
                <div v-if="customMultiValues(v.key, optionList(v)).length" class="flex flex-wrap gap-1.5">
                  <button
                    v-for="opt in customMultiValues(v.key, optionList(v))"
                    :key="opt"
                    type="button"
                    class="px-2.5 py-1 text-[11px] rounded-lg border bg-primary-50 text-primary-700 border-primary-200 hover:bg-primary-100 dark:bg-primary-900/25 dark:text-primary-200 dark:border-primary-800"
                    @click="removeMulti(v.key, opt)"
                  >{{ opt }} <span class="ml-1">×</span></button>
                </div>
              </div>
              <input
                v-else
                v-model="values[v.key]"
                class="mt-1 w-full px-3 py-2 border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500"
                :placeholder="v.placeholder || ''"
              />
            </label>
          </div>
        </div>

        <!-- 最终提示词预览 -->
        <p class="text-text-secondary mt-5 mb-2">最终提示词预览</p>
        <pre class="p-3 bg-surface-2 rounded-lg text-text-primary whitespace-pre-wrap break-words text-[12px] leading-relaxed max-h-40 overflow-auto">{{ renderedPrompt }}</pre>
        <p v-if="missingRequired.length" class="mt-2 text-error text-[11px]">还有必填项未填写：{{ missingRequired.join(', ') }}</p>
        <p v-if="unresolvedPlaceholders.length" class="mt-2 text-error text-[11px]">提示词仍有未替换变量：{{ unresolvedPlaceholders.join(', ') }}</p>
        <p v-if="promptTooLong" class="mt-2 text-error text-[11px]">最终提示词不能超过 {{ IMAGE_PROMPT_MAX_LENGTH }} 字，当前 {{ renderedPrompt.length }} 字</p>

        <div class="mt-5">
          <div class="flex items-center justify-between mb-2">
            <p class="text-text-secondary">参考图（{{ mergedRefImages.length }} / 8 张）</p>
            <button class="px-2 py-1 text-[11px] text-text-secondary border border-surface-3 rounded hover:bg-surface-1" @click="pickUserRefs">上传参考图</button>
          </div>
          <p v-if="template.requires_ref_image" class="mb-2 text-[11px] text-error">该模板要求至少上传 1 张参考图。</p>
          <div class="flex flex-wrap gap-2">
            <div v-for="(r, idx) in displayTemplateRefImages" :key="`tpl-${idx}`" class="relative">
              <img :src="r" class="w-16 h-16 rounded-lg object-cover border border-surface-3" />
              <span class="absolute left-1 bottom-1 px-1 py-0.5 rounded bg-black/55 text-white text-[9px]">模板</span>
            </div>
            <div v-for="(r, idx) in userRefImages" :key="`user-${idx}`" class="relative">
              <img :src="r" class="w-16 h-16 rounded-lg object-cover border border-surface-3" />
              <button class="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/55 text-white text-xs hover:bg-black/75" @click="removeUserRef(idx)">×</button>
            </div>
            <div v-if="!mergedRefImages.length" class="w-full py-3 text-center text-text-tertiary bg-surface-2 rounded-lg">暂无参考图</div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-surface-2">
        <button class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-1" @click="copyPrompt">复制提示词</button>
        <button
          v-if="source === 'cloud'"
          class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-1"
          @click="emit('import-to-local', template as CloudCreativeTemplate)"
        >另存到本地</button>
        <button
          class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50"
          :disabled="missingRequired.length > 0 || missingRefImage || unresolvedPlaceholders.length > 0 || promptTooLong"
          @click="useInImageGen"
        >填入生图</button>
      </div>
    </div>
  </div>
  <ImageSourcePickerDialog
    v-model:visible="imagePickerVisible"
    title="选择参考图"
    hint="可从电脑选择，也可从图库选择已有图片"
    multiple
    @select="onImagePickerSelect"
  />
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useHandoffStore } from '@/stores/handoff'
import ImageSourcePickerDialog from '@/components/ImageSourcePickerDialog.vue'
import PromptTextarea from '@/components/PromptTextarea.vue'
import { loadAsDataUri } from '@/utils/image-source'
import type { CloudCreativeTemplate, CreativeTemplate } from '@/stores/creative-templates'
import { IMAGE_PROMPT_MAX_LENGTH, assertImagePromptLength } from '@shared/prompt-limits'

const props = defineProps<{
  template: CreativeTemplate | CloudCreativeTemplate
  source: 'local' | 'cloud'
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'import-to-local', tpl: CloudCreativeTemplate): void
}>()

const router = useRouter()
const handoff = useHandoffStore()

const values = reactive<Record<string, string | string[]>>({})
const customMultiInputs = reactive<Record<string, string>>({})
const userRefImages = ref<string[]>([])
const imagePickerVisible = ref(false)
const OPTIONAL_EMPTY_MARKER = '\uE000'

watch(
  () => props.template,
  (t) => {
    Object.keys(values).forEach((k) => delete values[k])
    Object.keys(customMultiInputs).forEach((k) => delete customMultiInputs[k])
    userRefImages.value = []
    for (const v of t.variables || []) {
      if (v.type === 'multi_select') {
        values[v.key] = []
      } else {
        values[v.key] = v.default || ''
      }
    }
  },
  { immediate: true },
)

const templateRefImages = computed<string[]>(() => {
  const list = (props.template.example_ref_images || []) as string[]
  return list.map(resolveImagePath).filter(Boolean)
})

const mergedRefImages = computed<string[]>(() => {
  const list = [...userRefImages.value, ...templateRefImages.value]
  return Array.from(new Set(list)).slice(0, 8)
})

const displayTemplateRefImages = computed<string[]>(() => {
  const userSet = new Set(userRefImages.value)
  return templateRefImages.value.filter((r) => !userSet.has(r)).slice(0, Math.max(0, 8 - userRefImages.value.length))
})

const missingRefImage = computed(() => !!props.template.requires_ref_image && userRefImages.value.length === 0)

const renderedPrompt = computed(() => {
  const raw = props.template.prompt_template || ''
  const variableMap = new Map((props.template.variables || []).map((v) => [v.key, v]))
  const rendered = raw.replace(/\{\{\s*([^{}\r\n]+?)\s*\}\}/g, (match, rawKey) => {
    const key = String(rawKey || '').trim()
    const variable = variableMap.get(key)
    const v = values[key]
    if (Array.isArray(v)) {
      const joined = v.map((item) => String(item).trim()).filter(Boolean).join(', ')
      return joined || (variable && !variable.required ? OPTIONAL_EMPTY_MARKER : match)
    }
    const s = String(v ?? '').trim()
    return s || (variable && !variable.required ? OPTIONAL_EMPTY_MARKER : match)
  })
  return cleanupRenderedPrompt(rendered)
})

const unresolvedPlaceholders = computed<string[]>(() => Array.from(new Set(extractPlaceholders(renderedPrompt.value))))
const promptTooLong = computed(() => renderedPrompt.value.length > IMAGE_PROMPT_MAX_LENGTH)

function cleanupRenderedPrompt(text: string): string {
  const markerPattern = new RegExp(`(^|[，,；;、])[^，,；;、\\n]*${OPTIONAL_EMPTY_MARKER}[^，,；;、\\n]*`, 'g')
  const markerOnlyPattern = new RegExp(OPTIONAL_EMPTY_MARKER, 'g')
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(markerPattern, '').replace(markerOnlyPattern, '').replace(/^[\s，,；;、]+|[\s，,；;、]+$/g, '').trim())
    .filter(Boolean)
    .join('\n')
}

function extractPlaceholders(text: string): string[] {
  return Array.from(text.matchAll(/\{\{\s*([^{}\r\n]+?)\s*\}\}/g))
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean)
}

const missingRequired = computed<string[]>(() => {
  const out: string[] = []
  for (const v of props.template.variables || []) {
    if (!v.required) continue
    const cur = values[v.key]
    if (Array.isArray(cur)) {
      if (!cur.length) out.push(v.label || v.key)
      continue
    }
    if (!cur || !String(cur).trim()) out.push(v.label || v.key)
  }
  return out
})

function resolveImagePath(path: string | undefined): string {
  if (!path) return ''
  if (/^(https?:|data:|file:|local-file:)/i.test(path)) return path
  return 'local-file://img?p=' + encodeURIComponent(path.replace(/\\/g, '/'))
}

function multiHas(key: string, opt: string): boolean {
  const cur = values[key]
  return Array.isArray(cur) && cur.includes(opt)
}

function toggleMulti(key: string, opt: string): void {
  const cur = values[key]
  if (!Array.isArray(cur)) {
    values[key] = [opt]
    return
  }
  const idx = cur.indexOf(opt)
  if (idx === -1) cur.push(opt)
  else cur.splice(idx, 1)
}

function selectOption(key: string, opt: string): void {
  values[key] = opt
}

function stringValue(key: string): string {
  const value = values[key]
  return Array.isArray(value) ? value.join(', ') : String(value ?? '')
}

function setStringValue(key: string, value: string): void {
  values[key] = value
}

function optionList(v: { options?: string[] | string }): string[] {
  const raw = Array.isArray(v.options)
    ? v.options
    : String(v.options || '').split(/[\/,，\n]/)
  return Array.from(new Set(raw.map((opt) => String(opt).trim()).filter(Boolean)))
}

function removeMulti(key: string, opt: string): void {
  const cur = values[key]
  if (!Array.isArray(cur)) return
  const idx = cur.indexOf(opt)
  if (idx !== -1) cur.splice(idx, 1)
}

function addCustomMulti(key: string): void {
  const value = String(customMultiInputs[key] || '').trim()
  if (!value) return
  const cur = values[key]
  if (Array.isArray(cur)) {
    if (!cur.includes(value)) cur.push(value)
  } else {
    values[key] = [value]
  }
  customMultiInputs[key] = ''
}

function customMultiValues(key: string, presetOptions: string[]): string[] {
  const cur = values[key]
  if (!Array.isArray(cur)) return []
  const presets = new Set(presetOptions)
  return cur.filter((item) => !presets.has(item))
}

function pickUserRefs(): void {
  imagePickerVisible.value = true
}

async function onImagePickerSelect(paths: string[]): Promise<void> {
  if (!paths.length) return
  const images = await loadAsDataUri(paths, { maxSize: 1024, quality: 0.85 })
  for (const image of images) {
    if (userRefImages.value.length >= 8) break
    const uri = image.dataUri
    if (uri) userRefImages.value.push(uri)
  }
}

function removeUserRef(idx: number): void {
  userRefImages.value.splice(idx, 1)
}

async function copyPrompt(): Promise<void> {
  try {
    await navigator.clipboard.writeText(renderedPrompt.value)
  } catch {
    // 忽略剪贴板异常，避免打扰用户
  }
}

// 把渲染好的提示词 + 参考图 + 默认尺寸 handoff 到 imageGen 页面
// 与 InspirationView 行为一致；ImageGenView 在 onMounted 消费 handoff 写入输入框
function useInImageGen(): void {
  if (missingRequired.value.length || missingRefImage.value || unresolvedPlaceholders.value.length || promptTooLong.value) return
  assertImagePromptLength(renderedPrompt.value, '模板提示词')
  const refs = mergedRefImages.value.slice(0, 8)
  handoff.set('imageGen', {
    prompt: renderedPrompt.value,
    presetSize: props.template.default_size || undefined,
    refImages: refs.length ? refs : undefined,
  })
  emit('close')
  router.push('/image-gen')
}
</script>
