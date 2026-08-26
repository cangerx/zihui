<template>
  <div class="h-full flex flex-col">
    <header class="page-header">
      <div class="text-sm font-medium text-text-primary truncate">
        图库 · {{ workspaceStore.activeName || '当前文件夹' }}
      </div>
      <div class="flex items-center gap-2 ml-auto">
        <button class="btn-secondary text-sm" @click="showCatManager = true">分类管理</button>
        <button class="btn-secondary text-sm" @click="openAddDialog">添加图片</button>
        <button class="btn-secondary text-sm" @click="doSync" :disabled="syncing">
          {{ syncing ? '检测中...' : '同步检测' }}
        </button>
        <button v-if="!selectMode" class="btn-secondary text-sm" @click="enterSelect">选择</button>
        <template v-else>
          <button class="btn-secondary text-sm" :disabled="!store.items.length" @click="toggleSelectAllOnPage">
            {{ allOnPageSelected ? '本页全不选' : '本页全选' }}
          </button>
          <button class="btn-danger text-sm" :disabled="!selectedIds.size" @click="batchRemove">
            移除 ({{ selectedIds.size }})
          </button>
          <button class="btn-secondary text-sm" @click="exitSelect">取消</button>
        </template>
      </div>
    </header>

    <div class="px-6 pt-4 flex items-center gap-3 flex-shrink-0">
      <!-- Category tabs -->
      <div class="flex items-center gap-1 flex-1 overflow-x-auto no-scrollbar">
          <button
            v-if="showAllTab"
            class="px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors"
            :class="store.activeCategoryId === null ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 font-medium' : 'text-text-secondary hover:bg-surface-2'"
            @click="store.setCategory(null)"
          >全部</button>
          <button
            v-for="cat in visibleCategories"
            :key="cat.id"
            class="px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors"
            :class="store.activeCategoryId === cat.id ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 font-medium' : 'text-text-secondary hover:bg-surface-2'"
            @click="store.setCategory(cat.id)"
          >{{ categoryLabel(cat) }}</button>
      </div>
      <!-- Search -->
      <div class="relative w-56 flex-shrink-0">
        <input
          v-model="searchInput"
          class="input-field pl-8 text-sm h-8"
          placeholder="搜索图片名称..."
          @input="onSearchInput"
        />
        <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      </div>
    </div>

    <!-- Content -->
    <div class="page-body flex-1 overflow-y-auto">
      <!-- Empty state -->
      <div v-if="!store.loading && store.items.length === 0" class="empty-state">
        <div class="w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
          <svg class="w-8 h-8 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke-width="1.5"/><circle cx="8.5" cy="8.5" r="1.5" stroke-width="1.5"/><polyline points="21 15 16 10 5 21" stroke-width="1.5"/></svg>
        </div>
        <p class="text-sm font-medium text-text-secondary mb-1">暂无图片</p>
        <p class="text-xs text-text-tertiary mb-4">点击"添加图片"导入本地图片或文件夹</p>
        <button class="btn-primary text-sm" @click="openAddDialog">添加图片</button>
      </div>

      <!-- Grid -->
      <div v-else class="grid grid-cols-6 gap-2">
        <div
          v-for="item in store.items"
          :key="item.id"
          class="group relative aspect-square rounded-lg overflow-hidden bg-surface-2 cursor-pointer border border-surface-3 hover:border-primary-400 transition-colors"
          @click="selectMode ? toggleSelect(item.id) : openDetail(item)"
        >
          <img
            :src="toLocalThumbUrl(item.file_path)"
            :alt="item.name"
            class="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
          <!-- 去AI标记「已处理」角标 -->
          <div v-if="(item as any).ai_mark_removed && !selectMode" class="absolute top-1.5 left-1.5 z-10 pointer-events-none"><ProcessedBadge /></div>
          <!-- Select checkbox -->
          <div
            v-if="selectMode"
            class="absolute top-1.5 left-1.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors"
            :class="selectedIds.has(item.id) ? 'bg-primary-500 border-primary-500' : 'bg-white/80 border-surface-4'"
          >
            <svg v-if="selectedIds.has(item.id)" class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <!-- Name overlay -->
          <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/50 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity pr-24">
            <p class="text-xs text-white truncate">{{ item.name }}</p>
          </div>
          <!-- 操作按钮组（非选择模式）：复制 / 编辑 / 作为参考图。
               hover 时显示，覆盖在 name overlay 之上 -->
          <div v-if="!selectMode" class="absolute bottom-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            <button @click.stop="copyImage(item.file_path)" class="w-7 h-7 rounded-lg bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors" title="复制图片">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" /></svg>
            </button>
            <button @click.stop="editImage(item)" class="w-7 h-7 rounded-lg bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors" title="编辑">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>
            </button>
            <button @click.stop="useAsRefImage(item)" class="w-7 h-7 rounded-lg bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors" title="作为参考图生图">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>
            </button>
          </div>
          <!-- 操作反馈 toast -->
          <div v-if="copyToast === item.id" class="absolute top-1.5 left-1/2 -translate-x-1/2 px-2 py-1 text-[10px] bg-black/70 text-white rounded-md pointer-events-none">
            {{ copyToastMessage }}
          </div>
        </div>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex items-center justify-center gap-1 mt-6">
        <button
          @click="goToPage(1)"
          :disabled="store.page <= 1"
          class="px-2.5 py-1.5 text-xs border border-surface-3 rounded-lg disabled:opacity-40 hover:bg-surface-2 transition-colors"
          title="首页"
        >«</button>
        <button
          @click="goToPage(store.page - 1)"
          :disabled="store.page <= 1"
          class="px-2.5 py-1.5 text-xs border border-surface-3 rounded-lg disabled:opacity-40 hover:bg-surface-2 transition-colors"
          title="上一页"
        >‹</button>
        <span class="px-2 text-xs text-text-secondary">
          第 <input
            type="number"
            :value="store.page"
            @change="(e) => goToPage(parseInt((e.target as HTMLInputElement).value) || 1)"
            :min="1"
            :max="totalPages"
            class="w-12 px-1 py-0.5 text-center text-xs border border-surface-3 rounded bg-surface-0 outline-none focus:ring-1 focus:ring-primary-500"
          /> / {{ totalPages }} 页
          <span class="text-text-tertiary ml-2">共 {{ store.total }} 条</span>
        </span>
        <button
          @click="goToPage(store.page + 1)"
          :disabled="store.page >= totalPages"
          class="px-2.5 py-1.5 text-xs border border-surface-3 rounded-lg disabled:opacity-40 hover:bg-surface-2 transition-colors"
          title="下一页"
        >›</button>
        <button
          @click="goToPage(totalPages)"
          :disabled="store.page >= totalPages"
          class="px-2.5 py-1.5 text-xs border border-surface-3 rounded-lg disabled:opacity-40 hover:bg-surface-2 transition-colors"
          title="末页"
        >»</button>
      </div>
    </div>

    <!-- Detail Modal -->
    <div v-if="detailItem" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="detailItem = null">
      <div class="bg-surface-0 rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.15)] w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div class="flex items-center justify-between px-5 py-3 border-b border-surface-3">
          <h2 class="text-sm font-semibold text-text-primary truncate flex-1">{{ detailItem.name }}</h2>
          <div class="flex items-center gap-1 ml-4">
            <button class="btn-ghost text-xs px-2 py-1" :disabled="detailIndex <= 0" @click="prevDetail">上一张</button>
            <button class="btn-ghost text-xs px-2 py-1" :disabled="detailIndex >= store.items.length - 1" @click="nextDetail">下一张</button>
            <button class="btn-ghost text-xs px-2 py-1" @click="openInFolder(detailItem.file_path)">打开目录</button>
            <button class="btn-ghost text-xs px-2 py-1" @click="detailItem = null">关闭</button>
          </div>
        </div>
        <div class="flex-1 overflow-hidden flex">
          <div class="flex-1 flex items-center justify-center p-4 bg-surface-1 min-h-0">
            <img
              :src="toLocalUrl(detailItem.file_path)"
              :alt="detailItem.name"
              class="max-w-full max-h-full object-contain rounded cursor-pointer"
              @click="openLightbox(detailItem.file_path)"
            />
          </div>
          <div class="w-56 flex-shrink-0 border-l border-surface-3 p-4 space-y-3 text-xs overflow-y-auto">
            <div><span class="text-text-tertiary">文件名</span><p class="text-text-primary mt-0.5 break-all">{{ detailItem.name }}</p></div>
            <div><span class="text-text-tertiary">尺寸</span><p class="text-text-primary mt-0.5">{{ detailItem.width }} x {{ detailItem.height }}</p></div>
            <div><span class="text-text-tertiary">大小</span><p class="text-text-primary mt-0.5">{{ formatSize(detailItem.file_size) }}</p></div>
            <div><span class="text-text-tertiary">类型</span><p class="text-text-primary mt-0.5 uppercase">{{ detailItem.file_type }}</p></div>
            <div><span class="text-text-tertiary">来源</span><p class="text-text-primary mt-0.5">{{ detailItem.source === 'folder' ? '文件夹导入' : '单文件添加' }}</p></div>
            <div><span class="text-text-tertiary">添加时间</span><p class="text-text-primary mt-0.5">{{ formatDate(detailItem.created_at) }}</p></div>
            <div><span class="text-text-tertiary">路径</span><p class="text-text-primary mt-0.5 break-all select-text">{{ detailItem.file_path }}</p></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Category Manager Modal -->
    <div v-if="showCatManager" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="showCatManager = false">
      <div class="bg-surface-0 rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.12)] w-full max-w-md p-6 space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-base font-semibold text-text-primary">分类管理</h2>
          <button class="btn-ghost text-xs px-2 py-1" @click="openCatForm()">+ 新建</button>
        </div>
        <div class="space-y-1 max-h-64 overflow-y-auto">
          <div
            v-for="cat in store.categories"
            :key="cat.id"
            class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-2 group"
          >
            <span class="flex-1 text-sm text-text-primary truncate">{{ cat.name }}</span>
            <span v-if="cat.is_system" class="text-xs text-text-disabled">系统</span>
            <template v-if="!cat.is_system">
              <button class="btn-ghost text-xs px-1.5 py-0.5 opacity-0 group-hover:opacity-100" @click="openCatForm(cat)">编辑</button>
              <button class="btn-danger text-xs px-1.5 py-0.5 opacity-0 group-hover:opacity-100" @click="confirmDeleteCat(cat)">删除</button>
            </template>
          </div>
        </div>
        <div class="flex justify-end">
          <button class="btn-secondary text-sm" @click="showCatManager = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- Category Form Modal -->
    <div v-if="showCatForm" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="showCatForm = false">
      <div class="bg-surface-0 rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.12)] w-full max-w-md p-6 space-y-4">
        <h2 class="text-base font-semibold text-text-primary">{{ editingCatId ? '编辑分类' : '新建分类' }}</h2>
        <div>
          <label class="form-label">分类名称</label>
          <input v-model="catForm.name" class="input-field" placeholder="例如: 素材库" @keydown.enter="saveCat" />
        </div>
        <div>
          <label class="form-label">描述</label>
          <input v-model="catForm.description" class="input-field" placeholder="关于此分类的简要说明" @keydown.enter="saveCat" />
        </div>
        <div class="flex justify-end gap-3 pt-2">
          <button @click="showCatForm = false" class="btn-secondary">取消</button>
          <button @click="saveCat" class="btn-primary">{{ editingCatId ? '更新' : '创建' }}</button>
        </div>
      </div>
    </div>

    <!-- Delete Category Confirmation -->
    <div v-if="deleteCatTarget" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="deleteCatTarget = null">
      <div class="bg-surface-0 rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.12)] w-full max-w-sm p-6">
        <h2 class="text-base font-semibold text-text-primary mb-2">确认删除</h2>
        <p class="text-sm text-text-secondary mb-5">
          确定要删除分类「<b>{{ deleteCatTarget.name }}</b>」吗？该分类下的图片记录也将被清除，此操作不可撤销。
        </p>
        <div class="flex justify-end gap-3">
          <button @click="deleteCatTarget = null" class="btn-secondary">取消</button>
          <button @click="executeDeleteCat" class="btn-danger">确认删除</button>
        </div>
      </div>
    </div>

    <!-- Add Dialog -->
    <div v-if="showAddDialog" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="showAddDialog = false">
      <div class="bg-surface-0 rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.12)] w-full max-w-md p-6 space-y-4">
        <h2 class="text-base font-semibold text-text-primary">添加图片</h2>
        <div>
          <label class="form-label">目标分类</label>
          <select v-model="addForm.categoryId" class="input-field text-sm">
            <option v-for="cat in visibleCategories" :key="cat.id" :value="cat.id">{{ categoryLabel(cat) }}</option>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-2 items-start">
          <button class="btn-secondary text-sm" @click="pickFiles">选择图片文件</button>
          <div class="flex flex-col gap-2">
            <button class="btn-secondary text-sm" @click="pickFolder">选择文件夹</button>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="addForm.recursive" class="rounded" />
              <span class="text-sm text-text-secondary">包含子文件夹</span>
            </label>
          </div>
        </div>
        <div v-if="addResult" class="text-sm text-text-secondary">
          {{ addResult }}
        </div>
        <div class="flex justify-end gap-3 pt-2">
          <button @click="showAddDialog = false" class="btn-secondary">关闭</button>
        </div>
      </div>
    </div>

    <!-- Lightbox: 详情 modal 上叠加一层可缩放全屏预览 -->
    <ImageLightbox
      :src="lightboxSrc"
      :on-locate="lightboxLocate"
      @close="closeLightbox"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useGalleryStore, type GalleryCategory, type GalleryItem } from '@/stores/gallery'
import { useAgentWorkspaceStore } from '@/stores/agent-workspaces'
import ImageLightbox from '@/components/ImageLightbox.vue'
import ProcessedBadge from '@/components/ProcessedBadge.vue'

const router = useRouter()
const api = () => (window as any).api

// 复制/参考图操作的轻量级 toast：记录当前操作的 item.id 用于卡片上提示
const copyToast = ref<string | null>(null)
const copyToastMessage = ref('')
function showCardToast(itemId: string, msg: string, ms = 1500) {
  copyToast.value = itemId
  copyToastMessage.value = msg
  setTimeout(() => {
    if (copyToast.value === itemId) copyToast.value = null
  }, ms)
}

// 复制图片到剪贴板
async function copyImage(filePath: string) {
  try {
    const res = await api().clipboard.writeImage(filePath)
    if (res?.success) showCardToast(filePath, '已复制')
    else showCardToast(filePath, '复制失败')
  } catch (e) {
    console.error('Copy gallery image failed:', e)
    showCardToast(filePath, '复制失败')
  }
}

// 编辑：跳转到 ImageEditView 的 _local 模式（不依赖 image_generation 记录）
function editImage(item: GalleryItem) {
  router.push({ path: '/image-edit/_local', query: { path: item.file_path } })
}

// 作为参考图：读取图片为 base64 → 存 sessionStorage → 跳转到 AI 生图
// 复用 ImageGenView 现有的 query.hasRefImages + sessionStorage 'imageGen:refImages' 入口
async function useAsRefImage(item: GalleryItem) {
  try {
    const ext = (item.file_path.split('.').pop() || 'png').toLowerCase()
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext === 'webp' ? 'webp' : 'png'
    const b64 = await api().chat.invoke('readFileBase64', item.file_path)
    if (!b64) {
      showCardToast(item.id, '读取失败')
      return
    }
    const dataUri = `data:image/${mime};base64,${b64}`
    sessionStorage.setItem('imageGen:refImages', JSON.stringify([dataUri]))
    router.push({ path: '/image-gen', query: { hasRefImages: '1' } })
  } catch (e) {
    console.error('Use as ref image failed:', e)
    showCardToast(item.id, '操作失败')
  }
}

const store = useGalleryStore()
const workspaceStore = useAgentWorkspaceStore()

const SYS_CREATION = '__sys_creation__'
const SYS_MATTING = '__sys_matting__'
const SYS_FINE_MATTING = '__sys_fine_matting__'

const workspaceCatId = computed(() => workspaceStore.active?.gallery_category_id || '')
const otherWorkspaceCatIds = computed(() => {
  const current = workspaceCatId.value
  return new Set(
    workspaceStore.items
      .filter((w) => w.gallery_category_id && w.gallery_category_id !== current)
      .map((w) => w.gallery_category_id)
  )
})
const visibleCategories = computed(() => {
  const ws = workspaceCatId.value
  const others = otherWorkspaceCatIds.value
  const ranked = [...store.categories].filter((c) => {
    if (ws && c.id === ws) return true
    if (c.id === SYS_MATTING || c.id === SYS_FINE_MATTING || c.id === SYS_CREATION) return true
    if (others.has(c.id)) return false
    return true
  })
  return ranked.sort((a, b) => {
    const rank = (id: string) => {
      if (id === ws) return 0
      if (id === SYS_MATTING) return 1
      if (id === SYS_FINE_MATTING) return 2
      if (id === SYS_CREATION) return 9
      return 5
    }
    return rank(a.id) - rank(b.id)
  })
})
const showAllTab = computed(() => !workspaceCatId.value)

function categoryLabel(cat: GalleryCategory): string {
  if (workspaceCatId.value && cat.id === workspaceCatId.value) {
    return workspaceStore.activeName || '当前文件夹'
  }
  if (cat.id === SYS_CREATION) return '历史创作'
  return cat.name
}

// ────── Search ──────
const searchInput = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    store.setSearch(searchInput.value.trim())
  }, 300)
}

// ────── Selection ──────
const selectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())

function enterSelect() {
  selectMode.value = true
  selectedIds.value = new Set()
}

function exitSelect() {
  selectMode.value = false
  selectedIds.value = new Set()
}

function toggleSelect(id: string) {
  const s = new Set(selectedIds.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selectedIds.value = s
}

const allOnPageSelected = computed(() => {
  if (!store.items.length) return false
  return store.items.every((it) => selectedIds.value.has(it.id))
})

function toggleSelectAllOnPage() {
  const s = new Set(selectedIds.value)
  if (allOnPageSelected.value) {
    for (const it of store.items) s.delete(it.id)
  } else {
    for (const it of store.items) s.add(it.id)
  }
  selectedIds.value = s
}

async function batchRemove() {
  if (!selectedIds.value.size) return
  await store.removeItems([...selectedIds.value])
  exitSelect()
}

// ────── Sync ──────
const syncing = ref(false)

async function doSync() {
  syncing.value = true
  try {
    const result = await store.sync(store.activeCategoryId || undefined)
    if (result.removed > 0) {
      alert(`检测完成：检查 ${result.checked} 项，移除 ${result.removed} 条失效记录`)
    } else {
      alert(`检测完成：检查 ${result.checked} 项，全部有效`)
    }
  } catch (e: any) {
    alert('同步检测失败: ' + (e?.message || e))
  } finally {
    syncing.value = false
  }
}

// ────── Detail ──────
const detailItem = ref<GalleryItem | null>(null)
const lightboxSrc = ref<string | null>(null)
const lightboxPath = ref<string>('')

function openLightbox(filePath: string) {
  lightboxPath.value = filePath
  lightboxSrc.value = toLocalUrl(filePath)
}
function closeLightbox() {
  lightboxSrc.value = null
  lightboxPath.value = ''
}
function lightboxLocate() {
  if (lightboxPath.value) openInFolder(lightboxPath.value)
}

const detailIndex = computed(() => {
  if (!detailItem.value) return -1
  return store.items.findIndex(i => i.id === detailItem.value!.id)
})

function openDetail(item: GalleryItem) {
  detailItem.value = item
}

function prevDetail() {
  const idx = detailIndex.value
  if (idx > 0) detailItem.value = store.items[idx - 1]
}

function nextDetail() {
  const idx = detailIndex.value
  if (idx < store.items.length - 1) detailItem.value = store.items[idx + 1]
}

function openInFolder(filePath: string) {
  window.api.shell.showItemInFolder(filePath)
}

// ────── Category management ──────
const showCatManager = ref(false)
const showCatForm = ref(false)
const editingCatId = ref<string | null>(null)
const catForm = ref({ name: '', description: '' })
const deleteCatTarget = ref<{ id: string; name: string } | null>(null)

function openCatForm(cat?: GalleryCategory) {
  if (cat) {
    editingCatId.value = cat.id
    catForm.value = { name: cat.name, description: cat.description }
  } else {
    editingCatId.value = null
    catForm.value = { name: '', description: '' }
  }
  showCatForm.value = true
}

async function saveCat() {
  try {
    if (editingCatId.value) {
      await store.updateCategory(editingCatId.value, catForm.value)
    } else {
      await store.createCategory(catForm.value)
    }
    showCatForm.value = false
  } catch (e: any) {
    alert('保存失败: ' + (e?.message || e))
  }
}

function confirmDeleteCat(cat: GalleryCategory) {
  deleteCatTarget.value = { id: cat.id, name: cat.name }
}

async function executeDeleteCat() {
  if (!deleteCatTarget.value) return
  try {
    await store.deleteCategory(deleteCatTarget.value.id)
  } catch (e: any) {
    alert('删除失败: ' + (e?.message || e))
  }
  deleteCatTarget.value = null
}

// ────── Add dialog ──────
const showAddDialog = ref(false)
const addForm = ref({ categoryId: '', mode: '' as '' | 'file' | 'folder', recursive: true })
const addResult = ref('')

function openAddDialog() {
  addForm.value = {
    categoryId: workspaceCatId.value || store.activeCategoryId || store.categories[0]?.id || '',
    mode: '',
    recursive: true
  }
  addResult.value = ''
  showAddDialog.value = true
}

async function pickFiles() {
  addForm.value.mode = 'file'
  addResult.value = ''
  const result = await window.api.dialog.openFile({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'] }]
  }) as { canceled: boolean; filePaths: string[] }
  if (result.canceled || !result.filePaths?.length) return
  let added = 0
  for (const filePath of result.filePaths) {
    const item = await store.addFile(addForm.value.categoryId, filePath)
    if (item) added++
  }
  const total = result.filePaths.length
  addResult.value = `已添加 ${added} 张图片${total - added > 0 ? `，${total - added} 张已存在` : ''}`
}

async function pickFolder() {
  addForm.value.mode = 'folder'
  addResult.value = ''
  const result = await window.api.dialog.openFile({
    properties: ['openDirectory']
  }) as { canceled: boolean; filePaths: string[] }
  if (result.canceled || !result.filePaths?.length) return
  const folderPath = result.filePaths[0]
  const r = await store.addFolder(addForm.value.categoryId, folderPath, addForm.value.recursive)
  addResult.value = `扫描完成：添加 ${r.added} 张，跳过 ${r.skipped} 张已存在`
}

// ────── Pagination ──────
const totalPages = computed(() => Math.max(1, Math.ceil(store.total / store.pageSize)))

function goToPage(p: number) {
  const target = Math.max(1, Math.min(totalPages.value, p))
  if (target !== store.page) {
    store.setPage(target)
  }
}

// ────── Helpers ──────
function toLocalFileUrl(filePath: string, thumb = false): string {
  const isAbsolute = /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('/')
  const param = isAbsolute ? 'p' : 'rel'
  const normalized = isAbsolute ? filePath.replace(/\\/g, '/') : filePath
  const qs = `${param}=${encodeURIComponent(normalized)}`
  return `local-file://img?${qs}${thumb ? '&thumb=1' : ''}`
}

function toLocalUrl(filePath: string): string {
  return toLocalFileUrl(filePath, false)
}

function toLocalThumbUrl(filePath: string): string {
  return toLocalFileUrl(filePath, true)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function bindActiveWorkspaceGallery() {
  const id = workspaceStore.activeId
  if (id) await workspaceStore.prepareGallery(id)
  else await workspaceStore.ensureGallery()
  await store.fetchCategories()
  if (workspaceCatId.value) store.setCategory(workspaceCatId.value)
  else await store.fetchItems()
}

// ────── Init ──────
onMounted(async () => {
  await workspaceStore.refresh().catch(() => {})
  await bindActiveWorkspaceGallery()
})

watch(
  () => workspaceStore.activeId,
  async () => {
    await bindActiveWorkspaceGallery()
  }
)
</script>
