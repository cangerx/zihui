// 全量模板真渲染 QA: 逐套离屏渲染(用家族主题) + EXTRACT 抽取真实元素坐标,
// 断言每个元素矩形在画布内(捕捉 fast harness 查不出的"文字换行撑出画布"等 DOM 级溢出)。
// 须在真 electron 下跑(BrowserWindow): 见 package.json 脚本或手动 electron 启动。
import { app } from 'electron'
import { build } from 'esbuild'
import { tmpdir } from 'os'
import { join, resolve, dirname } from 'path'
import { readdirSync, readFileSync, statSync, mkdtempSync } from 'fs'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DECK = join(ROOT, 'src/main/services/deck')
const SRC = join(ROOT, 'deck-templates-src')

app.disableHardwareAcceleration()

async function loadApi() {
  const tmp = mkdtempSync(join(tmpdir(), 'deck-qa-'))
  const outfile = join(tmp, 'api.cjs')
  await build({
    stdin: {
      contents: `
        export { toSlideTemplate } from ${JSON.stringify(join(DECK, 'declarative.ts'))}
        export { renderSlideHtml } from ${JSON.stringify(join(DECK, 'html-ir.ts'))}
        export { themeById } from ${JSON.stringify(join(DECK, 'theme.ts'))}
        export { familyTheme, familyIdForCategory } from ${JSON.stringify(join(DECK, 'families.ts'))}
        export { OffscreenRenderer } from ${JSON.stringify(join(DECK, 'offscreen-renderer.ts'))}
      `,
      resolveDir: DECK,
      loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    external: ['electron', 'better-sqlite3', '@resvg/resvg-js', 'sqlite-vec'],
    alias: { '@shared': join(ROOT, 'src/shared') },
    logLevel: 'silent'
  })
  return require(outfile)
}

function allTemplates() {
  const out = []
  for (const g of readdirSync(SRC)) {
    const d = join(SRC, g)
    if (!statSync(d).isDirectory()) continue
    for (const f of readdirSync(d)) {
      if (f.endsWith('.json')) out.push(join(d, f))
    }
  }
  return out.sort()
}

const PAD = 6 // 容差 px(抗渲染舍入)
const MAXFILL = process.argv.includes('--maxfill') // 按 schema 上限填满(对抗测试: 模拟 LLM 填到 maxChars/maxItems)

// 按 schema 各字段上限生成最坏情况数据(CJK 最宽)。代表 validateAndClamp 截断后的极限内容。
function maxFillData(schema) {
  const data = {}
  for (const [k, f] of Object.entries(schema)) {
    if (f.type === 'text' || f.type === 'multiline') data[k] = '汉'.repeat(f.maxChars ?? 40)
    else if (f.type === 'list') data[k] = Array.from({ length: f.maxItems ?? 5 }, () => '条目'.repeat(Math.ceil((f.itemMaxChars ?? 20) / 2)))
    else if (f.type === 'stat-list')
      data[k] = Array.from({ length: f.maxItems ?? 4 }, () => ({
        value: '值'.repeat(f.statValueMaxChars ?? 8),
        label: '描述'.repeat(Math.ceil((f.statLabelMaxChars ?? 40) / 2))
      }))
    else if (f.type === 'enum') data[k] = (f.enumValues ?? [''])[0]
    else data[k] = '' // image
  }
  return data
}

async function main() {
  const api = await loadApi()
  const renderer = new api.OffscreenRenderer()
  const files = allTemplates()
  let clean = 0
  const issues = []
  console.log(MAXFILL ? '模式: 上限填满(对抗)' : '模式: 默认数据')
  for (const file of files) {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const tpl = api.toSlideTemplate(raw)
    const theme = api.themeById(api.familyTheme(api.familyIdForCategory(tpl.category)))
    const data = MAXFILL ? maxFillData(raw.schema) : tpl.defaultData
    const html = api.renderSlideHtml(tpl, data, theme)
    try {
      const ex = await renderer.renderExtract(html, { timeoutMs: 12000 })
      const els = ex.elements || []
      const overflow = els.filter(
        (e) => e.x < -PAD || e.y < -PAD || e.x + e.w > 1280 + PAD || e.y + e.h > 720 + PAD
      )
      if (els.length === 0) {
        issues.push(`${tpl.id}: 0 抽取元素(空白/渲染异常)`)
      } else if (overflow.length > 0) {
        const worst = overflow.map((e) => `(${Math.round(e.x)},${Math.round(e.y)} ${Math.round(e.w)}x${Math.round(e.h)})`).slice(0, 3).join(' ')
        issues.push(`${tpl.id}: ${overflow.length} 元素越界 ${worst}`)
      } else {
        clean++
      }
    } catch (e) {
      issues.push(`${tpl.id}: 渲染抛错 ${e.message}`)
    }
  }
  console.log(`\n==== 真渲染 QA: ${clean}/${files.length} 干净, ${issues.length} 有问题 ====`)
  for (const i of issues) console.log('  ⚠ ' + i)
  app.exit(issues.length === 0 ? 0 : 1)
}

app.whenReady().then(() =>
  main().catch((e) => {
    console.error('QA 异常:', e)
    app.exit(1)
  })
)
