/**
 * AI 应用相关接口，见 docs/API开发文档.md §3.2
 */
import { request } from '../request'
import { appV1Client, apiErrorCode } from '../v1-client'
import { USE_MOCK } from '../config'
import { AI_IMAGE_APP_ID, IMAGE_RATIO_OPTIONS, productionAppCategories } from '../catalog'
import type { AppModel, AppTask, BootstrapPayload } from '@zihui/contracts'
import type {
  AppCategory,
  AppDetail,
  AppDetailRaw,
  AppSchemaField,
  WorkflowQueryResult,
  WorkflowRunRequest,
  WorkflowRunResult,
} from '../types'

export async function getBootstrap(): Promise<BootstrapPayload | null> {
  try {
    return await appV1Client.bootstrap()
  } catch (error) {
    console.warn(`[bootstrap] failed (${apiErrorCode(error)})`)
    return null
  }
}

/** 分类应用列表 */
export async function getAppListByCategory(): Promise<AppCategory[]> {
  if (USE_MOCK) {
    const res = await request<AppCategory[]>({ path: '/ai/app/GetAppListByCategory' })
    return res.code === 200 && Array.isArray(res.data) ? res.data : []
  }

  const bootstrap = await getBootstrap()
  return bootstrap?.features.image?.enabled ? productionAppCategories : []
}

/** input_form.type → 前端字段类型，见 §3.2.2 映射表 */
function mapField(field: AppDetailRaw['input_form'][number]): AppSchemaField | null {
  const attach = field.attach || {}
  const base = {
    id: field.name,
    label: field.label,
    scope: 'form' as const,
    required: Boolean(field.required),
    placeholder: attach.placeholder,
    default: field.default,
  }
  switch (field.type) {
    case 'input-text':
    case 'input-textarea':
      return {
        ...base,
        type: 'textarea',
        rows: attach.rows,
        maxlength: attach.maxlength,
        optimize: attach.optimize === 1,
      }
    case 'input-number':
      return { ...base, type: 'number', min: attach.min, max: attach.max }
    case 'radio':
    case 'select':
      return { ...base, type: 'select', options: attach.options || [] }
    /**
     * 偏离 docs/API开发文档.md §3.2.2：文档把 checkbox 也归到 select，
     * 但 checkbox 是多选语义，用单选 picker 会把多个值压成一个字符串。
     * 这里按语义映射到多选卡，待后端确认后同步改文档。
     */
    case 'checkbox':
      return { ...base, type: 'card-multi-select', options: attach.options || [] }
    case 'one-level-label-value':
      return {
        ...base,
        type: 'card-select',
        // 该类型取 label 作为提交值
        options: (attach.options || []).map((o) => ({ ...o, value: o.label })),
      }
    default:
      // 契约是忽略未知类型（§3.2.2），但静默丢弃会让「表单少一项 + 提交缺参」
      // 无从排查，这里留一条告警。
      console.warn(
        `[schema] 未支持的 input_form.type「${field.type}」，字段「${field.name}」已跳过`,
      )
      return null
  }
}

/** 应用详情：后端原始结构 → 前端 schema */
export async function getAppDetail(uuid: string): Promise<AppDetail | null> {
  if (!USE_MOCK) return getProductionAppDetail(uuid)

  const res = await request<AppDetailRaw>({ path: '/ai/app/GetApp', argument: { uuid } })
  if (res.code !== 200 || !res.data) return null
  const raw = res.data

  const fields: AppSchemaField[] = []

  if (raw.input_image > 0) {
    fields.push({
      id: 'input_image',
      label: '上传图片',
      type: 'image',
      scope: 'system',
      required: true,
      maxCount: raw.input_image,
    })
  }

  if (raw.internal_prompt?.length) {
    fields.push({
      id: 'internal_prompt',
      label: '生成风格',
      type: 'card-multi-select',
      scope: 'system',
      required: false,
      options: raw.internal_prompt,
    })
  }

  raw.input_form?.forEach((item) => {
    const mapped = mapField(item)
    if (mapped) fields.push(mapped)
  })

  return {
    app: {
      id: raw.uuid,
      name: raw.name,
      description: raw.description,
      price: raw.price,
      resultType: raw.type === 1 ? 'image' : 'message',
    },
    workflowVersionId: raw.workflow_uuid,
    appSchema: { version: 1, fields },
  }
}

function modelOptionValue(model: AppModel): string {
  return `${model.id}::${model.model_id}`
}

async function getProductionAppDetail(uuid: string): Promise<AppDetail | null> {
  if (uuid !== AI_IMAGE_APP_ID) return null

  const bootstrap = await getBootstrap()
  if (!bootstrap?.features.image?.enabled) return null

  const models = await appV1Client.models('image')
  if (!models.length) return null

  const fields: AppSchemaField[] = [
    ...(bootstrap.features.assets?.enabled ? [{
      id: 'input_image', label: '参考图', type: 'image' as const, scope: 'system' as const,
      required: false, maxCount: 4,
    }] : []),
    {
      id: 'prompt',
      label: '画面描述',
      type: 'textarea',
      scope: 'form',
      required: true,
      placeholder: '描述主体、场景、构图、光线和风格',
      maxlength: 20000,
      rows: 5,
    },
    {
      id: 'model',
      label: '生成模型',
      type: 'select',
      scope: 'form',
      required: true,
      default: modelOptionValue(models[0]),
      options: models.map((model) => ({
        label: `${model.name} · ${model.provider_name}`,
        value: modelOptionValue(model),
      })),
    },
    {
      id: 'ratio', label: '图片比例', type: 'card-select', scope: 'form', required: true,
      default: '1:1', options: IMAGE_RATIO_OPTIONS,
    },
    { id: 'n', label: '生成数量', type: 'number', scope: 'form', required: true, min: 1, max: 4, default: 1 },
  ]

  return {
    app: {
      id: AI_IMAGE_APP_ID,
      name: 'AI 生图',
      description: '描述想要的画面，选择生成模型与图片比例',
      price: 0,
      resultType: 'image',
    },
    workflowVersionId: 'app-v1-image-task',
    appSchema: {
      version: 1,
      fields,
    },
  }
}

function imageTaskPayload(payload: WorkflowRunRequest): Record<string, unknown> | null {
  if (payload.uuid !== AI_IMAGE_APP_ID) return null

  const selectedModel = String(payload.form.model || '')
  const separator = selectedModel.indexOf('::')
  if (separator <= 0) return null

  const cloudModelId = Number(selectedModel.slice(0, separator))
  const model = selectedModel.slice(separator + 2)
  const prompt = String(payload.form.prompt || '').trim()
  if (!Number.isInteger(cloudModelId) || cloudModelId <= 0 || !model || !prompt) return null

  const assetIds = Array.isArray(payload.system.asset_ids) ? payload.system.asset_ids : []
  return {
    model,
    cloud_model_id: cloudModelId,
    prompt,
    ratio: String(payload.form.ratio || '1:1'),
    n: Number(payload.form.n || 1),
    ...(assetIds.length ? { asset_ids: assetIds } : {}),
  }
}

function toWorkflowRunResult(task: AppTask): WorkflowRunResult {
  return {
    task_uuid: task.id,
    task_id: task.id,
    queue_key: '',
    task_type: task.type,
    status: task.status,
  }
}

function toWorkflowQueryResult(task: AppTask): WorkflowQueryResult {
  const status = {
    queued: 'queued',
    processing: 'running',
    succeeded: 'success',
    failed: 'failed',
    cancelled: 'failed',
  }[task.status]

  return {
    task_uuid: task.id,
    task_id: task.id,
    task_type: task.type,
    queue_key: '',
    status,
    result: (task.result || {}) as WorkflowQueryResult['result'],
    error: task.error ? { code: task.error.code } : undefined,
    error_message:
      task.error?.message || (task.status === 'cancelled' ? '任务已取消' : undefined),
  }
}

/** 提交生成任务 */
export async function runWorkflow(payload: WorkflowRunRequest): Promise<WorkflowRunResult | null> {
  if (USE_MOCK) {
    const res = await request<WorkflowRunResult>({
      path: '/ai/app/worker/Run',
      method: 'POST',
      argument: payload as unknown as Record<string, unknown>,
    })
    return res.code === 200 ? res.data : null
  }

  const taskPayload = imageTaskPayload(payload)
  if (!taskPayload) return null
  return toWorkflowRunResult(await appV1Client.createImageTask(taskPayload))
}

/** 查询任务状态 */
export async function queryWorkflow(taskUuid: string): Promise<WorkflowQueryResult | null> {
  if (USE_MOCK) {
    const res = await request<WorkflowQueryResult>({
      path: '/ai/app/worker/Query',
      argument: { task_uuid: taskUuid },
      silent: true,
    })
    return res.code === 200 ? res.data : null
  }

  return toWorkflowQueryResult(await appV1Client.task(taskUuid))
}

/** AI 帮写：文 → 文 */
export async function optimizeText(uuid: string, field: string, text: string): Promise<string> {
  if (!USE_MOCK) return ''

  const res = await request<{ text: string }>({
    path: '/ai/app/worker/OptimizeTextToText',
    method: 'POST',
    argument: { uuid, field, text },
  })
  return res.code === 200 ? res.data?.text || '' : ''
}

/** AI 帮写：图 → 文 */
export async function optimizeImage(uuid: string, field: string, images: string[]): Promise<string> {
  if (!USE_MOCK) return ''

  const res = await request<{ text: string }>({
    path: '/ai/app/worker/OptimizeImageToText',
    method: 'POST',
    argument: { uuid, field, images },
  })
  return res.code === 200 ? res.data?.text || '' : ''
}

/** 从任务结果中解析图片 URL，优先级见 §3.2.4 */
export function extractResultImages(result?: WorkflowQueryResult['result']): string[] {
  if (!result) return []
  const list = [...(result.images || []), ...(result.data || [])]
    .map((item) => item.url || item.file_url)
    .filter((url): url is string => Boolean(url))
  if (list.length) return list
  const single = result.url || result.file_url
  return single ? [single] : []
}
