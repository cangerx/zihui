const ERROR_MAP: Record<string, string> = {
  'Insufficient token balance': 'Token \u4f59\u989d\u4e0d\u8db3\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458\u5145\u503c',
  'Insufficient credit balance': '\u79ef\u5206\u4f59\u989d\u4e0d\u8db3\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458\u5145\u503c',
  'INSUFFICIENT_BALANCE': '\u4f59\u989d\u4e0d\u8db3\uff0c\u8bf7\u5145\u503c\u540e\u91cd\u8bd5',
  'insufficient balance': '\u4f59\u989d\u4e0d\u8db3\uff0c\u8bf7\u5145\u503c\u540e\u91cd\u8bd5',
  'HTTP 402': '\u4f59\u989d\u4e0d\u8db3\uff0c\u8bf7\u5145\u503c\u540e\u91cd\u8bd5',
  'Cloud login required': '\u8bf7\u5148\u767b\u5f55\u4e91\u7aef\u8d26\u53f7',
  'Custom provider is disabled by admin': '\u7ba1\u7406\u5458\u5df2\u7981\u7528\u81ea\u5b9a\u4e49\u670d\u52a1\u5546',
  'You do not have access to this model': '\u60a8\u6ca1\u6709\u8be5\u6a21\u578b\u7684\u4f7f\u7528\u6743\u9650',
  'Model not found': '\u6a21\u578b\u672a\u627e\u5230',
  'Provider disabled': '\u670d\u52a1\u5546\u5df2\u7981\u7528',
  'API error 524': '\u8bf7\u6c42\u8d85\u65f6\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5',
  'API error 502': '\u670d\u52a1\u5668\u9519\u8bef\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5',
  'API error 503': '\u670d\u52a1\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5',
  'API error 504': '\u7f51\u5173\u8d85\u65f6\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5',
  'ETIMEDOUT': '\u8bf7\u6c42\u8d85\u65f6\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5',
  'ECONNRESET': '\u8fde\u63a5\u88ab\u91cd\u7f6e\uff0c\u8bf7\u91cd\u8bd5',
  'ECONNREFUSED': '\u8fde\u63a5\u88ab\u62d2\u7edd\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u6216\u670d\u52a1\u5668\u72b6\u6001',
  'ENETUNREACH': '\u7f51\u7edc\u4e0d\u53ef\u8fbe\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u8fde\u63a5',
  'EAI_AGAIN': 'DNS \u89e3\u6790\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc',
  'UND_ERR_CONNECT_TIMEOUT': '\u8fde\u63a5\u8d85\u65f6\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5',
  'UND_ERR_HEADERS_TIMEOUT': '\u670d\u52a1\u5668\u54cd\u5e94\u8d85\u65f6\uff0c\u8bf7\u91cd\u8bd5',
  'UND_ERR_BODY_TIMEOUT': '\u6570\u636e\u8bfb\u53d6\u8d85\u65f6\uff0c\u8bf7\u91cd\u8bd5',
  'UND_ERR_SOCKET': '\u8fde\u63a5\u4e2d\u65ad\uff0c\u8bf7\u91cd\u8bd5',
  'socket hang up': '\u8fde\u63a5\u4e2d\u65ad\uff0c\u8bf7\u91cd\u8bd5',
  'fetch failed': '\u7f51\u7edc\u8bf7\u6c42\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5',
  'Upstream request failed': '上游模型拒绝当前请求，常见原因：尺寸比例过于极端、短边太小或模型暂时不可用，请换用预设比例或稍后重试',
  'Upstream error': '上游模型返回错误，请稍后重试或更换模型',
  'Upstream service temporarily unavailable': '上游服务暂时不可用，请稍后重试',
  'Upstream service unavailable': '上游服务暂时不可用，请稍后重试',
  'Service Unavailable': '服务暂时不可用，请稍后重试',
  'Service unavailable': '服务暂时不可用，请稍后重试',
  'Bad Gateway': '上游网关错误（502），请稍后重试',
  'Gateway Timeout': '上游网关超时（504），请稍后重试',
  'Too Many Requests': '请求过于频繁，请稍后重试',
  'rate_limit_exceeded': '请求频率超限，请稍后重试',
  'rate limit': '请求频率超限，请稍后重试',
  'Rate limit exceeded': '请求频率超限，请稍后重试',
  'Quota exceeded': '配额已用完，请稍后重试或升级套餐',
  'Token expired': '登录状态已过期，正在自动恢复，请重试',
  'CLOUD_TOKEN_REFRESH': '登录状态刷新失败，请重试',
  'context_length_exceeded': '内容长度超出模型上限，请缩短提示词或参考图数量',
  'content_filter': '内容被安全策略拦截，请调整提示词',
  'safety system': '内容被安全策略拦截，请调整提示词',
  'invalid_api_key': 'API Key 无效或已过期，请检查服务商配置',
  'invalid_request_error': '请求参数无效，请检查模型/尺寸/参考图设置',
  'model_not_found': '模型未找到，请确认服务商已配置该模型',
  'invalid size': '尺寸不受模型支持，请改用预设比例',
  'size is not supported': '尺寸不受模型支持，请改用预设比例',
  '请求超时': '请求超时，请检查网络后重试',
  'Image generation timed out': '生图超时（5 分钟未完成），请稍后重试或换用更小尺寸',
  '图片下载失败': '图片下载失败，URL 已保留可手动复制访问',
  '生图并发等待超时': '当前生图任务过多，请稍后重试',
  '应用上次异常关闭': '上次任务因应用异常关闭中断，请重新发起',
  '多米 API 提交失败': '多米服务暂时不可用，请稍后重试或更换模型',
  '多米 API 持续不可用': '多米服务持续不可用，请稍后重试或更换模型',
  '多米 API 鉴权失败': '多米 API Key 无效或已过期，请检查服务商配置',
  '多米 API 任务不存在或已过期': '多米任务已过期，请重新发起',
  '多米 API 任务失败': '多米任务失败，请稍后重试或更换提示词',
  'Synchronous requests are not supported': '多米服务商类型配置错误（需为「多米 API」），请联系管理员在云控端「云端服务商」修正',
  '云端生图响应解析失败': '云端服务响应异常，请稍后重试',
  'Image API 响应解析失败': '生图服务响应异常，请稍后重试',
  '服务商未返回': '服务商未返回图片，请重试或更换模型'
}

export function translateError(msg: string): string {
  if (!msg) return '\u64cd\u4f5c\u5931\u8d25'

  for (const [key, val] of Object.entries(ERROR_MAP)) {
    if (msg.includes(key)) return val
  }

  // Extract JSON error from "LLM API error 4xx: {...}"
  const jsonMatch = msg.match(/(?:LLM|Image) API error \d+: (.+)/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1])
      const inner = parsed.error || parsed.message
      if (inner && typeof inner === 'string') {
        for (const [key, val] of Object.entries(ERROR_MAP)) {
          if (inner.includes(key)) return val
        }
        return inner
      }
    } catch {}
  }

  return msg
}

export function isBalanceError(msg: string): boolean {
  if (!msg) return false
  if (msg.includes('INSUFFICIENT_BALANCE')) return true
  if (msg.toLowerCase().includes('insufficient') && msg.toLowerCase().includes('balance')) return true
  return msg.includes('余额不足')
}
