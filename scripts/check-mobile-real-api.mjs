import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(fileURLToPath(new URL('..', import.meta.url)))
const appModule = readFileSync(join(repoRoot, 'agent-mobile/src/api/modules/app.ts'), 'utf8')
const toolPage = readFileSync(
  join(repoRoot, 'agent-mobile/src/pages-sub/tool-run/tool-run.vue'),
  'utf8',
)
const loginPage = readFileSync(
  join(repoRoot, 'agent-mobile/src/pages-sub/login/login.vue'),
  'utf8',
)

const required = [
  [appModule, 'USE_MOCK', 'Mock/real environment split'],
  [appModule, 'features.image?.enabled', 'bootstrap image feature gate'],
  [appModule, "appV1Client.models('image')", 'authorized image model list'],
  [appModule, 'appV1Client.createImageTask', 'App v1 image task creation'],
  [appModule, 'appV1Client.task(taskUuid)', 'App v1 task polling'],
  [toolPage, "uni.navigateTo({ url: '/pages-sub/login/login' })", 'tool authentication gate'],
  [toolPage, "USE_MOCK ? 'app-hd' : AI_IMAGE_APP_ID", 'production image tool fallback'],
  [loginPage, 'bootstrap?.auth.wechat_mini', 'Wechat login capability gate'],
]

const failures = required
  .filter(([source, marker]) => !source.includes(marker))
  .map(([, , label]) => `missing ${label}`)

for (const path of ['/ai/app/worker/Run', '/ai/app/worker/Query']) {
  const routeIndex = appModule.indexOf(path)
  const mockGuardIndex = appModule.lastIndexOf('if (USE_MOCK)', routeIndex)
  const nextProductionCall = appModule.indexOf('appV1Client.', mockGuardIndex)
  if (routeIndex < 0 || mockGuardIndex < 0 || nextProductionCall < routeIndex) {
    failures.push(`${path} is not confined to a Mock branch`)
  }
}

if (failures.length) {
  console.error('Mobile real API check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Mobile real API check passed')
