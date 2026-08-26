// 声明式模板打包: 扫描 deck-templates-src/{组}/*.json → 逐套产 template.json + 算 SHA256 → 汇 manifest.json。
// 产物上传母 CDN your-cdn-domain.example.com/pptdemo/, 再到云控端「AI PPT 资源」逐条登记 + 一键拉取。
// 用法: node scripts/pack-deck-templates.mjs [--out <dir>] [--base <cdn-base-url>]
import { createHash } from 'crypto'
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'deck-templates-src')

function arg(name, def) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const OUT = resolve(arg('--out', join(ROOT, 'build/deck-templates-dist')))
const BASE = arg('--base', 'https://your-cdn-domain.example.com/pptdemo').replace(/\/$/, '')

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function listGroups() {
  if (!existsSync(SRC)) {
    console.error('源目录不存在:', SRC)
    process.exit(2)
  }
  return readdirSync(SRC).filter((d) => statSync(join(SRC, d)).isDirectory())
}

function main() {
  const templates = []
  let count = 0
  for (const group of listGroups()) {
    const dir = join(SRC, group)
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      const tpl = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      const id = tpl.id
      const version = String(tpl.version ?? '1')
      // 规范化序列化(稳定 SHA256): 与桌面端 JSON.parse 一致即可
      const body = Buffer.from(JSON.stringify(tpl), 'utf8')
      const hash = sha256(body)

      const pkgDir = join(OUT, id, version)
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(join(pkgDir, 'template.json'), body)

      templates.push({
        id,
        version,
        url: `${BASE}/${id}/${version}/template.json`,
        sha256: hash,
        size: body.length,
        name: tpl.name,
        category: tpl.category,
        description: tpl.description,
        schema: tpl.schema
      })
      count++
    }
  }
  templates.sort((a, b) => a.id.localeCompare(b.id))
  const manifest = { schema_version: 1, updated_at: new Date().toISOString(), templates }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))

  console.log(`打包完成: ${count} 套 → ${OUT}`)
  console.log(`manifest.json 含 ${templates.length} 条; CDN base = ${BASE}`)
  console.log('\n下一步:')
  console.log(`  1. 把 ${OUT} 下的 {id}/{version}/template.json 上传母 CDN ${BASE}/`)
  console.log('  2. 云控端「桌面端设置 → AI PPT 资源」逐条登记(kind=template, asset_key=id,')
  console.log('     source_url=对应 url, meta={name,category,description,schema})→「一键拉取」固化 SHA256')
  console.log('  3. 桌面端经 client/deck/resource-manifest?kind=template 自动可见、按需拉取 + 强校验')
}

main()
