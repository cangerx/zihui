import { createHash } from 'crypto'
import { join, isAbsolute, extname } from 'path'
import { existsSync, readFileSync } from 'fs'
import { getDatabase } from '../../database'
import { getDataDir } from '../data-path'
import { ENTITY_MAP } from './registry'
import type { BlobRef, EntityPayload, SyncCategory } from './types'
import { ingestBytes, ingestFile, ensureLocalBlob } from './blob'

// ============================================================================
// 序列化层：业务行 ↔ 同步 payload
//   - JSON 列解析为结构（便于融合），apply 时还原为字符串
//   - 媒体字段外置为 content-addressed blob，payload 内仅留 sync-blob://{sha} 占位
//   - 媒体「形态」(绝对/相对/local-file协议/data URL) 记录在 blob ref，apply 时按原形态还原
//   - content_hash 排除时间列，避免「仅时间戳变动」造成的伪同步
// ============================================================================

const BLOB_PREFIX = 'sync-blob://'
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'])
/** 时间列：不参与 content_hash，也不参与合并冲突判定（merge.ts 共用）。 */
export const TIME_COLS = new Set(['created_at', 'updated_at'])

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  m4v: 'video/x-m4v', avi: 'video/x-msvideo',
}

function extToMime(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] || 'application/octet-stream'
}

function mimeToExt(mime: string): string {
  const hit = Object.entries(MIME_BY_EXT).find(([, m]) => m === mime)
  return hit ? hit[0] : 'bin'
}

function pickCategory(want: SyncCategory | 'auto', ext: string): SyncCategory {
  if (want !== 'auto') return want
  return VIDEO_EXTS.has(ext.toLowerCase()) ? 'video' : 'image'
}

/** 把业务表 datetime 文本（'YYYY-MM-DD HH:MM:SS'，UTC）转毫秒。 */
export function parseDbTimeMs(s: any): number {
  if (s === null || s === undefined) return 0
  const str = String(s).trim()
  if (!str) return 0
  const iso = str.includes('T') ? str : str.replace(' ', 'T') + 'Z'
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : 0
}

interface ColumnInfo {
  type: string
  notnull: boolean
  hasDefault: boolean
}

function tableInfo(entity: string): Map<string, ColumnInfo> {
  const db = getDatabase()
  const cols = db.prepare(`PRAGMA table_info(${entity})`).all() as any[]
  const map = new Map<string, ColumnInfo>()
  for (const c of cols) {
    map.set(String(c.name), {
      type: String(c.type || ''),
      notnull: !!c.notnull,
      hasDefault: c.dflt_value !== null && c.dflt_value !== undefined,
    })
  }
  return map
}

// ---- 媒体值的形态解析 ----

type BlobForm = 'abs' | 'rel' | 'protocol' | 'dataurl'

interface IngestedValue {
  placeholder: string
  ref: BlobRef
}

/** 尝试把一个标量值外置为 blob；不可外置（空 / http 外链 / 文件不存在）则返回 null。 */
function ingestScalar(value: any, category: SyncCategory | 'auto'): IngestedValue | null {
  if (typeof value !== 'string' || value === '') return null
  const v = value.trim()
  if (v.startsWith(BLOB_PREFIX)) return null // 已是占位（幂等）
  if (/^https?:\/\//i.test(v)) return null // 外链不外置

  // data URL
  if (v.startsWith('data:')) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(v)
    if (!m) return null
    const mime = m[1] || 'application/octet-stream'
    const isB64 = !!m[2]
    const ext = mimeToExt(mime)
    const bytes = isB64 ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf-8')
    const cat = pickCategory(category, ext)
    const core = ingestBytes(bytes, cat, ext)
    return { placeholder: BLOB_PREFIX + core.sha256, ref: { ...core, category: cat, ext, form: 'dataurl', mime } as BlobRef }
  }

  // local-file://img?p=<abs>
  let absPath = ''
  let form: BlobForm
  if (v.startsWith('local-file://')) {
    try {
      const u = new URL(v)
      absPath = u.searchParams.get('p') || ''
    } catch {
      absPath = ''
    }
    if (!absPath) return null
    form = 'protocol'
  } else if (isAbsolute(v)) {
    absPath = v
    form = 'abs'
  } else {
    absPath = join(getDataDir(), v)
    form = 'rel'
  }

  if (!existsSync(absPath)) return null
  const ext = (extname(absPath).slice(1) || 'bin').toLowerCase()
  const cat = pickCategory(category, ext)
  const core = ingestFile(absPath, cat)
  return {
    placeholder: BLOB_PREFIX + core.sha256,
    ref: { sha256: core.sha256, size: core.size, category: cat, ext, form, mime: extToMime(ext) } as BlobRef,
  }
}

// 递归把结构里的字符串外置（用于 attachments / jsonPaths）
function ingestDeep(
  node: any,
  category: SyncCategory | 'auto',
  collected: BlobRef[],
  keyFilter?: string[],
): any {
  if (Array.isArray(node)) return node.map((x) => ingestDeep(x, category, collected, keyFilter))
  if (node && typeof node === 'object') {
    const out: any = {}
    for (const [k, val] of Object.entries(node)) {
      if (typeof val === 'string' && (!keyFilter || keyFilter.includes(k))) {
        const got = ingestScalar(val, category)
        if (got) {
          collected.push(got.ref)
          out[k] = got.placeholder
          continue
        }
      }
      out[k] = ingestDeep(val, category, collected, keyFilter)
    }
    return out
  }
  if (typeof node === 'string' && !keyFilter) {
    const got = ingestScalar(node, category)
    if (got) {
      collected.push(got.ref)
      return got.placeholder
    }
  }
  return node
}

/** 读取并序列化一行业务数据为 payload（媒体外置到本地 blob 缓存，登记待上传）。 */
export function serializeRow(entity: string, row: Record<string, any>): EntityPayload {
  const def = ENTITY_MAP[entity]
  if (!def) throw new Error(`unknown sync entity: ${entity}`)
  const skip = new Set(def.skipColumns || [])
  const jsonSet = new Set(def.jsonFields || [])
  const fields: Record<string, any> = {}

  for (const [col, val] of Object.entries(row)) {
    if (col === 'id') continue
    if (skip.has(col)) continue
    if (jsonSet.has(col)) {
      try {
        fields[col] = val === null || val === undefined || val === '' ? null : JSON.parse(String(val))
      } catch {
        fields[col] = null
      }
    } else {
      fields[col] = val
    }
  }

  const blobs: BlobRef[] = []
  for (const spec of def.blobFields || []) {
    const cur = fields[spec.field]
    if (cur === undefined || cur === null) continue
    if (spec.kind === 'path') {
      const got = ingestScalar(cur, spec.category)
      if (got) {
        blobs.push(got.ref)
        fields[spec.field] = got.placeholder
      }
    } else if (spec.kind === 'pathArray') {
      if (Array.isArray(cur)) {
        fields[spec.field] = cur.map((item) => {
          const got = ingestScalar(item, spec.category)
          if (got) {
            blobs.push(got.ref)
            return got.placeholder
          }
          return item
        })
      }
    } else if (spec.kind === 'attachments') {
      fields[spec.field] = ingestDeep(cur, spec.category, blobs)
    } else if (spec.kind === 'jsonPaths') {
      fields[spec.field] = ingestDeep(cur, spec.category, blobs, spec.jsonKeys)
    }
  }

  const updated_ms =
    parseDbTimeMs(row[def.updatedField || 'updated_at']) || parseDbTimeMs(row['created_at'])

  return { entity, uid: String(row.id), fields, blobs, updated_ms }
}

/** 读当前业务行（不存在返回 null）。 */
export function readRow(entity: string, uid: string): Record<string, any> | null {
  const db = getDatabase()
  const row = db.prepare(`SELECT * FROM ${entity} WHERE id = ?`).get(uid) as any
  return row || null
}

/** 读并序列化当前业务行。 */
export function serializeCurrent(entity: string, uid: string): EntityPayload | null {
  const row = readRow(entity, uid)
  if (!row) return null
  return serializeRow(entity, row)
}

// ---- content hash（排除时间列；媒体以 sha 参与） ----

export function stableStringify(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  const keys = Object.keys(v).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}'
}

export function contentHash(payload: EntityPayload): string {
  const fields: Record<string, any> = {}
  for (const [k, val] of Object.entries(payload.fields)) {
    if (TIME_COLS.has(k)) continue
    fields[k] = val
  }
  const blobShas = [...payload.blobs.map((b) => b.sha256)].sort()
  return createHash('sha256').update(stableStringify({ fields, blobShas })).digest('hex')
}

// ---- 反序列化 + 落库 ----

function blobToValue(placeholder: string, refMap: Map<string, BlobRef>): string {
  const sha = placeholder.slice(BLOB_PREFIX.length)
  const ref = refMap.get(sha)
  if (!ref) return '' // blob 未随本次分类下载（如只同步纯数据）：留空占位，按需再拉
  const absPath = ensureLocalBlob(ref) // 确保已下载到 dataDir/sync-media/{sha}.{ext}
  if (!absPath) return placeholder // 下载失败：保留占位，下次重试
  switch (ref.form) {
    case 'dataurl': {
      try {
        const bytes = readFileSync(absPath)
        return `data:${ref.mime || extToMime(ref.ext)};base64,${bytes.toString('base64')}`
      } catch {
        return ''
      }
    }
    case 'protocol':
      return `local-file://img?p=${encodeURIComponent(absPath)}`
    case 'rel':
      return join('sync-media', `${ref.sha256}.${ref.ext}`)
    case 'abs':
    default:
      return absPath
  }
}

function resolveDeep(node: any, refMap: Map<string, BlobRef>, keyFilter?: string[]): any {
  if (Array.isArray(node)) return node.map((x) => resolveDeep(x, refMap, keyFilter))
  if (node && typeof node === 'object') {
    const out: any = {}
    for (const [k, val] of Object.entries(node)) {
      if (typeof val === 'string' && val.startsWith(BLOB_PREFIX) && (!keyFilter || keyFilter.includes(k))) {
        out[k] = blobToValue(val, refMap)
      } else {
        out[k] = resolveDeep(val, refMap, keyFilter)
      }
    }
    return out
  }
  if (typeof node === 'string' && node.startsWith(BLOB_PREFIX) && !keyFilter) {
    return blobToValue(node, refMap)
  }
  return node
}

/** 把 payload 还原为可写库的行对象（含 id；媒体 placeholder 还原为本地引用）。 */
export function deserializePayload(payload: EntityPayload): Record<string, any> {
  const def = ENTITY_MAP[payload.entity]
  if (!def) throw new Error(`unknown sync entity: ${payload.entity}`)
  const jsonSet = new Set(def.jsonFields || [])
  const refMap = new Map<string, BlobRef>(payload.blobs.map((b) => [b.sha256, b]))
  const fields: Record<string, any> = { ...payload.fields }

  for (const spec of def.blobFields || []) {
    const cur = fields[spec.field]
    if (cur === undefined || cur === null) continue
    if (spec.kind === 'path') {
      if (typeof cur === 'string' && cur.startsWith(BLOB_PREFIX)) fields[spec.field] = blobToValue(cur, refMap)
    } else if (spec.kind === 'pathArray') {
      if (Array.isArray(cur)) {
        fields[spec.field] = cur.map((item) =>
          typeof item === 'string' && item.startsWith(BLOB_PREFIX) ? blobToValue(item, refMap) : item,
        )
      }
    } else if (spec.kind === 'attachments') {
      fields[spec.field] = resolveDeep(cur, refMap)
    } else if (spec.kind === 'jsonPaths') {
      fields[spec.field] = resolveDeep(cur, refMap, spec.jsonKeys)
    }
  }

  const rowObj: Record<string, any> = { id: payload.uid }
  for (const [k, val] of Object.entries(fields)) {
    rowObj[k] = jsonSet.has(k) ? JSON.stringify(val ?? (Array.isArray(val) ? [] : null)) : val
  }
  return rowObj
}

/** UPSERT 一行（动态列；ON CONFLICT DO UPDATE 不级联删子行）。 */
export function applyUpsert(entity: string, rowObj: Record<string, any>): void {
  const db = getDatabase()
  const info = tableInfo(entity)
  const useCols: string[] = []
  const values: any[] = []
  for (const c of Object.keys(rowObj)) {
    const col = info.get(c)
    if (!col) continue
    if (rowObj[c] === undefined) continue
    let v = normalizeForSqlite(rowObj[c])
    if (v === null && col.notnull && c !== 'id') {
      // 远端 payload（旧版本/异常数据）对 NOT NULL 列给了 null：
      // 有列默认值则省略该列交给 DEFAULT，无默认值则按类型兜底，避免约束错误卡死整页同步
      if (col.hasDefault) continue
      v = /INT|REAL|NUM|FLOA|DOUB/i.test(col.type) ? 0 : ''
    }
    useCols.push(c)
    values.push(v)
  }
  if (!useCols.includes('id')) {
    useCols.unshift('id')
    values.unshift(normalizeForSqlite(rowObj.id))
  }
  const placeholders = useCols.map(() => '?').join(', ')
  const updates = useCols
    .filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')
  const sql =
    `INSERT INTO ${entity} (${useCols.join(', ')}) VALUES (${placeholders}) ` +
    (updates ? `ON CONFLICT(id) DO UPDATE SET ${updates}` : 'ON CONFLICT(id) DO NOTHING')
  db.prepare(sql).run(...values)
}

/** better-sqlite3 仅接受 number/string/bigint/Buffer/null：把 bool/对象做兜底转换。 */
function normalizeForSqlite(v: any): any {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'object' && !Buffer.isBuffer(v)) return JSON.stringify(v)
  return v
}

export function applyDelete(entity: string, uid: string): void {
  const db = getDatabase()
  db.prepare(`DELETE FROM ${entity} WHERE id = ?`).run(uid)
}
