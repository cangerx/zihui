// ============================================================================
// 改图安全守卫：三商城共用的「SKU 集合一致」断言。
// 「店铺商品图」改的是主图/图集/详情图，本不应增减任何 SKU；但三家后端的保存都是
// 「全量替换 + 删除未列入的 SKU」，桌面端被迫整体回提 SKU。各家原有守卫只挡「完全读不到
// SKU」，挡不住「读到但被截断/重建漏项」——缺失的真实 SKU 会被服务端物理删除（不可逆）。
// 这里把防护统一成「前后置集合断言」：保存/提交所携带的 SKU 集合必须是改图前真实 SKU 集合
// 的超集（只防删除，不约束新增），缺失即抛错中止。
// ============================================================================

/** 规整为去重后的非空字符串 Set（过滤 null/undefined/空串）。 */
function toIdSet(ids: Array<string | number | null | undefined>): Set<string> {
  const set = new Set<string>()
  for (const v of ids) {
    if (v === null || v === undefined) continue
    const k = String(v).trim()
    if (k) set.add(k)
  }
  return set
}

/**
 * 断言 afterIds ⊇ beforeIds（提交后的 SKU 至少覆盖改图前的每一个），否则抛错中止。
 * 仅防「删除/漏项」，不限制新增。beforeIds 为空（单规格 / 取不到稳定 id）时视为无基准、直接放行
 * （由调用方在取不到 id 时降级，避免因取不到 id 而误中止正常改图）。
 * @param label 商城标识，用于错误信息区分（如 'eweishop' / '点大' / '全端云'）。
 */
export function assertSkuSetConsistent(
  label: string,
  beforeIds: Array<string | number | null | undefined>,
  afterIds: Array<string | number | null | undefined>,
): void {
  const before = toIdSet(beforeIds)
  if (before.size === 0) return // 无可比基准 → 不约束（防误伤）
  const after = toIdSet(afterIds)
  const missing: string[] = []
  for (const id of before) if (!after.has(id)) missing.push(id)
  if (missing.length) {
    throw new Error(
      `${label}: 改图会丢失 SKU（改前 ${before.size} 个，提交 ${after.size} 个，缺失 ${missing.length} 个），已中止以避免清空规格`,
    )
  }
}

/**
 * 非空 SKU 守卫：多规格商品却读不到任何 SKU 时抛错中止（统一各家「读不到规格即中止」文案）。
 */
export function nonEmptySkuGuard(label: string, ids: Array<string | number | null | undefined>): void {
  if (toIdSet(ids).size === 0) {
    throw new Error(`${label}: 未能读取商品规格(SKU)数据，已中止以避免清空规格，请重试或用商城后台处理`)
  }
}
