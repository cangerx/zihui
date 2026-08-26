<template>
  <Teleport to="body">
    <div
      v-if="settingsUi.open"
      class="fixed inset-0 z-[100] flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
    >
      <div class="absolute inset-0 bg-black/25" @click="settingsUi.hide()" />
      <div
        class="relative flex w-full max-w-6xl h-[min(760px,90vh)] rounded-3xl bg-surface-0 shadow-modal overflow-hidden"
        @click.stop
      >
        <!-- 左分类 -->
        <aside class="w-52 flex-shrink-0 bg-surface-1 flex flex-col py-4">
          <div class="px-4 mb-2 text-sm font-semibold text-text-primary">设置</div>
          <div class="px-3 mb-2">
            <div class="relative">
              <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" /></svg>
              <input
                v-model="categoryQuery"
                type="search"
                placeholder="搜索"
                class="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg bg-surface-0 border border-surface-2 outline-none focus:border-primary-400"
              />
            </div>
          </div>
          <nav class="flex-1 px-2 space-y-0.5 overflow-y-auto">
            <button
              v-for="item in filteredCategoryItems"
              :key="item.id"
              type="button"
              class="w-full text-left px-3 py-2 rounded-xl text-sm transition-colors flex items-center gap-2"
              :class="settingsUi.category === item.id
                ? 'bg-surface-0 text-text-primary font-medium shadow-sm'
                : 'text-text-secondary hover:bg-surface-2/80'"
              @click="settingsUi.setCategory(item.id)"
            >
              <span class="w-4 h-4 flex-shrink-0 text-current" v-html="categoryIcon(item.id)" />
              {{ item.label }}
            </button>
          </nav>
        </aside>

        <!-- 右内容 -->
        <div class="flex-1 flex flex-col min-w-0 relative">
          <button
            type="button"
            class="absolute top-4 right-4 z-10 w-7 h-7 rounded-full text-text-tertiary hover:bg-surface-2 hover:text-text-primary flex items-center justify-center"
            aria-label="关闭"
            @click="settingsUi.hide()"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <div
            v-if="fillHeightCategory"
            class="flex-1 min-h-0 overflow-hidden"
          >
            <ModelsView v-if="settingsUi.category === 'models'" embedded />
            <McpView v-else-if="settingsUi.category === 'mcp'" embedded />
          </div>
          <div v-else class="flex-1 overflow-y-auto px-6 py-5 space-y-8">
        <!-- Vector Service → 连接（D-14：知识库下线后隐藏向量配置） -->
        <section v-if="false" v-show="settingsUi.category === 'connection'">
          <div class="flex items-center gap-2.5 mb-4">
            <div class="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center">
              <svg class="w-4 h-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" /></svg>
            </div>
            <h2 class="text-sm font-semibold text-text-primary">向量服务</h2>
            <span v-if="vectorMode === 'cloud-locked'" class="ml-auto text-[10px] px-2 py-0.5 rounded bg-primary-50 text-primary-700 font-medium border border-primary-200">由云端统一配置</span>
          </div>

          <!-- Source Tabs：仅在「dual」模式（已登录 + 允许自定义）下显示 -->
          <div v-if="vectorMode === 'dual'" class="flex items-center gap-2 mb-3">
            <button
              @click="requestSwitchSource('cloud')"
              :class="['px-3 py-1.5 text-xs font-medium rounded-lg border transition-all',
                vectorSource === 'cloud'
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-surface-3 bg-surface-0 text-text-secondary hover:bg-surface-2']"
            >云端模型</button>
            <button
              @click="requestSwitchSource('local')"
              :class="['px-3 py-1.5 text-xs font-medium rounded-lg border transition-all',
                vectorSource === 'local'
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-surface-3 bg-surface-0 text-text-secondary hover:bg-surface-2']"
            >自定义配置</button>
          </div>

          <!-- 云端模式（cloud-locked / dual+cloud） -->
          <div v-if="vectorSource === 'cloud'" class="form-card">
            <div v-if="cloudEmbeddingModels.length > 0">
              <label class="form-label">云端向量模型</label>
              <select v-model="cloudEmbeddingModel" @change="saveCloudEmbeddingPreference" class="select-field">
                <option v-for="m in cloudEmbeddingModels" :key="m.model_id" :value="m.model_id">
                  {{ m.name || m.model_id }}
                </option>
              </select>
              <p class="text-[11px] text-text-tertiary mt-1.5">消耗云端{{ siteConfig.labels.token }}（与对话共享同一池）</p>
            </div>
            <div v-else class="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800">
              <svg class="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
              <div class="flex-1">
                <div class="text-xs text-amber-800 dark:text-amber-300 font-medium">您的套餐未包含向量模型</div>
                <div class="text-[11px] text-amber-700 dark:text-amber-400 mt-1">购买含向量模型的套餐后，知识库可使用云端向量服务</div>
                <router-link to="/plans-store" class="inline-block mt-2 text-xs text-primary-600 hover:text-primary-700 font-medium">前往套餐商城 →</router-link>
              </div>
            </div>
          </div>

          <!-- 自定义模式（local-only / dual+local） -->
          <div v-if="vectorSource === 'local'" class="form-card">
            <div>
              <label class="form-label">服务类型</label>
              <select v-model="vectorForm.type" class="select-field">
                <option value="openai">OpenAI</option>
                <option value="openai_compatible">OpenAI 兼容</option>
              </select>
            </div>
            <div>
              <label class="form-label">API 基础地址</label>
              <input v-model="vectorForm.api_base" placeholder="https://api.openai.com/v1" class="input-field" />
              <p
                v-if="vectorForm.api_base && vectorForm.api_base.trim()"
                class="text-[11px] text-text-tertiary mt-1"
              >
                <span>实际生效地址：</span>
                <span class="font-mono text-text-secondary">{{ normalizedVectorApiBase }}</span>
                <span v-if="normalizedVectorApiBase !== vectorForm.api_base.trim()" class="ml-1 text-primary-600">（已自动补 /v1）</span>
              </p>
            </div>
            <div>
              <label class="form-label">API 密钥</label>
              <input v-model="vectorForm.api_key" type="password" class="input-field" />
            </div>
            <div>
              <label class="form-label">嵌入模型</label>
              <input v-model="vectorForm.model" placeholder="text-embedding-3-small" class="input-field" />
            </div>
            <div class="flex items-center gap-3 pt-1">
              <button @click="saveVectorSettings" class="btn-primary">保存</button>
              <button @click="testVectorConnection" :disabled="vectorTesting || !vectorForm.api_base" class="btn-secondary flex items-center gap-1.5">
                <svg v-if="vectorTesting" class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" /><path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75" /></svg>
                <span>{{ vectorTesting ? '测试中...' : '连接测试' }}</span>
              </button>
              <span v-if="vectorSaved" class="text-xs text-emerald-600 dark:text-emerald-400 font-medium animate-pulse">已保存</span>
              <span v-if="vectorTestResult" :class="['text-xs font-medium', vectorTestOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400']">{{ vectorTestResult }}</span>
            </div>
            <p class="text-[11px] text-text-tertiary">自定义配置不消耗云端{{ siteConfig.labels.token }}。若管理员关闭「自定义向量」权限，本地配置将被忽略，强制走云端</p>
          </div>

          <!-- 切换源确认弹窗（仅当库内已有向量时显示） -->
          <div v-if="sourceSwitchTarget" class="fixed inset-0 flex items-center justify-center z-[110]">
            <div class="absolute inset-0 bg-black/30" @click="cancelSwitchSource" />
            <div class="relative bg-surface-0 rounded-xl shadow-2xl border border-surface-3 p-6 max-w-md w-full mx-4">
              <h3 class="text-sm font-semibold text-text-primary mb-2">切换向量源</h3>
              <p class="text-xs text-text-secondary mb-2">
                当前已有 <b class="text-text-primary">{{ mismatchInfo?.totalChunks ?? 0 }}</b> 个分块使用「{{ describeMeta(mismatchInfo?.legacy?.[0]) }}」向量化。
              </p>
              <p class="text-xs text-amber-600 font-medium mb-4">
                切换到「{{ sourceSwitchTarget === 'cloud' ? '云端模型' : '自定义配置' }}」后，已有向量空间不兼容，知识库召回将失效。请在切换后前往「向量统计」页执行「全量重新向量化」。
              </p>
              <div class="flex justify-end gap-2">
                <button @click="cancelSwitchSource" class="btn-secondary">取消</button>
                <button @click="confirmSwitchSource" class="btn-primary">确认切换</button>
              </div>
            </div>
          </div>
        </section>

        <!-- 应用（P2-4：开机自启 / 托盘 / 通知）→ 通用 -->
        <section v-show="settingsUi.category === 'general'">
          <div class="flex items-center gap-2.5 mb-4">
            <div class="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center">
              <svg class="w-4 h-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z" /></svg>
            </div>
            <h2 class="text-sm font-semibold text-text-primary">应用</h2>
          </div>
          <div class="form-card space-y-4">
            <div class="flex items-center justify-between gap-4">
              <div class="min-w-0">
                <div class="text-xs font-medium text-text-primary">登录电脑时自动启动</div>
                <p class="text-[11px] text-text-tertiary mt-0.5">开机后自动打开本应用（可随后台运行）</p>
              </div>
              <button
                type="button"
                class="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
                :class="appPrefs.openAtLogin ? 'bg-primary-600' : 'bg-surface-3'"
                @click="toggleAppPref('openAtLogin')"
              >
                <span
                  class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  :class="appPrefs.openAtLogin ? 'translate-x-5' : ''"
                />
              </button>
            </div>
            <div class="flex items-center justify-between gap-4">
              <div class="min-w-0">
                <div class="text-xs font-medium text-text-primary">{{ trayLabel }}</div>
                <p class="text-[11px] text-text-tertiary mt-0.5">关闭窗口后可从图标重新打开；关闭图标后请改用「最小化」或 Dock/任务栏</p>
              </div>
              <button
                type="button"
                class="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
                :class="appPrefs.showTray ? 'bg-primary-600' : 'bg-surface-3'"
                @click="toggleAppPref('showTray')"
              >
                <span
                  class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  :class="appPrefs.showTray ? 'translate-x-5' : ''"
                />
              </button>
            </div>
            <div class="flex items-center justify-between gap-4">
              <div class="min-w-0">
                <div class="text-xs font-medium text-text-primary">启用桌面通知</div>
                <p class="text-[11px] text-text-tertiary mt-0.5">后台任务完成、ClawBot 掉线等系统通知</p>
              </div>
              <button
                type="button"
                class="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
                :class="appPrefs.notificationsEnabled ? 'bg-primary-600' : 'bg-surface-3'"
                @click="toggleAppPref('notificationsEnabled')"
              >
                <span
                  class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  :class="appPrefs.notificationsEnabled ? 'translate-x-5' : ''"
                />
              </button>
            </div>
            <div>
              <label class="form-label">通知音效</label>
              <div class="flex items-center gap-2 max-w-sm">
                <select v-model="appPrefs.notificationSound" class="select-field flex-1" @change="saveNotificationSound">
                  <option value="default">系统默认</option>
                  <option value="quiet">静音</option>
                </select>
                <button type="button" class="btn-secondary whitespace-nowrap" @click="testNotification">试听</button>
              </div>
            </div>
            <p v-if="appPrefsSaved" class="text-xs text-emerald-600 font-medium">已保存</p>
          </div>
        </section>

        <!-- General → 通用 -->
        <section v-show="settingsUi.category === 'general'">
          <div class="flex items-center gap-2.5 mb-4">
            <div class="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center">
              <svg class="w-4 h-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
            </div>
            <h2 class="text-sm font-semibold text-text-primary">常规</h2>
          </div>
          <div class="form-card">
            <div>
              <label class="form-label">默认温度</label>
              <input v-model="generalForm.temperature" type="number" step="0.1" min="0" max="2" class="input-field max-w-xs" />
            </div>
            <div>
              <label class="form-label">流式静默超时（秒）</label>
              <input v-model="generalForm.streamIdleTimeoutSec" type="number" step="10" min="30" max="600" class="input-field max-w-xs" />
              <p class="text-[11px] text-text-tertiary mt-1.5">对话时连续多少秒收不到模型返回就判定连接断开（自动重连/提示）。推理模型思考较久时可调大，默认 90 秒，范围 30–600。</p>
            </div>
            <div>
              <label class="form-label">点击关闭按钮时</label>
              <select v-model="generalForm.windowCloseBehavior" class="select-field max-w-xs">
                <option value="close-window">关闭窗口，应用继续在后台运行</option>
                <option value="minimize">最小化窗口，应用继续运行</option>
              </select>
              <p class="text-[11px] text-text-tertiary mt-1.5">关闭窗口后应用仍在后台运行，可从系统托盘图标重新打开；需彻底退出请右键托盘图标选择「退出」。</p>
            </div>
            <div class="flex items-center gap-3 pt-1">
              <button @click="saveGeneralSettings" class="btn-primary">保存</button>
              <span v-if="generalSaved" class="text-xs text-emerald-600 dark:text-emerald-400 font-medium animate-pulse">已保存</span>
            </div>
          </div>
        </section>

        <section v-show="settingsUi.category === 'general'">
          <div class="flex items-center gap-2.5 mb-4">
            <div class="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center">
              <svg class="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg>
            </div>
            <h2 class="text-sm font-semibold text-text-primary">对话记忆</h2>
          </div>
          <div class="form-card">
            <div>
              <label class="form-label">把对话蒸馏进知识库</label>
              <p class="text-[11px] text-text-tertiary mt-1 mb-2.5 leading-relaxed">只写入结论、决策、偏好和待办，不会把整段聊天原文塞进库。短对话会自动跳过。笔记落在当前工作区 <span class="font-mono">docs/记忆/</span>。</p>
              <select v-model="distillMode" class="select-field max-w-xs" @change="saveDistillMode">
                <option value="ask">聊完后询问我（推荐）</option>
                <option value="auto">自动保存低风险记忆，不打断</option>
                <option value="off">仅手动点「对话记忆」</option>
              </select>
              <p v-if="distillModeSaved" class="text-xs text-emerald-600 font-medium mt-2">已保存</p>
            </div>
          </div>
        </section>

        <!-- File Read Security → 通用 -->
        <section v-show="settingsUi.category === 'general'">
          <div class="flex items-center gap-2.5 mb-4">
            <div class="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center">
              <svg class="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" /></svg>
            </div>
            <h2 class="text-sm font-semibold text-text-primary">文件读取安全</h2>
          </div>
          <div class="form-card">
            <div>
              <label class="form-label">可信目录白名单</label>
              <p class="text-[11px] text-text-tertiary mt-1 mb-2.5 leading-relaxed">AI 读取「工作区之外」的文件时，默认需要你逐次确认。将常用目录加入白名单后，其中的文件 AI 可直接读取，无需确认。工作区内文件始终免确认。</p>
              <div v-if="trustedReadDirs.length" class="space-y-1.5 mb-2.5">
                <div v-for="(dir, i) in trustedReadDirs" :key="dir" class="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 border border-surface-3">
                  <svg class="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" /></svg>
                  <code class="font-mono text-[11px] text-text-secondary flex-1 truncate" :title="dir">{{ dir }}</code>
                  <button @click="removeTrustedDir(i)" class="text-[11px] text-text-tertiary hover:text-red-500 flex-shrink-0">移除</button>
                </div>
              </div>
              <p v-else class="text-[11px] text-text-tertiary mb-2.5">尚未添加可信目录</p>
              <div class="flex items-center gap-3 pt-1">
                <button @click="addTrustedDir" class="btn-secondary">添加目录</button>
                <span v-if="trustedSaved" class="text-xs text-emerald-600 dark:text-emerald-400 font-medium animate-pulse">已保存</span>
              </div>
            </div>
          </div>
        </section>

        <section v-show="settingsUi.category === 'general'">
          <div class="flex items-center gap-2.5 mb-4">
            <div class="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center">
              <svg class="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" /></svg>
            </div>
            <h2 class="text-sm font-semibold text-text-primary">Python 解释器</h2>
          </div>
          <div class="form-card">
            <div>
              <label class="form-label">用于 PPT 等 Skill 脚本</label>
              <p class="text-[11px] text-text-tertiary mt-1 mb-2.5 leading-relaxed">生成 PPT 会调用本机 Python。应用会把解释器绝对路径告诉 AI，避免打包后找不到 python3。</p>
              <div v-if="pythonStatus.ready" class="px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 mb-2.5">
                <p class="text-xs text-text-primary font-medium">已检测到 {{ pythonStatus.version ? 'Python ' + pythonStatus.version : 'Python' }}</p>
                <code class="block mt-1 font-mono text-[11px] text-text-secondary break-all">{{ pythonStatus.path }}</code>
                <p class="text-[11px] mt-1" :class="pythonStatus.hasPptx ? 'text-text-tertiary' : 'text-amber-600'">{{ pythonStatus.hasPptx ? 'python-pptx 已安装' : '未检测到 python-pptx，生成 PPT 时 AI 会尝试安装' }}</p>
              </div>
              <div v-else class="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 mb-2.5 dark:bg-amber-900/20 dark:border-amber-800">
                <p class="text-xs text-amber-700 dark:text-amber-300">{{ pythonStatus.reason || '未检测到 Python 3' }}</p>
                <p class="text-[11px] text-amber-700/80 dark:text-amber-300/80 mt-1">{{ pythonStatus.installHint }}</p>
              </div>
              <div class="flex flex-wrap items-center gap-2 pt-1">
                <button type="button" class="btn-secondary" :disabled="pythonBusy" @click="recheckPython">重新检测</button>
                <button type="button" class="btn-secondary" :disabled="pythonBusy" @click="pickPython">手动选择</button>
                <button v-if="!pythonStatus.ready" type="button" class="btn-secondary" @click="openPythonInstall">打开安装页</button>
                <span v-if="pythonBusy" class="text-xs text-text-tertiary">检测中…</span>
              </div>
            </div>
          </div>
        </section>

        <!-- Data Directory → 数据 -->
        <section v-show="settingsUi.category === 'data'">
          <div class="flex items-center gap-2.5 mb-4">
            <div class="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center">
              <svg class="w-4 h-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" /></svg>
            </div>
            <h2 class="text-sm font-semibold text-text-primary">数据目录</h2>
          </div>
          <div class="form-card">
            <div>
              <label class="form-label">当前数据存储路径</label>
              <div class="flex items-center gap-2">
                <input :value="dataDir" readonly class="input-field flex-1 bg-surface-2 cursor-default" />
                <button @click="changeDataDir" class="btn-secondary whitespace-nowrap">更改</button>
                <button @click="openDataDir" class="btn-secondary whitespace-nowrap">打开</button>
              </div>
              <p class="text-[11px] text-text-tertiary mt-1.5">数据库、技能、工作区等数据存放位置。更改后会自动追加 <span class="font-mono">local-agent</span> 子目录。</p>
              <p class="text-[11px] text-text-tertiary mt-1">请勿选择应用安装目录（如 <span class="font-mono">Program Files</span>）或系统目录，否则升级/卸载时数据会被清空。</p>
            </div>
            <div v-if="dataDirError" class="flex items-start gap-2 pt-1 text-xs text-red-500 font-medium">
              <svg class="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
              <span class="break-all">{{ dataDirError }}</span>
            </div>
            <div v-if="dataDirChanged" class="flex items-center gap-2 pt-1 text-xs text-amber-600 font-medium">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" /></svg>
              数据目录已更改，请重启软件后生效
            </div>
          </div>
        </section>

        <!-- Data Dir Relaunch Confirmation -->
        <div v-if="showDataDirRelaunch" class="fixed inset-0 z-[9999] flex items-center justify-center">
          <div class="w-full max-w-md bg-surface-0 rounded-2xl shadow-2xl p-6">
            <h2 class="text-base font-bold text-text-primary mb-2">需要重启应用</h2>
            <p class="text-sm text-text-secondary mb-2">数据目录已更改为：</p>
            <div class="text-xs text-text-tertiary mb-4 p-3 bg-surface-2 rounded-lg break-all font-mono">{{ dataDir }}</div>
            <p class="text-xs text-text-secondary mb-5">应用必须重启以加载新位置的数据。如果旧目录中有数据，重启后会提示是否迁移。</p>
            <div class="flex gap-3">
              <button @click="relaunchForDataDir" class="flex-1 py-2.5 text-sm font-semibold bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-colors">立即重启</button>
              <button @click="showDataDirRelaunch = false" class="px-6 py-2.5 text-sm font-medium border border-surface-3 rounded-xl text-text-secondary hover:bg-surface-2 transition-colors">稍后</button>
            </div>
          </div>
        </div>

        <!-- Data Backup → 数据 -->
        <section v-show="settingsUi.category === 'data'">
          <div class="flex items-center gap-2.5 mb-4">
            <div class="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center">
              <svg class="w-4 h-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0-3-3m3 3 3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>
            </div>
            <h2 class="text-sm font-semibold text-text-primary">数据备份</h2>
          </div>
          <div class="form-card">
            <div>
              <div class="flex items-center gap-4">
                <div class="flex-1">
                  <label class="form-label">自动备份</label>
                  <select v-model="backupInterval" @change="saveBackupSettings" class="select-field">
                    <option value="off">关闭</option>
                    <option value="daily">每日</option>
                    <option value="weekly">每周</option>
                  </select>
                </div>
                <div class="flex-1">
                  <label class="form-label">保留份数</label>
                  <select v-model="backupMaxCount" @change="saveBackupSettings" class="select-field">
                    <option v-for="n in [3, 5, 10, 20]" :key="n" :value="n">{{ n }} 份</option>
                  </select>
                </div>
              </div>
              <p class="text-[11px] text-text-tertiary mt-1.5">启动时自动备份，时间段内多次启动不重复备份。自动备份仅备份数据库；完整备份含技能与图片等用户文件。</p>
            </div>

            <!-- 操作按钮区 -->
            <div class="flex items-center gap-2 pt-2 flex-wrap">
              <div class="relative">
                <button @click.stop="showBackupMenu = !showBackupMenu" :disabled="taskRunning" class="btn-primary flex items-center gap-1.5">
                  <svg v-if="taskRunning" class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" /><path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75" /></svg>
                  <span>{{ backupRunning ? '备份中...' : '立即备份' }}</span>
                  <svg v-if="!taskRunning" class="w-3 h-3 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                </button>
                <div v-if="showBackupMenu" class="absolute left-0 top-full mt-1 w-56 bg-surface-0 rounded-lg shadow-lg border border-surface-3 py-1 z-10">
                  <button @click="doBackup('db')" class="w-full text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-2 transition-colors">
                    <div class="font-medium">快速备份</div>
                    <div class="text-text-tertiary mt-0.5">仅数据库</div>
                  </button>
                  <button @click="doBackup('full')" class="w-full text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-2 transition-colors">
                    <div class="font-medium">完整备份</div>
                    <div class="text-text-tertiary mt-0.5">含技能、图片等全部文件</div>
                  </button>
                </div>
              </div>
              <button @click="restoreFromExternal" :disabled="taskRunning" class="btn-secondary">从文件恢复...</button>
              <span v-if="backupMessage" :class="['text-xs font-medium', backupMessageOk ? 'text-emerald-600' : 'text-red-500']">{{ backupMessage }}</span>
            </div>

            <!-- 进度区域：备份或恢复进行中显示 -->
            <div v-if="taskRunning && progress" class="pt-3 border-t border-surface-3">
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs text-text-secondary font-medium">{{ phaseLabel(progress.phase) }}</span>
                <span class="text-[11px] text-text-tertiary">{{ progress.current }} / {{ progress.total }}</span>
              </div>
              <div class="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                <div class="h-full bg-primary-500 transition-all duration-200" :style="{ width: progressPercent + '%' }"></div>
              </div>
              <div class="flex items-center justify-between mt-1.5">
                <span class="text-[11px] text-text-tertiary truncate flex-1 mr-2">{{ progress.fileName }}</span>
                <button v-if="backupRunning" @click="cancelTask" class="text-[11px] text-red-500 hover:text-red-600 font-medium flex-shrink-0">取消</button>
              </div>
            </div>

            <div v-if="backups.length > 0" class="pt-3 border-t border-surface-3">
              <label class="form-label mb-2">备份记录</label>
              <div class="grid grid-cols-2 gap-2">
                <div v-for="b in pagedBackups" :key="b.fileName" class="flex flex-col gap-1.5 px-3 py-2 rounded-lg bg-surface-1 text-xs">
                  <div class="flex items-center gap-2">
                    <span :class="['inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium', b.type === 'full' ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' : 'bg-surface-3 text-text-secondary']">{{ b.type === 'full' ? '完整' : '数据库' }}</span>
                    <span v-if="b.format === 'legacy'" class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" title="旧格式备份，无完整性校验">旧格式</span>
                    <span class="text-text-secondary flex-1 truncate">{{ formatTime(b.createdAt) }}</span>
                    <span class="text-text-tertiary flex-shrink-0">{{ formatSize(b.size) }}</span>
                  </div>
                  <div v-if="b.appVersion" class="text-[10px] text-text-tertiary">v{{ b.appVersion }}</div>
                  <div class="flex items-center gap-2 justify-end">
                    <button @click="confirmRestore(b)" :disabled="taskRunning" class="text-primary-600 hover:text-primary-700 font-medium disabled:opacity-40">恢复</button>
                    <button @click="exportBackup(b)" :disabled="taskRunning" class="text-text-secondary hover:text-text-primary disabled:opacity-40">导出</button>
                    <button @click="removeBackup(b.fileName)" :disabled="taskRunning" class="text-text-tertiary hover:text-red-500 disabled:opacity-40">删除</button>
                  </div>
                </div>
              </div>
              <div v-if="backupTotalPages > 1" class="flex items-center justify-center gap-2 mt-2">
                <button @click="backupPage = Math.max(1, backupPage - 1)" :disabled="backupPage <= 1" class="px-2 py-1 text-[10px] text-text-tertiary hover:text-text-secondary disabled:opacity-30">上一页</button>
                <span class="text-[10px] text-text-tertiary">{{ backupPage }} / {{ backupTotalPages }}</span>
                <button @click="backupPage = Math.min(backupTotalPages, backupPage + 1)" :disabled="backupPage >= backupTotalPages" class="px-2 py-1 text-[10px] text-text-tertiary hover:text-text-secondary disabled:opacity-30">下一页</button>
              </div>
            </div>
            <div v-else class="pt-3 border-t border-surface-3">
              <p class="text-xs text-text-tertiary">暂无备份记录</p>
            </div>
          </div>

          <!-- Restore Confirm Dialog -->
          <div v-if="restoreTarget" class="fixed inset-0 flex items-center justify-center z-[110]">
            <div class="absolute inset-0 bg-black/30" @click="cancelRestoreDialog" />
            <div class="relative bg-surface-0 rounded-xl shadow-2xl border border-surface-3 p-6 max-w-md w-full mx-4">
              <h3 class="text-sm font-semibold text-text-primary mb-3">确认恢复</h3>

              <!-- 备份信息预览 -->
              <div class="bg-surface-1 rounded-lg px-3 py-2.5 mb-3 space-y-1">
                <div class="flex items-center justify-between text-xs">
                  <span class="text-text-tertiary">类型</span>
                  <span class="text-text-primary font-medium">{{ restoreTarget.type === 'full' ? '完整备份' : '数据库备份' }}</span>
                </div>
                <div class="flex items-center justify-between text-xs">
                  <span class="text-text-tertiary">创建时间</span>
                  <span class="text-text-primary">{{ formatTime(restoreTarget.createdAt) }}</span>
                </div>
                <div v-if="restoreTarget.appVersion" class="flex items-center justify-between text-xs">
                  <span class="text-text-tertiary">应用版本</span>
                  <span class="text-text-primary">v{{ restoreTarget.appVersion }}</span>
                </div>
                <div class="flex items-center justify-between text-xs">
                  <span class="text-text-tertiary">大小</span>
                  <span class="text-text-primary">{{ formatSize(restoreTarget.size) }}</span>
                </div>
                <div v-if="verifyInfo?.manifest" class="flex items-center justify-between text-xs">
                  <span class="text-text-tertiary">文件数</span>
                  <span class="text-text-primary">{{ verifyInfo.manifest.files.length }}</span>
                </div>
              </div>

              <!-- 校验状态 -->
              <div v-if="verifyChecking" class="mb-3 text-xs text-text-tertiary flex items-center gap-1.5">
                <svg class="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" /><path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75" /></svg>
                正在校验备份文件...
              </div>
              <div v-else-if="verifyInfo && !verifyInfo.ok" class="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 dark:text-red-300 dark:bg-red-900/20 dark:border-red-800 rounded-lg px-3 py-2">
                <div class="font-medium mb-0.5">备份不可恢复</div>
                <div>{{ verifyInfo.error }}</div>
              </div>
              <div v-else-if="verifyInfo?.compat?.level === 'warning'" class="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-800 rounded-lg px-3 py-2">
                <div class="font-medium mb-0.5">兼容性警告</div>
                <div>{{ verifyInfo.compat.reason }}</div>
              </div>
              <div v-else-if="verifyInfo?.legacy" class="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-800 rounded-lg px-3 py-2">
                <div class="font-medium mb-0.5">旧格式备份</div>
                <div>无法做完整性校验，建议恢复后立即创建新格式的备份。</div>
              </div>

              <!-- 影响说明 -->
              <p class="text-xs text-text-secondary mb-1">{{ restoreTarget.type === 'full' ? '将恢复所有数据和文件，当前数据将被归档保留 7 天供反悔。' : '将恢复数据库（对话、Bot、知识库配置等），技能文件和图片不受影响。' }}</p>
              <p class="text-xs text-amber-600 dark:text-amber-400 font-medium mb-4">恢复完成后应用将自动重启。</p>

              <div class="flex justify-end gap-2">
                <button @click="cancelRestoreDialog" :disabled="restoreRunning" class="btn-secondary">取消</button>
                <button @click="doRestore" :disabled="restoreRunning || verifyChecking || !verifyInfo?.ok" class="btn-primary flex items-center gap-1.5">
                  <svg v-if="restoreRunning" class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" /><path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75" /></svg>
                  <span>{{ restoreRunning ? '恢复中...' : '确认恢复' }}</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Cloud Sync → 数据 -->
        <div v-show="settingsUi.category === 'data'">
          <CloudSyncSection />
        </div>

        <!-- Theme → 偏好 -->
        <section v-show="settingsUi.category === 'preferences'">
          <div class="flex items-center gap-2.5 mb-4">
            <div class="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center">
              <svg class="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" /></svg>
            </div>
            <h2 class="text-sm font-semibold text-text-primary">外观</h2>
          </div>
          <div class="form-card">
            <div>
              <label class="form-label">主题模式</label>
              <div class="flex gap-2">
                <button v-for="opt in themeOptions" :key="opt.value" @click="themeStore.setMode(opt.value)" :class="['flex-1 px-3 py-2.5 text-xs font-medium rounded-lg border transition-all', themeStore.mode === opt.value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-3 bg-surface-0 text-text-secondary hover:bg-surface-2']">
                  {{ opt.label }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- 钱包：额度 / 充值 / 套餐支付 -->
        <section v-if="settingsUi.open && settingsUi.category === 'wallet'">
          <SettingsWalletPanel />
        </section>

        <!-- 微信 ClawBot -->
        <section v-if="settingsUi.open && settingsUi.category === 'clawbot'" class="-mx-2">
          <ClawbotView embedded />
        </section>

        <!-- About → 关于 -->
        <section v-show="settingsUi.category === 'about'">
          <div class="flex items-center gap-2.5 mb-4">
            <div class="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center">
              <svg class="w-4 h-4 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" /></svg>
            </div>
            <h2 class="text-sm font-semibold text-text-primary">关于</h2>
          </div>
          <div class="card p-5">
            <div class="flex items-center gap-3">
              <img
                v-if="appIconUrl"
                :src="appIconUrl"
                width="40"
                height="40"
                class="w-10 h-10 rounded-xl object-cover flex-shrink-0"
                style="width:40px;height:40px"
                alt=""
                draggable="false"
              />
              <div
                v-else
                class="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center"
              >
                <span class="text-white text-xs font-bold leading-none tracking-tight">{{ appAbbr }}</span>
              </div>
              <div class="flex-1">
                <div class="text-sm font-semibold text-text-primary">{{ appName }}</div>
                <div class="text-xs text-text-tertiary">v{{ appVersion }} · 本地 AI 工作台</div>
              </div>
            </div>
            <div class="mt-4 pt-4 border-t border-surface-2 flex items-center gap-2 flex-wrap">
              <button
                @click="checkForUpdate"
                :disabled="checkingUpdate"
                class="px-3 py-1.5 text-xs font-medium border border-surface-3 text-text-secondary rounded-lg hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {{ checkingUpdate ? '检查中...' : '检查更新' }}
              </button>
              <button
                @click="showChangelog = true"
                class="px-3 py-1.5 text-xs font-medium border border-surface-3 text-text-secondary rounded-lg hover:bg-surface-2 transition-colors"
              >
                更新日志
              </button>
              <span v-if="updateMessage" class="text-[11px] text-text-tertiary ml-auto">{{ updateMessage }}</span>
            </div>
          </div>
        </section>
          </div>

          <div class="flex-shrink-0 px-6 py-3 border-t border-surface-2 flex justify-end">
            <button
              type="button"
              class="px-5 py-2 text-sm font-medium text-white rounded-full bg-primary-600 hover:bg-primary-700 transition-colors"
              @click="settingsUi.hide()"
            >完成</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

    <!-- 更新日志弹窗 -->
    <ChangelogDialog v-if="showChangelog" :current-version="appVersion" @close="showChangelog = false" />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useThemeStore } from '@/stores/theme'
import type { ThemeMode } from '@/stores/theme'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useSiteConfigStore } from '@/stores/site-config'
import { useSettingsUiStore, type SettingsCategory } from '@/stores/settings-ui'
import { appName, appAbbr, appIconUrl } from '@/utils/branding'
import { normalizeApiBase } from '@shared/api-base-normalize'
import ChangelogDialog from './ChangelogDialog.vue'
import CloudSyncSection from './CloudSyncSection.vue'
import ClawbotView from '@/views/clawbot/ClawbotView.vue'
import SettingsWalletPanel from './SettingsWalletPanel.vue'
import ModelsView from '@/views/models/ModelsView.vue'
import McpView from '@/views/mcps/McpView.vue'

declare const __APP_VERSION__: string
const appVersion = __APP_VERSION__

const settingsUi = useSettingsUiStore()
const fillHeightCategory = computed(() =>
  settingsUi.category === 'models' || settingsUi.category === 'mcp'
)
const categoryQuery = ref('')
const categoryItems: { id: SettingsCategory; label: string }[] = [
  { id: 'wallet', label: '钱包' },
  { id: 'general', label: '通用' },
  { id: 'preferences', label: '偏好' },
  { id: 'models', label: '模型' },
  { id: 'mcp', label: 'MCP' },
  { id: 'clawbot', label: '微信 ClawBot' },
  { id: 'data', label: '数据' },
  { id: 'about', label: '关于' }
]

const filteredCategoryItems = computed(() => {
  const q = categoryQuery.value.trim().toLowerCase()
  if (!q) return categoryItems
  return categoryItems.filter((item) => item.label.toLowerCase().includes(q) || item.id.includes(q))
})

const CATEGORY_ICONS: Record<string, string> = {
  wallet: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" /></svg>',
  general: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>',
  preferences: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" /></svg>',
  models: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" /></svg>',
  mcp: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" /><path stroke-linecap="round" d="M6 6h.01M6 18h.01" /></svg>',
  clawbot: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H15.75m-9.75 3.75h9.75c.621 0 1.125-.504 1.125-1.125V8.625c0-.621-.504-1.125-1.125-1.125H6.375c-.621 0-1.125.504-1.125 1.125v5.25c0 .621.504 1.125 1.125 1.125z" /></svg>',
  data: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375" /></svg>',
  about: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>'
}

function categoryIcon(id: string): string {
  return CATEGORY_ICONS[id] || CATEGORY_ICONS.general
}

function onSettingsKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && settingsUi.open) {
    settingsUi.hide()
  }
}

// === 更新检查与日志 ===
const checkingUpdate = ref(false)
const updateMessage = ref('')
const showChangelog = ref(false)
let updateMessageTimer: number | null = null

function setUpdateMessage(msg: string, autoClearMs = 5000) {
  updateMessage.value = msg
  if (updateMessageTimer !== null) {
    clearTimeout(updateMessageTimer)
    updateMessageTimer = null
  }
  if (autoClearMs > 0) {
    updateMessageTimer = window.setTimeout(() => {
      updateMessage.value = ''
      updateMessageTimer = null
    }, autoClearMs)
  }
}

async function checkForUpdate(): Promise<void> {
  // dev 模式下主进程未注册 updater IPC，提前提示并避免报错
  if (import.meta.env.DEV) {
    setUpdateMessage('开发模式下不可用')
    return
  }
  checkingUpdate.value = true
  setUpdateMessage('正在检查...', 0)
  try {
    const result: any = await (window as any).api?.updater?.check()
    if (!result) {
      setUpdateMessage('无法访问更新服务')
    } else if (result.error) {
      setUpdateMessage(`检查失败：${result.error}`)
    } else if (result.latestVersion && result.latestVersion !== result.currentVersion) {
      setUpdateMessage(`发现新版本 v${result.latestVersion}`)
    } else {
      setUpdateMessage('已是最新版本')
    }
  } catch (e: any) {
    setUpdateMessage(`检查失败：${e?.message || e}`)
  } finally {
    checkingUpdate.value = false
  }
}

const themeStore = useThemeStore()
const cloudAuth = useCloudAuthStore()
const siteConfig = useSiteConfigStore()
const themeOptions: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' }
]

// === Vector Service：双源（云端 / 自定义）状态 ===
const vectorForm = ref({ type: 'openai', api_base: '', api_key: '', model: 'text-embedding-3-small' })
const normalizedVectorApiBase = computed(() => normalizeApiBase(vectorForm.value.api_base))
const vectorSource = ref<'cloud' | 'local'>('local')
const cloudEmbeddingModels = ref<Array<{ id: number; model_id: string; name: string }>>([])
const cloudEmbeddingModel = ref<string>('')
const sourceSwitchTarget = ref<'cloud' | 'local' | null>(null)
const mismatchInfo = ref<{
  totalChunks: number
  legacy?: Array<{ model: string; dim: number; source: string; chunk_count: number }>
} | null>(null)

/**
 * 三态模式：
 * - cloud-locked: 已登录 且 allow_custom_embedding=false → 强制云端，无 Tabs
 * - dual:        已登录 且 allow_custom_embedding=true  → 显示 Tabs，可切换
 * - local-only:  未登录                                → 仅自定义
 */
const vectorMode = computed<'cloud-locked' | 'dual' | 'local-only'>(() => {
  if (!cloudAuth.isLoggedIn) return 'local-only'
  if (!cloudAuth.permissions.allow_custom_embedding) return 'cloud-locked'
  return 'dual'
})

function describeMeta(m?: { model: string; source: string; dim: number }): string {
  if (!m) return '历史向量数据'
  const src = m.source === 'cloud' ? '云端' : (m.source === 'local' ? '自定义' : '未知')
  const model = m.model || '(旧版本未记录模型)'
  return `${src} / ${model}${m.dim ? ` · ${m.dim} 维` : ''}`
}
type WindowCloseBehavior = 'close-window' | 'minimize'

const generalForm = ref<{ temperature: string; windowCloseBehavior: WindowCloseBehavior; streamIdleTimeoutSec: string }>({
  temperature: '0.7',
  windowCloseBehavior: 'close-window',
  streamIdleTimeoutSec: '90'
})

const appPrefs = ref({
  openAtLogin: false,
  showTray: true,
  notificationsEnabled: true,
  notificationSound: 'default' as 'default' | 'quiet'
})
const appPrefsSaved = ref(false)
const trayLabel = computed(() =>
  navigator.platform.toLowerCase().includes('mac')
    ? '在菜单栏显示图标'
    : '在系统托盘显示图标'
)

async function loadAppPrefs() {
  try {
    if (!window.api?.desktopPrefs?.get) return
    const prefs = await window.api.desktopPrefs.get()
    if (prefs) {
      appPrefs.value = {
        openAtLogin: !!prefs.openAtLogin,
        showTray: prefs.showTray !== false,
        notificationsEnabled: prefs.notificationsEnabled !== false,
        notificationSound: prefs.notificationSound === 'quiet' ? 'quiet' : 'default'
      }
    }
  } catch {
    /* ignore */
  }
}

async function persistAppPrefs(patch: Partial<typeof appPrefs.value>) {
  if (!window.api?.desktopPrefs?.update) return
  const next = await window.api.desktopPrefs.update(patch)
  if (next) {
    appPrefs.value = {
      openAtLogin: !!next.openAtLogin,
      showTray: next.showTray !== false,
      notificationsEnabled: next.notificationsEnabled !== false,
      notificationSound: next.notificationSound === 'quiet' ? 'quiet' : 'default'
    }
  }
  appPrefsSaved.value = true
  setTimeout(() => {
    appPrefsSaved.value = false
  }, 1500)
}

async function toggleAppPref(key: 'openAtLogin' | 'showTray' | 'notificationsEnabled') {
  const next = !appPrefs.value[key]
  appPrefs.value[key] = next
  await persistAppPrefs({ [key]: next })
}

async function saveNotificationSound() {
  await persistAppPrefs({ notificationSound: appPrefs.value.notificationSound })
}

async function testNotification() {
  try {
    await window.api.desktopPrefs.testNotification()
  } catch (e: any) {
    alert(e?.message || String(e))
  }
}

const vectorSaved = ref(false)
const vectorTesting = ref(false)
const vectorTestResult = ref('')
const vectorTestOk = ref(false)
const generalSaved = ref(false)
const distillMode = ref<'ask' | 'auto' | 'off'>('ask')
const distillModeSaved = ref(false)
const trustedReadDirs = ref<string[]>([])
const pythonBusy = ref(false)
const pythonStatus = ref<{
  ready: boolean
  path?: string
  version?: string
  hasPptx?: boolean
  reason?: string
  installUrl: string
  installHint: string
}>({
  ready: false,
  installUrl: 'https://www.python.org/downloads/',
  installHint: ''
})
const trustedSaved = ref(false)
const dataDir = ref('')
const dataDirChanged = ref(false)
const dataDirError = ref('')
const showDataDirRelaunch = ref(false)

// === 备份与恢复 ===
//
// 后端 API（主进程 services/backup）：
//   list                                → BackupInfo[]
//   db / full                           → 创建备份；进度通过 'backup:progress' 推送
//   cancel                              → 取消当前任务（仅备份阶段；恢复中途取消会破坏一致性）
//   verify(fileName)                    → 兼容性 + 完整性预检
//   restore(fileName)                   → 从已有记录恢复；成功后主进程自动 relaunch
//   restoreFromExternal                 → 弹文件选择器导入 .zip 并恢复
//   exportTo(fileName)                  → 弹保存对话框导出备份到外部位置
//   delete(fileName)                    → 删除备份
//   getSettings / setSettings           → 自动备份开关 + 保留份数

interface BackupInfo {
  fileName: string
  type: 'auto' | 'full'
  size: number
  createdAt: string
  appVersion?: string
  format?: 'v1' | 'legacy'
}

interface ProgressData {
  phase: 'snapshot' | 'pack' | 'verify' | 'extract' | 'apply'
  current: number
  total: number
  fileName: string
  bytes?: number
}

interface VerifyInfo {
  ok: boolean
  manifest?: { files: { path: string; size: number; sha256: string }[]; appVersion: string; type: string }
  compat?: { level: 'ok' | 'warning' | 'blocked'; reason?: string }
  error?: string
  legacy?: boolean
}

const backups = ref<BackupInfo[]>([])
const backupInterval = ref('off')
const backupMaxCount = ref(5)
const backupRunning = ref(false)
const backupMessage = ref('')
const backupMessageOk = ref(false)
const showBackupMenu = ref(false)
const restoreTarget = ref<BackupInfo | null>(null)
const restoreRunning = ref(false)
const verifyChecking = ref(false)
const verifyInfo = ref<VerifyInfo | null>(null)
const progress = ref<ProgressData | null>(null)
const backupPage = ref(1)
const BACKUP_PAGE_SIZE = 8

// taskRunning 涵盖所有阻塞性任务：备份和恢复都禁用同区域其他按钮
const taskRunning = computed(() => backupRunning.value || restoreRunning.value)

const progressPercent = computed(() => {
  if (!progress.value || !progress.value.total) return 0
  return Math.min(100, Math.round((progress.value.current / progress.value.total) * 100))
})

function phaseLabel(phase: ProgressData['phase']): string {
  switch (phase) {
    case 'snapshot': return '生成数据库快照'
    case 'pack': return '打包文件'
    case 'verify': return '校验完整性'
    case 'extract': return '解压备份'
    case 'apply': return '写入数据目录'
    default: return '处理中'
  }
}

const pagedBackups = computed(() => {
  const start = (backupPage.value - 1) * BACKUP_PAGE_SIZE
  return backups.value.slice(start, start + BACKUP_PAGE_SIZE)
})

const backupTotalPages = computed(() =>
  Math.ceil(backups.value.length / BACKUP_PAGE_SIZE)
)

async function loadBackups() {
  backups.value = (await window.api.backup.invoke('list')) as BackupInfo[]
  const settings = (await window.api.backup.invoke('getSettings')) as { interval: string; maxCount: number }
  backupInterval.value = settings.interval
  backupMaxCount.value = settings.maxCount
}

async function saveBackupSettings() {
  const result = (await window.api.backup.invoke(
    'setSettings',
    backupInterval.value,
    backupMaxCount.value
  )) as { success: boolean; error?: string }
  if (result && !result.success) {
    backupMessageOk.value = false
    backupMessage.value = `保存设置失败: ${result.error}`
    setTimeout(() => { backupMessage.value = '' }, 4000)
  }
}

async function doBackup(type: 'db' | 'full') {
  showBackupMenu.value = false
  backupRunning.value = true
  backupMessage.value = ''
  progress.value = null
  try {
    await window.api.backup.invoke(type === 'db' ? 'db' : 'full')
    backupMessageOk.value = true
    backupMessage.value = '备份完成'
    await loadBackups()
  } catch (e: any) {
    backupMessageOk.value = false
    backupMessage.value = `备份失败: ${e?.message || e}`
  } finally {
    backupRunning.value = false
    progress.value = null
    setTimeout(() => { backupMessage.value = '' }, 4000)
  }
}

async function cancelTask() {
  // 仅在备份阶段允许取消；恢复中途取消会留下半完成的状态由主进程的 staging 机制兜底
  try {
    await window.api.backup.invoke('cancel')
  } catch {}
}

async function confirmRestore(b: BackupInfo) {
  restoreTarget.value = b
  verifyInfo.value = null
  verifyChecking.value = true
  try {
    verifyInfo.value = (await window.api.backup.invoke('verify', b.fileName)) as VerifyInfo
  } catch (e: any) {
    verifyInfo.value = { ok: false, error: e?.message || String(e) }
  } finally {
    verifyChecking.value = false
  }
}

function cancelRestoreDialog() {
  if (restoreRunning.value) return
  restoreTarget.value = null
  verifyInfo.value = null
}

async function doRestore() {
  if (!restoreTarget.value) return
  restoreRunning.value = true
  progress.value = null
  try {
    const b = restoreTarget.value
    const result = (await window.api.backup.invoke('restore', b.fileName)) as {
      success: boolean
      error?: string
    }
    if (result.success) {
      backupMessageOk.value = true
      backupMessage.value = '恢复成功，应用即将重启...'
      // 主进程会在 200ms 后 app.relaunch + exit；UI 不再操作
    } else {
      backupMessageOk.value = false
      backupMessage.value = `恢复失败: ${result.error}`
      restoreRunning.value = false
      restoreTarget.value = null
      verifyInfo.value = null
      progress.value = null
      setTimeout(() => { backupMessage.value = '' }, 5000)
    }
  } catch (e: any) {
    backupMessageOk.value = false
    backupMessage.value = `恢复失败: ${e?.message || e}`
    restoreRunning.value = false
    restoreTarget.value = null
    verifyInfo.value = null
    progress.value = null
    setTimeout(() => { backupMessage.value = '' }, 5000)
  }
}

async function restoreFromExternal() {
  if (taskRunning.value) return
  restoreRunning.value = true
  backupMessage.value = ''
  progress.value = null
  try {
    const result = (await window.api.backup.invoke('restoreFromExternal')) as {
      success: boolean
      error?: string
    }
    if (result.success) {
      backupMessageOk.value = true
      backupMessage.value = '恢复成功，应用即将重启...'
      // 成功路径：保持 restoreRunning=true，主进程会在 200ms 后强制 relaunch，UI 状态不需要复位
      return
    }
    // 失败 / 取消：复位 UI 状态
    if (result.error !== 'cancelled') {
      backupMessageOk.value = false
      backupMessage.value = `恢复失败: ${result.error}`
      setTimeout(() => { backupMessage.value = '' }, 5000)
    }
  } catch (e: any) {
    backupMessageOk.value = false
    backupMessage.value = `恢复失败: ${e?.message || e}`
    setTimeout(() => { backupMessage.value = '' }, 5000)
  }
  // 任何非"成功并即将重启"的分支都到这里复位
  restoreRunning.value = false
  progress.value = null
}

async function exportBackup(b: BackupInfo) {
  if (taskRunning.value) return
  try {
    const result = (await window.api.backup.invoke('exportTo', b.fileName)) as {
      success: boolean
      error?: string
      exportedPath?: string
    }
    if (result.success) {
      backupMessageOk.value = true
      backupMessage.value = '已导出'
    } else if (result.error !== 'cancelled') {
      backupMessageOk.value = false
      backupMessage.value = `导出失败: ${result.error}`
    }
  } catch (e: any) {
    backupMessageOk.value = false
    backupMessage.value = `导出失败: ${e?.message || e}`
  } finally {
    setTimeout(() => { backupMessage.value = '' }, 4000)
  }
}

async function removeBackup(fileName: string) {
  if (taskRunning.value) return
  await window.api.backup.invoke('delete', fileName)
  await loadBackups()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function onClickOutsideMenu() {
  if (showBackupMenu.value) {
    showBackupMenu.value = false
  }
}

// 平台原生分隔符（与主进程的 Windows 路径保持一致），避免出现混合分隔符
function joinPath(base: string, child: string): string {
  const sep = base.includes('\\') ? '\\' : '/'
  const trimmed = base.replace(/[\\/]+$/, '')
  return trimmed + sep + child
}

function endsWithSegment(path: string, segment: string): boolean {
  return path.endsWith('\\' + segment) || path.endsWith('/' + segment)
}

async function changeDataDir() {
  dataDirError.value = ''
  const picked = await (window as any).api.dataDir.pick() as string | null
  if (!picked) return
  const finalDir = endsWithSegment(picked, 'local-agent') ? picked : joinPath(picked, 'local-agent')
  if (finalDir === dataDir.value) return // 选了同样的目录，不需要任何动作
  // 仅写 config，不更新当前进程的 cachedDataDir，避免文件操作走新目录、db 仍在旧目录
  // 造成数据切割。提示用户立即重启以使变更生效。
  // 主进程会先校验路径合法性（拒绝安装目录/系统目录/磁盘根），失败时返回 reason 给 UI 展示。
  const result = await (window as any).api.dataDir.set(finalDir) as
    | { ok: false; reason: string }
    | { ok: true; needsRelaunch: boolean }
  if (!result?.ok) {
    dataDirError.value = result?.reason || '设置数据目录失败'
    return
  }
  dataDir.value = finalDir
  dataDirChanged.value = true
  if (result.needsRelaunch) {
    showDataDirRelaunch.value = true
  }
}

async function relaunchForDataDir() {
  await (window as any).api.app.relaunch()
}

function openDataDir() {
  if (dataDir.value) (window as any).api.shell.openPath(dataDir.value)
}

async function loadSettings() {
  await loadAppPrefs()
  const all = (await window.api.settings.invoke('getAll')) as Record<string, string>
  if (all['vector_type']) vectorForm.value.type = all['vector_type']
  if (all['vector_api_base']) vectorForm.value.api_base = all['vector_api_base']
  if (all['vector_api_key']) vectorForm.value.api_key = all['vector_api_key']
  if (all['vector_model']) vectorForm.value.model = all['vector_model']
  if (all['temperature']) generalForm.value.temperature = all['temperature']
  if (all['stream_idle_timeout_ms']) {
    const ms = parseInt(all['stream_idle_timeout_ms'], 10)
    if (Number.isFinite(ms) && ms > 0) generalForm.value.streamIdleTimeoutSec = String(Math.round(ms / 1000))
  }
  if (all['window_close_behavior'] === 'minimize' || all['window_close_behavior'] === 'close-window') {
    generalForm.value.windowCloseBehavior = all['window_close_behavior']
  }
  // 设备级覆盖（优先）：窗口关闭行为为设备级设置，独立于账号
  try {
    const dcb = await window.api.deviceSettings.get('window_close_behavior')
    if (dcb === 'minimize' || dcb === 'close-window') {
      generalForm.value.windowCloseBehavior = dcb
    }
  } catch {}
  try {
    const mode = await window.api.distill.getMode()
    if (mode === 'ask' || mode === 'auto' || mode === 'off') distillMode.value = mode
  } catch {}

  // 加载云端 embedding 状态：包括用户偏好模型 + 当前可用模型列表
  try {
    const state = await window.api.cloud.getEmbeddingState()
    cloudEmbeddingModels.value = state.models || []
    if (state.preferred && state.models?.some((m) => m.model_id === state.preferred)) {
      cloudEmbeddingModel.value = state.preferred
    } else if (state.models?.[0]) {
      cloudEmbeddingModel.value = state.models[0].model_id
    } else {
      cloudEmbeddingModel.value = ''
    }
  } catch {
    cloudEmbeddingModels.value = []
    cloudEmbeddingModel.value = ''
  }

  // 解析当前生效的 vector_source：用户主动选择 > 权限默认
  const stored = (all['vector_source'] || '').trim()
  if (stored === 'cloud' || stored === 'local') {
    vectorSource.value = stored
  } else {
    // 默认：cloud-locked / 已登录强制云端，否则 local
    vectorSource.value = vectorMode.value === 'cloud-locked' ? 'cloud' : 'local'
  }
  // 仅按当前模式纠正【UI 显示】，不持久化覆盖用户主动选择的偏好：
  // cloud-locked（无自定义权限）/ local-only（未登录）下 Tabs 不可见，这里只决定显示哪个表单；
  // 运行时 getEmbeddingConfig 已按登录态/权限兜底（未登录→本地、无自定义权限→云端）。
  // 这样可避免「token 过期后重启打开设置页，cloud 偏好被悄悄改成 local 且重新登录也回不来」。
  if (vectorMode.value === 'cloud-locked') {
    vectorSource.value = 'cloud'
  } else if (vectorMode.value === 'local-only') {
    vectorSource.value = 'local'
  }

  dataDir.value = await (window as any).api.dataDir.get() as string

  try {
    const raw = all['trusted_read_dirs']
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) trustedReadDirs.value = arr.filter((x: any) => typeof x === 'string')
    }
  } catch {
    trustedReadDirs.value = []
  }

  await refreshPythonStatus()
}

async function saveVectorSettings() {
  await window.api.settings.invoke('set', 'vector_type', vectorForm.value.type)
  await window.api.settings.invoke('set', 'vector_api_base', vectorForm.value.api_base)
  await window.api.settings.invoke('set', 'vector_api_key', vectorForm.value.api_key)
  await window.api.settings.invoke('set', 'vector_model', vectorForm.value.model)
  vectorSaved.value = true
  setTimeout(() => { vectorSaved.value = false }, 2000)
}

async function saveCloudEmbeddingPreference() {
  await window.api.settings.invoke('set', 'cloud_embedding_model', cloudEmbeddingModel.value)
  await window.api.cloud.setPreferredEmbeddingModel(cloudEmbeddingModel.value)
  vectorSaved.value = true
  setTimeout(() => { vectorSaved.value = false }, 2000)
}

/**
 * 切换源前置检查：若库内已有向量数据，先弹确认；否则直接切换。
 * cloud-locked / local-only 模式下 Tabs 不可见，此函数不会被调用。
 */
async function requestSwitchSource(target: 'cloud' | 'local') {
  if (target === vectorSource.value) return
  // 切到 cloud 但没有可用模型 → 直接锁定并提示
  if (target === 'cloud' && cloudEmbeddingModels.value.length === 0) {
    sourceSwitchTarget.value = null
    // 仍切到云端 tab 显示「未包含向量模型」提示
    vectorSource.value = 'cloud'
    await window.api.settings.invoke('set', 'vector_source', 'cloud')
    return
  }
  // 检查库内是否已有向量
  try {
    const res = await window.api.vectorize.checkModelMismatch()
    if (res.totalChunks > 0) {
      mismatchInfo.value = { totalChunks: res.totalChunks, legacy: res.legacy }
      sourceSwitchTarget.value = target
      return
    }
  } catch { /* 忽略检查失败，直接切 */ }
  await applySwitchSource(target)
}

function cancelSwitchSource() {
  sourceSwitchTarget.value = null
  mismatchInfo.value = null
}

async function confirmSwitchSource() {
  if (!sourceSwitchTarget.value) return
  await applySwitchSource(sourceSwitchTarget.value)
  sourceSwitchTarget.value = null
  mismatchInfo.value = null
}

async function applySwitchSource(target: 'cloud' | 'local') {
  vectorSource.value = target
  await window.api.settings.invoke('set', 'vector_source', target)
}

// 监听模式变化（管理员调整权限 / 登录态变化），仅纠正【UI 显示】，不持久化覆盖用户偏好。
// 运行时 getEmbeddingConfig 已按登录态/权限兜底；vector_source 始终保留用户主动选择，
// 使「权限恢复 / 重新登录」后能自动回到用户原本选择的源。
watch(
  () => vectorMode.value,
  async (mode) => {
    if (mode === 'cloud-locked') {
      vectorSource.value = 'cloud'
    } else if (mode === 'local-only') {
      vectorSource.value = 'local'
    } else {
      // 回到 dual：从持久化恢复用户真实偏好用于显示（默认自定义）
      const stored = ((await window.api.settings.invoke('get', 'vector_source')) as string || '').trim()
      vectorSource.value = stored === 'cloud' ? 'cloud' : 'local'
    }
  },
)

async function testVectorConnection() {
  vectorTesting.value = true
  vectorTestResult.value = ''
  vectorTestOk.value = false
  try {
    const res = (await window.api.settings.invoke('testVector', vectorForm.value.api_base, vectorForm.value.api_key, vectorForm.value.model)) as { dimension: number }
    vectorTestOk.value = true
    vectorTestResult.value = `连接成功 (维度: ${res.dimension})`
  } catch (e: any) {
    vectorTestOk.value = false
    vectorTestResult.value = `连接失败: ${e?.message || e}`
  } finally {
    vectorTesting.value = false
    setTimeout(() => { vectorTestResult.value = '' }, 5000)
  }
}

async function saveGeneralSettings() {
  await window.api.settings.invoke('set', 'temperature', generalForm.value.temperature)
  // 流式静默超时：UI 用秒，存储用毫秒；钳制到 30~600 秒，避免误填
  const sec = Math.max(30, Math.min(600, parseInt(generalForm.value.streamIdleTimeoutSec, 10) || 90))
  generalForm.value.streamIdleTimeoutSec = String(sec)
  await window.api.settings.invoke('set', 'stream_idle_timeout_ms', String(sec * 1000))
  // 窗口关闭行为为设备级设置，写入 device-settings.json（独立于按账号隔离的 settings 表）
  await window.api.deviceSettings.set('window_close_behavior', generalForm.value.windowCloseBehavior)
  generalSaved.value = true
  setTimeout(() => { generalSaved.value = false }, 2000)
}

async function saveDistillMode() {
  const mode = distillMode.value
  try {
    distillMode.value = await window.api.distill.setMode(mode)
    distillModeSaved.value = true
    setTimeout(() => { distillModeSaved.value = false }, 2000)
  } catch {
    /* ignore */
  }
}

async function refreshPythonStatus() {
  pythonBusy.value = true
  try {
    pythonStatus.value = await window.api.python.status()
  } finally {
    pythonBusy.value = false
  }
}

async function recheckPython() {
  await refreshPythonStatus()
}

async function pickPython() {
  const result = (await window.api.dialog.openFile({
    title: '选择 Python 解释器',
    properties: ['openFile']
  })) as { canceled: boolean; filePaths: string[] }
  if (result.canceled || !result.filePaths.length) return
  pythonBusy.value = true
  try {
    pythonStatus.value = await window.api.python.setPath(result.filePaths[0])
  } finally {
    pythonBusy.value = false
  }
}

async function openPythonInstall() {
  const url = pythonStatus.value.installUrl || 'https://www.python.org/downloads/'
  await window.api.shell.openExternal(url)
}

async function persistTrustedDirs() {
  await window.api.settings.invoke('set', 'trusted_read_dirs', JSON.stringify(trustedReadDirs.value))
  trustedSaved.value = true
  setTimeout(() => { trustedSaved.value = false }, 2000)
}
async function addTrustedDir() {
  const result = (await window.api.dialog.openFile({ title: '选择可信目录', properties: ['openDirectory'] })) as { canceled: boolean; filePaths: string[] }
  if (result.canceled || !result.filePaths.length) return
  const dir = result.filePaths[0]
  if (!trustedReadDirs.value.includes(dir)) {
    trustedReadDirs.value.push(dir)
    await persistTrustedDirs()
  }
}
function removeTrustedDir(index: number) {
  trustedReadDirs.value.splice(index, 1)
  persistTrustedDirs()
}

function handleBackupProgress(data: ProgressData): void {
  // 主进程在备份/恢复过程中持续推送进度事件，仅当任务进行中时显示
  if (taskRunning.value) progress.value = data
}

onMounted(() => {
  loadSettings()
  loadBackups()
  document.addEventListener('click', onClickOutsideMenu)
  document.addEventListener('keydown', onSettingsKeydown)
  // 订阅备份/恢复进度，让 UI 进度条与主进程实际状态同步
  window.api.backup.onProgress(handleBackupProgress)
})

onUnmounted(() => {
  document.removeEventListener('click', onClickOutsideMenu)
  document.removeEventListener('keydown', onSettingsKeydown)
  window.api.backup.offProgress()
  if (updateMessageTimer !== null) {
    clearTimeout(updateMessageTimer)
    updateMessageTimer = null
  }
})
</script>
