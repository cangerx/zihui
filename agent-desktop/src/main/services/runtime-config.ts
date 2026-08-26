import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { nativeImage } from 'electron'

export interface RuntimeConfig {
  buildId: string
  appName: string
  appId: string
  appVersion: string
  apiDomain: string
  domain: string
  updateUrl: string
  buildMode: 'normal' | 'oem'
  oemProjectKey: string
  builtAt: string
  /** 应用图标 data URL（PNG → base64）。生产由打包流程注入；dev/缺省为空字符串，渲染端可走文字缩写 fallback */
  iconDataUrl: string
}

const DEFAULT_CONFIG: RuntimeConfig = {
  buildId: 'dev',
  appName: '好伙伴',
  appId: 'com.local-agent.app',
  appVersion: '',
  apiDomain: 'https://your-admin-domain.example.com',
  domain: 'https://your-admin-domain.example.com',
  updateUrl: 'https://your-admin-domain.example.com/updates/',
  buildMode: 'normal',
  oemProjectKey: '',
  builtAt: '',
  iconDataUrl: ''
}

let cached: RuntimeConfig | null = null

/**
 * 候选 resource 文件路径生成器：
 * 1. 生产模式：electron-builder 把 resources/ 复制到 process.resourcesPath/
 * 2. 开发模式：从 cwd 派生项目根 resources/
 * 3. fallback：从 __dirname 多级回溯（__dirname 编译后位于 out/main/）
 */
function candidatePathsFor(filename: string, extraDirs: string[] = []): string[] {
  const candidates: string[] = []
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, filename))
  }
  candidates.push(join(process.cwd(), 'resources', filename))
  candidates.push(join(__dirname, '..', '..', 'resources', filename))
  candidates.push(join(__dirname, '..', '..', '..', 'resources', filename))
  for (const d of extraDirs) {
    candidates.push(d)
  }
  return candidates
}

function tryLoadConfig(): Partial<RuntimeConfig> | null {
  for (const p of candidatePathsFor('config.json')) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf-8'))
      } catch (e) {
        console.error('[runtime-config] parse error at', p, e)
      }
    }
  }
  return null
}

/**
 * 读取应用图标并转为 data URL。优先级：
 *   1. process.resourcesPath/icon.png （生产，由 electron-builder.yml extraResources 复制）
 *   2. resources/icon.png （某些自定义打包路径）
 *   3. build/icon.png（dev 模式从项目根读）
 */
function tryLoadIconDataUrl(): string {
  const candidates = candidatePathsFor('icon.png', [
    // dev 模式：从 __dirname 回溯到项目根的 build/icon.png
    join(process.cwd(), 'build', 'icon.png'),
    join(__dirname, '..', '..', 'build', 'icon.png'),
    join(__dirname, '..', '..', '..', 'build', 'icon.png')
  ])
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const img = nativeImage.createFromPath(p)
        if (img.isEmpty()) continue
        const { width } = img.getSize()
        const out = width > 128 ? img.resize({ width: 128, height: 128 }) : img
        return out.toDataURL()
      } catch (e) {
        console.error('[runtime-config] icon read error at', p, e)
      }
    }
  }
  return ''
}

export function getRuntimeConfig(): RuntimeConfig {
  if (cached) return cached
  const fileCfg = tryLoadConfig() || {}
  const iconDataUrl = tryLoadIconDataUrl()
  cached = { ...DEFAULT_CONFIG, ...fileCfg, iconDataUrl }
  return cached
}
