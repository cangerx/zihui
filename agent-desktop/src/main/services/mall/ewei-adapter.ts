// eweishop 适配器：直接包装现有 ewei-client（零改动）。eweishop 登录无需验证码、有门店切换。
import * as ewei from '../ewei-client'
import type { MallAdapter, MallBeginLoginResult } from './types'

export const eweiAdapter: MallAdapter = {
  platform: 'ewei',
  capabilities: {
    needsShopSwitch: true,
    needsCaptcha: false,
    supportsAddGoods: true,
    supportsGallery: true,
    supportsDetailImage: true,
    supportsOptionThumb: true,
    detailFormat: 'html',
  },

  async beginLogin(connectorId: string): Promise<MallBeginLoginResult> {
    const result = await ewei.login(connectorId)
    return { needCaptcha: false, result }
  },
  async submitLogin(): Promise<MallBeginLoginResult> {
    throw new Error('该商城登录无需验证码')
  },

  logout: (connectorId) => ewei.logout(connectorId),
  clearSession: (connectorId) => ewei.clearSession(connectorId),
  listShops: (connectorId, page, pagesize) => ewei.listShops(connectorId, page, pagesize),
  switchShop: (connectorId, shopId, shopName) => ewei.switchShop(connectorId, shopId, shopName),
  listGoods: (connectorId, params) => ewei.listGoods(connectorId, params),
  getGoodsDetail: (connectorId, goodsId) => ewei.getGoodsDetail(connectorId, goodsId),
  replaceGoodsImage: (args) => ewei.replaceGoodsImage(args),
  listGoodsCategories: (connectorId) => ewei.listGoodsCategories(connectorId),
  addGoods: (connectorId, form) => ewei.addGoods(connectorId, form),
}
