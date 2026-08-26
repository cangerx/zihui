/**
 * 极简 base64 编码（仅用于 ASCII 的内联 SVG）
 * 小程序无 btoa，H5 有但为保持双端一致统一走这里。
 */
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function encodeBase64(input: string): string {
  let output = ''
  let i = 0
  while (i < input.length) {
    const c1 = input.charCodeAt(i++)
    const c2 = input.charCodeAt(i++)
    const c3 = input.charCodeAt(i++)
    const e1 = c1 >> 2
    const e2 = ((c1 & 3) << 4) | (Number.isNaN(c2) ? 0 : c2 >> 4)
    const e3 = Number.isNaN(c2) ? 64 : ((c2 & 15) << 2) | (Number.isNaN(c3) ? 0 : c3 >> 6)
    const e4 = Number.isNaN(c3) ? 64 : c3 & 63
    output += CHARS.charAt(e1) + CHARS.charAt(e2) + (e3 === 64 ? '=' : CHARS.charAt(e3)) + (e4 === 64 ? '=' : CHARS.charAt(e4))
  }
  return output
}

/** SVG 字符串 → 可用于 image src 的 data URI */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${encodeBase64(svg)}`
}
