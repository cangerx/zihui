<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

class CloudBuildLegacyApiCompatTest extends TestCase
{
    public function test_cloud_build_controller_uses_backend_interface(): void
    {
        $controller = dirname(__DIR__, 2) . '/app/Http/Controllers/CloudBuild/CloudBuildController.php';
        $source = file_get_contents($controller);
        $this->assertNotFalse($source);
        $this->assertStringContainsString('CloudBuildBackend $backend', $source);
        $this->assertStringNotContainsString('AgentBuildClient $sdk', $source);
        $this->assertStringContainsString("DB::table('cloud_builds')", $source);
        $this->assertFileExists(dirname(__DIR__, 2) . '/app/Services/CloudBuild/AgentBuildClient.php');
        $remote = file_get_contents(dirname(__DIR__, 2) . '/app/Services/CloudBuild/CloudBuildRemoteBackend.php');
        $this->assertStringContainsString('AgentBuildClient $sdk', $remote);
    }

    public function test_oem_controller_still_exists_as_frontend_entry(): void
    {
        $controller = dirname(__DIR__, 2) . '/app/Http/Controllers/CloudBuild/OemProjectController.php';
        $this->assertFileExists($controller);
        $source = file_get_contents($controller);
        $this->assertStringContainsString('CloudBuildBackend', $source);
        $this->assertStringNotContainsString('AgentBuildClient $sdk', $source);
    }

    public function test_new_migration_has_matching_down(): void
    {
        $file = dirname(__DIR__, 2) . '/database/migrations/2026_08_22_000010_create_cloud_build_execution_tables.php';
        $source = file_get_contents($file);
        $this->assertNotFalse($source);
        foreach ([
            'cloud_build_clients',
            'cloud_build_templates',
            'cloud_build_quotas',
            'cloud_build_jobs',
            'cloud_build_attempts',
            'cloud_build_artifacts',
        ] as $table) {
            $this->assertStringContainsString("Schema::hasTable('{$table}')", $source);
            $this->assertStringContainsString("Schema::dropIfExists('{$table}')", $source);
        }
        $this->assertStringNotContainsString('Schema::dropIfExists(\'cloud_builds\')', $source);
        $this->assertStringNotContainsString('Schema::dropIfExists(\'oem_builds\')', $source);
    }

    public function test_callback_route_is_separate_from_wake(): void
    {
        $routes = file_get_contents(dirname(__DIR__, 2) . '/routes/api.php');
        $this->assertStringContainsString("post('/build/wake'", $routes);
        $this->assertStringContainsString("post('/cloud-build/callback'", $routes);
        $this->assertStringContainsString('CloudBuildCallbackController', $routes);
    }

    public function test_kernel_schedules_local_execution_without_removing_pull(): void
    {
        $kernel = file_get_contents(dirname(__DIR__, 2) . '/app/Console/Kernel.php');
        $this->assertStringContainsString("cloud-build:pull --once", $kernel);
        $this->assertStringContainsString('cloud-build:dispatch-pending', $kernel);
        $this->assertStringContainsString('cloud-build:ack-timeout', $kernel);
        $this->assertStringContainsString('cloud-build:stuck-detector', $kernel);
        $this->assertStringContainsString('cloud-build:fetch-artifacts', $kernel);
        $this->assertStringContainsString('cloud-build:cleanup-orphans', $kernel);
        $this->assertStringContainsString("cloud-build:pull --once", $kernel);
    }

    public function test_kernel_does_not_schedule_ledger_import(): void
    {
        $kernel = file_get_contents(dirname(__DIR__, 2) . '/app/Console/Kernel.php');
        $this->assertStringNotContainsString('cloud-build:import-ledger', $kernel);
        $this->assertStringNotContainsString('cloud-build:reconcile-ledger', $kernel);
        $this->assertStringNotContainsString('cloud-build:export-ledger', $kernel);
        $this->assertStringNotContainsString('cloud-build:cutover', $kernel);
        $this->assertFileExists(dirname(__DIR__, 2) . '/app/Console/Commands/CloudBuildImportLedger.php');
        $this->assertFileExists(dirname(__DIR__, 2) . '/app/Console/Commands/CloudBuildReconcileLedger.php');
        $this->assertFileExists(dirname(__DIR__, 2) . '/app/Console/Commands/CloudBuildCutover.php');
    }

    public function test_mirror_and_download_routes_exist_without_replacing_wake(): void
    {
        $routes = file_get_contents(dirname(__DIR__, 2) . '/routes/api.php');
        $this->assertStringContainsString("post('/build/wake'", $routes);
        $this->assertStringContainsString("cloud-build/mirror", $routes);
        $this->assertStringContainsString("cloud-build/dl/{token}", $routes);
        $this->assertStringContainsString('mirror_worker', $routes);
    }
}
