<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * T4.1 / LAP-036：云控端打包执行账本（客户、模板、配额、任务、尝试、产物）。
 *
 * 不改已发布的 cloud_builds / oem_builds；那两张表仍是前端投影。
 * 本表的 phase 使用规范阶段（LAP-035），不是授权端 pending/success+mirror 字符串。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('cloud_build_clients')) {
            Schema::create('cloud_build_clients', function (Blueprint $table) {
                $table->engine = 'InnoDB';
                $table->charset = 'utf8mb4';
                $table->collation = 'utf8mb4_unicode_ci';

                $table->bigIncrements('id');
                $table->string('client_ref', 64)->unique()->comment('打包站点身份，对应授权端 client_id');
                $table->unsignedInteger('daily_limit')->default(0);
                $table->unsignedInteger('monthly_limit')->default(0);
                $table->string('status', 20)->default('active')->comment('active/suspended/expired');
                $table->dateTime('expires_at')->nullable();
                $table->unsignedTinyInteger('maintenance_exempt')->default(0);
                $table->dateTime('created_at');
                $table->dateTime('updated_at');

                $table->index('status', 'idx_cbc_status');
            });
        }

        if (!Schema::hasTable('cloud_build_templates')) {
            Schema::create('cloud_build_templates', function (Blueprint $table) {
                $table->engine = 'InnoDB';
                $table->charset = 'utf8mb4';
                $table->collation = 'utf8mb4_unicode_ci';

                $table->bigIncrements('id');
                $table->string('version', 20)->unique();
                $table->dateTime('released_at');
                $table->text('changelog')->nullable();
                $table->unsignedTinyInteger('is_current')->default(0);
                $table->string('released_by', 50)->nullable();
                $table->dateTime('created_at');
                $table->dateTime('updated_at');

                $table->index('is_current', 'idx_cbt_current');
            });
        }

        if (!Schema::hasTable('cloud_build_quotas')) {
            Schema::create('cloud_build_quotas', function (Blueprint $table) {
                $table->engine = 'InnoDB';
                $table->charset = 'utf8mb4';
                $table->collation = 'utf8mb4_unicode_ci';

                $table->bigIncrements('id');
                $table->string('client_ref', 64);
                $table->date('quota_date');
                $table->unsignedInteger('consumed')->default(0);
                $table->dateTime('created_at');
                $table->dateTime('updated_at');

                $table->unique(['client_ref', 'quota_date'], 'uq_cbq_client_date');
            });
        }

        if (!Schema::hasTable('cloud_build_jobs')) {
            Schema::create('cloud_build_jobs', function (Blueprint $table) {
                $table->engine = 'InnoDB';
                $table->charset = 'utf8mb4';
                $table->collation = 'utf8mb4_unicode_ci';

                $table->bigIncrements('id');
                $table->string('build_id', 36)->unique();
                $table->string('client_ref', 64);
                $table->string('build_mode', 16)->default('normal')->comment('normal/oem');
                $table->string('oem_project_key', 64)->nullable();
                $table->string('platform', 8);
                $table->string('app_name', 100)->default('');
                $table->string('app_version', 40)->default('');
                $table->string('app_id', 160)->nullable();
                $table->string('update_path', 255)->nullable();
                $table->text('build_options')->nullable();
                $table->string('phase', 32)->comment('LAP-035 规范阶段');
                $table->string('source_status', 32)->nullable()->comment('导入时的授权端 status');
                $table->string('source_mirror_status', 32)->nullable()->comment('导入时的授权端 mirror_status');
                $table->string('claim_owner', 64)->nullable();
                $table->dateTime('claimed_at')->nullable();
                $table->unsignedTinyInteger('dispatch_attempts')->default(0);
                $table->string('executor_id', 50)->nullable();
                $table->unsignedBigInteger('executor_run_id')->nullable();
                $table->string('error_message', 500)->nullable();
                $table->dateTime('queued_at')->nullable();
                $table->dateTime('dispatched_at')->nullable();
                $table->dateTime('started_at')->nullable();
                $table->dateTime('finished_at')->nullable();
                $table->dateTime('delivered_at')->nullable();
                $table->dateTime('purged_at')->nullable();
                $table->dateTime('created_at');
                $table->dateTime('updated_at');

                $table->index(['phase', 'claimed_at'], 'idx_cbj_phase_claimed');
                $table->index(['build_mode', 'oem_project_key'], 'idx_cbj_mode_oem');
                $table->index(['client_ref', 'phase'], 'idx_cbj_client_phase');
            });
        }

        if (!Schema::hasTable('cloud_build_attempts')) {
            Schema::create('cloud_build_attempts', function (Blueprint $table) {
                $table->engine = 'InnoDB';
                $table->charset = 'utf8mb4';
                $table->collation = 'utf8mb4_unicode_ci';

                $table->bigIncrements('id');
                $table->string('build_id', 36);
                $table->unsignedTinyInteger('attempt_no');
                $table->string('outcome', 20)->default('retried');
                $table->unsignedBigInteger('executor_run_id')->nullable();
                $table->dateTime('queued_at')->nullable();
                $table->dateTime('started_at')->nullable();
                $table->dateTime('finished_at')->nullable();
                $table->string('error_message', 500)->nullable();
                $table->dateTime('created_at');
                $table->dateTime('updated_at');

                $table->unique(['build_id', 'attempt_no'], 'uq_cba_build_attempt');
                $table->index('build_id', 'idx_cba_build');
            });
        }

        if (!Schema::hasTable('cloud_build_artifacts')) {
            Schema::create('cloud_build_artifacts', function (Blueprint $table) {
                $table->engine = 'InnoDB';
                $table->charset = 'utf8mb4';
                $table->collation = 'utf8mb4_unicode_ci';

                $table->bigIncrements('id');
                $table->string('build_id', 36);
                $table->string('filename', 200);
                $table->string('role', 32)->default('primary');
                $table->unsignedBigInteger('size')->default(0);
                $table->char('sha256', 64);
                $table->dateTime('created_at');
                $table->dateTime('updated_at');

                $table->unique(['build_id', 'role', 'filename'], 'uq_cbar_build_role_file');
                $table->index('build_id', 'idx_cbar_build');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('cloud_build_artifacts');
        Schema::dropIfExists('cloud_build_attempts');
        Schema::dropIfExists('cloud_build_jobs');
        Schema::dropIfExists('cloud_build_quotas');
        Schema::dropIfExists('cloud_build_templates');
        Schema::dropIfExists('cloud_build_clients');
    }
};
