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

审计数会随公告数据库变化。CI 当前阻止 production critical，新高危需在合并评审中判断可达性与升级方案。

## 上线前硬阻塞

- Web 仍使用源 UI 的 localStorage Bearer token；必须随 `packages/api-client` 和 `/api/app/v1` 认证接入改为 HttpOnly Cookie 或短期 token + refresh 机制。
- Web/H5/小程序仍未接通 `/api/app/v1`，Mock 与旧 facade 不能作为业务完成证据。
- 小程序 AppID 为空且 `urlCheck` 为开发设置；需配置真实 AppID、合法域名、隐私声明与支付资质。
- Web 导入的头像、WebP 和品牌 Logo 需要肖像权、商标和产品素材授权复核；移动端源码与资产需要所有者确认许可。
- 当前来源记录只证明固定提交、目标快照和内部开发用途，不等同于公开分发或生产使用授权；未完成确认前不得用于商业发布。
- PHP 8.0、Laravel 9、DCloud 旧平台依赖和 Electron TLS 放宽配置均为既有安全债务，需分阶段升级或收紧。
