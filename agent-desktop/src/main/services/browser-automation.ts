/**
 * D-23 内置浏览器自动化：独立 Electron 窗口（工具栏 + 分区 Profile）。
 * Cookie / 登录态按账号目录 + Profile 隔离；对话工具走 executeBrowserAction。
 * 不做 Chrome 扩展配对、不做 Workflow 录制。
 */
import { BrowserView, BrowserWindow, ipcMain, session } from 'electron'
import { basename, dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { v4 as uuid } from 'uuid'
import { getDataDir } from './data-path'
import { resolveInWorkspace } from './skill-sandbox'

export interface BrowserProfile {
  id: string
  name: string
  builtin?: boolean
  created_at: string
}

export interface BrowserWindowStatus {
  profileId: string
  open: boolean
  url: string
  title: string
}

interface BrowserSession {
  profileId: string
  shell: BrowserWindow
  view: BrowserView
  urlBarFocused: boolean
}

const DEFAULT_PROFILE_ID = 'default'
const STORE_FILE = 'browser-profiles.json'
const MAX_SNAPSHOT_ELEMENTS = 80
const TOOLBAR_H = 44

const sessions = new Map<string, BrowserSession>()
let chromeIpcBound = false

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const CHROME_PRELOAD_SOURCE = `'use strict'
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('browserChrome', {
  back: () => ipcRenderer.invoke('browserChrome:back'),
  forward: () => ipcRenderer.invoke('browserChrome:forward'),
  reload: () => ipcRenderer.invoke('browserChrome:reload'),
  navigate: (url) => ipcRenderer.invoke('browserChrome:navigate', url),
  setUrlFocused: (focused) => ipcRenderer.send('browserChrome:urlFocused', !!focused),
  onState: (callback) => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('browserChrome:state', handler)
    return () => ipcRenderer.off('browserChrome:state', handler)
  }
})
`

function chromePreloadPath(): string {
  const dest = join(getDataDir(), 'browser-chrome-preload.cjs')
  writeFileSync(dest, CHROME_PRELOAD_SOURCE)
  return dest
}

const CHROME_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; background: #f3f1ec; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .bar { display: flex; align-items: center; gap: 6px; height: 44px; padding: 0 8px; border-bottom: 1px solid #e4e0d8; }
    button { width: 28px; height: 28px; border: 0; background: transparent; border-radius: 6px; color: #3f3f3c; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    button:disabled { opacity: .35; cursor: default; }
    button:not(:disabled):hover { background: #e8e4dc; }
    input { flex: 1; height: 28px; border: 1px solid #ddd8ce; border-radius: 8px; padding: 0 10px; font-size: 12px; outline: none; background: #fff; color: #222; }
    input:focus { border-color: #23574f; }
    input.error { border-color: #c45c4a; }
  </style>
</head>
<body>
  <div class="bar">
    <button id="back" title="后退" disabled>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 18l-6-6 6-6"/></svg>
    </button>
    <button id="forward" title="前进" disabled>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18l6-6-6-6"/></svg>
    </button>
    <button id="reload" title="刷新">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12a9 9 0 11-3-6.7"/><path d="M21 3v6h-6"/></svg>
    </button>
    <input id="url" type="text" spellcheck="false" placeholder="输入网址或搜索词，回车打开" />
  </div>
  <script>
    const api = window.browserChrome
    const back = document.getElementById('back')
    const forward = document.getElementById('forward')
    const reload = document.getElementById('reload')
    const input = document.getElementById('url')
    let composing = false
    function isImeEnter(e) {
      return composing || e.isComposing || e.keyCode === 229
    }
    async function go() {
      const value = input.value
      input.classList.remove('error')
      input.blur()
      api.setUrlFocused(false)
      const res = await api.navigate(value)
      if (!res || res.ok === false) {
        input.classList.add('error')
        input.focus()
        api.setUrlFocused(true)
      }
    }
    back.onclick = () => api.back()
    forward.onclick = () => api.forward()
    reload.onclick = () => api.reload()
    input.addEventListener('compositionstart', () => { composing = true })
    input.addEventListener('compositionend', () => { composing = false })
    input.addEventListener('focus', () => {
      api.setUrlFocused(true)
      input.select()
    })
    input.addEventListener('blur', () => api.setUrlFocused(false))
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return
      if (isImeEnter(e)) return
      e.preventDefault()
      go()
    })
    api.onState((s) => {
      if (document.activeElement !== input) {
        input.value = s.url || ''
        input.classList.remove('error')
      }
      back.disabled = !s.canGoBack
      forward.disabled = !s.canGoForward
    })
  </script>
</body>
</html>`

function profilesPath(): string {
  return join(getDataDir(), STORE_FILE)
}

function defaultProfile(): BrowserProfile {
  return { id: DEFAULT_PROFILE_ID, name: '默认', builtin: true, created_at: new Date().toISOString() }
}

function readStore(): BrowserProfile[] {
  const path = profilesPath()
  if (!existsSync(path)) return [defaultProfile()]
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.profiles) ? raw.profiles : []
    const profiles: BrowserProfile[] = []
    for (const item of list) {
      if (!item || typeof item.id !== 'string' || typeof item.name !== 'string') continue
      profiles.push({
        id: item.id,
        name: item.name.trim() || '未命名',
        builtin: item.id === DEFAULT_PROFILE_ID || !!item.builtin,
        created_at: typeof item.created_at === 'string' ? item.created_at : new Date().toISOString()
      })
    }
    if (!profiles.some((p) => p.id === DEFAULT_PROFILE_ID)) {
      profiles.unshift(defaultProfile())
    }
    return profiles
  } catch {
    return [defaultProfile()]
  }
}

function writeStore(profiles: BrowserProfile[]): void {
  const dir = getDataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(profilesPath(), JSON.stringify(profiles, null, 2), 'utf-8')
}

function ensureStore(): BrowserProfile[] {
  const profiles = readStore()
  if (!existsSync(profilesPath())) writeStore(profiles)
  return profiles
}

function sanitizePart(value: string, fallback: string): string {
  const cleaned = String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 48)
  return cleaned || fallback
}

function partitionFor(profileId: string): string {
  const account = sanitizePart(basename(getDataDir()), 'acct')
  const pid = sanitizePart(profileId, DEFAULT_PROFILE_ID)
  return `persist:browser-${account}-${pid}`
}

export function listProfiles(): BrowserProfile[] {
  return ensureStore()
}

export function getProfile(id: string): BrowserProfile | null {
  return ensureStore().find((p) => p.id === id) || null
}

export function createProfile(name: string): BrowserProfile {
  const profiles = ensureStore()
  const profile: BrowserProfile = {
    id: uuid(),
    name: String(name || '').trim() || '未命名',
    created_at: new Date().toISOString()
  }
  profiles.push(profile)
  writeStore(profiles)
  return profile
}

export function renameProfile(id: string, name: string): BrowserProfile | null {
  const profiles = ensureStore()
  const hit = profiles.find((p) => p.id === id)
  if (!hit) return null
  const next = String(name || '').trim()
  if (!next) return hit
  hit.name = next
  writeStore(profiles)
  const sess = sessions.get(id)
  if (sess && !sess.shell.isDestroyed()) sess.shell.setTitle(`浏览器 · ${hit.name}`)
  return hit
}

export async function deleteProfile(id: string): Promise<{ ok: boolean; error?: string }> {
  if (id === DEFAULT_PROFILE_ID) return { ok: false, error: '默认 Profile 不能删除' }
  const profiles = ensureStore()
  if (!profiles.some((p) => p.id === id)) return { ok: false, error: 'Profile 不存在' }
  closeWindow(id)
  try {
    await session.fromPartition(partitionFor(id)).clearStorageData()
  } catch (e: any) {
    console.warn('[browser] clearStorageData failed:', e?.message || e)
  }
  writeStore(profiles.filter((p) => p.id !== id))
  return { ok: true }
}

function normalizeHttpUrl(raw: string): string | null {
  const t = String(raw || '').trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t)
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString()
      return null
    } catch {
      return null
    }
  }
  if (/^(localhost|127\.0\.0\.1)(:\d+)?([/?#].*)?$/i.test(t)) return `http://${t}`
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(t)) return `https://${t}`
  return null
}

function resolveNavTarget(raw: string): string | null {
  const t = String(raw || '').trim()
  if (!t) return null
  return normalizeHttpUrl(t) || `https://www.baidu.com/s?wd=${encodeURIComponent(t)}`
}

function isAllowedNav(url: string): boolean {
  if (url === 'about:blank') return true
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function pageWc(sess: BrowserSession) {
  return sess.view.webContents
}

function waitForLoad(sess: BrowserSession, timeoutMs = 25000): Promise<void> {
  return new Promise((resolve) => {
    const wc = pageWc(sess)
    if (sess.shell.isDestroyed() || wc.isDestroyed()) {
      resolve()
      return
    }
    if (!wc.isLoadingMainFrame()) {
      resolve()
      return
    }
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      wc.removeListener('did-finish-load', finish)
      wc.removeListener('did-fail-load', finish)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    wc.once('did-finish-load', finish)
    wc.once('did-fail-load', finish)
  })
}

async function settle(sess: BrowserSession): Promise<void> {
  await waitForLoad(sess)
  await sleep(350)
}

function pageInfo(sess: BrowserSession): { url: string; title: string } {
  if (sess.shell.isDestroyed() || pageWc(sess).isDestroyed()) return { url: '', title: '' }
  const wc = pageWc(sess)
  return { url: wc.getURL(), title: wc.getTitle() }
}

function pushChromeState(sess: BrowserSession): void {
  if (sess.shell.isDestroyed() || sess.shell.webContents.isDestroyed()) return
  const wc = pageWc(sess)
  if (wc.isDestroyed()) return
  const info = pageInfo(sess)
  sess.shell.webContents.send('browserChrome:state', {
    url: info.url === 'about:blank' ? '' : info.url,
    title: info.title,
    canGoBack: wc.canGoBack(),
    canGoForward: wc.canGoForward()
  })
}

function layoutView(sess: BrowserSession): void {
  if (sess.shell.isDestroyed()) return
  const [w, h] = sess.shell.getContentSize()
  sess.view.setBounds({ x: 0, y: TOOLBAR_H, width: w, height: Math.max(0, h - TOOLBAR_H) })
}

function sessionFromSender(sender: Electron.WebContents): BrowserSession | null {
  for (const sess of sessions.values()) {
    if (!sess.shell.isDestroyed() && sess.shell.webContents === sender) return sess
  }
  return null
}

function focusUrlBar(sess: BrowserSession): void {
  if (sess.shell.isDestroyed() || sess.shell.webContents.isDestroyed()) return
  sess.urlBarFocused = true
  sess.shell.webContents.focus()
  void sess.shell.webContents.executeJavaScript(
    `(() => { const el = document.getElementById('url'); if (el) { el.focus(); el.select(); } })()`
  ).catch(() => {})
}

function bindAddressBarShortcuts(sess: BrowserSession): void {
  const onAccel = (event: Electron.Event, input: Electron.Input) => {
    if (input.type !== 'keyDown') return
    const key = String(input.key || '').toLowerCase()
    if ((input.meta || input.control) && key === 'l') {
      event.preventDefault()
      focusUrlBar(sess)
    }
  }
  sess.shell.webContents.on('before-input-event', onAccel)
  sess.view.webContents.on('before-input-event', onAccel)
  sess.view.webContents.on('focus', () => {
    if (sess.urlBarFocused) focusUrlBar(sess)
  })
  sess.view.webContents.on('did-finish-load', () => {
    layoutView(sess)
    if (sess.urlBarFocused) focusUrlBar(sess)
  })
}

function bindChromeIpc(): void {
  if (chromeIpcBound) return
  chromeIpcBound = true
  ipcMain.on('browserChrome:urlFocused', (event, focused: boolean) => {
    const sess = sessionFromSender(event.sender)
    if (sess) sess.urlBarFocused = !!focused
  })
  ipcMain.handle('browserChrome:back', (event) => {
    const sess = sessionFromSender(event.sender)
    if (!sess) return { ok: false }
    const wc = pageWc(sess)
    if (wc.canGoBack()) wc.goBack()
    return { ok: true }
  })
  ipcMain.handle('browserChrome:forward', (event) => {
    const sess = sessionFromSender(event.sender)
    if (!sess) return { ok: false }
    const wc = pageWc(sess)
    if (wc.canGoForward()) wc.goForward()
    return { ok: true }
  })
  ipcMain.handle('browserChrome:reload', (event) => {
    const sess = sessionFromSender(event.sender)
    if (!sess) return { ok: false }
    pageWc(sess).reload()
    return { ok: true }
  })
  ipcMain.handle('browserChrome:navigate', async (event, raw: string) => {
    const sess = sessionFromSender(event.sender)
    if (!sess) return { ok: false, error: '窗口已关闭' }
    const target = resolveNavTarget(raw)
    if (!target) return { ok: false, error: '请输入网址或搜索词' }
    sess.urlBarFocused = false
    await pageWc(sess).loadURL(target)
    pageWc(sess).focus()
    return { ok: true }
  })
}

function attachPageGuards(sess: BrowserSession): void {
  const wc = pageWc(sess)
  const denyBad = (event: Electron.Event, navUrl: string) => {
    if (isAllowedNav(navUrl)) return
    event.preventDefault()
  }
  wc.on('will-navigate', denyBad)
  wc.on('will-redirect', denyBad)
  wc.setWindowOpenHandler((details) => {
    if (isAllowedNav(details.url)) {
      wc.loadURL(details.url).catch(() => {})
    }
    return { action: 'deny' }
  })
  const onNav = () => {
    const info = pageInfo(sess)
    if (!sess.shell.isDestroyed()) {
      const profile = getProfile(sess.profileId)
      sess.shell.setTitle(info.title ? `${info.title} · ${profile?.name || '浏览器'}` : `浏览器 · ${profile?.name || ''}`)
    }
    pushChromeState(sess)
  }
  wc.on('did-navigate', onNav)
  wc.on('did-navigate-in-page', onNav)
  wc.on('did-finish-load', onNav)
  wc.on('page-title-updated', onNav)
}

function ensureSession(profile: BrowserProfile): BrowserSession {
  const existing = sessions.get(profile.id)
  if (existing && !existing.shell.isDestroyed()) return existing
  bindChromeIpc()

  const shell = new BrowserWindow({
    width: 1200,
    height: 800,
    title: `浏览器 · ${profile.name}`,
    autoHideMenuBar: true,
    webPreferences: {
      preload: chromePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: partitionFor(profile.id)
    }
  })
  shell.setBrowserView(view)
  const sess: BrowserSession = { profileId: profile.id, shell, view, urlBarFocused: true }
  layoutView(sess)
  shell.on('resize', () => layoutView(sess))
  shell.on('resized', () => layoutView(sess))
  shell.on('maximize', () => layoutView(sess))
  shell.on('unmaximize', () => layoutView(sess))
  shell.on('show', () => layoutView(sess))
  attachPageGuards(sess)
  bindAddressBarShortcuts(sess)
  shell.webContents.once('did-finish-load', () => {
    layoutView(sess)
    focusUrlBar(sess)
  })
  shell.on('closed', () => {
    if (sessions.get(profile.id) === sess) sessions.delete(profile.id)
  })
  sessions.set(profile.id, sess)
  void shell.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(CHROME_HTML))
  return sess
}

export function closeWindow(profileId: string): { ok: boolean } {
  const sess = sessions.get(profileId)
  if (sess && !sess.shell.isDestroyed()) {
    sess.shell.close()
  }
  sessions.delete(profileId)
  return { ok: true }
}

export function closeAllBrowserWindows(): void {
  for (const [id, sess] of sessions) {
    try {
      if (!sess.shell.isDestroyed()) sess.shell.close()
    } catch {
      /* ignore */
    }
    sessions.delete(id)
  }
}

export function isBrowserAutomationWindow(win: BrowserWindow): boolean {
  for (const sess of sessions.values()) {
    if (sess.shell === win) return true
  }
  return false
}

export function getWindowStatus(profileId?: string): BrowserWindowStatus[] {
  const ids = profileId ? [profileId] : ensureStore().map((p) => p.id)
  return ids.map((id) => {
    const sess = sessions.get(id)
    const open = !!(sess && !sess.shell.isDestroyed())
    const info = open && sess ? pageInfo(sess) : { url: '', title: '' }
    return { profileId: id, open, url: info.url, title: info.title }
  })
}

async function runPageScript<T>(sess: BrowserSession, script: string): Promise<T> {
  const wc = pageWc(sess)
  if (sess.shell.isDestroyed() || wc.isDestroyed()) {
    throw new Error('浏览器窗口已关闭')
  }
  return (await wc.executeJavaScript(script, true)) as T
}

const SNAPSHOT_SCRIPT = `(() => {
  const sel = 'a, button, input, textarea, select, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [contenteditable="true"]'
  const nodes = Array.from(document.querySelectorAll(sel))
  const visible = nodes.filter((el) => {
    const r = el.getBoundingClientRect()
    const st = window.getComputedStyle(el)
    return r.width >= 2 && r.height >= 2 && st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0'
  }).slice(0, ${MAX_SNAPSHOT_ELEMENTS})
  document.querySelectorAll('[data-hhb-ref]').forEach((el) => el.removeAttribute('data-hhb-ref'))
  const elements = visible.map((el, i) => {
    const ref = String(i + 1)
    el.setAttribute('data-hhb-ref', ref)
    const raw = (el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('title') || '')
    const text = String(raw).replace(/\\s+/g, ' ').trim().slice(0, 80)
    return {
      ref,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      text,
      href: el.href ? String(el.href).slice(0, 200) : '',
      name: el.getAttribute('name') || ''
    }
  })
  return { title: document.title, url: location.href, elements }
})()`

async function snapshotPage(sess: BrowserSession): Promise<{
  title: string
  url: string
  elements: Array<{ ref: string; tag: string; type: string; text: string; href: string; name: string }>
}> {
  await settle(sess)
  const data = await runPageScript<{
    title?: string
    url?: string
    elements?: Array<{ ref: string; tag: string; type: string; text: string; href: string; name: string }>
  }>(sess, SNAPSHOT_SCRIPT)
  return {
    title: data?.title || pageInfo(sess).title,
    url: data?.url || pageInfo(sess).url,
    elements: Array.isArray(data?.elements) ? data.elements : []
  }
}

function requireProfile(profileId?: string): BrowserProfile {
  const id = String(profileId || DEFAULT_PROFILE_ID)
  const profile = getProfile(id)
  if (!profile) throw new Error(`找不到 Profile：${id}。先用 list_profiles 查看可用项。`)
  return profile
}

function requireOpenSession(profile: BrowserProfile): BrowserSession {
  const sess = sessions.get(profile.id)
  if (!sess || sess.shell.isDestroyed()) {
    throw new Error(`Profile「${profile.name}」的窗口未打开。请先 open。`)
  }
  return sess
}

export async function openWindow(
  profileId: string,
  url?: string
): Promise<{ ok: boolean; profileId: string; url: string; title: string; error?: string }> {
  const profile = requireProfile(profileId)
  let sess = ensureSession(profile)
  if (sess.shell.isDestroyed()) {
    sessions.delete(profile.id)
    sess = ensureSession(profile)
  }
  let loadError = ''
  if (url) {
    const target = resolveNavTarget(url)
    if (!target) return { ok: false, profileId: profile.id, url: '', title: '', error: '请传入网址或搜索词' }
    sess.urlBarFocused = false
    try {
      if (!pageWc(sess).isDestroyed()) await pageWc(sess).loadURL(target)
      await settle(sess)
    } catch (e: any) {
      loadError = e?.message || String(e)
      console.warn('[browser] loadURL failed:', loadError)
    }
  } else {
    try {
      if (!pageWc(sess).isDestroyed()) {
        const current = pageWc(sess).getURL()
        if (!current) await pageWc(sess).loadURL('about:blank')
      }
    } catch {
      /* ignore */
    }
    focusUrlBar(sess)
  }
  if (!sess.shell.isDestroyed()) {
    if (sess.shell.isMinimized()) sess.shell.restore()
    sess.shell.show()
    sess.shell.focus()
    layoutView(sess)
    pushChromeState(sess)
  }
  const info = sess.shell.isDestroyed() ? { url: '', title: '' } : pageInfo(sess)
  return {
    ok: !sess.shell.isDestroyed(),
    profileId: profile.id,
    url: info.url,
    title: info.title,
    error: loadError || undefined
  }
}

export async function executeBrowserAction(
  args: any,
  sandboxDir?: string
): Promise<any> {
  const action = String(args?.action || '')
  const profileId = String(args?.profile_id || DEFAULT_PROFILE_ID)

  try {
    if (action === 'list_profiles') {
      const statuses = getWindowStatus()
      const openMap = new Map(statuses.map((s) => [s.profileId, s]))
      return {
        profiles: listProfiles().map((p) => ({
          id: p.id,
          name: p.name,
          builtin: !!p.builtin,
          open: !!openMap.get(p.id)?.open,
          url: openMap.get(p.id)?.url || ''
        }))
      }
    }

    if (action === 'open') {
      const opened = await openWindow(profileId, args?.url)
      if (!opened.ok) return { error: opened.error || '打开失败' }
      const sess = sessions.get(opened.profileId)
      const snap = sess && !sess.shell.isDestroyed()
        ? await snapshotPage(sess)
        : { title: opened.title, url: opened.url, elements: [] }
      return { ok: true, profile_id: opened.profileId, ...snap }
    }

    if (action === 'close') {
      closeWindow(profileId)
      return { ok: true, profile_id: profileId }
    }

    const profile = requireProfile(profileId)
    const sess = requireOpenSession(profile)
    if (sess.shell.isMinimized()) sess.shell.restore()
    sess.shell.show()

    if (action === 'snapshot') {
      return { ok: true, profile_id: profile.id, ...(await snapshotPage(sess)) }
    }

    if (action === 'click') {
      const ref = String(args?.ref || '').trim()
      if (!ref) return { error: 'click 需要 ref（先 snapshot）' }
      const result = await runPageScript<{ ok: boolean; error?: string }>(
        sess,
        `(function(ref){
          const el = document.querySelector('[data-hhb-ref="' + ref + '"]')
          if (!el) return { ok: false, error: '找不到 ref=' + ref + '，请重新 snapshot' }
          el.scrollIntoView({ block: 'center', inline: 'nearest' })
          el.click()
          return { ok: true }
        })(${JSON.stringify(ref)})`
      )
      if (!result?.ok) return { error: result?.error || '点击失败' }
      const snap = await snapshotPage(sess)
      return { ok: true, profile_id: profile.id, clicked: ref, ...snap }
    }

    if (action === 'type') {
      const ref = String(args?.ref || '').trim()
      const text = args?.text == null ? '' : String(args.text)
      if (!ref) return { error: 'type 需要 ref（先 snapshot）' }
      const submit = !!args?.submit
      const result = await runPageScript<{ ok: boolean; error?: string }>(
        sess,
        `(function(p){
          const el = document.querySelector('[data-hhb-ref="' + p.ref + '"]')
          if (!el) return { ok: false, error: '找不到 ref=' + p.ref + '，请重新 snapshot' }
          el.scrollIntoView({ block: 'center', inline: 'nearest' })
          el.click()
          el.focus()
          if ('value' in el) {
            const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
            const desc = Object.getOwnPropertyDescriptor(proto, 'value')
            if (desc && desc.set) desc.set.call(el, p.text)
            else el.value = p.text
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: p.text }))
            el.dispatchEvent(new Event('change', { bubbles: true }))
          } else if (el.isContentEditable) {
            document.execCommand('selectAll', false, null)
            document.execCommand('insertText', false, p.text)
            el.dispatchEvent(new InputEvent('input', { bubbles: true, data: p.text }))
          } else {
            return { ok: false, error: '该元素不能输入文字' }
          }
          if (p.submit) {
            const form = el.closest('form')
            if (form && typeof form.requestSubmit === 'function') form.requestSubmit()
            else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
          }
          return { ok: true }
        })(${JSON.stringify({ ref, text, submit })})`
      )
      if (!result?.ok) return { error: result?.error || '输入失败' }
      const snap = await snapshotPage(sess)
      return { ok: true, profile_id: profile.id, typed: ref, submitted: submit, ...snap }
    }

    if (action === 'screenshot') {
      await settle(sess)
      const image = await pageWc(sess).capturePage()
      const png = image.toPNG()
      const fallbackName = `browser-${Date.now()}.png`
      let dest = String(args?.path || '').trim() || `images/${fallbackName}`
      if (!/\.(png|jpe?g|webp)$/i.test(dest)) dest = `${dest}.png`
      const abs = sandboxDir ? resolveInWorkspace(dest, sandboxDir) : join(getDataDir(), 'browser-screenshots', basename(dest))
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, png)
      const size = image.getSize()
      return {
        ok: true,
        profile_id: profile.id,
        path: abs,
        width: size.width,
        height: size.height,
        note: '截图已落盘。向用户展示时用 markdown 图片或反引号包裹该绝对路径；不要把图片内容读进对话。'
      }
    }

    return { error: `未知 action: ${action}。可用：list_profiles / open / snapshot / click / type / screenshot / close` }
  } catch (e: any) {
    return { error: e?.message || String(e) }
  }
}
