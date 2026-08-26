<?php

namespace Tests\Unit;

use Illuminate\Database\Capsule\Manager as Capsule;
use Illuminate\Support\Facades\Facade;
use PHPUnit\Framework\TestCase;

class SkillCatalogMigrationTest extends TestCase
{
    public function test_migration_up_and_down_on_sqlite(): void
    {
        $capsule = new Capsule();
        $capsule->addConnection([
            'driver' => 'sqlite',
            'database' => ':memory:',
            'prefix' => '',
        ]);
        $capsule->setAsGlobal();
        $capsule->bootEloquent();

        $app = new \Illuminate\Container\Container();
        $app->instance('db', $capsule->getDatabaseManager());
        $app->bind('db.schema', function () use ($capsule) {
            return $capsule->schema();
        });
        Facade::clearResolvedInstances();
        Facade::setFacadeApplication($app);

        $migration = require dirname(__DIR__, 2) . '/database/migrations/2026_08_22_000100_create_skill_catalog_tables.php';
        $migration->up();

        $schema = $capsule->schema();
        foreach ([
            'skill_catalog_skills',
            'skill_catalog_versions',
            'skill_catalog_tenant_policies',
            'skill_catalog_sync_state',
        ] as $table) {
            $this->assertTrue($schema->hasTable($table), $table . ' should exist after up()');
        }

        $migration->down();
        foreach ([
            'skill_catalog_skills',
            'skill_catalog_versions',
            'skill_catalog_tenant_policies',
            'skill_catalog_sync_state',
        ] as $table) {
            $this->assertFalse($schema->hasTable($table), $table . ' should drop after down()');
        }
    }
}
