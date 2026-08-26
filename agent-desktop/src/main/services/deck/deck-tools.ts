import type { BrowserWindow } from 'electron'
import * as P from './persistence'
import { generateOutline, generateSlide, type OutlineSlide, type DeckLlm } from './deck-generator'
import { toDeckLlm } from './llm-adapter'
import { getSharedTemplateProvider } from './template-provider'
import { themeById, listThemes } from './theme'
import { familyTheme, STYLE_FAMILIES } from './families'
import { renderChartPng, coerceChartSpec, CHART_SCHEMA } from './infographic'
import { generateFreeformSlide } from './freeform-engine'
import { extractGrammar, parseGrammar, grammarPromptText, type DeckPath } from './deck-grammar'
import { renderDecorativePng } from './decorative-image'
import { cloudImageSearch, cloudFetchBytes } from './deck-cloud'
import { generateImages } from '../image-generation'
import { exportDeck, narrateDeck, critiqueDeck, searchDeckIcons, type ExportKind } from './deck-service'
import { getRootDir, getDataDir } from '../data-path'
import { join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'
import { embedText } from '../embedding'
import { searchHybrid } from '../vector-store'
import { listKnowledgeBases } from '../knowledge'
import { searchCloudKnowledgeBases } from '../cloud-kb-search'

// PPT Agent 工具集: 把 deck 现成能力包装成 OpenAI function-calling 工具, 挂到 chat-engine 的 Agent loop。
// 设计要点(对齐 deck-agent-spec.md §3):
//  - 工具结果【不回传整页 HTML】(避免 MAX_TOOL_RESULT_CHARS=12000 截断), 只回 slideId + 元信息, HTML 落库;
//  - 每个 conversation 关联一个 deck project(内存 map: convId→projectId), Agent 多轮操作同一份 deck;
//  - LLM 经 execContext 的 provider/model 解析(与对话同模型), 便于子生成(填槽/自由HTML/图表判断)。

// ---------------- 会话 → deck project 关联 ----------------
const convDeck = new Map<string, string>()

/** 取/建该会话的当前 deck project id */
function ensureProject(convId: string, title?: string): string {
  let pid = convDeck.get(convId)
  if (pid && P.getProject(pid)) return pid
  pid = P.createProject({ title: title ?? '对话生成的演示' })
  convDeck.set(convId, pid)
  return pid
}

/** 显式设置会话当前 project(打开历史 deck 继续编辑用) */
export function bindConversationDeck(convId: string, projectId: string): void {
  convDeck.set(convId, projectId)
}

export interface DeckToolContext {
  conversationId?: string
  providerId?: string
  modelId?: string
  /** 会话的图像模型(deck_gen_image 生图用; 空则直接走 SVG 兜底) */
  imageProviderId?: string
  imageModelId?: string
  window?: BrowserWindow | null
  signal?: AbortSignal
  /** 该会话 bot 绑定的知识库(本地分类 / 云端), 供大纲与逐页取素材 */
  kb?: { categoryIds?: string[]; cloudKbIds?: number[]; cloudAgentId?: number; topK?: number }
}

/** 组装知识库检索器(本地 searchHybrid + 云端 searchCloudKnowledgeBases 合并)。无绑定则返 undefined。 */
function makeKbSearch(ctx: DeckToolContext): ((q: string, topK?: number) => Promise<Array<{ source: string; content: string; score: number }>>) | undefined {
  const kb = ctx.kb
  const hasLocal = !!kb?.categoryIds?.length
  const hasCloud = !!(kb?.cloudKbIds?.length && kb?.cloudAgentId)
  if (!hasLocal && !hasCloud) return undefined
  return async (query: string, topK = 5) => {
    const out: Array<{ source: string; content: string; score: number }> = []
    if (hasLocal) {
      try {
        const kbIds: string[] = []
        for (const cat of kb!.categoryIds!) for (const k of listKnowledgeBases(cat)) if (k.status === 'ready' || k.status === 'stale') kbIds.push(k.id)
        if (kbIds.length) {
          const emb = await embedText(query, { signal: ctx.signal })
          for (const h of searchHybrid(emb.embedding, query, kbIds, topK, 0.3)) {
            out.push({ source: '本地知识库', content: h.chunk.content, score: h.score })
          }
        }
      } catch {
        /* 本地检索失败不阻断 */
      }
    }
    if (hasCloud) {
      try {
        const res = await searchCloudKnowledgeBases({ agentId: kb!.cloudAgentId!, query, kbIds: kb!.cloudKbIds!, topK, signal: ctx.signal })
        for (const h of res.hits) out.push({ source: h.kb_name, content: h.content, score: h.score })
      } catch {
        /* 云端检索失败不阻断 */
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, topK)
  }
}

// ---------------- 工具定义 ----------------
export const DECK_TOOL_NAMES = [
  'deck_plan_outline',
  'deck_make_showcase',
  'deck_set_grammar',
  'deck_gen_slide_template',
  'deck_gen_slide_freeform',
  'deck_make_chart',
  'deck_search_icon',
  'deck_gen_image',
  'deck_list_slides',
  'deck_update_slide',
  'deck_reorder',
  'deck_critique',
  'deck_export'
]

export const deckToolDefs = [
  {
    type: 'function',
    function: {
      name: 'deck_plan_outline',
      description:
        '为 PPT 规划大纲: 给出演示标题, 并为每页选版式模板 + 页标题 + 意图 + 视觉角色。生成后存入当前会话的 deck。' +
        '应在用户确认需求后第一步调用; 返回大纲供你和用户确认, 再逐页生成。',
      parameters: {
        type: 'object',
        properties: {
          brief: { type: 'string', description: '演示需求描述(主题/受众/要点)' },
          style_family: { type: 'string', description: '风格家族 id(可空, 留空自动)', enum: STYLE_FAMILIES.map((f) => f.id) },
          theme_id: { type: 'string', description: '配色主题 id(可空, 留空跟随风格)' },
          max_slides: { type: 'number', description: '页数上限(默认 8, 最大 20)' }
        },
        required: ['brief']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deck_make_showcase',
      description:
        '【huashu 工作流第一步, 强烈推荐】先做 1-2 页 showcase 定设计方向, 而不是一口气写到底。' +
        '选视觉差异最大的两页(如封面 + 一个典型内容页), AI 自由设计。生成后【把这两页展示给用户确认设计方向】, ' +
        '确认后再调 deck_set_grammar 固化设计语法。path=pptx(默认,可编辑PPTX,守4约束) 或 visual(视觉优先,出图片/视频)。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', enum: ['pptx', 'visual'], description: '交付路径: pptx=可编辑PPTX(默认) / visual=视觉优先(图片/视频)' },
          theme_id: { type: 'string', description: '配色主题 id(可空)' },
          pages: {
            type: 'array',
            minItems: 1,
            maxItems: 2,
            description: '1-2 个 showcase 页(视觉差异最大的两页)',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: '页标题' },
                intent: { type: 'string', description: '这页要表达什么、想要的视觉风格(越具体越好)' }
              },
              required: ['title', 'intent']
            }
          }
        },
        required: ['pages']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deck_set_grammar',
      description:
        '【huashu 工作流第二步】用户确认 showcase 设计方向后调用。从已生成的 showcase 页提炼出本 deck 的设计语法(grammar), ' +
        '之后 deck_gen_slide_freeform 生成的每一页都会自动复用这套语法, 保证全 deck 视觉浑然一体。无参数。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deck_gen_slide_template',
      description:
        '用受控模板生成/重做某一页(引擎1, 快/稳/PPTX 可编辑)。按大纲序号生成。内容由 schema 约束、自动配图标/信息图。' +
        '默认走这个; 只有需要高视觉创意/封面时才用 deck_gen_slide_freeform。',
      parameters: {
        type: 'object',
        properties: {
          outline_index: { type: 'number', description: '要生成的大纲页序号(从 0 开始)' },
          use_icons: { type: 'boolean', description: '空图片位自动配语义图标(默认 true)' },
          use_charts: { type: 'boolean', description: '数据页自动生成信息图表(默认 true)' }
        },
        required: ['outline_index']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deck_gen_slide_freeform',
      description:
        'AI 自由设计一页(huashu 式高质量, deck 的主力生成方式)。你描述这页要什么, 由设计子模型当场写 HTML。' +
        '【已确立 grammar 后会自动复用设计语法, 保证与全 deck 连贯】。path 自动跟随 grammar: ' +
        'pptx 路径产出守 4 约束+data-ir 的 HTML(可抽取为可编辑 PPTX); visual 路径自由(导出图片/视频)。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '页标题' },
          intent: { type: 'string', description: '这页要表达什么、想要的视觉风格(越具体越好)' },
          theme_id: { type: 'string', description: '配色主题 id(可空, 跟随 deck 主题)' },
          insert_index: { type: 'number', description: '插入位置(可空, 默认追加到末尾)' },
          animate: { type: 'boolean', description: 'cinematic 动画(仅 visual 路径, 让页面带 window.__seek 时钟动画, 用于导出视频; 默认 false 静态)' }
        },
        required: ['title', 'intent']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deck_make_chart',
      description: '生成一张数据信息图(柱/折线/饼/堆叠/面积/散点/甜甜圈/仪表盘)的 PNG, 返回可插入的图片路径。',
      parameters: {
        type: 'object',
        properties: {
          chart: CHART_SCHEMA,
          theme_id: { type: 'string', description: '配色主题 id(可空)' }
        },
        required: ['chart']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deck_search_icon',
      description: '语义检索图标(返回 Top-K 图标名与 id), 供你为某页挑选合适图标。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '图标语义(如: 数据增长 / 团队协作 / 安全)' },
          top_k: { type: 'number', description: '返回数量(默认 6)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deck_gen_image',
      description:
        '为某页取配图(封面/背景/插图), 三级自动降级: ①真实素材图(Pixabay, 若云端启用) ②AI 生图(若会话已配图像模型) ③自绘抽象装饰图(主题色干净专业)。' +
        '返回图片本地 url, 在自由设计 HTML 里用 <img src="url"> 或填进 image 槽。可能较慢(生图约 30-90 秒), 一页一张即可。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '配图描述(生图提示词, 越具体越好; 如: 现代办公室里团队协作, 简洁摄影风)' }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deck_list_slides',
      description: '列出当前 deck 的所有页(序号/版式/标题/是否已生成), 用于了解进度和定位要改的页。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deck_update_slide',
      description: '修改某一页(改解说稿 notes; 改内容需重新生成该页)。',
      parameters: {
        type: 'object',
        properties: {
          slide_id: { type: 'string', description: '页 id(从 deck_list_slides 取)' },
          notes: { type: 'string', description: '口播解说稿(可空)' }
        },
        required: ['slide_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deck_reorder',
      description: '调整页序。给出全部页 id 的新顺序。',
      parameters: {
        type: 'object',
        properties: {
          ordered_slide_ids: { type: 'array', items: { type: 'string' }, description: '按目标顺序排列的全部页 id' }
        },
        required: ['ordered_slide_ids']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deck_critique',
      description: '对当前 deck 逐页 AI 设计评审(8 维打分 + 改进建议), 用于定位需要返工的低分页。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deck_export',
      description: '导出当前 deck。kind: pptx(可编辑)/pdf/gif/mp4/prototype(可点击HTML)。返回文件路径。',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['pptx', 'pdf', 'gif', 'mp4', 'prototype'], description: '导出格式' }
        },
        required: ['kind']
      }
    }
  }
]

// ---------------- 执行分发 ----------------

function llmOf(ctx: DeckToolContext): DeckLlm {
  return toDeckLlm(ctx.providerId ?? '', ctx.modelId ?? '', ctx.window)
}

function themeFor(projectId: string, override?: string): string {
  if (override) return override
  const proj = P.getProject(projectId)
  if (proj?.theme_id) return proj.theme_id
  if (proj?.style_family) return familyTheme(proj.style_family)
  return 'editorial-serif'
}

/** 读 project.outline 的 slides 数组 */
function readOutline(projectId: string): OutlineSlide[] {
  const proj = P.getProject(projectId)
  if (!proj?.outline) return []
  try {
    const o = JSON.parse(proj.outline) as { slides?: OutlineSlide[] }
    return o.slides ?? []
  } catch {
    return []
  }
}

/** 读 project.grammar 里的 path(即使 grammar 未确立也带 path; 默认 pptx 可编辑) */
function readGrammarPath(projectId: string): DeckPath {
  try {
    const g = JSON.parse(P.getProject(projectId)?.grammar || '{}') as { path?: string }
    return g.path === 'visual' ? 'visual' : 'pptx'
  } catch {
    return 'pptx'
  }
}

/**
 * 执行 deck 工具。返回 { handled, result }(对齐 executeCoreToolCall 协议)。
 * 未识别返回 { handled:false } 交给下级路由。
 */
export async function executeDeckTool(
  name: string,
  args: any,
  ctx: DeckToolContext
): Promise<{ handled: boolean; result?: any }> {
  if (!DECK_TOOL_NAMES.includes(name)) return { handled: false }
  const convId = ctx.conversationId
  if (!convId) return { handled: true, result: { error: 'deck 工具需在对话上下文中使用' } }

  try {
    switch (name) {
      case 'deck_plan_outline': {
        const llm = ctx.providerId ? llmOf(ctx) : undefined
        if (!llm) return { handled: true, result: { error: '未选择模型, 无法规划大纲' } }
        const styleFamily = args.style_family || undefined
        const provider = getSharedTemplateProvider(join(getRootDir(), 'templates'))
        const outline = await generateOutline(
          { brief: String(args.brief || ''), styleFamily, maxSlides: args.max_slides, themeId: args.theme_id },
          { llm, templates: provider, kbSearch: makeKbSearch(ctx), signal: ctx.signal }
        )
        const pid = ensureProject(convId, outline.title)
        const themeId = args.theme_id || (styleFamily ? familyTheme(styleFamily) : 'editorial-serif')
        P.updateProject(pid, { title: outline.title, theme_id: themeId, style_family: styleFamily ?? '' })
        P.updateProjectOutline(pid, { slides: outline.slides })
        // 清空旧页(覆盖式规划)
        for (const ex of P.listSlides(pid)) P.deleteSlide(ex.id)
        return {
          handled: true,
          result: {
            ok: true,
            projectId: pid,
            title: outline.title,
            slideCount: outline.slides.length,
            outline: outline.slides.map((s, i) => ({ index: i, templateId: s.templateId, title: s.title, visualRole: s.visualRole }))
          }
        }
      }

      case 'deck_gen_slide_template': {
        const pid = ensureProject(convId)
        const outline = readOutline(pid)
        const idx = Number(args.outline_index)
        const os = outline[idx]
        if (!os) return { handled: true, result: { error: `大纲无第 ${idx} 页, 请先 deck_plan_outline` } }
        const llm = llmOf(ctx)
        const theme = themeById(themeFor(pid, args.theme_id))
        const provider = getSharedTemplateProvider(join(getRootDir(), 'templates'))
        const gs = await generateSlide(os, P.getProject(pid)?.title ?? '', theme, {
          llm,
          templates: provider,
          kbSearch: makeKbSearch(ctx),
          // 图标/图表填充器: 复用 deck-service 的 makeIconFiller/makeChartFiller 较重, 这里按需简化——
          // 默认不在工具内自动填(Agent 可显式调 deck_make_chart/deck_search_icon), 保持工具职责单一。
          signal: ctx.signal
        })
        const slideId = P.createSlide({ project_id: pid, sort_order: idx, layout: gs.layout, ir: gs.data, html: gs.html, notes: gs.notes })
        return { handled: true, result: { ok: true, slideId, index: idx, templateId: gs.templateId, warnings: gs.warnings } }
      }

      case 'deck_gen_slide_freeform': {
        const pid = ensureProject(convId)
        const llm = llmOf(ctx)
        const theme = themeById(themeFor(pid, args.theme_id))
        // grammar 贯穿: 已确立则注入设计语法 + 沿用其 path, 后续页照同一视觉语言生成(连贯)
        const grammar = parseGrammar(P.getProject(pid)?.grammar)
        const path: DeckPath = grammar?.path ?? readGrammarPath(pid)
        const ff = await generateFreeformSlide(
          { title: String(args.title || ''), intent: String(args.intent || ''), theme, path, grammarText: grammarPromptText(grammar), animated: !!args.animate },
          { llm, signal: ctx.signal }
        )
        const slides = P.listSlides(pid)
        const order = typeof args.insert_index === 'number' ? args.insert_index : slides.length
        const slideId = P.createSlide({ project_id: pid, sort_order: order, layout: 'freeform', ir: { freeform: true }, html: ff.html, notes: '' })
        return { handled: true, result: { ok: true, slideId, index: order, engine: 'freeform', path, grammarApplied: !!grammar, warnings: ff.warnings } }
      }

      case 'deck_make_showcase': {
        const pid = ensureProject(convId)
        const llm = llmOf(ctx)
        const path: DeckPath = args.path === 'visual' ? 'visual' : 'pptx' // 默认 pptx(可编辑)
        const theme = themeById(themeFor(pid, args.theme_id))
        // 1-2 个视觉差异最大的页(封面 + 典型内容页), 不带 grammar(此时在"确立" grammar)
        const pages = Array.isArray(args.pages) ? args.pages.slice(0, 2) : []
        if (pages.length === 0) return { handled: true, result: { error: '需提供 1-2 个 showcase 页(pages: [{title,intent}])' } }
        // 覆盖式: showcase 重做时清掉旧页
        for (const ex of P.listSlides(pid)) P.deleteSlide(ex.id)
        const made: Array<{ slideId: string; index: number; warnings: string[] }> = []
        for (let i = 0; i < pages.length; i++) {
          const pg = pages[i] as { title?: string; intent?: string }
          const ff = await generateFreeformSlide(
            { title: String(pg?.title || ''), intent: String(pg?.intent || ''), theme, path },
            { llm, signal: ctx.signal }
          )
          const slideId = P.createSlide({ project_id: pid, sort_order: i, layout: 'freeform', ir: { showcase: true }, html: ff.html, notes: '' })
          made.push({ slideId, index: i, warnings: ff.warnings })
        }
        // 固化主题: showcase 是 huashu 流程入口(不经 plan_outline, 后者才落 theme_id),
        // 选定主题须落库, 否则后续 deck_gen_slide_freeform 未带 theme_id 时回退默认主题, 与 showcase 配色漂移。
        if (args.theme_id) P.updateProject(pid, { theme_id: String(args.theme_id) })
        // 记录 path(grammar 未确立), 供 set_grammar 用
        P.updateProjectGrammar(pid, { established: false, path, exemplars: [], rules: '' })
        return {
          handled: true,
          result: {
            ok: true,
            path,
            slides: made,
            hint: '已生成 showcase。请把这 1-2 页展示给用户确认设计方向(masthead/字体/配色/版面); 用户确认后调 deck_set_grammar 固化设计语法, 再用 deck_gen_slide_freeform 批量生成其余页(会自动复用 grammar 保持连贯)。'
          }
        }
      }

      case 'deck_set_grammar': {
        const pid = ensureProject(convId)
        const slides = P.listSlides(pid).filter((s) => s.html.length > 0)
        if (slides.length === 0) return { handled: true, result: { error: '无 showcase 页可固化, 请先 deck_make_showcase' } }
        const path = readGrammarPath(pid)
        const showcaseHtmls = slides.slice(0, 2).map((s) => s.html)
        const grammar = await extractGrammar(showcaseHtmls, path, llmOf(ctx), ctx.signal)
        P.updateProjectGrammar(pid, grammar)
        return {
          handled: true,
          result: { ok: true, established: true, path, rulesPreview: grammar.rules.slice(0, 240), exemplarCount: grammar.exemplars.length }
        }
      }

      case 'deck_make_chart': {
        const pid = ensureProject(convId)
        const spec = coerceChartSpec(args.chart)
        if (!spec) return { handled: true, result: { error: '图表数据非法(至少 2 个数据点, gauge 至少 1 个)' } }
        const theme = themeById(themeFor(pid, args.theme_id))
        const dataUrl = renderChartPng(spec, theme)
        // 落盘为文件供插入(dataURL 太长不回传给 LLM)
        const dir = join(getDataDir(), 'deck', pid, 'charts')
        mkdirSync(dir, { recursive: true })
        const file = join(dir, `chart-${Date.now()}.png`)
        writeFileSync(file, Buffer.from(dataUrl.split(',')[1]!, 'base64'))
        return { handled: true, result: { ok: true, chartPath: file, kind: spec.kind } }
      }

      case 'deck_search_icon': {
        const icons = await searchDeckIcons(String(args.query || ''), { topK: args.top_k })
        return { handled: true, result: { ok: true, icons: icons.map((i) => ({ id: i.id, name: i.name, score: Math.round(i.score * 100) / 100 })) } }
      }

      case 'deck_gen_image': {
        const pid = ensureProject(convId)
        const prompt = String(args.prompt || '')
        if (!prompt.trim()) return { handled: true, result: { error: '需提供配图描述 prompt' } }
        const dir = join(getDataDir(), 'deck', pid, 'images')
        mkdirSync(dir, { recursive: true })
        const localUrl = (p: string): string => `local-file://img?p=${encodeURIComponent(p.replace(/\\/g, '/'))}`

        // ① 第一级 Pixabay 真实素材图(云控端启用并配 key 时): 搜 → 下载首图到本地(本地化, 渲染/嵌PPTX都稳)
        try {
          const hits = await cloudImageSearch(prompt, 6, ctx.signal)
          if (hits[0]?.url) {
            const bytes = await cloudFetchBytes(hits[0].url, ctx.signal)
            if (bytes && bytes.length > 0) {
              // 扩展名白名单提取: Pixabay url 形如 .../xxx_1280.jpg; 无标准扩展名时兜底 jpg,
              // 避免 split('.').pop() 截到域名/查询段产出非法文件名(Windows 下含 / 会让 writeFileSync 抛错)
              const extM = /\.(jpe?g|png|webp|gif)(?:$|[?#])/i.exec(hits[0].url)
              const ext = extM ? extM[1]!.toLowerCase() : 'jpg'
              const file = join(dir, `pixabay-${Date.now()}.${ext}`)
              writeFileSync(file, bytes)
              return { handled: true, result: { ok: true, source: 'pixabay', path: file, url: localUrl(file) } }
            }
          }
        } catch {
          /* Pixabay 不可用 → 降级生图 */
        }

        // ② 第二级 AI 生图(会话已配图像模型时)。await 拿结果路径(阻塞约 30-90s 可接受)。
        if (ctx.imageProviderId && ctx.imageModelId) {
          try {
            const gens = await generateImages(
              { prompt, modelProviderId: ctx.imageProviderId, modelId: ctx.imageModelId, size: '16:9', quality: 'auto', batchCount: 1 },
              ctx.window ?? null
            )
            const gen = gens[0]
            if (gen && gen.status !== 'error' && gen.result_path) {
              const abs = join(getDataDir(), gen.result_path)
              return { handled: true, result: { ok: true, source: 'image-gen', path: abs, url: localUrl(abs) } }
            }
          } catch {
            /* 生图失败 → 降级 SVG */
          }
        }

        // ③ 第三级 自绘抽象装饰图(主题色, 纯色无渐变, 比裂图/AI-slop 好)
        const theme = themeById(themeFor(pid))
        const png = renderDecorativePng(prompt, theme)
        const file = join(dir, `decor-${Date.now()}.png`)
        writeFileSync(file, png)
        return { handled: true, result: { ok: true, source: 'svg-fallback', path: file, url: localUrl(file), note: 'Pixabay/生图 均不可用, 已用自绘装饰图兜底' } }
      }

      case 'deck_list_slides': {
        const pid = ensureProject(convId)
        const slides = P.listSlides(pid)
        const outline = readOutline(pid)
        return {
          handled: true,
          result: {
            ok: true,
            projectId: pid,
            title: P.getProject(pid)?.title,
            plannedCount: outline.length,
            slides: slides.map((s, i) => ({ index: i, slideId: s.id, layout: s.layout, generated: s.html.length > 0, hasNotes: !!s.notes }))
          }
        }
      }

      case 'deck_update_slide': {
        const patch: any = {}
        if (typeof args.notes === 'string') patch.notes = args.notes
        if (Object.keys(patch).length === 0) return { handled: true, result: { error: '无可更新字段' } }
        P.updateSlide(String(args.slide_id), patch)
        return { handled: true, result: { ok: true, slideId: args.slide_id } }
      }

      case 'deck_reorder': {
        const pid = ensureProject(convId)
        const ids = Array.isArray(args.ordered_slide_ids) ? args.ordered_slide_ids.map(String) : []
        if (!ids.length) return { handled: true, result: { error: '需提供 ordered_slide_ids' } }
        P.reorderSlides(pid, ids)
        return { handled: true, result: { ok: true } }
      }

      case 'deck_critique': {
        const pid = ensureProject(convId)
        const review = await critiqueDeck(pid, { providerId: ctx.providerId, modelId: ctx.modelId, window: ctx.window, signal: ctx.signal })
        return {
          handled: true,
          result: {
            ok: true,
            average: review.average,
            slides: review.slides.map((s) => ({ index: s.index, total: s.review.total, suggestions: s.review.suggestions }))
          }
        }
      }

      case 'deck_export': {
        const pid = ensureProject(convId)
        const kind = String(args.kind || 'pptx') as ExportKind
        if (kind === 'mp4') {
          const r = await narrateDeck(pid)
          return { handled: true, result: { ok: true, path: r.path, size: r.size } }
        }
        const r = await exportDeck(pid, kind)
        return { handled: true, result: { ok: true, path: (r as any).path, size: (r as any).size } }
      }

      default:
        return { handled: false }
    }
  } catch (e) {
    return { handled: true, result: { error: e instanceof Error ? e.message : String(e) } }
  }
}

// theme 列表给 prompt 用(可选)
export { listThemes }
