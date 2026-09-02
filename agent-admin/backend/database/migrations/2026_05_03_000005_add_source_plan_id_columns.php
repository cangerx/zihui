<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        // 幂等：上一次失败可能已部分执行，检查现状再操作
        $hasMaCol = Schema::hasColumn('model_assignments', 'source_plan_id');
        $hasPpCol = Schema::hasColumn('permission_policies', 'source_plan_id');
        $maIndexes = $this->indexNames('model_assignments');
        $ppIndexes = $this->indexNames('permission_policies');

        // ========== model_assignments ==========
        Schema::table('model_assignments', function (Blueprint $table) use ($hasMaCol, $maIndexes) {
            if (!$hasMaCol) {
                $table->unsignedBigInteger('source_plan_id')->nullable()->after('assignee_id');
            }
            if (!in_array('model_assignments_source_plan_id_index', $maIndexes, true)) {
                $table->index('source_plan_id');
            }
            if (!in_array('model_assign_unique_v2', $maIndexes, true)) {
                $table->unique(
                    ['cloud_model_id', 'assignee_type', 'assignee_id', 'source_plan_id'],
                    'model_assign_unique_v2'
                );
            }
        });
        if (in_array('model_assign_unique', $this->indexNames('model_assignments'), true)) {
            Schema::table('model_assignments', function (Blueprint $table) {
                $table->dropUnique('model_assign_unique');
            });
        }

        // ========== permission_policies ==========
        Schema::table('permission_policies', function (Blueprint $table) use ($hasPpCol, $ppIndexes) {
            if (!$hasPpCol) {
                $table->unsignedBigInteger('source_plan_id')->nullable()->after('policy_value');
            }
            if (!in_array('permission_policies_source_plan_id_index', $ppIndexes, true)) {
                $table->index('source_plan_id');
            }
            if (!in_array('perm_policy_unique_v2', $ppIndexes, true)) {
                $table->unique(
                    ['target_type', 'target_id', 'policy_key', 'source_plan_id'],
                    'perm_policy_unique_v2'
                );
            }
        });
        if (in_array('perm_policy_unique', $this->indexNames('permission_policies'), true)) {
            Schema::table('permission_policies', function (Blueprint $table) {
                $table->dropUnique('perm_policy_unique');
            });
        }
    }

    /**
     * Read existing index names of a table from information_schema.
     */
    private function indexNames(string $table): array
    {
        $connection = \Illuminate\Support\Facades\DB::connection();

        return match ($connection->getDriverName()) {
            'sqlite' => array_map(
                static fn ($row) => (string) ($row->name ?? ''),
                $connection->select('PRAGMA index_list('.$connection->getPdo()->quote($table).')')
            ),
            'pgsql' => array_map(
                static fn ($row) => (string) ($row->indexname ?? ''),
                $connection->select(
                    'SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ?',
                    [$table]
                )
            ),
            default => array_map(
                static fn ($row) => (string) ($row->INDEX_NAME ?? ''),
                $connection->select(
                    'SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
                    [$table]
                )
            ),
        };
    }

    public function down()
    {
        // model_assignments
        Schema::table('model_assignments', function (Blueprint $table) {
            $table->unique(
                ['cloud_model_id', 'assignee_type', 'assignee_id'],
                'model_assign_unique'
            );
        });
        Schema::table('model_assignments', function (Blueprint $table) {
            $table->dropUnique('model_assign_unique_v2');
            $table->dropIndex(['source_plan_id']);
            $table->dropColumn('source_plan_id');
        });

        // permission_policies
        Schema::table('permission_policies', function (Blueprint $table) {
            $table->unique(
                ['target_type', 'target_id', 'policy_key'],
                'perm_policy_unique'
            );
        });
        Schema::table('permission_policies', function (Blueprint $table) {
            $table->dropUnique('perm_policy_unique_v2');
            $table->dropIndex(['source_plan_id']);
            $table->dropColumn('source_plan_id');
        });
    }
};
