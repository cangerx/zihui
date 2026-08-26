// 商城适配器注册表：按连接器 platform 分发到对应 MallAdapter。
// 新增第 N 个商城 = 在 @shared/mall-keys 的 MALL_KEYS 加一行 + 写一个 xxx-adapter + 这里注册一行。
import type { MallAdapter } from './types'
import { MALL_KEYS, isMallKey, type MallKey } from '@shared/mall-keys'
import { eweiAdapter } from './ewei-adapter'
import { diandaAdapter } from './dianda-adapter'
import { qdyunAdapter } from './qdyun-adapter'

// Record<MallKey, ...>：漏注册某个 mall_key 的适配器 → TS 编译期直接报错（库内最强守卫）。
const adapters: Record<MallKey, MallAdapter> = {
  ewei: eweiAdapter,
  dianda: diandaAdapter,
  qdyun: qdyunAdapter,
}

/** 已注册的平台 key 列表（renderer 平台选择器可据此渲染）。 */
export const MALL_PLATFORMS: readonly string[] = MALL_KEYS

/**
 * 按 platform 取适配器。
 *   - undefined/null/空串：回退 ewei（兼容历史无 platform 连接器；连接器已删时调用方传 undefined 亦走此分支）。
 *   - 明确非空但不在已注册枚举（platform 拼错/脏数据）：抛错——绝不静默用 ewei 协议去打别家商城域名。
 */
export function getAdapter(platform: string | undefined | null): MallAdapter {
  const raw = (platform ?? '').toString().trim().toLowerCase()
  if (!raw) return adapters.ewei
  if (!isMallKey(raw)) throw new Error(`未知商城平台: ${platform}`)
  return adapters[raw]
}

/** 取连接器对应适配器的能力位（renderer 据此显隐选门店/验证码等）。 */
export function getCapabilities(platform: string | undefined | null) {
  return getAdapter(platform).capabilities
}
