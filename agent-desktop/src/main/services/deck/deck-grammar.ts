import type { DeckLlm } from './deck-generator'

// deck 级「设计语法」(grammar): huashu 工作流的质量根源。
// 由 1-2 页 showcase 确立(用户确认), 之后贯穿全 deck 每一页, 保证视觉浑然一体——
// 这是「为这份 deck 现场设计的专属 grammar」, 区别于「217 套通用预制模板里挑一个」。
// 机制: showcase HTML 作「范本」+ LLM 蒸馏的「规则」, 注入后续每页生成提示, 让它们照同一视觉语言生成(只换内容)。

/** 交付路径: pptx=可编辑PPTX(HTML守4约束+data-ir标记); visual=视觉优先(自由HTML→图片/视频) */
export type DeckPath = 'pptx' | 'visual'

export interface DeckGrammar {
  /** 是否已确立(用户确认 showcase 后置 true; 未确立时不注入) */
  established: boolean
  path: DeckPath
  /** showcase 范本 HTML(后续页照此视觉语言生成; 已截断防 prompt 膨胀) */
  exemplars: string[]
  /** LLM 蒸馏的设计语法描述(masthead/字体阶梯/配色/间距/版面结构规则) */
  rules: string
}

export function emptyGrammar(path: DeckPath = 'pptx'): DeckGrammar {
  return { established: false, path, exemplars: [], rules: '' }
}

/** 从持久化 JSON 解析 grammar(非法/未确立返回 null) */
export function parseGrammar(json: string | undefined | null): DeckGrammar | null {
  if (!json) return null
  try {
    const g = JSON.parse(json) as DeckGrammar
    return g && g.established && Array.isArray(g.exemplars) ? g : null
  } catch {
    return null
  }
}

const EXEMPLAR_MAX = 4500 // 单个范本 HTML 截断上限(防 prompt 膨胀; 足够承载视觉语言)

const RULES_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['rules'],
  properties: {
    rules: {
      type: 'string',
      maxLength: 1200,
      description: '从范本中提炼的设计语法: masthead/页眉结构、字体与字号阶梯、主色与强调色、间距单位、版面网格、留白比例。供后续页复用。'
    }
  }
}

/**
 * 从已确认的 showcase HTML 提炼 deck 级设计语法。
 * rules 由 LLM 蒸馏(失败回退空, 仍保留 exemplars 作范本); exemplars 是连贯性的主要载体。
 */
export async function extractGrammar(
  showcaseHtmls: string[],
  path: DeckPath,
  llm?: DeckLlm,
  signal?: AbortSignal
): Promise<DeckGrammar> {
  const exemplars = showcaseHtmls.filter((h) => h && h.trim()).map((h) => h.slice(0, EXEMPLAR_MAX))
  let rules = ''
  if (llm && exemplars.length > 0) {
    try {
      const raw = (await llm.generateJson({
        system:
          '你是设计系统专家。给你这份演示的 1-2 页 showcase HTML, 提炼出它的「设计语法」——' +
          '即后续所有页面都应复用的视觉规则(masthead/页眉结构、字体与字号阶梯、主色与强调色、间距单位、版面网格、留白比例)。' +
          '只输出规则描述, 不要复述内容。',
        user: '以下是已确认的 showcase 页面 HTML:\n\n' + exemplars.join('\n\n--- 下一页 ---\n\n'),
        schema: RULES_SCHEMA,
        signal
      })) as { rules?: unknown }
      if (typeof raw?.rules === 'string') rules = raw.rules.trim()
    } catch {
      /* 蒸馏失败不阻断, exemplars 仍可作范本 */
    }
  }
  return { established: exemplars.length > 0, path, exemplars, rules }
}

/**
 * 把 grammar 拼成注入「后续页生成提示」的文本。未确立返回空串。
 * 后续每页据此照同一视觉语言生成 → 全 deck 连贯(huashu 的"grammar 贯穿")。
 */
export function grammarPromptText(grammar: DeckGrammar | null): string {
  if (!grammar || !grammar.established || grammar.exemplars.length === 0) return ''
  const parts = [
    '【本 deck 已确立的设计语法 — 后续每页必须复用, 保持全 deck 视觉浑然一体】'
  ]
  if (grammar.rules) parts.push('设计规则: ' + grammar.rules)
  parts.push(
    '参照范本(照下面页面的 masthead/字体/配色/间距/版面结构这套视觉语言生成本页, 只换内容, 不要另起炉灶、不要换风格):'
  )
  grammar.exemplars.forEach((e, i) => parts.push(`【范本 ${i + 1}】\n${e}`))
  return parts.join('\n')
}
