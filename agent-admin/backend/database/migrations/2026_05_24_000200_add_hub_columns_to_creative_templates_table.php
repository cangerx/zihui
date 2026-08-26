<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('creative_templates', function (Blueprint $table) {
            if (!Schema::hasColumn('creative_templates', 'hub_shared_id')) {
                $table->unsignedBigInteger('hub_shared_id')->nullable()->after('is_visible');
            }
            if (!Schema::hasColumn('creative_templates', 'hub_status')) {
                $table->enum('hub_status', ['pending', 'approved', 'rejected'])->nullable()->after('hub_shared_id');
            }
            if (!Schema::hasColumn('creative_templates', 'hub_status_synced_at')) {
                $table->dateTime('hub_status_synced_at')->nullable()->after('hub_status');
            }
            if (!Schema::hasColumn('creative_templates', 'from_hub_template_id')) {
                $table->unsignedBigInteger('from_hub_template_id')->nullable()->after('hub_status_synced_at');
            }
            if (!Schema::hasColumn('creative_templates', 'from_hub_source_site_name')) {
                $table->string('from_hub_source_site_name', 100)->nullable()->after('from_hub_template_id');
            }
            if (!Schema::hasColumn('creative_templates', 'source_metadata')) {
                $table->json('source_metadata')->nullable()->after('source_inspiration_id');
            }
        });

        Schema::table('creative_templates', function (Blueprint $table) {
            $table->unique('hub_shared_id', 'creative_templates_hub_shared_id_unique');
            $table->unique('from_hub_template_id', 'creative_templates_from_hub_id_unique');
            $table->index(['hub_status', 'hub_status_synced_at'], 'creative_templates_hub_status_idx');
        });
    }

    public function down(): void
    {
        Schema::table('creative_templates', function (Blueprint $table) {
            $table->dropIndex('creative_templates_hub_status_idx');
            $table->dropUnique('creative_templates_from_hub_id_unique');
            $table->dropUnique('creative_templates_hub_shared_id_unique');
            $table->dropColumn([
                'source_metadata',
                'from_hub_source_site_name',
                'from_hub_template_id',
                'hub_status_synced_at',
                'hub_status',
                'hub_shared_id',
            ]);
        });
    }
};
