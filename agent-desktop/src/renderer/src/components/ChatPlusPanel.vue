<template>
  <div ref="rootEl" class="relative">
    <button
      type="button"
      @click="open = !open"
      :disabled="disabled"
      tabindex="-1"
      :class="[
        'relative h-8 w-8 flex items-center justify-center rounded-full transition-all disabled:opacity-40 outline-none focus:outline-none focus:ring-0',
        open || activeCount
          ? 'text-text-primary bg-surface-3'
          : 'text-text-secondary bg-surface-2 hover:bg-surface-3'
      ]"
      title="添加与模式"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      <span
        v-if="capabilityCount"
        class="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 rounded-full bg-primary-600 text-white text-[9px] leading-[14px] text-center"
      >{{ capabilityCount }}</span>
    </button>

    <div
      v-if="open"
      class="absolute bottom-full left-0 mb-2 w-72 max-h-[min(24rem,70vh)] overflow-y-auto bg-surface-0 rounded-xl shadow-modal border border-surface-3 z-30"
    >
      <div class="px-3 pt-2.5 pb-1 text-[10px] font-medium tracking-wide text-text-tertiary uppercase">添加</div>
      <button
        type="button"
        class="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-surface-2 transition-colors"
        @click="onAttach('document')"
      >
        <span class="mt-0.5 w-4 h-4 flex-shrink-0 text-text-tertiary">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" /></svg>
        </span>
        <span class="min-w-0">
          <span class="block text-xs text-text-primary">附加文件</span>
          <span class="block text-[11px] text-text-tertiary mt-0.5">图片、文档或从本地选择</span>
        </span>
      </button>
      <button
        type="button"
        class="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-surface-2 transition-colors"
        @click="onAttach('image')"
      >
        <span class="mt-0.5 w-4 h-4 flex-shrink-0 text-text-tertiary">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" /></svg>
        </span>
        <span class="min-w-0">
          <span class="block text-xs text-text-primary">附加图片</span>
          <span class="block text-[11px] text-text-tertiary mt-0.5">支持多选</span>
        </span>
      </button>
      <button
        type="button"
        class="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-surface-2 transition-colors"
        @click="onGallery"
      >
        <span class="mt-0.5 w-4 h-4 flex-shrink-0 text-text-tertiary">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" stroke-width="2"/><polyline points="21 15 16 10 5 21" stroke-width="2"/></svg>
        </span>
        <span class="min-w-0">
          <span class="block text-xs text-text-primary">从图库选择</span>
          <span class="block text-[11px] text-text-tertiary mt-0.5">使用已保存的生成图</span>
        </span>
      </button>

      <button
        v-for="m in modes"
        :key="m.id"
        type="button"
        :class="[
          'w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors',
          mode === m.id ? 'bg-surface-2' : 'hover:bg-surface-2'
        ]"
        @click="toggleMode(m.id)"
      >
        <span class="mt-0.5 w-4 h-4 flex-shrink-0 text-text-tertiary">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="m.icon" /></svg>
        </span>
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-1.5">
            <span class="text-xs text-text-primary">{{ m.label }}</span>
            <span v-if="mode === m.id" class="text-[10px] text-primary-700">已选</span>
          </span>
          <span class="block text-[11px] text-text-tertiary mt-0.5">{{ m.desc }}</span>
        </span>
      </button>

      <div class="border-t border-surface-3 mt-1 px-3 pt-2.5 pb-1 text-[10px] font-medium tracking-wide text-text-tertiary uppercase">本轮能力</div>
      <div class="px-3 pb-1 max-h-36 overflow-y-auto space-y-0.5">
        <div class="text-[10px] text-text-tertiary mb-1">小工具</div>
        <label v-for="s in skills" :key="s.id" class="flex items-center gap-2 py-1 text-xs text-text-primary cursor-pointer">
          <input type="checkbox" class="rounded w-3 h-3" :checked="skillIds.includes(s.id)" @change="toggleSkill(s.id)" />
          <span class="truncate">{{ s.name }}</span>
        </label>
        <div v-if="!skills.length" class="text-[10px] text-text-disabled py-1">无可用小工具</div>
        <div class="text-[10px] text-text-tertiary mt-2 mb-1">Skills</div>
        <label v-for="ps in promptSkills" :key="ps.dirName" class="flex items-center gap-2 py-1 text-xs text-text-primary cursor-pointer">
          <input type="checkbox" class="rounded w-3 h-3" :checked="promptSkillDirs.includes(ps.dirName)" @change="togglePromptSkill(ps.dirName)" />
          <span class="truncate">{{ ps.name }}</span>
        </label>
        <div v-if="!promptSkills.length" class="text-[10px] text-text-disabled py-1">无可用 Skills</div>
        <div class="text-[10px] text-text-tertiary mt-2 mb-1">MCP</div>
        <label v-for="m in mcpServers" :key="m.id" class="flex items-center gap-2 py-1 text-xs cursor-pointer" :class="m.enabled ? 'text-text-primary' : 'text-text-disabled'">
          <input type="checkbox" class="rounded w-3 h-3" :checked="mcpIds.includes(m.id)" :disabled="!m.enabled" @change="toggleMcp(m.id)" />
          <span class="truncate">{{ m.name }}</span>
        </label>
        <div v-if="!mcpServers.length" class="text-[10px] text-text-disabled py-1">暂无 MCP 服务</div>
      </div>

      <div class="border-t border-surface-3 mt-1 px-3 pt-2.5 pb-1 text-[10px] font-medium tracking-wide text-text-tertiary uppercase">设置</div>
      <div class="flex items-center gap-2.5 px-3 py-2">
        <span class="mt-0.5 w-4 h-4 flex-shrink-0 text-text-tertiary">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" /></svg>
        </span>
        <div class="min-w-0 flex-1">
          <div class="text-xs text-text-primary">联网搜索</div>
          <div class="text-[11px] text-text-tertiary mt-0.5">需要时由模型结合公开知识作答（默认关）</div>
        </div>
        <button
          type="button"
          role="switch"
          :aria-checked="webSearch"
          :class="[
            'relative w-9 h-5 rounded-full transition-colors flex-shrink-0',
            webSearch ? 'bg-primary-600' : 'bg-surface-3'
          ]"
          @click="toggleWebSearch"
        >
          <span
            :class="[
              'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
              webSearch ? 'translate-x-4' : 'translate-x-0'
            ]"
          />
        </button>
      </div>

      <div class="border-t border-surface-3 mt-1 px-3 pt-2.5 pb-1 text-[10px] font-medium tracking-wide text-text-tertiary uppercase">工作区文件</div>
      <button
        type="button"
        :disabled="!workspaceEnabled"
        class="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-surface-2 transition-colors disabled:opacity-50 disabled:hover:bg-transparent mb-1"
        @click="onWorkspace"
      >
        <span class="mt-0.5 w-4 h-4 flex-shrink-0 text-text-tertiary">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" /></svg>
        </span>
        <span class="min-w-0">
          <span class="block text-xs text-text-primary">浏览工作区文件</span>
          <span class="block text-[11px] text-text-tertiary mt-0.5">打开侧栏浏览当前工作区</span>
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

export type ChatTaskMode = 'plan' | 'goal' | 'meeting' | null

const props = withDefaults(defineProps<{
  disabled?: boolean
  mode?: ChatTaskMode
  webSearch?: boolean
  workspaceEnabled?: boolean
  skills?: { id: string; name: string }[]
  promptSkills?: { dirName: string; name: string }[]
  mcpServers?: { id: string; name: string; enabled: boolean }[]
  skillIds?: string[]
  promptSkillDirs?: string[]
  mcpIds?: string[]
}>(), {
  disabled: false,
  mode: null,
  webSearch: false,
  workspaceEnabled: false,
  skills: () => [],
  promptSkills: () => [],
  mcpServers: () => [],
  skillIds: () => [],
  promptSkillDirs: () => [],
  mcpIds: () => []
})

const emit = defineEmits<{
  'update:mode': [ChatTaskMode]
  'update:webSearch': [boolean]
  attach: ['image' | 'document']
  gallery: []
  workspace: []
  close: []
  'update:skillIds': [string[]]
  'update:promptSkillDirs': [string[]]
  'update:mcpIds': [string[]]
}>()

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)

const modes = [
  {
    id: 'plan' as const,
    label: '规划模式',
    desc: '先出计划，确认后再执行',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z'
  },
  {
    id: 'goal' as const,
    label: '目标模式',
    desc: '持续推进直到目标完成',
    icon: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'
  },
  {
    id: 'meeting' as const,
    label: '会议纪要',
    desc: '整理决议、待办与要点',
    icon: 'M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z'
  }
]

const capabilityCount = computed(() =>
  (props.skillIds?.length || 0) + (props.promptSkillDirs?.length || 0) + (props.mcpIds?.length || 0)
)
const activeCount = computed(() => (props.mode ? 1 : 0) + (props.webSearch ? 1 : 0) + (capabilityCount.value ? 1 : 0))

function toggleInList(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}

function toggleSkill(id: string) {
  emit('update:skillIds', toggleInList(props.skillIds || [], id))
}

function togglePromptSkill(dirName: string) {
  emit('update:promptSkillDirs', toggleInList(props.promptSkillDirs || [], dirName))
}

function toggleMcp(id: string) {
  emit('update:mcpIds', toggleInList(props.mcpIds || [], id))
}

function toggleMode(id: Exclude<ChatTaskMode, null>) {
  emit('update:mode', props.mode === id ? null : id)
}

function toggleWebSearch() {
  emit('update:webSearch', !props.webSearch)
}

function onAttach(kind: 'image' | 'document') {
  open.value = false
  emit('attach', kind)
}

function onGallery() {
  open.value = false
  emit('gallery')
}

function onWorkspace() {
  open.value = false
  emit('workspace')
}

function onDocClick(e: MouseEvent) {
  const t = e.target as Node
  if (open.value && rootEl.value && !rootEl.value.contains(t)) {
    open.value = false
    emit('close')
  }
}

watch(open, (v) => {
  if (!v) emit('close')
})

onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))

defineExpose({
  close: () => { open.value = false },
  open: () => { open.value = true }
})
</script>
