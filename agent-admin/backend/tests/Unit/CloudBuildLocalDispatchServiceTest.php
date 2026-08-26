<?php

namespace Tests\Unit;

use App\Models\CloudBuildAttempt;
use App\Models\CloudBuildJob;
use App\Services\CloudBuild\CloudBuildExecutionSettings;
use App\Services\CloudBuild\CloudBuildLocalDispatchService;
use Tests\Support\FakeCloudBuildGitHubGateway;

class CloudBuildLocalDispatchServiceTest extends CloudBuildExecutionTestCase
{
    public function test_dispatch_moves_queued_job_to_building(): void
    {
        $this->seedClient();
        $enqueued = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000201']));
        $github = new FakeCloudBuildGitHubGateway();
        $dispatch = $this->dispatchService($github);

        $stats = $dispatch->dispatchPending();
        $this->assertSame(1, $stats['dispatched']);
        $this->assertSame(1, $github->dispatchCalls);
        $this->assertSame('building', CloudBuildJob::query()->where('build_id', '00000000-0000-4000-8000-000000000201')->value('phase'));
        $this->assertSame($enqueued->job->callback_token, $github->lastInputs['callback_token']);
        $this->assertSame('https://example.test/api/cloud-build/callback', $github->lastInputs['callback_url']);
        $this->assertSame(1, CloudBuildAttempt::query()->count());
        $this->assertSame('.build-icons/00000000-0000-4000-8000-000000000201.png', $github->lastInputs['icon_path']);
        $this->assertSame('https://admin.example.test/icon.png', $github->lastInputs['icon_url']);
        $this->assertNull(CloudBuildJob::query()->where('build_id', '00000000-0000-4000-8000-000000000201')->value('executor_run_id'));
    }

    public function test_dispatch_attaches_recent_github_run_id(): void
    {
        $this->seedClient();
        $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000207']));
        $github = new FakeCloudBuildGitHubGateway();
        $github->recentRun = [
            'id' => 4242,
            'status' => 'queued',
            'conclusion' => null,
            'html_url' => 'https://github.com/example/run/4242',
        ];

        $this->assertSame(1, $this->dispatchService($github)->dispatchPending()['dispatched']);
        $this->assertSame(4242, (int) CloudBuildJob::query()->where('build_id', '00000000-0000-4000-8000-000000000207')->value('executor_run_id'));
    }

    public function test_second_worker_skips_already_claimed_job(): void
    {
        $this->seedClient();
        $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000202']));
        $this->claimer->claim('00000000-0000-4000-8000-000000000202', 'worker-a', 'queued');

        $github = new FakeCloudBuildGitHubGateway();
        $outcome = $this->dispatchService($github)->dispatchOne('00000000-0000-4000-8000-000000000202', 'worker-b');
        $this->assertSame(CloudBuildLocalDispatchService::OUTCOME_SKIPPED, $outcome);
        $this->assertSame(0, $github->dispatchCalls);
        $this->assertSame('queued', CloudBuildJob::query()->where('build_id', '00000000-0000-4000-8000-000000000202')->value('phase'));
    }

    public function test_three_failed_dispatches_mark_failed_and_refund_quota(): void
    {
        $this->seedClient();
        $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000203']));
        $this->assertSame(1, $this->quota->getDailyCount('client-a', date('Y-m-d')));

        $github = new FakeCloudBuildGitHubGateway();
        $github->dispatchResult = false;
        $dispatch = $this->dispatchService($github);

        $this->assertSame('retried', $dispatch->dispatchOne('00000000-0000-4000-8000-000000000203', 'w1'));
        $this->assertSame('retried', $dispatch->dispatchOne('00000000-0000-4000-8000-000000000203', 'w1'));
        $this->assertSame('failed', $dispatch->dispatchOne('00000000-0000-4000-8000-000000000203', 'w1'));

        $job = CloudBuildJob::query()->where('build_id', '00000000-0000-4000-8000-000000000203')->first();
        $this->assertSame('failed', $job->phase);
        $this->assertSame(3, (int) $job->dispatch_attempts);
        $this->assertSame(0, $this->quota->getDailyCount('client-a', date('Y-m-d')));
    }

    public function test_github_not_configured_dispatches_nothing(): void
    {
        $this->seedClient();
        $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000204']));
        $github = new FakeCloudBuildGitHubGateway();
        $github->configured = false;
        $stats = $this->dispatchService($github)->dispatchPending();
        $this->assertSame(0, $stats['dispatched']);
        $this->assertSame('queued', CloudBuildJob::query()->value('phase'));
    }

    public function test_forbidden_dispatch_fails_on_first_attempt(): void
    {
        $this->seedClient();
        $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000205']));
        $github = new FakeCloudBuildGitHubGateway();
        $github->dispatchResult = false;
        $github->dispatchError = 'github_dispatch_forbidden';

        $outcome = $this->dispatchService($github)->dispatchOne('00000000-0000-4000-8000-000000000205', 'w1');
        $this->assertSame(CloudBuildLocalDispatchService::OUTCOME_FAILED, $outcome);
        $job = CloudBuildJob::query()->where('build_id', '00000000-0000-4000-8000-000000000205')->first();
        $this->assertSame('failed', $job->phase);
        $this->assertSame(1, (int) $job->dispatch_attempts);
        $this->assertSame('github_dispatch_forbidden', $job->error_message);
        $this->assertSame(1, $github->dispatchCalls);
        $this->assertSame(0, $this->quota->getDailyCount('client-a', date('Y-m-d')));
    }

    public function test_workflow_not_found_dispatch_fails_on_first_attempt(): void
    {
        $this->seedClient();
        $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000206']));
        $github = new FakeCloudBuildGitHubGateway();
        $github->dispatchResult = false;
        $github->dispatchError = 'github_workflow_not_found';

        $outcome = $this->dispatchService($github)->dispatchOne('00000000-0000-4000-8000-000000000206', 'w1');
        $this->assertSame(CloudBuildLocalDispatchService::OUTCOME_FAILED, $outcome);
        $job = CloudBuildJob::query()->where('build_id', '00000000-0000-4000-8000-000000000206')->first();
        $this->assertSame('failed', $job->phase);
        $this->assertSame('github_workflow_not_found', $job->error_message);
        $this->assertSame(1, $github->dispatchCalls);
    }

    private function dispatchService(FakeCloudBuildGitHubGateway $github): CloudBuildLocalDispatchService
    {
        return new CloudBuildLocalDispatchService(
            $github,
            $this->claimer,
            $this->quota,
            new CloudBuildExecutionSettings()
        );
    }
}
