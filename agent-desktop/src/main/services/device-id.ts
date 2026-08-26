import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { v4 as uuid } from 'uuid'

const DEVICE_ID_FILE = 'device-id.txt'

let cached: string | null = null

function getDeviceIdPath(): string {
  return join(app.getPath('userData'), DEVICE_ID_FILE)
}

export function getDeviceId(): string {
  if (cached) return cached

  const path = getDeviceIdPath()
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, 'utf-8').trim()
      if (raw && raw.length <= 64) {
        cached = raw
        return cached
      }
    } catch {}
  }

  const id = uuid().replace(/-/g, '')
  try {
    writeFileSync(path, id, 'utf-8')
  } catch (e) {
    console.error('[device-id] persist failed:', e)
  }
  cached = id
  return cached
}
