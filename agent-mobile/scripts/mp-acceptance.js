/**
 * 微信小程序端验收（miniprogram-automator 驱动模拟器）
 *
 * 前置：
 *   1. 开发者工具 → 设置 → 安全设置 → 服务端口 开启
 *   2. npm run dev:mp-weixin            ← 必须用 dev 产物，prod 的 VITE_USE_MOCK=false 会去打真接口
 *   3. cli close --project dist/build/mp-weixin   ← 若之前开过别的产物
 *      cli open  --project dist/dev/mp-weixin
 *      cli auto  --project dist/dev/mp-weixin --auto-port 9420
 *
 * 用法结论（踩过的坑）：
 *   - 页面级 page.$$('.srow') 能穿透自定义组件；宿主节点再 .$$('.srow') 反而拿不到
 *   - 原生 chooseImage / picker 弹层 automator 点不了，分别用 mockWxMethod 与 trigger('change') 绕
 */
const automator = require('miniprogram-automator')

const PORT = 9420
const results = []

function log(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

function near(name, actual, target, tol = 3) {
  const ok = Math.abs(actual - target) <= tol
  log(name, ok, `实测 ${actual} / 目标 ${target}`)
}

async function main() {
  const mp = await automator.connect({ wsEndpoint: `ws://localhost:${PORT}` })
  const sys = await mp.evaluate(() => wx.getSystemInfoSync())
  const rpx = sys.windowWidth / 750
  console.log(`已连接 · ${sys.model || 'sim'} ${sys.windowWidth}×${sys.windowHeight} 1rpx=${rpx.toFixed(3)}px\n`)

  /** px → 设计px（1260 稿） */
  const D = (px) => Math.round(px / rpx / 0.595)

  // ================= 首页状态 B =================
  console.log('--- 首页状态 B')
  let page = await mp.reLaunch('/pages/home/home')
  await page.waitFor(900)

  const chips = await page.$$('.chips__item')
  log('分类胶囊渲染', chips.length >= 4, `${chips.length} 个`)

  if (chips.length) {
    await chips[0].tap()
    await page.waitFor(800)
  }
  const swiper = await page.$('.cs')
  log('状态 B 出现案例卡轮播', !!swiper)

  if (swiper && chips.length) {
    // Element 只有 offset() → {left, top}，没有 offsetTop/offsetLeft
    const swTop = (await swiper.offset()).top
    const chipTop = (await chips[0].offset()).top
    log('卡片在胶囊上方', swTop < chipTop, `卡 ${Math.round(swTop)} < chips ${Math.round(chipTop)}`)

    const cards = await page.$$('.cs__card')
    log('三张卡同屏', cards.length >= 3, `${cards.length} 张`)
    if (cards.length) {
      const sz = await cards[0].size()
      log('卡片竖长方形', sz.height > sz.width * 1.2,
        `${D(sz.width)}×${D(sz.height)} 设计px（目标 482×741）`)
      near('卡片宽', D(sz.width), 482, 12)
      near('卡片高', D(sz.height), 741, 14)
    }

    // 标题区应被压平
    const hero = await page.$('.home__hero')
    if (hero) {
      const hs = await hero.size()
      log('状态 B 标题区压平', hs.height < 4, `高 ${hs.height.toFixed(1)}px`)
    }
  }

  // 点案例卡回填（曾因 tap 事件名被原生顶掉而静默失败，这条是回归防线）
  const cards2 = await page.$$('.cs__card')
  if (cards2.length) {
    await cards2[Math.min(1, cards2.length - 1)].tap()
    await page.waitFor(800)
    const thumbs = await page.$$('.aic__thumb')
    log('案例卡回填缩略图', thumbs.length > 0, `${thumbs.length} 张`)
    const ta = await page.$('.aic__input')
    const val = ta ? await ta.property('value') : ''
    log('案例卡回填 prompt', !!val && val.length > 5, `${(val || '').length} 字`)
    const swAfter = await page.$('.cs')
    log('回填后轮播收起', !swAfter)
  }

  // ================= 套图表单页 =================
  console.log('\n--- 电商套图表单页')
  page = await mp.navigateTo('/pages-sub/suite-run/suite-run')
  await page.waitFor(1200)

  const secs = await page.$$('.fsec')
  log('区块卡三张', secs.length === 3, `${secs.length} 张`)

  const titles = []
  for (const t of await page.$$('.fsec__title')) titles.push((await t.text()).trim())
  log('区块标题', titles.join('/') === '上传商品图/生成设置/商品信息', titles.join(' / '))

  // 卡片几何（小程序 rpx 换算，H5 测不到这层）
  if (secs.length) {
    const s0 = await secs[0].size()
    const off = await secs[0].offset()
    near('卡左边界(设计px)', D(off.left), 49)
    near('卡宽(设计px)', D(s0.width), 1162, 6)
  }

  const rows = await page.$$('.srow')
  log('设置行三行', rows.length === 3, `${rows.length} 行`)
  if (rows.length) {
    const rs = await rows[0].size()
    near('设置行高(设计px)', D(rs.height), 183, 5)
    if (rows.length > 1) {
      const t0 = (await rows[0].offset()).top
      const t1 = (await rows[1].offset()).top
      near('设置行行距(设计px)', D(t1 - t0), 183, 5)
    }
  }

  const labels = []
  const vals = []
  for (const r of await page.$$('.srow__label')) labels.push((await r.text()).trim())
  for (const r of await page.$$('.srow__value')) vals.push((await r.text()).trim())
  log('设置行标签', labels.join('/') === '目标平台/目标市场/输出语言', labels.join(' / '))
  log('设置行默认值', vals.join('/') === '淘宝天猫1688/中国/中文', vals.join(' / '))

  // picker 接线：原生弹层点不了，直接触发 change 验证取值链路
  const pickers = await page.$$('.srow-picker')
  log('picker 组件三个', pickers.length === 3, `${pickers.length} 个`)
  if (pickers.length) {
    await pickers[0].trigger('change', { value: 1 })
    await page.waitFor(500)
    const v0 = await page.$('.srow__value')
    const nv = v0 ? (await v0.text()).trim() : ''
    log('picker 选值生效', nv === '京东', `切到「${nv}」（期望 京东）`)
    // 还原
    await pickers[0].trigger('change', { value: 0 })
    await page.waitFor(300)
  }

  // 上传瓦片几何
  const tile = await page.$('.suite__tile')
  if (tile) {
    const sz = await tile.size()
    near('上传瓦片(设计px)', D(sz.width), 193, 5)
  }

  // 未上传图时帮写应被拦截
  const writeBtn = await page.$('.suite__write')
  log('AI帮写入口存在', !!writeBtn)
  if (writeBtn) {
    await writeBtn.tap()
    await page.waitFor(600)
    const sheet = await page.$('.aws')
    log('未上传图时拦截帮写', !sheet, sheet ? '弹层打开了（应拦截）' : '已拦截')
  }

  // mock 掉原生相册，走真实 chooseImage 链路
  await mp.mockWxMethod('chooseImage', {
    tempFilePaths: ['/static/mock/m1.jpg'],
    tempFiles: [{ path: '/static/mock/m1.jpg', size: 102400 }],
  })
  const addTile = await page.$('.suite__tile--add')
  if (addTile) {
    await addTile.tap()
    await page.waitFor(900)
    const tiles = await page.$$('.suite__tile')
    log('chooseImage 后瓦片增加', tiles.length === 2, `${tiles.length} 个（含添加位）`)
  }

  // 帮写弹层完整链路
  if (writeBtn) {
    await writeBtn.tap()
    await page.waitFor(700)
    const sheet = await page.$('.aws')
    log('有图后弹层打开', !!sheet)
    if (sheet) {
      const btn = await page.$('.aws__btn')
      const txt = btn ? (await btn.text()).trim() : ''
      log('弹层 loading 文案', txt.includes('正在帮写'), txt)

      // loading 底色应为实测灰
      const cls = btn ? await btn.attribute('class') : ''
      log('loading 态样式命中', (cls || '').includes('--loading'), cls)

      await page.waitFor(2800)
      const btn2 = await page.$('.aws__btn')
      const txt2 = btn2 ? (await btn2.text()).trim() : ''
      log('帮写完成切「采用」', txt2.includes('采用'), txt2)

      const body = await page.$('.aws__text')
      const bodyTxt = body ? (await body.text()).trim() : ''
      log('弹层正文出文案', bodyTxt.includes('青稞'), `${bodyTxt.length} 字`)

      if (btn2) {
        await btn2.tap()
        await page.waitFor(700)
        const closed = await page.$('.aws')
        log('采用后弹层关闭', !closed)
        const ta = await page.$('.suite__text')
        const v = ta ? await ta.property('value') : ''
        log('采用后回填商品信息', !!v && v.includes('青稞'), `${(v || '').length} 字`)
      }
    }
  }

  // ================= 结果对话页 =================
  console.log('\n--- 结果对话页')
  const payload = encodeURIComponent(JSON.stringify({
    uuid: 'app-ecommerce-suite',
    values: { input_image: ['/static/mock/m1.jpg'], platform: 'taobao', market: 'cn', language: 'zh' },
  }))
  page = await mp.navigateTo(`/pages-sub/suite-result/suite-result?payload=${payload}`)
  await page.waitFor(1200)

  const thinking = await page.$('.sres__ai-text--thinking')
  log('首轮思考态出现', !!thinking)

  const bubble = await page.$('.sres__bubble')
  log('用户消息卡渲染', !!bubble)
  if (bubble) {
    const sz = await bubble.size()
    near('气泡宽(设计px)', D(sz.width), 636, 8)
    const img = await page.$('.sres__bubble-img')
    if (img) {
      const isz = await img.size()
      near('气泡内图宽(设计px)', D(isz.width), 553, 8)
      near('气泡内图高(设计px)', D(isz.height), 982, 12)
    }
  }

  await page.waitFor(8000)
  const turns = await page.$$('.sres__turn')
  log('首轮两条消息', turns.length === 2, `${turns.length} 条`)
  const imgs = await page.$$('.sres__result')
  log('结果图渲染', imgs.length > 0, `${imgs.length} 张`)
  const gone = await page.$('.sres__ai-text--thinking')
  log('思考态已结束', !gone)

  // 发送钮禁用态
  const send = await page.$('.sres__send')
  const cls0 = send ? await send.attribute('class') : ''
  log('空输入时发送钮禁用', !(cls0 || '').includes('--on'), cls0)

  // 追加需求
  const field = await page.$('.sres__field')
  if (field) {
    await field.input('把背景换成浅木色台面')
    await page.waitFor(600)
    const send2 = await page.$('.sres__send')
    const cls1 = send2 ? await send2.attribute('class') : ''
    log('有输入时发送钮激活', (cls1 || '').includes('--on'), cls1)

    await send2.tap()
    await page.waitFor(1000)
    const t2 = await page.$$('.sres__turn')
    log('追加需求新增两条', t2.length === 4, `${t2.length} 条`)

    const ta2 = await page.$('.sres__field')
    const left = ta2 ? await ta2.property('value') : 'x'
    log('发送后清空输入', !left, `残留「${left}」`)

    await page.waitFor(8000)
    const imgs2 = await page.$$('.sres__result')
    log('第二轮出图', imgs2.length > imgs.length, `${imgs2.length} 张`)
  }

  // 页面栈
  await mp.navigateBack()
  await page.waitFor(800)
  const cur = await mp.currentPage()
  log('返回到表单页', (await cur.path).includes('suite-run'), await cur.path)

  await mp.disconnect()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`)
  if (failed.length) {
    console.log('未通过：')
    failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail || ''}`))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('脚本异常:', e && e.message ? e.message : e)
  process.exit(2)
})
