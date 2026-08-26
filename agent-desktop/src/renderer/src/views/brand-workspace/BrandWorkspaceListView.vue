<template>
  <div class="h-full flex flex-col">
    <header class="page-header flex items-center justify-between gap-3">
      <div class="min-w-0">
        <h1 class="text-base font-semibold text-text-primary">品牌工作区</h1>
        <p class="text-xs text-text-tertiary mt-0.5">文档规范写提示词 · 图库出参考图 · 产出跨会话保留</p>
      </div>
      <button class="btn-primary text-sm" @click="openCreate">新建品牌</button>
    </header>

    <div class="page-body flex-1 min-h-0 flex gap-4 overflow-hidden">
      <!-- 列表 -->
      <aside class="w-64 flex-shrink-0 flex flex-col border border-surface-3 rounded-2xl bg-surface-0 overflow-hidden">
        <div class="px-3 py-2 text-[11px] text-text-tertiary border-b border-surface-2">我的品牌</div>
        <div class="flex-1 overflow-y-auto p-2 space-y-1">
          <button
            v-for="item in store.items"
            :key="item.id"
            type="button"
            class="w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors"
            :class="selectedId === item.id
              ? 'bg-primary-50 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200 font-medium'
              : 'text-text-secondary hover:bg-surface-1'"
            @click="select(item.id)"
          >
            <div class="truncate">{{ item.name }}</div>
            <div class="text-[10px] text-text-tertiary mt-0.5 truncate">{{ item.description || '暂无说明' }}</div>
          </button>
          <div v-if="!store.loading && !store.items.length" class="px-3 py-8 text-center text-xs text-text-tertiary">
            还没有品牌工作区
          </div>
        </div>
      </aside>

      <!-- 详情 -->
      <section class="flex-1 min-w-0 overflow-y-auto rounded-2xl border border-surface-3 bg-surface-0 p-5">
        <div v-if="!selected" class="h-full flex items-center justify-center text-sm text-text-tertiary">
          选择或新建一个品牌工作区
        </div>
        <div v-else class="space-y-6 max-w-2xl">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1 space-y-2">
              <input v-model="editName" class="input-field text-base font-semibold" placeholder="品牌名称" @blur="saveMeta" />
              <textarea
                v-model="editDesc"
                class="input-field text-sm min-h-[72px] resize-y"
                placeholder="品牌简介（可选）"
                @blur="saveMeta"
              />
            </div>
            <button class="btn-danger text-xs flex-shrink-0" @click="confirmDelete">删除</button>
          </div>

          <div class="grid gap-3">
            <div class="rounded-xl border border-surface-2 p-4 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <div>
                  <div class="text-sm font-medium text-text-primary">品牌文档库</div>
                  <div class="text-[11px] text-text-tertiary">绑定本地文件夹（md/pdf 等），用于生成合规提示词</div>
                </div>
                <button class="btn-secondary text-xs" :disabled="busy" @click="bindDocsFolder">绑定文件夹</button>
              </div>
              <ul v-if="kbWatchPaths.length" class="text-xs text-text-secondary space-y-1">
                <li v-for="p in kbWatchPaths" :key="p" class="flex items-center gap-2">
                  <span class="truncate flex-1 font-mono text-[11px]">{{ p }}</span>
                  <button class="text-text-tertiary hover:text-danger-600" @click="unbindDocsFolder(p)">解除</button>
                </li>
              </ul>
              <p v-else class="text-[11px] text-text-tertiary">尚未绑定文档目录</p>
              <div class="flex gap-2 pt-1">
                <button class="btn-secondary text-xs" :disabled="busy" @click="syncAndVectorize">同步并向量化</button>
                <button class="btn-secondary text-xs" @click="addDocs">添加文档</button>
              </div>
              <p v-if="syncMsg" class="text-[11px] text-text-tertiary">{{ syncMsg }}</p>
            </div>

            <div class="rounded-xl border border-surface-2 p-4 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <div>
                  <div class="text-sm font-medium text-text-primary">品牌图库</div>
                  <div class="text-[11px] text-text-tertiary">Logo / 主视觉等参考图；不进知识库索引</div>
                </div>
                <button class="btn-secondary text-xs" :disabled="busy" @click="importGalleryFolder">导入图片文件夹</button>
              </div>
              <p class="text-[11px] text-text-secondary">
                已入库 <span class="font-medium text-text-primary">{{ galleryCount }}</span> 张
                <button class="ml-2 text-primary-700 hover:underline" @click="openGallery">在图库中查看</button>
              </p>
            </div>

            <div class="rounded-xl border border-surface-2 p-4 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <div>
                  <div class="text-sm font-medium text-text-primary">产出目录</div>
                  <div class="text-[11px] text-text-tertiary">跨会话保存成品；对话生图可指定写到此处</div>
                </div>
                <div class="flex gap-2">
                  <button class="btn-secondary text-xs" @click="pickOutputDir">更换</button>
                  <button class="btn-secondary text-xs" :disabled="!selected.output_dir" @click="openOutputDir">打开</button>
                </div>
              </div>
              <p class="text-[11px] font-mono text-text-secondary break-all">{{ selected.output_dir || '未设置' }}</p>
            </div>

            <div class="rounded-xl border border-surface-2 p-4 space-y-2">
              <div class="text-sm font-medium text-text-primary">默认专家</div>
              <select v-model="editBotId" class="input-field text-sm" @change="saveMeta">
                <option value="">自动选择（优先已开生图）</option>
                <option v-for="bot in bots" :key="bot.id" :value="bot.id">
                  {{ bot.name }}{{ bot.enable_image_gen ? ' · 生图' : '' }}
                </option>
              </select>
            </div>
          </div>

          <div class="flex items-center gap-3 pt-2 flex-wrap">
            <button class="btn-primary text-sm" :disabled="starting" @click="startChat">
              {{ starting ? '打开中…' : '在此品牌下开始对话' }}
            </button>
            <button
              class="btn-secondary text-sm"
              :disabled="starting || !galleryCount"
              title="先选品牌图库参考图，再进入对话"
              @click="pickRefsThenChat"
            >带参考图开聊</button>
            <p class="text-[11px] text-text-tertiary">将注入品牌文档库；会话工作区仍作当次沙箱</p>
          </div>
        </div>
      </section>
    </div>

    <!-- 新建弹层 -->
    <div v-if="showCreate" class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" @click.self="showCreate = false">
      <div class="w-full max-w-md rounded-2xl bg-surface-0 shadow-panel p-5 space-y-4">
        <h2 class="text-base font-semibold text-text-primary">新建品牌工作区</h2>
        <input v-model="createName" class="input-field" placeholder="品牌名称，如「好伙伴」" @keydown.enter="doCreate" />
        <textarea v-model="createDesc" class="input-field text-sm min-h-[64px]" placeholder="简介（可选）" />
        <div class="flex justify-end gap-2">
          <button class="btn-secondary text-sm" @click="showCreate = false">取消</button>
          <button class="btn-primary text-sm" :disabled="!createName.trim() || creating" @click="doCreate">
            {{ creating ? '创建中…' : '创建' }}
          </button>
        </div>
        <p v-if="createError" class="text-xs text-red-600 leading-relaxed">{{ createError }}</p>
      </div>
    </div>
  </div>

  <GalleryPicker
    v-model:visible="showRefPicker"
    :multiple="true"
    :initial-category-id="selected?.gallery_category_id || null"
    @select="onRefsPicked"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBrandWorkspaceStore } from '@/stores/brand-workspaces'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useGalleryStore } from '@/stores/gallery'
import { useBotStore } from '@/stores/bots'
import { useChatStore } from '@/stores/chat'
import { useVectorizeStore } from '@/stores/vectorize'
import { useSiteConfigStore } from '@/stores/site-config'
import GalleryPicker from '@/components/GalleryPicker.vue'
import { useHandoffStore } from '@/stores/handoff'

const router = useRouter()
const store = useBrandWorkspaceStore()
const knowledge = useKnowledgeStore()
const gallery = useGalleryStore()
const botsStore = useBotStore()
const chatStore = useChatStore()
const vectorizeStore = useVectorizeStore()
const siteConfig = useSiteConfigStore()
const handoff = useHandoffStore()

const selectedId = ref('')
const selected = computed(() => store.items.find((x) => x.id === selectedId.value) || null)
const bots = computed(() => botsStore.bots)

const editName = ref('')
const editDesc = ref('')
const editBotId = ref('')
const kbWatchPaths = ref<string[]>([])
const galleryCount = ref(0)
const busy = ref(false)
const syncMsg = ref('')
const starting = ref(false)

const showCreate = ref(false)
const createName = ref('')
const createDesc = ref('')
const creating = ref(false)
const createError = ref('')
const showRefPicker = ref(false)

async function refreshKbMeta() {
  if (!selected.value?.kb_category_id) {
    kbWatchPaths.value = []
    return
  }
  await knowledge.fetchCategories()
  const cat = knowledge.categories.find((c) => c.id === selected.value!.kb_category_id)
  kbWatchPaths.value = cat?.watch_paths || []
}

async function refreshGalleryCount() {
  if (!selected.value?.gallery_category_id) {
    galleryCount.value = 0
    return
  }
  galleryCount.value = await gallery.getCategoryItemCount(selected.value.gallery_category_id)
}

function select(id: string) {
  selectedId.value = id
  store.setActive(id)
}

watch(
  selected,
  async (bw) => {
    if (!bw) return
    editName.value = bw.name
    editDesc.value = bw.description
    editBotId.value = bw.default_bot_id
    syncMsg.value = ''
    await Promise.all([refreshKbMeta(), refreshGalleryCount()])
  },
  { immediate: true }
)

function notifyError(msg: string) {
  createError.value = msg
  console.error('[brand-workspace]', msg)
  try {
    window.api?.dialog?.alert?.(msg)
  } catch {
    /* ignore */
  }
}

function openCreate() {
  createName.value = ''
  createDesc.value = ''
  createError.value = ''
  showCreate.value = true
}

async function doCreate() {
  if (!createName.value.trim() || creating.value) return
  createError.value = ''
  if (!window.api?.brandWorkspace?.invoke) {
    notifyError('品牌工作区接口未加载。请完全退出并重启应用后再试（preload/主进程需重载）。')
    return
  }
  creating.value = true
  try {
    const row = await store.create({
      name: createName.value.trim(),
      description: createDesc.value.trim()
    })
    showCreate.value = false
    createError.value = ''
    select(row.id)
  } catch (e: any) {
    const msg = String(e?.message || e || '未知错误')
    const hint = /no handler|not found|undefined/i.test(msg)
      ? `创建失败：${msg}。请完全退出并重启应用后再试。`
      : `创建失败：${msg}`
    notifyError(hint)
  } finally {
    creating.value = false
  }
}

async function saveMeta() {
  if (!selected.value) return
  const name = editName.value.trim()
  if (!name) {
    editName.value = selected.value.name
    return
  }
  if (
    name === selected.value.name &&
    editDesc.value === selected.value.description &&
    editBotId.value === selected.value.default_bot_id
  ) {
    return
  }
  try {
    await store.update(selected.value.id, {
      name,
      description: editDesc.value,
      default_bot_id: editBotId.value
    })
  } catch (e: any) {
    window.api.dialog.alert('保存失败: ' + (e?.message || e))
  }
}

async function confirmDelete() {
  if (!selected.value) return
  if (!window.api.dialog.confirm(`确定删除品牌工作区「${selected.value.name}」？文档库与图库分类会保留，可稍后在对应功能中清理。`)) {
    return
  }
  const id = selected.value.id
  await store.remove(id)
  selectedId.value = store.items[0]?.id || ''
  if (selectedId.value) store.setActive(selectedId.value)
}

async function bindDocsFolder() {
  if (!selected.value?.kb_category_id) return
  busy.value = true
  try {
    const result = (await window.api.dialog.openFile({
      title: '选择品牌文档文件夹',
      properties: ['openDirectory']
    })) as { canceled: boolean; filePaths: string[] }
    if (result.canceled || !result.filePaths.length) return
    await knowledge.bindFolder(selected.value.kb_category_id, result.filePaths[0])
    await knowledge.syncCategory(selected.value.kb_category_id)
    await refreshKbMeta()
    syncMsg.value = '已绑定并同步文件列表，可点击「同步并向量化」'
  } catch (e: any) {
    window.api.dialog.alert('绑定失败: ' + (e?.message || e))
  } finally {
    busy.value = false
  }
}

async function unbindDocsFolder(path: string) {
  if (!selected.value?.kb_category_id) return
  await knowledge.unbindFolder(selected.value.kb_category_id, path)
  await refreshKbMeta()
}

async function addDocs() {
  if (!selected.value?.kb_category_id) return
  try {
    const result = (await window.api.dialog.openFile({
      title: '选择品牌文档',
      filters: [
        { name: 'Documents', extensions: ['txt', 'md', 'pdf', 'doc', 'docx', 'json', 'csv'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    })) as { canceled: boolean; filePaths: string[] }
    if (result.canceled || !result.filePaths.length) return
    for (const filePath of result.filePaths) {
      const fileName = filePath.split(/[\\/]/).pop() || 'unknown'
      const ext = fileName.split('.').pop() || ''
      await knowledge.createKnowledgeBase({
        category_id: selected.value.kb_category_id,
        name: fileName,
        file_path: filePath,
        file_type: ext
      })
    }
    syncMsg.value = `已添加 ${result.filePaths.length} 个文档，请向量化后用于对话`
  } catch (e: any) {
    window.api.dialog.alert('添加失败: ' + (e?.message || e))
  }
}

async function syncAndVectorize() {
  if (!selected.value?.kb_category_id) return
  busy.value = true
  syncMsg.value = '同步中…'
  try {
    const sync = await knowledge.syncCategory(selected.value.kb_category_id)
    syncMsg.value = `同步完成：+${sync.added} / -${sync.removed} / ~${sync.modified}，开始向量化…`
    await vectorizeStore.vectorizeCategory(selected.value.kb_category_id)
    syncMsg.value = '向量化完成，可在对话中检索品牌规范'
  } catch (e: any) {
    syncMsg.value = '失败: ' + (e?.message || e)
  } finally {
    busy.value = false
  }
}

async function importGalleryFolder() {
  if (!selected.value?.gallery_category_id) return
  busy.value = true
  try {
    const result = (await window.api.dialog.openFile({
      title: '选择品牌图片文件夹',
      properties: ['openDirectory']
    })) as { canceled: boolean; filePaths: string[] }
    if (result.canceled || !result.filePaths.length) return
    const res = (await window.api.gallery.invoke(
      'addFolder',
      selected.value.gallery_category_id,
      result.filePaths[0],
      true
    )) as { added: number; skipped: number }
    await refreshGalleryCount()
    syncMsg.value = `图库导入：新增 ${res.added}，跳过 ${res.skipped}`
  } catch (e: any) {
    window.api.dialog.alert('导入失败: ' + (e?.message || e))
  } finally {
    busy.value = false
  }
}

function openGallery() {
  if (!selected.value?.gallery_category_id) return
  gallery.setCategory(selected.value.gallery_category_id)
  router.push('/gallery')
}

async function pickOutputDir() {
  if (!selected.value) return
  const result = (await window.api.dialog.openFile({
    title: '选择品牌产出目录',
    properties: ['openDirectory', 'createDirectory']
  })) as { canceled: boolean; filePaths: string[] }
  if (result.canceled || !result.filePaths.length) return
  await store.update(selected.value.id, { output_dir: result.filePaths[0] })
}

async function openOutputDir() {
  if (!selected.value?.output_dir) return
  await window.api.shell.openPath(selected.value.output_dir)
}

function pickBotId(): string {
  if (editBotId.value) return editBotId.value
  const withImage = bots.value.find((b) => b.enable_image_gen)
  return withImage?.id || bots.value[0]?.id || ''
}

async function startChat(opts?: { attachmentPaths?: string[] }) {
  if (!selected.value || starting.value) return
  const botId = pickBotId()
  starting.value = true
  try {
    store.setActive(selected.value.id)
    if (editBotId.value !== selected.value.default_bot_id) {
      await store.update(selected.value.id, { default_bot_id: editBotId.value })
    }
    const defaultModel = siteConfig.chatDefaultModel
    const conv = await chatStore.createConversation(
      botId,
      `${selected.value.name} · 创作`,
      defaultModel?.provider_id && defaultModel?.model_id
        ? { provider_id: defaultModel.provider_id, model_id: defaultModel.model_id }
        : undefined
    )
    await window.api.chat.invoke('updateConversationBrandWorkspace', conv.id, selected.value.id)
    conv.brand_workspace_id = selected.value.id
    await chatStore.selectConversation(conv.id)
    if (opts?.attachmentPaths?.length) {
      handoff.set('chatBrandAttachments', { paths: opts.attachmentPaths })
    }
    router.push('/chat')
  } catch (e: any) {
    window.api.dialog.alert('打开对话失败: ' + (e?.message || e))
  } finally {
    starting.value = false
  }
}

function pickRefsThenChat() {
  if (!selected.value?.gallery_category_id) return
  if (!galleryCount.value) {
    window.api.dialog.alert('请先导入品牌图片文件夹')
    return
  }
  showRefPicker.value = true
}

async function onRefsPicked(paths: string[]) {
  if (!paths.length) return
  await startChat({ attachmentPaths: paths })
}

onMounted(async () => {
  await Promise.all([store.fetchAll(), botsStore.fetchBots()])
  selectedId.value = store.activeId || store.items[0]?.id || ''
  if (selectedId.value) store.setActive(selectedId.value)
})
</script>
