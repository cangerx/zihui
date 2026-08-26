export interface AnthropicChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | any[]
  tool_call_id?: string
  tool_calls?: any[]
}

export interface AnthropicRequestOptions {
  messages: AnthropicChatMessage[]
  tools?: any[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
}

export const ANTHROPIC_VERSION = '2023-06-01'

export function isAnthropicType(type: string | undefined | null): boolean {
  return String(type || '').toLowerCase() === 'anthropic'
}

export function anthropicHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION
  }
  if (apiKey) headers['x-api-key'] = apiKey
  return headers
}

export function mapAnthropicStopReason(reason: string | undefined | null): string {
  if (reason === 'tool_use') return 'tool_calls'
  if (reason === 'max_tokens') return 'length'
  return reason || 'stop'
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === 'string') return part
        if (part?.type === 'text') return String(part.text || '')
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content == null) return ''
  return String(content)
}

function parseDataUri(url: string): { media_type: string; data: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(url)
  if (!m) return null
  return { media_type: m[1], data: m[2] }
}

function convertUserContent(content: AnthropicChatMessage['content']): string | any[] {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return stringifyContent(content)
  const parts: any[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    if (part.type === 'text') {
      parts.push({ type: 'text', text: String(part.text || '') })
      continue
    }
    if (part.type === 'image_url' && typeof part.image_url?.url === 'string') {
      const url: string = part.image_url.url
      if (/^https?:\/\//i.test(url)) {
        parts.push({ type: 'image', source: { type: 'url', url } })
        continue
      }
      const parsed = parseDataUri(url)
      if (parsed) {
        parts.push({
          type: 'image',
          source: { type: 'base64', media_type: parsed.media_type, data: parsed.data }
        })
      }
    }
  }
  if (parts.length === 0) return stringifyContent(content)
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text
  return parts
}

function parseToolInput(raw: unknown): Record<string, any> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, any>
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {
      /* keep empty */
    }
  }
  return {}
}

function convertAssistantContent(msg: AnthropicChatMessage): any[] {
  const blocks: any[] = []
  const text = stringifyContent(msg.content)
  if (text) blocks.push({ type: 'text', text })
  for (const tc of msg.tool_calls || []) {
    const id = String(tc?.id || '')
    const name = String(tc?.function?.name || tc?.name || '')
    if (!id && !name) continue
    blocks.push({
      type: 'tool_use',
      id: id || `toolu_${Math.random().toString(36).slice(2, 12)}`,
      name,
      input: parseToolInput(tc?.function?.arguments)
    })
  }
  return blocks.length ? blocks : [{ type: 'text', text: '' }]
}

function mergeSameRole(messages: { role: string; content: any }[]): { role: string; content: any }[] {
  const out: { role: string; content: any }[] = []
  for (const msg of messages) {
    const last = out[out.length - 1]
    if (!last || last.role !== msg.role) {
      out.push({ role: msg.role, content: msg.content })
      continue
    }
    const a = last.content
    const b = msg.content
    if (typeof a === 'string' && typeof b === 'string') {
      last.content = `${a}\n${b}`
    } else {
      const arrA = typeof a === 'string' ? [{ type: 'text', text: a }] : Array.isArray(a) ? a : []
      const arrB = typeof b === 'string' ? [{ type: 'text', text: b }] : Array.isArray(b) ? b : []
      last.content = [...arrA, ...arrB]
    }
  }
  return out
}

export function toAnthropicBody(options: AnthropicRequestOptions, modelId: string): Record<string, any> {
  const systemParts: string[] = []
  const converted: { role: string; content: any }[] = []

  for (const msg of options.messages) {
    if (msg.role === 'system') {
      const text = stringifyContent(msg.content).trim()
      if (text) systemParts.push(text)
      continue
    }
    if (msg.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: String(msg.tool_call_id || ''),
        content: stringifyContent(msg.content)
      }
      const last = converted[converted.length - 1]
      if (last?.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block)
      } else {
        converted.push({ role: 'user', content: [block] })
      }
      continue
    }
    if (msg.role === 'assistant') {
      converted.push({ role: 'assistant', content: convertAssistantContent(msg) })
      continue
    }
    converted.push({ role: 'user', content: convertUserContent(msg.content) })
  }

  let messages = mergeSameRole(converted)
  if (messages[0]?.role === 'assistant') {
    messages = [{ role: 'user', content: '(continued)' }, ...messages]
  }
  if (messages.length === 0) {
    messages = [{ role: 'user', content: '.' }]
  }

  const body: Record<string, any> = {
    model: modelId,
    max_tokens: options.max_tokens && options.max_tokens > 0 ? options.max_tokens : 8192,
    messages,
    stream: options.stream ?? false
  }
  if (systemParts.length) body.system = systemParts.join('\n\n')
  if (options.temperature !== undefined) body.temperature = options.temperature
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools.map((t: any) => {
      const fn = t?.function || t
      return {
        name: String(fn?.name || t?.name || ''),
        description: String(fn?.description || ''),
        input_schema: fn?.parameters && typeof fn.parameters === 'object'
          ? fn.parameters
          : { type: 'object', properties: {} }
      }
    }).filter((t: any) => t.name)
  }
  return body
}

export function parseAnthropicMessage(data: any): {
  content: string
  tool_calls?: any[]
  finish_reason: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  reasoning?: string
} {
  const blocks: any[] = Array.isArray(data?.content) ? data.content : []
  let content = ''
  let reasoning = ''
  const toolCalls: any[] = []
  for (const block of blocks) {
    if (block?.type === 'text') content += String(block.text || '')
    else if (block?.type === 'thinking') reasoning += String(block.thinking || '')
    else if (block?.type === 'tool_use') {
      toolCalls.push({
        id: String(block.id || ''),
        type: 'function',
        function: {
          name: String(block.name || ''),
          arguments: JSON.stringify(block.input && typeof block.input === 'object' ? block.input : {})
        }
      })
    }
  }
  const input = Number(data?.usage?.input_tokens || 0)
  const output = Number(data?.usage?.output_tokens || 0)
  return {
    content,
    tool_calls: toolCalls.length ? toolCalls : undefined,
    finish_reason: mapAnthropicStopReason(data?.stop_reason),
    usage: data?.usage
      ? { prompt_tokens: input, completion_tokens: output, total_tokens: input + output }
      : undefined,
    reasoning: reasoning || undefined
  }
}

export interface AnthropicStreamState {
  fullContent: string
  reasoningContent: string
  toolCalls: any[]
  finishReason: string
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null
}

export function createAnthropicStreamState(): AnthropicStreamState {
  return {
    fullContent: '',
    reasoningContent: '',
    toolCalls: [],
    finishReason: 'stop',
    usage: null
  }
}

export function applyAnthropicStreamEvent(
  parsed: any,
  state: AnthropicStreamState
): { contentPiece?: string; reasoningPiece?: string; error?: string } {
  const type = String(parsed?.type || '')
  if (type === 'error') {
    const detail =
      typeof parsed.error === 'string'
        ? parsed.error
        : parsed.error?.message || parsed.error?.type || JSON.stringify(parsed.error || parsed)
    return { error: String(detail) }
  }
  if (type === 'message_start') {
    const input = Number(parsed.message?.usage?.input_tokens || 0)
    if (input) {
      state.usage = {
        prompt_tokens: input,
        completion_tokens: state.usage?.completion_tokens || 0,
        total_tokens: input + (state.usage?.completion_tokens || 0)
      }
    }
    return {}
  }
  if (type === 'content_block_start') {
    const block = parsed.content_block
    const idx = Number(parsed.index ?? 0)
    if (block?.type === 'tool_use') {
      state.toolCalls.push({
        id: String(block.id || ''),
        type: 'function',
        function: { name: String(block.name || ''), arguments: '' },
        _blockIndex: idx
      })
    }
    return {}
  }
  if (type === 'content_block_delta') {
    const delta = parsed.delta || {}
    const idx = Number(parsed.index ?? 0)
    if (delta.type === 'text_delta' && delta.text) {
      state.fullContent += delta.text
      return { contentPiece: delta.text }
    }
    if (delta.type === 'thinking_delta' && delta.thinking) {
      state.reasoningContent += delta.thinking
      return { reasoningPiece: delta.thinking }
    }
    if (delta.type === 'input_json_delta' && delta.partial_json) {
      const tc = [...state.toolCalls].reverse().find((t: any) => t?._blockIndex === idx)
        || state.toolCalls[state.toolCalls.length - 1]
      if (tc) tc.function.arguments += delta.partial_json
    }
    return {}
  }
  if (type === 'message_delta') {
    if (parsed.delta?.stop_reason) {
      state.finishReason = mapAnthropicStopReason(parsed.delta.stop_reason)
    }
    const output = Number(parsed.usage?.output_tokens || 0)
    if (output || parsed.usage) {
      const input = state.usage?.prompt_tokens || 0
      state.usage = {
        prompt_tokens: input,
        completion_tokens: output,
        total_tokens: input + output
      }
    }
  }
  return {}
}
