import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface DeckSlideView {
  templateId: string
  title: string
  html: string
  warnings: string[]
}

export interface DeckProjectRow {
  id: string
  title: string
  theme_id: string
  status: string
  created_at: string
  updated_at: string
}

export interface DeckTemplateMeta {
  id: string
  name: string
  category: string
  description: string
}

export interface DeckFamily {
  id: string
  label: string
  description: string
  theme: string
  count: number
}

export interface DeckTheme {
  id: string
  name: string
}

interface GenerateResp {
  ok: boolean
  projectId: string
  title: string
  themeId: string
  slides: DeckSlideView[]
}

export type ExportResult =
  | { path: string; size: number }
  | { needFfmpeg: true; reason: string }

export interface SlideReviewScores {
  layout: number
  hierarchy: number
  whitespace: number
  color: number
  philosophy: number
  craft: number
  functionality: number
  originality: number
  overall: number
}
export interface SlideReviewItem {
  index: number
  title: string
  review: {
    scores: SlideReviewScores
    total: number
    suggestions: string[]
    metrics: { overflowCount: number; whitespaceRatio: number; alignEdges: number; fontLevels: number; minFontPx: number; textCount: number }
  }
}
export interface DeckReviewResult {
  slides: SlideReviewItem[]
  average: number
}
export type CritiqueResult = { ok: true; review: DeckReviewResult }

export interface IconResultItem {
  id: string
  name: string
  score: number
  png: string
}
export type SearchIconsResult =
  | { ok: true; icons: IconResultItem[] }
  | { needEmbedder: true; reason: string }

// AI Deck 渲染层状态机。照搬 image-gen 范式: generating/progress/lastError + 进度订阅(返回 unsubscribe)。
export const useDeckStore = defineStore('deck', () => {
  const generating = ref(false)
  const progress = ref<{ phase: string; done: number; total: number } | null>(null)
  const lastError = ref('')
  const slides = ref<DeckSlideView[]>([])
  const currentProjectId = ref('')
  const currentTitle = ref('')
  const projects = ref<DeckProjectRow[]>([])
  const templates = ref<DeckTemplateMeta[]>([])
  const families = ref<DeckFamily[]>([])
  const themes = ref<DeckTheme[]>([])
  const reviewing = ref(false)
  const review = ref<DeckReviewResult | null>(null)

  let reqSeq = 0
  let currentReqId = ''
  let unsubscribe: (() => void) | null = null

  function listenProgress(): void {
    if (unsubscribe) return
    unsubscribe = window.api.deck.onProgress((data) => {
      const d = data as { reqId?: string; phase?: string; done?: number; total?: number }
      if (d && d.reqId === currentReqId) {
        progress.value = { phase: d.phase ?? '', done: d.done ?? 0, total: d.total ?? 0 }
      }
    })
  }

  function stopListenProgress(): void {
    unsubscribe?.()
    unsubscribe = null
  }

  async function loadTemplates(): Promise<void> {
    templates.value = (await window.api.deck.invoke('listTemplates')) as DeckTemplateMeta[]
  }

  /** 加载可用风格(内置+云端按需) */
  async function loadFamilies(): Promise<void> {
    families.value = (await window.api.deck.invoke('families')) as DeckFamily[]
  }

  async function loadThemes(): Promise<void> {
    themes.value = (await window.api.deck.invoke('themes')) as DeckTheme[]
  }

  async function loadProjects(): Promise<void> {
    projects.value = (await window.api.deck.invoke('list')) as DeckProjectRow[]
  }

  async function generate(opts: {
    brief: string
    providerId: string
    modelId: string
    themeId?: string
    maxSlides?: number
    styleFamily?: string
    useIcons?: boolean
    useCharts?: boolean
  }): Promise<GenerateResp> {
    generating.value = true
    lastError.value = ''
    progress.value = null
    slides.value = []
    currentReqId = `deck-${Date.now()}-${++reqSeq}`
    listenProgress()
    try {
      const res = (await window.api.deck.invoke('generate', {
        reqId: currentReqId,
        ...opts
      })) as GenerateResp
      if (res?.ok) {
        slides.value = res.slides
        currentProjectId.value = res.projectId
        currentTitle.value = res.title
        await loadProjects()
      }
      return res
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      generating.value = false
      progress.value = null
    }
  }

  function cancel(): void {
    if (currentReqId) void window.api.deck.invoke('cancel', currentReqId)
  }

  async function openProject(id: string): Promise<void> {
    const res = (await window.api.deck.invoke('get', id)) as {
      project: DeckProjectRow | null
      slides: { layout: string; html: string }[]
    }
    currentProjectId.value = id
    currentTitle.value = res.project?.title ?? ''
    slides.value = (res.slides ?? []).map((s) => ({
      templateId: s.layout,
      title: '',
      html: s.html,
      warnings: []
    }))
  }

  async function remove(id: string): Promise<void> {
    await window.api.deck.invoke('delete', id)
    await loadProjects()
    if (currentProjectId.value === id) {
      currentProjectId.value = ''
      currentTitle.value = ''
      slides.value = []
    }
  }

  async function exportDeck(
    kind: 'pptx' | 'pdf' | 'gif' | 'mp4' | 'prototype'
  ): Promise<ExportResult> {
    if (!currentProjectId.value) throw new Error('请先生成或打开一个 deck')
    return (await window.api.deck.invoke('export', currentProjectId.value, kind)) as ExportResult
  }

  /** 解说视频(视频 + 云端 TTS 解说合流) */
  async function narrate(): Promise<ExportResult> {
    if (!currentProjectId.value) throw new Error('请先生成或打开一个 deck')
    return (await window.api.deck.invoke('narrate', currentProjectId.value)) as ExportResult
  }

  async function checkFfmpeg(): Promise<{ ready: boolean; reason: string }> {
    return (await window.api.deck.invoke('ffmpegStatus')) as { ready: boolean; reason: string }
  }

  /** 从其绑定云控端按需下载安装 ffmpeg(三层分发) */
  async function installFfmpeg(): Promise<{ ready: boolean; reason: string }> {
    return (await window.api.deck.invoke('installFfmpeg')) as { ready: boolean; reason: string }
  }

  function reveal(path: string): void {
    void window.api.deck.invoke('reveal', path)
  }

  /** 设计评审(逐页 AI 打分); 需文本/多模态模型 */
  async function critique(opts: { providerId: string; modelId: string }): Promise<CritiqueResult> {
    if (!currentProjectId.value) throw new Error('请先生成或打开一个 deck')
    reviewing.value = true
    review.value = null
    currentReqId = `deck-critique-${Date.now()}-${++reqSeq}`
    listenProgress()
    try {
      const res = (await window.api.deck.invoke('critique', {
        reqId: currentReqId,
        deckId: currentProjectId.value,
        providerId: opts.providerId,
        modelId: opts.modelId
      })) as CritiqueResult
      if (res?.ok) review.value = res.review
      return res
    } finally {
      reviewing.value = false
      progress.value = null
    }
  }

  /** 语义图标检索(手动搜索框) */
  async function searchIcons(query: string, topK = 12): Promise<SearchIconsResult> {
    return (await window.api.deck.invoke('searchIcons', query, topK)) as SearchIconsResult
  }

  /** 强制刷新云端模板/风格缓存(云端模板有更新后手动调) */
  async function refreshTemplates(): Promise<void> {
    families.value = (await window.api.deck.invoke('families', true)) as DeckFamily[]
  }

  return {
    generating,
    progress,
    lastError,
    slides,
    currentProjectId,
    currentTitle,
    projects,
    templates,
    families,
    themes,
    reviewing,
    review,
    loadTemplates,
    loadFamilies,
    loadThemes,
    loadProjects,
    generate,
    cancel,
    openProject,
    remove,
    exportDeck,
    narrate,
    critique,
    searchIcons,
    refreshTemplates,
    checkFfmpeg,
    installFfmpeg,
    reveal,
    stopListenProgress
  }
})
