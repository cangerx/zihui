<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('oem_projects', function (Blueprint $table) {
            if (!Schema::hasColumn('oem_projects', 'commission_rate')) {
                $table->decimal('commission_rate', 8, 4)->default(0)->after('status');
            }
            if (!Schema::hasColumn('oem_projects', 'commission_enabled')) {
                $table->boolean('commission_enabled')->default(true)->after('commission_rate');
            }
        });

        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'register_oem_project_key')) {
                $table->string('register_oem_project_key', 64)->nullable()->after('register_device_id');
                $table->index('register_oem_project_key', 'users_register_oem_project_key_index');
            }
        });

        if (!Schema::hasTable('plan_channel_visibilities')) {
            Schema::create('plan_channel_visibilities', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('plan_id');
                $table->string('channel_type', 20)->default('default');
                $table->string('channel_key', 64)->default('default');
                $table->string('oem_project_key', 64)->nullable();
                $table->unsignedInteger('sort')->default(0);
                $table->timestamps();

                $table->unique(['plan_id', 'channel_key'], 'plan_channel_visibility_unique');
                $table->index(['channel_type', 'channel_key'], 'plan_channel_visibility_channel_index');
                $table->index('oem_project_key', 'plan_channel_visibility_oem_index');
            });
        }

        $now = now();
        foreach (DB::table('plans')->select('id')->orderBy('id')->get() as $plan) {
            DB::table('plan_channel_visibilities')->updateOrInsert(
                ['plan_id' => $plan->id, 'channel_key' => 'default'],
                [
                    'channel_type' => 'default',
                    'oem_project_key' => null,
                    'sort' => 0,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]
            );
        }

        if (!Schema::hasTable('oem_project_members')) {
            Schema::create('oem_project_members', function (Blueprint $table) {
                $table->id();
                $table->string('oem_project_key', 64);
                $table->unsignedBigInteger('user_id');
                $table->string('role', 20)->default('owner');
                $table->string('status', 20)->default('active');
                $table->timestamps();

                $table->unique(['oem_project_key', 'user_id'], 'oem_project_members_unique');
                $table->index(['user_id', 'status'], 'oem_project_members_user_status_index');
                $table->index(['oem_project_key', 'status'], 'oem_project_members_project_status_index');
            });
        }

        Schema::table('payment_orders', function (Blueprint $table) {
            if (!Schema::hasColumn('payment_orders', 'oem_project_key')) {
                $table->string('oem_project_key', 64)->nullable()->after('channel');
            }
            if (!Schema::hasColumn('payment_orders', 'commission_user_id')) {
                $table->unsignedBigInteger('commission_user_id')->nullable()->after('oem_project_key');
            }
            if (!Schema::hasColumn('payment_orders', 'commission_rate_snapshot')) {
                $table->decimal('commission_rate_snapshot', 8, 4)->default(0)->after('commission_user_id');
            }
            if (!Schema::hasColumn('payment_orders', 'commission_amount')) {
                $table->decimal('commission_amount', 16, 2)->default(0)->after('commission_rate_snapshot');
            }
            if (!Schema::hasColumn('payment_orders', 'commission_status')) {
                $table->string('commission_status', 20)->default('none')->after('commission_amount');
            }
            if (!$this->indexExists('payment_orders', 'payment_orders_oem_status_paid_index')) {
                $table->index(['oem_project_key', 'status', 'paid_at'], 'payment_orders_oem_status_paid_index');
            }
            if (!$this->indexExists('payment_orders', 'payment_orders_commission_user_status_index')) {
                $table->index(['commission_user_id', 'commission_status', 'paid_at'], 'payment_orders_commission_user_status_index');
            }
            if (!$this->indexExists('payment_orders', 'payment_orders_oem_commission_status_index')) {
                $table->index(['oem_project_key', 'commission_status'], 'payment_orders_oem_commission_status_index');
            }
        });

        if (!Schema::hasTable('oem_commission_records')) {
            Schema::create('oem_commission_records', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('order_id');
                $table->string('order_no', 40);
                $table->string('oem_project_key', 64);
                $table->unsignedBigInteger('user_id');
                $table->unsignedBigInteger('buyer_user_id');
                $table->unsignedBigInteger('plan_id')->nullable();
                $table->string('order_type', 20)->default('purchase');
                $table->string('pay_channel', 20)->default('wechat_native');
                $table->decimal('order_amount', 16, 2)->default(0);
                $table->decimal('commission_rate', 8, 4)->default(0);
                $table->decimal('commission_amount', 16, 2)->default(0);
                $table->string('status', 20)->default('confirmed');
                $table->timestamp('confirmed_at')->nullable();
                $table->timestamp('cancelled_at')->nullable();
                $table->string('cancel_reason', 500)->default('');
                $table->timestamps();

                $table->unique('order_id', 'oem_commission_records_order_unique');
                $table->index('order_no', 'oem_commission_records_order_no_index');
                $table->index(['oem_project_key', 'status'], 'oem_commission_records_project_status_index');
                $table->index(['user_id', 'status', 'confirmed_at'], 'oem_commission_records_user_status_index');
                $table->index(['buyer_user_id', 'created_at'], 'oem_commission_records_buyer_created_index');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('oem_commission_records');
        Schema::dropIfExists('oem_project_members');
        Schema::dropIfExists('plan_channel_visibilities');

        Schema::table('payment_orders', function (Blueprint $table) {
            if ($this->indexExists('payment_orders', 'payment_orders_oem_commission_status_index')) {
                $table->dropIndex('payment_orders_oem_commission_status_index');
            }
            if ($this->indexExists('payment_orders', 'payment_orders_commission_user_status_index')) {
                $table->dropIndex('payment_orders_commission_user_status_index');
            }
            if ($this->indexExists('payment_orders', 'payment_orders_oem_status_paid_index')) {
                $table->dropIndex('payment_orders_oem_status_paid_index');
            }
            foreach (['commission_status', 'commission_amount', 'commission_rate_snapshot', 'commission_user_id', 'oem_project_key'] as $column) {
                if (Schema::hasColumn('payment_orders', $column)) {
                    $table->dropColumn($column);
                }
            }
        });

        Schema::table('users', function (Blueprint $table) {
            if (Schema::hasColumn('users', 'register_oem_project_key')) {
                if ($this->indexExists('users', 'users_register_oem_project_key_index')) {
                    $table->dropIndex('users_register_oem_project_key_index');
                }
                $table->dropColumn('register_oem_project_key');
            }
        });

        Schema::table('oem_projects', function (Blueprint $table) {
            if (Schema::hasColumn('oem_projects', 'commission_enabled')) {
                $table->dropColumn('commission_enabled');
            }
            if (Schema::hasColumn('oem_projects', 'commission_rate')) {
                $table->dropColumn('commission_rate');
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
