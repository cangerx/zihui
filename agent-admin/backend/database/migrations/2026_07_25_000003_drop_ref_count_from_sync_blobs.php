<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 移除 sync_blobs.ref_count：该字段从未被任何代码维护（恒为 0），
 * blob 回收（sync:gc-blobs）实际通过扫描 sync_records.payload 计算引用集合。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('sync_blobs', 'ref_count')) {
            Schema::table('sync_blobs', function (Blueprint $table) {
                $table->dropColumn('ref_count');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasColumn('sync_blobs', 'ref_count')) {
            Schema::table('sync_blobs', function (Blueprint $table) {
                $table->unsignedInteger('ref_count')->default(0);
            });
        }
    }
};
