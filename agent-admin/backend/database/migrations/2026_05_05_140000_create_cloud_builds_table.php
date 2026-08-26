<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('cloud_builds', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->string('build_id', 36)->unique()->comment('agent-build 侧生成的 build UUID');
            $table->enum('platform', ['win', 'mac']);
            $table->string('app_name', 50);
            $table->string('app_version', 20);
            $table->string('icon_path', 500)->nullable()->comment('上传到 agent-admin 的 icon 相对路径');
            $table->enum('status', [
                'queued', 'building', 'success',
                'downloading', 'delivered', 'failed', 'cancelled', 'expired',
            ])->default('queued');
            $table->string('agent_build_url', 500)->nullable()->comment('agent-build 给的签名下载 URL');
            $table->string('filename', 200)->nullable();
            $table->bigInteger('artifact_size')->unsigned()->nullable();
            $table->char('sha256', 64)->nullable();
            $table->string('stored_path', 500)->nullable()->comment('agent-admin 本地 public/ 相对路径');
            $table->string('error_message', 500)->nullable();
            $table->bigInteger('requested_by_user_id')->unsigned()->nullable();
            $table->dateTime('queued_at')->nullable();
            $table->dateTime('started_at')->nullable();
            $table->dateTime('finished_at')->nullable();
            $table->dateTime('downloaded_at')->nullable();
            $table->dateTime('delivered_at')->nullable();
            $table->dateTime('created_at');
            $table->dateTime('updated_at');

            $table->index('status', 'idx_status');
            $table->index('created_at', 'idx_created');
            $table->index(['platform', 'status'], 'idx_platform_status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cloud_builds');
    }
};
