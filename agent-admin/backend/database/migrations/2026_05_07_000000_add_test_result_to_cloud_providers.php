<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 给 cloud_providers 增加最近一次测试结果的快照字段。
 *
 * 用途：服务商列表「上次体检」列直接读取，不必每次现测。
 *   - last_test_at      最后一次测试时间
 *   - last_test_status  ok / warning / error
 *   - last_test_kind    basic（GET /models）/ deep（POST /chat/completions）
 *   - last_test_message 人话提示，前端 hover tooltip 展示
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cloud_providers', function (Blueprint $table) {
            $table->timestamp('last_test_at')->nullable()->after('remark');
            $table->string('last_test_status', 16)->nullable()->after('last_test_at');
            $table->string('last_test_kind', 16)->nullable()->after('last_test_status');
            $table->string('last_test_message', 500)->nullable()->after('last_test_kind');
        });
    }

    public function down(): void
    {
        Schema::table('cloud_providers', function (Blueprint $table) {
            $table->dropColumn(['last_test_at', 'last_test_status', 'last_test_kind', 'last_test_message']);
        });
    }
};
