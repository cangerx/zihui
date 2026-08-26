<template>
  <div class="h-full min-h-0 flex bg-surface-0">
    <aside class="w-[230px] flex-shrink-0 flex flex-col border-r border-surface-2 px-3 py-3">
      <div class="px-1 pb-3">
        <div class="text-xs font-semibold text-text-secondary">视频供应商</div>
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

        <div v-if="!orderedProviders.length" class="px-3 py-8 text-center text-[11px] leading-relaxed text-text-tertiary">
          还没有本地视频供应商<br />从右侧选择一个渠道开始
        </div>
      </div>

      <button type="button" class="mt-2 w-full rounded-xl bg-surface-1 px-3 py-3 text-left text-xs font-medium text-text-secondary hover:bg-surface-2" @click="showPicker">
        ＋ 添加视频模型
      </button>
    </aside>

    <main class="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div class="flex-1 min-h-0 overflow-y-auto p-4">
        <template v-if="view === 'picker'">
          <div class="rounded-xl bg-surface-1 px-4 py-3 text-xs font-medium text-text-secondary">
            选择要接入的视频供应商
          </div>
          <div class="grid grid-cols-2 gap-3 mt-4">
            <button
              v-for="preset in PRESETS"
              :key="preset.id"
              type="button"
              class="min-h-[104px] rounded-2xl border border-surface-2 bg-surface-0 px-4 py-4 text-left transition-colors"
              :class="preset.disabled ? 'opacity-55 cursor-not-allowed' : 'hover:border-surface-4 hover:bg-surface-1'"
              :disabled="preset.disabled"
              @click="selectPreset(preset)"
            >
              <div class="flex items-center gap-3">
                <span class="w-8 h-8 rounded-lg bg-surface-1 flex items-center justify-center text-xs font-semibold text-text-secondary">{{ preset.mark }}</span>
                <span class="text-sm font-semibold text-text-primary">{{ preset.name }}</span>
                <span v-if="preset.disabled" class="ml-auto text-[10px] text-text-tertiary">契约待验证</span>
              </div>
              <div class="mt-2 text-xs text-text-tertiary">{{ preset.description }}</div>
            </button>
          </div>
        </template>

        <section v-else class="max-w-2xl mx-auto rounded-2xl border border-surface-2 bg-surface-0 p-5">
          <div class="flex items-start justify-between gap-4">
            <div class="flex items-center gap-3">
              <span class="w-10 h-10 rounded-xl bg-surface-1 flex items-center justify-center text-xs font-semibold text-text-secondary">{{ selectedPreset.mark }}</span>
              <div>
                <div class="text-sm font-semibold text-text-primary">{{ isNew ? `接入${selectedPreset.name}` : `编辑${form.name}` }}</div>
                <div class="mt-0.5 text-[11px] text-text-tertiary">第三方服务独立计费，密钥仅保存在本机</div>
              </div>
            </div>
            <button v-if="!isNew" type="button" class="text-xs text-red-500 hover:text-red-600" @click="removeProvider">删除</button>
          </div>

          <p class="mt-2 text-[11px] text-text-tertiary">配置视频模型、密钥和接口地址</p>

          <div class="mt-5">
            <label class="form-label">API Key</label>
            <div class="relative">
              <input v-model="form.api_key" :type="showKey ? 'text' : 'password'" class="input-field pr-16" autocomplete="off" placeholder="填写该渠道的 API Key" />
              <button type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-text-tertiary hover:text-text-primary" @click="showKey = !showKey">
                {{ showKey ? '隐藏' : '显示' }}
              </button>
            </div>
          </div>

          <div v-if="selectedPreset.id === 'custom'" class="grid grid-cols-2 gap-4 mt-4">
            <div>
              <label class="form-label">显示名称</label>
              <input v-model="form.name" class="input-field" />
            </div>
            <div>
              <label class="form-label">协议适配器</label>
              <select v-model="form.protocol_adapter" class="select-field">
                <option value="duomi">多米异步协议</option>
                <option value="likeadmin_tasks">算力超市任务协议</option>
                <option value="dashscope_wan">阿里百炼 Wan 异步协议</option>
                <option value="openai_video">OpenAI 兼容视频</option>
                <option value="volcengine_ark">火山方舟 Seedance</option>
                <option value="minimax_h3">MiniMax H3</option>
              </select>
            </div>
          </div>

          <div class="mt-4">
            <div class="flex items-center justify-between mb-1.5">
              <label class="form-label !mb-0">模型</label>
              <button
                v-if="!useOfficialSelect"
                type="button"
                class="text-[11px] text-primary-600 hover:text-primary-700 disabled:opacity-40"
                :disabled="testing || !(form.api_base || selectedPreset.apiBase)"
                @click="testAndLoad"
              >
                {{ testing ? '连接中…' : '测试连接并拉取模型' }}
              </button>
            </div>
            <select v-if="useOfficialSelect" v-model="selectedModel" class="select-field">
              <option v-for="model in modelOptions" :key="model.id" :value="model.id">{{ model.label }}</option>
            </select>
            <div v-else-if="remoteModels.length" class="max-h-40 overflow-y-auto rounded-xl border border-surface-2 p-2 space-y-1">
              <label v-for="model in remoteModels" :key="model" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-surface-1 cursor-pointer">
                <input v-model="form.models" type="checkbox" :value="model" />
                <span>{{ model }}</span>
              </label>
            </div>
            <input
              v-else
              v-model="modelsText"
              class="input-field text-xs"
              placeholder="填写模型 ID，多个用逗号分隔"
              @blur="applyModelsText"
            />
            <p v-if="testMessage" class="mt-1.5 text-[11px]" :class="testOk ? 'text-primary-700' : 'text-red-500'">{{ testMessage }}</p>
          </div>

          <div class="mt-4">
            <label class="form-label">接口地址</label>
            <input v-model="form.api_base" class="input-field" :placeholder="selectedPreset.apiBase || 'https://example.com'" />
            <p class="mt-1 text-[10px] text-text-tertiary">{{ selectedPreset.apiBase ? '可留空，空白时使用官方默认地址' : '中转或自建服务请填写完整 API 地址' }}</p>
          </div>

          <p class="mt-4 text-[11px] leading-relaxed text-text-tertiary">
            视频由该平台独立计费，生成耗时较长，建议先用短时长、小批量测试。
          </p>

          <div class="mt-4 flex items-center justify-between rounded-xl bg-surface-1 px-3 py-2.5">
            <div>
              <div class="text-xs font-medium text-text-primary">启用供应商</div>
              <div class="text-[10px] text-text-tertiary mt-0.5">停用后保留配置，但不参与视频模型选择</div>
            </div>
            <input v-model="form.enabled" type="checkbox" class="h-4 w-4" />
          </div>

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
  disabled?: boolean
}

const PRESETS: ProviderPreset[] = [
  { id: 'duomi', name: '多米 API', mark: '多', description: '聚合 Seedance、Veo、Grok、Kling 等视频模型', apiBase: 'https://duomiapi.com/v1', adapter: 'duomi' },
  { id: 'likeadmin', name: '算力超市', mark: '算', description: '接入 LikeAdmin Open API 上架的视频模型', apiBase: 'https://api.likeadmin.cn/api/v1', adapter: 'likeadmin_tasks' },
  {
    id: 'jimeng',
    name: '即梦（火山方舟）',
    mark: '即',
    description: '官方 Seedance 2.0 / 2.5，填方舟 API Key 后下拉选择模型',
    apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
    adapter: 'volcengine_ark',
    models: [
      { id: 'doubao-seedance-2-5', label: 'Seedance 2.5' },
      { id: 'doubao-seedance-2-0-260128', label: 'Seedance 2.0' },
      { id: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 Fast' },
    ],
  },
  { id: 'kling', name: '可灵 Kling', mark: '可', description: '可通过多米或算力超市接入；官方直连契约待验证', apiBase: '', adapter: '', disabled: true },
  {
    id: 'minimax',
    name: 'MiniMax H3',
    mark: '海',
    description: '官方 H3 V2，默认国内 api.minimaxi.com，也可改国际站',
    apiBase: 'https://api.minimaxi.com',
    adapter: 'minimax_h3',
    models: [{ id: 'MiniMax-H3', label: 'MiniMax-H3' }],
  },
  { id: 'wan', name: '阿里万相', mark: '万', description: '需填写与 API Key 同地域的百炼 Workspace 地址', apiBase: '', adapter: 'dashscope_wan' },
  { id: 'custom', name: '自定义渠道', mark: '自', description: '接入中转、聚合平台或自建视频服务', apiBase: '', adapter: 'openai_video' }
]

const store = useModelStore()
const view = ref<'picker' | 'form'>('picker')
const selectedId = ref('')
const selectedPresetId = ref('custom')
const dragId = ref('')
const saving = ref(false)
const testing = ref(false)
const testOk = ref(false)
const testMessage = ref('')
const remoteModels = ref<string[]>([])
const modelsText = ref('')
const showKey = ref(false)
const order = ref<string[]>([])

const form = reactive({
  name: '',
  api_base: '',
  api_key: '',
  protocol_adapter: 'openai_video',
  models: [] as string[],
  enabled: true
})
const selectedModel = ref('')

const videoProviders = computed(() => store.providers.filter((provider) => !provider.isCloud && provider.purpose === 'video'))
const orderedProviders = computed(() => {
  const rank = new Map(order.value.map((id, index) => [id, index]))
  return [...videoProviders.value].sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999))
})
const defaultId = computed(() => orderedProviders.value.find((provider) => provider.enabled !== false)?.id || '')
const isNew = computed(() => !selectedId.value)
const selectedPreset = computed(() => presetOf(selectedPresetId.value))
const knownModels = computed(() => selectedPreset.value.models || [])
const useOfficialSelect = computed(() => knownModels.value.length > 0 && remoteModels.value.length === 0)
const modelOptions = computed(() => {
  const known = knownModels.value
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
    const parsed = JSON.parse(localStorage.getItem('settings.modelListOrder.video') || '[]')
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeOrder(ids: string[]) {
  order.value = ids
  localStorage.setItem('settings.modelListOrder.video', JSON.stringify(ids))
}

function showPicker() {
  view.value = 'picker'
  selectedId.value = ''
  testMessage.value = ''
  remoteModels.value = []
}

function selectPreset(preset: ProviderPreset) {
  selectedId.value = ''
  selectedPresetId.value = preset.id
  const models = (preset.models || []).map((model) => model.id)
  Object.assign(form, { name: preset.name, api_base: preset.apiBase, api_key: '', protocol_adapter: preset.adapter, models, enabled: true })
  selectedModel.value = models[0] || ''
  modelsText.value = models.join(',')
  remoteModels.value = []
  testMessage.value = ''
  view.value = 'form'
}

function editProvider(provider: ModelProvider) {
  selectedId.value = provider.id
  selectedPresetId.value = provider.provider_preset || 'custom'
  Object.assign(form, {
    name: provider.name,
    api_base: provider.api_base,
    api_key: provider.api_key,
    protocol_adapter: normalizeLegacyAdapter(provider),
    models: [...provider.models],
    enabled: provider.enabled !== false
  })
  selectedModel.value = provider.models[0] || ''
  modelsText.value = provider.models.join(',')
  remoteModels.value = []
  testMessage.value = ''
  view.value = 'form'
}

function normalizeLegacyAdapter(provider: ModelProvider): string {
  const current = provider.protocol_adapter || provider.type || 'openai_video'
  if (current !== 'wan') return current
  return provider.provider_preset === 'likeadmin' ? 'likeadmin_tasks' : 'dashscope_wan'
}

function applyModelsText() {
  form.models = Array.from(new Set(modelsText.value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)))
}

async function testAndLoad() {
  testing.value = true
  testMessage.value = ''
  testOk.value = false
  try {
    const result = await window.api.model.invoke('fetchRemote', form.api_base, form.api_key, form.protocol_adapter) as string[]
    remoteModels.value = Array.isArray(result) ? result : []
    testOk.value = true
    testMessage.value = remoteModels.value.length ? `连接成功，发现 ${remoteModels.value.length} 个模型` : '连接成功；该渠道未返回可枚举的模型，请手动填写模型 ID'
  } catch (error: any) {
    testMessage.value = error?.message || '连接失败，请检查地址和密钥'
  } finally {
    testing.value = false
  }
}

async function saveProvider() {
  if (useOfficialSelect.value) {
    form.models = selectedModel.value ? [selectedModel.value] : []
  } else if (!remoteModels.value.length) {
    applyModelsText()
  }
  const apiBase = form.api_base.trim() || selectedPreset.value.apiBase
  const name = form.name.trim() || selectedPreset.value.name
  if (!name || !apiBase) {
    window.alert('请填写供应商名称和接口地址')
    return
  }
  if (!form.models.length) {
    window.alert('请选择一个视频模型')
    return
  }
  saving.value = true
  try {
    const payload = {
      name,
      type: form.protocol_adapter,
      api_base: apiBase,
      api_key: form.api_key,
      models: [...form.models],
      purpose: 'video',
      provider_preset: selectedPresetId.value,
      protocol_adapter: form.protocol_adapter,
      enabled: form.enabled,
      custom_params: [],
      request_override_patch: {},
      system_prompt: ''
    }
    if (selectedId.value) {
      await store.updateProvider(selectedId.value, payload)
    } else {
      const created = await store.createProvider(payload)
      writeOrder([...order.value.filter((id) => id !== created.id), created.id])
      selectedId.value = created.id
    }
    const saved = videoProviders.value.find((provider) => provider.id === selectedId.value)
    if (saved) editProvider(saved)
  } catch (error: any) {
    window.alert(`保存失败：${error?.message || error}`)
  } finally {
    saving.value = false
  }
}

async function removeProvider() {
  if (!selectedId.value || !window.confirm('确定删除这个视频供应商吗？')) return
  const id = selectedId.value
  await store.deleteProvider(id)
  writeOrder(order.value.filter((item) => item !== id))
  showPicker()
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
})
</script>
