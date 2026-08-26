#!/usr/bin/env node
/**
 * mac 双架构稳健打包脚本
 *
 * 背景（根因）：
 *   CI 跑在 macos-latest（现已是 Apple Silicon = arm64）单 runner。原先 `npm run dist`
 *   用单次 electron-builder 同时打 zip 的 [x64, arm64]，两架构共享同一份 node_modules：
 *     - better-sqlite3（编译/prebuild 型）只被为 host=arm64 落了一份 .node；
 *     - @resvg/resvg-js-darwin-*、sqlite-vec-darwin-* 是 cpu 门控的 optional 子包，
 *       arm64 host 上只装了 -arm64 那套，-x64 子包根本不在磁盘。
 *   electron-builder 在单次多 arch 构建里对这些模块的「为非 host arch 重建/取件」并不可靠，
 *   于是 arm64 的二进制被原样塞进 x64 的 zip → Intel Mac 用户 dlopen 报
 *   "mach-o, but wrong architecture"（better_sqlite3.node 无 try/catch，启动建库即硬崩）。
 *
 * 修复思路：
 *   每个 arch 都在「为该 arch 干净安装的 node_modules」状态下单独打包。
 *   - 用 npm_config_arch / npm_config_cpu / npm_config_os 让 npm ci 选装该 arch 的 cpu 门控
 *     optional 子包，并让 better-sqlite3 的 prebuild-install 拉取该 arch 的 N-API 预编译
 *     （N-API 二进制跨 node/electron 通用，无需交叉编译，最确定性正确）。
 *   - app-builder-bin / 7zip-bin 是单包内置全平台二进制、运行时按 host 选，不受 npm_config_arch
 *     影响，所以构建工具本身仍正常跑 arm64。
 *   - 每个 arch 输出到独立目录（electron-builder 每次运行会清空 directories.output，
 *     若都打到 dist/ 第二个 arch 会把第一个的产物删掉）。
 *   - 最后把两 arch 的 zip+blockmap 汇到 dist/，并把两份 latest-mac.yml 的 files[] 合并成
 *     一份覆盖双架构的 latest-mac.yml（electron-updater ^6 会从 files[] 按运行架构挑对应 zip）。
 *
 * 前置：electron-vite build 已产出 out/（本脚本不重复构建渲染层/主进程 JS）。
 * 调用：build-mac.yml 的 Build & Package 步骤里 `npm run build && node scripts/dist-mac-per-arch.js`。
 * 兜底：CI 另有一步 lipo 硬断言核验「每个 zip 内 .node 架构都对 + latest-mac.yml 覆盖双架构」，
 *       本脚本只要有一处泄漏，断言会让整个 build 失败，绝不放行错架构包。
 */
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const ARCHES = ['x64', 'arm64']
const MAC_BUNDLE_ID = 'com.dianfu.dianfuappA2'
const PROFILE_SRC = path.join(ROOT, '..', '证书', 'dis_DeveloperIDApplication.provisionprofile')
const PROFILE_DEST = path.join(ROOT, 'build', 'dianfu.provisionprofile')

function prepareMacSigningAssets() {
  if (!fs.existsSync(PROFILE_SRC)) {
    throw new Error('缺少 Developer ID 描述文件: ' + PROFILE_SRC)
  }
  fs.copyFileSync(PROFILE_SRC, PROFILE_DEST)
  console.log('provisioningProfile ->', PROFILE_DEST)
}

function run(cmd, extraEnv) {
  console.log(`\n> ${cmd}${extraEnv ? '   (' + Object.keys(extraEnv).join(',') + ')' : ''}`)
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, env: { ...process.env, ...extraEnv } })
}

// 跨架构安装所需的 npm 配置：
//   npm_config_cpu / npm_config_os  → npm 选装 optional 平台子包（resvg/sqlite-vec）的目标
//   npm_config_arch / npm_config_target_arch → prebuild-install / node-gyp 的目标架构
//   npm_config_platform → darwin
function installEnv(arch) {
  return {
    npm_config_arch: arch,
    npm_config_target_arch: arch,
    npm_config_cpu: arch,
    npm_config_os: 'darwin',
    npm_config_platform: 'darwin'
  }
}

// 从 electron-builder 依赖树兜底加载 js-yaml，避免顶层 hoist 不确定导致 require 失败。
function loadYaml() {
  try {
    return require('js-yaml')
  } catch (_) {
    const ebReq = createRequire(require.resolve('electron-builder/package.json'))
    return ebReq('js-yaml')
  }
}

function packArch(arch) {
  console.log(`\n========== [${arch}] clean install for target arch ==========`)
  run('npm ci', installEnv(arch))
  // 显式按 electron ABI + 目标 arch 落位 better-sqlite3，纠正 postinstall 可能按 host arch 的落位。
  run(`npx electron-builder install-app-deps --platform=darwin --arch=${arch}`, installEnv(arch))

  console.log(`\n========== [${arch}] package (zip + dmg) ==========`)
  // zip：自动更新；dmg：解压/打开后可把 app 拖进「应用程序」
  run(
    `npx electron-builder --mac zip dmg --${arch} --publish never -c.directories.output=dist-${arch} -c.appId=${MAC_BUNDLE_ID}`
  )

  const archDir = path.join(ROOT, `dist-${arch}`)
  const zip = fs.readdirSync(archDir).find((f) => f.endsWith('-mac.zip'))
  if (!zip) throw new Error(`[${arch}] 未产出 zip: ${archDir}`)
  console.log(`[${arch}] zip = ${zip}`)
}

function filesOf(doc) {
  return Array.isArray(doc.files) ? doc.files : []
}

function main() {
  prepareMacSigningAssets()
  for (const arch of ARCHES) packArch(arch)

  const YAML = loadYaml()

  // 统一汇集到一个干净的 dist/
  fs.rmSync(DIST, { recursive: true, force: true })
  fs.mkdirSync(DIST, { recursive: true })

  const docs = {}
  for (const arch of ARCHES) {
    const archDir = path.join(ROOT, `dist-${arch}`)
    for (const f of fs.readdirSync(archDir)) {
      if (f.endsWith('.zip') || f.endsWith('.zip.blockmap') || f.endsWith('.dmg') || f.endsWith('.dmg.blockmap')) {
        fs.copyFileSync(path.join(archDir, f), path.join(DIST, f))
      }
    }
    const ymlPath = path.join(archDir, 'latest-mac.yml')
    if (!fs.existsSync(ymlPath)) throw new Error(`latest-mac.yml 未生成: ${ymlPath}`)
    docs[arch] = YAML.load(fs.readFileSync(ymlPath, 'utf8'))
  }

  // 合并 latest-mac.yml：以 arm64 为骨架，并入 x64 的 files[]（按 url 去重）。
  const base = docs.arm64
  const seen = new Set()
  const mergedFiles = []
  for (const f of [...filesOf(base), ...filesOf(docs.x64)]) {
    if (!f || !f.url || seen.has(f.url)) continue
    seen.add(f.url)
    mergedFiles.push(f)
  }
  base.files = mergedFiles.filter((f) => f && typeof f.url === 'string' && f.url.endsWith('.zip'))
  const armZip = base.files.find((f) => String(f.url).includes('arm64') && String(f.url).endsWith('.zip'))
  if (armZip) {
    base.path = armZip.url
    if (armZip.sha512) base.sha512 = armZip.sha512
  }

  // 硬校验：合并后的 files[] 每个 zip url 必须真实存在于 dist/，否则自动更新会 404。
  for (const f of base.files) {
    if (!f.url.endsWith('.zip')) continue
    if (!fs.existsSync(path.join(DIST, f.url))) {
      throw new Error(`latest-mac.yml 引用了 dist 中不存在的文件: ${f.url}`)
    }
  }

  fs.writeFileSync(path.join(DIST, 'latest-mac.yml'), YAML.dump(base, { lineWidth: -1 }), 'utf8')

  // 清理 per-arch 临时目录
  for (const arch of ARCHES) {
    fs.rmSync(path.join(ROOT, `dist-${arch}`), { recursive: true, force: true })
  }

  console.log('\n========== dist/ final ==========')
  for (const f of fs.readdirSync(DIST)) console.log('  ' + f)
  console.log('\n========== merged latest-mac.yml ==========')
  console.log(fs.readFileSync(path.join(DIST, 'latest-mac.yml'), 'utf8'))
}

main()
