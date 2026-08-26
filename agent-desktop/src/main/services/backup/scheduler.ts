import { getSetting, setSetting } from '../settings'
import { getAutoBackupInterval } from './retention'

/**
 * 自动备份触发判断。
 *
 * 关键修复：把 `backup_last_auto` 时间戳的写入从 backupDatabase() 抽离出来，
 * 只在 markAutoBackupDone() 中更新。这样手动"快速备份"不会污染自动备份的节奏。
 *
 * 调用方约定：
 *   if (shouldAutoBackup()) {
 *     await backupDatabase({ type: 'auto' })
 *     markAutoBackupDone()
 *   }
 */

const LAST_AUTO_KEY = 'backup_last_auto'

export function shouldAutoBackup(): boolean {
  const interval = getAutoBackupInterval()
  if (interval === 'off') return false
  const lastAuto = getSetting(LAST_AUTO_KEY)
  if (!lastAuto) return true

  const lastDate = new Date(lastAuto)
  if (isNaN(lastDate.getTime())) return true
  const diffHours = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60)

  if (interval === 'daily') return diffHours >= 24
  if (interval === 'weekly') return diffHours >= 168
  return false
}

export function markAutoBackupDone(): void {
  setSetting(LAST_AUTO_KEY, new Date().toISOString())
}
