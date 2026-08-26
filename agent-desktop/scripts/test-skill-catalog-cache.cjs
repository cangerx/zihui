const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cache = require('./lib/skill-catalog-cache.cjs')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-cat-'))
const empty = cache.readCatalogCache(root)
assert.equal(empty.items.length, 0)

cache.writeCatalogCache(root, {
  cursor: '12',
  items: [{ skill_id: 's1', name: 'Demo', version_id: 'v1', origin: 'cloud' }],
  keys: [{ key_id: 'k1', public_key: 'abc' }],
})
const online = cache.readCatalogCache(root)
assert.equal(online.cursor, '12')
assert.equal(online.items.length, 1)

const merged = cache.mergeInstalledOrigin(online.items, {
  s1: { dirName: 'demo-skill', origin: 'cloud' },
})
assert.equal(merged[0].installed, true)
assert.equal(merged[0].origin, 'cloud')
assert.equal(merged[0].reviewed, true)

const src = fs.readFileSync(path.join(__dirname, '..', 'src/main/services/cloud-skill-catalog.ts'), 'utf8')
assert.match(src, /getCachedCloudSkillCatalog/)
assert.match(src, /origin: 'cloud'/)
assert.match(src, /offline: true/)

console.log('skill catalog cache fixtures passed')
