<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('oem_projects')) {
            return;
        }

        Schema::create('oem_projects', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->string('project_key', 64)->unique()->comment('不可变项目key，用于更新目录隔离');
            $table->string('name', 100)->comment('后台项目名称');
            $table->string('app_name', 50)->comment('桌面端显示名');
            $table->string('icon_url', 500)->nullable()->comment('默认图标URL');
            $table->string('app_id', 160)->unique()->comment('不可变Electron appId');
            $table->string('update_path', 255)->unique()->comment('不可变更新路径，例 /updates/oem/acme/');
            $table->string('current_version', 40)->nullable()->comment('项目当前版本号');
            $table->enum('status', ['active', 'disabled', 'archived'])->default('active');
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->dateTime('last_build_at')->nullable();
            $table->dateTime('deleted_at')->nullable();
            $table->dateTime('created_at');
            $table->dateTime('updated_at');

            $table->index('status', 'idx_oem_projects_status');
            $table->index('created_at', 'idx_oem_projects_created');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('oem_projects');
    }
};
