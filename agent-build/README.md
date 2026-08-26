# agent-build

Cloud build backend for the LocalAgent Electron desktop application.

## Architecture

| Layer | Stack |
|---|---|
| Backend | PHP 8.0 + Laravel 9.x + MySQL 5.7+ |
| Frontend (TODO) | React + Vite + Ant Design |
| Auth | HMAC-SHA256 + domain binding |
| Build executor | GitHub Actions runner (workflow_dispatch) |

Independent of the existing `agent-admin` admin backend (separate domain `your-build-domain.example.com`, separate DB `agent_build`).

操作说明（打包许可与云控 GitHub，授权端不存 Token）：`docs/云控端打包授权与GitHub配置说明.md`

## Phase 1 MVP (this repo's current state)

- **B-M**: 4-table migration (`authorized_clients` / `build_requests` / `build_quotas` / `template_versions`)
- **B-N**: HMAC middleware + `request` + `callback` API + `QuotaService`
- **B-O**: 8 API endpoints + 5 services (`SignatureService`, `GitHubDispatchService`, `NotifyService`, `ArtifactFetchService`, `ArtifactPurgeService`)
- **B-P**: 3 cron commands (`build:worker`, `build:ack-timeout`, `build:stuck-detector`) + signed download URL real file stream

Tested end-to-end with **29 test cases** covering:

- HMAC + timestamp + Origin domain binding
- Client-level mutex
- Quota enforcement and refund
- Callback one-time token
- Real file stream download `/dl/{token}`
- BuildWorker fetch graceful degrade without `GITHUB_BUILD_TOKEN`

## Setup

```sh
cd backend
composer install
cp .env.example .env
php artisan key:generate
# Edit .env: DB_HOST / DB_DATABASE / GITHUB_BUILD_TOKEN
php artisan migrate
php artisan serve
```

## Background workers

```sh
# Run cron scheduler (Laravel built-in)
php artisan schedule:work

# Or one-shot:
php artisan build:worker --once
php artisan build:ack-timeout
php artisan build:stuck-detector
```

## Routes

- `POST /api/build/request` — 云控端发起打包（HMAC + 域名绑定）
- `GET  /api/build/status/{buildId}`
- `POST /api/build/cancel/{buildId}`
- `GET  /api/build/download/{buildId}` — 返回签名 URL
- `POST /api/build/ack/{buildId}` — 云控端确认收妥
- `GET  /api/build/list?page=N&page_size=N&status=&platform=`
- `GET  /api/build/template-info`
- `POST /api/build/callback` — GitHub Actions runner Bearer token 回调
- `GET  /dl/{token}` — 签名 URL 下载 artifact 文件流

## Design reference

`agent-admin/docs/云打包系统设计.md` (in the parent local-agent repo).
