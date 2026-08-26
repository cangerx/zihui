/**
 * 去AI标记：云控端按次计费调用（本地处理成功后回调）。
 * 复用 cloud-token 的鉴权 fetch 封装（自动注入 Bearer + 401 刷新）。
 */
import { getCloudToken, getCloudApiBase, fetchWithCloudAuth, throwCloudHttpError } from './cloud-token'

export interface AiMarkChargePayload {
  /** 幂等键：桌面端生成的 uuid，同一次处理重试只扣一次 */
  request_id: string
  /** 命中的标记类别（逗号分隔，仅记录用） */
  marks?: string
  /** 本次计费的图片数（有标记被去除的张数） */
  image_count?: number
}

/**
 * 回调云控端扣费。
 * - 402 → 余额不足（throwCloudHttpError 会抛 CloudBalanceError，渲染层可引导充值）
 * - 403 → 未开通去AI标记功能
 * - 503 → 服务未启用（全局开关关闭）
 */
export async function chargeWatermarkRemoval(payload: AiMarkChargePayload): Promise<any> {
  if (!getCloudToken()) throw new Error('未登录云控端，无法计费')
  const apiBase = getCloudApiBase()
  const resp = await fetchWithCloudAuth(
    `${apiBase}/gateway/watermark-removal/charge`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    '去AI标记计费 401',
  )
  if (!resp.ok) await throwCloudHttpError(resp, '去AI标记计费失败')
  return await resp.json()
}
