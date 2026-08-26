import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface CanvasProject {
  id: string
  title: string
  text_provider_id: string
  text_model_id: string
  image_provider_id: string
  image_model_id: string
  /** v0.6.9+ 「图片反推」节点默认视觉模型（节点可覆盖，可为空字符串） */
  vision_provider_id: string
  vision_model_id: string
  concurrency: number
  system_prompt: string
  /** 布局方向：'LR' 左到右（默认）/ 'TB' 上到下 */
  layout_direction: string
  created_at: string
  updated_at: string
}

export interface CanvasNode {
  id: string
  project_id: string
  type: string
  position_x: number
  position_y: number
  width: number
  height: number
  data: Record<string, any>
  created_at: string
}

export interface CanvasEdge {
  id: string
  project_id: string
  source_node_id: string
  source_handle: string
  target_node_id: string
  target_handle: string
  created_at: string
}

const api = () => (window as any).api

export const useCanvasStore = defineStore('canvas', () => {
  const projects = ref<CanvasProject[]>([])
  const currentProject = ref<CanvasProject | null>(null)
  const nodes = ref<CanvasNode[]>([])
  const edges = ref<CanvasEdge[]>([])

  async function fetchProjects() {
    projects.value = await api().canvas.invoke('listProjects')
  }

  async function createProject(data: {
    title: string
    text_provider_id?: string
    text_model_id?: string
    image_provider_id?: string
    image_model_id?: string
    vision_provider_id?: string
    vision_model_id?: string
    concurrency?: number
    system_prompt?: string
    layout_direction?: string
  }): Promise<CanvasProject> {
    const project = await api().canvas.invoke('createProject', JSON.parse(JSON.stringify(data)))
    projects.value.unshift(project)
    return project
  }

  async function updateProject(id: string, data: {
    title?: string
    text_provider_id?: string
    text_model_id?: string
    image_provider_id?: string
    image_model_id?: string
    vision_provider_id?: string
    vision_model_id?: string
    concurrency?: number
    system_prompt?: string
    layout_direction?: string
  }): Promise<CanvasProject | null> {
    const updated = await api().canvas.invoke('updateProject', id, data)
    const idx = projects.value.findIndex((p) => p.id === id)
    if (idx >= 0 && updated) projects.value[idx] = updated
    if (currentProject.value?.id === id && updated) currentProject.value = updated
    return updated
  }

  /**
   * v0.6.9+ 打开画布的独立图片目录（dataDir/canvas/{projectId}/）。
   * 主进程的 canvas:openProjectImageDir 会保证目录存在再调 shell.openPath，
   * 返回 { success, dir, error? } 让 UI 显示具体反馈。
   */
  async function openProjectImageDir(id: string): Promise<{ success: boolean; dir?: string; error?: string }> {
    return await api().canvas.invoke('openProjectImageDir', id)
  }

  /**
   * 按序导出画布图片到用户选定目录：出图节点（文生图 / 图生图 / 图片结果）按画布 #N
   * 序号复制为 {类型名}-{NN}.{ext}。主进程负责弹目录对话框并执行复制。
   * 返回 { success, canceled?, exported?, total?, dir?, error? }。
   */
  async function exportProjectImages(id: string): Promise<{
    success: boolean
    canceled?: boolean
    exported?: number
    total?: number
    dir?: string
    error?: string
  }> {
    return await api().canvas.invoke('exportImages', id)
  }

  async function deleteProject(id: string) {
    await api().canvas.invoke('deleteProject', id)
    projects.value = projects.value.filter((p) => p.id !== id)
    if (currentProject.value?.id === id) {
      currentProject.value = null
      nodes.value = []
      edges.value = []
    }
  }

  async function loadProject(id: string) {
    const project = await api().canvas.invoke('getProject', id)
    if (!project) return
    currentProject.value = project
    const loadedNodes: CanvasNode[] = await api().canvas.invoke('listNodes', id)
    // Reset stale running/blocked states from a previous (possibly crashed) session.
    // Keep 'error' so the user can see the last failure reason after reopening the canvas.
    const staleIds: string[] = []
    for (const n of loadedNodes) {
      const st = n.data?.status
      if (st === 'running' || st === 'blocked') {
        n.data = { ...n.data, status: 'idle', error: '' }
        staleIds.push(n.id)
      }
    }
    nodes.value = loadedNodes
    edges.value = await api().canvas.invoke('listEdges', id)
    // Persist the resets in the background; UI already reflects the cleaned state
    if (staleIds.length > 0) {
      for (const nodeId of staleIds) {
        const n = loadedNodes.find((x) => x.id === nodeId)
        if (!n) continue
        api().canvas.invoke('updateNode', nodeId, { data: JSON.parse(JSON.stringify(n.data)) }).catch(() => {})
      }
    }
  }

  async function addNode(projectId: string, data: {
    type: string
    position_x: number
    position_y: number
    width?: number
    height?: number
    data?: Record<string, any>
  }): Promise<CanvasNode> {
    const node = await api().canvas.invoke('createNode', projectId, JSON.parse(JSON.stringify(data)))
    nodes.value.push(node)
    return node
  }

  async function updateNode(id: string, data: Partial<{
    position_x: number
    position_y: number
    width: number
    height: number
    data: Record<string, any>
  }>) {
    const updated = await api().canvas.invoke('updateNode', id, JSON.parse(JSON.stringify(data)))
    const idx = nodes.value.findIndex((n) => n.id === id)
    if (idx >= 0 && updated) nodes.value[idx] = updated
  }

  async function updateNodePositions(updates: { id: string; position_x: number; position_y: number }[]) {
    await api().canvas.invoke('updateNodePositions', JSON.parse(JSON.stringify(updates)))
    for (const u of updates) {
      const node = nodes.value.find((n) => n.id === u.id)
      if (node) {
        node.position_x = u.position_x
        node.position_y = u.position_y
      }
    }
  }

  async function removeNode(id: string) {
    await api().canvas.invoke('deleteNode', id)
    nodes.value = nodes.value.filter((n) => n.id !== id)
    edges.value = edges.value.filter((e) => e.source_node_id !== id && e.target_node_id !== id)
  }

  async function addEdge(projectId: string, data: {
    source_node_id: string
    source_handle: string
    target_node_id: string
    target_handle: string
  }): Promise<CanvasEdge> {
    const edge = await api().canvas.invoke('createEdge', projectId, JSON.parse(JSON.stringify(data)))
    edges.value.push(edge)
    return edge
  }

  async function removeEdge(id: string) {
    await api().canvas.invoke('deleteEdge', id)
    edges.value = edges.value.filter((e) => e.id !== id)
  }

  async function removeEdgesByHandle(nodeId: string, handleId: string) {
    const toRemove = edges.value.filter(
      (e) => (e.source_node_id === nodeId && e.source_handle === handleId)
    )
    for (const edge of toRemove) {
      await api().canvas.invoke('deleteEdge', edge.id)
    }
    edges.value = edges.value.filter(
      (e) => !(e.source_node_id === nodeId && e.source_handle === handleId)
    )
  }

  async function saveState() {
    if (!currentProject.value) return
    const nodeStates = nodes.value.map((n) => ({
      id: n.id,
      position_x: n.position_x,
      position_y: n.position_y,
      data: n.data
    }))
    await api().canvas.invoke('saveProjectState', currentProject.value.id, JSON.parse(JSON.stringify(nodeStates)))
  }

  async function duplicateProject(sourceId: string): Promise<CanvasProject> {
    const source = projects.value.find((p) => p.id === sourceId)
      || await api().canvas.invoke('getProject', sourceId)
    if (!source) throw new Error('Project not found')

    // Create new project with same settings
    const newProject = await createProject({
      title: source.title + '-副本',
      text_provider_id: source.text_provider_id,
      text_model_id: source.text_model_id,
      image_provider_id: source.image_provider_id,
      image_model_id: source.image_model_id,
      vision_provider_id: source.vision_provider_id,
      vision_model_id: source.vision_model_id,
      concurrency: source.concurrency,
      system_prompt: source.system_prompt,
      layout_direction: source.layout_direction
    })

    // Load source nodes and edges
    const srcNodes: CanvasNode[] = await api().canvas.invoke('listNodes', sourceId)
    const srcEdges: CanvasEdge[] = await api().canvas.invoke('listEdges', sourceId)

    // v0.7.14+ 角色库随项目一起克隆：先把源项目角色行 + 定妆图复制到新项目，拿到
    // 旧→新角色 id / 新定妆图路径映射，供下方 cleanNodeData 把 characterRef 节点的
    // character_id / image_path 重写到新项目（否则引用会悬空到源项目，复制后失效）。
    const clonedChars: Array<{ old_id: string; new_id: string; ref_image_path: string }> =
      (await api().canvas.invoke('cloneCharacters', sourceId, newProject.id)) || []
    const charIdMap = new Map(clonedChars.map((c) => [c.old_id, c.new_id]))
    const charImgMap = new Map(clonedChars.map((c) => [c.old_id, c.ref_image_path]))

    // Clean node data: keep user inputs, strip results and statuses
    function cleanNodeData(type: string, data: Record<string, any>): Record<string, any> {
      switch (type) {
        case 'textInput':
          return { text: data.text || '' }
        case 'refImage':
          // Intentionally start empty; the migration step below will populate image_path
          // after copying the underlying file into the new project directory.
          // If copy fails we leave the node empty rather than keeping a dangling path
          // that points into the old (possibly deleted) project dir.
          return { image_data: '', image_path: '' }
        case 'aiText':
          return { text: data.text || '', result: '', status: 'idle' }
        case 'agentNode':
          // 复制画布作为模板：保留人设 / 知识库选择（对话模型走画布设置），清空运行态
          return {
            system_prompt: data.system_prompt,
            kb_category_ids: Array.isArray(data.kb_category_ids) ? data.kb_category_ids : [],
            result: '',
            status: 'idle',
            error: ''
          }
        case 'quickOrchestrator':
          return {
            mode: data.mode || 'product_workflow',
            instruction: data.instruction || '',
            count: data.count || 4,
            main_count: data.main_count || 4,
            detail_count: data.detail_count ?? 3,
            size: data.size || '1:1',
            main_size: data.main_size || '1:1',
            detail_size: data.detail_size || '4:5',
            tier_id: data.tier_id || '2k',
            quality: data.quality || 'auto',
            require_reference: Boolean(data.require_reference),
            detail_consistency_enabled: Boolean(data.detail_consistency_enabled),
            outputContent: '',
            plan_json: null,
            created_node_ids: [],
            created_edge_ids: [],
            status: 'idle',
            error: ''
          }
        case 'text2img':
          return { model_provider_id: data.model_provider_id || '', model_id: data.model_id || '', size: data.size || '1:1', quality: data.quality || 'auto', status: 'idle', generation_id: '', result_path: '' }
        case 'img2img':
          return { model_provider_id: data.model_provider_id || '', model_id: data.model_id || '', size: data.size || '1:1', quality: data.quality || 'auto', prompt: data.prompt || '', status: 'idle', generation_id: '', result_path: '' }
        case 'imageResult':
          return { generation_id: '', result_path: '', result_url: '' }
        case 'promptSlice':
          return { rows: (data.rows || []).map((r: any) => ({ id: r.id, text: r.text || '' })) }
        case 'reverse':
          // 复制画布作为模板：保留用户配置（视觉模型 / 风格 / 语言 / 自定义提示词），
          // 清空运行态（result / status / error），让新画布从 idle 开始
          return {
            vision_provider_id: data.vision_provider_id || '',
            vision_model_id: data.vision_model_id || '',
            style_preset: data.style_preset || 'general',
            output_lang: data.output_lang || 'cn',
            custom_prompt: data.custom_prompt || '',
            result: '',
            status: 'idle',
            error: ''
          }
        case 'imageRecognition':
          return {
            vision_provider_id: data.vision_provider_id || '',
            vision_model_id: data.vision_model_id || '',
            result: '',
            status: 'idle',
            error: ''
          }
        case 'aiVideo':
          // 复制画布作为模板：保留规格选择，清空运行态与产物
          return {
            model_id: data.model_id || '',
            mode: data.mode || '',
            duration_seconds: data.duration_seconds || 0,
            resolution: data.resolution || '',
            aspect_ratio: data.aspect_ratio || '',
            prompt: data.prompt || '',
            sku_key: data.sku_key || '',
            status: 'idle',
            progress: 0,
            error: '',
            cloud_task_id: '',
            video_url: '',
            cover_url: '',
            result_path: ''
          }
        case 'videoResult':
          return {}
        case 'videoInput':
          return { video_path: '' }
        case 'videoFrames':
          return { mode: data.mode || 'uniform', count: data.count || 4, intervalSec: data.intervalSec || 2, frames: [], status: 'idle', error: '' }
        case 'videoReverse':
          return { mode: data.mode || 'prompt', output_lang: data.output_lang || 'cn', frameLimit: data.frameLimit || 8, vision_provider_id: data.vision_provider_id || '', vision_model_id: data.vision_model_id || '', result: '', status: 'idle', error: '' }
        case 'storyboard':
          return { mode: data.mode || 'novel', text: data.text || '', shots: [], status: 'idle', error: '' }
        case 'createCharacter':
          return { name: data.name || '', description: data.description || '', result_path: '', character_id: '', status: 'idle', error: '' }
        case 'characterRef': {
          // 角色库已克隆到新项目：按旧→新 id 映射重写 character_id / image_path，
          // 引用不再悬空；角色已删或未选（映射缺失）则回落为空白节点。
          const oldCharId = data.character_id || ''
          const newCharId = charIdMap.get(oldCharId) || ''
          return {
            character_id: newCharId,
            character_name: newCharId ? (data.character_name || '') : '',
            image_path: charImgMap.get(oldCharId) || ''
          }
        }
        default:
          return { ...data, status: undefined, error: undefined }
      }
    }

    // Copy nodes, build old→new ID map
    const idMap = new Map<string, string>()
    for (const n of srcNodes) {
      const created = await api().canvas.invoke('createNode', newProject.id, JSON.parse(JSON.stringify({
        type: n.type,
        position_x: n.position_x,
        position_y: n.position_y,
        width: n.width,
        height: n.height,
        data: cleanNodeData(n.type, n.data)
      })))
      idMap.set(n.id, created.id)

      // For refImage nodes, also copy the underlying image file into the new project's dir.
      // Otherwise the new project would reference files under the old project dir and break
      // when the source project is deleted. Also opportunistically migrate legacy
      // base64 image_data into on-disk storage.
      if (n.type === 'refImage') {
        const oldData = n.data || {}
        let dataUri = ''
        if (oldData.image_data) {
          dataUri = oldData.image_data
        } else if (oldData.image_path) {
          try {
            const dataDir = await api().dataDir.get()
            const fullPath = `${dataDir}/${oldData.image_path}`
            const b64 = await api().chat.invoke('readFileBase64', fullPath)
            const ext = String(oldData.image_path).split('.').pop()?.toLowerCase() || 'png'
            const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
              : ext === 'webp' ? 'image/webp'
              : ext === 'gif' ? 'image/gif'
              : 'image/png'
            dataUri = `data:${mime};base64,${b64}`
          } catch {
            dataUri = ''
          }
        }
        if (dataUri) {
          try {
            const saved = await api().canvas.invoke('saveNodeImage', newProject.id, created.id, dataUri)
            await api().canvas.invoke('updateNode', created.id, {
              data: { image_data: '', image_path: saved.image_path }
            })
          } catch {
            // Fall back silently — the duplicated node will just be empty
          }
        }
      }
    }

    // Copy edges with remapped node IDs
    for (const e of srcEdges) {
      const newSource = idMap.get(e.source_node_id)
      const newTarget = idMap.get(e.target_node_id)
      if (newSource && newTarget) {
        await api().canvas.invoke('createEdge', newProject.id, JSON.parse(JSON.stringify({
          source_node_id: newSource,
          source_handle: e.source_handle,
          target_node_id: newTarget,
          target_handle: e.target_handle
        })))
      }
    }

    return newProject
  }

  function reset() {
    currentProject.value = null
    nodes.value = []
    edges.value = []
  }

  return {
    projects,
    currentProject,
    nodes,
    edges,
    fetchProjects,
    createProject,
    updateProject,
    deleteProject,
    duplicateProject,
    loadProject,
    openProjectImageDir,
    exportProjectImages,
    addNode,
    updateNode,
    updateNodePositions,
    removeNode,
    addEdge,
    removeEdge,
    removeEdgesByHandle,
    saveState,
    reset
  }
})
