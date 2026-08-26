export interface SkillPreset {
  /** 固定 ID（builtin_ 前缀），seed 时作为 skills.id 写入，已存在则跳过覆盖 */
  id: string
  name: string
  description: string
  function_def: {
    name: string
    description: string
    parameters: {
      type: string
      properties: Record<string, any>
      required?: string[]
    }
  }
  implementation: string
}

export const skillPresets: SkillPreset[] = [
  {
    id: 'builtin_current_time',
    name: '当前时间',
    description: '获取当前日期和时间',
    function_def: {
      name: 'get_current_time',
      description: '获取当前的日期和时间，支持指定时区',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: '时区，例如 Asia/Shanghai、America/New_York，默认为系统时区'
          }
        }
      }
    },
    implementation: `const tz = args.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
const now = new Date()
const formatted = now.toLocaleString('zh-CN', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' })
return { time: formatted, timezone: tz, timestamp: now.toISOString() }`
  },
  {
    id: 'builtin_calculator',
    name: '数学计算器',
    description: '执行数学表达式计算',
    function_def: {
      name: 'calculator',
      description: '计算数学表达式，支持加减乘除、幂运算、三角函数等',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '要计算的数学表达式，如 "2 + 3 * 4"、"Math.sqrt(16)"、"Math.PI * 2"'
          }
        },
        required: ['expression']
      }
    },
    implementation: `try {
  const allowed = /^[0-9+\\-*/().,%\\s]|Math\\.[a-zA-Z]+|parseInt|parseFloat|Number|NaN|Infinity/
  const expr = args.expression
  const result = new Function('return ' + expr)()
  return { expression: expr, result: Number(result) }
} catch (e) {
  return { error: '计算失败: ' + e.message }
}`
  },
  {
    id: 'builtin_fetch_webpage',
    name: '网页获取',
    description: '获取网页内容（纯文本）',
    function_def: {
      name: 'fetch_webpage',
      description: '获取指定URL的网页内容，返回纯文本',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '要获取的网页URL'
          },
          max_length: {
            type: 'number',
            description: '返回内容的最大字符数，默认5000'
          }
        },
        required: ['url']
      }
    },
    implementation: `const maxLen = args.max_length || 5000
const resp = await fetch(args.url, {
  headers: { 'User-Agent': 'Mozilla/5.0 LocalAgent/1.0' },
  signal: AbortSignal.timeout(10000)
})
if (!resp.ok) return { error: 'HTTP ' + resp.status }
const html = await resp.text()
const text = html.replace(/<script[^>]*>[\\s\\S]*?<\\/script>/gi, '')
  .replace(/<style[^>]*>[\\s\\S]*?<\\/style>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\\s+/g, ' ')
  .trim()
return { url: args.url, content: text.slice(0, maxLen), truncated: text.length > maxLen }`
  },
  {
    id: 'builtin_json_tool',
    name: 'JSON 处理',
    description: '解析、格式化或查询JSON数据',
    function_def: {
      name: 'json_tool',
      description: '处理JSON数据：解析、格式化、提取字段',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['parse', 'format', 'extract'],
            description: '操作类型：parse=解析JSON字符串, format=格式化, extract=提取指定路径'
          },
          data: {
            type: 'string',
            description: 'JSON字符串'
          },
          path: {
            type: 'string',
            description: '提取路径，用点号分隔，如 "data.items.0.name"（仅 extract 时使用）'
          }
        },
        required: ['action', 'data']
      }
    },
    implementation: `try {
  const obj = JSON.parse(args.data)
  if (args.action === 'parse') return { result: obj }
  if (args.action === 'format') return { result: JSON.stringify(obj, null, 2) }
  if (args.action === 'extract' && args.path) {
    const parts = args.path.split('.')
    let val = obj
    for (const p of parts) val = val?.[p]
    return { path: args.path, result: val }
  }
  return { error: '未知操作' }
} catch (e) { return { error: e.message } }`
  },
  {
    id: 'builtin_text_tool',
    name: '文本处理',
    description: '文本统计、转换和处理',
    function_def: {
      name: 'text_tool',
      description: '文本处理工具：字数统计、大小写转换、查找替换',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['count', 'uppercase', 'lowercase', 'replace', 'split'],
            description: '操作类型'
          },
          text: { type: 'string', description: '输入文本' },
          find: { type: 'string', description: '查找内容（replace 时使用）' },
          replace_with: { type: 'string', description: '替换内容（replace 时使用）' },
          delimiter: { type: 'string', description: '分隔符（split 时使用）' }
        },
        required: ['action', 'text']
      }
    },
    implementation: `const t = args.text
if (args.action === 'count') {
  const chars = t.length
  const words = t.split(/\\s+/).filter(Boolean).length
  const lines = t.split('\\n').length
  const cjk = (t.match(/[\\u4e00-\\u9fff]/g) || []).length
  return { chars, words, lines, cjk_chars: cjk }
}
if (args.action === 'uppercase') return { result: t.toUpperCase() }
if (args.action === 'lowercase') return { result: t.toLowerCase() }
if (args.action === 'replace') return { result: t.replaceAll(args.find || '', args.replace_with || '') }
if (args.action === 'split') return { result: t.split(args.delimiter || ',') }
return { error: '未知操作' }`
  },
  {
    id: 'builtin_random_generator',
    name: '随机生成器',
    description: '生成随机数、UUID、密码等',
    function_def: {
      name: 'random_generator',
      description: '生成随机数据：整数、浮点数、UUID、密码',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['integer', 'float', 'uuid', 'password'],
            description: '生成类型'
          },
          min: { type: 'number', description: '最小值（integer/float）' },
          max: { type: 'number', description: '最大值（integer/float）' },
          length: { type: 'number', description: '密码长度，默认16' }
        },
        required: ['type']
      }
    },
    implementation: `if (args.type === 'integer') {
  const min = args.min ?? 0, max = args.max ?? 100
  return { result: Math.floor(Math.random() * (max - min + 1)) + min }
}
if (args.type === 'float') {
  const min = args.min ?? 0, max = args.max ?? 1
  return { result: Math.random() * (max - min) + min }
}
if (args.type === 'uuid') {
  return { result: crypto.randomUUID() }
}
if (args.type === 'password') {
  const len = args.length || 16
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
  let pwd = ''
  for (let i = 0; i < len; i++) pwd += chars[Math.floor(Math.random() * chars.length)]
  return { result: pwd }
}
return { error: '未知类型' }`
  },
]
