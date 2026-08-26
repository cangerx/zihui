<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 容量计费字段：
 *   - plans.storage_quota_bytes : 该套餐赠送的云存储容量（字节）
 *   - user_plans.storage_granted: 发放时快照的容量（用户配额 = 默认 + Σ active user_plans.storage_granted）
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('plans', function (Blueprint $table) {
            if (!Schema::hasColumn('plans', 'storage_quota_bytes')) {
                $table->unsignedBigInteger('storage_quota_bytes')->default(0)->after('credit_quota');
            }
        });

        Schema::table('user_plans', function (Blueprint $table) {
            if (!Schema::hasColumn('user_plans', 'storage_granted')) {
                $table->unsignedBigInteger('storage_granted')->default(0)->after('credit_granted');
            }
        });
    }

    public function down(): void
    {
        Schema::table('plans', function (Blueprint $table) {
            if (Schema::hasColumn('plans', 'storage_quota_bytes')) {
                $table->dropColumn('storage_quota_bytes');
            }
        });
        Schema::table('user_plans', function (Blueprint $table) {
            if (Schema::hasColumn('user_plans', 'storage_granted')) {
                $table->dropColumn('storage_granted');
            }
        });
    }
};
