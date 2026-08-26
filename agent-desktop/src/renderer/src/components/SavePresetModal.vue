<template>
  <div v-if="open" class="fixed inset-0 z-[60] flex items-center justify-center" @click.self="emit('close')">
    <div class="w-[480px] max-w-[calc(100vw-2rem)] bg-surface-0 border border-surface-3 rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] p-5">
      <h3 class="text-sm font-semibold text-text-primary mb-1">{{ title }}</h3>
      <p class="text-[11px] leading-relaxed text-text-tertiary mb-4">{{ hint }}</p>
      <div class="space-y-3">
        <div>
          <label class="text-xs font-medium text-text-secondary mb-1 block">分类</label>
          <select
            v-if="categories.length"
            v-model="form.category_id"
            class="w-full px-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-1 outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">-- 选择分类 --</option>
            <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
          </select>
          <input
            v-else
            v-model="form.newCategory"
            class="w-full px-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-1 outline-none focus:ring-2 focus:ring-primary-500"
            :placeholder="defaultCategoryName"
          />
        </div>
        <div>
          <label class="text-xs font-medium text-text-secondary mb-1 block">名称</label>
          <input
            v-model="form.label"
            class="w-full px-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-1 outline-none focus:ring-2 focus:ring-primary-500"
            placeholder="例如：主图、周报"
          />
        </div>
        <div>
          <label class="text-xs font-medium text-text-secondary mb-1 block">内容</label>
          <PromptTextarea
            v-model="form.content"
            :title="title"
            :height="148"
            :max-length="type === 'image_gen' ? IMAGE_PROMPT_MAX_LENGTH : undefined"
            placeholder="提示词内容..."
            input-class="text-xs"
          />
        </div>
      </div>
      <p v-if="error" class="mt-2 text-[11px] text-red-600">{{ error }}</p>
      <div class="flex gap-2 justify-end mt-4">
        <button type="button" class="btn-secondary text-xs" @click="emit('close')">取消</button>
        <button
          type="button"
          class="btn-primary text-xs"
          :disabled="!canSave || saving"
          @click="save"
        >{{ saving ? '保存中…' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import PromptTextarea from '@/components/PromptTextarea.vue'
import { usePromptPresetStore } from '@/stores/prompt-presets'
import { IMAGE_PROMPT_MAX_LENGTH } from '@shared/prompt-limits'

const props = withDefaults(defineProps<{
  open: boolean
  type?: 'image_gen' | 'chat' | 'persona'
  content?: string
  label?: string
}>(), {
  type: 'image_gen',
  content: '',
  label: ''
})

const emit = defineEmits<{
  close: []
  saved: []
}>()

const store = usePromptPresetStore()
const saving = ref(false)
const error = ref('')
const form = reactive({
  category_id: '',
  newCategory: '',
  label: '',
  content: ''
})

const title = computed(() => {
  if (props.type === 'chat') return '存为对话快捷键'
  if (props.type === 'persona') return '存为人设预设'
  return '存为生图预设'
})
const hint = computed(() => {
  if (props.type === 'chat') return '保存后可从对话输入栏的提示词插入。只存你会反复用的句子。'
  if (props.type === 'persona') return '保存后可在新建专家时套用。写身份、语气和边界，不要写成一次性任务。'
  return '保存后可在 AI 生图里一键套用。品牌色跟当前文件夹走，不必写进预设。'
})
const defaultCategoryName = computed(() => {
  if (props.type === 'chat') return '我的提示词'
  if (props.type === 'persona') return '我的人设'
  return '我的预设'
})
const categories = computed(() => store.categories.filter((c) => c.type === props.type))
const canSave = computed(() => {
  const hasCat = categories.value.length ? !!form.category_id : true
  return !!form.label.trim() && !!form.content.trim() && hasCat
})

function guessLabel(text: string): string {
  const line = String(text || '').replace(/\s+/g, ' ').trim()
  if (!line) return ''
  return line.length <= 20 ? line : `${line.slice(0, 20).trim()}…`
}

async function hydrate() {
  error.value = ''
  await store.fetchAll(props.type)
  form.content = String(props.content || '').trim()
  form.label = String(props.label || '').trim() || guessLabel(form.content)
  form.newCategory = defaultCategoryName.value
  form.category_id = categories.value[0]?.id || ''
}

watch(
  () => props.open,
  (open) => {
    if (open) void hydrate()
  }
)

async function save() {
  if (!canSave.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    let categoryId = form.category_id
    if (!categoryId) {
      const name = form.newCategory.trim() || defaultCategoryName.value
      const cat = await store.createCategory({ type: props.type, name })
      categoryId = cat.id
    }
    await store.createPreset({
      category_id: categoryId,
      type: props.type,
      label: form.label.trim(),
      content: form.content.trim()
    })
    emit('saved')
    emit('close')
  } catch (e: any) {
    error.value = e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}
</script>
