<template>
  <div class="h-full flex flex-col bg-surface-1">
    <!-- 顶部 -->
    <div class="h-12 flex-shrink-0 flex items-center gap-3 px-4 border-b border-surface-3 bg-surface-0">
      <button class="ewei-chip" @click="goBack">← 返回</button>
      <img v-if="headerThumb" :src="headerThumb" class="w-7 h-7 rounded-md object-cover bg-surface-2 flex-shrink-0" alt="" />
      <div class="min-w-0">
        <div class="text-sm font-semibold text-text-primary truncate leading-tight">{{ goodsTitle || '商品图替换' }}</div>
        <div class="text-[11px] text-text-tertiary leading-tight">
          商品 #{{ goodsId }}
          <span v-if="detail?.goods?.has_option" class="ml-1 text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-1">多规格商品</span>
        </div>
      </div>
    </div>

    <div v-if="loading" class="flex-1 flex items-center justify-center text-text-tertiary text-sm">加载商品详情…</div>
    <div v-else-if="loadError" class="flex-1 flex items-center justify-center text-error text-sm">{{ loadError }}</div>

    <div v-else class="flex-1 flex min-h-0">
      <!-- 左侧：目标 + 操作（常驻检查栏） -->
      <aside class="w-[262px] flex-shrink-0 bg-surface-0 border-r border-surface-3 flex flex-col min-h-0">
        <div class="flex-1 overflow-y-auto p-4">
          <p class="text-[11px] font-semibold text-text-tertiary mb-2">替换目标</p>

          <div v-for="grp in slotGroups" :key="grp.name || 'main'" class="mb-2.5">
            <p v-if="grp.name" class="text-[11px] font-semibold text-text-secondary mb-1.5">{{ grp.name }}</p>
            <div class="flex gap-1.5">
              <button
                v-for="key in grp.items"
                :key="key"
                type="button"
                class="text-center text-xs py-1.5 px-2 border rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                :class="[
                  grp.items.length === 1 ? 'w-full' : 'flex-1 min-w-0',
                  target.slot === key ? 'border-primary-500 bg-primary-50 text-primary-700 font-medium' : 'border-surface-3 text-text-secondary hover:bg-surface-2',
                ]"
                :disabled="def(key).needsOption && !detail?.options?.length"
                @click="selectSlot(key)"
              >
                {{ def(key).short }}
              </button>
            </div>
          </div>

          <select v-if="target.slot === 'optionThumb'" v-model.number="target.optionId" class="ewei-input w-full">
            <option v-for="o in detail!.options" :key="o.id" :value="Number(o.id)">{{ o.title }}</option>
          </select>

          <p class="text-[11px] text-text-tertiary mt-2 leading-relaxed">{{ slotHint }}</p>

          <!-- 当前图 -->
          <div class="mt-5">
            <p class="text-[11px] font-semibold text-text-tertiary mb-2">当前{{ currentSlotLabel }}</p>
            <div class="flex flex-wrap gap-1.5">
              <template v-if="currentImages.length">
                <div v-for="(src, i) in currentImages.slice(0, 8)" :key="i" class="w-[46px] h-[46px] rounded-lg border border-surface-3 overflow-hidden bg-surface-2">
                  <img v-if="src" :src="src" class="w-full h-full object-cover" alt="" />
                  <div v-else class="w-full h-full flex items-center justify-center text-[9px] text-text-tertiary">无预览</div>
                </div>
              </template>
              <div v-else class="text-[11px] text-text-tertiary py-2">
                {{ isDetailSlot ? `详情图含 ${detailImgCount} 张图` : '暂无' }}
              </div>
            </div>
          </div>
        </div>

        <!-- 已选 + 应用（贴底常驻） -->
        <div class="flex-shrink-0 border-t border-surface-3 p-4 bg-surface-0">
          <p class="text-[11px] font-semibold text-text-tertiary mb-2">已选 {{ picked.length }} 张</p>
          <div v-if="picked.length" class="flex gap-1.5 overflow-x-auto pb-1.5 mb-2">
            <div v-for="p in picked" :key="p.localPath" class="relative w-11 h-11 rounded-lg overflow-hidden border border-surface-3 flex-shrink-0">
              <img :src="p.previewUrl" class="w-full h-full object-cover" alt="" />
              <button class="absolute top-0 right-0 w-[15px] h-[15px] bg-black/55 text-white text-[10px] leading-[15px] text-center" @click="togglePick(p.localPath, p.previewUrl)">×</button>
            </div>
          </div>
          <p v-else class="text-[11px] text-text-tertiary mb-2">{{ applyHint }}</p>

          <p v-if="progressText" class="text-[11px] text-primary-600 mb-2">{{ progressText }}</p>
          <p v-else-if="applyError" class="text-[11px] text-error mb-2">{{ applyError }}</p>
          <p v-else-if="applyDone" class="text-[11px] text-emerald-600 mb-2">已应用到商品，C 端稍后生效</p>

          <button class="btn-primary w-full !py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed" :disabled="!canApply" @click="onApply">
            {{ applying ? '应用中…' : applyButtonLabel }}
          </button>
        </div>
      </aside>

      <!-- 右侧：图片来源 -->
      <main class="flex-1 min-w-0 flex flex-col min-h-0">
        <div class="flex items-center gap-1 px-4 py-2.5 flex-shrink-0 bg-surface-0">
          <button v-for="t in sourceTabs" :key="t.key" class="px-3 py-1.5 rounded-lg text-xs transition-colors" :class="sourceTab === t.key ? 'bg-primary-50 text-primary-700 font-medium' : 'text-text-secondary hover:bg-surface-2'" @click="sourceTab = t.key">{{ t.label }}</button>
          <span class="ml-auto text-[11px] text-text-tertiary">点选图片（{{ isMultiSlot ? '可多选' : '单选' }}）即加入左侧「已选」</span>
        </div>

        <div class="flex-1 min-h-0 flex flex-col">
          <!-- AI 生成：复用电商「生成主图 / 详情页」完整面板（控制栏 + 两步法 + 可选结果） -->
          <div v-show="sourceTab === 'generate'" class="flex-1 min-h-0 overflow-hidden">
            <EcomGeneratorPanel
              :key="aiScopeKey"
              class="h-full"
              :image-type="isDetailSlot ? 'detail' : 'main'"
              :scope-key="aiScopeKey"
              :pickable="true"
              :picked-paths="pickedLocalPaths"
              @toggle-pick="onPanelPick"
            />
          </div>

          <!-- 本地图库（缩略图） -->
          <div v-show="sourceTab === 'gallery'" class="flex-1 min-h-0 overflow-y-auto px-4 pb-4 border-t border-surface-3 pt-3">
            <div class="flex items-center gap-2 mb-3">
              <select v-model="galleryCategory" class="ewei-input !w-44" @change="loadGallery(1)">
                <option value="">全部分类</option>
                <option v-for="c in galleryCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
              <input v-model="gallerySearch" class="ewei-input flex-1" placeholder="搜索图片名" @keyup.enter="loadGallery(1)" />
              <button class="ewei-chip" @click="loadGallery(1)">查询</button>
            </div>
            <div v-if="galleryLoading" class="text-center text-text-tertiary text-[11px] py-10">加载中…</div>
            <div v-else-if="!galleryItems.length" class="text-center text-text-tertiary text-[11px] py-10">图库暂无图片</div>
            <div v-else class="grid grid-cols-4 xl:grid-cols-5 gap-3">
              <div v-for="it in galleryItems" :key="it.id" class="relative aspect-square rounded-lg overflow-hidden border bg-surface-2 cursor-pointer" :class="isPicked(it.file_path) ? 'border-primary-500 ring-2 ring-primary-400' : 'border-surface-3'" @click="togglePick(it.file_path, thumbUrl(it.file_path))">
                <img :src="thumbUrl(it.file_path)" class="w-full h-full object-cover" loading="lazy" decoding="async" alt="" />
                <span v-if="isPicked(it.file_path)" class="absolute top-1 left-1 text-[10px] bg-primary-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow">{{ pickIndex(it.file_path) + 1 }}</span>
              </div>
            </div>
            <!-- 图库分页：每页 36 张，否则只能看到第一页、第 37 张起永远选不到 -->
            <div v-if="galleryTotal > galleryPageSize" class="flex items-center justify-center gap-2 mt-4 text-[11px] text-text-tertiary">
              <button class="ewei-chip" :disabled="galleryPage <= 1 || galleryLoading" @click="loadGallery(galleryPage - 1)">上一页</button>
              <span>{{ galleryPage }} / {{ galleryTotalPages }}（共 {{ galleryTotal }}）</span>
              <button class="ewei-chip" :disabled="galleryPage >= galleryTotalPages || galleryLoading" @click="loadGallery(galleryPage + 1)">下一页</button>
            </div>
          </div>

          <!-- 本地文件 -->
          <div v-show="sourceTab === 'file'" class="flex-1 min-h-0 overflow-y-auto px-4 pb-4 border-t border-surface-3 pt-3">
            <button class="ewei-chip mb-3" @click="pickFiles">选择本地图片</button>
            <div v-if="!fileItems.length" class="text-center text-text-tertiary text-[11px] py-10">从电脑选择图片文件</div>
            <div v-else class="grid grid-cols-4 xl:grid-cols-5 gap-3">
              <div v-for="p in fileItems" :key="p" class="relative aspect-square rounded-lg overflow-hidden border bg-surface-2 cursor-pointer" :class="isPicked(p) ? 'border-primary-500 ring-2 ring-primary-400' : 'border-surface-3'" @click="togglePick(p, thumbUrl(p))">
                <img :src="thumbUrl(p)" class="w-full h-full object-cover" loading="lazy" decoding="async" alt="" />
                <span v-if="isPicked(p)" class="absolute top-1 left-1 text-[10px] bg-primary-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow">{{ pickIndex(p) + 1 }}</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EcomGeneratorPanel from '@/views/ecom/EcomGeneratorPanel.vue'
import { useEweiStore, type MallCapabilities } from '@/stores/ewei'

const route = useRoute()
const router = useRouter()
const store = useEweiStore()
const ewei = () => (window as any).api.ewei
// 平台能力位：点大(detailFormat='blocks')隐藏详情图/SKU 图位，避免「点了才报错」
const caps = ref<MallCapabilities | null>(null)

const connectorId = route.params.connectorId as string
const goodsId = Number(route.params.goodsId)

// ---- 详情 ----
const detail = ref<{ goods: any; options: any[]; specs: any[] } | null>(null)
const loading = ref(false)
const loadError = ref('')
const goodsTitle = computed(() => detail.value?.goods?.title || store.currentGoods?.title || '')
const detailImgCount = computed(() => (String(detail.value?.goods?.content || '').match(/<img/gi) || []).length)

// COS 前缀推导：列表的绝对 thumb URL + 详情相对 thumb → 反推 COS 根，用于预览其它相对路径。
const cosPrefix = computed(() => {
  const abs = store.currentGoods?.thumb || ''
  const rel = detail.value?.goods?.thumb || ''
  if (!abs || !rel) return ''
  const noQuery = abs.split('?')[0]
  return noQuery.endsWith(rel) ? noQuery.slice(0, noQuery.length - rel.length) : ''
})
function previewOf(rel: string): string {
  if (!rel) return ''
  if (/^https?:\/\//i.test(rel)) return rel
  return cosPrefix.value ? cosPrefix.value + rel : ''
}
const headerThumb = computed(() => store.currentGoods?.thumb || previewOf(detail.value?.goods?.thumb || ''))
/** 本地图片缩略图 URL（local-file 协议 + thumb=1，主进程生成 360px 缓存，避免原图卡顿）。 */
function thumbUrl(p: string): string {
  if (!p) return ''
  return 'local-file://img?p=' + encodeURIComponent(p.replace(/\\/g, '/')) + '&thumb=1'
}

async function loadDetail(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    detail.value = await ewei().invoke('goodsDetail', connectorId, goodsId)
    if (detail.value?.options?.length && !target.optionId) target.optionId = Number(detail.value.options[0].id)
  } catch (e: any) {
    loadError.value = e?.message || '获取商品详情失败'
  } finally {
    loading.value = false
  }
}

// ---- 图位 ----
const slotOptions = [
  { key: 'mainThumb', short: '主图', multi: false, detail: false, needsOption: false, hint: '替换商品主图（首图）。生成或选好图后，下方点「应用到主图」。' },
  { key: 'galleryReplace', short: '替换', multi: true, detail: false, needsOption: false, hint: '用所选图整组替换商品轮播图。' },
  { key: 'galleryAppend', short: '追加', multi: true, detail: false, needsOption: false, hint: '把所选图追加到现有轮播图末尾。' },
  { key: 'detailReplace', short: '替换', multi: true, detail: true, needsOption: false, hint: '用所选图【整段替换】商品详情内容（清空旧详情）。' },
  { key: 'detailAppend', short: '追加', multi: true, detail: true, needsOption: false, hint: '把所选图追加到详情末尾。' },
  { key: 'optionThumb', short: 'SKU 图', multi: false, detail: false, needsOption: true, hint: '替换某个规格(SKU)的图。' },
] as const
type SlotKey = (typeof slotOptions)[number]['key']
const slotGroups = computed<{ name: string; items: SlotKey[] }[]>(() => {
  const groups: { name: string; items: SlotKey[] }[] = [
    { name: '', items: ['mainThumb'] },
    { name: '轮播图', items: ['galleryReplace', 'galleryAppend'] },
    { name: '详情图', items: ['detailReplace', 'detailAppend'] },
    { name: 'SKU 图', items: ['optionThumb'] },
  ]
  // 按各平台能力位显隐图位组，避免「点了才报错」
  let result = groups
  const c = caps.value
  if (c) {
    if (!c.supportsGallery) result = result.filter((g) => g.name !== '轮播图')
    if (!c.supportsDetailImage) result = result.filter((g) => g.name !== '详情图')
    if (!c.supportsOptionThumb) result = result.filter((g) => g.name !== 'SKU 图')
  }
  return result
})
function def(key: SlotKey) {
  return slotOptions.find((s) => s.key === key)!
}

const target = reactive<{ slot: SlotKey; optionId: number }>({ slot: 'mainThumb', optionId: 0 })
const currentSlotDef = computed(() => def(target.slot))
const slotHint = computed(() => currentSlotDef.value.hint)
const isMultiSlot = computed(() => currentSlotDef.value.multi)
const isDetailSlot = computed(() => currentSlotDef.value.detail)
const aiScopeKey = computed(() => `ewei:${goodsId}:${isDetailSlot.value ? 'detail' : 'main'}`)
const currentSlotLabel = computed(() => {
  const map: Record<SlotKey, string> = {
    mainThumb: '主图',
    galleryReplace: '轮播图',
    galleryAppend: '轮播图',
    detailReplace: '详情图',
    detailAppend: '详情图',
    optionThumb: 'SKU 图',
  }
  return map[target.slot]
})
function selectSlot(k: SlotKey): void {
  if (target.slot === k) return
  target.slot = k
  picked.value = [] // 切图位清空已选（不同图位语义不同）
}
const currentImages = computed<string[]>(() => {
  const g = detail.value?.goods
  if (!g) return []
  if (target.slot === 'mainThumb') {
    const main = store.currentGoods?.thumb || previewOf(g.thumb)
    return main ? [main] : ['']
  }
  if (target.slot === 'galleryReplace' || target.slot === 'galleryAppend') {
    const thumbs: string[] = Array.isArray(g.thumbs) ? g.thumbs : []
    return thumbs.map((t) => previewOf(t))
  }
  if (target.slot === 'optionThumb') {
    const o = detail.value?.options?.find((x: any) => Number(x.id) === target.optionId)
    return o?.thumb ? [previewOf(o.thumb)] : ['']
  }
  if (target.slot === 'detailReplace' || target.slot === 'detailAppend') {
    // 详情图位逐图预览：从详情 HTML(content) 抽出 <img src>。改图后 loadDetail 刷新即更新。
    const html = String(g.content || '')
    const urls: string[] = []
    const re = /<img[^>]+src=["']([^"']+)["']/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(html))) {
      const u = previewOf(m[1])
      if (u) urls.push(u)
    }
    return urls
  }
  return []
})

// ---- 已选图池 ----
const picked = ref<{ localPath: string; previewUrl: string }[]>([])
const pickedLocalPaths = computed(() => picked.value.map((p) => p.localPath))
function isPicked(p: string): boolean {
  return !!p && picked.value.some((x) => x.localPath === p)
}
function pickIndex(p: string): number {
  return picked.value.findIndex((x) => x.localPath === p)
}
function togglePick(localPath: string, previewUrl: string): void {
  if (!localPath) return
  const i = pickIndex(localPath)
  if (i >= 0) {
    picked.value.splice(i, 1)
    return
  }
  if (!isMultiSlot.value) picked.value = [] // 单图位只留一张
  picked.value.push({ localPath, previewUrl })
}
function onPanelPick(payload: { path: string; url: string }): void {
  togglePick(payload.path, payload.url)
}

// ---- 来源 ----
const sourceTabs = [
  { key: 'generate', label: 'AI 生成' },
  { key: 'gallery', label: '本地图库' },
  { key: 'file', label: '本地文件' },
] as const
const sourceTab = ref<'generate' | 'gallery' | 'file'>('generate')

// ---- 来源：图库 ----
const galleryCategories = ref<any[]>([])
const galleryItems = ref<any[]>([])
const galleryCategory = ref('')
const gallerySearch = ref('')
const galleryLoading = ref(false)
const galleryPage = ref(1)
const galleryTotal = ref(0)
const galleryPageSize = 36
const galleryTotalPages = computed(() => Math.max(1, Math.ceil(galleryTotal.value / galleryPageSize)))
async function loadGalleryCategories(): Promise<void> {
  try {
    galleryCategories.value = (await (window as any).api.gallery.invoke('listCategories')) || []
  } catch {
    galleryCategories.value = []
  }
}
async function loadGallery(page = 1): Promise<void> {
  galleryLoading.value = true
  try {
    const r = await (window as any).api.gallery.invoke('listItemsPaged', galleryCategory.value || null, gallerySearch.value.trim(), page, galleryPageSize)
    galleryItems.value = r?.items || []
    galleryTotal.value = r?.total || 0
    galleryPage.value = page
    const paths = galleryItems.value.map((it: any) => it.file_path).filter(Boolean)
    if (paths.length) (window as any).api.imageGen.invoke('preloadThumbnails', paths).catch(() => {})
  } catch {
    galleryItems.value = []
    galleryTotal.value = 0
  } finally {
    galleryLoading.value = false
  }
}

// ---- 来源：本地文件 ----
const fileItems = ref<string[]>([])
async function pickFiles(): Promise<void> {
  const res = await (window as any).api.dialog.openFile({
    title: '选择图片',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
  })
  if (res && !res.canceled && Array.isArray(res.filePaths)) {
    fileItems.value = [...new Set([...fileItems.value, ...res.filePaths])]
  }
}

// ---- 应用 ----
const applying = ref(false)
const applyError = ref('')
const applyDone = ref(false)
const progressText = ref('')
let unsub: (() => void) | null = null

const canApply = computed(() => {
  if (applying.value || !picked.value.length) return false
  if (target.slot === 'optionThumb' && !target.optionId) return false
  return true
})
const applyButtonLabel = computed(() => `应用到${currentSlotLabel.value}`)
const applyHint = computed(() => (isMultiSlot.value ? '从右侧选若干图后应用' : '从右侧选一张图后应用'))

async function onApply(): Promise<void> {
  if (!canApply.value) return
  applying.value = true
  applyError.value = ''
  applyDone.value = false
  progressText.value = ''
  try {
    const res = (await ewei().invoke('replaceGoodsImage', {
      connectorId,
      goodsId,
      slot: target.slot,
      optionId: target.slot === 'optionThumb' ? target.optionId : undefined,
      images: picked.value.map((p) => p.localPath),
    })) as { ok: boolean; uploaded?: Array<{ url: string }> }
    applyDone.value = true
    picked.value = []
    // 主图替换成功：用新图即时刷新展示用缩略图。header/主图位优先取 currentGoods.thumb，不更新它
    // 会一直显示列表暂存的旧图。previewOf 同时处理新图的绝对URL(全端云/点大)与相对路径(ewei)。
    if (target.slot === 'mainThumb') {
      const newThumb = previewOf(res?.uploaded?.[0]?.url || '')
      const cur = store.currentGoods
      if (newThumb && cur && cur.id === goodsId) {
        store.setCurrentGoods({ ...cur, thumb: newThumb })
        // 同步列表缓存，返回门店商品列表时该商品也显示新图
        const ls = store.getGoodsListState(connectorId)
        const item = ls?.goods?.find((x: any) => Number(x.id) === goodsId)
        if (item) {
          item.thumb = newThumb
          store.setGoodsListState(connectorId, { ...ls })
        }
      }
    }
    await loadDetail()
  } catch (e: any) {
    applyError.value = e?.message || '应用失败'
  } finally {
    applying.value = false
    progressText.value = ''
  }
}

function goBack(): void {
  router.push(`/ewei/${connectorId}/goods`)
}

// 持久化：图位 / 来源 tab / 已选图（切走再回来不丢）
watch(
  [() => target.slot, () => target.optionId, sourceTab, picked],
  () => {
    store.setImageWorkState(goodsId, {
      slot: target.slot,
      optionId: target.optionId,
      sourceTab: sourceTab.value,
      picked: JSON.parse(JSON.stringify(picked.value)),
    })
  },
  { deep: true },
)

onMounted(async () => {
  if (!store.connectors.length) await store.loadConnectors()
  store.getCapabilities(connectorId).then((c) => { caps.value = c }).catch(() => {})
  await loadDetail()
  // 还原上次的图位 / 来源 / 已选图
  const ws = store.getImageWorkState(goodsId)
  if (ws) {
    if (ws.slot) target.slot = ws.slot
    if (ws.optionId) target.optionId = ws.optionId
    if (ws.sourceTab) sourceTab.value = ws.sourceTab
    if (Array.isArray(ws.picked)) picked.value = ws.picked
  }
  loadGalleryCategories()
  loadGallery(1)
  unsub = ewei().onProgress((d: any) => {
    if (!d || d.goodsId !== goodsId) return
    if (d.phase === 'uploading') progressText.value = d.message || `上传中 ${(d.current ?? 0) + 1}/${d.total ?? 1}`
    else if (d.phase === 'saving') progressText.value = d.message || '写回商品…'
    else progressText.value = ''
  })
})
onBeforeUnmount(() => {
  if (unsub) unsub()
})
</script>

<style scoped>
.ewei-input {
  @apply px-3 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500;
}
.ewei-chip {
  @apply px-2.5 py-1 rounded-md text-[11px] border border-surface-3 text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed;
}
</style>
