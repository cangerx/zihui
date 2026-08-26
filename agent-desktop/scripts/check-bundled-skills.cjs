const { existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

// 首次交付暂不预装第三方技能；未来新增时必须经过产品审核后写入此清单。
const approvedBundledSkills = new Set([])
const bundledDir = join(__dirname, '..', 'resources', 'bundled-skills')

if (!existsSync(bundledDir)) process.exit(0)

const unapproved = readdirSync(bundledDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  .map((entry) => entry.name)
  .filter((name) => !approvedBundledSkills.has(name))

if (unapproved.length) {
  console.error(`发现未经审核的预装技能：${unapproved.join('、')}`)
  process.exit(1)
}
