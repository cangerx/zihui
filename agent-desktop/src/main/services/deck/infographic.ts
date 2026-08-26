import type { ThemeTokens } from './types'

// 信息图(能力8): LLM 出结构化数据 → 数据驱动 SVG 图表 → @resvg 栅格化 PNG dataURL。
// 产出作为 image 槽位填入声明式模板(走 declarative image 块 object-fit:cover), 与 html2pptx 约束兼容
// (图表是预栅格 PNG, 非内联 SVG/web component, 无 CSS 渐变)。纯逻辑可单测; 仅 toPng 延迟 require @resvg。

export type ChartKind =
  | 'bar'
  | 'line'
  | 'pie'
  | 'progress'
  | 'stacked-bar' // 堆叠柱(多系列)
  | 'area' // 面积图
  | 'scatter' // 散点图
  | 'donut' // 甜甜圈
  | 'gauge' // 仪表盘(单值占比)

/** 单个数据点(label + 数值; 可选预格式化显示值, 如 "85%"/"¥2.3亿"; series 用于多系列堆叠) */
export interface ChartPoint {
  label: string
  value: number
  display?: string
  /** 多系列(堆叠柱): 各系列名→值; 提供时 value 视作总和的回退 */
  series?: Record<string, number>
  /** 散点图第二维 */
  y?: number
}

/** LLM 产出的图表规格 */
export interface ChartSpec {
  kind: ChartKind
  /** 图表标题(可空) */
  title?: string
  points: ChartPoint[]
  /** 单位后缀(柱/折线 y 轴与数值标注用, 如 "%"/"万") */
  unit?: string
  /** 堆叠柱的系列名顺序(决定配色与图例) */
  seriesNames?: string[]
  /** 配色策略: 'mono' 同色系梯度(默认, 去AI味) | 'category' 分类色(多分类区分度高) */
  palette?: 'mono' | 'category'
}

/** 图表配色(从主题 token 解析) */
interface Palette {
  bg: string
  fg: string
  muted: string
  accent: string
  rule: string
  card: string
  fontBody: string
  fontDisplay: string
  /** 多分类配色(饼/多柱), 由 accent 派生的同色系梯度 */
  series: string[]
}

const CANVAS_W = 1280
const CANVAS_H = 720

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** #rrggbb → {r,g,b}(非法回退中性灰) */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 100, g: 116, b: 139 }
  const n = parseInt(m[1]!, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** 把基色向白(amt>0)或黑(amt<0)混合, 生成同色系梯度(用于多分类系列, 避免引入花哨彩色) */
function mix(hex: string, amt: number): string {
  const { r, g, b } = hexToRgb(hex)
  if (amt >= 0) return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt)
  const k = 1 + amt
  return rgbToHex(r * k, g * k, b * k)
}

// 分类色板(克制专业的多色相, 非高饱和撞色): 用于多分类区分(palette:'category')
const CATEGORY_COLORS = ['#2256d6', '#15803d', '#b45309', '#6d28d9', '#0e7490', '#be123c', '#4d7c0f', '#9333ea']

function paletteFromTheme(theme: ThemeTokens, mode: 'mono' | 'category' = 'mono'): Palette {
  const v = theme.vars
  const accent = v.accent ?? '#2256d6'
  // mono: 同色系梯度(默认, 去 AI 味); category: 分类色相(多分类区分)
  const series =
    mode === 'category'
      ? CATEGORY_COLORS.slice()
      : [accent, mix(accent, 0.18), mix(accent, 0.36), mix(accent, 0.52), mix(accent, -0.18), mix(accent, 0.68)]
  return {
    bg: v.bg ?? '#ffffff',
    fg: v.fg ?? '#111418',
    muted: v.muted ?? '#6a7280',
    accent,
    rule: v.rule ?? '#e6e8ec',
    card: v.card ?? '#f6f8fa',
    fontBody: v['font-body'] ?? 'sans-serif',
    fontDisplay: v['font-display'] ?? 'sans-serif',
    series
  }
}

/** 数值格式化: 优先 display, 否则去多余小数 + 加 unit */
function fmt(p: ChartPoint, unit: string): string {
  if (p.display) return p.display
  const n = p.value
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1)
  return unit ? `${s}${unit}` : s
}

function svgHeader(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">`
}

function titleEl(title: string | undefined, p: Palette): { svg: string; top: number } {
  if (!title || !title.trim()) return { svg: '', top: 56 }
  return {
    svg: `<text x="64" y="76" font-family="${esc(p.fontDisplay)}" font-size="38" font-weight="700" fill="${p.fg}">${esc(title)}</text>`,
    top: 130
  }
}

// ---------------- 各图表渲染(纯 SVG, 合规: 纯色 fill/stroke + <text>, 无渐变/滤镜) ----------------

function renderBar(spec: ChartSpec, p: Palette): string {
  const { svg: tEl, top } = titleEl(spec.title, p)
  const pts = spec.points.slice(0, 16)
  const unit = spec.unit ?? ''
  const left = 64
  const right = CANVAS_W - 64
  const bottom = CANVAS_H - 96
  const plotH = bottom - top
  const max = Math.max(...pts.map((d) => d.value), 1)
  const n = Math.max(pts.length, 1)
  const slot = (right - left) / n
  const barW = Math.min(slot * 0.56, 120)
  const body = pts
    .map((d, i) => {
      const h = Math.max(2, (d.value / max) * (plotH - 40))
      const cx = left + slot * i + slot / 2
      const x = cx - barW / 2
      const y = bottom - h
      const fill = p.series[i % p.series.length]!
      return (
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" />` +
        `<text x="${cx.toFixed(1)}" y="${(y - 14).toFixed(1)}" text-anchor="middle" font-family="${esc(p.fontDisplay)}" font-size="26" font-weight="700" fill="${p.fg}">${esc(fmt(d, unit))}</text>` +
        `<text x="${cx.toFixed(1)}" y="${(bottom + 34).toFixed(1)}" text-anchor="middle" font-family="${esc(p.fontBody)}" font-size="22" fill="${p.muted}">${esc(d.label)}</text>`
      )
    })
    .join('')
  const axis = `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="${p.rule}" stroke-width="2" />`
  return `${svgHeader()}<rect width="${CANVAS_W}" height="${CANVAS_H}" fill="${p.bg}" />${tEl}${axis}${body}</svg>`
}

function renderLine(spec: ChartSpec, p: Palette, fillArea = false): string {
  const { svg: tEl, top } = titleEl(spec.title, p)
  const pts = spec.points.slice(0, 24)
  const unit = spec.unit ?? ''
  const left = 80
  const right = CANVAS_W - 64
  const bottom = CANVAS_H - 96
  const plotH = bottom - top - 40
  const max = Math.max(...pts.map((d) => d.value), 1)
  const min = Math.min(...pts.map((d) => d.value), 0)
  const span = max - min || 1
  const n = Math.max(pts.length - 1, 1)
  const stepX = (right - left) / n
  const coords = pts.map((d, i) => {
    const x = left + stepX * i
    const y = top + 40 + (1 - (d.value - min) / span) * plotH
    return { x, y, d }
  })
  const poly = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
  const dots = coords
    .map(
      (c) =>
        `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="6" fill="${p.accent}" />` +
        `<text x="${c.x.toFixed(1)}" y="${(c.y - 18).toFixed(1)}" text-anchor="middle" font-family="${esc(p.fontDisplay)}" font-size="22" font-weight="700" fill="${p.fg}">${esc(fmt(c.d, unit))}</text>` +
        `<text x="${c.x.toFixed(1)}" y="${(bottom + 34).toFixed(1)}" text-anchor="middle" font-family="${esc(p.fontBody)}" font-size="22" fill="${p.muted}">${esc(c.d.label)}</text>`
    )
    .join('')
  const axis = `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="${p.rule}" stroke-width="2" />`
  const line = `<polyline points="${poly}" fill="none" stroke="${p.accent}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" />`
  // 面积图: 折线下方填充半透明同色(纯色 fill-opacity, 非渐变, 合规)
  const area = fillArea
    ? `<polygon points="${left.toFixed(1)},${bottom} ${poly} ${right.toFixed(1)},${bottom}" fill="${p.accent}" fill-opacity="0.15" />`
    : ''
  return `${svgHeader()}<rect width="${CANVAS_W}" height="${CANVAS_H}" fill="${p.bg}" />${tEl}${axis}${area}${line}${dots}</svg>`
}

// 散点图: x=索引或 label 序, y=value(或 point.y)
function renderScatter(spec: ChartSpec, p: Palette): string {
  const { svg: tEl, top } = titleEl(spec.title, p)
  const pts = spec.points.slice(0, 40)
  const left = 80, right = CANVAS_W - 64, bottom = CANVAS_H - 96
  const plotH = bottom - top - 40
  const ys = pts.map((d) => (typeof d.y === 'number' ? d.y : d.value))
  const max = Math.max(...ys, 1), min = Math.min(...ys, 0), span = max - min || 1
  const n = Math.max(pts.length - 1, 1)
  const dots = pts
    .map((d, i) => {
      const x = left + ((right - left) / n) * i
      const yv = typeof d.y === 'number' ? d.y : d.value
      const y = top + 40 + (1 - (yv - min) / span) * plotH
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8" fill="${p.series[i % p.series.length]!}" fill-opacity="0.85" />`
    })
    .join('')
  const axis = `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="${p.rule}" stroke-width="2" /><line x1="${left}" y1="${top + 40}" x2="${left}" y2="${bottom}" stroke="${p.rule}" stroke-width="2" />`
  return `${svgHeader()}<rect width="${CANVAS_W}" height="${CANVAS_H}" fill="${p.bg}" />${tEl}${axis}${dots}</svg>`
}

// 堆叠柱: 每个 label 一根柱, 内含多系列(point.series)堆叠
function renderStackedBar(spec: ChartSpec, p: Palette): string {
  const { svg: tEl, top } = titleEl(spec.title, p)
  const pts = spec.points.slice(0, 12)
  const names = spec.seriesNames && spec.seriesNames.length
    ? spec.seriesNames
    : Array.from(new Set(pts.flatMap((d) => Object.keys(d.series ?? {}))))
  const left = 80, right = CANVAS_W - 240, bottom = CANVAS_H - 96
  const plotH = bottom - top - 40
  const totals = pts.map((d) => names.reduce((s, nm) => s + Math.max(d.series?.[nm] ?? 0, 0), 0))
  const max = Math.max(...totals, 1)
  const n = Math.max(pts.length, 1)
  const slot = (right - left) / n
  const barW = Math.min(slot * 0.56, 110)
  const body = pts
    .map((d, i) => {
      const cx = left + slot * i + slot / 2
      const x = cx - barW / 2
      let yCursor = bottom
      const segs = names
        .map((nm, si) => {
          const val = Math.max(d.series?.[nm] ?? 0, 0)
          const segH = (val / max) * (plotH)
          yCursor -= segH
          return `<rect x="${x.toFixed(1)}" y="${yCursor.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, segH).toFixed(1)}" fill="${p.series[si % p.series.length]!}" />`
        })
        .join('')
      const lbl = `<text x="${cx.toFixed(1)}" y="${(bottom + 34).toFixed(1)}" text-anchor="middle" font-family="${esc(p.fontBody)}" font-size="22" fill="${p.muted}">${esc(d.label)}</text>`
      return segs + lbl
    })
    .join('')
  const legend = names
    .map((nm, si) => {
      const ly = top + 40 + si * 36
      return `<rect x="${right + 24}" y="${ly}" width="22" height="22" fill="${p.series[si % p.series.length]!}" /><text x="${right + 54}" y="${ly + 18}" font-family="${esc(p.fontBody)}" font-size="22" fill="${p.fg}">${esc(nm)}</text>`
    })
    .join('')
  const axis = `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="${p.rule}" stroke-width="2" />`
  return `${svgHeader()}<rect width="${CANVAS_W}" height="${CANVAS_H}" fill="${p.bg}" />${tEl}${axis}${body}${legend}</svg>`
}

// 仪表盘: 单值占比半环
function renderGauge(spec: ChartSpec, p: Palette): string {
  const { svg: tEl, top } = titleEl(spec.title, p)
  const d0 = spec.points[0]
  const pct = Math.max(0, Math.min(100, d0?.value ?? 0)) / 100
  const cx = CANVAS_W / 2, cy = top + (CANVAS_H - top) / 2 + 80, r = 220
  const a0 = Math.PI, a1 = Math.PI + Math.PI * pct
  const arc = (start: number, end: number, color: string, width: number): string => {
    const x0 = cx + r * Math.cos(start), y0 = cy + r * Math.sin(start)
    const x1 = cx + r * Math.cos(end), y1 = cy + r * Math.sin(end)
    const large = end - start > Math.PI ? 1 : 0
    return `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" />`
  }
  const track = arc(Math.PI, 2 * Math.PI, p.rule, 36)
  const value = arc(a0, a1, p.accent, 36)
  const big = `<text x="${cx}" y="${cy - 10}" text-anchor="middle" font-family="${esc(p.fontDisplay)}" font-size="80" font-weight="700" fill="${p.accent}">${esc(d0 ? fmt(d0, spec.unit ?? '%') : '0%')}</text>`
  const lbl = d0 ? `<text x="${cx}" y="${cy + 40}" text-anchor="middle" font-family="${esc(p.fontBody)}" font-size="28" fill="${p.muted}">${esc(d0.label)}</text>` : ''
  return `${svgHeader()}<rect width="${CANVAS_W}" height="${CANVAS_H}" fill="${p.bg}" />${tEl}${track}${value}${big}${lbl}</svg>`
}

function renderPie(spec: ChartSpec, p: Palette, donut = false): string {
  const { svg: tEl, top } = titleEl(spec.title, p)
  const pts = spec.points.slice(0, 8)
  const total = pts.reduce((s, d) => s + Math.max(d.value, 0), 0) || 1
  const cx = 430
  const cy = top + (CANVAS_H - top) / 2 - 10
  const r = Math.min(220, (CANVAS_H - top) / 2 - 40)
  let a0 = -Math.PI / 2
  const slices = pts
    .map((d, i) => {
      const frac = Math.max(d.value, 0) / total
      const a1 = a0 + frac * Math.PI * 2
      const x0 = cx + r * Math.cos(a0)
      const y0 = cy + r * Math.sin(a0)
      const x1 = cx + r * Math.cos(a1)
      const y1 = cy + r * Math.sin(a1)
      const large = a1 - a0 > Math.PI ? 1 : 0
      const fill = p.series[i % p.series.length]!
      a0 = a1
      // 整圆(单点)特判: 直接画整圆避免 path 退化
      if (frac >= 0.999) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" />`
      return `<path d="M${cx} ${cy} L${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z" fill="${fill}" />`
    })
    .join('')
  // 右侧图例
  const legendX = 760
  let ly = cy - pts.length * 26
  const legend = pts
    .map((d, i) => {
      const fill = p.series[i % p.series.length]!
      const pct = ((Math.max(d.value, 0) / total) * 100).toFixed(0)
      const row =
        `<rect x="${legendX}" y="${ly}" width="26" height="26" fill="${fill}" />` +
        `<text x="${legendX + 40}" y="${ly + 21}" font-family="${esc(p.fontBody)}" font-size="26" fill="${p.fg}">${esc(d.label)}　${pct}%</text>`
      ly += 52
      return row
    })
    .join('')
  // 甜甜圈: 中心挖空(同背景色圆覆盖) + 中心总数
  const hole = donut
    ? `<circle cx="${cx}" cy="${cy}" r="${(r * 0.58).toFixed(1)}" fill="${p.bg}" />` +
      `<text x="${cx}" y="${cy + 12}" text-anchor="middle" font-family="${esc(p.fontDisplay)}" font-size="44" font-weight="700" fill="${p.fg}">${pts.length}</text>`
    : ''
  return `${svgHeader()}<rect width="${CANVAS_W}" height="${CANVAS_H}" fill="${p.bg}" />${tEl}${slices}${hole}${legend}</svg>`
}

function renderProgress(spec: ChartSpec, p: Palette): string {
  const { svg: tEl, top } = titleEl(spec.title, p)
  const pts = spec.points.slice(0, 5)
  const left = 64
  const right = CANVAS_W - 280
  const trackW = right - left
  const n = Math.max(pts.length, 1)
  const avail = CANVAS_H - top - 64
  const rowH = Math.min(110, avail / n)
  const barH = Math.min(34, rowH * 0.4)
  const body = pts
    .map((d, i) => {
      const y = top + rowH * i + (rowH - barH) / 2
      // value 视作百分比(0-100); 超出钳制
      const pct = Math.max(0, Math.min(100, d.value)) / 100
      const fillW = Math.max(2, trackW * pct)
      const fill = p.series[i % p.series.length]!
      return (
        `<text x="${left}" y="${(y - 14).toFixed(1)}" font-family="${esc(p.fontBody)}" font-size="26" fill="${p.fg}">${esc(d.label)}</text>` +
        `<rect x="${left}" y="${y.toFixed(1)}" width="${trackW}" height="${barH}" rx="${barH / 2}" fill="${p.rule}" />` +
        `<rect x="${left}" y="${y.toFixed(1)}" width="${fillW.toFixed(1)}" height="${barH}" rx="${barH / 2}" fill="${fill}" />` +
        `<text x="${right + 24}" y="${(y + barH - 6).toFixed(1)}" font-family="${esc(p.fontDisplay)}" font-size="30" font-weight="700" fill="${p.accent}">${esc(fmt(d, spec.unit ?? ''))}</text>`
      )
    })
    .join('')
  return `${svgHeader()}<rect width="${CANVAS_W}" height="${CANVAS_H}" fill="${p.bg}" />${tEl}${body}</svg>`
}

/** 把图表规格渲染为合规 SVG 字符串(纯逻辑, 可单测) */
export function renderChartSvg(spec: ChartSpec, theme: ThemeTokens): string {
  // 多分类(饼/堆叠/散点)默认分类色, 其余默认同色系; 显式 palette 覆盖
  const defaultMode: 'mono' | 'category' =
    spec.kind === 'pie' || spec.kind === 'donut' || spec.kind === 'stacked-bar' ? 'category' : 'mono'
  const p = paletteFromTheme(theme, spec.palette ?? defaultMode)
  const pts = (spec.points ?? []).filter((d) => d && typeof d.value === 'number' && d.label != null)
  const safe: ChartSpec = { ...spec, points: pts }
  switch (spec.kind) {
    case 'line':
      return renderLine(safe, p)
    case 'area':
      return renderLine(safe, p, true)
    case 'scatter':
      return renderScatter(safe, p)
    case 'stacked-bar':
      return renderStackedBar(safe, p)
    case 'pie':
      return renderPie(safe, p)
    case 'donut':
      return renderPie(safe, p, true)
    case 'gauge':
      return renderGauge(safe, p)
    case 'progress':
      return renderProgress(safe, p)
    case 'bar':
    default:
      return renderBar(safe, p)
  }
}

/** SVG → PNG dataURL(@resvg 栅格化, 2x 清晰度)。延迟 require @resvg(原生包)。 */
export function renderChartPng(spec: ChartSpec, theme: ThemeTokens): string {
  const svg = renderChartSvg(spec, theme)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Resvg } = require('@resvg/resvg-js') as typeof import('@resvg/resvg-js')
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: CANVAS_W * 2 } })
  const png = Buffer.from(resvg.render().asPng())
  return 'data:image/png;base64,' + png.toString('base64')
}

/** LLM 产图表数据的 JSON Schema(填 image 槽位前先让 LLM 出 ChartSpec) */
export const CHART_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'points'],
  properties: {
    kind: { type: 'string', enum: ['bar', 'line', 'pie', 'progress', 'stacked-bar', 'area', 'scatter', 'donut', 'gauge'], description: '图表类型: bar柱/line折线/pie饼/progress进度/stacked-bar堆叠柱/area面积/scatter散点/donut甜甜圈/gauge仪表盘' },
    title: { type: 'string', maxLength: 30, description: '图表标题(可空)' },
    unit: { type: 'string', maxLength: 6, description: '数值单位后缀, 如 % 万 亿(可空)' },
    palette: { type: 'string', enum: ['mono', 'category'], description: '配色: mono同色系(默认,去AI味) | category分类色(多分类区分)' },
    seriesNames: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 12 }, description: '堆叠柱的系列名顺序(可空)' },
    points: {
      type: 'array',
      minItems: 1,
      maxItems: 16,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'value'],
        properties: {
          label: { type: 'string', maxLength: 12, description: '数据点名称' },
          value: { type: 'number', description: 'progress/gauge 类为 0-100 百分比; 其余为原始数值' },
          display: { type: 'string', maxLength: 10, description: '预格式化显示值(可空)' },
          y: { type: 'number', description: '散点图第二维(可空)' },
          series: { type: 'object', additionalProperties: { type: 'number' }, description: '堆叠柱各系列值(可空)' }
        }
      }
    }
  }
}

const ALL_KINDS: ChartKind[] = ['bar', 'line', 'pie', 'progress', 'stacked-bar', 'area', 'scatter', 'donut', 'gauge']

/** 把 LLM 原始返回宽松解析为合法 ChartSpec(非法回退柱状, 由调用方决定是否丢弃) */
export function coerceChartSpec(raw: unknown): ChartSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const kind: ChartKind = ALL_KINDS.includes(o.kind as ChartKind) ? (o.kind as ChartKind) : 'bar'
  const ptsRaw = Array.isArray(o.points) ? o.points : []
  const points: ChartPoint[] = []
  for (const x of ptsRaw) {
    const px = x as Record<string, unknown>
    const value = typeof px?.value === 'number' ? px.value : Number(px?.value)
    if (!Number.isFinite(value) || px?.label == null) continue
    const pt: ChartPoint = { label: String(px.label), value }
    if (typeof px.display === 'string') pt.display = px.display
    if (typeof px.y === 'number') pt.y = px.y
    if (px.series && typeof px.series === 'object') {
      const series: Record<string, number> = {}
      for (const [k, v] of Object.entries(px.series as Record<string, unknown>)) {
        const nv = typeof v === 'number' ? v : Number(v)
        if (Number.isFinite(nv)) series[k] = nv
      }
      if (Object.keys(series).length) pt.series = series
    }
    points.push(pt)
  }
  // gauge 允许 1 个点(单值占比), 其余需 ≥2
  const minPts = kind === 'gauge' ? 1 : 2
  if (points.length < minPts) return null
  // stacked-bar 必须每个点都有非空 series, 否则渲染出空白柱(降级回 bar 而非产空图)
  if (kind === 'stacked-bar' && !points.every((p) => p.series && Object.keys(p.series).length > 0)) {
    return { kind: 'bar', title: typeof o.title === 'string' ? o.title : undefined, unit: typeof o.unit === 'string' ? o.unit : undefined, points }
  }
  return {
    kind,
    title: typeof o.title === 'string' ? o.title : undefined,
    unit: typeof o.unit === 'string' ? o.unit : undefined,
    palette: o.palette === 'mono' || o.palette === 'category' ? o.palette : undefined,
    seriesNames: Array.isArray(o.seriesNames) ? o.seriesNames.filter((s) => typeof s === 'string').map(String) : undefined,
    points
  }
}
