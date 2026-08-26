import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { getRuntimeConfig } from '../main/services/runtime-config'

const api = {
  db: {
    query: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(`db:${channel}`, ...args)
  },
  model: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`model:${channel}`, ...args)
  },
  persona: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`persona:${channel}`, ...args)
  },
  knowledge: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`knowledge:${channel}`, ...args)
  },
  brandWorkspace: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`brandWorkspace:${channel}`, ...args)
  },
  agentWorkspace: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`agentWorkspace:${channel}`, ...args)
  },
  brand: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`brand:${channel}`, ...args)
  },
  bot: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`bot:${channel}`, ...args)
  },
  chat: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`chat:${channel}`, ...args),
    onStream: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('chat:stream', handler)
      return () => ipcRenderer.off('chat:stream', handler)
    },
    offStream: () => ipcRenderer.removeAllListeners('chat:stream'),
    onTitleUpdated: (callback: (data: unknown) => void) =>
      ipcRenderer.on('chat:titleUpdated', (_event, data) => callback(data)),
    offTitleUpdated: () => ipcRenderer.removeAllListeners('chat:titleUpdated'),
    onToolApproval: (callback: (data: unknown) => void) =>
      ipcRenderer.on('chat:toolApproval', (_event, data) => callback(data)),
    offToolApproval: () => ipcRenderer.removeAllListeners('chat:toolApproval'),
    /**
     * 审批已在主进程侧被解决（超时 / 中止）事件；payload = { request_id, conversation_id }。
     * 渲染端常驻审批监听据此清掉对应卡片，避免残留无法操作的浮层。
     */
    onToolApprovalResolved: (callback: (data: unknown) => void) =>
      ipcRenderer.on('chat:toolApprovalResolved', (_event, data) => callback(data)),
    offToolApprovalResolved: () => ipcRenderer.removeAllListeners('chat:toolApprovalResolved'),
    /**
     * 异步追加消息事件：image_gen fire-and-forget 完成后由主进程发出，
     * payload: { conversationId, message }。renderer 端 chat store 监听后
     * 把 message push 到 messages.value（仅当 currentConversationId 匹配）。
     */
    onAppendMessage: (callback: (data: unknown) => void) =>
      ipcRenderer.on('chat:appendMessage', (_event, data) => callback(data)),
    offAppendMessage: () => ipcRenderer.removeAllListeners('chat:appendMessage'),
    /**
     * 消息更新事件：交互卡片（ask_user / 生图参数卡）状态变化时由主进程发出，
     * payload: { conversationId, message }。renderer 端 chat store 监听后
     * 用 message 覆盖 messages.value 中的同 id 项（仅当 currentConversationId 匹配）。
     */
    onUpdateMessage: (callback: (data: unknown) => void) =>
      ipcRenderer.on('chat:updateMessage', (_event, data) => callback(data)),
    offUpdateMessage: () => ipcRenderer.removeAllListeners('chat:updateMessage')
  },
  skill: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`skill:${channel}`, ...args)
  },
  mcpMarket: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`mcpMarket:${channel}`, ...args)
  },
  mcp: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`mcp:${channel}`, ...args),
    /**
     * MCP 服务器运行状态变化事件；payload = { id, status: 'running'|'stopped'|'error', error?, toolsUpdated? }
     * toolsUpdated=true 表示服务器推送了工具清单变更且已写库，渲染层应重新拉取该 server。
     * 返回 unsubscribe 函数。
     */
    onStatus: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('mcp:status', handler)
      return () => ipcRenderer.off('mcp:status', handler)
    }
  },
  promptSkill: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`promptSkill:${channel}`, ...args)
  },
  settings: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`settings:${channel}`, ...args)
  },
  deviceSettings: {
    get: (key: string) => ipcRenderer.invoke('deviceSettings:get', key) as Promise<string | null>,
    set: (key: string, value: string) => ipcRenderer.invoke('deviceSettings:set', key, value)
  },
  python: {
    status: () => ipcRenderer.invoke('python:status'),
    ensure: () => ipcRenderer.invoke('python:ensure'),
    setPath: (filePath: string) => ipcRenderer.invoke('python:setPath', filePath),
    clearOverride: () => ipcRenderer.invoke('python:clearOverride'),
    onRequired: (callback: (data: { reason: string; installUrl: string; installHint: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { reason: string; installUrl: string; installHint: string }) =>
        callback(data)
      ipcRenderer.on('python:required', handler)
      return () => ipcRenderer.off('python:required', handler)
    }
  },
  distill: {
    inspect: (conversationId: string) => ipcRenderer.invoke('distill:inspect', conversationId),
    getMode: () => ipcRenderer.invoke('distill:getMode'),
    setMode: (mode: 'ask' | 'auto' | 'off') => ipcRenderer.invoke('distill:setMode', mode),
    skip: (conversationId: string) => ipcRenderer.invoke('distill:skip', conversationId),
    run: (conversationId: string, force?: boolean) =>
      ipcRenderer.invoke('distill:run', { conversationId, force })
  },
  desktopPrefs: {
    get: () => ipcRenderer.invoke('desktopPrefs:get'),
    update: (patch: Record<string, unknown>) => ipcRenderer.invoke('desktopPrefs:update', patch),
    testNotification: () => ipcRenderer.invoke('desktopPrefs:testNotification')
  },
  llm: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`llm:${channel}`, ...args)
  },
  vectorize: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`vectorize:${channel}`, ...args),
    checkModelMismatch: () => ipcRenderer.invoke('vectorize:checkModelMismatch'),
    reembedAll: () => ipcRenderer.invoke('vectorize:reembedAll'),
    onProgress: (callback: (data: unknown) => void) =>
      ipcRenderer.on('vectorize:progress', (_event, data) => callback(data)),
    offProgress: () => ipcRenderer.removeAllListeners('vectorize:progress')
  },
  usage: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`usage:${channel}`, ...args)
  },
  dailyReview: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`dailyReview:${channel}`, ...args)
  },
  scheduledTasks: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`scheduledTasks:${channel}`, ...args),
    onChanged: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('scheduledTasks:changed', handler)
      return () => ipcRenderer.off('scheduledTasks:changed', handler)
    }
  },
  browser: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`browser:${channel}`, ...args)
  },
  promptPreset: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`promptPreset:${channel}`, ...args)
  },
  imageGen: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`imageGen:${channel}`, ...args),
    /**
     * 注册 progress 回调，返回 unsubscribe 函数。
     * 多视图（ImageGenView / BatchGenView / ImageEditView）共用此信道时，
     * 调用 unsubscribe 只移除自己的监听器，不影响其他视图。
     */
    onProgress: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('imageGen:progress', handler)
      return () => ipcRenderer.off('imageGen:progress', handler)
    },
    /** @deprecated 改用 onProgress 返回的 unsubscribe，避免误清其他视图的监听 */
    offProgress: () => ipcRenderer.removeAllListeners('imageGen:progress')
  },
  imageExport: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`imageExport:${channel}`, ...args)
  },
  deck: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`deck:${channel}`, ...args),
    // 注册 deck:progress(大纲/逐页生成进度)回调，返回 unsubscribe
    onProgress: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('deck:progress', handler)
      return () => ipcRenderer.off('deck:progress', handler)
    }
  },
  canvas: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`canvas:${channel}`, ...args)
  },
  gallery: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`gallery:${channel}`, ...args)
  },
  creativeTemplate: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`creativeTemplate:${channel}`, ...args)
  },
  stylePreset: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`stylePreset:${channel}`, ...args)
  },
  matting: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`matting:${channel}`, ...args),
    /**
     * 注册抠图任务进度回调；payload = { taskId, phase: 'uploading'|'processing'|'downloading'|'done', message? }
     * 返回 unsubscribe 函数，多视图共用此信道时可安全 off 自己的监听器。
     */
    onProgress: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('matting:progress', handler)
      return () => ipcRenderer.off('matting:progress', handler)
    },
  },
  fineMatting: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`fineMatting:${channel}`, ...args),
    /**
     * 注册精细抠图任务进度回调；payload = { taskId, phase: 'uploading'|'processing'|'downloading'|'done', message? }
     * 返回 unsubscribe 函数，多视图共用此信道时可安全 off 自己的监听器。
     */
    onProgress: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('fineMatting:progress', handler)
      return () => ipcRenderer.off('fineMatting:progress', handler)
    },
  },
  // 去AI标记（本地清除元数据/溯源标识，按次计费）
  aiMarkRemoval: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`aiMarkRemoval:${channel}`, ...args),
  },
  ewei: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`ewei:${channel}`, ...args),
    /**
     * ewei 商品图替换进度回调；payload = { taskId, goodsId, phase: 'uploading'|'saving'|'done'|'error', current?, total?, message? }
     * 返回 unsubscribe 函数。
     */
    onProgress: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('ewei:progress', handler)
      return () => ipcRenderer.off('ewei:progress', handler)
    },
  },
  // 微信 ClawBot 桥：状态广播（含登录状态机）与微信轮次完成通知
  clawbot: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`clawbot:${channel}`, ...args),
    /** 连接/登录状态广播；payload = ClawbotState。返回 unsubscribe。 */
    onStatus: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('clawbot:status', handler)
      return () => ipcRenderer.off('clawbot:status', handler)
    },
    /** 一轮微信对话完成；payload = { connectionId, peerId, conversationId, summary }。返回 unsubscribe。 */
    onPeerMessage: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('clawbot:peerMessage', handler)
      return () => ipcRenderer.off('clawbot:peerMessage', handler)
    },
  },
  videoGen: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`videoGen:${channel}`, ...args),
    onUpdated: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('videoGen:updated', handler)
      return () => ipcRenderer.off('videoGen:updated', handler)
    },
    onDeleted: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('videoGen:deleted', handler)
      return () => ipcRenderer.off('videoGen:deleted', handler)
    },
  },
  viralClone: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`viralClone:${channel}`, ...args),
  },
  cloud: {
    setToken: (token: string | null) => ipcRenderer.invoke('cloud:setToken', token),
    getToken: () => ipcRenderer.invoke('cloud:getToken'),
    onTokenUpdated: (callback: (data: { token: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { token: string }) => callback(data)
      ipcRenderer.on('cloud:tokenUpdated', handler)
      return () => ipcRenderer.off('cloud:tokenUpdated', handler)
    },
    onAuthExpired: (callback: (data: { reason?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { reason?: string }) => callback(data)
      ipcRenderer.on('cloud:authExpired', handler)
      return () => ipcRenderer.off('cloud:authExpired', handler)
    },
    setPermissions: (perms: Record<string, any>) => ipcRenderer.invoke('cloud:setPermissions', perms),
    getDeviceId: () => ipcRenderer.invoke('cloud:getDeviceId') as Promise<string>,
    // 切换/登出账号：写账号目录映射；目录变化时主进程会自动 relaunch（进程重启后以新账号目录启动）
    setActiveAccount: (id: number | string | null) =>
      ipcRenderer.invoke('cloud:setActiveAccount', id) as Promise<{ switched: boolean }>,
    setEmbeddingModels: (models: Array<{ id: number; model_id: string; name: string }>) =>
      ipcRenderer.invoke('cloud:setEmbeddingModels', models),
    // 同步全量云端模型（含 chat/image/embedding）到主进程，发起请求前用于反查 cloud_model_id
    // 精确路由到具体服务商，解决多家提供同 model_id 时云控端错位扣费的 bug
    setModels: (
      models: Array<{
        id: number
        model_id: string
        name: string
        type: string
        provider_name: string
        provider_type?: string
      }>,
    ) => ipcRenderer.invoke('cloud:setModels', models),
    setPreferredEmbeddingModel: (modelId: string) =>
      ipcRenderer.invoke('cloud:setPreferredEmbeddingModel', modelId),
    getEmbeddingState: () => ipcRenderer.invoke('cloud:getEmbeddingState') as Promise<{
      models: Array<{ id: number; model_id: string; name: string }>
      preferred: string
      active: string
      allowCustomEmbedding: boolean
    }>,
    // 上传创作到云端灵感广场（主进程读文件字节 + multipart 上传）
    uploadInspiration: (params: {
      resultPath: string
      title: string
      categoryId: number
      promptLang: 'cn' | 'en'
      promptText: string
      refImages?: string[]
      generationSize?: string
    }) => ipcRenderer.invoke('cloudInspiration:upload', params) as Promise<{
      ok: boolean
      error?: string
      data?: any
      /** 原图过大触发自动 JPEG 压缩后上传时为 true，前端可据此提示用户 */
      compressed?: boolean
    }>,
    downloadVideo: (url: string, defaultName?: string) =>
      ipcRenderer.invoke('cloudVideo:download', url, defaultName) as Promise<{
        success: boolean
        path?: string
        error?: string
      }>
  },
  clipboard: {
    writeImage: (filePath: string) => ipcRenderer.invoke('clipboard:writeImage', filePath)
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    getVersion: () => ipcRenderer.invoke('updater:getVersion'),
    onAvailable: (cb: (data: { version: string; releaseNotes?: string }) => void) =>
      ipcRenderer.on('updater:available', (_, data) => cb(data)),
    onNotAvailable: (cb: () => void) =>
      ipcRenderer.on('updater:not-available', () => cb()),
    onProgress: (cb: (data: { percent: number; transferred: number; total: number }) => void) =>
      ipcRenderer.on('updater:progress', (_, data) => cb(data)),
    onDownloaded: (cb: (data: { manualInstall?: boolean }) => void) =>
      ipcRenderer.on('updater:downloaded', (_, data) => cb(data || {})),
    onError: (cb: (msg: string) => void) =>
      ipcRenderer.on('updater:error', (_, msg) => cb(msg)),
    offAll: () => {
      ipcRenderer.removeAllListeners('updater:available')
      ipcRenderer.removeAllListeners('updater:not-available')
      ipcRenderer.removeAllListeners('updater:progress')
      ipcRenderer.removeAllListeners('updater:downloaded')
      ipcRenderer.removeAllListeners('updater:error')
    }
  },
  backup: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`backup:${channel}`, ...args),
    onProgress: (
      callback: (data: {
        phase: 'snapshot' | 'pack' | 'verify' | 'extract' | 'apply'
        current: number
        total: number
        fileName: string
        bytes?: number
      }) => void
    ) => ipcRenderer.on('backup:progress', (_, data) => callback(data)),
    offProgress: () => ipcRenderer.removeAllListeners('backup:progress')
  },
  sync: {
    status: () => ipcRenderer.invoke('sync:status'),
    now: () => ipcRenderer.invoke('sync:now'),
    getConfig: () => ipcRenderer.invoke('sync:getConfig'),
    setConfig: (patch: Record<string, unknown>) => ipcRenderer.invoke('sync:setConfig', patch),
    getQuota: () => ipcRenderer.invoke('sync:getQuota'),
    getConflicts: () => ipcRenderer.invoke('sync:getConflicts'),
    getLocalStats: () => ipcRenderer.invoke('sync:getLocalStats'),
    onProgress: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('sync:progress', handler)
      return () => ipcRenderer.off('sync:progress', handler)
    },
    onStatus: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('sync:status', handler)
      return () => ipcRenderer.off('sync:status', handler)
    }
  },
  dataDir: {
    get: () => ipcRenderer.invoke('dataDir:get'),
    isFirstLaunch: () => ipcRenderer.invoke('dataDir:isFirstLaunch'),
    isActivated: () => ipcRenderer.invoke('dataDir:isActivated'),
    init: (dir?: string) => ipcRenderer.invoke('dataDir:init', dir),
    set: (dir: string) => ipcRenderer.invoke('dataDir:set', dir),
    pick: () => ipcRenderer.invoke('dataDir:pick')
  },
  migration: {
    check: () => ipcRenderer.invoke('migration:check'),
    start: (options?: { conflictStrategy?: 'keep-existing' | 'overwrite' }) =>
      ipcRenderer.invoke('migration:start', options),
    deleteOld: () => ipcRenderer.invoke('migration:deleteOld'),
    skip: () => ipcRenderer.invoke('migration:skip'),
    abandon: () => ipcRenderer.invoke('migration:abandon'),
    onProgress: (cb: (data: { current: number; total: number; fileName: string }) => void) => {
      ipcRenderer.on('migration:progress', (_, data) => cb(data))
    },
    offProgress: () => ipcRenderer.removeAllListeners('migration:progress')
  },
  app: {
    relaunch: () => ipcRenderer.invoke('app:relaunch')
  },
  dialog: {
    openFile: (options?: unknown) => ipcRenderer.invoke('dialog:openFile', options)
  },
  // 同步桥接主进程原生对话框，用于覆盖 window.alert/confirm（规避 Electron Windows 焦点 bug）
  nativeDialog: {
    alert: (message?: unknown): void => {
      ipcRenderer.sendSync('dialog:alert', String(message ?? ''))
    },
    confirm: (message?: unknown): boolean =>
      Boolean(ipcRenderer.sendSync('dialog:confirm', String(message ?? '')))
  },
  shell: {
    openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
    showItemInFolder: (path: string) => ipcRenderer.invoke('shell:showItemInFolder', path),
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
    // 云控端自定义菜单「应用内窗口」：独立隔离 BrowserWindow 加载外部页面
    openExternalWindow: (url: string, title?: string) => ipcRenderer.invoke('shell:openExternalWindow', url, title)
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    setTitleBarOverlay: (options: { color: string; symbolColor: string }) =>
      ipcRenderer.send('window:setTitleBarOverlay', options)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('runtimeConfig', getRuntimeConfig())
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
  // @ts-ignore
  window.runtimeConfig = getRuntimeConfig()
}
