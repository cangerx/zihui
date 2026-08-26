import { readFileSync, statSync, existsSync } from 'fs'
import { basename, extname } from 'path'
import { getCloudToken, getCloudApiBase, fetchWithCloudAuth, throwCloudHttpError } from './cloud-token'

/**
 * 精细抠图云接口模式：把本地图 multipart 上传到 /api/gateway/fine-matting/segment，
 * 拿 task_id，再轮询 /api/gateway/fine-matting/status/{taskId} 直到 completed / failed。
 *
 * 凭证（抠抠图 API Key）不下发桌面：全部在云控端 SystemSetting 里。
 *
 * 限制：
 *   - 全站并发 5（云控端 FineMattingConcurrencyLimiter）
 *   - 提交 30/min（云控端 throttle）
 *   - 月配额（fine_matting_quota_per_month）
 *   - 单图 ≤ 40MB，格式 png/jpg/jpeg/webp
 *
 * 超时：默认 150s（覆盖云控端最长 120s + buffer）
 */

export interface FineMattingResult {
  image_url: string
  request_id: string
  provider_task_id: string
  elapsed_ms: number
  tier: number
  cost: number
}

const POLL_INTERVAL_MS = 1500
const DEFAULT_TIMEOUT_MS = 150_000
const ALLOWED_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp'])

export interface CloudFineMattingOptions {
  timeoutMs?: number
  /** 提交成功、进入云端处理阶段时回调（用于上报 processing 进度） */
  onProcessing?: () => void
}

export async function segmentLocalFileViaCloud(
  localPath: string,
  options: CloudFineMattingOptions = {},
): Promise<FineMattingResult> {
  if (!existsSync(localPath)) throw new Error(`文件不存在：${localPath}`)
  const st = statSync(localPath)
  if (st.size <= 0) throw new Error('文件为空')
  if (st.size > 40 * 1024 * 1024) throw new Error('文件超过 40MB 限制')

  const ext = extname(localPath).slice(1).toLowerCase()
  if (!ALLOWED_EXTS.has(ext)) {
    throw new Error(`不支持的格式 .${ext}（仅支持 ${[...ALLOWED_EXTS].join('/')}）`)
  }

  if (!getCloudToken()) throw new Error('未登录云控端')
  const apiBase = getCloudApiBase()
  if (!apiBase) throw new Error('云控端 apiBase 未配置')

  const start = Date.now()
  const taskId = await submit(apiBase, localPath, ext)
  options.onProcessing?.()
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  while (true) {
    if (Date.now() - start > timeout) {
      throw new Error(`等待结果超时（>${(timeout / 1000).toFixed(0)}s），任务可能仍在云端处理，请稍后重试`)
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

    const status = await pollStatus(apiBase, taskId)
    if (status.status === 'completed') {
      const r = status.result || {}
      if (!r.image_url) throw new Error('云控端返回 result.image_url 为空')
      return {
        image_url:        r.image_url,
        request_id:       r.request_id || taskId,
        provider_task_id: r.provider_task_id || '',
        elapsed_ms:       r.elapsed_ms ?? Date.now() - start,
        tier:             Number(status.tier ?? 0),
        cost:             Number(status.cost ?? 0),
      }
    }
    if (status.status === 'failed') {
      throw new Error(status.error || '云控端精细抠图失败')
    }
    // pending / processing → 继续轮询
  }
}

/**
 * 我的精细抠图配额 + 三档价 + 阈值（拉云控端）。失败返回 null，调用方兜底。
 */
export async function fetchQuota(): Promise<null | {
  fine_matting_enabled: boolean
  allow_fine_matting: boolean
  fine_matting_quota_per_month: number
  used_this_month: number
  tier1_credit: number
  tier2_credit: number
  tier3_credit: number
  tier_threshold_1: number
  tier_threshold_2: number
  current_credit_balance: number
  max_file_size_mb: number
  allowed_extensions: string[]
}> {
  const token = getCloudToken()
  if (!token) return null
  const apiBase = getCloudApiBase()
  if (!apiBase) return null

  try {
    const resp = await fetchWithCloudAuth(`${apiBase}/gateway/fine-matting/quota`, {}, '云端精细抠图配额 401')
    if (!resp.ok) return null
    return (await resp.json()) as any
  } catch {
    return null
  }
}

// ===== private =====

async function submit(apiBase: string, localPath: string, ext: string): Promise<string> {
  const filename = basename(localPath)
  const mime = ext === 'png' ? 'image/png'
             : ext === 'webp' ? 'image/webp'
             : 'image/jpeg'

  const buf = readFileSync(localPath)
  const blob = new Blob([new Uint8Array(buf)], { type: mime })
  const fd = new FormData()
  fd.append('image', blob, filename)

  let resp: Response
  try {
    resp = await fetchWithCloudAuth(`${apiBase}/gateway/fine-matting/segment`, {
      method: 'POST',
      body: fd,
    }, '云端精细抠图提交 401')
  } catch (e: any) {
    throw new Error(`网络请求失败：${e?.message || '未知错误'}`)
  }

  if (!resp.ok) {
    await throwCloudHttpError(resp, '云控端提交失败')
  }
  const j: any = await resp.json()
  if (!j.task_id) throw new Error('云控端未返回 task_id')
  return j.task_id as string
}

async function pollStatus(apiBase: string, taskId: string): Promise<{
  task_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  tier?: number
  cost?: number
  result?: { image_url?: string; request_id?: string; provider_task_id?: string; elapsed_ms?: number }
  error?: string
}> {
  const resp = await fetchWithCloudAuth(
    `${apiBase}/gateway/fine-matting/status/${encodeURIComponent(taskId)}`,
    {},
    '云端精细抠图轮询 401',
  )
  if (!resp.ok) {
    await throwCloudHttpError(resp, '查询状态失败')
  }
  return (await resp.json()) as any
}
