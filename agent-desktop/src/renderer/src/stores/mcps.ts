import { defineStore } from 'pinia'
import { ref } from 'vue'

function plain<T>(data: T): T {
  return JSON.parse(JSON.stringify(data))
}

export interface McpServer {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
  tools: any[]
  // true：工具直接以原名注入对话工具列表；false（默认）：通过 mcp_list_servers /
  // mcp_describe_tools / mcp_call 三元元工具按需发现与调用，节省 prompt token
  always_load: boolean
  created_at: string
}

export interface McpRuntime {
  status: 'starting' | 'running' | 'stopped' | 'error'
  error?: string
  toolCount?: number
}

/** 去掉 Electron IPC 异常的包装前缀，给用户看干净的错误原因 */
export function cleanIpcError(e: any): string {
  const msg = String(e?.message || e || '未知错误')
  return msg.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}

export const useMcpStore = defineStore('mcps', () => {
  const servers = ref<McpServer[]>([])
  const loading = ref(false)
  const serverStatus = ref<Record<string, McpRuntime>>({})
  /** id -> 'starting' | 'stopping' | 'refreshing'，视图据此禁用按钮防重复点击 */
  const busy = ref<Record<string, string>>({})
  let unsubscribeStatus: (() => void) | null = null

  /** 监听主进程推送的运行状态（进程退出/启动失败/工具变更都会推），幂等可重复调用 */
  function listenStatus() {
    if (unsubscribeStatus) return
    unsubscribeStatus = window.api.mcp.onStatus((payload: any) => {
      if (!payload?.id) return
      serverStatus.value[payload.id] = { status: payload.status, error: payload.error }
      // 服务器推送了工具清单变更（已写库）：重新拉取该 server 让标签实时更新
      if (payload.toolsUpdated) void refreshLocal(payload.id)
    })
  }

  function unlistenStatus() {
    unsubscribeStatus?.()
    unsubscribeStatus = null
  }

  /** 重新拉取单个 server 的库内数据（tools 等），替换列表中的对应项 */
  async function refreshLocal(id: string) {
    const fresh = (await window.api.mcp.invoke('get', id)) as McpServer | null
    if (!fresh) return
    const idx = servers.value.findIndex((s) => s.id === id)
    if (idx !== -1) servers.value[idx] = fresh
  }

  async function fetchServers() {
    loading.value = true
    try {
      servers.value = (await window.api.mcp.invoke('list')) as McpServer[]
    } finally {
      loading.value = false
    }
  }

  async function checkStatus(id: string): Promise<McpRuntime> {
    const status = (await window.api.mcp.invoke('status', id)) as McpRuntime
    serverStatus.value[id] = status
    return status
  }

  async function fetchAllStatus() {
    await Promise.all(servers.value.map((s) => checkStatus(s.id).catch(() => undefined)))
  }

  async function createServer(data: Partial<McpServer>) {
    const result = (await window.api.mcp.invoke('create', plain(data))) as McpServer
    servers.value.unshift(result)
    // 创建后自动探测：启动 + 握手 + 拉取工具。失败不影响创建成功，错误会落在状态卡片上。
    void probeServer(result.id)
    return result
  }

  /** 后台探测（启动 + 拉工具），不向上抛错——结果通过状态/工具标签呈现 */
  async function probeServer(id: string) {
    busy.value[id] = 'starting'
    try {
      await window.api.mcp.invoke('start', id)
      await refreshLocal(id)
    } catch {
      // 启动失败的诊断信息由主进程记录，checkStatus 会带回 error
    } finally {
      delete busy.value[id]
      // 探测期间服务器可能已被删除：不再写回状态，避免留下孤儿键
      if (servers.value.some((s) => s.id === id)) {
        await checkStatus(id).catch(() => undefined)
      }
    }
  }

  async function updateServer(id: string, data: Partial<McpServer>) {
    const result = (await window.api.mcp.invoke('update', id, plain(data))) as McpServer
    const idx = servers.value.findIndex((s) => s.id === id)
    if (idx !== -1) servers.value[idx] = result
    return result
  }

  /** 编辑保存（命令/参数/env 变更主进程会停掉旧进程）后重新探测新配置 */
  async function updateServerAndProbe(id: string, data: Partial<McpServer>) {
    const result = await updateServer(id, data)
    void probeServer(id)
    return result
  }

  async function deleteServer(id: string) {
    await window.api.mcp.invoke('delete', id)
    servers.value = servers.value.filter((s) => s.id !== id)
    delete serverStatus.value[id]
    delete busy.value[id]
  }

  /** 手动启动：失败抛错（带 stderr 诊断），由视图提示 */
  async function startServer(id: string) {
    busy.value[id] = 'starting'
    try {
      await window.api.mcp.invoke('start', id)
      await refreshLocal(id)
    } finally {
      delete busy.value[id]
      await checkStatus(id).catch(() => undefined)
    }
  }

  async function stopServer(id: string) {
    busy.value[id] = 'stopping'
    try {
      await window.api.mcp.invoke('stop', id)
    } finally {
      delete busy.value[id]
      await checkStatus(id).catch(() => undefined)
    }
  }

  /** 重新拉取工具清单（必要时自动启动服务器）。失败抛错由视图提示。 */
  async function refreshTools(id: string) {
    busy.value[id] = 'refreshing'
    try {
      const result = (await window.api.mcp.invoke('refreshTools', id)) as McpServer
      const idx = servers.value.findIndex((s) => s.id === id)
      if (idx !== -1) servers.value[idx] = result
      return result
    } finally {
      delete busy.value[id]
      await checkStatus(id).catch(() => undefined)
    }
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    return updateServer(id, { enabled })
  }

  return {
    servers,
    loading,
    serverStatus,
    busy,
    listenStatus,
    unlistenStatus,
    fetchServers,
    fetchAllStatus,
    checkStatus,
    createServer,
    updateServer,
    updateServerAndProbe,
    deleteServer,
    startServer,
    stopServer,
    refreshTools,
    toggleEnabled
  }
})
