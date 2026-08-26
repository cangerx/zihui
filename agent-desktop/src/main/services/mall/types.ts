// ============================================================================
// 多商城适配器抽象（MallAdapter）。
// 「店铺商品图」对接的第三方商城从单一 ewei 泛化为可扩展多商城：每个平台实现一份
// MallAdapter，上层 IPC 按连接器 platform 分发（registry.getAdapter）。
// ewei 为参考实现，类型直接复用 ewei-client 的导出，避免重复定义与字段漂移。
// ============================================================================
import type {
  EweiLoginResult,
  EweiShop,
  EweiGoodsListItem,
  GoodsListParams,
  EweiGoodsDetail,
  EweiCategory,
  EweiUploadResult,
  ReplaceGoodsImageArgs,
  AddGoodsForm,
} from '../ewei-client'

export type MallLoginResult = EweiLoginResult
export type MallShop = EweiShop
export type MallGoodsListItem = EweiGoodsListItem
export type MallGoodsListParams = GoodsListParams
export type MallGoodsDetail = EweiGoodsDetail
export type MallCategory = EweiCategory
export type { EweiUploadResult, ReplaceGoodsImageArgs, AddGoodsForm }

/** 平台能力位：renderer 据此显隐「选门店」、是否走验证码登录等。 */
export interface MallCapabilities {
  /** 是否有「门店/多店」需先选店再列商品（ewei=true / 点大=false）。 */
  needsShopSwitch: boolean
  /** 登录是否需要图形验证码（点大=true / ewei=false）。 */
  needsCaptcha: boolean
  /** 是否支持新增商品。 */
  supportsAddGoods: boolean
  /** 是否支持「图集」改图(替换/追加)。 */
  supportsGallery: boolean
  /** 是否支持「详情图」改图(替换/追加)。 */
  supportsDetailImage: boolean
  /** 是否支持「SKU 图」改图（多规格规格图）。 */
  supportsOptionThumb: boolean
  /** 详情图载体：'html'(ewei/全端云 富文本) / 'blocks'(点大块状 JSON)。 */
  detailFormat: 'html' | 'blocks'
}

/** 需要验证码时返回的挑战：captchaImage 是 data URL，renderer 直接 <img :src>。 */
export interface MallCaptchaChallenge {
  needCaptcha: true
  captchaImage: string
  /** 不透明令牌，submitLogin 时回传（点大用它定位 pending 会话；ewei 不用）。 */
  challengeId?: string
}

/** beginLogin / submitLogin 的统一返回：直接登录成功，或需要验证码。 */
export type MallBeginLoginResult =
  | { needCaptcha: false; result: MallLoginResult }
  | MallCaptchaChallenge

export interface MallAdapter {
  readonly platform: string
  readonly capabilities: MallCapabilities

  /** 开始登录：可直接登录(ewei)则返回 result；需验证码(点大)则返回 captcha 挑战。 */
  beginLogin(connectorId: string): Promise<MallBeginLoginResult>
  /** 提交验证码完成登录（仅 needsCaptcha 平台）；验证码错可再返回新挑战。 */
  submitLogin(connectorId: string, captcha: string, challengeId?: string): Promise<MallBeginLoginResult>
  /** 换一张验证码（「看不清」）。仅 needsCaptcha 平台实现。 */
  refreshCaptcha?(connectorId: string): Promise<MallCaptchaChallenge>

  logout(connectorId: string): Promise<void>
  /** 清本地会话/缓存（删除连接器、换设备时调）。同步、不发网络请求，按平台清各自的内存态/cookie/分区。 */
  clearSession(connectorId: string): void
  listShops(connectorId: string, page?: number, pagesize?: number): Promise<{ list: MallShop[]; count: number }>
  switchShop(connectorId: string, shopId: number, shopName?: string): Promise<{ ok: boolean }>
  listGoods(connectorId: string, params?: MallGoodsListParams): Promise<{ list: MallGoodsListItem[]; count: number }>
  getGoodsDetail(connectorId: string, goodsId: number): Promise<MallGoodsDetail>
  replaceGoodsImage(args: ReplaceGoodsImageArgs): Promise<{ ok: boolean; uploaded: EweiUploadResult[] }>
  listGoodsCategories(connectorId: string): Promise<MallCategory[]>
  addGoods(connectorId: string, form: AddGoodsForm): Promise<{ goodsId: number }>
}
