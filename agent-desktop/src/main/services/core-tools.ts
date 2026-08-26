import { executeSkillSandbox, resolveInWorkspace } from './skill-sandbox'
import { generateImages } from './image-generation'
import { listModelProviders } from './model-provider'
import { getDataDir } from './data-path'
import { emitAssistantAppended } from './events'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'fs'
import { join, basename, resolve, isAbsolute, relative } from 'path'
import { listCategories, listKnowledgeBases, type KnowledgeBase } from './knowledge'
import { embedText, EmbeddingUnavailableError } from './embedding'
import { searchHybrid } from './vector-store'
import { searchCloudKnowledgeBases } from './cloud-kb-search'
import { getVectorStatsForUI } from './vectorize'
import { addMessage, getConversation, getMessages, updateMessageCard, type MessageCard } from './conversation'
import { getBrandWorkspace } from './brand-workspace'
import { getActiveWorkspaceRoot } from './agent-workspace'
import { requestUserChoice } from './user-choice'
import { v4 as uuid } from 'uuid'
import type { BrowserWindow } from 'electron'
import { detectPython, ensurePython, looksLikePythonCommand } from './python-runtime'
import { isBrandOverride } from './brand-card'

const PREVIEW_MAX_BYTES = 200_000

/** 品牌会话或当前工作区：取跨会话产出目录（无则空串） */
function getBrandOutputDirForConversation(conversationId?: string): string {
  // 优先当前文件夹工作区的 output/
  try {
    const root = getActiveWorkspaceRoot()
    if (root) return join(root, 'output')
  } catch {
    /* ignore */
  }
  if (!conversationId) return ''
  try {
    const conv = getConversation(conversationId)
    if (!conv?.brand_workspace_id) return ''
    const brand = getBrandWorkspace(conv.brand_workspace_id)
    return (brand?.output_dir || '').trim()
  } catch {
    return ''
  }
}

/**
 * 生图结果落盘：
 * 1) 会话工作区 images/（或显式 output_dir）——对话内引用
 * 2) 若挂了品牌工作区，额外拷到品牌产出目录（跨会话归档）
 * 返回用于对话展示的主路径（优先会话工作区路径）。
 */
function placeImageGenOutput(
  absoluteSource: string,
  opts: {
    sandboxDir?: string
    conversationId?: string
    outputDirArg?: string
    outputFilename?: string
  }
): string {
  if (!absoluteSource || !existsSync(absoluteSource)) return absoluteSource

  const ext = basename(absoluteSource).split('.').pop() || 'png'
  const filename = opts.outputFilename ? `${opts.outputFilename}.${ext}` : basename(absoluteSource)

  let displayPath = absoluteSource

  // 1) 会话工作区（相对路径相对 sandbox；绝对路径按字面）
  let outputDir = opts.outputDirArg
  if (!outputDir && opts.sandboxDir) outputDir = 'images'
  try {
    const resolvedOutputDir = outputDir ? resolveInWorkspace(outputDir, opts.sandboxDir) : ''
    if (resolvedOutputDir) {
      mkdirSync(resolvedOutputDir, { recursive: true })
      const dest = join(resolvedOutputDir, filename)
      copyFileSync(absoluteSource, dest)
      displayPath = dest
    }
  } catch (e) {
    console.error('[image_gen] copy to workspace failed (non-fatal):', e)
  }

  // 2) 品牌产出目录归档（仅当未显式指定已是该目录时仍拷一份；显式指向品牌目录则跳过重复）
  const brandDir = getBrandOutputDirForConversation(opts.conversationId)
  if (brandDir) {
    try {
      const brandResolved = resolve(brandDir)
      const displayResolved = resolve(displayPath)
      const alreadyInBrand =
        displayResolved === brandResolved ||
        displayResolved.startsWith(brandResolved + '/') ||
        displayResolved.startsWith(brandResolved + '\\')
      if (!alreadyInBrand) {
        mkdirSync(brandResolved, { recursive: true })
        // 避免重名覆盖：同名则加短时间戳
        let brandDest = join(brandResolved, filename)
        if (existsSync(brandDest) && resolve(brandDest) !== displayResolved) {
          const stem = filename.replace(/\.[^.]+$/, '')
          brandDest = join(brandResolved, `${stem}-${Date.now()}.${ext}`)
        }
        copyFileSync(absoluteSource, brandDest)
      }
    } catch (e) {
      console.error('[image_gen] copy to brand output failed (non-fatal):', e)
    }
  }

  return displayPath
}

export interface FileWritePreview {
  type: 'file_write'
  action: string
  path: string
  exists: boolean
  isBinary?: boolean
  tooLarge?: boolean
  currentContent?: string
  newContent: string
}

export function previewFileWrite(args: any, sandboxDir?: string): FileWritePreview | null {
  if (!args || typeof args !== 'object') return null
  const writeActions = ['write', 'append', 'write_json']
  if (!writeActions.includes(args.action)) return null
  const newContent = args.action === 'write_json'
    ? (() => { try { return JSON.stringify(args.data, null, 2) } catch { return String(args.data || '') } })()
    : String(args.content || '')
  let resolvedPath = ''
  let exists = false
  let currentContent: string | undefined
  let tooLarge = false
  let isBinary = false
  try {
    resolvedPath = sandboxDir ? resolveInWorkspace(args.path || '', sandboxDir) : String(args.path || '')
    exists = !!resolvedPath && existsSync(resolvedPath)
    if (exists) {
      const st = statSync(resolvedPath)
      if (st.isDirectory()) exists = false
      else if (st.size > PREVIEW_MAX_BYTES) tooLarge = true
      else {
        const buf = readFileSync(resolvedPath)
        // crude binary sniff: any null byte in the first 8KB
        const sniff = buf.subarray(0, Math.min(8192, buf.length))
        isBinary = sniff.includes(0)
        currentContent = isBinary ? undefined : buf.toString('utf-8')
      }
    }
  } catch {
    // best-effort preview
  }
  if (args.action === 'append' && typeof currentContent === 'string') {
    return {
      type: 'file_write',
      action: args.action,
      path: resolvedPath,
      exists,
      isBinary,
      tooLarge,
      currentContent,
      newContent: currentContent + newContent
    }
  }
  return {
    type: 'file_write',
    action: args.action,
    path: resolvedPath,
    exists,
    isBinary,
    tooLarge,
    currentContent,
    newContent
  }
}

// 读类 file_ops 操作集合：会读到文件内容或枚举目录条目，外泄风险高。
// stat/exists 仅探测元数据，仍纳入展示但不强制拦截（拦截策略在 chat-engine 决定）。
const READ_FILE_OPS_ACTIONS = ['read', 'read_json', 'list', 'glob', 'find_latest', 'tree', 'stat', 'exists']

export interface FileReadPreview {
  type: 'file_read'
  action: string
  path: string
  outsideWorkspace: boolean
}

// 为读类 file_ops 生成审批弹窗预览：展示真实解析后的绝对路径，并标记是否在工作区之外，
// 让用户在「允许 AI 读取」前能清楚看到目标，拦下被诱导读取敏感文件的情况。
export function previewFileRead(args: any, sandboxDir?: string): FileReadPreview | null {
  if (!args || typeof args !== 'object' || !READ_FILE_OPS_ACTIONS.includes(args.action)) return null
  const resolved = sandboxDir ? resolveInWorkspace(args.path || '', sandboxDir) : String(args.path || '')
  let outsideWorkspace = false
  if (sandboxDir) {
    try {
      const rel = relative(resolve(sandboxDir), resolved)
      outsideWorkspace = rel !== '' && (rel.startsWith('..') || isAbsolute(rel))
    } catch {
      outsideWorkspace = false
    }
  }
  return { type: 'file_read', action: args.action, path: resolved, outsideWorkspace }
}

function backupBeforeWrite(args: any, sandboxDir?: string): void {
  if (!args || typeof args !== 'object') return
  if (args.action !== 'write' && args.action !== 'write_json') return
  try {
    const target = sandboxDir ? resolveInWorkspace(args.path || '', sandboxDir) : String(args.path || '')
    if (!target || !existsSync(target)) return
    const st = statSync(target)
    if (st.isDirectory() || st.size === 0) return
    copyFileSync(target, target + '.bak')
  } catch {
    // backup is best-effort; never block the actual write
  }
}

export const CORE_TOOL_NAMES = ['file_ops', 'run_command', 'image_gen', 'ask_user', 'kb_list', 'kb_search', 'kb_stats', 'browser']

export const KB_TOOL_NAMES = ['kb_list', 'kb_search', 'kb_stats']

export interface KbToolContext {
  /** 当前对话启用的本地 KB 分类 id 列表（已 resolve 过 override） */
  kbCategoryIds: string[]
  /** 绑定的云端知识库 id 列表（来自智能体预设） */
  cloudKbIds?: number[]
  /** 云端检索鉴权用的市场 agent id */
  cloudAgentId?: number
  /** 云端检索 Top K */
  cloudKbTopK?: number
}

export const coreToolDefs = [
  {
    type: 'function',
    function: {
      name: 'file_ops',
      description: '文件系统操作：读取、写入、追加、列目录、创建目录、删除、复制、重命名、glob匹配、JSON读写、查找最新文件',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['read', 'write', 'append', 'list', 'mkdir', 'exists', 'stat', 'delete', 'copy', 'rename', 'glob', 'read_json', 'write_json', 'find_latest', 'tree'],
            description: '操作类型'
          },
          path: { type: 'string', description: '文件或目录路径。相对路径解析到当前对话工作区;绝对路径按字面解析;"." 或 "" 表示工作区根' },
          content: { type: 'string', description: '写入/追加的内容（write/append 时使用）' },
          dest: { type: 'string', description: '目标路径（copy/rename 时使用）' },
          pattern: { type: 'string', description: 'glob匹配模式（glob 时使用，如 *.pptx）' },
          data: { type: 'object', description: 'JSON数据对象（write_json 时使用）' },
          extension: { type: 'string', description: '文件扩展名过滤（find_latest 时使用，如 .pptx）' }
        },
        required: ['action', 'path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: '在系统终端执行命令，返回结构化结果 {exit_code, stdout, stderr, ok}。运行 Python 脚本时使用系统提示里给出的 Python 绝对路径。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的命令' },
          cwd: { type: 'string', description: '工作目录（可选，默认当前对话工作区；相对路径相对工作区解析）' },
          timeout: { type: 'number', description: '超时毫秒数（可选，默认180000）' }
        },
        required: ['command']
      }
    }
  }
  ,
  {
    type: 'function',
    function: {
      name: 'image_gen',
      description: 'AI图片生成工具：使用应用内配置的模型服务商生成图片。支持两种操作：list_providers 查看可用的图片生成服务商和模型，generate 生成图片。生成的图片会自动保存，可选复制到指定目录。生成成功后返回 image_url 字段，请使用 markdown 图片语法 ![描述](image_url) 在回复中展示生成的图片。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list_providers', 'generate'],
            description: '操作类型：list_providers 查看可用服务商，generate 生成图片'
          },
          prompt: { type: 'string', description: '图片描述提示词（generate 时必填）' },
          model_provider_id: { type: 'string', description: '服务商ID（generate 时必填，从 list_providers 获取）' },
          model_id: { type: 'string', description: '模型ID（generate 时必填，从 list_providers 获取）' },
          size: { type: 'string', description: '图片尺寸比例。重要：用户未明确说尺寸/比例时不要传此参数（留空）——系统会弹「生图参数卡」让用户选尺寸/分辨率/画质/数量；仅当用户明确指定了尺寸或比例（如“画个16:9的”）时才传。取值：正图 1:1；横图 2:1, 3:1, 3:2, 4:3, 5:4, 16:9, 21:9；竖图 1:2, 1:3, 2:3, 3:4, 4:5, 9:16, 9:21；也可传 1:3 到 3:1 范围内的自定义比例或像素' },
          batch_count: { type: 'number', description: '生成张数，1-4。微信 ClawBot 已解析用户“来四张”等要求时必须原样传入。' },
          output_dir: { type: 'string', description: '可选，将生成的图片复制到此目录。相对路径相对当前对话工作区;未指定时默认落在 {工作区}/images/' },
          output_filename: { type: 'string', description: '可选，自定义输出文件名（不含扩展名，如 cover_bg）' },
          ref_image_ids: { type: 'array', items: { type: 'string' }, description: '可选，参考图片附件 ID 数组。优先使用系统提示列出的最近图片附件 id，不要传 base64' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser',
      description:
        '操作应用内置浏览器窗口（独立 Profile，Cookie 隔离）。典型流程：open 打开网页 → 用返回的 elements[].ref 去 click / type；看不清页面时再用 screenshot（截图落盘，用路径引用，不要把图片读进上下文）。登录、验证码、支付请让用户在弹出窗口里亲手完成，然后再 snapshot 继续。未指定 profile_id 时使用默认 Profile。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list_profiles', 'open', 'snapshot', 'click', 'type', 'screenshot', 'close'],
            description:
              'list_profiles 列出 Profile；open 打开/导航；snapshot 读取可点元素 ref；click 点击；type 输入；screenshot 截图落盘；close 关闭窗口'
          },
          url: { type: 'string', description: 'open 时的网址（http/https）' },
          profile_id: { type: 'string', description: 'Profile id，默认 default' },
          ref: { type: 'string', description: 'snapshot 返回的元素编号，click / type 时必填' },
          text: { type: 'string', description: 'type 时要填入的文字' },
          submit: { type: 'boolean', description: 'type 后是否回车提交，默认 false' },
          path: { type: 'string', description: 'screenshot 保存路径。相对路径解析到当前工作区；默认 images/browser-时间戳.png' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: '向用户弹出可点击的选项卡片，请其在选项中做出选择或澄清后再继续。支持一次提出多个问题（分步向导：用户逐题选择、可回上一题、末尾统一提交），作答后你会一次性收到所有答案。适用场景：需求有歧义、有多个合理方向、涉及需要用户拍板的取舍（风格/用途/方案/范围等）。卡片内嵌在对话里。注意：仅在确实需要用户决策时使用；可由你自行合理决定的琐碎默认值不要用它来问，避免打扰用户。',
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            description: '问题列表（一次可问多个，用户按顺序逐题作答）。需要用户在多个维度上做选择时，一次性把这些问题都放进来，而不是连续多次调用。',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string', description: '向用户提出的问题（简明扼要）' },
                options: {
                  type: 'array',
                  description: '该问题的选项列表，每项为 {id?, label, desc?}；也可直接传字符串数组',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', description: '选项唯一标识（可省略，系统会自动生成）' },
                      label: { type: 'string', description: '选项显示文本' },
                      desc: { type: 'string', description: '可选，选项的补充说明' }
                    }
                  }
                },
                allow_multiple: { type: 'boolean', description: '该问题是否允许多选（默认 false 单选）' },
                allow_free_input: { type: 'boolean', description: '该问题是否允许额外自由输入文本（默认 false）' }
              },
              required: ['question', 'options']
            }
          }
        },
        required: ['questions']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'kb_list',
      description: '列出当前对话已启用的知识库分类与文档清单。当用户询问"知识库里有什么/有哪些文档/库内目录"等元问题时调用。返回的 documents 包含 status 字段：仅 status="就绪"的文档可被 kb_search 检索到；pending/processing/error 状态仅供诊断，不要向用户承诺这些文档能被查到。',
      parameters: {
        type: 'object',
        properties: {
          category_id: { type: 'string', description: '可选，限定只列出指定分类下的文档；不传则列出所有已启用分类的文档汇总' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'kb_search',
      description: '在已启用的知识库中按语义+关键词混合检索。当被动注入的初次召回内容与用户问题不相关、相关度（score）偏低，或用户后续追问的话题偏离首次召回时，应主动用重写过的更精准的 query 重新检索。返回片段附 score 与来源文档名。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索 query。建议根据用户最新问题进行重写，去掉对话噪声，保留核心实体与意图' },
          top_k: { type: 'number', description: '返回片段数（默认 5，最大 20）' },
          category_ids: { type: 'array', items: { type: 'string' }, description: '可选，限定在指定分类内检索；不传则在当前对话启用的全部分类内检索' }
        },
        required: ['query']
      }
    }
  }
  // 注：kb_stats 工具曾被暴露给模型，但其 parameters.properties 为空对象 {}
  // 在部分 OpenAI 兼容上游（DeepSeek/智谱/豆包/Moonshot 等）下会触发 silent 200 + 空 SSE，
  // 导致「绑定知识库后对话无回复也无报错」。kb_list 已能给出 ready/pending/error 计数，
  // 模型问"知识库规模/状态"时改走 kb_list 即可。
  // executeKbTool 内部的 kb_stats 分支保留作防御（模型再也不会调用到）。
]

const FILE_OPS_IMPL = `try {
  const p = args.path
  switch (args.action) {
    case 'read': return { content: fs.readFile(p), path: fs.wsResolve(p) }
    case 'write': fs.writeFile(p, args.content || ''); return { success: true, path: fs.wsResolve(p) }
    case 'append': fs.appendFile(p, args.content || ''); return { success: true, path: fs.wsResolve(p) }
    case 'list': return { entries: fs.listDir(p), path: fs.wsResolve(p) }
    case 'mkdir': fs.mkdir(p); return { success: true, path: fs.wsResolve(p) }
    case 'exists': return { exists: fs.exists(p), path: fs.wsResolve(p) }
    case 'stat': { const s = fs.stat(p); return Object.assign({}, s, { path: fs.wsResolve(p) }) }
    case 'delete': {
      const s = fs.stat(p)
      if (s.isDirectory) fs.deleteDir(p); else fs.deleteFile(p)
      return { success: true, path: fs.wsResolve(p) }
    }
    case 'copy': fs.copyFile(p, args.dest); return { success: true, path: fs.wsResolve(args.dest) }
    case 'rename': fs.rename(p, args.dest); return { success: true, path: fs.wsResolve(args.dest) }
    case 'glob': {
      const base = fs.wsResolve(p)
      const entries = fs.listDir(p)
      const pattern = args.pattern || '*'
      const re = new RegExp('^' + pattern.replace(/\\./g, '\\\\.').replace(/\\*/g, '.*').replace(/\\?/g, '.') + '$', 'i')
      const matched = entries.filter(e => re.test(e.name)).map(e => ({ name: e.name, path: fs.join(base, e.name), size: e.size, isDirectory: e.isDirectory }))
      return { matches: matched, count: matched.length, path: base }
    }
    case 'read_json': {
      const raw = fs.readFile(p)
      return { data: JSON.parse(raw), path: fs.wsResolve(p) }
    }
    case 'write_json': {
      fs.writeFile(p, JSON.stringify(args.data, null, 2))
      return { success: true, path: fs.wsResolve(p) }
    }
    case 'find_latest': {
      const base = fs.wsResolve(p)
      const ext = args.extension || ''
      const items = fs.listDir(p).filter(e => !e.isDirectory && (!ext || e.name.endsWith(ext)))
      if (!items.length) return { found: false, message: 'No matching files in ' + base, path: base }
      const withStat = items.map(e => { const full = fs.join(base, e.name); const s = fs.stat(full); return { name: e.name, path: full, size: s.size, mtime: s.mtime } })
      withStat.sort((a, b) => b.mtime.localeCompare(a.mtime))
      return { found: true, file: withStat[0], all: withStat, path: base }
    }
    case 'tree': {
      const base = fs.wsResolve(p)
      const result = []
      const maxEntries = 500
      const walk = (dir, prefix) => {
        if (result.length >= maxEntries) return
        const items = fs.listDir(dir)
        items.forEach((item, i) => {
          if (result.length >= maxEntries) return
          const isLast = i === items.length - 1
          const connector = isLast ? '└── ' : '├── '
          const sizeStr = item.isDirectory ? '' : ' (' + item.size + 'B)'
          result.push(prefix + connector + item.name + sizeStr)
          if (item.isDirectory) walk(fs.join(dir, item.name), prefix + (isLast ? '    ' : '│   '))
        })
      }
      walk(p, '')
      return { tree: result.join('\\n'), count: result.length, truncated: result.length >= maxEntries, path: base }
    }
    default: return { error: '未知操作: ' + args.action }
  }
} catch (e) { return { error: e.message } }`

const RUN_COMMAND_IMPL = `try {
  const timeout = args.timeout || 180000
  const result = await shell.execStructured(args.command, { cwd: args.cwd, timeout })
  return result
} catch (e) {
  return { exit_code: e.status ?? 1, stdout: e.stdout?.toString()?.slice(0, 8000) || '', stderr: e.stderr?.toString()?.slice(0, 4000) || e.message, ok: false }
}`

/** Attach workspace path to every tool result so the LLM can self-orient on retries. */
function withWorkspace(result: any, sandboxDir?: string): any {
  if (!sandboxDir) return result
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { ...result, workspace: sandboxDir }
  }
  return { result, workspace: sandboxDir }
}

export interface ToolExecContext {
  /** 当前会话 id（用于 image_gen 进度事件 scope 到对应会话浮窗） */
  conversationId?: string
  requestId?: string
  /** 主窗口引用（用于进度事件转发到 renderer） */
  window?: BrowserWindow | null
  signal?: AbortSignal
  timeoutMs?: number
  isCanceled?: (requestId?: string) => boolean
}

export async function executeCoreToolCall(
  functionName: string,
  args: any,
  sandboxDir?: string,
  kbContext?: KbToolContext,
  execContext?: ToolExecContext
): Promise<{ handled: boolean; result?: any }> {
  if (functionName === 'file_ops') {
    // 二进制办公文档（PDF/DOCX/DOC/XLS/XLSX）拦截：sandbox 内的 readFileSync(p, 'utf-8')
    // 会把它们读成乱码，让 agent 完全无法理解。这里走主进程统一解析器返回纯文本。
    // 仅对 'read' action 拦截；'read_json' 是 JSON 文本无需特殊处理。
    if (args && args.action === 'read' && typeof args.path === 'string') {
      const { isBinaryDocument, parseDocument } = await import('./document-parser')
      if (isBinaryDocument(args.path)) {
        try {
          const absPath = sandboxDir ? resolveInWorkspace(args.path, sandboxDir) : args.path
          const parsed = await parseDocument(absPath)
          if (parsed.ok) {
            const payload = {
              content: parsed.text,
              path: args.path,
              parser: parsed.parser,
              size: parsed.size,
              ...(parsed.truncated ? { truncated: true } : {})
            }
            return { handled: true, result: withWorkspace(payload, sandboxDir) }
          }
          return {
            handled: true,
            result: withWorkspace(
              { error: parsed.error || '文档解析失败', parser: parsed.parser, path: args.path },
              sandboxDir
            )
          }
        } catch (e: any) {
          return {
            handled: true,
            result: withWorkspace({ error: `文档解析异常：${e?.message || e}`, path: args.path }, sandboxDir)
          }
        }
      }
    }
    backupBeforeWrite(args, sandboxDir)
    const result = await executeSkillSandbox(FILE_OPS_IMPL, args, sandboxDir, execContext?.timeoutMs, undefined, execContext?.signal)
    const payload = result.success ? result.result : { error: result.error }
    return { handled: true, result: withWorkspace(payload, sandboxDir) }
  }
  if (functionName === 'run_command') {
    const cmd = String(args?.command || '')
    if (looksLikePythonCommand(cmd) && !detectPython().ready) {
      const st = ensurePython()
      return {
        handled: true,
        result: withWorkspace({
          ok: false,
          needPython: true,
          exit_code: 127,
          stdout: '',
          stderr: st.reason || '本机未安装 Python 3，无法运行 PPT 脚本。请先安装后再试。',
          error: st.reason || '本机未安装 Python 3'
        }, sandboxDir)
      }
    }
    const requestedTimeout = Number(args?.timeout) || 180000
    const maxTimeout = execContext?.timeoutMs || 180000
    const commandArgs = { ...args, timeout: Math.max(1, Math.min(requestedTimeout, maxTimeout)) }
    const result = await executeSkillSandbox(RUN_COMMAND_IMPL, commandArgs, sandboxDir, maxTimeout, undefined, execContext?.signal)
    const payload = result.success ? result.result : { error: result.error }
    return { handled: true, result: withWorkspace(payload, sandboxDir) }
  }
  if (functionName === 'image_gen') {
    const result = await executeImageGen(args, sandboxDir, execContext)
    return { handled: true, result: withWorkspace(result, sandboxDir) }
  }
  if (functionName === 'browser') {
    const { executeBrowserAction } = await import('./browser-automation')
    const result = await executeBrowserAction(args, sandboxDir)
    return { handled: true, result: withWorkspace(result, sandboxDir) }
  }
  if (functionName === 'ask_user') {
    const result = await executeAskUser(args, execContext)
    return { handled: true, result }
  }
  if (KB_TOOL_NAMES.includes(functionName)) {
    const result = await executeKbTool(functionName, args, kbContext, execContext?.signal)
    return { handled: true, result }
  }
  return { handled: false }
}

// === Knowledge base tools ===
const KB_LIST_MAX_DOCS_PER_CATEGORY = 50
const KB_SEARCH_DEFAULT_TOP_K = 5
const KB_SEARCH_MAX_TOP_K = 20
const KB_SEARCH_THRESHOLD = 0.3
const KB_SNIPPET_MAX_CHARS = 800

function formatKbStatus(status: string): string {
  switch (status) {
    case 'ready': return '就绪'
    case 'pending': return '待向量化'
    case 'processing': return '向量化中'
    case 'error': return '失败'
    default: return status || '未知'
  }
}

function describeKnowledgeBase(kb: KnowledgeBase): { name: string; status: string; chunks: number } {
  // 不返回 file_path：避免将本地绝对路径随 tool result 泄露给云端模型
  return {
    name: kb.name,
    status: formatKbStatus(kb.status),
    chunks: kb.chunk_count || 0
  }
}

async function executeKbTool(
  functionName: string,
  args: any,
  kbContext?: KbToolContext,
  signal?: AbortSignal
): Promise<any> {
  const enabledIds = kbContext?.kbCategoryIds || []
  const cloudKbIds = (kbContext?.cloudKbIds || []).filter((n) => n > 0)
  const cloudAgentId = kbContext?.cloudAgentId || 0
  const hasCloud = cloudKbIds.length > 0 && cloudAgentId > 0
  if (enabledIds.length === 0 && !hasCloud) {
    return { error: '当前对话未启用任何知识库（本地分类或云端知识库），无法使用知识库工具。请用户在 bot 设置中绑定，或在对话工具栏临时勾选。' }
  }

  if (functionName === 'kb_list') {
    try {
      const allCats = listCategories()
      const enabledCats = allCats.filter((c) => enabledIds.includes(c.id))
      const filterId = (args && typeof args.category_id === 'string' && args.category_id) ? args.category_id : ''
      const targets = filterId ? enabledCats.filter((c) => c.id === filterId) : enabledCats
      if (filterId && targets.length === 0) {
        return { error: `分类 ${filterId} 未启用或不存在。已启用分类：${enabledCats.map((c) => `${c.name}(${c.id})`).join(', ') || '无'}` }
      }

      const categories = targets.map((cat) => {
        const allKbs = listKnowledgeBases(cat.id)
        const total = allKbs.length
        const truncated = allKbs.length > KB_LIST_MAX_DOCS_PER_CATEGORY
        const docs = allKbs.slice(0, KB_LIST_MAX_DOCS_PER_CATEGORY).map(describeKnowledgeBase)
        return {
          category_id: cat.id,
          category_name: cat.name,
          description: cat.description || '',
          total_docs: total,
          ready_docs: allKbs.filter((kb) => kb.status === 'ready' || kb.status === 'stale').length,
          documents: docs,
          truncated,
          truncated_remaining: truncated ? total - KB_LIST_MAX_DOCS_PER_CATEGORY : 0
        }
      })

      return {
        categories,
        scope: filterId ? 'single_category' : 'all_enabled',
        cloud: hasCloud
          ? { bound: cloudKbIds.length, note: '该智能体还绑定了云端线上知识库，无法列出云端文档清单，但可用 kb_search 检索其内容' }
          : undefined
      }
    } catch (e: any) {
      return { error: `读取知识库失败: ${e.message || String(e)}` }
    }
  }

  if (functionName === 'kb_search') {
    const query = String(args?.query || '').trim()
    if (!query) return { error: '缺少 query 参数' }
    const requestedTopK = Number(args?.top_k) || KB_SEARCH_DEFAULT_TOP_K
    const topK = Math.max(1, Math.min(KB_SEARCH_MAX_TOP_K, requestedTopK))

    const merged: Array<{ score: number; source: string; content: string; origin: 'local' | 'cloud' }> = []
    const errors: string[] = []
    let scannedLocal = 0

    // ===== 本地知识库检索 =====
    if (enabledIds.length > 0) {
      let targetCategoryIds = enabledIds
      if (Array.isArray(args?.category_ids) && args.category_ids.length > 0) {
        const requested = args.category_ids.map(String)
        const allowed = requested.filter((id: string) => enabledIds.includes(id))
        if (allowed.length > 0) targetCategoryIds = allowed
      }
      const kbIds: string[] = []
      const kbNameMap = new Map<string, string>()
      for (const catId of targetCategoryIds) {
        for (const kb of listKnowledgeBases(catId)) {
          if (kb.status === 'ready' || kb.status === 'stale') {
            kbIds.push(kb.id)
            kbNameMap.set(kb.id, kb.name)
          }
        }
      }
      scannedLocal = kbIds.length
      if (kbIds.length > 0) {
        try {
          const queryEmbed = await embedText(query, { signal })
          const hits = searchHybrid(queryEmbed.embedding, query, kbIds, topK, KB_SEARCH_THRESHOLD)
          for (const h of hits) {
            const content = h.chunk.content || ''
            merged.push({
              score: Math.round(h.score * 1000) / 1000,
              source: kbNameMap.get(h.chunk.knowledge_base_id) || '本地文档',
              content,
              origin: 'local'
            })
          }
        } catch (e: any) {
          if (e instanceof EmbeddingUnavailableError) errors.push(`本地向量服务不可用 (${e.code})`)
          else errors.push(`本地检索失败: ${e.message || String(e)}`)
        }
      }
    }

    // ===== 云端知识库检索（hybrid：云端为主 + 缓存降级）=====
    if (hasCloud) {
      try {
        const cloudRes = await searchCloudKnowledgeBases({ agentId: cloudAgentId, query, kbIds: cloudKbIds, topK, signal })
        const offline = cloudRes.source === 'cache' ? '（离线缓存）' : ''
        for (const h of cloudRes.hits) {
          const src = [h.kb_name, h.source_doc].filter(Boolean).join(' / ') || '云端知识库'
          merged.push({ score: Math.round(h.score * 1000) / 1000, source: src + offline, content: h.content || '', origin: 'cloud' })
        }
        // 云端检索因余额不足等原因不可用：带回提示，避免静默用陈旧缓存让用户以为知识库正常
        if (cloudRes.unavailableReason) errors.push(cloudRes.unavailableReason)
      } catch (e: any) {
        errors.push(`云端检索失败: ${e.message || String(e)}`)
      }
    }

    if (merged.length === 0) {
      return {
        results: [],
        total: 0,
        query,
        top_k: topK,
        message: errors.length ? errors.join('；') : '未检索到相关内容（可能尚未向量化或相关度过低）'
      }
    }

    merged.sort((a, b) => b.score - a.score)
    const results = merged.slice(0, topK).map((m, i) => {
      const truncated = m.content.length > KB_SNIPPET_MAX_CHARS
      return {
        rank: i + 1,
        score: m.score,
        source: m.source,
        origin: m.origin,
        content: truncated ? m.content.slice(0, KB_SNIPPET_MAX_CHARS) + '...' : m.content,
        truncated
      }
    })
    return { results, total: results.length, query, top_k: topK, scanned_documents: scannedLocal, partial_errors: errors.length ? errors : undefined }
  }

  if (functionName === 'kb_stats') {
    try {
      const stats = getVectorStatsForUI().filter((s) => enabledIds.includes(s.category_id))
      return { categories: stats, total_categories: stats.length }
    } catch (e: any) {
      return { error: `读取统计失败: ${e.message || String(e)}` }
    }
  }

  return { error: `未知的知识库工具: ${functionName}` }
}

/**
 * ask_user 工具：向用户弹出可点击的选项卡片，挂起工具执行等其选择，再把结果返回给 LLM。
 *
 * 复用 user-choice 的人在回路回环 + chat:appendMessage / chat:updateMessage 通道：
 *  1) 落一条 pending 卡片消息并推给前端渲染交互卡
 *  2) requestUserChoice 挂起，等用户在对话里选择（或超时/中止 → null）
 *  3) 落 answered/canceled 留痕、通知前端更新，并把选择作为 tool result 返回
 */
async function executeAskUser(args: any, execContext?: ToolExecContext): Promise<any> {
  const conversationId = execContext?.conversationId
  const window = execContext?.window || null
  const signal = execContext?.signal

  // 规范化为 questions[]：优先 args.questions；兼容单题 args.question + args.options
  const rawQuestions: any[] =
    Array.isArray(args?.questions) && args.questions.length
      ? args.questions
      : args?.question
        ? [{ question: args.question, options: args.options, allow_multiple: args.allow_multiple, allow_free_input: args.allow_free_input }]
        : []

  const questions = rawQuestions
    .map((q: any, qi: number) => {
      const rawOptions = Array.isArray(q?.options) ? q.options : []
      const options = rawOptions
        .map((o: any, i: number) => {
          if (typeof o === 'string') return { id: `q${qi}_opt_${i}`, label: o.trim(), value: o }
          const label = String(o?.label ?? o?.value ?? '').trim()
          return {
            id: String(o?.id ?? `q${qi}_opt_${i}`),
            label,
            value: o?.value ?? o?.label ?? `q${qi}_opt_${i}`,
            desc: o?.desc ? String(o.desc) : undefined
          }
        })
        .filter((o: any) => o.label)
      return {
        id: String(q?.id ?? `q${qi}`),
        question: String(q?.question || '').trim(),
        options,
        allow_multiple: !!q?.allow_multiple,
        allow_free_input: !!q?.allow_free_input
      }
    })
    .filter((q: any) => q.question && q.options.length)

  if (questions.length === 0) return { error: '缺少 questions（每个问题需含 question 与非空 options）' }

  // chat 路径下一定有 conversationId + window；缺失说明非交互环境，无法弹卡。
  if (!conversationId || !window) {
    return { error: '当前环境不支持交互选项卡，请直接基于已知信息继续。' }
  }

  const requestId = uuid()
  const card: MessageCard = {
    type: 'ask_user',
    request_id: requestId,
    status: 'pending',
    questions
  }
  const message = addMessage({ conversation_id: conversationId, role: 'assistant', content: '', card })
  try {
    window.webContents.send('chat:appendMessage', { conversationId, message })
  } catch (e) {
    console.error('[ask_user] appendMessage failed:', e)
  }

  const selection = await requestUserChoice(conversationId, requestId, signal)

  // 会话可能在等待期间被删除：updateMessageCard 返回 null 时静默跳过 UI 更新。
  if (!selection) {
    const updated = updateMessageCard(message.id, { status: 'canceled' })
    if (updated) {
      try { window.webContents.send('chat:updateMessage', { conversationId, message: updated }) } catch {}
    }
    return {
      status: 'canceled',
      message: '用户未作出选择（已取消或超时）。请勿重试，等待用户进一步指示。'
    }
  }

  const answers = (selection.answers || {}) as Record<string, { selected: string[]; free_text?: string }>
  const updated = updateMessageCard(message.id, { status: 'answered', answers })
  if (updated) {
    try { window.webContents.send('chat:updateMessage', { conversationId, message: updated }) } catch {}
  }

  // 组织成对模型友好的逐题结果（值用 option.value/label，而非内部 id）
  const resultAnswers = questions.map((q: any) => {
    const a = answers[q.id] || { selected: [] }
    const selIds = Array.isArray(a.selected) ? a.selected : []
    const selOpts = q.options.filter((o: any) => selIds.includes(o.id))
    const selVals = selOpts.map((o: any) => o.value ?? o.label)
    return {
      question: q.question,
      selected: q.allow_multiple ? selVals : (selVals[0] ?? null),
      selected_labels: selOpts.map((o: any) => o.label),
      free_text: a.free_text || ''
    }
  })

  return { status: 'answered', answers: resultAnswers }
}

const IMAGE_KEYWORDS = ['image', 'dall-e', 'flux', 'stable-diffusion', 'sdxl', 'cogview', 'wanx', 'kolors']

/**
 * 弹「生图参数确认卡」（image_params），挂起等用户确认尺寸/分辨率/画质/张数。
 * 复用 user-choice 回环 + chat:appendMessage / chat:updateMessage 通道。
 * 返回确认后的参数；用户取消 / 超时返回 null。
 */
async function requestImageParams(
  conversationId: string,
  window: BrowserWindow,
  args: any,
  signal?: AbortSignal
): Promise<{ size: string; tierId: string; quality: string; batchCount: number } | null> {
  const cardRequestId = uuid()
  const card: MessageCard = {
    type: 'image_params',
    request_id: cardRequestId,
    status: 'pending',
    question: '请确认生图参数',
    defaults: {
      prompt: args.prompt || '',
      model_id: args.model_id || '',
      size: '1:1',
      tierId: '2k',
      quality: 'auto',
      batchCount: 1
    }
  }
  const message = addMessage({ conversation_id: conversationId, role: 'assistant', content: '', card })
  try {
    window.webContents.send('chat:appendMessage', { conversationId, message })
  } catch (e) {
    console.error('[image_gen] appendMessage (params card) failed:', e)
  }

  const selection = await requestUserChoice(conversationId, cardRequestId, signal)
  if (!selection || !selection.result) {
    const updated = updateMessageCard(message.id, { status: 'canceled' })
    if (updated) {
      try { window.webContents.send('chat:updateMessage', { conversationId, message: updated }) } catch {}
    }
    return null
  }
  const r = selection.result
  const result = {
    size: String(r.size || '1:1'),
    tierId: String(r.tierId || '2k'),
    quality: String(r.quality || 'auto'),
    batchCount: Math.min(Math.max(Number(r.batchCount) || 1, 1), 10)
  }
  const updated = updateMessageCard(message.id, { status: 'answered', result })
  if (updated) {
    try { window.webContents.send('chat:updateMessage', { conversationId, message: updated }) } catch {}
  }
  return result
}

async function executeImageGen(args: any, sandboxDir?: string, execContext?: ToolExecContext): Promise<any> {
  try {
    if (args.action === 'list_providers') {
      const providers = listModelProviders()
      const result = providers.map(p => {
        const imageModels = p.models.filter(m => IMAGE_KEYWORDS.some(k => m.toLowerCase().includes(k)))
        return {
          id: p.id,
          name: p.name,
          image_models: imageModels.length ? imageModels : p.models,
          has_image_models: imageModels.length > 0
        }
      })
      return { providers: result }
    }

    if (args.action === 'generate') {
      if (!args.prompt) return { error: '缺少 prompt 参数' }
      if (!args.model_provider_id) return { error: '缺少 model_provider_id 参数，请先调用 list_providers 获取' }
      if (!args.model_id) return { error: '缺少 model_id 参数，请先调用 list_providers 获取' }

      // chat 路径下走 fire-and-forget：工具立即返回 status:'pending'，
      // generateImages 在后台异步跑，完成后追加 assistant 消息到对话流。
      // 这样 LLM 不会阻塞 30-90 秒等图片，用户能立即继续对话。
      const conversationId = execContext?.conversationId
      const requestId = execContext?.requestId
      const window = execContext?.window || null
      if (conversationId) {
        // 用户未明确指定尺寸（args.size）时，先弹「生图参数确认卡」让其确认尺寸/分辨率/画质/张数；
        // 已指定则直接出图（尊重用户/LLM 的显式参数，不打扰）。
        let genArgs = { ...args, batchCount: Math.min(4, Math.max(1, Number(args.batch_count || args.batchCount) || 1)) }
        if (!args.size && window) {
          const params = await requestImageParams(conversationId, window, args, execContext?.signal)
          if (!params) {
            return {
              status: 'canceled',
              message: '用户取消了生图参数确认，未生成图片。请勿重试，等待用户进一步指示。'
            }
          }
          genArgs = { ...args, ...params }
        }
        // 后台执行（不 await）—— 任何异常都在 helper 内自我消化，避免吞掉
        runImageGenInBackground(genArgs, sandboxDir, conversationId, requestId, window, execContext?.isCanceled).catch((e) => {
          console.error('[image_gen] background task threw:', e)
        })
        return {
          success: true,
          status: 'pending',
          message:
            '已提交生图任务，约 30-90 秒。请告诉用户：图片完成后会自动出现在对话和右上角浮窗，本次回复无需嵌入图片。'
        }
      }

      // 兜底：无 conversationId（理论上不会发生在 chat 路径下）走同步行为，保持向后兼容
      const generations = await generateImages(
        {
          prompt: args.prompt,
          modelProviderId: args.model_provider_id,
          modelId: args.model_id,
          size: args.size || '1:1',
          quality: 'auto',
          batchCount: 1,
          refImages: args.ref_images || undefined,
          applyWorkspaceBrand: true,
          brandUserOverride: isBrandOverride(String(args.prompt || ''))
        },
        window
      )

      const gen = generations[0]
      if (!gen) return { error: '生成失败：无结果返回' }
      if (gen.status === 'error') return { error: `生成失败: ${gen.error}` }

      const dataDir = getDataDir()
      const absolutePath = gen.result_path ? join(dataDir, gen.result_path) : ''

      const outputPath = placeImageGenOutput(absolutePath, {
        sandboxDir,
        conversationId: undefined,
        outputDirArg: args.output_dir,
        outputFilename: args.output_filename
      })

      const displayUrl = `local-file://img?p=${encodeURIComponent(outputPath.replace(/\\/g, '/'))}`
      return {
        success: true,
        path: outputPath,
        image_url: displayUrl,
        revised_prompt: gen.revised_prompt || '',
        size: gen.size,
        model: gen.model_id
      }
    }

    return { error: '未知操作: ' + args.action }
  } catch (e: any) {
    return { error: e.message || '图片生成失败' }
  }
}

/**
 * chat 路径下的 image_gen 后台执行：generateImages → addMessage → IPC。
 *
 * 工具调用本身已经立即返回 status:'pending'，LLM 拿到后会回复"已开始生成"
 * 然后流结束（输入框解锁）。本函数在后台慢慢跑，完成后把图片以 markdown 形式
 * 追加为 assistant 消息到对话流，并通过 chat:appendMessage 通知前端 store
 * 实时插入消息。
 *
 * 失败/异常时同样追加一条 assistant 消息（含错误信息），不会静默丢失。
 *
 * 安全：
 *  - 所有写盘 / DB 操作都包在 try/catch 里
 *  - 追加消息前用 getConversation 校验 conversation 是否仍存在（用户可能在等待期间删除会话）
 */
async function runImageGenInBackground(
  args: any,
  sandboxDir: string | undefined,
  conversationId: string,
  requestId: string | undefined,
  window: BrowserWindow | null,
  isCanceled?: (requestId?: string) => boolean
): Promise<void> {
  let assistantContent = ''
  const canceled = () => !!requestId && !!isCanceled?.(requestId)
  try {
    if (canceled()) return
    const lastUser = [...getMessages(conversationId)].reverse().find((m) => m.role === 'user')
    const generations = await generateImages(
      {
        prompt: args.prompt,
        modelProviderId: args.model_provider_id,
        modelId: args.model_id,
        size: args.size || '1:1',
        // 分辨率档位/画质/张数：优先用「生图参数确认卡」回传的值（args.tierId 等），
        // 缺省回退默认（2k 档位、auto 画质、单张）——与画布节点一致；像素档位不影响 per-call 计费。
        tierId: args.tierId || '2k',
        quality: args.quality || 'auto',
        batchCount: args.batchCount || 1,
        refImages: args.ref_images || undefined,
        applyWorkspaceBrand: true,
        brandUserOverride: isBrandOverride(String(lastUser?.content || args.prompt || '')),
        progressContext: {
          conversationId,
          requestId,
          source: 'chat'
        }
      },
      window
    )
    if (canceled()) return
    const gen = generations[0]
    if (!gen) {
      assistantContent = '[生图失败] 服务商未返回结果'
    } else if (gen.status === 'error') {
      assistantContent = `[生图失败] ${gen.error || '未知错误'}`
    } else {
      // 会话工作区 + 品牌产出目录（若有）双落盘
      const dataDir = getDataDir()
      const absolutePath = gen.result_path ? join(dataDir, gen.result_path) : ''
      const outputPath = placeImageGenOutput(absolutePath, {
        sandboxDir,
        conversationId,
        outputDirArg: args.output_dir,
        outputFilename: args.output_filename
      })
      const displayUrl = outputPath
        ? `local-file://img?p=${encodeURIComponent(outputPath.replace(/\\/g, '/'))}`
        : ''
      const promptHint = args.prompt ? String(args.prompt).slice(0, 60).replace(/[[\]()]/g, '') : ''
      assistantContent = displayUrl
        ? `![${promptHint || '已生成图片'}](${displayUrl})`
        : '[生图失败] 图片路径无效'
    }
  } catch (e: any) {
    assistantContent = `[生图失败] ${e?.message || String(e)}`
  }

  // 校验 conversation 仍存在（用户可能已删除会话）
  try {
    if (canceled()) return
    if (!getConversation(conversationId)) return
    const message = addMessage({
      conversation_id: conversationId,
      role: 'assistant',
      content: assistantContent
    })
    // 通知 ClawBot 桥「有新 assistant 消息」：事件驱动补发（不再只靠轮询 watcher 猜窗口）
    emitAssistantAppended(conversationId)
    if (window) {
      window.webContents.send('chat:appendMessage', { conversationId, requestId, message })
    }
  } catch (e: any) {
    console.error('[image_gen bg] failed to append message:', e)
  }
}
