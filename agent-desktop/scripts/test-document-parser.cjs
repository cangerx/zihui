const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

// Node's type-stripping ESM loader does not provide CommonJS `require`, while
// Electron's main bundle does.  Supplying the same global keeps this focused
// parser test representative without adding a runtime dependency to the app.
global.require = require
const parserPromise = import('../src/main/services/document-parser.ts')

function requirePackage(name) {
  try {
    return require(name)
  } catch (error) {
    // npm's package tree may be concurrently reified by a workspace install;
    // resolve from the desktop package explicitly in that case.
    const packageRoot = path.resolve(__dirname, '..', 'node_modules', name)
    return require(packageRoot)
  }
}

function tempEntries() {
  return new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('local-agent-doc-')))
}

test('PSD extracts text layers without decoding raster data', async () => {
  const { writePsdBuffer } = requirePackage('ag-psd')
  const { parseDocumentFromBuffer } = await parserPromise
  const input = writePsdBuffer({
    width: 32,
    height: 24,
    children: [{
      name: '标题',
      text: {
        text: '安全解析',
        transform: [1, 0, 0, 1, 0, 0],
        style: { font: { name: 'Arial' }, fontSize: 12, fillColor: { r: 0, g: 0, b: 0 } }
      }
    }]
  })
  const result = await parseDocumentFromBuffer(input, '.PSD')
  assert.equal(result.ok, true)
  assert.equal(result.parser, 'psd')
  assert.match(result.text, /安全解析/)
  assert.equal(result.features.layerCount, 1)
  assert.equal(result.features.textLayerCount, 1)
})

test('malformed PDF and PSD are rejected before parser work', async () => {
  const { parseDocumentFromBuffer } = await parserPromise
  const pdf = await parseDocumentFromBuffer(Buffer.from('not a pdf'), 'pdf')
  assert.equal(pdf.ok, false)
  assert.equal(pdf.errorCode, 'PARSE_ERROR')
  assert.match(pdf.error, /有效 PDF/)

  const psd = await parseDocumentFromBuffer(Buffer.from('8BPS\0\0'), 'psd')
  assert.equal(psd.ok, false)
  assert.equal(psd.errorCode, 'PARSE_ERROR')
})

test('PDF header search includes exactly the first 1024 bytes', async () => {
  const { parseDocumentFromBuffer } = await parserPromise

  // `%PDF-` starts at byte 1019 and ends at byte 1024 (exclusive): the
  // complete header is inside the bounded [0, 1024) search window. The
  // payload is intentionally incomplete, so the downstream parser rejects it
  // with a parse error rather than the header validation error.
  const acceptedBoundary = Buffer.concat([Buffer.alloc(1019, 0x20), Buffer.from('%PDF-1.7')])
  const accepted = await parseDocumentFromBuffer(acceptedBoundary, 'pdf')
  assert.equal(accepted.ok, false)
  assert.equal(accepted.errorCode, 'PARSE_ERROR')
  assert.doesNotMatch(accepted.error, /文件头不是有效 PDF/)

  // Starting at byte 1020 would place the final header byte outside the
  // window and must remain rejected before invoking pdf-parse.
  const rejectedBoundary = Buffer.concat([Buffer.alloc(1020, 0x20), Buffer.from('%PDF-1.7')])
  const rejected = await parseDocumentFromBuffer(rejectedBoundary, 'pdf')
  assert.equal(rejected.ok, false)
  assert.equal(rejected.errorCode, 'PARSE_ERROR')
  assert.match(rejected.error, /文件头不是有效 PDF/)
})

test('DOCX text extraction remains available after ZIP validation', async () => {
  const JSZip = requirePackage('jszip')
  const { parseDocumentFromBuffer } = await parserPromise
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>解析回归</w:t></w:r></w:p></w:body></w:document>')
  const result = await parseDocumentFromBuffer(await zip.generateAsync({ type: 'nodebuffer' }), 'DOCX')
  assert.equal(result.ok, true)
  assert.equal(result.parser, 'docx')
  assert.match(result.text, /解析回归/)
})

test('oversized buffers are rejected before dispatch', async () => {
  const { MAX_DOC_SIZE_BYTES, parseDocumentFromBuffer } = await parserPromise
  const result = await parseDocumentFromBuffer(Buffer.alloc(MAX_DOC_SIZE_BYTES + 1), 'pdf')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'TOO_LARGE')
  assert.equal(result.size, MAX_DOC_SIZE_BYTES + 1)
})

test('path traversal, NUL and symlink document paths are denied', async () => {
  const { parseDocument, readFileSmart } = await parserPromise
  const traversal = await parseDocument(`${os.tmpdir()}/../outside.pdf`)
  assert.equal(traversal.ok, false)
  assert.equal(traversal.errorCode, 'INVALID_PATH')

  const nul = await readFileSmart(`${path.join(os.tmpdir(), 'file.txt')}\0.pdf`)
  assert.equal(nul.ok, false)
  assert.equal(nul.errorCode, 'INVALID_PATH')

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'document-parser-'))
  const target = path.join(root, 'target.txt')
  const link = path.join(root, 'link.txt')
  fs.writeFileSync(target, 'private')
  try {
    fs.symlinkSync(target, link)
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true })
    if (error.code === 'EPERM' || error.code === 'EACCES') return
    throw error
  }
  try {
    const result = await readFileSmart(link)
    assert.equal(result.ok, false)
    assert.equal(result.errorCode, 'INVALID_PATH')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('ZIP traversal entries and malformed DOC input are rejected and cleaned', async () => {
  const JSZip = requirePackage('jszip')
  const { parseDocumentFromBuffer } = await parserPromise
  const zip = new JSZip()
  zip.file('../escape.txt', 'must not extract')
  const archive = await zip.generateAsync({ type: 'nodebuffer' })
  const traversal = await parseDocumentFromBuffer(archive, 'docx')
  assert.equal(traversal.ok, false)
  assert.equal(traversal.errorCode, 'PARSE_ERROR')
  assert.match(traversal.error, /不安全的文件路径/)

  const before = tempEntries()
  const malformed = await parseDocumentFromBuffer(Buffer.from('not a Word document'), 'doc')
  assert.equal(malformed.ok, false)
  assert.equal(malformed.errorCode, 'PARSE_ERROR')
  const after = tempEntries()
  assert.deepEqual(after, before)
})
