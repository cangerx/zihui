// Lightweight LRU of "model actually used for capability X" hints.
// Persisted via window.api.settings under a single key.
// No user-facing labeling — usage is recorded silently on successful actions.

import type { ModelCap } from './model-caps'
import { useCloudAuthStore } from '@/stores/cloud-auth'

const SETTINGS_KEY = 'model_usage_hints'
const MAX_PER_CAP = 20

type HintMap = Partial<Record<ModelCap, string[]>>

let cache: HintMap | null = null
let loadPromise: Promise<HintMap> | null = null

function keyOf(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`
}

async function load(): Promise<HintMap> {
  if (cache) return cache
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    try {
      const raw = await (window as any).api.settings.invoke('get', SETTINGS_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      cache = typeof parsed === 'object' && parsed ? parsed as HintMap : {}
    } catch {
      cache = {}
    }
    return cache!
  })()
  return loadPromise
}

async function save(): Promise<void> {
  if (!cache) return
  try {
    await (window as any).api.settings.invoke('set', SETTINGS_KEY, JSON.stringify(cache))
  } catch {
    // silent
  }
}

/**
 * Mark a model as recently used for the given capability.
 * Moves it to the front of the LRU, trimming oldest if over limit.
 * Stored as "providerId::modelId" so the same model name in different providers
 * doesn't cross-pollute hints.
 */
export async function recordUsage(cap: ModelCap, providerId: string, modelId: string): Promise<void> {
  if (!providerId || !modelId) return
  const map = await load()
  const list = map[cap] ? [...map[cap]!] : []
  const key = keyOf(providerId, modelId)
  const existingIdx = list.indexOf(key)
  if (existingIdx !== -1) list.splice(existingIdx, 1)
  list.unshift(key)
  if (list.length > MAX_PER_CAP) list.length = MAX_PER_CAP
  map[cap] = list
  cache = map
  await save()
  if (providerId === 'cloud:default') {
    useCloudAuthStore().refreshBalancesThrottled().catch(() => {})
  }
}

/**
 * Get ordered list of model ids (strictly bound to providerId) previously used
 * for this capability. Most recent first.
 */
export async function getHintsForProvider(cap: ModelCap, providerId: string): Promise<string[]> {
  if (!providerId) return []
  const map = await load()
  const list = map[cap] || []
  const prefix = `${providerId}::`
  return list
    .filter(k => k.startsWith(prefix))
    .map(k => k.slice(prefix.length))
}

/**
 * Synchronous access once loaded. Returns cached hints or empty array.
 * Call `load()` (or any async helper) first to warm the cache.
 */
export function getHintsSync(cap: ModelCap, providerId: string): string[] {
  if (!cache || !providerId) return []
  const list = cache[cap] || []
  const prefix = `${providerId}::`
  return list
    .filter(k => k.startsWith(prefix))
    .map(k => k.slice(prefix.length))
}

/**
 * Warm the cache. Callers that want synchronous access should await this on mount.
 */
export async function warmHintsCache(): Promise<void> {
  await load()
}
