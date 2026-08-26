import { join, extname } from 'path'
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { v4 as uuid } from 'uuid'
import { getDataDir } from './data-path'

// 智能体 2:3 形象图统一落盘目录：{dataDir}/bot-avatars/
// 渲染端通过 local-file://img?p=<abs> 协议读取（见 main/index.ts 协议注册）。
const SUBDIR = 'bot-avatars'
const ALLOWED = new Set(['png', 'jpg', 'jpeg', 'webp'])

function getAvatarDir(): string {
  const dir = join(getDataDir(), SUBDIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function extFromMime(mime: string): string {
  const v = (mime || '').toLowerCase()
  if (v.includes('png')) return 'png'
  if (v.includes('webp')) return 'webp'
  if (v.includes('jpeg') || v.includes('jpg')) return 'jpg'
  return ''
}

/** 该路径是否是本应用托管的形象图（删除/替换时只清理自己目录下的文件，避免误删用户原图） */
export function isManagedAvatar(p: string): boolean {
  if (!p) return false
  return p.replace(/\\/g, '/').toLowerCase().includes('/' + SUBDIR + '/')
}

/** 渲染端选图后以 data:URL 传入，落盘并返回绝对路径 */
export function saveAvatarFromDataUrl(dataUrl: string): string {
  const m = (dataUrl || '').match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i)
  if (!m) throw new Error('形象图格式无法解析（仅支持 PNG / JPEG / WEBP）')
  const ext = extFromMime(m[1]) || 'png'
  const buf = Buffer.from(m[2], 'base64')
  const file = join(getAvatarDir(), `${uuid()}.${ext}`)
  writeFileSync(file, buf)
  return file
}

/** 从市场云端 URL 下载形象图落盘，返回绝对路径；失败抛错由调用方降级 */
export async function downloadAvatarFromUrl(url: string): Promise<string> {
  if (!url) return ''
  const resp = await fetch(url, { method: 'GET' })
  if (!resp.ok) throw new Error(`下载形象图失败 HTTP ${resp.status}`)
  const ct = resp.headers.get('content-type') || ''
  let ext = extFromMime(ct)
  if (!ext) {
    const e = extname(url).slice(1).toLowerCase()
    ext = ALLOWED.has(e) ? (e === 'jpeg' ? 'jpg' : e) : 'png'
  }
  const buf = Buffer.from(await resp.arrayBuffer())
  const file = join(getAvatarDir(), `${uuid()}.${ext}`)
  writeFileSync(file, buf)
  return file
}

/** best-effort 删除托管形象图（bot 删除 / 替换形象时） */
export function deleteAvatarFile(p: string): void {
  try {
    if (p && isManagedAvatar(p) && existsSync(p)) unlinkSync(p)
  } catch {
    /* 忽略：孤儿文件不影响功能 */
  }
}
