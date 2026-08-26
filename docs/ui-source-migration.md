# Web 与小程序 UI 抽离迁移矩阵

## 1. 固定来源

| 目标 | 源目录 | 固定提交 | 技术栈 | 2026-08-26 基线验证 |
| --- | --- | --- | --- | --- |
| `agent-web` | `/Volumes/mac1/code/aiwebb/lingmi-ai/web` | `3548ca66d69cc699e8119d860f4fb689cc866e9d` | Next.js 16、React 19、Zustand、Tailwind CSS 4 | `npm run build` 通过，48 个路由 |
| `agent-mobile` | `/Volumes/mac1/code/ai-sc-xcx` | `ed65fabfdf1c6cb89ebb43cff44ec02095fe2bdf` | uni-app Vue 3、Pinia、Vite | `type-check`、H5、mp-weixin 构建通过，13 个页面入口 |

每次重新同步源 UI 都必须更新固定提交、运行同一组验证并单独提交。不能以“复制最新目录”的方式覆盖目标代码，否则无法区分源 UI 更新与 Zihui 适配修改。

已知非阻塞构建告警：源 Web 同时存在 npm/pnpm 线索导致 Next.js workspace root 推断告警，且 `middleware.ts` 约定在 Next.js 16 已弃用；uni-app 构建存在 Dart Sass legacy JS API 告警。抽离后分别通过单一 lock、Next `proxy` 迁移和依赖升级消除。

## 2. 复制边界

### Web 白名单

复制到 `agent-web/`：

- `src/**`
- `public/**`，但所有图片、Logo、字体和第三方资源先确认授权与产品归属
- `package.json`
- `next.config.ts`、`tsconfig.json`；`next-env.d.ts` 由 Next.js 在目标环境生成，不属于固定源提交
- `postcss.config.mjs`、`eslint.config.mjs`
- `.dockerignore`、`.gitignore`
- 源仓库 MIT 许可声明写入目标 `THIRD_PARTY_NOTICES.md`，不覆盖 Zihui 根许可证

不复制：

- `.git/**`、`.next/**`、`node_modules/**`、`tsconfig.tsbuildinfo`
- 源 `package-lock.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`
- 源 `Dockerfile` 使用 pnpm 子 lock，与根 npm workspace 不兼容；部署阶段按仓库根构建上下文重写
- `.env*`、本地缓存、日志和源仓库 README 模板
- 未登记的部署密钥、域名证书和生成产物

### H5/小程序白名单

复制到 `agent-mobile/`：

- `src/**`
- `.gitignore`
- `scripts/h5-verify.js`
- `scripts/mp-acceptance.js`
- `package.json`
- `index.html`、`vite.config.ts`、`tsconfig.json`
- `shims-uni.d.ts` 和项目需要的声明文件

不复制：

- `.git/**`、`node_modules/**`、`dist/**`、`.DS_Store`
- `.env.development`、`.env.production` 和源 `package-lock.json`
- `.claude/**`、源项目智能体配置、审计过程文件和原型源文件
- 真实 AppID、合法域名、请求签名密码或服务端密钥

Web 源仓库顶层为 MIT License；小程序源仓库未发现独立许可证文件。抽离前需由代码所有者确认小程序源码和静态图片可用于当前商业项目，并把结论写入来源清单。

目标仓库为 `agent-web`、`agent-mobile` 和 `packages/*` 生成一套根 npm workspace lock。现有 `agent-desktop`、`agent-admin/frontend` 等子项目首轮不强制迁移包管理方式。

## 3. Web 页面迁移矩阵

“保留 UI”不等于“立即开放入口”。页面必须按后端能力和首轮范围分级。

| 页面/模块 | 处理 | 首轮要求 |
| --- | --- | --- |
| 根工作台 `/`、侧栏、主题、站点配置 | 适配复用 | 替换品牌和 `/app/*` 配置；已接模型、SSE 对话和断流停止；保留现有布局与交互 |
| 登录弹窗、注册和 OAuth callback | 适配复用 | 改用 Zihui 认证；长期 refresh token 不存 `localStorage`；OAuth 未配置项隐藏 |
| `/generate`、`/image` | 适配复用 | 接预签名上传和 `image-tasks` 状态机；保留生成参数、画布和结果交互 |
| `/recent`、`/projects` | 适配复用 | 首轮映射任务记录；云端项目未实现前不得展示伪数据 |
| `/pricing`、`/settings`、`/account-rules` | 适配复用 | 接余额、套餐、订单和账号信息；删除账号等高风险操作需后端确认和二次验证 |
| `/templates`、`/inspiration`、`/tools` | 适配复用 | 只展示 `/bootstrap` 声明启用的能力；未接通页面不进入导航 |
| `/assets` | 延后到资源阶段 | UI 保留；对象存储、目录、配额、归属和删除语义完成后再开放 |
| `/collage`、`/editor`、`/resize`、`/id-photo`、`/batch-edit` | 独立验收后开放 | 浏览器本地处理能力可以复用，但要验证跨域图片、内存、移动端和下载行为 |
| `/product-photo`、`/cutout`、`/eraser`、`/expand`、`/upscale`、`/poster`、`/video`、`/copywriting` | 按供应商逐项开放 | 统一映射 `app_tasks`，没有后端 adapter 和计费规则时隐藏入口 |
| `/agent/*` | 第一轮隐藏 | 当前语义是代理商/OEM 分站管理，不是数字员工/专家库，不能改名复用 |
| `/plugins/*` | 第一轮隐藏 | 已改为默认关闭的 Zihui 功能开关；远程脚本注入上线前需单独安全设计 |
| `/referral*` | 第一轮隐藏 | 依赖邀请、佣金和提现模型，不属于首轮用户工作台 |
| `/music`、`/a-plus`、`/portrait`、`/coming-soon`、`/more` | 默认隐藏 | 由产品能力清单决定，不保留无功能的“即将上线”入口 |
| `/terms`、`/privacy` | 内容替换后复用 | 必须替换为 Zihui 实际协议、主体、数据处理和联系方式 |

Web 当前没有可直接视为“数字员工/专家库”的页面。该功能保留在 Web MVP，需基于现有工作台设计语言新增列表、详情和发起会话页面，不能复用 `/agent/*` 代理商面板。

## 4. H5/小程序页面迁移矩阵

| 页面/模块 | 处理 | 首轮要求 |
| --- | --- | --- |
| 首页、模板、工具、我的四个 Tab | 适配复用 | 数据从 Mock 改为 `/bootstrap`、模板/能力接口和当前用户；未启用入口隐藏 |
| `tool-intro`、`ai-image`、`canvas-create` | 适配复用 | 接真实模型/工具 schema；保留现有视觉和表单交互 |
| `tool-run`、`suite-run`、`suite-result` | 适配复用 | 旧工作流接口映射统一任务；防重复提交、取消轮询和失败恢复必须保留 |
| `task-history` | 适配复用 | 移除页面内 Mock，接统一任务列表和状态筛选 |
| `login` | 适配复用 | 邮箱/账号登录接新认证；`uni.login` code 仅传服务端换身份 |
| `vip` | 适配复用 | 接套餐和当前权益；支付未具备资质时 CTA 显示不可购买状态，不伪造成功 |
| 素材弹窗、模板瀑布流、会员弹窗 | 保留组件 | 数据源替换后复用，检查主包/分包体积 |
| 通用对话 | 当前缺失 | 若列入小程序首发，需新增页面、会话列表、消息渲染和轮询/流式退化 |
| 数字员工/专家库 | 当前缺失 | 若列入小程序首发，需新增列表、详情、权限和发起会话链路 |
| 收藏、云端素材库 | UI 不完整 | 资源阶段再开放，不用 Mock 冒充持久数据 |

小程序的套图结果页采用“对话流样式”展示任务过程，但它不是通用聊天页，不能据此把通用对话标记为已完成。

## 5. 接口适配映射

页面不直接批量重写。保留 Web `src/lib/api.ts` 和移动端 `src/api/modules/*` 作为兼容 facade，内部调用共享 `packages/api-client`，待联调稳定后再按模块收敛。

### Web 旧接口

| 源调用 | Zihui `/api/app/v1` | 说明 |
| --- | --- | --- |
| `/auth/login`、`/auth/profile`、`/auth/refresh` | `/auth/password/login`、`/auth/me`、`/auth/refresh` | 改 HttpOnly Cookie 或短期 access token 策略 |
| `/app/modules`、`/app/apps`、`/app/login-methods`、`/app/site-config` | `/bootstrap` | 返回渠道能力、品牌、登录方式和开关 |
| `/models*` | `/models` | 用 `type/capabilities` 过滤，不暴露供应商密钥 |
| `/conversations*` | `/conversations*` | 统一会话和消息 envelope；Web 使用 SSE，服务端完成后持久化 assistant，失败不重复扣费 |
| `/image/generate` | `/image-tasks` | 同步生成响应改为异步 `task_id` |
| `/generations*` | `/tasks*`（`type=image`） | 映射状态、进度、结果资源和失败原因 |
| `/upload` | `/assets/presign` + 对象存储直传 + `/assets/{id}/complete` | 禁止大文件经 PHP 中转或 base64 入请求 |
| `/user/credits`、`/packages` | `/billing/balance`、`/billing/plans` | 适配现有余额和套餐字段 |
| `/orders*`、`/order-status/*` | `/billing/orders*` | `mock-pay` 仅测试环境可存在 |
| `/space/*`、`/brand-kits/*` | 延后 | 等资源和品牌模型明确后接入 |
| `/agent/*`、`/referral/*`、`/app/plugins` | 第一轮不映射 | 导航和路由受 feature flag 控制 |

### 小程序旧接口

| 源调用 | Zihui `/api/app/v1` | 说明 |
| --- | --- | --- |
| `/auth/email/Login`、`/auth/email/Register` | `/auth/password/login`、后续注册接口 | 统一错误码，不沿用 402 表示未登录 |
| `/auth/wechat/Login` | `/auth/wechat/mini/exchange` | code 只使用一次，服务端保存微信密钥 |
| `/ai/app/GetAppListByCategory`、`/ai/app/GetApp` | `/bootstrap`、能力/模板详情接口 | 先定义 Zihui 工具 schema，再做字段映射 |
| `/ai/app/worker/Run` | `/image-tasks` 或 `/tasks` | 携带 `Idempotency-Key`，返回标准任务 |
| `/ai/app/worker/Query` | `/tasks/{id}`（`type=image`） | 统一五状态和轮询退避 |
| `/filesystem/file/PrepareUpload`、`CompleteUpload` | `/assets/presign`、`/assets/{id}/complete` | 支持小程序 `uni.uploadFile`/PUT adapter |
| `x-request-token` 双 MD5 签名 | 删除客户端秘密 | 公开客户端无法保守固定密码；改 TLS、短 token、限流、nonce 和服务端审计 |

截至 2026-08-26，移动端生产工具页已完成第一条真实链路：`/bootstrap` 控制 AI 生图可见性，`/models?type=image` 生成表单模型选项，`/image-tasks` 提交文生图，`/tasks/{id}` 轮询并在任务历史中区分排队、处理中、成功、失败和取消。参考图已接入 `/assets/presign` → 二进制 PUT → `/assets/{id}/complete`，任务只提交 `asset_ids`；生产资产能力默认仍由 `APP_V1_ENABLE_ASSETS=false` 关闭，需在完成 COS/OSS、HTTPS CORS 和微信合法域名联调后再打开。旧 `GetApp`、`worker/Run`、`worker/Query` 仅保留在开发 Mock 分支。

## 6. 建议提交顺序

1. `chore(ui): import frozen web and mobile sources`
   只做白名单抽离、来源清单、根 workspace 和构建修复。不得同时改页面业务。
2. `refactor(client): route source facades through shared contracts`
   建立 contracts/api-client/domain/validators，替换旧品牌、域名、token 和请求层。
3. `feat(api): add app v1 bootstrap and authentication`
   接登录、会话保持、能力开关和账号信息。
4. `feat(web): connect chat and image task workflows`
   打通 Web SSE 对话、生图和任务历史；验证断流停止、服务端持久化和同步 fallback 不重复执行。
5. `feat(mobile): connect tools image tasks and membership`
   打通移动端登录、工具、生图、任务和会员。
6. `test: add multichannel smoke and visual baselines`
   固化源/目标截图、Playwright、H5/mp-weixin 构建和后端 IDOR 测试。

每一步都应独立可构建、可回滚。UI 抽离提交不接受无关格式化，以便后续通过 `git diff` 追踪源 UI 的真实变化。

## 7. 完成标准

- `agent-web` 与 `agent-mobile` 能从干净环境安装和构建，只有一套目标 workspace lock。
- 源 UI 的核心页面在相同 viewport 下无非预期视觉回归。
- 生产构建中不存在源品牌域名、Mock 支付按钮、客户端固定签名密码或真实测试网关。
- 功能入口完全由 `/bootstrap` 的渠道能力控制；关闭能力既不可见也不可通过直接路由调用。
- Web 登录、对话、生图、任务和套餐，以及移动端登录、工具、生图、任务和会员均能走 Zihui API。
- 两个测试用户之间的会话、任务、资源、订单和余额访问均通过 IDOR 测试。
