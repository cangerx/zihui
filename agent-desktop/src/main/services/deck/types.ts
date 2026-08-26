// AI Deck 引擎核心类型 (参见 docs/deck-feature-spec.md §5.8)
// 受控模板 = 三件套(声明式 schema + 默认数据 + render), 模板是数据不是可执行代码。

/** 声明式字段类型 */
export type FieldType = 'text' | 'multiline' | 'list' | 'image' | 'stat-list' | 'enum'

/** 单个槽位字段定义(受控模板 schema 的一项) */
export interface FieldDef {
  type: FieldType
  label: string
  required?: boolean
  /** 文本类: 最大字符数(字数上限防溢出, 生成时截断) */
  maxChars?: number
  /** list/stat-list: 最大条目数 */
  maxItems?: number
  /** list 内每项文本最大字符 */
  itemMaxChars?: number
  /** enum 可选值 */
  enumValues?: string[]
  /** stat-list 每项 value/label 字符上限 */
  statValueMaxChars?: number
  statLabelMaxChars?: number
}

/** 一个模板的声明式 schema: 字段名 -> 定义 */
export type TemplateSchema = Record<string, FieldDef>

/** stat-list 单项 */
export interface StatItem {
  value: string
  label: string
}

/** 模板数据(槽位填充值) */
export type SlideValue = string | string[] | StatItem[]
export type SlideData = Record<string, SlideValue>

/** 主题 token */
export interface ThemeTokens {
  id: string
  name: string
  /** CSS 变量映射: 变量名(不含 --) -> 值 */
  vars: Record<string, string>
}

/** 受控模板定义(三件套) */
export interface SlideTemplate {
  id: string
  name: string
  category: string
  /** 适用场景描述(供 LLM 选型) */
  description: string
  schema: TemplateSchema
  defaultData: SlideData
  /** 渲染槽位数据为合规 slide HTML 片段(仅 body 内容, 不含 <html>) */
  render(data: SlideData, theme: ThemeTokens): string
}

/** 供云端 manifest / LLM 选型的模板元数据 */
export interface TemplateManifestEntry {
  id: string
  name: string
  category: string
  description: string
  schema: TemplateSchema
}

/** 文本 run(内联混排/多段合并的单元): 一段连续同样式文字, 可选样式覆盖 + 段末换行 */
export interface TextRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string // hex without '#'
  fontSizePx?: number
  fontFamily?: string
  /** run 末尾换行(合并文本框里每段结尾 breakLine) */
  breakLine?: boolean
}

/** 阴影(移植 huashu parseBoxShadow): 仅外阴影, PowerPoint 不支持 inset */
export interface ElementShadow {
  type: 'outer'
  /** 角度(度, 0=右 90=下) */
  angle: number
  /** 模糊(pt) */
  blur: number
  /** 颜色 hex without '#' */
  color: string
  /** 偏移(pt) */
  offset: number
  /** 不透明度 0-1 */
  opacity: number
}

/** 从离屏 DOM 抽取的单个元素度量(喂给 pptx-exporter) */
export interface ExtractedElement {
  role: 'text' | 'shape' | 'image'
  /** 像素坐标(相对画布左上) */
  x: number
  y: number
  w: number
  h: number
  // text
  text?: string
  fontSizePx?: number
  fontFamily?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string // hex without '#'
  align?: 'left' | 'center' | 'right'
  lineSpacingPct?: number
  /** 内联混排/合并文本框: 多个 run(优先于 text; 有 runs 时 text 仅作降级) */
  runs?: TextRun[]
  /** 文本框内边距 pt [left,right,bottom,top](合并文本框承载容器 padding) */
  marginPt?: [number, number, number, number]
  // shape/text 背景与边框
  fill?: string // hex without '#'
  lineColor?: string
  lineWidthPt?: number
  radiusPx?: number
  /** 旋转角度(度, 0-359; 移植 huashu getRotation, 含 writing-mode 竖排) */
  rotation?: number
  /** 阴影(移植 huashu parseBoxShadow) */
  shadow?: ElementShadow
  // image
  imagePath?: string
}

/** 一页的抽取结果 */
export interface ExtractedSlide {
  widthPx: number
  heightPx: number
  /** 整页背景色 hex(无 '#'), 来自 [data-ir-root] 的 computed background */
  background?: string
  elements: ExtractedElement[]
}
