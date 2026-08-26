import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, rmdirSync, renameSync, copyFileSync, appendFileSync } from 'fs'
import { join, resolve, basename, dirname, extname, isAbsolute, relative } from 'path'
import { exec, execSync } from 'child_process'
import { createContext, runInContext } from 'vm'
import { getSetting } from './settings'
import { getDataDir } from './data-path'
import { enrichEnv, looksLikePythonCommand, rewritePythonCommand } from './python-runtime'

export interface SkillExecutionResult {
  success: boolean
  result?: any
  error?: string
  duration: number
}

const DEFAULT_TIMEOUT_MS = 180000

const DANGEROUS_PATTERNS = [
  /rm\s+(-rf?|--recursive)\s+[\/\\]/i,
  /format\s+[a-z]:/i,
  /del\s+[\/\\]/i,
  /rmdir\s+[\/\\]/i,
  /shutdown/i,
  /reg\s+(delete|add)/i,
  /net\s+(user|stop)/i
]

/**
 * Unified path resolver.
 * - null/''/'.'  -> sandboxRoot (workspace root) if provided, else cwd
 * - absolute     -> resolve(p) as-is (respect explicit intent, e.g. skill resources)
 * - relative     -> resolve(sandboxRoot, p) when sandboxRoot present; else resolve(p)
 */
export function resolveInWorkspace(p: string | undefined | null, sandboxRoot?: string): string {
  if (sandboxRoot) {
    const root = resolve(sandboxRoot)
    if (!p || p === '.' || p === './' || p === '.\\') return root
    if (isAbsolute(p)) return resolve(p)
    return resolve(root, p)
  }
  return resolve(p || '.')
}

// 读路径白名单:用户在设置中预授权的可信目录(与对话层审批白名单统一)。
function getSkillTrustedReadDirs(): string[] {
  try {
    const raw = getSetting('trusted_read_dirs')
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => resolve(x))
  } catch {
    return []
  }
}

function isWithinDir(child: string, parent: string): boolean {
  if (!child || !parent) return false
  const c = process.platform === 'win32' ? child.toLowerCase() : child
  const p = process.platform === 'win32' ? parent.toLowerCase() : parent
  const rel = relative(p, c)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

// 读路径收口:技能只能读取「应用数据目录(含工作区/技能资源)∪ 工作区 ∪ 用户预授权可信目录」，
// 越界(如系统敏感文件)直接拒绝，堵住"技能偷读任意文件"的越权风险。
// unrestricted=true(脱离沙箱白名单工具)时跳过收口，允许读取任意路径。
function validateReadPath(p: string, sandboxRoot?: string, unrestricted?: boolean): string {
  const resolved = resolveInWorkspace(p, sandboxRoot)
  if (unrestricted) return resolved
  const allowed: string[] = []
  try {
    allowed.push(resolve(getDataDir()))
  } catch {
    /* getDataDir 不可用时跳过,仍受 sandboxRoot/白名单约束 */
  }
  if (sandboxRoot) allowed.push(resolve(sandboxRoot))
  for (const dir of getSkillTrustedReadDirs()) allowed.push(dir)
  for (const dir of allowed) {
    if (dir && isWithinDir(resolved, dir)) return resolved
  }
  throw new Error(`Read denied: "${resolved}" 在允许目录之外（工作区/应用数据目录/可信目录）`)
}

// 写路径收口:技能只能写入工作区内。unrestricted=true 时放开，允许写任意路径。
function validateWritePath(p: string, sandboxRoot?: string, unrestricted?: boolean): string {
  const resolved = resolveInWorkspace(p, sandboxRoot)
  if (unrestricted) return resolved
  if (sandboxRoot) {
    const normalizedRoot = resolve(sandboxRoot)
    if (!resolved.startsWith(normalizedRoot)) {
      throw new Error(`Write denied: path "${resolved}" is outside workspace "${normalizedRoot}"`)
    }
  }
  return resolved
}

function validateCommand(cmd: string, unrestricted?: boolean): void {
  if (unrestricted) return
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(cmd)) {
      throw new Error(`Blocked dangerous command: ${cmd}`)
    }
  }
}

function createFileOps(sandboxRoot?: string, unrestricted?: boolean) {
  return {
    readFile: (p: string, encoding?: string) => readFileSync(validateReadPath(p, sandboxRoot, unrestricted), (encoding || 'utf-8') as BufferEncoding),
    writeFile: (p: string, content: string, encoding?: string) => {
      const vp = validateWritePath(p, sandboxRoot, unrestricted)
      mkdirSync(dirname(vp), { recursive: true })
      writeFileSync(vp, content, (encoding || 'utf-8') as BufferEncoding)
      return true
    },
    appendFile: (p: string, content: string) => {
      appendFileSync(validateWritePath(p, sandboxRoot, unrestricted), content, 'utf-8')
      return true
    },
    listDir: (p: string) => {
      const dir = validateReadPath(p, sandboxRoot, unrestricted)
      return readdirSync(dir, { withFileTypes: true }).map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        size: e.isDirectory() ? 0 : statSync(join(dir, e.name)).size
      }))
    },
    mkdir: (p: string) => { mkdirSync(validateWritePath(p, sandboxRoot, unrestricted), { recursive: true }); return true },
    exists: (p: string) => existsSync(validateReadPath(p, sandboxRoot, unrestricted)),
    stat: (p: string) => {
      const s = statSync(validateReadPath(p, sandboxRoot, unrestricted))
      return { size: s.size, isDirectory: s.isDirectory(), isFile: s.isFile(), mtime: s.mtime.toISOString() }
    },
    deleteFile: (p: string) => { unlinkSync(validateWritePath(p, sandboxRoot, unrestricted)); return true },
    deleteDir: (p: string) => { rmdirSync(validateWritePath(p, sandboxRoot, unrestricted), { recursive: true } as any); return true },
    rename: (from: string, to: string) => { renameSync(validateWritePath(from, sandboxRoot, unrestricted), validateWritePath(to, sandboxRoot, unrestricted)); return true },
    copyFile: (from: string, to: string) => {
      const vTo = validateWritePath(to, sandboxRoot, unrestricted)
      mkdirSync(dirname(vTo), { recursive: true })
      copyFileSync(validateReadPath(from, sandboxRoot, unrestricted), vTo)
      return true
    },
    join: (...parts: string[]) => join(...parts),
    resolve: (...parts: string[]) => resolve(...parts),
    wsResolve: (p: string) => resolveInWorkspace(p, sandboxRoot),
    basename: (p: string) => basename(p),
    dirname: (p: string) => dirname(p),
    extname: (p: string) => extname(p)
  }
}

function resolveShellCwd(cwd: string | undefined, sandboxRoot?: string): string | undefined {
  if (!cwd) return sandboxRoot
  return resolveInWorkspace(cwd, sandboxRoot)
}

function resolveTimeout(timeoutMs?: number): number {
  return Number.isFinite(timeoutMs) && Number(timeoutMs) > 0
    ? Math.max(1, Math.floor(Number(timeoutMs)))
    : DEFAULT_TIMEOUT_MS
}

function createShellOps(sandboxRoot?: string, timeoutMs?: number, unrestricted?: boolean, signal?: AbortSignal) {
  const defaultTimeout = resolveTimeout(timeoutMs)
  return {
    exec: (cmd: string, options?: { cwd?: string; timeout?: number }) => {
      validateCommand(cmd, unrestricted)
      const requestedTimeout = resolveTimeout(options?.timeout)
      const resolvedCmd = looksLikePythonCommand(cmd) ? rewritePythonCommand(cmd) : cmd
      const result = execSync(resolvedCmd, {
        cwd: resolveShellCwd(options?.cwd, sandboxRoot),
        timeout: Math.max(1, Math.min(requestedTimeout, defaultTimeout)),
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
        env: enrichEnv()
      })
      return result
    },
    // 异步执行：用 child_process.exec（回调式）替代 execSync，避免命令运行期间
    // （最长可达 180s）阻塞 Electron 主进程事件循环导致整个 App / 全部会话冻结。
    // 返回 Promise，RUN_COMMAND_IMPL 已改为 await 调用；executeSkillSandbox 的
    // Promise.race 超时此时也真正生效（同步 execSync 下 race 形同虚设）。
    // signal 贯穿：取消时 exec 的 signal 选项会 kill 子进程（Windows 为 TerminateProcess，
    // 不保证杀子进程树），调用方随 executeSkillSandbox 的 abort 赛跑立即释放
    execStructured: (cmd: string, options?: { cwd?: string; timeout?: number }): Promise<{
      exit_code: number
      stdout: string
      stderr: string
      ok: boolean
      timed_out?: boolean
    }> => {
      validateCommand(cmd, unrestricted)
      const requestedTimeout = resolveTimeout(options?.timeout)
      const timeout = Math.max(1, Math.min(requestedTimeout, defaultTimeout))
      const resolvedCmd = looksLikePythonCommand(cmd) ? rewritePythonCommand(cmd) : cmd
      return new Promise((resolve) => {
        exec(
          resolvedCmd,
          {
            cwd: resolveShellCwd(options?.cwd, sandboxRoot),
            timeout,
            encoding: 'utf-8',
            maxBuffer: 2 * 1024 * 1024,
            windowsHide: true,
            env: enrichEnv(),
            ...(signal ? { signal } : {})
          },
          (err: any, stdout: string, stderr: string) => {
            if (err) {
              // err.code 为退出码(number)；超时被 kill 时 err.killed=true、err.signal 有值
              const timedOut = !!err.killed || err.signal === 'SIGTERM'
              resolve({
                exit_code: typeof err.code === 'number' ? err.code : 1,
                stdout: (stdout || '').slice(0, 8000),
                stderr: ((stderr || err.message || '').toString()).slice(0, 4000),
                ok: false,
                ...(timedOut ? { timed_out: true } : {})
              })
            } else {
              resolve({
                exit_code: 0,
                stdout: (stdout || '').slice(0, 10000),
                stderr: (stderr || '').slice(0, 4000),
                ok: true
              })
            }
          }
        )
      })
    }
  }
}

export async function executeSkillSandbox(
  implementation: string,
  args: Record<string, any>,
  sandboxRoot?: string,
  timeoutMs?: number,
  unrestricted?: boolean,
  signal?: AbortSignal
): Promise<SkillExecutionResult> {
  const t0 = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const fileOps = createFileOps(sandboxRoot, unrestricted)
    const executionTimeout = resolveTimeout(timeoutMs)
    const shellOps = createShellOps(sandboxRoot, executionTimeout, unrestricted, signal)

    // 在受限 vm context 中执行技能代码,隔离主进程 process / require / module / global 等,
    // 仅暴露白名单能力(args / fs / shell / fetch / crypto + 常用 Web/Node 全局)。相比 new Function:
    // 1) 逃逸(constructor 链)只能到达本 vm context 的受限 global，拿不到主进程 process；
    // 2) runInContext 的 timeout 能中断纯同步死循环(new Function 同步死循环会冻结整个主进程)。
    const sandboxGlobals: Record<string, any> = {
      args,
      fs: fileOps,
      shell: shellOps,
      fetch: globalThis.fetch,
      Headers: (globalThis as any).Headers,
      Request: (globalThis as any).Request,
      Response: (globalThis as any).Response,
      FormData: (globalThis as any).FormData,
      Blob: (globalThis as any).Blob,
      AbortController: globalThis.AbortController,
      AbortSignal: globalThis.AbortSignal,
      crypto: globalThis.crypto,
      console,
      Buffer,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      btoa: (globalThis as any).btoa,
      atob: (globalThis as any).atob,
      structuredClone: (globalThis as any).structuredClone
    }
    const context = createContext(sandboxGlobals)
    const wrappedCode = `(async () => {\n${implementation}\n})()`
    const resultPromise = runInContext(wrappedCode, context, { timeout: executionTimeout })

    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`执行超时 (${executionTimeout}ms)`)), executionTimeout)
    })

    // abort 赛跑：取消时立即释放等待（vm 内纯 JS 无法强杀，但 shell.exec 子进程经 signal 被杀，
    // 调用方不再阻塞至自然超时——此前点「停止」后最长还要等 180s）
    const abortPromise = new Promise<never>((_, reject) => {
      if (!signal) return
      if (signal.aborted) {
        reject(new Error('已中止'))
        return
      }
      signal.addEventListener('abort', () => reject(new Error('已中止')), { once: true })
    })

    const result = await Promise.race([resultPromise, timeoutPromise, abortPromise])
    const duration = Date.now() - t0

    return { success: true, result, duration }
  } catch (err: any) {
    const duration = Date.now() - t0
    return { success: false, error: err.message || String(err), duration }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
