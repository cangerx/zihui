import type Database from 'better-sqlite3'
import { join } from 'path'
import { mkdirSync, writeFileSync, statSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { getDataDir, getRootDir } from '../data-path'
import { OffscreenRenderer, getOffscreenRenderer } from './offscreen-renderer'
import { generateDeck, type DeckLlm, type GeneratedDeck } from './deck-generator'
import { getSharedTemplateProvider } from './template-provider'
import { toDeckLlm } from './llm-adapter'
import { buildPptxFromExtracted } from './pptx-exporter'
import { exportDeckPdf } from './pdf-exporter'
import { buildPrototypeHtml } from './prototype-exporter'
import { encodeGif, type RgbaFrame } from './gif-exporter'
import { exportDeckMp4 } from './video-exporter'
import { buildNarration, muxNarrationIntoMp4 } from './narrate-pipeline'
import { detect as ffDetect, FfmpegNotReadyError } from './ffmpeg-manager'
import { cloudSynth } from './deck-cloud'
import { resolveDeckEmbedder } from './icon-embedder'
import { ensureIconIndex } from './icon-index-builder'
import { searchIcons, renderIconPng, type DeckEmbedder, type IconHit } from './icon-search'
import { critiqueSlide, summarizeDeck, type CritiqueLlm, type DeckReview, type SlideReview } from './critique'
import { toCritiqueLlm } from './llm-adapter'
import { renderChartPng, coerceChartSpec, CHART_SCHEMA } from './infographic'
import { themeById } from './theme'
import { familyTheme } from './families'
import { getDatabase, isSqliteVecAvailable } from '../../database'
import * as P from './persistence'
import type { ExtractedSlide, ThemeTokens } from './types'

type DB = Database.Database

// deck 服务编排: 把已验证的引擎模块串成 "生成→持久化→渲染导出" 闭环。
// db / renderer / llm 均可注入(默认走真实 getDatabase()/离屏单例/llm.ts), 便于端到端验证。

export interface GenerateDeckOptions {
  brief: string
  themeId?: string
  maxSlides?: number
  /** 风格家族 id(限定选型作用域 + 默认主题) */
  styleFamily?: string
  providerId: string
  modelId: string
  projectId?: string
  window?: Electron.BrowserWindow | null
  signal?: AbortSignal
  onProgress?: (p: { phase: 'outline' | 'slide'; done: number; total: number }) => void
  /** 注入(测试用); 不传则用 toDeckLlm(providerId,modelId) 接真实 llm.ts */
  llm?: DeckLlm
  db?: DB
  /** 为空图片槽自动填语义图标(默认 true; embedder 不可用时优雅退回空占位) */
  useIcons?: boolean
  /** 注入图标填充器(测试用); 不传则用真实 icon-search 流水线 */
  iconFor?: (query: string) => Promise<string>
  /** 适合的页自动生成信息图填空图槽(默认 true; LLM 判断不适合时回退图标) */
  useCharts?: boolean
  /** 注入信息图填充器(测试用); 不传则用真实 LLM+渲染流水线 */
  chartFor?: (title: string, intent: string) => Promise<string>
}

/**
 * 图标填充器: 解析嵌入器 + 建图标索引(各一次), 按 query 检索最相关图标 → 渲染为 PNG dataURL。
 * 任一环节失败(无 MiniLM 权重且未登录云端等)即标记不可用, 之后直接返回 ''(空占位), 不重复尝试。
 */
function makeIconFiller(db: DB): (query: string) => Promise<string> {
  let embedder: DeckEmbedder | null = null
  let resolved = false
  let broken = false
  return async (query: string): Promise<string> => {
    if (broken || !query.trim()) return ''
    try {
      if (!resolved) {
        resolved = true
        embedder = await resolveDeckEmbedder()
        await ensureIconIndex({ db, embedder, sqliteVecOk: isSqliteVecAvailable() })
      }
      if (!embedder) return ''
      const hits: IconHit[] = await searchIcons(query, {
        db,
        embedder,
        topK: 1,
        sqliteVecOk: isSqliteVecAvailable()
      })
      if (!hits[0]) return ''
      // 中性灰图标, 适配各主题; 居中渲染由 declarative image 块的 data: 分支处理
      return 'data:image/png;base64,' + renderIconPng(hits[0].svgPath, 128, '#94a3b8').toString('base64')
    } catch {
      broken = true
      return ''
    }
  }
}

// 信息图填充器(能力8): 让 LLM 判断本页是否适合数据可视化, 适合则出 ChartSpec → 渲染图表 PNG。
// 不适合(useChart=false / 数据点<2 / LLM 失败)返回 ''(交回图标填充)。主题色驱动配色, 与该 deck 视觉一致。
function makeChartFiller(llm: DeckLlm, theme: ThemeTokens): (title: string, intent: string) => Promise<string> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['useChart'],
    properties: {
      useChart: { type: 'boolean', description: '本页是否适合用数据图表展示(有明确数值/占比/趋势/对比才为 true)' },
      chart: CHART_SCHEMA
    }
  }
  return async (title: string, intent: string): Promise<string> => {
    try {
      const raw = (await llm.generateJson({
        system:
          '你判断一页幻灯片是否适合用数据图表(柱/折线/饼/进度)呈现。仅当内容含明确数值、占比、趋势或对比时才用图表; ' +
          '纯观点/流程/概念不要用图表。适合则给出真实可信的示例数据(2-8 个数据点), 不要编造离谱数字。',
        user: `本页标题: ${title}\n本页意图: ${intent}\n判断是否适合图表; 适合则填 chart 字段。`,
        schema
      })) as { useChart?: unknown; chart?: unknown }
      if (raw?.useChart !== true) return ''
      const spec = coerceChartSpec(raw.chart)
      if (!spec) return ''
      return renderChartPng(spec, theme)
    } catch {
      return ''
    }
  }
}

export async function generateAndSaveDeck(
  opts: GenerateDeckOptions
): Promise<{ projectId: string; deck: GeneratedDeck }> {
  const llm = opts.llm ?? toDeckLlm(opts.providerId, opts.modelId, opts.window)
  const iconFor =
    opts.iconFor ?? (opts.useIcons === false ? undefined : makeIconFiller(opts.db ?? getDatabase()))
  // 信息图主题与 generator 主题解析一致(显式 themeId 优先, 否则家族默认, 再否则 editorial-serif)
  const chartTheme = themeById(opts.themeId ?? (opts.styleFamily ? familyTheme(opts.styleFamily) : 'editorial-serif'))
  const chartFor =
    opts.chartFor ?? (opts.useCharts === false ? undefined : makeChartFiller(llm, chartTheme))
  const deck = await generateDeck(
    { brief: opts.brief, themeId: opts.themeId, maxSlides: opts.maxSlides, styleFamily: opts.styleFamily },
    {
      llm,
      // 内置 6 套 + 云端按需模板(共享单例, 缓存 manifest; 云端不可达时优雅退回仅内置)
      templates: getSharedTemplateProvider(join(getRootDir(), 'templates')),
      iconFor,
      chartFor,
      onProgress: opts.onProgress,
      signal: opts.signal
    }
  )

  const projectId =
    opts.projectId ??
    P.createProject(
      {
        title: deck.title,
        theme_id: deck.themeId,
        style_family: opts.styleFamily ?? '',
        text_provider_id: opts.providerId,
        text_model_id: opts.modelId
      },
      opts.db
    )

  P.updateProject(
    projectId,
    { title: deck.title, theme_id: deck.themeId, style_family: opts.styleFamily ?? '', status: 'ready' },
    opts.db
  )
  P.updateProjectOutline(
    projectId,
    { slides: deck.slides.map((s) => ({ templateId: s.templateId, title: s.title })) },
    opts.db
  )
  // 全量重建 slides(覆盖式生成)
  for (const existing of P.listSlides(projectId, opts.db)) P.deleteSlide(existing.id, opts.db)
  deck.slides.forEach((s) =>
    P.createSlide(
      { project_id: projectId, layout: s.layout, ir: s.data, html: s.html, notes: s.notes },
      opts.db
    )
  )

  return { projectId, deck }
}

export function deckDir(deckId: string): string {
  const dir = join(getDataDir(), 'deck', deckId)
  mkdirSync(dir, { recursive: true })
  return dir
}

export type ExportKind = 'pptx' | 'pdf' | 'gif' | 'mp4' | 'prototype'

export interface ExportOptions {
  renderer?: OffscreenRenderer
  db?: DB
  /** 覆盖落盘目录(测试用); 默认 deckDir(deckId) */
  outDir?: string
}

/** 导出整套 deck 为 pptx / pdf / gif, 落盘并登记到 deck_assets */
export async function exportDeck(
  deckId: string,
  kind: ExportKind,
  opts: ExportOptions = {}
): Promise<{ path: string; size: number }> {
  const renderer = opts.renderer ?? getOffscreenRenderer()
  const slides = P.listSlides(deckId, opts.db)
  const htmls = slides.map((s) => s.html).filter((h) => h.length > 0)
  if (htmls.length === 0) throw new Error('该 deck 无可导出的幻灯片')
  const dir = opts.outDir ?? deckDir(deckId)

  let outPath: string
  if (kind === 'prototype') {
    // 可点击原型: 纯前端打包(不经离屏渲染), 用已存逐页 HTML → 单个自包含可点击 HTML 文件。
    const proj = P.getProject(deckId, opts.db)
    let titles: string[] = []
    try {
      const ol = proj?.outline ? (JSON.parse(proj.outline) as { slides?: { title?: string }[] }) : null
      titles = (ol?.slides ?? []).map((s) => s.title ?? '')
    } catch {
      titles = []
    }
    const protoSlides = htmls.map((h, i) => ({ html: h, title: titles[i] }))
    const html = buildPrototypeHtml(protoSlides, { deckTitle: proj?.title })
    const protoDir = join(dir, 'prototype')
    mkdirSync(protoDir, { recursive: true })
    outPath = join(protoDir, 'index.html')
    writeFileSync(outPath, html, 'utf8')
  } else if (kind === 'pdf') {
    const buf = await exportDeckPdf(htmls, renderer)
    outPath = join(dir, 'deck.pdf')
    writeFileSync(outPath, buf)
  } else if (kind === 'pptx') {
    // 按"能否抽到可编辑元素"决定, 不再按 layout 标签:
    //  - 模板页 / pptx-path 自由设计页(带 data-ir): renderExtract 抽出 → 可逐元素编辑。
    //  - visual-path 自由设计页(无 data-ir): 抽取为空 → 降级整页截图当单 image(见 deck-agent-spec §4.4)。
    const renderable = slides.filter((s) => s.html.length > 0)
    const extracted: ExtractedSlide[] = []
    for (const s of renderable) {
      const ex = await renderer.renderExtract(s.html)
      if (ex.elements.length > 0) {
        extracted.push(ex)
      } else {
        const png = await renderer.renderPng(s.html)
        const dataUrl = 'data:image/png;base64,' + png.toString('base64')
        extracted.push({ widthPx: 1280, heightPx: 720, elements: [{ role: 'image', x: 0, y: 0, w: 1280, h: 720, imagePath: dataUrl }] })
      }
    }
    const buf = await buildPptxFromExtracted(extracted)
    outPath = join(dir, 'deck.pptx')
    writeFileSync(outPath, buf)
  } else if (kind === 'mp4') {
    // ffmpeg 门控: 未就绪抛 FfmpegNotReadyError, IPC 层转 needFfmpeg 给 UI 弹「请安装 ffmpeg」
    const st = ffDetect()
    if (!st.ready || !st.ffmpeg) throw new FfmpegNotReadyError(st.reason ?? 'ffmpeg 未就绪')
    const buf = await exportDeckMp4(htmls, renderer, st.ffmpeg)
    outPath = join(dir, 'deck.mp4')
    writeFileSync(outPath, buf)
  } else {
    // gif: 每页一帧的幻灯放映(delay 1.5s)
    const frames: RgbaFrame[] = []
    for (const h of htmls) frames.push(await renderer.renderRgba(h))
    const buf = encodeGif(frames, { delayMs: 1500 })
    outPath = join(dir, 'deck.gif')
    writeFileSync(outPath, buf)
  }

  const size = statSync(outPath).size
  P.addAsset({ project_id: deckId, kind, local_path: outPath, file_size: size }, opts.db)
  return { path: outPath, size }
}

/**
 * 解说视频: 无声 MP4 + 云端 TTS 解说音轨(逐页 slide.notes)合流。需 ffmpeg+ffprobe。
 * 解说稿取 slide.notes(空则占位); 完整逐页时长精确对齐为后续增强。
 */
export async function narrateDeck(
  deckId: string,
  opts: ExportOptions = {}
): Promise<{ path: string; size: number }> {
  const st = ffDetect()
  if (!st.ready || !st.ffmpeg || !st.ffprobe) {
    throw new FfmpegNotReadyError(st.reason ?? 'ffmpeg 未就绪')
  }
  const renderer = opts.renderer ?? getOffscreenRenderer()
  const slides = P.listSlides(deckId, opts.db).filter((s) => s.html.length > 0)
  if (slides.length === 0) throw new Error('该 deck 无可导出的幻灯片')
  const dir = opts.outDir ?? deckDir(deckId)

  const htmls = slides.map((s) => s.html)
  const chunks = slides.map((s) => ({
    text: s.notes && s.notes.trim() ? s.notes.trim() : '（本页无解说稿）',
    gapMs: 400
  }))

  const tmp = mkdtempSync(join(tmpdir(), 'deck-narrate-'))
  try {
    // 1) 无声视频
    const videoBuf = await exportDeckMp4(htmls, renderer, st.ffmpeg)
    const videoPath = join(tmp, 'video.mp4')
    writeFileSync(videoPath, videoBuf)
    // 2) 云端 TTS 解说音轨
    const narr = await buildNarration(chunks, cloudSynth, st.ffmpeg, st.ffprobe)
    const narrPath = join(tmp, 'narr.mp3')
    writeFileSync(narrPath, narr.audio)
    // 3) 合流
    const outPath = join(dir, 'deck-narrated.mp4')
    await muxNarrationIntoMp4(videoPath, narrPath, outPath, st.ffmpeg)

    const size = statSync(outPath).size
    P.addAsset({ project_id: deckId, kind: 'narration', local_path: outPath, file_size: size }, opts.db)
    return { path: outPath, size }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export interface CritiqueDeckOptions {
  renderer?: OffscreenRenderer
  db?: DB
  /** 注入评审 LLM(测试用); 不传则用真实多模态 callLLM */
  llm?: CritiqueLlm
  providerId?: string
  modelId?: string
  window?: Electron.BrowserWindow | null
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
}

/**
 * 设计评审(能力10): 逐页离屏截图 + 布局度量 → 多模态 LLM 5 维评分 → 写 deck_slides.review。
 * 返回整套评审汇总。客观度量确定性算出, 主观项 LLM 评; LLM 不可用时降级为纯客观评分(不整页失败)。
 */
export async function critiqueDeck(
  deckId: string,
  opts: CritiqueDeckOptions = {}
): Promise<DeckReview> {
  const renderer = opts.renderer ?? getOffscreenRenderer()
  const slides = P.listSlides(deckId, opts.db).filter((s) => s.html.length > 0)
  if (slides.length === 0) throw new Error('该 deck 无可评审的幻灯片')
  const llm =
    opts.llm ?? toCritiqueLlm(opts.providerId ?? '', opts.modelId ?? '', opts.window)
  // 页标题取自 outline
  const proj = P.getProject(deckId, opts.db)
  let titles: string[] = []
  try {
    const ol = proj?.outline ? (JSON.parse(proj.outline) as { slides?: { title?: string }[] }) : null
    titles = (ol?.slides ?? []).map((s) => s.title ?? '')
  } catch {
    titles = []
  }

  const items: Array<{ index: number; title: string; review: SlideReview }> = []
  const total = slides.length
  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) throw new Error('aborted')
    const s = slides[i]!
    const { png, extracted } = await renderer.renderReview(s.html)
    const imageDataUrl = 'data:image/png;base64,' + png.toString('base64')
    const title = titles[i] ?? ''
    const review = await critiqueSlide(extracted, imageDataUrl, llm, { title, signal: opts.signal })
    P.updateSlide(s.id, { review }, opts.db)
    items.push({ index: i, title, review })
    opts.onProgress?.(i + 1, total)
  }
  return summarizeDeck(items)
}

export interface IconSearchResultItem {
  id: string
  name: string
  score: number
  /** 预栅格化 PNG(data URL), 供 UI 直接展示/插入幻灯片(对齐 html2pptx 图标用 PNG 约束) */
  png: string
}

export interface SearchIconsOptions {
  topK?: number
  /** 单色图标渲染色(默认深灰); 实际插页时由主题色覆盖 */
  color?: string
  pngSizePx?: number
  db?: DB
  embedder?: DeckEmbedder
}

/**
 * 语义图标检索编排: 解析嵌入器(MiniLM 本地优先, 退云端语义) → 确保索引就绪(按模型变更重建)
 * → vec0 KNN/JS cosine 检索 → 逐枚栅格化为 PNG dataURL。
 * 嵌入器不就绪时由 IconEmbedderNotReadyError 上抛, IPC 层转 needEmbedder 给 UI(与 ffmpeg 门控同构)。
 */
export async function searchDeckIcons(
  query: string,
  opts: SearchIconsOptions = {}
): Promise<IconSearchResultItem[]> {
  const db = opts.db ?? getDatabase()
  const embedder = opts.embedder ?? (await resolveDeckEmbedder())
  const sqliteVecOk = isSqliteVecAvailable()
  await ensureIconIndex({ db, embedder, sqliteVecOk })
  const hits: IconHit[] = await searchIcons(query, {
    db,
    embedder,
    topK: opts.topK ?? 6,
    sqliteVecOk
  })
  const color = opts.color ?? '#1f2937'
  const size = opts.pngSizePx ?? 96
  return hits.map((h) => ({
    id: h.id,
    name: h.name,
    score: h.score,
    png: 'data:image/png;base64,' + renderIconPng(h.svgPath, size, color).toString('base64')
  }))
}
