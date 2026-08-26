/**
 * Robust JSON extraction from LLM output.
 *
 * Handles common LLM quirks:
 *  - <think>…</think> blocks (DeepSeek / QwQ reasoning wrappers)
 *  - Markdown ```json … ``` fences
 *  - Leading/trailing prose around the JSON payload
 *  - Both object ({}) and array ([]) top-level values
 */

/** Strip <think>…</think> blocks that some reasoning models prepend. */
function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '')
}

/** Strip Markdown code fences (```json … ``` or ``` … ```). */
function stripMarkdownFences(text: string): string {
  const m = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  return m ? m[1].trim() : text
}

/**
 * Locate the outermost balanced JSON structure in `text`.
 * Supports both `{…}` and `[…]` as the root delimiter.
 */
function findBalancedJson(text: string, expect?: ExtractJsonOptions['expect']): string | null {
  const startObj = expect === 'array' ? -1 : text.indexOf('{')
  const startArr = expect === 'object' ? -1 : text.indexOf('[')

  let start: number
  let open: string
  let close: string

  if (startObj === -1 && startArr === -1) return null
  if (startObj === -1) {
    start = startArr; open = '['; close = ']'
  } else if (startArr === -1) {
    start = startObj; open = '{'; close = '}'
  } else if (startObj <= startArr) {
    start = startObj; open = '{'; close = '}'
  } else {
    start = startArr; open = '['; close = ']'
  }

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export interface ExtractJsonOptions {
  /** Expected top-level type. When set, extraction validates the parsed value. */
  expect?: 'object' | 'array'
}

/**
 * Extract and parse a JSON value from raw LLM output.
 *
 * @returns The parsed JSON value.
 * @throws  Error with a descriptive message when extraction or parsing fails.
 */
export function extractJson<T = any>(raw: string | null | undefined, opts?: ExtractJsonOptions): T {
  if (!raw || typeof raw !== 'string') {
    throw new Error('AI 未返回任何内容')
  }

  let text = stripThinkBlocks(raw).trim()
  text = stripMarkdownFences(text)

  // Fast path: try parsing the whole cleaned text first
  try {
    const val = JSON.parse(text)
    if (opts?.expect === 'object' && (typeof val !== 'object' || val === null || Array.isArray(val))) {
      throw new Error('AI 返回格式错误：期望 JSON 对象')
    }
    if (opts?.expect === 'array' && !Array.isArray(val)) {
      throw new Error('AI 返回格式错误：期望 JSON 数组')
    }
    return val as T
  } catch (fastErr: any) {
    // If fast parse worked but type check failed, rethrow immediately
    if (fastErr.message.startsWith('AI ')) throw fastErr
  }

  // Slow path: locate balanced JSON substring
  const fragment = findBalancedJson(text, opts?.expect)
  if (!fragment) {
    throw new Error('AI 未返回合法的 JSON（原始输出：' + raw.slice(0, 120) + '...）')
  }

  let parsed: any
  try {
    parsed = JSON.parse(fragment)
  } catch {
    throw new Error('AI 返回的 JSON 无法解析（原始输出：' + raw.slice(0, 120) + '...）')
  }

  if (opts?.expect === 'object' && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))) {
    throw new Error('AI 返回格式错误：期望 JSON 对象')
  }
  if (opts?.expect === 'array' && !Array.isArray(parsed)) {
    throw new Error('AI 返回格式错误：期望 JSON 数组')
  }

  return parsed as T
}

/** Parse LLM JSON without throwing, for call sites whose contract uses a fallback value. */
export function tryExtractJson<T = any>(
  raw: string | null | undefined,
  opts?: ExtractJsonOptions
): T | null {
  try {
    return extractJson<T>(raw, opts)
  } catch {
    return null
  }
}
