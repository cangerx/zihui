import { getRuntimeConfig } from './runtime-config'
import { CLOUD_KEY_SEP } from '@shared/model-id'
import { BrowserWindow } from 'electron'

let cloudToken: string | null = null
let refreshing: Promise<string | null> | null = null
let lastRefreshFailureWasAuth = false

interface CloudPermissions {
  allow_custom_provider: boolean
  allow_custom_embedding: boolean
  /** 微信 ClawBot 使用权限（默认 false 拒绝；只控制能否使用，菜单显隐走菜单配置） */
  allow_clawbot?: boolean
}

// 默认：未登录 / 未拉到权限时，本地自定义模型可用（与主控端全员开放一致）
let cloudPermissions: CloudPermissions = {
  allow_custom_provider: true,
  allow_custom_embedding: true,
  allow_clawbot: false,
}

export interface CloudEmbeddingModel {
  id: number
  model_id: string
  name: string
}

/**
 * 云控端 cloud_models 表中一行的最小投影。
 * 由 renderer cloud-auth.ts fetchCloudData 拉到全量模型后，
 * 通过 IPC `cloud:setModels` 同步到 main 进程缓存中。
 * 用于发起云端推理/生图/向量请求前，把渲染层选择的复合 key
 * `{model_id}#@{provider_name}` 反查为云端唯一主键 `cloud_model_id`，
 * 解决多家服务商提供同名模型时云控端 `first()` 错位路由的 bug。
 */
export interface CloudModelEntry {
  id: number
  model_id: string
  name: string
  type: string
  provider_name: string
  provider_type?: string
}

// 渲染进程通过 fetchCloudData 同步过来的云端 embedding 模型列表
let cloudEmbeddingModels: CloudEmbeddingModel[] = []
// 用户在 SettingsView 选择的偏好云端 embedding 模型 model_id
let preferredCloudEmbeddingModel = ''
// 全量云端模型（chat/image/embedding 等），用于 resolveCloudModelId 反查主键
let cloudModels: CloudModelEntry[] = []

export function setCloudToken(token: string | null): void {
  cloudToken = token
}

export function getCloudToken(): string | null {
  return cloudToken
}

function notifyCloudTokenUpdated(token: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('cloud:tokenUpdated', { token })
  }
}

export function notifyCloudAuthExpired(reason: string): void {
  setCloudToken(null)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('cloud:authExpired', { reason })
  }
}

class CloudTokenRefreshTransientError extends Error {
  constructor(message = 'CLOUD_TOKEN_REFRESH_TRANSIENT') {
    super(message)
    this.name = 'CloudTokenRefreshTransientError'
  }
}

export function wasLastCloudTokenRefreshAuthFailure(): boolean {
  return lastRefreshFailureWasAuth
}

export async function refreshCloudToken(): Promise<string | null> {
  if (refreshing) return refreshing

  refreshing = (async () => {
    const startToken = getCloudToken()
    if (!startToken) return null
    lastRefreshFailureWasAuth = false

    try {
      const res = await fetch(`${getCloudApiBase()}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${startToken}`,
        },
      })
      if (!res.ok) {
        if (res.status !== 401 && res.status !== 403) {
          throw new CloudTokenRefreshTransientError(`CLOUD_TOKEN_REFRESH_HTTP_${res.status}`)
        }
        lastRefreshFailureWasAuth = true
        const currentToken = getCloudToken()
        return currentToken && currentToken !== startToken ? currentToken : null
      }
      const data = await res.json().catch(() => null)
      if (!data?.token) {
        const currentToken = getCloudToken()
        return currentToken && currentToken !== startToken ? currentToken : null
      }
      const currentToken = getCloudToken()
      if (currentToken !== startToken) return currentToken
      setCloudToken(data.token)
      notifyCloudTokenUpdated(data.token)
      return data.token
    } catch (e: any) {
      if (e instanceof CloudTokenRefreshTransientError) throw e
      const currentToken = getCloudToken()
      if (currentToken && currentToken !== startToken) return currentToken
      if (currentToken === startToken) throw new CloudTokenRefreshTransientError(e?.message || 'CLOUD_TOKEN_REFRESH_NETWORK')
      return null
    }
  })()

  try {
    return await refreshing
  } finally {
    refreshing = null
  }
}

export async function fetchWithCloudAuth(url: string, init: RequestInit = {}, reason = 'Cloud API 401'): Promise<Response> {
  const token = getCloudToken()
  if (!token) throw new Error('Cloud login required')
  const withToken = (t: string): RequestInit => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${t}`)
    const oemProjectKey = getRuntimeConfig().oemProjectKey.trim()
    if (oemProjectKey) headers.set('X-OEM-Project-Key', oemProjectKey)
    return { ...init, headers }
  }

  let res = await fetch(url, withToken(token))
  if (res.status !== 401) return res

  const nextToken = await refreshCloudToken()
  if (!nextToken) {
    if (wasLastCloudTokenRefreshAuthFailure()) notifyCloudAuthExpired(reason)
    return res
  }
  res = await fetch(url, withToken(nextToken))
  return res
}

// 云端「余额不足」结构化错误（主进程侧）：经 IPC 回传到渲染层后只剩 message，
// 故 message 统一用中文「余额不足…」，让渲染层 isBalanceError / friendlyMattingError 仍能识别。
export class CloudBalanceError extends Error {
  readonly code = 'INSUFFICIENT_BALANCE'
  balanceType: 'token' | 'credit'
  needed: number
  current: number
  constructor(message: string, opts: { balanceType?: string; needed?: number; current?: number } = {}) {
    super(message)
    this.name = 'CloudBalanceError'
    this.balanceType = opts.balanceType === 'token' ? 'token' : 'credit'
    this.needed = Number(opts.needed || 0)
    this.current = Number(opts.current || 0)
  }
}

/**
 * 统一处理云端失败响应：读 body 后抛友好错误。
 * - 402 → CloudBalanceError（中文「余额不足」，带额度类型/缺口）
 * - 其余 → 后端 error/message，兜底用 `${fallbackPrefix}(HTTP xxx)`
 * 供 cloud-matting / cloud-fine-matting / cloud-kb 等后端调用方替换裸 `HTTP ${status}`。
 */
export async function throwCloudHttpError(res: Response, fallbackPrefix = '云端请求失败'): Promise<never> {
  let data: any = null
  try {
    data = await res.clone().json()
  } catch {
    /* 非 JSON 响应 */
  }
  if (res.status === 402) {
    const balanceType = data?.balance_type === 'token' ? 'token' : 'credit'
    const label = balanceType === 'token' ? '金币' : '积分'
    throw new CloudBalanceError(data?.error || data?.message || `云端${label}余额不足，请充值或购买套餐后重试`, {
      balanceType,
      needed: Number(data?.needed || 0),
      current: Number(data?.current || 0),
    })
  }
  throw new Error(data?.error || data?.message || `${fallbackPrefix}(HTTP ${res.status})`)
}

/**
 * 非抛出版：把云端失败响应转成中文友好错误文案（供「返回 {ok:false,error} 而非抛错」的调用方）。
 * 402 → 余额不足；其余 → 后端 message/error，兜底 `${fallbackPrefix}(HTTP xxx)`。
 */
export function cloudErrorText(status: number, json: any, fallbackPrefix = '云端请求失败'): string {
  if (status === 402) {
    const label = json?.balance_type === 'token' ? '金币' : '积分'
    return json?.error || json?.message || `云端${label}余额不足，请充值或购买套餐后重试`
  }
  return json?.message || json?.error || `${fallbackPrefix}(HTTP ${status})`
}

export function getCloudApiBase(): string {
  return `${getRuntimeConfig().apiDomain}/api`
}

export function getCloudGatewayUrl(): string {
  return `${getCloudApiBase()}/gateway`
}

export function setCloudPermissions(perms: Partial<CloudPermissions>): void {
  cloudPermissions = { ...cloudPermissions, ...perms }
}

export function getAllowCustomProvider(): boolean {
  return cloudPermissions.allow_custom_provider
}

export function getAllowCustomEmbedding(): boolean {
  return cloudPermissions.allow_custom_embedding
}

/** 微信 ClawBot 使用权限：缺键（老云控端不下发）按 false 处理（默认拒绝） */
export function getAllowClawbot(): boolean {
  return cloudPermissions.allow_clawbot === true
}

export function setCloudEmbeddingModels(models: CloudEmbeddingModel[]): void {
  cloudEmbeddingModels = Array.isArray(models) ? models : []
}

export function getCloudEmbeddingModels(): CloudEmbeddingModel[] {
  return cloudEmbeddingModels
}

export function setPreferredCloudEmbeddingModel(modelId: string): void {
  preferredCloudEmbeddingModel = modelId || ''
}

export function getPreferredCloudEmbeddingModel(): string {
  return preferredCloudEmbeddingModel
}

/**
 * 当前生效的云端 embedding 模型 model_id：
 * 1. 用户偏好且仍在可用列表中 → 用偏好
 * 2. 否则取列表第一个
 * 3. 列表空 → 空字符串（调用方需返回错误：套餐未含向量模型）
 */
export function getActiveCloudEmbeddingModelId(): string {
  if (preferredCloudEmbeddingModel) {
    const hit = cloudEmbeddingModels.find((m) => m.model_id === preferredCloudEmbeddingModel)
    if (hit) return hit.model_id
  }
  return cloudEmbeddingModels[0]?.model_id || ''
}

export function setCloudModels(models: CloudModelEntry[]): void {
  cloudModels = Array.isArray(models) ? models : []
}

export function getCloudModels(): CloudModelEntry[] {
  return cloudModels
}

/**
 * 把渲染层选择的模型标识精确反查为云端 cloud_models 表主键。
 *
 * 输入 modelIdOrComposite 可能是：
 *   - 复合 key `{model_id}#@{provider_name}`：携带用户实际选中的服务商
 *   - 纯 model_id：老数据 / 老客户端兼容路径，不带服务商信息
 *
 * 返回：
 *   - pureModelId：剥离复合 key 后的纯 model_id，作为上游 OpenAI 协议 body.model 字段
 *   - cloudModelId：命中的云端主键。返回 null 时云控端 GatewayController 会
 *     回退到老的 `(model_id, type)` 查询（保持向后兼容）
 *
 * 命中规则：
 *   - 复合 key 且缓存里存在 (model_id, provider_name[, type]) 三元组 → 精准命中
 *   - 纯 model_id 但缓存里同 (model_id[, type]) 只有一条 → 唯一命中
 *   - 多家提供同名 model_id 且未带 provider_name → 返回 null（让后端兜底，保留旧行为）
 *
 * @param expectedType 可选过滤 'chat' | 'image' | 'embedding'，避免同名跨 type 冲突
 */
export function resolveCloudModelId(
  modelIdOrComposite: string | undefined | null,
  expectedType?: string,
): { pureModelId: string; cloudModelId: number | null } {
  if (!modelIdOrComposite) return { pureModelId: '', cloudModelId: null }
  const sepIdx = modelIdOrComposite.indexOf(CLOUD_KEY_SEP)
  const pureModelId =
    sepIdx === -1 ? modelIdOrComposite : modelIdOrComposite.slice(0, sepIdx)
  const providerName = sepIdx === -1 ? '' : modelIdOrComposite.slice(sepIdx + CLOUD_KEY_SEP.length)

  if (cloudModels.length === 0) {
    return { pureModelId, cloudModelId: null }
  }

  const candidates = expectedType
    ? cloudModels.filter((m) => m.type === expectedType)
    : cloudModels

  if (providerName) {
    const hit = candidates.find(
      (m) => m.model_id === pureModelId && m.provider_name === providerName,
    )
    if (hit) return { pureModelId, cloudModelId: hit.id }
    // 复合 key 携带了 provider_name 但缓存里找不到精确匹配：
    // 可能用户拉取模型列表后云控端管理员重命名了服务商，或者删除了该模型。
    // 不强行兜底命中其他同名行（避免再次陷入"错家扣费"），返回 null 让后端走老逻辑。
    return { pureModelId, cloudModelId: null }
  }

  // 纯 model_id：仅当唯一匹配时才精准命中，多家同名时返回 null 保持现状
  const matches = candidates.filter((m) => m.model_id === pureModelId)
  if (matches.length === 1) return { pureModelId, cloudModelId: matches[0].id }
  return { pureModelId, cloudModelId: null }
}
