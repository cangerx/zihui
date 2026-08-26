<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * inspirations 表加共享灵感库（agent-build 共享 hub）相关字段。
 *
 * 业务场景：本云控端的灵感可以分享到统一的共享灵感库（agent-build），
 *  - hub_shared_id          : 分享后由 hub 返回，本地存下来用于状态轮询和撤回
 *  - hub_status             : 在 hub 的审核状态（pending/approved/rejected），
 *    本地灵感库会展示一个小角标告诉用户「这条灵感在共享库的状态」
 *  - hub_status_synced_at   : 上次和 hub 对账的时间，artisan 计划任务每 5 分钟同步
 *  - from_hub_inspiration_id: 从共享库拉来的灵感 → 该灵感在 hub 的 ID（防止同一条 hub 灵感被重复拉入本地）
 *  - from_hub_source_site_name: 从 hub 拉来时附带的「来源云控端」站名快照，用于本地展示
 *
 * 索引：
 *  - UNIQUE(hub_shared_id)  : 一条本地灵感最多分享到 hub 一次
 *  - UNIQUE(from_hub_inspiration_id) : 一条 hub 灵感只允许被本站点拉入一次
 *  - INDEX(hub_status, hub_status_synced_at) : SyncHubStatus 命令按 status 过滤再按同步时间排序
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('inspirations', function (Blueprint $table) {
            if (!Schema::hasColumn('inspirations', 'hub_shared_id')) {
                $table->unsignedBigInteger('hub_shared_id')
                    ->nullable()
                    ->after('is_visible')
                    ->comment('已分享到共享灵感库的 hub 端 ID');
            }
            if (!Schema::hasColumn('inspirations', 'hub_status')) {
                $table->enum('hub_status', ['pending', 'approved', 'rejected'])
                    ->nullable()
                    ->after('hub_shared_id')
                    ->comment('在共享库的审核状态');
            }
            if (!Schema::hasColumn('inspirations', 'hub_status_synced_at')) {
                $table->dateTime('hub_status_synced_at')
                    ->nullable()
                    ->after('hub_status')
                    ->comment('上次同步 hub 状态的时间');
            }
            if (!Schema::hasColumn('inspirations', 'from_hub_inspiration_id')) {
                $table->unsignedBigInteger('from_hub_inspiration_id')
                    ->nullable()
                    ->after('hub_status_synced_at')
                    ->comment('从共享库拉来的源 hub 灵感 ID');
            }
            if (!Schema::hasColumn('inspirations', 'from_hub_source_site_name')) {
                $table->string('from_hub_source_site_name', 100)
                    ->nullable()
                    ->after('from_hub_inspiration_id')
                    ->comment('从共享库拉来时的来源云控端站名快照');
            }
        });

        // 加索引（独立 try 块：旧表升级时索引可能已存在，避免重复加报错）
        Schema::table('inspirations', function (Blueprint $table) {
            $table->unique('hub_shared_id', 'inspirations_hub_shared_id_unique');
            $table->unique('from_hub_inspiration_id', 'inspirations_from_hub_id_unique');
            $table->index(['hub_status', 'hub_status_synced_at'], 'inspirations_hub_status_idx');
        });
    }

    public function down(): void
    {
        Schema::table('inspirations', function (Blueprint $table) {
            $table->dropIndex('inspirations_hub_status_idx');
            $table->dropUnique('inspirations_from_hub_id_unique');
            $table->dropUnique('inspirations_hub_shared_id_unique');
            $table->dropColumn([
                'from_hub_source_site_name',
                'from_hub_inspiration_id',
                'hub_status_synced_at',
                'hub_status',
                'hub_shared_id',
            ]);
        });
    }
};
