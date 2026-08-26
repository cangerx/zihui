<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 0.3.0：废弃 notify_url 字段。
 *
 * 0.3.0 起 BuildWorker 不再主动 POST notify 给云控端，云控端改为主动轮询
 * GET /api/build/download/{buildId}。该字段在数据库里留着也无意义且让运维误解，
 * 故 dropColumn。
 *
 * 不影响：
 *   - build_requests / build_quotas 等表的 client_id 外键
 *   - 其它字段（domain / owner_name / owner_phone / 配额 / status 等）
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasColumn('authorized_clients', 'notify_url')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->dropColumn('notify_url');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasColumn('authorized_clients', 'notify_url')) {
            Schema::table('authorized_clients', function (Blueprint $table) {
                $table->string('notify_url', 500)->default('')->after('domain');
            });
        }
    }
};
