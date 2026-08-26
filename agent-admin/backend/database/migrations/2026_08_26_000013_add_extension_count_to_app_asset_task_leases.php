<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('app_asset_task_leases') && !Schema::hasColumn('app_asset_task_leases', 'extension_count')) {
            Schema::table('app_asset_task_leases', function (Blueprint $table) {
                $table->unsignedTinyInteger('extension_count')->default(0)->after('lease_until');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('app_asset_task_leases') && Schema::hasColumn('app_asset_task_leases', 'extension_count')) {
            Schema::table('app_asset_task_leases', function (Blueprint $table) {
                $table->dropColumn('extension_count');
            });
        }
    }
};
