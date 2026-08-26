<template>
  <div class="h-full flex flex-col">
    <header class="page-header justify-between">
      <div class="flex items-center gap-3">
        <div class="flex items-center bg-surface-2 rounded-lg p-0.5">
          <button
            v-for="tab in TABS"
            :key="tab.value"
            class="px-3 py-1 text-xs rounded-md transition-colors"
            :class="activeTab === tab.value ? 'bg-surface-0 text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'"
            @click="switchTab(tab.value)"
          >{{ tab.label }}</button>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <div class="relative">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            v-model="searchInput"
            placeholder="搜索模板..."
            class="pl-9 pr-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500 w-56"
            @keydown.enter="commitSearch"
          />
        </div>
        <button
          v-if="activeTab === 'cloud'"
          class="px-3 py-2 text-xs text-text-secondary hover:text-primary-600 border border-surface-3 rounded-lg bg-surface-0 hover:bg-surface-1 transition-colors"
          title="重新随机排序，换一批模板看看"
          @click="reshuffleCloudFeed"
        >换一批</button>
        <button
          v-if="activeTab === 'local' && cloudAuth.permissions.inspiration_uploader"
          class="px-3 py-2 text-xs text-text-secondary hover:text-primary-600 border border-surface-3 rounded-lg bg-surface-0 hover:bg-surface-1 transition-colors"
          :disabled="syncingSubmission"
          @click="syncSubmissionStatuses"
        >{{ syncingSubmission ? '同步中' : '同步投稿状态' }}</button>
        <button
          v-if="activeTab === 'local'"
          class="px-3 py-2 text-xs text-text-secondary hover:text-primary-600 border border-surface-3 rounded-lg bg-surface-0 hover:bg-surface-1 transition-colors"
          @click="categoryModalOpen = true"
        >分类管理</button>
        <button
          v-if="activeTab === 'local'"
          class="px-3 py-2 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
          @click="openCreatePicker"
        >添加模板</button>
      </div>
    </header>

    <div class="page-body">
      <!-- 分类筛选 chips -->
      <div class="flex flex-wrap gap-1.5 mb-5">
        <button
          class="px-3 py-1.5 text-xs rounded-lg transition-colors"
          :class="!currentCategoryId ? 'bg-primary-600 text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3'"
          @click="selectCategory(null)"
        >全部</button>
        <button
          v-for="cat in displayCategories"
          :key="String(cat.id)"
          class="px-3 py-1.5 text-xs rounded-lg transition-colors"
          :class="String(currentCategoryId) === String(cat.id) ? 'bg-primary-600 text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3'"
          @click="selectCategory(cat.id)"
        >{{ cat.name }}</button>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="flex-1 flex items-center justify-center py-20">
        <svg class="w-6 h-6 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
      </div>

      <!-- Cloud error -->
      <div v-else-if="activeTab === 'cloud' && store.cloudError" class="empty-state">
        <div class="w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
          <svg class="w-8 h-8 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>
        <p class="text-sm font-medium text-text-secondary mb-1">云端模板加载失败</p>
        <p class="text-xs text-text-tertiary mb-3">{{ store.cloudError }}</p>
        <button class="px-3 py-1.5 text-xs border border-surface-3 rounded-lg bg-surface-0 hover:bg-surface-1" @click="refresh">重试</button>
      </div>

      <!-- Empty state -->
      <div v-else-if="!currentTemplates.length" class="empty-state">
        <div class="w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
          <svg class="w-8 h-8 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17 9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z" />
          </svg>
        </div>
        <p class="text-sm font-medium text-text-secondary mb-1">{{ emptyText }}</p>
        <p class="text-xs text-text-tertiary">{{ emptyHint }}</p>
        <button
          v-if="activeTab === 'local'"
          class="mt-4 px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg"
          @click="openCreatePicker"
        >创建模板</button>
        <button
          v-if="activeTab === 'local'"
          class="mt-2 px-3 py-1.5 text-xs border border-surface-3 rounded-lg bg-surface-0 hover:bg-surface-1"
          @click="switchTab('cloud')"
        >使用云端模板</button>
      </div>

      <!-- 云端模板：瀑布流（固定 5 列，随机排序 + 无限滚动） -->
      <div v-else-if="activeTab === 'cloud'">
        <div class="flex gap-3 items-start">
          <div v-for="(col, ci) in cloudColumns" :key="ci" class="flex-1 min-w-0 flex flex-col gap-3">
            <div
              v-for="item in col"
              :key="String(item.id)"
              class="group cursor-pointer rounded-xl overflow-hidden border border-surface-3 bg-surface-0 shadow-sm hover:shadow-md transition-shadow"
              @click="openUse(item)"
            >
              <!-- 瀑布流封面：按原图比例展示（不裁剪），高度错落 -->
              <div class="bg-surface-2 overflow-hidden">
                <img
                  v-if="resolveCover(item)"
                  :src="resolveCover(item)"
                  class="w-full h-auto block group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                  @error="hideBrokenImage"
                />
                <div v-else class="w-full aspect-[3/4] flex items-center justify-center">
                  <svg class="w-10 h-10 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
                  </svg>
                </div>
              </div>
              <div class="p-3">
                <h4 class="text-xs font-medium text-text-primary truncate" :title="item.title">{{ item.title }}</h4>
                <p class="mt-1 text-[10px] text-text-tertiary line-clamp-2 min-h-[1.6em]">{{ item.description || '暂无描述' }}</p>
                <div class="mt-2 flex items-center justify-between text-[10px] text-text-tertiary">
                  <span>{{ item.variables?.length || 0 }} 个变量</span>
                  <span v-if="item.default_size">{{ item.default_size }}</span>
                </div>
                <div class="mt-2 flex gap-1.5" @click.stop>
                  <button
                    class="flex-1 px-2 py-1 text-[10px] text-white bg-primary-600 hover:bg-primary-700 rounded transition-colors"
                    @click="openUse(item)"
                  >使用</button>
                  <button
                    class="px-2 py-1 text-[10px] text-text-secondary border border-surface-3 hover:bg-surface-1 rounded transition-colors"
                    @click="importCloud(item as CloudCreativeTemplate)"
                  >另存到本地</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部哨兵：进入视口自动加载下一批；仍有更多时显示加载指示 -->
        <div :ref="setCloudSentinel" class="h-px"></div>
        <div v-if="cloudHasMore" class="py-6 flex items-center justify-center">
          <svg class="w-5 h-5 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
        </div>
      </div>

      <!-- 我的模板：保持原网格布局不变 -->
      <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        <div
          v-for="item in currentTemplates"
          :key="String(item.id)"
          class="group cursor-pointer rounded-xl overflow-hidden border border-surface-3 bg-surface-0 shadow-sm hover:shadow-md transition-shadow"
          @click="openUse(item)"
        >
          <div class="aspect-[4/3] bg-surface-2 overflow-hidden">
            <img
              v-if="resolveCover(item)"
              :src="resolveCover(item)"
              class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              @error="hideBrokenImage"
            />
            <div v-else class="w-full h-full flex items-center justify-center">
              <svg class="w-10 h-10 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
              </svg>
            </div>
          </div>
          <div class="p-3">
            <div class="flex items-start gap-2">
              <h4 class="flex-1 text-xs font-medium text-text-primary truncate" :title="item.title">{{ item.title }}</h4>
              <span
                v-if="getSourceLabel(item)"
                class="shrink-0 text-[10px] px-1.5 py-0.5 rounded"
                :class="getSourceLabel(item)?.cls"
              >{{ getSourceLabel(item)?.text }}</span>
            </div>
            <div v-if="activeTab === 'local' && getSubmissionLabel(item as CreativeTemplate)" class="mt-1">
              <span
                class="text-[10px] px-1.5 py-0.5 rounded"
                :class="getSubmissionLabel(item as CreativeTemplate)?.cls"
                :title="(item as CreativeTemplate).submission_reject_reason || ''"
              >{{ getSubmissionLabel(item as CreativeTemplate)?.text }}</span>
            </div>
            <p class="mt-1 text-[10px] text-text-tertiary line-clamp-2 min-h-[1.6em]">{{ item.description || '暂无描述' }}</p>
            <div class="mt-2 flex items-center justify-between text-[10px] text-text-tertiary">
              <span>{{ item.variables?.length || 0 }} 个变量</span>
              <span v-if="item.default_size">{{ item.default_size }}</span>
            </div>
            <div class="mt-2 flex gap-1.5" @click.stop>
              <button
                class="flex-1 px-2 py-1 text-[10px] text-white bg-primary-600 hover:bg-primary-700 rounded transition-colors"
                @click="openUse(item)"
              >使用</button>
              <button
                v-if="activeTab === 'local'"
                class="px-2 py-1 text-[10px] text-text-secondary border border-surface-3 hover:bg-surface-1 rounded transition-colors"
                @click="openEdit(item as CreativeTemplate)"
              >编辑</button>
              <button
                v-if="activeTab === 'local' && canSubmitTemplate(item as CreativeTemplate)"
                class="px-2 py-1 text-[10px] text-primary-600 border border-surface-3 hover:bg-primary-50 rounded transition-colors disabled:opacity-50"
                :disabled="store.submittingIds.includes(String(item.id))"
                @click="openSubmit(item as CreativeTemplate)"
              >{{ getSubmitButtonText(item as CreativeTemplate) }}</button>
              <button
                v-if="activeTab === 'local' && canWithdrawTemplate(item as CreativeTemplate)"
                class="px-2 py-1 text-[10px] text-text-secondary border border-surface-3 hover:bg-surface-1 rounded transition-colors disabled:opacity-50"
                :disabled="store.submittingIds.includes(String(item.id))"
                @click="withdrawTemplate(item as CreativeTemplate)"
              >撤回</button>
              <button
                v-if="activeTab === 'local'"
                class="px-2 py-1 text-[10px] text-error border border-surface-3 hover:bg-error/10 rounded transition-colors"
                @click="confirmRemove(item as CreativeTemplate)"
              >删除</button>
              <button
                v-if="activeTab === 'cloud'"
                class="px-2 py-1 text-[10px] text-text-secondary border border-surface-3 hover:bg-surface-1 rounded transition-colors"
                @click="importCloud(item as CloudCreativeTemplate)"
              >另存到本地</button>
            </div>
          </div>
        </div>
      </div>

    </div>

    <CreateTemplateWizard
      v-model="createPickerOpen"
      @manual="startManualCreate"
      @draft-ready="openDraftCreate"
    />

    <!-- 模板编辑器（创建 / 编辑） -->
    <TemplateEditorModal
      v-if="editorOpen"
      :model-value="editorOpen"
      :template="editing"
      :categories="store.categories"
      :pending-default-source="pendingDraftSource"
      @update:model-value="editorOpen = $event"
      @saved="onTemplateSaved"
    />

    <!-- 模板使用器（填变量 → handoff 到 imageGen） -->
    <TemplateUseModal
      v-if="usingTemplate"
      :template="usingTemplate"
      :source="activeTab"
      @close="usingTemplate = null"
      @import-to-local="onUseImportToLocal"
    />

    <!-- 分类管理弹窗 -->
    <CategoryManagerModal
      v-if="categoryModalOpen"
      :categories="store.categories"
      @close="categoryModalOpen = false"
      @changed="onCategoriesChanged"
    />

    <!-- 选择导入目标分类 -->
    <div
      v-if="pendingImport"
      class="fixed inset-0 z-50 flex items-center justify-center p-6"
      @click.self="pendingImport = null"
    >
      <div class="bg-surface-0 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.15)] w-[420px] p-5">
        <h3 class="text-sm font-medium text-text-primary mb-1">另存到本地</h3>
        <p class="text-xs text-text-tertiary mb-3">选择目标分类，将此云端模板保存到「我的模板」</p>
        <div v-if="!store.categories.length" class="p-3 mb-3 text-xs text-text-secondary bg-surface-2 rounded-lg">
          还没有本地分类，请先在「分类管理」创建一个。
        </div>
        <select
          v-model="pendingImportCategory"
          class="w-full px-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="" disabled>请选择分类</option>
          <option v-for="cat in store.categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
        </select>
        <div class="mt-4 flex justify-end gap-2">
          <button
            class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-1"
            @click="pendingImport = null"
          >取消</button>
          <button
            class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50"
            :disabled="!pendingImportCategory || importing"
            @click="confirmImport"
          >{{ importing ? '正在导入...' : '导入' }}</button>
        </div>
      </div>
    </div>

    <!-- 选择投稿云端分类 -->
    <div
      v-if="pendingSubmit"
      class="fixed inset-0 z-50 flex items-center justify-center p-6"
      @click.self="pendingSubmit = null"
    >
      <div class="bg-surface-0 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.15)] w-[420px] p-5">
        <h3 class="text-sm font-medium text-text-primary mb-1">投稿到云端</h3>
        <p class="text-xs text-text-tertiary mb-3">选择云端分类，投稿后由云控端审核发布。</p>
        <div v-if="!cloudAuth.permissions.inspiration_uploader" class="p-3 mb-3 text-xs text-text-secondary bg-surface-2 rounded-lg">
          当前账号未开启灵感大王权限，无法投稿。
        </div>
        <div v-else-if="!store.cloudCategories.length" class="p-3 mb-3 text-xs text-text-secondary bg-surface-2 rounded-lg">
          云端暂无可用分类，请先在云控端创建并启用创意模板分类。
        </div>
        <select
          v-model.number="pendingSubmitCategory"
          class="w-full px-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option :value="0" disabled>请选择云端分类</option>
          <option v-for="cat in store.cloudCategories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
        </select>
        <div class="mt-4 flex justify-end gap-2">
          <button
            class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-1"
            @click="pendingSubmit = null"
          >取消</button>
          <button
            class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50"
            :disabled="!cloudAuth.permissions.inspiration_uploader || !pendingSubmitCategory || submittingTemplate"
            @click="confirmSubmit"
          >{{ submittingTemplate ? '正在投稿...' : '确认投稿' }}</button>
        </div>
      </div>
    </div>

    <!-- 删除确认 -->
    <ConfirmDialog
      :visible="!!pendingDelete"
      title="删除模板"
      :message="pendingDelete ? `确定要删除模板「${pendingDelete.title}」吗？该操作不可恢复，同时会删除模板的封面、示例图和反推源图等本地文件。` : ''"
      confirm-text="删除"
      cancel-text="取消"
      @cancel="pendingDelete = null"
      @confirm="doRemove"
    />

    <div v-if="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-surface-0 shadow-lg border border-surface-3 text-xs text-text-primary">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  useCreativeTemplateStore,
  type CloudCreativeTemplate,
  type CreativeTemplate,
  type CreativeTemplateSource,
  type CreativeTemplateVariable,
} from '@/stores/creative-templates'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useRandomInfiniteFeed } from '@/utils/random-infinite-feed'
import TemplateEditorModal from './components/TemplateEditorModal.vue'
import TemplateUseModal from './components/TemplateUseModal.vue'
import CreateTemplateWizard from './components/CreateTemplateWizard.vue'
import CategoryManagerModal from './components/CategoryManagerModal.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

type TabKey = 'local' | 'cloud'
interface CreativeTemplateDraftPayload {
  source_type?: CreativeTemplateSource
  source_image?: string
  source_inspiration_id?: string
  presetTitle?: string
  presetPrompt?: string
  presetDescription?: string
  presetRefImages?: string[]
  presetVariables?: CreativeTemplateVariable[]
  presetSize?: string
  requiresRefImage?: boolean
}

const TABS: Array<{ value: TabKey; label: string }> = [
  { value: 'cloud', label: '云端模板' },
  { value: 'local', label: '我的模板' },
]

const SOURCE_BADGE: Record<string, { text: string; cls: string }> = {
  manual: { text: '手动', cls: 'bg-surface-2 text-text-secondary' },
  image: { text: '图片', cls: 'bg-primary-100 text-primary-700' },
  inspiration: { text: '灵感', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
}

const SUBMISSION_BADGE: Record<string, { text: string; cls: string }> = {
  pending: { text: '待审核', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  approved: { text: '已上架', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  rejected: { text: '已驳回', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  withdrawn: { text: '已撤回', cls: 'bg-surface-2 text-text-secondary' },
}

const store = useCreativeTemplateStore()
const cloudAuth = useCloudAuthStore()

const activeTab = ref<TabKey>('cloud')
const searchInput = ref(store.cloudSearch)
const createPickerOpen = ref(false)
const editorOpen = ref(false)
const editing = ref<CreativeTemplate | null>(null)
const usingTemplate = ref<CreativeTemplate | CloudCreativeTemplate | null>(null)
const pendingImport = ref<CloudCreativeTemplate | null>(null)
const pendingImportCategory = ref<string>('')
const importing = ref(false)
const pendingSubmit = ref<CreativeTemplate | null>(null)
const pendingSubmitCategory = ref<number>(0)
const submittingTemplate = ref(false)
const syncingSubmission = ref(false)
const toast = ref('')
const categoryModalOpen = ref(false)
const pendingDelete = ref<CreativeTemplate | null>(null)
const pendingDraftSource = ref<CreativeTemplateDraftPayload | null>(null)

const loading = computed(() => (activeTab.value === 'local' ? store.localLoading : store.cloudLoading))

const displayCategories = computed(() => {
  return activeTab.value === 'local' ? store.categories : store.cloudCategories
})

const currentCategoryId = computed(() => {
  return activeTab.value === 'local' ? store.activeCategoryId : store.cloudActiveCategoryId
})

const currentTemplates = computed<Array<CreativeTemplate | CloudCreativeTemplate>>(() => {
  return activeTab.value === 'local' ? store.templates : store.cloudTemplates
})

// 云端模板广场：无限滚动（首屏 25，每次下拉 +20）
// 排序策略：有搜索词时保序（检索要可复现），纯逛/切分类时随机（常看常新），随时可手动「换一批」
const {
  items: cloudFeedItems,
  hasMore: cloudHasMore,
  setItems: setCloudFeedShuffled,
  setItemsOrdered: setCloudFeedOrdered,
  reshuffle: reshuffleCloudFeed,
  setSentinel: setCloudSentinel,
} = useRandomInfiniteFeed<CloudCreativeTemplate>({ initial: 25, step: 20 })

// 5 列瀑布流：对展示切片做 round-robin 分配，下拉追加时已有卡片不重排
const CLOUD_COLUMN_COUNT = 5
const cloudColumns = computed<CloudCreativeTemplate[][]>(() => {
  const cols: CloudCreativeTemplate[][] = Array.from({ length: CLOUD_COLUMN_COUNT }, () => [])
  cloudFeedItems.value.forEach((item, i) => cols[i % CLOUD_COLUMN_COUNT].push(item))
  return cols
})

// 云端模板每次重新加载后重置展示：搜索态保序（结果可对照），非搜索态随机（逛的新鲜感）
watch(
  () => store.cloudTemplates,
  (list) => {
    const arr = Array.isArray(list) ? list.slice() : []
    if (store.cloudSearch.trim()) setCloudFeedOrdered(arr)
    else setCloudFeedShuffled(arr)
  },
  { immediate: true }
)

const emptyText = computed(() => activeTab.value === 'local' ? '暂无模板' : '暂无云端模板')
const emptyHint = computed(() => activeTab.value === 'local'
  ? '请创建模板或使用云端模板'
  : '管理员还未发布云端模板，或当前筛选条件无结果')

function switchTab(tab: TabKey): void {
  if (activeTab.value === tab) return
  activeTab.value = tab
  searchInput.value = tab === 'local' ? store.search : store.cloudSearch
  if (tab === 'cloud') {
    if (!store.cloudCategories.length) void store.fetchCloudCategories()
    void store.fetchCloudTemplates()
  } else {
    void store.fetchTemplates()
  }
}

function commitSearch(): void {
  const value = searchInput.value.trim()
  if (activeTab.value === 'local') {
    void store.setSearch(value)
  } else {
    void store.setCloudSearch(value)
  }
}

function selectCategory(id: string | number | null): void {
  if (activeTab.value === 'local') {
    void store.setActiveCategory(id === null ? null : String(id))
  } else {
    void store.setCloudActiveCategory(id === null ? null : Number(id))
  }
}

function refresh(): void {
  if (activeTab.value === 'local') void store.fetchTemplates()
  else void store.fetchCloudTemplates()
}

function openCreatePicker(): void {
  if (!store.categories.length) {
    categoryModalOpen.value = true
    return
  }
  createPickerOpen.value = true
}

function openCreate(resetDraft = true): void {
  if (!store.categories.length) {
    categoryModalOpen.value = true
    return
  }
  if (resetDraft) pendingDraftSource.value = null
  editing.value = null
  editorOpen.value = true
}

function startManualCreate(): void {
  createPickerOpen.value = false
  openCreate()
}

function openDraftCreate(payload: CreativeTemplateDraftPayload): void {
  createPickerOpen.value = false
  pendingDraftSource.value = payload
  openCreate(false)
}

function openEdit(item: CreativeTemplate): void {
  pendingDraftSource.value = null
  editing.value = item
  editorOpen.value = true
}

function openUse(item: CreativeTemplate | CloudCreativeTemplate): void {
  usingTemplate.value = item
}

function confirmRemove(item: CreativeTemplate): void {
  pendingDelete.value = item
}
async function doRemove(): Promise<void> {
  const target = pendingDelete.value
  pendingDelete.value = null
  if (!target) return
  await store.deleteTemplate(target.id)
}

function onTemplateSaved(): void {
  editorOpen.value = false
  editing.value = null
  pendingDraftSource.value = null
}

function onCategoriesChanged(): void {
  if (activeTab.value === 'local') void store.fetchTemplates()
}

function importCloud(item: CloudCreativeTemplate): void {
  pendingImport.value = item
  pendingImportCategory.value = store.categories[0]?.id || ''
}

async function confirmImport(): Promise<void> {
  if (!pendingImport.value || !pendingImportCategory.value) return
  importing.value = true
  try {
    await store.importCloudToLocal(pendingImport.value, pendingImportCategory.value)
    pendingImport.value = null
    pendingImportCategory.value = ''
  } finally {
    importing.value = false
  }
}

async function onUseImportToLocal(item: CloudCreativeTemplate): Promise<void> {
  usingTemplate.value = null
  importCloud(item)
}

function resolveCover(item: CreativeTemplate | CloudCreativeTemplate): string {
  // 网格优先用云端缩略图；本地模板无 cover_thumb 时回退原图
  const thumb = (item as Partial<CloudCreativeTemplate>).cover_thumb
  if (thumb) return resolveImagePath(thumb)
  if (item.cover_image) return resolveImagePath(item.cover_image)
  const refs = (item.example_ref_images || []) as string[]
  return refs[0] ? resolveImagePath(refs[0]) : ''
}

function resolveImagePath(path: string): string {
  if (!path) return ''
  // 已是受信协议直接返回；本地绝对路径走主进程注册的 local-file:// 协议（CSP 友好，Windows 盘符兼容）
  if (/^(https?:|data:|file:|local-file:)/i.test(path)) return path
  return 'local-file://img?p=' + encodeURIComponent(path.replace(/\\/g, '/'))
}

function hideBrokenImage(event: Event): void {
  const img = event.target as HTMLImageElement
  if (img) img.style.display = 'none'
}

function getSourceLabel(item: CreativeTemplate | CloudCreativeTemplate): { text: string; cls: string } | null {
  const source = (item as CreativeTemplate).source_type
  if (!source) return null
  return SOURCE_BADGE[source] || null
}

function getSubmissionLabel(item: CreativeTemplate): { text: string; cls: string } | null {
  if (!item.submission_status) return null
  return SUBMISSION_BADGE[item.submission_status] || null
}

function canSubmitTemplate(item: CreativeTemplate): boolean {
  if (!cloudAuth.permissions.inspiration_uploader) return false
  return !item.submission_status || item.submission_status === 'rejected' || item.submission_status === 'withdrawn'
}

function canWithdrawTemplate(item: CreativeTemplate): boolean {
  if (!cloudAuth.permissions.inspiration_uploader) return false
  return item.submission_status === 'pending'
}

function getSubmitButtonText(item: CreativeTemplate): string {
  if (store.submittingIds.includes(item.id)) return '处理中'
  if (item.submission_status === 'rejected' || item.submission_status === 'withdrawn') return '重新投稿'
  return '投稿'
}

function showToast(text: string): void {
  toast.value = text
  setTimeout(() => {
    if (toast.value === text) toast.value = ''
  }, 2500)
}

async function openSubmit(item: CreativeTemplate): Promise<void> {
  if (!cloudAuth.permissions.inspiration_uploader) {
    showToast('当前账号未开启灵感大王权限')
    return
  }
  if (!store.cloudCategories.length) {
    await store.fetchCloudCategories()
  }
  pendingSubmit.value = item
  pendingSubmitCategory.value = store.cloudCategories[0]?.id || 0
}

async function confirmSubmit(): Promise<void> {
  if (!pendingSubmit.value || !pendingSubmitCategory.value) return
  submittingTemplate.value = true
  try {
    const res = await store.submitTemplateToCloud(pendingSubmit.value.id, pendingSubmitCategory.value)
    if (!res.ok) {
      showToast(res.error || '投稿失败')
      return
    }
    pendingSubmit.value = null
    pendingSubmitCategory.value = 0
    showToast(res.compressed ? '已投稿，图片已自动压缩' : '已投稿，请等待云控端审核')
  } catch (e: any) {
    showToast('投稿失败：' + (e?.message || e))
  } finally {
    submittingTemplate.value = false
  }
}

async function withdrawTemplate(item: CreativeTemplate): Promise<void> {
  try {
    const res = await store.withdrawSubmission(item.id)
    if (!res.ok) {
      showToast(res.error || '撤回失败')
      return
    }
    showToast('已撤回投稿')
  } catch (e: any) {
    showToast('撤回失败：' + (e?.message || e))
  }
}

async function syncSubmissionStatuses(): Promise<void> {
  if (!cloudAuth.permissions.inspiration_uploader) {
    showToast('当前账号未开启灵感大王权限')
    return
  }
  syncingSubmission.value = true
  try {
    await store.syncSubmissionStatus()
    showToast('投稿状态已同步')
  } catch (e: any) {
    showToast('同步失败：' + (e?.message || e))
  } finally {
    syncingSubmission.value = false
  }
}

watch(activeTab, (_, prev) => {
  if (prev === 'cloud' && activeTab.value === 'local') {
    searchInput.value = store.search
  }
})

onMounted(async () => {
  await Promise.all([
    store.fetchCategories(),
    store.fetchTemplates(),
    store.fetchCloudCategories(),
    store.fetchCloudTemplates(),
  ])
  if (cloudAuth.permissions.inspiration_uploader) {
    void store.syncSubmissionStatus().catch(() => {})
  }
})
</script>
