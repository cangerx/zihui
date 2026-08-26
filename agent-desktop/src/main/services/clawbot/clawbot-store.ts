// ClawBot 三张表（clawbot_connections / clawbot_peers / clawbot_logs）的 CRUD。
// 约定同 ewei-connectors：凭据密文（encryptSecret）只进不出，Summary 类型对渲染层脱敏。

import { v4 as uuid } from 'uuid'
import { getDatabase } from '../../database'
import { encryptSecret, decryptSecret } from '../matting-providers'

export type ClawbotConnectionStatus = 'offline' | 'connecting' | 'online' | 'paused' | 'expired'

export interface ClawbotConnection {
  id: string
  ilink_bot_id: string
  ilink_user_id: string
  baseurl: string
  bot_token_enc: string
  bot_id: string
  enabled: number
  status: ClawbotConnectionStatus
  get_updates_buf: string
  paused_until: string
  last_error: string
  created_at: string
  updated_at: string
}

/** 对渲染层脱敏的连接视图（不含 token 密文） */
export interface ClawbotConnectionSummary {
  id: string
  ilink_bot_id: string
  ilink_user_id: string
  bot_id: string
  enabled: boolean
  status: ClawbotConnectionStatus
  paused_until: string
  last_error: string
  has_token: boolean
  created_at: string
  updated_at: string
}

export interface ClawbotPeer {
  id: string
  connection_id: string
  peer_id: string
  conversation_id: string
  last_context_token: string
  last_message_at: string
  /** 已成功发往微信的 assistant 消息水位（messages.rowid）；重启后 baseline 只标水位之前，遗留未发可补发 */
  last_sent_rowid: number
  created_at: string
  updated_at: string
}

export interface ClawbotPeerSummary {
  id: string
  peer_id: string
  conversation_id: string
  conversation_title: string
  last_message_at: string
}

export interface ClawbotLog {
  id: string
  connection_id: string
  peer_id: string
  direction: string
  msg_type: string
  summary: string
  status: string
  error: string
  created_at: string
}

function toSummary(row: ClawbotConnection): ClawbotConnectionSummary {
  return {
    id: row.id,
    ilink_bot_id: row.ilink_bot_id,
    ilink_user_id: row.ilink_user_id,
    bot_id: row.bot_id,
    enabled: !!row.enabled,
    status: row.status,
    paused_until: row.paused_until,
    last_error: row.last_error,
    has_token: !!row.bot_token_enc,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

// ===== 连接（首期单连接：永远取第一行） =====

export function getPrimaryConnection(): ClawbotConnection | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM clawbot_connections ORDER BY created_at ASC LIMIT 1').get() as ClawbotConnection | undefined
  return row || null
}

/** 没有连接行时建一行空记录（绑定智能体/开关需要先落 bot_id，凭据后补） */
export function ensurePrimaryConnection(): ClawbotConnection {
  const existing = getPrimaryConnection()
  if (existing) return existing
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO clawbot_connections (id, enabled, status, created_at, updated_at) VALUES (?, 1, ?, ?, ?)'
  ).run(uuid(), 'offline', now, now)
  return getPrimaryConnection()!
}

export function getPrimaryConnectionSummary(): ClawbotConnectionSummary | null {
  const row = getPrimaryConnection()
  return row ? toSummary(row) : null
}

/** 扫码成功落库：更新既有行（每次扫码 ilink_bot_id 都会变，更新而非新建）或新建首行。游标清空重拉。 */
export function saveLoginResult(p: {
  ilink_bot_id: string
  ilink_user_id: string
  baseurl?: string
  bot_token: string
}): ClawbotConnection {
  const db = getDatabase()
  const now = new Date().toISOString()
  const enc = encryptSecret(p.bot_token)
  const existing = getPrimaryConnection()
  if (existing) {
    db.prepare(
      `UPDATE clawbot_connections
       SET ilink_bot_id=?, ilink_user_id=?, baseurl=?, bot_token_enc=?,
           status='online', get_updates_buf='', paused_until='', last_error='', updated_at=?
       WHERE id=?`
    ).run(p.ilink_bot_id, p.ilink_user_id, p.baseurl || '', enc, now, existing.id)
  } else {
    db.prepare(
      `INSERT INTO clawbot_connections
         (id, ilink_bot_id, ilink_user_id, baseurl, bot_token_enc, enabled, status, get_updates_buf, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 'online', '', ?, ?)`
    ).run(uuid(), p.ilink_bot_id, p.ilink_user_id, p.baseurl || '', enc, now, now)
  }
  return getPrimaryConnection()!
}

/** 解密 bot_token；解密失败（换设备/库被搬动）转中文可操作提示 */
export function resolveBotToken(conn: ClawbotConnection): string {
  if (!conn.bot_token_enc) throw new Error('尚未绑定微信 ClawBot，请先扫码登录')
  try {
    const token = decryptSecret(conn.bot_token_enc)
    if (!token) throw new Error('empty token')
    return token
  } catch {
    throw new Error('微信 ClawBot 凭据无法解密（可能更换了设备），请重新扫码绑定')
  }
}

/** 登出：清凭据与状态，保留 peer 映射（重扫后上下文可续） */
export function clearCredentials(id: string): void {
  const db = getDatabase()
  db.prepare(
    `UPDATE clawbot_connections
     SET bot_token_enc='', status='offline', paused_until='', last_error='', updated_at=?
     WHERE id=?`
  ).run(new Date().toISOString(), id)
}

export function updateConnectionFields(
  id: string,
  fields: Partial<Pick<ClawbotConnection, 'bot_id' | 'enabled' | 'status' | 'get_updates_buf' | 'paused_until' | 'last_error'>>
): void {
  const db = getDatabase()
  const sets: string[] = []
  const vals: any[] = []
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue
    sets.push(`${k}=?`)
    vals.push(v)
  }
  if (sets.length === 0) return
  sets.push('updated_at=?')
  vals.push(new Date().toISOString(), id)
  db.prepare(`UPDATE clawbot_connections SET ${sets.join(', ')} WHERE id=?`).run(...vals)
}

export function setConnectionStatus(id: string, status: ClawbotConnectionStatus, lastError?: string): void {
  updateConnectionFields(id, { status, last_error: lastError ?? '' })
}

export function getConnectionStatus(id: string): ClawbotConnectionStatus | null {
  const db = getDatabase()
  const row = db.prepare('SELECT status FROM clawbot_connections WHERE id=?').get(id) as any
  return row?.status ?? null
}

/** 启动/热切换时的僵尸状态清理：connecting 是进程级暂态，进程重启后必然已死；
 * paused_until 一并清空——否则重启后桥显示「连接中」却在空转等暂停到期 */
export function cleanupStaleClawbotState(): void {
  const db = getDatabase()
  db.prepare(
    `UPDATE clawbot_connections SET status='offline', paused_until='', updated_at=? WHERE status IN ('connecting','paused')`
  ).run(new Date().toISOString())
}

// ===== peer 映射 =====

export function getPeer(connectionId: string, peerId: string): ClawbotPeer | null {
  const db = getDatabase()
  const row = db
    .prepare('SELECT * FROM clawbot_peers WHERE connection_id=? AND peer_id=?')
    .get(connectionId, peerId) as ClawbotPeer | undefined
  return row || null
}

/** 按会话反查 peer（事件驱动补发：core-tools 完成事件只带 conversationId） */
export function getPeerByConversation(connectionId: string, conversationId: string): ClawbotPeer | null {
  const db = getDatabase()
  const row = db
    .prepare('SELECT * FROM clawbot_peers WHERE connection_id=? AND conversation_id=?')
    .get(connectionId, conversationId) as ClawbotPeer | undefined
  return row || null
}

export function ensurePeer(connectionId: string, peerId: string): ClawbotPeer {
  const existing = getPeer(connectionId, peerId)
  if (existing) return existing
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO clawbot_peers (id, connection_id, peer_id, conversation_id, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, ?)`
  ).run(uuid(), connectionId, peerId, now, now)
  return getPeer(connectionId, peerId)!
}

export function updatePeerConversation(peerRowId: string, conversationId: string): void {
  const db = getDatabase()
  db.prepare('UPDATE clawbot_peers SET conversation_id=?, updated_at=? WHERE id=?')
    .run(conversationId, new Date().toISOString(), peerRowId)
}

export function updatePeerContextToken(peerRowId: string, token: string): void {
  const db = getDatabase()
  db.prepare('UPDATE clawbot_peers SET last_context_token=?, updated_at=? WHERE id=?')
    .run(token, new Date().toISOString(), peerRowId)
}

export function touchPeerMessageAt(peerRowId: string): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare('UPDATE clawbot_peers SET last_message_at=?, updated_at=? WHERE id=?').run(now, now, peerRowId)
}

/** 推进已发水位（MAX 防并发 flush 乱序完成时水位倒退） */
export function updatePeerLastSentRowid(peerRowId: string, rowid: number): void {
  const db = getDatabase()
  db.prepare('UPDATE clawbot_peers SET last_sent_rowid=MAX(last_sent_rowid, ?), updated_at=? WHERE id=?')
    .run(rowid, new Date().toISOString(), peerRowId)
}

export function listPeers(connectionId: string): ClawbotPeerSummary[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT p.id, p.peer_id, p.conversation_id, COALESCE(c.title, '') AS conversation_title, p.last_message_at
       FROM clawbot_peers p LEFT JOIN conversations c ON c.id = p.conversation_id
       WHERE p.connection_id=?
       ORDER BY p.last_message_at DESC, p.created_at DESC`
    )
    .all(connectionId) as ClawbotPeerSummary[]
}

export function countPeers(connectionId: string): number {
  const db = getDatabase()
  const row = db.prepare('SELECT COUNT(*) AS n FROM clawbot_peers WHERE connection_id=?').get(connectionId) as any
  return Number(row?.n || 0)
}

// ===== 日志 =====

export function insertLog(p: {
  connection_id: string
  peer_id?: string
  direction: 'in' | 'out'
  msg_type?: string
  summary: string
  status?: 'ok' | 'error' | 'dropped'
  error?: string
}): void {
  try {
    const db = getDatabase()
    db.prepare(
      `INSERT INTO clawbot_logs (id, connection_id, peer_id, direction, msg_type, summary, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uuid(),
      p.connection_id,
      p.peer_id || '',
      p.direction,
      p.msg_type || 'text',
      (p.summary || '').slice(0, 200),
      p.status || 'ok',
      p.error || '',
      new Date().toISOString()
    )
  } catch (e) {
    console.error('[clawbot] insertLog failed:', e)
  }
}

/** 日志分页：rowid（插入序≈时间序）游标，避免同毫秒记录在页边界被静默丢弃 */
export function listLogs(beforeId?: string, limit = 50): ClawbotLog[] {
  const db = getDatabase()
  if (beforeId) {
    return db
      .prepare('SELECT * FROM clawbot_logs WHERE rowid < (SELECT rowid FROM clawbot_logs WHERE id=?) ORDER BY rowid DESC LIMIT ?')
      .all(beforeId, limit) as ClawbotLog[]
  }
  return db.prepare('SELECT * FROM clawbot_logs ORDER BY rowid DESC LIMIT ?').all(limit) as ClawbotLog[]
}

/** 日志保留最近 N 天 */
export function pruneClawbotLogs(days = 7): void {
  const db = getDatabase()
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString()
  db.prepare('DELETE FROM clawbot_logs WHERE created_at < ?').run(cutoff)
}

/** 今日已外发计数（按本地零点起算，用于日发送限额风控） */
export function countTodayOutgoing(): number {
  const db = getDatabase()
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM clawbot_logs WHERE direction='out' AND status='ok' AND created_at >= ?")
    .get(midnight.toISOString()) as any
  return Number(row?.n || 0)
}
