'use strict'

const MAX_ZIP_BYTES = 8_000_000
const MAX_UNCOMPRESSED = 20_000_000
const MAX_FILES = 80
const MAX_RATIO = 100

function isUnsafeName(name) {
  const n = String(name || '').replace(/\\/g, '/')
  if (!n || n.startsWith('/') || n.includes('..') || n.includes('\0')) return true
  if (n.split('/').some((p) => p === '..' || p === '')) return true
  return false
}

/**
 * @param {import('jszip')} JSZip
 * @param {Buffer|Uint8Array} buf
 */
async function inspectSkillZipBuffer(JSZip, buf) {
  if (!buf || buf.length < 22 || buf.length > MAX_ZIP_BYTES) {
    return { ok: false, error: 'package_unsafe' }
  }
  const zip = await JSZip.loadAsync(buf, { checkCRC32: true })
  const allNames = Object.keys(zip.files)
  for (const name of allNames) {
    if (isUnsafeName(name.replace(/\/$/, ''))) return { ok: false, error: 'package_unsafe' }
  }
  const files = allNames.filter((name) => !zip.files[name].dir)
  if (files.length < 1 || files.length > MAX_FILES) {
    return { ok: false, error: 'package_unsafe' }
  }
  let uncompressed = 0
  const names = []
  for (const name of files) {
    if (isUnsafeName(name)) return { ok: false, error: 'package_unsafe' }
    const entry = zip.files[name]
    if (entry.unixPermissions && (entry.unixPermissions & 0o170000) === 0o120000) {
      return { ok: false, error: 'package_unsafe' }
    }
    const content = await entry.async('uint8array')
    uncompressed += content.length
    if (uncompressed > MAX_UNCOMPRESSED) return { ok: false, error: 'package_unsafe' }
    names.push(name.replace(/\\/g, '/'))
  }
  if (buf.length > 0 && uncompressed / buf.length > MAX_RATIO) {
    return { ok: false, error: 'package_unsafe' }
  }
  const hasSkillMd = names.includes('SKILL.md')
  const hasJson = names.includes('skill.json')
  return { ok: true, error: null, files: names, hasSkillMd, hasJson, uncompressed, packageSize: buf.length }
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']'
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}'
  }
  return JSON.stringify(value)
}

function signaturePayload(fields) {
  return canonicalize({
    key_id: fields.key_id,
    manifest_schema_version: 1,
    published_at: fields.published_at,
    sha256: fields.sha256,
    signature_algorithm: 'ed25519',
    skill_id: fields.skill_id,
    version: fields.version,
    version_id: fields.version_id,
  })
}

module.exports = {
  MAX_ZIP_BYTES,
  MAX_UNCOMPRESSED,
  MAX_FILES,
  MAX_RATIO,
  isUnsafeName,
  inspectSkillZipBuffer,
  canonicalize,
  signaturePayload,
}
