export type LocalVideoStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

export interface LocalVideoCapabilities {
  modes: string[]
  durations: number[]
  resolutions: string[]
  aspectRatios: string[]
  maxReferenceImages: number
  supportsCancel: boolean
}

export interface LocalVideoCatalogItem {
  providerId: string
  providerName: string
  adapter: string
  modelId: string
  displayName: string
  capabilities: LocalVideoCapabilities
}

export interface SubmitLocalVideoInput {
  providerId: string
  modelId: string
  prompt: string
  negativePrompt?: string
  mode?: string
  durationSeconds?: number
  resolution?: string
  aspectRatio?: string
  referenceImageUrls?: string[]
  idempotencyKey?: string
}

export interface LocalVideoRemoteTask {
  providerTaskId: string
  status: LocalVideoStatus
  progress: number
  remoteUrl?: string
  coverUrl?: string
  error?: string
  raw?: unknown
}

export const DEFAULT_LOCAL_VIDEO_CAPABILITIES: LocalVideoCapabilities = {
  modes: ['text_to_video', 'image_to_video'],
  durations: [5, 10],
  resolutions: ['720p', '1080p'],
  aspectRatios: ['16:9', '9:16', '1:1'],
  maxReferenceImages: 1,
  supportsCancel: false,
}

export function validateLocalVideoInput(input: SubmitLocalVideoInput, caps: LocalVideoCapabilities): void {
  if (!input.prompt.trim()) throw new Error('请输入视频描述')
  if (input.mode && !caps.modes.includes(input.mode)) throw new Error(`当前模型不支持模式：${input.mode}`)
  if (input.durationSeconds && !caps.durations.includes(input.durationSeconds)) throw new Error(`当前模型不支持 ${input.durationSeconds} 秒`)
  if (input.resolution && !caps.resolutions.includes(input.resolution)) throw new Error(`当前模型不支持分辨率：${input.resolution}`)
  if (input.aspectRatio && !caps.aspectRatios.includes(input.aspectRatio)) throw new Error(`当前模型不支持画幅：${input.aspectRatio}`)
  if ((input.referenceImageUrls?.length || 0) > caps.maxReferenceImages) {
    throw new Error(`当前模型最多支持 ${caps.maxReferenceImages} 张参考图`)
  }
}
