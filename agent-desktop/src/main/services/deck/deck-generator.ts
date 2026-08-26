import type { SlideData, ThemeTokens, TemplateManifestEntry } from './types'
import { builtinTemplateProvider, type TemplateProvider } from './template-provider'
import { validateAndClamp, toJsonSchema } from './schema-validate'
import { renderSlideHtml } from './html-ir'
import { themeById } from './theme'
import { familyTheme } from './families'
import { outlineSystemPrompt, slideSystemPrompt, notesSystemPrompt } from './design-rules'

// 生成编排(presenton 式两阶段)：① LLM 出大纲并为每页选模板 id;
// ② 取所选模板 schema 作结构化输出约束, LLM 只填槽位 → validateAndClamp(字数上限截断) → 渲染。
// LLM 经依赖注入(DeckLlm), 便于以 fake 完整验证; 真实接 llm.ts 仅需薄适配器(见 toDeckLlm 注释)。

export interface DeckLlm {
  /** 给定 system/user 提示与 JSON Schema 约束, 产出结构化 JSON 对象。 */
  generateJson(args: {
    system: string
    user: string
    schema: Record<string, unknown>
    signal?: AbortSignal
  }): Promise<unknown>
  /**
   * 流式纯文本生成(可选)。用于自由设计等长输出: 流式首字节秒级到达,
   * 避免云端网关 524(源站超时判定的是首字节, 非总时长)。onContent 为增量回调(可做实时预览)。
   * 不实现时调用方回退 generateJson(便于 fake LLM 单测)。
   */
  generateText?(args: {
    system: string
    user: string
    signal?: AbortSignal
    onContent?: (piece: string) => void
  }): Promise<string>
}

export interface GenerateDeckInput {
  brief: string
  themeId?: string
  maxSlides?: number
  /** 风格家族 id(限定选型作用域 + 默认主题); 不传则全量(向后兼容) */
  styleFamily?: string
}

export type VisualRole = 'hero' | 'transition' | 'data' | 'quote' | 'closing' | 'content'

export interface OutlineSlide {
  templateId: string
  title: string
  intent: string
  /** 视觉叙事角色(位置四问): 影响视觉重心与内容密度, 避免全篇同质 */
  visualRole?: VisualRole
}

export interface GeneratedSlide {
  templateId: string
  layout: string
  title: string
  data: SlideData
  html: string
  /** 逐页口播解说稿(供解说视频 TTS) */
  notes: string
  warnings: string[]
}

export interface GeneratedDeck {
  title: string
  themeId: string
  slides: GeneratedSlide[]
}

export interface DeckGeneratorDeps {
  llm: DeckLlm
  /** 模板来源(默认仅内置 6 套; 传云端 provider 则内置+云端按需) */
  templates?: TemplateProvider
  /** 为空图片槽填语义图标(query→图标 PNG dataURL); 不传则不填(空占位) */
  iconFor?: (query: string) => Promise<string>
  /**
   * 信息图填充器(能力8): 该页适合数据可视化时, 为空图片槽生成数据驱动图表 PNG dataURL。
   * 入参 = 本页标题/意图; 返回空串表示该页不适合图表(交回图标填充)。不传则不生成图表。
   */
  chartFor?: (title: string, intent: string) => Promise<string>
  /**
   * 知识库检索器(能力: 从绑定知识库取真实素材填 PPT)。入参 query/topK, 返回素材片段(已按相关度排序)。
   * 大纲与逐页生成时调用, 把检索到的真实数据/文案注入 LLM。不传则不接知识库。
   */
  kbSearch?: (query: string, topK?: number) => Promise<Array<{ source: string; content: string; score: number }>>
  onProgress?: (p: { phase: 'outline' | 'slide'; done: number; total: number }) => void
  signal?: AbortSignal
}

/** 把 KB 检索片段格式化为注入 prompt 的文本(空则返空串) */
async function kbContextText(
  kbSearch: DeckGeneratorDeps['kbSearch'],
  query: string,
  topK: number
): Promise<string> {
  if (!kbSearch) return ''
  try {
    const hits = await kbSearch(query, topK)
    if (!hits || hits.length === 0) return ''
    // 防 prompt 膨胀: 单片段截断 800 字符, 总量封顶 ~3000 字符
    const MAX_PER = 800
    const MAX_TOTAL = 3000
    let total = 0
    const lines: string[] = []
    for (let i = 0; i < hits.length; i++) {
      const c = (hits[i]!.content || '').slice(0, MAX_PER)
      if (total + c.length > MAX_TOTAL) break
      total += c.length
      lines.push(`[${i + 1}] (${hits[i]!.source}) ${c}`)
    }
    if (lines.length === 0) return ''
    return '\n\n以下是知识库中与本主题相关的真实素材(优先使用其中的事实/数据/文案, 不要编造):\n' + lines.join('\n')
  } catch {
    return ''
  }
}

// 已有可用图像(真实 URL / dataURL / 文件路径)的不覆盖; 其余视为空槽, 可填图标。
function hasRealImage(v: SlideData[string] | undefined): boolean {
  return typeof v === 'string' && /^(https?:|data:|file:|[a-zA-Z]:[\\/]|\/)/.test(v)
}

const DEFAULT_TEMPLATE = 'bullets'

function manifestText(entries: TemplateManifestEntry[]): string {
  return entries.map((m) => `- ${m.id}(${m.name}): ${m.description}`).join('\n')
}

function buildOutlineSchema(maxSlides: number, ids: string[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'slides'],
    properties: {
      title: { type: 'string', maxLength: 60, description: '演示标题' },
      slides: {
        type: 'array',
        minItems: 1,
        maxItems: maxSlides,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['templateId', 'title', 'intent', 'visualRole'],
          properties: {
            templateId: { type: 'string', enum: ids, description: '为该页选用的版式模板 id' },
            title: { type: 'string', maxLength: 40, description: '该页标题(断言句, 自带信息)' },
            intent: { type: 'string', maxLength: 160, description: '该页要讲什么(供填充内容用)' },
            visualRole: {
              type: 'string',
              enum: ['hero', 'transition', 'data', 'quote', 'closing', 'content'],
              description: '视觉叙事角色: hero封面/transition过渡/data数据/quote引语/closing结尾/content常规'
            }
          }
        }
      }
    }
  }
}

export async function generateOutline(
  input: GenerateDeckInput,
  deps: DeckGeneratorDeps
): Promise<{ title: string; slides: OutlineSlide[] }> {
  const provider = deps.templates ?? builtinTemplateProvider
  const maxSlides = Math.min(Math.max(input.maxSlides ?? 8, 1), 20)
  // 选型作用域限定在所选风格家族内(P0 修复); 该家族无可用模板时回退全量, 绝不落空。
  let manifest = await provider.listManifest(input.styleFamily)
  if (manifest.length === 0) manifest = await provider.listManifest()
  const ids = manifest.map((m) => m.id)
  const validIds = new Set(ids)
  const system = outlineSystemPrompt(
    `可用版式模板(为每页选一个最合适的, 用其 id):\n${manifestText(manifest)}`
  )
  const kbText = await kbContextText(deps.kbSearch, input.brief, 6)
  const user = `根据以下需求产出 PPT 大纲(标题 + 每页选版式 + 页标题 + 该页意图):\n\n${input.brief}${kbText}`
  const raw = (await deps.llm.generateJson({
    system,
    user,
    schema: buildOutlineSchema(maxSlides, ids),
    signal: deps.signal
  })) as { title?: unknown; slides?: unknown }
  const title = typeof raw.title === 'string' && raw.title ? raw.title : '未命名演示'
  const rawSlides = Array.isArray(raw.slides) ? (raw.slides as OutlineSlide[]) : []
  const validRoles = new Set(['hero', 'transition', 'data', 'quote', 'closing', 'content'])
  const slides = rawSlides.slice(0, maxSlides).map((s) => ({
    // 非法 templateId 回退, 防 LLM 乱选
    templateId: validIds.has(s?.templateId) ? s.templateId : DEFAULT_TEMPLATE,
    title: typeof s?.title === 'string' ? s.title : '',
    intent: typeof s?.intent === 'string' ? s.intent : '',
    visualRole: validRoles.has(s?.visualRole as string) ? (s.visualRole as OutlineSlide['visualRole']) : 'content'
  }))
  deps.onProgress?.({ phase: 'outline', done: 1, total: 1 })
  return { title, slides }
}

export async function generateSlide(
  outlineSlide: OutlineSlide,
  deckTitle: string,
  theme: ThemeTokens,
  deps: DeckGeneratorDeps
): Promise<GeneratedSlide> {
  const provider = deps.templates ?? builtinTemplateProvider
  const tpl =
    (await provider.resolveTemplate(outlineSlide.templateId)) ??
    (await provider.resolveTemplate(DEFAULT_TEMPLATE))
  if (!tpl) throw new Error(`无法解析模板: ${outlineSlide.templateId}`)
  const roleHint: Record<string, string> = {
    hero: '这是封面/金句页(hero): 内容极简、信息点少, 让标题有冲击力。',
    transition: '这是章节过渡页(transition): 一句话即可, 留白为主。',
    data: '这是数据页(data): 突出关键数字与对比, 文字精炼。',
    quote: '这是引语页(quote): 大字引述 + 出处, 不堆要点。',
    closing: '这是结尾/行动页(closing): 收束并给出明确下一步。',
    content: '这是常规内容页(content): 一个核心观点 + 不超过 5 个要点。'
  }
  const role = outlineSlide.visualRole ?? 'content'
  const system = slideSystemPrompt(
    `当前版式: ${tpl.name}(${tpl.description})。${roleHint[role]}只输出符合 schema 的字段数据。`
  )
  const kbText = await kbContextText(deps.kbSearch, `${outlineSlide.title} ${outlineSlide.intent}`, 4)
  const user =
    `演示主题: ${deckTitle}\n本页标题: ${outlineSlide.title}\n本页意图: ${outlineSlide.intent}\n本页角色: ${role}\n` +
    `按 schema 产出该页内容。${kbText}`
  let data: SlideData
  let warnings: string[]
  try {
    const raw = (await deps.llm.generateJson({
      system,
      user,
      schema: toJsonSchema(tpl.schema),
      signal: deps.signal
    })) as SlideData | null
    const v = validateAndClamp(tpl.schema, raw ?? {})
    // 槽位有内容则用清洗后数据, 否则用模板默认数据兜底(绝不产出空白页)
    data = Object.keys(v.data).length > 0 ? v.data : tpl.defaultData
    warnings = v.errors
  } catch (e) {
    data = tpl.defaultData
    warnings = ['LLM 失败, 用默认数据兜底: ' + (e as Error).message]
  }
  // 空图片槽填充(优先级: 信息图 > 语义图标)。
  // 信息图(能力8): 该页适合数据可视化时, 用数据驱动图表 PNG 填首个空图槽; 不适合则回退图标。
  if (deps.chartFor || deps.iconFor) {
    const query = `${outlineSlide.title} ${outlineSlide.intent}`.trim()
    let chartUsed = false // 每页至多放一张信息图(避免一页多图表喧宾夺主)
    for (const [field, def] of Object.entries(tpl.schema)) {
      if (def.type !== 'image' || hasRealImage(data[field])) continue
      // 先试信息图
      if (deps.chartFor && !chartUsed) {
        try {
          const chart = await deps.chartFor(outlineSlide.title, outlineSlide.intent)
          if (chart) {
            data[field] = chart
            chartUsed = true
            continue
          }
        } catch {
          /* 图表生成失败回退图标 */
        }
      }
      // 回退语义图标
      if (deps.iconFor) {
        try {
          const icon = await deps.iconFor(query)
          if (icon) data[field] = icon
        } catch {
          /* 图标填充失败不影响生成 */
        }
      }
    }
  }
  const notes = await generateNotes(outlineSlide, data, deckTitle, deps)
  const html = renderSlideHtml(tpl, data, theme)
  return { templateId: tpl.id, layout: tpl.id, title: outlineSlide.title, data, html, notes, warnings }
}

const NOTES_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['notes'],
  properties: { notes: { type: 'string', maxLength: 400, description: '本页口播解说稿' } }
}

/** 为一页生成口播解说稿(基于已填充内容); 失败回空串(解说时占位) */
async function generateNotes(
  outlineSlide: OutlineSlide,
  data: SlideData,
  deckTitle: string,
  deps: DeckGeneratorDeps
): Promise<string> {
  const system = notesSystemPrompt('为演示者写这一页的口播解说稿。')
  const user =
    `演示主题: ${deckTitle}\n本页标题: ${outlineSlide.title}\n本页意图: ${outlineSlide.intent}\n` +
    `本页屏幕内容(JSON): ${JSON.stringify(data)}\n据此写口播解说稿(口语、自然、2-4句, 补充讲解而非复读屏幕文字)。`
  try {
    const raw = (await deps.llm.generateJson({
      system,
      user,
      schema: NOTES_SCHEMA,
      signal: deps.signal
    })) as { notes?: unknown }
    return typeof raw.notes === 'string' ? raw.notes.trim() : ''
  } catch {
    return ''
  }
}

export async function generateDeck(
  input: GenerateDeckInput,
  deps: DeckGeneratorDeps
): Promise<GeneratedDeck> {
  // 主题解析: 显式 themeId 优先, 否则用家族默认主题(P1: 恢复各家族视觉身份), 再否则默认。
  const resolvedThemeId = input.themeId ?? (input.styleFamily ? familyTheme(input.styleFamily) : 'editorial-serif')
  const theme = themeById(resolvedThemeId)
  const outline = await generateOutline(input, deps)
  const slides: GeneratedSlide[] = []
  const total = outline.slides.length
  for (let i = 0; i < total; i++) {
    if (deps.signal?.aborted) throw new Error('aborted')
    const gs = await generateSlide(outline.slides[i]!, outline.title, theme, deps)
    slides.push(gs)
    deps.onProgress?.({ phase: 'slide', done: i + 1, total })
  }
  return { title: outline.title, themeId: theme.id, slides }
}

// 真实接线(未来在 ipc/service 层): 把 llm.ts 包成 DeckLlm —
//   generateJson = 调 callLLM({ response_format:{type:'json_object'}, messages:[system,user+schema], signal })
//   → JSON.parse(text)。outline 流式可另接 streamContext.onContent 推 deck:outlineStream。
// 此处不直连 llm.ts, 保持本模块纯逻辑可单测(DI), 适配器是唯一接线点。
