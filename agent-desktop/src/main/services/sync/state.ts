import { getDatabase } from '../../database'

// 同步运行态：游标、shadow 基线、oplog 待推集合、suspend 守卫、冲突记录。
// 全部落在当前账号库（local-agent.db），随账号隔离。

// ---- meta KV ----

export function getMeta(key: string, def = ''): string {
  const db = getDatabase()
  const row = db.prepare('SELECT v FROM sync_meta WHERE k = ?').get(key) as any
  return row ? String(row.v) : def
}

export function setMeta(key: string, value: string): void {
  const db = getDatabase()
  db.prepare('INSERT OR REPLACE INTO sync_meta(k, v) VALUES(?, ?)').run(key, value)
}

export function getLastPullSeq(): number {
  return parseInt(getMeta('last_pull_seq', '0'), 10) || 0
}

export function setLastPullSeq(n: number): void {
  setMeta('last_pull_seq', String(n))
}

// ---- oplog suspend 守卫（apply 远端变更期间不记录本地变更，避免回环） ----

export function setOplogSuspended(on: boolean): void {
  const db = getDatabase()
  db.prepare("UPDATE sync_flags SET v = ? WHERE k = 'suspend'").run(on ? 1 : 0)
}

export function withOplogSuspended<T>(fn: () => T): T {
  setOplogSuspended(true)
  try {
    return fn()
  } finally {
    setOplogSuspended(false)
  }
}

// ---- shadow（三路合并基线） ----

export interface ShadowRow {
  entity: string
  uid: string
  server_rev: number
  content_hash: string
  base_json: string
  updated_ms: number
}

export function getShadow(entity: string, uid: string): ShadowRow | null {
  const db = getDatabase()
  const row = db
    .prepare('SELECT * FROM sync_shadow WHERE entity = ? AND uid = ?')
    .get(entity, uid) as any
  return row || null
}

export function upsertShadow(
  entity: string,
  uid: string,
  serverRev: number,
  contentHash: string,
  baseJson: string,
  updatedMs: number,
): void {
  const db = getDatabase()
  db.prepare(
    `INSERT INTO sync_shadow(entity, uid, server_rev, content_hash, base_json, updated_ms)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(entity, uid) DO UPDATE SET
       server_rev = excluded.server_rev,
       content_hash = excluded.content_hash,
       base_json = excluded.base_json,
       updated_ms = excluded.updated_ms`,
  ).run(entity, uid, serverRev, contentHash, baseJson, updatedMs)
}

export function deleteShadow(entity: string, uid: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM sync_shadow WHERE entity = ? AND uid = ?').run(entity, uid)
}

// ---- oplog（本地待推变更） ----

export interface PendingOp {
  entity: string
  uid: string
  op: string
  seq: number
}

/** 取每个 (entity,uid) 最新一条 oplog（最终状态：最后是 delete 则删，否则 upsert）。 */
export function listPendingOps(): PendingOp[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT entity, uid, op, seq FROM sync_oplog
       WHERE seq IN (SELECT MAX(seq) FROM sync_oplog GROUP BY entity, uid)
       ORDER BY seq ASC`,
    )
    .all() as PendingOp[]
}

export function countPending(): number {
  const db = getDatabase()
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM (SELECT 1 FROM sync_oplog GROUP BY entity, uid)')
    .get() as any
  return row ? Number(row.c) : 0
}

/** oplog 水位（MAX(seq)；AUTOINCREMENT 单调不复用，可用于检测「有新本地变更」）。 */
export function getOplogWatermark(): number {
  const db = getDatabase()
  const row = db.prepare('SELECT MAX(seq) AS m FROM sync_oplog').get() as any
  return row && row.m != null ? Number(row.m) : 0
}

/** push 成功后清理该实体已确认的 oplog（仅删 seq<=capturedMax，保留期间新增）。 */
export function clearOpsUpTo(entity: string, uid: string, maxSeq: number): void {
  const db = getDatabase()
  db.prepare('DELETE FROM sync_oplog WHERE entity = ? AND uid = ? AND seq <= ?').run(
    entity,
    uid,
    maxSeq,
  )
}

// ---- tombstone ----

export function getTombstone(entity: string, uid: string): number | null {
  const db = getDatabase()
  const row = db
    .prepare('SELECT deleted_ms FROM sync_tombstone WHERE entity = ? AND uid = ?')
    .get(entity, uid) as any
  return row ? Number(row.deleted_ms) : null
}

export function clearTombstone(entity: string, uid: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM sync_tombstone WHERE entity = ? AND uid = ?').run(entity, uid)
}

// ---- 冲突记录 ----

export function recordConflict(
  entity: string,
  uid: string,
  field: string,
  localValue: string,
  remoteValue: string,
  resolution: string,
): void {
  const db = getDatabase()
  db.prepare(
    `INSERT INTO sync_conflicts(entity, uid, field, local_value, remote_value, resolution, ts_ms)
     VALUES(?, ?, ?, ?, ?, ?, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))`,
  ).run(entity, uid, field, localValue.slice(0, 2000), remoteValue.slice(0, 2000), resolution)
}

/** 是否已存在同 (entity, uid, field) 的冲突记录（用于每轮同步重复发生的事件去重）。 */
export function hasConflict(entity: string, uid: string, field: string): boolean {
  const db = getDatabase()
  const row = db
    .prepare('SELECT 1 FROM sync_conflicts WHERE entity = ? AND uid = ? AND field = ? LIMIT 1')
    .get(entity, uid, field)
  return !!row
}

export function countUnseenConflicts(): number {
  const db = getDatabase()
  const row = db.prepare('SELECT COUNT(*) AS c FROM sync_conflicts WHERE seen = 0').get() as any
  return row ? Number(row.c) : 0
}

export function listConflicts(limit = 200): any[] {
  const db = getDatabase()
  return db
    .prepare('SELECT * FROM sync_conflicts ORDER BY id DESC LIMIT ?')
    .all(limit) as any[]
}

export function markConflictsSeen(): void {
  const db = getDatabase()
  db.prepare('UPDATE sync_conflicts SET seen = 1 WHERE seen = 0').run()
}
