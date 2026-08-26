import { opendir, realpath, stat } from 'fs/promises'
import { extname, resolve, sep } from 'path'

const SUPPORTED_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'csv', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'pptx'
])
const DEFAULT_IGNORED_DIRS = new Set([
  '.git', '.svn', '.hg', 'node_modules', 'vendor', 'dist', 'build', 'out',
  '.cache', '.next', '.nuxt', '.vite', 'coverage'
])
const SENSITIVE_EXTENSIONS = new Set([
  'pem', 'key', 'p12', 'pfx', 'cer', 'crt', 'mobileprovision', 'provisionprofile'
])
const SENSITIVE_NAMES = new Set(['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519'])

export interface FolderScanItem {
  path: string
  relativePath: string
  size: number
  extension: string
  status: 'supported' | 'ignored' | 'oversized' | 'inaccessible'
  reason: string
}

export interface FolderScanResult {
  rootPath: string
  files: FolderScanItem[]
  counts: Record<FolderScanItem['status'], number>
  supportedBytes: number
  truncated: boolean
  warnings: string[]
}

export interface FolderScanOptions {
  maxFiles?: number
  maxDepth?: number
  maxFileBytes?: number
  maxTotalBytes?: number
}

function isInsideRoot(root: string, target: string): boolean {
  return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)
}

export async function scanKnowledgeFolder(
  folderPath: string,
  options: FolderScanOptions = {}
): Promise<FolderScanResult> {
  const maxFiles = Math.max(1, Math.min(options.maxFiles || 10_000, 100_000))
  const maxDepth = Math.max(1, Math.min(options.maxDepth || 24, 64))
  const maxFileBytes = Math.max(1, options.maxFileBytes || 50 * 1024 * 1024)
  const maxTotalBytes = Math.max(maxFileBytes, options.maxTotalBytes || 1024 * 1024 * 1024)
  const root = await realpath(resolve(folderPath))
  const rootStat = await stat(root)
  if (!rootStat.isDirectory()) throw new Error('选择的路径不是文件夹')

  const files: FolderScanItem[] = []
  const visited = new Set<string>([root])
  let supportedBytes = 0
  let truncated = false

  const add = (item: FolderScanItem) => {
    files.push(item)
    if (item.status === 'supported') supportedBytes += item.size
  }

  async function walk(dir: string, depth: number): Promise<void> {
    if (truncated) return
    if (depth > maxDepth) {
      truncated = true
      return
    }
    let handle
    try {
      handle = await opendir(dir)
      for await (const entry of handle) {
        if (files.length >= maxFiles || supportedBytes >= maxTotalBytes) {
          truncated = true
          break
        }
        const absolute = resolve(dir, entry.name)
        const relativePath = absolute.slice(root.length + 1)
        if (entry.isDirectory()) {
          if (DEFAULT_IGNORED_DIRS.has(entry.name)) continue
          try {
            const canonical = await realpath(absolute)
            if (!isInsideRoot(root, canonical) || visited.has(canonical)) continue
            visited.add(canonical)
            await walk(canonical, depth + 1)
          } catch {
            add({ path: absolute, relativePath, size: 0, extension: '', status: 'inaccessible', reason: '目录不可访问' })
          }
          continue
        }
        if (!entry.isFile()) continue

        const extension = extname(entry.name).slice(1).toLowerCase()
        if (SENSITIVE_NAMES.has(entry.name.toLowerCase()) || SENSITIVE_EXTENSIONS.has(extension)) {
          add({ path: absolute, relativePath, size: 0, extension, status: 'ignored', reason: '敏感文件默认排除' })
          continue
        }
        if (!SUPPORTED_EXTENSIONS.has(extension)) {
          add({ path: absolute, relativePath, size: 0, extension, status: 'ignored', reason: '不支持的文件格式' })
          continue
        }
        try {
          const info = await stat(absolute)
          if (info.size > maxFileBytes) {
            add({ path: absolute, relativePath, size: info.size, extension, status: 'oversized', reason: '文件超过 50 MB' })
          } else {
            add({ path: absolute, relativePath, size: info.size, extension, status: 'supported', reason: '可处理' })
          }
        } catch {
          add({ path: absolute, relativePath, size: 0, extension, status: 'inaccessible', reason: '文件不可访问' })
        }
      }
    } catch {
      add({ path: dir, relativePath: dir.slice(root.length + 1), size: 0, extension: '', status: 'inaccessible', reason: '目录不可访问' })
    }
  }

  await walk(root, 0)
  const counts: FolderScanResult['counts'] = { supported: 0, ignored: 0, oversized: 0, inaccessible: 0 }
  for (const file of files) counts[file.status]++
  return {
    rootPath: root,
    files,
    counts,
    supportedBytes,
    truncated,
    warnings: truncated ? ['扫描达到文件数、目录深度或总容量上限，结果不完整'] : []
  }
}
