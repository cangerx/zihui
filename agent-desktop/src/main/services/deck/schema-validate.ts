import type { FieldDef, TemplateSchema, SlideData, SlideValue, StatItem } from './types'

export interface ValidateResult {
  ok: boolean
  errors: string[]
  /** 经截断字数上限/裁剪条目数后的规整数据 */
  data: SlideData
}

function truncate(s: string, max?: number): string {
  return max && s.length > max ? s.slice(0, max) : s
}

function isStatItemArray(v: unknown): v is StatItem[] {
  return (
    Array.isArray(v) &&
    v.every((x) => x !== null && typeof x === 'object' && 'value' in x && 'label' in x)
  )
}

/**
 * 校验并规整槽位数据：按字段类型截断字数上限、裁剪条目数。
 * 这是"schema 字数上限防溢出"(D14/D16)在生成阶段的强制落点。
 */
export function validateAndClamp(schema: TemplateSchema, input: SlideData): ValidateResult {
  const errors: string[] = []
  const out: SlideData = {}
  for (const [key, def] of Object.entries(schema)) {
    const raw = input[key]
    if (raw === undefined || raw === null) {
      if (def.required) errors.push(`缺少必填字段: ${key}`)
      continue
    }
    out[key] = clampField(key, def, raw, errors)
  }
  return { ok: errors.length === 0, errors, data: out }
}

function clampField(key: string, def: FieldDef, raw: SlideValue, errors: string[]): SlideValue {
  switch (def.type) {
    case 'text':
    case 'multiline': {
      if (typeof raw !== 'string') {
        errors.push(`字段 ${key} 期望字符串`)
        return ''
      }
      return truncate(raw, def.maxChars)
    }
    case 'enum': {
      if (typeof raw !== 'string') {
        errors.push(`字段 ${key} 期望枚举字符串`)
        return ''
      }
      if (def.enumValues && !def.enumValues.includes(raw)) {
        errors.push(`字段 ${key} 非法枚举值: ${raw}`)
        return def.enumValues[0] ?? ''
      }
      return raw
    }
    case 'image': {
      if (typeof raw !== 'string') {
        errors.push(`字段 ${key} 期望图片路径字符串`)
        return ''
      }
      return raw
    }
    case 'list': {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) {
        errors.push(`字段 ${key} 期望字符串数组`)
        return []
      }
      let arr = raw as string[]
      if (def.maxItems) arr = arr.slice(0, def.maxItems)
      return arr.map((s) => truncate(s, def.itemMaxChars))
    }
    case 'stat-list': {
      if (!isStatItemArray(raw)) {
        errors.push(`字段 ${key} 期望 {value,label} 数组`)
        return []
      }
      let arr: StatItem[] = raw
      if (def.maxItems) arr = arr.slice(0, def.maxItems)
      return arr.map((it) => ({
        value: truncate(it.value, def.statValueMaxChars),
        label: truncate(it.label, def.statLabelMaxChars)
      }))
    }
    default:
      return raw
  }
}

/** 声明式 schema -> JSON Schema(供 LLM 结构化输出约束 response_format) */
export function toJsonSchema(schema: TemplateSchema): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, def] of Object.entries(schema)) {
    properties[key] = fieldToJsonSchema(def)
    if (def.required) required.push(key)
  }
  return { type: 'object', additionalProperties: false, properties, required }
}

function fieldToJsonSchema(def: FieldDef): Record<string, unknown> {
  switch (def.type) {
    case 'text':
    case 'multiline':
      return { type: 'string', maxLength: def.maxChars, description: def.label }
    case 'enum':
      return { type: 'string', enum: def.enumValues ?? [], description: def.label }
    case 'image':
      return { type: 'string', description: `${def.label}(图片路径或占位)` }
    case 'list':
      return {
        type: 'array',
        maxItems: def.maxItems,
        items: { type: 'string', maxLength: def.itemMaxChars },
        description: def.label
      }
    case 'stat-list':
      return {
        type: 'array',
        maxItems: def.maxItems,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['value', 'label'],
          properties: {
            value: { type: 'string', maxLength: def.statValueMaxChars },
            label: { type: 'string', maxLength: def.statLabelMaxChars }
          }
        },
        description: def.label
      }
    default:
      return { type: 'string' }
  }
}
