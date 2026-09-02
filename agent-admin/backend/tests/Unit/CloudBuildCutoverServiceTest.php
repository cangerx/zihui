<?php

namespace Tests\Unit;

use App\Models\CloudBuildJob;
use App\Services\CloudBuild\CloudBuildCutoverService;
use App\Services\CloudBuild\CloudBuildCutoverStore;
use App\Services\CloudBuild\CloudBuildLocalDispatchService;
use Tests\Support\FakeCloudBuildGitHubGateway;

class CloudBuildCutoverServiceTest extends CloudBuildExecutionTestCase
{
    private string $path;
    private CloudBuildCutoverStore $store;
    private CloudBuildCutoverService $cutover;

    protected function setUp(): void
    {
        parent::setUp();
        $this->path = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cb-cutover-' . bin2hex(random_bytes(4)) . '.json';
        $this->store = new CloudBuildCutoverStore($this->path);
        $this->cutover = new CloudBuildCutoverService($this->store);
    }

    protected function tearDown(): void
    {
        foreach ([$this->path, $this->path . '.tmp'] as $path) {
            if (is_file($path) || is_link($path)) {
                unlink($path);
            }
        }
        parent::tearDown();
    }

    public function test_freeze_blocks_enqueue_and_sets_auth_maintenance(): void
    {
        $this->seedClient();
        $this->cutover->freeze();

        $blocked = $this->enqueueService(null, $this->store)->enqueue($this->enqueueInput([
            'build_id' => '00000000-0000-4000-8000-000000000c01',
        ]));
        $this->assertFalse($blocked->ok);
        $this->assertSame('maintenance_mode', $blocked->error);
        $this->assertSame(0, CloudBuildJob::query()->count());

        $auth = $this->localBackend(null, $this->store)->checkAuth();
        $this->assertTrue($auth['maintenance']);
        $this->assertTrue($auth['authorized']);
        $this->assertArrayHasKey('daily_remaining', $auth);
    }

    public function test_drain_fails_while_in_flight_then_succeeds_after_terminal(): void
    {
        $this->seedClient();
        $this->enqueueService()->enqueue($this->enqueueInput([
            'build_id' => '00000000-0000-4000-8000-000000000c02',
        ]));

        $still = $this->cutover->drain(0);
        $this->assertFalse($still['ok']);
        $this->assertSame(1, $still['count']);
        $this->assertSame(['queued' => 1], $still['by_phase']);

        $job = CloudBuildJob::query()->where('build_id', '00000000-0000-4000-8000-000000000c02')->first();
        $this->claimer->transition($job, 'cancelled', ['finished_at' => now()]);

        $done = $this->cutover->drain(0);
        $this->assertTrue($done['ok']);
        $this->assertSame(0, $done['count']);
    }

    public function test_pause_workers_skips_dispatch_and_mirror_claim(): void
    {
        $this->seedClient();
        $this->enqueueService()->enqueue($this->enqueueInput([
            'build_id' => '00000000-0000-4000-8000-000000000c03',
        ]));
        $this->cutover->pauseWorkers();

        $github = new FakeCloudBuildGitHubGateway();
        $stats = (new CloudBuildLocalDispatchService(
            $github,
            $this->claimer,
            $this->quota,
            $this->settings,
            $this->store
        ))->dispatchPending();
        $this->assertSame(0, $stats['dispatched']);
        $this->assertSame(0, $github->dispatchCalls);
        $this->assertSame('queued', CloudBuildJob::query()->value('phase'));

        $job = CloudBuildJob::query()->first();
        $this->claimer->transition($job, 'building', ['started_at' => now()]);
        $this->claimer->transition($job->fresh(), 'artifact_pending', ['finished_at' => now()]);
        $mirror = new \App\Services\CloudBuild\CloudBuildMirrorWorkerService(
            $this->claimer,
            $this->quota,
            new \App\Services\CloudBuild\CloudBuildPurgeService(
                $this->claimer,
                new \App\Services\CloudBuild\CloudBuildArtifactStore(sys_get_temp_dir())
            ),
            $this->settings,
            $this->store
        );
        $pending = $mirror->pending();
        $this->assertSame([], $pending['body']['items']);
        $this->assertTrue($pending['body']['paused']);
    }

    public function test_successful_switch_then_midway_rollback(): void
    {
        $this->seedClient();
        $this->cutover->freeze();
        $this->cutover->pauseWorkers();
        $this->cutover->recordCursor('00000000-0000-4000-8000-000000000c09', '2026-08-22 12:00:00');

        $pre = $this->cutover->health('pre-switch', [
            'github_token' => true,
            'github_repo' => true,
            'callback_url' => true,
        ], 'auto', 'production');
        $this->assertTrue($pre['ok']);
        $this->assertSame('remote', $pre['mode']);

        $switched = $this->cutover->switchBackend('local', 'auto', 'production');
        $this->assertTrue($switched['ok']);
        $this->assertSame('local', $switched['mode']);
        $this->cutover->resumeWorkers();

        $post = $this->cutover->health('post-switch', [
            'github_token' => true,
            'github_repo' => true,
            'callback_url' => true,
        ], 'auto', 'production');
        $this->assertTrue($post['ok']);
        $this->assertSame('local', $post['mode']);

        $this->cutover->unfreeze();
        $opened = $this->enqueueService(null, $this->store)->enqueue($this->enqueueInput([
            'build_id' => '00000000-0000-4000-8000-000000000c04',
        ]));
        $this->assertTrue($opened->ok);
        $job = $opened->job;
        $this->claimer->transition($job, 'building', ['started_at' => now()]);

        $rolled = $this->cutover->rollback('auto', 'production');
        $this->assertTrue($rolled['ok']);
        $this->assertSame('remote', $rolled['mode']);
        $this->assertTrue($rolled['state']['new_requests_frozen']);
        $this->assertFalse($rolled['state']['workers_paused']);
        $this->assertSame(1, $rolled['leftover']['count']);
        $this->assertContains('00000000-0000-4000-8000-000000000c04', $rolled['leftover']['build_ids']);
        $this->assertSame('building', CloudBuildJob::query()->value('phase'));

        $after = $this->cutover->health('post-rollback', [], 'auto', 'production');
        $this->assertTrue($after['ok']);
        $this->assertSame('remote', $after['mode']);

        $stateJson = (string) file_get_contents($this->path);
        $this->assertStringNotContainsString('token', strtolower($stateJson));
        $this->assertStringNotContainsString('secret', strtolower($stateJson));
        $this->assertStringNotContainsString('github', strtolower($stateJson));
    }

    public function test_explicit_env_blocks_switch_and_state_file_has_no_secrets(): void
    {
        $blocked = $this->cutover->switchBackend('local', 'remote', 'production');
        $this->assertFalse($blocked['ok']);
        $this->assertSame('explicit_env_locks_backend', $blocked['stop']);

        $this->cutover->freeze();
        $raw = json_decode((string) file_get_contents($this->path), true);
        $this->assertIsArray($raw);
        foreach (array_keys($raw) as $key) {
            $this->assertDoesNotMatchRegularExpression('/token|secret|password|url|path/i', (string) $key);
        }
    }

    public function test_pre_switch_health_fails_when_not_drained(): void
    {
        $this->seedClient();
        $this->enqueueService()->enqueue($this->enqueueInput([
            'build_id' => '00000000-0000-4000-8000-000000000c05',
        ]));
        $this->cutover->freeze();
        $this->cutover->pauseWorkers();

        $report = $this->cutover->health('pre-switch', [
            'github_token' => true,
            'github_repo' => true,
            'callback_url' => true,
        ], 'auto', 'production');
        $this->assertFalse($report['ok']);
        $this->assertContains('not_drained', $report['stop_conditions']);
    }
}
