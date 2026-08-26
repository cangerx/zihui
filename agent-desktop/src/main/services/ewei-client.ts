import { createCipheriv, randomBytes } from 'crypto'
import { readFileSync } from 'fs'
import { basename } from 'path'
import { BrowserWindow } from 'electron'
import { getAbsolutePath } from './image-generation'
import { makeUploadThumbnail } from './thumbnail-upload'
import * as connectorService from './ewei-connectors'
import { assertSkuSetConsistent } from './mall/guards'

// ============================================================================
// ewei 商城业务端 HTTP 客户端（无界面，主进程）。
//
// 已在真实 ewei 商城环境验证：
//   - 会话仅靠自生成的 `session-id` 头维持（服务端 LocalSession::setSessionId），无需 Cookie。
//   - 密码 AES-128-CBC + ZeroPadding（非 PKCS7），key/iv 为固定 16 字节常量。
//   - 三组接口前缀/编码/版本头不同：account(api/site, 表单, 2.1.6) / shop(shop/manage, JSON, 4.6.11, shop-id 头) / utility(上传, multipart)。
//   - 商品回写须以 details 完整 goods 为基底（缺 title 报错），并规避三条致命路径（见 buildEditPayload）。
// ============================================================================

// 密码加密固定常量（与 ewei 前后端硬编码一致）
const AES_KEY = Buffer.from('eweishop.aes_key', 'utf8') // 16B → AES-128
const AES_IV = Buffer.from('eweishop.aes_iv_', 'utf8') // 16B（末尾下划线，正好16字符）

/** 复刻 CryptoJS AES-128-CBC + ZeroPadding，返回 Base64。已与浏览器端字节级一致验证。 */
export function encryptEweiPassword(plain: string): string {
  const data = Buffer.from(plain, 'utf8')
  const pad = data.length % 16 === 0 ? 0 : 16 - (data.length % 16) // ZeroPadding：整块不补
  const padded = Buffer.concat([data, Buffer.alloc(pad, 0)])
  const cipher = createCipheriv('aes-128-cbc', AES_KEY, AES_IV)
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64')
}

export class EweiError extends Error {
  code: number
  showCaptcha: boolean
  constructor(code: number, message: string, showCaptcha = false) {
    super(message || `ewei 接口错误(${code})`)
    this.name = 'EweiError'
    this.code = code
    this.showCaptcha = showCaptcha
  }
}

// ---- 会话状态（纯内存，进程退出即丢；过期用存的 password 重登）----
interface SessionState {
  sessionId: string
  loggedIn: boolean
  currentShopId: number
  loginInFlight: Promise<EweiLoginResult> | null
  lastReloginAt: number
}
const sessionStore = new Map<string, SessionState>()
const RELOGIN_THROTTLE_MS = 60_000

function getState(connectorId: string): SessionState {
  let st = sessionStore.get(connectorId)
  if (!st) {
    st = { sessionId: randomBytes(16).toString('hex'), loggedIn: false, currentShopId: 0, loginInFlight: null, lastReloginAt: 0 }
    sessionStore.set(connectorId, st)
  }
  return st
}

export function clearSession(connectorId: string): void {
  sessionStore.delete(connectorId)
}

// ---- 进度广播 ----
export interface EweiProgress {
  taskId: string
  goodsId?: number
  phase: 'uploading' | 'saving' | 'done' | 'error'
  current?: number
  total?: number
  message?: string
}
function broadcastProgress(p: EweiProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('ewei:progress', p)
    } catch {
      /* ignore */
    }
  }
}

// ---- 底层请求 ----
type ReqGroup = 'account' | 'shop' | 'utility'

interface ReqOptions {
  method?: 'GET' | 'POST'
  query?: Record<string, string | number>
  /** 表单（account 组）或 JSON（shop 组）body */
  form?: Record<string, string>
  json?: any
  /** multipart（utility 组）*/
  formData?: FormData
  retryOnAuth?: boolean
}

function buildUrl(baseUrl: string, group: ReqGroup, route: string, query?: Record<string, string | number>): string {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'
  let url: string
  if (group === 'account') url = base + 'api/site/' + route
  else if (group === 'shop') url = base + 'shop/manage/' + route
  else url = base + route // utility：route 形如 'utility/attachment/upload'
  if (query && Object.keys(query).length) {
    const qs = Object.entries(query)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    url += (url.includes('?') ? '&' : '?') + qs
  }
  return url
}

async function rawRequest(connectorId: string, group: ReqGroup, route: string, opts: ReqOptions): Promise<any> {
  const creds = connectorService.resolveCredentials(connectorId)
  if (!creds) throw new EweiError(-1, '连接器不存在')
  const st = getState(connectorId)

  const headers: Record<string, string> = {
    'x-requested-with': 'XMLHttpRequest',
    'session-id': st.sessionId,
    version: group === 'account' ? creds.account_version : creds.shop_version,
  }
  if (group !== 'account' && st.currentShopId) headers['shop-id'] = String(st.currentShopId)

  let body: any = undefined
  if (opts.formData) {
    body = opts.formData // 不手动设 Content-Type，让 fetch 注入 multipart boundary
  } else if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.json)
  } else if (opts.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
    body = new URLSearchParams(opts.form).toString()
  }

  const url = buildUrl(creds.base_url, group, route, opts.query)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.formData ? 120_000 : 30_000)
  let res: Response
  try {
    res = await fetch(url, { method: opts.method || 'GET', headers, body, signal: controller.signal })
  } catch (e: any) {
    throw new EweiError(-1, `网络请求失败：${e?.message || e}`)
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    throw new EweiError(-1, `响应非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`)
  }
  return json
}

/** 带统一信封解析 + -10000 自动重登重试一次的请求。 */
async function request(connectorId: string, group: ReqGroup, route: string, opts: ReqOptions = {}): Promise<any> {
  const json = await rawRequest(connectorId, group, route, opts)
  if (json && json.error === 0) return json
  // -10000 登录态失效：重登并重试一次
  if (json && json.error === -10000 && opts.retryOnAuth !== false) {
    await relogin(connectorId)
    return request(connectorId, group, route, { ...opts, retryOnAuth: false })
  }
  if (json && typeof json.error === 'number' && json.error !== 0) {
    throw new EweiError(json.error, json.message || '', !!json.show_captcha)
  }
  return json
}

// ---- 登录 / 会话 ----
export interface EweiLoginResult {
  uid: number
  account: string
  contact: string
  isAdmin: boolean
  isRoot: boolean
  isMerch: boolean
  isSupply: boolean
}

async function doLogin(connectorId: string): Promise<EweiLoginResult> {
  const creds = connectorService.resolveCredentials(connectorId)
  if (!creds) throw new EweiError(-1, '连接器不存在')
  const st = getState(connectorId)
  st.sessionId = randomBytes(16).toString('hex') // 每次登录换新会话 id
  st.loggedIn = false
  st.currentShopId = 0
  let json: any
  try {
    json = await rawRequest(connectorId, 'account', 'account/login/post', {
      method: 'POST',
      form: { account: creds.account, password: encryptEweiPassword(creds.password), bind: '0' },
    })
  } catch (e: any) {
    connectorService.updateLoginResult(connectorId, 'failed', e?.message || '登录失败')
    throw e
  }
  if (!json || json.error !== 0) {
    const msg = json?.message || `登录失败(${json?.error})`
    connectorService.updateLoginResult(connectorId, 'failed', msg)
    throw new EweiError(json?.error ?? -1, msg, !!json?.show_captcha)
  }
  st.loggedIn = true
  const result: EweiLoginResult = {
    uid: Number(json.uid) || 0,
    account: String(json.account || ''),
    contact: String(json.contact || ''),
    isAdmin: !!json.is_admin,
    isRoot: !!json.is_root,
    isMerch: !!json.is_merch,
    isSupply: !!json.is_supply,
  }
  connectorService.updateLoginResult(connectorId, 'success', `已登录：${result.contact || result.account}`)
  // 重登后自动恢复上次选中的门店上下文
  const conn = connectorService.getConnector(connectorId)
  if (conn && conn.current_shop_id) {
    try {
      await doSwitchShop(connectorId, conn.current_shop_id, conn.current_shop_name)
    } catch {
      /* 门店可能已失效，忽略，留待用户重选 */
    }
  }
  return result
}

/** 登录（单飞：并发调用复用同一个 inflight）。 */
export async function login(connectorId: string): Promise<EweiLoginResult> {
  const st = getState(connectorId)
  if (st.loginInFlight) return st.loginInFlight
  const p = doLogin(connectorId).finally(() => {
    st.loginInFlight = null
  })
  st.loginInFlight = p
  return p
}

/** -10000 触发的重登：加节流，避免把账号/IP 打进登录锁。 */
async function relogin(connectorId: string): Promise<void> {
  const st = getState(connectorId)
  const now = Date.now()
  if (st.loginInFlight) {
    await st.loginInFlight
    return
  }
  if (now - st.lastReloginAt < RELOGIN_THROTTLE_MS) {
    throw new EweiError(-10000, '登录态已失效，请稍后重试或重新登录')
  }
  st.lastReloginAt = now
  await login(connectorId)
}

/** 确保已登录；未登录则登录一次。 */
async function ensureSession(connectorId: string): Promise<void> {
  const st = getState(connectorId)
  if (!st.loggedIn) await login(connectorId)
}

export async function logout(connectorId: string): Promise<void> {
  const st = getState(connectorId)
  if (st.loggedIn) {
    try {
      await rawRequest(connectorId, 'account', 'account/logout', { method: 'GET' })
    } catch {
      /* ignore */
    }
  }
  clearSession(connectorId)
}

// ---- 门店 ----
export interface EweiShop {
  id: number
  name: string
  logo: string
  status: number
  showstatus: string | number
  status_text: string
  goods_count: number
  is_root: number
  days: string
}

export async function listShops(connectorId: string, page = 1, pagesize = 50): Promise<{ list: EweiShop[]; count: number }> {
  await ensureSession(connectorId)
  const json = await request(connectorId, 'account', 'account/shops/list', {
    method: 'GET',
    query: { source: 'manage', page, pagesize },
  })
  const list: EweiShop[] = (json.list || []).map((s: any) => ({
    id: Number(s.id),
    name: String(s.name || ''),
    logo: String(s.logo || ''),
    status: Number(s.status) || 0,
    showstatus: s.showstatus,
    status_text: String(s.status_text || ''),
    goods_count: Number(s.goods_count) || 0,
    is_root: Number(s.is_root) || 0,
    days: String(s.days ?? ''),
  }))
  return { list, count: Number(json.count) || list.length }
}

async function doSwitchShop(connectorId: string, shopId: number, shopName: string): Promise<void> {
  const json = await request(connectorId, 'account', 'account/shops/switch', {
    method: 'GET',
    query: { id: shopId, enter_flag: 1 },
  })
  if (json.error !== 0) throw new EweiError(json.error ?? -1, json.message || '切换门店失败')
  const st = getState(connectorId)
  st.currentShopId = shopId
  connectorService.setCurrentShop(connectorId, shopId, shopName)
}

export async function switchShop(connectorId: string, shopId: number, shopName = ''): Promise<{ ok: boolean }> {
  await ensureSession(connectorId)
  await doSwitchShop(connectorId, shopId, shopName)
  return { ok: true }
}

// ---- 商品 ----
export interface EweiGoodsListItem {
  id: number
  title: string
  thumb: string // 列表 thumb 已是完整 URL
  status: number
  has_option: number
  selling_type: number
  type: number
  price: string
}
export interface GoodsListParams {
  page?: number
  pagesize?: number
  title?: string
  status?: string
  category_ids?: string
}

export async function listGoods(
  connectorId: string,
  params: GoodsListParams = {},
): Promise<{ list: EweiGoodsListItem[]; count: number }> {
  await ensureSession(connectorId)
  const st = getState(connectorId)
  if (!st.currentShopId) throw new EweiError(-1, '请先选择门店')
  const query: Record<string, string | number> = {
    page: params.page || 1,
    pagesize: params.pagesize || 20,
  }
  if (params.title) query.title = params.title
  if (params.status) query.status = params.status
  if (params.category_ids) query.category_ids = params.category_ids
  const json = await request(connectorId, 'shop', 'goods/list', { method: 'GET', query })
  const list: EweiGoodsListItem[] = (json.list || []).map((g: any) => ({
    id: Number(g.id),
    title: String(g.title || ''),
    thumb: String(g.thumb || ''),
    status: Number(g.status) || 0,
    has_option: Number(g.has_option) || 0,
    selling_type: Number(g.selling_type) || 0,
    type: Number(g.type) || 0,
    price: String(g.price ?? ''),
  }))
  return { list, count: Number(json.count) || list.length }
}

export interface EweiGoodsDetail {
  goods: any // 详情完整 goods（thumb/thumbs 为相对路径）
  options: any[]
  specs: any[]
}

export async function getGoodsDetail(connectorId: string, goodsId: number): Promise<EweiGoodsDetail> {
  await ensureSession(connectorId)
  const json = await request(connectorId, 'shop', 'goods/details', { method: 'GET', query: { goods_id: goodsId } })
  return {
    goods: json.goods || {},
    options: Array.isArray(json.options) ? json.options : [],
    specs: Array.isArray(json.specs) ? json.specs : [],
  }
}

// ---- 上传 ----
const MAX_UPLOAD_SIDE = 2400 // 超过则等比压缩（同时兜底服务端 max_size 限制）

export interface EweiUploadResult {
  path: string // 相对路径，回写商品用
  url: string // 绝对 url（含 COS 样式），详情图/预览用
  width: number
  height: number
  id: number
}

export async function uploadImage(connectorId: string, localPath: string, filename?: string): Promise<EweiUploadResult> {
  await ensureSession(connectorId)
  const st = getState(connectorId)
  if (!st.currentShopId) throw new EweiError(-1, '请先选择门店')
  const abs = getAbsolutePath(localPath)
  // 放宽到泛型 Buffer: 后续可能赋值压缩后的缩略图 Buffer(makeUploadThumbnail 返回 Buffer<ArrayBufferLike>),
  // 否则新版 @types/node 下 readFileSync 推断的 NonSharedBuffer 收窄会拒绝该赋值(TS2322, 仅类型层面)。
  let buf: Buffer<ArrayBufferLike> = readFileSync(abs)
  let name = filename || basename(abs) || 'image.png'

  const send = async (b: Buffer, n: string): Promise<any> => {
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array(b)]), n)
    fd.append('type', 'image')
    return request(connectorId, 'utility', 'utility/attachment/upload', { method: 'POST', formData: fd })
  }

  let json: any
  try {
    json = await send(buf, name)
  } catch (e: any) {
    // 文件过大：等比压缩为 JPEG 重试一次
    if (e instanceof EweiError && /过大|large|size/i.test(e.message)) {
      const jpeg = makeUploadThumbnail(buf, MAX_UPLOAD_SIDE, 90)
      if (jpeg) {
        buf = jpeg
        name = name.replace(/\.[^.]+$/, '') + '.jpg'
        json = await send(buf, name)
      } else throw e
    } else throw e
  }
  const data = json?.data || {}
  if (!data.path) throw new EweiError(json?.error ?? -1, json?.message || '上传失败：无 path 返回')
  return {
    path: String(data.path),
    url: String(data.url || ''),
    width: Number(data.width) || 0,
    height: Number(data.height) || 0,
    id: Number(data.id) || 0,
  }
}

// ---- 回写 ----
export type EweiImageSlot =
  | 'mainThumb'
  | 'galleryReplace'
  | 'galleryAppend'
  | 'detailAppend'
  | 'detailReplace'
  | 'optionThumb'

export interface ReplaceGoodsImageArgs {
  connectorId: string
  goodsId: number
  slot: EweiImageSlot
  /** 本地图片路径（生图 result_path 相对路径 / 图库绝对路径 / 用户本地文件）。 */
  images: string[]
  /** optionThumb 时目标 SKU 的 option id。 */
  optionId?: number
}

/**
 * 构造安全的 goods/edit 回写 body（见 docs/ewei商城集成-实施方案.md §13.3）。
 *   - 以 details 完整 goods 为基底（含 title 等必填 + dispatch_* 原值，避免「请选择运费模版」整单失败）。
 *   - 剔除读写格式不一致的 diy_share。
 *   - 改主图/图集/详情图：不带 options/specs（optionIds 空 → 后端跳过 SKU 删除）。
 *   - 改 SKU 图：带【完整】options（每个 SKU 的 id 都在），否则未列入的 SKU 会被物理删除。
 */
function buildEditPayload(detail: EweiGoodsDetail, slot: EweiImageSlot, uploaded: EweiUploadResult[], optionId?: number): any {
  const goods: any = { ...detail.goods }
  delete goods.diy_share
  const paths = uploaded.map((u) => u.path)
  const data: any = {}

  if (slot === 'mainThumb') {
    goods.thumb = paths[0]
    if (!Array.isArray(goods.thumbs) || goods.thumbs.length === 0) goods.thumbs = [paths[0]]
  } else if (slot === 'galleryReplace') {
    goods.thumbs = paths.slice()
    if (!goods.thumb) goods.thumb = paths[0]
  } else if (slot === 'galleryAppend') {
    const existing = Array.isArray(goods.thumbs) ? goods.thumbs : []
    goods.thumbs = [...existing, ...paths]
    if (!goods.thumb) goods.thumb = paths[0]
  } else if (slot === 'detailAppend' || slot === 'detailReplace') {
    const blocks = uploaded
      .map((u) => `<p style="text-align:center"><img src="${u.url}" style="max-width:100%;display:block;margin:0 auto;"></p>`)
      .join('')
    // detailAppend：追加到现有 content 末尾；detailReplace：整段替换为新图文
    goods.content = slot === 'detailReplace' ? blocks : String(goods.content || '') + blocks
  }

  data.goods = goods

  // 多规格商品：saveGoods 强制要求 data.specs + data.options 均为非空数组（ShopGoods.php:1134-1138），
  // 否则任何图位的保存都会报「商品规格数据错误」。必须回填【完整】specs+options（含全部 id，与 details 一致），
  // 既满足校验、又避免 deleteAll(['not in','id',$optionIds]) 物理删除未列入的 SKU（ShopGoods.php:2403）。
  // details 的 getSpec/getOptions 与 saveGoods 是同一后端的读/写对（weight/volume 已按 /1000 显示单位返回），
  // 直接回提即官方前端「load 详情→提交编辑」的一致安全往返。
  if (Number(goods.has_option) === 1) {
    if (!detail.options.length || !detail.specs.length) {
      throw new EweiError(-1, '该多规格商品缺少规格/SKU 数据，暂不支持改图（请先在商城后台补全规格）')
    }
    const options = detail.options.map((o: any) => ({ ...o }))
    if (slot === 'optionThumb') {
      const target = options.find((o: any) => Number(o.id) === Number(optionId))
      if (!target) throw new EweiError(-1, '未找到目标 SKU')
      target.thumb = paths[0]
    }
    // 一致性兜底：每个 option 必须有数字 id；缺 id 会被当新增、其它 SKU 被物理删除
    if (options.some((o: any) => !Number(o.id))) {
      throw new EweiError(-1, 'SKU 数据异常（缺少 id），已中止以避免误删')
    }
    data.options = options
    data.specs = detail.specs.map((s: any) => ({ ...s }))
  } else if (slot === 'optionThumb') {
    throw new EweiError(-1, '该商品无多规格，无法替换 SKU 图')
  }

  return data
}

/** 取回写后用于审计/回滚的「原值」快照。 */
function snapshotOldValue(detail: EweiGoodsDetail, slot: EweiImageSlot, optionId?: number): any {
  const g = detail.goods
  if (slot === 'mainThumb') return { thumb: g.thumb }
  if (slot === 'galleryReplace' || slot === 'galleryAppend') return { thumbs: g.thumbs }
  if (slot === 'detailAppend' || slot === 'detailReplace') return { content: String(g.content || '') }
  if (slot === 'optionThumb') {
    const o = detail.options.find((x: any) => Number(x.id) === Number(optionId))
    return { optionId, thumb: o?.thumb }
  }
  return null
}

/**
 * 核心闭环：取详情 → 上传图片 → 安全回写 → 落审计日志。renderer 已完成生成/选图，
 * 这里只读盘上传 + 回写（职责边界见方案 §13.4 方案A）。全程推 'ewei:progress'。
 */
export async function replaceGoodsImage(
  args: ReplaceGoodsImageArgs,
): Promise<{ ok: boolean; uploaded: EweiUploadResult[] }> {
  const { connectorId, goodsId, slot, images, optionId } = args
  const taskId = randomBytes(8).toString('hex')
  if (!images || !images.length) throw new EweiError(-1, '没有可应用的图片')

  await ensureSession(connectorId)
  const st = getState(connectorId)
  const detail = await getGoodsDetail(connectorId, goodsId)
  const goodsTitle = String(detail.goods?.title || '')

  const logId = connectorService.createImageLog({
    connectorId,
    shopId: st.currentShopId,
    goodsId,
    goodsTitle,
    slot,
    oldValue: snapshotOldValue(detail, slot, optionId),
  })

  try {
    // 1) 上传
    const uploaded: EweiUploadResult[] = []
    for (let i = 0; i < images.length; i++) {
      broadcastProgress({ taskId, goodsId, phase: 'uploading', current: i, total: images.length, message: `上传第 ${i + 1}/${images.length} 张` })
      uploaded.push(await uploadImage(connectorId, images[i]))
    }
    connectorService.updateImageLog(logId, { status: 'uploaded', newPaths: uploaded.map((u) => u.path) })

    // 2) 回写
    broadcastProgress({ taskId, goodsId, phase: 'saving', message: '写回商品…' })
    const data = buildEditPayload(detail, slot, uploaded, optionId)
    await request(connectorId, 'shop', 'goods/edit', { method: 'POST', json: { goods_id: goodsId, data } })

    // 2.5) 多规格后置校验：回写本不应增减 SKU。buildEditPayload 已做前置守卫（每个 option 必有 id），
    //      这里重拉详情断言 SKU id 集合未被删除（after ⊇ before），把「后端仍删了 SKU」从静默数据丢失
    //      变成可见失败（只检测不回滚）。单规格无 SKU，跳过。
    if (Number(detail.goods?.has_option) === 1) {
      const after = await getGoodsDetail(connectorId, goodsId)
      assertSkuSetConsistent(
        'eweishop',
        detail.options.map((o: any) => o.id),
        (after.options || []).map((o: any) => o.id),
      )
    }

    connectorService.updateImageLog(logId, { status: 'done' })
    broadcastProgress({ taskId, goodsId, phase: 'done', message: '已应用到商品' })
    return { ok: true, uploaded }
  } catch (e: any) {
    const msg = e?.message || '替换失败'
    connectorService.updateImageLog(logId, { status: 'failed', error: msg })
    broadcastProgress({ taskId, goodsId, phase: 'error', message: msg })
    throw e
  }
}

// 审计日志读出（供 renderer 展示替换历史）
export function listImageLogs(goodsId: number, limit?: number): connectorService.EweiImageLog[] {
  return connectorService.listImageLogs(goodsId, limit ?? 50)
}

// ============================ 新增商品 ============================
// 走收银台 `shop/apps/checkstand/app/more/goods/save`：单/多规格都支持、option 处理最简（不访问
// booking/weight 等嵌套字段，对新建 SKU 最安全）、且完全不校验运费模板（避开实体商品的 dispatch 坑）。
// 收银台只设 thumbs=[主图]、不设 goods 级原价 → 多图集 / 单规格原价 用 shop/manage/goods/edit 补一刀。

export interface EweiCategory {
  id: number
  name: string
  children?: EweiCategory[]
}

/** 商品分类列表（店铺未开启分类时返回 []）。 */
export async function listGoodsCategories(connectorId: string): Promise<EweiCategory[]> {
  await ensureSession(connectorId)
  const norm = (arr: any[]): EweiCategory[] =>
    (arr || []).map((c) => ({
      id: Number(c.id),
      name: String(c.name ?? c.title ?? ''),
      children: Array.isArray(c.children) && c.children.length ? norm(c.children) : undefined,
    }))
  try {
    const json = await request(connectorId, 'shop', 'goods/category/list', { method: 'GET' })
    return norm(json.list || json.data || json.categories || [])
  } catch {
    return [] // error:-2 分类未开启 等 → 视为无分类
  }
}

export interface AddGoodsSpec {
  tempId: string
  title: string
  items: { tempId: string; title: string; image?: string }[]
}
export interface AddGoodsOption {
  specTempIds: string[]
  title: string
  price: string | number
  stock: string | number
  originalPrice?: string | number
  goodsCode?: string
  productSn?: string
  image?: string
  hidden?: boolean
}
export interface AddGoodsForm {
  title: string
  type: number // 1实体 / 2虚拟 / 18称重
  status: number // 1上架 / 0下架 / 2隐藏
  unit?: string
  galleryImages: string[] // 本地路径，[0]=主图，至少 1 张
  categoryIds?: number[]
  // 单规格
  price?: string | number
  stock?: string | number
  originalPrice?: string | number
  goodsCode?: string
  productSn?: string
  // 多规格
  hasOption: boolean
  specs?: AddGoodsSpec[]
  options?: AddGoodsOption[]
}

const PHYSICAL_TYPES = new Set([1, 8, 18])

function collectImagePaths(form: AddGoodsForm): string[] {
  const s = new Set<string>()
  for (const g of form.galleryImages || []) if (g) s.add(g)
  for (const sp of form.specs || []) for (const it of sp.items || []) if (it.image) s.add(it.image)
  for (const o of form.options || []) if (o.image) s.add(o.image)
  return [...s]
}

async function currentMaxGoodsId(connectorId: string): Promise<number> {
  try {
    const r = await listGoods(connectorId, { page: 1, pagesize: 5 })
    return r.list.reduce((m, g) => Math.max(m, g.id), 0)
  } catch {
    return 0
  }
}
async function findNewGoodsId(connectorId: string, beforeMaxId: number, title: string): Promise<number> {
  try {
    const r = await listGoods(connectorId, { page: 1, pagesize: 10 })
    const fresh = r.list.filter((g) => g.id > beforeMaxId)
    const byTitle = fresh.find((g) => g.title === title)
    if (byTitle) return byTitle.id
    if (fresh.length) return Math.max(...fresh.map((g) => g.id))
    return 0
  } catch {
    return 0
  }
}

/** 建后补充：多图集 thumbs[]、单规格原价、实体商品自提配送（让 saveGoods 的 checkDispatchMode 通过）。 */
async function patchNewGoods(
  connectorId: string,
  goodsId: number,
  patch: { thumbs?: string[]; originalPrice?: any },
): Promise<void> {
  const detail = await getGoodsDetail(connectorId, goodsId)
  const goods: any = { ...detail.goods }
  delete goods.diy_share
  if (patch.thumbs && patch.thumbs.length) {
    goods.thumb = patch.thumbs[0]
    goods.thumbs = patch.thumbs.slice()
  }
  if (patch.originalPrice !== undefined && Number(patch.originalPrice) > 0) {
    goods.original_price = String(patch.originalPrice)
  }
  // 实体/称重商品：收银台建品未设配送方式，shop/manage/goods/edit 会触发 checkDispatchMode。
  // 给个「自提」默认让其通过（不需运费模板），用户可在商城后台再改快递。
  if (PHYSICAL_TYPES.has(Number(goods.type))) {
    const dm = typeof goods.dispatch_mode === 'string' ? safeJson(goods.dispatch_mode) : goods.dispatch_mode
    if (!dm || (!dm.express && !dm.selffetch && !dm.store)) {
      goods.dispatch_mode = JSON.stringify({ express: '0', selffetch: '1', store: '0' })
      goods.default_dispatch_mode = 'selffetch'
      goods.dispatch_type = 1
    }
  }
  const data: any = { goods }
  if (Number(goods.has_option) === 1) {
    data.options = detail.options.map((o: any) => ({ ...o }))
    data.specs = detail.specs.map((s: any) => ({ ...s }))
  }
  await request(connectorId, 'shop', 'goods/edit', { method: 'POST', json: { goods_id: goodsId, data } })
}
function safeJson(s: string): any {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

export async function addGoods(connectorId: string, form: AddGoodsForm): Promise<{ goodsId: number }> {
  if (!form.title?.trim()) throw new EweiError(-1, '请填写商品标题')
  if (!form.galleryImages?.length || !form.galleryImages[0]) throw new EweiError(-1, '请至少选择 1 张主图')
  if (form.hasOption) {
    if (!form.specs?.length) throw new EweiError(-1, '请添加规格')
    if (!form.options?.length) throw new EweiError(-1, '请添加 SKU')
  } else {
    if (form.price === '' || form.price === undefined || Number(form.price) < 0) throw new EweiError(-1, '请填写商品价格')
    if (form.stock === '' || form.stock === undefined) throw new EweiError(-1, '请填写商品库存')
  }

  await ensureSession(connectorId)
  const taskId = randomBytes(8).toString('hex')

  // 上传全部图片（去重）
  const cache = new Map<string, string>()
  const total = collectImagePaths(form).length
  let done = 0
  const upload = async (p?: string): Promise<string> => {
    if (!p) return ''
    if (cache.has(p)) return cache.get(p)!
    broadcastProgress({ taskId, phase: 'uploading', current: done, total, message: `上传图片 ${done + 1}/${total}` })
    const r = await uploadImage(connectorId, p)
    cache.set(p, r.path)
    done++
    return r.path
  }
  const galleryPaths: string[] = []
  for (const g of form.galleryImages) galleryPaths.push(await upload(g))
  const mainThumb = galleryPaths[0]

  const beforeMaxId = await currentMaxGoodsId(connectorId)

  // 组 data
  const data: any = {
    title: form.title.trim(),
    type: String(form.type || 1),
    has_option: form.hasOption ? '1' : '0',
    thumb: mainThumb,
    thumb_is_banner: '1',
    status: String(form.status ?? 1),
    // sale_time/putaway_time 是 `timestamp NOT NULL` 列，必须传 0 值日期而非空串：
    // 收银台控制器只用 `?? '0000-00-00 00:00:00'` 兜底（兜得住 null，兜不住空串），
    // 空串 '' 在严格模式 MySQL(STRICT_TRANS_TABLES) 下插 timestamp 会抛
    // "Incorrect datetime value: ''" → 被框架记为 DB_ERROR → 返回「数据错误: [日志id]」。
    // 0 值=不定时上架（sale_time 有值即「待出售」状态），与官方 actionGet 新建默认一致。
    sale_time: '0000-00-00 00:00:00',
    putaway_time: '0000-00-00 00:00:00',
    unit: form.unit || '',
    category_ids: form.categoryIds || [],
    goods_code: form.goodsCode || '',
    product_sn: form.productSn || '',
    join_member_discount: {
      memberPrice: 0,
      memberDiscount: 0,
      memberCardPrice: 0,
      commissionGoodsPrice: 0,
      memberCardCustomPrice: 0,
    },
    options_json: '[]',
    specs_json: '[]',
  }
  if (form.hasOption) {
    const specs: any[] = []
    for (const g of form.specs!) {
      const items: any[] = []
      for (const it of g.items) items.push({ id: it.tempId, title: it.title, thumb: await upload(it.image) })
      specs.push({ id: g.tempId, title: g.title, items })
    }
    const options: any[] = []
    for (const o of form.options!) {
      options.push({
        id: '',
        title: o.title,
        price: String(o.price ?? 0),
        stock: String(o.stock ?? 0),
        original_price: String(o.originalPrice ?? 0),
        goods_code: o.goodsCode || '',
        product_sn: o.productSn || '',
        thumb: await upload(o.image),
        hidden_option: o.hidden ? 1 : 0,
        specs: o.specTempIds.join(','),
      })
    }
    data.specs_json = JSON.stringify(specs)
    data.options_json = JSON.stringify(options)
  } else {
    data.price = String(form.price ?? 0)
    data.stock = String(form.stock ?? 0)
  }

  broadcastProgress({ taskId, phase: 'saving', message: '创建商品…' })
  const res = await request(connectorId, 'utility', 'shop/apps/checkstand/app/more/goods/save', {
    method: 'POST',
    json: { id: '', data },
  })
  if (res && res.error !== undefined && res.error !== 0) throw new EweiError(res.error, res.message || '创建失败')

  const goodsId = await findNewGoodsId(connectorId, beforeMaxId, form.title.trim())

  const needsPatch = galleryPaths.length > 1 || (!form.hasOption && Number(form.originalPrice) > 0)
  if (goodsId && needsPatch) {
    try {
      broadcastProgress({ taskId, phase: 'saving', message: '补充图集/价格…' })
      await patchNewGoods(connectorId, goodsId, {
        thumbs: galleryPaths.length > 1 ? galleryPaths : undefined,
        originalPrice: !form.hasOption ? form.originalPrice : undefined,
      })
    } catch {
      /* 补充失败不致命：主商品已建成 */
    }
  }

  broadcastProgress({ taskId, phase: 'done', message: '商品已创建' })
  return { goodsId }
}
