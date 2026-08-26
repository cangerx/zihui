<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('shared_agent_categories', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->string('name', 50);
            $table->string('slug', 50)->unique();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });

        Schema::create('shared_agents', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->unsignedBigInteger('category_id')->nullable();
            $table->string('name', 100);
            $table->string('description', 500)->default('');
            $table->string('avatar', 500)->default('');
            $table->longText('system_prompt')->nullable();
            $table->json('tool_skill_ids')->nullable();
            $table->string('tool_approval', 20)->default('destructive');
            $table->boolean('enable_image_gen')->default(false);
            $table->json('tags')->nullable();
            $table->string('source_client_id', 32);
            $table->string('source_local_id', 64);
            $table->string('source_site_name', 100)->default('');
            $table->json('source_metadata')->nullable();
            $table->string('status', 20)->default('pending');
            $table->boolean('is_visible')->default(true);
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamp('auto_hidden_at')->nullable();
            $table->unsignedInteger('approve_count')->default(0);
            $table->unsignedInteger('reject_count')->default(0);
            $table->unsignedInteger('report_count')->default(0);
            $table->unsignedInteger('download_count')->default(0);
            $table->timestamps();

            $table->unique(['source_client_id', 'source_local_id'], 'uniq_sa_source');
            $table->index(['status', 'is_visible'], 'idx_sa_status_visible');
            $table->index(['category_id', 'status'], 'idx_sa_category_status');
            $table->index('source_client_id', 'idx_sa_source_client');
            $table->index('created_at', 'idx_sa_created');

            $table->foreign('category_id', 'fk_sa_category')
                ->references('id')->on('shared_agent_categories')
                ->onDelete('set null');
            $table->foreign('source_client_id', 'fk_sa_source_client')
                ->references('client_id')->on('authorized_clients')
                ->onDelete('cascade');
        });

        Schema::create('shared_agent_reviews', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->unsignedBigInteger('shared_id');
            $table->string('reviewer_client_id', 32);
            $table->string('action', 20);
            $table->string('reason', 255)->nullable();
            $table->dateTime('created_at');

            $table->unique(['shared_id', 'reviewer_client_id'], 'uniq_sa_review_vote');
            $table->index(['shared_id', 'action'], 'idx_sa_review_action');

            $table->foreign('shared_id', 'fk_sa_review_shared')
                ->references('id')->on('shared_agents')
                ->onDelete('cascade');
            $table->foreign('reviewer_client_id', 'fk_sa_review_reviewer')
                ->references('client_id')->on('authorized_clients')
                ->onDelete('cascade');
        });

        Schema::create('shared_agent_reports', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->unsignedBigInteger('shared_id');
            $table->string('reporter_client_id', 32);
            $table->string('reason_code', 30);
            $table->string('reason_note', 255)->nullable();
            $table->dateTime('created_at');

            $table->unique(['shared_id', 'reporter_client_id'], 'uniq_sa_report_client');
            $table->index('shared_id', 'idx_sa_report_shared');
            $table->index('reporter_client_id', 'idx_sa_report_reporter');

            $table->foreign('shared_id', 'fk_sa_report_shared')
                ->references('id')->on('shared_agents')
                ->onDelete('cascade');
            $table->foreign('reporter_client_id', 'fk_sa_report_reporter')
                ->references('client_id')->on('authorized_clients')
                ->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shared_agent_reports');
        Schema::dropIfExists('shared_agent_reviews');
        Schema::dropIfExists('shared_agents');
        Schema::dropIfExists('shared_agent_categories');
    }
};
