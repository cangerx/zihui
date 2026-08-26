<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('temporary_reference_assets')) {
            return;
        }
        if (!Schema::hasColumn('temporary_reference_assets', 'storage_driver')) {
            Schema::table('temporary_reference_assets', function (Blueprint $table) {
                // 该素材文件实际落在哪个存储后端：local / cos（腾讯云）/ oss（阿里云）/ external（外链，source=url）。
                // 上传时按 StorageService 当前 storage_type 写入；为空表示历史数据，序列化时由 storage_url 反推兜底。
                $table->string('storage_driver', 20)->nullable()->after('storage_url')->index();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('temporary_reference_assets', 'storage_driver')) {
            Schema::table('temporary_reference_assets', function (Blueprint $table) {
                $table->dropIndex(['storage_driver']);
                $table->dropColumn('storage_driver');
            });
        }
    }
};
