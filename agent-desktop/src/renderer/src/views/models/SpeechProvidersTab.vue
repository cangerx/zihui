<template>
  <div class="h-full min-h-0 flex bg-surface-0">
    <aside class="w-[230px] flex-shrink-0 flex flex-col border-r border-surface-2 px-3 py-3">
      <div class="px-1 pb-3">
        <div class="text-xs font-semibold text-text-secondary">语音供应商</div>
        <div class="mt-0.5 text-[10px] text-text-tertiary">拖拽排序，首位为默认</div>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto space-y-1">
        <button
          v-for="provider in orderedProviders"
          :key="provider.id"
          type="button"
          draggable="true"
          class="w-full rounded-xl px-2.5 py-2.5 text-left transition-colors"
          :class="selectedId === provider.id && view === 'form' ? 'bg-surface-2' : 'hover:bg-surface-1'"
          @click="editProvider(provider)"
          @dragstart="dragId = provider.id"
          @dragover.prevent
          @drop="dropOn(provider.id)"
        >
          <div class="flex items-center gap-2.5">
            <span class="text-text-disabled cursor-grab" aria-hidden="true">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                <circle cx="5" cy="4" r="1.1" /><circle cx="11" cy="4" r="1.1" />
                <circle cx="5" cy="8" r="1.1" /><circle cx="11" cy="8" r="1.1" />
                <circle cx="5" cy="12" r="1.1" /><circle cx="11" cy="12" r="1.1" />
              </svg>
            </span>
            <span class="w-8 h-8 rounded-lg bg-surface-1 flex items-center justify-center text-[11px] font-semibold text-text-secondary">
              {{ presetOf(provider.provider_preset).mark }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-1.5">
                <span class="truncate text-xs font-medium text-text-primary">{{ provider.name }}</span>
                <span v-if="provider.id === defaultId" class="rounded px-1 py-px text-[9px] bg-primary-50 text-primary-700">默认</span>
              </span>
              <span class="block truncate mt-0.5 text-[10px] text-text-tertiary">
                {{ provider.enabled === false ? '已停用' : (provider.models[0] || '未配置模型') }}
              </span>
            </span>
          </div>
        </button>
      </div>

      <button type="button" class="mt-2 w-full rounded-xl bg-surface-1 px-3 py-3 text-left text-xs font-medium text-text-secondary hover:bg-surface-2" @click="showPicker">
        ＋ 添加语音模型
      </button>
    </aside>

    <main class="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div class="flex-1 min-h-0 overflow-y-auto p-4">
        <div v-if="view === 'empty'" class="h-full flex items-center justify-center">
          <div class="max-w-md rounded-2xl bg-amber-50 px-5 py-4 text-[13px] leading-relaxed text-amber-900">
            还没有配置过语音生成的供应商。可以点击「添加语音模型」，配置成功后会出现在左侧列表。
          </div>
        </div>

        <template v-else-if="view === 'picker'">
          <div class="rounded-xl bg-surface-1 px-4 py-3 text-xs font-medium text-text-secondary">
            选择要接入的语音供应商
          </div>
          <div class="grid grid-cols-2 gap-3 mt-4">
            <button
              v-for="preset in PRESETS"
              :key="preset.id"
              type="button"
              class="min-h-[104px] rounded-2xl border border-surface-2 bg-surface-0 px-4 py-4 text-left hover:border-surface-4 hover:bg-surface-1"
              @click="selectPreset(preset)"
            >
              <div class="flex items-center gap-3">
                <span class="w-8 h-8 rounded-lg bg-surface-1 flex items-center justify-center text-xs font-semibold text-text-secondary">{{ preset.mark }}</span>
                <span class="text-sm font-semibold text-text-primary">{{ preset.name }}</span>
              </div>
              <div class="mt-2 text-xs text-text-tertiary">{{ preset.description }}</div>
            </button>
          </div>
        </template>

        <section v-else class="max-w-2xl mx-auto rounded-2xl border border-surface-2 bg-surface-0 p-5">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-sm font-semibold text-text-primary">{{ isNew ? `接入${selectedPreset.name}` : `编辑${form.name}` }}</div>
              <div class="mt-0.5 text-[11px] text-text-tertiary">配置语音模型、密钥和接口地址。密钥仅保存在本机。</div>
            </div>
            <button v-if="!isNew" type="button" class="text-xs text-red-500 hover:text-red-600" @click="removeProvider">删除</button>
          </div>

          <div class="mt-5">
            <label class="form-label">API Key</label>
            <div class="relative">
              <input v-model="form.api_key" :type="showKey ? 'text' : 'password'" class="input-field pr-16" autocomplete="off" placeholder="填写该渠道的 API Key" />
              <button type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-text-tertiary hover:text-text-primary" @click="showKey = !showKey">
                {{ showKey ? '隐藏' : '显示' }}
              </button>
            </div>
          </div>

          <div v-if="selectedPreset.id === 'custom'" class="mt-4">
            <label class="form-label">显示名称</label>
            <input v-model="form.name" class="input-field" />
          </div>

          <div class="mt-4">
            <label class="form-label">模型</label>
            <select v-if="modelOptions.length" v-model="selectedModel" class="select-field">
              <option v-for="model in modelOptions" :key="model.id" :value="model.id">{{ model.label }}</option>
            </select>
            <input v-else v-model="selectedModel" class="input-field text-xs" placeholder="填写模型 ID，例如 tts-1" />
          </div>

          <div class="mt-4">
            <label class="form-label">接口地址</label>
            <input v-model="form.api_base" class="input-field" :placeholder="selectedPreset.apiBase || 'https://example.com/v1'" />
            <p class="mt-1 text-[10px] text-text-tertiary">{{ selectedPreset.apiBase ? '可留空，空白时使用官方默认地址' : '中转或自建服务请填写完整 API 地址' }}</p>
          </div>

          <p class="mt-4 text-[11px] leading-relaxed text-text-tertiary">
            语音由该平台独立计费。云控已配置的解说 TTS 不受这里影响，仍走云端目录。
          </p>

          <div class="mt-5">
            <button type="button" class="btn-primary w-full" :disabled="saving" @click="saveProvider">
              {{ saving ? '保存中…' : (isNew ? '保存并加入列表' : '保存供应商') }}
            </button>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useModelStore, type ModelProvider } from '@/stores/models'

interface ProviderPreset {
  id: string
  name: string
  mark: string
  description: string
  apiBase: string
  adapter: string
  models?: { id: string; label: string }[]
}

const PRESETS: ProviderPreset[] = [
  {
    id: 'openai_tts',
    name: 'OpenAI TTS',
    mark: 'OA',
    description: '官方 /v1/audio/speech，也适用于兼容中转',
    apiBase: 'https://api.openai.com/v1',
    adapter: 'openai_tts',
    models: [
      { id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts' },
      { id: 'tts-1', label: 'tts-1' },
      { id: 'tts-1-hd', label: 'tts-1-hd' },
    ],
  },
  {
    id: 'doubao_tts',
    name: '豆包语音',
    mark: '豆',
    description: '火山 openspeech，接口地址可留空用官方默认',
    apiBase: 'https://openspeech.bytedance.com/api/v1/tts',
    adapter: 'doubao_tts',
    models: [{ id: 'zh_female_1', label: '默认女声 zh_female_1' }],
  },
  {
    id: 'custom',
    name: '自定义渠道',
    mark: '自',
    description: '接入中转或自建 OpenAI 兼容语音接口',
    apiBase: '',
    adapter: 'openai_tts',
  },
]

const store = useModelStore()
const view = ref<'empty' | 'picker' | 'form'>('empty')
const selectedId = ref('')
const selectedPresetId = ref('openai_tts')
const selectedModel = ref('')
const dragId = ref('')
const saving = ref(false)
const showKey = ref(false)
const order = ref<string[]>([])

const form = reactive({
  name: '',
  api_base: '',
  api_key: '',
  protocol_adapter: 'openai_tts',
  models: [] as string[],
  enabled: true,
})

const speechProviders = computed(() => store.providers.filter((provider) => !provider.isCloud && provider.purpose === 'tts'))
const orderedProviders = computed(() => {
  const rank = new Map(order.value.map((id, index) => [id, index]))
  return [...speechProviders.value].sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999))
})
const defaultId = computed(() => orderedProviders.value.find((provider) => provider.enabled !== false)?.id || '')
const isNew = computed(() => !selectedId.value)
const selectedPreset = computed(() => presetOf(selectedPresetId.value))
const modelOptions = computed(() => {
  const known = selectedPreset.value.models || []
  const extras = form.models
    .filter((id) => id && !known.some((model) => model.id === id))
    .map((id) => ({ id, label: id }))
  return [...known, ...extras]
})

function presetOf(id?: string): ProviderPreset {
  return PRESETS.find((preset) => preset.id === id) || PRESETS[PRESETS.length - 1]
}

function readOrder(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('settings.modelListOrder.tts') || '[]')
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeOrder(ids: string[]) {
  order.value = ids
  localStorage.setItem('settings.modelListOrder.tts', JSON.stringify(ids))
}

function showEmptyOrPicker() {
  selectedId.value = ''
  view.value = orderedProviders.value.length ? 'picker' : 'empty'
}

function showPicker() {
  selectedId.value = ''
  view.value = 'picker'
}

function selectPreset(preset: ProviderPreset) {
  selectedId.value = ''
  selectedPresetId.value = preset.id
  const models = (preset.models || []).map((model) => model.id)
  Object.assign(form, { name: preset.name, api_base: preset.apiBase, api_key: '', protocol_adapter: preset.adapter, models, enabled: true })
  selectedModel.value = models[0] || ''
  view.value = 'form'
}

function editProvider(provider: ModelProvider) {
  selectedId.value = provider.id
  selectedPresetId.value = provider.provider_preset || 'custom'
  Object.assign(form, {
    name: provider.name,
    api_base: provider.api_base,
    api_key: provider.api_key,
    protocol_adapter: provider.protocol_adapter || provider.type || 'openai_tts',
    models: [...provider.models],
    enabled: provider.enabled !== false,
  })
  selectedModel.value = provider.models[0] || ''
  view.value = 'form'
}

async function saveProvider() {
  const apiBase = form.api_base.trim() || selectedPreset.value.apiBase
  const name = form.name.trim() || selectedPreset.value.name
  const model = selectedModel.value.trim()
  if (!name || !apiBase) {
    window.alert('请填写供应商名称和接口地址')
    return
  }
  if (!model) {
    window.alert('请选择一个语音模型')
    return
  }
  saving.value = true
  try {
    const payload = {
      name,
      type: form.protocol_adapter,
      api_base: apiBase,
      api_key: form.api_key,
      models: [model],
      purpose: 'tts',
      provider_preset: selectedPresetId.value,
      protocol_adapter: form.protocol_adapter,
      enabled: form.enabled,
      custom_params: [],
      request_override_patch: {},
      system_prompt: '',
    }
    if (selectedId.value) {
      await store.updateProvider(selectedId.value, payload)
    } else {
      const created = await store.createProvider(payload)
      writeOrder([...order.value.filter((id) => id !== created.id), created.id])
      selectedId.value = created.id
    }
    const saved = speechProviders.value.find((provider) => provider.id === selectedId.value)
    if (saved) editProvider(saved)
  } catch (error: any) {
    window.alert(`保存失败：${error?.message || error}`)
  } finally {
    saving.value = false
  }
}

async function removeProvider() {
  if (!selectedId.value || !window.confirm('确定删除这个语音供应商吗？')) return
  const id = selectedId.value
  await store.deleteProvider(id)
  writeOrder(order.value.filter((item) => item !== id))
  showEmptyOrPicker()
}

function dropOn(targetId: string) {
  if (!dragId.value || dragId.value === targetId) return
  const ids = orderedProviders.value.map((provider) => provider.id).filter((id) => id !== dragId.value)
  const index = ids.indexOf(targetId)
  ids.splice(index, 0, dragId.value)
  writeOrder(ids)
  dragId.value = ''
}

onMounted(async () => {
  order.value = readOrder()
  await store.fetchProviders()
  view.value = 'empty'
})
</script>
