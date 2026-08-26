import type { SlideTemplate, SlideData, ThemeTokens, TemplateSchema } from './types'
import { esc, asString, asList, asStats } from './util'

// 声明式模板：用"块"结构数据描述一页(不含任意可执行 JS),
// 由本文件的固定渲染器映射成"4 约束合规"的 slide HTML。
// 这是云端按需下发模板的安全格式(数据非代码, 规避 RCE), 渲染逻辑写死在端上。

export type ColorToken = 'fg' | 'muted' | 'accent' | 'card' | 'card-fg' | 'on-accent'
export type FontToken = 'display' | 'body' | 'mono'

export interface Pos {
  x: number
  y: number
  w: number
  h?: number
}

export type DeclarativeBlock =
  | { kind: 'bar'; pos: Pos; color?: ColorToken }
  | { kind: 'rule'; pos: Pos; color?: ColorToken }
  | { kind: 'kicker'; field: string; pos: Pos; size: number; color?: ColorToken }
  | { kind: 'heading'; field: string; level: 1 | 2; pos: Pos; size: number; color?: ColorToken; font?: FontToken }
  | { kind: 'paragraph'; field: string; pos: Pos; size: number; color?: ColorToken; merge?: boolean }
  | { kind: 'list'; field: string; pos: Pos; itemSize: number; color?: ColorToken; gap?: number }
  | { kind: 'numberedList'; field: string; pos: Pos; itemSize: number; color?: ColorToken; gap?: number }
  | { kind: 'statGrid'; field: string; pos: Pos; valueSize: number; labelSize: number; cols?: number }
  // title+desc 卡片网格(复用 stat-list 数据: value=标题, label=描述)。presenton 最常见 idiom。
  | { kind: 'bulletCards'; field: string; pos: Pos; titleSize: number; descSize: number; cols?: number; rowH?: number }
  // 大字引用(复用 text 数据): 带前导引号, 用于 quote 类布局。
  | { kind: 'quote'; field: string; pos: Pos; size: number; color?: ColorToken; font?: FontToken }
  | { kind: 'image'; field: string; pos: Pos }

export interface DeclarativeTemplate {
  id: string
  name: string
  category: string
  description: string
  schema: TemplateSchema
  defaultData: SlideData
  /** 根背景 token(默认 bg) */
  background?: 'bg' | 'accent'
  blocks: DeclarativeBlock[]
}

function colorCss(c: ColorToken | undefined, fallback = 'fg'): string {
  if (c === 'on-accent') return '#ffffff'
  return `var(--${c ?? fallback})`
}
function fontCss(f: FontToken | undefined): string {
  return `var(--font-${f ?? 'body'})`
}
function posCss(p: Pos): string {
  const h = p.h !== undefined ? `height:${p.h}px;` : ''
  return `position:absolute;left:${p.x}px;top:${p.y}px;width:${p.w}px;${h}`
}

// 画布安全下界(留 8px 余量)。所有动态高度内容(网格/列表/长文本)必须收敛到此线以内, 防满字数填充溢出。
const SAFE_BOTTOM = 712

// 估算并收缩字号: 使 len 字符文本(CJK 最宽, 按字号近似字宽)在 availH 高内不溢出。仅在会溢出时收缩。
function fitFontSize(len: number, size: number, w: number, availH: number, lineHeight: number, minSize = 13): number {
  let s = size
  let guard = 0
  while (s > minSize && guard++ < 80) {
    const charsPerLine = Math.max(1, Math.floor(w / s))
    const lines = Math.max(1, Math.ceil(len / charsPerLine))
    if (lines * s * lineHeight <= availH) break
    s -= 1
  }
  return Math.max(minSize, s)
}

function renderBlock(b: DeclarativeBlock, data: SlideData, onAccent: boolean): string {
  const txtColor = (c?: ColorToken): string => colorCss(c, onAccent ? 'on-accent' : 'fg')
  switch (b.kind) {
    case 'bar':
      return `<div data-ir style="${posCss({ ...b.pos, h: b.pos.h ?? 6 })}background:${colorCss(b.color, 'accent')};"></div>`
    case 'rule':
      return `<div data-ir style="${posCss({ ...b.pos, h: b.pos.h ?? 1 })}background:${colorCss(b.color, 'rule' as ColorToken)};"></div>`
    case 'kicker': {
      const t = asString(data, b.field)
      if (!t) return ''
      return `<p data-ir style="${posCss(b.pos)}margin:0;font-family:var(--font-mono);font-size:${b.size}px;letter-spacing:3px;color:${txtColor(b.color ?? 'accent')};max-height:${SAFE_BOTTOM - b.pos.y}px;overflow:hidden;">${esc(t.toUpperCase())}</p>`
    }
    case 'heading': {
      const t = asString(data, b.field)
      const tag = b.level === 1 ? 'h1' : 'h2'
      const size = fitFontSize(t.length, b.size, b.pos.w, SAFE_BOTTOM - b.pos.y, 1.14, 20)
      return `<${tag} data-ir style="${posCss(b.pos)}margin:0;font-family:${fontCss(b.font ?? 'display')};font-size:${size}px;line-height:1.14;font-weight:700;color:${txtColor(b.color)};max-height:${SAFE_BOTTOM - b.pos.y}px;overflow:hidden;">${esc(t)}</${tag}>`
    }
    case 'paragraph': {
      const t = asString(data, b.field)
      if (!t) return ''
      const availH = SAFE_BOTTOM - b.pos.y
      const size = fitFontSize(t.length, b.size, b.pos.w, availH, 1.5, 13)
      const inner = `<p data-ir style="margin:0;font-size:${size}px;line-height:1.5;color:${txtColor(b.color ?? 'muted')};max-height:${availH}px;overflow:hidden;">${esc(t)}</p>`
      return b.merge
        ? `<div data-pptx-merge style="${posCss(b.pos)}">${inner}</div>`
        : `<div style="${posCss(b.pos)}">${inner}</div>`
    }
    case 'list':
    case 'numberedList': {
      // 自适应: 行高 = min(自然行高, 盒高/条数), 盒高封顶到画布内 → 任意条数都不溢出。
      const numbered = b.kind === 'numberedList'
      const items = asList(data, b.field)
      const n = Math.max(items.length, 1)
      const avail = SAFE_BOTTOM - b.pos.y
      const boxH = Math.min(b.pos.h ?? avail, avail)
      const gap = b.gap ?? 14
      const natural = Math.round(b.itemSize * 1.45) + gap * 2
      const rowH = Math.max(1, Math.min(natural, Math.floor(boxH / n)))
      const size = Math.min(b.itemSize, Math.max(12, Math.floor(rowH / 1.5)))
      return items
        .map((it, i) => {
          const top = b.pos.y + i * rowH
          const marker = numbered
            ? `<p data-ir style="margin:0;font-family:var(--font-mono);font-size:${Math.round(size * 1.1)}px;font-weight:700;color:var(--accent);flex:0 0 auto;width:42px;max-height:${rowH}px;overflow:hidden;">${String(i + 1).padStart(2, '0')}</p>`
            : `<div data-ir style="width:28px;height:3px;margin-top:${Math.round(size * 0.6)}px;background:var(--accent);flex:0 0 auto;"></div>`
          return (
            `<div style="position:absolute;left:${b.pos.x}px;top:${top}px;width:${b.pos.w}px;height:${rowH}px;overflow:hidden;display:flex;align-items:flex-start;gap:20px;">` +
            marker +
            `<p data-ir style="margin:0;font-size:${size}px;line-height:1.4;color:${txtColor(b.color)};max-height:${rowH}px;overflow:hidden;flex:1;">${esc(it)}</p></div>`
          )
        })
        .join('')
    }
    case 'statGrid': {
      const stats = asStats(data, b.field)
      const n = Math.max(stats.length, 1)
      const cols = b.cols ?? n
      const gap = 32
      const rows = Math.ceil(n / cols)
      const avail = SAFE_BOTTOM - b.pos.y
      const cardW = Math.floor((b.pos.w - gap * (cols - 1)) / cols)
      // per-card 高保留模板语义(h 视作单卡高), 但封顶到"按行等分可用高", 仅在会溢出时缩小。
      const fitPer = Math.floor((avail - gap * (rows - 1)) / rows)
      const cardH = Math.max(1, Math.min(b.pos.h ?? 240, fitPer))
      const vSize = Math.min(b.valueSize, Math.max(20, Math.floor(cardH * 0.5)))
      const lSize = Math.min(b.labelSize, Math.max(11, Math.floor(cardH * 0.18)))
      // 内部元素 top/高度钳制在卡内(cardH 被压小时, 固定偏移不得跑出卡片下沿 → 防绝对定位元素越界)
      const vTop = Math.min(36, Math.max(6, cardH - 22))
      const lTop = Math.min(vTop + vSize + 16, Math.max(vTop + 10, cardH - 12))
      const vMaxH = Math.max(6, Math.min(vSize + 10, cardH - vTop - 4))
      const labelH = Math.max(6, cardH - lTop - 8)
      return stats
        .map((s, i) => {
          const left = b.pos.x + (i % cols) * (cardW + gap)
          const top = b.pos.y + Math.floor(i / cols) * (cardH + gap)
          return (
            `<div data-ir style="position:absolute;left:${left}px;top:${top}px;width:${cardW}px;height:${cardH}px;background:var(--card);border:1px solid var(--rule);overflow:hidden;">` +
            `<p data-ir style="margin:0;position:absolute;left:32px;top:${vTop}px;width:${cardW - 64}px;max-height:${vMaxH}px;overflow:hidden;font-family:var(--font-display);font-size:${vSize}px;font-weight:700;color:var(--accent);">${esc(s.value)}</p>` +
            `<p data-ir style="margin:0;position:absolute;left:32px;top:${lTop}px;width:${cardW - 64}px;max-height:${labelH}px;overflow:hidden;font-size:${lSize}px;line-height:1.4;color:var(--card-fg);">${esc(s.label)}</p></div>`
          )
        })
        .join('')
    }
    case 'bulletCards': {
      const stats = asStats(data, b.field)
      const n = Math.max(stats.length, 1)
      const cols = b.cols ?? Math.min(n, 2)
      const gap = 28
      const rows = Math.ceil(n / cols)
      const avail = SAFE_BOTTOM - b.pos.y
      const cardW = Math.floor((b.pos.w - gap * (cols - 1)) / cols)
      const declared = b.rowH ?? (b.pos.h ? Math.floor((b.pos.h - gap * (rows - 1)) / rows) : 150)
      const fitPer = Math.floor((avail - gap * (rows - 1)) / rows)
      const cardH = Math.max(1, Math.min(declared, fitPer))
      const tSize = Math.min(b.titleSize, Math.max(15, Math.floor(cardH * 0.3)))
      const dSize = Math.min(b.descSize, Math.max(11, Math.floor(cardH * 0.16)))
      // 内部元素钳制在卡内(同 statGrid): 防 cardH 压小时固定偏移使绝对定位文本跑出卡片下沿。
      const tTop = Math.min(26, Math.max(6, cardH - 20))
      const dTop = Math.min(tTop + tSize + 12, Math.max(tTop + 10, cardH - 12))
      const tMaxH = Math.max(6, Math.min(tSize + 10, cardH - tTop - 4))
      const descH = Math.max(6, cardH - dTop - 8)
      return stats
        .map((s, i) => {
          const left = b.pos.x + (i % cols) * (cardW + gap)
          const top = b.pos.y + Math.floor(i / cols) * (cardH + gap)
          return (
            `<div data-ir style="position:absolute;left:${left}px;top:${top}px;width:${cardW}px;height:${cardH}px;background:var(--card);border:1px solid var(--rule);overflow:hidden;">` +
            `<div data-ir style="position:absolute;left:0;top:0;width:4px;height:${cardH}px;background:var(--accent);"></div>` +
            `<p data-ir style="margin:0;position:absolute;left:28px;top:${tTop}px;width:${cardW - 56}px;max-height:${tMaxH}px;overflow:hidden;font-family:var(--font-display);font-size:${tSize}px;font-weight:700;color:var(--card-fg);">${esc(s.value)}</p>` +
            `<p data-ir style="margin:0;position:absolute;left:28px;top:${dTop}px;width:${cardW - 56}px;max-height:${descH}px;overflow:hidden;font-size:${dSize}px;line-height:1.4;color:var(--muted);">${esc(s.label)}</p></div>`
          )
        })
        .join('')
    }
    case 'quote': {
      const t = asString(data, b.field)
      if (!t) return ''
      const availH = SAFE_BOTTOM - b.pos.y
      const size = fitFontSize(t.length + 2, b.size, b.pos.w, availH, 1.3, 18)
      return (
        `<div style="${posCss(b.pos)}">` +
        `<p data-ir style="margin:0;font-family:${fontCss(b.font ?? 'display')};font-size:${size}px;line-height:1.3;font-weight:600;color:${txtColor(b.color)};max-height:${availH}px;overflow:hidden;">` +
        `“${esc(t)}”</p></div>`
      )
    }
    case 'image': {
      const src = asString(data, b.field)
      if (src.startsWith('data:')) {
        // 语义图标填充(generator 注入): 卡片底 + 居中 contain 图标(不拉伸)。
        const h = b.pos.h ?? 200
        const sz = Math.round(Math.min(b.pos.w, h) * 0.42)
        const cx = Math.round(b.pos.x + (b.pos.w - sz) / 2)
        const cy = Math.round(b.pos.y + (h - sz) / 2)
        return (
          `<div data-ir style="${posCss(b.pos)}background:var(--card);border:1px solid var(--rule);"></div>` +
          `<img data-ir src="${esc(src)}" style="position:absolute;left:${cx}px;top:${cy}px;width:${sz}px;height:${sz}px;object-fit:contain;" />`
        )
      }
      return src
        ? `<img data-ir src="${esc(src)}" style="${posCss(b.pos)}object-fit:cover;" />`
        : `<div class="placeholder" data-ir data-ir-placeholder style="${posCss(b.pos)}background:var(--card);border:1px solid var(--rule);"></div>`
    }
    default:
      return ''
  }
}

/** 声明式模板 + 数据 + 主题 → 合规 slide HTML 片段(仅 body 内容) */
export function renderDeclarative(tpl: DeclarativeTemplate, data: SlideData, _theme: ThemeTokens): string {
  const onAccent = tpl.background === 'accent'
  const rootBg = onAccent ? 'var(--accent)' : 'var(--bg)'
  const rootFg = onAccent ? '#ffffff' : 'var(--fg)'
  const body = tpl.blocks.map((b) => renderBlock(b, data, onAccent)).join('\n  ')
  return (
    `<div data-ir-root style="position:relative;width:1280px;height:720px;background:${rootBg};color:${rootFg};font-family:var(--font-body);overflow:hidden;">\n  ` +
    body +
    `\n</div>`
  )
}

/** 把声明式模板包装成 SlideTemplate, 即可插入 registry / deck-generator */
export function toSlideTemplate(decl: DeclarativeTemplate): SlideTemplate {
  return {
    id: decl.id,
    name: decl.name,
    category: decl.category,
    description: decl.description,
    schema: decl.schema,
    defaultData: decl.defaultData,
    render: (data, theme) => renderDeclarative(decl, data, theme)
  }
}
