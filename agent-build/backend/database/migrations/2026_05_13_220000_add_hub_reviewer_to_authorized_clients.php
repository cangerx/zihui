<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 共享灵感库 v1：给 authorized_clients 加「共享库审核员」字段。
 *
 * - is_hub_reviewer = true 的云控端在调 /api/inspiration-hub/pending-list、
 *   /api/inspiration-hub/{id}/review 时由 HubReviewerOnly 中间件放行
 * - 由 build 后台管理员在客户端列表逐个/批量任命，被任命方无需确认
 * - 默认 false，保持向后兼容
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('authorized_clients', 'is_hub_reviewer')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->boolean('is_hub_reviewer')
                    ->default(false)
                    ->after('status')
                    ->comment('是否为共享灵感库审核员');
                $table->index('is_hub_reviewer', 'idx_hub_reviewer');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('authorized_clients', 'is_hub_reviewer')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->dropIndex('idx_hub_reviewer');
                $table->dropColumn('is_hub_reviewer');
            });
        }
    }
};
