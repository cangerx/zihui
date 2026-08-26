<template>
  <div class="h-full flex flex-col bg-surface-1 min-h-0">
    <!-- Header -->
    <header class="h-12 flex items-center justify-between px-4 bg-surface-0 border-b border-surface-3 flex-shrink-0">
      <div class="flex items-center gap-3">
        <button @click="goBack" class="flex items-center gap-1.5 px-1.5 py-1 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors" :title="embedded ? '返回画布' : '返回'">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
          <span class="text-xs font-medium text-text-primary">{{ embedded ? '返回画布' : '返回' }}</span>
        </button>
        <div class="min-w-0">
          <div class="text-sm font-medium text-text-primary truncate">{{ editorFileName }}</div>
          <div v-if="generation && !embedded && generation.model_id" class="text-[11px] text-text-tertiary">{{ modelStore.formatModelLabel(generation.model_provider_id, generation.model_id) }} / {{ generation.size }}</div>
        </div>
      </div>
      <div class="flex items-center gap-1.5">
        <button @click="undo" :disabled="!canUndo" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title="撤销 (Ctrl+Z)">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" /></svg>
        </button>
        <button @click="redo" :disabled="!canRedo" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title="重做 (Ctrl+Y)">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m15 15 6-6m0 0-6-6m6 6H9a6 6 0 0 0 0 12h3" /></svg>
        </button>
        <div class="w-px h-4 bg-surface-3 mx-1"></div>
        <button @click="resetCanvas" class="px-3 py-1.5 text-xs text-text-tertiary hover:text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors">重置</button>
        <button @click="saveProject" :disabled="saving || exporting || splittingSubject" class="px-3 py-1.5 text-xs text-text-tertiary hover:text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors disabled:opacity-50">保存工程</button>
        <button @click="openProject" :disabled="saving || exporting || splittingSubject" class="px-3 py-1.5 text-xs text-text-tertiary hover:text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors disabled:opacity-50">打开工程</button>
        <button @click="exportPsd" :disabled="saving || exporting || splittingSubject" class="px-3 py-1.5 text-xs text-text-tertiary hover:text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors disabled:opacity-50">导出 PSD</button>
        <button @click="exportSvg" :disabled="saving || exporting || splittingSubject" class="px-3 py-1.5 text-xs text-text-tertiary hover:text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors disabled:opacity-50">导出 SVG</button>
        <button @click="saveImage" :disabled="saving" class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50">
          {{ saving ? '保存中...' : (embedded ? '应用到节点' : '覆盖保存') }}
        </button>
        <button @click="prepareSaveToGallery" :disabled="saving" class="px-3 py-1.5 text-xs border border-primary-600 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors disabled:opacity-50">另存到图库</button>
      </div>
    </header>

    <div class="flex flex-1 overflow-hidden min-h-0">
      <!-- Left Toolbar：带中文名的工具格（画布内编辑与独立修图页共用） -->
      <div
        class="w-[200px] flex flex-col py-3 px-2.5 gap-3 bg-surface-0 border-r border-surface-3 flex-shrink-0 overflow-y-auto"
      >
        <div class="grid grid-cols-2 gap-1.5">
          <button
            v-for="tool in shellTools"
            :key="tool.id"
            type="button"
            @click="selectShellTool(tool)"
            :class="['flex flex-col items-center justify-center gap-1 h-[64px] rounded-lg border text-[11px] transition-colors', isShellToolActive(tool) ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-3 text-text-secondary hover:bg-surface-2 hover:text-text-primary']"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" :d="tool.icon" /></svg>
            {{ tool.label }}
          </button>
        </div>
        <div class="grid grid-cols-2 gap-1.5">
          <button
            v-for="tool in extraShellTools"
            :key="tool.id"
            type="button"
            @click="selectTool(tool.id)"
            :class="['flex flex-col items-center justify-center gap-1 h-[52px] rounded-lg border text-[11px] transition-colors', activeTool === tool.id ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-3 text-text-secondary hover:bg-surface-2 hover:text-text-primary']"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" :d="tool.icon" /></svg>
            {{ tool.label }}
          </button>
        </div>
        <div v-if="activeTool === 'draw' || activeTool === 'erase' || activeTool === 'inpaint'" class="space-y-2 pt-1 border-t border-surface-3">
          <p class="text-[11px] text-text-tertiary leading-relaxed">{{ toolHint }}</p>
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-text-secondary">{{ activeTool === 'erase' ? '橡皮大小' : '画笔大小' }}</span>
            <span class="text-[10px] text-text-tertiary">{{ activeBrushSize }}px</span>
          </div>
          <input
            v-if="activeTool === 'draw' || activeTool === 'erase'"
            type="range"
            min="1"
            :max="activeTool === 'erase' ? 100 : 50"
            v-model.number="drawBrushSize"
            class="w-full h-1 accent-primary-600"
            @input="updateBrush"
          />
          <input
            v-else
            type="range"
            min="5"
            max="100"
            v-model.number="maskBrushSize"
            class="w-full h-1 accent-primary-600"
            @input="updateMaskBrush"
          />
          <template v-if="activeTool === 'inpaint'">
            <button
              type="button"
              class="w-full px-2 py-1.5 text-[11px] rounded-lg border border-surface-3 text-text-secondary hover:bg-surface-2 disabled:opacity-40"
              :disabled="!maskExists"
              @click="clearMask"
            >清除蒙版</button>
            <button
              type="button"
              class="w-full px-2 py-1.5 text-[11px] rounded-lg border border-surface-3 text-text-secondary hover:bg-surface-2 disabled:opacity-40"
              :class="maskPreviewOn ? 'border-primary-500 bg-primary-50 text-primary-700' : ''"
              :disabled="!maskExists && !maskPreviewOn"
              @click="toggleMaskPreview"
            >{{ maskPreviewOn ? '退出预览' : '预览蒙版' }}</button>
          </template>
        </div>
        <div class="mt-auto pt-2 border-t border-surface-3 space-y-1.5">
          <button
            v-if="!embedded"
            type="button"
            class="w-full px-2 py-1.5 text-[11px] rounded-lg border border-surface-3 text-text-secondary hover:bg-surface-2"
            @click="regenerateWithRef"
          >用作参考图重新生成</button>
          <button
            type="button"
            class="w-full px-2 py-1.5 text-[11px] rounded-lg border border-surface-3 text-text-secondary hover:bg-surface-2 truncate"
            :title="editModelId ? `生图模型：${modelStore.formatModelLabel(editProviderId, editModelId)}` : '设置生图模型'"
            @click="modelDialogVisible = true"
          >{{ editModelId ? '已选模型' : '生图模型' }}</button>
        </div>
      </div>

      <!-- 统一右侧工作区：工具设置与图层不再并排挤压画布 -->
      <button
        v-if="rightPanelCollapsed"
        type="button"
        class="w-9 bg-surface-0 border-l border-surface-3 flex-shrink-0 order-3 flex items-start justify-center pt-3 text-text-tertiary hover:text-text-primary"
        title="展开右侧面板"
        @click="rightPanelCollapsed = false"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="m9 18 6-6-6-6" /></svg>
      </button>
      <div v-else class="w-[280px] max-w-[30vw] bg-surface-0 border-l border-surface-3 flex-shrink-0 overflow-hidden order-3 flex flex-col min-h-0">
        <div class="flex items-center gap-1 p-2 border-b border-surface-3 flex-shrink-0">
          <button
            type="button"
            class="flex-1 px-2 py-1.5 text-[11px] rounded-lg transition-colors"
            :class="rightPanelTab === 'tool' ? 'bg-surface-2 text-text-primary font-medium' : 'text-text-tertiary hover:text-text-secondary'"
            :disabled="!showRightPanel"
            @click="rightPanelTab = 'tool'"
          >{{ activeTool === 'inpaint' ? '局部重绘' : '工具设置' }}</button>
          <button
            type="button"
            class="flex-1 px-2 py-1.5 text-[11px] rounded-lg transition-colors"
            :class="rightPanelTab === 'layers' ? 'bg-surface-2 text-text-primary font-medium' : 'text-text-tertiary hover:text-text-secondary'"
            @click="rightPanelTab = 'layers'"
          >图层 {{ docLayers.length }}</button>
          <button type="button" class="w-7 h-7 flex items-center justify-center rounded-lg text-text-tertiary hover:bg-surface-2 hover:text-text-primary" title="收起右侧面板" @click="rightPanelCollapsed = true">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="m15 18-6-6 6-6" /></svg>
          </button>
        </div>

        <!-- Right Panel (contextual settings) -->
        <div v-show="rightPanelTab === 'tool' && showRightPanel" class="flex-1 min-h-0 overflow-y-auto p-3">
        <!-- Crop controls -->
        <div v-if="activeTool === 'crop'" class="space-y-3">
          <h4 class="text-xs font-medium text-text-secondary">裁剪</h4>
          <p class="text-[11px] text-text-tertiary">在画布上拖拽选择裁剪区域</p>
          <div class="flex gap-2">
            <button @click="applyCrop" class="flex-1 px-2 py-1.5 text-[11px] bg-primary-600 text-white rounded-lg hover:bg-primary-700">应用裁剪</button>
            <button @click="cancelCrop" class="flex-1 px-2 py-1.5 text-[11px] border border-surface-3 rounded-lg hover:bg-surface-2">取消</button>
          </div>
        </div>

        <div v-if="activeTool === 'corner'" class="space-y-3">
          <h4 class="text-xs font-medium text-text-secondary">边角</h4>
          <p class="text-[11px] text-text-tertiary">调整圆角、透明或颜色背景和四周边距</p>

          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[11px] text-text-secondary">关联圆角</span>
              <span class="text-[10px] text-text-tertiary">{{ cornerLinkedRadius }}px</span>
            </div>
            <input type="range" min="0" :max="cornerMaxRadius" v-model.number="cornerLinkedRadius" @input="applyLinkedCornerRadius" class="w-full h-1 accent-primary-600" />
            <div class="grid grid-cols-2 gap-1">
              <label v-for="c in cornerOptions" :key="c.id" class="flex items-center gap-1.5 text-[10px] text-text-tertiary">
                <input type="checkbox" v-model="cornerRadiusLinked[c.id]" class="w-3 h-3 accent-primary-600" />
                <span>{{ c.label }}</span>
              </label>
            </div>
          </div>

          <div class="space-y-2 border-t border-surface-3 pt-3">
            <div v-for="c in cornerOptions" :key="c.id" class="space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-[11px] text-text-secondary">{{ c.label }}</span>
                <input type="number" min="0" :max="cornerMaxRadius" v-model.number="cornerRadius[c.id]" @change="normalizeCornerRadius(c.id)" class="w-16 px-1.5 py-1 text-[10px] border border-surface-3 rounded bg-surface-0 text-right outline-none" />
              </div>
              <input type="range" min="0" :max="cornerMaxRadius" v-model.number="cornerRadius[c.id]" @input="normalizeCornerRadius(c.id)" class="w-full h-1 accent-primary-600" />
            </div>
          </div>

          <div class="space-y-2 border-t border-surface-3 pt-3">
            <div class="flex items-center justify-between">
              <span class="text-[11px] text-text-secondary">关联边距</span>
              <span class="text-[10px] text-text-tertiary">{{ cornerLinkedPadding }}%</span>
            </div>
            <input type="range" min="0" :max="cornerMaxPadding" v-model.number="cornerLinkedPadding" @input="applyLinkedCornerPadding" class="w-full h-1 accent-primary-600" />
            <div class="grid grid-cols-2 gap-1">
              <label v-for="e in edgeOptions" :key="e.id" class="flex items-center gap-1.5 text-[10px] text-text-tertiary">
                <input type="checkbox" v-model="cornerPaddingLinked[e.id]" class="w-3 h-3 accent-primary-600" />
                <span>{{ e.label }}</span>
              </label>
            </div>
          </div>

          <div class="space-y-2 border-t border-surface-3 pt-3">
            <div v-for="e in edgeOptions" :key="e.id" class="flex items-center justify-between gap-2">
              <span class="text-[11px] text-text-secondary">{{ e.label }}</span>
              <div class="flex items-center gap-1">
                <input type="number" min="0" :max="cornerMaxPadding" v-model.number="cornerPadding[e.id]" @change="normalizeCornerPadding(e.id)" class="w-16 px-1.5 py-1 text-[10px] border border-surface-3 rounded bg-surface-0 text-right outline-none" />
                <span class="text-[10px] text-text-tertiary">%</span>
              </div>
            </div>
          </div>

          <div class="space-y-2 border-t border-surface-3 pt-3">
            <span class="text-[11px] text-text-secondary">背景</span>
            <label class="flex items-center gap-1.5 text-[11px] text-text-tertiary">
              <input type="radio" value="transparent" v-model="cornerBackgroundMode" class="w-3 h-3 accent-primary-600" />
              <span>透明背景</span>
            </label>
            <label class="flex items-center gap-1.5 text-[11px] text-text-tertiary">
              <input type="radio" value="color" v-model="cornerBackgroundMode" class="w-3 h-3 accent-primary-600" />
              <span>颜色填充</span>
              <input type="color" v-model="cornerBackgroundColor" :disabled="cornerBackgroundMode !== 'color'" class="w-6 h-6 rounded border border-surface-3 cursor-pointer disabled:opacity-40" />
            </label>
          </div>

          <div class="flex gap-2 pt-1">
            <button @click="applyCornerSettings" class="flex-1 px-2 py-1.5 text-[11px] bg-primary-600 text-white rounded-lg hover:bg-primary-700">应用边角</button>
            <button @click="resetCornerSettings" class="flex-1 px-2 py-1.5 text-[11px] border border-surface-3 rounded-lg hover:bg-surface-2">重置</button>
          </div>
          <p class="text-[10px] text-text-tertiary">未应用时直接保存，也会按当前设置输出。</p>
        </div>

        <!-- Rotate/Flip controls -->
        <div v-if="activeTool === 'rotate'" class="space-y-3">
          <h4 class="text-xs font-medium text-text-secondary">旋转 / 翻转</h4>
          <div class="grid grid-cols-2 gap-2">
            <button @click="rotateImage(-90)" class="px-2 py-2 text-[11px] border border-surface-3 rounded-lg hover:bg-surface-2 text-text-secondary">左转 90</button>
            <button @click="rotateImage(90)" class="px-2 py-2 text-[11px] border border-surface-3 rounded-lg hover:bg-surface-2 text-text-secondary">右转 90</button>
            <button @click="flipImage('h')" class="px-2 py-2 text-[11px] border border-surface-3 rounded-lg hover:bg-surface-2 text-text-secondary">水平翻转</button>
            <button @click="flipImage('v')" class="px-2 py-2 text-[11px] border border-surface-3 rounded-lg hover:bg-surface-2 text-text-secondary">垂直翻转</button>
          </div>
        </div>

        <!-- Filter controls -->
        <div v-if="activeTool === 'filter'" class="space-y-3">
          <h4 class="text-xs font-medium text-text-secondary">滤镜</h4>
          <div v-for="f in filterControls" :key="f.key" class="space-y-1">
            <div class="flex items-center justify-between">
              <span class="text-[11px] text-text-secondary">{{ f.label }}</span>
              <span class="text-[10px] text-text-tertiary w-8 text-right">{{ f.value }}</span>
            </div>
            <input type="range" :min="f.min" :max="f.max" :step="f.step" v-model.number="f.value" @input="applyFilters" class="w-full h-1 accent-primary-600" />
          </div>
          <div class="flex gap-2 pt-1">
            <button @click="applyPresetFilter('grayscale')" class="flex-1 px-2 py-1.5 text-[11px] border border-surface-3 rounded-lg hover:bg-surface-2 text-text-secondary">灰度</button>
            <button @click="applyPresetFilter('sepia')" class="flex-1 px-2 py-1.5 text-[11px] border border-surface-3 rounded-lg hover:bg-surface-2 text-text-secondary">复古</button>
            <button @click="applyPresetFilter('invert')" class="flex-1 px-2 py-1.5 text-[11px] border border-surface-3 rounded-lg hover:bg-surface-2 text-text-secondary">反色</button>
          </div>
          <button @click="resetFilters" class="w-full px-2 py-1.5 text-[11px] border border-surface-3 rounded-lg hover:bg-surface-2 text-text-tertiary">重置滤镜</button>
        </div>

        <!-- Text controls -->
        <div v-if="activeTool === 'text'" class="space-y-3">
          <h4 class="text-xs font-medium text-text-secondary">文字</h4>
          <div class="space-y-2">
            <input v-model="textContent" placeholder="输入文字内容" class="w-full px-2 py-1.5 text-xs border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-1 focus:ring-primary-500" />
            <div class="flex gap-2">
              <select v-model="textFontSize" class="flex-1 px-2 py-1.5 text-[11px] border border-surface-3 rounded-lg bg-surface-0 outline-none">
                <option :value="16">16px</option>
                <option :value="24">24px</option>
                <option :value="32">32px</option>
                <option :value="48">48px</option>
                <option :value="64">64px</option>
                <option :value="96">96px</option>
              </select>
              <input type="color" v-model="textColor" class="w-8 h-8 rounded border border-surface-3 cursor-pointer" />
            </div>
            <button @click="addText" class="w-full px-2 py-1.5 text-[11px] bg-primary-600 text-white rounded-lg hover:bg-primary-700">添加文字</button>
          </div>
        </div>

        <!-- Draw controls -->
        <div v-if="activeTool === 'draw'" class="space-y-3">
          <h4 class="text-xs font-medium text-text-secondary">画笔</h4>
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[11px] text-text-secondary">笔刷大小</span>
              <span class="text-[10px] text-text-tertiary">{{ drawBrushSize }}px</span>
            </div>
            <input type="range" min="1" max="50" v-model.number="drawBrushSize" @input="updateBrush" class="w-full h-1 accent-primary-600" />
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-text-secondary">颜色</span>
              <input type="color" v-model="drawColor" @input="updateBrush" class="w-6 h-6 rounded border border-surface-3 cursor-pointer" />
            </div>
          </div>
        </div>

        <!-- Sticker controls -->
        <div v-if="activeTool === 'sticker'">
          <StickerLibraryPanel
            :has-selection="stickerSelected"
            :blend-mode="stickerBlendMode"
            :opacity="stickerOpacity"
            @pick="addSticker"
            @update:blend-mode="updateStickerBlendMode"
            @update:opacity="updateStickerOpacity"
            @flip="flipSticker"
            @duplicate="duplicateSticker"
            @bring-forward="bringStickerForward"
            @send-backward="sendStickerBackward"
            @delete="deleteSelectedSticker"
          />
        </div>

        <!-- Inpaint controls -->
        <div v-if="activeTool === 'inpaint'" class="space-y-3">
          <h4 class="text-xs font-medium text-text-secondary">AI 局部重绘</h4>

          <!-- 涂抹方式 -->
          <div>
            <span class="text-[11px] text-text-secondary block mb-1">涂抹方式</span>
            <div class="grid grid-cols-4 gap-1">
              <button
                v-for="s in maskShapeOptions"
                :key="s.id"
                @click="setMaskShape(s.id)"
                :class="['px-1 py-1.5 text-[10px] rounded border transition-colors', maskShape === s.id ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-3 text-text-tertiary hover:bg-surface-2']"
              >{{ s.label }}</button>
            </div>
          </div>

          <!-- 笔刷大小 -->
          <div>
            <div class="flex items-center justify-between">
              <span class="text-[11px] text-text-secondary">笔刷</span>
              <span class="text-[10px] text-text-tertiary">{{ maskBrushSize }}px</span>
            </div>
            <input type="range" min="5" max="100" v-model.number="maskBrushSize" @input="updateMaskBrush" class="w-full h-1 accent-orange-500" />
          </div>

          <!-- Mask 操作 -->
          <div class="flex gap-1">
            <button @click="undoMaskStroke" :disabled="!canUndoMask" class="flex-1 px-1 py-1 text-[10px] border border-surface-3 rounded hover:bg-surface-2 text-text-tertiary disabled:opacity-40 disabled:cursor-not-allowed">撤销</button>
            <button @click="invertMask" class="flex-1 px-1 py-1 text-[10px] border border-surface-3 rounded hover:bg-surface-2 text-text-tertiary">反转</button>
            <button @click="clearMask" class="flex-1 px-1 py-1 text-[10px] border border-surface-3 rounded hover:bg-surface-2 text-text-tertiary">清除</button>
            <button @click="toggleMaskPreview" :disabled="!maskExists && !maskPreviewOn" class="flex-1 px-1 py-1 text-[10px] border border-surface-3 rounded hover:bg-surface-2 text-text-tertiary disabled:opacity-40" :class="maskPreviewOn ? 'border-primary-500 bg-primary-50 text-primary-700' : ''">{{ maskPreviewOn ? '退出' : '预览' }}</button>
          </div>

          <div class="border-t border-surface-3 pt-3 space-y-2">
            <PromptTextarea
              v-model="inpaintPrompt"
              title="编辑重绘提示词"
              :height="88"
              :max-length="inpaintPromptMaxLength"
              :placeholder="usePromptTemplate ? currentTemplate().placeholder : '描述你想要重绘的内容...'"
              input-class="text-xs"
            />

            <!-- 候选数 -->
            <div>
              <div class="flex items-center justify-between">
                <span class="text-[11px] text-text-secondary">候选数</span>
                <span class="text-[10px] text-text-tertiary">{{ batchCount }} 张</span>
              </div>
              <input type="range" min="1" max="4" v-model.number="batchCount" class="w-full h-1 accent-orange-500" />
            </div>

            <!-- 并发控制由主进程全局 semaphore (6) 统一接管，不再暴露 per-call 滑块 -->

            <details class="rounded-lg border border-surface-3 px-2 py-1.5">
              <summary class="text-[11px] text-text-secondary cursor-pointer select-none">高级设置</summary>
              <div class="space-y-2.5 pt-2">
                <div>
                  <div class="flex items-center justify-between">
                    <span class="text-[11px] text-text-secondary">边缘羽化</span>
                    <span class="text-[10px] text-text-tertiary">{{ maskFeather }}px</span>
                  </div>
                  <input type="range" min="0" max="20" v-model.number="maskFeather" class="w-full h-1 accent-orange-500" />
                </div>
                <div>
                  <label class="flex items-center gap-1.5 mb-1.5 cursor-pointer">
                    <input type="checkbox" v-model="usePromptTemplate" class="w-3 h-3 accent-orange-500" />
                    <span class="text-[11px] text-text-secondary">使用 prompt 模板</span>
                  </label>
                  <div v-if="usePromptTemplate" class="grid grid-cols-4 gap-1">
                    <button
                      v-for="t in promptTemplates"
                      :key="t.id"
                      @click="activeTemplate = t.id"
                      :class="['px-1 py-1.5 text-[10px] rounded border transition-colors', activeTemplate === t.id ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-3 text-text-tertiary hover:bg-surface-2']"
                    >{{ t.label }}</button>
                  </div>
                </div>
                <label class="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" v-model="compositeBlend" class="w-3 h-3 accent-orange-500" />
                  <span class="text-[11px] text-text-secondary">合成模式（保留非遮罩区原像素）</span>
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" v-model="keepEditLayers" class="w-3 h-3 accent-orange-500" />
                  <span class="text-[11px] text-text-secondary">保留文字/画笔图层</span>
                </label>
                <p class="text-[10px] text-text-tertiary">[ 缩小 · ] 放大 · E 擦除 · I 反转 · Ctrl+Z 撤销笔触</p>
              </div>
            </details>

            <button
              @click="runInpaint"
              :disabled="inpainting"
              class="w-full px-2 py-2 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {{ inpainting ? (inpaintProgress.message || '重绘中...') : '开始重绘' }}
            </button>
            <button
              v-if="inpainting"
              @click="cancelInpaint"
              class="w-full px-2 py-1.5 text-[11px] border border-surface-3 rounded-lg hover:bg-surface-2 text-text-tertiary"
            >取消</button>
          </div>

          <!-- 历史 -->
          <div v-if="inpaintHistory.length > 0" class="border-t border-surface-3 pt-3">
            <h5 class="text-[11px] text-text-secondary mb-1.5">重绘历史</h5>
            <div class="space-y-1 max-h-48 overflow-y-auto">
              <div v-for="(h, i) in inpaintHistory" :key="i" class="flex gap-1.5 items-start p-1 rounded hover:bg-surface-2">
                <img :src="h.thumbnail" class="w-10 h-10 object-cover rounded border border-surface-3 flex-shrink-0" />
                <div class="flex-1 min-w-0">
                  <p class="text-[10px] text-text-secondary truncate" :title="h.prompt">{{ h.prompt }}</p>
                  <p class="text-[10px] text-text-tertiary">{{ formatTime(h.timestamp) }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

        <div v-show="rightPanelTab === 'layers'" class="flex-1 min-h-0 overflow-hidden p-3">
        <LayerPanel
          :layers="docLayers"
          :selected-id="selectedLayerId"
          :splitting="splittingSubject"
          @select="onSelectLayer"
          @toggle-visible="onToggleLayerVisible"
          @toggle-lock="onToggleLayerLock"
          @rename="onRenameLayer"
          @opacity="onLayerOpacity"
          @opacity-commit="onLayerOpacityCommit"
          @reorder="onReorderLayers"
          @split-subject="splitSubjectBackground"
        />
        </div>
      </div>

      <!-- Canvas Area -->
      <div class="flex-1 flex flex-col overflow-hidden relative img-edit-checker order-2" ref="canvasContainerRef">
        <div class="flex-1 flex items-center justify-center overflow-hidden p-3">
          <canvas ref="canvasRef"></canvas>
        </div>
        <div
          v-if="maskPreviewOn && maskPreviewUrl"
          class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 p-6 img-edit-checker"
        >
          <img :src="maskPreviewUrl" alt="蒙版预览" class="max-w-full max-h-[calc(100%-48px)] object-contain shadow-sm border border-surface-3 bg-black" />
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded-lg border border-surface-3 bg-surface-0 text-text-secondary hover:bg-surface-2"
            @click="maskPreviewOn = false"
          >退出预览</button>
        </div>
        <div v-if="loading" class="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 img-edit-checker">
          <svg class="w-8 h-8 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
          <span class="text-xs text-text-tertiary">加载图片中...</span>
        </div>

        <!-- Compare overlay (candidate selection + split view) -->
        <div v-if="compareMode !== 'none'" class="absolute inset-0 z-20 flex flex-col bg-[#f0f0f0]">
          <!-- Toolbar -->
          <div class="bg-surface-0 border-b border-surface-3 px-3 py-2 flex items-center gap-2 flex-shrink-0">
            <span class="text-xs text-text-secondary">候选：</span>
            <button
              v-for="(_, i) in compareCandidates"
              :key="i"
              @click="compareSelectedIndex = i"
              :class="['w-7 h-7 text-xs rounded flex items-center justify-center transition-colors', compareSelectedIndex === i ? 'bg-primary-600 text-white' : 'border border-surface-3 text-text-tertiary hover:bg-surface-2']"
            >{{ i + 1 }}</button>
            <div class="flex-1"></div>
            <label class="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
              <input type="checkbox" v-model="compareShowOriginal" class="w-3 h-3 accent-orange-500" />
              <span>对比原图</span>
            </label>
            <button @click="cancelCompare" class="px-3 py-1 text-xs border border-surface-3 rounded hover:bg-surface-2 text-text-tertiary">取消</button>
            <button @click="applyCompareResult" class="px-3 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700">应用</button>
          </div>

          <!-- Compare viewport -->
          <div class="flex-1 flex items-center justify-center overflow-hidden p-6 relative">
            <div class="relative inline-block">
              <!-- Candidate (bottom layer) -->
              <img
                :src="compareCandidates[compareSelectedIndex]"
                class="block max-w-full max-h-[calc(100vh-14rem)] object-contain"
              />
              <!-- Original overlay (clipped by split) -->
              <img
                v-if="compareShowOriginal && originalSnapshotDataUrl"
                :src="originalSnapshotDataUrl"
                class="absolute inset-0 w-full h-full object-contain pointer-events-none"
                :style="{ clipPath: 'inset(0 ' + (100 - compareSplit) + '% 0 0)' }"
              />
              <!-- Divider line -->
              <div
                v-if="compareShowOriginal && originalSnapshotDataUrl"
                class="absolute top-0 bottom-0 w-0.5 bg-primary-500 pointer-events-none"
                :style="{ left: compareSplit + '%' }"
              ></div>
            </div>
            <!-- Split slider -->
            <div v-if="compareShowOriginal && originalSnapshotDataUrl" class="absolute left-1/2 bottom-3 -translate-x-1/2 bg-surface-0 border border-surface-3 rounded-full px-3 py-1 shadow flex items-center gap-2 z-10">
              <span class="text-[10px] text-text-tertiary">原图</span>
              <input type="range" min="0" max="100" v-model.number="compareSplit" class="w-40 h-1 accent-orange-500" />
              <span class="text-[10px] text-text-tertiary">结果</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <div v-if="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-surface-0 shadow-lg border border-surface-3 text-xs text-text-primary">{{ toast }}</div>

    <!-- O8: 生图模型设置弹窗 -->
    <ImageEditModelDialog
      v-model:visible="modelDialogVisible"
      :initial-provider-id="editProviderId"
      :initial-model-id="editModelId"
      @confirm="onModelConfirm"
    />

    <!-- O4-4: 另存到图库弹窗 -->
    <GallerySaveDialog
      v-model:visible="gallerySaveVisible"
      :preview-data-uri="gallerySaveDataUri"
      :default-name="gallerySaveDefaultName"
      @confirm="onGallerySaveConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Canvas, FabricImage, Rect, Ellipse, IText, PencilBrush, filters, Path, Point, Control, util } from 'fabric'
import type { FabricObject, TMat2D, TPointerEvent, Transform } from 'fabric'
import { recordUsage, warmHintsCache } from '@/utils/model-usage-hints'
import { translateError } from '@/utils/error-message'
import { useSiteConfigStore } from '@/stores/site-config'
import { useModelStore } from '@/stores/models'
import ImageEditModelDialog from '@/components/ImageEditModelDialog.vue'
import GallerySaveDialog from '@/components/GallerySaveDialog.vue'
import StickerLibraryPanel from '@/components/StickerLibraryPanel.vue'
import { useGalleryStore } from '@/stores/gallery'
import { useMattingStore } from '@/stores/matting'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { friendlyMattingError } from '@/utils/matting-error'
import PromptTextarea from '@/components/PromptTextarea.vue'
import LayerPanel from '@/components/image-edit/LayerPanel.vue'
import { useImageLayers } from '@/composables/useImageLayers'
import { buildPsdBuffer, buildHybridSvg, arrayBufferToBase64 } from '@/utils/image-doc-export'
import { IMAGE_DOC_KIND, IMAGE_DOC_VERSION } from '@shared/image-doc'
import { IMAGE_PROMPT_MAX_LENGTH, assertImagePromptLength } from '@shared/prompt-limits'

const props = withDefaults(defineProps<{
  embedded?: boolean
  sourcePath?: string
  sourceDataUri?: string
}>(), {
  embedded: false,
  sourcePath: '',
  sourceDataUri: ''
})
const emit = defineEmits<{
  close: []
  apply: [dataUrl: string]
}>()

const embedded = computed(() => props.embedded)

const editorFileName = computed(() => {
  const raw = (props.sourcePath || generation.value?.result_path || '').trim()
  const fallback = embedded.value ? '参考图' : '图片编辑'
  if (!raw) return fallback
  const cleaned = raw.split(/[?#]/)[0]
  const base = cleaned.split(/[/\\]/).pop() || ''
  try {
    return decodeURIComponent(base) || fallback
  } catch {
    return base || fallback
  }
})

const route = useRoute()
const router = useRouter()
const modelStore = useModelStore()
const siteConfig = useSiteConfigStore()
const mattingStore = useMattingStore()
const cloudAuth = useCloudAuthStore()
const api = () => (window as any).api

function exportErrorMessage(e: any): string {
  const raw = String(e?.message || e || '未知错误')
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}

async function fallbackDownloadFile(options: {
  defaultName: string
  data: string
  encoding?: 'utf8' | 'base64'
  filters?: Array<{ name: string; extensions: string[] }>
}): Promise<{ canceled: boolean }> {
  let bytes: BlobPart = options.data
  if (options.encoding === 'base64') {
    const bin = atob(options.data)
    const raw = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i)
    bytes = raw
  }
  const picker = (window as any).showSaveFilePicker as undefined | ((opts: any) => Promise<any>)
  if (typeof picker === 'function') {
    try {
      const ext = options.filters?.[0]?.extensions?.map((e) => `.${e}`) || []
      const handle = await picker({
        suggestedName: options.defaultName,
        types: ext.length
          ? [{ description: options.filters?.[0]?.name || '文件', accept: { '*/*': ext } }]
          : undefined
      })
      const writable = await handle.createWritable()
      await writable.write(bytes)
      await writable.close()
      return { canceled: false }
    } catch (e: any) {
      if (e?.name === 'AbortError') return { canceled: true }
    }
  }
  const blob = new Blob([bytes], {
    type: options.defaultName.endsWith('.svg') ? 'image/svg+xml;charset=utf-8' : 'application/octet-stream'
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = options.defaultName
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
  return { canceled: false }
}

async function invokeExport(channel: 'saveBuffer' | 'saveProject' | 'openProject', payload?: unknown) {
  const bridge = api()
  const attempts: Array<() => Promise<any>> = []
  if (bridge?.imageExport?.invoke) {
    attempts.push(() => bridge.imageExport.invoke(channel, payload))
  }
  if (bridge?.imageGen?.invoke) {
    const mapped =
      channel === 'saveBuffer' ? 'saveExportBuffer' : channel === 'saveProject' ? 'saveExportProject' : 'openExportProject'
    attempts.push(() => bridge.imageGen.invoke(mapped, payload))
  }
  let lastErr: any
  for (const run of attempts) {
    try {
      return await run()
    } catch (e: any) {
      lastErr = e
      if (!/No handler registered/i.test(exportErrorMessage(e))) throw e
    }
  }
  if (channel === 'openProject') return await openProjectViaExistingDialog()
  if (channel === 'saveProject' && payload && typeof (payload as any).json === 'string') {
    return await fallbackDownloadFile({
      defaultName: (payload as any).defaultName || 'project.haohuoban-image.json',
      data: (payload as any).json,
      filters: [{ name: '好伙伴图片工程', extensions: ['json'] }]
    })
  }
  throw lastErr || new Error('导出通道不可用，请完全退出后重新打开应用')
}

async function openProjectViaExistingDialog(): Promise<{ canceled: boolean; json?: string; filePath?: string }> {
  const bridge = api()
  if (!bridge?.dialog?.openFile) throw new Error('无法打开文件选择框，请完全退出后重新打开应用')
  const picked = await bridge.dialog.openFile({
    title: '打开图片工程',
    filters: [{ name: '好伙伴图片工程', extensions: ['json'] }],
    properties: ['openFile']
  }) as { canceled?: boolean; filePaths?: string[] }
  if (picked?.canceled || !picked?.filePaths?.[0]) return { canceled: true }
  const filePath = picked.filePaths[0]
  const json = await bridge.chat.invoke('readFileText', filePath)
  if (typeof json !== 'string' || json.startsWith('[文档解析失败')) {
    throw new Error('无法读取工程文件')
  }
  return { canceled: false, filePath, json }
}

async function saveExportBuffer(options: {
  defaultName: string
  filters: Array<{ name: string; extensions: string[] }>
  data: string
  encoding?: 'utf8' | 'base64'
}): Promise<{ canceled?: boolean; filePath?: string }> {
  try {
    return await invokeExport('saveBuffer', options)
  } catch (e: any) {
    const msg = exportErrorMessage(e)
    if (!/No handler registered|不可用|undefined/i.test(msg)) throw e
    return await fallbackDownloadFile(options)
  }
}

const {
  layers: docLayers,
  selectedLayerId,
  ensureObjectLayerId,
  rebuild: rebuildLayers,
  applyObjectFlags,
  setVisible: setLayerVisible,
  setLocked: setLayerLocked,
  setOpacity: setLayerOpacity,
  rename: renameLayer,
  reorder: reorderLayers,
  selectOnCanvas,
  syncSelectionFromCanvas,
  findObject: findLayerObject
} = useImageLayers()

function isDrawingTool() {
  return activeTool.value === 'draw' || activeTool.value === 'inpaint' || activeTool.value === 'erase'
}

function refreshLayers() {
  rebuildLayers(fabricCanvas)
  applyObjectFlags(fabricCanvas, isDrawingTool())
}

// ---- Refs ----
const canvasRef = ref<HTMLCanvasElement | null>(null)
const canvasContainerRef = ref<HTMLElement | null>(null)

// Non-reactive Fabric state
let fabricCanvas: Canvas | null = null
let baseImage: FabricImage | null = null
let displayScale = 1
let originalW = 0
let originalH = 0
const imageSizeVersion = ref(0)

type CanvasRegion = { left: number; top: number; width: number; height: number }
type CornerKey = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft'
type EdgeKey = 'top' | 'right' | 'bottom' | 'left'
type CornerBackgroundMode = 'transparent' | 'color'

// ---- Reactive state ----
const loading = ref(true)
const saving = ref(false)
const exporting = ref(false)
const splittingSubject = ref(false)
const inpainting = ref(false)
const toast = ref('')
const generation = ref<any>(null)
const activeTool = ref('select')
const rightPanelTab = ref<'tool' | 'layers'>('layers')
const rightPanelCollapsed = ref(false)

// O8: 用户在图片编辑里设置的生图模型（用 settings 持久化，跨打开记忆）
const editProviderId = ref('')
const editModelId = ref('')
const modelDialogVisible = ref(false)

// O4-4: 另存到图库弹窗
const galleryStore = useGalleryStore()
const gallerySaveVisible = ref(false)
const gallerySaveDataUri = ref('')
const gallerySaveDefaultName = ref('')

// Text tool
const textContent = ref('文字')
const textFontSize = ref(32)
const textColor = ref('#ffffff')

// Draw tool
const drawBrushSize = ref(5)
const drawColor = ref('#ff0000')

const cornerRadius = reactive<Record<CornerKey, number>>({
  topLeft: 0,
  topRight: 0,
  bottomRight: 0,
  bottomLeft: 0,
})
const cornerRadiusLinked = reactive<Record<CornerKey, boolean>>({
  topLeft: true,
  topRight: true,
  bottomRight: true,
  bottomLeft: true,
})
const cornerPadding = reactive<Record<EdgeKey, number>>({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
})
const cornerPaddingLinked = reactive<Record<EdgeKey, boolean>>({
  top: true,
  right: true,
  bottom: true,
  left: true,
})
const cornerLinkedRadius = ref(0)
const cornerLinkedPadding = ref(0)
const cornerBackgroundMode = ref<CornerBackgroundMode>('transparent')
const cornerBackgroundColor = ref('#ffffff')
let cornerPreviewTimer: ReturnType<typeof setTimeout> | null = null
let cornerPreviewSeq = 0
let cornerPreviewBackground: Rect | null = null
let cornerPreviewCanvasSize: { width: number; height: number } | null = null
const cornerPreviewObjectStates = new Map<FabricObject, { left: number; top: number; scaleX: number; scaleY: number; visible: boolean; clipPath: any }>()
const cornerOptions: Array<{ id: CornerKey; label: string }> = [
  { id: 'topLeft', label: '左上角' },
  { id: 'topRight', label: '右上角' },
  { id: 'bottomRight', label: '右下角' },
  { id: 'bottomLeft', label: '左下角' },
]
const edgeOptions: Array<{ id: EdgeKey; label: string }> = [
  { id: 'top', label: '上边距' },
  { id: 'right', label: '右边距' },
  { id: 'bottom', label: '下边距' },
  { id: 'left', label: '左边距' },
]
const cornerMaxRadius = computed(() => {
  imageSizeVersion.value
  return Math.max(0, Math.floor(Math.min(originalW, originalH) / 2))
})
const cornerMaxPadding = computed(() => {
  return 99
})

// Sticker tool: 选中贴图时面板控件回显这些响应式值（由 selection 事件同步）
const stickerSelected = ref(false)
const stickerBlendMode = ref('source-over')
const stickerOpacity = ref(100)
// 连续添加贴图（图库多选 / 重复点同一形状）时的位置偏移计数器，
// 0..4 循环，每张沿对角线 +24px 错开，避免堆在同一点看不到差异
let stickerJitterCounter = 0

// Inpaint tool
type MaskShape = 'brush' | 'eraser' | 'rect' | 'ellipse'
interface InpaintHistoryEntry { thumbnail: string; prompt: string; timestamp: number }

const maskBrushSize = ref(30)
const maskRevision = ref(0)
const maskPreviewOn = ref(false)
const maskPreviewUrl = ref('')
const maskExists = computed(() => {
  void maskRevision.value
  return hasAnyMask()
})

const toolHint = computed(() => {
  if (activeTool.value === 'erase') return '擦除画面上的像素，可去掉画笔或底图内容'
  if (activeTool.value === 'draw') return '在图上涂画'
  return '使用画笔涂抹需要重绘的区域'
})

const activeBrushSize = computed(() =>
  activeTool.value === 'draw' || activeTool.value === 'erase' ? drawBrushSize.value : maskBrushSize.value
)
const inpaintPrompt = ref('')
const maskShape = ref<MaskShape>('brush')
const maskFeather = ref(3)
const usePromptTemplate = ref(true)
const activeTemplate = ref('replace')
const batchCount = ref(1)
const compositeBlend = ref(true)
const keepEditLayers = ref(false)
const inpaintProgress = ref({ completed: 0, total: 0, message: '' })
const inpaintHistory = ref<InpaintHistoryEntry[]>([])
let inpaintCancelled = false

// Mask-only stroke stack for in-paint undo (independent of global history)
// Initialize with an empty baseline snapshot so first stroke is immediately undoable
const maskStrokeStack = ref<any[][]>([[]])
const maskStrokeIndex = ref(0)
const canUndoMask = computed(() => maskStrokeIndex.value > 0)

// Compare / candidate review state
type CompareMode = 'none' | 'single' | 'multi'
const compareMode = ref<CompareMode>('none')
const compareCandidates = ref<string[]>([])
const compareSelectedIndex = ref(0)
const compareSplit = ref(50)
const compareShowOriginal = ref(true)
const originalSnapshotDataUrl = ref<string | null>(null)
const activeMaskDataUrl = ref<string | null>(null)

const maskShapeOptions: Array<{ id: MaskShape; label: string }> = [
  { id: 'brush', label: '画笔' },
  { id: 'eraser', label: '擦除' },
  { id: 'rect', label: '矩形' },
  { id: 'ellipse', label: '椭圆' }
]

const promptTemplates: Array<{ id: string; label: string; placeholder: string; allowEmpty?: boolean; wrap: (p: string) => string }> = [
  {
    id: 'replace',
    label: '替换',
    placeholder: '描述替换后的内容，例如：一只橘色的猫',
    wrap: (p) => `Replace the masked region with: ${p}. Preserve the original lighting, perspective, and style; keep the rest of the image unchanged.`
  },
  {
    id: 'remove',
    label: '移除',
    placeholder: '可留空，或描述要填补的背景',
    allowEmpty: true,
    wrap: (p) => p.trim()
      ? `Seamlessly remove the object in the masked region and fill with: ${p}. Match the surrounding texture, lighting, and style naturally.`
      : `Seamlessly remove the object in the masked region and fill it with the surrounding background content. Preserve lighting and style continuity.`
  },
  {
    id: 'fix',
    label: '修复',
    placeholder: '描述瑕疵，例如：去除划痕',
    wrap: (p) => `Restore and repair the masked region: ${p}. Keep the rest of the image untouched and match original style.`
  },
  {
    id: 'enhance',
    label: '增强',
    placeholder: '描述需要增强的细节',
    wrap: (p) => `Enhance and refine the masked region: ${p}. Preserve the original style and ensure consistent lighting across the image.`
  }
]

function currentTemplate() {
  return promptTemplates.find(t => t.id === activeTemplate.value) || promptTemplates[0]
}

function buildFinalPrompt(): string {
  const p = inpaintPrompt.value.trim()
  if (!usePromptTemplate.value) return p
  return currentTemplate().wrap(p)
}

const inpaintPromptMaxLength = computed(() => {
  if (!usePromptTemplate.value) return IMAGE_PROMPT_MAX_LENGTH
  const overhead = currentTemplate().wrap('').length
  return Math.max(1, IMAGE_PROMPT_MAX_LENGTH - overhead)
})

// Filter state (Fabric filter values, non-destructive)
const filterControls = reactive([
  { key: 'brightness', label: '亮度', value: 0, min: -100, max: 100, step: 1 },
  { key: 'contrast', label: '对比度', value: 0, min: -100, max: 100, step: 1 },
  { key: 'saturation', label: '饱和度', value: 0, min: -100, max: 100, step: 1 },
  { key: 'blur', label: '模糊', value: 0, min: 0, max: 100, step: 1 },
])

// History (snapshot-based undo/redo)
const MAX_HISTORY = 20
const history = shallowRef<string[]>([])
const historyIndex = ref(-1)
const canUndo = computed(() => historyIndex.value > 0)
const canRedo = computed(() => historyIndex.value < history.value.length - 1)

// ---- Tools ----
type ShellTool = { id: string; label: string; icon: string; kind: 'inpaint' | 'eraser' | string }
const _unusedLegacyTools = [
  { id: 'crop', label: '裁剪', icon: 'M7.848 8.25l1.536.887M7.848 8.25a3 3 0 1 1-5.196-3 3 3 0 0 1 5.196 3Zm1.536.887a2.165 2.165 0 0 1 1.083 1.839c.005.19.005.383 0 .575m0 0-1.647 1.647M15 3v18m6-6H3' },
  { id: 'corner', label: '边角', icon: 'M4.5 9.75V6.75A2.25 2.25 0 0 1 6.75 4.5h3m3.75 0h3A2.25 2.25 0 0 1 18.75 6.75v3m0 3.75v3A2.25 2.25 0 0 1 16.5 18.75h-3m-3.75 0h-3A2.25 2.25 0 0 1 4.5 16.5v-3' },
  { id: 'rotate', label: '旋转/翻转', icon: 'M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 0 0-3.7-3.7 48.678 48.678 0 0 0-7.324 0 4.006 4.006 0 0 0-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 0 0 3.7 3.7 48.656 48.656 0 0 0 7.324 0 4.006 4.006 0 0 0 3.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3-3 3' },
  { id: 'filter', label: '滤镜', icon: 'M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75' },
  { id: 'text', label: '文字', icon: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z' },
  { id: 'sticker', label: '贴图', icon: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9 10h.008v.008H9V10Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM15 10h.008v.008H15V10Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM15.182 15.182a4.5 4.5 0 0 1-6.364 0' },
  { id: 'draw', label: '画笔', icon: 'm16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125' },
]

const shellTools: ShellTool[] = [
  { id: 'inpaint', label: '蒙版', kind: 'inpaint', icon: 'M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42' },
  { id: 'draw', label: '画笔', kind: 'draw', icon: 'm16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125' },
  { id: 'eraser', label: '橡皮擦', kind: 'eraser', icon: 'M5 16 16 5l3 3-11 11H5v-3Zm11.5-8.5L19 10' },
  { id: 'crop', label: '裁剪', kind: 'crop', icon: 'M7.848 8.25l1.536.887M7.848 8.25a3 3 0 1 1-5.196-3 3 3 0 0 1 5.196 3Zm1.536.887a2.165 2.165 0 0 1 1.083 1.839c.005.19.005.383 0 .575m0 0-1.647 1.647M15 3v18m6-6H3' },
  { id: 'filter', label: '滤镜', kind: 'filter', icon: 'M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75' },
  { id: 'rotate', label: '旋转', kind: 'rotate', icon: 'M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 0 0-3.7-3.7 48.678 48.678 0 0 0-7.324 0 4.006 4.006 0 0 0-3.7 3.7c.017.22-.032.441-.046.662M19.5 12l3-3m-3 3-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 0 0 3.7 3.7 48.656 48.656 0 0 0 7.324 0 4.006 4.006 0 0 0 3.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3-3 3' }
]

const extraShellTools = [
  { id: 'select', label: '选择', icon: 'M15.042 21.672 13.684 16.6m0 0-2.51 2.225.569-9.47 5.227 7.917-3.286-.672ZM12 2.25V4.5m5.834.166-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243-1.59-1.59' },
  { id: 'text', label: '文字', icon: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z' },
  { id: 'sticker', label: '贴图', icon: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9 10h.008v.008H9V10Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM15 10h.008v.008H15V10Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM15.182 15.182a4.5 4.5 0 0 1-6.364 0' },
  { id: 'corner', label: '边角', icon: 'M4.5 9.75V6.75A2.25 2.25 0 0 1 6.75 4.5h3m3.75 0h3A2.25 2.25 0 0 1 18.75 6.75v3m0 3.75v3A2.25 2.25 0 0 1 16.5 18.75h-3m-3.75 0h-3A2.25 2.25 0 0 1 4.5 16.5v-3' }
]

function isShellToolActive(tool: ShellTool): boolean {
  if (tool.kind === 'eraser') return activeTool.value === 'erase'
  if (tool.kind === 'inpaint') return activeTool.value === 'inpaint'
  return activeTool.value === tool.id
}

function selectShellTool(tool: ShellTool) {
  if (tool.kind === 'eraser') {
    selectTool('erase')
    return
  }
  if (tool.kind === 'inpaint') {
    selectTool('inpaint')
    setMaskShape('brush')
    return
  }
  selectTool(tool.id)
}

const showRightPanel = computed(() => ['crop', 'corner', 'rotate', 'filter', 'text', 'draw', 'inpaint', 'sticker'].includes(activeTool.value))

watch(activeTool, () => {
  rightPanelTab.value = showRightPanel.value ? 'tool' : 'layers'
})

function scheduleCornerPreview() {
  if (cornerPreviewTimer) {
    clearTimeout(cornerPreviewTimer)
    cornerPreviewTimer = null
  }
  if (activeTool.value !== 'corner') return
  cornerPreviewTimer = setTimeout(() => {
    refreshCornerPreview()
  }, 32)
}

async function refreshCornerPreview() {
  if (!fabricCanvas || !baseImage || activeTool.value !== 'corner') {
    removeCornerCanvasPreview()
    return
  }
  const seq = ++cornerPreviewSeq
  try {
    removeCornerCanvasPreview()
    if (!hasCornerSettings()) {
      removeCornerCanvasPreview()
      return
    }
    if (seq !== cornerPreviewSeq || activeTool.value !== 'corner' || !fabricCanvas || !baseImage) return
    normalizeAllCornerSettings()
    const baseRegion = getBaseImageRegion()
    if (!baseRegion) return
    const outputW = baseRegion.width
    const outputH = baseRegion.height
    const padTop = outputH * cornerPadding.top / 100
    const padRight = outputW * cornerPadding.right / 100
    const padBottom = outputH * cornerPadding.bottom / 100
    const padLeft = outputW * cornerPadding.left / 100
    const imageW = Math.max(1, outputW - padLeft - padRight)
    const imageH = Math.max(1, outputH - padTop - padBottom)
    const canvasW = Math.max(fabricCanvas.width || 0, Math.ceil(outputW + 64))
    const canvasH = Math.max(fabricCanvas.height || 0, Math.ceil(outputH + 64))
    if (canvasW !== fabricCanvas.width || canvasH !== fabricCanvas.height) {
      cornerPreviewCanvasSize = {
        width: fabricCanvas.width || canvasW,
        height: fabricCanvas.height || canvasH,
      }
      fabricCanvas.setDimensions({ width: canvasW, height: canvasH })
      fabricCanvas.calcOffset()
    }
    const outputLeft = Math.round((canvasW - outputW) / 2)
    const outputTop = Math.round((canvasH - outputH) / 2)
    const imageLeft = outputLeft + padLeft
    const imageTop = outputTop + padTop
    const scaleX = imageW / baseRegion.width
    const scaleY = imageH / baseRegion.height
    const bg = new Rect({
      left: outputLeft,
      top: outputTop,
      originX: 'left',
      originY: 'top',
      width: outputW,
      height: outputH,
      fill: cornerBackgroundMode.value === 'color' ? cornerBackgroundColor.value : 'rgba(0,0,0,0)',
      stroke: 'rgba(59,130,246,0.35)',
      strokeWidth: 1,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
    })
    ;(bg as any).data = { role: 'corner-preview-bg' }
    cornerPreviewBackground = bg
    fabricCanvas.add(bg)
    fabricCanvas.sendObjectToBack(bg)
    cornerPreviewObjectStates.clear()
    fabricCanvas.getObjects().forEach(o => {
      if (o === bg) return
      const role = (o as any).data?.role
      if (role === 'corner-preview-bg') return
      cornerPreviewObjectStates.set(o as FabricObject, {
        left: o.left || 0,
        top: o.top || 0,
        scaleX: o.scaleX || 1,
        scaleY: o.scaleY || 1,
        visible: o.visible !== false,
        clipPath: (o as any).clipPath,
      })
      if (isTemporaryExportObject(o as FabricObject)) {
        o.visible = false
        return
      }
      o.set({
        left: imageLeft + ((o.left || 0) - baseRegion.left) * scaleX,
        top: imageTop + ((o.top || 0) - baseRegion.top) * scaleY,
        scaleX: (o.scaleX || 1) * scaleX,
        scaleY: (o.scaleY || 1) * scaleY,
      })
      ;(o as any).clipPath = createCornerClipPath(imageLeft, imageTop, imageW, imageH)
      o.setCoords()
    })
    fabricCanvas.requestRenderAll()
  } catch {
    if (seq === cornerPreviewSeq) removeCornerCanvasPreview()
  }
}

function removeCornerCanvasPreview() {
  if (!fabricCanvas) {
    cornerPreviewBackground = null
    cornerPreviewCanvasSize = null
    cornerPreviewObjectStates.clear()
    return
  }
  if (cornerPreviewBackground) {
    fabricCanvas.remove(cornerPreviewBackground)
    cornerPreviewBackground = null
  }
  fabricCanvas.getObjects().forEach(o => {
    if ((o as any).data?.role === 'corner-preview-bg') fabricCanvas!.remove(o)
  })
  cornerPreviewObjectStates.forEach((state, obj) => {
    obj.set({
      left: state.left,
      top: state.top,
      scaleX: state.scaleX,
      scaleY: state.scaleY,
      visible: state.visible,
    })
    ;(obj as any).clipPath = state.clipPath
    obj.setCoords()
  })
  cornerPreviewObjectStates.clear()
  if (cornerPreviewCanvasSize) {
    fabricCanvas.setDimensions(cornerPreviewCanvasSize)
    cornerPreviewCanvasSize = null
    fabricCanvas.calcOffset()
  }
  fabricCanvas.requestRenderAll()
}

async function withoutCornerCanvasPreview<T>(action: () => Promise<T>, restorePreview = true): Promise<T> {
  const wasCornerTool = activeTool.value === 'corner'
  if (cornerPreviewTimer) {
    clearTimeout(cornerPreviewTimer)
    cornerPreviewTimer = null
  }
  cornerPreviewSeq++
  removeCornerCanvasPreview()
  try {
    return await action()
  } finally {
    if (restorePreview && wasCornerTool && activeTool.value === 'corner') scheduleCornerPreview()
  }
}

function createCornerClipPath(left: number, top: number, width: number, height: number): Path {
  const max = Math.max(0, Math.min(width, height) / 2)
  const tl = Math.min(max, Math.max(0, cornerRadius.topLeft * displayScale))
  const tr = Math.min(max, Math.max(0, cornerRadius.topRight * displayScale))
  const br = Math.min(max, Math.max(0, cornerRadius.bottomRight * displayScale))
  const bl = Math.min(max, Math.max(0, cornerRadius.bottomLeft * displayScale))
  const path = new Path([
    `M ${tl} 0`,
    `L ${width - tr} 0`,
    `Q ${width} 0 ${width} ${tr}`,
    `L ${width} ${height - br}`,
    `Q ${width} ${height} ${width - br} ${height}`,
    `L ${bl} ${height}`,
    `Q 0 ${height} 0 ${height - bl}`,
    `L 0 ${tl}`,
    `Q 0 0 ${tl} 0`,
    'Z',
  ].join(' '), {
    left,
    top,
    originX: 'left',
    originY: 'top',
    selectable: false,
    evented: false,
  } as any)
  ;(path as any).absolutePositioned = true
  return path
}

watch(
  () => [
    activeTool.value,
    imageSizeVersion.value,
    cornerRadius.topLeft,
    cornerRadius.topRight,
    cornerRadius.bottomRight,
    cornerRadius.bottomLeft,
    cornerPadding.top,
    cornerPadding.right,
    cornerPadding.bottom,
    cornerPadding.left,
    cornerBackgroundMode.value,
    cornerBackgroundColor.value,
  ],
  () => scheduleCornerPreview(),
  { flush: 'post' }
)

// ---- Lifecycle ----
// Bug #6: 用 unsubscribe 模式，避免 offProgress() removeAllListeners 误清其他视图监听
let unsubscribeImageProgress: (() => void) | null = null

const originalEditorSrc = ref('')

function mockGeneration(id: string, resultPath: string) {
  return {
    id,
    session_id: '',
    prompt: '',
    revised_prompt: '',
    ref_images: [],
    model_provider_id: '',
    model_id: '',
    size: '1:1',
    quality: 'auto',
    result_path: resultPath,
    result_url: '',
    status: 'done',
    error: '',
    created_at: new Date().toISOString()
  } as any
}

onMounted(async () => {
  try {
    let imageSrc: string

    if (props.embedded) {
      imageSrc = (props.sourceDataUri || props.sourcePath || '').trim()
      if (!imageSrc) {
        showToast('未指定图片')
        emit('close')
        return
      }
      generation.value = mockGeneration('_canvas', props.sourcePath || '')
      originalEditorSrc.value = imageSrc
    } else {
      const id = route.params.id as string
      if (!id) { router.back(); return }

      if (id === '_local') {
        // 本地图库编辑模式：从 query.path 加载文件，不查 image_generations 表。
        // generation.value 用 mock 对象，id='_local' 作 sentinel；保存时走 saveLocalEdited
        // 创建独立的新 image_generation 记录（不入图库 gallery_items，避免重复显示）。
        const localPath = route.query.path as string
        if (!localPath) {
          showToast('未指定图片路径')
          router.back()
          return
        }
        generation.value = mockGeneration('_local', localPath)
        imageSrc = await api().imageGen.invoke('getAbsolutePath', localPath)
        originalEditorSrc.value = imageSrc
      } else {
        const gen = await api().imageGen.invoke('getGeneration', id)
        if (!gen || !gen.result_path) {
          showToast('图片数据不存在')
          router.back()
          return
        }
        generation.value = gen
        imageSrc = await api().imageGen.invoke('getAbsolutePath', gen.result_path)
        originalEditorSrc.value = imageSrc
      }
    }

    await nextTick()
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    await initCanvas(imageSrc)

    // URL query 预设：从图像处理菜单 / 第三方入口跳过来时携带工具/模板/提示词，
    // 进入页面自动激活，让用户少点几下。仅当 canvas 就绪后调用 selectTool 才安全。
    if (!props.embedded) applyEditPresetsFromQuery()
    if (activeTool.value === 'select') selectTool('inpaint')

    // O8: 读出记忆的图片编辑生图模型；不存在则回退到当前 generation 的模型
    try {
      const all = (await api().settings.invoke('getAll')) as Record<string, string>
      if (all['imageedit_provider_id']) editProviderId.value = all['imageedit_provider_id']
      if (all['imageedit_model_id']) editModelId.value = all['imageedit_model_id']
      if (!editProviderId.value && generation.value?.model_provider_id) {
        editProviderId.value = generation.value.model_provider_id
        editModelId.value = generation.value.model_id || ''
      }
    } catch {
      // 设置读取失败不影响主流程
    }

    // 预热模型用法 LRU，让模型选择弹窗第一次打开时推荐顺序就是热的
    warmHintsCache().catch(() => {})

    window.addEventListener('keydown', handleKeyDown)
    unsubscribeImageProgress = api().imageGen.onProgress(handleImageGenProgress)
  } catch (e: any) {
    showToast('加载失败: ' + (e.message || ''))
    console.error(e)
  }
})

/**
 * 解析路由 query 上的预设并应用：
 *   - tool='inpaint' | 'crop' | 'rotate' | 'filter' | 'text' | 'draw' | 'sticker'  → selectTool
 *   - template='replace' | 'remove' | 'fix' | 'enhance'                → 切 inpaint 模板
 *   - presetPrompt='...'                                                → 填入 inpaintPrompt
 *
 * 不在 query 里就保持默认（select 工具、空 prompt），不影响普通进入流程。
 */
function applyEditPresetsFromQuery() {
  const q = route.query
  const presetTool = typeof q.tool === 'string' ? q.tool : ''
  const presetTpl = typeof q.template === 'string' ? q.template : ''
  const presetPrompt = typeof q.presetPrompt === 'string' ? q.presetPrompt : ''

  if (presetTool && ['select', 'crop', 'corner', 'rotate', 'filter', 'text', 'draw', 'inpaint', 'sticker'].includes(presetTool)) {
    selectTool(presetTool)
  }
  if (presetTpl && ['replace', 'remove', 'fix', 'enhance'].includes(presetTpl)) {
    activeTemplate.value = presetTpl
    usePromptTemplate.value = true
  }
  if (presetPrompt) {
    inpaintPrompt.value = presetPrompt
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown)
  if (cornerPreviewTimer) {
    clearTimeout(cornerPreviewTimer)
    cornerPreviewTimer = null
  }
  cornerPreviewSeq++
  removeCornerCanvasPreview()
  if (unsubscribeImageProgress) {
    try { unsubscribeImageProgress() } catch {}
    unsubscribeImageProgress = null
  }
  if (fabricCanvas) {
    fabricCanvas.dispose()
    fabricCanvas = null
  }
  baseImage = null
})

function handleImageGenProgress(data: any) {
  if (!inpainting.value || !data) return
  if (data.type === 'start') {
    inpaintProgress.value = { completed: 0, total: data.total || 1, message: `准备生成 ${data.total || 1} 张...` }
  } else if (data.type === 'generating') {
    inpaintProgress.value.message = `生成中 ${(data.completed || 0) + 1}/${data.total || 1}`
  } else if (data.type === 'completed') {
    inpaintProgress.value.completed = data.completed || 0
    inpaintProgress.value.message = `已完成 ${data.completed || 0}/${data.total || 1}`
  } else if (data.type === 'done') {
    inpaintProgress.value.message = '处理结果中...'
  } else if (data.type === 'error') {
    inpaintProgress.value.message = `第 ${(data.index || 0) + 1} 张失败`
  }
}

function handleKeyDown(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return

  if (activeTool.value === 'erase') {
    if (e.key === '[') {
      e.preventDefault()
      drawBrushSize.value = Math.max(1, drawBrushSize.value - 5)
      updateBrush()
      return
    }
    if (e.key === ']') {
      e.preventDefault()
      drawBrushSize.value = Math.min(100, drawBrushSize.value + 5)
      updateBrush()
      return
    }
  }

  // Inpaint-only shortcuts
  if (activeTool.value === 'inpaint') {
    if (e.key === '[') {
      e.preventDefault()
      maskBrushSize.value = Math.max(5, maskBrushSize.value - 5)
      updateMaskBrush()
      return
    }
    if (e.key === ']') {
      e.preventDefault()
      maskBrushSize.value = Math.min(100, maskBrushSize.value + 5)
      updateMaskBrush()
      return
    }
    if (e.key.toLowerCase() === 'e' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      setMaskShape(maskShape.value === 'eraser' ? 'brush' : 'eraser')
      return
    }
    if (e.key.toLowerCase() === 'i' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      if (hasAnyMask()) invertMask()
      return
    }
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault()
    // In inpaint mode, Ctrl+Z prefers mask-level undo if possible
    if (activeTool.value === 'inpaint' && canUndoMask.value) {
      undoMaskStroke()
    } else {
      undo()
    }
  } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
    e.preventDefault()
    redo()
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    deleteActiveObject()
  } else if (e.key === 'Escape' && compareMode.value !== 'none') {
    e.preventDefault()
    cancelCompare()
  }
}

function resolveImageSrc(pathOrUri: string): string {
  const src = (pathOrUri || '').trim()
  if (!src) return ''
  if (
    src.startsWith('data:') ||
    src.startsWith('local-file://') ||
    src.startsWith('blob:') ||
    src.startsWith('http://') ||
    src.startsWith('https://')
  ) {
    return src
  }
  const isAbsolute = /^[A-Za-z]:|^\//.test(src)
  return 'local-file://img?' + (isAbsolute ? 'p' : 'rel') + '=' + encodeURIComponent(src)
}

// ---- Canvas Init ----
async function initCanvas(imagePath: string) {
  if (!canvasRef.value || !canvasContainerRef.value) return

  // Load image via HTMLImageElement (handles local-file:// protocol), then convert to dataURL
  const imgEl = new Image()
  await new Promise<void>((resolve, reject) => {
    imgEl.onload = () => resolve()
    imgEl.onerror = () => reject(new Error('Failed to load image'))
    imgEl.src = resolveImageSrc(imagePath)
  })

  originalW = imgEl.naturalWidth
  originalH = imgEl.naturalHeight
  imageSizeVersion.value++

  // Convert to dataURL for serializable FabricImage
  const dataUrl = imageToDataURL(imgEl)

  // Compute display dimensions
  const { canvasW, canvasH, scale } = computeFitSize(originalW, originalH)
  displayScale = scale

  // Create Fabric Canvas
  fabricCanvas = new Canvas(canvasRef.value, {
    width: canvasW,
    height: canvasH,
    backgroundColor: 'rgba(255,255,255,0)',
  })

  // Load base image
  await setBaseImage(dataUrl, canvasW, canvasH)

  // O7：滚轮缩放（以鼠标位置为锚点）；min 0.2x ~ max 5x，缩放同时刷新画笔圆圈光标尺寸
  fabricCanvas.on('mouse:wheel', (opt: any) => {
    if (!fabricCanvas) return
    const delta = opt.e.deltaY
    let zoom = fabricCanvas.getZoom()
    zoom *= 0.999 ** delta
    if (zoom > 5) zoom = 5
    if (zoom < 0.2) zoom = 0.2
    fabricCanvas.zoomToPoint(new Point(opt.e.offsetX, opt.e.offsetY), zoom)
    opt.e.preventDefault()
    opt.e.stopPropagation()
    refreshBrushCursor()
  })

  // 必须在 add 后的首次绘制前设好 destination-out，否则会先缓存成黑笔
  fabricCanvas.on('before:path:created', (e: any) => {
    const path = e.path as Path
    if (!path || activeTool.value !== 'erase') return
    ;(path as any).data = { role: 'erase' }
    path.set({
      globalCompositeOperation: 'destination-out',
      stroke: 'rgba(0,0,0,1)',
      selectable: false,
      evented: false,
      objectCaching: false
    })
  })

  // Hook path:created to tag brush strokes by role and ensure visibility
  fabricCanvas.on('path:created', (e: any) => {
    const path = e.path as Path
    if (!path) return
    let role: string
    if (activeTool.value === 'inpaint') {
      role = maskShape.value === 'eraser' ? 'mask-erase' : 'mask'
      ;(path as any).data = { role }
      // mask/mask-erase paths are non-interactive; they should not show selection controls
      ;(path as any).selectable = false
      ;(path as any).evented = false
      fabricCanvas!.bringObjectToFront(path)
      fabricCanvas!.requestRenderAll()
      pushMaskHistory()
    } else if (activeTool.value === 'erase') {
      applyErasePathFlags(path)
      fabricCanvas!.bringObjectToFront(path)
      fabricCanvas!.requestRenderAll()
      saveHistory()
    } else {
      ;(path as any).data = { role: 'draw' }
      ensureObjectLayerId(path, 'draw')
      attachDeleteControl(path)
      fabricCanvas!.bringObjectToFront(path)
      fabricCanvas!.requestRenderAll()
      saveHistory()
      refreshLayers()
    }
  })

  // Selection events: 把选中贴图的属性回显到右侧面板控件（混合模式 / 不透明度）
  fabricCanvas.on('selection:created', () => { syncStickerStateFromSelection(); syncSelectionFromCanvas(fabricCanvas) })
  fabricCanvas.on('selection:updated', () => { syncStickerStateFromSelection(); syncSelectionFromCanvas(fabricCanvas) })
  fabricCanvas.on('selection:cleared', () => { resetStickerState(); syncSelectionFromCanvas(fabricCanvas) })
  fabricCanvas.on('object:modified', () => { syncStickerStateFromSelection(); refreshLayers() })
  fabricCanvas.on('object:removed', () => refreshLayers())

  // Initial history snapshot
  saveHistory()
  refreshLayers()

  loading.value = false

  // Recalculate mouse offset after canvas becomes visible
  await nextTick()
  await new Promise<void>(r => requestAnimationFrame(() => r()))
  fabricCanvas.calcOffset()
}

function imageToDataURL(img: HTMLImageElement): string {
  const tmp = document.createElement('canvas')
  tmp.width = img.naturalWidth
  tmp.height = img.naturalHeight
  tmp.getContext('2d')!.drawImage(img, 0, 0)
  return tmp.toDataURL('image/png')
}

function computeFitSize(origW: number, origH: number): { canvasW: number; canvasH: number; scale: number } {
  const container = canvasContainerRef.value!
  const rect = container.getBoundingClientRect()
  const canvasW = Math.max(Math.round(rect.width - 24), 240)
  const canvasH = Math.max(Math.round(rect.height - 24), 240)
  const imageMaxW = Math.max(canvasW - 64, canvasW * 0.9)
  const imageMaxH = Math.max(canvasH - 64, canvasH * 0.9)
  const scale = Math.min(imageMaxW / origW, imageMaxH / origH, 1)
  return {
    canvasW,
    canvasH,
    scale,
  }
}

async function setBaseImage(dataUrl: string, canvasW: number, canvasH: number) {
  if (!fabricCanvas) return

  // Remove existing base image
  if (baseImage) {
    fabricCanvas.remove(baseImage)
    baseImage = null
  }

  const img = await FabricImage.fromURL(dataUrl)
  const imageW = img.width! * displayScale
  const imageH = img.height! * displayScale
  img.set({
    left: Math.round((canvasW - imageW) / 2),
    top: Math.round((canvasH - imageH) / 2),
    originX: 'left',
    originY: 'top',
    scaleX: displayScale,
    scaleY: displayScale,
    selectable: false,
    evented: false,
    hasControls: false,
    hasBorders: false,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
  })
  ;(img as any).data = { role: 'base' }
  ensureObjectLayerId(img, 'raster')

  baseImage = img
  fabricCanvas.add(img)
  fabricCanvas.sendObjectToBack(img)
  fabricCanvas.renderAll()
  refreshLayers()
}

function getBaseImageRegion(): CanvasRegion | null {
  if (!baseImage) return null
  return {
    left: baseImage.left || 0,
    top: baseImage.top || 0,
    width: (baseImage.width || 0) * (baseImage.scaleX || 1),
    height: (baseImage.height || 0) * (baseImage.scaleY || 1),
  }
}

function getObjectRegion(obj: FabricObject): CanvasRegion {
  return {
    left: obj.left || 0,
    top: obj.top || 0,
    width: (obj.width || 0) * (obj.scaleX || 1),
    height: (obj.height || 0) * (obj.scaleY || 1),
  }
}

function exportPixelSize(region: CanvasRegion): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(region.width / displayScale)),
    height: Math.max(1, Math.round(region.height / displayScale)),
  }
}

function isTemporaryExportObject(o: FabricObject): boolean {
  const role = (o as any).data?.role
  return role === 'mask' || role === 'mask-erase' || role === 'mask-shape' || role === 'mask-shape-erase' || role === 'crop-rect' || role === 'corner-preview' || role === 'corner-preview-bg'
}

async function withHiddenObjects<T>(predicate: (o: FabricObject) => boolean, action: () => Promise<T>): Promise<T> {
  if (!fabricCanvas) return action()
  const hidden: FabricObject[] = []
  fabricCanvas.getObjects().forEach(o => {
    if (predicate(o as FabricObject) && o.visible !== false) {
      hidden.push(o as FabricObject)
      o.visible = false
    }
  })
  fabricCanvas.discardActiveObject()
  fabricCanvas.requestRenderAll()
  try {
    return await action()
  } finally {
    hidden.forEach(o => { o.visible = true })
    fabricCanvas.requestRenderAll()
  }
}

async function exportSceneRegion(region: CanvasRegion, outputWidth: number, outputHeight: number): Promise<string | null> {
  if (!fabricCanvas) return null
  const width = Math.max(1, region.width)
  const height = Math.max(1, region.height)
  const viewport = (fabricCanvas.viewportTransform ? [...fabricCanvas.viewportTransform] : [1, 0, 0, 1, 0, 0]) as TMat2D
  const active = fabricCanvas.getActiveObject() as FabricObject | null
  const multiplier = Math.max(outputWidth / width, outputHeight / height)
  fabricCanvas.discardActiveObject()
  try {
    fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0])
    fabricCanvas.requestRenderAll()
    return fabricCanvas.toDataURL({
      format: 'png',
      left: region.left,
      top: region.top,
      width,
      height,
      multiplier,
    } as any)
  } finally {
    fabricCanvas.setViewportTransform(viewport)
    if (active && !isTemporaryExportObject(active)) fabricCanvas.setActiveObject(active)
    fabricCanvas.requestRenderAll()
    refreshBrushCursor()
  }
}

// ---- History ----
function saveHistory() {
  if (!fabricCanvas) return
  const shouldRestoreCornerPreview = activeTool.value === 'corner' && (!!cornerPreviewBackground || cornerPreviewObjectStates.size > 0)
  if (shouldRestoreCornerPreview) removeCornerCanvasPreview()
  const snapshot = serializeCanvas()
  const trimmed = history.value.slice(0, historyIndex.value + 1)
  trimmed.push(snapshot)
  if (trimmed.length > MAX_HISTORY) trimmed.shift()
  history.value = trimmed
  historyIndex.value = trimmed.length - 1
  if (shouldRestoreCornerPreview) scheduleCornerPreview()
}

function serializeCanvas(): string {
  if (!fabricCanvas) return ''
  return JSON.stringify({
    canvas: (fabricCanvas as any).toJSON(['data']),
    meta: {
      displayScale,
      originalW,
      originalH,
      width: fabricCanvas.width,
      height: fabricCanvas.height,
      layers: docLayers.value,
      filters: {
        brightness: filterControls[0].value,
        contrast: filterControls[1].value,
        saturation: filterControls[2].value,
        blur: filterControls[3].value,
      },
    },
  })
}

async function restoreSnapshot(snapshot: string) {
  if (!fabricCanvas) return
  if (cornerPreviewTimer) {
    clearTimeout(cornerPreviewTimer)
    cornerPreviewTimer = null
  }
  cornerPreviewSeq++
  removeCornerCanvasPreview()
  const parsed = JSON.parse(snapshot)
  const meta = parsed.meta

  displayScale = meta.displayScale
  originalW = meta.originalW
  originalH = meta.originalH
  imageSizeVersion.value++

  filterControls[0].value = meta.filters.brightness
  filterControls[1].value = meta.filters.contrast
  filterControls[2].value = meta.filters.saturation
  filterControls[3].value = meta.filters.blur

  fabricCanvas.setDimensions({ width: meta.width, height: meta.height })
  await fabricCanvas.loadFromJSON(parsed.canvas)
  reapplyErasePathFlags()

  // Find base image after reload
  baseImage = fabricCanvas.getObjects().find((o: any) => o.data?.role === 'base') as FabricImage | null
  if (baseImage) fabricCanvas.sendObjectToBack(baseImage)
  refreshLayers()
  if (Array.isArray(meta.layers)) {
    const byId = new Map((meta.layers as any[]).map((l: any) => [l.id, l]))
    docLayers.value = docLayers.value.map(l => {
      const saved = byId.get(l.id)
      return saved ? { ...l, name: saved.name || l.name, locked: !!saved.locked, opacity: saved.opacity ?? l.opacity } : l
    })
    applyObjectFlags(fabricCanvas, isDrawingTool())
  }

  fabricCanvas.renderAll()
  if (activeTool.value === 'corner') scheduleCornerPreview()
}

async function undo() {
  if (!canUndo.value) return
  historyIndex.value--
  await restoreSnapshot(history.value[historyIndex.value])
}

async function redo() {
  if (!canRedo.value) return
  historyIndex.value++
  await restoreSnapshot(history.value[historyIndex.value])
}

// ---- Tool Selection ----
function selectTool(toolId: string) {
  if (!fabricCanvas) return
  maskPreviewOn.value = false

  // Always exit drawing mode and reset cursor
  fabricCanvas.isDrawingMode = false
  fabricCanvas.defaultCursor = 'default'
  fabricCanvas.freeDrawingCursor = 'crosshair'
  removeCropRect()
  if (toolId !== 'corner') {
    if (cornerPreviewTimer) {
      clearTimeout(cornerPreviewTimer)
      cornerPreviewTimer = null
    }
    cornerPreviewSeq++
    removeCornerCanvasPreview()
  }

  activeTool.value = toolId

  const isDrawing = toolId === 'draw' || toolId === 'inpaint' || toolId === 'erase'
  fabricCanvas.selection = !isDrawing
  applyObjectFlags(fabricCanvas, isDrawing)

  if (toolId === 'draw') {
    fabricCanvas.isDrawingMode = true
    const brush = new PencilBrush(fabricCanvas)
    brush.width = drawBrushSize.value
    brush.color = drawColor.value
    fabricCanvas.freeDrawingBrush = brush
    removeShapeListeners()
    refreshBrushCursor()
  } else if (toolId === 'erase') {
    fabricCanvas.isDrawingMode = true
    const brush = new PencilBrush(fabricCanvas)
    brush.width = drawBrushSize.value
    // 上层预览用半透明灰；真正挖洞在 path 上用实心黑 + destination-out
    brush.color = 'rgba(0,0,0,0.35)'
    fabricCanvas.freeDrawingBrush = brush
    removeShapeListeners()
    refreshBrushCursor()
  } else if (toolId === 'inpaint') {
    applyMaskShapeMode()
  } else if (toolId === 'crop') {
    initCrop()
    removeShapeListeners()
  } else {
    removeShapeListeners()
  }

  if (toolId === 'corner') scheduleCornerPreview()
  fabricCanvas.requestRenderAll()
}

function setMaskShape(shape: MaskShape) {
  maskShape.value = shape
  if (activeTool.value !== 'inpaint') return
  applyMaskShapeMode()
}

function applyMaskShapeMode() {
  if (!fabricCanvas) return
  removeShapeListeners()
  if (maskShape.value === 'brush' || maskShape.value === 'eraser') {
    fabricCanvas.isDrawingMode = true
    const brush = new PencilBrush(fabricCanvas)
    brush.width = maskBrushSize.value
    brush.color = maskShape.value === 'eraser' ? 'rgba(80, 80, 80, 0.55)' : 'rgba(255, 0, 0, 0.4)'
    fabricCanvas.freeDrawingBrush = brush
    refreshBrushCursor()
  } else {
    fabricCanvas.isDrawingMode = false
    fabricCanvas.defaultCursor = 'crosshair'
    addShapeListeners()
  }
}

/**
 * O6: 构造圆圈画笔光标的 SVG data URI。
 * 圆形 + 中心十字辅助点（双色描边，浅色背景与深色背景都能看清）。
 */
function buildBrushCursor(diameter: number, ringColor: string): string {
  const d = Math.max(6, Math.min(256, diameter))
  const r = d / 2
  const pad = 2
  const size = d + pad * 2
  const cx = r + pad
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="white" stroke-width="2.5"/>` +
    `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${ringColor}" stroke-width="1.2"/>` +
    `<circle cx="${cx}" cy="${cx}" r="1.5" fill="${ringColor}"/>` +
    `</svg>`
  const url = `data:image/svg+xml;base64,${btoa(svg)}`
  return `url("${url}") ${cx} ${cx}, crosshair`
}

/**
 * O6 + O7: 根据当前激活工具计算画笔光标 px 大小（含 zoom 比例），并更新 fabric.
 * 当工具/笔刷尺寸/zoom 变化时都应调用此函数。
 */
function refreshBrushCursor() {
  if (!fabricCanvas) return
  const zoom = fabricCanvas.getZoom() || 1
  if (activeTool.value === 'draw') {
    const px = drawBrushSize.value * zoom
    const cursor = buildBrushCursor(px, drawColor.value)
    fabricCanvas.freeDrawingCursor = cursor
    fabricCanvas.defaultCursor = cursor
  } else if (activeTool.value === 'erase') {
    const px = drawBrushSize.value * zoom
    const cursor = buildBrushCursor(px, '#6b7280')
    fabricCanvas.freeDrawingCursor = cursor
    fabricCanvas.defaultCursor = cursor
  } else if (activeTool.value === 'inpaint' && (maskShape.value === 'brush' || maskShape.value === 'eraser')) {
    const px = maskBrushSize.value * zoom
    const ring = maskShape.value === 'eraser' ? '#888888' : 'var(--color-primary-500, #23574f)'
    const cursor = buildBrushCursor(px, ring)
    fabricCanvas.freeDrawingCursor = cursor
    fabricCanvas.defaultCursor = cursor
  }
}

// ---- Shape drag drawing (rect / ellipse mask) ----
let shapeStart: { x: number; y: number } | null = null
let shapePreview: FabricObject | null = null

function onShapeMouseDown(opt: any) {
  if (!fabricCanvas) return
  const pointer = fabricCanvas.getScenePoint(opt.e)
  shapeStart = { x: pointer.x, y: pointer.y }
  if (maskShape.value === 'rect') {
    shapePreview = new Rect({
      left: pointer.x,
      top: pointer.y,
      originX: 'left',
      originY: 'top',
      width: 1,
      height: 1,
      fill: 'rgba(255, 0, 0, 0.4)',
      stroke: '#ef4444',
      strokeWidth: 1,
      selectable: false,
      evented: false
    })
  } else if (maskShape.value === 'ellipse') {
    shapePreview = new Ellipse({
      left: pointer.x,
      top: pointer.y,
      originX: 'left',
      originY: 'top',
      rx: 1,
      ry: 1,
      fill: 'rgba(255, 0, 0, 0.4)',
      stroke: '#ef4444',
      strokeWidth: 1,
      selectable: false,
      evented: false
    })
  } else {
    return
  }
  ;(shapePreview as any).data = { role: 'mask-shape-preview' }
  fabricCanvas.add(shapePreview)
}

function onShapeMouseMove(opt: any) {
  if (!fabricCanvas || !shapeStart || !shapePreview) return
  const pointer = fabricCanvas.getScenePoint(opt.e)
  const left = Math.min(shapeStart.x, pointer.x)
  const top = Math.min(shapeStart.y, pointer.y)
  const w = Math.abs(pointer.x - shapeStart.x)
  const h = Math.abs(pointer.y - shapeStart.y)
  if (maskShape.value === 'rect') {
    shapePreview.set({ left, top, width: w, height: h })
  } else if (maskShape.value === 'ellipse') {
    ;(shapePreview as any).set({ left, top, rx: w / 2, ry: h / 2, width: w, height: h })
  }
  shapePreview.setCoords()
  fabricCanvas.requestRenderAll()
}

function onShapeMouseUp() {
  if (!fabricCanvas || !shapePreview) {
    shapeStart = null
    shapePreview = null
    return
  }
  const w = (shapePreview as any).width || 0
  const h = (shapePreview as any).height || 0
  if (w < 4 || h < 4) {
    fabricCanvas.remove(shapePreview)
  } else {
    ;(shapePreview as any).set({ stroke: '', strokeWidth: 0 })
    ;(shapePreview as any).data = { role: 'mask-shape' }
    pushMaskHistory()
  }
  fabricCanvas.requestRenderAll()
  shapeStart = null
  shapePreview = null
}

function addShapeListeners() {
  if (!fabricCanvas) return
  fabricCanvas.on('mouse:down', onShapeMouseDown)
  fabricCanvas.on('mouse:move', onShapeMouseMove)
  fabricCanvas.on('mouse:up', onShapeMouseUp)
}

function removeShapeListeners() {
  if (!fabricCanvas) return
  fabricCanvas.off('mouse:down', onShapeMouseDown)
  fabricCanvas.off('mouse:move', onShapeMouseMove)
  fabricCanvas.off('mouse:up', onShapeMouseUp)
  if (shapePreview) {
    fabricCanvas.remove(shapePreview)
    shapePreview = null
  }
  shapeStart = null
}

function deleteActiveObject() {
  if (!fabricCanvas) return
  const active = fabricCanvas.getActiveObject()
  if (!active) return
  if ((active as any).data?.role === 'base') return
  fabricCanvas.remove(active)
  fabricCanvas.discardActiveObject()
  fabricCanvas.renderAll()
  saveHistory()
}

// ---- Crop ----
let cropRect: Rect | null = null

function initCrop() {
  if (!fabricCanvas) return
  const region = getBaseImageRegion() || { left: 0, top: 0, width: fabricCanvas.width!, height: fabricCanvas.height! }
  cropRect = new Rect({
    left: region.left + region.width * 0.1,
    top: region.top + region.height * 0.1,
    originX: 'left',
    originY: 'top',
    width: region.width * 0.8,
    height: region.height * 0.8,
    fill: 'rgba(0,0,0,0)',
    stroke: '#3b82f6',
    strokeWidth: 2,
    strokeDashArray: [5, 5],
    cornerColor: '#3b82f6',
    cornerSize: 8,
    transparentCorners: false,
    selectable: true,
    evented: true,
  })
  ;(cropRect as any).data = { role: 'crop-rect' }
  fabricCanvas.add(cropRect)
  fabricCanvas.setActiveObject(cropRect)
  fabricCanvas.renderAll()
}

function removeCropRect() {
  if (cropRect && fabricCanvas) {
    fabricCanvas.remove(cropRect)
    cropRect = null
  }
}

async function applyCrop() {
  if (!fabricCanvas || !cropRect || !baseImage) return

  const cropRegion = getObjectRegion(cropRect as unknown as FabricObject)
  const size = exportPixelSize(cropRegion)
  const newDataUrl = await withHiddenObjects(isTemporaryExportObject, () => exportSceneRegion(cropRegion, size.width, size.height))
  if (!newDataUrl) return

  resetFilterValues()
  await replaceBaseImage(newDataUrl, size.width, size.height)

  removeCropRect()
  activeTool.value = 'select'
  showToast('裁剪已应用')
  saveHistory()
}

function clampNumber(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : Number(value)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.round(n)))
}

function normalizeCornerRadius(key: CornerKey) {
  cornerRadius[key] = clampNumber(cornerRadius[key], 0, cornerMaxRadius.value)
}

function normalizeCornerPadding(key: EdgeKey) {
  cornerPadding[key] = clampNumber(cornerPadding[key], 0, cornerMaxPadding.value)
  if (key === 'left' || key === 'right') {
    const maxTotal = 99
    const other = key === 'left' ? 'right' : 'left'
    if (cornerPadding.left + cornerPadding.right > maxTotal) {
      cornerPadding[key] = Math.max(0, maxTotal - cornerPadding[other])
    }
  } else {
    const maxTotal = 99
    const other = key === 'top' ? 'bottom' : 'top'
    if (cornerPadding.top + cornerPadding.bottom > maxTotal) {
      cornerPadding[key] = Math.max(0, maxTotal - cornerPadding[other])
    }
  }
}

function normalizeAllCornerSettings() {
  cornerOptions.forEach(c => normalizeCornerRadius(c.id))
  edgeOptions.forEach(e => normalizeCornerPadding(e.id))
  cornerLinkedRadius.value = clampNumber(cornerLinkedRadius.value, 0, cornerMaxRadius.value)
  cornerLinkedPadding.value = clampNumber(cornerLinkedPadding.value, 0, cornerMaxPadding.value)
}

function applyLinkedCornerRadius() {
  cornerLinkedRadius.value = clampNumber(cornerLinkedRadius.value, 0, cornerMaxRadius.value)
  cornerOptions.forEach(c => {
    if (cornerRadiusLinked[c.id]) cornerRadius[c.id] = cornerLinkedRadius.value
  })
}

function applyLinkedCornerPadding() {
  cornerLinkedPadding.value = clampNumber(cornerLinkedPadding.value, 0, cornerMaxPadding.value)
  edgeOptions.forEach(e => {
    if (cornerPaddingLinked[e.id]) cornerPadding[e.id] = cornerLinkedPadding.value
  })
  normalizeAllCornerSettings()
}

function resetCornerSettings() {
  removeCornerCanvasPreview()
  cornerOptions.forEach(c => {
    cornerRadius[c.id] = 0
    cornerRadiusLinked[c.id] = true
  })
  edgeOptions.forEach(e => {
    cornerPadding[e.id] = 0
    cornerPaddingLinked[e.id] = true
  })
  cornerLinkedRadius.value = 0
  cornerLinkedPadding.value = 0
  cornerBackgroundMode.value = 'transparent'
  cornerBackgroundColor.value = '#ffffff'
}

function hasCornerSettings(): boolean {
  return cornerOptions.some(c => cornerRadius[c.id] > 0)
    || edgeOptions.some(e => cornerPadding[e.id] > 0)
    || cornerBackgroundMode.value === 'color'
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: Record<CornerKey, number>) {
  const max = Math.max(0, Math.min(w, h) / 2)
  const tl = Math.min(max, Math.max(0, radius.topLeft))
  const tr = Math.min(max, Math.max(0, radius.topRight))
  const br = Math.min(max, Math.max(0, radius.bottomRight))
  const bl = Math.min(max, Math.max(0, radius.bottomLeft))
  ctx.beginPath()
  ctx.moveTo(x + tl, y)
  ctx.lineTo(x + w - tr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr)
  ctx.lineTo(x + w, y + h - br)
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h)
  ctx.lineTo(x + bl, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl)
  ctx.lineTo(x, y + tl)
  ctx.quadraticCurveTo(x, y, x + tl, y)
  ctx.closePath()
}

async function renderCornerDataUrl(sourceDataUrl: string): Promise<{ dataUrl: string; width: number; height: number }> {
  normalizeAllCornerSettings()
  const img = await loadImageEl(sourceDataUrl)
  const width = img.naturalWidth
  const height = img.naturalHeight
  const left = width * cornerPadding.left / 100
  const top = height * cornerPadding.top / 100
  const right = width * cornerPadding.right / 100
  const bottom = height * cornerPadding.bottom / 100
  const imageW = Math.max(1, width - left - right)
  const imageH = Math.max(1, height - top - bottom)
  const tmp = document.createElement('canvas')
  tmp.width = Math.max(1, width)
  tmp.height = Math.max(1, height)
  const ctx = tmp.getContext('2d')!
  if (cornerBackgroundMode.value === 'color') {
    ctx.fillStyle = cornerBackgroundColor.value || '#ffffff'
    ctx.fillRect(0, 0, tmp.width, tmp.height)
  }
  ctx.save()
  roundedRectPath(ctx, left, top, imageW, imageH, cornerRadius)
  ctx.clip()
  ctx.drawImage(img, left, top, imageW, imageH)
  ctx.restore()
  return { dataUrl: tmp.toDataURL('image/png'), width: tmp.width, height: tmp.height }
}

async function applyCornerSettings() {
  if (!fabricCanvas || !baseImage) return
  const sourceDataUrl = await withoutCornerCanvasPreview(() => getCanvasDataUrl(), false)
  if (!sourceDataUrl) return
  const result = await renderCornerDataUrl(sourceDataUrl)
  resetFilterValues()
  await replaceBaseImage(result.dataUrl, result.width, result.height)
  resetCornerSettings()
  activeTool.value = 'select'
  showToast('边角已应用')
  saveHistory()
}

// Bake the current canvas (excluding masks and cropRect) into a single HTMLImageElement at original resolution
async function flattenToImage(): Promise<HTMLImageElement | null> {
  if (!fabricCanvas) return null
  const hidden: FabricObject[] = []
  fabricCanvas.getObjects().forEach((o) => {
    const role = (o as any).data?.role
    if (role === 'mask' || role === 'crop-rect') {
      if (o.visible !== false) {
        hidden.push(o)
        o.visible = false
      }
    }
  })
  fabricCanvas.discardActiveObject()
  fabricCanvas.requestRenderAll()
  try {
    const dataUrl = await getCanvasDataUrl()
    if (!dataUrl) return null
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('flatten failed'))
      img.src = dataUrl
    })
  } finally {
    hidden.forEach((o) => { o.visible = true })
    fabricCanvas.requestRenderAll()
  }
}

function cancelCrop() {
  removeCropRect()
  activeTool.value = 'select'
}

// Replace base image and refit canvas to new dimensions
async function replaceBaseImage(dataUrl: string, newOrigW: number, newOrigH: number) {
  if (!fabricCanvas) return
  originalW = newOrigW
  originalH = newOrigH
  imageSizeVersion.value++

  const { canvasW, canvasH, scale } = computeFitSize(newOrigW, newOrigH)
  displayScale = scale

  // Remove non-base objects if dimensions change significantly (they may be out of bounds)
  const nonBase = fabricCanvas.getObjects().filter(o => (o as any).data?.role !== 'base')
  nonBase.forEach(o => fabricCanvas!.remove(o))

  fabricCanvas.setDimensions({ width: canvasW, height: canvasH })
  fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0])

  await setBaseImage(dataUrl, canvasW, canvasH)
  // Re-apply filters to the new base image
  reapplyFilters(false)

  await nextTick()
  fabricCanvas.calcOffset()
}

// ---- Rotate / Flip ----
async function rotateImage(degrees: number) {
  if (!baseImage) return
  const flat = await flattenToImage()
  if (!flat) return
  const w = flat.naturalWidth
  const h = flat.naturalHeight

  const tmp = document.createElement('canvas')
  const ctx = tmp.getContext('2d')!

  if (Math.abs(degrees) === 90) {
    tmp.width = h
    tmp.height = w
    ctx.translate(tmp.width / 2, tmp.height / 2)
    ctx.rotate((degrees * Math.PI) / 180)
    ctx.drawImage(flat, -w / 2, -h / 2)
  } else {
    tmp.width = w
    tmp.height = h
    ctx.translate(w / 2, h / 2)
    ctx.rotate((degrees * Math.PI) / 180)
    ctx.drawImage(flat, -w / 2, -h / 2)
  }

  const newDataUrl = tmp.toDataURL('image/png')
  resetFilterValues()
  await replaceBaseImage(newDataUrl, tmp.width, tmp.height)
  saveHistory()
}

async function flipImage(direction: 'h' | 'v') {
  if (!baseImage) return
  const flat = await flattenToImage()
  if (!flat) return
  const w = flat.naturalWidth
  const h = flat.naturalHeight

  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  const ctx = tmp.getContext('2d')!

  if (direction === 'h') {
    ctx.translate(w, 0)
    ctx.scale(-1, 1)
  } else {
    ctx.translate(0, h)
    ctx.scale(1, -1)
  }
  ctx.drawImage(flat, 0, 0)

  const newDataUrl = tmp.toDataURL('image/png')
  resetFilterValues()
  await replaceBaseImage(newDataUrl, tmp.width, tmp.height)
  saveHistory()
}

// ---- Filters (non-destructive, Fabric built-in) ----
function buildFilterPipeline() {
  const list: any[] = []
  const brightness = filterControls[0].value / 100
  const contrast = filterControls[1].value / 100
  const saturation = filterControls[2].value / 100
  const blur = filterControls[3].value / 100

  if (brightness !== 0) list.push(new filters.Brightness({ brightness }))
  if (contrast !== 0) list.push(new filters.Contrast({ contrast }))
  if (saturation !== 0) list.push(new filters.Saturation({ saturation }))
  if (blur > 0) list.push(new filters.Blur({ blur: blur * 0.5 }))
  return list
}

function applyFilters() {
  reapplyFilters(true)
}

function reapplyFilters(record: boolean) {
  if (!baseImage || !fabricCanvas) return
  baseImage.filters = buildFilterPipeline()
  baseImage.applyFilters()
  fabricCanvas.renderAll()
  if (record) saveHistoryDebounced()
}

// Debounce saveHistory for rapid slider events
let historyTimer: number | null = null
function saveHistoryDebounced() {
  if (historyTimer !== null) window.clearTimeout(historyTimer)
  historyTimer = window.setTimeout(() => {
    saveHistory()
    historyTimer = null
  }, 400)
}

function applyPresetFilter(preset: 'grayscale' | 'sepia' | 'invert') {
  if (!baseImage || !fabricCanvas) return
  const existing = baseImage.filters || []
  const filterMap = { grayscale: filters.Grayscale, sepia: filters.Sepia, invert: filters.Invert }
  existing.push(new (filterMap[preset])())
  baseImage.filters = existing
  baseImage.applyFilters()
  fabricCanvas.renderAll()
  saveHistory()
}

function resetFilters() {
  resetFilterValues()
  if (!baseImage || !fabricCanvas) return
  baseImage.filters = []
  baseImage.applyFilters()
  fabricCanvas.renderAll()
  saveHistory()
}

function resetFilterValues() {
  filterControls[0].value = 0
  filterControls[1].value = 0
  filterControls[2].value = 0
  filterControls[3].value = 0
}

// ---- Text ----
function addText() {
  if (!fabricCanvas) return
  const text = new IText(textContent.value, {
    left: (fabricCanvas.width || 200) / 2 - 50,
    top: (fabricCanvas.height || 200) / 2 - 20,
    originX: 'left',
    originY: 'top',
    fontSize: textFontSize.value,
    fill: textColor.value,
    fontFamily: 'sans-serif',
    selectable: true,
    editable: true,
  } as any)
  ;(text as any).data = { role: 'text' }
  ensureObjectLayerId(text as any, 'text')

  // On scaling, convert scale to fontSize so text does not distort
  text.on('scaling', function (this: IText) {
    const newFontSize = Math.max(8, Math.round((this.fontSize || 16) * (this.scaleX || 1)))
    this.set({ fontSize: newFontSize, scaleX: 1, scaleY: 1 })
  })

  attachDeleteControl(text as unknown as FabricObject)
  fabricCanvas.add(text)
  fabricCanvas.bringObjectToFront(text)
  fabricCanvas.setActiveObject(text)
  fabricCanvas.renderAll()
  saveHistory()
  refreshLayers()
}
/**
 * 把当前选中对象（仅当 role === 'sticker'）的混合模式 / 不透明度回显到响应式 state，
 * 这样右侧 StickerLibraryPanel 控件就能正确展示已选贴图的真实属性。
 * 选中的不是贴图时（text/draw 或 nothing），state 重置为「无选中」。
 */
function syncStickerStateFromSelection() {
  if (!fabricCanvas) {
    resetStickerState()
    return
  }
  const obj = fabricCanvas.getActiveObject() as FabricObject | null
  const isSticker = !!obj && (obj as any).data?.role === 'sticker'
  stickerSelected.value = isSticker
  if (isSticker && obj) {
    stickerBlendMode.value = (obj as any).globalCompositeOperation || 'source-over'
    stickerOpacity.value = Math.round(((obj as any).opacity ?? 1) * 100)
  }
}

function resetStickerState() {
  stickerSelected.value = false
  stickerBlendMode.value = 'source-over'
  stickerOpacity.value = 100
}

/**
 * 把一张贴纸（data URL，PNG / JPG / SVG 任意）添加到画布。
 * - 默认尺寸：贴纸占画布短边的 30%，方便用户立刻看到、再手动微调
 * - 自动居中、置顶、选中，沿用 text 工具相同的体验
 * - data.role = 'sticker'，使其参与 inpaint 的 keepEditLayers 联动
 */
async function addSticker(dataUri: string) {
  if (!fabricCanvas) return
  let img: FabricImage
  try {
    img = await FabricImage.fromURL(dataUri)
  } catch (e: any) {
    showToast('贴图加载失败: ' + (e?.message || ''))
    return
  }
  const canvasShort = Math.min(fabricCanvas.width || 200, fabricCanvas.height || 200)
  const imgShort = Math.min(img.width || 100, img.height || 100) || 100
  const targetScale = (canvasShort * 0.3) / imgShort
  // 0..4 循环，每张沿对角线 +24px 错开
  const offset = (stickerJitterCounter++ % 5) * 24
  img.set({
    left: (fabricCanvas.width || 200) / 2 + offset,
    top: (fabricCanvas.height || 200) / 2 + offset,
    originX: 'center',
    originY: 'center',
    scaleX: targetScale,
    scaleY: targetScale,
    selectable: true,
    evented: true,
  } as any)
  ;(img as any).data = { role: 'sticker' }
  ensureObjectLayerId(img as any, 'sticker')
  attachDeleteControl(img as unknown as FabricObject)
  fabricCanvas.add(img)
  fabricCanvas.bringObjectToFront(img)
  fabricCanvas.setActiveObject(img)
  fabricCanvas.renderAll()
  syncStickerStateFromSelection()
  saveHistory()
  refreshLayers()
}

/**
 * 更新选中贴图的 globalCompositeOperation。
 * 非默认 blend mode 时主动关闭 objectCaching，避免 fabric 旧 cache 与新合成模式打架
 * （v7 修过此问题，但显式关闭更稳）。
 */
function updateStickerBlendMode(mode: string) {
  if (!fabricCanvas) return
  const obj = fabricCanvas.getActiveObject() as FabricObject | null
  if (!obj || (obj as any).data?.role !== 'sticker') return
  ;(obj as any).globalCompositeOperation = mode
  obj.objectCaching = mode === 'source-over'
  obj.dirty = true
  stickerBlendMode.value = mode
  fabricCanvas.requestRenderAll()
  saveHistory()
}

function updateStickerOpacity(value: number) {
  if (!fabricCanvas) return
  const obj = fabricCanvas.getActiveObject() as FabricObject | null
  if (!obj || (obj as any).data?.role !== 'sticker') return
  obj.set('opacity', value / 100)
  stickerOpacity.value = value
  fabricCanvas.requestRenderAll()
  saveHistory()
}

function flipSticker(axis: 'x' | 'y') {
  if (!fabricCanvas) return
  const obj = fabricCanvas.getActiveObject() as FabricObject | null
  if (!obj || (obj as any).data?.role !== 'sticker') return
  if (axis === 'x') obj.set('flipX', !obj.flipX)
  else obj.set('flipY', !obj.flipY)
  fabricCanvas.requestRenderAll()
  saveHistory()
}

async function duplicateSticker() {
  if (!fabricCanvas) return
  const obj = fabricCanvas.getActiveObject() as FabricObject | null
  if (!obj || (obj as any).data?.role !== 'sticker') return
  const cloned = await (obj as any).clone(['data', 'globalCompositeOperation']) as FabricObject
  ;(cloned as any).data = { role: 'sticker' }
  ;(cloned as any).globalCompositeOperation = (obj as any).globalCompositeOperation || 'source-over'
  cloned.set({
    left: (obj.left || 0) + 16,
    top: (obj.top || 0) + 16
  })
  attachDeleteControl(cloned)
  fabricCanvas.add(cloned)
  fabricCanvas.bringObjectToFront(cloned)
  fabricCanvas.setActiveObject(cloned)
  fabricCanvas.requestRenderAll()
  saveHistory()
}

function bringStickerForward() {
  if (!fabricCanvas) return
  const obj = fabricCanvas.getActiveObject() as FabricObject | null
  if (!obj || (obj as any).data?.role !== 'sticker') return
  fabricCanvas.bringObjectForward(obj)
  fabricCanvas.requestRenderAll()
  saveHistory()
}

function sendStickerBackward() {
  if (!fabricCanvas) return
  const obj = fabricCanvas.getActiveObject() as FabricObject | null
  if (!obj || (obj as any).data?.role !== 'sticker') return
  fabricCanvas.sendObjectBackwards(obj)
  // 防御：贴图不能被推到 base image 之下
  if (baseImage) fabricCanvas.sendObjectToBack(baseImage)
  fabricCanvas.requestRenderAll()
  saveHistory()
}

function deleteSelectedSticker() {
  if (!fabricCanvas) return
  const obj = fabricCanvas.getActiveObject() as FabricObject | null
  if (!obj || (obj as any).data?.role !== 'sticker') return
  fabricCanvas.remove(obj)
  fabricCanvas.discardActiveObject()
  resetStickerState()
  fabricCanvas.requestRenderAll()
  saveHistory()
}

// ---- Delete control (X button on selected objects) ----
function attachDeleteControl(obj: FabricObject) {
  ;(obj as any).controls = {
    ...(obj as any).controls,
    deleteControl: new Control({
      x: 0.5,
      y: -0.5,
      offsetX: 16,
      offsetY: -16,
      cursorStyle: 'pointer',
      mouseUpHandler: onDeleteControlClick,
      render: renderDeleteIcon,
      sizeX: 22,
      sizeY: 22,
    }),
  }
}

function onDeleteControlClick(_e: TPointerEvent, transform: Transform): boolean {
  const target = transform.target
  const canvas = target.canvas
  if (!canvas) return false
  canvas.remove(target)
  canvas.discardActiveObject()
  canvas.requestRenderAll()
  saveHistory()
  return true
}

function renderDeleteIcon(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  _styleOverride: any,
  fabricObject: FabricObject,
) {
  const size = 22
  ctx.save()
  ctx.translate(left, top)
  ctx.rotate(util.degreesToRadians(fabricObject.angle || 0))
  // Red filled circle
  ctx.fillStyle = '#ef4444'
  ctx.beginPath()
  ctx.arc(0, 0, size / 2, 0, Math.PI * 2)
  ctx.fill()
  // White X
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(-5, -5)
  ctx.lineTo(5, 5)
  ctx.moveTo(5, -5)
  ctx.lineTo(-5, 5)
  ctx.stroke()
  ctx.restore()
}

function applyErasePathFlags(path: FabricObject) {
  ;(path as any).data = { ...(path as any).data, role: 'erase' }
  path.set({
    globalCompositeOperation: 'destination-out',
    stroke: 'rgba(0,0,0,1)',
    selectable: false,
    evented: false,
    objectCaching: false
  })
}

function reapplyErasePathFlags() {
  if (!fabricCanvas) return
  fabricCanvas.getObjects().forEach((o) => {
    if ((o as any).data?.role === 'erase') applyErasePathFlags(o as FabricObject)
  })
}

// ---- Draw ----
function updateBrush() {
  if (!fabricCanvas || !fabricCanvas.freeDrawingBrush) return
  fabricCanvas.freeDrawingBrush.width = drawBrushSize.value
  if (activeTool.value === 'erase') {
    fabricCanvas.freeDrawingBrush.color = 'rgba(0,0,0,0.35)'
  } else {
    fabricCanvas.freeDrawingBrush.color = drawColor.value
  }
  refreshBrushCursor()
}

// ---- Inpaint Mask ----
function updateMaskBrush() {
  if (!fabricCanvas || !fabricCanvas.freeDrawingBrush || activeTool.value !== 'inpaint') return
  fabricCanvas.freeDrawingBrush.width = maskBrushSize.value
  refreshBrushCursor()
}

function clearMask() {
  if (!fabricCanvas) return
  // Remove paths with role 'mask' or 'mask-erase' plus any mask shapes
  const masks = fabricCanvas.getObjects().filter(o => {
    const role = (o as any).data?.role
    return role === 'mask' || role === 'mask-erase' || role === 'mask-shape'
  })
  masks.forEach(p => fabricCanvas!.remove(p))
  fabricCanvas.renderAll()
  resetMaskHistory()
  maskPreviewOn.value = false
}

function resetMaskHistory() {
  // Keep an empty baseline so the first stroke after reset can still be undone
  maskStrokeStack.value = [[]]
  maskStrokeIndex.value = 0
  maskRevision.value++
}

function pushMaskHistory() {
  if (!fabricCanvas) return
  const snapshot = fabricCanvas.getObjects()
    .filter(o => {
      const role = (o as any).data?.role
      return role === 'mask' || role === 'mask-erase' || role === 'mask-shape'
    })
    .map(o => (o as any).toObject(['data']))
  const trimmed = maskStrokeStack.value.slice(0, maskStrokeIndex.value + 1)
  trimmed.push(snapshot)
  if (trimmed.length > 30) trimmed.shift()
  maskStrokeStack.value = trimmed
  maskStrokeIndex.value = trimmed.length - 1
  maskRevision.value++
}

async function undoMaskStroke() {
  if (!canUndoMask.value || !fabricCanvas) return
  maskStrokeIndex.value--
  // Remove all current mask objects
  const existing = fabricCanvas.getObjects().filter(o => {
    const role = (o as any).data?.role
    return role === 'mask' || role === 'mask-erase' || role === 'mask-shape'
  })
  existing.forEach(o => fabricCanvas!.remove(o))

  // Restore from snapshot
  const snapshot = maskStrokeStack.value[maskStrokeIndex.value] || []
  for (const obj of snapshot) {
    const enlivened = await util.enlivenObjects([obj]) as FabricObject[]
    for (const e of enlivened) {
      fabricCanvas.add(e)
    }
  }
  fabricCanvas.renderAll()
  maskRevision.value++
}

function invertMask() {
  if (!fabricCanvas) return
  const hasAny = fabricCanvas.getObjects().some(o => {
    const role = (o as any).data?.role
    return role === 'mask' || role === 'mask-erase' || role === 'mask-shape'
  })
  if (!hasAny) {
    showToast('请先涂抹区域再反转')
    return
  }
  // Add a full-canvas mask rect with role 'mask-shape' and toggle existing masks to mask-erase
  const w = fabricCanvas.width!
  const h = fabricCanvas.height!
  const fullRect = new Rect({
    left: 0,
    top: 0,
    originX: 'left',
    originY: 'top',
    width: w,
    height: h,
    fill: 'rgba(255, 0, 0, 0.4)',
    stroke: '',
    strokeWidth: 0,
    selectable: false,
    evented: false
  })
  ;(fullRect as any).data = { role: 'mask-shape', invertFull: true }

  // Switch existing role 'mask' to 'mask-erase' (and vice versa) for the paths
  fabricCanvas.getObjects().forEach(o => {
    const role = (o as any).data?.role
    if (role === 'mask') {
      ;(o as any).data = { ...(o as any).data, role: 'mask-erase' }
    } else if (role === 'mask-erase') {
      ;(o as any).data = { ...(o as any).data, role: 'mask' }
    } else if (role === 'mask-shape' && !(o as any).data?.invertFull) {
      ;(o as any).data = { ...(o as any).data, role: 'mask-shape-erase' }
    } else if (role === 'mask-shape-erase') {
      ;(o as any).data = { ...(o as any).data, role: 'mask-shape' }
    }
  })

  fabricCanvas.add(fullRect)
  fabricCanvas.renderAll()
  pushMaskHistory()
}

function generateMaskDataURL(): string | null {
  if (!fabricCanvas) return null
  const objects = fabricCanvas.getObjects()
  const maskObjects = objects.filter(o => {
    const role = (o as any).data?.role
    return role === 'mask' || role === 'mask-erase' || role === 'mask-shape' || role === 'mask-shape-erase'
  })
  if (maskObjects.length === 0) return null

  // Ordered draw: reproduce canvas add order, white (paint) vs black (erase) by role
  const tmp = document.createElement('canvas')
  tmp.width = originalW
  tmp.height = originalH
  const ctx = tmp.getContext('2d')!
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, originalW, originalH)

  const baseRegion = getBaseImageRegion()
  if (!baseRegion) return null
  const scaleRatio = 1 / displayScale
  ctx.save()
  ctx.scale(scaleRatio, scaleRatio)
  ctx.translate(-baseRegion.left, -baseRegion.top)

  maskObjects.forEach((obj: any) => {
    const role = obj.data?.role
    const isErase = role === 'mask-erase' || role === 'mask-shape-erase'
    const color = isErase ? '#000000' : '#ffffff'

    if (role === 'mask' || role === 'mask-erase') {
      // Path
      const pathData = obj.path
      if (!pathData) return
      const left = obj.left || 0
      const top = obj.top || 0
      ctx.save()
      ctx.translate(left, top)
      ctx.strokeStyle = color
      ctx.lineWidth = obj.strokeWidth || maskBrushSize.value
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      const p2d = new Path2D()
      for (const seg of pathData) {
        if (seg[0] === 'M') p2d.moveTo(seg[1], seg[2])
        else if (seg[0] === 'Q') p2d.quadraticCurveTo(seg[1], seg[2], seg[3], seg[4])
        else if (seg[0] === 'L') p2d.lineTo(seg[1], seg[2])
      }
      ctx.stroke(p2d)
      ctx.restore()
    } else if (role === 'mask-shape' || role === 'mask-shape-erase') {
      // Rect or Ellipse shape
      ctx.save()
      ctx.fillStyle = color
      const left = obj.left || 0
      const top = obj.top || 0
      const scaleX = obj.scaleX || 1
      const scaleY = obj.scaleY || 1
      const width = (obj.width || 0) * scaleX
      const height = (obj.height || 0) * scaleY
      // Fabric 7 uses PascalCase type strings ('Ellipse', 'Rect'); also fall back to rx/ry detection
      const isEllipse = obj.type === 'Ellipse' || obj.type === 'ellipse' || (typeof obj.rx === 'number' && typeof obj.ry === 'number')
      if (isEllipse) {
        const rx = ((obj.rx || 0) * scaleX)
        const ry = ((obj.ry || 0) * scaleY)
        const cx = left + rx
        const cy = top + ry
        ctx.beginPath()
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.fillRect(left, top, width, height)
      }
      ctx.restore()
    }
  })

  ctx.restore()

  // Apply feather (gaussian blur on mask edges)
  if (maskFeather.value > 0) {
    const feathered = document.createElement('canvas')
    feathered.width = tmp.width
    feathered.height = tmp.height
    const fctx = feathered.getContext('2d')!
    fctx.fillStyle = '#000000'
    fctx.fillRect(0, 0, feathered.width, feathered.height)
    // Scale feather with image dimensions for consistent visual effect
    const featherPx = Math.max(1, Math.round(maskFeather.value * scaleRatio))
    fctx.filter = `blur(${featherPx}px)`
    fctx.drawImage(tmp, 0, 0)
    return feathered.toDataURL('image/png')
  }

  return tmp.toDataURL('image/png')
}

function hasAnyMask(): boolean {
  if (!fabricCanvas) return false
  return fabricCanvas.getObjects().some(o => {
    const role = (o as any).data?.role
    return role === 'mask' || role === 'mask-erase' || role === 'mask-shape' || role === 'mask-shape-erase'
  })
}

function toggleMaskPreview() {
  if (maskPreviewOn.value) {
    maskPreviewOn.value = false
    return
  }
  if (!hasAnyMask()) {
    showToast('请先用蒙版涂抹需要重绘的区域')
    return
  }
  const url = generateMaskDataURL()
  if (!url) {
    showToast('无法生成蒙版预览')
    return
  }
  maskPreviewUrl.value = url
  maskPreviewOn.value = true
}

// ---- Size inference ----
const SIZE_RATIOS: Array<{ key: string; ratio: number }> = [
  { key: '1:1', ratio: 1 },
  { key: '2:1', ratio: 2 },
  { key: '3:1', ratio: 3 },
  { key: '3:2', ratio: 1.5 },
  { key: '4:3', ratio: 4 / 3 },
  { key: '5:4', ratio: 1.25 },
  { key: '16:9', ratio: 16 / 9 },
  { key: '21:9', ratio: 21 / 9 },
  { key: '1:2', ratio: 1 / 2 },
  { key: '1:3', ratio: 1 / 3 },
  { key: '2:3', ratio: 2 / 3 },
  { key: '3:4', ratio: 0.75 },
  { key: '4:5', ratio: 0.8 },
  { key: '9:16', ratio: 9 / 16 },
  { key: '9:21', ratio: 9 / 21 }
]

function inferSizeKey(w: number, h: number, fallback: string): string {
  const ratio = w / h
  let best = fallback
  let bestDiff = Infinity
  for (const s of SIZE_RATIOS) {
    const diff = Math.abs(s.ratio - ratio)
    if (diff < bestDiff) {
      bestDiff = diff
      best = s.key
    }
  }
  return best
}

// ---- Error classifier ----
function classifyError(rawMsg: string): string {
  const m = (rawMsg || '').toLowerCase()
  if (m.includes('401') || m.includes('unauthorized') || m.includes('api key')) {
    return '鉴权失败：请检查 API Key 或云端登录状态'
  }
  if (m.includes('402') || m.includes('insufficient') || m.includes('balance') || m.includes('payment')) {
    return `${siteConfig.labels.token}不足或付费失败`
  }
  if (m.includes('429') || m.includes('rate limit') || m.includes('too many')) {
    return '请求过于频繁，稍后重试'
  }
  if (m.includes('not support') || m.includes('unsupported') || m.includes('not found') && m.includes('model')) {
    return '当前模型不支持局部重绘，请切换支持 /images/edits 的模型'
  }
  if (m.includes('mask')) {
    return 'mask 参数无效或模型不支持 mask'
  }
  if (m.includes('size') || m.includes('dimension') || m.includes('resolution')) {
    return '尺寸不被模型支持，请尝试调整尺寸或先裁剪'
  }
  if (m.includes('timeout') || m.includes('timed out')) {
    return '请求超时，请重试或检查网络'
  }
  if (m.includes('network') || m.includes('fetch failed') || m.includes('econnrefused') || m.includes('enotfound')) {
    return '网络错误，请检查连接'
  }
  if (m.includes('cloud login')) {
    return '未登录云端服务'
  }
  // 兜底：复用统一错误翻译表（覆盖 Upstream/503/Bad Gateway/限流/多米/鉴权等常见英文错误）
  return translateError(rawMsg) || '重绘失败'
}

// ---- Image utility ----
function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

async function blendWithMask(originalDataUrl: string, newDataUrl: string, maskDataUrl: string): Promise<string> {
  const [origImg, newImg, maskImg] = await Promise.all([
    loadImageEl(originalDataUrl),
    loadImageEl(newDataUrl),
    loadImageEl(maskDataUrl)
  ])
  const w = origImg.naturalWidth
  const h = origImg.naturalHeight

  const result = document.createElement('canvas')
  result.width = w
  result.height = h
  const ctx = result.getContext('2d')!
  ctx.drawImage(origImg, 0, 0, w, h)

  const layer = document.createElement('canvas')
  layer.width = w
  layer.height = h
  const lctx = layer.getContext('2d')!
  lctx.drawImage(newImg, 0, 0, w, h)
  lctx.globalCompositeOperation = 'destination-in'
  lctx.drawImage(maskImg, 0, 0, w, h)

  ctx.drawImage(layer, 0, 0)
  return result.toDataURL('image/png')
}

// ---- Source exporter variants ----
async function getSourceForInpaint(): Promise<string | null> {
  if (!fabricCanvas) return null
  const hidden: FabricObject[] = []
  fabricCanvas.getObjects().forEach(o => {
    const role = (o as any).data?.role
    let shouldHide = role === 'mask' || role === 'mask-erase' || role === 'mask-shape' || role === 'mask-shape-erase' || role === 'crop-rect'
    if (keepEditLayers.value && (role === 'text' || role === 'draw' || role === 'sticker' || role === 'subject')) shouldHide = true
    if (shouldHide && o.visible !== false) {
      hidden.push(o)
      o.visible = false
    }
  })
  fabricCanvas.discardActiveObject()
  fabricCanvas.requestRenderAll()
  try {
    return await getCanvasDataUrl()
  } finally {
    hidden.forEach(o => { o.visible = true })
    fabricCanvas.requestRenderAll()
  }
}

// ---- Cancel inpaint ----
function cancelInpaint() {
  if (!inpainting.value) return
  inpaintCancelled = true
  inpaintProgress.value.message = '取消中...'
  showToast('已请求取消，等待当前批次完成后停止')
}

// O8: 模型选择弹窗确认回调，保存到 settings 持久化
function onModelConfirm(payload: { providerId: string; modelId: string }) {
  editProviderId.value = payload.providerId
  editModelId.value = payload.modelId
  api().settings.invoke('set', 'imageedit_provider_id', payload.providerId).catch(() => {})
  api().settings.invoke('set', 'imageedit_model_id', payload.modelId).catch(() => {})
  showToast(`已设置：${modelStore.formatModelLabel(payload.providerId, payload.modelId)}`)
}

// 校验生图模型是否已配置；未配置时自动打开模型选择弹窗并提示，返回 false 阻断后续动作
function ensureEditModelConfigured(): boolean {
  const provider = editProviderId.value || generation.value?.model_provider_id
  const model = editModelId.value || generation.value?.model_id
  if (!provider || !model) {
    showToast('请先选择生图模型')
    modelDialogVisible.value = true
    return false
  }
  return true
}

// ---- Main inpaint function ----
async function runInpaint() {
  if (!generation.value) return
  if (!ensureEditModelConfigured()) return
  // 模板允许留空时跳过提示词校验（如「移除」模板会自动用背景填补）
  const allowEmpty = usePromptTemplate.value && currentTemplate().allowEmpty === true
  if (!allowEmpty && !inpaintPrompt.value.trim()) {
    showToast('请输入重绘提示词')
    return
  }
  if (compareMode.value !== 'none') {
    showToast('请先确认或取消当前对比')
    return
  }

  const maskDataUrl = generateMaskDataURL()
  if (!maskDataUrl) {
    showToast('请先涂抹需要重绘的区域')
    return
  }

  inpainting.value = true
  inpaintCancelled = false
  inpaintProgress.value = { completed: 0, total: batchCount.value, message: '准备中...' }

  try {
    const sourceDataUrl = await getSourceForInpaint()
    if (!sourceDataUrl) throw new Error('Failed to export canvas')

    const sourceBase64 = sourceDataUrl.split(',')[1]
    const maskBase64 = maskDataUrl.split(',')[1]

    const finalPrompt = buildFinalPrompt()
    assertImagePromptLength(finalPrompt, '重绘提示词')
    const finalSize = inferSizeKey(originalW, originalH, generation.value.size || '1:1')

    // O8: 优先使用用户在工具栏「生图模型」按钮设置的模型；未设置回退到 generation
    const effectiveProvider = editProviderId.value || generation.value.model_provider_id
    const effectiveModel = editModelId.value || generation.value.model_id
    if (!effectiveProvider || !effectiveModel) {
      throw new Error('未设置生图模型，请先点左下角「设置生图模型」选择')
    }

    const results: any[] = await api().imageGen.invoke('generate', {
      prompt: finalPrompt,
      refImages: [sourceBase64],
      mask: maskBase64,
      modelProviderId: effectiveProvider,
      modelId: effectiveModel,
      size: finalSize,
      quality: generation.value.quality || 'auto',
      batchCount: batchCount.value,
      // 标记来源为 edit，避免被 image-gen / batch 列表的进度监听误并入其 inFlight 占位
      progressContext: { source: 'edit' }
    })

    if (inpaintCancelled) {
      showToast('已取消重绘')
      return
    }

    const succeeded = (results || []).filter(r => r && r.status === 'done' && r.result_path)
    const failed = (results || []).filter(r => r && r.status !== 'done')

    if (succeeded.length === 0) {
      const firstErr = failed[0]?.error || '所有候选均失败'
      throw new Error(firstErr)
    }

    // Record successful image-model usage for the shared hints LRU
    // 用本次实际重绘所用的模型（effectiveProvider/effectiveModel），不是 generation 创建时的模型
    if (effectiveProvider && effectiveModel) {
      await recordUsage('image', effectiveProvider, effectiveModel)
    }

    // Load candidate data URLs
    const candidateUrls: string[] = []
    for (const r of succeeded) {
      const absPath = await api().imageGen.invoke('getAbsolutePath', r.result_path)
      const imgEl = await loadImageEl('local-file://img?p=' + encodeURIComponent(absPath))
      candidateUrls.push(imageToDataURL(imgEl))
    }

    // Snapshot current canvas (pre-inpaint) for compare
    const snapshot = await getSourceForInpaint()
    originalSnapshotDataUrl.value = snapshot
    activeMaskDataUrl.value = maskDataUrl

    compareCandidates.value = candidateUrls
    compareSelectedIndex.value = 0
    compareSplit.value = 50
    compareShowOriginal.value = candidateUrls.length === 1
    compareMode.value = candidateUrls.length > 1 ? 'multi' : 'single'

    if (failed.length > 0) {
      showToast(`生成 ${succeeded.length}/${results.length} 张成功，${failed.length} 张失败`)
    }
  } catch (e: any) {
    const friendly = classifyError(e?.message || '')
    showToast('重绘失败：' + friendly)
    console.error('[Inpaint]', e)
  } finally {
    inpainting.value = false
    inpaintProgress.value = { completed: 0, total: 0, message: '' }
  }
}

// ---- Compare mode actions ----
async function applyCompareResult() {
  if (compareMode.value === 'none') return
  const chosen = compareCandidates.value[compareSelectedIndex.value]
  if (!chosen) return

  loading.value = true
  try {
    let finalDataUrl = chosen

    // Apply composite blending if enabled
    if (compositeBlend.value && originalSnapshotDataUrl.value && activeMaskDataUrl.value) {
      finalDataUrl = await blendWithMask(originalSnapshotDataUrl.value, chosen, activeMaskDataUrl.value)
    }

    const newImgEl = await loadImageEl(finalDataUrl)

    // Record in history
    const thumb = await makeThumbnail(finalDataUrl, 64)
    inpaintHistory.value.unshift({
      thumbnail: thumb,
      prompt: inpaintPrompt.value,
      timestamp: Date.now()
    })
    if (inpaintHistory.value.length > 12) inpaintHistory.value.length = 12

    if (keepEditLayers.value) {
      // Only swap base image, keep text/draw layers
      await swapBaseImageKeepLayers(finalDataUrl, newImgEl.naturalWidth, newImgEl.naturalHeight)
    } else {
      await replaceBaseImage(finalDataUrl, newImgEl.naturalWidth, newImgEl.naturalHeight)
    }

    clearMask()
    saveHistory()
    exitCompareMode()
    showToast('已应用重绘结果')
  } catch (e: any) {
    showToast('应用失败：' + (e.message || ''))
    console.error('[Compare apply]', e)
  } finally {
    loading.value = false
  }
}

function exitCompareMode() {
  compareMode.value = 'none'
  compareCandidates.value = []
  compareSelectedIndex.value = 0
  originalSnapshotDataUrl.value = null
  activeMaskDataUrl.value = null
}

function cancelCompare() {
  exitCompareMode()
  showToast('已取消应用')
}

async function swapBaseImageKeepLayers(dataUrl: string, newOrigW: number, newOrigH: number) {
  if (!fabricCanvas) return
  removeCornerCanvasPreview()
  originalW = newOrigW
  originalH = newOrigH
  imageSizeVersion.value++

  const { canvasW, canvasH, scale } = computeFitSize(newOrigW, newOrigH)
  const oldCanvasW = fabricCanvas.width!
  const oldCanvasH = fabricCanvas.height!
  displayScale = scale

  // Remove only mask objects; keep text/draw objects
  const toRemove = fabricCanvas.getObjects().filter(o => {
    const role = (o as any).data?.role
    return role === 'mask' || role === 'mask-erase' || role === 'mask-shape' || role === 'mask-shape-erase' || role === 'crop-rect'
  })
  toRemove.forEach(o => fabricCanvas!.remove(o))

  // Rescale existing non-base objects proportionally
  const rx = canvasW / oldCanvasW
  const ry = canvasH / oldCanvasH
  fabricCanvas.getObjects().forEach(o => {
    if ((o as any).data?.role === 'base') return
    o.set({
      left: (o.left || 0) * rx,
      top: (o.top || 0) * ry,
      scaleX: (o.scaleX || 1) * rx,
      scaleY: (o.scaleY || 1) * ry
    })
    o.setCoords()
  })

  fabricCanvas.setDimensions({ width: canvasW, height: canvasH })
  fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0])
  await setBaseImage(dataUrl, canvasW, canvasH)
  reapplyFilters(false)

  await nextTick()
  fabricCanvas.calcOffset()
}

async function makeThumbnail(dataUrl: string, size: number): Promise<string> {
  const img = await loadImageEl(dataUrl)
  const tmp = document.createElement('canvas')
  const ratio = img.naturalWidth / img.naturalHeight
  if (ratio >= 1) {
    tmp.width = size
    tmp.height = Math.max(1, Math.round(size / ratio))
  } else {
    tmp.height = size
    tmp.width = Math.max(1, Math.round(size * ratio))
  }
  tmp.getContext('2d')!.drawImage(img, 0, 0, tmp.width, tmp.height)
  return tmp.toDataURL('image/png')
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---- Save / Export ----
async function getCanvasDataUrl(region: CanvasRegion | null = getBaseImageRegion()): Promise<string | null> {
  if (!fabricCanvas || !region) return null
  const size = exportPixelSize(region)
  return await withHiddenObjects(isTemporaryExportObject, () => exportSceneRegion(region, size.width, size.height))
}

async function getFinalExportDataUrl(): Promise<string | null> {
  return await withoutCornerCanvasPreview(async () => {
    const dataUrl = await getCanvasDataUrl()
    if (!dataUrl) return null
    if (!hasCornerSettings()) return dataUrl
    const result = await renderCornerDataUrl(dataUrl)
    return result.dataUrl
  })
}

async function saveImage() {
  if (!generation.value) return
  saving.value = true
  try {
    const dataUrl = await getFinalExportDataUrl()
    if (!dataUrl) throw new Error('Failed to export canvas')
    if (props.embedded || generation.value.id === '_canvas') {
      emit('apply', dataUrl)
      showToast('已应用到参考图')
      return
    }
    if (generation.value.id === '_local') {
      // 本地图库编辑模式：创建独立的新 image_generation 记录
      // sourcePath 仅作元数据保留，方便用户追溯；不会覆盖原图，也不会自动加入图库
      const newGen = await api().imageGen.invoke('saveLocalEdited', generation.value.result_path, dataUrl)
      showToast('已保存到「我的创作」')
      // 把当前页指向新生成的记录，让后续 inpaint/saveAsNew/reset 都基于新记录运行
      if (newGen?.id) {
        generation.value = newGen
        router.replace({ path: `/image-edit/${newGen.id}` })
      }
    } else {
      await api().imageGen.invoke('saveEditedImage', generation.value.id, dataUrl)
      showToast('已保存')
    }
  } catch (e: any) {
    showToast('保存失败: ' + (e.message || ''))
  } finally {
    saving.value = false
  }
}

// O4-4: 另存到图库
async function prepareSaveToGallery() {
  if (!generation.value) return
  try {
    const dataUrl = await getFinalExportDataUrl()
    if (!dataUrl) throw new Error('Failed to export canvas')
    gallerySaveDataUri.value = dataUrl
    gallerySaveDefaultName.value = generation.value.id === '_local' || generation.value.id === '_canvas'
      ? `编辑_${new Date().toISOString().slice(0, 10)}`
      : `edited_${generation.value.id}`
    gallerySaveVisible.value = true
  } catch (e: any) {
    showToast('准备保存失败: ' + (e.message || ''))
  }
}

async function onGallerySaveConfirm(payload: { categoryId: string; filename: string }) {
  if (!gallerySaveDataUri.value) return
  saving.value = true
  try {
    const name = payload.filename || gallerySaveDefaultName.value
    const item = await galleryStore.addFromDataUri(payload.categoryId, gallerySaveDataUri.value, name)
    if (item) showToast('已保存到图库')
    else throw new Error('写盘失败')
  } catch (e: any) {
    showToast('保存失败: ' + (e.message || ''))
  } finally {
    saving.value = false
    gallerySaveDataUri.value = ''
  }
}

function onSelectLayer(id: string) {
  selectOnCanvas(fabricCanvas, id, isDrawingTool())
}

function onToggleLayerVisible(id: string) {
  const layer = docLayers.value.find(l => l.id === id)
  if (!layer) return
  setLayerVisible(fabricCanvas, id, !layer.visible)
  applyObjectFlags(fabricCanvas, isDrawingTool())
  saveHistory()
}

function onToggleLayerLock(id: string) {
  const layer = docLayers.value.find(l => l.id === id)
  if (!layer) return
  setLayerLocked(fabricCanvas, id, !layer.locked, isDrawingTool())
  saveHistory()
}

function onRenameLayer(id: string, name: string) {
  renameLayer(id, name)
  saveHistory()
}

function onLayerOpacity(id: string, value: number) {
  setLayerOpacity(fabricCanvas, id, value)
}

function onLayerOpacityCommit() {
  saveHistory()
}

function onReorderLayers(fromIndex: number, toIndex: number) {
  reorderLayers(fabricCanvas, fromIndex, toIndex)
  saveHistory()
}

async function writeTempPng(dataUrl: string): Promise<string> {
  const bridge = api()
  try {
    const payload = bridge?.imageExport?.invoke
      ? await bridge.imageExport.invoke('writeTempPng', dataUrl)
      : await bridge?.imageGen?.invoke('writeTempPng', dataUrl)
    const path = (payload as any)?.path
    if (path) return path
  } catch {
    /* 预加载未刷新时退回原图路径 */
  }
  const src = originalEditorSrc.value || generation.value?.result_path || ''
  if (src.startsWith('local-file://')) {
    try {
      const u = new URL(src)
      const p = u.searchParams.get('p') || u.searchParams.get('rel')
      if (p) {
        const abs = await bridge.imageGen.invoke('getAbsolutePath', p)
        if (abs) return String(abs)
      }
    } catch { /* ignore */ }
  } else if (src && !src.startsWith('data:')) {
    const abs = await bridge.imageGen.invoke('getAbsolutePath', src)
    if (abs) return String(abs)
  }
  throw new Error('无法写入临时文件，请完全退出后重新打开应用')
}

async function exportBaseLayerDataUrl(): Promise<string | null> {
  const region = getBaseImageRegion()
  if (!region) return null
  const size = exportPixelSize(region)
  return await withHiddenObjects(
    (o) => (o as any).data?.role !== 'base',
    () => exportSceneRegion(region, size.width, size.height)
  )
}

async function punchSubjectFromBackground(originalDataUrl: string, subjectDataUrl: string): Promise<string> {
  const [orig, subj] = await Promise.all([loadImageEl(originalDataUrl), loadImageEl(subjectDataUrl)])
  const w = orig.naturalWidth || orig.width
  const h = orig.naturalHeight || orig.height
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, w)
  canvas.height = Math.max(1, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.drawImage(orig, 0, 0, canvas.width, canvas.height)
  ctx.globalCompositeOperation = 'destination-out'
  ctx.drawImage(subj, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

async function filePathToDataUrl(absPath: string): Promise<string> {
  const img = await loadImageEl('local-file://img?p=' + encodeURIComponent(absPath))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, img.naturalWidth || img.width)
  canvas.height = Math.max(1, img.naturalHeight || img.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法读取抠图结果')
  ctx.drawImage(img, 0, 0)
  return canvas.toDataURL('image/png')
}

async function splitSubjectBackground() {
  if (!fabricCanvas || !baseImage || splittingSubject.value) return
  if (docLayers.value.some(l => l.type === 'subject')) {
    showToast('已经拆过主体和背景，可先点重置再拆')
    return
  }
  splittingSubject.value = true
  showToast('正在拆分主体和背景...')
  try {
    await mattingStore.loadProviders()
    const allowCustom = cloudAuth.permissions.allow_custom_matting_provider
    const source: 'cloud' | 'custom' = allowCustom && mattingStore.defaultProvider ? 'custom' : 'cloud'
    if (source === 'cloud' && cloudAuth.permissions.allow_image_matting === false) {
      throw new Error('当前账号未开通抠图')
    }
    const baseDataUrl = await exportBaseLayerDataUrl()
    if (!baseDataUrl) throw new Error('没有可拆分的底图')
    const localPath = await writeTempPng(baseDataUrl)
    const result = await mattingStore.segment({
      localPath,
      source,
      providerId: source === 'custom' ? mattingStore.defaultProvider?.id : undefined,
      addToGallery: false
    })
    if (result.status === 'failed' || !result.resultPath) {
      throw new Error(result.error || '抠图失败')
    }
    const subjectDataUrl = await filePathToDataUrl(result.resultPath)
    const backgroundDataUrl = await punchSubjectFromBackground(baseDataUrl, subjectDataUrl)
    const transform = {
      left: baseImage.left || 0,
      top: baseImage.top || 0,
      scaleX: baseImage.scaleX || 1,
      scaleY: baseImage.scaleY || 1,
      angle: baseImage.angle || 0
    }
    const canvasW = fabricCanvas.width || 1
    const canvasH = fabricCanvas.height || 1
    await setBaseImage(backgroundDataUrl, canvasW, canvasH)
    if (baseImage) {
      baseImage.set(transform)
      baseImage.setCoords()
    }
    const subjectImg = await FabricImage.fromURL(subjectDataUrl)
    const targetW = (baseImage?.width || 1) * (baseImage?.scaleX || 1)
    const targetH = (baseImage?.height || 1) * (baseImage?.scaleY || 1)
    subjectImg.set({
      left: transform.left,
      top: transform.top,
      originX: 'left',
      originY: 'top',
      scaleX: targetW / Math.max(1, subjectImg.width || 1),
      scaleY: targetH / Math.max(1, subjectImg.height || 1),
      angle: transform.angle,
      selectable: true,
      evented: true
    } as any)
    ;(subjectImg as any).data = { role: 'subject' }
    ensureObjectLayerId(subjectImg as any, 'subject')
    attachDeleteControl(subjectImg as unknown as FabricObject)
    fabricCanvas.add(subjectImg)
    const baseIdx = fabricCanvas.getObjects().indexOf(baseImage as any)
    if (baseIdx >= 0) fabricCanvas.moveObjectTo(subjectImg, baseIdx + 1)
    refreshLayers()
    const baseId = (baseImage as any)?.data?.layerId as string | undefined
    const subjectId = (subjectImg as any).data?.layerId as string | undefined
    if (baseId) renameLayer(baseId, '背景')
    if (subjectId) renameLayer(subjectId, '主体')
    selectTool('select')
    saveHistory()
    showToast('已拆成主体和背景两层，可导出 PSD')
  } catch (e: any) {
    showToast(friendlyMattingError(exportErrorMessage(e)))
  } finally {
    splittingSubject.value = false
  }
}

function exportStem(): string {
  const raw = editorFileName.value.replace(/\.[^.]+$/, '')
  return raw.replace(/[\\/:*?"<>|]/g, '_') || 'image'
}

async function collectLayerPayloads() {
  if (!fabricCanvas) return null
  const region = {
    left: 0,
    top: 0,
    width: fabricCanvas.width || 1,
    height: fabricCanvas.height || 1
  }
  const outW = Math.max(1, Math.round(region.width / Math.max(displayScale, 0.01)))
  const outH = Math.max(1, Math.round(region.height / Math.max(displayScale, 0.01)))
  const bottomFirst = [...docLayers.value].reverse()
  const payloads = []
  for (const layer of bottomFirst) {
    const obj = findLayerObject(fabricCanvas, layer.id)
    const wasHidden = obj ? obj.visible === false : false
    if (obj) obj.visible = true
    const pngDataUrl = await withHiddenObjects(
      (o) => {
        const role = (o as any).data?.role
        if (role === 'erase') return false
        return isTemporaryExportObject(o) || (o as any).data?.layerId !== layer.id
      },
      () => exportSceneRegion(region, outW, outH)
    )
    if (obj && wasHidden) obj.visible = false
    if (!pngDataUrl) continue
    let text: { content: string; fontFamily: string; fontSize: number; fill: string; left: number; top: number; width: number; height: number } | undefined
    if (layer.type === 'text' && obj) {
      const it = obj as IText
      const scale = 1 / Math.max(displayScale, 0.01)
      text = {
        content: it.text || '',
        fontFamily: (it.fontFamily as string) || 'sans-serif',
        fontSize: Math.max(8, Math.round((it.fontSize || 16) * (it.scaleY || 1) * scale)),
        fill: String(it.fill || '#000000'),
        left: Math.round((it.left || 0) * scale),
        top: Math.round((it.top || 0) * scale),
        width: Math.round((it.width || 0) * (it.scaleX || 1) * scale),
        height: Math.round((it.height || 0) * (it.scaleY || 1) * scale)
      }
    }
    payloads.push({ layer: { ...layer }, pngDataUrl, text })
  }
  fabricCanvas.requestRenderAll()
  return { width: outW, height: outH, payloads }
}

async function exportPsd() {
  exporting.value = true
  try {
    const packed = await collectLayerPayloads()
    if (!packed || !packed.payloads.length) throw new Error('没有可导出的图层')
    const buffer = await buildPsdBuffer(packed.width, packed.height, packed.payloads)
    const result = await saveExportBuffer({
      defaultName: `${exportStem()}.psd`,
      filters: [{ name: 'Photoshop', extensions: ['psd'] }],
      encoding: 'base64',
      data: arrayBufferToBase64(buffer)
    })
    if (!result?.canceled) showToast('已导出 PSD。仅应用内添加的纯文字在 PS 中可改字')
  } catch (e: any) {
    showToast('导出 PSD 失败: ' + exportErrorMessage(e))
  } finally {
    exporting.value = false
  }
}

async function exportSvg() {
  exporting.value = true
  try {
    const packed = await collectLayerPayloads()
    if (!packed || !packed.payloads.length) throw new Error('没有可导出的图层')
    const svg = buildHybridSvg(packed.width, packed.height, packed.payloads)
    const result = await saveExportBuffer({
      defaultName: `${exportStem()}.svg`,
      filters: [{ name: 'SVG', extensions: ['svg'] }],
      data: svg
    })
    if (!result?.canceled) showToast('已导出 SVG（底图为位图，文字为矢量）')
  } catch (e: any) {
    showToast('导出 SVG 失败: ' + exportErrorMessage(e))
  } finally {
    exporting.value = false
  }
}

async function saveProject() {
  exporting.value = true
  try {
    const snapshot = serializeCanvas()
    let assets: Array<{ filename: string; dataUrl: string }> = []
    try {
      const packed = await collectLayerPayloads()
      if (packed) {
        assets = packed.payloads.map((p, i) => ({
          filename: `${String(i).padStart(2, '0')}_${p.layer.type}_${p.layer.id}.png`,
          dataUrl: p.pngDataUrl
        }))
      }
    } catch {
      /* 图层 PNG 失败时仍保存 Fabric 快照，打开工程仍可恢复 */
    }
    const json = JSON.stringify({
      kind: IMAGE_DOC_KIND,
      version: IMAGE_DOC_VERSION,
      snapshot: JSON.parse(snapshot),
      layers: docLayers.value,
      assets: assets.map(a => a.filename)
    }, null, 2)
    const result = await invokeExport('saveProject', {
      defaultName: `${exportStem()}.haohuoban-image.json`,
      json,
      assets
    })
    if (!result?.canceled) showToast('已保存工程')
  } catch (e: any) {
    showToast('保存工程失败: ' + (e.message || ''))
  } finally {
    exporting.value = false
  }
}

async function openProject() {
  try {
    const result = await invokeExport('openProject')
    if (result?.canceled || !result?.json) return
    const parsed = JSON.parse(result.json)
    if (parsed?.kind !== IMAGE_DOC_KIND || !parsed.snapshot) {
      showToast('不是好伙伴图片工程文件')
      return
    }
    await restoreSnapshot(JSON.stringify(parsed.snapshot))
    if (Array.isArray(parsed.layers)) {
      const byId = new Map(parsed.layers.map((l: any) => [l.id, l]))
      docLayers.value = docLayers.value.map(l => {
        const saved = byId.get(l.id)
        return saved ? { ...l, name: saved.name || l.name, locked: !!saved.locked } : l
      })
      applyObjectFlags(fabricCanvas, isDrawingTool())
    }
    saveHistory()
    showToast('已打开工程')
  } catch (e: any) {
    showToast('打开工程失败: ' + exportErrorMessage(e))
  }
}

// ---- Reset ----
async function resetCanvas() {
  if (!generation.value) return
  loading.value = true
  try {
    removeCornerCanvasPreview()
    const src = originalEditorSrc.value || generation.value.result_path
    const imgEl = new Image()
    await new Promise<void>((resolve, reject) => {
      imgEl.onload = () => resolve()
      imgEl.onerror = () => reject(new Error('load failed'))
      imgEl.src = resolveImageSrc(src)
    })
    const newDataUrl = imageToDataURL(imgEl)
    resetFilterValues()
    resetCornerSettings()
    await replaceBaseImage(newDataUrl, imgEl.naturalWidth, imgEl.naturalHeight)
    history.value = []
    historyIndex.value = -1
    saveHistory()
    maskPreviewOn.value = false
    selectTool('inpaint')
    refreshLayers()
    showToast('已重置')
  } catch (e: any) {
    showToast('重置失败: ' + (e.message || ''))
  } finally {
    loading.value = false
  }
}

// ---- Navigate ----
function goBack() {
  if (props.embedded) {
    emit('close')
    return
  }
  router.back()
}

async function regenerateWithRef() {
  if (!generation.value || !fabricCanvas) return
  // Temporarily hide masks and crop rect so the exported image only contains real edits
  const hidden: FabricObject[] = []
  fabricCanvas.getObjects().forEach((o) => {
    const role = (o as any).data?.role
    if (role === 'mask' || role === 'crop-rect') {
      if (o.visible !== false) {
        hidden.push(o)
        o.visible = false
      }
    }
  })
  fabricCanvas.discardActiveObject()
  fabricCanvas.requestRenderAll()
  try {
    const dataUrl = await getFinalExportDataUrl()
    if (!dataUrl) return
    sessionStorage.setItem('imageGen:refImages', JSON.stringify([dataUrl]))
    router.push({ path: '/image-gen', query: { prompt: generation.value.prompt, hasRefImages: '1' } })
  } finally {
    hidden.forEach((o) => { o.visible = true })
    fabricCanvas.requestRenderAll()
  }
}

// ---- Utility ----
function showToast(msg: string) {
  toast.value = msg
  setTimeout(() => { toast.value = '' }, 2500)
}
</script>

<style scoped>
.img-edit-checker {
  background-color: #ececec;
  background-image:
    linear-gradient(45deg, #d9d9d9 25%, transparent 25%),
    linear-gradient(-45deg, #d9d9d9 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #d9d9d9 75%),
    linear-gradient(-45deg, transparent 75%, #d9d9d9 75%);
  background-size: 18px 18px;
  background-position: 0 0, 0 9px, 9px -9px, -9px 0;
}
</style>
