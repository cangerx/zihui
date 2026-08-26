<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * T4.2 / LAP-037：为执行账本补齐 callback、图标 URL 与 GitHub Release 元数据。
 * 不改 2026_08_22_000010；不触碰 cloud_builds / oem_builds。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('cloud_build_jobs') && !Schema::hasColumn('cloud_build_jobs', 'callback_token')) {
            Schema::table('cloud_build_jobs', function (Blueprint $table) {
                $table->string('callback_token', 64)->nullable();
                $table->string('icon_path', 500)->nullable();
                $table->string('release_tag', 80)->nullable();
                $table->text('release_assets')->nullable();
                $table->index('callback_token', 'idx_cbj_callback_token');
            });
        }

        if (Schema::hasTable('cloud_build_clients') && !Schema::hasColumn('cloud_build_clients', 'domain')) {
            Schema::table('cloud_build_clients', function (Blueprint $table) {
                $table->string('domain', 255)->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('cloud_build_jobs') && Schema::hasColumn('cloud_build_jobs', 'callback_token')) {
            Schema::table('cloud_build_jobs', function (Blueprint $table) {
                $table->dropIndex('idx_cbj_callback_token');
                $table->dropColumn(['callback_token', 'icon_path', 'release_tag', 'release_assets']);
            });
        }

        if (Schema::hasTable('cloud_build_clients') && Schema::hasColumn('cloud_build_clients', 'domain')) {
            Schema::table('cloud_build_clients', function (Blueprint $table) {
                $table->dropColumn('domain');
            });
        }
    }
};
