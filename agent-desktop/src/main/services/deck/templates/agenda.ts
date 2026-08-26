import type { SlideTemplate, SlideData, ThemeTokens } from '../types'
import { esc, asString, asList } from '../util'

// 目录：标题 + 有序条目(每条带两位序号)。
export const agendaTemplate: SlideTemplate = {
  id: 'agenda',
  name: '目录',
  category: 'structure',
  description: '议程/目录页：标题 + 有序条目列表，3-6 条为宜。',
  schema: {
    title: { type: 'text', label: '标题', required: true, maxChars: 24 },
    items: { type: 'list', label: '条目', maxItems: 6, itemMaxChars: 40 }
  },
  defaultData: {
    title: '今天讲什么',
    items: ['为什么要受控模板', '好看的两层根因', '导出与可编辑', '按需云缓存', '落地与排期']
  },
  render(data: SlideData, _theme: ThemeTokens): string {
    const title = asString(data, 'title')
    const items = asList(data, 'items')
    const rows = items
      .map((it, i) => {
        const n = String(i + 1).padStart(2, '0')
        return `
    <div data-ir style="height:1px;background:var(--rule);"></div>
    <div style="display:flex;align-items:baseline;gap:28px;padding:18px 0;">
      <p data-ir style="margin:0;width:64px;font-family:var(--font-mono);font-size:22px;color:var(--accent);">${esc(n)}</p>
      <p data-ir style="margin:0;font-size:30px;line-height:1.3;color:var(--fg);">${esc(it)}</p>
    </div>`
      })
      .join('')
    return `
<div data-ir-root style="position:relative;width:1280px;height:720px;background:var(--bg);color:var(--fg);font-family:var(--font-body);overflow:hidden;">
  <div style="position:absolute;left:160px;top:120px;width:960px;">
    <h2 data-ir style="margin:0 0 40px;font-family:var(--font-display);font-size:44px;font-weight:700;color:var(--fg);">${esc(title)}</h2>
    <div>${rows}</div>
  </div>
</div>`.trim()
  }
}
