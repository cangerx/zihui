import { getDatabase } from '../../database'
import { getSetting } from '../settings'
import { getCloudToken } from '../cloud-token'
import { ENTITY_MAP, SYNC_ENTITIES } from './registry'
import {
  getLastPullSeq,
  setLastPullSeq,
  getShadow,
  upsertShadow,
  deleteShadow,
  getTombstone,
  clearTombstone,
  listPendingOps,
  clearOpsUpTo,
  countPending,
  withOplogSuspended,
  recordConflict,
  hasConflict,
  setMeta,
  getMeta,
  countUnseenConflicts,
} from './state'
import {
  serializeCurrent,
  deserializePayload,
  applyUpsert,
  applyDelete,
  contentHash,
} from './serializer'
import { mergeEntity } from './merge'
import {
  prefetchBlobs,
  uploadReferenced,
  retryPendingBlobs,
  gcLocalBlobs,
  QuotaExceededError,
} from './blob'
import * as api from './api'
import type {
  ConflictMode,
  EntityPayload,
  PushChange,
  RemoteChange,
  SyncCategory,
  SyncProgress,
  SyncScope,
  SyncStatusSnapshot,
} from './types'

// ============================================================================
// 同步引擎：pull → merge → push 主循环，server_seq 乐观并发，409 触发 rebase。
// ============================================================================

let running = false
let progressCb: ((p: SyncProgress) => void) | null = null
let lastQuotaExceeded = false

export function setProgressEmitter(cb: ((p: SyncProgress) => void) | null): void {
  progressCb = cb
}

function emit(phase: SyncProgress['phase'], current: number, total: number, message: string): void {
  progressCb?.({ phase, current, total, message })
}

// ---- 配置（账号级，存 settings 表） ----

export interface SyncConfig {
  mode: 'off' | 'realtime' | 'hourly' | 'daily'
  scope: SyncScope
  conflict: ConflictMode
}

export function getSyncConfig(): SyncConfig {
  const mode = (getSetting('cloud_sync_mode') as any) || 'off'
  let scope: SyncScope = { data: true, image: true, video: true }
  try {
    const raw = getSetting('cloud_sync_scope')
    if (raw) {
      const p = JSON.parse(raw)
      scope = { data: true, image: p.image !== false, video: p.video !== false }
    }
  } catch {
    // keep default
  }
  const conflict = ((getSetting('cloud_sync_conflict') as ConflictMode) || 'merge') as ConflictMode
  return { mode, scope, conflict }
}

function inScopeCat(cat: SyncCategory, scope: SyncScope): boolean {
  if (cat === 'image') return scope.image
  if (cat === 'video') return scope.video
  return true
}

// ---- 前向兼容：未知实体跳过与升级回补 ----

const SKIPPED_ENTITIES_KEY = 'skipped_unknown_entities'

function readSkippedEntities(): Set<string> {
  try {
    const arr = JSON.parse(getMeta(SKIPPED_ENTITIES_KEY, '[]'))
    return new Set(Array.isArray(arr) ? arr.map(String) : [])
  } catch {
    return new Set()
  }
}

function writeSkippedEntities(s: Set<string>): void {
  setMeta(SKIPPED_ENTITIES_KEY, JSON.stringify([...s]))
}

/** 此前因本版本不认识而跳过的实体，升级后已被支持：重置拉取游标全量回补。 */
function backfillSkippedEntitiesIfKnown(): void {
  const skipped = readSkippedEntities()
  if (skipped.size === 0) return
  const nowKnown = [...skipped].filter((e) => ENTITY_MAP[e])
  if (nowKnown.length === 0) return
  setLastPullSeq(0)
  writeSkippedEntities(new Set([...skipped].filter((e) => !ENTITY_MAP[e])))
}

// ---- FK 守卫：仅在同步事务执行的同步代码块内关闭外键 ----
// foreign_keys 是连接级 pragma 且全应用共用一个连接；若在整个 runSync（含 await 网络
// 间隙）关闭，期间用户的业务删除将丢失 ON DELETE CASCADE，产生无墓碑的永久孤儿。
// 事务回调是同步执行的，不会与业务操作交错，窗口因此收窄到安全范围。
function withForeignKeysOff<T>(fn: () => T): T {
  const db = getDatabase()
  const prev = db.pragma('foreign_keys', { simple: true })
  const wasOn = prev === 1 || prev === '1'
  if (wasOn) db.pragma('foreign_keys = OFF')
  try {
    return fn()
  } finally {
    if (wasOn) db.pragma('foreign_keys = ON')
  }
}

// ---- 本地媒体缓存 GC（每 24h 一次，随成功同步触发） ----

const BLOB_GC_INTERVAL_MS = 24 * 60 * 60 * 1000
const SHA_RE = /[a-f0-9]{64}/g

/**
 * 收集仍被引用的 blob sha：业务表媒体列（路径内嵌 sha）、shadow 基线（payload 含
 * sync-blob:// 占位）、待下载表，以及尚未上传成功的本地 blob。取并集偏保守，宁多勿删。
 */
function collectReferencedShas(): Set<string> {
  const db = getDatabase()
  const out = new Set<string>()
  const collect = (v: any): void => {
    if (typeof v !== 'string' || v.length < 64) return
    const m = v.match(SHA_RE)
    if (m) for (const s of m) out.add(s)
  }
  for (const def of SYNC_ENTITIES) {
    if (!def.blobFields?.length) continue
    const cols = def.blobFields.map((b) => b.field).join(', ')
    let rows: any[] = []
    try {
      rows = db.prepare(`SELECT ${cols} FROM ${def.entity}`).all() as any[]
    } catch {
      continue
    }
    for (const r of rows) for (const v of Object.values(r)) collect(v)
  }
  for (const r of db.prepare("SELECT base_json FROM sync_shadow WHERE base_json != ''").all() as any[]) {
    collect(r.base_json)
  }
  for (const r of db.prepare('SELECT sha256 FROM sync_blob_pending').all() as any[]) {
    out.add(String(r.sha256))
  }
  for (const r of db.prepare('SELECT sha256 FROM sync_blob_local WHERE uploaded = 0').all() as any[]) {
    out.add(String(r.sha256))
  }
  return out
}

function maybeGcLocalBlobs(): void {
  const last = parseInt(getMeta('last_blob_gc_at', '0'), 10) || 0
  if (Date.now() - last < BLOB_GC_INTERVAL_MS) return
  try {
    gcLocalBlobs(collectReferencedShas())
    setMeta('last_blob_gc_at', String(Date.now()))
  } catch {
    // GC 失败不影响同步结果，下次再试
  }
}

// ---- 本地状态判定 ----

interface LocalState {
  payload: EntityPayload | null
  deleted: boolean
  dirty: boolean
}

function localState(entity: string, uid: string): LocalState {
  const payload = serializeCurrent(entity, uid)
  const shadow = getShadow(entity, uid)
  if (!payload) {
    const tomb = getTombstone(entity, uid)
    if (tomb) return { payload: null, deleted: true, dirty: true }
    return { payload: null, deleted: false, dirty: false }
  }
  const hash = contentHash(payload)
  const dirty = !shadow || shadow.content_hash !== hash
  return { payload, deleted: false, dirty }
}

// ---- 应用一条远端变更（含冲突分流） ----

function applyRemoteChange(c: RemoteChange, conflict: ConflictMode): void {
  const { entity, uid, deleted, payload, rev } = c
  const ls = localState(entity, uid)

  if (deleted) {
    if (!ls.dirty) {
      withOplogSuspended(() => applyDelete(entity, uid))
      clearTombstone(entity, uid)
      deleteShadow(entity, uid)
    } else if (conflict === 'cloud') {
      if (ls.payload) {
        recordConflict(entity, uid, '(overwritten)', JSON.stringify(ls.payload.fields), '<云端删除>', 'remote')
      }
      withOplogSuspended(() => applyDelete(entity, uid))
      clearTombstone(entity, uid)
      clearOpsForUid(entity, uid)
      deleteShadow(entity, uid)
    } else {
      // 改优先 / 以本机为准：保留本地，把基线对齐远端 rev，使本地变更得以 push 覆盖
      upsertShadow(entity, uid, rev, '', '', Date.now())
      recordConflict(entity, uid, '(deleted)', '<本机保留>', '<云端删除>', 'local')
    }
    return
  }

  if (!payload) return
  const remoteHash = c.content_hash || contentHash(payload)

  const writeRemote = (): void => {
    withOplogSuspended(() => applyUpsert(entity, deserializePayload(payload)))
    clearTombstone(entity, uid)
    upsertShadow(entity, uid, rev, remoteHash, JSON.stringify(payload), payload.updated_ms)
  }

  if (!ls.dirty) {
    writeRemote()
    return
  }

  if (conflict === 'cloud') {
    // 覆盖前记录本机被丢弃版本，可追溯，不静默丢数据
    if (ls.payload) {
      recordConflict(entity, uid, '(overwritten)', JSON.stringify(ls.payload.fields), JSON.stringify(payload.fields), 'remote')
    }
    writeRemote()
    clearOpsForUid(entity, uid)
    return
  }
  if (conflict === 'local') {
    // 保留本地；基线对齐远端，使本地 push 能覆盖
    upsertShadow(entity, uid, rev, remoteHash, JSON.stringify(payload), payload.updated_ms)
    return
  }

  // merge
  if (ls.deleted) {
    // 本地删、远端改 → 改优先，复活远端版本
    writeRemote()
    clearOpsForUid(entity, uid)
    return
  }
  const shadow = getShadow(entity, uid)
  let basePayload: EntityPayload | null = null
  if (shadow?.base_json) {
    try {
      basePayload = JSON.parse(shadow.base_json)
    } catch {
      basePayload = null
    }
  }
  const { merged, conflicts } = mergeEntity(basePayload, ls.payload!, payload)
  // 不 suspend：合并结果作为本地新变更进入 oplog，下一轮 push 回云端
  applyUpsert(entity, deserializePayload(merged))
  clearTombstone(entity, uid)
  for (const cf of conflicts) {
    recordConflict(cf.entity, cf.uid, cf.field, cf.localValue, cf.remoteValue, cf.resolution)
  }
  // 基线对齐远端，使下一轮 push 的 base_rev=rev 与服务端一致
  upsertShadow(entity, uid, rev, remoteHash, JSON.stringify(payload), payload.updated_ms)
}

function clearOpsForUid(entity: string, uid: string): void {
  const db = getDatabase()
  const row = db
    .prepare('SELECT MAX(seq) AS m FROM sync_oplog WHERE entity = ? AND uid = ?')
    .get(entity, uid) as any
  if (row && row.m != null) clearOpsUpTo(entity, uid, Number(row.m))
}

function sortForApply(changes: RemoteChange[]): RemoteChange[] {
  const ord = (e: string): number => ENTITY_MAP[e]?.order ?? 999
  const upserts = changes.filter((c) => !c.deleted).sort((a, b) => ord(a.entity) - ord(b.entity))
  const deletes = changes.filter((c) => c.deleted).sort((a, b) => ord(b.entity) - ord(a.entity))
  return [...upserts, ...deletes]
}

// ---- 拉取阶段 ----

async function pullAll(scope: SyncScope, conflict: ConflictMode): Promise<{ didWork: boolean }> {
  let since = getLastPullSeq()
  let didWork = false
  for (let guard = 0; guard < 1000; guard++) {
    const res = await api.pull(since, 500)
    if (res.changes.length === 0) break
    didWork = true

    // 未知实体（来自更新版本的其它设备）：跳过但推进游标，登记待升级回补；
    // 否则 SELECT 不存在的表会抛错，同一页每次重试必失败，同步永久卡死
    const known: RemoteChange[] = []
    const skipped = readSkippedEntities()
    let skippedDirty = false
    for (const c of res.changes) {
      if (ENTITY_MAP[c.entity]) {
        known.push(c)
      } else if (!skipped.has(c.entity)) {
        skipped.add(c.entity)
        skippedDirty = true
      }
    }
    if (skippedDirty) writeSkippedEntities(skipped)

    // 预取本页 in-scope blob
    const refs = known
      .filter((c) => c.payload)
      .flatMap((c) => c.payload!.blobs.filter((b) => inScopeCat(b.category, scope)))
    if (refs.length) {
      emit('pull', 0, refs.length, '下载媒体')
      await prefetchBlobs(refs, (d, t) => emit('pull', d, t, '下载媒体'))
    }

    emit('merge', 0, known.length, '合并变更')
    const ordered = sortForApply(known)
    const db = getDatabase()
    const applyTx = db.transaction(() => {
      let i = 0
      for (const c of ordered) {
        try {
          applyRemoteChange(c, conflict)
        } catch (e: any) {
          // 单条落库失败（约束/结构差异等）不阻塞整页：登记冲突供 UI 暴露，跳过继续
          if (!hasConflict(c.entity, c.uid, '(apply_error)')) {
            recordConflict(c.entity, c.uid, '(apply_error)', '', String(e?.message || e), 'skipped')
          }
        }
        emit('merge', ++i, ordered.length, '合并变更')
      }
    })
    withForeignKeysOff(() => applyTx())

    const pageMax = res.changes.reduce((m, c) => Math.max(m, c.server_seq), since)
    setLastPullSeq(pageMax)
    since = pageMax
    if (!res.has_more) break
  }
  return { didWork }
}

// ---- 推送阶段 ----

interface PushOutcome {
  didWork: boolean
  needPullAgain: boolean
}

async function pushAll(scope: SyncScope, conflict: ConflictMode): Promise<PushOutcome> {
  const ops = listPendingOps()
  if (ops.length === 0) return { didWork: false, needPullAgain: false }

  const changes: PushChange[] = []
  const blobRefs: EntityPayload['blobs'] = []
  const opMaxSeq = new Map<string, number>()

  for (const op of ops) {
    const { entity, uid } = op
    const key = `${entity}|${uid}`
    opMaxSeq.set(key, op.seq)
    const cur = serializeCurrent(entity, uid)
    const shadow = getShadow(entity, uid)

    if (!cur) {
      // 本地已删
      const tomb = getTombstone(entity, uid)
      if (!shadow) {
        // 从未同步过的创建后又删除：服务端无需知晓，直接清理
        clearOpsUpTo(entity, uid, op.seq)
        clearTombstone(entity, uid)
        continue
      }
      changes.push({
        entity,
        uid,
        deleted: true,
        base_rev: shadow.server_rev,
        payload: null,
        content_hash: '',
        updated_ms: tomb || Date.now(),
        blobs: [],
      })
      continue
    }

    const hash = contentHash(cur)
    if (shadow && shadow.content_hash === hash) {
      // 内容未实质变化（仅 touch）：清理 oplog，不推送
      clearOpsUpTo(entity, uid, op.seq)
      continue
    }
    const inScope = cur.blobs.filter((b) => inScopeCat(b.category, scope))
    for (const b of inScope) blobRefs.push(b)
    changes.push({
      entity,
      uid,
      deleted: false,
      base_rev: shadow ? shadow.server_rev : 0,
      payload: cur,
      content_hash: hash,
      updated_ms: cur.updated_ms,
      blobs: inScope.map((b) => b.sha256),
    })
  }

  if (changes.length === 0) return { didWork: false, needPullAgain: false }

  // 先上传 in-scope blob（秒传 + 断点续传）
  let unavailable = new Set<string>()
  if (blobRefs.length) {
    emit('upload', 0, blobRefs.length, '上传媒体')
    unavailable = await uploadReferenced(blobRefs, (d, t) => emit('upload', d, t, '上传媒体'))
  }

  // 引用的媒体本地与云端都不存在：挂起该变更（oplog 保留，待文件恢复后重推），
  // 不推悬空引用，否则其它设备会对缺失 blob 永久 404 重试
  let sendable = changes
  if (unavailable.size) {
    sendable = []
    for (const ch of changes) {
      const missing = ch.blobs.filter((s) => unavailable.has(s))
      if (!ch.deleted && missing.length) {
        if (!hasConflict(ch.entity, ch.uid, '(blob_missing)')) {
          recordConflict(ch.entity, ch.uid, '(blob_missing)', '', missing.join(','), 'pending')
        }
        continue
      }
      sendable.push(ch)
    }
    if (sendable.length === 0) return { didWork: false, needPullAgain: false }
  }

  emit('push', 0, sendable.length, '提交变更')
  const baseSeq = getLastPullSeq()
  const resp = await api.push(baseSeq, sendable)
  if (resp.quotaExceeded) throw new QuotaExceededError()
  if (resp.needPull) return { didWork: true, needPullAgain: true }

  const byKey = new Map(sendable.map((c) => [`${c.entity}|${c.uid}`, c]))
  const db = getDatabase()
  const finalizeTx = db.transaction(() => {
    for (const r of resp.results) {
      const key = `${r.entity}|${r.uid}`
      const ch = byKey.get(key)
      const seq = opMaxSeq.get(key)
      if (r.status === 'applied') {
        if (ch?.deleted) {
          deleteShadow(r.entity, r.uid)
          clearTombstone(r.entity, r.uid)
        } else if (ch) {
          upsertShadow(
            r.entity,
            r.uid,
            Number(r.rev || 0),
            ch.content_hash,
            JSON.stringify(ch.payload),
            ch.updated_ms,
          )
        }
        if (seq != null) clearOpsUpTo(r.entity, r.uid, seq)
      }
    }
  })
  finalizeTx()

  // 处理 push 冲突：拉取服务端版本到本地做合并（下一轮再 push）
  const conflictResults = resp.results.filter((r) => r.status === 'conflict' && r.remote)
  if (conflictResults.length) {
    const refs = conflictResults
      .flatMap((r) => r.remote!.payload?.blobs || [])
      .filter((b) => inScopeCat(b.category, scope))
    if (refs.length) await prefetchBlobs(refs)
    const tx = db.transaction(() => {
      for (const r of conflictResults) {
        try {
          applyRemoteChange(r.remote!, conflict)
        } catch (e: any) {
          if (!hasConflict(r.entity, r.uid, '(apply_error)')) {
            recordConflict(r.entity, r.uid, '(apply_error)', '', String(e?.message || e), 'skipped')
          }
        }
      }
    })
    withForeignKeysOff(() => tx())
  }

  return { didWork: true, needPullAgain: conflictResults.length > 0 }
}

// ---- 主循环 ----

export async function runSync(): Promise<{ ok: boolean; error?: string }> {
  if (running) return { ok: false, error: 'already_running' }
  const config = getSyncConfig()
  if (!getCloudToken()) return { ok: false, error: 'not_logged_in' }

  running = true
  lastQuotaExceeded = false
  emit('pull', 0, 0, '开始同步')
  try {
    // 旧版本跳过的实体如今已被支持：重置游标全量回补
    backfillSkippedEntitiesIfKnown()
    // 先重试历史下载失败的媒体（弱网补偿），避免永久缺失
    try {
      await retryPendingBlobs(config.scope)
    } catch {
      // 忽略：失败的仍保留在待取表，下次再试
    }
    for (let round = 0; round < 5; round++) {
      const pulled = await pullAll(config.scope, config.conflict)
      const pushed = await pushAll(config.scope, config.conflict)
      if (pushed.needPullAgain) continue
      if (!pulled.didWork && !pushed.didWork) break
    }
    maybeGcLocalBlobs()
    setMeta('last_sync_at', String(Date.now()))
    setMeta('last_error', '')
    emit('done', 1, 1, '同步完成')
    return { ok: true }
  } catch (e: any) {
    if (e instanceof QuotaExceededError) {
      lastQuotaExceeded = true
      setMeta('last_error', '云存储空间不足')
      emit('error', 0, 0, '云存储空间不足')
      return { ok: false, error: 'quota_exceeded' }
    }
    const msg = e?.message || String(e)
    setMeta('last_error', msg)
    emit('error', 0, 0, msg)
    return { ok: false, error: msg }
  } finally {
    running = false
  }
}

/** 手动触发同步（与自动同步共用主循环；总是尝试运行）。 */
export function forceSync(): Promise<{ ok: boolean; error?: string }> {
  return runSync()
}

export function isRunning(): boolean {
  return running
}

export function lastQuotaWasExceeded(): boolean {
  return lastQuotaExceeded
}

export function getStatusSnapshot(): SyncStatusSnapshot {
  return {
    running,
    lastSyncAt: parseInt(getMeta('last_sync_at', '0'), 10) || 0,
    lastError: getMeta('last_error', ''),
    pendingChanges: countPending(),
    conflicts: countUnseenConflicts(),
    progress: { phase: running ? 'pull' : 'idle', current: 0, total: 0, message: '' },
  }
}
