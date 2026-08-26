import type { SlideTemplate, TemplateManifestEntry } from './types'
import { getTemplate as getBuiltin, listManifest as listBuiltin } from './template-registry'
import { TemplateManager, type RemoteTemplateEntry } from './template-manager'
import { toSlideTemplate } from './declarative'
import { loadTemplateManifest, cloudFetchBytes } from './deck-cloud'
import { STYLE_FAMILIES, familyIdForCategory } from './families'

// 模板提供者抽象: 让 deck-generator 与"模板从哪来"解耦。
//   - 内置档(默认): 仅 6 套基础受控模板, 纯逻辑可测。
//   - 云端档: 内置 + 云端按需模板(经 template-manager 拉声明式包)。
// 选型按"风格家族"作用域(P0 修复): listManifest(familyId) 只返回该家族模板,
// 避免一份 PPT 跨家族风格混搭, 并把 LLM 选型 prompt 限制在单一家族内。

export interface FamilyInfo {
  id: string
  label: string
  description: string
  theme: string
  /** 该家族当前可用模板数 */
  count: number
}

export interface TemplateProvider {
  /** 供 LLM 选型的轻量元数据; 传 familyId 则仅该家族(内置+云端) */
  listManifest(familyId?: string): Promise<TemplateManifestEntry[]>
  /** 当前可用的风格家族(仅含有模板的家族, 按既定顺序) */
  listFamilies(): Promise<FamilyInfo[]>
  /** 解析模板 id → 可渲染模板(内置直接给, 云端按需拉取) */
  resolveTemplate(id: string): Promise<SlideTemplate | undefined>
}

function familiesFromCounts(counts: Map<string, number>): FamilyInfo[] {
  return STYLE_FAMILIES.filter((f) => (counts.get(f.id) ?? 0) > 0).map((f) => ({
    id: f.id,
    label: f.label,
    description: f.description,
    theme: f.theme,
    count: counts.get(f.id) ?? 0
  }))
}

/** 内置模板提供者(默认): 仅 6 套基础模板, 同属 'basic' 家族 */
export const builtinTemplateProvider: TemplateProvider = {
  async listManifest(familyId?: string): Promise<TemplateManifestEntry[]> {
    const all = listBuiltin()
    if (!familyId) return all
    return all.filter((t) => familyIdForCategory(t.category) === familyId)
  },
  async listFamilies(): Promise<FamilyInfo[]> {
    const counts = new Map<string, number>()
    for (const t of listBuiltin()) {
      const fid = familyIdForCategory(t.category)
      counts.set(fid, (counts.get(fid) ?? 0) + 1)
    }
    return familiesFromCounts(counts)
  },
  async resolveTemplate(id: string): Promise<SlideTemplate | undefined> {
    return getBuiltin(id)
  }
}

/** 云端模板提供者: 内置 + 云端按需(getRootDir()/templates 缓存) */
export function makeCloudTemplateProvider(cacheRoot: string): TemplateProvider {
  const tm = new TemplateManager(cacheRoot, cloudFetchBytes)
  let entryById: Map<string, RemoteTemplateEntry> | null = null

  async function ensureManifest(): Promise<Map<string, RemoteTemplateEntry>> {
    if (entryById) return entryById
    try {
      const m = await loadTemplateManifest()
      entryById = new Map(m.templates.map((t) => [t.id, t]))
    } catch {
      // 云端不可达/未登录: 退化为仅内置, 不阻断生成
      entryById = new Map()
    }
    return entryById
  }

  /** 合并内置+云端的轻量元数据(去重内置 id), 各自带 category */
  async function allEntries(): Promise<TemplateManifestEntry[]> {
    const builtin = listBuiltin()
    const seen = new Set(builtin.map((b) => b.id))
    const cloud = [...(await ensureManifest()).values()]
      .filter((t) => !seen.has(t.id))
      .map((t) => ({ id: t.id, name: t.name, category: t.category, description: t.description, schema: t.schema }))
    return [...builtin, ...cloud]
  }

  return {
    async listManifest(familyId?: string): Promise<TemplateManifestEntry[]> {
      const all = await allEntries()
      if (!familyId) return all
      return all.filter((t) => familyIdForCategory(t.category) === familyId)
    },
    async listFamilies(): Promise<FamilyInfo[]> {
      const counts = new Map<string, number>()
      for (const t of await allEntries()) {
        const fid = familyIdForCategory(t.category)
        counts.set(fid, (counts.get(fid) ?? 0) + 1)
      }
      return familiesFromCounts(counts)
    },
    async resolveTemplate(id: string): Promise<SlideTemplate | undefined> {
      const b = getBuiltin(id)
      if (b) return b
      const entry = (await ensureManifest()).get(id)
      if (!entry) return undefined
      const decl = await tm.ensureTemplate(entry)
      return toSlideTemplate(decl)
    }
  }
}

// 进程级共享单例: 避免每次 deck:families/生成都新建 provider 并重拉云端 manifest。
// 同一实例内 ensureManifest 缓存 entryById, 故 families IPC 与生成流共用一份缓存。
let _shared: { root: string; provider: TemplateProvider } | null = null
export function getSharedTemplateProvider(cacheRoot: string): TemplateProvider {
  if (!_shared || _shared.root !== cacheRoot) {
    _shared = { root: cacheRoot, provider: makeCloudTemplateProvider(cacheRoot) }
  }
  return _shared.provider
}
/** 清空共享 provider(下次重建+重拉 manifest); 云端模板有更新时调用。 */
export function clearSharedTemplateProvider(): void {
  _shared = null
}
