import { app } from 'electron'
import type { ManifestV1 } from './types'

/**
 * 备份/恢复的版本兼容性策略。
 *
 * 三档结果：
 *   - ok      : 完全兼容，直接恢复
 *   - warning : 跨版本但可继续，UI 应显示警告（向下兼容场景：恢复旧备份到新 app）
 *   - blocked : 拒绝恢复（向上兼容场景：用更老的 app 恢复更新备份，schema 不兼容会炸）
 *
 * 当前规则：
 *   - formatVersion 必须是 1（未来格式升级时这里再放行）
 *   - manifest.appVersion > 当前 appVersion 时 blocked（schema 可能领先于本机）
 *   - manifest.appVersion < 当前 appVersion 时 warning（迁移会自动升 schema，但用户应知情）
 *   - 平台不同 warning（数据目录里的绝对路径可能在 Win/Mac 之间不一致）
 */

export type Compat = { level: 'ok' | 'warning' | 'blocked'; reason?: string }

function parseSemver(v: string): [number, number, number] {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  if (!m) return [0, 0, 0]
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function compareSemver(a: string, b: string): number {
  const [a1, a2, a3] = parseSemver(a)
  const [b1, b2, b3] = parseSemver(b)
  if (a1 !== b1) return a1 - b1
  if (a2 !== b2) return a2 - b2
  return a3 - b3
}

export function checkCompat(manifest: ManifestV1): Compat {
  if (manifest.formatVersion !== 1) {
    return { level: 'blocked', reason: `不支持的备份格式版本: ${manifest.formatVersion}` }
  }
  const current = app.getVersion()
  const cmp = compareSemver(manifest.appVersion, current)
  if (cmp > 0) {
    return {
      level: 'blocked',
      reason: `备份来自更新版本 v${manifest.appVersion}，当前应用 v${current}。请先升级应用再恢复，否则可能触发数据库 schema 不兼容。`
    }
  }
  if (cmp < 0) {
    return {
      level: 'warning',
      reason: `备份来自旧版本 v${manifest.appVersion}（当前 v${current}）。恢复后将自动升级数据库结构。`
    }
  }
  if (manifest.platform && manifest.platform !== process.platform) {
    return {
      level: 'warning',
      reason: `备份创建于 ${manifest.platform}，当前是 ${process.platform}。如果数据中包含绝对路径可能需要手动调整。`
    }
  }
  return { level: 'ok' }
}
