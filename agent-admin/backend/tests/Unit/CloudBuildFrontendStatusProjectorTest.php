<?php

namespace Tests\Unit;

use App\Services\CloudBuild\CloudBuildFrontendStatusProjector;
use PHPUnit\Framework\TestCase;

class CloudBuildFrontendStatusProjectorTest extends TestCase
{
    public function test_internal_phases_map_to_existing_frontend_statuses(): void
    {
        $projector = new CloudBuildFrontendStatusProjector();

        $this->assertSame('queued', $projector->fromPhase('queued'));
        $this->assertSame('building', $projector->fromPhase('building'));
        $this->assertSame('success', $projector->fromPhase('artifact_pending'));
        $this->assertSame('success', $projector->fromPhase('ready'));
        $this->assertSame('success', $projector->fromPhase('legacy_ready_or_unknown'));
        $this->assertSame('delivered', $projector->fromPhase('delivered'));
        $this->assertSame('failed', $projector->fromPhase('failed'));
        $this->assertSame('cancelled', $projector->fromPhase('cancelled'));
        $this->assertSame('expired', $projector->fromPhase('expired'));
        $this->assertSame('purged', $projector->fromPhase('purged'));
        $this->assertSame('downloading', $projector->fromPhase('ready', 'downloading'));
    }

    public function test_projected_values_are_known_to_existing_ui(): void
    {
        $projector = new CloudBuildFrontendStatusProjector();
        foreach (['queued', 'building', 'artifact_pending', 'ready', 'delivered', 'failed', 'cancelled', 'expired', 'purged', 'legacy_ready_or_unknown'] as $phase) {
            $status = $projector->fromPhase($phase);
            $this->assertContains($status, CloudBuildFrontendStatusProjector::FRONTEND_STATUSES);
            $this->assertNotSame('artifact_pending', $status);
            $this->assertNotSame('ready', $status);
            $this->assertNotSame('legacy_ready_or_unknown', $status);
        }
    }
}
