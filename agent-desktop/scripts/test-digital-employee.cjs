const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys=ON')
db.exec(fs.readFileSync(path.join(__dirname, '..', 'resources', 'schema.sql'), 'utf8'))

function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name)
}

assert(columns('bots').includes('skill_selection_mode'))
assert(columns('bots').includes('default_workspace_id'))
assert(columns('bots').includes('cloud_template_version'))
assert(columns('conversations').includes('workspace_id'))
for (const table of ['digital_employee_profiles', 'digital_employee_assets', 'digital_employee_asset_versions', 'digital_employee_candidates', 'digital_employee_task_runs']) {
  assert(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))
}

db.prepare("INSERT INTO bots(id,name,skill_selection_mode,created_at,updated_at) VALUES(?,?,?,?,?)")
  .run('bot-1', '视觉设计数字员工', 'selected', 'now', 'now')
db.prepare("INSERT INTO digital_employee_profiles(bot_id,role_summary,responsibilities_json,boundaries_json,standard_inputs_json,deliverables_json,revision) VALUES(?,?,?,?,?,?,?)")
  .run('bot-1', '负责视觉设计', '["制作主图"]', '["发布前确认"]', '["产品图"]', '["PNG"]', 1)

db.prepare("INSERT INTO digital_employee_assets(id,bot_id,workspace_id,asset_type,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
  .run('asset-1', 'bot-1', 'workspace-a', 'workflow', '商品主图流程', 'active', 'now', 'now')
db.prepare("INSERT INTO digital_employee_asset_versions(id,asset_id,version,body_json,source_type,confirmed_at,created_at) VALUES(?,?,?,?,?,?,?)")
  .run('version-1', 'asset-1', 1, '{"content":"先校验素材"}', 'user', 'now', 'now')
db.prepare("UPDATE digital_employee_assets SET current_version_id=? WHERE id=?").run('version-1', 'asset-1')

db.prepare("INSERT INTO digital_employee_candidates(id,bot_id,workspace_id,candidate_type,scope,title,body_json,evidence_json,fingerprint,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
  .run('candidate-1', 'bot-1', 'workspace-a', 'acceptance', 'workspace', '验收规则', '{"content":"尺寸必须一致"}', '{}', 'same-fingerprint', 'pending', 'now')
assert.throws(() => db.prepare("INSERT INTO digital_employee_candidates(id,bot_id,workspace_id,candidate_type,scope,title,body_json,evidence_json,fingerprint,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
  .run('candidate-2', 'bot-1', 'workspace-a', 'acceptance', 'workspace', '验收规则', '{}', '{}', 'same-fingerprint', 'pending', 'now'))

db.prepare("UPDATE digital_employee_candidates SET status='rejected' WHERE id='candidate-1'").run()
assert.throws(() => db.prepare("INSERT INTO digital_employee_candidates(id,bot_id,workspace_id,candidate_type,scope,title,body_json,evidence_json,fingerprint,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
  .run('candidate-3', 'bot-1', 'workspace-a', 'acceptance', 'workspace', '验收规则', '{}', '{}', 'same-fingerprint', 'pending', 'now'))

db.prepare("INSERT INTO digital_employee_task_runs(id,bot_id,conversation_id,workspace_id,goal,started_at) VALUES(?,?,?,?,?,?)")
  .run('task-1', 'bot-1', 'conversation-1', 'workspace-a', '制作商品主图', '2026-08-22T00:00:00.000Z')
db.prepare("UPDATE digital_employee_task_runs SET status='completed',duration_ms=1200,completed_at=? WHERE id=? AND status='running'")
  .run('2026-08-22T00:00:01.200Z', 'task-1')
assert.equal(db.prepare("SELECT status FROM digital_employee_task_runs WHERE id='task-1'").get().status, 'completed')

db.prepare("DELETE FROM bots WHERE id='bot-1'").run()
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM digital_employee_profiles").get().count, 0)
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM digital_employee_assets").get().count, 0)
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM digital_employee_candidates").get().count, 0)

db.close()
console.log('digital employee schema/state fixtures passed')
