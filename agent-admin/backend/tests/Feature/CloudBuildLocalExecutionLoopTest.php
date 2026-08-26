<?php

namespace Tests\Feature;

use App\Models\CloudBuildArtifact;
use App\Models\CloudBuildJob;
use App\Services\CloudBuild\CloudBuildCallbackService;
use App\Services\CloudBuild\CloudBuildEnqueueService;
use App\Services\CloudBuild\CloudBuildExecutionSettings;
use App\Services\CloudBuild\CloudBuildJobClaimer;
use App\Services\CloudBuild\CloudBuildLocalDispatchService;
use App\Services\CloudBuild\CloudBuildQuotaService;
use App\Services\CloudBuild\CloudBuildStateMachine;
use App\Services\CloudBuild\PackagingLicense;
use App\Models\CloudBuildClient;
use Tests\Support\CloudBuildExecutionHarness;
use Tests\Support\FakeCloudBuildGitHubGateway;
use PHPUnit\Framework\TestCase;

class CloudBuildLocalExecutionLoopTest extends TestCase
{
    public function test_enqueue_dispatch_and_callback_reach_artifact_pending_without_agent_build(): void
    {
        CloudBuildExecutionHarness::boot();
        PackagingLicense::fake([
            'can_use_github_packaging' => true,
            'can_use_mac_packaging' => true,
        ]);

        CloudBuildClient::query()->create([
            'client_ref' => 'site-a',
            'domain' => 'https://admin.example.test',
            'daily_limit' => 5,
            'status' => 'active',
        ]);

        $quota = new CloudBuildQuotaService();
        $settings = new CloudBuildExecutionSettings();
        $claimer = new CloudBuildJobClaimer(new CloudBuildStateMachine());
        $enqueue = new CloudBuildEnqueueService($quota, $settings);
        $github = new FakeCloudBuildGitHubGateway();
        $dispatch = new CloudBuildLocalDispatchService($github, $claimer, $quota, $settings);
        $callback = new CloudBuildCallbackService($quota, new CloudBuildStateMachine());

        $queued = $enqueue->enqueue([
            'client_ref' => 'site-a',
            'platform' => 'mac',
            'app_name' => 'Loop',
            'build_id' => '00000000-0000-4000-8000-000000000701',
        ]);
        $this->assertTrue($queued->ok);

        $stats = $dispatch->dispatchPending();
        $this->assertSame(1, $stats['dispatched']);
        $this->assertSame(1, $github->dispatchCalls);
        $this->assertSame('building', CloudBuildJob::query()->value('phase'));

        $token = CloudBuildJob::query()->where('build_id', '00000000-0000-4000-8000-000000000701')->first()->callback_token;
        $result = $callback->handle($token, [
            'build_id' => '00000000-0000-4000-8000-000000000701',
            'run_id' => 9001,
            'status' => 'success',
            'artifact_storage' => 'github_release',
            'release_tag' => 'build-00000000-0000-4000-8000-000000000701',
            'files' => [[
                'filename' => 'Loop.dmg',
                'role' => 'primary',
                'asset_id' => 9,
                'asset_url' => 'https://api.github.com/repos/acme/repo/releases/assets/9',
                'size' => 42,
                'sha256' => str_repeat('cd', 32),
            ]],
        ]);

        $this->assertSame(200, $result['status']);
        $job = CloudBuildJob::query()->where('build_id', '00000000-0000-4000-8000-000000000701')->first();
        $this->assertSame('artifact_pending', $job->phase);
        $this->assertSame(9001, (int) $job->executor_run_id);
        $this->assertSame(1, CloudBuildArtifact::query()->count());
        $this->assertSame(1, $quota->getDailyCount('site-a', date('Y-m-d')));

        $controller = file_get_contents(dirname(__DIR__, 2) . '/app/Http/Controllers/CloudBuild/CloudBuildController.php');
        $this->assertStringContainsString('CloudBuildBackend $backend', $controller);
        $this->assertStringNotContainsString('AgentBuildClient $sdk', $controller);
    }
}
