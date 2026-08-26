/**
 * 从官方 H logo（build/logo-source.jpg）生成图标：
 * - build/icon.png：透明底圆角方（Windows 不会再切圆角，必须预烘焙）
 * - build/icon-appshape.png：同内容，给网页 favicon / 预览用
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

function sipsResize(src, dest, size) {
  execFileSync('sips', ['-z', String(size), String(size), src, '--out', dest], { stdio: 'inherit' })
  console.log('wrote', dest, fs.statSync(dest).size)
}

async function main() {
  const buildDir = path.join(__dirname, '..', 'build')
  const py = path.join(__dirname, 'logo-to-app-icon.py')
  const sourceJpg = path.join(buildDir, 'logo-source.jpg')
  const sourcePng = path.join(buildDir, 'logo-source.png')
  if (!fs.existsSync(sourceJpg)) {
    throw new Error(`缺少 ${sourceJpg}`)
  }
  execFileSync('sips', ['-s', 'format', 'png', sourceJpg, '--out', sourcePng], { stdio: 'inherit' })
  execFileSync(
    'python3',
    [py, sourcePng, path.join(buildDir, 'icon.png'), path.join(buildDir, 'icon-appshape.png')],
    { stdio: 'inherit' }
  )

  const roundPng = path.join(buildDir, 'icon-appshape.png')
  const squarePng = path.join(buildDir, 'icon.png')
  fs.copyFileSync(roundPng, squarePng)
  sipsResize(roundPng, path.join(buildDir, 'favicon.png'), 32)
  sipsResize(roundPng, path.join(buildDir, 'apple-touch-icon.png'), 180)

  const pngToIco = (await import('png-to-ico')).default
  const tmp48 = path.join(buildDir, '.tmp-ico-48.png')
  sipsResize(roundPng, tmp48, 48)
  const ico = await pngToIco([path.join(buildDir, 'favicon.png'), tmp48])
  const icoPath = path.join(buildDir, 'favicon.ico')
  fs.writeFileSync(icoPath, ico)
  fs.unlinkSync(tmp48)
  console.log('wrote', icoPath, ico.length)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
