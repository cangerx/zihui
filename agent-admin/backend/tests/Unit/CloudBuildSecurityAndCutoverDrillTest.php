<?php

namespace Tests\Unit;

use App\Models\CloudBuildJob;
use App\Services\CloudBuild\CloudBuildCallbackService;
use App\Services\CloudBuild\CloudBuildCutoverService;
use App\Services\CloudBuild\CloudBuildCutoverStore;
use App\Services\CloudBuild\CloudBuildJobClaimer;
use App\Services\CloudBuild\CloudBuildLedgerCanonical;
use App\Services\CloudBuild\CloudBuildLedgerFile;
use App\Services\CloudBuild\CloudBuildStateMachine;
use App\Services\CloudBuild\CloudBuildStuckDetectorService;
use Carbon\Carbon;
use Tests\Support\FakeCloudBuildGitHubGateway;

/**
 * T6.2 打包半边高风险演练：并发、重放、中断、回滚、脱敏。
 */
class CloudBuildSecurityAndCutoverDrillTest extends CloudBuildExecutionTestCase
{
    public function test_concurrent_claim_replay_interrupt_rollback_and_redaction(): void
    {
        $this->seedClient();
        $claimer = new CloudBuildJobClaimer(new CloudBuildStateMachine());
        $callback = new CloudBuildCallbackService($this->quota, new CloudBuildStateMachine());

        $queued = $this->enqueueService()->enqueue($this->enqueueInput([
            'build_id' => '00000000-0000-4000-8000-000000000d01',
        ]))->job;
        $this->assertNotNull($claimer->claim($queued->build_id, 'worker-a', 'queued'));
        $this->assertNull($claimer->claim($queued->build_id, 'worker-b', 'queued'));
        $this->assertSame('worker-a', $queued->fresh()->claim_owner);

        $claimer->transition($queued->fresh(), 'building', [
            'started_at' => now(),
            'claim_owner' => null,
        ]);
        $payload = [
            'build_id' => $queued->build_id,
            'run_id' => 7101,
            'status' => 'success',
            'artifact_storage' => 'github_release',
            'release_tag' => 'build-' . $queued->build_id,
            'files' => [[
                'filename' => 'app.exe',
                'role' => 'primary',
                'asset_id' => 1,
                'asset_url' => 'https://api.github.com/repos/acme/repo/releases/assets/1',
                'size' => 8,
                'sha256' => str_repeat('ab', 32),
            ]],
        ];
        $token = (string) $queued->fresh()->callback_token;
        $this->assertSame(200, $callback->handle($token, $payload)['status']);
        $replay = $callback->handle($token, $payload);
        $this->assertTrue($replay['body']['idempotent']);
        $this->assertSame('artifact_pending', $queued->fresh()->phase);
        $claimer->transition($queued->fresh(), 'failed', ['finished_at' => now()]);

        $stuck = $this->enqueueService()->enqueue($this->enqueueInput([
            'build_id' => '00000000-0000-4000-8000-000000000d02',
            'platform' => 'mac',
        ]))->job;
        $claimer->transition($stuck, 'building', [
            'started_at' => Carbon::now()->subMinutes(21),
        ]);
        $github = new FakeCloudBuildGitHubGateway();
        $stats = (new CloudBuildStuckDetectorService($github, $claimer, $this->quota, $this->settings))->run();
        $this->assertSame(1, $stats['failed']);
        $this->assertSame('failed', $stuck->fresh()->phase);
        $resurrect = $callback->handle((string) $stuck->fresh()->callback_token, [
            'build_id' => $stuck->build_id,
            'status' => 'success',
            'files' => [],
        ]);
        $this->assertTrue($resurrect['body']['idempotent']);
        $this->assertSame('failed', $stuck->fresh()->phase);

        $path = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cb-drill-' . bin2hex(random_bytes(4)) . '.json';
        $store = new CloudBuildCutoverStore($path);
        $cutover = new CloudBuildCutoverService($store);
        $opened = $this->enqueueService(null, $store)->enqueue($this->enqueueInput([
            'build_id' => '00000000-0000-4000-8000-000000000d03',
            'platform' => 'win',
        ]));
        $this->assertTrue($opened->ok);
        $inflight = $opened->job;
        $originalToken = (string) $inflight->callback_token;
        $claimer->transition($inflight, 'building', ['started_at' => now()]);
        $cutover->freeze();
        $cutover->pauseWorkers();
        $this->assertTrue($cutover->switchBackend('local', 'auto', 'production')['ok']);
        $rolled = $cutover->rollback('auto', 'production');
        $this->assertTrue($rolled['ok']);
        $this->assertSame('remote', $rolled['mode']);
        $this->assertTrue($rolled['state']['new_requests_frozen']);
        $this->assertContains('00000000-0000-4000-8000-000000000d03', $rolled['leftover']['build_ids']);
        $this->assertSame($originalToken, CloudBuildJob::query()->where('build_id', $inflight->build_id)->value('callback_token'));
        $this->assertSame('building', $inflight->fresh()->phase);
        $stateJson = (string) file_get_contents($path);
        $this->assertStringNotContainsString($originalToken, $stateJson);
        $this->assertDoesNotMatchRegularExpression('/ghp_|github_pat_|BEGIN [A-Z ]*PRIVATE KEY/', $stateJson);
        foreach ([$path, $path . '.tmp'] as $cleanupPath) {
            if (is_file($cleanupPath) || is_link($cleanupPath)) {
                unlink($cleanupPath);
            }
        }

        $planted = 'PLANTED_CALLBACK_' . str_repeat('deadbeef', 4);
        $packed = CloudBuildLedgerFile::pack([[
            'build_id' => '00000000-0000-4000-8000-000000000d09',
            'client_ref' => 'client-a',
            'platform' => 'win',
            'build_mode' => 'normal',
            'status' => 'success',
            'mirror_status' => 'mirroring',
            'dispatch_attempts' => 1,
            'callback_token' => $planted,
            'mirror_url_primary' => 'https://cdn.example/secret.exe',
            'artifacts' => [[
                'filename' => 'app.exe',
                'role' => 'primary',
                'size' => 1,
                'sha256' => str_repeat('aa', 32),
                'asset_url' => 'https://api.github.com/secret-asset',
            ]],
        ]]);
        $encoded = json_encode($packed);
        $this->assertIsString($encoded);
        $this->assertStringNotContainsString($planted, $encoded);
        $this->assertStringNotContainsString('cdn.example/secret.exe', $encoded);
        $this->assertStringNotContainsString('secret-asset', $encoded);
        $this->assertArrayNotHasKey('callback_token', $packed['jobs'][0]);
        $this->assertSame(CloudBuildLedgerCanonical::FORMAT, $packed['format']);
    }

    public function test_contract_fixture_has_no_live_credential_values(): void
    {
        $root = dirname(__DIR__, 2) . '/../docs/contracts/cloud-build-migration';
        foreach (['fixture.json', 'frontend-api.fixture.json', 'README.md', 'runbook-cutover.md', 'runbook-export-import.md', 'runbook-retire.md'] as $name) {
            $text = (string) file_get_contents($root . '/' . $name);
            $this->assertDoesNotMatchRegularExpression('/github_pat_[A-Za-z0-9_]+/', $text, $name);
            $this->assertDoesNotMatchRegularExpression('/ghp_[A-Za-z0-9]{20,}/', $text, $name);
            $this->assertDoesNotMatchRegularExpression('/-----BEGIN [A-Z ]*PRIVATE KEY-----/', $text, $name);
            $this->assertDoesNotMatchRegularExpression('/AKIA[0-9A-Z]{16}/', $text, $name);
        }
    }
}
