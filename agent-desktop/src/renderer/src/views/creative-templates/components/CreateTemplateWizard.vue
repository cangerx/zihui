<template>
  <div v-if="modelValue" class="fixed inset-0 z-50 flex items-center justify-center p-6 pointer-events-none">
    <div class="bg-surface-0 rounded-2xl shadow-[0_10px_50px_rgba(0,0,0,0.18)] w-[1040px] max-w-[96vw] max-h-[90vh] flex flex-col pointer-events-auto">
      <div class="flex items-center justify-between px-5 py-3 border-b border-surface-2">
        <div>
          <h3 class="text-sm font-semibold text-text-primary">选择创建方式</h3>
          <p class="text-xs text-text-tertiary mt-0.5">所有创意模板都在这里完成创建。</p>
        </div>
        <button class="text-text-tertiary hover:text-text-primary" @click="close">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-5 text-xs">
        <div class="grid grid-cols-4 gap-2 mb-5">
          <button v-for="item in modeItems" :key="item.value" class="text-left rounded-xl border p-3 transition-colors" :class="mode === item.value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-3 bg-surface-0 text-text-secondary hover:bg-surface-1'" @click="mode = item.value">
            <div class="font-medium">{{ item.title }}</div>
            <p class="mt-1 text-[11px] opacity-80 leading-relaxed">{{ item.desc }}</p>
          </button>
        </div>

        <div v-if="busy" class="mb-4 p-3 rounded-lg bg-surface-2 text-text-secondary">{{ busyText }}</div>
        <p v-if="error" class="mb-4 p-3 rounded-lg bg-error/10 text-error">{{ error }}</p>

        <section v-if="mode === 'manual'" class="rounded-xl border border-surface-3 p-4">
          <p class="text-text-secondary mb-3">打开空白编辑器，手动填写模板标题、变量和提示词模板。</p>
          <button class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg" @click="startManual">开始手动创建</button>
        </section>

        <section v-else-if="mode === 'analyze'" class="rounded-xl border border-surface-3 p-4 space-y-4">
          <label class="block">
            <span class="text-text-secondary">完整提示词</span>
            <PromptTextarea
              v-model="promptText"
              title="编辑完整提示词"
              :height="176"
              :max-length="IMAGE_PROMPT_MAX_LENGTH"
              placeholder="粘贴成熟的整段提示词，AI 会拆成可复用模板和变量。"
            />
          </label>
          <ModelPicker label="拆解模型" cap="chat" v-model:provider-id="chatProviderId" v-model:model-id="chatModelId" />
          <button class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50" :disabled="busy" @click="startAnalyze">开始 AI 拆解</button>
        </section>

        <section v-else-if="mode === 'image'" class="rounded-xl border border-surface-3 p-4 space-y-4">
          <div class="flex gap-4">
            <div class="w-40 h-40 rounded-xl border border-surface-3 bg-surface-2 overflow-hidden flex items-center justify-center">
              <img v-if="reverseImage" :src="reverseImage" class="w-full h-full object-cover" />
              <span v-else class="text-text-tertiary">未选择图片</span>
            </div>
            <div class="flex-1 space-y-3">
              <button class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-1" @click="reversePickerOpen = true">上传图片</button>
              <label class="block">
                <span class="text-text-secondary">补充说明</span>
                <PromptTextarea
                  v-model="reverseHint"
                  title="编辑反推补充说明"
                  :height="88"
                  placeholder="可选，例如保留主体姿态、构图和配色。"
                />
              </label>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <ModelPicker label="视觉模型" cap="vision" v-model:provider-id="visionProviderId" v-model:model-id="visionModelId" />
            <ModelPicker label="拆解模型" cap="chat" v-model:provider-id="chatProviderId" v-model:model-id="chatModelId" />
          </div>
          <div v-if="reversePrompt" class="p-3 rounded-lg bg-surface-2 text-text-primary whitespace-pre-wrap">{{ reversePrompt }}</div>
          <button class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50" :disabled="busy || !reverseImage" @click="startImageFlow">反推并拆解为模板</button>
        </section>

        <section v-else class="rounded-xl border border-surface-3 p-4 space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-text-secondary">选择灵感</p>
              <p class="text-text-tertiary mt-0.5">会将灵感提示词交给 AI 拆解，并把灵感参考图带入示例参考图。</p>
            </div>
            <button class="px-2.5 py-1 text-xs text-text-secondary border border-surface-3 rounded hover:bg-surface-1" :disabled="inspirationLoading" @click="loadInspirations()">刷新</button>
          </div>
          <div v-if="inspirationCategories.length" class="flex flex-wrap gap-1.5">
            <button class="px-2.5 py-1 text-[11px] rounded-lg transition-colors" :class="!inspirationCategory ? 'bg-primary-600 text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3'" @click="selectInspirationCategory('')">全部</button>
            <button v-for="cat in inspirationCategories" :key="cat" class="px-2.5 py-1 text-[11px] rounded-lg transition-colors" :class="inspirationCategory === cat ? 'bg-primary-600 text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3'" @click="selectInspirationCategory(cat)">{{ cat }}</button>
          </div>
          <div class="flex gap-2">
            <input v-model="inspirationSearch" class="flex-1 px-3 py-2 border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500" placeholder="搜索灵感标题或提示词" @keydown.enter="loadInspirations(1)" />
            <button class="px-3 py-2 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-1" :disabled="inspirationLoading" @click="loadInspirations(1)">搜索</button>
          </div>
          <div v-if="inspirationLoading" class="py-8 text-center text-text-tertiary">正在加载灵感...</div>
          <div v-else class="grid grid-cols-3 md:grid-cols-6 gap-2 max-h-[360px] overflow-y-auto pr-1">
            <button v-for="item in inspirations" :key="item.id" class="text-left rounded-lg border overflow-hidden transition-colors" :class="selectedInspirationId === item.id ? 'border-primary-500 bg-primary-50' : 'border-surface-3 bg-surface-0 hover:bg-surface-1'" @click="selectedInspirationId = item.id">
              <div class="aspect-[4/3] bg-surface-2 overflow-hidden">
                <img v-if="item.cover_image" :src="item.cover_image" class="w-full h-full object-cover" loading="lazy" decoding="async" />
              </div>
              <div class="p-1.5">
                <div class="font-medium text-[11px] text-text-primary truncate">{{ item.title }}</div>
                <p class="mt-0.5 text-[10px] text-text-tertiary truncate">{{ item.category || '未分类' }}</p>
              </div>
            </button>
          </div>
          <div v-if="inspirationTotal > inspirationPageSize" class="flex items-center justify-center gap-3 text-[11px] text-text-secondary">
            <button class="px-2.5 py-1 border border-surface-3 rounded bg-surface-0 hover:bg-surface-1 disabled:opacity-40" :disabled="inspirationPage <= 1 || inspirationLoading" @click="goToInspirationPage(inspirationPage - 1)">上一页</button>
            <span>第 <strong class="text-text-primary">{{ inspirationPage }}</strong> / {{ inspirationTotalPages }} 页（{{ inspirationTotal }} 条）</span>
            <button class="px-2.5 py-1 border border-surface-3 rounded bg-surface-0 hover:bg-surface-1 disabled:opacity-40" :disabled="inspirationPage >= inspirationTotalPages || inspirationLoading" @click="goToInspirationPage(inspirationPage + 1)">下一页</button>
          </div>
          <ModelPicker label="拆解模型" cap="chat" v-model:provider-id="chatProviderId" v-model:model-id="chatModelId" />
          <button class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50" :disabled="busy || !selectedInspiration" @click="startInspirationFlow">从灵感拆解为模板</button>
        </section>
      </div>
    </div>
    <ImageSourcePickerDialog
      v-model:visible="reversePickerOpen"
      title="选择反推图片"
      hint="可从电脑上传，也可以从图库选择一张图片。"
      @select="onReverseImageSelected"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref, watch } from 'vue'
import { useModelStore } from '@/stores/models'
import type { CreativeTemplateSource, CreativeTemplateVariable } from '@/stores/creative-templates'
import { groupAndSort, type ModelCap } from '@/utils/model-caps'
import { getHintsSync, recordUsage, warmHintsCache } from '@/utils/model-usage-hints'
import { loadAsDataUri } from '@/utils/image-source'
import { getSystemPrompt as getImage2PromptSystemPrompt, getUserPrompt as getImage2PromptUserPrompt, isEnOnly, type OutputLang, type StylePreset } from '@/utils/image2prompt-presets'
import ImageSourcePickerDialog from '@/components/ImageSourcePickerDialog.vue'
import PromptTextarea from '@/components/PromptTextarea.vue'
import { IMAGE_PROMPT_MAX_LENGTH } from '@shared/prompt-limits'

interface DraftPayload {
  source_type?: CreativeTemplateSource
  source_image?: string
  source_inspiration_id?: string
  presetTitle?: string
  presetPrompt?: string
  presetDescription?: string
  presetRefImages?: string[]
  presetVariables?: CreativeTemplateVariable[]
  presetSize?: string
  requiresRefImage?: boolean
}

interface InspirationItem {
  id: string
  title: string
  prompt_cn: string
  prompt_en: string
  category: string
  ref_image?: string
  ref_images?: string[]
  generation_size?: string
  cover_image?: string
}

interface NormalizedVariableResult {
  variables: CreativeTemplateVariable[]
  keyMap: Map<string, string>
  usedKeys: Set<string>
}

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'manual'): void
  (e: 'draft-ready', value: DraftPayload): void
}>()

type CreateMode = 'analyze' | 'image' | 'inspiration' | 'manual'

const modelStore = useModelStore()
const mode = ref<CreateMode>('analyze')
const busy = ref(false)
const busyText = ref('')
const error = ref('')
const promptText = ref('')
const reverseImage = ref('')
const reversePickerOpen = ref(false)
const reverseHint = ref('')
const reversePrompt = ref('')
const chatProviderId = ref('')
const chatModelId = ref('')
const visionProviderId = ref('')
const visionModelId = ref('')
const inspirations = ref<InspirationItem[]>([])
const inspirationLoading = ref(false)
const selectedInspirationId = ref('')
const inspirationSearch = ref('')
const inspirationCategories = ref<string[]>([])
const inspirationCategory = ref('')
const inspirationPage = ref(1)
const inspirationPageSize = ref(24)
const inspirationTotal = ref(0)
const outputLang = ref<OutputLang>('cn')
const stylePreset = ref<StylePreset>('general')

const DEFAULT_INSPIRATION_CATEGORIES = ['人物', '风景', '动漫', '设计', '创意']
const VALID_REVERSE_STYLES: StylePreset[] = ['general', 'sd_phrase', 'sd_tag', 'mj', 'danbooru']
const TEMPLATE_ANALYSIS_SYSTEM_PROMPT = [
  '你是专业的 AI 生图创意模板设计师。请把用户提供的完整提示词改写成可复用模板，只抽取 3 到 10 个用户真正需要填写的变量。',
  '只返回 JSON，不要 Markdown。JSON 字段：title, description, prompt_template, requires_ref_image, variables。',
  '不要返回 default_size，不要推断或填写图片尺寸、图片比例、宽高比、分辨率、像素尺寸。',
  '如果原提示词里包含图片尺寸、图片比例、宽高比、分辨率、像素尺寸等内容，不要拆成变量或选项，也不要保留在 prompt_template 中。',
  '如果原提示词里包含是否需要上传参考图、参考图要求等内容，只用于判断 requires_ref_image；不要拆成变量或选项，也不要保留在 prompt_template 中。',
  'variables 每项字段：key, label, type, required, placeholder, default, options。type 只能是 text、textarea、select、multi_select。',
  'variables[].key 必须使用小写英文、数字、下划线，只能以英文字母开头，例如 subject、style、scene、product_name；禁止使用中文 key。',
  'prompt_template 中出现的每一个 {{key}} 必须能在 variables 中找到完全一致的 key；variables 中的每一个 key 必须至少在 prompt_template 中出现一次。',
  'prompt_template 用 {{key}} 作为变量占位符，并保留原提示词的主体、风格、构图、材质、光影、质量要求等真正用于生图的描述。',
].join('\n')

const modeItems: Array<{ value: CreateMode; title: string; desc: string }> = [
  { value: 'analyze' as const, title: '提示词 AI 拆解', desc: '从完整提示词生成变量模板' },
  { value: 'image' as const, title: '图片反推创建', desc: '先反推提示词再拆解模板' },
  { value: 'inspiration' as const, title: '从灵感创建', desc: '选择灵感并拆解为模板' },
  { value: 'manual' as const, title: '手动创建', desc: '直接填写模板内容' },
]

const selectedInspiration = computed(() => inspirations.value.find((item) => item.id === selectedInspirationId.value) || null)
const inspirationTotalPages = computed(() => Math.max(1, Math.ceil(inspirationTotal.value / inspirationPageSize.value)))

const ModelPicker = defineComponent({
  props: {
    label: { type: String, required: true },
    cap: { type: String, required: true },
    providerId: { type: String, required: true },
    modelId: { type: String, required: true },
  },
  emits: ['update:providerId', 'update:modelId'],
  setup(p, { emit }) {
    const provider = computed(() => modelStore.providers.find((item) => item.id === p.providerId) || null)
    const groups = computed(() => {
      if (!provider.value) return { recommended: [], others: [] }
      return groupAndSort(provider.value.models, p.cap as ModelCap, {
        cloudTypeOf: (mid) => modelStore.cloudTypeOf(provider.value!.id, mid),
        usageHints: getHintsSync(p.cap as ModelCap, provider.value.id),
      })
    })
    return () => h('label', { class: 'block' }, [
      h('span', { class: 'text-text-secondary' }, p.label),
      h('select', {
        class: 'mt-1 w-full px-3 py-2 border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500',
        value: p.providerId,
        onChange: (e: Event) => {
          emit('update:providerId', (e.target as HTMLSelectElement).value)
          emit('update:modelId', '')
        },
      }, [
        h('option', { value: '' }, '选择服务商'),
        ...modelStore.providers.map((item) => h('option', { value: item.id }, item.name)),
      ]),
      provider.value && provider.value.models.length ? h('select', {
        class: 'mt-2 w-full px-3 py-2 border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500',
        value: p.modelId,
        onChange: (e: Event) => emit('update:modelId', (e.target as HTMLSelectElement).value),
      }, [
        h('option', { value: '' }, '选择模型'),
        groups.value.recommended.length ? h('optgroup', { label: '推荐' }, groups.value.recommended.map((m) => h('option', { value: m }, modelStore.optionLabel(p.providerId, m)))) : null,
      ]) : p.providerId ? h('input', {
        class: 'mt-2 w-full px-3 py-2 border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500',
        value: p.modelId,
        placeholder: '输入模型名称',
        onInput: (e: Event) => emit('update:modelId', (e.target as HTMLInputElement).value),
      }) : null,
    ])
  },
})

function close(): void {
  if (busy.value) return
  emit('update:modelValue', false)
}

function startManual(): void {
  emit('update:modelValue', false)
  emit('manual')
}

async function startAnalyze(): Promise<void> {
  const prompt = promptText.value.trim()
  if (!prompt) {
    error.value = '请先填写完整提示词'
    return
  }
  await createDraftFromPrompt(prompt, { source_type: 'manual' })
}

async function startImageFlow(): Promise<void> {
  if (!reverseImage.value) {
    error.value = '请先上传图片'
    return
  }
  error.value = ''
  busy.value = true
  busyText.value = '正在反推图片提示词...'
  try {
    const prompt = await reverseImageToPrompt(reverseImage.value, reverseHint.value.trim())
    reversePrompt.value = prompt
    busyText.value = '正在拆解为创意模板...'
    const draft = await analyzePrompt(prompt)
    emitDraft({
      ...draftToPayload(draft),
      source_type: 'image',
      source_image: reverseImage.value,
      presetRefImages: [reverseImage.value],
      requiresRefImage: !!draft.requires_ref_image,
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
    busyText.value = ''
  }
}

async function startInspirationFlow(): Promise<void> {
  const item = selectedInspiration.value
  if (!item) {
    error.value = '请先选择灵感'
    return
  }
  const prompt = (item.prompt_cn || item.prompt_en || '').trim()
  if (!prompt) {
    error.value = '该灵感没有可用于拆解的提示词'
    return
  }
  error.value = ''
  busy.value = true
  busyText.value = '正在拆解灵感提示词...'
  try {
    const draft = await analyzePrompt(prompt)
    const refs = ((item.ref_images?.length ? item.ref_images : (item.ref_image ? [item.ref_image] : [])) || []).filter(Boolean).slice(0, 8)
    emitDraft({
      ...draftToPayload(draft),
      source_type: 'inspiration',
      source_inspiration_id: String(item.id || ''),
      source_image: item.cover_image || refs[0] || '',
      presetTitle: item.title || draft.title,
      presetRefImages: refs,
      requiresRefImage: !!draft.requires_ref_image,
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
    busyText.value = ''
  }
}

async function createDraftFromPrompt(prompt: string, extra: Partial<DraftPayload>): Promise<void> {
  error.value = ''
  busy.value = true
  busyText.value = '正在拆解提示词...'
  try {
    const draft = await analyzePrompt(prompt)
    emitDraft({ ...draftToPayload(draft), ...extra })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
    busyText.value = ''
  }
}

function emitDraft(payload: DraftPayload): void {
  emit('update:modelValue', false)
  emit('draft-ready', payload)
}

async function analyzePrompt(prompt: string): Promise<any> {
  if (!chatProviderId.value || !chatModelId.value) throw new Error('请先选择拆解模型')
  const messages = [
    { role: 'system', content: TEMPLATE_ANALYSIS_SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ]
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await (window as any).api.llm.invoke('call', chatProviderId.value, chatModelId.value, messages)
      await recordUsage('chat', chatProviderId.value, chatModelId.value)
      return normalizeDraft(parseJsonResult(result, true), prompt)
    } catch (e) {
      lastError = e
      if (attempt === 0) continue
    }
  }
  if (isDraftParseError(lastError)) {
    throw new Error('AI 拆解失败：返回内容不是有效 JSON，请换用更强的拆解模型或手动创建')
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'AI 拆解失败'))
}

async function reverseImageToPrompt(image: string, hint: string): Promise<string> {
  if (!visionProviderId.value || !visionModelId.value) throw new Error('请先选择视觉模型')
  const lang = getReverseOutputLang()
  const userText = hint ? `${getImage2PromptUserPrompt(lang)}\n补充说明：${hint}` : getImage2PromptUserPrompt(lang)
  const messages = [
    { role: 'system', content: getImage2PromptSystemPrompt(stylePreset.value, lang) },
    { role: 'user', content: [{ type: 'text', text: userText }, { type: 'image_url', image_url: { url: image } }] },
  ]
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await (window as any).api.llm.invoke('call', visionProviderId.value, visionModelId.value, messages)
      await recordUsage('vision', visionProviderId.value, visionModelId.value)
      const text = resultToText(result).trim()
      if (!text) throw new Error('图片反推结果为空')
      return text
    } catch (e) {
      lastError = e
      if (attempt === 0) continue
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || '图片反推失败'))
}

function getReverseOutputLang(): OutputLang {
  return isEnOnly(stylePreset.value) ? 'en' : outputLang.value
}

function parseJsonResult(result: unknown, throwOnFailure = false): any {
  const text = resultToText(result)
  if (!text.trim()) {
    if (throwOnFailure) throw new Error('AI 返回内容为空')
    return {}
  }
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      try { return JSON.parse(match[0]) } catch {}
    }
  }
  if (throwOnFailure) throw new Error('AI 返回内容不是有效 JSON')
  return {}
}

function resultToText(result: unknown): string {
  if (typeof result === 'string') return result
  if (result && typeof result === 'object' && 'content' in result) return String((result as any).content || '')
  return String(result || '')
}

function isDraftParseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.includes('有效 JSON') || message.includes('返回内容为空')
}

function normalizeDraft(raw: any, fallbackPrompt: string): any {
  const normalized = normalizeVariables(Array.isArray(raw?.variables) ? raw.variables : [])
  const sourcePrompt = String(raw?.prompt_template || fallbackPrompt || '')
  const promptTemplate = normalizePromptPlaceholders(stripBuiltInTemplateOptionText(sourcePrompt), normalized)
  const usedKeys = new Set(extractPlaceholders(promptTemplate).filter((key) => /^[a-z][a-z0-9_]*$/.test(key)))
  return {
    title: limitText(raw?.title || guessTitle(fallbackPrompt), 100),
    description: limitText(raw?.description || '由提示词拆解生成的创意模板', 500),
    prompt_template: promptTemplate || fallbackPrompt.trim(),
    default_size: '',
    requires_ref_image: raw?.requires_ref_image === undefined ? detectRequiresRefImage(fallbackPrompt) : !!raw.requires_ref_image,
    variables: normalized.variables.filter((v) => usedKeys.has(v.key)),
  }
}

function normalizeVariables(raw: any[]): NormalizedVariableResult {
  const variables: CreativeTemplateVariable[] = []
  const keyMap = new Map<string, string>()
  const used = new Set<string>()
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== 'object') continue
    if (isBuiltInTemplateOptionVariable(item)) continue
    const rawKey = String(item.key || '').trim()
    const key = normalizeVariableKey(rawKey, `field_${index + 1}`, used)
    if (rawKey) keyMap.set(rawKey, key)
    keyMap.set(key, key)
    let type = String(item.type || 'text') as CreativeTemplateVariable['type']
    if (!['text', 'textarea', 'select', 'multi_select'].includes(type)) type = 'text'
    const options = Array.isArray(item.options) ? item.options.map((v: unknown) => limitText(String(v || '').trim(), 50)).filter(Boolean).slice(0, 20) : []
    if ((type === 'select' || type === 'multi_select') && !options.length) type = 'text'
    variables.push({
      key,
      label: limitText(item.label || key, 30),
      type,
      required: item.required !== false,
      placeholder: limitText(item.placeholder || '', 120),
      default: limitText(item.default || '', 500),
      options,
    })
    if (variables.length >= 10) break
  }
  return { variables, keyMap, usedKeys: used }
}

function normalizePromptPlaceholders(text: string, normalized: NormalizedVariableResult): string {
  return text.replace(/\{\{\s*([^{}\r\n]+?)\s*\}\}/g, (_match, rawName) => {
    const rawKey = String(rawName || '').trim()
    let key = normalized.keyMap.get(rawKey)
    if (!key && normalized.variables.length < 10) {
      key = normalizeVariableKey(rawKey, `field_${normalized.variables.length + 1}`, normalized.usedKeys)
      normalized.keyMap.set(rawKey, key)
      normalized.keyMap.set(key, key)
      normalized.variables.push({
        key,
        label: limitText(rawKey || key, 30),
        type: 'text',
        required: true,
        placeholder: '',
        default: '',
        options: [],
      })
    }
    return key ? `{{${key}}}` : ''
  })
}

function normalizeVariableKey(value: string, fallback: string, used: Set<string>): string {
  let key = value.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_')
  if (!key) key = fallback
  if (!/^[a-z]/.test(key)) key = `field_${key}`
  if (!/^[a-z][a-z0-9_]*$/.test(key)) key = fallback
  const base = key
  let suffix = 2
  while (used.has(key)) {
    key = `${base}_${suffix}`
    suffix++
  }
  used.add(key)
  return key
}

function extractPlaceholders(text: string): string[] {
  return Array.from(text.matchAll(/\{\{\s*([^{}\r\n]+?)\s*\}\}/g))
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean)
}

function isBuiltInTemplateOptionVariable(item: Record<string, unknown>): boolean {
  const key = String(item.key || '').toLowerCase()
  const text = [item.label, item.placeholder, item.default, ...(Array.isArray(item.options) ? item.options : [])].map((v) => String(v || '')).join(' ')
  if (/(^|_)(default_)?(image_)?(size|ratio|aspect|aspect_ratio|resolution|dimension|width|height)(_|$)/i.test(key)) return true
  if (/(^|_)(ref|reference)(_?image)?(_?required)?(_?upload)?(_|$)|requires?_ref_image|upload_ref_image/i.test(key)) return true
  return /((默认)?(生成|图片|画面|输出)?(尺寸|比例|宽高比|长宽比|分辨率)|参考图|参考图片|上传.{0,8}(图片|参考图)|是否.{0,8}参考图|需要.{0,8}参考图)/u.test(text)
}

function stripBuiltInTemplateOptionText(text: string): string {
  const chunks = text
    .split(/[,，;；。\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !isBuiltInTemplateOptionSegment(part))
  return chunks.join('，').trim()
}

function isBuiltInTemplateOptionSegment(segment: string): boolean {
  return /((默认)?(生成|图片|画面|输出)?(尺寸|比例|宽高比|长宽比|分辨率)|\b(aspect\s*ratio|image\s*size|output\s*size|resolution|dimensions?)\b|\b\d+\s*[:：]\s*\d+\b|\b\d{3,5}\s*[x×]\s*\d{3,5}\b|参考图|参考图片|上传.{0,8}(图片|参考图)|reference\s+image|image\s+reference|ref\s+image)/iu.test(segment)
}

function detectRequiresRefImage(text: string): boolean {
  return /(需要|必须|请|上传|提供|使用|基于|参考).{0,12}(参考图|参考图片|图片参考|reference image|ref image|image reference)/iu.test(text)
}

function draftToPayload(draft: any): DraftPayload {
  return {
    presetTitle: draft.title,
    presetDescription: draft.description,
    presetPrompt: draft.prompt_template,
    presetVariables: draft.variables,
    presetSize: draft.default_size,
    requiresRefImage: !!draft.requires_ref_image,
  }
}

function guessTitle(prompt: string): string {
  return limitText(prompt.replace(/\s+/g, ' ').trim() || '创意模板', 30)
}

function limitText(value: unknown, len: number): string {
  return String(value || '').trim().slice(0, len)
}

async function onReverseImageSelected(paths: string[]): Promise<void> {
  const [item] = await loadAsDataUri(paths.slice(0, 1), { maxSize: 1280, quality: 0.85 })
  if (!item) return
  reverseImage.value = item.dataUri
  reversePrompt.value = ''
}

async function loadInspirations(targetPage?: number): Promise<void> {
  inspirationLoading.value = true
  try {
    const wantedPage = targetPage ?? inspirationPage.value
    const result = await (window as any).api.imageGen.invoke('fetchOnlineInspirations', {
      page: wantedPage,
      pageSize: inspirationPageSize.value,
      category: inspirationCategory.value || undefined,
      search: inspirationSearch.value.trim() || undefined,
    })
    const items = Array.isArray(result?.items) ? result.items : []
    inspirations.value = items
    inspirationPage.value = wantedPage
    inspirationTotal.value = typeof result?.total === 'number' ? result.total : items.length
    inspirationCategories.value = Array.isArray(result?.categories)
      ? result.categories.filter(Boolean)
      : DEFAULT_INSPIRATION_CATEGORIES
    if (!items.some((item: InspirationItem) => item.id === selectedInspirationId.value)) {
      selectedInspirationId.value = ''
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    inspirationLoading.value = false
  }
}

function selectInspirationCategory(category: string): void {
  if (inspirationCategory.value === category) return
  inspirationCategory.value = category
  selectedInspirationId.value = ''
  void loadInspirations(1)
}

function goToInspirationPage(page: number): void {
  const target = Math.max(1, Math.min(inspirationTotalPages.value, page))
  if (target === inspirationPage.value || inspirationLoading.value) return
  selectedInspirationId.value = ''
  void loadInspirations(target)
}

function pickDefault(cap: ModelCap): void {
  const providers = modelStore.providers
  const targetProvider = providers.find((provider) => {
    const groups = groupAndSort(provider.models, cap, { cloudTypeOf: (mid) => modelStore.cloudTypeOf(provider.id, mid), usageHints: getHintsSync(cap, provider.id) })
    return groups.recommended.length
  })
  if (!targetProvider) return
  const groups = groupAndSort(targetProvider.models, cap, { cloudTypeOf: (mid) => modelStore.cloudTypeOf(targetProvider.id, mid), usageHints: getHintsSync(cap, targetProvider.id) })
  const model = groups.recommended[0] || ''
  if (cap === 'chat' && !chatProviderId.value) {
    chatProviderId.value = targetProvider.id
    chatModelId.value = model
  }
  if (cap === 'vision' && !visionProviderId.value) {
    visionProviderId.value = targetProvider.id
    visionModelId.value = model
  }
}

async function loadSharedModelSettings(): Promise<void> {
  try {
    const all = (await (window as any).api.settings.invoke('getAll')) as Record<string, string>
    if (all['imagegen_optimize_provider_id']) chatProviderId.value = all['imagegen_optimize_provider_id']
    if (all['imagegen_optimize_model_id']) chatModelId.value = all['imagegen_optimize_model_id']
    if (all['i2p_vision_provider_id']) visionProviderId.value = all['i2p_vision_provider_id']
    if (all['i2p_vision_model_id']) visionModelId.value = all['i2p_vision_model_id']
    const savedLang = all['i2p_output_lang']
    if (savedLang === 'cn' || savedLang === 'en') outputLang.value = savedLang
    const savedStyle = all['i2p_style_preset']
    if (VALID_REVERSE_STYLES.includes(savedStyle as StylePreset)) stylePreset.value = savedStyle as StylePreset
    if (isEnOnly(stylePreset.value)) outputLang.value = 'en'
  } catch {}
}

watch(() => props.modelValue, async (open) => {
  if (!open) return
  error.value = ''
  busy.value = false
  mode.value = 'analyze'
  await Promise.all([modelStore.fetchProviders(), warmHintsCache()])
  await loadSharedModelSettings()
  pickDefault('chat')
  pickDefault('vision')
})

watch(mode, (value) => {
  if (value === 'inspiration' && !inspirations.value.length) void loadInspirations()
})

onMounted(async () => {
  await Promise.all([modelStore.fetchProviders(), warmHintsCache()])
  await loadSharedModelSettings()
  pickDefault('chat')
  pickDefault('vision')
})

watch(chatModelId, (value) => {
  if (!value || !chatProviderId.value) return
  void (window as any).api.settings.invoke('set', 'imagegen_optimize_provider_id', chatProviderId.value)
  void (window as any).api.settings.invoke('set', 'imagegen_optimize_model_id', value)
})

watch(visionModelId, (value) => {
  if (!value || !visionProviderId.value) return
  void (window as any).api.settings.invoke('set', 'i2p_vision_provider_id', visionProviderId.value)
  void (window as any).api.settings.invoke('set', 'i2p_vision_model_id', value)
})

watch(outputLang, (value) => {
  void (window as any).api.settings.invoke('set', 'i2p_output_lang', value)
})

watch(stylePreset, (value) => {
  if (isEnOnly(value) && outputLang.value !== 'en') outputLang.value = 'en'
  void (window as any).api.settings.invoke('set', 'i2p_style_preset', value)
})
</script>
