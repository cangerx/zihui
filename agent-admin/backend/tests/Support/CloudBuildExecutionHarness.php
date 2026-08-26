<?php

namespace Tests\Support;

use Illuminate\Database\Capsule\Manager as Capsule;
use Illuminate\Support\Facades\Facade;

final class CloudBuildExecutionHarness
{
    public static function boot(): Capsule
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

        $base = dirname(__DIR__, 2) . '/database/migrations/';
        $m1 = include $base . '2026_08_22_000010_create_cloud_build_execution_tables.php';
        $m1->up();
        $m2 = include $base . '2026_08_22_000011_add_cloud_build_callback_fields.php';
        $m2->up();
        $m3 = include $base . '2026_08_22_000012_add_cloud_build_artifact_storage_fields.php';
        $m3->up();

        return $capsule;
    }
}
