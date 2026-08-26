#!/usr/bin/env node
/**
 * 对 dist/ 里已打好的 mac zip 做 ad-hoc 临时签名后重打包，并刷新 latest-mac.yml 的 sha512/size。
 * electron-builder 把 identity=- 当成钥匙串证书名，本机无 Developer ID 时会跳过签名。
 */
const { execSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRequire } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')

function loadYaml() {
  try {
    return require('js-yaml')
  } catch (_) {
    const ebReq = createRequire(require.resolve('electron-builder/package.json'))
    return ebReq('js-yaml')
  }
}

function run(cmd, cwd) {
  execSync(cmd, { stdio: 'inherit', cwd })
}

function sha512Base64(file) {
  const hash = crypto.createHash('sha512')
  hash.update(fs.readFileSync(file))
  return hash.digest('base64')
}

function signZip(zipName) {
  const zipPath = path.join(DIST, zipName)
  if (!fs.existsSync(zipPath)) throw new Error(`missing ${zipPath}`)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'haohuoban-sign-'))
  try {
    run(`unzip -oq ${JSON.stringify(zipPath)} -d ${JSON.stringify(tmp)}`)
    const apps = []
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name)
        if (name.endsWith('.app') && fs.statSync(p).isDirectory()) apps.push(p)
        else if (fs.statSync(p).isDirectory() && name !== 'Contents') walk(p)
      }
    }
    walk(tmp)
    if (!apps.length) throw new Error(`${zipName} 内没有 .app`)
    for (const app of apps) {
      console.log(`signing ${app}`)
      execSync(`xattr -cr ${JSON.stringify(app)}`)
      execSync(`codesign --force --deep --sign - ${JSON.stringify(app)}`, { stdio: 'inherit' })
      execSync(`codesign -dv --verbose=2 ${JSON.stringify(app)}`, { stdio: 'inherit' })
    }
    const signedZip = `${zipPath}.signed`
    const top = fs.readdirSync(tmp)
    // 保持原 zip 根结构：通常是 Haohuoban.app
    fs.rmSync(signedZip, { force: true })
    run(`ditto -c -k --keepParent ${top.map((n) => JSON.stringify(n)).join(' ')} ${JSON.stringify(signedZip)}`, tmp)
    fs.renameSync(signedZip, zipPath)
    const blockmap = `${zipPath}.blockmap`
    if (fs.existsSync(blockmap)) fs.rmSync(blockmap)
    return {
      url: zipName,
      sha512: sha512Base64(zipPath),
      size: fs.statSync(zipPath).size
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

function main() {
  const zips = fs.readdirSync(DIST).filter((f) => f.endsWith('-mac.zip'))
  if (!zips.length) throw new Error('dist/ 没有 *-mac.zip')
  const files = zips.map(signZip)
  const ymlPath = path.join(DIST, 'latest-mac.yml')
  if (fs.existsSync(ymlPath)) {
    const YAML = loadYaml()
    const doc = YAML.load(fs.readFileSync(ymlPath, 'utf8')) || {}
    const byUrl = new Map(files.map((f) => [f.url, f]))
    doc.files = (doc.files || []).map((f) => {
      const next = byUrl.get(f.url)
      return next ? { ...f, sha512: next.sha512, size: next.size } : f
    })
    const arm = files.find((f) => f.url.includes('arm64')) || files[0]
    doc.path = arm.url
    doc.sha512 = arm.sha512
    fs.writeFileSync(ymlPath, YAML.dump(doc, { lineWidth: -1 }), 'utf8')
    console.log('\nupdated latest-mac.yml')
    console.log(fs.readFileSync(ymlPath, 'utf8'))
  }
  console.log('\nsigned zips:')
  for (const f of files) console.log(`  ${f.url}  ${f.size}  ${f.sha512.slice(0, 16)}…`)
}

main()
