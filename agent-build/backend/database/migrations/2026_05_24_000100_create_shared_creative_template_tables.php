<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('shared_creative_template_categories', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->string('name', 50);
            $table->string('slug', 50)->unique();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });

        Schema::create('shared_creative_templates', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->unsignedBigInteger('category_id');
            $table->string('title', 100);
            $table->string('description', 500)->default('');
            $table->string('cover_image', 500)->default('');
            $table->json('example_ref_images')->nullable();
            $table->boolean('requires_ref_image')->default(false);
            $table->string('default_size', 50)->default('');
            $table->longText('prompt_template');
            $table->json('variables')->nullable();
            $table->string('source_type', 30)->default('manual');
            $table->string('source_image', 500)->default('');
            $table->unsignedBigInteger('source_inspiration_id')->nullable();
            $table->json('source_metadata')->nullable();
            $table->string('source_client_id', 32);
            $table->unsignedBigInteger('source_local_id');
            $table->string('source_site_name', 100);
            $table->enum('status', ['pending', 'approved', 'rejected'])->default('pending');
            $table->boolean('is_visible')->default(true);
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamp('auto_hidden_at')->nullable();
            $table->unsignedInteger('approve_count')->default(0);
            $table->unsignedInteger('reject_count')->default(0);
            $table->unsignedInteger('report_count')->default(0);
            $table->unsignedInteger('download_count')->default(0);
            $table->timestamps();

            $table->unique(['source_client_id', 'source_local_id'], 'uniq_sct_source');
            $table->index(['status', 'is_visible'], 'idx_sct_status_visible');
            $table->index(['category_id', 'status'], 'idx_sct_category_status');
            $table->index('source_client_id', 'idx_sct_source_client');
            $table->index('created_at', 'idx_sct_created');

            $table->foreign('category_id', 'fk_sct_category')
                ->references('id')->on('shared_creative_template_categories')
                ->onDelete('restrict');
            $table->foreign('source_client_id', 'fk_sct_source_client')
                ->references('client_id')->on('authorized_clients')
                ->onDelete('cascade');
        });

        Schema::create('shared_creative_template_reviews', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->unsignedBigInteger('shared_id');
            $table->string('reviewer_client_id', 32);
            $table->enum('action', ['approve', 'reject']);
            $table->string('reason', 255)->nullable();
            $table->dateTime('created_at');

            $table->unique(['shared_id', 'reviewer_client_id'], 'uniq_sct_review_vote');
            $table->index(['shared_id', 'action'], 'idx_sct_review_action');

            $table->foreign('shared_id', 'fk_sct_review_shared')
                ->references('id')->on('shared_creative_templates')
                ->onDelete('cascade');
            $table->foreign('reviewer_client_id', 'fk_sct_review_reviewer')
                ->references('client_id')->on('authorized_clients')
                ->onDelete('cascade');
        });

        Schema::create('shared_creative_template_reports', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->unsignedBigInteger('shared_id');
            $table->string('reporter_client_id', 32);
            $table->string('reason_code', 30);
            $table->string('reason_note', 255)->nullable();
            $table->dateTime('created_at');

            $table->unique(['shared_id', 'reporter_client_id'], 'uniq_sct_report_client');
            $table->index('shared_id', 'idx_sct_report_shared');
            $table->index('reporter_client_id', 'idx_sct_report_reporter');

            $table->foreign('shared_id', 'fk_sct_report_shared')
                ->references('id')->on('shared_creative_templates')
                ->onDelete('cascade');
            $table->foreign('reporter_client_id', 'fk_sct_report_reporter')
                ->references('client_id')->on('authorized_clients')
                ->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shared_creative_template_reports');
        Schema::dropIfExists('shared_creative_template_reviews');
        Schema::dropIfExists('shared_creative_templates');
        Schema::dropIfExists('shared_creative_template_categories');
    }
};
