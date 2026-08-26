import type { SlideTemplate, SlideData, ThemeTokens } from '../types'
import { esc, asString, asList } from '../util'

// 要点：标题 + 要点列表(每条赤陶色短横线引导，非 emoji/非花哨图标)。
export const bulletsTemplate: SlideTemplate = {
  id: 'bullets',
  name: '要点',
  category: 'content',
  description: '核心要点页：标题 + 3-5 条要点，每条一行短句。',
  schema: {
    title: { type: 'text', label: '标题', required: true, maxChars: 28 },
    lead: { type: 'multiline', label: '导语', maxChars: 80 },
    bullets: { type: 'list', label: '要点', maxItems: 5, itemMaxChars: 52 }
  },
  defaultData: {
    title: '受控模板为什么稳',
    lead: '元素位置与样式写死，LLM 只填槽位数据。',
    bullets: [
      'schema 定义槽位 + 字数上限，天然不溢出',
      '渲染 DOM 天生符合导出约束，近 100% 通过校验',
      '导出是确定性映射，不是逐元素猜语义',
      '好看由渲染端承载，导出端只忠实搬运'
    ]
  },
  render(data: SlideData, _theme: ThemeTokens): string {
    const title = asString(data, 'title')
    const lead = asString(data, 'lead')
    const bullets = asList(data, 'bullets')
    const rows = bullets
      .map(
        (b) => `
      <div data-ir-row style="display:flex;align-items:flex-start;gap:20px;padding:14px 0;">
        <div data-ir style="width:28px;height:3px;margin-top:18px;background:var(--accent);flex:0 0 auto;"></div>
        <p data-ir style="margin:0;font-size:26px;line-height:1.45;color:var(--fg);">${esc(b)}</p>
      </div>`
      )
      .join('')
    return `
<div data-ir-root style="position:relative;width:1280px;height:720px;background:var(--bg);color:var(--fg);font-family:var(--font-body);overflow:hidden;">
  <div style="position:absolute;left:160px;top:120px;width:960px;">
    <h2 data-ir style="margin:0;font-family:var(--font-display);font-size:44px;font-weight:700;color:var(--fg);">${esc(title)}</h2>
    ${lead ? `<div data-pptx-merge style="margin:20px 0 36px;max-width:900px;"><p data-ir style="margin:0;font-size:24px;line-height:1.5;color:var(--muted);">${esc(lead)}</p></div>` : '<div style="height:36px;"></div>'}
    <div>${rows}</div>
  </div>
</div>`.trim()
  }
}
