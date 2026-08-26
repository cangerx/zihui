import { app, shell, BrowserWindow, session, nativeImage, protocol, ipcMain, Tray, Menu, screen } from 'electron'
import { join } from 'path'
import { createReadStream, existsSync, statSync } from 'fs'
import { Readable } from 'stream'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { getDatabase, closeDatabase } from './database'
import { registerIpcHandlers } from './ipc'
import { backfillCreationGallery } from './services/gallery'
import { cleanupStaleGenerations } from './services/image-generation'
import { getThumbnailBytes } from './services/thumbnail'
import { stopAllMcpServers, warmupEnabledMcpServers } from './services/mcp-server'
import { getDataDir } from './services/data-path'
import { runStartupTasks as runBackupStartupTasks, recoverInterruptedRestore } from './services/backup'
import { getRuntimeConfig } from './services/runtime-config'
import { getSetting } from './services/settings'
import { startAutoDownloadScheduler, stopAutoDownloadScheduler } from './services/video-generation'
import { startScheduler as startLocalVideoScheduler, stopScheduler as stopLocalVideoScheduler } from './services/local-video'
import {
  startScheduledTasksScheduler,
  stopScheduledTasksScheduler
} from './services/scheduled-tasks'
import { initAccountContext, isAccountReady } from './services/account-context'
import { runInEpoch } from './services/account-epoch'
import { getDeviceSetting, setDeviceSetting } from './services/device-settings'
import { notifyDesktop, appDisplayName } from './services/desktop-notify'
import {
  isTrayEnabled,
  registerTrayApplier,
  syncOpenAtLoginOnLaunch
} from './services/desktop-prefs'
import { startClawbotBridge, stopClawbotBridge, clawbotStartupMaintenance } from './services/clawbot/clawbot-bridge'
import { cancelAllChats } from './services/chat-engine'

if (is.dev) {
  process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'
}

function configureStableUserDataPath(): void {
  const cfg = getRuntimeConfig()
  if (cfg.buildMode !== 'oem' || !cfg.oemProjectKey) return
  const safeKey = cfg.oemProjectKey.replace(/[^a-z0-9-]/g, '').slice(0, 64)
  if (!safeKey) return
  app.setPath('userData', join(app.getPath('appData'), `local-agent-oem-${safeKey}`))
}

configureStableUserDataPath()

type WindowCloseBehavior = 'close-window' | 'minimize'

let isQuitting = false
// 系统托盘：常驻入口，让「关闭后仍在后台运行」可见、可重新唤起、可彻底退出。
let tray: Tray | null = null
const gotSingleInstanceLock = app.requestSingleInstanceLock()

function getLocalFileMime(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'svg') return 'image/svg+xml'
  if (ext === 'mp4') return 'video/mp4'
  if (ext === 'webm') return 'video/webm'
  if (ext === 'mov') return 'video/quicktime'
  if (ext === 'mkv') return 'video/x-matroska'
  if (ext === 'mpeg' || ext === 'mpg') return 'video/mpeg'
  return 'application/octet-stream'
}

function createLocalFileResponse(filePath: string, request: Request): Response {
  const stat = statSync(filePath)
  const mime = getLocalFileMime(filePath)
  const range = request.headers.get('range')
  if (range && stat.size > 0) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (match) {
      let start = match[1] ? Number(match[1]) : 0
      let end = match[2] ? Number(match[2]) : stat.size - 1
      if (!Number.isFinite(start) || start < 0) start = 0
      if (!Number.isFinite(end) || end >= stat.size) end = stat.size - 1
      if (start <= end) {
        const stream = createReadStream(filePath, { start, end })
        return new Response(Readable.toWeb(stream) as any, {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
          },
        })
      }
    }
  }
  const stream = createReadStream(filePath)
  return new Response(Readable.toWeb(stream) as any, {
    headers: {
      'Content-Type': mime,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

if (!gotSingleInstanceLock) {
  app.quit()
}

function getWindowCloseBehavior(): WindowCloseBehavior {
  try {
    // 设备级优先；老用户首次回退账号库旧值（迁移兼容），避免设置丢失。
    // 仅在账号已就绪时才回退读库——否则未登录关闭登录窗会触发 getDatabase()，凭空建出空库。
    let v = getDeviceSetting('window_close_behavior')
    if (v == null && isAccountReady()) {
      try { v = getSetting('window_close_behavior') } catch {}
    }
    return v === 'minimize' ? 'minimize' : 'close-window'
  } catch {
    return 'close-window'
  }
}

function createAppIcon(): Electron.NativeImage {
  const paths = [
    join(__dirname, '../../build/icon.png'),
    join(process.resourcesPath || '', 'icon.png')
  ]
  for (const p of paths) {
    if (!existsSync(p)) continue
    const img = nativeImage.createFromPath(p)
    if (img.isEmpty()) continue
    const { width } = img.getSize()
    return width > 256 ? img.resize({ width: 256, height: 256 }) : img
  }
  // 无 icon.png 时的兜底：透明底圆角黑方 + 白几何 H（Windows 不会再切圆角）
  const svg = `<svg width="256" height="256" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="256" height="256" rx="57" fill="#000000"/>
    <path fill="#FFFFFF" d="M52 44c0-6 5-11 11-11h42c5 0 9 4 9 9v62l48-36V52c0-5 4-9 9-9h42c6 0 11 5 11 11v156c0 6-5 11-11 11h-42c-5 0-9-4-9-9v-58l-48 36v36c0 5-4 9-9 9H63c-6 0-11-5-11-11V44z"/>
  </svg>`
  return nativeImage.createFromBuffer(Buffer.from(svg), { scaleFactor: 1 })
}

// 主窗口模块级引用：托盘唤起 / 更新事件发送都必须精确定位主窗口。
// 不能再用 BrowserWindow.getAllWindows() 泛找——外部页面窗口（openExternalWindow）、
// ewei 改图隐藏窗口等存活时，泛找会把它们误当主窗口 restore/focus，主窗口反而重建无望。
let mainWindowRef: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const isWin = process.platform === 'win32'
  const isMac = process.platform === 'darwin'
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const workArea = display.workAreaSize
  const width = Math.min(1440, Math.max(960, workArea.width - 48))
  const height = Math.min(900, Math.max(600, workArea.height - 48))
  // Windows：hidden + titleBarOverlay，右上角系统按钮，顶栏 app-drag。
  // macOS：hiddenInset，红绿灯落在侧栏顶（对齐 NewMax）；Linux 仍用原生标题栏。
  const winOptions: Electron.BrowserWindowConstructorOptions = {
    width,
    height,
    minWidth: 960,
    minHeight: 600,
    title: getRuntimeConfig().appName || '好伙伴',
    icon: createAppIcon(),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false
    }
  }
  if (isWin) {
    winOptions.frame = false
    winOptions.titleBarStyle = 'hidden'
    winOptions.titleBarOverlay = {
      color: '#ffffff',
      symbolColor: '#212529',
      height: 36
    }
  } else if (isMac) {
    winOptions.titleBarStyle = 'hiddenInset'
    winOptions.trafficLightPosition = { x: 16, y: 12 }
  }
  const mainWindow = new BrowserWindow(winOptions)
  mainWindow.on('page-title-updated', (e) => e.preventDefault())
  mainWindowRef = mainWindow
  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) mainWindowRef = null
  })

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    if (getWindowCloseBehavior() === 'minimize') {
      event.preventDefault()
      mainWindow.minimize()
      return
    }
    // close-window：窗口将被销毁、应用转入后台（托盘常驻）。首次关闭提示一次去向，
    // 避免用户以为已退出却仍在后台运行、又找不到入口。
    maybeNotifyCloseToTray()
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 可编辑区域右键：剪切/复制/粘贴/全选。Electron 默认不弹出系统编辑菜单，很多人用不习惯快捷键。
  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable && !params.selectionText) return
    const flags = params.editFlags
    const items: Electron.MenuItemConstructorOptions[] = params.isEditable
      ? [
          { label: '撤销', role: 'undo', enabled: flags.canUndo },
          { label: '重做', role: 'redo', enabled: flags.canRedo },
          { type: 'separator' },
          { label: '剪切', role: 'cut', enabled: flags.canCut },
          { label: '复制', role: 'copy', enabled: flags.canCopy },
          { label: '粘贴', role: 'paste', enabled: flags.canPaste },
          { type: 'separator' },
          { label: '全选', role: 'selectAll', enabled: flags.canSelectAll }
        ]
      : [{ label: '复制', role: 'copy', enabled: flags.canCopy }]
    Menu.buildFromTemplate(items).popup({ window: mainWindow })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const proto = new URL(details.url).protocol
      if (['http:', 'https:', 'mailto:', 'tel:'].includes(proto)) shell.openExternal(details.url)
    } catch { /* 非法/危险协议(javascript:/data: 等)忽略 */ }
    return { action: 'deny' }
  })

  // 全局兜底：拦截「原地导航」到外站。普通 <a href>（无 target）点击触发的是 will-navigate 而非
  // window.open，setWindowOpenHandler 拦不到；不拦则渲染窗口会跳离 SPA、被生产 CSP 拦资源→白屏，
  // 且无边框窗口无返回键回不来。仅放行 SPA 自身导航（dev 渲染源 / prod file:// / HMR / reload）。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    const isDevRenderer = is.dev && !!rendererUrl && url.startsWith(rendererUrl)
    const isLocalFile = url.startsWith('file://') && !/\.(png|ico|jpe?g|gif|webp|svg)(\?|$)/i.test(url)
    if (isDevRenderer || isLocalFile) return
    event.preventDefault()
    try {
      const proto = new URL(url).protocol
      if (['http:', 'https:', 'mailto:', 'tel:'].includes(proto)) shell.openExternal(url)
    } catch { /* 非法/危险协议忽略 */ }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    let loadFailed = false
    mainWindow.webContents.on('did-fail-load', (_event, code, desc, url, isMainFrame) => {
      if (!isMainFrame || loadFailed) return
      loadFailed = true
      console.error('[window] did-fail-load', code, desc, url)
      const html = `<!doctype html><meta charset="utf-8"><body style="font:14px/1.5 sans-serif;padding:48px;color:#222">
        <h1>界面加载失败</h1><p>${code}: ${desc}</p><p style="word-break:break-all">${url}</p></body>`
      mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    })
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function showOrCreateMainWindow(): void {
  const existingWindow = mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef : null
  if (!existingWindow) {
    createWindow()
    return
  }
  if (existingWindow.isMinimized()) existingWindow.restore()
  if (!existingWindow.isVisible()) existingWindow.show()
  existingWindow.focus()
}

// 创建系统托盘：左键/双击显示主界面，右键菜单可显示或彻底退出。
// 关闭窗口后应用仍在后台运行，托盘是用户重新唤起 / 主动退出的可见入口。
function createTray(): void {
  if (tray && !tray.isDestroyed()) return
  let icon = createAppIcon()
  try { icon = icon.resize({ width: 16, height: 16 }) } catch {}
  tray = new Tray(icon)
  const appName = getRuntimeConfig().appName || '好伙伴'
  tray.setToolTip(appName)
  const menu = Menu.buildFromTemplate([
    { label: '显示主界面', click: () => showOrCreateMainWindow() },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit() } }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => showOrCreateMainWindow())
  tray.on('double-click', () => showOrCreateMainWindow())
}

function destroyTray(): void {
  try {
    tray?.destroy()
  } catch {
    /* ignore */
  }
  tray = null
}

function applyTrayVisibility(show: boolean): void {
  if (show) createTray()
  else destroyTray()
}

// 首次「关闭到后台」时弹一次系统通知，说明应用去向与如何彻底退出；之后用设备级标记不再打扰。
function maybeNotifyCloseToTray(): void {
  try {
    if (getDeviceSetting('close_tray_hinted') === '1') return
    setDeviceSetting('close_tray_hinted', '1')
    notifyDesktop(
      `${appDisplayName()} 仍在后台运行`,
      '已收起到系统托盘。点击托盘图标可重新打开；如需彻底退出，请右键托盘图标选择「退出」。'
    )
  } catch (e) {
    console.error('[tray] close hint failed:', e)
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
])

app.commandLine.appendSwitch('ignore-certificate-errors')

// Windows 专用：屏蔽 Xbox Game Bar overlay 探测导致的「需要使用新应用以打开此
// ms-gamingoverlay 链接」弹窗。
// 触发场景：用户系统精简了 Xbox Game Bar UWP 包，但残留 ms-gamingoverlay 协议
// 注册表项；Electron 内嵌 Chromium 的 GPU 进程启动时探测 Game Bar 兼容性，
// Shell 找不到处理程序就弹窗。
if (process.platform === 'win32') {
  // 1) 减少 Chromium GPU 进程触发 Game Bar 探测的频率
  app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling')
  // 2) 兜底：把自己注册成 ms-gamingoverlay 协议处理器，让 Shell 总能找到处理者
  //    Chromium 探测通常只查注册表项是否存在，几乎不会真正启动协议
  try {
    app.setAsDefaultProtocolClient('ms-gamingoverlay')
  } catch {}
}

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    showOrCreateMainWindow()
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId(getRuntimeConfig().appId)

  protocol.handle('local-file', (request) => {
    try {
      const url = new URL(request.url)
      // 支持相对路径模式: local-file://img?rel=images/xxx/yyy.png
      // 也兼容绝对路径模式: local-file://img?p=C:/xxx/yyy.png (旧数据)
      let filePath = url.searchParams.get('rel') || ''
      if (!filePath) {
        filePath = url.searchParams.get('p') || ''
      } else {
        // 相对路径 → 拼接数据目录
        filePath = join(getDataDir(), filePath)
      }
      if (!filePath || !existsSync(filePath)) {
        return new Response('Not found', { status: 404 })
      }
      // 缩略图模式：?thumb=1 → 返回 360px JPEG 缩略图（首次生成后磁盘缓存）
      // 用于图库等多图列表，避免按原图分辨率解码导致的卡顿
      if (url.searchParams.get('thumb') === '1') {
        const thumb = getThumbnailBytes(filePath, true)
        if (thumb) {
          return new Response(new Uint8Array(thumb.data), {
            headers: {
              'Content-Type': thumb.mime,
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=86400'
            }
          })
        }
        // 缩略图生成失败时回退原图，避免一直显示灰色占位图
        return createLocalFileResponse(filePath, request)
      }
      return createLocalFileResponse(filePath, request)
    } catch (e) {
      console.error('local-file protocol error:', e)
      return new Response('Error', { status: 500 })
    }
  })

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    headers['Content-Security-Policy'] = [
      is.dev
        ? "default-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ws: wss: https: http:; img-src 'self' data: https: http: local-file:; media-src 'self' https: http: local-file: blob:"
        : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https: http:; img-src 'self' data: https: http: local-file:; media-src 'self' https: http: local-file: blob:"
    ]
    // Bypass CORS for cloud API requests（apiDomain 由 inject 注入，dev fallback 默认）
    const apiHost = (() => {
      try { return new URL(getRuntimeConfig().apiDomain).hostname } catch { return '' }
    })()
    if (apiHost && details.url.includes(apiHost)) {
      headers['Access-Control-Allow-Origin'] = ['*']
      headers['Access-Control-Allow-Headers'] = ['*']
      headers['Access-Control-Allow-Methods'] = ['*']
    }
    callback({ responseHeaders: headers })
  })

  // 账号数据隔离：在恢复自愈与打开数据库【之前】先确定当前账号目录并注入 data-path。
  // 时序硬约束——否则 recoverInterruptedRestore() / getDatabase() 会落到错误目录。
  try {
    initAccountContext()
  } catch (e) {
    console.error('[account] initAccountContext failed:', e)
  }

  // 桌面端必须登录才能使用：仅当账号已确定（已登录用户读 account-map / 老用户原地继承）时
  // 才打开数据库并跑依赖 db 的启动任务。全新且从未登录时不建任何库（无 guest），停在登录页；
  // 用户登录后 setActiveAccount 触发热切换（关旧库开新库 + reload 渲染层），渲染层重载后即进入此就绪分支。
  if (isAccountReady()) {
    // 崩溃自愈：上次"恢复"中途被中断时，回滚到恢复前数据。
    // 必须在打开数据库【之前】同步执行，避免新/半成品 db 被打开后产生文件锁导致回滚失败。
    try {
      recoverInterruptedRestore()
    } catch (e) {
      console.error('[backup] restore self-heal failed:', e)
    }

    // 启动期 db 任务统一绑定当前账号代次（epoch=启动时的 0）：若用户在这些任务（尤其异步的自动备份）
    // 进行中登录切到别的账号（热切换会 bumpEpoch），任务 await 后的 getDatabase() 将因代次不符被
    // assertEpoch 拒绝，避免把旧账号的回填/清理/备份数据写进新账号库。
    // （relaunch 版靠进程重启天然规避此问题，热切换不重启进程，需显式用 runInEpoch 绑定。）
    runInEpoch(() => {
      // Initialize database
      try {
        getDatabase()
      } catch (e) {
        console.error('[db] initialize failed:', e)
        return
      }

      // 一次性回填：将已存在的 image_generations.result_path 归入图库「创作」分类
      // 通过 settings.gallery_backfill_done 标记幂等，仅首次启动跑
      try {
        const result = backfillCreationGallery()
        if (result.total > 0) {
          console.log(`[Gallery] Backfill creation: added ${result.added}, skipped ${result.skipped}, total ${result.total}`)
        }
      } catch (e) {
        console.error('[Gallery] Backfill failed:', e)
      }

      // 启动时清理上次崩溃残留的"生成中"图片任务（避免 UI 永久转圈）
      try {
        cleanupStaleGenerations()
      } catch (e) {
        console.error('[ImageGen] cleanupStaleGenerations failed:', e)
      }

      // Backup startup tasks: 清理上次崩溃残骸 + 异步触发自动备份（如配置）
      runBackupStartupTasks().catch((e) => console.error('Backup startup error:', e))
      startAutoDownloadScheduler()
      startLocalVideoScheduler()
      startScheduledTasksScheduler()

      // 微信 ClawBot 桥：僵尸状态清理（connecting/paused 是进程级暂态）+ 日志 pruning +
      // 凭据存在且启用时自动起 getupdates 长轮询（关窗到托盘后继续收发消息靠它）
      try { clawbotStartupMaintenance() } catch (e) { console.error('[clawbot] maintenance failed:', e) }
      void startClawbotBridge().catch((e) => console.error('[clawbot] start failed:', e))

      // 后台预热 enabled 的 MCP 服务：避免首次对话调用工具时才现拉起进程 + 60s 握手造成长时间无响应。
      // 延后到 UI 起来后再拉，避免与启动期关键 IO 抢资源；fire-and-forget，失败只记状态（MCP 页可见）。
      setTimeout(() => {
        try { warmupEnabledMcpServers() } catch (e) { console.error('[mcp] warmup failed:', e) }
      }, 1500)
    })
  }

  // Register all IPC handlers（不依赖 db，始终注册：登录页也要用 cloud/dataDir 等 IPC）
  registerIpcHandlers()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  // 开机自启：按已存设备偏好同步 OS Login Item
  try {
    syncOpenAtLoginOnLaunch()
  } catch (e) {
    console.error('[desktop-prefs] sync openAtLogin failed:', e)
  }

  // 系统托盘：可按设置开关；关闭窗口后靠托盘重新唤起 / 彻底退出
  registerTrayApplier(applyTrayVisibility)
  try {
    if (isTrayEnabled()) createTray()
  } catch (e) {
    console.error('[tray] create failed:', e)
  }

  // Auto updater (production only)
  if (!is.dev) {
    setupAutoUpdater()
  }

  app.on('activate', () => {
    showOrCreateMainWindow()
  })
})
}

function setupAutoUpdater(): void {
  const feed = (getRuntimeConfig().updateUrl || '').trim()
  if (feed && !feed.includes('your-cdn-domain.example.com') && !feed.includes('your-admin-domain.example.com')) {
    const url = feed.endsWith('/') ? feed : `${feed}/`
    autoUpdater.setFeedURL({ provider: 'generic', url })
  }
  autoUpdater.autoDownload = false
  // mac 未签名场景：Squirrel.Mac 在 quitAndInstall 阶段调 SecCodeCheckValidity 校验当前
  // 运行 .app 的代码签名，未签名直接 reject，UI 上「下载完成 → 点重启安装」会变成
  // 「app 退出但 .app 没被替换 → 重启依然是旧版」的静默失败。
  // 更关键：electron-updater MacUpdater 在 update-downloaded 后若 autoInstallOnAppQuit=true，
  // 会立刻调 nativeUpdater(Squirrel.Mac).checkForUpdates() 触发签名校验，未签名直接 emit
  // error → 我们的 UI 状态机会从「下载完成」秒切到「更新失败」。所以 mac 必须把
  // autoInstallOnAppQuit 关掉，配合下面 updater:install 改为「打开下载目录」走手动覆盖。
  // 等接入 Apple Developer 签名+公证后这两段都可以回滚。
  autoUpdater.autoInstallOnAppQuit = process.platform !== 'darwin'

  let downloadedFilePath: string | null = null

  function sendToRenderer(channel: string, ...args: unknown[]): void {
    // 只发主窗口（模块级引用）：外部页面窗口 / ewei 隐藏窗口存活时 getAllWindows()[0] 会发错对象
    const win = mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef : null
    if (win) win.webContents.send(channel, ...args)
  }

  autoUpdater.on('update-available', (info) => {
    sendToRenderer('updater:available', { version: info.version, releaseNotes: info.releaseNotes })
  })

  autoUpdater.on('update-not-available', () => {
    sendToRenderer('updater:not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('updater:progress', { percent: Math.round(progress.percent), transferred: progress.transferred, total: progress.total })
  })

  autoUpdater.on('update-downloaded', (info: any) => {
    downloadedFilePath = typeof info?.downloadedFile === 'string' ? info.downloadedFile : null
    sendToRenderer('updater:downloaded', { manualInstall: process.platform === 'darwin' })
  })

  autoUpdater.on('error', (err) => {
    sendToRenderer('updater:error', err?.message || String(err))
  })

  // IPC from renderer
  ipcMain.handle('updater:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return { currentVersion: app.getVersion(), latestVersion: result?.updateInfo?.version }
    } catch (e: any) {
      return { error: e?.message || String(e) }
    }
  })

  ipcMain.handle('updater:download', () => {
    autoUpdater.downloadUpdate()
  })

  ipcMain.handle('updater:install', () => {
    // mac 未签名兜底：跳过 Squirrel.Mac（必失败），在 Finder 中高亮 zip，
    // 用户手动覆盖 /Applications/{App}.app。等签名+公证落地后此分支可删。
    if (process.platform === 'darwin') {
      if (downloadedFilePath) {
        shell.showItemInFolder(downloadedFilePath)
        return { mode: 'manual', path: downloadedFilePath }
      }
      return { error: 'no_downloaded_file' }
    }
    autoUpdater.quitAndInstall(false, true)
    return { mode: 'auto' }
  })

  ipcMain.handle('updater:getVersion', () => app.getVersion())

  // Check for updates 3 seconds after startup
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 3000)
}

app.on('window-all-closed', () => {})

app.on('before-quit', () => {
  isQuitting = true
  stopAutoDownloadScheduler()
  stopLocalVideoScheduler()
  stopScheduledTasksScheduler()
  // 退出前中断全部在途对话轮次：abort 触发各轮 catch 落 [已中断] 标记+补配对，
  // 重启后用户可「继续生成」（此前直接退出，会话静默断在半截且无续写入口）
  try { cancelAllChats() } catch {}
  stopAllMcpServers()
  try { stopClawbotBridge() } catch {}
  closeDatabase()
  try { tray?.destroy() } catch {}
  tray = null
})
