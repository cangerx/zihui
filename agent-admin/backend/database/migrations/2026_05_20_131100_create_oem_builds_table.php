<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('oem_builds')) {
            return;
        }

        Schema::create('oem_builds', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->unsignedBigInteger('oem_project_id');
            $table->string('project_key', 64);
            $table->string('build_id', 36)->unique();
            $table->enum('platform', ['win', 'mac']);
            $table->string('app_name', 50);
            $table->string('app_version', 40);
            $table->string('icon_url', 500)->nullable();
            $table->string('app_id', 160);
            $table->string('update_path', 255);
            $table->enum('status', [
                'queued', 'building', 'success',
                'downloading', 'delivered', 'failed', 'cancelled', 'expired', 'purged'
            ])->default('queued');
            $table->string('agent_build_url', 500)->nullable();
            $table->string('filename', 200)->nullable();
            $table->bigInteger('artifact_size')->unsigned()->nullable();
            $table->bigInteger('downloaded_bytes')->unsigned()->nullable();
            $table->char('sha256', 64)->nullable();
            $table->string('stored_path', 500)->nullable();
            $table->json('supplementary_files')->nullable();
            $table->string('error_message', 500)->nullable();
            $table->unsignedBigInteger('requested_by_user_id')->nullable();
            $table->dateTime('queued_at')->nullable();
            $table->dateTime('started_at')->nullable();
            $table->dateTime('finished_at')->nullable();
            $table->dateTime('downloaded_at')->nullable();
            $table->dateTime('delivered_at')->nullable();
            $table->dateTime('created_at');
            $table->dateTime('updated_at');

            $table->index(['oem_project_id', 'status'], 'idx_oem_builds_project_status');
            $table->index(['project_key', 'platform'], 'idx_oem_builds_key_platform');
            $table->index('status', 'idx_oem_builds_status');
            $table->index('created_at', 'idx_oem_builds_created');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('oem_builds');
    }
};
