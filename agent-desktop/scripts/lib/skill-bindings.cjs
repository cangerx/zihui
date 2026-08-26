'use strict'

/**
 * @typedef {{ source: 'cloud'|'local', skill_id?: string, version_id?: string, dir_name?: string, override_dir?: string }} SkillBinding
 */

function parseBindings(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function migrateFromDirs(dirs) {
  const list = Array.isArray(dirs) ? dirs : []
  return list.filter(Boolean).map((dir) => ({ source: 'local', dir_name: String(dir) }))
}

function resolveEffectiveDirs(bindings, installedDirs) {
  const installed = new Set(installedDirs || [])
  const out = []
  for (const b of parseBindings(bindings)) {
    const preferred = b.source === 'cloud' ? (b.override_dir || b.dir_name) : b.dir_name
    if (!preferred) continue
    if (installed.size && !installed.has(preferred)) continue
    if (!out.includes(preferred)) out.push(preferred)
  }
  return out
}

function bindingsFromSelected(selectedDirs, skillsByDir) {
  return (selectedDirs || []).map((dir) => {
    const skill = skillsByDir && skillsByDir[dir]
    if (skill && skill.origin === 'cloud') {
      return {
        source: 'cloud',
        skill_id: skill.skillId || skill.skill_id,
        version_id: skill.versionId || skill.version_id,
        dir_name: dir,
        override_dir: skill.overrideDir || undefined,
      }
    }
    return { source: 'local', dir_name: dir }
  })
}

module.exports = { parseBindings, migrateFromDirs, resolveEffectiveDirs, bindingsFromSelected }
