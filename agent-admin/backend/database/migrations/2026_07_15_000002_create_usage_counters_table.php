<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 周期性次数计数器 usage_counters
 *
 * 与 plan_permissions 中的配额 policy_key 配合实现「次数」维度配额：
 *   - chat_quota_per_day / chat_quota_per_month
 *   - image_quota_per_day / image_quota_per_month
 *   - embed_chars_per_day （字符数累加，单位仍是"次"）
 *   - matting_quota_per_month（与现有 image_matting_quota_per_month 对齐）
 *
 * period 字段格式：
 *   - 日：'2026-07-15'
 *   - 月：'2026-07'
 *
 * 计数语义：每次成功调用 used += 1（embed 按 char 数累加）。
 * 配额上限来源于 user 当前生效的多个 plan 的 most-permissive 合并值（取 max）。
 */
return new class extends Migration
{
    public function up()
    {
        Schema::create('usage_counters', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id');
            $table->string('counter_key', 60);
            $table->string('period', 10);
            $table->unsignedBigInteger('used')->default(0);
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->unique(['user_id', 'counter_key', 'period'], 'uc_unique');
            $table->index(['counter_key', 'period']); // 后台跑批/统计
        });
    }

    public function down()
    {
        Schema::dropIfExists('usage_counters');
    }
};
