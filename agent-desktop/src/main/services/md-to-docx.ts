/**
 * 把 Markdown 转成可被 Word 打开的 .docx。
 * 覆盖对话里常见结构：标题、段落、加粗/斜体、列表、引用、代码块、简单表格。
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IBorderOptions
} from 'docx'

const FONT = { ascii: 'Calibri', eastAsia: '微软雅黑', hAnsi: 'Calibri' }
const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6
] as const

const THIN: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: 'D4D0C8' }
const TABLE_BORDERS = { top: THIN, bottom: THIN, left: THIN, right: THIN, insideH: THIN, insideV: THIN }

function run(text: string, extra: ConstructorParameters<typeof TextRun>[0] = {}): TextRun {
  return new TextRun({ text, font: FONT, size: 21, ...extra })
}

function parseInline(text: string): TextRun[] {
  const runs: TextRun[] = []
  const re = /(\*\*[^*]+?\*\*|__[^_]+?__|\*[^*]+?\*|_([^_]+?)_|`[^`]+?`|\[[^\]]+?\]\([^)]+?\))/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push(run(text.slice(last, m.index)))
    const token = m[0]
    if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
      runs.push(run(token.slice(2, -2), { bold: true }))
    } else if (token.startsWith('`') && token.endsWith('`')) {
      runs.push(run(token.slice(1, -1), { font: { ascii: 'Consolas', eastAsia: '微软雅黑' }, shading: { fill: 'F3F1EC' } }))
    } else if (token.startsWith('[') && token.includes('](')) {
      const label = token.slice(1, token.indexOf(']'))
      runs.push(run(label, { color: '23574F', underline: {} }))
    } else if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) {
      runs.push(run(token.slice(1, -1), { italics: true }))
    } else {
      runs.push(run(token))
    }
    last = m.index + token.length
  }
  if (last < text.length) runs.push(run(text.slice(last)))
  if (!runs.length) runs.push(run(''))
  return runs
}

function stripMdNoise(raw: string): string {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/^\uFEFF/, '')
}

function splitTableRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return t.split('|').map((c) => c.trim())
}

function isTableSep(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function buildTable(rows: string[][]): Table {
  const cols = Math.max(...rows.map((r) => r.length), 1)
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows: rows.map((cells, ri) => new TableRow({
      children: Array.from({ length: cols }, (_, i) => new TableCell({
        width: { size: Math.round(100 / cols), type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: parseInline(cells[i] || ''), spacing: { after: 40 } })],
        shading: ri === 0 ? { fill: 'F3F1EC' } : undefined
      }))
    }))
  })
}

export function markdownToDocChildren(markdown: string): Array<Paragraph | Table> {
  const src = stripMdNoise(markdown)
  const lines = src.split('\n')
  const out: Array<Paragraph | Table> = []
  let i = 0
  let inCode = false
  let codeLang = ''
  let codeBuf: string[] = []

  const flushCode = () => {
    const body = codeBuf.join('\n') || ' '
    out.push(new Paragraph({
      shading: { fill: 'F6F4EF' },
      spacing: { before: 80, after: 80 },
      children: [run(body, { font: { ascii: 'Consolas', eastAsia: '微软雅黑' }, size: 18 })]
    }))
    codeBuf = []
    codeLang = ''
  }

  while (i < lines.length) {
    const line = lines[i]
    const fence = line.trim().match(/^```(.*)$/)
    if (fence) {
      if (inCode) {
        flushCode()
        inCode = false
      } else {
        inCode = true
        codeLang = fence[1] || ''
        void codeLang
      }
      i += 1
      continue
    }
    if (inCode) {
      codeBuf.push(line)
      i += 1
      continue
    }

    if (!line.trim()) {
      i += 1
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      out.push(new Paragraph({
        heading: HEADINGS[level - 1],
        spacing: { before: 200, after: 80 },
        children: parseInline(heading[2].trim())
      }))
      i += 1
      continue
    }

    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const rows = [splitTableRow(line)]
      i += 2
      while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
        rows.push(splitTableRow(lines[i]))
        i += 1
      }
      out.push(buildTable(rows))
      continue
    }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/)
    if (ul) {
      out.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 60 },
        children: parseInline(ul[1])
      }))
      i += 1
      continue
    }

    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (ol) {
      out.push(new Paragraph({
        numbering: { reference: 'export-num', level: 0 },
        spacing: { after: 60 },
        children: parseInline(ol[1])
      }))
      i += 1
      continue
    }

    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) {
      out.push(new Paragraph({
        spacing: { after: 80 },
        indent: { left: 360 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: '23574F', space: 8 } },
        children: parseInline(quote[1])
      }))
      i += 1
      continue
    }

    const hr = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
    if (hr) {
      out.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D4D0C8', space: 1 } },
        spacing: { before: 80, after: 80 },
        children: [run('')]
      }))
      i += 1
      continue
    }

    out.push(new Paragraph({
      spacing: { after: 120, line: 360 },
      children: parseInline(line.trim())
    }))
    i += 1
  }

  if (inCode) flushCode()
  if (!out.length) out.push(new Paragraph({ children: [run('')] }))
  return out
}

export async function markdownToDocxBuffer(markdown: string, title?: string): Promise<Buffer> {
  const children = markdownToDocChildren(markdown)
  const doc = new Document({
    numbering: {
      config: [{
        reference: 'export-num',
        levels: [{
          level: 0,
          format: 'decimal',
          text: '%1.',
          alignment: AlignmentType.START
        }]
      }]
    },
    styles: {
      default: {
        document: { run: { font: FONT, size: 21 } }
      },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickStyle: true, run: { size: 32, bold: true, font: FONT, color: '23574F' } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickStyle: true, run: { size: 28, bold: true, font: FONT, color: '23574F' } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickStyle: true, run: { size: 24, bold: true, font: FONT } }
      ]
    },
    sections: [{
      properties: {
        page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } }
      },
      children: title
        ? [
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              spacing: { after: 200 },
              children: parseInline(title)
            }),
            ...children
          ]
        : children
    }]
  })
  const buf = await Packer.toBuffer(doc)
  return Buffer.from(buf)
}

export function safeDocxFileName(title: string): string {
  const base = String(title || '导出')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40) || '导出'
  return `${base}.docx`
}
