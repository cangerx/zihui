import { BrowserWindow } from 'electron'
import type { ExtractedSlide } from './types'
import { EXTRACT_SCRIPT } from './pptx-exporter'

// 离屏渲染器：用 Electron 内置 Chromium 的离屏 BrowserWindow 渲染受控模板 HTML,
// 提供 抽取布局度量 / 截图 PNG / 矢量 PDF 三种产出。单实例 + 串行队列复用,
// 超时强制销毁重建。是 PPTX/PDF/PNG/MP4 帧 共同依赖的渲染总闸(spec §6.1)。

export interface RenderOpts {
  width?: number
  height?: number
  /** 设备像素比, 提升截图清晰度 */
  scale?: number
  /** 单次渲染硬超时(ms) */
  timeoutMs?: number
}

const DEFAULTS = { width: 1280, height: 720, scale: 1, timeoutMs: 15000 }

// 合并选项: 显式 undefined 不覆盖默认值(避免 {width:undefined} 把默认宽度冲掉)
function mergeOpts(opts: RenderOpts): { width: number; height: number; scale: number; timeoutMs: number } {
  return {
    width: opts.width ?? DEFAULTS.width,
    height: opts.height ?? DEFAULTS.height,
    scale: opts.scale ?? DEFAULTS.scale,
    timeoutMs: opts.timeoutMs ?? DEFAULTS.timeoutMs
  }
}

export class OffscreenRenderer {
  private win: BrowserWindow | null = null
  private queue: Promise<unknown> = Promise.resolve()

  private async ensureWindow(width: number, height: number, scale: number): Promise<BrowserWindow> {
    if (this.win && !this.win.isDestroyed()) {
      this.win.setContentSize(width, height)
      return this.win
    }
    const win = new BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      webPreferences: {
        offscreen: true,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        // 离屏渲染按 scale 倍率出图, 保证高分清晰度与坐标确定性
        zoomFactor: 1
      }
    })
    win.webContents.setFrameRate(30)
    // 软件合成下 capturePage 仍可用; scale 通过 deviceScaleFactor 体现
    if (scale !== 1) win.webContents.setZoomFactor(1)
    this.win = win
    return win
  }

  /** 串行执行, 防止并发渲染争用同一窗口 */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn)
    // 不让链上一个失败阻断后续
    this.queue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  private async load(html: string, o: Required<RenderOpts>): Promise<BrowserWindow> {
    const win = await this.ensureWindow(o.width, o.height, o.scale)
    const wc = win.webContents
    const finished = new Promise<void>((resolve, reject) => {
      const onOk = (): void => {
        cleanup()
        resolve()
      }
      const onFail = (_e: unknown, code: number, desc: string): void => {
        cleanup()
        reject(new Error(`did-fail-load ${code} ${desc}`))
      }
      const cleanup = (): void => {
        wc.off('did-finish-load', onOk)
        wc.off('did-fail-load', onFail)
      }
      wc.once('did-finish-load', onOk)
      wc.once('did-fail-load', onFail)
    })
    await wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await finished
    // 就绪栅栏: window.__deckReady + 字体 + 图片 解码完成, 否则量度失真(spec §6.1)
    await wc.executeJavaScript(`new Promise((res) => {
      const done = () => res(true);
      const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
      fontsReady.then(() => {
        const imgs = Array.prototype.slice.call(document.images || []);
        return Promise.all(imgs.map((i) => i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })));
      }).then(() => {
        const start = Date.now();
        (function spin(){ if (window.__deckReady === true || Date.now() - start > 3000) done(); else setTimeout(spin, 16); })();
      });
    })`)
    return win
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => {
        // 超时: 销毁窗口以便下次重建, 防泄漏
        if (this.win && !this.win.isDestroyed()) this.win.destroy()
        this.win = null
        reject(new Error(`offscreen render timeout ${ms}ms`))
      }, ms)
      p.then(
        (v) => {
          clearTimeout(t)
          resolve(v)
        },
        (e) => {
          clearTimeout(t)
          reject(e)
        }
      )
    })
  }

  /** 渲染并抽取布局度量(喂 pptx-exporter) */
  renderExtract(html: string, opts: RenderOpts = {}): Promise<ExtractedSlide> {
    const o = mergeOpts(opts)
    return this.run(() =>
      this.withTimeout(
        (async () => {
          const win = await this.load(html, o)
          const raw = (await win.webContents.executeJavaScript(EXTRACT_SCRIPT)) as {
            background?: string
            elements: ExtractedSlide['elements']
          }
          return { widthPx: o.width, heightPx: o.height, background: raw.background, elements: raw.elements }
        })(),
        o.timeoutMs
      )
    )
  }

  /** 渲染为 PNG 截图 */
  renderPng(html: string, opts: RenderOpts = {}): Promise<Buffer> {
    const o = mergeOpts(opts)
    return this.run(() =>
      this.withTimeout(
        (async () => {
          const win = await this.load(html, o)
          const img = await win.webContents.capturePage()
          return img.toPNG()
        })(),
        o.timeoutMs
      )
    )
  }

  /** 渲染为 RGBA 像素帧(供 gif 编码; capturePage 出 BGRA, 转 RGBA) */
  renderRgba(
    html: string,
    opts: RenderOpts = {}
  ): Promise<{ width: number; height: number; data: Uint8Array }> {
    const o = mergeOpts(opts)
    return this.run(() =>
      this.withTimeout(
        (async () => {
          const win = await this.load(html, o)
          const img = await win.webContents.capturePage()
          const size = img.getSize()
          const bgra = img.toBitmap() // BGRA
          const data = new Uint8Array(bgra.length)
          for (let i = 0; i < bgra.length; i += 4) {
            data[i] = bgra[i + 2]! // R
            data[i + 1] = bgra[i + 1]! // G
            data[i + 2] = bgra[i]! // B
            data[i + 3] = bgra[i + 3]! // A
          }
          return { width: size.width, height: size.height, data }
        })(),
        o.timeoutMs
      )
    )
  }

  /**
   * 逐帧捕获(供 MP4/GIF 动画): 加载一次, 对每个时间点 t 调 window.__seek(t)(若页面暴露)再截图。
   * 静态页(无 __seek)则各帧相同。返回 PNG 帧序列。
   */
  renderFrames(html: string, times: number[], opts: RenderOpts = {}): Promise<Buffer[]> {
    const o = mergeOpts(opts)
    return this.run(() =>
      this.withTimeout(
        (async () => {
          const win = await this.load(html, o)
          const frames: Buffer[] = []
          // 逐帧从 t=0 起 __seek 覆盖 onload 定格的终态, 播出入场动画(__seek 幂等)
          for (const t of times) {
            await win.webContents.executeJavaScript(`(window.__seek && window.__seek(${t})), 1`)
            const img = await win.webContents.capturePage()
            frames.push(img.toPNG())
          }
          return frames
        })(),
        o.timeoutMs * Math.max(times.length, 1)
      )
    )
  }

  /**
   * 渲染并一次产出 截图 PNG + 布局度量(供设计评审): 加载一次, 既 capturePage 又抽 [data-ir] 度量,
   * 避免评审时双倍渲染。
   */
  renderReview(
    html: string,
    opts: RenderOpts = {}
  ): Promise<{ png: Buffer; extracted: ExtractedSlide }> {
    const o = mergeOpts(opts)
    return this.run(() =>
      this.withTimeout(
        (async () => {
          const win = await this.load(html, o)
          const raw = (await win.webContents.executeJavaScript(EXTRACT_SCRIPT)) as {
            background?: string
            elements: ExtractedSlide['elements']
          }
          const img = await win.webContents.capturePage()
          return {
            png: img.toPNG(),
            extracted: {
              widthPx: o.width,
              heightPx: o.height,
              background: raw.background,
              elements: raw.elements
            }
          }
        })(),
        o.timeoutMs
      )
    )
  }

  /** 渲染为矢量 PDF(单页) */
  renderPdf(html: string, opts: RenderOpts = {}): Promise<Buffer> {
    const o = mergeOpts(opts)
    return this.run(() =>
      this.withTimeout(
        (async () => {
          const win = await this.load(html, o)
          return await win.webContents.printToPDF({
            printBackground: true,
            pageSize: { width: o.width / 96, height: o.height / 96 }, // 英寸
            margins: { top: 0, bottom: 0, left: 0, right: 0 }
          })
        })(),
        o.timeoutMs
      )
    )
  }

  dispose(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }
}

let shared: OffscreenRenderer | null = null
export function getOffscreenRenderer(): OffscreenRenderer {
  if (!shared) shared = new OffscreenRenderer()
  return shared
}
