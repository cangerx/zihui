// 工具失败熔断 / 循环检测(借鉴 CowAgent _check_consecutive_failures)。
// 纯函数、无副作用,从 chat-engine 拆出以降低其体积并便于单测。
// 与 MAX_TOOL_ROUNDS 并存,只会更早止损、更省 token。

export interface ToolHistoryEntry {
  name: string
  argsHash: string
  success: boolean
}

export function hashToolArgs(args: any): string {
  try {
    const str = JSON.stringify(args ?? {})
    let h = 0
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
    return String(h >>> 0)
  } catch {
    return ''
  }
}

// 结构化判断工具结果是否失败(error 字段 / ok=false / success=false)
export function isToolFailure(result: any): boolean {
  if (result == null) return false
  if (typeof result === 'object') {
    if (result.error !== undefined && result.error !== null) return true
    if (result.ok === false) return true
    if (result.success === false) return true
  }
  return false
}

export function checkToolCircuitBreaker(
  history: ToolHistoryEntry[],
  name: string,
  argsHash: string
): { stop: boolean; reason: string; critical: boolean } {
  // 1) 同 name+args 连续调用(成败都算)≥5:典型死循环(工具成功但 LLM 反复调同一调用)
  let sameArgsCalls = 0
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].name === name && history[i].argsHash === argsHash) sameArgsCalls++
    else break
  }
  if (sameArgsCalls >= 10) {
    return {
      stop: true,
      reason: `工具「${name}」已用相同参数重复调用 ${sameArgsCalls} 次仍未收敛，已中止本轮以避免持续消耗。请换一种方式描述需求。`,
      critical: true
    }
  }
  if (sameArgsCalls >= 5) {
    return {
      stop: true,
      reason: `工具「${name}」已用相同参数连续调用 ${sameArgsCalls} 次，已停止以防止无限循环。请基于已有结果作答或更换方法。`,
      critical: false
    }
  }

  // 2) 同 name+args 连续失败 ≥3:该参数走不通
  let sameArgsFails = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]
    if (h.name === name && h.argsHash === argsHash) {
      if (!h.success) sameArgsFails++
      else break
    } else break
  }
  if (sameArgsFails >= 3) {
    return {
      stop: true,
      reason: `工具「${name}」使用相同参数已连续失败 ${sameArgsFails} 次，请改用不同参数或换一种方法。`,
      critical: false
    }
  }

  // 3) 同 name 连续失败:6 次警告停、8 次 critical 中止本轮
  let sameToolFails = 0
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].name === name) {
      if (!history[i].success) sameToolFails++
      else break
    } else break
  }
  if (sameToolFails >= 8) {
    return {
      stop: true,
      reason: `抱歉，工具「${name}」连续多次执行失败，我暂时无法完成这个任务。你可以换种方式描述需求，或把任务拆分得更小一些。`,
      critical: true
    }
  }
  if (sameToolFails >= 6) {
    return {
      stop: true,
      reason: `工具「${name}」已连续失败 ${sameToolFails} 次（不同参数），已停止以防止无限循环。`,
      critical: false
    }
  }

  return { stop: false, reason: '', critical: false }
}
