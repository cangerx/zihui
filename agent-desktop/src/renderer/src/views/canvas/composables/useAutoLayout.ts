import dagre from '@dagrejs/dagre'
import { useCanvasStore } from '@/stores/canvas'

/**
 * 用 dagre 对当前画布做拓扑分层布局：
 *  - 默认 rankdir=LR（左→右），符合流式画布的"输入→生成→结果"心智
 *  - nodesep 同层节点垂直间距、ranksep 层间水平间距
 *  - 节点尺寸优先用运行时 dimensions（VueFlow 测出的真实 DOM 尺寸），
 *    fallback 到 DB 的 width/height，再 fallback 到经验值 240×140
 *  - 多个不连通子图（components）会被 dagre 自然摆放在一起；孤儿节点也会进入 ranks
 *
 * 返回：
 *  - newPositions：每个 node 的新坐标，调用方 await canvasStore.updateNodePositions(...) 落库
 *  - snapshot：整理前的旧坐标快照，用于"撤销整理"
 */
export interface LayoutSnapshot {
  positions: Array<{ id: string; position_x: number; position_y: number }>
}

export interface AutoLayoutOptions {
  /** 'LR' 左到右（默认）/ 'TB' 上到下 */
  rankdir?: 'LR' | 'TB' | 'RL' | 'BT'
  /** 同层节点间距 */
  nodesep?: number
  /** 层间间距 */
  ranksep?: number
  /** 运行时 VueFlow 节点 dimensions 提供器，用于读真实 DOM 尺寸 */
  getNodeDimensions?: (nodeId: string) => { width?: number; height?: number } | undefined
}

const DEFAULT_NODE_W = 240
const DEFAULT_NODE_H = 140

export function useAutoLayout() {
  const canvasStore = useCanvasStore()

  function computeLayout(projectId: string, opts: AutoLayoutOptions = {}): {
    newPositions: Array<{ id: string; position_x: number; position_y: number }>
    snapshot: LayoutSnapshot
  } {
    const rankdir = opts.rankdir || 'LR'
    const nodesep = opts.nodesep ?? 60
    const ranksep = opts.ranksep ?? 120

    const projectNodes = canvasStore.nodes.filter((n) => n.project_id === projectId)
    const projectEdges = canvasStore.edges.filter((e) => e.project_id === projectId)

    if (projectNodes.length === 0) {
      return { newPositions: [], snapshot: { positions: [] } }
    }

    // 整理前快照（用于撤销）
    const snapshot: LayoutSnapshot = {
      positions: projectNodes.map((n) => ({
        id: n.id,
        position_x: n.position_x,
        position_y: n.position_y
      }))
    }

    const g = new dagre.graphlib.Graph()
    g.setGraph({ rankdir, nodesep, ranksep, marginx: 40, marginy: 40 })
    g.setDefaultEdgeLabel(() => ({}))

    for (const n of projectNodes) {
      const dim = opts.getNodeDimensions?.(n.id)
      const w = dim?.width || n.width || DEFAULT_NODE_W
      const h = dim?.height || n.height || DEFAULT_NODE_H
      g.setNode(n.id, { width: w, height: h })
    }

    for (const e of projectEdges) {
      g.setEdge(e.source_node_id, e.target_node_id)
    }

    dagre.layout(g)

    // dagre 返回的是节点 **中心** 坐标（{x, y, width, height}），VueFlow 用的是 **左上角**
    const newPositions = projectNodes.map((n) => {
      const laid = g.node(n.id)
      if (!laid) {
        // 极端情况：节点未被布局（理论不会，因为我们 setNode 了所有节点）
        return { id: n.id, position_x: n.position_x, position_y: n.position_y }
      }
      return {
        id: n.id,
        position_x: Math.round(laid.x - laid.width / 2),
        position_y: Math.round(laid.y - laid.height / 2)
      }
    })

    return { newPositions, snapshot }
  }

  /** 应用快照（用于撤销整理） */
  async function applySnapshot(snapshot: LayoutSnapshot): Promise<void> {
    if (snapshot.positions.length === 0) return
    await canvasStore.updateNodePositions(snapshot.positions)
  }

  return { computeLayout, applySnapshot }
}
