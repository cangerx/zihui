import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'agent-mobile/src')
const files = {
  client: 'api/v1-client.ts',
  upload: 'api/modules/upload.ts',
  app: 'api/modules/app.ts',
  tool: 'pages-sub/tool-run/tool-run.vue',
}
const text = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, readFileSync(join(root, file), 'utf8')]))
const failures = []
for (const [marker, label] of [
  ['presignAsset', 'asset presign client'],
  ['uploadAssetContent', 'binary signed upload client'],
  ['completeAsset', 'asset completion client'],
]) if (!text.client.includes(marker) && !text.upload.includes(marker)) failures.push(`missing ${label}`)
for (const [marker, label] of [['assets?.enabled', 'bootstrap assets feature gate'], ['asset_ids', 'asset id task payload']]) {
  if (!text.app.includes(marker)) failures.push(`missing ${label}`)
}
if (!text.upload.includes('uploadAppAssets')) failures.push('missing production asset upload facade')
if (!text.tool.includes('uploadAppAssets')) failures.push('tool page does not use asset facade')
if (!/if\s*\(!USE_MOCK\)[\s\S]{0,300}uploadAppAssets/.test(text.tool)) failures.push('tool page does not gate production upload')
if (text.app.includes("image_urls: assetIds") || text.app.includes('image_urls')) failures.push('production app module contains image URL passthrough')
if (failures.length) {
  console.error('Mobile production asset contract check failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}
console.log('Mobile production asset contract check passed')
