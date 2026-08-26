import { getDatabase } from '../database'
import { v4 as uuid } from 'uuid'
import { spawn, execFile, ChildProcess } from 'child_process'
import { app, BrowserWindow } from 'electron'
import { commandNotFoundHint, enrichGuiEnv, resolveOnPath } from './gui-path'

// 对话「中止」专用错误：abort 时立即解除在途 RPC / 握手等待的 await，
// 由 chat-engine 捕获后归类（最终走 AbortedError 分支），文案不进对话上下文。
export class McpAbortedError extends Error {
  constructor() {
    super('MCP 调用已中止')
    this.name = 'McpAbortedError'
  }
}

// 把任意 promise 与「中止信号」赛跑：signal abort 时立即 reject（不影响 promise 本体继续，
// 共享客户端/握手不会因单个会话中止而被误杀）。无 signal 时原样返回。
function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new McpAbortedError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort)
      reject(new McpAbortedError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      }
    )
  })
}

// ============================================================================
// MCP（Model Context Protocol）stdio 客户端
//   - 进程管理：Windows 经 cmd /c 启动（npx/uvx 等 .cmd 脚本直接 spawn 会 ENOENT），
//     停止用 taskkill /T 杀整棵进程树（npx → node 链式子进程）
//   - 协议会话：标准握手（initialize 请求 → notifications/initialized 通知）后才发业务请求；
//     stdout 单监听器按行分帧、按 id 路由并发请求；stderr 留尾部缓冲供错误诊断
//   - 工具缓存：tools/list 结果持久化到 mcp_servers.tools，chat-engine 构建工具列表时读取；
//     服务器推送 notifications/tools/list_changed 时自动刷新
//   - 状态推送：running / stopped / error 变化实时发 'mcp:status' 给渲染层
// ============================================================================

export interface McpServer {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
  tools: any[]
  // true：该服务器的工具直接以原名注入 LLM tools 列表（高频工具适用）
  // false（默认）：工具不直接暴露给模型，必须通过 mcp_list_servers / mcp_describe_tools / mcp_call
  // 三元元工具按需发现与调用，节省 prompt token、避免模型被海量工具淹没
  always_load: boolean
  created_at: string
}

export interface McpRuntime {
  status: 'starting' | 'running' | 'stopped' | 'error'
  error?: string
  toolCount: number
}

const MCP_PROTOCOL_VERSION = '2025-06-18'
const INIT_TIMEOUT_MS = 60000 // npx 首次运行需下载包，握手超时放宽
const RPC_TIMEOUT_MS = 30000
const STDERR_TAIL_MAX = 8 * 1024
const MAX_STDOUT_LINE_BUF = 10 * 1024 * 1024
const MAX_TOOLS_PAGES = 500 // tools/list 分页聚合上限，防服务器 cursor 死循环

function safeJsonParse<T>(text: any, fallback: T): T {
  if (text === null || text === undefined || text === '') return fallback
  try {
    const v = JSON.parse(String(text))
    return v === null || v === undefined ? fallback : v
  } catch {
    return fallback
  }
}

function parseMcpServer(row: any): McpServer {
  return {
    ...row,
    args: safeJsonParse<string[]>(row.args, []),
    env: safeJsonParse<Record<string, string>>(row.env, {}),
    tools: safeJsonParse<any[]>(row.tools, []),
    enabled: Boolean(row.enabled),
    always_load: Boolean(row.always_load)
  }
}

// ---- 进程启动（跨平台） ----

// cmd /c 下参数不会被 Node 自动转义：含空白/特殊字符的参数手工加引号
function quoteWindowsArg(arg: string): string {
  if (arg === '') return '""'
  if (!/[\s"&|<>^();,=]/.test(arg)) return arg
  return '"' + arg.replace(/"/g, '\\"') + '"'
}

function spawnServerProcess(server: McpServer): ChildProcess {
  // spawn 的 env 值必须是 string；用户 JSON 里可能混入 number/boolean
  const raw: NodeJS.ProcessEnv = { ...process.env }
  for (const [k, v] of Object.entries(server.env || {})) raw[k] = String(v)
  // 程序坞启动时 PATH 不含 Homebrew/nvm；补目录后再解析 npx 等裸命令
  const env = enrichGuiEnv(raw)
  const command = resolveOnPath(server.command, env)

  if (process.platform === 'win32') {
    const line = [command, ...server.args].map(quoteWindowsArg).join(' ')
    return spawn(line, {
      shell: true,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
  }
  return spawn(command, server.args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
}

// ---- 协议客户端 ----

interface PendingRequest {
  resolve: (v: any) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

class McpClient {
  readonly serverId: string
  readonly serverName: string
  readonly ready: Promise<void>
  exited = false

  private proc: ChildProcess
  private pending = new Map<number, PendingRequest>()
  private nextId = 1
  private stdoutBuf = ''
  private stderrTail = ''
  private intentionalExit = false

  constructor(server: McpServer) {
    this.serverId = server.id
    this.serverName = server.name
    this.proc = spawnServerProcess(server)

    this.proc.stdout?.on('data', (chunk: Buffer) => this.onStdout(chunk))
    // stderr 必须消费：MCP 规范要求服务器日志走 stderr，不读会撑满管道缓冲导致子进程写阻塞假死
    this.proc.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-STDERR_TAIL_MAX)
    })
    this.proc.on('error', (err) => {
      this.exited = true
      const reason = /ENOENT/i.test(err.message)
        ? `${commandNotFoundHint(server.command)}\n（${err.message}）`
        : `进程启动失败: ${err.message}`
      this.failPending(new Error(this.composeError(reason)))
      this.handleGone(reason)
    })
    this.proc.on('exit', (code, signal) => {
      this.exited = true
      const reason = `进程已退出 (code=${code ?? '-'}${signal ? `, signal=${signal}` : ''})`
      this.failPending(new Error(this.intentionalExit ? 'MCP 服务器已停止' : this.composeError(reason)))
      this.handleGone(this.intentionalExit ? null : reason)
    })

    this.ready = this.initialize()
    this.ready.catch(() => {}) // 失败由 ensureClient 统一转化，这里兜住防 unhandledRejection
  }

  /** 拼上 stderr 尾部，让「启动失败」可诊断（缺依赖 / 命令不存在 / 鉴权失败等都打在 stderr） */
  composeError(reason: string): string {
    const tail = this.stderrTail.trim()
    return tail ? `${reason}\n[stderr] ${tail.slice(-2000)}` : reason
  }

  private handleGone(errorReason: string | null): void {
    // 仅清理仍指向自己的注册（配置变更重启时新实例可能已就位，勿误删）
    if (clients.get(this.serverId) === this) {
      clients.delete(this.serverId)
      if (errorReason) {
        lastErrors.set(this.serverId, this.composeError(errorReason))
        emitStatus(this.serverId, 'error', lastErrors.get(this.serverId))
      } else {
        emitStatus(this.serverId, 'stopped')
      }
    }
  }

  private onStdout(chunk: Buffer): void {
    this.stdoutBuf += chunk.toString()
    let idx: number
    while ((idx = this.stdoutBuf.indexOf('\n')) !== -1) {
      const line = this.stdoutBuf.slice(0, idx).trim()
      this.stdoutBuf = this.stdoutBuf.slice(idx + 1)
      if (!line) continue
      let msg: any
      try {
        msg = JSON.parse(line)
      } catch {
        continue // 服务器违规向 stdout 打了非 JSON 日志：跳过该行
      }
      this.dispatch(msg)
    }
    if (this.stdoutBuf.length > MAX_STDOUT_LINE_BUF) this.stdoutBuf = '' // 单行超限防内存失控
  }

  private dispatch(msg: any): void {
    // 响应：按 id 路由给等待中的请求
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
      else p.resolve(msg.result)
      return
    }
    if (!msg.method) return
    // 服务器 → 客户端请求：必须应答，否则服务器端会挂起等待
    if (msg.id !== undefined) {
      if (msg.method === 'ping') {
        this.send({ jsonrpc: '2.0', id: msg.id, result: {} })
      } else {
        this.send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: `Method not supported: ${msg.method}` }
        })
      }
      return
    }
    // 通知：工具清单变更时自动刷新缓存
    if (msg.method === 'notifications/tools/list_changed') {
      void refreshToolsQuietly(this.serverId)
    }
  }

  private send(obj: any): boolean {
    if (this.exited || !this.proc.stdin || !this.proc.stdin.writable) return false
    try {
      this.proc.stdin.write(JSON.stringify(obj) + '\n')
      return true
    } catch {
      return false
    }
  }

  request(method: string, params?: any, timeoutMs = RPC_TIMEOUT_MS, signal?: AbortSignal): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.exited) {
        reject(new Error('MCP 服务器未在运行'))
        return
      }
      if (signal?.aborted) {
        reject(new McpAbortedError())
        return
      }
      const id = this.nextId++
      // 中止 / 超时 / 回包 三条路径共用的清理：摘掉 abort 监听 + 删 pending，避免泄漏与重复 settle。
      const detach = (): void => {
        if (signal) signal.removeEventListener('abort', onAbort)
      }
      const onAbort = (): void => {
        this.pending.delete(id)
        clearTimeout(timer)
        detach()
        reject(new McpAbortedError())
      }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        detach()
        reject(new Error(`MCP 请求超时 (${method}, ${timeoutMs}ms)`))
      }, timeoutMs)
      // 包一层使「服务器回包 / failPending」也摘掉 abort 监听（dispatch/failPending 会 clearTimeout）
      this.pending.set(id, {
        resolve: (v: any) => {
          detach()
          resolve(v)
        },
        reject: (e: Error) => {
          detach()
          reject(e)
        },
        timer
      })
      if (signal) signal.addEventListener('abort', onAbort, { once: true })
      if (!this.send({ jsonrpc: '2.0', id, method, params: params ?? {} })) {
        clearTimeout(timer)
        this.pending.delete(id)
        detach()
        reject(new Error('MCP 服务器 stdin 不可写（进程可能已退出）'))
      }
    })
  }

  notify(method: string, params?: any): void {
    this.send({ jsonrpc: '2.0', method, params: params ?? {} })
  }

  // MCP 标准握手：initialize 请求 → initialized 通知。未握手前服务器会拒绝一切业务请求。
  private async initialize(): Promise<void> {
    await this.request(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'local-agent-desktop', version: app.getVersion() }
      },
      INIT_TIMEOUT_MS
    )
    this.notify('notifications/initialized', {})
  }

  async listTools(): Promise<any[]> {
    await this.ready
    const all: any[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const res = await this.request('tools/list', cursor ? { cursor } : {})
      if (Array.isArray(res?.tools)) all.push(...res.tools)
      cursor = typeof res?.nextCursor === 'string' && res.nextCursor ? res.nextCursor : undefined
      pages++
    } while (cursor && pages < MAX_TOOLS_PAGES)
    return all
  }

  async callTool(
    name: string,
    args: Record<string, any>,
    timeoutMs = RPC_TIMEOUT_MS,
    signal?: AbortSignal
  ): Promise<any> {
    // 握手等待也要可被中止：否则首次冷启动的 60s 握手期间点「中止」仍会干等。
    await raceAbort(this.ready, signal)
    return this.request('tools/call', { name, arguments: args ?? {} }, timeoutMs, signal)
  }

  kill(): void {
    this.intentionalExit = true
    this.failPending(new Error('MCP 服务器已停止'))
    const pid = this.proc.pid
    if (this.exited || !pid) return
    if (process.platform === 'win32') {
      // shell 启动时 pid 是 cmd.exe，必须 /T 连同 npx→node 子进程整树杀掉，防孤儿进程残留。
      // 用异步 execFile（不是 execFileSync）：绝不在 main 线程同步等待，避免 taskkill 阻塞事件循环冻结 UI。
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { timeout: 5000 }, (err) => {
        if (err) {
          try {
            this.proc.kill()
          } catch {}
        }
      })
    } else {
      try {
        this.proc.kill('SIGTERM')
      } catch {}
      const t = setTimeout(() => {
        try {
          if (!this.exited) this.proc.kill('SIGKILL')
        } catch {}
      }, 2000)
      if (typeof t.unref === 'function') t.unref()
    }
  }

  private failPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }
}

// ---- 运行时注册表 ----

const clients = new Map<string, McpClient>()
const lastErrors = new Map<string, string>()
const startingPromises = new Map<string, Promise<McpClient>>()

function emitStatus(id: string, status: 'running' | 'stopped' | 'error', error?: string, toolsUpdated = false): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('mcp:status', { id, status, error, toolsUpdated })
    }
  }
}

function persistTools(id: string, tools: any[]): void {
  const db = getDatabase()
  db.prepare('UPDATE mcp_servers SET tools = ? WHERE id = ?').run(JSON.stringify(tools), id)
}

async function refreshToolsQuietly(id: string): Promise<void> {
  try {
    const client = clients.get(id)
    if (!client || client.exited) return
    const tools = await client.listTools()
    persistTools(id, tools)
    emitStatus(id, 'running', undefined, true)
  } catch (err) {
    console.warn(`[mcp] tools/list_changed 刷新失败 (${id}):`, err)
  }
}

/** 取就绪的客户端：已运行直接复用，否则启动 + 握手（并发调用合流，只起一个进程）。
 *  传入 signal 时，握手等待可被「中止」立即解除（但不杀共享进程，握手在后台继续，下次复用）。 */
async function ensureClient(id: string, signal?: AbortSignal): Promise<McpClient> {
  const existing = clients.get(id)
  if (existing && !existing.exited) {
    await raceAbort(existing.ready, signal)
    return existing
  }
  const inflight = startingPromises.get(id)
  if (inflight) return raceAbort(inflight, signal)

  const p = (async () => {
    const server = getMcpServer(id)
    if (!server) throw new Error('MCP 服务器不存在')
    const client = new McpClient(server)
    clients.set(id, client)
    lastErrors.delete(id)
    try {
      await client.ready
      emitStatus(id, 'running')
      return client
    } catch (err: any) {
      const detail = client.composeError(err?.message || String(err))
      client.kill()
      if (clients.get(id) === client) clients.delete(id)
      lastErrors.set(id, detail)
      emitStatus(id, 'error', detail)
      throw new Error(detail)
    }
  })()
  // 注册表清理绑定到 p 的真实生命周期（而非 await）：即便调用方因中止提前返回，
  // 仍在握手的 p 继续占用 startingPromises，保证并发合流不重复 spawn。
  startingPromises.set(id, p)
  p.then(() => {}, () => {}).finally(() => {
    if (startingPromises.get(id) === p) startingPromises.delete(id)
  })
  return raceAbort(p, signal)
}

// ---- CRUD ----

export function listMcpServers(): McpServer[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM mcp_servers ORDER BY created_at DESC').all() as any[]
  return rows.map(parseMcpServer)
}

export function getMcpServer(id: string): McpServer | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as any
  if (!row) return null
  return parseMcpServer(row)
}

export function createMcpServer(data: {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  always_load?: boolean
}): McpServer {
  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO mcp_servers (id, name, command, args, env, always_load, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    data.name,
    data.command,
    JSON.stringify(data.args || []),
    JSON.stringify(data.env || {}),
    data.always_load ? 1 : 0,
    now
  )
  return getMcpServer(id)!
}

export function updateMcpServer(
  id: string,
  data: Partial<{
    name: string
    command: string
    args: string[]
    env: Record<string, string>
    enabled: boolean
    tools: any[]
    always_load: boolean
  }>
): McpServer | null {
  const db = getDatabase()
  const existing = getMcpServer(id)
  if (!existing) return null

  db.prepare(
    'UPDATE mcp_servers SET name=?, command=?, args=?, env=?, enabled=?, tools=?, always_load=? WHERE id=?'
  ).run(
    data.name ?? existing.name,
    data.command ?? existing.command,
    JSON.stringify(data.args ?? existing.args),
    JSON.stringify(data.env ?? existing.env),
    data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled ? 1 : 0,
    JSON.stringify(data.tools ?? existing.tools),
    data.always_load !== undefined ? (data.always_load ? 1 : 0) : existing.always_load ? 1 : 0,
    id
  )
  const updated = getMcpServer(id)

  // 命令/参数/环境变量变更后旧进程跑的仍是旧配置：停掉，下次启动/调用按新配置拉起
  if (
    updated &&
    (updated.command !== existing.command ||
      JSON.stringify(updated.args) !== JSON.stringify(existing.args) ||
      JSON.stringify(updated.env) !== JSON.stringify(existing.env))
  ) {
    stopMcpServer(id)
    lastErrors.delete(id)
  }
  return updated
}

export function deleteMcpServer(id: string): boolean {
  stopMcpServer(id)
  lastErrors.delete(id)
  const db = getDatabase()
  const result = db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
  if (result.changes > 0) {
    const bots = db.prepare("SELECT id, mcp_ids FROM bots WHERE mcp_ids LIKE '%' || ? || '%'").all(id) as any[]
    for (const bot of bots) {
      const ids: string[] = safeJsonParse<string[]>(bot.mcp_ids, [])
      const filtered = ids.filter((mid: string) => mid !== id)
      if (filtered.length !== ids.length) {
        db.prepare('UPDATE bots SET mcp_ids = ? WHERE id = ?').run(JSON.stringify(filtered), bot.id)
      }
    }
  }
  return result.changes > 0
}

// ---- 生命周期 ----

/** 启动 + 握手 + 拉取工具入库。失败抛错（含 stderr 诊断信息）。 */
export async function startMcpServer(id: string): Promise<{ status: 'running'; toolCount: number }> {
  const client = await ensureClient(id)
  try {
    const tools = await client.listTools()
    persistTools(id, tools)
    return { status: 'running', toolCount: tools.length }
  } catch (err) {
    // 服务器不支持 tools 域（method not found）不算启动失败，仅记日志
    console.warn(`[mcp] 启动后拉取工具失败 (${client.serverName}):`, err)
    return { status: 'running', toolCount: getMcpServer(id)?.tools.length || 0 }
  }
}

export function stopMcpServer(id: string): boolean {
  const client = clients.get(id)
  if (!client) return false
  clients.delete(id)
  client.kill()
  emitStatus(id, 'stopped')
  return true
}

export function getMcpServerRuntime(id: string): McpRuntime {
  const server = getMcpServer(id)
  const toolCount = server?.tools.length || 0
  // 启动握手进行中：此刻 clients 里已有实例但尚未就绪，不能报 running（可能马上失败转 error）
  if (startingPromises.has(id)) return { status: 'starting', toolCount }
  const client = clients.get(id)
  if (client && !client.exited) return { status: 'running', toolCount }
  const err = lastErrors.get(id)
  if (err) return { status: 'error', error: err, toolCount }
  return { status: 'stopped', toolCount }
}

export function stopAllMcpServers(): void {
  for (const [, client] of clients) {
    client.kill()
  }
  clients.clear()
  lastErrors.clear()
}

// ---- 工具发现与调用 ----

/** 确保运行 → tools/list → 持久化。供「刷新工具」按钮 / 创建后探测使用。 */
export async function refreshMcpTools(id: string): Promise<McpServer> {
  const client = await ensureClient(id)
  const tools = await client.listTools()
  persistTools(id, tools)
  // 广播 toolsUpdated 让渲染层即时刷新缓存(与 refreshToolsQuietly 行为对齐;手动按钮多收一次推送是幂等无害)
  emitStatus(id, 'running', undefined, true)
  return getMcpServer(id)!
}

export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, any>,
  timeoutMs = RPC_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<any> {
  const client = await ensureClient(serverId, signal)
  return client.callTool(toolName, args, timeoutMs, signal)
}

/**
 * 后台预热所有 enabled 的 MCP 服务（app 启动 / 登录就绪后调用）。
 * 不阻塞、不抛错：失败仅落 error 状态（用户在 MCP 页可见），避免首次对话调用工具时
 * 才现拉起进程 + 60s 握手造成的「长时间无响应」。已在跑的服务由 ensureClient 直接复用。
 */
export function warmupEnabledMcpServers(): void {
  let servers: McpServer[]
  try {
    servers = listMcpServers().filter((s) => s.enabled)
  } catch (e) {
    console.warn('[mcp] 预热读取服务列表失败:', e)
    return
  }
  for (const server of servers) {
    // 启动成功后顺手刷一次工具表：避免首次调用走「列表为空 → 临时拉表 → 再 RPC」的串行等待
    // 首刷失败延迟 500ms 重试一次，吸收握手刚就绪后 tools/list 偶发瞬态失败；二次再失败才 warn
    ensureClient(server.id)
      .then(() => refreshMcpTools(server.id).catch(() =>
        new Promise<void>((r) => setTimeout(r, 500)).then(() =>
          refreshMcpTools(server.id).catch((e) => {
            console.warn(`[mcp] 预热刷新工具失败 (${server.name}):`, e?.message || e)
          })
        )
      ))
      .catch((e) => {
        console.warn(`[mcp] 预热启动失败 (${server.name}):`, e?.message || e)
      })
  }
}

/**
 * 把 MCP tools/call 的结果规范化为对 LLM 友好的形态：
 * - isError → { error }（chat-engine 据此计入工具失败熔断）
 * - structuredContent（2025-06 规范）优先原样返回
 * - content 数组拍平为文本（text 取正文；image/audio/resource 留类型占位说明）
 * 避免把协议包装层（content/type/annotations）原样塞给模型浪费 token 且干扰理解。
 */
export function normalizeMcpToolResult(raw: any): any {
  // 不产生空字符串：空 tool message 会被消息净化器删除，可能破坏 tool_calls 配对
  if (raw === null || raw === undefined) return '(空结果)'
  if (typeof raw !== 'object') return raw

  const flatten = (content: any[]): string =>
    content
      .map((c) => {
        if (!c || typeof c !== 'object') return String(c ?? '')
        if (c.type === 'text') return String(c.text ?? '')
        if (c.type === 'image') return `[图片内容: ${c.mimeType || 'image'}]`
        if (c.type === 'audio') return `[音频内容: ${c.mimeType || 'audio'}]`
        if (c.type === 'resource') {
          const r = c.resource || {}
          return typeof r.text === 'string' ? r.text : `[资源: ${r.uri || ''}]`
        }
        if (c.type === 'resource_link') return `[资源链接: ${c.uri || ''}]`
        return JSON.stringify(c)
      })
      .filter(Boolean)
      .join('\n')

  if (raw.isError === true) {
    const detail = Array.isArray(raw.content) ? flatten(raw.content) : ''
    return { error: detail || 'MCP 工具执行失败' }
  }
  if (raw.structuredContent !== undefined) return raw.structuredContent
  if (Array.isArray(raw.content)) {
    return flatten(raw.content) || '(空结果)'
  }
  return raw
}
