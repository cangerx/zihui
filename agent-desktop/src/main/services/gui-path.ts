import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'

/**
 * Electron 从程序坞 / 开始菜单启动时 PATH 通常只有系统目录，
 * 看不到 Homebrew / nvm / 官方 Node 安装路径。MCP 的 npx、yt-dlp 等同理。
 */

let loginPathCache: string | null = null

function pushNvmBins(dirs: string[], home: string): void {
  const root = join(home, '.nvm', 'versions', 'node')
  if (!existsSync(root)) return
  try {
    for (const ver of readdirSync(root)) {
      const bin = join(root, ver, 'bin')
      if (existsSync(bin)) dirs.push(bin)
    }
  } catch {
    /* ignore */
  }
}

function extraBinDirs(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const dirs: string[] = []
  if (process.platform === 'darwin') {
    const prefix = process.env.HOMEBREW_PREFIX
    if (prefix) dirs.push(join(prefix, 'bin'))
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin')
    if (home) {
      dirs.push(
        join(home, '.local/bin'),
        join(home, '.volta/bin'),
        join(home, '.asdf/shims'),
        join(home, '.npm-global/bin'),
        join(home, '.fnm', 'aliases', 'default', 'bin'),
        join(home, 'Library/Application Support/fnm/aliases/default/bin')
      )
      pushNvmBins(dirs, home)
    }
  } else if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    const local = process.env.LOCALAPPDATA || ''
    const roaming = process.env.APPDATA || ''
    dirs.push(join(pf, 'nodejs'))
    if (local) dirs.push(join(local, 'Programs', 'nodejs'), join(local, 'fnm'))
    if (roaming) dirs.push(join(roaming, 'npm'), join(roaming, 'nvm'))
  } else {
    dirs.push('/usr/bin', '/usr/local/bin')
    if (home) {
      dirs.push(join(home, '.local/bin'), join(home, '.volta/bin'), join(home, '.asdf/shims'))
      pushNvmBins(dirs, home)
    }
  }
  return [...new Set(dirs.filter((d) => d && existsSync(d)))]
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
    const lines = String(r.stdout || '')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
    loginPathCache = lines.pop() || ''
  } catch {
    loginPathCache = ''
  }
  return loginPathCache
}

export function enrichGuiEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const sep = process.platform === 'win32' ? ';' : ':'
  const merged = [...extraBinDirs(), loginPath(), base.PATH || base.Path || '']
    .filter(Boolean)
    .join(sep)
  const env: NodeJS.ProcessEnv = { ...base, PATH: merged }
  if (process.platform === 'win32') (env as NodeJS.ProcessEnv & { Path?: string }).Path = merged
  return env
}

function wellKnownCommandCandidates(command: string): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const dirs = extraBinDirs()
  if (process.platform === 'darwin') {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin')
    if (home) {
      dirs.push(
        join(home, '.fnm', 'aliases', 'default', 'bin'),
        join(home, 'Library/Application Support/fnm/aliases/default/bin')
      )
    }
  }
  const exts = process.platform === 'win32' ? ['', '.cmd', '.exe', '.bat'] : ['']
  const out: string[] = []
  for (const dir of [...new Set(dirs)]) {
    for (const ext of exts) out.push(join(dir, command + ext))
  }
  return out
}

function whichViaLoginShell(command: string): string {
  if (process.platform === 'win32') return ''
  if (!/^[A-Za-z0-9._+-]+$/.test(command)) return ''
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const r = spawnSync(shell, ['-ilc', `command -v ${command} 2>/dev/null || true`], {
      timeout: 5000,
      encoding: 'utf-8',
      env: process.env
    })
    const line = String(r.stdout || '')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop() || ''
    if (line && existsSync(line) && !line.includes('not found')) return line
  } catch {
    /* ignore */
  }
  return ''
}

export function resolveOnPath(command: string, env: NodeJS.ProcessEnv): string {
  if (!command) return command
  if (command.includes('/') || command.includes('\\')) return command
  if (process.platform === 'win32' && /^[A-Za-z]:/.test(command)) return command
  const sep = process.platform === 'win32' ? ';' : ':'
  const pathEnv = String(env.PATH || env.Path || '')
  const exts = process.platform === 'win32' ? ['', '.cmd', '.exe', '.bat'] : ['']
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue
    for (const ext of exts) {
      const cand = join(dir, command + ext)
      if (existsSync(cand)) return cand
    }
  }
  for (const cand of wellKnownCommandCandidates(command)) {
    if (existsSync(cand)) return cand
  }
  return whichViaLoginShell(command) || command
}

export function commandNotFoundHint(command: string): string {
  const name = command || '该命令'
  const found = wellKnownCommandCandidates(name).find((p) => existsSync(p))
  if (found) {
    return `找不到「${name}」：从程序坞打开时 PATH 里没有它。请把命令改成：${found}`
  }
  if (process.platform === 'darwin') {
    return `找不到「${name}」。从程序坞打开时看不到终端里的 Node。请先安装 Node.js（终端执行 brew install node），装完后完全退出再打开；或把命令改成绝对路径。`
  }
  if (process.platform === 'win32') {
    return `找不到「${name}」。请安装 Node.js 并勾选加入 PATH，装完后重新打开应用；或把命令改成绝对路径。`
  }
  return `找不到「${name}」。请确认已安装并位于 PATH 中。`
}
