export interface BalanceLog {
  id: number
  balance_type: string
  change_type: string
  change_amount: number | string
  balance_after: number | string
  remark: string
  created_at: string
}

export type BalanceLogKind = 'all' | 'in' | 'out'

const IN_TYPES = new Set([
  'recharge',
  'recharge_bonus',
  'register_bonus',
  'redeem',
  'plan_grant',
  'plan_adjust',
  'admin_adjust',
])

const OUT_TYPES = new Set(['usage', 'deduct'])

export function logMatchesKind(log: BalanceLog, kind: BalanceLogKind): boolean {
  if (kind === 'all') return true
  if (kind === 'in') return IN_TYPES.has(log.change_type) && Number(log.change_amount) >= 0
  return OUT_TYPES.has(log.change_type) || Number(log.change_amount) < 0
}

export function changeTypeLabel(t: string): string {
  switch (t) {
    case 'register_bonus': return '注册赠送'
    case 'redeem': return '兑换码'
    case 'plan_grant': return '套餐发放'
    case 'plan_adjust': return '套餐余量调整'
    case 'recharge': return '充值'
    case 'recharge_bonus': return '充值赠送'
    case 'usage': return '用量扣费'
    case 'deduct': return '扣减'
    case 'admin_adjust': return '管理员调整'
    default: return t
  }
}

export function displayLogRemark(log: BalanceLog): string {
  const raw = String(log.remark || '').trim()
  if (!raw) return ''

  if (log.change_type === 'usage') {
    const type = raw.split(/\s+/)[0]
    switch (type) {
      case 'chat': return '对话扣费'
      case 'image': return '图片生成扣费'
      case 'embedding': return '向量处理扣费'
      case 'matting': return '快速抠图扣费'
      case 'fine_matting': return '精细抠图扣费'
      default: return '用量扣费'
    }
  }

  return raw.replace(/^(?:\s*\[[^\]]*\]\s*)+/, '').trim()
}

export function formatLogTime(iso: string): string {
  try {
    const d = new Date(iso)
    const y = d.getFullYear()
    const M = String(d.getMonth() + 1).padStart(2, '0')
    const D = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    return `${y}-${M}-${D} ${h}:${m}`
  } catch {
    return iso
  }
}

export function formatLogAmount(value: number | string): string {
  const n = Number(value)
  if (Number.isNaN(n)) return '0'
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2)
}
