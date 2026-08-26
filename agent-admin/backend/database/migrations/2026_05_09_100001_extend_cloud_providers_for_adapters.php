<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 给 cloud_providers 增加多协议适配器架构所需的扩展字段。
 *
 * 字段语义：
 *   - config         JSON：适配器特有配置（auth_style / extra_headers / extra_query
 *                          / verify_ssl / proxy / api_version 等）。老 provider 默认 NULL，
 *                          运行时按"全部缺省 = 当前行为"处理，确保零行为变化。
 *   - capabilities   JSON：能力清单（stream / usage_in_stream / tools / vision /
 *                          json_mode / reasoning_params 等）。NULL 视为"全部支持"，
 *                          等价当前 GatewayController 的硬编码行为。
 *   - suspended_at   timestamp：自动熔断时间。健康探测连续失败 N 次时由
 *                               ProbeProviders Command 写入；不删除 provider，可由管理员
 *                               一键 recover。
 *   - suspended_reason 熔断原因摘要，列表 hover 展示。
 *
 * 兼容性：全部 nullable + 不带默认值，老数据零行为影响；保留 api_key / type / status
 * / last_test_* 等所有原字段不动。
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cloud_providers', function (Blueprint $table) {
            $table->json('config')->nullable()->after('api_key');
            $table->json('capabilities')->nullable()->after('config');
            $table->timestamp('suspended_at')->nullable()->after('status');
            $table->string('suspended_reason', 500)->nullable()->after('suspended_at');
        });
    }

    public function down(): void
    {
        Schema::table('cloud_providers', function (Blueprint $table) {
            $table->dropColumn(['config', 'capabilities', 'suspended_at', 'suspended_reason']);
        });
    }
};
