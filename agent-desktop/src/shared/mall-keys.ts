// ============================================================================
// 三商城 mall_key 单一来源（死契约，三端约定一致：ewei / dianda / qdyun）。
// main / preload / renderer 三侧均经 @shared 引用本文件，杜绝各处独立硬编码枚举漂移。
// 新增第 N 个商城：只改这一处 MALL_KEYS + 写一个 xxx-adapter 并在 registry 注册。
// registry 用 Record<MallKey> 承接 adapters → 漏注册某个 key 即 TS 编译报错（库内最强守卫）。
//
// 与云端契约对齐（值必须逐字一致，否则授权链静默断裂）：
//   - agent-admin  EweiShopAuthorization::MALL_KEYS / policyKey / settingKey
//   - agent-build  MallAuthorizationService::MALL_KEYS
// ============================================================================
export const MALL_KEYS = ['ewei', 'dianda', 'qdyun'] as const
export type MallKey = (typeof MALL_KEYS)[number]

/** 某 mall 的 per-user 二级授权 policy key（对齐 agent-admin policyKey）。 */
export function mallPolicyKey(mall: MallKey | string): string {
  return 'allow_' + mall + '_shop'
}

/** 某 mall 的显示名 setting key（对齐 agent-admin settingKey）。 */
export function mallNameKey(mall: MallKey | string): string {
  return mall + '_shop_mall_name'
}

/** 全部二级授权 policy key（菜单 / 路由 requireAnyMall、cloud-auth 默认值派生用）。 */
export const MALL_POLICY_KEYS: string[] = MALL_KEYS.map(mallPolicyKey)

/** 是否为合法 mall_key。 */
export function isMallKey(k: string | null | undefined): k is MallKey {
  return !!k && (MALL_KEYS as readonly string[]).includes(k)
}
