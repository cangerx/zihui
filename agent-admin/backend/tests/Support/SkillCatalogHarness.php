<?php

namespace Tests\Support;

use Illuminate\Database\Capsule\Manager as Capsule;
use Illuminate\Support\Facades\Facade;

final class SkillCatalogHarness
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

        $migration = include dirname(__DIR__, 2) . '/database/migrations/2026_08_22_000100_create_skill_catalog_tables.php';
        $migration->up();

        return $capsule;
    }
}
