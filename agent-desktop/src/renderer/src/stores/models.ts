import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useCloudAuthStore } from './cloud-auth'
import { CLOUD_KEY_SEP, stripModelId, toCompositeKey } from '@shared/model-id'

function plain<T>(data: T): T {
  return JSON.parse(JSON.stringify(data))
}

export interface ProviderCustomParam {
  name: string
  value: string
}

export interface ModelProvider {
  id: string
  name: string
  type: string
  api_base: string
  api_key: string
  models: string[]
  purpose?: string
  provider_preset?: string
  protocol_adapter?: string
  enabled?: boolean
  /** 在生图请求 body 顶层逐条 set 的自定义参数（空字符串 value 视为占位不下发） */
  custom_params: ProviderCustomParam[]
  /** 在 custom_params 之后做最终 body 覆盖的 JSON patch */
  request_override_patch: Record<string, any>
  /** 该服务商对话时注入的默认系统提示词 */
  system_prompt?: string
  created_at: string
  updated_at: string
  isCloud?: boolean
}

export const useModelStore = defineStore('models', () => {
  const localProviders = ref<ModelProvider[]>([])
  const loading = ref(false)

  const providers = computed(() => {
    const cloudAuth = useCloudAuthStore()
    const showLocal = cloudAuth.isLoggedIn && (
      cloudAuth.permissions.allow_custom_provider || cloudAuth.permissions.allow_custom_video_provider
    )
    const result = showLocal ? [...localProviders.value] : []
    // 云端模型统一归入一个虚拟 provider 'cloud:default'（显示为 "Cloud Models"）。
    // models 数组元素是复合 key `{model_id}#@{provider_name}`，每条 cloud_models 记录对应一项，
    // 让多家云上服务商提供同名 model_id 时下拉里能分别显示并区分。
    if (cloudAuth.isLoggedIn && cloudAuth.models.length > 0) {
      const keys: string[] = []
      const seen = new Set<string>()
      for (const m of cloudAuth.models) {
        if (!m.model_id) continue
        const key = toCompositeKey(m.model_id, m.provider_name)
        if (seen.has(key)) continue
        seen.add(key)
        keys.push(key)
      }
      result.unshift({
        id: 'cloud:default',
        name: 'Cloud Models',
        type: 'cloud',
        api_base: '',
        api_key: '',
        models: keys,
        purpose: 'general',
        provider_preset: '',
        protocol_adapter: '',
        enabled: true,
        custom_params: [],
        request_override_patch: {},
        system_prompt: '',
        created_at: '',
        updated_at: '',
        isCloud: true
      })
    }
    return result
  })

  // Map of cloud model_id -> type ('chat' | 'image' | 'embedding' | ...)
  // Used by capability detection to trust the backend ground-truth over name heuristics.
  const cloudTypes = computed<Record<string, string>>(() => {
    const cloudAuth = useCloudAuthStore()
    const map: Record<string, string> = {}
    for (const m of cloudAuth.models) {
      if (m.model_id) map[m.model_id] = m.type
    }
    return map
  })

  function cloudTypeOf(providerId: string, modelIdOrKey: string): string | undefined {
    if (providerId !== 'cloud:default') return undefined
    return cloudTypes.value[stripModelId(modelIdOrKey)]
  }

  /**
   * 云端 model_id → 所有提供该模型的服务商名（去重，按字典序）。
   * 同一个纯 model_id 可能由多家云上服务商共同提供，这里合并返回。
   */
  function cloudProvidersOf(modelId: string): string[] {
    if (!modelId) return []
    const cloudAuth = useCloudAuthStore()
    const pure = stripModelId(modelId)
    const names = new Set<string>()
    for (const m of cloudAuth.models) {
      if (m.model_id === pure && m.provider_name) names.add(m.provider_name)
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }

  function cloudModelDisplayName(modelId: string, providerName?: string): string {
    if (!modelId) return ''
    const cloudAuth = useCloudAuthStore()
    const pure = stripModelId(modelId)
    const match = cloudAuth.models.find((m) => {
      if (m.model_id !== pure) return false
      return providerName ? m.provider_name === providerName : true
    })
    return match?.name || pure
  }

  function cloudModelLabelsOf(modelId: string): string[] {
    if (!modelId) return []
    const cloudAuth = useCloudAuthStore()
    const pure = stripModelId(modelId)
    const labels = new Set<string>()
    for (const m of cloudAuth.models) {
      if (m.model_id !== pure) continue
      const displayName = m.name || pure
      labels.add(m.provider_name ? `${displayName} · ${m.provider_name}` : displayName)
    }
    return Array.from(labels).sort((a, b) => a.localeCompare(b))
  }

  /**
   * 把纯 model_id 升级为「首选」复合 key：
   * - 在 cloudAuth.models 找第一个匹配的服务商，拼成 `{modelId}#@{provider_name}`
   * - 找不到匹配则原样返回（保持纯 model_id）
   * 用于编辑场景：DB 里存的是纯 model_id，恢复到 select 时需要复合 key 才能命中 option。
   */
  function upgradeToCompositeKey(modelId: string | undefined | null): string {
    const pure = stripModelId(modelId || '')
    if (!pure) return ''
    // 已是复合 key 直接返回
    if ((modelId || '').includes(CLOUD_KEY_SEP)) return modelId as string
    const cloudAuth = useCloudAuthStore()
    const match = cloudAuth.models.find((m) => m.model_id === pure)
    return match && match.provider_name ? toCompositeKey(pure, match.provider_name) : pure
  }

  /**
   * 选择器 option 的显示文本：
   * - 本地 provider：直接返回 modelId
   * - 云端 provider 复合 key：拆分显示 `{modelName} · {providerName}`
   * - 云端 provider 纯 model_id（兼容老数据）：用云端模型名和服务商合并显示
   */
  function optionLabel(providerId: string, key: string): string {
    if (!key) return ''
    if (providerId === 'cloud:default') {
      const i = key.indexOf(CLOUD_KEY_SEP)
      if (i !== -1) {
        const mid = key.slice(0, i)
        const prov = key.slice(i + CLOUD_KEY_SEP.length)
        return `${cloudModelDisplayName(mid, prov)} · ${prov}`
      }
      const labels = cloudModelLabelsOf(key)
      return labels.length ? labels.join(', ') : key
    }
    return key
  }

  /**
   * 已选模型的单行展示文本（卡片/标题/详情用）：
   * - 云端 provider：统一显示 `{modelName} · {providerName}`
   * - 本地 provider：保持 `{providerName} / {modelId}` 格式
   * - 纯 model_id（DB 数据）：用云端模型名和服务商合并显示
   */
  function formatModelLabel(
    providerId: string | undefined | null,
    modelIdOrKey: string | undefined | null
  ): string {
    if (!modelIdOrKey) return ''
    if (!providerId) return modelIdOrKey
    if (providerId === 'cloud:default') {
      const i = modelIdOrKey.indexOf(CLOUD_KEY_SEP)
      if (i !== -1) {
        const mid = modelIdOrKey.slice(0, i)
        const prov = modelIdOrKey.slice(i + CLOUD_KEY_SEP.length)
        return `${cloudModelDisplayName(mid, prov)} · ${prov}`
      }
      const labels = cloudModelLabelsOf(modelIdOrKey)
      return labels.length ? labels.join(', ') : modelIdOrKey
    }
    const p = providers.value.find((pp) => pp.id === providerId)
    return p ? `${p.name} / ${modelIdOrKey}` : modelIdOrKey
  }

  async function fetchProviders() {
    loading.value = true
    try {
      localProviders.value = (await window.api.model.invoke('list')) as ModelProvider[]
    } finally {
      loading.value = false
    }
  }

  async function createProvider(data: Partial<ModelProvider>) {
    const result = (await window.api.model.invoke('create', plain(data))) as ModelProvider
    localProviders.value.unshift(result)
    return result
  }

  async function updateProvider(id: string, data: Partial<ModelProvider>) {
    const result = (await window.api.model.invoke('update', id, plain(data))) as ModelProvider
    const idx = localProviders.value.findIndex((p) => p.id === id)
    if (idx !== -1) localProviders.value[idx] = result
    return result
  }

  async function deleteProvider(id: string) {
    await window.api.model.invoke('delete', id)
    localProviders.value = localProviders.value.filter((p) => p.id !== id)
  }

  return {
    providers,
    loading,
    fetchProviders,
    createProvider,
    updateProvider,
    deleteProvider,
    cloudTypeOf,
    cloudProvidersOf,
    upgradeToCompositeKey,
    optionLabel,
    formatModelLabel
  }
})
