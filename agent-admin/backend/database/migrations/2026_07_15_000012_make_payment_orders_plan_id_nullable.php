<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 直充订单没有套餐，plan_id 需可空。
 * 用原生 ALTER MODIFY 避免依赖 doctrine/dbal。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            return;
        }
        if (Schema::hasColumn('payment_orders', 'plan_id')) {
            DB::statement('ALTER TABLE payment_orders MODIFY plan_id BIGINT UNSIGNED NULL');
        }
    }

    public function down(): void
    {
        // 不回滚：若已存在 plan_id 为 NULL 的直充订单，改回 NOT NULL 会失败。
    }
};
