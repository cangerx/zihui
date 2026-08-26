# Local Agent Desktop Changelog

本文档记录桌面端版本变更历史。版本号遵循语义化版本（SemVer）规范：`MAJOR.MINOR.PATCH`。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

---

## [Unreleased]

## [1.3.2] - 2026-08-24

> **修复升级后无法新建对话。**

### 修复

- **新建对话报错**：从旧版本升级后，本地库重建会话表时丢掉了工作区字段，新建对话会失败。启动时会自动补回缺列。

## [1.3.1] - 2026-08-24

> **Windows 云打包安装后不再铺满大图标，应用图标改为圆角。**

### 修复

- **Windows 安装后界面**：安装目录改用英文名，去掉会拦 CSS 的 crossorigin；品牌图标带固定宽高，样式没加载时也不会铺满窗口。
- **应用图标**：预烘焙圆角，Windows 任务栏和窗口图标不再是直角方块。
- **提示词编辑**：输入框右键可剪切、复制、粘贴、全选，不必依赖键盘快捷键。

## [1.3.0] - 2026-08-22

> **技能库双轨：云端已审核与本地未审核**。Mac 继续 Developer ID 签名。

### 新增

- **云端技能目录**：登录后可拉取云控已上架 Skill，离线使用上次缓存，安装前验签。
- **安全安装**：zip 拒绝路径穿越与超限包；安装失败回滚到原目录，不留下半成品。
- **数字员工绑定**：岗位可绑定云端或本地技能，本地目录可覆盖同名云端包；缺目录时跳过，不中断对话。

### 变更

- **技能库**：同一页筛选云端已审核 / 本地未审核；本地上传不会发到云端。

## [1.2.0] - 2026-08-20

> **爆款复刻成片与公开链入库**。Mac 继续 Developer ID 签名。

### 新增

- **成片口播**：爆款复刻成片可按口播走云控配音，再在本机用 ffmpeg 混进成片。
- **公开链入库**：可粘贴 TikTok / 抖音公开链接，本机 yt-dlp 落到本地；未装时在入库区提示 `brew install yt-dlp`。

### 修复

- **视频目录**：补回漏掉的云端视频目录接口，拆解/成片能拉到可用模型。
- **MCP 安装**：安装前把详情打成可克隆的纯对象，避免市场安装时报 clone 错误。

---

## [1.1.11] - 2026-08-19

> **对话、生图、当前文件夹三层分清**：直接开聊、品牌跟文件夹走、生图进该文件夹图库。Mac 继续 Developer ID 签名。

### 新增

- **默认对话（D-26）**：空态可直接发消息；会话 `bot_id` 可为空。引擎在无人设时注入默认身份（本机工作助手、先做再解释、不编造）。顶栏可选手动「默认」，也可再选已有智能体。默认开启生图、权限档「谨慎确认」。空会话写入 NULL，避免撞 `bots` 外键。
- **模型系统提示词**：自定义服务商可填写「默认系统提示词」（如 JanusOS 格式约束），对话时注入；留空仍用应用默认身份。
- **工作区品牌出图（D-28 / D-29）**：对话生图、AI 生图、批量生图会带上当前文件夹品牌色等硬约束；电商、画布、编辑、PPT 不自动带。成品拷到该文件夹 `output/`。
- **工作区品牌口吻（D-30）**：当前文件夹可写一段说话方式，每轮对话带上；有智能体时人设为主、口吻当附录。入口在对话「工作区文件」。
- **图库跟工作区走（D-31）**：生图归入当前文件夹图库，不再一律进全局「创作」。选图默认当前文件夹；旧「创作」改称「历史创作」。
- **就地存为预设**：生图页 / 批量 / 对话输入栏 / 助手消息可把常用句存进库，不跳到提示词墙开对话。

### 变更

- **自动化暂时隐藏**：侧栏「自动化」入口与定时调度先收起；实现保留，恢复时打开开关即可。
- **「更多」（D-27 / D-32）**：人设规则、小工具仍藏；本地图库留下，并补「提示词库」供批量整理。日常插入、存为仍在对话和生图页。智能体表单可直接写人设；自定义函数工具收到智能体「高级」。
- **智能体三步向导（D-27 P1）**：新建/编辑按「名字 → 人设 → 能力」分步；人设可从预设填入；生图/PPT/Skills/MCP 在第 3 步，开发者工具仍在高级。
- **生图模型记忆**：上次选用的生图模型会记住，不必每次重选。

---

## [1.1.10] - 2026-08-18

> 工作台近白配色。Mac 尝试用钥匙串开发证书签名。

### 变更

- 界面：侧栏浅灰白 `#F2F3F4`，主区纯白，去掉米黄底。

---

## [1.1.9] - 2026-08-18

> 对话可导出 Word、沉淀进知识库；PPT 会探测本机 Python。Mac 继续 ad-hoc 临时签名。

### 新增

- 对话：顶栏与助手消息可一键导出 Word。
- 对话：聊完可将要点沉淀为工作区知识库笔记，也可改为自动或关闭。
- PPT：运行 Skill 脚本时自动找本机 Python；未安装会提示安装或手动指定路径。

### 变更

- 侧栏「定时任务」改名为「自动化」。

---

## [1.1.8] - 2026-08-17

> 内置浏览器可真正操作网页；MCP 与模型收入设置。Mac 继续 ad-hoc 临时签名。

### 新增

- 内置浏览器：独立窗口带地址栏，Profile 隔离登录态；对话里可打开网页、点击、输入、截图。
- MCP、模型服务并入设置；人设规则留在侧栏「更多」。

---

## [1.1.7] - 2026-08-17

> 侧栏字标与红绿灯分行；工作区在主区以标签打开。Mac 继续 ad-hoc 临时签名。

### 新增

- 工作区在右侧顶栏以 Tab 打开，可同时开多个、关闭标签；侧栏点选即打开对应标签。

### 修复

- Mac 字标改到红绿灯下一行，不再和三个按钮挤在同一行。

---

## [1.1.6] - 2026-08-17

> 工作台界面按 NewMax 改版。Mac 继续 ad-hoc 临时签名。

### 新增

- 侧栏固定动作对齐 NewMax：新建对话、搜索、定时任务、浏览器、Skill 管理、每日回顾；创作下沉到更多。
- 输入条左三键（加号 / 文档 / 完全访问）、右为模型与发送；空态胶囊改为写作 / PPT / 调研 / 需求分析 / 视频。
- 轻量浏览器页：应用内窗口打开网页。

### 修复

- 启动时窗口标题不再闪一下 LocalAgent。

---

## [1.1.5] - 2026-08-17

> 应用图标改为官方黑底白 H；源文件铺满方图，圆角由系统裁切。Mac 继续 ad-hoc 临时签名。

### 修复

- 桌面端图标换成官方 H logo，Dock / 任务栏显示为原生 App 圆角。

---

## [1.1.4] - 2026-08-17

> 应用图标改为铺满铭绿方图，由系统切成 App 形状；网页小标用透明圆角方。Mac 继续 ad-hoc 临时签名。

### 修复

- 图标不再把圆角和黑角烤进 PNG，Dock / 任务栏不再像「黑方块里贴了一张图」。

---

## [1.1.3] - 2026-08-17

> 检查更新源改为 `https://agent.haohuoban.com/updates/`；Mac 继续 ad-hoc 临时签名。

### 修复

- 本地打包不再把 `your-cdn-domain.example.com` 写入 `app-update.yml`；运行时用 `config.json` 的 `updateUrl` 作为更新源。

---

## [1.1.2] - 2026-08-17

> **浅色工作台 + 本地文件夹工作区 + 新对话空态**。图标为好伙伴墨绿底白 H。本机打包使用 macOS ad-hoc 临时签名（无 Apple 开发者证书）。

### 新增

- 工作区改为本地文件夹（D-21）：顶栏切换 / 打开已有文件夹；侧栏列出本机工作区，可移除（不删磁盘；默认工作区不可删）。
- 对话旁「文件」分栏：浏览当前工作区目录、系统打开、访达定位。
- 空态问候 + 大输入：新建对话不立刻写库，发出第一条消息时再创建会话。

### 修复

- 空态发送时切到新会话会用空草稿覆盖输入框，导致要再输入一次。

---

## [1.1.1] - 2026-08-12

> **智能体列表页改版并设为启动首页 + 页面背景图云端下发 + ClawBot 绑定下拉修复**。云控端配套：背景图配置随云控端 1.6.32 下发（未部署的老云控端不下发该字段，桌面端保持默认纯色，向后兼容）。

### 新增

- **智能体列表页改版（`views/bots/BotListView.vue`）**：
  - 顶部 Hero 区（slogan「让 AI 成为你的创意搭档」+ 副标题 + 新建智能体按钮；品牌主色淡染底、文案不含品牌名，OEM 中性，遵守「禁止 AI 花哨风」设计规则）。
  - 页首工具行统一搜索框：「我的智能体」本地即时过滤（名称/描述），「智能体市场」回车/点图标走云端检索（原市场搜索行并入，不再重复）。
  - 卡片海报化：形象列 128→140px、卡片最小高 200px、「开始对话」按钮加高；网格上限 max-w-6xl→max-w-7xl 整体居中；新增「搜索无结果」空态。
  - 页签由弱灰底文字改为分段控件（灰轨道 + 白色滑块 + 轻阴影），选中态明确。
- **启动首页改为智能体列表（`utils/home-path.ts` 新增；`router/index.ts` / `main.ts` / `LoginView.vue` / `MainLayout.vue`）**：`/` 重定向、路由兜底、登录成功跳转、guest 守卫、ewei 无授权回退共 5 处统一走 `getHomePath()`；侧栏菜单顺序同步调整为「智能体」在前、「对话」在后（`allNavItems`）；云控端菜单配置隐藏「智能体」菜单时自动回退 `/chat`——菜单配置由 MainLayout 拉取成功后写 localStorage 缓存（`desktop_menu_overrides_cache`），重定向发生在布局挂载前、读上次缓存判定（首次启动无缓存默认 /bots；菜单配置为站点级不随用户变）。
- **智能体列表页背景图（`stores/site-config.ts` + `BotListView.vue`）**：解析 `/public/site-config` 新增的 `bot_list_background.url` 并写 localStorage 缓存（`site_config_bot_list_background`；老后端不带该字段时保持当前值，与 login_background 同容错模式）；页面滚动容器应用 cover/center 整页背景，未配置回退默认纯色，首屏读缓存不闪。
- **对话附件新增 PPT 支持（`services/document-parser.ts` + `jszip` 提为直接依赖）**：.pptx 按页抽取 `<a:t>` 文本（`<a:p>` 分段换行、XML 实体解码、数字序排页 slide10 不插队）、同号 notesSlide 尽力配对抽演讲者备注；`<a:fld>` 域元素（页码/日期占位）先剔除防页码误当正文；整 deck 无文字时走 NO_EXTRACTABLE_TEXT（纯图片型 PPT 给明确提示），含图 deck 附「图片不进上下文」warning；旧版 .ppt（OLE 二进制）无成熟 pure-JS 提取器，明确报错「请另存为 .pptx」。四处清单同步：ChatView 选择器 filters + DOC_EXTENSIONS + 拖入 BINARY 分流、clawbot-inbound 白名单（微信收 .pptx 直接进对话，.ppt 得精准转格式提示）、画布 Copilot 附件 filters。知识库 `knowledge.ts` 支持面更窄（无 xls），本次未动。

### 修复

- **微信 ClawBot 绑定智能体下拉（`views/clawbot/ClawbotView.vue`）**：原生 `<select>` 弹层在 Windows 上无可视滚动条、一屏仅约 20 行（占位项 + 19 个智能体顶满），智能体更多时后面的无法选到——改为自绘下拉（`max-h-60` 滚动条 + 超 8 个时显示搜索框自动聚焦 + 点外部 / Esc 关闭 + 选中项高亮），交互与对话页智能体选择器一致；`canUse=false` 时禁用行为不变。
- **微信 ClawBot 首轮真机联调发送可靠性大修（`services/clawbot/ilink-api.ts` / `clawbot-outbound.ts` / `clawbot-bridge.ts` / `ilink-types.ts`）**：用户实测暴露「回复大面积 ret=-2 prepare failed / 空响应误报失败 / 图片发不出」三问题，逐项修复——
  - **sendmessage 响应判据对齐官方**：官方 2.4.6 代码及其测试套件实证**空 body / `{}` 即为成功**（成功 mock 就是 `"{}"`），仅 ret/errcode 为非零数字才抛 `ILinkSendError`；此前白名单严格判据把成功误判失败 → 假失败日志刷屏 + 每条 2s 后重发，发送量翻倍喂饱限流器（且服务端 client_id 去重失效时会重复投递）。真值表 9 例自测通过。
  - **ret=-2 熔断器**（社区实证两种形态：errmsg=rate limited 限流 / prepare failed 上下文失效）：-2 触发熔断 60s×连续次数（封顶 5 分钟），熔断期发送快速失败——不打服务端、不记日志、不烧图片重试预算；不再 2s 原地重试（重试风暴只会加重限流，社区同款翻车有网关 OOM 案例）；发送间隔 1s→2s；`getuploadurl` 同样判业务 ret + 过发送门 + 纳入熔断（限流时它也回 -2，此前误报「缺少上传参数」）。
  - **flush 放大收敛**：事件驱动补发 1.5s 防抖合并（此前一轮多条 append 各自触发 flush，故障期同一卡死消息被反复重试——11:34 一口气 14 条失败日志即此形态）；单条消息累计失败 5 次 poison 跳过防堵死队列；长回复分段断点续发（重试不重发已送达段，不依赖服务端 client_id 去重）；每轮 flush 重读 peer 最新 context_token（不再用轮次开始时的快照，prepare failed 主因之一就是旧 token）。
  - **工具前言不再发微信**：带 tool_calls 的中间态 assistant 消息被过滤，只发最终回复（发送面大减 = 防限流 + 不刷屏；长任务反馈由 typing + 45s 进度文本承担；生图落库消息不带 tool_calls，图片回传不受影响）。
  - **微信会话默认模型与工作台同源**：主进程新增 `/public/site-config` 免登录拉取并缓存 `chat_default_model`（settings `site_config_chat_default_model`，桥启动时刷新）；`resolveDefaultChatModel` 镜像 `ChatView.resolveDefaultModel`（云控默认主选 → 已授权校验 → 第一个 chat 兜底）；`createConversationForPeer` 不再读 bot.model_*（v0.6.5 起智能体不绑模型，此前这正是微信会话与工作台默认不一致的根源）。存量微信会话模型不变，「清空上下文」后生效。
  - 协议版本对齐官方包 2.4.6（`channel_version` / `iLink-App-ClientVersion` 132102）；sendmessage 记录原始响应 debug 日志（联调取证）。
- **预览「启动未进智能体页 / 智能体页背景图不生效」根因修复（`tsconfig.node.json` / `tsconfig.web.json` + 全量清理）**：CDP 取证确认路由重定向（`getHomePath`）与 site-config 解析源码均正确，实际运行的却是 **tsc 误发射的陈旧 `.js` 孪生文件**（共 229 对，untracked）——此前不带 `--noEmit` 的 `tsc -p` 类型检查把 `.js`+`.d.ts` 发射到源码旁，而 Vite 解析扩展名 `.js` 优先于 `.ts`，无扩展名导入被陈旧产物遮蔽（`router/index.js` 旧 `redirect: '/chat'` 顶掉 `index.ts` 的 `getHomePath()`；`site-config.js` 旧 fetch 缺 `bot_list_background` 解析；主进程 `clawbot/*.js` 同为旧码，导致本轮 ClawBot 修复在预览中实际未生效）。处理：全量删除孪生残留（保留无孪生的 `postcss.config.js` / `env.d.ts` 等）；两个 tsconfig 增加 `"noEmit": true`（`composite` 保留，`tsc -p` / `tsc -b` 均验证零发射零报错）——此后类型检查不再污染源码树。**影响面说明**：残留文件从未入库，云打包（干净 clone 构建）不受影响；仅本地 dev / 本地打包曾被遮蔽。

---

## [1.1.0] - 2026-08-12

> **对话产出文件一键直达文件目录**（本条目为 1.1.0 增量记录之一；1.1.0 尚在研发中，对话主链路可靠性大修、画布助手流式化、智能体市场分页筛选、ClawBot 补发与幂等等其余增量仅维护了面向用户的 `shared/changelog.ts`，发版时归并整理）。

### 新增

- **对话产出文件一键直达目录（`utils/markdown.ts` + `views/chat/ChatView.vue`）**：assistant 消息渲染管线重写目标识别——
  - **识别四类目标**：Windows 盘符路径（反斜杠 `C:\foo` / 正斜杠 `F:/foo`，core-tools 给 LLM 的 displayUrl 即正斜杠形态）、Unix 绝对路径（限定 Users/home/root/var/tmp/opt/data/Applications 根前缀）、`local-file://` 应用内协议文本、http(s) URL；命中后追加「打开所在目录 / 浏览器打开」小按钮，走既有 `shell:showItemInFolder` IPC（目标丢失自动 fallback 开父目录）。
  - **local-file 图片 hover 角标**：生图产出消息（`![](local-file://img?p=...)`）包装 `span.img-file-wrap` + 角标按钮，悬停浮现、直达目录；角标透明时 `pointer-events: none` 不拦截图片点击预览。
  - **ImageLightbox 接 `onLocate`**（此前抠图/图库等 8+ 视图已接，唯独 chat 裸用）：预览本地图时工具栏出现「打开所在文件夹」；`resolveLocalFileTarget` 解析 `?p=`（绝对路径直接用）/ `?rel=`（相对路径透传主进程拼数据目录，与协议解析基准一致）。
  - **画布助手面板补齐消息点击委托**（`CanvasCopilotPanel.vue`，与 ChatView 同款）：此前该面板渲染出的跳转按钮点了无反应、链接点了白屏（无边框窗口无返回键），一并修复。
  - **系统提示交付约定**（`chat-engine.ts` 工作区说明）：引导 LLM 交付文件时用反引号包裹完整绝对路径——inline code 整体匹配无字符集限制，是含空格（mac 数据目录 `Application Support`）/含中文路径的精确识别通道；裸文本识别为尽力降级通道。

### 修复

- **渲染管线（`utils/markdown.ts`）**：
  - `insertLinkButtons` 改文本节点级替换（按标签切分、`<a>` 内跳过）：修复旧版往 `<a href="...">` 属性里插按钮撑破标签的既有 bug（裸 URL 链接的 href 曾被注入按钮 HTML 而损坏）。
  - 占位 token 全面改纯字母数字形态（`XINLCODE/XCODEBLK/JBTNMARK`）+ `appendBtn` 守卫（match 吃进占位 token 即放弃加按钮）：根治 docker 卷映射（`…:/var/…` 粘连）场景的 token 字面量泄漏进可见文本、以及路径紧贴反引号 code 时 `data-link` 被 token 污染必定位失败。
  - `WIN_PATH_RE` 加左边界负断言（`(?<![A-Za-z0-9])`）：排除 `PATH=/usr/bin:/usr/local/bin`、`user@host:/tmp/x` 等被截出 `n:/`、`t:/` 伪盘符按钮；`UNIX_PATH_RE` 加 `(?<![\w.:])` 排除 `./tmp`、`../data`、`host:/path` 误判。
  - 裸文本字符集排除 CJK / 全角 / 弯引号 / `&`（实体起始符）：修复路径吃进紧随的中文正文与 `&quot;` 实体（如「已保存（F:\a\b.png）请查收」「"C:\a\b"」）；`trimTrailingPunct` 改配对感知，保留 `D:\backup(1)` 的合法闭括号。
  - 修复 marked 18 对反斜杠 img src 的 URL 编码（`C:\a\b.png` → `C:%5Ca%5Cb.png`）导致 `convertLocalImages` 永不命中的既有断裂：先 `decodeURIComponent` 再判断，并补 Unix 绝对路径图片分支。
  - 删除 DOMPurify `ADD_URI_SAFE_ATTR: ['src']`（既有安全配置失效）：该配置豁免了 src 的 URI 校验使 `ALLOWED_URI_REGEXP` 对 img 落空（`javascript:`/`file:` src 原样通过）；删除后白名单恢复对 src 生效。
  - `resolveLocalFileTarget` 改手工切分 query（`URLSearchParams.get` 会把未编码字面 `+` 解码成空格而路径含 `+` 合法），且 `rel` 优先于 `p` 与主进程 local-file 协议 handler 对齐（防「预览 rel 图、定位 p 文件」两端分叉）。
- **点击委托（`ChatView.vue`）**：`.link-jump-btn` 分支前移至 anchor 分支之前——linked image（`[![图](local-file...)](https://...)`）形态下角标按钮在 `<a>` 内，原顺序会被 anchor 分支劫持成打开外部链接；anchor 分支补 `local-file:` 拦截（原会让渲染窗口原地导航加载文件、替换整个 SPA）。

### 复查与验证

- 经两轮独立对抗审查（字符串处理 / 渲染层集成）+ 实机渲染复验：29/29 断言通过（esbuild+node 实跑 `renderMarkdownLive`），`vue-tsc`（web）/ `tsc`（node）零错，`electron-vite build` 通过。
- 已知限制（记录不修）：marked GFM autolink 会把裸 URL 后的中文句号编进 href（`https://a.com/x。` → 404），修复需改 autolink 层，超出本功能范围；raw HTML 标签属性含 `>` 时标签切分可能错乱（根治需 DOMParser 重写）；存量对话消息无需迁移，重渲染即自动获得按钮。

### 新增（增量 2：画布批量删除）

- **画布编辑器：Delete/Backspace 批量删除选中节点**（`CanvasEditorView.vue` `onKeyDown`）：多选（Shift+点击 / Shift+拖动框选，Vue Flow 默认交互）后按 Delete/Backspace 循环 `canvasStore.removeNode`（级联删关联连线、主进程清磁盘产物）；节点与连线同时选中时一起删（级联过的连线对 `removeEdges` 幂等）。守卫与删边一致：整图工作流运行中禁用、输入框聚焦跳过。直接删、无确认，与节点删除按钮 / 删边的既有手动交互对齐（不接 `canvas-undo`——该撤销栈归属画布助手「撤销上次 AI 变更」入口，登记手动操作会造成语义混乱）。此前 `onNodesChange` 只处理 `position` 变更、`remove` 被忽略，且 `onKeyDown` 只取 `getSelectedEdges`，故节点键盘删除不存在。
- **画布列表页：批量删除选中**（`CanvasListView.vue`）：多选模式头部新增「删除选中」（红色样式对齐「清空画布」按钮），两步确认（确认按钮显示「确认删除 N 个画布」）；执行循环 `deleteProject`，正在运行（整图工作流或任一节点在跑，经 `useWorkflowEngine.isProjectAnyRunning` 判定）的画布跳过并 alert 告知数量——批量入口一次影响多个项目，较单删入口（暂无运行守卫）收紧。

### 新增（增量 3：云控端自定义菜单）

- **侧边栏自定义菜单合并渲染（`MainLayout.vue`）**：`GET /client/desktop-menu` 响应新增 `custom_items`（随云控端 1.6.31 下发；老云控端无此字段自动为空数组，向后兼容），按 `group_key` 挂到现有菜单组末尾或顶级末尾（组被 overrides 隐藏时其下自定义项随之不显示）；`internal` 复用 `router-link`（active 态自然生效），`external` 按 `open_mode` 走 `shell.openExternal`（系统浏览器，默认）或新 IPC `shell:openExternalWindow`（应用内窗口）。图标为 4 枚预置 key 映射内置 SVG（`IconCustom{Link,Page,App,Star}.vue`，与云控端枚举对齐，禁止外链图标）。
- **应用内窗口（`main/ipc/index.ts` `shell:openExternalWindow` + preload + `env.d.ts`）**：独立 `BrowserWindow` 加载外部页面。安全基线：无 preload（页面拿不到任何特权 API）、`nodeIntegration` 关、`contextIsolation` + `sandbox` 开、session 独立持久分区 `persist:external-menu-pages`（与主窗口 cookie/缓存隔离，也因此不受主窗口 `onHeadersReceived` 注入的 SPA CSP 影响，外部页面按自身响应头正常加载）；原生标题栏 + `page-title-updated` 拦截固定为管理端配置标题。导航守卫：同 host（含其子域）窗内放行，跨域导航与 `window.open` 一律交系统浏览器；`will-navigate` 与 `will-redirect` 双挂（后者防「目标页 302 到外域」绕过）；https 开窗前经 Node tls 做证书预检（进程级 `ignore-certificate-errors` 不影响 Node 网络栈，证书无效则拒开并提示——该全局开关的存在原因未考据清楚，不敢动，故用预检兜住本功能增量）；同 URL 窗口单例聚焦（防连点开 N 个）；`loadURL` 失败关窗 + `dialog.showErrorBox` 反馈（防白屏窗口 + unhandled rejection 威胁主进程）。不选 iframe（生产 CSP 无 frame-src 会拦死 + 目标站 X-Frame-Options 双重限制）与 `<webview>`（需开 webviewTag、Electron 官方不推荐）。
- **主窗口定位改模块级引用（`main/index.ts`）**：`showOrCreateMainWindow` 与 autoUpdater `sendToRenderer` 原用 `BrowserWindow.getAllWindows()` 泛找——外部页面窗口（或 ewei 改图隐藏窗口）存活时，主窗口关闭后点托盘/图标会把这些窗口误当主窗口 restore/focus，主窗口永无法重建（泛找 ewei 隐藏窗口属既有问题，一并修）。现 `createWindow` 时持有 `mainWindowRef`、`closed` 置空，两处统一只认该引用。
- **路由兜底（`router/index.ts`）**：新增 `:pathMatch(.*)*` catch-all 重定向 `/chat`——自定义菜单 internal 目标配错（拼写错误/指向下线路由）时回退对话页，不再白屏死胡同。
- **配套云控端改动（agent-admin 1.6.31 增量 2）**：「菜单配置」页新增「自定义菜单」管理区块，存储 `system_settings.desktop_menu_custom_items`（JSON，无 migration），详见 agent-admin CHANGELOG。
- **复查修复（两轮独立对抗审查确认）**：合并前过滤脏数据（target_type 非法/目标为空直接丢弃，防死菜单）；自定义 internal 项 active 手动判定（`isCustomInternalActive`：带 query 目标按 fullPath 精确匹配，防与内置同 path 菜单双高亮）；`pathMatches` 剥 query/锚点（否则带 query 目标永不命中组高亮与自动展开）；菜单 key 加 `custom:` 前缀（防与内置 path 撞 `:key`）；打开失败经 `nativeDialog.alert` 可见反馈。
- **公告弹窗支持图片（`AnnouncementBar.vue`，增量 4）**：公告富文本内的 `<img>` 按容器等比缩放居中渲染（此前无 img 样式会溢出弹窗），点击图片打开 Lightbox 大图预览（缩放/拖动）。公告插图由云控端富文本编辑器上传维护、随 content 下发（agent-admin 1.6.31 增量 3），接口契约不变、老云控端公告无图时展示不受影响。配套：`ImageLightbox` 层级从 `z-[100]` 提至 `z-[9600]`——公告弹窗为 `z-[9500]`，原层级下大图预览会被公告弹窗盖住（画布右键菜单 `z-[9998]` 与 Lightbox 不会同时打开，无冲突）。二轮复查修复：Lightbox 打开时 Esc 只关大图不关公告弹窗（`previewImage` 门控）；带链接图片（`<a><img>`）点击只开预览不再同时跳浏览器（preventDefault）。
- **账单明细识别套餐余量调整（`BalanceLogsDialog.vue`）**：`plan_adjust` 变动类型补中文文案「套餐余量调整」与筛选项（管理员在云控端把充值计入套餐余量后，用户账单可见）。

---

## [1.0.0] - 2026-07-20

> **新增「微信 ClawBot」**（微信扫码绑定，联系人消息桥接进本地智能体对话并回发）**+ 拼图拼接「长图竖拼 / 长图横拼」**（首尾相连模板）。面向用户记录见 `shared/changelog.ts`。
>
> 注：本版合并了开发过程中未发布的 0.10.0（微信 ClawBot）与 0.10.1（长图拼接）两个内部版本，为 0.9.9 之后的首个发布版本。本版含配套云端改动（agent-admin 1.6.30：`allow_clawbot` 权限键 + 菜单配置新增 `/clawbot` 项），两端独立部署、向后兼容——老云控端不下发该权限键时，桌面端按默认拒绝处理（菜单可见、功能锁定）。

### 微信 ClawBot

- **iLink 协议层（`main/services/clawbot/ilink-{api,cdn,types}.ts`）**：微信官方 ClawBot（iLink）协议自研实现——扫码登录状态机（二维码刷新 / 数字配对码 / IDC 重定向 / confirmed 凭据落库）、`getupdates` 35s 长轮询（游标持久化续传、失败 2s/30s 退避）、`sendmessage` / `getuploadurl` / `getconfig` / `sendtyping` 七端点；媒体 AES-128-ECB 加解密（两编码兼容）与 CDN 加密上传（`x-encrypted-param` 响应头取参、4xx 停 5xx 重试）。
- **对话桥（`main/services/clawbot/clawbot-bridge.ts`）**：主进程常驻服务。微信消息按联系人 FIFO 串行注入 `chat-engine.sendMessage`（window=null 纯后台跑、回复落本地库），完成后按「水位线」把本轮全部新 assistant 消息逐条回发微信（一轮多条回复不丢；含生图等 fire-and-forget 异步追加消息的 180s 补发窗口，生图结果也会以图片消息发到微信）；微信会话与桌面端新建会话行为一致，预填默认对话模型与生图模型（老会话回填），生图不再由 LLM 自由选服务商；按联系人映射本地会话（上下文连续，「清空上下文」可重置）；`[Error]`/中断标记转译为中文提示；日发送限额（默认 450 条）+ 发送间隔 ≥1s 风控；errcode=-14 登录态失效先暂停 60 分钟自动重试、再失效则系统通知重扫；启动 / 账号热切换 / 退出 / 登出全生命周期挂接。
- **桥内工具自动审批白名单**：`chat-engine.SendMessageOptions` 新增 `approvalDecider`（仅 window=null 时生效，不传则保持 fail-closed，渲染层零影响）。默认自动批准：工作区内文件读写、内置小工具；默认拒绝：命令执行、非只读 MCP、deck_* 等一切未点名工具；白名单可在页面调整（`settings.clawbot_approval_whitelist`）。
- **多媒体双向（`main/services/clawbot/clawbot-{inbound,outbound}.ts`）**：入站——微信图片下载解密 + 压缩（≤1024px jpeg 0.8）转 image 附件走现有多模态链路；文档（pdf/docx/xlsx/txt/md 等）解密后经 `parseDocumentFromBuffer` 转文本注入（>8000 字符自动 RAG）；语音用微信侧 ASR 文本降级、视频降级提示；引用消息文本拼入上下文。出站——markdown 降级清洗（剥标题/斜体标记、图片语法抽出单独发图、链接转纯文本）、长文按 1800 字分段、回复中的生图产物（`local-file://`）还原读盘经微信 CDN 加密上传后以图片消息回传。
- **管理界面（`views/clawbot/ClawbotView.vue` + `stores/clawbot.ts` + 侧栏入口）**：连接状态灯、扫码登录卡（qrcode 渲染 + 配对码输入）、智能体绑定（任选现有智能体或一键新建默认「微信助手」；**单绑定**——已绑定后不显示新建按钮，换绑用下拉）、审批白名单开关、联系人会话映射列表、消息流水日志（保留 7 天）。微信轮次完成时对话页实时联动刷新。
- **使用权限门控（显示 / 使用分离）**：菜单默认显示，显隐/改名由云控端「桌面端设置 → 菜单配置」管理；能否使用由权限 `allow_clawbot` 控制（默认拒绝，云控端「用户中心 → 权限管理」按用户/分组/套餐开通）。无权限时桌面端页面可浏览但全部变更操作禁用；主进程对变更类 IPC 强制拦截（`clawbot-ipc.ts`），无权限时桥不启动（`clawbot-bridge.ts` 守卫 + `cloud:setPermissions` 联动启停）。
- **数据（账号库新增 `clawbot_connections` / `clawbot_peers` / `clawbot_logs` 三表，`schema.sql` + `runMigrations` 双写）**：`bot_token` AES-256-GCM 加密存（device-id 派生 key，换机需重扫）；三表不注册云同步。

### 图像处理·长图拼接

- **长图竖拼 / 长图横拼模板（`views/image-toolkit/CollageView.vue`）**：与既有「统一槽位 + cover 裁剪」宫格类模板不同，长图模板让每张图保持原始宽高比——竖拼按统一宽度等比缩放、高度自然累加；横拼按统一高度等比缩放、宽度自然累加（默认使总宽 ≈ 输出宽度）。不裁剪、不变形、无白边；图片数量不限；间距 / 外边距 / 圆角调 0 即无缝首尾相连。
- **「只缩不放大」开关**：长图模式下勾选后以最窄（竖拼）/ 最矮（横拼）那张为基准，只缩不放、保清晰度；不勾选则窄图放大到统一基准、边缘对齐。该开关与「填满裁剪（cover）」按模板类型互斥显示（长图槽位宽高比=图片宽高比，cover/contain 退化相同结果）。
- **超大画布防爆保护**：长图累加尺寸超过 16000px 时按比例自动收窄基准，避免浏览器 canvas 单维度上限导致导出失败。

## [0.9.9] - 2026-07-18

> **新增「去AI标记」本地图像功能 + 接入「虎皮椒」扫码支付渠道；去AI标记门控改为「显示 / 使用」分离**。面向用户记录见 `shared/changelog.ts`。本版含配套云端改动（agent-admin 1.6.28：去AI标记计费端点 + 虎皮椒支付后端；1.6.29：去AI标记显示 / 使用门控分离 + 「全局可用」开关），两端独立部署、向后兼容。
>
> 注：`0.9.6` / `0.9.7` 仅维护了面向用户的 `shared/changelog.ts`；`0.9.8` 仅推 build 未发布，其内容并入本版。本研发档案未逐版回填历史缺口。

### 新增

- **「去AI标记」功能（`views/image-toolkit/RemoveAiMarkView.vue` + `main/services/ai-mark-removal.ts` + `shared/strip-image-metadata.ts`）**：本地无损剥离图片的元数据 / 溯源标识（EXIF / XMP / ICC / PNG 文本 / C2PA `caBX` / 中国 AIGC 标签）。`strip-image-metadata.ts` 新增 `scanAiMarks`（识别命中标记类别 + 尽力识别来源厂商）与 `stripAiMarksBytes`（原地剥字节），PNG DROP 集补 `caBX` 实现「全量」。页面按三档（可靠清除 / 尽力削弱 / 无法去除）诚实展示可清除的 AI 模型标记，含常驻风险提示行 + 首次使用须知弹窗（只阴影不遮罩）。
- **按次计费 + 显示 / 使用分离门控**：主进程 `cloud-ai-mark.ts` 处理成功后回调云端 `gateway/watermark-removal/charge` 扣费（`request_id` 幂等）；菜单**显示**由系统设置全局开关控制（`stores/site-config.ts` 的 `features.aiMarkRemoval`，`layouts/MainLayout.vue` 新增 `requireSiteFeature` 门控机制），**能否使用**由「全局可用」开关（`features.aiMarkRemovalUseAll`）或个人授权 `allow_ai_mark_removal` 判定（页面 `canUse`），无使用权限则页面可浏览但禁用「去除」按钮并提示开通。
- **「已处理」角标（`components/ProcessedBadge.vue`）**：`image_generations` / `gallery_items` 加 `ai_mark_removed` 列（`main/database` 幂等迁移 + `resources/schema.sql`），处理后原地写回并置位；接入 AI 生图页、图库、创作详情三处缩略图。
- **「虎皮椒」扫码支付渠道（`components/{PaymentDialog,RechargeDialog}.vue` + `stores/site-config.ts` + `utils/cloud-api.ts`）**：`PaymentAvailability` 加 `xunhupay`，新增 `createXunhupayOrder` / `upgradePlanXunhupay` / `createRechargeOrderXunhupay` / `syncXunhupayOrder`；两个支付弹窗加第三渠道「扫码支付」按钮（切换器支持 ≥2 渠道三列），下单 / 轮询 / 兜底同步三路分派，套餐购买 / 升级 / 充值三条链路可用。

### 修复

- **去AI标记角标路径不匹配（`main/services/ai-mark-removal.ts`）**：`image_generations.result_path` 存的是相对 dataDir 的正斜杠路径，原用绝对路径匹配导致创作页角标永不点亮；改为「绝对 / 绝对正斜杠 / 相对」三变体匹配。
- **去AI标记原地覆盖非原子**：改临时文件 + `rename` 原子替换，避免写入中途崩溃截断原图。
- **扫码支付文案夸大（`{PaymentDialog,RechargeDialog}.vue`）**：虎皮椒渠道的扫码提示原沿用天阙文案「微信 / 支付宝 / 云闪付 / 数字人民币」，改为如实的「微信 / 支付宝」。

## [0.9.5] - 2026-06-26

> **店铺商品图：三商城改图数据安全加固 + qdyun 保存可靠性/可观测性 + 多商城健壮性与门控收口；并修复对话默认模型解析（精确到服务商 + 无权限回退）**。统一新增「改图前后 SKU 集合一致」断言、修正 qdyun 保存超时预算算反、把会话清理与平台分发收口、把 mall_key 收敛为三端单一来源、统一店铺商品图授权门控并补路由级守卫。**本版含配套云端改动（agent-build 授权双写收口、agent-admin mall_key 常量收敛），均向后兼容、独立部署。面向用户记录（`shared/changelog.ts`）按要求不出现底层平台品牌名。**

### 修复

- **三商城改图防误删 SKU（数据安全）**：新增 `services/mall/guards.ts`——`assertSkuSetConsistent`（after ⊇ before，只防删除不约束新增）+ `nonEmptySkuGuard`。各家原守卫只挡「完全读不到 SKU」，挡不住「读到但截断/重建漏项」，缺失的真实 SKU 会被服务端全量替换物理删除。现统一为前后置集合断言：
  - `ewei-client.ts`：多规格保存后重拉 `getGoodsDetail`，断言 SKU id 集合未被删除（前置「每 option 必有 id」守卫之外补后置检测；检测非回滚）。
  - `dianda-adapter.ts`：以 `fetchGuige` 的 `gglist` 键集为真实全集，断言重建写入的 `option[ks]` 覆盖全部 SKU；原 `skuCount===0` 改 `nonEmptySkuGuard`。
  - `qdyun-adapter.ts`：注入 JS 捕获 `skuBefore=allarrone.length`，`#biaogedata` 打包后断言数量不少于改图前（非空之外加超集计数），取不到稳定数则降级非空。
- **qdyun 保存超时预算算反**：保存隐藏窗口外层超时原 35s < 内层最坏（就绪 25s + SKU 载入 20s = 45s），会先 destroy 窗口、reject 泛化「页面操作超时」，掩盖内层 SKU 安全闸的精确中止文案。抽常量 `QD_SAVE_WINDOW_MS = QD_READY_MS(25s) + QD_SKU_MS(20s) + 8s = 53s`，内层 deadline 同源注入。
- **对话默认模型解析增加授权校验（`src/renderer/src/views/chat/ChatView.vue` `resolveDefaultModel`）**：云控端「对话页面默认模型」下拉原 value 为裸 `model_id`，同一 model_id 多服务商时会多高亮并丢失服务商维度——云控端已改下拉 value 为复合 key `model_id#@provider_name`（随 agent-admin 1.6.24 发布）。桌面端 `resolveDefaultModel` 配套增加授权校验：云控端下发的默认模型若不在当前账号已授权列表（`modelStore.providers` 由 `myModels` 构建），不采用、回退到账号第一个已授权 chat 模型，避免出现列表里没有、还发不出消息的「幽灵模型」。两端独立部署、互相兼容。

### 优化

- **qdyun 保存可观测性 / 失败分层 / 串扰**：注入 JS 每个失败返回带 `stage`/`diag`；`save.html` 非 `code:1` 按响应文本/msg 分 `session`/`data_incomplete`/`business`，`session` 自动清 `we7Bridged` 触发下次用 cache_key 重建 `$_SESSION`；进编辑器后回填真实 `goodsTitle`/改前主图到审计日志（`ewei-connectors.updateImageLog` 增 `goodsTitle`/`oldValue` 可选补丁）；同 connector 改图串行队列（`saveQueues`）防隐藏窗口共享分区串扰；`QDYUN_DEBUG_VISIBLE=1` 可见首跑调试开关（显示窗口 + DevTools + 放宽超时，便于真机首次验证）。
- **会话清理入适配器接口**：`MallAdapter` 增 `clearSession(connectorId)`，三适配器各实现复用模块级函数；`ipc deleteConnector` 改按连接器 platform 分发 `adapterForConnector(id).clearSession(id)`，删硬编码逐平台 import——新增商城实现 clearSession 即自动覆盖、不再易漏改。
- **适配器分发更严格**：`registry.getAdapter` 保留「空/undefined → ewei」历史兼容，但明确非空却不在枚举（platform 拼错/脏数据）时抛错，不再静默用 ewei 协议去打别家商城域名。

### 变更

- **mall_key 三端单一来源**：新增 `src/shared/mall-keys.ts`（`MALL_KEYS as const` + `MallKey` + `mallPolicyKey`/`mallNameKey`）；`registry` 的 adapters 改 `Record<MallKey, MallAdapter>`（漏注册即 TS 编译报错）；renderer 平台列表派生自 `MALL_KEYS`，删除 `EweiConnectorsView` 内硬编码 `ALL_PLATFORMS`。
- **店铺商品图授权门控收口**：`cloud-auth` 沉淀单一 `mallAllowed`/`anyMallAllowed`/`mallName` + `shops→平铺` 单向回填（云端只下发聚合时菜单/旧逻辑不再整片消失）；`/ewei` 四条路由加 `meta.requireAnyMall` + `main.ts` `beforeEach` 路由级守卫（补「菜单隐藏但 URL 直达」纵深）；`EweiConnectorsView` 改用 store 单一来源。
- **配套云端改动（独立部署、向后兼容）**：agent-build 授权双写收口（`BuildClientController` 委托 `MallAuthorizationService::setAuthorization`/`getAuthorizationsBatch`，删 4 处手写 ewei 旧列双写与本地 `MALL_KEYS`，加契约单测）；agent-admin `EweiShopAuthorization` 增 `policyKey`/`settingKey`/`assertContractIntegrity`，`QuotaService` 默认值按 `MALL_KEYS` foreach 生成，`AppServiceProvider` 仅 local/testing 启动断言契约一致。

## [0.9.3] - 2026-06-23

> **店铺商品图：多规格商品改图 + 详情图预览**。放开多规格(SKU)商品的主图/轮播/详情改图（基于服务端逐 SKU 重建，保存时完整保留规格/价格/库存），修复一处「全量保存可能误清 SKU」隐患与一处「详情图替换静默失败」；详情图位补齐逐图预览。本版**仅桌面端改动**（mall 适配器 + 改图视图），云控端/授权端无关联改动。**面向用户记录（`shared/changelog.ts`）按要求不出现底层平台品牌名。**

### 新增

- **dianda 多规格改图（含修复清 SKU 隐患）**：`replaceGoodsImage` 不再用静态编辑页的模板 `option[`（`name="option['+ks+'][..]"`）——这些是 JS 模板、误收会让服务端 `delete id NOT IN(newggids)` 清空真实 SKU。改为 `fetchGuige`（`ShopProduct/getproduct` POST proid → `{product,gglist(按ks键),guigedata,detail}`）+ `applyGuigeReconstruction` 逐 ks 重建 `option[ks][name/pic/market_price/cost_price/sell_price/weight/barcode/givescore/stock/limit_start]`(+lvprice 时 `sell_price_<lvid>`) + `specs`=原 guigedata；`extractFormEntries` 排除 `option[`/`specs`。原「多规格守卫 `hasRealOption(product.guigedata)`」因编辑页无 `guigedataList`、product.guigedata 恒 `[]` 实为失效（单/多规格改图均会清 SKU），现按 ks 逐条 update 保留 id。真机实测 dianda 单规格 8287 改主图/轮播/详情后 SKU(库存1010) 不变。
- **qdyun 多规格改图**：硬守卫改「双安全闸就绪门控」——前置主动 `changeType()` 触发 `getDuoTypeValues`、等 `allarrone` 就绪（`valarr0` 渲染），后置断言 `#biaogedata` 非空，任一不满足即中止、绝不发清空请求。SKU 由编辑器 `checkinfo()->ggzbc()` 打包进 `#biaogedata`。真机实测 80-SKU 商品 28605 改详情后 SKU 全保留（生产日志证保存模型为 `delete id NOT IN(biaogedata里id) + 重建`）。
- **列表多规格徽标**：`qdyun listGoods` 抓取 JS 读列表行 `data-type={use_more}`(原硬编码 `has_option:0`)，兜底 `.badge-info` "多"；dianda 列表 `SELECT *` 本就回 `guigedata`、`hasRealOption` 解析，列表卡片显示「多规格」徽标。
- **详情图逐图预览**：`EweiGoodsImageView` `currentImages` 对详情图位从 `goods.content` 抽 `<img src>` 渲染缩略图（改图后 `loadDetail` 刷新即更新）。

### 修复

- **dianda 详情图替换静默失败**：编辑页无 `info[detail]` 静态元素（DIY 设计器 JS 提交时 `field['info[detail]']=编辑器.getContent()` 生成），harvest 取不到→送 HTML `<p><img>` 被服务端 `geteditorcontent` 当非法块丢弃（"保存成功却没改"）。改以 getproduct 的 `product.detail`(块状 JSON 原文)为基底，`buildDetailContent` 走块分支追加 picture 块。
- **dianda `getGoodsDetail` 改用 getproduct**：原解析编辑页 `var guigedataList`（实际不存在）→ `has_option` 恒 0、`content` 恒空；改后 name/pic/pics/detail/guigedata 一次取齐，`diandaDetailToHtml` 把块状详情转 `<img>` 使详情计数/预览正确。移除孤儿函数 `fetchProduct`。
- **qdyun `getGoodsDetail` 补详情内容**：隐藏窗口 JS 增读 `window.ue.getContent()`（等 UEditor 就绪），`content` 带回详情 HTML，使详情计数/预览正确（原 `content:''`）。

## [0.9.2] - 2026-06-22

> **「店铺商品图」多商城泛化 + 三处缺陷修复**：把原本写死单一商城的「店铺商品图」泛化为可扩展多商城（连接器加 `platform` 维度 + `MallAdapter` 适配器抽象 + 按平台分发），并修复切换店铺串数据、本地图库缺分页、画布列表缺分页三处问题。**面向用户的更新记录（`shared/changelog.ts`）按要求只描述用户可感知的变化、不出现任何底层平台品牌名。**

### 新增

- **连接器多商城维度**：`ewei_connectors` 加 `platform`（默认回填旧平台）/`extra_json` 列（`database/index.ts` 幂等迁移 + `resources/schema.sql` 同步）；`ewei-connectors.ts` CRUD/`resolveCredentials` 带 platform + 新增 `getExtra`/`setExtra`。
- **适配器层** `services/mall/`：`MallAdapter` 接口 + `registry.getAdapter(platform)` 分发；原协议客户端零改动包成适配器；新增第二个平台适配器（cookie 会话 + 图形验证码两步登录 + 列品/详情/上传/全量回写）。
- **登录泛化**：两步登录 `beginLogin`/`submitLogin`（能力位 `capabilities.needsCaptcha/needsShopSwitch/detailFormat`），验证码弹窗（换一张 / 错误重输 / 会话持久化减少弹出）；主进程 IPC 按连接器 platform 分发（保留原信道 + 新增 submitLogin/refreshCaptcha/capabilities）。
- **权限消费按商城**：`cloud-auth` 增按商城聚合结构 `shops` + 平铺兼容字段；侧栏入口门控、页面门控、连接器平台选择均按「任一商城被授权」放行 / 按授权过滤。

### 修复

- 店铺商品图：切换门店后商品列表仍命中上一门店缓存（缓存只按连接器键、切店不失效）→ `switchShop` 清连接器缓存。
- 店铺商品图：本地图库选图面板只显示第一页、无翻页（数据层支持分页但 UI 未接）→ 补翻页。
- 画布：画布列表一次性渲染全部卡片 → 渲染层窗口化 + 触底加载更多。

### 变更

- 多代理复查后修复：页面门控与侧栏门控口径统一；harvest 全量回写支持同名多值字段、不丢数据；多规格商品图位整体守卫防误删；删客户端清理关联授权行；`upsertMallAuth` 不重置 `created_at` 等。

## [0.9.1] - 2026-06-21

> **MCP 体验大幅升级**：新增「MCP 市场」一键发现与安装常用 MCP 服务（接入 mcp-cn.com 精选与 mcpmarket.cn 全量两大大陆免 key 源）；新增「按需加载（元工具）」机制，根治大量 MCP 工具撑大 prompt 导致云端网关 524 超时；修复对话里 MCP 选择在重新生成/续写/编辑消息时丢失、禁用项被静默隐藏等多处可用性问题。

### 新增（MCP 市场）

- **MCP 市场 tab**：`views/mcps/McpView.vue` 仿 SkillsView 增加 installed / market 双 tab；接入两个大陆免 key 源——mcp-cn.com（精选 ~74 条，零包装）与 mcpmarket.cn（全量 ~69k 条，规模派）。
- **主进程市场服务** `services/mcp-market.ts`：listMarket / searchMarket / getMarketDetail / installFromMarket 四个 API；针对 mcp-cn 的 connections 字段（unquoted JSON5）自实现两阶段正则解析。
- **安装流程**：远程 MCP（streamable-http）暂拒装；stdio 走现有 `createMcpServer`，名称前缀 `[市场]`；含 `<your-xxx>` 等占位符时弹窗让用户填充后再装（弹窗仅阴影、无遮罩）。
- **链路**：新增 `mcpMarket.invoke` 通配 IPC 桥（preload + `env.d.ts`）+ pinia `stores/mcpMarket.ts`（fetchList / search / loadMore / fetchDetail / install）。

### 新增（MCP 元工具按需加载）

- **三元元工具**：`mcp_list_servers` / `mcp_describe_tools` / `mcp_call`——把未勾选「始终加载」的 MCP 服务从全量工具注入降级为「按需发现」，大幅压缩 prompt token，根治云端 Cloudflare 100s 切（HTTP 524）。
- **数据库新增 `always_load` 列**：`resources/schema.sql` + `database/index.ts` runMigrations 幂等 ALTER；`McpServer` interface / `parseMcpServer` / create / update 全链路打通；编辑表单新增「始终加载到对话工具列表（高频工具勾选）」checkbox。
- **混合注入策略**：`always_load=true` 的 server 仍按裸名直接注入；`always_load=false` 的 server 只通过元工具暴露；`capSummary` 分「直接可用 / 按需发现」两栏。
- **审批兼容**：`mcp_call` 的审批 `approvalToolName` / `approvalArgs` 重映射到目标 MCP 工具，`readOnlyHint` 判定与裸名注入路径一致。

### 修复

- **重新生成 / 续写 / 编辑消息丢失 MCP / KB / Skills / PromptSkills 选择**：`chat-engine.ts` 新增模块级 `lastTurnOverrides` Map（按 `conversation_id` 缓存最近一轮 override），三个回放入口注入；`stores/chat.ts` 四类 override 统一 `!== undefined` 判空，清空意图不再被静默回填 bot 默认。
- **弹层禁用 MCP 被隐藏**：对话内 MCP 选择改为「disabled 灰显不隐藏」+ 尾标「（未启用）」，避免 bot 绑了禁用 MCP 时用户无感知。
- **进入对话首次未按 bot.mcp_ids 预填**：新增 `enabledMcpServers` computed + `loadDraftFor` watchEffect 兜底（bots 异步未就绪时首次跳过预填，待 `currentBot.id` 就绪再补做）。
- **warmup 后偶发 tools 列表为空**：`warmupEnabledMcpServers` 在 `ensureClient` 后追加 `refreshMcpTools` 主动刷新；失败 500ms 后重试一次吸收握手刚就绪的瞬态失败；末尾广播 `toolsUpdated` 让渲染层即时刷新。
- **MCP 长任务被默认超时打断**：按 `tool.annotations.timeoutMs` / `longRunning` 解析（`resolveMcpToolTimeoutMs`），新增 `MCP_LONG_RUNNING_TIMEOUT_MS = 5 分钟` 兜底。

### 优化

- **账号热切换后自动 warmup**：`performAccountSwitchHotSwap` reload 后 1.5s 触发 `warmupEnabledMcpServers`，并同步清理 `lastTurnOverrides` 缓存避免内存累积（`deleteConversation` 同样清理）。
- **类型派生防漂移**：`LastTurnOverrides = Pick<SendMessageOptions, ...>`，override 字段重命名时编译期可捕获。

## [0.9.0] - 2026-06-20

> **全新「AI PPT」创作功能（app 原生受控模板引擎）**：输入一句话主题，经「LLM 出大纲选版式 → 按模板 schema 填槽 → 离屏 Chromium 渲染 → 确定性映射」生成专业、可编辑的演示文稿。**零外部 Python / Node 依赖**（presenton 的 Python 逻辑全部用 TS 重写）；声明式模板为数据非代码（规避 RCE），由固定渲染器产出 html2pptx 4 约束合规 HTML，故 PPTX 与 HTML/PDF 平级、真可编辑。

### 新增（AI PPT 创作）

- **受控模板引擎**：`deck/` 下 32 模块——两阶段生成（`deck-generator` 出大纲选版式 → 按 schema 填槽，字数上限截断防溢出 + 逐页口播解说稿）、`design-rules` 反 AI-slop 设计方法论注入提示词、`html-ir` 产唯一合规 HTML、`offscreen-renderer` 离屏 BrowserWindow 渲染/抽取/截图、`pptx-exporter` html2pptx TS 实现。
- **风格分组（14 套风格，界面称「风格」）+ 配色主题（8 套）**：`families.ts` 把模板按 presenton 组归入不同风格，选型只在所选风格内进行、每种风格绑定一套配色主题 → 避免一份 PPT 风格混搭并控制选型 prompt 体量；`template-provider` 进程级共享单例缓存云端 manifest。
- **全量移植 presenton 217 套版式**为声明式模板（13 组，`deck-templates-src/`）；按需云缓存（上游母 CDN → 云控端 → 桌面端三层分发 + SHA256 强校验）。结构校验 + 满字数真渲染 QA 双过（`scripts/verify-deck-templates.mjs`、`qa-render-templates.mjs`）。
- **自适应排版**：`declarative` 渲染器对卡片网格/列表按盒高自适应、长文本自动缩字、内部元素卡内钳制 → 内容填满 schema 上限也不溢出画布、不破版。
- **导出全家桶**：可编辑 PPTX（pptxgenjs）、PDF（pdf-lib）、GIF（gifenc）、MP4（ffmpeg 逐帧编码）、可点击 HTML 原型（`prototype-exporter`）；解说视频（`narrate-pipeline`：云端 TTS 配音 + 逐帧渲染 + 合流）。
- **信息图**（`infographic.ts`）：LLM 判断数据页 → 出 ChartSpec → 渲染柱/折线/饼/进度图，主题色驱动配色，自动填入空图槽。
- **语义图标检索**（`icon-search`/`minilm-embedder`/`icon-index-builder`）：MiniLM 本地嵌入（失败回退云端语义嵌入）+ sqlite-vec vec0 KNN（失败回退 JS cosine）+ @resvg 栅格化；空图片位自动配语义图标，并提供关键词检索面板。
- **设计评审**（`critique.ts`）：逐页截图 + 度量 → 多模态 LLM 5 维打分与改进建议。
- **ffmpeg 应用内一键下载安装**（`ffmpeg-manager`）：三层分发 + SHA256 强校验 + mac arm64 ad-hoc 自签；仅视频/解说导出门控，GIF/PPTX/PDF/预览不门控。
- **云控端资源管理**：`agent-admin` 新增 AI PPT 资源资产（ffmpeg/模板包，含从 manifest 批量导入 + 分批拉取固化）与解说 TTS 供应商管理（key 留服务端、按字符计费）。
- **5 段式接线**：`/deck` 路由 + 侧栏「AI PPT」入口 + `stores/deck` + `deck:*` IPC + `deck-service` 编排；`deck_projects/deck_slides/deck_assets/deck_icon_vectors` 数据表。

> **全新「店铺商品图」功能（ewei 商城集成）**：桌面端可绑定 ewei 商城业务端（填域名/账号/密码，密码 AES-256-GCM 本地加密、不上云、不参与同步），登录后选门店，用本地图库 / AI 生图 / 电商生图 替换商品主图·图集·详情图·SKU 图，并支持从零新增商品（含完整多规格 SKU）。所有接口契约经真实环境抓包/写验证。

### 新增

- **ewei 连接器与客户端**：`services/ewei-connectors.ts` 连接器 CRUD + 复用 matting 的 AES-256-GCM 加解密（device-id 派生 key、密文 `v1:iv:tag:ct`）；`services/ewei-client.ts` 无界面 HTTP 客户端——密码 AES-128-CBC/ZeroPadding 复刻、仅 `session-id` 头维持会话（单飞登录、`-10000` 节流重登并自动恢复门店）、列店/切店、商品列表/详情、`utility/attachment/upload` 上传（超大自动压缩）。
- **商品图替换工作台** `views/ewei/EweiGoodsImageView.vue`：6 个图位（主图 / 图集替换·追加 / 详情图追加·替换 / SKU 图），3 个来源（AI 生成复用电商 `EcomGeneratorPanel` 的 `pickable` 选图模式 / 本地图库 / 本地文件），批量上传 + 安全回写——多规格商品完整回填 `specs/options` 防 SKU 误删、实体商品规避运费模板坑、剔除 `diy_share`；审计表 `ewei_goods_image_logs`。
- **新增商品** `views/ewei/EweiGoodsCreateView.vue` + `ewei-client.addGoods`：走收银台 `goods/save`（无运费坑、最安全的 SKU 路径），多图集 / 单规格原价用 `goods/edit` 补；完整表单——基本信息（标题/类型实体·虚拟·称重/上下架/单位）+ 多图集 + 分类 + 单规格（价/库存/原价/编码/条码）或笛卡尔积 **SKU 编辑器**（规格组+规格值+每值图 → 每 SKU 价/库存/原价/编码/图/隐藏）。
- **可复用选图弹窗** `views/ewei/EweiImagePicker.vue`（AI 生成 / 图库 / 文件三来源）；**入口权限位** `allow_ewei_shop`（侧栏菜单 `requireAnyPermission` + 视图运行时门控）。
- **数据表** `ewei_connectors` + `ewei_goods_image_logs`：`resources/schema.sql` + `database/index.ts` runMigrations 双写幂等建表，明确排除出 `sync/registry.ts` 的 SYNC_ENTITIES（凭据本地加密、跨设备不可解密）。

### 优化

- 本地图库 / 选图网格改用 `local-file://...&thumb=1` 缩略图（主进程 360px JPEG 缓存 + `preloadThumbnails` 预热），一次加载大量商品原图不再卡顿；应用商品图时仍用原图路径。
- 电商「AI 生成主图 / 详情页」面板（`EcomGeneratorPanel` + `EcomResultGrid`）新增可选 `pickable` 选图模式（默认关闭，主图/详情页/批量 SKU 原功能零影响），供店铺商品图直接复用完整控制栏与两步法生成。
- 店铺商品各页状态持久化（商品列表筛选/结果、图片工作台图位+已选图、**新增商品表单草稿**，存入 `stores/ewei.ts`）+ ewei「分区记忆」路由守卫：从其它功能页返回「店铺商品图」时自动回到上次停留的深层页（`main.ts`）。

### 变更（入口两级授权门控）

- 「店铺商品图」入口改为**两级授权门控**：`cloud-auth.ts` 的 `allow_ewei_shop` 默认值由 `true` 改为 **`false`（默认拒绝）**，`EweiConnectorsView` 守卫改 `=== true`。仅当①授权管理端开放本云控端该功能、且②云控端对该用户授权时，云控端才下发 `allow_ewei_shop=true` → 入口显示。老/未授权云控端不下发 → 隐藏。**需配合云控端 1.6.8 + 授权管理端 0.14.0；务必后端先行，否则现网用户会暂时看不到该入口。**

## [0.8.5] - 2026-06-14

> **登录 / 注册 / 找回密码页面整体改版（建议配合云控端 1.6.5）**：品牌图标与名称居中、输入框配图标、登录按钮品牌色渐变；登录页支持云控端配置的自定义背景图与主题色。

### 变更

- 登录 / 注册 / 找回密码页面整体改版：品牌图标与名称居中展示、输入框配图标、登录按钮采用品牌色渐变。
- 登录页支持显示由云控端配置的自定义背景图，自动铺满并随窗口自适应（需云控端 1.6.5）。
- 支持由云控端统一配置应用主题色，按钮 / 链接 / 选中态等整体配色跟随云控端设置（需云控端 1.6.5）。
- 「记住账号 / 记住密码」一行新增「忘记密码」入口，登录页布局更清晰。

## [0.8.4] - 2026-06-13

> **对话/生图「模型无响应」误报与套餐到期状态修复（建议配合云控端 1.6.4）**：根治「有余额却报模型无响应（可能余额不足）」的误导文案——空流文案与余额解耦，并解析云控端注入的精确错误事件；非对话路径（识图/提示词优化等）余额不足统一中文；「我的套餐」徽标按到期时间实时派生，到期即显示「已过期」。

### 修复

- **「模型无响应（可能余额不足）」误报**：`llm.ts` 空流(silent-200)文案去掉「可能余额不足」改为「模型未返回任何内容（可能上游限流或服务波动）」；SSE 解析新增识别云控端注入的 `data:{"error":{...}}` 事件，按真实原因（限流 / 鉴权 / 上游不可用）提示，不再笼统归因余额。真实余额不足由云控端预检返回 402，与本误报无关。
- **余额不足报错非中文**：`llm.ts` 对 402 直接抛中文 `CloudBalanceError`，使识图、提示词优化、会话总结等非对话 `callLLM` 路径也中文友好（此前会透传后端英文 `Insufficient ... balance`）。
- **套餐到期状态显示**：`MyPlansBox.vue` 徽标改用按 `expires_at` 实时派生的有效状态，消除套餐到期后仍显示绿色「生效中」、与同卡片「已过期」自相矛盾的问题。

## [0.8.3] - 2026-06-12

> **灵感广场 / 云端模板瀑布流改版**：图片按原始比例错落展示，浏览更舒适。

### 变更

- 灵感广场改为瀑布流布局，图片按原始比例错落展示。
- 创意模板「云端模板」也改为瀑布流布局，「我的模板」保持原样。
- 灵感广场、云端模板每次进入或切换分类都会重新随机排序，常看常新。
- 灵感广场、云端模板取消翻页，改为下拉到底自动加载更多。

## [0.8.2] - 2026-06-11

> **云同步健壮性整修（建议配合云控端 1.6.2）**：针对深度检查发现的同步引擎缺陷做一轮集中修复——单条异常记录卡死整体同步（`NOT NULL constraint failed` 类）、未知实体无前向兼容、同步期间外键全局关闭、媒体悬空引用、「实时」模式未生效、本地媒体缓存无限增长、`updated_at` 伪冲突刷屏等。修复后旧数据/旧版本造成的异常记录会被容错跳过并记入冲突列表，同步不再永久中断。

> **MCP 服务整修（同版本一并交付）**：深度检查发现 MCP 功能管理壳完整但调用链路断裂——工具清单从未被拉取、协议无握手、Windows 下 `npx` 无法启动，绑定 MCP 的智能体在对话中实际拿不到任何工具。本版本按 MCP 标准协议重写 stdio 客户端，打通「配置 → 工具发现 → 对话注入 → 调用执行」全链路，详见下方「MCP 服务」区块。

### 修复

- **同步永久卡死（单条坏记录）**：pull 的整页事务内逐条 try/catch，单条 apply 失败（约束冲突 / 结构差异）登记 `(apply_error)` 冲突记录（按 entity/uid 去重）后继续，游标正常推进；此前一条坏记录会让同一页每次同步都失败。
- **`NOT NULL constraint failed`（如 `image_sessions.model_id`）**：`serializer.applyUpsert` 对 NOT NULL 列收到 null 时兜底——有列默认值则省略该列交给 DEFAULT，无默认值按类型回退 `''` / `0`；`merge.mergeEntity` 合并结果清除值为 undefined 的键（一方 payload 缺列时 LWW 可能选中 undefined，落库会变成显式 NULL）。
- **未知实体（前向兼容）**：pull 到本版本不认识的实体不再抛错（此前 `SELECT` 不存在的表导致同步永久中断），改为跳过并登记 `sync_meta.skipped_unknown_entities`；升级后发现已支持则自动重置拉取游标全量回补。
- **同步期间级联删除失效**：`foreign_keys=OFF` 由覆盖整个 runSync（含网络 await 间隙，业务删除会丢 `ON DELETE CASCADE` 产生无墓碑孤儿）收窄为仅包裹同步事务的同步执行块（`withForeignKeysOff`）。
- **媒体悬空引用**：`blob.uploadReferenced` 不再无条件标记已上传——本地缓存与云端均无的 blob 返回「不可得」集合，引用它的变更挂起不推送（oplog 保留待恢复重推）并记录 `(blob_missing)` 冲突；此前会推送悬空引用导致其它设备对缺失媒体永久 404 重试。
- **无扩展名文件 ext 解析错误**：`blob.ingestFile` 此前用 `split('.').pop()` 会把整个路径当扩展名，落缓存必然失败并连锁触发媒体静默丢失；改为只看文件名段、无扩展名回退 `bin`，与 serializer 的 `extname` 逻辑一致。
- **`updated_at` 伪冲突刷屏**：时间列（`created_at` / `updated_at`）不再参与合并冲突判定（按 LWW 直取），双端各改不同字段时不再每次合并都产生一条假冲突。

### 变更

- **「实时」同步真正生效**：原 `triggerDebounced`（30s 防抖）从未被业务写入路径调用，「实时」实际退化为 120s 兜底轮询；改为调度器每 30s 轮询 `sync_oplog` 水位（`MAX(seq)` 单调不复用），检测到新本地变更即触发同步，永久挂起的待推项不会造成无限循环。
- **本地媒体缓存 GC 接线**：成功同步后每 24h 执行一次 `gcLocalBlobs`，引用集合 = 业务表媒体列 + `sync_shadow` 基线 + 待下载表 + 未上传 blob 的并集（保守不误删）；此前 GC 函数存在但从未被调用，`sync-media` 只增不减。
- 冲突记录对 `secretFields`（如 `model_providers.api_key`）脱敏为 `«secret»`，不再明文落 `sync_conflicts`。
- `PushResult.status` 新增 `rejected`（云控端 1.6.2 服务端校验拒绝单条变更时返回；客户端 oplog 自动保留待重推）。

### 对话体验与小工具

#### 新增

- **「继续生成」从中断处续写**：对话被中断 / 报错（`[已中断]` / `[Error]`）后，末条回复下方出现「继续生成」按钮 → IPC `chat:continue` → `chat-engine.continueLastResponse`，剥掉中断标记保留半截正文，以一条「继续」消息驱动模型续写，避免「重新生成」整条重发并丢弃已产出内容（省 completion token）。新增 `isContinuableContent`、`conversation.updateMessageContent`、store `continueGenerate` / `isContinuable`、`ChatView` 按钮。
- **「小工具」脱离沙箱白名单（per-skill）**：`skills` 表新增 `unsandboxed` 列（幂等迁移 + `schema.sql`）；`skill-sandbox.ts` 新增 `unrestricted` 模式放开读写路径收口与危险命令黑名单（**保留 vm 隔离**，不暴露主进程 `process`）；`SkillView.vue` 加开关（仅自定义工具、二次确认、卡片「脱离沙箱」标识）。内置预设强制留在沙箱内（DB / UI / 执行三处），导入 / 导出不携带该标记，脱离沙箱工具即便审批模式为 `off` 也强制弹一次确认。
- **流式静默超时可配**：设置页「常规」新增「流式静默超时」（30–600s，默认 90s，存 `stream_idle_timeout_ms`）。
- **系统托盘 + 关闭去向提示**：`src/main/index.ts` 新增常驻 `Tray`（右键菜单「显示主界面」/「退出」，单击 / 双击唤起主窗口），让「关闭窗口后仍在后台运行」可见、可重新唤起、可彻底退出；首次以 `close-window` 方式关闭时弹一次系统通知说明去向（设备级 `close_tray_hinted` 标记，仅提示一次）；`before-quit` 销毁托盘。设置页「点击关闭按钮时」文案同步说明托盘。

#### 变更 / 修复

- 流式静默超时由固定 60s 改为可配（默认 90s），收到推理思维链后放宽到 ≥180s，避免推理模型长思考被误判断线（`llm.ts`）。
- 空响应（silent-200）补一次自动重试；断网 / DNS 失败 / 拒绝连接给「网络连接不可用，请检查本机网络」专属中文提示（`llm.ts`）。
- 30 分钟硬上限暂停计时：等待工具审批弹窗期间不计时（`pauseDeadline` / `resumeDeadline`），避免用户思考时整轮被误中断（`chat-engine.ts`）。

### 余额 / 报错友好化

#### 新增

- **全局「余额不足」统一引导**：`utils/cloud-api.ts` 的 `request()` 统一识别 HTTP 402 → 抛结构化 `CloudBalanceError`（`code='INSUFFICIENT_BALANCE'`）+ 派发 `cloud-low-balance` 事件；新增 `stores/low-balance.ts`，`MainLayout` 常驻 `LowBalanceModal`，`main.ts` 统一监听。覆盖所有走 `cloudClient.*` 的调用（视频、市场、灵感、模板、套餐、订单）。
- 后端 `cloud-token.ts` 新增 `CloudBalanceError` / `throwCloudHttpError`（抛错版）/ `cloudErrorText`（文案版），402 统一转中文友好提示。

#### 变更 / 修复

- 视频生成：提交前按 SKU 单价做余额前置拦截弹充值引导；`errorMessage` 统一过 `translateError`（`AiVideoView.vue`）。
- 批量出图：开跑前按「单价 × 张数」前置拦截；跑批途中命中余额错误立即停队并标注剩余任务（`BatchGenView.vue` + `useImageBilling.checkBalance`）。
- 抠图（快速 / 精细）：`cloud-matting` / `cloud-fine-matting` 提交 / 轮询不再暴露裸 `HTTP 402`，统一中文余额提示。
- 云端知识库检索：402 不再静默降级到陈旧缓存，带回 `unavailableReason` 如实告知 LLM / 用户「线上知识库余额不足」（`cloud-kb-search.ts` + `core-tools.ts` + `chat-engine.ts`）。
- 画布工作流：节点 / 工作流失败统一过 `translateError`，命中余额则派发全局充值引导事件（`useWorkflowEngine.ts`）。
- 市场投稿 / 模板投稿 / 灵感上传：失败文案经 `cloudErrorText` 友好化，402 → 中文余额提示。
- `error-message.ts`：`ERROR_MAP` 增补余额 / 402 条目，`isBalanceError` 扩展识别中文「余额不足」与结构化 code。

### MCP 服务（整修：从不可用到全链路可用）

#### 修复

- **MCP 工具从未注入对话（根治）**：工具清单缓存（`mcp_servers.tools`）从未被填充——唯一的拉取函数 `listMcpToolsFromServer` 无任何调用方（无 IPC、无 UI 入口），`buildToolsList` 永远遍历空数组。现启动 / 创建 / 编辑 / 手动刷新均执行 `tools/list` 并持久化（随云同步跨设备分发，另一台设备无需重新探测），服务器推送 `notifications/tools/list_changed` 时自动刷新缓存。
- **MCP 协议握手缺失**：原实现 spawn 后直接裸发 `tools/call`（自启动仅固定等 1 秒），标准 MCP 服务器在未握手时会拒绝一切业务请求；现严格按规范先 `initialize`（60s 超时，容忍 npx 首启下载）→ `notifications/initialized` 后才发业务请求；stdout 单监听器按行分帧、并发请求按 JSON-RPC id 路由；服务器端 `ping` 有应答、未知请求回 `-32601`，防止对端挂起等待。
- **Windows 下 `npx` / `uvx` 必然启动失败**：`spawn` 裸命令名遇 `.cmd` 脚本抛 ENOENT（Node 已禁止隐式解析），而 UI 占位文案恰恰引导用户填 `npx`；改经 `cmd /c` 启动并对参数手工加引号（含空格路径安全），停止改用 `taskkill /T /F` 杀整棵进程树，根治 npx→node 孤儿进程残留（`mcp-server.ts`）。
- **stderr 不消费导致子进程假死**：MCP 规范要求服务器日志走 stderr，原实现从不读取，日志写满管道缓冲后子进程被写阻塞；现持续消费并保留 8KB 尾部，作为「启动失败」的诊断信息直接展示在卡片上（缺依赖 / 命令不存在 / 鉴权失败一目了然）。
- **启动失败 UI 仍显示「运行中」**：spawn 错误异步触发而原 `startMcpServer` 同步返回 true，store 不检查结果硬置 running；现启动全异步化（成功含握手 + 工具拉取，失败 reject 带 stderr 诊断），进程退出 / 崩溃实时推送 `mcp:status` 事件，徽标即时更新，不再是进页面时的一次性快照。
- **环境变量 JSON 填错静默变空**：表单 `JSON.parse` 失败被空 catch 吞掉，保存「成功」但 env 实为 `{}`（API_KEY 不生效且无从排查）；现实时校验红字提示并阻断保存（`McpView.vue`）。
- **系统提示词幻觉诱因**：原来只要绑定 MCP 就向模型宣称「MCP服务: xxx」而工具列表为空，诱导模型编造调用；现仅列出已发现工具的服务并附工具名清单（`chat-engine.ts`）。
- 工具标签渲染 `[object Object]`（`{{ t }}` 直渲对象）、删除无确认、表单无必填校验、`tools` / `args` / `env` 列损坏时 `JSON.parse` 抛错炸整页列表，一并修复。

#### 新增

- 「刷新工具」按钮（IPC `mcp:refreshTools`）；创建 / 编辑保存后自动后台探测（启动 + 握手 + 拉工具，结果落卡片状态）。
- 启用 / 禁用开关：停用的服务器不注入对话（此前 `enabled` 字段存在但无 UI，想停用只能删除）。
- 运行状态全生命周期：`starting` / `running` / `stopped` / `error` 四态徽标 + 启动失败原因展示（stderr 摘要）+ 工具名标签（超 8 个折叠计数，悬停显示描述）。
- MCP 工具声明 `annotations.readOnlyHint=true` 的在 `destructive` 审批模式下免确认，纯查询工具不再每次弹窗（豁免集合构建时排除与核心工具 / 小工具同名者防借名提权；`all` 模式仍全审批）。
- 工具结果规范化（`normalizeMcpToolResult`）：`content` 数组拍平为正文文本（image / audio / resource 留类型占位）、`isError` 转 `{error}` 计入失败熔断、`structuredContent` 原样保留，不再把协议包装层塞给模型浪费 token。
- 删除前原生确认框（提示会自动解绑智能体）；名称 / 命令必填校验。

#### 变更

- `mcp:status` 升级返回运行时对象（状态 + 错误详情 + 工具数）；preload 新增 `mcp.onStatus` 事件订阅（返回 unsubscribe）。
- `buildToolsList` 对 MCP 工具做同名去重（与核心工具 / 小工具 / 其它 MCP 服务器撞名跳过，与 `executeToolCall` 的路由优先级一致）。
- `sync/registry.ts`：`mcp_servers` 补 `secretFields: ['env']`，冲突记录不再明文留存 API key（与 `model_providers.api_key` 同策略）。
- 编辑保存时命令 / 参数 / 环境变量有变更自动停掉旧进程，按新配置重新探测生效。
- 对话上下文中的 MCP 调用失败信息截断 500 字（完整 stderr 诊断在 MCP 页面查看）；对话冷启动 MCP 由 `ensureClient` 事件驱动就绪（不再固定 sleep 1 秒）。

## [0.8.1] - 2026-06-08

> **对话内交互选项卡片（ask_user）+ 生图参数确认卡**：把原「工具调用确认」的人在回路回环泛化为通用「选项卡片」——AI 可在对话中弹出可点击选项让用户选择 / 澄清（inline 嵌入消息流、选完留痕），结果作为 tool result 回传给模型继续；并以此实现生图前「未指定尺寸时」的参数确认卡（尺寸 / 分辨率 / 画质 / 张数）。复用现有 `chat:appendMessage` 通道，新增 `chat:updateMessage` 留痕更新。

### 新增

- `main/services/user-choice.ts`：交互卡片人在回路回环（`requestUserChoice` / `respondUserChoice` + 30 分钟超时 / abort / 会话级取消），独立成模块以避免 `core-tools` ↔ `chat-engine` 循环依赖。
- `ask_user` 工具（`core-tools.ts`）：AI 弹出选项卡，支持一次提出多个问题（`questions[]`，前端按分步向导逐题作答：进度条 + 上一步 / 下一步 + 末尾「完成」统一提交；单题自动简化），每题可单选 / 多选 / 附自由输入；挂起等用户作答并把逐题结果作为 tool result 返回；落 pending 卡片消息 → answered 留痕，全程经 `chat:appendMessage` / `chat:updateMessage`。`isDestructiveTool` / `needsApproval` 放行，避免二次确认弹窗。
- 生图参数确认卡（`image_params`）：chat 路径下生图若用户未指定 `size`，先弹卡确认尺寸 / 分辨率档位 / 画质 / 张数（复用 `shared/image-size.ts`），确认后再后台出图（仍 fire-and-forget）；已指定 `size` 则直连出图不打扰。
- 前端组件 `components/AskUserCard.vue`（多问题分步向导：进度条、逐题单 / 多选、自由输入、上一步 / 下一步 / 完成、答完留痕）与 `components/ImageParamsCard.vue`（尺寸 / 档位 / 画质 / 张数一屏多组）；`ChatView` 渲染与提交回传；`chat` store `listenUpdateMessage`；IPC `chat:respondUserChoice` 与 `chat:updateMessage`、preload / `env.d.ts` 类型。

### 变更

- `messages` 表新增 `card` 列（JSON，仅 UI 留痕，不回传模型）；`schema.sql` + `database/index.ts` 幂等加列。
- `sync/registry.ts`：`messages.skipColumns` 加入 `card`（卡片留痕不参与云同步）。
- `chat-engine.ts`：历史回放跳过带 `card` 的消息（避免破坏 OpenAI `assistant.tool_calls` / `tool` 配对）；系统提示注入 `ask_user` 用法、更新生图工作流（未指定尺寸交由参数卡）。
- `database/index.ts`：启动时把残留 `pending` 卡片标记为 `expired`（进程重启后挂起回环已失效），置于同步触发器安装前以免产生 oplog 噪音。

### 修复

- 卡片选择回传卡死：`onCardSubmit` 把含 Vue reactive proxy 的 `answers` / `result` 直接交给 Electron IPC，structured clone 抛 `An object could not be cloned`，导致选择从未到达主进程、`ask_user` 工具永久挂起、对话流一直转圈——回传前用 `JSON.parse(JSON.stringify())` 转为纯对象。
- 交互卡片不渲染：`ChatView` 的 `visibleMessages` 以 `!!content` 过滤助手消息，会把 `content` 为空、仅含 `card` 的卡片消息一并滤掉——改为按 `card` 放行。
- 末题交互：分步向导末题改为始终显示「完成」按钮由用户确认提交（不再单选即自动提交），符合「末尾有确定按钮」的预期。

## [0.8.0] - 2026-06-08

> **云同步与容量计费（一次性完整交付，独立于本地备份）**：新增账号级跨设备数据同步——实体级增量同步引擎（pull→merge→push，`server_seq` 乐观并发），支持覆盖 / 智能融合（字段级三路合并 + 集合合并 + 冲突记录不丢数据）、自动 / 手动同步、按分类（纯数据 / 图片 / 视频）选择性同步；媒体走内容寻址 blob（sha256 去重、秒传、分块断点续传、流式上传下载）；接入云端存储容量计费。需云控端 1.6.0。云同步默认关闭，需在设置页手动开启。

### 新增

- `main/services/sync/`：实体注册表、SQLite 触发器（`sync_oplog` / `sync_tombstone` / `sync_shadow`）、`serializer`（媒体外置 base64→blob、JSON / 集合字段、内容哈希）、`engine`（主循环 + 覆盖 / 融合三模式）、`merge`（三路合并）、`blob`（流式哈希 / 秒传 / 分块断点续传 / 待取重试 / GC）、`scheduler`、`api`、`index` 门面。
- IPC `sync:*`（`status` / `now` / `getConfig` / `setConfig` / `getQuota` / `getConflicts` / `getLocalStats` + `progress` / `status` 事件）与 preload、`env.d.ts` 类型。
- 设置页「云同步」区块（容量条、频率、范围、冲突策略、进度、设备状态、冲突查看、首开隐私授权）；用户中心「云存储」用量卡（`CloudSyncSection.vue` / `CloudStorageCard.vue`）。

### 变更

- `database/index.ts`：开库时安装同步触发器（置于内置 seed 之后，避免内置数据进 oplog）；启用 `recursive_triggers`，使 FK 级联删除能跨设备传播。
- `account-context.ts`：在账号目录就绪时启动同步、热切换时停止同步，规避「登录瞬间在 root 目录开库同步」的时序问题。

### 安全 / 健壮性

- 敏感字段（自定义模型 `api_key`）由云控端加密存储；blob 私有读（COS/OSS 预签名 URL、本地鉴权代理）。
- 媒体上传 / 下载与云端拼接全面流式化，峰值内存约单分块（4MB）级，与文件大小无关。
- 默认不同步向量、缓存与设备级文件；下载失败的媒体登记待取下次重试；冲突与被覆盖版本均有记录。
- 统一账号称呼为「云账号」，修正历史更新记录与提示文案中的错误名称。

## [0.7.21] - 2026-06-07

> **对话引擎完整加固（不降级 / 一次性交付）**：根治「会话失败或余额不足后卡死、需重开会话才正常」与「多页 PPT 等长任务被中途打断」两类可用性问题；借鉴成熟 Agent 实现补齐发送前消息净化、工具失败熔断、中断自愈；新增消息编辑 / 重新生成 / 删除、思维链持久化；知识库向量检索引入 sqlite-vec 加速；自定义小工具改为受限沙箱执行。所有新增路径均带 fallback，现有能力（工具审批、大结果转存、并行执行、增量摘要、双通道 RAG、生图异步、会话级模型）全部保留。

### 修复

- **会话被「毒消息」污染导致持续失败（根治）**：某轮模型返回空内容、余额不足时网关 silent-200、或中断遗留孤立 tool_calls，会在历史中留下非法消息，导致之后每轮 replay 持续 400 / 空响应，只有重开会话才正常。
  - 新增 `main/services/message-sanitizer.ts`：每轮 callLLM 前对「发给模型的副本」做净化（删空 assistant / user、修复 tool_calls / tool 配对、合并连续 user），数据库仍全量落库。
  - `chat-engine.ts` 无 tool_calls 分支加空响应防护：空则重试一次，仍空落友好提示（绝不落空消息）。
  - `llm.ts` `streamLLMOnce` 加 silent-200 / 空流识别（无正文 + 无工具 + 无思维链 + 无 usage 时抛友好错误），避免空内容落库。
- **多页 PPT 等长任务被中途打断**：`MAX_TOOL_ROUNDS` 默认提至 40 并支持按智能体配置；到达上限不再静默截断，而是追加「回复『继续』可接续」提示（ppt-master 自带断点，天然可续）。

### 新增

- **消息编辑 / 重新生成 / 删除**：新增 `chat:editMessage` / `chat:regenerate` / `chat:deleteMessage` IPC 与 `conversation.deleteMessagesFrom`、`chat-engine.regenerateLastResponse` / `editAndResend`；前端气泡加对应操作并带乐观更新；编辑 / 重生成截断历史后复用 `sendMessage` 重发，保留附件。
- **思维链（reasoning）持久化**：`messages` 表加 `reasoning` 列，落库最终回复的思维链；`getMessages` 读回并在前端折叠面板渲染，刷新 / 切回会话不丢；历史重建只取 content，思维链不回传模型。
- **智能体「单轮最大工具步数」配置**：`bots.max_tool_rounds`（0 = 默认 40）+ `BotListView.vue` 表单输入，长任务型智能体可调高。
- **手机号验证码注册 / 找回密码**（需云控端 1.5.45）：登录页扩展为登录 / 注册 / 找回密码三态；注册可由云控端开关要求「手机号 + 短信验证码」，新增「忘记密码」入口（手机号 + 验证码重置），验证码输入带 60 秒倒计时。`cloud-api.ts` / `cloud-auth.ts` 新增 `sendSmsCode` / `resetPassword`，`site-config.ts` 解析 `register.sms_verify_enabled` / `forgot_password.enabled` 开关。

### 增强

- **工具失败熔断 / 循环检测**（借鉴 CowAgent）：新增 `main/services/tool-circuit-breaker.ts`——同参连续失败 ≥3、同工具连续失败 ≥6/≥8、同参重复调用 ≥5/≥10 分级熔断（≥8 失败或 ≥10 重复升级 critical 中止本轮），避免死循环烧满轮数与大量 token。
- **中断自愈**：abort / error 时 `healDanglingToolCalls` 为悬空 `assistant.tool_calls` 补合成 tool 结果落库，与发送前净化形成双保险，保证下一轮历史配对合法。
- **自定义小工具受限沙箱**：`skill-sandbox.ts` 用 Node `vm` 受限上下文替代 `new Function`，隔离 process / require / module（逃逸只能到达受限 global），同步死循环可被 timeout 中断；读路径收口到「数据目录 ∪ 工作区 ∪ 可信白名单」，与对话层审批白名单统一。

### 优化

- **知识库向量检索加速**：引入 `sqlite-vec`（`database/index.ts` 加载检测 + `electron-builder.yml` asarUnpack），`vector-store.ts` 用 `vec0` 虚拟表做 cosine KNN（按维度建表 + 双写 + 懒同步）；加载失败 / 维度不符 / 查询异常任一环节自动回退到（已优化的）JS cosine，零降级。
- **chat-engine 解耦**：拆出 `message-sanitizer.ts`、`tool-circuit-breaker.ts` 两个纯函数模块，降低主文件体积、便于测试。

## [0.7.19] - 2026-06-07

> **配合云控端 1.5.39：AI 视频可使用云端新接入的服务商（桌面端无代码改动）**：云控端 1.5.39 预置了一个 OpenAI 兼容的视频服务商（New API 中转）。云控端管理员填写自己的接口密钥并启用后，桌面端「AI 视频」即可直接使用其提供的 Seedance 2.0 等模型，无需桌面端升级。本版桌面端无功能代码改动，仅记录该云端联动变化。

## [0.7.18] - 2026-06-06

> **灵感广场 / 创意模板 / 智能体市场列表改用缩略图**：三处网格列表改为「缩略图优先、原图回退」，详情与灯箱仍用原图，显著降低列表加载流量。缩略图由上传端生成、云控端原样存为独立文件，对存储后端（local / COS / OSS）零特性要求；旧记录无缩略图时自动回退原图，不影响显示。需配合云控端 1.5.35。

### 新增

- **云端知识库在线检索（hybrid，需配合云控端 1.5.36）**：智能体可在云控端绑定知识库；用户从市场获取该智能体后，对话时桌面端在线检索其绑定的云端知识库并注入上下文，权限随智能体授权传递，知识内容留在云端。
  - `bots` 表新增 `cloud_kb_ids` / `cloud_kb_only` / `cloud_kb_top_k`；新增 `cloud_kb_cache` 表（schema.sql + `database/index.ts` 幂等迁移）；`main/services/bot.ts` 同步类型与 CRUD。
  - 新增 `main/services/cloud-kb-search.ts`（调云控端 `POST /api/client/knowledge-bases/search`，`fetchWithCloudAuth`）+ `cloud-kb-cache.ts`（queryHash + 7 天 TTL 的命中片段缓存，断网/超时降级）。
  - `chat-engine.ts` 在本地 RAG 之外并列注入云端检索结果（命中标注来源 / 离线），`buildToolsList` / `executeToolCall` 透传 `cloudKbIds`，`kb_only` 约束扩展到云端库。
  - `core-tools.ts` 的 `kb_search` 改为同时检索本地与云端知识库并按分数合并；`cloud-agent-market.ts` 的 `importAgentAsLocal` 在 acquire 时写入 kb 绑定。
  - `renderer/stores/bots.ts` 同步类型；`BotListView.vue` 卡片加「云端知识库 N」徽标，`ChatView.vue` 工具栏只读提示已绑定云端知识库。
- **三大云端页面网格缩略图（上传端生成，零服务器依赖）**：
  - `main/services/thumbnail-upload.ts`（新）：用 Electron `nativeImage` 把原图等比缩放为 JPEG 缩略图（封面长边 720 / 头像 512，只缩不放），失败返回 null 由调用方跳过，云端与客户端均回退原图。
  - 三处投稿路径在发原图的同时附带缩略图：`cloud-inspiration.ts`（`cover_thumb`）、`cloud-creative-template-submit.ts`（`cover_thumb`）、`cloud-agent-submit.ts`（`avatar_thumb`，`loadAvatarBlob` 顺带回传 buffer）。
  - 三处 mapper 透传缩略字段：`main/services/inspiration.ts`（`fetchOnlineInspirations`）、`cloud-creative-template.ts`（`mapTemplate`）、`cloud-agent-market.ts`（`mapAgent`）；`renderer/stores/bots.ts` 的 `MarketAgent` 加 `avatar_thumb`。

### 改进

- **网格缩略优先、原图回退**：`renderer/views/image-gen/InspirationView.vue`（网格 `cover_thumb || cover_image`，详情大图不变）、`renderer/views/creative-templates/CreativeTemplatesView.vue`（`resolveCover` 云端项优先缩略图，本地模板无缩略则回退原图）、`renderer/views/bots/BotListView.vue`（市场卡片 `avatar_thumb || avatar`）。

### 修复

- **恢复「数据库备份」会误删非 DB 文件（数据安全）**：`backup/index.ts` 的 `doRestoreV1` 原先无差别归档 dataDir 全部根目录、只搬回 db → 恢复 db-only 备份后技能 / 图片 / 知识库源文件等被移入 `.restore-previous-*`（7 天后清理），与 UI「技能文件和图片不受影响」相反。现按 `manifest.type` 缩小范围：`auto` 仅替换 `local-agent.db`，`full` 仍精确镜像全部根条目。

### 增强（备份/恢复健壮性）

- **恢复中断自愈**：替换 dataDir 前写 `backups/.restore-in-progress.json` 标记（previous / staging / 受影响条目），成功或回滚后清除；主进程在 `getDatabase()` 之前同步调用 `recoverInterruptedRestore()`，崩溃 / 断电中断后下次启动自动把 previous 归档的恢复前数据搬回，闭合"半成品 dataDir"窗口（`backup/staging.ts` + `main/index.ts`）。
- **磁盘空间预检**：`backup/staging.ts` 新增 `getFreeSpace`/`ensureFreeSpace`（`statfsSync`，不支持则跳过）；`packV1` 在快照前（~db 大小）与写 zip 前（~totalSize）预检，`doRestoreV1` 解压前预检（~totalSize），空间不足提前给中文报错而非中途 ENOSPC。
- **孤儿备份回补**：`records.json` 损坏被隔离后磁盘上的 `*.zip/.sqlite/.bak` 会成孤儿（不显示、不清理）；启动 `reconcileOrphanBackups` 扫描回补（v1 读 manifest，legacy 用 mtime），重新纳入列表与 retention。
- **列表 / 保留排序按 createdAt**：`listValidRecords` 改为按 `createdAt` 倒序（原为 append 顺序 reverse）；外部「从文件恢复」导入的备份 `createdAt` 改用导入时间，避免按原始旧时间被 retention 提前清理或在列表错位。

## [0.7.17] - 2026-06-04

> **智能体市场：付费购买 + 定向可见**：从市场「保存到本地」前先经云控端 `acquire` 校验——收费智能体扣金币 / 积分（余额不足弹「前往充值」引导）、定向智能体仅被授权的用户 / 用户组可见可存；收费智能体购买后才下发系统提示词，删本地后重存不重复扣费。需配合云控端 1.5.34。
>
> **新增「精细抠图」+ 原「AI 抠图」更名「快速抠图」**：精细抠图对接抠抠图（koukoutu）高清抠图，按上传图片长边尺寸三档计费（4K 以下 / 4K–8K / 8K 以上，后台自定义价格），仅云端中转、全站并发 5；原「AI 抠图」更名「快速抠图」，两者并存。两套抠图的报错 / 余额不足提示同步中文友好化。
>
> 本版另含图生图手动中止生成中任务 + 队列记录管理、AI 视频参考图上传前自动压缩、长任务历史上下文自动精简、超大工具结果转存文件等改进（详见应用内「更新日志」）。

### 新增

- **精细抠图（抠抠图 koukoutu，按尺寸三档计费）**：
  - 新增独立「精细抠图」：`renderer/views/fine-matting/FineMattingView.vue` + `renderer/stores/fine-matting.ts` + 主进程 `services/fine-matting.ts` / `services/cloud-fine-matting.ts` + `fineMatting:*` IPC + preload / `env.d.ts` 命名空间 + 本地 `fine_matting_tasks` 表（`schema.sql` / `database/index.ts`）+ 图库「我的精细抠图」分类（`gallery.ts`）+ 图标 `IconFineMatting.vue` + 路由 `/fine-matting` + 侧栏菜单（受 `allow_fine_matting` 控制）。
  - 对接抠抠图通用抠图异步 API（create → poll，Image File 模式，输出透明 PNG），仅云端中转、API Key 不下发桌面端；结果落 `dataDir/fine-matting/` 并自动归档。
  - 按上传图片长边尺寸三档计费（默认 <4096 / 4096–7680 / ≥7680，阈值与三档积分价均后台可配）；待处理缩略图实时显示档位 + 预估价。
  - 原「AI 抠图」更名为「快速抠图」（菜单 / 路由标题、`DesktopMenuController` 文案；路由 `/ai-matting` 与本地数据不变）。
  - 需配合云控端：网关 `/gateway/fine-matting/*`、管理后台「精细抠图」、权限 `allow_fine_matting` + `fine_matting_quota_per_month`。

- **智能体市场付费购买 + 定向可见**：
  - `main/services/cloud-agent-market.ts`：列表 / 详情请求改带云端 token（`getCloudToken`）——登录后按可见范围过滤并取得 `is_owned`，未登录仍可浏览公开智能体；`CloudAgent` 加 `price` / `price_balance_type` / `is_owned`；新增 `acquireAgent`（`POST /client/agents/{id}/acquire`，区分 401 未登录 / 403 无权限 / 402 余额不足）；`importAgentAsLocal` 改为「先购买 / 获取成功，再用服务端下发的完整数据（含购买后才返回的 `system_prompt`）建本地智能体」，删本地后重存不重复扣费。
  - `renderer/stores/bots.ts`：`MarketAgent` 加 `price` / `price_balance_type` / `is_owned`；`importFromMarket` 透传 `needLogin` / `needRecharge` / `forbidden` / `needed` / `current` / `balanceType`。
  - `renderer/views/bots/BotListView.vue`：市场卡片展示「价格 / 已拥有 / 免费」，按钮按是否收费显示「购买并添加」；保存流程处理未登录（引导登录）、无权限、余额不足（弹 `LowBalanceModal`），购买成功刷新余额。
  - `renderer/components/LowBalanceModal.vue`：新增「前往充值」按钮（此前仅「套餐商城」）。
  - 需配合云控端 1.5.34。

- **图生图手动中止生成中的任务（真中止 / 计费不返还）**：
  - `main/services/image-generation.ts`：新增 `GenerationCanceledError` 与 `genId → AbortController` 注册表，导出 `cancelGeneration` / `cancelGenerations`；`fetchWithTimeout` / `fetchWithRetry` / `pollAsyncTask` 全链路接入外部 `AbortSignal`——自定义渠道立即断开 HTTP 连接，云端 / 多米异步轮询用可打断的 `interruptibleSleep` 立即停止轮询，中止错误不参与退避重试、不计入瞬态失败；`callImageAPI` / `callCloudImageAPI` / `callDuoMiImageAPI` 透传信号；`generateImages.runOne` 为每个生成项注册 controller，捕获中止后标记 `status='canceled'`（区别于 `error`）并回发带完整记录的 `canceled` 进度事件，`finally` 注销句柄。
  - `main/ipc/index.ts`：新增 `imageGen:cancelGeneration` / `imageGen:cancelGenerations`。
  - `renderer/stores/image-gen.ts`：新增 `cancelGeneration`（占位卡乐观置 `canceling`，IPC 失败回滚）/ `cancelAllInFlight`；`onProgress` 处理 `canceled` 事件，用带真实参数（prompt / 模型 / 尺寸）的记录替换占位卡，便于查看 / 重新生成 / 删除。
  - `renderer/views/image-gen/ImageGenView.vue`：生成中卡片（网格 / 列表）新增「中止」按钮，新增「已取消」状态卡，队列区加「中止生成」批量入口；`isInFlightStatus` / `statusLabel` 纳入 `canceling` / `canceled`。
  - 计费不返还：仅断开桌面端本地请求并停止等待 / 落盘，已提交到云端 / 多米的异步任务上游若已执行仍照常扣费；未触碰云控端。

### 修复

- **画布 AI 视频带参考图生成报 `Failed to fetch`**：`views/canvas/composables/useWorkflowEngine.ts` 的 `dataUriToFile` 改用 base64 解码直接构造 `File`，替代原 `fetch(dataUri)`。图生视频 / 首尾帧模式上传参考图时，`fetch` 一个 `data:` URI 会被 Electron 生产 CSP 的 `connect-src`（仅 `'self' https: http:`，不含 `data:`）拦截，抛原生 `Failed to fetch` 致提交中止；改为本地解析 base64 绕开网络栈与 CSP（更高效、对大图更稳）。纯文生视频不受影响。
- **多入口 / 多会话生图进度卡片串台**：`renderer/stores/image-gen.ts` 的 `onProgress` 监听此前不区分来源，会把编辑页 / 聊天 / 画布的生图进度并入图生图列表的 `inFlight` 占位与顶部进度条；改为仅处理 `source==='image-gen' | 'batch'`。`renderer/components/ChatImageGenProgress.vue` 此前只按 `source==='chat'` 过滤、未按会话隔离（注释与实现不符），多会话同时生图时卡片会串台；改为按 `conversationId` 过滤 + 切换会话清空浮窗，`ProgressTask` 补 `conversationId` 字段。
- **刚登录即生图的错路由隐患**：`main/services/image-generation.ts` 云端生图分支，若 `cloudModels` 尚未从渲染端 IPC 同步到主进程（此时 `cloud_model_id` 必为 `null`），此前会照发请求、由云端按 `model_id` 兜底（多家同名服务商可能错路由 / 错扣费）；改为在模型缓存为空（明确未就绪）时抛「云端模型尚未同步完成，请稍候重试」，多家同名场景交由云端返回明确错误。

### 改进

- **快速抠图 / 精细抠图：报错与余额提示优化**：
  - 余额不足、配额用尽改中文友好提示（含所需 / 当前、已用 / 上限），不再显示英文 `Insufficient credit balance` / `Quota exceeded`；新增 `renderer/utils/matting-error.ts` 统一归类队列失败原因（余额 / 配额 / 繁忙 / 网络 / 超时 / 格式 / 登录）。
  - 云端处理阶段新增「处理中」进度相位；轮询超时文案改为「任务可能仍在云端处理，请稍后重试」。
  - 两页顶部新增服务状态条，批量结束给失败数量汇总；精细抠图提交前预检图片尺寸（测量完成才可提交、长边超 10000px 标红拦截）。

- **编辑页生图标记来源**：`renderer/views/image-gen/ImageEditView.vue` 重绘提交补 `progressContext.source='edit'`，避免被图生图 / 批量列表的进度监听误并入其 `inFlight`。
- **聊天生图默认 2K 档位**：`main/services/core-tools.ts` 的 `image_gen` 工具补默认 `tierId='2k'`（与画布节点一致；图片按 per-call 计费，分辨率档位不影响扣费）。
- **图生图队列记录可视化 + 单条移除**：`renderer/views/image-gen/ImageGenView.vue` 左侧原仅「清空队列」，扩展为完整排队记录列表（序号 / 提示词摘要 / 批量数 ×N + 逐条「移出队列」按钮，复用 store 既有 `removeFromQueue`），并保留「清空队列」；正在生成的任务通过卡片「中止」或队列区「中止生成」处理。
- **账单明细充值类记录文案中文化**：`renderer/components/BalanceLogsDialog.vue` 的 `changeTypeLabel` 补全 `recharge`（充值）/ `recharge_bonus`（充值赠送）/ `deduct`（扣减），不再回退显示英文 `change_type`；`displayRemark` 剥除备注内部技术前缀（`[tianque_sync]` / `[recharge]` / `[order]` / `[admin_sync]`），充值到账备注由 `[tianque_sync] PO… 充值到账` 变为 `PO… 充值到账`；筛选下拉补充「充值 / 充值赠送 / 扣减」三项（后端真实存在但此前缺失的 `change_type`）。
- **套餐商城 / 充值入口按云控端开关显隐**：`stores/site-config.ts` 解析公开配置新增 `plans_store` / `recharge`（token/credit）开关 + 本地缓存 + `hasAnyRecharge`；`UserCenterView.vue`（顶部与侧边栏「去套餐商城」、「充值」入口）、`LowBalanceModal.vue`（「套餐商城」「前往充值」按钮）、`RechargeView.vue`（按 `config.token/credit.enabled` 过滤充值 tab、选中类型被关时自动切到可用类型）据此显隐。配合云控端 1.5.34 的三个开关。

## [0.7.16] - 2026-06-04

> **智能体市场（桌面端）**：智能体页重构为「我的智能体 / 智能体市场」双 Tab，可从云控端上架的市场拉取智能体并「保存到本地」（自动建人格承载系统提示词、下载 2:3 形象图落盘、绑定 6 个内置小工具，并按 `cloud_agent_id` 去重）；本地智能体支持设置 2:3 形象图、发布到市场（投稿）+ 审核状态徽标 + 撤回、对市场智能体评分。需配合云控端 1.5.31。
>
> **修复对话内生图进度卡片潜在崩溃**：`ChatImageGenProgress.vue` 误用未 import 的 `watchEffect`，组件挂载时会抛 `ReferenceError`，已修复。

### 新增

- **智能体市场（云端创建 → 桌面端保存到本地）**：
  - `renderer/views/bots/BotListView.vue`：双 Tab（我的智能体 / 智能体市场）；本地卡片渲染 2:3 形象图（`local-file://`，无图回退首字母）+ 投稿状态徽标 +「发布到市场 / 撤回」；市场卡片展示形象 / 标签 / 评分 / 下载量 +「添加（保存到本地）」+ 评分弹窗（仅阴影无遮罩）；编辑表单新增 2:3 形象图上传（前端比例校验）。
  - `main/services/cloud-agent-market.ts`（新）：匿名拉取 `/public/agents` 列表 / 详情；`importAgentAsLocal` 保存到本地（建人格写 `system_prompt` → 建 bot 绑 6 个内置小工具 → 下载形象图落盘 → 下载量 +1 → 按 `cloud_agent_id` 去重）。
  - `main/services/cloud-agent-submit.ts`（新）：投稿 `submit` / 状态轮询 `status-batch` / 撤回 / 评分 `rate`（JWT）。
  - `main/services/bot-avatar.ts`（新）：2:3 形象图落盘 `{dataDir}/bot-avatars/`、远程下载、`data:URL` 落盘、删除清理。
  - `main/services/bot.ts` + `resources/schema.sql` + `main/database/index.ts`：`bots` 表加列 `avatar` / `source` / `cloud_agent_id` / `submission_*`（幂等迁移）；新增 `getBotByCloudAgentId` / `setBotSubmissionState`。
  - `main/ipc/index.ts`：新增 `bot:saveAvatar` / `bot:listMarket` / `bot:getMarket` / `bot:importFromMarket` / `bot:submitToMarket` / `bot:syncSubmissionStatus` / `bot:withdrawSubmission` / `bot:rate`；`bot:delete` 同步清理形象图文件。
  - `renderer/stores/bots.ts`：`Bot` 接口加市场字段，新增 `MarketAgent` 类型与市场 / 投稿 / 评分 actions。
  - 需配合云控端 1.5.31（智能体管理后台 + `/api/public|client|admin/agents` 接口）。

### 修复

- **对话内生图进度卡片潜在崩溃**：`renderer/components/ChatImageGenProgress.vue` 使用了未 import 的 `watchEffect`（且 `watch` 导入未用），组件挂载即抛 `ReferenceError`；改为正确 import `watchEffect`。

### 其他

- 清理两处既有未使用变量告警：`views/canvas/composables/useWorkflowEngine.ts`（`projectId` → `_projectId`）、`views/models/ModelView.vue`（移除未使用的 `normalizedApiBasePreview`）。

## [0.7.15] - 2026-06-04

> **知识库向量化失败不再「假就绪」**：整批向量化全部失败时（如云端向量服务返回异常），知识库不再被错误标记为 `ready`，改为如实置 `error` 并中断，避免到对话检索时才暴露；同时把上游 HTML 错误页归纳为可读提示。纯桌面端改动，后端零改动。
>
> **多米生图支持参考图**：补上「多米图片渠道带参考图」的桥接——参考图先转存为公网 URL 再提交，此前多米带参考图实际不生效（仅能纯文生图）。需配合云控端 1.5.29。
>
> **对话体验与安全加固**：消息顺序稳定、长命令不卡界面、中断/报错保留已生成内容、支持思维链展示、增量摘要修复记忆空洞；AI 读取工作区外文件需确认，设置页可配置可信目录白名单。

### 新增

- **文件读取安全（工作区外确认 + 可信目录白名单）**：
  - `main/services/chat-engine.ts`：`needsApproval` 在 `destructive` 模式下，对 `file_ops` 的读类操作（`read` / `read_json` / `list` / `glob` / `find_latest` / `tree`）若目标路径落在工作区外且不在白名单内，弹审批确认；工作区内与白名单目录内免确认。`stat` / `exists` 不拦。限制仅作用于模型发起的 `file_ops`，不影响附件解析、技能读资源目录等内部读取。
  - `main/services/core-tools.ts`：新增 `previewFileRead` / `FileReadPreview`，审批弹窗展示真实绝对路径及「工作区外」标记。
  - `renderer/views/chat/ChatView.vue`：审批弹窗新增读取文件预览分支。
  - `renderer/views/settings/SettingsView.vue`：新增「文件读取安全」区块，可信目录白名单（`settings.trusted_read_dirs` JSON 数组），添加/移除后自动保存。

- **多米生图支持参考图（base64 → 云端 URL 桥接）**：多米图片 API 上游只可靠接受图片 URL，`dataUri` / 裸 base64 会被其 nginx WAF 拒收或静默忽略参考图（此前 `callDuoMiImageAPI` 把参考图补成 dataUri 直传，实测无效，多米实际仅能纯文生图）。
  - `main/services/image-generation.ts`：新增 `uploadRefImageToCloud()`，参考图先 POST 到云控端 `client/images/reference-assets` 落对象存储换成公网 URL，再交给多米 `/generations`；`callDuoMiImageAPI` 改为「已是 http URL 直通，否则 `prepareRefImageForUpload` 取 buffer + mime → 上传换 URL」。临时素材 6h 过期、由云端 `video:purge-reference-assets` 自动清理。
  - 需配合云控端 1.5.29（新增 `client/images/reference-assets` 接口，与 `DuoMiAdapter` 的同源 base64→COS→URL 桥接配套）。

### 改进

- **对话上下文与多模态 token 管理**：
  - `main/services/chat-engine.ts`：图片 token 按 data URI 长度估算；历史消息仅保留最近若干轮用户消息中的图片，更早轮次替换为文字占位，降低上下文膨胀。
  - `main/services/chat-engine.ts` + `conversation-summary.ts` + `schema.sql` / `database/index.ts`：摘要改为增量生成，新增 `covered_count` 水位线，只压缩滑出窗口且尚未被摘要覆盖的段落，避免每轮全量重压与「滑出窗口却未进摘要」的记忆空洞。

- **LLM 思维链（reasoning）流式展示**：
  - `main/services/llm.ts`：解析 `delta.reasoning_content` / `delta.reasoning`，通过 IPC 推送 `reasoning` 事件。
  - `renderer/stores/chat.ts` + `views/chat/ChatView.vue`：对话中可展开查看「思考中… / 已深度思考」面板（流式 UI，不落库）。

- **套餐描述支持「展开 / 收起」**：新增可复用组件 `renderer/components/ExpandableText.vue`，折叠态用 `-webkit-line-clamp` 限制行数，配合 `ResizeObserver` + 高度测量判断文本是否真被截断，仅在溢出时才显示「展开 / 收起」按钮（短描述不显示按钮），并保留描述换行（`whitespace-pre-line`）。
  - `views/plans-store/PlansStoreView.vue`（套餐商店，折叠 2 行）与 `components/MyPlansBox.vue`（我的套餐，折叠 1 行）接入，替换原先的 `line-clamp` 纯截断标签。此前云控端套餐描述最多可填数百字，桌面端仅显示 1～2 行且无法查看完整内容。

### 修复

- **同时间戳消息顺序不稳定**：`main/services/conversation.ts` 的 `getMessages` 改为 `ORDER BY created_at ASC, rowid ASC`，一轮内 `assistant(tool_calls) → tool` 同步插入时 `created_at` 相同导致重建历史错乱的问题由 SQLite 隐式 `rowid` 兜底，无需新增 `seq` 列与迁移。
- **run_command 阻塞主进程**：`main/services/skill-sandbox.ts` 的 `execStructured` 由 `execSync` 改为异步 `exec`；`core-tools.ts` 的 `RUN_COMMAND_IMPL` 对应 `await`，长命令执行时界面不再卡死。
- **中断或 LLM 报错时丢失已生成内容**：`llm.ts` 在流式错误上附带 `__partialContent`；`chat-engine.ts` 落库保留片段；`stores/chat.ts` 在 `aborted` / `error` 时追加标记而非覆盖 `msg.content`。
- **整批向量化失败被静默标记为「就绪」（假就绪）**：`main/services/vectorize.ts` 在 `embeddedCount === 0`（所有分块均未成功向量化）时，将知识库状态由 `ready` 改为 `error` 并抛出明确错误（与「余额不足」等致命错误一致），不再出现"写入全 `null` 向量却标记就绪"的情况。此前云端向量服务异常时入库"看似成功"，直到对话 `kb_search` 检索才报错。新增 `lastBatchError` 记录最后一次非致命批次错误用于上报原因。
- **上游错误页被透传为大段 HTML**：`main/services/embedding.ts` 新增 `summarizeUpstreamErrorBody`，本地 / 云端向量请求失败且响应体为 HTML / XML 错误页时，归纳为「服务端返回 HTML 错误页而非 JSON…」的可读提示，否则截断前 300 字符，避免大段 HTML 刷屏。
- **向量源偏好被「登录态/权限」覆盖**：`renderer/views/settings/SettingsView.vue` 加载逻辑与 `vectorMode` watch 中，`cloud-locked` / `local-only` 仅纠正 UI 显示，不再持久化覆盖 `vector_source`（运行时 `getEmbeddingConfig` 已按登录态/权限兜底）；watch 回到 `dual` 时从持久化恢复显示值。修复「选了云端向量、token 过期后重启打开设置页，偏好被悄悄改成自定义且重新登录也回不来」的问题。
- **灵感广场分类筛选只过滤当前页**：`renderer/views/image-gen/InspirationView.vue` 此前 `fetchOnline` 不传 `category` / `search`，仅在当前页 40 条里前端 `filter`，导致选分类只显示当前页内属于该分类的记录。改为切分类 / 搜索（防抖 350ms）时重置到第 1 页、把 `category` / `search` 传给后端查询（对齐创意模板做法），列表直接渲染后端分页结果，并缓存所选分类 / 搜索以保证跨页面返回一致。

---

## [0.7.14] - 2026-05-30

> **流式画布「视频创作 + 智能分镜 + 角色一致性」**：在 0.7.13 的 AI 视频节点之上，补齐从「视频素材 → 关键帧 / 反推回喂」「小说 → 分镜」到「角色定妆图生成 / 复用」的完整创作链，后端零改动（仅画布本地服务与本地库扩展）。

### 新增

- **视频创作链节点**（`videoInput` / `videoFrames` / `videoReverse` / `storyboard`）：
  - `views/canvas/composables/useNodeTypes.ts`：新增上述 4 节点定义（`videoFrames` / `storyboard` 为 `dynamicOutputs`，每帧 / 每镜头一个 `output-{id}`）。
  - `views/canvas/composables/useVideoFrames.ts`（新）：纯前端抽帧（`fetch → blob → video.seek → canvas.drawImage → toDataURL`）。
  - `views/canvas/nodes/VideoInputNode.vue`（新）：导入本地视频并以 `video` 输出。
  - `views/canvas/nodes/VideoFramesNode.vue`（新）：均匀 / 按秒抽帧，逐帧落盘后按动态 handle 输出 image。
  - `views/canvas/nodes/VideoReverseNode.vue`（新）：抽代表帧 + 多模态反推，输出提示词 / 分镜 text。
  - `views/canvas/nodes/StoryboardNode.vue`（新）：小说 / 剧情 → 镜头提示词列表，逐镜头动态输出 text。
  - `views/canvas/composables/useWorkflowEngine.ts`：新增 `case 'videoFrames' / 'videoReverse' / 'storyboard'` 与对应 `executeVideoFramesNode` / `executeVideoReverseNode` / `executeStoryboardNode`；`getUpstreamData` 支持分镜文本 + videoFrames 动态图片、`getUpstreamImagesByHandle` 支持 videoFrames、新增 `getUpstreamVideo`。
  - `main/services/canvas.ts`：新增 `saveNodeVideo`（copyFile）、`saveNodeFrames`（批量落帧）。

- **角色一致性库**（`createCharacter` / `characterRef`）：
  - `main/database/index.ts`：新增 `canvas_characters` 表（项目级角色库）。
  - `main/services/canvas.ts`：`listCharacters` / `createCharacter` / `deleteCharacter` CRUD。
  - `main/ipc/index.ts`：`canvas:saveNodeVideo` / `saveNodeFrames` / `listCharacters` / `createCharacter` / `deleteCharacter`。
  - `views/canvas/nodes/CreateCharacterNode.vue`（新）：角色名 + 描述（或上游文本）→ 生成定妆图并入库，输出 image。
  - `views/canvas/nodes/CharacterRefNode.vue`（新）：从角色库下拉选角色，输出其定妆图作为下游参考图。
  - `views/canvas/composables/useWorkflowEngine.ts`：新增 `case 'createCharacter'`（`executeCreateCharacterNode`：生成定妆图 → 入库失败不阻断产出）与 `case 'characterRef'`（纯数据源）。
  - `CanvasEditorView.vue` / `stores/canvas.ts`：注册 6 个新节点、`getDefaultNodeData` 默认值、`cleanNodeData` 复制画布时保留可复用字段并清运行态。
  - **复制项目连角色库一起克隆**：`main/services/canvas.ts` 新增 `cloneCharacters`（复制角色行 + 把定妆图以 `char_{uuid}` 复制到新项目目录）+ `canvas:cloneCharacters` IPC；`stores/canvas.ts` 的 `duplicateProject` 在复制节点前先克隆角色库拿到旧→新映射，`cleanNodeData` 据此把 `characterRef` 节点的 `character_id` / `image_path` 重写到新项目，引用不再悬空。

### 修复

- **流式画布 AI 视频生成完成后账户余额不自动刷新**：`useWorkflowEngine.ts` 的 `applyVideoTaskToNode` 在任务首次进入完成态时调用 `refreshCloudBalances()`（仅「非完成→完成」刷一次），覆盖单节点后台轮询 / 工作流等待 / 重开恢复三条路径，对齐独立视频页与画布抠图节点。此前画布生成视频扣积分后，界面余额需手动刷新才更新（实际扣费由后端按 `sku_key`「完成才扣」处理，金额一直正确）。

---

## [0.7.13] - 2026-05-29

> **直充 + 永久套餐复购 + AI 视频通用服务商 + 画布视频节点**：新增用户按金额/档位充值金币与积分；永久套餐支持再次购买；AI 视频参考素材交互改为「协议能力表」驱动以兼容通用视频服务商；流式画布新增 AI 视频节点（文本 / 图片生成视频，支持图生视频与首尾帧）。

### 新增

- **`src/renderer/src/components/RechargeDialog.vue`** + **`src/renderer/src/views/recharge/RechargeView.vue`**：用户直充（选金币/积分 + 快捷档位 / 自由金额 + 实时到账预览 + 扫码支付，复用支付轮询/二维码），用户中心头部新增「充值」入口；`utils/cloud-api.ts` 新增直充配置与下单接口。

- **流式画布 AI 视频节点**（`aiVideo` + `videoResult`）：
  - `views/canvas/composables/useNodeTypes.ts`：dataType 扩展 `video`；新增 `aiVideo`（文本 / 参考图 / 首帧 / 尾帧 4 输入 handle）与 `videoResult` 节点。
  - `views/canvas/composables/useVideoCatalogSelection.ts`（新）：复用云控端 L2 catalog 的计费档 / 能力选择逻辑（catalog 模块级缓存 + 选项推导 + SKU 匹配 + 归一化）。
  - `views/canvas/composables/useVideoTaskPolling.ts`（新）：模块级单例轮询（单 timer + 多任务登记 + 终态自动注销）。
  - `views/canvas/nodes/AiVideoNode.vue`（新）：规格选择 + 进度 + 视频播放 + 模式驱动动态 handle（图生视频 `image-input`，首尾帧 `first/last-frame-input` 分槽）+ 重开恢复轮询 + 下载完成回填 + 删记录复位。
  - `views/canvas/nodes/VideoResultNode.vue`（新）：实时读取上游视频产物展示。
  - `views/canvas/composables/useWorkflowEngine.ts`：新增 `case 'aiVideo'`（按 handle 收图 → 参考图懒上传 → 提交 → 轮询）；单节点后台轮询 / 工作流等待双模式；`getUpstreamData` 支持 video 上游、`getUpstreamImagesByHandle` 按槽收图。
  - `main/services/video-generation.ts` + `main/database/index.ts`：视频落盘支持画布上下文，画布产物落 `canvas/{projectId}/{nodeId}_{taskId}.mp4`（对齐画布生图），`video_generations` 加 `canvas_project_id` / `canvas_node_id` 列；下载调度天然复用。
  - `main/services/canvas.ts`：删画布节点级联软删其视频创作记录。
  - `CanvasEditorView.vue` / `HandleCreateMenu.vue` / `stores/canvas.ts`：注册节点、handle-video 样式与连线校验、点 output 一键创建 `videoResult`、复制画布保留规格清运行态。
  - 计费沿用「完成才扣 / 失败不扣」，落盘与创作记录与独立视频页一致。

### 变更

- **`src/renderer/src/views/plans-store/PlansStoreView.vue`**：永久套餐放开复购，已拥有时购买按钮显示「再次购买」（每次充一份额度）。

- **`src/renderer/src/views/video/AiVideoView.vue`**：
  - 新增 `PROTOCOL_CAPABILITIES` 协议能力表（`assetTypes` / `firstLastFrameByImage`），替代散落的 `provider_protocol === 'veo' / 'seedance'` 硬编码判断。
  - `referenceSubmitReady` / `referenceHint` / `referenceGuide` / `referenceAccept` / `normalizeReferenceAssetList` / `normalizedReferencePayload` / `onPickReferences` 改为按 `protocolCapability(provider_protocol)` 取能力。
  - 新增 `openai_video` 协议支持图片 + 视频参考素材；未知协议回落仅图片，行为安全。
  - **AI 视频规格精简（L2 计费维度模型）**：规格选择改为「计费档（取自 SKU 锁定维度）+ 自选维度（取自模型 `supported_*`）」——`modeOptions` / `durationOptions` / `resolutionOptions` / `aspectRatioOptions` 按 `skuLocks()` 判断取自 SKU 或模型能力；`selectedSku` 仅按 SKU 锁定的计费维度匹配；`submitTask` 改传用户自选的模式/时长/清晰度/比例。修复 Seedance Fast、GROK 此前无可用规格，以及 Seedance Fast 误含 1080p 的问题。

---

## [0.7.11] - 2026-05-28

### 修复

- AI 视频参考图用途选择后会正确保存，不再回到通用参考。

### 变更

- AI 视频页面去掉重复标题，界面更简洁。

---

## [0.7.8] - 2026-05-23

> **灵感广场默认源切换**：移除百度文心 ERNIE 兜底数据，桌面端灵感广场统一只读云控端自定义灵感。

### 变更

- **`src/main/services/inspiration.ts`**：
  - 删除 `ERNIE_API`、`totalPages`、`mapErnieItem`、`fetchErnieInspirations`、`getInspirationConfig`。
  - `fetchOnlineInspirations` 直接转发到 `fetchCustomInspirations`，不再依赖云控端 `publicConfig` 判定来源。
  - `categories` 字段从 optional 改为 required（云端始终返回数组，即使为空）。

- **`src/main/ipc/index.ts`**：
  - 删除 `imageGen:getInspirationConfig` IPC handler（preload 未暴露此 API，删除无副作用）。

- **`src/renderer/src/views/image-gen/InspirationView.vue`**：
  - 删除「换一批」按钮与对应 SVG。
  - 删除 `isCustomSource` 状态及其分支逻辑。
  - 删除 `DEFAULT_CATEGORIES = ['人物', '风景', '动漫', '设计', '创意']`，`displayCategories` 直接返回云端 `dynamicCategories`。
  - 删除 `refreshRandom` 函数。
  - 分页控件常驻：`v-if="!loading && total > pageSize"`。
  - 空状态文案改为「尝试切换分类或翻页查看更多灵感」。
  - `fetchOnline` 简化为直接读取云端返回值。

- **`src/renderer/src/views/plans-store/PlansStoreView.vue`**：
  - 套餐商城新增分类切换，套餐列表和套餐对比表按当前分类同步过滤。
  - 套餐卡片不再显示套餐编码，分类名会在套餐名称下方辅助展示。

- **`src/renderer/src/components/MyPlansBox.vue`**：
  - 用户中心「我的套餐」移除剩余天数进度条，套餐卡片信息更简洁。

- **`src/renderer/src/views/user-center/UserCenterView.vue`**：
  - 「退出登录」移动到用户中心顶部右侧，与「查看明细」同排展示。
  - 「退出登录」改为次要按钮红色文字样式，并适配深色模式。

- **`src/renderer/src/views/creative-templates/components/TemplateUseModal.vue`**：
  - 创意模板未填写的非必填字段不再进入最终提示词，避免生图时带入原始字段占位内容。

- **`src/main/services/creative-template.ts`**：
  - 本地模板提示词渲染同步过滤空的非必填字段，保持预览、复制和填入生图结果一致。

### 兼容性

- 老云控端（1.5.13 及以下）的 `publicConfig` 返回值 `source` 字段被本版桌面端忽略，行为一致：直接走云端分页。
- 新云控端（1.5.14+）的 `publicConfig` 写死返回 `source: 'custom'`，与本版桌面端的行为完全对齐。
- 升级后若云控端没有审核通过的灵感，灵感广场会显示空，可在云控端后台录入或开启共享灵感库。
- 套餐商城分类切换依赖云控端 `/client/plans` 返回套餐分类字段；旧接口未返回分类时仍会按全部套餐展示。

---
