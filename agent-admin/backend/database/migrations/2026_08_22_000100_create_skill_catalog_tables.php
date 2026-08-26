<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('skill_catalog_skills', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';
            $table->bigIncrements('id');
            $table->char('skill_id', 36)->unique();
            $table->string('slug', 120);
            $table->string('name', 120);
            $table->string('status', 16)->default('active');
            $table->string('category', 64)->default('');
            $table->boolean('recommended')->default(false);
            $table->timestamps();
        });

        Schema::create('skill_catalog_versions', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';
            $table->bigIncrements('id');
            $table->char('version_id', 36)->unique();
            $table->char('skill_id', 36);
            $table->string('version', 64);
            $table->string('status', 24)->default('published');
            $table->char('sha256', 64);
            $table->string('package_path', 500)->nullable();
            $table->text('signature')->nullable();
            $table->string('key_id', 64)->nullable();
            $table->json('manifest_json')->nullable();
            $table->json('permissions_json')->nullable();
            $table->dateTime('published_at')->nullable();
            $table->dateTime('revoked_at')->nullable();
            $table->timestamps();
            $table->unique(['skill_id', 'version'], 'uniq_skill_cat_semver');
        });

        Schema::create('skill_catalog_tenant_policies', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';
            $table->bigIncrements('id');
            $table->unsignedBigInteger('tenant_id')->default(0);
            $table->char('skill_id', 36);
            $table->boolean('listed')->default(true);
            $table->timestamps();
            $table->unique(['tenant_id', 'skill_id'], 'uniq_skill_cat_tenant');
        });

        Schema::create('skill_catalog_sync_state', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';
            $table->increments('id');
            $table->unsignedBigInteger('cursor')->default(0);
            $table->string('last_error', 500)->default('');
            $table->dateTime('last_success_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('skill_catalog_sync_state');
        Schema::dropIfExists('skill_catalog_tenant_policies');
        Schema::dropIfExists('skill_catalog_versions');
        Schema::dropIfExists('skill_catalog_skills');
    }
};
