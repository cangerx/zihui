/**
 * 生图提示词与风格片段的统一拼接规则。
 *
 * 分隔符沿用画布全局风格前缀的既有约定（\n\n---\n\n），
 * 风格片段永远拼在最后，模型可区分「主题」与「风格约束」。
 *
 * 幂等保护：prompt 尾部已带同一片段时原样返回——生成记录落库的是拼接后的
 * 最终提示词，「再次使用」把它灌回输入框后再生成，不做这层去重风格会拼两次。
 */
export function composePromptWithStyle(prompt: string, styleFragment: string): string {
  const p = (prompt || '').trim()
  const f = (styleFragment || '').trim()
  if (!f) return p
  if (!p) return f
  if (p === f || p.endsWith(`\n\n---\n\n${f}`) || p.endsWith(f)) return p
  return `${p}\n\n---\n\n${f}`
}
