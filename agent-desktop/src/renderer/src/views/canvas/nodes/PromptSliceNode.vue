<template>
  <div class="canvas-node" style="min-width: 280px;" :style="{ borderColor: 'var(--color-primary-500, #23574f)' }">
    <div class="node-header" style="background: var(--color-primary-50, #f2f6f5); color: var(--color-primary-700, #1a3f3a);">
      <span class="node-type-dot" style="background: var(--color-primary-500, #23574f);"></span>
      <span class="truncate">提示词切片</span>
      <span class="text-[10px] font-normal opacity-60 ml-1">#{{ data.nodeIndex }}</span>
      <span class="text-[9px] text-primary-400 ml-1">{{ rows.length }}/20</span>
      <div style="margin-left: auto; display: flex; gap: 2px;">
        <button @click.stop="toggleAiSlice" :disabled="data.locked" class="px-1.5 py-0.5 rounded text-[9px] text-primary-600 hover:bg-primary-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">AI</button>
        <button @click.stop="addRow" :disabled="data.locked || rows.length >= 20" class="px-1.5 py-0.5 rounded text-[9px] text-primary-600 hover:bg-primary-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">+</button>
        <button @click="deleteNode" :disabled="data.locked" class="node-delete-btn" style="margin-left: 0;">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
    <div class="node-body" style="padding: 8px 10px;">
      <div v-if="rows.length === 0" class="text-[10px] text-text-disabled text-center py-4">暂无文本行</div>
      <div
        v-for="(row, idx) in rows"
        :key="row.id"
        class="prompt-slice-row flex items-start gap-1.5 mb-3 last:mb-1 relative group"
      >
        <span class="text-[10px] text-text-disabled mt-2.5 w-4 text-right flex-shrink-0">{{ idx + 1 }}</span>
        <PromptTextarea
          :model-value="row.text"
          @update:model-value="(value) => updateRowText(idx, value)"
          @change="saveData"
          :title="`编辑第 ${idx + 1} 条提示词`"
          :height="84"
          :max-length="IMAGE_PROMPT_MAX_LENGTH"
          placeholder="输入提示词..."
          container-class="flex-1 nodrag nopan"
          input-class="text-[11px] leading-relaxed"
          :disabled="data.locked"
        />
        <button
          @click="removeRow(idx)"
          :disabled="data.locked"
          class="p-0.5 rounded text-text-disabled hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-0 mt-1.5"
        >
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
        <Handle
          type="source"
          :position="Position.Right"
          :id="`output-${row.id}`"
          class="handle-text"
          @click="(e: MouseEvent) => onHandleClick?.(e, data.nodeId, `output-${row.id}`, 'text')"
        />
      </div>
    </div>
    <!-- Handles are rendered inside the row loop above -->
  </div>

  <Teleport to="body">
    <div v-if="showAiSlice" class="fixed z-[9999]" :style="aiSlicePos">
      <div class="w-[380px] bg-surface-0 border border-surface-3 rounded-2xl shadow-xl flex flex-col" v-click-outside="() => showAiSlice = false">
        <div class="flex items-center justify-between px-5 py-3 border-b border-surface-3">
          <h3 class="text-sm font-semibold text-text-primary">AI 切片</h3>
          <button @click="showAiSlice = false" class="p-1 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div class="p-4 space-y-3">
          <div>
            <label class="text-[11px] font-medium text-text-secondary mb-1 block">描述</label>
            <PromptTextarea
              v-model="aiInput"
              title="编辑 AI 切片描述"
              :height="104"
              placeholder="输入整体主题描述，AI 会拆分为多条提示词..."
              input-class="text-xs"
            />
          </div>
          <div class="flex items-center gap-3">
            <label class="text-[11px] font-medium text-text-secondary">切片数</label>
            <input v-model.number="aiCount" type="number" min="2" max="20" class="w-16 text-xs text-text-primary bg-surface-1 border border-surface-3 rounded-lg px-2 py-1.5 outline-none focus:border-pink-400" />
          </div>
          <button @click="runAiSlice" :disabled="aiLoading || !aiInput.trim()" class="w-full flex items-center justify-center gap-2 py-2 text-xs font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <svg v-if="aiLoading" class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
            {{ aiLoading ? '生成中...' : '生成' }}
          </button>
          <p v-if="aiError" class="text-[10px] text-red-500">{{ aiError }}</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, inject } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvas'
import { extractJson } from '@shared/json-extract'
import PromptTextarea from '@/components/PromptTextarea.vue'
import { IMAGE_PROMPT_MAX_LENGTH } from '@shared/prompt-limits'

type HandleClickHandler = (e: MouseEvent, nodeId: string, handleId: string, dataType: 'text' | 'image') => void

interface SliceRow {
  id: string
  text: string
}

const props = defineProps<{ data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const api = () => (window as any).api
const onHandleClick = inject<HandleClickHandler | null>('onHandleClick', null)

const rows = ref<SliceRow[]>(props.data.rows || [])
const showAiSlice = ref(false)
const aiSlicePos = ref({ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' } as Record<string, string>)
const aiInput = ref('')

function toggleAiSlice(e: MouseEvent) {
  showAiSlice.value = !showAiSlice.value
  if (showAiSlice.value) {
    const btn = e.currentTarget as HTMLElement
    const rect = btn.getBoundingClientRect()
    aiSlicePos.value = {
      top: `${rect.bottom + 8}px`,
      left: `${rect.left}px`,
      transform: 'none'
    }
  }
}
const aiCount = ref(5)
const aiLoading = ref(false)
const aiError = ref('')

watch(() => props.data.rows, (v) => {
  if (v && JSON.stringify(v) !== JSON.stringify(rows.value)) {
    rows.value = v
  }
}, { deep: true })

let saveTimer: ReturnType<typeof setTimeout> | null = null
function debouncedSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveData, 300)
}

function saveData() {
  if (!props.data.nodeId) return
  canvasStore.updateNode(props.data.nodeId, {
    data: { ...props.data, rows: JSON.parse(JSON.stringify(rows.value)) }
  })
}

function genId(): string {
  return Math.random().toString(36).substring(2, 10)
}

function addRow() {
  if (rows.value.length >= 20) return
  rows.value.push({ id: genId(), text: '' })
  saveData()
}

function removeRow(idx: number) {
  const row = rows.value[idx]
  if (!row) return
  // Remove edges connected to this handle
  if (props.data.nodeId) {
    canvasStore.removeEdgesByHandle(props.data.nodeId, `output-${row.id}`)
  }
  rows.value.splice(idx, 1)
  saveData()
}

function updateRowText(idx: number, text: string) {
  if (rows.value[idx]) {
    rows.value[idx].text = text
    debouncedSave()
  }
}

function deleteNode() {
  if (!props.data.nodeId) return
  canvasStore.removeNode(props.data.nodeId)
}

async function runAiSlice() {
  const project = canvasStore.currentProject
  if (!project?.text_provider_id || !project?.text_model_id) {
    aiError.value = '请先在画布设置中配置文本模型'
    return
  }

  aiLoading.value = true
  aiError.value = ''

  try {
    const count = Math.max(2, Math.min(20, aiCount.value))
    const systemPrompt = `你是一个提示词工程助手。请将用户的描述拆分为恰好 ${count} 条独立的、详细的图片生成提示词。每条提示词应描述不同的场景、角度或方面，语言风格与用户输入保持一致。只输出 JSON 对象，格式为 {"prompts":["...","..."]}, 不要输出任何其他内容。`

    const result = await api().llm.invoke(
      'call',
      project.text_provider_id,
      project.text_model_id,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: aiInput.value }
      ],
      {
        stream: false,
        notifyStream: false,
        max_tokens: 4000,
        response_format: { type: 'json_object' }
      }
    )

    // extractJson handles <think> blocks, markdown fences, etc.
    let parsed: string[]
    const extracted = extractJson(result)
    if (Array.isArray(extracted)) {
      parsed = extracted
    } else if (extracted && typeof extracted === 'object') {
      const arrKey = Object.keys(extracted).find((k) => Array.isArray(extracted[k]))
      if (arrKey) parsed = extracted[arrKey]
      else throw new Error('AI 返回的 JSON 中找不到数组')
    } else {
      throw new Error('AI 未返回合法的 JSON')
    }

    // Clear old rows and edges
    for (const row of rows.value) {
      if (props.data.nodeId) {
        await canvasStore.removeEdgesByHandle(props.data.nodeId, `output-${row.id}`)
      }
    }

    // Create new rows
    rows.value = parsed.slice(0, 20).map((text: string) => ({
      id: genId(),
      text: String(text).trim()
    }))

    saveData()
    showAiSlice.value = false
  } catch (e: any) {
    aiError.value = e?.message || 'AI generation failed'
  } finally {
    aiLoading.value = false
  }
}

const vClickOutside = {
  mounted(el: HTMLElement, binding: any) {
    (el as any)._clickOutside = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) binding.value()
    }
    setTimeout(() => document.addEventListener('click', (el as any)._clickOutside), 0)
  },
  unmounted(el: HTMLElement) {
    document.removeEventListener('click', (el as any)._clickOutside)
  }
}
</script>
