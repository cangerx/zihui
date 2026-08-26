const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const esbuild = require('esbuild')

const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-ranking-bundle-'))
const bundlePath = path.join(bundleDir, 'kb-ranking.cjs')
try {
  esbuild.buildSync({
    entryPoints: [path.resolve(__dirname, '../src/main/services/kb-ranking.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    logLevel: 'silent'
  })
  const { reciprocalRankFusion } = require(bundlePath)
  const rows = reciprocalRankFusion([
    { name: 'vector', candidates: [{ id: 'semantic', value: 'semantic' }, { id: 'both', value: 'both' }] },
    { name: 'keyword', candidates: [{ id: 'exact', value: 'exact' }, { id: 'both', value: 'both' }] }
  ], 3)
  assert.equal(rows[0].id, 'both')
  assert.deepEqual(rows[0].channels.sort(), ['keyword', 'vector'])
  assert.equal(rows.length, 3)
  assert.equal(reciprocalRankFusion([], 5).length, 0)
  console.log('knowledge ranking RRF: OK')
} finally {
  fs.rmSync(bundleDir, { recursive: true, force: true })
}
