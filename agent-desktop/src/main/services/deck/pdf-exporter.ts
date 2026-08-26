import { PDFDocument } from 'pdf-lib'
import type { OffscreenRenderer } from './offscreen-renderer'

// PDF 导出: 每页经离屏 webContents.printToPDF 出单页矢量 PDF, 再用 pdf-lib 合并为一份。
// mergePdfs 纯逻辑(可单测); exportDeckPdf 串联离屏渲染。

/** 合并多份(各单页)PDF 为一份 */
export async function mergePdfs(pdfBuffers: Buffer[]): Promise<Buffer> {
  const out = await PDFDocument.create()
  for (const buf of pdfBuffers) {
    const src = await PDFDocument.load(buf)
    const pages = await out.copyPages(src, src.getPageIndices())
    for (const p of pages) out.addPage(p)
  }
  out.setProducer('agent-desktop deck')
  const bytes = await out.save()
  return Buffer.from(bytes)
}

/** 渲染整套幻灯片 HTML 为合并 PDF */
export async function exportDeckPdf(
  slidesHtml: string[],
  renderer: OffscreenRenderer,
  opts: { width?: number; height?: number } = {}
): Promise<Buffer> {
  const pages: Buffer[] = []
  for (const html of slidesHtml) {
    pages.push(await renderer.renderPdf(html, opts))
  }
  return mergePdfs(pages)
}
