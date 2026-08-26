const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const JSZip = require('jszip')
const guard = require('./lib/skill-package-guard.cjs')

async function zipBytes(files) {
  const zip = new JSZip()
  for (const [name, body] of Object.entries(files)) zip.file(name, body)
  return zip.generateAsync({ type: 'nodebuffer' })
}

;(async () => {
  const ok = await zipBytes({ 'SKILL.md': '# Demo\n', 'skill.json': '{}' })
  const scanned = await guard.inspectSkillZipBuffer(JSZip, ok)
  assert.equal(scanned.ok, true)
  assert.equal(scanned.hasSkillMd, true)

  assert.equal(guard.isUnsafeName('../evil.txt'), true)
  assert.equal(guard.isUnsafeName('/tmp/x'), true)
  const trav = await zipBytes({ 'SKILL.md': '# x\n', 'nested/../../evil.txt': 'no' })
  const names = Object.keys((await JSZip.loadAsync(trav)).files)
  const unsafe = names.some((n) => guard.isUnsafeName(n))
  if (unsafe) {
    const bad = await guard.inspectSkillZipBuffer(JSZip, trav)
    assert.equal(bad.ok, false)
    assert.equal(bad.error, 'package_unsafe')
  }

  const many = {}
  many['SKILL.md'] = '# x\n'
  for (let i = 0; i < 90; i++) many['f' + i + '.txt'] = 'x'
  const tooMany = await guard.inspectSkillZipBuffer(JSZip, await zipBytes(many))
  assert.equal(tooMany.ok, false)

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-install-'))
  const staging = path.join(dir, '.staging', 'job')
  const finalDir = path.join(dir, 'demo')
  fs.mkdirSync(finalDir, { recursive: true })
  fs.writeFileSync(path.join(finalDir, 'SKILL.md'), 'old')
  fs.mkdirSync(staging, { recursive: true })
  fs.writeFileSync(path.join(staging, 'SKILL.md'), 'new')
  const backup = path.join(dir, '.trash', 'bak')
  fs.mkdirSync(path.dirname(backup), { recursive: true })
  fs.renameSync(finalDir, backup)
  try {
    throw new Error('interrupt')
  } catch {
    fs.renameSync(backup, finalDir)
  }
  assert.equal(fs.readFileSync(path.join(finalDir, 'SKILL.md'), 'utf8'), 'old')

  const src = fs.readFileSync(path.join(__dirname, '..', 'src/main/services/prompt-skill-installer.ts'), 'utf8')
  assert.match(src, /package_unsafe/)
  assert.match(src, /verifyCloudSignature/)
  assert.match(src, /atomicReplace/)
  assert.match(src, /origin: opts.requireSignature \? 'cloud' : 'local'/)

  console.log('skill package install guards passed')
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
