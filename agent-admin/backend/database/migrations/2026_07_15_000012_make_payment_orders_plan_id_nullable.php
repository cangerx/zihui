<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 直充订单没有套餐，plan_id 需可空。
 * 按数据库驱动使用原生 ALTER，避免依赖 doctrine/dbal，也不把 MySQL
 * 的 MODIFY 语法发送到 SQLite/PostgreSQL。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('payment_orders', 'plan_id')) {
            return;
        }

        $driver = DB::connection()->getDriverName();
        if ($driver === 'mysql') {
            DB::statement('ALTER TABLE payment_orders MODIFY plan_id BIGINT UNSIGNED NULL');
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE payment_orders ALTER COLUMN plan_id DROP NOT NULL');
        }
    }

    public function down(): void
    {
        // 不回滚：若已存在 plan_id 为 NULL 的直充订单，改回 NOT NULL 会失败。
        // SQLite 保持原列定义；PostgreSQL/MySQL 也不强行破坏已写入的直充订单。
    }
};
