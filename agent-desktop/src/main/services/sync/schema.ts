import type Database from 'better-sqlite3'
import { SYNC_ENTITIES } from './registry'

// SQLite 毫秒级 epoch 表达式（UTC）：julianday('now') 起算到 1970-01-01。
const NOW_MS = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)"

/**
 * 安装同步基础设施（幂等）。在每次开库（含账号热切换开新库）后调用。
 *
 * 触发器策略：业务代码零改动。AFTER INSERT/UPDATE 写 sync_oplog(upsert)，
 * AFTER DELETE 写 sync_tombstone + sync_oplog(delete)。触发器带 WHEN 守卫，
 * 在 apply 远端变更期间（suspend=1）不记录，避免「拉下来的又被当本地变更推回」回环。
 */
export function installSyncSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sync_flags (
      k TEXT PRIMARY KEY,
      v INTEGER NOT NULL DEFAULT 0
    );

    -- 本地变更日志：每次业务写入追加一行；push 成功后按 seq 上限清理。
    CREATE TABLE IF NOT EXISTS sync_oplog (
      seq    INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL,
      uid    TEXT NOT NULL,
      op     TEXT NOT NULL,
      ts_ms  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_oplog_eu ON sync_oplog(entity, uid);

    -- 删除墓碑：物理删除也能向云端/其它设备传播删除。
    CREATE TABLE IF NOT EXISTS sync_tombstone (
      entity     TEXT NOT NULL,
      uid        TEXT NOT NULL,
      deleted_ms INTEGER NOT NULL,
      PRIMARY KEY (entity, uid)
    );

    -- 三路合并基线：上次与服务端达成一致的版本快照。
    CREATE TABLE IF NOT EXISTS sync_shadow (
      entity       TEXT NOT NULL,
      uid          TEXT NOT NULL,
      server_rev   INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT NOT NULL DEFAULT '',
      base_json    TEXT NOT NULL DEFAULT '',
      updated_ms   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (entity, uid)
    );

    -- 冲突副本/事件记录（不静默丢数据，供 UI 展示）。
    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      entity     TEXT NOT NULL,
      uid        TEXT NOT NULL,
      field      TEXT NOT NULL DEFAULT '',
      local_value TEXT NOT NULL DEFAULT '',
      remote_value TEXT NOT NULL DEFAULT '',
      resolution TEXT NOT NULL DEFAULT '',
      ts_ms      INTEGER NOT NULL,
      seen       INTEGER NOT NULL DEFAULT 0
    );

    -- 本地 blob 索引：内容寻址媒体缓存（dataDir/sync-media/{sha}.{ext}）。
    CREATE TABLE IF NOT EXISTS sync_blob_local (
      sha256     TEXT PRIMARY KEY,
      size       INTEGER NOT NULL DEFAULT 0,
      category   TEXT NOT NULL DEFAULT 'image',
      ext        TEXT NOT NULL DEFAULT 'bin',
      uploaded   INTEGER NOT NULL DEFAULT 0,
      created_ms INTEGER NOT NULL DEFAULT 0
    );

    -- 待下载 blob：apply 时下载失败的远端媒体，下次同步重试，避免弱网下媒体永久缺失。
    CREATE TABLE IF NOT EXISTS sync_blob_pending (
      sha256     TEXT PRIMARY KEY,
      ext        TEXT NOT NULL DEFAULT 'bin',
      category   TEXT NOT NULL DEFAULT 'image',
      created_ms INTEGER NOT NULL DEFAULT 0
    );
  `)

  db.prepare("INSERT OR IGNORE INTO sync_flags(k, v) VALUES('suspend', 0)").run()
  // 每次开库强制复位 suspend：防止上次进程在 apply 中崩溃残留 suspend=1，
  // 否则触发器会永久停止记录本地变更。
  db.prepare("UPDATE sync_flags SET v = 0 WHERE k = 'suspend'").run()

  const existing = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(
      (r) => r.name as string,
    ),
  )

  for (const def of SYNC_ENTITIES) {
    const t = def.entity
    if (!existing.has(t)) continue // 表尚未建（理论上不会，installSyncSchema 在建表之后）
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS sync_${t}_ai AFTER INSERT ON ${t}
      WHEN (SELECT v FROM sync_flags WHERE k='suspend') = 0
      BEGIN
        INSERT INTO sync_oplog(entity, uid, op, ts_ms)
        VALUES ('${t}', NEW.id, 'upsert', ${NOW_MS});
      END;

      CREATE TRIGGER IF NOT EXISTS sync_${t}_au AFTER UPDATE ON ${t}
      WHEN (SELECT v FROM sync_flags WHERE k='suspend') = 0
      BEGIN
        INSERT INTO sync_oplog(entity, uid, op, ts_ms)
        VALUES ('${t}', NEW.id, 'upsert', ${NOW_MS});
      END;

      CREATE TRIGGER IF NOT EXISTS sync_${t}_ad AFTER DELETE ON ${t}
      WHEN (SELECT v FROM sync_flags WHERE k='suspend') = 0
      BEGIN
        INSERT INTO sync_tombstone(entity, uid, deleted_ms)
        VALUES ('${t}', OLD.id, ${NOW_MS})
        ON CONFLICT(entity, uid) DO UPDATE SET deleted_ms = excluded.deleted_ms;
        INSERT INTO sync_oplog(entity, uid, op, ts_ms)
        VALUES ('${t}', OLD.id, 'delete', ${NOW_MS});
      END;
    `)
  }
}
