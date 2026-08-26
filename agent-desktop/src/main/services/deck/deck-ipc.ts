import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import * as deckService from './deck-service'
import * as P from './persistence'
import { listManifest } from './template-registry'
import { getSharedTemplateProvider, clearSharedTemplateProvider } from './template-provider'
import { listThemes } from './theme'
import { getRootDir } from '../data-path'
import { detect as ffDetect, ensureFfmpeg, FfmpegNotReadyError } from './ffmpeg-manager'
import { loadFfmpegManifest, loadTemplateManifest, cloudFetchBytes } from './deck-cloud'
import { IconEmbedderNotReadyError } from './icon-search'
import type { ExportKind } from './deck-service'

// deck:* IPC handlers。由 ipc/index.ts 的 registerIpcHandlers 传入(已 wrapWithEpoch)的 ipcMain 注册。
// 与 image-gen 范式一致: 长任务用 AbortController 取消, 经 win.webContents.send('deck:progress') 推进度。

interface IpcLike {
  handle(
    channel: string,
    listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any
  ): void
}

const inflight = new Map<string, AbortController>()

export interface DeckGenerateArgs {
  reqId: string
  brief: string
  providerId: string
  modelId: string
  themeId?: string
  maxSlides?: number
  styleFamily?: string
  useIcons?: boolean
  useCharts?: boolean
  projectId?: string
}

export function registerDeckIpc(ipcMain: IpcLike): void {
  // 内置模板元数据(供选型/展示)
  ipcMain.handle('deck:listTemplates', () => listManifest())

  // 可用风格家族(内置+云端按需; 云端不可达时仅 basic)。共享 provider 缓存 manifest, 不每次重拉。
  // refresh=true 时清缓存重拉(云端模板有更新后手动刷新)。
  ipcMain.handle('deck:families', async (_e, refresh?: boolean) => {
    try {
      if (refresh) clearSharedTemplateProvider()
      const provider = getSharedTemplateProvider(join(getRootDir(), 'templates'))
      return await provider.listFamilies()
    } catch (e) {
      return [{ id: 'basic', label: '基础内置', description: '离线可用的通用版式', theme: 'editorial-serif', count: 6, error: e instanceof Error ? e.message : String(e) }]
    }
  })

  // 可用主题(供高级主题覆盖)
  ipcMain.handle('deck:themes', () => listThemes())

  // 云端模板 manifest(按需云缓存的轻量元数据; 渲染包由 template-manager 按需拉)
  ipcMain.handle('deck:cloudTemplates', async () => {
    try {
      return await loadTemplateManifest()
    } catch (e) {
      return { schema_version: 1, templates: [], error: e instanceof Error ? e.message : String(e) }
    }
  })

  // 生成(可取消, 推进度)
  ipcMain.handle('deck:generate', async (event, args: DeckGenerateArgs) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const ac = new AbortController()
    inflight.set(args.reqId, ac)
    try {
      const { projectId, deck } = await deckService.generateAndSaveDeck({
        brief: args.brief,
        themeId: args.themeId,
        maxSlides: args.maxSlides,
        styleFamily: args.styleFamily,
        useIcons: args.useIcons,
        useCharts: args.useCharts,
        providerId: args.providerId,
        modelId: args.modelId,
        projectId: args.projectId,
        window: win,
        signal: ac.signal,
        onProgress: (p) => win?.webContents.send('deck:progress', { reqId: args.reqId, ...p })
      })
      // 返回结构化可克隆数据(去掉函数等)
      return {
        ok: true,
        projectId,
        title: deck.title,
        themeId: deck.themeId,
        slides: deck.slides.map((s) => ({
          templateId: s.templateId,
          title: s.title,
          html: s.html,
          warnings: s.warnings
        }))
      }
    } finally {
      inflight.delete(args.reqId)
    }
  })

  ipcMain.handle('deck:cancel', (_e, reqId: string) => {
    inflight.get(reqId)?.abort()
    return true
  })

  // 项目 CRUD
  ipcMain.handle('deck:list', () => P.listProjects())
  ipcMain.handle('deck:get', (_e, id: string) => ({
    project: P.getProject(id) ?? null,
    slides: P.listSlides(id),
    assets: P.listAssets(id)
  }))
  ipcMain.handle('deck:delete', (_e, id: string) => {
    P.deleteProject(id)
    return true
  })

  // 导出 pptx / pdf / gif / mp4(mp4 需 ffmpeg, 未就绪返回 needFfmpeg 让 UI 弹门控)
  ipcMain.handle('deck:export', async (_e, id: string, kind: ExportKind) => {
    try {
      return await deckService.exportDeck(id, kind) // { path, size }
    } catch (e) {
      if (e instanceof FfmpegNotReadyError) return { needFfmpeg: true, reason: e.reason }
      throw e
    }
  })

  // 解说视频(视频 + 云端 TTS 解说合流; 同样 ffmpeg 门控)
  ipcMain.handle('deck:narrate', async (_e, id: string) => {
    try {
      return await deckService.narrateDeck(id)
    } catch (e) {
      if (e instanceof FfmpegNotReadyError) return { needFfmpeg: true, reason: e.reason }
      throw e
    }
  })

  // ffmpeg 就绪状态(供视频导出前检测/门控弹窗)
  ipcMain.handle('deck:ffmpegStatus', () => {
    const st = ffDetect()
    return { ready: st.ready, reason: st.reason ?? '' }
  })

  // 从【其绑定云控端】按需下载安装 ffmpeg(三层分发, SHA256 强校验, 经 deck:progress 推进度)
  ipcMain.handle('deck:installFfmpeg', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    try {
      let manifest = { schema_version: 1, builds: [] as Awaited<ReturnType<typeof loadFfmpegManifest>>['builds'] }
      try {
        manifest = await loadFfmpegManifest()
      } catch {
        /* 云控清单拉不到时仍允许本机 PATH / 公开静态包 */
      }
      const st = await ensureFfmpeg(manifest, {
        fetchBytes: cloudFetchBytes,
        onProgress: (p) => win?.webContents.send('deck:progress', { phase: 'ffmpeg', stage: p.stage })
      })
      return { ready: st.ready, reason: st.reason ?? '' }
    } catch (e) {
      return { ready: false, reason: e instanceof Error ? e.message : String(e) }
    }
  })

  // 设计评审(能力10): 逐页截图 + 度量 → 多模态 LLM 5 维评分 → 写 review, 返回汇总。
  // 需选文本/多模态模型(providerId/modelId); 推 deck:progress 进度。
  ipcMain.handle(
    'deck:critique',
    async (event, args: { reqId: string; deckId: string; providerId: string; modelId: string }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const ac = new AbortController()
      inflight.set(args.reqId, ac)
      try {
        const review = await deckService.critiqueDeck(args.deckId, {
          providerId: args.providerId,
          modelId: args.modelId,
          window: win,
          signal: ac.signal,
          onProgress: (done, total) =>
            win?.webContents.send('deck:progress', { reqId: args.reqId, phase: 'critique', done, total })
        })
        return { ok: true, review }
      } finally {
        inflight.delete(args.reqId)
      }
    }
  )

  // 语义图标检索(满血): 返回 Top-K 图标(含预栅格 PNG dataURL)。
  // 嵌入器未就绪(如 MiniLM 权重未缓存且云端不可用) → needEmbedder, UI 据此引导(与 needFfmpeg 同构)。
  ipcMain.handle('deck:searchIcons', async (_e, query: string, topK?: number) => {
    try {
      const icons = await deckService.searchDeckIcons(query, { topK })
      return { ok: true, icons }
    } catch (e) {
      if (e instanceof IconEmbedderNotReadyError) return { needEmbedder: true, reason: e.reason }
      throw e
    }
  })

  // 在文件管理器中显示导出文件
  ipcMain.handle('deck:reveal', (_e, path: string) => {
    shell.showItemInFolder(path)
    return true
  })
}
