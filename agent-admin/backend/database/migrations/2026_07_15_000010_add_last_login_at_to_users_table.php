<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'last_login_at')) {
                $table->timestamp('last_login_at')->nullable()->after('inspiration_uploader');
                $table->index('last_login_at', 'users_last_login_at_index');
            }
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (Schema::hasColumn('users', 'last_login_at')) {
                if ($this->indexExists('users', 'users_last_login_at_index')) {
                    $table->dropIndex('users_last_login_at_index');
                }
                $table->dropColumn('last_login_at');
            }
        });
    }

    private function indexExists(string $table, string $name): bool
    {
        $connection = \Illuminate\Support\Facades\DB::connection();
        if ($connection->getDriverName() === 'sqlite') {
            $quotedTable = $connection->getPdo()->quote($table);
            foreach ($connection->select('PRAGMA index_list('.$quotedTable.')') as $row) {
                if ((string) ($row->name ?? '') === $name) {
                    return true;
                }
            }

            return false;
        }

        if ($connection->getDriverName() === 'pgsql') {
            return !empty($connection->select(
                'SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ? AND indexname = ? LIMIT 1',
                [$table, $name]
            ));
        }

        $database = config('database.connections.' . config('database.default') . '.database');
        $count = \DB::selectOne(
            'SELECT COUNT(1) AS c FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? AND index_name = ?',
            [$database, $table, $name]
        );
        return (int)($count->c ?? 0) > 0;
    }
};
