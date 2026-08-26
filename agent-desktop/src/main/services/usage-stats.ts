import { getDatabase } from '../database'

export interface UsageLog {
  id: number
  provider_id: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  created_at: string
}

export interface ModelUsageSummary {
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  call_count: number
}

export interface ProviderUsageSummary {
  provider_id: string
  provider_name: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  call_count: number
  models: ModelUsageSummary[]
}

export function recordUsage(
  providerId: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  totalTokens: number
): void {
  const db = getDatabase()
  db.prepare(
    'INSERT INTO usage_logs (provider_id, model, prompt_tokens, completion_tokens, total_tokens) VALUES (?, ?, ?, ?, ?)'
  ).run(providerId, model, promptTokens, completionTokens, totalTokens)
}

export function getProviderUsageStats(providerId: string): ProviderUsageSummary | null {
  const db = getDatabase()

  const providerRow = db.prepare('SELECT name FROM model_providers WHERE id = ?').get(providerId) as any
  if (!providerRow) return null

  const total = db.prepare(
    'SELECT COALESCE(SUM(prompt_tokens),0) as prompt_tokens, COALESCE(SUM(completion_tokens),0) as completion_tokens, COALESCE(SUM(total_tokens),0) as total_tokens, COUNT(*) as call_count FROM usage_logs WHERE provider_id = ?'
  ).get(providerId) as any

  const models = db.prepare(
    'SELECT model, COALESCE(SUM(prompt_tokens),0) as prompt_tokens, COALESCE(SUM(completion_tokens),0) as completion_tokens, COALESCE(SUM(total_tokens),0) as total_tokens, COUNT(*) as call_count FROM usage_logs WHERE provider_id = ? GROUP BY model ORDER BY total_tokens DESC'
  ).all(providerId) as ModelUsageSummary[]

  return {
    provider_id: providerId,
    provider_name: providerRow.name,
    prompt_tokens: total.prompt_tokens,
    completion_tokens: total.completion_tokens,
    total_tokens: total.total_tokens,
    call_count: total.call_count,
    models
  }
}

export function getAllUsageStats(): ProviderUsageSummary[] {
  const db = getDatabase()

  const providers = db.prepare(
    'SELECT DISTINCT u.provider_id, COALESCE(p.name, u.provider_id) as provider_name FROM usage_logs u LEFT JOIN model_providers p ON u.provider_id = p.id'
  ).all() as any[]

  return providers.map((p) => {
    const total = db.prepare(
      'SELECT COALESCE(SUM(prompt_tokens),0) as prompt_tokens, COALESCE(SUM(completion_tokens),0) as completion_tokens, COALESCE(SUM(total_tokens),0) as total_tokens, COUNT(*) as call_count FROM usage_logs WHERE provider_id = ?'
    ).get(p.provider_id) as any

    const models = db.prepare(
      'SELECT model, COALESCE(SUM(prompt_tokens),0) as prompt_tokens, COALESCE(SUM(completion_tokens),0) as completion_tokens, COALESCE(SUM(total_tokens),0) as total_tokens, COUNT(*) as call_count FROM usage_logs WHERE provider_id = ? GROUP BY model ORDER BY total_tokens DESC'
    ).all(p.provider_id) as ModelUsageSummary[]

    return {
      provider_id: p.provider_id,
      provider_name: p.provider_name,
      prompt_tokens: total.prompt_tokens,
      completion_tokens: total.completion_tokens,
      total_tokens: total.total_tokens,
      call_count: total.call_count,
      models
    }
  })
}

export function clearUsageStats(providerId?: string): void {
  const db = getDatabase()
  if (providerId) {
    db.prepare('DELETE FROM usage_logs WHERE provider_id = ?').run(providerId)
  } else {
    db.prepare('DELETE FROM usage_logs').run()
  }
}
