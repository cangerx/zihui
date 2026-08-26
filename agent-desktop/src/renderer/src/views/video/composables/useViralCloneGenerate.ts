import { computed, ref, watch, type Ref } from 'vue'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { cloudClient } from '@/utils/cloud-api'
import { dataUriToBlob, pickFromLocal } from '@/utils/image-source'
import { translateError } from '@/utils/error-message'
import { useVideoCatalogSelection } from '@/views/canvas/composables/useVideoCatalogSelection'
import type { CloneGenerateStrategy, CloneProject, CloneShot } from '@shared/clone-doc'

const QUICK_MAX_SECONDS = 15.5

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function dataUrlToFile(dataUrl: string, name: string): File {
  const blob = dataUriToBlob(dataUrl)
  return new File([blob], name, { type: blob.type || 'image/jpeg' })
}

function localVideoSrc(path: string): string {
  if (/^(https?:|blob:|file:)/i.test(path)) return path
  const isAbsolute = /^[A-Za-z]:|^\//.test(path)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://video?' + param + '=' + encodeURIComponent(path)
}

async function fileFromLocalVideo(path: string, name: string): Promise<File> {
  const resp = await fetch(localVideoSrc(path))
  if (!resp.ok) throw new Error('无法读取本地参考视频')
  const blob = await resp.blob()
  if (blob.size > 50 * 1024 * 1024) throw new Error('参考视频超过 50MB，请先压缩或改用分镜复刻')
  return new File([blob], name || 'reference.mp4', { type: blob.type || 'video/mp4' })
}

function closestDuration(options: number[], want: number): number {
  if (!options.length) return Math.max(5, Math.round(want) || 5)
  const sorted = [...options].sort((a, b) => a - b)
  return sorted.find((d) => d >= want - 0.15) || sorted[sorted.length - 1]
}

function shotPrompt(shot: CloneShot): string {
  const parts = [shot.visual_prompt, shot.camera ? `运镜：${shot.camera}` : '', shot.overlay ? `字幕/贴纸：${shot.overlay}` : '']
  return parts.filter(Boolean).join('。').trim()
}

function cloneApi() {
  const api = window.api?.viralClone
  if (!api?.invoke) throw new Error('请完全退出后重新打开应用，以加载爆款复刻')
  return api
}

export function useViralCloneGenerate(project: Ref<CloneProject>) {
  const cloudAuth = useCloudAuthStore()
  const catalog = useVideoCatalogSelection()
  const strategy = ref<CloneGenerateStrategy>('shots')
  const modelId = ref('')
  const mode = ref('')
  const duration = ref<number | ''>('')
  const resolution = ref('')
  const aspectRatio = ref('')
  const generating = ref(false)
  const stage = ref('')
  const error = ref('')
  const ttsWarning = ref('')
  const cancelRequested = ref(false)
  const enableTts = ref(false)
  const ttsVoice = ref('')
  const ttsProviders = ref<Array<{ id: number; name: string; voice_default?: string }>>([])

  const selectedModel = computed(() => catalog.getModel(modelId.value))
  const modeOptions = computed(() => catalog.modeOptions(selectedModel.value).filter((m) => m !== 'first_last_frame' || strategy.value === 'shots'))
  const durationOptions = computed(() => catalog.durationOptions(selectedModel.value))
  const resolutionOptions = computed(() => catalog.resolutionOptions(selectedModel.value))
  const aspectRatioOptions = computed(() => catalog.aspectRatioOptions(selectedModel.value))
  const selectedSku = computed(() => catalog.matchSku(selectedModel.value, {
    mode: mode.value,
    duration: duration.value,
    resolution: resolution.value,
    aspect_ratio: aspectRatio.value
  }))
  const supportsVideoRef = computed(() => {
    const protocol = (selectedModel.value?.provider_protocol || '').toLowerCase()
    const media = selectedModel.value?.supported_ref_media || []
    const wan = ['wan', 'wan3', 'wan3.0', 'wan3.0-video', 'dashscope', 'dashscope_compatible'].includes(protocol)
    return protocol === 'seedance' || wan || media.includes('video')
  })
  const quickAvailable = computed(() =>
    project.value.source.duration > 0 && project.value.source.duration <= QUICK_MAX_SECONDS
  )
  const outputSrc = computed(() => {
    const path = project.value.output.local_path
    return path ? localVideoSrc(path) : ''
  })

  watch([modelId, strategy], () => {
    const next = catalog.normalizeSelection(selectedModel.value, {
      mode: mode.value,
      duration: duration.value,
      resolution: resolution.value,
      aspect_ratio: aspectRatio.value
    })
    if (strategy.value === 'quick' && next.mode === 'first_last_frame') {
      const fallback = modeOptions.value.find((m) => m !== 'first_last_frame') || ''
      next.mode = fallback
    }
    mode.value = next.mode
    duration.value = next.duration
    resolution.value = next.resolution
    aspectRatio.value = next.aspect_ratio
  })

  watch(quickAvailable, (ok) => {
    if (!ok && strategy.value === 'quick') strategy.value = 'shots'
  })

  async function ensureCatalog() {
    if (!cloudAuth.isLoggedIn) throw new Error('请先登录云控端，成片走云控视频模型')
    await catalog.loadCatalog()
    if (!catalog.catalogEnabled.value) throw new Error('当前账号未开通 AI 视频')
    if (!catalog.catalogModels.value.length) throw new Error('暂无可用视频模型，请先在云控端上架 SKU')
    if (!modelId.value && catalog.catalogModels.value[0]) modelId.value = catalog.catalogModels.value[0].model_id
    try {
      const res = await cloudClient.ttsCatalog() as { providers?: Array<{ id: number; name: string; voice_default?: string }> }
      ttsProviders.value = Array.isArray(res?.providers) ? res.providers : []
    } catch {
      ttsProviders.value = []
    }
  }

  async function pickProductImages() {
    const paths = await pickFromLocal({ multiple: true, title: '选择商品 / 主体图' })
    if (!paths.length) return
    const merged = Array.from(new Set([...project.value.product.image_paths, ...paths])).slice(0, 4)
    project.value.product.image_paths = merged
  }

  function removeProduct(path: string) {
    project.value.product.image_paths = project.value.product.image_paths.filter((p) => p !== path)
  }

  async function uploadImageDataUrl(dataUrl: string, name: string, role: string, index: number) {
    const file = dataUrlToFile(dataUrl, name)
    const res = await cloudClient.uploadVideoReference(file, 'image')
    const asset = res?.asset
    if (!asset?.url && !asset?.storage_url) throw new Error('参考图上传失败')
    return {
      asset_type: 'image',
      url: asset.url || asset.storage_url,
      role,
      index,
      original_name: name,
      label: name
    }
  }

  async function uploadProductImages(startIndex = 1) {
    const assets: Array<Record<string, any>> = []
    for (let i = 0; i < project.value.product.image_paths.length; i++) {
      const path = project.value.product.image_paths[i]
      const raw = await window.api.chat.invoke('readFileBase64', path) as string
      const ext = (path.split('.').pop() || 'jpg').toLowerCase()
      const mime = ext === 'png' ? 'png' : 'jpeg'
      const dataUrl = `data:image/${mime};base64,${raw}`
      assets.push(await uploadImageDataUrl(dataUrl, path.split(/[/\\]/).pop() || `product-${i + 1}.jpg`, 'reference', startIndex + i))
    }
    return assets
  }

  async function waitAndSave(task: any): Promise<{ path: string; taskId: string }> {
    let current = task
    for (let i = 0; i < 90; i++) {
      if (cancelRequested.value) throw new Error('已取消')
      await window.api.videoGen.invoke('syncTask', {
        task: current,
        requestParams: {
          mode: mode.value,
          duration_seconds: Number(duration.value) || 0,
          resolution: resolution.value,
          aspect_ratio: aspectRatio.value,
          quality: selectedSku.value?.quality || ''
        }
      })
      const status = String(current?.status || '')
      if (status === 'completed') {
        const saved = await window.api.videoGen.invoke('save', current.id) as { success?: boolean; item?: { local_path?: string }; error?: string }
        const localPath = saved?.item?.local_path || ''
        if (!localPath) throw new Error(saved?.error || '视频已生成但未能保存到本地，请到视频创作页手动保存')
        const abs = await cloneApi().invoke('resolvePath', localPath) as string
        return { path: abs || localPath, taskId: String(current.id) }
      }
      if (status === 'failed' || status === 'canceled') {
        throw new Error(current?.error_message || current?.error || '视频生成失败')
      }
      await sleep(4000)
      const res = await cloudClient.refreshVideoTask(current.id)
      current = res?.task || current
    }
    throw new Error('视频生成超时')
  }

  async function submitOne(prompt: string, assets: Array<Record<string, any>>, durationSeconds: number) {
    const sku = selectedSku.value
    const model = selectedModel.value
    if (!sku || !model) throw new Error('请选择可用的视频规格')
    const imageUrls = assets.filter((a) => a.asset_type === 'image').map((a) => a.url)
    const videoUrls = assets.filter((a) => a.asset_type === 'video').map((a) => a.url)
    const res = await cloudClient.submitVideoTask({
      sku_key: sku.sku_key,
      prompt,
      mode: mode.value || sku.mode,
      duration_seconds: durationSeconds || Number(duration.value) || sku.duration_seconds,
      resolution: resolution.value || sku.resolution,
      aspect_ratio: aspectRatio.value || sku.aspect_ratio,
      quality: sku.quality,
      reference_assets: assets,
      reference_image_urls: imageUrls,
      reference_video_urls: videoUrls
    })
    const task = res?.task
    if (!task?.id) throw new Error('视频任务提交失败')
    return waitAndSave(task)
  }

  async function generateQuick() {
    if (!quickAvailable.value) throw new Error('参考片超过 15 秒，请改用分镜复刻')
    if (!supportsVideoRef.value) throw new Error('当前模型不支持参考视频。请换 Seedance，或改用分镜复刻')
    if (mode.value === 'first_last_frame') throw new Error('快捷复刻不能用首尾帧（与参考视频互斥）')
    const videoFile = await fileFromLocalVideo(project.value.source.path, project.value.source.name || 'ref.mp4')
    const uploaded = await cloudClient.uploadVideoReference(videoFile, 'video')
    const videoUrl = uploaded?.asset?.url || uploaded?.asset?.storage_url
    if (!videoUrl) throw new Error('参考视频上传失败')
    const assets: Array<Record<string, any>> = [{
      asset_type: 'video',
      url: videoUrl,
      role: 'reference',
      index: 1,
      original_name: project.value.source.name,
      label: '参考视频'
    }]
    assets.push(...await uploadProductImages(2))
    const prompt = project.value.shots.map((s) => shotPrompt(s)).filter(Boolean).join('\n')
      || '按参考视频的节奏和镜头结构生成一条新的短视频，替换为商品主体。'
    const want = Math.min(project.value.source.duration || 5, 15)
    const dur = closestDuration(durationOptions.value, want)
    const result = await submitOne(`${prompt}\n用视频1的节奏，画面换成图中的商品/主体。`, assets, dur)
    project.value.output.local_path = result.path
    project.value.generate.per_shot_task_ids = result.taskId ? [result.taskId] : []
    project.value.shots.forEach((shot) => {
      shot.status = 'done'
      shot.local_path = result.path
      shot.task_id = result.taskId
      shot.error = ''
    })
  }

  async function generateOneShot(shot: CloneShot) {
    shot.status = 'running'
    shot.error = ''
    const want = Math.max(1, Number(shot.t1) - Number(shot.t0) || 5)
    const dur = closestDuration(durationOptions.value, want)
    const assets: Array<Record<string, any>> = []
    if (mode.value === 'first_last_frame') {
      const first = await cloneApi().invoke('extractFrameAt', project.value.source.path, shot.t0) as { dataUrl: string }
      const last = await cloneApi().invoke('extractFrameAt', project.value.source.path, Math.max(shot.t0, shot.t1 - 0.12)) as { dataUrl: string }
      assets.push(await uploadImageDataUrl(first.dataUrl, `${shot.id}-first.jpg`, 'first_frame', 1))
      assets.push(await uploadImageDataUrl(last.dataUrl, `${shot.id}-last.jpg`, 'last_frame', 2))
    } else {
      const products = await uploadProductImages(1)
      if (products.length) {
        assets.push(...products)
      } else {
        const frame = await cloneApi().invoke('extractFrameAt', project.value.source.path, shot.t0) as { dataUrl: string }
        assets.push(await uploadImageDataUrl(frame.dataUrl, `${shot.id}-frame.jpg`, 'reference', 1))
      }
    }
    const prompt = shotPrompt(shot) || '根据参考图生成对应镜头的短视频。'
    const result = await submitOne(prompt, assets, dur)
    shot.status = 'done'
    shot.local_path = result.path
    shot.task_id = result.taskId
    shot.error = ''
    const ids = project.value.generate.per_shot_task_ids.filter((id) => id !== result.taskId)
    project.value.generate.per_shot_task_ids = [...ids, result.taskId]
  }

  async function concatShots() {
    const paths = project.value.shots.map((s) => s.local_path).filter((p): p is string => Boolean(p))
    if (paths.length < project.value.shots.length) throw new Error('还有镜头未生成成功，无法拼接')
    const base = (project.value.source.name || 'clone').replace(/\.[^.]+$/, '')
    const destName = `${base}-复刻-${Date.now()}.mp4`
    const result = await cloneApi().invoke('concat', paths, destName) as { filePath?: string }
    if (!result?.filePath) throw new Error('拼接失败')
    project.value.output.local_path = result.filePath
  }

  function persistGenerateMeta() {
    project.value.generate = {
      strategy: strategy.value,
      protocol: selectedModel.value?.provider_protocol || '',
      model: modelId.value,
      sku_key: selectedSku.value?.sku_key || '',
      mode: mode.value,
      resolution: resolution.value,
      ratio: aspectRatio.value,
      duration_seconds: Number(duration.value) || 0,
      per_shot_task_ids: project.value.generate.per_shot_task_ids || [],
      tts_enabled: enableTts.value,
      tts_voice: ttsVoice.value
    }
    project.value.updated_at = new Date().toISOString()
  }

  async function muxIfNeeded() {
    if (!enableTts.value || !project.value.output.local_path) return
    const chunks = project.value.shots.map((s) => ({
      text: String(s.vo_text || '').trim(),
      durationSeconds: Math.max(0.4, Number(s.t1) - Number(s.t0) || 1)
    }))
    if (!chunks.some((c) => c.text)) return
    stage.value = '正在配音…'
    const base = (project.value.source.name || 'clone').replace(/\.[^.]+$/, '')
    const destName = `${base}-复刻-配音-${Date.now()}.mp4`
    const muxed = await cloneApi().invoke('muxVoiceover', project.value.output.local_path, chunks, destName, {
      voice: ttsVoice.value || undefined
    }) as { filePath?: string }
    if (muxed?.filePath) project.value.output.local_path = muxed.filePath
  }

  async function generateAll() {
    generating.value = true
    cancelRequested.value = false
    error.value = ''
    ttsWarning.value = ''
    stage.value = '准备生成…'
    try {
      await ensureCatalog()
      if (!selectedSku.value) throw new Error('当前规格暂无可用计费档')
      persistGenerateMeta()
      if (strategy.value === 'quick') {
        stage.value = '正在快捷复刻整段…'
        await generateQuick()
      } else {
        if (!project.value.shots.length) throw new Error('请先拆解出分镜')
        for (let i = 0; i < project.value.shots.length; i++) {
          if (cancelRequested.value) throw new Error('已取消')
          const shot = project.value.shots[i]
          if (shot.status === 'done' && shot.local_path) continue
          stage.value = `正在生成第 ${i + 1}/${project.value.shots.length} 镜…`
          try {
            await generateOneShot(shot)
          } catch (e) {
            shot.status = 'error'
            shot.error = translateError(e instanceof Error ? e.message : String(e))
            throw e
          }
        }
        stage.value = '正在拼接成片…'
        await concatShots()
      }
      try {
        await muxIfNeeded()
      } catch (e) {
        ttsWarning.value = translateError(e instanceof Error ? e.message : String(e)) || '配音失败，成片画面已保留'
      }
      persistGenerateMeta()
    } catch (e) {
      error.value = translateError(e instanceof Error ? e.message : String(e)) || '成片失败'
      throw e
    } finally {
      generating.value = false
      stage.value = ''
    }
  }

  async function regenerateShot(shot: CloneShot) {
    generating.value = true
    cancelRequested.value = false
    error.value = ''
    try {
      await ensureCatalog()
      if (!selectedSku.value) throw new Error('当前规格暂无可用计费档')
      if (strategy.value === 'quick') throw new Error('快捷复刻是整段生成，请用「开始成片」重跑')
      stage.value = '正在重跑这一镜…'
      shot.local_path = ''
      await generateOneShot(shot)
      if (project.value.shots.every((s) => s.status === 'done' && s.local_path)) {
        stage.value = '正在拼接成片…'
        await concatShots()
        try {
          await muxIfNeeded()
        } catch (e) {
          ttsWarning.value = translateError(e instanceof Error ? e.message : String(e)) || '配音失败，成片画面已保留'
        }
      }
      persistGenerateMeta()
    } catch (e) {
      error.value = translateError(e instanceof Error ? e.message : String(e)) || '重跑失败'
      throw e
    } finally {
      generating.value = false
      stage.value = ''
    }
  }

  function cancelGenerate() {
    cancelRequested.value = true
  }

  return {
    cloudAuth,
    catalog,
    strategy,
    modelId,
    mode,
    duration,
    resolution,
    aspectRatio,
    generating,
    stage,
    error,
    ttsWarning,
    enableTts,
    ttsVoice,
    ttsProviders,
    selectedModel,
    selectedSku,
    modeOptions,
    durationOptions,
    resolutionOptions,
    aspectRatioOptions,
    supportsVideoRef,
    quickAvailable,
    outputSrc,
    ensureCatalog,
    pickProductImages,
    removeProduct,
    generateAll,
    regenerateShot,
    cancelGenerate
  }
}
