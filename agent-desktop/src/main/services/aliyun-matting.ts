import { createReadStream, statSync, existsSync } from 'fs'
import { extname } from 'path'
import Imageseg, {
  GetAsyncJobResultRequest,
  SegmentHDCommonImageAdvanceRequest,
} from '@alicloud/imageseg20191230'
import OpenApi from '@alicloud/openapi-client'
import { RuntimeOptions } from '@alicloud/tea-util'

/**
 * 阿里云 viapi SegmentHDCommonImage 直连封装（自定义模式）。
 *
 * 用 Advance API：SDK 内部自动把本地文件上传到阿里临时 OSS，再调真实接口。
 * 这是唯一支持「本地文件无损直传」的方式，无需自建 OSS。
 *
 * 限制（来自阿里官方文档）：
 *   - 单图 ≤ 40MB
 *   - 长边 32-10000px
 *   - 格式：jpg / jpeg / png / bmp
 *
 * 返回结构：
 *   image_url   string  阿里临时 URL（24h 有效，PNG 透明背景）
 *   request_id  string  阿里端 RequestId
 *   elapsed_ms  number  端到端耗时
 */

export interface AliyunCreds {
  access_key_id: string
  access_key_secret: string
  endpoint?: string
  region_id?: string
}

export interface MattingResult {
  image_url: string
  request_id: string
  elapsed_ms: number
}

const MAX_FILE_SIZE = 40 * 1024 * 1024
const ALLOWED_EXTS = new Set(['png', 'jpg', 'jpeg', 'bmp'])
const ASYNC_POLL_INTERVAL_MS = 2000
const ASYNC_TIMEOUT_MS = 90_000

export async function segmentLocalFile(
  localPath: string,
  creds: AliyunCreds,
): Promise<MattingResult> {
  if (!existsSync(localPath)) throw new Error(`文件不存在：${localPath}`)
  const st = statSync(localPath)
  if (st.size <= 0) throw new Error('文件为空')
  if (st.size > MAX_FILE_SIZE) {
    throw new Error(`文件超过 ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)}MB 限制（当前 ${(st.size / 1024 / 1024).toFixed(2)}MB）`)
  }

  const ext = extname(localPath).slice(1).toLowerCase()
  if (!ALLOWED_EXTS.has(ext)) {
    throw new Error(`不支持的格式 .${ext}（仅支持 ${[...ALLOWED_EXTS].join('/')}）`)
  }
  if (!creds.access_key_id || !creds.access_key_secret) {
    throw new Error('Access Key 未配置')
  }

  // @alicloud/openapi-client 的 default export 是 namespace；Config 类在 .Config
  const cfg = new (OpenApi as any).Config({
    accessKeyId:     creds.access_key_id,
    accessKeySecret: creds.access_key_secret,
    endpoint:        creds.endpoint  || 'imageseg.cn-shanghai.aliyuncs.com',
    regionId:        creds.region_id || 'cn-shanghai',
  })

  // @alicloud/imageseg20191230 的 default export 是 client class
  const Client: any = (Imageseg as any).default || Imageseg
  const client = new Client(cfg)

  const req: any = new (SegmentHDCommonImageAdvanceRequest as any)({})
  req.imageUrlObject = createReadStream(localPath)

  const runtime = new RuntimeOptions({
    readTimeout:    90 * 1000,
    connectTimeout: 10 * 1000,
    autoretry:      false,
    maxAttempts:    1,
  })

  const start = Date.now()
  let resp: any
  try {
    resp = await client.segmentHDCommonImageAdvance(req, runtime)
  } catch (e: any) {
    throw normalizeError(e)
  }

  const body      = resp?.body || {}
  const requestId = body.requestId || ''
  const data      = body.data || null
  if (!data) {
    if (isAsyncSubmitted(body, requestId)) {
      return waitForAsyncResult(client, requestId, start, runtime)
    }
    throw new Error(`阿里抠图失败 [${body.code || ''}] ${body.message || '上游返回空 data'} (req=${requestId})`)
  }

  const imageUrl = pickImageUrl(data)
  if (!imageUrl) {
    if (isAsyncSubmitted(body, requestId)) {
      return waitForAsyncResult(client, requestId, start, runtime)
    }
    throw new Error(`阿里抠图返回 data.imageURL 为空 (req=${requestId})`)
  }

  return {
    image_url:  imageUrl,
    request_id: requestId,
    elapsed_ms: Date.now() - start,
  }
}

/**
 * 仅用于自检调用（不入库）：传 creds 跑一次抠图返回 URL，失败抛错。
 * 给 IPC matting:testProvider 用。
 */
export async function testCredentials(
  localPath: string,
  creds: AliyunCreds,
): Promise<MattingResult> {
  return segmentLocalFile(localPath, creds)
}

async function waitForAsyncResult(
  client: any,
  jobId: string,
  start: number,
  runtime: RuntimeOptions,
): Promise<MattingResult> {
  const deadline = Date.now() + ASYNC_TIMEOUT_MS

  while (Date.now() < deadline) {
    await sleep(ASYNC_POLL_INTERVAL_MS)

    let resp: any
    try {
      resp = await client.getAsyncJobResultWithOptions(
        new (GetAsyncJobResultRequest as any)({ jobId }),
        runtime,
      )
    } catch (e: any) {
      throw normalizeError(e)
    }

    const data = resp?.body?.data || null
    if (!data) continue

    const imageUrl = pickImageUrlFromAsyncResult(String(data.result || ''))
    if (imageUrl) {
      return {
        image_url:  imageUrl,
        request_id: jobId,
        elapsed_ms: Date.now() - start,
      }
    }

    const status = String(data.status || '').toUpperCase()
    if (['PROCESS_SUCCESS', 'SUCCESS', 'SUCCEEDED', 'COMPLETED'].includes(status)) {
      throw new Error(`阿里抠图异步任务成功但结果为空 (job=${jobId})`)
    }
    if (status.includes('FAIL') || status.includes('ERROR') || status.includes('TIMEOUT')) {
      throw new Error(`阿里抠图异步任务失败 [${data.errorCode || ''}] ${data.errorMessage || '异步任务失败'} (job=${jobId})`)
    }
  }

  throw new Error(`阿里抠图异步任务查询超时 (job=${jobId})`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isAsyncSubmitted(body: any, requestId: string): boolean {
  if (!requestId) return false
  const msg = String(body?.message || '')
  return msg.includes('GetAsyncJobResult') || msg.includes('异步调用') || msg.includes('jobId')
}

function pickImageUrl(data: any): string {
  return data?.imageURL || data?.imageUrl || data?.ImageUrl || data?.ImageURL || data?.image_url || ''
}

function pickImageUrlFromAsyncResult(result: string): string {
  try {
    const parsed = JSON.parse(result)
    const imageUrl = pickImageUrl(parsed)
    if (imageUrl) return imageUrl
  } catch {}

  const m = result.match(/https?:\/\/[^\s"\\]+/)
  return m?.[0] || ''
}

function normalizeError(e: any): Error {
  // TeaError 通常带 data: { Code, Message }
  const data = e?.data
  if (data && typeof data === 'object') {
    const msg  = data.Message || data.message || ''
    const code = data.Code || data.code || ''
    if (msg) return new Error(`${msg}${code ? ` [${code}]` : ''}`)
  }
  return new Error(e?.message || 'Unknown SDK error')
}
