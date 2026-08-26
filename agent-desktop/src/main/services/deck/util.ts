import type { SlideData, StatItem } from './types'

/** HTML 文本转义(防止槽位内容破坏结构/注入) */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 取字符串槽位 */
export function asString(d: SlideData, k: string): string {
  const v = d[k]
  return typeof v === 'string' ? v : ''
}

/** 取字符串数组槽位 */
export function asList(d: SlideData, k: string): string[] {
  const v = d[k]
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[]
  return []
}

/** 取 {value,label} 数组槽位 */
export function asStats(d: SlideData, k: string): StatItem[] {
  const v = d[k]
  if (
    Array.isArray(v) &&
    v.every((x) => x !== null && typeof x === 'object' && 'value' in x && 'label' in x)
  ) {
    return v as StatItem[]
  }
  return []
}
