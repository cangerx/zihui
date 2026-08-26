<template>
  <div ref="rootEl" class="relative">
    <!-- 触发按钮：输入框左下角的小条，IDE 风格。
         prefix 不参与 truncate，让「对话：」/「生图：」始终完整可见，模型名可被截断 -->
    <button
      type="button"
      :tabindex="chip ? -1 : 0"
      @click="open = !open"
      :class="block
        ? 'w-full flex items-center gap-1 px-3 py-2 text-sm bg-surface-1 border border-surface-3 rounded-lg text-text-primary hover:bg-surface-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500'
        : chip
          ? 'flex items-center gap-1 h-8 px-2 text-[12px] text-text-tertiary hover:text-text-secondary rounded-full transition-colors max-w-[220px] outline-none focus:outline-none focus:ring-0'
          : 'flex items-center gap-1 h-7 px-1.5 text-[12px] text-text-secondary hover:text-text-primary rounded-md hover:bg-surface-2 transition-colors max-w-[220px] focus:outline-none'"
      :title="currentLabel || placeholderLabel"
    >
      <span v-if="prefixText" class="flex-shrink-0 text-text-tertiary">{{ prefixText }}</span>
      <span class="truncate" :class="{ 'text-text-tertiary': !currentLabel }">{{ currentLabel || placeholderLabel }}</span>
      <svg class="w-3 h-3 flex-shrink-0 opacity-70" :class="{ 'ml-auto': block }" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="direction === 'down' ? 'm19.5 8.25-7.5 7.5-7.5-7.5' : 'm4.5 15.75 7.5-7.5 7.5 7.5'" />
      </svg>
    </button>

    <!-- 下拉面板：默认向上展开（按钮在输入框底部）；direction='down' 向下展开（表单场景） -->
    <div
      v-if="open"
      class="absolute w-80 max-w-[min(20rem,calc(100vw-24px))] max-h-[360px] bg-surface-0 border border-surface-3 rounded-xl shadow-modal z-30 flex flex-col overflow-hidden"
      :class="[
        direction === 'down' ? 'top-full mt-1' : 'bottom-full mb-1',
        align === 'end' ? 'right-0' : 'left-0'
      ]"
    >
      <div class="px-2.5 pt-2 pb-1.5 border-b border-surface-3 flex-shrink-0">
        <input
          v-model="search"
          type="text"
          :placeholder="searchPlaceholder"
          class="w-full px-2 py-1 text-xs border border-surface-3 rounded-md bg-surface-1 outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>
      <div class="flex-1 overflow-y-auto py-1">
        <template v-if="filteredGroups.length">
          <div v-for="g in filteredGroups" :key="g.providerId" class="mb-1 last:mb-0">
            <div class="px-3 py-1 text-[11px] text-text-tertiary font-medium uppercase tracking-wider">
              {{ g.providerName }}
            </div>
            <button
              v-for="m in g.models"
              :key="g.providerId + '/' + m.modelKey"
              type="button"
              @click="pick(m)"
              class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors"
              :class="isCurrent(m) ? 'text-primary-700 bg-primary-50 font-medium' : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'"
            >
              <span class="flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center">
                <svg v-if="isCurrent(m)" class="w-3.5 h-3.5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4.5 12.75 10.5 18.75 19.5 5.25" />
                </svg>
              </span>
              <span class="truncate">{{ m.displayName }}</span>
            </button>
          </div>
        </template>
        <div v-else class="px-3 py-6 text-center text-[11px] text-text-tertiary">
          {{ search ? emptySearchLabel : emptyListLabel }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useModelStore } from '@/stores/models'
import { hasCap } from '@/utils/model-caps'

/**
 * 对话输入框左下角的模型切换器。type 决定过滤哪类型模型：
 *
 * - type="chat"（默认）：仅列 chat 类型模型，控制会话主 LLM
 * - type="image"：仅列 image 类型模型，控制 image_gen tool 默认 provider/model
 *
 * 过滤规则与 BotListView 「推荐」分组一致：
 *   · 云端 provider：以 cloud_models.type 为单一真值（cloudTypeOf == type 才进）
 *   · 本地 provider：按 modelId 关键字识别（hasCap 内部）
 *
 * 当前选中态由父组件通过 props 控制（per-conversation）；切换通过 emit('change') 通知父组件持久化。
 */

interface ChatModelEntry {
  providerId: string
  providerName: string
  modelKey: string
  displayName: string
}

interface ChatModelGroup {
  providerId: string
  providerName: string
  models: ChatModelEntry[]
}

const props = withDefaults(defineProps<{
  /** 当前会话选用的 provider id（'' 表示未选） */
  providerId: string
  /** 当前会话选用的 model id 或复合 key（'' 表示未选） */
  modelId: string
  /** 过滤类型：chat 默认，image 用于生图选择 */
  type?: 'chat' | 'image'
  /** 下拉展开方向：up 默认（对话框底部用）；down 用于表单场景 */
  direction?: 'up' | 'down'
  /** 下拉水平对齐：start 左齐按钮（默认）；end 右齐按钮（输入栏右侧用） */
  align?: 'start' | 'end'
  /** 块级全宽表单样式（默认 false 为 IDE 小条样式） */
  block?: boolean
  /** 覆盖按钮前缀文案；传 '' 则不显示前缀（表单已有 label 时） */
  prefix?: string
  /** 输入栏内的浅色胶囊样式 */
  chip?: boolean
}>(), {
  type: 'chat',
  direction: 'up',
  align: 'start',
  block: false,
  chip: false
})

/** 按钮前缀文案：「对话：」 / 「生图：」（可被 prefix 覆盖） */
const prefixLabel = computed(() => props.type === 'image' ? '生图：' : '对话：')
const prefixText = computed(() => props.prefix !== undefined ? props.prefix : prefixLabel.value)
const placeholderLabel = computed(() => props.type === 'image' ? '选择生图模型' : '选择对话模型')
const searchPlaceholder = computed(() => props.type === 'image' ? '搜索生图模型...' : '搜索对话模型...')
const emptySearchLabel = computed(() => props.type === 'image' ? '无匹配的生图模型' : '无匹配的对话模型')
const emptyListLabel = computed(() => props.type === 'image' ? '暂无可用的生图模型' : '暂无可用的对话模型')

const emit = defineEmits<{
  (e: 'change', val: { provider_id: string; model_id: string }): void
}>()

const modelStore = useModelStore()
const open = ref(false)
const search = ref('')
const rootEl = ref<HTMLElement | null>(null)

/** 全部匹配 type 的可选模型，按 provider 分组。
 *  type='chat' → hasCap(m, 'chat')；type='image' → hasCap(m, 'image') */
const allGroups = computed<ChatModelGroup[]>(() => {
  const groups: ChatModelGroup[] = []
  for (const p of modelStore.providers) {
    const entries: ChatModelEntry[] = []
    for (const m of p.models) {
      const cloudType = modelStore.cloudTypeOf(p.id, m)
      if (!hasCap(m, props.type, cloudType)) continue
      entries.push({
        providerId: p.id,
        providerName: p.name,
        modelKey: m,
        displayName: modelStore.optionLabel(p.id, m),
      })
    }
    if (entries.length > 0) {
      groups.push({ providerId: p.id, providerName: p.name, models: entries })
    }
  }
  return groups
})

const filteredGroups = computed<ChatModelGroup[]>(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return allGroups.value
  return allGroups.value
    .map((g) => ({
      ...g,
      models: g.models.filter((m) => m.displayName.toLowerCase().includes(q)),
    }))
    .filter((g) => g.models.length > 0)
})

/** 按钮上显示的当前模型名（短，最长 280px 截断显示） */
const currentLabel = computed(() => {
  if (!props.modelId) return ''
  return modelStore.formatModelLabel(props.providerId, props.modelId)
})

function isCurrent(entry: ChatModelEntry): boolean {
  return entry.providerId === props.providerId && entry.modelKey === props.modelId
}

function pick(entry: ChatModelEntry): void {
  emit('change', { provider_id: entry.providerId, model_id: entry.modelKey })
  open.value = false
  search.value = ''
}

/** 点击面板外部关闭 */
function onDocMouseDown(e: MouseEvent): void {
  if (!open.value) return
  const el = rootEl.value
  if (el && !el.contains(e.target as Node)) {
    open.value = false
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMouseDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
})
</script>
