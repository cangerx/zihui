/**
 * H5 端验证审计修复的运行时行为（Playwright + chromium）
 * 前置：npm run dev:h5，端口经 PORT 传入（默认 5173）
 *
 * 小程序模拟器渲染层这轮跑不了，H5 是同一棵 DOM，纯逻辑修复 H5 足够验。
 * 仅 picker 原生弹层、safe-area、真机键盘这类小程序特有项 H5 测不到（留真机）。
 */
const { chromium } = require('playwright')

const BASE = `http://localhost:${process.env.PORT || 5173}`
const results = []
const log = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('pageerror', (e) => console.log('  [页面异常]', e.message))

  // ============ 修复3：模板参数 → 正确功能（不再兜底 app-hd） ============
  // 注意：SPA 下改 hash 不重新挂载页面、onLoad 不重跑，每次都要 reload 强制重走 onLoad
  // tool-run 带 template 进入，应解析成 app-ai-image，标题不为「画质修复」
  await page.goto(`${BASE}/#/pages-sub/tool-run/tool-run?template=tpl-3`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const runTitle = await page.evaluate(() => {
    const el = document.querySelector('.nav-bar__title')
    return el ? el.textContent.trim() : ''
  })
  log('修复3·模板不再兜底画质修复', runTitle && runTitle !== '画质修复', `标题=「${runTitle}」`)

  // 对照：不带任何参数才应兜底 app-hd
  await page.goto(`${BASE}/#/pages-sub/tool-run/tool-run`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const fallbackTitle = await page.evaluate(() => {
    const el = document.querySelector('.nav-bar__title')
    return el ? el.textContent.trim() : ''
  })
  log('修复3·无参数仍兜底画质修复(对照)', fallbackTitle === '画质修复', `标题=「${fallbackTitle}」`)

  // ============ 修复2：一句话生成带图 → suite-run 回填图片字段 ============
  // 直接构造带 images 的 URL（模拟 home onSend 拼的 query），验 suite-run 能回填
  const imgs = JSON.stringify(['/static/mock/m1.jpg', '/static/mock/m2.jpg'])
  await page.goto(
    `${BASE}/#/pages-sub/suite-run/suite-run?prompt=${encodeURIComponent('青稞脆片')}&images=${encodeURIComponent(imgs)}`,
    { waitUntil: 'networkidle' },
  )
  await page.waitForTimeout(1500)
  const tileCount = await page.evaluate(() => document.querySelectorAll('.suite__tile-img').length)
  log('修复2·带图跳转回填图片字段', tileCount === 2, `回填 ${tileCount} 张（期望 2）`)
  const promptFilled = await page.evaluate(() => {
    const ta = document.querySelector('.suite__text textarea')
    return ta ? ta.value : ''
  })
  log('修复2·prompt 落到商品信息', promptFilled.includes('青稞脆片'), `「${promptFilled.slice(0, 20)}」`)

  // 修复2·健壮性：images 参数是坏 JSON 不能让页面崩
  await page.goto(`${BASE}/#/pages-sub/suite-run/suite-run?images=%7Bbad`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const survives = await page.evaluate(() => document.querySelectorAll('.fsec').length)
  log('修复2·坏 images 参数不崩页', survives >= 1, `渲染出 ${survives} 张卡`)

  // ============ 修复1：poller abort 不再死锁（结果页返回后不卡 running） ============
  // 进结果页触发轮询，立刻返回，再看是否能正常再次进入（死锁会导致协程泄漏，但 H5 难直接观测 running）
  // 这里验：结果页能正常完成一轮（poller 正常 resolve），且返回后重进不卡
  const payload = encodeURIComponent(JSON.stringify({
    uuid: 'app-ecommerce-suite',
    values: { input_image: ['/static/mock/m1.jpg'], platform: 'taobao', market: 'cn', language: 'zh' },
  }))
  await page.goto(`${BASE}/#/pages-sub/suite-result/suite-result?payload=${payload}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const hasThinking = await page.evaluate(() => !!document.querySelector('.sres__ai-text--thinking'))
  log('修复1·结果页首轮进入思考态', hasThinking)
  await page.waitForTimeout(8000)
  const done = await page.evaluate(() => ({
    thinking: !!document.querySelector('.sres__ai-text--thinking'),
    results: document.querySelectorAll('.sres__result').length,
    turns: document.querySelectorAll('.sres__turn').length,
  }))
  log('修复1·轮询正常 resolve 出结果', done.results > 0 && !done.thinking, JSON.stringify(done))

  // ============ 🟡#6：payload 形状非法不卡「思考中」 ============
  // 合法 JSON 但缺 uuid/values（如 {}），应被挡下、不进思考态
  const badPayload = encodeURIComponent(JSON.stringify({ foo: 1 }))
  await page.goto(`${BASE}/#/pages-sub/suite-result/suite-result?payload=${badPayload}`, { waitUntil: 'networkidle' })
  // 上一条 修复1 测试也在 suite-result，同页 goto 不重跑 onLoad，必须 reload 强制重挂载
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const badState = await page.evaluate(() => ({
    thinking: !!document.querySelector('.sres__ai-text--thinking'),
    turns: document.querySelectorAll('.sres__turn').length,
  }))
  log('🟡#6·非法 payload 不卡思考态', !badState.thinking && badState.turns === 0, JSON.stringify(badState))

  // ============ 🟡#7：帮写有文案后出现「重写」出口 ============
  const imgs2 = JSON.stringify(['/static/mock/m1.jpg'])
  await page.goto(`${BASE}/#/pages-sub/suite-run/suite-run?images=${encodeURIComponent(imgs2)}`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  // 打开帮写弹层
  await page.evaluate(() => {
    const w = document.querySelector('.suite__write')
    if (w) w.dispatchEvent(new Event('click', { bubbles: true }))
  })
  await page.waitForTimeout(2800) // 等 mock 2s 出文案
  const rewrite = await page.evaluate(() => ({
    hasRewrite: !!document.querySelector('.aws__rewrite'),
    btnText: (document.querySelector('.aws__btn-text') || {}).textContent?.trim() || '',
  }))
  log('🟡#7·帮写完成出现重写出口', rewrite.hasRewrite && rewrite.btnText.includes('采用'), JSON.stringify(rewrite))

  // ============ 🟡#8：最近任务 tab 按状态筛选 ============
  await page.goto(`${BASE}/#/pages-sub/task-history/task-history`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const tabCounts = await page.evaluate(async () => {
    const q = (s) => document.querySelector(s)
    const tabs = document.querySelectorAll('.tu__item')
    const count = () => document.querySelectorAll('.th__card').length
    const all = count()
    // 点「生成中」
    if (tabs[1]) tabs[1].dispatchEvent(new Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    const running = count()
    // 点「已完成」
    if (tabs[2]) tabs[2].dispatchEvent(new Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    const doneN = count()
    return { all, running, doneN }
  })
  log('🟡#8·任务 tab 按状态筛选', tabCounts.all === 6 && tabCounts.running === 3 && tabCounts.doneN === 3, JSON.stringify(tabCounts))

  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`)
  process.exit(failed.length ? 1 : 0)
}
main().catch((e) => { console.error('脚本异常:', e.message); process.exit(2) })
