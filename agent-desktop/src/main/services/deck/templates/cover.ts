import type { SlideTemplate, SlideData, ThemeTokens } from '../types'
import { esc, asString } from '../util'

// 封面：眉标 + 大标题 + 副标题 + 署名。左侧赤陶色竖线。
export const coverTemplate: SlideTemplate = {
  id: 'cover',
  name: '封面',
  category: 'opening',
  description: '演示文稿首页：大标题 + 副标题 + 署名/日期，适合开场。',
  schema: {
    kicker: { type: 'text', label: '眉标/分类', maxChars: 24 },
    title: { type: 'text', label: '主标题', required: true, maxChars: 48 },
    subtitle: { type: 'multiline', label: '副标题', maxChars: 90 },
    meta: { type: 'text', label: '署名/日期', maxChars: 40 }
  },
  defaultData: {
    kicker: '产品发布',
    title: '用一句话，拿回一份能交付的设计',
    subtitle: '把资深设计师的工作方法，沉淀成可复用的受控模板。',
    meta: '花叔 · 2026'
  },
  render(data: SlideData, _theme: ThemeTokens): string {
    const kicker = asString(data, 'kicker')
    const title = asString(data, 'title')
    const subtitle = asString(data, 'subtitle')
    const meta = asString(data, 'meta')
    return `
<div data-ir-root style="position:relative;width:1280px;height:720px;background:var(--bg);color:var(--fg);font-family:var(--font-body);overflow:hidden;">
  <div data-ir style="position:absolute;left:96px;top:0;width:6px;height:720px;background:var(--accent);"></div>
  <div style="position:absolute;left:160px;top:208px;width:1000px;">
    ${kicker ? `<p data-ir style="margin:0 0 28px;font-family:var(--font-mono);font-size:18px;letter-spacing:3px;color:var(--accent);">${esc(kicker.toUpperCase())}</p>` : ''}
    <h1 data-ir style="margin:0;font-family:var(--font-display);font-size:64px;line-height:1.12;font-weight:700;color:var(--fg);">${esc(title)}</h1>
    ${subtitle ? `<div data-pptx-merge style="margin-top:32px;max-width:860px;"><p data-ir style="margin:0;font-size:24px;line-height:1.5;color:var(--muted);">${esc(subtitle)}</p></div>` : ''}
  </div>
  ${meta ? `<p data-ir style="position:absolute;left:160px;top:600px;margin:0;font-size:18px;color:var(--muted);">${esc(meta)}</p>` : ''}
</div>`.trim()
  }
}
