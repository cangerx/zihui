/**
 * 抠图错误友好化：把后端 / 上游 / 网络的原始错误信息映射成用户可读中文。
 * 已是中文友好句的原样返回；英文 / 技术错误归类兜底。
 * 快速抠图与精细抠图队列项、预览区错误展示共用。
 */
export function friendlyMattingError(raw?: string | null): string {
  const s = String(raw || '').trim()
  if (!s) return '处理失败，请重试'
  const low = s.toLowerCase()

  if (s.includes('余额') || low.includes('insufficient')) return '积分余额不足，请充值后重试'
  if (s.includes('配额') || low.includes('quota')) {
    return s.includes('配额') ? s : '本月配额已用完，请下月再试或联系管理员'
  }
  if (s.includes('繁忙') || s.includes('频繁') || low.includes('busy') || low.includes('too many')) {
    return '服务繁忙，请稍后重试'
  }
  if (s.includes('超时') || low.includes('timeout') || low.includes('timed out')) {
    return s.includes('云端') ? s : '处理超时，请稍后重试'
  }
  if (s.includes('网络') || low.includes('network') || low.includes('failed to fetch') || low.includes('econn')) {
    return '网络异常，请检查网络后重试'
  }
  if (s.includes('格式') || low.includes('unsupported') || low.includes('format')) return '图片格式不支持'
  if (s.includes('分辨率') || low.includes('resolution')) {
    return /[\u4e00-\u9fa5]/.test(s) ? s : '图片尺寸超出限制'
  }
  if (s.includes('未登录') || low.includes('login') || low.includes('unauthorized')) {
    return '未登录或登录已过期，请重新登录'
  }
  // 服务未启用 / 未开通 / 未配置（后端已是中文友好句）
  if (s.includes('未启用') || s.includes('未开通') || s.includes('未配置')) return s

  // 整体已是中文（多为后端友好句）→ 原样展示；否则英文 / 技术错误兜底
  if (/[\u4e00-\u9fa5]/.test(s)) return s
  return '处理失败，请重试'
}
