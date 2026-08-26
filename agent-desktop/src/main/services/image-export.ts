import { BrowserWindow, dialog } from 'electron'
import { writeFileSync, mkdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, basename } from 'path'

function parentWindow(event: Electron.IpcMainInvokeEvent) {
  return BrowserWindow.fromWebContents(event.sender)
}

export async function saveBufferWithDialog(
  event: Electron.IpcMainInvokeEvent,
  options: {
    defaultName: string
    filters: Array<{ name: string; extensions: string[] }>
    data: Uint8Array | number[] | string
    encoding?: 'utf8' | 'binary'
  }
): Promise<{ canceled: boolean; filePath?: string }> {
  const win = parentWindow(event)
  const picked = win
    ? await dialog.showSaveDialog(win, {
        defaultPath: options.defaultName,
        filters: options.filters
      })
    : await dialog.showSaveDialog({
        defaultPath: options.defaultName,
        filters: options.filters
      })
  if (picked.canceled || !picked.filePath) return { canceled: true }
  if (options.encoding === 'base64' && typeof options.data === 'string') {
    writeFileSync(picked.filePath, Buffer.from(options.data, 'base64'))
  } else if (typeof options.data === 'string') {
    writeFileSync(picked.filePath, options.data, { encoding: options.encoding === 'binary' ? undefined : 'utf8' })
  } else {
    writeFileSync(picked.filePath, Buffer.from(options.data))
  }
  return { canceled: false, filePath: picked.filePath }
}

export async function saveProjectWithDialog(
  event: Electron.IpcMainInvokeEvent,
  payload: {
    defaultName: string
    json: string
    assets: Array<{ filename: string; dataUrl: string }>
  }
): Promise<{ canceled: boolean; filePath?: string }> {
  const win = parentWindow(event)
  const picked = win
    ? await dialog.showSaveDialog(win, {
        defaultPath: payload.defaultName,
        filters: [{ name: '好伙伴图片工程', extensions: ['haohuoban-image.json'] }]
      })
    : await dialog.showSaveDialog({
        defaultPath: payload.defaultName,
        filters: [{ name: '好伙伴图片工程', extensions: ['haohuoban-image.json'] }]
      })
  if (picked.canceled || !picked.filePath) return { canceled: true }
  const jsonPath = picked.filePath.endsWith('.json')
    ? picked.filePath
    : `${picked.filePath}.haohuoban-image.json`
  const dir = dirname(jsonPath)
  const assetDir = join(dir, basename(jsonPath).replace(/\.json$/i, '') + '-assets')
  if (payload.assets.length) mkdirSync(assetDir, { recursive: true })
  const assetsWritten: Array<{ filename: string; path: string }> = []
  for (const asset of payload.assets) {
    const match = asset.dataUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) continue
    const buf = Buffer.from(match[2], 'base64')
    const filePath = join(assetDir, asset.filename)
    writeFileSync(filePath, buf)
    assetsWritten.push({ filename: asset.filename, path: filePath })
  }
  writeFileSync(jsonPath, payload.json, 'utf8')
  void assetsWritten
  return { canceled: false, filePath: jsonPath }
}

export function writeTempPngFromDataUrl(dataUrl: string): { path: string } {
  const match = String(dataUrl || '').match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/)
  if (!match) throw new Error('无效的图片数据')
  const dir = join(tmpdir(), 'haohuoban-image-edit')
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, `split-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`)
  writeFileSync(dest, Buffer.from(match[1], 'base64'))
  return { path: dest }
}

export async function openProjectWithDialog(
  event: Electron.IpcMainInvokeEvent
): Promise<{ canceled: boolean; filePath?: string; json?: string }> {
  const win = parentWindow(event)
  const picked = win
    ? await dialog.showOpenDialog(win, {
        filters: [{ name: '好伙伴图片工程', extensions: ['json'] }],
        properties: ['openFile']
      })
    : await dialog.showOpenDialog({
        filters: [{ name: '好伙伴图片工程', extensions: ['json'] }],
        properties: ['openFile']
      })
  if (picked.canceled || !picked.filePaths[0]) return { canceled: true }
  const filePath = picked.filePaths[0]
  const json = readFileSync(filePath, 'utf8')
  return { canceled: false, filePath, json }
}
