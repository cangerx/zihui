import { isBrandOverride } from '@shared/brand-override'
import type { BrandActiveSummary } from '@/composables/useWorkspaceBrandChip'

export function brandOptimizeSystemAddon(
  summary: BrandActiveSummary | null | undefined,
  userPrompt: string
): string {
  if (isBrandOverride(userPrompt)) {
    return (
      '\n\n用户本轮已声明覆盖品牌规范。不要把品牌色、禁忌或 must_tokens 写回去。不要删除用户主语。'
    )
  }
  const card = String(summary?.cardText || '').trim()
  const tokens = String(summary?.mustTokens || '').trim()
  if (!card && !tokens) {
    return '\n\n不要编造未提供的品牌色值（hex）。不要删除用户主语。'
  }
  return (
    '\n\n当前工作区品牌硬约束（遵守，但不要覆盖用户已写的主体；不要编造卡片里没有的 hex）：\n' +
    (card || tokens)
  )
}

export async function fetchBrandOptimizeAddon(userPrompt: string): Promise<string> {
  try {
    const summary = (await window.api.brand.invoke('getActiveSummary')) as BrandActiveSummary
    return brandOptimizeSystemAddon(summary, userPrompt)
  } catch {
    return brandOptimizeSystemAddon(null, userPrompt)
  }
}
