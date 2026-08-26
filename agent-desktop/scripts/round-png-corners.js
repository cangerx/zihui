/**
 * 把 PNG 切成 App 风格圆角方（圆角约 22.37%），四角透明。
 * 给 Windows 窗口/安装包图标用：系统不会再切圆角，必须预烘焙。
 */
const fs = require('node:fs')
const { PNG } = require('pngjs')

const APP_RX_RATIO = 0.2237

function sdfRoundedRect(px, py, size, r) {
  const x = Math.abs(px - size / 2)
  const y = Math.abs(py - size / 2)
  const h = size / 2
  const dx = x - h + r
  const dy = y - h + r
  const ox = Math.max(dx, 0)
  const oy = Math.max(dy, 0)
  const inside = Math.min(Math.max(dx, dy), 0)
  return inside + Math.hypot(ox, oy) - r
}

function roundPngBuffer(buf) {
  const png = PNG.sync.read(buf)
  const size = Math.min(png.width, png.height)
  const r = size * APP_RX_RATIO
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (png.width * y + x) << 2
      const d = sdfRoundedRect(x + 0.5, y + 0.5, size, r)
      const a = Math.max(0, Math.min(1, 0.5 - d))
      png.data[i + 3] = Math.round(png.data[i + 3] * a)
    }
  }
  return PNG.sync.write(png)
}

function roundPngFile(srcPath, destPath = srcPath) {
  const out = roundPngBuffer(fs.readFileSync(srcPath))
  fs.writeFileSync(destPath, out)
  return out.length
}

module.exports = { roundPngBuffer, roundPngFile }

if (require.main === module) {
  const src = process.argv[2]
  const dest = process.argv[3] || src
  if (!src) {
    console.error('usage: node round-png-corners.js <src.png> [dest.png]')
    process.exit(1)
  }
  const n = roundPngFile(src, dest)
  console.log('wrote', dest, n)
}
