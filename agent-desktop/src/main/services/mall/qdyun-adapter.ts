// ============================================================================
// 全端云商城（xiaoyinetwork）适配器。协议见会话逆向 + docs。
// 与 ewei/点大都不同的第三种栈：JWT token 鉴权 + 两层（token SPA 门户 + we7 商户后台）。
//   第1层(/admin)：登录 POST /admin/login/login(username/password/captcha,每次验证码)→{code:"20000",data:{secret:JWT}}
//     之后带头 authorization-token: Bearer <JWT>；验证码 /admin/login/captcha；项目列表 /admin/applet/userIndex。
//   第2层(/index, we7)：商品列表 /index/duoproducts/index?appletid=N(JS渲染)；编辑器 /index/duoproducts/add.html?
//     appletid=N&newsid=<proid>(JS渲染重型表单,checkinfo校验)；图片上传走媒体库端点 POST /pic/upImage?uniacid=N&gid=0
//     字段 uploadfile0，响应 {code:0,data:[{url,pid}]}(code:0=成功，绝对COS URL)；保存 POST /index/duoproducts/save.html?appletid=N&newsid=<proid>
//     (112字段);主图(列表显示)=commonuploadpic1、轮播=imgsrcs[]。
//
// 实现策略：we7 编辑器/列表是 JS 渲染的重型表单，纯协议复刻不出 112 字段渲染态。故：
//   - 登录/验证码/applet/上传：走【per-connector 持久化 Electron 会话分区】的 session.fetch（cookie 自动管理，
//     与下面的 BrowserWindow 同分区共享会话）。
//   - 列商品/改图：用【隐藏 BrowserWindow(同分区)】加载真实页面，executeJavaScript 读渲染态/驱动编辑器保存——
//     设 commonuploadpic1 + checkinfo()通过 + 序列化 FormData POST save.html。
// 改图支持 mainThumb(主图)/图集(imgsrcs[])/详情(UEditor product_txt)。
// 多规格(use_more==1)：主图/轮播/详情改图已放开——SKU 由编辑器 checkinfo()->ggzbc() 打包进隐藏字段
//   #biaogedata(JSON.stringify(allarrone))，规格组进 #ggzjsons/#typelen/#typesarr，提交前 .shukdd(valarr) 名
//   被清空。前提是 getDuoTypeValues(在 changeType 内) 已把现有 SKU 载入 allarrone，故改图前主动触发并等待就绪
//   (前置安全闸)、保存前断言 #biaogedata 非空(后置安全闸)，任一不满足即中止、绝不清空 SKU。SKU 图(规格图片)
//   仍不支持(supportsOptionThumb:false，需逐 valarr{i}[9] 替换，更复杂)。
//
// 【2026-06-23 真实账号 HTTP/DB 实测修正的三处致命点(纯代码审查不可见)】：
//   1. 验证码是 JSON：admin/login/captcha 回 {data:{image_data:"data:image/png;base64..",key:".."}}，
//      不是裸图片。image_data 直接当 captchaImage；key 必须在 submitLogin 回传(form.key)否则报"登录key错误"。
//   2. /index(we7) 不认 /admin 的 JWT：顶层导航/列表/保存只带 cookie。须先用 cache_key(登录种下的账号级
//      cookie,名==值,32位hex) GET index/datashow/index.html?appletid=N&cache_key=KEY 触发服务端 setLoginData
//      写 PHP $_SESSION(绑定 PHPSESSID)，之后 /index 才通过。见 ensureWe7Session——所有 /index 操作前必调。
//   3. 编辑器 add.html?appletid&newsid 对【脏数据商品】会服务端 in_array 报错(返回错误页)；对【多规格但
//      无真实SKU】被 checkinfo "请添加规格组"拒——demo applet 237 商品系统性损坏，无一可走通保存(非适配器问题)。
//
// 【源码逆向确认(2026-06-23, 经授权只读 SSH 读 qd 服务器 ThinkPHP 视图源码 add.html)】：
//   - 编辑器 add.html 是【服务端全量渲染】：商品的分类(#w2 select2)、取货方式(kuaidi[] 复选框)、轮播图(#imgzs)、
//     详情(UEditor #editor)、门店选择等在页面加载时即由 {$products.*} 渲染进 DOM —— 并非 AJAX 懒加载(此前"懒加载"
//     判断有误)。=> 对【配置完整】的商品，隐藏 BrowserWindow 加载后 DOM 即处于可提交态。
//   - 客户端校验契约 = 页面自带 checkinfo()：必填 #w2(分类)/#proTitle/缩略图(commonuploadpic1)/轮播图/详情，并负责
//     把 #w2->#cates、UEditor->#text、#w3/#w4->门店等做全量拷贝。故本适配器【直接复用 checkinfo()】(校验+拷贝)，
//     返回 false 即放弃，避免 we7 全量替换保存把字段写空。
//   - save.html 是 ThinkPHP success()/error()：带 x-requested-with 回 JSON——成功 {code:1,..}，失败 {code:0,msg:".."}。
//     服务端再校验一次(分类/取货方式等)，不完整直接 code:0 拒绝且【不落库】，是数据安全网。
//   - 唯一失败模式 = 商品在后台【本就残缺】(如 demo 项目 237 的 2978/2979 无分类/无取货方式) —— 这类会被
//     checkinfo 或服务端拒、replaceGoodsImage 抛错而非误改。对配置完整的商品本 headless 路径可正常保存(主图)。
//   - happy-path 未在本环境实证：仅有的 demo 商品系统性残缺，且不应拿生产真实商品做写测试。建议首次启用时在
//     用户愿意改动的商品上验证；或用【可见 webview】让用户在真实编辑器点保存(最稳)。
// ============================================================================
import { BrowserWindow, session as electronSession } from 'electron'
import { readFileSync } from 'fs'
import { getAbsolutePath } from '../image-generation'
import { makeUploadThumbnail } from '../thumbnail-upload'
import * as connectorService from '../ewei-connectors'
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

class QdyunError extends Error {
  code: number
  constructor(code: number | string, message: string) {
    super(message || `商城接口错误(${code})`)
    this.name = 'QdyunError'
    this.code = Number(code) || -1
  }
}

const SUCCESS_CODE = '20000'
const PARTITION = (id: string): string => 'persist:mall-qdyun-' + id

// 隐藏窗口超时预算（保存链路）：外层必须 ≥ 内层各等待点上限之和 + 裕量，否则外层先超时 destroy 窗口、
// reject 泛化「页面操作超时」，把内层 SKU 安全闸/一致断言的精确中止文案掩盖（原 35s < 25+20=45s 即此 bug）。
const QD_READY_MS = 25000 // 编辑器就绪等待上限（内层）
const QD_SKU_MS = 20000 // 多规格 SKU 载入等待上限（内层）
const QD_SAVE_WINDOW_MS = QD_READY_MS + QD_SKU_MS + 8000 // 保存窗口外层超时(=53s)

// 同一连接器的改图串行队列：隐藏窗口共享持久化分区，并发改图会串扰会话/DOM，逐 connector 串行化。
const saveQueues = new Map<string, Promise<unknown>>()
function ses(id: string): Electron.Session {
  return electronSession.fromPartition(PARTITION(id))
}

// ---- 会话态（JWT + 当前 applet；we7 cookie 在分区里持久化）----
interface QdyunSession {
  token: string
  appletId: number
}
const sessions = new Map<string, QdyunSession>()
// 最近一次验证码响应里的 key（登录必须回传，否则服务端报"登录key错误"）。
// fetchCaptcha 写入、submitLogin 读取——同进程顺序调用，不依赖 renderer 透传 challengeId。
const pendingCaptchaKey = new Map<string, string>()
// 已建立 we7 第2层(/index)会话的 appletId 集合（见 ensureWe7Session）。
const we7Bridged = new Map<string, Set<number>>()
function getSession(connectorId: string): QdyunSession {
  let s = sessions.get(connectorId)
  if (!s) {
    const extra = connectorService.getExtra(connectorId)
    s = { token: typeof extra.qd_token === 'string' ? extra.qd_token : '', appletId: Number(extra.qd_applet) || 0 }
    sessions.set(connectorId, s)
  }
  return s
}
export function clearSession(connectorId: string): void {
  sessions.delete(connectorId)
  pendingCaptchaKey.delete(connectorId)
  we7Bridged.delete(connectorId)
  try {
    // 清全部存储（cookie + SPA 门户 localStorage/IndexedDB 等），避免换号/登出残留串台
    ses(connectorId).clearStorageData()
  } catch {
    /* ignore */
  }
}

/** 读分区里登录时种下的 cache_key（账号级，cookie 名==值，32 位 hex）。 */
async function getCacheKey(connectorId: string): Promise<string> {
  try {
    const cookies = await ses(connectorId).cookies.get({ url: baseUrl(connectorId) })
    for (const c of cookies) {
      if (/^[a-f0-9]{32}$/.test(c.name) && c.value === c.name) return c.name
    }
  } catch {
    /* ignore */
  }
  return ''
}

/**
 * 建立 we7 第2层(/index)会话。we7 不认 /admin 的 JWT——顶层导航/列表/保存只带 cookie。
 * 进入项目时需用 cache_key 触发服务端 setLoginData 把登录态写入 PHP $_SESSION（绑定到分区
 * 里的 PHPSESSID）；之后 /index 请求(含 BrowserWindow 顶层导航)只凭 PHPSESSID 即通过。
 * 按 appletId 缓存，幂等；失败(会话失效→302 回 /new_plat 登录)抛错。
 */
async function ensureWe7Session(connectorId: string, appletId: number): Promise<void> {
  let set = we7Bridged.get(connectorId)
  if (set && set.has(appletId)) return
  const cacheKey = await getCacheKey(connectorId)
  if (!cacheKey) throw new QdyunError(-1, '商城登录已失效，请重新登录')
  const r = await sfetch(connectorId, 'index/datashow/index.html', {
    query: { appletid: appletId, cache_key: cacheKey },
    noXrw: true, // 页面导航：不带 x-requested-with，成功回 text/html、失败 302 跳 /new_plat
  })
  // 成功为 200 text/html(datashow 页面)；失败(check_login=false)会重定向到 /new_plat 登录页
  if (r.status >= 400 || r.url.includes('new_plat')) {
    throw new QdyunError(-1, '建立商城后台会话失败，请重新登录')
  }
  if (!set) {
    set = new Set()
    we7Bridged.set(connectorId, set)
  }
  set.add(appletId)
}

function baseUrl(connectorId: string): string {
  const creds = connectorService.resolveCredentials(connectorId)
  if (!creds) throw new QdyunError(-1, '连接器不存在')
  return creds.base_url.endsWith('/') ? creds.base_url : creds.base_url + '/'
}

interface ReqOptions {
  method?: 'GET' | 'POST'
  query?: Record<string, string | number | undefined>
  form?: Record<string, string>
  formData?: FormData
  auth?: boolean
  /** 不带 x-requested-with：用于页面导航类请求(如 datashow 建会话)——带该头 ThinkPHP 会把
   *  成功页面也包成 JSON 字符串(content-type:application/json)，干扰成败判定。 */
  noXrw?: boolean
}

/** 走分区 session.fetch（cookie 自动管理，与 BrowserWindow 同分区共享）。 */
async function sfetch(connectorId: string, route: string, opts: ReqOptions = {}): Promise<Response> {
  let url = baseUrl(connectorId) + route.replace(/^\//, '')
  if (opts.query) {
    const qs = Object.entries(opts.query)
      // 只丢 undefined/null，保留空字符串：全端云 userIndex 要求 key 参数必须存在
      // （哪怕为空），过滤掉会导致服务端报 "Undefined index: key"。
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    if (qs) url += (url.includes('?') ? '&' : '?') + qs
  }
  const headers: Record<string, string> = {}
  if (!opts.noXrw) headers['x-requested-with'] = 'XMLHttpRequest'
  let body: any
  if (opts.formData) {
    body = opts.formData
  } else if (opts.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
    body = new URLSearchParams(opts.form).toString()
  }
  if (opts.auth) {
    const s = getSession(connectorId)
    if (s.token) headers['authorization-token'] = 'Bearer ' + s.token
  }
  return ses(connectorId).fetch(url, { method: opts.method || 'GET', headers, body })
}

async function fetchCaptcha(connectorId: string): Promise<MallCaptchaChallenge> {
  const res = await sfetch(connectorId, 'admin/login/captcha')
  const buf = Buffer.from(await res.arrayBuffer())
  const text = buf.toString('utf8')
  // 全端云验证码是 JSON：{code,data:{image_data:"data:image/png;base64,..", key:".."}}。
  // image_data 本身即可直接用的 data URI；key 必须在 submitLogin 回传。
  try {
    const j = JSON.parse(text)
    const img = j?.data?.image_data
    const key = j?.data?.key
    if (typeof img === 'string' && img.startsWith('data:')) {
      if (typeof key === 'string' && key) pendingCaptchaKey.set(connectorId, key)
      return { needCaptcha: true, captchaImage: img, challengeId: typeof key === 'string' ? key : undefined }
    }
  } catch {
    /* 非 JSON：按裸图片兜底 */
  }
  const mime = res.headers.get('content-type') || 'image/png'
  return { needCaptcha: true, captchaImage: `data:${mime};base64,${buf.toString('base64')}` }
}

// ---- 隐藏 BrowserWindow（同分区，复刻真实页面 + 驱动编辑器）----
function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      onTimeout()
      reject(new QdyunError(-1, '页面操作超时'))
    }, ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

/** 在隐藏 BrowserWindow(同分区,带 we7 会话)里加载 url 并执行 js，返回 js 结果。 */
async function runInWindow(connectorId: string, route: string, js: string, timeoutMs = 30000): Promise<any> {
  const url = baseUrl(connectorId) + route.replace(/^\//, '')
  // 可见首跑调试：QDYUN_DEBUG_VISIBLE=1 时显示隐藏窗口 + 开 DevTools 并放宽超时，
  // 便于在「用户愿意改动的真实商品」上首次验证 happy-path（默认关，生产不弹窗）。
  const debugVisible = process.env.QDYUN_DEBUG_VISIBLE === '1'
  const effTimeout = debugVisible ? Math.max(timeoutMs, 300000) : timeoutMs
  const win = new BrowserWindow({
    show: debugVisible,
    width: 1280,
    height: 900,
    webPreferences: {
      partition: PARTITION(connectorId),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const wc = win.webContents
  if (debugVisible) {
    try {
      wc.openDevTools({ mode: 'detach' })
    } catch {
      /* ignore */
    }
  }
  try {
    // 把「加载+等待 did-finish-load+执行 JS」整体纳入超时——否则页面挂死时
    // await loaded 永不返回，隐藏窗口与上层 IPC Promise 双双泄漏。
    const run = (async (): Promise<any> => {
      const loaded = new Promise<void>((resolve, reject) => {
        const ok = (): void => {
          cleanup()
          resolve()
        }
        // did-fail-load 对主帧和任意子帧/中止都会触发：we7 重型页常带 iframe(UEditor 等)，
        // 仅主帧导航失败才算整页失败；忽略子帧失败与 ERR_ABORTED(-3, 重定向/中止常态)。
        const fail = (_e: unknown, code: number, desc: string, _u: string, isMainFrame: boolean): void => {
          if (!isMainFrame || code === -3) return
          cleanup()
          reject(new QdyunError(code, `页面加载失败 ${desc}`))
        }
        const cleanup = (): void => {
          wc.off('did-finish-load', ok)
          wc.off('did-fail-load', fail)
        }
        wc.once('did-finish-load', ok)
        wc.on('did-fail-load', fail) // on 而非 once：忽略子帧失败后仍能等主帧 did-finish-load
      })
      // loadURL 在重定向/中止时会 reject ERR_ABORTED；成败统一交给 loaded 裁决，超时兜底。
      wc.loadURL(url).catch(() => {})
      await loaded
      return await wc.executeJavaScript(js, true)
    })()
    return await withTimeout(run, effTimeout, () => {
      if (!win.isDestroyed()) win.destroy()
    })
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

function hasRealOption(useMore: any): boolean {
  return String(useMore) === '1'
}

const qdyunAdapter: MallAdapter = {
  platform: 'qdyun',
  capabilities: {
    needsShopSwitch: true, // applet/项目选择，复用「选门店」UI
    needsCaptcha: true,
    supportsAddGoods: false,
    supportsGallery: true, // 轮播 imgsrcs[]
    supportsDetailImage: true, // 详情 UEditor 富文本(product_txt)
    supportsOptionThumb: false, // 多规格 SKU 图守卫拒绝
    detailFormat: 'html',
  },

  async beginLogin(connectorId: string): Promise<MallBeginLoginResult> {
    const s = getSession(connectorId)
    if (s.token) {
      try {
        const r = await sfetch(connectorId, 'admin/applet/userIndex', {
          query: { page: 1, size: 1, type: 7, source: 0, key: '' },
          auth: true,
        })
        const j = await r.json()
        if (j && String(j.code) === SUCCESS_CODE) {
          const creds = connectorService.resolveCredentials(connectorId)
          connectorService.updateLoginResult(connectorId, 'success', '已登录（复用会话）')
          return { needCaptcha: false, result: makeLoginResult(creds?.account || '') }
        }
      } catch {
        /* 失效，走验证码 */
      }
    }
    return await fetchCaptcha(connectorId)
  },

  async submitLogin(connectorId: string, captcha: string, challengeId?: string): Promise<MallBeginLoginResult> {
    const creds = connectorService.resolveCredentials(connectorId)
    if (!creds) throw new QdyunError(-1, '连接器不存在')
    // 全端云登录必须回传验证码响应里的 key，否则报"登录key错误"。优先用本地暂存的 key
    // （fetchCaptcha 写入），兼容 renderer 透传的 challengeId。
    const key = pendingCaptchaKey.get(connectorId) || challengeId || ''
    const res = await sfetch(connectorId, 'admin/login/login', {
      method: 'POST',
      form: { username: creds.account, password: creds.password, captcha: (captcha || '').trim(), key },
    })
    let json: any
    try {
      json = JSON.parse(await res.text())
    } catch {
      throw new QdyunError(-1, '登录响应异常')
    }
    if (String(json.code) !== SUCCESS_CODE || !json.data?.secret) {
      connectorService.updateLoginResult(connectorId, 'failed', json.msg || '登录失败')
      return await fetchCaptcha(connectorId)
    }
    const s = getSession(connectorId)
    s.token = String(json.data.secret)
    connectorService.setExtra(connectorId, { qd_token: s.token })
    connectorService.updateLoginResult(connectorId, 'success', '已登录')
    return { needCaptcha: false, result: makeLoginResult(String(json.data.user_name || creds.account)) }
  },

  async refreshCaptcha(connectorId: string): Promise<MallCaptchaChallenge> {
    return await fetchCaptcha(connectorId)
  },

  async logout(connectorId: string): Promise<void> {
    connectorService.setExtra(connectorId, { qd_token: null, qd_applet: null })
    clearSession(connectorId)
  },

  // 删除连接器/换设备时清本地会话（含 Electron 持久化分区，防 cookie+JWT 磁盘残留串台）。
  // bare clearSession 经词法作用域指向上面的模块级函数（非本方法）。
  clearSession(connectorId: string): void {
    clearSession(connectorId)
  },

  // 「门店」= 项目(applet)
  async listShops(connectorId: string, page = 1, pagesize = 18): Promise<{ list: MallShop[]; count: number }> {
    const r = await sfetch(connectorId, 'admin/applet/userIndex', {
      query: { page, size: pagesize, type: 7, source: 0, key: '' },
      auth: true,
    })
    const json = await r.json()
    if (String(json.code) !== SUCCESS_CODE) throw new QdyunError(json.code, json.msg || '获取项目失败')
    // 真实结构（实测）：{code,data:{lists:{total,data:[...applet]}}}；兼容其它形态兜底
    const rows: any[] =
      json.data?.lists?.data ||
      json.data?.list ||
      json.data?.data ||
      (Array.isArray(json.data?.lists) ? json.data.lists : Array.isArray(json.data) ? json.data : [])
    const list: MallShop[] = rows.map((p: any) => ({
      id: Number(p.uniacid ?? p.appletid ?? p.id),
      name: String(p.name ?? p.title ?? ''),
      logo: String(p.thumb ?? p.logo ?? p.icon ?? ''),
      status: Number(p.status) || 0,
      showstatus: p.showstatus ?? '',
      status_text: String(p.status_text ?? p.expire_text ?? ''),
      goods_count: Number(p.goods_count ?? 0),
      is_root: 0,
      days: String(p.days ?? ''),
    }))
    return { list, count: Number(json.data?.lists?.total ?? json.data?.total ?? json.data?.count ?? list.length) }
  },

  async switchShop(connectorId: string, shopId: number, shopName = ''): Promise<{ ok: boolean }> {
    const s = getSession(connectorId)
    s.appletId = shopId
    connectorService.setExtra(connectorId, { qd_applet: shopId })
    connectorService.setCurrentShop(connectorId, shopId, shopName)
    return { ok: true }
  },

  // 商品列表：we7 列表行 JS 渲染，用隐藏窗口读渲染态
  async listGoods(connectorId: string, params: MallGoodsListParams = {}): Promise<{ list: MallGoodsListItem[]; count: number }> {
    const appletId = getSession(connectorId).appletId
    if (!appletId) throw new QdyunError(-1, '请先选择项目')
    await ensureWe7Session(connectorId, appletId)
    const js = `(async function(){
      var deadline=Date.now()+15000;
      function rows(){return document.querySelectorAll('table tr, .layui-table tr, tbody tr');}
      while(Date.now()<deadline){ if(rows().length>1) break; await new Promise(function(r){setTimeout(r,300)}); }
      var trs=rows(); var out=[];
      for(var i=0;i<trs.length;i++){
        var tr=trs[i]; var proid=0;
        var as=tr.querySelectorAll('a');
        for(var k=0;k<as.length;k++){ var hv=(as[k].getAttribute('href')||'')+(as[k].getAttribute('onclick')||'');
          var m=hv.match(/proid=(\\d+)/)||hv.match(/newsid=(\\d+)/); if(m){proid=Number(m[1]);break;} }
        if(!proid) continue;
        var img=tr.querySelector('img'); var pic=img?(img.getAttribute('src')||''):'';
        var tds=tr.querySelectorAll('td'); var title=''; var price='';
        for(var t=0;t<tds.length;t++){ var tx=(tds[t].textContent||'').trim();
          if(!title && tx.length>1 && !/^[0-9.￥¥]+$/.test(tx) && tds[t].querySelector('img')===null) title=tx.slice(0,40);
          if(!price && /^[￥¥]?[0-9]+(\\.[0-9]+)?$/.test(tx)) price=tx.replace(/[￥¥]/,''); }
        // 多规格识别：列表服务端渲染了 data-type={use_more}(库存/价格单元格,1=多规格)，兜底看 .badge-info “多”徽标
        var useMore=''; var dt=tr.querySelector('[data-type]'); if(dt) useMore=(dt.getAttribute('data-type')||'').trim();
        var hasOpt = useMore==='1' ? 1 : 0;
        if(!hasOpt){ var bi=tr.querySelector('.badge-info'); if(bi && (bi.textContent||'').trim()==='多') hasOpt=1; }
        out.push({ id:proid, title:title, thumb:pic, status:1, has_option:hasOpt, selling_type:0, type:0, price:price });
      }
      // 去重(同 proid 多行取首)
      var seen={}; var uniq=[];
      for(var u=0;u<out.length;u++){ if(!seen[out[u].id]){seen[out[u].id]=1; uniq.push(out[u]);} }
      return uniq;
    })()`
    const list: MallGoodsListItem[] = await runInWindow(
      connectorId,
      `index/duoproducts/index?appletid=${appletId}`,
      js,
      30000,
    )
    let filtered = Array.isArray(list) ? list : []
    if (params.title) filtered = filtered.filter((g) => String(g.title || '').includes(params.title as string))
    return { list: filtered, count: filtered.length }
  },

  async getGoodsDetail(connectorId: string, goodsId: number): Promise<MallGoodsDetail> {
    // 读编辑器里的当前主图/轮播/标题作预览（用列表暂存的 thumb 兜底）
    const appletId = getSession(connectorId).appletId
    const js = `(async function(){
      function q(s){return document.querySelector(s);}
      var deadline=Date.now()+18000;
      while(Date.now()<deadline){ var t=q('#proTitle'); var w2=q('#w2'); if(t&&t.value&&w2&&w2.options.length>1&&window.ue&&window.ue.isReady) break; await new Promise(function(r){setTimeout(r,300)}); }
      function val(n){var e=document.querySelector("[name='"+n+"']"); return e?String(e.value||''):'';}
      var imgs=[]; document.querySelectorAll("[name='imgsrcs[]']").forEach(function(e){ if(e.value) imgs.push(e.value); });
      // 详情(UEditor)内容：用于桌面端「详情图含 N 张图」统计，改图后刷新即更新。尽力读，未就绪给空。
      var detail=''; try{ if(window.ue && window.ue.getContent) detail=String(window.ue.getContent()||''); }catch(e){}
      return { title:(q('#proTitle')?q('#proTitle').value:''), thumb:val('commonuploadpic1'), thumbs:imgs, use_more:val('use_more'), detail:detail };
    })()`
    let data: any = {}
    try {
      await ensureWe7Session(connectorId, appletId)
      data = await runInWindow(connectorId, `index/duoproducts/add.html?appletid=${appletId}&newsid=${goodsId}`, js, 25000)
    } catch {
      data = {}
    }
    const goods: any = {
      id: goodsId,
      title: String(data.title || ''),
      thumb: String(data.thumb || ''),
      thumbs: Array.isArray(data.thumbs) ? data.thumbs : [],
      content: String(data.detail || ''), // 详情 HTML（含 <img>）→ EweiGoodsImageView 统计「详情图含 N 张图」
      has_option: hasRealOption(data.use_more) ? 1 : 0,
    }
    return { goods, options: [], specs: [] }
  },

  // 上传：媒体库 /pic/upImage，字段 uploadfile0 → 绝对 COS URL。
  // 包装：同 connector 串行执行（隐藏窗口共享持久化分区，并发改图会串扰会话/DOM），实际逻辑在 doReplaceGoodsImage。
  replaceGoodsImage(args: ReplaceGoodsImageArgs): Promise<{ ok: boolean; uploaded: EweiUploadResult[] }> {
    const prev = saveQueues.get(args.connectorId) ?? Promise.resolve()
    const task = prev.catch(() => {}).then(() => doReplaceGoodsImage(args))
    saveQueues.set(args.connectorId, task)
    // 队尾清理：本任务仍是队尾时移除条目，避免 Map 残留（被后续 set 覆盖亦无妨）。
    task.catch(() => {}).finally(() => {
      if (saveQueues.get(args.connectorId) === task) saveQueues.delete(args.connectorId)
    })
    return task
  },

  async listGoodsCategories(): Promise<MallCategory[]> {
    return []
  },
  async addGoods(): Promise<{ goodsId: number }> {
    throw new QdyunError(-1, '该商城暂不支持在桌面端新增商品')
  },
}

/** 改图实际实现（由 replaceGoodsImage 在 per-connector 串行队列内调用）。 */
async function doReplaceGoodsImage(args: ReplaceGoodsImageArgs): Promise<{ ok: boolean; uploaded: EweiUploadResult[] }> {
  const { connectorId, goodsId, slot, images } = args
  if (!images || !images.length) throw new QdyunError(-1, '没有可应用的图片')
  const SUPPORTED = ['mainThumb', 'galleryReplace', 'galleryAppend', 'detailReplace', 'detailAppend']
  if (!SUPPORTED.includes(slot)) {
    throw new QdyunError(-1, '该图位暂不支持（多规格 SKU 图需用商城后台处理）')
  }
  const appletId = getSession(connectorId).appletId
  if (!appletId) throw new QdyunError(-1, '请先选择项目')

  let failedLogged = false
  const logId = connectorService.createImageLog({ connectorId, shopId: appletId, goodsId, goodsTitle: '', slot, oldValue: null })
  try {
    // 0) 建立 we7 会话（上传与保存都走 /index，需先桥接）
    await ensureWe7Session(connectorId, appletId)
    // 1) 上传新图
    const uploaded: EweiUploadResult[] = []
    for (let i = 0; i < images.length; i++) {
      broadcastProgress({ goodsId, phase: 'uploading', current: i, total: images.length, message: `上传第 ${i + 1}/${images.length} 张` })
      uploaded.push(await uploadImage(connectorId, appletId, images[i]))
    }
    const urls = uploaded.map((u) => u.url)
    connectorService.updateImageLog(logId, { status: 'uploaded', newPaths: urls })

    // 2) 隐藏窗口加载编辑器 → 按图位修改(主图commonuploadpic1 / 轮播imgsrcs[] / 详情UEditor)
    //    + checkinfo() + 序列化 FormData POST save.html。每个失败返回带 stage/diag 便于定位。
    broadcastProgress({ goodsId, phase: 'saving', message: '写回商品…' })
    const js = `(async function(){
      function q(s){return document.querySelector(s);}
      function ready(){
        if(typeof window.$==='undefined') return false;
        var f=q('#form_sample_2')||q('form[action*=save]');
        var t=q('#proTitle'); var w2=q('#w2'); var thumb=q("[name='commonuploadpic1']");
        var slide=document.querySelectorAll('#imgzs .thumbnail');
        var ueOk=window.ue && window.ue.isReady;
        return !!(f && t && t.value && w2 && thumb && thumb.value && slide.length>0 && ueOk);
      }
      function diag(){ return { jq:typeof window.$!=='undefined', ue:!!window.ue, ueReady:!!(window.ue&&window.ue.isReady), w2:!!(q('#w2')&&q('#w2').value), title:!!(q('#proTitle')&&q('#proTitle').value), thumb:!!(q("[name='commonuploadpic1']")&&q("[name='commonuploadpic1']").value), href:String(location.href||'').slice(0,120) }; }
      var deadline=Date.now()+${QD_READY_MS};
      while(Date.now()<deadline){ if(ready()) break; await new Promise(function(r){setTimeout(r,300)}); }
      var form=q('#form_sample_2')||q('form[action*=save]');
      if(!form) return {ok:false,stage:'ready',msg:'编辑器表单未加载完成',diag:diag()};
      var oldThumb=(q("[name='commonuploadpic1']")||{}).value||'';
      var title=(q('#proTitle')||{}).value||'';
      var w2=q('#w2');
      if(!w2 || !w2.value){ return {ok:false,stage:'category',msg:'该商品在商城后台未设置"所属分类"(保存强制要求分类)，请先在商城后台为其设置分类后再改图',title:title,oldThumb:oldThumb}; }
      var t=q('#proTitle'); if(!t || !t.value) return {ok:false,stage:'title',msg:'该商品缺少名称，无法保存',title:title,oldThumb:oldThumb};
      var um=q("input[name='use_more']:checked")||q("[name='use_more']");
      var isMulti = !!(um && String(um.value)==='1');
      var skuBefore=0;
      if(isMulti){
        // 多规格(SKU)：改图走全量保存，SKU 由编辑器 checkinfo()->ggzbc() 打包进 #biaogedata。
        // 必须先确保 getDuoTypeValues 已把现有 SKU 载入 allarrone(并渲染出 valarr{i} 输入)，否则
        // ggzbc 会打包空数组 → 保存时清空规格/价格/库存。allarrone 初值 []，仅 changeType() 内 AJAX 填充。
        try{ if((typeof allarrone==='undefined'||!allarrone.length) && typeof changeType==='function') changeType(); }catch(x){}
        var skuDeadline=Date.now()+${QD_SKU_MS};
        while(Date.now()<skuDeadline){
          if(typeof allarrone!=='undefined' && allarrone.length>0 && q("input[name='valarr0']")) break;
          await new Promise(function(r){setTimeout(r,300)});
        }
        if(typeof allarrone==='undefined' || !allarrone.length || !q("input[name='valarr0']")){
          return {ok:false,stage:'sku_load',msg:'多规格(SKU)数据未能加载完成，为避免保存时清空规格已中止，请重试，或用商城后台处理该商品',title:title,oldThumb:oldThumb};
        }
        skuBefore = allarrone.length; // 改图前真实 SKU 数（后置超集断言基准）
      }
      if(!window.ue || !window.ue.isReady) return {ok:false,stage:'ue',msg:'商品详情编辑器未就绪，请重试',title:title,oldThumb:oldThumb};
      try{ window.ue.sync(); }catch(x){}
      var SLOT=${JSON.stringify(slot)};
      var URLS=${JSON.stringify(urls)};
      // ---- 按图位修改 ----
      if(SLOT==='mainThumb'){
        var NEW=URLS[0]; var set=0;
        document.querySelectorAll("[name='commonuploadpic1']").forEach(function(e){ e.value=NEW; e.setAttribute('value',NEW); set++; });
        if(set===0) return {ok:false,stage:'apply',msg:'未找到主图字段(commonuploadpic1)',title:title,oldThumb:oldThumb};
        var pv=q('.thumbnail.commonuploadpic1 img'); if(pv) pv.setAttribute('src',NEW);
      } else if(SLOT==='galleryReplace' || SLOT==='galleryAppend'){
        var zs=q('#imgzs'); if(!zs) return {ok:false,stage:'apply',msg:'未找到轮播容器',title:title,oldThumb:oldThumb};
        if(SLOT==='galleryReplace'){ zs.querySelectorAll('.thumbnail').forEach(function(e){ e.remove(); }); }
        URLS.forEach(function(u){
          var d=document.createElement('div'); d.className='thumbnail';
          var inp=document.createElement('input'); inp.type='text'; inp.name='imgsrcs[]'; inp.value=u; inp.setAttribute('hidden','hidden');
          var im=document.createElement('img'); im.src=u; d.appendChild(inp); d.appendChild(im); zs.appendChild(d);
        });
      } else if(SLOT==='detailReplace' || SLOT==='detailAppend'){
        var html=URLS.map(function(u){ return '<p><img src="'+u+'" style="max-width:100%"/></p>'; }).join('');
        if(SLOT==='detailReplace'){ window.ue.setContent(html); } else { window.ue.setContent(html, true); }
        try{ window.ue.sync(); }catch(x){}
      } else { return {ok:false,stage:'apply',msg:'不支持的图位',title:title,oldThumb:oldThumb}; }
      // ---- 修改后再做轮播可序列化守卫(防全量替换丢图) ----
      var shownSlide=document.querySelectorAll('#imgzs .thumbnail').length;
      if(shownSlide===0) return {ok:false,stage:'guard',msg:'该商品缺少轮播图，保存要求至少一张轮播图',title:title,oldThumb:oldThumb};
      var namedSlide=document.querySelectorAll("#imgzs [name='imgsrcs[]']").length;
      if(namedSlide<shownSlide){ return {ok:false,stage:'guard',msg:'轮播图存在无法安全序列化的项(可能为已上传图对象)，为避免保存时丢图已中止，请用商城后台处理该商品',title:title,oldThumb:oldThumb}; }
      var ci=(typeof window.checkinfo==='function') ? window.checkinfo() : undefined;
      if(ci===false){ return {ok:false,stage:'checkinfo',msg:'保存校验未通过：商品仍有缺失的必填项，请在商城后台补全后再改图',title:title,oldThumb:oldThumb}; }
      if(isMulti){
        // checkinfo() 已调 ggzbc() 把 SKU 打包进 #biaogedata；后置安全闸：非空 + 数量不少于改图前(超集)，
        // 否则中止，绝不提交清空/丢失 SKU 的请求。
        var bg=q('#biaogedata'); var sku=[]; try{ sku=JSON.parse((bg&&bg.value)||'[]'); }catch(e){}
        if(!Array.isArray(sku) || sku.length===0){
          return {ok:false,stage:'sku_pack',msg:'多规格(SKU)数据打包异常(为空)，已中止保存以避免清空规格，请用商城后台处理该商品',title:title,oldThumb:oldThumb};
        }
        if(skuBefore>0 && sku.length<skuBefore){
          return {ok:false,stage:'sku_pack',msg:'多规格(SKU)打包数量('+sku.length+')少于载入数量('+skuBefore+')，为避免丢失规格已中止保存，请重试或用商城后台处理该商品',title:title,oldThumb:oldThumb};
        }
      }
      var fd=new FormData(form); var p=new URLSearchParams();
      var it=fd.entries(),e;
      while(!(e=it.next()).done){ if(typeof e.value[1]==='string') p.append(e.value[0], e.value[1]); }
      var r=await fetch(form.getAttribute('action'),{method:'POST',headers:{'x-requested-with':'XMLHttpRequest','content-type':'application/x-www-form-urlencoded;charset=UTF-8'},body:p.toString()});
      var txt=await r.text(); var j={}; try{ j=JSON.parse(txt); }catch(x){}
      var okSave=(r.status>=200&&r.status<300)&&(Number(j.code)===1);
      var kind='business';
      if(!okSave){
        if(/new_plat|请登录|重新登录|未登录|登录失效/.test(txt)) kind='session';
        else if(/分类|规格|必填|不能为空|缺/.test(String(j.msg||''))) kind='data_incomplete';
      }
      return { ok:okSave, stage:'save', kind:kind, code:j.code, status:j.status, msg:String(j.msg||txt.slice(0,150)), url:j.url, title:title, oldThumb:oldThumb };
    })()`
    const result = await runInWindow(connectorId, `index/duoproducts/add.html?appletid=${appletId}&newsid=${goodsId}`, js, QD_SAVE_WINDOW_MS)
    // 回填改前主图/标题（建日志时进编辑器前拿不到，进编辑器后从渲染态读到再写入审计日志）
    if (result && (result.title || result.oldThumb)) {
      connectorService.updateImageLog(logId, {
        goodsTitle: String(result.title || ''),
        oldValue: { thumb: String(result.oldThumb || '') },
      })
    }
    if (!result || !result.ok) {
      const kind = result?.kind || 'business'
      // 会话失效：清 we7 桥接态，下次强制用 cache_key 重新 setLoginData 建 $_SESSION
      if (kind === 'session') we7Bridged.delete(connectorId)
      const diagStr = result?.diag ? ' | diag=' + JSON.stringify(result.diag) : ''
      connectorService.updateImageLog(logId, {
        status: 'failed',
        error: `[stage:${result?.stage || 'unknown'}][kind:${kind}] ${result?.msg || '保存失败'}${diagStr}`,
      })
      failedLogged = true
      const userMsg = kind === 'session' ? '商城登录已失效，请重新登录后再试' : result?.msg || '保存失败'
      broadcastProgress({ goodsId, phase: 'error', message: userMsg })
      throw new QdyunError(result?.code ?? -1, userMsg)
    }
    connectorService.updateImageLog(logId, { status: 'done' })
    broadcastProgress({ goodsId, phase: 'done', message: '已应用到商品' })
    return { ok: true, uploaded }
  } catch (e: any) {
    const msg = e?.message || '替换失败'
    if (!failedLogged) {
      connectorService.updateImageLog(logId, { status: 'failed', error: msg })
      broadcastProgress({ goodsId, phase: 'error', message: msg })
    }
    throw e
  }
}

// ---- 辅助 ----
function makeLoginResult(account: string) {
  return { uid: 0, account, contact: account, isAdmin: false, isRoot: false, isMerch: false, isSupply: false }
}

function broadcastProgress(p: any): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('ewei:progress', p)
    } catch {
      /* ignore */
    }
  }
}

/** 按魔数识别图片真实格式（决定 Blob 的 MIME 与文件名后缀）。 */
function detectImage(buf: Buffer): { mime: string; ext: string } {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return { mime: 'image/png', ext: 'png' }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (buf.length >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return { mime: 'image/gif', ext: 'gif' }
  if (buf.length >= 12 && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  return { mime: 'image/png', ext: 'png' }
}

const MAX_UPLOAD_SIDE = 2400 // 超过则等比压缩，兜底服务端「文件超出限制」(各项目上传大小上限不同)

async function uploadImage(connectorId: string, appletId: number, localPath: string): Promise<EweiUploadResult> {
  const abs = getAbsolutePath(localPath)
  let buf: Buffer<ArrayBufferLike> = readFileSync(abs)
  const rawName = abs.split(/[\\/]/).pop() || 'image'
  // 真实上传走媒体库端点 /pic/upImage(实测)，字段名 uploadfile0；旧 imgupload.html 在开启远程附件时会
  // foreach 报错(已废弃)。Blob 必须带 MIME，否则发出去是 application/octet-stream → 服务端「文件格式不正确」。
  const send = async (b: Buffer): Promise<any> => {
    const { mime, ext } = detectImage(b)
    const name = (rawName.replace(/\.[^.]*$/, '') || 'image') + '.' + ext
    const fd = new FormData()
    fd.append('uploadfile0', new Blob([new Uint8Array(b)], { type: mime }), name)
    const res = await sfetch(connectorId, 'pic/upImage', { method: 'POST', query: { uniacid: appletId, gid: 0 }, formData: fd })
    return JSON.parse(await res.text())
  }
  let json: any
  try {
    json = await send(buf)
  } catch {
    throw new QdyunError(-1, '上传响应异常')
  }
  // 文件过大兜底：服务端报「文件超出限制」等→等比压成 JPEG 重试一次(各项目上传上限不同，详情大图常超限)
  if (Number(json.code) !== 0 && /超出|过大|限制|large|size|big|exceed/i.test(String(json.msg || ''))) {
    const jpeg = makeUploadThumbnail(buf, MAX_UPLOAD_SIDE, 85)
    if (jpeg) {
      buf = jpeg
      try {
        json = await send(buf)
      } catch {
        /* 重试响应异常则沿用上一次错误 */
      }
    }
  }
  // 成功为 {code:0, data:[{url,pid}]}（注意 code:0 是成功）；失败 {code:!0, msg}
  if (Number(json.code) !== 0) {
    throw new QdyunError(json?.code ?? -1, json?.msg || '上传失败')
  }
  const url = json.data?.[0]?.url || json.url
  if (!url) throw new QdyunError(-1, '上传成功但未返回图片地址')
  return { path: String(url), url: String(url), width: 0, height: 0, id: Number(json.data?.[0]?.pid) || 0 }
}

export { qdyunAdapter }
