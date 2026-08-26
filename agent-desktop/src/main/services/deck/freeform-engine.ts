import type { ThemeTokens } from './types'
import type { DeckLlm } from './deck-generator'
import type { DeckPath } from './deck-grammar'
import { themeToCssVars } from './theme'
import { CANVAS_W, CANVAS_H } from './html-ir'
import { VISUAL_ANTI_SLOP, PUBLICATION_GRAMMAR, huashuMethodologyBlock } from './design-rules'

// 引擎2: AI 自由写 HTML(精品页/封面/创意页, 视觉上限高)。
// 设计子模型直接产出一页 1280×720 的 standalone HTML body, 受安全约束护栏限制。
// 与受控模板(引擎1)互补: 自由页视觉好但导 PPTX 时降级为整页图片(由导出层处理), 要可编辑用引擎1。

export interface FreeformInput {
  title: string
  intent: string
  theme: ThemeTokens
  /** 交付路径: pptx=守4约束+data-ir标记(可抽取为可编辑PPTX); visual=自由(默认) */
  path?: DeckPath
  /** grammar 注入文本(后续页复用已确立的设计语法, 见 deck-grammar.grammarPromptText) */
  grammarText?: string
  /** cinematic 动画(仅 visual 路径有效): 让 AI 写 window.__seek(t) → 逐帧导出视频 */
  animated?: boolean
}

export interface FreeformDeps {
  llm: DeckLlm
  signal?: AbortSignal
  /** 流式增量回调(可选): 接到生成中的 HTML 分块, 供实时预览 */
  onContent?: (piece: string) => void
}

export interface FreeformSlide {
  /** 完整 standalone HTML(1280×720, 含 __deckReady) */
  html: string
  warnings: string[]
}

// 自由 HTML 安全/合规约束(护栏): 写进生成提示, 并在产出后做基础清洗。
const SAFETY_RULES = `【硬性技术约束 — 必须遵守, 否则页面无法渲染/导出】
- 输出纯 HTML 片段(只给 <body> 内部内容, 不要 <html>/<head>/<body> 标签, 不要 markdown 代码围栏)。
- 画布固定 1280×720 px, 所有元素绝对定位在此范围内(position:absolute; 不溢出)。
- 图片只用 https:// 或 data: URL; 禁止相对路径、禁止 <iframe>、禁止 <link>/<script src> 外链。
- 可以用内联 <style> 和 <script>(动画), 但脚本不得访问网络/Node, 只做视觉。
- 配色用主题 CSS 变量: var(--bg)/var(--fg)/var(--muted)/var(--accent)/var(--card)/var(--rule), 字体 var(--font-display)/var(--font-body)。
- 文字必须放在 <p>/<h1>-<h6>/<span> 里(便于后续可能的导出抽取)。`

// 可编辑 PPTX 硬约束(path='pptx' 时叠加): 让自由 HTML 也能被 EXTRACT_SCRIPT 抽成可编辑元素。
const PPTX_RULES = `【可编辑 PPTX 硬约束 — 本页要导出为可编辑 PPTX, 必须严格遵守, 否则无法逐元素编辑】
- 根容器: <div data-ir-root style="position:absolute;inset:0;">…</div>, 整页内容放其中。
- 每个文字元素: 必须是 <p> 或 <h1>-<h6>, 且带 data-ir 属性(例: <h1 data-ir style="position:absolute;left:64px;top:60px;...">标题</h1>)。禁止用 div/span 承载主文字。
- 文字标签自身禁止 background/border/box-shadow; 这些只放在 <div data-ir> 上。
- 卡片/色块/分隔条/背景: 用 <div data-ir style="...background/border/border-radius/box-shadow...">。
- 图片: <img data-ir src="https://..."/>; 禁止 div 用 background-image。
- 禁止 CSS 渐变(linear/radial-gradient)、禁止 web component、禁止复杂装饰 SVG。
- 所有元素 position:absolute 定位在 1280×720 内, 不溢出。`

function buildSystem(path: DeckPath, grammarText: string, animated: boolean): string {
  const blocks = [
    '你是顶尖的演示视觉设计师, 为单页幻灯片当场设计高质量 HTML。审美对标获奖作品集, 强冲击、克制、专业。',
    huashuMethodologyBlock(animated), // huashu 方法论: 出版物骨架+视觉主角轮换+设计哲学(+animated 时含 cinematic 动画)
    PUBLICATION_GRAMMAR,
    VISUAL_ANTI_SLOP,
    SAFETY_RULES
  ]
  if (path === 'pptx') blocks.push(PPTX_RULES) // 动画只在 visual 路径; pptx 静态可编辑
  if (grammarText) blocks.push(grammarText) // grammar 贯穿: 后续页复用已确立的视觉语言
  return blocks.join('\n\n')
}

const FREEFORM_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['html'],
  properties: {
    html: { type: 'string', description: '该页 body 内部 HTML(绝对定位, 1280×720 内, 含可选内联 style/script)' }
  }
}

// 基础清洗: 剥 <html>/<head>/<body> 外壳, 去外链 script src / iframe / link, 防越界基本护栏。
function sanitize(raw: string): { html: string; warnings: string[] } {
  const warnings: string[] = []
  let h = String(raw || '').trim()
  // 剥 markdown 围栏
  const fence = h.match(/```(?:html)?\s*([\s\S]*?)```/i)
  if (fence && fence[1]) h = fence[1].trim()
  // 取 body 内部(若 LLM 给了完整文档)
  const bodyMatch = h.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  if (bodyMatch) h = bodyMatch[1]!.trim()
  // 去危险/无效标签
  if (/<iframe/i.test(h)) { h = h.replace(/<iframe[\s\S]*?<\/iframe>/gi, ''); warnings.push('已移除 iframe') }
  if (/<script[^>]*\bsrc=/i.test(h)) { h = h.replace(/<script[^>]*\bsrc=[^>]*>\s*<\/script>/gi, ''); warnings.push('已移除外链 script') }
  if (/<link/i.test(h)) { h = h.replace(/<link[^>]*>/gi, ''); warnings.push('已移除 link 外链') }
  return { html: h, warnings }
}

/** 用主题包成 standalone HTML(对齐 html-ir 的输出契约: 含 __deckReady + 主题变量 + 固定画布) */
function wrap(bodyHtml: string, theme: ThemeTokens): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>:root{ ${themeToCssVars(theme)} }
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{width:${CANVAS_W}px;height:${CANVAS_H}px;overflow:hidden;background:var(--bg);position:relative;
  -webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;font-family:var(--font-body);}
</style></head>
<body>
${bodyHtml}
<script>window.__deckReady = true;</script>
</body></html>`
}

/** 让设计子模型自由设计一页 → 清洗 → 包成 standalone HTML。LLM 失败回退一个合规占位页(不崩)。 */
export async function generateFreeformSlide(input: FreeformInput, deps: FreeformDeps): Promise<FreeformSlide> {
  const path: DeckPath = input.path ?? 'visual'
  // 动画仅 visual 路径有效(pptx 要静态可编辑)
  const system = buildSystem(path, input.grammarText ?? '', !!input.animated && path === 'visual')
  const user =
    `为这一页幻灯片设计高质量视觉:\n标题: ${input.title}\n意图/风格: ${input.intent}\n` +
    `主题色板已通过 CSS 变量提供。产出该页 body 内部 HTML。`
  try {
    let body = ''
    if (typeof deps.llm.generateText === 'function') {
      // 优先流式裸 HTML: 首字节秒级到达, 避开云端网关 524(长输出整段沉默会被判源站超时)。
      // sanitize 会剥代码围栏/抽 body, 故无需 JSON 包裹。
      body = await deps.llm.generateText({ system, user, signal: deps.signal, onContent: deps.onContent })
    } else {
      // 回退非流式 JSON(fake LLM 单测 / 不支持流式的适配器)
      const raw = (await deps.llm.generateJson({
        system,
        user,
        schema: FREEFORM_SCHEMA,
        signal: deps.signal
      })) as { html?: unknown }
      body = typeof raw.html === 'string' ? raw.html : ''
    }
    if (!body.trim()) throw new Error('空 HTML')
    const { html: clean, warnings } = sanitize(body)
    return { html: wrap(clean, input.theme), warnings }
  } catch (e) {
    // 兜底: 合规的简洁封面页(标题居中), 绝不产出空白/崩溃。pptx 路径带 data-ir 保证可抽取。
    const ir = path === 'pptx' ? ' data-ir' : ''
    const root = path === 'pptx' ? '<div data-ir-root style="position:absolute;inset:0;">' : ''
    const rootEnd = path === 'pptx' ? '</div>' : ''
    const fallback =
      root +
      `<h1${ir} style="position:absolute;left:80px;top:300px;width:1120px;margin:0;font-family:var(--font-display);` +
      `font-size:64px;font-weight:700;color:var(--fg);line-height:1.15;">${esc(input.title)}</h1>` +
      `<div${ir} style="position:absolute;left:80px;top:270px;width:80px;height:6px;background:var(--accent);"></div>` +
      rootEnd
    return { html: wrap(fallback, input.theme), warnings: ['自由设计失败, 用占位封面: ' + (e instanceof Error ? e.message : String(e))] }
  }
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
