import { ref, computed } from 'vue'
import { useCanvasStore } from '@/stores/canvas'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useStylePresetStore } from '@/stores/style-presets'
import { composePromptWithStyle } from '@shared/style-prompt'
import { recordUsage } from '@/utils/model-usage-hints'
import { getNodeTypeDef } from './useNodeTypes'
import { extractJson } from '@shared/json-extract'
import { DEFAULT_TIER_ID, isValidSizeValue } from '@shared/image-size'
import {
  getSystemPrompt as resolveSystemPrompt,
  getUserPrompt,
  type StylePreset,
  type OutputLang,
} from '@/utils/image2prompt-presets'
import { compressImage } from '@/utils/compress-image'
import { cloudClient } from '@/utils/cloud-api'
import { translateError, isBalanceError } from '@/utils/error-message'
import { useVideoTaskPolling } from './useVideoTaskPolling'
import { useVideoCatalogSelection } from './useVideoCatalogSelection'
import { useVideoFrames } from './useVideoFrames'

export type TaskStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'blocked'

// 节点失败时把原始错误转成中文友好提示；命中余额不足则派发全局事件弹充值引导。
// 画布节点生图走主进程，余额 402 不经前端 cloud-api，故在此显式识别并提示。
function toFriendlyNodeError(e: any, fallback: string): string {
  const raw = (e?.message || e?.error || String(e || '') || fallback) as string
  if (isBalanceError(raw) && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cloud-low-balance', { detail: {} }))
  }
  return translateError(raw)
}

// 风格预设：按节点 style_id 取云端分发的提示词片段；未拉取过先拉一次，
// 拉取失败 / id 已被云端删除或停用都降级为空串（按「无风格」继续执行，不阻塞流程）。
async function resolveStyleFragment(styleId: unknown): Promise<string> {
  const id = Number(styleId)
  if (!Number.isFinite(id) || id <= 0) return ''
  const store = useStylePresetStore()
  if (!store.loaded) {
    try { await store.fetchStyles() } catch { /* 失败按无风格处理 */ }
  }
  return store.byId(id)?.prompt_fragment || ''
}

export interface WorkflowTask {
  nodeId: string
  status: TaskStatus
  error?: string
}

interface UpstreamData {
  texts: string[]
  demandTexts: string[]
  recognitionTexts: string[]
  images: string[]
  videos: string[]
}

type QuickOrchestratorMode = 'storyboard' | 'batch_image' | 'product_workflow'

interface QuickPlanItem {
  title: string
  prompt: string
  groupType: 'main' | 'detail' | 'general'
  useReferenceImages: boolean
}

interface QuickPlanGroup {
  name: string
  type: 'main' | 'detail' | 'general'
  styleAnchor: string
  items: QuickPlanItem[]
}

interface QuickPlan {
  groups: QuickPlanGroup[]
}

const api = () => (window as any).api

/** aiText 节点未设置自定义 system_prompt 时使用的默认模板（中文，扩写为生图提示词）。
 * 用户可在节点 UI 上清空（空字符串）以让 LLM 按用户输入自由响应。 */
const AI_TEXT_DEFAULT_SYSTEM_PROMPT =
  '你是文本助手。请将给定文本改写、扩写或润色，使其适合作为 AI 图像生成的提示词。仅输出改写后的文本，不要其他内容。'

/** 按相对/绝对路径的扩展名推断真实 MIME。后端会按 MIME 决定 stripJpeg/stripPng 分支，
 * 错误的 MIME 会导致 EXIF/ICC 未被剥离，触发上游严格服务（如带微信 ICC 的图片）拒绝。 */
function inferImageMime(path: string): string {
  const lastDot = path.lastIndexOf('.')
  if (lastDot < 0) return 'image/png'
  const ext = path.slice(lastDot + 1).toLowerCase().replace(/[?#].*$/, '')
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/png'
}

/** 把上游 images 列表（可能是 data URI、相对路径、或空字符串）统一解析为可直接
 * 上传的 data URI 数组。读取失败的图片会被跳过并 console.warn——避免把相对路径
 * 字符串当作 base64 推到上游导致请求乱码失败。 */
async function resolveRefImages(images: string[]): Promise<string[]> {
  const result: string[] = []
  let failed = 0
  for (const img of images) {
    if (!img) continue
    if (img.startsWith('data:')) {
      result.push(img)
      continue
    }
    try {
      const dataDir = await api().dataDir.get()
      const fullPath = `${dataDir}/${img}`
      const b64 = await api().chat.invoke('readFileBase64', fullPath)
      const mime = inferImageMime(img)
      result.push(`data:${mime};base64,${b64}`)
    } catch (e) {
      failed++
      console.warn('[Canvas] 读取参考图失败，已跳过:', img, e)
    }
  }
  // 把失败计数挂到数组上（不改 return type 兼容现有调用方），上层可读取并提示
  ;(result as any).__failedCount = failed
  return result
}

// === 流式画布 AI 视频节点辅助（模块级，无组件依赖）===

/** dataURI → File，用于把画布本地参考图上传为云端临时素材。
 * 注意：不能用 fetch(dataUri)——Electron 生产 CSP 的 connect-src 仅含 'self' https: http:，
 * 不含 data:，fetch 一个 data: URI 会被 CSP 拦截抛原生 "Failed to fetch"。
 * 这里直接解析 base64 / URL 编码构造 Blob，绕开网络栈与 CSP。 */
async function dataUriToFile(dataUri: string, name: string): Promise<File> {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUri)
  if (!match) throw new Error('参考图数据格式异常，无法解析')
  const mime = match[1] || 'image/png'
  const isBase64 = Boolean(match[2])
  const raw = match[3] || ''
  let bytes: Uint8Array
  if (isBase64) {
    const binary = atob(raw)
    bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  } else {
    const decoded = decodeURIComponent(raw)
    bytes = new Uint8Array(decoded.length)
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i)
  }
  // new Uint8Array(length) 必为真 ArrayBuffer（非 SharedArrayBuffer），断言仅满足 TS 5.7+ 的 BlobPart 泛型约束
  return new File([bytes as BlobPart], name, { type: mime })
}

/** 画布参考图（相对路径 / dataURI）→ 读取 → 上传云端 → 返回 https URL；失败抛错以中止提交。 */
async function uploadCanvasImageToCloud(img: string): Promise<string> {
  const resolved = await resolveRefImages([img])
  if (!resolved.length) throw new Error('参考图读取失败：上游图片可能已被删除')
  const file = await dataUriToFile(resolved[0], `canvas-ref-${Date.now()}.png`)
  const res = await cloudClient.uploadVideoReference(file, 'image')
  const url = res?.asset?.url
  if (!url) throw new Error('参考图上传失败，请重试')
  return String(url)
}

/** 视频任务 → 同步到本地创作记录（带画布上下文，落盘到 canvas/{projectId}/）。 */
async function syncVideoRecordForNode(task: any, projectId: string, nodeId: string): Promise<any> {
  return await api().videoGen.invoke('syncTask', {
    task,
    requestParams: {
      mode: task?.request_params?.mode || '',
      duration_seconds: task?.request_params?.duration || task?.request_params?.duration_seconds || 0,
      resolution: task?.request_params?.resolution || '',
      aspect_ratio: task?.request_params?.aspect_ratio || '',
      quality: task?.request_params?.quality || '',
    },
    canvasProjectId: projectId,
    canvasNodeId: nodeId,
  })
}

/** 云端视频任务状态 → 画布节点状态。 */
function mapVideoNodeStatus(taskStatus: string): TaskStatus {
  if (taskStatus === 'completed') return 'done'
  if (taskStatus === 'failed' || taskStatus === 'canceled') return 'error'
  return 'running'
}

/** 把云端视频任务写回画布节点（落盘 + 更新 data）。后台轮询与工作流等待共用。 */
async function applyVideoTaskToNode(nodeId: string, projectId: string, taskId: string, task: any): Promise<void> {
  const canvasStore = useCanvasStore()
  const node = canvasStore.nodes.find((n) => n.id === nodeId)
  if (!node) return
  // 更新前捕获旧状态：用于判断本次是否「由非完成态首次转为完成」，从而只刷一次余额
  const prevStatus = String(node.data.status || '')
  let record: any = null
  try { record = await syncVideoRecordForNode(task, projectId, nodeId) } catch { /* 落盘失败不阻塞状态更新 */ }
  const status = mapVideoNodeStatus(String(task?.status || ''))
  const patch: Record<string, any> = {
    cloud_task_id: taskId,
    status,
    progress: Number(task?.progress) || 0,
    error: status === 'error' ? (task?.error_message || task?.error || '视频生成失败') : '',
    video_url: record?.storage_url || record?.remote_url || task?.result?.video_url || node.data.video_url || '',
    cover_url: record?.cover_url || task?.result?.cover_url || node.data.cover_url || '',
    result_path: record?.local_path || node.data.result_path || '',
  }
  await canvasStore.updateNode(nodeId, { data: { ...node.data, ...patch } })
  // 视频「完成才扣积分」（后端策略），首次进入 done 时刷新余额显示，对齐独立视频页；
  // 仅在非完成→完成时刷一次，避免重开已完成画布或重复轮询时多次刷新。
  if (status === 'done' && prevStatus !== 'done') refreshCloudBalances()
}

// 画布执行态按 projectId 分片：一个画布运行不冻结/影响其它画布。多画布可各自并行排队，
// 共享主进程生图并发闸（不在此层限制并发），UI 只观察各自画布的运行态。
// - workflowRunningProjects: 有整画布工作流在跑的 projectId 集合（准入 + 各画布 UI 门控）
// - cancelRequestedProjects: 已请求软取消的 projectId（取消只作用于本画布）
// - activeSingleRunsByProject: projectId → 正在单独执行的 nodeId 集合（单节点门控 + 徽标计数）
// - refImageWarningsByProject: projectId → 参考图读取失败聚合（各画布执行后各自 toast，互不混淆）
type RefImageWarning = { nodeId: string; failed: number; total: number }
const workflowRunningProjects = ref<Set<string>>(new Set())
const cancelRequestedProjects = ref<Set<string>>(new Set())
const activeSingleRunsByProject = ref<Map<string, Set<string>>>(new Map())
const refImageWarningsByProject = ref<Map<string, RefImageWarning[]>>(new Map())
// 以下两者无外部消费、仅内部记录（nodeId 全局唯一，并行画布互不冲突），保留不动
const tasks = ref<WorkflowTask[]>([])
const nodeStatuses = ref<Map<string, TaskStatus>>(new Map())

// Set/Map 装在 ref 里需整体重赋值才触发响应式
function setProjectRunning(pid: string, on: boolean): void {
  const next = new Set(workflowRunningProjects.value)
  if (on) next.add(pid)
  else next.delete(pid)
  workflowRunningProjects.value = next
}
function setProjectCancel(pid: string, on: boolean): void {
  const next = new Set(cancelRequestedProjects.value)
  if (on) next.add(pid)
  else next.delete(pid)
  cancelRequestedProjects.value = next
}
function addSingleRun(pid: string, nodeId: string): void {
  const map = new Map(activeSingleRunsByProject.value)
  const set = new Set(map.get(pid) ?? [])
  set.add(nodeId)
  map.set(pid, set)
  activeSingleRunsByProject.value = map
}
function removeSingleRun(pid: string, nodeId: string): void {
  const map = new Map(activeSingleRunsByProject.value)
  const set = new Set(map.get(pid) ?? [])
  set.delete(nodeId)
  if (set.size === 0) map.delete(pid)
  else map.set(pid, set)
  activeSingleRunsByProject.value = map
}
function clearProjectWarnings(pid: string): void {
  const map = new Map(refImageWarningsByProject.value)
  map.set(pid, [])
  refImageWarningsByProject.value = map
}
function pushProjectWarning(pid: string, w: RefImageWarning): void {
  const map = new Map(refImageWarningsByProject.value)
  map.set(pid, [...(map.get(pid) ?? []), w])
  refImageWarningsByProject.value = map
}

// —— 按 projectId 的选择器（各画布 UI 观察自己的运行态）——
function isProjectRunning(projectId: string): boolean {
  return workflowRunningProjects.value.has(projectId)
}
function isProjectAnyRunning(projectId: string): boolean {
  return workflowRunningProjects.value.has(projectId) || (activeSingleRunsByProject.value.get(projectId)?.size ?? 0) > 0
}
function getProjectRefImageWarnings(projectId: string): RefImageWarning[] {
  return refImageWarningsByProject.value.get(projectId) ?? []
}

function refreshCloudBalances() {
  useCloudAuthStore().refreshBalancesThrottled().catch(() => {})
}

// 全局派生（跨画布徽标用）：任意画布在执行 / 任意整画布工作流 / 单节点执行总数 / 在跑的画布 id
const anyRunningGlobal = computed(
  () => workflowRunningProjects.value.size > 0 || [...activeSingleRunsByProject.value.values()].some((s) => s.size > 0)
)
const workflowRunningGlobal = computed(() => workflowRunningProjects.value.size > 0)
const activeSingleRunCount = computed(() =>
  [...activeSingleRunsByProject.value.values()].reduce((n, s) => n + s.size, 0)
)
const runningProjectIds = computed(() => {
  const ids = new Set<string>(workflowRunningProjects.value)
  for (const [pid, set] of activeSingleRunsByProject.value) if (set.size > 0) ids.add(pid)
  return [...ids]
})

export function useWorkflowEngine() {

  function topologicalSort(projectId: string): string[] {
    const canvasStore = useCanvasStore()
    const nodes = canvasStore.nodes.filter((n) => n.project_id === projectId)
    const edges = canvasStore.edges.filter((e) => e.project_id === projectId)

    const inDegree = new Map<string, number>()
    const adj = new Map<string, string[]>()

    for (const node of nodes) {
      inDegree.set(node.id, 0)
      adj.set(node.id, [])
    }

    for (const edge of edges) {
      const targets = adj.get(edge.source_node_id)
      if (targets) targets.push(edge.target_node_id)
      inDegree.set(edge.target_node_id, (inDegree.get(edge.target_node_id) || 0) + 1)
    }

    const queue: string[] = []
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id)
    }

    const sorted: string[] = []
    while (queue.length > 0) {
      const id = queue.shift()!
      sorted.push(id)
      for (const target of adj.get(id) || []) {
        const newDeg = (inDegree.get(target) || 1) - 1
        inDegree.set(target, newDeg)
        if (newDeg === 0) queue.push(target)
      }
    }

    return sorted
  }

  function getUpstreamData(nodeId: string, projectId: string): UpstreamData {
    const canvasStore = useCanvasStore()
    const edges = canvasStore.edges.filter((e) => e.project_id === projectId && e.target_node_id === nodeId)
    const texts: string[] = []
    const demandTexts: string[] = []
    const recognitionTexts: string[] = []
    const images: string[] = []
    const videos: string[] = []

    for (const edge of edges) {
      const sourceNode = canvasStore.nodes.find((n) => n.id === edge.source_node_id)
      if (!sourceNode) continue

      const def = getNodeTypeDef(sourceNode.type)
      if (!def) continue

      let outputDef = def.outputs.find((o) => o.handle === edge.source_handle)
      // Dynamic outputs: match any output-* handle to the base output type
      if (!outputDef && def.dynamicOutputs && edge.source_handle.startsWith('output-')) {
        outputDef = def.outputs[0]
      }
      if (!outputDef) continue

      if (outputDef.dataType === 'text') {
        let text = ''
        if (sourceNode.type === 'promptSlice') {
          const rowId = edge.source_handle.replace('output-', '')
          const row = (sourceNode.data.rows || []).find((r: any) => r.id === rowId)
          text = row?.text || ''
        } else if (sourceNode.type === 'storyboard') {
          const shotId = edge.source_handle.replace('output-', '')
          const shot = (sourceNode.data.shots || []).find((s: any) => s.id === shotId)
          text = shot?.prompt || ''
        } else {
          text = sourceNode.data.result || sourceNode.data.outputContent || sourceNode.data.text || ''
        }
        if (text) {
          texts.push(text)
          if (sourceNode.type === 'imageRecognition') recognitionTexts.push(text)
          else demandTexts.push(text)
        }
      } else if (outputDef.dataType === 'image') {
        let img = ''
        if (sourceNode.type === 'videoFrames' && edge.source_handle.startsWith('output-')) {
          // 关键帧抽取节点：按 output-{frameId} 取对应帧
          const frameId = edge.source_handle.replace('output-', '')
          const frame = (sourceNode.data.frames || []).find((f: any) => f.id === frameId)
          img = frame?.path || ''
        } else {
          // 读取优先级：result_path（生图产出） > image_path（refImage 落盘） > image_data（base64 兜底）
          img =
            sourceNode.data.result_path ||
            sourceNode.data.image_path ||
            sourceNode.data.image_data ||
            ''
        }
        if (img) images.push(img)
      } else if (outputDef.dataType === 'video') {
        // 上游视频节点产出：优先本地落盘路径，回落云端 URL（24h 有效）
        const vid = sourceNode.data.result_path || sourceNode.data.video_url || ''
        if (vid) videos.push(vid)
      }
    }

    return { texts, demandTexts, recognitionTexts, images, videos }
  }

  // 按指定 target_handle 收集上游图片（保序），用于视频节点首尾帧/参考图分槽。
  function getUpstreamImagesByHandle(nodeId: string, projectId: string, handle: string): string[] {
    const canvasStore = useCanvasStore()
    const edges = canvasStore.edges.filter(
      (e) => e.project_id === projectId && e.target_node_id === nodeId && e.target_handle === handle
    )
    const result: string[] = []
    for (const edge of edges) {
      const sourceNode = canvasStore.nodes.find((n) => n.id === edge.source_node_id)
      if (!sourceNode) continue
      const def = getNodeTypeDef(sourceNode.type)
      let output = def?.outputs.find((o) => o.handle === edge.source_handle)
      if (!output && def?.dynamicOutputs && edge.source_handle.startsWith('output-')) output = def.outputs[0]
      if (output?.dataType !== 'image') continue
      let img = ''
      if (sourceNode.type === 'videoFrames' && edge.source_handle.startsWith('output-')) {
        const frameId = edge.source_handle.replace('output-', '')
        const frame = (sourceNode.data.frames || []).find((f: any) => f.id === frameId)
        img = frame?.path || ''
      } else {
        img = sourceNode.data.result_path || sourceNode.data.image_path || sourceNode.data.image_data || ''
      }
      if (img) result.push(img)
    }
    return result
  }

  // 取上游「视频输入」节点的视频路径（videoInput.video_path / aiVideo.result_path / video_url）
  function getUpstreamVideo(nodeId: string, projectId: string): string {
    const canvasStore = useCanvasStore()
    const edge = canvasStore.edges.find(
      (e) => e.project_id === projectId && e.target_node_id === nodeId && e.target_handle === 'video-input'
    )
    if (!edge) return ''
    const src = canvasStore.nodes.find((n) => n.id === edge.source_node_id)
    if (!src) return ''
    return String(src.data.video_path || src.data.video_url || src.data.result_path || '')
  }

  function checkRequiredInputs(nodeId: string, projectId: string): { ok: boolean; missing: string[] } {
    const canvasStore = useCanvasStore()
    const node = canvasStore.nodes.find((n) => n.id === nodeId)
    if (!node) return { ok: false, missing: ['node not found'] }

    const def = getNodeTypeDef(node.type)
    if (!def) return { ok: true, missing: [] }

    const edges = canvasStore.edges.filter((e) => e.project_id === projectId && e.target_node_id === nodeId)
    const missing: string[] = []

    for (const input of def.inputs) {
      if (!input.required) continue
      const hasConnection = edges.some((e) => e.target_handle === input.handle)
      if (!hasConnection) {
        missing.push(input.handle)
        continue
      }
      // Check if upstream has data
      const upstream = getUpstreamData(nodeId, projectId)
      if (input.dataType === 'text' && upstream.texts.length === 0) {
        missing.push(input.handle)
      }
      if (input.dataType === 'image' && upstream.images.length === 0) {
        missing.push(input.handle)
      }
    }

    return { ok: missing.length === 0, missing }
  }

  function getUpstreamImageSources(nodeId: string, projectId: string): { nodeId: string; handle: string }[] {
    const canvasStore = useCanvasStore()
    const edges = canvasStore.edges.filter(
      (e) => e.project_id === projectId && e.target_node_id === nodeId && e.target_handle === 'image-input'
    )
    const result: { nodeId: string; handle: string }[] = []
    for (const edge of edges) {
      const sourceNode = canvasStore.nodes.find((n) => n.id === edge.source_node_id)
      if (!sourceNode) continue
      const hasImage = Boolean(
        sourceNode.data?.result_path ||
        sourceNode.data?.image_path ||
        sourceNode.data?.image_data
      )
      if (!hasImage) continue
      const def = getNodeTypeDef(sourceNode.type)
      const output = def?.outputs.find((o) => o.handle === edge.source_handle)
      if (output?.dataType === 'image') {
        result.push({ nodeId: sourceNode.id, handle: edge.source_handle })
      }
    }
    return result
  }

  function clampNumber(value: any, min: number, max: number, fallback: number): number {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.max(min, Math.min(max, Math.round(n)))
  }

  function normalizeQuickMode(value: any): QuickOrchestratorMode {
    return value === 'storyboard' || value === 'batch_image' || value === 'product_workflow'
      ? value
      : 'product_workflow'
  }

  function pickQuickSize(value: any, fallback: string): string {
    const v = String(value || '').trim()
    if (v && isValidSizeValue(v)) return v
    return fallback
  }

  function hasSpecificProductHint(inputText: string): boolean {
    let residue = inputText
      .replace(/[XxＸｘ]{2,}/g, '')
      .replace(/[0-9０-９一二三四五六七八九十百千万]+/g, '')
      .replace(/[，。！？、；：:,.!?;()\[\]（）【】"'“”‘’\s]/g, '')
    const genericWords = [
      '根据', '参考图', '上游图片', '图片节点', '前置图片', '生成', '制作', '创建', '输出',
      '用户', '如果', '比如', '例如', '请', '帮我', '帮', '我', '的', '了', '和', '与', '及',
      '为', '是', '在', '中', '里', '按', '用', '从', '对', '将', '把', '给',
      '一套', '一组', '系列', '产品', '商品', '主体', '主图', '详情图', '长图', '分镜',
      '图文', '批量', '方案', '工作流', '画布', '自动', '展开', '参考', '图片', '张',
      '需要', '要求', '风格', '一致', '统一', '质感', '卖点', '使用场景', '场景', '突出',
      '保持', '高端', '简洁', '专业', '电商', '商业', '白底', '背景', '比例', '竖图',
      '横图', '高清', '清晰', '核心', '多张', '不同', '角度', '实景', '分别', '材质', '等'
    ]
    for (const word of genericWords) residue = residue.split(word).join('')
    return residue.length >= 2
  }

  function compactQuickInput(inputText: string): string {
    return inputText.replace(/\s+/g, ' ').trim()
  }

  function cleanRecognitionProductSummaryValue(value: string): string {
    let text = compactQuickInput(value)
      .replace(/\*\*/g, '')
      .replace(/^[-\s]+/, '')
      .replace(/^这是\s*/, '')
      .replace(/产品[。.]?$/, '')
      .replace(/^(疑似|可能是|大概是|看起来像|应该是)\s*/, '')
      .replace(/^(一款|一台|一部|一个|一种|一组|一件|两部|两台|多个|多部|数个|若干)\s*/, '')
      .replace(/[XxＸｘ]{2,}/g, '')
    text = text.split(/[。；;\n，,]/)[0] || ''
    text = text
      .replace(/外观(类似|像|接近).*/g, '')
      .replace(/(并排|并列|排列|展示|陈列|摆放|正面|背面|侧面|左侧|右侧|屏幕|画面|图片|照片|主体)/g, '')
      .replace(/智能手机.*手机/g, '智能手机')
      .replace(/[：:，,。；;、]/g, '')
      .trim()
    if (!text || /^(不确定|无法确定)$/.test(text) || text.length < 2 || text.length > 12) return ''
    return text
  }

  function extractRecognitionProductSummaryField(recognitionText: string): string {
    const source = String(recognitionText || '').trim()
    if (!source) return ''
    const normalized = source.replace(/\r/g, '').replace(/\*\*/g, '')
    const matched = normalized.match(/(?:^|\n)\s*[-\s]*产品总结\s*[:：]\s*([^\n]+)/)
    if (!matched?.[1]) return ''
    const value = matched[1].trim()
    if (!/^这是.+产品[。.]?$/.test(value)) return ''
    const product = cleanRecognitionProductSummaryValue(value)
    return product ? `产品总结：这是${product}产品。` : ''
  }

  function extractRecognitionProductType(summaryField: string): string {
    const matched = String(summaryField || '').match(/产品总结\s*[:：]\s*这是(.+?)产品[。.]?$/)
    return matched?.[1] ? cleanRecognitionProductSummaryValue(matched[1]) : ''
  }

  function createQuickPrompt(subject: string, styleAnchor: string, focus: string, useReferenceImages: boolean): string {
    const referenceRule = useReferenceImages
      ? `保持${subject}外观、结构、颜色、材质、比例和关键细节一致`
      : `围绕用户需求中的主体进行创作`
    return [
      referenceRule,
      styleAnchor,
      focus
    ].filter(Boolean).join('。')
  }

  function buildQuickFallbackPlan(mode: QuickOrchestratorMode, nodeData: Record<string, any>, useReferenceImages: boolean): QuickPlan {
    const mainCount = clampNumber(nodeData.main_count, 1, 12, 4)
    const detailCount = clampNumber(nodeData.detail_count, 0, 12, 3)
    const count = clampNumber(nodeData.count, 1, 20, 4)
    const productSubject = useReferenceImages ? '参考图中的产品主体' : '用户需求中的产品主体'
    const generalSubject = useReferenceImages ? '参考图中的主体' : '用户需求中的主体'
    const mainStyle = '统一商业摄影风格，背景简洁高级，光影柔和，主体清晰，系列画面保持一致'
    const detailStyle = '图文结合的电商详情表达，版式干净，信息层级清楚，系列感一致'
    const generalStyle = mode === 'storyboard'
      ? '统一图文分镜视觉语言，画面连贯，构图清晰，节奏有层次'
      : '统一视觉风格、色彩、光影和构图品质，同组图片保持系列感'
    const mainFocus = [
      '主视觉首图，主体居中或黄金构图，突出整体质感和清晰轮廓',
      '不同角度的商业棚拍主图，强化光影层次和材质细节',
      '生活化使用场景主图，氛围自然，突出产品价值和场景代入感',
      '核心卖点氛围主图，通过道具、光线和留白突出高级感',
      '组合陈列主图，主体稳定清晰，画面秩序感强',
      '细节角度主图，强调局部质感和精致工艺',
      '包装或配件展示主图，保持干净背景和统一调性',
      '平台首图风格主图，主体醒目，背景克制，适合电商列表'
    ]
    const detailFocus = [
      '图文结合的核心卖点详情图，围绕一个卖点组织画面与简洁信息层级',
      '材质质感详情图，以图文结合形式突出局部纹理、边缘、接口或工艺质感',
      '结构功能详情图，用干净版式展示关键部位和使用价值',
      '使用流程或场景详情图，画面清晰易懂，适合详情页浏览',
      '场景价值详情图，突出使用感受和购买理由',
      '对比优势详情图，版式克制，重点明确',
      '包装配件详情图，展示包装、配件或关键信息层级',
      '系列调性延展详情图，强化统一色彩、光影和页面节奏'
    ]
    const generalFocus = mode === 'storyboard'
      ? [
          '第一张分镜建立主题和氛围，主体清晰，画面有开场感',
          '第二张分镜展示核心动作、卖点或关键变化，信息更聚焦',
          '第三张分镜转入使用场景或价值表达，增强代入感',
          '第四张分镜形成收束画面，适合作为系列结尾或传播主视觉'
        ]
      : [
          '基础主视觉方案，主体清晰，背景简洁，适合作为首图',
          '场景化方案，强调氛围、使用价值和视觉代入感',
          '细节质感方案，突出局部特征、光影和材质表现',
          '差异构图方案，保持同一风格但改变角度、景别和空间关系'
        ]
    if (mode === 'product_workflow') {
      const groups: QuickPlanGroup[] = [{
        name: '主图',
        type: 'main',
        styleAnchor: mainStyle,
        items: Array.from({ length: mainCount }, (_, index) => ({
          title: `主图 ${index + 1}`,
          prompt: createQuickPrompt(productSubject, mainStyle, mainFocus[index % mainFocus.length], useReferenceImages),
          groupType: 'main',
          useReferenceImages
        }))
      }]
      if (detailCount > 0) {
        groups.push({
          name: '详情图',
          type: 'detail',
          styleAnchor: detailStyle,
          items: Array.from({ length: detailCount }, (_, index) => ({
            title: `详情图 ${index + 1}`,
            prompt: createQuickPrompt(productSubject, detailStyle, detailFocus[index % detailFocus.length], useReferenceImages),
            groupType: 'detail',
            useReferenceImages
          }))
        })
      }
      return { groups }
    }
    return {
      groups: [{
        name: mode === 'storyboard' ? '图文分镜' : '批量生图',
        type: 'general',
        styleAnchor: generalStyle,
        items: Array.from({ length: count }, (_, index) => ({
          title: `${mode === 'storyboard' ? '分镜' : '图片'} ${index + 1}`,
          prompt: createQuickPrompt(generalSubject, generalStyle, generalFocus[index % generalFocus.length], useReferenceImages),
          groupType: 'general',
          useReferenceImages
        }))
      }]
    }
  }

  function buildQuickPlanPrompt(mode: QuickOrchestratorMode, inputText: string, nodeData: Record<string, any>, hasReference: boolean, recognitionProductSummaryField = ''): { system: string; user: string } {
    const count = clampNumber(nodeData.count, 1, 20, 4)
    const mainCount = clampNumber(nodeData.main_count, 1, 12, 4)
    const detailCount = clampNumber(nodeData.detail_count, 0, 12, 3)
    const modeLabel = mode === 'product_workflow' ? '商品图工作流' : mode === 'storyboard' ? '图文分镜' : '批量生图方案'
    const recognitionProductType = extractRecognitionProductType(recognitionProductSummaryField)
    const productRules = [
      '商品图要求：根据用户需求和参考图编排主图与详情图；参考图只用于保持产品主体外观、结构、颜色、材质、比例和关键细节一致，不覆盖用户指定风格。',
      '主图组默认用于从多种层面展示产品。',
      '详情图组默认以详细的图文结合的电商详情表达为主。'
    ].join('\n')
    const system = [
      '你是资深电商视觉编排和 AI 图像生成提示词工程师。',
      '任务：把用户需求拆成可在画布中执行的图片生成方案。',
      '只输出 JSON 对象，不要 Markdown 代码块、不要解释文字。',
      '固定结构：{"groups":[{"name":"...","type":"main|detail|general","styleAnchor":"...","items":[{"title":"...","prompt":"...","useReferenceImages":true}]}]}',
      'prompt 必须是完整中文生图提示词，可以直接给图像生成模型使用。',
      'styleAnchor 是同组所有图片共用的一致性约束；每条 prompt 都要体现该组 styleAnchor。',
      '用户需求和内部产品上下文只用于理解如何编排与设计提示词，不要把“产品总结”“用户需求补充”“用户需求与上游文本”“内部产品上下文”等字段名或整段原文复制进 prompt。',
      hasReference && recognitionProductType ? '已连接参考图，并提供了内部产品类型。必须围绕该产品类型设计所有主图和详情图，避免输出“产品主体”这类通用占位描述；不得引用识图结果中的其他内容。' : '',
      hasReference
        ? recognitionProductType ? '' : '已连接参考图，但你不能看到图片内容。不要根据参考图猜测产品名称、品类、颜色、形状或材质；只有用户文本明确写出的产品信息才能写进 prompt。'
        : '未连接参考图。不要声称已参考图片。',
      hasReference ? '如果没有内部产品类型，完全忽略识图结果；最终 prompt 不要出现额外的识图说明文案。' : '',
      mode === 'product_workflow' ? productRules : '同一组图片应保持统一视觉语言，但每张图的主体表达、构图或信息重点必须有差异。',
      '每条 prompt 不超过 300 字，避免空泛词，不要输出尺寸字段。'
    ].filter(Boolean).join('\n')
    const user = [
      `模式：${modeLabel}`,
      mode === 'product_workflow'
        ? `请生成 2 个分组：主图 main 共 ${mainCount} 张；详情图 detail 共 ${detailCount} 张。`
        : `请生成 1 个 general 分组，共 ${count} 张。`,
      '',
      '用户需求与上游文本：',
      inputText,
      recognitionProductType ? ['', '内部产品上下文（仅用于提示词设计，不要原样输出字段）：', `参考图产品类型：${recognitionProductType}`].join('\n') : '',
      '',
      '只输出符合结构的 JSON。'
    ].join('\n')
    return { system, user }
  }

  function normalizeQuickItem(input: any, groupType: 'main' | 'detail' | 'general', index: number, fallbackPrompt: string, useReferenceImages: boolean): QuickPlanItem {
    const title = String(input?.title || `${groupType === 'main' ? '主图' : groupType === 'detail' ? '详情图' : '图片'} ${index + 1}`).trim()
    const prompt = cleanFinalQuickPrompt(String(input?.prompt || fallbackPrompt).trim(), fallbackPrompt)
    return {
      title,
      prompt,
      groupType,
      useReferenceImages
    }
  }

  function cleanFinalQuickPrompt(value: string, fallback: string): string {
    const cleaned = String(value || '')
      .replace(/\r/g, '')
      .replace(/\n+/g, '。')
      .replace(/识图节点产品总结字段\s*[:：]?\s*/g, '')
      .replace(/产品总结\s*[:：]\s*这是[^。.!！？]*产品[。.]?/g, '')
      .replace(/内部产品上下文\s*[（(][^）)]*[）)]\s*[:：]?\s*/g, '')
      .replace(/参考图产品类型\s*[:：]\s*/g, '')
      .replace(/参考图产品信息\s*[:：][^。.!！？]*[。.]?/g, '')
      .replace(/参考图识别信息\s*[:：][^。.!！？]*[。.]?/g, '')
      .replace(/用户需求补充\s*[:：][^。.!！？]*[。.]?/g, '')
      .replace(/用户需求与上游文本\s*[:：]?\s*/g, '')
      .replace(/根据参考图，产品是[^，。]*，生成一套产品的多张(?:电商)?主图，展现产品的不同角度和不同场景的实景[。.]?/g, '')
      .replace(/根据参考图，生成一套产品的多张(?:电商)?主图，展现产品的不同角度和不同场景的实景[。.]?/g, '')
      .replace(/多张(?:电商)?详情图，分别(?:使用图文的形式)?突出(?:产品的)?材质质感、卖点和使用场景等[。.]?/g, '')
      .split('。')
      .map((item) => item.trim())
      .filter(Boolean)
      .join('。')
      .replace(/。{2,}/g, '。')
      .trim()
    return cleaned || fallback
  }

  function normalizeQuickPlan(raw: any, mode: QuickOrchestratorMode, nodeData: Record<string, any>, hasReference: boolean): QuickPlan {
    const parsedGroups = Array.isArray(raw?.groups) ? raw.groups : []
    const useReferenceImages = (mode === 'product_workflow' || Boolean(nodeData.require_reference)) && hasReference
    const findGroup = (type: 'main' | 'detail' | 'general') => parsedGroups.find((g: any) => g?.type === type)
    const makeFallbackPrompt = (type: 'main' | 'detail' | 'general', index: number) => {
      if (type === 'main') return createQuickPrompt(useReferenceImages ? '参考图中的产品主体' : '用户需求中的产品主体', '统一商业摄影风格，背景简洁高级，光影柔和，主体清晰，系列画面保持一致', `生成第 ${index + 1} 张电商主图，构图与其他主图有明显差异`, useReferenceImages)
      if (type === 'detail') return createQuickPrompt(useReferenceImages ? '参考图中的产品主体' : '用户需求中的产品主体', '图文结合的电商详情表达，版式简洁清晰，信息层级明确', `生成第 ${index + 1} 张详情图，清晰展示一个核心卖点或功能细节`, useReferenceImages)
      return createQuickPrompt(useReferenceImages ? '参考图中的主体' : '用户需求中的主体', '统一视觉风格、色彩、光影和构图品质，同组图片保持系列感', `生成第 ${index + 1} 张图片方案，保持同组风格一致，同时在构图、场景或卖点上与其他图片形成差异`, useReferenceImages)
    }
    const buildGroup = (type: 'main' | 'detail' | 'general', count: number, name: string): QuickPlanGroup => {
      const source = findGroup(type) || (type === 'general' ? parsedGroups[0] : null) || {}
      const rawItems = Array.isArray(source.items) ? source.items : []
      const styleAnchor = String(source.styleAnchor || (
        type === 'main'
          ? '统一商业摄影风格，产品外观与参考图一致，背景简洁高级，光影柔和，质感清晰'
          : type === 'detail'
            ? '图文结合的电商详情表达，产品外观与主图一致，版式简洁清晰'
            : '统一视觉风格、色彩、光影和构图品质，同组图片保持系列感'
      )).trim()
      const items: QuickPlanItem[] = []
      for (let i = 0; i < count; i++) {
        const fallbackPrompt = `${styleAnchor}。${makeFallbackPrompt(type, i)}`
        items.push(normalizeQuickItem(rawItems[i], type, i, fallbackPrompt, useReferenceImages))
      }
      return { name, type, styleAnchor, items }
    }
    if (mode === 'product_workflow') {
      const mainCount = clampNumber(nodeData.main_count, 1, 12, 4)
      const detailCount = clampNumber(nodeData.detail_count, 0, 12, 3)
      const groups = [buildGroup('main', mainCount, '主图')]
      if (detailCount > 0) groups.push(buildGroup('detail', detailCount, '详情图'))
      return { groups }
    }
    return { groups: [buildGroup('general', clampNumber(nodeData.count, 1, 20, 4), mode === 'storyboard' ? '图文分镜' : '批量生图')] }
  }

  function formatQuickPlan(plan: QuickPlan): string {
    return plan.groups.map((group) => [
      `${group.name}（${group.items.length} 张）`,
      ...group.items.map((item, index) => `${index + 1}. ${item.title}\n${item.prompt}`)
    ].join('\n')).join('\n\n')
  }

  async function generateQuickPlan(node: any, projectId: string, upstream: UpstreamData): Promise<{ plan: QuickPlan; outputContent: string }> {
    const canvasStore = useCanvasStore()
    const project = canvasStore.currentProject
    if (!project?.text_provider_id || !project?.text_model_id) throw new Error('请先在画布设置中配置文本模型')
    if (!project?.image_provider_id || !project?.image_model_id) throw new Error('请先在画布设置中配置生图模型')
    const mode = normalizeQuickMode(node.data.mode)
    const inputText = [node.data.instruction || '', ...upstream.demandTexts].map((v) => String(v || '').trim()).filter(Boolean).join('\n\n')
    const recognitionText = upstream.recognitionTexts.map((v) => String(v || '').trim()).filter(Boolean).join('\n\n')
    const recognitionProductSummaryField = extractRecognitionProductSummaryField(recognitionText)
    const recognitionProductType = extractRecognitionProductType(recognitionProductSummaryField)
    if (!inputText) throw new Error('快捷编排需要需求文本：请填写需求或连接上游文本节点')
    const referenceRequired = mode === 'product_workflow' || Boolean(node.data.require_reference)
    const referenceSources = getUpstreamImageSources(node.id, projectId)
    if (referenceRequired && referenceSources.length === 0) {
      throw new Error('当前快捷模式需要可用参考图：请先连接参考图节点或上游图片结果，并确保节点内已有图片')
    }
    const willUseReference = referenceRequired && referenceSources.length > 0
    const quickFallback = buildQuickFallbackPlan(mode, node.data, willUseReference)
    const hasProductContext = hasSpecificProductHint(inputText) || Boolean(recognitionProductType)
    if (willUseReference && !hasProductContext) {
      return { plan: quickFallback, outputContent: formatQuickPlan(quickFallback) }
    }
    let plan = quickFallback
    try {
      const { system, user } = buildQuickPlanPrompt(mode, inputText, node.data, willUseReference, recognitionProductSummaryField)
      const raw: string = await api().llm.invoke('call', project.text_provider_id, project.text_model_id, [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ], {
        stream: true,
        notifyStream: false,
        max_tokens: 3000,
        timeoutMs: 180000
      })
      const parsed = extractJson<any>(raw, { expect: 'object' })
      plan = normalizeQuickPlan(parsed, mode, node.data, willUseReference)
    } catch (err) {
      if (hasProductContext) {
        const reason = err instanceof Error ? err.message : String(err || '')
        throw new Error(`快捷编排模型生成方案失败，请检查文本模型配置或稍后重试${reason ? `：${reason}` : ''}`)
      }
      console.warn('[Canvas] 快捷编排生成方案失败，使用本地快速方案:', err)
    }
    return { plan, outputContent: formatQuickPlan(plan) }
  }

  async function expandQuickPlanToCanvas(node: any, projectId: string, plan: QuickPlan): Promise<{ nodeIds: string[]; edgeIds: string[] }> {
    const canvasStore = useCanvasStore()
    const project = canvasStore.currentProject
    if (!project?.image_provider_id || !project?.image_model_id) throw new Error('请先在画布设置中配置生图模型')
    const referenceSources = getUpstreamImageSources(node.id, projectId)
    const createdNodeIds: string[] = []
    const createdEdgeIds: string[] = []
    const baseX = (node.position_x || 0) + 360
    let cursorY = node.position_y || 0
    const textX = baseX
    const imageX = baseX + 330
    const rowGap = 260
    const groupGap = 120
    const mode = normalizeQuickMode(node.data.mode)
    const mainSize = pickQuickSize(node.data.main_size, '1:1')
    const detailSize = pickQuickSize(node.data.detail_size, '4:5')
    const commonSize = pickQuickSize(node.data.size, '1:1')
    const tier = String(node.data.tier_id || DEFAULT_TIER_ID)
    const quality = ['auto', 'standard', 'hd'].includes(String(node.data.quality || '')) ? String(node.data.quality) : 'auto'
    const detailConsistencyEnabled = mode === 'product_workflow' && Boolean(node.data.detail_consistency_enabled)
    try {
      for (const group of plan.groups) {
        let previousDetailImageNodeId = ''
        for (let i = 0; i < group.items.length; i++) {
          const item = group.items[i]
          const y = cursorY + i * rowGap
          const textNode = await canvasStore.addNode(projectId, {
            type: 'textInput',
            position_x: textX,
            position_y: y,
            data: {
              text: item.prompt,
              label: item.title
            }
          })
          createdNodeIds.push(textNode.id)
          const size = mode === 'product_workflow'
            ? item.groupType === 'detail' ? detailSize : mainSize
            : commonSize
          const imageNode = await canvasStore.addNode(projectId, {
            type: 'text2img',
            position_x: imageX,
            position_y: y,
            data: {
              model_provider_id: project.image_provider_id,
              model_id: project.image_model_id,
              size,
              tier_id: tier,
              quality,
              // 快捷编排上选的风格预设继承到每个文生图节点：
              // 风格在生成时统一拼接，LLM 方案与本地兜底方案都生效，且可逐节点再调整
              style_id: Number(node.data.style_id) > 0 ? Number(node.data.style_id) : null,
              style_anchor: group.styleAnchor,
              quick_group_type: group.type,
              status: 'idle',
              generation_id: '',
              result_path: ''
            }
          })
          createdNodeIds.push(imageNode.id)
          const textEdge = await canvasStore.addEdge(projectId, {
            source_node_id: textNode.id,
            source_handle: 'output',
            target_node_id: imageNode.id,
            target_handle: 'text-input'
          })
          createdEdgeIds.push(textEdge.id)
          if (item.useReferenceImages) {
            for (const ref of referenceSources) {
              const refEdge = await canvasStore.addEdge(projectId, {
                source_node_id: ref.nodeId,
                source_handle: ref.handle,
                target_node_id: imageNode.id,
                target_handle: 'image-input'
              })
              createdEdgeIds.push(refEdge.id)
            }
          }
          if (detailConsistencyEnabled && item.groupType === 'detail' && previousDetailImageNodeId) {
            const detailConsistencyEdge = await canvasStore.addEdge(projectId, {
              source_node_id: previousDetailImageNodeId,
              source_handle: 'output',
              target_node_id: imageNode.id,
              target_handle: 'image-input'
            })
            createdEdgeIds.push(detailConsistencyEdge.id)
          }
          if (detailConsistencyEnabled && item.groupType === 'detail') {
            previousDetailImageNodeId = imageNode.id
          }
        }
        cursorY += Math.max(1, group.items.length) * rowGap + groupGap
      }
      return { nodeIds: createdNodeIds, edgeIds: createdEdgeIds }
    } catch (err) {
      for (const id of [...createdNodeIds].reverse()) {
        try { await canvasStore.removeNode(id) } catch {}
      }
      throw err
    }
  }

  async function executeNode(nodeId: string, projectId: string): Promise<void> {
    const canvasStore = useCanvasStore()
    const node = canvasStore.nodes.find((n) => n.id === nodeId)
    if (!node) return

    const upstream = getUpstreamData(nodeId, projectId)

    switch (node.type) {
      case 'textInput':
        // Text input nodes don't need execution, they already have data
        break

      case 'refImage':
        // Ref image nodes don't need execution
        break

      case 'videoResult':
        // 视频结果节点：纯展示，不执行
        break

      case 'videoInput':
        // 视频源节点：不需要执行
        break

      case 'promptSlice':
        // Prompt slice nodes don't need execution, they already have data
        break

      case 'quickOrchestrator': {
        const existingCreated = Array.isArray(node.data.created_node_ids) ? node.data.created_node_ids : []
        if (existingCreated.length > 0 && node.data.status === 'done') break
        await canvasStore.updateNode(nodeId, {
          data: { ...node.data, status: 'running', error: '', outputContent: '' }
        })
        const { plan, outputContent } = await generateQuickPlan(node, projectId, upstream)
        const expanded = await expandQuickPlanToCanvas(node, projectId, plan)
        await canvasStore.updateNode(nodeId, {
          data: {
            ...node.data,
            outputContent,
            plan_json: plan,
            created_node_ids: expanded.nodeIds,
            created_edge_ids: expanded.edgeIds,
            status: 'done',
            error: ''
          }
        })
        const project = canvasStore.currentProject
        if (project?.text_provider_id && project?.text_model_id) {
          await recordUsage('chat', project.text_provider_id, project.text_model_id)
        }
        break
      }

      case 'aiText': {
        const inputText = upstream.texts.join('\n') || node.data.text || ''
        if (!inputText) throw new Error('AI 文本节点需要输入：请连接上游文本或在节点中填写')

        const project = canvasStore.currentProject
        if (!project?.text_provider_id || !project?.text_model_id) {
          throw new Error('请先在画布设置中配置文本模型')
        }

        await canvasStore.updateNode(nodeId, {
          data: { ...node.data, status: 'running' }
        })

        // node.data.system_prompt 行为：
        //   未定义（旧节点 / 新建节点）→ 使用默认中文模板（扩写为图像 prompt）
        //   空字符串                  → 不传 system 角色，让 LLM 按用户输入自由响应
        //   非空字符串                → 使用用户自定义系统提示词
        const customSystemPrompt = node.data.system_prompt
        const systemPrompt =
          customSystemPrompt === undefined ? AI_TEXT_DEFAULT_SYSTEM_PROMPT : customSystemPrompt

        const messages: Array<{ role: 'system' | 'user'; content: string }> = systemPrompt
          ? [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: inputText }
            ]
          : [{ role: 'user', content: inputText }]

        const result = await api().llm.invoke(
          'call',
          project.text_provider_id,
          project.text_model_id,
          messages,
          { notifyStream: false }
        )

        await canvasStore.updateNode(nodeId, {
          data: { ...node.data, text: inputText, result: result || inputText, status: 'done' }
        })
        await recordUsage('chat', project.text_provider_id, project.text_model_id)
        break
      }

      case 'agentNode': {
        const inputText = upstream.texts.join('\n') || node.data.text || ''
        if (!inputText) throw new Error('智能体节点需要输入：请连接上游文本或在节点中填写')

        const project = canvasStore.currentProject
        // 统一使用画布设置里的默认文本模型（不再节点级选模型）
        if (!project?.text_provider_id || !project?.text_model_id) {
          throw new Error('请先在画布设置中配置文本模型')
        }

        await canvasStore.updateNode(nodeId, {
          data: { ...node.data, status: 'running' }
        })

        // 本地知识库「直接检索」前置拼接（不经 LLM 工具循环）；检索失败降级为不带库、不阻塞
        let kbContext = ''
        const catIds = Array.isArray(node.data.kb_category_ids) ? node.data.kb_category_ids : []
        if (catIds.length > 0) {
          try {
            const kbResp = await api().canvas.invoke('searchLocalKB', inputText, catIds, 5)
            const hits = (kbResp?.results || []) as Array<{ source: string; content: string }>
            if (hits.length > 0) {
              kbContext = hits.map((h) => `【${h.source}】\n${h.content}`).join('\n\n')
            }
          } catch {
            // 忽略检索异常，继续用纯模型生成
          }
        }

        // 系统提示词 = 节点人设（可空）+ 知识库上下文（若命中）
        const persona = String(node.data.system_prompt ?? '').trim()
        const systemParts: string[] = []
        if (persona) systemParts.push(persona)
        if (kbContext) systemParts.push(`以下是知识库检索到的参考资料，回答时请优先依据这些内容：\n${kbContext}`)
        const systemPrompt = systemParts.join('\n\n')

        const messages: Array<{ role: 'system' | 'user'; content: string }> = systemPrompt
          ? [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: inputText }
            ]
          : [{ role: 'user', content: inputText }]

        const result = await api().llm.invoke('call', project.text_provider_id, project.text_model_id, messages, { notifyStream: false })

        await canvasStore.updateNode(nodeId, {
          data: { ...node.data, text: inputText, result: result || '', status: 'done' }
        })
        await recordUsage('chat', project.text_provider_id, project.text_model_id)
        break
      }

      case 'text2img': {
        const project = canvasStore.currentProject
        if (!project?.image_provider_id || !project?.image_model_id) {
          throw new Error('请先在画布设置中配置生图模型')
        }

        const globalPrompt = (project.system_prompt || '').trim()
        const rawPrompt = (upstream.texts.join('\n') || '').trim()
        if (!rawPrompt) throw new Error('文生图节点需要提示词：请连接文本输入或 AI 文本节点')
        // 风格预设片段拼在主题后（全端统一规则：风格片段永远在最后）
        const themedPrompt = composePromptWithStyle(rawPrompt, await resolveStyleFragment(node.data.style_id))
        // 用 "\n\n---\n\n" 分隔全局风格前缀与本次主题，便于模型区分约束与主题
        const prompt = globalPrompt ? `${globalPrompt}\n\n---\n\n${themedPrompt}` : themedPrompt

        await canvasStore.updateNode(nodeId, {
          data: { ...node.data, status: 'running' }
        })

        const refImageData =
          upstream.images.length > 0 ? await resolveRefImages(upstream.images) : []
        const failedRef = (refImageData as any).__failedCount || 0
        // 用户连了参考图节点本意是希望参与生图——若上游确实有图但本次全部读取失败
        // （路径变更 / 文件被删 / 权限拒绝），不应该静默走纯文生图，必须明确报错。
        // 与 img2img 节点 (line ~349) 保持行为一致。
        if (upstream.images.length > 0 && refImageData.length === 0) {
          throw new Error(`参考图全部读取失败（${upstream.images.length} 张）：请检查上游参考图节点的文件是否仍然存在`)
        }
        if (failedRef > 0) {
          pushProjectWarning(projectId, { nodeId, failed: failedRef, total: upstream.images.length })
        }

        const genOptions: Record<string, any> = {
          prompt,
          modelProviderId: project.image_provider_id,
          modelId: project.image_model_id,
          size: node.data.size || '1:1',
          tierId: node.data.tier_id || '2k',
          quality: node.data.quality || 'auto',
          // v0.6.9+ 指示主进程落盘到 canvas/{projectId}/，文件名用 {nodeId}_{genId}.ext
          // 使 deleteNode 能级联清理、打开画布文件夹能看到所有此画布产出的图
          canvasProjectId: project.id,
          canvasNodeId: nodeId
        }
        if (refImageData.length > 0) {
          genOptions.refImages = refImageData
        }

        const genResults = await api().imageGen.invoke('generate', genOptions)

        const gen = genResults?.[0]
        if (gen && gen.status === 'done') {
          await canvasStore.updateNode(nodeId, {
            data: {
              ...node.data,
              status: 'done',
              generation_id: gen.id,
              result_path: gen.result_path,
              revised_prompt: gen.revised_prompt || '',
              ref_image_count: refImageData.length
            }
          })
          await recordUsage('image', project.image_provider_id, project.image_model_id)
        } else {
          throw new Error(gen?.error || '图像生成失败')
        }
        break
      }

      case 'img2img': {
        if (!upstream.images.length) {
          throw new Error('图生图节点需要参考图：请连接参考图节点或上游图像节点')
        }

        const project = canvasStore.currentProject
        if (!project?.image_provider_id || !project?.image_model_id) {
          throw new Error('请先在画布设置中配置生图模型')
        }

        const globalPromptImg = (project?.system_prompt || '').trim()
        const rawPromptImg = (upstream.texts.join('\n') || node.data.prompt || '').trim()
        if (!rawPromptImg && !globalPromptImg) {
          throw new Error('图生图节点需要提示词：请连接文本输入、在节点中填写描述或在画布全局提示词中配置')
        }
        // 风格预设片段拼在主题后（与文生图节点同一规则）
        const themedPromptImg = composePromptWithStyle(rawPromptImg, await resolveStyleFragment(node.data.style_id))
        const prompt =
          globalPromptImg && themedPromptImg
            ? `${globalPromptImg}\n\n---\n\n${themedPromptImg}`
            : globalPromptImg || themedPromptImg

        await canvasStore.updateNode(nodeId, {
          data: { ...node.data, status: 'running' }
        })

        const refImageData = await resolveRefImages(upstream.images)
        const failedRefImg = (refImageData as any).__failedCount || 0
        if (refImageData.length === 0) {
          throw new Error('参考图读取失败：请检查上游参考图节点是否有效')
        }
        if (failedRefImg > 0) {
          pushProjectWarning(projectId, { nodeId, failed: failedRefImg, total: upstream.images.length })
        }

        const genResults = await api().imageGen.invoke('generate', {
          prompt,
          refImages: refImageData,
          modelProviderId: project.image_provider_id,
          modelId: project.image_model_id,
          size: node.data.size || '1:1',
          tierId: node.data.tier_id || '2k',
          quality: node.data.quality || 'auto',
          // v0.6.9+ 同 text2img，让画布产物落盘到 canvas/{projectId}/{nodeId}_{genId}.ext
          canvasProjectId: project.id,
          canvasNodeId: nodeId
        })

        const gen = genResults?.[0]
        if (gen && gen.status === 'done') {
          await canvasStore.updateNode(nodeId, {
            data: {
              ...node.data,
              status: 'done',
              generation_id: gen.id,
              result_path: gen.result_path,
              revised_prompt: gen.revised_prompt || '',
              ref_image_count: refImageData.length
            }
          })
          await recordUsage('image', project.image_provider_id, project.image_model_id)
        } else {
          throw new Error(gen?.error || '图像生成失败')
        }
        break
      }

      case 'aiVideo': {
        await executeAiVideoNode(node, nodeId, projectId, upstream)
        break
      }

      case 'videoFrames': {
        await executeVideoFramesNode(node, nodeId, projectId)
        break
      }

      case 'videoReverse': {
        await executeVideoReverseNode(node, nodeId, projectId)
        break
      }

      case 'storyboard': {
        await executeStoryboardNode(node, nodeId, projectId, upstream)
        break
      }

      case 'createCharacter': {
        await executeCreateCharacterNode(node, nodeId, projectId, upstream)
        break
      }

      case 'characterRef':
        // 角色引用节点为纯数据源，仅向下游提供定妆图，无需执行逻辑
        break

      case 'reverse': {
        // 图片反推节点：image → text 桥，复用 Image2PromptView 同款调用链
        if (!upstream.images.length) {
          throw new Error('图片反推节点需要上游图像：请连接参考图、生图节点或图片结果节点')
        }

        const project = canvasStore.currentProject
        // 视觉模型优先级：节点覆盖 > project 默认；都为空则报错让用户去设置
        const visionProviderId = node.data.vision_provider_id || project?.vision_provider_id || ''
        const visionModelId = node.data.vision_model_id || project?.vision_model_id || ''
        if (!visionProviderId || !visionModelId) {
          throw new Error('请在节点上选择视觉模型，或在画布设置中配置默认视觉模型')
        }

        await canvasStore.updateNode(nodeId, {
          data: { ...node.data, status: 'running' }
        })

        // 上游图像转 dataURI：反推一次只针对一张图，多连只拿第一张避免混淆模型输出
        const firstImage = upstream.images[0]
        const refImageData = await resolveRefImages([firstImage])
        const failedRefRev = (refImageData as any).__failedCount || 0
        if (refImageData.length === 0) {
          throw new Error('参考图读取失败：请检查上游节点是否仍保留文件')
        }
        if (failedRefRev > 0) {
          pushProjectWarning(projectId, { nodeId, failed: failedRefRev, total: 1 })
        }

        // 压缩后再上传：上游生图节点产出常为 1024+ 超清 PNG，几 MB 的 dataURI 直接
        // 推送云端会使视觉模型推理超过 100 秒被 Cloudflare 网关切断（524）。
        // 参数与 Image2PromptView 一致：长边 1280px / JPEG 0.85，反推场景画质足够。
        let compressedImage: string
        try {
          compressedImage = await compressImage(refImageData[0])
        } catch (e: any) {
          throw new Error(`参考图压缩失败：${e?.message || e}`)
        }

        // 提示词优先级：节点 custom_prompt > 风格预设（style + lang 合拼）
        const customPrompt = (node.data.custom_prompt || '').trim()
        const stylePreset = (node.data.style_preset as StylePreset) || 'general'
        const outputLang = (node.data.output_lang as OutputLang) || 'cn'
        const sys = customPrompt || resolveSystemPrompt(stylePreset, outputLang)
        const userText = getUserPrompt(outputLang)

        const messages = [
          { role: 'system', content: sys },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              { type: 'image_url', image_url: { url: compressedImage } }
            ]
          }
        ]

        const result = await api().llm.invoke(
          'call',
          visionProviderId,
          visionModelId,
          messages
        )

        // llm.invoke 返回形状不统一：string / { content } / object，兑底三种形式
        let resultText = ''
        if (typeof result === 'string') {
          resultText = result.trim()
        } else if (result?.content) {
          resultText = String(result.content).trim()
        } else {
          resultText = String(result || '').trim()
        }
        if (!resultText) {
          throw new Error('反推未返回结果：可能是模型不支持图像输入或上游服务异常')
        }

        await canvasStore.updateNode(nodeId, {
          data: { ...node.data, status: 'done', result: resultText }
        })
        await recordUsage('vision', visionProviderId, visionModelId)
        break
      }

      case 'imageRecognition': {
        if (!upstream.images.length) {
          throw new Error('识图节点需要上游图像：请连接参考图、生图节点或图片结果节点')
        }

        const project = canvasStore.currentProject
        const visionProviderId = node.data.vision_provider_id || project?.vision_provider_id || ''
        const visionModelId = node.data.vision_model_id || project?.vision_model_id || ''
        if (!visionProviderId || !visionModelId) {
          throw new Error('请在节点上选择视觉模型，或在画布设置中配置默认视觉模型')
        }

        await canvasStore.updateNode(nodeId, {
          data: { ...node.data, status: 'running' }
        })

        const firstImage = upstream.images[0]
        const refImageData = await resolveRefImages([firstImage])
        const failedRefRec = (refImageData as any).__failedCount || 0
        if (refImageData.length === 0) {
          throw new Error('参考图读取失败：请检查上游节点是否仍保留文件')
        }
        if (failedRefRec > 0) {
          pushProjectWarning(projectId, { nodeId, failed: failedRefRec, total: 1 })
        }

        let compressedImage: string
        try {
          compressedImage = await compressImage(refImageData[0])
        } catch (e: any) {
          throw new Error(`参考图压缩失败：${e?.message || e}`)
        }

        const messages = [
          {
            role: 'system',
            content: '你是图片内容识别助手。请只基于图片可见内容，客观说明图片是什么、有哪些主要对象、可见文字、场景背景、颜色、材质和明显细节。不要反推生图提示词，不要创作，不要补充不可见信息；无法确定的内容标注为“不确定”。最后必须单独输出一行固定字段“产品总结：这是XXX产品。”，XXX 只写最简短的产品品类；如果无法判断产品品类，输出“产品总结：这是不确定产品。”。使用中文，分点简洁输出。'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: '请识别这张图片里的内容：主体是什么、有哪些物体或文字、场景或背景、明显颜色和细节。最后单独给出“产品总结：这是XXX产品。”字段。' },
              { type: 'image_url', image_url: { url: compressedImage } }
            ]
          }
        ]

        const result = await api().llm.invoke(
          'call',
          visionProviderId,
          visionModelId,
          messages
        )

        let resultText = ''
        if (typeof result === 'string') {
          resultText = result.trim()
        } else if (result?.content) {
          resultText = String(result.content).trim()
        } else {
          resultText = String(result || '').trim()
        }
        if (!resultText) {
          throw new Error('识图未返回结果：可能是模型不支持图像输入或上游服务异常')
        }

        await canvasStore.updateNode(nodeId, {
          data: { ...node.data, status: 'done', result: resultText }
        })
        await recordUsage('vision', visionProviderId, visionModelId)
        break
      }

      case 'imageResult': {
        // Pull result from upstream image
        if (upstream.images.length > 0) {
          await canvasStore.updateNode(nodeId, {
            data: { ...node.data, result_path: upstream.images[0] }
          })
        }
        break
      }

      case 'matting': {
        // v0.6.9+ 画布抠图节点：image → 透明 PNG image
        // 上游图必须存在；模式由 node.data.matting_source 决定（默认 'cloud'）
        if (!upstream.images.length) {
          throw new Error('抠图节点需要上游图像：请连接参考图、生图节点或图片结果节点')
        }
        const project = canvasStore.currentProject
        if (!project) throw new Error('画布项目未加载')

        const source: 'cloud' | 'custom' = node.data.matting_source === 'custom' ? 'custom' : 'cloud'
        const providerId: string | undefined = source === 'custom' ? (node.data.matting_provider_id || undefined) : undefined
        if (source === 'custom' && !providerId) {
          throw new Error('自定义模式需要在节点上选择阿里抠图接口')
        }

        await canvasStore.updateNode(nodeId, {
          data: { ...node.data, status: 'running', error: '' }
        })

        // 把上游图（relative path 或 data URI）解析为本地绝对路径
        // 反推节点用 dataURI，但 matting 服务需要本地路径（阿里 Advance API + 云控端 multipart 都要本地 stream）
        // 注：canvas:saveNodeImage 返回 { image_path: 相对路径 }，所以两条分支都需要拼接 dataDir
        const mattingDataDir = await api().dataDir.get()
        let localPath: string
        const firstImage = upstream.images[0]
        if (firstImage.startsWith('data:')) {
          // data URI：先用 canvas:saveNodeImage 落盘到画布目录（saveNodeImage 内部会先清理本节点旧文件再写）
          const saved = await api().canvas.invoke('saveNodeImage', project.id, nodeId, firstImage) as { image_path?: string }
          if (!saved?.image_path) throw new Error('上游 data URI 落盘失败')
          localPath = `${mattingDataDir}/${saved.image_path}`
        } else {
          localPath = `${mattingDataDir}/${firstImage}`
        }

        let result: { taskId: string; status: 'completed' | 'failed'; resultPath?: string; error?: string }
        try {
          result = await api().matting.invoke('segment', {
            localPath,
            source,
            providerId,
            // 画布节点不入「我的抠图」分类（结果已在节点上展示）
            addToGallery: false,
            canvasProjectId: project.id,
            canvasNodeId: nodeId,
          }) as any
        } catch (e: any) {
          throw new Error(`抠图调用失败：${e?.message || e}`)
        }

        if (result.status === 'failed' || !result.resultPath) {
          throw new Error(result.error || '抠图失败')
        }

        // 结果路径转相对（与生图节点 result_path 字段语义一致）
        // matting service 写到 dataDir/canvas/{projectId}/{nodeId}_{taskId}.png，这里转成 canvas/{projectId}/... 相对形式
        let relPath = result.resultPath
        if (relPath.startsWith(mattingDataDir)) {
          relPath = relPath.slice(mattingDataDir.length).replace(/^[/\\]/, '').replace(/\\/g, '/')
        }

        await canvasStore.updateNode(nodeId, {
          data: {
            ...node.data,
            status: 'done',
            result_path: relPath,
            matting_task_id: result.taskId,
          }
        })
        if (source === 'cloud') refreshCloudBalances()
        break
      }
    }
  }

  // Validate that all nodes with required inputs are properly connected
  function validateConnectivity(projectId: string): { valid: boolean; errors: string[] } {
    const canvasStore = useCanvasStore()
    const nodes = canvasStore.nodes.filter((n) => n.project_id === projectId)
    const edges = canvasStore.edges.filter((e) => e.project_id === projectId)
    const errors: string[] = []

    for (const node of nodes) {
      const def = getNodeTypeDef(node.type)
      if (!def) continue
      for (const input of def.inputs) {
        if (!input.required) continue
        const hasConn = edges.some((e) => e.target_node_id === node.id && e.target_handle === input.handle)
        if (!hasConn) {
          // Source nodes with data are exempt
          if (node.type === 'textInput' && node.data.text) continue
          if (node.type === 'refImage' && (node.data.image_data || node.data.image_path)) continue
          errors.push(`${def.label} 节点缺少必需输入：${input.handle}`)
        }
      }
    }
    return { valid: errors.length === 0, errors }
  }

  // Get predecessor node IDs for a given node
  function getPredecessors(nodeId: string, projectId: string): string[] {
    const canvasStore = useCanvasStore()
    return canvasStore.edges
      .filter((e) => e.project_id === projectId && e.target_node_id === nodeId)
      .map((e) => e.source_node_id)
  }

  async function runWorkflow(projectId: string): Promise<{ ok: boolean; message: string }> {
    if (isProjectRunning(projectId)) return { ok: false, message: '该画布的工作流正在运行中' }
    if ((activeSingleRunsByProject.value.get(projectId)?.size ?? 0) > 0) {
      return { ok: false, message: '该画布有节点正在单独执行，请稍候' }
    }
    setProjectRunning(projectId, true)
    setProjectCancel(projectId, false)
    clearProjectWarnings(projectId)
    const canvasStore = useCanvasStore()

    try {
      // Validate connectivity first
      const { valid, errors } = validateConnectivity(projectId)
      if (!valid) {
        throw new Error(errors.join('; '))
      }

      const concurrency = Math.max(1, canvasStore.currentProject?.concurrency || 1)
      const projectNodes = canvasStore.nodes.filter((n) => n.project_id === projectId)
      const sorted = topologicalSort(projectId)
      if (sorted.length === 0) throw new Error('没有可执行的节点')

      // Cycle detection: Kahn's algorithm drops cycle nodes; compare lengths
      if (sorted.length !== projectNodes.length) {
        const inCycle = projectNodes
          .filter((n) => !sorted.includes(n.id))
          .map((n) => {
            const def = getNodeTypeDef(n.type)
            return def?.label || n.type
          })
        throw new Error(`检测到循环依赖：${inCycle.join('、')}`)
      }

      // Initialize statuses
      const statusMap = new Map<string, TaskStatus>()
      for (const id of sorted) statusMap.set(id, 'pending')
      tasks.value = sorted.map((id) => ({ nodeId: id, status: 'pending' as TaskStatus }))
      nodeStatuses.value = statusMap

      // Mark source nodes as done immediately
      for (const nodeId of sorted) {
        const node = canvasStore.nodes.find((n) => n.id === nodeId)
        if (!node) continue
        if (node.type === 'textInput' && node.data.text) {
          statusMap.set(nodeId, 'done')
        }
        if (node.type === 'refImage' && (node.data.image_data || node.data.image_path)) {
          statusMap.set(nodeId, 'done')
        }
        if (node.type === 'promptSlice' && node.data.rows?.length > 0) {
          statusMap.set(nodeId, 'done')
        }
      }

      // Sliding-window concurrency: keep up to `concurrency` tasks in flight.
      // Finished slots are refilled as soon as a task completes, not after a batch barrier.
      const allNodes = new Set(sorted)
      const inflight = new Map<string, Promise<void>>()

      const launchTask = (nodeId: string): Promise<void> => {
        const node = canvasStore.nodes.find((n) => n.id === nodeId)
        if (!node) {
          statusMap.set(nodeId, 'skipped')
          return Promise.resolve()
        }

        const { ok, missing } = checkRequiredInputs(nodeId, projectId)
        const def = getNodeTypeDef(node.type)
        if (!ok && def && def.inputs.some((i) => i.required)) {
          statusMap.set(nodeId, 'blocked')
          return canvasStore
            .updateNode(nodeId, {
              data: { ...node.data, status: 'blocked', error: `缺少必需输入：${missing.join('、')}` }
            })
            .then(() => {})
        }

        statusMap.set(nodeId, 'running')
        return executeNode(nodeId, projectId)
          .then(() => {
            statusMap.set(nodeId, 'done')
          })
          .catch(async (e: any) => {
            statusMap.set(nodeId, 'error')
            await canvasStore.updateNode(nodeId, {
              data: { ...node.data, status: 'error', error: toFriendlyNodeError(e, '未知错误') }
            })
          })
      }

      const findReady = (): { ready: string[]; blocked: string[] } => {
        const ready: string[] = []
        const blocked: string[] = []
        for (const nodeId of allNodes) {
          if (statusMap.get(nodeId) !== 'pending') continue
          if (inflight.has(nodeId)) continue
          const preds = getPredecessors(nodeId, projectId)
          const allPredsFinished = preds.every((p) => {
            const s = statusMap.get(p)
            return s !== 'pending' && s !== 'running'
          })
          if (!allPredsFinished) continue
          const anyPredFailed = preds.some((p) => {
            const s = statusMap.get(p)
            return s === 'error' || s === 'blocked'
          })
          if (anyPredFailed) blocked.push(nodeId)
          else ready.push(nodeId)
        }
        return { ready, blocked }
      }

      while (true) {
        // 软取消：不再启动新任务，但已 inflight 的让它跑完（保证 DB/state 一致）。
        // pending 状态的节点统一打 skipped 并写库，避免切回画布看到僵尸 pending。
        if (cancelRequestedProjects.value.has(projectId)) {
          for (const nodeId of allNodes) {
            if (statusMap.get(nodeId) === 'pending' && !inflight.has(nodeId)) {
              statusMap.set(nodeId, 'skipped')
              const node = canvasStore.nodes.find((n) => n.id === nodeId)
              if (node) {
                await canvasStore.updateNode(nodeId, {
                  data: { ...node.data, status: 'skipped', error: '已取消' }
                })
              }
            }
          }
          if (inflight.size === 0) break
          await Promise.race(inflight.values())
          continue
        }

        const { ready, blocked } = findReady()

        // Propagate failure to blocked nodes immediately
        for (const nodeId of blocked) {
          statusMap.set(nodeId, 'blocked')
          const node = canvasStore.nodes.find((n) => n.id === nodeId)
          if (node) {
            await canvasStore.updateNode(nodeId, {
              data: { ...node.data, status: 'blocked', error: '上游节点执行失败' }
            })
          }
        }

        // Fill up any free slots with ready tasks
        while (inflight.size < concurrency && ready.length > 0) {
          const nodeId = ready.shift()!
          const task = launchTask(nodeId).finally(() => {
            inflight.delete(nodeId)
          })
          inflight.set(nodeId, task)
        }

        if (inflight.size === 0) {
          // Nothing running, nothing runnable: we're either done or only 'blocked' propagation remains
          const { ready: r2, blocked: b2 } = findReady()
          if (r2.length === 0 && b2.length === 0) break
          continue
        }

        // Wait for any task to finish, then re-evaluate readiness
        await Promise.race(inflight.values())
      }

      nodeStatuses.value = statusMap

      // Summarize results
      const doneCount = [...statusMap.values()].filter((s) => s === 'done').length
      const errorCount = [...statusMap.values()].filter((s) => s === 'error').length
      const blockedCount = [...statusMap.values()].filter((s) => s === 'blocked').length
      if (errorCount > 0 || blockedCount > 0) {
        return { ok: false, message: `${doneCount} 个完成，${errorCount} 个失败，${blockedCount} 个阻塞` }
      }
      return { ok: true, message: `${doneCount} 个节点完成` }
    } catch (e: any) {
      // Global workflow error — surface it on all pending nodes
      const friendly = toFriendlyNodeError(e, '工作流执行失败')
      const canvasStore2 = useCanvasStore()
      for (const node of canvasStore2.nodes.filter((n) => n.project_id === projectId)) {
        if (!node.data.status || node.data.status === 'pending') {
          await canvasStore2.updateNode(node.id, {
            data: { ...node.data, status: 'error', error: friendly }
          })
        }
      }
      return { ok: false, message: e?.message || '工作流执行失败' }
    } finally {
      setProjectRunning(projectId, false)
      setProjectCancel(projectId, false)
    }
  }

  /** 软取消当前工作流：不再启动新节点，已 inflight 让它跑完保证 DB/state 一致。
   * 仅对 runWorkflow 生效；executeSingleNode 没有循环结构，无法中途打断（fetch 已发） */
  function cancelWorkflow(projectId: string): boolean {
    if (!workflowRunningProjects.value.has(projectId)) return false
    setProjectCancel(projectId, true)
    return true
  }

  /** 全局停止所有在跑的画布工作流（跨页面徽标用）。 */
  function cancelAllWorkflows(): boolean {
    const pids = [...workflowRunningProjects.value]
    if (pids.length === 0) return false
    for (const pid of pids) setProjectCancel(pid, true)
    return true
  }

  async function executeSingleNode(nodeId: string, projectId: string) {
    // 仅当「本画布」在跑整工作流、或该节点已在单独执行时阻止（不受其它画布运行影响）
    if (isProjectRunning(projectId)) return
    if (activeSingleRunsByProject.value.get(projectId)?.has(nodeId)) return
    // 单节点执行入口也清空一次本画布的警告聚合，避免与上一次执行的 warnings 混淆
    clearProjectWarnings(projectId)
    const canvasStore = useCanvasStore()
    const node = canvasStore.nodes.find((n) => n.id === nodeId)
    if (!node) return

    const { ok, missing } = checkRequiredInputs(nodeId, projectId)
    const def = getNodeTypeDef(node.type)
    if (!ok && def && def.inputs.some((i) => i.required)) {
      await canvasStore.updateNode(nodeId, {
        data: { ...node.data, status: 'error', error: `缺少必需输入：${missing.join('、')}` }
      })
      return
    }

    // 登记到本画布的单节点执行集合，供本画布的按钮门控与徽标计数观察
    addSingleRun(projectId, nodeId)
    try {
      await executeNode(nodeId, projectId)
    } catch (e: any) {
      await canvasStore.updateNode(nodeId, {
        data: { ...node.data, status: 'error', error: toFriendlyNodeError(e, '未知错误') }
      })
    } finally {
      removeSingleRun(projectId, nodeId)
    }
  }

  // === AI 视频节点：登记统一轮询 + 提交执行 ===

  /** 把视频任务登记到统一后台轮询；每轮 refresh 后落盘 + 更新节点 data。单节点生成与重开恢复用。 */
  function attachVideoTaskPolling(nodeId: string, projectId: string, taskId: string): void {
    const { register } = useVideoTaskPolling()
    register(taskId, async (task: any) => { await applyVideoTaskToNode(nodeId, projectId, taskId, task) })
  }

  /** 工作流模式下等待视频任务到终态（下游依赖视频产物），期间持续落盘 + 更新节点。 */
  async function waitVideoTaskTerminal(nodeId: string, projectId: string, taskId: string): Promise<void> {
    const intervalMs = 6000
    const deadline = Date.now() + 30 * 60 * 1000
    while (Date.now() < deadline) {
      if (cancelRequestedProjects.value.has(projectId)) return
      await new Promise((r) => setTimeout(r, intervalMs))
      let task: any = null
      try {
        const res = await cloudClient.refreshVideoTask(taskId)
        task = res?.task
      } catch {
        continue
      }
      if (!task) continue
      await applyVideoTaskToNode(nodeId, projectId, taskId, task)
      if (['completed', 'failed', 'canceled'].includes(task.status)) {
        if (task.status !== 'completed') throw new Error(task.error_message || task.error || '视频生成失败')
        return
      }
    }
    throw new Error('视频生成超时')
  }

  /** 执行 AI 视频节点：选规格匹配计费档 → 按 handle 收集/上传参考图 → 提交 → 登记轮询。 */
  async function executeAiVideoNode(node: any, nodeId: string, projectId: string, upstream: UpstreamData): Promise<void> {
    const canvasStore = useCanvasStore()
    const { getModel, matchSku, loadCatalog } = useVideoCatalogSelection()
    await loadCatalog()

    const model = getModel(String(node.data.model_id || ''))
    if (!model) throw new Error('请先在节点中选择视频模型')

    const mode = String(node.data.mode || '')
    const duration: number | '' = Number(node.data.duration_seconds) || ''
    const resolution = String(node.data.resolution || '')
    const aspectRatio = String(node.data.aspect_ratio || '')
    const sku = matchSku(model, { mode, duration, resolution, aspect_ratio: aspectRatio })
    if (!sku) throw new Error('当前规格暂无可用计费档，请调整时长 / 清晰度')

    const isFirstLast = mode === 'first_last_frame'
    // 后端 clientSubmit 要求 prompt 必填，所有模式（含首尾帧）都需要提示词
    const prompt = (upstream.texts.join('\n') || node.data.prompt || '').trim()
    if (!prompt) {
      throw new Error('AI 视频节点需要提示词：请连接文本输入或在节点中填写')
    }

    // 收集参考图并上传（按 handle 分槽：首尾帧 vs 参考图）
    const referenceAssets: Array<{ asset_type: string; url: string; role: string; index: number }> = []
    if (isFirstLast) {
      const first = getUpstreamImagesByHandle(nodeId, projectId, 'first-frame-input')[0]
      const last = getUpstreamImagesByHandle(nodeId, projectId, 'last-frame-input')[0]
      if (!first || !last) throw new Error('首尾帧模式需要分别连接「首帧」和「尾帧」图片节点')
      referenceAssets.push({ asset_type: 'image', url: await uploadCanvasImageToCloud(first), role: 'first_frame', index: 1 })
      referenceAssets.push({ asset_type: 'image', url: await uploadCanvasImageToCloud(last), role: 'last_frame', index: 2 })
    } else {
      const refs = getUpstreamImagesByHandle(nodeId, projectId, 'image-input')
      const max = Number(model.max_reference_images) || 0
      const picked = max > 0 ? refs.slice(0, max) : refs
      for (let i = 0; i < picked.length; i++) {
        referenceAssets.push({ asset_type: 'image', url: await uploadCanvasImageToCloud(picked[i]), role: 'reference', index: i + 1 })
      }
    }

    await canvasStore.updateNode(nodeId, {
      data: { ...node.data, sku_key: sku.sku_key, status: 'running', progress: 1, error: '', cloud_task_id: '', result_path: '', video_url: '', cover_url: '' }
    })

    const payload: Record<string, any> = {
      sku_key: sku.sku_key,
      prompt,
      mode,
      duration_seconds: Number(duration) || sku.duration_seconds,
      resolution: resolution || sku.resolution,
      aspect_ratio: aspectRatio || sku.aspect_ratio,
    }
    if (referenceAssets.length) {
      payload.reference_assets = referenceAssets
      payload.reference_image_urls = referenceAssets.map((a) => a.url)
    }

    const res = await cloudClient.submitVideoTask(payload)
    const task = res?.task
    if (!task?.id) throw new Error('视频任务提交失败')

    const latest = canvasStore.nodes.find((n) => n.id === nodeId)
    await canvasStore.updateNode(nodeId, {
      data: { ...(latest?.data || node.data), cloud_task_id: task.id, status: 'running', progress: Number(task.progress) || 1 }
    })
    try { await syncVideoRecordForNode(task, projectId, nodeId) } catch { /* 首次落盘失败不阻塞，轮询会重试 */ }
    if (isProjectRunning(projectId)) {
      // 工作流批量执行：等待视频完成，下游节点才能拿到产物
      await waitVideoTaskTerminal(nodeId, projectId, task.id)
    } else {
      // 单节点生成：后台轮询，不阻塞用户
      attachVideoTaskPolling(nodeId, projectId, task.id)
    }
  }

  // ===== 关键帧抽取 / 视频反推 / 智能分镜 =====

  function frameIdFor(mode: string, index: number): string {
    if (mode === 'first_last') return index === 0 ? 'first' : 'last'
    return `f${index}`
  }

  /** 关键帧抽取：上游视频 → 前端抽帧 → 批量落盘 → frames（每帧一个 image 动态输出）。 */
  async function executeVideoFramesNode(node: any, nodeId: string, projectId: string): Promise<void> {
    const canvasStore = useCanvasStore()
    const videoPath = getUpstreamVideo(nodeId, projectId)
    if (!videoPath) throw new Error('关键帧抽取需要连接「视频输入」节点')
    await canvasStore.updateNode(nodeId, { data: { ...node.data, status: 'running', error: '' } })

    const { extractFrames } = useVideoFrames()
    const mode = String(node.data.mode || 'uniform')
    const raw = await extractFrames(videoPath, {
      mode: mode as any,
      count: Number(node.data.count) || 4,
      intervalSec: Number(node.data.intervalSec) || 2,
      maxFrames: 20,
    })
    if (!raw.length) throw new Error('未能从视频抽取到关键帧')

    const payload = raw.map((f, i) => ({ id: frameIdFor(mode, i), dataUrl: f.dataUrl, time: f.time }))
    const saved = await api().canvas.invoke('saveNodeFrames', projectId, nodeId,
      payload.map((p) => ({ id: p.id, dataUrl: p.dataUrl }))) as Array<{ id: string; path: string }>
    const pathById = new Map((saved || []).map((s) => [s.id, s.path]))
    const frames = payload
      .map((p) => ({ id: p.id, time: p.time, path: pathById.get(p.id) || '' }))
      .filter((f) => f.path)

    const latest = canvasStore.nodes.find((n) => n.id === nodeId)
    await canvasStore.updateNode(nodeId, { data: { ...(latest?.data || node.data), status: 'done', frames } })
  }

  function buildVideoReverseSystemPrompt(mode: string, lang: string): string {
    if (mode === 'storyboard') {
      return lang === 'en'
        ? 'You are a film director. Break these video keyframes (in time order) into shots; output one concise English image/video prompt per shot, one per line. No extra text.'
        : '你是影视导演。请把这些按时间排列的视频关键帧拆解为分镜，每个镜头输出一句可直接用于生图/生视频的中文画面提示词，每行一个，不要其他内容。'
    }
    return lang === 'en'
      ? 'You are a video analysis expert. Synthesize these keyframes into ONE detailed English prompt suitable for video generation (subject, scene, action, camera, style). Output a single paragraph.'
      : '你是视频分析专家。请把这些关键帧综合为一段可直接用于视频生成的中文提示词（主体、场景、动作、运镜、风格），只输出一段文字。'
  }

  /** 视频反推：上游视频 → 抽代表帧 → 多模态拆解为提示词 / 分镜文本（复用视觉模型链）。 */
  async function executeVideoReverseNode(node: any, nodeId: string, projectId: string): Promise<void> {
    const canvasStore = useCanvasStore()
    const project = canvasStore.currentProject
    const videoPath = getUpstreamVideo(nodeId, projectId)
    if (!videoPath) throw new Error('视频反推需要连接「视频输入」节点')

    const visionProviderId = node.data.vision_provider_id || project?.vision_provider_id || ''
    const visionModelId = node.data.vision_model_id || project?.vision_model_id || ''
    if (!visionProviderId || !visionModelId) {
      throw new Error('请在节点选择视觉模型，或在画布设置中配置默认视觉模型')
    }
    await canvasStore.updateNode(nodeId, { data: { ...node.data, status: 'running', error: '' } })

    const { extractFrames } = useVideoFrames()
    const limit = Math.max(2, Math.min(12, Number(node.data.frameLimit) || 8))
    const raw = await extractFrames(videoPath, { mode: 'uniform', count: limit, maxFrames: limit })
    if (!raw.length) throw new Error('未能从视频抽取关键帧用于反推')

    const images: string[] = []
    for (const f of raw) {
      try { images.push(await compressImage(f.dataUrl)) } catch { images.push(f.dataUrl) }
    }

    const outputLang = node.data.output_lang === 'en' ? 'en' : 'cn'
    const mode = node.data.mode === 'storyboard' ? 'storyboard' : 'prompt'
    const sys = buildVideoReverseSystemPrompt(mode, outputLang)
    const userContent: any[] = [{ type: 'text', text: outputLang === 'en' ? 'Keyframes in time order:' : '按时间顺序的关键帧：' }]
    for (const url of images) userContent.push({ type: 'image_url', image_url: { url } })

    const result = await api().llm.invoke('call', visionProviderId, visionModelId, [
      { role: 'system', content: sys },
      { role: 'user', content: userContent },
    ])
    let resultText = ''
    if (typeof result === 'string') resultText = result.trim()
    else if (result?.content) resultText = String(result.content).trim()
    else resultText = String(result || '').trim()
    if (!resultText) throw new Error('反推未返回结果：可能模型不支持图像输入或上游异常')

    const latest = canvasStore.nodes.find((n) => n.id === nodeId)
    await canvasStore.updateNode(nodeId, { data: { ...(latest?.data || node.data), status: 'done', result: resultText } })
    await recordUsage('vision', visionProviderId, visionModelId)
  }

  /** 智能分镜：小说/剧情文本 → LLM 拆镜头 → shots（每镜头一个 text 动态输出）。 */
  async function executeStoryboardNode(node: any, nodeId: string, _projectId: string, upstream: UpstreamData): Promise<void> {
    const canvasStore = useCanvasStore()
    const project = canvasStore.currentProject
    if (!project?.text_provider_id || !project?.text_model_id) {
      throw new Error('请先在画布设置中配置文本模型')
    }
    const source = (upstream.texts.join('\n') || node.data.text || '').trim()
    if (!source) throw new Error('智能分镜需要输入：请连接文本节点或在节点中填写小说/剧情')
    await canvasStore.updateNode(nodeId, { data: { ...node.data, status: 'running', error: '' } })

    const sys = '你是影视分镜策划师。请把用户提供的小说/剧情文本拆分成镜头列表，每个镜头输出一句可直接用于生图/生视频的中文画面提示词。只输出 JSON 对象 {"shots":[{"scene_index":1,"prompt":"...","shot_size":"","camera":"","mood":""}]}，不要其他内容。'
    const result = await api().llm.invoke('call', project.text_provider_id, project.text_model_id,
      [{ role: 'system', content: sys }, { role: 'user', content: source }],
      { stream: false, notifyStream: false, max_tokens: 4000, response_format: { type: 'json_object' } })

    const extracted = extractJson(result)
    let arr: any[] = []
    if (Array.isArray(extracted)) arr = extracted
    else if (extracted && typeof extracted === 'object') {
      const found = Object.values(extracted).find((v) => Array.isArray(v))
      arr = Array.isArray(found) ? found : []
    }
    if (!arr.length) throw new Error('AI 未返回有效分镜')

    const shots = arr.slice(0, 30).map((it: any, i: number) => ({
      id: `s${i}`,
      scene_index: (it && it.scene_index) || i + 1,
      prompt: String((it && (it.prompt || it.描述 || it.提示词)) || (typeof it === 'string' ? it : '')).trim(),
      shot_size: String((it && it.shot_size) || ''),
      camera: String((it && it.camera) || ''),
      mood: String((it && it.mood) || ''),
    })).filter((s: any) => s.prompt)
    if (!shots.length) throw new Error('AI 返回中未找到可用镜头提示词')

    const latest = canvasStore.nodes.find((n) => n.id === nodeId)
    await canvasStore.updateNode(nodeId, { data: { ...(latest?.data || node.data), status: 'done', shots } })
    await recordUsage('chat', project.text_provider_id, project.text_model_id)
  }

  async function executeCreateCharacterNode(node: any, nodeId: string, projectId: string, upstream: UpstreamData): Promise<void> {
    const canvasStore = useCanvasStore()
    const project = canvasStore.currentProject
    if (!project?.image_provider_id || !project?.image_model_id) {
      throw new Error('请先在画布设置中配置生图模型')
    }
    const desc = (upstream.texts.join('\n') || node.data.description || '').trim()
    if (!desc) throw new Error('创建角色需要描述：请连接文本或在节点中填写')
    await canvasStore.updateNode(nodeId, { data: { ...node.data, status: 'running', error: '' } })

    const gen = (await api().imageGen.invoke('generate', {
      prompt: desc,
      modelProviderId: project.image_provider_id,
      modelId: project.image_model_id,
      size: node.data.size || '1:1',
      tierId: node.data.tier_id || '2k',
      quality: 'auto',
      canvasProjectId: project.id,
      canvasNodeId: nodeId
    }))?.[0]
    if (!gen || gen.status !== 'done') throw new Error(gen?.error || '角色定妆图生成失败')

    // 角色入库失败不应阻断节点产出：定妆图已生成，库写入异常仅丢失复用能力
    let character: any = null
    try {
      character = await api().canvas.invoke('createCharacter', projectId, {
        name: node.data.name || '角色',
        description: desc,
        ref_image_path: gen.result_path
      })
    } catch {
      character = null
    }

    const latest = canvasStore.nodes.find((n) => n.id === nodeId)
    await canvasStore.updateNode(nodeId, {
      data: { ...(latest?.data || node.data), status: 'done', result_path: gen.result_path, character_id: character?.id || '' }
    })
    await recordUsage('image', project.image_provider_id, project.image_model_id)
  }

  return {
    // 按 projectId 的选择器（各画布 UI 只观察自己的运行态）
    isProjectRunning,
    isProjectAnyRunning,
    getProjectRefImageWarnings,
    // 全局派生（跨画布徽标）
    anyRunningGlobal,
    workflowRunningGlobal,
    activeSingleRunCount,
    runningProjectIds,
    // 执行 / 取消
    runWorkflow,
    cancelWorkflow,
    cancelAllWorkflows,
    executeSingleNode,
    attachVideoTaskPolling,
    // 无副作用的连通性校验：供画布智能体 canvas_run 做运行前自检（dry pre-flight），
    // 不像 runWorkflow 会切换运行态
    validateConnectivity
  }
}
