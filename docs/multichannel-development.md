# Zihui 多端开发详细计划

## 1. 目标与边界

目标是在保留 Electron 桌面端本地能力的前提下，新增可独立部署的 Web、H5 和微信小程序入口。四个渠道共享云端账号、模型权限、对话、数字员工、生图任务、资源、余额和套餐口径。

本计划以 `agent-admin/backend` 的 Laravel 9 云控后端为业务中心，从两个既有 UI 项目白名单抽离 `agent-web` 和 `agent-mobile`，并通过共享包避免请求结构和状态机在多端漂移。UI 迁移以保留现有设计与交互为原则，主要工作从“重新搭页面”调整为“去旧品牌、替换协议、接通能力、补齐测试”。

第一阶段不迁移 Electron 的本地图库、SQLite 知识库扫描、MCP、ClawBot、FFmpeg、浏览器自动化、电商连接器、大型画布和本地 PPT/视频编辑。这些能力依赖本机文件系统或 Electron IPC，应在云端能力稳定后单独立项。

## 2. 当前基线

- 后端：Laravel 9、PHP 8.0 兼容目标、MySQL 8.0，已有 JWT、Sanctum、用户、模型、余额、套餐、订单、图片任务和队列能力。
- 管理端：React 19，继续作为运营后台，不与用户 Web 端共用页面。
- 桌面端：Electron 31、Vue 3、TypeScript，约 67 个视图，其中约 26 个直接依赖 `window.api`、SQLite、`local-file://` 或本地进程。
- Git：`main` 已同步到 `https://github.com/cangerx/zihui`，规划调整前基线提交为 `d5ece8e`。
- Web UI 来源：`/Volumes/mac1/code/aiwebb/lingmi-ai/web`，固定源提交 `3548ca66d69cc699e8119d860f4fb689cc866e9d`，技术栈为 Next.js 16 + React 19 + Zustand，生产构建已通过，共生成 48 个路由。
- H5/小程序 UI 来源：`/Volumes/mac1/code/ai-sc-xcx`，固定源提交 `ed65fabfdf1c6cb89ebb43cff44ec02095fe2bdf`，技术栈为 uni-app Vue 3 + Pinia，类型检查、H5 和 mp-weixin 构建已通过，共 13 个页面入口。
- 已有规划契约：`.agents/runtime/harness/2026-08-26-multichannel-platform/` 下的 `product_spec.json` 和 `round-01-contract.json`。

开发前必须先处理：`agent-admin/frontend/package-lock.json` 依赖图不完整、Node/PHP 版本偏离项目要求、依赖安全公告、Electron `webSecurity: false` 和全局忽略证书错误等问题。UI 抽离还必须处理源 Web 的 npm/pnpm 双 lock、`localStorage` token、`lingmi.ai` 品牌/OEM逻辑，以及源小程序的旧 take 接口、Mock 数据和客户端请求签名配置。

## 3. 目标架构

```text
                         +-------------------+
                         |  Laravel 云控后端  |
                         |   /api/app/v1      |
                         +---------+---------+
                                   |
             +---------------------+---------------------+
             |                     |                     |
       agent-desktop          agent-web            agent-mobile
        Electron/Vue       Next.js/React Web      uni-app Vue 3
        保留本地能力           浏览器 MVP          H5 + 微信小程序

        packages/contracts + packages/api-client + packages/domain + packages/validators
```

推荐技术选型：

| 层 | 方案 | 约束 |
| --- | --- | --- |
| Web | Next.js 16 + React 19 + TypeScript + Zustand + Tailwind CSS 4 | 从 `lingmi-ai/web` 抽离，不改写为 Vue，不引用 Electron 或 Node 原生业务模块 |
| H5/小程序 | uni-app Vue 3 + TypeScript + Pinia | 从 `ai-sc-xcx` 抽离，平台差异放在 adapter，优先使用 `uni.*` API |
| 共享包 | TypeScript workspace，Zod/JSON Schema 校验 | 只放纯函数、类型和协议，不放 DOM/Electron 代码 |
| API | Laravel `/api/app/v1`，JSON + SSE | 新 API 与旧 `/api/*` 并存，至少保留一个兼容周期 |
| 异步任务 | Laravel Queue + 统一 task 状态机 | 客户端只认识 `task_id` 和标准状态，不认识供应商结构 |
| 文件 | OSS/COS/S3 兼容对象存储 + 签名 URL | 浏览器和小程序不访问本地路径，服务端校验归属 |
| 包管理 | 根 npm workspace 只纳入 `packages/*`、`agent-web`、`agent-mobile` | 源 Web 的 npm/pnpm 双 lock 不复制；现有 Electron/管理端子项目首轮保持各自 lock |

## 4. 分阶段路线

时间按 1 名后端、2 名前端、1 名 QA/DevOps 的并行小团队估算；单人开发应按人日累加。复用 UI 后，页面搭建时间下降，但 API 适配、功能裁剪和回归验收仍不可省略。每阶段完成后再进入下一阶段的硬门禁。

### 阶段 0：基线与 UI 来源治理（3-5 个工作日）

任务：

1. 固定 Node 22 LTS、npm 10、PHP 8.0、Composer 和 MySQL 8.0 的 CI 版本；本地使用 `nvm`/容器提供一致环境。
2. 修复 `agent-admin/frontend` manifest/lock 不一致，所有项目确认可重复安装。
3. 盘点 `.env.example`，区分服务端密钥、公开配置和渠道配置；真实密钥不得进入 Git。
4. 建立安全基线：移除生产环境全局 `ignore-certificate-errors`，评估 `webSecurity: false`，补充 CORS、CSRF、限流、上传大小和 MIME 校验。
5. 建立 `main` 保护、PR 必须通过 CI、CODEOWNERS 和提交规范。
6. 固定两套 UI 源提交，建立复制白名单和排除清单；确认代码/图片/字体的可复用许可。
7. 为目标仓库选择单一 npm workspace lock，不复制源 Web 的 `pnpm-lock.yaml`、`pnpm-workspace.yaml` 和子目录 `package-lock.json`。

交付物：

- 可重复执行的本地启动说明和版本检查脚本。
- `quality`、`backend`、`desktop` 的首版 GitHub Actions。
- 依赖审计清单，包含当前高风险项、修复版本或临时豁免到期日。
- `docs/ui-source-migration.md`：源版本、页面矩阵、协议差异、复制白名单和视觉回归清单。

进入阶段 1 的条件：所有 lock 文件可由 `npm ci`/`composer install` 通过，CI 能在干净 runner 上完成安装；高风险安全项有明确 owner 和期限。

### 阶段 1：UI 白名单抽离与共享适配层（5-8 个工作日）

任务：

1. 从 `lingmi-ai/web` 白名单复制 `src/`、`public/`、Next/TypeScript/Tailwind/ESLint 配置和必要部署文件到 `agent-web`；排除 `.git`、`.next`、`node_modules`、`tsbuildinfo`、真实环境文件和双 lock。
2. 从 `ai-sc-xcx` 白名单复制 `src/`、`scripts/`、uni-app/Vite/TypeScript 配置和入口文件到 `agent-mobile`；排除 `.git`、`node_modules`、`dist`、真实 `.env` 和源 lock。
3. 移除或配置化旧品牌、域名、代理商/OEM、Mock 支付和客户端秘密；未接后端的入口统一受 feature flag 控制。
4. 创建 `packages/contracts`、`packages/validators`、`packages/api-client` 和 `packages/domain`；共享层不得依赖 React、Vue、DOM、`uni` 或 Electron。
5. 保留 Web 的 `src/lib/api.ts` 和移动端的 `src/api/modules/*` 作为页面兼容 facade，内部逐步改为调用共享 `api-client`，避免大面积改写页面。
6. 建立源项目与抽离项目的基线截图，覆盖 Web 和移动端的登录、首页、核心生成、任务和套餐页面。

进入 API 开发的条件：两个目标应用在未接真实后端时仍能构建；源与目标核心页面结构一致；扫描不含旧域名、客户端秘密、构建产物和未登记外部脚本。

### 阶段 2：API v1 与首批契约（5-8 个工作日）

任务：

1. 在 Laravel 中新增 `routes/app.php` 和 `App\Http\Controllers\App\`，挂载 `/api/app/v1`，不删除旧 `routes/api.php`。
2. 统一 `request_id`、幂等键、错误码和审计日志。
3. 为源 UI 使用的字段建立 mapping，不把旧 Lingmi 或 take 响应结构暴露为新领域模型。
4. 优先复用现有用户、模型、余额、套餐、订单、图片任务和队列服务。

首批 API：

```text
POST   /auth/password/login
POST   /auth/refresh
POST   /auth/logout
GET    /auth/me
POST   /auth/wechat/mini/exchange       (配置后启用)
GET    /bootstrap
GET    /models
GET    /permissions
GET    /agents
GET    /agents/{id}
GET    /conversations
POST   /conversations
GET    /conversations/{id}/messages
POST   /conversations/{id}/messages
POST   /conversations/{id}/stream       (SSE)
POST   /image-tasks
GET    /image-tasks
GET    /image-tasks/{id}
POST   /image-tasks/{id}/cancel
POST   /assets/presign
POST   /assets/{id}/complete
GET    /billing/balance
GET    /billing/plans
POST   /billing/orders
GET    /billing/orders/{orderNo}
```

响应约定：成功返回 `{data, meta, request_id}`；失败返回 `{error: {code, message, details}, request_id}`。列表优先 cursor 分页。所有资源查询必须使用当前用户 scope，禁止仅凭 ID 查询。

进入 Web 联调的条件：契约包能被 React Web 和 uni-app 引入；Laravel Feature Test 覆盖登录、`me`、模型、对话、图片任务、余额和 IDOR；旧桌面路由回归通过。

### 阶段 3：Web MVP 适配（8-12 个工作日）

页面范围：

- 登录、退出、会话失效和重新登录。
- 主布局：侧栏、当前用户、权限初始化、余额提示、错误和空状态。
- 对话：会话列表、消息列表、流式输出、中断、重试、基础 Markdown/代码展示。
- 数字员工/专家库：源 Web 不具备该用户功能，按现有设计系统新增列表、详情、权限状态和发起会话链路。
- 模板、灵感和工具入口：只展示后端已启用能力。
- AI 生图：提示词、模型/尺寸选择、上传参考图、任务进度、结果预览和下载。
- 任务记录：按类型和状态筛选，查看失败原因和重试入口。
- 余额、套餐、订单和个人中心。

实现要求：

1. `agent-web` 保留 Next.js 16 + React 19 + Zustand，所有服务端数据经兼容 facade 转入共享 `api-client`。
2. Web 认证优先 HttpOnly + Secure Cookie；不把长期 refresh token 放进 localStorage。
3. SSE 断线后按 `last_event_id` 或任务 ID 恢复；所有流式请求提供取消控制器。
4. 上传使用预签名 URL，前端只提交资产 ID；禁止把大图 base64 直接塞入对话请求。
5. 首屏以实际工作台为主，桌面和移动宽度均可用；关键按钮、加载、空数据、错误和权限拒绝状态完整。
6. `/agent/*` 当前是代理商/OEM 面板，不得改名冒充数字员工；第一轮默认隐藏。插件、返佣、自定义域名和未接通的图像工具同样由 feature flag 隐藏。

交付物：可独立启动的 `agent-web`、fake AI provider、Playwright 登录/对话/生图 smoke 测试、部署环境变量说明。

进入移动端联调的条件：浏览器无 `window.api` 时可运行；登录刷新保持、SSE 对话、图片任务全链路和两个用户的 IDOR 测试通过；与源 UI 的关键截图无非预期布局回归。

### 阶段 4：uni-app H5 与小程序适配（5-8 个工作日）

任务：

1. 以 `ai-sc-xcx` 抽离结果为 `agent-mobile`，接入共享 contracts、api-client 和 domain。
2. 接通已有首页、模板、工具、我的、登录、AI 生图、工具运行、任务、VIP 和商品套图页面。
3. 平台适配：网络请求、文件选择/上传、分享、支付和订阅消息均通过 adapter 注入。
4. H5 使用 cookie 或短期 Bearer token；小程序使用短期 access token + refresh token，并处理 token 过期。
5. 输出 H5 构建和微信开发者工具可打开的 npm/uncompiled 工程；配置合法域名、隐私协议和用户信息最小化。

交付物：`npm run type-check`、`npm run build:h5`、`npm run build:mp-weixin`、登录/工具/生图/任务/会员链路和平台差异清单。

范围说明：当前源 UI 没有通用对话页和数字员工/专家库页。第一轮不把商品套图结果页的“对话流样式”当作通用聊天能力；若小程序首发必须包含通用对话或数字员工，应另增 2-4 个工作日设计和实现，并新增验收契约。

进入微信能力联调的条件：H5 在真实手机浏览器完成登录、工具运行和任务查询；小程序在开发者工具完成登录、会话保持、生图和任务查询；依赖图无 Electron、Node 原生模块和 `better-sqlite3`。

### 阶段 5：微信登录、支付与运营能力（8-12 个工作日，依赖资质）

任务：

1. 小程序：`wx.login` code 服务端换取 `openid/unionid`，绑定已有账号或引导手机号绑定。
2. H5：微信 OAuth 回调，支持已登录账号绑定，禁止静默创建重复账号。
3. 支付：统一订单状态和幂等处理，支持小程序 JSAPI/H5 支付；服务端保存商户密钥，验签后更新订单和权益。
4. 分享：生成带 scene 参数的分享链接，服务端记录渠道归因和邀请关系。
5. 订阅消息：只在用户明确同意后发送任务完成、支付结果和异常通知。
6. 后台增加渠道开关、套餐可见性、上传限制、灰度白名单和公告配置。

前置资质：微信 AppID、主体认证、业务域名/合法域名、隐私协议、支付商户号、API v3 密钥/证书、消息模板 ID。未具备资质时只交付 fake/mock adapter，不宣称可上线。

进入扩展能力阶段的条件：沙箱或小额真实支付闭环、重复通知幂等、退款/关闭订单、登录绑定和隐私审查通过。

### 阶段 6：云端图库、知识库和多端同步（10-15 个工作日）

任务：

- 云端资源库：缩略图、签名 URL、软删除、过期清理、容量和配额。
- 对话云同步：会话/消息分页、跨设备最近会话、冲突策略和删除语义。
- 任务增强：视频、抠图等异步能力接入同一 task API，支持进度、取消、重试和供应商错误归一化。
- 云端知识库：上传、解析、索引和检索，明确租户/用户隔离；本地扫描继续由桌面端负责。
- 多端通知：Web SSE、H5 轮询/SSE、小程序轮询或 WebSocket，统一退化策略。

进入上线阶段的条件：资源生命周期和成本监控上线；跨端同步冲突有可重复测试；任务队列重试、死信和人工处理路径明确。

### 阶段 7：灰度发布与正式上线（5-8 个工作日）

任务：

1. 独立部署 Web 静态资源、Laravel API、Queue Worker、Scheduler、对象存储和监控。
2. 先内部白名单，再 5%/25%/50%/100% 渐进灰度；每级观察错误率、P95、队列积压、支付成功率和成本。
3. 配置备份、数据库迁移回滚说明、对象存储生命周期和密钥轮换。
4. 进行隐私、越权、CSRF、重放、上传、限流、依赖和 TLS 复查。

正式上线门槛：连续 24 小时无 P0/P1；核心 API 5xx < 1%；登录成功率 >= 99%；任务状态最终一致率 >= 99%；支付回调无未处理订单；有值班联系人和回滚命令。

工期口径：阶段 0-4 的多端核心 MVP 约 5-8 周；加入微信登录/支付并完成首发灰度约 8-12 周；再包含云端资源、知识库、视频任务和完整多端同步约 10-15 周。复用现有 UI 主要减少页面和视觉体系重建，不能替代 API 适配、安全整改和真机验收。

## 5. 数据模型规划

优先复用现有 `users`、`cloud_models`、`plans`、`user_balances`、`usage_records`、`payment_orders`、`image_tasks` 和队列表。新增表控制在跨端缺口：

| 表 | 关键字段 | 用途 |
| --- | --- | --- |
| `channel_identities` | `user_id`, `channel`, `provider`, `subject`, `openid`, `unionid`, `last_login_at` | 绑定 web/h5/mini_program/desktop 身份，`provider + subject` 唯一 |
| `app_conversations` | `id`, `user_id`, `agent_id`, `title`, `channel`, `last_message_at`, `deleted_at` | 云端会话，按用户隔离 |
| `app_messages` | `id`, `conversation_id`, `role`, `content`, `attachments`, `usage`, `request_id` | 云端消息和审计信息，追加写为主 |
| `app_tasks` | `id`, `user_id`, `channel`, `type`, `status`, `progress`, `idempotency_key`, `request`, `result`, `error` | 统一 queued/processing/success/failed/cancelled 状态 |
| `app_task_events` | `task_id`, `event`, `payload`, `created_at` | SSE/轮询恢复和排查，不存供应商密钥 |
| `app_assets` | `id`, `user_id`, `storage_key`, `mime`, `size`, `sha256`, `visibility`, `expires_at` | 对象存储资源、签名 URL 和生命周期 |

现有 `image_tasks` 先保留兼容，并在适配层映射到 `app_tasks`；确认新链路稳定后再考虑合并，避免桌面端回归风险。

## 6. 认证、权限和安全

- Web：Laravel Sanctum stateful cookie，HttpOnly、Secure、SameSite 按域名配置，CSRF 使用框架 token。
- H5：同域优先 cookie；跨域或微信 OAuth 场景使用短期 access token + refresh token，refresh token 只存安全容器。
- 小程序：`wx.login` code 只在服务端换取身份；access token 短期、可撤销，设备/渠道写入审计。
- Electron：首轮继续兼容现有 JWT，后续再迁移到统一 token endpoint。
- 所有 API 强制 `user_id` scope、策略类授权和对象存储签名；错误信息不得泄露供应商密钥、原始提示词中的敏感信息或内部路径。
- 上传限制扩展名 + MIME + 文件头检查，病毒/内容审核和大小配额由服务端控制。
- 关键写操作支持 `Idempotency-Key`；登录、支付、任务创建、回调和扣费均记录 `request_id`。

## 7. 分支、提交和发布策略

- `main` 只接收通过 CI 的 PR，禁止直接 push。
- 分支：`feat/contracts-*`、`feat/api-v1-*`、`feat/web-*`、`feat/mobile-*`、`feat/wechat-*`、`fix/*`。
- 提交：`feat(web): ...`、`feat(api): ...`、`fix(auth): ...`、`test: ...`、`docs: ...`。
- 每个 PR 只覆盖一个阶段或一个契约任务；必须附 API 变更、迁移说明、截图/录屏和验收命令。
- 每轮完成后打版本标签，例如 `multichannel-r1`；线上发布使用不可变构建产物和回滚版本号。

## 8. CI/CD 与测试门禁

GitHub Actions 建议拆为：

1. `quality.yml`：格式、TypeScript 类型、contracts schema、依赖锁文件一致性、secret scan。
2. `backend.yml`：PHP 8.0 + MySQL 8.0，`composer install --no-interaction`、迁移、PHPUnit Feature Test、`composer audit`。
3. `web.yml`：Node 22 + npm 10，`npm ci`/workspace install、lint、typecheck、unit、build、Playwright smoke。
4. `mobile.yml`：type-check、H5 构建、mp-weixin 构建、共享包依赖扫描。
5. `desktop.yml`：沿用现有 Electron 构建和最小回归，不因新端改动旧 preload 契约。

测试重点：

- 契约：请求/响应 snapshot、状态机非法迁移、错误码稳定性。
- 后端：登录渠道、权限、IDOR、限流、幂等、队列重试、资源签名和支付回调。
- Web：登录刷新、SSE 断线、图片任务五状态、空/错/无权限状态。
- H5/小程序：真实手机 viewport、弱网、token 过期、上传失败、返回键和分享参数。
- 发布前：依赖审计、TLS/CORS/CSRF、数据库回滚演练和 smoke 测试。

## 9. 风险与决策门

| 风险 | 影响 | 处理与决策点 |
| --- | --- | --- |
| 微信主体、支付和域名资质未齐 | 小程序/支付延期 | 移动端先交付 mock adapter；资质齐全后才排真实联调 |
| 源 UI 和 Zihui 产品语义不一致 | 错误入口和误导用户 | 按迁移矩阵分为直接复用、适配复用、暂缓；所有暂缓入口默认隐藏 |
| Web localStorage token 和小程序客户端签名 | token/签名被窃取或反编译 | Web 改 HttpOnly cookie；小程序仅保存短 token，服务端秘密不进入 `VITE_*` |
| 源 Web npm/pnpm 双 lock | CI 安装漂移 | 抽离后只维护目标根 npm workspace lock |
| 现有依赖安全债 | API 暴露面扩大 | 阶段 0 先修复高危；中危可设到期豁免，不得无限期忽略 |
| 本地模型和云端模型数据结构不同 | 重复开发、状态漂移 | contracts 只定义客户端业务语义，供应商结构留在 Laravel adapter |
| SSE/小程序网络能力差异 | 任务体验不一致 | 统一 task API；Web SSE，小程序轮询/WS，并保留轮询退化 |
| 资源生命周期不清 | 越权和存储成本 | 所有资源有 owner、用途、过期时间、签名访问和清理任务 |
| 多端并行造成版本漂移 | 回归和返工 | 契约包版本化、CI 契约校验、PR 必须带兼容说明 |

以下事项未决前不得承诺正式上线：微信 AppID/主体、支付商户号、对象存储生产桶、隐私协议和数据保留期限、AI 供应商内容安全策略、监控与值班安排。

## 10. 首个开发迭代的可执行清单

1. 合并调整后的规划、产品规格、首轮契约和 UI 迁移矩阵。
2. 修复 admin frontend lock，确定 Node 22 + npm 10/PHP 8.0 CI 镜像和根 npm workspace。
3. 按固定 SHA 和复制白名单抽离 `agent-web`、`agent-mobile`，生成来源清单，不复制依赖、产物、环境文件和源 lock。
4. 先保持 Mock 构建通过并完成截图基线，再实现 contracts、错误模型、认证 client 和 `/api/app/v1/auth/*`、`/bootstrap`。
5. 用 fake provider 打通 Web 登录、对话、图片任务，以及移动端登录、工具运行、生图和任务链路，再接真实供应商。
6. 同步补齐 PHPUnit、Playwright、移动端构建验收和 IDOR 测试；测试未通过不得开始微信支付开发。

截至 2026-08-26：清单 1-3 已完成；清单 4 仅完成 UI 抽离、生产安全开关和 Web/H5/mp-weixin 构建基线，contracts、API v1 与业务联调尚未开始；清单 5-6 待执行。

首轮完成的判断标准不是页面数量，而是：普通浏览器脱离 Electron 可以登录并完成一次对话和生图，任务状态可恢复，两个用户之间不能越权，CI 能阻止契约和依赖漂移。
