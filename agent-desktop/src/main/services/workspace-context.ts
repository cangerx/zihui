import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getDataDir } from './data-path'
import { getWorkspace, getActiveWorkspace } from './agent-workspace'
import { getBot } from './bot'
import { getDatabase } from '../database'
import { getSetting } from './settings'
import type { ResolvedWorkspaceContext } from '../../shared/digital-employee'

function fromWorkspace(
  id: string,
  source: ResolvedWorkspaceContext['source']
): ResolvedWorkspaceContext | null {
  if (!id) return null
  const ws = getWorkspace(id)
  if (!ws) return null
  const available = existsSync(ws.root_path)
  return {
    workspaceId: ws.id,
    rootPath: ws.root_path,
    workspaceName: ws.name,
    source,
    available,
    reason: available ? '' : '工作区目录不存在或当前不可访问'
  }
}

/**
 * 解析一次任务的稳定工作区。已持久化但失效的工作区必须显式报错，
 * 不能静默跳到另一个真实项目目录。
 */
export function resolveWorkspaceContext(input: {
  conversationId: string
  botId?: string
  explicitWorkspaceId?: string
  persist?: boolean
}): ResolvedWorkspaceContext {
  if (getSetting('digital_employee_workspace_context') === '0') {
    try {
      const active = getActiveWorkspace()
      const resolved = fromWorkspace(active.id, 'active')
      if (resolved) return resolved
    } catch { /* 回退会话沙箱 */ }
  }
  const conv = input.conversationId
    ? getDatabase().prepare('SELECT bot_id, workspace_id FROM conversations WHERE id=?').get(input.conversationId) as
      | { bot_id: string; workspace_id: string }
      | undefined
    : undefined
  const bot = getBot(input.botId || conv?.bot_id || '')
  const candidates: Array<[string, ResolvedWorkspaceContext['source'], boolean]> = [
    [input.explicitWorkspaceId || '', 'explicit', true],
    [conv?.workspace_id || '', 'conversation', true],
    [bot?.default_workspace_id || '', 'employee_default', false]
  ]

  for (const [id, source, failClosed] of candidates) {
    if (!id) continue
    const resolved = fromWorkspace(id, source)
    if (resolved) return resolved
    if (failClosed) {
      return {
        workspaceId: id,
        rootPath: '',
        workspaceName: '原工作区',
        source,
        available: false,
        reason: '原工作区已被移除，请重新选择工作区'
      }
    }
  }

  try {
    const active = getActiveWorkspace()
    const resolved = fromWorkspace(active.id, 'active')
    if (resolved) return resolved
  } catch { /* 回退会话沙箱 */ }

  const root = join(getDataDir(), 'workspaces', input.conversationId)
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return {
    workspaceId: '',
    rootPath: root,
    workspaceName: '会话工作区',
    source: 'sandbox',
    available: true,
    reason: ''
  }
}
