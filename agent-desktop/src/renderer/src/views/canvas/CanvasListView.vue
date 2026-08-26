<template>
  <div class="h-full flex flex-col">
    <header class="page-header">
      <div class="flex items-center gap-3">
        <input
          v-model="search"
          placeholder="搜索画布..."
          class="px-3 py-1.5 text-xs border border-surface-3 rounded-lg bg-surface-1 outline-none focus:ring-2 focus:ring-primary-500 w-48"
        />
        <span v-if="multiSelectMode" class="text-xs text-text-secondary">已选 {{ selectedIds.size }} 个</span>
      </div>
      <div class="flex items-center gap-2">
        <template v-if="multiSelectMode">
          <button @click="doExportSelected" :disabled="!selectedIds.size || exporting || deleting" class="btn-primary text-xs disabled:opacity-40 disabled:cursor-not-allowed">
            {{ exporting ? '导出中...' : '导出选中' }}
          </button>
          <!-- 批量删除：两步确认（对齐单删 / 清空画布的交互惯例） -->
          <template v-if="confirmBatchDelete">
            <button @click="doDeleteSelected" :disabled="deleting" class="px-3 py-1.5 text-xs font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {{ deleting ? '删除中...' : `确认删除 ${selectedIds.size} 个画布` }}
            </button>
            <button @click="confirmBatchDelete = false" :disabled="deleting" class="btn-secondary text-xs">取消删除</button>
          </template>
          <button v-else @click="confirmBatchDelete = true" :disabled="!selectedIds.size" class="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-50 dark:text-red-300 dark:border-red-800 dark:hover:bg-red-900/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            删除选中
          </button>
          <button @click="exitMultiSelect" class="btn-secondary text-xs">取消</button>
        </template>
        <template v-else>
          <button @click="doImport" :disabled="importing" class="btn-secondary text-xs disabled:opacity-40 disabled:cursor-not-allowed">
            {{ importing ? '导入中...' : '导入' }}
          </button>
          <button @click="enterMultiSelect" :disabled="!filtered.length" class="btn-secondary text-xs disabled:opacity-40 disabled:cursor-not-allowed">批量勾选</button>
          <button @click="showCreateDialog = true" class="btn-primary text-xs">+ 新建画布</button>
        </template>
      </div>
    </header>
    <div class="flex-1 overflow-y-auto p-6" @scroll="onListScroll">
      <div v-if="!filtered.length" class="empty-state">
        <div class="w-20 h-20 rounded-2xl bg-surface-2 flex items-center justify-center mb-5">
          <svg class="w-10 h-10 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <rect x="2" y="2" width="8" height="6" rx="1.5" stroke-width="1.5"/>
            <rect x="14" y="16" width="8" height="6" rx="1.5" stroke-width="1.5"/>
            <rect x="14" y="2" width="8" height="6" rx="1.5" stroke-width="1.5"/>
            <path d="M10 5h4" stroke-width="1.5"/>
            <path d="M6 8v5a2 2 0 0 0 2 2h6" stroke-width="1.5"/>
            <path d="M18 8v8" stroke-width="1.5"/>
          </svg>
        </div>
        <p class="text-sm font-medium text-text-secondary mb-1">暂无画布项目</p>
        <p class="text-xs text-text-tertiary">点击「新建画布」创建你的第一个生图工作流</p>
      </div>
      <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-w-5xl">
        <div
          v-for="project in displayed"
          :key="project.id"
          class="group relative bg-surface-0 border rounded-xl p-4 cursor-pointer hover:shadow-card transition-all"
          :class="selectedIds.has(project.id) ? 'border-primary-500 ring-2 ring-primary-500/30' : 'border-surface-3 hover:border-primary-400'"
          @click="onCardClick(project.id)"
        >
          <div v-if="multiSelectMode" class="absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors" :class="selectedIds.has(project.id) ? 'bg-primary-500 border-primary-500' : 'bg-surface-0 border-surface-3'">
            <svg v-if="selectedIds.has(project.id)" class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
          </div>
          <div class="flex items-start justify-between mb-3">
            <div class="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
              <svg class="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="2" width="8" height="6" rx="1.5"/>
                <rect x="14" y="16" width="8" height="6" rx="1.5"/>
                <rect x="14" y="2" width="8" height="6" rx="1.5"/>
                <path d="M10 5h4"/>
                <path d="M6 8v5a2 2 0 0 0 2 2h6"/>
                <path d="M18 8v8"/>
              </svg>
            </div>
            <div v-if="!multiSelectMode" class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button @click.stop="startRename(project)" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors" title="重命名">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" /></svg>
              </button>
              <button @click.stop="doDuplicate(project.id)" :disabled="duplicating" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 disabled:opacity-30 transition-colors" title="复制">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" /></svg>
              </button>
              <button @click.stop="doExportSingle(project.id)" :disabled="exporting" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 disabled:opacity-30 transition-colors" title="导出">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
              </button>
              <!-- v0.6.9+ 打开该画布的独立图片目录（参考图 + 生成图都在这） -->
              <button @click.stop="doOpenImageDir(project.id)" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors" title="打开画布图片文件夹">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" /></svg>
              </button>
              <template v-if="confirmDeleteId === project.id">
                <button @click.stop="doDelete(project.id)" class="p-1.5 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:text-red-300 dark:hover:bg-red-900/30 transition-colors" title="确认删除">
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                </button>
                <button @click.stop="confirmDeleteId = null" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors" title="取消">
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </template>
              <button v-else @click.stop="confirmDeleteId = project.id" class="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-300 dark:hover:bg-red-900/30 transition-colors" title="删除">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
          <div v-if="renamingId === project.id" @click.stop>
            <input
              ref="renameInputRef"
              v-model="renameTitle"
              @keydown.enter="confirmRename(project.id)"
              @keydown.escape="renamingId = null"
              @blur="confirmRename(project.id)"
              maxlength="30"
              class="w-full text-sm font-medium text-text-primary bg-transparent border-b border-primary-400 outline-none py-0.5"
            />
          </div>
          <h3 v-else class="text-sm font-medium text-text-primary truncate mb-1">{{ project.title }}</h3>
          <p class="text-[10px] text-text-tertiary">{{ formatDate(project.updated_at) }}</p>
        </div>
      </div>
      <!-- 加载更多：列表只渲染前 visibleCount 个，触底自动加载，量大时避免一次性渲染全部卡片 -->
      <div v-if="hasMore" class="flex justify-center mt-5">
        <button @click="loadMore" class="btn-secondary text-xs">加载更多（剩余 {{ filtered.length - displayed.length }}）</button>
      </div>
    </div>

    <!-- Import Result Dialog -->
    <div v-if="importResult" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="importResult = null">
      <div class="w-[480px] max-h-[70vh] flex flex-col bg-surface-0 rounded-2xl shadow-xl border border-surface-3 p-6" @click.stop>
        <h2 class="text-base font-semibold text-text-primary mb-2">导入完成</h2>
        <p class="text-xs text-text-secondary mb-4">已创建 {{ importResult.titles.length }} 个新项目。</p>
        <div v-if="importResult.titles.length" class="text-xs text-text-secondary mb-4 space-y-1 max-h-32 overflow-y-auto">
          <div v-for="t in importResult.titles" :key="t" class="flex items-center gap-2">
            <svg class="w-3 h-3 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
            <span class="truncate">{{ t }}</span>
          </div>
        </div>
        <div v-if="importResult.unmatched.length" class="flex-1 overflow-y-auto">
          <p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-800 rounded-lg px-3 py-2 mb-2">
            以下模型在本机未找到，请打开项目后手动重选：
          </p>
          <ul class="text-xs text-text-secondary space-y-1">
            <li v-for="(u, i) in importResult.unmatched" :key="i" class="flex items-start gap-2">
              <span class="text-text-tertiary flex-shrink-0">·</span>
              <span><span class="text-text-primary">{{ u.project }}</span> · {{ unmatchedFieldLabel(u.field) }}: <code class="px-1 py-0.5 bg-surface-2 rounded">{{ u.name }}</code></span>
            </li>
          </ul>
        </div>
        <div class="flex justify-end mt-4">
          <button @click="importResult = null" class="btn-primary text-xs">知道了</button>
        </div>
      </div>
    </div>

    <!-- Create Canvas Dialog -->
    <div v-if="showCreateDialog" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="closeCreateDialog">
      <div class="w-[420px] bg-surface-0 rounded-2xl shadow-xl border border-surface-3 p-6" @click.stop>
        <h2 class="text-base font-semibold text-text-primary mb-4">新建流式画布</h2>
        <div class="space-y-4">
          <div>
            <label class="form-label">画布名称</label>
            <input v-model="createForm.title" placeholder="输入画布名称" maxlength="30" class="input-field" @keydown.enter="doCreate" />
          </div>
          <div>
            <label class="form-label">文本处理服务商</label>
            <select v-model="createForm.text_provider_id" class="select-field" @change="onTextProviderChange">
              <option value="">-- 请选择 --</option>
              <option v-for="p in modelStore.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <div v-if="createForm.text_provider_id">
            <label class="form-label">文本模型</label>
            <select v-model="createForm.text_model_id" class="select-field">
              <option value="">-- 请选择 --</option>
              <optgroup v-if="textModelGroups.recommended.length" label="推荐（对话）">
                <option v-for="m in textModelGroups.recommended" :key="m" :value="m">{{ modelStore.optionLabel(createForm.text_provider_id, m) }}</option>
              </optgroup>
            </select>
          </div>
          <div>
            <label class="form-label">生图服务商</label>
            <select v-model="createForm.image_provider_id" class="select-field" @change="onImageProviderChange">
              <option value="">-- 请选择 --</option>
              <option v-for="p in modelStore.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <div v-if="createForm.image_provider_id">
            <label class="form-label">生图模型</label>
            <select v-model="createForm.image_model_id" class="select-field">
              <option value="">-- 请选择 --</option>
              <optgroup v-if="imageModelGroups.recommended.length" label="推荐（生图）">
                <option v-for="m in imageModelGroups.recommended" :key="m" :value="m">{{ modelStore.optionLabel(createForm.image_provider_id, m) }}</option>
              </optgroup>
            </select>
          </div>
          <div>
            <label class="form-label">并发数</label>
            <input v-model.number="createForm.concurrency" type="number" min="1" max="20" class="input-field" />
            <p class="text-[10px] text-text-disabled mt-1">请确认接口的实际并发限制，并确保设备性能满足并发要求</p>
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-6">
          <button @click="closeCreateDialog" class="btn-secondary text-xs">取消</button>
          <button @click="doCreate" :disabled="!createForm.title.trim()" class="btn-primary text-xs disabled:opacity-40 disabled:cursor-not-allowed">创建</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useCanvasStore } from '@/stores/canvas'
import { useModelStore } from '@/stores/models'
import { useHandoffStore } from '@/stores/handoff'
import { useWorkflowEngine } from './composables/useWorkflowEngine'
import { groupAndSort } from '@/utils/model-caps'
import { warmHintsCache, getHintsSync } from '@/utils/model-usage-hints'

const router = useRouter()
const canvasStore = useCanvasStore()
const modelStore = useModelStore()
const handoff = useHandoffStore()
const api = () => (window as any).api

const search = ref('')
const confirmDeleteId = ref<string | null>(null)
const renamingId = ref<string | null>(null)
const renameTitle = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)
const showCreateDialog = ref(false)
const pendingOrchestrateDescription = ref('')

// === 导入导出状态 ===
const multiSelectMode = ref(false)
const selectedIds = ref(new Set<string>())
const exporting = ref(false)
const importing = ref(false)
// 批量删除（多选模式）：两步确认状态 + 删除中防重入
const confirmBatchDelete = ref(false)
const deleting = ref(false)
const { isProjectAnyRunning } = useWorkflowEngine()

interface ImportUnmatched {
  project: string
  field: 'text_provider' | 'text_model' | 'image_provider' | 'image_model'
  name: string
}
const importResult = ref<{ titles: string[]; unmatched: ImportUnmatched[] } | null>(null)

const hintsTick = ref(0)

const createForm = ref({
  title: '',
  text_provider_id: '',
  text_model_id: '',
  image_provider_id: '',
  image_model_id: '',
  concurrency: 1
})

const textProvider = computed(() =>
  modelStore.providers.find(p => p.id === createForm.value.text_provider_id) || null
)
const imageProvider = computed(() =>
  modelStore.providers.find(p => p.id === createForm.value.image_provider_id) || null
)
const textModelGroups = computed(() => {
  hintsTick.value
  if (!textProvider.value) return { recommended: [], others: [] }
  return groupAndSort(textProvider.value.models, 'chat', {
    cloudTypeOf: (mid) => modelStore.cloudTypeOf(textProvider.value!.id, mid),
    usageHints: getHintsSync('chat', textProvider.value.id)
  })
})
const imageModelGroups = computed(() => {
  hintsTick.value
  if (!imageProvider.value) return { recommended: [], others: [] }
  return groupAndSort(imageProvider.value.models, 'image', {
    cloudTypeOf: (mid) => modelStore.cloudTypeOf(imageProvider.value!.id, mid),
    usageHints: getHintsSync('image', imageProvider.value.id)
  })
})

function onTextProviderChange() {
  createForm.value.text_model_id = ''
}

function onImageProviderChange() {
  createForm.value.image_model_id = ''
}

const filtered = computed(() => {
  if (!search.value) return canvasStore.projects
  const q = search.value.toLowerCase()
  return canvasStore.projects.filter((p) => p.title.toLowerCase().includes(q))
})

// 渲染层窗口化：本地 sqlite 取全量很快，真正的瓶颈是一次性把所有画布卡片渲染成 DOM。
// 只渲染前 visibleCount 个，触底或点「加载更多」再增量加载；搜索仍是对全量内存即时过滤。
const PAGE_SIZE = 24
const visibleCount = ref(PAGE_SIZE)
const displayed = computed(() => filtered.value.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < filtered.value.length)
function loadMore() {
  if (hasMore.value) visibleCount.value += PAGE_SIZE
}
function onListScroll(e: Event) {
  const el = e.target as HTMLElement
  // 距底部 240px 内即预加载下一批，滚动更顺滑
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) loadMore()
}
// 搜索条件变化时重置窗口，避免停留在上一次翻得很深的位置
watch(search, () => { visibleCount.value = PAGE_SIZE })

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function closeCreateDialog() {
  showCreateDialog.value = false
  pendingOrchestrateDescription.value = ''
}

async function doCreate() {
  const title = createForm.value.title.trim()
  if (!title) return
  const concurrency = Math.max(1, Math.min(20, createForm.value.concurrency || 1))
  const project = await canvasStore.createProject({
    title,
    text_provider_id: createForm.value.text_provider_id,
    // 保留复合 key（`model_id#@provider_name`）入库，调用时 main 端反查 cloud_model_id 精确路由服务商
    text_model_id: createForm.value.text_model_id,
    image_provider_id: createForm.value.image_provider_id,
    image_model_id: createForm.value.image_model_id,
    concurrency
  })
  showCreateDialog.value = false
  createForm.value = { title: '', text_provider_id: '', text_model_id: '', image_provider_id: '', image_model_id: '', concurrency: 1 }
  if (pendingOrchestrateDescription.value) {
    handoff.set('canvasOrchestrate', { description: pendingOrchestrateDescription.value })
    pendingOrchestrateDescription.value = ''
  }
  router.push(`/canvas/${project.id}`)
}

function openProject(id: string) {
  router.push(`/canvas/${id}`)
}

// === 导入导出交互 ===

function onCardClick(id: string) {
  if (multiSelectMode.value) {
    toggleSelect(id)
  } else {
    openProject(id)
  }
}

function enterMultiSelect() {
  multiSelectMode.value = true
  selectedIds.value = new Set()
  confirmBatchDelete.value = false
}

function exitMultiSelect() {
  multiSelectMode.value = false
  selectedIds.value = new Set()
  confirmBatchDelete.value = false
}

function toggleSelect(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

async function doExportSingle(id: string) {
  if (exporting.value) return
  await runExport([id])
}

async function doExportSelected() {
  if (exporting.value) return
  if (!selectedIds.value.size) return
  // 保持列表顺序（filtered 已按 updated_at desc）
  const orderedIds = filtered.value.map((p) => p.id).filter((id) => selectedIds.value.has(id))
  await runExport(orderedIds)
  if (orderedIds.length > 0) exitMultiSelect()
}

async function runExport(ids: string[]) {
  exporting.value = true
  try {
    const result = await api().canvas.invoke('exportProjects', ids)
    if (result?.canceled) return
    if (!result?.success) {
      alert('导出失败: ' + (result?.error || '未知错误'))
    }
  } catch (e: any) {
    alert('导出异常: ' + (e?.message || ''))
  } finally {
    exporting.value = false
  }
}

async function doImport() {
  if (importing.value) return
  importing.value = true
  try {
    const result = await api().canvas.invoke('importProjects')
    if (result?.canceled) return
    if (!result?.success) {
      alert('导入失败: ' + (result?.error || '未知错误'))
      return
    }
    // 刷新列表
    await canvasStore.fetchProjects()
    importResult.value = {
      titles: result.newProjectTitles || [],
      unmatched: result.unmatched || []
    }
  } catch (e: any) {
    alert('导入异常: ' + (e?.message || ''))
  } finally {
    importing.value = false
  }
}

function unmatchedFieldLabel(field: string): string {
  switch (field) {
    case 'text_provider': return '文本服务商'
    case 'text_model': return '文本模型'
    case 'image_provider': return '生图服务商'
    case 'image_model': return '生图模型'
    default: return field
  }
}

function startRename(project: any) {
  renamingId.value = project.id
  renameTitle.value = project.title
  nextTick(() => {
    const input = renameInputRef.value
    if (Array.isArray(input)) input[0]?.focus()
    else input?.focus()
  })
}

async function confirmRename(id: string) {
  const title = renameTitle.value.trim()
  if (title) {
    await canvasStore.updateProject(id, { title })
  }
  renamingId.value = null
}

const duplicating = ref(false)
async function doDuplicate(id: string) {
  if (duplicating.value) return
  duplicating.value = true
  try {
    await canvasStore.duplicateProject(id)
  } finally {
    duplicating.value = false
  }
}

async function doDelete(id: string) {
  await canvasStore.deleteProject(id)
  confirmDeleteId.value = null
}

/**
 * 批量删除选中画布（两步确认后执行）。
 * 正在运行（整图工作流或任一节点在跑）的画布跳过：删除会抽掉后台任务的数据载体，
 * 任务继续跑只会写库失败；单删入口暂不拦截该场景，批量入口一次影响多个故收紧。
 */
async function doDeleteSelected() {
  if (deleting.value) return
  const ids = Array.from(selectedIds.value)
  if (!ids.length) return
  const runningCount = ids.filter((id) => isProjectAnyRunning(id)).length
  const targets = ids.filter((id) => !isProjectAnyRunning(id))
  deleting.value = true
  try {
    for (const id of targets) {
      await canvasStore.deleteProject(id)
    }
  } finally {
    deleting.value = false
    confirmBatchDelete.value = false
    exitMultiSelect()
  }
  if (runningCount > 0) {
    alert(`${runningCount} 个画布正在运行，已跳过（停止运行后可删除）`)
  }
}

/**
 * v0.6.9+ 打开该画布的独立图片目录。主进程会保证目录存在，
 * 即使该画布从未产出图也会打开一个空目录让用户看路径。
 */
async function doOpenImageDir(id: string) {
  try {
    const result = await canvasStore.openProjectImageDir(id)
    if (!result?.success) {
      alert(`打开失败：${result?.error || '未知错误'}`)
    }
  } catch (e: any) {
    alert(`打开失败：${e?.message || e}`)
  }
}

onMounted(async () => {
  await Promise.all([canvasStore.fetchProjects(), modelStore.fetchProviders(), warmHintsCache()])
  hintsTick.value++

  const pending = handoff.consume<{ description?: string }>('canvasOrchestrate')
  if (pending?.description) {
    pendingOrchestrateDescription.value = pending.description
    showCreateDialog.value = true
  }
})
</script>
