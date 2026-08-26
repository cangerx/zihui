// 电商生图共用工具。

import type { UploadedImage } from './types'

let _seq = 0
/** 轻量唯一 id（任务/上传项用） */
export function uid(prefix = 'e'): string {
  _seq += 1
  return `${prefix}_${Date.now().toString(36)}_${_seq.toString(36)}`
}

/**
 * 本地图片路径 → 可直接用于 <img> 的 url。
 * 与项目各视图保持一致：受信协议原样返回；绝对路径用 p=，相对路径用 rel=。
 */
export function localFileUrl(path: string): string {
  if (!path) return ''
  if (/^(https?:|data:|file:|local-file:|blob:)/i.test(path)) return path
  const isAbsolute = /^[A-Za-z]:|^\//.test(path)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://img?' + param + '=' + encodeURIComponent(path.replace(/\\/g, '/'))
}

/**
 * File → UploadedImage（base64 dataURL）。
 * 为控制 IPC payload 体积，超过 maxEdge 的图会按比例缩放并转 JPEG。
 */
export function fileToUploadedImage(file: File, maxEdge = 1536): Promise<UploadedImage> {
  const name = file.name.replace(/\.[^.]+$/, '') || 'image'
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const src = String(reader.result || '')
      const img = new Image()
      img.onerror = () => resolve({ dataUrl: src, name }) // 解码失败则退回原始 dataURL
      img.onload = () => {
        const { width, height } = img
        const scale = Math.min(1, maxEdge / Math.max(width, height))
        if (scale >= 1) {
          resolve({ dataUrl: src, name })
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(width * scale)
        canvas.height = Math.round(height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve({ dataUrl: src, name })
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.9), name })
      }
      img.src = src
    }
    reader.readAsDataURL(file)
  })
}

/**
 * 解析 LLM 返回的"描述词数组"。
 * 兼容：纯 JSON 数组 / ```json 包裹 / 文中含 [...] / 按行回退。
 */
export function parsePromptList(raw: string, count: number): string[] {
  let s = (raw || '').trim()
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const tryParse = (text: string): string[] | null => {
    try {
      const a = JSON.parse(text)
      if (Array.isArray(a)) return a.map((x) => String(x).trim()).filter(Boolean)
    } catch {
      /* ignore */
    }
    return null
  }
  const direct = tryParse(s)
  if (direct) return direct.slice(0, count)
  const m = s.match(/\[[\s\S]*\]/)
  if (m) {
    const arr = tryParse(m[0])
    if (arr) return arr.slice(0, count)
  }
  const lines = s
    .split(/\n+/)
    .map((x) => x.replace(/^\s*(?:[-*]|\d+[.、)])\s*/, '').trim())
    .filter(Boolean)
  if (lines.length) return lines.slice(0, count)
  return s ? [s] : []
}
