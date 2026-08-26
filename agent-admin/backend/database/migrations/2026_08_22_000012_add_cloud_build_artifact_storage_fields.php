<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * T4.3 / LAP-038：产物本地路径、mirror URL 与 worker 领取时间。
 * 不改 000010 / 000011；不触碰 cloud_builds / oem_builds。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('cloud_build_jobs') && !Schema::hasColumn('cloud_build_jobs', 'mirror_assigned_at')) {
            Schema::table('cloud_build_jobs', function (Blueprint $table) {
                $table->dateTime('mirror_assigned_at')->nullable();
                $table->string('mirror_url_primary', 500)->nullable();
            });
        }

        if (Schema::hasTable('cloud_build_artifacts') && !Schema::hasColumn('cloud_build_artifacts', 'storage_path')) {
            Schema::table('cloud_build_artifacts', function (Blueprint $table) {
                $table->string('storage_path', 500)->nullable();
                $table->string('mirror_url', 500)->nullable();
                $table->unsignedTinyInteger('fetch_attempts')->default(0);
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('cloud_build_jobs') && Schema::hasColumn('cloud_build_jobs', 'mirror_assigned_at')) {
            Schema::table('cloud_build_jobs', function (Blueprint $table) {
                $table->dropColumn(['mirror_assigned_at', 'mirror_url_primary']);
            });
        }

        if (Schema::hasTable('cloud_build_artifacts') && Schema::hasColumn('cloud_build_artifacts', 'storage_path')) {
            Schema::table('cloud_build_artifacts', function (Blueprint $table) {
                $table->dropColumn(['storage_path', 'mirror_url', 'fetch_attempts']);
            });
        }
    }
};
