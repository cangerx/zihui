# agent-build 管理后台

云端打包系统的运维后台。

## 技术栈
- Vite 5 + React 18 + TypeScript 5
- Ant Design 5
- TanStack Query v5
- React Router v6
- Axios

## 功能页
- 仪表盘（按天/周/月聚合统计、Top 客户端）
- 客户端管理（CRUD 授权云控端，重置密钥）
- 打包请求列表（多维过滤、状态徽章、行操作）
- 任务详情（时间线、GitHub run 链接、强制取消/重试/清理）
- 模板版本管理（增删改、设为当前）
- 队列管理（暂停/恢复 dispatch）

## 后端依赖
- agent-build/backend 暴露 `/admin/api/*`（Sanctum Bearer token）
- 默认开发 base：`http://127.0.0.1:8000`，由 vite.config.ts 代理

## 启动
```bash
npm install
npm run dev    # http://localhost:5174
npm run build  # 产物在 dist/
```
