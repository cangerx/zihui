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
const profileModule = readFileSync(
  join(repoRoot, 'agent-mobile/src/api/modules/profile.ts'),
  'utf8',
)
const minePage = readFileSync(join(repoRoot, 'agent-mobile/src/pages/mine/mine.vue'), 'utf8')
const tasksModule = readFileSync(join(repoRoot, 'agent-mobile/src/api/modules/tasks.ts'), 'utf8')
const v1Client = readFileSync(join(repoRoot, 'agent-mobile/src/api/v1-client.ts'), 'utf8')
const taskHistoryPage = readFileSync(
  join(repoRoot, 'agent-mobile/src/pages-sub/task-history/task-history.vue'),
  'utf8',
)
const loginNavigation = readFileSync(
  join(repoRoot, 'agent-mobile/src/api/login-navigation.ts'),
  'utf8',
)

const required = [
  [appModule, 'USE_MOCK', 'Mock/real environment split'],
  [appModule, 'features.image?.enabled', 'bootstrap image feature gate'],
  [appModule, "appV1Client.models('image')", 'authorized image model list'],
  [appModule, 'appV1Client.createImageTask', 'App v1 image task creation'],
  [appModule, 'appV1Client.task(taskUuid)', 'App v1 task polling'],
  [toolPage, 'navigateToLoginOnce()', 'tool authentication gate'],
  [toolPage, 'apiErrorInvalidatedSession(error)', 'current-token session invalidation'],
  [loginNavigation, 'navigatingToLogin', 'single login navigation guard'],
  [toolPage, "USE_MOCK ? 'app-hd' : AI_IMAGE_APP_ID", 'production image tool fallback'],
  [loginPage, 'bootstrap?.auth.wechat_mini', 'Wechat login capability gate'],
  [profileModule, 'appV1Client.me()', 'App v1 current account'],
  [profileModule, 'appV1Client.balance()', 'App v1 current balances'],
  [profileModule, 'appV1Client.logout()', 'App v1 remote logout'],
  [minePage, 'getProfileSnapshot()', 'Mine profile snapshot'],
  [minePage, 'apiErrorCode(error) === 401', 'Mine expired session recovery'],
  [minePage, 'apiErrorInvalidatedSession(error)', 'Mine current-token invalidation proof'],
  [minePage, 'await signOut()', 'Mine remote logout before local cleanup'],
  [minePage, 'finally', 'Mine guaranteed local logout cleanup'],
  [tasksModule, 'function createMockTasks()', 'development-only lazy task fixtures'],
  [tasksModule, 'appV1Client.tasks', 'production task list'],
  [taskHistoryPage, "@/api/modules/task-result", 'Mock-free task result parser'],
  [v1Client, "USE_MOCK ? (API_BASE || '/api/app/v1') : requireApiBase()", 'fail-closed production API base'],
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
