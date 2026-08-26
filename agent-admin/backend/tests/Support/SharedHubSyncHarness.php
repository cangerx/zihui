<?php

namespace Tests\Support;

use Illuminate\Config\Repository;
use Illuminate\Database\Capsule\Manager as Capsule;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Facade;
use Illuminate\Support\Facades\Schema;

final class SharedHubSyncHarness
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
        $app->instance('config', new Repository(['app' => ['url' => 'https://cloud.test']]));
        $app->bind('db.schema', function () use ($capsule) {
            return $capsule->schema();
        });
        Facade::clearResolvedInstances();
        Facade::setFacadeApplication($app);

        Schema::create('inspiration_categories', function (Blueprint $table) {
            $table->id();
            $table->string('name', 50);
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });
        Schema::create('inspirations', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('category_id');
            $table->string('title', 100);
            $table->string('cover_image', 500)->default('');
            $table->text('ref_images')->nullable();
            $table->string('generation_size', 50)->nullable();
            $table->text('prompt_cn')->nullable();
            $table->text('prompt_en')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->string('status', 20)->default('approved');
            $table->boolean('is_visible')->default(true);
            $table->unsignedBigInteger('hub_shared_id')->nullable()->unique();
            $table->string('hub_status', 20)->nullable();
            $table->dateTime('hub_status_synced_at')->nullable();
            $table->unsignedBigInteger('from_hub_inspiration_id')->nullable()->unique();
            $table->string('from_hub_source_site_name', 100)->nullable();
            $table->timestamps();
        });

        return $capsule;
    }
}
