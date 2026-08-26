<?php

namespace Tests\Unit;

use App\Models\CloudBuildJob;
use App\Services\CloudBuild\AgentBuildClient;
use App\Services\CloudBuild\CloudBuildRemoteBackend;
use Tests\Support\FakeCloudBuildGitHubGateway;

class CloudBuildLocalBackendTest extends CloudBuildExecutionTestCase
{
    public function test_local_request_enqueues_without_agent_build_client(): void
    {
        $backend = $this->localBackend();
        $resp = $backend->requestBuild('DemoApp', 'win', 'https://admin.example.test/icon.png');

        $this->assertSame(200, $resp['_status']);
        $this->assertSame('queued', $resp['status']);
        $this->assertArrayHasKey('build_id', $resp);
        $this->assertArrayHasKey('app_version', $resp);
        $this->assertArrayHasKey('estimated_wait_seconds', $resp);
        $this->assertSame('0.0.0', $resp['app_version']);
        $this->assertSame(1, CloudBuildJob::query()->count());
        $this->assertSame('self', CloudBuildJob::query()->value('client_ref'));
        $this->assertSame('local', $resp['backend']);
    }

    public function test_auth_check_is_authorized_and_keeps_frontend_keys(): void
    {
        $resp = $this->localBackend()->checkAuth();
        $this->assertSame(200, $resp['_status']);
        $this->assertTrue($resp['authorized']);
        $this->assertFalse($resp['maintenance']);
        $this->assertFalse($resp['admin_version_too_low']);
        $this->assertArrayHasKey('daily_remaining', $resp);
        $this->assertArrayHasKey('daily_limit', $resp);
        $this->assertArrayHasKey('daily_used', $resp);
        $this->assertSame('local', $resp['backend']);
    }

    public function test_status_projects_internal_phase_to_frontend_success(): void
    {
        $backend = $this->localBackend();
        $queued = $backend->requestBuild('DemoApp', 'mac', 'https://admin.example.test/icon.png');
        $job = CloudBuildJob::query()->where('build_id', $queued['build_id'])->first();
        $this->claimer->transition($job, 'building', ['started_at' => now()]);
        $building = $backend->getStatus($queued['build_id']);
        $this->assertSame('building', $building['status']);

        $job = $job->fresh();
        $this->claimer->transition($job, 'artifact_pending', ['finished_at' => now()]);
        $readyish = $backend->getStatus($queued['build_id']);
        $this->assertSame('success', $readyish['status']);
        $this->assertNotSame('artifact_pending', $readyish['status']);
    }

    public function test_cancel_queued_job_refunds_quota(): void
    {
        $backend = $this->localBackend();
        $resp = $backend->requestBuild('DemoApp', 'win', 'https://admin.example.test/icon.png');
        $this->assertSame(1, $this->quota->getDailyCount('self', date('Y-m-d')));

        $cancel = $backend->cancel($resp['build_id']);
        $this->assertSame(200, $cancel['_status']);
        $this->assertSame('cancelled', CloudBuildJob::query()->value('phase'));
        $this->assertSame(0, $this->quota->getDailyCount('self', date('Y-m-d')));
    }

    public function test_cancel_force_skips_github(): void
    {
        $github = new FakeCloudBuildGitHubGateway();
        $github->configured = true;
        $backend = $this->localBackend($github);
        $github->configured = false;
        $resp = $backend->requestBuild('DemoApp', 'win', 'https://admin.example.test/icon.png');
        $job = CloudBuildJob::query()->where('build_id', $resp['build_id'])->first();
        $this->claimer->transition($job, 'building', ['executor_run_id' => 99, 'started_at' => now()]);
        $github->configured = true;

        $cancel = $backend->cancel($resp['build_id'], true);
        $this->assertSame(200, $cancel['_status']);
        $this->assertSame(0, $github->cancelCalls);
        $this->assertSame('cancelled', CloudBuildJob::query()->value('phase'));
    }

    public function test_my_info_does_not_block_new_build(): void
    {
        $resp = $this->localBackend()->getMyInfo();
        $this->assertSame(200, $resp['_status']);
        $this->assertFalse($resp['needs_completion']);
        $this->assertArrayHasKey('domain', $resp);
        $this->assertArrayHasKey('owner_name', $resp);
        $this->assertArrayHasKey('owner_phone', $resp);
    }

    public function test_template_info_keeps_current_version_key(): void
    {
        $resp = $this->localBackend()->templateInfo();
        $this->assertSame(200, $resp['_status']);
        $this->assertArrayHasKey('current_version', $resp);
        $this->assertArrayHasKey('changelog', $resp);
        $this->assertArrayHasKey('has_update', $resp);
    }

    public function test_remote_adapter_delegates_to_agent_build_client(): void
    {
        $sdk = $this->createMock(AgentBuildClient::class);
        $sdk->expects($this->once())->method('requestBuild')->with('App', 'win', 'https://x.test/i.png')->willReturn([
            '_status' => 200,
            'build_id' => '00000000-0000-4000-8000-000000000801',
            'app_version' => '1.2.3',
            'estimated_wait_seconds' => 12,
        ]);
        $backend = new CloudBuildRemoteBackend($sdk);
        $resp = $backend->requestBuild('App', 'win', 'https://x.test/i.png');
        $this->assertSame('00000000-0000-4000-8000-000000000801', $resp['build_id']);
        $this->assertSame('remote', $backend->driver());
    }

    public function test_remote_force_cancel_does_not_call_sdk(): void
    {
        $sdk = $this->createMock(AgentBuildClient::class);
        $sdk->expects($this->never())->method('cancel');
        $backend = new CloudBuildRemoteBackend($sdk);
        $resp = $backend->cancel('bid', true);
        $this->assertSame(200, $resp['_status']);
    }
}
