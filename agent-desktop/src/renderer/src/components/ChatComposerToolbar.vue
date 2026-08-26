<template>
  <div class="flex items-center justify-between gap-2">
    <div class="flex items-center gap-0.5 min-w-0">
      <ChatPlusPanel
        :mode="mode"
        :web-search="webSearch"
        :disabled="plusDisabled"
        :workspace-enabled="workspaceEnabled"
        :skills="skills"
        :prompt-skills="promptSkills"
        :mcp-servers="mcpServers"
        :skill-ids="skillIds"
        :prompt-skill-dirs="promptSkillDirs"
        :mcp-ids="mcpIds"
        @update:mode="$emit('update:mode', $event)"
        @update:web-search="$emit('update:webSearch', $event)"
        @attach="$emit('attach', $event)"
        @gallery="$emit('gallery')"
        @workspace="$emit('workspace')"
        @update:skill-ids="$emit('update:skillIds', $event)"
        @update:prompt-skill-dirs="$emit('update:promptSkillDirs', $event)"
        @update:mcp-ids="$emit('update:mcpIds', $event)"
      />
      <button
        type="button"
        tabindex="-1"
        class="h-8 w-8 flex items-center justify-center rounded-full text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-all disabled:opacity-40 outline-none focus:outline-none focus:ring-0"
        title="附加文档"
        :disabled="plusDisabled"
        @click="$emit('attach', 'document')"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="M10 9H8" />
          <path d="M16 13H8" />
          <path d="M16 17H8" />
        </svg>
      </button>
      <button
        type="button"
        tabindex="-1"
        class="h-8 w-8 flex items-center justify-center rounded-full text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-all disabled:opacity-40 outline-none focus:outline-none focus:ring-0"
        title="插入提示词"
        :disabled="plusDisabled"
        @click="$emit('prompt')"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
      </button>
      <button
        type="button"
        tabindex="-1"
        class="h-8 w-8 flex items-center justify-center rounded-full text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-all disabled:opacity-40 outline-none focus:outline-none focus:ring-0"
        title="把当前输入存为对话快捷键"
        :disabled="plusDisabled || !canSavePreset"
        @click="$emit('save-preset')"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
        </svg>
      </button>
      <div :class="lockModel ? 'pointer-events-none opacity-60' : ''">
        <ChatPermissionSwitcher
          :mode="permissionMode"
          :bot-default="botDefault"
          @change="$emit('permission-change', $event)"
        />
      </div>
    </div>

    <div class="flex items-center gap-1 flex-shrink-0">
      <div :class="lockModel ? 'pointer-events-none opacity-60' : ''">
        <ChatModelSwitcher
          type="chat"
          :provider-id="chatProviderId"
          :model-id="chatModelId"
          prefix=""
          align="end"
          chip
          @change="$emit('chat-model-change', $event)"
        />
      </div>
      <div v-if="showImageModel" :class="lockModel ? 'pointer-events-none opacity-60' : ''">
        <ChatModelSwitcher
          type="image"
          :provider-id="imageProviderId"
          :model-id="imageModelId"
          prefix=""
          align="end"
          chip
          @change="$emit('image-model-change', $event)"
        />
      </div>
      <button
        v-if="streaming && !cancelling"
        type="button"
        tabindex="-1"
        class="h-8 w-8 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 transition-all outline-none focus:outline-none focus:ring-0"
        title="停止"
        @click="$emit('cancel')"
      >
        <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>
      </button>
      <button
        v-else-if="cancelling"
        type="button"
        tabindex="-1"
        disabled
        class="h-8 w-8 flex items-center justify-center rounded-full bg-surface-2 text-text-tertiary cursor-not-allowed outline-none"
        title="中断中"
      >
        <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
      </button>
      <button
        v-else
        type="button"
        tabindex="-1"
        :disabled="!canSend"
        :title="sendTitle"
        :class="[
          'h-8 w-8 flex items-center justify-center rounded-full text-white transition-all outline-none focus:outline-none focus:ring-0',
          canSend ? 'bg-[#3B82F6] hover:bg-[#2563EB]' : 'bg-surface-3 cursor-not-allowed'
        ]"
        @click="$emit('send')"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 19V5" />
          <path d="m5 12 7-7 7 7" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ChatPlusPanel from '@/components/ChatPlusPanel.vue'
import type { ChatTaskMode } from '@/components/ChatPlusPanel.vue'
import ChatPermissionSwitcher from '@/components/ChatPermissionSwitcher.vue'
import ChatModelSwitcher from '@/components/ChatModelSwitcher.vue'
import type { ToolApproval } from '@/stores/bots'

const props = withDefaults(defineProps<{
  mode?: ChatTaskMode
  webSearch?: boolean
  disabled?: boolean
  workspaceEnabled?: boolean
  permissionMode?: string
  botDefault?: ToolApproval
  chatProviderId?: string
  chatModelId?: string
  showImageModel?: boolean
  imageProviderId?: string
  imageModelId?: string
  canSend?: boolean
  canSavePreset?: boolean
  streaming?: boolean
  cancelling?: boolean
  sendTitle?: string
  lockModel?: boolean
  skills?: { id: string; name: string }[]
  promptSkills?: { dirName: string; name: string }[]
  mcpServers?: { id: string; name: string; enabled: boolean }[]
  skillIds?: string[]
  promptSkillDirs?: string[]
  mcpIds?: string[]
}>(), {
  mode: null,
  webSearch: false,
  disabled: false,
  workspaceEnabled: true,
  permissionMode: '',
  botDefault: 'destructive',
  chatProviderId: '',
  chatModelId: '',
  showImageModel: false,
  imageProviderId: '',
  imageModelId: '',
  canSend: false,
  canSavePreset: false,
  streaming: false,
  cancelling: false,
  sendTitle: '发送',
  lockModel: false,
  skills: () => [],
  promptSkills: () => [],
  mcpServers: () => [],
  skillIds: () => [],
  promptSkillDirs: () => [],
  mcpIds: () => []
})

const plusDisabled = computed(() => props.disabled)

defineEmits<{
  'update:mode': [ChatTaskMode]
  'update:webSearch': [boolean]
  attach: ['image' | 'document']
  gallery: []
  workspace: []
  prompt: []
  'save-preset': []
  'permission-change': [ToolApproval]
  'chat-model-change': [{ provider_id: string; model_id: string }]
  'image-model-change': [{ provider_id: string; model_id: string }]
  send: []
  cancel: []
  'update:skillIds': [string[]]
  'update:promptSkillDirs': [string[]]
  'update:mcpIds': [string[]]
}>()
</script>
