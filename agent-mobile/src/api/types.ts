/**
 * 接口出入参类型
 * 字段命名与 docs/API开发文档.md 保持一致（后端下划线风格）
 */

/** 统一响应结构，见 API 文档 §2.6 */
export interface ApiResponse<T = unknown> {
  code: number
  data: T
  message?: string
  type?: string
  desc?: string
  val?: string | number
}

/* ========== 认证 ========== */

export interface LoginAccount {
  nickname?: string
  real_name?: string
  username?: string
  email?: string
  avatar?: string
  uuid?: string
  phone?: string | number
  [key: string]: unknown
}

export interface LoginResult {
  token: string
  account: LoginAccount
}

export interface ImageCaptchaResult {
  aes: string
  image: string
}

/* ========== AI 应用 ========== */

export interface AppListItem {
  uuid: string
  name: string
  poster: string
  icon: string
  description: string
}

export interface AppCategory {
  name: string
  apps: AppListItem[]
}

/** GetApp 返回的表单字段（后端原始结构） */
export interface AppInputFormField {
  name: string
  label: string
  type: string
  required?: boolean | number
  attach?: {
    options?: Array<{ label: string; value: string; preview?: string }>
    rows?: number
    min?: number
    max?: number
    maxlength?: number
    placeholder?: string
    optimize?: number
  }
  default?: unknown
}

export interface AppDetailRaw {
  uuid: string
  name: string
  description: string
  /** 1 → 结果为图片，否则为文本 */
  type: number
  price: number
  input_image: number
  internal_prompt: Array<{ label: string; value: string; preview?: string }>
  workflow_uuid: string
  input_form: AppInputFormField[]
}

/** 前端渲染用的字段类型 */
export type AppFieldType =
  | 'textarea'
  | 'number'
  | 'select'
  | 'card-select'
  | 'card-multi-select'
  | 'image'

export interface AppSchemaField {
  id: string
  label: string
  type: AppFieldType
  scope: 'system' | 'form'
  required: boolean
  placeholder?: string
  options?: Array<{ label: string; value: string; preview?: string }>
  min?: number
  max?: number
  maxlength?: number
  rows?: number
  maxCount?: number
  /** 是否开启 AI 帮写 */
  optimize?: boolean
  default?: unknown
}

export interface AppDetail {
  app: {
    id: string
    name: string
    description: string
    price: number
    resultType: 'image' | 'message'
  }
  workflowVersionId: string
  appSchema: {
    version: 1
    fields: AppSchemaField[]
  }
}

/* ========== 工作流任务 ========== */

export interface WorkflowRunRequest {
  uuid: string
  form: Record<string, unknown>
  system: Record<string, unknown>
}

export interface WorkflowRunResult {
  task_uuid: string
  task_id: string
  queue_key: string
  task_type: string
  status: string
}

export interface WorkflowQueryResult {
  task_uuid: string
  task_id: string
  task_type: string
  queue_key: string
  status: string
  result: {
    images?: Array<{
      url?: string
      file_url?: string
      file_uuid?: string
      mime_type?: string
      mime?: string
      size?: number
    }>
    url?: string
    file_url?: string
  }
  error?: Record<string, unknown>
  error_message?: string
}

/* ========== 文件上传 ========== */

export interface PrepareUploadRequest {
  provider_key: string
  scene: 'image' | 'video' | 'file'
  parent_uuid: string
  parent_path: string
  original_name: string
  extension: string
  mime_type: string
  size: number
  md5: string
}

export interface PrepareUploadResult {
  mode?: 'instant' | string
  file?: unknown
  upload_type?: 'put-presigned' | 'post-policy' | 'kit-direct' | string
  upload_url?: string
  upload_ticket?: string
  method?: string
  headers?: Record<string, string>
  fields?: Record<string, string | number>
}

export interface UploadedFile {
  uuid: string
  url: string
  size: number
  filename: string
  name: string
  mime: string
}
