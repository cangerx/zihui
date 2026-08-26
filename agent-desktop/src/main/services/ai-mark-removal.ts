/**
 * 去AI标记（本地处理）主进程服务。
 *
 * 在「无损剥字节」能力（shared/strip-image-metadata）之上，提供：
 *  - 扫描一张图命中哪些标记类别、疑似来源厂商（不修改）；
 *  - 全量去除元数据/溯源标识（原地写回，不重编码、不动像素）；
 *  - 写回后在 image_generations / gallery_items 记录里置 ai_mark_removed=1，
 *    供 AI 生图/创作记录与图库缩略图展示「已处理」角标。
 *
 * 诚实边界：只能可靠清除元数据/溯源标识类标记；对 Google SynthID 等写进像素的
 * ML 鲁棒水印无能为力（本地无 GPU、无解码器）。
 */
import { readFile, writeFile, rename, unlink } from 'fs/promises'
import { getDatabase } from '../database'
import { getDataDir } from './data-path'
import { scanAiMarks, stripAiMarksBytes, markTypeLabel, type AiMarkType } from '@shared/strip-image-metadata'

export interface AiMarkScanResult {
  path: string
  format: 'jpeg' | 'png' | 'other'
  markTypes: AiMarkType[]
  markLabels: string[]
  vendors: string[]
  hasAny: boolean
}

export interface AiMarkProcessResult extends AiMarkScanResult {
  /** 是否实际写回了清理后的文件（有命中才写回） */
  removed: boolean
  error?: string
}

function toU8(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

/**
 * 把命中的图在 image_generations / gallery_items 记录里置 ai_mark_removed=1。
 *
 * 注意路径口径：picker 传来的是绝对路径，但 image_generations.result_path 存的是
 * 相对 dataDir 的正斜杠路径（见 image-generation.ts toRelativePath），gallery_items.file_path
 * 存的是绝对路径。故对两张表同时用「绝对 / 绝对正斜杠 / 相对」三种变体匹配，兼容各来源。
 */
function markRecords(absPath: string): void {
  try {
    const db = getDatabase()
    const dataDirFwd = getDataDir().replace(/\\/g, '/')
    const absFwd = absPath.replace(/\\/g, '/')
    const rel = absFwd.startsWith(dataDirFwd)
      ? absFwd.slice(dataDirFwd.length).replace(/^\/+/, '')
      : absFwd
    const keys = Array.from(new Set([absPath, absFwd, rel]))
    const ph = keys.map(() => '?').join(',')
    db.prepare(`UPDATE image_generations SET ai_mark_removed = 1 WHERE result_path IN (${ph})`).run(...keys)
    db.prepare(`UPDATE gallery_items SET ai_mark_removed = 1 WHERE file_path IN (${ph})`).run(...keys)
  } catch (e) {
    console.error('[ai-mark-removal] markRecords failed:', e)
  }
}

/** 仅扫描（不修改）：识别一张图命中哪些标记、疑似来源厂商 */
export async function scanFile(path: string): Promise<AiMarkScanResult> {
  const buf = await readFile(path)
  const scan = scanAiMarks(toU8(buf))
  return {
    path,
    format: scan.format,
    markTypes: scan.markTypes,
    markLabels: scan.markTypes.map(markTypeLabel),
    vendors: scan.vendors,
    hasAny: scan.hasAny,
  }
}

/** 批量扫描 */
export async function scanFiles(paths: string[]): Promise<AiMarkScanResult[]> {
  return Promise.all(paths.map((p) => scanFile(p)))
}

/**
 * 全量去除一张图的元数据/溯源标识（原地写回）。
 * 有命中才写回并打「已处理」标记；无命中原样返回 removed=false。
 */
export async function processFile(path: string): Promise<AiMarkProcessResult> {
  try {
    const buf = await readFile(path)
    const { bytes, scan } = stripAiMarksBytes(toU8(buf))
    let removed = false
    if (scan.hasAny) {
      // 原子替换：先写临时文件再 rename，避免写入中途崩溃/断电把原图截断损坏
      const tmp = `${path}.aimark.tmp`
      await writeFile(tmp, Buffer.from(bytes))
      try {
        await rename(tmp, path)
      } catch (e) {
        try { await unlink(tmp) } catch { /* 忽略清理失败 */ }
        throw e
      }
      removed = true
      markRecords(path)
    }
    return {
      path,
      format: scan.format,
      markTypes: scan.markTypes,
      markLabels: scan.markTypes.map(markTypeLabel),
      vendors: scan.vendors,
      hasAny: scan.hasAny,
      removed,
    }
  } catch (e: any) {
    return {
      path,
      format: 'other',
      markTypes: [],
      markLabels: [],
      vendors: [],
      hasAny: false,
      removed: false,
      error: e?.message || String(e),
    }
  }
}

/** 批量处理（串行，避免同一文件并发写） */
export async function processFiles(paths: string[]): Promise<AiMarkProcessResult[]> {
  const out: AiMarkProcessResult[] = []
  for (const p of paths) out.push(await processFile(p))
  return out
}

/** 按 image_generations.id 手动标记（供渲染层在已知记录 id 时补标） */
export function markGenerationRemoved(id: string): void {
  try {
    getDatabase().prepare('UPDATE image_generations SET ai_mark_removed = 1 WHERE id = ?').run(id)
  } catch (e) {
    console.error('[ai-mark-removal] markGenerationRemoved failed:', e)
  }
}
