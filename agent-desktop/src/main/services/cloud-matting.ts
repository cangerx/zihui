import { readFileSync, statSync, existsSync } from 'fs'
import { basename, extname } from 'path'
import { getCloudToken, getCloudApiBase, fetchWithCloudAuth, throwCloudHttpError } from './cloud-token'
import type { MattingResult } from './aliyun-matting'

/**
 * 云接口模式：把本地图 multipart 上传到 /api/gateway/matting/segment，
 * 拿 task_id，再轮询 /api/gateway/matting/status/{taskId} 直到 completed / failed。
 *
 * 凭证不下发到桌面：所有 AK 都在服务端 .env 里。
 *
 * 限制：
 *   - 30 任务/分钟（云控端 throttle）
 *   - 单用户并发 3（云控端 RateLimiter）
 *   - 全站 5 QPS（云控端 RateLimiter）
 *   - 月配额（permission_policies.image_matting_quota_per_month）
 *
 * 超时：默认 90s（覆盖云控端最长 60s + 30s buffer）
 *
 * 实现说明：用 Electron 主进程 Node 18+ 原生 FormData + Blob + fetch（与 cloud-inspiration.ts 一致），
 * 不依赖第三方 form-data 库，避免 Node Readable stream 与 undici fetch 的兼容问题。
 */

const POLL_INTERVAL_MS = 2000
const DEFAULT_TIMEOUT_MS = 90_000

export interface CloudMattingOptions {
  /** 总超时（毫秒），默认 90s */
  timeoutMs?: number
  /** 提交成功、进入云端处理阶段时回调（用于上报 processing 进度） */
  onProcessing?: () => void
}

export async function segmentLocalFileViaCloud(
  localPath: string,
  options: CloudMattingOptions = {},
): Promise<MattingResult> {
  if (!existsSync(localPath)) throw new Error(`文件不存在：${localPath}`)
  const st = statSync(localPath)
  if (st.size <= 0) throw new Error('文件为空')
  if (st.size > 40 * 1024 * 1024) {
    throw new Error('文件超过 40MB 限制')
  }

  if (!getCloudToken()) throw new Error('未登录云控端')
  const apiBase = getCloudApiBase()
  if (!apiBase) throw new Error('云控端 apiBase 未配置')

  const start = Date.now()
  const taskId = await submit(apiBase, localPath)
  options.onProcessing?.()
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // 轮询
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
        image_url:  r.image_url,
        request_id: r.request_id || taskId,
        elapsed_ms: r.elapsed_ms ?? Date.now() - start,
      }
    }
    if (status.status === 'failed') {
      throw new Error(status.error || '云控端抠图失败')
    }
    // pending / processing → 继续轮询
  }
}

/**
 * 我的本月抠图配额（拉云控端）。失败时返回 null，由调用方兜底。
 */
export async function fetchQuota(): Promise<null | {
  matting_enabled: boolean
  allow_image_matting: boolean
  allow_custom_matting_provider: boolean
  image_matting_quota_per_month: number
  used_this_month: number
  credit_per_call: number
  current_credit_balance: number
}> {
  const token = getCloudToken()
  if (!token) return null
  const apiBase = getCloudApiBase()
  if (!apiBase) return null

  try {
    // routes/api.php 由 RouteServiceProvider 加 `prefix('api')`，所以前端 URL 是 /api/gateway/...
    // getCloudApiBase() 已经返回 ${apiDomain}/api，因此这里只用 /gateway/ 即可，不要再加 /v1
    const resp = await fetchWithCloudAuth(`${apiBase}/gateway/matting/quota`, {}, '云端抠图配额 401')
    if (!resp.ok) return null
    return (await resp.json()) as any
  } catch {
    return null
  }
}

// ===== private =====

async function submit(apiBase: string, localPath: string): Promise<string> {
  const filename = basename(localPath)
  const ext = extname(localPath).slice(1).toLowerCase()
  const mime = ext === 'png' ? 'image/png'
             : ext === 'bmp' ? 'image/bmp'
             : 'image/jpeg'

  // 用原生 FormData + Blob（与 cloud-inspiration.ts 一致），避免第三方 form-data 库与 undici fetch 兼容问题。
  // 注意：fetch 自带 boundary + Content-Length，不需要手动设 Content-Type；手动设会丢 boundary 导致后端解析失败。
  const buf = readFileSync(localPath)
  const blob = new Blob([new Uint8Array(buf)], { type: mime })
  const fd = new FormData()
  fd.append('image', blob, filename)

  let resp: Response
  try {
    resp = await fetchWithCloudAuth(`${apiBase}/gateway/matting/segment`, {
      method: 'POST',
      body: fd,
    }, '云端抠图提交 401')
  } catch (e: any) {
    throw new Error(`网络请求失败：${e?.message || '未知错误'}`)
  }

  if (!resp.ok) {
    // 402 余额不足 → 中文友好错误；其余沿用后端 error
    await throwCloudHttpError(resp, '云控端提交失败')
  }
  const j: any = await resp.json()
  if (!j.task_id) throw new Error('云控端未返回 task_id')
  return j.task_id as string
}

async function pollStatus(apiBase: string, taskId: string): Promise<{
  task_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  result?: { image_url?: string; request_id?: string; elapsed_ms?: number }
  error?: string
}> {
  const resp = await fetchWithCloudAuth(
    `${apiBase}/gateway/matting/status/${encodeURIComponent(taskId)}`,
    {},
    '云端抠图轮询 401',
  )
  if (!resp.ok) {
    await throwCloudHttpError(resp, '查询状态失败')
  }
  return (await resp.json()) as any
}
