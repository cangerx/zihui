import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import { getBackupDir } from './staging'
import type { BackupInfo } from './types'

/**
 * backup-records.json 的读写。
 *
 * 健壮性策略：
 * - 解析失败时不直接清空，而是把损坏文件 rename 成 .corrupt-<ts>.json 留存，再返回空数组，
 *   避免"JSON 偶然损坏 → 旧记录全丢 → 旧 zip 文件成孤儿"。
 * - 写入用 .tmp + rename 原子化，防止写入过程中 kill 主进程导致 records.json 半截。
 * - 单进程内不会有真并发（IPC 是串行的），但备份/清理本身可能交错，所以读改写要尽量短。
 */

const RECORDS_FILE = 'backup-records.json'

function getRecordsPath(): string {
  return join(getBackupDir(), RECORDS_FILE)
}

export function readRecords(): BackupInfo[] {
  const path = getRecordsPath()
  if (!existsSync(path)) return []
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (e) {
    console.error('[backup] read records.json failed:', e)
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('records.json is not an array')
    return parsed
  } catch (e) {
    console.error('[backup] records.json corrupt, quarantine:', e)
    try {
      const ts = Date.now()
      renameSync(path, path.replace(/\.json$/, `.corrupt-${ts}.json`))
    } catch {}
    return []
  }
}

export function writeRecords(records: BackupInfo[]): void {
  const path = getRecordsPath()
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf-8')
  // rename 在同卷上是原子操作。Windows 下若目标存在会失败，所以先尝试覆盖。
  try {
    renameSync(tmp, path)
  } catch {
    // 兜底：直接覆盖（Windows 旧版 fs.rename 行为）
    writeFileSync(path, JSON.stringify(records, null, 2), 'utf-8')
  }
}

export function appendRecord(info: BackupInfo): void {
  const records = readRecords()
  records.push(info)
  writeRecords(records)
}

export function removeRecord(fileName: string): void {
  const records = readRecords()
  const next = records.filter((r) => r.fileName !== fileName)
  writeRecords(next)
}

/** 列表给 UI：过滤已不存在的文件，按 createdAt 倒序（最新在前）。 */
export function listValidRecords(): BackupInfo[] {
  const records = readRecords()
  const dir = getBackupDir()
  return records
    .filter((r) => existsSync(join(dir, r.fileName)))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}
