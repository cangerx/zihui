const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const bindings = require('./lib/skill-bindings.cjs')

const migrated = bindings.migrateFromDirs(['local-a', 'local-b'])
assert.equal(migrated.length, 2)
assert.equal(migrated[0].source, 'local')

const mixed = [
  { source: 'cloud', skill_id: 's1', dir_name: 'cloud-s1', override_dir: 'local-fork' },
  { source: 'local', dir_name: 'local-a' },
  { source: 'cloud', skill_id: 'missing', dir_name: 'gone' },
]
const resolved = bindings.resolveEffectiveDirs(mixed, ['local-fork', 'local-a'])
assert.deepEqual(resolved, ['local-fork', 'local-a'])

const fromUi = bindings.bindingsFromSelected(['cloud-s1', 'local-a'], {
  'cloud-s1': { origin: 'cloud', skillId: 's1' },
  'local-a': { origin: 'local' },
})
assert.equal(fromUi[0].source, 'cloud')
assert.equal(fromUi[1].source, 'local')

const db = new DatabaseSync(':memory:')
db.exec(fs.readFileSync(path.join(__dirname, '..', 'resources', 'schema.sql'), 'utf8'))
assert(db.prepare("PRAGMA table_info(bots)").all().map((r) => r.name).includes('skill_bindings'))

db.prepare("INSERT INTO bots(id,name,prompt_skill_dirs,created_at,updated_at) VALUES(?,?,?,?,?)")
  .run('bot-1', 'demo', JSON.stringify(['old-dir']), 'now', 'now')
const row = db.prepare('SELECT skill_bindings FROM bots WHERE id=?').get('bot-1')
assert.equal(row.skill_bindings, '[]')

console.log('skill bindings fixtures passed')
