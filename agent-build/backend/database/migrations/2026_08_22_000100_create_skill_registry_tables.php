<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Skill Registry v1：平台 Skill、不可变版本、审核、报告与变更事件。
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('skill_registry_skills', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';
            $table->bigIncrements('id');
            $table->char('skill_id', 36)->unique();
            $table->string('slug', 120);
            $table->string('name', 120);
            $table->string('status', 16)->default('draft');
            $table->timestamps();
            $table->index(['slug', 'status'], 'idx_skill_reg_slug_status');
        });

        Schema::create('skill_registry_versions', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';
            $table->bigIncrements('id');
            $table->char('version_id', 36)->unique();
            $table->char('skill_id', 36);
            $table->string('version', 64);
            $table->string('status', 24)->default('uploaded');
            $table->char('sha256', 64)->nullable();
            $table->string('package_path', 500)->nullable();
            $table->unsignedInteger('package_size')->default(0);
            $table->unsignedSmallInteger('file_count')->default(0);
            $table->json('manifest_json')->nullable();
            $table->json('permissions_json')->nullable();
            $table->json('scan_report')->nullable();
            $table->text('signature')->nullable();
            $table->string('signature_algorithm', 32)->nullable();
            $table->string('key_id', 64)->nullable();
            $table->dateTime('published_at')->nullable();
            $table->dateTime('revoked_at')->nullable();
            $table->string('reject_reason', 500)->nullable();
            $table->unsignedBigInteger('uploaded_by')->nullable();
            $table->timestamps();
            $table->unique(['skill_id', 'version'], 'uniq_skill_reg_semver');
            $table->index(['skill_id', 'status'], 'idx_skill_reg_ver_status');
        });

        Schema::create('skill_registry_reviews', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';
            $table->bigIncrements('id');
            $table->char('version_id', 36);
            $table->string('action', 24);
            $table->unsignedBigInteger('reviewer_id')->nullable();
            $table->string('evidence', 2000)->default('');
            $table->timestamps();
            $table->index('version_id', 'idx_skill_reg_review_ver');
        });

        Schema::create('skill_registry_reports', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';
            $table->bigIncrements('id');
            $table->char('skill_id', 36);
            $table->char('version_id', 36)->nullable();
            $table->string('reason', 500);
            $table->string('reporter', 120)->default('');
            $table->timestamps();
            $table->index('skill_id', 'idx_skill_reg_report_skill');
        });

        Schema::create('skill_registry_events', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';
            $table->bigIncrements('id');
            $table->string('event_type', 32);
            $table->char('skill_id', 36);
            $table->char('version_id', 36)->nullable();
            $table->json('payload_json')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->index('skill_id', 'idx_skill_reg_evt_skill');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('skill_registry_events');
        Schema::dropIfExists('skill_registry_reports');
        Schema::dropIfExists('skill_registry_reviews');
        Schema::dropIfExists('skill_registry_versions');
        Schema::dropIfExists('skill_registry_skills');
    }
};
