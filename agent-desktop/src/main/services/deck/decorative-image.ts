import type { ThemeTokens } from './types'

// 生图不可用时的兜底配图: 自绘抽象装饰 SVG(主题色、纯色无渐变、克制专业), 比裂图/AI-slop 好。
// 不画具体物体(基元画不好"团队/办公"), 而是干净的几何抽象构成, 作 hero 背景/配图位。
// 由 prompt 派生确定性变化(同 prompt 同图), @resvg 栅格化为 PNG。

const W = 1280
const H = 720

/** prompt → 稳定 hash(无 Math.random, 同输入同输出) */
function hashOf(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function hexMix(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? parseInt(m[1]!, 16) : 0x2256d6
  let r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255
  if (amt >= 0) {
    r += (255 - r) * amt
    g += (255 - g) * amt
    b += (255 - b) * amt
  } else {
    const k = 1 + amt
    r *= k
    g *= k
    b *= k
  }
  const h = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** 自绘抽象装饰 SVG(主题色, 纯色无渐变) */
export function renderDecorativeSvg(seed: string, theme: ThemeTokens): string {
  const v = theme.vars
  const bg = v.bg ?? '#ffffff'
  const accent = v.accent ?? '#2256d6'
  const rule = v.rule ?? '#e6e8ec'
  const h = hashOf(seed)
  const variant = h % 3
  const c1 = accent
  const c2 = hexMix(accent, 0.4)
  const c3 = hexMix(accent, 0.7)

  let body = ''
  if (variant === 0) {
    // 同心弧 + 大圆(克制几何)
    const cx = 360 + (h % 200)
    const cy = 260 + ((h >> 4) % 200)
    body =
      `<circle cx="${cx}" cy="${cy}" r="200" fill="${c3}" fill-opacity="0.5"/>` +
      `<circle cx="${cx + 180}" cy="${cy + 140}" r="130" fill="${c2}" fill-opacity="0.6"/>` +
      `<circle cx="${cx + 60}" cy="${cy + 60}" r="70" fill="${c1}"/>` +
      `<rect x="80" y="${H - 120}" width="${W - 160}" height="6" fill="${accent}"/>`
  } else if (variant === 1) {
    // 斜向色块条带(出版物感)
    const off = h % 120
    body =
      `<rect x="${W - 520 - off}" y="-100" width="260" height="${H + 200}" fill="${c3}" transform="rotate(12 ${W / 2} ${H / 2})"/>` +
      `<rect x="${W - 300 + off}" y="-100" width="150" height="${H + 200}" fill="${c1}" transform="rotate(12 ${W / 2} ${H / 2})"/>` +
      `<circle cx="220" cy="200" r="90" fill="${c2}" fill-opacity="0.7"/>`
  } else {
    // 网格点阵 + 强调线(技术/数据感)
    let dots = ''
    for (let gy = 0; gy < 8; gy++) {
      for (let gx = 0; gx < 14; gx++) {
        const r = 4 + ((h >> (gx % 7)) & 3)
        dots += `<circle cx="${120 + gx * 80}" cy="${120 + gy * 70}" r="${r}" fill="${c2}" fill-opacity="0.6"/>`
      }
    }
    body = dots + `<rect x="80" y="${H / 2}" width="${W - 160}" height="8" fill="${accent}"/>`
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="${bg}"/>` +
    `<rect width="${W}" height="${H}" fill="none" stroke="${rule}" stroke-width="2"/>` +
    body +
    `</svg>`
  )
}

/** 自绘装饰图 → PNG Buffer(@resvg 栅格化, 2x 清晰度)。延迟 require @resvg。 */
export function renderDecorativePng(seed: string, theme: ThemeTokens): Buffer {
  const svg = renderDecorativeSvg(seed, theme)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Resvg } = require('@resvg/resvg-js') as typeof import('@resvg/resvg-js')
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: W * 2 } })
  return Buffer.from(resvg.render().asPng())
}
