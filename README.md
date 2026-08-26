# Local Agent 源码交付包

本包用于在新环境继续开发或部署「桌面端」「云控端」「授权管理端」。已剔除依赖与构建产物（`node_modules` / `vendor` / `dist` / `out` / `.git`），示例文件中的数据库密码、APP_KEY、JWT、打包密钥、域名等均为占位符。到新机器后重新安装依赖即可开发。

购买软件后请先读根目录 **`交付说明.md`**（相对 2026-08-12 源码包的更新与升级注意）。

> 打包时间：2026-08-24。本包不含 `产品转型调研/`，也不含内部工作流、研发计划与流程说明。

## 目录结构

```
local-agent-portable/
├── 交付说明.md            面向实施方：本次更新与升级注意
├── README.md              本文件：总览与导航
├── 开发说明.md            三端本地开发环境搭建
├── 部署说明.md            三端生产部署流程
├── deploy.local.example   本实例发布通道模板（复制为 deploy.local 填写；ssh 或 cloudflare）
│
├── agent-admin/           【云控端】v1.6.43  PHP 8.0 (Laravel 9) + React 19 + MySQL 8.0
│   ├── backend/           Laravel 后端（无 vendor / .env / 运行时缓存）
│   ├── frontend/          管理后台 React SPA（无 node_modules / dist）
│   ├── docs-frontend/     用户文档站点 React SPA（无 node_modules）
│   ├── docs/              运维文档（Qdrant、GitHub 打包配置、macOS 安装说明等）
│   └── CHANGELOG.md
│
├── agent-desktop/         【桌面端】v1.3.2  Electron 31 + Vue 3 + electron-vite
│   ├── src/               主进程 / 预加载 / 渲染层源码
│   ├── resources/         打包随附资源（图标、内置技能、schema.sql 等）
│   ├── build/             electron-builder 构建资源（图标、installer.nsh）
│   ├── scripts/           打包辅助脚本（mac 双架构分打、OEM 参数注入、模板打包等）
│   ├── deck-templates-src/ AI PPT 模板源
│   ├── docs/              功能规格（deck 等）与对接说明
│   ├── .github/           CI 工作流（build-win / build-mac，构建参考）
│   └── package.json 等配置
│
├── agent-build/           【授权管理端】v0.19.2  PHP 8.0 (Laravel 9) + React 19 + MySQL 8.0
│   ├── backend/           Laravel 后端（无 vendor / .env / 运行时缓存 / 编译产物）
│   ├── frontend/          管理后台 React SPA（无 node_modules / dist）
│   ├── docs/              运维文档（COS、GitHub 打包授权配置等）
│   ├── DEPLOY.md          部署指南
│   └── CHANGELOG.md
│
└── agent-mirror-worker/   【可选】云打包产物跨境回传 worker（Python，无第三方依赖）
```

## 三端关系

- **云控端 (agent-admin)**：部署在服务器（生产域名 `https://your-admin-domain.example.com`），提供账号/套餐/模型路由/知识库/AI PPT 资源/生图风格预设/Skills 目录/在线更新等后台能力，并对外提供 API。客户端云打包的队列与回调也可在本端执行（生产默认仍可走授权端 remote）。
- **桌面端 (agent-desktop)**：面向终端用户的 Electron 客户端，登录并调用云控端 API。含对话引擎、画布、AI PPT（HTML-IR 引擎）、微信 ClawBot 渠道、多商城（ewei/点大/qdyun）集成、双轨技能库等。
- **授权管理端 (agent-build)**：部署在服务器（生产域名 `https://your-build-domain.example.com`），管理云控端授权、Skills 审核签发、商城授权、开源交付收款。默认不再对外提供客户端打包入口（`/api/build/*` 返回 410）。
- 三端**独立部署、独立发版**。若 GitHub 产物需跨境回传，可部署本包内的 `agent-mirror-worker/`。

## 快速开始

1. 装好基础环境（见「开发说明.md」）：Node.js（建议 20 LTS）、PHP 8.0、Composer、MySQL 8.0。
2. 云控端后端：`composer install` → 复制 `.env.example` 为 `.env` → 填 DB → `php artisan key:generate` → `php artisan jwt:secret` → `php artisan migrate`。
3. 云控端前端 / 文档站：分别 `npm install` → `npm run dev`。
4. 桌面端：`npm install`（会自动为原生模块 rebuild）→ `npm run dev`。
5. 授权管理端：后端流程同云控端（`composer install` → `.env` → `key:generate` → `migrate`），前端 `npm install` → `npm run dev`。

详细步骤见 **开发说明.md**；生产上线见 **部署说明.md**。

## 重要提示

- 所有 `.env.example` 中的凭据均为**占位符**（`your-*.example.com` / `your_db_*` / `your-org/*`），需按新环境填写真实值，且**不要把真实值提交回代码库**。
- 本包不含 `.git`，到新机器后可在各子项目 `git init` 重新建立版本库。
- 本包不含内部工作流、研发计划、方案/分析稿和更新包制作流程说明。搭建与上线只看 `开发说明.md`、`部署说明.md` 与 `交付说明.md`。
