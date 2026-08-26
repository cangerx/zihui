<?php

namespace Tests\Unit;

use App\Models\CloudBuildArtifact;
use App\Models\CloudBuildJob;
use App\Services\CloudBuild\CloudBuildPhaseNormalizer;
use App\Services\CloudBuild\UpdateDirService;
use Illuminate\Support\Facades\DB;

class CloudBuildLocalDeliveryServiceTest extends CloudBuildExecutionTestCase
{
    public function test_ready_job_places_from_storage_path_without_agent_build(): void
    {
        $this->installProjectionTables();
        $src = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cb-art-' . uniqid('', true) . '.exe';
        file_put_contents($src, 'hello-artifact');

        $this->localBackend()->requestBuild('DemoApp', 'win', 'https://admin.example.test/icon.png');
        $job = CloudBuildJob::query()->first();
        $this->claimer->transition($job, 'building', ['started_at' => now()]);
        $this->claimer->transition($job->fresh(), 'artifact_pending', ['finished_at' => now()]);
        $this->claimer->transition($job->fresh(), 'ready');

        CloudBuildArtifact::query()->create([
            'build_id' => $job->build_id,
            'filename' => 'DemoApp.exe',
            'role' => 'primary',
            'size' => 14,
            'sha256' => str_repeat('ab', 32),
            'storage_path' => $src,
        ]);

        $now = now();
        DB::table('cloud_builds')->insert([
            'build_id' => $job->build_id,
            'platform' => 'win',
            'app_name' => 'DemoApp',
            'app_version' => '0.0.0',
            'icon_path' => 'https://admin.example.test/icon.png',
            'status' => 'success',
            'filename' => 'DemoApp.exe',
            'queued_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $dir = $this->createMock(UpdateDirService::class);
        $dir->expects($this->once())->method('atomicReplaceMany')->willReturn([
            'ok' => true,
            'placed' => [[
                'filename' => 'DemoApp.exe',
                'stored_path' => 'updates/DemoApp.exe',
                'absolute_path' => '/tmp/DemoApp.exe',
            ]],
        ]);

        $result = $this->localDelivery($dir)->deliver('cloud_builds', $job->build_id);
        $this->assertSame('delivered', $result['outcome']);
        $this->assertSame('just_delivered', $result['message']);
        $this->assertSame('delivered', DB::table('cloud_builds')->value('status'));
        $this->assertSame('updates/DemoApp.exe', DB::table('cloud_builds')->value('stored_path'));
        $this->assertSame(CloudBuildPhaseNormalizer::PHASE_DELIVERED, CloudBuildJob::query()->value('phase'));
        $this->assertFileExists($src);
        @unlink($src);
    }

    public function test_queued_job_stays_in_progress(): void
    {
        $this->installProjectionTables();
        $resp = $this->localBackend()->requestBuild('DemoApp', 'win', 'https://admin.example.test/icon.png');
        $now = now();
        DB::table('cloud_builds')->insert([
            'build_id' => $resp['build_id'],
            'platform' => 'win',
            'app_name' => 'DemoApp',
            'app_version' => '0.0.0',
            'status' => 'queued',
            'queued_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $result = $this->localDelivery()->deliver('cloud_builds', $resp['build_id']);
        $this->assertSame('in_progress', $result['outcome']);
        $this->assertSame('queued', DB::table('cloud_builds')->value('status'));
    }

    public function test_failed_job_with_queued_projection_does_not_resurrect(): void
    {
        $this->installProjectionTables();
        $resp = $this->localBackend()->requestBuild('DemoApp', 'win', 'https://admin.example.test/icon.png');
        $job = CloudBuildJob::query()->where('build_id', $resp['build_id'])->first();
        $this->assertNotNull($job);
        $this->claimer->transition($job, 'failed', [
            'error_message' => 'github_dispatch_forbidden',
            'finished_at' => now(),
        ]);
        $jobId = (int) $job->id;
        $now = now();
        DB::table('cloud_builds')->insert([
            'build_id' => $resp['build_id'],
            'platform' => 'win',
            'app_name' => 'DemoApp',
            'app_version' => '0.0.0',
            'status' => 'queued',
            'queued_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $result = $this->localDelivery()->deliver('cloud_builds', $resp['build_id']);
        $this->assertSame('failed', $result['outcome']);
        $this->assertSame('github_dispatch_forbidden', $result['message']);
        $this->assertSame($jobId, (int) CloudBuildJob::query()->where('build_id', $resp['build_id'])->value('id'));
        $this->assertSame('failed', CloudBuildJob::query()->where('build_id', $resp['build_id'])->value('phase'));
        $this->assertSame('failed', DB::table('cloud_builds')->value('status'));
        $this->assertSame(1, CloudBuildJob::query()->count());
    }

    public function test_requeue_rebuilds_queued_job_and_clears_attempts(): void
    {
        $this->installProjectionTables();
        $resp = $this->localBackend()->requestBuild('DemoApp', 'win', 'https://admin.example.test/icon.png');
        $job = CloudBuildJob::query()->where('build_id', $resp['build_id'])->first();
        $this->assertNotNull($job);
        $job->dispatch_attempts = 3;
        $job->save();
        $this->claimer->transition($job->fresh(), 'failed', [
            'error_message' => 'github_dispatch_forbidden',
            'finished_at' => now(),
        ]);
        $oldId = (int) $job->id;
        $now = now();
        DB::table('cloud_builds')->insert([
            'build_id' => $resp['build_id'],
            'platform' => 'win',
            'app_name' => 'DemoApp',
            'app_version' => '0.0.0',
            'status' => 'failed',
            'error_message' => 'github_dispatch_forbidden',
            'queued_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $result = $this->localDelivery()->requeue('cloud_builds', $resp['build_id']);
        $this->assertContains($result['outcome'], ['in_progress', 'failed']);
        $fresh = CloudBuildJob::query()->where('build_id', $resp['build_id'])->first();
        $this->assertNotNull($fresh);
        $this->assertNotSame($oldId, (int) $fresh->id);
        $this->assertSame('queued', $fresh->phase);
        $this->assertSame(0, (int) $fresh->dispatch_attempts);
        $this->assertSame('queued', DB::table('cloud_builds')->value('status'));
    }

    public function test_requeue_refetches_existing_release_without_dispatch(): void
    {
        $this->installProjectionTables();
        $body = 'installer-bytes';
        $resp = $this->localBackend()->requestBuild('DemoApp', 'win', 'https://admin.example.test/icon.png');
        $job = CloudBuildJob::query()->where('build_id', $resp['build_id'])->first();
        $this->assertNotNull($job);
        $url = 'https://api.github.com/assets/803';
        $job->release_assets = [[
            'filename' => 'app.exe',
            'asset_id' => 803,
            'asset_url' => $url,
            'size' => strlen($body),
            'sha256' => hash('sha256', $body),
            'role' => 'primary',
        ]];
        $job->save();
        $this->claimer->transition($job->fresh(), 'building', ['started_at' => now()]);
        $this->claimer->transition($job->fresh(), 'artifact_pending', ['finished_at' => now()]);
        CloudBuildArtifact::query()->create([
            'build_id' => $job->build_id,
            'filename' => 'app.exe',
            'role' => 'primary',
            'size' => strlen($body),
            'sha256' => hash('sha256', $body),
            'fetch_attempts' => 3,
        ]);
        $this->claimer->transition($job->fresh(), 'failed', [
            'error_message' => 'sha256_mismatch_after_3_attempts',
            'finished_at' => now(),
        ]);
        $oldId = (int) $job->id;
        $now = now();
        DB::table('cloud_builds')->insert([
            'build_id' => $job->build_id,
            'platform' => 'win',
            'app_name' => 'DemoApp',
            'app_version' => '1.3.0',
            'status' => 'failed',
            'agent_build_url' => 'local://' . $job->build_id,
            'error_message' => 'sha256_mismatch_after_3_attempts',
            'queued_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $github = new \Tests\Support\FakeCloudBuildGitHubGateway();
        $github->configured = true;
        $github->downloadBodies[$url] = $body;
        $dir = $this->createMock(UpdateDirService::class);
        $dir->expects($this->once())->method('atomicReplaceMany')->willReturn([
            'ok' => true,
            'placed' => [[
                'filename' => 'app.exe',
                'stored_path' => 'updates/app.exe',
                'absolute_path' => '/tmp/app.exe',
            ]],
        ]);

        $svc = $this->localDelivery($dir, $github);
        $github->configured = true;
        $result = $svc->requeue('cloud_builds', $job->build_id);
        $this->assertSame('delivered', $result['outcome']);
        $fresh = CloudBuildJob::query()->where('build_id', $job->build_id)->first();
        $this->assertNotNull($fresh);
        $this->assertSame($oldId, (int) $fresh->id);
        $this->assertSame(0, $github->dispatchCalls);
        $this->assertSame(CloudBuildPhaseNormalizer::PHASE_DELIVERED, $fresh->phase);
    }
}
