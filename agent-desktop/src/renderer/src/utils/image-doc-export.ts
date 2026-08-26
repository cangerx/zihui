import { writePsd, initializeCanvas, type Layer } from 'ag-psd'
import type { ImageLayer } from '@shared/image-doc'

export interface RasterLayerPayload {
  layer: ImageLayer
  pngDataUrl: string
  text?: {
    content: string
    fontFamily: string
    fontSize: number
    fill: string
    left: number
    top: number
    width: number
    height: number
  }
}

function ensureBrowserCanvas() {
  if (typeof document === 'undefined') return
  initializeCanvas(
    (width, height) => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, width)
      canvas.height = Math.max(1, height)
      return canvas
    },
    undefined,
    (width, height) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('无法创建画布')
      return ctx.createImageData(Math.max(1, width), Math.max(1, height))
    }
  )
}

ensureBrowserCanvas()

function parseCssColor(input: string): { r: number; g: number; b: number } {
  const raw = (input || '#000000').trim()
  if (raw.startsWith('#')) {
    const hex = raw.slice(1)
    const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex
    const n = parseInt(full.slice(0, 6), 16)
    if (Number.isFinite(n)) {
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
    }
  }
  const m = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) }
  return { r: 0, g: 0, b: 0 }
}

async function dataUrlToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('图层图像无法解码'))
    img.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, img.naturalWidth || img.width || 1)
  canvas.height = Math.max(1, img.naturalHeight || img.height || 1)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.drawImage(img, 0, 0)
  return canvas
}

function fitCanvas(src: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  if (src.width === width && src.height === height) return src
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.drawImage(src, 0, 0)
  return canvas
}

function buildChildren(
  width: number,
  height: number,
  payloads: RasterLayerPayload[],
  canvases: HTMLCanvasElement[],
  includeText: boolean
): Layer[] {
  const children: Layer[] = []
  for (let i = 0; i < payloads.length; i++) {
    const item = payloads[i]
    const canvas = fitCanvas(canvases[i], width, height)
    const layer: Layer = {
      name: (item.layer.name || `图层 ${i + 1}`).slice(0, 200),
      hidden: !item.layer.visible,
      opacity: Math.max(0, Math.min(255, Math.round((item.layer.opacity / 100) * 255))),
      canvas,
      left: 0,
      top: 0,
      right: canvas.width,
      bottom: canvas.height
    }
    if (
      includeText &&
      item.text &&
      item.layer.type === 'text' &&
      (item.text.content || '').trim()
    ) {
      const color = parseCssColor(item.text.fill)
      layer.text = {
        text: item.text.content,
        transform: [1, 0, 0, 1, item.text.left, item.text.top],
        style: {
          font: { name: item.text.fontFamily && item.text.fontFamily !== 'sans-serif' ? item.text.fontFamily : 'Arial' },
          fontSize: item.text.fontSize || 16,
          fillColor: { r: color.r, g: color.g, b: color.b }
        }
      }
    }
    children.push(layer)
  }
  return children
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export async function buildPsdBuffer(
  width: number,
  height: number,
  payloads: RasterLayerPayload[]
): Promise<ArrayBuffer> {
  ensureBrowserCanvas()
  if (!(width > 0 && height > 0)) throw new Error('画布尺寸无效')
  if (!payloads.length) throw new Error('没有可导出的图层')

  const canvases: HTMLCanvasElement[] = []
  for (const item of payloads) {
    canvases.push(await dataUrlToCanvas(item.pngDataUrl))
  }

  const psdBase = { width, height }
  try {
    return writePsd({
      ...psdBase,
      children: buildChildren(width, height, payloads, canvases, true)
    })
  } catch {
    return writePsd({
      ...psdBase,
      children: buildChildren(width, height, payloads, canvases, false)
    })
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildHybridSvg(
  width: number,
  height: number,
  payloads: RasterLayerPayload[]
): string {
  const parts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  ]
  for (const item of payloads) {
    if (!item.layer.visible) continue
    const opacity = Math.max(0, Math.min(1, item.layer.opacity / 100))
    if (item.text && item.layer.type === 'text') {
      const fill = escapeXml(item.text.fill || '#000000')
      const family = escapeXml(item.text.fontFamily || 'sans-serif')
      const content = escapeXml(item.text.content)
      parts.push(
        `<text x="${item.text.left}" y="${item.text.top + item.text.fontSize}" font-family="${family}" font-size="${item.text.fontSize}" fill="${fill}" opacity="${opacity}">${content}</text>`
      )
    } else {
      parts.push(
        `<image href="${item.pngDataUrl}" x="0" y="0" width="${width}" height="${height}" opacity="${opacity}" />`
      )
    }
  }
  parts.push('</svg>')
  return parts.join('\n')
}
