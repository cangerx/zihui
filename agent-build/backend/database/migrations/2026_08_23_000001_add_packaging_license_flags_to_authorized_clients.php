<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 云控打包授权两档：Windows/GitHub 与 Mac。默认关（fail-closed）。
 * 不改已发布 migration。
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('authorized_clients', 'can_use_github_packaging')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->boolean('can_use_github_packaging')
                    ->default(false)
                    ->after('can_use_ewei_shop')
                    ->comment('云控端打包授权：GitHub 配置 + Windows');
            });
        }
        if (!Schema::hasColumn('authorized_clients', 'can_use_mac_packaging')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->boolean('can_use_mac_packaging')
                    ->default(false)
                    ->after('can_use_github_packaging')
                    ->comment('Mac 打包授权；打 Mac 须两档都开');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('authorized_clients', 'can_use_mac_packaging')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->dropColumn('can_use_mac_packaging');
            });
        }
        if (Schema::hasColumn('authorized_clients', 'can_use_github_packaging')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->dropColumn('can_use_github_packaging');
            });
        }
    }
};
