import { BrowserWindow } from 'electron'
import { setSetting } from '../settings'
import {
  setProgressEmitter,
  forceSync,
  getStatusSnapshot,
  getSyncConfig,
  type SyncConfig,
} from './engine'
import { restartSyncScheduler, stopSyncScheduler, startupSync } from './scheduler'
import { listConflicts, markConflictsSeen, setLastPullSeq } from './state'
import { localBlobStats } from './blob'
import * as api from './api'
import type { ConflictMode, SyncProgress, SyncScope } from './types'

// 同步模块对外门面：供 IPC 调用，并把进度广播到所有渲染窗口。

let initialized = false

export function initSyncModule(): void {
  if (initialized) return
  initialized = true
  setProgressEmitter((p: SyncProgress) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('sync:progress', p)
    }
  })
}

function broadcastStatus(): void {
  const status = getStatusSnapshot()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('sync:status', status)
  }
}

export async function syncNow(): Promise<{ ok: boolean; error?: string }> {
  const r = await forceSync()
  broadcastStatus()
  return r
}

export function getStatus(): ReturnType<typeof getStatusSnapshot> {
  return getStatusSnapshot()
}

export function getConfig(): SyncConfig {
  return getSyncConfig()
}

export function setConfig(patch: {
  mode?: SyncConfig['mode']
  scope?: Partial<SyncScope>
  conflict?: ConflictMode
}): SyncConfig {
  const before = getSyncConfig()
  if (patch.mode != null) setSetting('cloud_sync_mode', patch.mode)
  if (patch.scope != null) {
    const next = { ...before.scope, ...patch.scope, data: true }
    setSetting('cloud_sync_scope', JSON.stringify(next))
  }
  if (patch.conflict != null) setSetting('cloud_sync_conflict', patch.conflict)
  const after = getSyncConfig()
  // 新开启某媒体分类时，重置拉取游标，使下次同步重新拉取并回补该分类的历史媒体
  // （之前游标已越过这些记录，否则它们的媒体不会补传到本设备）。
  const newlyEnabled =
    (!before.scope.image && after.scope.image) || (!before.scope.video && after.scope.video)
  if (newlyEnabled) setLastPullSeq(0)
  restartSyncScheduler()
  return after
}

export async function getQuota(): Promise<any> {
  try {
    return await api.getQuota()
  } catch (e: any) {
    return { error: e?.message || String(e) }
  }
}

export function getConflicts(): any[] {
  const list = listConflicts()
  markConflictsSeen()
  broadcastStatus()
  return list
}

export function getLocalStats(): { count: number; bytes: number; uploaded: number } {
  return localBlobStats()
}

/** 登录态变化：仅在登出时停调度。登录后的同步启动由 onAccountReady 驱动（见下）。 */
export function onAuthChanged(loggedIn: boolean): void {
  if (!loggedIn) {
    stopSyncScheduler()
  }
  // 登录不在此启动同步：此刻账号目录可能尚未切换（login 先 setToken 后 setActiveAccount），
  // 若立即 runSync 会在错误目录（root）开库。改由 account-context 在「账号目录就绪」时调 onAccountReady。
}

/**
 * 账号目录就绪后启动同步（由 account-context.setActiveAccount 在 switched=false、
 * 即目录确定且无需 reload 时调用；app 启动 / 登录 / 热切换 reload 回流都会经此路径）。
 */
export function onAccountReady(): void {
  restartSyncScheduler()
  void startupSync().then(broadcastStatus).catch(() => {})
}

export { restartSyncScheduler, stopSyncScheduler }
