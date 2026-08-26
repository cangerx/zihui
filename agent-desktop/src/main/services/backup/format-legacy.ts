import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { inflateSync } from 'zlib'
import { getDataDir } from '../data-path'
import { closeDatabase } from '../../database'
import { getBackupDir, removeSqliteSidecars } from './staging'
import type { ProgressEvent } from './types'

/**
 * 兼容旧版备份恢复（不再创建旧格式备份）。
 *
 * 旧格式：
 *   - backup-db-<ts>.sqlite : 直接 copy 数据库文件
 *   - backup-full-<ts>.bak  : zlib deflate 的自创二进制 [4字节 manifest 长度][manifest JSON][file data...]
 *
 * 新方案统一用 .zip。这里只读不写，确保升级到新版本后用户的旧备份还能恢复。
 */

export function isLegacyDbBackup(fileName: string): boolean {
  return /\.sqlite$/i.test(fileName)
}

export function isLegacyFullBackup(fileName: string): boolean {
  return /\.bak$/i.test(fileName)
}

export async function restoreLegacyDb(fileName: string): Promise<void> {
  const filePath = join(getBackupDir(), fileName)
  if (!existsSync(filePath)) throw new Error('备份文件不存在')

  const dataDir = getDataDir()
  const dbPath = join(dataDir, 'local-agent.db')

  closeDatabase()
  // 关键：删除 WAL/SHM，否则 SQLite 会用旧 WAL 的内容覆盖刚恢复的 db 文件
  removeSqliteSidecars(dbPath)
  copyFileSync(filePath, dbPath)
}

export async function restoreLegacyFull(
  fileName: string,
  onProgress?: (e: ProgressEvent) => void
): Promise<void> {
  const filePath = join(getBackupDir(), fileName)
  if (!existsSync(filePath)) throw new Error('备份文件不存在')

  const dataDir = getDataDir()

  closeDatabase()
  removeSqliteSidecars(join(dataDir, 'local-agent.db'))

  const compressed = readFileSync(filePath)
  const archive = inflateSync(compressed)

  // 解析旧格式 header
  if (archive.length < 4) throw new Error('备份文件损坏：archive 太短')
  const manifestLen = archive.readUInt32LE(0)
  if (manifestLen <= 0 || 4 + manifestLen > archive.length) {
    throw new Error('备份文件损坏：manifest 长度非法')
  }
  const manifestJson = archive.subarray(4, 4 + manifestLen).toString('utf-8')
  let manifest: { path: string; size: number }[]
  try {
    manifest = JSON.parse(manifestJson)
  } catch (e: any) {
    throw new Error(`备份文件损坏：manifest 解析失败 ${e?.message || e}`)
  }
  if (!Array.isArray(manifest)) throw new Error('备份文件损坏：manifest 非数组')

  let offset = 4 + manifestLen
  const total = manifest.length

  for (let i = 0; i < manifest.length; i++) {
    const entry = manifest[i]
    if (offset + entry.size > archive.length) {
      throw new Error(`备份文件损坏：${entry.path} 数据越界`)
    }
    const data = archive.subarray(offset, offset + entry.size)
    offset += entry.size

    const destPath = join(dataDir, entry.path)
    const destDir = dirname(destPath)
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
    writeFileSync(destPath, data)

    if (onProgress) {
      onProgress({
        phase: 'apply',
        current: i + 1,
        total,
        fileName: entry.path
      })
    }
  }
}
