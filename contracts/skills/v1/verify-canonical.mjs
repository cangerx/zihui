import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const root = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(root, 'signature-payload.fixture.json'), 'utf8'))
const canonical = canonicalize(fixture)
const sha256 = createHash('sha256').update(canonical, 'utf8').digest('hex')
const expected = readFileSync(join(root, 'signature-payload.expected.txt'), 'utf8').trim().split('\n')

if (canonical !== expected[0] || sha256 !== expected[1]) {
  throw new Error(`canonical fixture mismatch\ncanonical=${canonical}\nsha256=${sha256}`)
}
console.log(`SKILL_CONTRACT_CANONICAL_OK ${sha256}`)
