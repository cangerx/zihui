// 从 preload 暴露的 runtimeConfig 派生品牌信息（生产由 inject 注入，dev fallback 默认）
const _runtime = (window as unknown as {
  runtimeConfig?: { appName?: string; iconDataUrl?: string }
}).runtimeConfig

export const appName = _runtime?.appName || '好伙伴'

/**
 * 应用图标 data URL（PNG → base64），由 main 进程启动时同步读 resources/icon.png 注入。
 * 空字符串表示未读到，渲染端应回退到 appAbbr 文字缩写。
 */
export const appIconUrl = _runtime?.iconDataUrl || ''

function deriveAbbr(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'LA'
  // 中文取前 2 字
  if (/^[\u4e00-\u9fa5]/.test(trimmed)) return trimmed.slice(0, 2)
  // 英文/数字取前 2 字母大写
  const ascii = trimmed.replace(/[^a-zA-Z0-9]/g, '')
  return (ascii.slice(0, 2) || 'LA').toUpperCase()
}

export const appAbbr = deriveAbbr(appName)
