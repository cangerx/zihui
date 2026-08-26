<template>
  <div
    v-if="modelValue"
    class="fixed inset-0 z-50 flex items-center justify-center p-6 pointer-events-none"
  >
    <div
      class="bg-surface-0 rounded-2xl shadow-[0_10px_50px_rgba(0,0,0,0.18)] w-[820px] max-w-[95vw] max-h-[90vh] flex flex-col pointer-events-auto"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-surface-2">
        <h3 class="text-sm font-semibold text-text-primary">{{ template ? '编辑模板' : '新建模板' }}</h3>
        <button class="text-text-tertiary hover:text-text-primary" @click="close">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
        <!-- 基本信息 -->
        <section class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <label class="block">
              <span class="text-text-secondary">标题 <span class="text-error">*</span></span>
              <input v-model="form.title" maxlength="100" class="mt-1 w-full px-3 py-2 border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500" placeholder="例如：商品白底图" />
            </label>
            <label class="block">
              <span class="text-text-secondary">所属分类 <span class="text-error">*</span></span>
              <select v-model="form.category_id" class="mt-1 w-full px-3 py-2 border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500">
                <option value="" disabled>选择分类</option>
                <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
              </select>
            </label>
            <label class="block">
              <span class="text-text-secondary">默认生成尺寸 <span class="text-error">*</span></span>
              <div class="mt-1">
                <ImageSizePicker
                  v-model="sizeChoice"
                  layout="select"
                  allow-none
                  :none-value="NO_SIZE_VALUE"
                  none-label="不指定尺寸"
                  placeholder="请选择尺寸"
                  show-hint
                />
              </div>
            </label>
            <label class="block">
              <span class="text-text-secondary">排序</span>
              <input v-model.number="form.sort_order" type="number" min="0" class="mt-1 w-full px-3 py-2 border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500" />
            </label>
          </div>
          <label class="inline-flex items-center gap-2 text-text-secondary">
            <input type="checkbox" v-model="form.requires_ref_image" />
            <span>使用时要求上传参考图</span>
          </label>
          <label class="block">
            <span class="text-text-secondary">模板描述</span>
            <PromptTextarea
              v-model="form.description"
              title="编辑模板描述"
              :height="72"
              :max-length="500"
              placeholder="一句话介绍模板用途"
            />
          </label>
          <label class="block">
            <span class="text-text-secondary">提示词模板 <span class="text-error">*</span><span class="ml-2 text-text-tertiary">用 {{ PLACEHOLDER_HINT }} 作为占位符</span></span>
            <PromptTextarea
              v-model="form.prompt_template"
              title="编辑提示词模板"
              :height="148"
              :max-length="IMAGE_PROMPT_MAX_LENGTH"
              input-class="font-mono"
              :placeholder="PROMPT_PLACEHOLDER_EXAMPLE"
            />
          </label>
        </section>

        <!-- 变量编辑器 -->
        <section>
          <div class="flex items-center justify-between mb-2">
            <span class="text-text-secondary">变量字段（{{ form.variables.length }}/10）</span>
            <button class="text-primary-600 hover:text-primary-700" :disabled="form.variables.length >= 10" @click="addVariable">+ 添加变量</button>
          </div>
          <div v-if="!form.variables.length" class="p-3 text-center text-text-tertiary bg-surface-2 rounded-lg">未添加变量；提示词将作为固定模板使用</div>
          <div v-for="(v, idx) in form.variables" :key="idx" class="p-3 border border-surface-3 rounded-lg mb-2 space-y-2">
            <div class="flex flex-wrap gap-2">
              <label class="flex-1 min-w-[140px]">
                <span class="text-text-tertiary">key</span>
                <input v-model="v.key" class="mt-0.5 w-full px-2 py-1 border border-surface-3 rounded bg-surface-0 outline-none focus:ring-1 focus:ring-primary-500" placeholder="英文/下划线，例如 subject" />
              </label>
              <label class="flex-1 min-w-[140px]">
                <span class="text-text-tertiary">标签</span>
                <input v-model="v.label" maxlength="30" class="mt-0.5 w-full px-2 py-1 border border-surface-3 rounded bg-surface-0 outline-none focus:ring-1 focus:ring-primary-500" />
              </label>
              <label class="min-w-[120px]">
                <span class="text-text-tertiary">类型</span>
                <select v-model="v.type" class="mt-0.5 w-full px-2 py-1 border border-surface-3 rounded bg-surface-0 outline-none focus:ring-1 focus:ring-primary-500">
                  <option v-for="opt in VARIABLE_TYPES" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </select>
              </label>
              <label class="flex items-center gap-1 self-end pb-1">
                <input type="checkbox" v-model="v.required" />
                <span class="text-text-tertiary">必填</span>
              </label>
              <div class="self-end pb-1 flex items-center gap-1">
                <button class="px-1.5 py-0.5 text-text-tertiary border border-surface-3 rounded hover:bg-surface-1" title="把该变量以占位符形式插入到提示词模板" @click="insertPlaceholder(v.key)">插入</button>
                <button class="px-1.5 py-0.5 text-text-tertiary border border-surface-3 rounded hover:bg-surface-1" :disabled="idx === 0" title="上移" @click="moveVariable(idx, -1)">↑</button>
                <button class="px-1.5 py-0.5 text-text-tertiary border border-surface-3 rounded hover:bg-surface-1" :disabled="idx === form.variables.length - 1" title="下移" @click="moveVariable(idx, 1)">↓</button>
                <button class="px-1.5 py-0.5 text-error border border-surface-3 rounded hover:bg-error/10" title="删除" @click="removeVariable(idx)">×</button>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <label class="flex-1 min-w-[200px]">
                <span class="text-text-tertiary">占位文案</span>
                <input v-model="v.placeholder" maxlength="120" class="mt-0.5 w-full px-2 py-1 border border-surface-3 rounded bg-surface-0 outline-none focus:ring-1 focus:ring-primary-500" />
              </label>
              <label class="flex-1 min-w-[200px]">
                <span class="text-text-tertiary">默认值</span>
                <input v-model="v.default" maxlength="500" class="mt-0.5 w-full px-2 py-1 border border-surface-3 rounded bg-surface-0 outline-none focus:ring-1 focus:ring-primary-500" />
              </label>
            </div>
            <label v-if="v.type === 'select' || v.type === 'multi_select'" class="block">
              <span class="text-text-tertiary">选项（用 / 分隔）</span>
              <input v-model="optionTexts[idx]" class="mt-0.5 w-full px-2 py-1 border border-surface-3 rounded bg-surface-0 outline-none focus:ring-1 focus:ring-primary-500" placeholder="例如 写实 / 国潮 / 极简" />
            </label>
          </div>
        </section>

        <!-- 封面 & 示例图 -->
        <section class="grid grid-cols-2 gap-4">
          <div>
            <p class="text-text-secondary mb-2">封面（可选，单张）</p>
            <div class="flex items-center gap-3">
              <div class="w-24 h-24 rounded-lg bg-surface-2 overflow-hidden flex items-center justify-center border border-surface-3">
                <img v-if="coverPreview" :src="coverPreview" class="w-full h-full object-cover" />
                <span v-else class="text-text-tertiary text-[10px]">未设置</span>
              </div>
              <div class="flex flex-col gap-1.5">
                <button class="px-2.5 py-1 text-xs text-text-secondary border border-surface-3 rounded hover:bg-surface-1" @click="pickCover">选择图片</button>
                <button v-if="coverPreview" class="px-2.5 py-1 text-xs text-error border border-surface-3 rounded hover:bg-error/10" @click="clearCover">清除</button>
              </div>
            </div>
          </div>
          <div>
            <p class="text-text-secondary mb-2">示例参考图（最多 8 张）</p>
            <div class="flex flex-wrap gap-2">
              <div v-for="(ref, idx) in refPreviews" :key="idx" class="relative w-20 h-20 rounded-lg overflow-hidden border border-surface-3 bg-surface-2">
                <img :src="ref" class="w-full h-full object-cover" />
                <button class="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/55 text-white text-xs hover:bg-black/75" @click="removeRef(idx)">×</button>
              </div>
              <button v-if="refPreviews.length < 8" class="w-20 h-20 rounded-lg border border-dashed border-surface-3 text-text-tertiary hover:bg-surface-1 flex items-center justify-center" @click="pickRefs">+</button>
            </div>
          </div>
        </section>

        <!-- 显示开关 + 来源说明 -->
        <section class="flex items-center justify-between text-xs">
          <label class="flex items-center gap-2 text-text-secondary">
            <input type="checkbox" v-model="form.is_visible" />
            <span>显示该模板（关闭后不在卡片列表展示）</span>
          </label>
          <span class="text-text-tertiary">来源：{{ SOURCE_LABEL[form.source_type] || '手动输入' }}</span>
        </section>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-surface-2">
        <button class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-1" @click="close">取消</button>
        <button class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50" :disabled="saving" @click="save">{{ saving ? '保存中...' : '保存' }}</button>
      </div>
    </div>
  </div>
  <ImageSourcePickerDialog
    v-model:visible="imagePickerVisible"
    :title="imagePickerTitle"
    :hint="imagePickerHint"
    :multiple="imagePickerMultiple"
    @select="onImagePickerSelect"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  useCreativeTemplateStore,
  type CreativeTemplate,
  type CreativeTemplateCategory,
  type CreativeTemplateFieldType,
  type CreativeTemplateSource,
  type CreativeTemplateVariable,
  type TemplateInput,
} from '@/stores/creative-templates'
import ImageSizePicker from '@/components/ImageSizePicker.vue'
import ImageSourcePickerDialog from '@/components/ImageSourcePickerDialog.vue'
import PromptTextarea from '@/components/PromptTextarea.vue'
import { loadAsDataUri } from '@/utils/image-source'
import { IMAGE_PROMPT_MAX_LENGTH } from '@shared/prompt-limits'

const props = defineProps<{
  modelValue: boolean
  template: CreativeTemplate | null
  categories: CreativeTemplateCategory[]
  // 由 handoff 透传的草稿预填，新建时使用，编辑时忽略
  pendingDefaultSource: {
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
  } | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'saved'): void
}>()

const store = useCreativeTemplateStore()

const VARIABLE_TYPES: Array<{ value: CreativeTemplateFieldType; label: string }> = [
  { value: 'text', label: '单行' },
  { value: 'textarea', label: '多行' },
  { value: 'select', label: '单选' },
  { value: 'multi_select', label: '多选' },
]

// 字面 {{...}} 无法直接写在 Vue 模板里（会被解析为插值），提取为常量后绑定
const PLACEHOLDER_HINT = '{{变量key}}'
const PROMPT_PLACEHOLDER_EXAMPLE = '例如：高质量电商商品图，{{subject}}，{{style}}风格'
const NO_SIZE_VALUE = '__none__'

const SOURCE_LABEL: Record<string, string> = {
  manual: '手动输入',
  image: '图片反推',
  inspiration: '来自灵感',
}

interface EditorForm {
  category_id: string
  title: string
  description: string
  default_size: string
  requires_ref_image: boolean
  prompt_template: string
  variables: CreativeTemplateVariable[]
  is_visible: boolean
  sort_order: number
  source_type: CreativeTemplateSource
  source_image: string
  source_inspiration_id: string
}

const defaultVariables = (): CreativeTemplateVariable[] => [
  { key: 'subject', label: '主体', type: 'text', required: true, placeholder: '例如：白色运动鞋', default: '', options: [] },
  { key: 'style', label: '风格', type: 'text', required: true, placeholder: '例如：极简风格', default: '', options: [] },
  { key: 'scene', label: '场景', type: 'text', required: true, placeholder: '例如：纯白背景', default: '', options: [] },
]

const form = ref<EditorForm>({
  category_id: '',
  title: '',
  description: '',
  default_size: '',
  requires_ref_image: false,
  prompt_template: '',
  variables: defaultVariables(),
  is_visible: true,
  sort_order: 0,
  source_type: 'manual',
  source_image: '',
  source_inspiration_id: '',
})

const coverData = ref<string>('')
const coverChanged = ref(false)
const refs = ref<string[]>([])
const refsChanged = ref(false)
const optionTexts = ref<string[]>([])
const sizeChoice = ref('')
const saving = ref(false)
type ImagePickerTarget = 'cover' | 'refs'
const imagePickerVisible = ref(false)
const imagePickerTarget = ref<ImagePickerTarget>('cover')
const imagePickerMultiple = ref(false)
const imagePickerTitle = ref('选择图片')
const imagePickerHint = ref('')

const coverPreview = computed(() => {
  if (coverData.value) return resolveImagePath(coverData.value)
  if (!coverChanged.value && props.template?.cover_image) return resolveImagePath(props.template.cover_image)
  return ''
})

const refPreviews = computed(() => refs.value.map(resolveImagePath))

function resolveImagePath(path: string): string {
  if (!path) return ''
  if (/^(https?:|data:|file:|local-file:)/i.test(path)) return path
  return 'local-file://img?p=' + encodeURIComponent(path.replace(/\\/g, '/'))
}

function close(): void {
  if (saving.value) return
  emit('update:modelValue', false)
}

function addVariable(): void {
  if (form.value.variables.length >= 10) return
  const idx = form.value.variables.length + 1
  form.value.variables.push({
    key: `field_${idx}`,
    label: `变量 ${idx}`,
    type: 'text',
    required: true,
    placeholder: '',
    default: '',
    options: [],
  })
  optionTexts.value.push('')
}

function removeVariable(idx: number): void {
  form.value.variables.splice(idx, 1)
  optionTexts.value.splice(idx, 1)
}

function moveVariable(idx: number, dir: -1 | 1): void {
  const target = idx + dir
  if (target < 0 || target >= form.value.variables.length) return
  const list = form.value.variables
  const options = optionTexts.value
  ;[list[idx], list[target]] = [list[target], list[idx]]
  ;[options[idx], options[target]] = [options[target] || '', options[idx] || '']
}

function formatOptionText(options: string[] | undefined): string {
  return (options || []).join(' / ')
}

function parseOptionText(value: string): string[] {
  return value.split('/').map((s) => s.trim()).filter(Boolean).slice(0, 20)
}

function syncOptionTexts(): void {
  optionTexts.value = form.value.variables.map((v) => formatOptionText(v.options))
}

function insertPlaceholder(key: string): void {
  if (!key) return
  const cur = form.value.prompt_template || ''
  const sep = cur && !cur.endsWith(' ') && !cur.endsWith('\n') ? ' ' : ''
  form.value.prompt_template = `${cur}${sep}{{${key}}}`
}

function pickCover(): void {
  imagePickerTarget.value = 'cover'
  imagePickerMultiple.value = false
  imagePickerTitle.value = '选择封面图'
  imagePickerHint.value = '可从电脑选择，也可从图库选择已有图片'
  imagePickerVisible.value = true
}

function clearCover(): void {
  coverData.value = ''
  coverChanged.value = true
}

function pickRefs(): void {
  imagePickerTarget.value = 'refs'
  imagePickerMultiple.value = true
  imagePickerTitle.value = '选择示例参考图'
  imagePickerHint.value = '可多选，最多保留 8 张'
  imagePickerVisible.value = true
}

async function onImagePickerSelect(paths: string[]): Promise<void> {
  if (!paths.length) return
  const images = await loadAsDataUri(paths, { maxSize: 1024, quality: 0.85 })
  if (imagePickerTarget.value === 'cover') {
    if (images[0]?.dataUri) {
      coverData.value = images[0].dataUri
      coverChanged.value = true
    }
    return
  }
  for (const image of images) {
    if (refs.value.length >= 8) break
    const uri = image.dataUri
    if (uri) {
      refs.value.push(uri)
      refsChanged.value = true
    }
  }
}

function removeRef(idx: number): void {
  refs.value.splice(idx, 1)
  refsChanged.value = true
}

async function save(): Promise<void> {
  const errors = validate()
  if (errors.length) {
    alert(errors.join('\n'))
    return
  }
  saving.value = true
  try {
    const payload: Partial<TemplateInput> = {
      category_id: form.value.category_id,
      title: form.value.title.trim(),
      description: form.value.description.trim(),
      default_size: normalizeDefaultSizeForSave(),
      requires_ref_image: form.value.requires_ref_image,
      prompt_template: form.value.prompt_template,
      variables: form.value.variables.map((v, idx) => ({
        ...v,
        key: (v.key || '').trim(),
        label: (v.label || '').trim() || v.key,
        options: v.type === 'select' || v.type === 'multi_select' ? parseOptionText(optionTexts.value[idx] || '') : [],
      })),
      is_visible: form.value.is_visible,
      sort_order: form.value.sort_order || 0,
      source_type: form.value.source_type,
      source_inspiration_id: form.value.source_inspiration_id,
    }
    if (coverChanged.value) payload.cover_image = coverData.value
    if (refsChanged.value) payload.example_ref_images = [...refs.value]
    if (!props.template) {
      // 仅创建时带 source_image，避免编辑时把原图覆盖
      if (form.value.source_image) payload.source_image = form.value.source_image
    }
    if (props.template) {
      await store.updateTemplate(props.template.id, payload)
    } else {
      await store.createTemplate(payload as TemplateInput)
    }
    emit('saved')
  } catch (e: unknown) {
    alert((e instanceof Error ? e.message : String(e)) || '保存失败')
  } finally {
    saving.value = false
  }
}

function validate(): string[] {
  const errors: string[] = []
  if (!form.value.title.trim()) errors.push('请填写标题')
  if (!form.value.category_id) errors.push('请选择分类')
  if (!sizeChoice.value) errors.push('请选择默认生成尺寸或不指定尺寸')
  if (!form.value.prompt_template.trim()) errors.push('请填写提示词模板')
  const keys = new Set<string>()
  for (const v of form.value.variables) {
    const k = (v.key || '').trim()
    if (!k) { errors.push('变量 key 不能为空'); continue }
    if (!/^[a-z][a-z0-9_]*$/.test(k)) { errors.push(`变量 key 只能使用小写英文、数字、下划线，且必须以英文字母开头：${k}`); continue }
    if (keys.has(k)) { errors.push(`变量 key 重复：${k}`); continue }
    keys.add(k)
  }
  const placeholders = extractPlaceholders(form.value.prompt_template)
  const placeholderSet = new Set(placeholders)
  for (const key of placeholders) {
    if (!/^[a-z][a-z0-9_]*$/.test(key)) errors.push(`提示词模板中的占位符不合法：{{${key}}}`)
    if (!keys.has(key)) errors.push(`提示词模板中的占位符没有对应变量：{{${key}}}`)
  }
  for (const key of keys) {
    if (!placeholderSet.has(key)) errors.push(`变量未在提示词模板中使用：${key}`)
  }
  return errors
}

function extractPlaceholders(text: string): string[] {
  return Array.from(text.matchAll(/\{\{\s*([^{}\r\n]+?)\s*\}\}/g))
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean)
}

function normalizeDefaultSizeForSave(): string {
  const value = sizeChoice.value.trim()
  return value === NO_SIZE_VALUE ? '' : value
}

watch(
  () => [props.modelValue, props.template],
  ([open, t]) => {
    if (!open) {
      imagePickerVisible.value = false
      return
    }
    // 进入弹窗时按 template / pendingDefaultSource 重新初始化表单
    const tpl = t as CreativeTemplate | null
    if (tpl) {
      form.value = {
        category_id: tpl.category_id,
        title: tpl.title,
        description: tpl.description,
        default_size: tpl.default_size,
        requires_ref_image: !!tpl.requires_ref_image,
        prompt_template: tpl.prompt_template,
        variables: tpl.variables?.length ? tpl.variables.map((v) => ({ ...v, options: v.options || [] })) : defaultVariables(),
        is_visible: !!tpl.is_visible,
        sort_order: tpl.sort_order || 0,
        source_type: tpl.source_type || 'manual',
        source_image: tpl.source_image,
        source_inspiration_id: tpl.source_inspiration_id,
      }
      sizeChoice.value = tpl.default_size?.trim() || NO_SIZE_VALUE
      coverData.value = ''
      coverChanged.value = false
      refs.value = [...(tpl.example_ref_images || [])]
      refsChanged.value = false
    } else {
      const draft = props.pendingDefaultSource
      form.value = {
        category_id: props.categories[0]?.id || '',
        title: draft?.presetTitle?.slice(0, 100) || '',
        description: draft?.presetDescription?.slice(0, 500) || '',
        default_size: '',
        requires_ref_image: !!draft?.requiresRefImage,
        prompt_template: draft?.presetPrompt || '',
        variables: draft ? (draft.presetVariables || []).map((v) => ({ ...v, options: v.options || [] })) : defaultVariables(),
        is_visible: true,
        sort_order: 0,
        source_type: draft?.source_type || 'manual',
        source_image: draft?.source_image || '',
        source_inspiration_id: draft?.source_inspiration_id || '',
      }
      // 草稿带来的参考图 / 源图：参考图直接显示在示例图区，源图作为反推证据走 source_image
      // refsChanged 设为 true，保存时把参考图带上；若用户不动也能正确入库
      const initialRefs = (draft?.presetRefImages || []).slice(0, 8)
      coverData.value = ''
      coverChanged.value = false
      refs.value = initialRefs
      refsChanged.value = initialRefs.length > 0
      sizeChoice.value = ''
    }
    syncOptionTexts()
  },
  { immediate: true },
)
</script>
