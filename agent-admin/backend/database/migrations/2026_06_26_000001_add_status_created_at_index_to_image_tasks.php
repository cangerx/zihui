<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * image_tasks 表增加复合索引 (status, created_at)。
 *
 * 用途：
 *   - Queue worker 按状态过滤 + 时间排序取任务：
 *     SELECT * FROM image_tasks WHERE status = 'pending' ORDER BY created_at ASC
 *   - 僵尸任务清理：
 *     SELECT id FROM image_tasks WHERE status IN ('pending','processing')
 *       AND created_at < ?
 *   - 用户历史查询：
 *     SELECT * FROM image_tasks WHERE user_id = ? AND status = 'completed'
 *       ORDER BY created_at DESC
 *
 * 已有的单列 status 索引保留，覆盖单条件按状态计数等场景。
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('image_tasks', function (Blueprint $table) {
            $table->index(['status', 'created_at'], 'image_tasks_status_created_at_idx');
        });
    }

    public function down(): void
    {
        Schema::table('image_tasks', function (Blueprint $table) {
            $table->dropIndex('image_tasks_status_created_at_idx');
        });
    }
};
