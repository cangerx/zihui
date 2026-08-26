<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 0.3.3：异步 dispatch 支持。
 *
 * 旧实现：BuildRequestController::request 同步调 GitHub workflow_dispatch
 * （含 15s timeout），跨区慢网下整端点常耗时 5-15+s，agent-admin 默认 15s
 * timeout 容易超时 → 客户云控端任务「消失」。
 *
 * 新实现：request 端点仅 INSERT build_requests + status='pending'，立即返回 build_id；
 * BuildDispatchPending cron 每分钟扫 status='pending' AND dispatch_attempts < 3
 * 的行，调 GitHub Actions API。成功 → status='queued'。失败 → 累加 attempts，
 * 满 3 次仍失败 → status='failed' + 退当日配额。
 *
 * 新增字段：
 *   - dispatch_attempts：本行已尝试 dispatch 的次数（0..3），上限 3 次
 *   - dispatched_at：成功调用 GitHub workflow_dispatch 的时刻（status: pending → queued）
 *
 * 索引 idx_status_dispatch_attempts：BuildDispatchPending 扫描 pending 行用，
 * 避免全表扫（高并发时 build_requests 行数会持续增长）。
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('build_requests', function (Blueprint $table) {
            $table->unsignedTinyInteger('dispatch_attempts')->default(0)->after('callback_token')->comment('0.3.3 异步 dispatch 重试计数（上限 3）');
            $table->dateTime('dispatched_at')->nullable()->after('queued_at')->comment('0.3.3 GitHub workflow_dispatch 成功的时刻');
            $table->index(['status', 'dispatch_attempts'], 'idx_status_dispatch_attempts');
        });
    }

    public function down(): void
    {
        Schema::table('build_requests', function (Blueprint $table) {
            $table->dropIndex('idx_status_dispatch_attempts');
            $table->dropColumn(['dispatch_attempts', 'dispatched_at']);
        });
    }
};
