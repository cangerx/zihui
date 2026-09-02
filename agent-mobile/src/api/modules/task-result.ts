import type { WorkflowQueryResult } from '../types'

/** 从任务结果中解析图片 URL，优先级见 docs/API开发文档.md §3.2.4。 */
export function extractResultImages(result?: WorkflowQueryResult['result']): string[] {
  if (!result) return []
  const list = [...(result.images || []), ...(result.data || [])]
    .map((item) => item.url || item.file_url)
    .filter((url): url is string => Boolean(url))
  if (list.length) return list
  const single = result.url || result.file_url
  return single ? [single] : []
}
