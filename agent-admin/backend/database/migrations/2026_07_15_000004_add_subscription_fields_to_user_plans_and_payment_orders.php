<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::table('plans', function (Blueprint $table) {
            if (!Schema::hasColumn('plans', 'quota_refill_cycle')) {
                $table->string('quota_refill_cycle', 20)->default('none')->after('credit_quota');
            }
        });

        Schema::table('user_plans', function (Blueprint $table) {
            if (!Schema::hasColumn('user_plans', 'quota_refill_cycle')) {
                $table->string('quota_refill_cycle', 20)->default('none')->after('expires_at');
            }
            if (!Schema::hasColumn('user_plans', 'last_quota_refilled_at')) {
                $table->timestamp('last_quota_refilled_at')->nullable()->after('quota_refill_cycle');
            }
            if (!Schema::hasColumn('user_plans', 'next_quota_refill_at')) {
                $table->timestamp('next_quota_refill_at')->nullable()->after('last_quota_refilled_at');
            }
            if (!Schema::hasColumn('user_plans', 'upgraded_from_user_plan_id')) {
                $table->unsignedBigInteger('upgraded_from_user_plan_id')->nullable()->after('operator_id');
                $table->index('upgraded_from_user_plan_id', 'user_plans_upgraded_from_index');
            }
            if (!$this->indexExists('user_plans', 'user_plans_refill_due_index')) {
                $table->index(['quota_refill_cycle', 'status', 'next_quota_refill_at'], 'user_plans_refill_due_index');
            }
        });

        Schema::table('payment_orders', function (Blueprint $table) {
            if (!Schema::hasColumn('payment_orders', 'order_type')) {
                $table->string('order_type', 20)->default('purchase')->after('channel');
            }
            if (!$this->indexExists('payment_orders', 'payment_orders_user_type_status_index')) {
                $table->index(['user_id', 'order_type', 'status'], 'payment_orders_user_type_status_index');
            }
            if (!Schema::hasColumn('payment_orders', 'upgrade_from_user_plan_id')) {
                $table->unsignedBigInteger('upgrade_from_user_plan_id')->nullable()->after('user_plan_id');
                $table->index('upgrade_from_user_plan_id', 'payment_orders_upgrade_from_index');
            }
        });
    }

    public function down()
    {
        Schema::table('plans', function (Blueprint $table) {
            if (Schema::hasColumn('plans', 'quota_refill_cycle')) {
                $table->dropColumn('quota_refill_cycle');
            }
        });

        Schema::table('payment_orders', function (Blueprint $table) {
            if (Schema::hasColumn('payment_orders', 'upgrade_from_user_plan_id')) {
                if ($this->indexExists('payment_orders', 'payment_orders_upgrade_from_index')) {
                    $table->dropIndex('payment_orders_upgrade_from_index');
                }
                $table->dropColumn('upgrade_from_user_plan_id');
            }
            if (Schema::hasColumn('payment_orders', 'order_type')) {
                if ($this->indexExists('payment_orders', 'payment_orders_user_type_status_index')) {
                    $table->dropIndex('payment_orders_user_type_status_index');
                }
                $table->dropColumn('order_type');
            }
        });

        Schema::table('user_plans', function (Blueprint $table) {
            if (Schema::hasColumn('user_plans', 'upgraded_from_user_plan_id')) {
                if ($this->indexExists('user_plans', 'user_plans_upgraded_from_index')) {
                    $table->dropIndex('user_plans_upgraded_from_index');
                }
                $table->dropColumn('upgraded_from_user_plan_id');
            }
            if (Schema::hasColumn('user_plans', 'next_quota_refill_at')) {
                $table->dropColumn('next_quota_refill_at');
            }
            if (Schema::hasColumn('user_plans', 'last_quota_refilled_at')) {
                $table->dropColumn('last_quota_refilled_at');
            }
            if (Schema::hasColumn('user_plans', 'quota_refill_cycle')) {
                if ($this->indexExists('user_plans', 'user_plans_refill_due_index')) {
                    $table->dropIndex('user_plans_refill_due_index');
                }
                $table->dropColumn('quota_refill_cycle');
            }
        });
    }

    private function indexExists(string $table, string $index): bool
    {
        $connection = DB::connection();
        if ($connection->getDriverName() === 'sqlite') {
            $quotedTable = $connection->getPdo()->quote($table);
            foreach ($connection->select('PRAGMA index_list('.$quotedTable.')') as $row) {
                if ((string) ($row->name ?? '') === $index) {
                    return true;
                }
            }

            return false;
        }

        if ($connection->getDriverName() === 'pgsql') {
            return !empty($connection->select(
                'SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ? AND indexname = ? LIMIT 1',
                [$table, $index]
            ));
        }

        $database = DB::getDatabaseName();
        return !empty(DB::select(
            'select 1 from information_schema.statistics where table_schema = ? and table_name = ? and index_name = ? limit 1',
            [$database, $table, $index]
        ));
    }
};
