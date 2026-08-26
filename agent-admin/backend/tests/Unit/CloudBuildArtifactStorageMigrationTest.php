<?php

namespace Tests\Unit;

use Tests\Support\CloudBuildExecutionHarness;
use PHPUnit\Framework\TestCase;

class CloudBuildArtifactStorageMigrationTest extends TestCase
{
    public function test_storage_migration_up_and_down_on_sqlite(): void
    {
        $capsule = CloudBuildExecutionHarness::boot();
        $schema = $capsule->schema();
        $this->assertTrue($schema->hasColumn('cloud_build_jobs', 'mirror_assigned_at'));
        $this->assertTrue($schema->hasColumn('cloud_build_artifacts', 'storage_path'));

        $m3 = include dirname(__DIR__, 2) . '/database/migrations/2026_08_22_000012_add_cloud_build_artifact_storage_fields.php';
        $m3->down();
        $this->assertFalse($schema->hasColumn('cloud_build_jobs', 'mirror_assigned_at'));
        $this->assertFalse($schema->hasColumn('cloud_build_artifacts', 'storage_path'));
        $this->assertTrue($schema->hasColumn('cloud_build_jobs', 'callback_token'));
    }

    public function test_prior_migrations_were_not_rewritten(): void
    {
        $m10 = file_get_contents(dirname(__DIR__, 2) . '/database/migrations/2026_08_22_000010_create_cloud_build_execution_tables.php');
        $m11 = file_get_contents(dirname(__DIR__, 2) . '/database/migrations/2026_08_22_000011_add_cloud_build_callback_fields.php');
        $this->assertStringNotContainsString('storage_path', $m10);
        $this->assertStringNotContainsString('storage_path', $m11);
    }
}
