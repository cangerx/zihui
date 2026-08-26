<?php

namespace Tests\Unit;

use App\Services\CloudBuild\CloudBuildStuckDetectorService;
use Carbon\Carbon;
use Tests\Support\FakeCloudBuildGitHubGateway;

class CloudBuildStuckDetectorServiceTest extends CloudBuildExecutionTestCase
{
    public function test_stuck_building_without_run_id_fails_and_refunds(): void
    {
        $this->seedClient();
        $job = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000501']))->job;
        $this->claimer->transition($job, 'building', [
            'started_at' => Carbon::now()->subMinutes(21),
        ]);
        $this->assertSame(1, $this->quota->getDailyCount('client-a', date('Y-m-d')));

        $github = new FakeCloudBuildGitHubGateway();
        $stats = (new CloudBuildStuckDetectorService($github, $this->claimer, $this->quota, $this->settings))->run();

        $this->assertSame(1, $stats['failed']);
        $this->assertSame(0, $github->cancelCalls);
        $this->assertSame('failed', $job->fresh()->phase);
        $this->assertSame('stuck_no_run_id', $job->fresh()->error_message);
        $this->assertSame(0, $this->quota->getDailyCount('client-a', date('Y-m-d')));
    }

    public function test_stuck_building_cancels_github_run(): void
    {
        $this->seedClient();
        $job = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000502']))->job;
        $this->claimer->transition($job, 'building', [
            'started_at' => Carbon::now()->subMinutes(91),
            'executor_run_id' => 777,
        ]);

        $github = new FakeCloudBuildGitHubGateway();
        $github->runsById[777] = [
            'id' => 777,
            'status' => 'in_progress',
            'conclusion' => null,
            'html_url' => 'https://github.com/example/run/777',
        ];
        $stats = (new CloudBuildStuckDetectorService($github, $this->claimer, $this->quota, $this->settings))->run();

        $this->assertSame(1, $stats['cancelled']);
        $this->assertSame(777, $github->lastCancelRunId);
        $this->assertSame('cancelled', $job->fresh()->phase);
        $this->assertSame(0, $this->quota->getDailyCount('client-a', date('Y-m-d')));
    }

    public function test_building_without_run_id_adopts_completed_github_failure(): void
    {
        $this->seedClient();
        $job = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000503']))->job;
        $this->claimer->transition($job, 'building', [
            'started_at' => Carbon::now()->subMinutes(5),
            'dispatched_at' => Carbon::now()->subMinutes(5),
        ]);

        $github = new FakeCloudBuildGitHubGateway();
        $github->recentRun = [
            'id' => 32614078218,
            'status' => 'completed',
            'conclusion' => 'failure',
            'html_url' => 'https://github.com/example/run/32614078218',
        ];
        $stats = (new CloudBuildStuckDetectorService($github, $this->claimer, $this->quota, $this->settings))->run();

        $this->assertSame(1, $stats['failed']);
        $this->assertSame(0, $github->cancelCalls);
        $fresh = $job->fresh();
        $this->assertSame('failed', $fresh->phase);
        $this->assertSame('github_run_failure', $fresh->error_message);
        $this->assertSame(32614078218, (int) $fresh->executor_run_id);
        $this->assertSame(0, $this->quota->getDailyCount('client-a', date('Y-m-d')));
    }

    public function test_in_progress_run_inside_window_is_not_cancelled(): void
    {
        $this->seedClient();
        $job = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000504']))->job;
        $this->claimer->transition($job, 'building', [
            'started_at' => Carbon::now()->subMinutes(30),
            'executor_run_id' => 888,
        ]);

        $github = new FakeCloudBuildGitHubGateway();
        $github->runsById[888] = [
            'id' => 888,
            'status' => 'in_progress',
            'conclusion' => null,
            'html_url' => 'https://github.com/example/run/888',
        ];
        $stats = (new CloudBuildStuckDetectorService($github, $this->claimer, $this->quota, $this->settings))->run();

        $this->assertSame(1, $stats['skipped']);
        $this->assertSame(0, $github->cancelCalls);
        $this->assertSame('building', $job->fresh()->phase);
        $this->assertSame(1, $this->quota->getDailyCount('client-a', date('Y-m-d')));
    }

    public function test_recent_building_without_run_is_not_marked_stuck_yet(): void
    {
        $this->seedClient();
        $job = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000505']))->job;
        $this->claimer->transition($job, 'building', [
            'started_at' => Carbon::now()->subMinutes(5),
        ]);

        $github = new FakeCloudBuildGitHubGateway();
        $stats = (new CloudBuildStuckDetectorService($github, $this->claimer, $this->quota, $this->settings))->run();

        $this->assertSame(1, $stats['skipped']);
        $this->assertSame('building', $job->fresh()->phase);
        $this->assertNull($job->fresh()->error_message);
    }
}
