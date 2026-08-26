/**
 * 流式画布导入导出 schema (v1)
 *
 * 文件扩展名: .lacanvas.json
 * 编码:        UTF-8 JSON
 * 设计目标:
 *   - 跨设备分享工作流模板
 *   - 仅 prompt + 节点结构，不含图片字节（result_path / image_path 全剥离）
 *   - provider/model 按显示名匹配本机表，避免本地 UUID 跨设备失效
 *   - edge 用节点数组下标引用，避免反序列化时构建 ID 映射表
 */

export const CANVAS_EXPORT_SCHEMA_VERSION = 1
export const CANVAS_EXPORT_FILE_EXTENSION = 'lacanvas.json'

/**
 * node.data 里的运行态 / 磁盘路径字段。导出时全部剥离，导入时按节点类型重置为 idle 初值。
 *
 * 黑名单方式：明确列出运行态字段，其他字段（用户配置 prompt/size/quality/rows 等）
 * 一律保留，避免新增配置字段时漏带。
 */
export const RUNTIME_DATA_FIELDS = new Set<string>([
  // 磁盘路径 / base64
  'image_path', 'image_data', 'result_path', 'result_url',
  // AI 输出
  'result', 'outputContent', 'plan_json',
  // 运行态
  'status', 'error', 'ref_image_count', 'locked', 'generation_id', 'created_node_ids', 'created_edge_ids',
  // 上下文标识（导入时由 main 重新生成）
  'nodeId', 'projectId',
])

export interface ExportedNode {
  type: string
  position_x: number
  position_y: number
  width: number
  height: number
  data: Record<string, any>
}

export interface ExportedEdge {
  source_node_index: number
  target_node_index: number
  source_handle: string
  target_handle: string
}

export interface ExportedProject {
  title: string
  system_prompt: string
  concurrency: number

  /** Provider/model 按显示名导出，本地 UUID 不跨设备 */
  text_provider_name: string
  text_model_name: string
  image_provider_name: string
  image_model_name: string

  nodes: ExportedNode[]
  edges: ExportedEdge[]
}

export interface CanvasExportFile {
  schemaVersion: number
  exportedAt: string
  exportedFrom: string
  projects: ExportedProject[]
}

/**
 * 剥离 node.data 中的运行态字段。导出时调用。
 */
export function stripRuntimeFields(data: Record<string, any>): Record<string, any> {
  const cleaned: Record<string, any> = {}
  for (const [key, value] of Object.entries(data || {})) {
    if (RUNTIME_DATA_FIELDS.has(key)) continue
    if (value === undefined) continue
    cleaned[key] = value
  }
  return cleaned
}

/**
 * 导入时给 node.data 补回运行态字段的初值，
 * 让前端 v-if="data.status === 'running'" 等条件渲染正常工作。
 *
 * 不需要补的字段（image_path/result_path/result 等）保持 undefined 即可，
 * 渲染层都做了 v-if 兜底。
 */
export function freshRuntimeFields(
  type: string,
  data: Record<string, any>
): Record<string, any> {
  const base: Record<string, any> = { ...data }
  switch (type) {
    case 'aiText':
      base.result = ''
      base.status = 'idle'
      break
    case 'quickOrchestrator':
      base.outputContent = ''
      base.plan_json = null
      base.created_node_ids = []
      base.created_edge_ids = []
      base.status = 'idle'
      base.error = ''
      break
    case 'text2img':
    case 'img2img':
      base.status = 'idle'
      base.generation_id = ''
      base.result_path = ''
      break
    case 'imageResult':
      base.generation_id = ''
      base.result_path = ''
      base.result_url = ''
      break
    case 'refImage':
      base.image_data = ''
      base.image_path = ''
      break
    case 'reverse':
      // 反推产物是运行态，导入时重置；用户配置（vision_*、style_preset、output_lang、custom_prompt）
      // 不在 RUNTIME_DATA_FIELDS 黑名单里，会通过 stripRuntimeFields 自动保留
      base.result = ''
      base.status = 'idle'
      base.error = ''
      break
    case 'imageRecognition':
      base.result = ''
      base.status = 'idle'
      base.error = ''
      break
  }
  return base
}

/**
 * 导入文件粗校验。返回 null 表示通过，返回字符串表示错误原因。
 */
export function validateExportFile(file: any): string | null {
  if (!file || typeof file !== 'object') return '文件格式错误'
  if (file.schemaVersion !== CANVAS_EXPORT_SCHEMA_VERSION) {
    return `不支持的版本: ${file.schemaVersion} (当前支持 v${CANVAS_EXPORT_SCHEMA_VERSION})`
  }
  if (!Array.isArray(file.projects)) return '缺少 projects 数组'
  for (const p of file.projects) {
    if (typeof p?.title !== 'string') return '项目缺少 title 字段'
    if (!Array.isArray(p?.nodes)) return '项目缺少 nodes 数组'
    if (!Array.isArray(p?.edges)) return '项目缺少 edges 数组'
  }
  return null
}
