# Round-07 后端迁移报告

日期：2026-09-02  
范围：`task_php82_laravel12_migration_030`  
Round-07 当时结论：**候选依赖可解析，正式 Composer lock 暂不切换**。

> **Round-08 后续状态（2026-09-02）**：本文以下内容保留为 Round-07 的历史取证，不能再作为当前依赖状态使用。主工作树的正式约束和 lock 已切换到 PHP `^8.2`、Laravel `12.69.1`、Sanctum `4.3.3`、PHPUnit `11.5.56`，Composer platform 固定为 `8.2.0`；当前 Composer 审计为 0 advisory。迁移后的 App v1 定向回归为 34 tests / 252 assertions，跨驱动迁移定向回归为 4 tests / 18 assertions；cloud-build contract baseline 已重建，后端本地全量回归为 195 tests / 1130 assertions。上述本地验证实际运行于 PHP `8.5.3`，只借助 Composer platform 模拟最低 PHP 版本，不能替代 PHP 8.2 真实运行时证据；PHP 8.2 与 MySQL 8.0 的精确验证依赖 CI。当前迁移详情见 `round-08-backend-migration.md`。

## Round-07 当时基线

- 基线提交：`2a0f378`。
- 当前生产依赖仍为 PHP `^8.0`、Laravel `^9.19`、Sanctum `^2.15`、PHPUnit `^9.5`，Composer platform 为 `8.0.28`。
- 主工作树的 `composer.json` 与 `composer.lock` 未在本次迁移实验中改写。
- 本机 PHP 为 `8.5.3`；候选解析固定 Composer platform 为 `8.2.0`，不能以本机 PHP 8.5 代替 PHP 8.2 兼容证据。

## 候选解析证据

在临时完整后端副本中执行：

```text
composer require --no-update php:^8.2 laravel/framework:^12.0 laravel/sanctum:^4.0 laravel/tinker:^2.10
composer require --dev --no-update nunomaduro/collision:^8.0 phpunit/phpunit:^11.0 spatie/laravel-ignition:^2.0
composer config platform.php 8.2.0
composer update --with-all-dependencies --no-interaction --no-scripts
```

解析成功（134 installs，0 updates，0 removals）。关键版本：

| 包 | 解析版本 |
| --- | --- |
| `laravel/framework` | `v12.69.1` |
| `laravel/sanctum` | `v4.3.3` |
| `laravel/tinker` | `v2.11.1` |
| `nunomaduro/collision` | `v8.9.5` |
| `phpunit/phpunit` | `v11.5.56` |
| `spatie/laravel-ignition` | `v2.12.0` |
| `symfony/*` | `v7.4.x` |
| `monolog/monolog` | `3.10.0` |
| `nesbot/carbon` | `3.13.2` |

临时 lock SHA-256：`5a86e9022effcec2ed0d98d7e9979f45617b4cbc12ad289e53ff5b6a4721ba5e`。

## Laravel 12 验证结果

临时副本验证通过：

- `php artisan about`：Laravel `12.69.1` 可启动。
- `php artisan route:list --path=api/app/v1`：25 条 App v1 路由成功注册。

AppV1 Feature 回归未通过，不能将候选 lock 提升为正式 lock。失败在测试数据库迁移阶段，当前已确认的阻断如下：

1. 历史迁移 `2026_07_15_000008_optimize_video_skus_and_nullable_default_price.php` 使用 MySQL 专用 `ALTER TABLE ... MODIFY`，SQLite 测试报 `near "MODIFY": syntax error`。
2. 其余迁移仍存在 `information_schema`、`FULLTEXT` 等 MySQL 专用路径，需统一做驱动适配或建立 MySQL 测试服务后才能得到完整回归证据。
3. 现有完整 PHPUnit 基线为 191 tests / 973 assertions / 10 errors，10 个错误来自缺失的云打包迁移 fixture（`agent-admin/docs/contracts/cloud-build-migration/*.json`），与 App v1 迁移候选无直接关系，但会阻止全量门禁变绿。

## 本次代码适配

已将以下迁移中的索引探测改为 SQLite、PostgreSQL、MySQL 分支，避免继续直接查询 MySQL `information_schema`：

- `database/migrations/2026_05_03_000005_add_source_plan_id_columns.php`
- `database/migrations/2026_05_26_000001_create_video_core_tables.php`
- `database/migrations/2026_07_15_000004_add_subscription_fields_to_user_plans_and_payment_orders.php`
- `database/migrations/2026_07_15_000005_add_oem_channel_commission_tables.php`
- `database/migrations/2026_07_15_000010_add_last_login_at_to_users_table.php`

这部分是兼容性修复，不代表所有迁移已完成跨数据库适配；正式升级前仍需处理上面列出的原生 `ALTER`/`FULLTEXT` 路径并回归 MySQL 8.0。

## Round-07 提出的继续迁移门槛

1. 把所有迁移中的数据库专用 SQL 列成清单，优先修复测试会执行的 `MODIFY`、`information_schema` 和 `FULLTEXT`。
2. 在 PHP 8.2 + MySQL 8.0 CI 服务中执行 `composer install`、全量迁移和 AppV1 Feature/Unit 套件；SQLite 仅作为快速回归，不替代 MySQL 证据。
3. 补齐或恢复缺失的云打包 fixture，使全量 PHPUnit 不再因文件缺失失败。
4. 迁移通过后，才把候选约束写入正式 `composer.json` 并提交独立 `composer.lock`；随后运行 `composer audit --format=json`，按实际 advisory 更新安全说明。

## 可复现命令

```bash
cd agent-admin/backend
composer validate --strict
vendor/bin/phpunit --filter='AppV1'
vendor/bin/phpunit --filter='AppV1TaskLifecycleTest'
vendor/bin/phpunit
find app config routes database tests -type f -name '*.php' -print0 | xargs -0 -n1 php -l
```

Round-07 执行时，主工作树中的 `composer.json`/`composer.lock` 保持 Laravel 9 兼容线，避免在迁移证据不完整时影响既有桌面端和管理端部署；该句是历史记录，已被文首的 Round-08 后续状态取代。
