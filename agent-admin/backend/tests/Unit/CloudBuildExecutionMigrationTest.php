<?php

namespace Tests\Unit;

use Illuminate\Database\Capsule\Manager as Capsule;
use Illuminate\Support\Facades\Facade;
use PHPUnit\Framework\TestCase;

class CloudBuildExecutionMigrationTest extends TestCase
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

        $migration = require dirname(__DIR__, 2) . '/database/migrations/2026_08_22_000010_create_cloud_build_execution_tables.php';
        $migration->up();

        $schema = $capsule->schema();
        foreach ([
            'cloud_build_clients',
            'cloud_build_templates',
            'cloud_build_quotas',
            'cloud_build_jobs',
            'cloud_build_attempts',
            'cloud_build_artifacts',
        ] as $table) {
            $this->assertTrue($schema->hasTable($table), $table . ' should exist after up()');
        }
        $this->assertFalse($schema->hasTable('cloud_builds'));
        $this->assertFalse($schema->hasTable('oem_builds'));

        $migration->down();
        foreach ([
            'cloud_build_clients',
            'cloud_build_templates',
            'cloud_build_quotas',
            'cloud_build_jobs',
            'cloud_build_attempts',
            'cloud_build_artifacts',
        ] as $table) {
            $this->assertFalse($schema->hasTable($table), $table . ' should drop after down()');
        }
    }
}
