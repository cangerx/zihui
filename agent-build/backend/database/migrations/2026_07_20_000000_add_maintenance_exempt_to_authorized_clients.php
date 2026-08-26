<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 维护期打包豁免：给 authorized_clients 加「维护期可打包」字段。
 *
 * - maintenance_exempt = true 的云控端，即使平台「云打包维护」全局开关已开启，
 *   也照常允许提交打包（BuildRequestController::request / authCheck 据此放行），
 *   用于指定客户端在维护期做生产测试 / 灰度验证。
 * - 由 build 后台管理员在客户端列表逐个 / 批量任命，被任命方无需确认。
 * - 默认 false，保持向后兼容（不影响既有「维护期全员暂停」行为）。
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('authorized_clients', 'maintenance_exempt')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->boolean('maintenance_exempt')
                    ->default(false)
                    ->after('is_hub_reviewer')
                    ->comment('维护期是否仍可打包（指定客户端生产测试用）');
                $table->index('maintenance_exempt', 'idx_maintenance_exempt');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('authorized_clients', 'maintenance_exempt')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->dropIndex('idx_maintenance_exempt');
                $table->dropColumn('maintenance_exempt');
            });
        }
    }
};
