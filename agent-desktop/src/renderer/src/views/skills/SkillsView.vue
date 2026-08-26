<template>
  <div class="h-full flex flex-col">
    <header class="page-header justify-end">
      <div class="flex items-center gap-2">
        <div class="relative" ref="addMenuRoot">
          <button class="btn-primary text-xs" @click="showAddMenu = !showAddMenu">添加技能</button>
          <div v-if="showAddMenu" class="absolute right-0 top-full mt-1 w-40 py-1 rounded-lg bg-surface-0 border border-surface-3 shadow-modal z-20">
            <button type="button" class="w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-2 hover:text-text-primary" @click="startCreateInChat">对话中创建</button>
            <button type="button" class="w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-2 hover:text-text-primary" @click="openImportModal">上传技能</button>
            <button type="button" class="w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-2 hover:text-text-primary" @click="openManualForm">手动填写</button>
          </div>
        </div>
        <button class="btn-secondary text-xs" @click="openSkillsDir">打开目录</button>
      </div>
    </header>

    <div class="page-body">
      <div class="max-w-7xl mx-auto">
        <div v-if="showCreateForm" class="max-w-xl mb-6 form-card">
          <div>
            <label class="form-label">技能名称</label>
            <input v-model="createForm.name" class="input-field" placeholder="例如: web-search" />
          </div>
          <div>
            <label class="form-label">简要描述</label>
            <input v-model="createForm.description" class="input-field" placeholder="一句话描述技能功能" />
          </div>
          <div>
            <label class="form-label">SKILL.md 内容</label>
            <textarea v-model="createForm.content" rows="12" class="textarea-field font-mono text-xs" placeholder="# 技能名称&#10;&#10;## 功能&#10;&#10;..."></textarea>
          </div>
          <div class="flex gap-3 pt-2">
            <button @click="doCreate" class="btn-primary">创建</button>
            <button @click="showCreateForm = false" class="btn-secondary">取消</button>
          </div>
        </div>

        <div v-else-if="viewingSkill" class="max-w-3xl mb-6">
          <div class="flex items-center gap-3 mb-4">
            <button @click="viewingSkill = null; viewContent = ''" class="btn-ghost text-xs">返回</button>
            <span class="text-sm font-semibold text-text-primary flex-1 truncate">{{ viewingSkill.name }}</span>
            <button type="button" class="btn-danger" :disabled="deletingDir === viewingSkill.dirName" @click="deleteLocalSkill(viewingSkill.dirName, viewingSkill.name)">{{ deletingDir === viewingSkill.dirName ? '删除中...' : '删除' }}</button>
          </div>
          <div class="card p-5 overflow-auto max-h-[60vh]">
            <pre class="whitespace-pre-wrap text-xs font-mono leading-relaxed text-text-primary">{{ viewContent }}</pre>
          </div>
        </div>

        <template v-else>
          <div class="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 class="text-sm font-semibold text-text-primary">技能库</h2>
              <p class="text-[11px] text-text-tertiary mt-0.5">云端已审核与本地未审核技能在同一页管理；本地内容不会上传。</p>
              <p v-if="store.catalog?.offline" class="text-[11px] text-amber-700 mt-0.5">当前展示离线缓存，联网后点「刷新目录」可更新。</p>
            </div>
            <div class="flex items-center gap-2">
              <select v-model="sourceFilter" class="input-field !py-1.5 !w-28 text-xs">
                <option value="all">全部来源</option>
                <option value="cloud">云端已审核</option>
                <option value="local">本地未审核</option>
              </select>
              <button type="button" class="btn-secondary text-xs" :disabled="catalogRefreshing" @click="refreshCatalog">{{ catalogRefreshing ? '刷新中...' : '刷新目录' }}</button>
              <div class="relative w-56 shrink-0">
              <input
                v-model="searchKeyword"
                class="input-field !py-1.5 !pr-8 text-xs"
                placeholder="搜索我的技能"
                @keyup.enter="onSearchEnter"
              />
              <button type="button" tabindex="-1" class="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary" @click="onSearchEnter">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
              </button>
              </div>
            </div>
          </div>

          <div v-if="visibleCategories.length" class="flex items-center gap-1.5 mb-4 overflow-x-auto pb-0.5">
            <button
              v-for="cat in visibleCategories"
              :key="cat.key"
              type="button"
              @click="selectCategory(cat.key)"
              :class="[
                'px-3 py-1 text-[11px] rounded-full whitespace-nowrap transition-colors',
                activeCategory === cat.key
                  ? 'bg-text-primary text-surface-0'
                  : 'bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary'
              ]"
            >{{ cat.label }}</button>
            <button
              v-if="hiddenCategoryCount > 0 && !showAllCategories"
              type="button"
              class="px-3 py-1 text-[11px] rounded-full bg-surface-2 text-text-secondary hover:bg-surface-3 whitespace-nowrap"
              @click="showAllCategories = true"
            >+{{ hiddenCategoryCount }}</button>
          </div>

          <div v-if="!filteredCards.length" class="empty-state">
            <p class="text-sm font-medium text-text-secondary mb-1">{{ emptyTitle }}</p>
            <p class="text-xs">{{ emptyHint }}</p>
          </div>
          <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <div
              v-for="card in filteredCards"
              :key="card.key"
              class="card p-4 flex flex-col min-h-[168px] hover:bg-surface-1"
            >
              <div class="flex items-start gap-3">
                <div class="w-9 h-9 rounded-lg overflow-hidden bg-surface-2 flex-shrink-0 flex items-center justify-center">
                  <img v-if="card.iconUrl" :src="card.iconUrl" class="w-full h-full object-cover" />
                  <span v-else class="text-xs font-semibold" :class="skillTone(card.name)">{{ skillInitial(card.name) }}</span>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-start gap-2">
                    <h3 class="min-w-0 flex-1 text-[15px] font-semibold text-text-primary leading-snug truncate">{{ card.name }}</h3>
                    <span class="shrink-0 text-[11px] px-1.5 py-0.5 rounded" :class="card.reviewed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'">{{ card.reviewed ? '已审核' : '未审核' }}</span>
                  </div>
                </div>
              </div>
              <p class="text-[13px] text-text-secondary mt-3 line-clamp-2 leading-relaxed min-h-[2.6em]">{{ card.description || '暂无简介' }}</p>
              <div class="mt-auto pt-3 flex items-center gap-2">
                <span class="text-[11px] text-text-tertiary">{{ card.originLabel }}</span>
                <span v-if="card.version" class="text-[11px] text-text-tertiary">{{ card.version }}</span>
                <span class="flex-1" />
                <button
                  v-if="card.installable"
                  type="button"
                  class="px-2.5 py-1 text-[11px] rounded-md bg-primary-600 text-white hover:bg-primary-700"
                  @click="installCloudCard(card)"
                >安装</button>
                <button
                  v-if="!card.installable"
                  type="button"
                  class="px-2.5 py-1 text-[11px] rounded-md border border-surface-3 text-text-secondary hover:bg-surface-2"
                  @click="manageCard(card)"
                >管理</button>
                <button
                  v-if="!card.installable"
                  type="button"
                  class="px-2.5 py-1 text-[11px] rounded-md border border-surface-3 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-50"
                  :disabled="deletingDir === cardDirName(card)"
                  @click="deleteCard(card)"
                >{{ deletingDir === cardDirName(card) ? '删除中...' : '删除' }}</button>
                <button v-if="!card.installable" type="button" class="px-2.5 py-1 text-[11px] rounded-md bg-primary-600 text-white hover:bg-primary-700" @click="useCard(card)">使用</button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <div v-if="showImport" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="showImport = false">
      <div class="relative w-[420px] max-w-[90vw] bg-surface-0 rounded-2xl border border-surface-3 shadow-modal p-5">
        <h2 class="text-sm font-semibold text-text-primary mb-4">导入技能</h2>
        <div
          class="rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors cursor-pointer"
          :class="importDragging ? 'border-primary-400 bg-primary-50/60' : 'border-surface-3 hover:border-primary-300 hover:bg-surface-1'"
          @dragover.prevent="importDragging = true"
          @dragleave.prevent="importDragging = false"
          @drop.prevent="onImportDrop"
          @click="pickImportFile"
        >
          <svg class="w-8 h-8 mx-auto text-text-tertiary mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>
          <p class="text-sm font-medium text-text-primary">拖拽文件或点击上传</p>
          <p class="text-[11px] text-text-tertiary mt-1">支持 zip、SKILL.md，或包含该文件的文件夹</p>
        </div>
        <div class="mt-3 flex items-center justify-between">
          <button type="button" class="text-[11px] text-text-tertiary hover:text-text-primary" @click.stop="pickImportFolder">选择文件夹</button>
          <span v-if="importing" class="text-[11px] text-text-tertiary">导入中...</span>
        </div>
        <p v-if="importError" class="text-[11px] text-red-500 mt-2">{{ importError }}</p>
        <div class="mt-4 text-[11px] text-text-tertiary leading-relaxed space-y-1">
          <p class="font-medium text-text-secondary">文件要求</p>
          <p>文件夹或 zip 内须包含名为 SKILL.md 的文件。</p>
          <p>文件开头用 YAML 写 name 与 description。</p>
        </div>
        <div class="mt-4 flex justify-end">
          <button type="button" class="btn-secondary" @click="showImport = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePromptSkillStore, type PromptSkill } from '@/stores/prompt-skills'

const store = usePromptSkillStore()
const router = useRouter()

const SKILL_TONES = [
  'text-emerald-700 dark:text-emerald-300',
  'text-teal-700 dark:text-teal-300',
  'text-stone-600 dark:text-stone-300',
  'text-amber-700 dark:text-amber-300',
  'text-sky-700 dark:text-sky-300'
]

function skillInitial(name: string): string {
  const t = (name || '').trim()
  return t ? t.charAt(0) : '?'
}

function skillTone(name: string): string {
  let h = 0
  for (const c of name || '') h = (h + c.charCodeAt(0)) % SKILL_TONES.length
  return SKILL_TONES[h]
}

const activeCategory = ref('')
const showAllCategories = ref(false)

const showCreateForm = ref(false)
const showAddMenu = ref(false)
const addMenuRoot = ref<HTMLElement | null>(null)
const showImport = ref(false)
const importDragging = ref(false)
const importing = ref(false)
const importError = ref('')
const createForm = ref({ name: '', description: '', content: '' })

const viewingSkill = ref<PromptSkill | null>(null)
const viewContent = ref('')
const deletingDir = ref('')
const catalogRefreshing = ref(false)

const sourceFilter = ref<'all' | 'cloud' | 'local'>('all')
const searchKeyword = ref('')
const mineQuery = ref('')

interface SkillCard {
  key: string
  name: string
  description: string
  category: string
  originLabel: string
  iconUrl: string
  dirName: string
  reviewed: boolean
  version?: string
  installable?: boolean
  versionId?: string
}

const localCards = computed<SkillCard[]>(() => {
  const q = mineQuery.value.trim().toLowerCase()
  return store.skills
    .filter((s) => {
      if (sourceFilter.value === 'cloud' && s.origin !== 'cloud' && s.origin !== 'official') return false
      if (sourceFilter.value === 'local' && s.origin === 'cloud') return false
      if (activeCategory.value && (s.category || '其他') !== activeCategory.value) return false
      if (!q) return true
      return s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)
    })
    .map((s) => ({
      key: s.dirName,
      name: s.name,
      description: s.description,
      category: s.category || '其他',
      originLabel: s.origin === 'cloud' ? '云端' : s.origin === 'official' ? '内置' : '本地',
      iconUrl: '',
      dirName: s.dirName,
      reviewed: !!s.reviewed || s.origin === 'cloud' || s.origin === 'official',
      version: s.version,
      installable: false
    }))
})

const catalogCards = computed<SkillCard[]>(() => {
  if (sourceFilter.value === 'local') return []
  const installedIds = new Set(store.skills.filter((s) => s.skillId).map((s) => s.skillId as string))
  const q = mineQuery.value.trim().toLowerCase()
  return (store.catalog?.items || [])
    .filter((item: any) => !installedIds.has(item.skill_id))
    .filter((item: any) => {
      if (activeCategory.value && (item.category || '其他') !== activeCategory.value) return false
      if (!q) return true
      return String(item.name || '').toLowerCase().includes(q)
        || String(item.description || '').toLowerCase().includes(q)
    })
    .map((item: any) => ({
      key: 'cloud-' + item.version_id,
      name: item.name,
      description: item.description || '',
      category: item.category || '其他',
      originLabel: store.catalog?.offline ? '云端（离线缓存）' : '云端',
      iconUrl: '',
      dirName: '',
      reviewed: true,
      version: item.version,
      installable: true,
      versionId: item.version_id
    }))
})

const filteredCards = computed(() => [...catalogCards.value, ...localCards.value])

const installedCategories = computed(() => {
  const set = new Set<string>()
  for (const s of store.skills) set.add(s.category || '其他')
  for (const item of store.catalog?.items || []) set.add(item.category || '其他')
  return [{ key: '', label: '全部' }, ...Array.from(set).map((label) => ({ key: label, label }))]
})

const allCategoryChips = computed(() => installedCategories.value)

const visibleCategories = computed(() => {
  if (showAllCategories.value || allCategoryChips.value.length <= 12) return allCategoryChips.value
  return allCategoryChips.value.slice(0, 11)
})

const hiddenCategoryCount = computed(() =>
  Math.max(0, allCategoryChips.value.length - visibleCategories.value.length)
)

const emptyTitle = computed(() => {
  if (filteredCards.value.length === 0 && (store.skills.length > 0 || (store.catalog?.items || []).length > 0)) {
    return '没有匹配的技能'
  }
  return '暂无技能'
})

const emptyHint = computed(() => {
  if (store.skills.length === 0 && !(store.catalog?.items || []).length) {
    return store.catalog?.offline
      ? '当前离线且本地还没有技能。联网后刷新目录，或先上传本地技能。'
      : '等待云控端提供技能下发前，可继续上传本地技能'
  }
  return '换个分类或关键词试试'
})

async function refreshCatalog() {
  if (catalogRefreshing.value) return
  catalogRefreshing.value = true
  try {
    await store.fetchCatalog()
  } finally {
    catalogRefreshing.value = false
  }
}

function selectCategory(key: string) {
  activeCategory.value = key
}

function onSearchEnter() {
  mineQuery.value = searchKeyword.value
}

async function doCreate() {
  if (!createForm.value.name.trim()) return
  await store.createSkill(
    createForm.value.name.trim(),
    createForm.value.description.trim(),
    createForm.value.content
  )
  showCreateForm.value = false
  createForm.value = { name: '', description: '', content: '' }
}

function startCreateInChat() {
  showAddMenu.value = false
  router.push({ path: '/chat', query: { new: '1', createSkill: '1' } })
}

function openManualForm() {
  showAddMenu.value = false
  showCreateForm.value = true
}

function openImportModal() {
  showAddMenu.value = false
  importError.value = ''
  showImport.value = true
}

async function runImport(sourcePath: string) {
  if (!sourcePath || importing.value) return
  importing.value = true
  importError.value = ''
  try {
    const res = await store.installFromPath(sourcePath)
    if (res.success) {
      showImport.value = false
    } else {
      importError.value = res.error || '导入失败'
    }
  } catch (e: any) {
    importError.value = e?.message || '导入失败'
  } finally {
    importing.value = false
    importDragging.value = false
  }
}

async function pickImportFile() {
  const result = await window.api.dialog.openFile({
    title: '选择技能文件',
    properties: ['openFile'],
    filters: [
      { name: '技能包', extensions: ['zip', 'md'] }
    ]
  }) as { canceled?: boolean; filePaths?: string[] }
  if (result?.canceled || !result?.filePaths?.[0]) return
  await runImport(result.filePaths[0])
}

async function pickImportFolder() {
  const result = await window.api.dialog.openFile({
    title: '选择技能文件夹',
    properties: ['openDirectory']
  }) as { canceled?: boolean; filePaths?: string[] }
  if (result?.canceled || !result?.filePaths?.[0]) return
  await runImport(result.filePaths[0])
}

function fileDropPath(file: File): string {
  try {
    const viaUtils = (window as any).electron?.webUtils?.getPathForFile?.(file)
    if (viaUtils) return String(viaUtils)
  } catch { /* ignore */ }
  return String((file as File & { path?: string }).path || '')
}

function onImportDrop(e: DragEvent) {
  importDragging.value = false
  const file = e.dataTransfer?.files?.[0]
  const p = file ? fileDropPath(file) : ''
  if (p) void runImport(p)
  else importError.value = '无法读取拖入的路径，请改用点击上传'
}

async function viewSkill(skill: PromptSkill) {
  viewingSkill.value = skill
  viewContent.value = await store.getContent(skill.dirName)
}

function manageCard(card: SkillCard) {
  const skill = resolveLocalSkill(card)
  if (skill) void viewSkill(skill)
}

function cardDirName(card: SkillCard): string {
  return resolveLocalSkill(card)?.dirName || card.dirName || ''
}

function resolveLocalSkill(card: SkillCard): PromptSkill | undefined {
  return store.skills.find((s) => s.dirName === card.dirName)
}

async function deleteLocalSkill(dirName: string, name: string) {
  if (!dirName) return
  if (!window.confirm(`确定删除技能「${name}」吗？\n已绑定该技能的专家会自动解绑。`)) return
  deletingDir.value = dirName
  try {
    await store.deleteSkill(dirName)
    if (viewingSkill.value?.dirName === dirName) {
      viewingSkill.value = null
      viewContent.value = ''
    }
  } catch (e: any) {
    window.alert('删除失败: ' + (e?.message || e))
  } finally {
    deletingDir.value = ''
  }
}

async function deleteCard(card: SkillCard) {
  const skill = resolveLocalSkill(card)
  if (!skill) return
  await deleteLocalSkill(skill.dirName, skill.name)
}

async function useLocalSkill(dirName: string) {
  const skill = store.skills.find((s) => s.dirName === dirName)
  if (skill && !skill.enabled) await store.toggleSkill(dirName, true)
  router.push({ path: '/chat', query: { new: '1', useSkill: dirName } })
}

async function useCard(card: SkillCard) {
  await useLocalSkill(card.dirName)
}

async function installCloudCard(card: SkillCard) {
  if (!card.versionId) return
  const res = await store.installCloud(card.versionId)
  if (!res?.success) window.alert(res?.error || '安装失败')
}

async function openSkillsDir() {
  const dir = await store.getSkillsDir()
  window.api.shell.openPath(dir)
}

function onDocClick(e: MouseEvent) {
  if (!addMenuRoot.value?.contains(e.target as Node)) showAddMenu.value = false
}

onMounted(() => {
  store.fetchSkills()
  store.fetchCatalog()
  document.addEventListener('click', onDocClick)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
})
</script>
