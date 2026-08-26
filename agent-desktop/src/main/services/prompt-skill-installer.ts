import { createHash, createPublicKey, verify as verifySig } from 'crypto'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import JSZip from 'jszip'
import { getDataDir } from './data-path'

const MAX_ZIP_BYTES = 8_000_000
const MAX_UNCOMPRESSED = 20_000_000
const MAX_FILES = 80
const MAX_RATIO = 100

export type InstallOrigin = 'official' | 'local' | 'cloud'

export interface CloudInstallProof {
  skillId: string
  versionId: string
  version: string
  sha256: string
  signature: string
  keyId: string
  publishedAt: string
  publicKeys: Array<{ key_id: string; public_key: string }>
}

function isUnsafeName(name: string): boolean {
  const n = String(name || '').replace(/\\/g, '/')
  if (!n || n.startsWith('/') || n.includes('..') || n.includes('\0')) return true
  return n.split('/').some((p) => p === '..' || p === '')
}

export async function inspectSkillZipBuffer(buf: Uint8Array): Promise<{
  ok: boolean
  error?: string
  files?: string[]
  hasSkillMd?: boolean
  hasJson?: boolean
}> {
  if (!buf || buf.length < 22 || buf.length > MAX_ZIP_BYTES) {
    return { ok: false, error: 'package_unsafe' }
  }
  const zip = await JSZip.loadAsync(buf)
  const allNames = Object.keys(zip.files)
  for (const name of allNames) {
    if (isUnsafeName(name.replace(/\/$/, ''))) return { ok: false, error: 'package_unsafe' }
  }
  const files = allNames.filter((name) => !zip.files[name].dir)
  if (files.length < 1 || files.length > MAX_FILES) {
    return { ok: false, error: 'package_unsafe' }
  }
  let uncompressed = 0
  const names: string[] = []
  for (const name of files) {
    if (isUnsafeName(name)) return { ok: false, error: 'package_unsafe' }
    const entry = zip.files[name] as JSZip.JSZipObject & { unixPermissions?: number }
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
  return {
    ok: true,
    files: names,
    hasSkillMd: names.includes('SKILL.md'),
    hasJson: names.includes('skill.json'),
  }
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']'
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize((value as Record<string, unknown>)[k])).join(',') + '}'
  }
  return JSON.stringify(value)
}

export function verifyCloudSignature(proof: CloudInstallProof, digest: string): boolean {
  if (proof.sha256 !== digest) return false
  const payload = canonicalize({
    key_id: proof.keyId,
    manifest_schema_version: 1,
    published_at: proof.publishedAt,
    sha256: proof.sha256,
    signature_algorithm: 'ed25519',
    skill_id: proof.skillId,
    version: proof.version,
    version_id: proof.versionId,
  })
  const keyRow = (proof.publicKeys || []).find((k) => k.key_id === proof.keyId)
  if (!keyRow?.public_key) return false
  try {
    const raw = Buffer.from(keyRow.public_key, 'base64')
    const key = createPublicKey({ key: raw, format: 'raw', type: 'ed25519' })
    return verifySig(null, Buffer.from(payload), key, Buffer.from(proof.signature, 'base64'))
  } catch {
    return false
  }
}

async function extractZipTo(buf: Uint8Array, destDir: string): Promise<void> {
  const zip = await JSZip.loadAsync(buf)
  mkdirSync(destDir, { recursive: true })
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name]
    const rel = name.replace(/\\/g, '/')
    if (isUnsafeName(rel) && !entry.dir) throw new Error('package_unsafe')
    const target = join(destDir, ...rel.split('/'))
    if (entry.dir) {
      mkdirSync(target, { recursive: true })
      continue
    }
    mkdirSync(join(target, '..'), { recursive: true })
    const data = await entry.async('nodebuffer')
    writeFileSync(target, data)
  }
}

function copyDirSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '..' || entry.name === '.') continue
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isSymbolicLink()) throw new Error('package_unsafe')
    if (entry.isDirectory()) copyDirSync(srcPath, destPath)
    else writeFileSync(destPath, readFileSync(srcPath))
  }
}

function atomicReplace(staging: string, finalDir: string): void {
  const parent = join(finalDir, '..')
  const trashRoot = join(parent, '.trash')
  mkdirSync(trashRoot, { recursive: true })
  const backup = join(trashRoot, `${Date.now()}-${Math.random().toString(16).slice(2)}`)
  try {
    if (existsSync(finalDir)) renameSync(finalDir, backup)
    renameSync(staging, finalDir)
    try { rmSync(backup, { recursive: true, force: true }) } catch { /* keep old on trash cleanup fail */ }
  } catch (err) {
    if (existsSync(backup) && !existsSync(finalDir)) {
      try { renameSync(backup, finalDir) } catch { /* ignore */ }
    }
    throw err
  }
}

export async function installSkillPackage(opts: {
  sourcePath?: string
  zipBuffer?: Uint8Array
  requireSignature?: boolean
  proof?: CloudInstallProof
  preferredDirName?: string
}): Promise<{ success: boolean; name?: string; dirName?: string; error?: string }> {
  const destRoot = join(getDataDir(), 'skills')
  mkdirSync(destRoot, { recursive: true })
  const stagingRoot = join(destRoot, '.staging')
  mkdirSync(stagingRoot, { recursive: true })
  const staging = join(stagingRoot, `job-${Date.now()}`)
  try {
    if (opts.zipBuffer || (opts.sourcePath && opts.sourcePath.toLowerCase().endsWith('.zip'))) {
      const buf = opts.zipBuffer || new Uint8Array(readFileSync(opts.sourcePath!))
      const digest = createHash('sha256').update(buf).digest('hex')
      const inspected = await inspectSkillZipBuffer(buf)
      if (!inspected.ok) return { success: false, error: inspected.error }
      if (!inspected.hasSkillMd) return { success: false, error: '未找到 SKILL.md' }
      if (opts.requireSignature) {
        if (!inspected.hasJson) return { success: false, error: 'manifest_invalid' }
        if (!opts.proof || !verifyCloudSignature(opts.proof, digest)) {
          return { success: false, error: 'signature_invalid' }
        }
      }
      await extractZipTo(buf, staging)
    } else if (opts.sourcePath) {
      const st = statSync(opts.sourcePath)
      mkdirSync(staging, { recursive: true })
      if (st.isFile() && /\.md$/i.test(opts.sourcePath)) {
        writeFileSync(join(staging, 'SKILL.md'), readFileSync(opts.sourcePath))
      } else if (st.isDirectory()) {
        copyDirSync(opts.sourcePath, staging)
      } else {
        return { success: false, error: '请选择包含 SKILL.md 的文件夹、zip 或 markdown 文件' }
      }
    } else {
      return { success: false, error: '文件不存在' }
    }

    const { parseFrontmatter, uniqueSkillDirName, touchSkillMeta } = await import('./prompt-skill')
    const skillMd = join(staging, 'SKILL.md')
    if (!existsSync(skillMd)) return { success: false, error: '未找到 SKILL.md' }
    const fm = parseFrontmatter(readFileSync(skillMd, 'utf-8'))
    const skillName = fm.name || opts.proof?.skillId || 'unknown-skill'
    const existing = new Set(
      readdirSync(destRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('_') && e.name !== '.staging' && e.name !== '.trash')
        .map((e) => e.name)
    )
    const dirName = opts.preferredDirName && existing.has(opts.preferredDirName)
      ? opts.preferredDirName
      : opts.preferredDirName && !existing.has(opts.preferredDirName)
        ? opts.preferredDirName
        : uniqueSkillDirName(skillName, existing)
    const finalDir = join(destRoot, dirName)
    atomicReplace(staging, finalDir)
    touchSkillMeta(dirName, {
      enabled: true,
      origin: opts.requireSignature ? 'cloud' : 'local',
      reviewed: !!opts.requireSignature,
      skillId: opts.proof?.skillId,
      versionId: opts.proof?.versionId,
      sha256: opts.proof?.sha256,
    })
    return { success: true, name: skillName, dirName }
  } catch (err: any) {
    try { rmSync(staging, { recursive: true, force: true }) } catch { /* ignore */ }
    return { success: false, error: err?.message || String(err) }
  }
}

export async function installSkillFromLocal(sourcePath: string): Promise<{ success: boolean; name?: string; error?: string }> {
  if (!sourcePath || !existsSync(sourcePath)) {
    return { success: false, error: '文件不存在' }
  }
  const destRoot = join(getDataDir(), 'skills')
  const resolved = sourcePath.replace(/\\/g, '/')
  if (resolved.startsWith(destRoot.replace(/\\/g, '/') + '/')) {
    return { success: false, error: '该技能已在技能库中' }
  }
  return installSkillPackage({ sourcePath, requireSignature: false })
}
