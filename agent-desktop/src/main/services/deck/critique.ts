import type { ExtractedSlide, ExtractedElement } from './types'

// 设计评审(能力10): 离屏截图 + 布局度量 → 多模态 LLM 5 维评分 → 写 deck_slides.review。
// 客观度量(对齐/留白/层级/越界)由本模块从抽取元素算出, 喂给 LLM 作硬证据, 防止"凭感觉打分";
// 主观维度(配色协调/整体专业度)由多模态 LLM 看真实截图判断。LLM 经 DI(CritiqueLlm), 可 fake 单测。

const CANVAS_W = 1280
const CANVAS_H = 720
const SAFE_BOTTOM = 712

/** 多模态评审 LLM(依赖注入): 传 system/user + 截图 dataURL, 出 5 维评分 JSON */
export interface CritiqueLlm {
  reviewImage(args: {
    system: string
    user: string
    imageDataUrl: string
    schema: Record<string, unknown>
    signal?: AbortSignal
  }): Promise<unknown>
}

/** 单页客观度量(0-100 越高越好的子项 + 原始观测) */
export interface SlideMetrics {
  /** 元素是否越出画布安全区(下沿/右沿) */
  overflowCount: number
  /** 留白占比(0-1, 元素 bbox 并集外的面积比) */
  whitespaceRatio: number
  /** 左对齐边聚类数(越少越整齐) */
  alignEdges: number
  /** 字号层级数(不同字号档位数, 2-4 较佳) */
  fontLevels: number
  /** 文本元素数 */
  textCount: number
  /** 最小正文字号(px, 过小=可读性差) */
  minFontPx: number
}

export interface SlideReview {
  /** 8 维评分(0-100): 客观项(layout/hierarchy/whitespace 确定性算) + 主观项(LLM 看截图评) */
  scores: {
    layout: number // 布局/对齐(客观)
    hierarchy: number // 信息层级(客观)
    whitespace: number // 留白/呼吸感(客观)
    color: number // 配色协调(主观)
    philosophy: number // 哲学一致性: 风格统一、不混搭(主观, 对齐 huashu critique-guide)
    craft: number // 细节执行: 间距/对齐/字体统一度(主观)
    functionality: number // 功能性: 每个元素都 earn its place, 无冗余(主观)
    originality: number // 创新性/去AI味: 无 AI-slop cliché(主观)
    overall: number // 整体专业度(主观)
  }
  /** 综合分(加权) */
  total: number
  /** 客观度量(供 UI 展示证据) */
  metrics: SlideMetrics
  /** 改进建议(2-4 条, 可执行) */
  suggestions: string[]
}

// ---------------- 客观度量计算(纯函数, 从抽取元素算) ----------------

function round(n: number, d = 0): number {
  const p = Math.pow(10, d)
  return Math.round(n * p) / p
}

/** 计算单页客观度量 */
export function computeMetrics(slide: ExtractedSlide): SlideMetrics {
  const els = slide.elements ?? []
  const texts = els.filter((e) => e.role === 'text')
  // 越界: 元素下沿超 SAFE_BOTTOM 或右沿超画布宽
  let overflowCount = 0
  for (const e of els) {
    if (e.y + e.h > SAFE_BOTTOM + 1 || e.x + e.w > CANVAS_W + 1 || e.x < -1 || e.y < -1) overflowCount++
  }
  // 留白: 1 - 元素 bbox 面积并集近似(用网格采样, 避免精确并集开销)
  const GRID = 40
  const cellW = CANVAS_W / GRID
  const cellH = CANVAS_H / GRID
  let covered = 0
  for (let gx = 0; gx < GRID; gx++) {
    for (let gy = 0; gy < GRID; gy++) {
      const cx = gx * cellW + cellW / 2
      const cy = gy * cellH + cellH / 2
      if (els.some((e) => cx >= e.x && cx <= e.x + e.w && cy >= e.y && cy <= e.y + e.h)) covered++
    }
  }
  const whitespaceRatio = round(1 - covered / (GRID * GRID), 3)
  // 对齐: 左边缘聚类(8px 容差)
  const lefts = els.map((e) => Math.round(e.x))
  const clusters: number[] = []
  for (const l of lefts.sort((a, b) => a - b)) {
    if (!clusters.length || l - clusters[clusters.length - 1]! > 8) clusters.push(l)
  }
  // 字号层级
  const fonts = Array.from(new Set(texts.map((e) => Math.round(e.fontSizePx ?? 0)).filter((f) => f > 0)))
  const minFontPx = fonts.length ? Math.min(...fonts) : 0
  return {
    overflowCount,
    whitespaceRatio,
    alignEdges: clusters.length,
    fontLevels: fonts.length,
    textCount: texts.length,
    minFontPx
  }
}

/** 把客观度量映射为 0-100 子分(布局/层级/留白) — 确定性, 不靠 LLM */
function metricScores(m: SlideMetrics): { layout: number; hierarchy: number; whitespace: number } {
  // 布局: 越界扣分 + 对齐边过多扣分(理想 2-4 条对齐边)
  let layout = 100
  layout -= m.overflowCount * 18
  if (m.alignEdges > 5) layout -= (m.alignEdges - 5) * 6
  layout = clamp(layout)
  // 层级: 理想 2-4 档字号; 过少(扁平)或过多(杂乱)都扣; 正文过小扣
  let hierarchy = 100
  if (m.fontLevels <= 1) hierarchy -= 35
  else if (m.fontLevels >= 6) hierarchy -= (m.fontLevels - 5) * 10
  if (m.minFontPx > 0 && m.minFontPx < 14) hierarchy -= 20
  hierarchy = clamp(hierarchy)
  // 留白: 理想 0.35-0.6; 过满(<0.2)或过空(>0.8)都扣
  let whitespace = 100
  const w = m.whitespaceRatio
  if (w < 0.2) whitespace -= (0.2 - w) * 300
  else if (w > 0.75) whitespace -= (w - 0.75) * 300
  whitespace = clamp(whitespace)
  return { layout: round(layout), hierarchy: round(hierarchy), whitespace: round(whitespace) }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n))
}

/** 评审输出 JSON Schema(LLM 评主观维: 配色/哲学一致/细节/功能性/创新性/整体 + 给建议; 客观项由度量算) */
export const CRITIQUE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['color', 'philosophy', 'craft', 'functionality', 'originality', 'overall', 'suggestions'],
  properties: {
    color: { type: 'integer', minimum: 0, maximum: 100, description: '配色协调度(0-100)' },
    philosophy: { type: 'integer', minimum: 0, maximum: 100, description: '哲学一致性: 风格统一不混搭、贴合主题气质(0-100)' },
    craft: { type: 'integer', minimum: 0, maximum: 100, description: '细节执行: 间距/对齐/字体统一度、做工精细(0-100)' },
    functionality: { type: 'integer', minimum: 0, maximum: 100, description: '功能性: 每个元素都有存在理由、无冗余装饰(0-100)' },
    originality: { type: 'integer', minimum: 0, maximum: 100, description: '创新性/去AI味: 无渐变/圆角卡套路/emoji图标/SVG插画等AI-slop陈词(0-100)' },
    overall: { type: 'integer', minimum: 0, maximum: 100, description: '整体专业度(0-100)' },
    suggestions: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: { type: 'string', maxLength: 80 },
      description: '可执行改进建议(2-4 条)'
    }
  }
}

/**
 * 评审一页: 客观度量(确定性 layout/hierarchy/whitespace) + 多模态 LLM 主观评分(配色/哲学/细节/功能/创新/整体)合成 8 维。
 * LLM 失败时仅缺主观项, 用客观项均值兜底(绝不整页失败)。对齐 huashu critique-guide 的多维评审。
 */
export async function critiqueSlide(
  slide: ExtractedSlide,
  imageDataUrl: string,
  llm: CritiqueLlm,
  ctx: { title?: string; signal?: AbortSignal } = {}
): Promise<SlideReview> {
  const metrics = computeMetrics(slide)
  const obj = metricScores(metrics)

  const base = round((obj.layout + obj.hierarchy + obj.whitespace) / 3)
  let color = base
  let philosophy = base
  let craft = base
  let functionality = base
  let originality = base
  let overall = base
  let suggestions: string[] = []
  try {
    const system =
      '你是资深演示设计评审, 标准对标出版物与获奖作品集。看这张幻灯片截图, 按以下维度严格评分: ' +
      '配色协调、哲学一致性(风格是否统一不混搭)、细节执行(间距/对齐/字体统一)、功能性(每个元素是否都有存在理由、有无冗余装饰)、' +
      '创新性/去AI味(有没有渐变/圆角卡+左border/emoji图标/SVG画人物 这类 AI 陈词)、整体专业度。' +
      '客观度量(对齐/层级/留白)已给出。建议要具体(指出哪个元素怎么改), 不空泛。'
    const user =
      `页标题: ${ctx.title ?? '(无)'}\n` +
      `客观度量: 越界元素 ${metrics.overflowCount} 个, 留白率 ${metrics.whitespaceRatio}, ` +
      `对齐边 ${metrics.alignEdges} 条, 字号层级 ${metrics.fontLevels} 档, 最小正文 ${metrics.minFontPx}px。\n` +
      '据截图逐维评分并给改进建议。'
    const raw = (await llm.reviewImage({
      system,
      user,
      imageDataUrl,
      schema: CRITIQUE_SCHEMA,
      signal: ctx.signal
    })) as Record<string, unknown>
    if (typeof raw?.color === 'number') color = clamp(raw.color)
    if (typeof raw?.philosophy === 'number') philosophy = clamp(raw.philosophy)
    if (typeof raw?.craft === 'number') craft = clamp(raw.craft)
    if (typeof raw?.functionality === 'number') functionality = clamp(raw.functionality)
    if (typeof raw?.originality === 'number') originality = clamp(raw.originality)
    if (typeof raw?.overall === 'number') overall = clamp(raw.overall)
    if (Array.isArray(raw?.suggestions)) {
      suggestions = (raw.suggestions as unknown[]).filter((s) => typeof s === 'string').map(String).slice(0, 4)
    }
  } catch {
    suggestions = []
  }

  // 客观项 + 主观项合成建议(无 LLM 建议时, 用度量生成兜底建议)
  if (suggestions.length === 0) suggestions = fallbackSuggestions(metrics)

  const scores = {
    layout: obj.layout, hierarchy: obj.hierarchy, whitespace: obj.whitespace,
    color, philosophy, craft, functionality, originality, overall
  }
  // 加权: 客观 3 项各 0.15(=0.45), 主观 6 项分摊 0.55(color/philosophy/craft/functionality/originality 各 0.08, overall 0.15)
  const total = round(
    scores.layout * 0.15 + scores.hierarchy * 0.15 + scores.whitespace * 0.15 +
    scores.color * 0.08 + scores.philosophy * 0.08 + scores.craft * 0.08 +
    scores.functionality * 0.08 + scores.originality * 0.08 + scores.overall * 0.15
  )
  return { scores, total, metrics, suggestions }
}

/** 无 LLM 时按客观度量给确定性建议 */
function fallbackSuggestions(m: SlideMetrics): string[] {
  const out: string[] = []
  if (m.overflowCount > 0) out.push(`有 ${m.overflowCount} 个元素越出画布安全区, 应缩小内容或换版式`)
  if (m.minFontPx > 0 && m.minFontPx < 14) out.push(`最小正文字号 ${m.minFontPx}px 偏小, 建议不小于 14px`)
  if (m.alignEdges > 5) out.push(`左对齐边有 ${m.alignEdges} 条, 过多, 应归并到 2-3 条主对齐线`)
  if (m.whitespaceRatio < 0.2) out.push('内容过满、留白不足, 应删减元素或加大间距')
  if (m.whitespaceRatio > 0.75) out.push('留白过多、页面偏空, 可放大主体或补充内容')
  if (m.fontLevels <= 1) out.push('字号层级单一, 缺乏信息主次, 应拉开标题与正文字号差')
  if (out.length === 0) out.push('整体规整, 可继续打磨配色与视觉重心')
  return out.slice(0, 4)
}

/** 整套 deck 评审汇总 */
export interface DeckReview {
  slides: Array<{ index: number; title: string; review: SlideReview }>
  /** 全 deck 平均分 */
  average: number
}

export function summarizeDeck(items: Array<{ index: number; title: string; review: SlideReview }>): DeckReview {
  const average = items.length
    ? round(items.reduce((s, x) => s + x.review.total, 0) / items.length)
    : 0
  return { slides: items, average }
}

// 仅用于类型导出, 防 ExtractedElement 未使用告警(computeMetrics 内部用其结构)
export type { ExtractedElement }
