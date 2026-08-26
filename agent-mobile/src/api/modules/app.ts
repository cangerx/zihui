/**
 * AI 应用相关接口，见 docs/API开发文档.md §3.2
 */
import { request } from '../request'
import type {
  AppCategory,
  AppDetail,
  AppDetailRaw,
  AppSchemaField,
  WorkflowQueryResult,
  WorkflowRunRequest,
  WorkflowRunResult,
} from '../types'

/** 分类应用列表 */
export async function getAppListByCategory(): Promise<AppCategory[]> {
  const res = await request<AppCategory[]>({ path: '/ai/app/GetAppListByCategory' })
  return res.code === 200 && Array.isArray(res.data) ? res.data : []
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

/** 提交生成任务 */
export async function runWorkflow(payload: WorkflowRunRequest): Promise<WorkflowRunResult | null> {
  const res = await request<WorkflowRunResult>({
    path: '/ai/app/worker/Run',
    method: 'POST',
    argument: payload as unknown as Record<string, unknown>,
  })
  return res.code === 200 ? res.data : null
}

/** 查询任务状态 */
export async function queryWorkflow(taskUuid: string): Promise<WorkflowQueryResult | null> {
  const res = await request<WorkflowQueryResult>({
    path: '/ai/app/worker/Query',
    argument: { task_uuid: taskUuid },
    silent: true,
  })
  return res.code === 200 ? res.data : null
}

/** AI 帮写：文 → 文 */
export async function optimizeText(uuid: string, field: string, text: string): Promise<string> {
  const res = await request<{ text: string }>({
    path: '/ai/app/worker/OptimizeTextToText',
    method: 'POST',
    argument: { uuid, field, text },
  })
  return res.code === 200 ? res.data?.text || '' : ''
}

/** AI 帮写：图 → 文 */
export async function optimizeImage(uuid: string, field: string, images: string[]): Promise<string> {
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
  const list = (result.images || [])
    .map((item) => item.url || item.file_url)
    .filter((url): url is string => Boolean(url))
  if (list.length) return list
  const single = result.url || result.file_url
  return single ? [single] : []
}
