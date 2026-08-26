<?php

namespace Tests\Unit;

use App\Services\Build\BuildCutoverInFlight;
use App\Services\Build\BuildDispatchPause;
use PHPUnit\Framework\TestCase;

class BuildCutoverInFlightTest extends TestCase
{
    public function test_classifies_in_flight_rows_for_drain(): void
    {
        $this->assertTrue(BuildCutoverInFlight::isInFlight('pending', null));
        $this->assertTrue(BuildCutoverInFlight::isInFlight('queued', null));
        $this->assertTrue(BuildCutoverInFlight::isInFlight('building', null));
        $this->assertTrue(BuildCutoverInFlight::isInFlight('success', 'pending'));
        $this->assertTrue(BuildCutoverInFlight::isInFlight('success', 'mirroring'));
        $this->assertFalse(BuildCutoverInFlight::isInFlight('success', 'mirrored'));
        $this->assertFalse(BuildCutoverInFlight::isInFlight('delivered', null));
        $this->assertFalse(BuildCutoverInFlight::isInFlight('failed', null));
        $this->assertFalse(BuildCutoverInFlight::isInFlight('cancelled', null));
    }

    public function test_pause_key_is_shared_and_cutover_is_not_scheduled(): void
    {
        $this->assertSame('agent-build:dispatch_paused', BuildDispatchPause::CACHE_KEY);

        $queue = file_get_contents(dirname(__DIR__, 2) . '/app/Http/Controllers/Admin/QueueAdminController.php');
        $this->assertStringContainsString('BuildDispatchPause::CACHE_KEY', $queue);
        $this->assertStringContainsString('BuildDispatchPause::pause()', $queue);
        $this->assertStringContainsString('BuildDispatchPause::resume()', $queue);

        $dispatch = file_get_contents(dirname(__DIR__, 2) . '/app/Console/Commands/BuildDispatchPendingCommand.php');
        $this->assertStringContainsString('BuildDispatchPause::paused()', $dispatch);

        $mirror = file_get_contents(dirname(__DIR__, 2) . '/app/Http/Controllers/Build/MirrorWorkerController.php');
        $this->assertStringContainsString('BuildDispatchPause::paused()', $mirror);

        $kernel = file_get_contents(dirname(__DIR__, 2) . '/app/Console/Kernel.php');
        $this->assertStringNotContainsString('build:cutover', $kernel);
        $this->assertStringNotContainsString('build:export-ledger', $kernel);
        $this->assertFileExists(dirname(__DIR__, 2) . '/app/Console/Commands/BuildCutover.php');
    }
}
