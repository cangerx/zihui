<template>
  <div class="h-full flex flex-col">
    <header class="page-header justify-between">
      <div class="flex items-center gap-3">
        <span class="text-sm font-medium text-text-secondary">发现可复用的提示词与参考图</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="relative">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
          <input
            v-model="search"
            placeholder="搜索灵感..."
            class="pl-9 pr-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500 w-56"
          />
        </div>
      </div>
    </header>
    <div class="page-body">
      <!-- Category tabs -->
      <div class="flex flex-wrap gap-1.5 mb-5">
        <button
          @click="selectCategory('')"
          :class="['px-3 py-1.5 text-xs rounded-lg transition-colors', !selectedCategory ? 'bg-primary-600 text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3']"
        >全部</button>
        <button
          v-for="cat in displayCategories"
          :key="cat"
          @click="selectCategory(selectedCategory === cat ? '' : cat)"
          :class="['px-3 py-1.5 text-xs rounded-lg transition-colors', selectedCategory === cat ? 'bg-primary-600 text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3']"
        >{{ cat }}</button>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="flex-1 flex items-center justify-center py-20">
        <svg class="w-6 h-6 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
      </div>

      <!-- Empty state -->
      <div v-else-if="!feedItems.length" class="empty-state">
        <div class="w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
          <svg class="w-8 h-8 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" /></svg>
        </div>
        <p class="text-sm font-medium text-text-secondary mb-1">暂无匹配的灵感</p>
        <p class="text-xs text-text-tertiary">尝试切换分类或翻页查看更多灵感</p>
      </div>

      <!-- 瀑布流：固定 5 列，按随机后的顺序 round-robin 分配到各列，下拉无限加载 -->
      <template v-else>
        <div class="flex gap-3 items-start">
          <div v-for="(col, ci) in columns" :key="ci" class="flex-1 min-w-0 flex flex-col gap-3">
            <div
              v-for="item in col"
              :key="item.id"
              @click="openDetail(item)"
              class="cursor-pointer rounded-xl overflow-hidden border border-surface-3 bg-surface-0 shadow-sm hover:shadow-md transition-shadow group"
            >
              <!-- 瀑布流封面：按原图比例展示（不裁剪），高度错落 -->
              <div class="bg-surface-2 overflow-hidden">
                <img v-if="item.cover_image" :src="item.cover_thumb || item.cover_image" class="w-full h-auto block group-hover:scale-105 transition-transform duration-300" loading="lazy" @error="($event.target as HTMLImageElement).style.display='none'" />
                <div v-else class="w-full aspect-[4/3] flex items-center justify-center">
                  <svg class="w-10 h-10 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" /></svg>
                </div>
              </div>
              <div class="p-3">
                <h4 class="text-xs font-medium text-text-primary truncate">{{ item.title }}</h4>
                <div class="flex items-center gap-1.5 mt-1">
                  <p class="text-[10px] text-text-tertiary line-clamp-1 flex-1">{{ item.category }}</p>
                  <span v-if="item.uploader_nickname" class="text-[10px] text-text-tertiary truncate flex-shrink-0" :title="`上传者：${item.uploader_nickname}`">@{{ item.uploader_nickname }}</span>
                </div>
                <div v-if="item.tags?.length" class="flex flex-wrap gap-1 mt-1.5">
                  <span v-for="tag in item.tags.slice(0, 3)" :key="tag" class="text-[9px] px-1.5 py-0.5 bg-surface-2 text-text-tertiary rounded">{{ tag }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部哨兵：进入视口自动加载下一批；仍有更多时显示加载指示 -->
        <div :ref="setSentinel" class="h-px"></div>
        <div v-if="hasMore" class="py-6 flex items-center justify-center">
          <svg class="w-5 h-5 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
        </div>
      </template>
    </div>

    <!-- Detail Modal：图片原图尺寸展示（不超出视口） + 右上角独立悬浮关闭按钮提亮 -->
    <div v-if="detailItem" class="fixed inset-0 z-50 flex items-center justify-center p-6" @click.self="detailItem = null">
      <div class="relative bg-surface-0 rounded-2xl shadow-[0_0_30px_rgba(0,0,0,0.12)] max-w-[min(90vw,1200px)] max-h-[90vh] flex flex-col overflow-hidden">
        <!-- 右上角悬浮关闭按钮：36px 圆形 + 半透明黑底 + 白色粗体 X + 高 z-index，原图上也能看清 -->
        <button
          @click="detailItem = null"
          class="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center transition-colors shadow-lg"
          title="关闭"
          aria-label="关闭详情"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>

        <!-- Cover：原图宽高按比例自适应，不裁剪，超过视口时高度被 max-h-[55vh] 限住。详情部分可独立滚动 -->
        <div class="flex-shrink-0 bg-surface-2 flex items-center justify-center overflow-hidden" style="max-height: 55vh;">
          <img v-if="detailItem.cover_image" :src="detailItem.cover_image" class="max-w-full max-h-[55vh] w-auto h-auto object-contain block" />
          <div v-else class="w-full h-40 flex items-center justify-center">
            <svg class="w-16 h-16 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" /></svg>
          </div>
        </div>
        <div class="p-5 overflow-y-auto flex-1">
          <!-- 标题 / 上传者：右侧预留问关闭按钮位置避免遮挡 -->
          <div class="mb-4 pr-12">
            <h3 class="text-sm font-semibold text-text-primary">{{ detailItem.title }}</h3>
            <p v-if="detailItem.uploader_nickname" class="text-[11px] text-text-tertiary mt-1">by @{{ detailItem.uploader_nickname }}</p>
            <p v-if="detailItem.generation_size" class="text-[11px] text-text-tertiary mt-1">尺寸：{{ detailItem.generation_size }}</p>
          </div>

          <!-- Reference images -->
          <div v-if="detailRefImages.length" class="mb-4">
            <label class="text-xs font-medium text-text-secondary mb-1.5 block">参考图片（{{ detailRefImages.length }}）</label>
            <div class="flex gap-2 flex-wrap">
              <img v-for="(url, index) in detailRefImages" :key="`${url}-${index}`" :src="url" class="w-20 h-20 object-cover rounded-lg border border-surface-3" />
            </div>
          </div>

          <!-- Chinese prompt -->
          <div v-if="detailItem.prompt_cn" class="mb-4">
            <div class="flex items-center justify-between mb-1.5">
              <label class="text-xs font-medium text-text-secondary">中文提示词</label>
              <button @click="useInspiration(detailItem!.prompt_cn, detailItem!)" class="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
                使用灵感
              </button>
            </div>
            <div class="text-xs text-text-primary bg-surface-1 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">{{ detailItem.prompt_cn }}</div>
          </div>

          <!-- English prompt -->
          <div v-if="detailItem.prompt_en" class="mb-4">
            <div class="flex items-center justify-between mb-1.5">
              <label class="text-xs font-medium text-text-secondary">English Prompt</label>
              <button @click="useInspiration(detailItem!.prompt_en, detailItem!)" class="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
                Use Prompt
              </button>
            </div>
            <div class="text-xs text-text-primary bg-surface-1 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">{{ detailItem.prompt_en }}</div>
          </div>

          <!-- Tags -->
          <div v-if="detailItem.tags?.length" class="flex flex-wrap gap-1.5 mb-4">
            <span v-for="tag in detailItem.tags" :key="tag" class="text-[10px] px-2 py-0.5 bg-surface-2 text-text-tertiary rounded-md">{{ tag }}</span>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
interface Inspiration {
  id: string
  title: string
  prompt_cn: string
  prompt_en: string
  category: string
  tags: string[]
  ref_image?: string
  ref_images?: string[]
  generation_size?: string
  cover_image?: string
  // 网格列表用的封面缩略图（云端可能为空，回退 cover_image）
  cover_thumb?: string
  // 云控端自定义灵感中用户上传的会带上传者昵称；后台手动录入的为空
  uploader_nickname?: string
}
</script>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useHandoffStore } from '@/stores/handoff'
import { useRandomInfiniteFeed } from '@/utils/random-infinite-feed'

const router = useRouter()
const handoff = useHandoffStore()
const api = () => (window as any).api

const selectedCategory = ref('')
const search = ref('')
const loading = ref(false)
const detailItem = ref<Inspiration | null>(null)
const detailRefImages = computed(() => {
  const item = detailItem.value
  if (!item) return []
  return (item.ref_images?.length ? item.ref_images : (item.ref_image ? [item.ref_image] : [])).slice(0, 8)
})

const dynamicCategories = ref<string[]>([])
const displayCategories = computed(() => dynamicCategories.value)

// 灵感是有限数据集：一次性拉全量，前端随机排序 + 无限滚动（首屏 25，每次下拉 +20）
const { items: feedItems, hasMore, setItems, setSentinel } = useRandomInfiniteFeed<Inspiration>({ initial: 25, step: 20 })

// 5 列瀑布流：对随机后的展示切片做 round-robin 分配，保证下拉追加时已有卡片不重排
const COLUMN_COUNT = 5
const columns = computed<Inspiration[][]>(() => {
  const cols: Inspiration[][] = Array.from({ length: COLUMN_COUNT }, () => [])
  feedItems.value.forEach((item, i) => cols[i % COLUMN_COUNT].push(item))
  return cols
})

/** 一次性拉取当前分类/搜索下的全部灵感，再交给前端随机 + 无限滚动 */
async function fetchAllOnline() {
  loading.value = true
  try {
    const pageSize = 100
    let page = 1
    let total = Infinity
    let acc: Inspiration[] = []
    let cats: string[] = []
    // 循环翻后端分页拉全量；安全上限 30 页（3000 条），避免异常数据导致死循环
    while (acc.length < total && page <= 30) {
      const result = await api().imageGen.invoke('fetchOnlineInspirations', {
        page,
        pageSize,
        category: selectedCategory.value || undefined,
        search: search.value.trim() || undefined,
      })
      const items = Array.isArray(result.items) ? result.items : []
      if (page === 1) {
        total = typeof result.total === 'number' ? result.total : items.length
        const categories = Array.isArray(result.categories) ? result.categories.filter(Boolean) : []
        cats = categories.length
          ? categories
          : Array.from(new Set(items.map((it: Inspiration) => it.category).filter(Boolean)))
      }
      acc = acc.concat(items)
      if (!items.length) break
      page++
    }
    dynamicCategories.value = cats
    // setItems 内部会重新洗牌，实现「每次刷新 / 切分类 / 搜索都重新随机」
    setItems(acc)
  } catch (e) {
    console.error('Failed to fetch inspirations:', e)
  } finally {
    loading.value = false
  }
}

/** 切换分类：重新拉取该分类全部记录并重新随机 */
function selectCategory(cat: string) {
  if (cat === selectedCategory.value) return
  selectedCategory.value = cat
  fetchAllOnline()
}

/** 搜索：防抖后重新向后端查询全部灵感并重新随机 */
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => fetchAllOnline(), 350)
})

function openDetail(item: Inspiration) {
  detailItem.value = item
}

function useInspiration(promptText: string, item: Inspiration) {
  detailItem.value = null
  const refs = (item.ref_images?.length ? item.ref_images : (item.ref_image ? [item.ref_image] : [])).slice(0, 8)
  handoff.set('imageGen', {
    prompt: promptText,
    presetSize: item.generation_size || undefined,
    refImages: refs.length ? refs : undefined
  })
  router.push('/image-gen')
}

onMounted(() => {
  // 每次进入页面都重新加载并重新随机
  fetchAllOnline()
})
</script>
