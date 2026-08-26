<?php

namespace Tests\Unit;

use App\Models\CloudBuildJob;
use App\Services\CloudBuild\CloudBuildExecutionSettings;

class CloudBuildEnqueueServiceTest extends CloudBuildExecutionTestCase
{
    public function test_enqueue_consumes_quota_and_issues_callback_token(): void
    {
        $this->seedClient();
        $result = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000101']));

        $this->assertTrue($result->ok);
        $this->assertSame('queued', $result->job->phase);
        $this->assertSame(64, strlen((string) $result->job->callback_token));
        $this->assertSame(1, $this->quota->getDailyCount('client-a', date('Y-m-d')));
    }

    public function test_quota_exceeded(): void
    {
        $this->seedClient('client-a', 1);
        $this->quota->incrDailyCount('client-a', date('Y-m-d'));

        $again = $this->enqueueService()->enqueue($this->enqueueInput([
            'build_id' => '00000000-0000-4000-8000-000000000103',
        ]));
        $this->assertFalse($again->ok);
        $this->assertSame('quota_exceeded', $again->error);
        $this->assertSame(429, $again->httpStatus);
        $this->assertSame(0, CloudBuildJob::query()->count());
    }

    public function test_client_busy_for_same_mode(): void
    {
        $this->seedClient();
        $this->assertTrue($this->enqueueService()->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000104']))->ok);

        $busy = $this->enqueueService()->enqueue($this->enqueueInput([
            'build_id' => '00000000-0000-4000-8000-000000000105',
            'platform' => 'mac',
        ]));
        $this->assertSame('client_busy', $busy->error);
        $this->assertSame(409, $busy->httpStatus);
    }

    public function test_queue_full(): void
    {
        $this->seedClient('client-a', 10);
        $this->seedClient('client-b', 10);
        $settings = new CloudBuildExecutionSettings(queueMaxDepth: 1);
        $first = $this->enqueueService($settings)->enqueue($this->enqueueInput(['build_id' => '00000000-0000-4000-8000-000000000106']));
        $this->assertTrue($first->ok);

        $full = $this->enqueueService($settings)->enqueue($this->enqueueInput([
            'client_ref' => 'client-b',
            'build_id' => '00000000-0000-4000-8000-000000000107',
        ]));
        $this->assertSame('queue_full', $full->error);
        $this->assertSame(429, $full->httpStatus);
    }
}
