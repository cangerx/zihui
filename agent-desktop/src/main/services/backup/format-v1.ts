import { app } from 'electron'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync
} from 'fs'
import { dirname, join, basename, isAbsolute, relative, resolve as pathResolve } from 'path'
import { createHash } from 'crypto'
import * as yazl from 'yazl'
import * as yauzl from 'yauzl'
import { getDataDir } from '../data-path'
import { getDatabase } from '../../database'
import { sha256File } from './checksum'
import { getBackupDir, getStagingDir, timestamp, safeRemove, ensureFreeSpace } from './staging'
import type {
  AbortToken,
  BackupInfo,
  BackupType,
  ManifestV1,
  ManifestFile,
  ProgressEvent
} from './types'

/**
 * v1 备份格式：标准 ZIP，根目录下：
 *   manifest.json    第一个 entry，含元数据 + 每个文件的 sha256
 *   data/...         数据目录的镜像（不含 backups/、data-path.json、wal/shm）
 *
 * 设计要点：
 * - 流式读写，恒定内存
 * - 每文件 sha256 存进 manifest，恢复时逐个校验
 * - .partial 文件 + 同卷 rename 实现原子化（中断不会留下半成品 .zip）
 * - manifest 第一个 entry，恢复前可单独读取做兼容性预检
 */

// 备份时跳过的根级条目（防止把 backups/ 自己塞进备份，data-path.json 不该跨机迁移）
// 账号隔离：legacy 原地账号（getDataDir=root）的 full 备份必须排除其他账号目录与设备级文件，
// 否则会把别的账号数据打进本账号备份（隐私泄漏 + 体积膨胀）。与 staging.RESTORE_PRESERVE_ROOTS 对称。
// 新账号目录（accounts/acc-id）内本就无这些条目，排除无副作用。
const EXCLUDE_ROOT_ENTRIES = new Set([
  'backups',
  'node_modules',
  'data-path.json',
  'accounts',
  'account-map.json',
  'device-settings.json',
  'device-id.txt'
])
// 备份时跳过的文件扩展名（SQLite WAL/SHM 是临时文件，含未 checkpoint 的脏页，备份后无意义且会污染恢复）
const EXCLUDE_EXTS = new Set(['.db-wal', '.db-shm', '.db-journal'])
// zip 内部前缀，恢复时 strip 掉得到 dataDir 内的相对路径
const DATA_PREFIX = 'data/'
const MANIFEST_NAME = 'manifest.json'

interface FileSpec {
  /** dataDir 内的相对路径，使用 / 分隔 */
  relPath: string
  /** 磁盘上的绝对路径（一般是 dataDir + relPath，db 是 snapshot） */
  absPath: string
  size: number
}

function hasExcludedExt(name: string): boolean {
  const lower = name.toLowerCase()
  for (const ext of EXCLUDE_EXTS) {
    if (lower.endsWith(ext)) return true
  }
  return false
}

/**
 * 收集 dataDir 下所有应入备份的文件。
 * type='auto' 仅返回 db 文件；type='full' 返回全部。
 */
function collectDataFiles(dataDir: string, type: BackupType): FileSpec[] {
  if (type === 'auto') {
    const dbPath = join(dataDir, 'local-agent.db')
    if (!existsSync(dbPath)) return []
    return [{ relPath: 'local-agent.db', absPath: dbPath, size: statSync(dbPath).size }]
  }

  const out: FileSpec[] = []
  function walk(dir: string, base: string): void {
    if (!existsSync(dir)) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      // 顶层排除
      if (!base && EXCLUDE_ROOT_ENTRIES.has(entry)) continue
      if (hasExcludedExt(entry)) continue
      const full = join(dir, entry)
      const rel = base ? base + '/' + entry : entry
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full, rel)
      } else {
        out.push({ relPath: rel, absPath: full, size: st.size })
      }
    }
  }
  walk(dataDir, '')
  return out
}

/**
 * 创建 v1 zip 备份。
 *
 * 流程：
 *   1. SQLite online backup 到 staging/<uuid>.db（一致性快照）
 *   2. 收集文件清单，逐个流式算 sha256
 *   3. 构建 manifest，写入 zip 第一个 entry
 *   4. 逐个 addFile 流式入 zip
 *   5. zip pipe 到 .partial → 关闭后 atomic rename → .zip
 *   6. finally 清理临时 db snapshot
 */
export async function packV1(
  type: BackupType,
  abortToken: AbortToken,
  onProgress?: (e: ProgressEvent) => void
): Promise<BackupInfo> {
  const dataDir = getDataDir()
  const backupDir = getBackupDir()
  const stagingDir = getStagingDir()
  const ts = timestamp()
  const fileName = `backup-${type === 'full' ? 'full' : 'db'}-${ts}.zip`
  const finalPath = join(backupDir, fileName)
  const partialPath = join(stagingDir, fileName + '.partial')
  const dbSnapshotPath = join(stagingDir, `_snapshot-${ts}.db`)

  let dbSnapshotCreated = false
  let partialCreated = false

  try {
    abortToken.throwIfAborted()

    // 0. 磁盘空间预检（快照需要 ~db 大小的空间，先于 db.backup 早失败）
    const dbPathForSize = join(dataDir, 'local-agent.db')
    const dbSizeForCheck = existsSync(dbPathForSize) ? statSync(dbPathForSize).size : 0
    ensureFreeSpace(stagingDir, dbSizeForCheck)

    // 1. SQLite 一致性快照（无论 auto 还是 full 都走 db.backup，保证 db 一致性）
    onProgress?.({ phase: 'snapshot', current: 0, total: 1, fileName: 'local-agent.db' })
    const db = getDatabase()
    await db.backup(dbSnapshotPath)
    dbSnapshotCreated = true
    onProgress?.({ phase: 'snapshot', current: 1, total: 1, fileName: 'local-agent.db' })

    abortToken.throwIfAborted()

    // 2. 收集文件清单
    const files = collectDataFiles(dataDir, type)
    // 把 db 文件替换成 snapshot 路径
    const dbIdx = files.findIndex((f) => f.relPath === 'local-agent.db')
    if (dbIdx >= 0) {
      files[dbIdx] = {
        relPath: 'local-agent.db',
        absPath: dbSnapshotPath,
        size: statSync(dbSnapshotPath).size
      }
    } else if (type === 'auto') {
      throw new Error('数据库文件不存在')
    }

    // 3. 流式计算每个文件 sha256（构建 manifest）
    const manifestFiles: ManifestFile[] = []
    let totalSize = 0
    for (let i = 0; i < files.length; i++) {
      abortToken.throwIfAborted()
      const f = files[i]
      onProgress?.({
        phase: 'pack',
        current: i,
        total: files.length,
        fileName: f.relPath
      })
      const sha = await sha256File(f.absPath)
      manifestFiles.push({ path: DATA_PREFIX + f.relPath, size: f.size, sha256: sha })
      totalSize += f.size
    }

    const manifest: ManifestV1 = {
      formatVersion: 1,
      appVersion: app.getVersion(),
      type,
      createdAt: new Date().toISOString(),
      platform: process.platform,
      files: manifestFiles,
      totalSize
    }

    // 4. 写 zip（预检：worst-case 未压缩 totalSize 的空间）
    abortToken.throwIfAborted()
    ensureFreeSpace(stagingDir, totalSize)
    await writeZip(partialPath, manifest, files, abortToken, onProgress)
    partialCreated = true

    // 5. atomic rename .partial → .zip（同卷必然原子）
    if (existsSync(finalPath)) {
      // 极罕见：同毫秒重复触发，覆盖之
      unlinkSync(finalPath)
    }
    renameSync(partialPath, finalPath)
    partialCreated = false

    const stat = statSync(finalPath)
    const info: BackupInfo = {
      fileName,
      type,
      size: stat.size,
      createdAt: manifest.createdAt,
      appVersion: manifest.appVersion,
      format: 'v1'
    }
    return info
  } finally {
    if (dbSnapshotCreated) safeRemove(dbSnapshotPath)
    if (partialCreated) safeRemove(partialPath)
  }
}

function writeZip(
  partialPath: string,
  manifest: ManifestV1,
  files: FileSpec[],
  abortToken: AbortToken,
  onProgress?: (e: ProgressEvent) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile()
    const out = createWriteStream(partialPath)
    let settled = false

    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      out.destroy()
      reject(err)
    }

    out.on('error', fail)
    out.on('finish', () => {
      if (settled) return
      settled = true
      resolve()
    })

    // 任何 zip 内部错误也走 fail
    ;(zip.outputStream as NodeJS.ReadableStream).on('error', fail)
    zip.outputStream.pipe(out)

    try {
      // manifest 作为第一个 entry，恢复前可只读这一个就拿到全量元信息
      const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8')
      zip.addBuffer(manifestBuf, MANIFEST_NAME, { mtime: new Date(manifest.createdAt) })

      // 顺序加入每个文件。yazl 是惰性的，end() 后才开始真正读 + 压缩 + 写
      for (let i = 0; i < files.length; i++) {
        if (abortToken.isAborted()) {
          fail(new Error('备份已取消'))
          return
        }
        const f = files[i]
        zip.addFile(f.absPath, DATA_PREFIX + f.relPath)
        onProgress?.({
          phase: 'pack',
          current: i + 1,
          total: files.length,
          fileName: f.relPath
        })
      }
      zip.end()
    } catch (e: any) {
      fail(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

/**
 * 读取 v1 zip 中的 manifest，不解压数据。
 * 用于恢复前的兼容性预检 + UI 展示。
 */
export function readManifestV1(zipPath: string): Promise<ManifestV1> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipFile) => {
      if (err) return reject(err)
      let resolved = false
      const finishWith = (mfst: ManifestV1 | null, error?: Error): void => {
        if (resolved) return
        resolved = true
        try {
          zipFile.close()
        } catch {}
        if (error) reject(error)
        else if (mfst) resolve(mfst)
        else reject(new Error('备份文件中没有 manifest.json'))
      }

      zipFile.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== MANIFEST_NAME) {
          zipFile.readEntry()
          return
        }
        zipFile.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) return finishWith(null, e2 || new Error('manifest 读取失败'))
          const chunks: Buffer[] = []
          stream.on('data', (c: Buffer) => chunks.push(c))
          stream.on('error', (er) => finishWith(null, er))
          stream.on('end', () => {
            try {
              const json = Buffer.concat(chunks).toString('utf-8')
              const m = JSON.parse(json) as ManifestV1
              if (m.formatVersion !== 1 || !Array.isArray(m.files)) {
                throw new Error('manifest 格式不合法')
              }
              finishWith(m)
            } catch (er: any) {
              finishWith(null, er instanceof Error ? er : new Error(String(er)))
            }
          })
        })
      })
      zipFile.on('end', () => finishWith(null))
      zipFile.on('error', (er) => finishWith(null, er))
      zipFile.readEntry()
    })
  })
}

/**
 * 把 v1 zip 解压到 destDir，逐个文件流式校验 sha256。
 * destDir 应是 .restore-staging-<ts>/ 或最终 dataDir，调用方决定。
 */
export function extractV1(
  zipPath: string,
  destDir: string,
  abortToken: AbortToken,
  onProgress?: (e: ProgressEvent) => void
): Promise<ManifestV1> {
  return new Promise((resolve, reject) => {
    // 先单独读 manifest，不在主流程里和数据 entry 交错，避免 yauzl 状态机复杂化
    readManifestV1(zipPath)
      .then((manifest) => {
        const fileMap = new Map<string, ManifestFile>()
        for (const f of manifest.files) fileMap.set(f.path, f)

        yauzl.open(zipPath, { lazyEntries: true }, (err, zipFile) => {
          if (err) return reject(err)
          let processed = 0
          const total = manifest.files.length
          let settled = false

          const fail = (e: Error): void => {
            if (settled) return
            settled = true
            try {
              zipFile.close()
            } catch {}
            reject(e)
          }
          const done = (): void => {
            if (settled) return
            settled = true
            try {
              zipFile.close()
            } catch {}
            resolve(manifest)
          }

          zipFile.on('error', fail)
          zipFile.on('end', () => {
            if (processed !== total) {
              fail(
                new Error(
                  `备份文件不完整：manifest 声明 ${total} 个文件，实际解压 ${processed} 个`
                )
              )
              return
            }
            done()
          })

          zipFile.on('entry', (entry: yauzl.Entry) => {
            if (settled) return
            if (abortToken.isAborted()) {
              fail(new Error('恢复已取消'))
              return
            }
            // 跳过 manifest（已读过）和目录 entry
            if (entry.fileName === MANIFEST_NAME) {
              zipFile.readEntry()
              return
            }
            if (/\/$/.test(entry.fileName)) {
              zipFile.readEntry()
              return
            }

            const expected = fileMap.get(entry.fileName)
            if (!expected) {
              // manifest 没记录的额外 entry：跳过但记录警告
              console.warn('[backup] zip entry not in manifest:', entry.fileName)
              zipFile.readEntry()
              return
            }
            // 路径越界检查（zip-slip 防护）：
            //   1. 必须以 data/ 开头（防止覆盖 backups/、data-path.json）
            //   2. 不含 .. 段、不是绝对路径或带盘符、不是 UNC 路径
            //   3. 兜底用 path.relative 判断解析后的路径是否仍在 destDir 子树内
            if (!entry.fileName.startsWith(DATA_PREFIX)) {
              fail(new Error(`非法 zip 路径: ${entry.fileName}`))
              return
            }
            const relPath = entry.fileName.substring(DATA_PREFIX.length)
            if (
              !relPath ||
              relPath.split(/[\\/]/).includes('..') ||
              isAbsolute(relPath) ||
              /^[a-z]:[\\/]/i.test(relPath) ||
              relPath.startsWith('\\\\')
            ) {
              fail(new Error(`非法 zip 路径: ${entry.fileName}`))
              return
            }
            const destPath = pathResolve(destDir, relPath)
            const rel = relative(pathResolve(destDir), destPath)
            if (rel.startsWith('..') || isAbsolute(rel) || rel === '') {
              fail(new Error(`zip 路径解析后越界: ${entry.fileName}`))
              return
            }
            try {
              mkdirSync(dirname(destPath), { recursive: true })
            } catch (e: any) {
              fail(e instanceof Error ? e : new Error(String(e)))
              return
            }

            zipFile.openReadStream(entry, (e2, readStream) => {
              if (e2 || !readStream) {
                fail(e2 || new Error(`无法读取 ${entry.fileName}`))
                return
              }
              const hash = createHash('sha256')
              const writeStream = createWriteStream(destPath)
              let bytes = 0

              readStream.on('error', fail)
              readStream.on('data', (c: Buffer) => {
                hash.update(c)
                bytes += c.length
              })

              writeStream.on('error', fail)
              writeStream.on('finish', () => {
                if (settled) return
                const actual = hash.digest('hex')
                if (actual !== expected.sha256) {
                  fail(
                    new Error(
                      `校验失败: ${entry.fileName}\n期望 ${expected.sha256}\n实际 ${actual}`
                    )
                  )
                  return
                }
                processed++
                onProgress?.({
                  phase: 'extract',
                  current: processed,
                  total,
                  fileName: relPath,
                  bytes
                })
                zipFile.readEntry()
              })

              readStream.pipe(writeStream)
            })
          })

          zipFile.readEntry()
        })
      })
      .catch(reject)
  })
}

/** 仅用 yauzl 校验 zip 结构是否完整，用于"恢复前"的预检。 */
export async function verifyV1Zip(zipPath: string): Promise<void> {
  // 直接尝试读 manifest；坏 zip 会在这里抛出 yauzl 的错误
  await readManifestV1(zipPath)
}

/** 工具：判断给定文件是否 v1 zip 格式（按文件名 + 内容 magic）。 */
export function isV1Backup(fileName: string): boolean {
  return /\.zip$/i.test(fileName)
}

/** 工具：basename 别名（保持外部 import 简洁）。 */
export const _basename = basename
