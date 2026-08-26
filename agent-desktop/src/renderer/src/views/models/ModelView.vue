<template>
  <div class="h-full min-h-0 flex bg-surface-1/60">
    <!-- 左：服务商列表 -->
    <div class="w-[248px] flex-shrink-0 flex flex-col border-r border-surface-2 bg-surface-0/40">
      <div class="px-3 pt-3 pb-2">
        <div class="text-[11px] font-medium text-text-secondary">
          {{ mode === 'image' ? '生图供应商' : '启用的模型' }}
        </div>
        <div v-if="mode === 'image'" class="text-[10px] text-text-tertiary mt-0.5">
          拖拽排序，首位为默认
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-1">
        <button
          v-for="item in listedItems"
          :key="item.id"
          type="button"
          draggable="true"
          class="w-full text-left rounded-xl px-2 py-2 transition-colors"
          :class="selectedId === item.id
            ? 'bg-surface-2'
            : 'hover:bg-surface-1'"
          @click="selectItem(item.id)"
          @dragstart="onDragStart(item.id, $event)"
          @dragover.prevent
          @drop="onDrop(item.id, $event)"
        >
          <div class="flex items-start gap-2">
            <span class="mt-1.5 text-text-disabled cursor-grab flex-shrink-0" aria-hidden="true">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                <circle cx="5" cy="5" r="1.2" /><circle cx="11" cy="5" r="1.2" />
                <circle cx="5" cy="11" r="1.2" /><circle cx="11" cy="11" r="1.2" />
              </svg>
            </span>
            <div
              class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-semibold"
              :class="item.isCloud ? 'bg-primary-50 text-primary-700' : 'bg-surface-2 text-text-secondary'"
            >
              {{ item.initial }}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-medium text-text-primary truncate">{{ item.name }}</span>
                <span
                  v-if="item.id === defaultItemId"
                  class="flex-shrink-0 text-[10px] px-1.5 py-px rounded-md bg-primary-50 text-primary-700"
                >{{ mode === 'image' ? '默认生图' : '默认' }}</span>
              </div>
              <div class="text-[10px] text-text-tertiary truncate mt-0.5">{{ item.subtitle }}</div>
            </div>
          </div>
        </button>
        <div v-if="!listedItems.length && !isAdding" class="px-2 py-8 text-[11px] text-text-tertiary text-center leading-relaxed">
          {{ mode === 'image' ? '还没有生图模型' : '还没有文本模型' }}
        </div>
      </div>
      <div class="flex-shrink-0 px-3 py-2 border-t border-surface-2">
        <button
          v-if="cloudAuth.permissions.allow_custom_provider"
          type="button"
          class="w-full text-left text-xs text-text-secondary hover:text-text-primary py-1.5"
          @click="startAdd"
        >{{ mode === 'image' ? '+ 添加生图模型' : '+ 添加模型' }}</button>
      </div>
    </div>

    <!-- 右：详情 -->
    <div class="flex-1 min-w-0 overflow-y-auto p-5">
      <!-- 云端托管 -->
      <div v-if="selectedIsCloud" class="rounded-2xl border border-surface-2 bg-surface-0 p-5 max-w-xl">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-9 h-9 rounded-xl bg-primary-50 text-primary-700 flex items-center justify-center text-xs font-semibold">云</div>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-text-primary">云端模型</span>
              <span class="text-[10px] px-1.5 py-px rounded-md bg-primary-50 text-primary-700">托管</span>
            </div>
            <p class="text-[11px] text-text-tertiary mt-0.5">
              由套餐开通，登录即用、按{{ tokenLabel }}计费，无需配置 Key
            </p>
          </div>
        </div>
        <div class="mt-4 rounded-xl bg-surface-1 px-3 py-3">
          <div class="text-[11px] font-medium text-text-secondary mb-2">
            {{ mode === 'image' ? '生图模型目录' : '文本模型目录' }}
          </div>
          <p class="text-[10px] text-text-tertiary mb-2">价格单位：{{ tokenLabel }}。开通情况以钱包 / 套餐为准。</p>
          <div v-if="cloudCatalog.length" class="flex flex-wrap gap-1.5">
            <span
              v-for="m in cloudCatalog"
              :key="m.key"
              class="px-2 py-0.5 rounded-md bg-surface-0 text-[11px] text-text-secondary border border-surface-2"
            >{{ m.label }}</span>
          </div>
          <p v-else class="text-[11px] text-text-tertiary">当前套餐未包含此类模型</p>
        </div>
      </div>

      <!-- 添加：国内渠道卡片 -->
      <div v-else-if="isAdding && addView === 'picker'" class="max-w-3xl">
        <div class="rounded-xl bg-surface-1 px-4 py-3 text-xs font-medium text-text-secondary">
          {{ mode === 'image' ? '选择要接入的生图渠道' : '选择要接入的国内渠道' }}
        </div>
        <div class="grid grid-cols-2 gap-3 mt-4">
          <button
            v-for="preset in channelPresets"
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
      </div>

      <!-- 新建 / 编辑 BYOK -->
      <div v-else-if="isAdding || selectedLocal" class="rounded-2xl border border-surface-2 bg-surface-0 p-5 max-w-xl space-y-4">
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <button
              v-if="isAdding"
              type="button"
              class="text-[11px] text-text-tertiary hover:text-text-primary"
              @click="showPicker"
            >返回</button>
            <div class="w-9 h-9 rounded-xl bg-surface-2 text-text-secondary flex items-center justify-center text-xs font-semibold">
              {{ (form.name || selectedPreset.mark || '?').charAt(0).toUpperCase() }}
            </div>
            <div class="min-w-0">
              <input
                v-model="form.name"
                class="input-field !py-1 !text-sm font-semibold"
                placeholder="服务商名称，例如 DeepSeek"
                @blur="persistIfExisting"
              />
              <a
                v-if="apiKeyDocsUrl"
                :href="apiKeyDocsUrl"
                class="inline-flex items-center gap-1 mt-1 text-[11px] text-primary-600 hover:text-primary-700"
                @click.prevent="openDocs"
              >
                去获取 API 密钥
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
              </a>
            </div>
          </div>
          <button
            v-if="editingId"
            type="button"
            class="text-[11px] text-red-500 hover:text-red-600"
            @click="removeCurrent"
          >删除</button>
        </div>

        <div>
          <label class="form-label">API 密钥</label>
          <div class="flex gap-2">
            <div class="relative flex-1">
              <input
                v-model="form.api_key"
                :type="showKey ? 'text' : 'password'"
                class="input-field pr-9"
                autocomplete="off"
                placeholder="填写该渠道的 API Key"
                @blur="persistIfExisting"
              />
              <button
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
                @click="showKey = !showKey"
              >
                <svg v-if="!showKey" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 12s3.75-7.5 9.75-7.5S21.75 12 21.75 12s-3.75 7.5-9.75 7.5S2.25 12 2.25 12z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                <svg v-else class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 3l18 18M10.5 10.7A3 3 0 0012 15a3 3 0 002.6-1.5M9.9 4.2A10.4 10.4 0 0112 4.5c6 0 9.75 7.5 9.75 7.5a18.1 18.1 0 01-2.2 3.1M6.2 6.2C3.9 7.9 2.25 12 2.25 12A18.4 18.4 0 008.1 16.7" /></svg>
              </button>
            </div>
          </div>
        </div>

        <div>
          <label class="form-label">接口地址</label>
          <input
            v-model="form.api_base"
            class="input-field"
            :placeholder="selectedPreset.apiBase || 'https://api.openai.com/v1'"
            @blur="persistIfExisting"
          />
          <p class="text-[10px] text-text-tertiary mt-1">
            {{ selectedPreset.apiBase ? '可留空，空白时使用官方默认地址' : '中转或自建服务请填写完整 API 地址' }}
          </p>
        </div>

        <div v-if="!useOfficialSelect && form.type !== 'duomi'">
          <label class="form-label">API 格式</label>
          <div class="inline-flex flex-wrap p-0.5 rounded-full bg-surface-2">
            <button
              v-if="mode !== 'image'"
              type="button"
              class="px-3 py-1.5 text-xs rounded-full"
              :class="form.type === 'anthropic' ? 'bg-surface-0 shadow-sm text-text-primary' : 'text-text-secondary'"
              @click="setType('anthropic')"
            >Anthropic 格式</button>
            <button
              type="button"
              class="px-3 py-1.5 text-xs rounded-full"
              :class="form.type === 'openai_compatible' ? 'bg-surface-0 shadow-sm text-text-primary' : 'text-text-secondary'"
              @click="setType('openai_compatible')"
            >OpenAI 兼容</button>
            <button
              type="button"
              class="px-3 py-1.5 text-xs rounded-full"
              :class="form.type === 'openai' ? 'bg-surface-0 shadow-sm text-text-primary' : 'text-text-secondary'"
              @click="setType('openai')"
            >OpenAI 格式</button>
          </div>
        </div>

        <div v-if="mode === 'image' && !useOfficialSelect">
          <label class="form-label">调用方式</label>
          <div class="inline-flex p-0.5 rounded-full bg-surface-2">
            <span
              class="px-3 py-1.5 text-xs rounded-full"
              :class="form.type !== 'duomi' ? 'bg-surface-0 shadow-sm text-text-primary' : 'text-text-secondary'"
            >自动识别</span>
            <span
              class="px-3 py-1.5 text-xs rounded-full"
              :class="form.type === 'duomi' ? 'bg-surface-0 shadow-sm text-text-primary' : 'text-text-secondary'"
            >异步任务</span>
          </div>
          <p class="text-[10px] text-text-tertiary mt-1.5">多米等异步通道会走任务轮询；其余按同步识别。</p>
        </div>

        <div>
          <label class="form-label">{{ useOfficialSelect ? '模型' : '模型优先级（至少添加一个）' }}</label>
          <div v-if="form.type === 'duomi'" class="text-xs">
            <div class="flex items-center justify-between px-3 py-2 rounded-xl bg-surface-1">
              <span>主模型</span>
              <span class="font-medium text-text-primary">gpt-image-2</span>
            </div>
          </div>
          <div v-else-if="useOfficialSelect">
            <select v-model="primaryModel" class="select-field" @change="persistIfExisting">
              <option v-for="m in officialModelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
            <p class="text-[10px] text-text-tertiary mt-1.5">已预填该渠道默认模型，填入 API Key 后即可保存</p>
          </div>
          <template v-else>
            <div v-if="priorityModels.length" class="space-y-1 mb-2">
              <div
                v-for="(m, idx) in priorityModels"
                :key="m"
                class="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-1 text-xs"
              >
                <span class="text-text-tertiary w-12 flex-shrink-0">{{ idx === 0 ? '主模型' : `备用 ${idx}` }}</span>
                <span class="flex-1 truncate font-medium text-text-primary">{{ m }}</span>
                <button type="button" class="text-text-tertiary hover:text-red-500" @click="removePriority(m)">×</button>
              </div>
            </div>
            <div class="flex gap-2 mb-2">
              <button
                type="button"
                class="btn-secondary text-xs flex items-center gap-1.5"
                :disabled="fetchingModels || !(form.api_base || selectedPreset.apiBase)"
                @click="fetchModels"
              >
                <svg v-if="fetchingModels" class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" /><path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75" /></svg>
                <span>{{ fetchingModels ? '拉取中…' : '从服务商拉取模型列表' }}</span>
              </button>
              <span v-if="fetchError" class="text-xs text-red-500 self-center">{{ fetchError }}</span>
            </div>
            <div v-if="remoteModels.length" class="border border-surface-2 rounded-xl overflow-hidden">
              <input
                v-model="modelSearch"
                placeholder="搜索模型…"
                class="w-full px-3 py-2 text-xs border-b border-surface-2 bg-surface-0 outline-none"
              />
              <div class="max-h-36 overflow-y-auto p-2 space-y-0.5">
                <label
                  v-for="m in filteredRemoteModels"
                  :key="m"
                  class="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer hover:bg-surface-2"
                >
                  <input type="checkbox" :value="m" v-model="selectedModels" class="rounded" @change="persistIfExisting" />
                  <span class="truncate">{{ m }}</span>
                </label>
              </div>
            </div>
            <input
              v-else
              v-model="modelsInput"
              placeholder="或手动输入（逗号分隔）"
              class="input-field text-xs"
              @blur="applyManualModels"
            />
          </template>
        </div>

        <div v-if="mode !== 'image'">
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <label class="form-label !mb-0">默认系统提示词</label>
            <button
              type="button"
              class="text-[11px] text-primary-600 hover:text-primary-700"
              @click="fillJanusOsPrompt"
            >填入 JanusOS 示例</button>
          </div>
          <textarea
            v-model="form.system_prompt"
            rows="8"
            class="input-field text-xs font-mono leading-relaxed"
            placeholder="该服务商下的对话会带上这段提示。JanusOS 等需要固定输出格式的模型可写在这里；留空则用应用默认助手。"
            @blur="persistIfExisting"
          />
          <p class="text-[10px] text-text-tertiary mt-1.5">会加在工具说明之后、专家人设之前。选了带人设的专家时，两段都会发给模型。</p>
        </div>

        <div>
          <button
            type="button"
            class="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1"
            @click="showAdvanced = !showAdvanced"
          >
            <svg class="w-3 h-3 transition-transform" :class="showAdvanced ? 'rotate-90' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
            高级配置（生图请求扩展）
          </button>
          <div v-if="showAdvanced" class="mt-3 space-y-3 p-3 bg-surface-1 rounded-xl border border-surface-2">
            <div>
              <div class="flex items-center justify-between mb-2">
                <label class="form-label !mb-0">自定义参数</label>
                <button type="button" class="text-xs text-primary-600" @click="addCustomParam">+ 添加</button>
              </div>
              <div v-if="!form.custom_params.length" class="text-[11px] text-text-disabled">暂无参数</div>
              <div v-else class="space-y-1.5">
                <div v-for="(p, idx) in form.custom_params" :key="idx" class="flex gap-2">
                  <input v-model="p.name" placeholder="参数名" class="input-field flex-1 text-xs" />
                  <input v-model="p.value" placeholder="值" class="input-field flex-1 text-xs" />
                  <button type="button" class="text-text-tertiary hover:text-red-500 text-xs" @click="removeCustomParam(idx)">×</button>
                </div>
              </div>
            </div>
            <div>
              <label class="form-label">请求覆盖 patch（JSON）</label>
              <textarea
                v-model="form.request_override_patch_text"
                rows="3"
                class="input-field text-xs font-mono"
                @input="validatePatchText"
                @blur="persistIfExisting"
              />
              <p v-if="patchParseError" class="text-[11px] text-red-500 mt-1">{{ patchParseError }}</p>
            </div>
          </div>
        </div>

        <div class="pt-1 space-y-2">
          <button
            type="button"
            class="w-full btn-secondary text-sm py-2"
            :disabled="testing || !(form.api_base || selectedPreset.apiBase)"
            @click="testConnection"
          >{{ testing ? '测试中…' : '测试连接' }}</button>
          <p v-if="testMessage" class="text-[11px]" :class="testOk ? 'text-primary-700' : 'text-red-500'">{{ testMessage }}</p>
          <button
            v-if="isAdding"
            type="button"
            class="w-full btn-primary text-sm py-2"
            :disabled="!!patchParseError"
            @click="saveProvider"
          >{{ useOfficialSelect ? '保存并加入列表' : '保存' }}</button>
        </div>
      </div>

      <div v-else class="h-full flex items-center justify-center text-xs text-text-tertiary">
        从左侧选择一个服务商，或添加模型
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useModelStore, type ModelProvider } from '@/stores/models'
import { useSiteConfigStore } from '@/stores/site-config'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { hasCap, type ModelCap } from '@/utils/model-caps'

const props = withDefaults(defineProps<{
  embedded?: boolean
  mode?: 'chat' | 'image'
}>(), { embedded: false, mode: 'chat' })

const store = useModelStore()
const siteConfig = useSiteConfigStore()
const cloudAuth = useCloudAuthStore()

const tokenLabel = computed(() => siteConfig.labels.token || '金币')
const cap = computed<ModelCap>(() => (props.mode === 'image' ? 'image' : 'chat'))

interface ChannelPreset {
  id: string
  name: string
  mark: string
  description: string
  apiBase: string
  type: string
  docsUrl?: string
  models: { id: string; label: string }[]
}

const CHAT_PRESETS: ChannelPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    mark: 'DS',
    description: '官方 API，默认 deepseek-chat，填 Key 即可保存',
    apiBase: 'https://api.deepseek.com',
    type: 'openai_compatible',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    models: [
      { id: 'deepseek-chat', label: 'deepseek-chat' },
      { id: 'deepseek-reasoner', label: 'deepseek-reasoner' },
    ],
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    mark: 'K',
    description: '开放平台按量，默认 kimi-k2-turbo-preview',
    apiBase: 'https://api.moonshot.cn/v1',
    type: 'openai_compatible',
    docsUrl: 'https://platform.moonshot.cn/console/api-keys',
    models: [
      { id: 'kimi-k2-turbo-preview', label: 'kimi-k2-turbo-preview' },
      { id: 'moonshot-v1-auto', label: 'moonshot-v1-auto' },
    ],
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    mark: '智',
    description: 'GLM 开放平台，默认 glm-4-flash',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    type: 'openai_compatible',
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    models: [
      { id: 'glm-4-flash', label: 'glm-4-flash' },
      { id: 'glm-4.5', label: 'glm-4.5' },
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    mark: '海',
    description: '官方对话/编程模型，默认 MiniMax-M2.5',
    apiBase: 'https://api.minimaxi.com/v1',
    type: 'openai_compatible',
    docsUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    models: [
      { id: 'MiniMax-M2.5', label: 'MiniMax-M2.5' },
      { id: 'MiniMax-Text-01', label: 'MiniMax-Text-01' },
    ],
  },
  {
    id: 'qwen',
    name: '通义百炼',
    mark: '通',
    description: '阿里云百炼兼容模式，默认 qwen-plus',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    type: 'openai_compatible',
    docsUrl: 'https://bailian.console.aliyun.com/',
    models: [
      { id: 'qwen-plus', label: 'qwen-plus' },
      { id: 'qwen-max', label: 'qwen-max' },
    ],
  },
  {
    id: 'custom',
    name: '自定义供应商',
    mark: '自',
    description: '中转或自建 OpenAI / Anthropic 兼容接口',
    apiBase: '',
    type: 'openai_compatible',
    models: [],
  },
]

const IMAGE_PRESETS: ChannelPreset[] = [
  {
    id: 'duomi',
    name: '多米生图',
    mark: '多',
    description: '异步任务通道，默认 gpt-image-2',
    apiBase: 'https://duomiapi.com/v1',
    type: 'duomi',
    models: [{ id: 'gpt-image-2', label: 'gpt-image-2' }],
  },
  {
    id: 'qwen',
    name: '通义万相',
    mark: '通',
    description: '百炼兼容模式，默认 qwen-image-plus',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    type: 'openai_compatible',
    docsUrl: 'https://bailian.console.aliyun.com/',
    models: [
      { id: 'qwen-image-plus', label: 'qwen-image-plus' },
      { id: 'qwen-image', label: 'qwen-image' },
    ],
  },
  {
    id: 'custom',
    name: '自定义供应商',
    mark: '自',
    description: '中转或自建 OpenAI 兼容生图接口',
    apiBase: '',
    type: 'openai_compatible',
    models: [],
  },
]

const selectedId = ref<string | null>(null)
const isAdding = ref(false)
const addView = ref<'picker' | 'form'>('picker')
const selectedPresetId = ref('custom')
const showKey = ref(false)
const testing = ref(false)
const testOk = ref(false)
const testMessage = ref('')
const dragId = ref<string | null>(null)
const listOrder = ref<string[]>([])

const editingId = ref<string | null>(null)
const modelsInput = ref('')

interface ProviderFormCustomParam {
  name: string
  value: string
}

interface ProviderFormState {
  name: string
  type: string
  api_base: string
  api_key: string
  custom_params: ProviderFormCustomParam[]
  request_override_patch_text: string
  system_prompt: string
}

function createEmptyFormState(): ProviderFormState {
  return {
    name: '',
    type: props.mode === 'image' ? 'openai_compatible' : 'openai_compatible',
    api_base: '',
    api_key: '',
    custom_params: [],
    request_override_patch_text: '',
    system_prompt: ''
  }
}

const form = ref<ProviderFormState>(createEmptyFormState())
const showAdvanced = ref(false)
const patchParseError = ref('')

const PROVIDER_DEFAULT_API_BASE: Record<string, string> = {
  duomi: 'https://duomiapi.com/v1',
  anthropic: 'https://api.anthropic.com'
}
const PROVIDER_FIXED_MODELS: Record<string, string[]> = {
  duomi: ['gpt-image-2']
}

const remoteModels = ref<string[]>([])
const selectedModels = ref<string[]>([])
const modelSearch = ref('')
const fetchingModels = ref(false)
const fetchError = ref('')

const SUPPORTED_PROVIDER_TYPES = ['openai_compatible', 'openai', 'anthropic', 'duomi']
const ORDER_KEY = computed(() => `settings.modelListOrder.${props.mode}`)

function readOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY.value)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeOrder(ids: string[]) {
  listOrder.value = ids
  localStorage.setItem(ORDER_KEY.value, JSON.stringify(ids))
}

function providerMatchesMode(p: ModelProvider): boolean {
  if (p.isCloud) {
    return (p.models || []).some((m) => hasCap(m, cap.value, store.cloudTypeOf(p.id, m)))
  }
  if (p.purpose === 'video' || p.purpose === 'tts') return false
  if (props.mode === 'image' && p.type === 'duomi') return true
  const models = p.models || []
  if (!models.length) return props.mode === 'chat'
  return models.some((m) => hasCap(m, cap.value))
}

interface ListItem {
  id: string
  name: string
  initial: string
  subtitle: string
  isCloud?: boolean
}

const listedItems = computed<ListItem[]>(() => {
  const raw = store.providers.filter(providerMatchesMode)
  const rank = new Map(listOrder.value.map((id, i) => [id, i]))
  const sorted = [...raw].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER
    const rb = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER
    if (ra !== rb) return ra - rb
    if (a.isCloud && !b.isCloud) return -1
    if (!a.isCloud && b.isCloud) return 1
    return 0
  })
  return sorted.map((p) => {
    const models = (p.models || []).filter((m) => hasCap(m, cap.value, p.isCloud ? store.cloudTypeOf(p.id, m) : undefined))
    const first = models[0] || (p.isCloud ? '托管' : '未配置模型')
    return {
      id: p.id,
      name: p.isCloud ? '云端模型' : p.name,
      initial: p.isCloud ? '云' : (p.name || '?').charAt(0).toUpperCase(),
      subtitle: first,
      isCloud: p.isCloud
    }
  })
})

const defaultItemId = computed(() => {
  if (props.mode === 'chat') {
    const d = siteConfig.chatDefaultModel
    if (d?.provider_id && listedItems.value.some((x) => x.id === d.provider_id)) return d.provider_id
  }
  return listedItems.value[0]?.id || null
})

const selectedIsCloud = computed(() => selectedId.value === 'cloud:default' && !isAdding.value)
const selectedLocal = computed(() => {
  if (isAdding.value || !selectedId.value || selectedId.value === 'cloud:default') return null
  return store.providers.find((p) => p.id === selectedId.value && !p.isCloud) || null
})
const channelPresets = computed(() => (props.mode === 'image' ? IMAGE_PRESETS : CHAT_PRESETS))
const selectedPreset = computed(() => {
  return channelPresets.value.find((p) => p.id === selectedPresetId.value) || channelPresets.value[channelPresets.value.length - 1]
})
const useOfficialSelect = computed(() => selectedPreset.value.id !== 'custom' && selectedPreset.value.models.length > 0 && form.value.type !== 'duomi')
const officialModelOptions = computed(() => {
  const known = selectedPreset.value.models || []
  const extras = selectedModels.value
    .filter((id) => id && !known.some((m) => m.id === id))
    .map((id) => ({ id, label: id }))
  return [...known, ...extras]
})
const primaryModel = computed({
  get: () => selectedModels.value[0] || selectedPreset.value.models[0]?.id || '',
  set: (value: string) => {
    const rest = selectedModels.value.filter((id) => id !== value)
    selectedModels.value = value ? [value, ...rest] : rest
  }
})

const cloudCatalog = computed(() => {
  return cloudAuth.models
    .filter((m) => hasCap(m.model_id, cap.value, m.type))
    .map((m) => ({
      key: `${m.model_id}@${m.provider_name || ''}`,
      label: m.provider_name ? `${m.name || m.model_id} · ${m.provider_name}` : (m.name || m.model_id)
    }))
})

const priorityModels = computed(() => {
  if (form.value.type === 'duomi') return ['gpt-image-2']
  return selectedModels.value.filter((m) => hasCap(m, cap.value))
})

const filteredRemoteModels = computed(() => {
  const q = modelSearch.value.toLowerCase()
  const list = remoteModels.value.filter((m) => hasCap(m, cap.value) || !q)
  if (!q) return list.filter((m) => hasCap(m, cap.value) || props.mode === 'chat')
  return remoteModels.value.filter((m) => m.toLowerCase().includes(q))
})

const apiKeyDocsUrl = computed(() => {
  if (selectedPreset.value.docsUrl) return selectedPreset.value.docsUrl
  if (form.value.type === 'anthropic') return 'https://console.anthropic.com/settings/keys'
  if (form.value.type === 'openai') return 'https://platform.openai.com/api-keys'
  try {
    const host = new URL(form.value.api_base || selectedPreset.value.apiBase || 'https://invalid.local').hostname
    if (host.includes('deepseek')) return 'https://platform.deepseek.com/api_keys'
    if (host.includes('moonshot') || host.includes('kimi')) return 'https://platform.moonshot.cn/console/api-keys'
    if (host.includes('openai')) return 'https://platform.openai.com/api-keys'
    if (host.includes('anthropic')) return 'https://console.anthropic.com/settings/keys'
    if (host.includes('dashscope') || host.includes('aliyuncs')) return 'https://bailian.console.aliyun.com/'
    if (host.includes('bigmodel')) return 'https://open.bigmodel.cn/usercenter/apikeys'
    if (host.includes('minimax')) return 'https://platform.minimaxi.com/user-center/basic-information/interface-key'
  } catch {
    /* ignore */
  }
  return ''
})

function openDocs() {
  if (apiKeyDocsUrl.value) void window.api.shell.openExternal(apiKeyDocsUrl.value)
}

function addCustomParam(): void {
  form.value.custom_params.push({ name: '', value: '' })
}

function removeCustomParam(idx: number): void {
  form.value.custom_params.splice(idx, 1)
}

const JANUS_OS_SYSTEM_PROMPT = `输出必须遵守 JanusOS 的格式标签要求：
{"surprise": , "mode": ""}
<Q-SWITCH | TO:MUSE | REASON:>
<Q-THINK>
<Q-SHELL>`

function fillJanusOsPrompt(): void {
  if (form.value.system_prompt.trim() && !window.confirm('将覆盖当前系统提示词，确定填入 JanusOS 示例？')) return
  form.value.system_prompt = JANUS_OS_SYSTEM_PROMPT
  void persistIfExisting()
}

function validatePatchText(): void {
  const t = form.value.request_override_patch_text.trim()
  if (!t) {
    patchParseError.value = ''
    return
  }
  try {
    const parsed = JSON.parse(t)
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      patchParseError.value = '必须是 JSON 对象（{} 形式）'
    } else {
      patchParseError.value = ''
    }
  } catch (e: any) {
    patchParseError.value = 'JSON 解析失败: ' + (e?.message || '')
  }
}

watch(() => form.value.type, (t) => {
  const def = PROVIDER_DEFAULT_API_BASE[t]
  if (def && !form.value.api_base.trim()) form.value.api_base = def
  const fixed = PROVIDER_FIXED_MODELS[t]
  if (fixed) {
    selectedModels.value = [...fixed]
    remoteModels.value = []
    modelsInput.value = ''
    fetchError.value = ''
  }
})

function resetForm() {
  form.value = createEmptyFormState()
  modelsInput.value = ''
  remoteModels.value = []
  selectedModels.value = []
  modelSearch.value = ''
  fetchError.value = ''
  showAdvanced.value = false
  patchParseError.value = ''
  showKey.value = false
  testMessage.value = ''
}

function inferPresetId(provider: Pick<ModelProvider, 'provider_preset' | 'api_base' | 'type'>): string {
  const known = channelPresets.value.find((p) => p.id === provider.provider_preset)
  if (known) return known.id
  const base = String(provider.api_base || '').toLowerCase()
  if (provider.type === 'duomi') return 'duomi'
  if (base.includes('deepseek')) return 'deepseek'
  if (base.includes('moonshot') || base.includes('kimi')) return 'moonshot'
  if (base.includes('bigmodel')) return 'zhipu'
  if (base.includes('minimaxi') || base.includes('minimax')) return 'minimax'
  if (base.includes('dashscope') || base.includes('aliyuncs')) return 'qwen'
  return 'custom'
}

function loadProvider(provider: ModelProvider) {
  editingId.value = provider.id
  isAdding.value = false
  addView.value = 'form'
  selectedPresetId.value = inferPresetId(provider)
  const safeType = SUPPORTED_PROVIDER_TYPES.includes(provider.type) ? provider.type : 'openai_compatible'
  const customParams = Array.isArray(provider.custom_params)
    ? provider.custom_params.map((p) => ({ name: String(p.name || ''), value: String(p.value ?? '') }))
    : []
  const patch = provider.request_override_patch && typeof provider.request_override_patch === 'object'
    ? provider.request_override_patch
    : {}
  const patchText = Object.keys(patch).length > 0 ? JSON.stringify(patch, null, 2) : ''
  form.value = {
    name: provider.name,
    type: safeType,
    api_base: provider.api_base,
    api_key: provider.api_key,
    custom_params: customParams,
    request_override_patch_text: patchText,
    system_prompt: provider.system_prompt || ''
  }
  showAdvanced.value = customParams.length > 0 || patchText.length > 0
  patchParseError.value = ''
  const fixed = PROVIDER_FIXED_MODELS[safeType]
  if (fixed) {
    modelsInput.value = ''
    selectedModels.value = [...fixed]
    remoteModels.value = []
  } else {
    modelsInput.value = provider.models.join(', ')
    selectedModels.value = [...provider.models]
    remoteModels.value = [...provider.models]
  }
  modelSearch.value = ''
  fetchError.value = ''
  testMessage.value = ''
}

function showPicker() {
  isAdding.value = true
  selectedId.value = '__new__'
  editingId.value = null
  addView.value = 'picker'
  selectedPresetId.value = 'custom'
  resetForm()
}

function selectPreset(preset: ChannelPreset) {
  selectedPresetId.value = preset.id
  addView.value = 'form'
  isAdding.value = true
  selectedId.value = '__new__'
  editingId.value = null
  resetForm()
  form.value.name = preset.name
  form.value.type = preset.type
  form.value.api_base = preset.apiBase
  selectedModels.value = preset.models.map((m) => m.id)
  modelsInput.value = selectedModels.value.join(', ')
}

function selectItem(id: string) {
  isAdding.value = false
  addView.value = 'form'
  selectedId.value = id
  const p = store.providers.find((x) => x.id === id)
  if (p && !p.isCloud) loadProvider(p)
  else {
    editingId.value = null
    selectedPresetId.value = 'custom'
  }
}

function startAdd() {
  showPicker()
}

function setType(t: string) {
  form.value.type = t
  void persistIfExisting()
}

function applyManualModels() {
  const extra = modelsInput.value.split(',').map((m) => m.trim()).filter(Boolean)
  const kept = selectedModels.value.filter((m) => !priorityModels.value.includes(m))
  selectedModels.value = [...extra, ...kept.filter((m) => !extra.includes(m))]
  void persistIfExisting()
}

function removePriority(model: string) {
  selectedModels.value = selectedModels.value.filter((m) => m !== model)
  void persistIfExisting()
}

async function fetchModels() {
  const apiBase = form.value.api_base.trim() || selectedPreset.value.apiBase
  if (!apiBase) return
  fetchingModels.value = true
  fetchError.value = ''
  try {
    const models = (await window.api.model.invoke('fetchRemote', apiBase, form.value.api_key, form.value.type)) as string[]
    remoteModels.value = models
  } catch (e: any) {
    fetchError.value = e?.message || '获取失败'
  } finally {
    fetchingModels.value = false
  }
}

async function testConnection() {
  testing.value = true
  testMessage.value = ''
  testOk.value = false
  try {
    const apiBase = form.value.api_base.trim() || selectedPreset.value.apiBase
    const models = (await window.api.model.invoke('fetchRemote', apiBase, form.value.api_key, form.value.type)) as string[]
    testOk.value = true
    testMessage.value = `连接成功，返回 ${Array.isArray(models) ? models.length : 0} 个模型`
  } catch (e: any) {
    testOk.value = false
    testMessage.value = e?.message || '连接失败'
  } finally {
    testing.value = false
  }
}

function modelsPayload(): string[] {
  if (form.value.type === 'duomi') return [...PROVIDER_FIXED_MODELS.duomi]
  if (selectedModels.value.length) return [...selectedModels.value]
  return modelsInput.value.split(',').map((m) => m.trim()).filter(Boolean)
}

async function saveProvider() {
  const name = form.value.name.trim() || selectedPreset.value.name
  const apiBase = form.value.api_base.trim() || selectedPreset.value.apiBase
  if (!name) {
    alert('请输入名称')
    return
  }
  if (!apiBase) {
    alert('请输入 API 基础地址')
    return
  }
  form.value.name = name
  form.value.api_base = apiBase
  if (useOfficialSelect.value && !selectedModels.value.length && selectedPreset.value.models[0]) {
    selectedModels.value = [selectedPreset.value.models[0].id]
  }
  validatePatchText()
  if (patchParseError.value) {
    alert('高级配置 - 请求覆盖 patch：' + patchParseError.value)
    showAdvanced.value = true
    return
  }
  const patchText = form.value.request_override_patch_text.trim()
  let requestOverridePatch: Record<string, any> = {}
  if (patchText) {
    try {
      requestOverridePatch = JSON.parse(patchText)
    } catch (e: any) {
      alert('高级配置 - 请求覆盖 patch JSON 解析失败：' + (e?.message || e))
      showAdvanced.value = true
      return
    }
  }
  const customParams = form.value.custom_params
    .map((p) => ({ name: String(p.name || '').trim(), value: String(p.value ?? '') }))
    .filter((p) => p.name.length > 0)
  try {
    const payload = {
      name,
      type: form.value.type,
      api_base: apiBase,
      api_key: form.value.api_key,
      models: modelsPayload(),
      custom_params: customParams,
      request_override_patch: requestOverridePatch,
      system_prompt: form.value.system_prompt || '',
      provider_preset: selectedPresetId.value
    }
    if (editingId.value) {
      await store.updateProvider(editingId.value, payload)
    } else {
      const created = await store.createProvider(payload)
      isAdding.value = false
      selectedId.value = created.id
      editingId.value = created.id
    }
  } catch (e: any) {
    console.error('saveProvider error:', e)
    alert('保存失败: ' + (e?.message || e))
  }
}

async function persistIfExisting() {
  if (!editingId.value) return
  await saveProvider()
}

async function removeCurrent() {
  if (!editingId.value) return
  if (!confirm('确定删除该服务商？')) return
  await store.deleteProvider(editingId.value)
  isAdding.value = false
  editingId.value = null
  selectedId.value = listedItems.value[0]?.id || null
  if (selectedId.value) selectItem(selectedId.value)
}

function onDragStart(id: string, e: DragEvent) {
  dragId.value = id
  e.dataTransfer?.setData('text/plain', id)
}

function onDrop(targetId: string, e: DragEvent) {
  e.preventDefault()
  const from = dragId.value || e.dataTransfer?.getData('text/plain')
  dragId.value = null
  if (!from || from === targetId) return
  const ids = listedItems.value.map((x) => x.id)
  const fromIdx = ids.indexOf(from)
  const toIdx = ids.indexOf(targetId)
  if (fromIdx < 0 || toIdx < 0) return
  ids.splice(fromIdx, 1)
  ids.splice(toIdx, 0, from)
  writeOrder(ids)
}

watch(
  listedItems,
  (list) => {
    if (isAdding.value) return
    if (selectedId.value && list.some((x) => x.id === selectedId.value)) return
    if (list[0]) selectItem(list[0].id)
    else selectedId.value = null
  },
  { immediate: true }
)

watch(ORDER_KEY, () => {
  listOrder.value = readOrder()
}, { immediate: true })

onMounted(() => store.fetchProviders())
</script>
