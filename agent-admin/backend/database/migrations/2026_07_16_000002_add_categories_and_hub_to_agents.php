<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // 智能体分类（与创意模板分类同构）
        if (!Schema::hasTable('agent_categories')) {
            Schema::create('agent_categories', function (Blueprint $table) {
                $table->id();
                $table->string('name', 50);
                $table->string('description', 500)->default('');
                $table->unsignedInteger('sort_order')->default(0);
                $table->boolean('is_visible')->default(true);
                $table->timestamps();
            });
        }

        // agents 追加：分类 + 智能体共享库（Agent Hub）相关列。全部为新增列，不改动既有列。
        Schema::table('agents', function (Blueprint $table) {
            if (!Schema::hasColumn('agents', 'category_id')) {
                $table->unsignedBigInteger('category_id')->nullable()->after('id');
            }
            if (!Schema::hasColumn('agents', 'hub_shared_id')) {
                $table->unsignedBigInteger('hub_shared_id')->nullable()->after('is_visible');
            }
            if (!Schema::hasColumn('agents', 'hub_status')) {
                $table->string('hub_status', 20)->nullable()->after('hub_shared_id');
            }
            if (!Schema::hasColumn('agents', 'hub_status_synced_at')) {
                $table->dateTime('hub_status_synced_at')->nullable()->after('hub_status');
            }
            if (!Schema::hasColumn('agents', 'from_hub_agent_id')) {
                $table->unsignedBigInteger('from_hub_agent_id')->nullable()->after('hub_status_synced_at');
            }
            if (!Schema::hasColumn('agents', 'from_hub_source_site_name')) {
                $table->string('from_hub_source_site_name', 100)->nullable()->after('from_hub_agent_id');
            }
            if (!Schema::hasColumn('agents', 'source_metadata')) {
                $table->json('source_metadata')->nullable()->after('from_hub_source_site_name');
            }
        });

        Schema::table('agents', function (Blueprint $table) {
            $table->index('category_id', 'agents_category_id_idx');
            $table->unique('hub_shared_id', 'agents_hub_shared_id_unique');
            $table->unique('from_hub_agent_id', 'agents_from_hub_id_unique');
            $table->index(['hub_status', 'hub_status_synced_at'], 'agents_hub_status_idx');
        });
    }

    public function down(): void
    {
        Schema::table('agents', function (Blueprint $table) {
            $table->dropIndex('agents_hub_status_idx');
            $table->dropUnique('agents_from_hub_id_unique');
            $table->dropUnique('agents_hub_shared_id_unique');
            $table->dropIndex('agents_category_id_idx');
            $table->dropColumn([
                'source_metadata',
                'from_hub_source_site_name',
                'from_hub_agent_id',
                'hub_status_synced_at',
                'hub_status',
                'hub_shared_id',
                'category_id',
            ]);
        });

        Schema::dropIfExists('agent_categories');
    }
};
