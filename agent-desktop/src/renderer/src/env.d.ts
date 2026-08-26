/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __DEV_API_DOMAIN__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Window {
  electron: typeof import('@electron-toolkit/preload').electronAPI
  api: {
    db: { query: (channel: string, ...args: unknown[]) => Promise<unknown> }
    canvas: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    deck: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      /** deck:progress 进度回调；payload = { reqId, phase:'outline'|'slide', done, total }。返回 unsubscribe */
      onProgress: (callback: (data: unknown) => void) => () => void
    }
    gallery: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    creativeTemplate: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    stylePreset: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    matting: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      /**
       * 抠图任务进度回调；payload = { taskId, phase: 'uploading'|'processing'|'downloading'|'done', message? }
       * 返回 unsubscribe 函数，多视图共用此信道时可安全 off 自己的监听器。
       */
      onProgress: (
        callback: (data: {
          taskId: string
          phase: 'uploading' | 'processing' | 'downloading' | 'done'
          message?: string
        }) => void,
      ) => () => void
    }
    fineMatting: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      /**
       * 精细抠图任务进度回调；payload = { taskId, phase: 'uploading'|'processing'|'downloading'|'done', message? }
       * 返回 unsubscribe 函数，多视图共用此信道时可安全 off 自己的监听器。
       */
      onProgress: (
        callback: (data: {
          taskId: string
          phase: 'uploading' | 'processing' | 'downloading' | 'done'
          message?: string
        }) => void,
      ) => () => void
    }
    aiMarkRemoval: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    videoGen: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      onUpdated: (callback: (data: unknown) => void) => () => void
      onDeleted: (callback: (data: unknown) => void) => () => void
    }
    viralClone: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    model: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    persona: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    knowledge: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    brandWorkspace: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    agentWorkspace: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    brand: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    bot: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    chat: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      onStream: (callback: (data: unknown) => void) => () => void
      offStream: () => void
      onTitleUpdated: (callback: (data: unknown) => void) => void
      offTitleUpdated: () => void
      onToolApproval: (callback: (data: unknown) => void) => void
      offToolApproval: () => void
      onToolApprovalResolved: (callback: (data: unknown) => void) => void
      offToolApprovalResolved: () => void
      onAppendMessage: (callback: (data: unknown) => void) => void
      offAppendMessage: () => void
      onUpdateMessage: (callback: (data: unknown) => void) => void
      offUpdateMessage: () => void
    }
    skill: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    mcp: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      onStatus: (callback: (data: unknown) => void) => () => void
    }
    mcpMarket: {
      invoke: <T = any>(channel: string, ...args: any[]) => Promise<T>
    }
    promptSkill: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    settings: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    deviceSettings: {
      get: (key: string) => Promise<string | null>
      set: (key: string, value: string) => Promise<void>
    }
    python: {
      status: () => Promise<{
        ready: boolean
        path?: string
        version?: string
        hasPptx?: boolean
        reason?: string
        installUrl: string
        installHint: string
      }>
      ensure: () => Promise<{
        ready: boolean
        path?: string
        version?: string
        hasPptx?: boolean
        reason?: string
        installUrl: string
        installHint: string
      }>
      setPath: (filePath: string) => Promise<{
        ready: boolean
        path?: string
        version?: string
        hasPptx?: boolean
        reason?: string
        installUrl: string
        installHint: string
      }>
      clearOverride: () => Promise<{
        ready: boolean
        path?: string
        version?: string
        hasPptx?: boolean
        reason?: string
        installUrl: string
        installHint: string
      }>
      onRequired: (
        callback: (data: { reason: string; installUrl: string; installHint: string }) => void
      ) => () => void
    }
    distill: {
      inspect: (conversationId: string) => Promise<{
        eligible: boolean
        reason: string
        ua: number
        coveredCount: number
        record: {
          conversation_id: string
          kb_id: string
          file_path: string
          covered_count: number
          status: string
          updated_at: string
        } | null
        mode: 'ask' | 'auto' | 'off'
      }>
      getMode: () => Promise<'ask' | 'auto' | 'off'>
      setMode: (mode: 'ask' | 'auto' | 'off') => Promise<'ask' | 'auto' | 'off'>
      skip: (conversationId: string) => Promise<unknown>
      run: (
        conversationId: string,
        force?: boolean
      ) => Promise<{
        ok: boolean
        skipped?: boolean
        reason?: string
        filePath?: string
        kbId?: string
        vectorized?: boolean
        warning?: string
        coveredCount?: number
      }>
    }
    desktopPrefs: {
      get: () => Promise<{
        openAtLogin: boolean
        showTray: boolean
        notificationsEnabled: boolean
        notificationSound: 'default' | 'quiet'
      }>
      update: (patch: Partial<{
        openAtLogin: boolean
        showTray: boolean
        notificationsEnabled: boolean
        notificationSound: 'default' | 'quiet'
      }>) => Promise<{
        openAtLogin: boolean
        showTray: boolean
        notificationsEnabled: boolean
        notificationSound: 'default' | 'quiet'
      }>
      testNotification: () => Promise<boolean>
    }
    llm: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    usage: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    dailyReview: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    scheduledTasks: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      onChanged: (callback: () => void) => () => void
    }
    browser: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
    imageGen: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      onProgress: (callback: (data: unknown) => void) => void
      offProgress: () => void
    }
    imageExport: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    }
    vectorize: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      checkModelMismatch: () => Promise<{
        mismatch: boolean
        reason: 'empty' | 'multiple_models' | 'model_changed' | 'config_error' | 'consistent'
        current?: { model: string; source: 'cloud' | 'local' }
        legacy?: Array<{ model: string; dim: number; source: string; chunk_count: number }>
        totalChunks: number
      }>
      reembedAll: () => Promise<{ processed: number; failed: number }>
      onProgress: (callback: (data: unknown) => void) => void
      offProgress: () => void
    }
    cloud: {
      setToken: (token: string | null) => Promise<void>
      getToken: () => Promise<string | null>
      onTokenUpdated: (callback: (data: { token: string }) => void) => () => void
      onAuthExpired: (callback: (data: { reason?: string }) => void) => () => void
      setPermissions: (perms: Record<string, any>) => Promise<void>
      getDeviceId: () => Promise<string>
      setActiveAccount: (id: number | string | null) => Promise<{ switched: boolean }>
      setEmbeddingModels: (models: Array<{ id: number; model_id: string; name: string }>) => Promise<void>
      setModels: (
        models: Array<{
          id: number
          model_id: string
          name: string
          type: string
          provider_name: string
          provider_type?: string
        }>,
      ) => Promise<void>
      setPreferredEmbeddingModel: (modelId: string) => Promise<void>
      getEmbeddingState: () => Promise<{
        models: Array<{ id: number; model_id: string; name: string }>
        preferred: string
        active: string
        allowCustomEmbedding: boolean
      }>
      uploadInspiration: (params: {
        resultPath: string
        title: string
        categoryId: number
        promptLang: 'cn' | 'en'
        promptText: string
        refImages?: string[]
        generationSize?: string
      }) => Promise<{
        ok: boolean
        error?: string
        data?: any
        compressed?: boolean
      }>
      downloadVideo: (url: string, defaultName?: string) => Promise<{
        success: boolean
        path?: string
        error?: string
      }>
    }
    clipboard: {
      writeImage: (filePath: string) => Promise<{ success: boolean; error?: string }>
    }
    updater: {
      check: () => Promise<{ currentVersion?: string; latestVersion?: string; error?: string }>
      download: () => Promise<void>
      install: () => Promise<void>
      getVersion: () => Promise<string>
      onAvailable: (cb: (data: { version: string; releaseNotes?: string }) => void) => void
      onNotAvailable: (cb: () => void) => void
      onProgress: (cb: (data: { percent: number; transferred: number; total: number }) => void) => void
      onDownloaded: (cb: (data: { manualInstall?: boolean }) => void) => void
      onError: (cb: (msg: string) => void) => void
      offAll: () => void
    }
    backup: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      onProgress: (
        callback: (data: {
          phase: 'snapshot' | 'pack' | 'verify' | 'extract' | 'apply'
          current: number
          total: number
          fileName: string
          bytes?: number
        }) => void
      ) => void
      offProgress: () => void
    }
    sync: {
      status: () => Promise<{
        running: boolean
        lastSyncAt: number
        lastError: string
        pendingChanges: number
        conflicts: number
      }>
      now: () => Promise<{ ok: boolean; error?: string }>
      getConfig: () => Promise<{
        mode: 'off' | 'realtime' | 'hourly' | 'daily'
        scope: { data: boolean; image: boolean; video: boolean }
        conflict: 'merge' | 'local' | 'cloud'
      }>
      setConfig: (patch: Record<string, unknown>) => Promise<unknown>
      getQuota: () => Promise<{
        used: number
        base_quota: number
        extra_quota: number
        total: number
        percent: number
        error?: string
      }>
      getConflicts: () => Promise<any[]>
      getLocalStats: () => Promise<{ count: number; bytes: number; uploaded: number }>
      onProgress: (callback: (data: any) => void) => () => void
      onStatus: (callback: (data: any) => void) => () => void
    }
    dialog: { openFile: (options?: unknown) => Promise<unknown> }
    nativeDialog: {
      alert: (message?: unknown) => void
      confirm: (message?: unknown) => boolean
    }
    shell: {
      openPath: (path: string) => Promise<string>
      showItemInFolder: (path: string) => Promise<{ success: boolean; path?: string; fallback?: string; error?: string }>
      openExternal: (url: string) => Promise<unknown>
      openExternalWindow: (url: string, title?: string) => Promise<{ success: boolean; error?: string }>
    }
    window: {
      minimize: () => void
      maximize: () => void
      close: () => void
    }
  }
}
