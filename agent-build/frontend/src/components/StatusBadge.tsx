import { Tag } from 'antd'
import type { BuildStatus, ClientStatus, MirrorStatus } from '@/types'

const buildStatusMap: Record<BuildStatus, { color: string; label: string }> = {
  pending: { color: 'default', label: '待入队' },
  queued: { color: 'cyan', label: '排队中' },
  building: { color: 'processing', label: '打包中' },
  success: { color: 'success', label: '已完成' },
  delivered: { color: 'green', label: '已交付' },
  purged: { color: 'default', label: '已清理' },
  failed: { color: 'error', label: '失败' },
  cancelled: { color: 'warning', label: '已取消' },
  expired: { color: 'orange', label: '已过期' },
}

const clientStatusMap: Record<ClientStatus, { color: string; label: string }> = {
  active: { color: 'success', label: '正常' },
  suspended: { color: 'warning', label: '已停用' },
  expired: { color: 'default', label: '已过期' },
}

export function BuildStatusBadge({ status }: { status: BuildStatus }) {
  const cfg = buildStatusMap[status] || { color: 'default', label: status }
  return <Tag color={cfg.color}>{cfg.label}</Tag>
}

const mirrorStatusMap: Record<MirrorStatus, { color: string; label: string }> = {
  pending: { color: 'default', label: '待中转' },
  mirroring: { color: 'processing', label: '中转中' },
  mirrored: { color: 'success', label: '已中转' },
  failed: { color: 'error', label: '中转失败' },
  purging: { color: 'warning', label: '清理中' },
  purged: { color: 'default', label: '已清理' },
}

export function MirrorStatusBadge({ status }: { status?: MirrorStatus | null }) {
  if (!status) return <Tag>-</Tag>
  const cfg = mirrorStatusMap[status] || { color: 'default', label: status }
  return <Tag color={cfg.color}>{cfg.label}</Tag>
}

export function ClientStatusBadge({ status }: { status: ClientStatus }) {
  const cfg = clientStatusMap[status] || { color: 'default', label: status }
  return <Tag color={cfg.color}>{cfg.label}</Tag>
}

export function PlatformBadge({ platform }: { platform: 'win' | 'mac' }) {
  return <Tag color={platform === 'win' ? 'blue' : 'magenta'}>{platform === 'win' ? 'Windows' : 'macOS'}</Tag>
}
