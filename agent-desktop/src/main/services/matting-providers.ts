import { v4 as uuid } from 'uuid'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { getDatabase } from '../database'
import { getDeviceId } from './device-id'

/**
 * 抠图自定义接口（本地存）：
 *   - 阿里 AccessKey ID 明文存（列表展示需要 masked 显示）
 *   - AccessKey Secret 用 AES-256-GCM 加密存，key 由 device-id 经 scrypt 派生
 *   - 不走 keytar：避免引入 native module，电子签名后 Win/Mac 跨平台无依赖问题
 *
 * 安全权衡：
 *   - 不抵御「拿到整个 dataDir」的攻击（device-id 文件也在 dataDir 里）
 *   - 但比明文存好一档：单纯导出 DB 文件无法解密
 *   - 真正高安全需求的用户可以用云控端模式（凭证在服务器，不下发桌面）
 *
 * 加密字段格式：v1:{iv_hex}:{authTag_hex}:{ciphertext_hex}
 *   - v1 留版本号便于后续算法升级
 *   - iv 12 字节（GCM 推荐）
 *   - authTag 16 字节
 */

const ALGO = 'aes-256-gcm'
const SALT = 'agent-matting-v1' // 派生 key 用的固定 salt（device-id 已经是随机的）

export interface MattingProvider {
  id: string
  name: string
  type: 'aliyun_viapi'
  access_key_id: string
  access_key_secret_enc: string
  endpoint: string
  region_id: string
  is_default: number
  remark: string
  last_test_at: string
  last_test_status: string
  last_test_message: string
  created_at: string
  updated_at: string
}

/** 列表返回类型（不暴露密文，但暴露 ak 前后 4 位用于展示） */
export interface MattingProviderSummary {
  id: string
  name: string
  type: 'aliyun_viapi'
  access_key_id_masked: string
  endpoint: string
  region_id: string
  is_default: boolean
  remark: string
  last_test_at: string
  last_test_status: string
  last_test_message: string
  created_at: string
  updated_at: string
}

// ===== 加密 / 解密 =====

function deriveKey(): Buffer {
  // scryptSync(N=16384,r=8,p=1) 在 i7 上约 80ms，启动一次缓存即可
  return scryptSync(getDeviceId(), SALT, 32)
}

let cachedKey: Buffer | null = null
function getKey(): Buffer {
  if (!cachedKey) cachedKey = deriveKey()
  return cachedKey
}

export function encryptSecret(plain: string): string {
  if (!plain) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, getKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

export function decryptSecret(blob: string): string {
  if (!blob) return ''
  const parts = blob.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted secret format')
  }
  const iv  = Buffer.from(parts[1], 'hex')
  const tag = Buffer.from(parts[2], 'hex')
  const enc = Buffer.from(parts[3], 'hex')
  const decipher = createDecipheriv(ALGO, getKey(), iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(enc), decipher.final()])
  return dec.toString('utf8')
}

function maskAk(ak: string): string {
  if (!ak) return ''
  if (ak.length <= 8) return '****'
  return ak.slice(0, 4) + '****' + ak.slice(-4)
}

function toSummary(row: MattingProvider): MattingProviderSummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    access_key_id_masked: maskAk(row.access_key_id),
    endpoint: row.endpoint,
    region_id: row.region_id,
    is_default: !!row.is_default,
    remark: row.remark,
    last_test_at: row.last_test_at,
    last_test_status: row.last_test_status,
    last_test_message: row.last_test_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

// ===== CRUD =====

export function listProviders(): MattingProviderSummary[] {
  const db = getDatabase()
  const rows = db.prepare(
    'SELECT * FROM matting_providers ORDER BY is_default DESC, created_at ASC'
  ).all() as MattingProvider[]
  return rows.map(toSummary)
}

export function getDefaultProvider(): MattingProvider | null {
  const db = getDatabase()
  // 优先 is_default=1；其次按创建时间最早的
  const row = db.prepare(
    'SELECT * FROM matting_providers ORDER BY is_default DESC, created_at ASC LIMIT 1'
  ).get() as MattingProvider | undefined
  return row || null
}

export function getProvider(id: string): MattingProvider | null {
  const db = getDatabase()
  return (db.prepare('SELECT * FROM matting_providers WHERE id = ?').get(id) as MattingProvider) || null
}

export interface CreateProviderInput {
  name: string
  access_key_id: string
  access_key_secret: string // 明文，函数内加密
  endpoint?: string
  region_id?: string
  is_default?: boolean
  remark?: string
}

export function createProvider(data: CreateProviderInput): MattingProviderSummary {
  if (!data.name?.trim()) throw new Error('名称不能为空')
  if (!data.access_key_id?.trim()) throw new Error('Access Key ID 不能为空')
  if (!data.access_key_secret?.trim()) throw new Error('Access Key Secret 不能为空')

  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()

  // is_default 唯一：开启新行时清掉其他行
  if (data.is_default) {
    db.prepare('UPDATE matting_providers SET is_default = 0').run()
  }

  db.prepare(`INSERT INTO matting_providers
    (id, name, type, access_key_id, access_key_secret_enc, endpoint, region_id, is_default, remark,
     last_test_at, last_test_status, last_test_message, created_at, updated_at)
    VALUES (?, ?, 'aliyun_viapi', ?, ?, ?, ?, ?, ?, '', '', '', ?, ?)`)
    .run(
      id,
      data.name.trim(),
      data.access_key_id.trim(),
      encryptSecret(data.access_key_secret),
      data.endpoint || 'imageseg.cn-shanghai.aliyuncs.com',
      data.region_id || 'cn-shanghai',
      data.is_default ? 1 : 0,
      data.remark || '',
      now, now,
    )
  return toSummary(getProvider(id)!)
}

export interface UpdateProviderInput {
  name?: string
  access_key_id?: string
  /** 留空表示不修改密钥；非空时重新加密存 */
  access_key_secret?: string
  endpoint?: string
  region_id?: string
  is_default?: boolean
  remark?: string
}

export function updateProvider(id: string, data: UpdateProviderInput): MattingProviderSummary {
  const db = getDatabase()
  const existing = getProvider(id)
  if (!existing) throw new Error('Provider not found')

  const sets: string[] = []
  const params: any[] = []

  if (data.name !== undefined)     { sets.push('name = ?');          params.push(data.name.trim()) }
  if (data.access_key_id !== undefined) {
    if (!data.access_key_id.trim()) throw new Error('Access Key ID 不能为空')
    sets.push('access_key_id = ?'); params.push(data.access_key_id.trim())
  }
  if (data.access_key_secret) { // 非空才更新（空字符串视为不变）
    sets.push('access_key_secret_enc = ?'); params.push(encryptSecret(data.access_key_secret))
  }
  if (data.endpoint !== undefined)  { sets.push('endpoint = ?');      params.push(data.endpoint) }
  if (data.region_id !== undefined) { sets.push('region_id = ?');     params.push(data.region_id) }
  if (data.remark !== undefined)    { sets.push('remark = ?');        params.push(data.remark) }

  if (data.is_default !== undefined) {
    if (data.is_default) {
      // 把其他行的 default 关掉
      db.prepare('UPDATE matting_providers SET is_default = 0 WHERE id != ?').run(id)
    }
    sets.push('is_default = ?')
    params.push(data.is_default ? 1 : 0)
  }

  if (!sets.length) return toSummary(existing)

  sets.push('updated_at = ?')
  params.push(new Date().toISOString())
  params.push(id)

  db.prepare(`UPDATE matting_providers SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  return toSummary(getProvider(id)!)
}

export function deleteProvider(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM matting_providers WHERE id = ?').run(id)
  return result.changes > 0
}

/**
 * 取一条 provider 的明文 AK/SK（仅在调用阿里 SDK 时使用）。
 * 调用方拿到后立即用完即丢，不要传给 renderer。
 */
export function resolveCredentials(id: string): {
  access_key_id: string
  access_key_secret: string
  endpoint: string
  region_id: string
} | null {
  const row = getProvider(id)
  if (!row) return null
  return {
    access_key_id: row.access_key_id,
    access_key_secret: decryptSecret(row.access_key_secret_enc),
    endpoint: row.endpoint,
    region_id: row.region_id,
  }
}

export function updateTestResult(id: string, status: 'success' | 'failed', message: string): void {
  const db = getDatabase()
  db.prepare(
    'UPDATE matting_providers SET last_test_at = ?, last_test_status = ?, last_test_message = ?, updated_at = ? WHERE id = ?'
  ).run(new Date().toISOString(), status, message.slice(0, 500), new Date().toISOString(), id)
}
