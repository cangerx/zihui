import type { SlideTemplate, SlideData, ThemeTokens } from '../types'
import { esc, asString } from '../util'

// 章节分隔：超大序号/眉标 + 章节标题，居中留白。
export const sectionTemplate: SlideTemplate = {
  id: 'section',
  name: '章节分隔',
  category: 'structure',
  description: '章节过渡页：大号眉标(如 01) + 章节标题，强留白。',
  schema: {
    kicker: { type: 'text', label: '眉标/序号', maxChars: 16 },
    title: { type: 'text', label: '章节标题', required: true, maxChars: 36 },
    note: { type: 'text', label: '一句话说明', maxChars: 60 }
  },
  defaultData: {
    kicker: '01',
    title: '好看的两层根因',
    note: '受控结构 × 设计方法论'
  },
  render(data: SlideData, _theme: ThemeTokens): string {
    const kicker = asString(data, 'kicker')
    const title = asString(data, 'title')
    const note = asString(data, 'note')
    return `
<div data-ir-root style="position:relative;width:1280px;height:720px;background:var(--accent);color:#ffffff;font-family:var(--font-body);overflow:hidden;">
  <div style="position:absolute;left:160px;top:240px;width:960px;">
    ${kicker ? `<p data-ir style="margin:0 0 16px;font-family:var(--font-mono);font-size:120px;line-height:1;font-weight:700;color:#ffffff;">${esc(kicker)}</p>` : ''}
    <h2 data-ir style="margin:0;font-family:var(--font-display);font-size:56px;font-weight:700;color:#ffffff;">${esc(title)}</h2>
    ${note ? `<p data-ir style="margin:24px 0 0;font-size:24px;color:#ffffff;">${esc(note)}</p>` : ''}
  </div>
</div>`.trim()
  }
}
