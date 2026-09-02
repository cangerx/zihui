/**
 * 文档解析统一入口：把 PSD / PDF / DOC / DOCX / XLS / XLSX 等二进制办公文档
 * 提取为纯文本，让 LLM 上下文 / file_ops / 知识库 / 附件能正确"看到"内容。
 *
 * 设计要点：
 *  - 仅在主进程使用：依赖 fs + 三方 native-ish 库，不能在渲染端运行
 *  - 失败兜底：解析失败时返回 { ok: false, error: '...' }，调用方决定 fallback
 *  - 大小限制：避免几百 MB 的 PDF 把主进程内存打爆
 *  - 编码：返回的 text 是已 utf-8 化的纯字符串，可直接送给 LLM
 *
 * 各扩展支持矩阵：
 *  - .txt / .md / .json / .csv  → utf-8 直读（不调本模块）
 *  - .psd                       → ag-psd（仅解析图层/文字元数据，跳过位图）
 *  - .pdf                       → pdf-parse（限：扫描型 PDF 无文本层会返回空）
 *  - .docx                      → mammoth（仅文本，丢失图片/复杂样式）
 *  - .doc                       → word-extractor（pure JS 兜底，复杂格式效果有限）
 *  - .xls / .xlsx               → xlsx (SheetJS) → 每 sheet 拼成 TSV 文本
 *  - .pptx                      → jszip 解 zip 按页抽 <a:t>（含演讲者备注；图片/图形不进上下文）
 *  - .ppt                       → 老二进制 OLE 无成熟 pure-JS 提取器，明确报错引导另存为 .pptx
 */

import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, extname, join, resolve } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

/** 单个文档的最大允许大小（解析前检查 stat），避免 OOM */
export const MAX_DOC_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB

/**
 * ZIP based formats are parsed in memory by their respective libraries.  The
 * compressed input limit above is not enough to protect against a small ZIP
 * expanding into hundreds of megabytes, so validate the central directory
 * before handing the buffer to mammoth/SheetJS/JSZip.
 */
const MAX_ARCHIVE_ENTRIES = 10_000
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 200 * 1024 * 1024
const MAX_ARCHIVE_COMPRESSION_RATIO = 1_000
const MAX_PSD_LAYERS = 10_000
const MAX_PSD_LAYER_TEXT_CHARS = 10_000

/** 解析后返回结果。text 永远是 utf-8 字符串；失败时 ok=false */
export interface ParsedDocument {
  ok: boolean
  text: string
  /** 原始扩展名（小写、不含点） */
  ext: string
  /** 文件大小（字节） */
  size: number
  /** 解析器名称，便于排查 */
  parser: 'utf8' | 'pdf' | 'psd' | 'docx' | 'doc' | 'xlsx' | 'pptx' | 'unsupported' | 'error'
  /** 失败时的错误说明 */
  error?: string
  errorCode?: 'NO_EXTRACTABLE_TEXT' | 'TOO_LARGE' | 'READ_ERROR' | 'INVALID_PATH' | 'UNSUPPORTED_FORMAT' | 'PARSE_ERROR'
  warnings?: string[]
  features?: {
    hasImages?: boolean
    imageCount?: number
    pageCount?: number
    textLength?: number
    layerCount?: number
    textLayerCount?: number
  }
  /** 截断标记：text 是否因过长被截断；调用方可决定要不要走 RAG */
  truncated?: boolean
}

/** 这些扩展名走二进制文档解析器；其他扩展名调用方应自行 utf-8 直读 */
export const BINARY_DOCUMENT_EXTENSIONS = new Set(['pdf', 'psd', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'])

/** 判断扩展名是否走本模块解析；调用方按此分流 */
export function isBinaryDocument(filePath: string): boolean {
  if (typeof filePath !== 'string') return false
  const ext = normalizeExtension(extname(filePath).slice(1))
  return BINARY_DOCUMENT_EXTENSIONS.has(ext)
}

/**
 * Normalize an extension supplied over IPC.  An extension is a selector, not
 * a path, so accepting slashes or parent segments here would make it possible
 * to accidentally route an untrusted value into a filesystem-backed parser.
 */
function normalizeExtension(value: unknown): string {
  if (typeof value !== 'string') return ''
  const raw = value.trim().toLowerCase()
  const withoutDot = raw.startsWith('.') ? raw.slice(1) : raw
  return /^[a-z0-9]{1,16}$/.test(withoutDot) ? withoutDot : ''
}

/**
 * Paths are intentionally allowed to point at user-selected files outside the
 * workspace, but parent segments, NUL bytes, symlinks and directories are not
 * accepted by the parser boundary.  Workspace callers already canonicalize
 * their paths; this check protects the IPC/file attachment callers too.
 */
function validateDocumentPath(filePath: unknown): string {
  if (typeof filePath !== 'string') throw new Error('文档路径必须是字符串')
  const raw = filePath.trim()
  if (!raw) throw new Error('文档路径不能为空')
  if (raw.includes('\0')) throw new Error('文档路径包含非法 NUL 字符')
  const slashPath = raw.replace(/\\/g, '/')
  if (slashPath.split('/').some((part) => part === '..')) {
    throw new Error('文档路径不允许包含父目录段（..）')
  }
  return resolve(raw)
}

function invalidPathResult(filePath: unknown, error: unknown): ParsedDocument {
  const raw = typeof filePath === 'string' ? filePath : ''
  return {
    ok: false,
    text: '',
    ext: normalizeExtension(extname(raw).slice(1)),
    size: 0,
    parser: 'error',
    error: `文档路径无效：${error instanceof Error ? error.message : String(error)}`,
    errorCode: 'INVALID_PATH'
  }
}

/** 单 sheet/单文档最多保留的字符数（防御性，超出可由调用方走 RAG） */
const MAX_TEXT_CHARS = 200_000

function clamp(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TEXT_CHARS) return { text, truncated: false }
  return {
    text: text.slice(0, MAX_TEXT_CHARS) + `\n...(truncated, total ${text.length} chars)`,
    truncated: true
  }
}

function emptyTextError(ext: string): string {
  if (ext === 'pdf') {
    return '未从 PDF 中提取到可读文字。该文件可能是扫描件、图片型 PDF、转曲文字或缺少可还原文字映射，当前版本不会 OCR 识别图片文字，请上传文字层 PDF 或文本版文档。'
  }
  return '未从文档中提取到可读文字，文件可能为空、加密或内容为图片。'
}

function imageWarning(ext: string): string {
  if (ext === 'pdf') return '该 PDF 可能包含图片、扫描页、截图、盖章或照片；当前仅提取可读文字，图片内容不会进入会话上下文，也不会被向量化。'
  if (ext === 'docx' || ext === 'doc') return '该文档可能包含图片、截图或照片；当前仅提取文字内容，图片内容不会进入会话上下文，也不会被向量化。'
  if (ext === 'xlsx' || ext === 'xls') return '该表格可能包含图片；当前仅提取单元格文字，图片内容不会进入会话上下文，也不会被向量化。'
  if (ext === 'pptx') return '该 PPT 可能包含图片、图形或截图；当前仅提取每页文字（含演讲者备注），图片内容不会进入会话上下文，也不会被向量化。'
  if (ext === 'psd') return '该 PSD 可能包含位图、智能对象或剪贴内容；当前仅提取可读文字图层，图片内容不会进入会话上下文，也不会被向量化。'
  return '当前仅提取文字内容，图片内容不会进入会话上下文，也不会被向量化。'
}

function detectEmbeddedImages(buffer: Buffer, ext: string): { hasImages: boolean; imageCount?: number } {
  if (ext === 'pdf') {
    const sample = buffer.toString('latin1')
    const matches = sample.match(/\/Subtype\s*\/Image\b|\/Image\b/g)
    return { hasImages: !!matches?.length, imageCount: matches?.length || 0 }
  }
  if (ext === 'docx') {
    const sample = buffer.toString('latin1')
    const matches = sample.match(/word\/media\//g)
    return { hasImages: !!matches?.length, imageCount: matches?.length || 0 }
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const sample = buffer.toString('latin1')
    const matches = sample.match(/xl\/media\//g)
    return { hasImages: !!matches?.length, imageCount: matches?.length || 0 }
  }
  if (ext === 'pptx') {
    const sample = buffer.toString('latin1')
    const matches = sample.match(/ppt\/media\//g)
    return { hasImages: !!matches?.length, imageCount: matches?.length || 0 }
  }
  if (ext === 'psd') {
    // A PSD is an image container by definition.  The parser deliberately
    // skips raster data, so report this fact without attempting to decode it.
    return { hasImages: true, imageCount: 1 }
  }
  return { hasImages: ext === 'doc' }
}

function buildWarnings(ext: string, features: ParsedDocument['features']): string[] {
  return features?.hasImages ? [imageWarning(ext)] : []
}

function hasUsefulExtractedText(text: string, ext: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false
  if (ext !== 'pdf') return true
  const withoutPageMarkers = normalized
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '')
    .replace(/\s+/g, '')
  return withoutPageMarkers.length > 0
}

function getPdfParseOptions(): Record<string, any> {
  try {
    const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'))
    return {
      cMapUrl: pathToFileURL(`${join(pdfjsRoot, 'cmaps')}/`).href,
      cMapPacked: true,
      standardFontDataUrl: pathToFileURL(`${join(pdfjsRoot, 'standard_fonts')}/`).href,
      useSystemFonts: true,
      disableFontFace: false
    }
  } catch {
    return {}
  }
}

/**
 * 以下 4 个 Buffer 版本全部不依赖磁盘路径，供拖拽 / IPC 上传 / 安全沙箱场景使用。
 * - PDF / DOCX / XLSX 本身接受 Buffer
 * - DOC (word-extractor) 只接受路径，写临时文件兼容
 */
async function parsePdfBuffer(buffer: Buffer): Promise<{ text: string }> {
  // A PDF header may legally be preceded by a small binary comment, but it
  // must occur near the beginning of the file.  Rejecting obvious non-PDF
  // input keeps pdf.js from doing unnecessary work on malformed attachments.
  if (buffer.subarray(0, Math.min(buffer.length, 1024)).indexOf(Buffer.from('%PDF-', 'ascii')) < 0) {
    throw new Error('文件头不是有效 PDF')
  }
  // pdf-parse 默认入口在加载时会跑一段示例代码，直接 require 子模块绕过
  const options = getPdfParseOptions()
  try {
    const pdfParse = require('pdf-parse/lib/pdf-parse.js')
    const result = await pdfParse(buffer, options)
    return { text: String(result?.text || '') }
  } catch (legacyError) {
    const pdfParseModule = require('pdf-parse')

    const directParser = typeof pdfParseModule === 'function'
      ? pdfParseModule
      : typeof pdfParseModule.default === 'function'
        ? pdfParseModule.default
        : null
    if (directParser) {
      const result = await directParser(buffer, options)
      return { text: String(result?.text || '') }
    }
    if (typeof pdfParseModule.PDFParse === 'function') {
      const parser = new pdfParseModule.PDFParse({ data: buffer, ...options })

      try {
        const result = await parser.getText()
        return { text: String(result?.text || '') }
      } finally {
        await parser.destroy?.()
      }
    }
    throw legacyError
  }
}

async function parseDocxBuffer(buffer: Buffer): Promise<{ text: string }> {
  const mammoth = require('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  return { text: String(result?.value || '') }
}

async function parseDocBuffer(buffer: Buffer): Promise<{ text: string }> {
  // word-extractor 只能从路径读，使用私有临时目录并在 finally 中递归
  // 清理，避免并发解析时留下可被其他进程读取的临时文件。
  const tmpDir = mkdtempSync(join(tmpdir(), 'local-agent-doc-'))
  const tmpPath = join(tmpDir, 'input.doc')
  try {
    writeFileSync(tmpPath, buffer, { mode: 0o600 })
    const WordExtractor = require('word-extractor')
    const extractor = new WordExtractor()
    const doc = await extractor.extract(tmpPath)
    return { text: String(doc?.getBody?.() || '') }
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

async function validateZipContainer(buffer: Buffer): Promise<void> {
  const JSZip = require('jszip')
  const zip = await JSZip.loadAsync(buffer, { createFolders: false, checkCRC32: false })
  const files = Object.values(zip.files) as Array<any>
  if (files.length > MAX_ARCHIVE_ENTRIES) throw new Error('压缩文档条目过多，已拒绝解析')

  let totalUncompressed = 0
  for (const file of files) {
    if (file.dir) continue
    // JSZip sanitizes `name`; unsafeOriginalName preserves the archive's raw
    // value so traversal cannot be hidden by that normalization.
    const rawName = String(file.unsafeOriginalName ?? file.name ?? '')
    const normalized = rawName.replace(/\\/g, '/')
    if (
      !normalized ||
      normalized.startsWith('/') ||
      /^[a-z]:\//i.test(normalized) ||
      normalized.split('/').some((part: string) => part === '..') ||
      normalized.includes('\0')
    ) {
      throw new Error('压缩文档包含不安全的文件路径，已拒绝解析')
    }
    const metadata = file._data
    const compressedSize = Number(metadata?.compressedSize)
    const uncompressedSize = Number(metadata?.uncompressedSize)
    if (!Number.isFinite(compressedSize) || !Number.isFinite(uncompressedSize) || compressedSize < 0 || uncompressedSize < 0) {
      throw new Error('压缩文档尺寸元数据无效，已拒绝解析')
    }
    totalUncompressed += uncompressedSize
    if (totalUncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new Error('压缩文档展开后过大，已拒绝解析')
    }
    if (compressedSize > 0 && uncompressedSize / compressedSize > MAX_ARCHIVE_COMPRESSION_RATIO) {
      throw new Error('压缩文档压缩比异常，已拒绝解析')
    }
  }
}

function parsePsdBuffer(buffer: Buffer): { text: string; layerCount: number; textLayerCount: number } {
  const { readPsd } = require('ag-psd') as typeof import('ag-psd')
  const psd = readPsd(buffer, {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
    skipLinkedFilesData: true
  })
  const texts: string[] = []
  const names: string[] = []
  let layerCount = 0
  let textLayerCount = 0
  const pending = Array.isArray((psd as any).children) ? [...(psd as any).children] : []
  while (pending.length) {
    const layer = pending.pop()
    layerCount++
    if (layerCount > MAX_PSD_LAYERS) throw new Error('PSD 图层过多，已拒绝解析')
    const name = typeof layer?.name === 'string' ? layer.name.trim().slice(0, MAX_PSD_LAYER_TEXT_CHARS) : ''
    if (name) names.push(`图层：${name}`)
    const content = typeof layer?.text?.text === 'string'
      ? layer.text.text.trim().slice(0, MAX_PSD_LAYER_TEXT_CHARS)
      : ''
    if (content) {
      textLayerCount++
      texts.push(content)
    }
    if (Array.isArray(layer?.children)) pending.push(...layer.children)
  }
  const header = `PSD ${Number((psd as any).width) || 0}x${Number((psd as any).height) || 0}`
  const text = [header, ...names, ...texts].join('\n\n')
  return { text, layerCount, textLayerCount }
}

function parseXlsxBuffer(buffer: Buffer): { text: string } {
  const XLSX = require('xlsx')
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const parts: string[] = []
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue
    // CSV 化（保留单元格内容、丢弃格式），多 sheet 之间空行分隔
    const csv: string = XLSX.utils.sheet_to_csv(sheet)
    parts.push(`# ${sheetName}\n${csv}`)
  }
  return { text: parts.join('\n\n') }
}

/**
 * PPTX = zip + XML：按页读 ppt/slides/slideN.xml 抽 <a:t> 文本（<a:p> 段落边界换行），
 * 演讲者备注按同号 ppt/notesSlides/notesSlideN.xml 尽力配对（PowerPoint 实际编号与页一致）。
 * 全部页都无文字时返回空 text —— 交给上层走 NO_EXTRACTABLE_TEXT（纯图片型 PPT）。
 */
async function parsePptxBuffer(buffer: Buffer): Promise<{ text: string; slideCount: number }> {
  const JSZip = require('jszip')
  const zip = await JSZip.loadAsync(buffer)
  const numOf = (name: string): number => Number(name.match(/(\d+)\.xml$/)?.[1] || 0)
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => numOf(a) - numOf(b)) // 数字序：slide10 不能排在 slide2 前

  let anyText = false
  const pages: string[] = []
  for (const name of slideNames) {
    const xml = await zip.file(name)?.async('string')
    if (xml === undefined) continue
    const body = extractPptxText(xml)
    // 备注（演讲者注释）：同号 notesSlide，尽力而为，抽不到就跳过
    const notesXml = await zip.file(`ppt/notesSlides/notesSlide${numOf(name)}.xml`)?.async('string')
    const notes = notesXml ? extractPptxText(notesXml) : ''
    const parts = [`第 ${numOf(name)} 页：`]
    if (body) parts.push(body)
    if (notes) parts.push(`【备注】${notes}`)
    if (!body && !notes) parts.push('（本页无可见文字，可能为纯图片/图形页）')
    if (body || notes) anyText = true
    pages.push(parts.join('\n'))
  }
  return { text: anyText ? pages.join('\n\n') : '', slideCount: slideNames.length }
}

/** 抽一段 slide/notesSlide XML 的可见文字：<a:p> 分段、段内 <a:t> 串联，XML 实体解码 */
function extractPptxText(xml: string): string {
  // 先剔除域元素：页码/日期占位符（<a:fld type="slidenum"> 等）的当前值也写在 <a:t> 里，
  // 不剔除会把每页的页码数字误当正文/备注抽出来
  return xml
    .replace(/<a:fld[\s\S]*?<\/a:fld>/g, '')
    .split(/<a:p(?:\s[^>]*)?>/)
    .map((para) => (para.match(/<a:t>([\s\S]*?)<\/a:t>/g) || [])
      .map((r) => decodeXmlEntities(r.slice(5, -6)))
      .join(''))
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n')
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * 内部分发：按扩展名选对应解析器，都走 Buffer 路径。
 * 调用方（parseDocument / parseDocumentFromBuffer）负责 size / clamp / 错误包装。
 */
async function dispatchBuffer(
  buffer: Buffer,
  ext: string
): Promise<{ ok: boolean; text: string; parser: ParsedDocument['parser']; error?: string; errorCode?: ParsedDocument['errorCode']; features?: ParsedDocument['features']; warnings?: string[] }> {
  const imageInfo = detectEmbeddedImages(buffer, ext)
  const features: ParsedDocument['features'] = {
    hasImages: imageInfo.hasImages,
    imageCount: imageInfo.imageCount
  }
  try {
    if (ext === 'psd') {
      if (buffer.length < 26 || buffer.toString('ascii', 0, 4) !== '8BPS') {
        throw new Error('文件头不是有效 PSD')
      }
      const { text, layerCount, textLayerCount } = parsePsdBuffer(buffer)
      features.textLength = text.length
      features.layerCount = layerCount
      features.textLayerCount = textLayerCount
      return { ok: true, text, parser: 'psd', features, warnings: buildWarnings(ext, features) }
    }
    if (ext === 'pdf') {
      const { text } = await parsePdfBuffer(buffer)
      features.textLength = text.length
      return { ok: true, text, parser: 'pdf', features, warnings: buildWarnings(ext, features) }
    }
    if (ext === 'docx') {
      await validateZipContainer(buffer)
      const { text } = await parseDocxBuffer(buffer)
      features.textLength = text.length
      return { ok: true, text, parser: 'docx', features, warnings: buildWarnings(ext, features) }
    }
    if (ext === 'doc') {
      const { text } = await parseDocBuffer(buffer)
      features.textLength = text.length
      return { ok: true, text, parser: 'doc', features, warnings: buildWarnings(ext, features) }
    }
    if (ext === 'xlsx' || ext === 'xls') {
      if (ext === 'xlsx') await validateZipContainer(buffer)
      const { text } = parseXlsxBuffer(buffer)
      features.textLength = text.length
      return { ok: true, text, parser: 'xlsx', features, warnings: buildWarnings(ext, features) }
    }
    if (ext === 'pptx') {
      await validateZipContainer(buffer)
      const { text, slideCount } = await parsePptxBuffer(buffer)
      features.textLength = text.length
      features.pageCount = slideCount
      return { ok: true, text, parser: 'pptx', features, warnings: buildWarnings(ext, features) }
    }
    if (ext === 'ppt') {
      // 老二进制 OLE 格式无成熟 pure-JS 提取器，明确拒绝并引导转 pptx（比静默乱码体面）
      return { ok: false, text: '', parser: 'unsupported', error: '暂不支持旧版 .ppt 格式，请在 PowerPoint / WPS 中「另存为」.pptx 后再上传', errorCode: 'UNSUPPORTED_FORMAT', features }
    }
    return { ok: false, text: '', parser: 'unsupported', error: `不支持的二进制文档扩展名：${ext}`, errorCode: 'UNSUPPORTED_FORMAT', features }
  } catch (e: any) {
    return { ok: false, text: '', parser: 'error', error: `解析失败：${e?.message || String(e)}`, errorCode: 'PARSE_ERROR', features }
  }
}

/**
 * 主入口：根据扩展名分发到对应解析器，统一返回 ParsedDocument。
 * 本函数永不抛错（除非文件根本读不到 stat），错误以 ok=false 返回。
 */
export async function parseDocument(filePath: string): Promise<ParsedDocument> {
  let safePath: string
  try {
    safePath = validateDocumentPath(filePath)
  } catch (e) {
    return invalidPathResult(filePath, e)
  }
  const ext = normalizeExtension(extname(safePath).slice(1))
  let size = 0
  try {
    const link = lstatSync(safePath)
    if (link.isSymbolicLink()) {
      return {
        ok: false, text: '', ext, size: 0, parser: 'error',
        error: '拒绝解析符号链接文件，请选择实际文件', errorCode: 'INVALID_PATH'
      }
    }
    if (!link.isFile()) {
      return {
        ok: false, text: '', ext, size: 0, parser: 'error',
        error: '文档路径不是普通文件', errorCode: 'INVALID_PATH'
      }
    }
    size = link.size
  } catch (e: any) {
    return { ok: false, text: '', ext, size: 0, parser: 'error', error: `读取文件失败：${e?.message || e}`, errorCode: 'READ_ERROR' }
  }

  if (size > MAX_DOC_SIZE_BYTES) {
    return {
      ok: false, text: '', ext, size, parser: 'error',
      error: `文件过大（${(size / 1024 / 1024).toFixed(1)}MB），超过 50MB 限制`,
      errorCode: 'TOO_LARGE'
    }
  }

  let buffer: Buffer
  try {
    buffer = readFileSync(safePath)
  } catch (e: any) {
    return { ok: false, text: '', ext, size, parser: 'error', error: `读取文件失败：${e?.message || e}`, errorCode: 'READ_ERROR' }
  }
  // Re-check after reading to cover a file that grew between lstat and read.
  if (buffer.length > MAX_DOC_SIZE_BYTES) {
    return {
      ok: false, text: '', ext, size: buffer.length, parser: 'error',
      error: `文件过大（${(buffer.length / 1024 / 1024).toFixed(1)}MB），超过 50MB 限制`,
      errorCode: 'TOO_LARGE'
    }
  }
  const r = await dispatchBuffer(buffer, ext)
  if (!r.ok) {
    return { ok: false, text: '', ext, size, parser: r.parser, error: r.error, errorCode: r.errorCode, warnings: r.warnings, features: r.features }
  }
  if (!hasUsefulExtractedText(r.text, ext)) {
    const warnings = r.features?.hasImages ? buildWarnings(ext, r.features) : r.warnings
    return { ok: false, text: '', ext, size, parser: r.parser, error: emptyTextError(ext), errorCode: 'NO_EXTRACTABLE_TEXT', warnings, features: r.features }
  }
  const c = clamp(r.text)
  return { ok: true, text: c.text, ext, size, parser: r.parser, truncated: c.truncated, warnings: r.warnings, features: r.features }
}

/**
 * Buffer 版本：不走磁盘路径，供拖拽 / IPC 远程上传场景使用。
 * - 与 parseDocument 等价的返回结构，调用方可复用上层拼 prompt 逻辑
 * - size 取 buffer.length
 * - ext 由调用方从文件名提取（已 lower-case，不带点）
 */
export async function parseDocumentFromBuffer(buffer: Buffer, ext: string): Promise<ParsedDocument> {
  const normalizedExt = normalizeExtension(ext)
  const input = Buffer.isBuffer(buffer)
    ? buffer
    : buffer instanceof Uint8Array
      ? Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : null
  if (!input) {
    return {
      ok: false, text: '', ext: normalizedExt, size: 0, parser: 'error',
      error: '文档数据必须是 Buffer 或 Uint8Array', errorCode: 'READ_ERROR'
    }
  }
  const size = input.length
  if (size > MAX_DOC_SIZE_BYTES) {
    return {
      ok: false, text: '', ext: normalizedExt, size, parser: 'error',
      error: `文件过大（${(size / 1024 / 1024).toFixed(1)}MB），超过 50MB 限制`,
      errorCode: 'TOO_LARGE'
    }
  }
  const r = await dispatchBuffer(input, normalizedExt)
  if (!r.ok) {
    return { ok: false, text: '', ext: normalizedExt, size, parser: r.parser, error: r.error, errorCode: r.errorCode, warnings: r.warnings, features: r.features }
  }
  if (!hasUsefulExtractedText(r.text, normalizedExt)) {
    const warnings = r.features?.hasImages ? buildWarnings(normalizedExt, r.features) : r.warnings
    return { ok: false, text: '', ext: normalizedExt, size, parser: r.parser, error: emptyTextError(normalizedExt), errorCode: 'NO_EXTRACTABLE_TEXT', warnings, features: r.features }
  }
  const c = clamp(r.text)
  return { ok: true, text: c.text, ext: normalizedExt, size, parser: r.parser, truncated: c.truncated, warnings: r.warnings, features: r.features }
}

/**
 * 统一文件读取：对二进制办公文档走 parseDocument；其他扩展名 utf-8 直读。
 * 用于替换原来无差别 readFileSync(p, 'utf-8') 的位置。
 */
export async function readFileSmart(filePath: string): Promise<ParsedDocument> {
  let safePath: string
  try {
    safePath = validateDocumentPath(filePath)
  } catch (e) {
    return invalidPathResult(filePath, e)
  }
  const ext = normalizeExtension(extname(safePath).slice(1))
  if (BINARY_DOCUMENT_EXTENSIONS.has(ext)) {
    return parseDocument(safePath)
  }
  // 非二进制文档：utf-8 直读，统一返回 ParsedDocument 形态便于上层一致处理
  let size = 0
  try {
    const link = lstatSync(safePath)
    if (link.isSymbolicLink()) {
      return {
        ok: false, text: '', ext, size: 0, parser: 'error',
        error: '拒绝解析符号链接文件，请选择实际文件', errorCode: 'INVALID_PATH'
      }
    }
    if (!link.isFile()) {
      return {
        ok: false, text: '', ext, size: 0, parser: 'error',
        error: '文档路径不是普通文件', errorCode: 'INVALID_PATH'
      }
    }
    size = link.size
  } catch (e: any) {
    return { ok: false, text: '', ext, size: 0, parser: 'error', error: `读取文件失败：${e?.message || e}`, errorCode: 'READ_ERROR' }
  }
  if (size > MAX_DOC_SIZE_BYTES) {
    return {
      ok: false, text: '', ext, size, parser: 'error',
      error: `文件过大（${(size / 1024 / 1024).toFixed(1)}MB），超过 50MB 限制`,
      errorCode: 'TOO_LARGE'
    }
  }
  try {
    const raw = readFileSync(safePath, 'utf-8')
    if (Buffer.byteLength(raw, 'utf8') > MAX_DOC_SIZE_BYTES) {
      return {
        ok: false, text: '', ext, size: Buffer.byteLength(raw, 'utf8'), parser: 'error',
        error: `文件过大（${(Buffer.byteLength(raw, 'utf8') / 1024 / 1024).toFixed(1)}MB），超过 50MB 限制`,
        errorCode: 'TOO_LARGE'
      }
    }
    const c = clamp(raw)
    return { ok: true, text: c.text, ext, size, parser: 'utf8', truncated: c.truncated }
  } catch (e: any) {
    return { ok: false, text: '', ext, size, parser: 'error', error: `读取失败：${e?.message || e}`, errorCode: 'READ_ERROR' }
  }
}
