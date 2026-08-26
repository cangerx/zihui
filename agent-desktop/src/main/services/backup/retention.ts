import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { getBackupDir } from './staging'
import { readRecords, writeRecords } from './records'
import { getSetting, setSetting } from '../settings'
import type { BackupType, BackupSettings } from './types'

/**
 * 清理超过 maxCount 的同类型旧备份。
 *
 * 与旧实现的关键差别：
 * - 手动备份完成后也调用本函数（旧实现只在 auto backup 走 cleanup → 用户设置的"保留份数"对手动备份失效）
 * - 按 createdAt 排序，更可靠（旧实现依赖 records 推入顺序，损坏后行为不可预测）
 */

export function getAutoBackupInterval(): BackupSettings['interval'] {
  const v = (getSetting('backup_auto_interval') || 'off') as BackupSettings['interval']
  // 白名单校验：避免用户/老数据传入未知值（如 'monthly'）静默不生效
  if (v !== 'off' && v !== 'daily' && v !== 'weekly') return 'off'
  return v
}

export function setAutoBackupInterval(interval: BackupSettings['interval']): void {
  if (interval !== 'off' && interval !== 'daily' && interval !== 'weekly') {
    throw new Error(`Invalid backup interval: ${interval}`)
  }
  setSetting('backup_auto_interval', interval)
}

export function getMaxBackupCount(): number {
  const raw = getSetting('backup_max_count')
  const v = raw ? parseInt(raw, 10) : 5
  if (!Number.isFinite(v) || v < 1) return 5
  // 上限保护，避免用户填 99999 撑爆磁盘
  return Math.min(v, 100)
}

export function setMaxBackupCount(count: number): void {
  if (!Number.isFinite(count) || count < 1) {
    throw new Error(`Invalid maxCount: ${count}`)
  }
  setSetting('backup_max_count', String(Math.min(Math.floor(count), 100)))
}

/** 按类型清理：保留最新 maxCount 份，其余从磁盘 + records.json 移除。 */
export function cleanupOldBackups(type: BackupType): void {
  const maxCount = getMaxBackupCount()
  const records = readRecords()
  const sameType = records.filter((r) => r.type === type)
  if (sameType.length <= maxCount) return

  // 按 createdAt 升序，越靠前越旧
  sameType.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  const toRemove = sameType.slice(0, sameType.length - maxCount)
  const removeNames = new Set(toRemove.map((r) => r.fileName))

  const dir = getBackupDir()
  for (const r of toRemove) {
    const fp = join(dir, r.fileName)
    if (existsSync(fp)) {
      try {
        unlinkSync(fp)
      } catch (e) {
        console.error('[backup] cleanup failed to remove file:', fp, e)
      }
    }
  }

  const kept = records.filter((r) => !removeNames.has(r.fileName))
  writeRecords(kept)
}
