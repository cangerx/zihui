<?php

namespace Tests\Unit;

use App\Models\CloudBuildArtifact;
use App\Models\CloudBuildJob;
use App\Services\CloudBuild\CloudBuildCallbackService;
use App\Services\CloudBuild\CloudBuildStateMachine;

class CloudBuildCallbackServiceTest extends CloudBuildExecutionTestCase
{
    public function test_wrong_token_is_rejected(): void
    {
        $this->seedClient();
        $job = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000301']))->job;
        $result = $this->callbackService()->handle('deadbeef', $this->successPayload($job->build_id));

        $this->assertSame(401, $result['status']);
        $this->assertSame('invalid_callback_token', $result['body']['error']);
        $this->assertSame('queued', $job->fresh()->phase);
    }

    public function test_missing_bearer_is_rejected(): void
    {
        $result = $this->callbackService()->handle('', ['build_id' => 'x']);
        $this->assertSame(401, $result['status']);
        $this->assertSame('missing_bearer', $result['body']['error']);
    }

    public function test_success_writes_artifacts_and_stops_at_artifact_pending(): void
    {
        $this->seedClient();
        $job = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000302']))->job;
        $this->claimer->claim($job->build_id, 'dispatch:test', 'queued');
        $this->claimer->transition($job->fresh(), 'building', ['started_at' => now(), 'claim_owner' => null]);

        $result = $this->callbackService()->handle($job->callback_token, $this->successPayload($job->build_id));
        $this->assertSame(200, $result['status']);
        $this->assertTrue($result['body']['ack']);

        $fresh = $job->fresh();
        $this->assertSame('artifact_pending', $fresh->phase);
        $this->assertSame('build-' . $job->build_id, $fresh->release_tag);
        $this->assertSame(1, $this->quota->getDailyCount('client-a', date('Y-m-d')));
        $this->assertSame(1, CloudBuildArtifact::query()->where('build_id', $job->build_id)->count());
    }

    public function test_replay_after_success_is_idempotent(): void
    {
        $this->seedClient();
        $job = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000303']))->job;
        $this->claimer->transition($job, 'building', ['started_at' => now()]);
        $service = $this->callbackService();
        $payload = $this->successPayload($job->build_id);
        $this->assertSame(200, $service->handle($job->callback_token, $payload)['status']);

        $replay = $service->handle($job->callback_token, $payload);
        $this->assertSame(200, $replay['status']);
        $this->assertTrue($replay['body']['idempotent']);
        $this->assertSame('artifact_pending', $job->fresh()->phase);
        $this->assertSame(1, CloudBuildArtifact::query()->count());
    }

    public function test_failure_refunds_quota_once(): void
    {
        $this->seedClient();
        $job = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000304']))->job;
        $this->claimer->transition($job, 'building', ['started_at' => now()]);
        $service = $this->callbackService();

        $fail = $service->handle($job->callback_token, [
            'build_id' => $job->build_id,
            'status' => 'failure',
            'error' => 'gha_failed',
            'run_id' => 99,
        ]);
        $this->assertSame(200, $fail['status']);
        $this->assertSame('failed', $job->fresh()->phase);
        $this->assertSame(0, $this->quota->getDailyCount('client-a', date('Y-m-d')));

        $replay = $service->handle($job->callback_token, [
            'build_id' => $job->build_id,
            'status' => 'failure',
            'error' => 'gha_failed_again',
        ]);
        $this->assertTrue($replay['body']['idempotent']);
        $this->assertSame(0, $this->quota->getDailyCount('client-a', date('Y-m-d')));
        $this->assertSame('gha_failed', $job->fresh()->error_message);
    }

    public function test_failure_without_error_uses_github_job_failed(): void
    {
        $this->seedClient();
        $job = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000306']))->job;
        $this->claimer->transition($job, 'building', ['started_at' => now()]);

        $result = $this->callbackService()->handle($job->callback_token, [
            'build_id' => $job->build_id,
            'status' => 'failed',
            'run_id' => 32614078218,
        ]);

        $this->assertSame(200, $result['status']);
        $fresh = $job->fresh();
        $this->assertSame('failed', $fresh->phase);
        $this->assertSame('github_job_failed', $fresh->error_message);
        $this->assertSame(32614078218, (int) $fresh->executor_run_id);
    }

    public function test_terminal_failed_cannot_resurrect_via_success_callback(): void
    {
        $this->seedClient();
        $job = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000305']))->job;
        $this->claimer->transition($job, 'failed', ['finished_at' => now()]);

        $result = $this->callbackService()->handle($job->callback_token, $this->successPayload($job->build_id));
        $this->assertTrue($result['body']['idempotent']);
        $this->assertSame('failed', $job->fresh()->phase);
        $this->assertSame(0, CloudBuildArtifact::query()->count());
    }

    private function callbackService(): CloudBuildCallbackService
    {
        return new CloudBuildCallbackService($this->quota, new CloudBuildStateMachine());
    }

    /**
     * @return array<string, mixed>
     */
    private function successPayload(string $buildId): array
    {
        return [
            'build_id' => $buildId,
            'run_id' => 4242,
            'status' => 'success',
            'artifact_storage' => 'github_release',
            'release_tag' => 'build-' . $buildId,
            'files' => [[
                'filename' => 'app-setup.exe',
                'role' => 'primary',
                'asset_id' => 1001,
                'asset_url' => 'https://api.github.com/repos/acme/repo/releases/assets/1001',
                'size' => 12,
                'sha256' => str_repeat('ab', 32),
            ]],
        ];
    }
}
