const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '../src/shared/json-extract.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText
const moduleUnderTest = { exports: {} }
new Function('module', 'exports', 'require', compiled)(
  moduleUnderTest,
  moduleUnderTest.exports,
  require
)

const { extractJson, tryExtractJson } = moduleUnderTest.exports

assert.deepEqual(extractJson('{"ok":true}', { expect: 'object' }), { ok: true })
assert.deepEqual(extractJson('```json\n{"ok":true}\n```', { expect: 'object' }), { ok: true })
assert.deepEqual(
  extractJson('<think>先分析</think>结果：{"text":"包含 } 字符","items":[1]}', { expect: 'object' }),
  { text: '包含 } 字符', items: [1] }
)
assert.deepEqual(
  extractJson('[analysis] 最终结果：{"ok":true}', { expect: 'object' }),
  { ok: true }
)
assert.deepEqual(extractJson('结果：[1,{"ok":true}]', { expect: 'array' }), [1, { ok: true }])
assert.throws(() => extractJson('[]', { expect: 'object' }), /期望 JSON 对象/)
assert.equal(tryExtractJson('不是 JSON', { expect: 'object' }), null)

console.log('json-extract: 7 assertions passed')
