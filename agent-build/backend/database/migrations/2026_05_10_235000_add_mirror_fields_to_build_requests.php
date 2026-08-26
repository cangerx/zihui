<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 0.5.0：家庭电脑中转方案 - 给 build_requests 加 mirror 链路字段。
 *
 * 取代原 COS 直传方案：
 *  - 旧链路：GHA → COS bucket → agent-admin 直拉 COS（跨境带宽抖动严重，1MB
 *    测速从 5.79s 抖到 19.32s，主件 200MB+ 直接超时）
 *  - 新链路：GHA → GitHub Release（同基础设施，0 跨境）→ 家庭电脑 mirror worker
 *    用梯子拉 + 内网 SFTP 推到本地服务器 → agent-admin 拉国内 mirror URL
 *  - 全链路无跨境瓶颈
 *
 * mirror_status 状态机：
 *   NULL          → 老 build（COS 链路或更早），新 build callback 后必非空
 *   pending       → callback 收到 GHA 上传到 Release 完成；待家庭电脑领取
 *   mirroring     → 家庭电脑已领取，正在 download → SFTP push 中
 *   mirrored      → SFTP push 完成 + ack；mirror_url_primary 可用，agent-admin
 *                   可拉
 *   failed        → 家庭电脑重试 N 次后放弃；status 同步 failed
 *   purging       → status=delivered 后家庭电脑领走（可清列表）
 *   purged        → SFTP rm 完成（最终态）
 *
 * release_tag / release_assets：GHA workflow callback 时填，家庭电脑按 release_tag
 * 拉 release，按 release_assets 解析 asset_id 列表批量下载。
 *
 * 不修改 cos_object_prefix 字段（已发布 0.4.0 引入）：
 *   - 废弃但保留，新 build 不写值
 *   - 历史 cos build 数据仍可查（只读）
 *
 * 索引 idx_mirror_status：家庭电脑每 30s poll
 *   `WHERE mirror_status IN ('pending', 'purging')`，避免全表扫。
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('build_requests', function (Blueprint $table) {
            $table->enum('mirror_status', ['pending', 'mirroring', 'mirrored', 'failed', 'purging', 'purged'])
                ->nullable()
                ->after('cos_object_prefix')
                ->comment('家庭电脑中转链路状态；NULL=老 build (COS/旧)；新 build callback 后必非空');

            $table->string('mirror_url_primary', 500)
                ->nullable()
                ->after('mirror_status')
                ->comment('主件公网 URL，例 https://your-cdn-domain.example.com/build-mirror/{id}/setup.exe');

            $table->json('mirror_supplementary')
                ->nullable()
                ->after('mirror_url_primary')
                ->comment('副件 mirror URLs JSON: [{filename,url,role,size,sha256}]');

            $table->dateTime('mirror_assigned_at')
                ->nullable()
                ->after('mirror_supplementary')
                ->comment('家庭电脑领取时刻（防多 worker 重复领；过 N 分钟可重领）');

            $table->dateTime('mirror_acked_at')
                ->nullable()
                ->after('mirror_assigned_at')
                ->comment('家庭电脑 ack 时刻（mirror_status=mirrored 即设）');

            $table->string('release_tag', 100)
                ->nullable()
                ->after('mirror_acked_at')
                ->comment('GitHub Release tag，例 build-{build_id}');

            $table->json('release_assets')
                ->nullable()
                ->after('release_tag')
                ->comment('Release assets JSON: [{filename,asset_id,asset_url,size,sha256,role}]');

            $table->index('mirror_status', 'idx_mirror_status');
        });
    }

    public function down(): void
    {
        Schema::table('build_requests', function (Blueprint $table) {
            $table->dropIndex('idx_mirror_status');
            $table->dropColumn([
                'mirror_status',
                'mirror_url_primary',
                'mirror_supplementary',
                'mirror_assigned_at',
                'mirror_acked_at',
                'release_tag',
                'release_assets',
            ]);
        });
    }
};
