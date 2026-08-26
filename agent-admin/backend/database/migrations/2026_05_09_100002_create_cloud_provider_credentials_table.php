<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 凭证池表：让一个 provider 下挂多把 API Key，按权重轮询调度。
 *
 * 设计要点：
 *   - 与 cloud_providers.api_key 字段并存。GatewayRouter 的取 key 逻辑：
 *       1. 先看本表 status='active' 的行，按 weight 轮询；
 *       2. 池子为空时回落使用 cloud_providers.api_key（保证老 provider 零行为变化）。
 *   - 失败累计：每次调用失败 fail_count++；达 config('gateway.credential_fail_invalid_threshold')
 *     时 status 自动置 invalid（不删除，可手动 reactivate 重置 fail_count）。
 *   - 软删除：避免历史 UsageRecord 关联到已删凭证时空指针；同时保留审计痕迹。
 *
 * 字段：
 *   - name          人类可读标签（"主号"、"备用 1"、"团队成员 A 报销"）
 *   - api_key       凭证本体（与 cloud_providers.api_key 同为 text，便于未来加密存储）
 *   - weight        权重（默认 1）。轮询用 weight + last_used_at 决定下一把
 *   - status        active / exhausted (额度耗尽) / invalid (累计失败到阈值) / disabled (人工停用)
 *   - fail_count    连续失败次数；调用成功时归零
 *   - last_used_at / last_failed_at / last_error  最近一次使用与失败的元信息
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cloud_provider_credentials', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('provider_id');
            $table->string('name', 100)->default('');
            $table->text('api_key');
            $table->unsignedSmallInteger('weight')->default(1);
            $table->string('status', 16)->default('active');
            $table->unsignedInteger('fail_count')->default(0);
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('last_failed_at')->nullable();
            $table->string('last_error', 500)->default('');
            $table->string('remark', 500)->default('');
            $table->timestamps();
            $table->softDeletes();

            $table->index(['provider_id', 'status'], 'idx_credentials_provider_status');
            $table->index('last_used_at', 'idx_credentials_last_used_at');

            $table->foreign('provider_id')
                ->references('id')->on('cloud_providers')
                ->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cloud_provider_credentials');
    }
};
