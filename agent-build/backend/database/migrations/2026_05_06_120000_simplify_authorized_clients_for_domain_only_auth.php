<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * agent-build 0.2.0 - Domain-only auth 改造
 *
 * 授权模型从「client_id + client_secret + HMAC + 域名绑定」简化为「仅域名校验」。
 * 此 migration 只动表结构，业务码切换在同版本一起发布。
 *
 * 变更：
 *   - drop client_secret  : 不再用 HMAC 签名验证，secret 失去意义
 *   - drop api_domain     : 业务上没有再用，统一以 domain 为唯一校验依据
 *   - drop contact        : 改用更聚焦的 owner_phone
 *   - add  owner_phone    : 仅作管理后台显示用，nullable
 *
 * 保留：
 *   - client_id           : 作为内部稳定主键（仍由后端自动生成，不再对外暴露）
 *   - domain (unique)     : 新授权机制的唯一校验依据
 *   - notify_url          : 打包完成主动通知用，仍必须
 *   - owner_name / status / expires_at / daily_limit / monthly_limit
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasColumn('authorized_clients', 'client_secret')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->dropColumn('client_secret');
            });
        }

        if (Schema::hasColumn('authorized_clients', 'api_domain')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->dropColumn('api_domain');
            });
        }

        if (Schema::hasColumn('authorized_clients', 'contact')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->dropColumn('contact');
            });
        }

        if (!Schema::hasColumn('authorized_clients', 'owner_phone')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->string('owner_phone', 30)->nullable()->after('owner_name');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('authorized_clients', 'owner_phone')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->dropColumn('owner_phone');
            });
        }

        if (!Schema::hasColumn('authorized_clients', 'contact')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->string('contact', 255)->nullable()->after('owner_name');
            });
        }

        if (!Schema::hasColumn('authorized_clients', 'api_domain')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->string('api_domain', 255)->nullable()->after('domain');
            });
        }

        if (!Schema::hasColumn('authorized_clients', 'client_secret')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->string('client_secret', 255)->after('client_id');
            });
        }
    }
};
