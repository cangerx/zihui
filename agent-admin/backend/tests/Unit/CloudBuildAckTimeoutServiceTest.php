<?php

namespace Tests\Unit;

use App\Models\CloudBuildJob;
use App\Services\CloudBuild\CloudBuildAckTimeoutService;
use Carbon\Carbon;

class CloudBuildAckTimeoutServiceTest extends CloudBuildExecutionTestCase
{
    public function test_artifact_pending_older_than_24h_becomes_failed(): void
    {
        $this->seedClient();
        $job = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000401']))->job;
        $this->claimer->transition($job, 'building', ['started_at' => Carbon::now()->subHours(26)]);
        $this->claimer->transition($job->fresh(), 'artifact_pending', [
            'finished_at' => Carbon::now()->subHours(25),
        ]);

        $stats = (new CloudBuildAckTimeoutService($this->claimer, $this->settings))->run();
        $this->assertSame(1, $stats['failed']);
        $this->assertSame('failed', $job->fresh()->phase);
        $this->assertSame('mirror_incomplete_24h_worker_likely_down', $job->fresh()->error_message);
    }

    public function test_ready_older_than_24h_becomes_expired(): void
    {
        $this->seedClient();
        $job = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000402']))->job;
        $this->claimer->transition($job, 'building', ['started_at' => Carbon::now()->subHours(30)]);
        $this->claimer->transition($job->fresh(), 'artifact_pending', ['finished_at' => Carbon::now()->subHours(29)]);
        $this->claimer->transition($job->fresh(), 'ready', ['finished_at' => Carbon::now()->subHours(25)]);

        $stats = (new CloudBuildAckTimeoutService($this->claimer, $this->settings))->run();
        $this->assertSame(1, $stats['expired']);
        $this->assertSame('expired', $job->fresh()->phase);
    }

    public function test_fresh_artifact_pending_is_untouched(): void
    {
        $this->seedClient();
        $job = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000403']))->job;
        $this->claimer->transition($job, 'building', ['started_at' => Carbon::now()]);
        $this->claimer->transition($job->fresh(), 'artifact_pending', ['finished_at' => Carbon::now()]);

        $stats = (new CloudBuildAckTimeoutService($this->claimer, $this->settings))->run();
        $this->assertSame(0, $stats['failed']);
        $this->assertSame('artifact_pending', CloudBuildJob::query()->value('phase'));
    }
}
