#!/usr/bin/env node
/**
 * 云打包参数注入脚本
 * 由 .github/workflows/build-{win,mac}.yml 在 checkout 后调用
 * 详细职责见 agent-admin/docs/云打包系统设计.md 第 6.3 节
 *
 * 必填环境变量：
 *   BUILD_ID    打包请求 UUID
 *   APP_NAME    应用显示名 ^[a-zA-Z0-9_\-\s\u4e00-\u9fa5]{1,50}$
 *   DOMAIN      云控端域名（含协议，如 https://a.com）
 *   API_DOMAIN  软件 API 域名（含协议）
 *   ICON_URL    图标下载 URL（PNG，<=2MB，<=1024x1024，正方形）
 *   PLATFORM    win | mac
 *
 * 可选环境变量（本地干跑用）：
 *   DRY_RUN=1                不写任何文件，仅日志
 *   ICON_LOCAL_PATH=path     用本地图标替代 ICON_URL 下载
 *
 * 写入：
 *   build/icon.png                覆盖
 *   build/icon.ico                (PLATFORM=win) 由 png-to-ico 生成
 *   package.json                  name / productName
 *   electron-builder.yml          appId / productName / executableName / shortcutName / uninstallDisplayName / publish.url
 *   resources/config.json         运行时配置（buildId/appName/appId/apiDomain/domain/builtAt）
 */

const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
const crypto = require('crypto')

const REPO_ROOT = path.resolve(__dirname, '..')
const DRY_RUN = process.env.DRY_RUN === '1'

function log(msg) {
  console.log(`[inject] ${msg}`)
}

function fail(msg) {
  console.error(`[inject] ERROR: ${msg}`)
  process.exit(1)
}

function env(name) {
  const v = process.env[name]
  if (!v) fail(`missing env: ${name}`)
  return v
}

function optionalEnv(name) {
  const v = process.env[name]
  return v && String(v).trim() !== '' ? String(v).trim() : ''
}

function maskInActions(v) {
  if (process.env.GITHUB_ACTIONS && v) {
    console.log(`::add-mask::${v}`)
  }
}

// ---- 校验器 ----
function sanitizeAppName(s) {
  if (!/^[a-zA-Z0-9_\-\s\u4e00-\u9fa5]{1,50}$/u.test(s)) {
    fail(`invalid APP_NAME: ${s}`)
  }
  return s
}

function safeExecutableName(name) {
  // executableName 必须 ASCII 安全（NSIS / Mac binary 文件名约束）
  let safe = name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_\-]/g, '')
  // 折叠连续连字符 + 去首尾连字符（防止 "测试应用 App" → "-App" 这类前导符号）
  safe = safe.replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  if (!safe || safe.length < 2) {
    // 全中文/无可保留字符 兜底：用 hash 派生稳定短 ID
    safe = 'App-' + crypto.createHash('md5').update(name).digest('hex').slice(0, 8)
  }
  return safe
}

function reversedDomainOf(urlStr) {
  let host
  try {
    host = new URL(urlStr).hostname
  } catch (_e) {
    fail(`invalid DOMAIN: ${urlStr}`)
  }
  if (!host) fail(`invalid DOMAIN host: ${urlStr}`)
  return host.split('.').reverse().join('.')
}

function validatePlatform(p) {
  if (p !== 'win' && p !== 'mac') fail(`invalid PLATFORM: ${p}`)
  return p
}

function validateAppId(s) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,150}$/.test(s) || s.includes('..')) {
    fail(`invalid APP_ID: ${s}`)
  }
  return s
}

function validateAppVersion(s) {
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-+][0-9A-Za-z.-]+)?$/.test(s)) {
    fail(`invalid APP_VERSION: ${s}`)
  }
  return s
}

function validateBuildMode(s) {
  if (s !== 'normal' && s !== 'oem') fail(`invalid BUILD_MODE: ${s}`)
  return s
}

function validateProjectKey(s) {
  if (s !== '' && !/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(s)) {
    fail(`invalid OEM_PROJECT_KEY: ${s}`)
  }
  return s
}

function normalizeUpdateUrl(urlStr) {
  let u
  try {
    u = new URL(urlStr)
  } catch (_e) {
    fail(`invalid UPDATE_URL: ${urlStr}`)
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    fail(`invalid UPDATE_URL protocol: ${urlStr}`)
  }
  u.hash = ''
  u.search = ''
  const normalized = u.toString()
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

function parseBuildOptions(raw) {
  if (!raw || String(raw).trim() === '') return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail('BUILD_OPTIONS must be a JSON object')
    }
    return parsed
  } catch (e) {
    fail(`invalid BUILD_OPTIONS JSON: ${e.message}`)
  }
}

function ymlEscape(s) {
  // yaml flow scalar 安全字符集；不在此集合的值用单引号包裹（含中文/空格/特殊符号）
  if (/^[a-zA-Z0-9_\-./:]+$/.test(s)) return s
  return `'${s.replace(/'/g, "''")}'`
}

// ---- 网络 ----
function downloadFile(urlStr, redirects = 3) {
  return new Promise((resolve, reject) => {
    const lib = urlStr.startsWith('https:') ? https : http
    const req = lib.get(urlStr, (res) => {
      const code = res.statusCode || 0
      if ((code === 301 || code === 302 || code === 307 || code === 308) && res.headers.location && redirects > 0) {
        res.resume()
        return downloadFile(res.headers.location, redirects - 1).then(resolve, reject)
      }
      if (code !== 200) {
        return reject(new Error(`HTTP ${code} on ${urlStr}`))
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(30000, () => req.destroy(new Error('icon download timeout')))
  })
}

// ---- PNG 校验 ----
function validatePng(buf) {
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buf.length < 24 || !buf.slice(0, 8).equals(magic)) {
    fail('icon is not a valid PNG (magic mismatch)')
  }
  // IHDR chunk: 8 byte sig + 4 byte length + 4 byte type "IHDR" + 13 byte data
  // width = byte 16-19, height = byte 20-23 (big endian)
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  // 与 agent-admin CloudBuildIconController 校验对齐：512~1024 1:1 PNG
  // 这是第三道防线，前面两道在 agent-admin 前端 (<img>.naturalWidth)
  // 和后端 (getimagesize)。
  if (width < 512 || width > 1024 || height < 512 || height > 1024) {
    fail(`icon size out of range (must be 512~1024): ${width}x${height}`)
  }
  if (width !== height) {
    fail(`icon must be square: got ${width}x${height}`)
  }
  return { width, height }
}

// ---- 文件 IO（含 dry-run）----
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

function writeJson(p, data) {
  if (DRY_RUN) {
    log(`[dry] write ${p}`)
    return
  }
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

function writeBuffer(p, buf) {
  if (DRY_RUN) {
    log(`[dry] write ${p} (${buf.length} bytes)`)
    return
  }
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, buf)
}

function ymlReplace(content, key, value, opts) {
  const indent = (opts && opts.indent) || ''
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^(${indent}${escapedKey}:[ \\t]*)(.*?)([ \\t]*)$`, 'gm')
  let count = 0
  const result = content.replace(re, (_m, prefix, _old, trail) => {
    count++
    return `${prefix}${value}${trail}`
  })
  if (count === 0) fail(`yml key not found: "${key}" (indent="${indent}")`)
  log(`yml ${indent}${key} -> ${value} (${count}x)`)
  return result
}

// ---- 主流程 ----
async function main() {
  const BUILD_ID = env('BUILD_ID')
  const APP_NAME = sanitizeAppName(env('APP_NAME'))
  const DOMAIN = env('DOMAIN').replace(/\/+$/, '')
  const API_DOMAIN = env('API_DOMAIN').replace(/\/+$/, '')
  const PLATFORM = validatePlatform(env('PLATFORM'))
  // 图标来源：ICON_LOCAL_PATH = 云打包时 commit 到仓库的本地文件；ICON_URL = 云端原始图标 URL。
  // 二者至少有一个。云打包会同时传两者：优先读本地文件，文件缺失时回退到 URL 下载——
  // 规避「图标 commit 到 main 后、workflow_dispatch 解析 ref 抢在其可见之前 → checkout 缺图标」的竞态。
  const ICON_LOCAL = process.env.ICON_LOCAL_PATH || ''
  const ICON_REMOTE = optionalEnv('ICON_URL')
  if (!ICON_LOCAL && !ICON_REMOTE) fail('missing icon source: need ICON_LOCAL_PATH or ICON_URL')
  const BUILD_OPTIONS = parseBuildOptions(optionalEnv('BUILD_OPTIONS'))

  maskInActions(DOMAIN)
  maskInActions(API_DOMAIN)
  maskInActions(ICON_REMOTE)
  maskInActions(optionalEnv('BUILD_OPTIONS'))

  const EXEC_NAME = safeExecutableName(APP_NAME)
  const BUILD_MODE = validateBuildMode(optionalEnv('BUILD_MODE') || BUILD_OPTIONS.build_mode || 'normal')
  const OEM_PROJECT_KEY = validateProjectKey(optionalEnv('OEM_PROJECT_KEY') || BUILD_OPTIONS.oem_project_key || '')
  const APP_ID = validateAppId(optionalEnv('APP_ID') || BUILD_OPTIONS.app_id || `${reversedDomainOf(DOMAIN)}.app`)
  const UPDATE_URL = normalizeUpdateUrl(optionalEnv('UPDATE_URL') || BUILD_OPTIONS.update_url || `${DOMAIN}/updates/`)
  const APP_VERSION_RAW = optionalEnv('APP_VERSION') || BUILD_OPTIONS.app_version || ''
  const APP_VERSION = APP_VERSION_RAW ? validateAppVersion(APP_VERSION_RAW) : ''

  log(`build_id     = ${BUILD_ID}`)
  log(`app_name     = ${APP_NAME}`)
  log(`exec_name    = ${EXEC_NAME}`)
  log(`app_id       = ${APP_ID}`)
  log(`build_mode   = ${BUILD_MODE}`)
  log(`update_url   = ${UPDATE_URL}`)
  if (APP_VERSION) log(`app_version  = ${APP_VERSION}`)
  if (OEM_PROJECT_KEY) log(`project_key  = ${OEM_PROJECT_KEY}`)
  log(`platform     = ${PLATFORM}`)
  log(`dry_run      = ${DRY_RUN}`)

  // 1. 取得图标 buffer
  let iconBuf
  if (ICON_LOCAL && fs.existsSync(ICON_LOCAL)) {
    iconBuf = fs.readFileSync(ICON_LOCAL)
    log(`icon loaded from local: ${ICON_LOCAL} (${iconBuf.length} bytes)`)
  } else if (ICON_REMOTE) {
    // 本地图标缺失（云打包图标 commit 竞态导致 checkout 未含）→ 回退云端 URL 下载
    if (ICON_LOCAL) log(`local icon missing (${ICON_LOCAL}); falling back to ICON_URL download`)
    else log(`downloading icon from ICON_URL ...`)
    iconBuf = await downloadFile(ICON_REMOTE)
    log(`icon downloaded: ${iconBuf.length} bytes`)
  } else {
    fail(`icon unavailable: local "${ICON_LOCAL}" missing and no ICON_URL fallback`)
  }
  if (iconBuf.length > 2 * 1024 * 1024) fail('icon > 2MB')
  const dim = validatePng(iconBuf)
  log(`icon valid: ${dim.width}x${dim.height}`)

  // 2. 写入 build/icon.png，并预烘焙 App 圆角（Windows 不会再切）
  const iconPath = path.join(REPO_ROOT, 'build', 'icon.png')
  writeBuffer(iconPath, iconBuf)
  if (!DRY_RUN) {
    const { roundPngFile } = require('./round-png-corners')
    const n = roundPngFile(iconPath)
    log(`rounded icon.png (${n} bytes)`)
  }

  // 3. Win 平台生成 build/icon.ico
  if (PLATFORM === 'win' && !DRY_RUN) {
    const pngToIcoMod = require('png-to-ico')
    // 兼容 ESM 默认导出 与 CJS 直接导出
    const pngToIco = typeof pngToIcoMod === 'function' ? pngToIcoMod : pngToIcoMod.default
    const icoBuf = await pngToIco([iconPath])
    const icoPath = path.join(REPO_ROOT, 'build', 'icon.ico')
    writeBuffer(icoPath, icoBuf)
    log(`wrote ${icoPath} (${icoBuf.length} bytes)`)
  } else if (PLATFORM === 'win' && DRY_RUN) {
    log('[dry] skip png-to-ico generation')
  }

  // 4. 改写 package.json
  const pkgPath = path.join(REPO_ROOT, 'package.json')
  const pkg = readJson(pkgPath)
  pkg.name = EXEC_NAME.toLowerCase()
  // 安装目录/产物文件名必须 ASCII。中文 APP_NAME 只出现在快捷方式、卸载名和 runtime config。
  pkg.productName = EXEC_NAME
  if (APP_VERSION) pkg.version = APP_VERSION
  writeJson(pkgPath, pkg)
  log(`wrote ${pkgPath}`)

  // 5. 改写 electron-builder.yml
  const ebPath = path.join(REPO_ROOT, 'electron-builder.yml')
  let eb = fs.readFileSync(ebPath, 'utf-8')
  eb = ymlReplace(eb, 'appId', APP_ID)
  eb = ymlReplace(eb, 'productName', ymlEscape(EXEC_NAME))
  eb = ymlReplace(eb, 'executableName', ymlEscape(EXEC_NAME), { indent: '  ' })
  eb = ymlReplace(eb, 'shortcutName', ymlEscape(APP_NAME), { indent: '  ' })
  eb = ymlReplace(eb, 'uninstallDisplayName', ymlEscape(APP_NAME), { indent: '  ' })
  eb = ymlReplace(eb, 'url', UPDATE_URL, { indent: '  ' })
  if (DRY_RUN) {
    log(`[dry] electron-builder.yml preview:\n${eb}`)
  } else {
    fs.writeFileSync(ebPath, eb, 'utf-8')
    log(`wrote ${ebPath}`)
  }

  // 6. 生成 resources/config.json
  const configPath = path.join(REPO_ROOT, 'resources', 'config.json')
  const config = {
    buildId: BUILD_ID,
    appName: APP_NAME,
    appId: APP_ID,
    appVersion: APP_VERSION || pkg.version,
    apiDomain: API_DOMAIN,
    domain: DOMAIN,
    updateUrl: UPDATE_URL,
    buildMode: BUILD_MODE,
    oemProjectKey: OEM_PROJECT_KEY,
    builtAt: new Date().toISOString()
  }
  writeJson(configPath, config)
  log(`wrote ${configPath}`)

  // 7. 回归检查（防漏改）
  if (!DRY_RUN) {
    const checkFiles = [pkgPath, ebPath]
    let warned = 0
    for (const f of checkFiles) {
      const c = fs.readFileSync(f, 'utf-8')
      if (c.includes('LocalAgent')) {
        log(`WARN: residual "LocalAgent" in ${f}`)
        warned++
      }
      if (c.includes('your-cdn-domain.example.com')) {
        log(`WARN: residual "your-cdn-domain.example.com" in ${f}`)
        warned++
      }
      if (c.includes('com.local-agent.app')) {
        log(`WARN: residual "com.local-agent.app" in ${f}`)
        warned++
      }
    }
    if (warned > 0) log(`regression check: ${warned} warnings (review before publishing)`)
    else log(`regression check: clean`)
  }

  log('done.')
}

main().catch((e) => {
  console.error('[inject] FATAL:', (e && e.stack) || (e && e.message) || e)
  process.exit(1)
})
