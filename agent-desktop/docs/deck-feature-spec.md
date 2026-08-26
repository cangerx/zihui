# AI Deck（设计/PPT/视频）原生功能 — 完整实施规格

## 1. 文档目的与范围

### 1.1 目的

本规格为 `agent-desktop`（Electron 31 = Node 20 + Chromium 126，Vue 3 渲染层 + Node 主进程，跨 Win/Mac，better-sqlite3）新增一个 **app 原生功能模块「deck（设计/PPT/视频工作台）」**。它把参考项目 `huashu-design`（设计 skill）与 `presenton`（开源 AI PPT 系统）的能力，以**完整、不降级、不分阶段**的原生形态植入，供研发团队直接排期开发。

### 1.2 范围

| 范围内 | 范围外 |
| --- | --- |
| deck 的结构化生成 / 可编辑 PPTX / PDF / HTML-IR 预览 / 模板主题 / 逐页配图 / 语义图标检索 / 信息图 / 可点击原型 / 设计评审 / 反 AI-slop 质量 / GIF / MP4 / 解说视频，共 14 项满血能力 | 任何外部 Python / Node CLI 依赖；presenton 的 Python 运行时 |
| 桌面端五段式落地（路由+侧栏 / pinia store / preload 命名空间 / 主进程 IPC / 主进程 service） | skill 形态落地 |
| 云控端 ffmpeg / 模板(pptdemo) 资产管理、TTS 供应商独立管理页、客户端音频任务接口与计费 | LLM 供应商体系内塞 TTS、deck 子页内塞 TTS |
| ffmpeg/ffprobe / MiniLM 权重 / **模板包** 统一按需云缓存（上游母 CDN → 独立部署云控端 → 桌面端三层，见 D11）、mac ad-hoc 自签配方 | 上架商店、开启 hardenedRuntime（本期前提为不上架/不开）；模板内含任意可执行 JS（仅声明式数据） |

### 1.3 读者

研发团队（桌面端 Electron/Vue、云控端 PHP Laravel + React），用于直接排期开发。

---

## 2. 设计原则与硬约束

### 2.1 设计铁律（来自 CLAUDE.md，全模块贯穿）

- 禁用 emoji。
- 禁用 AI 风格花哨/渐变彩色图标（侧栏 `IconDeck.vue` 为简洁线性图标）。
- 弹窗只加阴影，不加背景遮罩（去掉 `bg-black/50` 等半透明遮罩层）。
- 保持简洁、专业的设计风格。

### 2.2 运行时硬约束

| 编号 | 约束 |
| --- | --- |
| H1 | 用户机大概率无 Python / 无 Node CLI；app 是 Electron（内置 Node 20 + Chromium 126）。所有能力**零外部 python/node 依赖**；presenton 的 Python 逻辑一律 TS 重写；**禁止 shell-out python**。 |
| H2 | 纯 JS 库（pptxgenjs / pdf-lib / gifenc / @resvg/resvg-js）在主进程直接跑；HTML 渲染/导出用 Electron 离屏 BrowserWindow（offscreen）+ `webContents.printToPDF` / `capturePage` / `executeJavaScript`（读 `getComputedStyle`）。这三个 API 仓内目前**零使用**，是核心新模块。 |
| H3 | 唯一需要外部二进制的是视频/音频编码（ffmpeg/ffprobe），走"按需下载"模型。GIF 用 gifenc 纯 JS，**不需 ffmpeg**。 |
| H4 | 落地形态 = app 原生功能，严格对齐现有 image-gen/canvas 的"五段式"范式。**不做 skill**。 |
| H5 | 数据库 Migration 铁律（见 2.3）。 |
| H6 | **不降级**：语义图标检索必须 onnxruntime-node + MiniLM 真向量检索（失败回退 JS cosine，绝不退化关键词）；视频/解说全做。 |
| H7 | **不分阶段**：呈现完整目标架构与全部模块，禁止 P0–P5 之类阶段/降级表述。仅可有"模块技术依赖关系"附录（纯依赖图，非阶段）。 |
| H8 | 全文简体中文；代码标识符英文。 |

### 2.3 Migration 铁律

1. 已发布的 migration 文件，永远**不修改、不删除、不重命名**。
2. 废弃表/字段：写新 migration 用 `dropColumn` / `dropIfExists`。
3. migration 里**只用** `Schema::` 和 `DB::` 原生 API，**不 import 业务 Model**。
4. 云端整包永远带 `database/migrations/` 全量目录。

桌面端 sqlite 侧对应规则：`schema.sql` 仅追加新表，`runMigrations` 只用 `ALTER ... ADD COLUMN` 增量加列，已发布表结构不破坏性变更（参见 `database/index.ts:61-79 initSchema/runMigrations`、`:186-247 ALTER 加列`）。

---

## 3. 已锁定决策清单

> 以下逐条为不可逆决策，开发期不得擅自降级或合并。

| 编号 | 决策项 | 锁定结论 |
| --- | --- | --- |
| D1 | 落地形态 | app 原生功能 deck，五段式范式，**非 skill** |
| D2 | 运行时底座 | 复用 Electron 内置 Node 20 + Chromium 126，**零外部 python/node** |
| D3 | ffmpeg 交付 | 走统一三层资源模型（D11）：上游手工传 `your-cdn-domain.example.com/ffmpeg/{平台-arch}/` → 各独立部署云控端检测缺失→一键从上游母 CDN 拉取并**首次自算 SHA256 固化** → 桌面端从**其绑定的云控端 API** 拉取 + SHA256 强校验后落盘；**桌面端不直连母 CDN** |
| D4 | MiniLM 权重 | 走统一三层资源模型（D11），首次用图标检索时按需拉取，落 `getRootDir()/bin/models/` |
| D5 | 语义图标检索 | onnxruntime-node + all-MiniLM-L6-v2（dim=384）+ sqlite-vec vec0 KNN，失败回退 JS cosine |
| D6 | TTS key | 留云控端，服务端代理调用，端**永不持 key** |
| D7 | TTS UI | 云控端**独立"语音合成/TTS"管理页**（`TtsProviderController` + `TtsProviders.tsx`，挂 AdminLayout group-ai 组，独立 `tts_providers` 表）；**不并入 LLM 供应商体系**（会污染 type 白名单与 `/v1` 规范化），**不塞 deck 子页** |
| D7.1 | TTS 档位 | 三档 = 豆包预设 / OpenAI 兼容 / 通用模板；**明确不支持** 阿里腾讯 HMAC 签名、Azure SSML+换 token、所有流式/WebSocket |
| D7.2 | TTS key 存储 | 明文入库（`$hidden` + mask，与现有 provider 一致） |
| D7.3 | TTS 计费 | 按字符（复用通用 `billing_rules`） |
| D8 | 音频留存 | 即拉即用，deck 删除时级联清理 |
| D9 | mac 解说 | 本期**一并开发**，走 ad-hoc 自签配方；前提 = 维持不上架/不开 hardenedRuntime |
| D10 | 打包前置（依赖清单卫生） | `pptxgenjs`@4.0.1 / `@resvg/resvg-js`@2.6.2 **已在 `package-lock.json` 与 `node_modules` 实装**（`@resvg` 已被 `scripts/gen-icon.js` 在用），但 `package.json` dependencies **未显式声明** → 风险是按 package.json 重生成 lock 时丢包（**非阻断级**，npm ci 仍会装）。动作：**补回 dependencies 并锁版**；另需新装 `pdf-lib`、`onnxruntime-node`、`zod`（`pdf-parse` 为解析库非导出库，并存不冲突） |
| D11 | **统一资源按需云缓存（三层）** | ① **上游母 CDN**（`your-cdn-domain.example.com/{ffmpeg,pptdemo,models,…}`，原厂掌控）：原厂手工上传 ffmpeg/MiniLM/模板等全部资源，唯一权威源。② **云控端**（分发给他人、各自独立部署、各有域名）：后台检测资源是否本地存在，缺失则点按钮**从母 CDN 拉取**到自己服务器落盘（首次自算 SHA256 固化）；云控端**只读母 CDN、从不回写**。③ **桌面端**：从**它绑定的那个云控端域名**按需拉取 + SHA256 强校验 + 缓存落盘，**永不直连母 CDN**。ffmpeg / MiniLM / 模板包统一走此模型 |
| D12 | **模板体系** | 采 presenton 式**受控模板**（三件套 = 声明式 HTML 骨架 + Zod schema + 默认数据，**模板是数据不是可执行代码**）；**批量移植 presenton 全 217 套**布局再逐个改造为「合规（内置 html2pptx 约束）+ 好看」；app 内置 3-5 套基础模板保离线可用，其余按需云缓存 |
| D13 | **模板按需云缓存** | 走 D11 三层模型（资源类型 `pptdemo`）。**元数据与渲染包分离**：manifest（全量模板元数据：id/名称/适用场景/schema/缩略图/version/sha256，轻量，始终缓存供 LLM 选型与用户浏览）+ 渲染包（重，用到哪套拉哪套）。落**设备级** `getRootDir()/templates/{id}/{version}/`；按 `X-OEM-Project-Key` 做 OEM 维度隔离；version 变化触发重拉 |
| D14 | **PPTX 质量路线（治本）** | 可编辑 PPTX **不靠任意 HTML→pptxgenjs 乱翻译**（那是导出"垃圾"的根源），而靠 **presenton 式受控模板【为导出而设计】→ DOM 天生≈100% 通过 html2pptx 校验 → 确定性字段映射 → 高保真且真可编辑**。**PPTX 与 HTML/PDF 平级核心、不降级**；**全部模板严格可编辑、不做整页 PNG 兜底**（D16 字体风险随之接受） |
| D15 | **"好看"根因** | = **受控结构（presenton 模板 + schema 槽位/字数上限防溢出）× 设计方法论（huashu 选择无效铁律 + 三套并行逻辑 + 反 AI-slop 黑名单 + 40 风格库 + 出版物 grammar + 5 维评审）** 两层叠加；导出引擎不负责好看，**好看由渲染端承载、导出端忠实搬运**（详见 4.4） |
| D16 | **字体策略（含回落最优解）** | **不随包内置字体，PPT 端回落系统字体**（安装包小）。**字体三重保险**消解回落错位风险（取代 PNG 兜底）：① 每个导出文本框启用 pptxgenjs `fit: 'shrink'` 溢出自动收缩（OOXML `normAutofit`）→ 目标机字体替换变宽时 PowerPoint **自动缩字到框内，文字不溢出、仍可编辑、最坏略小**；② 跨平台字体栈（拉丁用两端都自带的 Arial/Helvetica/Georgia，中文给常见名 + 稳妥回退栈，CJK 近等宽替换重排轻）；③ 度量驱动 + 充裕留白 + schema 字数上限 + 导出前逐页 `getBodyDimensions` 溢出校验（开发回归门）。详见 6.2 |

---

## 4. 总体架构

### 4.1 三端协同总览

```
┌─ 上游母 CDN (your-cdn-domain.example.com, 原厂掌控) ───────────────┐
│ 原厂手工上传: ffmpeg(GPL完整静态构建) / MiniLM 权重 /     │
│ 模板包(pptdemo) → /{ffmpeg,pptdemo,models}/...           │
└──────────────────────────┬──────────────────────────────┘
            各云控端检测缺失→点按钮拉取(只读母CDN, 从不回写)
┌─ 云控端 (分发给他人独立部署, 各自域名) ──────────────────┐
│ PHP8.0 Laravel + React/Vite/AntD + MySQL8.0              │
│  ├ 资源资产: ffmpeg / 模板(pptdemo) 拉取+首次自算SHA256固化│
│  │   + 本端 manifest.json + 管理 Tab                     │
│  ├ TTS 独立管理页 tts_providers + 适配器(Doubao/OpenAi/Generic)│
│  ├ 客户端音频任务 /api/client/audio/tasks(+轮询)          │
│  └ GatewayRouter 服务端选 key + 计费 + 限流 + 熔断        │
└──────────────────────────┬──────────────────────────────┘
     桌面端对接"它所属的那个云控端域名"(云端 JWT + X-OEM-Project-Key)
┌─ 桌面端 agent-desktop (Electron31) ──────────────────────┐
│  renderer(Vue3) ─ preload(deck:/ffmpeg:) ─ main(IPC+svc) │
│  deck svc: generator/html-ir/deck-templates/             │
│            offscreen-renderer/pptx-exporter/...          │
│  资源管理器: 从【其绑定云控端】按需拉 ffmpeg/MiniLM/模板包 │
│            + SHA256强校验 + 缓存落盘(getRootDir)          │
│  零外部 python/node; 纯JS库主进程直跑; 离屏渲染出PPTX/PDF  │
└──────────────────────────────────────────────────────────┘
```

### 4.2 桌面端进程内分层

```
renderer (Vue3)
  router/index.ts ── /deck(DeckListView) /deck/:id(DeckWorkbenchView)
  MainLayout.vue  ── allNavItems "AI创作"组 + IconDeck.vue
  stores/deck.ts  ── 状态机(照搬 image-gen)
        │ window.api.deck.invoke / onProgress / onOutlineStream
        │ window.api.ffmpeg.invoke / onProgress
preload/index.ts  ── deck 命名空间 + ffmpeg 命名空间
        │ ipcRenderer.invoke('deck:*') / ('ffmpeg:*')
main/ipc/index.ts ── registerIpcHandlers 注册 deck:* / ffmpeg:*
        │            wrapWithEpoch 代次守卫
main/services/deck/* ── 编排/渲染/导出/视频/解说/检索/持久化
        └─ better-sqlite3(schema.sql 新增4表) + sqlite-vec vec0
```

### 4.3 核心新增能力（仓内零先例）

| 能力 | API | 仓内现状 |
| --- | --- | --- |
| 离屏 HTML 渲染 | `new BrowserWindow({ show:false, webPreferences:{ offscreen:true }})` | 零使用 |
| 矢量 PDF | `webContents.printToPDF` | 零使用 |
| 帧捕获 | `webContents.capturePage` | 零使用 |
| 布局度量读取 | `webContents.executeJavaScript`（读 `getComputedStyle`/`getBoundingClientRect`） | 零使用 |

### 4.4 "好看"的根因（受控结构 × 设计方法论）

> 整套方案的质量基石（决策 D15）。参考项目（huashu/presenton）产出的 PPT 好看，根因是两层叠加，**与导出引擎无关**——好看由渲染端承载，导出端只忠实搬运。

| 层 | 来源 | 内容 | 决定 |
| --- | --- | --- | --- |
| **结构层** | presenton | 三职合一模板：每布局 = Zod schema 定义槽位 + **字数 min/max 上限防溢出** + 默认数据 + 固定画布 DOM。LLM **只填符合 schema 的结构化数据、不写自由 HTML**，元素位置/间距/字体/配色由人工精修模板写死 | 下限、稳定、可确定性导出 |
| **方法论层** | huashu | 选择无效铁律 + 三套并行逻辑（秒数轮盘破 LLM 偷选安全极简 / 获奖案例锚定 / 顶级设计师哲学）+ 反 AI-slop 黑名单 + 40 风格库 + 出版物 grammar + 视觉主角轮换 + 5 维评审 | 上限、品味、去 AI 味 |

> 旧"垃圾 PPT"来自一个**已删除的、与本方案技术路线无关的旧技能**（非 pptxgenjs、非参考项目），其问题是这两层都没有。本方案两层都移植：结构层 → 5.8 受控模板；方法论层 → `deck-prompts/` 资产（能力 11）。

---

## 5. 桌面端 deck 功能

### 5.1 能力全集（14 项，满血）

> 仅 **MP4(13)** 与 **解说视频(14)** 依赖 ffmpeg/ffprobe，其余全部纯 JS / 离屏渲染实现。
>
> 下表「关键复用接入点 / 新建文件」列：标 `(新建)` 者为本方案目标产物（尚不存在）；标 `file:line` / 既有文件名者为仓内既有可复用代码。新建产物与既有复用点分别标注，避免被误读为既有可复用。

| # | 能力 | 满血实现要点 | 关键复用接入点 / 新建文件 |
| --- | --- | --- | --- |
| 1 | 结构化生成（大纲→逐页 JSON/HTML-IR） | presenton 规划逻辑 TS 重写；接 `streamContext.onContent` 流式钩子；`response_format: json_object`；复用信号量/AbortController/assertEpoch 代次守卫/402 计费门控/429 限流 | 既有：`llm.ts:38-44`、`image-generation.ts:24-62`；新建：`deck-generator.ts` |
| 2 | 可编辑 PPTX | **受控模板（5.8/D14）渲染出的合规 DOM** → 离屏 `executeJavaScript` 读 `getComputedStyle`/`getBoundingClientRect` → `layout-extractor` → pptxgenjs 重建**真可编辑形状**（移植 huashu `html2pptx.js` ~1180 行翻译算法，含旋转/阴影/圆角/`data-pptx-merge` 合并文本框；工作量按 ~800 行 `extractSlideData` 移植+重测估，**非伪代码十几行**）；单位 `PT_PER_PX=0.75`/`PX_PER_IN=96`；**放弃 python-pptx**。因模板为导出而设计→DOM 天生≈100% 通过校验→确定性映射→高保真可编辑，**与 PDF 平级、不降级、全严格可编辑无 PNG 兜底** | 移植：huashu `html2pptx.js`；新建：`pptx-exporter.ts`、`layout-extractor.ts` |
| 3 | PDF 导出 | `webContents.printToPDF` 矢量 + pdf-lib 合并/页码/元数据 | 新建：`pdf-exporter.ts` |
| 4 | HTML-IR 渲染预览 | `html-ir` 定义中间表示（语义 HTML + 主题 token）；offscreen-renderer 加载；`capturePage` 出预览；渲染层 `iframe srcdoc` 所见即所得 | 新建：`html-ir.ts` |
| 5 | 模板 & 主题（受控模板核心，见 5.8） | presenton 217 套布局批量移植为**原生受控模板三件套**（声明式 HTML + Zod schema + 默认数据，内置 html2pptx 约束）+ huashu 40 风格库/出版物 grammar 作主题方法论；主题用 CSS 变量层；**按需云缓存**（D13） | 新建：`deck-templates.ts`、`template-manager.ts` |
| 6 | 逐页配图 | 直接复用 `image-generation.ts`（MAX_CONCURRENT=6 信号量/取消/`getOutputDir` 落盘/`cleanupStaleGenerations`）；落 `deck/{deckId}/images/` | 既有：`image-generation.ts:24-62`、`:88-103` |
| 7 | 语义图标检索（满血） | onnxruntime-node + MiniLM embedding 写 sqlite-vec vec0（dim 384 Float32 Buffer，复用 `vector-store.ts` 的 `embeddingToBuffer` + vec0 KNN）；查询 KNN top-k；@resvg SVG→PNG；**失败回退 JS cosine** | 既有：`vector-store.ts`；新建：`icon-search.ts` |
| 8 | 信息图 | LLM 产数据驱动 SVG/HTML，@resvg 栅格化，同流水线 | 既有：`vector-store.ts` + @resvg 栅格化管线；新建：`icon-search.ts` 复用同管线 |
| 9 | 可点击原型 | HTML-IR 带跳转热区，导出自包含 HTML 包 `deck/{deckId}/prototype/` | 新建：`offscreen-renderer.ts` |
| 10 | 设计评审 | huashu `critique-guide` 做 prompt + `capturePage` 截图 + `executeJavaScript` 读布局度量（对齐/留白/层级/对比度）→ 多模态 LLM 评审 → 写 `deck_slides.review` | 既有：`llm.ts`；新建：`offscreen-renderer.ts` |
| 11 | 反 AI-slop 质量 | huashu references 全量（`design-context`/`design-styles`/`content-guidelines`/`animation-best-practices`/`cinematic-patterns` 等）做 prompt 资产，放 `resources/deck-prompts/`，叠加 CLAUDE.md 设计铁律 | extraResources |
| 12 | GIF 动效 | 逐帧 `capturePage` + gifenc（仓内 `GifView` 已用）量化调色板编码；**零 ffmpeg**；对应 huashu `convert-formats.sh` 的 `palettegen`/`paletteuse` | 既有：`GifView.vue`、`gifenc`；新建：`gif-exporter.ts` |
| 13 | MP4 视频 | 离屏逐帧 `capturePage` 出 PNG 序列（对齐 huashu `render-video-seek.js` 的冻结时钟 `__seek(t)` 逐帧，要求动画走 Stage 时钟暴露 `window.__seek`）→ ffmpeg(`-c:v libx264 -pix_fmt yuv420p -crf 18 -preset medium -movflags +faststart`)；**依赖 ffmpeg** | 新建：`video-exporter.ts`、`ffmpeg-manager.ts` |
| 14 | 解说视频 | 分页解说稿 LLM 生成 → 云端 TTS 产 mp3 → ffprobe 测时长对齐 → ffmpeg `concat` 拼接/`anullsrc` 静音段/`sidechaincompress`+`amix`+`afade` 做 BGM ducking 混音 → 与 MP4 合流；**依赖 ffmpeg + ffprobe** | 新建：`narrate-pipeline.ts`、`ffmpeg-manager.ts` |

### 5.2 五段式范式落地

#### 5.2.1 路由 + 侧栏（renderer）

- `router/index.ts` 新增 `/deck`（`DeckListView`）与 `/deck/:id`（`DeckWorkbenchView`：大纲树 + slide 预览网格 + 导出/视频面板 + 评审标注），照 `router/index.ts:83-88` 的 image-gen route 写法，`:id` 写法照 `:206`/`:218`。
- 侧栏 `MainLayout.vue:203-250 allNavItems` 在 `:216-224` "AI 创作"分组挂入 deck 项，新建简洁线性 `IconDeck.vue`（禁 AI 花哨/渐变图标）。
- 预览用 `iframe srcdoc`，所见即所得。
- 弹窗只加阴影，无遮罩；禁 emoji。
- `LowBalanceModal` 复用见 `MainLayout.vue:114-118,166`。

```
renderer/src/
├─ router/index.ts                # 新增 /deck、/deck/:id 两条路由
├─ layouts/MainLayout.vue         # allNavItems 挂 deck
├─ components/icons/IconDeck.vue  # 简洁线性图标(新建)
├─ views/deck/
│   ├─ DeckListView.vue           # 项目列表
│   └─ DeckWorkbenchView.vue      # 工作台:大纲树/预览网格/导出/视频/评审
├─ components/deck/
│   ├─ DeckOutlineTree.vue
│   ├─ DeckSlideGrid.vue          # iframe srcdoc 预览
│   ├─ DeckExportPanel.vue        # pptx/pdf/gif/mp4
│   ├─ DeckNarratePanel.vue       # 解说
│   ├─ DeckReviewPanel.vue        # 评审标注
│   └─ FfmpegRequiredModal.vue    # 克隆 LowBalanceModal(仅阴影/禁emoji/禁AI图标)
└─ stores/deck.ts
```

#### 5.2.2 状态机（`stores/deck.ts`）

- `defineStore` setup 语法，照搬 `image-gen.ts:70-72` 的 `generating`/`progress`/`lastError`/`items`/`inFlight`/`queue` 状态机 + `generate`（`:178-188`）/`cancelGeneration`（`:216-227`）/`listenProgress`（`_unsubscribeProgress` 守护）/`stopListenProgress`（`:270-367`）。
- 出参经 `plain() = JSON.parse(JSON.stringify(...))` 去 reactive（参见 `stores/skills.ts:4-6`）。
- 错误走 `utils/error-message` 的 `translateError`；402 走 `LowBalanceModal`。
- 另订阅 `ffmpeg:progress`，驱动 `FfmpegRequiredModal` 安装进度。

#### 5.2.3 preload（`src/preload/index.ts`）

```ts
// 新增 deck 命名空间(三处前缀 deck: 一致)
deck: {
  invoke: (ch: string, ...a: unknown[]) => ipcRenderer.invoke(`deck:${ch}`, ...a),
  onProgress: (cb) => { /* 注册 deck:progress, 返回 unsubscribe */ },
  onOutlineStream: (cb) => { /* 注册 deck:outlineStream */ },
},
// 新增 ffmpeg 命名空间
ffmpeg: {
  invoke: (ch: string, ...a: unknown[]) => ipcRenderer.invoke(`ffmpeg:${ch}`, ...a),
  onProgress: (cb) => { /* 注册 ffmpeg:progress, 返回 unsubscribe */ },
},
```

照 `preload/index.ts:108-123` imageGen 命名空间写法；最终经 `:349 exposeInMainWorld('api', api)` 暴露。

#### 5.2.4 IPC（`src/main/ipc/index.ts` 的 `registerIpcHandlers`）

注册（`ipc/index.ts:75 registerIpcHandlers`）：

| 通道 | 说明 |
| --- | --- |
| `deck:createProject` / `listProjects` / `get` / `delete` | 项目 CRUD（delete 级联清理落盘与音频） |
| `deck:generateOutline` | 大纲流式生成（推 `deck:outlineStream`） |
| `deck:generateSlide` | 逐页 IR/HTML 生成 |
| `deck:render` | 离屏渲染出预览 |
| `deck:exportPptx` / `exportPdf` / `exportGif` | 纯 JS 导出（不门控 ffmpeg） |
| `deck:exportMp4` / `narrate` | 视频/解说（门控 ffmpeg） |
| `deck:searchIcons` | 语义图标 KNN |
| `deck:critique` | 设计评审 |
| `deck:cancel` | 取消当前任务 |
| `ffmpeg:detect` / `install` / `getStatus` | ffmpeg 探测/安装/状态 |

- 需推 progress 的 handler 用 `BrowserWindow.fromWebContents(event.sender)`（`ipc/index.ts:690-693`）。
- 自动受 `wrapWithEpoch` 代次守卫（`ipc/index.ts:66-79`）。
- 导出用 `dialog.showSaveDialog`（已有范式 `ipc/index.ts:993`/`:1154`）。

#### 5.2.5 service（`src/main/services/deck/*`）

```
src/main/services/deck/
├─ deck-generator.ts        # 编排:大纲→逐页→配图→渲染
├─ html-ir.ts               # HTML-IR 中间表示定义(语义HTML+主题token)
├─ deck-templates.ts        # 受控模板三件套(声明式HTML+Zod schema+默认数据) + huashu方法论
├─ template-manager.ts      # 模板按需云缓存:拉manifest/渲染包, SHA256校验, 设备级落盘, OEM维度
├─ offscreen-renderer.ts    # ★核心新模块:离屏BrowserWindow池化+串行队列+超时销毁
│                           #   printToPDF/capturePage/executeJavaScript + 信号量限流防争GPU
├─ layout-extractor.ts      # 读 getComputedStyle/getBoundingClientRect → 布局度量
├─ pptx-exporter.ts         # layout → pptxgenjs 可编辑形状重建
├─ pdf-exporter.ts          # printToPDF + pdf-lib 合并/页码/元数据
├─ gif-exporter.ts          # capturePage 逐帧 + gifenc 量化编码
├─ video-exporter.ts        # capturePage PNG序列 + ffmpeg libx264
├─ narrate-pipeline.ts      # 解说稿→云TTS→ffprobe→ffmpeg混音→合流
├─ icon-search.ts           # MiniLM embedding + vec0 KNN, 回退 cosine
├─ icon-index-builder.ts    # 设备级首次/版本升级构建图标向量
├─ ffmpeg-manager.ts        # 按需下载/SHA256强校验/mac ad-hoc签名/detect/spawn
└─ persistence.ts           # better-sqlite3 读写 deck 四表
```

`offscreen-renderer.ts` 关键设计：

- BrowserWindow 实例**池化复用**（避免反复创建销毁开销）。
- **串行队列**：渲染请求排队，避免并发争 GPU。
- **信号量限流**：与主窗口、image-generation 共享并发预算。
- **超时销毁**：单次渲染设硬超时，超时强制销毁该离屏窗口并重建，防泄漏。
- `setDeviceScaleFactor` 保证高分屏清晰度。
- **offscreen 模式特性须知**：`offscreen:true` 默认走 CPU 软件合成，`capturePage` 帧率与吞吐受限，叠加高 `deviceScaleFactor` 时内存占用上升；排期视频/批量导出时须按软件合成预估渲染耗时，不可按 GPU 加速估算。
- **就绪栅栏（PPTX/PDF 坐标准确性硬前提）**：`executeJavaScript` 读布局度量前，必须等待 `did-finish-load` + `document.fonts.ready` + 图片 `decode()`/`onload` 完成，否则 `getBoundingClientRect` 拿到 0 尺寸或回退字体度量，导致坐标错位。

### 5.3 五段式生成时序（伪代码）

```text
[renderer] deck.generate(projectId, brief)
   store.generating = true
   window.api.deck.onOutlineStream(chunk => store.outline += chunk)
   → window.api.deck.invoke('generateOutline', { projectId, brief })

[main:ipc] deck:generateOutline  (wrapWithEpoch 包裹, 取 epoch)
   win = BrowserWindow.fromWebContents(event.sender)
   deckGenerator.generateOutline(projectId, brief, {
       epoch, onContent: text => win.webContents.send('deck:outlineStream', text)
   })

[main:svc] deck-generator.generateOutline
   acquireSemaphore()                       // 复用 MAX_CONCURRENT=6
   assertBalance() else throw 402            // 服务端 402 计费门控
   llm.stream({ response_format:'json_object',
                streamContext:{ onContent } })// llm.ts:38-44 钩子
   assertEpoch(epoch)                        // 代次守卫,过期丢弃
   persist deck_projects.outline = json
   releaseSemaphore()

[main:svc] 逐页: for slide in outline.slides
   generateSlideIR(slide) → html-ir.ts
   if needImage: image-generation.generate(...) → deck/{id}/images/
   offscreenRenderer.render(ir.html) → 等就绪栅栏 → capturePage → render_path
   persist deck_slides[...]
   win.webContents.send('deck:progress', { done, total })
```

### 5.4 可编辑 PPTX 重建（layout-extractor → pptxgenjs）

```text
offscreenRenderer.load(slide.html)
await readyBarrier(win)                       // did-finish-load + fonts.ready + 图片解码
metrics = webContents.executeJavaScript(`
   [...document.querySelectorAll('[data-ir]')].map(el => {
     const cs = getComputedStyle(el), r = el.getBoundingClientRect();
     return { tag, text, role, x:r.x, y:r.y, w:r.width, h:r.height,
              fontSize:cs.fontSize, fontWeight, color, background, ... };
   })
`)
for m of metrics:
   xIn = m.x / PX_PER_IN(96)               // px → inch, 喂 pptxgenjs 坐标
   ptSize = parseFloat(m.fontSize) * PT_PER_PX(0.75)  // px → pt, 喂 fontSize
   if m.role === 'text': pptx.addText(...)  // x/y/w/h 传 inch, fontSize 传 pt
   if m.role === 'shape': pptx.addShape(...)
   if m.role === 'image': pptx.addImage(...)
   if m.role === 'table': pptx.addTable(...)
```

**单位常量与用途分层（避免误导手算 EMU）**：

- `PX_PER_IN=96`：px→inch，结果直接喂 pptxgenjs 公共 API 坐标（`addText`/`addShape` 的 x/y/w/h 默认以英寸计）。
- `PT_PER_PX=0.75`：px→pt，结果喂 `fontSize`（pptxgenjs 字号以 pt 计）。
- `EMU_PER_IN=914400`：OOXML 标准换算值，**仅在需绕过 pptxgenjs 直写 OOXML XML 时才用**；常规重建路径走公共 API，EMU 由库内部封装，业务代码不直接消费此常量。

html2pptx 4 条硬约束（**内置进受控模板设计规范**，不是产品降级文案）：

1. 文字必须包 `<p>` / `<h*>`。
2. 不能用 CSS 渐变（模板改纯色或预栅格化 PNG）。
3. 文字标签不能有 `background` / `border` / `box-shadow`（这些只挂 `div`）。
4. `div` 不能 `background-image`（背景大图改 `<img>` 分层）。

> **质量闭环（取代旧"双轨降级"说法）**：因 5.8 的受控模板在设计阶段就内置上述约束，渲染出的 DOM **天生≈100% 通过 html2pptx 校验**，导出是**确定性字段映射**而非逐元素猜语义。html2pptx 会丢的渐变/光影/插画在模板阶段就改纯色或预栅格化 PNG（PNG 在 PPT 里作 picture 仍保真）。故 **PPTX 成片不是"被裁剪的朴素版"，而是"本就为纯色扁平出版物风设计的好看版"，与 PDF 平级、全部严格可编辑、不做整页 PNG 兜底（D14）**。
>
> 反例边界：上一轮审计测得"视觉驱动自由 HTML 直跑 html2pptx 通过率 <30%"，那是**不按约定乱写 HTML** 的代价（每页撞约束 throw）；受控模板从源头规避，把 <30% 在模板层根除。html2pptx 必丢清单见 5.8.1。

### 5.5 数据模型 DDL 草案（`schema.sql` 新增 4 表）

> 遵守 Migration 铁律：仅追加新表；时间列、外键写法**严格对齐现有表既有约定**（`schema.sql:299-310 canvas_projects`、`:312-323 canvas_nodes`、`:205-223 image_generations`）。落盘字段 `*_path` 存相对/绝对路径字符串。
>
> **对齐要点（修订臆断）**：现有所有表的时间列均为 `TEXT NOT NULL DEFAULT (datetime('now'))`（ISO 字符串，非 INTEGER epoch），外键均用**表级独立 `FOREIGN KEY (...) REFERENCES ... ON DELETE CASCADE` 子句**（非列内联 REFERENCES）。本节 DDL 一律按此既有约定书写，保证与全库排序/查询/级联一致。`database/index.ts:30 db.pragma('foreign_keys = ON')` 已开启外键，CASCADE 级联清理可用。

```sql
-- 1) deck_projects(对齐 canvas_projects)
CREATE TABLE IF NOT EXISTS deck_projects (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL DEFAULT '',
  text_provider_id  TEXT NOT NULL DEFAULT '',
  text_model_id     TEXT NOT NULL DEFAULT '',
  image_provider_id TEXT NOT NULL DEFAULT '',
  image_model_id    TEXT NOT NULL DEFAULT '',
  theme_id          TEXT NOT NULL DEFAULT '',
  template_id       TEXT NOT NULL DEFAULT '',
  outline           TEXT NOT NULL DEFAULT '{}',   -- JSON
  status            TEXT NOT NULL DEFAULT 'draft',
  aspect_ratio      TEXT NOT NULL DEFAULT '16:9',
  system_prompt     TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2) deck_slides(对齐 canvas_nodes)
CREATE TABLE IF NOT EXISTS deck_slides (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  layout      TEXT NOT NULL DEFAULT '',
  ir          TEXT NOT NULL DEFAULT '{}',          -- JSON HTML-IR
  html        TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',            -- 解说稿
  image_path  TEXT NOT NULL DEFAULT '',
  render_path TEXT NOT NULL DEFAULT '',
  review      TEXT NOT NULL DEFAULT '{}',          -- JSON
  status      TEXT NOT NULL DEFAULT 'draft',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES deck_projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_deck_slides_project
  ON deck_slides(project_id);
CREATE INDEX IF NOT EXISTS idx_deck_slides_project_sort
  ON deck_slides(project_id, sort_order);

-- 3) deck_assets(对齐 video_generations 落盘字段约定)
CREATE TABLE IF NOT EXISTS deck_assets (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT '',    -- pptx|pdf|gif|mp4|narration|prototype
  local_path  TEXT NOT NULL DEFAULT '',
  file_size   INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending',
  error       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES deck_projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_deck_assets_project
  ON deck_assets(project_id);

-- 4) deck_icon_vectors(对齐 vector_chunks + sqlite-vec)
CREATE TABLE IF NOT EXISTS deck_icon_vectors (
  icon_id         TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  keywords        TEXT NOT NULL DEFAULT '',
  svg_path        TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dim   INTEGER NOT NULL DEFAULT 384,
  embedding       BLOB                            -- Float32
);
-- 配套 vec0 虚表做 KNN(对齐 vector-store.ts 范式)
CREATE VIRTUAL TABLE IF NOT EXISTS deck_icon_vec0
  USING vec0(embedding float[384]);
```

> `deck_icon_vectors` / `deck_icon_vec0` 为**内置资产构建产物**：图标库属内置资产，索引为**设备级缓存**，首次使用 / 版本升级时由 `icon-index-builder.ts` 构建。
>
> **实现修订（已落地）**：`deck_icon_vec0` 这张 `USING vec0` 虚表**不写入 `schema.sql`**，改由 `icon-index-builder.ts` 在加载 sqlite-vec 扩展后于运行时创建——否则 app 启动期 `db.exec(schema.sql)` 在扩展尚未加载时会整体失败（与 `vector_chunks` 的 vec0 同策略）。`schema.sql` 仅含 `deck_projects/deck_slides/deck_assets/deck_icon_vectors` 4 张常规表。`deck_slides` 已加 `updated_at`（内容多次更新需要）。`deck_icon_vectors` 实际列：`icon_id/name/keywords/svg_path/embedding_model/embedding_dim/embedding`。

> **语义图标检索（项7）实现状态（已落地 + 验证）**：
> - 模块：`icon-search.ts`（核心：`buildIconIndex`/`searchIcons`/`renderIconPng`/`iconIndexMeta`，embedder 经 `DeckEmbedder` 依赖注入）、`minilm-embedder.ts`（spec 主路 onnxruntime-node + all-MiniLM-L6-v2，BERT WordPiece + mean-pool + L2 归一，权重缺失抛 `IconEmbedderNotReadyError` 门控）、`icon-embedder.ts`（解析器）、`icon-index-builder.ts`（内置图标→索引，按 model/dim 变更重建）。
> - 内置保底图标：`resources/deck-icons/`（18 枚专业线性单色 SVG + `manifest.json`，`currentColor` 可主题着色；随 `extraResources` 通配进包）。
> - **嵌入器解析（intent-preserving）**：MiniLM 本地优先（离线/免费）→ 权重未就绪则回退 app 既有 `embedBatch` **云端语义嵌入**（KB 同款，仍是真向量，**非关键词**）→ 都不可用才抛门控错误。这忠实 H6「绝不退化关键词」之本意，且解除了「必须先下 MiniLM 权重才能用」的硬阻断。索引级回退仍为 vec0 KNN → 同向量 JS cosine（对齐 H6）。
> - IPC：`deck:searchIcons(query, topK)` → `{ ok, icons:[{id,name,score,png(dataURL)}] }`；权重+云端皆不可用时返回 `{ needEmbedder, reason }`（与 `needFfmpeg` 同构）。
> - 验证：fake 词频 embedder + 真实 manifest 端到端跑通 **JS cosine 全量** 与 **sqlite-vec vec0 KNN** 两条路径，语义排序正确（数据增长图表→chart-bar、团队协作→users、安全防护→shield、分数降序），`renderIconPng` 产出有效 PNG；`tsc -p tsconfig.node.json` 仅余既有无关错误（`ewei-client.ts:422`），`electron-vite build` 通过。

### 5.6 落盘目录约定

```
getDataDir()/deck/{deckId}/        # data-path.ts:102-104 getDataDir
├─ slides/        # 渲染 HTML/IR 临时件
├─ renders/       # capturePage 预览/帧 PNG
├─ images/        # image-generation 逐页配图
├─ video/         # mp4 输出与中间帧
├─ audio/         # TTS 落盘 mp3(deck 删除级联清理)
└─ prototype/     # 自包含可点击 HTML 包

getRootDir()/bin/                  # data-path.ts:77-88 getRootDir(设备级跨账号)
├─ ffmpeg[.exe]
├─ ffprobe[.exe]
└─ models/        # MiniLM ONNX 权重
```

> **绝不**入 `process.resourcesPath` / 安装目录：NSIS 升级卸载会清空；`data-path.ts:162-205 isUnsafeDataDir` 已禁止不安全目录。

### 5.7 依赖与打包

| 动作 | 包 | 说明 |
| --- | --- | --- |
| **加回并锁版** `dependencies` | `pptxgenjs`@4.0.1、`@resvg/resvg-js`@2.6.2 | **已在 `package-lock.json` + `node_modules` 实装、`@resvg` 已被 `gen-icon.js` 在用，但 `package.json` 未声明**（按 package.json 重生成 lock 会丢包，**非阻断级**）；补回并锁版 |
| **新装** | `pdf-lib` | PDF 合并/页码/元数据（与仓内既有解析库 `pdf-parse` 并存，职责不同） |
| **新装** | `onnxruntime-node` | 原生 `.node`，加入 `electron-builder.yml asarUnpack`（`:51-53` 已对 `**/*.node` 与 sqlite-vec 解包） |
| **新装** | `zod` | 模板 schema 定义 + LLM 结构化输出约束（D12 受控模板三件套） |
| 已在仓内 | `gifenc` | GIF 编码（`package.json:25`） |
| 已在仓内 | `sqlite-vec` | vec0 KNN（`package.json:28`） |
| 已在仓内 | `better-sqlite3` | 持久化（`package.json:22`） |

extraResources：

```
resources/
├─ deck-prompts/   # huashu references(design-context/design-styles/
│                  #   content-guidelines/animation-best-practices/cinematic-patterns…)
├─ deck-icons/          # SVG + 中英描述
└─ deck-templates-base/ # 内置 3-5 套基础受控模板(保离线可用; 其余 217 套走按需云缓存,见 5.8)
```

按需云缓存资产（**不打进 app.asar**，从**其绑定云控端**拉、SHA256 校验后落 `getRootDir()/`，见 D11/5.8）：

- ffmpeg/ffprobe GPL 完整构建（win-x64 / mac-x64 / mac-arm64 三套）→ `getRootDir()/bin/`。
- MiniLM ONNX 权重 → `getRootDir()/bin/models/`。
- 模板渲染包（除内置基础模板外的其余约 212 套）→ `getRootDir()/templates/{id}/{version}/`。

> **字体（D16）**：不随包内置字体，PPT 端回落系统字体。模板只用通用/系统可得字体；导出后逐页过溢出校验（见第 10 章字体回落风险）。

### 5.8 模板体系与按需云缓存（受控模板 + 三层资源模型）

#### 5.8.1 受控模板三件套（数据，非代码）

每套模板 = 三件套，**全部是声明式数据，不含任意可执行 JS**（云端下发可执行代码 = 远程代码执行风险，故渲染/抽取逻辑固定写死在桌面端，模板只是数据）：

| 件 | 内容 |
| --- | --- |
| 渲染骨架 | HTML 模板字符串 + `{{占位符}}` 映射 + CSS（用 CSS 变量挂主题）。**内置 html2pptx 4 约束**：文字包 `p/h*`、纯色不用渐变、`background/border/shadow` 只挂 div、背景大图用 `<img>`、图标用预栅格化 PNG（非内联 SVG/web component） |
| Zod schema | 槽位字段 + **字数 `min/max` 上限防溢出** + 枚举；同时充当 LLM 结构化输出约束、组件数据契约、默认数据校验 |
| 默认数据 | 一份合法样例数据，供预览与回退 |

> **来源与人力**：批量移植 presenton 全 217 套布局（D12），逐个重写为上述原生三件套并按约束改造——presenton 模板大量用 `box-shadow`/`border`/`RemoteSvgIcon`，必须替换为纯色/PNG。这是"好看下限"的主要人力成本，可**渐进上架**：框架先就绪、内置少量精品保底，其余陆续传上游 CDN，用户经按需缓存自动获得，无需发版。
>
> **html2pptx 必丢清单（模板设计阶段就规避或预栅格化 PNG）**：CSS 渐变、`div` 背景图、内阴影、伪元素 `::before/::after`、复杂 SVG/web component/filter/混合模式、文字描边/渐变填充。

#### 5.8.2 模板按需云缓存（走 D11 三层模型，资源类型 pptdemo）

```text
上游母 CDN  your-cdn-domain.example.com/pptdemo/{templateId}/{version}.zip + 母 manifest
   │  (各云控端检测缺失→点按钮拉取 + 首次自算 SHA256 固化; 只读不回写)
云控端     public 落盘 + 生成本端 manifest.json (按 X-OEM-Project-Key 过滤可见模板集)
   │  (桌面端从【其绑定云控端 API】拉)
桌面端 template-manager.ts:
   • 选型阶段: 拉 manifest(轻量全量元数据: id/名称/适用场景/schema/缩略图/version/sha256)
       → 缓存, 供 deck-generator 让 LLM 选布局 + 用户浏览缩略图
   • 渲染阶段: 用到某模板 → 查 getRootDir()/templates/{id}/{version}/ 命中且 sha256 匹配则用;
       未命中 → 从云控端 API 拉该渲染包 → SHA256 强校验 → 落盘 → 用
   • 失效: manifest version 变 → 重拉;  OEM: 按 X-OEM-Project-Key 隔离
   • 离线兜底: 命中内置 deck-templates-base 基础模板(封面/要点/图文)保可用
```

- 模板包小（KB 级，非 ffmpeg 的几十 MB），首次使用拉取延迟秒级，**无 chmod/签名/平台-arch 问题**（平台无关数据），比 ffmpeg 简单。
- 下载器/校验与 ffmpeg 同一套（`sync/api.ts:165-187 downloadBlobToFile` + `backup/checksum.ts:8 sha256File`）。
- 落**设备级** `getRootDir()/templates/`（跨账号共享；与账号无关）。

#### 5.8.3 与生成管线的衔接（schema 驱动两阶段）

`deck-generator` 两阶段（presenton 式）：① LLM 出大纲并为每页**从 manifest 选模板 id**；② 取所选模板的 Zod schema（转 JSON schema）作 LLM 结构化输出约束，**LLM 只返回槽位字段数据，`min/max` 生成时即截断防溢出** → 填入模板渲染骨架 → `html-ir` → 离屏渲染。这是"好看且稳定"的工程根因：**元素写死、LLM 只给数据**。叠加 `deck-prompts/`（huashu 方法论，能力 11）拉高审美上限。

---

## 6. 渲染与导出核心

### 6.1 offscreen-renderer.ts（核心新模块）

```text
class OffscreenRenderer {
  pool: BrowserWindow[]            // 池化复用
  queue: Task[]                    // 串行队列
  semaphore(limit)                 // 与主窗争 GPU 限流

  async render(html, { width, height, scale }) {
    win = acquireFromPool()        // offscreen:true, show:false
    win.webContents.setDeviceScaleFactor(scale)   // 高分屏清晰度
    await loadHtml(win, html)      // srcdoc / data url
    await readyBarrier(win)        // did-finish-load + fonts.ready + 图片解码
    withTimeout(T, async () => {
      metrics = await win.webContents.executeJavaScript(readLayoutScript)
      png     = await win.webContents.capturePage()
      pdf     = await win.webContents.printToPDF(opts)
    }, onTimeout = () => destroyAndRebuild(win))
    releaseToPool(win)
    return { metrics, png, pdf }
  }
}
```

风险点（见第 10 章门禁）：

- 仓内零先例，需专测中文字体 + 高分屏。
- offscreen 默认 CPU 软件合成，吞吐/帧率受限，排期须按软件渲染预估耗时。
- `printToPDF ≠ Playwright page.pdf`：自定义像素尺寸/margin/分页/`preferCSSPageSize` 差异；shadow DOM 摊平 + `@page`/`page-break` 需重新验证；真实多页 deck 像素回归。
- 布局读取须过就绪栅栏（字体/图片加载完成），否则坐标失真。
- **本地资源协议**：离屏窗内引用 image-generation 配图须用仓内自定义 `local-file://` 协议（`index.ts:242-303 registerSchemesAsPrivileged + protocol.handle`）或 data url，**非 `file://`**；离屏 session 的 CSP（`onHeadersReceived` 注入 `script-src 'self'`）是否拦截 `executeJavaScript` 注入的 `__seek` 时钟脚本须实测，必要时给离屏窗独立 partition 或放宽 CSP（关系到 capturePage 截图里图片能否显示、MP4 逐帧脚本能否注入）。
- **渲染架构锁定"每页独立 HTML"**（非单文件多 section），规避 shadow DOM `@page` 分页坑（huashu `export_deck_stage_pdf` 已实证摊平易只出 1 页）；池化复用离屏窗渲下一页前须重置上页 DOM/字体缓存。

### 6.2 PPTX 导出（pptx-exporter.ts）

- 输入：`layout-extractor` 读出的布局度量数组。
- 输出：pptxgenjs 重建 `addText`/`addShape`/`addImage`/`addTable`，**真可编辑形状**。
- **字体回落最优解（D16，字体三重保险）**：每个 `addText` 文本框设 `fit: 'shrink'`（溢出自动收缩，OOXML `normAutofit fontScale`）→ 目标机字体替换变宽时 PowerPoint 自动缩字到框内、**不破版且文字仍可编辑**，这是"不内置字体 + 不做 PNG 兜底"前提下消除回落错位的**决定性措施**；叠加 ② 跨平台字体栈（拉丁 Arial/Helvetica/Georgia；中文常见名 + 回退栈）+ ③ schema 字数上限 + 导出前 `getBodyDimensions` 溢出校验。
- 单位用途分层见 5.4（坐标 px/96 喂英寸、字号 px×0.75 喂 pt，EMU_PER_IN 仅直写 XML 时用）。
- 受 html2pptx 4 条硬约束（5.4，已内置进受控模板设计规范）。
- 输入来自 5.8 受控模板的合规 DOM → 确定性映射 → 高保真可编辑；**与 PDF 平级、全部严格可编辑、不做整页 PNG 兜底**（D14）。
- presenton 的 HTML→PPTX 转换器是**闭源 PyInstaller python 二进制**（`convert-{platform}`），无可移植源码，**不据此排期**；可编辑 pptx 唯一技术来源 = 自实现（移植 huashu `html2pptx.js`），presenton 仅供受控模板/schema/确定性映射方法论参考。

### 6.3 PDF 导出（pdf-exporter.ts）

```text
for slide in slides:
   await readyBarrier(win)
   pageBuf = offscreenRenderer.render(slide.html).pdf   // printToPDF 矢量
merged = pdfLib.PDFDocument.create()
for pageBuf: merged.copyPages(...)                       // pdf-lib 合并
addPageNumbers(merged); setMetadata(merged, title/author)
write deck/{id}/{title}.pdf  (dialog.showSaveDialog)
```

> **矢量边界说明**：`printToPDF` 对文本与 CSS 矢量元素输出为矢量；但页面内嵌的位图（`capturePage` 截图、image-generation 配图、@resvg 栅格化 PNG）在 PDF 中仍按位图嵌入。故"矢量 PDF"指文本/矢量部分矢量，并非整页全矢量。

### 6.4 GIF 导出（gif-exporter.ts，零 ffmpeg）

```text
frames = []
for t in timeline:                  // 若有动画走 window.__seek(t)
   png = offscreenRenderer.capture(slide, t)
   frames.push(decodeToRGBA(png))
palette = gifenc.quantize(sampleRGBA, 256)   // 对齐 palettegen
enc = gifenc.GIFEncoder()
for f in frames:
   idx = gifenc.applyPalette(f, palette)     // 对齐 paletteuse
   enc.writeFrame(idx, w, h, { palette, delay })
enc.finish(); write deck/{id}/{title}.gif
```

### 6.5 MP4 导出（video-exporter.ts，依赖 ffmpeg）

```text
门控: ffmpegManager.detect() 缺失 → dispatch FfmpegRequiredModal, 中止
for t in 0..duration step 1/fps:
   win.webContents.executeJavaScript(`window.__seek(${t})`)  // 冻结时钟逐帧
   png = capturePage() → frame_%05d.png
spawn(ffmpegAbsPath, [
  '-framerate', fps, '-i', 'frame_%05d.png',
  '-c:v','libx264','-pix_fmt','yuv420p','-crf','18',
  '-preset','medium','-movflags','+faststart', out.mp4
], { shell: false })  // spawn(file, args[]), 绝对路径, 不开 shell
```

> 要求 deck 动画统一走 Stage 时钟并暴露 `window.__seek(t)`（对齐 huashu `render-video-seek.js` 冻结时钟逐帧）。

---

## 7. 视频与解说

### 7.1 解说链路总览（MP4 + 解说）

```text
分页解说稿(LLM, [[cue]] 分段, frontmatter 可逐段覆盖 voice)
   → 云控端 TTS 任务(提交/轮询/audio URL)
   → main.downloadRemoteAudio 静默落盘 deck/{id}/audio/(无另存弹窗,见 7.4)
   → ffprobe 实测每段时长(不信自报) → 构建 timeline
   → 统一转 24000Hz mono mp3(若供应商只给 wav/pcm,或各段编码参数不一致)
   → ffmpeg concat 拼接(见下方编码一致性前提)
   → 与 MP4 合流: anullsrc 静音段 + sidechaincompress+amix+afade(BGM ducking)
   → 输出 deck/{id}/video/narration.mp4
```

> **concat 编码一致性前提（严谨补充）**：`concat -c copy` 只在所有片段编码参数完全一致（同 codec / 采样率 / 声道 / 比特率模式）时才能无错位拼接。供应商返回的 mp3 比特率/采样率可能不一，此时 `-c copy` 仍会时间戳错位；故 timeline 拼接统一**先重编码归一**（`-af aresample` + 统一 `-ar 24000 -ac 1`）再拼接，与"不信自报时长、ffprobe 实测"同等严谨。仅当确认全段参数一致时方可走 `-c copy` 快路径。

### 7.2 ffmpeg 按需交付三层链路（D11 统一资源模型实例）

```
┌ 上游母 CDN (your-cdn-domain.example.com, 原厂掌控) ─────────────────┐
│ 原厂手工上传 GPL 完整静态构建(含 libx264+libmp3lame+ffprobe)│
│ → your-cdn-domain.example.com/ffmpeg/{win-x64,mac-x64,mac-arm64}/    │
└──────────────────────────┬───────────────────────────────┘
┌ 云控端(各独立部署) ───────▼──────────────────────────────┐
│ 检测缺失→"一键拉取": 从母 CDN 下载 + 【首次自算 SHA256 固化】 │
│ + 写资产表 → 生成本端 manifest.json(平台/arch:url+sha256+size)│
│ (只读母 CDN, 从不回写)                                      │
└──────────────────────────┬───────────────────────────────┘
┌ 桌面端 ───────────────────▼──────────────────────────────┐
│ exportMp4/narrate 前 detect()，缺失则从【其绑定云控端 API】 │
│ 拉该平台条目 + SHA256 强校验后落盘(永不直连母 CDN)          │
└──────────────────────────────────────────────────────────┘
```

> **MiniLM 权重、模板包（pptdemo）共用此三层模型（D11）**，仅资源类型路径与落盘目录不同（MiniLM→`getRootDir()/bin/models/`、模板→`getRootDir()/templates/`，见 5.8）。云控端侧资产管理（7.3）通用化为"资源资产"统一支持 ffmpeg / 模板两类。

### 7.3 云控端侧

- 新增 ffmpeg 资产表 + controller + React 管理 Tab（弹窗 `mask=false`）。
- 复用 `ArtifactDownloadService::downloadAndVerify`（边下边 hash）+ `UpdateDirService::atomicReplaceMany`（原子落盘 + `pruneOld` 剪枝）+ `CloudBuildController::refresh()`（按需触发）。
- 落盘目录加入更新包 `robocopy /XD` 排除清单（防膨胀；打包文档 1.6 节有 v1.0.8 从 23MB→111MB 教训）。
- GPL 合规：资产页放源码获取链接 + LICENSE 作发布门禁。

### 7.4 桌面端 ffmpeg-manager.ts

| 子能力 | 实现 |
| --- | --- |
| 通用下载器 | 合并 `sync/api.ts:165-187 downloadBlobToFile`（fetch→pipeline→写 `.dltmp`→原子 rename）+ `backup/format-v1.ts:455-488 边写边校验` / `backup/checksum.ts:8 sha256File` 的边写边算 SHA256；**强制开 SSL 校验**（外网源不可信）；失败重试 + 临时文件保留（大包 80-200MB 无断点续传） |
| detect() | `existsSync(getRootDir()/bin/ffmpeg[.exe])` 与 ffprobe → 返回绝对路径，否则回退 PATH；Windows 加 `.exe`；末尾 `spawn(-version)` 自检确认可执行；**ffprobe 与 ffmpeg 同级必带**（解说测时长依赖） |
| 门控 | **仅 exportMp4/narrate 检测**，缺失 dispatch window 事件 → `FfmpegRequiredModal`（克隆 `LowBalanceModal` + `stores/low-balance` 范式：仅阴影无遮罩/禁 emoji/禁 AI 图标）→ 安装按钮订阅 `ffmpeg:progress`；**GIF/PPTX/PDF/预览/图标/生成不门控** |
| spawn | 用 `spawn(file, args[], { shell: false })` 传绝对路径，**刻意偏离 MCP 范式**：`mcp-server.ts:70-85 spawnServerProcess` 在 win32 下用 `shell: true` 并整行 `quoteWindowsArg`，ffmpeg-manager **不沿用该 shell 路径**，改用不开 shell 的数组传参以规避中文/空格路径与命令注入；`quoteWindowsArg` 工具仅在确需经 shell 时参考 `mcp-server.ts:64-68`；进程树清理 Win `taskkill /pid /T /F`（`mcp-server.ts:277`）、unix `SIGTERM→SIGKILL`；huashu 脚本里写死的裸 `'ffmpeg'`/`'ffprobe'` 全改注入绝对路径 |

### 7.5 平台差异表

| 平台 | arch 选择 | 是否需 chmod | 是否需签名 | 备注 |
| --- | --- | --- | --- | --- |
| Windows | win-x64 | 否 | 否 | 杀软误报时提示加白名单 |
| macOS Intel | `process.arch=x64` → darwin-x64 | 是（0o755） | 否 | x64 无 ad-hoc 签名要求 |
| macOS Apple Silicon | `process.arch=arm64` → darwin-arm64 | 是（0o755） | **是（须带有效签名，含 ad-hoc）** | arm64 要求可执行代码带有效签名，否则被内核拒绝执行 |
| macOS Rosetta | `process.arch=x64` → darwin-x64 | 是 | 否 | Rosetta 下 arch 报 x64，取 x64 构建 |

### 7.6 mac 二进制就绪配方（顺序不能乱：先校验后改字节）

> 以下为**操作语义示意**（用 shell 命令表达每步意图）。实际由 `ffmpeg-manager.ts` 用 `fs.chmodSync` / `spawn(file, args[], { shell: false })` 逐命令执行，**禁止拼接成 shell 字符串交给 shell**（与 7.4 spawn 不走 shell 约束一致）。`codesign` / `xattr` 为 macOS 自带原生工具，spawn 它们不违反 H1（H1 禁的是 shell-out python，非 mac 原生命令）。

```bash
# 1) 按 arch 下载(darwin-x64 / darwin-arm64)
# 2) SHA256 校验(强校验,不符即拒删)
# 3) 解压到 getRootDir()/bin/
tar -xJf ffmpeg-<arch>.tar.xz -C "$ROOT/bin"
# 4) chmod 0o755(两 arch 都要,否则 EACCES); chmod/解压不破坏既有签名
chmod 755 "$ROOT/bin/ffmpeg" "$ROOT/bin/ffprobe"
# 5) 仅 arm64: arm64 要求可执行代码带有效签名(含 ad-hoc)否则被内核拒绝执行;
#    官方静态构建通常已自带 ad-hoc 签名, 故先 codesign --verify,
#    仅在校验失败(无签名/签名失效)时才 ad-hoc 重签。
#    x64 构建无 ad-hoc 签名要求, 本步仅 arm64 执行。
#    (/usr/bin/codesign 是 stock macOS 自带, ad-hoc 签名无需开发者账号/Xcode)
codesign --verify "$ROOT/bin/ffmpeg" \
  || codesign --force --sign - "$ROOT/bin/ffmpeg"
codesign --verify "$ROOT/bin/ffprobe" \
  || codesign --force --sign - "$ROOT/bin/ffprobe"
# 6) 去隔离属性(忽略失败): 通常不带 quarantine(取决于落盘进程的 quarantine 继承);
#    app 本体未签名/未公证时其子进程下载落盘一般不打 quarantine, 但分发链路
#    携带继承时仍可能命中, 故 xattr -d 失败忽略即可(spawn 自身进程不经 Gatekeeper GUI 评估)
xattr -d com.apple.quarantine "$ROOT/bin/ffmpeg" 2>/dev/null || true
# 7) spawn(-version) 自检
"$ROOT/bin/ffmpeg" -version
```

> 必须用**静态构建**（避免 dylib 也要签名定位）。mac 未来上架开 hardenedRuntime 会反噬（library validation 拒未签名子二进制），需预留 ad-hoc 重签 / `disable-library-validation` entitlement。配方整体对应 `azure-pipelines.yml:40 CSC_IDENTITY_AUTO_DISCOVERY=false`（应用本体不签名）的整体不签名前提。

### 7.7 许可证（GPL 合规）

- **致 GPL 主因是 `libx264`（GPLv2+）**：ffmpeg 构建带 `--enable-gpl` 并静态链接 libx264 后，整套 ffmpeg 受 **GPLv2+** 约束。`libmp3lame` 自身为 **LGPL**（非致 GPL 主因），但与 x264 静态合并入同一二进制后随整体一并受 GPL 约束。
- 转存/下发 = 再分发，须：
  - 提供对应**源码**（含 configure 参数）。
  - 保留 LICENSE。
  - 不加额外限制。
  - **不得将该 GPL ffmpeg 以静态/动态链接方式并入闭源主程序**。本方案以独立外置二进制 + `spawn` 子进程调用规避链接传染，但再分发义务（源码 + configure 参数 + LICENSE）**不因外置而免除**。
- 外置下载不进 asar，但**不免除**再分发义务。资产页源码链接 + LICENSE 作发布门禁。

---

## 8. TTS 自定义接口

### 8.1 消费模型

| 约束 | 证据接入点 |
| --- | --- |
| key 留云控端 + 服务端代理 | `llm.ts:210-235 cloud: 前缀走 gateway 用云端 JWT，端不接触真实 key` |
| api_key 仅输出 mask | `CloudProvider.php:9-24 api_key $hidden 无加密(明文)` |
| 服务端选 key + 适配器代请求 | `GatewayRouter` 服务端选 key |
| 402 计费在服务端 | 与 LLM/image gateway 同源 402 门控（参照 `image-generation.ts:946-1092 gateway /images/generations` 的 402 计费/余额拦截、`GatewayController` 计费门控位置） |
| 走视频异步任务范式 | 任务表 + 轮询 + 音频 URL + `downloadRemoteAudio` 落盘 |
| renderer 直接 cloudClient 提交 | 规避 `cloud_model_id` IPC 同步竞态（`image-generation.ts:777 云端模型同步竞态坑`） |

### 8.2 云控端独立管理页

- 新建 `tts_providers` 表（字段见 8.3，遵守 Migration 铁律 `Schema::create`）。
- `TtsProviderController`：照搬 `CloudProviderController` CRUD（`index/store/.../testConnection:153/deepTest:195/fetchModels:242/health:293/recover:382`），`testConnection` 改发 `test_text` 试合成。
- 适配器层 `app/Services/Tts/Adapters/`：
  - `DoubaoTtsAdapter`：四段 body + json-base64 解码。
  - `OpenAiTtsAdapter`：binary。
  - `GenericTemplateAdapter`：按 `body_template` 占位替换 + `responseType` 分支取音频；**明确拒签名/流式**。
- 客户端接口：`/api/client/audio/tasks`（提交带 throttle）+ `/tasks/{id}`（轮询）+ `audioCatalog`（下发音色/SKU/credit_cost；key 全服务端代请求后音频存对象存储返 URL）。
- 前端 `TtsProviders.tsx`：照搬 `Providers.tsx`，按 `preset_type` 动态显隐字段，菜单挂 `group-ai` 加 `/tts`（`AdminLayout.tsx group-ai 菜单`）。
- `frontend/src/services/api.ts` 加 `ttsProviderApi`（仿 `providerApi`）。
- 透传 `X-OEM-Project-Key`。
- **路由顺序**：`routes/api.php` 字面量路由须先于 `/{id}`。

> 不并入 LLM 供应商体系（会污染 type 白名单与 `/v1` 规范化）；不塞 deck 子页。

### 8.3 三档字段表

| 字段 | 豆包预设(doubao) | OpenAI 兼容(openai_compatible) | 通用模板(generic) |
| --- | --- | --- | --- |
| name | provider 显示名 | provider 显示名 | **必填，供应商显示名** |
| endpoint | 默认 `https://openspeech.bytedance.com/api/v1/tts` | `base_url` | 自由填，**不套用 `normalizeApiBase` 自动补 `/v1`** |
| api_key | 露出 | 固定 Bearer | 经 `auth` 配置 |
| voice | `voice_id` | `voice` | 自由输入 |
| cluster | 默认 `volcano_icl` | — | — |
| speed | `speed_ratio` | `speed` | `0.5-2.0` |
| auth | 内部生成 | 固定 Bearer | `{type:header\|bearer\|query, headerName, valueTemplate}` |
| body | 四段固定 | `{model,input,voice,response_format,speed}` | `bodyTemplate` 占位 `{text}{voice}{speed}{format}{uuid}` |
| method | — | — | 默认 POST |
| headers | — | — | 多行 KV |
| responseType | json-base64 | binary | 枚举 `binary\|json-base64\|json-url`（**核心开关不可省**） |
| audioPath | — | — | json 取音频路径 |
| format | mp3 | — | `mp3\|wav\|pcm` |
| 其它 | `reqid=uuid` 与 `uid` 内部生成不暴露 | — | `timeout`/`retry`/`test_text` |

### 8.4 不支持清单（UI 提示引导预设档或自建 OpenAI 兼容反代）

- 阿里 / 腾讯 HMAC 签名 / STS。
- Azure SSML + 换 token。
- 所有流式 / WebSocket（火山双向流 / ElevenLabs WS / Azure SSE）。

### 8.5 桌面端解说链路（cloudClient）

```text
cloudClient.audioCatalog()                      // 仿 cloud-api.ts:296-314 视频任务组
   → 下发音色/SKU/credit_cost
submitAudioTask(chunk)                           // 复用 request() JWT刷新+X-OEM-Project-Key+402拦截
   前置: 按字符 credit_cost 前置余额拦截(参照 AiVideoView.vue:1133 lowBalance.open)
解说稿按 [[cue]] 切 chunk 逐段提交(frontmatter 可逐段覆盖 voice)
   逐 chunk 串行: 补超时/重试/错误码透传(长解说几十次防 QPS 限流)
getAudioTask(id) 轮询 → 拿 URL
main.downloadRemoteAudio(url)                    // 见下方差异说明
   → deck/{id}/audio/
ffprobe 实测每段时长(不信自报) → 构建 timeline
统一转 24000Hz mono mp3 → ffmpeg 重编码归一后拼接(编码不一致禁 -c copy, 见 7.1)
```

> **downloadRemoteAudio 与 downloadRemoteVideo 的关键差异（修订臆断）**：`cloud-video.ts downloadRemoteVideo` 整体是**交互式另存为**流程（`dialog.showSaveDialog` 让用户选保存路径 → 下载 tmp → `copyFileSync` 到用户选定文件，见 `cloud-video.ts:18-49`）。解说音频是后台静默批量落盘，**不可**沿用其另存弹窗。`downloadRemoteAudio` 只复用其**下载内核**（`fetch → pipeline → 写 .tmp → 原子落盘`，与 `sync/api.ts:165-187 downloadBlobToFile` 同构），**去掉 `showSaveDialog` 交互**，直接落 `getDataDir()/deck/{id}/audio/`。

---

## 9. 云控端改造汇总

| 模块 | 新增/改造 | 复用接入点 |
| --- | --- | --- |
| ffmpeg 资产 | 新增资产表 + Controller + React 管理 Tab(mask=false) + 本端 manifest.json；检测缺失→从母 CDN `your-cdn-domain.example.com/ffmpeg` 拉取+首次自算 SHA256 固化 | `ArtifactDownloadService::downloadAndVerify`、`UpdateDirService::atomicReplaceMany`+`pruneOld`+`normalizeTargetSubdir`(platform∈{win,mac} 第44行)、`CloudBuildController::refresh()`、`CloudBuildPullService` |
| 模板资产(pptdemo) | 新增模板资产表 + Controller + React 管理 Tab + 本端 manifest.json；检测缺失→从母 CDN `your-cdn-domain.example.com/pptdemo` 拉取+首次自算 SHA256 固化；按 `X-OEM-Project-Key` 过滤可见模板集 | 复用与 ffmpeg **同一套**资源资产基础设施（`ArtifactDownloadService`/`UpdateDirService`/`CloudBuildController::refresh()`），建议通用化为"资源资产"统一模块 |
| TTS 供应商 | 新建 `tts_providers` 表 + `TtsProviderController` + 适配器层 + `TtsProviders.tsx` | 照搬 `CloudProviderController`/`Providers.tsx`/`providerApi`；`cloud_providers` 迁移 `2024_01_01_000003`+`2026_05_09_100001`、`CloudProvider.php:9-24` 明文 `$hidden` |
| 客户端音频 | `/api/client/audio/tasks`(提交,throttle) + `/tasks/{id}`(轮询) + `audioCatalog` | 媒体平行架构 `video_provider_accounts`+`video_model_specs`+`video_sku_prices`+`video_pricing_rules` |
| 计费 | 按字符复用 `billing_rules` | `GatewayRouter` 选 key + 熔断；`billing_rules` |
| 菜单 | `group-ai` 加 `/tts` | `AdminLayout.tsx group-ai 菜单` |
| 更新发布 | 资产页源码链接 + LICENSE 门禁；落盘加 `robocopy /XD` 排除 | `releases.json schema`、`Updates.tsx`/`HistoryPage.tsx` |
| 路由 | 字面量路由先于 `/{id}` | `routes/api.php` |

> 环境（CLAUDE.md）：云控端 PHP 8.0 Laravel + React(Vite+AntD) + MySQL 8.0 utf8mb4；管理后台 `https://your-admin-domain.example.com`；更新 CDN `your-cdn-domain.example.com`；桌面端 Electron + Vue3。**禁止用 PowerShell 5.x 读写含中文文件**（BOM/编码损坏），用 pwsh。

---

## 10. 风险与合规门禁

| 风险 | 严重度 | 门禁措施 |
| --- | --- | --- |
| 依赖清单卫生（lock 漂移） | 中 | `pptxgenjs`/`@resvg` 已在 lock+node_modules（**非阻断**），补回 dependencies 并锁版 + 装 `pdf-lib`/`onnxruntime-node`/`zod`，验证随 asar 打包（与各模块开发可并行，仅产物前置依赖，非阶段） |
| 离屏渲染仓内零先例 + Win 中文字体 + offscreen 软件合成 | 高 | offscreen-renderer 实例复用/串行队列/信号量限流；设 `deviceScaleFactor` 保清晰度；过就绪栅栏（fonts.ready/图片解码）；专测中文字体 + 高分屏；按软件合成预估渲染耗时 |
| `printToPDF ≠ Playwright page.pdf` | 高 | 自定义像素尺寸/margin/分页/`preferCSSPageSize` 差异；shadow DOM 摊平 + `@page`/`page-break` 重新验证；真实多页 deck 像素回归；内嵌位图仍为位图须知 |
| 可编辑 PPTX 视觉自由度（受控模板内化约束后已收敛） | 中 | 不靠任意 HTML 翻译，靠受控模板为导出而设计→确定性映射（5.8/D14）；渐变/光影在模板阶段改纯色或预栅格化 PNG；全严格可编辑、不做 PNG 兜底 |
| 字体回落错位（D16 不内置字体） | 中 | **决定性措施**：导出文本框一律 `fit: 'shrink'` 溢出自动收缩（`normAutofit`），字体替换变宽时 PowerPoint 自动缩字到框内、不破版且仍可编辑（取代 PNG 兜底）；叠加跨平台字体栈 + schema 字数上限 + 导出前 `getBodyDimensions` 溢出校验。详见 6.2/D16 |
| 模板按需缓存：离线未缓存不可用 / 远程模板 RCE | 中 | 内置 3-5 套基础模板保离线（5.8）；模板为**声明式数据非代码** + HTTPS + SHA256 强校验，规避远程代码执行 |
| presenton 模板移植工作量被低估 | 中 | 217 套需逐个原生重写 + 4 约束改造（box-shadow/SVG icon→纯色/PNG），按"逐个重写+重测"排期；渐进上架降低一次性人力峰值 |
| GPL 合规缺口 | 高 | 源码链接 + LICENSE 就位作发布门禁；外置 spawn 调用规避链接传染 |
| 供应链投毒 | 高 | 首次拉取自算固化 + SSL 校验 + 端强校验不符即拒删 |
| mac 未来上架 | 中 | 文档记"不开 hardenedRuntime"为前提，预留 ad-hoc 重签 |
| 长任务账号守卫 | 中 | service fire-and-forget 容忍 `assertEpoch`；`cleanupStaleGenerations` 清僵尸 |
| 云端计费/限流 | 中 | 复用全局信号量 `MAX_CONCURRENT=6` + `LowBalanceModal`；生成前提示扣费 |
| TTS QPS/长解说 | 中 | 服务端限流 + 重试 + 熔断（GatewayRouter 现成）；任务级重试语义 |
| concat 拼接错位 | 中 | 编码参数不一致时禁 `-c copy`，统一重编码归一（`-af aresample` + 统一 `-ar/-ac`）后拼接 |
| MiniLM 权重数十 MB + ffmpeg 几十 MB | 低 | 按需下载省安装包，落 `getRootDir()/bin` |
| 跨端协同 | 中 | 桌面端视频/解说依赖云控端 ffmpeg 资产管理 + TTS provider/适配器/任务接口/计费，两侧协同排期 |

---

## 11. 模块技术依赖关系（纯依赖，非阶段）

> 本附录仅描述**技术依赖**（A 依赖 B 的产物/接口），**不代表先后排期、不分阶段、不分期**。可并行开发的模块按其依赖就绪即可推进。打包依赖修复与各模块开发可并行（修复就绪前模块可先写代码，仅运行/打包时需依赖到位），此处仅表产物依赖、不表先后。

```
[打包依赖修复]  (产物依赖, 与各模块开发可并行)
   pptxgenjs/@resvg 加回 + pdf-lib/onnxruntime-node 安装
      ├─→ pptx-exporter.ts(需 pptxgenjs)
      ├─→ pdf-exporter.ts(需 pdf-lib)
      └─→ icon-search.ts(需 onnxruntime-node)

[offscreen-renderer.ts]  ←核心,被以下全部依赖
      ├─→ layout-extractor.ts → pptx-exporter.ts
      ├─→ pdf-exporter.ts
      ├─→ gif-exporter.ts
      ├─→ video-exporter.ts
      └─→ deck-generator(render 预览)

[html-ir.ts + deck-templates.ts]
      └─→ offscreen-renderer 加载的内容契约

[deck-generator.ts]
      ├─ 依赖 llm.ts(streamContext.onContent)
      ├─ 依赖 image-generation.ts(逐页配图)
      └─ 依赖 html-ir/offscreen-renderer

[icon-index-builder.ts] → deck_icon_vectors/vec0
      └─→ icon-search.ts(KNN, 失败回退 cosine)
            依赖 vector-store.ts(embeddingToBuffer+vec0)

[ffmpeg-manager.ts]
      ├─ 依赖 云控端 ffmpeg 资产表+manifest API(SHA256)
      ├─→ video-exporter.ts(MP4)
      └─→ narrate-pipeline.ts(MP4+解说)

[narrate-pipeline.ts]
      ├─ 依赖 ffmpeg-manager(ffmpeg+ffprobe)
      ├─ 依赖 云控端 TTS provider/适配器/audio tasks/计费
      └─ 依赖 cloudClient(audioCatalog/submitAudioTask/getAudioTask)

[云控端 TTS] tts_providers + Controller + 适配器 + audio tasks
      └─→ 桌面端解说链路
[云控端 ffmpeg 资产] 资产表 + Controller + manifest
      └─→ 桌面端 ffmpeg-manager
```

---

## 12. 附录：可复用接入点清单（file:line）

> 仅列 BRIEF 给出且经核对命中的接入点，供开发对照，**不臆造行号**。本节均为仓内既有代码；本方案将新建的目标文件不在此列（见 5.1/5.2.5）。

### 12.1 桌面端

| 接入点 | 用途 |
| --- | --- |
| `llm.ts:38-44` | `streamContext.onContent`（"如 AI PPT 大纲流式"） |
| `llm.ts:210-235` | `cloud:` 走 gateway 用 JWT |
| `image-generation.ts:24-62` | `MAX_CONCURRENT=6` 信号量 |
| `image-generation.ts:88-103` | 取消 AbortController |
| `image-generation.ts:1580` | `emitProgress` send |
| `image-generation.ts:946-1092` | gateway `/images/generations`（402 计费/余额拦截同源） |
| `image-generation.ts:777` | 云端模型同步竞态坑 |
| `sync/api.ts:165-187` | `downloadBlobToFile` |
| `backup/checksum.ts:8` | `sha256File` |
| `backup/format-v1.ts:455-488` | 边写边校验 |
| `data-path.ts:77-88` | `getRootDir` |
| `data-path.ts:102-104` | `getDataDir` |
| `data-path.ts:162-205` | `isUnsafeDataDir` |
| `ipc/index.ts:75` | `registerIpcHandlers` |
| `ipc/index.ts:66-79` | `wrapWithEpoch` |
| `ipc/index.ts:690-693` | `BrowserWindow.fromWebContents` |
| `ipc/index.ts:993` / `:1154` | `dialog.showSaveDialog` |
| `router/index.ts:83-88` | image-gen 路由 |
| `router/index.ts:206` / `:218` | 带 `:id` 路由 |
| `MainLayout.vue:203-250` | `allNavItems` |
| `MainLayout.vue:216-224` | "AI 创作"组 |
| `MainLayout.vue:114-118,166` | 挂 `LowBalanceModal` |
| `preload/index.ts:108-123` | imageGen 命名空间 |
| `preload/index.ts:349` | `exposeInMainWorld` |
| `stores/image-gen.ts:70-72` | 状态 |
| `stores/image-gen.ts:178-188` | `generate` |
| `stores/image-gen.ts:216-227` | `cancel` |
| `stores/image-gen.ts:270-367` | listen/stop |
| `stores/skills.ts:4-6` | `plain()` |
| `schema.sql:205-223` | `image_generations`（TEXT 时间列 + 表级 FK 范式） |
| `schema.sql:299-310` | `canvas_projects`（时间列/FK 对齐基准） |
| `schema.sql:312-323` | `canvas_nodes`（表级 FK ON DELETE CASCADE 范式） |
| `database/index.ts:30` | `pragma('foreign_keys = ON')`（佐证 CASCADE 级联可用） |
| `database/index.ts:61-79` | `initSchema`/`runMigrations` |
| `database/index.ts:186-247` | `ALTER TABLE ... ADD COLUMN` 增量加列 |
| `cloud-token.ts:208` | `getCloudApiBase` |
| `cloud-token.ts:132-153` | `fetchWithCloudAuth` |
| `runtime-config.ts:19-31` | `DEFAULT_CONFIG` |
| `mcp-server.ts:64-68` | `quoteWindowsArg`（仅需经 shell 时参考） |
| `mcp-server.ts:70-85` | `spawnServerProcess`（win32 `shell:true` 范式，ffmpeg-manager 刻意不沿用） |
| `mcp-server.ts:277` | taskkill |
| `cloud-video.ts:18-49` | `downloadRemoteVideo`（交互式另存为；解说仅复用其下载内核，去 showSaveDialog） |
| `cloud-api.ts:296-314` | 视频任务组 |
| `AiVideoView.vue:1133` | `lowBalance.open` |
| `GifView.vue` | gifenc 已用 |
| `vector-store.ts` | `embeddingToBuffer` + vec0 |
| `package.json:13-34` | dependencies（`pptxgenjs`/`@resvg` 在 lock+node_modules 但未在此声明→补回锁版；`pdf-lib`/`onnxruntime-node`/`zod` 待新装） |
| `electron-builder.yml:58-63` | win nsis x64 |
| `electron-builder.yml:71-88` | mac zip x64+arm64 |
| `electron-builder.yml:70` | `deleteAppDataOnUninstall` |
| `electron-builder.yml:51-53` | `asarUnpack`（`**/*.node` + sqlite-vec） |
| `electron-builder.yml:89-91` | publish agent-up/releases |
| `azure-pipelines.yml:40` | `CSC_IDENTITY_AUTO_DISCOVERY=false`（应用不签名） |

### 12.2 云控端

| 接入点 | 用途 |
| --- | --- |
| `cloud_providers` 迁移 `2024_01_01_000003`+`2026_05_09_100001` | adapters/config/capabilities/suspended |
| `CloudProvider.php:9-24` | `api_key $hidden` 无加密（明文） |
| `CloudProviderController` `index/store/...` | CRUD 照搬基线 |
| `CloudProviderController::testConnection:153` | 试连 |
| `CloudProviderController::deepTest:195` | 深测 |
| `CloudProviderController::fetchModels:242` | 拉模型 |
| `CloudProviderController::health:293` | 健康 |
| `CloudProviderController::recover:382` | 恢复 |
| `CloudProviderController SUPPORTED_TYPES:27` | type 白名单 |
| `cloud_provider_credentials` | 凭证池 |
| `ProviderCredentialController::present()` | mask |
| `GatewayController` + `GatewayRouter` | 服务端选 key + 适配器 + 熔断 + 计费门控 |
| `video_provider_accounts`+`video_model_specs`+`video_sku_prices`+`video_pricing_rules` | 媒体平行架构 |
| `billing_rules` | 计费 |
| `AdminLayout.tsx` group-ai 菜单 | 菜单挂载 |
| `Providers.tsx`/`Models`/`Assignments`/`Billing`/`VideoManagement` | 前端基线 |
| `frontend/src/services/api.ts` `providerApi` | 加 `ttsProviderApi` 仿照 |
| `routes/api.php` | 字面量路由先于 `/{id}` |
| `ArtifactDownloadService::downloadAndVerify` | 边下边 hash |
| `UpdateDirService::atomicReplaceMany`+`pruneOld`+`normalizeTargetSubdir`（platform∈{win,mac} 第 44 行） | 原子落盘 + 剪枝 |
| `CloudBuildController::refresh()` | 按需触发 |
| `CloudBuildPullService` | 拉取服务 |
| `releases.json schema` | 发布 schema |
| `Updates.tsx`/`HistoryPage.tsx` | 拉取进度列表 |
