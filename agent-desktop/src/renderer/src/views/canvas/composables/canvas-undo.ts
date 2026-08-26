// 画布智能体撤销事务管理器
// -----------------------------------------------------------------------------
// 为画布智能体的每一次改动记录「逆操作事务」，支持跨轮一键撤销（撤销栈由 useCanvasAgent
// 持有、跨 send 复用，因此面板的「撤销上次 AI 变更」按钮能撤前一轮的改动）。
// 覆盖的改动类型与其逆操作：
//   新建节点/连线   → 删除
//   修改节点 data   → 还原为改动前的 data 快照
//   删除连线        → 重建连线
//   删除节点        → 重建节点（新 id）+ 按新 id 重连它原有的关联连线
// 说明：删除节点会级联清掉磁盘上的生成图，故撤销重建时剥离运行态产物字段（result_path 等），
// 还原为一个干净可重跑的配置节点，而非指向已删文件的悬空引用。

import type { useCanvasStore } from '@/stores/canvas'

type CanvasStore = ReturnType<typeof useCanvasStore>

export interface EdgeSnapshot {
  source_node_id: string
  source_handle: string
  target_node_id: string
  target_handle: string
}

export interface NodeSnapshot {
  type: string
  position_x: number
  position_y: number
  width: number
  height: number
  data: Record<string, any>
}

export type InverseOp =
  | { kind: 'removeNode'; nodeId: string }
  | { kind: 'removeEdge'; edgeId: string }
  | { kind: 'restoreNodeData'; nodeId: string; data: Record<string, any> }
  | { kind: 'recreateEdge'; edge: EdgeSnapshot }
  | { kind: 'recreateNode'; oldId: string; snapshot: NodeSnapshot; edges: EdgeSnapshot[] }

export interface UndoTransaction {
  /** 人类可读标签，如「新建 3 个节点」「删除节点 商品主图」 */
  label: string
  ops: InverseOp[]
}

export interface UndoManager {
  record: (tx: UndoTransaction) => void
  undoLast: () => Promise<UndoTransaction | null>
  canUndo: () => boolean
  size: () => number
  clear: () => void
  /** 最近一次事务的标签（供 UI 显示「撤销：xxx」） */
  lastLabel: () => string | null
}

// 撤销重建节点时要剥离的运行态/产物字段（文件已随删除被清掉，重建应回到干净态）
const RUNTIME_RESET: Record<string, any> = {
  status: 'idle',
  result: '',
  error: '',
  progress: 0,
  result_path: '',
  result_url: '',
  generation_id: '',
  video_url: '',
  cover_url: '',
  matting_task_id: '',
  cloud_task_id: ''
}

/** 仅重置 data 中已存在的运行态字段，保留全部用户配置 */
function stripRuntime(data: Record<string, any>): Record<string, any> {
  const out = { ...data }
  for (const k of Object.keys(RUNTIME_RESET)) {
    if (k in out) out[k] = RUNTIME_RESET[k]
  }
  return out
}

export function createUndoManager(store: CanvasStore, projectId: () => string): UndoManager {
  const stack: UndoTransaction[] = []
  const nodeExists = (id: string) => store.nodes.some((n) => n.id === id)
  // 会话级 旧id→新id 映射：被删节点重建后拿到新 id，后续（或同批）连线的另一端若也
  // 是被删过的节点，按此表解析成新 id，修「连删两个相连节点再依次撤销丢边」的问题。
  const idRemap = new Map<string, string>()
  const remap = (id: string) => idRemap.get(id) || id

  async function undoLast(): Promise<UndoTransaction | null> {
    const tx = stack.pop()
    if (!tx) return null
    for (const op of tx.ops) {
      try {
        switch (op.kind) {
          case 'removeEdge':
            await store.removeEdge(op.edgeId)
            break
          case 'removeNode':
            await store.removeNode(op.nodeId)
            break
          case 'restoreNodeData':
            await store.updateNode(op.nodeId, { data: JSON.parse(JSON.stringify(op.data)) })
            break
          case 'recreateEdge': {
            const src = remap(op.edge.source_node_id)
            const tgt = remap(op.edge.target_node_id)
            // 仅当两端节点仍存在时重建，避免悬空连线
            if (nodeExists(src) && nodeExists(tgt)) {
              await store.addEdge(projectId(), { source_node_id: src, source_handle: op.edge.source_handle, target_node_id: tgt, target_handle: op.edge.target_handle })
            }
            break
          }
          case 'recreateNode': {
            const s = op.snapshot
            const restored = stripRuntime(JSON.parse(JSON.stringify(s.data)))
            // refImage 的磁盘图片已随删除被物理清除，image_path 会悬空 → 清空回落为空白待选节点；
            // 若原是 base64（image_data）自包含则保留，撤销后仍能显示。
            if (s.type === 'refImage') restored.image_path = ''
            const created = await store.addNode(projectId(), {
              type: s.type,
              position_x: s.position_x,
              position_y: s.position_y,
              width: s.width,
              height: s.height,
              data: restored
            })
            const newId = created.id
            idRemap.set(op.oldId, newId)
            // 两端都按 remap 解析（被删本节点→新 id；另一端若也是被删过的节点→其新 id）
            for (const e of op.edges) {
              const src = remap(e.source_node_id)
              const tgt = remap(e.target_node_id)
              if (nodeExists(src) && nodeExists(tgt)) {
                await store.addEdge(projectId(), {
                  source_node_id: src,
                  source_handle: e.source_handle,
                  target_node_id: tgt,
                  target_handle: e.target_handle
                })
              }
            }
            break
          }
        }
      } catch {
        // 单个逆操作失败不应中断整笔撤销
      }
    }
    return tx
  }

  return {
    record: (tx) => { stack.push(tx) },
    undoLast,
    canUndo: () => stack.length > 0,
    size: () => stack.length,
    clear: () => { stack.length = 0; idRemap.clear() },
    lastLabel: () => (stack.length ? stack[stack.length - 1].label : null)
  }
}
