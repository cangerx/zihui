// 电商生图编排 composable。
//
// 复用现有能力，不新增主进程代码：
//   - 生图：window.api.imageGen.invoke('generate', options)（每次一张，n=1）
//   - 描述词：window.api.llm.invoke('call', providerId, modelId, messages)
//
// 两种执行模式：
//   1) 一步直出（batchsku）：页面自行构造 jobs（含固定 prompt + 参考图），调 run()。
//   2) 两步法（其余）：先 generatePrompts() 拿 N 条描述词，再构造 jobs 调 run()。
//
// 进度用独立 source='ecom'，不污染 AI 生图的 image-gen store。

import { toRefs, watch, onBeforeUnmount } from 'vue'
import { translateError } from '@/utils/error-message'
import type { ImageGeneration } from '@/stores/image-gen'
import { useEcomGenStore } from '@/stores/ecom-gen'
import type { EcomGenParams, EcomGenTask } from './types'
import { localFileUrl, parsePromptList } from './utils'

const api = () => (window as any).api

/** 粗判错误是否因"模型不支持图片/视觉输入"而起，用于多模态失败后去图回退。 */
function looksLikeVisionUnsupportedError(msg?: string): boolean {
  const s = (msg || '').toLowerCase()
  if (!s) return false
  return /image|vision|multimodal|modality|图片|图像|视觉|多模态/.test(s)
}

/** 单个生成任务的输入。 */
export interface GenJob {
  id: string
  label: string
  /** 最终生图提示词（内部使用，不展示给用户） */
  prompt: string
  /** 参考图 dataURL 数组（图序由调用方保证，如 [模板, 产品]） */
  refImages: string[]
}

/** 描述词生成所需的 LLM 选择。 */
export interface LlmChoice {
  providerId: string
  modelId: string
}

export function useEcomGen(scopeKey = 'ecom:default') {
  // 状态来自全局 store 的对应分桶：路由切走、组件销毁后状态仍在；切回时本 composable
  // 重新 toRefs 拿到同一份桶 → 网格 / 进度 / 错误自动恢复。即便组件已销毁，run() 的游离
  // runPool 回写的也是这同一份 tasks（响应式），切回能继续看到实时进度直到完成。
  const store = useEcomGenStore()
  const scope = store.scope(scopeKey)
  const { tasks, generating, phase, lastError, cancelled } = toRefs(scope)

  /**
   * 两步法第一步：让 LLM 产出 N 条生图描述词。
   * systemPrompt 中的 {count} 占位会被替换。失败时抛错，由调用方决定是否回退。
   */
  async function generatePrompts(
    llm: LlmChoice,
    systemPrompt: string,
    userPrompt: string,
    count: number,
    opts: { images?: string[] } = {},
  ): Promise<string[]> {
    if (!llm.providerId || !llm.modelId) {
      throw new Error('请先选择用于生成描述词的对话模型')
    }
    const sys = systemPrompt.replace(/\{count\}/g, String(count))
    const images = (opts.images || []).filter(Boolean)

    // 多模态消息：把参考图随 user 消息一并发给描述词模型（OpenAI content 数组格式），
    // 让其据图撰写更贴合真实产品/风格的描述词。withImages=false 时退回纯文本。
    const callOnce = async (withImages: boolean): Promise<string> => {
      const userMsg =
        withImages && images.length
          ? {
              role: 'user',
              content: [
                { type: 'text', text: userPrompt },
                ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
              ],
            }
          : { role: 'user', content: userPrompt }
      const raw = await api().llm.invoke('call', llm.providerId, llm.modelId, [
        { role: 'system', content: sys },
        userMsg,
      ])
      return typeof raw === 'string' ? raw : String(raw?.content ?? raw ?? '')
    }

    let content: string
    if (images.length) {
      // gate_retry 降级：带图调用；若失败且错误像"模型不支持图片/视觉"，自动去图重试一次（纯文本盲写）。
      try {
        content = await callOnce(true)
      } catch (e: any) {
        if (looksLikeVisionUnsupportedError(e?.message)) {
          content = await callOnce(false)
        } else {
          throw e
        }
      }
    } else {
      content = await callOnce(false)
    }

    const list = parsePromptList(content, count)
    if (!list.length) throw new Error('描述词生成失败，请重试')
    return list
  }

  /** 简单并发池。 */
  async function runPool<T>(
    items: T[],
    worker: (item: T) => Promise<void>,
    concurrency: number,
  ): Promise<void> {
    let idx = 0
    const size = Math.max(1, Math.min(concurrency, items.length))
    const runners = Array.from({ length: size }, async () => {
      while (idx < items.length) {
        const cur = items[idx]
        idx += 1
        await worker(cur)
      }
    })
    await Promise.all(runners)
  }

  /** 调一次生图网关，返回结果或抛错。 */
  async function generateOne(job: GenJob, params: EcomGenParams): Promise<ImageGeneration | null> {
    const options = {
      prompt: job.prompt,
      refImages: job.refImages.length ? job.refImages : undefined,
      modelProviderId: params.modelProviderId,
      modelId: params.modelId, // 复合 key 原样透传，主进程负责 strip + 路由
      size: params.size,
      tierId: params.tierId,
      quality: params.quality,
      batchCount: 1,
      progressContext: { source: 'ecom' },
    }
    const results = (await api().imageGen.invoke('generate', options)) as ImageGeneration[]
    return results?.[0] ?? null
  }

  /**
   * 执行一批 jobs（并发）。tasks 会被重置为这批任务并实时更新状态。
   * @param append 为 true 时把任务追加到现有 tasks（单独重试场景用）。
   */
  async function run(
    jobs: GenJob[],
    params: EcomGenParams,
    opts: { concurrency?: number; append?: boolean } = {},
  ): Promise<void> {
    if (!jobs.length) return
    if (!params.modelProviderId || !params.modelId) {
      lastError.value = '请先选择生图模型'
      return
    }
    const newTasks: EcomGenTask[] = jobs.map((j) => ({
      id: j.id,
      label: j.label,
      prompt: j.prompt,
      status: 'pending',
      resultPath: '',
      url: '',
      error: '',
    }))
    tasks.value = opts.append ? [...tasks.value, ...newTasks] : newTasks
    generating.value = true
    phase.value = 'generating'
    cancelled.value = false
    try {
      await runPool(
        jobs,
        async (job) => {
          const t = tasks.value.find((x) => x.id === job.id)
          if (!t) return
          if (cancelled.value) {
            if (t.status === 'pending') {
              t.status = 'error'
              t.error = '已取消'
            }
            return
          }
          t.status = 'loading'
          try {
            const r = await generateOne(job, params)
            if (r && r.status === 'done' && r.result_path) {
              t.status = 'success'
              t.resultPath = r.result_path
              t.url = localFileUrl(r.result_path)
            } else {
              t.status = 'error'
              t.error = translateError(r?.error || '生成失败')
            }
          } catch (e: any) {
            t.status = 'error'
            t.error = translateError(e?.message || '生成失败')
          }
        },
        opts.concurrency ?? 3,
      )
    } finally {
      generating.value = false
      phase.value = ''
    }
  }

  /** 重试单个失败任务。 */
  async function retry(job: GenJob, params: EcomGenParams): Promise<void> {
    const t = tasks.value.find((x) => x.id === job.id)
    if (t) {
      t.status = 'loading'
      t.error = ''
    }
    try {
      const r = await generateOne(job, params)
      const cur = tasks.value.find((x) => x.id === job.id)
      if (!cur) return
      if (r && r.status === 'done' && r.result_path) {
        cur.status = 'success'
        cur.resultPath = r.result_path
        cur.url = localFileUrl(r.result_path)
      } else {
        cur.status = 'error'
        cur.error = translateError(r?.error || '生成失败')
      }
    } catch (e: any) {
      const cur = tasks.value.find((x) => x.id === job.id)
      if (cur) {
        cur.status = 'error'
        cur.error = translateError(e?.message || '生成失败')
      }
    }
  }

  /** 软取消当前批次：停止启动新任务（在途请求会自然完成）。 */
  function cancel(): void {
    if (generating.value) cancelled.value = true
  }

  function reset(): void {
    tasks.value = []
    lastError.value = ''
    phase.value = ''
  }

  return { tasks, generating, phase, lastError, generatePrompts, run, retry, cancel, reset }
}

/**
 * 表单持久化：把视图的若干 reactive 表单对象（form / params / llm 等）与全局 scope 绑定。
 *
 * - 挂载时：若 scope 里已有快照，则合并回各 reactive 对象（恢复用户上次输入）。
 * - 之后：深度 watch，任意改动即写回 scope（JSON 快照，含上传图的 base64）。
 *
 * 组件卸载时该 watch 自动停止；scope 数据仍留在 store，切回重新挂载即可恢复。
 *
 * @param scopeKey 与 useEcomGen 同一个 key
 * @param forms 形如 { form, params, llm } 的 reactive 对象表
 */
export function useEcomFormPersist(scopeKey: string, forms: Record<string, object>): void {
  const store = useEcomGenStore()
  const scope = store.scope(scopeKey)
  const saved = scope.form
  if (saved && Object.keys(saved).length) {
    for (const k of Object.keys(forms)) {
      if (saved[k]) Object.assign(forms[k] as Record<string, any>, saved[k])
    }
  }
  // 表单可能含多张上传图的 base64（数 MB），不能每次按键都全量 JSON.stringify：
  // 用 debounce 合并高频改动；组件卸载（切走页面）前再 flush 一次，保证最新输入被保存。
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    const snap: Record<string, any> = {}
    for (const k of Object.keys(forms)) snap[k] = JSON.parse(JSON.stringify(forms[k]))
    scope.form = snap
  }
  watch(
    Object.values(forms),
    () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, 400)
    },
    { deep: true },
  )
  onBeforeUnmount(() => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    flush()
  })
}

/**
 * 模型选择记忆：让 5 个电商功能跨应用重启、且互相共享上次选用的「生图模型 / 描述词模型」。
 *
 * 与 useEcomFormPersist 协作（须在其之后调用）：
 * - useEcomFormPersist 已恢复 per-scope 内存快照（含本次运行选过的模型）；
 * - 这里仅在模型仍为空（重启后首次、或该功能本次运行没选过）时用全局偏好回填；
 * - 之后任意一处改了模型即写回全局偏好（localStorage），其他功能下次进入即可复用。
 */
export function useEcomModelPref(params: EcomGenParams, llm?: LlmChoice): void {
  const store = useEcomGenStore()
  const pref = store.loadModelPref()
  if (!params.modelProviderId && pref.imageProviderId) params.modelProviderId = pref.imageProviderId
  if (!params.modelId && pref.imageModelId) params.modelId = pref.imageModelId
  if (llm) {
    if (!llm.providerId && pref.llmProviderId) llm.providerId = pref.llmProviderId
    if (!llm.modelId && pref.llmModelId) llm.modelId = pref.llmModelId
  }
  watch(
    () => [params.modelProviderId, params.modelId],
    ([pid, mid]) => store.saveModelPref({ imageProviderId: pid, imageModelId: mid }),
  )
  if (llm) {
    const l = llm
    watch(
      () => [l.providerId, l.modelId],
      ([pid, mid]) => store.saveModelPref({ llmProviderId: pid, llmModelId: mid }),
    )
  }
}
