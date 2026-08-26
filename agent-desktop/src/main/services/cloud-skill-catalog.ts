import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getCloudApiBase, fetchWithCloudAuth, throwCloudHttpError } from './cloud-token'
import { getDataDir } from './data-path'
import { installSkillPackage, type CloudInstallProof } from './prompt-skill-installer'
import { listPromptSkills } from './prompt-skill'

export interface CloudSkillCatalogItem {
  skill_id: string
  slug: string
  name: string
  description?: string
  category?: string
  recommended?: boolean
    version: string
    version_id: string
    sha256: string
    signature?: string
    key_id?: string
    published_at?: string
  permissions?: Record<string, unknown>
  reviewed: boolean
  status: string
  installed?: boolean
  dirName?: string
  origin: 'cloud'
}

interface CatalogCache {
  cursor: string
  items: CloudSkillCatalogItem[]
  keys: Array<{ key_id: string; public_key: string }>
  fetchedAt: string | null
}

function cacheFile(): string {
  return join(getDataDir(), 'cloud-skill-catalog.json')
}

function readCache(): CatalogCache {
  try {
    const raw = JSON.parse(require('fs').readFileSync(cacheFile(), 'utf8'))
    return {
      cursor: String(raw.cursor || ''),
      items: Array.isArray(raw.items) ? raw.items : [],
      keys: Array.isArray(raw.keys) ? raw.keys : [],
      fetchedAt: raw.fetchedAt || null,
    }
  } catch {
    return { cursor: '', items: [], keys: [], fetchedAt: null }
  }
}

function writeCache(cache: CatalogCache): void {
  mkdirSync(getDataDir(), { recursive: true })
  writeFileSync(cacheFile(), JSON.stringify(cache, null, 2))
}

function annotateInstalled(items: CloudSkillCatalogItem[]): CloudSkillCatalogItem[] {
  const installed = listPromptSkills().filter((s) => s.origin === 'cloud')
  const byId = new Map(installed.filter((s) => s.skillId).map((s) => [s.skillId as string, s]))
  return items.map((item) => {
    const hit = byId.get(item.skill_id)
    return {
      ...item,
      origin: 'cloud',
      reviewed: true,
      installed: !!hit,
      dirName: hit?.dirName,
    }
  })
}

export function getCachedCloudSkillCatalog(): { items: CloudSkillCatalogItem[]; offline: boolean; cursor: string } {
  const cache = readCache()
  return { items: annotateInstalled(cache.items), offline: true, cursor: cache.cursor }
}

export async function refreshCloudSkillCatalog(): Promise<{ items: CloudSkillCatalogItem[]; offline: boolean; cursor: string }> {
  const cache = readCache()
  try {
    const url = `${getCloudApiBase()}/client/skills/catalog?cursor=${encodeURIComponent(cache.cursor || '')}`
    const res = await fetchWithCloudAuth(url)
    if (!res.ok) await throwCloudHttpError(res, '拉取技能目录失败')
    const json = await res.json()
    const next: CatalogCache = {
      cursor: String(json.next_cursor || cache.cursor || ''),
      items: Array.isArray(json.data) ? json.data : cache.items,
      keys: Array.isArray(json.keys) ? json.keys : cache.keys,
      fetchedAt: new Date().toISOString(),
    }
    writeCache(next)
    return { items: annotateInstalled(next.items), offline: false, cursor: next.cursor }
  } catch {
    return { items: annotateInstalled(cache.items), offline: true, cursor: cache.cursor }
  }
}

export async function installCloudSkill(versionId: string): Promise<{ success: boolean; name?: string; error?: string }> {
  const cache = readCache()
  const item = cache.items.find((row) => row.version_id === versionId)
  if (!item) return { success: false, error: 'skill_not_found' }
  try {
    const ticketRes = await fetchWithCloudAuth(
      `${getCloudApiBase()}/client/skills/versions/${versionId}/download-ticket`,
      { method: 'POST' }
    )
    if (!ticketRes.ok) await throwCloudHttpError(ticketRes, '申请下载失败')
    const ticket = await ticketRes.json()
    const url = String(ticket.url || '')
    const abs = url.startsWith('http') ? url : `${getCloudApiBase().replace(/\/api$/, '')}${url.startsWith('/') ? url : '/' + url}`
    const fileRes = await fetchWithCloudAuth(abs)
    if (!fileRes.ok) await throwCloudHttpError(fileRes, '下载技能包失败')
    const buf = new Uint8Array(await fileRes.arrayBuffer())
    const proof: CloudInstallProof = {
      skillId: item.skill_id,
      versionId: item.version_id,
      version: item.version,
      sha256: String(ticket.sha256 || item.sha256),
      signature: String(ticket.signature || item.signature || ''),
      keyId: String(ticket.key_id || item.key_id || ''),
      publishedAt: String(item.published_at || ''),
      publicKeys: cache.keys,
    }
    // 票据不含 published_at 时，用目录缓存不足以验签；允许用 ticket 字段重建失败则返回 signature_invalid。
    const installed = listPromptSkills().find((s) => s.skillId === item.skill_id)
    return installSkillPackage({
      zipBuffer: buf,
      requireSignature: true,
      proof,
      preferredDirName: installed?.dirName || item.slug,
    })
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) }
  }
}
