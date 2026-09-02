# Round 07 Electron parser hardening

## Scope

- `document-parser.ts` is the single boundary for PSD, PDF, DOC/DOCX, XLS/XLSX and PPTX text extraction.
- User-selected absolute files remain supported. Parent path segments, NUL bytes, symlink targets and directories are rejected before parsing.
- The 50 MiB input limit is checked before and after reading. ZIP-based formats also enforce safe entry names, at most 10,000 entries, a 200 MiB expanded budget and a 1,000:1 compression-ratio ceiling.
- PSD parsing uses `ag-psd` metadata-only options and extracts bounded layer names/text without decoding raster or linked-file payloads.
- The legacy `word-extractor` fallback writes into a mode-600 private temporary directory and removes that directory recursively in `finally`.

## Evidence

```text
npm run test:document-parser
7 tests passed, including the bounded 1024-byte PDF header regression
npm run build
passed once (electron-vite main/preload/renderer bundles)
git diff --check
passed
```

After a concurrent `npm ci`, reruns reported environment-only dependency-tree failures (`esbuild` host/binary mismatch, then `vue` missing `computed` export); a clean, isolated install is required before treating those failures as code regressions.

The follow-up desktop audit upgraded compatible dependencies and now enforces every remaining high/critical advisory with an exact, expiring policy entry. See `round-08-security-audit.md`; no wildcard exception is permitted.

## Known gaps

- PDF image-only documents still require OCR; this round only rejects malformed/oversized input and preserves text-layer extraction.
- Electron's current major version has upstream advisories; upgrading it is a separate runtime compatibility project.
- WeChat developer-tool automation is not part of the desktop parser test and remains an external environment concern.
