<template>
  <div
    class="flex h-screen w-screen overflow-hidden bg-surface-1"
    :class="isMac ? '' : 'p-3 gap-3'"
  >
    <aside
      class="w-[220px] flex-shrink-0 flex flex-col overflow-hidden"
      :class="isMac ? 'bg-surface-1' : 'bg-surface-0 rounded-3xl shadow-panel'"
    >
      <!-- 品牌：Mac 红绿灯独占一行，字标另起一行 -->
      <div v-if="isMac" class="h-[38px] flex-shrink-0 app-drag" />
      <div
        class="flex items-center flex-shrink-0 px-4"
        :class="isWin ? 'h-11 app-drag' : 'h-11'"
      >
        <div class="flex items-center gap-2 min-w-0">
          <img
            v-if="appIconUrl"
            :src="appIconUrl"
            width="28"
            height="28"
            class="w-7 h-7 rounded-[9px] object-cover flex-shrink-0"
            style="width:28px;height:28px"
            alt=""
            draggable="false"
          />
          <div
            v-else
            class="w-7 h-7 rounded-[9px] bg-primary-600 flex items-center justify-center"
          >
            <span class="text-white text-[10px] font-bold leading-none tracking-tight">{{ appAbbr }}</span>
          </div>
          <span class="text-[13px] font-semibold text-text-primary tracking-tight truncate">HaoHuoBan</span>
        </div>
      </div>

      <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
        <!-- 固定动作：新建对话 → 创作 → 搜索 → 浏览器 → 智能体管理 → 每日回顾（自动化暂时下线） -->
        <nav class="px-2.5 space-y-0.5 flex-shrink-0">
          <button
            type="button"
            class="nav-item flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] text-text-secondary hover:bg-surface-2 transition-all duration-150 w-full text-left"
            title="新建对话 ⌘N"
            @click="onSidebarNewChat"
          >
            <svg class="w-[17px] h-[17px] flex-shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.375 2.625a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414l-9.193 9.193a2 2 0 0 1-.894.532l-2.821.704a.5.5 0 0 1-.61-.61l.704-2.821a2 2 0 0 1 .532-.894z" />
            </svg>
            <span class="font-medium flex-1">新建对话</span>
            <kbd class="text-[10px] text-text-tertiary font-normal">⌘N</kbd>
          </button>
          <template v-for="item in creationNavItems" :key="item.key || item.path">
            <div v-if="item.children">
              <button
                type="button"
                class="nav-item flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] text-text-secondary hover:bg-surface-2 transition-all duration-150 w-full text-left"
                :class="{ 'nav-active': isGroupActive(item) }"
                @click="toggleGroup(item.key)"
              >
                <component :is="item.icon" class="w-[17px] h-[17px] flex-shrink-0 opacity-80" />
                <span class="font-medium flex-1">{{ item.label }}</span>
                <IconChevron class="w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200" :class="{ 'rotate-90': expandedGroups.has(item.key) }" />
              </button>
              <div v-show="expandedGroups.has(item.key)" class="mt-0.5 space-y-0.5">
                <template v-for="child in item.children" :key="child.key || child.path">
                  <a
                    v-if="child.custom && child.custom.target_type === 'external'"
                    class="nav-item flex items-center gap-2.5 pl-8 pr-2.5 py-1.5 rounded-xl text-[13px] text-text-secondary hover:bg-surface-2 transition-all duration-150 cursor-pointer"
                    :title="child.custom.target"
                    @click="onCustomItemClick(child.custom)"
                  >
                    <component :is="child.icon" class="w-[15px] h-[15px] flex-shrink-0 opacity-80" />
                    <span class="font-medium">{{ child.label }}</span>
                  </a>
                  <router-link
                    v-else-if="child.custom"
                    :to="child.custom.target"
                    :class="['nav-item flex items-center gap-2.5 pl-8 pr-2.5 py-1.5 rounded-xl text-[13px] text-text-secondary hover:bg-surface-2 transition-all duration-150', isCustomInternalActive(child.custom) ? 'nav-active' : '']"
                  >
                    <component :is="child.icon" class="w-[15px] h-[15px] flex-shrink-0 opacity-80" />
                    <span class="font-medium">{{ child.label }}</span>
                  </router-link>
                  <router-link
                    v-else
                    :to="child.path"
                    class="nav-item flex items-center gap-2.5 pl-8 pr-2.5 py-1.5 rounded-xl text-[13px] text-text-secondary hover:bg-surface-2 transition-all duration-150"
                    active-class="nav-active"
                  >
                    <component :is="child.icon" class="w-[15px] h-[15px] flex-shrink-0 opacity-80" />
                    <span class="font-medium">{{ child.label }}</span>
                  </router-link>
                </template>
              </div>
            </div>
            <router-link
              v-else-if="item.path"
              :to="item.path"
              class="nav-item flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] text-text-secondary hover:bg-surface-2 transition-all duration-150"
              active-class="nav-active"
            >
              <component :is="item.icon" class="w-[17px] h-[17px] flex-shrink-0 opacity-80" />
              <span class="font-medium">{{ item.label }}</span>
            </router-link>
          </template>
          <button
            type="button"
            class="nav-item flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] text-text-secondary hover:bg-surface-2 transition-all duration-150 w-full text-left"
            title="搜索 ⌘K"
            @click="openNavSearch"
          >
            <svg class="w-[17px] h-[17px] flex-shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
            <span class="font-medium flex-1">搜索</span>
            <kbd class="text-[10px] text-text-tertiary font-normal">⌘K</kbd>
          </button>
          <template v-for="item in primaryNavItems" :key="item.key || item.path">
            <div v-if="item.children">
              <button
                type="button"
                class="nav-item flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] text-text-secondary hover:bg-surface-2 transition-all duration-150 w-full text-left"
                :class="{ 'nav-active': isGroupActive(item) }"
                @click="toggleGroup(item.key)"
              >
                <component :is="item.icon" class="w-[17px] h-[17px] flex-shrink-0 opacity-80" />
                <span class="font-medium flex-1">{{ item.label }}</span>
                <IconChevron class="w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200" :class="{ 'rotate-90': expandedGroups.has(item.key) }" />
              </button>
              <div v-show="expandedGroups.has(item.key)" class="mt-0.5 space-y-0.5">
                <router-link
                  v-for="child in item.children"
                  :key="child.path"
                  :to="child.path"
                  class="nav-item flex items-center gap-2.5 pl-8 pr-2.5 py-1.5 rounded-xl text-[13px] text-text-secondary hover:bg-surface-2 transition-all duration-150"
                  active-class="nav-active"
                >
                  <component :is="child.icon" class="w-[15px] h-[15px] flex-shrink-0 opacity-80" />
                  <span class="font-medium">{{ child.label }}</span>
                </router-link>
              </div>
            </div>
            <a
              v-else-if="item.custom && item.custom.target_type === 'external'"
              class="nav-item flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] text-text-secondary hover:bg-surface-2 transition-all duration-150 cursor-pointer"
              :title="item.custom.target"
              @click="onCustomItemClick(item.custom)"
            >
              <component :is="item.icon" class="w-[17px] h-[17px] flex-shrink-0 opacity-80" />
              <span class="font-medium">{{ item.label }}</span>
            </a>
            <router-link
              v-else-if="item.custom"
              :to="item.custom.target"
              :class="['nav-item flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] text-text-secondary hover:bg-surface-2 transition-all duration-150', isCustomInternalActive(item.custom) ? 'nav-active' : '']"
            >
              <component :is="item.icon" class="w-[17px] h-[17px] flex-shrink-0 opacity-80" />
              <span class="font-medium">{{ item.label }}</span>
            </router-link>
            <router-link
              v-else
              :to="item.path"
              class="nav-item flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] text-text-secondary hover:bg-surface-2 transition-all duration-150"
              active-class="nav-active"
            >
              <component :is="item.icon" class="w-[17px] h-[17px] flex-shrink-0 opacity-80" />
              <span class="font-medium">{{ item.label }}</span>
            </router-link>
          </template>
        </nav>

        <div class="flex-1 min-h-0 overflow-y-auto px-2.5 pt-2 pb-2">
          <div class="h-px bg-surface-2 mx-1 mb-2" />
          <!-- 工作区：列出本机文件夹 -->
          <div class="mb-2.5">
            <div class="group/head w-full flex items-center gap-0.5 px-1 py-0.5">
              <button
                type="button"
                class="flex-1 flex items-center gap-1.5 min-w-0 rounded-lg px-1 py-1 text-left hover:bg-surface-2"
                @click="workspaceExpanded = !workspaceExpanded"
              >
                <IconChevron class="w-3 h-3 text-text-tertiary flex-shrink-0 transition-transform duration-150" :class="{ 'rotate-90': workspaceExpanded }" />
                <span class="text-[12px] font-medium text-text-tertiary truncate">工作区</span>
                <span
                  v-if="agentWorkspaceStore.items.length"
                  class="ml-0.5 min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full bg-surface-2 text-[10px] text-text-tertiary tabular-nums"
                >{{ agentWorkspaceStore.items.length }}</span>
              </button>
              <button
                type="button"
                class="p-1 text-text-tertiary hover:text-text-primary hover:bg-surface-2 rounded-lg"
                title="打开现有文件夹"
                @click="openWorkspaceFolder"
              >
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              </button>
            </div>
            <div v-show="workspaceExpanded" class="mt-0.5 pl-1 pr-0.5 pb-0.5 max-h-48 overflow-y-auto space-y-0.5">
              <p v-if="!agentWorkspaceStore.items.length" class="px-2 py-2 text-[12px] text-text-tertiary">还没有工作区，点右侧加号打开文件夹</p>
              <div
                v-for="ws in agentWorkspaceStore.items"
                :key="ws.id"
                class="group flex items-center gap-0.5 rounded-lg"
                :class="ws.id === agentWorkspaceStore.activeId ? 'nav-active' : 'hover:bg-surface-2'"
              >
                <button
                  type="button"
                  class="flex-1 min-w-0 flex items-center gap-2 text-left px-2 py-1.5 rounded-lg transition-colors"
                  :class="ws.id === agentWorkspaceStore.activeId ? 'text-text-primary' : 'text-text-secondary'"
                  :title="ws.root_path"
                  @click="selectWorkspace(ws.id)"
                >
                  <IconFolder class="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                  <span class="text-[13px] truncate">{{ ws.name }}</span>
                  <span
                    v-if="ws.is_default"
                    class="flex-shrink-0 text-[10px] leading-4 px-1 rounded border border-surface-3 text-text-tertiary"
                  >默认</span>
                </button>
                <button
                  v-if="!ws.is_default && confirmDeleteWsId !== ws.id"
                  type="button"
                  class="p-1 mr-0.5 text-text-tertiary hover:text-red-500 flex-shrink-0 opacity-0 group-hover:opacity-100"
                  title="从列表移除（不删除文件夹）"
                  @click.stop="confirmDeleteWsId = ws.id"
                >
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
                </button>
                <button
                  v-else-if="confirmDeleteWsId === ws.id"
                  type="button"
                  class="px-1.5 mr-0.5 text-[10px] text-red-500 flex-shrink-0"
                  title="确认移除"
                  @click.stop="removeWorkspace(ws.id)"
                >确认</button>
              </div>
            </div>
          </div>

          <!-- 最近对话 -->
          <div class="mb-2.5">
            <div class="group/head flex items-center gap-0.5 px-1 py-0.5">
              <button
                type="button"
                class="flex-1 flex items-center gap-1.5 min-w-0 px-1 py-1 rounded-lg hover:bg-surface-2 text-left"
                :title="recentExpanded ? '折叠最近对话' : '展开最近对话'"
                @click="recentExpanded = !recentExpanded"
              >
                <IconChevron
                  class="w-3 h-3 text-text-tertiary flex-shrink-0 transition-transform duration-150"
                  :class="{ 'rotate-90': recentExpanded }"
                />
                <span class="text-[12px] font-medium text-text-tertiary truncate">最近对话</span>
                <span
                  v-if="recentConversations.length"
                  class="ml-0.5 min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full bg-surface-2 text-[10px] text-text-tertiary tabular-nums"
                >{{ recentConversations.length }}</span>
              </button>
              <button
                type="button"
                class="p-1 rounded-lg flex-shrink-0"
                :class="recentManaging ? 'text-text-primary bg-surface-2' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-2'"
                :title="recentManaging ? '完成管理' : '管理对话'"
                @click="toggleRecentManaging"
              >
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" /></svg>
              </button>
              <button
                type="button"
                class="p-1 text-text-tertiary hover:text-text-primary hover:bg-surface-2 rounded-lg flex-shrink-0"
                title="新对话 ⌘N"
                @click="onSidebarNewChat"
              >
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              </button>
            </div>

            <div v-show="recentExpanded" class="mt-0.5 pl-1 pr-0.5 pb-0.5 max-h-52 overflow-y-auto space-y-0.5">
              <div v-if="!recentConversations.length" class="px-2 py-2.5 text-[12px] text-text-tertiary">还没有开始对话</div>
              <div
                v-for="conv in recentConversations"
                :key="conv.id"
                class="group flex items-center gap-0.5 rounded-lg"
                :class="isRecentActive(conv.id) ? 'nav-active' : 'hover:bg-surface-2'"
              >
                <input
                  v-if="renamingId === conv.id"
                  :ref="(el) => setRenameInputRef(el, conv.id)"
                  v-model="renameDraft"
                  class="flex-1 min-w-0 mx-1 px-1.5 py-1 text-[12px] rounded-md border border-surface-3 bg-surface-0 outline-none"
                  @keydown.enter.prevent="commitRename(conv.id)"
                  @keydown.escape.prevent="cancelRename"
                  @blur="commitRename(conv.id)"
                  @click.stop
                />
                <button
                  v-else
                  type="button"
                  class="flex-1 min-w-0 flex items-center gap-2 text-left px-2 py-1.5 transition-colors"
                  :class="isRecentActive(conv.id) ? 'text-text-primary' : 'text-text-secondary'"
                  :title="displayConvTitle(conv.title)"
                  @click="onSidebarOpenChat(conv.id)"
                  @dblclick.stop="startRename(conv)"
                >
                  <IconChat class="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                  <span class="text-[13px] truncate">{{ displayConvTitle(conv.title) }}</span>
                </button>
                <template v-if="recentManaging && renamingId !== conv.id">
                  <button
                    type="button"
                    class="p-1 text-text-tertiary hover:text-text-primary flex-shrink-0"
                    title="重命名"
                    @click.stop="startRename(conv)"
                  >
                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>
                  </button>
                  <button
                    v-if="confirmDeleteId !== conv.id"
                    type="button"
                    class="p-1 text-text-tertiary hover:text-red-500 flex-shrink-0 disabled:opacity-30"
                    title="删除"
                    :disabled="chatStore.isConversationStreaming(conv.id)"
                    @click.stop="confirmDeleteId = conv.id"
                  >
                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
                  </button>
                  <button
                    v-else
                    type="button"
                    class="px-1.5 text-[10px] text-red-500 flex-shrink-0"
                    @click.stop="onSidebarDelete(conv.id)"
                  >确认</button>
                </template>
              </div>
            </div>
          </div>

          <!-- 归档（壳，后续接会话归档） -->
          <div class="mb-1">
            <button
              type="button"
              class="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-text-tertiary hover:bg-surface-2"
              @click="archiveExpanded = !archiveExpanded"
            >
              <IconChevron class="w-3 h-3 flex-shrink-0 transition-transform duration-150" :class="{ 'rotate-90': archiveExpanded }" />
              <IconArchive class="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
              <span class="text-[12px] font-medium">归档</span>
            </button>
            <div v-show="archiveExpanded" class="pl-7 pr-2 py-2 text-[12px] text-text-tertiary">
              暂无归档会话
            </div>
          </div>

          <!-- 更多：其余垂直工具下沉 -->
          <div class="pt-1">
            <template v-for="item in moreNavItems" :key="item.key || item.path">
              <div v-if="item.children">
                <button
                  type="button"
                  class="nav-item flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] text-text-secondary hover:bg-surface-2 transition-all duration-150 w-full text-left"
                  :class="{ 'nav-active': isGroupActive(item) }"
                  @click="toggleGroup(item.key)"
                >
                  <component :is="item.icon" class="w-[17px] h-[17px] flex-shrink-0 opacity-80" />
                  <span class="font-medium flex-1">{{ item.label }}</span>
                  <IconChevron class="w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200" :class="{ 'rotate-90': expandedGroups.has(item.key) }" />
                </button>
                <div v-show="expandedGroups.has(item.key)" class="mt-0.5 space-y-0.5">
                  <template v-for="child in item.children" :key="child.key || child.path">
                    <a
                      v-if="child.custom && child.custom.target_type === 'external'"
                      class="nav-item flex items-center gap-2.5 pl-8 pr-2.5 py-1.5 rounded-xl text-[13px] text-text-secondary hover:bg-surface-2 transition-all duration-150 cursor-pointer"
                      :title="child.custom.target"
                      @click="onCustomItemClick(child.custom)"
                    >
                      <component :is="child.icon" class="w-[15px] h-[15px] flex-shrink-0 opacity-80" />
                      <span class="font-medium">{{ child.label }}</span>
                    </a>
                    <router-link
                      v-else-if="child.custom"
                      :to="child.custom.target"
                      :class="['nav-item flex items-center gap-2.5 pl-8 pr-2.5 py-1.5 rounded-xl text-[13px] text-text-secondary hover:bg-surface-2 transition-all duration-150', isCustomInternalActive(child.custom) ? 'nav-active' : '']"
                    >
                      <component :is="child.icon" class="w-[15px] h-[15px] flex-shrink-0 opacity-80" />
                      <span class="font-medium">{{ child.label }}</span>
                    </router-link>
                    <router-link
                      v-else
                      :to="child.path"
                      class="nav-item flex items-center gap-2.5 pl-8 pr-2.5 py-1.5 rounded-xl text-[13px] text-text-secondary hover:bg-surface-2 transition-all duration-150"
                      active-class="nav-active"
                    >
                      <component :is="child.icon" class="w-[15px] h-[15px] flex-shrink-0 opacity-80" />
                      <span class="font-medium">{{ child.label }}</span>
                    </router-link>
                  </template>
                </div>
              </div>
              <router-link
                v-else-if="item.path"
                :to="item.path"
                class="nav-item flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] text-text-secondary hover:bg-surface-2 transition-all duration-150"
                active-class="nav-active"
              >
                <component :is="item.icon" class="w-[17px] h-[17px] flex-shrink-0 opacity-80" />
                <span class="font-medium">{{ item.label }}</span>
              </router-link>
            </template>
          </div>
        </div>
      </div>

      <div class="px-2.5 py-2.5 border-t border-surface-2 space-y-0.5 flex-shrink-0">
        <div class="flex items-center gap-1">
          <router-link
            to="/user-center"
            class="nav-item flex-1 min-w-0 flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] text-text-secondary hover:bg-surface-2 transition-all duration-150"
            active-class="nav-active"
          >
            <IconUser class="w-[17px] h-[17px] flex-shrink-0 opacity-80" />
            <span class="font-medium truncate">{{ cloudAuth.user?.nickname || cloudAuth.user?.username || '\u7528\u6237' }}</span>
          </router-link>
          <button
            type="button"
            class="p-2 rounded-xl text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors"
            :class="{ 'nav-active !text-text-primary': settingsUi.open }"
            title="设置"
            @click="settingsUi.show()"
          >
            <IconSettings class="w-[17px] h-[17px]" />
          </button>
        </div>
      </div>
    </aside>
    <main
      class="flex-1 overflow-hidden flex flex-col relative bg-surface-0 min-w-0"
      :class="isMac ? 'mt-0 mr-3 mb-3 rounded-3xl shadow-panel' : 'rounded-3xl shadow-panel'"
    >
      <header
        v-if="!isChatRoute"
        class="h-10 flex-shrink-0 flex items-center px-5 gap-3"
        :class="[isWin ? 'pr-40' : '', (isWin || isMac) ? 'app-drag' : '']"
      >
        <h1 class="text-sm font-semibold text-text-primary flex-shrink-0">{{ pageTitle }}</h1>
        <!-- 全局公告条：登录后自动显示当前启用的最新一条；点击展开全文弹窗。
             放在 pageTitle 右侧 + 画布徽标左侧，画布运行时仍可点击（徽标 ml-auto 抢占右侧）。
             根元素是 button，main.css 的 `.app-drag button` 规则会自动 no-drag，无需额外 class -->
        <AnnouncementBar />
        <ExpiryGlobalBanner />
        <!-- 全局画布任务徽标：anyRunning 时显示，跨页面可见，让用户知道任务仍在后台执行 -->
        <div
          v-if="canvasAnyRunning && !isCanvasRoute"
          class="ml-auto flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700/40 dark:text-amber-300"
        >
          <span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
          <button
            type="button"
            class="text-[11px] font-medium hover:underline"
            @click="goToRunningCanvas"
            :title="canvasRunningProjectIds.length ? '回到正在运行的画布' : '画布有节点在生成'"
          >画布生成中{{ canvasActiveCount > 0 ? ` (${canvasActiveCount})` : '' }}</button>
          <button
            v-if="canvasWorkflowRunning"
            type="button"
            class="text-[11px] px-1.5 py-0.5 rounded border border-amber-300 hover:bg-amber-100 dark:border-amber-700/60 dark:hover:bg-amber-900/30"
            @click="onCancelCanvas"
            title="停止画布工作流（已开始的节点会跑完）"
          >停止</button>
        </div>
      </header>
      <div v-if="!isChatRoute" class="h-px bg-surface-2 flex-shrink-0" />
      <div
        v-else
        class="absolute top-0 left-0 right-0 z-20 flex items-center gap-2 px-3 pt-2 pointer-events-none"
        :class="[isWin ? 'pr-40' : '']"
      >
        <div class="pointer-events-auto flex items-center gap-2 min-w-0" :class="{ 'app-drag': isWin }">
          <AnnouncementBar />
          <ExpiryGlobalBanner />
        </div>
        <div
          v-if="canvasAnyRunning && !isCanvasRoute"
          class="pointer-events-auto ml-auto flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-700"
        >
          <button type="button" class="text-[11px] font-medium hover:underline" @click="goToRunningCanvas">画布生成中</button>
        </div>
      </div>
      <div class="flex-1 overflow-hidden flex flex-col min-h-0">
        <router-view />
      </div>
    </main>

    <!-- 全局余额不足弹窗：任意云端调用命中 402 时统一展示充值引导 -->
    <LowBalanceModal
      v-model:visible="lowBalance.visible"
      :balance-type="lowBalance.balanceType"
      :required="lowBalance.required"
      :available="lowBalance.available"
    />

    <PythonRequiredModal
      :open="pythonModal.open"
      :reason="pythonModal.reason"
      :install-hint="pythonModal.installHint"
      :busy="pythonModal.busy"
      @close="pythonModal.open = false"
      @recheck="recheckPython"
      @install="openPythonInstall"
      @pick="pickPython"
    />

    <SettingsView />

    <div
      v-if="showNavSearch"
      class="fixed inset-0 z-[80] flex items-start justify-center pt-[15vh] bg-black/20"
      @click.self="showNavSearch = false"
    >
      <div class="w-[420px] max-w-[90vw] bg-surface-0 border border-surface-3 rounded-xl shadow-modal overflow-hidden">
        <div class="px-3 py-2.5 border-b border-surface-3 flex items-center gap-2">
          <span class="text-[10px] text-text-tertiary">⌘K</span>
          <input
            v-model="navSearchQuery"
            class="flex-1 text-sm bg-transparent outline-none text-text-primary placeholder:text-text-tertiary"
            placeholder="搜索功能入口…"
            autofocus
            @keydown.escape="showNavSearch = false"
            @keydown.enter.prevent="navSearchResults[0] && goNavSearch(navSearchResults[0].path)"
          />
        </div>
        <div class="max-h-72 overflow-y-auto py-1">
          <button
            v-for="item in navSearchResults"
            :key="item.path"
            type="button"
            class="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-surface-2 hover:text-text-primary"
            @click="goNavSearch(item.path)"
          >
            {{ item.label }}
          </button>
          <div v-if="!navSearchResults.length" class="px-3 py-6 text-center text-xs text-text-tertiary">无匹配入口</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorkflowEngine } from '@/views/canvas/composables/useWorkflowEngine'
import LowBalanceModal from '@/components/LowBalanceModal.vue'
import PythonRequiredModal from '@/components/PythonRequiredModal.vue'
import SettingsView from '@/views/settings/SettingsView.vue'
import { useLowBalanceStore } from '@/stores/low-balance'
import { useSettingsUiStore } from '@/stores/settings-ui'
import IconBot from '@/components/icons/IconBot.vue'
import IconKnowledge from '@/components/icons/IconKnowledge.vue'
import IconPersona from '@/components/icons/IconPersona.vue'
import IconSkill from '@/components/icons/IconSkill.vue'
import IconMcp from '@/components/icons/IconMcp.vue'
import IconTool from '@/components/icons/IconTool.vue'
import IconSettings from '@/components/icons/IconSettings.vue'
import IconChevron from '@/components/icons/IconChevron.vue'
import IconExtension from '@/components/icons/IconExtension.vue'
import IconImageGen from '@/components/icons/IconImageGen.vue'
import IconInspiration from '@/components/icons/IconInspiration.vue'
import IconBatchGen from '@/components/icons/IconBatchGen.vue'
import IconImage2Prompt from '@/components/icons/IconImage2Prompt.vue'
import IconPrompt from '@/components/icons/IconPrompt.vue'
import IconCanvas from '@/components/icons/IconCanvas.vue'
import IconGallery from '@/components/icons/IconGallery.vue'
import IconUser from '@/components/icons/IconUser.vue'
import IconAICreation from '@/components/icons/IconAICreation.vue'
import IconVideoGen from '@/components/icons/IconVideoGen.vue'
import IconViralClone from '@/components/icons/IconViralClone.vue'
import IconVideoCreation from '@/components/icons/IconVideoCreation.vue'
import IconCanvasSquare from '@/components/icons/IconCanvasSquare.vue'
import IconImageToolkit from '@/components/icons/IconImageToolkit.vue'
import IconEweiShop from '@/components/icons/IconEweiShop.vue'
import IconDailyReview from '@/components/icons/IconDailyReview.vue'
import IconBrowser from '@/components/icons/IconBrowser.vue'
import IconChat from '@/components/icons/IconChat.vue'
import IconFolder from '@/components/icons/IconFolder.vue'
import IconArchive from '@/components/icons/IconArchive.vue'
import IconCustomLink from '@/components/icons/IconCustomLink.vue'
import IconCustomPage from '@/components/icons/IconCustomPage.vue'
import IconCustomApp from '@/components/icons/IconCustomApp.vue'
import IconCustomStar from '@/components/icons/IconCustomStar.vue'
import AnnouncementBar from '@/components/AnnouncementBar.vue'
import ExpiryGlobalBanner from '@/components/ExpiryGlobalBanner.vue'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useSiteConfigStore } from '@/stores/site-config'
import { useClawbotStore } from '@/stores/clawbot'
import { useChatStore } from '@/stores/chat'
import { cloudClient } from '@/utils/cloud-api'
import { appAbbr, appIconUrl } from '@/utils/branding'
import { cacheMenuOverrides } from '@/utils/home-path'
import { useAgentWorkspaceStore } from '@/stores/agent-workspaces'

const route = useRoute()
const router = useRouter()
const cloudAuth = useCloudAuthStore()
const siteConfig = useSiteConfigStore()
const chatStore = useChatStore()
const lowBalance = useLowBalanceStore()
const settingsUi = useSettingsUiStore()
const pythonModal = ref({
  open: false,
  reason: '',
  installUrl: 'https://www.python.org/downloads/',
  installHint: '请安装 Python 3 后再试。',
  busy: false
})
let unsubPythonRequired: (() => void) | null = null

function applyPythonStatus(st: {
  ready: boolean
  reason?: string
  installUrl?: string
  installHint?: string
}) {
  if (st.ready) {
    pythonModal.value.open = false
    return
  }
  pythonModal.value.reason = st.reason || '未检测到 Python'
  pythonModal.value.installUrl = st.installUrl || pythonModal.value.installUrl
  pythonModal.value.installHint = st.installHint || pythonModal.value.installHint
  pythonModal.value.open = true
}

async function recheckPython() {
  pythonModal.value.busy = true
  try {
    const st = await window.api.python.status()
    applyPythonStatus(st)
  } finally {
    pythonModal.value.busy = false
  }
}

async function openPythonInstall() {
  const url = pythonModal.value.installUrl || 'https://www.python.org/downloads/'
  await window.api.shell.openExternal(url)
}

async function pickPython() {
  const picked = (await window.api.dialog.openFile({
    title: '选择 Python 解释器',
    properties: ['openFile']
  })) as { canceled?: boolean; filePaths?: string[] }
  if (picked?.canceled || !picked?.filePaths?.[0]) return
  pythonModal.value.busy = true
  try {
    const st = await window.api.python.setPath(picked.filePaths[0])
    applyPythonStatus(st)
    if (!st.ready) pythonModal.value.reason = st.reason || '无法使用所选文件'
  } finally {
    pythonModal.value.busy = false
  }
}

const pageTitle = computed(() => (route.meta?.title as string) || '')

const recentConversations = computed(() => chatStore.conversations.slice(0, 12))
const agentWorkspaceStore = useAgentWorkspaceStore()

function isRecentActive(id: string): boolean {
  return id === chatStore.currentConversationId && (route.path === '/chat' || route.path.startsWith('/chat/'))
}

const RECENT_EXPANDED_KEY = 'sidebar.recentConversations.expanded'
const WORKSPACE_EXPANDED_KEY = 'sidebar.workspaces.expanded'
const archiveExpanded = ref(false)
const workspaceExpanded = ref(localStorage.getItem(WORKSPACE_EXPANDED_KEY) !== '0')
const recentExpanded = ref(localStorage.getItem(RECENT_EXPANDED_KEY) !== '0')
const recentManaging = ref(false)
const renamingId = ref<string | null>(null)
const renameDraft = ref('')
const confirmDeleteId = ref<string | null>(null)
const confirmDeleteWsId = ref<string | null>(null)
const renameInputEls = new Map<string, HTMLInputElement>()

watchEffect(() => {
  localStorage.setItem(RECENT_EXPANDED_KEY, recentExpanded.value ? '1' : '0')
})
watchEffect(() => {
  localStorage.setItem(WORKSPACE_EXPANDED_KEY, workspaceExpanded.value ? '1' : '0')
})

async function selectWorkspace(id: string) {
  confirmDeleteWsId.value = null
  try {
    await agentWorkspaceStore.setActive(id)
    if (route.path !== '/chat') router.push('/chat')
  } catch {
    /* ignore */
  }
}

async function removeWorkspace(id: string) {
  confirmDeleteWsId.value = null
  try {
    await agentWorkspaceStore.remove(id)
  } catch (e) {
    console.error('[sidebar] remove workspace failed:', e)
  }
}

async function openWorkspaceFolder() {
  try {
    const result = (await window.api.dialog.openFile({
      title: '选择工作区文件夹',
      properties: ['openDirectory']
    })) as { canceled: boolean; filePaths: string[] }
    if (result.canceled || !result.filePaths.length) return
    await agentWorkspaceStore.openFolder(result.filePaths[0])
    workspaceExpanded.value = true
    if (route.path !== '/chat') router.push('/chat')
  } catch {
    /* ignore */
  }
}

function displayConvTitle(title?: string): string {
  const t = (title || '').trim()
  if (!t || t === 'New Chat') return '新对话'
  return t
}

function toggleRecentManaging() {
  recentManaging.value = !recentManaging.value
  if (!recentManaging.value) {
    cancelRename()
    confirmDeleteId.value = null
  } else {
    recentExpanded.value = true
  }
}

function setRenameInputRef(el: unknown, id: string) {
  if (el && (el as HTMLInputElement).tagName === 'INPUT') {
    renameInputEls.set(id, el as HTMLInputElement)
  } else {
    renameInputEls.delete(id)
  }
}

async function startRename(conv: { id: string; title: string }) {
  recentManaging.value = true
  renamingId.value = conv.id
  renameDraft.value = displayConvTitle(conv.title)
  confirmDeleteId.value = null
  await nextTick()
  renameInputEls.get(conv.id)?.focus()
  renameInputEls.get(conv.id)?.select()
}

function cancelRename() {
  renamingId.value = null
  renameDraft.value = ''
}

async function commitRename(id: string) {
  if (renamingId.value !== id) return
  const title = renameDraft.value.trim()
  renamingId.value = null
  if (!title) return
  const conv = chatStore.conversations.find((c) => c.id === id)
  if (conv && displayConvTitle(conv.title) === title) return
  try {
    // IPC updateTitle 默认 manual=true，会锁定标题避免被自动生成覆盖
    await chatStore.updateTitle(id, title)
  } catch (e) {
    console.error('[sidebar] rename failed:', e)
  }
}

async function onSidebarDelete(id: string) {
  confirmDeleteId.value = null
  try {
    await chatStore.deleteConversation(id)
  } catch (e) {
    console.error('[sidebar] delete failed:', e)
  }
}

async function onSidebarNewChat() {
  chatStore.startNewChat()
  if (route.path !== '/chat') await router.push({ path: '/chat' })
}

async function onSidebarOpenChat(id: string) {
  if (recentManaging.value && renamingId.value) return
  const conv = chatStore.conversations.find((c) => c.id === id)
  if (conv && (conv.bot_id || '') !== (chatStore.currentBotId || '')) {
    // 避免 ChatView watch(selectedBotId) reset 清掉刚选中的会话：先选会话再切页
    await chatStore.selectConversation(id)
  }
  if (route.path !== '/chat') await router.push('/chat')
  await chatStore.selectConversation(id)
}
// 画布任务全局徽标：useWorkflowEngine 是 module-level singleton，
// MainLayout 内 mount 时取到的就是任何位置（节点 / CanvasEditorView）共享的状态。
const {
  anyRunningGlobal: canvasAnyRunning,
  workflowRunningGlobal: canvasWorkflowRunning,
  activeSingleRunCount: canvasActiveSingleRunCount,
  runningProjectIds: canvasRunningProjectIds,
  cancelAllWorkflows: cancelCanvasWorkflow
} = useWorkflowEngine()

const canvasActiveCount = computed(() => {
  // workflow 模式下统计所有节点过于复杂，简化为：workflow 模式不显示数字、单节点模式显示数量
  if (canvasWorkflowRunning.value) return 0
  return canvasActiveSingleRunCount.value
})

const isCanvasRoute = computed(() => route.path.startsWith('/canvas'))
const isChatRoute = computed(() => route.path === '/chat' || route.path.startsWith('/chat/'))

function goToRunningCanvas() {
  const pid = canvasRunningProjectIds.value[0]
  if (pid) {
    router.push(`/canvas/${pid}`)
  } else {
    router.push('/canvas')
  }
}

function onCancelCanvas() {
  cancelCanvasWorkflow()
}

// 平台判断：Win 用自定义无边框 + titleBarOverlay（需 app-drag + 右侧 padding 让位控件按钮），
// Mac 用 hiddenInset（红绿灯在侧栏顶），Linux 用原生标题栏。
const platform = ((window as any).electron?.process?.platform || (window as any).runtimeConfig?.platform || '')
const isWin = platform === 'win32'
const isMac = platform === 'darwin'

const allNavItems = [
  // 自动化（/scheduled-tasks）暂时下线：恢复时加回本项，并取消路由重定向、重新启调度
  { path: '/browser', label: '浏览器', icon: IconBrowser, tier: 'primary' },
  {
    key: 'group:skills',
    label: '数字员工',
    icon: IconBot,
    tier: 'primary',
    children: [
      { path: '/bots', label: '数字员工', icon: IconBot },
      { path: '/knowledge', label: '知识库', icon: IconKnowledge },
      { path: '/skills', label: '技能库', icon: IconSkill },
      { path: '/mcps', label: 'MCP', icon: IconMcp }
    ]
  },
  { path: '/daily-review', label: '每日回顾', icon: IconDailyReview, tier: 'primary' },
  { path: '/inspiration', label: '灵感广场', icon: IconInspiration, tier: 'creation' },
  {
    key: 'group:image-creation',
    label: '图片创作',
    icon: IconAICreation,
    tier: 'creation',
    children: [
      { path: '/image-gen', label: 'AI 生图', icon: IconImageGen },
      { path: '/batch-gen', label: '批量生图', icon: IconBatchGen },
      { path: '/image-to-prompt', label: '图片反推', icon: IconImage2Prompt },
      { path: '/image-toolkit', label: '图像处理', icon: IconImageToolkit },
      { path: '/canvas', label: '图片工作流', icon: IconCanvas },
      { path: '/canvas-square', label: '工作流模板', icon: IconCanvasSquare },
      { path: '/ewei', label: '店铺商品图', icon: IconEweiShop, requireAnyPermission: ['allow_ewei_shop', 'allow_dianda_shop', 'allow_qdyun_shop'] },
      { path: '/my-creations', label: '图片作品', icon: IconImageGen }
    ]
  },
  {
    key: 'group:video-creation',
    label: '视频创作',
    icon: IconVideoGen,
    tier: 'creation',
    children: [
      { path: '/ai-video', label: 'AI 视频', icon: IconVideoGen },
      { path: '/viral-clone', label: '爆款复刻', icon: IconViralClone },
      { path: '/video-creations', label: '视频作品', icon: IconVideoCreation }
    ]
  },
  {
    key: 'group:more',
    label: '更多',
    icon: IconExtension,
    tier: 'secondary',
    children: [
      { path: '/gallery', label: '本地图库', icon: IconGallery },
      { path: '/image-toolkit/remove-ai-mark', label: '去AI标记', icon: IconImageToolkit, requireSiteFeature: 'aiMarkRemoval' },
      // D-32：提示词库作为低频管理入口露出；日常仍从对话插入 / 生图「存为」。
      { path: '/prompts', label: '提示词库', icon: IconPrompt },
      // D-27：人设写在智能体表单，小工具在智能体「高级」。路由仍可打开。
      { path: '/personas', label: '人设规则', icon: IconPersona, hidden: true },
      { path: '/tools', label: '小工具', icon: IconTool, hidden: true }
    ]
  }
]

const expandedGroups = ref<Set<string>>(new Set())

// 云控端「桌面端菜单配置」：{ menu_key: { visible, title } }；登录后拉取，覆盖默认菜单的显隐与名称。
// menu_key：叶子菜单用 path，分组用 group:xxx。「模型服务 / AI 抠图」不下发（继续按功能权限）。
const menuOverrides = ref<Record<string, { visible: boolean; title: string }>>({})
// 云控端「自定义菜单」：后台维护的额外菜单项（内部路由 / 外部链接），随同一端点下发（仅可见项、已按 sort 排序）
interface CustomMenuItem {
  key: string
  title: string
  group_key: string
  target_type: 'internal' | 'external'
  target: string
  open_mode: 'browser' | 'window'
  icon: string
}
const customMenuItems = ref<CustomMenuItem[]>([])
onMounted(async () => {
  agentWorkspaceStore.refresh().catch(() => {})
  try {
    const res: any = await cloudClient.desktopMenu()
    menuOverrides.value = res?.overrides && typeof res.overrides === 'object' ? res.overrides : {}
    // 写入本地缓存：下次启动「/」重定向（发生在本组件挂载前）据此判断首页是 /chat 还是回退 /bots
    cacheMenuOverrides(menuOverrides.value)
    // 合并前过滤脏数据（字段缺失 / target_type 非法 / 目标为空或协议不符的项直接丢弃），
    // 防云端脏数据导致渲染出点击无反应的死菜单
    customMenuItems.value = Array.isArray(res?.custom_items)
      ? res.custom_items.filter((c: any) => {
          if (!c || typeof c.key !== 'string' || !c.key) return false
          if (typeof c.title !== 'string' || !c.title) return false
          if (typeof c.target !== 'string' || !c.target) return false
          if (c.target_type === 'internal') return c.target.startsWith('/')
          if (c.target_type === 'external') return /^https?:\/\//i.test(c.target)
          return false
        })
      : []
  } catch {
    menuOverrides.value = {}
    customMenuItems.value = []
  }
})

// 自定义菜单图标 key → 内置 SVG 组件（与云控端 CUSTOM_ICONS 枚举对齐；未知 key 回落链接图标）
const CUSTOM_ICON_MAP: Record<string, any> = {
  link: IconCustomLink,
  page: IconCustomPage,
  app: IconCustomApp,
  star: IconCustomStar
}

/** 自定义菜单点击：internal 走路由；external 按 open_mode 走系统浏览器 / 应用内独立窗口；失败给可见反馈 */
async function onCustomItemClick(item: CustomMenuItem) {
  if (item.target_type === 'internal') {
    const path = (item.target || '').split('?')[0]
    if (path === '/models') {
      settingsUi.show('models')
      return
    }
    router.push(item.target)
    return
  }
  const api = (window as any).api
  try {
    const res =
      item.open_mode === 'window'
        ? await api.shell.openExternalWindow(item.target, item.title)
        : await api.shell.openExternal(item.target)
    // openExternal 协议被主进程白名单拦截返回 false；openExternalWindow 校验失败返回 { success: false, error }
    if (res === false || (res && typeof res === 'object' && res.success === false)) {
      api.nativeDialog.alert(`无法打开链接：${item.target}${res?.error ? `\n${res.error}` : ''}`)
    }
  } catch (e: any) {
    api.nativeDialog.alert(`无法打开链接：${item.target}\n${e?.message || e}`)
  }
}

/** 自定义 internal 菜单的 active 判定：带 query/锚点的目标用 fullPath 精确匹配
 * （否则 /models?tab=video 与内置「模型服务」/models 会同时高亮——router-link 的 active 不按 query 区分），
 * 纯路径目标与内置一致按前缀匹配（子路由页面保持高亮） */
function isCustomInternalActive(c: CustomMenuItem): boolean {
  if (c.target.includes('?') || c.target.includes('#')) return route.fullPath === c.target
  return pathMatches(route.path, c.target)
}

onMounted(() => {
  useClawbotStore().initClawbotListeners()
})

/**
 * 路径匹配：避免 `/canvas-square` 错命中 `/canvas` 这种「字符串前缀但语义不同」的情况。
 * 规则：完全相等 OR 完全相等 + 紧跟 `/`（用于带 :id 的子路径，比如 /canvas/abc）。
 * menuPath 先剥 query/锚点（自定义菜单 internal 目标可能带 ?tab=xxx），否则永不命中。
 */
function pathMatches(routePath: string, menuPath: string): boolean {
  const pure = (menuPath || '').split('?')[0].split('#')[0]
  if (!pure) return false
  return routePath === pure || routePath.startsWith(pure + '/')
}

watchEffect(() => {
  for (const item of allNavItems as any[]) {
    if (item.children?.some((child: any) => pathMatches(route.path, child.path))) {
      expandedGroups.value.add(item.key)
    }
  }
  // 自定义菜单 internal 子项命中当前路由时，所在组同样自动展开
  for (const c of customMenuItems.value) {
    if (!c.group_key || c.target_type !== 'internal') continue
    if (pathMatches(route.path, c.target)) expandedGroups.value.add(c.group_key)
  }
})

function toggleGroup(key: string) {
  if (expandedGroups.value.has(key)) {
    expandedGroups.value.delete(key)
  } else {
    expandedGroups.value.add(key)
  }
}

function isGroupActive(item: any) {
  return item.children?.some((child: any) => pathMatches(route.path, child.path))
}

function passesPermissionFilter(item: any): boolean {
  // 单个 key：requirePermission 必须为真
  if (item.requirePermission && !(cloudAuth.permissions as any)[item.requirePermission]) {
    return false
  }
  // 任一 key 命中即可：requireAnyPermission（数组），用于「模型服务」这种合并入口
  if (Array.isArray(item.requireAnyPermission)) {
    const anyTrue = item.requireAnyPermission.some(
      (k: string) => Boolean((cloudAuth.permissions as any)[k]),
    )
    if (!anyTrue) return false
  }
  // 站点级功能显示开关（如去AI标记，由系统设置全局控制、经 site-config 下发；与个人权限无关）
  if (item.requireSiteFeature && !(siteConfig.features as any)[item.requireSiteFeature]) {
    return false
  }
  return true
}

const navItems = computed(() => {
  const cfg = menuOverrides.value
  // 叶子项：先过功能权限；权限项（模型服务 / AI 抠图）不受菜单配置影响；其余按云端 override 隐藏/改名
  const applyLeaf = (item: any): any | null => {
    if (item.hidden) return null
    if (!passesPermissionFilter(item)) return null
    if (item.requireAnyPermission || item.requirePermission || item.requireSiteFeature) return item
    const o = cfg[item.path]
    if (o && o.visible === false) return null
    if (o && o.title) return { ...item, label: o.title }
    return item
  }
  const result: any[] = []
  for (const item of allNavItems as any[]) {
    if (item.children) {
      const go = cfg[item.key] || (
        (item.key === 'group:image-creation' || item.key === 'group:video-creation')
          ? cfg['group:ai-creation']
          : undefined
      )
      if (go && go.visible === false) continue // 整组被隐藏
      const children = item.children.map(applyLeaf).filter(Boolean)
      if (children.length === 0) continue // 子项全部被隐藏 / 无权限则不显示分组
      result.push({ ...item, label: go && go.title ? go.title : item.label, children })
    } else {
      const applied = applyLeaf(item)
      if (applied) result.push(applied)
    }
  }
  // 合并云控端自定义菜单（已按 sort 排序）：挂到对应组末尾或顶级末尾；
  // 组被 overrides 隐藏 / 子项全空不存在时，该自定义项随之不显示（管理员隐藏组的语义覆盖）。
  // key 加 custom: 前缀——自定义 internal 项的 path 可能与内置菜单重复（如再挂一个 /chat），
  // 模板 :key 优先取 key，此前缀保证天然唯一
  for (const c of customMenuItems.value) {
    const leaf = {
      key: `custom:${c.key}`,
      // internal 复用 router-link（active 态由 isCustomInternalActive 手动判定）；external 无 path，模板走 <a> 分支
      path: c.target_type === 'internal' ? c.target : undefined,
      label: c.title,
      icon: CUSTOM_ICON_MAP[c.icon] || IconCustomLink,
      custom: c,
      tier: 'secondary' as const
    }
    if (!c.group_key) {
      result.push(leaf)
      continue
    }
    const groupKey =
      c.group_key === 'group:extensions' || c.group_key === 'group:my-creations'
        ? 'group:more'
        : c.group_key === 'group:ai-creation'
          ? 'group:image-creation'
          : c.group_key
    const group = result.find((it) => it.key === groupKey && it.children)
    if (group) group.children.push(leaf)
    else result.push(leaf)
  }
  return result
})

const primaryNavItems = computed(() =>
  (navItems.value as any[]).filter((it) => it.tier === 'primary')
)
const creationNavItems = computed(() =>
  (navItems.value as any[]).filter((it) => it.tier === 'creation')
)
const moreNavItems = computed(() =>
  (navItems.value as any[]).filter((it) => it.tier !== 'primary' && it.tier !== 'creation')
)

function openNavSearch() {
  showNavSearch.value = true
  navSearchQuery.value = ''
}

/** ⌘N 新建对话；⌘K 打开侧栏能力搜索 */
const showNavSearch = ref(false)
const navSearchQuery = ref('')
const navSearchResults = computed(() => {
  const q = navSearchQuery.value.trim().toLowerCase()
  const flat: { label: string; path: string }[] = []
  for (const item of navItems.value as any[]) {
    if (item.children) {
      for (const c of item.children) {
        if (c.path) flat.push({ label: `${item.label} / ${c.label}`, path: c.path })
      }
    } else if (item.path) {
      flat.push({ label: item.label, path: item.path })
    }
  }
  flat.push({ label: '设置 / 模型', path: '/models' })
  flat.push({ label: '设置 / 微信 ClawBot', path: '/clawbot' })
  flat.push({ label: '设置', path: '/settings' })
  if (!q) return flat.slice(0, 12)
  return flat.filter((x) => x.label.toLowerCase().includes(q)).slice(0, 12)
})

function onGlobalHotkey(e: KeyboardEvent) {
  const meta = e.metaKey || e.ctrlKey
  if (!meta) return
  const key = e.key.toLowerCase()
  if (key === 'n') {
    e.preventDefault()
    showNavSearch.value = false
    void onSidebarNewChat()
    return
  }
  if (key === 'k') {
    e.preventDefault()
    showNavSearch.value = true
    navSearchQuery.value = ''
  }
}

function goNavSearch(path: string) {
  showNavSearch.value = false
  if (path === '/settings') {
    settingsUi.show()
    return
  }
  if (path === '/clawbot') {
    settingsUi.show('clawbot')
    return
  }
  if (path === '/models') {
    settingsUi.show('models')
    return
  }
  router.push(path)
}

onMounted(() => {
  document.addEventListener('keydown', onGlobalHotkey)
  // 侧栏「最近对话」依赖标题推送；做成常驻监听（store 内幂等）
  chatStore.listenTitleUpdates()
  unsubPythonRequired = window.api.python.onRequired((data) => {
    pythonModal.value.reason = data.reason || '未检测到 Python'
    pythonModal.value.installUrl = data.installUrl || pythonModal.value.installUrl
    pythonModal.value.installHint = data.installHint || pythonModal.value.installHint
    pythonModal.value.open = true
  })
})
onUnmounted(() => {
  document.removeEventListener('keydown', onGlobalHotkey)
  unsubPythonRequired?.()
  unsubPythonRequired = null
})
</script>

<style scoped>
.nav-active {
  background: color-mix(in srgb, var(--color-primary-500, #23574f) 8%, #fff);
  color: var(--text-primary);
}
.nav-active svg {
  color: var(--text-primary);
  opacity: 1;
}

:global(.dark) .nav-active {
  background: color-mix(in srgb, var(--color-primary-500, #23574f) 18%, transparent);
  color: var(--color-primary-200, #c5d9d5);
}
:global(.dark) .nav-active svg {
  color: var(--color-primary-300, #9bbfba);
}
</style>
