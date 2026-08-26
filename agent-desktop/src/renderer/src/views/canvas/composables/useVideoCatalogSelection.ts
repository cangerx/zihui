import { ref } from 'vue'
import { cloudClient } from '@/utils/cloud-api'

/**
 * 流式画布 AI 视频节点的规格选择（复用云控端 L2 catalog）。
 *
 * L2 计费维度模型：SKU 只锁定「计费维度」（非空字段），未锁定（空）的维度由用户在模型
 * supported_* 内自选。本 composable 提供：catalog 加载（模块级缓存，多节点共享）+
 * 选项推导（按 SKU 是否锁定取自 SKU 或模型能力）+ 计费档匹配（仅按锁定维度匹配）。
 * 与 AiVideoView 的选择逻辑保持一致。
 */
export interface VideoSku {
  id: number
  sku_key: string
  title: string
  mode: string
  duration_seconds: number
  resolution: string
  aspect_ratio: string
  quality: string
  credit_cost: number
  price_label: string
}

export interface VideoModel {
  id: number
  provider_key: string
  provider_protocol: string
  model_id: string
  display_name: string
  generation_type: string
  supported_modes: string[]
  supported_durations: number[]
  supported_resolutions: string[]
  supported_aspect_ratios: string[]
  max_reference_images: number
  supported_ref_media?: string[]
  description: string
  skus: VideoSku[]
}

export interface VideoSpecSelection {
  mode: string
  duration: number | ''
  resolution: string
  aspect_ratio: string
}

// 模块级缓存：所有视频节点共享同一份 catalog，避免每个节点各拉一次
const catalogModels = ref<VideoModel[]>([])
const catalogEnabled = ref(false)
const catalogLoaded = ref(false)
let loadingPromise: Promise<void> | null = null

function uniqStr(arr: Array<string | undefined | null>): string[] {
  return Array.from(new Set((arr || []).filter((v): v is string => Boolean(v))))
}

function uniqNum(arr: Array<number | string | undefined | null>): number[] {
  return Array.from(new Set((arr || []).map((v) => Number(v)).filter((n) => Number.isFinite(n)))).sort((a, b) => a - b)
}

export function useVideoCatalogSelection() {
  async function loadCatalog(force = false): Promise<void> {
    if (catalogLoaded.value && !force) return
    if (loadingPromise) return loadingPromise
    loadingPromise = (async () => {
      try {
        const res = await cloudClient.videoCatalog()
        catalogEnabled.value = Boolean(res?.enabled)
        catalogModels.value = Array.isArray(res?.models) ? res.models : []
        catalogLoaded.value = true
      } finally {
        loadingPromise = null
      }
    })()
    return loadingPromise
  }

  function getModel(modelId: string): VideoModel | null {
    return catalogModels.value.find((m) => m.model_id === modelId) || null
  }

  // 某维度是否被 SKU 锁定（该模型所有 SKU 该字段都非空）= 计费/固定维度
  function skuLocks(model: VideoModel | null, field: 'mode' | 'resolution' | 'aspect_ratio'): boolean {
    const skus = model?.skus || []
    return skus.length > 0 && skus.every((s) => String((s as any)[field] ?? '') !== '')
  }

  function skuLocksDuration(model: VideoModel | null): boolean {
    const skus = model?.skus || []
    return skus.length > 0 && skus.every((s) => Number(s.duration_seconds) > 0)
  }

  function modeOptions(model: VideoModel | null): string[] {
    if (!model) return []
    return skuLocks(model, 'mode') ? uniqStr(model.skus.map((s) => s.mode)) : uniqStr(model.supported_modes)
  }

  function durationOptions(model: VideoModel | null): number[] {
    if (!model) return []
    return skuLocksDuration(model) ? uniqNum(model.skus.map((s) => s.duration_seconds)) : uniqNum(model.supported_durations)
  }

  function resolutionOptions(model: VideoModel | null): string[] {
    if (!model) return []
    return skuLocks(model, 'resolution') ? uniqStr(model.skus.map((s) => s.resolution)) : uniqStr(model.supported_resolutions)
  }

  function aspectRatioOptions(model: VideoModel | null): string[] {
    if (!model) return []
    return skuLocks(model, 'aspect_ratio') ? uniqStr(model.skus.map((s) => s.aspect_ratio)) : uniqStr(model.supported_aspect_ratios)
  }

  // 计费档匹配：仅按 SKU 锁定（非空）的维度匹配；未锁定（空）的维度不参与匹配
  function matchSku(model: VideoModel | null, sel: VideoSpecSelection): VideoSku | null {
    if (!model) return null
    return (model.skus || []).find((s) =>
      (Number(s.duration_seconds) === 0 || Number(s.duration_seconds) === Number(sel.duration)) &&
      (String(s.resolution ?? '') === '' || (s.resolution || s.quality) === sel.resolution) &&
      (String(s.mode ?? '') === '' || s.mode === sel.mode) &&
      (String(s.aspect_ratio ?? '') === '' || s.aspect_ratio === sel.aspect_ratio)
    ) || null
  }

  // 规格选择归一化：当前值不在选项内时回落到首个可选值。返回归一后的选择。
  function normalizeSelection(model: VideoModel | null, sel: VideoSpecSelection): VideoSpecSelection {
    if (!model) return { mode: '', duration: '', resolution: '', aspect_ratio: '' }
    const modes = modeOptions(model)
    const durations = durationOptions(model)
    const resolutions = resolutionOptions(model)
    const ratios = aspectRatioOptions(model)
    return {
      mode: modes.includes(sel.mode) ? sel.mode : (modes[0] || ''),
      duration: durations.includes(Number(sel.duration)) ? sel.duration : (durations[0] ?? ''),
      resolution: resolutions.includes(sel.resolution) ? sel.resolution : (resolutions[0] || ''),
      aspect_ratio: ratios.includes(sel.aspect_ratio) ? sel.aspect_ratio : (ratios[0] || ''),
    }
  }

  return {
    catalogModels,
    catalogEnabled,
    catalogLoaded,
    loadCatalog,
    getModel,
    skuLocks,
    skuLocksDuration,
    modeOptions,
    durationOptions,
    resolutionOptions,
    aspectRatioOptions,
    matchSku,
    normalizeSelection,
  }
}
