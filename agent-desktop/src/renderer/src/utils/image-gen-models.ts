import { hasCap, type ModelCap } from '@/utils/model-caps'
import { useModelStore } from '@/stores/models'
import { useSiteConfigStore } from '@/stores/site-config'

export type PickedModel = { provider_id: string; model_id: string }

type ModelStore = ReturnType<typeof useModelStore>

function usableId(
  modelStore: ModelStore,
  providerId: string,
  modelId: string,
  cap: ModelCap
): string {
  if (!providerId || !modelId) return ''
  const prov = modelStore.providers.find((p) => p.id === providerId)
  if (!prov) return ''
  let id = modelId
  if (!prov.models.includes(id)) {
    const upgraded = providerId === 'cloud:default' ? modelStore.upgradeToCompositeKey(id) : id
    if (!prov.models.includes(upgraded)) return ''
    id = upgraded
  }
  const cloudType = modelStore.cloudTypeOf(providerId, id)
  return hasCap(id, cap, cloudType) ? id : ''
}

function firstWithCap(modelStore: ModelStore, cap: ModelCap): PickedModel {
  for (const p of modelStore.providers) {
    for (const m of p.models) {
      if (hasCap(m, cap, modelStore.cloudTypeOf(p.id, m))) {
        return { provider_id: p.id, model_id: m }
      }
    }
  }
  return { provider_id: '', model_id: '' }
}

/**
 * 生图页 / 批量页模型：上次选用（仍可用）→ 云端对话默认（仅 chat）→ 列表里第一个可用。
 * 打开页面即可带上，不必每次重选。
 */
export function resolveStudioModel(
  modelStore: ModelStore,
  saved: { provider_id?: string; model_id?: string },
  cap: 'image' | 'chat',
  siteConfig?: ReturnType<typeof useSiteConfigStore>
): PickedModel {
  const savedId = usableId(modelStore, saved.provider_id || '', saved.model_id || '', cap)
  if (saved.provider_id && savedId) {
    return { provider_id: saved.provider_id, model_id: savedId }
  }
  if (cap === 'chat' && siteConfig) {
    const cloud = siteConfig.chatDefaultModel
    if (cloud?.provider_id && cloud?.model_id) {
      const candidate =
        cloud.provider_id === 'cloud:default'
          ? modelStore.upgradeToCompositeKey(cloud.model_id)
          : cloud.model_id
      const id = usableId(modelStore, cloud.provider_id, candidate, 'chat')
      if (id) return { provider_id: cloud.provider_id, model_id: id }
    }
  }
  return firstWithCap(modelStore, cap)
}
