<?php

namespace Tests\Unit;

use App\Services\CloudBuild\CloudBuildPhaseNormalizer;
use PHPUnit\Framework\TestCase;

class CloudBuildPhaseNormalizerTest extends TestCase
{
    public function test_pending_and_queued_collapse_to_queued(): void
    {
        $this->assertSame('queued', CloudBuildPhaseNormalizer::fromSource('pending', null));
        $this->assertSame('queued', CloudBuildPhaseNormalizer::fromSource('queued', null));
    }

    public function test_success_mirror_states_follow_ledger(): void
    {
        $this->assertSame('artifact_pending', CloudBuildPhaseNormalizer::fromSource('success', 'pending'));
        $this->assertSame('artifact_pending', CloudBuildPhaseNormalizer::fromSource('success', 'mirroring'));
        $this->assertSame('ready', CloudBuildPhaseNormalizer::fromSource('success', 'mirrored'));
        $this->assertSame('legacy_ready_or_unknown', CloudBuildPhaseNormalizer::fromSource('success', null));
    }

    public function test_terminal_statuses_keep_their_names(): void
    {
        $this->assertSame('delivered', CloudBuildPhaseNormalizer::fromSource('delivered', 'mirrored'));
        $this->assertSame('failed', CloudBuildPhaseNormalizer::fromSource('failed', 'failed'));
        $this->assertSame('cancelled', CloudBuildPhaseNormalizer::fromSource('cancelled', null));
        $this->assertSame('expired', CloudBuildPhaseNormalizer::fromSource('expired', null));
        $this->assertSame('purged', CloudBuildPhaseNormalizer::fromSource('purged', 'purged'));
    }

    public function test_ledger_fixture_phases_match_verify_script(): void
    {
        $path = dirname(__DIR__, 3) . '/docs/contracts/cloud-build-migration/fixture.json';
        $fixture = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);

        foreach ($fixture['source'] as $index => $row) {
            $phase = CloudBuildPhaseNormalizer::fromSource($row['status'], $row['mirror_status']);
            $this->assertSame(
                $fixture['target'][$index]['phase'],
                $phase,
                'fixture source[' . $index . '] phase mismatch'
            );
        }
    }
}
