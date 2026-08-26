import { useCanvasStore } from '@/stores/canvas'
import { IMAGE_SIZE_PRESETS, isValidSizeValue } from '@shared/image-size'
import { extractJson } from '@shared/json-extract'

// ===== Public contract =====

/** Canonical aspect-ratio preset list, re-exported from shared module.
 * Mirrors BatchGenView / ImageGenView so user mental model stays consistent
 * across the app. Custom ratios and pixel dimensions are also accepted
 * downstream via isValidSizeValue(). */
export const ORCHESTRATE_SIZE_OPTIONS: { label: string; value: string }[] =
  IMAGE_SIZE_PRESETS.map((p) => ({ label: p.label, value: p.value }))

export const ORCHESTRATE_QUALITY_OPTIONS: { label: string; value: string }[] = [
  { label: '自动', value: 'auto' },
  { label: '标准', value: 'standard' },
  { label: '高清', value: 'hd' }
]
const QUALITY_VALUE_SET = new Set(ORCHESTRATE_QUALITY_OPTIONS.map((o) => o.value))

/** Reference strategy per group:
 *  - `upload`  : create a single refImage node (user will drop an image later)
 *  - `textgen` : create textInput → text2img as the reference source
 *  - `none`    : no reference node, every business text2img is independent
 */
export type OrchestrateRefStrategy = 'upload' | 'textgen' | 'none'

export interface OrchestrateGroup {
  /** Human label, e.g. "轮播图" / "详情页" / "管理端" */
  name: string
  refStrategy: OrchestrateRefStrategy
  /** 1~20; LLM fills each business textInput with a prompt */
  businessCount: number
  /** Free-text details for this group, fed to the LLM */
  description: string
  /** Group-level default aspect ratio applied to all text2img nodes in this
   * group. Must be one of ORCHESTRATE_SIZE_OPTIONS. Per-node overrides below. */
  size: string
  /** Group-level default quality (auto/standard/hd). */
  quality: string
  /** Group-level default resolution tier id (1k/2k/4k). All text2img nodes in
   * this group inherit it; no per-node override. */
  tier?: string
  /** Optional user-authored reference prompt. When set and refStrategy is
   * 'textgen', fills the ref textInput as-is and skips the LLM for that node. */
  referenceText?: string
  /** Per-node override for the textgen reference image. Undefined inherits group. */
  referenceSize?: string
  referenceQuality?: string
  /** Optional user-authored business prompts. Index i maps to the i-th
   * business textInput; empty/missing slots fall back to LLM authoring. */
  businessTexts?: string[]
  /** Per-business-node size override. Array aligned to businessTexts indices;
   * slot = undefined / empty string means inherit group.size. */
  businessSizes?: (string | undefined)[]
  /** Per-business-node quality override. Same alignment rule as businessSizes. */
  businessQualities?: (string | undefined)[]
}

export interface OrchestrateConfig {
  /** Overall project description, fed to the LLM */
  projectDescription: string
  groups: OrchestrateGroup[]
}

export interface OrchestrateProgress {
  stage: 'planning' | 'llm' | 'writing' | 'done' | 'error'
  message: string
}

export interface OrchestrateResult {
  nodeIds: string[]
  edgeIds: string[]
}

// ===== Internal skeleton types =====

interface NodeSkel {
  tempId: string
  type: string
  position: { x: number; y: number }
  data: Record<string, any>
  /** When set, the LLM step fills `data[llmFill.key]` with its generated prompt */
  llmFill?: { key: string; role: string; context: string }
}

interface EdgeSkel {
  sourceTempId: string
  sourceHandle: string
  targetTempId: string
  targetHandle: string
}

const api = () => (window as any).api

// ===== Layout constants =====
// Grid is columns × rows per group, groups stack vertically.
const X_TEXT_IN = 0        // textInput column (reference + business)
const X_REF_IMG = 420      // refImage (upload) / text2img(ref) (textgen) / text2img(biz) (none)
const X_BIZ_IMG = 840      // text2img(biz) when a reference column is present
const ROW_H = 260          // vertical spacing between rows
const GROUP_GAP = 180      // vertical spacing between groups
const ANCHOR_X = 200       // start offset from canvas origin
const ANCHOR_Y = 120

export function useAiOrchestrator() {
  const canvasStore = useCanvasStore()

  /** Build the full node + edge graph purely from user config.
   * LLM is NOT involved here — structure is 100% deterministic, so node count
   * and wiring can never drift from what the user asked for.
   */
  function buildSkeleton(
    config: OrchestrateConfig,
    imageProviderId: string,
    imageModelId: string
  ): { nodes: NodeSkel[]; edges: EdgeSkel[] } {
    const nodes: NodeSkel[] = []
    const edges: EdgeSkel[] = []

    // Matches canvas.ts cleanNodeData() defaults so new nodes behave identically
    // to nodes created through the "添加节点" menu.
    const freshImgData = (size: string, quality: string, tier: string) => ({
      model_provider_id: imageProviderId,
      model_id: imageModelId,
      size,
      tier_id: tier,
      quality,
      status: 'idle',
      generation_id: '',
      result_path: ''
    })

    // Three-tier resolution: per-node override → group default → global fallback.
    // Empty string / undefined at any tier transparently falls through.
    // Accepts presets, custom ratios ("A:B"), and custom pixels ("WxH").
    const pickSize = (override: string | undefined, groupDefault: string): string => {
      const v = override?.trim()
      if (v && isValidSizeValue(v)) return v
      if (groupDefault && isValidSizeValue(groupDefault)) return groupDefault
      return '1:1'
    }
    const pickQuality = (override: string | undefined, groupDefault: string): string => {
      const v = override?.trim()
      if (v && QUALITY_VALUE_SET.has(v)) return v
      if (groupDefault && QUALITY_VALUE_SET.has(groupDefault)) return groupDefault
      return 'auto'
    }

    let cursorY = 0

    config.groups.forEach((group, gIdx) => {
      const baseY = cursorY
      const gKey = `g${gIdx}`
      // Reference-source temp id (whichever strategy produces an output handle)
      let refSourceTempId = ''
      let refSourceHandle = 'output'

      if (group.refStrategy === 'upload') {
        const id = `${gKey}_ref_img`
        refSourceTempId = id
        nodes.push({
          tempId: id,
          type: 'refImage',
          position: { x: X_REF_IMG, y: baseY },
          data: { image_data: '', image_path: '' }
        })
      } else if (group.refStrategy === 'textgen') {
        const txtId = `${gKey}_ref_text`
        const imgId = `${gKey}_ref_img`
        refSourceTempId = imgId
        const userRefText = group.referenceText?.trim() || ''
        const refNode: NodeSkel = {
          tempId: txtId,
          type: 'textInput',
          position: { x: X_TEXT_IN, y: baseY },
          data: { text: userRefText }
        }
        // Only ask the LLM to author this node when the user did not supply
        // reference text themselves. Preserves verbatim user content when present.
        if (!userRefText) {
          refNode.llmFill = {
            key: 'text',
            role: `组「${group.name || `分组 ${gIdx + 1}`}」参考页提示词（定调本组风格/配色/版式，不含具体业务内容）`,
            context: group.description?.trim() || ''
          }
        }
        nodes.push(refNode)
        nodes.push({
          tempId: imgId,
          type: 'text2img',
          position: { x: X_REF_IMG, y: baseY },
          data: freshImgData(
            pickSize(group.referenceSize, group.size),
            pickQuality(group.referenceQuality, group.quality),
            group.tier || '2k'
          )
        })
        edges.push({
          sourceTempId: txtId,
          sourceHandle: 'output',
          targetTempId: imgId,
          targetHandle: 'text-input'
        })
      }

      // Business rows: if there's a reference source, push them down one row
      // so the reference always sits at the top-left of its group visually.
      const bizRowOffset = group.refStrategy === 'none' ? 0 : 1
      // text2img(biz) column depends on whether a reference column is used
      const bizImgX = group.refStrategy === 'none' ? X_REF_IMG : X_BIZ_IMG

      for (let i = 0; i < group.businessCount; i++) {
        const bizY = baseY + (bizRowOffset + i) * ROW_H
        const txtId = `${gKey}_biz_text_${i}`
        const imgId = `${gKey}_biz_img_${i}`
        const userBizText = group.businessTexts?.[i]?.trim() || ''

        const bizNode: NodeSkel = {
          tempId: txtId,
          type: 'textInput',
          position: { x: X_TEXT_IN, y: bizY },
          data: { text: userBizText }
        }
        if (!userBizText) {
          bizNode.llmFill = {
            key: 'text',
            role: `组「${group.name || `分组 ${gIdx + 1}`}」业务图 ${i + 1}/${group.businessCount}`,
            context: group.description?.trim() || ''
          }
        }
        nodes.push(bizNode)
        nodes.push({
          tempId: imgId,
          type: 'text2img',
          position: { x: bizImgX, y: bizY },
          data: freshImgData(
            pickSize(group.businessSizes?.[i], group.size),
            pickQuality(group.businessQualities?.[i], group.quality),
            group.tier || '2k'
          )
        })

        // biz textInput → biz text2img (text-input)
        edges.push({
          sourceTempId: txtId,
          sourceHandle: 'output',
          targetTempId: imgId,
          targetHandle: 'text-input'
        })
        // reference → biz text2img (image-input)
        if (refSourceTempId) {
          edges.push({
            sourceTempId: refSourceTempId,
            sourceHandle: refSourceHandle,
            targetTempId: imgId,
            targetHandle: 'image-input'
          })
        }
      }

      const rows = Math.max(1, bizRowOffset + group.businessCount)
      cursorY = baseY + rows * ROW_H + GROUP_GAP
    })

    return { nodes, edges }
  }

  /** Build the LLM prompt, call it, and return a tempId → prompt-text map.
   * The LLM only authors the text content of each textInput. It does NOT
   * decide node count, type, or wiring.
   */
  async function callLLM(
    config: OrchestrateConfig,
    fillables: NodeSkel[],
    providerId: string,
    modelId: string,
    requestId?: string
  ): Promise<Record<string, string>> {
    const items = fillables
      .filter((n) => n.llmFill)
      .map((n) => ({
        id: n.tempId,
        role: n.llmFill!.role,
        detail: n.llmFill!.context
      }))

    const systemPrompt = [
      '你是一位资深的 AI 图像生成提示词工程师。',
      '任务：根据用户提供的项目整体描述和每个节点的角色说明，为每个节点撰写一条高质量的中文图像生成提示词。',
      '',
      '输出规则（严格遵守）：',
      '1. 只输出一个 JSON 对象，不要任何 Markdown 代码块、不要任何解释性文字。',
      '2. 结构固定为：{"items":[{"id":"xxx","prompt":"..."}, ...]}。',
      '3. 必须为每个输入的 id 都产出一条 prompt；id 一字不差地保留。',
      '4. 每条 prompt 80~200 字中文。',
      '',
      '内容规则：',
      '- 「参考页/参考图」类的 prompt 专注于定调：整体视觉风格、配色、版式、材质、氛围；不要描述具体的业务内容。',
      '- 「业务图」类的 prompt 围绕具体业务主题，每一条都要与同组其他业务图有明显差异化（不同场景/角度/细节）。',
      '- 同一组内业务图的语言风格、视觉语言应与该组的参考定调保持一致。',
      '- 跨组之间允许完全不同的风格（组之间互相独立）。'
    ].join('\n')

    const userPrompt = [
      '项目整体描述：',
      config.projectDescription?.trim() || '(未提供)',
      '',
      '请为以下每个节点生成 prompt：',
      JSON.stringify({ items }, null, 2),
      '',
      '只输出 {"items":[...]} 形式的 JSON，不要任何其他内容。'
    ].join('\n')

    const raw: string = await api().llm.invoke('call', providerId, modelId, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], {
      stream: false,
      notifyStream: false,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      requestId,
      timeoutMs: 120000
    })

    const parsed = extractJson<{ items: { id: string; prompt: string }[] }>(raw, { expect: 'object' })
    if (!parsed?.items || !Array.isArray(parsed.items)) {
      throw new Error('AI 返回格式错误：缺少 items 数组')
    }

    const out: Record<string, string> = {}
    for (const item of parsed.items) {
      if (item && typeof item.id === 'string' && typeof item.prompt === 'string') {
        out[item.id] = item.prompt.trim()
      }
    }
    return out
  }

  /** Main entry. Builds the skeleton, calls the LLM to fill text content,
   * writes nodes + edges to the store, and rolls back if edge writes fail.
   */
  async function orchestrate(
    projectId: string,
    config: OrchestrateConfig,
    onProgress?: (p: OrchestrateProgress) => void,
    requestId?: string
  ): Promise<OrchestrateResult> {
    const progress = (stage: OrchestrateProgress['stage'], message: string) => {
      onProgress?.({ stage, message })
    }

    const project = canvasStore.currentProject
    if (!project) throw new Error('未找到当前画布项目')
    if (!project.text_provider_id || !project.text_model_id) {
      throw new Error('请先在画布设置中配置文本服务商和模型')
    }
    if (!project.image_provider_id || !project.image_model_id) {
      throw new Error('请先在画布设置中配置生图服务商和模型')
    }
    if (!config.groups?.length) throw new Error('至少需要一个分组')
    for (const g of config.groups) {
      if (!Number.isFinite(g.businessCount) || g.businessCount < 1 || g.businessCount > 20) {
        throw new Error(`组「${g.name || '未命名'}」的业务图数必须在 1~20 之间`)
      }
    }

    progress('planning', '正在生成节点结构...')
    const { nodes: skelNodes, edges: skelEdges } = buildSkeleton(
      config,
      project.image_provider_id,
      project.image_model_id
    )

    const fillables = skelNodes.filter((n) => n.llmFill)
    if (fillables.length > 0) {
      progress('llm', `调用 AI 生成 ${fillables.length} 条提示词...`)
      const filled = await callLLM(
        config,
        fillables,
        project.text_provider_id,
        project.text_model_id,
        requestId
      )
      for (const n of skelNodes) {
        if (n.llmFill) {
          const v = filled[n.tempId]
          // Leave empty if LLM missed this id — node still created, user can fill it
          if (typeof v === 'string' && v) n.data[n.llmFill.key] = v
        }
      }
    }

    progress('writing', '正在写入画布...')
    const tempToReal = new Map<string, string>()
    const createdNodeIds: string[] = []
    const createdEdgeIds: string[] = []

    try {
      for (const n of skelNodes) {
        const created = await canvasStore.addNode(projectId, {
          type: n.type,
          position_x: ANCHOR_X + n.position.x,
          position_y: ANCHOR_Y + n.position.y,
          data: n.data
        })
        tempToReal.set(n.tempId, created.id)
        createdNodeIds.push(created.id)
      }
      for (const e of skelEdges) {
        const src = tempToReal.get(e.sourceTempId)
        const tgt = tempToReal.get(e.targetTempId)
        if (!src || !tgt) continue
        const created = await canvasStore.addEdge(projectId, {
          source_node_id: src,
          source_handle: e.sourceHandle,
          target_node_id: tgt,
          target_handle: e.targetHandle
        })
        createdEdgeIds.push(created.id)
      }
    } catch (err) {
      // Roll back any nodes we already created — partial graphs are worse
      // than no graph, since the user loses track of what's hand-made vs generated.
      for (const id of [...createdNodeIds].reverse()) {
        try { await canvasStore.removeNode(id) } catch { /* best effort */ }
      }
      progress('error', (err as Error)?.message || '写入画布失败')
      throw err
    }

    progress(
      'done',
      `编排完成：${createdNodeIds.length} 个节点 / ${createdEdgeIds.length} 条连线`
    )
    return { nodeIds: createdNodeIds, edgeIds: createdEdgeIds }
  }

  /** Ask the LLM to turn a free-form project description into a list of
   * groups suitable for the orchestrate form. This ONLY produces form data —
   * it does NOT write to the canvas. The dialog calls this when the user
   * clicks "AI 智能填充".
   *
   * Output is heavily clamped on our side (group count, businessCount range,
   * refStrategy whitelist) so a misbehaving LLM can't push absurd values
   * back into the form.
   */
  async function inferGroups(description: string, requestId?: string): Promise<OrchestrateGroup[]> {
    const project = canvasStore.currentProject
    if (!project) throw new Error('未找到当前画布项目')
    if (!project.text_provider_id || !project.text_model_id) {
      throw new Error('请先在画布设置中配置文本服务商和模型')
    }
    const desc = (description || '').trim()
    if (!desc) throw new Error('请先填写项目整体描述')

    const systemPrompt = [
      '你是一位 AI 工作流配置助手。',
      '任务：把用户的项目描述拆解为若干"分组"，并将用户原文中的每一段完整的图片提示词原文封装到对应的组里。',
      '',
      '输出严格 JSON，不要 Markdown 代码块、不要任何解释文字。结构固定为：',
      '{"groups":[{"name":"...","refStrategy":"upload|textgen|none","businessCount":N,"description":"...","referenceText":"...","businessTexts":["...","..."]}]}',
      '',
      '字段含义：',
      '- name：2~10 字中文，能概括本组用途（如"轮播图"、"详情页"、"管理端"、"移动端"、"风格 A"）',
      '- refStrategy（三选一）：',
      '    upload  → 用户后续会上传一张参考图（适合已有商品图/产品照/参考素材）',
      '    textgen → AI 先生成一张参考图作为风格基准（适合需先定调再批量生产，如详情页、UI 一致性）',
      '    none    → 每张图独立生成（适合完全独立的系列，如表情包、对比展示）',
      '- businessCount：本组要批量生成的图片数量，正整数 1~20',
      '- description：本组的主题、风格要求、差异化方向（不超 100 字）',
      '- referenceText（可选，**仅 textgen 有意义**）：如果用户原文中已经写了一段"参考页/设计规范/风格定调"性质的完整图片提示词，把这段原文一字不改填入 referenceText；没有则留空字符串',
      '- businessTexts（可选）：如果用户原文中已经写了具体业务页的完整提示词，按顺序一字不改放进该数组；长度应等于 businessCount；如果某些位置用户没写就放空字符串 ""，空位置将由后续 AI 自动撰写',
      '- size（必填）：本组生图默认比例，正确值只能为 1:1 / 2:1 / 3:1 / 3:2 / 4:3 / 5:4 / 16:9 / 21:9 / 1:2 / 1:3 / 2:3 / 3:4 / 4:5 / 9:16 / 9:21 其中之一',
      '- quality（必填）：本组生图默认质量，正确值只能为 auto / standard / hd 其中之一',
      '- businessSizes（可选）：数组，长度应等于 businessCount；某位置如果与组级 size 不同就写比例字符串，相同则写空字符串 ""；全部相同时整个字段可省略',
      '- businessQualities（可选）：同 businessSizes，取值在 auto/standard/hd',
      '- referenceSize / referenceQuality（可选，仅 textgen）：参考页比例与组级不同时单独指定',
      '',
      '识别规则（最关键）：',
      '- 用户描述往往包含多段完整的图片提示词，你的职责是**识别并切分**，不是重写或摘要',
      '- 若某一段明确定位为"设计规范页/组件定调页/风格参考页"（不包含真实业务功能），则归入 referenceText，且不计入 businessCount',
      '- 其余完整提示词属于具体业务页，按原顺序归入 businessTexts，businessCount = businessTexts.length',
      '- businessTexts 中每个元素是用户原文（可含标点、换行），不要省略、不要翻译、不要改写',
      '- 用户原文段落同属同一视觉批次（如同为"管理端"、"移动端"）时合并为同一组',
      '- 如果用户只给了模糊意图（没写具体提示词），referenceText 和 businessTexts 均留空，仅输出元数据',
      '',
      '比例识别规则：',
      '- 原文出现 "画布比例 X:Y" / "X:Y" 明示 → 直接用之',
      '- 原文出现"桌面端 / 后台 / 管理端 / Web / PC" → 16:9',
      '- 原文出现"移动端 / 手机 / App / H5 / 竿屏" → 9:16',
      '- 原文出现"方图 / 头像 / 头图" → 1:1',
      '- 原文出现"海报 / 长图 / 竖版" → 3:4 或 4:5',
      '- 原文出现"横版 / 宽屏 / 电影感" → 16:9 或 21:9',
      '- 同一组内所有段落比例一致时 → group.size 统一写入，businessSizes 字段可省略',
      '- 同组内出现差异比例时 → group.size 写多数比例，businessSizes 对应位置写差异比例（其余位置留空 ""）',
      '- 无明显比例线索 → group.size=1:1',
      '- 默认 group.quality=auto，除非原文明确要求 “高清精修/hd/海报级 ”再设 hd',
      '',
      '总数规则：',
      '- groups 总数 1~10',
      '- 用户模糊时给合理默认方案（不要报错）',
      '- 看不懂时输出一组 textgen / businessCount=3 的兜底组'
    ].join('\n')

    const userPrompt = [
      '项目描述：',
      desc,
      '',
      '请输出符合规范的 JSON。'
    ].join('\n')

    const raw: string = await api().llm.invoke('call', project.text_provider_id, project.text_model_id, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], {
      stream: false,
      notifyStream: false,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      requestId,
      timeoutMs: 120000
    })

    const parsed = extractJson<{ groups: any[] }>(raw, { expect: 'object' })
    if (!parsed?.groups || !Array.isArray(parsed.groups)) {
      throw new Error('AI 返回格式错误：缺少 groups 数组')
    }

    const result: OrchestrateGroup[] = []
    for (const g of parsed.groups) {
      const item = clampGroup(g)
      if (item) result.push(item)
      if (result.length >= 10) break
    }
    // Defensive fallback: if the LLM returned 0 valid items, give the user at
    // least one group so they don't see an empty form (which would also fail
    // canSubmit and feel broken).
    if (result.length === 0) {
      result.push({
        name: '',
        refStrategy: 'textgen',
        businessCount: 3,
        description: desc.slice(0, 200),
        size: '1:1',
        quality: 'auto',
        tier: '2k'
      })
    }
    return result
  }

  /** Clamp a single group dict from the LLM into our strict schema. Returns
   * null only when the input is not an object — every other field has a safe
   * default so the form is always populated.
   */
  function clampGroup(g: any): OrchestrateGroup | null {
    if (!g || typeof g !== 'object') return null
    const name = String(g.name ?? '').slice(0, 20).trim()
    const refStrategy: OrchestrateRefStrategy =
      g.refStrategy === 'upload' || g.refStrategy === 'textgen' || g.refStrategy === 'none'
        ? g.refStrategy
        : 'textgen'
    const description = String(g.description ?? '').slice(0, 500).trim()
    // User-authored reference text (only meaningful for textgen). Cap at 4000
    // chars to guard against runaway LLM output; text2img backends can handle
    // long prompts so we don't truncate aggressively.
    const referenceText = String(g.referenceText ?? '').slice(0, 4000)
    // Business texts array: each slot is either user-authored verbatim or empty.
    // We preserve index alignment with businessCount.
    let businessTexts: string[] = []
    if (Array.isArray(g.businessTexts)) {
      businessTexts = g.businessTexts
        .slice(0, 20)
        .map((v: any) => String(v ?? '').slice(0, 4000))
    }
    // businessCount: trust the array length when LLM produced a non-empty array
    // (keeps the two in sync); otherwise clamp the provided number with a safe
    // default of 3.
    let count = Number(g.businessCount)
    if (!Number.isFinite(count)) count = businessTexts.length || 3
    count = Math.max(1, Math.min(20, Math.round(count)))
    if (businessTexts.length > 0 && businessTexts.length !== count) {
      // Prefer aligning count to array length so user-authored text is never lost.
      count = Math.max(1, Math.min(20, businessTexts.length))
    }
    // Pad or trim array to exactly `count` for downstream indexing safety.
    if (businessTexts.length < count) {
      businessTexts = [...businessTexts, ...Array(count - businessTexts.length).fill('')]
    } else if (businessTexts.length > count) {
      businessTexts = businessTexts.slice(0, count)
    }
    // Size/quality validation. Group-level defaults silently fall back so the
    // form is always populated; overrides below are nullable.
    // size accepts presets, custom ratios, or custom pixels (isValidSizeValue).
    // quality stays on a small enum so we keep using a Set.
    const size = isValidSizeValue(String(g.size ?? '')) ? String(g.size) : '1:1'
    const quality = QUALITY_VALUE_SET.has(String(g.quality ?? '')) ? String(g.quality) : 'auto'
    // tier 结构当前固定认 1k/2k/4k，LLM 返回未知值时回退 2k
    const tier = ['1k', '2k', '4k'].includes(String(g.tier ?? '')) ? String(g.tier) : '2k'
    const referenceSize = isValidSizeValue(String(g.referenceSize ?? ''))
      ? String(g.referenceSize)
      : undefined
    const referenceQuality = QUALITY_VALUE_SET.has(String(g.referenceQuality ?? ''))
      ? String(g.referenceQuality)
      : undefined
    // Per-node override arrays. Align length to `count`; slots that fail
    // validation become undefined so downstream resolution falls back to group.
    const clampSizeArr = (input: any): (string | undefined)[] | undefined => {
      if (!Array.isArray(input)) return undefined
      const arr: (string | undefined)[] = []
      for (let i = 0; i < count; i++) {
        const v = String(input[i] ?? '').trim()
        arr.push(v && isValidSizeValue(v) ? v : undefined)
      }
      return arr.some((v) => v !== undefined) ? arr : undefined
    }
    const clampEnumArr = (input: any, whitelist: Set<string>): (string | undefined)[] | undefined => {
      if (!Array.isArray(input)) return undefined
      const arr: (string | undefined)[] = []
      for (let i = 0; i < count; i++) {
        const v = String(input[i] ?? '').trim()
        arr.push(v && whitelist.has(v) ? v : undefined)
      }
      return arr.some((v) => v !== undefined) ? arr : undefined
    }
    const businessSizes = clampSizeArr(g.businessSizes)
    const businessQualities = clampEnumArr(g.businessQualities, QUALITY_VALUE_SET)
    return {
      name,
      refStrategy,
      businessCount: count,
      description,
      size,
      quality,
      tier,
      referenceText: referenceText || undefined,
      referenceSize,
      referenceQuality,
      businessTexts: businessTexts.some((t) => t.trim()) ? businessTexts : undefined,
      businessSizes,
      businessQualities
    }
  }

  return {
    orchestrate,
    inferGroups,
    /** Exposed for tests / previews; normal callers just use orchestrate. */
    buildSkeleton
  }
}
