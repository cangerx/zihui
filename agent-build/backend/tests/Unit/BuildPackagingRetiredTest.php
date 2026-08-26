<?php

namespace Tests\Unit;

use App\Services\Build\BuildPackaging;
use PHPUnit\Framework\TestCase;

class BuildPackagingRetiredTest extends TestCase
{
    public function test_default_is_retired_without_env(): void
    {
        $prev = getenv('BUILD_PACKAGING_RETIRED');
        putenv('BUILD_PACKAGING_RETIRED');
        $this->assertTrue(BuildPackaging::retired());
        $this->assertSame('packaging_retired', BuildPackaging::gonePayload()['error']);
        if ($prev === false) {
            putenv('BUILD_PACKAGING_RETIRED');
        } else {
            putenv('BUILD_PACKAGING_RETIRED=' . $prev);
        }
    }

    public function test_false_env_reopens_packaging(): void
    {
        $prev = getenv('BUILD_PACKAGING_RETIRED');
        putenv('BUILD_PACKAGING_RETIRED=false');
        $this->assertFalse(BuildPackaging::retired());
        if ($prev === false) {
            putenv('BUILD_PACKAGING_RETIRED');
        } else {
            putenv('BUILD_PACKAGING_RETIRED=' . $prev);
        }
    }

    public function test_external_build_routes_and_cron_are_gated(): void
    {
        $api = file_get_contents(dirname(__DIR__, 2) . '/routes/api.php');
        $this->assertStringContainsString("prefix('build')->middleware('build_packaging')", $api);

        $admin = file_get_contents(dirname(__DIR__, 2) . '/routes/admin.php');
        $this->assertStringContainsString("middleware('build_packaging')", $admin);
        $unguarded = preg_replace('/Route::middleware\(\'build_packaging\'\)->group\(function \(\) \{.*?\n    \}\);/s', '', $admin);
        $this->assertStringNotContainsString("Route::get('requests'", $unguarded);
        $this->assertStringNotContainsString("Route::get('queue/status'", $unguarded);
        $this->assertStringContainsString("Route::get('clients'", $admin);
        $this->assertStringContainsString('inspiration-hub', $admin);

        $kernel = file_get_contents(dirname(__DIR__, 2) . '/app/Console/Kernel.php');
        $this->assertStringContainsString('BuildPackaging::retired()', $kernel);
        $this->assertStringContainsString('auth-log:prune', $kernel);

        $http = file_get_contents(dirname(__DIR__, 2) . '/app/Http/Kernel.php');
        $this->assertStringContainsString('RejectRetiredBuildPackaging', $http);

        foreach ([
            'BuildDispatchPendingCommand.php',
            'BuildWorker.php',
            'BuildAckTimeout.php',
            'BuildStuckDetector.php',
            'MirrorWatchdog.php',
        ] as $file) {
            $src = file_get_contents(dirname(__DIR__, 2) . '/app/Console/Commands/' . $file);
            $this->assertStringContainsString('BuildPackaging::retired()', $src);
        }

        $this->assertFileExists(dirname(__DIR__, 2) . '/app/Console/Commands/BuildExportLedger.php');
        $this->assertFileExists(dirname(__DIR__, 2) . '/app/Console/Commands/BuildCutover.php');
        $this->assertFileExists(dirname(__DIR__, 2) . '/app/Http/Controllers/Build/BuildRequestController.php');
    }

    public function test_frontend_hides_packaging_menu_and_keeps_clients(): void
    {
        $layout = file_get_contents(dirname(__DIR__, 3) . '/frontend/src/components/AppLayout.tsx');
        $this->assertStringNotContainsString("key: '/requests'", $layout);
        $this->assertStringNotContainsString("key: '/queue'", $layout);
        $this->assertStringContainsString("key: '/templates'", $layout);
        $this->assertStringContainsString("key: '/site-updates'", $layout);
        $this->assertStringContainsString("key: '/clients'", $layout);
        $this->assertStringContainsString('授权管理后台', $layout);

        $app = file_get_contents(dirname(__DIR__, 3) . '/frontend/src/App.tsx');
        $this->assertStringContainsString('<Navigate to="/" replace />', $app);
        $this->assertStringNotContainsString("from '@/pages/Requests'", $app);
        $this->assertStringNotContainsString('<RequestsPage', $app);

        $flag = file_get_contents(dirname(__DIR__, 3) . '/frontend/src/packagingRetired.ts');
        $this->assertStringContainsString('PACKAGING_RETIRED: boolean = true', $flag);
    }
}
