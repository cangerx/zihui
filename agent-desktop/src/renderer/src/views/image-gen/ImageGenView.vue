<template>
  <div class="h-full flex overflow-hidden">
      <!-- Left: Generation Config -->
      <div class="w-72 flex-shrink-0 border-r border-surface-3 bg-surface-0 flex flex-col">
            <div class="flex-1 overflow-y-auto p-4 space-y-5">
              <h3 class="text-xs font-semibold text-text-primary tracking-wide uppercase">生成配置</h3>

              <!-- Prompt -->
              <div>
                <WorkspaceBrandChip :prompt="prompt" />
                <div class="flex items-center justify-between gap-3 mb-1.5 mt-2">
                  <div class="flex items-center gap-2">
                    <label class="text-xs font-medium text-text-secondary">提示词</label>
                    <button
                      @click="showPresetPopup = !showPresetPopup"
                      class="rounded-lg border border-surface-3 bg-surface-1 px-2.5 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:border-primary-300 hover:bg-surface-2 hover:text-primary-600"
                    >预设</button>
                    <button
                      type="button"
                      class="rounded-lg border border-surface-3 bg-surface-1 px-2.5 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:border-primary-300 hover:bg-surface-2 hover:text-primary-600"
                      title="管理生图预设"
                      @click="goManagePresets"
                    >管理</button>
                    <button
                      type="button"
                      class="rounded-lg border border-surface-3 bg-surface-1 px-2.5 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:border-primary-300 hover:bg-surface-2 hover:text-primary-600 disabled:opacity-40 disabled:cursor-not-allowed"
                      title="把当前提示词存为预设"
                      :disabled="!prompt.trim()"
                      @click="openSavePreset(prompt)"
                    >存为</button>
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                      v-if="prompt.trim() && optimizeProviderId && optimizeModelId"
                      @click="optimizePrompt()"
                      :disabled="optimizing"
                      class="rounded-lg bg-primary-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                      title="根据输入自动识别中文或英文并优化"
                    >优化</button>
                  </div>
                </div>
                <PromptTextarea
                  v-model="prompt"
                  title="编辑生图提示词"
                  :height="132"
                  :max-length="IMAGE_PROMPT_MAX_LENGTH"
                  placeholder="描述你想要生成的图片..."
                />
                <!-- 风格选择单独一排：标题行空间让给优化按钮，避免风格名把按钮挤变形 -->
                <div class="mt-1.5">
                  <StylePresetPicker v-model="stylePresetId" />
                </div>
                <div v-if="optimizing" class="flex items-center gap-1.5 mt-1 text-[10px] text-text-tertiary">
                  <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                  正在优化提示词...
                </div>
                <div v-if="optimizeError" class="mt-1 px-3 py-1.5 text-[11px] text-red-600 bg-red-50 dark:text-red-300 dark:bg-red-900/20 rounded-lg">{{ optimizeError }}</div>
              </div>

              <!-- Reference Images -->
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <div class="flex items-center gap-2 min-w-0">
                    <label class="text-xs font-medium text-text-secondary">参考图</label>
                    <span v-if="isDuomiProvider" class="text-[10px] text-amber-600 dark:text-amber-400 truncate">多米参考图生图适配中</span>
                  </div>
                  <span class="text-[10px] text-text-tertiary">{{ refImages.length }} / 10</span>
                </div>
                <div class="flex gap-2 flex-wrap">
                  <div v-for="(img, i) in refImages" :key="i" class="relative w-14 h-14 rounded-lg overflow-hidden border border-surface-3 group">
                    <img :src="img" class="w-full h-full object-cover" />
                    <button @click="refImages.splice(i, 1)" class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                  <button
                    v-if="refImages.length < 10"
                    @click="pickRefImage"
                    :disabled="isDuomiProvider"
                    :title="isDuomiProvider ? '多米参考图生图适配中' : ''"
                    :class="['w-14 h-14 rounded-lg border-2 border-dashed border-surface-4 flex flex-col items-center justify-center text-text-tertiary transition-colors', isDuomiProvider ? 'opacity-40 cursor-not-allowed' : 'hover:text-text-secondary hover:border-surface-5']"
                  >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                    <span class="text-[9px] mt-0.5">添加</span>
                  </button>
                  <button
                    v-if="refImages.length < 10"
                    @click="showGalleryPicker = true"
                    :disabled="isDuomiProvider"
                    :title="isDuomiProvider ? '多米参考图生图适配中' : ''"
                    :class="['w-14 h-14 rounded-lg border-2 border-dashed border-surface-4 flex flex-col items-center justify-center text-text-tertiary transition-colors', isDuomiProvider ? 'opacity-40 cursor-not-allowed' : 'hover:text-text-secondary hover:border-surface-5']"
                  >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" stroke-width="2"/><polyline points="21 15 16 10 5 21" stroke-width="2"/></svg>
                    <span class="text-[9px] mt-0.5">图库</span>
                  </button>
                </div>
              </div>

              <!-- Model Selection：记住上次选用，需要换时再点 -->
              <div>
                <label class="text-xs font-medium text-text-secondary mb-1.5 block">生图模型</label>
                <ChatModelSwitcher
                  :provider-id="selectedProviderId"
                  :model-id="selectedModelId"
                  type="image"
                  direction="down"
                  block
                  prefix=""
                  @change="onImageModelPick"
                />
              </div>

              <div>
                <label class="text-xs font-medium text-text-secondary mb-1.5 block">提示词优化模型</label>
                <ChatModelSwitcher
                  :provider-id="optimizeProviderId"
                  :model-id="optimizeModelId"
                  type="chat"
                  direction="down"
                  block
                  prefix=""
                  @change="onOptimizeModelPick"
                />
              </div>

              <!-- Size -->
              <div>
                <label class="text-xs font-medium text-text-secondary mb-1.5 block">尺寸</label>
                <ImageSizePicker
                  v-model="selectedSize"
                  :columns="6"
                  :model-id="pureSelectedModelId"
                  :tier-id="selectedTier"
                  show-hint
                />
              </div>

              <!-- Resolution Tier -->
              <div>
                <label class="text-xs font-medium text-text-secondary mb-1.5 block">分辨率</label>
                <ResolutionTierPicker
                  v-model="selectedTier"
                  :model-id="pureSelectedModelId"
                  :size-value="selectedSize"
                />
              </div>

              <!-- Quality：仅在无参考图且模型支持画质档位时显示（/edits 接口 quality 无效，强制 auto） -->
              <div v-if="!hasRefImages && qualitiesAvailable">
                <label class="text-xs font-medium text-text-secondary mb-1.5 block">画质</label>
                <QualityPicker
                  v-model="selectedQuality"
                  :model-id="pureSelectedModelId"
                />
              </div>

              <!-- Batch Count -->
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <label class="text-xs font-medium text-text-secondary">批量数量</label>
                  <span class="text-xs font-semibold text-primary-600">{{ batchCount }}</span>
                </div>
                <input type="range" v-model.number="batchCount" min="1" max="10" step="1" class="w-full h-1.5 bg-surface-3 rounded-full appearance-none cursor-pointer accent-primary-600" />
                <div class="flex justify-between text-[10px] text-text-tertiary mt-1">
                  <span>1</span>
                  <span>10</span>
                </div>
              </div>

              <!-- Concurrency UI removed: 全局 semaphore (6) 已兜底，再叠加 per-call 滑块只会增加用户困惑 -->

            </div>
            <!-- Generate Button (sticky bottom) -->
            <div class="flex-shrink-0 p-4 border-t border-surface-3">
              <ConsumptionEstimate
                v-if="imageEstimate.amount > 0"
                class="mb-3"
                :balance-type="imageEstimate.balanceType"
                :amount="imageEstimate.amount"
              />
              <button
                @click="doGenerate"
                :disabled="!canGenerate"
                class="w-full py-3 text-sm font-semibold bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <svg v-if="store.generating && !store.queue.length" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                {{ store.generating ? (store.queue.length ? `加入队列 (${store.queue.length + 1})` : `生成中 (${store.progress?.completed || 0}/${store.progress?.total || batchCount})`) : '开始生成' }}
              </button>
              <!-- Queue indicator + 队列记录列表 -->
              <div v-if="store.generating || store.queue.length" class="mt-2">
                <div class="flex items-center justify-between px-1 mb-1.5">
                  <div class="flex items-center gap-1.5 text-[11px] text-text-tertiary min-w-0">
                    <svg v-if="store.generating" class="w-3.5 h-3.5 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                    <span class="truncate">
                      <template v-if="store.generating">生成中 ({{ store.progress?.completed || 0 }}/{{ store.progress?.total || '?' }})<template v-if="store.queue.length"> · 排队 {{ store.queue.length }}</template></template>
                      <template v-else>排队 {{ store.queue.length }} 项</template>
                    </span>
                  </div>
                  <div class="flex items-center gap-2 flex-shrink-0">
                    <button v-if="store.generating" @click="store.cancelAllInFlight()" class="text-[11px] text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300">中止生成</button>
                    <button v-if="store.queue.length" @click="store.clearQueue()" class="text-[11px] text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300">清空队列</button>
                  </div>
                </div>
                <!-- 排队记录：每条可单独移出（正在生成的任务请用上方「中止生成」或右侧卡片中止） -->
                <div v-if="store.queue.length" class="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-surface-3 bg-surface-1 p-1.5">
                  <div v-for="(item, idx) in store.queue" :key="item.id" class="flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface-0 border border-surface-3">
                    <span class="w-4 flex-shrink-0 text-center text-[10px] text-text-tertiary">{{ idx + 1 }}</span>
                    <span class="flex-1 min-w-0 truncate text-[11px] text-text-secondary" :title="item.options.prompt">{{ item.label || item.options.prompt }}</span>
                    <span v-if="(item.options.batchCount || 1) > 1" class="flex-shrink-0 text-[10px] text-text-tertiary">×{{ item.options.batchCount }}</span>
                    <button @click="store.removeFromQueue(item.id)" class="flex-shrink-0 p-0.5 text-text-tertiary hover:text-red-500 rounded transition-colors" title="移出队列">
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                </div>
              </div>
              <div v-if="store.lastError" class="mt-2 px-3 py-1.5 text-[11px] text-red-600 bg-red-50 dark:text-red-300 dark:bg-red-900/20 rounded-lg">{{ store.lastError }}</div>
            </div>
          </div>

          <!-- Right: Results -->
          <div class="flex-1 flex flex-col bg-surface-1 overflow-hidden">
            <div class="flex items-center justify-between px-4 py-2.5 border-b border-surface-3 bg-surface-0">
              <div class="flex items-center gap-2">
                <h3 class="text-xs font-semibold text-text-primary">生成结果</h3>
                <template v-if="selectMode">
                  <span class="text-[10px] text-text-tertiary">{{ selectedIds.size }} 项已选</span>
                  <button @click="toggleSelectAll" class="text-[10px] text-primary-600 hover:text-primary-700">{{ pagedGenerations.length > 0 && pagedGenerations.every(g => selectedIds.has(g.id)) ? '取消本页全选' : '本页全选' }}</button>
                  <button v-if="selectedIds.size > 0" @click="deleteSelected" class="text-[10px] text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300">删除所选</button>
                </template>
              </div>
              <div class="flex items-center gap-1">
                <button
                  v-if="failedCount > 0 && !selectMode"
                  @click="clearFailedGenerations"
                  class="px-2 py-1 rounded text-[10px] text-red-500 hover:text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/20 transition-colors flex items-center gap-1"
                  :title="`清理 ${failedCount} 条失败记录`"
                >
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165" /></svg>
                  <span>清理失败 ({{ failedCount }})</span>
                </button>
                <button v-if="sortedGenerations.length" @click="toggleSelectMode" :class="['p-1.5 rounded text-[10px]', selectMode ? 'bg-primary-100 text-primary-600' : 'text-text-tertiary hover:text-text-secondary']" :title="selectMode ? '退出选择' : '选择'">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                </button>
                <button @click="viewMode = 'grid'" :class="['p-1.5 rounded', viewMode === 'grid' ? 'bg-surface-2 text-text-primary' : 'text-text-tertiary hover:text-text-secondary']">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" /></svg>
                </button>
                <button @click="viewMode = 'list'" :class="['p-1.5 rounded', viewMode === 'list' ? 'bg-surface-2 text-text-primary' : 'text-text-tertiary hover:text-text-secondary']">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" /></svg>
                </button>
              </div>
            </div>
            <div class="flex-1 overflow-y-auto p-4">
              <div v-if="!sortedGenerations.length && !store.generating" class="flex-1 flex flex-col items-center justify-center py-20">
                <div class="w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
                  <svg class="w-8 h-8 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" /></svg>
                </div>
                <p class="text-sm font-medium text-text-secondary mb-1">开始创作你的图片</p>
                <p class="text-xs text-text-tertiary">在左侧配置面板输入提示词进行生图</p>
              </div>

              <!-- Grid view -->
              <div v-else-if="viewMode === 'grid'" class="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                <div v-for="gen in pagedGenerations" :key="gen.id" :class="['group relative rounded-xl overflow-hidden border bg-surface-0 shadow-sm hover:shadow-md transition-shadow', selectedIds.has(gen.id) ? 'border-primary-500 ring-1 ring-primary-500' : 'border-surface-3']" @click="selectMode ? toggleSelect(gen.id) : null">
                  <div v-if="selectMode" class="absolute top-1.5 left-1.5 z-10">
                    <div :class="['w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors', selectedIds.has(gen.id) ? 'bg-primary-600 border-primary-600' : 'bg-white/80 border-surface-4']">
                      <svg v-if="selectedIds.has(gen.id)" class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="m4.5 12.75 6 6 9-13.5" /></svg>
                    </div>
                  </div>
                  <button v-if="!selectMode" @click.stop="deleteSingle(gen.id)" class="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 w-6 h-6 rounded-full bg-black/40 hover:bg-red-500 text-white flex items-center justify-center transition-all" title="删除">
                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
                  </button>
                  <div v-if="gen.status === 'done' && gen.result_path" class="aspect-square relative">
                    <img :src="localFileUrl(gen.result_path, true)" loading="lazy" decoding="async" class="w-full h-full object-cover cursor-pointer" @click.stop="selectMode ? toggleSelect(gen.id) : openDetail(gen)" />
                    <div v-if="gen.ai_mark_removed && !selectMode" class="absolute top-1.5 left-1.5 z-10 pointer-events-none"><ProcessedBadge /></div>
                    <div v-if="!selectMode" class="absolute bottom-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button @click.stop="copyImage(gen.result_path)" class="w-7 h-7 rounded-lg bg-black/50 hover:bg-black/70 text-white flex items-center justify-center" title="复制图片">
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" /></svg>
                      </button>
                      <button @click.stop="openInChat(gen.result_path)" class="w-7 h-7 rounded-lg bg-black/50 hover:bg-black/70 text-white flex items-center justify-center" title="用这张图开对话">
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" /></svg>
                      </button>
                      <button @click.stop="editImage(gen.id)" class="w-7 h-7 rounded-lg bg-black/50 hover:bg-black/70 text-white flex items-center justify-center" title="编辑">
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>
                      </button>
                      <button
                        @click.stop="askRegenerate(gen)"
                        class="w-7 h-7 rounded-lg bg-black/50 hover:bg-black/70 text-white flex items-center justify-center"
                        title="重新生成"
                      >
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.36L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.5 6.36L3 16" /><path d="M3 21v-5h5" /></svg>
                      </button>
                    </div>
                  </div>
                  <div v-else-if="gen.status === 'generating' || gen.status === 'pending' || gen.status === 'canceling'" class="aspect-square flex flex-col items-center justify-center gap-2 bg-surface-2">
                    <svg class="w-8 h-8 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                    <button
                      v-if="gen.status === 'canceling'"
                      disabled
                      class="px-2 py-0.5 text-[10px] text-text-tertiary border border-surface-4 rounded-md cursor-not-allowed"
                    >中止中…</button>
                    <button
                      v-else
                      @click.stop="cancelGen(gen.id)"
                      class="px-2 py-0.5 text-[10px] text-red-600 border border-red-300 rounded-md hover:bg-red-50 dark:text-red-300 dark:border-red-800 dark:hover:bg-red-900/30 transition-colors"
                    >中止</button>
                  </div>
                  <div v-else-if="gen.status === 'canceled'" class="aspect-square flex flex-col items-center justify-center bg-surface-2 p-3">
                    <svg class="w-6 h-6 text-text-tertiary mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                    <p class="text-[10px] text-text-tertiary text-center">已手动中止</p>
                    <div class="mt-1.5 flex items-center gap-1">
                      <button
                        type="button"
                        @click.stop="askRegenerate(gen)"
                        class="px-2 py-0.5 text-[10px] text-primary-700 border border-primary-300 rounded-md hover:bg-primary-50 transition-colors"
                      >重新生成</button>
                    </div>
                  </div>
                  <div v-else-if="gen.status === 'error'" class="aspect-square flex flex-col items-center justify-center bg-red-50 dark:bg-red-900/20 p-3">
                    <svg class="w-6 h-6 text-red-400 dark:text-red-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" /></svg>
                    <p class="text-[10px] text-red-500 dark:text-red-300 text-center line-clamp-2">{{ translateError(gen.error) }}</p>
                    <div class="mt-1.5 flex items-center gap-1">
                      <button
                        type="button"
                        @click.stop="openErrorDialog(gen)"
                        class="px-2 py-0.5 text-[10px] text-red-600 border border-red-300 rounded-md hover:bg-red-100 dark:text-red-300 dark:border-red-800 dark:hover:bg-red-900/30 transition-colors"
                      >详情</button>
                      <button
                        type="button"
                        @click.stop="askRegenerate(gen)"
                        class="px-2 py-0.5 text-[10px] text-primary-700 border border-primary-300 rounded-md hover:bg-primary-50 transition-colors"
                      >重新生成</button>
                    </div>
                  </div>
                  <div class="p-2.5">
                    <p class="text-[11px] text-text-secondary line-clamp-2">{{ gen.prompt }}</p>
                    <div class="flex items-center justify-between mt-1.5">
                      <span class="text-[10px] text-text-tertiary">{{ modelStore.formatModelLabel(gen.model_provider_id, gen.model_id) }} / {{ gen.size }}</span>
                      <button v-if="gen.status === 'done' && gen.result_path" @click.stop="openFolder(gen.result_path)" class="opacity-0 group-hover:opacity-100 p-1 text-text-tertiary hover:text-text-primary transition-opacity" title="打开所在目录">
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" /></svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- List view -->
              <div v-else class="space-y-2">
                <div v-for="gen in pagedGenerations" :key="gen.id" :class="['flex gap-3 p-3 rounded-xl border bg-surface-0 group hover:shadow-sm transition-shadow', selectedIds.has(gen.id) ? 'border-primary-500 ring-1 ring-primary-500' : 'border-surface-3']" @click="selectMode ? toggleSelect(gen.id) : null">
                  <div v-if="selectMode" class="flex items-center pr-1">
                    <div :class="['w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors', selectedIds.has(gen.id) ? 'bg-primary-600 border-primary-600' : 'border-surface-4']">
                      <svg v-if="selectedIds.has(gen.id)" class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="m4.5 12.75 6 6 9-13.5" /></svg>
                    </div>
                  </div>
                  <div class="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-surface-2">
                    <img v-if="gen.status === 'done' && gen.result_path" :src="localFileUrl(gen.result_path, true)" loading="lazy" decoding="async" class="w-full h-full object-cover cursor-pointer" @click.stop="selectMode ? toggleSelect(gen.id) : openDetail(gen)" />
                    <div v-else-if="gen.status === 'generating' || gen.status === 'pending' || gen.status === 'canceling'" class="w-full h-full flex items-center justify-center">
                      <svg class="w-5 h-5 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                    </div>
                    <div v-else-if="gen.status === 'canceled'" class="w-full h-full flex items-center justify-center">
                      <svg class="w-5 h-5 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                    </div>
                    <div v-else class="w-full h-full flex items-center justify-center bg-red-50 dark:bg-red-900/20">
                      <svg class="w-5 h-5 text-red-400 dark:text-red-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" /></svg>
                    </div>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-xs text-text-primary line-clamp-2">{{ gen.prompt }}</p>
                    <p v-if="gen.revised_prompt" class="text-[10px] text-text-tertiary mt-1 line-clamp-1">{{ gen.revised_prompt }}</p>
                    <div class="flex items-center gap-3 mt-1.5">
                      <span class="text-[10px] text-text-tertiary">{{ modelStore.formatModelLabel(gen.model_provider_id, gen.model_id) }}</span>
                      <span class="text-[10px] text-text-tertiary">{{ gen.size }}</span>
                      <span :class="['text-[10px]', gen.status === 'done' ? 'text-green-600 dark:text-green-400' : gen.status === 'error' ? 'text-red-500 dark:text-red-400' : 'text-text-tertiary']">{{ statusLabel(gen.status) }}</span>
                    </div>
                    <p v-if="gen.status === 'error'" class="text-[10px] text-red-500 dark:text-red-400 mt-1 line-clamp-2">{{ translateError(gen.error) }}</p>
                    <div v-if="gen.status === 'error'" class="mt-1 flex items-center gap-1">
                      <button
                        type="button"
                        @click.stop="openErrorDialog(gen)"
                        class="px-1.5 py-0.5 text-[10px] text-red-600 border border-red-300 rounded-md hover:bg-red-50 dark:text-red-300 dark:border-red-800 dark:hover:bg-red-900/20 transition-colors"
                      >详情</button>
                      <button
                        type="button"
                        @click.stop="askRegenerate(gen)"
                        class="px-1.5 py-0.5 text-[10px] text-primary-700 border border-primary-300 rounded-md hover:bg-primary-50 transition-colors"
                      >重新生成</button>
                    </div>
                  </div>
                  <div v-if="!selectMode" class="flex items-start gap-1">
                    <button
                      v-if="gen.status === 'generating' || gen.status === 'pending'"
                      @click.stop="cancelGen(gen.id)"
                      class="p-1.5 text-red-500 hover:text-red-600 rounded-lg hover:bg-surface-2 transition-all"
                      title="中止生成"
                    >
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                    </button>
                    <span v-else-if="gen.status === 'canceling'" class="p-1.5 text-[10px] text-text-tertiary whitespace-nowrap">中止中…</span>
                    <button
                      @click.stop="askRegenerate(gen)"
                      class="opacity-0 group-hover:opacity-100 p-1.5 text-text-tertiary hover:text-primary-600 rounded-lg hover:bg-surface-2 transition-all"
                      title="重新生成"
                    >
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.36L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.5 6.36L3 16" /><path d="M3 21v-5h5" /></svg>
                    </button>
                    <button v-if="gen.status === 'done' && gen.result_path" @click.stop="copyImage(gen.result_path)" class="opacity-0 group-hover:opacity-100 p-1.5 text-text-tertiary hover:text-primary-600 rounded-lg hover:bg-surface-2 transition-all" title="复制图片">
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" /></svg>
                    </button>
                    <button v-if="gen.status === 'done' && gen.result_path" @click.stop="openInChat(gen.result_path)" class="opacity-0 group-hover:opacity-100 p-1.5 text-text-tertiary hover:text-primary-600 rounded-lg hover:bg-surface-2 transition-all" title="用这张图开对话">
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" /></svg>
                    </button>
                    <button v-if="gen.status === 'done' && gen.result_path" @click.stop="editImage(gen.id)" class="opacity-0 group-hover:opacity-100 p-1.5 text-text-tertiary hover:text-primary-600 rounded-lg hover:bg-surface-2 transition-all" title="编辑">
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>
                    </button>
                    <button v-if="gen.status === 'done' && gen.result_path" @click.stop="openFolder(gen.result_path)" class="opacity-0 group-hover:opacity-100 p-1.5 text-text-tertiary hover:text-text-primary rounded-lg hover:bg-surface-2 transition-all" title="打开所在目录">
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" /></svg>
                    </button>
                    <button @click.stop="deleteSingle(gen.id)" class="opacity-0 group-hover:opacity-100 p-1.5 text-text-tertiary hover:text-red-500 rounded-lg hover:bg-surface-2 transition-all" title="删除">
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Pagination -->
              <div v-if="totalPages > 1" class="flex items-center justify-center gap-1 pt-4 pb-2">
                <button
                  @click="goToPage(1)"
                  :disabled="currentPage === 1"
                  class="px-2 py-1 text-[11px] rounded border border-surface-3 bg-surface-0 text-text-secondary hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="首页"
                >«</button>
                <button
                  @click="goToPage(currentPage - 1)"
                  :disabled="currentPage === 1"
                  class="px-2 py-1 text-[11px] rounded border border-surface-3 bg-surface-0 text-text-secondary hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="上一页"
                >‹</button>
                <span class="px-2 py-1 text-[11px] text-text-secondary">
                  第 <input
                    type="number"
                    :value="currentPage"
                    @change="(e) => goToPage(parseInt((e.target as HTMLInputElement).value) || 1)"
                    :min="1"
                    :max="totalPages"
                    class="w-12 px-1 py-0.5 text-center text-[11px] border border-surface-3 rounded bg-surface-0 outline-none focus:ring-1 focus:ring-primary-500"
                  /> / {{ totalPages }} 页
                  <span class="text-text-tertiary ml-2">共 {{ store.total }} 条</span>
                </span>
                <button
                  @click="goToPage(currentPage + 1)"
                  :disabled="currentPage === totalPages"
                  class="px-2 py-1 text-[11px] rounded border border-surface-3 bg-surface-0 text-text-secondary hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="下一页"
                >›</button>
                <button
                  @click="goToPage(totalPages)"
                  :disabled="currentPage === totalPages"
                  class="px-2 py-1 text-[11px] rounded border border-surface-3 bg-surface-0 text-text-secondary hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="末页"
                >»</button>
              </div>
            </div>
          </div>
  </div>

  <!-- Toast -->
  <div v-if="copyToast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-surface-0 shadow-lg border border-surface-3 text-xs text-text-primary">{{ copyToast }}</div>

  <SavePresetModal
    :open="savePresetOpen"
    type="image_gen"
    :content="savePresetContent"
    @close="savePresetOpen = false"
    @saved="onPresetSaved"
  />

  <!-- Preset Prompt Modal -->
  <div v-if="showPresetPopup" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="showPresetPopup = false">
    <div class="w-[480px] max-h-[70vh] bg-surface-0 border border-surface-3 rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] flex flex-col">
      <div class="flex items-center justify-between px-5 py-3.5 border-b border-surface-3">
        <h3 class="text-sm font-semibold text-text-primary">预设提示词</h3>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="text-[11px] text-primary-600 hover:text-primary-700"
            @click="goManagePresets"
          >管理</button>
          <button @click="showPresetPopup = false" class="p-1 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto p-4 space-y-4">
        <div v-for="cat in promptPresets" :key="cat.id">
          <div class="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">{{ cat.name }}</div>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="item in cat.items"
              :key="item.id"
              @click="prompt = item.content; showPresetPopup = false"
              class="text-left p-3 rounded-xl border border-surface-3 hover:border-primary-400 hover:bg-primary-50 transition-colors"
            >
              <div class="text-xs font-medium text-text-primary mb-1">{{ item.label }}</div>
              <div class="text-[10px] text-text-tertiary line-clamp-2">{{ item.content }}</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Image Preview -->
  <ImageLightbox
    :src="previewImage"
    :ref-images="previewRefImages"
    :on-copy="copyPreviewImage"
    :on-locate="locatePreviewImage"
    @close="closePreview"
  />

  <CreationDetailModal
    v-if="detailItem"
    :item="detailItem"
    :image-src="detailItem.result_path ? localFileUrl(detailItem.result_path) : ''"
    :model-label="modelStore.formatModelLabel(detailItem.model_provider_id, detailItem.model_id)"
    :created-at-label="formatDate(detailItem.created_at)"
    show-regenerate
    @close="detailItem = null"
    @preview="previewDetailItem"
    @copy-image="copyDetailImage"
    @edit="editDetailItem"
    @open-folder="openDetailFolder"
    @reuse-prompt="useDetailPrompt"
    @reuse-revised-prompt="useDetailRevisedPrompt"
    @regenerate="regenerateDetailItem"
    @delete="deleteDetailItem"
    @copy-prompt="copyText(detailItem.prompt)"
    @copy-revised-prompt="copyText(detailItem.revised_prompt)"
    @open-in-chat="detailItem.result_path && openInChat(detailItem.result_path)"
    @save-preset="detailItem?.prompt && openSavePreset(detailItem.prompt)"
  />

  <!-- Error detail dialog -->
  <ErrorDetailDialog
    :visible="errorDialog.visible"
    :raw-error="errorDialog.rawError"
    :raw-request="errorDialog.rawRequest"
    title="生成失败详情"
    @close="errorDialog.visible = false"
  />

  <!-- Regenerate confirm dialog -->
  <ConfirmDialog
    :visible="confirmDialog.visible"
    title="重新生成"
    message="将以原记录的参数再生成一条新记录，是否继续？"
    confirm-text="重新生成"
    @confirm="confirmRegenerate"
    @cancel="cancelRegenerate"
  />
  <GalleryPicker v-model:visible="showGalleryPicker" :multiple="true" mode="creation-reference" @select="onGalleryRefSelect" />
  <LowBalanceModal
    v-model:visible="lowBalanceOpen"
    :balance-type="lowBalanceState.balanceType"
    :required="lowBalanceState.required"
    :available="lowBalanceState.available"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { useImageGenStore } from '@/stores/image-gen'
import { useImageGenFormStore } from '@/stores/image-gen-form'
import { useModelStore } from '@/stores/models'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useSiteConfigStore } from '@/stores/site-config'
import { CLOUD_KEY_SEP, stripModelId } from '@shared/model-id'
import { usePromptPresetStore } from '@/stores/prompt-presets'
import { useHandoffStore } from '@/stores/handoff'
import { translateError } from '@/utils/error-message'
import { recordUsage, warmHintsCache } from '@/utils/model-usage-hints'
import { resolveStudioModel } from '@/utils/image-gen-models'
import ImageSizePicker from '@/components/ImageSizePicker.vue'
import ResolutionTierPicker from '@/components/ResolutionTierPicker.vue'
import QualityPicker from '@/components/QualityPicker.vue'
import ProcessedBadge from '@/components/ProcessedBadge.vue'
import { DEFAULT_QUALITY_ID, hasQualityOptions } from '@shared/image-size'
import { stripImageMetadata } from '@shared/strip-image-metadata'
import ErrorDetailDialog from '@/components/ErrorDetailDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import GalleryPicker from '@/components/GalleryPicker.vue'
import ImageLightbox from '@/components/ImageLightbox.vue'
import CreationDetailModal from '@/components/CreationDetailModal.vue'
import ConsumptionEstimate from '@/components/ConsumptionEstimate.vue'
import LowBalanceModal from '@/components/LowBalanceModal.vue'
import PromptTextarea from '@/components/PromptTextarea.vue'
import StylePresetPicker from '@/components/StylePresetPicker.vue'
import WorkspaceBrandChip from '@/components/WorkspaceBrandChip.vue'
import ChatModelSwitcher from '@/components/ChatModelSwitcher.vue'
import SavePresetModal from '@/components/SavePresetModal.vue'
import { useStylePresetStore } from '@/stores/style-presets'
import { composePromptWithStyle } from '@shared/style-prompt'
import type { ImageGeneration } from '@/stores/image-gen'
import { IMAGE_PROMPT_MAX_LENGTH } from '@shared/prompt-limits'
import { fetchBrandOptimizeAddon } from '@/utils/brand-optimize'
import { detectPromptLang } from '@/utils/prompt-lang'

const route = useRoute()
const router = useRouter()
const store = useImageGenStore()
const handoff = useHandoffStore()
const modelStore = useModelStore()
const cloudAuth = useCloudAuthStore()
const siteConfigStore = useSiteConfigStore()
const presetStore = usePromptPresetStore()

// 会话级表单草稿：路由切换不丢，重启 app 后重置
const formStore = useImageGenFormStore()
const {
  prompt,
  refImages,
  selectedProviderId,
  selectedModelId,
  optimizeProviderId,
  optimizeModelId,
  selectedSize,
  selectedTier,
  selectedQuality,
  batchCount,
  stylePresetId,
  viewMode,
} = storeToRefs(formStore)

// 风格预设：选中风格的提示词片段（失效 id 自动降级为空串 = 无风格）
const stylePresetStore = useStylePresetStore()
const styleFragment = computed(() => stylePresetStore.byId(stylePresetId.value)?.prompt_fragment || '')

// 错误详情弹窗：仅存原文 + 原始请求快照（已脱敏 JSON），友好翻译由 ErrorDetailDialog 内部派生。
// rawRequest 仅主进程在 status='error' 路径写入，历史失败记录可能为空
const errorDialog = ref<{ visible: boolean; rawError: string; rawRequest: string }>({
  visible: false,
  rawError: '',
  rawRequest: ''
})
function openErrorDialog(gen: Pick<ImageGeneration, 'error' | 'raw_request'>) {
  errorDialog.value = {
    visible: true,
    rawError: gen.error || '',
    rawRequest: gen.raw_request || ''
  }
}

// 确认弹窗：避免误点直接触发重新生成
const confirmDialog = ref<{ visible: boolean; pending: ImageGeneration | null }>({
  visible: false,
  pending: null
})
function askRegenerate(gen: ImageGeneration) {
  confirmDialog.value = { visible: true, pending: gen }
}
function confirmRegenerate() {
  const gen = confirmDialog.value.pending
  confirmDialog.value = { visible: false, pending: null }
  if (!gen) return
  regenerate(gen)
}
function cancelRegenerate() {
  confirmDialog.value = { visible: false, pending: null }
}

// 重新生成：以原记录的参数再生成一条新的生成记录，原记录保留供对比
function regenerate(gen: ImageGeneration) {
  if (!ensureEnoughBalance(gen.model_provider_id, gen.model_id, 1)) return
  store.enqueue({
    prompt: gen.prompt,
    refImages: gen.ref_images || [],
    modelProviderId: gen.model_provider_id,
    modelId: gen.model_id,
    size: gen.size,
    tierId: gen.tier_id || undefined,
    quality: gen.quality,
    batchCount: 1,
    applyWorkspaceBrand: true
  })
}

const promptPresets = computed(() => presetStore.visibleGrouped('image_gen'))

function localFileUrl(path: string, thumb = false): string {
  // 兼容旧绝对路径数据：以盘符或 / 开头视为绝对路径
  const isAbsolute = /^[A-Za-z]:|^\//.test(path)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://img?' + param + '=' + encodeURIComponent(path) + (thumb ? `&thumb=1&v=${thumbnailVersion.value}` : '')
}

async function preloadThumbnailsForGenerations(generations: ImageGeneration[]) {
  const paths = generations
    .filter((gen) => gen.status === 'done' && !!gen.result_path)
    .map((gen) => gen.result_path)
  if (!paths.length) return
  try {
    await (window as any).api.imageGen.invoke('preloadThumbnails', JSON.parse(JSON.stringify(paths)))
    thumbnailVersion.value++
  } catch (e) {
    console.error('Failed to preload thumbnails:', e)
  }
}

// selectedModelId 可能是复合 key `gpt-image-2#@多米`，Picker / supports* 都按纯关键字匹配，必须 strip
// 后才能正确识别型号专属参数（如 gpt-image-2 的 size/tier/quality 选项）。
const pureSelectedModelId = computed(() => stripModelId(selectedModelId.value))
const previewImage = ref<string | null>(null)
const previewPath = ref<string>('')
const previewRefImages = ref<string[]>([])
const thumbnailVersion = ref(0)
const detailItem = ref<ImageGeneration | null>(null)
const optimizing = ref(false)
const optimizeError = ref('')
const showPresetPopup = ref(false)
const savePresetOpen = ref(false)
const savePresetContent = ref('')

function openSavePreset(text: string) {
  const content = String(text || '').trim()
  if (!content) return
  savePresetContent.value = content
  savePresetOpen.value = true
}

function onPresetSaved() {
  copyToast.value = '已存为预设'
  setTimeout(() => { copyToast.value = '' }, 2000)
}

function goManagePresets() {
  showPresetPopup.value = false
  router.push({ path: '/prompts', query: { type: 'image_gen' } })
}
const selectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const lowBalanceOpen = ref(false)
const lowBalanceState = ref({ balanceType: 'credit', required: 0, available: 0 })

function toggleSelectMode() {
  selectMode.value = !selectMode.value
  if (!selectMode.value) selectedIds.value = new Set()
}

function toggleSelect(id: string) {
  const s = new Set(selectedIds.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selectedIds.value = s
}

function toggleSelectAll() {
  // Select / deselect items on the CURRENT page only (standard paginated UX)
  const pageIds = pagedGenerations.value.map(g => g.id)
  const allSelected = pageIds.every(id => selectedIds.value.has(id))
  const next = new Set(selectedIds.value)
  if (allSelected) {
    pageIds.forEach(id => next.delete(id))
  } else {
    pageIds.forEach(id => next.add(id))
  }
  selectedIds.value = next
}

/**
 * 判断一个 generation 是否处于“还在跑”状态。generating / pending 时后端 worker 可能还在调用上游，
 * 这时删后端 row 会产生孤儿状态：worker 后续的 progress 事件会重新把该 generation 插回 items，
 * 与“已被删除”语义冲突。遇到这种只隐藏占位卡。
 */
function isInFlightStatus(s: string): boolean {
  return s === 'generating' || s === 'pending' || s === 'canceling'
}

/** 手动中止一个生成中的任务：主进程会断开上游请求 / 停止轮询。计费不返还。 */
function cancelGen(genId: string) {
  store.cancelGeneration(genId)
}

/** 生成状态的中文展示 */
function statusLabel(s: string): string {
  const map: Record<string, string> = {
    done: '已完成', error: '失败', generating: '生成中',
    pending: '等待中', canceled: '已取消', canceling: '中止中'
  }
  return map[s] || s
}

async function deleteSelected() {
  if (!selectedIds.value.size) return
  const ids = [...selectedIds.value]
  // 拆分：还在跑的仅隐藏占位；完成/失败的走后端删除
  const inFlightIds: string[] = []
  const persistedIds: string[] = []
  for (const id of ids) {
    const gen = store.displayList.find(g => g.id === id)
    if (gen && isInFlightStatus(gen.status)) {
      inFlightIds.push(id)
    } else {
      persistedIds.push(id)
    }
  }
  if (inFlightIds.length) store.dismissInFlight(inFlightIds)
  if (persistedIds.length) await store.deleteGenerations(persistedIds)
  selectedIds.value = new Set()
  if (!store.displayList.length) selectMode.value = false
  await refreshFailedCount()
  // 删完当前页则回退到最后一页或第一页
  if (!store.items.length && store.total > 0) {
    const target = Math.max(1, Math.min(store.currentPage, Math.ceil(store.total / PAGE_SIZE)))
    await store.fetchPage(target, PAGE_SIZE)
  }
}

async function deleteSingle(id: string) {
  const gen = store.displayList.find(g => g.id === id)
  if (gen && isInFlightStatus(gen.status)) {
    // 生成中/排队中的占位卡：仅隐藏，不动后端与磁盘，避免后端 worker 完成后出现“幽灵卡”
    store.dismissInFlight([id])
    return
  }
  await store.deleteGeneration(id)
  await refreshFailedCount()
}

const hasRefImages = computed(() => refImages.value.length > 0)
const qualitiesAvailable = computed(() => hasQualityOptions(pureSelectedModelId.value))

// Result list — 后端分页，25 条/页
const PAGE_SIZE = 25

/** 分页状态均来自 store（单一真源），避免与背后数据不同步 */
const currentPage = computed(() => store.currentPage)
const totalPages = computed(() => Math.max(1, Math.ceil(store.total / PAGE_SIZE)))

/** 当前页展示列表：inFlight 置顶 + 当前页 items。
 * 保留 pagedGenerations / sortedGenerations 的名字供模板不改动。 */
const pagedGenerations = computed(() => store.displayList)
const sortedGenerations = pagedGenerations
watch(
  () => store.displayList
    .filter((gen) => gen.status === 'done' && !!gen.result_path)
    .map((gen) => `${gen.id}:${gen.result_path}`)
    .join('|'),
  () => preloadThumbnailsForGenerations(store.displayList)
)

/** 失败计数：全局读 db，不仅限当前页。生成/删除后手动调一次 refreshFailedCount() */
const failedCount = ref(0)
async function refreshFailedCount() {
  try {
    failedCount.value = (await (window as any).api.imageGen.invoke('countFailedGenerations')) as number
  } catch (e) {
    console.error('Failed to count failed generations:', e)
  }
}

async function goToPage(p: number) {
  const target = Math.max(1, Math.min(totalPages.value, p))
  if (target === currentPage.value) return
  selectedIds.value = new Set()
  await store.fetchPage(target, PAGE_SIZE)
}

async function clearFailedGenerations() {
  if (!failedCount.value) return
  if (!confirm(`确定清理 ${failedCount.value} 条失败记录？此操作不可恢复。`)) return
  await (window as any).api.imageGen.invoke('clearFailedGenerations')
  // 清除当前 inFlight 中的失败项（依赖 store 内部逻辑难以做到，先在 UI 层直接筛除后侍 store 后续优化）
  selectedIds.value = new Set()
  await Promise.all([store.fetchPage(currentPage.value, PAGE_SIZE), refreshFailedCount()])
}

const selectedProvider = computed(() =>
  modelStore.providers.find(p => p.id === selectedProviderId.value) || null
)
// 多米官方 /v1/images/generations?async=true 仍在适配中：当前 image[] base64 dataURI 协议在
// 部分图上触发上游 `fail_to_submit_task`，UI 层先临时禁用参考图入口，避免用户撞坑。
// 行为：禁用「添加 / 图库」两个按钮 + 顶部展示提示文本；已上传的参考图保留，用户可自行删除。
const isDuomiProvider = computed(() => selectedProvider.value?.type === 'duomi')

function onImageModelPick(val: { provider_id: string; model_id: string }) {
  selectedProviderId.value = val.provider_id
  selectedModelId.value = val.model_id
}

function onOptimizeModelPick(val: { provider_id: string; model_id: string }) {
  optimizeProviderId.value = val.provider_id
  optimizeModelId.value = val.model_id
}

const canGenerate = computed(() =>
  // 长度按拼接风格片段后的最终提示词计，避免贴上限时带风格提交被主进程断言打回
  prompt.value.trim() && composePromptWithStyle(prompt.value, styleFragment.value).length <= IMAGE_PROMPT_MAX_LENGTH && selectedProviderId.value && selectedModelId.value
)

const imageEstimate = computed(() => estimateImageCost(selectedProviderId.value, selectedModelId.value, batchCount.value))

const OPTIMIZE_CN_PROMPT = `你是一个专业的 AI 图片生成提示词工程师。请将以下描述优化为高质量的中文生图提示词。

优化要求：
1. 保持原始创意意图不变
2. 补充画面构图、光影、色调、风格等专业描述
3. 增加细节描述（材质、纹理、氛围等）
4. 结构清晰，主体描述在前，风格修饰在后
5. 控制在 200 字以内

请直接输出优化后的提示词，不要包含任何解释。`

const OPTIMIZE_EN_PROMPT = `You are a professional AI image generation prompt engineer. Optimize the following description into a high-quality English image generation prompt.

Requirements:
1. Preserve the original creative intent
2. Add composition, lighting, color tone, and style descriptors
3. Include detail descriptions (materials, textures, atmosphere)
4. Structure: subject first, then style modifiers
5. Keep within 200 words

Output only the optimized prompt, no explanations.`

async function optimizePrompt() {
  if (!prompt.value.trim() || !optimizeProviderId.value || !optimizeModelId.value) return
  const lang = detectPromptLang(prompt.value)
  optimizing.value = true
  try {
    const systemPrompt =
      (lang === 'cn' ? OPTIMIZE_CN_PROMPT : OPTIMIZE_EN_PROMPT) +
      (await fetchBrandOptimizeAddon(prompt.value))
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt.value }
    ]
    // 保留复合 key 传给 main，main 端按服务商反查 cloud_model_id 精确路由
    const result = await (window as any).api.llm.invoke('call', optimizeProviderId.value, optimizeModelId.value, messages)
    if (result) prompt.value = result
    await recordUsage('chat', optimizeProviderId.value, optimizeModelId.value)
  } catch (e: any) {
    optimizeError.value = translateError(e.message || '')
    setTimeout(() => { optimizeError.value = '' }, 5000)
  } finally {
    optimizing.value = false
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

async function pickRefImage() {
  try {
    const result = await (window as any).api.dialog.openFile({
      title: '选择参考图片',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || !result.filePaths.length) return

    for (const filePath of result.filePaths) {
      if (refImages.value.length >= 10) break
      const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
      const raw = await (window as any).api.chat.invoke('readFileBase64', filePath)
      const dataUri = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${raw}`
      const compressed = await compressImage(dataUri, 1024, 0.8)
      refImages.value.push(compressed)
    }
  } catch (e) {
    console.error('Failed to pick ref image:', e)
  }
}

const showGalleryPicker = ref(false)

async function onGalleryRefSelect(paths: string[]) {
  if (!paths.length) return
  try {
    for (const filePath of paths) {
      if (refImages.value.length >= 10) break
      const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
      const raw = await (window as any).api.chat.invoke('readFileBase64', filePath)
      const dataUri = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${raw}`
      const compressed = await compressImage(dataUri, 1024, 0.8)
      refImages.value.push(compressed)
    }
  } catch (e) {
    console.error('Failed to load gallery ref images:', e)
  }
}

function doGenerate() {
  if (!canGenerate.value) return
  if (!ensureEnoughBalance(selectedProviderId.value, selectedModelId.value, batchCount.value)) return
  store.enqueue({
    // 风格片段拼到提示词尾部（隐式拼接，输入框只保留用户原文）
    prompt: composePromptWithStyle(prompt.value, styleFragment.value),
    refImages: refImages.value.length ? refImages.value : undefined,
    modelProviderId: selectedProviderId.value,
    modelId: selectedModelId.value,
    size: selectedSize.value,
    tierId: selectedTier.value,
    quality: hasRefImages.value ? DEFAULT_QUALITY_ID : selectedQuality.value,
    batchCount: batchCount.value,
    applyWorkspaceBrand: true
  })
  recordUsage('image', selectedProviderId.value, selectedModelId.value)
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

function estimateImageCost(providerId: string, modelKey: string, count: number): { balanceType: string; amount: number } {
  const rule = effectiveBillingRule(providerId, modelKey)
  if (!rule) return { balanceType: 'credit', amount: 0 }
  return {
    balanceType: 'credit',
    amount: Number(rule.credit_per_call || 0) * Math.max(1, Number(count || 1)),
  }
}

function availableBalance(type: string): number {
  return Number(cloudAuth.quotas?.balances?.[type]?.total
    ?? cloudAuth.balances.find((b) => b.type === type)?.amount
    ?? 0)
}

function ensureEnoughBalance(providerId: string, modelKey: string, count: number): boolean {
  const estimate = estimateImageCost(providerId, modelKey, count)
  if (estimate.amount <= 0) return true
  const available = availableBalance(estimate.balanceType)
  if (available + 0.000001 >= estimate.amount) return true
  lowBalanceState.value = {
    balanceType: estimate.balanceType,
    required: estimate.amount,
    available,
  }
  lowBalanceOpen.value = true
  return false
}

const copyToast = ref('')

async function copyImage(path: string) {
  try {
    const res = await window.api.clipboard.writeImage(path)
    if (res.success) {
      copyToast.value = '已复制到剪贴板'
    } else {
      copyToast.value = '复制失败: ' + (res.error || '')
    }
  } catch (e: any) {
    copyToast.value = '复制失败'
  }
  setTimeout(() => { copyToast.value = '' }, 2000)
}

function editImage(genId: string) {
  router.push(`/image-edit/${genId}`)
}

async function openInChat(resultPath: string) {
  try {
    const abs = (await (window as any).api.imageGen.invoke('getAbsolutePath', resultPath)) as string
    if (!abs) return
    handoff.set('chatBrandAttachments', { paths: [abs] })
    router.push({ name: 'chat', query: { new: '1' } })
  } catch (e) {
    console.warn('[image-gen] openInChat failed:', e)
  }
}

function openFolder(path: string) {
  ;(window as any).api.shell.showItemInFolder(path)
}

function openPreview(path: string, refImages?: string[]) {
  previewPath.value = path
  previewImage.value = localFileUrl(path)
  previewRefImages.value = refImages && refImages.length > 0 ? [...refImages] : []
}

function openDetail(gen: ImageGeneration) {
  if (gen.status !== 'done' || !gen.result_path) return
  detailItem.value = gen
}

function previewDetailItem() {
  if (!detailItem.value?.result_path) return
  openPreview(detailItem.value.result_path, detailItem.value.ref_images)
}

function copyDetailImage() {
  if (!detailItem.value?.result_path) return
  copyImage(detailItem.value.result_path)
}

function editDetailItem() {
  if (!detailItem.value) return
  editImage(detailItem.value.id)
}

function openDetailFolder() {
  if (!detailItem.value?.result_path) return
  openFolder(detailItem.value.result_path)
}

function useDetailPrompt() {
  if (!detailItem.value) return
  prompt.value = detailItem.value.prompt
  refImages.value = detailItem.value.ref_images?.slice(0, 10) || []
  if (detailItem.value.size) selectedSize.value = detailItem.value.size
  detailItem.value = null
}

function useDetailRevisedPrompt() {
  if (!detailItem.value?.revised_prompt) return
  prompt.value = detailItem.value.revised_prompt
  refImages.value = detailItem.value.ref_images?.slice(0, 10) || []
  if (detailItem.value.size) selectedSize.value = detailItem.value.size
  detailItem.value = null
}

function regenerateDetailItem() {
  if (!detailItem.value) return
  askRegenerate(detailItem.value)
}

async function deleteDetailItem() {
  if (!detailItem.value) return
  const id = detailItem.value.id
  detailItem.value = null
  await deleteSingle(id)
}

async function copyText(text: string) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copyToast.value = '已复制'
  } catch {
    copyToast.value = '复制失败'
  }
  setTimeout(() => { copyToast.value = '' }, 2000)
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return dateStr
  }
}

function closePreview() {
  previewImage.value = null
  previewPath.value = ''
  previewRefImages.value = []
}
function copyPreviewImage() {
  if (previewPath.value) copyImage(previewPath.value)
}
function locatePreviewImage() {
  if (previewPath.value) openFolder(previewPath.value)
}

// Handle inspiration data from route query
function applyInspirationFromQuery() {
  const q = route.query
  if (q.prompt) {
    prompt.value = q.prompt as string
  }
  if (q.hasRefImages) {
    try {
      const stored = sessionStorage.getItem('imageGen:refImages')
      if (stored) {
        refImages.value = JSON.parse(stored)
        sessionStorage.removeItem('imageGen:refImages')
      }
    } catch {}
  }
}

watch(selectedModelId, (v) => {
  if (v) {
    window.api.settings.invoke('set', 'imagegen_provider_id', selectedProviderId.value)
    window.api.settings.invoke('set', 'imagegen_model_id', v)
  }
})
watch(optimizeModelId, (v) => {
  if (v) {
    window.api.settings.invoke('set', 'imagegen_optimize_provider_id', optimizeProviderId.value)
    window.api.settings.invoke('set', 'imagegen_optimize_model_id', v)
  }
})
watch(selectedTier, (v) => {
  if (v) window.api.settings.invoke('set', 'imagegen_tier_id', v)
})

onMounted(async () => {
  store.listenProgress()
  // 冷启只拉第 1 页 (25 条)，替代之前的 listRecentGenerations(200)
  await Promise.all([
    store.fetchPage(1, PAGE_SIZE),
    refreshFailedCount(),
    modelStore.fetchProviders(),
    presetStore.fetchAll('image_gen'),
    warmHintsCache()
  ])

  const all = (await window.api.settings.invoke('getAll')) as Record<string, string>
  const imagePick = resolveStudioModel(modelStore, {
    provider_id: selectedProviderId.value || all['imagegen_provider_id'],
    model_id: selectedModelId.value || all['imagegen_model_id']
  }, 'image')
  selectedProviderId.value = imagePick.provider_id
  selectedModelId.value = imagePick.model_id
  const optimizePick = resolveStudioModel(
    modelStore,
    {
      provider_id: optimizeProviderId.value || all['imagegen_optimize_provider_id'],
      model_id: optimizeModelId.value || all['imagegen_optimize_model_id']
    },
    'chat',
    siteConfigStore
  )
  optimizeProviderId.value = optimizePick.provider_id
  optimizeModelId.value = optimizePick.model_id
  if (all['imagegen_tier_id']) selectedTier.value = all['imagegen_tier_id']

  applyInspirationFromQuery()

  // handoff payload 兼容三种来源：
  //  - 旧：{ prompt }（其它页面直接透传 prompt）
  //  - 新：{ presetPrompt, presetSize, refImages }（图像处理菜单 / 第三方预设入口）
  // refImages 已在调用方压缩到 1024 / 0.8（@/utils/image-source.loadAsDataUri 默认值），
  // 此处直接挂载，不再二次压缩。
  const pending = handoff.consume<{
    prompt?: string
    presetPrompt?: string
    presetSize?: string
    size?: string
    refImages?: string[]
  }>('imageGen')
  if (pending) {
    if (pending.presetPrompt) prompt.value = pending.presetPrompt
    else if (pending.prompt) prompt.value = pending.prompt
    if (pending.presetSize) selectedSize.value = pending.presetSize
    else if (pending.size) selectedSize.value = pending.size
    // O3：refImages 用"覆盖"而非"追加"——从图像处理菜单跳过来的参考图代表全新场景，
    // 保留旧的参考图会让用户困惑且容易超 10 张上限。
    if (pending.refImages?.length) {
      refImages.value = pending.refImages.slice(0, 10)
    }
  }
})

onUnmounted(() => {
  store.stopListenProgress()
})
</script>
