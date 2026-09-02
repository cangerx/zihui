# 多端开发安全基线（2026-08-26）

## 已处理

- 根 workspace 固定 Node 22 LTS 与 npm 10.9.2，并使用一套 `package-lock.json` 管理 `agent-web`、`agent-mobile` 和后续 `packages/*`。
- `agent-admin/frontend` 的不完整 lock 已重建；Axios、React Router 和 Vite 已升级到同主版本安全修复版，构建通过。
- `agent-build/backend` 已补 `package-lock.json`，可执行 `npm ci`。
- `agent-desktop` manifest 与 lock 的版本统一为 1.3.2。
- Next.js 已从 16.2.4 升级到 16.3.3；移动构建 Vite 已从 5.2.8 升级到 5.4.21。
- 移动端删除客户端固定密码、双 MD5 请求签名、旧测试网关和 `VITE_REQUEST_PASSWORD`，真实请求只接受 `VITE_API_BASE`。
- 移动端请求层 Mock 只允许开发构建启用，生产构建不能回退到 Mock；页面内仍有原型占位数据，必须在 API v1 联调时逐页移除。
- Web 的代理商、远程插件、邀请和 Mock 支付默认关闭，直接访问对应路由也会被 Proxy 拦截。
- Web OAuth 只显示服务端声明且配置了公开 Client ID 的方式，不再包含占位 Client ID。
- Web 图片主机由 `NEXT_PUBLIC_IMAGE_HOSTS` 白名单控制，不再允许任意 HTTPS 主机。

## 依赖审计

在 Node 22.22.0/npm 10.9.2 下验证：

| 范围 | Low | Moderate | High | Critical | 处理结论 |
| --- | ---: | ---: | ---: | ---: | --- |
| 根 workspace（全部依赖） | 13 | 40 | 13 | 3 | Critical 位于 DCloud 非目标平台的旧开发依赖链；禁止 `audit fix --force`，单独升级 uni-app 工具链 |
| 根 workspace（生产依赖） | 1 | 33 | 11 | 0 | 主要来自 DCloud 编译/运行依赖，H5/小程序上线前完成可达性复核 |
| `agent-admin/frontend` | 1 | 0 | 1 | 0 | 直接依赖高危已清理；剩余为间接工具链公告 |
| `agent-build/backend` | 1 | 1 | 1 | 0 | Vite 4 和 Laravel Vite Plugin 需跨主版本升级，独立排期 |

上述表格是 UI 抽离时的初始快照，审计数会随公告数据库变化。Round-04 已将主开发范围改为逐条 high/critical 门禁：根 workspace 和 `agent-admin/backend` 的既有高危必须在 `scripts/security-audit-policy.json` 中精确匹配生态、锁文件范围、GHSA、包名和严重级别，并具有 owner、到期日与退出条件；新增、过期、陈旧或通配例外都会使 CI 失败。`agent-admin/frontend` 与 `agent-build/backend` 当前生产审计为 0 high/critical，不允许例外。

2026-08-26 Round-04 复核结果：

| 范围 | 修复前 | 修复后 | 当前结论 |
| --- | --- | --- | --- |
| `agent-admin/backend` Composer | 32 条 / 10 包 | 12 条 / 6 包，其中 4 条显式 high、0 critical | Guzzle、PSR-7、CommonMark high 已消除；Laravel 9 与 Symfony 6.0 的 4 条 high 需要 PHP 8.2/Laravel 12 独立迁移，例外最晚 2026-09-30 到期 |
| 根 workspace `--omit=dev` | 45 条：1 low / 33 moderate / 11 high / 0 critical | 数量未下降 | DCloud 固定传递依赖的 9 条独立 high GHSA 已精确登记；无效 overrides 已撤回，不得声称已修复 |
| `agent-admin/frontend` `--omit=dev` | 0 high / 0 critical | 0 high / 0 critical | CI 必须保持为零 |
| `agent-build/backend` `--omit=dev` | 0 high / 0 critical | 0 high / 0 critical | CI 必须保持为零 |

2026-09-02 Round-08 当前状态（不覆盖上面的历史快照）：

| 范围 | 当前结果 | 当前结论 |
| --- | --- | --- |
| `agent-admin/backend` Composer | 0 advisory / 0 abandoned package | 正式依赖已切换到 PHP `^8.2`、Laravel `12.69.1` 和 Composer platform `8.2.0`；原 Laravel 9/Symfony 6.0 high 例外已清除 |
| 根 workspace `--omit=dev` | 11 high / 46 total | Node 22/npm 10 最新审计仍对应 9 条独立 high GHSA，已精确登记但未修复；基线脚本阻止依赖静默漂移 |
| `agent-desktop` `--omit=dev` | 5 high 包记录 / 12 条独立 high GHSA / 0 critical | updater 和兼容依赖已升级，文件解析链已加固；12 条 high 例外最晚 2026-09-30 到期，仍需 Electron、PPTX 图片和 XLSX 退出方案 |

Composer 的本地验证实际运行于 PHP `8.5.3`，只通过 Composer platform 固定 PHP `8.2.0` 的依赖解析下界；GitHub Quality run `33635828129` 已补齐 PHP 8.2 与 MySQL 8.0 的精确安装、迁移和完整测试证明。cloud-build fixture 已重建，后端本地全量 PHPUnit 为 195 tests / 1130 assertions；这些证据仍不能把 Composer 零发现扩展为生产就绪结论。

`agent-admin/docs-frontend`、`agent-build/frontend`、`agent-desktop` 与根 workspace 各自拥有独立 lock 和审计边界，不能复用 Composer 或其他 scope 的例外。桌面审计细节见 `agent-desktop/docs/round-08-security-audit.md`，DCloud 锁定版本和退出条件见 `docs/dcloud-dependency-baseline-2026-09-02.md`。

## 上线前硬阻塞

- Web 仍使用源 UI 的 localStorage Bearer token；必须随 `packages/api-client` 和 `/api/app/v1` 认证接入改为 HttpOnly Cookie 或短期 token + refresh 机制。
- Web、H5 和小程序的登录、bootstrap、套餐/余额、对话或生图任务等核心链路已接通 `/api/app/v1`；尚未迁移的页面仍需逐页移除 Mock 与旧 facade，不能用核心链路通过代替全页面验收。
- 小程序 AppID 为空且 `urlCheck` 为开发设置；需配置真实 AppID、合法域名、隐私声明与支付资质。
- Web 导入的头像、WebP 和品牌 Logo 需要肖像权、商标和产品素材授权复核；移动端源码与资产需要所有者确认许可。
- 当前来源记录只证明固定提交、目标快照和内部开发用途，不等同于公开分发或生产使用授权；未完成确认前不得用于商业发布。
- `agent-admin/backend` 已迁移到 PHP 8.2/Laravel 12 目标线且 Composer 审计归零，本地全量回归和精确 PHP 8.2/MySQL 8.0 CI 门禁均已通过。DCloud 的 9 条独立 high GHSA 与 Electron 的 12 条独立 high GHSA 仍为既有安全债务，必须按各自退出条件清除，不能因 Composer 归零而忽略，也不能通过延长或通配豁免上线。
