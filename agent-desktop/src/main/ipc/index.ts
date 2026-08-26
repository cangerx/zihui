import { ipcMain as electronIpcMain, BrowserWindow, dialog, clipboard, nativeImage, app } from 'electron'
import { closeDatabase } from '../database'
import { stopAllMcpServers } from '../services/mcp-server'
import * as modelProviderService from '../services/model-provider'
import * as personaService from '../services/persona'
import * as knowledgeService from '../services/knowledge'
import { scanKnowledgeFolder } from '../services/kb-scanner'
import * as botService from '../services/bot'
import * as conversationService from '../services/conversation'
import * as skillService from '../services/skill'
import * as mcpServerService from '../services/mcp-server'
import { listMarket, searchMarket, getMarketDetail, installFromMarket } from '../services/mcp-market'
import * as settingsService from '../services/settings'
import * as dataPathService from '../services/data-path'
import * as usageStatsService from '../services/usage-stats'
import * as dailyReviewService from '../services/daily-review'
import * as scheduledTasksService from '../services/scheduled-tasks'
import * as browserAutomationService from '../services/browser-automation'
import { sendMessage, cancelChat, isChatActive, respondToolApproval, listPendingApprovals, regenerateLastResponse, editAndResend, continueLastResponse } from '../services/chat-engine'
import { respondUserChoice } from '../services/user-choice'
import { callLLM } from '../services/llm'
import { skillPresets } from '../services/skill-presets'
import { executeSkillSandbox } from '../services/skill-sandbox'
import * as vectorizeService from '../services/vectorize'
import * as vectorStoreService from '../services/vector-store'
import * as promptSkillService from '../services/prompt-skill'
import * as imageSessionService from '../services/image-session'
import * as imageGenService from '../services/image-generation'
import * as imageExportService from '../services/image-export'
import * as thumbnailService from '../services/thumbnail'
import * as inspirationService from '../services/inspiration'
import * as creativeTemplateService from '../services/creative-template'
import * as cloudCreativeTemplateService from '../services/cloud-creative-template'
import * as cloudCreativeTemplateSubmitService from '../services/cloud-creative-template-submit'
import * as stylePresetService from '../services/style-preset'
import * as cloudAgentMarketService from '../services/cloud-agent-market'
import * as cloudAgentSubmitService from '../services/cloud-agent-submit'
import * as botAvatarService from '../services/bot-avatar'
import * as promptPresetService from '../services/prompt-preset'
import * as backupService from '../services/backup'
import * as canvasService from '../services/canvas'
import * as galleryService from '../services/gallery'
import * as brandWorkspaceService from '../services/brand-workspace'
import * as agentWorkspaceService from '../services/agent-workspace'
import * as brandCardService from '../services/brand-card'
import * as workspaceVoiceService from '../services/workspace-voice'
import { join } from 'path'
import * as mattingService from '../services/matting'
import * as mattingProviderService from '../services/matting-providers'
import * as eweiConnectorService from '../services/ewei-connectors'
import * as eweiClient from '../services/ewei-client'
import * as mallRegistry from '../services/mall/registry'
import * as cloudVideoService from '../services/cloud-video'
import * as videoGenerationService from '../services/video-generation'
import * as localVideoService from '../services/local-video'
import * as digitalEmployeeService from '../services/digital-employee'
import * as digitalEmployeeTaskService from '../services/digital-employee-task'
import * as viralCloneService from '../services/viral-clone'
import { fetchQuota as fetchMattingQuotaFromCloud } from '../services/cloud-matting'
import * as fineMattingService from '../services/fine-matting'
import { fetchQuota as fetchFineMattingQuotaFromCloud } from '../services/cloud-fine-matting'
import * as aiMarkRemovalService from '../services/ai-mark-removal'
import { chargeWatermarkRemoval } from '../services/cloud-ai-mark'
import { parseDocumentFromBuffer, readFileSmart } from '../services/document-parser'
import { markdownToDocxBuffer, safeDocxFileName } from '../services/md-to-docx'
import * as distillService from '../services/conversation-distill'
import {
  setCloudToken,
  getCloudToken,
  setCloudPermissions,
  setCloudEmbeddingModels,
  getCloudEmbeddingModels,
  setPreferredCloudEmbeddingModel,
  getPreferredCloudEmbeddingModel,
  getActiveCloudEmbeddingModelId,
  getAllowCustomEmbedding,
  getAllowClawbot,
  setCloudModels,
} from '../services/cloud-token'
import { getDeviceId } from '../services/device-id'
import { setActiveAccount, isAccountReady } from '../services/account-context'
import * as syncService from '../services/sync'
import * as deviceSettingsService from '../services/device-settings'
import * as desktopPrefsService from '../services/desktop-prefs'
import { notifyDesktop, appDisplayName } from '../services/desktop-notify'
import { uploadInspiration as uploadInspirationToCloud } from '../services/cloud-inspiration'
import { runInEpoch } from '../services/account-epoch'
import { registerDeckIpc } from '../services/deck/deck-ipc'
import * as pythonRuntime from '../services/python-runtime'
import { registerClawbotIpc } from '../services/clawbot/clawbot-ipc'
import { startClawbotBridge, stopClawbotBridge } from '../services/clawbot/clawbot-bridge'

// 用账号代次（epoch）包裹每个 IPC handler 的执行：handler 及其 await / fire-and-forget 子任务
// 都运行在「当前账号代次」的 AsyncLocalStorage 上下文中。账号热切换后，旧 handler 触发的残留
// 异步任务写库时，getDatabase() 的 assertEpoch() 会因代次不符拒绝写入（防止串账号数据）。
function wrapWithEpoch(real: Electron.IpcMain) {
  return {
    handle: (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any) =>
      real.handle(channel, (event, ...args) => runInEpoch(() => listener(event, ...args))),
    on: (channel: string, listener: (event: Electron.IpcMainEvent, ...args: any[]) => void) =>
      real.on(channel, (event, ...args) => runInEpoch(() => listener(event, ...args)))
  }
}

export function registerIpcHandlers(): void {
  // 统一为所有 IPC handler 注入账号代次上下文（见 wrapWithEpoch）。
  // 例外：cloud:setActiveAccount 用未包裹的 electronIpcMain 注册（它本身是切换编排，
  // bumpEpoch 后需以新代次开库，不能停留在旧代次上下文）。
  const ipcMain = wrapWithEpoch(electronIpcMain)
  // 同步模块初始化：装好进度广播器（schema/触发器在开库时已安装）。
  syncService.initSyncModule()
  // === AI Deck(设计/PPT/视频) ===
  registerDeckIpc(ipcMain)
  // === 微信 ClawBot 桥 ===
  registerClawbotIpc(ipcMain)
  // === Model Providers ===
  ipcMain.handle('model:list', () => modelProviderService.listModelProviders())
  ipcMain.handle('model:get', (_, id: string) => modelProviderService.getModelProvider(id))
  ipcMain.handle('model:create', (_, data) => modelProviderService.createModelProvider(data))
  ipcMain.handle('model:update', (_, id: string, data) =>
    modelProviderService.updateModelProvider(id, data)
  )
  ipcMain.handle('model:delete', (_, id: string) => modelProviderService.deleteModelProvider(id))
  ipcMain.handle('model:fetchRemote', (_, apiBase: string, apiKey: string, type?: string) =>
    modelProviderService.fetchRemoteModels(apiBase, apiKey, type)
  )

  // === Personas ===
  ipcMain.handle('persona:list', () => personaService.listPersonas())
  ipcMain.handle('persona:get', (_, id: string) => personaService.getPersona(id))
  ipcMain.handle('persona:create', (_, data) => personaService.createPersona(data))
  ipcMain.handle('persona:update', (_, id: string, data) =>
    personaService.updatePersona(id, data)
  )
  ipcMain.handle('persona:delete', (_, id: string) => personaService.deletePersona(id))

  // === Knowledge Base Categories ===
  ipcMain.handle('knowledge:listCategories', () => knowledgeService.listCategories())
  ipcMain.handle('knowledge:getCategory', (_, id: string) => knowledgeService.getCategory(id))
  ipcMain.handle('knowledge:createCategory', (_, data) => knowledgeService.createCategory(data))
  ipcMain.handle('knowledge:updateCategory', (_, id: string, data) =>
    knowledgeService.updateCategory(id, data)
  )
  ipcMain.handle('knowledge:deleteCategory', (_, id: string) =>
    knowledgeService.deleteCategory(id)
  )

  // === Knowledge Bases ===
  ipcMain.handle('knowledge:list', (_, categoryId?: string) =>
    knowledgeService.listKnowledgeBases(categoryId)
  )
  ipcMain.handle('knowledge:listPaged', (_, categoryId: string, page: number, pageSize: number) =>
    knowledgeService.listKnowledgeBasesPaged(categoryId, page, pageSize)
  )
  ipcMain.handle('knowledge:get', (_, id: string) => knowledgeService.getKnowledgeBase(id))
  ipcMain.handle('knowledge:create', (_, data) => knowledgeService.createKnowledgeBase(data))
  ipcMain.handle('knowledge:delete', (_, id: string) => knowledgeService.deleteKnowledgeBase(id))
  ipcMain.handle('knowledge:bindFolder', (_, categoryId: string, folderPath: string) =>
    knowledgeService.bindFolder(categoryId, folderPath)
  )
  ipcMain.handle('knowledge:unbindFolder', (_, categoryId: string, folderPath: string) =>
    knowledgeService.unbindFolder(categoryId, folderPath)
  )
  ipcMain.handle('knowledge:sync', (_, categoryId: string) =>
    knowledgeService.syncCategory(categoryId)
  )
  ipcMain.handle('knowledge:scanFolder', (_, folderPath: string) =>
    scanKnowledgeFolder(folderPath)
  )
  ipcMain.handle('knowledge:retrievePreview', async (_, query: string, categoryId: string, topK?: number) => {
    const { searchLocalKb } = await import('../services/kb-local-search')
    return searchLocalKb(query, [categoryId], topK || 8)
  })

  // === Bots ===
  ipcMain.handle('bot:list', () => botService.listBots())
  ipcMain.handle('bot:get', (_, id: string) => botService.getBot(id))
  ipcMain.handle('bot:create', (_, data) => botService.createBot(data))
  ipcMain.handle('bot:update', (_, id: string, data) => botService.updateBot(id, data))
  ipcMain.handle('bot:delete', (_, id: string) => {
    const bot = botService.getBot(id)
    const ok = botService.deleteBot(id)
    if (ok && bot?.avatar) botAvatarService.deleteAvatarFile(bot.avatar)
    return ok
  })
  // 本地形象图：渲染端选图 data:URL → 落盘返回绝对路径
  ipcMain.handle('bot:saveAvatar', (_, dataUrl: string) => botAvatarService.saveAvatarFromDataUrl(dataUrl))
  // 智能体市场：公开拉取 + 保存到本地
  ipcMain.handle('bot:listMarket', (_, options?) => cloudAgentMarketService.fetchMarketAgents(options))
  ipcMain.handle('bot:listMarketCategories', () => cloudAgentMarketService.fetchMarketCategories())
  ipcMain.handle('bot:getMarket', (_, id: number) => cloudAgentMarketService.fetchMarketAgent(id))
  ipcMain.handle('bot:importFromMarket', (_, cloudAgent, applyUpgrade?: boolean) => cloudAgentMarketService.importAgentAsLocal(cloudAgent, !!applyUpgrade))
  // 投稿 / 状态轮询 / 撤回 / 评分
  ipcMain.handle('bot:submitToMarket', (_, localBotId: string) => cloudAgentSubmitService.submitAgentToMarket(localBotId))
  ipcMain.handle('bot:syncSubmissionStatus', (_, localBotIds: string[]) => cloudAgentSubmitService.syncAgentSubmissionStatus(localBotIds))
  ipcMain.handle('bot:withdrawSubmission', (_, localBotId: string) => cloudAgentSubmitService.withdrawAgentSubmission(localBotId))
  ipcMain.handle('bot:rate', (_, cloudAgentId: number, score: number, comment?: string) => cloudAgentSubmitService.rateAgent(cloudAgentId, score, comment))
  // 数字员工岗位档案 / 版本资产 / 受控候选。所有写入在主进程校验，候选确认前不参与运行。
  ipcMain.handle('bot:getEmployeeOverview', (_, botId: string, workspaceId?: string) => ({
    ...digitalEmployeeService.getEmployeeOverview(botId, workspaceId || ''),
    tasks: digitalEmployeeTaskService.listEmployeeTasks(botId, 50),
    metrics: digitalEmployeeTaskService.getEmployeeTaskMetrics(botId)
  }))
  ipcMain.handle('bot:saveEmployeeProfile', (_, botId: string, data) =>
    digitalEmployeeService.upsertEmployeeProfile(botId, data || {}))
  ipcMain.handle('bot:saveEmployeeAsset', (_, data) =>
    digitalEmployeeService.saveEmployeeAsset(data))
  ipcMain.handle('bot:archiveEmployeeAsset', (_, id: string) =>
    digitalEmployeeService.archiveEmployeeAsset(id))
  ipcMain.handle('bot:listEmployeeAssetVersions', (_, id: string) =>
    digitalEmployeeService.listEmployeeAssetVersions(id))
  ipcMain.handle('bot:restoreEmployeeAssetVersion', (_, assetId: string, versionId: string) =>
    digitalEmployeeService.restoreEmployeeAssetVersion(assetId, versionId))
  ipcMain.handle('bot:createEmployeeCandidate', (_, data) =>
    digitalEmployeeService.createEmployeeCandidate(data))
  ipcMain.handle('bot:acceptEmployeeCandidate', (_, id: string) =>
    digitalEmployeeService.acceptEmployeeCandidate(id))
  ipcMain.handle('bot:rejectEmployeeCandidate', (_, id: string) =>
    digitalEmployeeService.rejectEmployeeCandidate(id))

  // === Conversations ===
  ipcMain.handle('chat:listConversations', (_, botId: string) =>
    conversationService.listConversations(botId)
  )
  ipcMain.handle('chat:getConversation', (_, id: string) =>
    conversationService.getConversation(id)
  )
  ipcMain.handle(
    'chat:createConversation',
    (
      _,
      botId: string,
      title?: string,
      initialModel?: { provider_id: string; model_id: string },
      initialImageModel?: { provider_id: string; model_id: string },
      initialWorkspaceId?: string
    ) => conversationService.createConversation(botId, title, initialModel, initialImageModel, initialWorkspaceId)
  )
  ipcMain.handle('chat:updateTitle', (_, id: string, title: string) =>
    conversationService.updateConversationTitle(id, title, { manual: true })
  )
  // 切换会话使用的模型（输入框左下角下拉触发）。每个会话独立持久化。
  ipcMain.handle(
    'chat:updateConversationModel',
    (_, id: string, provider_id: string, model_id: string) =>
      conversationService.updateConversationModel(id, provider_id, model_id)
  )
  // v0.6.6+ 切换会话使用的生图模型（输入框左下角第二个切换器）。
  ipcMain.handle(
    'chat:updateConversationImageModel',
    (_, id: string, provider_id: string, model_id: string) =>
      conversationService.updateConversationImageModel(id, provider_id, model_id)
  )
  ipcMain.handle(
    'chat:updateConversationToolApproval',
    (_, id: string, tool_approval: string) =>
      conversationService.updateConversationToolApproval(id, tool_approval)
  )
  ipcMain.handle(
    'chat:updateConversationBrandWorkspace',
    (_, id: string, brandWorkspaceId: string) =>
      conversationService.updateConversationBrandWorkspace(id, brandWorkspaceId)
  )
  ipcMain.handle('chat:updateConversationWorkspace', (_, id: string, workspaceId: string) =>
    conversationService.updateConversationWorkspace(id, workspaceId))
  ipcMain.handle('chat:getConversationWorkspace', (_, id: string) =>
    digitalEmployeeService.getConversationWorkspace(id))
  ipcMain.handle('chat:deleteConversation', (_, id: string) =>
    conversationService.deleteConversation(id)
  )

  // === Messages ===
  ipcMain.handle('chat:getMessages', (_, conversationId: string) =>
    conversationService.getMessages(conversationId)
  )
  ipcMain.handle('chat:sendMessage', (event, data) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return sendMessage(data, window)
  })
  ipcMain.handle('chat:cancel', (_, conversationId: string, requestId?: string) => cancelChat(conversationId, requestId))
  ipcMain.handle('chat:isActive', (_, conversationId: string) => isChatActive(conversationId))
  ipcMain.handle('chat:respondToolApproval', (_, requestId: string, approved: boolean) =>
    respondToolApproval(requestId, approved)
  )
  // 重新进入会话时补投仍挂起的审批（卡片切走期间可能丢失，靠此恢复）
  ipcMain.handle('chat:listPendingApprovals', (_, conversationId: string) =>
    listPendingApprovals(conversationId)
  )
  // 对话内交互卡片（ask_user / 生图参数确认卡）用户选择回传 → resolve 挂起的工具执行
  ipcMain.handle('chat:respondUserChoice', (_, requestId: string, selection: any) =>
    respondUserChoice(requestId, selection)
  )
  ipcMain.handle('chat:deleteMessage', (_, id: string) =>
    conversationService.deleteMessage(id)
  )
  ipcMain.handle('chat:regenerate', (event, conversationId: string, requestId?: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return regenerateLastResponse(conversationId, window, requestId)
  })
  ipcMain.handle('chat:continue', (event, conversationId: string, requestId?: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return continueLastResponse(conversationId, window, requestId)
  })
  ipcMain.handle('chat:editMessage', (event, conversationId: string, messageId: string, newContent: string, requestId?: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return editAndResend(conversationId, messageId, newContent, window, requestId)
  })

  // === File Reading ===
  ipcMain.handle('chat:readFileBase64', async (_, filePath: string) => {
    const { readFileSync } = require('fs')
    return readFileSync(filePath).toString('base64')
  })
  // readFileText：智能读取，二进制办公文档（PDF/DOCX/DOC/XLS/XLSX）走对应解析器
  // 提取为纯文本；TXT/MD/JSON/CSV 等纯文本格式 utf-8 直读。
  // 解析失败时返回带错误说明的占位字符串，让 LLM 知道发生了什么而非看到乱码。
  ipcMain.handle('chat:readFileText', async (_, filePath: string) => {
    const result = await readFileSmart(filePath)
    if (result.ok) return result.text
    // 失败兜底：把错误信息作为可读占位返回，比抛错更友好（聊天附件场景不应整体失败）
    return `[文档解析失败：${result.error || '未知错误'}（解析器=${result.parser}, 扩展名=${result.ext || '未知'}）]`
  })
  // readDocument：新增。返回结构化 ParsedDocument，便于将来 UI 展示截断/解析器/大小等元数据。
  // 当前 ChatView 仍走 readFileText，无破坏性改动。
  ipcMain.handle('chat:readDocument', async (_, filePath: string) => {
    return readFileSmart(filePath)
  })
  // parseBuffer：拖拽附件场景专用——渲染端拿到 File 对象后 arrayBuffer() 通过 IPC 上送，
  // 主进程按扩展名走 PDF/DOCX/DOC/XLS/XLSX 二进制解析器返回纯文本。
  // 解决「拖入 PDF/DOCX 等二进制文档 → file.text() 按 utf-8 读取得到乱码」问题。
  // 返回值与 readFileText 一致：成功返回 text 字符串；失败返回带错误说明的占位字符串。
  ipcMain.handle('chat:parseBuffer', async (_, payload: { buffer: ArrayBuffer; ext: string }) => {
    const buffer = Buffer.from(payload.buffer)
    const result = await parseDocumentFromBuffer(buffer, payload.ext)
    if (result.ok) return result.text
    return `[文档解析失败：${result.error || '未知错误'}（解析器=${result.parser}, 扩展名=${result.ext || '未知'}）]`
  })
  ipcMain.handle('chat:parseDocumentBuffer', async (_, payload: { buffer: ArrayBuffer; ext: string }) => {
    const buffer = Buffer.from(payload.buffer)
    return parseDocumentFromBuffer(buffer, payload.ext)
  })
  ipcMain.handle('chat:exportDocx', async (event, payload: { markdown: string; title?: string }) => {
    const markdown = String(payload?.markdown || '').trim()
    if (!markdown) return { ok: false, error: '没有可导出的内容' }
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { ok: false, error: '窗口不可用' }
    const defaultName = safeDocxFileName(payload?.title || '对话导出')
    const picked = await dialog.showSaveDialog(win, {
      title: '导出 Word',
      defaultPath: defaultName,
      filters: [{ name: 'Word 文档', extensions: ['docx'] }]
    })
    if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true }
    const dest = picked.filePath.endsWith('.docx') ? picked.filePath : `${picked.filePath}.docx`
    try {
      const buf = await markdownToDocxBuffer(markdown, payload?.title)
      const { writeFileSync } = require('fs') as typeof import('fs')
      writeFileSync(dest, buf)
      const { shell } = require('electron')
      shell.showItemInFolder(dest)
      return { ok: true, path: dest }
    } catch (e: any) {
      return { ok: false, error: e?.message || '导出失败' }
    }
  })

  // === LLM Utility ===
  const llmAbortMap = new Map<string, AbortController>()

  ipcMain.handle(
    'llm:call',
    async (
      event,
      providerId: string,
      modelId: string,
      messages: any[],
      opts?: {
        requestId?: string
        max_tokens?: number
        response_format?: { type: string; [k: string]: any }
        stream?: boolean
        notifyStream?: boolean
        timeoutMs?: number
        temperature?: number
        // 画布智能体等工具循环用：透传 function-calling 工具定义；returnToolCalls=true 时
        // 返回完整 { content, tool_calls, finish_reason }，否则维持只返回 content 字符串（不破坏旧调用方）
        tools?: any[]
        returnToolCalls?: boolean
      }
    ) => {
      const {
        requestId,
        max_tokens,
        response_format,
        stream = true,
        notifyStream,
        timeoutMs,
        temperature,
        tools,
        returnToolCalls
      } = opts ?? {}

      const ac = new AbortController()
      if (requestId) {
        // Cancel any previous request sharing the same requestId
        const prev = llmAbortMap.get(requestId)
        if (prev) prev.abort()
        llmAbortMap.set(requestId, ac)
      }

      // Optional hard timeout
      let timer: ReturnType<typeof setTimeout> | undefined
      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(() => ac.abort(), timeoutMs)
      }

      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined

      try {
        const result = await callLLM(
          providerId,
          {
            modelId,
            messages,
            stream,
            max_tokens,
            response_format,
            temperature,
            notifyStream,
            tools,
            signal: ac.signal,
            // 带上 requestId 让 chat:stream 增量事件可被渲染层按请求过滤订阅
            // （画布智能体等工具循环的流式渲染据此区分自己的轮次，不干扰对话主链路）
            streamContext: requestId ? { requestId } : undefined
          },
          win
        )
        // 工具循环调用方需要 tool_calls，其余调用方保持只拿 content 字符串（向后兼容）
        return returnToolCalls
          ? { content: result.content, tool_calls: result.tool_calls, finish_reason: result.finish_reason, reasoning: result.reasoning }
          : result.content
      } finally {
        if (timer) clearTimeout(timer)
        if (requestId) llmAbortMap.delete(requestId)
      }
    }
  )

  ipcMain.handle('llm:cancel', (_, requestId: string) => {
    const ac = llmAbortMap.get(requestId)
    if (ac) {
      ac.abort()
      llmAbortMap.delete(requestId)
    }
  })

  // === Skills ===
  ipcMain.handle('skill:list', () => skillService.listSkills())
  ipcMain.handle('skill:get', (_, id: string) => skillService.getSkill(id))
  ipcMain.handle('skill:create', (_, data) => skillService.createSkill(data))
  ipcMain.handle('skill:update', (_, id: string, data) => skillService.updateSkill(id, data))
  ipcMain.handle('skill:delete', (_, id: string) => skillService.deleteSkill(id))
  ipcMain.handle('skill:presets', () => skillPresets)
  ipcMain.handle('skill:test', async (_, implementation: string, argsJson: string) => {
    let args = {}
    try { args = JSON.parse(argsJson || '{}') } catch {}
    return executeSkillSandbox(implementation, args)
  })
  ipcMain.handle('skill:export', (_, ids: string[]) => {
    const skills = ids.map((id) => skillService.getSkill(id)).filter(Boolean)
    return skills.map((s) => ({
      name: s!.name,
      description: s!.description,
      function_def: s!.function_def,
      implementation: s!.implementation,
      version: s!.version
    }))
  })
  // 单条独立 try/catch：重名失败时跳过该条继续处理后续，不让整批回滚。
  // 返回 { created, errors }：前端可分别提示成功条数 + 重名条目，体验比整批回滚友好得多。
  ipcMain.handle('skill:import', (_, dataArr: any[]) => {
    const created: any[] = []
    const errors: { name: string; reason: string }[] = []
    for (const data of dataArr) {
      try {
        const skill = skillService.createSkill({
          name: data.name,
          description: data.description || '',
          function_def: data.function_def || {},
          implementation: data.implementation || '',
          version: data.version || '1.0.0'
        })
        created.push(skill)
      } catch (e: any) {
        errors.push({
          name: data.name || data.function_def?.name || '未命名',
          reason: e?.message || String(e)
        })
      }
    }
    return { created, errors }
  })

  // === MCP Servers ===
  ipcMain.handle('mcp:list', () => mcpServerService.listMcpServers())
  ipcMain.handle('mcp:get', (_, id: string) => mcpServerService.getMcpServer(id))
  ipcMain.handle('mcp:create', (_, data) => mcpServerService.createMcpServer(data))
  ipcMain.handle('mcp:update', (_, id: string, data) => mcpServerService.updateMcpServer(id, data))
  ipcMain.handle('mcp:delete', (_, id: string) => mcpServerService.deleteMcpServer(id))
  ipcMain.handle('mcp:start', (_, id: string) => mcpServerService.startMcpServer(id))
  ipcMain.handle('mcp:stop', (_, id: string) => mcpServerService.stopMcpServer(id))
  ipcMain.handle('mcp:status', (_, id: string) => mcpServerService.getMcpServerRuntime(id))
  ipcMain.handle('mcp:refreshTools', (_, id: string) => mcpServerService.refreshMcpTools(id))

  // MCP 市场（第三方源拉取 + 安装到本地 mcp_servers 表）
  ipcMain.handle('mcpMarket:list', (_, source, page, pageSize) => listMarket(source, page, pageSize))
  ipcMain.handle('mcpMarket:search', (_, source, keyword, page, pageSize) =>
    searchMarket(source, keyword, page, pageSize)
  )
  ipcMain.handle('mcpMarket:detail', (_, source, id: string) => getMarketDetail(source, id))
  ipcMain.handle('mcpMarket:install', (_, detail, envOverrides) =>
    installFromMarket(detail, envOverrides)
  )

  // === Prompt Skills (SKILL.md) ===
  ipcMain.handle('promptSkill:list', () => promptSkillService.listPromptSkills())
  ipcMain.handle('promptSkill:getContent', (_, dirName: string) =>
    promptSkillService.getPromptSkillContent(dirName)
  )
  ipcMain.handle('promptSkill:toggle', (_, dirName: string, enabled: boolean) =>
    promptSkillService.togglePromptSkill(dirName, enabled)
  )
  ipcMain.handle('promptSkill:delete', (_, dirName: string) =>
    promptSkillService.deletePromptSkill(dirName)
  )
  ipcMain.handle('promptSkill:create', (_, name: string, description: string, content: string, overwrite?: boolean) =>
    promptSkillService.createPromptSkillFromContent(name, description, content, { overwrite: !!overwrite })
  )
  ipcMain.handle('promptSkill:getDir', () => promptSkillService.getSkillsDirectory())
  ipcMain.handle('promptSkill:installFromPath', async (_, sourcePath: string) => {
    const { installSkillFromLocal } = await import('../services/prompt-skill-installer')
    return installSkillFromLocal(sourcePath)
  })
  ipcMain.handle('promptSkill:catalog', async () => {
    const { refreshCloudSkillCatalog, getCachedCloudSkillCatalog } = await import('../services/cloud-skill-catalog')
    try {
      return await refreshCloudSkillCatalog()
    } catch {
      return getCachedCloudSkillCatalog()
    }
  })
  ipcMain.handle('promptSkill:installCloud', async (_, versionId: string) => {
    const { installCloudSkill } = await import('../services/cloud-skill-catalog')
    return installCloudSkill(versionId)
  })

  // === Data Directory ===
  ipcMain.handle('dataDir:get', () => dataPathService.getDataDir())
  ipcMain.handle('dataDir:isFirstLaunch', () => dataPathService.isFirstLaunch())
  // initDataDir / setDataDir 默认 activate=false，仅写 config 不切换运行时缓存。
  // 由 renderer 拿到 needsRelaunch 信号后弹"立即重启"对话框，避免本次会话数据切割。
  ipcMain.handle('dataDir:init', (_, dir?: string) => {
    const result = dataPathService.initDataDir(dir)
    if (!result.ok) return { ok: false, reason: result.reason }
    return { ok: true, needsRelaunch: !dataPathService.isDataDirActivated() }
  })
  ipcMain.handle('dataDir:set', async (_, dir: string) => {
    const result = dataPathService.setDataDir(dir)
    if (!result.ok) return { ok: false, reason: result.reason }
    return { ok: true, needsRelaunch: !dataPathService.isDataDirActivated() }
  })
  ipcMain.handle('dataDir:isActivated', () => dataPathService.isDataDirActivated())
  ipcMain.handle('dataDir:pick', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择数据存储目录',
      defaultPath: dataPathService.getDataDir(),
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  // === Data Migration ===
  ipcMain.handle('migration:check', () => dataPathService.checkMigration())
  ipcMain.handle('migration:start', async (event, options?: { conflictStrategy?: 'keep-existing' | 'overwrite' }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    // 关键：迁移会复制 sqlite db 文件，必须先关闭已打开的句柄，
    // 否则 Windows 文件锁会让 copyFileSync 失败，或写入正在使用的页缓存破坏一致性。
    // 迁移完成后调用方应触发 app:relaunch，让下次启动重新打开正确的 db。
    try { closeDatabase() } catch (e) { console.error('closeDatabase before migration failed:', e) }
    return dataPathService.migrateFiles((current, total, fileName) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('migration:progress', { current, total, fileName })
      }
    }, options)
  })
  ipcMain.handle('migration:deleteOld', () => dataPathService.deleteOldDir())
  ipcMain.handle('migration:skip', () => {
    dataPathService.skipMigration()
    return true
  })
  // 永久放弃旧数据目录记录（与 skip 区分：skip 仅本次不弹，下次启动仍提示）。
  ipcMain.handle('migration:abandon', () => {
    dataPathService.abandonOldDataDir()
    return true
  })

  // === App Lifecycle ===
  // 触发应用重启。用于：首次配置/设置页修改数据目录后，让 cachedDataDir 与 db 实例同步。
  ipcMain.handle('app:relaunch', () => {
    try { closeDatabase() } catch {}
    // 释放单实例锁，避免新实例抢锁失败而闪退（详见 account-context.performAccountSwitchRelaunch 注释）
    try { app.releaseSingleInstanceLock() } catch {}
    app.relaunch()
    app.exit(0)
  })

  // === Settings ===
  ipcMain.handle('settings:get', (_, key: string) => settingsService.getSetting(key))
  ipcMain.handle('settings:set', (_, key: string, value: string) =>
    settingsService.setSetting(key, value)
  )
  ipcMain.handle('settings:getAll', () => settingsService.getAllSettings())

  ipcMain.handle('python:status', () => pythonRuntime.detectPython(true))
  ipcMain.handle('python:ensure', () => pythonRuntime.ensurePython())
  ipcMain.handle('python:setPath', (_, filePath: string) => pythonRuntime.setPythonPath(String(filePath || '')))
  ipcMain.handle('python:clearOverride', () => pythonRuntime.clearPythonOverride())

  ipcMain.handle('distill:inspect', (_, conversationId: string) =>
    distillService.inspectDistill(String(conversationId || ''))
  )
  ipcMain.handle('distill:getMode', () => distillService.getDistillMode())
  ipcMain.handle('distill:setMode', (_, mode: distillService.DistillMode) =>
    distillService.setDistillMode(mode)
  )
  ipcMain.handle('distill:skip', (_, conversationId: string) =>
    distillService.skipDistill(String(conversationId || ''))
  )
  ipcMain.handle(
    'distill:run',
    async (event, payload: { conversationId: string; force?: boolean }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return distillService.runDistill(String(payload?.conversationId || ''), {
        force: !!payload?.force,
        window: win
      })
    }
  )

  // === Device Settings（设备级：root 级 device-settings.json，独立于按账号隔离的 settings 表）===
  ipcMain.handle('deviceSettings:get', (_, key: string) => deviceSettingsService.getDeviceSetting(key))
  ipcMain.handle('deviceSettings:set', (_, key: string, value: string) =>
    deviceSettingsService.setDeviceSetting(key, value)
  )

  // === Desktop prefs：开机自启 / 托盘 / 通知（P2-4）===
  ipcMain.handle('desktopPrefs:get', () => desktopPrefsService.getDesktopPrefs())
  ipcMain.handle(
    'desktopPrefs:update',
    (_, patch: Partial<desktopPrefsService.DesktopPrefs>) =>
      desktopPrefsService.updateDesktopPrefs(patch || {})
  )
  ipcMain.handle('desktopPrefs:testNotification', () => {
    notifyDesktop(`${appDisplayName()} 通知试听`, '若看到本条，说明桌面通知可用。', {
      force: true
    })
    return true
  })

  // === Vector Connection Test ===
  ipcMain.handle('settings:testVector', async (_, apiBase: string, apiKey: string, model: string) => {
    const url = apiBase.replace(/\/+$/, '') + '/embeddings'
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, input: ['test'] })
    })
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`${response.status}: ${errorText}`)
    }
    const data = await response.json()
    if (!data.data || !Array.isArray(data.data) || !data.data[0]?.embedding) {
      throw new Error('返回格式异常')
    }
    return { dimension: data.data[0].embedding.length }
  })

  // === Vectorize ===
  ipcMain.handle('vectorize:document', (event, knowledgeBaseId: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return vectorizeService.vectorizeDocument(knowledgeBaseId, window)
  })
  ipcMain.handle('vectorize:category', (event, categoryId: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return vectorizeService.vectorizeCategory(categoryId, window)
  })
  ipcMain.handle('vectorize:resetCategory', (event, categoryId: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return vectorizeService.resetAndVectorizeCategory(categoryId, window)
  })
  ipcMain.handle('vectorize:all', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return vectorizeService.vectorizeAll(window)
  })
  ipcMain.handle('vectorize:stats', () => vectorizeService.getVectorStatsForUI())
  ipcMain.handle('vectorize:chunkCount', (_, knowledgeBaseId: string) =>
    vectorStoreService.getChunkCountByKnowledgeBaseId(knowledgeBaseId)
  )
  ipcMain.handle('vectorize:checkModelMismatch', () =>
    vectorizeService.checkEmbeddingModelMismatch()
  )
  ipcMain.handle('vectorize:reembedAll', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return vectorizeService.reembedAll(window)
  })

  // === Usage Stats ===
  ipcMain.handle('usage:getAll', () => usageStatsService.getAllUsageStats())
  ipcMain.handle('usage:getProvider', (_, providerId: string) =>
    usageStatsService.getProviderUsageStats(providerId)
  )
  ipcMain.handle('usage:clear', (_, providerId?: string) =>
    usageStatsService.clearUsageStats(providerId)
  )

  // === Daily Review（P2-2） ===
  ipcMain.handle('dailyReview:list', () => dailyReviewService.listReviews())
  ipcMain.handle('dailyReview:get', (_, id: string) => dailyReviewService.getReview(id))
  ipcMain.handle('dailyReview:delete', (_, id: string) => dailyReviewService.deleteReview(id))
  ipcMain.handle('dailyReview:preview', (_, kind: 'daily' | 'deep') =>
    dailyReviewService.previewDigest(kind)
  )
  ipcMain.handle(
    'dailyReview:generate',
    async (
      _,
      payload: {
        kind: 'daily' | 'deep'
        providerId: string
        modelId: string
        rangeStart?: string
        rangeEnd?: string
      }
    ) => dailyReviewService.generateReview(payload)
  )

  // === Scheduled Tasks（P2-3） ===
  ipcMain.handle('scheduledTasks:list', () => scheduledTasksService.listTasks())
  ipcMain.handle('scheduledTasks:get', (_, id: string) => scheduledTasksService.getTask(id))
  ipcMain.handle('scheduledTasks:create', (_, payload: scheduledTasksService.CreateTaskInput) =>
    scheduledTasksService.createTask(payload)
  )
  ipcMain.handle('scheduledTasks:update', (_, id: string, patch: any) =>
    scheduledTasksService.updateTask(id, patch)
  )
  ipcMain.handle('scheduledTasks:delete', (_, id: string) => scheduledTasksService.deleteTask(id))
  ipcMain.handle('scheduledTasks:listRuns', (_, limit?: number) =>
    scheduledTasksService.listRuns(limit ?? 100)
  )
  ipcMain.handle('scheduledTasks:getRun', (_, id: string) => scheduledTasksService.getRun(id))
  ipcMain.handle('scheduledTasks:runNow', async (_, id: string) =>
    scheduledTasksService.executeTask(id, { manual: true })
  )
  ipcMain.handle('scheduledTasks:describeSchedule', (_, type: any, value: string) =>
    scheduledTasksService.describeSchedule(type, value)
  )

  ipcMain.handle('browser:listProfiles', () => browserAutomationService.listProfiles())
  ipcMain.handle('browser:createProfile', (_, name: string) => browserAutomationService.createProfile(name))
  ipcMain.handle('browser:renameProfile', (_, id: string, name: string) =>
    browserAutomationService.renameProfile(id, name)
  )
  ipcMain.handle('browser:deleteProfile', (_, id: string) => browserAutomationService.deleteProfile(id))
  ipcMain.handle('browser:openWindow', (_, profileId: string, url?: string) =>
    browserAutomationService.openWindow(profileId, url)
  )
  ipcMain.handle('browser:closeWindow', (_, profileId: string) => browserAutomationService.closeWindow(profileId))
  ipcMain.handle('browser:status', (_, profileId?: string) => browserAutomationService.getWindowStatus(profileId))

  // === Dialog ===
  ipcMain.handle('dialog:openFile', async (event, options) => {
    // 必须传 BrowserWindow 作为 parent：mac 上无 parent 的 dialog 偶发不可见 / 弹到屏幕外 /
    // 在某些会话状态下被 WindowServer 拒绝展示，导致「点击附件按钮没反应」。
    // 拿不到 parent 时退化为独立模态（与原行为兼容）。
    try {
      const parent = BrowserWindow.fromWebContents(event.sender)
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      return result
    } catch (e: any) {
      console.error('[dialog:openFile] failed:', e?.message || e)
      return { canceled: true, filePaths: [], error: e?.message || String(e) }
    }
  })

  // === 原生提示框：替代渲染层 window.alert/confirm ===
  // Electron 在 Windows 上有已知 bug：renderer 调用原生 alert/confirm 关闭后，父窗口收不回
  // 键盘焦点，导致随后点击输入框有光标却无法输入（智能体编辑、模板保存等表单均受影响）。
  // 改用主进程 dialog.showMessageBoxSync（不触发该 bug）+ sendSync 保持同步语义，渲染层零改动。
  ipcMain.on('dialog:alert', (event, message: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      type: 'info' as const,
      buttons: ['确定'],
      defaultId: 0,
      noLink: true,
      message: String(message ?? '')
    }
    if (win) dialog.showMessageBoxSync(win, options)
    else dialog.showMessageBoxSync(options)
    event.returnValue = true
  })
  ipcMain.on('dialog:confirm', (event, message: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      type: 'question' as const,
      buttons: ['确定', '取消'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      message: String(message ?? '')
    }
    const index = win ? dialog.showMessageBoxSync(win, options) : dialog.showMessageBoxSync(options)
    event.returnValue = index === 0
  })

  // === Shell ===
  // 已打开的外部页面窗口（按 URL 单例聚焦；窗口 closed 时剔除）。注册函数只执行一次，模块语义正确。
  const externalMenuWindows = new Map<string, InstanceType<typeof BrowserWindow>>()

  /**
   * https 证书预检（Node tls，独立于 Chromium 网络栈——进程级 ignore-certificate-errors 不影响）。
   * 返回 'ok'（证书有效）/ 'cert'（证书校验失败，应拦截）/ 'network'（网络类失败，交给 loadURL 错误反馈）。
   */
  function checkExternalCertificate(hostname: string, port: number): Promise<'ok' | 'cert' | 'network'> {
    const tls = require('tls')
    return new Promise((resolve) => {
      let settled = false
      const done = (r: 'ok' | 'cert' | 'network') => {
        if (!settled) {
          settled = true
          resolve(r)
        }
      }
      try {
        const socket = tls.connect(
          { host: hostname, port, servername: hostname, rejectUnauthorized: true },
          () => {
            socket.end()
            done('ok')
          }
        )
        socket.setTimeout(8000, () => {
          socket.destroy()
          done('network')
        })
        socket.on('error', (e: any) => {
          const code = String(e?.code || '')
          const text = `${code} ${e?.message || ''}`
          // 证书类失败特征：CERT_* / UNABLE_TO_* / DEPTH_* / expired / self signed 等
          done(/cert|unable|depth|expired|self.?signed/i.test(text) ? 'cert' : 'network')
        })
      } catch {
        done('network')
      }
    })
  }

  ipcMain.handle('shell:openPath', async (_, path: string) => {
    const { shell } = require('electron')
    const { existsSync } = require('fs')
    // shell.openPath 返回 Promise<string>：空串=成功，非空=错误。统一加日志方便 mac 排查。
    if (!path) {
      console.error('[shell:openPath] empty path')
      return 'empty path'
    }
    if (!existsSync(path)) {
      console.error('[shell:openPath] path not found:', path)
      return `path not found: ${path}`
    }
    try {
      const errMsg = await shell.openPath(path)
      if (errMsg) console.error('[shell:openPath]', path, '→', errMsg)
      return errMsg
    } catch (e: any) {
      const msg = e?.message || String(e)
      console.error('[shell:openPath] exception:', path, msg)
      return msg
    }
  })
  ipcMain.handle('shell:showItemInFolder', async (_, path: string) => {
    const { shell } = require('electron')
    const { existsSync } = require('fs')
    const nodePath = require('path')
    if (!path) {
      console.error('[shell:showItemInFolder] empty path')
      return { success: false, error: 'empty path' }
    }
    // 相对路径（不以盘符或 / 开头）→ 拼接数据目录得到绝对路径
    let resolved = path
    if (!/^[A-Za-z]:|^\//.test(resolved)) {
      resolved = nodePath.join(dataPathService.getDataDir(), resolved)
    }
    console.log('[shell:showItemInFolder] resolved:', resolved)
    if (existsSync(resolved)) {
      try {
        shell.showItemInFolder(resolved)
        return { success: true, path: resolved }
      } catch (e: any) {
        console.error('[shell:showItemInFolder] exception:', resolved, e?.message || e)
        return { success: false, path: resolved, error: e?.message || String(e) }
      }
    }
    // 目标文件已被移动/删除：mac 上 showItemInFolder 对不存在路径静默无响应，
    // 退化为打开父目录，至少让用户看到所在文件夹的位置。
    console.warn('[shell:showItemInFolder] target missing, fallback to parent dir')
    const parent = nodePath.dirname(resolved)
    if (existsSync(parent)) {
      try {
        const errMsg = await shell.openPath(parent)
        if (errMsg) {
          console.error('[shell:showItemInFolder] openPath(parent) failed:', parent, errMsg)
          return { success: false, path: resolved, error: `target not found; opening folder failed: ${errMsg}` }
        }
        return { success: true, path: parent, fallback: 'parent' }
      } catch (e: any) {
        return { success: false, path: resolved, error: e?.message || String(e) }
      }
    }
    return { success: false, path: resolved, error: 'target and parent both missing' }
  })
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    // 主进程侧协议白名单（纵深防御）：只把 http(s)/mailto/tel 交系统默认程序，
    // 拦掉 javascript:/data:/file: 等危险协议，避免渲染层绕过后被利用
    try {
      const proto = new URL(String(url)).protocol
      if (!['http:', 'https:', 'mailto:', 'tel:'].includes(proto)) return false
    } catch {
      return false
    }
    const { shell } = require('electron')
    return shell.openExternal(url)
  })
  // 云控端自定义菜单「应用内窗口」打开方式：以独立隔离 BrowserWindow 加载外部页面。
  // 安全基线：无 preload（页面拿不到任何特权 API）、nodeIntegration 关、contextIsolation + sandbox 开；
  // session 用独立持久分区（与主窗口 defaultSession 隔离 cookie/缓存——也因此不受主窗口
  // onHeadersReceived 注入的 SPA CSP 影响，外部页面按其自身响应头正常加载）。
  ipcMain.handle('shell:openExternalWindow', async (_, url: string, title?: string) => {
    let parsed: URL
    try {
      parsed = new URL(String(url))
    } catch {
      return { success: false, error: 'invalid url' }
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { success: false, error: 'only http(s) allowed' }
    }
    const { shell } = require('electron')
    // 同一 URL 已开窗则聚焦不新建（防连点同菜单项开 N 个相同窗口）
    const existing = externalMenuWindows.get(url)
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
      return { success: true, reused: true }
    }
    // https 证书预检：进程级 ignore-certificate-errors 开关存在期间，窗口内加载任意外站的
    // 证书错误（过期/自签/被劫持）会被静默放行——Node tls 独立于 Chromium 网络栈，不受该开关影响，
    // 在开窗前先做一次真实校验。网络类失败（DNS/超时）不拦截，交给 loadURL 的错误反馈处理。
    if (parsed.protocol === 'https:') {
      const cert = await checkExternalCertificate(parsed.hostname, Number(parsed.port) || 443)
      if (cert === 'cert') {
        return { success: false, error: '该站点的 HTTPS 证书无效或已过期，为安全起见已阻止打开' }
      }
    }
    const win = new BrowserWindow({
      width: 1100,
      height: 760,
      title: (title && String(title).slice(0, 60)) || parsed.hostname,
      autoHideMenuBar: true,
      // 原生标题栏（frame 默认 true）：外部页面窗口的最小化/关闭/拖拽交给系统，亦与主 SPA 视觉区隔
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'persist:external-menu-pages'
      }
    })
    externalMenuWindows.set(url, win)
    win.on('closed', () => {
      if (externalMenuWindows.get(url) === win) externalMenuWindows.delete(url)
    })
    // 固定窗口标题为管理端配置值（默认行为会被页面 document.title 经 page-title-updated 覆盖）
    win.on('page-title-updated', (e) => e.preventDefault())
    // 窗口内导航守卫：同 host（含其子域）放行窗内导航，其余一律交系统浏览器——
    // 防止窗内被带去无关站点（用户对应用内窗口的信任高于浏览器地址栏场景）。
    // will-navigate（用户点击/JS 跳转）与 will-redirect（服务端 302 逐跳）都要挂——
    // 只挂前者会被「目标页 302 到外域」绕过（短链、SSO、域名迁移场景）。
    // 注：跨域 SSO 登录跳转会在浏览器打开，属可接受的保守行为。
    const allowedHost = parsed.hostname
    const isAllowedNav = (navUrl: string): boolean => {
      try {
        const u = new URL(navUrl)
        if (!['http:', 'https:'].includes(u.protocol)) return false
        return u.hostname === allowedHost || u.hostname.endsWith('.' + allowedHost)
      } catch {
        return false
      }
    }
    const navGuard = (event: any, navUrl: string) => {
      if (isAllowedNav(navUrl)) return
      event.preventDefault()
      try {
        const p = new URL(navUrl).protocol
        if (['http:', 'https:', 'mailto:', 'tel:'].includes(p)) shell.openExternal(navUrl)
      } catch { /* 非法协议忽略 */ }
    }
    win.webContents.on('will-navigate', navGuard)
    win.webContents.on('will-redirect', navGuard)
    // window.open / target=_blank：一律系统浏览器（窗口内只允许同域原地导航）
    win.webContents.setWindowOpenHandler((details) => {
      try {
        const p = new URL(details.url).protocol
        if (['http:', 'https:', 'mailto:', 'tel:'].includes(p)) shell.openExternal(details.url)
      } catch { /* 非法协议忽略 */ }
      return { action: 'deny' }
    })
    win.loadURL(url).catch((e: any) => {
      // 加载失败（DNS/超时/证书错误等）：关窗并给可见反馈，避免白屏窗口留着用户不知所措
      console.error('[shell:openExternalWindow] loadURL failed:', url, e?.message || e)
      try {
        if (!win.isDestroyed()) win.close()
      } catch { /* 窗口已销毁则忽略 */ }
      try {
        const { dialog } = require('electron')
        dialog.showErrorBox('无法打开页面', `加载外部页面失败：${url}\n${e?.message || e}`)
      } catch { /* dialog 不可用时静默 */ }
    })
    return { success: true }
  })

  // === Image Generation Sessions ===
  ipcMain.handle('imageGen:listSessions', () => imageSessionService.listImageSessions())
  ipcMain.handle('imageGen:getSession', (_, id: string) => imageSessionService.getImageSession(id))
  ipcMain.handle('imageGen:createSession', (_, data?) => imageSessionService.createImageSession(data))
  ipcMain.handle('imageGen:updateSession', (_, id: string, data) =>
    imageSessionService.updateImageSession(id, data)
  )
  ipcMain.handle('imageGen:deleteSession', (_, id: string) =>
    imageSessionService.deleteImageSession(id)
  )

  // === Image Generations ===
  ipcMain.handle('imageGen:listGenerations', (_, sessionId: string) =>
    imageGenService.listGenerations(sessionId)
  )
  ipcMain.handle('imageGen:listRecentGenerations', (_, limit?: number) =>
    imageGenService.listRecentGenerations(limit)
  )
  ipcMain.handle('imageGen:listAllGenerations', (_, page: number, pageSize: number, search?: string, startDate?: string, endDate?: string) =>
    imageGenService.listAllGenerations(page, pageSize, search, startDate, endDate)
  )
  ipcMain.handle('imageGen:generate', (event, options) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return imageGenService.generateImages(options, window)
  })
  ipcMain.handle('imageGen:cancelGeneration', (_, genId: string) =>
    imageGenService.cancelGeneration(genId)
  )
  ipcMain.handle('imageGen:cancelGenerations', (_, genIds: string[]) =>
    imageGenService.cancelGenerations(genIds)
  )
  ipcMain.handle('imageGen:deleteGeneration', (_, id: string) =>
    imageGenService.deleteGeneration(id)
  )
  ipcMain.handle('imageGen:deleteGenerations', (_, ids: string[]) =>
    imageGenService.deleteGenerations(ids)
  )
  ipcMain.handle('imageGen:countFailedGenerations', () =>
    imageGenService.countFailedGenerations()
  )
  ipcMain.handle('imageGen:clearFailedGenerations', () =>
    imageGenService.clearFailedGenerations()
  )
  ipcMain.handle('imageGen:preloadThumbnails', (_, paths: string[]) =>
    thumbnailService.preloadThumbnails((paths || []).map((p) => imageGenService.getAbsolutePath(p)))
  )

  ipcMain.handle('imageGen:getGeneration', (_, id: string) =>
    imageGenService.getGeneration(id)
  )
  ipcMain.handle('imageGen:getByResultPath', (_, resultPath: string) =>
    imageGenService.getGenerationByResultPath(resultPath)
  )
  ipcMain.handle('imageGen:saveEditedImage', (_, id: string, base64Data: string) =>
    imageGenService.saveEditedImage(id, base64Data)
  )
  ipcMain.handle('imageGen:saveLocalEdited', (_, sourcePath: string, base64Data: string) =>
    imageGenService.saveLocalEdited(sourcePath, base64Data)
  )
  ipcMain.handle('imageGen:getAbsolutePath', (_, relPath: string) =>
    imageGenService.getAbsolutePath(relPath)
  )

  ipcMain.handle('imageExport:saveBuffer', (event, options) =>
    imageExportService.saveBufferWithDialog(event, options)
  )
  ipcMain.handle('imageExport:saveProject', (event, payload) =>
    imageExportService.saveProjectWithDialog(event, payload)
  )
  ipcMain.handle('imageExport:openProject', (event) =>
    imageExportService.openProjectWithDialog(event)
  )
  // 旧预加载没有 imageExport 时，走已有的 imageGen.invoke 转发
  ipcMain.handle('imageGen:saveExportBuffer', (event, options) =>
    imageExportService.saveBufferWithDialog(event, options)
  )
  ipcMain.handle('imageGen:saveExportProject', (event, payload) =>
    imageExportService.saveProjectWithDialog(event, payload)
  )
  ipcMain.handle('imageGen:openExportProject', (event) =>
    imageExportService.openProjectWithDialog(event)
  )
  ipcMain.handle('imageExport:writeTempPng', (_event, dataUrl: string) =>
    imageExportService.writeTempPngFromDataUrl(dataUrl)
  )
  ipcMain.handle('imageGen:writeTempPng', (_event, dataUrl: string) =>
    imageExportService.writeTempPngFromDataUrl(dataUrl)
  )

  // 通用「按顺序导出」：把内存态结果图（电商工具等非画布 project）按列表顺序复制到
  // 用户选定目录，文件名 = {NN}-{label}.{ext}，序号前缀保证资源管理器内顺序稳定。
  // items: [{ path: result_path（相对/绝对均可）, name: 语义标签 }]
  ipcMain.handle(
    'imageGen:exportImages',
    async (event, items: { path: string; name: string }[]) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { success: false, error: '窗口不可用' }
      const list = (Array.isArray(items) ? items : []).filter((it) => it && it.path)
      if (!list.length) return { success: false, error: '没有可导出的图片' }

      const picked = await dialog.showOpenDialog(win, {
        title: '选择导出目录',
        properties: ['openDirectory', 'createDirectory']
      })
      if (picked.canceled || !picked.filePaths?.[0]) return { success: false, canceled: true }

      const targetDir = picked.filePaths[0]
      const { copyFileSync, existsSync, mkdirSync } = require('fs') as typeof import('fs')
      const { join, extname } = require('path') as typeof import('path')
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })

      const sanitize = (s: string): string =>
        ((s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'image').slice(0, 80)
      const used = new Set<string>()
      const files: string[] = []
      let exported = 0
      list.forEach((it, i) => {
        const abs = imageGenService.getAbsolutePath(it.path)
        if (!existsSync(abs)) return
        const ext = extname(abs).replace('.', '').toLowerCase() || 'png'
        const seq = String(i + 1).padStart(2, '0')
        let name = `${seq}-${sanitize(it.name)}.${ext}`
        if (used.has(name)) {
          const base = name.slice(0, name.length - ext.length - 1)
          let k = 2
          while (used.has(`${base}(${k}).${ext}`)) k++
          name = `${base}(${k}).${ext}`
        }
        used.add(name)
        try {
          copyFileSync(abs, join(targetDir, name))
          files.push(name)
          exported++
        } catch (e) {
          console.error('[imageGen:exportImages] copy failed:', abs, '→', name, e)
        }
      })
      return { success: true, dir: targetDir, exported, total: list.length, files }
    }
  )

  // === Creative Templates（v0.7.7+：本地分类/模板 CRUD + 云端模板拉取） ===
  // 本地模板存在 dataDir 的 sqlite；云端模板走云控端 /public/creative-templates/*
  ipcMain.handle('creativeTemplate:listCategories', () =>
    creativeTemplateService.listCategories()
  )
  ipcMain.handle('creativeTemplate:createCategory', (_, data) =>
    creativeTemplateService.createCategory(data)
  )
  ipcMain.handle('creativeTemplate:updateCategory', (_, id: string, data) =>
    creativeTemplateService.updateCategory(id, data)
  )
  ipcMain.handle('creativeTemplate:deleteCategory', (_, id: string) =>
    creativeTemplateService.deleteCategory(id)
  )
  ipcMain.handle('creativeTemplate:list', (_, options?) =>
    creativeTemplateService.listTemplates(options)
  )
  ipcMain.handle('creativeTemplate:get', (_, id: string) =>
    creativeTemplateService.getTemplate(id)
  )
  ipcMain.handle('creativeTemplate:create', (_, data) =>
    creativeTemplateService.createTemplate(data)
  )
  ipcMain.handle('creativeTemplate:update', (_, id: string, data) =>
    creativeTemplateService.updateTemplate(id, data)
  )
  ipcMain.handle('creativeTemplate:delete', (_, id: string) =>
    creativeTemplateService.deleteTemplate(id)
  )
  ipcMain.handle('creativeTemplate:importLocal', (_, source, targetCategoryId: string) =>
    creativeTemplateService.importTemplateAsLocal(source, targetCategoryId)
  )
  ipcMain.handle('creativeTemplate:render', (_, id: string, values: Record<string, unknown>) => {
    const t = creativeTemplateService.getTemplate(id)
    if (!t) return { ok: false, error: 'not_found' as const }
    const missing = creativeTemplateService.findMissingRequired(t, values || {})
    const prompt = creativeTemplateService.renderTemplatePrompt(t, values || {})
    return { ok: true as const, prompt, missing, default_size: t.default_size, example_ref_images: t.example_ref_images, requires_ref_image: t.requires_ref_image }
  })
  // 云端模板（公开接口）
  ipcMain.handle('creativeTemplate:cloudCategories', () =>
    cloudCreativeTemplateService.fetchCloudCategories()
  )
  ipcMain.handle('creativeTemplate:cloudList', (_, options?) =>
    cloudCreativeTemplateService.fetchCloudTemplates(options)
  )
  ipcMain.handle('creativeTemplate:cloudGet', (_, id: number) =>
    cloudCreativeTemplateService.fetchCloudTemplate(id)
  )

  // 风格预设（云端分发，拉取失败自动回落本地缓存）
  ipcMain.handle('stylePreset:list', () =>
    stylePresetService.getStylePresets()
  )
  ipcMain.handle('creativeTemplate:submitToCloud', (_, params: { templateId: string; cloudCategoryId: number }) =>
    cloudCreativeTemplateSubmitService.submitCreativeTemplate(params)
  )
  ipcMain.handle('creativeTemplate:syncSubmissionStatus', (_, templateIds: string[]) =>
    cloudCreativeTemplateSubmitService.syncCreativeTemplateSubmissionStatus(templateIds)
  )
  ipcMain.handle('creativeTemplate:withdrawSubmission', (_, templateId: string) =>
    cloudCreativeTemplateSubmitService.withdrawCreativeTemplateSubmission(templateId)
  )

  // === Inspirations ===
  ipcMain.handle('imageGen:listInspirations', (_, options?) =>
    inspirationService.listInspirations(options)
  )
  ipcMain.handle('imageGen:getInspiration', (_, id: string) =>
    inspirationService.getInspiration(id)
  )
  ipcMain.handle('imageGen:fetchOnlineInspirations', (_, options?) =>
    inspirationService.fetchOnlineInspirations(options)
  )
  ipcMain.handle('imageGen:getInspirationCategories', () =>
    inspirationService.getInspirationCategories()
  )

  // === Prompt Presets ===
  ipcMain.handle('promptPreset:listCategories', (_, type?: string) =>
    promptPresetService.listCategories(type)
  )
  ipcMain.handle('promptPreset:createCategory', (_, data) =>
    promptPresetService.createCategory(data)
  )
  ipcMain.handle('promptPreset:updateCategory', (_, id: string, data) =>
    promptPresetService.updateCategory(id, data)
  )
  ipcMain.handle('promptPreset:deleteCategory', (_, id: string) =>
    promptPresetService.deleteCategory(id)
  )
  ipcMain.handle('promptPreset:listPresets', (_, type?: string) =>
    promptPresetService.listPresets(type)
  )
  ipcMain.handle('promptPreset:listByCategory', (_, categoryId: string) =>
    promptPresetService.listPresetsByCategory(categoryId)
  )
  ipcMain.handle('promptPreset:createPreset', (_, data) =>
    promptPresetService.createPreset(data)
  )
  ipcMain.handle('promptPreset:updatePreset', (_, id: string, data) =>
    promptPresetService.updatePreset(id, data)
  )
  ipcMain.handle('promptPreset:deletePreset', (_, id: string) =>
    promptPresetService.deletePreset(id)
  )

  // === Clipboard ===
  ipcMain.handle('clipboard:writeImage', async (_, filePath: string) => {
    try {
      const { existsSync } = require('fs') as typeof import('fs')
      const { resolve } = require('path') as typeof import('path')

      let absPath = filePath
      if (!/^[A-Za-z]:/.test(filePath) && !filePath.startsWith('/')) {
        absPath = resolve(dataPathService.getDataDir(), filePath)
      }
      if (!existsSync(absPath)) return { success: false, error: '文件不存在' }

      const img = nativeImage.createFromPath(absPath)
      if (img.isEmpty()) return { success: false, error: '无法读取图片' }
      clipboard.writeImage(img)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) }
    }
  })

  // === Backup ===
  //
  // 进度事件统一通过 'backup:progress' channel 发送 ProgressEvent 对象。
  // 取消由 'backup:cancel' channel 触发，主进程 service 内部维护单一 token。
  // 恢复成功后强制 relaunch，避免 service 在新 db 上跑 migration+seed 污染恢复结果。

  /**
   * 恢复完成后重启应用。
   *
   * 关键：必须显式停止 MCP 子进程 + 关闭 db，再 relaunch + exit。
   * `app.exit(0)` 不会触发 'before-quit' 事件，所以原本绑定在那里的清理逻辑都被跳过：
   *   - MCP 子进程会变成孤儿进程残留在系统里
   *   - SQLite 句柄虽然被 OS 回收但跳过了 close 流程
   * 这里手动复刻 before-quit 的行为，保证恢复后的新进程能干净启动。
   */
  function relaunchAfterRestore(): void {
    try { stopAllMcpServers() } catch (e) { console.error('[restore] stopAllMcpServers failed:', e) }
    try { closeDatabase() } catch (e) { console.error('[restore] closeDatabase failed:', e) }
    // 释放单实例锁，避免新实例抢锁失败而闪退
    try { app.releaseSingleInstanceLock() } catch (e) { console.error('[restore] release lock failed:', e) }
    app.relaunch()
    app.exit(0)
  }

  function makeProgressForwarder(event: Electron.IpcMainInvokeEvent) {
    const win = BrowserWindow.fromWebContents(event.sender)
    return (ev: backupService.ProgressEvent) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('backup:progress', ev)
      }
    }
  }

  ipcMain.handle('backup:list', () => backupService.listBackups())

  ipcMain.handle('backup:db', (event) => {
    return backupService.backupDatabase(makeProgressForwarder(event))
  })

  ipcMain.handle('backup:full', (event) => {
    return backupService.backupFull(makeProgressForwarder(event))
  })

  ipcMain.handle('backup:cancel', () => backupService.cancelCurrent())

  ipcMain.handle('backup:verify', (_, fileName: string) =>
    backupService.verifyBackup(fileName)
  )

  ipcMain.handle('backup:restore', async (event, fileName: string) => {
    const result = await backupService.restoreFromRecord(fileName, makeProgressForwarder(event))
    // 恢复成功必须 relaunch，否则 services 调 getDatabase() 会在恢复后的 db 上跑 migration+seed 污染数据
    if (result.success) {
      setTimeout(() => {
        try { closeDatabase() } catch {}
        // 释放单实例锁，避免新实例抢锁失败而闪退
        try { app.releaseSingleInstanceLock() } catch {}
        app.relaunch()
        app.exit(0)
      }, 200)
    }
    return result
  })

  ipcMain.handle('backup:restoreFromExternal', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { success: false, error: '窗口不可用' }
    const picked = await dialog.showOpenDialog(win, {
      title: '选择备份文件',
      filters: [{ name: '好伙伴备份', extensions: ['zip'] }],
      properties: ['openFile']
    })
    if (picked.canceled || picked.filePaths.length === 0) {
      return { success: false, error: 'cancelled' }
    }
    const result = await backupService.restoreFromExternal(
      picked.filePaths[0],
      makeProgressForwarder(event)
    )
    if (result.success) {
      setTimeout(() => relaunchAfterRestore(), 200)
    }
    return result
  })

  ipcMain.handle('backup:exportTo', async (event, fileName: string) => {
    // IPC 层只负责弹保存对话框，文件复制委托给 backup service
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { success: false, error: '窗口不可用' }
    const picked = await dialog.showSaveDialog(win, {
      title: '导出备份',
      defaultPath: fileName,
      filters: [{ name: '好伙伴备份', extensions: ['zip'] }]
    })
    if (picked.canceled || !picked.filePath) {
      return { success: false, error: 'cancelled' }
    }
    const result = backupService.exportBackupTo(fileName, picked.filePath)
    return result.success
      ? { success: true, exportedPath: picked.filePath }
      : { success: false, error: result.error }
  })

  ipcMain.handle('backup:delete', (_, fileName: string) => backupService.deleteBackup(fileName))

  ipcMain.handle('backup:getSettings', () => backupService.getSettings())
  ipcMain.handle(
    'backup:setSettings',
    (_, interval: backupService.BackupSettings['interval'], maxCount: number) => {
      try {
        backupService.setSettings({ interval, maxCount })
        return { success: true }
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) }
      }
    }
  )

  // === Window Controls ===
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })
  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.on('window:setTitleBarOverlay', (event, options: { color: string; symbolColor: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      try {
        win.setTitleBarOverlay({ color: options.color, symbolColor: options.symbolColor, height: 36 })
      } catch (e) {
        console.error('setTitleBarOverlay error:', e)
      }
    }
  })

  // === Canvas ===
  ipcMain.handle('canvas:listProjects', () => canvasService.listProjects())
  ipcMain.handle('canvas:getProject', (_, id: string) => canvasService.getProject(id))
  ipcMain.handle('canvas:createProject', (_, data) => canvasService.createProject(data))
  ipcMain.handle('canvas:updateProject', (_, id: string, data) => canvasService.updateProject(id, data))
  ipcMain.handle('canvas:deleteProject', (_, id: string) => canvasService.deleteProject(id))
  ipcMain.handle('canvas:listNodes', (_, projectId: string) => canvasService.listNodes(projectId))
  ipcMain.handle('canvas:getNode', (_, id: string) => canvasService.getNode(id))
  ipcMain.handle('canvas:createNode', (_, projectId: string, data) => canvasService.createNode(projectId, data))
  ipcMain.handle('canvas:updateNode', (_, id: string, data) => canvasService.updateNode(id, data))
  ipcMain.handle('canvas:updateNodePositions', (_, updates) => canvasService.updateNodePositions(updates))
  ipcMain.handle('canvas:deleteNode', (_, id: string) => {
    canvasService.deleteEdgesByNodeId(id)
    return canvasService.deleteNode(id)
  })
  ipcMain.handle('canvas:listEdges', (_, projectId: string) => canvasService.listEdges(projectId))
  ipcMain.handle('canvas:createEdge', (_, projectId: string, data) => canvasService.createEdge(projectId, data))
  ipcMain.handle('canvas:deleteEdge', (_, id: string) => canvasService.deleteEdge(id))
  ipcMain.handle('canvas:saveProjectState', (_, projectId: string, nodes) => canvasService.saveProjectState(projectId, nodes))
  ipcMain.handle('canvas:saveNodeImage', (_, projectId: string, nodeId: string, dataUrl: string) =>
    canvasService.saveNodeImage(projectId, nodeId, dataUrl)
  )
  ipcMain.handle('canvas:saveNodeResultImage', (_, projectId: string, nodeId: string, dataUrl: string) =>
    canvasService.saveNodeResultImage(projectId, nodeId, dataUrl)
  )
  ipcMain.handle('canvas:saveNodeVideo', (_, projectId: string, nodeId: string, sourcePath: string) =>
    canvasService.saveNodeVideo(projectId, nodeId, sourcePath)
  )
  ipcMain.handle('canvas:saveNodeFrames', (_, projectId: string, nodeId: string, frames: Array<{ id: string; dataUrl: string }>) =>
    canvasService.saveNodeFrames(projectId, nodeId, Array.isArray(frames) ? frames : [])
  )
  // 画布智能体节点：本地知识库「直接检索」（不经对话工具循环），返回命中片段供节点前置拼接
  ipcMain.handle('canvas:searchLocalKB', async (_, query: string, categoryIds: string[], topK?: number) => {
    const { searchLocalKb } = await import('../services/kb-local-search')
    return searchLocalKb(String(query || ''), Array.isArray(categoryIds) ? categoryIds : [], Number(topK) || 5)
  })
  // 画布助手对话持久化：按画布存/取一个 JSON blob（刷新/重开画布后载回）
  ipcMain.handle('canvas:getAgentChat', (_, projectId: string) => canvasService.getAgentChat(String(projectId)))
  ipcMain.handle('canvas:saveAgentChat', (_, projectId: string, data: string) => {
    canvasService.saveAgentChat(String(projectId), String(data || ''))
    return true
  })
  ipcMain.handle('canvas:listCharacters', (_, projectId: string) => canvasService.listCharacters(projectId))
  ipcMain.handle('canvas:createCharacter', (_, projectId: string, data: any) => canvasService.createCharacter(projectId, data || {}))
  ipcMain.handle('canvas:deleteCharacter', (_, id: string) => canvasService.deleteCharacter(id))
  ipcMain.handle('canvas:cloneCharacters', (_, sourceProjectId: string, targetProjectId: string) =>
    canvasService.cloneCharacters(sourceProjectId, targetProjectId)
  )
  ipcMain.handle('canvas:deleteNodeImage', (_, projectId: string, nodeId: string) =>
    canvasService.deleteNodeImage(projectId, nodeId)
  )

  // v0.6.9+ 打开画布的独立图片文件夹：getProjectImageDir 会保证目录存在（mkdir -p），
  // 因此即使该画布从未生成 / 上传过图片，按钮也能打开一个空目录给用户看路径。
  // 返回 { success, dir, error? } 让 renderer 显示具体反馈。
  ipcMain.handle('canvas:openProjectImageDir', async (_, projectId: string) => {
    if (!projectId) return { success: false, error: '画布 ID 为空' }
    try {
      const { shell } = require('electron')
      const dir = canvasService.getProjectImageDir(projectId)
      const errMsg = await shell.openPath(dir)
      if (errMsg) {
        console.error('[canvas:openProjectImageDir]', dir, '→', errMsg)
        return { success: false, dir, error: errMsg }
      }
      return { success: true, dir }
    } catch (e: any) {
      console.error('[canvas:openProjectImageDir] exception:', e)
      return { success: false, error: e?.message || String(e) }
    }
  })

  // 按序导出画布图片：弹选目录对话框 → 把出图节点当前图片按 #N 序号复制为 {类型名}-{NN}.{ext}。
  // 序号与画布节点徽章一致，方便用户在目录里按顺序取用（做视频 / PPT / 交付等）。
  ipcMain.handle('canvas:exportImages', async (event, projectId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { success: false, error: '窗口不可用' }
    if (!projectId) return { success: false, error: '画布 ID 为空' }

    // 先收集清单：没有可导出的图就别弹对话框，直接提示
    let plan: ReturnType<typeof canvasService.collectProjectImageExports>
    try {
      plan = canvasService.collectProjectImageExports(projectId)
    } catch (e: any) {
      return { success: false, error: e?.message || '读取画布失败' }
    }
    if (!plan.length) {
      return { success: false, error: '该画布没有可导出的生成图片' }
    }

    const picked = await dialog.showOpenDialog(win, {
      title: '选择导出目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (picked.canceled || !picked.filePaths?.[0]) {
      return { success: false, canceled: true }
    }

    try {
      const result = canvasService.exportProjectImagesTo(projectId, picked.filePaths[0])
      return { success: true, dir: picked.filePaths[0], ...result }
    } catch (e: any) {
      return { success: false, error: e?.message || '导出失败' }
    }
  })

  // 流式画布导出：弹保存对话框 → 写 .lacanvas.json 文件
  // 仅 prompt + 节点结构，不打包图片字节，跨设备分享用
  ipcMain.handle('canvas:exportProjects', async (event, ids: string[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { success: false, error: '窗口不可用' }
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return { success: false, error: '未选中项目' }
    }

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const defaultName = ids.length === 1
      ? `画布-${stamp}.lacanvas.json`
      : `画布-${ids.length}个-${stamp}.lacanvas.json`

    const picked = await dialog.showSaveDialog(win, {
      title: '导出流式画布',
      defaultPath: defaultName,
      filters: [
        { name: 'Local Agent 画布', extensions: ['lacanvas.json', 'json'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    })
    if (picked.canceled || !picked.filePath) {
      return { success: false, canceled: true }
    }

    try {
      const file = canvasService.exportProjects(ids, app.getVersion())
      const { writeFileSync } = require('fs') as typeof import('fs')
      writeFileSync(picked.filePath, JSON.stringify(file, null, 2), 'utf-8')
      return {
        success: true,
        filePath: picked.filePath,
        projectCount: file.projects.length,
      }
    } catch (e: any) {
      return { success: false, error: e?.message || '导出失败' }
    }
  })

  // 流式画布导入：弹打开对话框 → 读 JSON → 在本机生成新项目
  // 永远生成新 UUID + 新标题（带导入后缀），不覆盖已有项目
  ipcMain.handle('canvas:importProjects', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { success: false, error: '窗口不可用' }

    const picked = await dialog.showOpenDialog(win, {
      title: '导入流式画布',
      filters: [
        { name: 'Local Agent 画布', extensions: ['lacanvas.json', 'json'] },
        { name: '全部文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    try {
      const { readFileSync } = require('fs') as typeof import('fs')
      const raw = readFileSync(picked.filePaths[0], 'utf-8')
      const parsed = JSON.parse(raw)
      const result = canvasService.importProjects(parsed)
      return { success: true, ...result }
    } catch (e: any) {
      return { success: false, error: e?.message || '导入失败' }
    }
  })

  // === Agent Workspaces (D-21 文件夹工作区) ===
  ipcMain.handle('agentWorkspace:list', () => agentWorkspaceService.listWorkspaces())
  ipcMain.handle('agentWorkspace:getActive', () => agentWorkspaceService.getActiveWorkspace())
  ipcMain.handle('agentWorkspace:setActive', (_, id: string) =>
    agentWorkspaceService.setActiveWorkspace(id)
  )
  ipcMain.handle('agentWorkspace:openFolder', (_, folderPath: string, name?: string) =>
    agentWorkspaceService.openFolderAsWorkspace(folderPath, name)
  )
  ipcMain.handle(
    'agentWorkspace:create',
    (_, data: { name: string; parentDir?: string }) => agentWorkspaceService.createWorkspace(data)
  )
  ipcMain.handle('agentWorkspace:rename', (_, id: string, name: string) =>
    agentWorkspaceService.renameWorkspace(id, name)
  )
  ipcMain.handle('agentWorkspace:delete', (_, id: string) =>
    agentWorkspaceService.deleteWorkspace(id)
  )
  ipcMain.handle('agentWorkspace:getRoot', () => agentWorkspaceService.getActiveWorkspaceRoot())
  ipcMain.handle('agentWorkspace:ensureGallery', () => {
    agentWorkspaceService.ensureActiveGalleryCategoryId()
    return agentWorkspaceService.getActiveWorkspace()
  })
  ipcMain.handle('agentWorkspace:prepareGallery', (_, workspaceId: string) =>
    agentWorkspaceService.prepareWorkspaceGallery(workspaceId)
  )
  ipcMain.handle('agentWorkspace:listDir', (_, relPath?: string) =>
    agentWorkspaceService.listActiveWorkspaceDir(relPath || '.')
  )

  function buildBrandSummary() {
    const ws = agentWorkspaceService.getActiveWorkspace()
    const card = brandCardService.summarizeBrandCard(ws.root_path)
    return {
      workspaceId: ws.id,
      workspaceName: ws.name,
      rootPath: ws.root_path,
      isDefault: !!ws.is_default,
      docsPath: join(ws.root_path, 'docs'),
      ...card
    }
  }
  ipcMain.handle('brand:getActiveSummary', () => buildBrandSummary())
  ipcMain.handle('brand:ensureActive', async () => {
    const ws = agentWorkspaceService.getActiveWorkspace()
    const prepared = await brandCardService.ensureBrandCard({
      rootPath: ws.root_path,
      preferredProviderId: '',
      preferredModelId: ''
    })
    agentWorkspaceService.updateWorkspaceBrandMeta(
      ws.id,
      prepared.card?.status || 'missing',
      prepared.card?.source_fingerprint || ''
    )
    const summary = buildBrandSummary()
    return { ...summary, note: prepared.note || summary.note }
  })
  ipcMain.handle('brand:getVoice', () => {
    const ws = agentWorkspaceService.getActiveWorkspace()
    return workspaceVoiceService.summarizeVoice(ws.root_path)
  })
  ipcMain.handle('brand:saveVoice', (_, body: string) => {
    const ws = agentWorkspaceService.getActiveWorkspace()
    workspaceVoiceService.saveVoice(ws.root_path, String(body || ''), { locked: true })
    return workspaceVoiceService.summarizeVoice(ws.root_path)
  })
  ipcMain.handle('brand:ensureVoice', async () => {
    const ws = agentWorkspaceService.getActiveWorkspace()
    return workspaceVoiceService.ensureVoice({ rootPath: ws.root_path })
  })

  // === Brand Workspaces (D-20，管理页保留) ===
  ipcMain.handle('brandWorkspace:list', () => brandWorkspaceService.listBrandWorkspaces())
  ipcMain.handle('brandWorkspace:get', (_, id: string) => brandWorkspaceService.getBrandWorkspace(id))
  ipcMain.handle(
    'brandWorkspace:create',
    (_, data: { name: string; description?: string; default_bot_id?: string }) =>
      brandWorkspaceService.createBrandWorkspace(data)
  )
  ipcMain.handle(
    'brandWorkspace:update',
    (
      _,
      id: string,
      data: Partial<{
        name: string
        description: string
        output_dir: string
        default_bot_id: string
        sort_order: number
      }>
    ) => brandWorkspaceService.updateBrandWorkspace(id, data)
  )
  ipcMain.handle('brandWorkspace:delete', (_, id: string) =>
    brandWorkspaceService.deleteBrandWorkspace(id)
  )

  // === Gallery ===
  ipcMain.handle('gallery:listCategories', () => galleryService.listCategories())
  ipcMain.handle('gallery:getCategory', (_, id: string) => galleryService.getCategory(id))
  ipcMain.handle('gallery:createCategory', (_, data: { name: string; description?: string }) =>
    galleryService.createCategory(data)
  )
  ipcMain.handle('gallery:updateCategory', (_, id: string, data: { name?: string; description?: string }) =>
    galleryService.updateCategory(id, data)
  )
  ipcMain.handle('gallery:deleteCategory', (_, id: string) => galleryService.deleteCategory(id))
  ipcMain.handle('gallery:getCategoryItemCount', (_, categoryId: string) =>
    galleryService.getCategoryItemCount(categoryId)
  )
  ipcMain.handle(
    'gallery:listItemsPaged',
    (_, categoryId: string | null, search: string, page: number, pageSize: number) =>
      galleryService.listItemsPaged(categoryId, search, page, pageSize)
  )
  ipcMain.handle('gallery:getItem', (_, id: string) => galleryService.getItem(id))
  ipcMain.handle('gallery:addFile', (_, categoryId: string, filePath: string) =>
    galleryService.addFile(categoryId, filePath)
  )
  // O4: 工具页保存图片 → 写盘 + 入库
  ipcMain.handle('gallery:addFromDataUri', (_, categoryId: string, dataUri: string, displayName: string) =>
    galleryService.addFromDataUri(categoryId, dataUri, displayName)
  )
  ipcMain.handle(
    'gallery:addFolder',
    (_, categoryId: string, folderPath: string, recursive: boolean) =>
      galleryService.addFolder(categoryId, folderPath, recursive)
  )
  ipcMain.handle('gallery:removeItems', (_, ids: string[]) => galleryService.removeItems(ids))
  ipcMain.handle('gallery:removeByFilePath', (_, filePath: string) =>
    galleryService.removeByFilePath(filePath)
  )
  ipcMain.handle('gallery:sync', (_, categoryId?: string) => galleryService.sync(categoryId))
  ipcMain.handle('gallery:addToCreation', (_, filePath: string) =>
    agentWorkspaceService.addGeneratedImageToWorkspaceGallery(filePath)
  )

  ipcMain.handle('cloudVideo:download', async (event, url: string, defaultName?: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return cloudVideoService.downloadRemoteVideo(url, defaultName || '', window)
  })

  ipcMain.handle('videoGen:list', (_, options?: videoGenerationService.VideoGenerationListOptions) =>
    videoGenerationService.listGenerations(options || {})
  )
  ipcMain.handle('videoGen:get', (_, id: string) => videoGenerationService.getGeneration(id))
  ipcMain.handle('videoGen:resolveLocalPath', (_, id: string) => videoGenerationService.resolveLocalAbsolutePath(id))
  ipcMain.handle('videoGen:getDeletedIds', (_, ids: string[]) =>
    videoGenerationService.getDeletedGenerationIds(Array.isArray(ids) ? ids : [])
  )
  ipcMain.handle('videoGen:syncTask', (_, input: videoGenerationService.SyncVideoTaskInput) =>
    videoGenerationService.syncCloudTask(input)
  )
  ipcMain.handle('videoGen:syncTasks', (_, inputs: videoGenerationService.SyncVideoTaskInput[]) =>
    videoGenerationService.syncCloudTasks(Array.isArray(inputs) ? inputs : [])
  )
  ipcMain.handle('videoGen:save', (_, id: string) => videoGenerationService.saveGenerationVideo(id))
  ipcMain.handle('videoGen:runPendingDownloads', (_, limit?: number) =>
    videoGenerationService.runPendingDownloads(limit)
  )
  ipcMain.handle('videoGen:delete', (_, id: string, deleteFile?: boolean) =>
    videoGenerationService.deleteGeneration(id, Boolean(deleteFile))
  )
  ipcMain.handle('videoGen:localCatalog', () => localVideoService.listCatalog())
  ipcMain.handle('videoGen:submitLocal', (_, input) => localVideoService.submit(input))
  ipcMain.handle('videoGen:refreshLocal', (_, id: string) => localVideoService.refresh(id))
  ipcMain.handle('videoGen:cancelLocal', (_, id: string) => localVideoService.cancel(id))

  ipcMain.handle('viralClone:ffmpegStatus', () => viralCloneService.ffmpegStatus())
  ipcMain.handle('viralClone:ytDlpStatus', () => viralCloneService.ytDlpStatus())
  ipcMain.handle('viralClone:probe', (_, videoPath: string) => viralCloneService.probeVideo(videoPath))
  ipcMain.handle('viralClone:extractFrames', (_, videoPath: string, maxFrames?: number) =>
    viralCloneService.extractKeyframes(videoPath, Number(maxFrames) || 16)
  )
  ipcMain.handle('viralClone:extractAudio', (_, videoPath: string) => viralCloneService.extractAudio(videoPath))
  ipcMain.handle('viralClone:transcribe', (_, wavPath: string, providerId: string, modelId: string) =>
    viralCloneService.transcribeAudio(wavPath, providerId, modelId)
  )
  ipcMain.handle('viralClone:cleanupAudio', (_, wavPath: string) => viralCloneService.cleanupTempAudio(wavPath))
  ipcMain.handle('viralClone:saveProject', (event, payload) => viralCloneService.saveProjectWithDialog(event, payload))
  ipcMain.handle('viralClone:openProject', (event) => viralCloneService.openProjectWithDialog(event))
  ipcMain.handle('viralClone:extractFrameAt', (_, videoPath: string, time: number) =>
    viralCloneService.extractFrameAt(videoPath, Number(time) || 0)
  )
  ipcMain.handle('viralClone:concat', (_, paths: string[], outPath: string) =>
    viralCloneService.concatVideos(Array.isArray(paths) ? paths : [], String(outPath || ''))
  )
  ipcMain.handle('viralClone:resolvePath', (_, filePath: string) => viralCloneService.resolveMediaPath(filePath))
  ipcMain.handle('viralClone:importUrl', (_, url: string) => viralCloneService.importFromUrl(String(url || '')))
  ipcMain.handle('viralClone:muxVoiceover', (_, videoPath: string, chunks: Array<{ text: string; durationSeconds: number }>, destName: string, opts?: { voice?: string; speed?: number }) =>
    viralCloneService.muxVoiceover(String(videoPath || ''), Array.isArray(chunks) ? chunks : [], String(destName || ''), opts || {})
  )

  // === Cloud Token ===
  ipcMain.handle('cloud:setToken', (_, token: string | null) => {
    setCloudToken(token)
    // 登录态变化联动云同步调度（登录启动并跑一次，登出停止）。
    try {
      syncService.onAuthChanged(!!token)
    } catch (e) {
      console.error('[sync] onAuthChanged failed:', e)
    }
    // 登录态变化联动微信 ClawBot 桥：登出（模型走云网关必败）即停；登录后幂等启动。
    try {
      if (token) {
        // 未登录完成账号初始化前不碰库（否则会在 root 误建库）
        if (isAccountReady()) {
          void startClawbotBridge().catch((e) => console.error('[clawbot] start on login failed:', e))
        }
      } else {
        stopClawbotBridge()
      }
    } catch (e) {
      console.error('[clawbot] auth-changed hook failed:', e)
    }
  })
  ipcMain.handle('cloud:getToken', () => getCloudToken())
  ipcMain.handle('cloud:setPermissions', (_, perms: Record<string, any>) => {
    setCloudPermissions(perms)
    // 微信 ClawBot 使用权限变化联动桥：无权即停（正在收发的轮次一并取消），有权幂等启动
    try {
      if (getAllowClawbot()) {
        if (isAccountReady()) {
          void startClawbotBridge().catch((e) => console.error('[clawbot] start on permission failed:', e))
        }
      } else {
        stopClawbotBridge()
      }
    } catch (e) {
      console.error('[clawbot] permission-changed hook failed:', e)
    }
  })
  ipcMain.handle('cloud:getDeviceId', () => getDeviceId())
  // 账号切换：写账号目录映射；目录变化时主进程运行中热切换（关旧库开新库 + reload 渲染层，不重启进程）。
  // 用未包裹的 electronIpcMain 注册：本 handler 是切换编排本身，bumpEpoch 后需以新代次开库，不能停在旧代次上下文。
  // （renderer 拿到 { switched:true } 即停下当前登录流程，等 reload 后由 init 接管按新账号加载数据）
  electronIpcMain.handle('cloud:setActiveAccount', (_, id: number | string | null) => setActiveAccount(id))

  // === Cloud Sync（云同步与容量计费） ===
  ipcMain.handle('sync:status', () => syncService.getStatus())
  ipcMain.handle('sync:now', () => syncService.syncNow())
  ipcMain.handle('sync:getConfig', () => syncService.getConfig())
  ipcMain.handle('sync:setConfig', (_, patch: any) => syncService.setConfig(patch || {}))
  ipcMain.handle('sync:getQuota', () => syncService.getQuota())
  ipcMain.handle('sync:getConflicts', () => syncService.getConflicts())
  ipcMain.handle('sync:getLocalStats', () => syncService.getLocalStats())

  // === Cloud Models（全量 chat/image/embedding；用于 callLLM/image/embedding 出 body 前反查 cloud_model_id） ===
  // 解决多家服务商提供同名 model_id 时云控端 first() 错位路由的 bug：
  // renderer fetchCloudData 拉到全量模型后通过此 IPC 同步到 main 缓存，
  // main 在请求体里附 cloud_model_id 让后端按主键精确路由。
  ipcMain.handle('cloud:setModels', (_, models: any[]) => {
    setCloudModels(Array.isArray(models) ? models : [])
  })

  // === Cloud Embedding（渲染进程同步云端可用 embedding 模型 + 偏好选择） ===
  ipcMain.handle('cloud:setEmbeddingModels', (_, models: any[]) => {
    setCloudEmbeddingModels(Array.isArray(models) ? models : [])
  })
  ipcMain.handle('cloud:setPreferredEmbeddingModel', (_, modelId: string) => {
    setPreferredCloudEmbeddingModel(modelId || '')
  })
  ipcMain.handle('cloud:getEmbeddingState', () => ({
    models: getCloudEmbeddingModels(),
    preferred: getPreferredCloudEmbeddingModel(),
    active: getActiveCloudEmbeddingModelId(),
    allowCustomEmbedding: getAllowCustomEmbedding(),
  }))

  // === Cloud Inspiration（桌面端用户上传创作到灵感广场） ===
  // 渲染端传入的 resultPath 由主进程拼接数据目录并读字节，避免渲染端直读文件系统
  ipcMain.handle('cloudInspiration:upload', (_, params: {
    resultPath: string
    title: string
    categoryId: number
    promptLang: 'cn' | 'en'
    promptText: string
    refImages?: string[]
    generationSize?: string
  }) => uploadInspirationToCloud(params))

  // === AI 抠图（v0.6.9+，阿里 viapi SegmentHDCommonImage）===
  // 自定义模式（provider 管理）：本地存 AK/SK，直连阿里
  ipcMain.handle('matting:listProviders', () => mattingProviderService.listProviders())
  ipcMain.handle('matting:getProvider', (_, id: string) => {
    const p = mattingProviderService.getProvider(id)
    if (!p) return null
    // 返回 masked 摘要，不暴露密文
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      access_key_id_masked: p.access_key_id ? (p.access_key_id.slice(0, 4) + '****' + p.access_key_id.slice(-4)) : '',
      endpoint: p.endpoint,
      region_id: p.region_id,
      is_default: !!p.is_default,
      remark: p.remark,
      last_test_at: p.last_test_at,
      last_test_status: p.last_test_status,
      last_test_message: p.last_test_message,
      created_at: p.created_at,
      updated_at: p.updated_at,
    }
  })
  ipcMain.handle('matting:createProvider', (_, data: mattingProviderService.CreateProviderInput) =>
    mattingProviderService.createProvider(data),
  )
  ipcMain.handle('matting:updateProvider', (_, id: string, data: mattingProviderService.UpdateProviderInput) =>
    mattingProviderService.updateProvider(id, data),
  )
  ipcMain.handle('matting:deleteProvider', (_, id: string) =>
    mattingProviderService.deleteProvider(id),
  )

  // 测试 provider 凭证：上传一张本地图（renderer 提供绝对路径）跑通端到端
  ipcMain.handle('matting:testProvider', (_, providerId: string, testImagePath: string) =>
    mattingService.testProvider(providerId, testImagePath),
  )

  // 核心：抠图调用（输入 + 模式）。同步阻塞最长 90s，进度通过 'matting:progress' 事件推送
  ipcMain.handle('matting:segment', (_, input: mattingService.SegmentInput) =>
    mattingService.segment(input),
  )

  // 任务历史（本地 matting_tasks 表）
  ipcMain.handle('matting:listTasks', (_, limit?: number, offset?: number) =>
    mattingService.listTasks(limit ?? 50, offset ?? 0),
  )
  ipcMain.handle('matting:getTask', (_, id: string) => mattingService.getTask(id))
  ipcMain.handle('matting:deleteTask', (_, id: string) => mattingService.deleteTask(id))

  // 拉云控端配额状态（剩余张数 / 单次扣费）。用于桌面端 MattingView 顶部 banner 展示
  ipcMain.handle('matting:fetchCloudQuota', () => fetchMattingQuotaFromCloud())

  // === 精细抠图（抠抠图 koukoutu，仅云端中转，按尺寸三档计费）===
  ipcMain.handle('fineMatting:segment', (_, input: fineMattingService.SegmentInput) =>
    fineMattingService.segment(input),
  )
  ipcMain.handle('fineMatting:listTasks', (_, limit?: number, offset?: number) =>
    fineMattingService.listTasks(limit ?? 50, offset ?? 0),
  )
  ipcMain.handle('fineMatting:getTask', (_, id: string) => fineMattingService.getTask(id))
  ipcMain.handle('fineMatting:deleteTask', (_, id: string) => fineMattingService.deleteTask(id))
  // 拉云控端精细抠图配额 + 三档价 + 阈值。用于桌面端 FineMattingView 顶部 banner + 按尺寸预估
  ipcMain.handle('fineMatting:fetchCloudQuota', () => fetchFineMattingQuotaFromCloud())

  // === 去AI标记（本地清除元数据/溯源标识，按次计费）===
  // scan：仅识别命中标记（不修改）；process：原地去除并在记录里打「已处理」标记；charge：云端按次扣费
  ipcMain.handle('aiMarkRemoval:scan', (_, paths: string[]) => aiMarkRemovalService.scanFiles(paths))
  ipcMain.handle('aiMarkRemoval:process', (_, paths: string[]) => aiMarkRemovalService.processFiles(paths))
  ipcMain.handle('aiMarkRemoval:markGeneration', (_, id: string) => aiMarkRemovalService.markGenerationRemoved(id))
  ipcMain.handle('aiMarkRemoval:charge', (_, payload: { request_id: string; marks?: string; image_count?: number }) =>
    chargeWatermarkRemoval(payload),
  )

  // === 店铺商品图：多商城连接器（按连接器 platform 经 registry 分发到 ewei/dianda 适配器）===
  // 凭据脱敏一律在本 IPC 层完成：明文密码 / session / cookie 永不下发 renderer。
  // 信道名沿用 ewei:* 保持对 renderer 兼容；具体平台由连接器 platform 决定。
  const adapterForConnector = (id: string) =>
    mallRegistry.getAdapter(eweiConnectorService.getConnector(id)?.platform)
  ipcMain.handle('ewei:listConnectors', () => eweiConnectorService.listConnectors())
  ipcMain.handle('ewei:getConnector', (_, id: string) => eweiConnectorService.getConnectorSummary(id))
  ipcMain.handle('ewei:createConnector', (_, data: eweiConnectorService.CreateConnectorInput) =>
    eweiConnectorService.createConnector(data),
  )
  ipcMain.handle('ewei:updateConnector', (_, id: string, data: eweiConnectorService.UpdateConnectorInput) =>
    eweiConnectorService.updateConnector(id, data),
  )
  ipcMain.handle('ewei:deleteConnector', (_, id: string) => {
    // 删除前清本地会话：按连接器 platform 分发到对应适配器的 clearSession（qdyun 会一并清持久化分区，
    // 否则 cookie+JWT 磁盘残留串台）。新增商城只要实现 clearSession 即自动覆盖，无需改这里。
    try {
      adapterForConnector(id).clearSession(id)
    } catch (e) {
      console.error('[mall] clearSession on delete failed:', e)
    }
    return eweiConnectorService.deleteConnector(id)
  })
  // 平台能力位（renderer 据此显隐「选门店」、是否走验证码登录）
  ipcMain.handle('ewei:capabilities', (_, id: string) => adapterForConnector(id).capabilities)
  // 登录：beginLogin 直接成功(ewei)或返回验证码挑战(点大)；submitLogin 提交验证码；refreshCaptcha 换图
  ipcMain.handle('ewei:login', (_, id: string) => adapterForConnector(id).beginLogin(id))
  ipcMain.handle('ewei:submitLogin', (_, id: string, captcha: string, challengeId?: string) =>
    adapterForConnector(id).submitLogin(id, captcha, challengeId),
  )
  ipcMain.handle('ewei:refreshCaptcha', (_, id: string) => {
    const a = adapterForConnector(id)
    return a.refreshCaptcha ? a.refreshCaptcha(id) : Promise.reject(new Error('该商城无需验证码'))
  })
  ipcMain.handle('ewei:logout', (_, id: string) => adapterForConnector(id).logout(id))
  // 门店
  ipcMain.handle('ewei:listShops', (_, id: string, page?: number, pagesize?: number) =>
    adapterForConnector(id).listShops(id, page ?? 1, pagesize ?? 50),
  )
  ipcMain.handle('ewei:switchShop', (_, id: string, shopId: number, shopName?: string) =>
    adapterForConnector(id).switchShop(id, shopId, shopName ?? ''),
  )
  // 商品
  ipcMain.handle('ewei:listGoods', (_, id: string, params: eweiClient.GoodsListParams) =>
    adapterForConnector(id).listGoods(id, params || {}),
  )
  ipcMain.handle('ewei:goodsDetail', (_, id: string, goodsId: number) =>
    adapterForConnector(id).getGoodsDetail(id, goodsId),
  )
  // 替换商品图（上传→回写一体，进度走 'ewei:progress'）
  ipcMain.handle('ewei:replaceGoodsImage', (_, args: eweiClient.ReplaceGoodsImageArgs) =>
    adapterForConnector(args.connectorId).replaceGoodsImage(args),
  )
  // 替换历史（mall 无关，直接走 connector service）
  ipcMain.handle('ewei:listImageLogs', (_, goodsId: number, limit?: number) =>
    eweiConnectorService.listImageLogs(goodsId, limit),
  )
  // 分类 / 新增商品
  ipcMain.handle('ewei:listGoodsCategories', (_, id: string) => adapterForConnector(id).listGoodsCategories(id))
  ipcMain.handle('ewei:addGoods', (_, id: string, form: eweiClient.AddGoodsForm) =>
    adapterForConnector(id).addGoods(id, form),
  )
}
