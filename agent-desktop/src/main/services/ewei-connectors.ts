import { v4 as uuid } from 'uuid'
import { getDatabase } from '../database'
// 复用 matting 的加解密三件套：AES-256-GCM + device-id 经 scrypt 派生 key，
// 密文格式 v1:{iv_hex}:{tag_hex}:{ct_hex}。跨设备不可解密（device-id 只存本机），
// 故 ewei_connectors 必须排除云同步（见 sync/registry.ts）。
import { encryptSecret, decryptSecret } from './matting-providers'

/**
 * ewei 商城连接器（本地存）：
 *   - 域名 / 账号明文存（列表展示）
 *   - 登录密码 AES-256-GCM 加密存：会话 7200s 滑动过期，必须能解密后静默重登，
 *     这与 matting 只存「不可逆使用的密钥」不同——是「代客登录」的显式安全取舍。
 *   - session_id 不落库：纯内存态（services/ewei-client.ts 的 sessionStore），
 *     进程退出即丢，下次用存的 password 重新登录。
 */

export interface EweiConnector {
  id: string
  name: string
  base_url: string
  account: string
  password_enc: string
  account_version: string
  shop_version: string
  /** 对接平台：'ewei' / 'dianda' …（多商城泛化，旧行默认 ewei）。 */
  platform: string
  /** 各平台专属参数 JSON（如点大的 cookie/remember），仅主进程用，不下发 renderer。 */
  extra_json: string
  current_shop_id: number
  current_shop_name: string
  is_default: number
  last_login_at: string
  last_login_status: string
  last_login_message: string
  created_at: string
  updated_at: string
}

/** 列表/详情返回类型（不暴露密文 / extra_json，账号 masked）。 */
export interface EweiConnectorSummary {
  id: string
  name: string
  base_url: string
  account_masked: string
  account_version: string
  shop_version: string
  platform: string
  current_shop_id: number
  current_shop_name: string
  is_default: boolean
  last_login_at: string
  last_login_status: string
  last_login_message: string
  created_at: string
  updated_at: string
}

function maskAccount(account: string): string {
  if (!account) return ''
  if (account.length <= 4) return '****'
  if (account.length <= 8) return account.slice(0, 2) + '****'
  return account.slice(0, 3) + '****' + account.slice(-2)
}

/** 规范化域名：补 https://、补结尾斜杠。 */
export function normalizeBaseUrl(input: string): string {
  let u = (input || '').trim()
  if (!u) return ''
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  if (!u.endsWith('/')) u += '/'
  return u
}

export function toSummary(row: EweiConnector): EweiConnectorSummary {
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    account_masked: maskAccount(row.account),
    account_version: row.account_version,
    shop_version: row.shop_version,
    platform: row.platform || 'ewei',
    current_shop_id: row.current_shop_id,
    current_shop_name: row.current_shop_name,
    is_default: !!row.is_default,
    last_login_at: row.last_login_at,
    last_login_status: row.last_login_status,
    last_login_message: row.last_login_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

// ===== CRUD =====

export function listConnectors(): EweiConnectorSummary[] {
  const db = getDatabase()
  const rows = db
    .prepare('SELECT * FROM ewei_connectors ORDER BY is_default DESC, created_at ASC')
    .all() as EweiConnector[]
  return rows.map(toSummary)
}

export function getConnector(id: string): EweiConnector | null {
  const db = getDatabase()
  return (db.prepare('SELECT * FROM ewei_connectors WHERE id = ?').get(id) as EweiConnector) || null
}

export function getConnectorSummary(id: string): EweiConnectorSummary | null {
  const row = getConnector(id)
  return row ? toSummary(row) : null
}

export interface CreateConnectorInput {
  name: string
  base_url: string
  account: string
  password: string // 明文，函数内加密
  account_version?: string
  shop_version?: string
  /** 对接平台，缺省 'ewei'。决定主进程用哪个协议适配器。 */
  platform?: string
  is_default?: boolean
}

export function createConnector(data: CreateConnectorInput): EweiConnectorSummary {
  if (!data.name?.trim()) throw new Error('名称不能为空')
  const base = normalizeBaseUrl(data.base_url)
  if (!base) throw new Error('域名不能为空')
  if (!data.account?.trim()) throw new Error('账号不能为空')
  if (!data.password?.trim()) throw new Error('密码不能为空')

  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()

  if (data.is_default) {
    db.prepare('UPDATE ewei_connectors SET is_default = 0').run()
  }

  db.prepare(`INSERT INTO ewei_connectors
    (id, name, base_url, account, password_enc, account_version, shop_version, platform, extra_json,
     current_shop_id, current_shop_name, is_default,
     last_login_at, last_login_status, last_login_message, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 0, '', ?, '', '', '', ?, ?)`).run(
    id,
    data.name.trim(),
    base,
    data.account.trim(),
    encryptSecret(data.password),
    data.account_version || '2.1.6',
    data.shop_version || '4.6.11',
    (data.platform || 'ewei').trim(),
    data.is_default ? 1 : 0,
    now,
    now,
  )
  return toSummary(getConnector(id)!)
}

export interface UpdateConnectorInput {
  name?: string
  base_url?: string
  account?: string
  /** 留空表示不修改密码；非空时重新加密存 */
  password?: string
  account_version?: string
  shop_version?: string
  is_default?: boolean
}

export function updateConnector(id: string, data: UpdateConnectorInput): EweiConnectorSummary {
  const db = getDatabase()
  const existing = getConnector(id)
  if (!existing) throw new Error('连接器不存在')

  const sets: string[] = []
  const params: any[] = []

  if (data.name !== undefined) {
    if (!data.name.trim()) throw new Error('名称不能为空')
    sets.push('name = ?')
    params.push(data.name.trim())
  }
  if (data.base_url !== undefined) {
    const base = normalizeBaseUrl(data.base_url)
    if (!base) throw new Error('域名不能为空')
    sets.push('base_url = ?')
    params.push(base)
  }
  if (data.account !== undefined) {
    if (!data.account.trim()) throw new Error('账号不能为空')
    sets.push('account = ?')
    params.push(data.account.trim())
  }
  if (data.password) {
    sets.push('password_enc = ?')
    params.push(encryptSecret(data.password))
  }
  if (data.account_version !== undefined) {
    sets.push('account_version = ?')
    params.push(data.account_version)
  }
  if (data.shop_version !== undefined) {
    sets.push('shop_version = ?')
    params.push(data.shop_version)
  }
  if (data.is_default !== undefined) {
    if (data.is_default) {
      db.prepare('UPDATE ewei_connectors SET is_default = 0 WHERE id != ?').run(id)
    }
    sets.push('is_default = ?')
    params.push(data.is_default ? 1 : 0)
  }

  if (!sets.length) return toSummary(existing)

  sets.push('updated_at = ?')
  params.push(new Date().toISOString())
  params.push(id)

  db.prepare(`UPDATE ewei_connectors SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  return toSummary(getConnector(id)!)
}

export function deleteConnector(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM ewei_connectors WHERE id = ?').run(id)
  return result.changes > 0
}

/** 取明文账号/密码 + 平台/扩展参数（仅在适配器登录时用，用完即丢，不传 renderer）。 */
export function resolveCredentials(
  id: string,
): {
  base_url: string
  account: string
  password: string
  account_version: string
  shop_version: string
  platform: string
  extra: Record<string, any>
} | null {
  const row = getConnector(id)
  if (!row) return null
  // 密文用本机 device-id 派生密钥 AES-GCM 加密；换设备/重装/数据迁移会导致 device-id 变化，
  // 解密认证失败会抛 "Unsupported state or unable to authenticate data"。转成可操作提示。
  let password: string
  try {
    password = decryptSecret(row.password_enc)
  } catch {
    throw new Error('连接器密码无法解密（本机密钥已变化，常见于更换设备、重装应用或数据迁移）。请点该连接器的「编辑」重新输入一次密码并保存，然后再登录。')
  }
  return {
    base_url: row.base_url,
    account: row.account,
    password,
    account_version: row.account_version,
    shop_version: row.shop_version,
    platform: row.platform || 'ewei',
    extra: parseExtra(row.extra_json),
  }
}

function parseExtra(s: string): Record<string, any> {
  try {
    const o = JSON.parse(s || '{}')
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}

/** 读连接器 extra_json（各平台专属参数，如点大 cookie/remember）。 */
export function getExtra(id: string): Record<string, any> {
  const row = getConnector(id)
  return row ? parseExtra(row.extra_json) : {}
}

/** 合并写入 extra_json（浅合并；传 null 值删除该键）。供适配器持久化会话 cookie 等。 */
export function setExtra(id: string, patch: Record<string, any>): void {
  const db = getDatabase()
  const cur = getExtra(id)
  for (const k of Object.keys(patch)) {
    if (patch[k] === null || patch[k] === undefined) delete cur[k]
    else cur[k] = patch[k]
  }
  db.prepare('UPDATE ewei_connectors SET extra_json = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(cur),
    new Date().toISOString(),
    id,
  )
}

/** 记录当前选中门店（切店成功后调用）。 */
export function setCurrentShop(id: string, shopId: number, shopName: string): void {
  const db = getDatabase()
  db.prepare(
    'UPDATE ewei_connectors SET current_shop_id = ?, current_shop_name = ?, updated_at = ? WHERE id = ?',
  ).run(shopId, shopName || '', new Date().toISOString(), id)
}

export function updateLoginResult(id: string, status: 'success' | 'failed', message: string): void {
  const db = getDatabase()
  db.prepare(
    'UPDATE ewei_connectors SET last_login_at = ?, last_login_status = ?, last_login_message = ?, updated_at = ? WHERE id = ?',
  ).run(new Date().toISOString(), status, (message || '').slice(0, 500), new Date().toISOString(), id)
}

// ===== 商品图替换审计日志 =====

export interface EweiImageLog {
  id: string
  connector_id: string
  shop_id: number
  goods_id: number
  goods_title: string
  slot: string
  old_value_json: string
  new_paths_json: string
  status: string
  error: string
  created_at: string
}

export function createImageLog(input: {
  connectorId: string
  shopId: number
  goodsId: number
  goodsTitle: string
  slot: string
  oldValue: any
}): string {
  const db = getDatabase()
  const id = uuid()
  db.prepare(
    `INSERT INTO ewei_goods_image_logs
      (id, connector_id, shop_id, goods_id, goods_title, slot, old_value_json, new_paths_json, status, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'pending', '', ?)`,
  ).run(
    id,
    input.connectorId,
    input.shopId,
    input.goodsId,
    input.goodsTitle || '',
    input.slot,
    JSON.stringify(input.oldValue ?? null),
    new Date().toISOString(),
  )
  return id
}

export function updateImageLog(
  id: string,
  patch: { status?: string; newPaths?: string[]; error?: string; goodsTitle?: string; oldValue?: any },
): void {
  const db = getDatabase()
  const sets: string[] = []
  const params: any[] = []
  if (patch.status !== undefined) {
    sets.push('status = ?')
    params.push(patch.status)
  }
  if (patch.newPaths !== undefined) {
    sets.push('new_paths_json = ?')
    params.push(JSON.stringify(patch.newPaths))
  }
  if (patch.error !== undefined) {
    sets.push('error = ?')
    params.push((patch.error || '').slice(0, 500))
  }
  // 以下两项为后置补写：部分适配器（如 qdyun）建日志时拿不到 title/原值，进编辑器后再回填。
  if (patch.goodsTitle !== undefined) {
    sets.push('goods_title = ?')
    params.push((patch.goodsTitle || '').slice(0, 255))
  }
  if (patch.oldValue !== undefined) {
    sets.push('old_value_json = ?')
    params.push(JSON.stringify(patch.oldValue ?? null))
  }
  if (!sets.length) return
  params.push(id)
  db.prepare(`UPDATE ewei_goods_image_logs SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export function listImageLogs(goodsId: number, limit = 50): EweiImageLog[] {
  const db = getDatabase()
  return db
    .prepare(
      'SELECT * FROM ewei_goods_image_logs WHERE goods_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(goodsId, limit) as EweiImageLog[]
}
