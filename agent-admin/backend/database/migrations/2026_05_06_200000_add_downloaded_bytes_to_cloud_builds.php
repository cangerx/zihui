<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 1.2.1：cloud_builds 加 downloaded_bytes 字段，用于显示下载进度。
 *
 * ArtifactDownloadService 在下载过程中按时间节流（每 ~1 秒）写一次进度到这里，
 * 前端 detail drawer 根据 (downloaded_bytes / artifact_size * 100) 算百分比展示进度条。
 *
 * 字段类型：BIGINT NULLABLE
 *   - NULL：还没开始下载（任务还在 queued / building / 已完成 delivered 等）
 *   - 0..artifact_size：下载中（status=downloading）
 *   - = artifact_size：下载完成（接下来 atomic place + ack）
 *
 * 不影响其他现有逻辑（仅新增可选字段）。
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('cloud_builds', 'downloaded_bytes')) {
            Schema::table('cloud_builds', function (Blueprint $table) {
                $table->bigInteger('downloaded_bytes')->nullable()->after('artifact_size');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('cloud_builds', 'downloaded_bytes')) {
            Schema::table('cloud_builds', function (Blueprint $table) {
                $table->dropColumn('downloaded_bytes');
            });
        }
    }
};
