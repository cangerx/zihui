<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 「店铺商品图」功能授权 v1：给 authorized_clients 加「是否开放店铺商品图功能」字段。
 *
 * - can_use_ewei_shop = true 的云控端，其 auth-check 返回 can_use_ewei_shop=true，
 *   云控端据此对旗下用户开放「店铺商品图」（再叠加云控端 per-user 权限二级门控）
 * - 由 build 后台管理员在客户端列表逐个/批量授权，默认 false（向后兼容，未授权不可用）
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('authorized_clients', 'can_use_ewei_shop')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->boolean('can_use_ewei_shop')
                    ->default(false)
                    ->after('is_hub_reviewer')
                    ->comment('是否开放「店铺商品图」功能');
                $table->index('can_use_ewei_shop', 'idx_can_use_ewei_shop');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('authorized_clients', 'can_use_ewei_shop')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->dropIndex('idx_can_use_ewei_shop');
                $table->dropColumn('can_use_ewei_shop');
            });
        }
    }
};
