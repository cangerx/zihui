import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(fileURLToPath(new URL('..', import.meta.url)))
const mobileRoot = join(repoRoot, 'agent-mobile')

const sourceChecks = [
  {
    file: 'src/pages/home/home.vue',
    required: [
      ['getHomeDiscovery', 'home discovery facade'],
      ['AI_IMAGE_APP_ID', 'single production image app id'],
      ['推荐内容尚未开放', 'production recommendation empty state'],
    ],
    forbidden: [
      ['@/api/mock/data', 'direct home Mock import'],
      ['app-ecommerce-suite', 'disabled ecommerce suite entry'],
      ['app-matting', 'disabled matting entry'],
      ['app-hd', 'disabled HD entry'],
      ['app-hot-video', 'disabled hot video entry'],
    ],
  },
  {
    file: 'src/pages/template/template.vue',
    required: [
      ['getTemplatePage', 'template facade'],
      ['模板功能尚未开放', 'production template empty state'],
    ],
    forbidden: [
      ['@/api/mock/data', 'direct template Mock import'],
      ['tpl-', 'Mock template id prefix'],
      ['makeTemplates', 'Mock template generator'],
    ],
  },
  {
    file: 'src/pages-sub/vip/vip.vue',
    required: [
      ['getBillingSnapshot', 'billing facade'],
      ['购买功能尚未开放', 'production billing disabled CTA'],
      ['支付功能暂未开放', 'production payment disabled state'],
    ],
    forbidden: [
      ['@/api/mock/data', 'direct VIP Mock import'],
      ['vipTiers', 'Mock VIP tier import'],
      ['支付宝', 'executable payment method label'],
      ['mock-pay', 'Mock payment adapter'],
      ['uni.requestPayment', 'native payment call'],
    ],
  },
  {
    file: 'src/pages/mine/mine.vue',
    required: [
      ['getProfileSnapshot', 'real account and balance snapshot'],
      ['refreshProfile', 'profile refresh state'],
      ['apiErrorCode(error) === 401', 'expired session handling'],
      ['apiErrorInvalidatedSession(error)', 'current-token invalidation proof'],
      ['signOut()', 'remote logout call'],
      ['user.logout()', 'local credential cleanup'],
      ['套餐与额度', 'neutral billing entry'],
      ['最近任务', 'real task history entry'],
      ['退出登录', 'confirmed logout action'],
    ],
    forbidden: [
      ['@/api/mock/data', 'direct Mine Mock import'],
      ['mineMenus', 'Mock Mine menu data'],
      ['useMemberStore', 'local membership inference'],
      ['member.level', 'local membership level'],
      ['member.beans', 'local Mock balance'],
      ['功能开发中', 'unavailable production menu'],
      ['uni.scanCode', 'unavailable scanner entry'],
      ["type=favorite", 'task history used as fake favorites'],
    ],
  },
  {
    file: 'src/pages-sub/task-history/task-history.vue',
    required: [
      ["@/api/modules/tasks", 'real task facade'],
      ["@/api/modules/task-result", 'Mock-free task result parser'],
      ['apiErrorCode(error) === 401', 'expired task session handling'],
      ['apiErrorInvalidatedSession(error)', 'current-token invalidation proof'],
    ],
    forbidden: [
      ["@/api/modules/app", 'task history dependency on Mock-capable app facade'],
      ["@/api/mock/data", 'direct task history Mock import'],
    ],
  },
  {
    file: 'src/components/asset-sheet/asset-sheet.vue',
    required: [["import('@/api/mock/data')", 'development-only asset Mock import']],
    forbidden: [['import { assetLibrary, assetTabs } from', 'static asset Mock import']],
  },
]

const failures = []

for (const check of sourceChecks) {
  const path = join(mobileRoot, check.file)
  const source = readFileSync(path, 'utf8')
  for (const [marker, label] of check.required) {
    if (!source.includes(marker)) failures.push(`${check.file}: missing ${label}`)
  }
  for (const [marker, label] of check.forbidden) {
    if (source.includes(marker)) failures.push(`${check.file}: contains ${label} (${marker})`)
  }
}

const runtimeCompatibilityChecks = [
  {
    file: join(repoRoot, 'packages/api-client/src/index.ts'),
    label: 'shared API client',
    forbidden: ['new URL(', 'new Headers('],
  },
  {
    file: join(mobileRoot, 'src/api/v1-client.ts'),
    label: 'uni-app transport',
    forbidden: ['new URL(', 'new Headers('],
  },
  {
    file: join(mobileRoot, 'src/api/modules/profile.ts'),
    label: 'profile API facade',
    forbidden: ["api/mock/data", 'mockProfile', 'mockBalance'],
  },
  {
    file: join(mobileRoot, 'src/api/modules/tasks.ts'),
    label: 'task API facade',
    forbidden: ["api/mock/data", "../mock/data"],
  },
  {
    file: join(mobileRoot, 'src/api/modules/task-result.ts'),
    label: 'task result parser',
    forbidden: ["api/mock/data", "../mock/data", 'mock-task-', '/static/mock/'],
  },
  {
    file: join(mobileRoot, 'src/api/login-navigation.ts'),
    label: 'login navigation guard',
    forbidden: ['api/mock/data', 'new URL(', 'new Headers('],
  },
]

for (const check of runtimeCompatibilityChecks) {
  const source = readFileSync(check.file, 'utf8')
  for (const marker of check.forbidden) {
    if (source.includes(marker)) {
      failures.push(`${relative(repoRoot, check.file)}: ${check.label} contains forbidden runtime marker (${marker})`)
    }
  }
}

const discovery = readFileSync(join(mobileRoot, 'src/api/modules/discovery.ts'), 'utf8')
const billing = readFileSync(join(mobileRoot, 'src/api/modules/billing.ts'), 'utf8')
for (const [source, file, required] of [
  [discovery, 'src/api/modules/discovery.ts', ['USE_MOCK', "import('../mock/data')", 'appV1Client.bootstrap']],
  [billing, 'src/api/modules/billing.ts', ['USE_MOCK', "import('../mock/data')", 'appV1Client.plans', 'appV1Client.balance']],
]) {
  for (const marker of required) {
    if (!source.includes(marker)) failures.push(`${file}: missing ${marker}`)
  }
}

function walk(dir) {
  if (!existsSync(dir)) return []
  const entries = readdirSync(dir)
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry)
    const info = statSync(path)
    if (info.isDirectory()) files.push(...walk(path))
    else files.push(path)
  }
  return files
}

// Build outputs are generated by the normal H5 and mp-weixin commands. Scan only
// the production page entry chunks already migrated from Mock; other pages intentionally keep
// their development-only Mock UI until their API slices are implemented.
const artifactChecks = [
  {
    dir: join(mobileRoot, 'dist/build/h5'),
    entries: [
      ['home', (path) => /pages-home-home/.test(path)],
      ['template', (path) => /pages-template-template/.test(path)],
      ['mine', (path) => /pages-mine-mine/.test(path)],
      ['vip', (path) => /pages-sub-vip-vip/.test(path)],
      ['task-history', (path) => /pages-sub-task-history-task-history/.test(path)],
      ['task-result', (path) => /task-result[.]/.test(path)],
      ['app-v1-transport', (path) => /v1-client[.]/.test(path)],
    ],
    forbidden: [
      ['app-ecommerce-suite', 'disabled ecommerce suite entry'],
      ['app-matting', 'disabled matting entry'],
      ['app-hd', 'disabled HD entry'],
      ['app-hot-video', 'disabled hot video entry'],
      ['tpl-', 'Mock template id prefix'],
      ['makeTemplates', 'Mock template generator'],
      ['vipTiers', 'Mock VIP tier data'],
      ['支付宝', 'executable payment method label'],
      ['mock-pay', 'Mock payment adapter'],
      ['uni.requestPayment', 'native payment call'],
      ['mineMenus', 'Mock Mine menu data'],
      ['功能开发中', 'unavailable Mine menu'],
      ['uni.scanCode', 'unavailable Mine scanner'],
      ['type=favorite', 'fake favorites route'],
      ['mock-task-', 'Mock task id'],
      ['/static/mock/', 'Mock task image'],
      ['api/mock/data', 'Mock task data module'],
    ],
  },
  {
    dir: join(mobileRoot, 'dist/build/mp-weixin'),
    entries: [
      ['home', (path) => /pages[\\/]home[\\/]home/.test(path)],
      ['template', (path) => /pages[\\/]template[\\/]template/.test(path)],
      ['mine', (path) => /pages[\\/]mine[\\/]mine/.test(path)],
      ['vip', (path) => /pages-sub[\\/]vip[\\/]vip/.test(path)],
      ['task-history', (path) => /pages-sub[\\/]task-history[\\/]task-history/.test(path)],
      ['task-api', (path) => /api[\\/]modules[\\/]tasks/.test(path)],
      ['task-result', (path) => /api[\\/]modules[\\/]task-result/.test(path)],
      ['profile-api', (path) => /api[\\/]modules[\\/]profile/.test(path)],
      ['app-v1-transport', (path) => /api[\\/]v1-client/.test(path)],
    ],
    forbidden: [
      ['app-ecommerce-suite', 'disabled ecommerce suite entry'],
      ['app-matting', 'disabled matting entry'],
      ['app-hd', 'disabled HD entry'],
      ['app-hot-video', 'disabled hot video entry'],
      ['tpl-', 'Mock template id prefix'],
      ['makeTemplates', 'Mock template generator'],
      ['vipTiers', 'Mock VIP tier data'],
      ['支付宝', 'executable payment method label'],
      ['mock-pay', 'Mock payment adapter'],
      ['uni.requestPayment', 'native payment call'],
      ['mineMenus', 'Mock Mine menu data'],
      ['功能开发中', 'unavailable Mine menu'],
      ['uni.scanCode', 'unavailable Mine scanner'],
      ['type=favorite', 'fake favorites route'],
      ['mock-task-', 'Mock task id'],
      ['/static/mock/', 'Mock task image'],
      ['api/mock/data', 'Mock task data module'],
      ['new URL(', 'browser URL constructor'],
      ['new Headers(', 'browser Headers constructor'],
    ],
  },
]

for (const check of artifactChecks) {
  const platformFiles = walk(check.dir)
  for (const [entry, match] of check.entries) {
    const files = platformFiles.filter(match)
    if (!files.length) {
      failures.push(
        `missing ${entry} production entry artifacts under ${relative(repoRoot, check.dir)}; run the platform build first`,
      )
      continue
    }
    for (const path of files) {
      const source = readFileSync(path, 'utf8')
      for (const [marker, label] of check.forbidden) {
        if (source.includes(marker)) {
          failures.push(`${relative(repoRoot, path)}: contains ${label} (${marker})`)
        }
      }
    }
  }
}

if (failures.length) {
  console.error('Mobile production entrypoint check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Mobile production entrypoint check passed')
