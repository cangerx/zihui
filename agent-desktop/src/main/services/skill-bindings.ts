export type SkillBinding = {
  source: 'cloud' | 'local'
  skill_id?: string
  version_id?: string
  dir_name?: string
  override_dir?: string
}

export function parseBindings(raw: unknown): SkillBinding[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw as SkillBinding[]
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function migrateFromDirs(dirs: string[]): SkillBinding[] {
  return (dirs || []).filter(Boolean).map((dir) => ({ source: 'local' as const, dir_name: String(dir) }))
}

export function resolveEffectiveDirs(bindings: SkillBinding[] | string, installedDirs: string[]): string[] {
  const installed = new Set(installedDirs || [])
  const out: string[] = []
  for (const b of parseBindings(bindings)) {
    const preferred = b.source === 'cloud' ? (b.override_dir || b.dir_name) : b.dir_name
    if (!preferred) continue
    if (installed.size && !installed.has(preferred)) continue
    if (!out.includes(preferred)) out.push(preferred)
  }
  return out
}

export function bindingsFromSelected(
  selectedDirs: string[],
  skillsByDir: Record<string, { origin?: string; skillId?: string; versionId?: string }>
): SkillBinding[] {
  return (selectedDirs || []).map((dir) => {
    const skill = skillsByDir[dir]
    if (skill && skill.origin === 'cloud') {
      return {
        source: 'cloud' as const,
        skill_id: skill.skillId,
        version_id: skill.versionId,
        dir_name: dir,
      }
    }
    return { source: 'local' as const, dir_name: dir }
  })
}
