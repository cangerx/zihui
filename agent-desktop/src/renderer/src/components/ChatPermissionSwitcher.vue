<template>
  <div ref="rootEl" class="relative">
    <button
      type="button"
      @click="open = !open"
      tabindex="-1"
      class="flex items-center gap-1 h-8 px-2.5 text-[12px] rounded-full transition-colors max-w-[9rem] outline-none focus:outline-none focus:ring-0"
      :class="open ? 'text-text-primary bg-surface-2' : 'text-text-secondary hover:bg-surface-2'"
      :title="current.desc"
    >
      <svg class="w-3 h-3 flex-shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
      </svg>
      <span class="truncate">{{ current.label }}</span>
      <svg class="w-3 h-3 flex-shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
      </svg>
    </button>

    <div
      v-if="open"
      class="absolute bottom-full left-0 mb-1 w-64 bg-surface-0 border border-surface-3 rounded-xl shadow-modal z-30 overflow-hidden py-1"
    >
      <div class="px-3 py-1.5 text-[10px] text-text-tertiary">工具权限</div>
      <button
        v-for="opt in options"
        :key="opt.value"
        type="button"
        class="w-full text-left px-3 py-2 transition-colors"
        :class="effectiveMode === opt.value ? 'bg-primary-50' : 'hover:bg-surface-2'"
        @click="pick(opt.value)"
      >
        <div class="flex items-center gap-2">
          <span
            class="text-xs"
            :class="effectiveMode === opt.value ? 'text-primary-700 font-medium' : 'text-text-primary'"
          >{{ opt.label }}</span>
          <span
            v-if="opt.value === botDefault"
            class="text-[10px] text-text-tertiary"
          >专家默认</span>
        </div>
        <div class="text-[11px] text-text-tertiary mt-0.5 leading-snug">{{ opt.desc }}</div>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { ToolApproval } from '@/stores/bots'

const props = withDefaults(defineProps<{
  /** 会话覆盖值；空串表示继承智能体 */
  mode?: string
  /** 当前智能体默认档 */
  botDefault?: ToolApproval
}>(), {
  mode: '',
  botDefault: 'destructive'
})

const emit = defineEmits<{
  change: [ToolApproval]
}>()

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)

const options: { value: ToolApproval; label: string; desc: string }[] = [
  { value: 'off', label: '完全访问', desc: '所有工具自动执行，不再弹确认' },
  { value: 'destructive', label: '谨慎确认', desc: '写文件、运行命令等破坏性操作前确认' },
  { value: 'all', label: '全部确认', desc: '每次工具调用都需确认' }
]

const effectiveMode = computed<ToolApproval>(() => {
  const m = props.mode
  if (m === 'off' || m === 'destructive' || m === 'all') return m
  return props.botDefault || 'destructive'
})

const current = computed(() => options.find((o) => o.value === effectiveMode.value) || options[1])

function pick(value: ToolApproval) {
  open.value = false
  emit('change', value)
}

function onDocClick(e: MouseEvent) {
  if (open.value && rootEl.value && !rootEl.value.contains(e.target as Node)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>
