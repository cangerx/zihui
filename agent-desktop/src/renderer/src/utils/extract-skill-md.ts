export function extractSkillMarkdown(text: string): { name: string; description: string; content: string } | null {
  const candidates: string[] = []
  const re = /```(?:markdown|md)?\s*\n([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) candidates.push(m[1].trim())
  candidates.push((text || '').trim())
  for (const raw of candidates) {
    if (!raw.startsWith('---')) continue
    const parsed = parseSimpleFrontmatter(raw)
    if (parsed.name) {
      return { name: parsed.name, description: parsed.description, content: raw }
    }
  }
  return null
}

function parseSimpleFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return { name: '', description: '' }
  const fm = match[1]
  const nameMatch = fm.match(/^name:\s*(.+)$/m)
  const descMatch = fm.match(/^description:\s*(.*)$/m)
  let description = ''
  if (descMatch) {
    const val = descMatch[1].trim().replace(/^["']|["']$/g, '')
    if (val === '>' || val === '|' || val === '>-' || val === '|-') {
      const startIdx = fm.indexOf(descMatch[0]) + descMatch[0].length
      const parts: string[] = []
      for (const line of fm.slice(startIdx).split('\n')) {
        if (!parts.length && line.trim() === '') continue
        if (/^\s+\S/.test(line)) parts.push(line.trim())
        else break
      }
      description = parts.join(' ')
    } else {
      description = val
    }
  }
  return {
    name: nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, '') : '',
    description
  }
}
