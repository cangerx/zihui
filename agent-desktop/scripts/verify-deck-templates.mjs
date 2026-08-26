// 声明式模板验证 harness(快速, 纯 node): 对一个目录/文件下的 DeclarativeTemplate JSON 逐套校验。
// 校验项: JSON 合法 + 必填字段 + schema 合法 + defaultData 经 validateAndClamp + renderDeclarative 不抛错
//        + 渲染产物含 data-ir-root 且 ≥1 data-ir + 块引用字段都在 schema 内 + 静态 4 约束 lint(无渐变/文字块无背景边框阴影)。
// 用法: node scripts/verify-deck-templates.mjs <dir-or-file> [更多...]
import { build } from 'esbuild'
import { tmpdir } from 'os'
import { join, resolve, dirname, basename } from 'path'
import { readdirSync, readFileSync, statSync, mkdtempSync } from 'fs'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DECK = join(ROOT, 'src/main/services/deck')

async function loadApi() {
  const tmp = mkdtempSync(join(tmpdir(), 'deck-verify-'))
  const outfile = join(tmp, 'api.cjs')
  await build({
    stdin: {
      contents: `
        export { toSlideTemplate, renderDeclarative } from ${JSON.stringify(join(DECK, 'declarative.ts'))}
        export { validateAndClamp } from ${JSON.stringify(join(DECK, 'schema-validate.ts'))}
        export { themeById } from ${JSON.stringify(join(DECK, 'theme.ts'))}
      `,
      resolveDir: DECK,
      loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    logLevel: 'silent'
  })
  return require(outfile)
}

function collectFiles(args) {
  const files = []
  for (const a of args) {
    const p = resolve(a)
    const st = statSync(p)
    if (st.isDirectory()) {
      for (const f of readdirSync(p)) if (f.endsWith('.json')) files.push(join(p, f))
    } else if (p.endsWith('.json')) {
      files.push(p)
    }
  }
  return files.sort()
}

const BLOCK_KINDS = new Set([
  'bar', 'rule', 'kicker', 'heading', 'paragraph', 'list', 'numberedList', 'statGrid', 'bulletCards', 'quote', 'image'
])

function validateOne(api, file) {
  const errs = []
  let tpl
  try {
    tpl = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    return [`JSON 解析失败: ${e.message}`]
  }
  for (const k of ['id', 'name', 'category', 'description', 'schema', 'defaultData', 'blocks']) {
    if (tpl[k] === undefined) errs.push(`缺字段 ${k}`)
  }
  if (errs.length) return errs
  if (typeof tpl.id !== 'string' || !/^[a-z0-9-]+$/.test(tpl.id)) errs.push(`id 非法(须 kebab-case): ${tpl.id}`)
  if (!Array.isArray(tpl.blocks) || tpl.blocks.length === 0) errs.push('blocks 为空')

  // 块合法性 + 字段引用存在性 + 坐标在画布内
  for (let i = 0; i < (tpl.blocks || []).length; i++) {
    const b = tpl.blocks[i]
    if (!b || !BLOCK_KINDS.has(b.kind)) {
      errs.push(`block[${i}] kind 非法: ${b && b.kind}`)
      continue
    }
    if (!b.pos || typeof b.pos.x !== 'number' || typeof b.pos.y !== 'number' || typeof b.pos.w !== 'number') {
      errs.push(`block[${i}](${b.kind}) pos 非法`)
    } else {
      if (b.pos.x < 0 || b.pos.y < 0 || b.pos.x + b.pos.w > 1280) errs.push(`block[${i}](${b.kind}) 越界 x+w=${b.pos.x + b.pos.w}`)
      if (b.pos.h !== undefined && b.pos.y + b.pos.h > 720) errs.push(`block[${i}](${b.kind}) 越界 y+h=${b.pos.y + b.pos.h}`)
    }
    if (b.field !== undefined && tpl.schema[b.field] === undefined) {
      errs.push(`block[${i}](${b.kind}) 引用未定义字段 "${b.field}"`)
    }
  }

  // schema + defaultData 清洗
  let cleaned
  try {
    cleaned = api.validateAndClamp(tpl.schema, tpl.defaultData)
  } catch (e) {
    errs.push(`validateAndClamp 抛错: ${e.message}`)
  }

  // 渲染
  let html = ''
  try {
    const theme = api.themeById('editorial-serif')
    html = api.renderDeclarative(tpl, cleaned ? cleaned.data : tpl.defaultData, theme)
  } catch (e) {
    errs.push(`renderDeclarative 抛错: ${e.message}`)
    return errs
  }
  if (!html.includes('data-ir-root')) errs.push('渲染缺 data-ir-root')
  if ((html.match(/data-ir/g) || []).length < 2) errs.push('渲染 data-ir 标记过少(<1 元素)')

  // 静态 4 约束 lint
  if (/linear-gradient|radial-gradient/.test(html)) errs.push('违反约束: 出现 CSS 渐变')
  const textTagRe = /<(p|h1|h2)\b[^>]*style="([^"]*)"/g
  let m
  while ((m = textTagRe.exec(html))) {
    const style = m[2]
    if (/background(-image|-color)?\s*:/.test(style) || /\bborder\s*:/.test(style) || /box-shadow\s*:/.test(style)) {
      errs.push(`违反约束: 文字标签 <${m[1]}> 带 background/border/box-shadow`)
      break
    }
  }
  return errs
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('用法: node scripts/verify-deck-templates.mjs <dir-or-file> [...]')
    process.exit(2)
  }
  const api = await loadApi()
  const files = collectFiles(args)
  if (files.length === 0) {
    console.error('未找到 .json 模板')
    process.exit(2)
  }
  let pass = 0
  let fail = 0
  for (const f of files) {
    const errs = validateOne(api, f)
    if (errs.length === 0) {
      pass++
      console.log(`  PASS  ${basename(f)}`)
    } else {
      fail++
      console.log(`  FAIL  ${basename(f)}`)
      for (const e of errs) console.log(`        - ${e}`)
    }
  }
  console.log(`\n==== ${pass} 通过 / ${fail} 失败 / 共 ${files.length} ====`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('harness 异常:', e)
  process.exit(1)
})
