export function extractPromptPreset(text: string): { label: string; content: string } | null {
  const trimmed = (text || '').trim()
  if (!trimmed) return null
  const fences: string[] = []
  const re = /```(?:markdown|md|text|yaml|prompt)?\s*\n([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(trimmed))) fences.push(m[1].trim())
  const body = fences.find((f) => f.startsWith('---')) || fences[0] || trimmed
  if (body.startsWith('---')) {
    const fm = parseSimpleFrontmatter(body)
    const rest = body.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim()
    const content = rest || body
    return { label: fm.name || guessLabel(content), content }
  }
  return { label: guessLabel(body), content: body }
}

function guessLabel(text: string): string {
  const line = String(text || '').replace(/\s+/g, ' ').trim()
  if (!line) return ''
  return line.length <= 20 ? line : `${line.slice(0, 20).trim()}…`
}

function parseSimpleFrontmatter(content: string): { name: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return { name: '' }
  const nameMatch = match[1].match(/^(?:name|label):\s*(.+)$/m)
  return { name: nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, '') : '' }
}
