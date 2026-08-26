/**
 * 桌面通知统一入口：尊重设备级「启用通知 / 音效」偏好。
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { Notification, nativeImage, type NativeImage } from 'electron'
import { getDeviceSetting } from './device-settings'
import { getRuntimeConfig } from './runtime-config'

function loadAppIcon(): NativeImage | undefined {
  const paths = [
    join(__dirname, '../../build/icon.png'),
    join(process.resourcesPath || '', 'icon.png')
  ]
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        return nativeImage.createFromPath(p)
      } catch {
        /* ignore */
      }
    }
  }
  return undefined
}

export function areDesktopNotificationsEnabled(): boolean {
  return getDeviceSetting('notifications_enabled') !== '0'
}

export function isNotificationSilent(): boolean {
  return getDeviceSetting('notification_sound') === 'quiet'
}

/** force=true 时忽略总开关（仅用于设置页「试听」）。 */
export function notifyDesktop(
  title: string,
  body: string,
  opts?: { force?: boolean; silent?: boolean }
): void {
  try {
    if (!opts?.force && !areDesktopNotificationsEnabled()) return
    if (!Notification.isSupported()) return
    const silent = opts?.silent ?? isNotificationSilent()
    const n = new Notification({
      title,
      body,
      silent,
      icon: loadAppIcon()
    })
    n.show()
  } catch (e) {
    console.error('[desktop-notify]', e)
  }
}

export function appDisplayName(): string {
  return getRuntimeConfig().appName || '好伙伴'
}
