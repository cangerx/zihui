import type { SlideTemplate, SlideData, ThemeTokens } from '../types'
import { esc, asString } from '../util'

// 图文分栏：左文(标题+正文) 右图(占位/真实图片用 <img>, 不用 div 背景图)。
export const twoColumnTemplate: SlideTemplate = {
  id: 'two-column',
  name: '图文分栏',
  category: 'content',
  description: '左文右图：左侧标题+段落，右侧配图(图片走 <img> 占位)。',
  schema: {
    title: { type: 'text', label: '标题', required: true, maxChars: 26 },
    body: { type: 'multiline', label: '正文', maxChars: 220 },
    image: { type: 'image', label: '配图(路径或留空占位)' }
  },
  defaultData: {
    title: '渲染端负责好看',
    body: '排版、层级、留白、纯色配色、巨型数字——这些 huashu 方法论产出的“好看”，恰恰都是导出端能忠实保真的部分。真正会丢的渐变与光影，在模板设计阶段就改纯色或预栅格化 PNG。',
    image: ''
  },
  render(data: SlideData, _theme: ThemeTokens): string {
    const title = asString(data, 'title')
    const body = asString(data, 'body')
    const image = asString(data, 'image')
    const imageBox = image
      ? `<img data-ir src="${esc(image)}" style="position:absolute;left:720px;top:96px;width:464px;height:528px;object-fit:cover;" />`
      : `<div class="placeholder" data-ir data-ir-placeholder style="position:absolute;left:720px;top:96px;width:464px;height:528px;background:var(--card);border:1px solid var(--rule);"></div>`
    return `
<div data-ir-root style="position:relative;width:1280px;height:720px;background:var(--bg);color:var(--fg);font-family:var(--font-body);overflow:hidden;">
  <div style="position:absolute;left:96px;top:120px;width:560px;">
    <h2 data-ir style="margin:0 0 28px;font-family:var(--font-display);font-size:40px;font-weight:700;color:var(--fg);">${esc(title)}</h2>
    <div data-pptx-merge style="max-width:540px;"><p data-ir style="margin:0;font-size:23px;line-height:1.6;color:var(--fg);">${esc(body)}</p></div>
  </div>
  ${imageBox}
</div>`.trim()
  }
}
