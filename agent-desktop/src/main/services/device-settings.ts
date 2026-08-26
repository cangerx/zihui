import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { getRootDir } from './data-path'

// 设备级设置：与登录账号无关、随设备/数据根走的少量 UI 偏好（当前仅窗口关闭行为）。
// 存于 root 的 device-settings.json，独立于按账号隔离的 settings 表，
// 确保切换账号后这类纯设备偏好不被重置。
const DEVICE_SETTINGS_FILE = 'device-settings.json'

function filePath(): string {
  return join(getRootDir(), DEVICE_SETTINGS_FILE)
}

function readAll(): Record<string, string> {
  try {
    const p = filePath()
    if (existsSync(p)) {
      const obj = JSON.parse(readFileSync(p, 'utf-8'))
      if (obj && typeof obj === 'object') return obj as Record<string, string>
    }
  } catch (e) {
    console.error('[device-settings] read failed:', e)
  }
  return {}
}

export function getDeviceSetting(key: string): string | null {
  const all = readAll()
  return Object.prototype.hasOwnProperty.call(all, key) ? String(all[key]) : null
}

export function setDeviceSetting(key: string, value: string): void {
  const all = readAll()
  all[key] = value
  try {
    writeFileSync(filePath(), JSON.stringify(all, null, 2), 'utf-8')
  } catch (e) {
    console.error('[device-settings] write failed:', e)
  }
}
