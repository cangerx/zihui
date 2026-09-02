<template>
  <div class="h-full flex flex-col bg-surface-0">
    <!-- 顶栏：工作区 Tab + 会话 Tab，对齐 NewMax -->
    <header
      class="h-[52px] flex-shrink-0 flex items-center gap-1 px-3"
      :class="[isWin ? 'pr-40' : '', (isWin || isMac) ? 'app-drag' : '']"
    >
      <WorkspaceSwitcher class="min-w-0 flex-1" />

      <div class="w-px h-4 bg-surface-3 mx-1 flex-shrink-0" />

      <select
        v-if="chatStore.currentConversationId"
        :value="chatStore.currentConversation?.workspace_id || ''"
        :disabled="chatStore.streaming"
        class="no-drag h-8 max-w-[10rem] rounded-lg border border-surface-2 bg-surface-0 px-2 text-xs text-text-secondary disabled:opacity-50"
        title="当前任务工作区（切换后只影响本对话）"
        @change="changeConversationWorkspace"
      >
        <option value="">继承数字员工默认工作区</option>
        <option v-for="workspace in agentWorkspaceStore.items" :key="workspace.id" :value="workspace.id">
          {{ workspace.name }}
        </option>
      </select>

      <div class="relative min-w-0 no-drag" ref="convSelectorRef">
        <button
          type="button"
          @click="showConvSelector = !showConvSelector"
          class="flex items-center gap-1.5 h-8 max-w-[14rem] px-2.5 text-xs rounded-lg font-medium transition-colors"
          :class="showConvSelector || chatStore.currentConversationId
            ? 'bg-surface-1 text-text-primary'
            : 'text-text-secondary hover:bg-surface-1'"
        >
          <span class="truncate">{{ currentConvTitle }}</span>
          <svg class="w-3 h-3 text-text-tertiary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
        </button>
        <div v-if="showConvSelector" class="absolute top-full left-0 mt-1 w-64 bg-surface-0 border border-surface-3 rounded-xl shadow-modal z-50 py-1 max-h-72 overflow-y-auto">
          <div class="px-3 py-1.5 text-[10px] text-text-tertiary">最近对话</div>
          <div v-if="!chatStore.conversations.length" class="px-3 py-3 text-xs text-text-tertiary">还没有开始对话</div>
          <div
            v-for="conv in chatStore.conversations"
            :key="conv.id"
            class="group flex items-center gap-1 px-1.5"
          >
            <button
              type="button"
              @click="chatStore.selectConversation(conv.id); showConvSelector = false"
              :class="['flex-1 min-w-0 text-left px-2 py-2 text-xs rounded-lg truncate transition-colors', conv.id === chatStore.currentConversationId ? 'bg-surface-2 text-text-primary font-medium' : 'text-text-secondary hover:bg-surface-1']"
            >
              {{ conv.title === 'New Chat' || !conv.title ? '新对话' : conv.title }}
            </button>
            <button
              type="button"
              @click.stop="confirmDeleteId = confirmDeleteId === conv.id ? null : conv.id"
              :disabled="chatStore.isConversationStreaming(conv.id)"
              class="opacity-0 group-hover:opacity-100 p-1 text-text-tertiary hover:text-red-500 disabled:opacity-20"
              title="删除"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <template v-if="confirmDeleteId === conv.id">
              <button type="button" class="text-[10px] text-red-500 px-1" @click.stop="chatStore.deleteConversation(conv.id); confirmDeleteId = null">确认</button>
            </template>
          </div>
        </div>
      </div>

      <button
        type="button"
        @click="newConversation"
        class="h-8 w-8 flex items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-1 transition-colors flex-shrink-0"
        title="新对话"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
      </button>

      <div class="ml-auto flex items-center gap-1 flex-shrink-0 no-drag">
        <div class="relative no-drag" ref="botSelectorRef">
          <button
            type="button"
            @click="showBotSelector = !showBotSelector"
            class="flex items-center gap-1.5 h-8 px-2.5 text-xs rounded-lg text-text-secondary hover:bg-surface-1 transition-colors"
            title="数字员工"
          >
            <span class="max-w-[8rem] truncate">{{ selectedBotName }}</span>
            <svg class="w-3 h-3 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
          </button>
          <div v-if="showBotSelector" class="absolute top-full right-0 mt-1 w-52 bg-surface-0 border border-surface-3 rounded-xl shadow-modal z-50 py-1 max-h-60 overflow-y-auto">
            <button
              type="button"
              @click="selectedBotId = ''; showBotSelector = false"
              :class="['w-full text-left px-3 py-2 text-xs transition-colors', !selectedBotId ? 'bg-surface-2 text-text-primary font-medium' : 'text-text-secondary hover:bg-surface-1']"
            >
              默认
            </button>
            <div v-if="!bots.length" class="px-3 py-2 text-xs text-text-tertiary">暂无其它数字员工</div>
            <button
              v-for="bot in bots"
              :key="bot.id"
              type="button"
              @click="selectedBotId = bot.id; showBotSelector = false"
              :class="['w-full text-left px-3 py-2 text-xs transition-colors', bot.id === selectedBotId ? 'bg-surface-2 text-text-primary font-medium' : 'text-text-secondary hover:bg-surface-1']"
            >
              {{ bot.name }}
            </button>
          </div>
        </div>
        <button
          type="button"
          @click="toggleFilesPanel"
          class="h-8 px-2.5 text-xs font-medium rounded-lg transition-colors"
          :class="filesPanelOpen
            ? 'bg-surface-1 text-text-primary'
            : 'text-text-secondary hover:bg-surface-1 hover:text-text-primary'"
          title="工作区文件"
        >文件</button>
        <button
          v-if="chatStore.currentConversationId"
          type="button"
          class="h-8 px-2.5 text-xs font-medium rounded-lg text-text-secondary hover:bg-surface-1 hover:text-text-primary transition-colors disabled:opacity-40"
          :disabled="exportingWord || !hasExportableContent"
          title="导出为 Word"
          @click="exportConversationWord"
        >导出 Word</button>
        <button
          v-if="chatStore.currentConversationId"
          type="button"
          class="h-8 px-2.5 text-xs font-medium rounded-lg text-text-secondary hover:bg-surface-1 hover:text-text-primary transition-colors disabled:opacity-40"
          :disabled="distillBusy || chatStore.streaming || !hasExportableContent"
          :title="distillBusy ? '正在保存对话记忆…' : '把低风险结论和待办保存为工作区对话记忆'"
          @click="runDistill(true)"
        >{{ distillBusy ? '保存中' : '对话记忆' }}</button>
        <select
          v-if="chatStore.currentConversationId && chatStore.currentConversation?.bot_id"
          v-model="employeeCandidateType"
          class="h-8 rounded-lg border border-surface-2 bg-surface-0 px-2 text-xs text-text-secondary"
          title="选择要保存的岗位资产类型"
        >
          <option value="workflow">工作流程</option>
          <option value="responsibility">负责事项</option>
          <option value="boundary">职责边界</option>
          <option value="acceptance">验收标准</option>
          <option value="knowledge">岗位知识</option>
          <option value="skill">Skill</option>
        </select>
        <button
          v-if="chatStore.currentConversationId && chatStore.currentConversation?.bot_id"
          type="button"
          class="h-8 px-2.5 text-xs font-medium rounded-lg text-text-secondary hover:bg-surface-1 hover:text-text-primary transition-colors disabled:opacity-40"
          :disabled="employeeCandidateBusy || chatStore.streaming || !hasExportableContent"
          title="把最近一次数字员工回复保存为候选，确认后才生效"
          @click="createEmployeeCandidate"
        >{{ employeeCandidateBusy ? '保存中' : '岗位建议' }}</button>
      </div>
    </header>

    <div class="flex-1 flex overflow-hidden min-h-0">
      <!-- Chat Area -->
      <div class="flex-1 flex flex-col relative min-w-0">
        <div v-if="!chatStore.currentConversationId" class="flex-1 flex flex-col items-center justify-center px-6 py-10 overflow-y-auto">
          <div class="w-full max-w-4xl flex flex-col items-center">
            <button
              v-if="showWorkspaceHint"
              type="button"
              class="mb-8 px-3 py-1.5 text-[12px] text-text-secondary bg-surface-1 rounded-full hover:bg-surface-2 transition-colors max-w-full"
              title="打开现有文件夹作为工作区"
              @click="pickWorkspaceFolder"
            >
              把工作区路径设为项目、素材或写作目录，AI 才能读写对应文件
            </button>
            <h2 class="text-[30px] font-semibold text-text-primary tracking-tight mb-10 text-center leading-snug">{{ emptyGreeting }}</h2>

            <div
              class="w-full flex flex-col bg-white rounded-[24px] border border-black/[0.06] shadow-[0_8px_28px_rgba(15,23,42,0.08)] focus-within:border-black/10 transition-all mb-5"
            >
              <div v-if="composerAssist.errorText.value" class="px-4 pt-3 text-[11px] text-red-500">{{ composerAssist.errorText.value }}</div>
              <PromptTextarea
                ref="emptyInputEl"
                v-model="inputText"
                @submit="onEmptyStart"
                @tab="composerAssist.onTab"
                @optimize="composerAssist.optimize"
                title="开始任务"
                :min-height="56"
                :max-height="160"
                auto-grow
                hide-expand
                plain
                submit-on-enter
                inline-edit
                :show-count="false"
                :placeholder="emptyPlaceholder"
                :ghost-text="composerAssist.suggestion.value"
                :tab-hint="true"
                :optimizing="composerAssist.busy.value === 'optimize'"
                container-class="mx-4 mt-4 mb-2"
                input-class="text-[15px] leading-normal"
              />
              <div v-if="pendingAttachments.length" class="flex gap-2 flex-wrap px-4 pb-2">
                <div v-for="(att, i) in pendingAttachments" :key="i" class="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface-1 border border-surface-3 rounded-lg text-xs text-text-secondary">
                  <span class="max-w-[120px] truncate">{{ att.name }}</span>
                  <button type="button" @click="pendingAttachments.splice(i, 1)" class="text-text-tertiary hover:text-text-primary">
                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
              <div class="px-3.5 pb-3.5">
                <ChatComposerToolbar
                  v-model:mode="taskMode"
                  v-model:web-search="webSearchEnabled"
                  v-model:skill-ids="tempSkillIds"
                  v-model:prompt-skill-dirs="tempPromptSkillDirs"
                  v-model:mcp-ids="tempMcpIds"
                  :skills="userSkills"
                  :prompt-skills="promptSkillStore.skills"
                  :mcp-servers="mcpStore.servers"
                  :permission-mode="draftToolApproval"
                  :bot-default="(currentBot?.tool_approval as any) || 'destructive'"
                  :chat-provider-id="draftChatModel.provider_id"
                  :chat-model-id="draftChatModel.model_id"
                  :show-image-model="imageGenEnabled"
                  :image-provider-id="draftImageModel.provider_id"
                  :image-model-id="draftImageModel.model_id"
                  :can-send="!!inputText.trim() && !emptyStarting"
                  :can-save-preset="!!inputText.trim()"
                  :send-title="emptyStartHint"
                  @attach="pickFile"
                  @gallery="openGalleryForChat"
                  @workspace="openWorkspace"
                  @prompt="showQuickPrompt = true"
                  @save-preset="openSaveChatPreset"
                  @permission-change="onDraftToolApprovalChange"
                  @chat-model-change="onDraftChatModelChange"
                  @image-model-change="onDraftImageModelChange"
                  @send="onEmptyStart"
                />
              </div>
            </div>
            <div v-if="taskMode || webSearchEnabled" class="w-full flex flex-wrap justify-center gap-1.5 mb-4 -mt-2">
              <button
                v-if="taskMode"
                type="button"
                class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-primary-50 text-primary-700 border border-primary-100"
                @click="taskMode = null"
              >
                {{ taskModeLabel }}
                <span class="opacity-60">×</span>
              </button>
              <button
                v-if="webSearchEnabled"
                type="button"
                class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-surface-2 text-text-secondary border border-surface-3"
                @click="webSearchEnabled = false"
              >
                联网搜索
                <span class="opacity-60">×</span>
              </button>
            </div>
            <div class="w-full flex flex-wrap justify-center items-center gap-2">
              <button
                v-for="(cap, idx) in visibleCapsules"
                :key="cap.key"
                type="button"
                @click="onCapsule(cap)"
                :class="idx === 0 && !showMoreCapsules
                  ? 'inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs rounded-full bg-text-primary text-white hover:opacity-90 transition-colors'
                  : 'px-3 py-1.5 text-xs rounded-full bg-surface-1 text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors'"
              >
                <svg v-if="idx === 0 && !showMoreCapsules" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                </svg>
                {{ cap.label }}
              </button>
              <button
                type="button"
                class="h-7 w-7 flex items-center justify-center rounded-full text-text-tertiary hover:text-text-primary hover:bg-surface-1 transition-colors"
                title="设置"
                @click="settingsUi.show()"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        <template v-else>
          <!-- Messages -->
          <div ref="messagesContainer" class="flex-1 overflow-y-auto px-6 py-6" @click="onMessagesClick">
            <div class="max-w-4xl mx-auto px-4 space-y-6">
              <div v-for="msg in renderedMessages" :key="msg.id" :class="['flex group/msg', msg.role === 'user' ? 'justify-end' : '']">
                <div :class="['relative min-w-0', msg.role === 'user' ? 'max-w-[80%] flex flex-col items-end' : 'w-full']">
                  <div v-if="msg.role === 'user'" class="w-full flex flex-col items-end">
                    <div v-if="editingMsgId === msg.id" class="w-full flex flex-col gap-1.5">
                      <textarea v-model="editingText" rows="3" class="w-full px-3 py-2 text-sm rounded-2xl border border-primary-300 bg-surface-0 text-text-primary resize-y focus:outline-none focus:ring-1 focus:ring-primary-400"></textarea>
                      <div class="flex gap-2 justify-end">
                        <button @click="cancelEdit" class="px-3 py-1 text-xs rounded-lg border border-surface-3 text-text-secondary hover:bg-surface-2 transition-colors">取消</button>
                        <button @click="confirmEdit(msg.id)" class="px-3 py-1 text-xs rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors">保存并重发</button>
                      </div>
                    </div>
                    <template v-else>
                      <div :class="['text-sm px-4 py-2.5 rounded-2xl rounded-tr-md leading-relaxed whitespace-pre-wrap select-text', msg.failed ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-surface-1 text-text-primary']">
                        {{ msg.content }}
                      </div>
                      <div v-if="msg.failed" class="mt-1 text-[11px] text-red-500">发送失败，请重新发送</div>
                      <div class="mt-1 flex items-center justify-end gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                        <button type="button" class="px-1.5 py-0.5 text-[11px] rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-2" @click="copyMessage(msg)">{{ copiedId === msg.id ? '已复制' : '复制' }}</button>
                        <button v-if="!chatStore.streaming" type="button" class="px-1.5 py-0.5 text-[11px] rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-2" @click="startEdit(msg)">编辑</button>
                        <button v-if="!chatStore.streaming" type="button" class="px-1.5 py-0.5 text-[11px] rounded-md text-text-tertiary hover:text-red-600 hover:bg-red-50" @click="chatStore.deleteMessage(msg.id)">删除</button>
                      </div>
                    </template>
                  </div>
                  <template v-else>
                    <div class="flex items-center justify-between gap-2 mb-1.5">
                      <span class="text-[11px] text-text-tertiary">{{ selectedBotName }}</span>
                      <div
                        v-if="msg.id !== '__live__'"
                        :data-dispatch-id="msg.id"
                        class="relative"
                      >
                        <button
                          @click.stop="toggleDispatchMenu(msg.id)"
                          :class="['p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-2', dispatchMenuId === msg.id ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100']"
                          title="发送到"
                        >
                          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" /></svg>
                        </button>
                        <div v-if="dispatchMenuId === msg.id" class="absolute right-0 top-full mt-1 w-36 py-1 rounded-lg bg-surface-0 border border-surface-3 shadow-[0_8px_24px_rgba(0,0,0,0.12)] z-20">
                          <button @click.stop="dispatchTo('imageGen', msg)" class="w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors">AI 生图</button>
                          <button @click.stop="dispatchTo('batchGen', msg)" class="w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors">批量生图</button>
                          <button @click.stop="dispatchTo('canvasOrchestrate', msg)" class="w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors">流式画布</button>
                          <button @click.stop="saveMessageAsImagePreset(msg)" class="w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors">存为生图预设</button>
                          <button v-if="canSaveMessageAsSkill(msg)" @click.stop="saveMessageAsSkill(msg)" class="w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors">保存为技能</button>
                          <button v-if="canSaveMessageAsPrompt(msg)" @click.stop="saveMessageAsPrompt(msg)" class="w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors">保存为提示词</button>
                        </div>
                      </div>
                    </div>
                    <div v-if="msg._reasoning" class="mb-2">
                      <button
                        type="button"
                        @click="toggleReasoning(msg)"
                        class="w-full flex items-center gap-1.5 text-[12px] text-text-tertiary hover:text-text-secondary transition-colors"
                      >
                        <svg v-if="msg._reasoningActive" class="w-3 h-3 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                        <span>{{ reasoningTitle(msg) }}</span>
                        <svg
                          :class="['w-3 h-3 flex-shrink-0 transition-transform', (msg._reasoningActive || !msg._reasoningCollapsed) ? '' : 'rotate-180']"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        ><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m5 15 7-7 7 7" /></svg>
                      </button>
                      <div
                        v-if="msg._reasoningActive || msg._reasoningCollapsed === false"
                        class="mt-2 text-[13px] text-text-secondary leading-6 whitespace-pre-wrap"
                      >{{ msg._reasoning }}</div>
                      <div
                        v-if="msg._reasoningActive || msg._reasoningCollapsed === false"
                        class="mt-2 text-[11px] text-text-tertiary"
                      >{{ reasoningFooter(msg) }}</div>
                    </div>
                    <div v-if="msg._toolLogs?.length" class="mb-1.5">
                      <button
                        @click="msg._toolActive ? (msg._toolActive = false) : (msg._collapsed = !msg._collapsed)"
                        class="flex items-center gap-1.5 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors px-2 py-1 rounded-lg hover:bg-surface-2"
                      >
                        <svg :class="['w-3 h-3 transition-transform', (msg._toolActive || !msg._collapsed) ? 'rotate-90' : '']" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m9 5 7 7-7 7" /></svg>
                        <svg v-if="msg._toolActive" class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                        {{ msg._toolLogs.length }} 步工具调用
                      </button>
                      <div v-if="msg._toolActive || !msg._collapsed" class="mt-1 max-h-32 overflow-y-auto rounded-lg bg-surface-2/50 border border-surface-3 px-3 py-2 text-[11px] font-mono text-text-tertiary leading-relaxed whitespace-pre-wrap">{{ msg._toolLogs.join('\n') }}</div>
                    </div>
                    <AskUserCard
                      v-if="msg.card && msg.card.type === 'ask_user'"
                      :card="msg.card"
                      :asker-name="selectedBotName"
                      @submit="(payload) => onCardSubmit(msg, payload)"
                    />
                    <ImageParamsCard
                      v-else-if="msg.card && msg.card.type === 'image_params'"
                      :card="msg.card"
                      @submit="(payload) => onCardSubmit(msg, payload)"
                    />
                    <div
                      v-else-if="String(msg.content || '').trim()"
                      class="text-sm py-1 text-text-primary prose prose-sm dark:prose-invert max-w-none select-text leading-relaxed"
                      v-html="msg.id === '__live__' ? renderMarkdownLive(msg.content) : renderMarkdown(msg.content)"
                    ></div>
                    <!-- 从中断处继续生成（仅末条、被中断/报错、且当前未在流式时显示） -->
                    <div
                      v-if="msg.role === 'assistant' && msg.id !== '__live__'"
                      class="mt-2 flex flex-wrap items-center gap-2"
                    >
                      <button
                        v-if="msg.id === lastAssistantId && !chatStore.streaming && isContinuable(msg.content)"
                        @click="chatStore.continueGenerate()"
                        class="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-surface-3 bg-surface-0 text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors"
                        title="保留已生成的内容，让模型接着写"
                      >
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                        继续生成
                      </button>
                      <button
                        v-if="String(msg.content || '').trim()"
                        type="button"
                        class="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-surface-3 bg-surface-0 text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors disabled:opacity-40"
                        :disabled="exportingWord"
                        title="导出为 Word"
                        @click="exportMessageWord(msg)"
                      >导出 Word</button>
                      <button
                        v-if="canSaveMessageAsSkill(msg)"
                        type="button"
                        class="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-text-primary text-surface-0 hover:opacity-90 transition-opacity disabled:opacity-40"
                        :disabled="savingSkillId === msg.id"
                        @click="saveMessageAsSkill(msg)"
                      >{{ savingSkillId === msg.id ? '保存中...' : '保存为技能' }}</button>
                      <button
                        v-if="canSaveMessageAsPrompt(msg)"
                        type="button"
                        class="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-text-primary text-surface-0 hover:opacity-90 transition-opacity"
                        @click="saveMessageAsPrompt(msg)"
                      >保存为提示词</button>
                      <button
                        type="button"
                        class="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-surface-3 bg-surface-0 text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors"
                        @click="copyMessage(msg)"
                      >{{ copiedId === msg.id ? '已复制' : '复制' }}</button>
                      <button
                        v-if="msg.id === lastAssistantId && !chatStore.streaming"
                        type="button"
                        class="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-surface-3 bg-surface-0 text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors"
                        @click="chatStore.regenerate()"
                      >重新生成</button>
                      <button
                        v-if="!chatStore.streaming"
                        type="button"
                        class="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-surface-3 bg-surface-0 text-text-secondary hover:text-red-600 hover:bg-red-50 transition-colors"
                        @click="chatStore.deleteMessage(msg.id)"
                      >删除</button>
                    </div>
                  </template>
                  <div v-if="msg.attachments?.length" class="mt-1.5 flex gap-1.5 flex-wrap" :class="msg.role === 'user' ? 'justify-end' : ''">
                    <template v-for="(att, i) in msg.attachments" :key="i">
                      <img v-if="att.type === 'image' && att.data" :src="att.data" @click="previewImage = att.data" class="w-20 h-20 object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity border border-surface-3" :alt="att.name" />
                      <div v-else class="text-xs px-2.5 py-1 bg-surface-2 rounded-md text-text-secondary">{{ att.name || att.type }}</div>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Input：悬浮卡片，对齐 NewMax 输入盒 -->
          <div class="px-6 pb-5 pt-2 bg-gradient-to-t from-surface-1 via-surface-1 to-transparent">
            <div class="max-w-4xl mx-auto">
              <div v-if="distillHint" class="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-xl bg-surface-1 border border-surface-2 text-[11px] text-text-secondary">
                {{ distillHint }}
              </div>
              <div
                v-else-if="skillCreateMode"
                class="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-xl bg-surface-1 border border-surface-2 text-[11px] text-text-secondary"
              >
                <span class="truncate flex-1">正在创建技能。说清用途后生成 SKILL.md，再点「保存为技能」。</span>
                <button type="button" class="flex-shrink-0 px-2 py-0.5 rounded-lg bg-surface-0 border border-surface-3 hover:bg-surface-2" @click="skillCreateMode = false">退出</button>
              </div>
              <div
                v-else-if="promptCreateMode"
                class="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-xl bg-surface-1 border border-surface-2 text-[11px] text-text-secondary"
              >
                <span class="truncate flex-1">{{ promptCreateBanner }}</span>
                <button type="button" class="flex-shrink-0 px-2 py-0.5 rounded-lg bg-surface-0 border border-surface-3 hover:bg-surface-2" @click="promptCreateMode = false">退出</button>
              </div>
              <div
                v-else-if="distillBanner"
                class="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-xl bg-surface-1 border border-surface-2 text-[11px] text-text-secondary"
              >
                <span class="truncate flex-1">要把低风险结论、决策和待办保存为工作区对话记忆吗？</span>
                <button type="button" class="flex-shrink-0 px-2 py-0.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700" @click="runDistill(true)">保存记忆</button>
                <button type="button" class="flex-shrink-0 px-2 py-0.5 rounded-lg bg-surface-0 border border-surface-3 hover:bg-surface-2" @click="skipDistillPrompt">这次不用</button>
                <button type="button" class="flex-shrink-0 px-2 py-0.5 rounded-lg bg-surface-0 border border-surface-3 hover:bg-surface-2" @click="enableAutoDistill">改为自动</button>
              </div>
              <div v-if="attachLimitMsg" class="flex items-center gap-2 mb-2 px-1 text-xs text-amber-600">
                最多添加 {{ MAX_ATTACHMENTS }} 个附件
              </div>
              <div
                v-if="activeBrandBanner"
                class="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-xl bg-surface-1 border border-surface-2 text-[11px] text-text-secondary"
              >
                <span class="truncate flex-1">
                  品牌 · <span class="font-medium text-text-primary">{{ activeBrandBanner.name }}</span>
                  <span class="text-text-tertiary"> · 规范已注入 · 生图自动归档产出目录</span>
                </span>
                <button
                  type="button"
                  class="flex-shrink-0 px-2 py-0.5 rounded-lg bg-surface-0 border border-surface-3 hover:border-primary-400 text-text-primary"
                  @click="openBrandGalleryForChat"
                >选品牌参考图</button>
              </div>
              <div v-if="attachmentError" class="flex items-center gap-2 mb-2 px-1 text-xs text-red-500">
                {{ attachmentError }}
              </div>
              <div v-if="attachmentNotice" class="flex items-center gap-2 mb-2 px-1 text-xs text-amber-600">
                {{ attachmentNotice }}
              </div>
              <div v-if="loadingAttachment" class="flex items-center gap-2 mb-2 px-1 text-xs text-text-tertiary">
                <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                正在处理附件...
              </div>
              <div v-if="pendingAttachments.length" class="flex gap-2 flex-wrap mb-2 px-1">
                <div v-for="(att, i) in pendingAttachments" :key="i" class="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface-0 border border-surface-3 rounded-lg text-xs text-text-secondary group">
                  <span class="max-w-[120px] truncate">{{ att.name }}</span>
                  <button @click="pendingAttachments.splice(i, 1)" class="text-text-tertiary hover:text-text-primary ml-0.5">
                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
              <div v-if="taskMode || webSearchEnabled" class="flex flex-wrap gap-1.5 mb-2 px-1">
                <button
                  v-if="taskMode"
                  type="button"
                  class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-primary-50 text-primary-700 border border-primary-100"
                  @click="taskMode = null"
                >
                  {{ taskModeLabel }}
                  <span class="opacity-60">×</span>
                </button>
                <button
                  v-if="webSearchEnabled"
                  type="button"
                  class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-surface-2 text-text-secondary border border-surface-3"
                  @click="webSearchEnabled = false"
                >
                  联网搜索
                  <span class="opacity-60">×</span>
                </button>
              </div>
              <div
                :class="['flex flex-col bg-white rounded-[24px] border shadow-[0_8px_28px_rgba(15,23,42,0.08)] transition-all', dragging ? 'border-[#3B82F6]' : 'border-black/[0.06]']"
                @dragover.prevent="dragging = true"
                @dragleave.prevent="dragging = false"
                @drop.prevent="handleDrop"
              >
                <div v-if="composerAssist.errorText.value" class="px-4 pt-3 text-[11px] text-red-500">{{ composerAssist.errorText.value }}</div>
                <PromptTextarea
                  ref="inputEl"
                  v-model="inputText"
                  @paste="handlePaste"
                  @submit="send"
                  @tab="composerAssist.onTab"
                  @optimize="composerAssist.optimize"
                  title="编辑消息"
                  :min-height="48"
                  :max-height="160"
                  auto-grow
                  hide-expand
                  plain
                  submit-on-enter
                  inline-edit
                  :show-count="false"
                  :placeholder="composerPlaceholder"
                  :ghost-text="composerAssist.suggestion.value"
                  :tab-hint="true"
                  :optimizing="composerAssist.busy.value === 'optimize'"
                  container-class="mx-4 mt-3.5 mb-1"
                  input-class="text-[15px] leading-normal"
                />
                <div class="px-3.5 pb-3.5">
                  <ChatComposerToolbar
                    v-model:mode="taskMode"
                    v-model:web-search="webSearchEnabled"
                    v-model:skill-ids="tempSkillIds"
                    v-model:prompt-skill-dirs="tempPromptSkillDirs"
                    v-model:mcp-ids="tempMcpIds"
                    :skills="userSkills"
                    :prompt-skills="promptSkillStore.skills"
                    :mcp-servers="mcpStore.servers"
                    :lock-model="chatStore.streaming"
                    :permission-mode="chatStore.currentConversation?.tool_approval || ''"
                    :bot-default="(currentBot?.tool_approval as any) || 'destructive'"
                    :chat-provider-id="chatStore.currentConversation?.active_model_provider_id || ''"
                    :chat-model-id="chatStore.currentConversation?.active_model_id || ''"
                    :show-image-model="imageGenEnabled"
                    :image-provider-id="chatStore.currentConversation?.active_image_provider_id || ''"
                    :image-model-id="chatStore.currentConversation?.active_image_model_id || ''"
                    :can-send="!!(inputText.trim() || pendingAttachments.length)"
                    :can-save-preset="!!inputText.trim()"
                    :streaming="chatStore.streaming"
                    :cancelling="chatStore.isCancelling()"
                    @attach="pickFile"
                    @gallery="openGalleryForChat"
                    @workspace="openWorkspace"
                    @prompt="showQuickPrompt = true"
                    @save-preset="openSaveChatPreset"
                    @permission-change="onToolApprovalChange"
                    @chat-model-change="onChatModelChange"
                    @image-model-change="onImageModelChange"
                    @send="send"
                    @cancel="onCancelGeneration()"
                  />
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <ChatWorkspaceFilesPanel
        v-if="filesPanelOpen"
        :workspace-id="agentWorkspaceStore.activeId"
        :workspace-name="agentWorkspaceStore.activeName"
        @close="filesPanelOpen = false"
      />
    </div>
  </div>

  <!-- Quick Prompt Modal -->
  <div v-if="showQuickPrompt" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="showQuickPrompt = false">
    <div class="w-[520px] max-h-[70vh] bg-surface-0 border border-surface-3 rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] flex flex-col">
      <div class="px-5 pt-4 pb-3 border-b border-surface-3">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-text-primary">插入提示词</h3>
          <div class="flex items-center gap-3">
            <label class="flex items-center gap-1.5 cursor-pointer" @click.stop="toggleQuickDirectSend">
              <div :class="['w-7 h-4 rounded-full transition-colors relative', quickDirectSend ? 'bg-primary-600' : 'bg-surface-4']">
                <div :class="['absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm', quickDirectSend ? 'left-3.5' : 'left-0.5']"></div>
              </div>
              <span class="text-[10px] text-text-tertiary">直接发送</span>
            </label>
            <button
              type="button"
              class="text-[11px] text-primary-600 hover:text-primary-700"
              @click="toggleQuickPromptForm"
            >{{ showQuickPromptForm ? '取消新建' : '+ 新建' }}</button>
            <button @click="showQuickPrompt = false" class="p-1 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <input v-model="quickPromptSearch" placeholder="搜索提示词..." class="w-full px-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-1 outline-none focus:ring-2 focus:ring-primary-500" />
        <div v-if="showQuickPromptForm" class="mt-3 space-y-2 p-3 rounded-xl bg-surface-1 border border-surface-2">
          <input v-model="quickPromptForm.label" class="input-field text-xs" placeholder="名称，例如：写周报" />
          <textarea v-model="quickPromptForm.content" rows="3" class="textarea-field text-xs" placeholder="插入到输入框的内容" />
          <div class="flex items-center gap-2">
            <button type="button" class="btn-primary text-xs px-3 py-1" :disabled="savingQuickPrompt" @click="saveQuickPrompt">保存</button>
            <span v-if="quickPromptFormError" class="text-[10px] text-red-500">{{ quickPromptFormError }}</span>
          </div>
        </div>
        <div v-if="quickCategories.length" class="flex flex-wrap gap-1.5 mt-2.5">
          <button
            @click="quickPromptCategory = ''"
            :class="['px-2.5 py-1 text-[10px] rounded-md transition-colors', !quickPromptCategory ? 'bg-primary-600 text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3']"
          >全部</button>
          <button
            v-for="cat in quickCategories"
            :key="cat.id"
            @click="quickPromptCategory = quickPromptCategory === cat.id ? '' : cat.id"
            :class="['px-2.5 py-1 text-[10px] rounded-md transition-colors', quickPromptCategory === cat.id ? 'bg-primary-600 text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3']"
          >{{ cat.name }}</button>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto p-4">
        <template v-if="pagedQuickPresets.length">
          <div class="grid grid-cols-2 gap-2">
            <div
              v-for="item in pagedQuickPresets"
              :key="item.id"
              class="relative group"
            >
              <button
                type="button"
                @click="selectQuickPrompt(item.content)"
                class="w-full text-left px-3 py-2.5 rounded-xl border border-surface-3 hover:border-primary-400 hover:bg-primary-50 transition-colors"
              >
                <div class="text-xs font-medium text-text-primary mb-0.5 pr-5">{{ item.label }}</div>
                <div class="text-[10px] text-text-tertiary line-clamp-2">{{ item.content }}</div>
                <div class="text-[9px] text-text-disabled mt-1">{{ item.categoryName }}</div>
              </button>
              <button
                v-if="!item.is_builtin"
                type="button"
                class="absolute top-1.5 right-1.5 h-5 w-5 flex items-center justify-center rounded-md text-text-disabled hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                title="删除"
                @click.stop="removeQuickPrompt(item.id)"
              >
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        </template>
        <div v-else class="text-center py-8 text-xs text-text-tertiary">
          {{ quickPromptSearch || quickPromptCategory ? '没有匹配的提示词' : '还没有提示词，点上方「新建」添加' }}
        </div>
      </div>
      <div v-if="quickTotalPages > 1" class="flex items-center justify-center gap-2 px-5 py-2.5 border-t border-surface-3">
        <button @click="quickPage = Math.max(1, quickPage - 1)" :disabled="quickPage <= 1" class="px-2 py-1 text-[10px] rounded-md bg-surface-2 text-text-secondary hover:bg-surface-3 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">上一页</button>
        <span class="text-[10px] text-text-tertiary">{{ quickPage }} / {{ quickTotalPages }}</span>
        <button @click="quickPage = Math.min(quickTotalPages, quickPage + 1)" :disabled="quickPage >= quickTotalPages" class="px-2 py-1 text-[10px] rounded-md bg-surface-2 text-text-secondary hover:bg-surface-3 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">下一页</button>
      </div>
    </div>
  </div>

  <!-- Image Preview -->
  <ImageLightbox :src="previewImage" :on-locate="previewLocate" @close="previewImage = null" />

  <!-- Tool Approval Modal -->
  <div v-if="pendingApproval" class="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
    <div :class="['pointer-events-auto max-w-[90vw] rounded-xl bg-surface-0 shadow-[0_8px_40px_rgba(0,0,0,0.18)] border border-surface-3 overflow-hidden flex flex-col', approvalPreview ? 'w-[720px] max-h-[80vh]' : 'w-[480px]']">
      <div class="px-5 py-3 border-b border-surface-3 flex items-center gap-2 flex-shrink-0">
        <svg class="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
        <div class="text-sm font-semibold text-text-primary">调用工具确认</div>
      </div>
      <div class="px-5 py-4 space-y-3 overflow-y-auto">
        <div class="text-xs text-text-secondary">AI 请求调用工具 <code class="px-1.5 py-0.5 rounded bg-surface-2 text-primary-700 font-mono text-[11px]">{{ pendingApproval.tool }}</code>，是否允许？</div>

        <!-- File write/append preview with line diff -->
        <template v-if="approvalPreview && approvalPreview.type === 'file_write'">
          <div class="flex items-center gap-2 text-[11px]">
            <span :class="['px-1.5 py-0.5 rounded font-medium', approvalPreview.exists ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300']">{{ approvalPreview.exists ? '修改文件' : '新建文件' }}</span>
            <code class="font-mono text-text-secondary truncate flex-1" :title="approvalPreview.path">{{ approvalPreview.path }}</code>
            <span v-if="approvalDiffSummary" class="font-mono"><span class="text-emerald-600 dark:text-emerald-400">+{{ approvalDiffSummary.adds }}</span> <span class="text-red-500 dark:text-red-400">-{{ approvalDiffSummary.dels }}</span></span>
          </div>
          <div v-if="approvalPreview.tooLarge" class="text-[11px] text-text-tertiary">原文件超过 200KB，仅展示新内容预览。允许后原文件将被覆盖（同路径 .bak 会保留备份）。</div>
          <div v-else-if="approvalPreview.isBinary" class="text-[11px] text-text-tertiary">原文件为二进制，仅展示新内容预览。允许后同路径 .bak 保留备份。</div>
          <div class="rounded-lg border border-surface-3 overflow-hidden text-[11px] font-mono leading-relaxed max-h-[50vh] overflow-y-auto">
            <div v-for="(ln, i) in approvalDiffLines" :key="i" :class="['px-3 py-0.5 whitespace-pre-wrap break-words', ln.cls]"><span class="select-none mr-2 text-text-tertiary">{{ ln.sigil }}</span>{{ ln.text }}</div>
            <div v-if="approvalDiffTruncated" class="px-3 py-1 text-text-tertiary text-center bg-surface-2">… 剩余差异已省略</div>
          </div>
        </template>

        <!-- run_command preview -->
        <template v-else-if="pendingApproval.tool === 'run_command' && pendingApproval.args?.command">
          <div class="text-[11px] text-text-secondary">将执行命令：</div>
          <pre class="text-[12px] font-mono leading-relaxed bg-surface-2 rounded-lg p-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-amber-700">{{ pendingApproval.args.command }}</pre>
          <div v-if="pendingApproval.args.cwd" class="text-[11px] text-text-tertiary">工作目录：<code class="font-mono">{{ pendingApproval.args.cwd }}</code></div>
        </template>

        <!-- file_ops read preview -->
        <template v-else-if="approvalReadPreview">
          <div class="flex items-center gap-2 text-[11px]">
            <span :class="['px-1.5 py-0.5 rounded font-medium whitespace-nowrap', approvalReadPreview.outsideWorkspace ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300']">{{ approvalReadPreview.outsideWorkspace ? '读取工作区外文件' : '读取文件' }}</span>
            <code class="font-mono text-text-secondary truncate flex-1" :title="approvalReadPreview.path">{{ approvalReadPreview.path }}</code>
          </div>
          <div v-if="approvalReadPreview.outsideWorkspace" class="text-[11px] text-text-tertiary leading-relaxed">该路径在工作区之外，读取后内容会发送给 AI。请确认其中无敏感信息再允许。可在「设置 → 文件读取安全」将常用目录加入白名单，免去重复确认。</div>
        </template>

        <!-- Generic args fallback -->
        <pre v-else class="text-[11px] font-mono leading-relaxed bg-surface-2 rounded-lg p-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-text-secondary">{{ formattedApprovalArgs }}</pre>
      </div>
      <div class="px-5 py-3 border-t border-surface-3 flex justify-end gap-2 flex-shrink-0">
        <button @click="respondApproval(false)" class="px-3 py-1.5 text-xs rounded-lg border border-surface-3 hover:bg-surface-2 text-text-secondary">拒绝</button>
        <button @click="respondApproval(true)" class="px-3 py-1.5 text-xs rounded-lg bg-primary-600 text-white hover:bg-primary-700">允许执行</button>
      </div>
    </div>
  </div>
  <SavePresetModal
    :open="savePresetOpen"
    :type="savePresetType"
    :content="savePresetContent"
    :label="savePresetLabel"
    @close="savePresetOpen = false"
    @saved="onPresetSaved"
  />
  <GalleryPicker
    v-model:visible="showGalleryPicker"
    :multiple="true"
    :initial-category-id="galleryPickerInitialCat"
    @select="onGallerySelectForChat"
  />
  <LowBalanceModal
    v-model:visible="lowBalanceOpen"
    :balance-type="lowBalanceState.balanceType"
    :required="lowBalanceState.required"
    :available="lowBalanceState.available"
  />
  <div v-if="savePresetToast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-surface-0 shadow-lg border border-surface-3 text-xs text-text-primary">{{ savePresetToast }}</div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useChatStore, isContinuable } from '@/stores/chat'
import { useHandoffStore } from '@/stores/handoff'
import { useBotStore } from '@/stores/bots'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useSkillStore } from '@/stores/skills'
import { useMcpStore } from '@/stores/mcps'
import { usePromptSkillStore } from '@/stores/prompt-skills'
import { usePromptPresetStore } from '@/stores/prompt-presets'
import { extractSkillMarkdown } from '@/utils/extract-skill-md'
import { extractPromptPreset } from '@/utils/extract-prompt-preset'
import SavePresetModal from '@/components/SavePresetModal.vue'
import { useModelStore } from '@/stores/models'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { hasCap } from '@/utils/model-caps'
import { useSiteConfigStore } from '@/stores/site-config'
import { useBrandWorkspaceStore } from '@/stores/brand-workspaces'
import { useAgentWorkspaceStore } from '@/stores/agent-workspaces'
import { renderMarkdown, renderMarkdownLive, resolveLocalFileTarget } from '@/utils/markdown'
import { stripImageMetadata } from '@shared/strip-image-metadata'
import { CLOUD_KEY_SEP, stripModelId } from '@shared/model-id'
import GalleryPicker from '@/components/GalleryPicker.vue'
import WorkspaceSwitcher from '@/components/WorkspaceSwitcher.vue'
import ImageLightbox from '@/components/ImageLightbox.vue'
import ChatComposerToolbar from '@/components/ChatComposerToolbar.vue'
import { useComposerAssist } from '@/composables/useComposerAssist'
import type { ChatTaskMode } from '@/components/ChatPlusPanel.vue'
import ChatWorkspaceFilesPanel from '@/components/ChatWorkspaceFilesPanel.vue'
import LowBalanceModal from '@/components/LowBalanceModal.vue'
import PromptTextarea from '@/components/PromptTextarea.vue'
import AskUserCard from '@/components/AskUserCard.vue'
import ImageParamsCard from '@/components/ImageParamsCard.vue'
import { useSettingsUiStore } from '@/stores/settings-ui'

const route = useRoute()
const router = useRouter()
const settingsUi = useSettingsUiStore()
const isWin = ((window as any).electron?.process?.platform || (window as any).runtimeConfig?.platform || '') === 'win32'
const isMac = ((window as any).electron?.process?.platform || (window as any).runtimeConfig?.platform || '') === 'darwin'
const handoff = useHandoffStore()
const chatStore = useChatStore()
const botStore = useBotStore()
const modelStore = useModelStore()
const cloudAuth = useCloudAuthStore()
const siteConfigStore = useSiteConfigStore()
const brandWorkspaceStore = useBrandWorkspaceStore()
const agentWorkspaceStore = useAgentWorkspaceStore()
const kbStore = useKnowledgeStore()
const skillStore = useSkillStore()
const CORE_TOOL_NAMES = ['file_ops', 'run_command', 'image_gen', 'browser']
const userSkills = computed(() =>
  skillStore.skills.filter((s) => !CORE_TOOL_NAMES.includes(s.function_def?.name))
)
const mcpStore = useMcpStore()
// MCP 弹层只展示「已启用」的服务器，避免误把 disabled 项一并选中
const enabledMcpServers = computed(() => mcpStore.servers.filter((s) => s.enabled))
const promptSkillStore = usePromptSkillStore()
const presetStore = usePromptPresetStore()

const bots = ref<any[]>([])
const selectedBotId = ref('')
/** 切换智能体时抑制 watch reset 的嵌套计数（比一次性布尔更稳，避免异步交错） */
const suppressBotWatchReset = ref(0)

async function withBotWatchSuppressed<T>(fn: () => Promise<T> | T): Promise<T> {
  suppressBotWatchReset.value += 1
  try {
    return await fn()
  } finally {
    await nextTick()
    suppressBotWatchReset.value = Math.max(0, suppressBotWatchReset.value - 1)
  }
}

/** 空态发出第一条时抑制「切会话加载草稿」，避免把正在发送的正文覆盖成空 */
const suppressDraftWatch = ref(0)
async function withDraftWatchSuppressed<T>(fn: () => Promise<T> | T): Promise<T> {
  suppressDraftWatch.value += 1
  try {
    return await fn()
  } finally {
    await nextTick()
    suppressDraftWatch.value = Math.max(0, suppressDraftWatch.value - 1)
  }
}
const showBotSelector = ref(false)
const showConvSelector = ref(false)
const filesPanelOpen = ref(localStorage.getItem('chat_files_panel_open') === '1')
const inputText = ref('')
type PendingFollowUp = {
  convId: string
  text: string
  attachments: { name: string; type: string; data: string }[]
  skillIds: string[]
  mcpIds: string[]
  promptSkillDirs: string[]
}
const pendingFollowUp = ref<PendingFollowUp | null>(null)
const userStopped = ref(false)
const lowBalanceOpen = ref(false)
const lowBalanceState = ref({ balanceType: 'token', required: 0, available: 0 })
const messagesContainer = ref<HTMLElement | null>(null)
const inputEl = ref<InstanceType<typeof PromptTextarea> | null>(null)
const emptyInputEl = ref<InstanceType<typeof PromptTextarea> | null>(null)
/** 空态草稿模型（尚无会话时绑定；创建会话时写入） */
const draftChatModel = ref<{ provider_id: string; model_id: string }>({ provider_id: '', model_id: '' })
const draftImageModel = ref<{ provider_id: string; model_id: string }>({ provider_id: '', model_id: '' })
const composerAssist = useComposerAssist({
  text: inputText,
  providerId: () => chatStore.currentConversation?.active_model_provider_id || draftChatModel.value.provider_id,
  modelId: () => chatStore.currentConversation?.active_model_id || draftChatModel.value.model_id
})

watch(() => chatStore.currentConversationId, (id, prev) => {
  if (id === prev) return
  const queued = pendingFollowUp.value
  if (queued && queued.convId !== id) {
    /* 切走时保留 pending，回到原会话再处理 */
  }
})
/** 空态草稿权限档；建会话后写入 conversation.tool_approval */
const draftToolApproval = ref('')
const botSelectorRef = ref<HTMLElement | null>(null)
const convSelectorRef = ref<HTMLElement | null>(null)
const toolbarRef = ref<HTMLElement | null>(null)
const pendingAttachments = ref<{ name: string; type: string; data: string }[]>([])
const showGalleryPicker = ref(false)

const activeBrandBanner = computed(() => {
  const conv = chatStore.conversations.find((c) => c.id === chatStore.currentConversationId)
  const id = conv?.brand_workspace_id || ''
  if (!id) return null
  return brandWorkspaceStore.items.find((x) => x.id === id) || null
})
const galleryPickerInitialCat = computed(
  () =>
    agentWorkspaceStore.active?.gallery_category_id ||
    activeBrandBanner.value?.gallery_category_id ||
    null
)
const toolbarDropdown = ref('')
const tempKbIds = ref<string[]>([])
const tempSkillIds = ref<string[]>([])
const tempMcpIds = ref<string[]>([])
const tempPromptSkillDirs = ref<string[]>([])
/** 任务模式：规划 / 目标 / 会议纪要（UI 壳，发送时注入提示前缀） */
const taskMode = ref<ChatTaskMode>(null)
/** 联网搜索偏好：默认关，勿盲抄 NewMax 默认开 */
const WEB_SEARCH_KEY = 'chat.webSearchEnabled'
const webSearchEnabled = ref(false)

const taskModeLabel = computed(() => {
  if (taskMode.value === 'plan') return '规划模式'
  if (taskMode.value === 'goal') return '目标模式'
  if (taskMode.value === 'meeting') return '会议纪要'
  return ''
})

function loadWebSearchPref() {
  try {
    webSearchEnabled.value = localStorage.getItem(WEB_SEARCH_KEY) === '1'
  } catch {
    webSearchEnabled.value = false
  }
}

watch(webSearchEnabled, (v) => {
  try {
    localStorage.setItem(WEB_SEARCH_KEY, v ? '1' : '0')
  } catch { /* ignore */ }
})

watch(taskMode, (mode) => {
  if (!mode) return
  const seeds: Record<Exclude<ChatTaskMode, null>, string> = {
    plan: '请先给出分步计划，等我确认后再执行：\n',
    goal: '请按目标持续推进直到完成，过程中主动汇报进度：\n',
    meeting: '请根据以下会议内容整理纪要（含决议与待办）：\n'
  }
  const seed = seeds[mode]
  if (!inputText.value.trim()) {
    inputText.value = seed
    nextTick(() => {
      ;(emptyInputEl.value || inputEl.value)?.focus?.()
    })
  }
})

/** 发送前按模式/联网偏好组装用户可见前缀（无真实检索后端，联网仅作提示约束） */
function applyInputHints(text: string): string {
  const parts: string[] = []
  if (taskMode.value === 'plan') {
    parts.push('【规划模式】请先给出分步计划，等我确认后再执行。')
  } else if (taskMode.value === 'goal') {
    parts.push('【目标模式】请持续推进直到目标完成，并阶段性汇报进度。')
  } else if (taskMode.value === 'meeting') {
    parts.push('【会议纪要】请整理决议、待办与要点，结构清晰。')
  }
  if (webSearchEnabled.value) {
    parts.push('【联网偏好】如涉及时效信息，请明确知识截止并标注不确定处；当前环境未接自动网页检索。')
  }
  if (!parts.length) return text
  // 避免与已种子文案重复堆叠
  const body = text.trim()
  const joined = parts.join(' ')
  if (body.startsWith('请先给出') || body.startsWith('请按目标') || body.startsWith('请根据以下')) {
    return `${joined}\n${body}`
  }
  return `${joined}\n${body}`
}

const editingConvId = ref<string | null>(null)
const editingTitle = ref('')
const titleInputRef = ref<HTMLInputElement | null>(null)
const confirmDeleteId = ref<string | null>(null)
const copiedId = ref<string | null>(null)
const exportingWord = ref(false)
const distillBusy = ref(false)
const employeeCandidateBusy = ref(false)
const employeeCandidateType = ref<'knowledge' | 'skill' | 'workflow' | 'responsibility' | 'boundary' | 'acceptance'>('workflow')
const distillBanner = ref(false)
const distillHint = ref('')
const distillMode = ref<'ask' | 'auto' | 'off'>('ask')
let distillHintTimer: ReturnType<typeof setTimeout> | null = null
let distillInspectTimer: ReturnType<typeof setTimeout> | null = null
const editingMsgId = ref<string>('')
const editingText = ref<string>('')

function startEdit(msg: any) {
  editingMsgId.value = msg.id
  editingText.value = typeof msg.content === 'string' ? msg.content : ''
}
function cancelEdit() {
  editingMsgId.value = ''
  editingText.value = ''
}
async function confirmEdit(id: string) {
  const text = editingText.value
  editingMsgId.value = ''
  editingText.value = ''
  await chatStore.editMessage(id, text)
}
const previewImage = ref<string | null>(null)
// 预览图为本地文件（local-file://）时给 Lightbox 传「打开所在文件夹」回调；
// http(s)/data: 等远程或内联图无本地位置，返回 undefined——组件内对应按钮自动隐藏。
const previewLocate = computed(() => {
  const src = previewImage.value
  if (!src || !src.startsWith('local-file:')) return undefined
  return () => {
    const p = resolveLocalFileTarget(src)
    if (p) (window as any).api.shell.showItemInFolder(p)
  }
})
const dispatchMenuId = ref<string | null>(null)
interface FileWritePreview {
  type: 'file_write'
  action: string
  path: string
  exists: boolean
  isBinary?: boolean
  tooLarge?: boolean
  currentContent?: string
  newContent: string
}
interface FileReadPreview {
  type: 'file_read'
  action: string
  path: string
  outsideWorkspace: boolean
}
// 审批卡改由 store 级常驻状态按当前会话派生：切走/回来不丢、跨会话不互相覆盖（见 chat store）。
const pendingApproval = computed(() => chatStore.getPendingApproval(chatStore.currentConversationId))
const formattedApprovalArgs = computed(() => {
  const args = pendingApproval.value?.args
  if (args == null) return ''
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
})
const approvalPreview = computed<FileWritePreview | null>(() => {
  const p = pendingApproval.value?.preview
  return p && p.type === 'file_write' ? (p as FileWritePreview) : null
})
const approvalReadPreview = computed<FileReadPreview | null>(() => {
  const p = pendingApproval.value?.preview
  return p && p.type === 'file_read' ? (p as FileReadPreview) : null
})

const DIFF_MAX_LINES = 1200
const DIFF_RENDER_CAP = 600

function lineDiff(a: string, b: string): { sigil: string; text: string; cls: string }[] {
  const aL = (a || '').split('\n').slice(0, DIFF_MAX_LINES)
  const bL = (b || '').split('\n').slice(0, DIFF_MAX_LINES)
  const m = aL.length, n = bL.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = aL[i] === bL[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: { sigil: string; text: string; cls: string }[] = []
  let i = 0, j = 0
  while (i < m && j < n) {
    if (aL[i] === bL[j]) { out.push({ sigil: ' ', text: aL[i], cls: '' }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ sigil: '-', text: aL[i], cls: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' }); i++ }
    else { out.push({ sigil: '+', text: bL[j], cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' }); j++ }
  }
  while (i < m) out.push({ sigil: '-', text: aL[i++], cls: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' })
  while (j < n) out.push({ sigil: '+', text: bL[j++], cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' })
  return out
}

const approvalDiff = computed(() => {
  const p = approvalPreview.value
  if (!p) return [] as { sigil: string; text: string; cls: string }[]
  if (typeof p.currentContent !== 'string') {
    // No current content (new file / binary / too large): treat as all-new lines
    return (p.newContent || '').split('\n').map((text) => ({ sigil: '+', text, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' }))
  }
  return lineDiff(p.currentContent, p.newContent)
})
const approvalDiffLines = computed(() => approvalDiff.value.slice(0, DIFF_RENDER_CAP))
const approvalDiffTruncated = computed(() => approvalDiff.value.length > DIFF_RENDER_CAP)
const approvalDiffSummary = computed(() => {
  const all = approvalDiff.value
  return {
    adds: all.filter((l) => l.sigil === '+').length,
    dels: all.filter((l) => l.sigil === '-').length
  }
})
async function respondApproval(approved: boolean) {
  const ap = pendingApproval.value
  if (!ap) return
  // store 内乐观清掉本地卡片后再回传主进程（UI 立即恢复）
  await chatStore.respondApproval(ap.request_id, approved)
}

// 对话内交互卡片（ask_user / 生图参数卡）用户选择回传 → 主进程 resolve 挂起的工具执行
async function onCardSubmit(
  msg: any,
  payload: { answers?: Record<string, { selected: string[]; free_text?: string }>; result?: Record<string, any> }
) {
  const card = msg?.card
  if (!card || !card.request_id) return
  try {
    // payload.answers / result 来自组件响应式状态，含 Vue reactive proxy；
    // 直接走 IPC structured clone 会抛 "An object could not be cloned"，故先转成纯对象。
    const plain = JSON.parse(JSON.stringify(payload))
    await window.api.chat.invoke('respondUserChoice', card.request_id, plain)
  } catch (e) {
    console.error('[chat] respondUserChoice failed:', e)
  }
}
const loadingAttachment = ref(false)
const dragging = ref(false)
const MAX_ATTACHMENTS = 5
const attachLimitMsg = ref(false)
const attachmentError = ref('')
const attachmentNotice = ref('')

interface ParsedDocumentResult {
  ok: boolean
  text: string
  ext?: string
  parser?: string
  error?: string
  warnings?: string[]
}

const showQuickPrompt = ref(false)
const showQuickPromptForm = ref(false)
const savingQuickPrompt = ref(false)
const quickPromptFormError = ref('')
const quickPromptForm = ref({ label: '', content: '' })
const quickPromptSearch = ref('')
const quickPromptCategory = ref('')
const quickDirectSend = ref(false)
const savePresetOpen = ref(false)
const savePresetType = ref<'image_gen' | 'chat' | 'persona'>('chat')
const savePresetContent = ref('')
const savePresetLabel = ref('')
const savePresetToast = ref('')
const skillCreateMode = ref(false)
const promptCreateMode = ref(false)
const promptCreateType = ref<'image_gen' | 'chat' | 'persona'>('chat')
const savingSkillId = ref<string | null>(null)

const SKILL_CREATE_SYSTEM = `你正在帮用户撰写一份可保存的 Skill（SKILL.md）。
要求：
1. 先用几句话确认技能要解决什么问题、何时触发、会用到哪些已有能力（生图、文件、浏览器等）。
2. 然后给出完整 SKILL.md，必须放在 markdown 代码块里。
3. 文件以 YAML frontmatter 开头，字段包含 name、description（中文，一两句说明何时该用这个技能）。
4. 正文写清：何时触发、分步流程、输出格式、注意事项。指令要可执行，不要空话。
5. 不要假装已经写入磁盘。写完后提醒用户点击「保存为技能」。`

const PROMPT_CREATE_SYSTEM: Record<'image_gen' | 'chat' | 'persona', string> = {
  image_gen: `你正在帮用户撰写一条可反复使用的 AI 生图提示词。
要求：
1. 先确认主体、风格、用途。
2. 输出完整提示词，放在 markdown 代码块里。
3. 开头可用 YAML：name 为短名称。
4. 正文就是以后套进生图框的句子，具体、可执行；品牌色不必写死。
5. 不要假装已保存。提醒用户点击「保存为提示词」。`,
  chat: `你正在帮用户撰写一条可反复使用的对话快捷提示词。
要求：
1. 先确认场景和目标。
2. 输出完整提示词，放在 markdown 代码块里。
3. 开头可用 YAML：name 为短名称。
4. 正文就是以后插入对话输入框的句子，要可直接发送。
5. 不要假装已保存。提醒用户点击「保存为提示词」。`,
  persona: `你正在帮用户撰写一条人设规则预设（系统提示词）。
要求：
1. 先确认身份、语气和边界。
2. 输出完整人设，放在 markdown 代码块里。
3. 开头可用 YAML：name 为短名称。
4. 正文就是以后填进人设的系统提示词，不要写成一次性任务。
5. 不要假装已保存。提醒用户点击「保存为提示词」。`
}

watch(showQuickPrompt, (open) => {
  if (!open) {
    showQuickPromptForm.value = false
    quickPromptFormError.value = ''
  }
})

watch([quickPromptSearch, quickPromptCategory], () => { quickPage.value = 1 })
const quickPromptGroups = computed(() => presetStore.visibleGrouped('chat'))
const quickCategories = computed(() => presetStore.categories.filter((c) => c.type === 'chat'))
const quickPage = ref(1)
const QUICK_PAGE_SIZE = 20
const filteredQuickAll = computed(() => {
  let groups = quickPromptGroups.value
  if (quickPromptCategory.value) {
    groups = groups.filter((g) => g.id === quickPromptCategory.value)
  }
  const flat = groups.flatMap((g) => g.items.map((item) => ({ ...item, categoryName: g.name })))
  if (quickPromptSearch.value) {
    const q = quickPromptSearch.value.toLowerCase()
    return flat.filter((p) => p.label.toLowerCase().includes(q) || p.content.toLowerCase().includes(q))
  }
  return flat
})
const quickTotalPages = computed(() => Math.max(1, Math.ceil(filteredQuickAll.value.length / QUICK_PAGE_SIZE)))
const pagedQuickPresets = computed(() => {
  const start = (quickPage.value - 1) * QUICK_PAGE_SIZE
  return filteredQuickAll.value.slice(start, start + QUICK_PAGE_SIZE)
})

async function loadQuickSendSetting() {
  const val = await (window as any).api.settings.invoke('get', 'quick_prompt_direct_send')
  quickDirectSend.value = val === '1'
}

async function toggleQuickDirectSend() {
  quickDirectSend.value = !quickDirectSend.value
  await (window as any).api.settings.invoke(
    'set',
    'quick_prompt_direct_send',
    quickDirectSend.value ? '1' : '0'
  )
}

function selectQuickPrompt(content: string) {
  if (quickDirectSend.value) {
    inputText.value = content
    showQuickPrompt.value = false
    nextTick(() => send())
  } else {
    inputText.value = content
    showQuickPrompt.value = false
    nextTick(() => inputEl.value?.focus())
  }
}

function toggleQuickPromptForm() {
  showQuickPromptForm.value = !showQuickPromptForm.value
  quickPromptFormError.value = ''
}

async function saveQuickPrompt() {
  const label = quickPromptForm.value.label.trim()
  const content = quickPromptForm.value.content.trim()
  if (!label || !content) {
    quickPromptFormError.value = '请填写名称和内容'
    return
  }
  savingQuickPrompt.value = true
  quickPromptFormError.value = ''
  try {
    let cat = presetStore.categories.find((c) => c.type === 'chat')
    if (!cat) {
      cat = await presetStore.createCategory({ type: 'chat', name: '我的提示词' })
    }
    await presetStore.createPreset({
      category_id: cat.id,
      type: 'chat',
      label,
      content
    })
    quickPromptForm.value = { label: '', content: '' }
    showQuickPromptForm.value = false
  } catch (e: any) {
    quickPromptFormError.value = e?.message || '保存失败'
  } finally {
    savingQuickPrompt.value = false
  }
}

async function removeQuickPrompt(id: string) {
  if (!window.confirm('删除这条提示词？')) return
  try {
    await presetStore.deletePreset(id)
  } catch (e: any) {
    window.alert('删除失败：' + (e?.message || e))
  }
}

const selectedBotName = computed(() => {
  const bot = bots.value.find((b) => b.id === selectedBotId.value)
  return bot?.name || '助手'
})

const currentConvTitle = computed(() => {
  if (!chatStore.currentConversationId) return '新对话'
  const t = chatStore.currentConversation?.title || ''
  if (!t || t === 'New Chat') return '新对话'
  return t
})

// 当前选中智能体；空选 = 默认助手（不绑 bot）
const currentBot = computed(() => bots.value.find((b) => b.id === selectedBotId.value))
const imageGenEnabled = computed(() => (currentBot.value ? !!currentBot.value.enable_image_gen : true))

const chatEstimate = computed(() => {
  const conv = chatStore.currentConversation
  const rule = effectiveBillingRule(conv?.active_model_provider_id || '', conv?.active_model_id || '')
  if (!rule) return { balanceType: 'token', amount: 0 }
  if (rule.billing_type === 'token' || rule.billing_type === 'credit') {
    const inputTokens = Math.ceil((inputText.value.trim().length + pendingAttachments.value.length * 300) / 3)
    const outputTokens = 800
    const amount = (inputTokens / 1000000) * Number(rule.input_price || 0)
      + (outputTokens / 1000000) * Number(rule.output_price || 0)
    return { balanceType: rule.billing_type === 'credit' ? 'credit' : 'token', amount }
  }
  return { balanceType: 'token', amount: 0 }
})

const botInitial = computed(() => {
  const name = selectedBotName.value
  return name ? name.charAt(0) : 'AI'
})

const visibleMessages = computed(() =>
  chatStore.messages.filter((m) => {
    if (m.role === 'tool') return false
    if (m.role === 'assistant' && m.tool_calls?.length && !m.content) return false
    // 交互卡片消息（ask_user / 生图参数卡）content 为空，但需渲染卡片，故按 card 放行
    return m.role === 'user' || (m.role === 'assistant' && (!!m.content || !!m.card))
  })
)

// 进行中的流式回复：拼成一条虚拟 live 气泡追加到列表末尾。
// 数据源是 store 级 streamingStates，故切走会话/页面再回来只要本轮仍在跑就能继续逐字渲染。
const liveMessage = computed(() => {
  const convId = chatStore.currentConversationId
  if (!convId || !chatStore.isConversationStreaming(convId)) return null
  const st = chatStore.getStreamingState(convId)
  if (!st) return null
  return {
    id: '__live__',
    conversation_id: convId,
    role: 'assistant',
    content: st.content,
    attachments: [],
    tool_calls: [],
    created_at: '',
    _reasoning: st.reasoning,
    _reasoningActive: st.reasoningActive,
    _reasoningCollapsed: !st.reasoningActive,
    _reasoningStartedAt: st.reasoningStartedAt,
    _toolLogs: st.toolLogs,
    _toolActive: st.toolActive,
    _collapsed: st.collapsed,
  } as any
})

const liveNow = ref(Date.now())
let reasoningTick: ReturnType<typeof setInterval> | null = null
watch(
  () => !!liveMessage.value?._reasoningActive,
  (on) => {
    if (reasoningTick) {
      clearInterval(reasoningTick)
      reasoningTick = null
    }
    if (on) {
      liveNow.value = Date.now()
      reasoningTick = setInterval(() => { liveNow.value = Date.now() }, 1000)
    }
  },
  { immediate: true }
)
onUnmounted(() => {
  if (reasoningTick) clearInterval(reasoningTick)
})

function reasoningElapsedSec(msg: any): number {
  const started = Number(msg._reasoningStartedAt || 0)
  if (!started) return 0
  return Math.max(1, Math.round((liveNow.value - started) / 1000))
}

function toggleReasoning(msg: any) {
  if (msg._reasoningActive) {
    msg._reasoningActive = false
    msg._reasoningCollapsed = true
    return
  }
  msg._reasoningCollapsed = msg._reasoningCollapsed === false
}

function reasoningTitle(msg: any): string {
  const sec = reasoningElapsedSec(msg)
  if (msg._reasoningActive) return sec ? `深度思考中 ${sec}秒...` : '深度思考中...'
  return sec ? `深度思考 ${sec}秒` : '深度思考'
}

function reasoningFooter(msg: any): string {
  const chars = String(msg._reasoning || '').length
  const sec = reasoningElapsedSec(msg)
  const parts = [msg._reasoningActive ? '深度思考中' : '深度思考']
  if (sec) parts.push(`${sec}s`)
  parts.push(`↓ ${chars}`)
  return parts.join(' · ')
}

const renderedMessages = computed(() =>
  liveMessage.value ? [...visibleMessages.value, liveMessage.value] : visibleMessages.value
)

// 最后一条助手消息 id(仅在末条显示“重新生成”)
const lastAssistantId = computed(() => {
  const list = renderedMessages.value
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].role === 'assistant') return list[i].id
  }
  return ''
})

function onClickOutside(e: MouseEvent) {
  const target = e.target as Node
  if (botSelectorRef.value && !botSelectorRef.value.contains(target)) {
    showBotSelector.value = false
  }
  if (convSelectorRef.value && !convSelectorRef.value.contains(target)) {
    showConvSelector.value = false
  }
  if (toolbarDropdown.value && toolbarRef.value && !toolbarRef.value.contains(target)) {
    toolbarDropdown.value = ''
  }
  if (dispatchMenuId.value) {
    const wrapper = (target as HTMLElement).closest('[data-dispatch-id]') as HTMLElement | null
    if (!wrapper || wrapper.dataset.dispatchId !== dispatchMenuId.value) {
      dispatchMenuId.value = null
    }
  }
}

watch(selectedBotId, async (id) => {
  if (suppressBotWatchReset.value > 0) return
  chatStore.resetConversationView()
  await chatStore.fetchConversations(id || '')
})

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

watch(() => chatStore.messages.length, scrollToBottom)
watch(() => chatStore.streamContent, scrollToBottom)
watch(() => chatStore.currentConversationId, scrollToBottom)

// === Per-conversation 草稿同步　===
// 文字 / 附件 / 临时工具选择 都与当前对话绑定。
// 路由切走： onUnmounted save 。
// 路由进入： onMounted load（需等着对话 id 已在 store 中）。
// 切换对话：下面 watch 同时 save 旧 + load 新。
function saveDraftFor(convId: string) {
  chatStore.setDraft(convId, {
    inputText: inputText.value,
    attachments: JSON.parse(JSON.stringify(pendingAttachments.value)),
    tempKbIds: [...tempKbIds.value],
    tempSkillIds: [...tempSkillIds.value],
    tempMcpIds: [...tempMcpIds.value],
    tempPromptSkillDirs: [...tempPromptSkillDirs.value],
  })
}
// 把「按 bot 默认 ∩ enabled 预填到 tempXxx」抽成局部辅助函数，loadDraftFor 与 watch 兜底复用。
// 仅在对应 tempXxx 当前为空时才填，避免覆盖用户「本轮明确不用」的清空意图。
// 返回是否产生过预填，调用方据此决定是否 saveDraftFor。
function prefillToolsFromBot(): boolean {
  if (!currentBot.value) return false
  let changed = false
  if (tempMcpIds.value.length === 0) {
    const enabledIds = new Set(enabledMcpServers.value.map((s) => s.id))
    const botMcpIds = Array.isArray(currentBot.value.mcp_ids) ? currentBot.value.mcp_ids : []
    const prefilled = botMcpIds.filter((id: string) => enabledIds.has(id))
    if (prefilled.length) { tempMcpIds.value = prefilled; changed = true }
  }
  if (tempKbIds.value.length === 0) {
    const botKbIds = Array.isArray(currentBot.value.kb_category_ids) ? currentBot.value.kb_category_ids : []
    if (botKbIds.length) { tempKbIds.value = [...botKbIds]; changed = true }
  }
  if (tempSkillIds.value.length === 0) {
    const botSkillIds = Array.isArray(currentBot.value.skill_ids) ? currentBot.value.skill_ids : []
    if (botSkillIds.length) { tempSkillIds.value = [...botSkillIds]; changed = true }
  }
  if (tempPromptSkillDirs.value.length === 0) {
    const botDirs = Array.isArray(currentBot.value.prompt_skill_dirs) ? currentBot.value.prompt_skill_dirs : []
    if (botDirs.length) { tempPromptSkillDirs.value = [...botDirs]; changed = true }
  }
  return changed
}

function loadDraftFor(convId: string) {
  // 首次为该会话加载草稿（drafts 里尚无条目）时，按 bot 默认 ∩ enabled 预填四类 temp；
  // 若 drafts 已存在则严格按 draft 还原，避免覆盖用户显式清空后的「本轮不用」语义。
  const hadDraft = !!chatStore.drafts[convId]
  const d = chatStore.getDraft(convId)
  inputText.value = d.inputText
  pendingAttachments.value = JSON.parse(JSON.stringify(d.attachments))
  tempKbIds.value = [...d.tempKbIds]
  tempSkillIds.value = [...d.tempSkillIds]
  tempMcpIds.value = [...d.tempMcpIds]
  tempPromptSkillDirs.value = [...d.tempPromptSkillDirs]
  if (!hadDraft && prefillToolsFromBot()) saveDraftFor(convId)
}
function clearLocalDraft() {
  inputText.value = ''
  pendingAttachments.value = []
  tempKbIds.value = []
  tempSkillIds.value = []
  tempMcpIds.value = []
  tempPromptSkillDirs.value = []
}
watch(() => chatStore.currentConversationId, (newId, oldId) => {
  if (suppressDraftWatch.value > 0) return
  if (oldId) saveDraftFor(oldId)
  if (oldId && distillMode.value === 'auto' && oldId !== newId) {
    void window.api.distill.inspect(oldId).then((st) => {
      if (st.eligible) return window.api.distill.run(oldId, false)
    }).catch(() => {})
  }
  distillBanner.value = false
  distillHint.value = ''
  if (newId) {
    loadDraftFor(newId)
    void refreshDistillInspect()
    const conv = chatStore.conversations.find((c) => c.id === newId)
    const bid = conv?.bot_id || ''
    if (selectedBotId.value !== bid) {
      void withBotWatchSuppressed(() => { selectedBotId.value = bid })
    }
    if (conv?.brand_workspace_id) {
      brandWorkspaceStore.setActive(conv.brand_workspace_id)
      if (!brandWorkspaceStore.items.length) {
        brandWorkspaceStore.fetchAll().catch(() => {})
      } else if (!brandWorkspaceStore.items.some((x) => x.id === conv.brand_workspace_id)) {
        brandWorkspaceStore.fetchAll().catch(() => {})
      }
    }
  } else clearLocalDraft()
})

// 兜底：loadDraftFor 首次执行时若 bots 异步未就绪（currentBot 还是 undefined），
// 预填路径会被静默跳过；此后 hadDraft 永远为 true 导致预填永久失效。
// 这里同时盯 currentBot 与 currentConversationId，待 bot 就绪后按需补做一次预填。
watch(
  () => [chatStore.currentConversationId, currentBot.value?.id] as const,
  ([convId, botId]) => {
    if (!convId || !botId) return
    // 仅在四类 temp 全部为空（很可能是首次预填因 bot 未就绪被跳过）时尝试补预填
    const allEmpty =
      tempMcpIds.value.length === 0 &&
      tempKbIds.value.length === 0 &&
      tempSkillIds.value.length === 0 &&
      tempPromptSkillDirs.value.length === 0
    if (!allEmpty) return
    if (prefillToolsFromBot()) saveDraftFor(convId)
  }
)

/**
 * 「对话默认模型」解析：
 * 1. 云控端下发的 chatDefaultModel（主选）——云端默认 model_id 会被 upgrade 为复合 key 避免多服务商同名冲突
 * 2. 本地所有 chat 类型模型中第一个（兑底）
 * 3. 都没有→返回空，让 chat-engine 报「未选择对话模型」
 */
function resolveDefaultModel(): { provider_id: string; model_id: string } {
  // 首选云控端下发默认：provider 固定 'cloud:default'，model_id 可能是裸值或复合 key
  // （云控端新版本下发复合 key `model_id#@provider_name` 精确锁定服务商；老版本/老数据为裸值，
  //  此处 upgradeToCompositeKey 会按用户已授权列表补成首选复合 key）。
  const cloud = siteConfigStore.chatDefaultModel
  if (cloud?.provider_id && cloud?.model_id) {
    const candidate = cloud.provider_id === 'cloud:default'
      ? modelStore.upgradeToCompositeKey(cloud.model_id)
      : cloud.model_id
    // 仅当用户对该默认模型【有权限且具备 chat 能力】时才采用。
    // modelStore.providers 的可选模型由 cloudAuth.models（myModels=用户已授权列表）构建，
    // 若云控端配置的默认模型不在其中（用户无权限），不返回它、继续走下面的兜底链，
    // 避免给用户摆一个列表里都没有、还发不出消息的「幽灵模型」。
    const prov = modelStore.providers.find((p) => p.id === cloud.provider_id)
    const cloudType = modelStore.cloudTypeOf(cloud.provider_id, candidate)
    if (prov && prov.models.includes(candidate) && hasCap(candidate, 'chat', cloudType)) {
      return { provider_id: cloud.provider_id, model_id: candidate }
    }
    // 无权限 / 不可用 → 落到兜底（用户第一个已授权 chat 模型）
  }
  // 兑底：本地所有 provider 里第一个 chat 类型模型
  // 与 ChatModelSwitcher 用同一套过滤规则（hasCap）保持一致，
  // 避免本地 provider 把图像/embedding 模型当作默认对话模型选中
  for (const p of modelStore.providers) {
    for (const m of p.models) {
      const cloudType = modelStore.cloudTypeOf(p.id, m)
      if (!hasCap(m, 'chat', cloudType)) continue
      return { provider_id: p.id, model_id: m }
    }
  }
  return { provider_id: '', model_id: '' }
}

/**
 * 「生图默认模型」解析（v0.6.6+）：本地所有 image 类型模型中第一个。
 *
 * 说明：
 * - 云控端未下发 image_default_model（后端未提供），只走本地兑底链
 * - 返回空时 chat-engine 调 image_gen 仍可让 LLM 自行 list_providers（向后兼容）
 * - 与 ChatModelSwitcher type="image" 用同一套 hasCap 过滤规则
 */
function resolveDefaultImageModel(): { provider_id: string; model_id: string } {
  for (const p of modelStore.providers) {
    for (const m of p.models) {
      const cloudType = modelStore.cloudTypeOf(p.id, m)
      if (!hasCap(m, 'image', cloudType)) continue
      return { provider_id: p.id, model_id: m }
    }
  }
  return { provider_id: '', model_id: '' }
}

const isBrandFolder = computed(() => {
  const cur = agentWorkspaceStore.active
  return !!cur && Number(cur.is_default) !== 1
})

const emptyGreeting = computed(() => {
  if (skillCreateMode.value) return '想做什么技能？'
  if (promptCreateMode.value) return '想写什么样的提示词？'
  const h = new Date().getHours()
  if (h < 5) return '夜深了，需要把思路整理成文档吗？'
  if (h < 11) return '早上好，今天想写、查还是改？'
  if (h < 14) return '中午好，要推进哪项任务？'
  if (h < 18) return '下午好，把想法变成可执行任务吧'
  return '晚上好，有什么我可以帮你的？'
})

const emptyPlaceholder = computed(() => {
  if (skillCreateMode.value) return '描述你想做的技能，例如：品牌设计'
  if (promptCreateMode.value) return promptCreatePlaceholder.value
  return isBrandFolder.value ? '说要做什么，写什么，或画什么' : '请你帮我研究一下最近一天的最新 AI 新闻'
})

const promptCreateBanner = computed(() => {
  if (promptCreateType.value === 'image_gen') return '正在创建生图预设。说清主体和风格后生成提示词，再点「保存为提示词」。'
  if (promptCreateType.value === 'persona') return '正在创建人设预设。说清身份和语气后生成，再点「保存为提示词」。'
  return '正在创建对话快捷键。说清场景后生成提示词，再点「保存为提示词」。'
})

const promptCreatePlaceholder = computed(() => {
  if (promptCreateType.value === 'image_gen') return '描述生图预设，例如：电商主图、极简海报'
  if (promptCreateType.value === 'persona') return '描述人设，例如：严谨的品牌顾问'
  return '描述对话快捷键，例如：周报整理、会议纪要'
})

const composerPlaceholder = computed(() => {
  if (dragging.value) return '松开以添加附件'
  if (skillCreateMode.value) return '描述你想做的技能，例如：品牌设计'
  if (promptCreateMode.value) return promptCreatePlaceholder.value
  if (pendingFollowUp.value && pendingFollowUp.value.convId === chatStore.currentConversationId) {
    return '已排队，回复完成后发送'
  }
  if (chatStore.streaming) return '当前回复完成后按队列继续发送'
  return '输入消息，按 Enter 发送…'
})

type SceneCapsule = {
  key: string
  label: string
  kind: 'route' | 'prompt' | 'more'
  to?: string
  prompt?: string
}

const extraCapsules: SceneCapsule[] = [
  { key: 'image', label: 'AI 生图', kind: 'route', to: '/image-gen' },
  { key: 'ai-video', label: 'AI 视频', kind: 'route', to: '/ai-video' },
  { key: 'viral-clone', label: '爆款复刻', kind: 'route', to: '/viral-clone' },
  { key: 'toolkit', label: '图像处理', kind: 'route', to: '/image-toolkit' }
]

const showMoreCapsules = ref(false)

const sceneCapsules = computed<SceneCapsule[]>(() => [
  ...(isBrandFolder.value
    ? ([
        { key: 'hero', label: '画一张主图', kind: 'prompt', prompt: '画一张主图' },
        { key: 'poster', label: '按规范出一张海报', kind: 'prompt', prompt: '按规范出一张海报' }
      ] as SceneCapsule[])
    : []),
  {
    key: 'guide',
    label: '引导帮助',
    kind: 'prompt',
    prompt: '请用简洁步骤引导我完成今天最重要的一件事：先问清目标，再给出可执行清单。\n'
  },
  {
    key: 'write',
    label: '写作',
    kind: 'prompt',
    prompt: '帮我把下面这个想法整理成一篇结构清晰的文稿：\n'
  },
  {
    key: 'ppt',
    label: 'PPT',
    kind: 'prompt',
    prompt: '请根据主题输出一份 PPT 大纲：每页标题、要点、建议配图说明。主题：\n'
  },
  {
    key: 'research',
    label: '调研报告',
    kind: 'prompt',
    prompt: '请围绕主题输出一份调研报告提纲，含背景、问题清单、资料来源建议与结论结构：\n'
  },
  {
    key: 'req',
    label: '需求分析',
    kind: 'prompt',
    prompt: '请把下面需求整理成一份需求分析：目标用户、场景、功能清单、优先级与验收标准。\n'
  },
  {
    key: 'video',
    label: '视频',
    kind: 'prompt',
    prompt: '帮我规划一条短视频：钩子、分镜、口播稿与字幕要点。主题：\n'
  },
  { key: 'more', label: '更多', kind: 'more' }
])

const visibleCapsules = computed(() => {
  const base = sceneCapsules.value.filter((c) => c.key !== 'more')
  const more = sceneCapsules.value.find((c) => c.key === 'more')
  const list = showMoreCapsules.value ? [...base, ...extraCapsules] : base
  return more ? [...list, more] : list
})

const showWorkspaceHint = computed(() => {
  const cur = agentWorkspaceStore.active
  if (!cur) return true
  return Number(cur.is_default) === 1
})

function onDraftChatModelChange(val: { provider_id: string; model_id: string }) {
  draftChatModel.value = { provider_id: val.provider_id, model_id: val.model_id }
}

function onDraftImageModelChange(val: { provider_id: string; model_id: string }) {
  draftImageModel.value = { provider_id: val.provider_id, model_id: val.model_id }
}

function onDraftToolApprovalChange(mode: 'off' | 'destructive' | 'all') {
  draftToolApproval.value = mode
}

async function onToolApprovalChange(mode: 'off' | 'destructive' | 'all') {
  const id = chatStore.currentConversationId
  if (!id) {
    draftToolApproval.value = mode
    return
  }
  await chatStore.updateConversationToolApproval(id, mode)
}

function syncDraftModelFromDefault() {
  if (!draftChatModel.value.model_id) {
    const m = resolveDefaultModel()
    if (m.model_id) draftChatModel.value = { ...m }
  }
  if (!draftImageModel.value.model_id) {
    const im = resolveDefaultImageModel()
    if (im.model_id) draftImageModel.value = { ...im }
  }
}

function goToImageGenWithDraft() {
  const refs = pendingAttachments.value
    .filter((a) => a.type === 'image' && a.data)
    .map((a) => a.data)
    .slice(0, 10)
  const prompt = inputText.value.trim()
  if (prompt || refs.length) {
    handoff.set('imageGen', {
      prompt,
      refImages: refs.length ? refs : undefined
    })
  }
  router.push({ name: 'imageGen' })
}

async function onCapsule(cap: SceneCapsule) {
  if (cap.kind === 'more') {
    showMoreCapsules.value = !showMoreCapsules.value
    return
  }
  if (cap.key === 'image') {
    goToImageGenWithDraft()
    return
  }
  if (cap.kind === 'route' && cap.to) {
    router.push(cap.to)
    return
  }
  if (cap.kind === 'prompt' && cap.prompt) {
    if (cap.key === 'ppt') {
      try {
        const st = await window.api.python.ensure()
        if (!st.ready) return
      } catch {
        return
      }
    }
    inputText.value = cap.prompt
    await nextTick()
    emptyInputEl.value?.focus()
  }
}

/** 空态发送：先建会话再走既有 send() */
const emptyStarting = ref(false)
const emptyStartHint = computed(() => {
  if (!inputText.value.trim()) return '请先输入内容'
  if (emptyStarting.value) return '正在创建对话…'
  return '开始对话'
})

async function onEmptyStart() {
  if (emptyStarting.value) return
  emptyStarting.value = true
  try {
    await sendFromEmpty()
  } catch (e: any) {
    console.error('[chat] empty start failed:', e)
    window.alert?.(e?.message || '无法开始对话，请重试')
  } finally {
    emptyStarting.value = false
  }
}

async function sendFromEmpty() {
  const text = inputText.value.trim()
  if (!text) return
  const botKey = selectedBotId.value || ''
  if ((chatStore.currentBotId ?? '') !== botKey) {
    await withBotWatchSuppressed(async () => {
      await chatStore.fetchConversations(botKey)
    })
  }
  if (!inputText.value.trim()) inputText.value = text
  if (chatStore.streaming) {
    window.alert?.('当前仍有回复在进行中，请稍候或先点停止')
    return
  }
  syncDraftModelFromDefault()
  if (!chatStore.currentConversationId) {
    const draft = draftChatModel.value
    const initialModel = draft.model_id
      ? { provider_id: draft.provider_id || '', model_id: draft.model_id }
      : resolveDefaultModel()
    const plainModel = initialModel.model_id
      ? { provider_id: initialModel.provider_id || '', model_id: initialModel.model_id }
      : undefined
    if (!plainModel?.model_id) {
      throw new Error('暂无可用对话模型，请先在「模型」页配置或确认套餐权限')
    }
    const img = draftImageModel.value.model_id
      ? draftImageModel.value
      : resolveDefaultImageModel()
    const initialImageModel = img.model_id
      ? { provider_id: img.provider_id || '', model_id: img.model_id }
      : undefined
    const conv = await chatStore.createConversation(
      botKey,
      undefined,
      plainModel,
      initialImageModel
    )
    saveDraftFor(conv.id)
    await withDraftWatchSuppressed(async () => {
      await chatStore.selectConversation(conv.id)
    })
    if (!inputText.value.trim()) inputText.value = text
    if (draftToolApproval.value) {
      await chatStore.updateConversationToolApproval(conv.id, draftToolApproval.value)
    }
  }
  if (!chatStore.currentConversationId) {
    throw new Error('无法开始对话：会话未创建成功，请重试')
  }
  await send()
}

async function newConversation() {
  chatStore.startNewChat()
  const botKey = selectedBotId.value || ''
  if ((chatStore.currentBotId ?? '') !== botKey) {
    await withBotWatchSuppressed(async () => {
      await chatStore.fetchConversations(botKey)
    })
  }
}

async function changeConversationWorkspace(event: Event) {
  const conversationId = chatStore.currentConversationId
  if (!conversationId || chatStore.streaming) return
  const workspaceId = (event.target as HTMLSelectElement).value
  try {
    await chatStore.updateConversationWorkspace(conversationId, workspaceId)
  } catch (error: any) {
    window.alert?.(error?.message || '切换任务工作区失败')
  }
}

watch(
  () => chatStore.newChatSeq,
  async () => {
    if (chatStore.currentConversationId) return
    clearLocalDraft()
    syncDraftModelFromDefault()
    await nextTick()
    emptyInputEl.value?.focus()
  },
  { flush: 'post' }
)

watch(
  () => [route.query.createSkill, route.query.createPrompt, route.query.promptType, route.query.useSkill],
  () => applyCreateQuery()
)

function applyCreateQuery() {
  if (route.query.createSkill === '1') {
    skillCreateMode.value = true
    promptCreateMode.value = false
    return
  }
  if (route.query.createPrompt === '1') {
    promptCreateMode.value = true
    skillCreateMode.value = false
    const t = route.query.promptType
    promptCreateType.value = t === 'image_gen' || t === 'persona' || t === 'chat' ? t : 'chat'
  }
  const useSkill = String(route.query.useSkill || '').trim()
  if (useSkill && !tempPromptSkillDirs.value.includes(useSkill)) {
    tempPromptSkillDirs.value = [...tempPromptSkillDirs.value, useSkill]
  }
}

/** 兼容 ⌘N / 侧栏旧入口：?new=1 进入空态并清 query，不立刻建库 */
watch(
  () => route.query.new,
  async (v) => {
    if (String(v || '') !== '1') return
    await newConversation()
    if (route.path === '/chat') {
      const keep: Record<string, string> = {}
      for (const k of ['createSkill', 'createPrompt', 'promptType', 'useSkill', 'botId']) {
        const v = route.query[k]
        if (v != null && String(v) !== '') keep[k] = String(v)
      }
      router.replace({ path: '/chat', query: keep })
    }
  },
  { immediate: true }
)

/**
 * 打开旧会话时的兼容兜底：若 conversation.active_model_* / active_image_* 为空（老会话、跨版本升级），
 * 自动用 resolveDefaultModel / resolveDefaultImageModel 填充一次并持久化。让升级用户也能享受「打开会话即默认模型」。
 */
watch(
  () => chatStore.currentConversationId,
  async (newId) => {
    if (!newId) return
    const conv = chatStore.currentConversation
    if (!conv) return
    // 对话模型兜底
    if (!conv.active_model_id) {
      const m = resolveDefaultModel()
      if (m.model_id) {
        await chatStore.updateConversationModel(newId, m.provider_id, m.model_id)
      }
      // 本地也没可用模型，让 chat-engine 在 sendMessage 时再抛错
    }
    // 生图模型兜底（v0.6.6+）：老会话表里 image 字段原本为空，首次打开填一次
    if (!conv.active_image_model_id) {
      const im = resolveDefaultImageModel()
      if (im.model_id) {
        await chatStore.updateConversationImageModel(newId, im.provider_id, im.model_id)
      }
      // 本地没 image 模型就留空，chat-engine 让 LLM 自行 list_providers
    }
  },
  { immediate: false }
)

/**
 * 输入框左下角 ChatModelSwitcher type="chat" 选定模型后的回调。
 * 写回主进程 conversation 表，同时同步本地 conversations 缓存。
 */
async function onChatModelChange(val: { provider_id: string; model_id: string }) {
  const convId = chatStore.currentConversationId
  if (!convId) return
  await chatStore.updateConversationModel(convId, val.provider_id, val.model_id)
}

/**
 * 输入框左下角 ChatModelSwitcher type="image" 选定生图模型后的回调（v0.6.6+）。
 * 写回主进程；chat-engine 下一轮调 image_gen tool 时作为默认 args。
 */
async function onImageModelChange(val: { provider_id: string; model_id: string }) {
  const convId = chatStore.currentConversationId
  if (!convId) return
  await chatStore.updateConversationImageModel(convId, val.provider_id, val.model_id)
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])
const DOC_EXTENSIONS = new Set(['txt', 'md', 'pdf', 'psd', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'json', 'pptx', 'ppt'])
// 二进制办公文档：file.text() 按 utf-8 读会得到乱码，必须走 main 进程 parseBuffer 解析
const BINARY_DOC_EXTENSIONS = new Set(['pdf', 'psd', 'doc', 'docx', 'xls', 'xlsx', 'pptx', 'ppt'])

function canAddAttachment(): boolean {
  if (pendingAttachments.value.length >= MAX_ATTACHMENTS) {
    attachLimitMsg.value = true
    setTimeout(() => { attachLimitMsg.value = false }, 2000)
    return false
  }
  return true
}

function showAttachmentError(message: string) {
  attachmentError.value = message
  setTimeout(() => {
    if (attachmentError.value === message) attachmentError.value = ''
  }, 3000)
}

function showAttachmentNotice(message: string) {
  attachmentNotice.value = message
  setTimeout(() => {
    if (attachmentNotice.value === message) attachmentNotice.value = ''
  }, 6000)
}

function documentFallbackText(result: ParsedDocumentResult): string {
  return `[文档解析失败：${result.error || '未知错误'}（解析器=${result.parser || '未知'}, 扩展名=${result.ext || '未知'}）]`
}

function resolveParsedDocumentText(result: ParsedDocumentResult): string {
  if (result.warnings?.length) showAttachmentNotice(result.warnings[0])
  if (result.ok) return result.text
  showAttachmentError(`文档解析失败：${result.error || '未知错误'}`)
  return documentFallbackText(result)
}

async function addImageFromBlob(blob: Blob, name: string) {
  if (!canAddAttachment()) return
  loadingAttachment.value = true
  try {
    const reader = new FileReader()
    const dataUri = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    const compressed = await compressImage(dataUri, 1024, 0.8)
    pendingAttachments.value.push({ name, type: 'image', data: compressed })
  } finally {
    loadingAttachment.value = false
  }
}

async function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const blob = item.getAsFile()
      if (blob) {
        const ext = item.type.split('/')[1] || 'png'
        await addImageFromBlob(blob, `paste.${ext}`)
      }
    }
  }
}

async function handleDrop(e: DragEvent) {
  dragging.value = false
  const files = e.dataTransfer?.files
  if (!files?.length) return
  for (const file of files) {
    if (!canAddAttachment()) break
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    if (file.type.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) {
      await addImageFromBlob(file, file.name)
    } else if (DOC_EXTENSIONS.has(ext)) {
      loadingAttachment.value = true
      try {
        let text: string
        if (BINARY_DOC_EXTENSIONS.has(ext)) {
          const buffer = await file.arrayBuffer()
          const parsed = await window.api.chat.invoke('parseDocumentBuffer', { buffer, ext }) as ParsedDocumentResult
          text = resolveParsedDocumentText(parsed)
        } else {
          text = await file.text()
        }
        pendingAttachments.value.push({ name: file.name, type: 'document', data: text })
      } finally {
        loadingAttachment.value = false
      }
    }
  }
}

function compressImage(dataUri: string, maxSize: number, quality: number): Promise<string> {
  const cleanUri = stripImageMetadata(dataUri)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    img.src = cleanUri
  })
}

async function pickFile(fileType: 'image' | 'document') {
  try {
    const filters = fileType === 'image'
      ? [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
      : [{ name: 'Documents', extensions: ['txt', 'md', 'pdf', 'psd', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'json', 'pptx', 'ppt'] }]

    const result = await window.api.dialog.openFile({
      title: fileType === 'image' ? '选择图片' : '选择文档',
      filters,
      properties: ['openFile', 'multiSelections']
    }) as { canceled: boolean; filePaths: string[]; error?: string }
    if (result.error) {
      showAttachmentError(`打开文件选择器失败：${result.error}`)
      return
    }
    if (result.canceled || !result.filePaths.length) return
    loadingAttachment.value = true

    for (const filePath of result.filePaths) {
      if (!canAddAttachment()) break
      const name = filePath.split(/[\\/]/).pop() || 'file'
      const ext = name.split('.').pop()?.toLowerCase() || ''

      if (fileType === 'image') {
        const raw = await window.api.chat.invoke('readFileBase64', filePath) as string
        const dataUri = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${raw}`
        const compressed = await compressImage(dataUri, 1024, 0.8)
        pendingAttachments.value.push({ name, type: 'image', data: compressed })
      } else {
        const parsed = await window.api.chat.invoke('readDocument', filePath) as ParsedDocumentResult
        const data = resolveParsedDocumentText(parsed)
        pendingAttachments.value.push({ name, type: 'document', data })
      }
    }
  } catch (err: any) {
    console.error('Failed to pick file:', err)
    showAttachmentError(`${fileType === 'image' ? '图片' : '文档'}添加失败：${err?.message || String(err)}`)
  } finally {
    loadingAttachment.value = false
  }
}

function openGalleryForChat() {
  showGalleryPicker.value = true
}

function openBrandGalleryForChat() {
  showGalleryPicker.value = true
}

async function onGallerySelectForChat(paths: string[]) {
  if (!paths.length) return
  loadingAttachment.value = true
  try {
    for (const filePath of paths) {
      if (!canAddAttachment()) break
      const name = filePath.split(/[\\/]/).pop() || 'image'
      const ext = name.split('.').pop()?.toLowerCase() || 'png'
      const raw = await window.api.chat.invoke('readFileBase64', filePath) as string
      const dataUri = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${raw}`
      const compressed = await compressImage(dataUri, 1024, 0.8)
      pendingAttachments.value.push({ name, type: 'image', data: compressed })
    }
  } catch (err) {
    console.error('Failed to load gallery images:', err)
  } finally {
    loadingAttachment.value = false
  }
}

function startEditTitle(convId: string, currentTitle: string) {
  editingConvId.value = convId
  editingTitle.value = currentTitle
  nextTick(() => {
    const input = titleInputRef.value
    if (Array.isArray(input)) {
      input[0]?.focus()
    } else if (input) {
      input.focus()
    }
  })
}

async function confirmEditTitle(convId: string) {
  const title = editingTitle.value.trim()
  if (title && title !== chatStore.conversations.find((c) => c.id === convId)?.title) {
    await chatStore.updateTitle(convId, title)
  }
  editingConvId.value = null
  editingTitle.value = ''
}

function cancelEditTitle() {
  editingConvId.value = null
  editingTitle.value = ''
}

async function openWorkspace() {
  filesPanelOpen.value = true
}

async function pickWorkspaceFolder() {
  try {
    const result = (await window.api.dialog.openFile({
      title: '选择工作区文件夹',
      properties: ['openDirectory']
    })) as { canceled: boolean; filePaths: string[] }
    if (result.canceled || !result.filePaths.length) return
    await agentWorkspaceStore.openFolder(result.filePaths[0])
  } catch (e: any) {
    window.alert?.(e?.message || String(e))
  }
}

function toggleFilesPanel() {
  filesPanelOpen.value = !filesPanelOpen.value
  localStorage.setItem('chat_files_panel_open', filesPanelOpen.value ? '1' : '0')
}

watch(filesPanelOpen, (v) => {
  localStorage.setItem('chat_files_panel_open', v ? '1' : '0')
})

function ensureWorkspaceVoice() {
  window.api.brand.invoke('ensureVoice').catch((e) => {
    console.warn('[brand] ensureVoice failed:', e)
  })
}

watch(
  () => agentWorkspaceStore.activeId,
  () => {
    ensureWorkspaceVoice()
  }
)

async function onMessagesClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const img = target.closest('.prose img') as HTMLImageElement | null
  if (img?.src) {
    // 角标按钮与 img 平级（同在 .img-file-wrap 内），closest 沿祖先链找不到 img，不会误入此分支
    previewImage.value = img.src
    return
  }
  // 「打开所在目录 / 浏览器打开」跳转按钮：必须先于 anchor 分支判断——
  // linked image（[![图](local-file...)](https://...)）形态下角标按钮也在 <a> 内，
  // 若 anchor 分支先命中，点定位按钮会被劫持成打开外部链接。按钮是显式操作控件，优先。
  const btn = target.closest('.link-jump-btn') as HTMLElement | null
  if (btn?.dataset?.link) {
    const link = btn.dataset.link
    const type = btn.dataset.linkType
    if (type === 'external') {
      ;(window as any).api.shell.openExternal(link)
    } else if (type === 'localfile') {
      const p = resolveLocalFileTarget(link)
      if (p) (window as any).api.shell.showItemInFolder(p)
    } else {
      ;(window as any).api.shell.showItemInFolder(link)
    }
    return
  }
  // 普通 markdown 链接：拦截原地导航，改用系统浏览器打开。否则点击会让渲染窗口从 SPA 跳走
  // 加载外站，生产 CSP(default-src 'self') 拦掉外站资源→白屏，且无边框窗口无返回键回不来。
  const anchor = target.closest('a[href]') as HTMLAnchorElement | null
  if (anchor) {
    const href = anchor.getAttribute('href') || ''
    if (/^(https?:|mailto:|tel:)/i.test(href)) {
      e.preventDefault()
      ;(window as any).api.shell.openExternal(href)
      return
    }
    // local-file 协议链接（如 AI 输出 [查看文件](local-file://...)）：不拦截会让渲染窗口
    // 原地导航去加载该文件、替换整个 SPA，改为在文件管理器中定位
    if (/^local-file:/i.test(href)) {
      e.preventDefault()
      const p = resolveLocalFileTarget(href)
      if (p) (window as any).api.shell.showItemInFolder(p)
      return
    }
  }
  // Markdown 代码块右上角「复制」按钮：用事件委托替代 inline onclick，
  // 因为生产 CSP（main/index.ts 的 script-src 'self'）不允许 inline handler。
  const copyBtn = target.closest('.copy-btn[data-action="copy-code"]') as HTMLButtonElement | null
  if (copyBtn) {
    const wrapper = copyBtn.closest('.code-block-wrapper')
    const codeEl = wrapper?.querySelector('code')
    const text = codeEl?.textContent || ''
    if (text) {
      try {
        await navigator.clipboard.writeText(text)
        const orig = copyBtn.textContent || '复制'
        copyBtn.textContent = '已复制'
        copyBtn.disabled = true
        setTimeout(() => {
          copyBtn.textContent = orig
          copyBtn.disabled = false
        }, 1500)
      } catch { /* ignore */ }
    }
    return
  }
}

/**
 * 从 markdown 内容提取所有图片本地路径。
 * 支持两种 url 形态：
 *  - `local-file://img?p=<encoded-abs>` 或 `local-file://img?rel=<encoded-rel>`（应用内自定义协议）
 *  - 裸绝对路径（如 `C:\...` 或 `/...`）
 * 其它（http(s) / data:）当前剪贴板写图链路不支持，跳过。
 */
function extractImagePathsFromMarkdown(content: string): string[] {
  const paths: string[] = []
  const regex = /!\[[^\]]*\]\(([^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(content)) !== null) {
    const url = m[1].trim()
    if (url.startsWith('local-file://')) {
      try {
        const u = new URL(url)
        const p = u.searchParams.get('p') || u.searchParams.get('rel')
        if (p) paths.push(p)
      } catch {
        // bad URL，跳过
      }
    } else if (/^[A-Za-z]:[\\/]/.test(url) || url.startsWith('/')) {
      paths.push(url)
    }
  }
  return paths
}

const hasExportableContent = computed(() =>
  visibleMessages.value.some((m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
)

function showDistillHint(msg: string) {
  distillHint.value = msg
  if (distillHintTimer) clearTimeout(distillHintTimer)
  distillHintTimer = setTimeout(() => { distillHint.value = '' }, 5000)
}

async function refreshDistillInspect() {
  const id = chatStore.currentConversationId
  if (!id) {
    distillBanner.value = false
    return
  }
  try {
    const st = await window.api.distill.inspect(id)
    distillMode.value = st.mode
    distillBanner.value = st.mode === 'ask' && st.eligible && !distillBusy.value
  } catch {
    distillBanner.value = false
  }
}

async function runDistill(force = false) {
  const id = chatStore.currentConversationId
  if (!id || distillBusy.value) return
  distillBusy.value = true
  distillBanner.value = false
  try {
    const res = await window.api.distill.run(id, force)
    try { await agentWorkspaceStore.refresh() } catch { /* ignore */ }
    if (res.skipped) showDistillHint(res.reason || '没有可沉淀的内容')
    else if (!res.ok) showDistillHint(res.reason || '沉淀失败')
    else if (res.warning) showDistillHint(res.warning)
    else showDistillHint('已写入工作区知识库，之后同类问题可以召回')
  } catch (e: any) {
    showDistillHint(e?.message || '沉淀失败')
  } finally {
    distillBusy.value = false
    await refreshDistillInspect()
  }
}

async function createEmployeeCandidate() {
  const conversation = chatStore.currentConversation
  if (!conversation?.id || !conversation.bot_id || employeeCandidateBusy.value) return
  const latest = [...visibleMessages.value].reverse().find((message) => message.role === 'assistant' && String(message.content || '').trim())
  if (!latest) {
    showDistillHint('还没有可保存的数字员工回复')
    return
  }
  employeeCandidateBusy.value = true
  try {
    const resolved = await window.api.chat.invoke('getConversationWorkspace', conversation.id, '') as any
    const workspaceScoped = employeeCandidateType.value !== 'skill'
    if (workspaceScoped && !resolved?.available) throw new Error(resolved?.reason || '当前工作区不可用')
    await window.api.bot.invoke('createEmployeeCandidate', {
      botId: conversation.bot_id,
      conversationId: conversation.id,
      workspaceId: workspaceScoped ? String(resolved?.workspaceId || '') : '',
      type: employeeCandidateType.value,
      scope: workspaceScoped ? 'workspace' : 'employee',
      title: `${currentConvTitle.value} · ${employeeCandidateType.value}`,
      body: { content: String(latest.content || '').trim() },
      evidence: { message_id: latest.id, conversation_id: conversation.id }
    })
    showDistillHint('已生成岗位建议，请到数字员工编辑页确认后生效')
  } catch (error: any) {
    showDistillHint(error?.message || '保存岗位建议失败')
  } finally {
    employeeCandidateBusy.value = false
  }
}

async function skipDistillPrompt() {
  const id = chatStore.currentConversationId
  if (!id) return
  distillBanner.value = false
  try { await window.api.distill.skip(id) } catch { /* ignore */ }
}

async function enableAutoDistill() {
  try { distillMode.value = await window.api.distill.setMode('auto') } catch { distillMode.value = 'auto' }
  distillBanner.value = false
  await runDistill(true)
}

watch(() => chatStore.streaming, (now, prev) => {
  if (prev && !now) {
    const stopped = userStopped.value
    userStopped.value = false
    const queued = pendingFollowUp.value
    if (queued && queued.convId === chatStore.currentConversationId) {
      inputText.value = queued.text
      pendingAttachments.value = queued.attachments
      tempSkillIds.value = queued.skillIds
      tempMcpIds.value = queued.mcpIds
      tempPromptSkillDirs.value = queued.promptSkillDirs
      pendingFollowUp.value = null
      if (!stopped) {
        nextTick(() => { void send() })
      }
    }
  }
  if (!(prev && !now)) return
  if (distillInspectTimer) clearTimeout(distillInspectTimer)
  distillInspectTimer = setTimeout(async () => {
    if (chatStore.streaming) return
    const id = chatStore.currentConversationId
    if (!id) return
    try {
      const st = await window.api.distill.inspect(id)
      distillMode.value = st.mode
      if (st.mode === 'off' || !st.eligible) {
        distillBanner.value = false
        return
      }
      if (st.mode === 'auto') await runDistill(false)
      else distillBanner.value = !distillBusy.value
    } catch {
      /* ignore */
    }
  }, 1200)
})

function buildConversationMarkdown(): string {
  const blocks: string[] = []
  for (const m of visibleMessages.value) {
    if (m.card) continue
    const text = String(m.content || '').trim()
    if (!text) continue
    if (m.role === 'user') blocks.push(`## 用户\n\n${text}`)
    else if (m.role === 'assistant') blocks.push(`## 好伙伴\n\n${text}`)
  }
  return blocks.join('\n\n')
}

async function exportDocx(markdown: string, title: string) {
  if (exportingWord.value) return
  const body = String(markdown || '').trim()
  if (!body) {
    window.alert?.('没有可导出的内容')
    return
  }
  exportingWord.value = true
  try {
    const res = (await window.api.chat.invoke('exportDocx', { markdown: body, title })) as {
      ok?: boolean
      cancelled?: boolean
      error?: string
      path?: string
    }
    if (res?.cancelled) return
    if (!res?.ok) window.alert?.(res?.error || '导出失败')
  } catch (e: any) {
    window.alert?.(e?.message || '导出失败')
  } finally {
    exportingWord.value = false
  }
}

function exportConversationWord() {
  void exportDocx(buildConversationMarkdown(), currentConvTitle.value)
}

function exportMessageWord(msg: any) {
  const title = currentConvTitle.value === '新对话' ? '好伙伴回复' : currentConvTitle.value
  void exportDocx(String(msg?.content || ''), title)
}

async function copyMessage(msg: any) {
  try {
    const content = String(msg.content || '')
    // 优先：消息含 markdown 图片 → 复制图片本身（粘到 QQ/微信/邮件直接是图）
    // 多张图取第一张；图片复制失败再回退到文本。
    const imagePaths = extractImagePathsFromMarkdown(content)
    if (imagePaths.length > 0) {
      const res = (await (window as any).api.clipboard.writeImage(imagePaths[0])) as
        | { success?: boolean }
        | undefined
      if (res?.success) {
        copiedId.value = msg.id
        setTimeout(() => { copiedId.value = null }, 2000)
        return
      }
    }
    await navigator.clipboard.writeText(content)
    copiedId.value = msg.id
    setTimeout(() => { copiedId.value = null }, 2000)
  } catch { /* ignore */ }
}

function toggleDispatchMenu(id: string) {
  dispatchMenuId.value = dispatchMenuId.value === id ? null : id
}

function openSaveChatPreset() {
  const text = inputText.value.trim()
  if (!text) return
  savePresetType.value = 'chat'
  savePresetContent.value = text
  savePresetLabel.value = ''
  savePresetOpen.value = true
}

function onPresetSaved() {
  savePresetToast.value = '已存为预设'
  setTimeout(() => { savePresetToast.value = '' }, 2000)
}

function canSaveMessageAsSkill(msg: { role?: string; content?: string }): boolean {
  if (msg.role !== 'assistant') return false
  const text = String(msg.content || '')
  if (skillCreateMode.value && text.trim()) return true
  return !!extractSkillMarkdown(text)
}

async function saveMessageAsSkill(msg: { id: string; content?: string }) {
  dispatchMenuId.value = null
  const parsed = extractSkillMarkdown(String(msg.content || ''))
  if (!parsed) {
    savePresetToast.value = '这条回复里没有完整的 SKILL.md（需要 YAML 的 name）'
    setTimeout(() => { savePresetToast.value = '' }, 2500)
    return
  }
  const exists = promptSkillStore.skills.some((s) => s.name === parsed.name)
  if (exists && !window.api.nativeDialog.confirm(`已有同名技能「${parsed.name}」，要覆盖吗？`)) return
  savingSkillId.value = msg.id
  try {
    await promptSkillStore.createSkill(parsed.name, parsed.description, parsed.content, exists)
    savePresetToast.value = exists ? `已覆盖技能「${parsed.name}」` : `已保存技能「${parsed.name}」`
    setTimeout(() => { savePresetToast.value = '' }, 2500)
  } catch (e: any) {
    savePresetToast.value = e?.message || '保存失败'
    setTimeout(() => { savePresetToast.value = '' }, 2500)
  } finally {
    savingSkillId.value = null
  }
}

function canSaveMessageAsPrompt(msg: { role?: string; content?: string }): boolean {
  if (msg.role !== 'assistant') return false
  return promptCreateMode.value && !!String(msg.content || '').trim()
}

function saveMessageAsPrompt(msg: { content?: string }) {
  dispatchMenuId.value = null
  const parsed = extractPromptPreset(String(msg.content || ''))
  if (!parsed?.content) {
    savePresetToast.value = '这条回复没有可保存的提示词'
    setTimeout(() => { savePresetToast.value = '' }, 2500)
    return
  }
  savePresetType.value = promptCreateType.value
  savePresetContent.value = parsed.content
  savePresetLabel.value = parsed.label
  savePresetOpen.value = true
}

async function saveMessageAsImagePreset(msg: any) {
  dispatchMenuId.value = null
  const draft = await resolveImageDispatchDraft(msg)
  if (!draft.prompt) {
    savePresetToast.value = '这条消息没有可保存的生图提示词'
    setTimeout(() => { savePresetToast.value = '' }, 2000)
    return
  }
  savePresetType.value = 'image_gen'
  savePresetContent.value = draft.prompt
  savePresetLabel.value = ''
  savePresetOpen.value = true
}

function previousUserText(msg: any): string {
  const msgs = chatStore.messages
  const idx = msgs.findIndex((m) => m.id === msg.id)
  const end = idx >= 0 ? idx : msgs.length
  for (let i = end - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') return String(msgs[i].content || '').trim()
  }
  return ''
}

function isAssistantFiller(text: string): boolean {
  return /已为你提交生图任务|已提交生图任务|正在后台生成|生图失败/.test(text)
}

async function resolveImageDispatchDraft(msg: any): Promise<{
  prompt: string
  size?: string
  refImages?: string[]
}> {
  const paths = extractImagePathsFromMarkdown(msg.content || '')
  if (paths[0]) {
    try {
      const gen = (await window.api.imageGen.invoke('getByResultPath', paths[0])) as {
        prompt?: string
        size?: string
        ref_images?: string[]
      } | null
      if (gen?.prompt) {
        return { prompt: gen.prompt, size: gen.size, refImages: gen.ref_images }
      }
    } catch {
      /* ignore */
    }
  }
  const userText = previousUserText(msg)
  if (userText) return { prompt: userText }
  const content = String(msg.content || '').trim()
  if (content && !isAssistantFiller(content)) return { prompt: content }
  return { prompt: '' }
}

async function dispatchTo(target: 'imageGen' | 'batchGen' | 'canvasOrchestrate', msg: any) {
  if (target === 'imageGen' || target === 'batchGen') {
    const draft = await resolveImageDispatchDraft(msg)
    if (!draft.prompt && !draft.refImages?.length) {
      dispatchMenuId.value = null
      return
    }
    if (target === 'imageGen') {
      handoff.set('imageGen', {
        prompt: draft.prompt,
        size: draft.size,
        refImages: draft.refImages
      })
      router.push({ name: 'imageGen' })
    } else {
      handoff.set('batchGen', { prompt: draft.prompt })
      router.push({ name: 'batchGen' })
    }
    dispatchMenuId.value = null
    return
  }
  const content = (msg.content || '').trim()
  if (!content) return
  handoff.set('canvasOrchestrate', { description: content })
  router.push({ name: 'canvas' })
  dispatchMenuId.value = null
}

function cloudProviderName(modelKey: string): string {
  const i = modelKey.indexOf(CLOUD_KEY_SEP)
  return i >= 0 ? modelKey.slice(i + CLOUD_KEY_SEP.length) : ''
}

function effectiveBillingRule(providerId: string, modelKey: string): any | null {
  if (providerId !== 'cloud:default' || !modelKey) return null
  const pure = stripModelId(modelKey)
  const providerName = cloudProviderName(modelKey)
  const cloudModel = cloudAuth.models.find((m) => {
    if (m.model_id !== pure) return false
    return providerName ? m.provider_name === providerName : true
  })
  return cloudAuth.billingRules.find((r: any) => Number(r.cloud_model_id) === Number(cloudModel?.id))
    || cloudAuth.billingRules.find((r: any) => r.model_id === pure)
    || null
}

function availableBalance(type: string): number {
  return Number(cloudAuth.quotas?.balances?.[type]?.total
    ?? cloudAuth.balances.find((b) => b.type === type)?.amount
    ?? 0)
}

function onCancelGeneration() {
  userStopped.value = true
  chatStore.cancel()
}

async function send() {
  const raw = inputText.value.trim()
  // 注意：空态 onEmptyStart 持有 emptyStarting 时会调用本函数，不可把 emptyStarting 当守卫
  if (!raw && !pendingAttachments.value.length) return
  if (chatStore.streaming) {
    if (!chatStore.currentConversationId) return
    pendingFollowUp.value = {
      convId: chatStore.currentConversationId,
      text: raw,
      attachments: JSON.parse(JSON.stringify(pendingAttachments.value)),
      skillIds: [...tempSkillIds.value],
      mcpIds: [...tempMcpIds.value],
      promptSkillDirs: [...tempPromptSkillDirs.value]
    }
    inputText.value = ''
    pendingAttachments.value = []
    return
  }
  const botKey = selectedBotId.value || ''
  if ((chatStore.currentBotId ?? '') !== botKey) {
    await withBotWatchSuppressed(async () => {
      await chatStore.fetchConversations(botKey)
    })
  }
  if (!chatStore.currentConversationId) {
    if (emptyStarting.value) {
      // 已在 sendFromEmpty 路径内：会话应已建好；再进会递归
      throw new Error('无法开始对话：会话未就绪')
    }
    await sendFromEmpty()
    return
  }
  const text = applyInputHints(raw)
  if (chatEstimate.value.amount > 0) {
    const available = availableBalance(chatEstimate.value.balanceType)
    if (available + 0.000001 < chatEstimate.value.amount) {
      lowBalanceState.value = {
        balanceType: chatEstimate.value.balanceType,
        required: chatEstimate.value.amount,
        available,
      }
      lowBalanceOpen.value = true
      return
    }
  }
  const attachments = pendingAttachments.value.length ? JSON.parse(JSON.stringify(pendingAttachments.value)) : undefined
  // D-14：默认不注入本地 KB；D-21：当前文件夹工作区的 docs 库优先
  const conv = chatStore.conversations.find((c) => c.id === chatStore.currentConversationId)
  let brandKbIds: string[] = []
  if (agentWorkspaceStore.active?.kb_category_id) {
    brandKbIds = [agentWorkspaceStore.active.kb_category_id]
  } else {
    const brandId = conv?.brand_workspace_id || brandWorkspaceStore.activeId || ''
    if (brandId) {
      const brand =
        brandWorkspaceStore.items.find((x) => x.id === brandId) ||
        (await brandWorkspaceStore.get(brandId))
      if (brand?.kb_category_id) brandKbIds = [brand.kb_category_id]
    }
  }
  const overrides = {
    kbCategoryIds: brandKbIds,
    skillIds: [...tempSkillIds.value],
    mcpIds: [...tempMcpIds.value],
    promptSkillDirs: [...tempPromptSkillDirs.value],
    ...(skillCreateMode.value
      ? { extraSystemPrompt: SKILL_CREATE_SYSTEM }
      : promptCreateMode.value
        ? { extraSystemPrompt: PROMPT_CREATE_SYSTEM[promptCreateType.value] }
        : {})
  }
  // 先发再清：失败时保留输入，避免「输入消失但无回复」
  const prevText = inputText.value
  const prevAtt = pendingAttachments.value.slice()
  inputText.value = ''
  pendingAttachments.value = []
  try {
    await chatStore.sendMessage(text, attachments, overrides)
  } catch (e: any) {
    inputText.value = prevText
    pendingAttachments.value = prevAtt
    console.error('[chat] send failed:', e)
    window.alert?.(e?.message || '发送失败，请重试')
  }
}

onMounted(async () => {
  document.addEventListener('click', onClickOutside)
  loadWebSearchPref()
  // app 级常驻流式监听（幂等，永不退订）：保证切走会话/页面再回来仍能继续逐字渲染
  chatStore.initStreamListener()
  chatStore.listenTitleUpdates()
  // 监听 image_gen fire-and-forget 完成后追加的图片消息（异步生图工作流）
  chatStore.listenAppendMessage()
  chatStore.listenUpdateMessage()
  // app 级常驻审批监听（幂等，永不退订）：审批卡按会话路由、切走/回来不丢
  chatStore.initApprovalListener()
  await Promise.all([
    botStore.fetchBots(),
    kbStore.fetchCategories(),
    skillStore.fetchSkills(),
    mcpStore.fetchServers(),
    promptSkillStore.fetchSkills(),
    presetStore.fetchAll('chat'),
    agentWorkspaceStore.refresh().catch(() => {})
  ])
  ensureWorkspaceVoice()
  loadQuickSendSetting()
  window.api.distill.getMode().then((m) => { distillMode.value = m }).catch(() => {})
  void refreshDistillInspect()
  bots.value = botStore.bots

  const botId = route.query.botId as string
  applyCreateQuery()
  await withBotWatchSuppressed(async () => {
    if (botId) {
      selectedBotId.value = botId
    } else if (chatStore.currentConversationId) {
      const conv = chatStore.conversations.find((c) => c.id === chatStore.currentConversationId)
        || chatStore.currentConversation
      selectedBotId.value = conv?.bot_id || ''
    } else if (chatStore.currentBotId) {
      selectedBotId.value = chatStore.currentBotId
    } else {
      selectedBotId.value = ''
    }
    await chatStore.fetchConversations(selectedBotId.value || '')
  })
  syncDraftModelFromDefault()

  // 路由进入后恢复当前对话的未发送草稿。watch 只在 currentConversationId
  // 变化时触发；如果 chat 页面重新进入但对话 id 未变，需要这里手动 load。
  // 空态（含已执行过的 startNewChat）不要把上一轮会话再选回来，也不要再次 startNewChat 清掉已输入的字。
  if (route.query.new === '1' && chatStore.currentConversationId) {
    chatStore.startNewChat()
  } else if (chatStore.currentConversationId) {
    await chatStore.selectConversation(chatStore.currentConversationId)
    loadDraftFor(chatStore.currentConversationId)
    // 僵尸轮次恢复：渲染端 reload/托盘重开后主进程轮次可能仍在跑，重建流式态
    //（续接后续流事件 + 恢复停止按钮；轮末由 round_done 事件收尾重拉）
    void chatStore.resumeStreamingIfActive(chatStore.currentConversationId)
  } else {
    syncDraftModelFromDefault()
    await nextTick()
    emptyInputEl.value?.focus()
  }

  // 等 ?new=1 触发的 startNewChat / clearLocalDraft 落盘后再灌附件，避免被清掉
  await nextTick()
  const brandAtt = handoff.consume<{ paths: string[] }>('chatBrandAttachments')
  if (brandAtt?.paths?.length) {
    await onGallerySelectForChat(brandAtt.paths)
  }

  scrollToBottom()
})

onUnmounted(() => {
  // 路由离开前保存当前对话的草稿到 store（仅会话级，重启 app 后丢失）
  if (chatStore.currentConversationId) {
    saveDraftFor(chatStore.currentConversationId)
  }
  if (distillHintTimer) clearTimeout(distillHintTimer)
  if (distillInspectTimer) clearTimeout(distillInspectTimer)
  document.removeEventListener('click', onClickOutside)
  chatStore.stopListenTitleUpdates()
  chatStore.stopListenAppendMessage()
  chatStore.stopListenUpdateMessage()
  // 审批监听是 app 级常驻、按会话路由，不在此退订（退订会导致切走对话页时审批卡丢失，正是本次修复点）
})
</script>

<style scoped>
.toolbar-select-btn {
  @apply flex items-center gap-1 px-2.5 py-1.5 text-xs text-text-secondary bg-surface-2 rounded-lg hover:bg-surface-3 transition-colors cursor-pointer;
}
.toolbar-count {
  @apply inline-flex items-center justify-center w-4 h-4 text-[10px] font-medium bg-primary-600 text-white rounded-full;
}
.toolbar-dropdown {
  @apply absolute bottom-full left-0 mb-1 w-48 max-h-48 overflow-y-auto bg-surface-0 border border-surface-3 rounded-lg shadow-lg z-50 py-1;
}
.toolbar-dropdown-item {
  @apply flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors;
}
/* 未启用的 MCP 项灰显 + 禁止点击（仍保留在列表里供用户感知，避免「列表里看不到」的困惑） */
.toolbar-dropdown-item.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.toolbar-dropdown-item.disabled:hover {
  @apply bg-transparent text-text-secondary;
}
</style>

<style>
/* Fix long path overflow in prose */
.prose code {
  word-break: break-all;
}

/* Link jump button styles */
.link-jump-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 3px;
  padding: 0;
  border: 1px solid var(--surface-3);
  border-radius: 4px;
  background: var(--surface-2);
  cursor: pointer;
  vertical-align: middle;
  transition: background 0.15s, border-color 0.15s;
}
.link-jump-btn:hover {
  background: var(--surface-3);
  border-color: #f9974c;
}
.link-jump-icon {
  flex-shrink: 0;
  color: var(--color-primary-600, #1f4d46);
}

/* local-file 图片的「打开所在目录」角标：默认隐藏，hover 图片时浮现在右上角 */
.img-file-wrap {
  position: relative;
  display: inline-block;
}
/* .prose img 的上下 margin 会撑大 wrap 高度、让角标浮到图片上方的空白带里；
   把垂直间距挪到包装层（特异性压过 .prose img），使 wrap 内容盒 = 图片盒，角标贴合图片右上角 */
.prose .img-file-wrap {
  margin: 8px 0;
}
.prose .img-file-wrap img {
  margin: 0;
}
.img-file-wrap .link-jump-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  margin-left: 0;
  opacity: 0;
  /* 透明时不得拦截图片点击（点击图片 = 预览），仅 hover 显示后才可点 */
  pointer-events: none;
  background: var(--surface-0, #fff);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
  transition: opacity 0.15s, background 0.15s, border-color 0.15s;
}
.img-file-wrap:hover .link-jump-btn {
  opacity: 1;
  pointer-events: auto;
}
</style>
