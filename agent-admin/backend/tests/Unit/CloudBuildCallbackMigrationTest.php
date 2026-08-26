<?php

namespace Tests\Unit;

use Tests\Support\CloudBuildExecutionHarness;
use PHPUnit\Framework\TestCase;

class CloudBuildCallbackMigrationTest extends TestCase
{
    public function test_callback_migration_up_and_down_on_sqlite(): void
    {
        $capsule = CloudBuildExecutionHarness::boot();
        $schema = $capsule->schema();

        $this->assertTrue($schema->hasColumn('cloud_build_jobs', 'callback_token'));
        $this->assertTrue($schema->hasColumn('cloud_build_jobs', 'icon_path'));
        $this->assertTrue($schema->hasColumn('cloud_build_jobs', 'release_tag'));
        $this->assertTrue($schema->hasColumn('cloud_build_jobs', 'release_assets'));
        $this->assertTrue($schema->hasColumn('cloud_build_clients', 'domain'));

        $m2 = include dirname(__DIR__, 2) . '/database/migrations/2026_08_22_000011_add_cloud_build_callback_fields.php';
        $m2->down();
        $this->assertFalse($schema->hasColumn('cloud_build_jobs', 'callback_token'));
        $this->assertFalse($schema->hasColumn('cloud_build_clients', 'domain'));
        $this->assertTrue($schema->hasTable('cloud_build_jobs'));

        $m1 = include dirname(__DIR__, 2) . '/database/migrations/2026_08_22_000010_create_cloud_build_execution_tables.php';
        $m1->down();
        $this->assertFalse($schema->hasTable('cloud_build_jobs'));
        $this->assertFalse($schema->hasTable('cloud_builds'));
    }

    public function test_original_execution_migration_file_is_unchanged_in_intent(): void
    {
        $file = dirname(__DIR__, 2) . '/database/migrations/2026_08_22_000010_create_cloud_build_execution_tables.php';
        $source = file_get_contents($file);
        $this->assertStringNotContainsString('callback_token', $source);
        $this->assertStringNotContainsString('release_assets', $source);
    }
}
