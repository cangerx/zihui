<?php

namespace Tests\Unit;

use App\Models\CloudBuildJob;
use App\Services\CloudBuild\CloudBuildArtifactStore;
use App\Services\CloudBuild\CloudBuildExecutionSettings;
use App\Services\CloudBuild\CloudBuildMirrorAuth;
use App\Services\CloudBuild\CloudBuildMirrorWorkerService;
use App\Services\CloudBuild\CloudBuildPurgeService;

class CloudBuildMirrorWorkerServiceTest extends CloudBuildExecutionTestCase
{
    private string $root;

    protected function setUp(): void
    {
        parent::setUp();
        $this->root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cb-mw-' . bin2hex(random_bytes(4));
        mkdir($this->root, 0755, true);
        $this->settings = new CloudBuildExecutionSettings(storageRoot: $this->root, workerToken: 'worker-token');
    }

    protected function tearDown(): void
    {
        (new CloudBuildArtifactStore($this->root))->purgeBuild('00000000-0000-4000-8000-000000000a01');
        @rmdir($this->root);
        parent::tearDown();
    }

    public function test_wrong_token_is_rejected(): void
    {
        $this->assertSame(401, CloudBuildMirrorAuth::check('Bearer nope', 'worker-token')['status']);
        $this->assertSame(401, CloudBuildMirrorAuth::check('', 'worker-token')['status']);
        $this->assertSame(503, CloudBuildMirrorAuth::check('Bearer worker-token', '')['status']);
        $this->assertTrue(CloudBuildMirrorAuth::check('Bearer worker-token', 'worker-token')['ok']);
    }

    public function test_ack_makes_ready_and_fail_refunds_once(): void
    {
        $this->seedClient();
        $buildId = '00000000-0000-4000-8000-000000000a01';
        $job = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => $buildId]))->job;
        $this->claimer->transition($job, 'building', ['started_at' => now()]);
        $this->claimer->transition($job->fresh(), 'artifact_pending', ['finished_at' => now()]);

        $service = $this->worker();
        $pending = $service->pending();
        $this->assertCount(1, $pending['body']['items']);
        $again = $service->pending();
        $this->assertCount(0, $again['body']['items']);

        $ack = $service->ack($buildId, ['mirror_url_primary' => 'https://cdn.example.test/app.exe']);
        $this->assertSame(200, $ack['status']);
        $this->assertSame('ready', CloudBuildJob::query()->value('phase'));
        $replay = $service->ack($buildId, ['mirror_url_primary' => 'https://cdn.example.test/app.exe']);
        $this->assertTrue($replay['body']['idempotent']);
    }

    public function test_fail_is_idempotent_and_refunds_once(): void
    {
        $this->seedClient();
        $buildId = '00000000-0000-4000-8000-000000000a01';
        $job = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => $buildId]))->job;
        $this->claimer->transition($job, 'building', ['started_at' => now()]);
        $this->claimer->transition($job->fresh(), 'artifact_pending', ['finished_at' => now()]);
        $this->assertSame(1, $this->quota->getDailyCount('client-a', date('Y-m-d')));

        $service = $this->worker();
        $this->assertSame(200, $service->fail($buildId, ['error' => 'boom'])['status']);
        $this->assertSame(0, $this->quota->getDailyCount('client-a', date('Y-m-d')));
        $replay = $service->fail($buildId, ['error' => 'boom-again']);
        $this->assertTrue($replay['body']['idempotent']);
        $this->assertSame(0, $this->quota->getDailyCount('client-a', date('Y-m-d')));
    }

    private function worker(): CloudBuildMirrorWorkerService
    {
        $store = new CloudBuildArtifactStore($this->root);
        return new CloudBuildMirrorWorkerService(
            $this->claimer,
            $this->quota,
            new CloudBuildPurgeService($this->claimer, $store),
            $this->settings
        );
    }
}
