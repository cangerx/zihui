<template>
  <div class="h-full flex flex-col">
    <header class="page-header">
      <div class="flex items-center gap-2">
        <router-link to="/knowledge" class="btn-secondary text-sm">返回</router-link>
        <h2 class="text-sm font-semibold text-text-primary">{{ category?.name }}</h2>
        <span class="text-xs text-text-tertiary">{{ store.pagedTotal }} 个文档</span>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn-secondary text-sm" @click="handleSync" :disabled="syncing || vectorizeStore.vectorizing">
          {{ syncing || vectorizeStore.vectorizing ? '正在建立索引...' : '同步并建立索引' }}
        </button>
        <button class="btn-secondary text-sm" @click="handleBindFolder">绑定文件夹</button>
        <button class="btn-primary text-sm" @click="handleAddDoc">添加文档</button>
      </div>
    </header>

    <!-- Sync result banner -->
    <div v-if="syncResult" class="mx-6 mt-4 flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800">
      <span class="text-sm text-blue-800 dark:text-blue-300 flex-1">
        同步完成：新增 {{ syncResult.added }}，删除 {{ syncResult.removed }}，变更 {{ syncResult.modified }}
      </span>
      <button @click="syncResult = null" class="text-blue-400 hover:text-blue-600">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div v-if="vectorizeStore.progress" class="mx-6 mt-3 p-3 rounded-lg border border-surface-3 bg-surface-1 text-sm text-text-secondary">
      {{ vectorizeStore.progress.message }}
    </div>

    <div class="mx-6 mt-4 card p-4">
      <div class="flex items-center gap-2">
        <input v-model="retrieveQuery" class="input-field flex-1" placeholder="输入真实问题，验证数字员工能召回哪些原文" @keydown.enter="runRetrievePreview" />
        <button class="btn-secondary" :disabled="retrieving || !retrieveQuery.trim()" @click="runRetrievePreview">
          {{ retrieving ? '检索中...' : '检索测试' }}
        </button>
      </div>
      <div v-if="retrieveError" class="mt-3 text-sm text-red-500">{{ retrieveError }}</div>
      <div v-if="retrieveResults.length" class="mt-3 space-y-2">
        <div v-for="(hit, index) in retrieveResults" :key="index" class="rounded-lg border border-surface-3 p-3 bg-surface-1">
          <div class="flex items-center justify-between gap-3 text-xs text-text-tertiary">
            <span class="font-medium text-text-secondary">{{ hit.source }}</span>
            <span>融合分数 {{ hit.score.toFixed(3) }}</span>
          </div>
          <p class="mt-1 text-sm text-text-primary whitespace-pre-wrap line-clamp-4">{{ hit.content }}</p>
        </div>
      </div>
      <div v-else-if="retrieveSearched && !retrieveError" class="mt-3 text-sm text-text-tertiary">未找到相关原文证据。</div>
    </div>

    <!-- Bound folders -->
    <div v-if="category?.watch_paths?.length" class="mx-6 mt-4">
      <div class="text-xs font-medium text-text-secondary mb-2">绑定文件夹</div>
      <div class="flex flex-wrap gap-2">
        <div v-for="fp in category.watch_paths" :key="fp" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2 text-xs text-text-secondary">
          <svg class="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" /></svg>
          <span class="truncate max-w-xs" :title="fp">{{ fp }}</span>
          <button @click="handleUnbindFolder(fp)" class="text-red-400 hover:text-red-600 ml-1">
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Document table -->
    <div class="page-body">
      <div class="card overflow-hidden">
        <table class="w-full text-sm table-fixed">
          <colgroup>
            <col class="w-auto" />
            <col class="w-16" />
            <col class="w-20" />
            <col class="w-16" />
            <col class="w-16" />
          </colgroup>
          <thead>
            <tr class="border-b border-surface-3 bg-surface-1">
              <th class="text-left px-5 py-3 font-medium text-text-secondary">文档名称</th>
              <th class="text-center px-2 py-3 font-medium text-text-secondary">类型</th>
              <th class="text-center px-2 py-3 font-medium text-text-secondary">状态</th>
              <th class="text-center px-2 py-3 font-medium text-text-secondary">分块</th>
              <th class="text-right px-4 py-3 font-medium text-text-secondary">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="doc in store.pagedItems" :key="doc.id"
              class="border-b border-surface-3 last:border-0 hover:bg-surface-1 transition-colors">
              <td class="px-5 py-3 text-text-primary overflow-hidden">
                <div class="flex items-center gap-2.5 min-w-0">
                  <div class="w-7 h-7 rounded-lg bg-surface-2 flex items-center justify-center flex-shrink-0">
                    <span class="text-[10px] font-bold text-text-tertiary uppercase">{{ doc.file_type }}</span>
                  </div>
                  <span class="truncate block" :title="doc.name">{{ doc.name }}</span>
                </div>
              </td>
              <td class="text-center px-2 py-3 text-text-secondary uppercase text-xs">{{ doc.file_type }}</td>
              <td class="text-center px-2 py-3">
                <span :class="['status-badge', statusClass(doc.status)]">{{ statusLabel(doc.status) }}</span>
              </td>
              <td class="text-center px-2 py-3 text-text-secondary">{{ doc.chunk_count }}</td>
              <td class="text-right px-4 py-3">
                <button @click="handleDeleteDoc(doc)" class="text-xs text-red-500 hover:text-red-700">移除</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!store.pagedItems.length" class="p-12 text-center text-text-tertiary">
          <p class="text-sm">此分类下暂无文档</p>
          <p class="text-xs mt-1">点击"添加文档"或"绑定文件夹"来导入文档</p>
        </div>
      </div>

      <div class="mt-4">
        <Pagination v-model="currentPage" :total="store.pagedTotal" :page-size="PAGE_SIZE" />
      </div>
    </div>

    <!-- Delete confirm dialog -->
    <div v-if="scanPreview" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="scanPreview = null">
      <div class="bg-surface-0 rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.12)] w-[min(760px,calc(100vw-32px))] p-6">
        <h2 class="text-base font-semibold text-text-primary">确认建立知识库</h2>
        <p class="mt-2 text-sm text-text-secondary break-all">{{ scanPreview.rootPath }}</p>
        <div class="grid grid-cols-4 gap-2 mt-4 text-center text-xs">
          <div class="rounded-lg bg-surface-1 p-2"><b class="block text-text-primary">{{ scanPreview.counts.supported }}</b>可处理</div>
          <div class="rounded-lg bg-surface-1 p-2"><b class="block text-text-primary">{{ scanPreview.counts.ignored }}</b>已忽略</div>
          <div class="rounded-lg bg-surface-1 p-2"><b class="block text-text-primary">{{ scanPreview.counts.oversized }}</b>过大</div>
          <div class="rounded-lg bg-surface-1 p-2"><b class="block text-text-primary">{{ scanPreview.counts.inaccessible }}</b>不可访问</div>
        </div>
        <div class="mt-4 max-h-72 overflow-auto rounded-lg border border-surface-3 divide-y divide-surface-3">
          <div v-for="file in scanPreview.files" :key="file.path" class="flex gap-3 px-3 py-2 text-xs">
            <span :class="scanStatusClass(file.status)" class="w-16 flex-shrink-0">{{ scanStatusLabel(file.status) }}</span>
            <span class="flex-1 truncate text-text-secondary" :title="file.path">{{ file.relativePath || file.path }}</span>
            <span class="text-text-tertiary">{{ file.reason }}</span>
          </div>
          <div v-if="!scanPreview.files.length" class="p-5 text-center text-text-tertiary text-sm">未发现可导入文件</div>
        </div>
        <p class="mt-3 text-xs text-text-tertiary">
          可处理文件共 {{ formatBytes(scanPreview.supportedBytes) }}。若使用云端向量模型，提取后的文档文本会发送到对应服务并可能产生费用。
        </p>
        <p v-for="warning in scanPreview.warnings" :key="warning" class="mt-1 text-xs text-amber-600">{{ warning }}</p>
        <div class="flex justify-end gap-3 mt-5">
          <button class="btn-secondary" @click="scanPreview = null">取消</button>
          <button class="btn-primary" :disabled="scanPreview.counts.supported === 0 || confirmingScan" @click="confirmBindFolder">
            {{ confirmingScan ? '正在建立...' : '确认并建立索引' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="deleteTarget" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="deleteTarget = null">
      <div class="bg-surface-0 rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.12)] w-full max-w-sm p-6">
        <h2 class="text-base font-semibold text-text-primary mb-2">确认删除</h2>
        <p class="text-sm text-text-secondary mb-5">
          确定要移除「<b>{{ deleteTarget.name }}</b>」吗？关联的向量数据也将被删除。
        </p>
        <div class="flex justify-end gap-3">
          <button @click="deleteTarget = null" class="btn-secondary">取消</button>
          <button @click="executeDelete" class="btn-danger">确认删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useKnowledgeStore, type KBCategory, type KnowledgeBase } from '@/stores/knowledge'
import { useVectorizeStore } from '@/stores/vectorize'
import Pagination from '@/components/Pagination.vue'

const route = useRoute()
const store = useKnowledgeStore()
const vectorizeStore = useVectorizeStore()

const PAGE_SIZE = 25
const currentPage = ref(1)
const category = ref<KBCategory | null>(null)
const syncing = ref(false)
const syncResult = ref<{ added: number; removed: number; modified: number } | null>(null)
const deleteTarget = ref<{ id: string; name: string } | null>(null)
const retrieveQuery = ref('')
const retrieving = ref(false)
const retrieveSearched = ref(false)
const retrieveError = ref('')
const retrieveResults = ref<Array<{ score: number; source: string; content: string }>>([])
type ScanStatus = 'supported' | 'ignored' | 'oversized' | 'inaccessible'
interface ScanPreview {
  rootPath: string
  files: Array<{ path: string; relativePath: string; size: number; status: ScanStatus; reason: string }>
  counts: Record<ScanStatus, number>
  supportedBytes: number
  truncated: boolean
  warnings: string[]
}
const scanPreview = ref<ScanPreview | null>(null)
const confirmingScan = ref(false)

const categoryId = route.params.categoryId as string

function statusLabel(status: string): string {
  const map: Record<string, string> = { ready: '已就绪', stale: '有更新，旧索引可用', processing: '处理中', pending: '待向量化', unvectorizable: '无法向量化', error: '失败' }
  return map[status] || status
}

function statusClass(status: string): string {
  const map: Record<string, string> = { ready: 'status-active', stale: 'status-warning', processing: 'status-warning', pending: 'status-inactive', unvectorizable: 'status-warning', error: 'status-error' }
  return map[status] || 'status-inactive'
}

async function loadPage() {
  await store.fetchKnowledgeBasesPaged(categoryId, currentPage.value, PAGE_SIZE)
}

async function loadCategory() {
  await store.fetchCategories()
  category.value = store.categories.find((c) => c.id === categoryId) || null
}

watch(currentPage, () => loadPage())

async function handleSync() {
  syncing.value = true
  try {
    const result = await store.syncCategory(categoryId)
    syncResult.value = result
    if (result.added > 0 || result.modified > 0) {
      await vectorizeStore.vectorizeCategory(categoryId)
    }
    await loadPage()
    await loadCategory()
  } catch (e: any) {
    alert('同步失败: ' + (e?.message || e))
  } finally {
    syncing.value = false
  }
}

async function handleBindFolder() {
  try {
    const result = await window.api.dialog.openFile({
      title: '选择文件夹',
      properties: ['openDirectory']
    }) as { canceled: boolean; filePaths: string[] }
    if (result.canceled || !result.filePaths.length) return
    const folderPath = result.filePaths[0]
    scanPreview.value = await window.api.knowledge.invoke('scanFolder', folderPath) as ScanPreview
  } catch (e: any) {
    alert('绑定失败: ' + (e?.message || e))
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function scanStatusLabel(status: ScanStatus): string {
  return { supported: '可处理', ignored: '已忽略', oversized: '过大', inaccessible: '不可访问' }[status]
}

function scanStatusClass(status: ScanStatus): string {
  return status === 'supported' ? 'text-green-600' : status === 'ignored' ? 'text-text-tertiary' : 'text-amber-600'
}

async function confirmBindFolder() {
  if (!scanPreview.value || confirmingScan.value) return
  confirmingScan.value = true
  try {
    await store.bindFolder(categoryId, scanPreview.value.rootPath)
    scanPreview.value = null
    await loadCategory()
    await handleSync()
  } catch (e: any) {
    alert('建立知识库失败: ' + (e?.message || e))
  } finally {
    confirmingScan.value = false
  }
}

async function handleUnbindFolder(folderPath: string) {
  await store.unbindFolder(categoryId, folderPath)
  await loadCategory()
}

async function handleAddDoc() {
  try {
    const result = await window.api.dialog.openFile({
      title: '选择文档',
      filters: [
        { name: 'Documents', extensions: ['txt', 'md', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'pptx', 'json', 'csv'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    }) as { canceled: boolean; filePaths: string[] }
    if (result.canceled || !result.filePaths.length) return
    for (const filePath of result.filePaths) {
      const fileName = filePath.split(/[\\/]/).pop() || 'unknown'
      const ext = fileName.split('.').pop() || ''
      await store.createKnowledgeBase({
        category_id: categoryId,
        name: fileName,
        file_path: filePath,
        file_type: ext
      })
    }
    await loadPage()
  } catch (e: any) {
    alert('添加文档失败: ' + (e?.message || e))
  }
}

async function runRetrievePreview() {
  const query = retrieveQuery.value.trim()
  if (!query || retrieving.value) return
  retrieving.value = true
  retrieveSearched.value = true
  retrieveError.value = ''
  retrieveResults.value = []
  try {
    const result = await window.api.knowledge.invoke('retrievePreview', query, categoryId, 8) as {
      results: Array<{ score: number; source: string; content: string }>
      error?: string
    }
    retrieveResults.value = result.results || []
    retrieveError.value = result.error || ''
  } catch (e: any) {
    retrieveError.value = e?.message || String(e)
  } finally {
    retrieving.value = false
  }
}

function handleDeleteDoc(doc: KnowledgeBase) {
  deleteTarget.value = { id: doc.id, name: doc.name }
}

async function executeDelete() {
  if (!deleteTarget.value) return
  try {
    await store.deleteKnowledgeBase(deleteTarget.value.id)
    await loadPage()
  } catch (e: any) {
    alert('删除失败: ' + (e?.message || e))
  }
  deleteTarget.value = null
}

onMounted(async () => {
  await loadCategory()
  await loadPage()
})
</script>
