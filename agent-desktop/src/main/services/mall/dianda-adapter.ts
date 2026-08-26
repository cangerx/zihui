// ============================================================================
// 点大商城（iappwx）适配器。协议见 docs/多商城接入方案-店铺商品图泛化.md §1（已抓包实测）。
// 与 ewei 关键差异：
//   - ThinkPHP + PHPSESSID Cookie 会话（需 cookie jar），密码明文，登录每次要图形验证码。
//   - 无需切门店：登录后 ?s=/ShopProduct/index 直接列商品。
//   - 图片是绝对 URL；上传 ?s=/upload/index 字段 file → {status:1,url}。
//   - 保存 ?s=/ShopProduct/save 是「全量替换」：缺字段静默清空 → 必须取该商品全部表单字段、
//     只改目标图字段、整体回提（harvestEditForm + 覆盖 + POST）。
// ============================================================================
import { readFileSync } from 'fs'
import { BrowserWindow } from 'electron'
import { getAbsolutePath } from '../image-generation'
import { makeUploadThumbnail } from '../thumbnail-upload'
import * as connectorService from '../ewei-connectors'
import { assertSkuSetConsistent, nonEmptySkuGuard } from './guards'
import type {
  MallAdapter,
  MallBeginLoginResult,
  MallCaptchaChallenge,
  MallShop,
  MallGoodsListItem,
  MallGoodsListParams,
  MallGoodsDetail,
  MallCategory,
  EweiUploadResult,
  ReplaceGoodsImageArgs,
} from './types'

// 复用 ewei 的错误类型语义（renderer 已能识别 message）。
class DiandaError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message || `商城接口错误(${code})`)
    this.name = 'DiandaError'
    this.code = code
  }
}

// ---- 会话（cookie jar）：内存态 + 持久化到连接器 extra_json，减少验证码频次 ----
interface DiandaSession {
  cookie: string // 形如 'PHPSESSID=xxx; xxx=yyy'
  loggedIn: boolean
}
const sessions = new Map<string, DiandaSession>()

function getSession(connectorId: string): DiandaSession {
  let s = sessions.get(connectorId)
  if (!s) {
    // 启动后首次：尝试从 extra_json 恢复上次持久化的 cookie（可能仍有效 → 免验证码）
    const extra = connectorService.getExtra(connectorId)
    s = { cookie: typeof extra.dd_cookie === 'string' ? extra.dd_cookie : '', loggedIn: false }
    sessions.set(connectorId, s)
  }
  return s
}

function persistCookie(connectorId: string, cookie: string): void {
  const s = getSession(connectorId)
  s.cookie = cookie
  connectorService.setExtra(connectorId, { dd_cookie: cookie })
}

export function clearSession(connectorId: string): void {
  sessions.delete(connectorId)
}

/** 合并 Set-Cookie 到 jar（只保留 name=value，丢弃属性）。 */
function mergeSetCookie(connectorId: string, res: Response): void {
  let list: string[] = []
  const anyHeaders = res.headers as any
  if (typeof anyHeaders.getSetCookie === 'function') list = anyHeaders.getSetCookie()
  else {
    const sc = res.headers.get('set-cookie')
    if (sc) list = [sc]
  }
  if (!list.length) return
  const s = getSession(connectorId)
  const jar: Record<string, string> = {}
  for (const part of (s.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) jar[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  for (const raw of list) {
    const first = raw.split(';')[0]
    const i = first.indexOf('=')
    if (i > 0) jar[first.slice(0, i).trim()] = first.slice(i + 1).trim()
  }
  s.cookie = Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

// ---- 进度广播（复用 ewei:progress 信道，renderer 监听同一事件）----
function broadcastProgress(p: any): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('ewei:progress', p)
    } catch {
      /* ignore */
    }
  }
}

// ---- 底层请求 ----
function baseUrl(connectorId: string): string {
  const creds = connectorService.resolveCredentials(connectorId)
  if (!creds) throw new DiandaError(-1, '连接器不存在')
  return creds.base_url.endsWith('/') ? creds.base_url : creds.base_url + '/'
}

/** 构造 `?s=/route` URL（route 形如 'ShopProduct/index'）。 */
function buildUrl(base: string, route: string, query?: Record<string, string | number | undefined>): string {
  let url = base + '?s=/' + route
  if (query) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    if (qs) url += '&' + qs
  }
  return url
}

interface ReqOptions {
  method?: 'GET' | 'POST'
  query?: Record<string, string | number | undefined>
  form?: Record<string, string> // x-www-form-urlencoded（单值）
  formBody?: string // 预构造的 x-www-form-urlencoded body（支持同名多值字段，全量回提用）
  formData?: FormData // multipart
  timeoutMs?: number
}

async function rawFetch(connectorId: string, route: string, opts: ReqOptions): Promise<Response> {
  const base = baseUrl(connectorId)
  const s = getSession(connectorId)
  const headers: Record<string, string> = { 'x-requested-with': 'XMLHttpRequest' }
  if (s.cookie) headers['cookie'] = s.cookie
  let body: any
  if (opts.formData) {
    body = opts.formData // 让 fetch 注入 multipart boundary
  } else if (opts.formBody !== undefined) {
    headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
    body = opts.formBody
  } else if (opts.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
    body = new URLSearchParams(opts.form).toString()
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || (opts.formData ? 120_000 : 30_000))
  let res: Response
  try {
    res = await fetch(buildUrl(base, route, opts.query), {
      method: opts.method || 'GET',
      headers,
      body,
      redirect: 'manual', // 未登录会 302 跳登录页，自己识别
      signal: controller.signal,
    })
  } catch (e: any) {
    throw new DiandaError(-1, `网络请求失败：${e?.message || e}`)
  } finally {
    clearTimeout(timer)
  }
  mergeSetCookie(connectorId, res)
  return res
}

/** 期望 JSON 响应的请求；登录态失效(跳转/HTML)时抛「需重新登录」。 */
async function requestJson(connectorId: string, route: string, opts: ReqOptions): Promise<any> {
  const res = await rawFetch(connectorId, route, opts)
  if (res.status >= 300 && res.status < 400) {
    getSession(connectorId).loggedIn = false
    throw new DiandaError(-10000, '登录态已失效，请重新登录（需重新输入验证码）')
  }
  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    // 非 JSON 多半是被重定向回登录页的 HTML
    getSession(connectorId).loggedIn = false
    throw new DiandaError(-10000, '登录态已失效，请重新登录（需重新输入验证码）')
  }
  return json
}

// ---- 登录（验证码两步）----
async function fetchCaptcha(connectorId: string): Promise<MallCaptchaChallenge> {
  // 确保有 PHPSESSID：先访问登录页种 cookie，再拉与该 session 绑定的验证码图
  await rawFetch(connectorId, 'Login/index', { method: 'GET' })
  const res = await rawFetch(connectorId, 'captcha', { method: 'GET' })
  const buf = Buffer.from(await res.arrayBuffer())
  const mime = res.headers.get('content-type') || 'image/png'
  return { needCaptcha: true, captchaImage: `data:${mime};base64,${buf.toString('base64')}` }
}

const diandaAdapter: MallAdapter = {
  platform: 'dianda',
  capabilities: {
    needsShopSwitch: false,
    needsCaptcha: true,
    supportsAddGoods: false,
    supportsGallery: true,
    supportsDetailImage: true, // 块状 JSON 详情：可追加/替换 picture 块
    supportsOptionThumb: false,
    detailFormat: 'blocks',
  },

  async beginLogin(connectorId: string): Promise<MallBeginLoginResult> {
    // 先试用持久化的 cookie 是否仍有效（探一个只读接口）；有效则免验证码直接成功
    const s = getSession(connectorId)
    if (s.cookie) {
      try {
        const probe = await requestJson(connectorId, 'ShopProduct/index', { query: { page: 1, limit: 1 } })
        if (probe && Number(probe.code) === 0) {
          s.loggedIn = true
          const creds = connectorService.resolveCredentials(connectorId)
          connectorService.updateLoginResult(connectorId, 'success', '已登录（复用会话）')
          return { needCaptcha: false, result: makeLoginResult(creds?.account || '') }
        }
      } catch {
        /* cookie 失效，走验证码 */
      }
    }
    return await fetchCaptcha(connectorId)
  },

  async submitLogin(connectorId: string, captcha: string): Promise<MallBeginLoginResult> {
    const creds = connectorService.resolveCredentials(connectorId)
    if (!creds) throw new DiandaError(-1, '连接器不存在')
    const res = await rawFetch(connectorId, 'Login/index', {
      method: 'POST',
      form: {
        username: creds.account,
        password: creds.password, // 点大明文提交
        captcha: (captcha || '').trim(),
        remember: '1', // 自动登录，延长会话、减少验证码
      },
    })
    let json: any
    try {
      json = JSON.parse(await res.text())
    } catch {
      throw new DiandaError(-1, '登录响应异常')
    }
    if (Number(json.status) === 2) {
      // 验证码错：返回新挑战让用户重输
      connectorService.updateLoginResult(connectorId, 'failed', json.msg || '验证码错误')
      return await fetchCaptcha(connectorId)
    }
    if (Number(json.status) === 1 || json.url) {
      const s = getSession(connectorId)
      s.loggedIn = true
      persistCookie(connectorId, s.cookie)
      connectorService.updateLoginResult(connectorId, 'success', '已登录')
      return { needCaptcha: false, result: makeLoginResult(creds.account) }
    }
    const msg = json.msg || '登录失败'
    connectorService.updateLoginResult(connectorId, 'failed', msg)
    throw new DiandaError(Number(json.status) || -1, msg)
  },

  async refreshCaptcha(connectorId: string): Promise<MallCaptchaChallenge> {
    return await fetchCaptcha(connectorId)
  },

  async logout(connectorId: string): Promise<void> {
    try {
      await rawFetch(connectorId, 'Login/logout', { method: 'GET' })
    } catch {
      /* ignore */
    }
    connectorService.setExtra(connectorId, { dd_cookie: null })
    clearSession(connectorId)
  },

  // 删除连接器/换设备时清本地会话。bare clearSession 经词法作用域指向上面的模块级函数（非本方法）。
  clearSession(connectorId: string): void {
    clearSession(connectorId)
  },

  // 点大无门店切换：返回空列表，renderer 据 capabilities.needsShopSwitch=false 不展示选门店
  async listShops(): Promise<{ list: MallShop[]; count: number }> {
    return { list: [], count: 0 }
  },
  async switchShop(): Promise<{ ok: boolean }> {
    return { ok: true }
  },

  async listGoods(connectorId: string, params: MallGoodsListParams = {}): Promise<{ list: MallGoodsListItem[]; count: number }> {
    const json = await requestJson(connectorId, 'ShopProduct/index', {
      query: {
        page: params.page || 1,
        limit: params.pagesize || 20,
        name: params.title,
        status: params.status,
        cid: params.category_ids,
      },
    })
    if (Number(json.code) !== 0) throw new DiandaError(Number(json.code) || -1, json.msg || '获取商品失败')
    const list: MallGoodsListItem[] = (json.data || []).map((g: any) => ({
      id: Number(g.id),
      title: String(g.name || ''),
      thumb: String(g.pic || ''), // 点大主图已是绝对 URL
      status: Number(g.status) || 0,
      has_option: hasRealOption(g.guigedata) ? 1 : 0,
      selling_type: 0,
      type: Number(g.product_type) || 0,
      price: String(g.sell_price ?? ''),
    }))
    return { list, count: Number(json.count) || list.length }
  },

  async getGoodsDetail(connectorId: string, goodsId: number): Promise<MallGoodsDetail> {
    // 走 getproduct(直读 DB 行)：name/pic/pics/detail/guigedata 一次取齐，比解析编辑页 HTML 可靠。
    const { product, guigedataRaw, detail } = await fetchGuige(connectorId, goodsId)
    if (!product || !product.id) throw new DiandaError(-1, '未能读取商品数据（请重试或检查登录态）')
    const pics = String(product.pics || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    // 整形成 ewei 风格 goods，让现有 EweiGoodsImageView 能预览主图/图集
    const goods: any = {
      id: Number(product.id),
      title: String(product.name || ''),
      thumb: String(product.pic || ''),
      thumbs: pics,
      // 详情含图数：块状详情转成 <img>，让 detailImgCount 正确（改图后 loadDetail 刷新即更新，不再显示旧值）
      content: diandaDetailToHtml(detail),
      has_option: hasRealOption(guigedataRaw) ? 1 : 0,
    }
    return { goods, options: [], specs: [] }
  },

  async replaceGoodsImage(args: ReplaceGoodsImageArgs): Promise<{ ok: boolean; uploaded: EweiUploadResult[] }> {
    const { connectorId, goodsId, slot, images } = args
    if (!images || !images.length) throw new DiandaError(-1, '没有可应用的图片')
    if (slot === 'optionThumb') {
      throw new DiandaError(-1, '多规格 SKU 图替换暂未支持')
    }

    const taskId = Math.random().toString(16).slice(2, 10)
    const logId = connectorService.createImageLog({
      connectorId,
      shopId: 0,
      goodsId,
      goodsTitle: '',
      slot,
      oldValue: null,
    })
    try {
      // 1) 先取编辑页全部表单字段 + 商品对象作为全量回提基底（点大 save 是全量替换，缺字段静默清空）。
      //    params 用 URLSearchParams：同名多值字段(如门店绑定 info[bind_mendian_ids][])经 append 完整保留。
      broadcastProgress({ taskId, goodsId, phase: 'saving', message: '读取商品现状…' })
      const { params } = await harvestEditForm(connectorId, goodsId)
      if (!params.get('info[name]')) {
        throw new DiandaError(-1, '未能读取商品完整数据，已中止以避免误删（请重试或检查登录态）')
      }
      // 重建 SKU(option[ks]) + specs：点大 save 全量替换、按 ks 匹配 shop_guige 后 delete id NOT IN(newggids)。
      // 静态表单只有模板 option(已在 harvest 排除)，真实 SKU 必须从 getproduct 取回逐条重建——
      // 否则全量保存会清空规格/价格/库存（单规格也同样中招，这是原全量保存的隐患）。
      const { gglist, guigedataRaw, lvprice, detail: currentDetail } = await fetchGuige(connectorId, goodsId)
      applyGuigeReconstruction(params, gglist, guigedataRaw, lvprice)
      // 改图本不应增减 SKU：先挡「读不到任何 SKU」，再断言重建后写入的 option[ks] 覆盖全部真实 SKU
      // （gglist 键即 getproduct 直读 shop_guige 的真实全集），漏项即中止，避免全量保存物理删除规格/价格/库存。
      nonEmptySkuGuard('点大', Object.keys(gglist))
      const afterKs = new Set<string>()
      for (const k of params.keys()) {
        const mk = k.match(/^option\[([^\]]+)\]/)
        if (mk) afterKs.add(mk[1])
      }
      assertSkuSetConsistent('点大', Object.keys(gglist), Array.from(afterKs))

      // 2) 上传新图（点大上传走商户后台存储，返回绝对 URL）
      const uploaded: EweiUploadResult[] = []
      for (let i = 0; i < images.length; i++) {
        broadcastProgress({ taskId, goodsId, phase: 'uploading', current: i, total: images.length, message: `上传第 ${i + 1}/${images.length} 张` })
        uploaded.push(await uploadImage(connectorId, images[i]))
      }
      connectorService.updateImageLog(logId, { status: 'uploaded', newPaths: uploaded.map((u) => u.url) })

      // 3) 覆盖目标图片字段（.set 替换该键全部值；其余字段含多值数组原样保留）
      const urls = uploaded.map((u) => u.url)
      if (slot === 'mainThumb') {
        params.set('info[pic]', urls[0])
      } else if (slot === 'galleryReplace') {
        params.set('info[pics]', urls.join(','))
        if (!params.get('info[pic]')) params.set('info[pic]', urls[0])
      } else if (slot === 'galleryAppend') {
        const cur = (params.get('info[pics]') || '').split(',').map((s) => s.trim()).filter(Boolean)
        params.set('info[pics]', [...cur, ...urls].join(','))
      } else if (slot === 'detailReplace' || slot === 'detailAppend') {
        // 详情图：以 getproduct 取回的 product.detail(块状JSON 原文)为基底追加/替换图片块。
        // 不能用 harvest 的 info[detail]——编辑页无该静态元素，取不到、送空会被服务端丢弃。
        params.set('info[detail]', buildDetailContent(currentDetail, urls, slot === 'detailReplace'))
      }

      // 4) 整体回提
      broadcastProgress({ taskId, goodsId, phase: 'saving', message: '写回商品…' })
      const json = await requestJson(connectorId, 'ShopProduct/save', { method: 'POST', formBody: params.toString() })
      if (Number(json.status) !== 1) throw new DiandaError(Number(json.status) || -1, json.msg || '保存失败')

      connectorService.updateImageLog(logId, { status: 'done' })
      broadcastProgress({ taskId, goodsId, phase: 'done', message: '已应用到商品' })
      return { ok: true, uploaded }
    } catch (e: any) {
      const msg = e?.message || '替换失败'
      connectorService.updateImageLog(logId, { status: 'failed', error: msg })
      broadcastProgress({ taskId, goodsId, phase: 'error', message: msg })
      throw e
    }
  },

  async listGoodsCategories(connectorId: string): Promise<MallCategory[]> {
    // 点大分类内嵌在列表页 cid 下拉；简单 GET getcategory 返回「无权限」。暂返回空（不影响主图/图集替换）。
    void connectorId
    return []
  },

  async addGoods(): Promise<{ goodsId: number }> {
    throw new DiandaError(-1, '该商城暂不支持在桌面端新增商品')
  },
}

// ---- 辅助 ----
function makeLoginResult(account: string) {
  return { uid: 0, account, contact: account, isAdmin: false, isRoot: false, isMerch: false, isSupply: false }
}

/** guigedata 是否为「真·多规格」（非单一默认规格）。 */
function hasRealOption(guigedata: any): boolean {
  try {
    const arr = typeof guigedata === 'string' ? JSON.parse(guigedata) : guigedata
    if (!Array.isArray(arr) || !arr.length) return false
    if (arr.length > 1) return true
    const items = arr[0]?.items
    return Array.isArray(items) && items.length > 1
  } catch {
    return false
  }
}

const MAX_UPLOAD_SIDE = 2400

async function uploadImage(connectorId: string, localPath: string): Promise<EweiUploadResult> {
  const abs = getAbsolutePath(localPath)
  let buf: Buffer<ArrayBufferLike> = readFileSync(abs)
  let name = abs.split(/[\\/]/).pop() || 'image.png'
  const send = async (b: Buffer, n: string): Promise<any> => {
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array(b)]), n)
    const res = await rawFetch(connectorId, 'upload/index', { method: 'POST', formData: fd })
    return JSON.parse(await res.text())
  }
  let json: any
  try {
    json = await send(buf, name)
  } catch (e: any) {
    throw new DiandaError(-1, `上传失败：${e?.message || e}`)
  }
  if (Number(json.status) !== 1 || !json.url) {
    // 文件过大兜底：压成 JPEG 重试一次
    if (/大|large|size|超/i.test(String(json.msg || ''))) {
      const jpeg = makeUploadThumbnail(buf, MAX_UPLOAD_SIDE, 90)
      if (jpeg) {
        buf = jpeg
        name = name.replace(/\.[^.]+$/, '') + '.jpg'
        json = await send(buf, name)
      }
    }
  }
  if (Number(json.status) !== 1 || !json.url) {
    throw new DiandaError(Number(json.status) || -1, json.msg || '上传失败')
  }
  const info = json.info || {}
  return {
    path: String(json.url), // 点大回写用绝对 URL，path 与 url 同
    url: String(json.url),
    width: Number(info.width) || 0,
    height: Number(info.height) || 0,
    id: Number(info.id) || 0,
  }
}

/**
 * 从编辑页 HTML 构建商品对象。点大编辑页的商品数据在【服务端渲染的表单 input】
 * （info[name]/info[pic]/info[pics]）与【var guigedataList(规格组)】里，而**不是** `var product = {...}`
 * ——页面里那句 `var product = res.product` 是「选择产品」弹层回调 choosepro2(res) 里的语句、
 * 与商品数据无关（旧实现 extractJsVar('product') 错配到它，导致 getGoodsDetail 必然报「未能解析商品数据」）。
 */
function buildProductFromEditPage(html: string, goodsId: number): any {
  const map = new Map<string, string>()
  for (const [name, value] of extractFormEntries(html)) {
    if (!map.has(name)) map.set(name, value)
  }
  return {
    id: goodsId,
    name: map.get('info[name]') || '',
    pic: map.get('info[pic]') || '',
    pics: map.get('info[pics]') || '',
    // 规格组：var guigedataList = [{title,items:[...]}]，hasRealOption 据此判多规格
    guigedata: extractJsVar(html, 'guigedataList') || [],
  }
}

/**
 * 取编辑页服务端渲染的全部商品表单字段（name→value），作为全量回提基底。
 * 仅收商品表单相关字段（info[*] / option[*] / specs / id / 佣金 / 运费等），避免抓到搜索框/模板行。
 * 这是「保存=全量替换、缺字段清空」下的安全做法：忠实复刻官方编辑页提交的字段集。
 */
async function harvestEditForm(
  connectorId: string,
  goodsId: number,
): Promise<{ params: URLSearchParams; product: any }> {
  const res = await rawFetch(connectorId, `ShopProduct/edit/id/${goodsId}`, { method: 'GET' })
  if (res.status >= 300 && res.status < 400) {
    getSession(connectorId).loggedIn = false
    throw new DiandaError(-10000, '登录态已失效，请重新登录')
  }
  const html = await res.text()
  const params = new URLSearchParams()
  for (const [name, value] of extractFormEntries(html)) params.append(name, value)
  // 商品对象从表单 + var guigedataList 构建（编辑页无 `var product = {...}` 数据对象，
  // 那句 var product = res.product 是选择产品弹层回调，旧实现 extractJsVar('product') 取不到 →
  // product 恒为 null → 多规格守卫 hasRealOption(null)=false 失效，多规格商品会裸跑全量替换清 SKU）。
  const product = buildProductFromEditPage(html, goodsId)
  // 详情 info[detail] 不是静态表单字段——它在 <script id="content" name="info[detail]"> 里(DIY设计器初始数据)，
  // 提交时本由 geteditordata() 重新序列化。harvest 不含它会导致全量替换清空详情。从脚本块取原始内容兜底保留。
  if (!params.has('info[detail]')) {
    const m = html.match(/<script[^>]*\bname=["']info\[detail\]["'][^>]*>([\s\S]*?)<\/script>/i)
    if (m) params.append('info[detail]', m[1])
  }
  if (!params.has('id')) params.append('id', String(goodsId))
  return { params, product }
}

/**
 * 取商品的真实 SKU（按 ks 键的 shop_guige 行）+ 规格结构（guigedata 原文）+ 是否启用会员价。
 * 走 `ShopProduct/getproduct`（POST proid）——服务端直读 shop_guige + shop_product.guigedata，
 * 比解析编辑页 HTML 可靠（编辑页无 guigedataList 变量，SKU 表是 JS 动态建的）。
 */
async function fetchGuige(
  connectorId: string,
  goodsId: number,
): Promise<{ product: any; gglist: Record<string, any>; guigedataRaw: string; lvprice: boolean; detail: string }> {
  const json = await requestJson(connectorId, 'ShopProduct/getproduct', {
    method: 'POST',
    form: { proid: String(goodsId) },
  })
  const product = json?.product || {}
  const gglist: Record<string, any> = json?.gglist && typeof json.gglist === 'object' ? json.gglist : {}
  // specs 直接回提商品现有 guigedata 原文（保持规格结构不变；SKU 保留靠 option[ks] 按 ks 匹配，与 specs 无关）
  const guigedataRaw =
    typeof product.guigedata === 'string' && product.guigedata
      ? product.guigedata
      : JSON.stringify(json?.guigedata ?? [])
  // 详情(detail)：编辑页无 info[detail] 静态元素（由 DIY 设计器 JS 提交时生成），harvest 抓不到。
  // 必须以 getproduct 返回的 product.detail(块状 JSON 原文) 作改图基底，否则送非法内容会被 geteditorcontent 丢弃。
  const detail = typeof product.detail === 'string' ? product.detail : ''
  return { product, gglist, guigedataRaw, lvprice: Number(product.lvprice) === 1, detail }
}

/** 点大块状详情 → 含 <img> 的 HTML（仅供桌面端统计「详情图含 N 张图」用，改图后刷新即更新）。 */
function diandaDetailToHtml(detail: string): string {
  const decoded = decodeHtml(detail || '').trim()
  if (!decoded) return ''
  if (!decoded.startsWith('[')) return decoded // 纯 HTML 旧详情已含 <img>
  let blocks: any[]
  try {
    blocks = JSON.parse(decoded)
  } catch {
    return ''
  }
  if (!Array.isArray(blocks)) return ''
  const imgs: string[] = []
  for (const b of blocks) {
    if (b && Array.isArray(b.data)) {
      for (const d of b.data) {
        if (d && typeof d.imgurl === 'string' && d.imgurl) imgs.push(`<img src="${d.imgurl}"/>`)
      }
    }
  }
  return imgs.join('')
}

/**
 * 把真实 SKU 逐条重建成 option[ks][...] 字段 + specs，append 进全量回提的 params。
 * 字段集忠实复刻服务端 save 读取的键（name/pic/market_price/cost_price/sell_price/weight/
 * barcode/givescore/stock/limit_start，启用会员价时附 sell_price_<等级id>）。返回重建出的 SKU 条数。
 * 服务端按 ks 匹配 shop_guige 行 → 逐条 update 保留 id、循环后 delete id NOT IN(newggids)：
 * 只要每个现有 ks 都提交，全部 SKU 原样保留（单/多规格同理）。
 */
function applyGuigeReconstruction(
  params: URLSearchParams,
  gglist: Record<string, any>,
  guigedataRaw: string,
  lvprice: boolean,
): number {
  let n = 0
  for (const ks of Object.keys(gglist)) {
    const row = gglist[ks] || {}
    const set = (sub: string, val: any): void =>
      params.append(`option[${ks}][${sub}]`, val === undefined || val === null ? '' : String(val))
    set('name', row.name ?? '')
    set('pic', row.pic ?? '')
    set('market_price', row.market_price ?? 0)
    set('cost_price', row.cost_price ?? 0)
    set('sell_price', row.sell_price ?? 0)
    set('weight', row.weight ?? 0)
    set('barcode', row.barcode ?? '')
    set('givescore', row.givescore ?? '')
    set('stock', row.stock ?? 0)
    set('limit_start', row.limit_start ?? 0)
    if (lvprice && row.lvprice_data) {
      let lv: any = row.lvprice_data
      if (typeof lv === 'string') {
        try {
          lv = JSON.parse(lv)
        } catch {
          lv = {}
        }
      }
      if (lv && typeof lv === 'object') {
        for (const lvid of Object.keys(lv)) set(`sell_price_${lvid}`, lv[lvid] ?? 0)
      }
    }
    n++
  }
  params.append('specs', guigedataRaw || '')
  return n
}

/** 点大 DIY 详情设计器的 picture(图片)块。多张图放进同一块的 data 数组。 */
function makePictureBlock(urls: string[]): any {
  const uid = (p: string): string => p + Date.now() + Math.floor(Math.random() * 1e6)
  return {
    id: uid('M'),
    temp: 'picture',
    params: {
      bgcolor: '#FFFFFF', margin_x: '0', margin_y: '0', padding_x: '0', padding_y: '0', borderradius: '0',
      quanxian: { all: false }, platform: { all: false }, mendian: { all: true }, mendian_sort: 'sort',
    },
    data: urls.map((u) => ({ id: uid('P'), imgurl: u, hrefurl: '' })),
    other: '',
    content: '',
  }
}

/**
 * 在现有详情上追加/替换图片。current = <script id=content> 原始内容(可能含 HTML 实体)。
 * 块状 JSON 详情 → 加/替 picture 块；纯 HTML 旧详情 → 加/替 <img>。块状解析失败则中止(防破坏详情)。
 */
function buildDetailContent(current: string, urls: string[], replace: boolean): string {
  const decoded = decodeHtml(current || '').trim()
  if (decoded.startsWith('[')) {
    let blocks: any[]
    try {
      const p = JSON.parse(decoded)
      if (!Array.isArray(p)) throw new Error('not array')
      blocks = p
    } catch {
      throw new DiandaError(-1, '该商品详情为块状结构但解析失败，已中止以避免破坏详情，请用商城后台编辑详情')
    }
    const pic = makePictureBlock(urls)
    return JSON.stringify(replace ? [pic] : [...blocks, pic])
  }
  const imgs = urls.map((u) => `<p><img src="${u}" style="max-width:100%"/></p>`).join('')
  return replace ? imgs : decoded + imgs
}

/**
 * 从 HTML 抽取 input/textarea/select 的 name→value（限定商品表单相关字段名），返回 entries 数组。
 * 多值数组字段（name 以 `[]` 结尾，如门店绑定 info[bind_mendian_ids][]）全部保留；
 * 标量字段去重保留首个，避免编辑页隐藏/模板行重复污染全量回提。
 */
function extractFormEntries(html: string): Array<[string, string]> {
  const entries: Array<[string, string]> = []
  const seen = new Set<string>()
  const want = (name: string): boolean =>
    name === 'id' ||
    name.startsWith('info[') ||
    // 注意：option[*] 与 specs 故意【不】从静态表单收集——静态页里只有 JS 用的模板行
    // （name 形如 option['+ks+'][...]），真实 SKU 由 getproduct 取回后在 replaceGoodsImage 里逐条重建。
    // 误收模板会让服务端 save 的 `delete id not in(newggids)` 清空真实规格/价格/库存。
    name.startsWith('ggname') ||
    name.startsWith('commissiondata') ||
    name.startsWith('commissionpingjidata') ||
    name.startsWith('gdfenhong') ||
    name.startsWith('jd_') ||
    name === 'province' ||
    name === 'city' ||
    name === 'district'
  const add = (name: string, value: string): void => {
    if (!name.endsWith('[]')) {
      if (seen.has(name)) return
      seen.add(name)
    }
    entries.push([name, value])
  }

  // input
  const inputRe = /<input\b([^>]*)>/gi
  let m: RegExpExecArray | null
  while ((m = inputRe.exec(html))) {
    const attrs = m[1]
    const name = attrOf(attrs, 'name')
    if (!name || !want(name)) continue
    const type = (attrOf(attrs, 'type') || 'text').toLowerCase()
    if ((type === 'checkbox' || type === 'radio') && !/\bchecked\b/i.test(attrs)) continue
    add(name, decodeHtml(attrOf(attrs, 'value') || ''))
  }
  // textarea
  const taRe = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi
  while ((m = taRe.exec(html))) {
    const name = attrOf(m[1], 'name')
    if (!name || !want(name)) continue
    add(name, decodeHtml(m[2] || ''))
  }
  // select：取 selected option（无则首个）
  const selRe = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi
  while ((m = selRe.exec(html))) {
    const name = attrOf(m[1], 'name')
    if (!name || !want(name)) continue
    const body = m[2]
    let val = ''
    let first = ''
    const optRe = /<option\b([^>]*)>/gi
    let om: RegExpExecArray | null
    while ((om = optRe.exec(body))) {
      const v = attrOf(om[1], 'value') || ''
      if (first === '') first = v
      if (/\bselected\b/i.test(om[1])) {
        val = v
        break
      }
    }
    add(name, decodeHtml(val || first))
  }
  return entries
}

function attrOf(attrs: string, key: string): string | null {
  const re = new RegExp(key + '\\s*=\\s*"([^"]*)"', 'i')
  const m = re.exec(attrs)
  if (m) return m[1]
  const re2 = new RegExp(key + "\\s*=\\s*'([^']*)'", 'i')
  const m2 = re2.exec(attrs)
  return m2 ? m2[1] : null
}

function decodeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** 从页面脚本里抽取 `var NAME = {...};` / `var NAME = [...];` 并 JSON.parse。 */
function extractJsVar(html: string, name: string): any {
  const idx = html.indexOf('var ' + name)
  if (idx < 0) return null
  const eq = html.indexOf('=', idx)
  if (eq < 0) return null
  let i = eq + 1
  while (i < html.length && /\s/.test(html[i])) i++
  const open = html[i]
  const close = open === '{' ? '}' : open === '[' ? ']' : ''
  if (!close) return null
  // 括号配平扫描（跳过字符串内的括号）
  let depth = 0
  let inStr: string | null = null
  let esc = false
  let end = -1
  for (let j = i; j < html.length; j++) {
    const c = html[j]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'") {
      inStr = c
      continue
    }
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) {
        end = j
        break
      }
    }
  }
  if (end < 0) return null
  const raw = html.slice(i, end + 1)
  try {
    return JSON.parse(raw)
  } catch {
    // 标准 var product 为合法 JSON(双引号)，首次即成功。非标准时仅给「未加引号的 key」补双引号，
    // 不全局替换单引号——否则会破坏字符串值内的合法撇号(商品名/详情常含 ')。
    try {
      return JSON.parse(raw.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":'))
    } catch {
      return null
    }
  }
}

export { diandaAdapter }
