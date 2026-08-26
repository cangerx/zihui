import { defineStore } from 'pinia'
import { ref } from 'vue'

// window.api 是固定类型，未含 ewei，统一用 any 桥接（与 ecom 的 (window as any).api 一致）。
const ewei = () => (window as any).api.ewei

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

export interface EweiLoginResult {
  uid: number
  account: string
  contact: string
  isAdmin: boolean
  isRoot: boolean
  isMerch: boolean
  isSupply: boolean
}

/** 平台能力位（与主进程 MallCapabilities 对齐）：renderer 据此显隐选门店/验证码。 */
export interface MallCapabilities {
  needsShopSwitch: boolean
  needsCaptcha: boolean
  supportsAddGoods: boolean
  supportsGallery: boolean
  supportsDetailImage: boolean
  supportsOptionThumb: boolean
  detailFormat: 'html' | 'blocks'
}

/** 登录结果：直接成功，或需验证码（点大）。 */
export type MallBeginLoginResult =
  | { needCaptcha: false; result: EweiLoginResult }
  | { needCaptcha: true; captchaImage: string; challengeId?: string }

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

export const useEweiStore = defineStore('ewei', () => {
  const connectors = ref<EweiConnectorSummary[]>([])
  const loading = ref(false)
  // connectorId -> 登录结果（内存态，进程级会话在主进程维护）
  const loginInfo = ref<Record<string, EweiLoginResult>>({})
  // 从商品列表点进图片工作台时暂存的列表项（带「绝对 thumb URL」，用于详情页预览现有图）。
  const currentGoods = ref<{ id: number; title: string; thumb: string } | null>(null)
  function setCurrentGoods(g: { id: number; title: string; thumb: string } | null): void {
    currentGoods.value = g
  }

  // ===== 页面状态持久化（切走再回来不丢；store 是单例，跨路由存活）=====
  // 商品列表（按 connectorId）：筛选 + 已加载结果
  const goodsListState = ref<Record<string, any>>({})
  function getGoodsListState(id: string): any {
    return goodsListState.value[id] || null
  }
  function setGoodsListState(id: string, s: any): void {
    goodsListState.value[id] = s
  }
  // 图片工作台（按 goodsId）：图位 + 来源 tab + 已选图（AI 生成结果由 ecom-gen scope 自身持久）
  const imageWorkState = ref<Record<string, any>>({})
  function getImageWorkState(goodsId: number): any {
    return imageWorkState.value[String(goodsId)] || null
  }
  function setImageWorkState(goodsId: number, s: any): void {
    imageWorkState.value[String(goodsId)] = s
  }
  // 新增商品草稿（按 connectorId）：整个表单
  const createDraft = ref<Record<string, any>>({})
  function getCreateDraft(id: string): any {
    return createDraft.value[id] || null
  }
  function setCreateDraft(id: string, d: any): void {
    createDraft.value[id] = d
  }
  function clearCreateDraft(id: string): void {
    delete createDraft.value[id]
  }

  async function loadConnectors(): Promise<void> {
    loading.value = true
    try {
      connectors.value = (await ewei().invoke('listConnectors')) || []
    } finally {
      loading.value = false
    }
  }

  function getConnector(id: string): EweiConnectorSummary | undefined {
    return connectors.value.find((c) => c.id === id)
  }

  async function createConnector(data: {
    name: string
    base_url: string
    account: string
    password: string
    platform?: string
    is_default?: boolean
  }): Promise<EweiConnectorSummary> {
    const c = await ewei().invoke('createConnector', data)
    await loadConnectors()
    return c
  }

  async function updateConnector(
    id: string,
    data: Partial<{ name: string; base_url: string; account: string; password: string; is_default: boolean }>,
  ): Promise<void> {
    await ewei().invoke('updateConnector', id, data)
    await loadConnectors()
  }

  async function deleteConnector(id: string): Promise<void> {
    await ewei().invoke('deleteConnector', id)
    delete loginInfo.value[id]
    await loadConnectors()
  }

  // 登录：beginLogin 直接成功(ewei)或返回验证码挑战(点大)
  async function login(id: string): Promise<MallBeginLoginResult> {
    const r = (await ewei().invoke('login', id)) as MallBeginLoginResult
    if (!r.needCaptcha) loginInfo.value[id] = r.result
    return r
  }
  // 提交验证码完成登录（点大）；验证码错会再返回新挑战
  async function submitLogin(id: string, captcha: string): Promise<MallBeginLoginResult> {
    const r = (await ewei().invoke('submitLogin', id, captcha)) as MallBeginLoginResult
    if (!r.needCaptcha) loginInfo.value[id] = r.result
    return r
  }
  // 换一张验证码
  async function refreshCaptcha(id: string): Promise<{ captchaImage: string }> {
    return (await ewei().invoke('refreshCaptcha', id)) as { captchaImage: string }
  }
  // 平台能力位（缓存按 connectorId）
  const capsCache = ref<Record<string, MallCapabilities>>({})
  async function getCapabilities(id: string): Promise<MallCapabilities> {
    if (capsCache.value[id]) return capsCache.value[id]
    const c = (await ewei().invoke('capabilities', id)) as MallCapabilities
    capsCache.value[id] = c
    return c
  }

  async function logout(id: string): Promise<void> {
    await ewei().invoke('logout', id)
    delete loginInfo.value[id]
  }

  async function listShops(id: string, page = 1, pagesize = 50): Promise<{ list: EweiShop[]; count: number }> {
    return await ewei().invoke('listShops', id, page, pagesize)
  }

  // 切门店后清掉该连接器的本地缓存：商品列表结果 / 新增商品草稿 / 暂存的当前商品。
  // 这些缓存 key 只含 connectorId、不含门店 id，若不作废，门店B进入时会直接命中复用门店A的旧数据。
  function clearConnectorCache(id: string): void {
    delete goodsListState.value[id]
    delete createDraft.value[id]
    currentGoods.value = null
  }

  async function switchShop(id: string, shopId: number, shopName = ''): Promise<void> {
    await ewei().invoke('switchShop', id, shopId, shopName)
    clearConnectorCache(id) // 门店已变，作废旧门店残留的列表/草稿缓存，强制下次进入重新拉取
    await loadConnectors() // 刷新 current_shop_*
  }

  return {
    connectors,
    loading,
    loginInfo,
    currentGoods,
    setCurrentGoods,
    getGoodsListState,
    setGoodsListState,
    getImageWorkState,
    setImageWorkState,
    getCreateDraft,
    setCreateDraft,
    clearCreateDraft,
    loadConnectors,
    getConnector,
    createConnector,
    updateConnector,
    deleteConnector,
    login,
    submitLogin,
    refreshCaptcha,
    getCapabilities,
    logout,
    listShops,
    switchShop,
    clearConnectorCache,
  }
})
