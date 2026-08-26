/**
 * 桌面应用偏好（设备级）：开机自启、托盘、通知。
 * 存 device-settings.json；开机自启同步到 OS Login Item。
 */
import { app } from 'electron'
import { getDeviceSetting, setDeviceSetting } from './device-settings'

export type NotificationSound = 'default' | 'quiet'

export interface DesktopPrefs {
  openAtLogin: boolean
  showTray: boolean
  notificationsEnabled: boolean
  notificationSound: NotificationSound
}

type TrayApplier = (show: boolean) => void

let trayApplier: TrayApplier | null = null

export function registerTrayApplier(fn: TrayApplier): void {
  trayApplier = fn
}

function readBool(key: string, defaultTrue: boolean): boolean {
  const v = getDeviceSetting(key)
  if (v === '1') return true
  if (v === '0') return false
  return defaultTrue
}

export function getDesktopPrefs(): DesktopPrefs {
  const storedLogin = getDeviceSetting('open_at_login')
  let openAtLogin = false
  if (storedLogin === '1') openAtLogin = true
  else if (storedLogin === '0') openAtLogin = false
  else {
    try {
      openAtLogin = !!app.getLoginItemSettings().openAtLogin
    } catch {
      openAtLogin = false
    }
  }

  const sound = getDeviceSetting('notification_sound')
  return {
    openAtLogin,
    showTray: readBool('show_tray', true),
    notificationsEnabled: readBool('notifications_enabled', true),
    notificationSound: sound === 'quiet' ? 'quiet' : 'default'
  }
}

export function applyOpenAtLogin(enabled: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: false
    })
  } catch (e) {
    console.error('[desktop-prefs] setLoginItemSettings failed:', e)
  }
}

/** 启动时把已存偏好同步到 OS（未配置过则不改 OS）。 */
export function syncOpenAtLoginOnLaunch(): void {
  const v = getDeviceSetting('open_at_login')
  if (v !== '1' && v !== '0') return
  applyOpenAtLogin(v === '1')
}

export function updateDesktopPrefs(patch: Partial<DesktopPrefs>): DesktopPrefs {
  if (patch.openAtLogin !== undefined) {
    setDeviceSetting('open_at_login', patch.openAtLogin ? '1' : '0')
    applyOpenAtLogin(patch.openAtLogin)
  }
  if (patch.showTray !== undefined) {
    setDeviceSetting('show_tray', patch.showTray ? '1' : '0')
    try {
      trayApplier?.(patch.showTray)
    } catch (e) {
      console.error('[desktop-prefs] tray apply failed:', e)
    }
  }
  if (patch.notificationsEnabled !== undefined) {
    setDeviceSetting('notifications_enabled', patch.notificationsEnabled ? '1' : '0')
  }
  if (patch.notificationSound !== undefined) {
    setDeviceSetting(
      'notification_sound',
      patch.notificationSound === 'quiet' ? 'quiet' : 'default'
    )
  }
  return getDesktopPrefs()
}

export function isTrayEnabled(): boolean {
  return getDesktopPrefs().showTray
}
