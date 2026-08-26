<template>
  <div class="h-full flex flex-col">
    <header class="page-header">
      <div class="flex items-center gap-3 min-w-0">
        <h2 class="text-sm font-medium text-text-primary flex-shrink-0">提示词库</h2>
        <div class="flex items-center gap-2">
          <button
            v-for="tab in tabs"
            :key="tab.type"
            @click="activeTab = tab.type"
            :class="['px-3 py-1.5 text-xs rounded-lg transition-colors', activeTab === tab.type ? 'bg-primary-600 text-white font-medium' : 'bg-surface-2 text-text-secondary hover:bg-surface-3']"
          >{{ tab.label }}</button>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button @click="showAddCategory = true" class="btn-secondary text-xs">+ 新建分类</button>
        <div class="relative">
          <button class="btn-primary text-xs" @click="showAddMenu = !showAddMenu">添加提示词</button>
          <div v-if="showAddMenu" class="absolute right-0 top-full mt-1 w-40 py-1 rounded-lg bg-surface-0 border border-surface-3 shadow-modal z-20">
            <button type="button" class="w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-2 hover:text-text-primary" @click="startCreateInChat">对话中创建</button>
            <button type="button" class="w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-2 hover:text-text-primary" @click="openManualForm">手动填写</button>
          </div>
        </div>
      </div>
    </header>

    <div class="flex-1 flex overflow-hidden">
      <!-- Left: Category List -->
      <aside class="w-44 flex-shrink-0 border-r border-surface-3 bg-surface-0 flex flex-col">
        <div class="flex-1 overflow-y-auto px-2 py-2">
          <div
            @click="selectedCategoryId = ''"
            :class="['px-3 py-2 text-xs cursor-pointer rounded-lg mb-0.5 transition-all', !selectedCategoryId ? 'bg-primary-50 text-primary-700 font-medium' : 'text-text-secondary hover:bg-surface-2']"
          >全部</div>
          <div
            v-for="cat in currentCategories"
            :key="cat.id"
            @click="selectedCategoryId = cat.id"
            :class="['px-3 py-2 text-xs cursor-pointer rounded-lg mb-0.5 flex items-center justify-between group transition-all', selectedCategoryId === cat.id ? 'bg-primary-50 text-primary-700 font-medium' : 'text-text-secondary hover:bg-surface-2']"
          >
            <span class="truncate">{{ cat.name }}</span>
            <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
              <button @click.stop="startEditCategory(cat)" class="p-0.5 text-text-tertiary hover:text-text-primary transition-colors" title="编辑">
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" /></svg>
              </button>
              <button @click.stop="confirmDeleteCategory(cat)" class="p-0.5 text-text-tertiary hover:text-red-500 transition-colors" title="删除">
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
              </button>
            </div>
          </div>
          <div v-if="!currentCategories.length" class="px-3 py-4 text-[10px] text-text-disabled text-center">暂无分类</div>
        </div>
      </aside>

      <!-- Right: Preset List -->
      <div class="flex-1 overflow-y-auto p-4">
        <div v-if="!filteredPresets.length" class="flex flex-col items-center justify-center py-16">
          <div class="w-14 h-14 rounded-2xl bg-surface-2 flex items-center justify-center mb-3">
            <svg class="w-7 h-7 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          </div>
          <p class="text-sm font-medium text-text-secondary mb-1">暂无提示词</p>
          <p class="text-xs text-text-tertiary">可在对话里生成再保存，或手动填写</p>
        </div>

        <div v-else class="grid grid-cols-3 gap-3">
          <div
            v-for="preset in filteredPresets"
            :key="preset.id"
            class="group relative p-3 rounded-xl border border-surface-3 hover:border-primary-300 transition-colors"
            :class="preset.hidden ? 'opacity-50' : ''"
          >
            <div class="flex items-start justify-between mb-1">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-xs font-medium text-text-primary truncate">{{ preset.label }}</span>
                <span v-if="preset.is_builtin" class="flex-shrink-0 text-[8px] px-1 py-0.5 bg-surface-2 text-text-tertiary rounded">内置</span>
              </div>
              <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0 ml-2">
                <button v-if="preset.is_builtin" @click="toggleHidden(preset)" class="p-1 text-text-tertiary hover:text-text-primary rounded transition-colors" :title="preset.hidden ? '显示' : '隐藏'">
                  <svg v-if="!preset.hidden" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                  <svg v-else class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                </button>
                <template v-if="!preset.is_builtin">
                  <button @click="startEditPreset(preset)" class="p-1 text-text-tertiary hover:text-text-primary rounded transition-colors" title="编辑">
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" /></svg>
                  </button>
                  <button @click="confirmDeletePreset(preset)" class="p-1 text-text-tertiary hover:text-red-500 rounded transition-colors" title="删除">
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                  </button>
                </template>
              </div>
            </div>
            <div class="text-[11px] text-text-secondary line-clamp-2">{{ preset.content }}</div>
            <div class="mt-1.5 text-[10px] text-text-tertiary">{{ getCategoryName(preset.category_id) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add/Edit Category Modal -->
    <div v-if="showAddCategory || editingCategory" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="closeCategory">
      <div class="w-80 bg-surface-0 border border-surface-3 rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] p-5">
        <h3 class="text-sm font-semibold text-text-primary mb-4">{{ editingCategory ? '编辑分类' : '新建分类' }}</h3>
        <input
          v-model="categoryForm.name"
          class="w-full px-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-1 outline-none focus:ring-2 focus:ring-primary-500 mb-4"
          placeholder="分类名称"
          @keydown.enter="saveCategory"
        />
        <div class="flex gap-2 justify-end">
          <button @click="closeCategory" class="btn-secondary text-xs">取消</button>
          <button @click="saveCategory" class="btn-primary text-xs" :disabled="!categoryForm.name.trim()">{{ editingCategory ? '更新' : '创建' }}</button>
        </div>
      </div>
    </div>

    <!-- Add/Edit Preset Modal -->
    <div v-if="showAddPreset || editingPreset" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="closePreset">
      <div class="w-[480px] bg-surface-0 border border-surface-3 rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] p-5">
        <h3 class="text-sm font-semibold text-text-primary mb-4">{{ editingPreset ? '编辑提示词' : '新建提示词' }}</h3>
        <div class="space-y-3">
          <div>
            <label class="text-xs font-medium text-text-secondary mb-1 block">分类</label>
            <select v-model="presetForm.category_id" class="w-full px-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-1 outline-none focus:ring-2 focus:ring-primary-500">
              <option value="">-- 选择分类 --</option>
              <option v-for="cat in currentCategories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
            </select>
          </div>
          <div>
            <label class="text-xs font-medium text-text-secondary mb-1 block">名称</label>
            <input v-model="presetForm.label" class="w-full px-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-1 outline-none focus:ring-2 focus:ring-primary-500" placeholder="提示词名称" />
          </div>
          <div>
            <label class="text-xs font-medium text-text-secondary mb-1 block">内容</label>
            <PromptTextarea
              v-model="presetForm.content"
              title="编辑提示词内容"
              :height="148"
              :max-length="activeTab === 'image_gen' ? IMAGE_PROMPT_MAX_LENGTH : undefined"
              placeholder="提示词内容..."
              input-class="text-xs"
            />
          </div>
        </div>
        <div class="flex items-center justify-between mt-4">
          <button @click="showOptimizeModal = true" :disabled="!presetForm.content.trim()" class="text-[11px] text-primary-600 hover:text-primary-700 disabled:text-text-disabled disabled:cursor-not-allowed transition-colors">Ai优化提示词</button>
          <div class="flex gap-2">
            <button @click="closePreset" class="btn-secondary text-xs">取消</button>
            <button @click="savePreset" class="btn-primary text-xs" :disabled="!presetForm.label.trim() || !presetForm.content.trim() || !presetForm.category_id">{{ editingPreset ? '更新' : '创建' }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- AI Optimize Modal -->
    <div v-if="showOptimizeModal" class="fixed inset-0 z-[60] flex items-center justify-center" @click.self="showOptimizeModal = false">
      <div class="w-80 bg-surface-0 border border-surface-3 rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] p-5">
        <h3 class="text-sm font-semibold text-text-primary mb-4">AI 优化提示词</h3>
        <div class="space-y-3">
          <div>
            <label class="text-xs font-medium text-text-secondary mb-1 block">服务商</label>
            <select v-model="optimizeProviderId" @change="optimizeModelId = ''" class="w-full px-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-1 outline-none focus:ring-2 focus:ring-primary-500">
              <option value="">-- 选择服务商 --</option>
              <option v-for="p in languageProviders" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <div>
            <label class="text-xs font-medium text-text-secondary mb-1 block">模型</label>
            <select v-model="optimizeModelId" class="w-full px-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-1 outline-none focus:ring-2 focus:ring-primary-500" :disabled="!optimizeProviderModels.length">
              <option value="">-- 选择模型 --</option>
              <optgroup v-if="optimizeModelGroups.recommended.length" label="推荐（对话）">
                <option v-for="m in optimizeModelGroups.recommended" :key="m" :value="m">{{ modelStore.optionLabel(optimizeProviderId, m) }}</option>
              </optgroup>
            </select>
            <input v-if="optimizeProviderId && !optimizeProviderModels.length" v-model="optimizeModelId" placeholder="输入模型名称" class="w-full mt-2 px-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-1 outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
        </div>
        <div v-if="optimizeError" class="mt-2 text-[10px] text-red-500">{{ optimizeError }}</div>
        <div class="flex gap-2 justify-end mt-4">
          <button @click="showOptimizeModal = false" class="btn-secondary text-xs">取消</button>
          <button @click="doOptimize" class="btn-primary text-xs" :disabled="!optimizeProviderId || !optimizeModelId || optimizing">{{ optimizing ? '优化中...' : '开始优化' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePromptPresetStore, type PromptCategory, type PromptPreset } from '@/stores/prompt-presets'
import { useModelStore } from '@/stores/models'
import { groupAndSort } from '@/utils/model-caps'
import { warmHintsCache, getHintsSync, recordUsage } from '@/utils/model-usage-hints'
import PromptTextarea from '@/components/PromptTextarea.vue'
import { IMAGE_PROMPT_MAX_LENGTH } from '@shared/prompt-limits'

const route = useRoute()
const router = useRouter()
const store = usePromptPresetStore()
const modelStore = useModelStore()

const TABS: { label: string; type: string }[] = [
  { label: 'AI 生图预设', type: 'image_gen' },
  { label: '对话快捷键', type: 'chat' },
  { label: '人设规则预设', type: 'persona' }
]

const tabs = TABS

const activeTab = ref('image_gen')
const selectedCategoryId = ref('')

function applyTypeFromQuery() {
  const t = route.query.type
  if (typeof t === 'string' && TABS.some((tab) => tab.type === t)) {
    activeTab.value = t
  }
}

watch(activeTab, () => { selectedCategoryId.value = '' })
watch(() => route.query.type, applyTypeFromQuery, { immediate: true })

const currentCategories = computed(() =>
  store.categories.filter((c) => c.type === activeTab.value)
)

const filteredPresets = computed(() => {
  let list = store.presets.filter((p) => p.type === activeTab.value)
  if (selectedCategoryId.value) {
    list = list.filter((p) => p.category_id === selectedCategoryId.value)
  }
  return list
})

function getCategoryName(categoryId: string): string {
  const cat = store.categories.find((c) => c.id === categoryId)
  return cat?.name || ''
}

// === Category Form ===
const showAddCategory = ref(false)
const editingCategory = ref<PromptCategory | null>(null)
const categoryForm = ref({ name: '' })

function startEditCategory(cat: PromptCategory) {
  editingCategory.value = cat
  categoryForm.value = { name: cat.name }
}

function closeCategory() {
  showAddCategory.value = false
  editingCategory.value = null
  categoryForm.value = { name: '' }
}

async function saveCategory() {
  if (!categoryForm.value.name.trim()) return
  if (editingCategory.value) {
    await store.updateCategory(editingCategory.value.id, { name: categoryForm.value.name })
  } else {
    await store.createCategory({ type: activeTab.value, name: categoryForm.value.name })
  }
  closeCategory()
}

async function confirmDeleteCategory(cat: PromptCategory) {
  const count = store.presets.filter((p) => p.category_id === cat.id).length
  const msg = count > 0
    ? `删除分类"${cat.name}"将同时删除其下 ${count} 条提示词，确定删除？`
    : `确定删除分类"${cat.name}"？`
  if (!confirm(msg)) return
  await store.deleteCategory(cat.id)
  if (selectedCategoryId.value === cat.id) selectedCategoryId.value = ''
}

// === Preset Form ===
const showAddPreset = ref(false)
const showAddMenu = ref(false)
const editingPreset = ref<PromptPreset | null>(null)
const presetForm = ref({ category_id: '', label: '', content: '' })

function startCreateInChat() {
  showAddMenu.value = false
  router.push({ path: '/chat', query: { new: '1', createPrompt: '1', promptType: activeTab.value } })
}

function openManualForm() {
  showAddMenu.value = false
  showAddPreset.value = true
}

function startEditPreset(preset: PromptPreset) {
  editingPreset.value = preset
  presetForm.value = {
    category_id: preset.category_id,
    label: preset.label,
    content: preset.content
  }
}

function closePreset() {
  showAddPreset.value = false
  editingPreset.value = null
  presetForm.value = { category_id: '', label: '', content: '' }
}

async function savePreset() {
  if (!presetForm.value.label.trim() || !presetForm.value.content.trim() || !presetForm.value.category_id) return
  if (editingPreset.value) {
    await store.updatePreset(editingPreset.value.id, presetForm.value)
  } else {
    await store.createPreset({
      type: activeTab.value,
      ...presetForm.value
    })
  }
  closePreset()
}

async function confirmDeletePreset(preset: PromptPreset) {
  if (!confirm(`确定删除"${preset.label}"？`)) return
  await store.deletePreset(preset.id)
}

async function toggleHidden(preset: PromptPreset) {
  await store.updatePreset(preset.id, { hidden: preset.hidden ? 0 : 1 })
}

// === AI Optimize ===
const showOptimizeModal = ref(false)
const optimizeProviderId = ref('')
const optimizeModelId = ref('')
const optimizing = ref(false)
const optimizeError = ref('')

const languageProviders = computed(() => modelStore.providers)
const hintsTick = ref(0)
const optimizeProvider = computed(() =>
  modelStore.providers.find((p) => p.id === optimizeProviderId.value) || null
)
const optimizeProviderModels = computed(() => optimizeProvider.value?.models || [])
const optimizeModelGroups = computed(() => {
  hintsTick.value
  if (!optimizeProvider.value) return { recommended: [], others: [] }
  return groupAndSort(optimizeProvider.value.models, 'chat', {
    cloudTypeOf: (mid) => modelStore.cloudTypeOf(optimizeProvider.value!.id, mid),
    usageHints: getHintsSync('chat', optimizeProvider.value.id)
  })
})

const OPTIMIZE_SYSTEM_PROMPT = `你是一个专业的 AI 提示词工程师。请优化以下提示词，使其更加清晰、有效。

优化要求：
1. 保持原始意图和核心功能不变
2. 增强指令的明确性和可执行性
3. 优化语言表达，减少歧义
4. 保持精炼，重点突出，避免冗余
5. 根据提示词类型适当调整风格

请直接输出优化后的提示词，不要包含任何解释或说明。`

async function doOptimize() {
  if (!optimizeProviderId.value || !optimizeModelId.value || !presetForm.value.content.trim()) return
  optimizing.value = true
  optimizeError.value = ''
  try {
    const messages = [
      { role: 'system', content: OPTIMIZE_SYSTEM_PROMPT },
      { role: 'user', content: presetForm.value.content }
    ]
    // 保留复合 key（`model_id#@provider_name`）传给 main，main 端 callLLM 内部按服务商反查 cloud_model_id 精确路由
    const result = (await (window as any).api.llm.invoke('call', optimizeProviderId.value, optimizeModelId.value, messages)) as string
    if (result) {
      presetForm.value.content = result
      showOptimizeModal.value = false
      await recordUsage('chat', optimizeProviderId.value, optimizeModelId.value)
      hintsTick.value++
    } else {
      optimizeError.value = 'AI 返回了空结果'
    }
  } catch (e: any) {
    optimizeError.value = e?.message || '优化失败'
  } finally {
    optimizing.value = false
  }
}

onMounted(async () => {
  await Promise.all([store.fetchAll(), modelStore.fetchProviders(), warmHintsCache()])
  hintsTick.value++

  // Auto-open create modal when navigated here with ?action=create
  // (e.g. from Image2PromptView "存入预设")
  const q = route.query
  if (q.action === 'create' && typeof q.content === 'string' && q.content) {
    const requestedType = (typeof q.type === 'string' ? q.type : '') || 'image_gen'
    if (TABS.some(t => t.type === requestedType)) {
      activeTab.value = requestedType
    }
    presetForm.value = { category_id: '', label: '', content: q.content }
    showAddPreset.value = true
    // Clear the query so back/forward navigation doesn't re-trigger the modal
    router.replace({ path: '/prompts', query: {} })
  }
})
</script>
