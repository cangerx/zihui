import type { SlideTemplate, SlideData, ThemeTokens } from '../types'
import { esc, asString, asStats } from '../util'

// 数据卡：标题 + 2-4 张巨型数字卡(value 大、label 小)。卡片背景/边框走 div。
export const kpiTemplate: SlideTemplate = {
  id: 'kpi',
  name: '数据卡',
  category: 'content',
  description: '关键指标页：标题 + 2-4 个巨型数字 + 说明，用于数据/成效。',
  schema: {
    title: { type: 'text', label: '标题', required: true, maxChars: 26 },
    stats: {
      type: 'stat-list',
      label: '指标',
      maxItems: 4,
      statValueMaxChars: 8,
      statLabelMaxChars: 22
    }
  },
  defaultData: {
    title: '受控模板带来的稳定性',
    stats: [
      { value: '≈100%', label: '受控 DOM 通过导出校验' },
      { value: '<30%', label: '自由 HTML 直跑通过率(反例)' },
      { value: '0', label: '外部 python/node 依赖' },
      { value: '3', label: '同源交付物 HTML/PDF/PPTX' }
    ]
  },
  render(data: SlideData, _theme: ThemeTokens): string {
    const title = asString(data, 'title')
    const stats = asStats(data, 'stats')
    const n = Math.max(stats.length, 1)
    const gap = 32
    const totalGap = gap * (n - 1)
    const cardW = Math.floor((1088 - totalGap) / n)
    const cards = stats
      .map((s, i) => {
        const left = 96 + i * (cardW + gap)
        return `
    <div data-ir style="position:absolute;left:${left}px;top:280px;width:${cardW}px;height:260px;background:var(--card);border:1px solid var(--rule);">
      <p data-ir style="margin:0;position:absolute;left:32px;top:40px;font-family:var(--font-display);font-size:64px;font-weight:700;color:var(--accent);">${esc(s.value)}</p>
      <p data-ir style="margin:0;position:absolute;left:32px;top:150px;width:${cardW - 64}px;font-size:20px;line-height:1.4;color:var(--card-fg);">${esc(s.label)}</p>
    </div>`
      })
      .join('')
    return `
<div data-ir-root style="position:relative;width:1280px;height:720px;background:var(--bg);color:var(--fg);font-family:var(--font-body);overflow:hidden;">
  <h2 data-ir style="margin:0;position:absolute;left:96px;top:120px;width:1088px;font-family:var(--font-display);font-size:44px;font-weight:700;color:var(--fg);">${esc(title)}</h2>
  ${cards}
</div>`.trim()
  }
}
