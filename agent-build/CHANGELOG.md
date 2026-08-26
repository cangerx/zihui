# Agent Build Changelog

本文档记录 agent-build（授权管理端 / 云打包后端）版本变更历史。版本号遵循语义化版本（SemVer）规范：`MAJOR.MINOR.PATCH`。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

---

## [Unreleased]

## [0.19.2] - 2026-08-24

> **授权端托管云控在线更新，发版页可从本地 CHANGELOG 带入。** 含 `site_update_releases` migration，须执行 `php artisan migrate --force`。

### 新增

- **云控发版**：系统菜单可上传/激活云控网站更新包；公开 `version.json` / `releases.json` / zip。短期 zip 存在授权端，`zip_url` 可改为 COS。
- **发版草稿**：`php artisan release-draft:sync` 从云控 CHANGELOG / 桌面 package.json 生成草稿；后台「发布新版本」自动带入版本号与说明。
- **桌面模板版本**：从已下线的打包中间件中拆出，后台可继续维护当前模板版本，供云控一键打包读取。

### 变更

- **后台侧栏**：配置类入口归入「系统设置」（收款配置、在线更新、站点）；「收款与交付」只保留订单列表。旧地址 `/admin/wechat-pay-settings` 仍可用。

## [0.19.1] - 2026-08-23

> **修复 0.19.0 手工覆盖后的后台报错与误导信息**。无新增 migration，可从 0.19.0 直接覆盖；**不要再解 0.19.0 zip**，否则会冲掉已热修的在线更新路由引用。覆盖后仍须确认 `php artisan migrate --force` 已执行（0.19.0 的 Skill Registry 表）。

### 修复

- **后台路由**：补回 `UpdateController` 引用，避免「在线更新」接口因类找不到而失败。
- **在线更新页**：远端 `version.json` 不可达时仍显示本机当前版本，红字只描述检查失败。
- **探活 `GET /`**：返回 `config/version.php` 中的版本号，不再写死旧占位版本。

### 变更

- **配置示例**：`.env.example` 增加 `UPDATE_CHECK_URL` / `UPDATE_RELEASES_URL`。生产未填写时检查更新会打到无法解析的占位域名。
- **手工升级说明**：按站点是扁平 Laravel 还是 `backend/` 子目录选择解压目标；覆盖后必须 migrate 与清缓存。
- **管理后台界面**：浅色墨绿工作台外壳（与云控视觉基线同色、独立站点），侧栏图标、登录页与内容画布；文案标明这是授权管理后台。

## [0.19.0] - 2026-08-22

> **Skill Registry 与客户端打包入口下线**。新增 Skill 审核表；升级必须执行 migration。客户端打包 UI/API/cron 默认 410，实现类保留以便紧急回切。

### 新增

- **Skill Registry**：投稿 ZIP、扫描、ed25519 签名、审核/发布/撤回，以及云控增量事件与短时下载票据。
- **授权后台**：独立「Skills 审核」页，含待审、已发布和撤回。
- **migration `2026_08_22_000100_create_skill_registry_tables`**：skills / versions / reviews / reports / events。只增不改。

### 变更

- **客户端打包**：默认 `BUILD_PACKAGING_RETIRED=true`，外部 `/api/build/*` 与打包 cron 返回 410；物理表与服务类未删除。

### 安全与兼容

- 签名密钥与 sync/ticket 密钥只从环境变量读取，示例文件不含真实值。
- 包扫描拒绝路径穿越、符号链接、超数量文件和 zip bomb；缺 `skill.json` / `SKILL.md` 拒收。

## [0.18.1] - 2026-07-14

> **开源交付：先锋档增加「已授权域名」登记、突出「可自行无限登记授权」特权，并完善收款配置页提示**。先锋开源明确面向已获授权的用户：购买表单新增「已授权域名」必填项（登记后供运营核对授权），先锋卡片以「核心特权」高亮条突出「可自行无限登记授权、授权域名数量不限」，与免费档「仅限原授权域名」形成对比；免费档文案调整为「对已购买授权的所有人免费开源」。后台「开源交付订单」列表/详情展示购买人已授权域名。收款配置页补充列出两个公开收款页（`/admin/buy`、`/admin/opensource`）及各自回调地址。**新增 migration 仅给 `open_source_orders` 加 `buyer_domain` 列（只增不改），可从 0.18.0 直接在线升级。**

### 新增

- **migration `2026_07_22_000001_add_buyer_domain_to_open_source_orders`**：给订单表加 `buyer_domain`（购买人登记的已授权域名，nullable，位于 `buyer_email` 之后）。仅 `Schema::`、只增不改。
- **开源交付公开页**：先锋购买表单新增「已授权域名」必填项（前端域名格式校验 + 后端归一化去 scheme/路径转小写后落库）；先锋卡片新增「核心特权」高亮条突出「可自行无限登记授权，授权域名数量不限」；两档对比表新增「授权方式」行（先锋=已授权用户可购买 / 可自行无限登记授权，免费=仅限原购买时授权的域名）。
- **后台开源交付订单**：列表购买人栏与详情抽屉展示「已授权域名」。

### 变更

- **免费开源档文案**：由「面向所有人免费公开」调整为「对已购买授权的所有人免费开源（仅桌面端）」，并注明「仅限原购买时授权的域名使用」。
- **收款配置页**：底部提示卡片改为并列展示两个公开收款页——商城授权自助页 `/admin/buy`（回调 `/api/self-serve/mall-auth/notify`）与开源交付页 `/admin/opensource`（回调 `/api/open-source/notify`），二者共用同一微信收款商户。

## [0.18.0] - 2026-07-14

> **新增「开源交付」独立公开页 + 优化后台菜单排序**：授权管理端新增一个免登录页 `/admin/opensource`，展示本项目「先锋开源（¥500，即刻交付桌面端/云控端/授权管理端全量源码 + 未来所有版本 + 开发规则文档 + 交流群）」与「免费开源（8 月底面向所有人一次性开放，仅桌面端）」两档及对比表；先锋档填写购买人信息（姓名/电话/微信号/邮箱）→ 微信 Native 扫码付款 → 回调标记已支付，交付由运营人工完成。收款复用既有微信支付基建（与「自助付费」共用同一收款商户）。同时把后台侧栏菜单按「核心运营 → 共享库 → 收款与交付 → 系统维护」重新分层排序，收款相关（自助付费订单 / 开源交付订单 / 收款配置）统一归入「收款与交付」子菜单。**新增 migration 仅建订单表 `open_source_orders`（只增不改）；无新增 composer 依赖；可从 0.17.x 直接在线升级。升级后如需启用开源交付收款，沿用已配置的微信收款凭据即可。**

### 新增

- **migration `2026_07_22_000000_create_open_source_orders_table`**：新建订单表 `open_source_orders`（`order_no` / `tier` / `buyer_name` / `buyer_phone` / `buyer_wechat` / `buyer_email` / `amount` / `status` / `code_url` / `wx_transaction_id` / `delivered` / `expires_at` / `paid_at` 等）。仅 `Schema::`，不 import Model，遵循只增不改铁律。
- **公开开源交付接口（免登录）`/api/open-source/*`**：`config`（返回档位价格与支付可用性）、`order`（校验购买人信息 + 按档定价 + 微信 Native 下单返二维码）、`order/{orderNo}`（轮询订单状态）、`notify`（微信回调，验签解密后标记已支付，不做任何自动开通）。无 `domain_binding`、按 throttle 限流。
- **`WeChatPayService` 通用下单原语 `nativePrepayRaw`**：从原 `nativePrepay(SelfServeOrder)` 抽出，不绑定具体订单模型，供商城授权与开源交付两类订单复用（原商城授权流程行为不变）。
- **后台「开源交付订单」管理页 + 接口**：`open-source-orders`（列表含购买人姓名/电话/微信/邮箱、详情、主动查单同步、关单、标记交付），供运营付款后按填写信息人工交付（拉群 + 发代码包与文档）。
- **前端**：免登录公开页 `pages/OpenSourceDelivery.tsx`（两档卡片 + 对比表 + 先锋档购买信息表单 → 微信二维码 + 状态轮询）、后台 `OpenSourceOrders.tsx`。

### 变更

- **后台侧栏菜单重排**：按「仪表盘 → 客户端/打包任务/请求记录/模板版本/队列 → 三个共享库 → 收款与交付 → 在线更新/系统设置」自上而下分层；原孤立的「开源交付」入口与「自助付费」子菜单统一并入「收款与交付」子菜单（含自助付费订单 / 开源交付订单 / 收款配置），在线更新与系统设置下沉到底部。纯前端交互调整，不涉及路由与后端。

## [0.17.1] - 2026-07-09

> **修复回调重放导致「已镜像成功的 build 被标 failed + 退配额」**：GitHub Actions 对已完成 run 手工 re-run 会重放 `/api/build/callback`，旧逻辑无条件把 build 重置回 `mirror_status='pending'`——正在镜像 / 已镜像的 build 被重置后，中转 worker 的 ack 会撞 409，重试耗尽后调 fail，而 fail 白名单恰好放行 `pending`，最终把实际已成功的 build 写成 `status='failed'` 并错误退还当日配额；已 purge 的 build 也会被复活成 pending（其 GitHub Release 早已删除，必然失败）。无 migration，可从 0.16.x+ 直接在线升级。

### 修复

- **`BuildCallbackController`：新增 mirror 流水线状态守卫**——build 的 `mirror_status` 已进入 `mirroring` / `mirrored` / `purging` / `purged` 时，成功与失败两种回调重放一律幂等 ack（`{ack: true, idempotent: true}`）并记日志，不再改动任何状态；`pending` / `failed` / 未回调（NULL）时保持原行为，GHA re-run 重新上传产物后重放回调仍是合法的失败恢复路径。

## [0.17.0] - 2026-06-23

> **新增「自助付费开通商城授权」独立公开页**：授权管理端新增一个免登录页 `/admin/buy`，独立部署的云控端运营者可自行输入域名查询三商城（eweishop / 点大商城 / 全端云商城）授权态，勾选未授权的商城（任一 50 元、2~3 个共 100 元），微信扫码付款，付款成功后由回调自动写入对应云控端的商城授权位，无需再由平台管理员手工开关。收款走微信 Native 扫码，收款商户凭据在后台「自助付费 → 收款配置」录入（存 `system_settings`，敏感字段加密）。**新增 migration 仅建订单表 `self_serve_orders`（只增不改）；新增 composer 依赖 `wechatpay/wechatpay`（已随包内 vendor 发布，生产无需 composer）；可从 0.16.x 直接在线升级。升级后需在后台录入微信收款凭据并启用，自助页方可收款。**

### 新增

- **migration `2026_07_21_000000_create_self_serve_orders_table`**：新建订单表 `self_serve_orders`（`order_no` / `client_id` / `domain` / `mall_keys`(JSON) / `amount` / `status` / `code_url` / `wx_transaction_id` / `expires_at` / `paid_at` 等）。仅 `Schema::`，不 import Model，遵循只增不改铁律。
- **公开自助接口（免登录）`/api/self-serve/mall-auth/*`**：`query`（按域名查三商城授权态）、`order`（按勾选未授权数计价下单 + 微信 Native 下单返二维码）、`order/{orderNo}`（轮询订单状态）、`notify`（微信回调，验签解密后自动写授权位）。无 `domain_binding`、按 throttle 限流；计价与「仅对未授权项收费」均由服务端重算，防前端篡改。
- **`MallAuthorizationService`**：收口域名归一化 / 按域名定位客户端 / 读三商城授权 map / 写授权位（含 ewei 双写旧列），与既有 `BuildClientController` / `BuildRequestController` / `VerifyDomainBinding` 口径一致。
- **`WeChatPayService`（Native 扫码）**：从 agent-admin 移植，配置源改为 `SettingService(group=wechat_pay)`，敏感字段（`apiv3_key` / `private_key`）加密存储；含下单 / 关单 / 查单 / 回调验签解密。
- **后台「微信收款配置」页 + 接口**：`settings/wechat-pay`（show / update / test），录入收款商户凭据（商户号 / AppID / 证书序列号 / 商户私钥 / APIv3 密钥 / 验签材料），敏感字段留空不修改。
- **后台「自助付费订单」管理页 + 接口**：`self-serve-orders`（列表 / 详情 / 主动查单同步 / 关单），订单状态、商城、金额一览，支持回调丢失时主动查单补开通。
- **前端**：免登录公开页 `pages/SelfServeBuy.tsx`（域名查询 → 三商城勾选 → 微信二维码 + 状态轮询 → 自动开通）、后台 `SelfServeOrders.tsx` / `WeChatPaySettings.tsx`；侧栏新增「自助付费」子菜单。
- **依赖**：新增 `wechatpay/wechatpay ^1.4`（微信支付 V3 官方 SDK，需 PHP 扩展 openssl / curl / libxml / simplexml，生产 PHP 8.0 默认具备）。

### 说明

- **收款主体**：自助页收款进后台「收款配置」里录入的微信商户号；若复用某已部署云控端的商户号，对账 / 退款会与该云控端混在同一商户号下，请知悉。
- **生效时延**：付款成功即写授权位，对应云控端最长约 90 秒后经 auth-check 自动同步（或在云控端后台「立即刷新」即时生效）。
- **升级后必做一步**：进后台「自助付费 → 收款配置」录入微信商户凭据并启用，自助页方可收款；不配置不影响既有功能。

## [0.16.2] - 2026-06-23

> **补全「全端云商城」店铺商品图授权开关的前端展示**：`frontend/src/pages/Clients.tsx` 的 `MALL_OPTIONS` 早已含 `qdyun`（全端云商城）条目，但 `0.16.0`/`0.16.1` 打包时只重建了后端、未重新构建前端，导致 `backend/public/admin/` 构建产物里 `qdyun` 出现 0 次——授权管理端 UI 上**看不到全端云商城的授权开关**。本版重新构建前端（`tsc -b && vite build`），使全端云授权列/批量开关正常出现。**纯前端构建产物变更，后端代码与 migration 均无改动，无 breaking，可从 0.16.x 直接在线升级。**

### 修复

- **重新构建前端**：使 `MALL_OPTIONS` 中 `qdyun`（全端云商城）的店铺商品图授权开关在「客户端管理」页正常显示（按商城列开关 + 批量开关），此前因前端构建产物滞后于源码而缺失。

## [0.16.1] - 2026-06-23

> **修复派发队列在极端重试下永久卡「入队中(pending)」的 bug**：`BuildDispatchPending` 的「图标上传到仓库失败」与「图标在 ref 上不可见」两条重试分支，未处理达到最大尝试次数（3 次）的情况——第 3 次仍卡在这两步时，build 停在 `status=pending, dispatch_attempts=3`，而派发查询条件 `dispatch_attempts < 3` 不再捞它，导致**永久卡在「入队中」**（StuckDetector 只看 building 卡死，对 pending 无兜底）。本版补齐这两条分支的上限处理，与已有的「dispatch 失败」分支一致：达上限即标 `failed` + 退配额 + 写明确 error_message。**纯后端单文件改动，无 migration、无依赖变更、无 breaking，可从 0.16.0 直接在线升级。**

### 修复

- **`BuildDispatchPendingCommand::dispatchOne`**：「图标上传失败」(`icon_upload_failed_after_3_attempts`) 与「图标在 ref 上不可见」(`icon_not_visible_on_ref_after_3_attempts`) 两条原本只 `return 'retried'` 的分支，补加 `$newAttempts >= MAX_ATTEMPTS` 判断——达上限即标 `failed`、`decrDailyCount` 退配额、写明确 error_message，杜绝 build 因这两步在第 3 次失败而永久卡在 pending。

## [0.16.0] - 2026-06-22

> **「店铺商品图」一级授权从单布尔泛化为按商城（关联表）**：原 `can_use_ewei_shop` 单布尔只能开放一个商城，无法扩展。本版改为按「商城」对每个云控端实例独立授权，可同时给某云控端开放多个第三方商城。**全程向后兼容：旧列 `can_use_ewei_shop` 与旧接口/路由原样保留，auth-check 旧字段不变；新增 migration 仅建关联表 + 回填存量 ewei 授权，遵循只增不改铁律，可从 0.15.x 直接在线升级。** 需配套升级云控端（agent-admin）后端方能消费多商城授权位。

### 新增

- **migration `2026_06_22_000001_create_client_mall_authorizations`**：新建关联表 `client_mall_authorizations`(client_id, mall_key, authorized) + 唯一索引 (client_id, mall_key)；同一 migration 内回填 `authorized_clients.can_use_ewei_shop=1` 的客户端为 `(client_id,'ewei',true)`，避免存量掉权。仅 `Schema::`/`DB::`，不 import Model；不改旧 migration 与旧列。
- **`BuildRequestController` auth-check**：保留旧字段 `can_use_ewei_shop`（= ewei 授权位，老云控端仍读）；新增 `mall_authorizations` map `{ ewei, dianda, ... }`（按 `MALL_KEYS` 从关联表聚合，ewei 缺关联表行时回退旧列）。新增私有方法 `resolveMallAuthorizations()`。
- **`BuildClientController`**：新增通用 `setMallAuth` / `batchSetMallAuth`（入参 `mall_key` 枚举校验 + `authorized`），upsert 关联表；`index()` 列表附每个客户端的 `mall_authorizations` map（聚合）。
- **路由 `routes/admin.php`**：新增 `clients/{clientId}/set-mall-auth`、`clients/batch-set-mall-auth`（保留旧 `set-ewei-shop`/`batch-set-ewei-shop`）。
- **前端 `Clients.tsx`**：客户端列表的「店铺商品图」单开关改为按商城多列开关 + 批量按商城授权弹窗。

### 变更

- **`setEweiShop` / `batchSetEweiShop`**：更新旧列 `can_use_ewei_shop` 的同时同步 upsert 关联表 `('ewei', authorized)`，保证新旧一致。
- **`destroy` / `batchDelete`**：删除客户端时一并清理 `client_mall_authorizations` 关联行，避免遗留孤儿授权。
- **`upsertMallAuth`**：命中已存在行时只更新 `authorized` / `updated_at`，不重置 `created_at`。

## [0.15.1] - 2026-06-22

> **「请求记录」体积优化 + 清空入口**：成功(allowed)记录改为滚动只保留最新 500 条；被拒(denied)记录全部保留，并在页面提供「清空被拒记录」按钮手动清理。**纯后端 + 前端，无新 migration（沿用 0.15.0 的 `authorization_request_logs` 表），无 breaking，可从 0.15.0 直接在线升级。**

### 变更

- **成功记录滚动保留最新 500 条**：`VerifyDomainBinding` 埋点改用 `insertGetId`，成功写入时按 `id % 100` 抽样触发裁剪，把 `result='allowed'` 的记录裁到最新 500 条（全程在 try/catch 内，绝不影响授权主流程）。被拒记录不受影响、全部保留。
- **`auth-log:prune` 命令重定位**：由原先「按天清理」改为「把成功记录裁到最新 `--keep`（默认 500）条」的安全网，调度由每日改为**每小时**。

### 新增

- **「请求记录」页「清空被拒记录」按钮**：新增 `POST /admin/api/auth-requests/clear`（仅删除 `result='denied'` 记录），前端按钮带二次确认弹窗。成功记录由滚动保留策略自动控量，不在清空范围。

### 说明

- 本版不含新 migration，沿用 0.15.0 已建的 `authorization_request_logs` 表；无新依赖、无破坏性变更，可从 0.15.0 直接在线升级。

## [0.15.0] - 2026-06-22

> **授权管理端新增「请求记录」页，用于排查「域名已授权却报未授权」**：记录每次云控端授权校验（`VerifyDomainBinding`）的判定结果，可按 结果 / 原因 / 关键词（origin·host·客户端）/ 时间范围 筛选，直接看到客户端**实际发来的 Origin / host 与拒因**，无需上服务器翻日志即可定位。**含 1 个新增表 migration（`authorization_request_logs`），无新依赖，无 breaking，可从 0.9.0+ 直接在线升级。**

### 新增

- **migration `2026_07_20_000100_create_authorization_request_logs_table`**：新增 `authorization_request_logs` 表（result / reason / origin / host / referer / client_id / client_status / ip / user_agent / admin_version / method / path + 时间戳，含按 reason、host、client_id、created_at 的索引）。仅用 `Schema::` 原生 API + 显式 utf8mb4，不 import 业务 Model。
- **`VerifyDomainBinding` 授权判定埋点**：在 6 个判定分支（`origin_required` / `invalid_origin` / `domain_not_authorized` / `client_inactive` / `client_expired` / 放行 `ok`）各记录一条到 `authorization_request_logs`。整段 try/catch 兜底，写库失败只 `Log::warning` 不抛——**绝不影响授权主流程**；字段按列长截断。
- **管理端「请求记录」页**：新增侧边栏菜单 + 列表页（`GET /admin/api/auth-requests`，`AuthRequestAdminController`）。支持按 结果（成功 / 被拒）、原因、关键词（origin·host·client_id 模糊）、时间范围筛选；默认聚焦「被拒」，展开行查看完整 origin / referer / UA / 请求路径 / IP / 云控端版本。
- **保留清理命令 `auth-log:prune`**：默认保留 30 天，注册到调度每日 03:30 执行，控制日志表体积。

### 说明

- 本版含 1 个**只增**的新表 migration，不改动既有表；无新依赖、无破坏性变更，可从 0.9.0+ 直接在线升级（升级管线自动执行 `migrate`）。
- 反代环境下记录的 `ip` 为直连 IP，如需记录真实客户端 IP 需另行确认 `TrustProxies` 配置。

## [0.14.2] - 2026-06-22

> **修复云打包图标 commit 竞态导致的 inject 失败（`.build-icons/{build_id}.png` ENOENT）**：密集 / 批量派发时，图标刚 commit 到打包仓库 `main`、紧接着 `workflow_dispatch` 解析 `ref=main` 会落到尚未含该图标的旧 SHA，导致 GitHub Actions checkout 缺图标、inject 整次失败（mac 与并发场景高发，win 偶发）。本版双层防御：派发前确认图标可见 + 把云端图标 URL 透传给 workflow 作兜底下载源。**纯后端，无 migration、无新依赖、无 breaking。**

### 修复

- **`BuildDispatchPendingCommand` 派发前图标传播确认**：commit 图标后、`dispatch` 前先留传播间隔并轮询确认图标已在 ref 上可见（新增 `GitHubDispatchService::fileExistsOnRef`，最多 4×2s）；始终不可见则本轮不派发、下一 cron tick 重试，避免浪费 GitHub Actions 配额跑必败构建。直接降低「一个 cron tick 连发多条」时的竞态发生率。
- **透传 `icon_url` 兜底下载源**：dispatch inputs 新增 `icon_url`（= `build_request.icon_path`，云控端公开图标 URL）。配合打包仓库 workflow / inject 改动（已随桌面端 0.9.1 发布到打包仓库 `main`），当仓库内 commit 的图标因竞态在 checkout 时缺失，inject 改从该 URL 下载，构建不再因图标缺失而整次失败。

### 说明

- 本版为纯后端改动，无数据库 migration、无新依赖、无破坏性变更，可从 0.9.0+ 直接在线升级。
- 兜底下载需打包仓库（`local-agent-build`）的 workflow 增加 `icon_url` 入参 + inject 支持 `ICON_URL`（已发布到打包仓库 `main`）。两者配合后图标竞态彻底消除（第 1 层降发生率、第 2 层兜底必过）。

## [0.14.1] - 2026-06-21

> **修复「店铺商品图」授权开关回显 + 补全批量授权入口**：在「客户端管理」开启某云控端的店铺商品图授权后，提示「已开放」但开关随即回弹为关闭的问题已修复（根因：列表接口未返回 `can_use_ewei_shop` 字段）；同时补上 0.14.0 已宣称但 UI 实际缺失的「批量开放 / 关闭店铺商品图」按钮。**纯后端字段补全 + 前端，无 migration、无新依赖、无 breaking。**

### 修复

- **`BuildClientController::SELECT_COLS` 补 `can_use_ewei_shop`**：`index()` / `show()` 返回客户端列表时漏列该字段，导致前端开关切换成功（已写库、`auth-check` 也已正确下发）后，列表重拉（`invalidateQueries`）拿不到该字段，`Switch` 的 `checked` 变为 `false` 而回弹，造成「提示已开放但实际没开通」的错觉。补列后管理后台回显与实际授权状态一致。

### 新增

- **「客户端管理」批量开放 / 关闭店铺商品图**：前端补上 `batchSetEweiShop` 的两个批量按钮（接已存在的后端 `clients/batch-set-ewei-shop` 接口）。0.14.0 的 changelog 已提及「批量切换」，但当时批量 UI 按钮实际未接入，本次补全。

### 说明

- 本次无数据库 migration（`can_use_ewei_shop` 列在 0.14.0 已加）；无新依赖、无破坏性变更，可从 0.9.0+ 直接在线升级。

## [0.14.0] - 2026-06-20

> **「店铺商品图」功能授权开关（第一级门控，配合云控端 1.6.8 + 桌面端 0.9.0）**：在「客户端管理」中按云控端实例开关 `can_use_ewei_shop`，并通过 `GET /api/build/auth-check` 下发；云控端据此再对旗下用户做 per-user 二级门控，未授权则桌面端不显示「店铺商品图」入口。**含 1 个新增列 migration（`can_use_ewei_shop`，默认 false），无新依赖，无 breaking。**

### 新增

- **migration `2026_06_20_000001_add_can_use_ewei_shop_to_authorized_clients`**：`authorized_clients` 表新增 `can_use_ewei_shop` 布尔列（默认 `false`），位于 `is_hub_reviewer` 之后；仅用 `Schema::` 原生 API + `hasColumn` 幂等守卫，不 import 业务 Model。
- **`backend/app/Http/Controllers/Build/BuildRequestController.php@authCheck`**：`/api/build/auth-check` 响应新增 `can_use_ewei_shop`（`(int)($client->can_use_ewei_shop ?? 0) === 1`），供云控端拉取第一级授权。
- **`backend/app/Http/Controllers/Admin/BuildClientController.php`**：新增 `setEweiShop`（单个开关）、`batchSetEweiShop`（批量开关）。
- **路由 `backend/routes/admin.php`**：新增 `clients/{clientId}/set-ewei-shop`、`clients/batch-set-ewei-shop`。
- **前端「客户端管理」**（`frontend/src/pages/Clients.tsx` + `api/clients.ts` + `types/index.ts`）：新增「店铺商品图」`Switch` 列、`setEweiShopMut` 单切与批量切换，类型与接口同步补 `can_use_ewei_shop`。

### 说明

- 默认拒绝（`can_use_ewei_shop` 默认 `false`）：升级后所有云控端实例默认未授权，需在「客户端管理」手动开启对应实例后，其旗下用户才可能看到该功能。
- zip 包带 `database/migrations/` 全量目录；线上更新执行 migration 自动补列，存量数据无影响。

## [0.13.0] - 2026-06-11

> **授权域名支持 IP 部署 + 拒绝响应标准化（配合云控端 1.6.3「站点身份自动解析」）**：授权域名录入支持纯 IP / IP:端口 / 不带 http(s) 前缀，统一归一化存储并按 host 级查重；限流 429 等框架级拒绝响应补齐 `error` 错误码，老版本云控端不再显示「agent-build 拒绝：unknown」。**无 migration、无新依赖、无 breaking。**

### 变更

- **`backend/app/Http/Controllers/Admin/BuildClientController.php`（`store` / `update` / `batchImport`）**：`domain` 校验从 Laravel `url` 规则（强制带 scheme，纯 IP 被拒）放宽为自定义归一化 `normalizeDomainInput`——支持域名 / 纯 IP / IP:端口 / 带不带 http(s) / 尾斜杠 / 大小写混写，统一归一化为 `https://host[:port]` 形态存储（IP 部署的云控端是受支持的授权形态）。查重从「字符串精确相等」改为 host 级宽松比对 `domainHostTaken`（与 `VerifyDomainBinding` 慢路径同款）：`https://a.com` 与 `a.com`、同 IP 不同端口不再被当成两个不同授权重复录入。
- **前端「客户端管理」**（`frontend/src/pages/Clients.tsx`）：单个添加表单的 `type: 'url'` 校验改为同款归一化校验（纯 IP 不再被前端拦截），label / placeholder / 提示文案同步更新；批量导入提示从「必须 http(s):// 开头」改为「支持域名 / IP / IP:端口，可不带前缀」（后端归一化兜底）。移除两处文案中已废弃的 notify_url 描述（0.3.0 已删除该机制）。

### 修复

- **限流 429 响应无 `error` 字段**：`app/Exceptions/Handler.php` 新增 `ThrottleRequestsException` 渲染——`/api/*` 与 expectsJson 请求的 429 由 Laravel 默认 `{message: "Too Many Attempts."}`（云控端解析不出原因，只能显示「agent-build 拒绝：unknown」）改为 `{error: "rate_limited", message: "请求过于频繁，请 N 秒后重试", retry_after}`，所有版本云控端都能翻译出人话。

### 说明

- 存量授权数据无需处理：`VerifyDomainBinding` 比对一直是 host 级宽松匹配，旧形态（带 scheme / 大小写混写）继续有效；归一化仅作用于新录入与编辑保存。
- 配合云控端 1.6.3 效果最佳（站点身份自动解析 + 失败自愈 + `http_*` 错误码翻译）；对旧版云控端完全兼容。

## [0.12.1] - 2026-06-08

> **图标非 PNG 兜底拦截**：派发打包前对下载到的图标做 PNG 校验，非 PNG（如 JPEG）直接判失败并写清原因，不再上传到 GitHub 仓库、不再浪费整次 GitHub Actions 配额，也避免云控端只看到无原因的「失败」。**无 migration、无新依赖、无 breaking。**

### 修复

- **`backend/app/Console/Commands/BuildDispatchPendingCommand.php`**：`dispatchOne` 在 `downloadIcon` 之后、上传到 GitHub 仓库之前，新增图标内容兜底校验 `validateIconBytes`（PNG 魔数 + `getimagesizefromstring` 校验真实 PNG + 1:1 正方形 + 512×512–1024×1024，不依赖 GD 扩展）。非 PNG / 尺寸不合规属内容问题，不重试，直接标记 `failed` + 退还当日配额 + 写入明确中文 `error_message`（经 `GET /api/build/status/{id}` 回传，云控端可见）。
- **堵住的缺口**：此前云控端若漏校验（如未升级的老版本云控端），非 PNG 图标会被原样 `base64` 上传到 GitHub，直到 `inject-build-params.js` 的 `validatePng` 才报晦涩的 `magic mismatch`，整次 Actions 配额浪费、失败记录无可读原因。

### 说明

- 普通打包与 OEM 打包共用同一派发链路（`build:dispatch-pending`），本兜底对两者同时生效。
- 配套云控端 agent-admin 已在「OEM 项目保存 / 发起打包」「普通云打包发起 / 图标落库」处增加同一套 PNG 严格校验：云控端为第一道防线、本兜底为第二道。云控端可独立升级，不强制配套。

## [0.12.0] - 2026-06-08

> **维护期指定客户端可打包豁免**：新增「维护期可打包」客户端级豁免开关。开启全局「云打包维护」后，仍可针对指定云控端放行打包，用于在维护期做生产测试 / 灰度验证。**含 migration（`authorized_clients` 加 `maintenance_exempt` 字段，只增不改）、无新依赖、无 breaking。**

### 新增

- **`backend/database/migrations/2026_07_20_000000_add_maintenance_exempt_to_authorized_clients.php`**：`authorized_clients` 表新增 `maintenance_exempt` 布尔字段（默认 false）+ `idx_maintenance_exempt` 索引，标记该云控端是否在平台维护期仍可打包。遵循 migration 铁律（新文件、仅 `Schema::`、只增不改）。
- **客户端级维护豁免开关**：`backend/app/Http/Controllers/Admin/BuildClientController.php` 新增 `setMaintenanceExempt` / `batchSetMaintenanceExempt`，路由 `POST /admin/api/clients/{clientId}/set-maintenance-exempt`、`POST /admin/api/clients/batch-set-maintenance-exempt`，支持单个 / 批量任命。
- **前端「客户端管理」新增「维护期可打包」开关列 + 批量设为 / 取消按钮**（`frontend/src/pages/Clients.tsx`）；「系统设置」维护卡片补充豁免例外说明（`frontend/src/pages/Settings.tsx`）。

### 变更

- **`backend/app/Http/Controllers/Build/BuildRequestController.php`（`request` / `authCheck`）**：维护闸门由「全局一刀切」改为「全局开关 && 非豁免客户端」。被豁免客户端在维护期 `auth-check` 返回 `maintenance=false`、提交打包不再被 503 拦截；`auth-check` 额外返回 `maintenance_active` / `maintenance_exempt` 字段供云控端展示提示（老前端忽略多余字段无害）。

### 说明

- 豁免仅作用于「维护开关」，**不豁免日 / 月配额**，也不绕过客户端停用 / 过期校验（`VerifyDomainBinding` 中间件层先行拦截）。
- 普通打包与 OEM 打包共用同一 `POST /api/build/request` 端点，豁免对两者同时生效。
- 云控端 `agent-admin` 无需改动即可在维护期正常打包；如需在豁免客户端页面显示「平台维护中但本站已豁免」提示，可后续基于新返回字段增强。

## [0.11.1] - 2026-06-07

> **0.11.0 监控阈值适配 mac 大包**：0.11.0 的中转监控按「固定时长」一刀切判定,会把 mac 包(arm64 + x64 两个 100MB+ zip,家庭电脑梯子跨境下载常需 40-60 分钟)正在正常下载的状态误报成「卡住 / worker 离线」。本版改为按中转阶段分别判定,消除误报。**无 migration、无新依赖、无 breaking。**

### 修复

- **`backend/app/Console/Commands/MirrorWatchdog.php`**:告警触发从「按时长一刀切 + 依赖心跳」改为两个业务信号——`pending` 超 30 分钟未被领取(worker 未在轮询)、`mirroring` 超 90 分钟未完成(下载卡死 / 跨境过慢)。worker 正常下大包(mirroring 且在 90 分钟窗口内)不再误报;心跳降级为告警内的辅助诊断信息(worker 串行下大包期间不轮询、心跳会停更,属正常)。
- **`backend/app/Http/Controllers/Build/MirrorWorkerController.php`**:领取超时 `ASSIGNMENT_TIMEOUT_MINUTES` 由 15 分钟放宽到 90 分钟,避免 mac 包下载 40-60 分钟期间 `mirror_assigned_at` 未更新而被误判超时、重复领取重复下载。

### 变更

- **`backend/app/Http/Controllers/Admin/AlertSettingController.php` + 前端「系统设置」**:worker 状态由「在线 / 离线」两态扩展为「在线 / 忙碌(下大包)/ 离线」三态。心跳停更但有 build 正在 mirroring 时显示「处理中」,不再误显示「离线」。
- **前端「打包任务」中转列**(`frontend/src/pages/Requests.tsx`):卡住判定按阶段区分——`pending` 用 30 分钟、`mirroring` 用 90 分钟(基准为领取时间 `mirror_assigned_at`)。正常下大包期间显示蓝色「中转中」而非红色「卡住」。

### 说明

- 纯阈值 / 判定逻辑调整,仍复用既有 `system_settings` 与 `build_requests` 字段,无表结构变更。
- 阈值依据:实测家庭电脑梯子跨境拉 GitHub 约 100KB/s,单个 mac 100MB+ zip 约需 20 分钟,arm64 + x64 合计 40-60 分钟,90 分钟阈值留足 buffer。根治仍建议迁移到香港 / 新加坡 VPS(机房带宽 + 去单点)。

## [0.11.0] - 2026-06-07

> **打包交付链路可观测性增强 + 兜底清理修复**：新增「mirror 中转看门狗 + 多渠道告警 + 后台中转状态可视化」，并修复 24h 兜底清理会把中转卡住的包静默清成「已过期」的破坏性逻辑。针对「家庭电脑 mirror worker 故障 → 打包静默卡在『已完成』、运维无感知、24h 后还被误清」的运维盲区。**无 migration、无新依赖、无 breaking。**

### 新增

- **`backend/app/Services/Build/BuildAlertService.php`**：多渠道 webhook 告警服务，支持钉钉 / 企业微信 / 飞书 / Server 酱 / 自定义 Webhook；配置存 `system_settings`（group=`alert`，`webhook_url` 加密）。
- **`backend/app/Console/Commands/MirrorWatchdog.php`**（`build:mirror-watchdog`，每 5 分钟）：补 `build:stuck-detector` 的盲区——检测「`success` 后中转卡 >20 分钟」与「mirror worker 失联 >10 分钟」，按 30 分钟冷却推送告警，故障恢复后自动发恢复通知。已注册进 `Console/Kernel.php`，跟随现有 `schedule:run` 执行，无需额外配置 cron。
- **`backend/app/Http/Controllers/Admin/AlertSettingController.php`** + 路由 `GET/PUT /admin/api/settings/alert`、`POST /admin/api/settings/alert/test`：告警配置读写、发送测试，并回传 mirror worker 在线状态与当前卡住数。
- **mirror worker 心跳**：`MirrorWorkerController::pending` 每次被 poll 时记录 `system_settings`（group=`mirror`，`worker_last_poll_at`），供看门狗与后台判定 worker 在线 / 离线。
- **前端「系统设置」新增「中转告警通知」Card**：启用开关 + 渠道选择 + Webhook + 关键词 + 发送测试，并实时展示 worker 在线状态 / 最后心跳 / 当前卡住数。
- **前端「打包任务」列表新增「中转」列**：展示 mirror 状态；`success` 但中转卡 >20 分钟时显示红色「卡住 X 分钟」并整行高亮，运维可一眼区分「打包失败 / 中转卡住 / 云控端未拉」。

### 修复

- **`backend/app/Console/Commands/BuildAckTimeout.php`**：修复 24h 兜底清理的破坏性逻辑。旧实现把所有「`success` 超 24h」一刀切 `purge + expired`，会把因 mirror 中转长期故障而卡住的包静默清成「已过期」且无人知情。新实现按 `mirror_status` 分流：`mirrored`（已中转、仅云控端未 ACK）维持 `purge + expired`；中转从未完成（`pending/mirroring/failed/NULL`）改标 `failed`（语义=交付失败、前端醒目、支持重试）并写明根因 + 推送告警。

### 变更

- **`backend/app/Http/Controllers/Admin/BuildAdminRequestController.php`**：打包任务列表接口补充返回 `mirror_status` / `mirror_assigned_at` / `mirror_acked_at`，供前端展示中转状态与卡住判定。

### 说明

- 复用既有 `system_settings`（加密 KV）与 `build_requests` 的 mirror 字段，**无新增表 / 字段、无 migration、无 composer 依赖变更**。
- 升级后需在 admin →「系统设置」→「中转告警通知」配置 webhook 并启用，告警方能生效；钉钉 / 企业微信若用「自定义关键词」安全设置，需在「关键词」填一个会出现在消息里的词。
- 与云控端 agent-admin、桌面端 agent-desktop **完全无关**，不要求配套升级。

## [0.10.1] - 2026-06-06

> **时区修复**：管理后台各列表 / 详情页的时间显示统一为北京时间。

### 修复

- **`backend/config/app.php`**：应用时区由 `UTC` 改为 `Asia/Shanghai`。此前 `now()` 与各 `datetime` 字段按 UTC 写库，而 `DB::table()` 返回的是不带时区标识的裸字符串，前端 `dayjs` 又按浏览器本地时区直接渲染，导致「打包任务」等页面的「创建时间」显示为 UTC（比北京时间慢 8 小时）。改后写入、显示、筛选统一为北京时间。
- **`frontend/src/pages/Requests.tsx`**：打包任务列表的日期范围筛选传参由 `toISOString()`（UTC）改为本地时间字符串 `YYYY-MM-DD HH:mm:ss`，与切换为北京时区后的 `datetime` 存储值对齐，避免按日期筛选偏移 8 小时。

### 说明

- 仅影响切换后新写入的数据；本次发布前已存在的历史记录仍按 UTC 存储，显示上会偏早 8 小时（属预期现象，本次未做历史数据迁移）。
- 后端其余时间逻辑（`now()` 与 `datetime` 比较、配额按天、`time()` 纯时间戳、签名 TTL 等）经评估在切换时区后保持自洽，无需改动。

## [0.10.0] - 2026-06-04

> **智能体共享库（Agent Hub）上线**：授权管理端新增智能体 Hub，与创意模板 / 灵感共享库并行——支持云控端提交共享智能体、平台众审、公开浏览、举报、下载统计，以及分类 / 阈值管理。鉴权复用域名绑定（`VerifyDomainBinding`）+ 审核员（`authorized_clients.is_hub_reviewer`），未引入新鉴权体系。含 1 个 migration。**与云控端 agent-admin ≥ 1.5.32 配套。**

### 新增

- **`backend/database/migrations/2026_07_16_000100_create_shared_agent_tables.php`**：新增 `shared_agents` / `shared_agent_categories` / `shared_agent_reviews` / `shared_agent_reports` 表；字段含 `avatar`(2:3) / `system_prompt` / `tool_skill_ids` / `tool_approval` / `enable_image_gen` / `tags` / 分类 / 来源站点 / 计数 / 审核态；唯一键 `(source_client_id, source_local_id)`，外键级联到 `authorized_clients.client_id`。
- **`backend/app/Http/Controllers/Hub/AgentHubController.php`**：对外 Hub 接口 `me` / `categories` / `list` / `show` / `submit` / `status-batch` / `by-source` 撤回 / `pending-list` / `review` / `download` / `report`（设置组 `agent_hub`：通过 / 驳回 / 举报阈值 + 日提交上限）。
- **`backend/app/Http/Controllers/Admin/SharedAgentController.php` / `SharedAgentCategoryController.php` / `SharedAgentReportController.php` / `AgentHubSettingsController.php`**：平台运营后台（强制通过 / 驳回、上下架、批量删、统计、分类 CRUD、举报池、阈值设置）。
- **`backend/app/Models/SharedAgent.php` / `SharedAgentCategory.php` / `SharedAgentReview.php` / `SharedAgentReport.php`**。
- 路由：`routes/api.php` 新增 `agent-hub` 组（`domain_binding` + `throttle`；`pending-list` / `review` 叠加 `hub_reviewer`）；`routes/admin.php` 新增 `shared-agent*` 后台组（`auth:sanctum`）。
- 前端：`src/api/sharedAgentHub.ts` + `src/pages/SharedAgents.tsx` / `SharedAgentCategories.tsx` / `SharedAgentReports.tsx` / `SharedAgentSettings.tsx` + 侧边栏「共享智能体库」菜单。

### 说明

- 复用现有 `authorized_clients` 授权与 `is_hub_reviewer`：已授权云控端站点自动可用智能体共享库，审核员在 admin 后台「客户端」页任命，无需新授权配置。
- `me()` 接口补充返回 `domain` / `site_name`（`owner_name`），供云控端待审池展示本站身份。

## [0.9.0] - 2026-05-24

> **创意模板共享库上线**：授权管理端新增创意模板 Hub，支持云控端提交共享模板、平台审核、公开浏览、举报、下载统计和分类/阈值管理，能力与共享灵感库保持并行。

### 新增

- **`backend/database/migrations/2026_05_24_000100_create_shared_creative_template_tables.php`**：
  - 新增共享创意模板分类、模板、审核投票和举报表。
  - 支持封面图、示例参考图、变量字段、提示词模板、来源类型、来源图、来源站点、下载次数、举报次数和审核状态。

- **`backend/app/Http/Controllers/Hub/CreativeTemplateHubController.php`**：
  - 新增创意模板 Hub 对外接口，支持列表、详情、提交、待审池、审核投票、状态批量查询、举报、下载计数和撤回。
  - 列表支持按分类、关键词、排除本站内容和下载热度排序。
  - 待审和公开池返回 `category_id` / `category_name` / `category_slug`，便于云控端统一展示分类信息。

- **`backend/app/Http/Controllers/Admin/SharedCreativeTemplate*Controller.php`**：
  - 新增平台后台共享创意模板管理、分类管理、举报管理和审核阈值配置。
  - 复用授权客户端审核员身份，审核员可进入待审池投通过或拒绝票。

- **`frontend/src/pages/SharedCreativeTemplates.tsx` / `frontend/src/pages/SharedCreativeTemplateCategories.tsx` / `frontend/src/pages/SharedCreativeTemplateReports.tsx` / `frontend/src/pages/SharedCreativeTemplateSettings.tsx`**：
  - 新增共享创意模板后台页面，支持模板检索、状态筛选、显示开关、举报处理、分类维护和共享库设置。
  - 左侧菜单和路由新增共享创意模板入口，与共享灵感库管理入口并行。

### 修复

- **`backend/app/Http/Controllers/Hub/CreativeTemplateHubController.php`**：
  - 修复公开池 `sort=popular` 未按下载次数排序的问题，现按 `download_count desc, id desc` 返回。

### 兼容性

- 本版为向后兼容加法更新，不影响已有云打包、共享灵感库和授权客户端鉴权接口。
- 旧云控端不调用创意模板 Hub 接口时行为不变；新云控端可在配置 Hub 后启用共享创意模板能力。

---

## [0.8.0] - 2026-05-22

> **共享灵感库参考图与生成尺寸增强**：授权管理端共享灵感库支持接收、审核、展示和下发多张参考图及生成尺寸。云控端分享到 Hub、平台审核、其他云控端拉回本地时，可完整保留灵感的参考图上下文和原始构图尺寸。

### 新增

- **`backend/app/Http/Controllers/Hub/InspirationHubController.php`**：
  - `POST /api/inspiration-hub/submit` 支持 `ref_images` 和 `generation_size`。
  - 共享灵感列表、详情、待审列表同步返回参考图数组和生成尺寸。
  - 参考图最多保留 8 张，生成尺寸最长 50 字符。

- **`backend/app/Http/Controllers/Admin/SharedInspirationController.php`**：
  - 平台后台共享灵感池列表和详情支持返回参考图数组。
  - 审核员查看待审灵感时可同时看到参考图和生成尺寸。

### 兼容性

- 老云控端不传参考图或生成尺寸时，Hub 按空数组和空值处理，原有分享流程不受影响。
- 本版为向后兼容加法更新，非 breaking。

---

## [0.7.4] - 2026-05-20

> **OEM 打包版本统一跟随当前模板版本**：授权管理端不再接受外部请求覆盖 OEM 打包版本，所有普通打包和 OEM 打包都统一使用后台当前模板版本，避免云控端或用户侧误填版本导致客户端版本体系不一致。

### 变更

- **`backend/app/Http/Controllers/Build/BuildRequestController.php`**：
  - `POST /api/build/request` 不再接收 `app_version` 参数
  - 打包版本统一取 `template_versions.is_current = 1` 的当前模板版本
  - 当没有当前模板版本时，仍沿用原有回退值 `0.0.0`

### 兼容性

- 普通云打包流程不变，原本就由授权管理端当前模板版本决定
- OEM 打包仍保留独立 `oem_project_key`、`app_id`、`update_path`
- 返回给云控端的 `app_version` 仍是最终实际打包版本，可继续用于构建历史和安装包关联展示

### 验证

- `php -l backend/app/Http/Controllers/Build/BuildRequestController.php` 通过

---

## [0.7.3] - 2026-05-20

> **补齐 OEM 打包服务端支持**：授权管理端的云打包提交接口支持 `build_mode=oem`，可接收云控端传入的 OEM 项目 Key、独立 App ID、独立更新目录和扩展构建参数，并把这些参数贯穿到构建记录、状态查询、下载信息和 GitHub Actions 分发输入中。普通云打包仍走 `build_mode=normal` 默认路径，保持兼容。

### 新增

- **`backend/database/migrations/2026_05_20_130500_add_oem_fields_to_build_requests.php`**：
  - `build_requests` 新增 `build_mode`、`oem_project_key`、`app_id`、`update_path`、`build_options` 字段
  - 新增 `idx_build_mode_oem_project` 索引，支持 OEM 项目维度的互斥与查询

- **`backend/app/Http/Controllers/Build/BuildRequestController.php`**：
  - `POST /api/build/request` 新增 OEM 参数校验：OEM 模式必须传 `oem_project_key`、`app_id`、`update_path`
  - OEM 更新目录强制匹配 `/updates/oem/{project_key}/`，防止提交端伪造跨项目更新路径
  - 状态查询、下载响应、列表接口回传 `build_mode`、`oem_project_key`、`app_id`、`update_path`，方便云控端回拉后落盘到独立 OEM 目录

- **构建分发链路**：
  - GitHub Actions 分发输入补充 OEM 相关字段，让桌面端构建时可写入独立应用标识和独立更新地址

### 兼容性

- 普通云打包不需要传任何新字段，服务端会默认 `build_mode=normal`
- 旧云控端继续按原有参数提交，不受 OEM 字段影响
- 本版为向后兼容加法更新，非 breaking

### 验证

- 新 migration 仅使用 `Schema::` 原生 API，未引入业务 Model
- OEM 字段为 nullable/default 兼容历史 `build_requests` 记录

---

## [0.7.2] - 2026-05-14

> **域名鉴权放宽：从严格字符串相等改为按 host 模糊匹配**：`VerifyDomainBinding` 中间件原先以「`rtrim($origin, '/')` 与 `authorized_clients.domain` 字符串完全相等」为唯一判定条件，对反代下 Origin 推导差异（端口 `:443` 后缀、协议 `http://` vs `https://`、尾斜杠、大小写、www 前缀）极度敏感。云控端经多层反代时如果 Laravel `getSchemeAndHttpHost()` 推导出与数据库存储域名格式不一致的 Origin，会被误判为「域名未授权」403。本版改为「快路径精确匹配 + 慢路径 host 模糊比较」两段式策略：老配置走快路径（保留索引命中、零开销）；命中失败时再 fallback 到 PHP 端解析 host 后大小写不敏感比较，端口 / 协议 / 尾斜杠 / 大小写 / www 前缀都不再敏感。**仅 1 个中间件文件变更**，无新数据库迁移、无 composer 依赖变更、无前端变更。**与 0.7.1 完全兼容**（鉴权条件只放宽不收紧）。

### 改进

- **`backend/app/Http/Middleware/VerifyDomainBinding.php`**：重写 `handle` 方法的 client 查找逻辑
  - **快路径**：保留原 `where('domain', $normalizedOrigin)->first()` 索引扫描；老配置零影响、零额外开销
  - **慢路径**（仅快路径未命中时触发）：`DB::table('authorized_clients')->get()` 全表 + PHP `foreach` 遍历，对每行 `$row->domain` 用新增的 `extractHost()` 解析出 host，与传入 Origin 解析出的 host 用 `strcasecmp` 比较；命中即视为同一客户端
  - 新增 `private extractHost(string $value): ?string`：兼容 4 种 host 形态——带 scheme / 不带 scheme / 大小写 / 中文 IDN（按 punycode 处理与 DB 存储一致）。无 scheme 时临时补 `https://` 让 `parse_url` 走 host 分支，提取后 `strtolower` 标准化；提取失败返 null（外层判 403 `invalid_origin`）
  - 入口前做 `extractHost` 校验：传入 Origin 完全无法解析（畸形输入）直接 403 `invalid_origin`，不再触发慢路径全表扫
  - 后续 `status` / `expires_at` 校验、`request->attributes->set('authorized_client', $client)` 注入逻辑保持原状
- **影响范围**：覆盖 `Route::middleware(['domain_binding'])` 的两组路由——`/api/build/*`（云打包，已正常运行）+ `/api/inspiration-hub/*`（共享灵感库，0.7.0 引入）。云打包之前因为客户端站点 Origin 推导格式碰巧与 DB 存储一致而正常；共享灵感库会触发更频繁的 PHP 出站调用（云控端 `InspirationHubClient` 自动从 `request()->getSchemeAndHttpHost()` 推导 Origin），更易暴露差异问题
- **安全性**：仍按白名单放行（`status = 'active'` + 未过期）；慢路径用 PHP 端**精确 host 比较**（`strcasecmp(extractHost($a), extractHost($b))`），**不**用 SQL `LIKE %host%`，避免 `evil-ai.chaoranai.com.x.com` 这类子串子域名劫持
- **性能**：`authorized_clients` 表通常 < 几百行；慢路径触发时 1 次全表 SELECT + PHP foreach 扫描，毫秒级。绝大部分老配置（DB 存储与 Origin 完全一致）走快路径，零额外开销

### 兼容性

- **与 0.7.1 完全兼容**：仅放宽鉴权条件（原本通过的所有 Origin 仍然通过；原本被挡的部分错误格式 Origin 现在也通过），不会让原本通过的 Origin 变成 403
- **域名白名单零变更**：`authorized_clients.domain` 字段存储格式（如 `https://ai.chaoranai.com`）保持不变，平台后台「客户端管理」UI 没有任何改动
- **拒绝行为保持**：未授权域名（任何形式）仍然 403 `domain_not_authorized`；非 active / 已过期客户端仍然 403 `client_inactive` / `client_expired`；畸形 Origin 仍然 403（响应 code 从原先的「精确匹配未命中」走 `domain_not_authorized` 改为 `invalid_origin`，更精准）
- **HMAC 签名 / 时间戳 / client_id / client_secret** 仍然不校验（0.2.0 起就已下线，本版不做改变）

### 升级说明

- **管理后台「在线更新」一键升级即可**（与 0.7.1 流程一致）。本版无新数据库迁移、无 composer 依赖变更、无 .env 必需变更
- 升级后建议对**之前疑似「域名未授权」403** 的云控端站点重测一次连通（如管理后台「健康检查」按钮、云打包页 `auth-check` 接口），看是否在新逻辑下转为通过

### 设计要点

1. **快路径 + 慢路径分层**：原本计划直接全部走 host 模糊匹配，但担心生产 `authorized_clients` 行数增长后慢路径开销线性放大。两段式让 99%+ 流量（已正常配置的客户端）走 O(1) 索引扫描，剩下少数边缘格式才走 O(N) 全表，权衡了性能与兼容性
2. **PHP 端 host 比较 vs SQL LIKE**：考虑过 `where('domain', 'like', '%' . $host . '%')` 缩小慢路径候选行，但任何带 LIKE 的方案都要在 PHP 端再做一次精确 host 比较防子串劫持，与直接全表选 + foreach 区别只在 candidate 数量。表数据量小时 LIKE 反而因 SQL 解析 + IndexCondition 评估略慢
3. **`extractHost` 不解码 IDN punycode**：浏览器对 IDN 域名（含中文等非 ASCII 字符）的 Host 头都已编码为 punycode（如 `xn--fiqs8s`），`parse_url` 对编码后的 URL 返回也是 punycode 形式；与 `authorized_clients.domain` 平台后台填写的形式一致（一般也填 punycode）。**不要**额外做 `idn_to_utf8` 解码，否则 `$incomingHost`（编码）vs `$rowHost`（解码）会比对失败
4. **快路径仍依赖 `rtrim`**：保留 0.7.1 已有的 `rtrim(trim($origin), '/')` 标准化（去尾斜杠 + 去前后空白），让 99% 配置零行为变化命中
5. **`invalid_origin` 与 `origin_required` / `domain_not_authorized` 的区别**：`origin_required`（请求完全没 Origin / Referer）/ `invalid_origin`（Origin 字符串完全无法 parse 出 host，畸形输入）/ `domain_not_authorized`（host 解析成功但白名单里没匹配）三档错误，便于 admin 排查

---

## [0.7.1] - 2026-05-14

> **共享灵感库标准分类 v1→v2 编排**：14 个混排分类改为 15 个分组式编排（题材 6 + 风格 6 + 用途 3）。复用 10 个已有 slug、新增 5 个商用向 slug、不再 seed 4 个偏风格关键词的 slug。**附带**：补 `backend/config/version.php` 在 0.7.0 发版时漏改（0.6.1 → 0.7.1，跳过 0.7.0）。**非 breaking、与 0.7.0 完全兼容**。

### 变更

- **`backend/database/seeders/SharedInspirationCategorySeeder.php`**：分类列表从 14 项改为 15 项 + `sort_order` 显式分组编号（题材 0-50、风格 60-110、用途 120-140）
  - 复用 slug（10 个）：`portrait` / `landscape` / `architecture` / `food` / `pets` / `photography` / `illustration` / `anime` / `chinese-style` / `3d-render`
  - 新增 slug（5 个）：`product`（商品产品）/ `minimalism`（极简平面）/ `poster`（海报封面）/ `logo`（Logo 标识）/ `wallpaper`（壁纸背景）
  - 不再 seed（4 个）：`fashion` / `sci-fi` / `fantasy` / `cyberpunk`（更适合写在 prompt 而非顶层分类，且 fashion 与 portrait + product 高度重叠）
- **`backend/config/version.php`**：补 0.7.0 发版时漏改（CDN 已 `latest=0.7.0` 但本地 version.php 仍为 0.6.1），本次由 0.6.1 直接同步到 0.7.1
- **seeder 注释扩充**：补 v1→v2 变更说明 + 「不主动 DELETE 4 个废弃 slug 的旧行（可能仍有灵感引用），由平台后台手工删」的兜底策略

### 兼容性

- **`updateOrInsert` 按 slug 幂等**：已 seed 过 0.7.0 的站点重跑 seeder，复用的 10 个 slug 只更新 `name` / `sort_order`；新增的 5 个 slug 会 insert；**4 个废弃 slug 不被自动 DELETE**（避免破坏可能存在的灵感外键引用），由平台后台「分类管理」按需手工删除（删前 `SharedInspirationCategoryController::destroy` 会做关联灵感校验）
- **slug 全部保持原值不变**：复用的 10 个 slug 与 v1 完全一致，云控端用 slug 做本地映射缓存的场景零影响
- **未 seed 过的全新站点**：直接 seed 出 15 个分类，无 v1 包袱

### 升级说明

- **管理后台「在线更新」一键升级即可**（与 0.7.0 流程一致）。本版无新数据库迁移、无 composer 依赖变更
- **跑 seeder 让新分类生效**（在线更新本身不会自动调 seeder，需要 SSH 执行一次）：
  ```bash
  cd /www/wwwroot/your-build-domain.example.com/backend
  /www/server/php/82/bin/php artisan db:seed --class=SharedInspirationCategorySeeder --force
  ```
- 幂等，可多次执行；执行后验证：`SELECT id, slug, name, sort_order FROM shared_inspiration_categories ORDER BY sort_order;`（预期 15 行；如老的 4 个废弃 slug 仍在则共 19 行，可手工删）

### 设计要点

1. **分组编排 vs 原混排**：v1 把题材（人物/风景/建筑）与风格关键词（赛博朋克/科幻/奇幻）混在一起，浏览体验上「画了人物的赛博朋克作品」既能归题材也能归风格，分类含义模糊。v2 拆为「题材 / 风格 / 用途」三组后，每个分类归属明确（人物归 portrait、商用海报归 poster），分类心智更清晰
2. **新增 5 个偏商用向 slug**：站点用户群体偏向商业 / 个人创作场景，`product`（电商）/ `poster`（营销）/ `logo`（品牌）/ `wallpaper`（桌面）/ `minimalism`（现代设计）这五项是高频需求；新增后题材分类对商业场景覆盖更完整
3. **`sort_order` 分段留 10 的 gap**：方便平台后台手工在组内插入新分类，无需重排序整张表
4. **不主动 DELETE 废弃 slug**：seeder 的 `updateOrInsert` 只 upsert 不删除。如果生产 DB 里已经有云控端分享的灵感引用了 fashion / sci-fi 等老分类，强删会触发外键 RESTRICT。让运维通过平台后台手工删（删前自动校验关联灵感）更安全

---

## [0.7.0] - 2026-05-14

> **共享灵感库 v1**：agent-build 新增一个跨云控端共享的灵感池。云控端站点可分享本地灵感到共享库；共享库由全网评审员投票审核（达阈值自动通过/驳回）；通过的灵感对所有已授权云控端可见，可被「拉回本地」；用户可举报不当内容（达阈值自动下架，举报池由平台后台兜底处理）。新增 4 张数据表（`shared_inspirations` / `shared_inspiration_categories` / `shared_inspiration_reviews` / `shared_inspiration_reports`）+ `authorized_clients.is_hub_reviewer` 字段、`Hub/InspirationHubController` 云控端调用层（11 端点）+ `Admin/SharedInspirationController` / `SharedInspirationCategoryController` / `SharedInspirationReportController` / `InspirationHubSettingsController` 平台管理层（共 19 端点）、`HubReviewerOnly` 中间件、`SharedInspirationCategorySeeder`（14 个标准分类）。客户端管理页新增「评审员」开关列 + 批量任命；平台后台新增 4 个页面（共享灵感库 / 举报池 / 分类管理 / 共享设置）。**非 breaking、与 0.6.x 完全兼容**（共享 hub 是独立功能，老云控端不调 `inspiration-hub` API 完全不受影响）。

### 新增

#### 数据库（5 个 migration）

- **`2026_05_13_220000_add_hub_reviewer_to_authorized_clients.php`**：`authorized_clients` 加 `is_hub_reviewer` boolean 字段（default false）+ `idx_hub_reviewer` 索引。控制云控端是否能调评审员专属端点（`pending-list` / `{id}/review`）。默认 false，老客户端零影响
- **`2026_05_13_220100_create_shared_inspiration_categories_table.php`**：标准化分类表（平台方维护，云控端只读）。14 个默认分类由 `SharedInspirationCategorySeeder` 写入，`slug` UNIQUE kebab-case 持久标识
- **`2026_05_13_220200_create_shared_inspirations_table.php`**：核心数据表。冗余 4 个计数列（approve/reject/report/download_count）避免每次都聚合关联表；`status` enum(pending/approved/rejected) + `is_visible` boolean 双轴状态机；UNIQUE(source_client_id, source_local_id) 防同一云控端重复分享同一本地灵感；外键 `category_id → shared_inspiration_categories.id` ON DELETE restrict（防分类被误删导致灵感悬挂）；外键 `source_client_id → authorized_clients.client_id` ON DELETE cascade（云控端被删除时自动清掉其分享数据）
- **`2026_05_13_220300_create_shared_inspiration_reviews_table.php`**：审核员投票表。UNIQUE(shared_id, reviewer_client_id) 保证一个审核员对一条灵感最多一票；外键 cascade；`reason` 在 action=reject 时业务层强制必填；不可撤销（UI 已投票按钮 disable）
- **`2026_05_13_220400_create_shared_inspiration_reports_table.php`**：举报表。UNIQUE(shared_id, reporter_client_id) 保证一个客户端对一条灵感最多举报一次；`reason_code` 字符串列（不在表层 ENUM 约束，方便扩展），合法值 invalid_image / inappropriate / duplicate / copyright / other 由 Validator 校验

#### 后端

- **`app/Http/Controllers/Hub/InspirationHubController.php`**（约 610 行）：云控端调用层，11 端点：
  - 公开：`me`（当前云控端在 hub 的状态：是否评审员、阈值配置回显）/ `categories`（14 个分类列表）/ `list`（分页 + 分类 / 状态 / 关键词筛选）/ `statusBatch`（批量查 N 条本地分享的当前状态）/ `submit`（分享）/ `withdrawBySource`（按本地 ID 撤回）/ `show` / `download` / `report`
  - 评审员（`HubReviewerOnly` 中间件）：`pendingList`（待审列表）/ `review`（approve/reject 一票）
- **`app/Http/Controllers/Admin/SharedInspirationController.php`**（约 366 行）：平台后台管理 7 端点。`index` / `show` / `destroy` / `batchDestroy`、`forceApprove` / `forceReject`（绕过投票阈值强制流转）、`setVisibility`（手动上下架）、`stats`（统计）
- **`app/Http/Controllers/Admin/SharedInspirationCategoryController.php`**（约 155 行）：分类 CRUD 4 端点。删除前检查无关联灵感才允许（防外键 restrict 触发 SQL 错误）
- **`app/Http/Controllers/Admin/SharedInspirationReportController.php`**（约 192 行）：举报池 4 端点。`index`（按 shared_id 分组 / 平铺两种视图）/ `show` / `dismiss`（单条驳回）/ `batchDismiss`
- **`app/Http/Controllers/Admin/InspirationHubSettingsController.php`**（约 136 行）：阈值设置 2 端点。3 个阈值（approve_threshold / reject_threshold / report_threshold）+ 1 个每日提交上限（daily_share_limit）+ daily_share_limit_per_client
- **`app/Http/Middleware/HubReviewerOnly.php`**：评审员鉴权中间件。读取 `domain_binding` 中间件注入的 `client`，验证 `is_hub_reviewer=1`，否则 403
- **`app/Http/Kernel.php`**：注册 `hub_reviewer` middleware alias
- **`app/Http/Controllers/Admin/BuildClientController.php`** 新增 2 方法：`setReviewer({clientId})` 单个任命 / 批量 `batchSetReviewer({client_ids[], is_hub_reviewer})`
- **`database/seeders/SharedInspirationCategorySeeder.php`**：14 个默认分类（人物肖像 / 风景自然 / 建筑空间 / 食物美食 / 动物宠物 / 商品产品 / 时尚穿搭 / 艺术插画 / 概念设计 / 抽象创意 / 平面设计 / 摄影写实 / 二次元 / 其他），按 slug 幂等 upsert
- **`database/seeders/DatabaseSeeder.php`** 注册 `SharedInspirationCategorySeeder`

#### 前端

- **`frontend/src/types/index.ts`**：新增 12 个共享 hub 相关类型（`SharedInspiration` / `SharedInspirationCategory` / `SharedInspirationReview` / `SharedInspirationReport` / `SharedInspirationStatus` / `ReportReasonCode` / Stats / Settings 等）
- **`frontend/src/api/sharedInspirationHub.ts`**（约 201 行）：共享 hub 全部 API（5 大模块 19 个方法，对应后端管理路由）
- **`frontend/src/api/clients.ts`**：扩展 `clientsApi.setReviewer` / `batchSetReviewer` 2 方法
- **`frontend/src/pages/Clients.tsx`**：列表新增「评审员」开关列（Switch 直接切换，乐观更新 + 失败回滚）+ 选中行工具条加「批量任命评审员 / 批量取消评审员」2 按钮
- **`frontend/src/pages/SharedInspirations.tsx`**（约 754 行）：共享灵感库主页面。筛选（分类 / 状态 / 关键词 / 是否可见）+ 详情 Drawer（含 prompt 中英对照、来源云控端、审核记录、举报历史）+ 投票按钮（如登录的是评审员账号）+ 举报按钮 + 平台管理按钮（force-approve / reject / set-visibility / 删除）
- **`frontend/src/pages/SharedInspirationReports.tsx`**（约 201 行）：举报池页面。Tab 切换「按举报对象分组 / 全部举报详细列表」+ 单条 / 批量驳回
- **`frontend/src/pages/SharedInspirationCategories.tsx`**（约 192 行）：分类管理。CRUD + slug 唯一性校验 + 删除前提示有 N 条关联灵感（防误删）
- **`frontend/src/pages/SharedInspirationSettings.tsx`**（约 227 行）：阈值配置页。3 阈值（含上下界 InputNumber 校验）+ 每日上限 + 单云控端日限
- **`frontend/src/App.tsx`**：注册 4 个新路由（`/shared-inspirations` / `/shared-inspirations/reports` / `/shared-inspirations/categories` / `/shared-inspirations/settings`）
- **`frontend/src/components/AppLayout.tsx`**：左侧菜单加「共享灵感库」子菜单（4 子项）+ `openKeys` 状态管理子菜单展开

### 设计要点

1. **为什么用 4 张独立表而不是 JSON 列**：评审员投票 / 举报需要按时间 / 按客户端 / 按状态做多维度查询和聚合（举报池视图 + 评审记录视图），JSON 列在 MySQL 5.7 上查询能力差且无法索引。冗余计数（approve_count / reject_count / report_count / download_count）解决「列表展示阈值进度」的频繁聚合开销
2. **为什么投票 / 举报都 UNIQUE(shared_id, reviewer/reporter_client_id)**：防止单一客户端通过重复请求刷投票或举报数刷阈值。业务层 `Validator + lockForUpdate` 兜底，DB UNIQUE 是最后一道防线（多个并发请求同时进 try 块时 INSERT 至少一条会被 1062 拦下）
3. **为什么 `shared_inspirations` 表不存图片副本，直接存云控端原 URL**：避免 hub 端图床承担流量（评审员浏览即按需从原 URL 加载），如果 hub 转存副本则需建图床存储桶 + 处理删除时的清理 + 处理跨地域加速。代价是云控端关停 / 换图床时 hub 显示 broken image，但社区灵感本质就是「分享当时的快照」可接受
4. **为什么不允许审核员撤回投票**：一票不可撤是为了让投票心智明确（投之前考虑清楚），且简化状态机（不用处理「approve→撤回→reject」的票数重算）。如果投错可联系平台后台 force-approve / reject 强制纠正
5. **为什么 `withdrawBySource` 端点用本地 ID 而不是 hub_shared_id**：云控端发起撤回时本地灵感记录通常已带 `hub_shared_id`，但有「云控端本地灵感被删但 hub 副本还在」的兜底场景：用户在本地直接 SQL 删了 inspirations 行 → 之后想清理 hub 的副本时只能用本地 ID 反查。`withdrawBySource` 接 `source_local_id` 走 `UNIQUE(source_client_id, source_local_id)` 反查 hub 行
6. **为什么评审员中间件 + 路由顺序约束都用字面量 + `whereNumber('id')`**：避免 Laravel 路由 `/{id}` 吃掉 `/pending-list` / `/categories` 等字面量端点。`whereNumber` 限制 `{id}` 只接数字也排除字母路径污染
7. **`source_client_id` 不能由前端传入**：由 `VerifyDomainBinding` 中间件按 Origin 校验后注入到 request，保证云控端无法伪造其他站点身份分享灵感
8. **`SharedInspirationCategorySeeder` 用幂等 upsert（按 slug）**：每次升级跑 `php artisan db:seed` 都安全。不删除老分类（防关联灵感外键 restrict 失败），只 insert 缺失的 + update name / sort_order

### 说明

- **改动文件**（约 25 个）：
  - `backend/config/version.php`：0.6.1 → 0.7.0
  - `backend/database/migrations/2026_05_13_22xxxx_*.php`：**新建** 5 个
  - `backend/database/seeders/SharedInspirationCategorySeeder.php`：**新建**
  - `backend/database/seeders/DatabaseSeeder.php`：注册 seeder
  - `backend/app/Http/Controllers/Hub/InspirationHubController.php`：**新建**
  - `backend/app/Http/Controllers/Admin/SharedInspirationController.php`：**新建**
  - `backend/app/Http/Controllers/Admin/SharedInspirationCategoryController.php`：**新建**
  - `backend/app/Http/Controllers/Admin/SharedInspirationReportController.php`：**新建**
  - `backend/app/Http/Controllers/Admin/InspirationHubSettingsController.php`：**新建**
  - `backend/app/Http/Middleware/HubReviewerOnly.php`：**新建**
  - `backend/app/Http/Kernel.php`：注册 hub_reviewer alias
  - `backend/app/Http/Controllers/Admin/BuildClientController.php`：setReviewer + batchSetReviewer
  - `backend/app/Models/SharedInspiration.php`、`SharedInspirationCategory.php`、`SharedInspirationReview.php`、`SharedInspirationReport.php`：**新建**
  - `backend/routes/api.php`：注册 `/api/inspiration-hub/*` 路由（11 端点）
  - `backend/routes/admin.php`：注册 `/admin/api/inspiration-hub/*` + `shared-inspiration*` 路由（19 端点）+ 2 个 clients/reviewer 路由
  - `frontend/src/types/index.ts`：12 个新类型
  - `frontend/src/api/sharedInspirationHub.ts`：**新建**
  - `frontend/src/api/clients.ts`：扩展 setReviewer 方法
  - `frontend/src/pages/Clients.tsx`：评审员列 + 批量任命
  - `frontend/src/pages/SharedInspirations.tsx`：**新建**
  - `frontend/src/pages/SharedInspirationReports.tsx`：**新建**
  - `frontend/src/pages/SharedInspirationCategories.tsx`：**新建**
  - `frontend/src/pages/SharedInspirationSettings.tsx`：**新建**
  - `frontend/src/App.tsx`：注册 4 个新路由
  - `frontend/src/components/AppLayout.tsx`：菜单子组 + openKeys
- **schema 变更**：
  - `authorized_clients` 加 `is_hub_reviewer` 字段 + 索引
  - 新建 4 张表（categories / inspirations / reviews / reports）
  - 升级会自动跑 5 条 migration + 1 个 seeder（14 个默认分类按 slug 幂等 upsert）
- **无 composer 依赖变更**：纯应用层代码，autoload 通过 dump-autoload 刷新即可
- **向后兼容**：
  - 老云控端（不调 `inspiration-hub` API）：升级 0.7.0 完全不影响任何打包 / 授权 / mirror 功能
  - 老版本平台后台账号：登录后会看到左侧菜单新增「共享灵感库」子菜单 4 项，不点不进的话零影响
  - `is_hub_reviewer` 默认 false：升级后所有云控端默认不是评审员（不会因为升级被赋予额外权限），需要平台管理员在客户端列表逐个任命
- **配套云控端 1.4.0**：本版本所有 `inspiration-hub` 端点对接云控端 1.4.0 的 `InspirationHubClient`。云控端 1.3.x 及以下不调本端点，升级 0.7.0 对它们零影响

---

## [0.6.1] - 2026-05-11

> **0.6.0 维护开关「老版本兼容性」补强 + 云控端最低版本闸门**：0.6.0 把维护开关字段挂在 `auth-check` 响应上，但任何不消费 maintenance 字段的老版本云控端（1.3.3 及以下）即使打开了维护开关也仍能照常提交打包 → 维护对老版本「失效」。本版本补强：(1) `POST /api/build/request` 在 validator 之前最早位置插入维护硬闸门，命中时 503 + `error` 字段直接填**完整中文友好文案**，让老版本前端的 `message.error('agent-build 拒绝: ${inner?.error}')` 兜底分支也能展示中文；(2) 新增「云控端最低版本」配置项 `min_admin_version`，云控端 1.3.4+ 起会在所有出向请求里携带 `X-Admin-Version` 头，agent-build 按此头校验版本号，低于配置直接 426 + 中文升级提示；(3) `auth-check` 同步派生 `admin_version_too_low` 字段，1.3.5+ 云控端进页面就能直接看到红色版本横幅，无需等点提交才知道；(4) 前端 Settings.tsx 维护 Card 内新增「云控端最低版本（可选）」Input + 客户端 regex 校验。**非 breaking、无新增 migration（复用 0.5.0 system_settings 表）、无 composer 依赖变更**。配套云控端 1.3.5。

### 新增

- **`app/Http/Controllers/Admin/BuildMaintenanceController.php`** show/update 加 `min_admin_version` 字段：常量 `KEY_MIN_ADMIN_VERSION = 'min_admin_version'`，存 `system_settings(group='build', key='min_admin_version')`，X.Y.Z SemVer 或空（空 = 不限制版本）。`show` 返回多 `min_admin_version: ?string`；`update` 接受可选 `min_admin_version?`，Validator 限制 `regex:/^\d{1,4}\.\d{1,4}\.\d{1,4}$/` 或为 null（清空）；显式传 null/空字符串时写空值清空配置。文档头同步说明三种闸门优先级（maintenance → header 缺失 → 版本过低）

### 改进

- **`app/Http/Controllers/Build/BuildRequestController.php::request()`** 方法签名注入 `SettingService`，在 validator 之前最早位置插入双闸门：(1) `maintenance_mode='1'` 时直接 503 + body `{error: '<完整中文文案>', error_code: 'maintenance_mode', maintenance: true, maintenance_message: ?}`；(2) `min_admin_version` 已配且请求 `X-Admin-Version` 头缺失/不规范/低于 `min` 时 426 + body `{error: '云控端版本过低（当前 X.Y.Z），请先升级到 ...', error_code: 'admin_version_too_low', current_admin_version: ?, min_admin_version: ?}`。**关键设计**：`error` 字段直接填**完整中文友好文案**（不是英文短码），老版本云控端 1.3.0-1.3.3 的 `RequestPage.tsx::submit onError` 兜底分支会 `message.error('agent-build 拒绝: ${inner?.error}')` 直接显示完整中文，无需老前端改任何代码。新版本 1.3.5+ 通过 `error_code` 字段精确分支（`maintenance_mode` / `admin_version_too_low`）做专门 UI（含自动 loadAuth() 刷新横幅）。版本比较走 PHP 内置 `version_compare()`
- **`app/Http/Controllers/Build/BuildRequestController.php::authCheck()`** 在已授权返回里再加 3 个字段（0.6.0 已加 maintenance / maintenance_message 两个，本版本累加到 5 个）：`min_admin_version: ?string`（系统设置原值）/ `current_admin_version: ?string`（按 `X-Admin-Version` 头解析后回显，格式合法时返客户端值，否则 null）/ `admin_version_too_low: bool`（派生：`min` 已配且 header 缺失或低于 `min`）。云控端 0.5.0+ 的 `CloudBuildController::authCheck` 早已设计为透传上游 200 响应的全部字段，这些字段自动流到云控端前端，云控端 1.3.5 起会消费 `admin_version_too_low` 渲染版本横幅
- **`frontend/src/pages/Settings.tsx`**：维护 Card 内新增「云控端最低版本（可选）」Form.Item：单行 Input，placeholder `1.3.4`，allowClear，maxWidth 200，客户端 regex 校验 `/^\d{1,4}\.\d{1,4}\.\d{1,4}$/` 或留空，validateStatus 错误时 help 显示「格式必须为 X.Y.Z」，正常时 help 显示「云控端提交打包请求时携带 X-Admin-Version；版本低于此值或不带版本头的请求会被 426 拒绝」说明文。`save()` 入口加 `!minVersionValid` 阻塞 + 对应 message.error；保存按钮 disabled 条件追加 `!minVersionValid`；dirty 检测同时监听 `trimmedMinVersion`
- **`frontend/src/api/settings.ts`**：`BuildMaintenanceState` 类型加 `min_admin_version: string | null` 字段；`BuildMaintenanceUpdatePayload` 加 `min_admin_version?: string | null`；新增 `BuildMaintenanceUpdateResponse` 类型把 PUT 响应类型化（含 `min_admin_version: string | null`）；`updateBuildMaintenance` 返回类型从匿名 `{enabled, message}` 改用 `BuildMaintenanceUpdateResponse`

### 说明

- **改动文件**：
  - `backend/config/version.php`：版本号 0.6.0 → 0.6.1
  - `backend/app/Http/Controllers/Build/BuildRequestController.php`：request 加双闸门 + authCheck 加 3 字段
  - `backend/app/Http/Controllers/Admin/BuildMaintenanceController.php`：show/update 加 min_admin_version 字段
  - `frontend/src/pages/Settings.tsx`：维护 Card 加最低版本 Input
  - `frontend/src/api/settings.ts`：类型加 min_admin_version 字段 + 加 BuildMaintenanceUpdateResponse 类型
- **无 schema 变更**：min_admin_version 配置项继续复用 0.5.0 已创建的 `system_settings` 表（迁移 `2026_05_09_220000_create_system_settings_table.php`）的 `group_key='build'` namespace，符合 migration 铁律「只增不改」
- **无 composer 依赖变更**：`composer.json` / `composer.lock` 不动
- **向后兼容（核心目标）**：
  - **任意旧版本云控端（1.3.3 及以下，不消费 maintenance / min_admin_version 字段，不带 `X-Admin-Version` 头）**：升级 0.6.1 不影响其打包提交，**除非** 管理员开启了维护开关或配了 min_admin_version。开维护时老云控端点提交 → 接到 503 + `error: '<完整中文>'` → 老前端 `message.error('agent-build 拒绝: <error>')` 直接显示给用户；配最低版本时老云控端因为不带 `X-Admin-Version` 头被识别为「未知版本」，返 426 + `error: '云控端版本过低（当前 未知），请先升级到 X.Y.Z...'`，老前端同样能正确展示完整中文。**由此达到「即使老版本不更新也能在被拒绝时看到友好中文提示」的核心目标**
  - **agent-admin 1.3.5（新）+ agent-build 0.6.0（旧，未升 0.6.1）**：旧 agent-build 不读 `X-Admin-Version` 头、不返 min_admin_version / admin_version_too_low / current_admin_version 字段 → 1.3.5 前端派生 `adminVersionTooLow=false` → 版本横幅不显示、按钮不被版本闸门 disabled → 行为退化为只有维护横幅，零报错
- **维护硬闸门生效路径**：管理员开关「云打包维护」 → 写 `system_settings.build.maintenance_mode='1'` → 任何云控端（无论新旧）调 `POST /api/build/request` 都被 503 拒绝 + `error: '<中文>'`；1.3.4+ 云控端额外有维护横幅提前提示
- **最低版本闸门生效路径**：系统设置「云控端最低版本」填 `1.3.5` 保存 → 1.3.5+ 云控端调 `auth-check` 时通过 `X-Admin-Version` 头让 agent-build 派生 `admin_version_too_low=false`，前端无横幅；1.3.4 及以下因 header 缺失或值低于 1.3.5，调 `auth-check` 后 1.3.5+ 前端显示「云控端版本过低」error 横幅，老前端则在点提交后看到 426 + 中文文案
- **前端 build 必跑**：`Settings.tsx` 改动了，必须 `npm run build` 让 admin 静态资源刷新

---

## [0.6.0] - 2026-05-11

> **三组运维侧增强合并发版**：(1) 云打包维护开关（一键暂停所有云控端的打包提交，保留授权信息正常显示）；(2) 客户端管理增强（批量修改配额上限 + 列表展示当日/当月已用配额 + Progress 进度条）；(3) 系统设置页面正式启用（路由 + 菜单上线，含新版「云打包维护」配置 Card 与历史 COS 配置占位区）。**非 breaking、无新增 migration（复用 0.5.0 创建的 system_settings 表 group_key='build'）、无 composer 依赖变更**。云控端 1.3.4 已配套消费 maintenance 字段。

### 新增

#### 后端

- **`app/Http/Controllers/Admin/BuildMaintenanceController.php`**（新增，约 70 行）：云打包维护开关的 GET/PUT 端点。存储位置 `system_settings(group_key='build', setting_key='maintenance_mode'/'maintenance_message')`，`maintenance_mode` 值 `'1'`/`'0'`，`maintenance_message` 自定义维护说明文案（可空，默认文案『云打包更新维护中，暂停打包，请稍后刷新查看。』）。`show` 返回 `{enabled, message, default_message}`；`update` 接受 `{enabled, message?}` 写入。Validator 限制 `message` ≤ 500 字
- **`app/Http/Controllers/Admin/BuildClientController.php::batchUpdateLimit()`**（新增，约 40 行）：批量修改一批 client 的 daily_limit / monthly_limit。Payload `{client_ids: string[], daily_limit?: int, monthly_limit?: int}`，至少给一项；空字段保留原值。单条 SQL `UPDATE WHERE client_id IN (...)`，复用单条 update 的 1-1000 / 1-10000 范围校验。返回 `{success_count, daily_limit, monthly_limit}`
- **`routes/admin.php`** 注册 3 个新路由：
  - `Route::get('maintenance/build', [BuildMaintenanceController::class, 'show'])`
  - `Route::put('maintenance/build', [BuildMaintenanceController::class, 'update'])`
  - `Route::post('clients/batch-update-limit', [BuildClientController::class, 'batchUpdateLimit'])`

#### 前端

- **`frontend/src/pages/Settings.tsx`** 重写（约 +110 行）：从 0.5.0 起的「死代码占位状态」改为可用页面。顶部新增「云打包维护」Card：`useQuery(['settings','maintenance','build'])` 拉当前状态 → useState 控制 `enabled` (Switch 开/关) + `messageText` (Input.TextArea 自定义维护说明 5 行 + showCount 500 字上限) + dirty 检测控制保存按钮可点；`useMutation` 调 `settingsApi.updateBuildMaintenance` 写入。Card 标题旁动态 Tag：维护中红色 / 正常绿色。底部保留原 0.5.0 的「COS 已下线占位」展示（warning Alert + disabled Form）作历史资料
- **`frontend/src/App.tsx`** 加 `import { SettingsPage } from '@/pages/Settings'` + 加 `<Route path="settings" element={<SettingsPage />} />`
- **`frontend/src/components/AppLayout.tsx`** `navItems` 末尾加 `{ key: '/settings', label: '系统设置' }`
- **`frontend/src/api/settings.ts`** 加 `BuildMaintenanceState` / `BuildMaintenanceUpdatePayload` 类型与 `getBuildMaintenance` / `updateBuildMaintenance` 两个方法（沿用既有 COS 接口的设计风格）
- **`frontend/src/api/clients.ts`** 加 `ClientBatchUpdateLimitPayload` / `Response` 类型 + `clientsApi.batchUpdateLimit` 方法
- **`frontend/src/pages/Clients.tsx`** 6 处改动：
  - import 引入 `Progress` 组件
  - 加 `batchLimitOpen` state + `batchLimitForm` Form 实例
  - 加 `batchUpdateLimitMut` mutation，onSuccess 清选中 + invalidate + toast 显示更新条数
  - 选中行工具条加「批量修改配额」按钮（紧贴「批量重置额度」之后）
  - 「配额」列改造：列宽 120 → 200，从单行 `日 X / 月 Y` 改为双行展示「日 used/limit」「月 used/limit」+ 每行下方迷你 Progress 条；超限（used >= limit）时文字红色加粗 + Progress 切 `exception` 状态
  - 新增「批量修改配额」Modal：两个 InputNumber（日 1-1000、月 1-10000），任一可空（前端二次校验「至少一项」），含 Alert 说明「留空表示不修改该项；本操作不影响已用次数」

### 改进

- **`app/Http/Controllers/Admin/BuildClientController.php::index()`**：在分页查询后聚合每个客户端的「今日已用」「本月已用」打包次数，附加 `daily_used` / `monthly_used` 字段到返回。聚合查询仅限当前分页的 `client_id` 集合（`whereIn`），不全表扫；今日查 `build_quotas` 当日 `count`，本月用 `GROUP BY client_id` 取 `SUM(count)`
- **`app/Http/Controllers/Build/BuildRequestController.php::authCheck()`**：注入 `SettingService`，在已授权返回里附加 `maintenance: bool` / `maintenance_message: ?string`。读 `system_settings(group=build, key=maintenance_mode)` 判定开关；`maintenance_message` 为空时返 null（让云控端用本地默认文案）。**云控端 0.5.0+ 的 `CloudBuildController::authCheck` 早已设计为透传上游 200 响应的全部字段**，所以本字段自动流到云控端前端，云控端 1.3.4 起会消费它

### 说明

- **改动文件**：
  - `backend/config/version.php`：版本号 0.5.0 → 0.6.0
  - `backend/app/Http/Controllers/Build/BuildRequestController.php`：authCheck 注入 SettingService + 附 maintenance 字段
  - `backend/app/Http/Controllers/Admin/BuildClientController.php`：index 聚合 daily_used/monthly_used + 新增 batchUpdateLimit
  - `backend/app/Http/Controllers/Admin/BuildMaintenanceController.php`：**新增**
  - `backend/routes/admin.php`：注册 3 个新路由
  - `frontend/src/pages/Settings.tsx`：重写为含云打包维护 Card + COS 占位
  - `frontend/src/pages/Clients.tsx`：配额列改造 + 批量修改配额按钮 & Modal
  - `frontend/src/App.tsx`：加 /settings 路由
  - `frontend/src/components/AppLayout.tsx`：加菜单
  - `frontend/src/api/settings.ts`：加 maintenance 接口
  - `frontend/src/api/clients.ts`：加 batchUpdateLimit 接口
  - `frontend/src/types/index.ts`：BuildClient 加 daily_used / monthly_used
- **无 schema 变更**：维护开关用 0.5.0 已创建的 `system_settings` 表（迁移 `2026_05_09_220000_create_system_settings_table.php`）的 `group_key='build'` namespace，符合 migration 铁律「只增不改」，本版本不带任何新 migration
- **无 composer 依赖变更**：`composer.json` / `composer.lock` 不动
- **向后兼容**：
  - 云控端 1.3.3 及以下（不消费 maintenance 字段）升级 agent-build 0.6.0 后，云控端行为完全不变，只是新增字段被忽略
  - 反向：本版本不依赖云控端是否升级到 1.3.4，云控端可选择何时升
- **维护开关生效路径**：管理员 admin → 系统设置 → 切「云打包维护」Switch → 保存 → 写 `system_settings.build.maintenance_mode='1'` → 云控端下次调 `/api/build/auth-check`（一键云打包页进入时调）即拿到 `maintenance: true` → 云控端 1.3.4 在「一键云打包」页插入维护横幅 + 禁用提交按钮
- **前端 build 必跑**：本版本前端 6 个文件都改动了，必须 `npm run build` 让 admin 静态资源刷新

---

## [0.5.0] - 2026-05-11

> **Breaking**：放弃跨境腾讯云 COS 直传方案，改为「家庭电脑中转」：GHA 把产物上传到 GitHub Release（同 GitHub 基础设施，0 跨境）→ 家庭电脑用梯子拉 + 内网 SFTP 推到本地服务器 → 云控端从国内 mirror URL 拉。彻底解决 GHA → COS 跨境带宽瓶颈（实测 1MB 测速从 5.79s 抖动到 19.32s，主件 200MB+ 直接超时）。**需要：(1) 跑 2 个新 migration；(2) 在 agent-build 服务器跑 `php artisan mirror:rotate-worker-token` 生成 worker token；(3) 部署独立的 `agent-mirror-worker` 项目到家庭电脑（NSSM 包成 Windows Service）；(4) 本地 Linux 服务器配 nginx `/build-mirror/` location；(5) GHA workflow yml 改造（`local-agent-build` 仓库）**。

### 新增

#### 后端

- **`build_requests` 加 7 个 mirror 字段**（migration `2026_05_10_235000_add_mirror_fields_to_build_requests`）：`mirror_status` enum('pending','mirroring','mirrored','failed','purging','purged') nullable + `mirror_url_primary` + `mirror_supplementary` (JSON) + `mirror_assigned_at` + `mirror_acked_at` + `release_tag` + `release_assets` (JSON)，加 `idx_mirror_status` 索引（mirror worker 每 30s poll 用）
- **`MirrorWorkerController`**（`app/Http/Controllers/Build/MirrorWorkerController.php`，约 350 行）：5 个端点供家庭电脑 mirror worker 调用：
  - `GET /api/build/mirror/pending`：列出待镜像 build（status=success + mirror_status IN ['pending','mirroring'] + assigned 超时可重领），两阶段 CAS 抢占（select pluck → UPDATE WHERE mirror_assigned_at < cutoff），保证 at-most-once 领取
  - `POST /api/build/mirror/{id}/ack`：worker 上报 mirror_url_primary + supplementary，更新 mirror_status='mirrored' + mirror_acked_at + 触发 wake 云控端立即来拉。**幂等**：mirror_status='mirrored' 时直返 200（容忍 worker 重试丢包场景）
  - `POST /api/build/mirror/{id}/fail`：worker 重试 N 次仍失败上报，强转 status='failed' + mirror_status='failed' + 退当日配额（首次失败才退）+ wake 云控端立即同步失败状态。同样幂等
  - `GET /api/build/mirror/purgeable`：列出云控端已 ack delivered 可清的 build（status=delivered + mirror_status IN ['mirrored','purging']），同 pending 的两阶段 CAS 抢占
  - `POST /api/build/mirror/{id}/purge-ack`：worker SFTP rm -rf 完成后上报，更新 mirror_status='purged' + purged_at。幂等
- **`VerifyMirrorWorker` 中间件**（`app/Http/Middleware/VerifyMirrorWorker.php`）：mirror worker 端点全走它，校验 `Authorization: Bearer <worker_token>` 与 `system_settings.mirror.worker_token`（加密存储）的 `hash_equals` 常时比对。token 未配置时返 503 `mirror_not_configured`
- **`mirror:rotate-worker-token` artisan 命令**（`app/Console/Commands/MirrorRotateWorkerToken.php`）：生成 32 字节 hex token 写入 system_settings + 输出到 stdout 给运维 cp 到家庭电脑 .env。`--show` 查看当前 token 不旋转。**不暴露给 admin UI**（攻击面控制：登录 admin 后台的人不应能拿走 worker token 滥用 mirror 接口）
- **`Kernel.php` 注册 `mirror_worker` middleware alias**（`app/Http/Kernel.php` +1 行）

#### 配套独立项目（不在本 zip 内，需单独部署）

- **`agent-mirror-worker`**（独立 Node.js 项目，部署在家庭电脑）：常驻进程，每 30s poll agent-build 的 `/api/build/mirror/pending` 和 `/purgeable`：
  - pending → 用 Octokit 拉 GitHub Release asset（流式下载 + sha256 校验）→ ssh2-sftp-client 推到本地 Linux 服务器 → ack agent-build → gh API 删 release → 删本地缓存
  - purgeable → ssh2-sftp-client rmdir 远端目录 → purge-ack agent-build
  - 失败重试 3 次后调 fail；用户决策：失败也删 GitHub Release（避免 release 列表被废 release 污染）
  - NSSM 包成 Windows Service：开机自启 + 崩溃 5s 自重启 + 日志 rotate 10MB
  - 完整的 README + SERVER-SETUP.md（nginx alias `/build-mirror/` + SSH key 部署 + CDN 不缓存验证）

#### GitHub Actions workflow（`local-agent-build` 仓库，不在本 zip 内）

- `build-win.yml` + `build-mac.yml`：删 92 行 aws-cli COS 上传（含 1MB 测速 + head-bucket + 3 次重试）；加 `softprops/action-gh-release@v2` 创建 release（tag=`build-{BUILD_ID}` + prerelease=true + make_latest=false）+ jq enrich 拼接 stage step 的 size/sha256/role + GitHub API 的 asset_id/asset_url；callback body 改 `artifact_storage="github_release" + release_tag + files[].asset_id + asset_url`；新增 failure 时 cleanup release 防 GitHub 存储泄漏；顶部加 `permissions: contents: write` 防默认 GITHUB_TOKEN read-only

### 变更

- **`BuildCallbackController` 重写**：删 `handleCosSuccess`/`markCosFailure` 私有方法（含 HEAD 远程校验、cos_object_prefix 校验）；新增 `handleGithubReleaseSuccess`：校验 `release_tag === "build-{build_id}"`、files 必填项 (filename/role/asset_id>0/asset_url 非空)、role allowlist；不做远程 HEAD（GHA 上传成功才会回调；家庭电脑下载阶段会再校验 sha256）；落库 `status='success'` + `mirror_status='pending'` + release_tag + release_assets，**不在 callback 阶段 wake 云控端**（mirror_url 还没就绪，云控端来拉只能拿到 425 not_ready；MirrorWorkerController.ack 阶段才 wake，确保云控端第一时间能拿到 mirror_url_primary）。`markFailure` 同步设 `mirror_status='failed'` 保证状态机自洽
- **`BuildRequestController::download` 重写**：删 `cos_object_prefix` 引用 + SignatureService 签 token 逻辑；新逻辑按 mirror_status 分支返回：`pending`/`mirroring` → 425 not_ready (`hint=home_computer_mirror_in_progress`)；`failed` → 410；`purged` → 410（云控端不该再拉）；`mirrored`/`purging` → 直接返 `mirror_url_primary` 给云控端 GET 国内 CDN。**响应 schema 不变**（仍是 primary + supplementary_files + expires_at），保证云控端 CloudBuildPullService 兼容
- **`BuildRequestController` 删 `serveDownload()` 方法 + `routes/web.php` 删 `/dl/{token}` 路由**：云控端不再走 agent-build 服务器流量，直接 GET 国内 mirror 站点
- **`MirrorWorkerController.pending`/`purgeable` WHERE 接受过渡态**：`mirror_status IN ('pending','mirroring')` 而不是仅 `'pending'`，配合 `mirror_assigned_at < cutoff` (15min) 处理 worker 进程崩溃 / 主机宕机时该 build 永久卡在 mirroring 的 race condition；`purgeable` 同理 `IN ('mirrored','purging')`

### 移除

- **腾讯云 COS 配置功能下线**：删 `routes/admin.php` 中 SystemSettingsController import + 3 条 `settings/cos*` 路由；删 frontend `App.tsx` SettingsPage 路由 + `AppLayout.tsx` 侧栏「系统设置」入口；migration `2026_05_10_235500_drop_cos_settings_data` 删 `system_settings.group_key='cos'` 全部 6 行配置（region/bucket/app_id/secret_id/secret_key/custom_domain）。`CosService.php` / `SignatureService.php` / `SystemSettingsController.php` / `Settings.tsx` / `api/settings.ts` 文件保留作为 git 历史资源（不再被 import / 路由注册，构建时 tree-shake）
- `BuildRequestController` 删 `use App\Services\Build\CosService` + `use App\Services\Build\SignatureService` 无用 imports
- **`build_requests.cos_object_prefix` 字段不删**：保留向后查询历史 cos build 用，新 build 不写值

### 改动文件

- 新建：
  - `backend/database/migrations/2026_05_10_235000_add_mirror_fields_to_build_requests.php`
  - `backend/database/migrations/2026_05_10_235500_drop_cos_settings_data.php`
  - `backend/app/Http/Controllers/Build/MirrorWorkerController.php`
  - `backend/app/Http/Middleware/VerifyMirrorWorker.php`
  - `backend/app/Console/Commands/MirrorRotateWorkerToken.php`
- 改动：
  - `backend/config/version.php`：0.4.1 → 0.5.0
  - `backend/app/Http/Kernel.php`：routeMiddleware 加 `mirror_worker` alias
  - `backend/routes/api.php`：加 `mirror/*` 路由组（5 端点 + middleware）
  - `backend/routes/web.php`：删 `/dl/{token}` 路由
  - `backend/routes/admin.php`：删 SystemSettingsController import + 3 条 settings/cos 路由
  - `backend/app/Http/Controllers/Build/BuildCallbackController.php`：重写 success/failed 分支 + 删 cos 分支
  - `backend/app/Http/Controllers/Build/BuildRequestController.php`：重写 `download()` + 删 `serveDownload()` + 清 use
  - `frontend/src/App.tsx`：删 SettingsPage 路由
  - `frontend/src/components/AppLayout.tsx`：侧栏删「系统设置」入口

### 升级指南

**这是 0.5.0 大版本，需多步操作（含外部 3 个项目改造）：**

1. **覆盖 agent-build 代码**（含 2 个 migration、3 个新 PHP 文件、9 处改动）。zip 由本流程产出
2. **跑 migration**：
   ```bash
   cd /www/wwwroot/your-build-domain.example.com/backend
   php artisan migrate --force
   ```
   会执行 `add_mirror_fields_to_build_requests` + `drop_cos_settings_data` 两条
3. **清缓存**：
   ```bash
   rm -f bootstrap/cache/*.php
   php artisan config:cache
   ```
4. **生成 worker token**（家庭电脑 .env 用）：
   ```bash
   php artisan mirror:rotate-worker-token
   ```
   复制输出的 `MIRROR_WORKER_TOKEN=<token>` 留着家庭电脑 .env 用
5. **本地 Linux 服务器配 nginx**（参考独立项目 `agent-mirror-worker/docs/SERVER-SETUP.md`）：
   - `mkdir /var/www/build-mirror`
   - nginx 加 `/build-mirror/` location（alias + `Cache-Control: no-store`）
   - 部署家庭电脑 SSH 公钥到 `~root/.ssh/authorized_keys`
6. **家庭电脑装 mirror worker**（参考独立项目 `agent-mirror-worker/README.md`）：
   - Node.js 20+ + NSSM
   - `npm install` + `npm run build`
   - `.env` 填 worker_token / GitHub PAT (Contents:Read+Write) / SFTP 信息
   - 前台 `npm start` 跑通后再 `scripts\install-nssm.ps1` 包成服务
7. **GHA workflow 部署**（`local-agent-build` 仓库）：推送 build-win.yml + build-mac.yml 到 main 分支
8. **清理老 cos build 数据**（如果 DB 里有 status=success + mirror_status=NULL 的）：
   ```sql
   UPDATE build_requests SET status='expired', mirror_status='failed', error_message='cos_legacy_expired'
    WHERE status='success' AND mirror_status IS NULL AND finished_at < NOW() - INTERVAL 24 HOUR;
   ```

### 兼容性

- 老 `cos_object_prefix` 非空的 build_requests 行：`download` 端会因 mirror_status=NULL 走 425 not_ready 永久卡住，建议升级前用上述 SQL 标记为 expired
- 升级前已 `status='delivered'` 的 build：不影响，云控端已落盘，纯 DB 历史记录
- mirror worker 暂时未部署的话：新 build 全部卡在 mirror_status='pending'。`agent-build` 后端不会出错，但云控端会一直 425 直到 mirror worker 上线
- 与桌面端 (`agent-desktop`) 客户端**完全无关**：客户端只跟云控端 (`agent-admin`) 交互

---

## [0.4.1] - 2026-05-10

> Hotfix：修复 0.4.0 `BuildCallbackController` failed 分支不发 wake 信号导致云控端 UI 卡在「排队中」的体验问题。打包失败时云控端最坏需等 1 分钟（cloud-build:pull cron 兜底）才同步状态，本版本修后降到 1-2 秒。

### 修复

- **`BuildCallbackController::callback()` failed 分支补 wake 调用**（`backend/app/Http/Controllers/Build/BuildCallbackController.php` +13 行）：0.4.0 起 success 分支会 `BuildWakeService::wakeClient()` 让云控端立即 pullOne，但 failed 分支只更新自己 `build_requests.status='failed'` + 退配额就 `return ['ack'=>true]`，**漏发 wake**。结果：GitHub Actions 打包失败（如 cos-action ENOENT、callback 422、CI 自身错误等任何 failed callback 路径），agent-build 端已经落库 failed，但云控端 `cloud_builds.status` 仍是 `queued`/`dispatched`，admin 后台 UI 一直显示「排队中」误导用户继续等。`cloud-build:pull --once` cron 每分钟才兜底跑一次，最坏延迟 60s。本 hotfix 让 failed 也立即 wake，与 success 分支 `handleCosSuccess()` 中相同的 try/catch best-effort 模式：`authorized_clients` 查 client → `wakeClient($client, $buildId)` → `Log::warning` 兜底，wake 失败不阻塞 callback ack。

### 改动文件

- 改动：
  - `backend/app/Http/Controllers/Build/BuildCallbackController.php`：failed 分支退配额之后、return 之前插入 13 行 wake 块
  - `backend/config/version.php`：0.4.0 → 0.4.1

### 兼容性

- 无 migration / 无 schema 变更 / 无 .env 字段变更 / 无 breaking change
- 与 0.4.0 行为完全兼容，从 0.4.0 直升 0.4.1 安全
- handleCosSuccess() 内部 markCosFailure() 路径（cos_object_missing / cos_prefix_mismatch 等 422 失败）暂未补 wake，仍依赖云控端 cron 兜底；这种路径相对罕见（COS 配置错或 CAM 权限错才进），下一版再补

---

## [0.4.0] - 2026-05-09

> **Breaking**：打包产物中转方式从「GitHub artifact → BuildWorker 跨境拉到 agent-build 本地 storage → /dl/{token} 流式输出」改为「GitHub Actions workflow 直传腾讯云 COS → BuildCallbackController HEAD 校验后落库 → /dl/{token} 302 redirect 到 COS 预签 URL」。彻底解决服务器到 GitHub Azure Blob 跨境带宽不足导致 cURL 18 partial transfer 反复失败的根本问题（实测 100MB artifact 直连 / 旧代理均 ~20KB/s，需 80+ 分钟，常超 30min timeout）。COS 配置在管理后台「系统设置」页面可视化维护（DB key-value 加密存储），不再依赖 .env。**需要：(1) 跑 1 个新 migration；(2) 用户在管理后台填 COS 凭证；(3) GitHub Secrets 写 4 个值；(4) workflow yml 改造（local-agent-build 仓库）**。

### 新增

#### 后端

- **`system_settings` 表**（migration `2026_05_09_220000_create_system_settings_table`）：通用 key-value 系统配置，二元主键 `(group_key, setting_key)`，敏感字段 `is_encrypted=1` 时 `setting_value` 存 `Crypt::encryptString` 密文。设计成无业务耦合，未来加邮件 / 备份等系统级配置直接复用
- **`SettingService`**（`app/Services/SystemSetting/SettingService.php`，约 75 行）：封装 `getGroup($group)` / `get($group, $key, $default)` / `setGroup($group, $values, $encryptedKeys)`。读取时按 `is_encrypted` 自动 `Crypt::decryptString`，写入时按 `$encryptedKeys` 列表自动加密。解密失败（旧版 APP_KEY / 损坏密文）返回 null 不抛
- **`CosService`**（`app/Services/Build/CosService.php`，约 220 行）：腾讯云 COS V5 客户端，纯 Guzzle + 手写 V5 签名（`hash_hmac sha1` 两次嵌套），不引入 `qcloud/cos-sdk-v5-php` SDK 避免 composer 依赖变更影响在线更新流程。提供：
  - `loadConfig()` 从 `SettingService::getGroup('cos')` 读 6 项配置（region/bucket/app_id/secret_id/secret_key/custom_domain），任一必填项空返 null
  - `isConfigured()`：上面是否非 null
  - `testConnection()`：PUT 1 个 1KB 临时对象 → HEAD 校验 → DELETE 清理，全程在 `connection-test/test-{uniqid}.txt`，三步全成功才返 ok
  - `headObject($key)`：HEAD 判存在
  - `deleteObject($key)`：DELETE，404 也算成功（幂等）
  - `getPresignedUrl($key, $expire=1800)`：生成 30 分钟 GET 预签 URL，**默认走 `custom_domain`**（如未配置回退 COS 官方域名）
  - 内部 `signAuth()` 实现 V5 签名：`signTime=startTime;endTime` → `signKey=hmac_sha1(secret_key, signTime)` → `formatString=method+uri` → `stringToSign=sha1+signTime+sha1(formatString)` → `signature=hmac_sha1(signKey, stringToSign)`，`startTime` 减 60 秒兼容时钟漂移
- **`SystemSettingsController`**（`app/Http/Controllers/Admin/SystemSettingsController.php`，约 100 行）：
  - `GET /admin/api/settings/cos`：读 6 项配置，`secret_key_masked` 字段返「前 4 位 + 中间星号 + 后 4 位」，明文绝不下行
  - `PUT /admin/api/settings/cos`：bucket 强校验 `^[a-z0-9][a-z0-9-]{0,49}-\d{8,12}$`（腾讯云 `{name}-{appid}` 命名）；`secret_key` 留空 = 保留旧值，按 mask 提示前端不修改；`custom_domain` 自动补 `https://` 前缀 + 去尾斜杠
  - `POST /admin/api/settings/cos/test`：触发 `CosService::testConnection()`，22x 表 ok（响应 `{ok:true,msg,endpoint}`），422 表 fail 但不抛异常（msg 字段是 `put_failed: status=403 body=...` 这类）
- **`BuildCallbackController` 重写 success 分支**（约 +130 行）：旧实现只把 `artifact_path` 写成 `artifact_name` 占位，依赖 BuildWorker 跨境拉。0.4.0 起 success callback 必须带 `artifact_storage='cos'` + `cos_object_prefix='build-artifacts/{build_id}/'` + `files=[{filename,size,sha256,role}, ...]`，controller 流程：
  1. 验 callback_token（不变）
  2. 强校验 `cos_object_prefix === "build-artifacts/{$buildId}/"`，不一致 → status=failed, error=`cos_prefix_mismatch`
  3. 校验 files 数组非空、role ∈ {primary,blockmap,metadata}、filename 不含 `/` 或 `..`，任一不合规 → status=failed
  4. 对每个 file 调 `CosService::headObject($cosPrefix . $filename)`，任一不存在 → status=failed, error=`cos_object_missing`
  5. 全部通过 → 落库 `cos_object_prefix` + `artifact_path` (primary file) + `artifact_size` + `artifact_sha256` + `artifact_files` (JSON)，status=success
  6. **best-effort 发 wake**（包 try/catch 不影响 ack），`BuildWorker` 5 分钟内会兜底重发
  7. 响应 `{ack:true}` 给 GitHub Actions 的 callback 步骤
  - **兼容旧路径**：callback body 不带 `artifact_storage`/`cos_object_prefix` 时沿用原 GitHub artifact 流程（仍写 `artifact_path=artifact_name` 占位，由 BuildWorker 处理 ── 但 BuildWorker 0.4.0 已不下载，仅清理）
- **`BuildRequestController::serveDownload()` 双分支**（约 +35 行）：原本只从本地 storage `response()->download()`。0.4.0 起：
  - **新分支（`cos_object_prefix` 非空）**：strict-allowlist 校验 `targetFilename ∈ artifact_files[].filename`（防 token 伪造路径），调 `CosService::getPresignedUrl()` 现场签 30 分钟 URL，`return redirect()->away($signedUrl, 302)`。云控端 follow 302 后直接连 COS 自定义域名 `cos3.xiaoyinet.cn`，agent-build 不消耗任何流量
  - **旧分支（`cos_object_prefix` 为空）**：本地文件流式输出（向后兼容 0.4.0 之前已落地的 historical builds）
- **`BuildRequestController::download()` 跳过等待 BuildWorker 检查**（约 +5 行）：`cos_object_prefix` 非空时不再返 425 `not_ready`，因为 callback 阶段元数据已完整落库
- **`build_requests` 加 `cos_object_prefix` 字段**（migration `2026_05_09_223000_add_cos_object_prefix_to_build_requests`）：VARCHAR(255) NULL，注释「COS 对象前缀，例 build-artifacts/{build_id}/」。非空 = COS 路径，空 = 旧 GitHub artifact 路径
- **`BuildWorker` 完全重构**（`app/Console/Commands/BuildWorker.php`，去 ~100 行 + 加 ~120 行）：从「下载者」转「清理者」，新职责：
  1. **清理超时 build**：`queued`/`building` 状态 `updated_at < now()-2h` 强转 `failed`, error=`stale_timeout_exceeded`
  2. **清理本地残留**：扫 `storage/app/build-artifacts/*`，DB 已无对应行 / 终态超过 2 天的目录递归删
  3. **wake 兜底**：5 分钟内 `finished_at` 但还没 delivered 的 build 重发 wake，覆盖 callback 时云控端短暂离线场景
  - 不再注入 `ArtifactFetchService`（实例还在，留给 0.4.x 之前的 historical 残留 build 兜底用）
  - signature 不变（`{--once}`），cron 配置无需调整
- **`BuildCallbackController` callback 时直接发 wake**（约 +12 行）：COS success 落库后立刻 `BuildWakeService::wakeClient()`，包 try/catch。这样客户端最快在 callback 处理完毕（< 1s）就能开始拉文件，旧实现要等到下一次 BuildWorker tick（最多 60s 延迟）

#### 前端

- **`Settings.tsx` 新页面**（约 200 行）：腾讯云 COS 配置表单，6 个字段（region/bucket/app_id/secret_id/secret_key/custom_domain），`Input.Password` 显示 SecretKey 留空提示「已保存：前 4 + ***** + 后 4，留空表示不修改」，bucket 客户端 regex 校验 `{name}-{appid}` 格式。配置存在时「测试连通性」按钮可点 → 调 POST `/test` 端点，结果以 `Alert` + `Descriptions` 展示 `msg` + `endpoint`。页面尾部有「预签 URL 工作机制」说明卡片
- **`api/settings.ts`**：`getCos()` / `updateCos(payload)` / `testCos()` 三个端点封装。`testCos()` 422 时不抛异常，把 `{ok:false,msg}` 当成正常返回（保持调用方 `.then` 链路一致）
- **`AppLayout.tsx` 侧栏菜单**：底部追加「系统设置」入口（key=/settings）
- **`App.tsx` 路由**：`<Route path="settings" element={<SettingsPage />} />`
- **`types/index.ts`**：`CosSettings` / `CosSettingsUpdatePayload` / `CosTestResult` 三个新类型
- **`api/client.ts` errorMap**：`cos_not_configured: '腾讯云 COS 尚未配置，请先在「系统设置」填写'`
- **管理后台路由 `routes/admin.php`**：在 `dashboard/stats` 下加 3 行 `settings/cos` 路由

### 改动文件

- 新建：
  - `backend/database/migrations/2026_05_09_220000_create_system_settings_table.php`
  - `backend/database/migrations/2026_05_09_223000_add_cos_object_prefix_to_build_requests.php`
  - `backend/app/Services/SystemSetting/SettingService.php`
  - `backend/app/Services/Build/CosService.php`
  - `backend/app/Http/Controllers/Admin/SystemSettingsController.php`
  - `frontend/src/pages/Settings.tsx`
  - `frontend/src/api/settings.ts`
- 改动：
  - `backend/config/version.php`：0.3.8 → 0.4.0
  - `backend/routes/admin.php`：加 SystemSettingsController import + 3 条 `settings/cos*` 路由
  - `backend/app/Http/Controllers/Build/BuildCallbackController.php`：新增 COS success 分支 + handleCosSuccess + markCosFailure 私有方法 + best-effort wake
  - `backend/app/Http/Controllers/Build/BuildRequestController.php`：import CosService + serveDownload 双分支 + download 跳过等待 BuildWorker
  - `backend/app/Console/Commands/BuildWorker.php`：去掉 ArtifactFetchService 依赖 + 改三件清理职责
  - `frontend/src/App.tsx`：加 SettingsPage 路由
  - `frontend/src/components/AppLayout.tsx`：侧栏加「系统设置」菜单项
  - `frontend/src/types/index.ts`：加 CosSettings 等类型
  - `frontend/src/api/client.ts`：errorMap 加 cos_not_configured

### 升级指南

**这是 0.4.0 大版本，需多步操作：**

1. **覆盖 agent-build 代码**（包含 2 个 migration、4 个新 PHP 文件、5 处改动）。如果走在线更新包，按既有打包流程出 zip
2. **跑 migration**：
   ```bash
   cd /www/wwwroot/your-build-domain.example.com
   /www/server/php/82/bin/php artisan migrate --force
   ```
   会执行 `create_system_settings_table` + `add_cos_object_prefix_to_build_requests` 两条
3. **清缓存**：
   ```bash
   rm -f bootstrap/cache/*.php
   /www/server/php/82/bin/php artisan config:cache
   ```
4. **登入管理后台 → 系统设置**，填腾讯云 COS 6 字段（region / bucket 完整名 `{name}-{appid}` / app_id / secret_id / secret_key / custom_domain），保存后点「测试连通性」必须返 ok
5. **GitHub Secrets**（仓库 `your-org/your-build-repo`）写 4 个值：`TENCENT_COS_REGION` / `TENCENT_COS_BUCKET` / `TENCENT_COS_SECRET_ID` / `TENCENT_COS_SECRET_KEY`
6. **更新 GitHub Actions workflow**（`build-win.yml` / `build-mac.yml`）：去掉 `actions/upload-artifact` 步骤，加 `Upload to Tencent COS` + 修改 callback step body 加 `artifact_storage`/`cos_object_prefix`/`files`。详见单独提供的 workflow 文件
7. **COS bucket 控制台设 lifecycle**：前缀 `build-artifacts/`，1 天后删除对象 + 1 天清理未完成 multipart upload
8. **删除 .env 里临时配的 `TENCENT_COS_*`**（如果 0.4.0 之前手工填过）：0.4.0 已不读这些 .env 字段，仅 DB 生效。删了避免后续混淆
9. **可选：取消 cron 里的 `HTTPS_PROXY`/`HTTP_PROXY` 环境变量注入**：0.4.0 后端不再下载 GitHub artifact，只做 listArtifacts / cancelRun / dispatch 等小请求，直连即可（实测直连 api.github.com 通）。代理可保留用作冗余

### 兼容性

- **历史 build（0.4.0 之前已落地的）**：`cos_object_prefix` 列默认 NULL，走旧的本地文件分支（`storage/app/build-artifacts/{build_id}/`）。已 delivered 的客户端不受影响
- **GitHub artifacts 历史残留**：建议参考 [《云打包-清理与取消操作手册.md》](docs/云打包-清理与取消操作手册.md) 一次性清空，0.4.0 起不再生成新的 GitHub artifact
- **配套云控端**：**无需改动**。云控端调用的 `/api/build/download/{buildId}` 接口语义不变（仍返 `{primary, supplementary_files}` 含签名 URL 列表），客户端 follow 302 redirect 是 HTTP 标准行为，云控端的 axios / curl / fetch 默认都支持

### 性能数据（实测）

| 链路 | 100 MB artifact 总耗时 | 备注 |
|---|---|---|
| 旧：GitHub artifact 跨境拉（直连 / 海外代理 23.x.x.x） | 80+ min（常超 30min timeout 失败） | cURL 18 partial transfer 反复 |
| 新：runner 推 COS（accelerate）+ agent-admin 同地域内网拉 | 30-90s 跨境推 + < 5s 内网拉 | 直接快 50-100x |

---

## [0.3.8] - 2026-05-09

> 打包任务列表 UX 优化：原本展示的 36 字符 UUID `client_id` 对运维来说几乎不可读，每次定位某个客户的打包记录都要先去客户端管理表查 client_id ↔ domain 映射再回来肉眼对比。0.3.8 把列改为「域名 / 运维」两行展示，搜索也从 client_id 精确匹配改为 domain + owner_name 模糊搜索。**非 breaking、无新 migration、无 composer 依赖变更**。

### 新增

- **`BuildAdminRequestController::index()` LEFT JOIN `authorized_clients`**（约 +20 行）：从 `DB::table('build_requests')` 改为 `DB::table('build_requests as br')->leftJoin('authorized_clients as ac', 'ac.client_id', '=', 'br.client_id')`。**LEFT JOIN 而不是 INNER**：兼容已删除的授权记录（`authorized_clients` 行 drop 但 `build_requests` 历史行仍在），避免历史打包从列表里凭空消失。SELECT 列表加 `'ac.domain as domain', 'ac.owner_name as owner_name'`，原有 `br.*` 字段加表名前缀避免歧义
- **`BuildAdminRequestController::index()` 加 `keyword` 查询参数**（约 +6 行）：`where(function ($qq) use ($kw) { $qq->where('ac.domain','like',"%{$kw}%")->orWhere('ac.owner_name','like',"%{$kw}%"); })`。同时模糊匹配 domain 和运维姓名，搜「张三」 / 搜「example.com」都命中
- **`count` 计算改为 `(clone $q)->count('br.build_id')`**（约 +1 行）：原 `$q->count()` 在 join 后是 `COUNT(*)`，理论上 LEFT JOIN 多匹配会膨胀计数。虽然 `authorized_clients.client_id` 是 unique key 不会真膨胀，但显式 `count('br.build_id')` 等价于 `COUNT(br.build_id)`，语义更稳。`clone` 是为了不修改原 builder 后续 `orderByDesc` / `skip` / `take` 链
- **前端 `BuildRequest` 类型加 `domain: string \| null` + `owner_name: string \| null`**（约 +3 行）：Vue/React Devtools / TS 严格模式下都能正确推断
- **前端 `RequestListParams` 类型加 `keyword?: string`**（约 +2 行）：`client_id` 字段保留向后兼容（其他地方可能直接传），但 UI 入口换成了 keyword
- **前端 `Requests.tsx` 列定义改造**（约 +20 行）：原「Client」列（dataIndex='client_id', width=200）改为「域名 / 运维」（dataIndex='domain', width=220）。render 用 div 两行展示：第一行 `r.domain` 字号 12px，第二行 `r.owner_name` 字号 11px 灰色 #999。两个字段为 null 时分别 fallback 为 `<Text type="secondary">（授权已删除）</Text>` 和 `<Text type="secondary">未填姓名</Text>`，明确告诉运维这条历史的来源已经无主
- **前端 `Input.Search` 占位改造**（约 +3 行）：从「按 client_id 过滤」改为「按域名 / 运维姓名搜索」，绑定的 state 从 `clientIdInput` 改名为 `keywordInput`，提交参数从 `client_id` 改为 `keyword`。宽度从 220 → 260（中文搜索关键字普遍比 UUID 短，但「按域名 / 运维姓名搜索」placeholder 字数多，扩 40px 避免占位被裁）

### 说明

- **改动文件**：
  - `backend/config/version.php`：版本号 0.3.7 → 0.3.8
  - `backend/app/Http/Controllers/Admin/BuildAdminRequestController.php`：`index()` 改 LEFT JOIN + keyword + count clone
  - `frontend/src/types/index.ts`：BuildRequest 加 domain / owner_name
  - `frontend/src/api/requests.ts`：RequestListParams 加 keyword
  - `frontend/src/pages/Requests.tsx`：列改造 + 搜索框 placeholder + state 改名
- **无 schema 变更**：仅是查询层 LEFT JOIN，没有新建表 / 加字段。`authorized_clients` 表的 `domain` / `owner_name` 字段在 0.3.x 早期已存在。`migrations` 列表与 0.3.7 一致
- **无 composer 依赖变更**：`composer.json` / `composer.lock` 不动
- **无云控端配套要求**：本版本仅是 agent-build 自身管理后台的列表页 UX 改进，云控端调用的 `/api/build/...` 业务接口完全不受影响。云控端版本 1.2.18 / 1.2.19 都能正常工作
- **典型受益场景**：(1) 客户反馈打包失败需要查日志，运维之前要从客户邮件里拿 domain → 去客户端管理查 client_id → 回打包任务列表按 client_id 搜，三步操作；0.3.8 直接 domain 一搜命中；(2) 多个站点共用一个 owner（运维姓名）时，搜运维姓名能一次查出他名下所有站点的打包记录；(3) 授权过期被删除的站点的历史打包记录之前完全无法识别（只有不可读的 client_id），现在显示「（授权已删除）」明确标记历史出处

### 升级指南

1. 仅升级 agent-build：覆盖代码 → `rm -f bootstrap/cache/*.php && php artisan config:cache`。无 migration、无依赖变更
2. **无云控端配套**：可独立升级
3. 升级后立即生效，列表页刷新一次即按新格式展示

---

## [0.3.7] - 2026-05-09

> **0.3.6 hotfix**：0.3.6 的 `PUT /api/build/my-info` changelog 声称"`owner_phone` required + max 20 + pattern `/^1[3-9]\d{9}$/` 校验中国大陆 11 位手机号"，但实际代码里 `owner_phone` 规则是 `['nullable','string','max:30']`，single char `'2'` 也能写进 `authorized_clients` 表。0.3.7 把校验做到位，并且把 `myInfo` 返回的 `needs_completion` 字段从只校验姓名改为同时校验手机号合规性，让云控端 1.2.18+ 的「新打包」拦截能基于完整信息触发。**非 breaking、无新 migration、无 composer 依赖变更**。

### 修复

- **`BuildRequestController::updateMyInfo()` Validator 收紧**（约 +12 行）：`owner_phone` 从 `['nullable','string','max:30']` 改为 `['required','string','regex:/^1[3-9]\d{9}$/']`。新增 6 条中文 messages（`owner_phone.required` / `owner_phone.regex` 等）。`$update` 数组里 `owner_phone` 永远更新为请求值，不再走「has key 才更新」的可选语义（必填后没意义）
- **`BuildRequestController::myInfo()` `needs_completion` 现在也校验手机号**（约 +5 行）：原逻辑只看 `owner_name` 是否空 / `'1'`，0.3.7 起加 `owner_phone` 是否匹配 `/^1[3-9]\d{9}$/`，任一不合规即 `needs_completion=true`。云控端 1.2.18 的「我的信息」按钮变红 + 「新打包」拦截依此触发，把存量「只填了姓名没填手机号」「手机号是 '2'」等历史脏数据全部纳入引导补完范围
- **抽出 `computeNeedsCompletion()` 私有静态方法**（约 +12 行）：把"姓名 + 手机号合规判断"从 `myInfo` / `updateMyInfo` 两处共用代码抽到一个方法里，避免后续两处逻辑漂移。任一字段不合规即返回 true。注意它是 `private static`：不参与 DI，不暴露公开 API surface，只服务于本 controller 内部一致性

### 说明

- **改动文件**：
  - `backend/config/version.php`：版本号 0.3.6 → 0.3.7
  - `backend/app/Http/Controllers/Build/BuildRequestController.php`：`myInfo()` 调 `computeNeedsCompletion()`、新增 `computeNeedsCompletion()` 私有方法、`updateMyInfo()` Validator 规则 + messages 调整 + `$update` 数组永远写 owner_phone
- **配套云控端**：建议同步升级云控端到 **1.2.18+**，1.2.18 把前端 Form 校验也补齐了。仅升 0.3.7 不升云控端：后端校验已能拦住直接 curl 攻击，但云控端 1.2.17 的前端 Form 仍允许填 `'2'` 提交 → agent-build 0.3.7 会返 422 + 中文错误「请输入有效的 11 位中国大陆手机号」给前端展示。体验上虽然能拦住，但用户得点保存才知道，不如 1.2.18 前端实时校验顺滑
- **存量数据兼容性**：升级 0.3.7 不会自动修改历史 `owner_phone` 的脏数据（如 `'2'`、`null`），只是把它们标记为 `needs_completion=true`，需要运维主动进云控端「我的信息」补完。直接 SQL 批量清理也可以（可选）：
  ```sql
  -- 列出所有手机号不合规的授权站点
  SELECT domain, owner_name, owner_phone FROM authorized_clients
  WHERE owner_phone IS NULL OR owner_phone NOT REGEXP '^1[3-9][0-9]{9}$';
  ```
- **`needs_completion` API 响应字段保持向前兼容**：字段名 / 类型不变（仍是 boolean），只是计算分母从「姓名」扩展到「姓名 + 手机号」。云控端 < 1.2.17 的版本根本不调用 `/my-info` 接口，零影响；1.2.17 调用时只用这个字段做按钮变红，行为只会更"严格"（之前不变红的现在可能变红），用户体验上的方向是正确的

### 升级指南

1. 仅升级 agent-build：覆盖代码 → `php artisan config:cache`（无 migration、无依赖变更）
2. **配套发布建议**：同时发布云控端 1.2.18+。两端协同时校验链路是「前端 Form validator → 云控端后端 Validator → agent-build 后端 Validator → DB 写入」三道防线
3. 存量脏数据可选 SQL 清理（见上）；保持现状也行，反正进「我的信息」就被引导填了

---

## [0.3.6] - 2026-05-09

> 新增「我的信息」接口，让云控端可以通过授权 token 远程查看 / 修改本站点在打包平台备案的运维联系方式（owner_name / owner_phone）。**非 breaking、无新 migration、无 composer 依赖变更**。配套云控端 1.2.17+ 才有 UI 入口；老版本云控端不会调这两个端点，agent-build 升级后对存量功能零影响。

### 新增

- **`BuildRequestController::myInfo()` + `GET /api/build/my-info`**：返回当前 token 绑定授权站点的 `domain` / `owner_name` / `owner_phone` / `needs_completion` 四字段。`domain` 由 `VerifyDomainBinding` 中间件按 Origin 头匹配到 `authorized_clients` 行后注入到 request attribute（`authorized_client`），controller 直接从 attribute 读取，**不接受前端传入的 domain**，从根本上杜绝跨站点篡改。`needs_completion` 由新加的私有方法 `computeNeedsCompletion()` 计算：姓名空 / 占位 `'1'`、或电话不是 11 位中国大陆手机号（`/^1[3-9]\d{9}$/`）任一不合规即 true，云控端依此拦截「新打包」。约 +35 行
- **`BuildRequestController::updateMyInfo()` + `PUT /api/build/my-info`**：白名单只接受 `owner_name` `required + min:2 + max:100 + not_in:1` 与 `owner_phone` `required + regex:/^1[3-9]\d{9}$/`。**owner_phone 必填且严格 11 位中国大陆手机号校验**，trim 后整体匹配，自然拒绝空、空白、单字符占位 `'1'` `'2'`、长度不足等所有不合规输入。即便前端误传 `domain` 字段也会被 Validator 丢弃。所有 messages 中文化。约 +60 行
- **`computeNeedsCompletion()` 私有静态方法**：把 `myInfo` / `updateMyInfo` 共用的"姓名 + 手机号合规判断"抽出来，避免两处 if 不一致。任一字段不合规即返回 true，云控端「我的信息」按钮变红、新打包入口被拦截。约 +12 行
- **`routes/api.php` 注册新路由**：`GET /api/build/my-info` + `PUT /api/build/my-info`，置于 `domain_binding` 中间件组内（与 `/request` / `/cancel` 等业务端点同级），共享同一套 token 鉴权 + 自动域名解析机制

### 说明

- **改动文件**：
  - `backend/config/version.php`：版本号 0.3.5 → 0.3.6
  - `backend/app/Http/Controllers/Build/BuildRequestController.php`：新增 `myInfo()` + `updateMyInfo()` 两个 action，新加 `Validator` 用法 + 中文 messages
  - `backend/routes/api.php`：domain_binding 组内注册 GET / PUT `/my-info`
- **无 schema 变更**：`authorized_clients` 表的 `owner_name` / `owner_phone` 字段在 0.3.x 早期 migration 里已存在，本版本仅是新增 read / write 端点暴露这两个字段
- **无 composer 依赖变更**：`composer.json` / `composer.lock` 不动
- **域名防篡改设计**：本版本的核心安全考量是「让云控端可以读 / 改自己的运维联系方式，但绝不能改自己的 domain」。原因：domain 是授权关系的主键，云控端如果能把别人的 domain 改成自己的，相当于一次免审授权劫持。因此：(1) GET 接口只读 attribute（`_binding_authorized->domain`），不读 query；(2) PUT 接口的 Validator 不允许 domain 字段（即使在 body 里也会被丢弃），改 domain 仍需走授权管理端后台手工操作
- **占位值拒绝**：updateMyInfo 校验 `owner_phone` 时显式拒绝单字符 `'1'`（前端常见占位）+ 同时校验完整手机号格式。云控端 1.2.17 的「我的信息」表单已经做了同样校验，这里是兜底
- **配套云控端**：云控端 1.2.17 的「云打包 → 打包记录 → 我的信息」按钮通过 `AgentBuildClient::getMyInfo()` / `updateMyInfo()` 调用本接口；老版本云控端（< 1.2.17）不会调这两个端点，agent-build 升级 0.3.6 不影响存量任何功能

### 升级指南

1. 仅升级 agent-build：覆盖代码（不需要跑 migration、不需要清缓存，但建议跑 `php artisan config:cache` 让新路由生效）
2. **配套发布**：建议同时发布云控端 1.2.17（提供 UI 入口）；只升 agent-build 不升云控端：新接口存在但无人调用，零副作用
3. **权限要求**：调用方必须持有有效的 agent-build 授权 token（即 `Authorization: Bearer <token>`，token 由 agent-build 后台 → 客户端管理为每个站点生成），未授权 / token 过期会被 `domain_binding` 中间件拦在 401

---

## [0.3.5] - 2026-05-09

> 客户端管理新增批量重置额度功能。**非 breaking**。无新 migration。

### 新增

- **客户端管理 - 批量重置额度**：选中多个客户端后可一键重置已用打包配额，支持三种范围：仅今日 / 本月 / 全部历史。重置后客户端可立即重新打包，无需等待自然日/月重置
- **后端 `BuildClientController::batchResetQuota`**：`POST /admin/api/clients/batch-reset-quota`，body `{ client_ids, scope: 'today'|'month'|'all' }`，删除 `build_quotas` 表对应记录
- **前端批量重置 Modal**：Radio 选择重置范围 + 确认按钮，操作完成后 toast 提示清除记录数

---

## [0.3.4] - 2026-05-09

> 修复跨网络场景下 GitHub Actions 拉云控端图标 SSL 握手失败（HTTP 525）的问题。**非 breaking**。无新 migration。需配套 local-agent 仓库 workflow 同步升级。

### 修复

- **致命：GitHub Actions runner 直接从云控端下载图标导致 HTTP 525 整个打包流程中断**：旧实现里 `BuildDispatchPendingCommand` 把云控端的 `icon_url` 原样作为 input 传给 GitHub workflow，runner 在 `scripts/inject-build-params.js` 里执行 `https.get(ICON_URL)` 直连云控端域名（如 `https://agent.fubaobao.vip/cloud-build/icons/...`）。该域名走 Cloudflare，在源站 SSL 配置异常时 Cloudflare 与源站握手失败，runner 收到 HTTP 525 → `inject-build-params.js` 抛 fatal → workflow 整个 failed → 用户拿不到打包产物。0.3.4 把图标下载从 GitHub runner 侧前移到 agent-build 侧（agent-build 与云控端通常同区，链路稳定），下载后通过 GitHub Contents API 推送到目标仓库 `.build-icons/{build_id}.png`，workflow checkout 后即得本地图标，不再依赖 runner ↔ 云控端的外部网络

### 新增

- **`GitHubDispatchService::uploadFileToRepo()`**：通过 GitHub Contents API（PUT `/repos/{repo}/contents/{path}`）把任意二进制内容 base64 编码后提交到仓库。已存在则带 `sha` 走 update。15s 探测 + 30s 上传 timeout，错误日志含完整 status / body
- **`GitHubDispatchService::deleteFileFromRepo()`**：DELETE `/repos/{repo}/contents/{path}`，先 GET 拿 sha 再删。失败静默（cleanup 失败不应影响主流程）
- **`BuildDispatchPendingCommand::downloadIcon()` 私有方法**：用 Laravel HTTP client 拉云控端图标，30s timeout，失败返 null（让 dispatchOne 走重试路径）

### 变更

- **`BuildDispatchPendingCommand::dispatchOne()` 流程重构**：dispatch 之前新增「下载图标 → 上传到仓库」两步前置。下载失败：满 3 次 attempts 才标 failed + 退配额，否则保留 `pending` 让下一轮 cron 重试。上传失败：永远 `retried`（GitHub API 抖动是临时的）。dispatch inputs 字段从 `icon_url` 改为 `icon_path`（值是 `.build-icons/{build_id}.png` 这种仓库相对路径）

### 升级指南

1. 升级 agent-build：覆盖代码 → `php artisan config:cache`（无 migration）
2. **必须配套升级 local-agent 仓库**：workflow yml 已改为接受 `icon_path` 而非 `icon_url`，inject 脚本读 `ICON_LOCAL_PATH` 走本地文件路径。两边 commit 同时 push 才能闭环；只升 agent-build 不升 workflow → workflow input 不匹配 → 整个打包链路断
3. **GITHUB_BUILD_TOKEN 权限要求**：除 `actions:write` 外还需 `contents:write`（用来 PUT/DELETE `.build-icons/` 文件）。如果用的是 fine-grained PAT，需要为目标仓库勾选 Contents: Read and write
4. 升级后清理临时缓存：`rm -f bootstrap/cache/*.php && php artisan config:cache`

---

## [0.3.3] - 2026-05-06

> 把 `/api/build/request` 改为异步 dispatch，根治「云控端提交任务后没有记录」的问题。**非 breaking**。需要跑 1 条 migration。配套 agent-admin 1.2.5 把 SDK timeout 加大到 60s 兜底。

### 修复

- **致命：`/api/build/request` 同步调 GitHub workflow_dispatch 导致跨区慢网下大量任务在云控端「消失」**：旧实现里这个端点是 `INSERT build_requests` 后**同步**调 GitHub Actions API（含 15s 内部 timeout）。在 agent-build 跨区部署（首尔 / 东京 / 香港）+ GitHub 冷启动场景下，整端点常耗时 5–15+ 秒。agent-admin SDK 默认 15s timeout，刚好 race 在边界：(1) GitHub 实际已成功 dispatch；(2) agent-build 已 INSERT 行 + GitHub Actions workflow 已开始；(3) 但 agent-admin 这边 HTTP 已经超时 → SDK 返 `transport_error` → controller 502 → **不插 cloud_builds 行**。结果：agent-build 跑得好好的、GitHub Actions 也启动了、artifact 最终也会做出来；但 agent-admin 列表里根本看不到这条任务，用户感觉「任务消失了」、再次提交又被 client_busy 卡住。0.3.3 把 dispatch 完全异步化，request 端点 < 100ms 返回 build_id

### 新增

- **新增 `BuildDispatchPendingCommand` 异步 dispatch worker**：每分钟通过 Laravel scheduler 触发（与 BuildWorker / BuildAckTimeout / BuildStuckDetector 并列）。扫 `build_requests` 中 `status='pending' AND dispatch_attempts < 3` 的行，按 `queued_at` 升序取最多 5 条，对每条调 `GitHubDispatchService::dispatch()`：成功 → `status='queued'` + `dispatched_at=now()`；失败 → `dispatch_attempts++`（用 `WHERE dispatch_attempts=$old` 乐观锁防并发），满 3 次仍失败 → `status='failed'` + 当日配额自动退还。每次执行有详细日志（`[BuildDispatchPending] dispatched=X retried=Y failed=Z elapsed=Ts`）便于运维监控
- **新增 `dispatch_attempts` / `dispatched_at` 字段**：`build_requests` 表加 2 列。`dispatch_attempts` unsigned tinyint 默认 0（上限 3）；`dispatched_at` datetime nullable（GitHub workflow_dispatch 成功的时刻）。新 migration `2026_05_06_230000_add_dispatch_columns_to_build_requests.php`，加索引 `idx_status_dispatch_attempts (status, dispatch_attempts)` 让 cron 扫描走索引

### 变更

- **`BuildRequestController::request()` 流程重写**：去掉 `GitHubDispatchService $github` 依赖注入，去掉同步 dispatch 块（约 25 行）。只保留：validation → busy 检查 → quota 检查 → INSERT `status='pending'` + `quota->incrDailyCount` → 立即返回 200 + `{build_id, status: 'queued', estimated_wait_seconds: 30}`。response 的 `status` 字段对外仍是 `'queued'`（用户视角：任务已接受并排队），DB 内部子状态 `'pending'` 仅供 BuildDispatchPending 识别，agent-admin 透明无感知
- **`BuildRequestController::cancel()` 不变**：原代码已经只在 `status='building' AND executor_run_id IS NOT NULL` 时才调 GitHub cancel API；`pending` 和无 run_id 的 `queued` 都走纯本地 cancel + 配额退还路径，0.3.3 起 `pending` 状态自然适配，无需改动

### 升级指南

1. 升级 agent-build：覆盖代码 → `php artisan migrate --force`（跑新 migration 加 2 列）→ `php artisan config:cache`
2. **agent-admin 必须配套升到 1.2.5+**：1.2.5 做了两件事 — (a) `cancel()` 在 agent-build 返 404 时本地 fallback；(b) `requestBuild()` SDK timeout 从 15s 加到 60s 作为兜底（即使 0.3.3 不部署也能工作）。两个组件都升到位才形成完整闭环
3. **存量 cloud_builds 孤儿行**（agent-build 重装 / 数据丢失导致 build_id 不在 build_requests）：升 1.2.5 后用户在前端点「取消」即可清掉；批量场景跑：`UPDATE cloud_builds SET status='cancelled', error_message='打包平台已重装', finished_at=NOW(), updated_at=NOW() WHERE status IN ('queued', 'building', 'success', 'downloading')`
4. **回滚预案**：若升级后发现 BuildDispatchPending 没跑（如 cron 配错），新 build 会一直停在 `status='pending'` 但用户看到的是 `'queued'`（cloud_builds 那边）。先确保 `/www/server/php/82/bin/php artisan schedule:run` 能跑 + 5 分钟内扫到 pending 行。手工跑一次：`php artisan build:dispatch-pending` 即可强行 dispatch

### 说明

- 改动文件（5 处）：新增 `database/migrations/2026_05_06_230000_add_dispatch_columns_to_build_requests.php`、新增 `app/Console/Commands/BuildDispatchPendingCommand.php`（约 160 行）、修改 `app/Http/Controllers/Build/BuildRequestController.php`（request 方法重写约 30 行）、修改 `app/Console/Kernel.php`（加 1 行 schedule）、修改 `config/version.php`（版本号）
- 净改动 ~200 行（其中 BuildDispatchPendingCommand 约 160 行是新增），**1 条 migration**
- **典型受益场景**：agent-build 部署在境外节点（HK / Tokyo / Seoul）+ 客户首次 / 偶发提交云打包后任务在云控端列表「消失」；升级 0.3.3 后任何网络条件下都不会再丢任务

---

## [0.3.2] - 2026-05-06

> 0.3.0 / 0.3.1 紧上的可用性补丁。**非 breaking**。建议所有 0.3.x 部署立即升级。
> 与 agent-admin 1.2.x 协议完全兼容，单边升级 agent-build 即可。

### 修复

- **致命：GitHub artifact 下载因 PHP 内存爆 + 跨区慢网超时，BuildWorker 永远拉不到 artifact**：0.3.0 / 0.3.1 的 `GitHubDispatchService::downloadArtifact()` 用 `Http::timeout(600)->get($url)->body()` 拉 zip，**把整个 artifact（90+ MB）全量加载进 PHP 进程内存**（200+ MB RSS），且 600 秒 timeout 在腾讯云 → GitHub 跨区链路（实测 50–200 KB/s）下经常一次跑不完。symptom：BuildWorker cron 每分钟启一次、每次卡到 600 秒 timeout 才退出，9 小时 540+ 次永远不能 fetch；`build_requests.artifact_path` 一直停在 `build-output-XXX` 占位字符串；agent-admin 那边 wake 收到也无路可走、只能反复 refresh 看到「下载中」永不前进。修：改用 Guzzle `sink` option 流式落盘到 `storage/app/build-artifacts/<build_id>/artifact.zip`（PHP 进程几乎不吃内存），timeout 提高到 **1800 秒**（30 分钟，可配），加 `Log::info` 记录开始/完成 + 实际下载耗时 + 平均速度（KB/s），失败时清掉半成品文件
- **GitHub Actions re-run 后 callback 401 卡死**：0.3.0 / 0.3.1 在第一次 callback（不论成功失败）就把 `callback_token` UPDATE 成 NULL，导致 GitHub web 上点「Re-run jobs」之后第二次 callback 因为 `!$build->callback_token` 返 401，build 永远卡在 first-run 时的状态。修：callback 处理保留 token；同时给「重复 failed callback」加 idempotency 防止 quota 重复退还。运维 re-run workflow 之后无需 SQL 介入即可让 build 走完整链路

### 新增

- **后台「在线更新」UI 上线**：agent-build 后台侧栏新增「在线更新」菜单（`/admin#/updates`），4 个 Tab：`检查更新`（拉远端 `version.json` 对比本地版本 + 一键升级 + 项目目录写权限预检 + Linux 下生成 `chown`/`chmod` 修复脚本）、`升级历史`（`update_logs` 表分页，含每次升级的阶段/进度/耗时/操作员/完整日志）、`数据表`（扫 `database/migrations/*.php` 与 `migrations` 表 + 校验所有 `Schema::create` 声明的表是否实际存在；一键 `migrate --force` 修复缺失迁移）、`更新记录`（拉远端 `releases.json` 展示历代版本完整 changelog 卡片，按版本号降序）。升级流程：拉 zip → SHA256 校验 → 备份代码 + `mysqldump` → 解压（保护 `.env` / `storage` / `bootstrap/cache`）→ `migrate --force` → 清 Laravel 缓存（`config:clear` / `route:clear` / `view:clear` / `cache:clear` / `package:discover`），全程 1.5 秒一次轮询前端实时显示阶段进度 + 滚动日志。**升级机制与 agent-admin 1.2.x 同构**，端到端经过验证
- **`config/build.php` 新增 `github.download_timeout` 配置**：默认 1800 秒，用 `?:` 兜底空值（与 1.2.2 在 agent-admin `cloudbuild.php` 的修法一致），避免 `.env` 里写 `GITHUB_BUILD_DOWNLOAD_TIMEOUT=` 空字符串覆盖默认。客户网络更慢可在 `.env` 加 `GITHUB_BUILD_DOWNLOAD_TIMEOUT=3600` 改成 1 小时
- **新增 `update_logs` 表**：记录每次升级的 from_version / to_version / phase / progress_percent / log / backup_path / 操作员等字段。新 migration `2026_05_06_220000_create_update_logs_table.php`

### 升级指南

1. 仅升级 agent-build（**不需要**升级 agent-admin；本版本与 1.2.x 协议完全兼容）
2. 覆盖代码 → `php artisan migrate --force`（跑 `update_logs` 一条新 migration）→ `php artisan config:cache`
3. **存量卡住的 build**（`status=success` + `artifact_path` 是 `build-output-XXX`）：升级后 1 分钟内 BuildWorker cron 自动捞起来重新 fetch；如果不想等可立即手动跑一次 `php artisan build:worker --once` 加速
4. **re-run 卡死的 build**（DB 里 `callback_token IS NULL` + `status=building/failed`）：升级后下次 GitHub re-run 该 workflow 即可正常完成；如果想立即恢复，可手工 SQL 把 `status` 重置为 `building` + 重新生成 `callback_token` 让新 callback 接管
5. **0.3.3 起可走在线更新**：本版本之后再发新版本，agent-build 后台「在线更新 → 立即升级」一键完成，无需 SSH 上服务器解压

### 说明

- 改动文件（修复部分）：`app/Services/Build/GitHubDispatchService.php`（downloadArtifact 重写）、`app/Services/Build/ArtifactFetchService.php`（调用点改）、`app/Http/Controllers/Build/BuildCallbackController.php`（保 token + idempotent quota）、`config/build.php`（加 download_timeout）、`config/version.php`（版本号）
- 改动文件（在线更新）：新增 `app/Models/UpdateLog.php` / `app/Services/UpdateService.php`（约 1240 行，从 agent-admin 同步并按 agent-build 品牌调整 User-Agent）/ `app/Http/Controllers/UpdateController.php` / `database/migrations/2026_05_06_220000_create_update_logs_table.php` / `frontend/src/api/updates.ts` / `frontend/src/pages/Updates.tsx`（约 1200 行）；修改 `routes/admin.php`（加 `/admin/api/updates/*` 路由组）/ `frontend/src/App.tsx` 路由 / `frontend/src/components/AppLayout.tsx` 菜单
- **典型受益场景**：客户提交云打包后任务长时间停留在「下载中」/「拉取中」/「未交付」、agent-admin 详情页 refresh 看不到产物的；升级 0.3.2 后立即恢复

---

## [0.3.1] - 2026-05-06

> 0.3.0 紧上的 race fix。**非 breaking**。建议所有 0.3.0 部署立即升级。

### 修复

- **`/api/build/download/{buildId}` 提前返回 URL 的竞态**：0.3.0 该端点只检查 `status === 'success'`，但 GitHub Actions callback 把 status 写成 success 时，artifact 还在 placeholder 状态（`artifact_path = 'build-output-XXX'`，`artifact_size = NULL`，`artifact_sha256 = NULL`），要等 BuildWorker cron（每分钟一次）+ `ArtifactFetchService::fetchForBuild`（下载 + 解压 90 MB 通常 30s+）才会填好。在这个窗口里：
  1. agent-admin 用户打开详情 drawer → 5 秒一次的 refresh polling
  2. agent-admin SDK 调本端 `/api/build/download/{buildId}` → 0.3.0 直接返回 200 + URL（但 size=NULL、sha256=NULL）
  3. agent-admin 写入 `cloud_builds.agent_build_url` 进入 downloadAndPlace
  4. agent-admin curl `/dl/{token}`，serveDownload 检查 artifact_path 是 placeholder → 返回 503 `artifact_not_fetched_yet`
  5. agent-admin 把 503 的 JSON 当作下载内容写到 tmp，sha256 不匹配 → status='failed' + error_message='download:...:verify_failed'
- 修复：在 `BuildRequestController::download()` 加一段 placeholder 守护，与 `serveDownload`（`/dl/{token}`）使用同一份判断条件（`empty || == 'placeholder.png' || str_starts_with('build-output-')`），命中则返回 425 `not_ready` + `hint: artifact_pending_local_fetch`，让 agent-admin `tryResolveDownload` 走 425 → in_progress 分支继续轮询，不会写入半成品 URL

### 升级指南

1. 仅升级 agent-build（**不需要**升级 agent-admin；本版本与 1.2.0+ 协议完全兼容）
2. 覆盖代码 → `php artisan config:cache`（无 schema 变更，不需要 `migrate`）
3. **存量受影响数据**：升级前因这个 race 已变 `failed` 的 cloud_builds 行，可在 agent-admin 1.2.1+ 详情页点「重试拉取」恢复（自动重置 status + 重拉）；如还在 1.2.0，需手动 SQL 重置

### 说明

- 改动文件：仅 `app/Http/Controllers/Build/BuildRequestController.php`（`download()` 方法加 7 行守护）
- **本版本无协议 / DB / 配置变更**：单边升级 agent-build 即可

---

## [0.3.0] - 2026-05-06

> **Breaking**：通知机制重构为「混合推拉」（hybrid push-pull）。删除 HMAC 共享密钥；agent-build 改为给云控端 POST 一个**仅含 `build_id` 的轻量 wake 信号**，云控端用现有 Origin 域名鉴权回拉数据。客户部署不需要任何 cron / 共享 secret。0.2.x 部署的站点必须**配套升级 agent-admin 到 1.2.0+**。

### 变更（Breaking）

- **`NotifyService` 替换为 `BuildWakeService`**：`app/Services/Build/NotifyService.php` 整文件删除；新增 `app/Services/Build/BuildWakeService.php`，仅 POST `{"build_id": "..."}` 到 `{client.domain}/api/build/wake`，**不带签名、不带 secret、不带 artifact 信息**。云控端收到后用现有 SDK 回拉数据，由 agent-build 的 `VerifyDomainBinding` 中间件用 Origin 头校验「这个 build_id 属于这个 origin」，安全性等价于已有的 `/api/build/*` 鉴权
- **删除 `BUILD_NOTIFY_SECRET`**：不再需要这把 HMAC 共享密钥。`.env` 旧值保留无害但被无视；`install.php` 安装向导不再生成；`.env.example` 已删除该字段。配套删除 `config/build.php` 的 `notify` 段
- **删除 `BUILD_NOTIFY_ENDPOINT_PATH`**：随 notify 段一起从 `config/build.php` 移除；`BuildClientController` 删除 `buildNotifyUrl` 私有方法（wake URL 由 `BuildWakeService` 内部用 `{domain}/api/build/wake` 约定拼接）
- **`authorized_clients.notify_url` 字段下线**：新 migration `2026_05_06_180000_drop_notify_url_from_authorized_clients.php` dropColumn。客户端管理 `SELECT_COLS` / 新建 / 编辑 / 批量导入 4 处全部移除该字段引用
- **`BuildWorker` 完成日志变更**：从 `notify ok / notify failed` 改为 `wake sent / wake skipped/failed (frontend polling will recover)`，反映新的混合语义——wake 失败不阻塞流程，云控端前端轮询会兜底

### 保留（不变）

- **`/api/build/download/{buildId}`** 不变：仍是云控端拉数据的入口，返回 primary + supplementary_files 签名 URL；status != success 时返 `425 not_ready`，已过期返 `410`
- **`/api/build/status/{buildId}`** / **`/api/build/ack/{buildId}`** / **GitHub Actions 调度链路** / **`BUILD_SIGN_SECRET`** / **签名下载 URL `/dl/{token}`** 全部保留

### 升级指南

1. **agent-build 端**（先升）：覆盖代码 → `php artisan migrate --force` 执行 drop notify_url → `php artisan config:cache`
2. **agent-admin 端**（紧接着升）：升级到 1.2.0+，详见 agent-admin CHANGELOG（**不需要客户配 cron**）
3. **存量数据**：0.2.x 期间因 api_domain bug 卡在 `queued` 的老任务**不会自动恢复**，需在后台强制取消后重新提交（这条限制和 0.2.2 一样）。0.3.0 的存量 `success` 但未 deliver 的行，下次提交新任务时云控端打开详情页会自动 refresh 拉补
4. **客户 `.env` 里的 `BUILD_NOTIFY_SECRET`** 可保留也可删除（新版不读取，无害）

### 说明

- 本版本 1 个新 migration（drop notify_url），数据破坏性低（只删一字段）
- 净改动：删 NotifyService（49 行）+ 加 BuildWakeService（~70 行）+ 删 notify_url 自填逻辑（~30 行），整体复杂度持平但**移除了 HMAC 共享密钥这一根本耦合点**
- **设计核心**：wake 信号本身**不可信**（任何人都能伪造），但伪造者最多让云控端发起一次自取无果的回拉（agent-build 对未授权 origin 的 build_id 返 404）。真正的鉴权完全靠云控端回拉时的 Origin 头校验，没有新攻击面
- **客户部署体验**：N 个 agent-admin 部署只需配 `domain` 和 `AGENT_BUILD_BASE_URL`，**不需要任何共享 secret，不需要 cron，不需要 NotifyService 接收端**

---

## [0.2.2] - 2026-05-06

> 0.2.0 / 0.2.1 紧急修复。**GitHub Actions 云打包在 0.2.0 起完全不触发**，任务会一直卡在 `queued` 状态。强烈建议 0.2.0 / 0.2.1 部署站点**立即升级**。

### 修复

- **致命：GitHub Actions dispatch 永远不执行**：`BuildRequestController.php:81` 和 `BuildAdminRequestController.php:144` 仍引用已在 0.2.0 migration 里删除的 `authorized_clients.api_domain` 字段（`$client->api_domain ?: $client->domain`）。PHP 8.0 严格模式下读取 stdClass 未定义属性会被 Laravel HandleExceptions 转成 `ErrorException` → 500，代码执行在 DB insert 之后、`$github->dispatch()` 之前中断 → 任务落库为 `queued` 但 workflow_dispatch 永远不会发出；`laravel.log` 会持续打印 `Undefined property: stdClass::$api_domain`。修复：两处改为 `$apiDomain = $client->domain;`（`api_domain` 与 `domain` 在 0.2.0 起已是同一概念）

### 升级指南

1. 从 0.2.0 / 0.2.1 升级到 0.2.2 只需覆盖 `app/Http/Controllers/Build/BuildRequestController.php` 和 `app/Http/Controllers/Admin/BuildAdminRequestController.php` 两个文件
2. 无需 `migrate`、无需 `config:cache`（代码路径不涉及缓存）
3. 建议跑一次 `php artisan config:clear` 清掉 opcache
4. 已经卡在 queued 状态的老任务**不会**自动恢复，需要在管理后台「强制取消」后由云控端重新提交

### 说明

- 本 bug 影响范围：**所有**云控端触发的打包请求 + agent-build 后台的「失败任务重试」
- 诊断快速判定：`tail storage/logs/laravel.log | grep 'api_domain'`，有这个异常即是本 bug
- 本版本无新增 migration、无 schema 变更、无协议变更；agent-admin 不需要配套升级

---

## [0.2.1] - 2026-05-06

> 0.2.0 的 bugfix + 客户端管理增强。非 breaking，但 **0.2.0 已部署的站点必须升 0.2.1**（前端 SPA 刷新 404 问题会在 0.2.0 复现）。

### 修复

- **SPA 刷新 404**：`App.tsx` 的 `<BrowserRouter>` 缺 `basename="/admin"` 导致刷新时 URL 被 React Router fallback 去 `/xxx` 触发 Laravel 404。加 basename 后子路径刷新可靠保留（关联 `@f:\local-agent\agent-build\frontend\src\App.tsx:50`）
- **打包流程 storage 子目录丢失**：PHP ZipArchive 不存空目录，导致 0.2.0 zip 解压后 `storage/framework/views` 不存在，Laravel 启动抛 `InvalidArgumentException: Please provide a valid cache path` → 整站 500。修复：打包流程脚本改为在每个子目录放 `.gitignore` 占位，让 ZipArchive 能收录这些目录（见 `@f:\local-agent\agent-build\docs\授权管理端更新包打包流程.md:256-276`）

### 新增

- **`notify_url` 不再由管理员手工填**：改由后端从 `domain` 自动拼接，规则 `{domain}/api/build/receive-notify`。「新建客户端」表单移除「通知回调 URL」字段，数据库字段仍保留（不改 schema，由 `BuildClientController::store` / `update` 自动赋值）。domain 修改时 notify_url 自动同步更新
- **config/build.php 新增 `notify.endpoint_path`**：默认 `/api/build/receive-notify`，可通过 `BUILD_NOTIFY_ENDPOINT_PATH` env 覆盖。未来如果 agent-admin 侧改路径，运维不需要改代码，改 env 即可
- **客户端批量操作**（新增 3 个端点 + 前端 UI）：
  - `POST /admin/api/clients/batch-import`：粘贴多行域名一次创建一组客户端（共用 owner_name / phone / 配额），notify_url 后端自动拼接；500 行上限；返回逐条结果（成功 / 域名已存在 / 格式不合法）
  - `POST /admin/api/clients/batch-delete`：批量删除，复用 destroy 的业务校验（有进行中打包任务的条目跳过不删）；200 行上限；返回逐条结果（成功 / 不存在 / 有进行中任务）
  - `POST /admin/api/clients/batch-update-status`：批量改状态（正常/停用/过期）；500 行上限
  - 前端「客户端管理」加 rowSelection + 3 个批量按钮 + 3 个 Modal（导入 / 批状态 / 结果展示）

### 变更

- 「新建客户端」与「编辑客户端」表单从 6 字段减为 5 字段（删除「通知回调 URL」），仅剩：授权域名 / 客户姓名 / 手机号 / 配额（日月）/ 过期时间
- 「授权域名」表单项的 extra 提示文案补充说明「通知 URL 会自动拼接为 {域名}/api/build/receive-notify」

### 升级指南

1. 从 0.1.0 / 0.2.0 任意版本升级到 0.2.1，只需覆盖代码 + 跑一次 `php artisan config:cache`（**不需要**再跑 migrate，本版本无新增 migration）
2. 关键：升级后需手动确保生产 `storage/framework/{cache,sessions,views,testing}` 和 `storage/app/public` 目录都存在（zip 里已带 .gitignore 占位，0.2.1 解压即可创建）
3. 现有客户端的 `notify_url` 字段值无需调整（后端仅在 store / update domain 时才重新计算），旧值依然有效
4. agent-admin **不需要**配套升级（本版本无协议变更）

### 说明

- 本版本无新增 migration，无 schema 变更
- 6 个核心代码文件改动，约 400 行；前端产物含新 hash `index-Br4eD-1T.js`

---

## [0.2.0] - 2026-05-06

> **Breaking**：授权模型从「client_id + client_secret + HMAC 签名 + 域名绑定」简化为「仅域名校验」。0.1.0 部署的 `authorized_clients` 表数据需要按本版本迁移规则升级，云控端（agent-admin）也必须同步升级到对应版本。

### 变更（Breaking）

- **去除 HMAC 签名机制**：`/api/build/*` 入站请求不再需要 `X-Client-Id` / `X-Timestamp` / `X-Signature` 三件头，只需 `Origin` 与 `authorized_clients.domain` 完全相等即放行
- **`authorized_clients` 表精简**：`drop client_secret` / `drop api_domain` / `drop contact`；`add owner_phone (varchar 30, nullable)`；保留 `client_id`（仅作内部稳定主键，不再对外暴露）
- **删除 `VerifyHmacSignature` 中间件**：`Kernel.php` 移除 `'hmac'` 别名，路由中间件链从 `[hmac, domain_binding]` 简化为 `[domain_binding]`
- **`VerifyDomainBinding` 中间件重写**：取消「依赖前置 hmac 中间件注入 client」的耦合，改为自身直接按 Origin 查 `authorized_clients`，错误码集合改为 `{origin_required, domain_not_authorized, client_inactive, client_expired}`
- **删除 `POST /admin/api/clients/{id}/rotate-secret` 端点**：client_secret 已下线
- **`auth-check` 响应字段调整**：不再返回 `expected_domain` / `got_domain`，改为返回单一的 `origin`（仅当前请求方域名，不暴露其它授权站点）
- **管理后台「新建客户端」表单精简**：从 7 字段降为 5 字段（域名 / 通知 URL / 客户姓名 / 手机号 / 配额），不再要求填 Client ID 或显示生成的 secret
- **agent-admin 配套适配**：`AgentBuildClient.php` 删除 HMAC 签名生成与 X-Client-Id/X-Timestamp/X-Signature 头；`config/cloudbuild.php` 删除 `client_id` / `client_secret` 配置项；`CloudBuildController.authCheck` 错误码翻译表精简（删 `missing_hmac_headers` / `timestamp_out_of_range` / `client_not_found_or_inactive` / `hmac_mismatch` / `origin_domain_mismatch`，新增 `domain_not_authorized` / `client_inactive`）

### 保留（不变）

- **`BUILD_SIGN_SECRET`**：仍用于 `/dl/{token}` 签名下载 URL 的 HMAC 计算，与 client 鉴权完全独立
- **`BUILD_NOTIFY_SECRET`**：仍用于 agent-build 主动 POST 到 `notify_url` 时的请求签名，云控端按同一密钥验签防伪
- **打包链路其它环节**：`build_requests` / `build_quotas` / GitHub Actions 调度 / artifact 拉取 / cron 命令均无变更

### 升级指南

1. **agent-build 端**：按 `docs/授权管理端更新包打包流程.md` 第 4.2 节用 SSH 部署新 zip + 跑 `php artisan migrate --force`
2. **数据兼容**：本版本的 migration（`2026_05_06_120000_simplify_authorized_clients_for_domain_only_auth.php`）会自动 drop 三列 + add owner_phone 一列，**不会丢业务数据**（client_id / domain / notify_url / owner_name 等核心字段都保留）
3. **agent-admin 端**：升级到对应支持 0.2.0 的版本，`.env` 里的 `AGENT_BUILD_CLIENT_ID` / `AGENT_BUILD_CLIENT_SECRET` 可保留也可删除（新版 SDK 不再读取）
4. **零停机切换不可行**：HMAC 与 domain-only 是互斥协议，agent-build 升级瞬间所有还在用 HMAC 的云控端会被 401，必须 agent-build / agent-admin 配套同时升级

### 说明

- 本版本下，`authorized_clients` 表里残留的 `client_id` 字段对所有外部调用方都不可见，仅 agent-build 内部 `build_requests.client_id` 外键引用与配额表 `build_quotas.client_id` 关联使用
- 「客户端管理」页面表格列也不再显示 `client_id`；管理员可以通过「编辑」按钮的 modal 标题（显示 domain）认主
- 测试用例：删除 HMAC 签名相关 29 用例，改写为「Origin 单一路径」用例；这部分由打包流程的「冒烟测试」覆盖（管理后台 + auth-check + request → callback → notify 全链路）

---

## [0.1.0] - 2026-05-05

### 新增

- **Phase 1 MVP 功能完整可用**：
  - 4 张核心表：`authorized_clients`（授权云控端） / `build_requests`（打包请求） / `build_quotas`（配额审计） / `template_versions`（模板版本）+ `admin_users`（后台管理员）
  - 8 个对外 API：`/api/build/{request,status,cancel,download,ack,list,template-info,callback}` + `/api/build/auth-check` + `/dl/{token}`（签名下载）
  - 5 个核心服务：`SignatureService` / `GitHubDispatchService` / `NotifyService` / `ArtifactFetchService` / `ArtifactPurgeService`
  - 3 个常驻 cron 命令：`build:worker` / `build:ack-timeout` / `build:stuck-detector`
  - 管理后台 SPA：客户端 CRUD / 打包请求列表 / 仪表盘 / 模板版本管理 / 队列控制
- **可视化安装向导 `public/install.php`**：4 步完成部署（环境检测 / 文件权限 / 数据库 / 管理员账号 + GitHub PAT），自动生成 `APP_KEY` / `BUILD_SIGN_SECRET` / `BUILD_NOTIFY_SECRET`，安装完成后写 `storage/installed.lock` 防重装
- **29 个端到端测试用例**：覆盖 HMAC + 时间戳 + Origin 域名绑定、客户端级互斥、配额扣减与退还、callback 一次性 token、签名下载 URL、BuildWorker 无 token 降级

### 说明

- 本版本为首次发布版本，全量 migrations 7 个（含 `personal_access_tokens` 从 Laravel 9 默认脚手架保留）
- GitHub fine-grained PAT 权限要求：`Actions: Read and write` 对 `local-agent-build` 仓库
- 数据库独立于 agent-admin，建议命名 `agent_build`，字符集 utf8mb4 / 排序 utf8mb4_unicode_ci
- `BUILD_SIGN_SECRET` / `BUILD_NOTIFY_SECRET` 由安装向导随机生成（`bin2hex(random_bytes(32))`），两个 secret 独立存储，互不共用

---
