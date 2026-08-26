# Agent Admin Changelog

本文档记录 Agent Admin 云控端版本变更历史。版本号遵循语义化版本（SemVer）规范：`MAJOR.MINOR.PATCH`。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

---

## [Unreleased]

## [1.6.43] - 2026-08-24

> **在线更新改走授权端，一键云打包读取授权端当前桌面模板版本。** 无新增 migration，可从 1.6.42 直接覆盖；覆盖后清配置缓存。生产需把 `UPDATE_CHECK_URL` 指向授权端或留空以使用默认。

### 新增

- **在线更新源**：默认从授权端 `/api/updates/admin/version.json` 检查；zip 域名白名单自动包含检查地址与授权端主机。后续把安装包放到 COS 时，发布填 COS 地址，并在 `UPDATE_ALLOWED_ZIP_HOSTS` 加上 COS 域名。
- **一键云打包模板版本**：本地执行后端会读取授权端当前桌面模板版本；远程 SDK 改为 `GET /api/license/desktop-template`。

### 变更

- **后台侧栏**：「直充配置」从「计费与订单」归入「系统设置」；该分组原「系统运维」改名为「系统设置」，「系统配置」与「直充配置」置顶。

## [1.6.42] - 2026-08-22

> **Skills 审核分发与客户端打包迁入云控**。含 Skill 目录与云构建执行账本多条 migration，必须从 1.6.41 在线升级并执行数据库迁移；生产打包默认仍走授权端，需另行 cutover 才切本地 backend。

### 新增

- **Skills 目录**：云控独立「Skills」栏目，从授权端增量同步已审核包，支持分类、推荐、全局上架与桌面目录/短时下载票据。
- **桌面双轨技能库**：云端已审核包与本地未审核技能同页管理；云端安装验签后原子替换，本地包不上传。
- **云构建执行账本**：队列、GitHub 回调、产物抓取与清理可在云控本地闭环（`APP_ENV=local/testing` 或显式 `CLOUDBUILD_BACKEND=local`）。

### 变更

- **打包调用**：云控内部改为可切换 backend；生产 `CLOUDBUILD_BACKEND=auto` 仍默认 remote，回切不改前端契约。
- **授权端打包入口**：默认 `BUILD_PACKAGING_RETIRED=true`，外部 `/api/build/*` 返回 410；表与实现类保留以便回滚。

### 安全与兼容

- 云端 Skill 包须 ed25519 验签；路径穿越、超限与 zip bomb 在授权端扫描、云控镜像和桌面安装三处拒绝。
- 目录与票据密钥只从环境变量读取；升级包不含 `.env`。未配置 `SKILL_REGISTRY_*` / `SKILL_CATALOG_TICKET_SECRET` 时同步与下载跳过，不影响既有页面。

## [1.6.41] - 2026-08-22

> **数字员工岗位模板与受控沉淀云端支持**。含 1 条新增 migration，可从 1.6.40 在线升级；升级流程需执行数据库迁移。

### 新增

- **岗位模板字段**：数字员工支持模板版本、岗位档案、工作流程、验收标准、推荐 Skills 和连接器需求。
- **结构化编辑**：数字员工管理页可维护岗位简介、职责、边界、标准输入、交付物、流程和验收模板。
- **跨端模板契约**：桌面端可以投稿、安装和识别结构化岗位模板；收费模板在用户获得前继续隐藏受保护内容。

### 安全与兼容

- **本地优先升级**：新版岗位模板只生成待确认建议，不静默覆盖用户在桌面端已经沉淀的岗位资产。
- **敏感内容阻断**：桌面端投稿前检查岗位模板和系统提示词中的疑似密钥或凭据。
- **旧模板兼容**：新增字段全部为可选字段，旧数字员工和旧市场模板继续按原有字段工作。

## [1.6.40] - 2026-08-22

> **后台视觉基线与内容运营体验改进**。无 migration、无后端接口变更，可从 1.6.39 直接覆盖升级。

### 新增

- **内容运营工作台**：数字员工、灵感内容和工作流模板统一提供“内容管理 / 共享市场 / 共享审核”导航，复用原页面与路由。
- **后台视觉基线**：新增深墨绿品牌主题、中性页面背景、统一圆角/边框/控件风格，以及侧栏与内容区域的独立滚动结构。

### 修复

- **侧栏展开状态**：修复当前活动栏目点击关闭后立即自动弹回的问题；路径变化后仍会自动展开新页面所属栏目。

### 变更

- **内容运营侧栏**：由十个平铺入口收敛为数字员工、灵感内容、工作流模板和图片风格四个对象。
- **共享内容术语**：跨站公开内容统一称为“共享市场”，跨站审核入口统一称为“共享审核”；本站内容审核职责不变。
- **后台外壳**：侧栏、品牌区、顶栏和内容画布改为稳定全高布局，长菜单可独立滚动，窄屏减少内容边距。

## [1.6.39] - 2026-08-22

> **云控后台信息架构与桌面菜单契约对齐**。无 migration、无新业务依赖，可从 1.6.38 直接覆盖升级。

### 变更

- **后台任务分组**：按管理员实际任务整理工作台、用户与权限、模型与线路、计费与订单、客户端运营、内容运营、文档中心和系统运维，原页面路由保持不变。
- **文档中心独立**：保留文档中心原有栏目及文档分类、文档站设置、文档检索调试、文档问答记录五个入口，不再混入内容运营。
- **产品命名统一**：管理端用户可见的智能体和创意模板统一显示为数字员工和工作流模板。
- **桌面菜单对齐**：菜单配置同步桌面端当前的图片创作、视频创作和更多分组，并保留旧配置读取兼容。

### 修复

- **历史自定义菜单容错**：旧记录缺少排序字段时按默认顺序安全读取，避免菜单配置接口异常。

## [1.6.38] - 2026-08-22

> **视频能力开通与诊断体验改进**。无 migration、无新依赖，可从 1.6.37 直接覆盖升级。

### 新增

- **视频供应商开通向导**：导入模型时补齐可用套餐与计费配置，降低模型已导入但用户不可见的配置遗漏。
- **视频目录诊断**：管理端可按原因查看模型为何未对指定用户展示，覆盖启停、计费、套餐和权限等关键条件。
- **用户能力工作台**：用户详情集中展示权限、套餐与视频模型可见性，便于定位单个用户的开通状态。

### 变更

- **视频任务错误提示**：将常见失败原因整理为更易理解的提示，并保留排查所需的请求信息。
- **权限与导航收敛**：整理管理端权限项和入口文案，保持与实际可配置能力一致。

## [1.6.37] - 2026-08-18

> **浅色工作台官网视觉收口**。无 migration、无新依赖，可从 1.6.36 直接覆盖升级。

### 变更

- **分区背景**：正文改为白 / 浅灰（`#f8f9fb`）交替；「为什么用」「核心能力」铺浅灰衬白卡片，「三点」「下载」铺白底，避免淡紫/暖灰混用。
- **下载召回卡片**：沿用英雄区深紫蓝光晕 + 深色线性渐变，白字与首屏同款按钮，不再用白底灰框。

---

## [1.6.36] - 2026-08-18

> **浅色工作台下载按钮文案缩短**。无 migration、无新依赖，可从 1.6.35 直接覆盖升级。

### 变更

- **官网下载按钮**：浅色工作台英雄区与下载区由「下载 Windows / Mac M系列芯片版 / Mac Intel 芯片版」改为「Windows / Mac M 系列 / Mac Intel」；下载区说明同步缩短。
- **官网设置占位链接**：后台下载 URL 示例改为桌面端 1.1.9 三个安装包文件名，便于对照填写。

---

## [1.6.35] - 2026-08-17

> **官网英雄区文案与高度微调**。无 migration、无新依赖，可从 1.6.34 直接覆盖升级。

### 变更

- **浅色工作台英雄区主标题**：默认改为「好伙伴AI Agent助手」；后台若仍存旧默认「好伙伴」，模板不再用它覆盖首屏。
- **英雄区高度**：由约 `72vh` 调整为约 `85vh`（介于整屏与过矮之间）。

---

## [1.6.34] - 2026-08-17

> **后台登录页品牌化 + 站点 favicon + 官网英雄区缩短**。无 migration、无新依赖，可从 1.6.33 直接覆盖升级。

### 新增

- **站点图标**：`public/favicon.ico` / `favicon.png` / `apple-touch-icon.png`（好伙伴墨绿底白 H）。官网三套模板与浏览器默认 `/favicon.ico` 均指向该图标；不再用 1024px 大图当 favicon（部分浏览器会忽略）。

### 变更

- **后台登录页**：去掉黑底流体特效与默认蓝按钮；改为官网同构深色底 + 蓝紫 CTA `#473bf0` + 好伙伴图标，副标题「管理后台」。登录校验逻辑不变。
- **浅色工作台英雄区**：首屏由整屏 `100vh` 改为约 `72vh`，上下内边距同步收紧。

---

## [1.6.33] - 2026-08-17

> **官网浅色工作台模板上线 + 全员开放自定义模型服务商**。新增 `public/home-workspace/` 模板（后台代号 `workspace`），与桌面端 1.1.3 配套：官网下载按钮读「官网设置」三条下载链接；桌面端检查更新仍走 `public/updates/`。含 1 条幂等 migration（把已有套餐/策略里的 `allow_custom_provider=false` 统一为 true），无新依赖，可从 1.6.x 直接在线升级。升级后需在「官网设置」手动切到「浅色工作台」并填写三条下载 URL；老站点未切模板则官网外观不变。

### 新增

- **官网模板 `workspace`（`HomepageController::TEMPLATES` + `public/home-workspace/index.html`）**：后台「官网设置」可选「浅色工作台」；根路由按 `homepage_template` 加载 `public/home-{template}/index.html`，找不到回落默认模板。下载按钮绑定 `homepage_download_windows` / `homepage_download_mac` / `homepage_download_mac_arm`。
- **内置图标**：`public/home-workspace/assets/icon.png`（好伙伴墨绿底白 H），未上传导航 Logo 时作默认标。

### 变更

- **全员自定义模型（D-18）**：`QuotaService` 默认 `allow_custom_provider=true`；migration `2026_08_17_000001_enable_custom_provider_for_everyone.php` 把已有套餐/`permission_policies` 中该键改为 true，并为缺行套餐补 true。个别用户/分组事后仍可单独关闭。
- **官网设置图位**：浅色工作台模板只展示「左上角 Logo」与「首屏主截图」，不再混入默认模板的 12 个功能截图位。
- **下载链接占位**：后台输入框示例改为 `https://agent.haohuoban.com/updates/` 下 1.1.3 三个安装包文件名，便于对照填写。

---

## [1.6.32] - 2026-08-12

> **新增桌面端「智能体列表页背景图」配置（桌面端外观设置下发）**。无 migration、无新依赖，可从 1.6.x 直接在线升级；桌面端 1.1.1 起应用该背景，老桌面端不解析该字段、向后兼容。

### 新增

- **智能体列表页背景图（`SystemSetting::ALLOWED_KEYS` 新增 `bot_list_background_url` + `SettingController::siteConfig` 下发 `bot_list_background.url`）**：云控端「桌面端设置 → 基础设置 → 桌面端外观」新增上传项（预览 / 更换 / 移除，PNG/JPG/WebP ≤5MB，建议 1920×1080 横向大图），随 `/public/site-config` 下发；桌面端「智能体」页（启动首页）以此为整页 cover 背景，留空回退默认纯色。
- **上传端点 `POST /admin/cloud-build/bot-list-background`（`CloudBuildIconController::uploadBotListBackground`）**：与登录背景图同约束，存 `cloud-build/bot-list-bg/` 子目录，返回绝对 URL。

### 变更

- **`CloudBuildIconController` 去重**：客服图 / 登录页背景 / 列表页背景三个上传端点收敛到私有方法 `uploadSettingImage($request, $subdir)`（原 `uploadCustomerServiceImage` 与 `uploadLoginBackground` 为逐字重复实现），校验与行为不变。
- **后台前端（`pages/DesktopBasicSettings.tsx` + `services/api.ts`）**：外观 tab 新增「智能体列表页背景图」上传项（复用登录背景图交互，`cloudBuildApi.uploadBotListBackground`），随白名单部分保存。

---

## [1.6.31] - 2026-08-12

> **新增「风格管理」（生图风格预设的云端维护与下发）+「自定义菜单」（桌面端侧边栏追加）+「公告插图」（富文本插图上传与展示）+「充值可计入套餐余量」+ macOS 未签名安装包的安装指引与下载名友好化**。风格预设 = 一段命名的提示词片段，后台维护后桌面端各生图入口（AI 生图 / 批量生图 / 画布文生图 / 图生图 / 快捷编排）拉取并拼接到用户提示词尾部；无投稿审核流程，纯后台 CRUD。充值弹窗新增「入账方式」：钱包余额（原行为）或计入指定生效套餐余量（追加 adjust 桶，流水 `plan_adjust`）。mac 安装指引针对未签名包被 macOS 15+ Gatekeeper 判「恶意软件」的既定现状（不办 Apple 开发者账号），给租户可复制的一键安装命令与图文补救步骤。**含 1 条幂等 migration（`style_presets`）、无新依赖、可从 1.6.x 直接在线升级；桌面端配套改动随客户端 1.1.0 发布（桌面端对未部署本版的老云控端 404 自动降级为不显示风格入口，向后兼容）。**

### 新增

- **风格预设表（`database/migrations/2026_08_12_000001_create_style_presets_table.php` + `app/Models/StylePreset.php`）**：`name` / `prompt_fragment` / `sample_image`（可空，空则桌面端显示纯文字卡）/ `category`（手填字符串）/ `sort_order` / `is_enabled`。幂等（`Schema::hasTable` 跳过），仅 `Schema::` 原生 API。
- **后台 CRUD（`app/Http/Controllers/StylePresetController.php`）**：列表（分类/关键词/启停筛选 + 分页）、新建、更新（示例图传新文件才替换并 best-effort 清旧图）、删除（连带清示例图）、`toggle` 启停、`sort-order`、`categories`（既有分类去重，供筛选与表单联想）。示例图走 `StorageService` 上传（`style-presets/` 子目录，PNG/JPG/WebP ≤2MB），文件或 `sample_image_url` 双入参；multipart 更新沿用 POST + `_method=PUT` 伪造惯例。
- **公开拉取接口（`app/Http/Controllers/StylePresetPublicController.php`）**：`GET /api/public/style-presets/list` + `/categories`，免登录（与 `/public/creative-templates/*` 同约定），只回 `is_enabled=true` 按 `sort_order` 排序，数量级为几十不分页，桌面端一次拉全并本地缓存。白标天然隔离：各租户域名下发各自的风格库。
- **后台「风格管理」页面（`frontend/src/pages/StylePresets.tsx`）**：菜单挂在「桌面端设置」分组下（菜单配置旁）。卡片式列表（示例图缩略图 / 名称 / 分类 / 片段 / 排序 / 启停开关）+ 新建/编辑弹窗（示例图上传本地预览、分类 AutoComplete 联想、片段字数统计），弹窗只阴影无遮罩。
- **macOS 安装指引（`frontend/src/components/MacInstallGuide.tsx`）**：共享弹窗组件，按具体 build 的文件名 + 当前域名动态生成两套方案——方案 A 终端一键命令（`curl -LO` 下载不带 quarantine + `ditto -x -k` 解压保符号链接，全程零弹窗）；方案 B 图形安装 + `xattr -cr` 去隔离补救。接入云打包记录页（列表「本地路径」列 + 详情抽屉）与 OEM 项目安装包弹窗（mac 且有关联构建的记录）。
- **macOS 未签名安装包说明模板（`docs/macOS未签名安装包-安装说明模板.md`）**：租户可直接转发给终端用户，占位符 `{{应用名}}/{{下载地址}}/{{zip文件名}}/{{版本}}`，含架构选择说明与 FAQ（第三方解压报「已损坏」、MDM 管控机器等）。

### 变更

- **安装包下载文件名双轨（`HistoryPage.tsx` / `OemProjects.tsx`）**：`<a download>` 另存为改为显示名 `{app_name}-{version}-{arch}-mac.zip` / `{app_name}-{version}-setup.exe`；落盘 slug 文件名不动（`latest.yml` / `latest-mac.yml` 按名引用，动了在线更新会 404）。`app_name`/`app_version` 缺失的老记录自动回退 slug 名。

### 新增（增量 2：桌面端自定义菜单）

- **「菜单配置」页新增「自定义菜单」管理区块（`frontend/src/pages/DesktopMenuConfig.tsx` + `DesktopMenuController` 的 `adminCustomIndex`/`adminCustomUpdate`）**：向桌面端左侧栏追加自定义菜单——菜单名称（≤30 字）、所属菜单组（现有三组或顶级，不支持新建组）、跳转类型（桌面端内部页面 / 外部链接）、外部链接打开方式（系统浏览器 / 应用内窗口）、预置图标（link/page/app/star 四枚，桌面端映射内置 SVG）、排序号与显隐开关。管理区块为**即时整体保存**（增删改后立即整体提交，与上方 overrides 的手动保存区分）；校验失败（非法组 key / 非 http(s) URL / 内部路径非 `/` 开头 / key 重复等）整体 422 拒绝并指明第几条，不静默丢项。
- **存储沿用无 migration 惯例**：`system_settings.desktop_menu_custom_items`（JSON，`SystemSetting` 白名单已登记）；key 由前端生成（`^[a-zA-Z0-9_-]{1,40}$`），后端校验唯一性；`readCustomItems` 对元素做 `is_array` 过滤（防 DB 直写脏数据导致 500）。
- **下发**：`GET /client/desktop-menu` 响应追加 `custom_items`（仅可见项、按 sort 升序，sort/visible 属管理态不下发）；白标天然隔离（各租户域名下发各自菜单）。**桌面端配套改动（侧边栏合并渲染 + `shell:openExternalWindow` 隔离窗口）随客户端 1.1.0 发布；老桌面端不解析该字段、无影响，向后兼容。**
- **复查修复（对抗审查确认）**：internal 路径正则放行 query/锚点（`/models?tab=video` 是桌面端官方路由形态）且禁 `//` 开头（protocol-relative 会被浏览器按跨域解析）；管理页保存失败时弹窗保持打开、表单不丢（原无条件关弹窗）；persist 串行队列 + listRef（根治行内即时整体保存的并发覆盖）；排序列改只读（编辑走弹窗），弹窗排序限整数；保存成功后重拉列表（显示与按 sort 持久态即时一致）；422 错误读取改 `errors` 首字段首条（原 `data.items` 是死路径）。

### 新增（增量 3：公告插图 + 充值可计入套餐余量）

- **公告支持插图（`AnnouncementController::uploadImage` + `RichTextEditor.tsx`）**：`POST /admin/announcements/upload-image`（与文档插图同范式：mimetypes 白名单 + 5MB + UUID 文件名，落 `announcements/images/`）；富文本编辑器工具栏新增插图按钮（选文件 → 上传 → `insertImage`）并支持剪贴板图片粘贴直传；保存/恢复选区保证插图落在光标处。公告表无图片字段、接口契约不变——图片以 `<img>` 写入既有 longText `content`，桌面端 `v-html` 天然渲染（桌面端配套：公告弹窗 img 样式 + 点图开 Lightbox 大图，随 1.1.0 发布）。
- **充值可计入套餐余量（`BalanceController::recharge` + `BalanceService::adjustPlanQuota`）**：充值弹窗新增「入账方式」——钱包余额（默认，历史行为不变）或计入套餐余量；后者选目标套餐后追加 adjust 桶（`user_plan_quotas`，到期跟随该套餐，流水 `change_type='plan_adjust'`），不直接改已有桶的 granted（避免污染月度套餐 refill 基线）。只支持正数（扣减走钱包负数），校验套餐归属/生效/未到期 + 行锁防并发重复追加。
- **用户详情余额总览（`UserDetailModal.tsx`）**：余额卡由「钱包」改为「总余额 = 钱包 + 生效套餐余量」并展示「钱包 X · 套餐 Y」拆分——根治「管理员在用户管理处加分后套餐余量不动、误以为没到账」的误解（钱包与套餐桶本就是两套账户：扣费先套餐后钱包、套餐到期/月重置、钱包永久）。
- **流水口径统一（`BalanceController::recharge`）**：钱包充值的 `balance_after` 由钱包值改为 totalBalance（与 `BalanceService::addWallet` 对齐），消除同一页面两种口径并存。
- **二轮复查修复（对抗审查确认）**：公告插图改 `uploadAbsolute`（local 存储下补绝对 URL，防桌面端 file:// 加载裂图）；公告校验器含 `<img>` 视为非空（纯海报式公告可保存）；充值/批量充值加提交中守卫 + confirmLoading（防连点重复入账）；表格行「充值」先 resetFields（防残留入账方式/套餐误入账）；编辑器卸载守卫 + 选区容器存活校验 + 粘贴并发守卫（防脏节点/丢图/插图错位）；用户详情套餐余量请求失败降级为 0（不拖死主信息）；批量充值 `balance_after` 同步 totalBalance 口径。

## [1.6.30] - 2026-07-21

> **微信 ClawBot 桌面端功能的「显示 / 使用」门控**：菜单配置新增 `/clawbot` 项（显隐/改名可管，默认显示）；新增权限键 `allow_clawbot`（默认拒绝）控制能否使用，权限管理页可按用户/分组/套餐开通。**纯配置 / 逻辑改动、无 migration、无新依赖，可从 1.6.29 直接在线升级；桌面端配套改动随客户端 1.0.0 一并发布（桌面端对缺省不下发该键的老云控端按默认拒绝处理，向后兼容）。**

### 新增

- **权限键 `allow_clawbot`（`app/Services/QuotaService.php`）**：`policies()` 默认值表新增 `'allow_clawbot' => false`（默认拒绝，全部用户不可用），经既有「用户 > 套餐 > 分组 > 默认」合并链与 `/api/client/permissions` 下发桌面端；仅控制「能否使用」，与菜单显隐解耦。通用 key-value 权限策略表，无需 migration。
- **菜单配置新增 `/clawbot` 项（`app/Http/Controllers/DesktopMenuController.php`）**：`MENU_ITEMS` 新增 `['key' => '/clawbot', 'label' => '微信 ClawBot']`（非 permission_controlled），「桌面端设置 → 菜单配置」页可对其配置显示/隐藏与自定义名称，缺省显示并原名下发。
- **权限管理页清单（`frontend/src/pages/Permissions.tsx`）**：`policyKeys` 新增「允许使用微信 ClawBot（菜单显示由菜单配置管理）」布尔项，管理员可按用户/用户组授权（套餐策略同键生效）。

## [1.6.29] - 2026-07-18

> **去AI标记门控改造：显示与使用分离 + 新增「全局可用」开关**。原实现把「桌面端是否显示」与「能否使用」都压在权限 `allow_ai_mark_removal` 上（默认关 → 开了系统设置全局开关也不显示，须逐个授权），不直观。本版拆成三层：系统设置的**显示总开关**控制是否对所有用户显示入口；新增**「全局可用」开关**控制是否所有人免授权直接使用；权限 / 套餐的 `allow_ai_mark_removal` 退化为纯「使用」授权（仅在「全局可用」关闭时生效）。**纯配置 / 逻辑改动、无 migration、无新依赖，可从 1.6.28 直接在线升级；桌面端配套改动随客户端一并发布。**

### 变更

- **显示 / 使用门控分离（`app/Http/Controllers/SettingController.php` + `WatermarkRemovalController.php` + `app/Models/SystemSetting.php`）**：
  - `SystemSetting` 新增 `ai_mark_removal_use_all`(bool，默认 false)；`ai_mark_removal_enabled` 语义收敛为「启用并对所有用户显示」。
  - `SettingController::publicConfig` 新增 `features` 段下发 `ai_mark_removal`(显示) 与 `ai_mark_removal_use_all`(全局可用)，桌面端据此决定菜单显隐与按钮可用（与 `payment` 开关同一公开通道）。
  - `WatermarkRemovalController::charge` 使用判定由「仅看 `allow_ai_mark_removal`」改为「`ai_mark_removal_use_all` 为真 **或** 用户被授权」，全局服务开关 `ai_mark_removal_enabled` 仍为一票否决（503）。
- **后台文案（`frontend/src/pages/{Settings,Permissions,Plans}.tsx`）**：`Settings.tsx` 去AI标记页签加「全局可用」开关（仅在「启用并显示」开启时可编辑）并补充「显示与使用分两层」说明；`Permissions.tsx` / `Plans.tsx` 的 `allow_ai_mark_removal` 标签由「是否显示」改为「是否可以使用」，并注明显示由系统设置全局开关控制。

## [1.6.28] - 2026-07-18

> **新增「去AI标记」云端支持 + 接入第三方聚合支付「虎皮椒」（微信 / 支付宝扫码）**：本版为桌面端新功能「去AI标记」（本地清除图片元数据 / 溯源标识）提供云端授权与按次计费——默认全部用户不可见，管理员在「系统设置 → 去AI标记」开总开关 + 定单价，在「权限」/「套餐」按用户 / 分组 / 套餐授权 `allow_ai_mark_removal` 后才可用；并新增第三方支付通道「虎皮椒」，与微信 / 天阙平级，支持套餐购买 / 升级 / 充值三条链路，配置 APPID / APPSECRET 即可对外开放。**含 1 条幂等 migration（`ai_mark_removal_records`）、无新依赖、可从 1.6.x 直接在线升级；桌面端「去AI标记」页与「扫码支付」按钮随客户端 0.9.8 发布。**

### 新增

- **去AI标记按次计费端点（`app/Http/Controllers/WatermarkRemovalController.php`）**：`charge()` 供桌面端本地处理成功后回调扣费——先查 `request_id` 幂等，事务内**先 create 占位（`request_id` unique）再 `BalanceService::deduct`**，deduct 异常整体回滚不留孤儿记录，并发同 id 撞唯一键即视为已扣；单价优先 policies 覆盖、回退 `SystemSetting`；免费用户（`needed=0`）跳过扣费只记 0 费记录。
- **去AI标记用量表（`app/Models/AiMarkRemovalRecord.php` + `database/migrations/2026_07_25_000013_create_ai_mark_removal_records_table.php`）**：独立成表（`user_id` / `cost` / `balance_type` / `marks` / `image_count` / `status` / `request_id` unique），**不复用 `usage_records`**（其 `type` 为 enum、`cloud_model_id` 非空且有外键）。幂等（`Schema::hasTable` 跳过），仅 `Schema::` 原生 API。
- **去AI标记配置与门控**：`SystemSetting::ALLOWED_KEYS` 加 `ai_mark_removal_enabled`(bool，默认 false) + `ai_mark_removal_credit_per_call`(float，默认 0.1)；`QuotaService::policies` defaults 加 `allow_ai_mark_removal => false`（默认全部用户不可见，走 default→group→plan→user 合并，任一作用域授权即开）；路由 `gateway/watermark-removal/charge`（throttle:60,1）。
- **去AI标记后台 UI（`frontend/src/pages/{Permissions,Plans,Settings}.tsx`）**：`Permissions.tsx` / `Plans.tsx` 策略键库加 `allow_ai_mark_removal`(bool) + `ai_mark_removal_credit_per_call`(number)，复用现成批量授权接口；`Settings.tsx` 新增「去AI标记」页签（全局开关 + 单价 + 合规提示）。
- **第三方聚合支付「虎皮椒」（`app/Services/XunhupayService.php`）**：统一下单 `/payment/do.html`、查单 `/payment/query.html`、MD5 签名（非空参数 ASCII 字典序 `k=v&…` 去 hash 末尾拼 appsecret）、`verifyNotify`（`hash_equals` 常量比较）；金额人民币元单位，下单 / 查单均 `Http::asForm()`。
- **虎皮椒下单 / 回调 / 结算（`app/Http/Controllers/PaymentController.php`）**：`createXunhupay` / `createXunhupayUpgrade` / `createXunhupayRecharge`（照天阙范式，`channel=xunhupay_native`，`code_url=payUrl`）；`xunhupayNotify`（照微信 notify：MD5 验签 + 事务 + `lockForUpdate` + 幂等复检 + `total_fee` 元单位金额校验 + 留证，处理成功返回纯文本 `success` 防重试）；`xunhupaySync`（主动查单兜底，OD 结算 / CD 关单，与 notify 幂等竞争只一方成功）；`settleXunhupayPaidOrder` 与 `settleTianquePaidOrder` 同构。
- **虎皮椒路由与配置**：公开 `POST /payment/xunhupay/notify`（auth 外，throttle:200,1）+ client `orders/xunhupay`（+`/upgrade`、`{orderNo}/xunhupay-sync`）+ `recharge/order/xunhupay`；`SystemSetting` 加 `xunhupay_enabled` / `xunhupay_appid` / `xunhupay_appsecret`(encrypted) / `xunhupay_gateway`；`SettingController::publicConfig` 的 `payment` 加 `xunhupay` 布尔（供桌面端显示按钮）。

### 修复

- **后台补单 `adminSync` 写死微信 → 异步通道无法补单（`app/Http/Controllers/PaymentController.php`）**：`adminSync` 原恒定调 `WeChatPayService::queryOrder`，对天阙 / 虎皮椒订单命中「订单不存在」→ 502。改为按 `channel` 分派到对应 Service 查单与结算（微信 `trade_state` / 天阙 `tranSts` / 虎皮椒 `status`），管理员可从后台为异步通道补单 / 关单（顺带修好天阙的同款既有缺口）。
- **去AI标记 `request_id` 未截长（`WatermarkRemovalController.php`）**：`request_id` 列长 100，补 `mb_substr(...,100)` 防超长客户端输入触发 insert 异常。

## [1.6.27] - 2026-07-13

> **多米视频接入「可灵 Kling」（官方格式）+ 修复后台主题色保存成 rgb() 致桌面端换肤不生效**：新增多米可灵视频模型（官方格式-推荐，支持文生 / 图生 / 首尾帧、std=720p·pro=1080p、时长、音画同步），复用既有多米账号，管理员在后台定价后即可对外提供。另修复「桌面端基础配置」主题主色保存后桌面端不变色的问题。**含 1 条幂等 migration、无新依赖、可从 1.6.x 直接在线升级；桌面端可灵能力表随客户端 0.9.7 发布。**

### 新增

- **多米「可灵 Kling」视频适配（`app/Services/Video/Adapters/DuomiVideoProvider.php`）**：`DuomiVideoProvider` 新增 `kling` 协议分支——`buildKlingSubmitPayload` 按多米官方格式发 `model_name` / `prompt` / `mode`(std=720p·pro=1080p，由清晰度映射) / `sound`(音画同步，`provider_params.sound` 控制、默认关) / `duration` / `negative_prompt` / `cfg_scale` / `image`(图生首帧) / `image_tail`(首尾帧尾帧) / `aspect_ratio`(文生)；`klingPath` 按文生 / 图生自动命中 `/api/video/kling/v1/videos/{text2video|image2video}` 两个 endpoint，查询用同 endpoint + `/{task_id}`；`normalizeStatus` 识别可灵成功态 `succeed`、`extractVideoUrl` 支持 `data.task_result.videos[].url`。均为向后兼容增量，不影响 seedance / veo / grok。
- **预置可灵模型与 SKU（`database/migrations/2026_07_25_000012_add_duomi_kling_video.php`）**：预置 `kling-v1` / `kling-v2-5-turbo` / `kling-v3` 三个模型（各 std/pro × 5s/10s SKU，`default_credit_cost` 取 doc/65 价格表「8 折官方价、音画同步关闭」档的占位算力，管理员按实价调整），`provider_params.contract` 不写死 submit/query 路径以保留文生 / 图生自动分流。幂等（按 model_id / sku_key 跳过），仅 `Schema::`/`DB::` 原生 API。
- **后台协议选项（`frontend/src/pages/VideoManagement.tsx`）**：`PROTOCOL_OPTIONS` 加「可灵 Kling」，`PROTOCOL_LOCKED_DIMS` 配 kling 计费维度为「时长 × 清晰度」。

### 修复

- **后台主题主色保存成 `rgb(...)` 致桌面端换肤不生效（`frontend/src/pages/DesktopBasicSettings.tsx`）**：antd v6 `ColorPicker` 的 `onChange` 第二参是 `rgb(...)` 字符串而非 hex，原 `getValueFromEvent={(_c, hex) => hex}` 把 `rgb(242,118,56)` 当 hex 存入 `theme_primary_color`；桌面端 `theme-color.ts` 用严格 6 位 hex 正则解析失败 → 静默回退默认橙 → 设任何颜色都不变。改为 `getValueFromEvent={(color) => color.toHexString()}` 存标准 `#RRGGBB`（桌面端同步增加对存量 `rgb()` 脏值的兼容解析，随客户端 0.9.7 发布）。已存的 `rgb()` 旧值在后台重存一次颜色即转 hex。

## [1.6.26] - 2026-07-12

> **AI 视频 cang-api 全面对齐上游「视频原生契约」**：接口方（ai.772.ee）发布全新原生契约——模型枚举改为 `videos-standard` / `videos-fast` / `videos-mini`，请求字段改为 `duration`(整数) / `ratio`(16:9/9:16/1:1) / `resolution`(小写 720p/480p，无 1080p) / `referenceImages`+`referenceVideos`+`referenceAudios`(仅公网 http/https)，不再有 `size` / `seconds` / `media_urls`，无 `/cancel`；完成结果 URL 改为服务商自身鉴权端点 `/v1/videos/{id}/content`（非 OSS 直链）；失败返回 `error:{message,code}` 语义码。原实现沿用的旧 New API 兼容方言（`size`+`seconds`+大写 `resolution`+`media_urls`）在新契约下会被判 `unsupported_request` 全量失败。本版给通用 OpenAI 视频适配器新增「原生契约」分支（由 `provider_params.contract=cang_native` 开关，**对标准 sora / 其它 OpenAI 兼容中转零影响**），并以新迁移预置三个原生模型、全量下线旧 cang-api 模型（disabled 不删除、可后台改回 active 回滚）。**含 1 条幂等 migration、无新依赖、可从 1.6.x 直接在线升级；桌面端参考素材音频能力随客户端 0.9.6 发布。另修复独立部署「local 存储 + public 目录不可写」时 AI 视频参考图因 public 直链 404 导致上游回拉与桌面端预览失效的盲区（新增公开直出端点兜底，详见修复段）。**
>
> **升级须知**：本版把 cang-api 切换到新原生模型（旧模型 disabled）。部署后请确认上游确已切新契约（`GET /v1/models` 应只剩 `videos-*`）；若上游仍兼容旧模型、需暂缓切换，在后台把旧 spec/SKU 状态改回 active 即可回滚。若 `/v1/videos/{id}/content` 需鉴权，建议把 `video_result_storage_mode` 设为 `cloud_storage`（本版镜像下载已带鉴权，会用本站存储二次分发公开 URL）。

### 新增

- **视频「原生契约」适配分支（`app/Services/Video/Adapters/OpenAiVideoProvider.php`）**：`buildSubmitPayload` 按 `provider_params.contract==='cang_native'` 分流——`fillNativeContractPayload` 发 `model` / `prompt` / `duration`(整数) / `resolution`(小写) / `ratio` / `referenceImages`+`referenceVideos`+`referenceAudios`（新增 `refUrls()` 按 `asset_type` 分离参考素材）；`fillLegacyPayload` 原样保留旧 `size`+`seconds`+`media_urls` 形状给未切换的服务商。原生契约下 `cancel()` 跳过必然 404 的 `/cancel` 请求；`extra_body` 逃生口两契约通用。
- **预置三原生模型与 SKU（`database/migrations/2026_07_25_000011_align_cang_api_to_native_video_contract.php`）**：预置 `videos-standard` / `videos-fast` / `videos-mini`（active，`provider_params.contract=cang_native` + `ref_media=[image,video,audio]`，清晰度 720p/480p、比例 16:9/9:16/1:1、时长 5/10/15、`max_reference_images=9`）+ active SKU（占位算力待管理员定价）。幂等（按 model_id / sku_key 跳过），仅 `Schema::`/`DB::` 原生 API、不 import 业务 Model。
- **catalog 下发参考素材类型白名单（`app/Services/Video/VideoTaskService.php` + `VideoSkuSupportService.php`）**：模型列表新增 `supported_ref_media`，取值即 `VideoSkuSupportService::allowedRefMedia()`（改 public，与提交时 `assertAssetsSupported` **同源**），使桌面端可选素材类型与后端校验严格一致（前端可选 ⊆ 后端接受）。

### 修复

- **结果视频下载鉴权（`app/Services/Video/VideoAssetService.php`）**：新契约结果 URL 指向服务商自身鉴权端点，`mirrorRemoteUrl` 原裸 `GET` 会 401。新增 `downloadHeadersFor()`——仅当下载 URL 与服务商 `base_url` **同源（scheme+host+port 全等）** 且账号有 key 时附带 `Authorization`（bearer / raw 两种风格），外链 / 公共 CDN 不带 key（防明文降级泄露）；仅 `cloud_storage` 镜像模式触发。
- **本地存储参考图上游可达性（`routes/api.php` + `app/Http/Controllers/VideoController.php` + `app/Services/StorageService.php` + `app/Services/Video/TemporaryReferenceAssetService.php`）**：`storage_type=local` 且 `public/` 目录不可写（宝塔 / nginx 站点 root 属主、PHP-FPM 跑 www 常见）时，AI 视频参考图落 `storage/app/local-assets` 兜底目录、按 public 直链外部访问 404 → **上游服务商回拉参考图失败 + 桌面端预览打不开**（视频链路无生图那套 base64 materialize 兜底；1.6.25 只修了「上传不再 500」，未修「上传成功但直链不可达」）。新增公开无鉴权直出端点 `GET /public/videos/reference-blob/{key}`（经 `StorageService::readBytes` 从 public 或 storage 兜底目录回流，local 走 `BinaryFileResponse` 流式避免大视频入内存；key 含不可猜 uuid，与 public 直链同等安全模型；只服务 `video-reference-assets` / `image-reference-assets` 两个子目录、拒绝路径穿越；受 api 组全局限流 120/min/IP 保护）。`TemporaryReferenceAssetService::upload` 在「local 且文件不在 public」时把参考素材 URL 改为该服务路由 URL，`StorageService::extractObjectKey` 剥掉路由前缀保证 读 / 删 / 绑定 仍按真实存储 key 定位。**public 可写或用 cos/oss 时行为逐字节不变；对 local 部署既修上游回拉又修桌面端预览。**
- **自定义 CDN 域名下 cos/oss 参考图上游可达性（`app/Services/StorageService.php`）**：`storage_type=cos/oss` 且配了 `cos_domain`/`oss_domain` 自定义访问域名时，参考图 URL 的 host 是自定义域名，`upstreamFetchableUrl` 里的 `detectDriverFromUrl` 只按 host 判定会把本站对象误归 local → 不预签名、原样交上游 → **私有桶被上游回拉 403、参考图失效**。新增 `driverForConfiguredDomain()`：按已配置的自定义域名把 URL 识别回 cos/oss 并预签名（预签名指向 cos/oss 原生端点，**公有 / 私有桶均可拉、不依赖桶 ACL**）；默认域名（`*.myqcloud.com`/`*.aliyuncs.com`）与非本站外链行为不变。

### 变更

- **cang-api 全量切换到原生模型（migration 000011）**：除三个原生模型外，其余 cang-api spec 与 SKU 全部 `status=disabled`（`whereNotIn`，不删除数据、遵守 Migration 铁律，可后台改回 active 回滚）。
- **失败任务错误码透传（`OpenAiVideoProvider.php` + `app/Services/Video/VideoTaskService.php`）**：原生契约下 `query()` 失败透传上游 `error.code`（`content_policy_violation` / `material_limit_exceeded` 等语义码，并隔离 `connection_error` / `http_*` / `missing_provider_task_id` 保留词），旧服务商仍落 `provider_failed`（语义不变）。`applyQueryResult` 终态判定由 `errorCode==='provider_failed'` 改为「非瞬时（`missing_provider_task_id` / `connection_error` / `http_*`）即终态」，使上游语义码也能正确落 `failed` 并入库 `error_code`。

## [1.6.25] - 2026-07-02

> **修复独立部署用户「参考图上传失败 HTTP 500：reference_storage_error」的回归，让存储写入不再依赖客户改服务器**：自 1.6.8（配套桌面端 0.9.0）起，生图 / 多米的参考图由「base64 内联」改为「先上传云控端换公网 URL」，把一条原本从不碰存储的链路，硬绑上了「local 的 `public/` 必须可写 / 对象存储必须配全」的新前置依赖——独立部署默认 `storage_type=local`，若 `public/` 被 root 属主（宝塔/nginx 常见、PHP-FPM 以 www 运行）建不出子目录，或 cos/oss 只填了一半，`StorageService::uploadAbsolute` 即返回 null → `TemporaryReferenceAssetService` 抛 `RuntimeException` → `VideoController` 归类为 `reference_storage_error`。此前这些隐患全被 base64 掩盖，客户端升级后集中爆发。本版让 **local 写入在 `public/` 不可写时自动回退到 Laravel 保证可写的 `storage_path('app/local-assets/')`**（参考图链路由后端 `ProcessImageTaskJob::materializeReferenceUrls` 经 `readBytes` 自读回传，不依赖 doc-root 直链或对象存储公共读，读/删侧同步兼容两处落点）；**cos/oss「半配置」时自动降级 local 兜底**而非硬失败；并给关键存储凭据加「留空不覆盖」保护，堵住「打开设置页重存一次就把凭据刷空」。**纯后端代码修复，无 migration、无新依赖、无 breaking，可从 1.6.x 直接在线升级；一次升级即修复所有存量独立部署，客户零终端操作、无需重发桌面端。** 现有已正确配置的部署行为逐字节不变（`public/` 可写时 `writableLocalDir` 第一顺位仍返回它，兜底路径只在原本已失败的场景激活）。

### 修复

- **`app/Services/StorageService.php` local 写入永不依赖 doc-root 可写**：新增 `writableLocalDir()`（`public_path($subdir)` 优先、不可写则回退 `storage_path('app/local-assets/…')`；应用能运行即证明 storage 可写）与 `resolveLocalPath()`（读/删按「先 public 后 storage 兜底」对称查找）。`uploadToLocal` / `putBytesToLocal` / `putFileToLocal` 改用前者写入，`readBytes` local 分支与 `deleteFromLocal` 改用后者定位；`uploadToLocal` 的 `$file->move()` 加 try/catch 统一归 null，避免 FileException 以未捕获形态冒泡到未加 try/catch 的其它上传调用方。
- **cos/oss「半配置」自动降级 local，不再硬失败**：新增 `effectiveStorageType()` / `effectiveDriver()`——`storage_type=cos/oss` 但 `loadCosConfig`/`loadOssConfig` 因字段不全返回 null 时归为 local 兜底并记 warning；`upload` / `putBytes` / `putFile` 及 `readBytes` / `deleteWithDriver` 均按生效 driver 分流，保证「写到哪、读/删也去哪」一致。凭据齐全但错误（PUT 403 等）不在降级之列，仍照常返回 null，不掩盖真实配错。
- **`app/Services/Video/TemporaryReferenceAssetService.php` 记录实际落地后端**：`storage_driver` 由 `getStorageType()`（名义配置）改为 `effectiveStorageType()`（实际落地），使被降级到 local 的参考图后续 `materialize`/`readBytes` 按同一后端读得回，而非按名义后端读空。
- **`app/Models/SystemSetting.php` + `app/Http/Controllers/SettingController.php` 关键存储凭据留空保护**：新增 `EMPTY_PROTECTED_KEYS`（`cos_secret_id`/`cos_region`/`cos_bucket`/`cos_app_id`/`oss_access_key_id`/`oss_endpoint`/`oss_bucket`）与 `skipEmptyUpdate()`，把原本只对加密字段生效的「留空即不修改」保护扩展到这些非加密凭据键，防止前端未重填就把已配好的凭据覆盖成空串（空串会让 `loadCosConfig`/`loadOssConfig` 判定配置不完整）；可选的 `cos_domain`/`oss_domain` 仍允许清空。

## [1.6.24] - 2026-06-26

> **套餐新增「余额模式」（一次性 / 按月重置），修复月度套餐在 grant() 路径被降级，月度续充扫描提频到 30 分钟**：套餐底层早已支持 `plans.quota_refill_cycle`（`none`=一次性发放、`monthly`=按开通日滚动月重置——月度额度桶按开通日 `addMonthNoOverflow` 重发、上月未用完桶过期不结转、到期清零），但后台套餐表单从未暴露该字段，管理员无法创建「按月重置」套餐。本版在 `Plans.tsx` 补上「余额模式」选择器 + 列表列 + 额度标签随模式提示「每月额度」；同时修掉 `PlanService::grant()` 把 `quota_refill_cycle` 写死 `?? 'none'` 的 bug（后台发放 / 批量发放 / 兑换码 / 注册赠送均走此路径，会把月度套餐错误降级成一次性；购买 / 续费 / 升级走 snapshot 不受影响）；并把月度续充计划任务由 `hourly()` 提频到 `everyThirtyMinutes()`，重置延迟窗口收窄到 ≤30 分钟。**无 migration（`quota_refill_cycle` 列在 `2026_07_15_000004` 已存在）、无新依赖、无 breaking，可从 1.6.x 直接在线升级；余额模式改动仅对升级后新发放 / 新续费的套餐生效。另修复后台「对话页面默认模型」下拉在同一模型由多个服务商提供时会同时高亮、且无法指定具体服务商的问题（下拉项改用复合 key 精确到服务商）。**

### 新增

- **套餐「余额模式」前端控件（`frontend/src/pages/Plans.tsx`）**：套餐创建/编辑表单新增 `quota_refill_cycle` 下拉（`none`=一次性余额 / `monthly`=按月重置余额），新建默认 `none`、编辑回填 `plan.quota_refill_cycle`；表格新增「余额模式」列（按月重置 / 一次性）；用 `Form.useWatch` 监听模式，`monthly` 时把 token/credit 额度标签提示为「每月…额度」并在 `extra` 给出模式说明，避免管理员误填全年总额。提交 payload 经 `...rest` 自动带上该字段；后端 `PlanController::store/update` 早已校验 `in:none,monthly` 并持久化、`Plan::$fillable` 已含该列，前端无需后端配合即接通。

### 修复

- **`app/Services/PlanService.php` `grant()` 把月度套餐降级为一次性**：原 `'quota_refill_cycle' => $options['quota_refill_cycle'] ?? 'none'`，在调用方未显式传 cycle 时一律写 `none`，导致后台发放（`PlanController::grant`）、批量发放（`batchGrant`）、兑换码（`RedeemController`）、注册赠送（`AuthController`）发出的月度套餐被错误降级成一次性、不再每月重置。改为 `?? $plan->quota_refill_cycle ?? 'none'`，默认回落套餐自身续充周期，调用方仍可覆盖。购买 / 续费 / 升级走 `PaymentController` 的 `plan_snapshot` 链路（snapshot 已含 `quota_refill_cycle`、options 未强制覆盖），不受此 bug 影响。
- **对话默认模型下拉「同名多服务商多高亮 + 服务商维度丢失」（`frontend/src/pages/Settings.tsx`）**：「对话页面默认模型」下拉选项 value 原为裸 `m.model_id`，多个服务商提供同一 model_id 时 value 撞车 → Ant Select 单选按 value 匹配会把多项一起高亮，且存进 `chat_default_model_id` 的只剩裸 model_id、无法锁定服务商（桌面端最终按「首个匹配服务商」反查 cloud_model_id，管理员选的服务商被丢弃）。改下拉 value 为复合 key `model_id#@provider_name`（与桌面端 `@shared/model-id` 的 `CLOUD_KEY_SEP` 一致），原样透传桌面端、由其原生解析复合 key 精确路由到指定服务商。配套桌面端 `ChatView.vue::resolveDefaultModel` 增加授权校验：默认模型该用户无权限时回退到其第一个已授权 chat 模型，避免摆出列表里没有、还发不出消息的「幽灵模型」（此项随桌面端客户端发布生效，与本包独立部署、互相兼容）。

### 变更

- **月度续充提频（`app/Console/Kernel.php`）**：`plan:refill-monthly-quotas` 计划任务由 `hourly()` 改为 `everyThirtyMinutes()`，「按月重置」在重置时间点的到账延迟窗口由 ≤1 小时收窄到 ≤30 分钟（旧月度桶到期、新桶由下一次扫描发放）。

## [1.6.23] - 2026-06-24

> **修复 AI 视频 / 云端视觉「参考图」在私有对象存储桶下被上游取图 403 而静默失效，并归一化自定义存储域名**：视频提交与云端聊天（视觉）链路均「无 materialize」——参考图 `storage_url` 原样交上游、由上游主动 HTTP 回拉，而 `StorageService` 上传从不设对象公共读 ACL，私有 cos/oss 桶下上游 GET 直链 403 → 参考图静默不生效（与生图路径有 `ProcessImageTaskJob::materializeReferenceUrls` 读回 base64 兜底不同）。本版新增公共 `StorageService::upstreamFetchableUrl()`，对本站 cos/oss 默认域名对象在交上游前换成预签名 GET URL（私有桶也能拉），并接入视频两个 provider 与云端视觉转发；同时归一化 `cos_domain`/`oss_domain`（缺 scheme 补 https、保留 path 前缀）并让 `extractObjectKey` 域名感知，修掉带 path 前缀自定义域名取错 object key。**纯后端代码修复，无 migration、无新依赖、无 breaking，可从 1.6.x 直接在线升级。**

### 修复

- **`StorageService::upstreamFetchableUrl($url, $ttl=21600)`（新增公共方法）**：对本站 cos/oss 默认域名对象用既有 `signedUrl` 换预签名 GET URL（私有桶可被上游回拉）；local 绝对 URL / 外链 / 自定义 CDN 域名（`detectDriverFromUrl` 归 local）/ dataURI 一律原样返回；签名失败回退原 URL，绝不比现状更差。
- **AI 视频参考图可达性**：`AbstractVideoProvider` 新增 `materializeAssetUrls()` / `toUpstreamUrl()`（委托上面的公共方法，常量 `UPSTREAM_FETCH_TTL=21600`=6h）；`OpenAiVideoProvider::buildSubmitPayload` 与 `DuomiVideoProvider::buildSubmitPayload` 在读 `input_assets` 后、构建上游 payload 前调用，覆盖 `assets[].url` 与 `images/videos/audios` 全形态——seedance content / veo 首尾帧 / grok / openai `media_urls` 各分支自动生效。
- **云端视觉（看图 / 图生提示词 / 画布关键帧分析）参考图可达性**：`NewGatewayService::handleChat` 在 `filter` 后新增 `materializeMessageImageUrls()`，遍历 messages 多模态 `content`，把 `image_url` 的本站 cos/oss URL 同样换预签名 URL；纯文本 / string content / 内联 base64 dataURI / 外链原样不动。
- **自定义存储域名归一化（修 finding #12）**：`StorageService::normalizeStorageDomain()` 在 `loadCosConfig`/`loadOssConfig` 给 `cos_domain`/`oss_domain` 缺 scheme 补 `https://`、去尾斜杠（保留 path 前缀）；`extractObjectKey` 新增 `configuredDomainPrefixes()` 域名感知，带 path 前缀的自定义域名整体剥离取回正确 object key，修掉私有 blob 读 / 删 / 签名 / 生图 materialize 取错 key（NoSuchKey）。

## [1.6.22] - 2026-06-23

> **修复云控端后台「对话模型 → 对话页面默认模型」下拉不显示模型所属服务商**：`Settings.tsx` 构建下拉选项时读取了不存在的扁平字段 `m.provider_name`，而 `/admin/cloud-models` 接口返回的是嵌套 `m.provider` 对象（`m.provider.name`），导致服务商名永远为空、回退成只显示 model_id——当多个服务商提供同名 model_id 时无法在下拉里区分。改为优先取 `m.provider?.name`（兜底扁平字段）。**纯前端显示修复，无后端 / 接口 / 数据 / 迁移改动，无 breaking。**

### 修复

- **admin「对话页面默认模型」下拉显示服务商**：`Settings.tsx` 模型选项映射由 `String(m.provider_name || '')` 改为 `String(m.provider?.name || m.provider_name || '')`，下拉标签按 `服务商 / model_id` 显示，区分同名模型的不同服务商。

## [1.6.21] - 2026-06-23

> **修复后台「新建/编辑用户」不填手机号时第二个用户必报 500（`1062 Duplicate entry '' for key 'users_phone_unique'`）**：`users.phone` 自 `2026_07_19_000001_add_unique_index_to_users_phone` 起带唯一索引，该迁移契约是空手机号一律存 `NULL`（MySQL 唯一索引允许多个 NULL、不允许多个 `''`）。但 `UserController::store()` 仍用旧写法 `'phone' => $request->phone ?? ''` 把空号写成 `''`——即便全局 `ConvertEmptyStringsToNull` 已把输入转 null，`?? ''` 又掰回空串。于是第一个无手机号用户写 `''` 成功、第二个再写 `''` 即撞 `users_phone_unique` → `SQLSTATE[23000] 1062` → 500（`APP_DEBUG=false` 时前端只见通用 500，真因在 laravel.log）。本版把 `store()` 与 `update()` 的手机号写入对齐 `AuthController::create()` 既有正确范例 `filled() ? trim() : null`。**纯代码修复，无 migration、无新依赖、无 breaking，可从 1.6.x 直接在线升级。** 部署后建议执行一次 `UPDATE users SET phone = NULL WHERE phone = ''` 清理旧版（≤1.6.20）已写入的空串行。注：1.6.20 的 `DB::transaction` 只防孤立用户、不治本，本版才根治 500。

### 修复

- **`UserController::store()`**：`'phone' => $request->phone ?? ''` 改为 `$request->filled('phone') ? trim((string) $request->phone) : null`，空手机号写 NULL，杜绝第二个无手机号用户撞 `users_phone_unique` 唯一约束。
- **`UserController::update()`**：将 `phone` 从批量 `fill()` 拆出、显式规范化为 NULL（同 store），避免编辑用户清空手机号时写入 `''` 触发同一冲突。

## [1.6.20] - 2026-06-23

> **修复后台新建用户（`POST /api/admin/users`）非原子写入产生的孤立用户**：`UserController::store()` 此前裸调用 `User::create()` + 两次 `UserBalance::create()`（token / credit 余额账户初始化），三处写入无事务包裹。一旦任一余额插入抛异常（最典型：`user_balances` 对 `(user_id, balance_type)` 的唯一约束在重试/重复提交时冲突；或目标库缺列、连接抖动），User 已落库而余额未建、且无回滚，接口返回 500 并在库中留下「无余额账户的孤立用户」。本版把三处写入包进 `DB::transaction`，任一失败整体回滚，与同文件 `syncOemProjects()` 既有事务用法保持一致。**纯代码修复，无 migration、无新依赖（`DB` facade 此前已 import）、无 breaking，可从 1.6.x 直接在线升级。** 注：本修复只保证写入原子性、不改变接口对外行为；若新建用户仍报 500，应排查目标库迁移是否跑全（例如缺 `users.inspiration_uploader` 列会触发 `SQLSTATE[42S22] Unknown column`）。

### 修复

- **`UserController::store()`** 将 `User::create()` 与随后两次 `UserBalance::create()` 包进 `DB::transaction(function () { ... })`：任一插入异常时整体回滚，杜绝「User 已写、余额未建」的孤立用户；`$user->load('groups','balances')` 与响应保留在事务外（只读）。

## [1.6.19] - 2026-06-23

> **打通「全端云商城」店铺商品图的授权链 + 补全前端展示**：本版修复两处导致「全端云商城」无法在云控端被识别/管理的问题。其一，`EweiShopAuthorization::MALL_KEYS` 内部商城清单仍是 `['ewei','dianda']`、漏了 `qdyun`——而授权管理端（agent-build）早已能下发 `mall_authorizations.qdyun`，但本端 `extractMap()` 只按该常量迭代，导致 qdyun 一级授权被静默丢弃：后台「店铺商品图」读不到全端云授权、`ClientController::shopProductImagePermissions()` 也永不产出 `shops['qdyun']` / `allow_qdyun_shop` / `qdyun_shop_mall_name`，桌面端「全端云」功能整条无法开放。其二，admin 前端早含全端云 Tab/字段，但此前打包未重建前端，构建产物里 `qdyun` 出现 0 次、后台看不到全端云。本版把 `MALL_KEYS` 补为 `['ewei','dianda','qdyun']`、`QuotaService` 默认补 `allow_qdyun_shop`，并重新构建前端。**纯代码 + 前端构建变更，无 migration、无新依赖、无 breaking，可从 1.6.x 直接在线升级；需配套授权管理端 ≥ 0.16.0 方能下发全端云一级授权。**

### 修复

- **`EweiShopAuthorization::MALL_KEYS`** 由 `['ewei','dianda']` 补为 `['ewei','dianda','qdyun']`：本类的 `extractMap()` / `emptyMap()` / `normalizeMap()` 及消费者 `EweiShopController::authorization()`、`ClientController::shopProductImagePermissions()` 全部基于该常量迭代，补齐后全端云的一级授权 map、`shops['qdyun']`、`allow_qdyun_shop`、`qdyun_shop_mall_name` 才会被正确读取与下发。
- **重新构建 admin 前端**：使「店铺商品图」设置页的「全端云商城」Tab/列与自定义显示名输入正常出现（此前因构建产物滞后于源码而缺失）。

### 变更

- **`QuotaService` 的 `$defaults`** 补 `'allow_qdyun_shop' => false`，与 `allow_ewei_shop` / `allow_dianda_shop` 平级，使「按商城默认全关」基线对三个商城一致（`?? false` 兜底本就 fail-closed，此为契约完整性补齐）。

## [1.6.18] - 2026-06-22

> **修复 cang-api 视频服务商 `videos`（OpenAI Sora 兼容路径）模型生成报「ratio 错误，当前模型仅支持 ... 当前: 1920x1080」**：部分站点已把 cang-api 当前启用的视频模型切到管理员手工新增的 `videos`（Sora `CreateVideosRequest` 路径），其 `provider_params` 只有 `submit_path`/`query_path`、缺 `aspect_param`，导致 `OpenAiVideoProvider::buildSubmitPayload` 只发 `size=宽x高`（如 1920x1080）、不发画面比例 `ratio`；而 `videos` 模型强制要 `ratio` 比例枚举、不能从 `size` 反推（与同族 `seedance-2.0` 契约不同，后者发 `size` 即可），上游把 `size` 的值当 `ratio` 校验 → 报错。**纯配置修复，无代码改动、无 breaking；适配器既有 `aspect_param` 机制已支持。** 2026-06-22 带真实 key 实测 `https://ai.772.ee/v1/videos`：补 `ratio`（与 `size` 并存）后 720p/5s 与 1080p/15s 创建均返回 200。

### 修复

- **migration `2026_07_25_000010_add_aspect_param_to_cang_api_videos`**：给 `video_model_specs` 中 `provider_key=cang-api` 且 `model_id=videos` 的规格补 `provider_params.aspect_param='ratio'`，使适配器把 `request_params.aspect_ratio`（如 16:9）以顶层 `ratio` 字段发出。幂等（已配置则跳过）；仅作用 `model_id=videos`，不触碰 seedance 系（其发 `size` 即可、无需 `ratio`）；仅 `Schema::` / `DB::` 原生 API，不 import 业务 Model。
- **只补 `aspect_param`、不补 `resolution_param`**：实测 `videos` 靠 `size` 携带分辨率，无需单独 `resolution` 字段，多发反而可能与 `size` 冲突。

## [1.6.17] - 2026-06-22

> **「店铺商品图」泛化为多商城 + 按商城分别授权/命名（后端 + admin 前端）**：原「店铺商品图」二级授权与对外显示名都假设只有一个商城，无法扩展。本版把授权与命名按「商城」拆分，可同时接入多个第三方商城并各自独立开放权限、各自自定义对终端用户显示的名称。**全程向后兼容：旧的平铺字段（`allow_ewei_shop` / `ewei_shop_mall_name`）原样保留，未升级的桌面端一字不差；无 migration、无新依赖、无 breaking。** 需配套升级授权管理端（agent-build）后端方能下发第二个及以上商城的一级授权位。

### 新增

- **`ClientController::shopProductImagePermissions()`**：把 `myPermissions` / `myQuotas` 两处重复的店铺商品图门控逻辑抽成单一私有方法（消除漂移），按 `EweiShopAuthorization::MALL_KEYS` 逐商城产出 `shops.{mall} = { allowed, mall_name, real_name }` 聚合结构 + 平铺兼容字段 `allow_{mall}_shop` / `{mall}_shop_mall_name`；每商城 `allowed = 二级(per-user policy allow_{mall}_shop) AND 一级(EweiShopAuthorization::isAuthorized(mall))`。
- **`SystemSetting`**：`ALLOWED_KEYS` + `DEFAULT_VALUES` 新增 `dianda_shop_mall_name`（默认「商城」，保留 `ewei_shop_mall_name`）；新增常量 `SHOP_PLATFORM_LABELS`（商城真名，仅供云控端后台展示，不下发终端）。
- **`QuotaService::policies()`**：defaults 新增 `allow_dianda_shop => false`（保留 `allow_ewei_shop`），二级 per-user 授权沿用 `PermissionPolicy` 自由 `policy_key` 机制，无需 migration。
- **admin 前端 `ShopProductImage.tsx`**：单商城页改为按商城分区（顶层 Tab/选择器），每商城各自展示一级授权态、设置对外名称、配置 per-user 使用权限；`policy_key` / 设置项 key 参数化为 `allow_${mall}_shop` / `${mall}_shop_mall_name`。

### 变更

- **`Services/CloudBuild/EweiShopAuthorization`**：单值授权改为按 `mall_key` 的 map，一次探测授权管理端 auth-check 即整体缓存全部商城授权位（FRESH/PENDING/LKG 非对称 TTL 不变）；新增 `isAuthorized(string $mallKey = 'ewei')`（默认参兼容旧无参调用）、`authorizations()`；`forget()` / `refresh()` 清/回源全部商城。auth-check 响应缺新字段（旧授权端）时回退：ewei ← `can_use_ewei_shop`，其余商城 ← false。
- **`EweiShopController`**：`authorization()` / `refreshAuth()` 改为按商城返回 `{ malls, platform_labels }`，`refreshAuth` 清全部商城缓存并回源。

## [1.6.16] - 2026-06-22

> **云打包产物「家庭电脑直连下载」——CDN 兜底 + 直连优选（后端）**：云打包产物默认经 your-cdn-domain.example.com（腾讯云免费 CDN）分发，回源家庭/办公室上行慢。本版让云控端拉取产物时支持「直连优先、CDN 兜底」：agent-build 在 download 接口额外下发一个 `preferred_url`（指向家庭电脑公网IP的直连地址），云控端先试直连、连不上/超时立即回退既有 CDN 地址。**CDN 的 `url` 字段保持不变，未升级站点完全无感；CGNAT/家里离线也只会回退到原行为，不会更糟。** 本版仅含云控端（agent-admin）侧改动；配套的 agent-build、agent-mirror-worker 改动随各自部署/构建发布，且 `DIRECT_MIRROR_ENABLED` 默认关闭，未开启时本版行为与 1.6.15 完全一致。

### 新增

- **下载支持「直连优选 + CDN 兜底」候选链**：`CloudBuildPullService::downloadAndPlace` 把每个文件由单一 `url` 改为有序候选列表 `[preferred_url(直连), download_url(CDN)]`，新增私有方法 `downloadWithFallback(array $urls, string $sha256, ?int $progressBuildId)` 按序尝试、任一 sha256 校验通过即采用。非最后一个候选（直连）走「快速失败」模式快速回退。
- **`ArtifactDownloadService::downloadAndVerify` 新增 `?int $fastFailConnectTimeout` 形参**：非 null 时进入快速失败模式——`CURLOPT_CONNECTTIMEOUT` 用该短超时（默认取 `config('cloudbuild.download.direct_connect_timeout', 8)`），并加 `CURLOPT_LOW_SPEED_LIMIT=1024 / LOW_SPEED_TIME=20`，防直连「连得上但中途掉线/上行打满」拖到 30 分钟主超时。向后兼容（默认 null = 原 30s 连接超时、无低速中断）。
- **`tryResolveDownload` 透传并落库 `preferred_url`**：primary 存新列 `cloud_builds.agent_build_preferred_url`，supplementary 每项 JSON 增加 `preferred_url` 键（agent-build 未下发时为 null，纯走 CDN）。
- **migration `2026_07_25_000009_add_preferred_url_to_cloud_builds`**：`cloud_builds` 加可空列 `agent_build_preferred_url`（VARCHAR 500），仅 `Schema::table` addColumn，无业务 Model 依赖。
- **config `cloudbuild.php` 新增 `download.direct_connect_timeout`**（env `CLOUDBUILD_DIRECT_CONNECT_TIMEOUT`，默认 8）：直连快速失败阈值。

### 说明

- **跨仓库配套（本包不含，需各自部署）**：agent-build 侧新增 `config/build.php` 的 `direct_mirror` 配置块（`DIRECT_MIRROR_ENABLED` 默认 false）、`MirrorWorkerController::pending` 捕获 worker 公网IP（优先读 `X-Worker-Public-Ip` 头，因 `TrustProxies::$proxies` 为空，`$request->ip()` 取不到家庭电脑真实IP）、`BuildRequestController::download` 用最新IP+相对路径动态拼 `preferred_url`（IP 绝不入库 `mirror_url_primary`）；agent-mirror-worker 侧新增 `public-ip.ts` 自测公网IP并经请求头上报。
- **行为兼容**：agent-build 未升级或未开 `DIRECT_MIRROR_ENABLED` 时，download 响应无 `preferred_url`，云控端落库 null、仅用 CDN，与升级前一字不差。
- **面向客户的 version.json / releases.json 按要求不暴露直连/IP/CDN 机制细节，仅以「下载更快更稳定」表述。**

## [1.6.15] - 2026-06-22

> **参考图/参考素材上传失败的报错分类（后端）**：「AI 视频」参考素材上传与生图参考图上传失败时，`VideoController::clientUploadReference` / `clientUploadImageReference` 原本把所有异常统一抹成「请稍后重试或更换更小的文件」，掩盖真实原因（独立部署排查极不友好）。改为按异常类型分类返回可自助处理的提示。**纯后端，无 migration、无新依赖、无 breaking；前端 `translateError` 对未命中映射的文案原样透传，桌面端无需改动。**

### 修复

- **参考素材上传报错按类型分类**：新增私有方法 `VideoController::referenceUploadErrorResponse(\Throwable $e, string $logTag)`，两处上传 catch 改为调用它。`\PDOException`（含 `QueryException`：缺字段 / 表不存在 / 连接失败，绝大多数是后端未执行数据库迁移、缺 `storage_driver` 字段）→ 返回「后端数据库未完成升级，请联系管理员升级后端并执行数据库迁移后重试」（`code: reference_db_error`）；其余（`StorageService::uploadAbsolute` 返回 null 抛的 `RuntimeException`、`$file->move()` 的 `FileException`，即对象存储密钥/桶/region 配错或本地存储目录不可写）→ 返回「服务器存储转存失败，请检查对象存储（COS/OSS）配置或存储目录权限」（`code: reference_storage_error`）。日志由原 `$e->getMessage()` 升级为 `get_class($e) . ': ' . message`，运维一眼区分 DB / 存储类异常。

### 说明

- 背景：有独立部署客户在「图生视频」上传参考图时看到「参考素材上传失败，请稍后重试或更换更小的文件」，但真因（多为后端未跑 migration 或对象存储未配好）被吞掉，每次都要 SSH 看日志。本次改动让前端直接显示分类原因，便于自助定位。
- 未改主链路：上传、落库、适配器映射逻辑均未动，仅改失败时的报错文案与日志。

## [1.6.14] - 2026-06-22

> **新增「店铺商品图」独立功能管理页（云控端后台）**：在「桌面端设置 → 店铺商品图」新增独立管理页（菜单始终可见）。本站未被授权管理端开放该功能时显示「请联系服务商开通」；已授权后可自定义对接商城/平台的显示名（终端用户只见此名、不暴露 ewei 品牌，为后续接入其它第三方商城预留），并按用户/分组放开使用。二级权限 `allow_ewei_shop` 默认由「开」改为「关」（默认不显示，需手动放开），并从通用「权限管理 / 套餐管理」移除、统一到独立页。**后端 + 前端改动，无 migration、无新依赖、无 breaking；桌面端有配套改动（默认隐藏 + 自定义商城名 + 去 ewei 品牌），需单独构建发版方对用户生效。**

### 新增

- **「店铺商品图」独立功能管理页（桌面端设置 → 店铺商品图）**：新建 `frontend/src/pages/ShopProductImage.tsx`（菜单始终可见）。进页查第一级授权（新增 `EweiShopController` + `GET /admin/ewei-shop/authorization`，封装 `EweiShopAuthorization`）——未授权显示「请联系服务商开通」，已授权显示两个 Tab：①基础设置：自定义「商城显示名称」（`system_settings.ewei_shop_mall_name`，经 `ClientController::myPermissions/myQuotas` 随权限下发桌面端，终端用户只见此名、不暴露 ewei 品牌，为后续接入其它第三方商城预留）；②使用权限：按用户/分组开关 `allow_ewei_shop`（复用 `PermissionController`）。另含「立即刷新授权」`POST /admin/ewei-shop/refresh-auth`（清缓存回源，配合 1.6.11 的非对称 TTL）。
- **`allow_ewei_shop` 二级权限默认改为「关」**：`QuotaService` 默认值 `true → false`——被授权站点内桌面端用户默认不显示「店铺商品图」，需在独立页按用户/分组放开（满足「默认不显示」）。同时从通用「权限管理(Permissions)」与「套餐管理(Plans)」移除该项，统一到独立页管理（避免多入口）。

### 说明

- **行为变更（需注意）**：`allow_ewei_shop` 默认值改为关闭后，升级前「被授权站点内默认全员可见」变为「默认隐藏」，管理员需到「桌面端设置 → 店铺商品图 → 使用权限」按用户/分组放开。
- **桌面端配套改动（同仓库，需单独构建发版方对用户生效）**：`stores/cloud-auth.ts` 默认拒绝 + 接收并使用商城名、`views/ewei/EweiConnectorsView.vue` 用自定义商城名替换 ewei 品牌字样；功能名「店铺商品图」保持不变。
- **无数据库 migration**：商城显示名走 `system_settings` 白名单（新增 `ewei_shop_mall_name`），二级权限复用既有 `permission_policies` 表。

## [1.6.13] - 2026-06-22

> **后台 AI PPT 入口暂时下线（前端隐藏，可逆）**：应运营要求，云控端后台暂时隐藏 AI PPT（deck）相关入口——「AI PPT 资源」菜单与「基础设置」里的「AI PPT 配图(Pixabay)」「解说 TTS」两个 Tab。均为前端可逆改动，后端实现/路由保留未删。**纯前端，无 migration、无新依赖、无 breaking。** 桌面端 AI PPT 入口与「智能体/人格规则」预设的停用为桌面端改动，需配套发桌面端版本。本包同时并入此前已开发但未单独发布的 1.6.11、1.6.12 全部改动。

### 变更

- **隐藏 AI PPT 后台入口（前端，三处）**：
  - `frontend/src/layouts/AdminLayout.tsx`：注释「AI PPT 资源」菜单项（`/deck-assets`）。
  - `frontend/src/App.tsx`：注释 `DeckAssetsPage` import 与 `deck-assets` 路由。
  - `frontend/src/pages/DesktopBasicSettings.tsx`：「基础设置」Tabs 用 `.filter` 运行时剔除「AI PPT 配图(Pixabay)」「解说 TTS」两个 Tab（保留组件引用以满足 `tsc` 的 `noUnusedLocals`）。
  - 后端 `deck-assets` / `image-search` / `audio` / `tts-providers` 路由与控制器保留未动（无入口即不被调用）。

### 说明

- 全为可逆改动，恢复时取消注释 / 去掉 filter 即可。
- **桌面端配套改动（同仓库，需单独构建发版方对用户生效）**：`MainLayout.vue` 注释 `/deck`「AI PPT」菜单、`router/index.ts` 注释 `/deck` 路由；`main/database/index.ts` 注释 `seedPresetPersonas()` / `seedPresetBots()`——新库不再预设智能体（PPT 设计师）与人格（生图提示词专家、PPT 设计师），老用户已有数据保留；`seedBuiltinPresets` / `seedBuiltinSkillPresets` 等其它预设不动。
- **并入未单独发布的版本**：1.6.11（店铺商品图授权传播提速至约 90 秒）、1.6.12（cang-api 视频服务商 model id 纠正为 seedance-2.0、恢复 1080P、扩 happyhorse-1.0 / seedance-2-vip 模型骨架、视频参考按 ref_media 放行）。

## [1.6.12] - 2026-06-21

> **cang-api 视频服务商全面修复 + 扩模型（带真实 key 实测 https://ai.772.ee 校准）**：实测确认——①预置写死的模型 id `seedance_2`(下划线) 在中转 `GET /v1/models` 列表里不存在（合法为连字符 `seedance-2.0`），是 seedance 生成的头号隐患；②`seedance-2.0` 实测 720P/1080P 均可完整出片，此前 `2026_07_18_000008` 把 1080p 误禁；③中转是 OpenAI 风味，图生视频用顶层 `media_urls` 数组（适配器现有逻辑正确，文档的 typed `input_reference` 在本中转被拒 `cannot unmarshal array into ... type string`），故核心修复**无需改适配器、仅 migration 纠正配置**。同时放开视频参考、扩多图参考，并预置 `happyhorse-1.0` / `seedance-2-vip` 两个模型骨架（SKU 默认禁用，待管理员定价后启用）。**后端改动 + 2 个幂等 migration，无新依赖、无 breaking，桌面端无需配套升级（音频参考、首尾帧、grok 留待后续）。**

### 修复

- **cang-api seedance 模型 id 纠正**：`database/migrations/2026_07_25_000007_fix_cang_api_seedance_model_id_and_caps.php`（幂等）把 `video_model_specs` / `video_sku_prices` 里 cang-api 的 `seedance_2` 纠正为中转合法的 `seedance-2.0`（`sku_key` 保持不变，避免桌面端选 SKU 失效；不回填历史 `video_tasks` 快照）。实测 `GET https://ai.772.ee/v1/models` 不含 `seedance_2`、含 `seedance-2.0`，旧值提交必失败。
- **放回 1080p 能力**：同 migration 把 `supported_resolutions` 改回 `["720p","1080p"]`，重新启用被 `000008` 禁用的 cang-api 1080p SKU（实测 seedance-2.0 1080P 完整出片）。
- **剔除中转不支持的比例**：`supported_aspect_ratios` 由含 `21:9`/`adaptive` 收敛为中转 / 内置 `size` 映射均支持的 `["16:9","9:16","1:1","4:3","3:4"]`，并把 `max_reference_images` 由 1 提到 4（实测支持多图）。

### 新增

- **视频参考素材按模型能力放行**：`app/Services/Video/VideoSkuSupportService.php::assertAssetsSupported` 改为按 `provider_params.ref_media` 白名单驱动（新增私有 `allowedRefMedia()`），不再硬编码 `provider_protocol==='seedance'`。**向后兼容**：seedance 协议仍图/视频/音频全放行；其它协议默认仅图片，显式声明 `ref_media` 才放行视频/音频。cang-api seedance-2.0 设 `ref_media:["image","video"]`，开放多图与视频参考（音频参考需桌面端能力表配合，本轮不做）。
- **扩模型骨架（`database/migrations/2026_07_25_000008_seed_cang_api_extra_video_models.php`，幂等，SKU 默认禁用）**：在 cang-api 下预置 `happyhorse-1.0`（文/图生视频）与 `seedance-2-vip`（真人满血，占位算力约标准 3 倍）两个模型规格 + `5/10/15s × 720p/1080p` 骨架 SKU（`status=disabled`、占位算力）。实测二者均接受同一请求体（happyhorse 完整出片；vip body 被接受、仅余额不足未跑完）。管理员到后台「AI 视频 → SKU 与价格」定价并启用 SKU 后对终端用户可见。

### 说明

- **适配器零改动、风险最低**：实测当前 `OpenAiVideoProvider` 的请求体形状（顶层 `size`+`seconds`+大写 `resolution`、图生用 `media_urls` 数组）在 model id 纠正后即与中转契约一致，故本次不动适配器代码（共享类，避免波及其它 openai_video 上游）。
- **已部署实例自动修复**：点「在线更新」拉到本版后，`UpdateService::phaseMigrate` 自动执行上述幂等 migration，DB 配置即被纠正 / 扩充，无需人工 SQL。已启用 cang-api 的实例 seedance 立即恢复正常并解锁 1080p / 多图 / 视频参考；新模型需管理员定价后启用。
- **暂缓项**：首尾帧（中转 first/last 帧字段未确认）、音频参考（需桌面端 `PROTOCOL_CAPABILITIES` 放行 openai_video 音频）、grok-imagine（图生、契约与 seedance 不同，待单独实测）。

## [1.6.11] - 2026-06-21

> **「店铺商品图」授权传播延迟优化**：授权管理端（agent-build）开通某云控端的店铺商品图功能后，云控端因缓存最长需约 10 分钟才生效；本次改为非对称 TTL —— 已授权稳态仍缓存 10 分钟（省回源），未授权状态只缓存 90 秒，使新授权最长约 90 秒即可在桌面端生效。**纯后端，无 migration、无新依赖、无 breaking。**

### 修复

- **`EweiShopAuthorization` 非对称 TTL**：原 FRESH 缓存对「已授权(true)」与「未授权(false)」统一缓存 10 分钟，导致授权端刚开通后云控端最长 10 分钟仍下发 `false`。改为：探测到 `true` 缓存 10 分钟（稳态省回源）；探测到 `false` 只缓存 90 秒（`PENDING_TTL`），授权端开通后约 90 秒内即可传播到桌面端。该短缓存仅作用于「域名已授权但功能未开通」这一精确人群（`auth-check` 返回 200 + `authorized`），未绑定域名仍走失败兜底 60s，常态回源增量极小。

### 说明

- 仅影响店铺商品图授权状态的传播时效，不改变两级门控逻辑（一级云控端授权 AND 二级 per-user 权限），桌面端无需配套升级。

## [1.6.10] - 2026-06-21

> **AI PPT 后台三处易用性细化**：①deck 资源页状态 / 类型显示中文、模板未就位提示不再暴露内部细节（pack-deck-templates / manifest url），改为「请联系服务商」；②「Pixabay 配图」与「解说 TTS」两项设置统一收纳到「桌面端设置 → 基础设置」的分页 Tab。**纯前端调整，无后端改动、无 migration、无新依赖、无 breaking。**

### 变更

- **deck 资源页（`DeckAssets.tsx`）文案与状态本地化**：状态 `ready/pending/failed` 显示为「就绪 / 待拉取 / 失败」，类型 `template` 显示为「模板」；模板清单未就位的提示去掉面向运维的技术细节（不再显示 `pack-deck-templates` / `manifest.json` 上传地址），改为「模板资源尚未就绪，请联系服务商」。
- **「基础设置」改为分页 Tab（`DesktopBasicSettings.tsx`）**：原单页「桌面端外观」扩为三个 Tab —— 桌面端外观 / AI PPT 配图（Pixabay）/ 解说 TTS。Pixabay 配置从「系统设置」的独立 Tab（1.6.9 加）移入；解说 TTS 直接复用 `TtsProviders` 组件渲染在 Tab 内。
- **移除冗余入口**：`Settings.tsx` 删去「AI PPT 配图」Tab 及其 state / 加密字段 / load / submit 处理；`AdminLayout.tsx` 移除「桌面端设置」分组下独立的「解说 TTS」菜单项（`/tts-providers` 路由保留，内容已并入基础设置 Tab）。

### 说明

- 纯前端归类调整，读写的后端接口（`settingApi` 的 pixabay 字段、`ttsProviderApi`）与数据均未变；管理员操作位置变化：Pixabay 与解说 TTS 现都在「桌面端设置 → 基础设置」内。桌面端无需配套升级。

## [1.6.9] - 2026-06-21

> **AI PPT 配套后台两处易用性改进**：①Pixabay 配图配置从误置的「注册策略」Tab 移到独立「AI PPT 配图」Tab；②deck 资源（ffmpeg / 模板）管理从「手动登记 source_url / 粘贴 manifest」改为「自检完备性 + 一键拉取缺失」。**纯前端 + 后端只读自检 / 拉取接口，无 migration、无新依赖、无 breaking。**

### 变更

- **Pixabay 配置移到独立 Tab**：1.6.8 误把「Pixabay 图片搜索」配置卡放在 `frontend/src/pages/Settings.tsx` 的「注册策略」Tab 末尾（紧跟短信验证），管理员在系统设置里找不到。本次抽为独立 Tab（`key=pixabay`「AI PPT 配图」），与 changelog 指引「系统设置 → Pixabay 图片搜索」一致。纯前端调整，读写的 SystemSetting key（`pixabay_enabled` / `pixabay_api_key`）与下发逻辑均未变。

### 新增

- **deck 资源完备性自检 + 一键拉取**：新增 `config/deck.php`（母 CDN 约定：`mother_cdn` 默认 `https://your-cdn-domain.example.com`、`template_manifest_url` 默认 `.../pptdemo/manifest.json`、ffmpeg 平台 / 二进制清单，均可 env 覆盖）。`DeckResourceAssetController` 新增 `check`（`GET /admin/deck-assets/check`：对比 ffmpeg 内置 6 项期望 + 母 CDN 模板 manifest 期望 vs 已 ready 资产，返回缺口）与 `sync`（`POST /admin/deck-assets/sync`：把缺失 / 版本变化项置 pending 后分批 `pullAsset`，返回 remaining 供前端循环）。前端 `DeckAssets.tsx` 去掉「添加资产」「粘贴 manifest」两个表单，改为 ffmpeg / 模板两个区块各显示完备度 + 「检查并拉取缺失」，表格保留单条「重新拉取 / 删除」。

### 说明

- **运维流程变化**：管理员不再手填资产 / 粘贴 manifest，改为把 ffmpeg 二进制上传到 `{mother_cdn}/ffmpeg/{platform}/{ffmpeg|ffprobe}{.exe}`、模板清单上传到 `{mother_cdn}/pptdemo/manifest.json`，后台自检后一键拉取固化。底层 `pullAsset` / `clientManifest` / `deck_resource_assets` 表不变；旧的 `store` / `bulk-import` / `pull-pending` 接口保留未删（前端不再调用）。
- **无 migration**：复用既有 `deck_resource_assets` 表；`config/deck.php` 为新增配置文件，生产在线更新会自动 `config:cache`。桌面端无需配套升级。

## [1.6.8] - 2026-06-21

> **网关图片生成支持按 URL 接收参考图（参考图不再走 base64 内联）**：配合桌面端 0.9.0——云端生图的参考图 / 蒙版改为先经 `/client/images/reference-assets` 上传换临时 URL，网关再按 URL 读回字节转发上游。请求体不再夹带大段 base64，链路与日志更轻、排查更快。**后端改动，无 migration、无新依赖、无 breaking、向后兼容老链路（仍接受 `images` / `mask` 的 base64）。**

### 新增

- **图片任务支持 `image_urls` / `mask_url` 入参**：`app/Jobs/ProcessImageTaskJob.php` 新增 `materializeReferenceUrls($body, $userId)`，在转发上游适配器前把 body 里的 `image_urls` / `mask_url` 读回裸 base64 填入适配器认识的 `images` / `mask` 字段，**上游适配器层零改动**。防 SSRF：只放行确实是本站为该用户签发的临时素材（`temporary_reference_assets` 表内 `storage_url` + `user_id` 命中），其余 URL 一律忽略、绝不下载任意外部 / 内网地址；读取走 `StorageService::readBytes`，兼容 cos / oss / local 三种存储后端。

### 说明

- **发布顺序**：需先升级本云控端、再发桌面端 0.9.0。否则老网关不识别 `image_urls`，会把它当普通字段透传给上游 → 上游忽略 → 静默丢参考图（生成一张无参考图的图，且不报错）。
- **向后兼容**：老桌面端仍直传 `images`(base64) / `mask`(base64) 的请求不受影响——`materializeReferenceUrls` 检测不到 URL 字段即原样返回。
- **意外的健壮性提升**：`image_urls` 会随 `request_body` 入库，即使 Cache（30min TTL）失效，Job 仍可从库中拿回 URL 重新读图；老 base64 链路 Cache 失效则会丢参考图。
- 桌面端三处配套改动：新增共享上传模块 `cloud-image-asset.ts`；`llm.ts` 视觉发图（图生词 / 聊天看图 / 画布帧分析，仅云端模型）换 URL；`image-generation.ts` `callCloudImageAPI` 改发 `image_urls` / `mask_url`。自定义直连 provider 按产品决策保持 base64 不变。

### 新增（店铺商品图功能两级授权门控）

- **第一级（授权端 → 云控端）**：新增 `app/Services/CloudBuild/EweiShopAuthorization.php`，缓存读取授权管理端 `auth-check` 的 `can_use_ewei_shop`（10 分钟 fresh + 24h last-known-good 兜底 + 失败 60s 防请求风暴 + fail-closed），判定「本云控端实例是否被授权使用店铺商品图功能」。
- **第二级（云控端 → 用户）**：`app/Services/QuotaService.php::policies()` 默认值新增 `allow_ewei_shop=true`（照搬抠图：被授权后默认用户可用，可在「权限策略 / 套餐」对指定用户/分组关闭）；前端权限页 `frontend/src/pages/Permissions.tsx`、套餐页 `Plans.tsx` 新增 `allow_ewei_shop` 权限项。
- **两级合并**：`ClientController::myPermissions` / `myQuotas` 下发给桌面端的 `allow_ewei_shop` = 第一级(云控端被授权) AND 第二级(用户级权限)。云控端未被授权 → 全员 false → 桌面端隐藏入口；被授权 → 按 per-user 权限放行。**无 migration、无新依赖、无 breaking。**

### 说明（店铺商品图授权部署）

- **发布顺序**：先升级授权管理端 agent-build（≥0.14.0，`auth-check` 返回 `can_use_ewei_shop`）→ 再升级本云控端 → 最后发桌面端 0.9.0。否则桌面端默认 false 隐藏入口、授权链不通。
- **生效时延**：授权端的授权变更，本云控端最长 10 分钟生效（`EweiShopAuthorization` 缓存）；per-user 权限即时生效。

### 新增（AI PPT 配图三级降级之「真实素材图」服务端代理）

- **Pixabay 图片搜索代理**：新增 `app/Http/Controllers/ImageSearchController.php`（`GET /api/client/image-search?query=&per_page=`），服务端代调 Pixabay（`image_type=photo` / `safesearch=true`），把 `largeImageURL` / `previewURL` 整理成 `{url,thumb,width,height}` 下发。这是桌面端 0.9.0「AI PPT」取配图时三级降级的第一级（真实素材图 → AI 生图 → 自绘装饰图），key 留服务端、绝不接触客户端。
- **Pixabay 配置走「系统设置」（不走 `.env` / config 文件）**：`app/Models/SystemSetting.php` 的 `ALLOWED_KEYS` 新增 `pixabay_enabled`(bool) + `pixabay_api_key`(encrypted——`Crypt` 加密存储、`getValue` 解密回明文供服务端代调、绝不下发前端，前端只收 `has_pixabay_api_key` 标记)；`ImageSearchController` 从 `SystemSetting::getValue` 读取（未启用 / 未配 key 时返回空结果）。前端 `frontend/src/pages/Settings.tsx` 新增「Pixabay 图片搜索」配置卡（启用开关 + `Input.Password` key，照 sms / wxpay 加密字段范式：`ENCRYPTED_FIELDS` + 留空保持不变）。`routes/api.php` 的 `client` 组新增 `GET /image-search`。

### 说明（Pixabay 配图）

- **无 migration、无新依赖、无 breaking**：`SystemSetting` 是 key-value 白名单表，加 key 即加行；未配置时不影响任何现有功能。
- **可选能力，发布顺序无强约束**：不开启 / 不配 key 时，桌面端 AI PPT 配图自动走「AI 生图 + 自绘装饰图」两级，功能不受影响、不报错；后台开启并填入 Pixabay key 后，真实图库素材作为第一优选生效。key 免费获取：`pixabay.com/api/docs`。

## [1.6.7] - 2026-06-15

> **修复 cang-api（New API 中转 → 字节 seedance）视频生成报分辨率错误**：接口方升级后，cang-api 的 seedance 渠道要求请求显式携带分辨率档位（顶层 `resolution`，大写 `720P` / `1080P`）。原 `OpenAiVideoProvider` 只发 OpenAI 标准的 `size=宽x高`，中转无法反推，上游异步执行报 `Input should be '1080P' or '720P': parameters.resolution`。本次给 `OpenAiVideoProvider` 增加可配置的分辨率 / 比例字段注入，并用 migration 给所有 cang-api 模型规格补 `resolution_param` 配置。同时补上「视频提交载荷落库」改进——把实际发给上游的请求体写入任务记录，便于日后排查参数类问题。**后端改动 + 1 个幂等 migration，无新依赖、无 breaking，前端零改动。**

### 修复

- **cang-api seedance 视频分辨率参数**：`app/Services/Video/Adapters/OpenAiVideoProvider.php::buildSubmitPayload` 在 `size` 之外新增可配置注入——`provider_params.resolution_param` 指定字段名后，把 `request_params.resolution`（内部小写档位）经新增的 `resolutionTier()`（`strtoupper`：720p→720P / 1080p→1080P / 4k→4K）以**顶层标量字段**发出；同理预留 `aspect_param` 注入画面比例。两者默认不配置则不发送，保持对标准 sora 及其它 openai_video 上游的兼容。实测确认该中转**不接受嵌套 `parameters` 对象**（会报错），故只发顶层字段；画面比例仍由保留的 `size=宽x高` 承载。

### 变更

- **预置 cang-api 模型规格补 `resolution_param`**：新增 migration `2026_07_25_000004_add_resolution_param_to_cang_api_specs.php`，遍历 `provider_key=cang-api` 的 `video_model_specs`，给 `provider_params` 补 `"resolution_param":"resolution"`（幂等，已配置则跳过；仅 `Schema::` / `DB::` 原生 API，不 import 业务 Model）。各独立部署站点在线更新后自动生效。
- **视频提交载荷落库**：`VideoSubmitResult` 新增 `submitPayload` 字段，`OpenAiVideoProvider` / `DuomiVideoProvider` 的 `submit()` 回传实际请求体，`ProcessVideoSubmitJob` 在提交成功 / 失败时一并写入 `video_tasks.submit_payload`。该字段建表（`2026_05_26_000001`）即有、后台任务详情（`serializeTask` admin 分支）早已展示，但此前从无写入、一直为空。落库后排查上游「参数错误 / 生成失败」类问题可直接在任务详情查看发出的请求体，无需翻代码或真实实测。字段已存在，故无表结构变更、无 migration。

### 说明

- cang-api 视频生成本身较慢（720p 约 90 秒，长时长可达 18~31 分钟），生成中查询状态为 `unknown` 属正常，由既有 1 小时轮询超时兜底，本次未改该逻辑。
- 桌面端无需配套升级：分辨率档位由桌面端按原样（小写）上传，大小写转换在云端完成。

## [1.6.6] - 2026-06-14

> **「登录页背景图 / 主题主色」迁移到独立菜单页**：这两项是**下发给桌面端**的站点级外观配置，原先放在「系统设置 → 系统配置」的「站点」Tab，容易被误认为是云控端后台自身的设置。本次抽出为「桌面端设置」分组下的独立页「基础设置」。**纯前端调整，后端零改动、无 migration、无新依赖、无 breaking**，下发协议与 1.6.5 完全一致，桌面端无需配套升级。

### 新增

- **「桌面端设置 → 基础设置」页**：新增 `frontend/src/pages/DesktopBasicSettings.tsx`，承载「登录页背景图」上传（预览 / 更换 / 移除）与「主题主色」`ColorPicker`，独立 `load` / `handleSave`，仅读写 `login_background_url`、`theme_primary_color` 两个 key（走 `settingApi.update` 白名单部分更新，不触碰其他系统设置）。`App.tsx` 注册路由 `/desktop-basic-settings`；`AdminLayout.tsx` 在 `group-desktop` 分组加菜单项并补 `pathToGroupKey` 映射。

### 变更

- **`Settings.tsx`「站点」Tab 移除外观字段**：删去「登录页背景图」「主题主色」两个 `Form.Item`（及隐藏字段、`bgUploading` / `loginBgUrl` 状态、`load()` 里的主题色回填），原位置改为一条指向「桌面端设置 → 基础设置」的 `Alert` 提示；清理随之无用的 `Upload` / `ColorPicker` / `UploadOutlined` / `DeleteOutlined` / `cloudBuildApi` import。站点标题保留原位。

### 说明

- 后端 `SystemSetting` 白名单、`SettingController::publicConfig()` 下发块、上传端点 `POST /api/admin/cloud-build/login-background` 全部沿用 1.6.5，未改动；本次仅调整管理后台这两项配置的归属页面。

## [1.6.5] - 2026-06-14

> **登录页自定义背景图 + 全局主题色（云控端可配）**：新增两项站点级白标配置，经 `/api/public/site-config` 下发给桌面端——登录页全屏背景图、全局主题主色。后端纯 KV 配置 + 复用云打包图片上传基础设施，**无 migration、无新依赖、无 breaking**，配合桌面端 0.8.5。

### 新增

- **登录页背景图 + 全局主题色配置**：`SystemSetting::ALLOWED_KEYS` 新增 `login_background_url`、`theme_primary_color` 两个白名单 key（KV 表，无需 migration）；`SettingController::publicConfig()` 增加 `login_background.url` 与 `theme.primary_color` 下发块。前端 `Settings.tsx`「站点」Tab 新增「登录页背景图」上传（预览 / 更换 / 移除）与「主题主色」`ColorPicker`（含常用色预设），`theme_primary_color` 经 `getValueFromEvent` 存 hex 字符串。
- **登录背景图上传端点**：`CloudBuildIconController::uploadLoginBackground`（PNG/JPEG/WebP ≤5MB、不限宽高比、存 `cloud-build/login-bg`，复用 `StorageService::uploadAbsolute`，local/COS/OSS 通用返回绝对 URL）；新增路由 `POST /api/admin/cloud-build/login-background`；`api.ts` 增 `cloudBuildApi.uploadLoginBackground`。

### 说明

- 桌面端需更新到 0.8.5 才能消费这两项配置；未配置时桌面端使用内置品牌橙背景 + 默认主色，行为与升级前一致。
- 主题色仅下发一个主色（hex），桌面端用 tint/shade 混合法派生整套 50~900 色阶并注入 CSS 变量换肤，548 处 `primary-*` 引用零改动。

## [1.6.4] - 2026-06-13

> **一批用户体验与独立部署修复**：根治「有余额却报模型无响应（可能余额不足）」误导文案——网关流式失败改为向 SSE 注入精确 error 事件；后台套餐到期状态由读存储 `status` 改为按 `expires_at` 实时派生；云存储容量后台输入由字节改 GB；独立部署云打包「无法读取图标」根因（`APP_URL` 误配）兜底。**无 migration、无新依赖、无 breaking**，配合桌面端 0.8.4。

### 修复

- **「模型无响应（可能余额不足）」误报（根治）**：流式响应 HTTP 状态首字节即固定 200，过去上游 silent-200 空流 / 4xx-5xx / 连接失败时网关只记 failed UsageRecord、不向流内写错误，桌面端只见空流 → 误判「可能余额不足」。`NewGatewayService::handleStreamChat` 新增 `emitStreamError()`，在「2xx 零分片」「非 2xx」「异常」三处向 SSE 注入标准 `data:{"error":{message,type}}` + `[DONE]`，并按 httpCode 翻译中文（429 限流 / 401-403 鉴权 / 5xx 上游不可用）；`$sawChunk` 标记区分真空流与有内容，扣费逻辑不受影响。配合桌面端 `llm.ts` 把空流文案去掉「可能余额不足」+ 解析注入的 error 事件。
- **后台套餐状态展示滞后**：`UserPlans.tsx` / `UserDetailModal.tsx` / `UserPlanQuotas.tsx` 状态列由直读存储 `status` 改为按 `expires_at` 实时派生（`effective*Status`：`status==='active'` 且 `expires_at<=now` → 显示「已过期」），消除到期后最长约 1 小时内仍显示绿色「生效中 / 可用」、与同行到期时间自相矛盾的问题；`plan:expire` 定时任务 `->hourly()` 改 `->everyTenMinutes()` 缩小存储字段滞后窗口。实际权益闸门本就按 `expires_at` 实时判定，不受影响。
- **独立部署云打包「无法读取图标，请确认图标地址可正常访问」**：`StorageService::uploadAbsolute` 拼图标绝对 URL 裸用 `config('app.url')`，独立部署 `APP_URL` 为空 / `localhost` / 照抄官方域名时 URL 外部（GitHub runner）不可达，`CloudBuildIconValidator` 打包时 HTTP 回读取不到 → 报错（上传走本地文件校验故不报）。新增 `absoluteBase()`：`APP_URL` 为空或指向 `localhost`/`127.0.0.1`（含带端口）时回退 `request()->getSchemeAndHttpHost()`；`CloudBuildIconValidator::fetchBytes` 在 HTTP 取不到且为 local 存储时按 URL path 回退本机 `public/` 读盘（兼修历史已存的错误绝对 URL）；报错文案补 `APP_URL` 排查提示；`.env.example` 的 `APP_URL` 不再预填官方域名（改 `http://localhost`）。

### 变更

- **余额不足报错统一中文 + balance_type**：`GatewayController` 对话 / 向量 / 生图三处 402 响应补 `balance_type` 字段（token/credit），与桌面端 `cloud-api.ts` 充值引导契约对齐（配合桌面端 `llm.ts` 对 402 直接抛中文 `CloudBalanceError`，让识图 / 提示词优化等非对话路径也中文友好）。
- **云存储容量后台输入改 GB**：`Plans.tsx`「云存储容量」与 `Settings.tsx`「注册默认赠送容量」输入由字节改 GB（虚拟字段 `storage_quota_gb` / `storage_default_gb`，加载 ÷1073741824、提交 ×1073741824 取整），与套餐列表 / 桌面端 GB 展示统一，杜绝把 GB 数量级误填成字节导致桌面端容量显示成「5 B」；后端存储字段（`storage_quota_bytes` / `storage_default_bytes`）与接口契约不变。

## [1.6.3] - 2026-06-11

> **打包平台站点身份自动解析（根治「域名已授权却被拒 / agent-build 拒绝：unknown」）**：此前调用 agent-build 时的 Origin 每次运行时推导（`getSchemeAndHttpHost()`），反代 scheme 误判、用 IP / 备用域名访问后台、cron 无 HTTP 上下文退化到 `APP_URL(localhost)` 等场景都会推错，表现为「域名明明已授权却被拒」。1.6.3 起改为「候选收集 → 验证锁定 → 失败自愈」的自动身份机制，全程无 UI、不依赖 .env、用户不可见不可改；并消灭 "agent-build 拒绝：unknown" 黑盒文案。**无 migration、无新依赖、无 breaking，建议配合 agent-build 0.13.0。**

### 新增

- **`backend/app/Services/CloudBuild/BuildIdentityService.php`**：打包平台站点身份服务。管理后台 HTTP 请求中静默记录候选 origin（支持域名 / 公网 IP / 内网 IP / 带端口，仅排除 localhost / 回环地址——IP 部署 + IP 授权是受支持形态）；调用前依次用候选探测 `auth-check`，通过即锁定落库（直存 `system_settings` 表，不进 `SystemSetting::ALLOWED_KEYS` 白名单，因而不被设置接口暴露、无任何可视化入口）；页面请求 / cron / 队列统一复用锁定身份。
- **身份失败自愈**：`AgentBuildClient::call()` 收到 `domain_not_authorized` 时自动重新解析候选并锁定新身份、原请求重试一次（10 分钟冷却 + 单次重试 + 探测期不重入三重防护）。平台端换绑域名、推导环境变化均无需人工干预。

### 修复

- **"agent-build 拒绝：unknown" 黑盒文案（根治）**：SDK 对非 2xx 且无 `error` 字段的 JSON 响应（如 Laravel 限流 429 的 `{message: "Too Many Attempts."}`、网关 JSON 拦截页）合成 `_error = http_{status}`；`authCheck` / `templateInfo` 的 messageMap 补 `http_429` / `rate_limited` 条目与 `http_*` 通用兜底翻译。任何异常从此都显示具体状态与中文原因。
- **授权失败必显当前站点域名**：未授权文案改为「当前域名：xxx.com 尚未获得打包平台授权…」（agent-build 回显的 origin 优先、SDK 当前身份兜底，统一压成「域名[:端口]」友好形态）；其余失败场景（网络不可达 / 限流 / 异常状态）文案末尾追加「（当前站点域名：xxx）」，授权排查所见即所得，响应 `origin` 字段同步兜底不再为空。
- **cron / 队列环境身份错误**：`cloud-build:pull` 等 console 任务此前取 `APP_URL`（常为 Laravel 默认 `localhost`）导致拉产物一直被拒；现统一使用锁定身份。

### 变更

- 三个共享库客户端（`AgentHubClient` / `InspirationHubClient` / `CreativeTemplateHubClient`）的 `origin()` 统一优先使用锁定身份（未锁定时回退原推导链，行为与旧版一致）——灵感广场 / 创意模板 / 智能体市场与云打包共用同一可靠身份。

## [1.6.2] - 2026-06-11

> **云同步服务端健壮性整修（配合桌面端 0.8.2）**：修复多设备并发 push 撞 `(user_id, server_seq)` 唯一键导致整批 500 的竞争问题；push 增加 blob 引用完整性与 entity/uid 列宽校验（不合法单条 `rejected`，不再拖累整批）；分块上传接口加固；补齐 GC 秒传竞态续期与上传临时目录回收；移除从未维护的 `sync_blobs.ref_count` 摆设字段。升级后无行为开关变化，对旧版桌面端（0.8.0/0.8.1）完全兼容。

### 修复

- **并发 push 整批 500**：`SyncService::push` 用 `GET_LOCK("sync_push_{userId}", 10)` 将同一用户的 push 串行化——事务内 `max(server_seq)` 是无锁快照读，两台设备并发会分配相同 seq 撞唯一键；行级 `lockForUpdate` 顺序由客户端给定也可能互为死锁。拿不到锁返回空结果，客户端 oplog 保留下次重试。
- **秒传 × GC 竞态**：`BlobController::check` 对已存在的 committed blob 续期 `updated_at`，刷新 `sync:gc-blobs` 的 24h 宽限窗口，堵住「失引用超宽限 → 客户端秒传跳过上传 → 恰被 GC 回收 → 记录引用已删 blob 且无人重传」的闭环缺口。

### 变更

- **push 引用完整性校验**：非删除变更引用的 blob 必须已 committed，否则该条返回 `status=rejected, reason=blob_missing`（此前完全不校验 `blobs` 字段，缺媒体的记录会让其它设备对该 blob 永久 404 重试）；同时校验 entity 格式（`/^[a-z0-9_]{1,40}$/`）与 uid 长度 ≤64，超限单条 `rejected`，避免 MySQL 列宽报错使整批 500。
- **分块上传接口加固**：`BlobController::chunk` 必须先 `init`（目录不存在返回 422，堵住绕过配额/大小校验直接堆积分块）、`index` 上界 100000、单分块 ≤8MB、拒绝空分块。
- 新增命令 `sync:purge-tmp`（清理 48h 无写入的断点续传残留目录 `storage/app/sync-tmp/{user}/{sha}`，此前永不回收），`Console/Kernel.php` 每日调度。

### Migration

- `2026_07_25_000003_drop_ref_count_from_sync_blobs.php`：移除 `sync_blobs.ref_count`（从未被任何代码维护恒为 0，blob 回收实际靠扫描 `sync_records.payload` 计算引用集合；含 `hasColumn` 守卫，对全新安装与已升级实例均幂等）。`SyncBlob` 模型同步移除 `fillable` / `casts` 中的该字段。

## [1.6.1] - 2026-06-08

> **修复套餐编辑弹窗「云存储容量」字段溢出弹窗（纯前端，零后端 / 零 migration）**：套餐新建 / 编辑弹窗中「Tokens 赠送 / 太币赠送 / 云存储容量」一行用固定像素宽度 + 后缀（`字节` / 动态币种文案），三字段总宽超出 640px 弹窗内容区，导致「云存储容量」溢出右边界。改为响应式栅格自适应等分，彻底不再溢出。

### 修复

- `frontend/src/pages/Plans.tsx`：套餐编辑弹窗的两组数值字段行（`时长/价格/排序`、`Tokens赠送/太币赠送/云存储容量`）由固定宽度 `Space` 改为 `Row gutter={16}` + `Col span={8}` 响应式栅格，`InputNumber` 宽度统一改为 `100%`，无论后缀与币种文案多长都在弹窗内自适应等分，不再溢出弹窗边界。

## [1.6.0] - 2026-06-08

> **云同步与容量计费（配合桌面端 0.8.0）**：新增桌面端账号数据的云端增量同步与媒体 blob 存储，并接入存储容量计费（声明式配额 = 默认赠送 + 套餐容量；超额策略可配）。blob 落地复用资源存储（local/COS/OSS），私有读（COS/OSS 预签名 URL、local 鉴权代理流式），大文件全程流式（分块上传 / 流式拼接 / 流式上传对象存储）。同步开关默认开启、容量计费默认关闭，升级后行为与现状一致。

### 新增

- 迁移：`sync_records`（每用户 `server_seq` 游标 + payload 快照）、`sync_blobs`（per-user 去重 + 引用）、`sync_devices`、`user_storage`；并为 `plans` 加 `storage_quota_bytes`、`user_plans` 加 `storage_granted`。
- 模型：`SyncRecord` / `SyncBlob` / `SyncDevice` / `UserStorage`。
- `app/Services/SyncService.php`：增量 `pull` / `push`，行级 `base_rev` 乐观并发冲突判定，敏感字段（`model_providers.api_key`）服务端加密存储 / 下发解密。
- `app/Services/StorageQuotaService.php`：声明式配额（默认 + Σ 有效套餐 `storage_granted`）、用量增量维护与对账、超额拦截。
- `app/Http/Controllers/SyncController.php`：client `sync/pull|push|quota` 与 admin `sync-storage/stats|users|reconcile|recompute`。
- `app/Http/Controllers/BlobController.php`：`check`（秒传）/ `init` / `chunk` / `complete`（分块断点续传 + 流式拼接）/ `raw`（预签名 URL 302 直连，兜底鉴权代理）。
- `StorageService`：`putFile`（COS Guzzle 流式 / OSS `uploadFile` / local copy）、`signedUrl`（COS/OSS 预签名）、`readBytes`（代理兜底）。
- 命令：`sync:reconcile-storage`、`sync:gc-blobs`（`Console/Kernel.php` 每小时调度）。
- 后台：系统设置「数据同步」Tab、套餐「存储容量」字段、「云同步存储」用量管理页（`SyncStorage.tsx`）、侧栏「计费财务」入口、`syncStorageApi`。

### 变更

- `PlanService` / `PaymentController` / `PlanController`：套餐发放、订单快照、增改表单全链路贯通 `storage_quota_bytes`；存储扩容包可做成「存储类套餐」复用现有下单支付与兑换码。
- `SystemSetting`：新增 `sync_enabled`、`storage_default_bytes`、`storage_billing_enabled`、`storage_overage_policy`、`sync_max_blob_mb`。
- `routes/api.php`：新增 `client/sync/*` 与 `admin/sync-storage/*`。

### Migration

- `2026_07_25_000001_create_sync_tables.php`、`2026_07_25_000002_add_storage_fields_to_plans.php`（纯增量、不改历史迁移，遵循 Migration 铁律）。

### 修复

- **OEM / 普通云打包图标 PNG 严格校验**：堵住「`icon_url` 可手动填写 / 复用任意 URL」绕过上传控件强校验的缺口——此前非 PNG 图标（如 JPEG logo）会一路传到 GitHub Actions 才在 `inject-build-params.js` 报晦涩的 `magic mismatch`，且云控端失败记录无可读原因。
  - 新增 `app/Services/CloudBuild/CloudBuildIconValidator.php`：下载 `icon_url` 后校验「真实 PNG + 1:1 正方形 + 512×512–1024×1024 + ≤2MB」，规则与 GitHub runner 的 `validatePng` 对齐（对象存储默认域名走签名读取，自定义 CDN / 外链走 HTTP 并跳过证书校验）。
  - `OemProjectController`（创建 / 编辑 / 发起打包）与 `CloudBuildController`（发起打包 / 图标落库）在落库 / 派发前同步把关，不合规立即返回 `invalid_icon` + 明确中文 `message`，不再浪费 GitHub Actions 配额。
  - 前端图标规则文案明确为「512×512–1024×1024 正方形 PNG」，并提示手动填写的 URL 同样必须是合规 PNG；OEM / 普通打包页保存 / 提交失败时优先展示后端返回的 `message`。
  - 配套授权管理端 agent-build 0.12.1 在派发前增加同一套 PNG 兜底校验（第二道防线，覆盖未升级的老云控端）。

## [1.5.45] - 2026-06-08

> **手机号验证码注册 + 短信找回密码（对接阿里云短信，增量 migration）**：新增阿里云短信能力，支持后台可开关的「注册短信验证」与「短信找回密码」。短信发送在服务端用 Guzzle 自实现阿里云 RPC 签名（不引入新 SDK，零依赖冲突 / 不增大更新包）；验证码走 Cache 存储 + 多层限流。需配合桌面端 0.7.21。所有开关默认关闭，升级后行为与现状一致。

### 新增

- `app/Services/Sms/AliyunSmsService.php`：阿里云短信发送（Dysmsapi 2017-05-25），Guzzle 直连 + HMAC-SHA1 RPC 签名；AccessKey 仅服务端使用、加密存储、绝不下发桌面端。
- `app/Services/Sms/SmsCodeService.php`：验证码生成 / 校验 / 限流（同号 60s 间隔 + 单号每日上限 + 一次性消费防重放），按「场景 + 手机号」隔离验证码。
- `AuthController`：新增 `sendSmsCode`（`POST /auth/sms/send`，throttle 5/min）、`resetPassword`（`POST /auth/password/reset`，throttle 10/min）。
- `SettingController::smsTest`（`POST /admin/settings/sms-test`，throttle 5/min）：后台发送测试短信验证配置可用性。
- `database/migrations/2026_07_19_000001_add_unique_index_to_users_phone.php`：`users.phone` 加唯一索引（先清洗历史空串 / 重复手机号），支撑手机号唯一定位用户。
- `SystemSetting`：新增 `sms_*` 系列配置（AK/SK、签名、模板 CODE、有效期 / 间隔 / 日上限）+ `register_sms_verify_enabled` / `forgot_password_enabled` 开关，默认全关。

### 变更

- `AuthController::register`：开启「注册短信验证」时手机号必填 + 全局唯一 + 校验验证码；手机号统一存 `NULL`（而非空串）以兼容唯一索引。新增发注册验证码时校验「注册开放」开关。
- `SettingController::publicConfig`：新增下发 `register.sms_verify_enabled`、`forgot_password.enabled`，供桌面端决定是否展示验证码输入 / 找回密码入口。
- `frontend/src/pages/Settings.tsx`：「注册策略」Tab 新增「短信验证（阿里云）」配置卡片（签名 / 模板 CODE / AccessKey / 有效期 / 限流 / 注册验证开关 / 找回密码开关 + 发送测试短信）。

## [1.5.44] - 2026-06-07

> **「SKU 与价格」增加按服务商筛选 + SKU 列高亮服务商（纯前端，零后端 / 零 migration）**：接入多个服务商后，SKU 列表难以按服务商定位。本次在 SKU 与价格页新增「服务商」筛选下拉，并在列表新增高亮的「服务商」列。

### 新增

- `frontend/src/pages/VideoManagement.tsx`：
  - SKU 与价格筛选区新增「服务商」下拉（`skuProviderFilter`，客户端按 `provider_key` 过滤 `visibleSkus`；选项 `skuProviderOptions` 取自 models 与全量 SKU 的 `provider_key` 去重）。
  - SKU 表格在「SKU」列后新增「服务商」列（蓝色 Tag 高亮 `provider_key`），与「视频模型」列表口径一致。

## [1.5.43] - 2026-06-07

> **视频能力默认值调整（增量 migration，零代码逻辑 / 零前端）**：① 多米 Seedance 2.0（标准 + Fast）补充 15s 时长与 15s SKU；② cang-api 的 `seedance_2` 改为只支持 720p、画面比例对齐多米 Seedance（7 项），并禁用其 1080p SKU。

### 变更

- `database/migrations/2026_07_18_000008_seedance_duration_and_cang_api_720p.php`（幂等）：
  - 多米 `doubao-seedance-2-0-260128` / `doubao-seedance-2-0-fast-260128`：`supported_durations` 并入 `15`；新增 SKU `duomi:{model}:15s`（沿用 mode 锁定、清晰度/比例自选，默认 1500 算力 = 100/秒）。
  - cang-api `seedance_2`：`supported_resolutions` → `["720p"]`；`supported_aspect_ratios` → `["16:9","4:3","1:1","3:4","9:16","21:9","adaptive"]`（对齐多米）；禁用其非 720p（1080p）SKU。
  - 注：cang-api 走 OpenAI 兼容协议，`OpenAiVideoProvider` 内置 size 映射未覆盖 `21:9` / `adaptive`，如上游需要 size 参数，这两个比例需在模型 `provider_params.size_map` 补充，或由上游自适应。

## [1.5.42] - 2026-06-07

> **桌面端「AI 视频」同名模型按服务商区分（改 catalog 下发名，纯后端 / 零桌面端改动 / 零 migration）**：桌面端模型下拉以 `model_id` 标识、只显示 `display_name`，当多个服务商存在同名模型（如 duomi 与 cang-api 都叫 Seedance 2.0）时无法区分归属。本次在 `VideoTaskService::catalog` 对 display_name 重名的模型追加「· 服务商名」后缀，桌面端无需改动，直接显示云端下发的名称。

### 变更

- `app/Services/Video/VideoTaskService.php` `catalog()`：查询 active 服务商时一并取 `name`，建 `provider_key → name` 映射；构建模型列表后，对 `display_name` 出现多次的模型追加 ` · {服务商名}`（取不到名则回退 provider_key）。仅影响桌面端 catalog 展示，不改后台序列化、不改聚合口径（仍按 model_id 聚合，model_id 完全相同的跨服务商场景仍需桌面端配合，另行处理）。

## [1.5.41] - 2026-06-07

> **Seedance 2.0（cang-api）补充 15 秒时长支持（增量 migration，零代码逻辑改动）**：预置的 `seedance_2` 当初只配了 5s / 10s，但 Seedance 2.0 实际支持 15s。遵守 migration 铁律（不改已发布的 000006），用增量补丁把模型 `supported_durations` 补入 15、并新增 15s 的 SKU。

### 新增

- `database/migrations/2026_07_18_000007_add_seedance_2_15s_support.php`：幂等补丁，仅作用于 `provider_key=cang-api` / `model_id=seedance_2`。
  - `video_model_specs.supported_durations`：并入 `15` → `[5,10,15]`（去重、升序）。
  - `video_sku_prices`：新增 `cang-api:seedance_2:15s:720p`（占位 15 算力）与 `cang-api:seedance_2:15s:1080p`（占位 24 算力），管理员可改。
  - 幂等：时长已含 15 / SKU 已按 `sku_key` 存在则跳过；`down()` 不删数据，避免回滚误删线上配置。

## [1.5.40] - 2026-06-07

> **「AI 视频 → 视频模型」列表新增独立「服务商」列（纯前端，零后端 / 零 migration）**：模型列表原先把 `provider_key` 与 `provider_protocol` 两个 tag 混在「模型」列里，接入多个服务商（如 duomi、cang-api）后不易一眼看出每个模型归属哪个服务商。本次拆出独立的「服务商」列直接展示 `provider_key`，并从「模型」列移除重复的 `provider_key` tag（保留协议 tag）。

### 变更

- `frontend/src/pages/VideoManagement.tsx`：视频模型表格新增「服务商」列（`dataIndex=provider_key`，蓝色 Tag，宽 130），原「模型」列宽 260→240 并移除其中的 `provider_key` tag，避免与新列重复展示。

## [1.5.39] - 2026-06-07

> **预置「cang-api」OpenAI 兼容视频服务商模板（New API 中转，纯 migration 数据预置 / 零代码逻辑改动）**：OpenAI 兼容视频驱动（`OpenAiVideoProvider`）早已存在，但每个部署都要手动新建服务商账号、模型规格、SKU 才能对接，重复且易错。本次新增一支幂等 migration，向所有部署预置一个 `cang-api` 服务商模板 + `seedance_2` 模型规格 + 4 个 SKU；管理员升级后只需到后台「AI 视频 → 服务商账号」填写自己的 API Key 并启用即可使用。**api_key 一律留空、绝不随代码内置**（key 是单账户敏感凭据，内置会泄露并导致全员共用额度），账号默认 `disabled`，且空 key 时 catalog 本就不展示，双重避免误暴露给终端用户。

### 新增

- `database/migrations/2026_07_18_000006_seed_cang_api_video_provider.php`：幂等预置 `cang-api`（OpenAI 兼容 / New API）视频服务商。
  - `video_provider_accounts`：`provider_key=cang-api`、`base_url=https://ai.772.ee`、`api_key=NULL`、`auth_style=bearer`、`status=disabled`、`config={"driver":"openai_video","verify_ssl":true}`。
  - `video_model_specs`：`provider_protocol=openai_video`、`model_id=seedance_2`、`supported_durations=[5,10]`、`supported_resolutions=[720p,1080p]`、`supported_aspect_ratios=[16:9,9:16,1:1]`、`provider_params` 含 `submit_path=/v1/videos`、`query_path=/v1/videos/{task_id}`、`cancel_path=/v1/videos/{task_id}/cancel`。
  - `video_sku_prices`：5s/10s × 720p/1080p 共 4 个 SKU，`default_credit_cost` 占位 5/8/10/16 算力，管理员可改。
  - 幂等：已存在 `provider_key=cang-api` 的部署整体跳过，不覆盖其已填写的 key / 状态 / 价格；`down()` 故意不删数据，避免回滚误删线上配置。

## [1.5.38] - 2026-06-07

> **知识库设置「Qdrant 未连通」提示文案修正（纯前端，零后端 / 零 migration）**：Qdrant 连接信息（`kb_qdrant_url` / `kb_qdrant_api_key` / `kb_qdrant_collection`）早已改为在后台「知识库设置」页面内配置并存入 DB（`system_settings`），不再依赖服务器 `.env` 的 `QDRANT_URL`。但「Qdrant 向量库未连通」告警 Alert 的描述仍残留「请先部署 Qdrant 并配置 .env 中的 QDRANT_URL」的旧说法，与同页表单及「连接信息在此配置，无需改服务器 .env」的提示自相矛盾，会误导管理员去改服务器 `.env`。本次仅修正该 Alert 文案，无任何逻辑改动。

### 修复

- `frontend/src/pages/KnowledgeBaseSettings.tsx`：Qdrant 未连通告警描述由「请先部署 Qdrant 并配置 .env 中的 QDRANT_URL（默认 http://127.0.0.1:6333）」改为「请先部署 Qdrant 并在下方填写服务地址（默认 http://127.0.0.1:6333）」，与页面内直接配置向量库连接的实际方式保持一致。

## [1.5.37] - 2026-06-06

> **仪表盘全面升级 + 视觉重构（纯前端，零后端改动 / 零 migration）**：旧仪表盘仅覆盖「用户 / 套餐订单 / 模型调用」三条老业务线，已落后于现有业务矩阵。本次重构 `frontend/src/pages/Dashboard.tsx`，补齐营收拆分、AIGC 生成业务、内容生态等维度，全部复用现有 stats / 聚合接口（无新增接口、无后端代码改动）；同时按项目设计规则去除「AI 味」彩色图标块与花哨配色，统一为单主色克制风格，全程无 emoji。

### 新增

- 营收总览区：用 `commissionOrderApi` 的 DB 层 `summary`（`paid_order_amount` / `commission_amount` / `confirmed_commission_amount`）按 `order_type` 精确拆分「套餐购买收入 / 余额充值入金 / 分销佣金」，含收入构成占比条；今日成交金额改用 summary 聚合，替代旧版 `per_page:200` 前端求和，金额不再因分页截断而失真。
- AIGC 生成业务区：接入 `videoApi.stats` / `mattingApi.stats` / `fineMattingApi.stats`（此前已存在但仪表盘从未调用）+ `usageApi.stats({type:'image'})`，展示视频 / 图像 / 抠图 / 精细抠图的任务量与积分消耗。
- 内容生态区：智能体 / 创意模板 / 灵感 / 知识库 / 文档 / 公告的存量计数；智能体·模板（`submission_status=pending`）与灵感（`status=pending`）展示待审核数高亮。
- 时间范围切换（今日 / 本周 / 本月 / 近 30 天 / 全部）联动营收与模型调用区；各区块 `Promise.allSettled` 独立加载与容错，单接口失败仅置 0，不拖垮整页。

### 变更

- 套餐销量 Top5 排除 `order_type=recharge`，避免充值订单混入产生 `套餐#null` 脏数据。
- 视觉规范重构：移除每卡彩色图标方块与 6 色 `KPI_COLOR`，收敛为单主色（`#1677ff` + `#69b1ff`）+ 中性灰；排行榜去金/银/铜、改 Top1 主色实心；统一 `Section` 分区标题；仅保留刷新 / 趋势箭头等功能性矢量图标，无 emoji。

## [1.5.36] - 2026-06-06

> **云端知识库模块（独立于文档中心）+ 智能体预设知识库绑定 + 桌面端在线检索（hybrid）**：新增一套独立的「知识库」体系，文档支持富文本在线编辑与文件上传解析（PDF/Word/Markdown/TXT/Excel），向量存入 Qdrant（按知识库 payload 过滤隔离多库），检索为向量召回 + MySQL 全文关键词 RRF 融合。智能体预设可 N:N 绑定知识库；用户在桌面端获取（acquire）该智能体后，对话时由桌面端在线检索其绑定的云端知识库并注入上下文，权限随智能体授权传递（无需单独授权知识库）。检索内容留在云端，桌面端仅缓存命中片段用于离线降级。

### 新增

- 云端知识库模块：知识库 CRUD、库内文档（富文本/文件上传）、异步向量化（Qdrant）、hybrid 检索调试，独立后台菜单「知识库管理」。
- 智能体预设新增「绑定云端知识库 / 仅依据知识库回答 / 检索条数」配置，随 acquire 下发桌面端。
- 桌面端检索接口 `POST /api/client/knowledge-bases/search`：鉴权随智能体授权传递（登录 + 已获取该智能体 + 仅检索其绑定的库）。
- 文件解析：PDF（smalot/pdfparser）、Excel（内置 ZipArchive 解析 xlsx）、CSV、TXT，复用文档中心 Markdown/Word 解析。
- 抽取共享 `EmbeddingService`，文档中心与知识库共用同一上游向量化逻辑。

### 变更

- `agents` 表新增 `kb_only` / `kb_top_k` 字段；新增 `knowledge_bases` / `kb_documents` / `kb_chunks` / `agent_knowledge_bases` 表。
- 智能体公开/获取接口下发绑定的知识库 id（收费未购买时遵循与提示词一致的隐藏策略）。
- 知识库 / 文档删除时同步清理 Qdrant 向量，避免残留。

## [1.5.35] - 2026-06-06

> **灵感广场 / 创意模板 / 智能体市场新增缩略图（通用方案，3 个 migration）**：三类内容各加一个缩略图字段，由上传端（桌面端 / 后台网页）生成并随原图上传，云控端原样存为独立文件——对存储后端（local / COS / OSS）与图片处理特性零依赖，运行期不需要任何图像扩展。公开接口额外下发缩略 URL，桌面端网格优先用缩略图、回退原图。另附 `thumbnails:backfill` 命令为存量数据补缩略图（需 GD）。需配合桌面端 0.7.18。

### 新增

- **三类内容缩略图字段 + 接收/存储/清理**（3 个 migration）：
  - 数据层：`database/migrations/2026_07_17_000001_add_cover_thumb_to_inspirations_table.php`、`2026_07_17_000002_add_cover_thumb_to_creative_templates_table.php`（均加 `cover_thumb`）、`2026_07_17_000003_add_avatar_thumb_to_agents_table.php`（加 `avatar_thumb`）；均 `hasColumn` 守卫、`default ''`。`Inspiration` / `CreativeTemplate` / `Agent` 模型 `$fillable` 同步加字段。
  - `InspirationController`：`store` / `clientUpload` / `update` 接收并存 `cover_thumb`（缩略图上传失败不阻断主流程，留空回退原图）；`destroy` / `batchDestroy` / 换封面 / 移除封面时连带清理缩略文件。
  - `CreativeTemplateController`：`clientSubmit`（桌面端投稿，唯一创建入口）接收并存 `cover_thumb`，`deleteTemplateFiles` 连带清理（admin `store/update` 早已 410 弃用，无需改）。
  - `AgentController`：`store` / `update` / `clientSubmit` 接收并存 `avatar_thumb`，删除 / 替换 / 移除时连带清理。
  - 公开接口下发缩略 URL：`AgentPublicController::publicShape` 加 `avatar_thumb`、`CreativeTemplatePublicController::serializeTemplate` 加 `cover_thumb`、`InspirationController::publicList`（经 `toArray` 自动带出 `cover_thumb`）。
  - 校验：缩略图字段按 `nullable|file|mimetypes:image/png,image/jpeg,image/webp|max:2048` 接收。

- **存量数据回填命令 `thumbnails:backfill`**：
  - `app/Services/ThumbnailService.php`（新，GD）：由原图字节生成 JPEG 缩略图（等比缩放、透明铺白），GD 缺失返回 null。这是全链路里**唯一**用到 GD 的地方，运行期上传不依赖它。
  - `app/Console/Commands/BackfillThumbnails.php`（新）：遍历三类中缩略图为空的记录，读原图（本地 `public_path` / 远程 Guzzle GET）→ 生成 → `StorageService::putBytes` 存为 `{uuid}_thumb.jpg` → 回写字段。支持 `--type=inspiration|template|agent|all`、`--limit`、`--size`、`--quality`、`--dry-run`；无 GD 时报错退出，不影响线上（老记录继续回退原图）。

- **后台网页上传时生成缩略图**：`frontend/src/utils/makeThumbnail.ts`（新，canvas）；`pages/Inspirations.tsx`（封面 720）、`pages/Agents.tsx`（头像 512）在选了新图时随原图附带 `cover_thumb` / `avatar_thumb`。

### 说明

- 全链路双向优雅回退：任一端缺缩略字段时自动显示原图，功能不破。迁移为纯增列、`hasColumn` 守卫，重复执行安全。
- 升级步骤：执行 `php artisan migrate`（加 3 列）；如需给历史数据补缩略图，运行 `php artisan thumbnails:backfill`（需服务器 PHP 开启 GD，可先 `--dry-run` 预览）。

## [1.5.34] - 2026-06-04

> **视频参考素材上传健壮性加固**：转存对象存储失败时返回明确错误而非裸 500，并调高 COS 转存超时；配合桌面端 0.7.17「上传前压缩参考图」根治部分电脑上传较大参考图偶发「服务器错误 500」。
>
> **智能体市场：付费购买 + 定向可见**：可为市场智能体设置价格（金币 / 积分）与可见范围（全员 / 指定用户·用户组）；桌面端保存前经 `acquire` 校验可见性并扣费，余额不足返回 402；收费智能体购买前隐藏系统提示词、购买后下发。含 3 个 migration，需配合桌面端 0.7.17。
>
> **新增「精细抠图」（抠抠图 koukoutu，按尺寸三档计费）**：独立精细抠图体系，对接抠抠图通用抠图异步 API（create→poll），按上传图片长边三档积分计费（4K 以下 / 4K–8K / 8K 以上，价格与阈值后台可配），全站并发 5；管理后台新增「精细抠图」（概览 / 任务 / 测试 / 自定义设置），权限新增 `allow_fine_matting` + 月配额；原「AI 抠图」更名「快速抠图」。含 1 个 migration（2026_07_16_000006_create_fine_matting_tasks）。

### 新增

- **智能体市场：付费购买 + 定向可见**（3 个 migration）：
  - 数据层：`database/migrations/2026_07_16_000003_add_pricing_and_visibility_to_agents.php`（`agents` 加 `price`、`price_balance_type`〔token=金币 / credit=积分〕、`visibility_scope`〔public 全员 / restricted 定向〕）；`2026_07_16_000004_create_agent_visibilities_table.php`（定向白名单，仿 `model_assignments`：`agent_id` + `assignee_type`〔user / group〕+ `assignee_id`）；`2026_07_16_000005_create_agent_purchases_table.php`（购买凭证，`(agent_id, user_id)` 唯一、服务端为准，删本地后重存不重复扣费）。新增 `app/Models/AgentVisibility.php`、`app/Models/AgentPurchase.php`；`Agent` 加字段 / 常量 / `visibilities` / `purchases` 关联。
  - 可选鉴权：`app/Http/Middleware/OptionalJwtAuth.php`（新，别名 `auth.jwt.optional`）——带 token 识别用户、无 token / 失效降级匿名；套用于 `/public/agents` 列表 / 详情。
  - `AgentPublicController`：`list` / `show` 按 `visibility_scope` + `agent_visibilities`（当前 user 与所属 group 并集）过滤，受限智能体对未授权返回 404（不暴露存在）；输出加 `price` / `price_balance_type` / `is_owned`；**收费且未购买时隐藏 `system_prompt`**（核心付费内容），免费 / 已购才返回。
  - `AgentController::acquire`（`POST /client/agents/{id}/acquire`）：可见性校验 → 已购幂等放行 → 免费 `firstOrCreate` 记拥有 → 收费经 `BalanceService::deduct` 扣金币 / 积分（自动优先抵扣套餐额度），余额不足返回 402 `{error, needed, current, balance_type}`；扣费 + 记购买同一事务，唯一键冲突回滚、不重复扣费；成功后下发完整数据（含 `system_prompt`）供桌面端建本地智能体。`store` / `update` 接受 `price` / `price_balance_type` / `visibility_scope` + `visible_user_ids` / `visible_group_ids`（先删后插同步白名单）；`index` / `show` 预加载 `visibilities` 供后台回显。
  - 路由：`routes/api.php` `/public/agents` 列表 / 详情套 `auth.jwt.optional`，`client` 组加 `agents/{id}/acquire`。
  - 前端：`pages/Agents.tsx` 新建 / 编辑表单加「定价（金币 / 积分）」「可见范围（全员 / 指定用户·用户组）」+ 用户 / 用户组多选（复用 `userApi` / `groupApi`），列表加「定价」「可见」列。

- **精细抠图（抠抠图 koukoutu，按尺寸三档计费）**（1 个 migration）：
  - 数据层：`database/migrations/2026_07_16_000006_create_fine_matting_tasks.php`（`fine_matting_tasks`，含 `width/height/tier/cost/provider_task_id`）；`app/Models/FineMattingTask.php`。
  - 服务层：`app/Services/Koukoutu/KoukoutuMattingService.php`（create multipart `image_file` + 轮询 `/v1/query`，输出 png）；`app/Services/FineMatting/FineMattingConcurrencyLimiter.php`（全站并发 5 + 单用户并发 3 信号量，`Cache::lock` 原子 + TTL 兜底）；`config/koukoutu.php`。
  - 网关 / 任务：`app/Http/Controllers/FineMattingController.php`（`getimagesize` 探测长边 → 三档定价 → 余额/配额预检 → 入库 → 派发；客户端 segment/status/quota/tasks + 管理端 stats/settings/tasks/test）；`app/Jobs/ProcessFineMattingTaskJob.php`（队列 `fine-matting`，按 `task.cost` 扣费）。
  - 路由：`routes/api.php` 新增 `gateway/fine-matting/*` 与 `admin/fine-matting/*`。
  - 配置 / 配额：`SystemSetting` 增 `fine_matting_*`（enabled / api_key〔加密〕/ tier1~3_credit / tier_threshold_1~2，默认阈值 4096 / 7680）；`QuotaService` 增 `fine_matting` 配额类型及 `allow_fine_matting` / `fine_matting_quota_per_month` 默认。
  - 后台前端：`pages/FineMatting.tsx`（四 tab + 成本提示 + 三档价）；`services/api.ts` 增 `fineMattingApi`；`App.tsx` / `layouts/AdminLayout.tsx` 注册路由菜单并把「AI 抠图」改「快速抠图」；`pages/Permissions.tsx` / `pages/Plans.tsx` 增 `allow_fine_matting` + `fine_matting_quota_per_month`。
  - `DesktopMenuController`：菜单增 `/fine-matting`，`/ai-matting` 文案改「快速抠图」。

- **套餐商城 / 直充分类型显隐开关**（无 migration，复用 `system_settings`）：
  - `SystemSetting` 新增 `plans_store_enabled` / `recharge_token_enabled` / `recharge_credit_enabled`（默认 true，升级后行为不变）；`RechargeService::getConfig` 下发 `token.enabled` / `credit.enabled`，`quote()` 对被关闭类型直接拒单（防绕过前端）；`RechargeController` admin 接口读写 `token_enabled` / `credit_enabled`；`SettingController::publicConfig` 增 `plans_store` + `recharge`（token/credit）开关供桌面端控制入口显隐。
  - 前端：`pages/Plans.tsx` 顶部加「桌面端套餐商城」显隐开关；`pages/RechargeConfig.tsx` 加「显示金币充值 / 显示积分充值」开关。需配合桌面端 0.7.17。

### 修复

- `app/Http/Controllers/VideoController.php`：`clientUploadReference` / `clientUploadImageReference` 包 try-catch，转存对象存储失败（`TemporaryReferenceAssetService::upload` 抛 `RuntimeException`）时返回 JSON `{error}` + HTTP 500，不再让异常冒泡成无 body 的错误页——桌面端（已带 `Accept: application/json`）据此可显示真实原因而非笼统「服务器错误 (500)」。
- **多服务商同名模型错路由 / 错扣费加固**：`app/Http/Controllers/GatewayController.php` 的 `resolveAndAuthorize`，当请求未携带 `cloud_model_id`（老客户端 / 桌面端刚登录的模型同步竞态）且 `model_id` 命中多家服务商时，不再 `first()` 兜底（会把用户选的 A 家错路由到 B 家并按 B 家 `BillingRule` 计费），改为返回 `409 ambiguous_model`，提示客户端重新拉取模型列表后携带 `cloud_model_id` 重试。
- **快速抠图 / 精细抠图报错中文化**：`MattingController` / `FineMattingController` 的余额不足（402）、配额用尽（429）改中文友好文案（含数值），并区分「配额用尽」与「请求频繁」。
- **精细抠图健壮性**：上游成功但扣费失败时标 failed 并释放并发槽（避免重试重复调用抠抠图）；sync `terminating` 异常兜底释放槽；提交前校验 API Key 与分辨率上限（10000px）。

### 改进

- `app/Services/StorageService.php`：腾讯云 COS 上传（`putBytesToCos`）Guzzle 超时 30s → 120s，避免较大参考图转存 COS 在 30s 内未完成被中断（删除 15s / 测试连接 10s 不变；OSS SDK 默认超时足够，未改）。
- **图片任务僵尸兜底清理**：新增 `app/Console/Commands/PurgeStaleImageTasks.php`（`image:purge-stale`）并在 `app/Console/Kernel.php` 每 5 分钟调度（`--keep-days=7`）。sync 队列模式下生图任务由 `terminating` 寄生 PHP-FPM 进程执行，进程被 `request_terminate_timeout` / OOM 强杀时 `ProcessImageTaskJob` 来不及翻状态，任务会永久卡 `pending/processing`；本命令把静默超过 image timeout+300s 的非终态任务标 `failed` 并按 `--keep-days` 清理过期历史（对齐视频侧 `video:settle-pending`）。

### 说明

- 本次主因修复在**桌面端 0.7.17**：AI 视频参考图上传前统一压缩到长边 1600 JPEG（含「选择文件」路径，此前仅「从图库选图」压缩），把几十 MB 原图压到 1~2MB，从源头消除大图转存超时 / 内存溢出导致的 500。云控端为兜底 + 错误可读化。

## [1.5.33] - 2026-06-04

> **智能体：分类体系 + 跨站共享库（Agent Hub 客户端）**：为智能体补齐分类管理（与创意模板同构），并新增镜像创意模板 Hub 的「智能体共享库」客户端——分享到共享库 / 浏览拉取 / 众审 / 状态同步。跨服务鉴权复用云打包端的域名授权（Origin 绑定）+ 审核员（`is_hub_reviewer`）。含 1 个 migration。**需配合云打包端 agent-build ≥ 0.10.0。**

### 新增

- **智能体分类**：`database/migrations/2026_07_16_000002_add_categories_and_hub_to_agents.php`（新）建 `agent_categories` 表、`agents` 加 `category_id` + 6 个 hub 列（`hub_shared_id` / `hub_status` / `hub_status_synced_at` / `from_hub_agent_id` / `from_hub_source_site_name` / `source_metadata`，全部 `hasColumn` 守卫增量列）；`app/Models/AgentCategory.php`；`AgentController` 加分类 CRUD（`/admin/agents/categories`）+ 列表分类筛选 + store/update 接受 `category_id`；`AgentPublicController` 加 `/public/agents/categories` + 分类筛选。
- **智能体共享库客户端**：`app/Services/AgentHub/AgentHubClient.php`（仅 Origin 鉴权，`PATH_PREFIX=/api/agent-hub`）；`app/Http/Controllers/AgentHubController.php`（client: me / categories / list / show / status-batch / report + shareToHub / withdrawFromHub；admin: settings / health-check / pending-list / review / pull-to-local，拉取时镜像头像落盘 + 写 `from_hub_agent_id` 去重）；`app/Console/Commands/SyncAgentHubStatus.php`（`agent-hub:sync-status`，每 5 分钟 `withoutOverlapping`）。
- 路由：`routes/api.php` 新增 `agent-hub` 客户端/管理端组 + `agents/categories` CRUD + `agents/{localId}/share`（均字面量先于 `/{id}`、`/{hubId}`）。
- 前端：`services/api.ts` 加 `agentApi` 分类方法 + `agentHubApi`；`pages/Agents.tsx` 加分类筛选 / 表单分类 /「分类管理」Tab / 共享库状态列 / 分享·撤回 / 分享 Modal；新增 `pages/AgentHubBrowse.tsx`、`pages/AgentHubPending.tsx` + 路由 + 菜单。
- **AI 视频批量定价支持溢价**：`VideoController::adminBatchStorePricingRuleDiscounts` 的 `discount_percent` 校验上限 `100` → `300`，扣费计算加 `min(.., 999999)` 兜底；前端「批量设置模型折扣」字段「折扣百分比」→「价格百分比」、`max` 100→300、tooltip / 预览支持溢价（如 120% = 1.2 倍）。

### 改进

- **管理后台「桌面端」菜单拆分**：原「桌面端」单一分组（十余项）拆为「桌面端设置 / 灵感广场 / 创意模板 / 智能体市场」四个分组（`AdminLayout.tsx` 的 `menuItems` + `pathToGroupKey`），每组含 主页 + 共享库 + 待审池，导航更清晰。

### 修复

- `AgentHubController::shareToHub` 的 `source_local_id` 由 `(int)` 改为 `(string)`，与云打包端 `string` 校验对齐（否则每次分享会被 422 拦下）。

### 说明

- 共享库需本站域名在云打包端「客户端」授权（Origin 域名绑定），审核员资格在云打包端「客户端」页任命（复用 `is_hub_reviewer`）。
- 桌面端配套（智能体市场 / 保存到本地 / 投稿 / 评分）随**桌面端版本**单独发布。

## [1.5.31] - 2026-06-04

> **智能体市场（云端创建 + 桌面端分发）**：云控端可创建 / 管理智能体并上架到桌面端「智能体市场」，支持增删改查、启用 / 停用、批量启停、桌面端用户投稿审核、评分。含 1 个 migration（新建 `agents` + `agent_ratings` 表）。

### 新增

- **智能体数据层**：
  - `database/migrations/2026_07_16_000001_create_agents_tables.php`（新）：建 `agents`（`name` / `description` / `avatar` / `system_prompt` / `tool_skill_ids(json)` / `tool_approval` / `enable_image_gen` / `tags(json)` / `download_count` / `rating_avg` / `rating_count` / `sort_order` / `is_visible` / `submission_status` / `source_type` / `submitted_by_*` / `reviewed_by_*` / `reject_reason` / `source_local_agent_id` / `published_at` 等）+ `agent_ratings`（`agent_id` / `user_id` / `score` / `comment`，唯一约束 `(agent_id,user_id)`，FK `agent_id` cascade）。
  - `app/Models/Agent.php` / `app/Models/AgentRating.php`：`$fillable` + `$casts`；`Agent::BUILTIN_TOOL_SKILL_IDS` 固定 6 个内置小工具 ID。
- **管理端 API**（`app/Http/Controllers/AgentController.php`，前缀 `/api/admin/agents`）：`index` / `show` / `store` / `update`（multipart，`getimagesize` 校验 2:3 形象图）/ `destroy` / `batch-delete`、单个上下架 `PUT /{id}/visibility` + 批量 `POST /batch-visibility`、`approve` / `reject`、`setSortOrder`。
- **客户端 API**（`/api/client/agents`，JWT）：投稿 `submit`、状态轮询 `status-batch`、撤回 `DELETE /{localId}/submit`、评分 `POST /{id}/rate`（事务内 upsert + 重算 `rating_avg/rating_count`）。
- **公开 API**（`app/Http/Controllers/AgentPublicController.php`，`/api/public/agents`，免登录）：`list` / `show`（仅 approved + visible，补全头像绝对 URL）、下载计数 `POST /{id}/download`（throttle 60/min）。
- 前端 `pages/Agents.tsx` + `services/api.ts(agentApi)` + `App.tsx` 路由 + `layouts/AdminLayout.tsx` 菜单（「桌面端」组新增「智能体」）：表格 + 筛选 + 分页 + 行选 + 批量上架 / 下架 + 批量删除 + 创建 / 编辑弹窗（2:3 形象上传、默认勾选 6 个内置工具、工具调用确认、标签、系统提示词）+ 内联审核（通过 / 驳回）。

### 说明

- 形象图经统一 `StorageService`（local / COS / OSS）存储，子目录 `agents/`。
- 桌面端配套改动（「智能体市场」Tab、保存到本地、发布投稿、评分）随**桌面端版本**单独发布，不在本云控端包内。

## [1.5.30] - 2026-06-04

> **接入阿里云 OSS + 临时素材「存储位置」可视化**：资源存储在「本地 / 腾讯云 COS」之外新增「阿里云 OSS」；临时素材表记录每条素材落在哪个存储后端，管理页可显示并按「本地 / 腾讯云 / 阿里云 / 外链」筛选。含 1 个 migration（给 `temporary_reference_assets` 加 `storage_driver` 列）+ 1 个 composer 依赖（阿里云官方 `aliyuncs/oss-sdk-php`，无额外传递依赖）。

### 新增

- **阿里云 OSS 存储后端**：`storage_type` 在 local / cos 之外新增 oss。
  - `app/Services/StorageService.php`：新增 OSS 上传 / 删除 / 测试连接（`uploadToOss` / `putBytesToOss` / `deleteFromOss` / `testOss` / `loadOssConfig` / `normalizeOssEndpoint` / `makeOssClient`），基于阿里云官方 `aliyuncs/oss-sdk-php`（`OSS\OssClient::putObject / deleteObject / getBucketInfo`），上传走 `bucket.endpoint`、访问 URL 优先自定义域名（CDN）否则回退 OSS 默认域名。腾讯云 COS 仍为手写 V5 签名 + Guzzle（两者独立、互不影响）。
  - `app/Models/SystemSetting.php`：白名单新增 `oss_access_key_id` / `oss_access_key_secret`（加密）/ `oss_endpoint` / `oss_bucket` / `oss_domain`。
  - `app/Http/Controllers/SettingController.php` + `routes/api.php`：新增 `POST /admin/settings/oss-test`（`GetBucketInfo` 验证 AccessKey / Endpoint / Bucket，按 `OssException` 错误码区分 AK / Bucket 问题）。
  - 前端 `pages/Settings.tsx`：存储方式新增「阿里云 OSS」分段 + 配置表单 + 测试连接；`services/api.ts` 新增 `ossTest`。

- **临时素材「存储位置」显示 + 筛选**：
  - `database/migrations/2026_07_15_000015_add_storage_driver_to_temporary_reference_assets.php`（新）：`temporary_reference_assets` 加 `storage_driver`（nullable + index，幂等）。
  - `app/Services/Video/TemporaryReferenceAssetService.php`：上传时写真实驱动（local/cos/oss），外链记 `external`。
  - `app/Http/Controllers/VideoController.php`：列表支持 `storage_driver` 筛选、统计新增 `by_storage` 分布、序列化返回 `storage_driver`（为空按 URL 反推兜底）。
  - 前端 `pages/TemporaryAssets.tsx`：新增「存储位置」列（本地 / 腾讯云 / 阿里云 / 外链标签）+ 筛选下拉 + 存储分布统计卡。

### 改进

- **切换存储类型后历史文件可正确清理**：`StorageService::deleteWithDriver()` 按记录的 `storage_driver` 删对应后端文件（`delete()` 仍按当前全局 `storage_type`）；`TemporaryReferenceAssetService` 删素材改用前者。此前切换 `storage_type` 后，旧文件会因「按新后端删」而删不掉、留下孤儿。

- **套餐描述限制收紧为 200 字 + 实时字数提示**：套餐描述上限由 500 收紧到 200，并在编辑时显示实时字数计数与上限提示。
  - `app/Http/Controllers/PlanController.php`：`store()` / `update()` 的 `description` 校验由 `max:500` 改为 `max:200`。
  - 前端 `pages/Plans.tsx`：描述输入框 `maxLength` 改为 200、启用 `showCount` 实时字数计数，并加占位提示「套餐描述，最多 200 字」。
  - 注意：历史描述若超过 200 字，再次编辑保存会被后端校验拦截，需先手动缩短至 200 字内（桌面端展示不受影响，可正常展开查看）。

### 修复

- **AI 视频生成：修复正常任务被误判失败的竞态（「任务缺少上游 provider_task_id」「多米视频任务提交失败」）**：桌面端每 6s 轮询会调云控端 `refresh`，常赶在提交完成前触发查询，而旧逻辑把「查询过早 / 网络抖动 / 上游查询接口临时异常」一律写死为 `failed`，导致仍在排队 / 提交中的正常任务被永久误杀（前端「软重试 + 后端兜底」的容错也因此失效）。
  - `app/Services/Video/VideoTaskService.php`：`applyQueryResult()` 仅当上游**明确判定失败**（`provider_failed`）才落 `failed`；`missing_provider_task_id`（提交未完成）/ `connection_error`（抖动）/ `http_xxx`（上游查询临时异常）改为**保留原状态**，交下一轮轮询与 `video:settle-pending` 超时兜底。`refresh()` 在 query 前置检查 `provider_task_id`：提交中不查询、超时才判 `submit_timeout`（新增 `isSubmitExpired()`，与轮询 / 兜底同口径）。
  - `app/Jobs/ProcessVideoSubmitJob.php`：已拿到 `provider_task_id` 时不重复提交（幂等，避免向上游重复下单）；提交成功写回改为 `whereNotIn(终态)` 条件更新，防止覆盖提交期间已取消 / 失败的状态。
  - `app/Services/Video/Adapters/DuomiVideoProvider.php`：收敛继承 `AbstractVideoProvider` 复用其 `request()`（支持账号 `config` 的 `verify_ssl` / `proxy` / `extra_headers`），override `buildHeaders()` 保持多米固定 raw 鉴权；`pathFor()` 未知协议不再抛异常、兜底走通用视频接口 `/v1/videos/generations`。
  - 行为变化：此后仅「上游明确失败」或「超过 `video_poll_timeout_seconds`（默认 1h）」才判失败，真正做到「完成必扣、不误杀」。纯后端改动，无 migration、无依赖、无前端变更。

> 数据库变更：1 个 migration（加 `storage_driver` nullable 列 + index，幂等）。复用既有 `temporary_reference_assets` 表，无其它结构改动。

---

## [1.5.29] - 2026-06-04

> **多米生图支持参考图 + 临时素材可视化管理**：补上「多米图片渠道带参考图」的桥接能力（参考图先落对象存储换成公网 URL 再提交，用完即删），此前多米实际仅能纯文生图；同时管理后台新增「临时素材」页并加上过期自动清理，桌面端上传的临时参考图不再积压成孤儿文件。

### 新增

- **多米生图支持参考图（base64 → COS → URL 桥接）**：多米图片 API 上游只可靠接受图片 URL，`dataUri` / 裸 base64 会被其 nginx WAF 拒收或静默忽略参考图（此前 `DuoMiAdapter` 把 base64 补成 dataUri 直传，实测无效，多米服务商实际仅能纯文生图）。本版本补上桥接：
  - `app/Services/Gateway/Adapters/DuoMiAdapter.php`：新增 `materializeReferenceImages()`，把参考图 base64/dataUri 经 `StorageService::putBytes` 落对象存储换成公网 URL 再提交（已是 http URL 的元素直通）；新增 `sniffImageMime()` 按文件头 magic bytes 校正真实类型，修正 `normalizeImages` 对纯 base64 一律标 `image/png` 导致的 COS `Content-Type` 失真；提交 + 轮询抽出 `submitAndPoll()`，外层 `try/finally` 在任务终态后立即删除临时 COS 文件（`image()` 全程同步阻塞到出图，用完即删、正常零堆积；上传 URL 以引用逐张累积，中途异常也能清理）。
  - `app/Http/Controllers/VideoController.php`：新增 `clientUploadImageReference()`（桌面端本地直连多米路径用，参考图换 URL）。
  - `app/Services/Video/TemporaryReferenceAssetService.php`：`upload()` 增加 `$subdir` / `$expireHours` 参数，图片生成参考图存 `image-reference-assets/` 子目录、6h 过期，由 `video:purge-reference-assets` 定时清理。
  - `routes/api.php`：新增 `client/images/reference-assets`（POST，`throttle:30,1`）。
  - 配套桌面端 `image-generation.ts` 改造（本地直连 / 云端网关两条路径均改为先换 URL 再交给多米），需随桌面端版本单独发布，**不在本次云控端更新包内**。

- **临时素材可视化管理 + 过期自动清理**：桌面端上传的临时参考素材（视频 / 图片生成）此前无可视化管理、积压成孤儿。
  - `app/Http/Controllers/VideoController.php`：新增后台接口 `adminReferenceAssets` / `adminReferenceAssetStats` / `adminDeleteReferenceAsset` / `adminBatchDeleteReferenceAssets` / `adminCleanupExpiredReferenceAssets`；`app/Services/Video/TemporaryReferenceAssetService.php` 新增 `deleteAssets()` / `purgeExpired()` / `deleteOne()`（删 COS / 本地文件 + DB 记录，`source=url` 外链只删记录）。
  - `app/Console/Commands/PurgeExpiredReferenceAssets.php`（新，`video:purge-reference-assets`）+ `app/Console/Kernel.php`：每小时清理过期临时素材（默认 60min 宽限），`withoutOverlapping` + `runInBackground`。
  - `routes/api.php`：`admin/videos/reference-assets` 列表 / 统计 / 批量删除 / 单删 / 清理过期共 5 个路由（字面量路由先于 `/{id}`）。
  - 前端 `pages/TemporaryAssets.tsx`（统计卡片 + 筛选 + 分页表 + 预览 + 单删 / 批量删 / 清理过期）+ `services/api.ts` + `App.tsx` + `AdminLayout.tsx`（「AI 资源 → 临时素材」入口）。

> 本次无数据库结构变更：复用 1.5.x 已建的 `temporary_reference_assets` 表，migrations 与 1.5.28 完全一致。

---

## [1.5.28] - 2026-05-30

### 新增

- **桌面端左侧菜单配置（云控端）**：管理后台新增「桌面端 → 菜单配置」，可配置桌面端左侧菜单的显隐与自定义名称。
  - `app/Http/Controllers/DesktopMenuController.php`（新）：内置菜单清单 `MENU_ITEMS`（须与桌面端 `MainLayout.vue` 的 `allNavItems` 保持一致），`clientConfig`（桌面端下发）+ `adminIndex` / `adminUpdate`（后台读写）。
  - `app/Models/SystemSetting.php`：白名单新增 `desktop_menu_config`（JSON，复用 system_settings 表，无 migration）。
  - `routes/api.php`：`client/desktop-menu` + `admin/desktop-menu`（GET / PUT）。
  - 前端 `pages/DesktopMenuConfig.tsx` + `services/api.ts` + `App.tsx` + `AdminLayout.tsx`（「桌面端」分组新增「菜单配置」入口）。
  - 「模型服务 / AI 抠图」由用户功能权限控制，不纳入菜单配置（既不下发也不保存）。
  - 需配合桌面端 0.7.15+ 消费该配置生效；旧版桌面端不拉取此接口，向后兼容、不受影响。

---

## [1.5.27] - 2026-05-30

### 变更

- **视频 SKU 后台「计费维度」交互改造**（`frontend/src/pages/VideoManagement.tsx`）：
  - 批量生成 SKU 从「支持维度全笛卡尔积」改为「按勾选的计费维度生成」——只对勾选维度做组合、未勾选维度留空（用户生成时自选、不影响价格），按协议（seedance=模式+时长 / veo·grok=时长+清晰度）智能预设并随模型切换联动，实时预览将生成的 SKU 数与锁定/留空维度。
  - SKU 表单：顶部 Alert 改写为「只填影响价格的维度、其余留空＝用户自选」并附 Seedance/VEO 范例；四个规格字段加 tooltip 与「留空＝用户自选」提示，placeholder 不再诱导填值；选中模型后展示「该模型现有 SKU 锁定维度」。
  - SKU 列表「规格」列标注每个维度「计费锁定（蓝）/ 用户自选（灰）」。
  - 保存 SKU 时校验同模型计费维度一致性，不一致弹确认框（无遮罩）。
  - 纯管理后台前端改动，不涉及后端代码、依赖、路由与数据库（migrations 与 1.5.25 一致）。

---

## [1.5.26] - 2026-05-30

### 变更

- 优化官网首页模板样式：重构默认模板 `public/home/index.html` 与极简模板 `public/home-minimal/index.html` 的视觉样式；默认模板新增首页视频素材 `public/home/images/home-video-01.mp4`（约 2.66 MB）。本次为纯前台静态模板调整，不涉及后端代码、依赖、路由与数据库变更（migrations 与 1.5.25 完全一致）。

---

## [1.5.25] - 2026-05-30

> **永久套餐可复购 + 用户直充 + AI 视频计费精修 + 升级稳定性**：永久套餐支持重复购买；新增用户自助按金额/快捷档位充值金币与积分（比例 + 起充 + 阶梯赠送），本金与赠送进钱包永久有效，订单参与 OEM 分佣；AI 视频 SKU 按计费维度重构（L2）并补「完成必扣」兜底结算；修复大跨度升级时 MySQL 1615 偶发导致 migrate 失败的问题。
>
> 注：1.5.24 为内部构建版本，未发布到 CDN，其全部内容并入本 1.5.25 一并发布。

### 新增

- **直充功能**：
  - `database/migrations/..._make_payment_orders_plan_id_nullable.php`（直充订单无套餐，`plan_id` 改 nullable）、`..._create_recharge_packages_table.php`（快捷档位表）。
  - `app/Models/RechargePackage.php`、`app/Services/RechargeService.php`（`quote` 计费/校验、`buildSnapshot` 下单固化到账、`fulfill` 入账）。
  - `app/Models/SystemSetting.php` 新增 `recharge_*` 配置键（开关 / 起充 / `token` `credit` 比例 / 双币种阶梯赠送）；`PaymentOrder::TYPE_RECHARGE`。
  - `app/Http/Controllers/PaymentController.php`：`createRecharge`（微信）、`createTianqueRecharge`（天阙）下单，复用 `attachOrderCommissionFields` 注入分佣；`settlePaidOrder` / `settleTianquePaidOrder` 新增 recharge 履约分支（本金+赠送 `addWallet` 进钱包永久，`settleCommission` 结算分佣）；`formatOrderForClient` 补充值信息。
  - `app/Http/Controllers/RechargeController.php`：客户端配置 + 管理端配置/档位 CRUD；`routes/api.php` 对应路由。
  - 前端 `frontend/src/pages/RechargeConfig.tsx`（直充配置页：比例 / 起充 / 双币种阶梯赠送 + 快捷档位 CRUD）、`services/api.ts`、菜单（计费财务 →「直充配置」）。

### 变更

- **永久套餐可复购**：`app/Http/Controllers/PaymentController.php` 中永久套餐（`duration_days<=0`）下单不再拦截「已拥有」，统一按 `TYPE_PURCHASE` 新购处理，每次独立发放额度。

- **AI 视频 SKU 计费维度重构（L2）**：
  - `database/migrations/..._simplify_duomi_video_skus_billing_dimensions.php`：对齐 5 个多米模型的 `supported_*` 至官方文档，删除旧笛卡尔积 SKU，按「计费维度」重建 16 个 SKU（Seedance 按秒 5/10s、VEO 按分辨率 720p/1080p/4k 固定 8s、GROK 按时长 6 档固定 720p），比例（及 Seedance 分辨率）留空交由生成时自选。
  - `app/Services/Video/VideoSkuSupportService.php`（重写）：拆为 `assertSkuSupported`（SKU 锁定维度）/ `assertGenerationParams`（提交自选维度）/ `assertAssetsSupported`（按协议 + 张数），空值跳过，移除多米硬编码分支。
  - `app/Services/Video/VideoTaskService.php`：`create` 的 `request_params` 改为「SKU 锁定值优先、未锁定用提交自选值」并接入新校验；`serializeTask` 对 `sku` / `modelSpec` 改用 `?->` 防空告警。
  - 修复 Seedance Fast、GROK 此前无可用 SKU，以及 Seedance Fast 误含 1080p 的问题。

- **AI 视频「完成必扣」兜底**：`app/Console/Commands/SettlePendingVideoTasks.php`（新，`video:settle-pending`）+ `app/Console/Kernel.php` 每分钟调度——cron 驱动扫描「停滞」的非终态任务主动 `refresh`，即使 `PollVideoTaskJob` 链式轮询中断（`tries=1` 单次异常 / sync 模式 PHP 超时）也能在任务完成时 `chargeAndRecord` 扣费（`billing_status` 幂等，重复安全），不依赖 queue worker。

### 修复

- **在线升级 migrate 偶发失败自动恢复**：`app/Services/UpdateService.php` 新增 `migrateWithRetry()`（`phaseMigrate` 与 `repairDatabase` 共用），对 MySQL `1615 Prepared statement needs to be re-prepared` 这类瞬时错误自动 `DB::reconnect()` 断连重连 + 退避重试（最多 3 次）。大跨度升级（如 1.1.1 直升）一次性跑大量 migration 冲刷 `table_definition_cache` 时偶发，重试即过，不再让整单升级失败。

---

## [1.5.23] - 2026-05-29

> **视频服务商通用化**：从「仅支持多米」扩展为「驱动可插拔 + 配置驱动」，新增 OpenAI 兼容视频协议，支持后台自助接入任意通用视频服务商；多米链路零改动。

### 新增

- **`backend/app/Services/Video/Adapters/AbstractVideoProvider.php`**：通用视频 Provider 基类，统一 cURL 调用、鉴权风格（`auth_style`：`bearer` / `raw_authorization_header`）与连接配置（`config.verify_ssl` / `proxy` / `extra_headers`）。
- **`backend/app/Services/Video/Adapters/OpenAiVideoProvider.php`**：OpenAI 兼容视频协议适配器，实现 `submit`（`POST /v1/videos`）、`query`（`GET /v1/videos/{id}`）、`cancel`、`test`、`fetchModels`（`GET /v1/models`）；支持 `provider_params` 覆盖 `submit_path` / `query_path` / `size` / `size_map` / `extra_body`，`resolution + aspect_ratio` 自动映射为 `size`。
- **`backend/app/Http/Controllers/VideoController.php`**：
  - 账号接口放开 `provider_key` / `driver` / `auth_style` / `config`。
  - 新增视频模型 CRUD（`adminStoreModelSpec` / `adminDeleteModelSpec`），并扩展 `adminUpdateModelSpec` 可改全部能力字段。
  - 新增视频 SKU CRUD（`adminStoreSku` / `adminDeleteSku`），编辑支持完整规格维护；SKU 校验异常统一转 422。
  - 新增 `adminFetchProviderModels`，从上游 `/v1/models` 拉取模型列表辅助录入。
- **`backend/routes/api.php`**：新增 `accounts/{id}/fetch-models`、`models`(POST/DELETE)、`skus`(POST/DELETE) 路由。
- **`frontend/src/pages/VideoManagement.tsx`**：账号表单改为「服务商类型」驱动并动态展示 Base URL / 鉴权 / SSL / 代理 / 额外请求头；视频模型支持新增 / 删除 / 全字段编辑 / 「从服务商拉取模型」；SKU 支持新增 / 删除 / 按模型能力笛卡尔积批量生成。
- **`frontend/src/services/api.ts`**：新增 `createModel` / `deleteModel` / `fetchProviderModels` / `createSku` / `deleteSku`。

### 变更

- **`backend/app/Services/Video/VideoProviderManager.php`**：驱动选择由写死 `duomi` 改为按 `account.config.driver` 路由，未知驱动回落 OpenAI 兼容协议。
- **`backend/app/Services/Video/VideoSkuSupportService.php`**：非多米服务商改为基于 `video_model_specs.supported_*` 的通用 SKU 校验；多米原协议校验保持不变。

### 说明

- 复用现有数据表字段（`video_provider_accounts.config/auth_style`、`video_model_specs.provider_params` 等），**本次无新增 migration**。
- 配套桌面端 `AiVideoView.vue` 已将参考素材交互改为「协议能力表」驱动以支持 `openai_video`（图片 + 视频参考），需随桌面端版本单独发布，不在本次云控端更新包内。

---

## [1.5.22] - 2026-05-29

> **AI 视频 SKU 与多米参数修复**：删除不支持的视频规格，补齐后台防误启用校验，并优化 SKU 价格维护体验。

### 新增

- **`backend/app/Services/Video/VideoSkuSupportService.php`**：
  - 新增多米视频 SKU 支持性校验服务，统一约束 Seedance、VEO、GROK 的模型、模式、时长、清晰度、比例和参考素材规则。
  - 用户提交、后台单个 SKU 更新和批量启用 SKU 均复用同一套校验，防止不支持组合被误开放。

- **`backend/app/Http/Controllers/VideoController.php`**：
  - 新增 `adminBatchUpdateSkus` 接口，支持后台批量启用或禁用视频 SKU。
  - 客户端视频提交新增 `reference_audio_urls` 入参校验，兼容 Seedance 音频参考素材。

- **`frontend/src/pages/VideoManagement.tsx`**：
  - SKU 与价格列表新增默认灵气行内编辑，可在列表原位置保存单个 SKU 默认价格。
  - SKU 与价格列表新增多选和批量启用、批量禁用操作。

### 修复

- **`backend/database/migrations/2026_07_15_000011_remove_unsupported_duomi_video_skus.php`**：
  - 删除 Seedance Fast 1080p、VEO 图生 9:16 和旧 GROK default 等不支持或冗余 SKU。
  - 删除前保留历史任务和用量记录的文本 SKU 信息，仅清空关联 ID，避免影响历史记录查看。

- **`backend/app/Services/Video/Adapters/DuomiVideoProvider.php`**：
  - Seedance 提交补齐音频参考素材 `audio_url`。
  - Seedance 查询结果支持递归解析 `content.video_url`。
  - VEO 首尾帧提交兼容 1 到 2 张参考图。

### 变更

- **`backend/app/Services/Video/VideoTaskService.php`**：
  - 视频任务创建时按 SKU 官方能力校验参考素材，VEO/GROK 限制为图片参考，Seedance 支持图片、视频和音频参考。
  - 视频任务输入资产补充音频 URL 归集和临时素材绑定。

- **`frontend/src/services/api.ts`**：
  - 新增 `videoApi.batchUpdateSkus`，对接 SKU 批量状态更新接口。

---

## [1.5.21] - 2026-05-27

> **AI 视频批量折扣计费**：新增按多个模型和多个用户/用户组批量生成 SKU 专属计费规则的后台能力，方便管理员统一配置视频模型折扣。

### 新增

- **`backend/app/Http/Controllers/VideoController.php`**：
  - 新增 `adminBatchStorePricingRuleDiscounts` 接口，支持选择多个视频模型、多个用户或用户组，按 SKU 默认扣费乘以折扣百分比批量生成专属计费规则。
  - 支持已有规则覆盖或跳过策略，并返回新增、更新、跳过、待定价 SKU、禁用 SKU 等处理统计。
  - 批量规则写入在事务内完成，并限制单次最多处理 20000 条规则，避免过大批量影响服务稳定性。

- **`backend/routes/api.php`**：
  - 新增 `POST /api/admin/videos/pricing-rules/batch-discount` 管理接口路由。

- **`frontend/src/services/api.ts`**：
  - 新增 `videoApi.batchCreatePricingRuleDiscounts`，对接批量折扣计费接口。

- **`frontend/src/pages/VideoManagement.tsx`**：
  - 计费规则页新增「批量设置模型折扣」入口。
  - 新增批量折扣弹窗，支持模型多选、用户/用户组多选、折扣百分比、已有规则处理策略、状态和备注。
  - 提交前展示预计处理模型数、SKU 数、目标数、规则总数、跳过 SKU 和折扣价示例，并在超出批量上限或没有可处理 SKU 时阻止提交。

### 变更

- **AI 视频计费逻辑兼容**：
  - 本次仅生成现有 SKU 级专属计费规则，不改变桌面端视频生成行为，也不改变用户规则优先、分组规则次之、默认 SKU 价格兜底的核心计费优先级。

---

## [1.5.20] - 2026-05-27

> **AI 视频计费规则修复**：修复专属灵气规则批量保存失败和差额展示浮点精度问题，提升后台计费配置稳定性。

### 修复

- **`backend/app/Http/Controllers/VideoController.php`**：
  - 视频计费规则新增、批量新增、编辑时统一将空备注规整为空字符串，避免 `video_pricing_rules.remark` 非空字段写入 `null` 导致接口 500。

- **`frontend/src/pages/VideoManagement.tsx`**：
  - 计费规则保存增加异常捕获，后端返回错误时给出友好提示，避免控制台出现未捕获的 Promise 异常。
  - 计费规则编辑时仅提交 `credit_cost`、`status`、`remark` 字段，减少无关字段对更新接口的影响。
  - 专属灵气与默认灵气差额展示统一做四位精度规整，修复 `0.9 - 1` 显示为长小数的问题。

---

## [1.5.19] - 2026-05-27

> **用户管理体验优化**：补齐最后登录时间字段，方便管理员判断账号活跃情况和长时间未登录账号。

### 新增

- **`backend/database/migrations/2026_07_15_000010_add_last_login_at_to_users_table.php`**：
  - `users` 表新增 `last_login_at` 字段并建立索引，记录用户最后一次登录时间。

- **`backend/app/Http/Controllers/AuthController.php`**：
  - 用户登录成功后通过 `saveQuietly` 写入 `last_login_at`，避免触发 `updated_at` 影响其他业务。

- **`backend/app/Models/User.php`**：
  - 补充 `last_login_at` 到 `$fillable` 和 `$casts`，统一序列化为 datetime。

- **`frontend/src/components/UserDetailModal.tsx`**：
  - 用户管理「查看用户详情」基础信息中新增「最后登录时间」展示，未登录显示「从未登录」。

---

## [1.5.18] - 2026-05-26

> **AI 视频 SKU 定价收口**：完善待定价 SKU 的过滤、提交拦截和后台配置约束，避免未配置价格的规格进入客户端或差异计费规则。
> **AI 视频客户端信息安全复查**：收口客户端视频目录、任务和用量返回字段，避免上游成本信息暴露给桌面端用户。

### 变更

- **`backend/database/migrations/2026_07_15_000008_optimize_video_skus_and_nullable_default_price.php`**：
  - 视频 SKU `default_credit_cost` 支持为空，空值表示待定价状态。
  - 新增 Seedance、VEO、GROK 等规格 SKU，并记录上游 RMB 成本与来源，便于后台定价参考。
  - 旧占位 SKU 改为禁用或待定价，避免客户端继续展示旧规格。

- **`backend/database/migrations/2026_07_15_000009_align_video_sku_cost_sources_and_supported_combinations.php`**：
  - 复核多米 `doc/105`、`doc/98` 和 Apifox 对接文档后，精确化 GROK SKU 上游成本来源。
  - 禁用 VEO 文档明确不支持的 `REFERENCE + 9:16` SKU 组合，避免后台误定价后开放给客户端。

- **`backend/app/Services/Video/VideoTaskService.php` / `backend/app/Services/Video/VideoBillingContextService.php`**：
  - 客户端视频目录仅返回已启用且已配置默认扣费的 SKU。
  - 任务提交时再次校验 SKU 启用状态、模型启用状态和默认扣费，拒绝未定价 SKU。
  - 客户端计费快照不再返回上游成本文本和成本来源。

- **`backend/app/Services/Video/Adapters/DuomiVideoProvider.php`**：
  - Seedance 参考素材按官方文档补充 `reference_image` / `reference_video` 角色。
  - VEO 按 Apifox 文档提交 `quality` 和 `generation_type`，GROK 按文档提交 `quality`。

- **`frontend/src/pages/VideoManagement.tsx`**：
  - SKU 列表展示定价状态、上游成本和成本来源，待定价状态更明确。
  - SKU 编辑支持清空默认扣费并保存为待定价状态。
  - 价格规则表单禁用待定价 SKU，避免为未配置默认价的规格设置差异价。
  - AI 视频 SKU 新增计费规则支持批量选择多个用户或多个用户组，一次保存多条专属计费规则。

### 修复

- **`backend/app/Http/Controllers/VideoController.php`**：
  - 客户端视频用量接口改为白名单序列化，不再直接返回 `billing_snapshot`。
  - 编辑已有价格规则时重新校验 SKU 默认扣费，防止 SKU 后续被清空价格后仍能保存差异价。
  - 统计待定价 SKU 时仅统计启用 SKU，避免禁用的旧规格干扰后台待处理数量。
  - AI 视频计费规则新增批量创建接口，按 SKU、对象类型和目标 ID 幂等覆盖已有规则。

---

## [1.5.17] - 2026-05-26

> **AI 视频管理体验优化**：后台 AI 视频管理页从数据表维护优化为更贴近视频商品配置的交互，便于查看模型能力、SKU 规格、成本来源和差异价格规则。

### 变更

- **`frontend/src/pages/VideoManagement.tsx`**：
  - 视频模型页展示服务商、协议、模型 ID、支持模式、时长、清晰度、比例和 SKU 启用数量。
  - SKU 与价格页支持按模型筛选，集中展示 SKU Key、所属模型、生成规格、默认算力、上游成本和成本来源。
  - SKU 行新增用户特价、用户组特价和查看价格规则快捷入口，减少在多个标签页之间手工查找。
  - 价格规则页改为差异价格规则视角，列表展示 SKU 上下文、默认价、规则价、目标对象和状态。
  - 新增/编辑价格规则弹窗使用全量 SKU 缓存展示规格和默认价，避免被当前筛选条件影响。

### 修复

- **`frontend/src/pages/VideoManagement.tsx`**：
  - 保存 SKU 后同步更新当前列表和全量 SKU 缓存，避免后续设置差异价时显示旧默认价。
  - 直接进入 SKU 标签页时同步加载模型列表，保证模型筛选下拉有可选项。

---

## [1.5.16] - 2026-05-26

> **AI 视频升级修复包**：修复部分 MySQL 环境执行 AI 视频数据库迁移时，因自动生成索引名过长导致升级失败的问题。

### 修复

- **`backend/database/migrations/2026_05_26_000001_create_video_core_tables.php`**：
  - 将 AI 视频用量表的服务商/协议/时间复合索引改为短索引名，避免 MySQL 64 字符索引名限制触发 `Identifier name is too long`。
  - 迁移增加失败后可重跑处理：如果上次升级已创建部分视频表，本次会跳过已存在表，并补齐缺失的短索引。
  - 初始化视频模型、SKU 和默认价格规则时增加空表判断，避免重跑迁移时重复写入种子数据。

### 兼容性

- 适用于已升级失败并残留部分 AI 视频表的站点，可直接上传本版本后重新执行在线更新。
- 已成功升级到 `1.5.15` 的站点无需特殊处理；本版本不改变业务数据结构，仅修复迁移可执行性。

---

## [1.5.15] - 2026-05-26

> **AI 视频云端中转上线**：云控端新增 AI 视频模型、规格、价格规则、任务结果和用量管理能力，桌面端可通过云端提交视频生成任务。
> **AI 视频权限与计费接入**：套餐和权限策略新增 AI 视频开关、日/月配额，并按视频 SKU 扣除算力额度。
> **视频任务链路复查修复**：补齐参考素材权限校验、任务参数一致性、视频结果地址和后台弹窗数据加载等细节。

### 新增

- **`backend/database/migrations/2026_05_26_000001_create_video_core_tables.php`**：
  - 新增视频服务商账号、视频模型规格、视频 SKU、视频价格规则、视频任务、视频结果、视频用量记录和临时参考素材表。
  - 初始化 Seedance / Veo / Grok 等视频模型和常用规格，后续可在后台启停和调整价格。

- **`backend/app/Http/Controllers/VideoController.php` / `backend/routes/api.php`**：
  - 新增桌面端 AI 视频接口：目录获取、参考素材上传、任务提交、任务列表、任务详情、刷新、取消和用量查询。
  - 新增管理后台 AI 视频接口：统计、服务商账号、模型、SKU、价格规则、任务、用量和结果管理。

- **`backend/app/Services/Video/*` / `backend/app/Jobs/ProcessVideoSubmitJob.php` / `backend/app/Jobs/PollVideoTaskJob.php`**：
  - 新增视频任务创建、提交、轮询、取消、结果入库、结果镜像和计费记录服务。
  - 新增多米视频服务商适配器和 Mock 适配器，便于正式接入和测试验证。

- **`frontend/src/pages/VideoManagement.tsx` / `frontend/src/services/api.ts`**：
  - 后台新增「AI 视频」管理页，支持查看统计、维护服务商账号、调整模型和 SKU、配置价格规则、查看任务结果与用量记录。

### 变更

- **`backend/app/Services/QuotaService.php` / `frontend/src/pages/Plans.tsx` / `frontend/src/pages/Permissions.tsx`**：
  - 套餐和权限策略新增 `allow_ai_video`、`video_quota_per_day`、`video_quota_per_month`，用于控制桌面端 AI 视频入口和用量上限。

### 修复

- **`backend/app/Http/Controllers/VideoController.php`**：
  - 参考素材上传补充 AI 视频权限校验，未授权用户无法绕过桌面端入口直接上传。
  - 分页响应保留 Laravel 分页字段，仅替换 `data` 内容，保证后台和桌面端分页字段一致。
  - 编辑视频服务商账号时，API Key 留空不再误清空；仍可通过「清空 Key」显式清除。

- **`backend/app/Services/Video/VideoTaskService.php` / `backend/app/Services/Video/TemporaryReferenceAssetService.php` / `backend/app/Services/Video/VideoAssetService.php`**：
  - 视频任务提交时按所选 SKU 固定规格参数，避免客户端参数覆盖导致计费与实际生成规格不一致。
  - 参考素材绑定任务时限定当前用户，避免相同 URL 被误绑定到其他用户任务。
  - 视频结果镜像到本地存储后返回绝对地址，桌面端预览和保存更稳定。

- **`frontend/src/pages/VideoManagement.tsx`**：
  - 新建价格规则时会主动加载 SKU 列表，避免未进入 SKU 标签页时下拉为空。
  - AI 视频相关弹窗保持无背景遮罩，仅使用弹窗阴影，符合后台统一交互规范。

### 兼容性

- 本版本新增数据库表和权限字段，由在线更新流程自动执行迁移。
- 默认情况下 `allow_ai_video` 为关闭，管理员需要在套餐或用户权限中启用后，桌面端才会显示 AI 视频入口。
- 已有套餐、余额、用量记录和模型服务不受影响。

---

## [1.5.14] - 2026-05-23

> **灵感数据源开关下线**：「百度文心 ERNIE 默认源 / 云控端自定义」二选一开关已移除，桌面端统一只读云控端自定义灵感。
> **创意模板与共享库浏览优化**：创意模板管理默认查看全部模板；共享库浏览会跳过已拉取到本地的内容，未拉取记录不再被挤到后面页。
> **创意模板共享库接入**：云控端支持将审核通过的创意模板分享到授权管理端共享库，也支持浏览、审核、举报和拉取共享模板到本地。

### 新增

- **`backend/app/Http/Controllers/CreativeTemplateHubController.php` / `backend/app/Services/CreativeTemplateHub/CreativeTemplateHubClient.php`**：
  - 新增创意模板共享库代理控制器和 Hub 客户端，支持分类、公开列表、待审池、审核投票、举报、拉取到本地、分享、撤回和状态同步。
  - 拉取共享模板到本地时会下载并本地化封面图、示例参考图和来源图，避免直接依赖 Hub 侧或分享方站点图片地址。
  - 公开池浏览支持排除本站已分享内容和已拉取到本地内容，避免重复展示。

- **`backend/database/migrations/2026_05_24_000200_add_hub_columns_to_creative_templates_table.php`**：
  - 创意模板表新增 Hub 分享状态字段和 Hub 来源字段，用于记录分享审核状态、同步时间、共享库来源站点和防止拉取模板再次回流分享。

- **`frontend/src/pages/CreativeTemplates.tsx` / `frontend/src/pages/CreativeTemplateHubBrowse.tsx` / `frontend/src/pages/CreativeTemplateHubPending.tsx`**：
  - 创意模板管理页新增分享到共享库、撤回分享和同步共享状态操作。
  - 新增共享创意模板浏览页，支持筛选、搜索、排序、详情、举报、单个拉取和批量拉取。
  - 新增共享创意模板待审页，审核员可对待审模板单个或批量投通过/拒绝票。

### 变更

- **`backend/app/Http/Controllers/InspirationController.php`**：
  - `getConfig()` / `updateConfig()` 移除 `source` 字段，只保留 `skip_audit` 一个开关。
  - `publicConfig()` 写死返回 `{ source: 'custom' }`，保留路由用于兼容旧桌面端（1.5.13 及以下版本读到 `'custom'` 会直接走云端分页，不再 fallback 到百度文心）。

- **`backend/app/Models/SystemSetting.php`**：
  - 删除 `inspiration_source` 的 `CASTS` 项与 `DEFAULT_VALUES` 默认值。
  - 现有数据库中 `inspiration_source` 设置行不再被读写，可安全保留（migration 铁律：已发布字段不动）。

- **`frontend/src/pages/Inspirations.tsx`**：
  - 删除「数据源」Switch UI 与提示文字。
  - 删除 `source` / `sourceLoading` 状态与 `handleSourceChange` 函数。
  - `loadConfig` 简化为只读 `skip_audit`。

- **`frontend/src/pages/CreativeTemplates.tsx`**：
  - 创意模板列表默认不再筛选「待审核」，进入页面直接显示全部审核状态的模板。

- **`backend/app/Http/Controllers/InspirationHubController.php`**：
  - 共享库浏览开启 `exclude_pulled` 时，会按未拉取内容重新补齐分页，已拉取到本地的灵感不再占用当前页展示名额。

### 修复

- **`frontend/src/pages/CreativeTemplateHubBrowse.tsx` / `frontend/src/pages/CreativeTemplateHubPending.tsx`**：
  - 兼容授权管理端 Hub 返回的 `category_name` / `category_id` 扁平分类字段，修复分类名称不显示和拉取时无法按同名分类预选的问题。
  - 修复浏览页筛选、搜索、排序变更后可能使用旧 state 发起请求的问题。

- **`backend/app/Http/Controllers/CreativeTemplateHubController.php`**：
  - 待审池接口转发到授权管理端前会把 `page_size` 转为 `per_page`，保持前后端分页契约一致。

### 兼容性

- 无数据库迁移，无接口字段移除（`publicConfig` 仍返回 `source` 但值已固定）。
- 旧桌面端（1.5.x 及以下）升级后会立即看到云控端自定义灵感；如果云控端没有审核通过的灵感，桌面端灵感广场会显示空，需先在后台录入或开启共享灵感库。
- 桌面端代码（删除 ERNIE fallback、删除「换一批」按钮等）走桌面端独立发布线，本次云控端更新包不包含。
- 创意模板共享库为新增能力，不影响原有创意模板投稿、审核和公开分发接口；未配置授权管理端 Hub 时页面会显示未配置状态。

---

## [1.5.13] - 2026-05-23

> **侧栏菜单补齐**：云控端侧栏「桌面端」分组遗漏了「创意模板」入口，现已补齐，无需直接访问 URL 即可进入。
> **创意模板分类保存 500 修复**：新建/编辑分类时，描述未填会触发数据库 NOT NULL 报错，现已兜底为空串。

### 修复

- **`frontend/src/layouts/AdminLayout.tsx`**：
  - 在「桌面端」分组里补上「创意模板」菜单项，路由指向 `/creative-templates`。
  - `pathToGroupKey` 反查表早已包含该路径，仅是侧栏 `children` 渲染缺失，本次仅补菜单项，不改变路由和权限边界。

- **`backend/app/Http/Controllers/CreativeTemplateController.php`**：
  - `categoryStore` / `categoryUpdate` 写入 `description` 时强制 cast 为 string：`(string) ($request->input('description') ?? '')`，避免前端清空字段时传 `null` 命中 `varchar(500) NOT NULL DEFAULT ''` 触发 `1048 Column 'description' cannot be null`。
  - `name`、`sort_order` 同步做空值兜底，保持各字段写入路径一致。

### 兼容性

- 仅前端菜单与后端控制器变更，无数据库迁移、无接口字段调整。
- 已通过浏览器直接访问 `/creative-templates` 的链接继续可用。
- 旧分类数据不受影响，编辑时清空描述后保存会落为空串而非 `NULL`。

---

## [1.5.12] - 2026-05-22

> **灵感广场参考图与生成尺寸增强**：云控端灵感数据支持保存多张参考图和生成尺寸，公开接口、共享灵感库与后台管理链路同步透传，桌面端复用灵感时可还原参考图和尺寸。
> **创意模板投稿审核上线**：创意模板创建与编辑迁移到桌面端，云控端负责投稿审核、上下架、排序和分发管理。

### 新增

- **`backend/database/migrations/2026_05_22_180000_create_creative_template_tables.php`**：
  - 新增创意模板分类表和创意模板表。
  - 支持模板标题、描述、封面、参考图、变量字段、提示词模板、可见性和排序。

- **`backend/database/migrations/2026_05_23_000000_add_submission_fields_to_creative_templates.php`**：
  - 创意模板表新增投稿状态、投稿人、审核人、驳回原因、本地模板来源和发布时间字段。
  - 支持桌面端投稿后在云控端审核、驳回、撤回和状态同步。

- **`backend/app/Models/CreativeTemplate.php` / `backend/app/Models/CreativeTemplateCategory.php`**：
  - 新增创意模板与分类模型。
  - 支持分类关联、来源灵感关联、投稿人关联和 JSON 字段自动转换。

- **`backend/app/Http/Controllers/CreativeTemplateController.php` / `backend/app/Http/Controllers/CreativeTemplatePublicController.php`**：
  - 新增桌面端创意模板投稿、撤回和投稿状态批量同步接口。
  - 新增云控端投稿审核、驳回、上下架和排序管理接口。
  - 新增客户端公开获取已审核上架模板分类、模板列表和模板详情接口。

- **`frontend/src/pages/CreativeTemplates.tsx`**：
  - 后台新增创意模板管理页面。
  - 支持按审核状态筛选、预览投稿内容、通过/驳回、上下架、排序和分类管理。

- **`backend/app/Http/Controllers/InspirationController.php` / `backend/app/Models/Inspiration.php`**：
  - 灵感数据新增 `ref_images` 和 `generation_size` 字段链路。
  - 管理员新增/编辑、本地公开列表、桌面端用户上传均支持参考图和生成尺寸。

- **`frontend/src/pages/Inspirations.tsx`**：
  - 灵感管理表单支持上传最多 8 张参考图。
  - 支持填写可选生成尺寸，便于桌面端复用时还原构图。

- **`backend/database/migrations/2026_05_22_232000_add_plan_categories_to_plans.php` / `backend/app/Models/PlanCategory.php`**：
  - 新增云控端后台套餐分类表，并为套餐增加分类关联字段。
  - 套餐分类仅用于后台管理和筛选，不影响桌面端套餐展示与购买链路。

- **`backend/app/Http/Controllers/PlanController.php` / `backend/routes/api.php` / `frontend/src/pages/Plans.tsx`**：
  - 套餐管理新增分类筛选、分类管理，以及新建/编辑套餐时选择分类。

- **`backend/database/migrations/2026_05_22_235400_enforce_single_default_user_group.php`**：
  - 新增旧库默认用户分组清理迁移，若存在多个默认分组，仅保留一个。

### 变更

- **`backend/app/Http/Controllers/UserGroupController.php`**：
  - 用户分组改为只允许一个默认分组，设置新默认分组时会自动取消其他默认分组。

- **`frontend/src/pages/CloudBuild/RequestPage.tsx`**：
  - 云打包模板更新记录支持按原始换行展示，多行更新说明阅读更清晰。

- **`backend/app/Http/Controllers/PlanController.php` / `frontend/src/pages/Plans.tsx`**：
  - 新建套餐时套餐编号改为后端自动生成。
  - 后台套餐列表和套餐表单不再显示或填写套餐编号，减少人工维护成本。

- **`backend/app/Http/Controllers/InspirationHubController.php`**：
  - 分享到共享灵感库时同步提交参考图数组和生成尺寸。
  - 从共享灵感库拉取到本地时同步保存参考图和生成尺寸。

- **`backend/public/home/index.html` / `backend/public/home-minimal/index.html`**：
  - 两个官网模板底部备案号改为可点击链接，点击后在新窗口打开工信部备案网站。

- **`backend/app/Http/Controllers/CreativeTemplateController.php` / `frontend/src/services/api.ts`**：
  - 云控端模板创建、编辑和 AI 草稿生成入口已废弃，模板内容统一从桌面端投稿进入。
  - 待审核模板默认不公开分发，撤回模板不能被审核通过。

### 修复

- **`backend/routes/api.php` / `backend/app/Http/Controllers/AuthController.php`**：
  - 修复客户端登录凭证过期后刷新接口被鉴权中间件提前拦截的问题。
  - 登录凭证可在刷新有效期内正常续期，临时网络异常不会误判为退出登录。

- **`backend/app/Http/Controllers/PaymentController.php` / `backend/routes/api.php`**：
  - 修复微信与天阙聚合支付待支付订单可能跨渠道复用的问题。
  - 新增天阙聚合支付升级订单接口，并在支付成功后按升级流程处理套餐。

### 兼容性

- 旧灵感没有参考图或生成尺寸时继续按原有提示词和封面展示。
- 未配置或未上架的创意模板不会出现在客户端公开接口。
- 未审核通过的创意模板不会出现在桌面端云端模板列表。
- 本次仅记录当前版本更新内容，暂不打包云控端更新包。

---

## [1.5.11] - 2026-05-22

> **客服信息、渠道汇总与保存体验增强**：云控端支持为普通云打包和每个 OEM 项目分别配置客服信息，并通过公开站点配置下发给桌面端；渠道中心汇总接口支持按年月筛选订单额和佣金；后台编辑表单清空可选项时不再误报 422 或残留旧值。

### 新增

- **`backend/database/migrations/2026_05_22_001500_add_customer_service_to_oem_projects.php`**：
  - 为 `oem_projects` 新增 `customer_service_title` 和 `customer_service_image_url` 字段。
  - 支持每个 OEM 项目独立维护客服信息。

- **`backend/app/Http/Controllers/CloudBuild/CloudBuildIconController.php` / `backend/routes/api.php`**：
  - 新增 `POST /api/admin/cloud-build/customer-service-image` 客服图片上传接口。
  - 支持 PNG、JPG、JPEG、WEBP 图片，上传后返回可直接访问的绝对 URL。

- **`frontend/src/pages/CloudBuild/RequestPage.tsx`**：
  - 「一键云打包」页面新增「客服信息」设置入口。
  - 支持配置普通云打包客户端用户中心展示的客服标题和图片。

- **`frontend/src/pages/OemProjects.tsx`**：
  - OEM 项目列表每个项目新增「客服信息」设置入口。
  - 支持为每个 OEM 项目独立设置客服标题和图片，互不影响。

### 变更

- **`backend/app/Models/SystemSetting.php` / `backend/app/Http/Controllers/CloudBuild/CloudBuildController.php`**：
  - 新增云打包全局客服信息配置项：
    - `cloud_build_customer_service_title`
    - `cloud_build_customer_service_image_url`
  - 云打包 `profile` 接口支持读取和保存客服信息。

- **`backend/app/Http/Controllers/CloudBuild/OemProjectController.php`**：
  - OEM 项目创建和编辑接口支持保存客服标题和图片。
  - 仅保存对应项目自身客服信息，保持普通云打包与各 OEM 项目独立管理。

- **`backend/app/Http/Controllers/SettingController.php`**：
  - 公开站点配置新增 `customer_service` 字段。
  - 普通客户端返回云打包全局客服信息；OEM 客户端按 `X-OEM-Project-Key` 返回对应 OEM 项目信息。
  - 标题或图片任一为空时返回 `null`，桌面端不展示客服卡片。

- **`frontend/src/services/api.ts`**：
  - 云打包 `saveProfile` 支持客服信息字段。
  - 新增客服图片上传 API 封装。

- **`backend/app/Http/Controllers/OemChannelController.php`**：
  - 渠道中心汇总接口支持 `year` / `month` 参数。
  - 订单额与佣金汇总可按指定年月统计，并返回 `period_year` / `period_month`。

### 修复

- **`backend/app/Http/Controllers/UserController.php` / `backend/app/Http/Controllers/CloudBuild/OemProjectController.php`**：
  - `syncOemProjects` 的 `projects` 与 `syncMembers` 的 `members` 改为 `present|array`。
  - 支持提交空数组清空用户 OEM 项目绑定或 OEM 项目成员，避免保存时报 422。

- **`backend/app/Http/Controllers/SettingController.php`**：
  - 系统设置更新接口的 `settings` 改为 `present|array`。
  - 支持空对象保存，避免无变更提交时误报 422。

- **`backend/app/Http/Controllers/BillingRuleController.php` / `backend/app/Http/Controllers/RedeemController.php` / `backend/app/Http/Controllers/PlanController.php` / `backend/app/Http/Controllers/MattingController.php`**：
  - 计费价格、兑换码次数、套餐数值、AI 抠图扣费等字段允许前端清空后保存。
  - 空值按业务默认值归一化，避免 `numeric` / `integer` 校验导致 422 或写入异常空值。

- **`backend/app/Http/Controllers/ProviderCredentialController.php` / `frontend/src/pages/Providers.tsx`**：
  - 凭证池权重清空时不再触发 422。
  - 服务商高级配置清空后会显式保存为空，不再出现保存成功但旧配置仍残留的问题。

- **`backend/app/Http/Controllers/AnnouncementController.php` / `backend/app/Http/Controllers/DocController.php`**：
  - 公告排序、文档分类排序、文档排序字段清空后按 `0` 保存。
  - 避免编辑表单清空排序值时报 422。

- **`backend/app/Http/Controllers/CloudBuild/OemProjectController.php`**：
  - OEM 项目图标 URL、客服图片 URL 清空后保存为 `null`。
  - 避免 URL 可选字段清空后旧值继续残留。

### 兼容性

- 本版包含新增数据库迁移，在线更新包需要携带完整 `database/migrations/` 目录。
- 旧站点升级后默认不显示客服信息；管理员配置标题和图片后才会展示。
- 未携带 `X-OEM-Project-Key` 的客户端继续使用普通云打包客服信息；OEM 客户端只使用自身项目配置。
- 本次保存体验修复不新增数据库结构，原有必填业务约束保持不变。

### 验证

- `php -l backend/app/Models/SystemSetting.php` 通过
- `php -l backend/app/Http/Controllers/SettingController.php` 通过
- `php -l backend/app/Http/Controllers/CloudBuild/CloudBuildController.php` 通过
- `php -l backend/app/Http/Controllers/CloudBuild/CloudBuildIconController.php` 通过
- `php -l backend/app/Http/Controllers/CloudBuild/OemProjectController.php` 通过
- `php -l backend/routes/api.php` 通过
- `php -l backend/database/migrations/2026_05_22_001500_add_customer_service_to_oem_projects.php` 通过
- `php -l backend/app/Http/Controllers/BillingRuleController.php` 通过
- `php -l backend/app/Http/Controllers/ProviderCredentialController.php` 通过
- `php -l backend/app/Http/Controllers/RedeemController.php` 通过
- `php -l backend/app/Http/Controllers/AnnouncementController.php` 通过
- `php -l backend/app/Http/Controllers/MattingController.php` 通过
- `php -l backend/app/Http/Controllers/PlanController.php` 通过
- `php -l backend/app/Http/Controllers/DocController.php` 通过
- `tsc -b --pretty false --noEmit` 通过

---

## [1.5.10] - 2026-05-21

> **注册开放策略补齐**：云控端「注册策略」新增允许新用户注册开关，并同步给桌面端登录页，用于在暂停开放注册时给用户明确提示。

### 新增

- **`backend/database/migrations/2026_05_21_213500_add_register_enabled_setting.php`**：
  - 新增系统配置 `register_enabled`，默认开启，兼容已有站点的注册行为。

- **`frontend/src/pages/Settings.tsx`**：
  - 「系统设置 → 注册策略」新增「允许新用户注册」开关。
  - 关闭后已注册用户仍可正常登录，仅限制新用户注册。

### 变更

- **`backend/app/Http/Controllers/AuthController.php`**：
  - 注册接口增加 `register_enabled` 门控。
  - 关闭注册时返回 `当前暂未开放注册，请联系管理员`，避免继续创建新用户。

- **`backend/app/Http/Controllers/SettingController.php` / `backend/app/Models/SystemSetting.php`**：
  - 公开站点配置新增 `register.enabled` 字段，供桌面端注册页判断入口状态。
  - `SystemSetting::getAll()` 对布尔业务默认值统一生效，保证旧站点未落库时后台表单显示默认开启。

### 兼容性

- 本版包含新增数据库迁移，在线更新包需要携带完整 `database/migrations/` 目录。
- 旧站点升级后注册默认保持开启，管理员可按需在后台手动关闭。

### 验证

- `php -l backend/app/Models/SystemSetting.php` 通过
- `php -l backend/app/Http/Controllers/AuthController.php` 通过
- `php -l backend/app/Http/Controllers/SettingController.php` 通过
- `php -l backend/database/migrations/2026_05_21_213500_add_register_enabled_setting.php` 通过
- `tsc -b --pretty false --noEmit` 通过

---

## [1.5.9] - 2026-05-21

> **OEM 渠道与佣金体系接入**：云控端新增 OEM 项目渠道、套餐渠道可见性、订单佣金归因、用户 OEM 绑定和佣金订单管理能力，并为桌面端 OEM 渠道中心提供接口支撑。

### 新增

- **`backend/database/migrations/2026_07_15_000005_add_oem_channel_commission_tables.php`**：
  - 新增 OEM 渠道、套餐可见性、订单佣金快照和佣金记录相关数据结构。
  - 支持按 OEM 项目记录渠道归属、佣金用户、佣金比例、佣金金额和佣金状态。

- **`backend/app/Services/OemChannelService.php`**：
  - 新增 OEM 项目 Key 解析、套餐渠道可见性判断、订单佣金快照计算和支付成功后佣金结算能力。
  - 支持优先使用用户注册绑定的 OEM 项目归因订单。

- **`backend/app/Http/Controllers/OemChannelController.php` / `backend/app/Http/Controllers/OemCommissionController.php` / `backend/routes/api.php`**：
  - 新增桌面端渠道中心接口，返回渠道资料、汇总、渠道订单和佣金记录。
  - 新增后台佣金订单列表、筛选和详情接口。

- **`frontend/src/pages/CommissionOrders.tsx` / `frontend/src/App.tsx` / `frontend/src/layouts/AdminLayout.tsx`**：
  - 新增「佣金订单」页面、路由和后台菜单入口。
  - 支持按 OEM 项目、佣金用户、佣金状态、订单状态和时间范围筛选。

### 变更

- **`backend/app/Http/Controllers/PaymentController.php`**：
  - 客户端创建订单时接入 OEM 项目识别和套餐渠道可见性校验。
  - 订单创建时写入 OEM 项目 Key、佣金用户、佣金比例快照和佣金状态。
  - 支付成功后自动结算佣金并生成佣金记录。

- **`backend/app/Http/Controllers/PlanController.php` / `frontend/src/pages/Plans.tsx`**：
  - 套餐新增渠道可见配置，支持默认渠道与指定 OEM 项目渠道。
  - 后台套餐列表和编辑弹窗展示、维护可见渠道。

- **`backend/app/Http/Controllers/CloudBuild/OemProjectController.php` / `frontend/src/pages/OemProjects.tsx`**：
  - OEM 项目支持佣金开关和佣金比例配置。
  - OEM 项目页面新增成员绑定管理能力。

- **`backend/app/Http/Controllers/UserController.php` / `frontend/src/pages/Users.tsx`**：
  - 用户列表支持按 OEM 身份和 OEM 项目筛选。
  - 用户详情和用户管理页支持展示、维护 OEM 项目绑定。

- **`frontend/src/pages/Orders.tsx`**：
  - 订单列表和详情新增 OEM 项目、佣金用户、佣金比例、佣金金额和佣金状态展示。
  - 订单筛选新增 OEM 项目 Key 和佣金状态。

### 兼容性

- 本版包含新增数据库迁移，在线更新包需要携带完整 `database/migrations/` 目录。
- 已有套餐、订单和用户数据保持兼容；未配置渠道可见性的套餐按默认渠道继续展示。
- 本版已生成更新包，`version.json` / `releases.json` 已在本地更新，上传 CDN 后生效。

### 验证

- `php -l backend/app/Http/Controllers/OemChannelController.php` 通过
- `php -l backend/app/Http/Controllers/OemCommissionController.php` 通过
- `php -l backend/app/Http/Controllers/CloudBuild/OemProjectController.php` 通过
- `php -l backend/app/Http/Controllers/PaymentController.php` 通过
- `php -l backend/app/Http/Controllers/PlanController.php` 通过
- `php -l backend/app/Http/Controllers/UserController.php` 通过
- `php -l backend/routes/api.php` 通过
- `tsc -b --pretty false --noEmit` 通过

---

## [1.5.8] - 2026-05-21

> **套餐后台可视化补齐**：云控端后台补齐用户套餐真实余量、套餐额度桶明细和订单类型展示，让管理员能更直观看到用户套餐的可用额度、消耗进度、续费/升级来源和支付订单类型。本次仅记录本地版本与更新说明，暂不生成更新包。

### 新增

- **`backend/app/Http/Controllers/PlanController.php` / `backend/routes/api.php`**：
  - 新增后台套餐额度桶明细接口 `GET /api/admin/user-plan-quotas`。
  - 接口支持按用户、套餐、用户套餐、额度类型、状态和到期时间筛选。
  - 返回 `summary` 和 `available_summary`，分别用于查看筛选范围内全部额度与当前可用额度。

- **`frontend/src/pages/UserPlanQuotas.tsx` / `frontend/src/App.tsx` / `frontend/src/layouts/AdminLayout.tsx`**：
  - 新增「套餐额度明细」页面和菜单入口。
  - 页面展示额度桶的授予、已用、剩余、状态、到期时间和使用进度。
  - 顶部卡片展示当前可用套餐剩余，避免把过期或撤销额度误认为可用额度。

### 变更

- **`backend/app/Http/Controllers/PlanController.php`**：
  - 用户套餐列表新增 `quota_summary` 和 `quota_bucket_count`。
  - `quota_summary` 仅统计 `active` 且未过期的额度桶，保持与真实可用余量一致。

- **`frontend/src/pages/UserPlans.tsx`**：
  - 用户套餐列表从展示授予额度改为展示剩余、已用、授予和进度条。
  - 套餐来源补全「续费」「升级」标签，并增加套餐额度不包含钱包余额的提示。

- **`backend/app/Http/Controllers/PaymentController.php` / `frontend/src/pages/Orders.tsx`**：
  - 订单列表返回并支持筛选 `order_type`。
  - 后台订单页展示「购买 / 续费 / 升级」订单类型。
  - 补充聚合支付渠道标签，订单详情中展示类型和原套餐记录。

### 兼容性

- 本版无新增数据库迁移。
- 仅补充后台展示、筛选和接口返回字段，已有套餐、订单、余额和额度桶数据保持兼容。
- 因当前暂不打包，远端 `version.json` / `releases.json` 暂不更新。

### 验证

- `php -l backend/app/Http/Controllers/PlanController.php` 通过
- `php -l backend/app/Http/Controllers/PaymentController.php` 通过
- `php -l backend/routes/api.php` 通过
- `tsc -b --pretty false` 通过
- `git diff --check` 对本次相关文件通过

---

## [1.5.7] - 2026-05-21

> **套餐与额度体系优化**：云控端新增套餐额度桶、钱包与套餐余额拆分、套餐升级订单和月度续充能力，为桌面端 0.7.6 的账户额度展示、消费预估、余额不足引导和套餐升级入口提供后端支撑。

### 新增

- **`backend/app/Services/BalanceService.php` / `backend/app/Services/QuotaService.php`**：
  - 新增钱包余额与套餐额度的统一查询和扣减能力，支持按套餐额度到期时间优先消耗。
  - 新增用户额度、策略和用量计数聚合能力，供桌面端展示账户额度、可用策略和消耗情况。

- **`backend/app/Http/Controllers/ClientController.php`**：
  - 新增客户端额度接口，返回钱包额度、套餐额度、套餐额度桶、用量计数、策略和限流信息。

- **`backend/app/Http/Controllers/PaymentController.php`**：
  - 新增套餐升级订单能力，支付成功后可开通新套餐并关联原套餐升级来源。

- **`backend/app/Console/Commands/RefillMonthlyQuotasCommand.php`**：
  - 新增月度套餐额度续充命令，并接入计划任务调度，支持订阅型套餐按周期补充额度。

### 变更

- **`backend/app/Services/PlanService.php`**：
  - 套餐开通流程增加额度桶、策略快照、续充周期和升级来源记录。

- **`backend/app/Models/UserPlan.php` / `backend/app/Models/PaymentOrder.php`**：
  - 用户套餐和支付订单增加订阅、续充和升级相关字段。

### 兼容性

- 本版会自动新增套餐额度桶、用量计数和订阅升级相关字段；老站点可通过在线更新自动执行迁移。
- 已有钱包余额、订单和用户套餐数据保持兼容，升级后继续可用。

### 验证

- `php -l backend/app/Console/Commands/RefillMonthlyQuotasCommand.php` 通过
- `php -l backend/app/Http/Controllers/PaymentController.php` 通过
- `php -l backend/app/Services/PlanService.php` 通过
- `tsc -p frontend/tsconfig.app.json --noEmit` 通过

---

## [1.5.6] - 2026-05-21

> **延长云端模型聊天与文档问答超时**：云控端聊天、流式聊天和文档问答的默认等待时间统一从 120 秒调整为 180 秒，降低复杂问题或较慢模型在处理中途超时的概率，并与桌面端 0.7.5 的 Agent 稳定性优化保持一致。

### 变更

- **`backend/config/gateway.php`**：
  - 云端模型聊天默认超时时间从 120 秒调整为 180 秒。

- **`backend/app/Services/Gateway/Adapters/OpenAICompatibleAdapter.php`**：
  - 普通聊天和流式聊天的默认请求超时兜底值从 120 秒调整为 180 秒。

- **`backend/app/Services/DocRagService.php`**：
  - 文档问答调用模型时的聊天超时常量从 120 秒调整为 180 秒。

### 兼容性

- 无数据库变更，无接口字段变更，老站点可直接在线更新。

### 验证

- `php -l backend/config/gateway.php` 通过
- `php -l backend/app/Services/Gateway/Adapters/OpenAICompatibleAdapter.php` 通过
- `php -l backend/app/Services/DocRagService.php` 通过

---

## [1.5.5] - 2026-05-20

> **简化 OEM 项目创建与打包表单**：OEM 项目的内部标识、App ID 和版本号均改为系统自动处理。新建项目时只需填写项目名称等必要信息，版本完全跟随授权管理端当前模板版本，减少误填导致的创建或打包失败。

### 新增

- **`frontend/src/pages/OemProjectBuilds.tsx` / `frontend/src/App.tsx`**：
  - 新增 OEM 项目构建历史独立子页面 `/oem-projects/:projectKey/builds`
  - 构建历史列表从 Drawer 抽屉改为完整页面展示，支持筛选、刷新、详情、取消、重试、安装包管理、清理无效和发起打包
  - 构建历史表格增加横向滚动，避免文件名、操作按钮和详情信息在抽屉中显示不全

### 变更

- **`backend/app/Http/Controllers/CloudBuild/OemProjectController.php`**：
  - 新建 OEM 项目时不再要求用户传入 `project_key`，后端基于自增 ID 自动生成 `oem-{id}` 形式的内部标识
  - `app_name` 允许为空，为空时默认使用项目名称，降低新建表单理解成本
  - `app_id` 不再作为普通新建项手动填写，默认基于自动生成的内部标识生成
  - OEM 项目创建和编辑不再接收项目级 `current_version`
  - 发起 OEM 打包时不再接收或转发用户自定义 `app_version`，本地构建记录使用授权管理端返回的实际模板版本

- **`frontend/src/pages/OemProjects.tsx`**：
  - 新建 OEM 项目表单移除「项目 Key」「应用显示名」「App ID」「当前版本」等容易混淆的输入
  - 编辑时仅只读展示内部标识与 App ID，应用显示名仍可按需调整
  - 发起 OEM 打包弹窗移除版本号输入，改为展示“跟随授权管理端当前模板版本”的来源说明
  - 项目列表移除项目级版本列，构建历史和详情仍展示授权管理端实际返回的构建版本
  - 项目列表操作按钮改为可换行布局，避免「编辑」等按钮超出操作列容器
  - 「历史」按钮改为跳转到 OEM 构建历史独立子页面，不再打开抽屉

- **`frontend/src/pages/Matting.tsx`**：
  - AI 抠图页面的计费单位文案改为读取系统设置中的 `currency_label_credit`
  - 概览、任务列表、任务详情和抠图设置中的积分名称会跟随「系统设置 → 文案界面」自定义显示

- **`frontend/src/services/api.ts`**：
  - OEM 打包请求类型移除必传 `app_version`，与普通云打包一样由授权管理端决定版本

### 兼容性

- 已有 OEM 项目的 `project_key`、`app_id`、历史构建版本不受影响
- 新建 OEM 项目开始使用自动生成内部标识和 App ID
- 普通云打包流程不受影响

### 验证

- `php -l backend/app/Http/Controllers/CloudBuild/OemProjectController.php` 通过
- `tsc -p frontend/tsconfig.app.json --noEmit` 通过
- `npm run build` 通过

---

## [1.5.4] - 2026-05-20

> **OEM 打包能力补齐与云打包维护对齐**：OEM 项目页接入与「一键云打包」一致的 `auth-check` 预检逻辑；当授权管理端开启云打包维护或设置最低云控端版本时，OEM 打包会提前提示并禁止提交。补齐 OEM 项目级安装包管理与无效记录清理，OEM 安装包独立管理在 `public/updates/oem/{project_key}/`，不影响普通云打包 `public/updates/` 根目录。

### 新增

- **`frontend/src/pages/OemProjects.tsx`**：
  - 新增 OEM 项目级「安装包」入口：项目列表和构建历史 Drawer 都可打开安装包文件管理弹窗
  - 弹窗按当前 OEM 项目列出安装包、`.blockmap`、平台、大小、修改时间、关联构建，可直接下载或删除
  - 新增 OEM 项目级「清理无效」入口：支持清理该项目已取消 / 失败的构建记录，并尽可能删除关联安装包文件

- **`backend/app/Http/Controllers/CloudBuild/OemProjectController.php`**：
  - 新增 `listInstallers`：扫描 `public/updates/oem/{project_key}/`，按主安装包聚合 `.blockmap` 并回填关联构建
  - 新增 `deleteInstaller`：删除指定 OEM 安装包及同名 `.blockmap`，并同步清空 `oem_builds.stored_path`
  - 新增 `cleanupInvalid`：清理当前 OEM 项目的失败 / 取消记录，删除关联安装包、补充文件，并把记录从 `oem_builds` 移除

- **`backend/routes/api.php` / `frontend/src/services/api.ts`**：
  - 新增 OEM 项目级安装包管理 API：`GET/DELETE /admin/oem-projects/{projectKey}/installers`
  - 新增 OEM 项目级无效记录清理 API：`DELETE /admin/oem-projects/{projectKey}/invalid`

### 变更

- **`frontend/src/pages/OemProjects.tsx`**：
  - OEM 项目页启动时调用 `cloudBuildApi.authCheck()`，复用一键云打包的授权、维护、最低版本预检结果
  - 未授权、云打包维护中、云控端版本过低时，OEM 打包按钮和提交弹窗确认按钮会同步禁用
  - 提交 OEM 打包时如果授权管理端返回 `maintenance_mode` 或 `admin_version_too_low`，前端会刷新预检状态并展示对应提示

### 兼容性

- 普通「一键云打包」安装包管理、无效记录清理、临时产物清理逻辑不变
- OEM 安装包目录独立于普通云打包目录，删除 OEM 安装包不会影响 `public/updates/` 根目录下的普通安装包
- 临时下载产物仍共用 `storage/app/cloud-builds/tmp`，原「临时产物」管理继续覆盖 OEM 拉取产生的残留文件

### 验证

- `tsc -p frontend/tsconfig.app.json --noEmit` 通过
- `php -l backend/app/Http/Controllers/CloudBuild/OemProjectController.php` 通过
- `php -l backend/routes/api.php` 通过

---

## [1.5.3] - 2026-05-17

> **修复 1.5.2 引入的 致命 bug：`SystemSetting::ALLOWED_KEYS` 漏加 32 个新 key 导致 `PUT /admin/homepage/settings` 直接 500**。1.5.2 仅在本地构建过、**从未上 CDN**，本版直接覆盖发布。

### 修复

- **`backend/app/Models/SystemSetting.php`** → `ALLOWED_KEYS` + `DEFAULT_VALUES`：
  - **根因**：1.5.2 在 `HomepageController::TEXT_KEYS` 加了 32 个新 key（`homepage_template` / `homepage_active_phrase_pack_default` / `homepage_active_phrase_pack_minimal` / `homepage_download_mac_arm` + 28 个 `minimal_*` 模板专属字段），但忘了同步加到 `SystemSetting::ALLOWED_KEYS` 白名单。`SystemSetting::setValue` 第一行 `if (!array_key_exists($key, self::ALLOWED_KEYS)) throw new \InvalidArgumentException("Key not allowed: {$key}")` 直接抛异常 → Laravel ErrorHandler 渲染成 HTTP 500
  - 现象：用户后台「官网设置」切换模板 / 应用话术包 / 编辑任何 `minimal_*` 字段 → `PUT /api/admin/homepage/settings` 返 500，前端 console 报红，所有改动无法保存
  - 排查死角：`SystemSetting::getValue` 同样依赖 ALLOWED_KEYS，但因为传了 fallback 参数（`getValue('homepage_template', 'default')`），未声明的 key 会**静默返回 fallback** 而不是报错。所以「读」始终正常，前端展示完全无异常，只在「写」时炸；本地未做端到端 PUT 测试就直接打了 1.5.2 zip
  - **修复 1**：`ALLOWED_KEYS` 末尾按现有"官网设置"段落顺序补 32 个 key（`homepage_template` / 两个 `homepage_active_phrase_pack_*` / `homepage_download_mac_arm` / 28 个 `minimal_*`），全部走 `'string'` 或 `'text'` 类型。`minimal_*_desc` / `minimal_*_kb_desc` / `minimal_*_memory_desc` 共 6 个长描述字段用 `'text'`，其余短文本用 `'string'`
  - **修复 2**：`DEFAULT_VALUES` 加 `'homepage_template' => 'default'`。让全新装 / 升级老站点在没显式写过 `system_settings.homepage_template` 时，`getAll()` 也返回 `'default'`（`index()` 已传 fallback，但 `getAll()` 路径不传，加这层更稳）。**不影响升级**：老站点没写过这个 key，旧 default 模板继续展示；新装站点也是 default

- **影响范围回顾（仅 1.5.2 → 1.5.3）**：
  - 不改前端：本次 fix 纯后端 1 个文件，前端 admin 控制台代码 / build 产物完全沿用 1.5.2 已构建的版本（前端原本就只调 `/admin/homepage/settings` 的 PUT，不需要改）
  - 不改 migration：1.5.2 新建的 `homepage_phrase_packs` 表 + seeder 不动；旧版本未升过 1.5.2 直接升 1.5.3 也能一次性吃到这张表
  - 不改其他 Controller：`HomepagePhrasePackController::apply` 同样调 `setValue` 写 `homepage_active_phrase_pack_*` 等 key，本次 ALLOWED_KEYS 补全后这条路径也一起修好（之前 apply 也会 500，只是少有人测）

### 验证

- `php -l app/Models/SystemSetting.php` 通过
- 已部署到生产手动验证 PUT `/admin/homepage/settings`（仅文档化，未列代码）

### 不影响

- 1.5.2 已在本地构建产物存在但未上 CDN，1.5.3 直接覆盖发布。CDN 只暴露 1.5.3 一个新版本指针
- 默认模板（`public/home/index.html`）、原 12 个图位、原 11 个通用文本字段：完全不动
- 所有非官网模块：对话 / 生图 / 抠图 / 灵感 / 文档 / 云打包 / 支付 / 在线更新 / 套餐 / 权限 / 余额：本版无任何改动

### 升级方式

- 管理后台「在线更新」一键升级。**无数据库变更、无 composer 变更、无 .env 变更**（本版纯单文件后端 fix）
- 老版本（1.4.x / 1.3.x）也可直接升 1.5.3：会一次性吃到 1.5.0~1.5.3 的全部新功能（AI 抠图 + 官网模板切换 + 行业话术包），含 `homepage_phrase_packs` 表自动新建 + 2 个内置话术包播种

---

## [1.5.2] - 2026-05-17

> **新增「官网模板切换 + 行业话术包」机制**：在不动默认模板（public/home/index.html）的前提下，新增极简模板 public/home-minimal/index.html + 28 个 minimal_* 文本字段 + 4 个 minimal_* 图位 + 行业话术包（HomepagePhrasePack）批量预设填充。**含 1 个数据库迁移**（新建 homepage_phrase_packs 表），**含 1 个 seeder**（minimal/general + minimal/advertising 两个内置话术包，firstOrCreate 策略不会覆盖客户已编辑内容）。**不影响**默认模板、不影响除官网模块外任何业务（对话 / 生图 / 抠图 / 灵感 / 文档 / 云打包 / 支付 / 在线更新均零改动）。
>
> ⚠ **本版未上 CDN，1.5.3 已替代发布**（1.5.2 漏给 `SystemSetting::ALLOWED_KEYS` 加新 key，导致 `PUT /admin/homepage/settings` 直接 500，无法保存任何模板相关改动）。本节保留作设计档案。

### 新增

- **`backend/public/home-minimal/index.html`**（新建，约 1100 行）→ 极简风格官网模板，对应模板代号 `minimal`：
  - **6 个 section**：Hero（标题 + 描述 + 三按钮 Win / Mac Intel / Mac ARM + 主截图）→ Section 1 创作能力（左文右图）→ Section 2 对话能力（左图右文）→ Section 3 双特性卡（本地知识库 + 持续记忆）→ Section 4 六宫格能力（BYOK / 工具自治 / 多 Agent / 插件生态 / 数据本地 / 流式画布）→ Section 5 双 CTA（社群 + 文档）→ Section 6 底部下载
  - **设计令牌**：`--primary: #4F46E5` / `--text-1/2/3` / `--surface-0/1/2` / `--shadow-sm/md` / `--radius/-lg` / `--max-w: 1120px` / `--section-py: 96px`，`@media (max-width: 960px / 560px)` 双断点响应式
  - **JS 行为**：`fetch('/api/public/homepage-config')` 拉 texts + images + site → `applyBranding`（document.title / nav-title / nav-icon 缩写 / footer 年份）→ `applyTexts`（通用字段 + minimalMap 28 条 K/V → DOM id）→ `applyImages`（4 个 `data-img-pos` 占位转 img，nav_logo 特殊处理替换文字图标）→ docs_enabled 控制 nav 文档链接显示 + IntersectionObserver scroll-reveal
  - **图标**：全部内联 SVG（btn-icon / feat-card-icon / grid-feat-icon），无外链字体图标、无 emoji，遵循 design_rules
  - **设计原则**：禁止 AI 风格图标 / 禁止 emoji / 弹窗只阴影不遮罩（无弹窗）/ 简洁专业风格

- **`backend/database/migrations/2026_05_17_000001_create_homepage_phrase_packs_table.php`**（新建）→ 行业话术包表：
  - 字段：`template`(string 32 indexed) / `slug`(string 80) / `name`(string 120) / `description`(string 500 nullable) / `payload`(json) / `is_builtin`(bool default false) / `sort_order`(unsigned int default 0) / timestamps
  - 唯一索引 `(template, slug)`：同模板 slug 不重复，跨模板可重名（default/general 与 minimal/general 共存）
  - 仅用 `Schema::` 与 `DB::` 原生 API，未 import 业务 Model（遵循 migration 铁律）
  - 设计意图：**话术包不参与运行时合并**，仅作"批量预设填充"工具，apply 时把 payload 写入 `system_settings`，前台官网 `publicConfig` 拉到即生效

- **`backend/app/Models/HomepagePhrasePack.php`**（新建）→ Eloquent Model：
  - `$fillable` = template/slug/name/description/payload/is_builtin/sort_order
  - `$casts` = payload→array, is_builtin→bool, sort_order→int
  - `SLUG_REGEX = '/^[a-z0-9_-]+$/'` 与 Controller validation 共享

- **`backend/app/Http/Controllers/HomepagePhrasePackController.php`**（新建）→ 完整 CRUD + apply：
  - `GET /admin/homepage/phrase-packs?template=minimal`：列表 + 当前 active 标记（每模板独立）
  - `POST/PUT/DELETE /admin/homepage/phrase-packs[/{id}]`：CRUD，系统预置 (`is_builtin=true`) 不允许删除、不允许改 template/slug
  - `POST /admin/homepage/phrase-packs/{id}/apply`：apply 流程 = (1) 清空当前模板"专属字段"（按 `{template}_` 前缀）→ (2) 把 payload 中位于该模板专属字段白名单内的 K/V 写入 `system_settings` → (3) 标记 `homepage_active_phrase_pack_{template}` = slug
  - `filterPayload($payload, $template)` 强约束：**只允许当前模板专属字段**，避免话术包覆盖 `homepage_*` 通用字段或其他模板字段
  - 用户自建话术包一律 `is_builtin = false`（防前端伪造），`is_builtin` 字段永远不能从前端 PUT 改

- **`backend/database/seeders/HomepagePhrasePackSeeder.php`**（新建）→ 内置话术包种子：
  - **minimal/general**（通用版，sort_order=0）：payload 留空，apply 时清空 minimal_* 全部专属字段 → publicConfig 自动回退 TEXT_KEYS 默认值
  - **minimal/advertising**（广告/营销版，sort_order=10）：payload 含 24 条行业化文案（创作 / 对话 / 双特性卡 / 六宫格 / 双 CTA 全套）
  - `firstOrCreate(template, slug)` 唯一定位：已存在跳过、不覆盖客户编辑后的内置包；只跑 seeder **不会改变**前台官网展示（用户主动 apply 才写 SystemSetting）

- **`backend/database/seeders/DatabaseSeeder.php`**：在 admin / 余额 firstOrCreate 之后追加 `$this->call(HomepagePhrasePackSeeder::class)`，让 `db:seed` 一并播种

- **`backend/routes/api.php`**：注册 6 个 phrase-packs 路由：
  - GET / POST `/admin/homepage/phrase-packs`
  - GET / PUT / DELETE `/admin/homepage/phrase-packs/{id}`（whereNumber('id') 防字符串子路由冲突）
  - POST `/admin/homepage/phrase-packs/{id}/apply`（whereNumber）
  - 统一在 `auth:jwt + admin` 中间件下，无独立限流

- **`frontend/src/services/api.ts`**：
  - 新增 `HomepageSettingsUpdate = Record<string, string | boolean>` 类型，`homepageApi.updateSettings` 类型从 `Record<string, string>` 放宽，支持 homepage_enabled / homepage_use_docs_as_index / homepage_template 等开关字段
  - 新增 `PhrasePack` / `PhrasePackInput` interface
  - 新增 `homepagePhrasePackApi`：list / show / create / update / remove / apply 6 个方法

- **`frontend/src/pages/HomepageSettings.tsx`**（重构）：
  - 新增「官网模板」Card（Radio.Group + 模板说明 + useDocsAsIndex 互斥提示）
  - 新增「行业话术包」Card（按当前 template 过滤、应用 / 编辑 / 删除按钮、系统预置不可删、新建按钮在无专属字段模板下禁用）
  - 新增「模板专属内容」Card（仅当前模板有专属字段时显示，按 section 分组双列 grid 渲染所有 minimal_* 字段，extra 显示当前激活话术包名）
  - 话术包编辑 Modal：`Form.useWatch('template')` 联动字段区，新建时切模板字段集即时刷新；系统预置时 template / slug 禁用；payload 仅保留当前模板专属字段（与后端双重过滤）
  - 文本字段类型 `TextSettings = Record<string, string>` 改为动态（删除硬编码 DEFAULT_TEXTS 常量）
  - 图位渲染按当前 template 过滤：`default` 模板看原 12 个非 minimal_ 位 / `minimal` 模板看 4 个 minimal_ 位，空集合 Empty 兜底
  - 新增 Apple Silicon Mac 下载链接字段 `homepage_download_mac_arm`，原 Mac 字段标签改为「Mac 下载链接（Intel）」明确区分
  - 移除残留的 `as any` 强制类型转换、清理过时注释

### 变更

- **`backend/app/Http/Controllers/HomepageController.php`**：
  - 新增 `public const TEMPLATES = ['default', 'minimal']` 模板代号白名单（与 `public/home-{template}` 目录名对应，`default` 特指 `public/home/index.html`）
  - `TEXT_KEYS` 扩充：通用字段加 `homepage_download_mac_arm`，minimal 模板专属字段一次性补 28 个（Section 1-5 标题描述 + 六宫格 12 个 K/V + 双 CTA 6 个 K/V，含 `_link`）
  - `update()` 重构：（1）`specificRules` 表精细校验已知字段长度（badge max:30 / title max:80 / desc max:240 / link max:500），（2）剩余 TEXT_KEYS 字段通用兜底 `max:120`，（3）`homepage_template` 用 `Rule::in(self::TEMPLATES)` 校验，（4）持久化 `homepage_template` + `homepage_active_phrase_pack_{default,minimal}`
  - `index()` / `publicConfig()` 暴露 `homepage_template` / `available_templates` / `homepage_active_phrase_pack_*`，方便前端识别当前模板
  - 新增静态方法 `getTextKeys()` / `getTemplateOwnedKeys($template)`：分别给 `HomepagePhrasePackController` 做 payload 白名单校验和"按前缀筛选模板专属字段"，`default` 模板返回空数组（沿用通用 `homepage_*`）
  - 修复 PHP docblock 中 `home-*/index.html` 的 `*/` 提前闭合注释问题，改用 `{template}` 占位描述

- **`backend/app/Models/HomepageImage.php`**：`POSITIONS` 末尾追加 4 个 `minimal_*` 图位（`minimal_nav_logo` / `minimal_hero_main` / `minimal_section_create` / `minimal_section_chat`），全部带 `[极简模板]` label 前缀方便后台一眼识别。默认模板原 12 个图位完全不动

- **`backend/routes/web.php`**：根 `/` 路由按 `system_settings.homepage_template` 选择模板目录候选（`public/home-{template}/index.html` 优先，找不到自动回落 `public/home/index.html`），模板代号严格走 `HomepageController::TEMPLATES` 白名单 `in_array` 校验，**杜绝 path traversal**（之前用 regex 已防御，本版改成枚举白名单更收敛）

- **`docs/云控端更新包打包流程.md`**：1.5 章节追加 1.5.3 节说明官网静态模板无构建过程 + robocopy 排除列表必须保留 `public/home*` + 验证清单加 `database/seeders/` / `public/home/index.html` / `public/home-minimal/index.html` 三项

### 修复

- **`backend/app/Http/Controllers/HomepagePhrasePackController.php` `apply` / `filterPayload`**：之前 store/update/apply 用全量 `TEXT_KEYS` 做白名单，理论上允许话术包写入 `homepage_*` 通用字段或跨模板字段。本版强约束改为 `array_flip(getTemplateOwnedKeys($pack->template))`，让话术包**只能改当前模板专属字段**，与设计意图一致（通用字段由用户在 HomepageSettings 直接编辑）

- **`backend/routes/web.php`**：模板代号校验从 `preg_match('/^[a-z0-9_-]+$/', $template)` 升级为 `in_array($template, HomepageController::TEMPLATES, true)`，避免误填非白名单模板代号导致被拒绝时绕回 default 看似没切换的困惑

- **`frontend/src/pages/HomepageSettings.tsx`**：话术包编辑 Modal 内字段区原本写死 `editPackTarget?.template || template`，新建时改顶部「归属模板」单选不会刷新字段区。本版加 `Form.useWatch('template', editPackForm)` 让字段集随选择联动；同时清掉两处残留的 `as any`

### 验证

- PHP 语法：8 个新/改文件 `php -l` 全部通过
- Laravel 路由：`php artisan route:list --path=homepage` 列出 11 条 homepage 路由（含 6 条 phrase-packs）
- migration：`php artisan migrate:status` 可见 `2026_05_17_000001_create_homepage_phrase_packs_table` Pending（生产首次升级在线 `migrate --force` 自动应用）
- 前端类型：`tsc -b --noEmit` 通过；`npm run build` 通过（admin 控制台产物落到 `backend/public/admin/`）
- 关键词检查：`wujie` / `无界` / `本地算力` / `local compute` 在所有改动文件中无残留（项目要求不强调本地算力叙事）

### 不影响

- 默认模板（`public/home/index.html`）、原 12 个图位（`nav_logo` / `hero_main` / `feat_*` / `suite_*` / `canvas_main`）、原 11 个通用文本字段：本版**完全不改**，已部署的客户站点升级后界面零变化
- 所有非官网模块：对话 / 生图 / 抠图 / 灵感广场 / 文档 / 云打包 / 支付 / 在线更新 / 套餐 / 权限 / 模型分配 / 余额：本版无任何改动
- 数据库已有数据：`homepage_images` / `system_settings` / 任何业务表均不读写改写，仅新增独立的 `homepage_phrase_packs` 表

### 升级方式

- 管理后台「在线更新」一键升级。`UpdateService` 会自动跑 `migrate --force` 创建 `homepage_phrase_packs` 表 + 自动跑 `db:seed --force` 播种 2 个内置话术包
- 老版本（1.4.x / 1.3.x）也可直接升 1.5.2，一次性吃到 1.5.0~1.5.2 的全部新功能（AI 抠图 + 官网模板切换 + 行业话术包）
- 升级后默认仍走 `default` 模板，原官网内容零变化；如需切换到极简模板，到「官网设置 → 官网模板」选择「极简模板」即可。**此切换是即时生效的，无需重启服务**

---

## [1.5.1] - 2026-05-17

> **修复 1.5.0 引入的 AI 抠图致命 bug：阿里 SDK 字段名大小写写错导致所有抠图调用失败**。1.5.0 仅在本地构建过、**从未上 CDN**，本版直接覆盖发布。

### 修复

- **`backend/app/Services/Aliyun/AliyunMattingService.php`** → `segmentLocalFile` / `segmentImageUrl`：
  - **根因 1（字段名大小写）**：阿里 PHP SDK 的 Request model 属性名是 **小写 url** 风格（`imageUrlObject` / `imageUrl`），而 1.5.0 代码写成了 **大写 URL** 风格（`imageURLObject` / `imageURL`）。PHP 属性名大小写敏感，SDK 内部 `if (null !== $request->imageUrlObject)` 直接判 null → 完全跳过 OSS 上传分支 → 真实 `SegmentHDCommonImage` 请求时 `ImageUrl` 字段为空 → 阿里返回 `ImageUrl is mandatory for this action. [MissingImageUrl]`，所有用户调用与「调用测试」都报错（云控端 500 / 桌面端任务 failed）
  - **`imageURLObject` → `imageUrlObject`**：`SegmentHDCommonImageAdvanceRequest` 实例化字段名严格按 SDK 定义（`AlibabaCloud\SDK\Imageseg\V20191230\Models\SegmentHDCommonImageAdvanceRequest::$imageUrlObject`，`Stream` 类型，`@var Stream` 注释）
  - **`imageURL` → `imageUrl`**：`SegmentHDCommonImageRequest::$imageUrl`（`@var string`），同款大小写问题
  - **`segmentHDCommonImage($req, $runtime)` → `segmentHDCommonImage($req)`**：SDK 该方法签名是单参，多传 runtime 会触发 `Too many arguments` 警告。Advance 版本（`segmentHDCommonImageAdvance`）才是双参，因为内部需要 runtime 控制 OSS 上传超时
  - **`use AlibabaCloud\Tea\Utils\Utils\RuntimeOptions` → `use AlibabaCloud\Dara\Models\RuntimeOptions`**：SDK 2024+ 已迁移到 Dara 框架，Advance 方法签名 `function segmentHDCommonImageAdvance($request, $runtime)` 期望的 `$runtime` 类型是 `AlibabaCloud\Dara\Models\RuntimeOptions`，旧的 `Tea\Utils\Utils\RuntimeOptions` 类型不匹配（PHP 静态分析报警，运行时 SDK 可能忽略 readTimeout / connectTimeout / autoretry / maxAttempts 配置导致超时控制失效）
  - **`fopen()` resource → `GuzzleHttp\Psr7\Utils::streamFor()`**：阿里 `tea-fileform` 上传 OSS 时会调用 `$content->read($length)`，原生 PHP resource 没有 `read()` 方法，会导致管理后台「调用测试」报 `Call to a member function read() on resource`。本版改为传 PSR-7 Stream 对象，覆盖后台调用测试、`php artisan test:matting`、桌面端云接口中转三条本地文件上传路径
  - **兼容异步返回**：阿里接口有时会先返回“任务已提交成功，请以 requestId 作为 jobId 调 GetAsyncJobResult 查询结果”，不直接返回透明 PNG URL。本版自动使用 `requestId` 轮询 `GetAsyncJobResult`，解析 `Data.Result` 中的 `ImageUrl`，避免这类成功提交被误判为失败
  - **异常消息提取兼容**：`Throwable::$data` 改为 `get_object_vars($e)['data'] ?? null`，避免 PHP 静态分析误报，同时继续兼容 TeaError / TeaUnretryableError 的 `Code` / `Message` 提取

- **`backend/app/Services/Aliyun/PatchedImageseg.php`**（新建）→ 修复 SDK 父子包版本组合 bug：
  - **根因 2（父子包版本不匹配）**：alibabacloud/imageseg-20191230 4.0.1 的 `Imageseg.php` 在 `_postOSSObject` 调用里引用 `$this->_retryOptions`，但 composer 装的父类 `alibabacloud/openapi-core 1.0.9`（imageseg 4.0.1 在 composer.json 中要求 `^1.0.0` 解析出的最高版本）**没有声明** `$_retryOptions` 属性。PHP 8 访问未声明属性触发 `E_WARNING: Undefined property`，被 Laravel `ErrorHandler` 升级为 `ErrorException` → HTTP 500「Undefined property: AlibabaCloud\SDK\Imageseg\V20191230\Imageseg::$_retryOptions」
  - **修复方式**：新建 `App\Services\Aliyun\PatchedImageseg` 类继承官方 `Imageseg`，**补声明** `protected $_retryOptions` 字段（默认 null = 用客户端默认重试）。子类声明对父类继承的方法可见，等同于把缺失字段「打补丁」回去，无需改 vendor、不影响 composer 升级
  - `AliyunMattingService::configure` 把 `new Imageseg($cfg)` 替换为 `new PatchedImageseg($cfg)`
  - `AliyunMattingService::$client` 类型同步从 `?Imageseg` 改为 `?PatchedImageseg`，避免 PHP 把未导入的 `Imageseg` 解析成当前命名空间下的 `App\Services\Aliyun\Imageseg`，导致赋值时报 `Cannot assign App\Services\Aliyun\PatchedImageseg to property ... of type ?App\Services\Aliyun\Imageseg`
  - 未来阿里官方修复了父子包版本组合 bug 后，可移除 PatchedImageseg + 改回 `new Imageseg(...)`；本类仅作过渡兜底

### 验证

- `php artisan test:matting <local.jpg>` 应输出 `SUCCESS` + `request_id` + `result_url`
- 管理后台「AI 抠图 → 调用测试」上传图能看到透明 PNG 结果
- 桌面端用户提交抠图任务能正常完成并自动入「我的抠图」分类

### 不影响

- `MattingController` / `ProcessMattingTaskJob` / `MattingRateLimiter` / migration / SystemSetting / 路由 / React UI / Artisan 等其他云控端模块：1.5.0 已正确实现，本版不改业务语义，仅修 SDK 入参兼容问题

### 升级方式

- 管理后台「在线更新」一键升级。**无数据库迁移变更、无 composer 依赖变更、无 .env 变更**
- 老版本（1.4.x 或更早）也可直接升 1.5.1（一次性吃到 1.5.0 + 1.5.1 全部新功能）；升级完成后到「AI 抠图 → 自定义设置」填写阿里 RAM 子账号 AccessKey 并打开「服务总开关」即可启用

---

## [1.5.0] - 2026-05-17

> **新增 AI 抠图（阿里云 viapi SegmentHDCommonImage）**：完整端到端实现，含管理后台四 Tab UI（概览 / 任务列表 / 调用测试 / 自定义设置）、网关限流、独立任务表自治计量、套餐与权限三个 matting policy key 接入。**重要设计决策**：凭证 / 计费 / 启用开关全部走 `SystemSetting` (matting_*)，由管理员在「AI 抠图 → 自定义设置」UI 配置；**不走** .env，**不走** `cloud_providers` / `cloud_models` / `billing_rules` 体系，避免污染服务商列表 + 简化权限模型。**含 1 个数据库迁移**（仅新建 `matting_tasks` 独立表，不动现有 ENUM、不 seed cloud_providers），**含 4 个 composer 依赖新增**（`alibabacloud/imageseg-20191230` 等阿里 SDK，含传递依赖共 13 个包）。
>
> ⚠ **本版未上 CDN，1.5.1 已替代发布**。本节仅作设计档案保留。

### 新增

- **`backend/composer.json`** + lock：新增 4 个阿里云 PHP SDK 依赖
  - `alibabacloud/darabonba-openapi:^0.2`（OpenAPI 客户端基础）
  - `alibabacloud/imageseg-20191230:^4.0`（图像分割产品 SDK）
  - `alibabacloud/tea-fileform:^0.3`（Advance API 本地文件 multipart 直传 OSS，支持无损直传）
  - `alibabacloud/tea-utils:^0.2`（RuntimeOptions 等工具）
  - 传递依赖：`alibabacloud/credentials` / `darabonba` / `gateway-spi` / `openapi-core` / `openapi-util` / `tea` / `tea-xml` + `adbario/php-dot-notation` + `lizhichao/one-sm`，共 13 个新包
  - vendor 体积约 +600 KB，对线上零行为影响（仅新链路 MattingController 使用）

- **`backend/config/aliyun.php`**（新建）：抠图静态参数集中配置
  - `matting.global_qps`（默认 5）/ `matting.per_user_concurrency`（默认 3）/ `matting.poll_timeout_seconds`（默认 60）
  - `matting.max_file_size_bytes`（40MB）/ `matting.allowed_extensions`（png/jpg/jpeg/bmp）
  - **不含** `viapi.access_key_id` / `access_key_secret` / `endpoint` / `region_id` —— 这些走 `SystemSetting`，**不读 .env**

- **`backend/.env.example`**：仅在末尾追加两条可选限流 env 注释占位（`ALIYUN_MATTING_GLOBAL_QPS` / `ALIYUN_MATTING_PER_USER_CONCURRENCY`），均有合理默认值；不再要求 `ALIYUN_VIAPI_*` 类字段

- **`backend/app/Models/SystemSetting.php`**：`ALLOWED_KEYS` 加 6 个 `matting_*` key：
  - `matting_enabled` → `bool`（服务总开关，默认 false）
  - `matting_access_key_id` → `string`
  - `matting_access_key_secret` → `encrypted`（Crypt::encryptString 自动加密入库 + getAll 不返明文）
  - `matting_endpoint` → `string`（默认 `imageseg.cn-shanghai.aliyuncs.com`）
  - `matting_region_id` → `string`（默认 `cn-shanghai`）
  - `matting_credit_per_call` → `float`（默认 0.2）
  - `DEFAULT_VALUES` 同步补默认值，未配置时 `getValue` 自动回退

- **`backend/database/migrations/2026_07_01_000001_add_matting_support.php`**（新建，**单表精简版**）
  - 仅 `Schema::create('matting_tasks', ...)`：uuid pk / user_id / source(upload|url) / request_meta json / status / result json / error / cost / request_id / timestamps，3 个索引：`status` / `(status,created_at)` / `(user_id,created_at)`
  - **不动** `cloud_models.type` / `usage_records.type` ENUM；**不 seed** `cloud_providers` / `cloud_models` / `billing_rules`；**不引入** `cloud_model_id` 外键
  - 抠图独立成完整体系，不污染现有 chat/image/embedding 表

- **`backend/app/Models/MattingTask.php`**（新建）：uuid pk + `request_meta` / `result` json cast + `cost` float cast + belongsTo user（**无** cloudModel 关联）

- **`backend/app/Services/Aliyun/AliyunMattingService.php`**（新建）：阿里 SDK 调用封装
  - `__construct()` 只读 `config('aliyun.matting')` 静态参数（限流 / 文件限制），**不读** viapi 凭证
  - `configure(array $creds)`：注入凭证后才初始化 `Imageseg` client；调用方先调此方法才能 segment（`assertConfigured()` 守卫）
  - `segmentLocalFile($localPath)`：走 `segmentHDCommonImageAdvance`，SDK 自动上传临时 OSS（**唯一支持本地无损直传的方式**），返回 `{image_url, request_id, elapsed_ms}`
  - `segmentImageUrl($publicUrl)`：走普通 `segmentHDCommonImage`（公网 URL 模式）
  - 本地校验：file_exists / size > 0 / size ≤ 40MB / ext ∈ {png,jpg,jpeg,bmp}
  - RuntimeOptions：readTimeout = `poll_timeout + 30s`，autoretry=false（重试由 Job tries 控制，避免双重重试）

- **`backend/app/Services/Matting/MattingRateLimiter.php`**（新建）：双层限流
  - 全站 QPS：`Cache::increment('matting:rl:global:' + time())` fixed window（TTL=2s 覆盖时钟漂移）
  - 单用户并发：sliding window，`matting:rl:user:{userId}:active` 列表 + 每个 token 自带 TTL（默认 120s 兜底，防 PHP-FPM 崩溃后泄漏）
  - `tryAcquire(userId)` 返回 token 或 false；`release(token)` 由调用方 finally 调

- **`backend/app/Jobs/ProcessMattingTaskJob.php`**（新建）：抠图异步任务
  - 沿用 `ProcessImageTaskJob` 同款模式（tries=2 / timeout=120 / backoff=15s / queue='matting'）
  - sync driver 下由 Controller 用 `app()->terminating` 包；database driver 下 `dispatch` 入队
  - **handle 头部** 调 `$svc->configure(MattingController::resolveCreds())`，凭证从 SystemSetting 拿
  - URL 模式从 `Cache::pull("matting:task:{taskId}:url")` 读 url；upload 模式从 Controller 写盘的 `tempFilePath` 读
  - **不写** `UsageRecord`（matting 用量走 `matting_tasks.cost` 字段自治）
  - 扣费金额从 `SystemSetting::getValue('matting_credit_per_call')` 读
  - 末尾 `cleanup(rl)`：`rl->release(token)` + `unlink(tempFilePath)`

- **`backend/app/Http/Controllers/MattingController.php`**（新建，**11 个端点**）
  - **Client**（`/api/gateway/matting/*` 在 `auth.jwt`）：
    - `POST /segment` multipart 提交（`image` 文件 或 `image_url` 参数）→ 5 步校验（**服务总开关** / permission / month quota / balance / rate limit）→ 入 `matting_tasks` + 派发 Job
    - `GET /status/{taskId}` 用户轮询
    - `GET /quota` 拉本月配额状态（含 `matting_enabled` 总开关字段）
    - `GET /tasks` 自己的历史任务
  - **Admin**（`/api/admin/matting/*` 在 `auth.jwt + admin`）：
    - `GET /stats` 今日 / 本月任务量 + by_status + Top 10 用户 + 配置状态（**新结构**：enabled + masked AK + credit_per_call + 限流 + 文件上限）
    - `GET /settings` **新增**：返回 6 个 matting setting + endpoint 下拉选项（用户决策：默认填好接口地址）；AK Secret 仅返 `has_xxx` 标志，不返明文
    - `PUT /settings` **新增**：保存 6 项；AK Secret 留空 = 不修改（与 SettingController 一致语义）
    - `GET /tasks` 全站任务列表（分页 + user_id / status / source / keyword / from_date / to_date 过滤）
    - `GET /tasks/{id}` 任务详情
    - `DELETE /tasks/{id}` + `POST /tasks/batch-delete`
    - `POST /test`（throttle:10/min）管理员测试调用：先 `configure(resolveCreds())` 注入凭证，再跑抠图
  - 静态 `MattingController::resolveCreds()`：Service / Job / Artisan 共享的凭证读取入口（从 SystemSetting 拿明文 secret），单一数据源
  - 私有 `resolveUserPolicies` 用户权限合并（default < group < plan(merged) < user-self 4 层）；`countMonthUsage` 改为从 `matting_tasks.completed` 自治统计

- **`backend/routes/api.php`**：补 matting 路由组
  - `Route::prefix('gateway')` 内：`POST /matting/segment`（throttle:30/min）+ `GET /matting/status/{taskId}`（throttle:600/min）+ `GET /matting/quota` + `GET /matting/tasks`
  - `Route::prefix('admin')` 内：`Route::prefix('matting')` 子组 8 个端点（顺序：stats / **settings** GET+PUT / tasks / batch-delete / tasks/{taskId} / DELETE tasks/{taskId} / test，**字面量必须先于 /{taskId}**）

- **`backend/app/Console/Commands/TestMatting.php`**（新建 artisan）：`php artisan test:matting <localPath>` 端到端调通验证
  - 凭证来源（v1.5.0+）：`MattingController::resolveCreds()` 读 SystemSetting，**不读** .env
  - 输出含 `ak_configured` 标志位（YES/NO），便于运维快速判定是否填了 AK
  - `--url` 模式接公网 URL

- **`backend/app/Http/Controllers/ClientController.php`**：`myPermissions` defaults 加 3 个 matting key
  - `allow_image_matting` 默认 true（关闭后桌面端「AI 抠图」入口隐藏）
  - `allow_custom_matting_provider` 默认 false（开启后桌面端可填自己的阿里 AK/SK 直连）
  - `image_matting_quota_per_month` 默认 100（0=不限；超限后 segment 端点直接 429）

- **`frontend/src/services/api.ts`**：新增 `mattingApi` 8 个端点（stats / **getSettings** / **updateSettings** / list / get / delete / batchDelete / test）

- **`frontend/src/pages/Matting.tsx`**（新建）：**四** Tab 综合管理页
  - **概览** Tab：今日 / 本月统计 + 状态分布 + 服务配置 Descriptions（含「服务状态」「AccessKey 状态」「Endpoint」「Region」「限流」「单图上限」）+ Top 10 用户表
    - AK 未配置 → 黄色 Alert 提示「未配置 AccessKey」+ 按钮跳「自定义设置」tab
    - AK 已配但未启用 → 黄色 Alert 提示「已配置但未启用」+ 按钮跳「自定义设置」tab
    - 「服务配置」卡片右上角加「编辑」按钮直接切「自定义设置」tab
  - **任务列表** Tab：分页 + 多条件筛选 + 批量删除 + 详情 Modal（透明棋盘格底）
  - **调用测试** Tab：拖拽上传 → 调 `mattingApi.test`（凭证用当前自定义设置的 AK 注入 SDK）→ 透明结果展示
  - **自定义设置** Tab（**用户决策 #2**）：Form 表单
    - 服务总开关 Switch
    - Access Key ID Input + 当前掩码显示
    - Access Key Secret Input.Password + 留空不修改提示
    - Endpoint Select（默认填充 `cn-shanghai`，备选 `cn-beijing`；切换自动联动 Region ID）
    - Region ID Input
    - 单次扣费 InputNumber（积分 / 张）
    - 保存按钮 → PUT `/admin/matting/settings` + 自动刷新概览状态

- **`frontend/src/App.tsx`** + **`layouts/AdminLayout.tsx`**：加 `/matting` 路由 + 侧栏「AI 资源」组下加「AI 抠图」入口（`ScissorOutlined`）+ `pathToGroupKey` 映射

- **`frontend/src/pages/Plans.tsx`** + **`Permissions.tsx`**：`KNOWN_POLICIES` / `policyKeys` 各加 3 个 matting key

### 变更

- **`backend/app/Http/Controllers/ClientController.php`**：`myPermissions` defaults 扩 3 个 key，桌面端 `cloud-auth.ts::CloudPermissions` 同步扩展，向后兼容
- **桌面端 `stores/matting.ts::MattingCloudQuota`**：加 `matting_enabled` 字段
- **桌面端 `MattingView.vue::runDisabledReason`**：加分支「抠图服务暂未启用」（`matting_enabled === false` 时按钮禁用）

### 兼容性

- **数据库 migration**：`matting_tasks` 是全新表；**不动** `cloud_models` / `usage_records` 既有 schema；旧站点升级零数据风险
- **Composer 依赖**：4 个阿里 SDK 仅在 matting 链路引用，对 chat / image / embedding 等其他链路零行为影响
- **`Darabonba\OpenApi` 命名空间冲突**：`alibabacloud/darabonba-openapi` 与 `alibabacloud/openapi-core` 同时声明 5 个同名类，composer dump-autoload 警告 `Ambiguous class resolution, ... the first will be used`。阿里官方 SDK 已知历史问题，运行时按 SDK 文档 API 调用无错；不影响功能
- **PHP-FPM / nginx 调优建议**：抠图任务最长同步等待 60s，建议
  - `request_terminate_timeout = 90`
  - nginx `proxy_read_timeout 90s`
  - `upload_max_filesize` / `post_max_size` ≥ 50M（默认 8M 必须改，不然 40MB 大图直接 413）

### 升级方式

- 管理后台「在线更新」一键升级（沿用 1.4.x 流程）
- **必须配置**：升级完成后到「AI 抠图 → 自定义设置」tab 填写 Access Key ID + Secret（开通阿里 viapi 分割抠图服务后获取 RAM 子账号 AK），勾选「服务总开关」并保存。**老版本** `.env` 里的 `ALIYUN_VIAPI_*` 字段保留不影响（本版已不读），可在配置完成后删除
- **可选调优**：按上面「兼容性」段调 PHP-FPM / nginx 超时 + 上传大小
- **验证**：「AI 抠图 → 调用测试」上传一张小图 → 看到透明 PNG 结果即说明端到端通

### 设计决策记录（DR）

- **DR-1：抠图凭证为何不走 .env / cloud_providers？**
  - 用户决策：「云控端里阿里云 viapi(抠图)这条记录不要，改成在 AI 抠图页面增加一个 tab 自定义设置」
  - 走 SystemSetting 的好处：(a) 凭证可视化管理（不需 SSH 改 .env + 重启 PHP-FPM）；(b) 服务商列表保持干净；(c) AK Secret 走 Crypt encrypted 加密入库
  - 代价：失去按 user/group/default 三级覆盖计费的能力（matting credit_per_call 是全局唯一价）；matting 用量不在「用量统计」全局页（只在「AI 抠图 → 概览」可看）

---

## [1.4.8] - 2026-05-16

> **生图（图像编辑 multipart 上传）失败回归修复**：用户报告 `gpt-image-2` 走 `/v1/images/edits` 调用 `https://api.772.ee` 时上游返回 `Gateway error: cURL error 0: The cURL request was retried 3 times and did not succeed. ... unable to rewind the body of the request ... PHP bug #47204`，1.4.6 时该链路是正常的。对比 1.4.6 zip 内的 `AbstractAdapter.php` 后定位回归点：当前版本的 `buildHttp` 多出了一段为排查「云端 gpt-image-2 4K 静默回落 1K」加的实验代码——`CURLOPT_HTTP_VERSION => 4`（强制 HTTP/2）+ `[DEBUG-IMAGE-1K]` 临时日志。该实验代码自己的注释明确写「问题闭环后可删除」，但未删除，且引入了副作用：HTTP/2 + multipart 大 body 在某些上游（中转 API）上触发 cURL 内部 stream 控制 retry → 需要 rewind multipart body → Guzzle MultipartStream 的 SEEKFUNCTION 不可靠（PHP bug #47204）→ cURL error 0。本版回滚 HTTP/2 强制 + 清理 DEBUG 日志，回归 1.4.6 行为；同时在 multipart 路径上加固 keep-alive 防护，作为通用最佳实践沉淀下来。**仅后端 2 文件修改**，无数据库变更、无依赖变更、无 .env 变更。

### 修复

- **`backend/app/Services/Gateway/Adapters/AbstractAdapter.php`** → `buildHttp`：
  - **移除** `withOptions(['curl' => [CURLOPT_HTTP_VERSION => 4]])` 强制 HTTP/2（4 = `CURL_HTTP_VERSION_2TLS`）。HTTP/2 多路复用对 OpenAI 协议族（单次请求-单次响应）零收益，反而把 multipart 上传的 retry 概率显著放大
  - **移除** `[DEBUG-IMAGE-1K]` 临时调试日志（`curl_version()` + features 位掩码 + `Log::info`），原本只用于确认实验代码已加载，问题排查闭环后该清理
  - **移除** 不再使用的 `use Illuminate\Support\Facades\Log` import
  - **保留** UA spoof（Chrome 131 浏览器 User-Agent） + `Accept: */*` + `Accept-Encoding: gzip, deflate, br`：这部分对 multipart rewind 问题无影响，且 1.4.6 之后部分中转 API 已开始按 UA 区分行为，回滚会带来其他风险面，故只回滚明确有副作用的 HTTP/2 部分

- **`backend/app/Services/Gateway/Adapters/OpenAICompatibleAdapter.php`** → `postImageMultipart`：
  - **删除** 临时方案里 `withOptions(['curl' => [CURLOPT_HTTP_VERSION => 2]])` 的覆盖（HTTP/1.1 强制）—— buildHttp 已不强制 HTTP/2，cURL 默认就是 HTTP/1.1，无需再覆盖
  - **保留** `CURLOPT_FORBID_REUSE => 1`（用完即关连接，不进 keep-alive 池）
  - **保留** `CURLOPT_FRESH_CONNECT => 1`（每次新连接，不从池里拿）
  - **保留** `Expect:` 空头（禁用 cURL 默认 Expect: 100-continue 协商，避免大 body 卡 1s + 部分中转 API 不支持 Expect 协商）
  - 这 3 项合在一起形成「一连接一上传」模型，是 multipart 大 body 上传的通用最佳实践，不依赖任何特定上游，沉淀下来作为加固
  - 文档注释里留下完整溯源链：「HTTP/2 强制曾在 buildHttp 中存在（为排查 gpt-image-2 4K 退化 1K 问题），但触发了 multipart + HTTP/2 stream 控制 retry 导致本接口大面积失败，已移除」

### 根因链路

```
1.4.7 buildHttp 默认强制 HTTP/2（实验代码）
   ↓
ImageEdits → OpenAICompatibleAdapter::image('edits') → postImageMultipart
   ↓
attach('image', base64_decode($base64), 'ref_X.png')  ← 数十 KB ~ 数 MB multipart 大 body
   ↓
cURL 走 HTTP/2 上传到 api.772.ee
   ↓
对端 HTTP/2 GOAWAY / stream RST / 连接被 reset
   ↓
cURL 内部触发 retry on next connection
   ↓
retry 需要 rewind 已经写出的 multipart body
   ↓
Guzzle MultipartStream.SEEKFUNCTION 不可靠（PHP bug #47204）
   ↓
"cURL error 0: retried 3 times and did not succeed. unable to rewind the body"
```

### 兼容性

- **与 1.4.7 完全兼容**：纯后端修复，未改动任何接口契约 / 数据库 / 依赖
- **对 chat / embeddings 无影响**：那些场景的 body 都是小 JSON 字符串，HTTP/1.1 / 2 切换无感
- **「4K 退化 1K」实验代码顺手回滚**：该实验本身效果未达成（注释自承「UA spoof 已无效」），不会让原问题恶化；后续如要继续排查 4K 退化，应改走「单独某 provider 显式开 HTTP/2」的精准实验，不在全局 buildHttp 默认开启

### 验证

- `php -l` 对两个改动文件均通过，无语法错误
- 本地对比 1.4.6 zip 内 `AbstractAdapter.php` 与当前文件，确认回归点为 1.4.6 → 当前期间新增的 HTTP/2 强制段落

### 升级说明

- **管理后台「在线更新」一键升级即可**。无新数据库迁移、无 composer 依赖变更、无 .env 必需变更

---

## [1.4.7] - 2026-05-16

> **用户管理「查看详情」+ 列表余额可视化**：用户管理列表过去只显示用户名/邮箱/角色等基础字段，要看一个用户的金币/积分余额、订单、套餐、用量、兑换记录都得跨页面手工筛选。本版给用户列表加 `金币` / `积分` 两列直接可视化，并在操作列加「查看」按钮打开统一的用户详情弹窗：上半部展示基本信息 + 钱包 + 所属分组，下半部 4 个 Tab（订单 / 用户套餐 / 用量记录 / 兑换记录）分页展示该用户的关联数据，每个 Tab 顶部「查看完整列表」按钮跳到对应模块并自动带上 `?user_id=X` 筛选。配套把 5 个目标列表页（Orders / UserPlans / Usage / RedeemRecords / Balances）从内存 `useState` 升级为 URL query 双向同步，跳转过来 URL 上的筛选条件即时生效且筛选控件受控可视化。**纯前端改动**，无后端 / DB / 依赖变更，与 1.4.6 完全兼容。

### 新增

- **`frontend/src/hooks/useUrlSyncedParams.ts`**（新增）：通用 URL query ↔ 列表筛选 state 双向同步 Hook
  - 挂载时从 `useSearchParams` 读出参数，与 `defaults` 合并作为初始 state；`numberKeys` 默认含 `page / per_page / user_id / plan_id / code_id / cloud_model_id / group_id`，命中 `/^-?\d+$/` 的会自动 `Number()` 转换，避免 string/number 混用导致 Select value 不匹配
  - `setParams` 用 `setSearchParams(sp, { replace: true })` 写回 URL，避免 history 堆积；值为 `undefined / null / ''` 的键从 URL 移除
  - 初始 `useMemo([])` 仅挂载时计算一次，不再因 URL 反向变化导致 state 重置，防止 set→write URL→re-read URL 回环

- **`frontend/src/components/UserDetailModal.tsx`**（新增）：用户详情弹窗
  - `Modal width=1080 mask={false}`（遵循项目规则「弹窗只加阴影、不要背景遮罩」）
  - 打开时并行调 `userApi.get(id)` 和 `balanceApi.list({ user_id, per_page: 10 })`，余额单独走 `/admin/balances` 避免依赖列表接口的 `with('balances')`
  - 关闭时 `setUser(null) + setBalances([]) + setActiveTab('orders')` 重置，防止下次打开看到旧用户数据
  - 顶部 `Descriptions column={2} bordered`：ID / 状态 / 用户名（copyable）/ 昵称 / 邮箱 / 手机 / 角色 / 灵感大王 / 注册 IP / 注册设备 ID（copyable code）/ 创建时间 / 更新时间 / 备注 / 所属分组（Tag 可点击跳 `/groups`）
  - 中部两张 `Statistic Card`：金币余额 / 积分余额（`precision=4`），每张右侧「管理」按钮调 `goWith('/balances', { balance_type: 'token' | 'credit' })` 精准筛到该用户该类型
  - 底部 `Tabs key={userId}`：4 个 Tab（订单 / 用户套餐 / 用量记录 / 兑换记录）内联子组件 `OrdersTab` / `UserPlansTab` / `UsageTab` / `RedeemTab`，每个 Tab 独立 `useState` 分页（`pageSize=10`），首次激活才发请求（antd Tabs 默认 `forceRender=false` + `destroyInactiveTabPane=false`），切换不重新请求；切换用户时 `key={userId}` 让所有 Tab 子组件重新挂载，`page` 回 1
  - Tab 头部 `TabHeader` 组件：「查看完整列表 →」按钮调 `goWith('/orders' | '/user-plans' | '/usage' | '/redeem-records')`
  - `goWith(path, extra?)` 用 `URLSearchParams` 组装 `?user_id=X[&balance_type=...]`，`navigate()` + `onClose()`

### 修改

- **`frontend/src/pages/Users.tsx`**：
  - 引入 `useCurrencyLabels` + `UserDetailModal`，新增 `viewingId: number | null` state
  - `pickBalance(row, type)`：从 `row.balances[]` 中筛 `balance_type === type` 取 `amount`（`UserController::index` 已 `with('balances')`，无需后端改动）
  - `columns` 在「邮箱」后插入两列：`labels.token` / `labels.credit`，宽 110，`align: 'right'`，金币橙色 `#fa8c16` / 积分紫色 `#722ed1`，加粗 4 位小数
  - 操作列加「查看」按钮（`EyeOutlined`，`type="link"`），点击 `setViewingId(r.id)`；操作列总宽设 320 容纳新按钮
  - JSX 末尾挂 `<UserDetailModal open={viewingId !== null} userId={viewingId} onClose={() => setViewingId(null)} />`

- **`frontend/src/pages/Orders.tsx`**：
  - `useState` → `useUrlSyncedParams<Record<string, any>>({ page: 1, per_page: 50 })`
  - 5 个筛选控件（订单号 / 用户 ID / 套餐 ID / 状态 / 日期区间）全部加 `defaultValue` 或 `value` 受控，跳转过来 URL 上的筛选条件可视化呈现

- **`frontend/src/pages/UserPlans.tsx`**：同上模式，3 个筛选控件（用户 ID / 套餐 ID / 状态）受控

- **`frontend/src/pages/Usage.tsx`**：同上模式，5 个筛选控件（用户 / 模型 / 类型 / 状态 / 日期）受控，`RangePicker value` 用 `dayjs(params.start_date)` 反序列化

- **`frontend/src/pages/RedeemRecords.tsx`**：同上模式，2 个筛选控件（用户 ID / 兑换码 ID）受控

- **`frontend/src/pages/Balances.tsx`**：
  - `useState` → `useUrlSyncedParams`
  - **新增「用户」下拉筛选**（`showSearch + optionFilterProp="label"`）：之前只能按类型筛，user_id 跳过来无法可视化呈现；现在 Select value 受控显示当前筛选用户
  - 类型 Select 也加 value 受控

### 跨页跳转链路（HashRouter）

`navigate('/orders?user_id=5')` → URL `#/orders?user_id=5` → 目标页 `useUrlSyncedParams` 通过 `useSearchParams` 读到 `user_id=5` → numberKeys 白名单匹配 → `Number(5)` → `Select value={5}` 命中 `options.value=5` 显示用户名 → API 透传该 user_id 筛选

### 后端

- **零改动**：`UserController::index` 已 `with('balances')` / `BalanceController::index` 已支持 `user_id` 筛选 / 各列表接口已支持 `user_id` 参数。本次完全复用现有接口能力

### 兼容性

- **与 1.4.6 完全兼容**：纯前端加法 + URL 同步升级，老 URL（无 query）行为与之前一致；新 URL（带 user_id）走筛选；未改动任何接口 / 表 / Model
- **无 migration / composer 依赖 / .env 变更**

### 升级说明

- **管理后台「在线更新」一键升级即可**

---

## [1.4.6] - 2026-05-14

> **共享灵感库浏览页卡片勾选双触发 bug 修复**：1.4.4 引入卡片浮层勾选框时，外层 `<div>` 的 `onClick` 与内部 `<Checkbox>` 的 `onChange` 同时绑定到 `toggleSelect(item.id)`，点击 Checkbox 时两个 handler 串联触发 = toggle 两次互相抵消，看起来像按钮没反应。「全选当前页」走的是另一个独立 `Checkbox`，所以未受影响。**仅前端 1 文件 1 处修改**，无后端 / DB / 依赖变更，与 1.4.5 完全兼容。

### 修复

- **`frontend/src/pages/InspirationHubBrowse.tsx`**：卡片左上角浮层 Checkbox 单击无反应
  - 移除外层 `<div>` 的 `onClick={toggleSelect}` 与 `cursor: 'pointer'`，仅保留 `onClick={e => e.stopPropagation()}`（防止冒泡触发 Card hover 副作用）
  - 单击逻辑完全交给内部 `<Checkbox onChange={() => toggleSelect(item.id)} />`，避免 div onClick + Checkbox onChange 双触发导致 toggle 两次抵消
  - 同步修改封面缺失 (`无封面`) 分支同一段代码（两处共享相同的 div + Checkbox 结构）
  - 根因：React/AntD 中 Checkbox 点击会同时触发自身 onChange + 冒泡到外层 div onClick；之前在 div onClick 里 `e.stopPropagation()` 之前已经先调了 `toggleSelect`，停了的是冒泡，没停同级 onChange 已经执行的 toggleSelect，结果两次 toggle 互相抵消

### 兼容性

- **与 1.4.5 完全兼容**：纯 UI 修复，未改动任何接口 / 数据 / 状态结构

### 升级说明

- **管理后台「在线更新」一键升级即可**。无新数据库迁移、无 composer 依赖变更、无 .env 必需变更

---

## [1.4.5] - 2026-05-14

> **云打包临时产物清理**：补全 `storage/app/cloud-builds/tmp/` 残留文件的可见性与可清理性。该目录由 `ArtifactDownloadService::downloadAndVerify()` 用于流式下载远端 artifact（uuid.bin），下载完成 + sha256 校验通过后由 `CloudBuildPullService::atomicReplaceMany` 搬到 `public/updates/`，正常状态应为空。但当 PHP 进程在 fclose 与搬运之间被强杀（reboot / OOM / kill -9）时会留下孤儿 .bin 文件，1.4.4 之前没有任何 GC 机制和后台入口，运维只能 SSH 上手工清。本版在云打包页面新增「临时产物」管理弹窗：扫描目录 → 区分残留 / 可能正在下载（默认 24h 阈值）→ 一键清理残留 + 单条精确删除。**仅前端 1 文件 + 后端 1 控制器方法 + 路由 2 行**，无数据库迁移、无 composer 依赖变更，与 1.4.4 完全兼容。

### 新增

- **`backend/app/Http/Controllers/CloudBuild/CloudBuildController.php`**：新增两个端点
  - `GET /api/admin/cloud-build/tmp-artifacts?orphan_after_hours=24`：扫描 `storage_path('app/cloud-builds/tmp')` 下的文件，按 mtime 倒序返回 `[{filename, size, mtime, age_sec, is_orphan}]` + 汇总 `total_size / orphan_count / orphan_size / orphan_after_hours`。`is_orphan` 由后端基于 `now - mtime >= threshold` 计算，前端不重算
  - `POST /api/admin/cloud-build/tmp-artifacts/cleanup`：双模式
    - 不传 `filenames`：批量清理所有 mtime 早于 `min_age_hours`（默认 24，body 可覆盖，最大 8760 = 1 年）的 `.bin` 文件
    - 传 `filenames: string[]`：精确清理（白名单 `^[A-Za-z0-9._-]+\.bin$` + `basename` 防 path traversal，每文件独立 try/catch，失败逐条记录到 `failed[]` 不阻断其它）
  - 返回 `{deleted_count, freed_bytes, failed: [{filename, error}]}`，写 `Log::info('cleanupTmpArtifacts done', mode/...)` 留 admin_id 痕

- **`backend/routes/api.php`**：在 `cloud-build` 路由组字面量段（`/{buildId}` 之前）追加两行
  - `Route::get('/tmp-artifacts', ...)`
  - `Route::post('/tmp-artifacts/cleanup', ...)`

- **`frontend/src/services/api.ts`**：`cloudBuildApi` 加 `listTmpArtifacts(orphanAfterHours?)` / `cleanupTmpArtifacts(data?)`，与 `listInstallers` / `cleanupInvalid` 平行

- **`frontend/src/pages/CloudBuild/HistoryPage.tsx`**：云打包记录页加「临时产物」入口
  - 新增 interfaces `TmpArtifact` / `TmpArtifactsResp`
  - 新增 state：`tmpOpen` / `tmpData` / `tmpLoading` / `tmpCleanupLoading`
  - 新增 handlers：`loadTmpArtifacts` / `openTmpArtifacts` / `removeTmpArtifact(filename)`（走 `cleanupTmpArtifacts({filenames: [...]})`） / `cleanupTmpOrphans`（走默认 24h 批量清理）
  - 工具栏「安装包」按钮右侧加「临时产物」按钮（`FileOutlined`）
  - 新增管理 Modal：
    - 顶部 `Alert(info)` 解释来源 + 操作风险（"X 小时以内的文件可能是正在下载，不要轻易删除"）
    - 工具行：`base 路径 / 总占用 / 残留(N 个 / X MB) / 刷新 / 一键清理残留`
    - `Table<TmpArtifact>` 列：文件名 / 大小 / 修改时间 / 存在时长 / 状态（残留橙 vs `下载中?`蓝）/ 删除
    - 「一键清理残留」`Popconfirm` orphan_count=0 时按钮 disabled；description 显示「将删除 N 个残留 .bin 文件，共 X MB」
    - 单条删除时若行非 orphan 在 Popconfirm 多一句风险提示「该文件可能正在下载，删除后正在进行的下载会失败」
  - 新增 `fmtDuration(sec)` 辅助方法（秒 → 秒/分钟/小时/天）

### 兼容性

- **与 1.4.4 完全兼容**：纯加法，未改动任何现有端点 / 表 / model；老版本升级后不需任何手工操作，新「临时产物」按钮即时可用
- **24h 默认阈值保护正在下载的文件**：1.4.3 的 cover mirror 是几百 KB 毫秒级；但云打包 artifact 大文件下载 `download_timeout` 是 600s（10 分钟），即使 24h 也留足并发 / 重试缓冲，几乎不会误判正在下载为孤儿
- **管理员仍可手工删 24h 以内的「下载中?」文件**：Popconfirm 会额外提示风险但不禁用，覆盖「确定知道这个不是正在下载」的运维场景

### 设计要点

1. **目录扫描而非 manifest 文件**：tmp 目录里的文件本身就是 ground truth；如果维护 manifest 反而要处理 manifest 与磁盘不一致的边界（半写崩溃）；直接 `scandir + filemtime` 简单可靠
2. **`is_orphan` 由后端计算并把阈值原样回吐前端**：前端不重算 / 不需要知道默认值，避免阈值漂移；未来想统一调整改一处即可
3. **批量 + 精确两种清理模式**：批量按时间清理覆盖 99% 场景（定期清残留）；精确清理覆盖「想保留某条但删另一条」的特殊场景，靠白名单文件名约束安全性
4. **严格白名单 `^[A-Za-z0-9._-]+\.bin$`**：`ArtifactDownloadService` 写入时用 `Str::uuid() . '.bin'`，正则与之严格对齐，杜绝 path traversal + 防止误删非 .bin 文件（即使将来 tmp 里放了别的东西也碰不到）
5. **Modal `mask={false}` 与「安装包」/「我的信息」一致**：符合项目设计规则「弹窗只加阴影，不要背景遮罩」

### 升级说明

- **管理后台「在线更新」一键升级即可**。本版无新数据库迁移、无 composer 依赖变更、无 .env 必需变更

---

## [1.4.4] - 2026-05-14

> **共享灵感库批量操作 + 卡片溢出修复**：纯前端 2 个文件变更——`InspirationHubBrowse.tsx`（公开池浏览页）支持卡片多选 + 「批量拉到本地」（统一选一个本地分类，依次调单条 `adminPullToLocal`）；`InspirationHubPending.tsx`（待审池）支持 `rowSelection` + 「批量通过」/「批量拒绝」（批量拒绝共用同一条理由）；顺手修复浏览页卡片三个操作按钮带图标后溢出容器边界的视觉 bug。**无后端变更、无数据库迁移、无 composer 依赖变更**，与 1.4.3 完全兼容。

### 修复

- **`frontend/src/pages/InspirationHubBrowse.tsx`**：卡片操作区按钮溢出修复
  - 「详情」「举报」「拉到本地」三个 `<Button size="small">` 移除 `icon` 属性（之前是 `EyeOutlined` / `WarningOutlined` / `CloudDownloadOutlined`），改为纯文字按钮
  - 同步从 `@ant-design/icons` import 中移除上述 3 个图标（保留 `ReloadOutlined` / `SearchOutlined`）
  - 根因：卡片宽度 220px（`gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))'`） - 24px padding 后实际可用 ≈196px，三个带图标按钮 + 8px 间距合计 ≈210px 超出。AntD `Space wrap` 应该 wrap 但实际未生效（推断与 Tooltip 包 Button + Space 自身宽度计算冲突），最简修复是缩按钮宽度

### 新增

- **`frontend/src/pages/InspirationHubBrowse.tsx`**：多选 + 批量拉到本地
  - 新增 state：`selectedIds: Set<number>` / `batchPullOpen: boolean` / `batchPullSubmitting: boolean` / `batchPullForm: FormInstance`
  - 卡片左上角浮层：半透明白底 `<Checkbox>` 叠在 cover 之上（封面缺失时同样位置叠加），`onClick={e => e.stopPropagation()}` 拦冒泡防触发卡片 hover；选中态卡片加 `borderColor: '#1677ff' + boxShadow` 蓝边视觉强化
  - 网格上方新增批量操作条：「全选当前页」(`Checkbox` 三态：unchecked / indeterminate / checked) + 已选计数 + 「批量拉到本地」(primary) + 「清空选择」(仅 size>0 时出现)
  - 新增 `toggleSelect(id)` / `toggleSelectAll()` 辅助方法；`loadItems` 入口 `setSelectedIds(new Set())` 让筛选 / 翻页 / 刷新自动清空选择
  - 新增 `openBatchPullModal()` / `handleBatchPullSubmit()`：前者校验非空 + 重置 form 后弹 Modal；后者循环调 `adminPullToLocal(hubId, { local_category_id })`，每条 try/catch，单条失败不中断整批，结束后按 `successCount` / `skipCount`（already_pulled）/ `failCount` 三类汇总 message
  - 批量拉取 Modal：唯一字段是「统一存放到本地分类」(`Select` 与单条拉取共用 `localCategories`)，confirm 按钮 loading 期间禁止关闭弹窗，提示「单条失败不会中断整批 / 已拉过自动跳过 / 期间请勿关闭」

- **`frontend/src/pages/InspirationHubPending.tsx`**：多选 + 批量通过 / 拒绝
  - 新增 state：`selectedIds: number[]`（Table `rowSelection` 用数组形式与 Ant Design API 对齐）/ `batchSubmitting: boolean` / `batchRejectOpen: boolean` / `batchRejectForm: FormInstance`
  - `Table` 加 `rowSelection={{ selectedRowKeys, onChange, getCheckboxProps }}`：`getCheckboxProps` 对已投票行 (`my_review_action != null`) 返 `disabled: true`，让勾选框置灰，避免管理员误把已投行加入批次
  - 工具栏（刷新按钮右侧）新增 3 个控件：
    - 「批量通过」：包 `Popconfirm` 确认（描述「已投过票的会自动跳过」），`onConfirm = handleBatchApprove` 直接循环 `adminReview(id, {action:'approve'})`
    - 「批量拒绝」：`danger` 按钮，点开 `batchRejectForm` Modal 让管理员填一条统一拒绝理由，Modal `onOk = handleBatchRejectSubmit` 后循环 `adminReview(id, {action:'reject', reason})`
    - 已选计数 + 「清空选择」(仅 size>0 时)
  - 新增 `handleBatchApprove()` / `openBatchRejectModal()` / `handleBatchRejectSubmit()`：所有批量 handler 先 `items.filter(it => selectedIds.includes(it.id) && !it.my_review_action)` 二次过滤跳过已投行（即使 rowSelection getCheckboxProps 拦截过，也防数据竞态），循环中 `already_voted` 错误归入「已投过」桶不算失败
  - 复用现有 `patchVoted(id, action)` 即时反馈：每条投票成功后立即把该行 `my_review_action` + `approve_count` / `reject_count` 写回 state，结束后再 `loadItems` 拿后端真值
  - `loadItems` 入口 `setSelectedIds([])` 让翻页 / 刷新自动清空选择

### 兼容性

- **与 1.4.3 完全兼容**：仅修改前端 2 个 SPA 页面，无后端代码变更、无数据库迁移、无 composer 依赖、无路由 / API schema 改动；老桌面端 / 客户端 API 零影响
- **批量操作走单条 API 循环**：不引入新的批量 hub 接口（agent-admin 也未新增批量端点），降低本次发版风险面；后续如果性能成为瓶颈再考虑后端 / hub 批量端点
- **`already_pulled` / `already_voted` 归入「跳过」**：批量场景下用户预期是「能拉的都拉，能投的都投」，所以不算失败而是单独计数提示，符合直觉

### 设计要点

1. **多选 UI 选 Checkbox 浮层而非整卡点击切换**：卡片本身有 hover effect + 点击操作（详情 / 举报 / 拉到本地），让卡片整体点击=勾选会和现有交互冲突；浮层 Checkbox 视觉上一目了然「这是勾选区」，与卡片其他交互区分明确
2. **批量拒绝共用同一条理由**：批量场景下管理员通常是看到一批同类低质量内容（例如同 spammer 一批刷的），逐条填理由太累；共用理由符合实际工作流，hub 端收到的也是同一条 `reason` 字符串，与单条拒绝一致
3. **`rowSelection.getCheckboxProps` 禁用已投行**：用户视角下「批量通过」对已投通过的行重复操作毫无意义且容易混淆「为什么有些条没生效」；禁用勾选框是最直白的视觉反馈
4. **`loadItems` 清空选择而非 useEffect 监听 items**：单条 / 批量操作中本身会 `setItems(prev => prev.filter(...))` 改 items 数组，如果用 useEffect 监听 items 变化清选择会在批量执行中途意外清空；放在 `loadItems` 入口只在显式 reload（筛选 / 翻页 / 刷新）时清空，符合直觉
5. **批量操作条始终常驻（仅在 items.length > 0 时显示）**：之前考虑过「仅在 selectedIds.size > 0 时展开」的浮层方案，会让「如何开始勾选」对新用户不直观；常驻 + 「全选当前页」入口让批量功能发现性更好

### 升级说明

- **管理后台「在线更新」一键升级即可**。本版无新数据库迁移、无 composer 依赖变更、无 .env 必需变更

---

## [1.4.3] - 2026-05-14

> **共享灵感库拉到本地时图片本地化**：之前从 hub 拉取灵感到本地 `inspirations` 表时，`cover_image` 直接保存源云控端的远程 URL（hub 不转存图片副本，是「URL 引用方案」的设计）。这造成本站灵感对源站可用性的硬绑定——源站删图 / 关停 / 切存储后端 / 签名 URL 过期 / hotlink 防盗链开启，本站封面立刻失效，且每次浏览都会打到源站消耗其流量。本版补上拉取链路上的图片镶像：HTTP GET 远程 cover → size / Content-Type 校验 → 调 `StorageService::putBytes` 落本站存储（local 的 `public/inspirations/` 或腾讯云 COS 自动分流），与本地原生上传走同一份目录与命名规则。镶像失败时容错回退保留原 URL 不阻断拉取主流程。**仅后端 2 个文件变更**，无新数据库迁移、无 composer 依赖变更、无前端变更。**与 1.4.2 完全兼容**。

### 改进

- **`backend/app/Services/StorageService.php`**：新增公开静态方法 `putBytes(bytes, contentType, subdir, filename): ?string`，与 `upload()` 平行的入口，专为「已经在内存里拿到字节流但没有 `UploadedFile` 实例」的场景（远程图镜像、base64 解码、跨域代理等）。内部按 `storage_type` 自动分流到 `putBytesToLocal` / `putBytesToCos`
  - 新增 `private static putBytesToLocal(bytes, subdir, filename)`：`@mkdir + file_put_contents`，返回 `/inspirations/<filename>` 形式相对路径
  - 新增 `private static putBytesToCos(bytes, contentType, subdir, filename)`：复用 V5 签名 + Guzzle PUT，返回 CDN 域名（若配置 `cos_domain`）/ COS 默认域名 URL
  - 重构 `uploadToCos`：内部转调 `putBytesToCos` 消除字节流 PUT 逻辑重复。`uploadToLocal` 保留原 `$file->move()` 不动（性能更优）
  - 公共流量入口 `upload()` / `uploadAbsolute()` / `delete()` 行为完全不变，老调用零影响

- **`backend/app/Http/Controllers/InspirationHubController.php`**：`adminPullToLocal` 增加 cover 镶像逻辑
  - 新增 3 个私有常量：`COVER_SUBDIR = 'inspirations'`（与 `InspirationController::SUBDIR` 一致，本地原生上传 / hub 拉取走同一份存储目录）/ `COVER_MIRROR_MAX_BYTES = 8 * 1024 * 1024`（远程下载上限，略宽于本地上传的 5MB 校验，预留压缩远程原图的余地）/ `COVER_MIRROR_TIMEOUT = 15`（HTTP 超时秒数）
  - 新增 `private mirrorRemoteCover(string $remoteUrl): ?string`：`Http::timeout + allow_redirects` 拉远程图 → 校验状态码 + size → 用 Content-Type 推扩展名（不可识别再从 URL 路径回退，仍不可识别则一律 png，与 `InspirationController::uploadFile` 兜底策略一致）→ 生成 `Str::uuid().<ext>` 文件名 → 调 `StorageService::putBytes` 落本站存储 → 返回新 URL；任一步失败 `Log::warning` 后返 null
  - 新增 `private guessCoverExtFromUrl(string $url): string` 辅助方法：从 URL 路径推扩展名（`jpg/jpeg/png/webp/gif`），不可识别一律 png
  - `adminPullToLocal` 主流程：`Inspiration::create` 之前先 `$localCover = mirrorRemoteCover($remoteCover)`，最终 `cover_image = $localCover ?? $remoteCover`（**镶像失败回退原 URL，不阻断拉取**），失败时打 `Log::warning('cover mirror failed, fell back to remote URL', ...)` 留痕。`Log::info('pulled to local')` 追加 `cover_localized: bool` 字段便于运维统计镶像成功率
  - import 增补：`StorageService` / `Http` 门面 / `Str`

### 兼容性

- **与 1.4.2 完全兼容**：仅修改后端 2 个文件，无数据库迁移、无 composer 依赖、无路由 / API schema 改动；老桌面端 / 灵感广场 / 客户端 API 零影响
- **镶像失败容错**：远程图 404 / 超时 / 大小超限 / Content-Type 异常 / 本站 COS 配置不全等任何环节失败，自动回退到 1.4.2 旧行为（保存源云控端原 URL），拉取主流程不会中断；失败原因写 `laravel.log` warning，运维可按 keyword `mirrorRemoteCover` 检索
- **存储后端切换零感知**：`StorageService::putBytes` 完全复用 `storage_type` 配置；本站从 local 切到 cos 后，新拉取的灵感封面自动落 cos，旧拉取记录保留原值（与本地原生上传策略一致）
- **拉到本地后的灵感与本地原生上传形态一致**：`cover_image` 字段最终值都是 `/inspirations/<uuid>.<ext>`（local）或 `https://cdn.../inspirations/<uuid>.<ext>`（cos），桌面端灵感广场不需要区分来源

### 升级说明

- **管理后台「在线更新」一键升级即可**（与 1.4.2 流程一致）。本版无新数据库迁移、无 composer 依赖变更、无 .env 必需变更
- 升级后历史拉取记录的 `cover_image` 仍保留为远程 URL，**不会自动追溯镶像**；如有需要可手工重新拉取（先按 hub_id 在 admin 侧删本地记录，再走「拉到本地」），或后续单独提供「批量镶像历史已拉灵感」运维命令

### 设计要点

1. **镶像放在拉取时（pull 时点）而非懒触发（首次访问时点）**：拉取是低频 admin 操作，1 次几百 KB 下载毫秒级完成，对响应时间影响极小；如果改为「桌面端首次访问时按需镶像」会引入复杂的状态机（处理中 / 已镶像 / 镶像失败重试）+ 缓存击穿风险，得不偿失
2. **镶像失败回退原 URL 而非中断拉取**：1.4.2 旧行为是「永远引用远程 URL」，从不中断拉取；本版镶像优化失败时回归旧行为，确保**任何场景下拉取都成功**。这是保守的兼容性策略
3. **`StorageService::putBytes` 设计为公开 API 而非 InspirationHub 私有**：`DocImportService::storeImageBytes` 已经在做类似的「远程图下载 → 落 StorageService」事，未来若有更多场景（如灵感分享时的远程图代理 / RSS 抓图等）可以共用 `putBytes`，避免每个场景各自包 `UploadedFile` 工厂。本次先不动 DocImportService（避免影响文档导入），等有进一步需求再统一
4. **`COVER_MIRROR_MAX_BYTES = 8MB` 略宽于本地上传校验的 5MB**：本地上传 5MB 是为了限制管理员 / 桌面端用户上传的图片大小（避免存储滥用）；镶像是从已通过审核的灵感拉取，源站可能存了 6-7MB 的高清原图，本站 5MB 严格校验会让镶像失败率偏高。8MB 是「业内远程原图压缩含量不严格」的合理余地，仍能挡住极端大图
5. **`Log::info('pulled to local')` 增加 `cover_localized` 字段**：运维可定期 `grep "pulled to local"` 看本地化成功率（理想是 ≈ 100%），低于阈值时排查源站可达性 / 本站存储配置 / 防盗链等问题

---

## [1.4.2] - 2026-05-14

> **共享灵感库交互体验优化**：4 个客户反馈的 bug 修复 + 浏览页 stats 信息架构调整 + 举报按钮上线。**仅前端 SPA + 后端 1 处代理层过滤**，无新数据库迁移、无 composer 依赖变更。**与 1.4.1 完全兼容**。

### 变更

- **`frontend/src/pages/InspirationHubPending.tsx`**：待审池字段对齐 + 投票后即时反馈
  - `interface PendingItem.my_vote` → `my_review_action`，与 agent-build hub 后端 `Hub/InspirationHubController::pendingList` 实际返回字段对齐（旧字段名前端读为 `undefined` → 「我已投」永远显示「未投」、「通过」/「拒绝」按钮永远 enabled，是 0.7.0 起的隐藏 bug）
  - 新增 `patchVoted(id, action)`：投票成功后本地立即把本行 `my_review_action` 与 `approve_count` / `reject_count` 写回 state，按钮在网络回来那一帧就 `disabled`，不依赖 reload
  - 按钮文案动态切换：已投通过的「通过」 → 「已通过」（type 由 primary 改为 default），已投拒绝的「拒绝」 → 「已拒绝」（去掉 danger 红框）；视觉上明确"已操作过"
  - `already_voted` 异常分支也兜底 `patchVoted`

- **`frontend/src/pages/InspirationHubBrowse.tsx`**：浏览页过滤 + stats 重构 + 举报功能
  - `loadItems` 传 `exclude_self=1`（hub 后端已支持，屏蔽本站自分享）+ `exclude_pulled=1`（agent-admin 私有参数，触发代理层过滤已拉取）
  - `interface HubInspiration` 删除 hub `/list` 不返回的 `approve_count` / `reject_count` / `status` / `is_visible`（之前 stats 显示 `通过 undefined · 拒绝 undefined` 是隐藏 bug），加 `download_count?` + `reported_by_me?`
  - 卡片 + 详情 Modal stats 从「通过 X · 拒绝 X · 举报 X」改为「热度 X · 举报 X」+ 「已举报」Tag；`report_count > 0` 时举报数变橙色 `#fa8c16` 提示有风险
  - 卡片操作区在「详情」与「拉到本地」之间加「举报」按钮（`WarningOutlined` 图标），已举报时 disable + 文案变「已举报」+ Tooltip 提示「本站已举报过，不可重复」
  - 新增举报 Modal：5 个 `reason_code` 用 `Radio.Group` 单选（`invalid_image` / `inappropriate` / `duplicate` / `copyright` / `other`），默认 `inappropriate`；`reason_note` 选填最多 255 字（与 hub 后端 `Hub/InspirationHubController::report` 验证规则一致）；提交按钮 `danger=true` 明示破坏性
  - 举报提交后本地立即 `patch reported_by_me=true` + `report_count+1`，不重 load 整页（后端达到 `report_threshold` 后 `is_visible=false` 自动下架，下次 reload 自然从公开池消失）
  - `handlePullSubmit` 成功后本地立即从 items 过滤掉该卡，与后端 `exclude_pulled` 代理层过滤配合，让用户感知不到「拉完后还要等下次 reload 才消失」的延迟
  - 「下载 X」措辞改为「热度 X」：避免与「拉到本地」按钮在语义上重叠；`download_count` 字段名保持不变（与 hub 后端协议一致），仅前端展示文案改

- **`backend/app/Http/Controllers/InspirationHubController.php::list()`**：加 `exclude_pulled` 代理层过滤
  - 接收前端 `exclude_pulled=1` 参数（向 hub 转发前 `unset` 避免污染 hub 入参），forward hub `/list` 后反查本地 `Inspiration::whereIn('from_hub_inspiration_id', $hubIds)`，把已拉过的 hub_id 用 `array_filter` 从 items 数组里剔除
  - hub 端不持久化「哪些 client 拉过哪些 shared_id」（hub 设计简洁性原则），必须在云控端代理层做。云控端 `inspirations.from_hub_inspiration_id` 字段是已拉记录的天然反向索引
  - **注意 total 不扣减**：hub 返回原始总数，翻页时实际可见数会比 total 略少；重新计算需拿全量列表，开销 N 倍不值得

- **`frontend/src/pages/Inspirations.tsx`**：灵感列表载入后 silent 同步 hub 状态
  - 新增 `silentSyncHubStatus(rows)`：fire-and-forget 调 `inspirationHubApi.statusBatch`，只同步本页 `hub_shared_id != null && hub_status ∈ {null, 'pending'}` 的项（成本低）
  - 拿到结果后用 `setItems(prev => prev.map(...))` 局部 patch 受影响行的 `hub_status` / `hub_status_synced_at`，**不重 load 整页**（避免 setItems → useEffect → loadItems → silent → setItems 循环）
  - `loadItems` 在 `setItems(data)` 之后 `if (hubReady) silentSyncHubStatus(data)`；失败时静默吞错（管理员可手动点「同步 Hub 状态」按钮兜底）
  - **解决**「投票通过后管理员需等最多 5 分钟才看到 Hub 通过」的体验问题。schedule 任务 `inspiration-hub:sync-status` 仍每 5 分钟跑一次作为兜底（`Console/Kernel.php:29-32` 不变）

### 兼容性

- **与 1.4.1 完全兼容**：仅修改前端 UI 与后端 1 个代理控制器方法，无数据库 / 路由 / API schema 改动
- **与 agent-build 0.7.0+ 协议向后兼容**：`exclude_pulled` 是 agent-admin 私有参数，向 hub 转发前 `unset`；hub 端 `my_review_action` 字段早在 0.7.0 就已返回，1.4.1 前端读 `my_vote` 是已有 bug 终于修了
- **与 1.3.x 老桌面端兼容**：本版本只动管理后台 SPA 与本地代理控制器，不影响桌面端 / 灵感广场 / 客户端 API

### 升级说明

- **管理后台「在线更新」一键升级即可**（与 1.4.1 流程一致）。本版无新数据库迁移、无 composer 依赖变更、无 .env 必需变更
- 升级完成后建议刷新管理后台 SPA 一次（Ctrl+Shift+R），让浏览器拿到新 JS bundle

### 设计要点

1. **字段名对齐 vs 加别名**：选直接改前端字段名（而非在 hub 后端加 `my_vote` 别名）。理由：(a) hub `pendingList` 与 `show` 都返回 `my_review_action`，云控端再加别名会让两端不对称、增加心智负担；(b) 前端只一处用，改名成本极低
2. **投票后本地 patch vs reload**：`patchVoted` 比 `loadItems()` 更快更稳。reload 慢一拍且可能受其他错误干扰；patch 是「乐观更新」，配合后续 reload 兜底覆盖错误时本地状态自然修正
3. **`exclude_pulled` 在云控端代理层做**：hub 不持久化"client 拉过哪些"（hub 端设计简洁性原则），云控端用本地 `inspirations.from_hub_inspiration_id` 反查更合适。每次 list 多 1 次本地 `SELECT IN` 查询，开销远小于节省的"已拉灵感重复展示再重复点拉到本地报 already_pulled" 的网络往返
4. **silent sync fire-and-forget**：不阻塞 loadItems 的 loading 体验。如果 silent sync 改为 await 阻塞 loadItems，hub 慢时会让整个页面 loading 也慢，得不偿失。失败静默吞错（schedule 5 分钟内必兜底）
5. **浏览页 stats 改为「热度 / 举报」**：原 stats `approve_count` / `reject_count` 在 hub `/list` 接口实际不返回（公开池只暴露已 approved 灵感，approve/reject 数对浏览者无意义），显示 undefined 是隐藏 bug。新 stats 选「热度（即 `download_count`）+ 举报」是社区健康度的有用信号；「热度」措辞避免与「拉到本地」按钮在用户视角下的语义重叠
6. **举报 Modal `Radio.Group` vs `Select`**：5 个选项数量少，Radio 一眼可见所有选项 + 一次点击确认，体验比 Select 更好；选项多时（>= 7）才考虑 Select

---

## [1.4.1] - 2026-05-14

> **共享灵感库配置简化**：1.4.0 引入共享灵感库时让管理员在「系统设置 → 共享灵感库」手工填写 endpoint / origin / enabled 三件套；本版起这三者全部自动推导（endpoint 复用云打包配置 `cloudbuild.agent_build.base_url`、origin 与 `AgentBuildClient` 一致从请求 host 推导并强制 https、共享库视为永久启用），管理员零配置即可使用。**非 breaking、无数据库迁移、无 composer 依赖变更**。

### 改进

- **`backend/app/Services/InspirationHub/InspirationHubClient.php`**：删除 `isEnabled()`；`endpoint()` 改读 `config('cloudbuild.agent_build.base_url')`；`origin()` 改为与 `AgentBuildClient` 一致的 host 推导（runtime host > 显式 config > `APP_URL`，出口强制 https，避开反代下 `request()->isSecure()` 误判导致的域名校验失败）；`isReady()` 只看 endpoint 非空；`healthCheck()` 去掉 `disabled` 分支
- **`backend/app/Http/Controllers/InspirationHubController.php`**：`adminGetSettings()` 改为只读返回自动推导值，`enabled` 硬编码 true；`me()` 中 `enabled` 同样硬编码 true；`notReadyReason()` 去掉 `disabled` 分支
- **`frontend/src/pages/Settings.tsx`**：`SettingValues` 删除 3 个 hub 字段；移除 `hubEnabled = Form.useWatch(...)`；新增 `hubSettings` state + 独立 `useEffect` 调 `adminGetSettings` 一次拉取展示值；「共享灵感库」Tab 的 Card 内容从 3 个 Form.Item 改为只读卡片（端点 / Origin / 状态 Tag）+ 健康检查按钮
- **`frontend/src/pages/InspirationHubBrowse.tsx`**：未就绪兜底文案从「未配置」改为「暂不可用」，去掉 `disabled` 分支，主推「本站 Origin 未授权」场景

### 移除

- **`backend/routes/api.php`**：删除 `PUT /admin/inspiration-hub/settings` 路由
- **`backend/app/Http/Controllers/InspirationHubController.php`**：删除 `adminUpdateSettings()` 方法
- **`frontend/src/services/api.ts`**：删除 `inspirationHubApi.adminUpdateSettings`

### 兼容性

- **保留 SystemSetting 字段定义**：`inspiration_hub_enabled` / `inspiration_hub_endpoint` / `inspiration_hub_origin` 三个 KV 配置项的 cast 定义不删（与 Migration 铁律对齐：已发布的 schema 不修改、不删除），代码彻底不读不写；老 row 留在 DB 无害
- **老站点升级零配置**：原先手工填写的 endpoint / origin 不再生效，全部回退到云打包配置 + 自动 host 推导。99% 站点云打包用的就是 `your-build-domain.example.com` 默认地址，升级即直接可用，**无需任何手工配置**
- **自建 hub 场景**：如果原先填的 endpoint 指向非 agent-build 官方地址，必须改在服务器 `.env` 配置 `AGENT_BUILD_BASE_URL=<your-hub-url>`（此变更与云打包共享同一上游地址）

### 设计要点

1. **为什么不再支持独立的 hub endpoint**：hub 本质是 agent-build 的一个子能力（`/api/inspiration-hub/*` 与 `/api/build/*` 共用 `domain_binding` 中间件），独立配置三件套等于让管理员理解「两套 endpoint」与「两个 Origin 授权位置」，运维心智成本高且容易出错。复用云打包配置后变成「云打包能用 = hub 也能用」，运维体验对齐
2. **为什么 `enabled` 直接硬编码 true 而不是看某个开关**：「开关」本质是怕配置错误时整个站点崩；现在 endpoint 来自有默认值的云打包配置（默认 `your-build-domain.example.com`）、origin 自动推导（默认有当前站点域名），不存在「配置错误导致崩」的场景，开关失去意义
3. **`adminGetSettings` 保留**：前端「系统设置 → 共享灵感库」Tab 仍需展示「当前 endpoint / Origin 是什么」「是否就绪」「健康检查能否通过」，所以接口保留为只读

---

## [1.4.0] - 2026-05-14

> **灵感共享中心接入**：本地灵感广场对接 agent-build 维护的「共享灵感库」。任意已授权云控端的「灵感大王」可把本地灵感一键分享到共享库，分享后由全网评审员投票审核；通过的灵感会出现在「共享灵感库浏览」里，本站点管理员可一键拉回本地。新增 `inspirations` 表 5 个共享 hub 字段、`InspirationHubController` 客户端+管理双层端点、`InspirationHubClient` 服务封装对 agent-build 的 HTTP 调用（带 Origin 头 + 错误兜底）、`SyncHubStatus` 计划任务（每 5 分钟批量同步本地分享状态）。设置页新增「灵感共享中心」Tab（开关、Endpoint、Origin、健康检查）；后台菜单新增「共享灵感库浏览」「评审待办」两个入口。**非 breaking、老站点升级零配置**（默认未启用共享 hub，开启需手工填 Endpoint + 启 Origin 校验）。

### 新增

- **`backend/database/migrations/2026_06_26_000003_add_hub_columns_to_inspirations_table.php`**：`inspirations` 表追加 5 字段 + 3 索引。`hub_shared_id`（UNIQUE，本地灵感分享到 hub 后保存的远端 ID）、`hub_status` enum(pending/approved/rejected)、`hub_status_synced_at`（上次对账时间）、`from_hub_inspiration_id`（UNIQUE，从 hub 拉来时的源 ID，防重复拉入）、`from_hub_source_site_name`（来源站点名快照）；索引 `(hub_status, hub_status_synced_at)` 供 `SyncHubStatus` 批量过滤
- **`backend/app/Http/Controllers/InspirationHubController.php`**（约 485 行）：client + admin 双层端点。client 层 8 个：`shareToHub` / `withdrawFromHub`（本地灵感⇄hub）、`me` / `categories` / `list` / `statusBatch` / `show` / `report`（浏览共享库）；admin 层 6 个：`adminGetSettings` / `adminUpdateSettings`（设置）、`adminHealthCheck`（连通性自检）、`adminPendingList` / `adminReview`（评审员视角）、`adminPullToLocal`（一键拉回本地）。统一通过 `InspirationHubClient` 与 agent-build 通信
- **`backend/app/Services/InspirationHub/InspirationHubClient.php`**（约 169 行）：封装 HTTP 调用，自动注入 `Origin` 头（来自系统设置 `inspiration_hub.origin`），统一超时、JSON 解析、HTTP 错误转 Exception；所有方法都返回数组或抛出（不直接返 Http 响应对象）
- **`backend/app/Console/Commands/SyncHubStatus.php`**（约 142 行）：每 5 分钟批量同步本地分享状态。`POST /api/inspiration-hub/status-batch` 一次最多 100 条；返回的 status 与本地不一致时更新 `hub_status`，所有本批次行更新 `hub_status_synced_at`；含错误隔离（单次失败只 log warning 不中断）
- **`backend/app/Console/Kernel.php`** 注册 `inspiration-hub:sync-status`：`everyFiveMinutes()->withoutOverlapping()`，避免 5 分钟内任务未跑完时重叠跑
- **`backend/app/Models/SystemSetting.php`**：新增 5 个共享 hub 配置 key 默认值（`inspiration_hub.enabled` / `endpoint` / `origin` / `auto_sync_enabled` / `default_visibility`）
- **`frontend/src/services/api.ts`**：新增 `inspirationHubApi` 对象（client 6 个方法 + admin 8 个方法），统一 API 入口
- **`frontend/src/pages/InspirationHubBrowse.tsx`**（约 222 行）：共享灵感库浏览页。筛选（分类 / 关键词 / 已通过/待审 Tab）+ 网格展示 + 详情 Modal + 「拉回本地」Modal（选择本地分类 + 是否可见）
- **`frontend/src/pages/InspirationHubPending.tsx`**（约 260 行）：评审待办页（仅 hub_reviewer=1 的云控端可见入口）。卡片式列表 + approve/reject 一键投票（reject 需填原因 ≤255 字）
- **`frontend/src/pages/Settings.tsx`**：新增「灵感共享中心」Tab。开关、Endpoint（HTTPS 域名）、Origin（本站站点标识，用于 agent-build VerifyDomainBinding 校验）、自动同步开关、默认可见性，含「健康检查」按钮（POST `inspiration-hub/health-check` 探测连通性 + 鉴权 + 站点已授权状态，返回 detail 文案，UI 用 success/warning/error Alert 展示）
- **`frontend/src/pages/Inspirations.tsx`**：列表新增「共享库状态」列（小角标：未分享 / 待审 / 已通过 / 已驳回），行操作加「分享到共享库」/「撤回」按钮，顶部加「同步状态」按钮（批量调 `status-batch`）。分享 Modal 含分类选择（自动预选与本地分类同名的远端分类，stale closure bug 已修复）
- **`frontend/src/layouts/AdminLayout.tsx`**：桌面端组新增「共享灵感库浏览」「评审待办」两个菜单项

### 改进

- **`backend/app/Models/Inspiration.php`**：`$fillable` 与 `$casts` 同步追加 5 个共享 hub 字段，`hub_status_synced_at` cast 为 datetime；新增 `isShared` / `isFromHub` 等 helper 方法

### 设计要点

1. **为什么把 hub 状态字段加在 `inspirations` 表，而不是单独建 `hub_shared` 表**：本地灵感「最多分享一次」是 1-to-(0|1) 关系，单独表会让查询多一次 JOIN；UNIQUE(hub_shared_id) 在主表层就能强制语义。同理 `from_hub_inspiration_id` 直接挂主表，本地灵感库列表查询不用拉关联表
2. **为什么 `SyncHubStatus` 5 分钟一次、不是 wake 推送**：本端「同步」只关心已分享出去的本地灵感在 hub 的审核结果（pending→approved/rejected），对实时性不敏感（评审员投票后用户在本地灵感库列表看到状态更新延迟最多 5 分钟可接受）。wake 推送链路反过来（agent-build → 多个云控端）需要每个云控端登记 webhook URL、agent-build 维护订阅表、签名验证、失败重试，工程量数倍于 cron poll；5 分钟轮询的 RPS 也很低（一个云控端单批 100 条 = 1 次 HTTP/5min）
3. **为什么 `SyncHubStatus` 用 `withoutOverlapping()`**：避免 agent-build 长尾延迟时（如对端慢响应 6 分钟）下一个 5 分钟槽位的任务跟当前任务并发跑导致 status_synced_at 互相覆盖。`withoutOverlapping` 默认锁 24 小时足够（任务超时机制兜底）
4. **为什么 `cleanseImageBody` 风格在本版本未引入 hub API**：hub 端点的 payload 字段都是后端定义的小集合（client 层 ≤ 8 字段、admin 层 ≤ 6 字段），全部由 Validator 严校验，不存在桌面端透传未知字段的风险；`InspirationHubClient` 直接发原 payload 即可
5. **健康检查的 3 段语义**：(a) HTTP 200 + `authorized=true` → 站点已在 agent-build 配为 authorized_client 且通过域名校验；(b) 200 + `authorized=false` → 连通但未授权（需联系 agent-build 管理员加白名单）；(c) 非 200 / 网络错误 → endpoint 配错或对端不在线。三段分别用 success / warning / error Alert 展示
6. **从 hub「拉回本地」的语义**：相当于把远端灵感的 `cover_image` / `prompt_cn` / `prompt_en` / `title` 等字段当作模板，在本地 inspirations 表新建一条 row（带 `from_hub_inspiration_id` 关联）。本地分类需用户重新选（hub 分类与本地分类是两套独立的字典）。UNIQUE(from_hub_inspiration_id) 防止同一条 hub 灵感被本站点重复拉入
7. **`adminPendingList` 端点 + `adminReview` 端点的鉴权**：本端只是把请求转发到 agent-build 的 `inspiration-hub/pending-list` / `{id}/review`；agent-build 端的 `HubReviewerOnly` 中间件按 `authorized_clients.is_hub_reviewer=1` 鉴权。本端不需要做二次鉴权（前端入口已隐藏，但即使绕过前端调本接口，agent-build 也会 403）

### 说明

- **改动文件**（约 18 个）：
  - `backend/config/version.php`：1.3.15 → 1.4.0
  - `backend/database/migrations/2026_06_26_000003_add_hub_columns_to_inspirations_table.php`：**新建**
  - `backend/app/Models/Inspiration.php`：fillable / casts / helpers
  - `backend/app/Models/SystemSetting.php`：5 个 hub 配置 key
  - `backend/app/Http/Controllers/InspirationHubController.php`：**新建**
  - `backend/app/Services/InspirationHub/InspirationHubClient.php`：**新建**
  - `backend/app/Console/Commands/SyncHubStatus.php`：**新建**
  - `backend/app/Console/Kernel.php`：注册计划任务
  - `backend/routes/api.php`：注册 client + admin 路由
  - `frontend/src/services/api.ts`：`inspirationHubApi` 对象
  - `frontend/src/pages/Settings.tsx`：「灵感共享中心」Tab
  - `frontend/src/pages/Inspirations.tsx`：共享状态列 + 分享/撤回/同步
  - `frontend/src/pages/InspirationHubBrowse.tsx`：**新建**
  - `frontend/src/pages/InspirationHubPending.tsx`：**新建**
  - `frontend/src/App.tsx`：注册 2 个新路由
  - `frontend/src/layouts/AdminLayout.tsx`：菜单 2 项 + path→group 映射
- **schema 变更**：
  - `inspirations` 表加 5 字段 + 3 索引（migration 2026_06_26_000003），老数据 NULL 兼容；从未启用过 hub 的旧站点字段全空、行为零变化
- **无 composer 依赖变更**：纯应用层代码，autoload 通过 dump-autoload 刷新即可
- **配套 agent-build 0.7.0**：1.4.0 的所有 hub 端点都对接 agent-build 0.7.0 的 `inspiration-hub` API；如果 agent-build 仍是 0.6.1 及以下版本不存在 hub 接口，本站点开启 hub 后健康检查会显示 404（warning），点「分享」按钮会失败但不影响其他功能。建议两端配对升级

---

## [1.3.15] - 2026-05-13

> **图像生成全链路打磨**：覆盖超时统一、失败重试、异步任务可靠性。前置背景：1.3.14 之前生图链路有 4 类老问题——`CONSISTENCY` 死代码字段贯穿桌面端 5 个文件、`use_new_adapter` 双链路（老硬编码 Http::withToken + DuoMi 旁路 vs 新 Adapter 体系），`image_tasks` 缺索引导致「待处理任务列表」全表扫，`app()->terminating + Artisan::call` 伪异步路径受 PHP-FPM `max_execution_time` 限制（宝塔默认 300s）频繁掐死多米 4K 长任务。本版**统一全链路超时为 15 分钟**、给 Adapter 加内联重试覆盖瞬时网络抖动、把图像任务从 Artisan Command 迁移到 Laravel Job，同时**保留 sync driver 兼容老部署零配置升级**，新增可选 worker 模式享受 retry + failed_jobs 可观测。**非 breaking**，老用户升级零配置、行为无变化；想要高可用切 `.env QUEUE_CONNECTION=database` 即可 opt-in。

### 修复

- **`config/queue.php` `retry_after` < `Job::$timeout` 导致 worker 模式下任务重复执行（**潜在重复扣费 bug**）**：之前 `retry_after=300` 比 `Job::$timeout=360` 还小（首版规划值），正常长任务（多米 4K 异步轮询）跑到 300s 还未结束时，Queue 会误判 worker 崩溃 → 另一 worker 抢走再次执行 → **重复打上游 + 重复扣费**。修复：`retry_after=1020s`，保证 `retry_after(1020) > Job::$timeout(960) > image timeout(900)` 的不变量
- **`OpenAICompatibleAdapter::image` 内联重试双倍 timeout 撞 `Job::$timeout`**：固定 timeout 模式下两次 attempt 最差总耗时 = 900s × 2 = 1801s，会被 `Job::$timeout=960s` 强切。修复为**共享 deadline 模式**：两次 attempt 共享同一份 totalTimeout(900s) budget，第一次撞 timeout 后 budget≈0 自动跳过 retry，保证总耗时 ≤900s
- **`app()->terminating + Artisan::call('image:process')` 受 PHP-FPM `max_execution_time` 限制（宝塔默认 300s）掐死多米 4K 长任务**：之前 sync driver 路径下 PHP-FPM 进程跑到 300s 被强制中断，`image_tasks` 卡在 `processing` 状态永不翻 status，用户在桌面端看到「生成中」转圈不出图也不报错。修复：`GatewayController::handleImage` 的 terminating callback 入口 + `Job::handle` 开头都加 `@set_time_limit(0)` 兜底
- **`OpenAICompatibleAdapter::image` 部分 OpenAI 兼容服务 WAF 误拦请求返回 HTML 400**：之前 `GatewayController` 仅剥 `_token / cloud_model_id` 两个字段，前端调试残留字段 + 网关私有字段（如 `cloud_model_id`、未来可能新增字段）裸传给上游会被部分 WAF 严格校验拦截。修复：`image()` 加 `cleanseImageBody`，按 OpenAI 官方协议字段严格白名单（含厂商扩展字段 seed / guidance_scale / negative_prompt 等共 ~20 个），不在白名单的字段一律剥除

### 新增

- **可选启用真 Laravel Queue + worker**：`.env` 显式设 `QUEUE_CONNECTION=database` 后，图像任务从 `terminating callback` 切到真异步 Queue —— 享受 `$tries=2` 失败重试 + 30s backoff + 凭证池切换 + `failed_jobs` 表可观测 + `queue:retry {uuid}` 手动重跑。需配套长驻 worker `php artisan queue:work database --queue=image,default --tries=2 --timeout=960 --sleep=2`（建议 supervisor / NSSM / systemd 守护）。**老部署不改 .env 不启 worker → 自动走 terminating 兼容路径，行为完全等同 1.3.14**
- **`backend/config/queue.php`**（新建）：Laravel Queue 配置，default driver `sync`（不破坏老部署），同时定义 database / redis 两个 connection，`retry_after=1020s`
- **`backend/app/Jobs/ProcessImageTaskJob.php`**（新建）：业务逻辑从 `ProcessImageTask` Command 整体迁移；`ShouldQueue` + `$tries=2` + `$timeout=960` + `backoff()=30s` + 幂等保护（已 completed/failed 不重跑）+ `failed()` 兜底（permanent fail 时翻 task status）+ `@set_time_limit(0)`
- **`migration 2026_06_26_000002_create_jobs_table`**：Laravel Queue 内置 `jobs` + `failed_jobs` 表 schema（`Schema::hasTable` 幂等判断，已存在不重建）。sync driver 下不会写入这两张表，但提前建表方便用户随时切到 database driver 而不用补 migration

### 变更

- **图像生成单次超时统一 15min**：之前 `gateway.timeouts.image=300s` 偏紧，4K / 多米异步轮询场景实际耗时常超 5min 被截断。改为 `gateway.timeouts.image=900s`（env `GATEWAY_TIMEOUT_IMAGE` 可覆盖）。配套不变量：`retry_after(1020s) > Job::$timeout(960s) > image timeout(900s)`，全链路对齐
- **`OpenAICompatibleAdapter::image` 加内联 1 次重试**：429 / 500-504 / 524 / `ConnectionException` 触发，500ms 短退避；4xx 业务错误（鉴权 / 余额 / 违规）直接抛出不重试。共享 deadline 保证两次 attempt 总耗时 ≤ image timeout
- **`DuoMiAdapter::image` submit 加内联 1 次重试**：通过 `submitWithRetry` 包装器，curl 错误 / HTTP 429 / 500-504 / 524 触发；多米 submit 偶发 502 在桌面端有 `fetchWithRetry` 覆盖，云控端这次补齐对齐行为
- **`ProcessImageTask` Command 改造为 dispatch shim**：业务逻辑全部迁移到 Job，Command 保留作调试入口：`php artisan image:process {taskId}`（dispatch 到队列）/ `--sync` 选项（当前进程同步跑 Job::handle，看完整堆栈，排查问题用）
- **`GatewayController::handleImage` 自适应 driver**：检测 `config('queue.default', 'sync')`，sync 走 `app()->terminating + (new Job)->handle` / database / redis 走 `ProcessImageTaskJob::dispatch`
- **`migration 2026_06_26_000001_add_status_created_at_index_to_image_tasks`**：`image_tasks` 加复合索引 `(status, created_at)`，加速「待处理任务轮询」和「按时间分页查询」（之前全表扫，单表 >10w 行时明显慢）
- **删除 `config/gateway.php` 的 `use_new_adapter` 开关**：老链路（GatewayController 内的硬编码 `Http::withToken` + DuoMi 旁路）整段下线，统一走 `NewGatewayService`。Adapter 体系（1.3.9 引入）稳定运行 1 个月，老链路已无回退价值；保留双链路只会让排障时多一份混淆
- **`GatewayController::chatCompletions / embeddings` 统一走 `NewGatewayService`**：之前根据 `use_new_adapter` 开关分支，老分支删除后简化为单一路径
- **`backend/.env.example`** 加 `QUEUE_CONNECTION=sync` 默认行 + 注释说明 opt-in 切 database 的完整命令

### 设计要点

1. **为什么 sync 默认而不是 database 默认**：1.3.14 之前所有客户都跑 `app()->terminating + Artisan::call` 伪异步路径，从未跑 worker。如果升级默认 driver 改为 database，老客户不改 `.env` 不启 worker → `dispatch` 进 `jobs` 表没人拉 → 图像任务永远 pending（破坏性升级）。改为 sync 默认 + `GatewayController` 检测 driver 自适应：sync 走 terminating（等同老行为）/ database 走 dispatch。**老部署升级零配置即可用，想要高可用主动 opt-in**
2. **为什么 `retry_after(1020) > Job::$timeout(960) > image timeout(900)`**：这是 Laravel Queue 防重复执行的铁律 —— `retry_after` 是「任务被取走后多久没释放视为崩溃，让另一 worker 抢走」，必须严格大于 `Job::$timeout`（任务自身最长执行时长）。首版 `retry_after=300 < Job::$timeout=360` 配置在切到 database driver 后会导致正常长任务被另一 worker 抢走重跑（真重复扣费 bug）
3. **为什么 OpenAI Adapter 重试用共享 deadline 而不是各自独立 timeout**：固定 timeout 模式下两次 attempt 最差总耗时 = 900s × 2 = 1801s，撞 `Job::$timeout=960s` 上限；共享 deadline 保证总耗时 ≤ 900s，第一次撞 timeout 后第二次自动放弃（budget≈0），第一次 500ms 内快速失败时第二次还有 ~899.5s 可用
4. **为什么 Adapter 加内联重试 + Job 也保持 `$tries=2`**：双层防御。Adapter 层 500ms 短退避覆盖**瞬时网络抖动**（占失败的 80%+，大多数 500ms 内能恢复），不让用户等到 Job 层 30s backoff；Adapter 都救不回的持久故障 → Job 层 30s backoff 后再重试（**关键**：`GatewayRouter::route` 会重新选凭证池里的另一个 key，覆盖单个 key 失效场景）
5. **为什么不在 sync driver 下也用 `dispatch`**：sync driver 的 `dispatch` 会立即在当前 PHP-FPM 进程同步跑 `handle()`，**阻塞 HTTP 响应**直到任务完成（用户得等 30s+ 才收到 `task_id`，体验比 1.3.14 还差）。`terminating` 包装让 `handle()` 在 HTTP 响应发送后跑，行为等同老 `Artisan::call`，零体验回退
6. **migration 时间戳为什么用 2026_06_26 而不是 2026_05_12**：Laravel migrate 按文件名字典序执行，新增 migration 时间戳应严格大于已发布最新（2026_06_25_000005）以避免顺序歧义。已发布的 migration 永远不修改文件名（遵守项目「Migration 铁律」）
7. **图像下载 retries=1 而不是 retries=2**：图片 URL 通常时效短（多米 ~15min），多次重试反而拖延错误反馈（URL 失效就是 410/403，重试也是 410/403）。1 次重试足够覆盖偶发网络抖动；URL 失效（403/410/404）直接抛错让用户重新生成

### 桌面端配套（收 0.6.5）

> 本版云控端改动配套桌面端的 image-generation 全链路优化。桌面端 `package.json` 仍是 `0.6.4`，下次桌面端发版时归入 `0.6.5`。云控端 1.3.15 + 桌面端 0.6.4 已可正常工作，升 0.6.5 后超时档位自然对齐云控端 15min。

- **`agent-desktop/src/main/services/image-generation.ts`**：
  - `getImageApiTimeout` 之前按 `tierId` 分档（1k=300s / 2k=540s / 4k=900s），现**全档位统一 900s（15min）**。`tierId` 参数保留兼容签名；注释更新为「单次 15min timeout」
  - `pollAsyncTask` 默认 `maxWaitMs` 300s → 900s（与单次生图 timeout 同档；多米异步轮询整个生命周期）
  - `downloadImageToFile` 从 `fetchWithTimeout(120s, 无重试)` 改为 `fetchWithRetry(180s, retries=1)`：3 分钟覆盖 4K / 多张大文件场景，1 次重试覆盖偶发网络抖动
- **`CONSISTENCY`（多图一致性）所有引用清理**：`shared/image-size.ts` 删字段 / `renderer/src/stores/image-gen-form.ts` 删 state / `renderer/src/stores/image-gen.ts` 删 store / `renderer/src/views/image-gen/ImageGenView.vue` 删 UI / `main/services/image-generation.ts` 删 sig 字段。这些字段早就是死代码（参考实现层根本没用），UI 滑块也没真正生效
- **并发控制收敛为单层 global semaphore**：
  - 删除 `GenerateOptions.concurrency` / `GenerateImageOptions.concurrency` 字段
  - `ImageGenView` / `ImageEditView` 删并发数滑块（之前是 UI 噪音，全局 6 槽位 semaphore + worker pool 自动 = batchCount 已足够）
  - main 进程 worker pool 固定为 `Math.min(10, batchCount)`，全局 semaphore `MAX_CONCURRENT_API_CALLS=6` 兜底防服务商单账号 429

### 说明

- **改动文件**（约 14 个）：
  - `backend/config/version.php`：1.3.14 → 1.3.15
  - `backend/config/queue.php`：**新建**，Laravel Queue 配置（default=sync，database/redis driver `retry_after=1020`）
  - `backend/config/gateway.php`：`timeouts.image` 300 → 900
  - `backend/app/Jobs/ProcessImageTaskJob.php`：**新建**，业务逻辑迁移自 Command，含幂等保护 + `Cache::pull` body fallback + `failed()` 兜底 + `@set_time_limit(0)`
  - `backend/app/Console/Commands/ProcessImageTask.php`：从核心业务实现改为 dispatch / `--sync` 调试 shim
  - `backend/app/Http/Controllers/GatewayController.php`：`handleImage` 自适应 driver；删除 `chatCompletions` / `embeddings` 的 `use_new_adapter` 分支；terminating callback 加 `@set_time_limit(0)`
  - `backend/app/Services/Gateway/Adapters/OpenAICompatibleAdapter.php`：`image()` 加内联重试（共享 deadline）+ `isRetriableImageStatus` + `cleanseImageBody` 白名单
  - `backend/app/Services/Gateway/Adapters/DuoMiAdapter.php`：submit 走 `submitWithRetry` 包装器；config fallback 300 → 900
  - `backend/app/Services/Gateway/GatewayRouter.php` / `NewGatewayService.php` / `Adapters/ProviderAdapter.php`：注释与命名引用同步（`ProcessImageTask` → `ProcessImageTaskJob`）
  - `backend/database/migrations/2026_06_26_000001_add_status_created_at_index_to_image_tasks.php`：**新建**，`image_tasks` 加 `(status, created_at)` 复合索引
  - `backend/database/migrations/2026_06_26_000002_create_jobs_table.php`：**新建**，Laravel `jobs` / `failed_jobs` 表
  - `backend/.env.example`：加 `QUEUE_CONNECTION=sync` 默认值 + 注释说明 opt-in 切 database 的方式
- **schema 变更**：
  - `image_tasks` 加复合索引 `(status, created_at)`（migration 2026_06_26_000001）
  - 新建 `jobs` / `failed_jobs` 表（migration 2026_06_26_000002，sync driver 下不会用到但提前建表方便 opt-in）
- **依赖变更**：无 composer 变更，无 npm 变更
- **回归风险**：低
  - 默认 `QUEUE_CONNECTION=sync`：老部署升级零配置，`terminating` callback 调 `Job::handle` 等同于旧 `Artisan::call('image:process')`，业务逻辑 1:1 迁移（含计费 / 扣款 / `UsageRecord` / `Cache` 写入完全一致）
  - 切到 database driver 是 opt-in 行为，需用户主动改 `.env` + 启 worker，不会被升级流程自动触发
  - `cleanseImageBody` 白名单已覆盖 OpenAI 官方 + 主流厂商扩展共 ~20 字段，调研未发现裸传字段需求
  - migration 0001 仅加索引（不动数据，重跑无副作用）；migration 0002 用 `Schema::hasTable` 幂等判断，已存在不重建
- **升级路径**：1.3.10 ~ 1.3.14 都可一键升级到 1.3.15
- **如何验证**：
  1. 升级后 admin 后台「云端服务商 → 多米 / OpenAI」点「基础测试」/「深度测试」通过
  2. 桌面端选模型 + 输入 prompt + 「生成」→ 任务能完整跑完 ≤15min 内出图（4K 场景之前 5min 边界容易撞 timeout）
  3. 故意切到一个无效凭证 → 生图很快失败，错误信息含具体 HTTP 状态码
  4. opt-in 真 Queue：`.env` 加 `QUEUE_CONNECTION=database` + 跑 `php artisan migrate` + 启 worker `php artisan queue:work database --queue=image,default --tries=2 --timeout=960 --sleep=2` → 生图任务被 worker 拉取，`jobs` 表实时变化，`image_tasks` 状态正常翻转 `completed`
  5. worker 模式下故意触发上游 502 → task 失败后 30s 自动重试 1 次；超过 `$tries` 进 `failed_jobs` 表可用 `php artisan queue:failed` 查看

---

## [1.3.14] - 2026-05-12

> **文档功能体验全面打磨 + 批量导入 / 导出**。1.3.12-1.3.13 的紧急修复版本上线后，客户反馈集中暴露了几个易踩坑点：(1) 启用了文档功能但官网顶部导航仍没有「文档」入口（root cause 是 nav-links 的 `<a id="nav-docs-link">` 元素根本没真正写入 home/index.html，只有 JS 操作代码）；(2) docs-frontend 点击 logo / 「全部文档」时 URL 会丢尾斜杠（React Router 在 basename + `to="/"` 下故意把 href 优化成 `/docs` 不带斜杠），在尾斜杠敏感的 nginx 配置下刷新会触发 301 重定向，部分反代场景下还会拼出带端口的异常 URL；(3) RAG 默认提示词太严格——用户发「你好」也会触发「文档中未找到相关信息 [1][2]」的死板回复。同时按需求新增 **批量导入** + **批量导出 md** 两项常用工具。**非 breaking**，老用户升级后默认行为零变化。

### 修复

- **`backend/public/home/index.html` nav 缺「文档」入口**：JS 里有 `getElementById('nav-docs-link')` 操作代码，但 nav-links 区根本没有这个 `<a>` 元素。`getElementById` 返回 `null`，`if (docsLink)` 短路跳过 → 永远不显示。补上元素 + 默认 `hidden`，fetch `/api/public/homepage-config` 拿到 `docs_enabled=true` 时 `removeAttribute('hidden')` 显示。位置：「扩展」与「下载」之间，与原导航风格一致
- **docs-frontend `to="/"` 缺尾斜杠**：根因是 React Router v6 `useHref` 源码刻意把 `pathname === "/" ? basename : joinPaths([basename, pathname])`，basename=`/docs` + to=`/` 直接返回 `/docs`（没斜杠）。修复方案是加全局 `<TrailingSlashEnforcer />` 组件挂在 BrowserRouter 内 Routes 之上，监听 `useLocation`，pathname 落到 basename 时主动 `history.replaceState` 补尾斜杠。一处修复覆盖所有 `<Link to="/">` / `<Navigate to="/">`（logo / 全部文档 / 404 兜底 / 错误页"返回首页"），不需要逐个 Link 改写
- **RAG 默认 prompt 过严**：1.3.13 及之前的默认 prompt 用「必须」「不允许」等强约束，对寒暄类问题（你好 / hi / 你是谁）会触发「未找到相关信息」并机械附 [1] [2]。新版加入寒暄豁免 + 引用编号只在真引用文档时使用：
  1. 优先依据 <文档片段> 回答，引用某段时在末尾用 [1] [2] 标注来源
  2. 用户在打招呼 / 寒暄 / 问你是谁 → 友好简短回应，邀请用户提具体问题，**不带 [1] [2]**
  3. 文档不足以回答时 → 「抱歉，我在文档里没有找到相关信息，可以换个说法或换个关键词再试一下」，**不带 [1] [2]**，不编造
  4. 不要用文档之外的外部知识回答业务问题
- **新增 migration `000006_update_default_docs_system_prompt`**：自动同步「旧默认值 → 新默认值」。三档策略：DB 现值严格等于旧默认（沿用默认的客户）→ 替换；客户已自定义 → 保持不动；不存在该行 → 不插入（`getValue` 自动回落 `DEFAULT_VALUES`）。down() 对称回滚，可重入

### 新增

- **批量导入文档**（`POST /api/admin/docs/batch-import`）：admin 的「文档管理 → 导入文档」弹窗改为多文件拖拽，单次最多 50 个、单文件 ≤20MB、总 ≤100MB；后端循环复用单文件导入逻辑，每个文件独立 try/catch，失败的不影响其他；返回 `{ success, failed, details:[{filename,status,doc_id?,title?,error?}] }`。前端导入完成后展示「成功 N · 失败 M」状态横幅 + 文件级表格明细，可一眼看到哪个文件解析失败 / 失败原因。分类字段从「可选」改为「必填」（避免一批文件混进未分类，运维麻烦）
- **单文档导出 md**（`GET /api/admin/docs/{id}/export.md`）：把 Doc 的 content_html 转成 Markdown 文本下载。文件名优先用 `slug.md`，无 slug 用 `doc-{id}.md`；标题作为 H1 一并写入。文档管理列表「操作」列加「导出」按钮，点击即触发浏览器下载
- **批量导出 zip**（`POST /api/admin/docs/export-batch`）：勾选多篇 → toolbar 出现「批量导出 zip」按钮，单次 ≤200 篇；后端用 `ZipArchive` 打包，按 `分类slug/文档slug.md` 分目录组织（同名 slug 自动追加 `-2 / -3` 后缀去重），通过 Laravel `Response::download(...)->deleteFileAfterSend(true)` 让框架在响应发送后自动 unlink，避免临时文件堆积。zip 内 md 的图片用绝对 URL（不内嵌图片文件，避免 zip 体积爆炸），用户离线打开 md 时图片仍可在线加载
- **html→md 转换工具** `DocExportService`：自己写最小实现（不引 league/html-to-markdown 这类带 commonmark 子树的第三方库），DOMDocument + 递归节点遍历，覆盖 DocRichEditor 实际输出的标签集合：h1-h6 / p / a / img / ul / ol / li / strong / em / code / pre / blockquote / br / hr / table。表格简化处理（无 colspan / rowspan，markdown 也不支持）
- **导出残留兜底清理**：`app/Console/Kernel.php::schedule` 加 `cleanup-doc-exports` 任务，每小时扫一次 `storage/app/temp/doc-exports/`，删除修改时间 ≥1 小时的残留。`deleteFileAfterSend` 处理「下载成功」99% 场景，cron 兜底「下载中断 / 异常导致文件未删」的边角情况，万无一失

### 设计要点

1. **为什么手写 html→md 而不是引 league/html-to-markdown**：第三方库会拉一坨 commonmark / cssselect 子树，最少 4-5 个间接依赖；我们 DocRichEditor 是受控编辑器（TipTap），输出的 HTML 标签集合是封闭的、可控的——自己写一个 200 行内的递归遍历完全够用，且没有 composer 依赖变更（保持升级包零 vendor 改动）
2. **批量导入失败策略选「每个独立处理」而不是「整体事务」**：批量导入大多是新接手运维拿着一堆历史 md 文件往里扔，一个文件解析失败（格式有问题 / 编码异常 / docx 损坏）不应该让其他 49 个成功的也回滚——这违反「最小惊讶原则」。每个独立 try/catch + 明细列表的设计让用户能精准定位哪个文件需要单独修复
3. **批量导入 N=50 单次上限怎么定的**：php.ini 默认 `max_file_uploads=20`，宝塔默认放宽到 50，再大就需要客户改 php.ini；同时 50 个 × 20MB = 1GB 上限太大不安全。100MB 总大小兜底是 `nginx client_max_body_size` 默认值的 5 倍，绝大多数环境都没问题
4. **批量导出 zip 通过 deleteFileAfterSend 自动清理 + cron 兜底**：Laravel 的 `deleteFileAfterSend(true)` 实际是在 Symfony Response::send() 之后的 `fastcgi_finish_request` 钩子里 unlink，对正常完成的下载 100% 生效；但下载中断 / PHP 进程异常退出时文件会残留，cron 每小时扫一次 ≥1 小时的残留兜底
5. **TrailingSlashEnforcer 用 replaceState 而不是 pushState**：避免新增浏览器历史栈条目，否则用户点后退会回到「无尾斜杠的 /docs」再被自动跳回「带斜杠的 /docs/」，陷入死循环
6. **migration 000006 用「严格相等比对旧默认值」而不是模糊匹配**：客户可能在新默认值发布之间自己改过一版 prompt，模糊匹配会误覆盖；严格相等保证只升级「沿用默认」的客户，已自定义的尊重客户配置

### 说明

- **改动文件**（约 10 个）：
  - `backend/config/version.php`：1.3.13 → 1.3.14
  - `backend/app/Http/Controllers/DocController.php`：加 `batchImport` / `exportOne` / `exportBatch` 端点 + `importOneFile` 私有工具
  - `backend/app/Services/DocExportService.php`：新建，html→md + 绝对 URL 图片 + zip 内文件名生成
  - `backend/app/Models/SystemSetting.php`：`docs_system_prompt` 默认值改新版
  - `backend/database/migrations/2026_06_25_000006_update_default_docs_system_prompt.php`：新增，自动同步旧默认 → 新默认
  - `backend/app/Console/Kernel.php`：加 `cleanup-doc-exports` schedule
  - `backend/routes/api.php`：注册 `/batch-import` / `/{id}/export.md` / `/export-batch` 三个新端点
  - `backend/public/home/index.html`：nav-links 补 `<a id="nav-docs-link">` 元素
  - `docs-frontend/src/App.tsx`：加 `<TrailingSlashEnforcer />` 组件
  - `frontend/src/services/api.ts`：加 `batchImport` / `exportOne` / `exportBatch`
  - `frontend/src/pages/Docs.tsx`：导入弹窗改多文件 + 状态表格；行操作加「导出」按钮；toolbar 加「批量导出 zip」按钮；加 `downloadBlobResponse` 工具
- **schema 变更**：无表结构变更；1 个数据 migration（000006 同步旧 prompt 默认值）
- **依赖变更**：无 composer 变更，无 npm 变更
- **回归风险**：低
  - 批量导入是新端点，对单文件 `import` 端点无影响（前端旧调用 / 第三方脚本继续可用）
  - 导出端点全新，不修改任何已有数据；DocExportService 是只读 service
  - cron schedule 用 `withoutOverlapping`，不会重复跑；首次跑时 `storage/app/temp/doc-exports/` 不存在直接 return
  - TrailingSlashEnforcer 只在 `pathname === basename` 时 replaceState，basename=`/` 时跳过；不会干扰其他路径
  - 000006 migration 用严格相等比对，客户自定义的 prompt 不会被改
  - 官网 nav 补元素默认 `hidden`，关闭文档功能时仍然不显示
- **升级路径**：1.3.10 / 1.3.11 / 1.3.12 / 1.3.13 都可一键升级到 1.3.14
- **如何验证**：
  1. 升级后到「官网设置」启用「官网开关」+ 到「文档中心 → 文档设置」启用「文档功能」+ 配 chat / embedding 云端模型；访问根域名（官网首页）顶部导航出现「文档」入口
  2. 点击「文档」进入 docs 站点；点 logo / 左侧「全部文档」，浏览器地址栏一律是 `域名/docs/` 带尾斜杠
  3. 启用「文档 RAG」+ 配模型后在文档站右下角问答悬浮窗输入「你好」，应得到友好简短回应（不是「未找到相关信息 [1] [2]」死板话术）
  4. admin「文档中心 → 文档管理 → 导入文档」：拖入多个 md / docx 文件，弹窗显示每个文件成功 / 失败明细
  5. 文档列表行操作点「下载」图标 → 下载单篇 md 文件
  6. 勾选多篇 → toolbar 出现「批量导出 zip」按钮 → 下载 zip 包

---

## [1.3.13] - 2026-05-12

> **紧急修复：升级到 1.3.12 后访问文档功能报「Database file at path [...] does not exist」**。已经升级的客户站点会复现：进入「文档管理」/「文档设置」/「检索调试」/「问答日志」任一页或访问文档站点提交问答时，DocVecService 调 `DB::connection('docvec')->getPdo()` 触发 Laravel `SqliteConnector::connect()` 在 PRAGMA 执行前先 `file_exists` 校验，文件不存在直接抛 `InvalidArgumentException`。dev 期间这个文件被早期跑测试时自动创建过，所以本地不复现。本版补完文件创建逻辑。**单文件改动 + 1 行修复 + 自愈**。

### 修复

- **`backend/app/Services/DocVecService.php::ensureInitialized`**：之前只 `mkdir` 父目录（`storage/app/sqlite-vec` 等），没处理 SQLite 文件本身不存在的情况。新版按以下顺序兜底：
  1. 配置路径校验（空路径直接抛清晰错误）
  2. 父目录 mkdir（如果还没有）
  3. **文件不存在则 `fopen($dbPath, 'a')` 创建空文件**（SQLite 打开 0 字节文件会被识别为「新库」，自动初始化页头），关闭句柄后 `chmod 0664` 让 PHP-FPM 进程可读写
  4. 用 `fopen` 而不是 `touch()`：部分共享主机为安全禁用 `touch` 函数，`fopen` 普遍开放
  5. 创建失败时异常消息直接吐出可执行的 chown / chmod 命令（`chown -R www-data:www-data ... && chmod -R 775 ...`），运维一眼定位问题
- 这个修复让 docvec SQLite 库**幂等自愈**：升级后第一次访问 admin 文档页面时即可自动创建空 db 文件，无需运维手工干预

### 设计要点

1. **为什么不在 install 流程预先创建**：install 是首次部署一次性脚本，没法应对「在线更新到带文档功能的版本」这种已部署站点的升级场景。把创建逻辑放在 `ensureInitialized()` 里既覆盖新装也覆盖升级
2. **为什么不依赖 `Schema::connection('docvec')->create(...)` migration**：docvec 是二级 SQLite 库，主 migrate 流程跑 `mysql` 连接；想在 Laravel migrate 触发 docvec 连接需要写一个 `Schema::connection('docvec')` 的 migration，但 Laravel 的 SqliteConnector 在 migration 跑之前就先 connect → file_exists 检查直接挂掉。**先 touch 文件再 connect** 是唯一稳妥顺序
3. **为什么 chmod 0664 而不是 0666**：0666 写宽松但被 umask 砍后效果不一致；0664 给 owner+group rw、others ro，与 Laravel storage 目录默认权限策略对齐（owner 通常是 www-data / nginx）

### 紧急运维（已升级 1.3.12 但还没升级 1.3.13 的客户）

如果不能立刻升级到 1.3.13，可在服务器上手工创建文件作为临时缓解：

```bash
touch /www/wwwroot/<your-domain>/storage/app/docs-vectors.db
chown www:www /www/wwwroot/<your-domain>/storage/app/docs-vectors.db
chmod 664 /www/wwwroot/<your-domain>/storage/app/docs-vectors.db
```

宝塔面板 PHP-FPM 进程一般是 `www:www` 用户；自建 nginx 可能是 `www-data:www-data` 或 `nginx:nginx`，按实际调整。

### 说明

- **改动文件**（2 个）：
  - `backend/config/version.php`：1.3.12 → 1.3.13
  - `backend/app/Services/DocVecService.php::ensureInitialized`：约 15 行新增（文件存在性检查 + fopen 创建 + chmod）
- **schema 变更**：无
- **依赖变更**：无
- **回归风险**：极低。修复路径只在 `DocVecService` 首次访问时跑一次（`$this->initialized` 守门），且整段是「文件已存在则跳过」，对新装 / 已升级 1.3.12 但已手工创建文件的客户都是 no-op
- **升级路径**：1.3.10 / 1.3.11 / 1.3.12 → 1.3.13 都可一键升级
- **如何验证**：升级后到 admin 进「文档中心 → 文档设置」，页面正常加载且顶部统计卡的「向量后端」标签显示 `PHP cosine 兜底`（未装 sqlite-vec 扩展的默认状态）；存储目录应自动出现 `storage/app/docs-vectors.db` 空文件

---

## [1.3.12] - 2026-05-12

> **1.3.11 文档功能后续修复 + 官网集成**。1.3.11 上线后立即暴露 4 个问题：(1) 升级老站点新建分类报「Unknown column 'is_visible'」——dev 期间为修 review 发现的字段缺失直接改了已发布的 000001 migration，违反「migration 铁律」，老站点 migrate 看到同名 migration 已有记录就跳过、字段始终缺失；(2) 官网首页与新增的文档站完全没打通，访问根域名只能到首页、找不到文档入口；(3) 关闭官网时根域名 302 → `/admin`（无尾斜杠），与 `Route::get('/admin/{any?}')` 路由模式不一致，地址栏看着不专业；(4) 首页 footer 「江西佰思文化创意有限公司@... 联系电话：xxx」字面量硬编码，多客户复用云控端时是大问题。本版逐项修复 + 新增「文档作为首页」开关 + footer 三段可配置。**非 breaking**，老用户升级后行为完全兼容（默认值与升级前一致）。

### 修复

- **migration 铁律修复**：把 `2026_06_25_000001_create_doc_categories_table.php` 回滚到 1.3.11 早期状态（不含 `is_visible` 列），新增 `2026_06_25_000005_add_is_visible_to_doc_categories.php` 用 `Schema::table` + `hasColumn` 幂等追加。三种升级路径都兼容：
  - 1.3.10 → 1.3.12：跑 000001（无 is_visible，建表）+ 000002/3/4 + 000005（追加 is_visible）✓
  - 1.3.11 → 1.3.12：000001 / 000002/3/4 已应用，跑 000005，hasColumn 检测到字段已存在（1.3.11 包里 000001 含此列）→ 跳过 ✓
  - dev 中间态（已跑无 is_visible 的 000001）：跑 000005 追加字段 ✓
  - 同时把所有违反铁律的「修改已发布 migration」的痕迹回滚，docs/云控端更新包打包流程.md 1.3 节铁律仍然成立
- **`backend/routes/web.php` redirect 尾斜杠丢失**：根因是 Laravel `redirect('/admin/')` 内部 `Illuminate\Routing\UrlGenerator::to()` 的 `'/'.trim($path.'/'.$tail, '/')` 会把首尾斜杠都剥光，最终 Location header 变成 `/admin`（与 `Route::get('/admin/{any?}')` 路由模式不一致）。新增 `redirectKeepSlash()` 工具函数直接构造 `Symfony\Component\HttpFoundation\RedirectResponse`（Laravel `RedirectResponse` 父类），URL 原样进 Location header 绕开 `url()` 的 trim 规范化。3 处跳转（homepage_enabled=false / use_docs_as_index=true 跳 /docs/ / 兜底回退）全部走该工具函数

### 新增

- **「文档作为首页」开关**（`homepage_use_docs_as_index`）：admin 在「官网设置」可开启，开启后访问根域名 302 → `/docs/`（适合纯文档站定位的客户）。开关旁会按 `docs_enabled` 状态自动禁用 + 给提示，避免「打开了但文档功能没开」的死链。`routes/web.php` `/` 路由按三档优先级判断：
  1. `homepage_enabled=false` → `/admin/`
  2. `use_docs_as_index=true` 且 docs 启用 + `public/docs/index.html` 存在 → `/docs/`
  3. 默认 → 渲染官网首页
- **官网首页顶部「文档」导航**：`backend/public/home/index.html` nav 加 `<a id="nav-docs-link" href="/docs/" hidden>文档</a>`，默认 `hidden`；fetch `/api/public/homepage-config` 拿到 `data.docs_enabled=true` 后才 removeAttribute('hidden')。docs 关闭时导航完全不出现，不会出现「点了文档但 404」的尴尬
- **footer 三段可配置**：新增 3 个 system_settings 键 `homepage_footer_company` / `homepage_footer_contact` / `homepage_footer_beian`，admin「官网设置」加「页脚信息」Card 配置。footer HTML 改为 4 个 span 占位（company / text / contact / beian），applyTexts 用 `setFooterPart()` 工具按值是否为空决定 `hidden` + 拼接前后分隔符 ` · `，全空时只显示 applyBranding 写入的「年份 © 应用名」
- **`HomepageController::publicConfig`**：响应额外吐出 `docs_enabled` + `homepage_use_docs_as_index` 两个布尔，让首页前端（home/index.html）一次拉到所有需要的开关
- **`HomepageController::index/update`**：admin 端管理接口同步加这两个布尔字段读写 + 校验（`nullable|boolean`）

### 设计要点

1. **为什么 redirect 选 RedirectResponse 直接构造而不是 `redirect()->away(...)`**：away 适合带 scheme/host 的 absolute URL（且会做安全检查不让跳第三方），传相对路径 `/admin/` 不一定可靠；RedirectResponse 直接接 URL 字符串塞 Location header，行为可预测。Symfony 上游也保留 trailing slash（不做 trim），是 W3C 推荐做法
2. **为什么不在 routes/web.php 直接写 `header('Location: /admin/')`**：会绕开 Laravel 的 response pipeline（中间件、TrustProxies、Symfony Cookie 等都不跑），未来加 cookie / log 中间件会出问题。`new RedirectResponse(...)` 是最小破坏面解法
3. **为什么 use_docs_as_index 路径里加 `file_exists(public_path('docs/index.html'))`**：防止 admin 误开了开关但 docs-frontend 产物没部署（升级包旧版无此目录）→ 跳到 /docs/ 命中 web.php 的 `Route::get('/docs/{any?}')` 又拿不到 index.html → 404 死链。多一个文件存在性检查，兜底回退到官网首页
4. **footer 用 hidden 属性 + 分隔符前缀策略而不是模板字符串**：本想直接 `<span id="footer-content"></span>` 然后 JS 一次性 `textContent = parts.join(' · ')`。但保留多 span 的好处：CSS 后续可以单独给每段加 `.footer-company { color: ... }` 等差异化样式；hidden 也比 `display:none` 在 SEO 上更友好（搜索引擎仍能识别空字段被显式隐藏）
5. **migration 000005 双幂等设计**：`hasColumn` 防重复加列，`try/catch` 防重复加索引（旧 Laravel 没 `hasIndex` API）。down() 也加 hasColumn 检查，保证 migrate:rollback 可重入

### 说明

- **改动文件**（约 8 个）：
  - `backend/database/migrations/2026_06_25_000001_create_doc_categories_table.php`（回滚到不含 is_visible）
  - `backend/database/migrations/2026_06_25_000005_add_is_visible_to_doc_categories.php`（新增）
  - `backend/app/Models/SystemSetting.php`（KEY_TYPE_MAP 加 4 个键：homepage_use_docs_as_index + 3 个 footer）
  - `backend/app/Http/Controllers/HomepageController.php`（TEXT_KEYS 加 3 个 footer；index/update/publicConfig 加 4 个新字段）
  - `backend/routes/web.php`（redirectKeepSlash 工具 + 三档优先级路由）
  - `backend/public/home/index.html`（nav 加文档链接 + footer 改动态 + applyTexts 加 setFooterPart + fetch 后显示文档导航）
  - `backend/config/version.php`（版本号 1.3.11 → 1.3.12）
  - `frontend/src/pages/HomepageSettings.tsx`（顶栏加「文档作为首页」Switch + 加「页脚信息」Card）
- **schema 变更**：1 个新 migration（000005 add is_visible）；KEY_TYPE_MAP 加 4 个 system_settings 键（不需要 schema 迁移，settings 表是 KV）
- **依赖变更**：无 composer 变更，无 npm 变更
- **回归风险**：极低
  - migration 000001 回滚不影响新装站点（最终表结构由 000001 + 000005 拼起来一致）
  - 老站点（1.3.11 已应用 含 is_visible 的 000001）跑 000005 时 hasColumn 检测到字段已存在 → no-op
  - redirectKeepSlash 行为与 redirect('/admin/') 在「Location header 值」上唯一区别就是带不带尾斜杠，无其他副作用
  - 新增的 footer 三字段、homepage_use_docs_as_index 默认空 / false，老用户升级后页面零差异
- **升级路径**：1.3.10 / 1.3.11 → 1.3.12 都可一键升级；1.3.10 用户会一次性吃完文档功能 + 本版的 4 项修复
- **如何验证**：
  1. 升级后进 admin，「文档中心 → 分类管理」点新增分类应能成功（之前会报 Unknown column）
  2. 「官网设置」顶栏看到两个 Switch（官网开关 / 文档作为首页）；后者开启需先打开文档功能
  3. 关闭官网开关后访问根域名，浏览器地址栏显示 `域名/admin/`（带尾斜杠）
  4. 启用文档功能后，访问根域名（官网首页）顶部导航出现「文档」链接
  5. 「官网设置 → 页脚信息」配公司名 / 联系方式 / 备案号，回根域名 footer 立即更新

---

## [1.3.11] - 2026-05-12

> **新增文档管理 + RAG 问答模块**。云控端从原本六大块（服务商 / 模型 / 计费 / 兑换 / 桌面端 / 系统）扩展出第七块「文档中心」，给客户站点提供一站式集成的产品手册 + AI 问答入口。包含 4 张新表、3 个领域 Service（切片 / 向量 / RAG）、1 个 SQLite 二级数据库（向量索引）、admin 端 5 个新页面、独立的面向终端用户的 docs-frontend SPA、流式 SSE 问答接口。**非 breaking**，老用户升级后默认禁用文档站（`docs_enabled=false`），不影响现有功能；启用前需到「文档管理 → 文档设置」配置 chat / embedding 两个 cloud_models。

### 新增

- **数据库 schema**（`backend/database/migrations/2026_06_25_*`，4 张新表）：
  - `doc_categories`：文档分类（name / slug / sort_order / is_visible）
  - `docs`：文档主表（category_id / title / subtitle / content_html / content_plain / slug / is_visible / sort_order / view_count / import_source）
  - `doc_chunks`：切片表（doc_id / chunk_index / chunk_text / embedding_model / vector_indexed / token_count），用于 RAG 检索
  - `doc_chat_logs`：问答审计日志（user_id / session_id / query / answer / cited_doc_ids / latency_ms / total_tokens / status / error）
- **Models**：`Doc` / `DocCategory` / `DocChunk` / `DocChatLog`，含关联与 `Doc::htmlToPlainText` 静态方法（导入 / 编辑后同步纯文本字段，供 LIKE 全文搜索）
- **system_settings 11 个新键**：`docs_enabled` / `docs_guest_access` / `docs_site_title` / `docs_rag_enabled` / `docs_chat_allow_guest` / `docs_chat_model_id` / `docs_embedding_model_id` / `docs_chunk_size`（默认 800） / `docs_chunk_overlap`（默认 100） / `docs_retrieve_top_k`（默认 6） / `docs_min_similarity`（默认 0.30） / `docs_system_prompt`
- **二级 SQLite 数据库 `docvec`**（`config/database.php`）：文件 `storage/app/docs-vectors.db`，与主 MySQL 解耦的向量索引专用库，避免 MySQL 大 BLOB 列与 InnoDB 的写放大
- **`DocVecService`**：二级 SQLite + sqlite-vec 扩展（vec0 KNN 模式）/ PHP cosine 函数（fallback 模式）双轨向量服务。启动时优先尝试加载 `storage/app/sqlite-vec/vec0.{dll|so}` 扩展；加载失败静默降级到 PHP `sqliteCreateFunction('cosine_dist', ...)` 线性扫描（中小站点 < 1000 chunk 性能完全够）。两种模式 `ORDER BY distance ASC` 语义一致，调用方无感
- **`DocChunkerService`**：HTML → 纯文本 → 按段落切分 → 估 token → 合并到目标 chunk_size，超长段落按 token 二次切分 + overlap 保留语义连续。token 估算用「中文 1 字 ≈ 1.5 token / 英文按空格分词」的快速近似（不引 tiktoken 依赖）
- **`DocRagService`**：完整 RAG 工作流。`reindex(doc)` 单文档重建（删旧 chunk + 删旧向量 + 切片 + 调 embedding 模型 + 写 vec 库）；`reindexAll()` 全量重建（切换 embedding 模型 / 改 chunk_size 后必须执行）；`retrievePreview(query)` 查询命中 chunk 列表（admin 调试页用）；`chatStream(query, sessionId)` SSE 流式问答（embedding 检索 → 拼 prompt → chat 模型流式回复 → 解析事件 → 写日志）。内部直接调用 `GatewayRouter` 复用 cloud_models 的鉴权 / 计费 / 健康状态，无独立配置
- **`DocController`**（`backend/app/Http/Controllers/DocController.php`）：admin CRUD 全套（分类 / 文档 / 设置 / 导入 / 富文本嵌入图片上传）+ RAG（reindex / reindex-all / retrieve-preview / test-model / chat-logs）+ 公开浏览（categories / list / show）+ SSE 问答（`publicChat`）。所有字面量端点先于 `/{id}` 注册，避免动态参数吞路由
- **`DocImportService`**：md / docx 导入。md 用 `league/commonmark`（Laravel 自带）转 HTML；docx 用 `phpoffice/phpword` 抽 paragraphs / runs / images，base64 内联图统一抽到 `storage/app/public/docs/imports/{date}/{hash}.{ext}` 并替换 src
- **API 路由**：
  - `/api/admin/docs/*`（admin 鉴权）：分类 / 文档 / 设置 / 导入 / RAG / 日志
  - `/api/public/docs/*`：受 `docs_enabled` + `docs_guest_access` 门控；`config` 不门控（前端要先拉到才能判断是否跳登录）；`/chat` 限流 30/min
  - `/api/client/docs/*`（已登录用户）：复用 publicConfig/Categories/List/Show，自动绕开 guest_access 限制
- **admin 前端「文档中心」**（`frontend/src/pages/Docs*.tsx`）：5 个新页面 + AdminLayout 一级菜单
  - `Docs.tsx`：文档列表 + 筛选 + 批量操作 + 富文本编辑弹窗 + 导入弹窗（支持 .md / .docx）
  - `DocCategories.tsx`：分类 CRUD（用数字输入 sort_order，不引拖拽依赖）
  - `DocSettings.tsx`：4 卡片分组（基础开关 / 站点信息 / RAG 模型 / 检索切片参数）+ 顶部 6 项统计 + 底部「全量重建索引」二次确认 + 模型「测试连通」按钮
  - `DocRetrievePreview.tsx`：检索调试，输入 query 看后端返回的 chunk 命中列表 + cosine 相似度 / 距离
  - `DocChatLogs.tsx`：问答审计列表 + 点击行 Modal 看完整 query / answer / cited_docs / error
- **`DocRichEditor.tsx`**：在原 `RichTextEditor`（公告页用）基础上扩展——加标题 / 引用 / 代码 / 列表 / 链接 / 图片上传按钮 + 粘贴 HTML 清洗（去 `<script>` / inline event）
- **docs-frontend SPA**（`docs-frontend/`，独立 React 19 + Vite 8 项目，与 admin frontend 同栈但不引 antd）：面向终端用户的文档站。包含布局（顶部 header + 搜索 + 左侧分类）、首页 / 分类页 / 详情页 / 搜索页、右下角 RAG 问答悬浮窗（fetch + ReadableStream 读 SSE，不依赖 EventSource，便于带 POST body）。生产 `npm run build` 产物落到 `backend/public/docs/`，由 `routes/web.php` 的 `/docs/{any?}` SPA fallback 提供入口（与 admin 同模式）
- **打包流程文档** `docs/云控端更新包打包流程.md` 1.5 节加 docs-frontend 构建步骤；`storage/app/sqlite-vec/` 加 README 说明扩展二进制下载与部署

### 设计要点

1. **为什么二级 SQLite 而不是 MySQL 存向量**：生产 MySQL 是 8.0.x，没启用 vector 扩展（仅 8.0.32+ 部分发行版有，且 cloud-managed RDS 一般不开）；BLOB 列存 1536 维 float32（~6KB / 行）会显著放大 InnoDB undo log，KNN 又必须扫全表（无索引）。SQLite + sqlite-vec 是**专门为本地嵌入式向量索引设计**的方案，无依赖 + 文件级 + 切换 embedding 维度时整表重建成本可控
2. **vec0 vs PHP cosine 兜底**：vec0 提供真 KNN（O(log n)），但需要装扩展（部分共享主机 / 安全策略禁用 PDO::loadExtension）。PHP `sqliteCreateFunction` 注册 cosine_dist 函数让 SQLite 在 SELECT 时调用 PHP 计算，本质是 O(n) 线性扫描，但 < 1000 chunk 单次查询 < 50ms，对中小文档站够用。两种模式对调用方无感，「文档设置」页 vec_mode 标签暴露当前实际状态
3. **复用 cloud_models 而不是新增配置**：chat 和 embedding 模型直接选 `type=chat` / `type=embedding` 的 cloud_models，鉴权 / 计费 / 限流 / 健康状态全走 GatewayRouter。运维只需在「AI 资源」配好模型，文档功能自动可用，不引入独立的 API key 管理
4. **流式问答用 fetch + ReadableStream 而非 EventSource**：EventSource 不支持 POST body（必须 GET），但 query / session_id 走 query string 会被 web 服务器日志记录（隐私问题），且超长 query 会超 URL 长度限制。fetch 手动解 SSE 多 7 行代码换来灵活性 + 隐私 + AbortController 真正中断流（EventSource 关闭后服务端可能仍在跑模型）
5. **content_html + content_plain 双字段**：富文本编辑保存 content_html 给前端展示；同步生成 content_plain 给后端 LIKE 搜索 + RAG 切片输入。`Doc::htmlToPlainText` 用 `strip_tags` + 实体解码 + 多空白合并，简单可靠
6. **分类 / 文档可见性双层门控**：分类 `is_visible=false` → 该分类整体不出现在前台；文档 `is_visible=false` → 单篇不出现，且即使知道 slug 直接访问也 404。RAG 检索同样过滤 `is_visible=true`（避免下架文档仍被问答引用）
7. **session_id 用 sessionStorage 持久化**：游客刷新页面保留同一会话，方便多轮对话；后端日志按 session_id 聚合可看完整会话上下文。已登录用户用 `user_id + session_id` 联合定位

### 说明

- **改动文件**（约 30 个）：4 个 migration + 4 个 Model + 4 个 Service + 1 个 Controller（DocController, ~940 行）+ `routes/api.php` 加 `/admin/docs/*` + `/public/docs/*` + `/client/docs/*` 三组路由 + `routes/web.php` 加 `/docs/{any?}` SPA fallback + `config/database.php` 加 `docvec` SQLite 连接 + `SystemSetting::DEFAULTS` 加 11 个键 + admin 前端 6 文件（5 页面 + DocRichEditor）+ AdminLayout 加菜单 + App.tsx 加路由 + 整个 `docs-frontend/` 子项目（17 文件）
- **schema 变更**：4 张新表，无字段修改 / 删除（migrations 只增不改铁律）
- **依赖变更**：
  - 后端无新 composer 依赖（`league/commonmark` 和 `phpoffice/phpword` 都是 Laravel / 已在 vendor 中的工具）
  - 前端 docs-frontend 引 `react@19` / `react-router-dom@7` / `axios` / `dompurify`（XSS 清理 content_html，必装）
- **配置变更**：admin 升级后需到「文档管理 → 文档设置」配置 chat / embedding 模型；首次启用 `docs_enabled=true` 后可立即创建分类 + 文档
- **回归风险**：极低。新增模块完全独立，不修改任何现有 Controller / Service / 路由。文档功能默认禁用，老用户升级后无感
- **升级路径**：1.3.10 → 1.3.11 一次性吃完整文档功能；migrations 自动跑（在线更新链路会执行 `php artisan migrate --force`）；可选的 sqlite-vec 扩展按需在 `storage/app/sqlite-vec/README.md` 指引下载部署
- **如何验证**：升级后进 admin → 顶部菜单出现「文档中心」 → 进「文档设置」选好两个模型 → 点「测试连通」两个都绿 → 创建一个分类 + 一篇文档 → 「检索调试」输入 query 能命中 → 访问 `/docs/` 能看到文档站 + 右下角「问答助手」按钮 → 点开提问能拿到流式回答

---

## [1.3.10] - 2026-05-12

> **多米生图 HTML 400 最终修复**。1.3.9 加了 body 白名单清洗后多米生图仍报「多米 API 提交任务失败 (HTTP 400)」+ HTML 错误页。通过对照多米官方 apifox 文档（`https://duomiapi.com/v1/images/generations?async=true`）+ PHP curl 示例，定位到 3 个叠加根因：**(1) Laravel `PendingRequest::withHeaders` 用 `array_merge_recursive` 合并 headers**——`parent::buildHttp` 调 `withToken($apiKey)` 后 `headers['Authorization'] = 'Bearer xxx'`，再 `withHeaders(['Authorization' => $apiKey])` 预期「裸 token 覆盖 Bearer」，实际**累加成 `['Bearer xxx', 'xxx']` 数组** → Guzzle 发出**两个 Authorization 头** → 多米 nginx 网关认定异常请求 HTML 400 拒；**(2) Guzzle 默认 `User-Agent: GuzzleHttp/x`** 被多米上游 WAF 拦截（原生 PHP curl 不发 UA、桌面端 Node fetch 也不发 → 这两条已知能用）；**(3) 多米 size enum 仅接受 3 个固定像素串（1024x1024 / 1024x1792 / 1792x1024）+ 11 个比例 + auto**，桌面端按 UI「2K / 4K」档位算出的 `"2048x2048"` / `"3840x2160"` 在 enum 之外，触发 nginx 参数校验失败。**修复策略：DuoMiAdapter 底层 HTTP 客户端从 Laravel Http (Guzzle) 改为原生 PHP curl，与多米官方 PHP 示例 1:1 对齐 + size 反向 snap 到 enum 合法比例**。非 breaking、1 文件改动、无 schema 变更、无 composer 依赖变更、无须修改任何配置即可生效。

### 修复

- **`backend/app/Services/Gateway/Adapters/DuoMiAdapter.php`** 完整重构（保留对外 `ProviderAdapter` 接口契约不变）：
  - **新增 `DUOMI_SIZE_PIXEL_ENUM` / `DUOMI_SIZE_RATIO_ENUM` 常量**：精确编码多米官方 apifox schema 中 `Size` enum 的全部 14 个合法值（3 像素 + 11 比例），作为 size 标准化的权威依据
  - **新增 `cleanseDuoMiBody(array): array`**：严格按多米 schema `ApifoxModel` 白名单过滤——`model` / `prompt`（≤5000 字 mb_substr 截断） / `quality`（仅 high/low/medium，丢弃 OpenAI 的 'auto'） / `size`（必经 normalizeDuoMiSize） / `seed`。所有其他字段（n / response_format / style / user / cloud_model_id 等）一律丢弃。1.3.9 残留的 `'n' => 1` 强制注入也被移除（多米 schema 明确字段中无 `n`，OpenAI 协议的 n 会被 WAF 拦）
  - **新增 `normalizeDuoMiSize(string): string`**：把任意 size 输入标准化到 enum 合法值。'auto' 直通；`1024x1024` / `1024x1792` / `1792x1024` 直通；W:H 比例若在 enum 内直通、否则 snap；其他 W×H 像素串（如桌面端发的 `2048x2048`）反向计算比例后 snap 到 11 个 enum 比例中最接近的一项；不识别 fallback 到 `1:1`
  - **新增 `snapPixelToSupportedRatio(int, int): string`**：用 w/h 比值绝对差为度量，从 `DUOMI_SIZE_RATIO_ENUM` 中选最接近项。同比例不同长边不区分（如 2048x2048 与 1024x1024 都 snap 到 `1:1`）——长边由 multi-米按 quality + 模型默认决定，云控端不再传具体像素
  - **新增 `submitViaCurl(url, apiKey, body, timeout): array`** 与 **`pollViaCurl(url, apiKey, timeout): array`**：用原生 PHP `curl_init` + `curl_setopt_array` + `curl_exec` 提交 / 轮询，与多米官方 apifox 给出的 PHP 示例 100% 对齐：`CURLOPT_RETURNTRANSFER` / `CURLOPT_ENCODING=''` / `CURLOPT_FOLLOWLOCATION` / `CURLOPT_HTTP_VERSION=CURL_HTTP_VERSION_1_1` / `CURLOPT_CUSTOMREQUEST=POST|GET` / `CURLOPT_HTTPHEADER` 仅 2 个值（`Authorization: <key>` 裸 token + `Content-Type: application/json`，GET 时无 Content-Type）。原生 curl 默认**不发送 User-Agent 头**（除非显式 `CURLOPT_USERAGENT`），与桌面端 Node fetch 行为对齐
  - **新增 `safeJsonDecode(string): ?array`**：失败返 null，不抛错
  - **删除 `protected function buildHttp` 重写**：DuoMiAdapter 不再继承父类 `AbstractAdapter::buildHttp` 的 Laravel Http 路径——从根上避开 `array_merge_recursive` 把 Authorization 累加成数组的 bug。`OpenAICompatibleAdapter` 走 bearer 风格只调一次 `withToken`、无覆盖动作，不受此 bug 影响，故不动
  - **`image()` 主流程**：`endpoint != 'generations'` / `images` / `mask` 三重前置拦截不变 → `cleanseDuoMiBody` → `submitViaCurl` → 解析 `{ id }` → 循环 `pollViaCurl` 直到 `state=succeeded/failed/error/cancelled` 或 `gateway.timeouts.image` 超时（默认 300s）。错误前缀「多米 API 提交任务失败 (HTTP …)」与 `summarizeErrorBody` 截断脱敏保留，便于运维定位上游具体响应
  - **`probeModels()` 同步改用 `pollViaCurl`**：让基础测试与真实调用走完全相同的 HTTP 代码路径，避免「probe 通过但实际调用 401」或「probe 失败但实际能用」的不一致

### 不动的部分

- `OpenAICompatibleAdapter` / `AbstractAdapter::buildHttp`：行为完全不变。OpenAI 兼容路径走 `withToken` 一次性写 `Bearer xxx`、无 Authorization 覆盖动作，不触发 `array_merge_recursive` 累加 bug
- `ProcessImageTask::handle` 多米强制旁路（1.3.7 加的）+ `GatewayRouter::isLikelyDuoMiProvider` host 启发式识别：保留
- 接口契约：`DuoMiAdapter` 仍实现 `ProviderAdapter` 接口的 `image / chat / chatStream / embeddings / probeModels / probeChat`，签名 + 返回类型完全不变。`GatewayRouter::selectAdapter` 路由逻辑不动

### 设计要点

1. **为什么完全跳出 Laravel Http**：发现 `withHeaders` `array_merge_recursive` 后，第一反应是「再加一道 withHeaders 之后用 withOptions 显式覆盖 Authorization」。但这条路径需要绕开 Guzzle / Laravel HTTP 多层抽象的隐性合并逻辑，每修一处都可能埋新坑（如代理重写头、ssl 配置时机、Accept-Encoding 默认值等）。原生 curl 配置 7 行可读、行为 100% 确定，对一个**协议简单 + 流量稳定**的中转 API 来说投入产出比最高
2. **为什么用白名单 + size snap 而不是黑名单**：多米官方 schema 用 `[property: string]: any` 兜底「接受额外字段」，但实测上游 WAF 对未声明字段拦截较严（OpenAI 的 response_format=b64_json / n / style / user 全部踩雷）。白名单只放行 5 个官方明确字段，对未来协议演进也更安全；size enum 是 14 个明确值，snap 比保留任意像素串更稳
3. **size snap 后丢失长边信息**：用户在桌面端选「1:1 + 2K」，云控端 snap 后只发 `size=1:1` 给多米，长边由多米按 `quality` + 模型默认决定。这是 1.3.10 的折中——多米官方 schema 既然 enum 只列 3 个像素值，2048x2048 强行透传就是赌运气；snap 到比例字符串确保 100% 在 enum 内，能出图。若未来用户反馈「2K 出图却拿到 1024」，再考虑在 size 字段后追加 `quality=high` 让多米输出更大尺寸
4. **轮询 GET 也用 curl**：避免 image() 内 submit 和 poll 走两套不同的 HTTP 抽象——出问题时 submit 能用 poll 失败（反之亦然）这种不一致很难排查。统一走 curl 让代码路径**真正一致**，与「同代码路径同行为」的工程原则对齐
5. **`probeModels` 与 `pollViaCurl` 共享路径**：让管理后台的「连接测试」按钮真实反映 image() 调用时的链路状态——probe 通过 = 实际能用，避免开 1.3.9 后 probe 显示绿但桌面端报 400 的认知撕裂
6. **不动桌面端**：桌面端 `callDuoMiImageAPI`（本地直连多米路径）用的是 Node fetch，没有 Authorization 累加、没有 GuzzleHttp UA、没有 Accept-Encoding 默认协商，三个根因都不命中。本地直连用户日常能用 = 验证根因确实在云控端 Laravel Http 侧。桌面端**不必为本次修复发版**

### 说明

- **改动文件**（2 个）：
  - `backend/config/version.php`：版本号 1.3.9 → 1.3.10
  - `backend/app/Services/Gateway/Adapters/DuoMiAdapter.php`：上述 7 个方法重构
- **零 schema 变更**：无 migration
- **零依赖变更**：无 composer install 必要
- **零配置变更**：无 `.env` 改动
- **回归风险**：极低。修复**只影响**多米服务商的图片生成 + 探测路径（DuoMiAdapter）。OpenAI 兼容服务商 / 其他 Adapter / chat / embeddings 路径行为完全不变
- **升级路径**：1.3.6 及以前 → 1.3.10 一次性吃到 1.3.7 链路修复 + 1.3.9 body 清洗 + 1.3.10 原生 curl 三道修复，无需中间停留
- **如何验证**：升级后任意发起一次多米生图，期望成功出图（或多米侧业务错误如鉴权/余额不足，但**不再是 HTML 错误页 400**）；管理后台「云端服务商 → 多米 → 基础测试」也应通过

---

## [1.3.9] - 2026-05-12

> **紧急修复：多米生图新一类 HTML 400 错误**。1.3.7 修好了「DuoMiAdapter 永远不被调用」的链路问题后，新的现象浮上来：DuoMiAdapter 确实被选中了（错误前缀变成「多米 API 提交任务失败 (HTTP 400)」），但 step1 POST 提交时多米后端直接返回 HTML 错误页（`<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">`）。根因是 DuoMiAdapter 直接把 `GatewayController::handleImage` 透传过来的完整 OpenAI body（含 `response_format=b64_json` / `quality` / `n>1` / `style` / `user` 等多米**异步生图协议不识别**的字段）原样发给多米，触发多米上游网关（nginx + WAF）的参数校验失败并返回 HTML 错误页——**请求根本没到达多米业务层**。本版本在 `DuoMiAdapter::image` 提交前增加 body 白名单清洗，仅保留 `model` / `prompt` / `size` / `seed`（与桌面端本地直连多米的 `callDuoMiImageAPI` 字段集对齐），并强制 `n=1`（多米单次只能生成 1 张图）。**非 breaking、1 文件改动、无 schema 变更、无 composer 依赖变更、无须修改任何配置即可生效**。

### 修复

- **`backend/app/Services/Gateway/Adapters/DuoMiAdapter.php::image`**：在「参考图/蒙版预校验」与「URL 构造」之间插入 body 白名单清洗段。用 `array_key_exists` + 非空判断从透传 body 中**只**挑出 `model` / `prompt` / `size` / `seed` 四个字段写入新的 `$submitBody`，并预置 `n=1`。**原 body 中所有其他字段**（`response_format=b64_json` / `quality` / `style` / `user` / `cloud_model_id` 残留 / 桌面端误传字段等）**全部被丢弃**。这保证多米上游网关只收到它认识的字段集，避免触发 nginx WAF 的 HTML 400 拦截
- 选 `array_key_exists` 而非 `isset`，是为正确处理 `seed=0` 这种"显式为 0"的边界情况（`isset` 会把 `null` 当存在，但 `array_key_exists` 准确判定键是否存在；同时 `null`/空串再做一次过滤是为了避免把客户端误传的空 prompt / 空 size 当作合法字段透传上去）

### 设计要点

1. **白名单而非黑名单**：黑名单方案（"删掉 response_format / quality"）需要随多米协议演进不停维护"哪些字段不认"清单，且无法防御未知字段污染；白名单只允许已知能用的字段通过，未知字段一律丢弃。多米异步生图协议简单（4 字段），白名单是更好的选择
2. **与桌面端字段集严格对齐**：桌面端 `callDuoMiImageAPI`（已知能用，用户日常本地直连多米生图就走这条路径）的提交 body 是 `{ model, prompt, size }` + `applyProviderPatches` 三个核心字段。本次白名单完全采用同一字段集（多加一个可选 `seed`），保证云控端 Adapter 和桌面端 native 调用对多米后端的可见参数一致——任何一方能跑通，另一方就一定能跑通
3. **`n` 强制 1，不再透传**：多米异步生图协议不支持 `n>1`，OpenAI 协议的 `n=2` 等会被多米网关拒。上层若需要多张图，由 `generateImages` 多次调用（每次 `n=1`）实现，与桌面端 batch 逻辑保持一致
4. **`UpstreamResponse::fail` 错误前缀保留**：HTML 错误体不是 JSON，`$submitResp->json()` 返回 `null`，进入 `fail($code, null, '多米 API 提交任务失败 (HTTP 400)' . summarizeErrorBody)` 分支。`summarizeErrorBody` 会把 HTML 前 240 字截断脱敏后附在错误信息后面，便于运维定位上游具体拒绝原因
5. **不动 `GatewayController::handleImage`**：上层不知道下游 Adapter 是 OpenAI 还是多米还是 SD，**body 清洗逻辑必须在 Adapter 内做**——这是「Adapter 模式」的本意。改 Controller 会让 OpenAI 兼容 Adapter 也丢失字段，得不偿失

### 说明

- **改动文件**（2 个）：
  - `backend/config/version.php`：版本号 1.3.8 → 1.3.9
  - `backend/app/Services/Gateway/Adapters/DuoMiAdapter.php`：`image()` 方法增加 body 白名单清洗
- **零 schema 变更**：无 migration
- **零依赖变更**：无 composer install 必要
- **零配置变更**：无 `.env` 改动
- **回归风险**：极低。修复**只影响**多米服务商的图片生成路径（`DuoMiAdapter::image`）。OpenAI 兼容服务商（`OpenAICompatibleAdapter::image`）与其他所有路径（chat / embeddings / probe）行为完全不变
- **上下游配套**：本修复在 1.3.7 的「ProcessImageTask 多米强制走 Adapter」之上做的二次修复。1.3.6 及以前的部署如果直接跳到 1.3.9，会一次性吃到两个修复（链路修复 + body 清洗），无需中间停留

---

## [1.3.8] - 2026-05-12

> **新增「对话页面默认模型」配置项**：管理员在「系统设置 → 对话模型」Tab 选择一个 chat 类型云端模型作为桌面端新建会话的默认。配套桌面端 0.6.4 起把「智能体绑定模型」改造为「会话级别模型切换」（每个会话独立持久记忆），新建会话从本接口拉默认值预填，用户在对话页输入框左下角可随时切换。**非 breaking、纯新增功能、新增 2 个 SystemSetting key、无 composer 依赖变更、与桌面端 0.6.4 配套**（桌面端 0.6.3 及以下不读 chat_default_model 字段，行为完全不变）。

### 新增

- **`backend/database/migrations/2026_05_12_000001_add_chat_default_model_settings.php`**：seed 两个 `system_settings` 行：`chat_default_model_provider`（默认 `cloud:default`）+ `chat_default_model_id`（默认空）。两个 key 都做 `where('key', ...)->exists()` 幂等判断，跑两次 migrate 不会重复插入
- **`backend/app/Models/SystemSetting.php`** `ALLOWED_KEYS` 扩展两条 `string` 类型 key：`chat_default_model_provider` / `chat_default_model_id`；`DEFAULT_VALUES` 给 provider 设默认 `'cloud:default'`，让首次访问公开端点时即使 system_settings 行被运维误删也能回退到合理值
- **`backend/app/Http/Controllers/SettingController.php::publicConfig`** 公开端点响应体新增 `chat_default_model: { provider_id, model_id }` 段（与现有 `currency` / `payment` / `agreements` 平级），桌面端 site-config store 拉取后写入 localStorage 缓存
- **`frontend/src/pages/Settings.tsx`** 新增「对话模型」Tab（位置：「资源存储」与「协议管理」之间）：
  - 顶部 `Settings` interface 加 `chat_default_model_provider` / `chat_default_model_id` 两个 string 字段
  - 新增 `ChatModelOption` interface 与 `chatModels` state
  - `load()` 函数改为 `Promise.all([settingApi.get(), modelApi.list({ per_page: 500 })])` 并行拉系统设置 + 全量云端模型；前端按 `type === 'chat'` 过滤并按 `provider_name + model_id` 排序
  - Tab 内放 Antd `<Select showSearch allowClear optionFilterProp="label">`，options 渲染为「服务商 / 模型 ID」标签；`notFoundContent` 区分「暂无 chat 模型」与「无匹配」
  - 隐藏 `chat_default_model_provider` 字段（固定 `cloud:default`，UI 只让管理员选模型）
  - 复用现有 `modelApi.list()`，**无新增 API 端点 / route**

### 桌面端配套（不发版，收 0.6.4）

- **`agent-desktop/resources/schema.sql`** `conversations` 表加 `active_model_provider_id TEXT NOT NULL DEFAULT ''` + `active_model_id TEXT NOT NULL DEFAULT ''` 两列；`agent-desktop/src/main/database/index.ts` `runMigrations` 加幂等 `PRAGMA table_info` 检测 + `ALTER TABLE conversations ADD COLUMN`，老库自动升级
- **`agent-desktop/src/main/services/conversation.ts`**：`Conversation` interface 加两个字段；`createConversation(botId, title, initialModel?)` 第三个可选参数接受 `{ provider_id, model_id }`；新增 `updateConversationModel(id, provider_id, model_id)` 函数（**故意不更新 `updated_at`**，避免污染会话列表排序——切模型不算"有新消息"）
- **`agent-desktop/src/main/services/chat-engine.ts::sendMessage`**：移除原 `if (!bot.model_provider_id && !bot.model_id) throw` 校验，改为 `conv.active_model_* || bot.model_* || throw` 三级回退链；后续 `callLLM` / `maybeGenerateTitle` / `maybeGenerateSummary` 全部改用 `effectiveModelId`（之前用 `bot.model_id`），`bot.name` 仍用于 capSummary
- **`agent-desktop/src/main/ipc/index.ts`** 新增 `chat:updateConversationModel` IPC handler；`chat:createConversation` 透传第三参数 `initialModel`
- **`agent-desktop/src/renderer/src/stores/site-config.ts`**：新增 `ChatDefaultModel` interface + `chatDefaultModel` ref + localStorage 缓存（key=`site_config_chat_default_model`）；`fetch()` 内对 `data.chat_default_model` 做 typeof 校验后写入，向后兼容老云控端响应不带该字段的情况
- **`agent-desktop/src/renderer/src/stores/chat.ts`**：`Conversation` interface 加两个字段；`createConversation` 接受 `initialModel`；新增 `updateConversationModel` 函数（IPC 写回 + 同步本地 conversations 缓存对应 conv，让 `ChatModelSwitcher` 显示立即跟随）；return 暴露新方法
- **`agent-desktop/src/renderer/src/components/ChatModelSwitcher.vue`**（新增 200 行）：IDE 风格的输入框底部模型切换器。下拉按服务商分组 + 顶部搜索框 + 当前选中态高亮；过滤规则**严格复用 `groupAndSort` 的 `hasCap(modelId, 'chat', cloudType)`**（云端 provider 走 `capsFromCloudType` 取 `cloud_models.type`，本地 provider 走 `detectCapsByName` 关键字识别，image/embedding/tts/asr/rerank 关键字独占排除），保证与旧 `BotListView` 的「推荐（对话）」组规则完全一致
- **`agent-desktop/src/renderer/src/views/chat/ChatView.vue`**：输入框容器从 `flex items-end` 改为 `flex-col`，textarea 上 + 底部条下（左 `<ChatModelSwitcher>` / 右 发送/中断 button）IDE 风格；`newConversation` 调 `resolveDefaultModel()` 拿 `siteConfigStore.chatDefaultModel`（云端 model_id 自动 `upgradeToCompositeKey` 为复合 key）→ 传给 `createConversation`；新增 `watch(chatStore.currentConversationId)` 给旧会话（v0.6.3 及之前创建、`active_model_*` 为空）首次打开时自动 fill 默认模型，平滑升级；`resolveDefaultModel` 内本地兜底也用同一套 `hasCap` 过滤，避免选到图像/embedding 模型作为默认对话模型
- **`agent-desktop/src/renderer/src/views/bots/BotListView.vue`**：移除 `<select v-model="form.model_provider_id">` + `<select v-model="form.model_id">` UI 块；`form` 字段去掉 `model_provider_id` / `model_id`；`resetForm` / `editBot` / `saveBot` 不再处理这两个字段；卡片小字从「未配置模型 / 模型名」改为固定「会话时可选择模型」提示；删除未用的 `useModelStore` / `stripModelId` / `groupAndSort` / `warmHintsCache` / `getHintsSync` import
- **`agent-desktop/src/shared/changelog.ts`** 0.6.4 段追加 5 条「智能体不再绑定对话模型」用户视角描述

### 设计要点

1. **provider 字段固定 `cloud:default`**：云控端管理员只能给桌面端推荐云端模型作为默认，本地服务商由桌面端用户自行配置；这避免了「云控端推荐了一个本地模型 ID，但桌面端用户根本没配该本地服务商」的尴尬场景
2. **桌面端 `upgradeToCompositeKey`**：云控端存的 `chat_default_model_id` 是裸 `model_id`（如 `deepseek-chat`），桌面端拉到后在 `resolveDefaultModel` 调用 `modelStore.upgradeToCompositeKey()` 升级为 `{model_id}#@{provider_name}` 复合 key，避免多家云端服务商提供同名模型时 `first()` 错位扣费（与 1.2.x 修复同名模型扣费 bug 是同一份基础设施）
3. **每个会话独立持久化**：模型切换写回 `conversations.active_model_*` 而非全局 settings；用户在 A 会话切到 GPT-4，B 会话仍可用原模型；跨设备同步只需迁移 sqlite 即可保留所有会话的模型选择
4. **chat-engine 三级回退链**：`conv.active_model_*`（v0.6.4+ 优先）→ `bot.model_*`（v0.6.3 及之前的老数据兼容）→ 抛错引导用户从输入框左下角选模型；非破坏性升级，老用户的旧会话 + 旧 bot 直接可用
5. **过滤规则严格一致**：`ChatModelSwitcher` 和 `resolveDefaultModel` 都复用 `hasCap(m, 'chat', cloudType)`，避免本地 provider 把图像 / embedding 模型当作对话模型选中（这点在 0.6.4 第一版漏过滤，已修复）

### 说明

- **改动文件**（4 个）：
  - `backend/config/version.php`：版本号 1.3.7 → 1.3.8
  - `backend/database/migrations/2026_05_12_000001_add_chat_default_model_settings.php`：新增 migration（首次升级 migrate 自动 seed 两个 key）
  - `backend/app/Models/SystemSetting.php`：ALLOWED_KEYS + DEFAULT_VALUES 扩展
  - `backend/app/Http/Controllers/SettingController.php`：publicConfig 暴露 chat_default_model 段
  - `frontend/src/pages/Settings.tsx`：「对话模型」Tab + 加载逻辑
- **新增 SystemSetting key**：`chat_default_model_provider`、`chat_default_model_id`（migration 首次升级时自动 seed；存量部署的 settings 表里没有这两行也不影响 getValue 兜底逻辑）
- **无 composer 依赖变更**：纯应用层代码
- **桌面端配套**：桌面端 0.6.4 起读取 `publicConfig.chat_default_model`；旧版桌面端不读此字段，向后兼容零影响
- **前端 build 必跑**：admin 前端 Settings 页面新增 Tab + load 函数并行拉 modelApi.list，必须 `npm run build` 让 admin 静态资源刷新

---

## [1.3.7] - 2026-05-12

> **修复：所有部署（包括 `cloud_providers.type='duomi'` 配置正确的部署）的桌面端多米生图都被上游拒绝并返回英文错误「Synchronous requests are not supported. Please add async=true to the query parameters.」**。根因是历史 feature flag `GATEWAY_USE_NEW_ADAPTER` 默认 `false`，`ProcessImageTask::handle` 在 flag 关闭时走老链路硬编码 `Http::withToken($provider->api_key)->post(...)` 直发 OpenAI 同步协议，**从不调用 GatewayRouter::selectAdapter**，导致 DuoMiAdapter 在新装部署上永远没机会被选中。本版本在 ProcessImageTask 的 use_new_adapter 总开关之前增加一道"多米强制走 Adapter"旁路分支：只对多米类服务商无视 flag 直接走 `handleViaAdapter`，其他 provider 行为完全不变。同时把"是否多米"的判断逻辑（type=duomi 或 api_base host 含 duomi/domi）抽到 `GatewayRouter::isLikelyDuoMiProvider` public static helper，让 selectAdapter 与 ProcessImageTask 旁路逻辑共用同一份规则。**非 breaking、2 文件改动、无 schema 变更、无 composer 依赖变更、无须修改任何配置即可生效**。

### 修复

- **`backend/app/Console/Commands/ProcessImageTask.php::handle`** 在 `config('gateway.use_new_adapter')` 判断之前插入一段"多米强制走 Adapter"旁路：`if (GatewayRouter::isLikelyDuoMiProvider($provider)) return $this->handleViaAdapter(...)`。命中的请求绕过 `use_new_adapter=false` 的老链路同步硬编码 POST，直接走 `GatewayRouter::route` → `DuoMiAdapter::image()`（自动加 `?async=true` + 轮询 `/tasks/{id}`）。非多米服务商的请求一行没变，零回归风险
- **`backend/app/Services/Gateway/GatewayRouter.php`** 把多米识别逻辑从 `selectAdapter` 内部私有方法 `looksLikeDuoMiHost` 抽到 public static `isLikelyDuoMiProvider(CloudProvider $provider): bool`，规则：(1) `provider->type === 'duomi'` 直接命中（管理员显式配置）；(2) 否则用 `parse_url(api_base, PHP_URL_HOST)` 取 host 后 lowercase + `str_contains` 匹配 `duomi` / `domi`（容忍管理员把 type 误配成 openai/openai_compatible 的常见错误）。`selectAdapter` 内的 host 兜底分支改为调这个 helper。两处共享同一份判断规则，避免规则漂移

### 桌面端配套（不发版，收 master）

- **`agent-desktop/src/renderer/src/utils/error-message.ts`** ERROR_MAP 新增一条：`'Synchronous requests are not supported' → '多米服务商类型配置错误（需为「多米 API」），请联系管理员在云控端「云端服务商」修正'`。注意此映射仅作旧版本云控端兜底——1.3.7 升级后这个英文错误不会再出现，本翻译只保护「桌面端已升级、云控端还在 1.3.6 及以下」的并发期场景

### 说明

- **改动文件**（3 个）：
  - `backend/config/version.php`：版本号 1.3.6 → 1.3.7
  - `backend/app/Console/Commands/ProcessImageTask.php`：handle() 内新增 9 行旁路逻辑（在 use_new_adapter 判断之前）
  - `backend/app/Services/Gateway/GatewayRouter.php`：`selectAdapter` 改用 `isLikelyDuoMiProvider`，新增 `isLikelyDuoMiProvider` public static 方法（净改动 +5 行）
- **无 schema 变更**：migrations 列表与 1.3.6 完全一致
- **无 composer 依赖变更**：`composer.json` / `composer.lock` 不动
- **无配置变更**：`GATEWAY_USE_NEW_ADAPTER` 保持默认 false，无须任何 .env 改动即可生效
- **向后兼容**：(1) 非多米服务商的图片请求继续走原有老链路或新链路（取决于 use_new_adapter）；(2) selectAdapter 对 type=openai / openai_compatible 的非多米服务商行为完全不变；(3) 已设置 `GATEWAY_USE_NEW_ADAPTER=true` 的部署不受影响（多米旁路在 flag 判断之前命中后直接 return，相当于"flag 为 true 时本来就走 Adapter"）
- **一次性测试**：升级到 1.3.7 后随便用任意多米模型发一次生图请求，应当看到正常出图（或多米侧的具体业务错误），而不再是 `Synchronous requests are not supported` 英文错误

---

## [1.3.6] - 2026-05-12

> **新增「公告管理」模块**：管理员可在「系统设置 → 公告管理」CRUD 公告（标题 + 富文本正文），桌面端 0.6.4 起登录后自动拉当前启用的最新一条并在顶部标题栏展示 20 字标题预览，点击弹出富文本全文。**非 breaking、纯新增功能、新增 1 张表（announcements）、无 composer 依赖变更、与桌面端 0.6.4 配套**（桌面端 0.6.3 及以下不调用此接口，零影响）。

### 新增

- **`backend/database/migrations/2026_06_20_000001_create_announcements_table.php`**：新增 `announcements` 表，字段 `title varchar(200) / content longtext / enabled boolean default true / sort_order integer default 0 + timestamps` + 联合索引 `idx_announcements_active(enabled, sort_order, id)` 覆盖客户端 `currentActive()` 热点查询的 `where enabled=1 order by sort_order desc, id desc limit 1`
- **`backend/app/Models/Announcement.php`**：Eloquent Model，`$fillable = [title, content, enabled, sort_order]`，`$casts` 自动 enabled→bool / sort_order→int，static `currentActive()` 返回 `?self`（取当前启用、排序最高的一条；orderByDesc 双键命中联合索引）
- **`backend/app/Http/Controllers/AnnouncementController.php`**：(1) admin CRUD（index/show/store/update/destroy/toggle）；index 支持 `?enabled=0|1` 过滤与 `?keyword=` title 模糊搜索；(2) `current()` 客户端拉取接口返回 `{ announcement: { id, title, content, updated_at } | null }`（单 null check 设计 + 字段裁切不外泄 enabled/sort_order）；(3) 私有 `validatePayload(Request, bool $applyDefaults)` 抽出公共验证规则（title required max:200 / content required string / enabled sometimes bool / sort_order sometimes int between:-9999,9999），**关键设计**：兜底默认值（enabled=true / sort_order=0）仅在 store 时 `$applyDefaults=true` 生效，update 时 `$applyDefaults=false` 禁用，避免「只想改标题」的请求覆盖原有 enabled/sort_order 状态
- **`backend/routes/api.php`** 路由注册：(a) 客户端 `GET /api/client/announcement/current` 挂在 `auth.jwt` middleware 内（与 `myModels` / `myPermissions` / `myBalance` / `myBillingRules` / `myPlans` 同层，桌面端 `fetchCloudData` 一次性并行拉取）；(b) admin `Route::prefix('announcements')->group(...)` 注册 7 条 CRUD + toggle 路由，挂在 `auth.jwt + admin` 双 middleware 内
- **`frontend/src/components/RichTextEditor.tsx`**：极简 contenteditable 富文本编辑器（130 行，**零新 npm 依赖**）。`document.execCommand` 实现 bold/italic/underline/insertOrderedList/insertUnorderedList/createLink/removeFormat 7 按钮 + 1 分隔条 + 工具栏；`onPaste` 阻止默认 + 调用 `document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))` 剥外部样式；`useEffect([value])` 内仅在 `el.innerHTML !== value` 时回写 innerHTML，避免每次 re-render 都覆盖造成光标重置到开头；按钮用 `onMouseDown + preventDefault` 防止 contenteditable 失焦。`createLink` 强制 https:// 前缀提示但允许相对路径
- **`frontend/src/pages/Announcements.tsx`**：管理页（约 270 行）。Antd Table（rowKey=id / pagination=false / size=middle / 列：title 280px / enabled Switch 90px / sort_order Tag 80px / updated_at 170px / actions 230px）+ Modal 新增/编辑（`destroyOnHidden` Antd 6 新 API / width=720 / `RichTextEditorField` 包装 Form.Item 受控接口）+ Modal 预览（`dangerouslySetInnerHTML` 渲染富文本 + 与桌面端弹窗一致的 a / ul / ol / p 内联样式）+ Popconfirm 删除（okType=danger）+ Switch 一键 toggle。content 字段 `validator: async` 剥 HTML 标签 + `&nbsp;` 后 trim 判空，规避 `<div><br></div>` 这类「视觉为空但 HTML 非空」的坑
- **`frontend/src/services/api.ts`**：`announcementApi` 客户端：list({ enabled?, keyword? }) / get(id) / create(payload) / update(id, payload) / delete(id) / toggle(id) 6 个方法
- **`frontend/src/App.tsx`**：导入 `AnnouncementsPage`、注册路由 `/announcements`、AdminLayout 菜单分组「系统设置」追加「公告管理」项
- **`frontend/src/layouts/AdminLayout.tsx`**：导入 `NotificationOutlined` 图标、`menuItems` 数组追加「公告管理」项（path=/announcements, group=系统设置）、`groupMap` 反查表加映射

### 桌面端配套

- **`agent-desktop/src/renderer/src/utils/cloud-api.ts`** 加 `cloudClient.currentAnnouncement()` 方法（封装 `GET /api/client/announcement/current`）
- **`agent-desktop/src/renderer/src/stores/cloud-auth.ts`**：(a) 加 `Announcement` 类型；(b) store state `announcement = ref<Announcement | null>(null)`；(c) `fetchCloudData` 内独立 try/catch 拉取（失败/无公告/字段缺失统一回退 null，不阻塞其他 cloud data 同步）；(d) `logout()` 清空 `announcement.value = null`
- **`agent-desktop/src/renderer/src/components/AnnouncementBar.vue`**（103 行）：根 `<template v-if="announcement">` 包裹，无公告时整组件不渲染。`<button>` 元素 + 喇叭 svg + 20 字标题预览（`t.length <= 20 ? t : t.slice(0, 20) + '…'`）。Teleport 弹窗（z-9500 < setup/migration 9999 < update 9000）：透明 pointer-events 层接收外部点击关闭（项目规则「弹窗只加阴影不要背景遮罩」），`v-html` 渲染富文本（max-h 60vh + overflow-y-auto），ESC keydown listener 在 onMounted 注册、onUnmounted 移除
- **`agent-desktop/src/renderer/src/layouts/MainLayout.vue`**：header 内 `<h1 pageTitle flex-shrink-0>` 之后插 `<AnnouncementBar />`（Win 下根 button 元素被 `main.css` 的 `.app-drag button { -webkit-app-region: no-drag }` 全局规则自动覆盖，无需额外 class）

### 说明

- **改动文件**（10 个）：
  - `backend/config/version.php`：版本号 1.3.5 → 1.3.6
  - `backend/database/migrations/2026_06_20_000001_create_announcements_table.php`：新增 migration（首次升级 migrate 自动建表）
  - `backend/app/Models/Announcement.php`：新增 Model
  - `backend/app/Http/Controllers/AnnouncementController.php`：新增 Controller
  - `backend/routes/api.php`：注册 7 条路由（1 客户端 + 6 后台）
  - `frontend/src/components/RichTextEditor.tsx`：新增富文本编辑器
  - `frontend/src/pages/Announcements.tsx`：新增管理页
  - `frontend/src/services/api.ts`：新增 announcementApi
  - `frontend/src/App.tsx`：注册路由 + 菜单分组追加
  - `frontend/src/layouts/AdminLayout.tsx`：注册「公告管理」菜单项 + groupMap
- **新增表**：`announcements`（migration 在首次「在线更新」时自动执行 `php artisan migrate --force`）
- **无 composer 依赖变更**：纯应用层代码，未引入第三方富文本 / 编辑器库
- **桌面端配套**：桌面端 0.6.4 起在顶部标题栏读取本接口；旧版桌面端不调用此接口，向后兼容零影响
- **前端 build 必跑**：admin 前端新增 1 页面 + 1 组件 + 1 菜单项 + 1 路由，必须 `npm run build` 让 admin 静态资源刷新

---

## [1.3.5] - 2026-05-11

> **配合 agent-build 0.6.1 的「最低版本闸门」做前端字段消费 + SDK 携带版本号**：agent-build 0.6.1 起 `GET /api/build/auth-check` 在 1.3.4 已加的 maintenance / maintenance_message 之外又附加 3 个字段（`min_admin_version` / `current_admin_version` / `admin_version_too_low`），且 `POST /api/build/request` 在维护中或云控端版本低于配置时直接 503/426 拒绝。本版本三处配套：(1) 后端 `AgentBuildClient` 在所有出向请求里携带 `X-Admin-Version: <config('version.version')>` 头，供 agent-build 闸门校验；(2) 前端「一键云打包」页消费 admin_version_too_low 字段，渲染 error Alert「云控端版本过低，已被打包平台限制」横幅 + 把提交按钮 disabled 条件扩展为「未授权 / 维护中 / 版本过低」三选一；(3) 提交按钮 onError 识别 `error_code = maintenance_mode | admin_version_too_low` 自动 `loadAuth()` 刷新横幅，不再让用户手动重试。**非 breaking、纯字段消费 + 1 个 PHP 后端 header 注入、无 schema 变更、无 composer 依赖变更、对未升级的 agent-build 完全向后兼容**。配套 agent-build 0.6.1。

### 改进

- **`backend/app/Services/CloudBuild/AgentBuildClient.php::call()`** 注入 1 个新 header：从 `config('version.version')` 读取本端版本号，写入出向请求的 `X-Admin-Version` 头；同时把 `User-Agent` 从硬编码 `agent-admin/1.0` 改为 `agent-admin/<actual-version>`，便于 nginx access_log 区分客户端版本。两点：(a) 仅当 `version` 非空才写头（防 config 缺失时发 `X-Admin-Version: ` 这种空值头）；(b) 所有走 `call()` 的端点（auth-check / request / status / cancel / download / ack / list / template-info / my-info）自动带头，无需逐方法改。agent-build 0.6.1 的 `request` 闸门按这个头判最低版本；agent-build 0.6.0 及以下完全忽略它，零影响
- **`frontend/src/pages/CloudBuild/RequestPage.tsx`** 4 处改动（约 +35 行）：
  - `AuthCheckResult` 接口在 1.3.4 已加的 `maintenance` / `maintenance_message` 之外，再加 `min_admin_version?: string | null; current_admin_version?: string | null; admin_version_too_low?: boolean`，所有字段 optional 兼容 agent-build 0.6.0 旧响应
  - 派生量加 `adminVersionTooLow` / `minAdminVersion` / `currentAdminVersion`，全部走 `auth?.xxx` optional chaining + 显式 `=== true` 比较，未升级 agent-build 时全派生 false / 空字符串
  - 已授权 Card 与表单 Card 之间在 1.3.4 加的维护横幅之后，新增 `!maintenance && adminVersionTooLow` 时显示 error Alert「云控端版本过低，已被打包平台限制」+ `Tag color='blue'` 显示要求的 minAdminVersion + `Tag color='red'` 显示当前版本号 + 引导用户去「在线更新」升级 + 「重新检测」按钮（调 `loadAuth()`）
  - 提交按钮 `disabled` 条件由 1.3.4 的 `!authorized || maintenance || !watchedAppName || !iconUrl` 改为 `!authorized || maintenance || adminVersionTooLow || !watchedAppName || !iconUrl`；按钮文案三元链优先级：未授权 > 维护中 > 版本过低 > 缺名称 > 缺图标 > 提交打包，版本过低时显示「云控端版本过低，请先升级到 X.Y.Z」
  - submit() 的 onError 分支扩展：当 `agent_build_response.error_code === 'maintenance_mode'` 或 `'admin_version_too_low'` 时直接 `message.error(inner.error)` 显示后端下发的中文文案，并自动调用 `loadAuth()` 让横幅同步刷新；否则保留原有 `quota_exceeded` / `client_busy` / 兜底分支不变

### 说明

- **改动文件**：
  - `backend/config/version.php`：版本号 1.3.4 → 1.3.5
  - `backend/app/Services/CloudBuild/AgentBuildClient.php`：所有出向请求注入 `X-Admin-Version` header
  - `frontend/src/pages/CloudBuild/RequestPage.tsx`：类型 + 派生量 + 版本过低横幅 + 提交按钮 disabled + onError 分支
- **`CloudBuildController::authCheck` 透传无需改动**：早已设计为「上游返 200 + authorized 时原样透传 `unset _status` 后的全部字段」（@`app/Http/Controllers/CloudBuild/CloudBuildController.php` 第 289-292 行 `return response()->json($resp, 200)`），agent-build 新增的 3 个版本相关字段自动随响应体流回前端
- **无 schema 变更**：migrations 列表与 1.3.4 完全一致
- **无 composer 依赖变更**：`composer.json` / `composer.lock` 不动
- **向后兼容（双向）**：
  - **agent-admin 1.3.5 + agent-build 0.6.0（旧，未升 0.6.1）**：旧 agent-build 不返 min_admin_version 等字段，也不读 `X-Admin-Version` 头 → `auth?.admin_version_too_low` undefined → 派生 false → 版本横幅不显示、按钮版本闸门不触发 → 行为退化为「只有维护横幅」，零报错
  - **agent-admin 1.3.4（旧）+ agent-build 0.6.1**：旧 agent-admin 不消费 admin_version_too_low 字段、不带 `X-Admin-Version` 头（实际上 1.3.4 不带 header） → 不显示版本横幅，但提交时会因为不带 header 被 426 拒绝；agent-build 0.6.1 把 `error` 字段填中文「云控端版本过低（当前 未知），请先升级到 X.Y.Z」，1.3.4 前端的 `RequestPage::submit onError` 兜底分支会 `message.error('agent-build 拒绝: ${inner?.error}')` 直接显示完整中文，**老用户也能看懂**（核心兼容设计）
- **前端 build 必跑**：`RequestPage.tsx` 改动了，必须 `npm run build` 让 admin 静态资源刷新

---

## [1.3.4] - 2026-05-11

> **配合 agent-build 0.6.0 的「云打包维护开关」做前端字段消费**：agent-build 0.6.0 起 `GET /api/build/auth-check` 在已授权时附加 `maintenance: bool` / `maintenance_message: ?string` 两字段，本版本前端在「一键云打包」页面消费这两字段：维护中时在「已授权」Card 与表单 Card 之间插入 warning Alert 横幅，并把「提交打包」按钮 disabled 条件追加 `maintenance`、按钮文案命中维护态时改为「平台维护中，暂停提交」。**非 breaking、纯前端改动、无 schema 变更、无 composer 依赖变更、对未升级的 agent-build 完全向后兼容**（未升级 agent-build 不返这两个字段 → 前端派生 `maintenance=false` → 行为与 1.3.3 完全一致）。

### 改进

- **`frontend/src/pages/CloudBuild/RequestPage.tsx`** 4 处改动（约 +30 行）：
  - `AuthCheckResult` 接口加 `maintenance?: boolean; maintenance_message?: string | null`，前端单测层面的类型兼容做了 optional
  - 新增模块顶层常量 `DEFAULT_MAINTENANCE_TEXT = '云打包更新维护中，暂停打包，请稍后刷新查看。'`，作为打包平台侧未自定义维护说明时的兜底文案
  - 派生量 `const maintenance = authorized && auth?.maintenance === true`、`const maintenanceText = (auth?.maintenance_message && auth.maintenance_message.trim()) || DEFAULT_MAINTENANCE_TEXT`
  - 已授权 Card 与表单 Card 之间条件渲染 warning Alert（含「重新检测」按钮），message=「云打包平台维护中」、description 用 `maintenanceText`
  - 提交按钮 `disabled` 条件由 `!authorized || !watchedAppName || !iconUrl` 改为 `!authorized || maintenance || !watchedAppName || !iconUrl`；按钮文案的三元链命中 `maintenance` 时显示「平台维护中，暂停提交」（优先级：未授权 > 维护中 > 缺名称 > 缺图标 > 提交打包）

### 说明

- **改动文件**：
  - `backend/config/version.php`：版本号 1.3.3 → 1.3.4
  - `frontend/src/pages/CloudBuild/RequestPage.tsx`：类型 + 派生量 + 维护横幅 + 提交按钮 disabled
- **无后端改动**：`CloudBuildController::authCheck` 早已设计为「上游返 200 + authorized 时原样透传 `unset _status` 后的全部字段」（@`app/Http/Controllers/CloudBuild/CloudBuildController.php` 第 289-292 行的 `return response()->json($resp, 200)`），agent-build 新增的字段自动随响应体流回前端，云控端零代码改动
- **无 schema 变更**：纯前端，migrations 列表与 1.3.3 完全一致
- **无 composer 依赖变更**：`composer.json` / `composer.lock` 不动
- **向后兼容（双向）**：
  - **agent-admin 1.3.4 + agent-build 0.5.0（旧）**：旧 agent-build 不返 maintenance 字段 → `auth?.maintenance` 为 undefined → `maintenance` 派生为 false → 横幅不显示、按钮 disabled 条件命中失败 → 行为与 1.3.3 完全一致，零影响
  - **agent-admin 1.3.3（旧）+ agent-build 0.6.0**：旧 agent-admin 收到新字段但不消费 → 维护开关在该云控端无效，但其它云控端（已升 1.3.4）正常生效；不会有任何报错
- **前端 build 必跑**：`RequestPage.tsx` 改动了，必须 `npm run build` 让 admin 静态资源刷新

---

## [1.3.3] - 2026-05-11

> **云打包记录 mac 双 zip 下载链接补齐**：mac 平台 electron-builder 同时打 x64 + arm64 两个 `.zip`，agent-build 把第一个当 primary 返回、第二个走 supplementary 通道（role 仍为 `primary`）。本版本前 `cloud_builds.stored_path` 只保存 primary 的相对路径，副件那个 zip 的本地路径在落盘后被丢失，前端「云打包记录」列表 + 详情 drawer 的「本地路径」列只显示一个下载链接，管理员需要同时下发 x64 + arm64 两个安装包给客户时只能去 SSH 服务器目录里翻文件。本版本三处补齐：(1) `CloudBuildPullService::downloadAndPlace` 落盘成功后把每个副件的 `stored_path` 回写到 `supplementary_files` JSON；(2) `CloudBuildController::index` 接口 SELECT 列表加上 `supplementary_files` 字段（详情 `show` 接口本来 `first()` 就是全字段 SELECT *，无需改）；(3) 前端 `HistoryPage` 抽出 `getPrimaryDownloads(row)` 辅助函数同时收集主件 + 所有 `role='primary'` 的副件，列表「本地路径」列与详情 drawer「本地路径」行都改成 `Space direction="vertical"` 多行链接，每行按 filename 包含 `arm64` / `x64` 字样推断架构 Tag。**非 breaking、无 schema 变更、无 composer 依赖变更**。

### 修复

- **`app/Services/CloudBuild/CloudBuildPullService.php::downloadAndPlace()`** 末段（约 +20 行）：原本 `placed['placed']` 数组里所有文件都拿到了 `stored_path`，但只有主件那个被回写到 `cloud_builds.stored_path` 字段，副件的本地路径**完全丢失**（落盘存在但数据库不知道在哪）。改成先建 `filename → stored_path` 映射 `$placedByName`，再遍历 `$supList`（已 decode）给每项 `$sf['stored_path'] = $placedByName[$sf['filename']]`，最后 `update` 时同时回写 `stored_path` 主字段与 `supplementary_files` JSON。**仅影响新落盘的记录**，已有 mac 打包记录的副件仍无 `stored_path` 字段——前端兜底用 `updates/{filename}` 推算（落盘约定全在 `public/updates/` 根目录），所以历史记录也能正确显示两个下载链接，无需重新打包
- **`app/Http/Controllers/CloudBuild/CloudBuildController.php::index()` 第 98 行**：`get([...])` 列表加 `supplementary_files`。原本 SELECT 列表里没这个字段，前端列表行无论怎么解析都拿不到副件信息。详情 `show()` 接口走的是 `DB::table()->where()->first()`（没限定 SELECT，自动 SELECT *），所以详情页不受这个 bug 影响、也不需要改
- **`frontend/src/pages/CloudBuild/HistoryPage.tsx`** 三处改动（约 +60 行）：
  - 接口与类型：新增 `interface SupplementaryFile { filename, role, size?, sha256?, download_url?, stored_path? }`；`CloudBuild` 接口加 `supplementary_files?: string | SupplementaryFile[] | null`（后端 DB::table 不会 auto-decode JSON，前端会拿到 JSON 字符串，但兼容已 decode 的数组形式）
  - 辅助函数：`parseSupFiles(raw)` 兜底解析 string / array / null；`detectArch(filename)` 从 filename 包含 `arm64` / `x64` 字样推断架构标签（仅 mac 用，win 总是 x64 不展示标签）；`getPrimaryDownloads(row)` 汇总主件 + 所有 `role='primary'` 的副件，每项 `{ filename, stored_path, arch }`，副件 `stored_path` 缺失时回退 `updates/{filename}`，且 `out.some((d) => d.stored_path === stored)` 去重避免后端某次又把主件也写进了 supplementary
  - 渲染：列表「本地路径」列从单行 `<a href={`/${stored_path}`}>` 改为 `<Space direction="vertical" size={2}>`，每行 `<DownloadOutlined />` + 架构 Tag（如有）+ `stored_path`；列宽 200 → 240。详情 drawer「本地路径」`Descriptions.Item` 同样改造，但用 `size={4}` 间距更舒展

### 说明

- **改动文件**：
  - `backend/config/version.php`：版本号 1.3.2 → 1.3.3
  - `backend/app/Services/CloudBuild/CloudBuildPullService.php`：`downloadAndPlace` 末段补 supplementary stored_path 回写
  - `backend/app/Http/Controllers/CloudBuild/CloudBuildController.php`：`index` SELECT 加 `supplementary_files`
  - `frontend/src/pages/CloudBuild/HistoryPage.tsx`：类型 + 3 个辅助函数 + 列表/详情两处「本地路径」渲染重构
- **无 schema 变更**：`supplementary_files` 字段早在 1.2.5 (`2026_05_05_180000_add_supplementary_files_to_cloud_builds`) 已加，本次只改它的内容写法，migration 列表与 1.3.2 完全一致
- **无 composer 依赖变更**：`composer.json` / `composer.lock` 不动
- **向后兼容**：历史 mac 打包记录的 `supplementary_files` JSON 里没有 `stored_path` 字段，前端按落盘约定回退 `updates/{filename}` 推算，所以**老记录也能立刻看到两个下载链接**，不需要重新打包；新打包记录会更准确（含真实 `stored_path`）
- **win 平台不受影响**：win 平台只产出一个 `.exe` 主件 + 一个 `.exe.blockmap` 副件 + 一个 `latest.yml`，没有 `role='primary'` 的副件，`getPrimaryDownloads` 返回的数组只有 1 项，行为与 1.3.2 完全一致
- **前端 build 必跑**：`HistoryPage.tsx` 有改动，必须 `npm run build` 让 admin 静态资源刷新

---

## [1.3.2] - 2026-05-11

> **三件 UX 与可运维性补丁合并发版**：(1) 全局所有「模型」选择器与展示位补「服务商」前缀，避免同模型 ID 跨多家服务商时分不清归属；(2) 按随行付对接笔记标准做法补 `tianque_public_key` 自助配置入口，应对天阙平台公钥日后轮换；(3) 微信支付 / 天阙支付「测试连接」按钮左加「先保存再测试」灰色文本提示，避免运维改完未保存就点测试导致误以为配置不通。**非 breaking、无 schema 变更、无 composer 依赖变更**。

### 新增

- **`SystemSetting::ALLOWED_KEYS` 加 `tianque_public_key => 'text'`**：平台公钥可见，无需加密落库。允许运维在管理后台「天阙支付 → 平台公钥」自助粘贴公钥，应对天阙日后轮换公钥时无需重新部署
- **`TianquePayService::validatePublicKey()` + `loadPublicKey()` + `normalizePublicKeyBody()`**（约 +130 行）：复用与 `validatePrivateKey` 相同的污染清洗 + 多格式包装尝试 + 友好诊断流程。识别「误粘贴私钥 / 误粘贴证书 / 中文破折号 / 全角字符 / 零宽空格」等典型粘贴污染并给出具体非法字符位置 + Unicode 码点 + 对照建议
- **前端 `Settings.tsx` 天阙 Tab 加「平台公钥（天阙提供）」`<Input.TextArea>`**：5 行 + tooltip 说明从天阙商户后台「密钥管理 / 平台公钥下载」获取，留空将使用代码内置默认公钥（仅做向后兼容用）

### 改进

- **模型选择器与展示位统一加服务商前缀**（共 8 处，跨 5 个前端页 + 3 处后端关联补全）：
  - **后端补 `cloudModel.provider` 关联**（前端 modelApi.list 返回的 model 已带 provider，无需改；以下 3 处后端 list 接口需要补）：
    - `BillingRuleController::index`：`with([cloudModel:id,provider_id,model_id,name,type, cloudModel.provider:id,name])`，cloudModel select 必须含 `provider_id` 外键否则嵌套关联无法 resolve
    - `UsageRecordController::index` / `UsageRecordController::stats`（仪表盘 Top 5 数据源）：同上补 provider 关联
  - **前端 5 个文件 8 个落点**：
    - `Assignments.tsx` 批量分配模型 Modal 多选下拉 → `{provider} / {name} ({model_id})`
    - `Billing.tsx` 表格「模型」列 + 顶部「模型」筛选 + 添加规则 Modal 模型下拉（3 处）
    - `Plans.tsx` 套餐「包含模型」多选下拉 → `{provider} / {name || model_id} ({type})`
    - `Usage.tsx` 表格「模型」列 + 顶部「模型」筛选（2 处）
    - `Dashboard.tsx` 「模型调用 Top 5」卡片：`ModelStats.cloudModel` 类型扩展 `provider?: { id, name }`，渲染时拼 `{provider} / {name}`（model_id 在卡片里太长不显示）
  - **统一格式**：下拉选项 `{provider} / {name} ({model_id})`；表格列与统计卡片 `{provider} / {name}` 紧凑形；服务商缺失时回落原显示，不影响历史数据展示
- **`TianquePayService::loadConfig()` 加载 `public_key`**：phpdoc 同步更新；`isConfigured()` **不**强制要求公钥（向后兼容，公钥可选 → fallback）
- **`TianquePayService::verifyResponse()` 改为优先用配置公钥**：签名增加 `string $configPubKeyPem = ''` 参数；用户配置了走 `loadPublicKey()` 污染清洗路径，未配置时回退到代码内置 `PUB_KEY_TEST` / `PUB_KEY_PROD` 常量。`postJson()` 调用时透传 `$cfg['public_key']`
- **`SettingController::update` 公钥保存前预校验**：与私钥同等待遇，失败立即 422 拒绝 + 详细诊断，避免脏数据落库到测试阶段才发现「未知 OpenSSL 错误」
- **微信支付 / 天阙支付「测试连接」按钮左加「先保存再测试」灰色文本提示**：`Settings.tsx` 行 393 微信、行 573 天阙，`extra` 由单 `<Button>` 改为 `<Space>{text}{Button}</Space>` 紧凑组合，secondary 文本（`color: rgba(0,0,0,0.45)`、`fontSize: 12`）

### 说明

- **改动文件**：
  - `backend/config/version.php`：版本号 1.3.1 → 1.3.2
  - `backend/app/Models/SystemSetting.php`：`ALLOWED_KEYS` 加 `tianque_public_key`
  - `backend/app/Services/TianquePayService.php`：`loadConfig` / `verifyResponse` / `validatePublicKey` / `loadPublicKey` / `normalizePublicKeyBody`
  - `backend/app/Http/Controllers/SettingController.php`：`update` 加公钥预校验
  - `backend/app/Http/Controllers/BillingRuleController.php`：`index` 补 `cloudModel.provider`
  - `backend/app/Http/Controllers/UsageRecordController.php`：`index` + `stats` 补 `cloudModel.provider`
  - `frontend/src/pages/Settings.tsx`：天阙 Tab 加平台公钥输入框 + 微信/天阙测试连接按钮加文本提示
  - `frontend/src/pages/{Assignments,Billing,Plans,Usage,Dashboard}.tsx`：5 个文件加服务商前缀
- **无 schema 变更**：纯应用层 + 配置层改动，`migrations` 列表与 1.3.1 完全一致
- **无 composer 依赖变更**：`composer.json` / `composer.lock` 不动
- **向后兼容**：`tianque_public_key` 字段为空时 `verifyResponse()` 自动回退代码内置常量 → 老用户升级后行为完全不变（不强制要求重新配置公钥）；服务商关联缺失时模型选择器自动回落原显示
- **关于「商户公钥未配置（code=0001）」报错**：本版本**不直接修复该报错**，因为「商户公钥」与本版本新加的「平台公钥」是不同的两把钥匙：
  - **商户公钥**（与商户私钥配对）：商户在自己侧生成，**上传到天阙商户后台**让天阙服务器能验签来自该商户号的请求 — **不在云控端配置**
  - **平台公钥**（天阙服务器侧产生）：云控端用来验签天阙响应防篡改 — 本版本新加的就是这个的自助配置入口
  - 报错 code=0001 是天阙服务器返回，意为「天阙后台没有该商户号 mno=399xxx 对应的商户公钥」，**根因**是商户登录天阙商户平台时漏配了商户公钥，需运维登录天阙商户后台补上传商户公钥
- **前端 build 必跑**：本版本前端 6 个文件都有改动（Settings + 5 个模型展示页），必须 `npm run build` 让 admin 静态资源刷新

---

## [1.3.1] - 2026-05-10

> **多米 API（duomiapi.com）中转服务接入** + **服务商类型枚举清理**。新增 `DuoMiAdapter` 封装多米异步图片生成的「提交→轮询」流程，对上层透传字段级与 `OpenAICompatibleAdapter` 一致的 OpenAI 形态响应；`SUPPORTED_TYPES` 收敛为 `[openai, openai_compatible, duomi]`，移除未落地的 azure / anthropic / gemini 占位（Azure 仍由 `config.auth_style=azure_api_key` 在 OpenAI 兼容协议上承载）。**非 breaking、无 schema 变更、无 composer 依赖变更**。

### 新增

- **`app/Services/Gateway/Adapters/DuoMiAdapter.php`**（新增，约 +260 行）：继承 `OpenAICompatibleAdapter`，封装多米协议差异：
  - 重写 `buildHttp()`：复用父类 SSL / proxy / extra_headers / timeouts，最后用 `withHeaders(['Authorization' => $apiKey])` 覆盖父类的 `Bearer <key>` 头部为裸 token（多米的鉴权风格）
  - 重写 `image()`：仅 `endpoint=generations`。`POST /v1/images/generations?async=true` 拿 `{id}` → 每 3s `GET /v1/tasks/{id}`（单次 30s 超时、总等待 `gateway.timeouts.image` 默认 300s）→ `state==succeeded` 时翻译为 OpenAI 形态 `{ created, data:[{url}, ...] }`。`failed/error/cancelled` → fail；中间态 4xx/5xx 不立即结束（多米偶发 502 常见）。`endpoint=generations` 分支开头额外防御 `body.images / body.mask`（多米只认原生 `image:[url]`，OpenAI 协议的 `images / mask` 会被多米忽略导致「成功出图但与参考图无关」的隐性失败）
  - 重写 `chat() / chatStream() / embeddings() / probeChat()`：直接 fail 「多米仅支持图片生成」
  - 重写 `probeModels()`：多米没 `/v1/models` 端点，改用 `GET /v1/tasks/__probe__` dummy id 探测。401 → 鉴权失败；200/400/404/422 → 可达 + 鉴权 OK，返回内置 `[{id: 'gpt-image-2'}]`；5xx → 上游异常
- **`GatewayRouter::selectAdapter()` 加 duomi 分支**：`'duomi' => app(DuoMiAdapter::class)`；`default` 兜底仍走 `OpenAICompatibleAdapter`（兼容历史遗留枚举不让流量中断）
- **前端 `Providers.tsx` duomi 选项 + 自动填地址**（约 +20 行）：
  - `PROVIDER_TYPE_OPTIONS` 加 `{value: 'duomi', label: '多米 API（仅图片生成 gpt-image-2）'}`
  - `PROVIDER_DEFAULT_API_BASE = { duomi: 'https://duomiapi.com/v1' }` 映射
  - `<Form onValuesChange>` 监听 type 切到映射键时若 api_base 为空则 `setFieldValue` 自动填
- **前端 `Models.tsx` duomi 限制**（约 +30 行）：
  - 顶层 `Form.useWatch('provider_id', form)` + `editing?.provider_id` 算 `currentProviderId` → `isDuomiSelected`
  - `model_id` / `type` Form.Item 加 `disabled={isDuomiSelected}` + `extra` 提示文案（"多米 API 仅支持 gpt-image-2，已锁定" / "已锁定为图像"）
  - `<Form onValuesChange>` 监听 provider_id 切到 duomi 时自动 `setFieldsValue({ model_id: 'gpt-image-2', type: 'image' })`
  - 远程获取批量导入 `handleImport` 把硬编码 `type: 'chat'` 改成 `defaultModelTypeOf(fetchProvider)`（duomi → `'image'`，其它 → `'chat'`）

### 变更

- **`CloudProviderController::SUPPORTED_TYPES`**：从 1.3.0 引入的 5 项 `[openai, openai_compatible, azure, anthropic, gemini]` 收敛为 `[openai, openai_compatible, duomi]`。Azure / Anthropic / Gemini 三个占位枚举移除（实际从未落地各自适配器，1.3.0 引入时是为后续多协议适配预留）。Azure OpenAI 仍可通过类型选 `openai_compatible` + 高级设置鉴权方式选「Azure 风格 api-key」+ 自定义查询参数加 `api-version` 三步实现接入。文件头注释 + 类常量同步更新
- **`GatewayRouter::selectAdapter()` 注释**：移除 azure / anthropic / gemini 占位行，简化为 `default => OpenAICompatibleAdapter`（兜底注释为「未识别 type — 含历史遗留枚举 — 一律回落 OpenAI 兼容协议，确保流量不中断」）
- **`Adapters/AbstractAdapter.php` / `ProviderAdapter.php` 注释**：清理「OpenAI / OpenAICompatible / Azure 等族」「子类（如 AzureAdapter）」「将来加 AzureAdapter / AnthropicAdapter / GeminiAdapter」等占位措辞，保留对真实生效的 Azure 风格鉴权 / 特殊 URL 的描述
- **前端 `Providers.tsx` `PROVIDER_TYPE_OPTIONS`**：从 5 项收敛为 OpenAI 兼容 / OpenAI 官方 / 多米 API 三项。删除 `configToFormValue / formValueToConfig` 中**无人读取**的 `api_version` 死字段（1.3.0 引入时给 Azure type 表单用，但后端 `AbstractAdapter::buildHttp` 实际是从 `config.extra_query.api-version` 读，前端这个字段从来没生效过）；同步删除 `type === 'azure'` 时的 api_version 输入框 `Form.Item` 分支

### 说明

- **改动文件**：
  - `backend/config/version.php`：版本号 1.3.0 → 1.3.1
  - `backend/app/Services/Gateway/Adapters/DuoMiAdapter.php`（新增）
  - `backend/app/Services/Gateway/GatewayRouter.php`（注释清理 + duomi 分支）
  - `backend/app/Services/Gateway/Adapters/AbstractAdapter.php` / `ProviderAdapter.php`（注释清理）
  - `backend/app/Http/Controllers/CloudProviderController.php`（SUPPORTED_TYPES + 注释）
  - `frontend/src/pages/Providers.tsx`（type 下拉收敛 + auto-fill api_base + 清理 api_version 死字段）
  - `frontend/src/pages/Models.tsx`（duomi 模型字段锁定 + 远程获取按 provider 类型推断 type）
- **无 schema 变更**：纯应用层 + 配置层改动，`migrations` 列表与 1.3.0 一致
- **无 composer 依赖变更**：`composer.json` / `composer.lock` 不动
- **无 agent-build 配套要求**：本版本所有改动在云控端自身闭环，与 agent-build 接口无交集
- **前端 build 必跑**：本版本 `Providers.tsx` / `Models.tsx` 都有改动，必须 `npm run build` 让 admin 静态资源刷新；老版本仍能通过原 OpenAI 兼容路径接入多米——但行为与新链路差异较大（鉴权头会被发成 `Bearer <key>` 多米拒绝、异步 task id 不会被轮询、各种字段不匹配），强制升级前端构建避免半套
- **典型受益场景**：(1) 客户接入多米 duomiapi.com 中转的 gpt-image-2 异步图生服务时，云控端透明处理「提交→轮询」全流程，调用方按 OpenAI 兼容形态发请求即可（异步轮询封装在 adapter 里）；(2) 前端 Providers / Models 表单选多米时自动填 / 锁定关键字段，避免运维误填后的调用失败；(3) 多米仅接受图片 URL 不接受 base64，本版本明确拒绝带 base64 的请求避免「成功出图但与参考图无关」的隐性失败（多米目前没有桥接 base64→COS→URL 的能力，故多米服务商仅支持纯文生图）

---

## [1.3.0] - 2026-05-10

> **多协议适配器架构 + 凭证池 + 健康看板** 三件套合并发版：(1) 引入 `OpenAICompatibleAdapter` 等可扩展适配器骨架，为后续 Azure / Anthropic / Gemini 原生协议预留口子；(2) 一个 provider 可挂多把 API Key 自动轮询，连续失败自动失活、可手动重置；(3) 探测器每 5 分钟跑一次 `GET /models`（不消耗 token）写入按小时桶的 `cloud_provider_metrics`，连续失败到阈值自动熔断；前端新增「健康看板」页面以 24h 可用率曲线、P99 延迟、最近错误展示。**全程 feature flag (`GATEWAY_USE_NEW_ADAPTER`，默认 false) 控制：默认不走新链路，老 provider 行为零变化。** 切到 true 后由 `CapabilityFilter` 默认全勾的能力清单兜底，上游字段级一致。3 个 migration 全部 additive，老数据不动。

### 新增

- **`config/gateway.php`**：网关配置中心。`use_new_adapter` 总开关（默认 false）；`probe_interval_minutes`（默认 5）/ `probe_fail_suspend_threshold`（默认 6）/ `metrics_retain_days`（默认 30）控制探测调度与熔断阈值；`credential_fail_invalid_threshold`（默认 5）/ `credential_pool_strategy`（`round_robin` / `random_weighted`）控制凭证池行为；`default_capabilities` 定义 6 项默认能力（stream / usage_in_stream / tools / vision / json_mode / reasoning_params）默认全开等价老行为；`timeouts` 集中接管 chat 120s / embeddings 60s / image 300s / probe 10s
- **3 个 migration（全部 additive，零行为影响）**：
  - `2026_05_09_100001_extend_cloud_providers_for_adapters.php`：`cloud_providers` 加 `config` JSON / `capabilities` JSON / `suspended_at` timestamp / `suspended_reason` varchar(500)，全 nullable。`type` 字段保持 `string(50)` 不动，扩大可选值仅靠应用层白名单 `[openai, openai_compatible, azure, anthropic, gemini]`
  - `2026_05_09_100002_create_cloud_provider_credentials_table.php`：凭证池表 (id, provider_id, name, api_key text, weight smallint, status, fail_count, last_used_at, last_failed_at, last_error, remark, timestamps, softDeletes)。索引 `(provider_id, status)` + `last_used_at` 单列索引；外键 `provider_id` cascade delete
  - `2026_05_09_100003_create_cloud_provider_metrics_table.php`：健康度时间序列 (provider_id, bucket_hour, ok_count, fail_count, latency_ms_p50, latency_ms_p99, last_error_message, timestamps)。复合主键 `(provider_id, bucket_hour)` 天然 UPSERT；`bucket_hour` 单列索引便于按时间清理
- **`app/Services/Gateway/` 适配器骨架**（约 +620 行）：
  - `Contracts/UpstreamResponse.php`（DTO：ok / statusCode / data / errorMessage / usage 五元组 + 静态工厂方法 ok/fail）
  - `Contracts/ProbeResult.php`（DTO：status / message / httpStatus / endpoint / models / model + `toArray()` 兼容现有 `ProviderProbe` 数组格式 + `fromLegacyArray()` 桥接）
  - `Adapters/ProviderAdapter.php`（接口：chat / chatStream / embeddings / image / probeModels / probeChat 六方法）
  - `Adapters/AbstractAdapter.php`（公共基类：`baseUrl()` / `buildUrl()` 走 `ApiBase::normalize`；`buildHttp()` 按 `config.auth_style` 切 Bearer / Azure `api-key` Header / 查询参数 + 应用 `extra_headers` / `verify_ssl` / `proxy`；`applyQuery()` 拼 `extra_query` 与 query 风格 api_key；`extractUsage()` / `classifyConnectionError()` / `summarizeErrorBody()` 沿用 `ProviderProbe` 同名工具）
  - `Adapters/OpenAICompatibleAdapter.php`：1:1 复用 `GatewayController::chatCompletions` / `handleStreamChat` / `embeddings` / `ProcessImageTask::handle` 的现有逻辑，仅把 `Http::withToken(...)` 替换为 `$this->buildHttp(...)`，让 `config.auth_style / extra_headers / verify_ssl / proxy` 等高级配置生效。**流式响应保留原生 `curl` + `WRITEFUNCTION` 边收边吐**（不换 Guzzle Stream），usage 解析逻辑与老代码字段级一致
- **`app/Services/Gateway/GatewayRouter.php`**（约 +140 行）：把一次调用映射到 `(adapter, provider, credential, apiKey)`。`selectAdapter()` 按 `provider.type` 走 match 分支（目前 openai / openai_compatible 都走 OpenAICompatibleAdapter；其他 type 占位回落同一适配器）；`selectCredential()` 优先看池子里 status=active 的行，按 `last_used_at` ASC（round_robin）或 weight 加权随机（random_weighted）；池子全空回落 `provider.api_key`（保证老 provider 零行为变化）。`markCredentialSuccess` / `markCredentialFailure` 在调用结束后回写 fail_count，达 `credential_fail_invalid_threshold` 阈值置 invalid（不删除，可手动 reactivate）
- **`app/Services/Gateway/CapabilityFilter.php`**（约 +110 行）：在请求送入 adapter 之前清洗 OpenAI 形态请求体。`usage_in_stream=false` 剥 `stream_options.include_usage`；`tools=false` 剥 `tools / tool_choice / functions / function_call`；`json_mode=false` 剥 `response_format`；`vision=false` 把 multimodal `content` 数组退化为纯文本拼接；`reasoning_params=true`（或 model 名匹配 `o1- / o3- / o4- / gpt-5-` 等推理模型前缀）则 `max_tokens` → `max_completion_tokens`、剥 `temperature / top_p / presence_penalty / frequency_penalty / logprobs / top_logprobs`。`resolveCapabilities()` 合并 `default_capabilities` 与 `provider.capabilities`，老 provider 字段为 null 时按默认全开兜底
- **`app/Services/Gateway/NewGatewayService.php`**（约 +200 行）：串接 Router → CapabilityFilter → Adapter → 计费，对外暴露 `handleChat(Request, user, cloudModel, billingRule, requestId)` 与 `handleEmbeddings(...)`。同步 chat 走 `adapter->chat`、流式 chat 走 `response()->stream()` 包 `adapter->chatStream` 的 `onChunk` (echo + ob_flush + flush) / `onUsage` (累加流末尾 usage)；返回的 `UpstreamResponse` 失败时直接透传上游 JSON 错误体，状态码沿用上游。计费 / 扣款 / `UsageRecord` 写入字段级与老 `GatewayController` 一致（私有方法 `calculateTokenCost` / `deductBalance` / `recordUsage` 当前重复一份保持新老完全独立，flag 切回 false 即秒回滚；老代码下线后再统一抽 `BillingHelper`）
- **`GatewayController` 三个入口加 flag 分支（约 +20 行）**：`chatCompletions`（在 isStream 分支前）、`embeddings`（在构造 url 前）`if (config('gateway.use_new_adapter')) return app(NewGatewayService::class)->handleXxx(...)`；`imageGenerations` / `imageEdits` 不动，flag 分支放在 `ProcessImageTask::handle()` 里（约 +60 行新增 `handleViaAdapter()` 私有方法 1:1 走新链路），所有老代码路径完整保留
- **`app/Models/ProviderCredential.php`**（约 +40 行）：凭证池模型，softDelete + `provider()` belongsTo，`api_key` 在 `$hidden` 里
- **`CloudProvider` model 扩展**：`fillable` 加 `config / capabilities / suspended_at / suspended_reason`；`casts` 加 `config: array / capabilities: array / suspended_at: datetime`；新增 `credentials()` hasMany 关联
- **`CloudProviderController`**：
  - `SUPPORTED_TYPES` 类常量白名单 `[openai, openai_compatible, azure, anthropic, gemini]`，store/update 校验 `'type' => 'in:'.implode(',', self::SUPPORTED_TYPES)`
  - store/update 接受 `config` / `capabilities` 数组字段（model array casts 自动序列化）
  - 新增 `recover(id, ?reactivate_credentials)` 方法（约 +30 行）：清 `suspended_at / suspended_reason`，可选同时把所有 invalid 凭证重置为 active
  - 新增 `health()` 聚合接口（约 +95 行）：单 SQL 拉 24h 内 `cloud_provider_metrics` 行，PHP 端按 provider 分组聚合 ok/fail/p99/最近错误，返回 `{ summary: { total, active, suspended, availability_24h, samples_24h, window_started_at }, providers: [{ id, name, type, status, suspended_at, suspended_reason, ok_24h, fail_24h, availability_24h, latency_p99_24h, latest_error, hourly: [{bucket_hour, ok_count, fail_count, latency_ms_p99}] }] }`
- **`app/Http/Controllers/ProviderCredentialController.php`**（约 +160 行）：凭证池 CRUD。`index($providerId)` 用 `$this->present()` 把 `api_key` mask 成 `前4 + *** + 后4` 形式输出；`store($providerId)` 创建凭证 + 入池；`update($id)` 改 name/weight/status/remark/api_key（空 api_key 保持不变）；`destroy($id)` softDelete 保留 UsageRecord 关联；`reactivate($id)` 重置 fail_count + status=active 救回失活 key
- **`app/Console/Commands/ProbeProviders.php`**（约 +180 行）：调度命令 `php artisan providers:probe [--id=N] [--no-suspend]`。遍历 active 且未 suspended 的 provider，按 `selectAdapter` + `selectCredential` 拿到 adapter + apiKey，调 `probeModels()` 探测（GET /models 不消耗 token），按当前小时桶 UPSERT 到 `cloud_provider_metrics`（`INSERT ... ON DUPLICATE KEY UPDATE` 累加 ok_count/fail_count + 覆盖 p50/p99）。`status='ok' / 'warning'` 都视为可用（warning 是中转屏蔽 /models 的常见情况），不计入连续失败；连续失败次数缓存在 `Cache::put('provider:probe_consecutive_fail:{id}', N, 6h)`，达 `probe_fail_suspend_threshold` 时 `forceFill(['suspended_at' => now(), 'suspended_reason' => '...'])`；同时清理 `metrics_retain_days` 之前的旧 metrics 行
- **`app/Console/Kernel.php` 注册调度**：`schedule->command('providers:probe')->cron('*/{$probeInterval} * * * *')->withoutOverlapping()->runInBackground()`，间隔从 config 读，钳制 1-60 分钟避免误填非法 cron
- **路由（`routes/api.php`）新增 7 条**：`GET /admin/cloud-providers/health`（**必须放在 /{id} 之前** 否则被字面量参数吃掉）、`POST /admin/cloud-providers/{id}/recover`（不打上游、无 throttle）、`GET|POST /admin/cloud-providers/{providerId}/credentials`、`PUT|DELETE /admin/credentials/{id}`、`POST /admin/credentials/{id}/reactivate`
- **前端 `Providers.tsx` 重构**（约 +200 行）：
  - `PROVIDER_TYPE_OPTIONS` 5 选项（OpenAI 兼容 / OpenAI 官方 / Azure / Claude / Gemini）+ `AUTH_STYLE_OPTIONS`（Bearer / Azure api-key / 查询参数）
  - `configToFormValue / formValueToConfig`：把 `config` JSON 双向转换。`extra_headers` / `extra_query` 在表单层用 `Form.List` 编辑成 `[{key, value}]` list，提交前压回 object（丢弃空 key 行）。`auth_style=bearer` / `verify_ssl=true` 等默认值不写入 config 保持体小
  - `capabilitiesToFormValue` 把 6 项 boolean 兜底为 form 可消费形式，老 provider 字段为 null 时全开
  - Modal 表单大改：基础字段不变，新增「高级设置」`Collapse.Panel`（鉴权方式 + Azure `api_version`（按 type 联动显示）+ 启用 SSL 验证 Switch + 代理地址 + 自定义 Headers Form.List + 自定义 query 参数 Form.List）+ 「能力清单」`Collapse.Panel`（6 个 Switch 默认全开）。表单宽度 560 → 680
  - 列表「操作」列加「凭证池」按钮（在「深测」与「编辑」之间），列宽 320 → 400
  - 编辑加载时调 `configToFormValue` / `capabilitiesToFormValue` 把后端 object 展平为 form 期望的扁平结构
- **前端 `components/ProviderCredentialsDrawer.tsx`**（约 +230 行）：独立抽屉组件，`mask={false}` 遵循项目「弹窗只阴影不遮罩」规则。表格列：ID / 名称 / Key（mask 显示）/ 权重 / 状态 Tag / 失败次数 Tag / 最近使用 / 最近错误 / 操作。操作含编辑（Modal Form）/ 重置（reactivate）/ 删除（Popconfirm 软删）。新增 / 编辑 Modal 字段：name / api_key（编辑模式留空保持不变）/ weight (InputNumber 1-65535) / status（仅编辑模式显示）/ remark
- **前端 `pages/Health.tsx`**（约 +260 行）：健康看板页。顶部 4 张 `Statistic` 卡片（服务商总数 / 活跃 / 已熔断 / 24h 整体可用率）。表格每行用 `recharts` 的 `BarChart` 画 24h ok/fail 堆叠迷你图（绿/红，缺失桶补 0 让横轴一致）；可用率徽章按 `≥99% 绿 / ≥95% 蓝 / ≥80% 橙 / <80% 红`；熔断行操作列出「恢复」+「完整恢复（同时重置凭证池）」。30s 自动刷新（探测器是 5 分钟 1 次，30s 足够）。挂在「AI 资源」分组下、紧跟「服务商」之后，菜单图标 `HeartOutlined`
- **前端 `services/api.ts`**：`providerApi` 加 `recover(id, reactivateCredentials)` / `health()`；新增 `credentialApi` 模块（list / create / update / delete / reactivate）

### 变更

- **`AdminLayout.tsx` 菜单**：「AI 资源」分组下「服务商」与「模型管理」之间插入「健康看板」（`/health`），同步更新 `pathToGroupKey` 反查表，保持子路由展开高亮逻辑一致
- **`App.tsx`**：`Providers` 之后注册 `<Route path="health" element={<Health />} />`

### 修复（同版本内多轮深度复查发现）

发版前共两轮深度复查，命中 9 个问题，全部已修。

- **[严重] `cloud_provider_metrics.bucket_hour` 字段从 `timestamp` 改成 `dateTime`**：MySQL 5.7 默认 `explicit_defaults_for_timestamp=OFF` 时，第一个 NOT NULL TIMESTAMP 列会被自动加 `DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`。每次 `INSERT ... ON DUPLICATE KEY UPDATE` 累加 ok_count/fail_count 时主键 `bucket_hour` 会被隐式改写成 NOW()，主键漂移、UPSERT 退化成新行、时间序列彻底废。`dateTime` 不会触发该隐式行为
- **[严重] `NewGatewayService::handleChat` 流式分支强制注入 `stream=true` + `stream_options.include_usage=true`**：与老 `GatewayController::handleStreamChat:262-263` 行为对齐。OpenAI 协议下只有 `include_usage=true` 才会在最后一条 chunk 附带 usage；新代码漏注入会导致流式调用永远 `totalTokens=0` → **流式 chat 全部免费、不扣 token、不写 UsageRecord**。后续 `CapabilityFilter` 按 `usage_in_stream` capability 决定是否保留（默认全开等价老行为）
- **[小不一致] `ProviderCredentialController::update` validator 的 `name` / `api_key` 字段补 `nullable`**：与 `store` 校验规则对称（前端不会主动传 null，但规则要一致）
- **[配置失效] `gateway.timeouts.deep_probe` 配置项实际未生效**：`ProviderProbe::probeChat` / `OpenAICompatibleAdapter::probeChat` 的 `$timeoutSeconds` 默认值原本硬编码 30，未读 config。改成 `?int = null` + 函数体内回落 `config('gateway.timeouts.deep_probe', 20)`（PHP 函数默认值不能写 `config()` 调用），让 `.env` 的 `GATEWAY_TIMEOUT_DEEP_PROBE` 真正生效
- **[并发安全] `GatewayRouter::markCredentialFailure` 改用 Eloquent `increment` 走原子 SQL `SET fail_count = fail_count + 1`**：原 `forceFill+saveQuietly` 在「先读再写」窗口中并发两次失败会互相覆盖导致漏计；新写法 `increment('fail_count', 1, [last_failed_at, last_error])` 单条 UPDATE 完成且原子，达阈值后再下发幂等的 `status=invalid` UPDATE
- **[流量黑洞] `NewGatewayService::handleStreamChat` 在 `httpCode=0` / 3xx 空档位也按失败处理**：原代码只处理 `[200,300)` 和 `>=400` 两个分支；`httpCode=0`（curl 连接失败 / DNS / refused / timeout，curl_exec 不抛异常仅返回 false）和 3xx 落入空档不写 UsageRecord 也不 `markCredentialFailure`，坏 key 在网络故障下永远不会自动 invalid。改成 `else` 分支统一处理三类失败
- **[UI 谎言修正] `capabilities.stream=false` 真正生效**：`NewGatewayService::handleChat` 早期插入流式能力门禁（`stream=true` + `cap.stream=false` 时直接返回 OpenAI 标准格式 400 错误体 `{error: {message, type, code: stream_unsupported}}`，避免「降级为同步响应」让客户端 SDK 抛 "expected SSE stream" 错误）；`CapabilityFilter::filter` 同时补一个 `stream=false` 兜底分支彻底剥 `stream` / `stream_options`，覆盖未来 `ProbeService` 等直接调 filter 的路径
- **[多 key 池子稳定性] `ProbeProviders` 失败归因区分凭证 vs Provider**：原本任何探测失败都计入 `Cache` 累积熔断计数，导致单坏 key（401/403）反复被 `pickLeastRecentlyUsed` 选中 → 6 次后整个 provider 被熔断（K2-K5 好的 key 也连坐）。改成按 `result->httpStatus` 分支：401/403 视为凭证问题 → `markCredentialFailure(credential, msg)`（让坏 key 累计阈值后自动 invalid）；其他错误视为 provider 整体问题保留原累积熔断逻辑。同时探测成功也调 `markCredentialSuccess` 清零 fail_count
- **[行为一致性] `CloudProviderController::testConnection` / `deepTest` / `fetchModels` 全部迁到走 `GatewayRouter + adapter` 链路**：原本走老 `App\Services\Provider\ProviderProbe`，**不应用** provider.config 的 `auth_style` / `extra_headers` / `extra_query` / `verify_ssl` / `proxy` 等高级配置；管理后台测试通过不代表真实流量调用通过（Azure provider 配 `auth_style=azure_api_key` 时尤其明显——测试用 Bearer 401 但实际能用）。迁移后三个测试入口与真实流量同链路，凭证池有 active 行优先用池子、空时回落 `provider.api_key`，输出格式通过 `ProbeResult::toArray()` 保持兼容前端契约。`ProviderProbe` 类保留供 `GATEWAY_USE_NEW_ADAPTER=false` 老链路兜底，本 Controller 不再引用

### 说明

- **改动文件清单**：
  - `backend/database/migrations/2026_05_09_100001_*.php`、`100002_*.php`、`100003_*.php`（新增）
  - `backend/config/gateway.php`、`backend/config/version.php`
  - `backend/app/Services/Gateway/`（整目录新增：Adapters / Contracts / Router / CapabilityFilter / NewGatewayService / RouteResult）
  - `backend/app/Models/CloudProvider.php`、`backend/app/Models/ProviderCredential.php`（新增）
  - `backend/app/Http/Controllers/CloudProviderController.php`（recover + health）、`backend/app/Http/Controllers/ProviderCredentialController.php`（新增）
  - `backend/app/Http/Controllers/GatewayController.php`、`backend/app/Console/Commands/ProcessImageTask.php`（flag 分支）
  - `backend/app/Console/Commands/ProbeProviders.php`（新增）、`backend/app/Console/Kernel.php`（schedule）
  - `backend/routes/api.php`（cloud-providers 组加 7 条路由）
  - `frontend/src/pages/Providers.tsx`（重构）、`frontend/src/pages/Health.tsx`（新增）
  - `frontend/src/components/ProviderCredentialsDrawer.tsx`（新增）
  - `frontend/src/services/api.ts`（credentialApi + providerApi.recover/health）
  - `frontend/src/App.tsx`、`frontend/src/layouts/AdminLayout.tsx`（菜单 + 路由）
- **零行为变化的保证**：发布后 `GATEWAY_USE_NEW_ADAPTER` 默认 false，所有 chat / embeddings / image 流量继续走 `GatewayController` 老代码路径；`CloudProvider.config` / `capabilities` 字段为 null 时 `CapabilityFilter::resolveCapabilities` 用 `default_capabilities` 全开兜底；凭证池为空时 `GatewayRouter::selectCredential` 回落 `provider.api_key`；`api_base normalize` 规则保持不变（store/update 继续走 `ApiBase::normalize`）
- **灰度切换**：在 `.env` 加 `GATEWAY_USE_NEW_ADAPTER=true` → 重启 PHP-FPM / Octane → 单服务商 24h 观察 UsageRecord 字段对账（prompt_tokens / completion_tokens / total_tokens / cost / status / request_id 与切换前等价）→ 全量。回滚：`.env` 改回 false 即秒生效（无需重新发版）
- **健康探测调度**：发布后管理员需要确认服务器 cron 已挂 `* * * * * php /www/wwwroot/agent-admin/artisan schedule:run >> /dev/null 2>&1`（宝塔→定时任务）。未挂的话「健康看板」长时间空白；挂上后约 5 分钟出第一行 metrics
- **典型受益场景**：(1) 客户接入 OpenAI o1 / gpt-5 推理模型时不再被 `max_tokens=1` 卡死，CapabilityFilter 自动改写参数；(2) 旧版兼容服务（部分 vLLM / 中转）不支持 `stream_options.include_usage` 时关掉 `usage_in_stream` 开关即可，不再被上游 400；(3) 单 provider 多 Key 自动轮询，限流后自动切下一把不影响业务；(4) 健康看板 24h 可用率曲线 + 自动熔断不让单家挂掉拖累整体；(5) `extra_headers` / `extra_query` / `verify_ssl` / `proxy` 字段为后续 Azure / 内网部署 / 跨境代理客户接入扫除障碍

---

## [1.2.19] - 2026-05-09

> 四组管理端 UX 优化合并发版：(1) 灵感广场列表加「按上传者搜索」独立入口，配合 1.2.16 起的桌面端用户上传功能定位作品来源更高效；(2) 权限管理列表的每条策略加「编辑」按钮，常见的"按用户改个 max_context_messages 数值"场景不用再走「删一条 + 重新批量添加」两步操作；(3) 计费规则列表加「按用户名 / 昵称 / 分组名搜索」，运维定位特定用户的计费规则不再需要先去用户管理查 ID 再回来按 ID 筛；(4) 订单管理对「已关闭 / 失败 / 已超时」三种无效订单加删除按钮，便于清理脏数据。**非 breaking、无 schema 变更、无 composer 依赖变更**。

### 新增

- **`InspirationController::index()` 加 `uploader_keyword` 查询参数**（约 +13 行）：在现有 `category_id` / `search`（搜标题/提示词）/ `status` / `is_visible` 之外新增独立搜索维度。后端实现：`where(function ($q) use ($k) { $q->where('uploader_nickname', 'like', "%{$k}%")->orWhereIn('uploader_user_id', function ($sub) use ($k) { $sub->select('id')->from('users')->where('username','like',"%{$k}%")->orWhere('nickname','like',"%{$k}%"); }); })`。**双轨匹配**：既搜 `inspirations.uploader_nickname` 快照（兼容上传后改昵称的用户），也通过子查询关联 `users.username` / `nickname` 拿当前最新昵称。`uploader_user_id` 在 1.2.16 已有 index，子查询走索引 OK
- **`Inspirations.tsx` 加 `uploaderKeyword` state + 搜索框**（约 +8 行）：第二个 `Input.Search` 紧跟在原「搜索标题/提示词」框之后，placeholder「按上传者昵称/用户名...」，提交触发 `loadItems` 重新拉
- **`Permissions.tsx` 加 `editing` state + `openEdit()` + `handleSave()` 编辑分支**（约 +60 行）：每行「操作」列原本只有「删除」，新增「编辑」按钮（套餐发放的策略 `r.source_plan_id` 非空时 `disabled`）。点击后 `setEditing(record)` + 解析 `policy_value`（兼容 JSON string / 原始值）+ 复用 Modal。Modal 标题分支：`editing ? '编辑策略 #${editing.id}' : '批量添加权限策略'`；Alert 文案分支；`user_ids` / `group_ids` / `policy_key` Form.Item 在 `editing` 非 null 时 `disabled`（防止改变唯一约束 `(target_type, target_id, policy_key)`）。`handleSave` 走 `permissionApi.update(editing.id, { policy_value: policyValue })`，后端 `PermissionController::update()` 早就存在且自带「`source_plan_id` 非空拒绝编辑」400 兜底。`onCancel` / 提交成功 / 顶部「批量添加策略」按钮 onClick 全部正确 `setEditing(null)` 防态遗漏
- **`BillingRuleController::index()` 加 `target_keyword` 查询参数**（约 +20 行）：外层 `where(function...)` 包两个 sub-where：(1) `target_type='user'` AND `target_id IN (SELECT id FROM users WHERE username LIKE OR nickname LIKE)`；(2) `target_type='group'` AND `target_id IN (SELECT id FROM user_groups WHERE name LIKE)`。**`target_type='default'` 的全局规则不参与 keyword 过滤**（按用户搜本来就不该出全局默认）。`users.id` / `user_groups.id` 都是主键，子查询走 PK
- **`Billing.tsx` 加 `Input.Search`**（约 +6 行）：filter 行原本只有「模型」下拉，新增 placeholder「按用户名 / 昵称 / 分组名搜索」的搜索框，`onSearch` 触发 `setParams({ ...params, target_keyword: v || undefined, page: 1 })`
- **`PaymentController::adminDestroy($id)` + `Route::delete('/admin/orders/{id}')`**（约 +30 行）：严格白名单 `[STATUS_CLOSED, STATUS_FAILED, 'expired']`，`derivedStatus()` 命中其一才允许 `$order->delete()`，否则 400「仅可删除无效订单（已关闭 / 失败 / 已超时）。当前状态：xxx」。**严格拒绝** `pending`（可能正在支付）/ `paid` / `refunded`（资金事件审计强制留档）。`PaymentOrder` 模型未启用 `SoftDeletes`，物理删除一行
- **`Orders.tsx` 加 `isInvalidOrder()` + `handleDelete()` + 操作列条件渲染**（约 +30 行）：`isInvalidOrder(row)` 用 `row.derived_status || row.status` 判断（pending 且过期 derived 为 'expired'），命中三种状态之一时操作列展示带 `DeleteOutlined` 的红色 Popconfirm。`Popconfirm.description = '仅删除订单记录，不影响用户套餐 / 余额'` 提前告诉运维删除范围。删除成功后若详情 Modal 正打开同一条订单则一并关闭，避免死引用；操作列宽度从 160 → 220、`fixed: 'right'` 横滚时也固定可见
- **`orderApi.delete` 加进 `services/api.ts`**（约 +1 行）：`(id: number) => api.delete('/admin/orders/${id}')`

### 变更

- **`Permissions.tsx` 顶部「批量添加策略」按钮 onClick 增加 `setEditing(null)`**（约 +1 行）：编辑过一条策略后再点新增按钮时，必须先清编辑态再 `form.resetFields()`，否则 form 里残留前一条的字段会让用户困惑
- **`Orders.tsx` 操作列宽度 + fixed**（约 +1 行）：从 `width: 160` 改为 `width: 220, fixed: 'right' as const`，三个按钮（详情 / 同步 / 删除）一行排开 + 横滚时固定右侧

### 说明

- **改动文件**：
  - `backend/config/version.php`：版本号 1.2.18 → 1.2.19
  - `backend/app/Http/Controllers/InspirationController.php`：`index()` 加 uploader_keyword 子查询
  - `backend/app/Http/Controllers/BillingRuleController.php`：`index()` 加 target_keyword 双子查询
  - `backend/app/Http/Controllers/PaymentController.php`：新增 `adminDestroy()` 方法
  - `backend/routes/api.php`：admin orders 组加 `DELETE /orders/{id}`
  - `frontend/src/pages/Inspirations.tsx`：加 uploaderKeyword state + 搜索框
  - `frontend/src/pages/Permissions.tsx`：加 editing state + openEdit + handleSave 分支 + 操作列编辑按钮 + Modal 禁用项
  - `frontend/src/pages/Billing.tsx`：filter 行加 target_keyword 搜索框 + Input 引入
  - `frontend/src/pages/Orders.tsx`：加 isInvalidOrder + handleDelete + 操作列条件渲染删除按钮
  - `frontend/src/services/api.ts`：orderApi 加 `delete` 方法
- **无 schema 变更**：纯应用层 + 配置层改动，`migrations` 列表与 1.2.18 一致
- **无 composer 依赖变更**：`composer.json` / `composer.lock` 不动
- **无 agent-build 配套要求**：本版本 4 项改动均在云控端自身闭环，与 agent-build 接口无交集；同期发布的 agent-build 0.3.8 是独立优化，两端**不强制**同步升级
- **删除订单的边界**：仅删 `payment_orders` 一行，不触碰已发放的 `user_plans` / `balance_logs` / 微信回调 `notify_payload`。回滚需要从 binlog 找回（已发布 zip 内已备好 `database/migrations/` 全量目录，schema 在 binlog 复原后可直接 reapply）。如果运维不慎删了「应该留」的订单（实际不可能，三种状态都是终态且无资金影响），损失仅限于该行的 `notify_payload` 审计记录
- **典型受益场景**：(1) 客户灵感广场积累几百条作品后想找某用户上传的所有作品，1.2.18 之前必须翻页肉眼搜，1.2.19 直接搜昵称命中；(2) 1.2.x 期间运维反馈「按用户调 max_context_messages 数值」频次很高，每次都得删旧策略 + 重新批量添加，1.2.19 一键编辑省 3 步；(3) 计费规则规模大时（数百条）按"找张三的规则"在 1.2.18 必须先去用户管理查 ID 再回来筛 ID，1.2.19 直接搜名字定位；(4) 测试期 / 客户掉单后 closed / failed 订单堆积，1.2.19 一键清理保留列表整洁

---

## [1.2.18] - 2026-05-09

> **1.2.17 hotfix**：1.2.17 的「云打包 → 我的信息」弹窗 changelog 描述声称"手机号必填 + 11 位中国大陆手机号校验 + 拒绝占位"，但实际三处代码都漏做了：前端 Form.Item 只配了 `max:30` 没 `required` 没 `pattern`、云控端后端 `owner_phone` 是 `nullable + max:30`、agent-build 后端同样 `nullable`。结果客户在弹窗里电话填单字符 `'2'` 也能保存（截图反馈）。1.2.18 把三处都做齐，并把 agent-build 的 `needs_completion` 计算逻辑也补上手机号合规校验，配套 agent-build 0.3.7+ 才能完整生效。**非 breaking、无 schema 变更、无 composer 依赖变更**。

### 修复

- **前端 `HistoryPage.tsx` 我的信息弹窗 — `owner_phone` Form.Item 加 `required` + 手机号 validator**（约 +15 行）：
  - 加 `{ required: true, message: '请输入手机号' }`，空值直接拦
  - 加自定义 `validator`：trim 后用 `/^1[3-9]\d{9}$/` 校验 11 位中国大陆手机号，不合规则 reject「请输入有效的 11 位中国大陆手机号」。trim 是为了让前导 / 末尾空格也算无效输入
  - Input 组件 `maxLength` 从 `30` 收紧到 `11`，防止用户误粘贴超长字符串
  - placeholder 从「选填，例如 13800138000」改为「请输入 11 位手机号，例如 13800138000」，明确传达"必填"语义
- **前端 `saveMyInfo` 调用 — 去掉 `|| null` 兼容分支**（约 +1 行）：1.2.17 提交时是 `owner_phone: values.owner_phone || null`（兼容选填语义），1.2.18 因为前端校验已确保非空 + 合规，提交体改为 `String(values.owner_phone || '').trim()`，把可能存在的前后空白再清一次给后端
- **云控端后端 `CloudBuildController::updateMyInfo()` Validator** （约 +12 行）：`owner_phone` 规则从 `['nullable','string','max:30']` 改为 `['required','string','regex:/^1[3-9]\d{9}$/']`。新增 6 条中文 messages（`'owner_phone.required' => '请输入手机号'` / `'owner_phone.regex' => '请输入有效的 11 位中国大陆手机号'` 等）。SDK 调用从 `$request->has('owner_phone') ? $request->input('owner_phone') : null` 简化为 `(string) $request->input('owner_phone')`（必填后无须 has 判断）

### 说明

- **改动文件**：
  - `backend/config/version.php`：版本号 1.2.17 → 1.2.18
  - `backend/app/Http/Controllers/CloudBuild/CloudBuildController.php`：`updateMyInfo()` Validator 规则 + messages 调整
  - `frontend/src/pages/CloudBuild/HistoryPage.tsx`：`owner_phone` Form.Item rules + Input maxLength + placeholder + saveMyInfo 调用
- **配套要求**：必须升级 agent-build 到 **0.3.7+**。agent-build 0.3.7 把 `updateMyInfo` Validator 同步收紧（前后端双校验，前端绕过也挡得住），并且把 `myInfo` 返回的 `needs_completion` 字段计算逻辑从「只看姓名」改为「姓名或手机号任一不合规即 true」，云控端 1.2.18 的「我的信息」按钮变红 + 「新打包」拦截会按完整合规性触发。仅升 1.2.18 不升 agent-build：前端校验已经能拦住正常用户，但 agent-build 端 `needs_completion` 仍只看姓名，存量站点手机号空着但姓名 OK 的情况下「新打包」不会被拦
- **存量站点行为变化**：升级 agent-build 0.3.7 后，`authorized_clients` 表里 `owner_phone` 不是 11 位手机号的所有站点（含 `null`、`'1'`、`'2'`、随便填几位）都会被 `needs_completion=true` 标记。这些站点的运维首次进云控端「云打包 → 打包记录」时：「我的信息」按钮变红 → 点「新建打包」会被弹窗拦下 → 提示先完善信息 → 填合规姓名 + 11 位手机号保存后即可恢复打包。这是预期的引导行为
- **回归原因复盘**：1.2.17 changelog 描述与代码实际行为脱节，是因为 changelog 写在代码完成前作为意图说明，但代码后续没补全 + 未做端到端校验测试就发版。1.2.18 起会在涉及 Form 校验类改动的发版前，必须复测一遍前端 Form Behavior + 后端 Validator 才能打包

---

## [1.2.17] - 2026-05-09

> 三组改进合并发版：(1) 左侧菜单重构为二级分组，常用入口收敛清晰；(2) 「云打包」历史页加「我的信息」管理入口，云控端管理员可直接查看 / 修改 agent-build 端记录的运维联系方式（owner_name / owner_phone），首次打包前若信息不全自动弹窗提醒；(3) 用户管理用户名 / 昵称字段规则全面收紧并与桌面端注册页 1:1 对齐（含字符集、长度、昵称全局唯一），同时把 1.2.x 中期被误删的「手机号」字段重新加回为选填项。**非 breaking、无 schema 变更、无 composer 依赖变更**。需要 agent-build 配套 0.3.6+ 才能用「我的信息」功能。

### 新增

- **左侧菜单二级分组（`frontend/src/layouts/AdminLayout.tsx`）**：原一字排开的 20+ 顶级菜单合并为 6 个 SubMenu + 2 个顶级。分组：`运营管理`（仪表盘、用户管理、用户分组、套餐管理、灵感广场、统计分析）/ `计费 & 订单`（计费规则、套餐订单、积分余额、兑换码、消费日志）/ `内容管理`（模型管理、提示词、知识库、自定义提供商、官网首页图）/ `客户端`（云打包请求、云打包历史、客户端管理、安装包文件）/ `财务`（支付配置、订单管理）/ `系统设置`（在线更新、官网设置、注册策略、系统设置 — 1.2.16 之前是 3 个顶级，1.2.17 合并）。Menu 用 `openKeys` / `selectedKeys` 受控，`useEffect` 监听 `location.pathname` 变化自动展开命中的 SubMenu，刷新页面 / 直接进 URL 都能保持菜单状态正确。约 +120 行
- **「我的信息」按钮 + 弹窗（`frontend/src/pages/CloudBuild/HistoryPage.tsx`）**：右上角加 `<IdcardOutlined />` 按钮（`needs_completion=true` 时按钮变红），点击打开 Modal（width 560 / `destroyOnClose`）。Modal 含 3 个字段：`授权域名`（只读，由 agent-build 端 VerifyDomainBinding 中间件按 Origin 头注入到 request attribute，云控端永远不可改 — 防篡改）、`姓名`（required + min:2 + max:100 + 拒绝占位 `'1'`）、`电话`（**required + 自定义 validator 内 trim 后用 `/^1[3-9]\d{9}$/` 校验 11 位中国大陆手机号**，自然拒绝任何不合规输入：空、空白、单字符占位 `'1'` `'2'`、长度不足 11 位等）。saveMyInfo 提交时 `String(values.owner_phone || '').trim()` 兜底再做一道。`maxLength={11}` 限制 input 输入长度防误填。约 +145 行
- **HistoryPage 进页自动 `loadMyInfo`**：`useEffect` 在挂载时与列表 `load` 并行调 `cloudBuildApi.myInfo()`，结果存到 `myInfoRef`（用 ref 避免触发额外 re-render）。后续「新建打包」/「重打」操作前会先校验 `myInfoRef.current.owner_name` / `owner_phone` 是否完整，缺失则不发请求、直接 `Modal.confirm` 提醒填「我的信息」并提供「立即填写」按钮一键打开 Modal。**这是 1.2.17 的核心改进**：云打包失败现场常因为 agent-build 端运维联系方式空缺导致客户提交后没人能回访；提前一步引导填写显著降低了客户「打包失败找不到人」的客诉
- **`CloudBuildController::myInfo()` + `GET /api/admin/cloud-build/my-info`**：透传 agent-build 的 `GET /api/build/my-info`。仅返回 `domain` / `owner_name` / `owner_phone` 三字段（白名单），其它字段（如 `created_at` / `id`）即使 agent-build 返了也丢弃。返回 200 + `{domain, owner_name, owner_phone}`，失败 502 + 透传 agent-build 错误文案。约 +35 行
- **`CloudBuildController::updateMyInfo()` + `PUT /api/admin/cloud-build/my-info`**：白名单只透 `owner_name` + `owner_phone` 两字段，**`domain` 永远被丢弃**（即便前端误传也不会传给 agent-build）。Validator 双重把关：`owner_name` `required + min:2 + max:100 + not_in:1`、`owner_phone` `required + regex:/^1[3-9]\d{9}$/`（与前端 Form validator 完全一致，前端绕过也挡得住）。所有 messages 中文化（"请输入手机号" / "请输入有效的 11 位中国大陆手机号" 等 6 条）。约 +50 行
- **`AgentBuildClient::getMyInfo()` + `updateMyInfo()`**：底层 SDK 加两个新方法。`updateMyInfo` 走 `PUT` 方法，给 `Http::call` 内部加了 PUT 分支支持。两个方法都用统一的 `domain_binding` 中间件路径，agent-build 端会按 client_id（即 token 对应的站点 ID）自动加载 `authorized_clients` 行，无须前端传 domain。约 +70 行
- **`InspirationController` 完整代码（1.2.16 已经发布的部分）+ 1.2.17 维护**：本版本只是把 1.2.16 引入的 `clientUpload` / `publicList` 状态过滤逻辑做了 review，没新增功能（保持现状不重复发布）

### 变更

- **`UserController::store()` 用户名规则 6-16 + 中英数下划线 + nickname 全局唯一**：1.2.x 之前 `username` 是 `min:3 max:50` 无 regex，1.2.17 起改为 `min:6 max:16 regex:/^[a-zA-Z0-9_\x{4e00}-\x{9fa5}]+$/u unique:users,username`；`nickname` 之前完全无校验，现在 `min:2 max:30` + 同字符集 + `unique:users,nickname`（**全局唯一**，避免桌面端用户上传灵感时出现昵称重复混淆）；同时把 1.2.x 中期不知哪版被误删的 `phone` 字段加回 `validator` + `User::create` 的 fillable，规则 `nullable string max:20`。所有 `messages` 全部中文化（13 条），如「用户名长度需 6-16 个字符」「该昵称已被使用」
- **`UserController::update()` 同步**：`username` 改为 `sometimes` + 同 store 规则，unique 排除自身（`unique:users,username,$id`，1.2.x 之前的 `regex:/^[a-zA-Z0-9_]+$/` 不允许中文是个 bug）；`nickname` 加 `unique:users,nickname,$id`；`fillable` 列表加回 `phone`（之前移除导致前端能传但后端永远丢，2 月以来一直被运维诟病）
- **`UserController::index()` keyword 搜索加 phone 字段**：之前只搜 `username` / `nickname` / `email`，1.2.17 起 phone 也参与搜索，与「加回 phone」字段保持一致
- **`AuthController::register()` 同步收紧**：与 `UserController::store()` 完全一致的规则。注册时 nickname 不传则默认用 username（保持原行为），但传了就必须满足 2-30 + 字符集 + unique
- **`Users.tsx` 表单 4 处调整**：(1) `username` Form.Item 规则改为 `{ min: 6, max: 16 }` + `pattern: /^[a-zA-Z0-9_\u4e00-\u9fa5]+$/`，placeholder「中文 / 英文 / 数字 / 下划线，6-16 位」；(2) `nickname` Form.Item 加规则 `{ min: 2, max: 30 }` + 同 pattern + placeholder 含「全局唯一」提示；(3) 加回 `phone` Form.Item（max 20，选填，placeholder「选填」）；(4) `email` Form.Item placeholder 加「选填」字样

### 修复

- **`AgentBuildClient::call()` 加 PUT 方法支持**：1.2.x 期间 SDK 只支持 GET / POST，新增 myInfo 接口需要 PUT，本次给底层 `match($method)` 分支补全 `'PUT' => $http->put(...)`，复用现有的签名 / token / timeout 逻辑。约 +3 行

### 说明

- **改动文件**：
  - `backend/config/version.php`：版本号 1.2.16 → 1.2.17
  - `backend/app/Http/Controllers/AuthController.php`：`register()` 校验规则全改 + 中文 messages
  - `backend/app/Http/Controllers/UserController.php`：`index()` keyword 加 phone；`store()` / `update()` 校验全改 + 中文 messages + phone 字段加回 fillable
  - `backend/app/Http/Controllers/CloudBuild/CloudBuildController.php`：新增 `myInfo()` / `updateMyInfo()` 代理方法
  - `backend/app/Services/CloudBuild/AgentBuildClient.php`：新增 `getMyInfo()` / `updateMyInfo()` 方法 + `call()` 加 PUT 分支
  - `backend/routes/api.php`：cloud-build 路由组内注册 `GET /my-info` + `PUT /my-info`
  - `frontend/src/services/api.ts`：`cloudBuildApi` 加 `myInfo()` / `updateMyInfo(payload)` 两个方法
  - `frontend/src/layouts/AdminLayout.tsx`：menu 重构为受控二级菜单 + 路由变化自动展开 SubMenu
  - `frontend/src/pages/Users.tsx`：4 处表单 Form.Item 规则与 placeholder 调整
  - `frontend/src/pages/CloudBuild/HistoryPage.tsx`：「我的信息」按钮 + Modal + `useRef` 缓存 `myInfo` + 拦截新打包前置校验
- **无 schema 变更**：纯应用层 + 配置层改动，`migrations` 列表与 1.2.16 一致，升级时 `php artisan migrate --force` 不会跑出新表 / 新字段
- **无 composer 依赖变更**：`composer.json` / `composer.lock` 不动
- **agent-build 配套要求**：「我的信息」功能依赖 agent-build 0.3.6+ 提供的 `GET / PUT /api/build/my-info` 接口；agent-build < 0.3.6 时云控端调用会收到 404 / 405，前端会展示中文错误「授权管理端不支持此接口，请升级 agent-build 至 0.3.6+」（透传 502 错误中带的提示）。两端建议同步发布
- **老数据兼容**：1.2.17 起 username 校验收紧，但**只有「编辑用户并提交保存」时才触发**，列表展示 / 查看 / 重置密码 / 启用禁用 / 删除均不受影响。已注册的不合规存量用户名（如 3-5 位、含连字符 `-`、含点号 `.`）继续可以正常登录、正常使用，运维只在确实要改这条记录的用户名时才需要先把它改成合规值。同样适用于 nickname unique：老数据中如果有重名，不动它就没事，碰一下保存才会触发 unique 校验
- **典型受益场景**：(1) 1.2.x 期间客户反复反馈「侧栏太长找不到入口」，二级菜单分组后顶层条目从 20+ 减到 8，常用功能（仪表盘、用户管理、灵感广场）一级直达，进阶配置（在线更新 / 官网 / 系统设置）合并到「系统设置」分组里；(2) 客户首次开通云打包后忘填运维联系方式 → 1.2.17 进 HistoryPage 自动加载 my-info，缺则按钮闪烁提醒填，提交打包前再次拦截校验，从源头杜绝；(3) 桌面端注册页与云控端用户管理校验规则不一致导致的「桌面端能注册的名字、云控端编辑就被拦」、「云控端建的用户桌面端登录正常但编辑不了」类边界问题彻底消除

---

## [1.2.16] - 2026-05-09

> 灵感广场审核体系上线 + 安装包面板聚合 + 注册策略扩展。本版本核心是给「灵感数据」加完整的「审核 + 显示开关 + 删除同步清存储」三件套，桌面端用户上传不再无门槛进灵感广场，运维多了批量管控能力；同时把 1.2.15 上线的「安装包文件管理」按用户反馈重做了聚合方式（避免误删 electron-updater 元信息文件导致更新链路断裂）。**含 schema 变更（一条 migration）**，首次升级时「在线更新」会自动跑 `php artisan migrate --force`，存量数据 default 通过 + 显示，桌面端列表零感知。

### 新增

- **`inspirations` 表加 `status` + `is_visible` 字段**：`database/migrations/2026_05_09_000004_add_audit_to_inspirations_table.php`。`status enum('pending','approved','rejected') default 'approved'` + `is_visible boolean default true` + 联合索引 `inspirations_audit_idx (status, is_visible)`（公开接口高频按这两个字段筛选）。default 全部给「通过 + 显示」，避免升级瞬间桌面端列表突然清空。`Inspiration` 模型同步加 `STATUS_PENDING/APPROVED/REJECTED` 常量、`fillable` 加新字段、`is_visible` cast 为 boolean
- **`InspirationController::approve()` + `POST /api/admin/inspirations/{id}/approve`**：通过审核单条，`status -> approved`，桌面端 publicList 立即可见（前提 is_visible=true）。约 +12 行
- **`InspirationController::reject()` + `POST /api/admin/inspirations/{id}/reject`**：拒绝单条，`status -> rejected`，桌面端不可见（无论 is_visible 如何），可后续删除释放存储。约 +12 行
- **`InspirationController::setVisibility()` + `PUT /api/admin/inspirations/{id}/visibility`**：切换显示开关（`{is_visible: bool}`）。即使 `status=approved`，`is_visible=false` 时桌面端也不显示（临时下架）。约 +20 行
- **`StorageService::delete($url)` + 三个私有 helper**：填补 1.2.x 期间的痛点：删除灵感记录只删数据库不删存储文件。新方法接受 cover_image 字段值（local 相对路径 / cos 完整 URL / CDN 自定义域名），按当前 `storage_type` 后端尝试删除，幂等（404 视为成功），失败仅记 warning 不抛异常。COS 走 V5 签名 DELETE（复用 `buildCosAuthorization`，timeout 15s）。约 +110 行
- **`InspirationController::destroy()` / `batchDestroy()` 同步清存储**：删除前调 `StorageService::delete($item->cover_image)`。批量删除走「先取出 cover_image 列表 → 逐个 delete → 再批删数据库」三步式
- **`InspirationController::update()` 替换 / 移除封面时清旧文件**：`hasFile('cover_image')` 时先存新封面 → 比对新旧路径不同则删旧；`remove_cover=1` 时直接删旧文件 + 数据库置空
- **`SystemSetting::ALLOWED_KEYS` 加 `register_default_inspiration_uploader => bool`**：注册策略「新用户默认权限」。`AuthController::register` 在 `User::create` 前读取此 key，true 则新用户自动 `inspiration_uploader=true`，省去运维一个个开通的麻烦
- **`SystemSetting::ALLOWED_KEYS` 加 `inspiration_skip_audit => bool`**：灵感免审开关。`InspirationController::getConfig` 返回此字段（与 `source` 一起），`updateConfig` 改为增量更新（两个字段都可选，传哪个改哪个，不会因为另一个未传被误重置）。`clientUpload` 创建灵感时按此 key 决定初始 `status`：true → `approved`、false → `pending`
- **前端 Settings.tsx「注册策略」Tab 加「新用户默认权限」Card**：含 Alert 说明「已注册存量用户不受影响，需在用户管理手动调整」+ Switch「默认开通灵感大王」。约 +20 行
- **前端 Inspirations.tsx 状态 + 显示双列**：「状态」列按 `STATUS_TAG` 渲染 Tag（gold/green/red）；「显示」列 Switch（rejected 时禁用）。表格 `scroll={{ x: 1400 }}` 适配 9 列宽度
- **前端 Inspirations.tsx 操作列加「通过 / 拒绝 / 重新通过」按钮**：仅 `status=pending` 时显示「通过」「拒绝」一对；`status=rejected` 时显示「重新通过」单按钮；删除按钮永远存在，二次确认文案明确「将同步删除封面图片文件（本地或云存储），无法恢复」
- **前端 Inspirations.tsx 顶部 Card 加「免审」Switch**：与「数据源」Switch 同行，分隔符 `|` 隔开。开 → 桌面端用户上传后直接审核通过；关 → 走审核流。`updateConfig` 走增量更新接口，与 source 互不影响
- **前端 Inspirations.tsx 状态筛选 Select**：与「按分类筛选」并列，options 三选一（待审核 / 已通过 / 已拒绝）

### 改进

- **「安装包文件管理」按主文件聚合（重做 1.2.15 的零散列表）**：1.2.15 上线后用户反馈零散显示 `latest-mac.yml` / `localagent-0.5.9.dmg` / `localagent-0.5.9.dmg.blockmap` 三行容易误删 electron-updater 元信息。1.2.16 起：
  - **`CloudBuildController::listInstallers()` 重写**：扫描时分主桶（`.exe`/`.dmg`）和副桶（`.blockmap`），按主文件名配对，`.yml`/`.yaml` 完全跳过（仅计入 `total_size` 不展示，避免运维误操作把更新链路打断）。每条返回 `{filename, platform, primary_size, blockmap_filename, blockmap_size, size, mtime, linked_build}`
  - **`CloudBuildController::deleteInstaller()` 后缀白名单铁律**：仅允许 `.exe`/`.dmg` 主文件，`.yml`/`.yaml` 返 403「元信息文件禁止删除」+ `.blockmap` 返 403「随主安装包一起删除」。删主文件后 best-effort 同步 unlink 同名 `.blockmap`，返回 `deleted: [...]` 数组让前端能展示完整删了哪些文件
  - **前端 HistoryPage 安装包 Modal 重做**：列定义改为「安装包（主文件名+下方灰字 blockmap 文件名）/ 平台（Windows blue / macOS purple）/ 总大小（主+blockmap 合计，Tooltip 拆分明细）/ 修改时间 / 关联打包 / 删除」。删除二确文案明确「将一并删除：xxx.exe（90 MB）+ xxx.exe.blockmap（98 KB），无法恢复」
- **「天阙支付」Card 标题改为「天阙支付（随行付）」**：原标题「（聚合支付）」语义偏抽象，运维反馈「随行付」对应公司具体合作渠道更直观

### 说明

- **改动文件**：
  - `backend/database/migrations/2026_05_09_000004_add_audit_to_inspirations_table.php`：**新建** schema migration
  - `backend/app/Models/Inspiration.php`：状态常量 + fillable 加 status / is_visible + casts
  - `backend/app/Models/SystemSetting.php`：`ALLOWED_KEYS` 加 `register_default_inspiration_uploader` / `inspiration_skip_audit` 两个 bool key
  - `backend/app/Services/StorageService.php`：新增 `delete()` + `extractObjectKey()` + `deleteFromLocal()` + `deleteFromCos()`，加 `Log` facade 导入
  - `backend/app/Http/Controllers/AuthController.php`：`register()` 读 `register_default_inspiration_uploader` 决定新用户 `inspiration_uploader` 字段
  - `backend/app/Http/Controllers/InspirationController.php`：`getConfig` 返回 `skip_audit`、`updateConfig` 增量更新、`index` 加 status/is_visible 筛选、`store` 默认 approved+visible、`update` 替换/移除封面时清旧文件、`destroy`/`batchDestroy` 同步删存储、`clientUpload` 按 skip_audit 决定 status、`publicList` 强制 `status=approved AND is_visible=true`，新增 `approve` / `reject` / `setVisibility`
  - `backend/app/Http/Controllers/CloudBuild/CloudBuildController.php`：`listInstallers` 重写为按主文件聚合，`deleteInstaller` 加后缀白名单 + 联动删 blockmap
  - `backend/routes/api.php`：注册 `POST /admin/inspirations/{id}/approve` / `/reject` + `PUT /admin/inspirations/{id}/visibility`
  - `frontend/src/services/api.ts`：`inspirationApi` 加 `approve` / `reject` / `setVisibility`，`updateConfig` 类型扩为 `{source?, skip_audit?}`
  - `frontend/src/pages/Inspirations.tsx`：interface 加 status/is_visible、`STATUS_TAG` 常量、状态/显示两列、状态筛选 Select、操作列加通过/拒绝/重新通过按钮、删除二确含存储提示、顶部 Card 加免审 Switch
  - `frontend/src/pages/CloudBuild/HistoryPage.tsx`：安装包 Modal 列重做（聚合渲染）+ 删除二确含 blockmap 联动提示
  - `frontend/src/pages/Settings.tsx`：注册策略 Tab 加「新用户默认权限」Card；天阙支付 Card 标题改文案
- **schema 变更**：`inspirations` 表加两列 + 一个联合索引。**default 'approved' + true**，存量数据零感知。在线更新自动 `php artisan migrate --force`，无需运维介入
- **composer 依赖变更**：无（`composer.json` / `composer.lock` 不动）
- **存储后端兼容**：`StorageService::delete` 同时支持 local（`unlink` `public_path()` 拼接路径）和 cos（V5 签名 DELETE，幂等：404 视为成功）。CDN 自定义域名 URL 也能正确反推 object key。删除失败仅记 warning，业务上「数据库记录已删但文件未清掉」比「文件没了但记录还在」更可恢复
- **典型受益场景**：(1) 灵感广场不再是「桌面端开了灵感大王权限就能任意上传内容」的无门槛入口，运维有了完整管控；(2) 内容质量审核 + 临时下架两个动作分离（双字段设计），运营策略灵活；(3) 删除灵感记录会同步清掉封面图片，磁盘 / 对象存储不再累积孤儿文件；(4) 1.2.15 安装包面板的零散展示痛点解决，运维不会再误删 latest.yml 导致桌面端在线更新失效；(5) 注册时默认开通灵感大王，省掉运维逐个用户开通的工作量；(6) 桌面端「灵感大王」用户体验场景变多：免审开关让特定运营场景（如内测期、活动期）下用户上传可以即时生效

---

## [1.2.15] - 2026-05-09

> 云打包记录运维体验升级。新增「清空无效记录」「强制取消（仅本地）」「安装包文件管理」三组运维能力，解决 1.2.x 期间运维反复反馈的痛点：cancelled / failed 历史记录无法批量清理、远端 agent-build 卡死时排队中任务无法本地解锁、`public/updates/` 下安装包文件不断累积无可视化清理入口。同时给「云打包请求页」应用名称字段加文本提示，减少含空格 / 特殊符号导致的失败。**非 breaking、无 schema 变更、无 composer 依赖变更**。

### 新增

- **`CloudBuildController::cleanupInvalid()` + `DELETE /api/admin/cloud-build/invalid`**：批量清理 `cancelled` / `failed` 状态的 `cloud_builds` 记录。逻辑：先扫一遍待删行的 `stored_path`（兜底 cancelled / failed 但仍残留 `public/updates/` 文件的极端场景），逐个 `unlink` 真实文件（路径必须以 `updates/` 开头 + 拒绝 `..` 越权），再 `whereIn(['cancelled','failed'])->delete()` 清记录。返回 `{records_deleted, files_deleted}`。约 +30 行
- **`CloudBuildController::cancel()` 加 `force=true` 分支**：原 `cancel` 必须先调 `AgentBuildClient::cancel(buildId)` 通知远端、远端 200 才本地标记 cancelled。在 agent-build 服务不可达 / GitHub Actions workflow 卡死等场景下，本地 `queued` / `building` 任务永远清不掉，新提交又被「同站点已有进行中任务」逻辑挡住。新增 `force` 参数：`request->boolean('force', false)` 命中即跳过远端调用直接 `update(['status'=>'cancelled', 'error_message'=>'管理员强制取消（远端任务可能仍在执行，未通知打包平台）'])`，让管理员能立即解锁。`finished_at` 也会写当前时间。约 +15 行
- **`CloudBuildController::listInstallers()` + `GET /api/admin/cloud-build/installers`**：扫 `UpdateDirService::updatesBaseDir()`（默认 `public/updates/`），列出全部直接文件（不递归），按 mtime 倒序返回 `{filename, size, mtime, kind, linked_build}`。`kind` 按后缀分类（`exe` / `dmg` / `blockmap` / `yml` / `other`）；`linked_build` 通过 `stored_path = 'updates/' . filename` 反查 `cloud_builds` 拼出 `{build_id, app_name, app_version}`。Response 还附带总占用 `total_size` 和 base 目录的绝对路径供前端展示。约 +55 行
- **`CloudBuildController::deleteInstaller()` + `DELETE /api/admin/cloud-build/installers?filename=xxx`**：按文件名删除 `public/updates/` 下指定文件。`filename` 经 `basename()` 清洗 + 严格白名单字符 `^[A-Za-z0-9._-]+$` 校验，防路径穿越。`unlink` 成功后同步 `cloud_builds` 表把 `stored_path = 'updates/{filename}'` 的行的 `stored_path` 置 null（保留记录、仅清路径，便于追溯历史 + 详情页不会再渲染失效下载链接）。约 +35 行
- **`routes/api.php:233-235` 注册 3 个新字面量路由**：`/invalid` / `/installers`（GET + DELETE）必须在 `/{buildId}` 动态路由**之前**注册，否则会被吃掉报 `cloud_build_not_found`。注释明确该铁律
- **`HistoryPage.tsx` 顶部新增「清空无效记录」+「安装包」按钮**：清空按钮带 Popconfirm 二次确认 + danger okButton 红色高亮 + loading 状态；安装包按钮 `<AppstoreOutlined />` icon，点击 `openInstallers()` 打开 Modal 并立即调 `loadInstallers()`
- **`HistoryPage.tsx` 操作列加「强制取消」icon 按钮**：仅在 `status` 为 `queued` / `building` 时与原「取消」按钮并列显示，`<ThunderboltOutlined />` 闪电 icon + Tooltip「强制本地取消（不通知打包平台）」+ Popconfirm 警告文案「不通知打包平台，直接把本地状态置为「已取消」。仅在远端不可达或任务卡死时使用，远端可能仍在执行。」操作列宽从 `width: 160` 调到 `width: 200` 容纳第三个按钮
- **`HistoryPage.tsx` 内联 Modal「安装包文件管理」**：标题「安装包文件管理」、`width: 920`、`mask={false}`（遵循项目规则「弹窗只加阴影不要背景遮罩」）、`destroyOnClose`。顶部展示安装包目录绝对路径 + 总占用 Tag + 刷新按钮；Table 列：文件名（monospace 等宽字体）/ 类型（按 kind 着色 Tag：Windows blue / macOS purple / blockmap default / 元信息 gold）/ 大小（fmtSize）/ 修改时间 / 关联打包（带 build_id Tooltip + `app_name app_version` Tag，无关联显示「无关联」secondary 文本）/ 删除按钮（Popconfirm + 对 yml 类型的特殊警告文案：删除后桌面端在线更新检查将无法识别已落盘的安装包）。删除成功后 `loadInstallers()` + `load()` 同步刷新主列表
- **`services/api.ts::cloudBuildApi`**：`cancel` 签名加 `force = false` 默认参数（`api.post('.../{buildId}/cancel', { force })`）；新增 `cleanupInvalid()` / `listInstallers()` / `deleteInstaller(filename)` 三个 method（DELETE 请求用 `api.delete('...', { params: { filename } })` 走 query param）
- **`RequestPage.tsx` 应用名称字段加文本提示**：`Form.Item` 的 `extra` 从单行字符串字面量改为 React Fragment 节点（`<>...<br />名称不可以含有空格和特殊符号</>`），追加第二行提示。客户在「云打包」页面提交前能看到限制说明，减少 agent-build 端 `app_name` 不合法导致的失败 + 客户提交后的「为什么失败」追问

### 改进

- **`public/updates/` 物理目录自治**：在此之前，运维只能 SSH 到服务器手工 `ls /www/wwwroot/.../public/updates/ && rm xxx.exe` 释放空间，新增「安装包」面板让管理员在 Web 后台自助清理。删除单个文件时 `cloud_builds.stored_path` 会同步置 null，下次客户在桌面端检查更新时如果该 `latest.yml` 仍指向已删除的 `.exe`，桌面端原有的 404 兜底逻辑（1.2.6 起）会触发重下载请求 → `CloudBuildPullService::pullOne` 重新落盘
- **「同站点已有进行中任务」死锁的兜底入口**：1.2.5 已有 agent-build 返 404 → 本地标记 cancelled 的 fail-safe，但 agent-build 不返 404（如服务挂掉、超时、502）时本地任务仍卡死。「强制取消」明确告诉管理员这是「跳过远端通知」的快速通道，文案标注「远端可能仍在执行」让用户对双跑风险知情

### 说明

- **改动文件**：
  - `backend/app/Http/Controllers/CloudBuild/CloudBuildController.php`：`use UpdateDirService` + `cancel()` 签名加 `Request $request`、新增 force 分支 + 追加 `cleanupInvalid()` / `listInstallers()` / `deleteInstaller()` 三个方法（共 +135 行）
  - `backend/routes/api.php`：cloud-build 路由组内、`/{buildId}` 之前插入 3 行（DELETE /invalid + GET /installers + DELETE /installers）
  - `frontend/src/services/api.ts`：`cloudBuildApi.cancel` 加 force 参数 + 新增 3 个 API method（约 +6 行）
  - `frontend/src/pages/CloudBuild/HistoryPage.tsx`：imports（Modal + 5 个 icon）+ `InstallerFile` interface + `INSTALLER_KIND_TAG` 常量 + 5 个新 state + 4 个新 handler（cleanupInvalid / loadInstallers / openInstallers / removeInstaller，cancel 改 force 签名）+ 顶部 Space 加 2 个按钮 + 操作列加强制取消 + 末尾 Modal（约 +180 行）
  - `frontend/src/pages/CloudBuild/RequestPage.tsx`：`Form.Item.extra` 从字符串改 Fragment 节点（约 +6 行）
- **无 schema 变更**：纯应用层改动，`cloud_builds` 表结构未动；migration 列表与 1.2.14 完全一致
- **无 composer 依赖变更**：`composer.json` / `composer.lock` 不动
- **典型受益场景**：(1) 运维在 agent-build 服务故障期间提交的 queued 任务卡了几个月，升级后两次点击即可清理；(2) 服务器磁盘吃紧时不再需要 SSH 进去 `du -sh public/updates/*` 排查、Web 后台直接看到总占用 + 各文件大小一键删；(3) 客户在云打包页输入「我的 智能助手」（带空格）提交后被 agent-build 拒，提示文案明确告知不能含空格

---

## [1.2.14] - 2026-05-09

> 紧急修复版：修正 1.2.x 系列引入的「桌面端登录被拒」回归。`AuthController::login` 在通用 `/api/auth/login` 接口里强制 `role !== 'admin'` 拦截，但桌面端 Electron 应用与管理后台 React 共享同一个登录端点，导致所有非 admin 用户在桌面端登录被 403。修复采取「登录接口放开 + 管理后台前端 role 守门 + 后端 admin 路由 AdminOnly 中间件兜底」三层架构。**非 breaking、无 schema 变更、无 composer 依赖变更**。

### 修复

- **`AuthController::login` 移除 admin 角色拦截**：1.2.x 某版本（具体版本号待考古）在 `login` 内 `if ($user->status !== 'active')` 之后追加了 `if ($user->role !== 'admin') return 403 '该账号无权访问管理后台'` 的硬性拦截，意图是阻止普通用户登录管理后台。但 `/api/auth/login` 是公开端点，桌面端 Electron 应用 `src/renderer/src/utils/cloud-api.ts` 与管理后台 React `frontend/src/services/api.ts` 共用同一个 path，导致所有 `role=user` 账号在桌面端登录被一并 403。1.2.14 起将该拦截块移除，登录只校验 status active，所有 active 用户都能正常获取 JWT。约 -4 行（控制器代码）+ 2 行注释（说明 role 校验交由前端 + admin 路由中间件兜底）

### 改进

- **管理后台前端 `Login.tsx` 拿到 user 后做 role 守门**：`pages/Login.tsx::onFinish` 在 `await authApi.login(values)` 成功后，先判断 `data.user?.role !== 'admin'`，命中则 `message.error('该账号无权访问管理后台')` 并 `return`，**不调** `setToken` / `setUser`，普通用户的 JWT 不会落到 localStorage。原拦截语义完整保留在管理后台侧，且体验更好（错误从「网络层 403」变为「业务层友好提示」）。约 +5 行
- **admin API 安全性双保险**：即便普通用户绕过前端拦截拿到 JWT（如直接 curl 调登录接口），所有 `/api/admin/*` 路由由 `routes/api.php:94` 的 `Route::middleware('admin')->prefix('admin')` 即 `AdminOnly` 中间件兜底（`auth()->user()->role !== 'admin'` 直接 403），admin 数据完全不可触达；普通用户能调的只有 `/client/*` 与 `/auth/*`，与桌面端能力一致

### 说明

- **改动文件**：
  - `app/Http/Controllers/AuthController.php`：`login()` 移除第 218-221 行的 `role !== 'admin'` 拦截块，替换为说明注释
  - `frontend/src/pages/Login.tsx`：`onFinish` 内 `setToken` / `setUser` 之前增加 role 守门
- **无 schema 变更**：纯逻辑修复，无 migration、无 `users` 表字段调整
- **无 composer 依赖变更**：`composer.json` 不动
- **典型受益场景**：(1) 1.2.x 期间任何尝试在桌面端登录失败的 `role=user` 普通用户，升级后立即恢复正常登录；(2) admin 账号原本就能正常登录两端，升级后行为不变；(3) 普通用户误登管理后台时收到清晰中文提示而不是网络 403，体验更友好
- **回归原因复盘**：登录接口被多个客户端共享时，**不应在登录接口本身做客户端类型 / 角色限制**，应当下沉到各客户端前端 + 各 API 路由组的中间件去做。本次修复也确立了这条架构原则

---

## [1.2.13] - 2026-05-09

> 紧随 1.2.12 的小版本改进：腾讯云 COS 配置体验拆分。1.2.12 让运维直接在 `cos_bucket` 字段里填整段「name-APPID」，部分用户误把 APPID 单独填入 bucket 字段导致 `upload_failed` 静默失败。1.2.13 起把 Bucket 桶名前缀与 APPID 拆为两个独立字段，运行时由 `StorageService::resolveCosBucketFqn` 自动拼接为 `bucket-APPID` 作为 host 前缀。**非 breaking、向后兼容旧填法、无 schema 变更**。

### 新增

- **`SystemSetting::ALLOWED_KEYS` 加 `cos_app_id => 'string'`**：腾讯云账号 APPID（10 位数字），与 `cos_bucket` 一起在运行时拼接为完整 host 前缀。无需 migration（key-value 表新 key 即开即用）

### 改进

- **`StorageService::resolveCosBucketFqn(array $cfg): ?string` 新 helper**：兼容两种填法：(1) 新（推荐）`cos_bucket = 桶名前缀` + `cos_app_id = APPID`，运行时拼为 `bucket-APPID`；(2) 旧 `cos_bucket = name-APPID` 整段（向后兼容）。检测规则：`preg_match('/-\d+$/', $bucket)` 命中视为已含 APPID 后缀的旧格式直接用；否则若 `cos_app_id` 非空就拼接；都没有返回 null。`uploadToCos` 与 `testCos` 调用点统一切换到 helper，避免 host 拼接逻辑散落多处。约 +30 行 / -2 行
- **`StorageService::testCos` 新错误码**：bucket 格式无法构造合法 host 时返回明确文案「Bucket 名格式不合法：需填写「桶名」+「APPID」两个字段，或在 Bucket 字段中直接填入完整的「bucket-APPID」格式」，原本静默 null 错误升级为可读诊断
- **`StorageService::loadCosConfig` 返回结构扩展**：return 数组新增 `app_id` 键（同时保留兼容字段），调用方可获取独立 APPID 配置
- **前端「系统设置 → 资源存储」Tab UI 拆分**：原「地域 / 存储桶名」两字段同行，1.2.13 起改为「地域 / 存储桶名 / APPID」三字段同行。Bucket 输入框 placeholder 从 `bucket-name-1234567890` 改为 `my-files`，tooltip 引导只填桶名前缀；新增 APPID 输入框 placeholder `1234567890`，tooltip 说明从「腾讯云控制台 → 账号信息」查看，与桶名拼接为访问域名。约 +10 行

### 说明

- **改动文件**：
  - `app/Models/SystemSetting.php`：`ALLOWED_KEYS` 加 `cos_app_id` 一行
  - `app/Services/StorageService.php`：`loadCosConfig` 加载 `cos_app_id`，新增 `resolveCosBucketFqn` helper，`uploadToCos` / `testCos` 调用点改用 helper
  - `frontend/src/pages/Settings.tsx`：`Settings` 接口加 `cos_app_id`，资源存储 Tab 表单拆分输入框 + 文案引导
- **无 schema 变更**：`SystemSetting` 是 key-value 表，新增 `cos_app_id` key 仅需扩白名单，无 migration
- **向后兼容**：1.2.12 时期已在 `cos_bucket` 字段直接填入完整「name-APPID」格式的客户站点，升级到 1.2.13 后**无需任何配置调整**，`resolveCosBucketFqn` 会自动识别已含 APPID 后缀的旧格式
- **典型受益场景**：(1) 新装站点配置 COS 时不再需要看文档拼接「name-APPID」，跟着 UI 上的字段提示一步一步填即可；(2) 部分用户误把 APPID（如 4 位数字）当成 bucket 名导致 `upload_failed` 静默失败，1.2.13 起测试连接会立即给出「Bucket 名格式不合法」明确诊断

---

## [1.2.12] - 2026-05-09

> 三大功能聚合版：灵感数据管理（管理后台 CRUD + 桌面端自定义数据源）、腾讯云 COS 对象存储（StorageService 支持 local/cos 双模式 + 系统设置切换）、灵感大王权限（用户级 boolean 字段 + 桌面端用户上传到灵感广场 + 上传者昵称快照）。**非 breaking、含 3 个新 schema migrations、含完整前后端业务变更**。

### 新增

- **灵感数据管理**：新建 `Inspiration` / `InspirationCategory` 两张表（migration `2026_05_09_000001_create_inspiration_tables`）+ 模型 + 公开接口 + admin CRUD。`InspirationController` 完整路由：admin 端 `/admin/inspirations`（GET/POST/PUT/DELETE/batch-delete）+ `/admin/inspirations/categories`（CRUD）+ `/admin/inspirations/config`（数据源切换 default ↔ custom），公开端 `/public/inspiration/list` / `/public/inspiration/categories` / `/public/inspiration/config` 供桌面端无登录拉取。`SystemSetting.inspiration_source` 控制数据源（default = 百度文心默认 / custom = 云控端自定义）。前端管理后台 `pages/Inspirations.tsx` 含分类管理 Modal + 灵感卡片管理 + 拖拽排序（`sort_order` 字段）。封面图通过 `StorageService::upload($file, 'inspirations', $filename)` 上传，本地或 COS 自动适配
- **腾讯云 COS 对象存储**：`app/Services/StorageService.php` 新建为统一存储入口，支持 `local` / `cos` 双模式，由 `SystemSetting::storage_type` 控制运行时切换。COS 模式依赖 `qcloud/cos-sdk-v5` composer 包，配置项含 `cos_secret_id` / `cos_secret_key` / `cos_region` / `cos_bucket` / `cos_cdn_domain`（CDN 自定义域名可选）。所有现有图片上传调用点（`InspirationController` 灵感封面、`HomepageController` 官网截图、`CloudBuildIconController` 云打包图标）已统一切换到 `StorageService::upload()`。前端「系统设置」页新增「资源存储」Tab，含模式 Segmented + 4 字段表单 + 「测试连接」按钮（`SettingController::cosTest` 实际向 COS 创建测试对象再立即删除验证密钥有效性）
- **灵感大王权限**（本版重点）：`users` 表新增 `inspiration_uploader BOOLEAN DEFAULT 0`（migration `2026_05_09_000002_add_inspiration_uploader_to_users_table`，带索引）。`User.php` 加 `$fillable` + `$casts` 类型转换。`UserController::store` / `update` 加 `'inspiration_uploader' => 'nullable|boolean'` 校验并显式 `$user->inspiration_uploader = (bool) $request->boolean('inspiration_uploader')` 写入。新增 `UserController::batchSetInspirationUploader(Request)` 批量接口（POST `/admin/users/batch-set-inspiration`，`{ ids: int[], inspiration_uploader: bool }`，单条 SQL `UPDATE users SET inspiration_uploader=? WHERE id IN (...)` + ids 非空校验 + 200 条上限）。`ClientController::myPermissions` 在 admin policies 合并结果末尾追加 `'inspiration_uploader' => (bool) $user->inspiration_uploader`，让桌面端通过 `/client/permissions` 现有通道拉取。前端 `pages/Users.tsx` 编辑 Modal 加 Switch 字段 + 表格新增「灵感大王」Tag 列 + 顶部 `Dropdown` 批量按钮（开启 / 关闭，Popconfirm 二次确认）+ `userApi.batchSetInspirationUploader(ids, value)` API 封装
- **桌面端用户上传创作到灵感广场**：`InspirationController::clientUpload(Request)` 新接口（POST `/client/inspirations`，`auth.jwt` + 控制器内 `inspiration_uploader` 二次校验，`throttle:30,1` 限流）。校验规则：`category_id`(exists) + `title`(max 100) + `prompt_lang`(in cn/en) + `prompt_text`(max 5000) + `cover_image`(file/png/jpeg/webp/max 5MB)。复用私有 `uploadFile($request->file('cover_image'))` → `StorageService::upload`。按 `prompt_lang` 把 `prompt_text` 写入 `prompt_cn` 或 `prompt_en`，另一字段空。桌面端主进程新建 `src/main/services/cloud-inspiration.ts` 服务：拼 `getDataDir() + result_path` 读字节、用 Node 20+ 原生 `FormData` + `Blob` 组装 multipart、`fetch` 带 Bearer token POST 到 `/client/inspirations`、错误码分支映射（401/403/422/其它）。注册 IPC `cloudInspiration:upload` + preload `window.api.cloud.uploadInspiration()` 暴露给渲染端。新建 `components/UploadInspirationDialog.vue` 弹窗（标题输入 max 100 + 分类下拉挂载时拉 `cloudPublic.listInspirationCategories()` + 提示词语言 Radio + 提示词只读预览 + 参考图警示 + 仅阴影无遮罩 + 点击外部关闭 + 错误内联提示）。`MyCreationsView.vue` 详情弹窗 Actions 区末尾追加「分享原提示词」/「分享优化后提示词」两按钮，由 `cloudAuth.permissions.inspiration_uploader && detailItem.result_path && (prompt|revised_prompt)` 共同控制可见
- **灵感作品上传者昵称快照**：`inspirations` 表新增 `uploader_user_id BIGINT UNSIGNED NULL`（FK `users.id` ON DELETE SET NULL + index）+ `uploader_nickname VARCHAR(50) DEFAULT ''`（migration `2026_05_09_000003_add_uploader_to_inspirations_table`）。`Inspiration.php` 加 `$fillable`。`InspirationController::clientUpload` 创建时写入 `uploader_user_id => auth()->id()` + `uploader_nickname => $user->nickname ?: $user->username`（昵称为空时回退用户名）。`publicList` 改用 `collect($paginated->items())->map(unset 'uploader_user_id')` 过滤内部 ID，仅保留 `uploader_nickname` 暴露给桌面端，避免内部用户 ID 泄漏到无登录公开端点。前端管理后台 `Inspirations.tsx` 表格新增「上传者」列（`@昵称` Tag / `用户已删除` / `管理员`）。桌面端 `views/image-gen/InspirationView.vue` 卡片分类行右侧 + 详情标题下方显示 `@uploader_nickname`（仅有值时，10-11px tertiary 样式不抢主标题）。`src/main/services/inspiration.ts` 的 `Inspiration` 接口扩展 `uploader_nickname?: string` + `fetchCustomInspirations` map 时透传

### 改进

- **桌面端 `CloudPermissions` 接口扩展**：`stores/cloud-auth.ts` 加 `inspiration_uploader: boolean`（默认 false），登录拉取与登出重置三处统一；`utils/cloud-api.ts` 加 `cloudPublic.listInspirationCategories()` 公开端点封装；`MyCreationsView.vue` 引入 `useCloudAuthStore` + 弹窗 props 通信，`showToast` 函数前移到 `copyToast` ref 之后规避 Volar `<script setup>` 类型推断顺序问题

### 说明

- **改动文件清单**：
  - 新建 migrations：`2026_05_09_000001_create_inspiration_tables.php`、`2026_05_09_000002_add_inspiration_uploader_to_users_table.php`、`2026_05_09_000003_add_uploader_to_inspirations_table.php`
  - 新建 / 改动 后端：`app/Services/StorageService.php`（local/cos 双模式核心）、`app/Models/Inspiration.php` + `InspirationCategory.php`、`app/Http/Controllers/InspirationController.php`（含 admin CRUD + 公开端 + clientUpload）、`app/Models/User.php`、`app/Http/Controllers/UserController.php`、`app/Http/Controllers/ClientController.php`、`app/Http/Controllers/SettingController.php`（cosTest）、`app/Models/SystemSetting.php`（白名单加 `storage_type` / `inspiration_source` / `cos_*` 系列）、`routes/api.php`
  - 新建 / 改动 前端管理后台：`pages/Inspirations.tsx`、`pages/Settings.tsx`（资源存储 Tab + COS 测试）、`pages/Users.tsx`、`services/api.ts`
  - 新建 / 改动 桌面端：`src/main/services/cloud-inspiration.ts`（新建）、`src/main/ipc/index.ts`、`src/preload/index.ts`、`src/main/services/inspiration.ts`、`src/renderer/src/stores/cloud-auth.ts`、`src/renderer/src/utils/cloud-api.ts`、`src/renderer/src/components/UploadInspirationDialog.vue`（新建）、`src/renderer/src/views/image-gen/MyCreationsView.vue`、`src/renderer/src/views/image-gen/InspirationView.vue`
- **schema 变更**：3 个新 migrations，全部为新增字段 / 新增表，无修改 / 删除已发布字段。在线更新会自动跑 migrate，向下兼容
- **composer.json 变更**：依赖加 `qcloud/cos-sdk-v5`（COS SDK，已 `composer install` 落 vendor）。其它依赖、`package.json` 不动
- **典型受益场景**：(1) 管理员可在云控端「灵感数据」页面自定义桌面端灵感广场内容，替代百度文心默认数据源；(2) 单站点图片资源量大或需要 CDN 分发时，可一键切换到腾讯云 COS，零停机不丢历史数据；(3) 优质创作用户被授予「灵感大王」后，可直接从桌面端「我的创作」详情页将作品分享到灵感广场，省去运维手动收集；(4) 上传作品自动带创作者昵称快照，用户改昵称或被删除后历史作品仍正确显示（FK SET NULL + 快照双保险）

---

## [1.2.11] - 2026-05-08

> 紧随 1.2.10 的小版本修复：天阙支付私钥加载从「PEM 头分支判断」彻底重写为「统一归一化流程」，根治用户从微信 / PDF / Word / 网页复制粘贴 PEM 时引入的不可见字符污染（零宽空格、不间断空格、BOM、全角空格）和 PEM 头被替换成视觉相似的中文破折号 "——" 等粘贴陷阱；同时 `SettingController::update` 加入入库前预校验，污染数据永远进不到加密入库。**非 breaking、无 schema 变更、无前端业务变更**。

### 修复

- **`TianquePayService::loadPrivateKey` 重写为统一归一化流程**：1.2.10 已支持 PKCS1 / PKCS8 PEM + 纯 base64 三种输入，但实际故障案例显示 PHP 8 + OpenSSL 3 在 base64 体含不可见字符（`\u200B` 零宽空格、`\u00A0` 不间断空格、`\uFEFF` BOM、`\u3000` 全角空格、`\u200C-\u200D` 零宽连接符、`\u2060` 单词连接符、`\u0000-\u001F` / `\u007F` 控制字符）时加载失败但不写错误队列 → `openssl_error_string()` 返回 false → 用户只能看到「未知 OpenSSL 错误」无任何线索。新版逻辑：(1) 拆出 `normalizePrivateKeyToPem()` 私有辅助：用 `preg_match` 检测 PEM 头类型（区分 `RSA PRIVATE KEY` / `PRIVATE KEY`）→ `preg_replace` 剥离所有 `-----BEGIN ... -----` / `-----END ... -----` 头尾 → 一个 Unicode 字符类 `/[\s\x{00A0}\x{200B}\x{200C}\x{200D}\x{2060}\x{3000}\x{FEFF}\x{0000}-\x{001F}\x{007F}]+/u` 一次性清除全部空白与不可见字符 → `preg_match('/^[A-Za-z0-9+\/=]+$/', $body)` 预校验 base64 字符集，失败时 `mb_substr` + `mb_ord` 遍历找出第一个非法字符并返回其值与 Unicode 码点（`U+%04X` 形式）→ `chunk_split` 按 64 字符换行重新包装成标准 PEM；(2) `loadPrivateKey` 简化为「调归一化 → 调 `openssl_pkey_get_private`」两步，失败时错误信息携带 `（已 normalize 为 %s 格式，base64 体 %d 字节）` 元数据，便于区分「私钥被截断」和「内容污染」两种故障；(3) 三类典型异常分别给定语：内容为空 → 「天阙私钥内容为空」；含非 base64 字符 → 「天阙私钥含非 base64 字符：'—' (U+2014)。常见原因：粘贴时混入中文破折号、全角字符、特殊符号或不可见字符」；OpenSSL 真错 → 透传原 `openssl_error_string` 队列。约 +90 行 / -25 行
- **老数据自动自愈**：1.2.10 之前已加密入库的污染私钥每次 sign 调用都会经过新版 `loadPrivateKey` → `normalizePrivateKeyToPem`，自动剥离污染字符，绝大多数客户站点升级到 1.2.11 后无需重新粘贴私钥即可恢复正常签名

### 改进

- **`SettingController::update` 入库前预校验**：1.2.10 及之前的链路是「用户保存私钥 → `Crypt::encryptString` 加密入库 → 用户点测试才发现污染 → 重新粘贴」。1.2.11 起 update 入口增加预校验：若 `settings` 数组里 `tianque_private_key` 非空字符串，立刻 `TianquePayService::validatePrivateKey()` 验证，失败立即返回 `422` + 详细诊断（非法字符位置 + Unicode 码点 + OpenSSL 错误队列）。校验通过才进入 `setValue` 落库循环，污染数据永远进不到 `Crypt::encryptString`。约 +14 行
- **`TianquePayService::validatePrivateKey(string $key): bool` 公开 API**：新增 `public static` 入口，内部委托 `loadPrivateKey($key)`，专供 SettingController 等业务层做入库前预校验。复用 `loadPrivateKey` 的全部诊断能力（错误队列收集、非法字符定位、归一化元数据），保持单一来源。约 +8 行

### 说明

- **改动文件**：
  - `app/Services/TianquePayService.php`：新增 `validatePrivateKey()` public + `normalizePrivateKeyToPem()` private 两个方法，`loadPrivateKey()` 简化为委托调用
  - `app/Http/Controllers/SettingController.php`：`update` 入口加私钥预校验代码块
- **无 schema 变更**：本版本不含新 migration；`SystemSetting::ALLOWED_KEYS` 不动；`composer.json` / `package.json` 不动
- **无前端业务变更**：前端构建产物为本次重新编译的稳定 build（vite 8 + tsc，1.42s 完成），与 1.2.10 上线时业务行为一致
- **典型受益场景**：(1) 用户从微信群 / PDF / Word 复制粘贴私钥时混入不可见字符 → 自动清除并加载成功；(2) 粘贴时被输入法替换成中文破折号 "——" → 立即报「U+2014」提示具体字符；(3) 用户保存污染私钥的瞬间就拿到 422 错误，不需要等到测试或下单时才发现；(4) 1.2.10 之前已落库的污染私钥升级一刻起自动恢复正常签名，无需运维介入

---

## [1.2.10] - 2026-05-08

> 综合改进版，含 1 个新功能（官网显示总开关）+ 多项管理后台 UI 体验提升 + 多项支付兼容性修复。**非 breaking、无 schema 变更**。1.2.9 内部测试版未发布到 CDN，其全部内容已并入本版。

### 新增

- **官网显示总开关**：`SystemSetting::ALLOWED_KEYS` 新增 `homepage_enabled`（bool，默认 true）。`HomepageController::index()` 返回 `homepage_enabled` 字段，`update()` 验证规则加 `homepage_enabled` boolean 并单独 `setValue` 落库。`routes/web.php` 根路由 `/` 在请求时读 `SystemSetting::getValue('homepage_enabled', true)`，false 时 `redirect('/admin')`，true 时正常渲染 `public/home/index.html`（兜底 fallback 同样到 /admin）。`HomepageSettings.tsx` 顶部加 Switch UI，`onChange` 时调 `homepageApi.updateSettings({ homepage_enabled })` 即时落库 + message toast。**无需 migration**：`getValue` 第二参数即默认值，已存在客户站点升级即可立即获得新字段（默认开启）
- **登录页 WebGL 流体动效**：新建 `frontend/src/components/SplashCursor.tsx`（850 行）：移植 Splash Cursor Effect 参考实现（Jos Stam 1999 Stable Fluids），WebGL 流体仿真层 + 2D Canvas 字符雨叠加层。`@ts-nocheck` 跳过类型注释（WebGL API 类型代价过高），DOM 用 `useRef` 替换 `getElementById`，字符集 `chars` 由 props 传入并用 ref 缓存让动画 loop 闭包随站点信息异步更新生效，`useEffect` 内初始化、返回 cleanup 清理 RAF + DOM 监听器
- **登录页改造（`Login.tsx`）**：背景从 `#f5f5f5` 改为 `#101010` 全屏黑底 + `<SplashCursor chars={chars} />` 流体动画铺满；登录卡片改为浅色玻璃态（`rgba(255,255,255,0.92)` + `backdropFilter: blur(20px)`）浮在动效之上；标题文字用 `useSiteInfo().title`；字符集由站点标题 `Array.from()` 拆字（正确处理 CJK / emoji 宽字符），过滤空白后若不足 2 个字符则用 `['·', '+', '·', '*', '·']` 兜底；外层 wrapper `pointer-events: none` + 卡片 `pointer-events: auto`，鼠标在卡片外的页面任何空白处都能触发流体效果，输入交互完全无干扰

### 修复

- **`PaymentController::buildNotifyUrl` 强制 https**：在最终返回前 `preg_replace('#^http://#i', 'https://', $base)`。彻底消除两类隐患：(1) 反代终结 SSL 后 PHP-FPM 看到的是 http（且 nginx 没设 `fastcgi_param HTTPS on`）；(2) 装站时是 http 后来才上 SSL、`APP_URL` 仍记为 `http://`。微信支付 V3 接口强制要求 https，1.2.9 之前上述场景下 unifiedorder 调用会被微信拒回 `notify_url is not a valid url`
- **`TianquePayService::loadPrivateKey` PKCS1 PEM 兼容**：原 `str_contains($key, 'BEGIN PRIVATE KEY')` 在用户贴 PKCS1 头 `-----BEGIN RSA PRIVATE KEY-----` 时返回 false（中间多 ` RSA `），导致代码错误地走"纯 base64 自动包装"分支，把 PEM 标记字符当 base64 乱拼必然失败。1.2.10 起检测 `-----BEGIN PRIVATE KEY-----`（PKCS8）和 `-----BEGIN RSA PRIVATE KEY-----`（PKCS1）两种 PEM 头，任一存在就直接交给 OpenSSL 加载。RSA 私钥不论 PKCS1 / PKCS8 包装，签出的字节流完全相同（底层是同一个 RSA 私钥），所以不强求 PKCS8。同时失败时用 `while (($e = openssl_error_string()) !== false)` 收集所有 OpenSSL 错误透出给用户

### 改进

- **`Settings.tsx` 5 Tab 重构**：原 6 个 Card（站点信息 / 注册赠送 / 防刷策略 / 界面文案 / 微信支付 / 天阙支付）平铺一列、整页超长。1.2.10 起改用 Ant Design `Tabs` 重组为 5 Tab：站点 / 注册策略 / 文案 / 微信支付 / 天阙支付。Tab 内 Card 不动，Form 实例不变，切 Tab 不丢未保存字段值。`Form` `maxWidth` 从 720 调到 880 适应 Tab 横向布局
- **微信支付验签材料 Segmented 切换**：原方案是「两组字段（公钥 ID + 公钥 / 平台证书）同时显示 + 顶部 Alert 提示『二选一，公钥优先』」，让用户对着两组字段猜要填哪个。1.2.10 起改用 `Segmented` 切换器（值 `public_key` / `platform_cert`）：选公钥模式只显示公钥两字段 + info Alert，选平台证书只显示证书 TextArea + warning Alert（提示 12 个月需换证）。新增 `wxpaySignMode` state，`load()` 时按已有数据自动判定初始模式（填了公钥两字段任一走公钥；只填平台证书走证书；都没填默认公钥）；`handleSave()` 时按当前模式排他清空另一种字段，避免后端启用不是用户预期的那种验签材料
- **套餐发放余额流水汉化**：`PlanService::grant()` / `grantFromSnapshot()` 写入 `BalanceLog.remark` 时格式从 `[plan_grant_snapshot] plan=vip-1(1) up=1 src=purchase` 改为 `[套餐发放] 套餐=vip-1(#1) 持有=#1 来源=购买`。新增私有 helper `sourceLabel()` 用 PHP 8.0 `match` 表达式映射 `purchase`→购买 / `redeem`→兑换码 / `admin`→后台发放 / `register`→注册赠送（未知值原样保留兜底）。数据库 `user_plans.source` 字段保持英文枚举（业务逻辑分支匹配），仅在写入用户可见文案时调用映射；历史已写入的英文 remark 不动（属归档）

### 说明

- **改动文件**：
  - 后端：`Http/Controllers/PaymentController.php`（`buildNotifyUrl` +1 行 regex）、`Services/PlanService.php`（汉化 + sourceLabel helper，约 +18 行）、`Services/TianquePayService.php`（PKCS1 检测 + 错误队列，约 +20 行）、`Http/Controllers/HomepageController.php`（`homepage_enabled` GET/PUT 处理，约 +8 行）、`routes/web.php`（根路由开关判断 +5 行）、`Models/SystemSetting.php`（白名单 + 默认值新增 `homepage_enabled`，2 行）
  - 前端管理后台：`pages/Settings.tsx`（Tabs/Segmented 重构，约 +100 行 / -60 行）、`pages/Login.tsx`（黑底 + SplashCursor 集成，约 +60 行）、新建 `components/SplashCursor.tsx`（850 行）、`pages/HomepageSettings.tsx`（顶部 Switch UI，约 +25 行）
- **无 schema 变更**：本版本不含新 migration；`composer.json` / `package.json` 不动
- **零运维成本升级**：管理后台「在线更新」一键升级即可，无需修改 nginx / .env / 数据库
- **典型受益场景**：(1) 反代部署或 `APP_URL` 误填 http 的客户站点，升级一刻起微信支付下单立即恢复；(2) 想隐藏官网仅保留 admin 后台访问的客户，一键关闭即可；(3) 私钥用 PKCS1 格式从天阙商户平台直接复制粘贴的客户，不再需要手工转换 PKCS8 格式

---

## [1.2.9] - 2026-05-08

> 1.2.8 紧随其后的小版本改进：(1) 微信支付 `notify_url` 出口强制 https，彻底消除反代部署 / `APP_URL` 误填 http 的回调失效隐患；(2) 系统设置页 6 Card 平铺重构为 5 Tab 切换；(3) 微信支付「验签材料」从「两组字段同显 + Alert 提示二选一」改为 Segmented 切换器（公钥/平台证书）。**非 breaking、无 schema 变更**。

### 修复

- **`notify_url` 出口强制 https**：`PaymentController::buildNotifyUrl()` 在最终返回前 `preg_replace('#^http://#i', 'https://', $base)`。彻底消除两类隐患：(1) 反代终结 SSL 后 PHP-FPM 看到的是 http（且 nginx 没设 `fastcgi_param HTTPS on`）；(2) 装站时是 http 后来才上 SSL、`APP_URL` 仍记为 `http://`。微信支付 V3 接口强制要求 https，1.2.8 及更早版本上述场景下 unifiedorder 调用会被微信拒回 `notify_url is not a valid url`

### 改进

- **`Settings.tsx` 5 Tab 重构**：原 6 个 Card（站点信息 / 注册赠送 / 防刷策略 / 界面文案 / 微信支付 / 天阙支付）平铺一列、整页超长。1.2.9 起改用 Ant Design `Tabs` 重组为 5 Tab：站点 / 注册策略 / 文案 / 微信支付 / 天阙支付。Tab 内 Card 不动，Form 实例不变，切 Tab 不丢未保存字段值。`Form` `maxWidth` 从 720 调到 880 适应 Tab 横向布局
- **微信支付验签材料 Segmented 切换**：原方案是「两组字段（公钥 ID + 公钥 / 平台证书）同时显示 + 顶部 Alert 提示『二选一，公钥优先』」，让用户对着两组字段猜要填哪个。1.2.9 起改用 `Segmented` 切换器（值 `public_key` / `platform_cert`）：选公钥模式只显示公钥两字段 + info Alert，选平台证书只显示证书 TextArea + warning Alert（提示 12 个月需换证）
- **`Settings.tsx` `wxpaySignMode` state**：新增 `useState<'public_key' | 'platform_cert'>('public_key')`。`load()` 时按已有数据自动判定初始模式（填了公钥两字段任一走公钥；只填平台证书走证书；都没填默认公钥）。`handleSave()` 时按当前模式排他清空另一种字段（公钥模式 save 清空 `wxpay_platform_cert`，证书模式 save 清空 `wxpay_pub_key_id` + `wxpay_pub_key`），避免后端启用不是用户预期的那种验签材料

### 说明

- **改动文件**：
  - 后端：`Http/Controllers/PaymentController.php`（`buildNotifyUrl` +1 行 regex）
  - 前端管理后台：`pages/Settings.tsx`（import +Tabs/Segmented；新增 `wxpaySignMode` state 与 load/save 排他逻辑；JSX 重排为 Tabs items 数组 + 微信支付 Card 内 Segmented 条件渲染，约 +60 净行）
- **无 schema 变更**：本版本不含新 migration；`SystemSetting::ALLOWED_KEYS` 不动；`composer.json` / `package.json` 不动
- **典型受益场景**：(1) 反代部署或 `APP_URL` 误填 http 的客户站点，升级一刻起微信支付下单立即恢复；(2) 系统设置页面用户操作路径明显变短（按业务分组切 Tab）；(3) 微信支付验签材料切换路径明确（点 Segmented 按钮 → 看对应字段）

---

## [1.2.8] - 2026-05-08

> 支付通道扩展：(1) 微信支付升级支持「微信支付公钥模式」（推荐、永不轮换），与「平台证书模式」自动二选一；(2) 新增「天阙聚合支付」通道（聚合微信/支付宝/云闪付/数字人民币）作为微信支付的备选方案，桌面端 PaymentDialog 内顶切换器供用户选择。**非 breaking**，含一次 schema seed migration（向 `system_settings` 插入 8 个新 key 的默认行，已存在 key 不动）。

### 新增

- **微信支付公钥模式**：`SystemSetting::ALLOWED_KEYS` 新增 `wxpay_pub_key_id`（string）/ `wxpay_pub_key`（text）。`WeChatPayService` 新增 `usePublicKeyMode(): bool`，当两字段都已配置时自动启用公钥模式；`builder()` / `verifyAndDecryptNotify()` 按模式分流装配 SDK certs（公钥模式 key=pub_key_id，平台证书模式 key=证书序列号）。`isConfigured()` 改为「基础字段 + 公钥/平台证书二选一」。`SettingController::wxpayTest` 返回字段加 `mode`（`public_key` / `platform_cert`），前端 message 显示当前模式。`Settings.tsx` 加 Alert 警告框 + 公钥两字段输入，强调「推荐」与「兼容、需定期更换」
- **天阙聚合支付**：
  - `SystemSetting::ALLOWED_KEYS` 新增 6 个 key：`tianque_enabled` / `tianque_env` / `tianque_version` / `tianque_org_id` / `tianque_mno` / `tianque_private_key`（encrypted）
  - 新建 `App\Services\TianquePayService`（286 行）：SHA1+RSA 签名、Base64、外层 key 字典序排序、reqData 内部不排序、紧凑 JSON、中文不转义；私钥兼容 PEM 文本与纯 base64（自动包装 PKCS8 头尾）；响应必验签使用代码内置天阙公钥（测试 / 生产环境各一）；接口实现：主扫预下单（`POST /order/activePlusScan`）/ 订单查询（`POST /query/tradeQuery`）
  - `PaymentController` 新增 `createTianque` / `tianqueSync` / `settleTianquePaidOrder`（197 行）：复用现有 `buildSnapshot` / `formatOrderForClient` helper；channel 字段值 `tianque_native`；`code_url` 字段复用存 payUrl；`wx_transaction_id` 字段复用存天阙 uuid / transactionId；天阙无异步通知，通过客户端轮询 `tianqueSync` 主动调天阙查单同步本地状态
  - `SettingController` 新增 `tianqueTest`：调一次随机订单查询，按 bizCode=2001/2005 判定签名通过
  - `routes/api.php` 新增 3 条：`POST /api/client/orders/tianque` / `POST /api/client/orders/{orderNo}/tianque-sync` / `POST /api/admin/settings/tianque-test`
  - `Settings.tsx` 新增「天阙支付（聚合支付）」Card：env / version 下拉、orgId / mno 输入、私钥 TextArea、测试连接按钮；`services/api.ts` 加 `tianqueTest`
  - 桌面端 `cloud-api.ts` 加 `createTianqueOrder` / `syncTianqueOrder`；`PaymentDialog.vue` 顶部增加支付方式切换器（微信 / 天阙），创建 / 轮询 / 取消 / 关闭逻辑全部按 `paymentMethod` 分流；切换支付方式时关闭旧 pending 订单（防止两个 channel 留两个 pending）
- **migration `2026_06_15_000003_add_wxpay_pubkey_and_tianque_to_system_settings`**：用 `insertOrIgnore` 模式 seed 8 个新 key 默认行；已存在 key 不动；与 `2026_06_01_000002_add_wxpay_keys_to_system_settings` 风格一致

### 修复

- **微信支付回调 `notify_url` Host 头伪造**：原 `PaymentController::notify` 用 `$request->getSchemeAndHttpHost()` 构造 notify_url，反代场景下 Host 头可被攻击者篡改。1.2.8 起 `buildNotifyUrl()` 优先读 `config('app.url')`（即 `APP_URL` 环境变量），未配置或为 Laravel 默认 `http://localhost` 时降级到请求 Host
- **微信支付回调签名探测包**：识别 header `Wechatpay-Signature` 以 `WECHATPAY/SIGNTEST/` 开头的探测请求（微信平台周期性安全检测），验签失败时降为 `Log::debug` 不再触发 warning 告警
- **`PaymentOrder` 退款功能注释**：在 model 顶部和状态常量处明确标注「退款字段为 schema 预留、业务流程未实现」（含 4 项未实现清单），避免后续维护误读

### 改进

- **微信支付回调 watchdog**：`notify` 方法记录处理耗时，>3000ms 触发 `Log::warning` 提示「接近微信 5s 超时阈值，建议评估异步化」，作为升级到 queue 的预警信号
- **微信支付测试连接错误信息**：双模式下错误信息明确标注「请检查后台『微信支付公钥 ID』配置」或「请更新平台证书或升级到公钥模式」

### 变更

- **`SystemSetting::ALLOWED_KEYS`**：新增 8 个 key（5 个 string、1 个 text、1 个 bool、1 个 encrypted）。原有 key 顺序与类型不变
- **`WeChatPayService::loadConfig` 返回结构**：新增 `pub_key_id` / `pub_key` 两字段；docblock 类型签名同步更新。返回数组 key 集合扩大但已有 key 名称、类型、来源不变
- **`PaymentOrder::$fillable`**：未变（复用现有 `channel` / `code_url` / `wx_transaction_id` 字段，`wx_transaction_id` 字段名带 wx 前缀但语义为「渠道流水号」，本次接受复用以避免增加字段 migration）

### 说明

- **改动文件**：
  - 后端：`Models/SystemSetting.php`（白名单 +9 行）、`Services/WeChatPayService.php`（双模式重构约 +50 行）、新建 `Services/TianquePayService.php`（286 行）、`Http/Controllers/PaymentController.php`（+200 行天阙方法）、`Http/Controllers/SettingController.php`（+35 行 tianqueTest）、`routes/api.php`（+3 条路由）、`Models/PaymentOrder.php`（注释 +20 行）、新建 migration `2026_06_15_000003_add_wxpay_pubkey_and_tianque_to_system_settings.php`（53 行）
  - 前端管理后台：`pages/Settings.tsx`（+90 行天阙 Card + 公钥模式 Alert）、`services/api.ts`（+1 方法）
  - 桌面端：`renderer/utils/cloud-api.ts`（+2 方法）、`renderer/components/PaymentDialog.vue`（+90 行支付方式切换 + 双 channel 分流）
- **DB 迁移成本**：`insertOrIgnore` × 8 行，秒级完成
- **典型受益场景**：(1) 配置过微信支付的客户可零成本切到公钥模式，永远不用换证书；(2) 客户站点新增聚合支付选项，用户付款时可在微信和天阙之间自选；(3) 客户 PaymentDialog 切换支付方式时自动关闭旧 pending 订单避免脏数据

---

## [1.2.7] - 2026-05-07

> 仪表盘信息架构重构 + 服务商连通性测试体系升级。**非 breaking**。一次 schema 增量（`cloud_providers` 新增 4 个 nullable 字段，纯增不改）。

### 新增

- **服务商「深度测试」入口**：原「测试」按钮只发 `GET /models` 探活，无法发现「`/models` 通但 `/chat/completions` 502」的中转 API 故障。1.2.7 起服务商列表新增「深测」按钮，点击会向上游真实发一条 `max_tokens=1, temperature=0, content="ping"` 的 chat completion，判定 `choices` 字段是否存在；成本 1 token，反映真实可用性。后端入口 `POST /admin/cloud-providers/{id}/deep-test`，前端 `providerApi.deepTest(id, modelId?)`
- **服务商「上次体检」列**：列表新增展示最近一次测试结果（通过 / 警告 / 失败 + 基础 / 深测 + 时间），hover Tooltip 显示完整 `last_test_message`，运维一眼看出哪些服务商有异常，无需逐个点击「测试」。列加 `sorter`，支持按测试时间排序（未测试排最后）
- **服务商深度测试自动选 model + 手动 fallback**：`probeChat()` 未指定 `modelId` 时先调 `probeModels()` 取 `data[0].id` 作为测试模型；若上游 `/models` 被中转 API 白名单拦截（403）或不返回 OpenAI 协议（缺 `data` 数组），后端返「无法自动选择 model」错误，前端检测到此错误自动弹 Modal 让用户手动填入 `model_id` 后重试一次（支持 200 字符以内任意 model 名）
- **`App\Services\Provider\ProviderProbe` 服务类**：抽出原 `CloudProviderController::testConnection / fetchModels` 的共用 `GET /models` 探测逻辑，新增 `probeModels()` / `probeChat()` 两个方法，统一返回结构 `{status, message, http_status, endpoint, models?, model?}`。`testConnection` / `deepTest` / `fetchModels` 三处都改为复用这个服务，避免重复维护连接 / 鉴权 / 协议判定
- **上游错误 body redact**：`ProviderProbe::summarizeErrorBody()` 把上游错误 body 截断 240 字拼到 message 里前，正则替换 `Bearer xxx` → `Bearer ***` / `sk-xxx` → `sk-***`。防御性脱敏，避免上游 echo 我们的 token 字符串经由「测试失败」消息回流到前端 / 浏览器控制台 / Sentry 等链路
- **`ConnectionException` 细分提示**：`ProviderProbe::classifyConnectionError()` 按 message 关键字识别 timeout / DNS（`could not resolve host` / `getaddrinfo` / `name or service not known`）/ SSL（`certificate` / `tls`）/ refused 四类网络错误，给具体修复建议，不再只显示笼统的「无法连接」
- **测试结果持久化**：`cloud_providers` 表新增 `last_test_at` / `last_test_status` / `last_test_kind` / `last_test_message` 4 个 nullable 字段。`testConnection` / `deepTest` 完成后通过 `persistTestResult()` 用 `forceFill` + `saveQuietly` 写入快照，避免触发 `updated_at` 抖动。列表查询直接读取这些字段，无需每次现测
- **测试 / 深测 / 拉取模型 路由节流**：`routes/api.php` 把 `cloud-providers/{id}/test` `cloud-providers/{id}/deep-test` `cloud-providers/{id}/fetch-models` 三个会真实打到上游的路由包进 `throttle:20,1` group（per-IP 每分钟最多 20 次），前端命中 429 走友好提示「过于频繁」不弹 Modal
- **仪表盘「今日 KPI」强调行**：顶部新增 4 张今日 KPI 卡片（今日新增用户 / 今日订单 / 今日成交金额 / 今日模型调用），每张带「较昨日」同比（↑绿 / ↓红 / 持平灰）+ 色块图标。后端用户 / 订单 / 用量接口都按 today / yesterday 各发一次请求，前端 `Promise.allSettled` 并发聚合。各模块图标用统一色板（用户蓝 #1677ff / 订单橙 #fa8c16 / 模型紫 #722ed1 / 套餐青 #13c2c2 / 兑换码绿 #52c41a / 调用粉 #eb2f96）
- **仪表盘「累计 KPI」可跳转**：原 6 张累计统计卡片（用户总数 / 订单总数 / 在售模型 / 在售套餐 / 可用兑换码 / 累计调用）改为 `<Link>` 包裹的 `Card hoverable`，整卡可点击跳转到对应模块路由，省一次手动点侧栏
- **仪表盘时间范围切换器**：顶部加 `Segmented`（今日 / 本周 / 本月 / 近 30 天 / 全部，默认 30 天，周一为周首天，符合中文习惯），切换后订单状态分布 / 套餐销量 Top5 / 调用趋势 / 模型 Top5 四个区块同步重拉。今日 KPI 和累计 KPI 不受范围影响（语义独立）。`getDateRange()` 工具函数集中处理日期算式
- **仪表盘调用趋势图换 recharts**：原手撸 `<div flex>` 柱状图升级为 `recharts AreaChart`，`linearGradient` 渐变填充 + `CartesianGrid` 横向网格 + `XAxis` 稀疏标签（`interval="preserveStartEnd"` `minTickGap=28`） + `YAxis` 刻度 + hover `Tooltip` 显示完整日期 + 调用次数。`chartData` `useMemo` 自动按区间补 0，避免横轴断点。新增依赖 `recharts ^3.2.1`
- **仪表盘排行榜 Top1-3 金/银/铜色强化**：抽出 `<RankRow>` 组件，#1 金 #faad14 / #2 银 #bfbfbf / #3 铜 #d4380d，徽章圆形数字 + 进度条同色；#4+ 灰 #f0f0f0。模型调用单位统一为「次」，详细信息（tokens / credits）放右侧 secondary 小字
- **仪表盘最近订单列扩展**：「订单号」列改为「订单 / 用户」（订单号 + 昵称两行），「状态」列改为「状态 / 时间」（Tag + 创建时间两行）。表格 loading 接 `recentLoading`
- **`UserController::index` 支持日期过滤**：query string `start_date` / `end_date`（`Y-m-d` 格式），用于仪表盘今日新增用户、本周用户等场景。原本只有订单 / 用量 / 兑换码接口支持这两个参数，用户接口缺位

### 修复

- **服务商测试 200 HTML 误判通过**：原 `testConnection` 拿到 HTTP 200 就判 ok，用户把 `api_base` 误填成网站首页（如 `https://example.com`）也会显示「连接成功」。1.2.7 起 `probeModels()` 在 2xx 后追加协议格式校验：`is_array($body) && isset($body['data']) && is_array($body['data'])` 不成立则降级为 warning，提示「响应不是 OpenAI 协议（缺少 data 数组）」
- **仪表盘全页 Spin 阻塞**：原版本 6 个数据源任何一个慢就整页空白。1.2.7 起拆为 `totalsLoading / todayLoading / rangeLoading / recentLoading` 四组独立 loader，每个 Card 用 `Skeleton active` 占位，先到先显示
- **`Providers.tsx` `catch` 块变量遮蔽 bug**：`const data = err.response?.data` 遮蔽了外层组件 `state.data`，导致深测错误后弹手动 model Modal 时查 provider 名永远查不到（实际查的是 err response body 而不是 providers 列表）。改名 `errData` 避免遮蔽
- **`fetchModels` 冗余判断简化**：`empty($models) && $result['status'] === 'warning'` 后半段冗余（warning 时 models 必为空），简化为 `$result['status'] === 'error' || empty($models)`，逻辑等价但可读性更好

### 变更

- **`cloud_providers` 表 schema**：新增 4 个 nullable 字段 `last_test_at`（timestamp）/ `last_test_status`（varchar 16，'ok' / 'warning' / 'error'）/ `last_test_kind`（varchar 16，'basic' / 'deep'）/ `last_test_message`（varchar 500）。**纯增字段**，不改老字段类型，老版本读老字段无影响
- **`CloudProviderController::testConnection`**：从 ~80 行 inline `Http::withToken` 探测代码缩到 8 行（仅调 `ProviderProbe::probeModels` + `persistTestResult` + 决定 HTTP 状态码）。返回结构不变，前端无需改 contract
- **`CloudProviderController::fetchModels`**：改为复用 `ProviderProbe::probeModels`，warning 状态（包括 403 白名单 / 协议不规范）也返 400 + error，与原行为一致
- **`CloudProvider` model**：`$fillable` 加 4 个 `last_test_*` 字段，`$casts` 加 `last_test_at => datetime`
- **`UserController::index` query 解析**：在原 `keyword` / `status` 之上新增 `whereBetween('created_at', [$start.' 00:00:00', $end.' 23:59:59'])` 过滤
- **服务商列表「操作」列宽度**：从 280px 扩到 320px（原 3 按钮 → 现 4 按钮：测试 / 深测 / 编辑 / 删除）

### 新增依赖

- **`recharts ^3.2.1`**：仪表盘调用趋势图。约 +180 KB（gzip ~58 KB），整体打包 1.93 MB → 经 vite tree-shaking 后未明显放大首屏

### 说明

- **改动文件**：
  - 后端：`Services/Provider/ProviderProbe.php`（新建 263 行）、`Http/Controllers/CloudProviderController.php`（重写 testConnection / 新增 deepTest / 改 fetchModels 共约 100 行）、`Models/CloudProvider.php`（fillable + casts 6 行）、`Http/Controllers/UserController.php`（date 过滤 7 行）、`routes/api.php`（throttle group + deep-test 路由 6 行）、新增 migration `2026_05_07_000000_add_test_result_to_cloud_providers.php`（35 行）
  - 前端：`pages/Dashboard.tsx`（重写约 800 行）、`pages/Providers.tsx`（深测 / 上次体检 / 手动 model Modal 约 +180 行）、`services/api.ts`（deepTest 方法 6 行）、`package.json`（加 recharts）
- **DB 迁移成本**：单条 `ALTER TABLE cloud_providers ADD COLUMN ...` × 4，秒级完成
- **典型受益场景**：(1) 运维通过仪表盘一眼看出今日新增 / 收入 / 调用同比，无需登 SQL 查；(2) 服务商列表打开就能看到所有 provider 的最近健康状态，不需要逐个点测；(3) 中转 API 服务商可用「深测」直接验证 chat 通路，避免 `/models` 通但 chat 502 的盲区；(4) 海外中转节点的 timeout / DNS / SSL 错误现在能在 UI 看到具体原因，不再只显示「无法连接」

---

## [1.2.6] - 2026-05-06

> 修复三个高危 bug：(1) 云打包落盘的安装包 / `latest.yml` 路径与桌面端 electron-updater 拉取约定不一致，导致已安装桌面端「检查更新」全部 500 失败；(2) HTTPS 客户站点在 Laravel 反代下 origin 误判为 http，导致云打包页面报 `domain_not_authorized`；(3) 客户站点 `storage/framework/views/` 子目录缺失（维护清缓存 / 初装漏建 / chmod 后丢失）会让根 URL `/` 的 home 官网页面整站 500 打不开（Blade compile cache_path 空触发嵌套 fatal）。**非 breaking**，**强烈建议立即升级所有客户站点**。

### 修复

- **桌面端「检查更新」全部 500 失败 / `latest.yml` 路径错位**：1.2.5 及更早版本 `UpdateDirService::atomicReplaceMany()` 把云打包落盘的 `.exe` / `.dmg` / `latest.yml` / `*.blockmap` 放到 `public/updates/{win|mac}/` 子目录里，但 electron-updater 默认从 `publish.url` 根（即 `https://<domain>/updates/`）请求 `latest.yml` / `latest-mac.yml`，桌面端打包时写死的 `publish.url` 也是根目录。结果：所有已安装桌面端检查更新时请求 `/updates/latest.yml` → 静态文件不存在 → nginx try_files 兜底走 PHP → Laravel 没有匹配路由 → 返 500 + `text/html`，**全量客户的桌面端永远收不到自动更新**。1.2.6 起 `atomicReplaceMany()` 落盘统一到 `public/updates/` 根目录（与 electron-builder 默认 publish 布局一致），同时配套 migration 把存量 win/mac 子目录文件搬到根并更新 `cloud_builds.stored_path`，升级后桌面端立即能正确拉到 `latest.yml`，**老版桌面端不需要重新打包**

- **HTTPS 站点云打包报 `domain_not_authorized`（origin 误判为 http）**：客户站点用 https 部署但 Laravel 在 nginx 反代后看不到真实的 https scheme（nginx 终结 SSL 后给 PHP-FPM 的是明文 HTTP），`request()->isSecure()` 返 false → `request()->getSchemeAndHttpHost()` 返 `http://example.com` → `AgentBuildClient` 把 `http://...` 作为 Origin 头发给 agent-build → agent-build `VerifyDomainBinding` 中间件按白名单 `https://example.com` 严格比对失败 → 返 `domain_not_authorized`，**所有 HTTPS 客户站点的云打包页面都进不去**。1.2.6 起 `AgentBuildClient` 在 `__construct()` 末尾对 origin 做 `preg_replace('#^http://#i', 'https://', ...)` 出口规范化（云打包链路本身就强制 TLS，`http://` 在生产环境本就无意义），无需让客户去配 Laravel TrustProxies / 改 nginx fastcgi_param

- **根 URL `/` 整站 500 / 浏览器落到 `chrome-error://chromewebdata/`**：客户站点 `storage/framework/views/` 子目录因为维护清缓存（`rm -rf storage/framework/*`）/ 初装解压时未保留空目录 / chmod 后丢失等原因消失，`config/view.php` 里 `'compiled' => realpath(storage_path('framework/views'))` 因为 `realpath()` 对不存在路径返 `false`，导致 `config('view.compiled')` 是空。Blade Compiler 构造时抛 `InvalidArgumentException: Please provide a valid cache path.`，Laravel 异常处理器又试图渲染 `errors/*.blade.php` 错误页，再次触发 Blade 编译，二次 fatal 把原始异常吞掉，给前端返空 body 500，Chrome 落到 `chrome-error://chromewebdata/` 兜底页，**看起来整站根 URL 打不开**（`/admin`、`/api/*` 因走 SPA 直读文件 / API JSON 不经过 Blade 仍正常）。1.2.6 起 `AppServiceProvider::boot()` 加 `ensureStorageDirs()` 在每个 HTTP 请求 boot 阶段幂等 `mkdir -p` 八个关键子目录（`storage/framework/{sessions,views,cache/data,testing}` / `storage/{logs,app/public,app/tmp}` / `bootstrap/cache`），**升级当下根 URL 立即恢复，无需运维 SSH 介入**

### 变更

- **`UpdateDirService::atomicReplaceMany()` 落盘路径**：`public/updates/{platform}/{filename}` → `public/updates/{filename}`。返回的 `stored_path` 由 `updates/{platform}/X` 变成 `updates/X`
- **`UpdateDirService::pruneOld()` 剪枝逻辑**：从「按 mtime 倒排扫子目录全部文件」改为「按平台主文件后缀（`.exe` / `.dmg`）筛根目录主 installer，保留最近 N 个并同步清理同名 `.blockmap`」。`latest.yml` / `latest-mac.yml` 单文件每次落盘覆写，不参与剪枝
- **`UpdateDirService::atomicReplace()`（单文件）**：因调 `atomicReplaceMany()` 自动跟新路径，无需独立改动
- **`AgentBuildClient::$origin` 出口规范化**：构造函数末尾追加 `preg_replace` 把 `http://` 协议头无条件改写为 `https://`
- **`AppServiceProvider::boot()` 加运行时自愈**：每请求 boot 阶段幂等 `mkdir -p` 八个 storage / bootstrap/cache 子目录，并发 race 用 `@` 静音

### 新增

- **migration `2026_05_06_210000_migrate_updates_dir_to_root.php`**：扫描 `public/updates/{win,mac}/` 子目录，把存量文件搬到根目录、删除空子目录、同步 `UPDATE cloud_builds SET stored_path = REPLACE(...)`，幂等。同时清理升级前运维手工创建的 symlink（如果有），避免冲突。失败的文件留在子目录里不影响功能
- **`AppServiceProvider::ensureStorageDirs()` private 方法**：约 25 行（含 doc-block），boot 阶段调用一次，零风险幂等

### 说明

- 改动文件：`UpdateDirService.php`（落盘 + 剪枝约 50 行）、新增 migration（约 100 行）、`AgentBuildClient.php`（origin 规范化 1 行 + 注释）、`AppServiceProvider.php`（自愈方法约 25 行）
- **无 breaking 变更**：DB schema 不变（仅数据 UPDATE）；config 不变；API 不变；桌面端 publish.url 不需要改
- **典型受益场景**：(1) 所有 1.2.0+ 部署的客户站点，升级后已安装桌面端的「检查更新」立即恢复（不论 Windows / macOS）；(2) 所有 HTTPS 客户站点（即所有走 GitHub Actions 云打包的站点），升级后云打包页面立即能通过授权检测、能正常提交打包任务；(3) 历史维护清缓存或初装漏目录的客户站点，升级后访问站点根域名 `/` 立即能正常打开 home 官网页面，无需运维登服务器手工 `mkdir`

---

## [1.2.5] - 2026-05-06

> 修复打包平台重装 / 维护后云控端任务永远卡死、新任务大概率丢记录的两个高发问题。**非 breaking**。无 DB 变更。配套 agent-build 0.3.3 解决根因。

### 修复

- **取消任务永远失败**：当 agent-build 因为重装 / 数据迁移 / 维护清表等原因丢失了 `build_requests` 中对应的 `build_id` 行时，agent-admin 的 `CloudBuildController::cancel()` 会拿到远端 404，直接 502 返给前端但**不更新本地 cloud_builds 行**，导致用户在 cloud_builds 页面看到一堆 queued / building 的孤儿记录永远取消不了，也没办法重新提交（被 client_busy 卡住）。1.2.5 起在 cancel 流程中识别远端 404 (`build_not_found`)，自动 fallback 为本地标记 `cancelled` + `error_message='打包平台已无此任务记录'`，前端立即可恢复
- **新任务推送成功但 cloud_builds 没记录**：agent-build 0.3.x 的 `/api/build/request` 是同步调 GitHub Actions API（含 15s 内部 timeout），跨区慢网下（如 agent-build 部署在香港 / 东京远端，agent-build 首次连 GitHub 冷启动）整端点常耗时 5-15+ 秒。agent-admin SDK 默认只给 15s timeout，刚好 race 在边界：GitHub 实际 dispatch 已经成功 + agent-build 也写入了 `build_requests` 行，但 agent-admin 这边 HTTP 已经超时 → SDK 返 `transport_error` → controller 502 + **不插 cloud_builds 行**。结果：agent-build 那边任务跑得好好的、GitHub Actions 也启动了；agent-admin 列表里却根本看不到这条任务。1.2.5 起 `requestBuild()` 单独使用 60 秒 timeout（其它接口仍 15s），覆盖跨区冷启动场景

### 新增

- **`AgentBuildClient::call()` 支持 timeout 覆盖**：新增可选 `$timeoutOverride` 参数（秒）。仅 `requestBuild()` 使用 60s，其它接口（auth-check / template-info / status / cancel / download / ack / list）保持原默认 15s，不影响普通响应延迟

### 配套

- **agent-build 0.3.3 同期发布异步 dispatch**：把 `/api/build/request` 改为「同步插 build_requests + 立即返 build_id」，GitHub Actions 调用挪到 BuildDispatchPending 后台 cron 异步处理。这样 1.2.5 + 0.3.3 都装上以后，根因消除（不再有 5-15s 同步等待），1.2.5 的 60s timeout 是兜底（即使没升 0.3.3 也能正常用）

### 说明

- 改动文件：`AgentBuildClient.php`（约 6 行）、`CloudBuildController.php`（cancel 方法加 12 行 fallback）
- 净改动 < 25 行，**无 schema 变更，无 migration**
- **典型受益场景**：(1) agent-build 重装 / 迁移导致的孤儿 cloud_builds 行；(2) agent-build 部署在远端，首次 / 偶发的网络慢导致提交后看不到记录

---

## [1.2.4] - 2026-05-06

> 1.2.3 紧上的 SSL 兼容修复。**非 breaking**。无 DB 变更。

### 新增

- **`AGENT_BUILD_VERIFY_SSL` 配置开关**：`config/cloudbuild.php` 新增 `verify_ssl` 配置项（env `AGENT_BUILD_VERIFY_SSL`，默认 `false`）。部分客户服务器的 cURL/OpenSSL 对 agent-build 证书的 Key Usage 校验过严（cURL error 60: Certificate key usage inadequate），导致云打包全部接口不可用。默认关闭 SSL 校验后所有云控端不再受此影响
- **`AgentBuildClient::call()` 支持 `withoutVerifying()`**：`verify_ssl=false` 时 HTTP 请求跳过 SSL 证书校验
- **`ArtifactDownloadService` 支持跳过 SSL 校验**：原生 curl 下载 artifact 时同样读取 `verify_ssl` 配置，`false` 时设置 `CURLOPT_SSL_VERIFYPEER=false` + `CURLOPT_SSL_VERIFYHOST=0`

### 说明

- 改动文件：`config/cloudbuild.php`（1 行）、`AgentBuildClient.php`（约 6 行）、`ArtifactDownloadService.php`（约 5 行）
- 净改动 < 15 行，**无 schema 变更，无 migration**
- 安全性说明：云控端到 agent-build 的通信本身已有域名级鉴权（Origin 头校验），SSL 在此场景的作用是防中间人，对大部分内网 / 同机房部署无实际风险。未来 agent-build 证书修复后可在 `.env` 加 `AGENT_BUILD_VERIFY_SSL=true` 重新开启

---

## [1.2.3] - 2026-05-06

> 1.2.2 紧上的错误诊断修复。**非 breaking**。无 DB 变更。

### 修复

- **`authCheck` 错误码丢失**：`CloudBuildController::authCheck()` 只检查 `$resp['error']` 而不检查 `$resp['_error']`，导致 transport error（网络不通）和 non_json_response（agent-build nginx 502 HTML 页）两类错误统一显示为 "agent-build 拒绝: unknown"，运维无法定位原因。1.2.3 起与 `templateInfo()` 对齐，改为 `$resp['_error'] ?? $resp['error'] ?? 'unknown'`，transport error 和非 JSON 响应都能正确展示对应中文提示
- **`AgentBuildClient::call()` 不检测非 JSON 响应**：当 agent-build 返回非 JSON 响应体（如 nginx 默认 502 HTML 错误页）时，`$response->json()` 返回 `null`，被 `?? []` 吞掉后丢失全部诊断信息（HTTP 状态码、响应体），下游 controller 拿到空数组只能输出 "unknown"。1.2.3 起显式检测 `json() === null`，返回 `_error=non_json_response` + `_msg` 包含 HTTP 状态码和响应体前 300 字符
- **`authCheck` / `templateInfo` 的 messageMap 缺少 `non_json_response` 条目**：即使 SDK 正确返回了 `_error=non_json_response`，controller 的翻译表也无对应中文，仍会走兜底的 "agent-build 拒绝: non_json_response"。两个 messageMap 均补上 `non_json_response` 条目

### 说明

- 改动文件：`AgentBuildClient.php`（非 JSON 响应检测，约 8 行）、`CloudBuildController.php`（authCheck `_error` 检查 + 两处 messageMap 补条目，约 3 行）
- 净改动 < 15 行，**无 schema 变更，无 migration**
- **典型受益场景**：部分已授权域名的云打包页面显示 "agent-build 拒绝: unknown"，升级后会显示具体原因（如 "打包平台返回异常：agent-build 返回非 JSON 响应 (HTTP 502): ..."），便于定位是 agent-build nginx 配置问题还是网络问题

---

## [1.2.2] - 2026-05-06

> 1.2.1 紧上的配置兜底热修。**非 breaking**。同 agent-build 0.3.0 / 0.3.1 配套（不需要再升 agent-build）。

### 修复

- **`AGENT_BUILD_BASE_URL=` 空值导致云打包整个不可用**：1.2.1 及更早版本的 install.php 生成的 `.env` 模板里这一行是「`AGENT_BUILD_BASE_URL=`」（有等号、值为空）。Laravel 的 `env()` 兜底参数**只在变量未定义时生效**，遇到空字符串会原样返回 `''`，导致 `cloudbuild.php` 配置默认 URL 形同虚设、`AgentBuildClient::isConfigured()` 返回 false，前端任何调用云打包接口（template-info / auth-check / 提交打包）都被 502 阻断。客户表象：「之前装的可用，新装的不可用」。**1.2.2 起 `config/cloudbuild.php` 用 `?:` 兜底空字符串，老站点升级即修复，无需手动改 `.env`**
- **`templateInfo` 错误信息不可读**：1.2.1 及更早版本不论真实原因（配置缺失 / 网络断 / 域名未授权 / agent-build 崩了）一律返「502 + agent_build_unavailable」，运维定位极慢。1.2.2 起按 `_error` 分类透传：`agent_build_not_configured` / `transport_error` / `domain_not_authorized` / `client_inactive` / `client_expired`，每种都附带翻译过的人话 message 字段

### 变更

- **install.php 的 `.env` 模板大瘦身**：`# CloudBuild` 区块从 11 行（含 5 个 0.2.0+ / 1.2.0+ 已下线的死字段）缩到 4 行，`AGENT_BUILD_BASE_URL` 写死官方 URL 默认值，`CLOUDBUILD_DOWNLOAD_TIMEOUT` 默认 1800 与 1.2.1 config 默认对齐。新装客户出厂即可用，无需任何 `.env` 干预
- **同步精简 `.env.example`**：开发者参考模板与生产 install 模板保持一致

### 升级指南

1. 仅升级 agent-admin（**不需要**升级 agent-build；与 0.3.x 协议完全兼容）
2. 覆盖代码 → **不需要 migrate**（无 DB 变更）→ `php artisan config:clear && php artisan config:cache`
3. **客户的 `.env` 不需要任何修改**：1.2.2 代码用 `?:` 兜底空值，老 `.env` 里 `AGENT_BUILD_BASE_URL=` 这种空占位会被代码无视并自动用官方默认 URL
4. **可选清理**：客户可手动从 `.env` 删除 `AGENT_BUILD_CLIENT_ID=` / `AGENT_BUILD_CLIENT_SECRET=` / `AGENT_BUILD_ORIGIN=` / `BUILD_NOTIFY_SECRET=` / `BUILD_NOTIFY_SKEW=300` 这 5 个 1.2.0+ 已下线字段（保留无害）

### 说明

- 改动文件：`config/cloudbuild.php`（3 行 env 加 `?:` 兜底）、`CloudBuildController.php`（templateInfo 错误分类透传）、`public/install.php`（`.env` 模板瘦身）、`.env.example`（同步精简）、`config/version.php`（版本号）
- 净改动 < 50 行，**无 schema 变更，无 migration**
- **典型受益客户**：1.2.0 / 1.2.1 装好后云打包页面进去就 502 / 显示「未授权」的客户，升 1.2.2 即解锁，无需登服务器改 `.env`

---

## [1.2.1] - 2026-05-06

> 1.2.0 紧上的可用性补丁。**非 breaking**。同 agent-build 0.3.0 配套（不需要再升 agent-build）。

### 新增

- **下载进度条**：详情 drawer 在 `status=downloading` 时显示百分比 + 已下载 / 总大小（如 `34% (32 MB / 90 MB)`），自动随每秒一次的进度查询刷新。新增 `cloud_builds.downloaded_bytes` 字段（migration `2026_05_06_200000_add_downloaded_bytes_to_cloud_builds.php`）由 `ArtifactDownloadService` 在 curl `WRITEFUNCTION` 回调里节流写入（每 1 秒 1 次 DB，不会高频写库）
- **失败重试按钮**：详情 drawer 在 `status=failed/expired/cancelled` 时右上角显示「重试拉取」按钮 + 错误 Alert 提示原因。点击后调新增的 `POST /api/admin/cloud-build/{buildId}/retry` 端点：自动把状态重置为 `success`（如已有 URL）或 `queued`（如未探到 URL），清空 error_message / downloaded_bytes / finished_at，立即触发一次 `pullOne` 重拉
- **`cloudBuildApi.retry(buildId)` SDK 方法**：对应后端 retry 端点

### 变更

- **`config/cloudbuild.php` 默认下载超时 600 → 1800 秒**：跨服务器 / 跨区域传 90 MB 以上 artifact 时 10 分钟很容易撞墙。新部署的 agent-admin 不需要再在 `.env` 加 `CLOUDBUILD_DOWNLOAD_TIMEOUT=1800`，直接默认 30 分钟；已部署的 1.2.0 站点升到 1.2.1 自动生效
- **存量 1.2.0 站点处理建议**：如不升级 1.2.1，可手动在 `.env` 加 `CLOUDBUILD_DOWNLOAD_TIMEOUT=1800` 后 `php artisan config:cache`；升级 1.2.1 则不需要任何 .env 改动

### 修复

- **下载途中失败任务无法继续**：1.2.0 里 `pullOne` / `pullPending` 都会跳过 `status=failed` 的行，没有方便的恢复入口。1.2.1 加了 retry 端点 + UI 按钮一键恢复
- **下载进度黑盒**：1.2.0 里 90 MB 文件下载需要几分钟，前端只能看到「拉取中」一动不动，体验差。1.2.1 实时进度条让用户知道是在下，速度多少，还要多久

### 升级指南

1. 仅升级 agent-admin（**不需要**升级 agent-build；本版本与 0.3.0 协议完全兼容）
2. 覆盖代码 → `php artisan migrate --force`（跑 add downloaded_bytes 一条新 migration）→ `php artisan config:cache`
3. **存量 cloud_builds 表的 downloaded_bytes 字段全部 NULL**：正常，下次任务下载时会从 0 开始填，老任务不影响

### 说明

- 改动文件：`config/cloudbuild.php`（默认值）、新 migration、`ArtifactDownloadService.php`（progress callback）、`CloudBuildPullService.php`（传 build_id + 重置 downloaded_bytes）、`CloudBuildController.php`（retry 端点）、`routes/api.php`（retry 路由）、`HistoryPage.tsx` + `services/api.ts`（前端进度 / 重试）
- 净增加约 80 行后端 + 50 行前端
- **本版本无协议变更**：agent-build 端不需要任何配合修改，单边升级 agent-admin 即可

---

## [1.2.0] - 2026-05-06

> **Breaking**：云打包对接协议改为「混合推拉」（hybrid push-pull）。删除 HMAC 共享密钥；新增公开的 `/api/build/wake` 唤醒入口；前端详情页加自动轮询作为 wake 丢失的兜底。**客户部署不需要配 cron**。本版本必须**配套升级 agent-build 到 0.3.0+**。

### 变更（Breaking）

- **删除 `CloudBuildReceiveController`**：原 `/api/build/receive-notify` 用于被动接收 agent-build push payload + HMAC 验签的入口，整文件移除
- **删除 `/api/build/receive-notify` 路由**：从 `routes/api.php` 移除，`use ...CloudBuildReceiveController` 一并删除
- **删除 `BUILD_NOTIFY_SECRET`**：`config/cloudbuild.php` 删除整个 `notify` 段（含 `secret` / `skew_seconds`）。客户 `.env` 旧值留着无害，被代码无视
- **新增 `CloudBuildWakeController`**：`/api/build/wake` 公开端点（throttle:120/min）。仅接受 `{"build_id": "..."}`，无签名校验。收到后立即响应 200，再用 `fastcgi_finish_request` / `ignore_user_abort` 切到后台 sync 调 `CloudBuildPullService::pullOne($buildId)`（resolve URL → download → atomic place → ack）。伪造的 wake 最多让本端发起一次自取无果的回拉（agent-build 对未授权 origin 返 404）
- **新增 `CloudBuildPullService`**：把原 `CloudBuildPullArtifact` 命令的拉取流水抽到 service，供 wake controller / refresh 端点 / cron 命令三方复用
- **新增 `POST /api/admin/cloud-build/{buildId}/refresh` 端点**：管理员手动触发拉取（前端详情页用）
- **`CloudBuildPullArtifact` 命令简化**：改为薄壳调 `CloudBuildPullService::pullPending()`。**cron 现在是「可选加速」而非必须**——客户不配 cron 也能正常完成所有任务（靠 wake + 详情页轮询兜底）
- **前端详情 drawer 加自动轮询**：打开 drawer 时若状态非终态先调一次 refresh，之后每 5s 再调直到 `delivered`/`failed`/`cancelled`/`expired` 等终态自动停。`cloudBuildApi` SDK 加 `refresh(buildId)` 方法

### 保留（不变）

- **`AgentBuildClient` SDK** 全部方法（`getDownload` / `getStatus` / `ack` / `requestBuild` / `cancel` / `checkAuth`）保留
- **`ArtifactDownloadService` / `UpdateDirService`** 下载校验和原子落盘逻辑不变
- **`cloud_builds` 表 schema** 不变，**无新增 migration**

### 升级指南

1. **agent-build 端**（**先升**）：升级到 0.3.0+，详见 agent-build CHANGELOG，要跑 migrate
2. **agent-admin 端**（**后升**）：覆盖代码 → **不需要 migrate** → `php artisan config:clear && php artisan config:cache`
3. **客户部署不需要做任何额外配置**（不需要 cron，不需要 secret）。客户的 `.env` 只需配 `AGENT_BUILD_BASE_URL`、`APP_URL`（域名）这些已有项
4. **可选清理**：删除 `.env` 里的 `BUILD_NOTIFY_SECRET=...` / `BUILD_NOTIFY_SKEW=...`（保留也无害）
5. **存量数据**：本地 status=success 但 agent_build_url 为空的行（0.2.x notify 失败留下），用户下次打开详情 drawer 时会自动 refresh 拉补 URL 并完成下载，**自动恢复**

### 工作流（用户视角）

- **典型路径**：用户提交打包 → agent-build 完成后 wake 本端 → 后端立即 pullOne → 前端轮询拿到 delivered。整体 5-10 分钟（GitHub Actions 时间为主）
- **wake 丢失场景**（云控端瞬时不可达）：用户打开「云打包记录」→ 点详情 → drawer 自动 refresh + 5s 轮询 → 几分钟内完成。**不需要任何运维介入**
- **可选 cron 加速**：技术用户仍可配 `* * * * * php artisan cloud-build:pull --once`，让 builds 在没人开页面时也能后台完成

### 说明

- 净改动：删 receive controller（~100 行）+ 加 wake controller（~70 行）+ 加 PullService（~250 行抽取）+ 详情页轮询（~30 行）
- **设计核心**：wake 信号不可信但无害；真正的鉴权靠回拉时的 Origin 头（agent-build 端的 `VerifyDomainBinding`）。多 agent-admin 部署无需共享任何密钥
- **客户部署体验**：从「装 zip + 配 .env + 配 secret + 配 cron + config:cache」简化为「装 zip + 配 .env + config:cache」，少一个易错步骤

---

## [1.1.5] - 2026-05-06

### 新增

- **「官网设置」新增「站点标题与导航」区**：支持单独配置浏览器标签页标题、左上角导航文字
- **左上角 Logo 图片可上传**：在「官网截图」区新增 `nav_logo` 位置（1:1，建议 64x64 或 128x128），未上传时显示默认字母缩写圆角块
- 新增 3 个白名单字段：`homepage_nav_title` / `homepage_page_title`，以及图片位置 `nav_logo`

### 变更

- **首页 HTML 导航 logo 适配 img**：上传 logo 后 `nav-icon` 的文字会被替换为图片（背景色清除、`object-fit: contain`、`border-radius: inherit` 保留原圆角）
- **首页文本应用顺序**：`applyTexts` 现在优先覆盖 `document.title`（来自 `homepage_page_title`）和 `nav-title`（来自 `homepage_nav_title`），未配置时回退到 `applyBranding` 的默认值
- **设置页结构**：合并为单一 Form 包裹两个 Card，避免双 Form 实例导致的 setFieldsValue 同步问题

---

## [1.1.4] - 2026-05-06

### 新增

- **官网页面**：根域名 `/` 下新增官网页面（`public/home/index.html`），7 屏单页展示桌面端产品功能（Hero、Agent 能力、生图套件、流式画布、知识库/Skills/MCP、本地存储架构图、下载 CTA）
- **官网设置管理后台**：侧栏新增「官网设置」菜单，支持：
  - 自定义 Hero 大标题、副标题、下载按钮下方说明文字
  - 配置 Windows / Mac 下载链接
  - 11 个截图位置独立上传/替换/清除（含位置标签、说明、建议比例与尺寸）
- **公开配置接口** `GET /api/public/homepage-config`：官网首屏一次性拉取文本 / 图片 URL / 站点品牌，无需登录
- **`cloud_build_app_name` 纳入公开配置**：`/api/public/site-config` 返回体的 `site` 节点新增 `product_name` 字段，官网和其它客户端可直接读取

### 变更

- **根路由 `/`**：从返回 JSON 改为渲染 `public/home/index.html`（找不到文件时仍 fallback 回原 JSON，向后兼容）
- **`SystemSetting::ALLOWED_KEYS` 白名单扩展**：新增 5 个键用于官网文本（`homepage_hero_title` / `homepage_hero_desc` / `homepage_version_text` / `homepage_download_windows` / `homepage_download_mac`）

### 数据库

- 新增 migration `2026_05_06_000001_create_homepage_images_table.php`：创建 `homepage_images` 表存储每个位置的图片 URL / 文件名 / 尺寸元信息

---

## [1.1.3] - 2026-05-06

> **重要**：本版本是为对接 agent-build 0.2.0+ 的破坏性协议变更（HMAC → 仅域名校验）做的配套适配。**单独升级本版本而不升级 agent-build 时，云打包功能会暂时不可用**（仍连旧版 agent-build 时所有 `/api/build/*` 请求会被 401）。其它管理后台功能不受影响，可以放心升级。

### 变更

- **云打包对接 SDK 重写**：`AgentBuildClient.php` 删除 HMAC-SHA256 签名生成与 `X-Client-Id` / `X-Timestamp` / `X-Signature` 三件请求头；改为仅发送 `Origin` 头由对端按域名校验。`isConfigured()` 简化为只校验 `base_url` 非空
- **`config/cloudbuild.php` 配置精简**：删除 `agent_build.client_id` / `agent_build.client_secret` 两项配置；`origin` 与 `base_url` 保留；`AGENT_BUILD_CLIENT_ID` / `AGENT_BUILD_CLIENT_SECRET` 两个 env 变量不再被读取（保留无害，可在升级后删除）
- **云打包预检错误码翻译表精简**：`CloudBuildController::authCheck` 删除 `missing_hmac_headers` / `timestamp_out_of_range` / `client_not_found_or_inactive` / `hmac_mismatch` / `origin_domain_mismatch` 五个旧错误码翻译；新增 `domain_not_authorized` / `client_inactive` 两个新错误码（agent-build 0.2.0 的 `VerifyDomainBinding` 中间件输出）
- **预检响应字段调整**：返回字段从 `expected_domain` + `got_domain` 合并为单一的 `origin`（与 agent-build 0.2.0 的 auth-check 输出一致；agent-build 不再回露已注册的合法域名是哪个，仅返回当前请求方的 Origin）
- **「云打包」页面错误提示文案适配**：`RequestPage.tsx` 的 `AuthCheckResult` 接口字段同步重命名；未授权时 Alert 文案从「打包平台已注册 X，本站发起请求的域名是 Y」改为「本站发起请求的域名是 Y，未在打包平台授权列表中」（不再泄漏对方已注册的具体域名信息）

### 升级指南

1. 升级 **agent-build** 到 0.2.0+（必须先于本版本，或同步发布）
2. agent-build 后台「客户端管理」页面把所有现有云控端的域名审核一遍，确保 `domain` 字段精确等于云控端实际访问域名（带 `https://` 前缀，结尾不带 `/`）
3. 升级本 agent-admin 到 1.1.3
4. 进「云打包」页面，确认顶部不再有红色未授权警告；如有 `domain_not_authorized` 错误，让 agent-build 管理员核对客户端域名拼写是否一致

### 不变（兼容）

- 管理后台所有页面（用户管理 / 套餐 / 服务商 / 模型 / 权限 / 计费 / 兑换码 等）行为完全一致
- 桌面端 / 老用户登录、API 调用全部不受影响
- 共享密钥 `BUILD_NOTIFY_SECRET` 用法不变（仍用于 agent-build 主动 POST 通知签名）
- 在线更新功能、备份策略、migrations 铁律均无变更

### 说明

- 本版本无新增 migration，不改 schema
- `AgentBuildClient.php` / `cloudbuild.php` / `CloudBuildController.php` / `RequestPage.tsx` 共 4 个文件改动，约 100 行
- 历史 v1.1.0-v1.1.2 部署的云控端，从 1.1.3 起不需要在 .env 配置 `AGENT_BUILD_CLIENT_ID` / `AGENT_BUILD_CLIENT_SECRET`，但 `BUILD_NOTIFY_SECRET` 仍必须配（双方一致）

---

## [1.1.2] - 2026-05-05

### 新增

- **9 个资源列表支持批量删除**：用户 / 用户分组 / 云端服务商 / 云端模型 / 模型分配 / 权限策略 / 计费规则 / 兑换码 / 套餐，全部支持表格多选 + 批量删除。复用业务校验（Users 禁删自己 / 最后一个管理员不可降级 / 已被持有的套餐改为归档），部分失败时弹窗展示「ID xxx：失败原因」明细
- **云打包页面持久化应用名 + 图标**：进入页面自动加载上次保存的应用名 / 图标，图标上传成功或应用名失焦时自动落库到 `system_settings`。下次进入无需重新填写；站点内多个管理员共享同一份配置
- **提交打包按钮三段式校验**：按钮 `disabled` + 文案按「未授权 / 未填应用名 / 未传图标 / 可提交」四种状态分别提示，避免用户误以为「没反应」

### 变更

- **云打包域名校验改为运行时**：`AgentBuildClient::origin` 优先从当前 HTTP 请求的 `Host` 头取，无 request 上下文（CLI / 队列）时回退 `config('cloudbuild.agent_build.origin')` → `APP_URL`。**不再需要在 .env 写 `AGENT_BUILD_ORIGIN`**；多域名部署时每个域名独立校验（从未授权域名访问会直接报错，不再被 .env 写死的 ORIGIN 掩盖）
- **云打包错误提示文案全量重写**：9 种上游错误码（`agent_build_not_configured` / `missing_hmac_headers` / `timestamp_out_of_range` / `client_not_found_or_inactive` / `client_expired` / `hmac_mismatch` / `origin_required` / `origin_domain_mismatch` / `transport_error`）的面向用户文案去掉所有「在 .env 中配置 xxx」的运维术语，统一改成「联系运维 / 联系打包平台管理员」的用户视角措辞

### 说明

- 本版本无新增 migration，不改 schema
- `SystemSetting::ALLOWED_KEYS` 白名单新增 `cloud_build_app_name` / `cloud_build_icon_url` 两个 key（类型 string），老机器升级无感
- 9 个资源批量删除的后端路由：`POST /api/admin/{users,groups,providers,models,assignments,permissions,billing-rules,redeem-codes,plans}/batch-delete`，单次最多 200 条，走现有 `destroy` 方法以复用业务校验
- agent-build 打包平台**无需任何改动**，`Origin` 头仍按 HTTP 协议标准发送，仅来源从 .env 写死改成请求 Host；协议、HMAC 签名、`authorized_clients` 表均不变

---

## [1.1.1] - 2026-05-05

### 新增

- **云端服务商 API 地址规范化**（保存时 + 调用时双保险）：用户填「不带 /v1」的基础地址（如 `https://api.openai.com`）会自动补齐为 `https://api.openai.com/v1`；已含 `/v1` `/v4` `/v1beta` 等任意版本号段的保持原样。存量脏数据也能兜底，不需要数据迁移
- **服务商表单实时预览**：管理后台服务商新建/编辑表单下方实时显示「实际生效地址」，让用户所见即所得，告别「保存后不知道真实 URL 是什么」的盲区

### 修复

- **测试连接从 GET /models 改为真实 POST /chat/completions**：许多代理 / CDN 对 `GET /models` 做白名单限流（常见 403 来源），但对真实 chat 流量完全开放。测试 chat/completions 才能真正反映「用户能不能用」，成本约 $0.0001（max_tokens=1），测试失败时把上游真实错误消息和请求 endpoint 透出到弹窗便于排查
- **国有化 `personal_access_tokens` 表建表迁移**：新增幂等 migration（`hasTable` 短路保护），不再依赖 Sanctum 的 vendor migration 被 Laravel package discovery 发现。部分新装环境因 bootstrap cache 时序问题导致缺表、管理后台「数据表完整性检查」页面报错的问题彻底解决。老服务器升级无副作用（表已存在直接短路）
- **权限管理添加策略 Switch 绑定 bug**：原 `<Switch>` 没传 `valuePropName='checked'`，导致 boolean 类型策略值回填 / 提交异常

### 变更

- **管理后台菜单重命名**：「金币管理（跟随自定义钱包名）」→「费用管理」，统一描述充值 / 消费 / 余额日志这类业务，不再受「现金钱包名称」自定义影响
- **套餐表单**：删除价格字段的「仅支持人民币，对接微信支付/支付宝」冗余提示；价格标签由「价格（CNY）」改为「价格（元）」
- **权限策略编辑器汉化**：类型下拉 `bool / number / string` → 「布尔 / 数字 / 字符串」；布尔值下拉 `true / false` → 「是 / 否」；placeholder「选择或输入 key」→「选择或输入策略键」（枚举 value 保持英文不动，向后兼容零影响）
- **权限管理值列显示**：boolean 类型值由 `true / false` 改为 「是 / 否」（保留绿 / 红配色语义）

### 说明

- 本版本新增 1 个 migration（`2026_06_15_000002_create_personal_access_tokens_table.php`），幂等安全，老机器升级仅写入 migrations 记录不触发 DDL；新装机器靠本 migration 稳定建表
- API 地址 normalize 规则在三处严格同步：桌面端 `src/shared/api-base-normalize.ts`、云控端 `backend/app/Support/ApiBase.php`、管理前端 `frontend/src/pages/Providers.tsx` 的内嵌实现，任一端修改规则需三处同步

---

## [1.1.0] - 2026-05-05

### 新增

- **云打包域名授权预检**（三层防护）：
  - agent-build 新增 `GET /api/build/auth-check` 接口（走 hmac + domain_binding 中间件），能调用成功即证明授权完整，返回 client 元信息 + 当日配额
  - agent-admin 新增 `GET /api/admin/cloud-build/auth-check` 接口，把 agent-build 的 9 种原始错误码（origin_domain_mismatch / client_not_found_or_inactive / client_expired / hmac_mismatch / origin_required / missing_hmac_headers / timestamp_out_of_range / transport_error / agent_build_not_configured）翻译成面向用户的人话提示
  - 前端 `RequestPage.tsx` 进页先调 `authCheck()`：已授权展示绿色 Tag + 域名 + 今日配额；未授权展示红色 Alert + expected/got 域名对比 + 重新检测按钮 + 整个 Form 禁用 + 提交按钮灰化并显示「本站未获授权，无法提交」
  - 后端兜底：即使前端绕过，agent-build 的 `VerifyDomainBinding` 中间件仍对所有 `/api/build/*` 请求硬校验 Origin === `authorized_clients.domain`
- **用户名可编辑**：管理后台用户列表「编辑」Modal 支持修改用户名（regex `^[a-zA-Z0-9_]+$` + 3-50 字符 + unique 校验）。改自己的用户名时弹出黄色 Alert 提醒「请立即退出后用新用户名重新登录」；改别人用户名时提醒「该用户下次登录需用新用户名」
- **管理员锁死防护**：后端 `UserController::update` 增加最后一个 admin 不能被降级为 user 的硬校验
- **MySQL 版本预检**：`install.php` Step 3 数据库连测时同时检查 MySQL 版本，不达标（MySQL < 5.7.7 / MariaDB < 10.2）直接红字阻塞，附宝塔面板升级指引（避免用户装到 Step 4 跑 migrate 时才撞「Specified key was too long」报错）
- **innodb_large_prefix 软警告**：版本达标但被手动关掉 `innodb_large_prefix` 时给出 my.cnf 修改建议（不阻塞，MySQL 8.0 已移除此变量时自动跳过）

### 修复

- `install.php` MariaDB 版本号解析：`VERSION()` 形如 `5.5.5-10.5.10-MariaDB-...` 时使用专门正则 `(\d+)\.(\d+)\.(\d+)-MariaDB` 提取真实版本，避免把 MariaDB 10.5 误判为「不达标的 5.5.5」

### 变更

- **套餐表单移除币种下拉**：云控端只支持国内支付通道（微信支付 + 未来支付宝），币种强制 `CNY`。新建/编辑套餐表单不再显示「币种」字段，价格标签改为「价格（CNY）」+ extra 说明「仅支持人民币」；后端 `plans.currency` 字段保留（兼容存量数据），submit 前强制补 `currency: 'CNY'` 双保险
- **DEPLOY.md 重写**：精简为 10 节 / 116 行的一线可操作指南（服务器要求 / 建库 / 上传代码 / 宝塔配站 / 权限 / 访问 install.php / 安全收尾 / 日常维护 / FAQ / 卸载），替代之前繁琐的部署文档

### 说明

- 本版本无新增 migration，不改 schema，全是 Controller / 前端 / 文档层改动，升级安全
- 云打包域名授权预检的前提：agent-admin `.env` 已正确配置 `AGENT_BUILD_BASE_URL` / `AGENT_BUILD_CLIENT_ID` / `AGENT_BUILD_CLIENT_SECRET` / `AGENT_BUILD_ORIGIN`，且域名已在 agent-build 后台的 `authorized_clients` 表注册
- MySQL 版本预检仅对新装站点生效（升级场景 install.php 会被 lock 文件拦截 404），对生产 0 风险

---

## [1.0.9] - 2026-05-05

### 新增

- **可视化安装向导** `backend/public/install.php`（4 步引导一键部署）
  - Step 1 环境检测：PHP ≥ 8.0 + 11 个必装扩展（fileinfo / openssl / pdo_mysql / mbstring / tokenizer / xml / ctype / json / bcmath / curl）+ 5 个必启函数（exec / popen / proc_open / putenv / symlink）
  - Step 2 文件权限：`storage` / `bootstrap/cache` / `backend` / `public` 四个目录可写检测，已存在 `.env` 的覆盖能力
  - Step 3 数据库：填表后 PDO 真连一次（默认 127.0.0.1:3306），返回 MySQL 版本 + 字符集，非 utf8mb4 时给出警告
  - Step 4 站点信息：填站点标题（≤50 字）+ 管理员用户名（字母/数字/下划线 3-50）+ 密码（≥6）+ 可选邮箱
  - 安装动作：自动生成 `APP_KEY`（32 字节随机 base64）+ `JWT_SECRET`（64 字符 hex），写 `.env` → 清 `bootstrap/cache/*.php` → bootstrap Laravel → `Artisan::call('migrate', ['--force' => true])` → 创建 admin 用户（bcrypt 哈希）→ 写入 `system_settings.site_title` → 写 `storage/installed.lock`（防重装）
  - 已安装拦截：lock 存在直接 404，无任何路由响应
- **应用图标上传**（CloudBuild）：管理后台应用配置可上传应用主图标 PNG，三层验证防伪（前端 MIME 嗅探 + 后端 `imagecreatefromstring` 真实解码 + 像素级 1:1 比例校验，要求 512-1024px 正方形 ≤2MB），落盘 `public/cloud-build/icons/{app_id}.png`
- **站点标题（site_title）支持**：通过 `/api/public/site-config` 暴露 `site.title`，前端 `useSiteInfo()` hook 全局缓存（localStorage 启动加载避免首屏闪烁），左上角侧边栏标题 + 浏览器 tab 标题自动同步；管理后台「设置 → 站点信息」可编辑（最长 50 字，留空回退默认 `Agent Admin`）

### 修复

- `install.php` 在 `require vendor/autoload.php` 之前删除 `bootstrap/cache/*.php`，避免历史失败安装残留的旧 `config.php` 让新写入的 `.env` 失效（导致 migrate 跑到错误数据库）
- `install.php` 重装场景下管理员邮箱 unique 约束冲突：`DELETE FROM users WHERE username = ? OR email = ?`（仅在 email 非空时启用 OR 分支），同时清同 username 与同 email 的孤儿
- `install.php` PDO DSN 增加 `MYSQL_ATTR_INIT_COMMAND` 与重连阶段 `ATTR_TIMEOUT=5`，避免 host 不可达时 30+ 秒卡死

### 变更

- 前端 `CurrencyContext` localStorage 缓存键 `currency_labels_cache` → `site_config_cache`（自动迁移：新键不存在时回退读旧键，下次写入清掉旧键）
- `SystemSetting::ALLOWED_KEYS` 新增 `site_title => string`，`DEFAULT_VALUES` 兜底 `'Agent Admin'`
- `.gitignore` 排除 `/backend/storage/installed.lock`

### 说明

- 本版本无新增 migration，不改 schema，仅 Controller / Model 层加白名单字段 + 一个独立 `install.php` 入口
- `install.php` 仅在 lock 文件不存在时响应，安装完成立即 404，对生产 0 风险
- 部署新站点：上传 `backend/`（含 `vendor/`）→ 宝塔配站点指向 `public/` → 浏览器访问 `/install.php` 走完 4 步即可完成全部部署

---

## [1.0.8] - 2026-05-05

### 新增

- **云端打包接收能力**（白标客户端 SaaS 化第一步）：作为云控端接入独立的 `agent-build` 打包服务，由 agent-build 集中调度 GitHub Actions 打包桌面端安装包，结果通过 HMAC 签名回调 + 远端 artifact 下载落到本地 `update_dir/{app}/`
  - 新增 `CloudBuildReceiveController`：暴露 `POST /api/build/receive-notify` 接口，接收打包完成回调，校验 `BUILD_NOTIFY_SECRET` HMAC（5 分钟时间窗 + nonce）后入库 `cloud_builds`
  - 新增 `App\Services\CloudBuild\AgentBuildClient` SDK：HMAC-SHA256 签名调用 agent-build 的 `/api/build/request` / `/cancel` / `/status` / `/download-token` 等 8 个 API
  - 新增 `App\Services\CloudBuild\UpdateDirService`：原子替换 `update_dir/{app}/`（先写 `.tmp` 同盘临时目录，再 `rename` 切换，旧目录移到 `.old/{Y-m-d-His}/` 兜底回滚），保证桌面端「检查更新」拉到的总是一个一致的版本
  - 新增 artisan 命令 `cloudbuild:pull-artifact`：定时（5 分钟）扫描 `cloud_builds` 表中状态 `notified` 的记录，调 agent-build 取下载令牌，分块下载 zip 并校验 SHA-256，落盘后置 `delivered`
  - 新增 `cloud_builds` 表：记录打包请求、回调元数据、artifact 路径、状态机
- **electron-updater 三件套支持**：cloud-build 接收侧从「单文件交付」升级到「同步交付 .exe + latest.yml + .blockmap」
  - `cloud_builds` 表新增 `supplementary_files` JSON 字段（记录每个附件的 filename / role / sha256 / size / download_url）
  - `UpdateDirService::atomicReplaceMany()`：把主产物 + 三件套全部下载到 `.tmp` 后一次性原子切换到 `update_dir/{app}/`
  - `CloudBuildPullArtifact` 命令分别下载主产物 + 元信息 + blockmap，逐文件校验 SHA-256，任一失败则全部丢弃整个 `.tmp` 重试
- 配置新增 `config/agent_build.php`：cloud-build 服务的 base_url / client_id / secret / origin / 通知超时与时钟容忍

### 说明

- 本版本只交付 agent-admin 侧的「**接收**」能力。agent-build 服务本身（GitHub Actions 调度器、admin API、admin 前端）作为独立项目部署，**未与本次更新包同步上线**
- 因此云控端升级到 1.0.8 之后：现有所有功能照常运行；新增的 `/api/build/receive-notify` 端点对外暴露但生产环境暂无对端调用，不会被触发
- 待 agent-build 部署到 `your-build-domain.example.com` 之后，云端打包功能在 SaaS 用户侧才会真正可用
- 新增 2 个 migration（`create_cloud_builds_table` + `add_supplementary_files_to_cloud_builds`），生产升级时自动跑，不影响现有表

---

## [1.0.7] - 2026-05-04

### 新增

- **批量多选管理能力**：管理后台 4 大模块支持批量/多选操作，大幅减少重复点击
  - **模型分配**：改为矩阵多选，一次勾选多个模型 × 多个用户 / 分组，后端 `POST /admin/model-assignments/batch-matrix` 展开为 N×M 条记录，已存在的自动跳过（幂等）
  - **权限策略**：新增批量添加，同时勾选多个用户 + 多个分组，一次下发同一条策略，后端 `POST /admin/permissions/batch` 对每个 target 执行 `updateOrCreate`
  - **计费规则**：新增「规则范围」切换（默认规则 / 批量指派），批量时支持多选用户 + 多选分组共享同一规则，后端 `POST /admin/billing-rules/batch`
  - **套餐发放**：新增「批量发放」按钮，支持 `user_ids[] + group_ids[]`，分组会自动展开为成员列表，后端 `POST /admin/plans/batch-grant` 逐个 grant 并返回成功 / 失败明细
  - **套餐批量撤销**：「用户套餐」页加行勾选 + 批量撤销按钮，后端 `POST /admin/user-plans/batch-revoke`，`PlanService::revoke` 逐条执行
- **兑换码「套餐」字段优化**：
  - 「组合」类型时套餐字段从同行 InputNumber 改为独立行
  - 套餐字段改为 Select 下拉（`planApi.list({per_page:500})` 拉取 active 套餐），支持按名称模糊搜索，option 格式 `套餐名 (#ID · code)`
  - `type='plan'` 时套餐必填，`type='bundle'` 时可选

### 变更

- **单分组独占策略**：用户分组由「多对多叠加」改为「单分组独占」
  - `UserGroupController::addMembers` 改为事务式 `DELETE + INSERT`：加入新分组前先清除用户所有旧分组
  - `AuthController::register` 注册时默认分组只取 `is_default=true` 的第一个（按 id 升序），用 `sync()` 替代 `attach()`
  - 「分组管理 → 成员管理」Modal 顶部加 `Alert info` 提示 + 按钮文案「加入本分组」+ 二次 Tooltip
  - 已分配的存量多分组数据不动，admin 重新分配时自动单分组化
- **侧边栏菜单「余额管理」动态化**：`AdminLayout.tsx` 把 `menuItems` 移入组件，用 `useMemo + useCurrencyLabels` 根据自定义 token 文案动态生成菜单名（admin 改文案后菜单立即跟随）

### 说明

- 本版本无新增 migration，不改 schema，仅在 Controller 层增加批量接口 + 前端 UI 重构
- 升级过程对现有用户无感，已分配的权限 / 计费 / 分组数据 100% 保留
- 旧 API（单条 `store` / `grant` / `revoke`）保留兼容

---

## [1.0.6] - 2026-05-04

### 新增

- **可自定义货币文案**：`balance_type='token'` 默认显示「金币」、`balance_type='credit'` 默认显示「积分」，管理员可在「设置 → 界面文案」自定义两个钱包名称（最长 20 字符），修改后桌面端 / Web 客户端实时同步
  - `SystemSetting::ALLOWED_KEYS` 新增 `currency_label_token` / `currency_label_credit` 两个 string 类型 key
  - `SystemSetting::DEFAULT_VALUES` 常量提供业务默认值（"金币" / "积分"），值为空字符串时自动回退默认
  - 新增公开 API `GET /api/public/site-config`：免登录即可拉取，返回 `{currency: {token, credit}}`，桌面端启动时调用，方便登录前的页面也能正确显示
- 「数据表」检查页 `FRAMEWORK_TABLES` 白名单：`migrations` 与 `personal_access_tokens` 是 Laravel 框架 / Sanctum 包内置的表，不在本地 migrations 目录但应该存在，加入白名单后不再误判为「额外表」

### 变更

- 云控后台 30+ 处「余额 / 积分」的硬编码三元（`<Tag color={v === 'token' ? 'orange' : 'purple'}>{v === 'token' ? '余额' : '积分'}</Tag>`）改为统一组件 `<CurrencyTag type={v} />`，并通过 `CurrencyContext` Provider + `useCurrencyLabels()` hook 全局读取自定义文案
- 桌面端 8 个 Vue 文件 21+ 处「余额 / 积分」改为 `useSiteConfigStore().labels.token / labels.credit`，通过新增的 `siteConfig` Pinia store 在 `main.ts` 启动时拉取一次并缓存到 localStorage，avoid 首屏闪烁
- 「数据表」检查页修复后：`应存在=23 / 缺失=0 / 额外=0`，所有表都对齐识别（21 业务表 + 2 框架表）

---

## [1.0.5] - 2026-05-04

### 变更

- 图片生成任务 `image_tasks` 表不再入库 base64 图片：
  - 入库时剥离 `request_body.images / mask / image` 和 `result.data[].b64_json`，只保留元数据 + `_images_count / _has_b64 / _b64_length` 等审计标记
  - 完整 base64 载荷改用 Cache 短期传递（请求 30 分钟 TTL / 结果 1 小时 TTL）供异步 worker 与客户端轮询使用
  - 单条记录从平均 ~2.4 MB 降到 1-2 KB，按当前流量节奏每月节省 ~2 GB 数据库体积
- `UpdateService::phaseClearCache` 新增 `clear-compiled` 与 `package:discover --ansi`，并在 `phaseExtract` 解压完毕立即用文件系统直接 `unlink` 清理 `bootstrap/cache/packages.php / services.php / compiled.php / config.php / routes-v7.php / routes-v6.php / events.php`，避免新代码引用已被剥离的 ServiceProvider 导致 500（防御性升级，从下一次升级起自动免疫该问题）

### 新增

- `version.backup_keep_count` 配置项（默认 5，可由 `UPDATE_BACKUP_KEEP_COUNT` 环境变量覆盖）：升级时自动清理超出数量的旧备份目录
- `UpdateService::pruneOldBackups`：每次升级末尾按 `Y-m-d-His` 字典序保留最近 N 份，严格匹配命名格式正则防误删人为创建的其他目录，递归删除时不跟随符号链接

### 修复

- 在线更新页 「数据表」 Tab `应存在表数=0 / 额外表数=23` 的统计 bug：原 `UpdateService::checkDatabase` 同时把 `up()` 的 `Schema::create` 和 `down()` 的 `Schema::dropIfExists` 计入，由于每个 migration 文件都成对出现导致 `expected_tables` 被 `array_diff_key` 清零；改为按 `function down` 字符串切分只扫 `up()` 部分，正确识别独立 drop migration 才计入 dropped。修复后 `应存在=21 / 额外=2 (migrations + personal_access_tokens)`

---

## [1.0.4] - 2026-05-04

### 新增

- 权限策略系统新增 `allow_custom_embedding` 策略键：用于控制软件端是否允许用户配置自定义向量服务（关闭时软件端将忽略本地向量配置，强制走云端 `/gateway/embeddings` 网关计费）
- 「权限策略」页面新增 `allow_custom_embedding` 编辑选项
- 「套餐管理」编辑器策略勾选区新增 `allow_custom_embedding` 选项，可在套餐快照中下发该策略

### 变更

- `ClientController::myPermissions` 默认权限合并基线新增 `allow_custom_embedding => true`，存量用户保持自定义向量服务可用，向后兼容

### 修复

- 修复 `UpdateService` 升级流程未清理 `bootstrap/cache/packages.php` 等编译缓存导致的 500 故障：旧版本若在缓存里注册了已被 `--no-dev` 剥离的 ServiceProvider（如 `spatie/laravel-ignition`、`nunomaduro/collision`），新版本启动时会因 `ClassNotFound` 直接 500
- `phaseExtract` 解压完毕后立即用文件系统直接 `unlink` 清理 `packages.php` / `services.php` / `compiled.php` / `config.php` / `routes-v7.php` / `routes-v6.php` / `events.php`，不依赖 Artisan（彼时新 vendor 已就位、Artisan 自身可能跑不起来）
- `phaseClearCache` 加双保险：再次执行同一组文件清理 + `clear-compiled` + `package:discover --ansi`，基于新 vendor 的 `installed.json` 自动重建 ServiceProvider 列表
- 此修复为防御性变更，**当前版本（1.0.4）部署仍需按上一步备注的 SSH 命令手动恢复**；下一次版本升级起将自动免疫该问题

---

## [1.0.3] - 2026-05-04

### 新增

- 在线更新页面新增「数据表」Tab：扫描 `database/migrations/` 目录与 `migrations` 表对比，列出待执行的 migration 与缺失的数据表；支持一键点击「一键修复」执行 `php artisan migrate --force` 补齐（带二次确认）；修复前后自动差分展示待执行数 / 缺失表数，并回显 Artisan 输出
- 在线更新页面新增「更新记录」Tab：从远端集中的 `releases.json` 聚合展示所有历代版本 changelog、发布时间、包大小、SHA256，当前版本高亮标记「当前版本」
- 后端新增 3 个接口：`GET /admin/updates/db-check` / `POST /admin/updates/db-repair` / `GET /admin/updates/releases`
- 配置新增 `version.releases_url` 指向远端集中式更新记录 JSON，默认 `https://your-cdn-domain.example.com/adminup/releases.json`

### 变更

- 远端版本信息改用集中式 `releases.json` 单文件维护所有历代 changelog，取代分散的 `version-X.Y.Z.json` 方案，打包流程同步简化

---

## [1.0.2] - 2026-05-04

### 新增

- 在线更新：升级前写权限预检（`UpdateService::probeWritable`），探测项目根与核心子目录（app / config / routes / resources / database / public / vendor）的写权限，避免走到备份才发现不可写浪费时间
- 在线更新页面：顶部新增红色警告 Alert，不可写时展示 PHP 运行用户、不可写子目录、完整 SSH 修复脚本（含 chown 750 + public 755 + .env 640 + storage 775 四步安全配置），支持一键复制命令与"再次检查权限"按钮
- 后端接口 `/admin/updates/current` 与 `/admin/updates/check` 返回结果附加 `writable` 字段

### 变更

- 权限修复策略从宽松的 `chmod 775` 改为更安全的 `chmod 750`，防止 others 用户读取源码
- `.env` 单独保留 root 属主 + 权限 640，密钥不会随升级权限调整被泄漏

---

## [1.0.1] - 2026-05-04

### 变更

- 在线更新页面头部描述文案脱敏，不再暴露更新服务器域名

---

## [1.0.0] - 2026-05-04

### 首个发布版本（Baseline）

#### 用户与权限
- 用户管理（增删改查、状态切换、密码重置）
- 用户组管理 + 用户组成员关系
- 角色权限策略
- JWT 鉴权（access token + refresh token）

#### 模型与服务商
- 云端服务商管理
- 云端模型管理（OpenAI / Claude / Gemini 等多协议）
- 模型分配（按用户 / 用户组）
- 计费规则（按 token 计费 / 按调用计费）

#### 余额与计费
- 用户余额（token / credit 双类型）
- 余额变动日志
- 使用记录（usage_records）+ 多维统计
- 异步图片任务（image_tasks）

#### 套餐与营销
- 套餐分类（plan_categories）
- 套餐管理（plans）+ 套餐购买快照
- 兑换码生成与核销（redeem_codes）
- 用户余额来源追踪（source_plan_id）

#### 支付（微信）
- 微信支付 v3 集成
- 套餐购买 / 订单创建 / 回调验签
- 平台证书序列号校验
- 订单超时自动关闭（每分钟定时任务）
- 7 天前 failed 订单自动清理
- 订单管理后台（列表 / 详情 / 同步补单）

#### Dashboard
- 6 维 KPI 卡片
- 订单状态分布 + 累计成交金额
- 套餐销量 Top 5
- 近 30 天调用趋势（纯 div 柱状图，零图表库依赖）
- 模型调用 Top 5
- 最近订单 / 最近注册用户

#### 在线更新
- 远端 version.json 拉取与版本对比
- SHA256 完整性校验
- 自动备份代码 + 数据库
- 自动解压 + 数据库迁移 + 缓存清理
- 升级历史记录（update_logs）
- 升级实时进度展示

---

## 版本管理约定

- **MAJOR**：不兼容的 API 变更、数据库结构破坏性调整
- **MINOR**：向下兼容的新功能（建议附带 migration）
- **PATCH**：向下兼容的 bug 修复、UI 调整
