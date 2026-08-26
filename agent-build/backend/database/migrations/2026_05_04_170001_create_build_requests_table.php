<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('build_requests', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->string('build_id', 36)->unique()->comment('UUID，对外暴露');
            $table->string('client_id', 32);
            $table->string('app_name', 100);
            $table->string('icon_path', 500)->comment('图标在 agent-build 的存储路径');
            $table->enum('platform', ['win', 'mac'])->comment('一次申请仅一个平台');
            $table->string('app_version', 20)->comment('触发时模板仓库的版本号');
            $table->enum('status', [
                'pending', 'queued', 'building', 'success',
                'delivered', 'purged', 'failed', 'cancelled', 'expired'
            ])->default('pending');
            $table->string('executor_id', 50)->default('github-default');
            $table->bigInteger('executor_run_id')->nullable();
            $table->string('artifact_path', 500)->nullable()->comment('本地缓冲区路径');
            $table->bigInteger('artifact_size')->nullable();
            $table->string('artifact_sha256', 64)->nullable();
            $table->text('error_message')->nullable();
            $table->string('callback_token', 64)->nullable()->comment('一次性回调 token');
            $table->dateTime('queued_at')->nullable();
            $table->dateTime('started_at')->nullable();
            $table->dateTime('finished_at')->nullable()->comment('callback 到达时间');
            $table->dateTime('delivered_at')->nullable()->comment('云控端 ACK 时间');
            $table->dateTime('purged_at')->nullable()->comment('双删完成时间');
            $table->dateTime('created_at');
            $table->dateTime('updated_at');

            $table->index(['client_id', 'status'], 'idx_client_status');
            $table->index(['status', 'finished_at'], 'idx_status_finished');
            $table->index(['executor_id', 'executor_run_id'], 'idx_executor_run');
            $table->index('created_at', 'idx_created');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('build_requests');
    }
};
