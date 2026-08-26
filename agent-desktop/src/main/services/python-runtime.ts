import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { spawnSync } from 'child_process'
import { BrowserWindow } from 'electron'
import { getDeviceSetting, setDeviceSetting } from './device-settings'

const SETTING_KEY = 'python_path'
const PROBE_TIMEOUT_MS = 8000

export class PythonNotReadyError extends Error {
  reason: string
  constructor(reason: string) {
    super(reason)
    this.name = 'PythonNotReadyError'
    this.reason = reason
  }
}

export interface PythonStatus {
  ready: boolean
  path?: string
  version?: string
  hasPptx?: boolean
  reason?: string
  installUrl: string
  installHint: string
}

let cached: PythonStatus | null = null
let loginPathCache: string | null = null

export function pythonInstallUrl(): string {
  if (process.platform === 'darwin') return 'https://www.python.org/downloads/macos/'
  if (process.platform === 'win32') return 'https://www.python.org/downloads/windows/'
  return 'https://www.python.org/downloads/'
}

export function pythonInstallHint(): string {
  if (process.platform === 'darwin') {
    return '打开 python.org 下载安装包，或在终端执行 brew install python。安装完成后回到这里点「重新检测」。'
  }
  if (process.platform === 'win32') {
    return '打开 python.org 下载安装包，安装时勾选 Add python.exe to PATH。装完后点「重新检测」。'
  }
  return '请安装 Python 3.10 或更高版本，并确保 python3 在 PATH 中。装完后点「重新检测」。'
}

function quoteForShell(p: string): string {
  if (!/[\s"'&|<>^()]/.test(p)) return p
  if (process.platform === 'win32') return `"${p.replace(/"/g, '\\"')}"`
  return `'${p.replace(/'/g, `'\\''`)}'`
}

function probe(bin: string): { ok: boolean; version?: string; executable?: string; stderr?: string } {
  try {
    const r = spawnSync(bin, ['-c', 'import sys; print(sys.version.split()[0]); print(sys.executable)'], {
      timeout: PROBE_TIMEOUT_MS,
      encoding: 'utf-8',
      windowsHide: true,
      env: enrichEnv()
    })
    const out = String(r.stdout || '').trim()
    const err = String(r.stderr || '').trim()
    if (r.status !== 0 || !out) {
      return { ok: false, stderr: err || `exit ${r.status}` }
    }
    const [version, executable] = out.split(/\r?\n/).map((s) => s.trim())
    if (!version || !/^\d+\.\d+/.test(version)) return { ok: false, stderr: err || '无法读取版本' }
    // macOS 未装 CLT 时 /usr/bin/python3 是会弹窗的 stub
    if (/xcode-select|developer tools|install python/i.test(err)) return { ok: false, stderr: err }
    const exe = executable && existsSync(executable) ? executable : bin
    return { ok: true, version, executable: exe }
  } catch (e: any) {
    return { ok: false, stderr: e?.message || String(e) }
  }
}

function probePptx(bin: string): boolean {
  try {
    const r = spawnSync(bin, ['-c', 'import pptx; print(1)'], {
      timeout: PROBE_TIMEOUT_MS,
      encoding: 'utf-8',
      windowsHide: true,
      env: enrichEnv()
    })
    return r.status === 0 && String(r.stdout || '').includes('1')
  } catch {
    return false
  }
}

function whichFromLogin(bin: string): string | null {
  if (process.platform === 'win32') return null
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const r = spawnSync(shell, ['-ilc', `command -v ${bin} 2>/dev/null || true`], {
      timeout: 5000,
      encoding: 'utf-8',
      env: process.env
    })
    const line = String(r.stdout || '')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop()
    if (line && existsSync(line) && !line.includes('not found')) return line
  } catch {
    /* ignore */
  }
  return null
}

function loginPath(): string {
  if (loginPathCache !== null) return loginPathCache
  loginPathCache = ''
  if (process.platform === 'win32') return loginPathCache
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const r = spawnSync(shell, ['-ilc', 'printf %s "$PATH"'], {
      timeout: 5000,
      encoding: 'utf-8',
      env: process.env
    })
    loginPathCache = String(r.stdout || '').trim()
  } catch {
    loginPathCache = ''
  }
  return loginPathCache
}

function extraBinDirs(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const dirs: string[] = []
  if (process.platform === 'darwin') {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/homebrew/opt/python/libexec/bin')
    if (home) {
      dirs.push(join(home, '.local/bin'), join(home, 'Library/Python/3.12/bin'), join(home, 'Library/Python/3.11/bin'))
    }
  } else if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || ''
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    for (const root of [local && join(local, 'Programs', 'Python'), pf, pf86]) {
      if (!root) continue
      dirs.push(root)
      for (const ver of ['Python313', 'Python312', 'Python311', 'Python310']) {
        dirs.push(join(root, ver), join(root, ver, 'Scripts'))
      }
    }
  } else {
    dirs.push('/usr/bin', '/usr/local/bin')
    if (home) dirs.push(join(home, '.local/bin'))
  }
  return dirs
}

function readOverride(): string {
  try {
    return (getDeviceSetting(SETTING_KEY) || '').trim()
  } catch {
    return ''
  }
}

function candidateBins(): string[] {
  const out: string[] = []
  const override = readOverride()
  if (override) out.push(override)
  const envPy = (process.env.PYTHON || process.env.PYTHON3 || '').trim()
  if (envPy) out.push(envPy)
  for (const name of process.platform === 'win32' ? ['python.exe', 'python3.exe', 'python'] : ['python3', 'python']) {
    const fromLogin = whichFromLogin(name)
    if (fromLogin) out.push(fromLogin)
    out.push(name)
    for (const dir of extraBinDirs()) {
      out.push(join(dir, name))
    }
  }
  if (process.platform === 'win32') {
    // py launcher 能解析出真实 python.exe
    try {
      const r = spawnSync('py', ['-3', '-c', 'import sys; print(sys.executable)'], {
        timeout: PROBE_TIMEOUT_MS,
        encoding: 'utf-8',
        windowsHide: true
      })
      const exe = String(r.stdout || '').trim().split(/\r?\n/)[0]
      if (exe && existsSync(exe)) out.unshift(exe)
    } catch {
      /* ignore */
    }
  }
  return [...new Set(out.filter(Boolean))]
}

export function enrichEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const sep = process.platform === 'win32' ? ';' : ':'
  const dirs = extraBinDirs()
  if (cached?.path) dirs.unshift(dirname(cached.path))
  const merged = [...dirs, loginPath(), base.PATH || base.Path || '']
    .filter(Boolean)
    .join(sep)
  const env: NodeJS.ProcessEnv = { ...base, PATH: merged }
  if (process.platform === 'win32') (env as NodeJS.ProcessEnv & { Path?: string }).Path = merged
  if (cached?.path) env.PYTHON = cached.path
  return env
}

function buildStatus(ready: boolean, extra: Partial<PythonStatus> = {}): PythonStatus {
  return {
    ready,
    installUrl: pythonInstallUrl(),
    installHint: pythonInstallHint(),
    ...extra
  }
}

export function detectPython(force = false): PythonStatus {
  if (!force && cached) return cached
  const candidates = candidateBins()
  for (const bin of candidates) {
    if (bin.includes('/') || bin.includes('\\')) {
      if (!existsSync(bin)) continue
    }
    const p = probe(bin)
    if (!p.ok || !p.executable) continue
    cached = buildStatus(true, {
      path: p.executable,
      version: p.version,
      hasPptx: probePptx(p.executable)
    })
    return cached
  }
  cached = buildStatus(false, { reason: '未检测到可用的 Python 3。生成 PPT 等 Skill 脚本需要本机 Python。' })
  return cached
}

export function setPythonPath(filePath: string): PythonStatus {
  const p = String(filePath || '').trim()
  if (!p || !existsSync(p)) {
    return buildStatus(false, { reason: '所选文件不存在' })
  }
  const probed = probe(p)
  if (!probed.ok || !probed.executable) {
    return buildStatus(false, { reason: probed.stderr || '无法运行该解释器，请选择 python 可执行文件' })
  }
  try {
    setDeviceSetting(SETTING_KEY, probed.executable)
  } catch (e: any) {
    return buildStatus(false, { reason: e?.message || '无法保存路径' })
  }
  cached = buildStatus(true, {
    path: probed.executable,
    version: probed.version,
    hasPptx: probePptx(probed.executable)
  })
  return cached
}

export function clearPythonOverride(): PythonStatus {
  try {
    setDeviceSetting(SETTING_KEY, '')
  } catch {
    /* ignore */
  }
  cached = null
  return detectPython(true)
}

export function pythonPromptText(): string {
  const st = detectPython()
  if (st.ready && st.path) {
    const pptx = st.hasPptx
      ? 'python-pptx 已安装'
      : `python-pptx 未安装，生成可编辑 PPT 前请先执行 ${quoteForShell(st.path)} -m pip install python-pptx`
    return (
      `[Python 解释器]: ${st.path}\n` +
      `- 版本: ${st.version || '未知'}\n` +
      `- 运行 Python 脚本（含 PPT Skill）必须使用该绝对路径，不要写 python / python3（应用启动后 PATH 可能找不到它们）\n` +
      `- ${pptx}`
    )
  }
  return (
    `[Python 解释器]: 未安装\n` +
    `- 生成 PPT 等依赖 Python 的脚本当前不可用。已提示用户安装 Python 3。\n` +
    `- 在用户完成安装前，不要调用 python / python3，改为说明需要先安装 Python。`
  )
}

export function looksLikePythonCommand(cmd: string): boolean {
  const s = String(cmd || '')
  return /(^|&&|\|\||;|\n|\|)(\s*)(python3?|py)(\.exe)?(\s|$)/i.test(s)
}

export function rewritePythonCommand(cmd: string): string {
  const st = detectPython()
  if (!st.ready || !st.path) return cmd
  const quoted = quoteForShell(st.path)
  return String(cmd || '').replace(
    /(^|&&|\|\||;|\n|\|)(\s*)(python3?|py)(\.exe)?(?=\s|$)/gi,
    (_m, lead, ws) => `${lead}${ws}${quoted}`
  )
}

export function notifyPythonRequired(reason?: string): void {
  const st = detectPython()
  const payload = {
    reason: reason || st.reason || '未检测到 Python',
    installUrl: st.installUrl,
    installHint: st.installHint
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('python:required', payload)
    }
  }
}

export function ensurePython(): PythonStatus {
  const st = detectPython()
  if (!st.ready) notifyPythonRequired(st.reason)
  return st
}
