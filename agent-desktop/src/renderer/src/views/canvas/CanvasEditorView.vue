<template>
  <div class="h-full flex flex-col relative">
    <!-- Toolbar -->
    <div class="flex items-center justify-between px-4 py-2 bg-surface-0 border-b border-surface-3 z-10">
      <div class="flex items-center gap-3">
        <button @click="goBack" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors" title="返回列表">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
        </button>
        <div v-if="editingTitle" class="flex items-center gap-1">
          <input
            ref="titleInputRef"
            v-model="titleDraft"
            @keydown.enter="saveTitle"
            @keydown.escape="editingTitle = false"
            @blur="saveTitle"
            maxlength="30"
            class="text-sm font-medium text-text-primary bg-transparent border-b border-primary-400 outline-none py-0.5 w-48"
          />
        </div>
        <button v-else @click="startEditTitle" :disabled="workflowRunning" class="text-sm font-medium text-text-primary hover:text-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {{ canvasStore.currentProject?.title || 'Untitled' }}
        </button>
      </div>
      <div class="flex items-center gap-2">
        <!-- Global prompt button -->
        <div class="relative" ref="globalPromptRef">
          <button @click="toggleGlobalPrompt" :disabled="workflowRunning" class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-surface-3 rounded-lg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors" :class="canvasStore.currentProject?.system_prompt ? 'text-primary-600' : 'text-text-secondary'">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
            全局提示词
          </button>
          <div v-if="globalPromptExpanded" class="absolute right-0 top-full mt-1 w-[400px] bg-surface-0 border border-surface-3 rounded-xl shadow-lg z-50 p-3">
            <PromptTextarea
              ref="globalPromptTextareaRef"
              v-model="globalPromptText"
              title="编辑全局提示词"
              :height="104"
              :max-length="IMAGE_PROMPT_MAX_LENGTH"
              :disabled="workflowRunning"
              placeholder="风格前缀，例如：杰作，4K，超细节，柔和光线"
              input-class="text-xs"
              inline-edit
              change-on-input
              dialog-live-edit
              @change="scheduleSaveGlobalPrompt"
              @blur="flushGlobalPromptSave"
            />
            <p class="text-[10px] text-text-disabled mt-1.5">作为风格前缀拼接到每次生图提示词前（用 --- 分隔约束与主题）</p>
          </div>
        </div>
        <!-- 画布助手（AI 副驾）：用自然语言搭建/修改/运行画布 -->
        <button
          @click="toggleCopilot"
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors"
          :class="showCopilot ? 'border-primary-300 text-primary-600 bg-primary-50' : 'border-surface-3 text-text-secondary hover:bg-surface-2'"
          title="画布助手：用自然语言搭建 / 修改 / 运行画布"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm3.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm3.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" /></svg>
          AI 助手
        </button>
        <!-- AI Orchestrate -->
        <button
          v-if="showGlobalAiOrchestrate"
          @click="showAiOrchestrate = true"
          :disabled="workflowRunning || !canvasStore.currentProject?.text_provider_id || !canvasStore.currentProject?.image_provider_id"
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-surface-3 text-text-secondary rounded-lg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          :title="!canvasStore.currentProject?.text_provider_id || !canvasStore.currentProject?.image_provider_id ? '请先在画布设置中配置文本与生图模型' : '智能编排 · 生成画布骨架'"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
          </svg>
          智能编排
        </button>
        <!-- Add node menu -->
        <div class="relative" ref="addMenuRef">
          <button @click="showAddMenu = !showAddMenu" :disabled="workflowRunning" class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            添加节点
          </button>
          <div v-if="showAddMenu" class="absolute right-0 top-full mt-1 w-44 bg-surface-0 border border-surface-3 rounded-xl shadow-lg z-50 py-1">
            <button v-for="nt in nodeTypes" :key="nt.type" @click="addNodeAtCenter(nt.type)" class="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-text-secondary hover:bg-surface-2 transition-colors">
              <span class="w-2 h-2 rounded-full flex-shrink-0" :style="{ background: nt.color }"></span>
              {{ nt.label }}
            </button>
          </div>
        </div>
        <!-- 整理布局：dagre 拓扑分层；下拉选方向；带 5 秒撤销窗口 -->
        <template v-if="layoutUndoCountdown > 0">
          <button
            @click="undoAutoLayout"
            class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-amber-300 rounded-lg text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
            :title="`撤销整理（${layoutUndoCountdown}s 内有效）`"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H10" /></svg>
            撤销整理 ({{ layoutUndoCountdown }}s)
          </button>
        </template>
        <div v-else class="relative" ref="layoutMenuRef">
          <button
            @click="showLayoutMenu = !showLayoutMenu"
            :disabled="anyRunning || canvasStore.nodes.length < 2"
            class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-surface-3 rounded-lg text-text-secondary hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="整理布局：选择方向后自动分层、对齐、去除堆叠"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
            整理布局
            <svg class="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
          </button>
          <div v-if="showLayoutMenu" class="absolute right-0 top-full mt-1 w-40 bg-surface-0 border border-surface-3 rounded-xl shadow-lg z-50 py-1">
            <button @click="runAutoLayout('LR')" class="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-text-secondary hover:bg-surface-2 transition-colors">
              <span class="w-2 h-2 rounded-full flex-shrink-0" :class="currentLayoutDir === 'LR' ? 'bg-primary-600' : 'bg-transparent border border-surface-3'"></span>
              左到右整理
            </button>
            <button @click="runAutoLayout('TB')" class="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-text-secondary hover:bg-surface-2 transition-colors">
              <span class="w-2 h-2 rounded-full flex-shrink-0" :class="currentLayoutDir === 'TB' ? 'bg-primary-600' : 'bg-transparent border border-surface-3'"></span>
              上到下整理
            </button>
          </div>
        </div>
        <!-- Run / Cancel workflow：运行中点击触发软取消（已开始的节点跑完，未开始的不发） -->
        <button
          @click="onRunOrCancel"
          :disabled="!workflowRunning && (anyRunning || canvasStore.nodes.length === 0)"
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          :class="workflowRunning ? 'border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20' : 'border-surface-3 text-text-secondary hover:bg-surface-2'"
          :title="workflowRunning ? '停止工作流（已开始的节点会继续完成）' : '执行工作流'"
        >
          <svg v-if="workflowRunning" class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
          <svg v-else class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" /></svg>
          {{ workflowRunning ? '停止' : '执行工作流' }}
        </button>
        <!-- v0.6.9+ 打开当前画布的独立图片目录（参考图 + 生成图都在这） -->
        <button @click="openImageDir" :disabled="!canvasStore.currentProject" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="打开画布图片文件夹">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" /></svg>
        </button>
        <!-- 按序导出画布图片到文件夹：出图节点按 #N 序号命名为 {类型名}-{NN} -->
        <button @click="exportImages" :disabled="!canvasStore.currentProject || exportingImages" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="按序导出图片到文件夹">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
        </button>
        <!-- Settings -->
        <button @click="openSettings" :disabled="workflowRunning" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="画布设置">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
        </button>
        <!-- Clear canvas -->
        <template v-if="confirmClear">
          <button @click="doClearCanvas" class="px-2 py-1 text-[10px] font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-50 dark:text-red-300 dark:border-red-800 dark:hover:bg-red-900/30 transition-colors">确认清空</button>
          <button @click="confirmClear = false" class="px-2 py-1 text-[10px] text-text-tertiary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors">取消</button>
        </template>
        <button v-else @click="confirmClear = true" :disabled="canvasStore.nodes.length === 0 || anyRunning" class="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="清空画布">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
        </button>
        <!-- Zoom controls -->
        <div class="flex items-center gap-1 text-[10px] text-text-tertiary">
          <button @click="zoomOut" class="p-1 rounded hover:bg-surface-2 transition-colors">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14" /></svg>
          </button>
          <span class="w-10 text-center">{{ zoomPercent }}%</span>
          <button @click="zoomIn" class="p-1 rounded hover:bg-surface-2 transition-colors">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          </button>
          <button @click="fitView" class="p-1 rounded hover:bg-surface-2 transition-colors" title="适应视图">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 画布区 + 画布助手面板：横向并排 -->
    <div class="flex-1 flex min-h-0">
    <!-- Vue Flow Canvas -->
    <div class="flex-1 relative" ref="canvasWrapRef">
      <VueFlow
        :key="vueFlowKey"
        :nodes="flowNodes"
        :edges="flowEdges"
        :node-types="customNodeTypes"
        :edge-types="customEdgeTypes"
        :default-viewport="{ x: 0, y: 0, zoom: 1 }"
        :default-edge-options="{ interactionWidth: 20, selectable: true }"
        :min-zoom="0.1"
        :max-zoom="3"
        :snap-to-grid="true"
        :snap-grid="[16, 16]"
        :connection-mode="ConnectionMode.Loose"
        :connect-on-click="false"
        :is-valid-connection="isValidConnection"
        :edges-updatable="!workflowRunning"
        :nodes-draggable="!workflowRunning"
        :nodes-connectable="!workflowRunning"
        fit-view-on-init
        @nodes-change="onNodesChange"
        @edges-change="onEdgesChange"
        @connect="onConnect"
        @viewport-change="onViewportChange"
        @node-drag-stop="onNodeDragStop"
        @node-drag="onNodeDrag"
        @pane-context-menu="onPaneContextMenu"
      >
        <!-- 右下角全局缩略预览：可拖拽小地图直接平移视口；节点用类型色着色便于辨识。
             暗色模式下 mask-color 需要适配（在 :style 里用主题色），避免遮罩太亮 -->
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          :node-color="getMinimapNodeColor"
          :node-stroke-color="getMinimapNodeStroke"
          :node-stroke-width="2"
          :node-border-radius="3"
          mask-color="rgba(120, 130, 145, 0.18)"
          class="canvas-minimap"
        />
        <!-- 拖动节点时顶边对齐参考线（仅水平线；参考节点的 position_y 边） -->
        <div
          v-if="alignGuide.visible"
          class="absolute pointer-events-none"
          :style="{
            left: '0',
            right: '0',
            top: alignGuide.screenY + 'px',
            height: '0',
            borderTop: '1px dashed var(--color-primary-500, #23574f)',
            zIndex: 50
          }"
        ></div>
      </VueFlow>
    </div>
      <!-- 画布助手：右侧可折叠对话面板。用 v-if 保证 currentProject 存在，用 v-show 切换显隐——
           收起面板不卸载组件，从而保留会话历史与跨轮撤销栈；仅切画布/离开路由才真卸载。 -->
      <CanvasCopilotPanel
        v-if="canvasStore.currentProject"
        v-show="showCopilot"
        :project-id="projectId"
        :get-selection="getAgentSelection"
        :layout="agentLayout"
        :on-apply="onAgentApply"
        @close="showCopilot = false"
      />
    </div>

    <Teleport to="body">
      <div
        v-if="canvasContextMenu.visible"
        ref="canvasContextMenuRef"
        class="fixed z-[9998] w-44 bg-surface-0 border border-surface-3 rounded-xl shadow-xl py-1 overflow-hidden"
        :style="{ left: canvasContextMenu.x + 'px', top: canvasContextMenu.y + 'px' }"
        @click.stop
        @pointerdown.stop
        @contextmenu.prevent.stop
      >
        <div class="px-3 py-2 border-b border-surface-3 text-[11px] font-semibold text-text-secondary">
          添加节点
        </div>
        <button
          v-for="nt in nodeTypes"
          :key="nt.type"
          @click="addNodeAtContextPosition(nt.type)"
          class="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-text-secondary hover:bg-surface-2 transition-colors"
        >
          <span class="w-2 h-2 rounded-full flex-shrink-0" :style="{ background: nt.color }"></span>
          {{ nt.label }}
        </button>
      </div>
    </Teleport>

    <!-- Settings Dialog -->
    <div v-if="showSettings" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="w-[420px] bg-surface-0 rounded-2xl shadow-xl border border-surface-3 p-6" @click.stop>
        <h2 class="text-base font-semibold text-text-primary mb-4">画布设置</h2>
        <div class="space-y-4">
          <div>
            <label class="form-label">画布名称</label>
            <input v-model="settingsForm.title" maxlength="30" class="input-field" />
          </div>
          <div>
            <label class="form-label">文本处理服务商</label>
            <select v-model="settingsForm.text_provider_id" class="select-field" @change="settingsForm.text_model_id = ''">
              <option value="">-- 请选择 --</option>
              <option v-for="p in modelStore.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <div v-if="settingsForm.text_provider_id">
            <label class="form-label">文本模型</label>
            <select v-model="settingsForm.text_model_id" class="select-field">
              <option value="">-- 请选择 --</option>
              <optgroup v-if="settingsTextGroups.recommended.length" label="推荐（对话）">
                <option v-for="m in settingsTextGroups.recommended" :key="m" :value="m">{{ modelStore.optionLabel(settingsForm.text_provider_id, m) }}</option>
              </optgroup>
            </select>
          </div>
          <div>
            <label class="form-label">生图服务商</label>
            <select v-model="settingsForm.image_provider_id" class="select-field" @change="settingsForm.image_model_id = ''">
              <option value="">-- 请选择 --</option>
              <option v-for="p in modelStore.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <div v-if="settingsForm.image_provider_id">
            <label class="form-label">生图模型</label>
            <select v-model="settingsForm.image_model_id" class="select-field">
              <option value="">-- 请选择 --</option>
              <optgroup v-if="settingsImageGroups.recommended.length" label="推荐（生图）">
                <option v-for="m in settingsImageGroups.recommended" :key="m" :value="m">{{ modelStore.optionLabel(settingsForm.image_provider_id, m) }}</option>
              </optgroup>
            </select>
          </div>
          <div>
            <label class="form-label">视觉模型服务商</label>
            <select v-model="settingsForm.vision_provider_id" class="select-field" @change="settingsForm.vision_model_id = ''">
              <option value="">未配置（反推节点需在节点上单独选择）</option>
              <option v-for="p in modelStore.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <p class="text-[10px] text-text-disabled mt-1">「图片反推」节点默认使用。需多模态模型（GPT-4o / Claude / Gemini / Qwen-VL 等）</p>
          </div>
          <div v-if="settingsForm.vision_provider_id">
            <label class="form-label">视觉模型</label>
            <select v-model="settingsForm.vision_model_id" class="select-field">
              <option value="">-- 请选择 --</option>
              <optgroup v-if="settingsVisionGroups.recommended.length" label="推荐（视觉）">
                <option v-for="m in settingsVisionGroups.recommended" :key="m" :value="m">{{ modelStore.optionLabel(settingsForm.vision_provider_id, m) }}</option>
              </optgroup>
            </select>
          </div>
          <div>
            <label class="form-label">并发数</label>
            <input v-model.number="settingsForm.concurrency" type="number" min="1" max="20" class="input-field" />
            <p class="text-[10px] text-text-disabled mt-1">请确认接口的实际并发限制，并确保设备性能满足并发要求</p>
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-6">
          <button @click="showSettings = false" class="btn-secondary text-xs">取消</button>
          <button @click="saveSettings" class="btn-primary text-xs">保存</button>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <div v-if="toast" class="absolute bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg border text-xs font-medium transition-all"
      :class="toast.type === 'success' ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300' : 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300'"
    >{{ toast.text }}</div>

    <!-- Handle click-to-create context menu -->
    <HandleCreateMenu
      :visible="handleMenu.visible"
      :position="{ x: handleMenu.x, y: handleMenu.y }"
      :source-data-type="handleMenu.sourceDataType"
      :candidates="handleMenuCandidates"
      :existing="handleMenuExisting"
      @create="onHandleMenuCreate"
      @connect="onHandleMenuConnect"
      @disconnect="onHandleMenuDisconnect"
      @hover="onHandleMenuHover"
      @close="closeHandleMenu"
    />

    <!-- AI Orchestrate dialog -->
    <AiOrchestrateDialog
      v-if="showGlobalAiOrchestrate"
      :visible="showAiOrchestrate"
      :project-id="projectId"
      :initial-description="pendingOrchestrateDescription"
      @close="onOrchestrateClose"
      @done="onOrchestrateDone"
    />

    <!-- 画布内编辑参考图：覆盖当前页，不跳走 -->
    <div v-if="imageEditor" class="absolute inset-0 z-[70] bg-surface-1">
      <ImageEditView
        embedded
        :source-path="imageEditor.sourcePath"
        :source-data-uri="imageEditor.sourceDataUri"
        @close="imageEditor = null"
        @apply="onImageEditorApply"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, markRaw, provide, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { VueFlow, useVueFlow, ConnectionMode, type Node as FlowNode, type Edge, type Connection } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'
import { useCanvasStore } from '@/stores/canvas'
import { useModelStore } from '@/stores/models'
import { useHandoffStore } from '@/stores/handoff'
import { groupAndSort } from '@/utils/model-caps'
import { warmHintsCache, getHintsSync } from '@/utils/model-usage-hints'
import { NODE_TYPE_DEFS, getNodeTypeDef, paletteNodeTypeDefs, isPaletteNodeType, type NodeTypeDef } from './composables/useNodeTypes'
import { getDefaultNodeData, isForbiddenCombination, canConnect } from './utils/node-schema'
import { useAutoLayout } from './composables/useAutoLayout'
import type { LayoutSnapshot } from './composables/useAutoLayout'
import { useWorkflowEngine } from './composables/useWorkflowEngine'

import TextInputNode from './nodes/TextInputNode.vue'
import AiTextNode from './nodes/AiTextNode.vue'
import AgentNode from './nodes/AgentNode.vue'
import QuickOrchestratorNode from './nodes/QuickOrchestratorNode.vue'
import Text2ImgNode from './nodes/Text2ImgNode.vue'
import Img2ImgNode from './nodes/Img2ImgNode.vue'
import RefImageNode from './nodes/RefImageNode.vue'
import ImageResultNode from './nodes/ImageResultNode.vue'
import PromptSliceNode from './nodes/PromptSliceNode.vue'
import ReverseNode from './nodes/ReverseNode.vue'
import ImageRecognitionNode from './nodes/ImageRecognitionNode.vue'
import MattingNode from './nodes/MattingNode.vue'
import AiVideoNode from './nodes/AiVideoNode.vue'
import VideoResultNode from './nodes/VideoResultNode.vue'
import VideoInputNode from './nodes/VideoInputNode.vue'
import VideoFramesNode from './nodes/VideoFramesNode.vue'
import VideoReverseNode from './nodes/VideoReverseNode.vue'
import StoryboardNode from './nodes/StoryboardNode.vue'
import CreateCharacterNode from './nodes/CreateCharacterNode.vue'
import CharacterRefNode from './nodes/CharacterRefNode.vue'
import DeletableEdge from './edges/DeletableEdge.vue'
import HandleCreateMenu from './components/HandleCreateMenu.vue'
import AiOrchestrateDialog from './components/AiOrchestrateDialog.vue'
import CanvasCopilotPanel from './components/CanvasCopilotPanel.vue'
import PromptTextarea from '@/components/PromptTextarea.vue'
import ImageEditView from '@/views/image-gen/ImageEditView.vue'
import { IMAGE_PROMPT_MAX_LENGTH } from '@shared/prompt-limits'

const route = useRoute()
const router = useRouter()
const canvasStore = useCanvasStore()
const modelStore = useModelStore()
const handoff = useHandoffStore()
const showGlobalAiOrchestrate = false

const projectId = computed(() => route.params.id as string)

// 画布助手（AI 副驾）面板开关与注入
const showCopilot = ref(false)
function toggleCopilot() {
  showCopilot.value = !showCopilot.value
  // 面板开合改变画布可用宽度，下一帧适应视图
  nextTick(() => vfFitView({ padding: 0.2 }))
}
/** 供画布助手读取当前选中的节点 id */
function getAgentSelection(): string[] {
  return (getSelectedNodes.value || []).map((n: any) => n.id)
}
/** 供画布助手触发自动整理布局（沿用画布记忆的方向） */
async function agentLayout(): Promise<void> {
  await onAutoLayout(canvasStore.currentProject?.layout_direction === 'TB' ? 'TB' : 'LR')
}
/** 画布助手每轮动作后：适应视图让用户看到变化 */
function onAgentApply(): void {
  nextTick(() => vfFitView({ padding: 0.2 }))
}

const editingTitle = ref(false)
const vueFlowKey = ref(0)
const titleDraft = ref('')
const titleInputRef = ref<HTMLInputElement | null>(null)
const showAddMenu = ref(false)
const showSettings = ref(false)
const showAiOrchestrate = ref(false)
const pendingOrchestrateDescription = ref('')
const confirmClear = ref(false)
const globalPromptExpanded = ref(false)
const globalPromptText = ref('')
const globalPromptLength = computed(() => globalPromptText.value.length)
const globalPromptOverLimit = computed(() => globalPromptLength.value > IMAGE_PROMPT_MAX_LENGTH)
let globalPromptSaveTimer: ReturnType<typeof setTimeout> | null = null
let globalPromptSavePromise: Promise<void> | null = null
async function persistGlobalPrompt() {
  if (!projectId.value) return
  if (globalPromptOverLimit.value) return
  const nextPrompt = globalPromptText.value.trim()
  if (canvasStore.currentProject?.system_prompt === nextPrompt) return
  const savePromise = canvasStore.updateProject(projectId.value, { system_prompt: nextPrompt }).then(() => {})
  globalPromptSavePromise = savePromise
  try {
    await savePromise
  } finally {
    if (globalPromptSavePromise === savePromise) globalPromptSavePromise = null
  }
}
function scheduleSaveGlobalPrompt() {
  if (globalPromptSaveTimer) clearTimeout(globalPromptSaveTimer)
  globalPromptSaveTimer = setTimeout(() => {
    globalPromptSaveTimer = null
    persistGlobalPrompt()
  }, 300)
}
async function flushGlobalPromptSave() {
  if (globalPromptSaveTimer) {
    clearTimeout(globalPromptSaveTimer)
    globalPromptSaveTimer = null
    await persistGlobalPrompt()
    return
  }
  if (globalPromptSavePromise) await globalPromptSavePromise
}
const toast = ref<{ text: string; type: 'success' | 'error' } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(text: string, type: 'success' | 'error' = 'success', duration = 3000) {
  if (toastTimer) clearTimeout(toastTimer)
  toast.value = { text, type }
  toastTimer = setTimeout(() => { toast.value = null }, duration)
}
function toggleGlobalPrompt() {
  globalPromptExpanded.value = !globalPromptExpanded.value
  if (globalPromptExpanded.value) {
    nextTick(() => globalPromptTextareaRef.value?.focus())
  }
}
const globalPromptRef = ref<HTMLElement | null>(null)
const globalPromptTextareaRef = ref<InstanceType<typeof PromptTextarea> | null>(null)
const addMenuRef = ref<HTMLElement | null>(null)
const layoutMenuRef = ref<HTMLElement | null>(null)
const canvasWrapRef = ref<HTMLElement | null>(null)
const canvasContextMenuRef = ref<HTMLElement | null>(null)
const showLayoutMenu = ref(false)
const canvasContextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  flowX: 0,
  flowY: 0
})
// 上次使用的布局方向（持久化在 project.layout_direction）——
// 下拉菜单用它在选项前点个小色块提示用户，注意不是「默认」而是「上次」。
// 老画布 / 脟数据会被主进程 normalizeLayoutDirection 打到 'LR'
const currentLayoutDir = computed<'LR' | 'TB'>(() =>
  canvasStore.currentProject?.layout_direction === 'TB' ? 'TB' : 'LR'
)
const customNodeTypes: Record<string, any> = {
  textInput: markRaw(TextInputNode),
  aiText: markRaw(AiTextNode),
  agentNode: markRaw(AgentNode),
  quickOrchestrator: markRaw(QuickOrchestratorNode),
  reverse: markRaw(ReverseNode),
  imageRecognition: markRaw(ImageRecognitionNode),
  matting: markRaw(MattingNode),
  text2img: markRaw(Text2ImgNode),
  img2img: markRaw(Img2ImgNode),
  refImage: markRaw(RefImageNode),
  imageResult: markRaw(ImageResultNode),
  promptSlice: markRaw(PromptSliceNode),
  aiVideo: markRaw(AiVideoNode),
  videoResult: markRaw(VideoResultNode),
  videoInput: markRaw(VideoInputNode),
  videoFrames: markRaw(VideoFramesNode),
  videoReverse: markRaw(VideoReverseNode),
  storyboard: markRaw(StoryboardNode),
  createCharacter: markRaw(CreateCharacterNode),
  characterRef: markRaw(CharacterRefNode)
}
const customEdgeTypes: Record<string, any> = {
  deletable: markRaw(DeletableEdge)
}

const nodeTypes: NodeTypeDef[] = paletteNodeTypeDefs()

// Settings — unified model grouping via shared util
const hintsTick = ref(0)

const settingsForm = ref({
  title: '',
  text_provider_id: '',
  text_model_id: '',
  image_provider_id: '',
  image_model_id: '',
  // v0.6.9+ 「图片反推」节点默认视觉模型（节点可覆盖，可为空）
  vision_provider_id: '',
  vision_model_id: '',
  concurrency: 1
})

const settingsTextProvider = computed(() =>
  modelStore.providers.find(p => p.id === settingsForm.value.text_provider_id) || null
)
const settingsImageProvider = computed(() =>
  modelStore.providers.find(p => p.id === settingsForm.value.image_provider_id) || null
)
const settingsTextGroups = computed(() => {
  hintsTick.value
  if (!settingsTextProvider.value) return { recommended: [], others: [] }
  return groupAndSort(settingsTextProvider.value.models, 'chat', {
    cloudTypeOf: (mid) => modelStore.cloudTypeOf(settingsTextProvider.value!.id, mid),
    usageHints: getHintsSync('chat', settingsTextProvider.value.id)
  })
})
const settingsImageGroups = computed(() => {
  hintsTick.value
  if (!settingsImageProvider.value) return { recommended: [], others: [] }
  return groupAndSort(settingsImageProvider.value.models, 'image', {
    cloudTypeOf: (mid) => modelStore.cloudTypeOf(settingsImageProvider.value!.id, mid),
    usageHints: getHintsSync('image', settingsImageProvider.value.id)
  })
})
const settingsVisionProvider = computed(() =>
  modelStore.providers.find(p => p.id === settingsForm.value.vision_provider_id) || null
)
const settingsVisionGroups = computed(() => {
  hintsTick.value
  if (!settingsVisionProvider.value) return { recommended: [], others: [] }
  return groupAndSort(settingsVisionProvider.value.models, 'vision', {
    cloudTypeOf: (mid) => modelStore.cloudTypeOf(settingsVisionProvider.value!.id, mid),
    usageHints: getHintsSync('vision', settingsVisionProvider.value.id)
  })
})

/**
 * v0.6.9+ 打开当前画布的独立图片目录（dataDir/canvas/{projectId}/）。
 * 该目录里包含：用户上传的参考图 + text2img/img2img 节点产出的生成图。
 * 主进程 canvas:openProjectImageDir 会保证目录存在（mkdir -p），即使该画布从未产出图也能打开空目录。
 */
async function openImageDir() {
  const proj = canvasStore.currentProject
  if (!proj) return
  try {
    const result = await canvasStore.openProjectImageDir(proj.id)
    if (!result?.success) {
      showToast(`打开失败：${result?.error || '未知错误'}`, 'error', 4000)
    }
  } catch (e: any) {
    showToast(`打开失败：${e?.message || e}`, 'error', 4000)
  }
}

const exportingImages = ref(false)
/**
 * 按序导出当前画布所有出图节点的图片到用户选定目录。
 * 文件名 = {类型名}-{NN}（与画布节点 #N 序号一致），方便在目录里按顺序取用。
 */
async function exportImages() {
  const proj = canvasStore.currentProject
  if (!proj || exportingImages.value) return
  exportingImages.value = true
  try {
    const result = await canvasStore.exportProjectImages(proj.id)
    if (result?.canceled) return
    if (result?.success) {
      const n = result.exported ?? 0
      const skipped = (result.total ?? n) - n
      showToast(skipped > 0 ? `已导出 ${n} 张（${skipped} 张复制失败）` : `已导出 ${n} 张图片到所选文件夹`, 'success', 4000)
    } else {
      showToast(`导出失败：${result?.error || '未知错误'}`, 'error', 4000)
    }
  } catch (e: any) {
    showToast(`导出失败：${e?.message || e}`, 'error', 4000)
  } finally {
    exportingImages.value = false
  }
}

function openSettings() {
  const proj = canvasStore.currentProject
  if (!proj) return
  // 云端 provider 的 select option 用复合 key 作 :value，DB 里存的是纯 model_id，
  // openSettings 时把纯 model_id 升级为复合 key 让 select 能命中具体某家服务商的 option。
  const isCloudText = proj.text_provider_id === 'cloud:default'
  const isCloudImage = proj.image_provider_id === 'cloud:default'
  // 视觉模型在云端 cloud_models 表中 type='chat'（capsFromCloudType('chat') 返回 ['chat','vision']），
  // 主进程 resolveCloudModelId(modelId, 'chat') 会反查到对应 cloud_model_id 实现精确路由，
  // 这里走和 text / image 一样的复合 key 升级路径，让 select option 能命中具体某家服务商
  const isCloudVision = proj.vision_provider_id === 'cloud:default'
  settingsForm.value = {
    title: proj.title,
    text_provider_id: proj.text_provider_id || '',
    text_model_id: isCloudText ? modelStore.upgradeToCompositeKey(proj.text_model_id || '') : (proj.text_model_id || ''),
    image_provider_id: proj.image_provider_id || '',
    image_model_id: isCloudImage ? modelStore.upgradeToCompositeKey(proj.image_model_id || '') : (proj.image_model_id || ''),
    vision_provider_id: proj.vision_provider_id || '',
    vision_model_id: isCloudVision ? modelStore.upgradeToCompositeKey(proj.vision_model_id || '') : (proj.vision_model_id || ''),
    concurrency: proj.concurrency || 1
  }
  showSettings.value = true
}

// Toast the user after AI orchestration writes its nodes/edges to the canvas.
// We intentionally do NOT auto-execute the workflow — the user inspects the
// generated structure and decides when to run.
function onOrchestrateDone(result: { nodeIds: string[]; edgeIds: string[] }) {
  showToast(
    `编排完成：${result.nodeIds.length} 个节点 / ${result.edgeIds.length} 条连线`,
    'success'
  )
  // Nudge the user toward the freshly created nodes so they don't miss them.
  nextTick(() => fitView())
}

async function saveSettings() {
  if (!projectId.value) return
  const concurrency = Math.max(1, Math.min(20, settingsForm.value.concurrency || 1))
  await canvasStore.updateProject(projectId.value, {
    title: settingsForm.value.title.trim() || canvasStore.currentProject?.title,
    text_provider_id: settingsForm.value.text_provider_id,
    // 保留复合 key 入库，调用时 main 端反查 cloud_model_id 精确路由服务商
    text_model_id: settingsForm.value.text_model_id,
    image_provider_id: settingsForm.value.image_provider_id,
    image_model_id: settingsForm.value.image_model_id,
    vision_provider_id: settingsForm.value.vision_provider_id,
    vision_model_id: settingsForm.value.vision_model_id,
    concurrency
  })
  showSettings.value = false
}

const { zoomIn: vfZoomIn, zoomOut: vfZoomOut, fitView: vfFitView, getViewport, getNode: vfGetNode, getSelectedNodes } = useVueFlow()

const currentZoom = ref(1)
const zoomPercent = computed(() => Math.round(currentZoom.value * 100))

function zoomIn() { vfZoomIn(); updateZoom() }
function zoomOut() { vfZoomOut(); updateZoom() }
function fitView() { vfFitView({ padding: 0.2 }); updateZoom() }
function updateZoom() {
  nextTick(() => {
    const vp = getViewport()
    currentZoom.value = vp.zoom
  })
}
function onViewportChange(vp: any) {
  currentZoom.value = vp.zoom
}

// Per-type sequence index, 1-based, ordered by created_at.
// Both the node header (#N badge) and the handle menu use this so the user
// always sees the same number for the same node, in either place.
// Recomputes when nodes are added/removed/reordered.
const nodeIndexMap = computed<Record<string, number>>(() => {
  const buckets: Record<string, typeof canvasStore.nodes> = {}
  for (const n of canvasStore.nodes) {
    if (!buckets[n.type]) buckets[n.type] = [] as any
    ;(buckets[n.type] as any).push(n)
  }
  const map: Record<string, number> = {}
  for (const t of Object.keys(buckets)) {
    const list = (buckets[t] as any[]).slice()
    list.sort((a, b) => {
      const at = a.created_at || ''
      const bt = b.created_at || ''
      if (at === bt) return a.id < b.id ? -1 : 1
      return at < bt ? -1 : 1
    })
    list.forEach((n, i) => {
      map[n.id] = i + 1
    })
  }
  return map
})

// Highlighted node id (set when the user hovers a "connect to existing" item
// in the handle menu) — vue-flow nodes pick up a `spotlight` class for it.
const hoveredNodeId = ref<string | null>(null)

// Convert store data to Vue Flow format
const flowNodes = computed<FlowNode[]>(() =>
  canvasStore.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: n.position_x, y: n.position_y },
    class: hoveredNodeId.value === n.id ? 'spotlight' : '',
    data: {
      ...n.data,
      nodeId: n.id,
      projectId: n.project_id,
      locked: workflowRunning.value,
      nodeIndex: nodeIndexMap.value[n.id] || 1
    }
  }))
)

// 「选中节点 → 点亮其直接出去的连线」的可视化辅助：
// 仅一级——只取 source 是选中节点的 edge，不做 BFS 传递。
// 这样视觉聚焦在「我连出去的下一站」，不会把整张图都点亮。
const downstreamEdgeIds = computed<Set<string>>(() => {
  const selected = getSelectedNodes.value
  if (selected.length === 0) return new Set<string>()
  const rootSet = new Set(selected.map(n => n.id))
  const result = new Set<string>()
  for (const e of canvasStore.edges) {
    if (rootSet.has(e.source_node_id)) result.add(e.id)
  }
  return result
})

const flowEdges = computed<Edge[]>(() =>
  canvasStore.edges.map((e) => ({
    id: e.id,
    type: 'deletable',
    source: e.source_node_id,
    sourceHandle: e.source_handle,
    target: e.target_node_id,
    targetHandle: e.target_handle,
    animated: false,
    selectable: true,
    // 选中节点的下游 edge 加 class，由 CSS「.edge-flow-downstream .vue-flow__edge-path」接手点亮流动
    class: downstreamEdgeIds.value.has(e.id) ? 'edge-flow-downstream' : undefined
  }))
)

// Workflow engine — module-level singletons ensure the same state is shared
// across this view and every individual node component.
// - workflowRunning: only true while runWorkflow is executing the full canvas
// - anyRunning: true when workflowRunning OR any single node is running
// Declared here (before handle menu state) so the watch below can safely reference it.
const {
  isProjectRunning,
  isProjectAnyRunning,
  getProjectRefImageWarnings,
  runWorkflow: executeWorkflow,
  cancelWorkflow: cancelWorkflowRaw
} = useWorkflowEngine()
// 只观察「本画布」的运行态：其它画布运行不再冻结/影响当前画布（态按 projectId 分片）
const workflowRunning = computed(() => isProjectRunning(projectId.value))
const anyRunning = computed(() => isProjectAnyRunning(projectId.value))
const refImageWarnings = computed(() => getProjectRefImageWarnings(projectId.value))
function cancelWorkflow(): boolean {
  return cancelWorkflowRaw(projectId.value)
}

// === Handle click-to-create menu ===
// Clicking (not dragging) a source handle opens a context menu listing:
//   1) Compatible node types to create and auto-connect
//   2) Existing nodes in this project that can accept the data type
// Dragging still works as before for direct node-to-node wiring.
type HandleMenuState = {
  visible: boolean
  x: number
  y: number
  sourceNodeId: string
  sourceHandle: string
  sourceDataType: 'text' | 'image' | 'video'
}
const handleMenu = ref<HandleMenuState>({
  visible: false,
  x: 0,
  y: 0,
  sourceNodeId: '',
  sourceHandle: '',
  sourceDataType: 'text'
})

function onHandleClick(
  event: MouseEvent,
  nodeId: string,
  handleId: string,
  dataType: 'text' | 'image' | 'video'
) {
  // Structural edits are disabled while the whole-workflow run is active.
  // Single-node runs don't block this: independent nodes can still be wired up.
  if (workflowRunning.value) return
  event.stopPropagation()
  event.preventDefault()
  handleMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    sourceNodeId: nodeId,
    sourceHandle: handleId,
    sourceDataType: dataType
  }
}

provide('onHandleClick', onHandleClick)

type CanvasImageEditorPayload = {
  nodeId: string
  sourcePath?: string
  sourceDataUri?: string
  apply: (dataUrl: string) => Promise<void>
}

const imageEditor = ref<CanvasImageEditorPayload | null>(null)

function openCanvasImageEditor(payload: CanvasImageEditorPayload) {
  if (!payload?.nodeId || (!payload.sourcePath && !payload.sourceDataUri)) return
  imageEditor.value = payload
}

async function onImageEditorApply(dataUrl: string) {
  const ctx = imageEditor.value
  if (!ctx) return
  try {
    await ctx.apply(dataUrl)
  } finally {
    imageEditor.value = null
  }
}

provide('openCanvasImageEditor', openCanvasImageEditor)

// isForbiddenCombination / canConnect / getDefaultNodeData 已下沉到 ./utils/node-schema，
// 由画布编辑器与画布智能体工具共用同一份真源。

// Compatible new-node candidates, with the resolved input handle we'll auto-connect to.
const handleMenuCandidates = computed(() => {
  if (!handleMenu.value.visible) return []
  const srcType = handleMenu.value.sourceDataType
  const srcNode = canvasStore.nodes.find((n) => n.id === handleMenu.value.sourceNodeId)
  const srcNodeType = srcNode?.type
  return NODE_TYPE_DEFS
    .filter((d) => isPaletteNodeType(d.type))
    .filter((d) => d.inputs.some((i) => i.dataType === srcType))
    .filter((d) => !isForbiddenCombination(srcNodeType, d.type))
    .map((d) => {
      const input =
        d.inputs.find((i) => i.required && i.dataType === srcType) ||
        d.inputs.find((i) => i.dataType === srcType)!
      return {
        type: d.type,
        label: d.label,
        color: d.color,
        targetHandle: input.handle
      }
    })
})

// Existing-node candidates:
//   - in same project
//   - has at least one input handle matching sourceDataType
//   - not the source node itself
//   - not a forbidden combination
// Already-connected targets are NOT filtered out — they are surfaced with
// connected=true so the user can click them again to disconnect (toggle UX).
const handleMenuExisting = computed(() => {
  if (!handleMenu.value.visible || !projectId.value) return []
  const ctx = handleMenu.value
  const srcNode = canvasStore.nodes.find((n) => n.id === ctx.sourceNodeId)
  const srcNodeType = srcNode?.type
  const idx = nodeIndexMap.value
  // Map: targetNodeId -> edgeId for edges originating from this exact source/handle.
  // Used both to mark the menu item as connected and to know which edge to delete.
  const connectedEdge = new Map<string, string>()
  for (const e of canvasStore.edges) {
    if (
      e.project_id === projectId.value &&
      e.source_node_id === ctx.sourceNodeId &&
      e.source_handle === ctx.sourceHandle
    ) {
      connectedEdge.set(e.target_node_id, e.id)
    }
  }
  return canvasStore.nodes
    .filter((n) => n.project_id === projectId.value)
    .filter((n) => n.id !== ctx.sourceNodeId)
    .filter((n) => !isForbiddenCombination(srcNodeType, n.type))
    .map((n) => {
      const def = getNodeTypeDef(n.type)
      if (!def) return null
      const input =
        def.inputs.find((i) => i.required && i.dataType === ctx.sourceDataType) ||
        def.inputs.find((i) => i.dataType === ctx.sourceDataType)
      if (!input) return null
      let preview = ''
      if (n.type === 'textInput') preview = String(n.data.text || '').slice(0, 40)
      else if (n.type === 'aiText')
        preview = String(n.data.result || n.data.text || '').slice(0, 40)
      const edgeId = connectedEdge.get(n.id) || ''
      return {
        nodeId: n.id,
        label: def.label,
        index: idx[n.id] || 1,
        color: def.color,
        preview,
        connected: !!edgeId,
        edgeId
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
})

// Place the newly created node to the right of the source node, offsetting
// vertically if that slot is already occupied to avoid visual overlap.
function findFreeSlot(baseX: number, baseY: number): { x: number; y: number } {
  const projId = projectId.value
  const collision = (x: number, y: number) =>
    canvasStore.nodes.some(
      (n) =>
        n.project_id === projId &&
        Math.abs(n.position_x - x) < 50 &&
        Math.abs(n.position_y - y) < 50
    )
  let x = baseX
  let y = baseY
  let tries = 0
  while (collision(x, y) && tries < 20) {
    y += 120
    tries++
  }
  return { x, y }
}

async function onHandleMenuCreate(newType: string) {
  if (!projectId.value) return
  const src = canvasStore.nodes.find((n) => n.id === handleMenu.value.sourceNodeId)
  if (!src) {
    closeHandleMenu()
    return
  }
  // Defense in depth: even though candidates computed filters this out,
  // refuse again here in case the menu was opened with stale data.
  if (isForbiddenCombination(src.type, newType)) {
    closeHandleMenu()
    return
  }
  const def = getNodeTypeDef(newType)
  if (!def) {
    closeHandleMenu()
    return
  }
  const input =
    def.inputs.find((i) => i.required && i.dataType === handleMenu.value.sourceDataType) ||
    def.inputs.find((i) => i.dataType === handleMenu.value.sourceDataType)
  if (!input) {
    closeHandleMenu()
    return
  }

  const { x, y } = findFreeSlot(src.position_x + (src.width || 240) + 80, src.position_y)

  const newNode = await canvasStore.addNode(projectId.value, {
    type: newType,
    position_x: x,
    position_y: y,
    width: 240,
    height: 0,
    data: getDefaultNodeData(newType)
  })

  await canvasStore.addEdge(projectId.value, {
    source_node_id: handleMenu.value.sourceNodeId,
    source_handle: handleMenu.value.sourceHandle,
    target_node_id: newNode.id,
    target_handle: input.handle
  })

  closeHandleMenu()
}

async function onHandleMenuConnect(targetNodeId: string) {
  if (!projectId.value || workflowRunning.value) return
  const target = canvasStore.nodes.find((n) => n.id === targetNodeId)
  if (!target) return
  const src = canvasStore.nodes.find((n) => n.id === handleMenu.value.sourceNodeId)
  // Defense in depth: mirror isValidConnection/candidates filter at the write site.
  if (src && isForbiddenCombination(src.type, target.type)) return
  const def = getNodeTypeDef(target.type)
  if (!def) return
  const input =
    def.inputs.find((i) => i.required && i.dataType === handleMenu.value.sourceDataType) ||
    def.inputs.find((i) => i.dataType === handleMenu.value.sourceDataType)
  if (!input) return

  const dup = canvasStore.edges.find(
    (e) =>
      e.project_id === projectId.value &&
      e.source_node_id === handleMenu.value.sourceNodeId &&
      e.source_handle === handleMenu.value.sourceHandle &&
      e.target_node_id === targetNodeId &&
      e.target_handle === input.handle
  )
  if (!dup) {
    await canvasStore.addEdge(projectId.value, {
      source_node_id: handleMenu.value.sourceNodeId,
      source_handle: handleMenu.value.sourceHandle,
      target_node_id: targetNodeId,
      target_handle: input.handle
    })
  }
  // Menu stays open by design — users often connect/disconnect several
  // targets in one go. Esc / outside-click / workflow-start still close it.
}

// Toggle counterpart of onHandleMenuConnect — the menu shows already-connected
// targets with a "已连接" badge; clicking removes that single edge.
async function onHandleMenuDisconnect(edgeId: string) {
  if (!projectId.value || workflowRunning.value || !edgeId) return
  await canvasStore.removeEdge(edgeId)
  // Same as above: keep the menu open for further edits.
}

// Hover-driven canvas spotlight: when the user hovers a "connect to existing"
// item, the corresponding node lights up so they can visually confirm the
// match without having to read or count node copies.
function onHandleMenuHover(nodeId: string | null) {
  hoveredNodeId.value = nodeId
}

function closeHandleMenu() {
  handleMenu.value.visible = false
  hoveredNodeId.value = null
}

// Auto-close the handle menu if the full workflow starts while it is open.
// Structural edits are disabled during whole-workflow runs, so the menu must
// not linger and suggest interactions that would silently no-op.
watch(
  () => workflowRunning.value,
  (running) => {
    if (running && handleMenu.value.visible) closeHandleMenu()
  }
)

// Connection validation
// VueFlow 连线校验薄封装：解析出源/目标节点后委托给共享的 canConnect（同一份规则）。
function isValidConnection(connection: Connection): boolean {
  const sourceNode = canvasStore.nodes.find((n) => n.id === connection.source)
  const targetNode = canvasStore.nodes.find((n) => n.id === connection.target)
  return canConnect(sourceNode, connection.sourceHandle, targetNode, connection.targetHandle).ok
}

// Event handlers
function onNodesChange(changes: any[]) {
  for (const change of changes) {
    if (change.type === 'position' && change.position && change.dragging === false) {
      const node = canvasStore.nodes.find((n) => n.id === change.id)
      if (node) {
        node.position_x = change.position.x
        node.position_y = change.position.y
      }
    }
  }
}

function onEdgesChange(changes: any[]) {
  if (workflowRunning.value) return
  for (const change of changes) {
    if (change.type === 'remove') {
      canvasStore.removeEdge(change.id)
    }
  }
}

async function onConnect(connection: Connection) {
  if (!projectId.value || workflowRunning.value) return
  await canvasStore.addEdge(projectId.value, {
    source_node_id: connection.source!,
    source_handle: connection.sourceHandle || 'output',
    target_node_id: connection.target!,
    target_handle: connection.targetHandle || 'input'
  })
}

function onNodeDragStop(event: any) {
  alignGuide.value.visible = false  // 清除对齐参考线
  const draggedNodes = Array.isArray(event) ? event : [event]
  const updates: { id: string; position_x: number; position_y: number }[] = []
  for (const item of draggedNodes) {
    const node = item.node || item
    if (node?.id && node?.position) {
      updates.push({ id: node.id, position_x: node.position.x, position_y: node.position.y })
      const storeNode = canvasStore.nodes.find((n) => n.id === node.id)
      if (storeNode) {
        storeNode.position_x = node.position.x
        storeNode.position_y = node.position.y
      }
    }
  }
  if (updates.length > 0) {
    canvasStore.updateNodePositions(updates)
  }
}

// === #1 节点顶边对齐吸附（拖动期间实时） ===
// 拖动节点时扫描其他节点的 position_y，差值 < 阈值则吸附到该 y，并在画布上显示一条
// 水平虚线提示用户。仅对齐 top 边（DB 没存真实 height，无法可靠对齐 bottom/center）。
// 与 snap-grid=[16,16] 共存：grid 是默认行为，对齐吸附覆盖时手动改 node.position.y。
const ALIGN_SNAP_THRESHOLD = 8 // 屏幕世界坐标差，超过则不吸附
const alignGuide = ref<{ visible: boolean; screenY: number }>({ visible: false, screenY: 0 })

function onNodeDrag(event: any) {
  const item = Array.isArray(event) ? event[0] : event
  const node = item?.node || item
  if (!node?.id || !node.position) return

  const draggedY = node.position.y
  let snapY: number | null = null
  let bestDiff = Infinity
  for (const peer of canvasStore.nodes) {
    if (peer.id === node.id) continue
    const diff = Math.abs(peer.position_y - draggedY)
    if (diff < ALIGN_SNAP_THRESHOLD && diff < bestDiff) {
      bestDiff = diff
      snapY = peer.position_y
    }
  }

  if (snapY !== null) {
    // 吸附：直接覆盖 vue-flow 节点的 position.y。VueFlow 内部 reactivity
    // 会让节点立即移动到该位置；onNodeDragStop 时 node.position.y 已经是吸附值。
    node.position.y = snapY
    // 屏幕坐标 = 世界坐标 * zoom + viewport offset，用于参考线 absolute 定位
    const vp = getViewport()
    alignGuide.value = { visible: true, screenY: snapY * vp.zoom + vp.y }
  } else {
    if (alignGuide.value.visible) alignGuide.value.visible = false
  }
}

// === #3 MiniMap 节点颜色映射 ===
// 复用 useNodeTypes 中每种节点类型的主题色：填充用淡色（25% 不透明），
// 描边保留纯色作为类型区分，避免小地图色块过于浓重抢眼。
function getMinimapNodeColor(node: FlowNode): string {
  const def = getNodeTypeDef(node.type as string)
  // 6 位 hex + '40' 后缀 = 约 25% 不透明度（SVG fill 支持 #RRGGBBAA）
  return def?.color ? def.color + '40' : '#cbd5e140'
}
function getMinimapNodeStroke(node: FlowNode): string {
  const def = getNodeTypeDef(node.type as string)
  return def?.color || '#94a3b8'
}

// === #2 一键整理布局（dagre 拓扑分层）+ 5 秒撤销窗口 ===
const { computeLayout, applySnapshot } = useAutoLayout()
const layoutUndoCountdown = ref(0)
let _layoutSnapshot: LayoutSnapshot | null = null
let _layoutCountdownTimer: ReturnType<typeof setInterval> | null = null

function _clearLayoutCountdown() {
  if (_layoutCountdownTimer) {
    clearInterval(_layoutCountdownTimer)
    _layoutCountdownTimer = null
  }
  layoutUndoCountdown.value = 0
  _layoutSnapshot = null
}

async function onAutoLayout(direction?: 'LR' | 'TB') {
  if (!projectId.value || anyRunning.value) return
  if (canvasStore.nodes.length < 2) {
    showToast('画布节点不足，无需整理', 'success', 2000)
    return
  }
  // 整理前清掉一次旧的撤销窗口（如果用户连续点）
  _clearLayoutCountdown()

  // 用 VueFlow 运行时实测尺寸嗂给 dagre，DB 的 height=0 对孤儿节点不可靠
  // 优先用传入的方向，其次读 project 上次记忆，均不同时回退 LR
  const rankdir: 'LR' | 'TB' = direction
    ?? (canvasStore.currentProject?.layout_direction === 'TB' ? 'TB' : 'LR')
  // TB 模式下同层节点是「水平」间距，节点宽普遍较宽（240），适当压缩避免布局太稀疏；
  // LR 模式保持原参数不变，避免老用户感知变化
  const nodesep = rankdir === 'TB' ? 40 : 60
  const ranksep = rankdir === 'TB' ? 80 : 120
  const { newPositions, snapshot } = computeLayout(projectId.value, {
    rankdir,
    nodesep,
    ranksep,
    getNodeDimensions: (id) => {
      // VueFlow 1.48 的 getNode 是 ComputedRef<fn>，需要 .value 解包再调用
      const fn = (vfGetNode as any)?.value || vfGetNode
      const n = typeof fn === 'function' ? fn(id) : undefined
      return n?.dimensions ? { width: n.dimensions.width, height: n.dimensions.height } : undefined
    }
  })

  if (newPositions.length === 0) return

  await canvasStore.updateNodePositions(newPositions)
  _layoutSnapshot = snapshot
  vueFlowKey.value++  // 触发重新挂载以应用新坐标（VueFlow 内部 nodes prop 变化即可，但 key 更稳）

  // 自动 fitView 让用户看到整理结果
  await nextTick()
  vfFitView({ padding: 0.2, duration: 300 })

  // 启动撤销倒计时（5 秒）
  layoutUndoCountdown.value = 5
  _layoutCountdownTimer = setInterval(() => {
    layoutUndoCountdown.value--
    if (layoutUndoCountdown.value <= 0) _clearLayoutCountdown()
  }, 1000)

  showToast('已整理布局，5 秒内可撤销', 'success', 2500)
}

/**
 * 下拉菜单选中某个方向后的入口：
 *   1. 关闭菜单
 *   2. 若选择与 project 上次记忆不同，写回库（下次打开菜单能高亮该项）
 *   3. 调用 onAutoLayout(direction) 走原有 dagre 布局 + 5s 撤销逻辑
 */
async function runAutoLayout(direction: 'LR' | 'TB') {
  showLayoutMenu.value = false
  // 仅在变化时写库，避免无谓 IPC；normalizeLayoutDirection 会再检一道
  if (projectId.value && canvasStore.currentProject?.layout_direction !== direction) {
    await canvasStore.updateProject(projectId.value, { layout_direction: direction })
  }
  await onAutoLayout(direction)
}

async function undoAutoLayout() {
  if (!_layoutSnapshot) return
  const snap = _layoutSnapshot
  _clearLayoutCountdown()
  await applySnapshot(snap)
  vueFlowKey.value++
  await nextTick()
  vfFitView({ padding: 0.2, duration: 300 })
  showToast('已撤销布局整理', 'success', 1500)
}

// Add node
async function addNodeAtCenter(type: string) {
  showAddMenu.value = false
  if (!projectId.value) return
  const vp = getViewport()
  const x = (-vp.x + 400) / vp.zoom
  const y = (-vp.y + 200) / vp.zoom

  await addNodeAtPosition(type, x, y)
}

async function addNodeAtContextPosition(type: string) {
  const { flowX, flowY } = canvasContextMenu.value
  closeCanvasContextMenu()
  await addNodeAtPosition(type, flowX, flowY)
}

async function addNodeAtPosition(type: string, x: number, y: number) {
  if (!projectId.value) return
  const defaultData = getDefaultNodeData(type)
  await canvasStore.addNode(projectId.value, {
    type,
    position_x: x,
    position_y: y,
    data: defaultData
  })
}

async function adjustCanvasContextMenuPosition() {
  await nextTick()
  const el = canvasContextMenuRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const margin = 8
  const x = Math.min(Math.max(canvasContextMenu.value.x, margin), window.innerWidth - rect.width - margin)
  const y = Math.min(Math.max(canvasContextMenu.value.y, margin), window.innerHeight - rect.height - margin)
  canvasContextMenu.value.x = x
  canvasContextMenu.value.y = y
}

function onPaneContextMenu(event: MouseEvent) {
  event.preventDefault()
  if (workflowRunning.value) return
  closeHandleMenu()
  showAddMenu.value = false
  showLayoutMenu.value = false
  globalPromptExpanded.value = false
  const vp = getViewport()
  const rect = canvasWrapRef.value?.getBoundingClientRect()
  const canvasX = rect ? event.clientX - rect.left : event.clientX
  const canvasY = rect ? event.clientY - rect.top : event.clientY
  canvasContextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    flowX: (canvasX - vp.x) / vp.zoom,
    flowY: (canvasY - vp.y) / vp.zoom
  }
  adjustCanvasContextMenuPosition()
}

function closeCanvasContextMenu() {
  canvasContextMenu.value.visible = false
}


// Title editing
function startEditTitle() {
  titleDraft.value = canvasStore.currentProject?.title || ''
  editingTitle.value = true
  nextTick(() => titleInputRef.value?.focus())
}

async function saveTitle() {
  const title = titleDraft.value.trim()
  if (title && projectId.value) {
    await canvasStore.updateProject(projectId.value, { title })
  }
  editingTitle.value = false
}

function goBack() {
  router.push('/canvas')
}

async function onRunOrCancel() {
  // 运行中点同一按钮触发软取消：未开始的节点不发送，已开始的让其完成
  if (workflowRunning.value) {
    if (cancelWorkflow()) {
      showToast('已请求停止，已开始的节点会继续完成', 'success', 2500)
    }
    return
  }
  if (!projectId.value) return
  await flushGlobalPromptSave()
  const result = await executeWorkflow(projectId.value)
  if (result) {
    showToast(result.message, result.ok ? 'success' : 'error', result.ok ? 3000 : 5000)
  }
  // 参考图读取失败聚合提示：执行完成后若有静默跳过的参考图，给出明确警告
  if (refImageWarnings.value.length > 0) {
    const totalFailed = refImageWarnings.value.reduce((s, w) => s + w.failed, 0)
    const nodeCount = refImageWarnings.value.length
    showToast(
      `${nodeCount} 个节点共 ${totalFailed} 张参考图读取失败已被跳过，结果可能与预期不同`,
      'error',
      5000
    )
  }
}

// Clear all nodes and edges
async function doClearCanvas() {
  for (const edge of [...canvasStore.edges]) {
    await canvasStore.removeEdge(edge.id)
  }
  for (const node of [...canvasStore.nodes]) {
    await canvasStore.removeNode(node.id)
  }
  confirmClear.value = false
}

// Click outside to close menus
function onClickOutside(e: MouseEvent) {
  if (addMenuRef.value && !addMenuRef.value.contains(e.target as globalThis.Node)) {
    showAddMenu.value = false
  }
  if (layoutMenuRef.value && !layoutMenuRef.value.contains(e.target as globalThis.Node)) {
    showLayoutMenu.value = false
  }
  const target = e.target as globalThis.Node
  const inGlobalPromptPanel = globalPromptRef.value?.contains(target)
  const inGlobalPromptDialog = globalPromptTextareaRef.value?.containsDialogTarget(e.target) || false
  if (globalPromptRef.value && !inGlobalPromptPanel && !inGlobalPromptDialog) {
    globalPromptExpanded.value = false
  }
  if (canvasContextMenuRef.value && !canvasContextMenuRef.value.contains(e.target as globalThis.Node)) {
    closeCanvasContextMenu()
  }
}

// Delete key support for selected nodes & edges
const { getSelectedEdges, removeEdges } = useVueFlow()
async function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (workflowRunning.value) return
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
    // 多选节点批量删除（Shift+点击多选 / Shift+拖动框选）。
    // 与节点上的删除按钮同一 store 入口：直接删、无确认；removeNode 级联删关联连线
    // 并由主进程清掉磁盘产物。节点与连线同时选中时一起删（级联过的连线对 removeEdges 幂等）。
    const selectedNodes = getSelectedNodes.value
    if (selectedNodes.length > 0) {
      for (const n of selectedNodes) {
        await canvasStore.removeNode(n.id)
      }
    }
    const selected = getSelectedEdges.value
    if (selected.length > 0) {
      removeEdges(selected.map((ed) => ed.id))
    }
  }
}

function onOrchestrateClose() {
  showAiOrchestrate.value = false
  pendingOrchestrateDescription.value = ''
}

onMounted(async () => {
  document.addEventListener('click', onClickOutside)
  document.addEventListener('keydown', onKeyDown)
  await Promise.all([modelStore.fetchProviders(), warmHintsCache()])
  hintsTick.value++
  if (projectId.value) {
    await canvasStore.loadProject(projectId.value)
    globalPromptText.value = canvasStore.currentProject?.system_prompt || ''
    vueFlowKey.value++
  }

  const pending = handoff.consume<{ description?: string }>('canvasOrchestrate')
  if (showGlobalAiOrchestrate && pending?.description) {
    pendingOrchestrateDescription.value = pending.description
    await nextTick()
    showAiOrchestrate.value = true
  }
})

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside)
  document.removeEventListener('keydown', onKeyDown)
  // 清理整理布局的撤销倒计时定时器，避免组件卸载后 setInterval 仍在跑
  _clearLayoutCountdown()
})

// 离开画布时若工作流仍在跑：不阻止跳转（任务本就在后台继续），仅 toast 告知用户
// 任务仍然存活、可在顶栏徽标看到并停止。useWorkflowEngine 是 module-level singleton，
// 路由切换不影响其内部 async loop。
onBeforeRouteLeave(() => {
  if (workflowRunning.value) {
    showToast('画布任务在后台继续运行，可在顶栏徽标查看或停止', 'success', 3500)
  }
  return true
})
</script>

<style>
.vue-flow {
  /* 画布底色跟随主题变量：浅色 ≈ 原 #fafbfc，深色自动转深底，避免深色模式下背景刺眼 */
  background: var(--surface-1);
}
/* MiniMap 默认白底，深色模式下在深色画布上会突兀，改用 surface-2 深底 */
.dark .canvas-minimap {
  background-color: var(--surface-2);
}
.vue-flow__node {
  border-radius: 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04);
}
/* 深色模式：黑色投影在深底上几乎不可见，改用「更深投影 + 半透明白描边」让节点从画布浮起 */
.dark .vue-flow__node {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.06);
}
/* Handle visual: slightly larger than before for easier targeting. */
.vue-flow__handle {
  width: 12px;
  height: 12px;
  border: 2px solid #94a3b8;
  background: white;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
/* Invisible hit area: extends the pointer target by 8px on every side
   without changing the visual size. Makes handles much easier to grab. */
.vue-flow__handle::before {
  content: '';
  position: absolute;
  inset: -8px;
  border-radius: 50%;
}
/* Hover lifts the handle and adds a soft halo so users know it is interactive. */
.vue-flow__handle:hover {
  transform: scale(1.6);
  border-color: var(--color-primary-500, #23574f);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary-500, #23574f) 22%, transparent);
}
/* Per-type tint so text/image handles are visually distinguishable. */
.vue-flow__handle.handle-text {
  border-color: var(--color-primary-400, #6a9a92);
}
.vue-flow__handle.handle-text:hover {
  border-color: var(--color-primary-600, #1f4d46);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary-500, #23574f) 22%, transparent);
}
.vue-flow__handle.handle-image {
  border-color: var(--color-primary-400, #6a9a92);
}
.vue-flow__handle.handle-image:hover {
  border-color: var(--color-primary-600, #1f4d46);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary-500, #23574f) 22%, transparent);
}
.vue-flow__handle.handle-video {
  border-color: var(--color-primary-500, #23574f);
}
.vue-flow__handle.handle-video:hover {
  border-color: var(--color-primary-700, #1a3f3a);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary-500, #23574f) 22%, transparent);
}
/* Whole-row hover on promptSlice pre-highlights the row's handle,
   so users know exactly which row a handle belongs to even before touching it. */
.prompt-slice-row:hover .vue-flow__handle {
  transform: scale(1.55);
  border-color: var(--color-primary-500, #23574f);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary-500, #23574f) 22%, transparent);
}
.prompt-slice-row:hover .vue-flow__handle:hover {
  transform: scale(1.8);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary-500, #23574f) 28%, transparent);
}
/* VueFlow state overrides stay on top of the color scheme. */
.vue-flow__handle-connecting {
  border-color: var(--color-primary-500, #23574f) !important;
  background: var(--color-primary-50, #f2f6f5);
}
.vue-flow__handle-valid {
  border-color: var(--color-primary-500, #23574f) !important;
  background: var(--color-primary-50, #f2f6f5);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary-500, #23574f) 25%, transparent) !important;
}
.vue-flow__edge-path {
  stroke: var(--surface-4);
  stroke-width: 2;
  transition: stroke 0.15s, stroke-width 0.15s;
}
.vue-flow__edge-interaction {
  stroke-width: 20;
}
.vue-flow__edge:hover .vue-flow__edge-path {
  stroke: var(--color-primary-500, #23574f);
  stroke-width: 3;
}
.vue-flow__edge.selected .vue-flow__edge-path,
.vue-flow__edge.edge-flow-downstream .vue-flow__edge-path {
  stroke: var(--color-primary-600, #1f4d46);
  stroke-width: 3;
  /* 选中连线 / 选中节点的全部下游连线加流动光带，强化「数据流」视觉 */
  stroke-dasharray: 8 4;
  animation: edge-flow 0.7s linear infinite;
}
@keyframes edge-flow {
  to {
    /* 负值 = 沿 source → target 方向移动 */
    stroke-dashoffset: -12;
  }
}
.vue-flow__connection-path {
  stroke: var(--color-primary-500, #23574f);
  stroke-width: 2;
  stroke-dasharray: 5 5;
}
/* Spotlight: applied while the user hovers a "connect to existing" item in
   the handle menu, so they can visually identify the matching node on the
   canvas without having to count. Pulses subtly to draw attention. */
.vue-flow__node.spotlight {
  z-index: 5;
  animation: spotlight-pulse 1.4s ease-in-out infinite;
}
.vue-flow__node.spotlight .canvas-node {
  outline: 2px solid var(--color-primary-500, #23574f);
  outline-offset: 2px;
}
@keyframes spotlight-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.45),
                0 1px 4px rgba(0, 0, 0, 0.06);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(99, 102, 241, 0.18),
                0 4px 12px rgba(99, 102, 241, 0.25);
  }
}
</style>
