<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('creative_templates', function (Blueprint $table) {
            if (!Schema::hasColumn('creative_templates', 'submission_status')) {
                $table->enum('submission_status', ['pending', 'approved', 'rejected', 'withdrawn'])
                    ->default('approved')
                    ->after('is_visible')
                    ->comment('投稿审核状态');
            }
            if (!Schema::hasColumn('creative_templates', 'submitted_by_user_id')) {
                $table->unsignedBigInteger('submitted_by_user_id')->nullable()->after('created_by_user_id');
            }
            if (!Schema::hasColumn('creative_templates', 'submitted_by_nickname')) {
                $table->string('submitted_by_nickname', 50)->default('')->after('submitted_by_user_id');
            }
            if (!Schema::hasColumn('creative_templates', 'reviewed_by_user_id')) {
                $table->unsignedBigInteger('reviewed_by_user_id')->nullable()->after('submitted_by_nickname');
            }
            if (!Schema::hasColumn('creative_templates', 'reviewed_at')) {
                $table->timestamp('reviewed_at')->nullable()->after('reviewed_by_user_id');
            }
            if (!Schema::hasColumn('creative_templates', 'reject_reason')) {
                $table->string('reject_reason', 500)->default('')->after('reviewed_at');
            }
            if (!Schema::hasColumn('creative_templates', 'source_local_template_id')) {
                $table->string('source_local_template_id', 100)->default('')->after('reject_reason');
            }
            if (!Schema::hasColumn('creative_templates', 'submitted_at')) {
                $table->timestamp('submitted_at')->nullable()->after('source_local_template_id');
            }
            if (!Schema::hasColumn('creative_templates', 'published_at')) {
                $table->timestamp('published_at')->nullable()->after('submitted_at');
            }
        });

        Schema::table('creative_templates', function (Blueprint $table) {
            $table->index(['submission_status', 'is_visible'], 'creative_templates_submission_visible_idx');
            $table->index(['submitted_by_user_id', 'submission_status'], 'creative_templates_submitter_status_idx');
            $table->index('source_local_template_id', 'creative_templates_source_local_idx');
        });
    }

    public function down(): void
    {
        Schema::table('creative_templates', function (Blueprint $table) {
            $table->dropIndex('creative_templates_submission_visible_idx');
            $table->dropIndex('creative_templates_submitter_status_idx');
            $table->dropIndex('creative_templates_source_local_idx');
            $table->dropColumn([
                'published_at',
                'submitted_at',
                'source_local_template_id',
                'reject_reason',
                'reviewed_at',
                'reviewed_by_user_id',
                'submitted_by_nickname',
                'submitted_by_user_id',
                'submission_status',
            ]);
        });
    }
};
