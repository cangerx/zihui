import { defineStore } from 'pinia'
import { ref } from 'vue'

function plain<T>(data: T): T {
  return JSON.parse(JSON.stringify(data))
}

// ============================================================================
// MCP 市场 store（renderer 端）
//   - 与主进程 services/mcp-market.ts 字段对齐；类型独立声明（前后端不共享类型）
//   - 分页通过 page/hasMore 维护；切换 source / 搜索时重置
// ============================================================================

export type McpMarketSource = 'mcp-cn' | 'mcpmarket-cn'

export interface McpMarketListItem {
  source: McpMarketSource
  id: string
  name: string
  description?: string
  category?: string
  logo?: string
  stars?: number
  featured?: boolean
  hosted?: boolean
}

export type McpInstallSpec =
  | { type: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  | { type: 'remote'; transport: 'sse' | 'streamable-http'; url: string; headers?: Record<string, string> }

export interface McpMarketDetail {
  source: McpMarketSource
  id: string
  name: string
  description?: string
  install: McpInstallSpec
  raw?: any
}

const DEFAULT_PAGE_SIZE = 20

export const useMcpMarketStore = defineStore('mcpMarket', () => {
  const items = ref<McpMarketListItem[]>([])
  const loading = ref(false)
  const error = ref<string>('')
  const currentSource = ref<McpMarketSource>('mcp-cn')
  const page = ref(1)
  const hasMore = ref(false)
  const searchKeyword = ref('')

  function cleanErr(e: any): string {
    const msg = String(e?.message || e || '未知错误')
    return msg.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
  }

  function reset(): void {
    items.value = []
    page.value = 1
    hasMore.value = false
    error.value = ''
  }

  async function fetchList(reset_ = true): Promise<void> {
    if (reset_) reset()
    loading.value = true
    try {
      const r = await window.api.mcpMarket.invoke<{ items: McpMarketListItem[]; hasMore: boolean }>(
        'list',
        currentSource.value,
        page.value,
        DEFAULT_PAGE_SIZE
      )
      items.value = reset_ ? r.items : [...items.value, ...r.items]
      hasMore.value = r.hasMore
    } catch (e: any) {
      error.value = cleanErr(e)
    } finally {
      loading.value = false
    }
  }

  async function search(keyword: string): Promise<void> {
    searchKeyword.value = keyword
    reset()
    if (!keyword.trim()) {
      await fetchList(true)
      return
    }
    loading.value = true
    try {
      const r = await window.api.mcpMarket.invoke<{ items: McpMarketListItem[]; hasMore: boolean }>(
        'search',
        currentSource.value,
        keyword,
        page.value,
        DEFAULT_PAGE_SIZE
      )
      items.value = r.items
      hasMore.value = r.hasMore
    } catch (e: any) {
      error.value = cleanErr(e)
    } finally {
      loading.value = false
    }
  }

  async function loadMore(): Promise<void> {
    if (!hasMore.value || loading.value) return
    page.value += 1
    loading.value = true
    try {
      const channel = searchKeyword.value.trim() ? 'search' : 'list'
      const args = searchKeyword.value.trim()
        ? [currentSource.value, searchKeyword.value, page.value, DEFAULT_PAGE_SIZE]
        : [currentSource.value, page.value, DEFAULT_PAGE_SIZE]
      const r = await window.api.mcpMarket.invoke<{ items: McpMarketListItem[]; hasMore: boolean }>(
        channel,
        ...args
      )
      items.value = [...items.value, ...r.items]
      hasMore.value = r.hasMore
    } catch (e: any) {
      error.value = cleanErr(e)
      page.value -= 1
    } finally {
      loading.value = false
    }
  }

  async function fetchDetail(id: string): Promise<McpMarketDetail> {
    return window.api.mcpMarket.invoke<McpMarketDetail>('detail', currentSource.value, id)
  }

  async function install(
    detail: McpMarketDetail,
    envOverrides?: Record<string, string>
  ): Promise<{ id: string }> {
    return window.api.mcpMarket.invoke<{ id: string }>(
      'install',
      plain(detail),
      plain(envOverrides || {})
    )
  }

  function setSource(source: McpMarketSource): void {
    if (source === currentSource.value) return
    currentSource.value = source
    searchKeyword.value = ''
    reset()
  }

  return {
    items,
    loading,
    error,
    currentSource,
    page,
    hasMore,
    searchKeyword,
    fetchList,
    search,
    loadMore,
    fetchDetail,
    install,
    setSource
  }
})
