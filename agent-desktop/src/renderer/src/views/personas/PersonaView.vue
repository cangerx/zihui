<template>
  <div :class="embedded ? 'h-full min-h-0 flex flex-col' : 'h-full flex flex-col'">
    <div v-if="embedded" class="flex-shrink-0 px-6 pt-5 pb-3 pr-12 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-base font-semibold text-text-primary">人设规则</h2>
        <p class="text-[11px] text-text-tertiary mt-1 leading-relaxed">系统提示词预设，可绑定到专家</p>
      </div>
      <button class="btn-primary flex-shrink-0" @click="showForm = true; editingId = null; resetForm()">+ 新建人设</button>
    </div>
    <header v-else class="page-header">
      <button class="btn-primary" @click="showForm = true; editingId = null; resetForm()">+ 新建人设</button>
    </header>
    <div :class="embedded ? 'flex-1 min-h-0 overflow-y-auto px-6 pb-5' : 'page-body'">
      <div v-if="showForm" class="max-w-xl mb-6 form-card">
        <div>
          <div class="flex items-center justify-between">
            <label class="form-label">名称</label>
            <button @click="showPresetModal = true" class="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" /></svg>
              选择预设
            </button>
          </div>
          <input v-model="form.name" class="input-field" placeholder="例如: 专业客服" />
        </div>
        <div>
          <label class="form-label">系统提示词</label>
          <PromptTextarea
            v-model="form.system_prompt"
            title="编辑系统提示词"
            :height="176"
            placeholder="描述这个人设的行为方式和规则..."
          />
        </div>

        <!-- Preset Modal -->
        <div v-if="showPresetModal" class="fixed inset-0 z-[110] flex items-center justify-center bg-black/25" @click.self="showPresetModal = false">
          <div class="bg-surface-0 rounded-2xl shadow-[0_0_30px_rgba(0,0,0,0.12)] w-[560px] max-h-[80vh] flex flex-col">
            <div class="p-5 border-b border-surface-3">
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-semibold text-text-primary">选择预设人设</h3>
                <button @click="showPresetModal = false" class="text-text-tertiary hover:text-text-primary">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <input v-model="presetSearch" placeholder="搜索预设..." class="w-full px-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500" />
              <div class="flex flex-wrap gap-1.5 mt-3">
                <button
                  v-for="cat in presetCategories"
                  :key="cat"
                  @click="presetCategory = presetCategory === cat ? '' : cat"
                  :class="['px-2.5 py-1 text-xs rounded-md transition-colors', presetCategory === cat ? 'bg-primary-600 text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3']"
                >{{ cat }}</button>
              </div>
            </div>
            <div class="flex-1 overflow-y-auto p-3 space-y-1">
              <div
                v-for="preset in filteredPresets"
                :key="preset.name"
                @click="applyPreset(preset)"
                class="px-4 py-3 rounded-xl cursor-pointer hover:bg-surface-2 transition-colors group"
              >
                <div class="flex items-center justify-between">
                  <span class="text-sm font-medium text-text-primary group-hover:text-primary-700">{{ preset.name }}</span>
                  <span class="text-xs text-text-tertiary bg-surface-2 px-2 py-0.5 rounded">{{ preset.category }}</span>
                </div>
                <p class="text-xs text-text-tertiary mt-1 line-clamp-2">{{ preset.prompt }}</p>
              </div>
              <div v-if="!filteredPresets.length" class="text-center py-8 text-xs text-text-tertiary">无匹配预设</div>
            </div>
          </div>
        </div>
        <div class="flex gap-3 pt-2">
          <button @click="savePersona" class="btn-primary">{{ editingId ? '更新' : '创建' }}</button>
          <button @click="showForm = false" class="btn-secondary">取消</button>
          <button
            v-if="form.system_prompt.trim()"
            @click="showOptimizeModal = true"
            class="btn-secondary ml-auto text-xs flex items-center gap-1.5"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" /></svg>
            AI 优化提示词
          </button>
        </div>

        <!-- Optimize Modal -->
        <div v-if="showOptimizeModal" class="fixed inset-0 z-[110] flex items-center justify-center bg-black/25" @click.self="showOptimizeModal = false">
          <div class="bg-surface-0 rounded-2xl shadow-[0_0_30px_rgba(0,0,0,0.12)] p-6 w-96 space-y-4">
            <h3 class="text-sm font-semibold text-text-primary">选择 AI 模型优化提示词</h3>
            <div>
              <label class="form-label">服务商</label>
              <select v-model="optimizeProviderId" class="select-field" @change="optimizeModelId = ''">
                <option value="">-- 选择 --</option>
                <option v-for="p in modelStore.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </div>
            <div>
              <label class="form-label">模型</label>
              <select v-model="optimizeModelId" class="select-field" :disabled="!optimizeProviderModels.length">
                <option value="">-- 选择 --</option>
                <optgroup v-if="optimizeModelGroups.recommended.length" label="推荐（对话）">
                  <option v-for="m in optimizeModelGroups.recommended" :key="m" :value="m">{{ modelStore.optionLabel(optimizeProviderId, m) }}</option>
                </optgroup>
              </select>
              <input v-if="optimizeProviderId && !optimizeProviderModels.length" v-model="optimizeModelId" placeholder="输入模型名称" class="input-field mt-2" />
            </div>
            <div v-if="optimizeError" class="text-xs text-red-500">{{ optimizeError }}</div>
            <div class="flex gap-3 justify-end pt-2">
              <button @click="showOptimizeModal = false" class="btn-secondary" :disabled="optimizing">取消</button>
              <button @click="doOptimize" class="btn-primary flex items-center gap-1.5" :disabled="!optimizeProviderId || !optimizeModelId || optimizing">
                <svg v-if="optimizing" class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" /><path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75" /></svg>
                {{ optimizing ? '优化中...' : '开始优化' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="store.personas.length === 0 && !showForm" class="empty-state">
        <div class="w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
          <svg class="w-8 h-8 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
        </div>
        <p class="text-sm font-medium text-text-secondary mb-1">暂无人设规则</p>
        <p class="text-xs">为专家创建不同的人设和行为规则</p>
      </div>

      <div v-else :class="embedded ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-3 gap-3'">
        <div v-for="p in store.personas" :key="p.id" class="card p-5">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center">
                <span class="text-primary-600 text-sm font-bold">{{ p.name.charAt(0) }}</span>
              </div>
              <div class="font-semibold text-sm text-text-primary">{{ p.name }}</div>
            </div>
            <div class="flex gap-1">
              <button @click="editPersona(p)" class="btn-ghost">编辑</button>
              <button @click="store.deletePersona(p.id)" class="btn-danger">删除</button>
            </div>
          </div>
          <div class="text-xs text-text-tertiary whitespace-pre-wrap line-clamp-3 pl-[52px]">{{ p.system_prompt }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { usePersonaStore, type Persona } from '@/stores/personas'
import { useModelStore } from '@/stores/models'
import { usePromptPresetStore } from '@/stores/prompt-presets'
import { groupAndSort } from '@/utils/model-caps'
import { warmHintsCache, getHintsSync, recordUsage } from '@/utils/model-usage-hints'
import builtinPresets from '@/data/persona-presets.json'
import PromptTextarea from '@/components/PromptTextarea.vue'

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const store = usePersonaStore()
const modelStore = useModelStore()
const presetStore = usePromptPresetStore()
const showForm = ref(false)
const editingId = ref<string | null>(null)
const form = ref({ name: '', system_prompt: '' })

const showPresetModal = ref(false)
const presetSearch = ref('')
const presetCategory = ref('')
const allPresets = computed(() => {
  const systemList = (builtinPresets as { name: string; prompt: string; category: string }[]).map((p) => ({
    name: p.name,
    prompt: p.prompt,
    category: p.category,
    source: 'system' as const
  }))
  const userGroups = presetStore.visibleGrouped('persona')
  const userList = userGroups.flatMap((g) =>
    g.items.map((item) => ({
      name: item.label,
      prompt: item.content,
      category: g.name,
      source: 'user' as const
    }))
  )
  return [...userList, ...systemList]
})
const presetCategories = computed(() => Array.from(new Set(allPresets.value.map((p) => p.category))))
const filteredPresets = computed(() => {
  let list = allPresets.value
  if (presetCategory.value) list = list.filter((p) => p.category === presetCategory.value)
  if (presetSearch.value) {
    const q = presetSearch.value.toLowerCase()
    list = list.filter((p) => p.name.toLowerCase().includes(q) || p.prompt.toLowerCase().includes(q))
  }
  return list
})
function applyPreset(preset: { name: string; prompt: string }) {
  form.value.name = preset.name
  form.value.system_prompt = preset.prompt
  showPresetModal.value = false
}

const showOptimizeModal = ref(false)
const optimizeProviderId = ref('')
const optimizeModelId = ref('')
const optimizing = ref(false)
const optimizeError = ref('')

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

function resetForm() { form.value = { name: '', system_prompt: '' } }

function editPersona(p: Persona) {
  editingId.value = p.id
  form.value = { name: p.name, system_prompt: p.system_prompt }
  showForm.value = true
}

async function savePersona() {
  try {
    if (editingId.value) {
      await store.updatePersona(editingId.value, form.value)
    } else {
      await store.createPersona(form.value)
    }
    showForm.value = false
    resetForm()
  } catch (e: any) {
    console.error('savePersona error:', e)
    alert('保存失败: ' + (e?.message || e))
  }
}

const OPTIMIZE_SYSTEM_PROMPT = `你是一个专业的 AI 提示词工程师。请优化以下系统提示词，使其更加清晰、结构化、有效。

优化要求：
1. 保持原始角色定位和核心特征不变
2. 增强指令的明确性和可执行性
3. 补充必要的行为边界和约束条件
4. 优化语言表达，减少歧义
5. 如有角色扮演类提示词，强化人设一致性和防越界规则
6. 保持精炼，重点突出角色定位和核心行为规则，避免冗余描述，但不要过于简要
7. 优化后的提示词控制在 300-500 字以内

请直接输出优化后的提示词，不要包含任何解释或说明。`

async function doOptimize() {
  if (!optimizeProviderId.value || !optimizeModelId.value) return
  optimizing.value = true
  optimizeError.value = ''
  try {
    const messages = [
      { role: 'system', content: OPTIMIZE_SYSTEM_PROMPT },
      { role: 'user', content: form.value.system_prompt }
    ]
    // 保留复合 key 传给 main，main 端按服务商反查 cloud_model_id 精确路由
    const result = (await window.api.llm.invoke('call', optimizeProviderId.value, optimizeModelId.value, messages)) as string
    if (result) {
      form.value.system_prompt = result
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
  await Promise.all([store.fetchPersonas(), modelStore.fetchProviders(), presetStore.fetchAll('persona'), warmHintsCache()])
  hintsTick.value++
})
</script>
