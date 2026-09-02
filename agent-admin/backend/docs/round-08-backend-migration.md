# Round-08 后端迁移状态

日期：2026-09-02  
范围：`agent-admin/backend` 正式 PHP 8.2 / Laravel 12 依赖线、跨驱动迁移和安全审计  
状态：**正式依赖已切换，本地完整回归与 GitHub PHP 8.2/MySQL 8.0 门禁均通过**。

## 正式依赖状态

主工作树的 `composer.json` 和 `composer.lock` 已不再使用 Round-07 的 Laravel 9 候选线：

| 项目 | 当前值 |
| --- | --- |
| PHP 约束 | `^8.2` |
| Composer platform | `8.2.0` |
| Laravel | `12.69.1` |
| Sanctum | `4.3.3` |
| Collision | `8.9.5` |
| PHPUnit | `11.5.56` |
| Laravel Ignition | `2.12.0` |

当前 lock 的 `composer audit --format=json` 返回空 `advisories` 和空 `abandoned`，原 Laravel 9/Symfony 6.0 high 例外已经不再需要。Composer 零发现只说明该 PHP 依赖图在当前公告库中无已知问题，不代表其他 npm lock 或完整产品已经达到上线条件。

## 已取得的本地证据

- `composer validate --strict`、`composer install --dry-run` 和 `composer run post-autoload-dump` 通过。
- `php artisan about` 加载 Laravel `12.69.1`；`/api/app/v1` 的 25 条路由可注册。
- App v1 定向回归为 34 tests / 252 assertions。
- 跨驱动迁移定向回归为 4 tests / 18 assertions；SQLite 分支不再用 `0` 代替 nullable，MySQL `MODIFY`/`FULLTEXT` 保留在明确的驱动分支中。
- cloud-build 的 6-job 确定性脱敏 contract baseline 已重建；CloudBuild 套件为 117 tests / 683 assertions，fixture 核心契约为 16 tests / 178 assertions。
- `php artisan test --without-tty` 本地全量回归为 195 tests / 1130 assertions，无失败和 warning。
- Composer 审计为 0 advisory / 0 abandoned package。

本地 CLI 是 PHP `8.5.3`，Composer platform 固定为 `8.2.0`。platform 约束能验证依赖解析下界，但不会把 PHP 8.5 变成 PHP 8.2，因此本地结果不能单独作为 PHP 8.2 精确运行时证明。GitHub Quality run `33635828129` 已在 PHP 8.2 runner 和 MySQL 8.0 service 上完成 Composer 安装、安全审计、`migrate:fresh`、路由加载与完整 PHPUnit，`backend-app-v1` job 成功。

## 尚未关闭的门禁

原 cloud-build migration fixture 从未入库，不能声称恢复历史内容。本轮已经重新建立 6-job 确定性脱敏 baseline 和配套 runbook，source/target canonical SHA-256 均为 `f33b7624fe8ddb0aa7408e2897b063e087a459ff7d48a1a332bab0b769f3ca44`；依赖 fixture 的专项测试和全量 PHPUnit 已形成上述通过证据。

H5 和 mp-weixin 已在 Node `22.23.0` / npm `10.9.2` 的干净根依赖安装后构建通过，GitHub `multichannel-ui` job 也完成 Web/H5/mp-weixin、类型、lint、契约、独立 lock 和安全门禁。Round-08 evaluation 已通过。DCloud/uni-app 和 Electron 使用独立 npm lock 与独立安全门禁，不会因 Composer 审计归零而自动关闭；真实对象存储、微信合法域名和平台能力仍未联调，本文不作生产就绪声明。
