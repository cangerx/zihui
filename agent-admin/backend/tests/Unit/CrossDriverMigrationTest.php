<?php

namespace Tests\Unit;

use Illuminate\Container\Container;
use Illuminate\Database\Capsule\Manager as Capsule;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Facade;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\TestCase;

/**
 * Regression coverage for migrations that historically emitted MySQL-only SQL.
 *
 * These tests intentionally execute the migrations against SQLite (the CI
 * baseline) and inspect the generated statements. A migration may use native
 * SQL for MySQL/PostgreSQL, but must never send MODIFY/FULLTEXT to SQLite.
 */
class CrossDriverMigrationTest extends TestCase
{
    public function test_video_price_migration_runs_on_sqlite_without_mysql_alter(): void
    {
        $capsule = $this->bootSqlite();
        $connection = $capsule->getDatabaseManager()->connection();
        $connection->enableQueryLog();

        $videoCore = require dirname(__DIR__, 2) . '/database/migrations/2026_05_26_000001_create_video_core_tables.php';
        $videoCore->up();

        $migration = require dirname(__DIR__, 2) . '/database/migrations/2026_07_15_000008_optimize_video_skus_and_nullable_default_price.php';
        $migration->up();

        $sql = implode("\n", array_column($connection->getQueryLog(), 'query'));
        $this->assertDoesNotMatchRegularExpression('/\bMODIFY\b|\bFULLTEXT\b/i', $sql);
        $this->assertTrue(Schema::hasTable('video_sku_prices'));

        $disabled = DB::table('video_sku_prices')
            ->where('sku_key', 'duomi:grok-video:default')
            ->value('default_credit_cost');
        $this->assertNull($disabled);

        $column = collect($connection->select("PRAGMA table_info('video_sku_prices')"))
            ->first(static fn ($item): bool => ($item->name ?? null) === 'default_credit_cost');
        $this->assertNotNull($column);
        $this->assertSame(0, (int) $column->notnull, 'SQLite must preserve the nullable pricing semantics');

        $alignment = require dirname(__DIR__, 2) . '/database/migrations/2026_07_15_000009_align_video_sku_cost_sources_and_supported_combinations.php';
        $alignment->up();
        $this->assertNull(DB::table('video_sku_prices')->where('sku_key', 'duomi:grok-video:default')->value('default_credit_cost'));
    }

    public function test_kb_chunks_migration_skips_mysql_fulltext_on_sqlite(): void
    {
        $capsule = $this->bootSqlite();
        $connection = $capsule->getDatabaseManager()->connection();
        $connection->enableQueryLog();

        $knowledgeBases = require dirname(__DIR__, 2) . '/database/migrations/2026_07_18_000001_create_knowledge_bases_table.php';
        $knowledgeBases->up();
        $documents = require dirname(__DIR__, 2) . '/database/migrations/2026_07_18_000002_create_kb_documents_table.php';
        $documents->up();
        $migration = require dirname(__DIR__, 2) . '/database/migrations/2026_07_18_000003_create_kb_chunks_table.php';
        $migration->up();

        $sql = implode("\n", array_column($connection->getQueryLog(), 'query'));
        $this->assertDoesNotMatchRegularExpression('/\bFULLTEXT\b|WITH PARSER\s+ngram/i', $sql);
        $this->assertTrue(Schema::hasTable('kb_chunks'));

        $indexes = $connection->select("PRAGMA index_list('kb_chunks')");
        $indexNames = array_map(static fn ($index): string => (string) ($index->name ?? ''), $indexes);
        $this->assertNotContains('ft_kb_chunks_text', $indexNames);
    }

    public function test_payment_order_migration_skips_mysql_modify_on_sqlite(): void
    {
        $capsule = $this->bootSqlite();
        $connection = $capsule->getDatabaseManager()->connection();
        Schema::create('payment_orders', function ($table): void {
            $table->id();
            $table->unsignedBigInteger('plan_id');
        });
        $connection->enableQueryLog();

        $migration = require dirname(__DIR__, 2) . '/database/migrations/2026_07_15_000012_make_payment_orders_plan_id_nullable.php';
        $migration->up();

        $sql = implode("\n", array_column($connection->getQueryLog(), 'query'));
        $this->assertDoesNotMatchRegularExpression('/\bMODIFY\b/i', $sql);
        $column = collect($connection->select("PRAGMA table_info('payment_orders')"))
            ->first(static fn ($item): bool => ($item->name ?? null) === 'plan_id');
        $this->assertNotNull($column);
        $this->assertSame(1, (int) $column->notnull, 'SQLite keeps the original constraint without a table rebuild');
    }

    public function test_phone_cleanup_is_portable_and_preserves_lowest_user_id(): void
    {
        $capsule = $this->bootSqlite();
        $connection = $capsule->getDatabaseManager()->connection();
        Schema::create('users', function ($table): void {
            $table->id();
            $table->string('phone')->nullable();
        });

        DB::table('users')->insert([
            ['id' => 1, 'phone' => '13800000000'],
            ['id' => 2, 'phone' => '13800000000'],
            ['id' => 3, 'phone' => ''],
            ['id' => 4, 'phone' => null],
        ]);
        $connection->enableQueryLog();

        $migration = require dirname(__DIR__, 2) . '/database/migrations/2026_07_19_000001_add_unique_index_to_users_phone.php';
        $migration->up();

        $sql = implode("\n", array_column($connection->getQueryLog(), 'query'));
        $this->assertDoesNotMatchRegularExpression('/UPDATE\s+users\s+AS|\bJOIN\b/i', $sql);
        $this->assertSame('13800000000', DB::table('users')->where('id', 1)->value('phone'));
        $this->assertNull(DB::table('users')->where('id', 2)->value('phone'));
        $this->assertNull(DB::table('users')->where('id', 3)->value('phone'));
        $this->assertNull(DB::table('users')->where('id', 4)->value('phone'));
        $this->assertTrue($this->hasSqliteIndex($connection, 'users', 'users_phone_unique'));
    }

    private function bootSqlite(): Capsule
    {
        $capsule = new Capsule();
        $capsule->addConnection([
            'driver' => 'sqlite',
            'database' => ':memory:',
            'prefix' => '',
            'foreign_key_constraints' => true,
        ]);
        $capsule->setAsGlobal();
        $capsule->bootEloquent();

        $app = new Container();
        $db = $capsule->getDatabaseManager();
        $app->instance('db', $db);
        $app->bind('db.schema', static fn () => $db->connection()->getSchemaBuilder());
        Facade::clearResolvedInstances();
        Facade::setFacadeApplication($app);

        return $capsule;
    }

    private function hasSqliteIndex($connection, string $table, string $name): bool
    {
        foreach ($connection->select('PRAGMA index_list(' . $connection->getPdo()->quote($table) . ')') as $index) {
            if ((string) ($index->name ?? '') === $name) {
                return true;
            }
        }

        return false;
    }
}
