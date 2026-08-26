import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { translateError } from '@/utils/error-message'
import { useCloudAuthStore } from '@/stores/cloud-auth'

// 说明：gen.error 始终保留后端返回的原文，友好翻译由展示层现场调用 translateError，
// 这样详情弹窗总是能拿到英文原文，不会出现 HMR / 新旧数据结构不一致导致原文丢失的问题。

export interface ImageGeneration {
  id: string
  session_id: string
  prompt: string
  revised_prompt: string
  ref_images: string[]
  model_provider_id: string
  model_id: string
  size: string
  quality: string
  /** 分辨率档位 id（1k/2k/4k）：重新生成时复现原档位，避免静默回退默认 2K */
  tier_id: string
  result_path: string
  result_url: string
  status: string
  /** 后端原文错误。展示时在 UI 层调 translateError 转换为友好文案 */
  error: string
  /**
   * 失败诊断用：发送给上游 API 的原始请求快照（脱敏后 JSON 字符串）。
   * 仅 status='error' 时由主进程写入；其他状态及历史失败记录均为空字符串。
   * 由 ErrorDetailDialog 展示与一键复制，便于用户贴给排错方定位字段/协议问题。
   */
  raw_request: string
  /** 去AI标记：该图是否经过「去AI标记」本地处理（1=已处理），用于创作记录/图库角标 */
  ai_mark_removed?: number
  created_at: string
}

export interface GenerateOptions {
  prompt: string
  refImages?: string[]
  modelProviderId: string
  modelId: string
  size: string
  tierId?: string
  quality?: string
  batchCount?: number
  applyWorkspaceBrand?: boolean
}

export interface QueueItem {
  id: number
  options: GenerateOptions
  /** 队列中摘要显示用 */
  label: string
}

const api = () => (window as any).api

/**
 * 分页策略：
 *  - items：当前页持久化数据，通过 listAllGenerations 按页拉取（仅 status=done）
 *  - inFlight：generating/error 状态的临时项，跨页始终置顶展示，不计入 total
 *  - completed 事件触发时：把 item 从 inFlight 移除；如果 currentPage === 1 再 prepend
 *    到 items 顶部并裁到 pageSize；非首页只更新 total，待用户切回首页自然刷新
 */
export const useImageGenStore = defineStore('imageGen', () => {
  /** 当前页数据（仅包含 status=done） */
  const items = ref<ImageGeneration[]>([])
  /** 正在生成中 / 失败的临时项，展示时永远置顶 */
  const inFlight = ref<ImageGeneration[]>([])
  const currentPage = ref(1)
  const pageSize = ref(25)
  const total = ref(0)
  const loading = ref(false)

  const generating = ref(false)
  const progress = ref<{ total: number; completed: number; type: string } | null>(null)
  const lastError = ref('')

  /** 任务队列（仅供 enqueue 路径，限制 ImageGenView 重复点击串行执行） */
  const queue = ref<QueueItem[]>([])
  let _queueIdSeq = 0
  let _processing = false
  /** progress 事件取消函数（Bug #6） */
  let _unsubscribeProgress: (() => void) | null = null

  /** 展示列表：inFlight 置顶 + items 分页数据 */
  const displayList = computed<ImageGeneration[]>(() => [...inFlight.value, ...items.value])
  /** 兼容旧消费者：等价于 displayList，供仍在读 store.generations 的代码使用 */
  const generations = computed<ImageGeneration[]>(() => displayList.value)

  function refreshCloudBalances(providerId?: string) {
    if (providerId !== 'cloud:default') return
    useCloudAuthStore().refreshBalancesThrottled().catch(() => {})
  }

  async function fetchPage(page = 1, size = pageSize.value) {
    loading.value = true
    try {
      const result = await api().imageGen.invoke('listAllGenerations', page, size) as {
        items: ImageGeneration[]
        total: number
      }
      items.value = result.items || []
      total.value = result.total || 0
      currentPage.value = page
      pageSize.value = size
      // 孤儿占位清理：
      // 用户在生图未完成时切走（如切到其他页面 / Bot 详情），ImageGenView.onUnmounted
      // 会卸载 progress 监听器（stopListenProgress），后端 'completed' 事件因此无人接收，
      // mergeCompleted 没机会把 inFlight 里的占位迁出。
      // 等用户切回 ImageGenView 时 onMounted 重新调 fetchPage，DB 里该任务已 status=done
      // 出现在 items 中，但 inFlight 里的「转圈」占位仍残留 → displayList = [...inFlight, ...items]
      // 同时渲染「转圈占位 + 完成卡片」造成重复。这里按 id 求差集兜底清理。
      if (inFlight.value.length) {
        const knownIds = new Set(items.value.map(g => g.id))
        if (knownIds.size) {
          inFlight.value = inFlight.value.filter(g => !knownIds.has(g.id))
        }
      }
    } finally {
      loading.value = false
    }
  }

  /** 将任务加入队列，若当前无任务在跑则立即开始 */
  function enqueue(options: GenerateOptions) {
    // modelId 可能是复合 key `{model_id}#@{provider_name}`：透传给主进程，
    // 主进程在调云端 API 前内部 strip，DB 保留原始复合 key 用于后续展示位精确还原服务商。
    const label = options.prompt.slice(0, 30) + (options.prompt.length > 30 ? '...' : '')
    queue.value.push({ id: ++_queueIdSeq, options, label })
    _scheduleNext()
  }

  function removeFromQueue(queueId: number) {
    queue.value = queue.value.filter(q => q.id !== queueId)
  }

  function clearQueue() {
    queue.value = []
  }

  async function _scheduleNext() {
    if (_processing) return
    const next = queue.value.shift()
    if (!next) return
    _processing = true
    await _runOne(next.options)
    _processing = false
    // 继续处理队列中的下一个
    _scheduleNext()
  }

  /**
   * 队列内部调度器（仅 enqueue 路径走这里）。
   * Bug #8：原 “_genCount 防竞态” 计数器是死代码，_processing 锁已保证串行，删除。
   */
  async function _runOne(options: GenerateOptions) {
    generating.value = true
    lastError.value = ''
    progress.value = { total: options.batchCount || 1, completed: 0, type: 'start' }
    try {
      await api().imageGen.invoke('generate', JSON.parse(JSON.stringify(options))) as ImageGeneration[]
      refreshCloudBalances(options.modelProviderId)
    } catch (e: any) {
      lastError.value = translateError(e.message || '')
    } finally {
      generating.value = false
      progress.value = null
    }
  }

  /**
   * 直接调用后端生图 API 并返回结果，绕过 store 队列。
   *
   * Bug #1 修复：原实现只调用 enqueue 不返回结果，BatchGenView 等依赖返回值的
   * 调用方永远拿到 undefined。现在 generate() 直接 invoke，返回真实生成结果。
   *
   * Bug #2 修复：BatchGenView 的 worker 不再入 store 队列（_processing 锁会串行），
   * 可真并发。后端 semaphore（Bug #3）负责全局上限。
   *
   * 需要队列报守行为（ImageGenView 重复点击报名）请用 enqueue()。
   */
  async function generate(options: GenerateOptions): Promise<ImageGeneration[]> {
    lastError.value = ''
    try {
      const results = await api().imageGen.invoke('generate', JSON.parse(JSON.stringify(options))) as ImageGeneration[]
      refreshCloudBalances(options.modelProviderId)
      return results || []
    } catch (e: any) {
      lastError.value = translateError(e.message || '')
      throw e
    }
  }

  async function deleteGeneration(id: string) {
    await api().imageGen.invoke('deleteGeneration', id)
    const wasInItems = items.value.some(g => g.id === id)
    items.value = items.value.filter(g => g.id !== id)
    inFlight.value = inFlight.value.filter(g => g.id !== id)
    if (wasInItems) total.value = Math.max(0, total.value - 1)
  }

  /**
   * 仅从 inFlight 隐藏占位卡片，不动后端 row 与磁盘文件。
   *
   * 场景：用户看到一张生图任务卡住不动（如多米 5min 轮询未返），想从界面上去掉。
   * 后端 worker 可能还在跑，取消请求会在完成/失败后走原压能量：inFlight 已不含该 id，
   * mergeCompleted / error 到达时 wasInFlight=false，items 不会被二次插入。
   */
  function dismissInFlight(ids: string[]) {
    if (!ids.length) return
    const set = new Set(ids)
    inFlight.value = inFlight.value.filter(g => !set.has(g.id))
  }

  /**
   * 手动中止一个生成中的任务。主进程会 abort 上游请求 / 停止轮询，并回发 'canceled' 事件。
   * 这里先把占位卡转 'canceling' 做即时反馈，最终态由 'canceled' 事件落定。
   * 注意：计费不返还——已提交到上游的异步任务上游可能仍执行扣费，桌面端仅停止本地等待 / 落盘。
   */
  async function cancelGeneration(genId: string) {
    const gen = inFlight.value.find(g => g.id === genId)
    if (gen && (gen.status === 'generating' || gen.status === 'pending')) {
      gen.status = 'canceling'
    }
    try {
      await api().imageGen.invoke('cancelGeneration', genId)
    } catch {
      // 中止请求本身失败：回滚乐观态，让用户可再次尝试
      if (gen && gen.status === 'canceling') gen.status = 'generating'
    }
  }

  /** 中止当前所有生成中 / 排队占位（不含已取消 / 已完成 / 失败项） */
  async function cancelAllInFlight() {
    const ids = inFlight.value
      .filter(g => g.status === 'generating' || g.status === 'pending')
      .map(g => g.id)
    await Promise.all(ids.map(id => cancelGeneration(id)))
  }

  async function deleteGenerations(ids: string[]) {
    await api().imageGen.invoke('deleteGenerations', JSON.parse(JSON.stringify(ids)))
    const idSet = new Set(ids)
    const before = items.value.length
    items.value = items.value.filter(g => !idSet.has(g.id))
    inFlight.value = inFlight.value.filter(g => !idSet.has(g.id))
    const removed = before - items.value.length
    if (removed > 0) total.value = Math.max(0, total.value - removed)
  }

  function mergeCompleted(gen: ImageGeneration) {
    // Bug #7: 幂等处理。只有“首次从 inFlight 迁出”才计为新增；同事件重复送达
    // 或 generation 已在 items 中时，不重复 +1。
    const wasInFlight = inFlight.value.some(g => g.id === gen.id)
    inFlight.value = inFlight.value.filter(g => g.id !== gen.id)
    if (currentPage.value === 1) {
      const idx = items.value.findIndex(g => g.id === gen.id)
      if (idx >= 0) {
        items.value[idx] = gen
        // 已在列表：处理为幂等更新，total 不动
      } else {
        items.value = [gen, ...items.value]
        if (items.value.length > pageSize.value) {
          items.value = items.value.slice(0, pageSize.value)
        }
        if (wasInFlight) total.value += 1
      }
    } else {
      // 非首页不改动 items，仅在首次完成时 +1
      if (wasInFlight) total.value += 1
    }
  }

  function listenProgress() {
    // Bug #6: 重复调用不重复注册；采用 unsubscribe 模式隔离其他视图的监听器
    if (_unsubscribeProgress) return
    _unsubscribeProgress = api().imageGen.onProgress((data: any) => {
      // 只处理「图生图 / 批量」来源的进度：编辑(edit)/聊天(chat)/画布(canvas) 各有独立进度 UI，
      // 不应并入本列表的 inFlight 占位与顶部进度条，否则多入口同时生图会串台。
      const src = data?.source
      if (src && src !== 'image-gen' && src !== 'batch') return
      if (data.type === 'done') {
        // generating 状态由 generate() 的 finally 统一管理，此处不再重置
        // 仅清理 progress 展示
        progress.value = null
      } else {
        progress.value = { total: data.total, completed: data.completed, type: data.type }
      }
      if (data.type === 'generating' && data.genId) {
        const existsInFlight = inFlight.value.find(g => g.id === data.genId)
        const existsInItems = items.value.find(g => g.id === data.genId)
        if (!existsInFlight && !existsInItems) {
          inFlight.value.unshift({
            id: data.genId,
            session_id: '',
            prompt: '',
            revised_prompt: '',
            ref_images: [],
            model_provider_id: '',
            model_id: '',
            size: '',
            quality: '',
            tier_id: '',
            result_path: '',
            result_url: '',
            status: 'generating',
            error: '',
            raw_request: '',
            created_at: new Date().toISOString()
          })
        } else if (existsInFlight) {
          existsInFlight.status = 'generating'
        } else if (existsInItems) {
          existsInItems.status = 'generating'
        }
      }
      if (data.type === 'completed' && data.generation) {
        mergeCompleted(data.generation)
        refreshCloudBalances(data.generation.model_provider_id)
      }
      if (data.type === 'canceled' && data.genId) {
        // 主进程把该项标记 canceled 并回传完整记录；用带真实参数（prompt/模型/尺寸）的
        // 已取消卡替换占位卡，便于用户查看 / 重新生成 / 删除。
        const idx = inFlight.value.findIndex(g => g.id === data.genId)
        if (idx >= 0) {
          const full = data.generation as ImageGeneration | undefined
          inFlight.value[idx] = full
            ? { ...full, status: 'canceled', error: full.error || '已手动中止' }
            : { ...inFlight.value[idx], status: 'canceled', error: '已手动中止' }
        }
      }
      if (data.type === 'error' && data.genId) {
        // 失败项保留在 inFlight 中（状态标为 error），置顶提醒用户；
        // 数据库里的记录由后端写入，用户点"清理失败"时再走 IPC 一并清除
        const gen = inFlight.value.find(g => g.id === data.genId)
        if (gen) {
          gen.status = 'error'
          gen.error = data.error || ''
          // 失败诊断快照：主进程通过 progress 事件直接传脱敏后的 JSON 字符串，
          // 不依赖 fetchPage 拉取（失败项不在 status='done' 列表里，永远不会被刷新）
          gen.raw_request = data.raw_request || ''
        } else {
          // 保险分支：此前 generating 事件丢失或已被合并走 completed，直接补一条
          inFlight.value.unshift({
            id: data.genId,
            session_id: '',
            prompt: '',
            revised_prompt: '',
            ref_images: [],
            model_provider_id: '',
            model_id: '',
            size: '',
            quality: '',
            tier_id: '',
            result_path: '',
            result_url: '',
            status: 'error',
            error: data.error || '',
            raw_request: data.raw_request || '',
            created_at: new Date().toISOString()
          })
        }
      }
    })
  }

  function stopListenProgress() {
    // Bug #6: 只取消自己注册的监听器，不调 removeAllListeners 误清其他视图
    if (_unsubscribeProgress) {
      _unsubscribeProgress()
      _unsubscribeProgress = null
    }
  }

  return {
    // 新消费者优先使用
    items,
    inFlight,
    displayList,
    currentPage,
    pageSize,
    total,
    loading,
    // 兼容旧消费者
    generations,
    generating,
    progress,
    lastError,
    queue,
    // methods
    fetchPage,
    generate,
    enqueue,
    removeFromQueue,
    clearQueue,
    deleteGeneration,
    deleteGenerations,
    dismissInFlight,
    cancelGeneration,
    cancelAllInFlight,
    listenProgress,
    stopListenProgress
  }
})
