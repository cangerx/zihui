// 云端模型复合 key 工具（main + renderer 共享）。
// 桌面端把所有云端模型挂在虚拟 provider `cloud:default` 下；为了在 select 下拉里
// 区分同名 model_id 来自不同云上服务商（比如多米 / OpenAI 都提供 gpt-image-2），
// option 用复合 key `{model_id}#@{provider_name}` 作 :value 保证唯一。
//
// 调用真实云端 API 前用 stripModelId 还原纯 model_id；DB 写入时可保留复合 key
// 以便后续展示位精确还原"实际用了哪家"。

export const CLOUD_KEY_SEP = '#@'

/**
 * 复合 key 还原为纯 model_id；非复合 key 原样返回。
 */
export function stripModelId(composite: string | undefined | null): string {
  if (!composite) return ''
  const i = composite.indexOf(CLOUD_KEY_SEP)
  return i === -1 ? composite : composite.slice(0, i)
}

/**
 * 用 model_id + provider_name 拼复合 key；provider_name 为空时退化为纯 model_id。
 */
export function toCompositeKey(modelId: string, providerName?: string | null): string {
  if (!modelId) return ''
  return providerName ? `${modelId}${CLOUD_KEY_SEP}${providerName}` : modelId
}

/**
 * 复合 key 拆分；纯 model_id 时 providerName 为空字符串。
 */
export function parseCompositeKey(s: string | undefined | null): {
  modelId: string
  providerName: string
} {
  if (!s) return { modelId: '', providerName: '' }
  const i = s.indexOf(CLOUD_KEY_SEP)
  if (i === -1) return { modelId: s, providerName: '' }
  return { modelId: s.slice(0, i), providerName: s.slice(i + CLOUD_KEY_SEP.length) }
}
