const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Mac 签名：
 * - 设置了 CSC_NAME 且不是 "-"：electron-builder 已用该身份签过（含 hardened runtime）。
 *   这里只清隔离属性，禁止 --force --deep 覆盖，否则会把正式签名冲成无 runtime 的残签。
 * - 否则：ad-hoc（codesign --sign -），因为 identity=- 会被 electron-builder 当成证书名并跳过。
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const identity = (process.env.CSC_NAME || '').trim()
  const useRealCert = Boolean(identity && identity !== '-')
  const apps = fs.readdirSync(context.appOutDir).filter((name) => name.endsWith('.app'))
  for (const name of apps) {
    const appPath = path.join(context.appOutDir, name)
    execSync(`xattr -cr ${JSON.stringify(appPath)}`)
    if (useRealCert) {
      console.log(`[afterPack] keep electron-builder signature identity=${identity} ${appPath}`)
      continue
    }
    execSync(`codesign --force --deep --sign - ${JSON.stringify(appPath)}`, { stdio: 'inherit' })
    console.log(`[afterPack] ad-hoc signed ${appPath}`)
  }
}
