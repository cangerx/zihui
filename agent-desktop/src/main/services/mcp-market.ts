import { createMcpServer } from './mcp-server'

// ============================================================================
// MCP 市场（MVP）
//   - 两个第三方源：mcp-cn.com（精选，~74 条，仅 list 接口）、mcpmarket.cn（全量，~69k，list+detail）
//   - 仅支持 stdio 类型的 MCP 安装（落地到本地 mcp_servers 表）；remote / http / sse 暂时拒装
//   - 所有第三方接口走 node 内置 fetch，统一 8s 超时与自定义 UA，失败抛错由调用方处理
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

const UA = 'LocalAgentDesktop/MCPMarket'
const FETCH_TIMEOUT_MS = 15000

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// ---- mcp-cn.com ----
// list 已包含安装所需全部字段，没有 detail 接口；connections 是 JSON5-like 字符串需自解析

interface McpCnConnectionConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}
interface McpCnConnection {
  type: 'stdio' | 'sse' | 'http' | 'streamable'
  config: McpCnConnectionConfig
}

/**
 * 把 mcp-cn 的 connections 字符串解析成对象数组。
 * 真实样本：'[{type:stdio,config:{command:npx,args:[-y,@upstash/context7-mcp]}}]'
 * 标识符 / 字符串值 / 对象 key 都没引号；策略：用正则给裸 key 与裸字面量补双引号后再 JSON.parse。
 * 失败返回空数组（调用方按缺少安装信息处理）。
 */
function parseConnections(input: any): McpCnConnection[] {
  if (Array.isArray(input)) return input as McpCnConnection[]
  if (typeof input !== 'string' || !input.trim()) return []
  let s = input.trim()
  try {
    // 1) 给对象 key 加引号：{key: → {"key":  (key 起始限定 letter/_/$，含字母数字下划线)
    s = s.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    // 2) 给「值位置」的裸标量加引号：命令名 / 包名 / 占位符 <xxx> / -y 等
    //    出现位置：紧跟 [ , : 之后（已加引号的 key 后是 :），结束于 , ] }
    //    起始字符放宽到字母 / @ / < / - / .，避免漏 "-y" 与 "@scope/pkg"
    s = s.replace(
      /([\[,:]\s*)([A-Za-z_@<\-.][\w@\/\-.<>:]*)\s*(?=[,\]}])/g,
      (_m, p1: string, p2: string) => {
        // 已是合法 JSON 字面量则跳过：true/false/null/纯数字
        if (/^(?:true|false|null)$/.test(p2)) return `${p1}${p2}`
        if (/^-?\d+(?:\.\d+)?$/.test(p2)) return `${p1}${p2}`
        return `${p1}"${p2}"`
      }
    )
    const parsed = JSON.parse(s)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    console.warn('[mcp-market] connections 解析失败:', e, input)
    return []
  }
}

function normalizeMcpCnInstall(item: any): McpInstallSpec | null {
  const conns = parseConnections(item.connections)
  if (!conns.length) return null
  const conn = conns[0]
  const cfg = conn.config || {}
  if (conn.type === 'stdio') {
    if (!cfg.command) return null
    return {
      type: 'stdio',
      command: String(cfg.command),
      args: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
      env: cfg.env || {}
    }
  }
  if (conn.type === 'sse' || conn.type === 'http' || conn.type === 'streamable') {
    if (!cfg.url) return null
    return {
      type: 'remote',
      transport: conn.type === 'sse' ? 'sse' : 'streamable-http',
      url: String(cfg.url),
      headers: cfg.headers || {}
    }
  }
  return null
}

function mcpCnItemToList(item: any): McpMarketListItem {
  const firstTag = typeof item.tag === 'string' ? item.tag.split(',')[0]?.trim() : ''
  return {
    source: 'mcp-cn',
    id: String(item.server_id),
    name: item.display_name || item.qualified_name || `#${item.server_id}`,
    description: item.description || '',
    category: firstTag || undefined,
    logo: item.logo || undefined,
    stars: undefined,
    featured: undefined,
    hosted: undefined
  }
}

async function fetchMcpCnList(page: number, pageSize: number): Promise<{ items: McpMarketListItem[]; hasMore: boolean; rawItems: any[] }> {
  const url = `https://mcp-cn.com/api/servers?page=${page}&pageSize=${pageSize}`
  const data = await fetchJson(url)
  if (data?.code !== 0 || !Array.isArray(data.data)) {
    throw new Error(`mcp-cn 返回异常: ${data?.message || 'unknown'}`)
  }
  const total = Number(data.pagination?.total ?? 0)
  const items = (data.data as any[]).map(mcpCnItemToList)
  const hasMore = page * pageSize < total
  return { items, hasMore, rawItems: data.data }
}

// mcp-cn 没有详情接口；用 list 翻页找到 server_id 对应的那条
async function fetchMcpCnDetail(id: string): Promise<McpMarketDetail> {
  // 数据集小（74 条）：每页 50 条最多翻 2 页就到底
  const PAGE_SIZE = 50
  for (let page = 1; page <= 10; page++) {
    const url = `https://mcp-cn.com/api/servers?page=${page}&pageSize=${PAGE_SIZE}`
    const data = await fetchJson(url)
    if (data?.code !== 0 || !Array.isArray(data.data)) break
    const row = (data.data as any[]).find((x) => String(x.server_id) === id)
    if (row) {
      const install = normalizeMcpCnInstall(row)
      if (!install) throw new Error('该 MCP 缺少可识别的安装信息')
      return {
        source: 'mcp-cn',
        id,
        name: row.display_name || row.qualified_name || `#${id}`,
        description: row.description || '',
        install,
        raw: row
      }
    }
    const total = Number(data.pagination?.total ?? 0)
    if (page * PAGE_SIZE >= total) break
  }
  throw new Error(`mcp-cn 未找到 server_id=${id}`)
}

// ---- mcpmarket.cn ----
// list 不含安装信息；安装必须打 detail。pageSize 固定 12 无法调整。

function mcpMarketCnItemToList(item: any): McpMarketListItem {
  const desc = typeof item.description === 'string'
    ? item.description
    : item.description?.zh || item.description?.en || ''
  return {
    source: 'mcpmarket-cn',
    id: String(item._id),
    name: item.name || item.alias || item._id,
    description: desc,
    category: Array.isArray(item.categories) && item.categories.length ? item.categories[0] : undefined,
    logo: item.logo || undefined,
    stars: typeof item.stars === 'number' ? item.stars : undefined,
    featured: Boolean(item.featured),
    hosted: Boolean(item.hosted)
  }
}

async function fetchMcpMarketCnList(page: number): Promise<{ items: McpMarketListItem[]; hasMore: boolean }> {
  const url = `https://mcpmarket.cn/api/servers?page=${page}`
  const data = await fetchJson(url)
  if (!Array.isArray(data?.servers)) throw new Error('mcpmarket.cn 返回异常')
  const items = (data.servers as any[]).map(mcpMarketCnItemToList)
  const totalPages = Number(data.total_pages ?? 0)
  return { items, hasMore: page < totalPages }
}

function normalizeMcpMarketCnInstall(detail: any): McpInstallSpec | null {
  // 优先：mcp_url.streamable_http_url + custom_headers（mcpmarket 几乎所有服务都是这种）
  const mcpUrl = detail?.mcp_url
  if (mcpUrl && typeof mcpUrl.streamable_http_url === 'string' && mcpUrl.streamable_http_url) {
    return {
      type: 'remote',
      transport: 'streamable-http',
      url: mcpUrl.streamable_http_url,
      headers: mcpUrl.custom_headers || {}
    }
  }
  // 次选：mcp_config.mcpServers 的第一项（极少给出 stdio command/args，多数也是 url+headers）
  const cfg = detail?.mcp_config?.mcpServers
  if (cfg && typeof cfg === 'object') {
    const firstKey = Object.keys(cfg)[0]
    if (firstKey) {
      const item = cfg[firstKey] || {}
      if (typeof item.command === 'string' && item.command) {
        return {
          type: 'stdio',
          command: item.command,
          args: Array.isArray(item.args) ? item.args.map(String) : [],
          env: item.env || {}
        }
      }
      if (typeof item.url === 'string' && item.url) {
        return {
          type: 'remote',
          transport: 'streamable-http',
          url: item.url,
          headers: item.headers || {}
        }
      }
    }
  }
  return null
}

async function fetchMcpMarketCnDetail(id: string): Promise<McpMarketDetail> {
  const url = `https://mcpmarket.cn/api/servers/${encodeURIComponent(id)}`
  const data = await fetchJson(url)
  if (!data || (!data._id && !data.id)) throw new Error('mcpmarket.cn 详情返回异常')
  // 砍掉巨大的 embedding 向量再传给上层
  delete data.embedding
  delete data.embedding_text
  const install = normalizeMcpMarketCnInstall(data)
  if (!install) throw new Error('该 MCP 缺少可识别的安装信息')
  const desc = typeof data.description === 'string'
    ? data.description
    : data.description?.zh || data.description?.en || ''
  return {
    source: 'mcpmarket-cn',
    id,
    name: data.name || data.alias || id,
    description: desc,
    install,
    raw: data
  }
}

// ---- 对外 API ----

export async function listMarket(
  source: McpMarketSource,
  page = 1,
  pageSize = 20
): Promise<{ items: McpMarketListItem[]; hasMore: boolean }> {
  if (source === 'mcp-cn') {
    const r = await fetchMcpCnList(page, pageSize)
    return { items: r.items, hasMore: r.hasMore }
  }
  if (source === 'mcpmarket-cn') {
    // mcpmarket pageSize 固定 12，无法定制
    return fetchMcpMarketCnList(page)
  }
  throw new Error(`未知来源: ${source}`)
}

/**
 * 关键词搜索：两个源都没有原生搜索接口，统一走「前 N 页全量 substring 过滤」。
 * mcp-cn 总量 74 条，N=3 已能覆盖全集；mcpmarket 总量大，搜索只扫前 N 页。
 */
export async function searchMarket(
  source: McpMarketSource,
  keyword: string,
  page = 1,
  pageSize = 20
): Promise<{ items: McpMarketListItem[]; hasMore: boolean }> {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return listMarket(source, page, pageSize)

  if (source === 'mcp-cn') {
    // mcp-cn 总共 74 条，一把拉完
    const all: McpMarketListItem[] = []
    for (let p = 1; p <= 3; p++) {
      const r = await fetchMcpCnList(p, 50)
      all.push(...r.items)
      if (!r.hasMore) break
    }
    const filtered = all.filter(
      (x) =>
        x.name.toLowerCase().includes(kw) ||
        (x.description || '').toLowerCase().includes(kw) ||
        (x.category || '').toLowerCase().includes(kw)
    )
    const start = (page - 1) * pageSize
    const items = filtered.slice(start, start + pageSize)
    return { items, hasMore: start + pageSize < filtered.length }
  }

  if (source === 'mcpmarket-cn') {
    // 总量过大，仅扫描前 5 页（60 条）+ 客户端过滤；后续按需可扩
    const all: McpMarketListItem[] = []
    for (let p = 1; p <= 5; p++) {
      const r = await fetchMcpMarketCnList(p)
      all.push(...r.items)
      if (!r.hasMore) break
    }
    const filtered = all.filter(
      (x) =>
        x.name.toLowerCase().includes(kw) ||
        (x.description || '').toLowerCase().includes(kw) ||
        (x.category || '').toLowerCase().includes(kw)
    )
    const start = (page - 1) * pageSize
    const items = filtered.slice(start, start + pageSize)
    return { items, hasMore: start + pageSize < filtered.length }
  }
  throw new Error(`未知来源: ${source}`)
}

export async function getMarketDetail(source: McpMarketSource, id: string): Promise<McpMarketDetail> {
  if (source === 'mcp-cn') return fetchMcpCnDetail(id)
  if (source === 'mcpmarket-cn') return fetchMcpMarketCnDetail(id)
  throw new Error(`未知来源: ${source}`)
}

/**
 * 把市场条目落地到本地 mcp_servers 表。
 * MVP 限制：本地 schema 仅支持 stdio（command/args/env），remote 类型一律拒装。
 * 名称前缀打 [市场] 标识来源，envOverrides 覆盖详情里的占位符 env 值。
 */
export async function installFromMarket(
  detail: McpMarketDetail,
  envOverrides?: Record<string, string>
): Promise<{ id: string }> {
  if (detail.install.type !== 'stdio') {
    throw new Error('暂不支持远程 MCP（仅支持 stdio）')
  }
  const mergedEnv: Record<string, string> = { ...detail.install.env, ...(envOverrides || {}) }
  const server = createMcpServer({
    name: `[市场] ${detail.name}`,
    command: detail.install.command,
    args: detail.install.args,
    env: mergedEnv
  })
  console.log(`[mcp-market] installed from ${detail.source}#${detail.id} -> server ${server.id}`)
  return { id: server.id }
}
