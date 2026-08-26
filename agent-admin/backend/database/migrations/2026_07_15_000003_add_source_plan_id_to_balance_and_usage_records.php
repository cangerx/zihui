<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 给流水/用量记录补 source_plan_id/request_id 追溯字段。
 *
 * - balance_logs.source_plan_id：表示这笔扣费来自哪个 user_plan quota；NULL 表示 wallet 或旧数据
 * - usage_records.source_plan_id：与业务调用记录关联，便于 UI 按套餐归类
 * - balance_logs.request_id：把一笔余额变动与 usage_records / task request_id 关联
 */
return new class extends Migration
{
    public function up()
    {
        Schema::table('balance_logs', function (Blueprint $table) {
            if (!Schema::hasColumn('balance_logs', 'source_plan_id')) {
                $table->unsignedBigInteger('source_plan_id')->nullable()->after('operator_id');
                $table->index('source_plan_id', 'balance_logs_source_plan_id_index');
            }
            if (!Schema::hasColumn('balance_logs', 'request_id')) {
                $table->string('request_id', 100)->default('')->after('source_plan_id');
                $table->index('request_id', 'balance_logs_request_id_index');
            }
        });

        Schema::table('usage_records', function (Blueprint $table) {
            if (!Schema::hasColumn('usage_records', 'source_plan_id')) {
                $table->unsignedBigInteger('source_plan_id')->nullable()->after('balance_type');
                $table->index('source_plan_id', 'usage_records_source_plan_id_index');
            }
        });
    }

    public function down()
    {
        Schema::table('usage_records', function (Blueprint $table) {
            if (Schema::hasColumn('usage_records', 'source_plan_id')) {
                $table->dropIndex('usage_records_source_plan_id_index');
                $table->dropColumn('source_plan_id');
            }
        });

        Schema::table('balance_logs', function (Blueprint $table) {
            if (Schema::hasColumn('balance_logs', 'request_id')) {
                $table->dropIndex('balance_logs_request_id_index');
                $table->dropColumn('request_id');
            }
            if (Schema::hasColumn('balance_logs', 'source_plan_id')) {
                $table->dropIndex('balance_logs_source_plan_id_index');
                $table->dropColumn('source_plan_id');
            }
        });
    }
};
