<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('build_requests', function (Blueprint $table) {
            if (!Schema::hasColumn('build_requests', 'build_mode')) {
                $table->enum('build_mode', ['normal', 'oem'])
                    ->default('normal')
                    ->after('platform')
                    ->comment('打包模式：normal=现有云打包，oem=OEM项目打包');
            }
            if (!Schema::hasColumn('build_requests', 'oem_project_key')) {
                $table->string('oem_project_key', 64)
                    ->nullable()
                    ->after('build_mode')
                    ->comment('OEM项目不可变key，normal为空');
            }
            if (!Schema::hasColumn('build_requests', 'app_id')) {
                $table->string('app_id', 160)
                    ->nullable()
                    ->after('app_version')
                    ->comment('显式Electron appId；OEM必填，normal为空走旧逻辑');
            }
            if (!Schema::hasColumn('build_requests', 'update_path')) {
                $table->string('update_path', 255)
                    ->nullable()
                    ->after('app_id')
                    ->comment('相对更新目录，例 /updates/oem/acme/；normal为空走 /updates/');
            }
            if (!Schema::hasColumn('build_requests', 'build_options')) {
                $table->json('build_options')
                    ->nullable()
                    ->after('update_path')
                    ->comment('扩展打包参数JSON，供workflow注入脚本兼容读取');
            }
        });

        Schema::table('build_requests', function (Blueprint $table) {
            $table->index(['build_mode', 'oem_project_key'], 'idx_build_mode_oem_project');
        });
    }

    public function down(): void
    {
        Schema::table('build_requests', function (Blueprint $table) {
            try {
                $table->dropIndex('idx_build_mode_oem_project');
            } catch (\Throwable $e) {
            }
            foreach (['build_options', 'update_path', 'app_id', 'oem_project_key', 'build_mode'] as $column) {
                if (Schema::hasColumn('build_requests', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
