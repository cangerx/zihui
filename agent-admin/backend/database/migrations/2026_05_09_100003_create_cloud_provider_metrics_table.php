<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 服务商健康度时间序列表：按小时聚合每家 provider 的成功率与延迟分布。
 *
 * 设计要点：
 *   - 写入方：ProbeProviders Command（每 5 分钟）+ GatewayRouter 实时调用结果。
 *     探测和真实流量统一打点，看板更真实。
 *   - 按小时桶聚合：bucket_hour = 当前小时整点（如 2026-05-09 23:00:00）。
 *     一个 provider 在一个小时内只产生一行，反复 UPSERT 累加 ok_count/fail_count
 *     与刷新延迟分位数。避免行数爆炸。
 *   - latency 分位数采用近似算法（写入时按窗口估算），不需要保留全部样本。
 *   - 主键 (provider_id, bucket_hour) 天然防重；bucket_hour 单独索引便于
 *     按时间清理（保留 30 天，老行由调度任务批量删除）。
 *   - 前端"健康看板"直接 SELECT WHERE bucket_hour > now()-24h ORDER BY bucket_hour，
 *     按小时绘曲线。
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cloud_provider_metrics', function (Blueprint $table) {
            $table->unsignedBigInteger('provider_id');
            // 不能用 timestamp() —— MySQL 5.7 默认 explicit_defaults_for_timestamp=OFF 时
            // 会给第一个 NOT NULL TIMESTAMP 列自动加 DEFAULT CURRENT_TIMESTAMP ON UPDATE
            // CURRENT_TIMESTAMP，这会导致 ON DUPLICATE KEY UPDATE 时主键 bucket_hour
            // 被改写成 NOW()，整个时间序列时间桶发生漂移、UPSERT 退化成新行。
            // dateTime 不会触发该隐式行为，是更稳的选择。
            $table->dateTime('bucket_hour');
            $table->unsignedInteger('ok_count')->default(0);
            $table->unsignedInteger('fail_count')->default(0);
            $table->unsignedInteger('latency_ms_p50')->default(0);
            $table->unsignedInteger('latency_ms_p99')->default(0);
            $table->string('last_error_message', 500)->default('');
            $table->timestamps();

            $table->primary(['provider_id', 'bucket_hour']);
            $table->index('bucket_hour', 'idx_metrics_bucket_hour');

            $table->foreign('provider_id')
                ->references('id')->on('cloud_providers')
                ->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cloud_provider_metrics');
    }
};
