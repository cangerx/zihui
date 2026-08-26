<template>
  <div class="h-full flex flex-col bg-surface-1">
    <!-- 顶部条 -->
    <div class="flex items-center gap-3 px-5 py-3 border-b border-surface-3 bg-surface-0">
      <button class="ewei-chip" @click="router.push('/ewei')">返回</button>
      <div class="flex-1 min-w-0">
        <h2 class="text-sm font-semibold text-text-primary truncate">{{ connector?.name || '门店商品' }}</h2>
        <p v-if="caps?.needsShopSwitch" class="text-[11px] text-text-tertiary truncate">门店：{{ connector?.current_shop_name || connector?.current_shop_id || '未选择' }}</p>
      </div>
      <input v-model="keyword" class="ewei-input !mt-0 !w-48" placeholder="搜索商品标题" @keyup.enter="reload(1)" />
      <select v-model="status" class="ewei-input !mt-0 !w-24" @change="reload(1)">
        <option value="">全部</option>
        <option value="1">在售</option>
        <option value="-2">下架</option>
      </select>
      <button class="ewei-chip" @click="reload(1)">查询</button>
      <button v-if="caps?.supportsAddGoods" class="btn-primary !py-1.5 !px-3 text-xs" @click="router.push(`/ewei/${connectorId}/goods/new`)">新增商品</button>
    </div>

    <!-- 商品网格 -->
    <div class="flex-1 overflow-y-auto p-5">
      <div v-if="loading" class="text-center text-text-tertiary text-sm py-10">加载中…</div>
      <div v-else-if="error" class="text-center text-error text-sm py-10">
        {{ error }}
        <div class="mt-2">
          <button class="ewei-chip" @click="router.push('/ewei')">回去选门店</button>
        </div>
      </div>
      <div v-else-if="!goods.length" class="text-center text-text-tertiary text-sm py-10">该门店暂无商品</div>
      <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        <button
          v-for="g in goods"
          :key="g.id"
          class="group bg-surface-0 border border-surface-3 rounded-xl overflow-hidden text-left hover:shadow-md hover:border-primary-300 transition-all"
          @click="openImage(g)"
        >
          <div class="aspect-square bg-surface-2 overflow-hidden">
            <img v-if="g.thumb" :src="g.thumb" class="w-full h-full object-cover group-hover:scale-105 transition-transform" alt="" draggable="false" />
            <div v-else class="w-full h-full flex items-center justify-center text-text-tertiary text-xs">无图</div>
          </div>
          <div class="p-2.5">
            <div class="text-xs text-text-primary line-clamp-2 leading-snug min-h-[2rem]">{{ g.title }}</div>
            <div class="flex items-center gap-1.5 mt-1.5">
              <span class="text-xs text-error font-medium">¥{{ g.price }}</span>
              <span v-if="g.has_option" class="text-[10px] px-1 py-0.5 rounded bg-surface-2 text-text-tertiary">多规格</span>
              <span v-if="g.status !== 1" class="text-[10px] px-1 py-0.5 rounded bg-surface-2 text-text-tertiary">已下架</span>
            </div>
          </div>
        </button>
      </div>
    </div>

    <!-- 分页 -->
    <div v-if="!error && count > 0" class="flex items-center justify-between px-5 py-2.5 border-t border-surface-3 bg-surface-0 text-xs text-text-tertiary">
      <span>共 {{ count }} 件商品</span>
      <div class="flex items-center gap-2">
        <button class="ewei-chip" :disabled="page <= 1" @click="reload(page - 1)">上一页</button>
        <span>{{ page }} / {{ totalPages }}</span>
        <button class="ewei-chip" :disabled="page >= totalPages" @click="reload(page + 1)">下一页</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useEweiStore, type EweiConnectorSummary, type MallCapabilities } from '@/stores/ewei'

const route = useRoute()
const router = useRouter()
const store = useEweiStore()

const connectorId = route.params.connectorId as string
const ewei = () => (window as any).api.ewei

const connector = ref<EweiConnectorSummary | undefined>(undefined)
const caps = ref<MallCapabilities | undefined>(undefined)
const goods = ref<any[]>([])
const count = ref(0)
const page = ref(1)
const pageSize = 20
const keyword = ref('')
const status = ref('')
const loading = ref(false)
const error = ref('')

const totalPages = computed(() => Math.max(1, Math.ceil(count.value / pageSize)))

async function reload(p: number): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const r = await ewei().invoke('listGoods', connectorId, {
      page: p,
      pagesize: pageSize,
      title: keyword.value.trim() || undefined,
      status: status.value || undefined,
    })
    goods.value = r.list || []
    count.value = r.count || 0
    page.value = p
    persist()
  } catch (e: any) {
    error.value = e?.message || '获取商品失败'
    goods.value = []
  } finally {
    loading.value = false
  }
}

function persist(): void {
  store.setGoodsListState(connectorId, {
    goods: goods.value,
    count: count.value,
    page: page.value,
    keyword: keyword.value,
    status: status.value,
  })
}
// 筛选输入也持久化（即使没点查询，切走再回来仍在）
watch([keyword, status], persist)

function openImage(g: any): void {
  // 暂存列表项（含绝对 thumb URL）供详情页预览现有图（详情接口只回相对路径）
  store.setCurrentGoods({ id: g.id, title: g.title, thumb: g.thumb })
  router.push(`/ewei/${connectorId}/goods/${g.id}/image`)
}

onMounted(async () => {
  if (!store.connectors.length) await store.loadConnectors()
  connector.value = store.getConnector(connectorId)
  caps.value = await store.getCapabilities(connectorId).catch(() => undefined)
  // 切走再回来：有缓存就直接还原（不重新拉，内容原样在），用「查询」按钮主动刷新
  const cached = store.getGoodsListState(connectorId)
  if (cached) {
    goods.value = cached.goods || []
    count.value = cached.count || 0
    page.value = cached.page || 1
    keyword.value = cached.keyword || ''
    status.value = cached.status || ''
  } else {
    await reload(1)
  }
})
</script>

<style scoped>
.ewei-input {
  @apply px-3 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500;
}
.ewei-chip {
  @apply px-2.5 py-1 rounded-md text-[11px] border border-surface-3 text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed;
}
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
