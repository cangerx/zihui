const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const esbuild = require('esbuild')

async function main() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-scanner-fixture-'))
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-scanner-bundle-'))
  const bundlePath = path.join(bundleDir, 'kb-scanner.cjs')
  try {
    fs.mkdirSync(path.join(fixture, 'docs'), { recursive: true })
    fs.mkdirSync(path.join(fixture, 'node_modules', 'ignored-package'), { recursive: true })
    fs.writeFileSync(path.join(fixture, 'docs', '规范.md'), '# 品牌规范\n主色 #16423C')
    fs.writeFileSync(path.join(fixture, 'docs', '数据.xlsx'), 'fixture')
    fs.writeFileSync(path.join(fixture, 'docs', '图片.png'), 'fixture')
    fs.writeFileSync(path.join(fixture, '.env'), 'TOKEN=secret')
    fs.writeFileSync(path.join(fixture, 'node_modules', 'ignored-package', 'README.md'), 'ignored')
    fs.writeFileSync(path.join(fixture, 'docs', '过大.txt'), 'x'.repeat(100))

    esbuild.buildSync({
      entryPoints: [path.resolve(__dirname, '../src/main/services/kb-scanner.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: bundlePath,
      logLevel: 'silent'
    })
    const { scanKnowledgeFolder } = require(bundlePath)
    const result = await scanKnowledgeFolder(fixture, { maxFileBytes: 32, maxTotalBytes: 1024 })

    assert.equal(result.counts.supported, 2)
    assert.equal(result.counts.oversized, 1)
    assert.equal(result.counts.ignored, 2)
    assert.equal(result.counts.inaccessible, 0)
    assert.equal(result.truncated, false)
    assert.equal(result.files.some((item) => item.relativePath.includes('node_modules')), false)
    assert.equal(result.files.some((item) => item.relativePath === '.env' && item.reason.includes('敏感')), true)
    console.log('knowledge folder scanner: OK')
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
    fs.rmSync(bundleDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
