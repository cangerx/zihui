import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'fs'
import { v4 as uuid } from 'uuid'
import { app } from 'electron'
import { getDataDir } from './data-path'

export interface PromptSkill {
  id: string
  name: string
  description: string
  dirName: string
  enabled: boolean
  category: string
  origin: 'official' | 'local' | 'cloud'
  reviewed: boolean
  skillId?: string
  versionId?: string
  version?: string
}

interface SkillMeta {
  name: string
  description: string
  version: string
  category: string
  nameZh: string
}

interface SkillRecordMeta {
  id: string
  enabled: boolean
  displayName?: string
  /** 用户主动删除后，内置技能下次启动不再拷回 */
  removed?: boolean
  origin?: 'official' | 'local' | 'cloud'
  reviewed?: boolean
  skillId?: string
  versionId?: string
  sha256?: string
}

function hasCjk(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text || '')
}

function stripYamlScalar(val: string): string {
  const t = (val || '').trim()
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    return t.slice(1, -1).trim()
  }
  return t
}

function extractMarkdownTitle(content: string): string {
  const body = (content || '').replace(/^---\s*\n[\s\S]*?\n---\s*/, '')
  const m = body.match(/^#\s+(.+)$/m)
  return m ? m[1].replace(/[#*_`]/g, '').trim() : ''
}

function pickDisplayName(
  fm: SkillMeta,
  content: string,
  dirName: string,
  metaDisplay?: string
): string {
  const fromMeta = (metaDisplay || '').trim()
  if (fromMeta) return fromMeta
  const zh = (fm.nameZh || '').trim()
  if (zh) return zh
  if (fm.name && hasCjk(fm.name)) return fm.name
  const h1 = extractMarkdownTitle(content)
  if (h1 && hasCjk(h1)) return h1
  return fm.name || dirName
}

const CATEGORY_INFER: Array<{ label: string; re: RegExp }> = [
  { label: '开发工具', re: /开发|代码|git|python|api|cli|终端|脚本|项目初始化|编程|前端|后端/i },
  { label: '文档助手', re: /文档|markdown|写作|网页转|抓取|阅读/i },
  { label: '数据分析', re: /数据|分析|报表|统计|招投标|量化/i },
  { label: '自动化', re: /自动化|定时|部署|工作流|汇报/i },
  { label: '设计创意', re: /设计|创意|ppt|幻灯片|配色|排版/i },
  { label: '公文格式化', re: /公文|格式化/i },
  { label: '视频生成', re: /视频|分镜|短视频/i },
  { label: '图像处理', re: /图像|图片|海报|小红书|infographic/i },
  { label: '邮件', re: /邮件|mailbox|mail/i }
]

export function inferSkillCategory(name: string, description: string): string {
  const text = `${name || ''} ${description || ''}`
  for (const row of CATEGORY_INFER) {
    if (row.re.test(text)) return row.label
  }
  return '其他'
}

let bundledCopied = false

function getSkillsDir(): string {
  const dir = join(getDataDir(), 'skills')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  if (!bundledCopied) {
    bundledCopied = true
    copyBundledSkills(dir)
  }
  return dir
}

function getBundledSkillsDir(): string {
  const isProd = app.isPackaged
  return isProd
    ? join(process.resourcesPath, 'bundled-skills')
    : join(__dirname, '../../resources/bundled-skills')
}

const SKIP_DIRS = new Set(['__pycache__', 'node_modules', '.git'])

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        copyDirRecursive(srcPath, destPath)
      }
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

function extractVersion(skillDir: string): string {
  const skillMd = join(skillDir, 'SKILL.md')
  if (!existsSync(skillMd)) return '0.0.0'
  try {
    const content = readFileSync(skillMd, 'utf-8')
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
    if (!match) return '0.0.0'
    const verMatch = match[1].match(/^version:\s*["']?([^"'\n]+)["']?$/m)
    return verMatch ? verMatch[1].trim() : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na !== nb) return na - nb
  }
  return 0
}

function loadRemovedSkillDirs(skillsDir: string): Set<string> {
  const removed = new Set<string>()
  try {
    const metaPath = join(skillsDir, '_meta.json')
    if (!existsSync(metaPath)) return removed
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as Record<string, SkillRecordMeta>
    for (const [key, rec] of Object.entries(meta || {})) {
      if (rec?.removed) removed.add(key)
    }
  } catch { /* ignore */ }
  return removed
}

function copyBundledSkills(skillsDir: string): void {
  try {
    const bundledDir = getBundledSkillsDir()
    if (!existsSync(bundledDir)) return
    const removed = loadRemovedSkillDirs(skillsDir)
    for (const entry of readdirSync(bundledDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (removed.has(entry.name)) continue
      const srcDir = join(bundledDir, entry.name)
      const targetDir = join(skillsDir, entry.name)
      if (!existsSync(targetDir)) {
        copyDirRecursive(srcDir, targetDir)
      } else {
        const bundledVer = extractVersion(srcDir)
        const installedVer = extractVersion(targetDir)
        if (compareVersions(bundledVer, installedVer) > 0) {
          rmSync(targetDir, { recursive: true, force: true })
          copyDirRecursive(srcDir, targetDir)
        }
      }
    }
  } catch (e) {
    console.error('Failed to copy bundled skills:', e)
  }
}

function getMetaPath(): string {
  return join(getSkillsDir(), '_meta.json')
}

function loadMeta(): Record<string, SkillRecordMeta> {
  const p = getMetaPath()
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return {}
  }
}

function saveMeta(meta: Record<string, SkillRecordMeta>): void {
  writeFileSync(getMetaPath(), JSON.stringify(meta, null, 2), 'utf-8')
}

export function touchSkillMeta(dirName: string, patch: Partial<SkillRecordMeta>): void {
  const meta = loadMeta()
  const cur = meta[dirName] || { id: uuid(), enabled: true }
  meta[dirName] = { ...cur, ...patch, id: patch.id || cur.id, removed: false }
  saveMeta(meta)
}

export function slugifySkillDir(name: string): string {
  const ascii = (name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return ascii || 'skill'
}

export function uniqueSkillDirName(name: string, existing: Set<string>): string {
  const base = slugifySkillDir(name)
  if (!existing.has(base)) return base
  let n = 2
  while (existing.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

function existingSkillDirs(): Set<string> {
  const dir = getSkillsDir()
  return new Set(
    readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
      .map((e) => e.name)
  )
}

export function parseFrontmatter(content: string): SkillMeta {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return { name: '', description: '', version: '', category: '', nameZh: '' }
  const fm = match[1]
  const nameMatch = fm.match(/^name:\s*(.+)$/m)
  const nameZhMatch =
    fm.match(/^name_zh:\s*(.+)$/m) ||
    fm.match(/^name-zh:\s*(.+)$/m) ||
    fm.match(/^display_name:\s*(.+)$/m) ||
    fm.match(/^displayName:\s*(.+)$/m)
  const descMatch = fm.match(/^description:\s*(.*)$/m)
  let description = ''
  if (descMatch) {
    const val = descMatch[1].trim()
    if (val === '>' || val === '|' || val === '>-' || val === '|-') {
      // YAML multiline: collect indented continuation lines
      const startIdx = fm.indexOf(descMatch[0]) + descMatch[0].length
      const rest = fm.slice(startIdx)
      const lines = rest.split('\n')
      const parts: string[] = []
      let started = false
      for (const line of lines) {
        if (!started && line.trim() === '') {
          continue
        }
        if (/^\s+\S/.test(line)) {
          started = true
          parts.push(line.trim())
        } else {
          break
        }
      }
      description = parts.join(' ')
    } else {
      description = stripYamlScalar(val)
    }
  }
  const versionMatch = fm.match(/^version:\s*["']?([^"'\n]+)["']?$/m)
  const categoryMatch = fm.match(/^category:\s*["']?([^"'\n]+)["']?$/m)
  return {
    name: nameMatch ? stripYamlScalar(nameMatch[1]) : '',
    description,
    version: versionMatch ? versionMatch[1].trim() : '',
    category: categoryMatch ? categoryMatch[1].trim() : '',
    nameZh: nameZhMatch ? stripYamlScalar(nameZhMatch[1]) : ''
  }
}

export function listPromptSkills(): PromptSkill[] {
  const dir = getSkillsDir()
  const meta = loadMeta()
  const results: PromptSkill[] = []

  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue
    const skillMdPath = join(dir, entry.name, 'SKILL.md')
    if (!existsSync(skillMdPath)) continue

    const content = readFileSync(skillMdPath, 'utf-8')
    const fm = parseFrontmatter(content)
    const m = meta[entry.name] || { id: uuid(), enabled: true }

    if (!meta[entry.name]) {
      meta[entry.name] = m
    }

    const bundled = existsSync(join(getBundledSkillsDir(), entry.name))
    const origin = m.origin || (bundled ? 'official' : 'local')
    const displayName = pickDisplayName(fm, content, entry.name, m.displayName)
    results.push({
      id: m.id,
      name: displayName,
      description: fm.description || '',
      dirName: entry.name,
      enabled: m.enabled,
      category: fm.category || inferSkillCategory(displayName, fm.description),
      origin,
        reviewed: m.reviewed ?? (origin === 'cloud' || origin === 'official'),
      skillId: m.skillId,
      versionId: m.versionId,
      version: fm.version
    })
  }

  saveMeta(meta)
  return results
}

export function getPromptSkillContent(dirName: string): string {
  const dir = getSkillsDir()
  const skillMdPath = join(dir, dirName, 'SKILL.md')
  if (!existsSync(skillMdPath)) return ''

  return readFileSync(skillMdPath, 'utf-8')
}

export function getPromptSkillByName(name: string): { dirName: string; content: string; skillDir: string } | null {
  const skills = listPromptSkills()
  const skill = skills.find(
    (s) =>
      s.enabled &&
      (s.name === name ||
        s.dirName === name ||
        s.name.toLowerCase() === name.toLowerCase() ||
        s.dirName.toLowerCase() === name.toLowerCase())
  )
  if (!skill) return null
  const skillDir = join(getSkillsDir(), skill.dirName)
  return { dirName: skill.dirName, content: getPromptSkillContent(skill.dirName), skillDir }
}

export function togglePromptSkill(dirName: string, enabled: boolean): void {
  const meta = loadMeta()
  if (meta[dirName]) {
    meta[dirName].enabled = enabled
  }
  saveMeta(meta)
}

export function deletePromptSkill(dirName: string): void {
  const dir = getSkillsDir()
  const skillDir = join(dir, dirName)
  if (existsSync(skillDir)) {
    rmSync(skillDir, { recursive: true, force: true })
  }
  const meta = loadMeta()
  const bundled = existsSync(join(getBundledSkillsDir(), dirName))
  if (bundled) {
    const cur = meta[dirName] || { id: uuid(), enabled: true }
    meta[dirName] = { ...cur, removed: true }
  } else {
    delete meta[dirName]
  }
  saveMeta(meta)

  // Cascade: remove from all bots' prompt_skill_dirs
  try {
    const { getDatabase } = require('../database')
    const db = getDatabase()
    const bots = db.prepare("SELECT id, prompt_skill_dirs FROM bots WHERE prompt_skill_dirs LIKE '%' || ? || '%'").all(dirName) as any[]
    for (const bot of bots) {
      const dirs: string[] = JSON.parse(bot.prompt_skill_dirs || '[]')
      const filtered = dirs.filter((d: string) => d !== dirName)
      if (filtered.length !== dirs.length) {
        db.prepare('UPDATE bots SET prompt_skill_dirs = ? WHERE id = ?').run(JSON.stringify(filtered), bot.id)
      }
    }
  } catch (e) {
    console.error('Failed to cleanup bot prompt_skill_dirs references:', e)
  }
}

export function getSkillsDirectory(): string {
  return getSkillsDir()
}

export function createPromptSkillFromContent(
  name: string,
  description: string,
  skillMdContent: string,
  opts?: { overwrite?: boolean }
): PromptSkill {
  const dir = getSkillsDir()
  const existing = listPromptSkills()
  const same = existing.find((s) => s.name === name)
  let dirName: string
  if (opts?.overwrite && same) {
    dirName = same.dirName
  } else {
    dirName = uniqueSkillDirName(name, existingSkillDirs())
  }
  const skillDir = join(dir, dirName)
  mkdirSync(skillDir, { recursive: true })

  const frontmatter = `---\nname: ${name}\ndescription: ${description}\n---\n\n`
  const content = skillMdContent.startsWith('---') ? skillMdContent : frontmatter + skillMdContent
  writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8')

  const meta = loadMeta()
  const id = same && opts?.overwrite ? same.id : uuid()
  meta[dirName] = { id, enabled: same?.enabled ?? true, removed: false, origin: 'local', reviewed: false }
  saveMeta(meta)

  return {
    id,
    name,
    description,
    dirName,
    enabled: meta[dirName].enabled,
    category: parseFrontmatter(content).category || inferSkillCategory(name, description),
    origin: 'local',
    reviewed: false
  }
}
