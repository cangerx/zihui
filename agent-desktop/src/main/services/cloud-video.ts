import type { BrowserWindow } from 'electron'
import { dialog } from 'electron'
import { copyFileSync, createWriteStream, unlinkSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { getDataDir } from './data-path'

function safeFilename(name: string): string {
  const cleaned = String(name || '').replace(/[\\/:*?"<>|\r\n\t]+/g, '_').trim()
  return cleaned || `ai-video-${Date.now()}.mp4`
}

function ensureMp4(name: string): string {
  return /\.[a-z0-9]{2,8}$/i.test(name) ? name : `${name}.mp4`
}

export async function downloadRemoteVideo(url: string, defaultName = '', window?: BrowserWindow | null): Promise<{ success: boolean; path?: string; error?: string }> {
  if (!/^https?:\/\//i.test(url)) return { success: false, error: '无效的视频地址' }

  const options = {
    title: '保存视频',
    defaultPath: ensureMp4(safeFilename(defaultName)),
    filters: [
      { name: 'Video', extensions: ['mp4', 'mov', 'webm'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  }
  const picked = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  if (picked.canceled || !picked.filePath) return { success: false, error: '已取消' }

  const tempDir = join(getDataDir(), 'tmp')
  if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true })
  const tempPath = join(tempDir, `video-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)

  try {
    const res = await fetch(url)
    if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`)
    const targetDir = dirname(picked.filePath)
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tempPath))
    copyFileSync(tempPath, picked.filePath)
    try { unlinkSync(tempPath) } catch {}
    return { success: true, path: picked.filePath }
  } catch (e: any) {
    try { unlinkSync(tempPath) } catch {}
    return { success: false, error: e?.message || String(e) }
  }
}
