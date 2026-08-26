<?php

namespace Tests\Unit;

use App\Models\CloudBuildArtifact;
use App\Models\CloudBuildJob;
use App\Services\CloudBuild\CloudBuildArtifactFetchService;
use App\Services\CloudBuild\CloudBuildArtifactStore;
use App\Services\CloudBuild\CloudBuildExecutionSettings;
use Tests\Support\FakeCloudBuildGitHubGateway;

class CloudBuildArtifactFetchServiceTest extends CloudBuildExecutionTestCase
{
    private string $root;

    protected function setUp(): void
    {
        parent::setUp();
        $this->root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cb-fetch-' . bin2hex(random_bytes(4));
        mkdir($this->root, 0755, true);
        $this->settings = new CloudBuildExecutionSettings(storageRoot: $this->root, signSecret: 'test-sign-secret');
    }

    protected function tearDown(): void
    {
        $this->rmTree($this->root);
        parent::tearDown();
    }

    public function test_fetch_verifies_sha_and_reaches_ready(): void
    {
        $body = 'installer-bytes';
        $job = $this->pendingJob('00000000-0000-4000-8000-000000000801', $body);
        $github = new FakeCloudBuildGitHubGateway();
        $github->downloadBodies['https://api.github.com/assets/801'] = $body;

        $outcome = $this->fetch($github)->fetchOne($job->build_id, 'fetch-a');
        $this->assertSame('fetched', $outcome);
        $this->assertSame('ready', $job->fresh()->phase);
        $artifact = CloudBuildArtifact::query()->where('build_id', $job->build_id)->first();
        $this->assertFileExists($artifact->storage_path);
        $this->assertSame(hash('sha256', $body), $artifact->sha256);
        $this->assertSame(1, $github->downloadCalls);
    }

    public function test_interrupted_download_resumes(): void
    {
        $body = 'ABCDEFGHIJKLMNOP';
        $job = $this->pendingJob('00000000-0000-4000-8000-000000000802', $body);
        $github = new FakeCloudBuildGitHubGateway();
        $github->downloadBodies['https://api.github.com/assets/802'] = $body;
        $github->maxBytesPerCall = 5;

        $this->assertSame('retried', $this->fetch($github)->fetchOne($job->build_id, 'fetch-a'));
        $this->assertSame('artifact_pending', $job->fresh()->phase);
        $part = (new CloudBuildArtifactStore($this->root))->partPath($job->build_id, 'app.exe');
        $this->assertFileExists($part);
        $this->assertSame(5, filesize($part));

        $github->maxBytesPerCall = 1000;
        $this->assertSame('fetched', $this->fetch($github)->fetchOne($job->build_id, 'fetch-a'));
        $this->assertSame('ready', $job->fresh()->phase);
        $this->assertSame($body, file_get_contents(
            CloudBuildArtifact::query()->where('build_id', $job->build_id)->value('storage_path')
        ));
        $this->assertGreaterThanOrEqual(2, $github->downloadCalls);
    }

    public function test_sha_mismatch_deletes_partial_and_fails_after_retries(): void
    {
        $job = $this->pendingJob('00000000-0000-4000-8000-000000000803', 'expected-body');
        $github = new FakeCloudBuildGitHubGateway();
        $github->downloadBodies['https://api.github.com/assets/803'] = 'tampered';
        $this->settings = new CloudBuildExecutionSettings(
            storageRoot: $this->root,
            fetchMaxAttempts: 2,
        );

        $fetch = $this->fetch($github);
        $this->assertSame('retried', $fetch->fetchOne($job->build_id, 'fetch-a'));
        $this->assertSame('failed', $fetch->fetchOne($job->build_id, 'fetch-a'));
        $this->assertSame('failed', $job->fresh()->phase);
        $this->assertFalse(is_dir((new CloudBuildArtifactStore($this->root))->buildDir($job->build_id)));
        $this->assertSame(0, $this->quota->getDailyCount('client-a', date('Y-m-d')));
    }

    public function test_worker_token_skips_local_fetch(): void
    {
        $this->pendingJob('00000000-0000-4000-8000-000000000804', 'x');
        $this->settings = new CloudBuildExecutionSettings(storageRoot: $this->root, workerToken: 'worker-token');
        $github = new FakeCloudBuildGitHubGateway();
        $stats = $this->fetch($github)->fetchPending();
        $this->assertSame(0, $stats['fetched']);
        $this->assertSame(0, $github->downloadCalls);
    }

    private function fetch(FakeCloudBuildGitHubGateway $github): CloudBuildArtifactFetchService
    {
        return new CloudBuildArtifactFetchService(
            $github,
            $this->claimer,
            $this->quota,
            new CloudBuildArtifactStore($this->root),
            $this->settings
        );
    }

    private function pendingJob(string $buildId, string $body, string $filename = 'app.exe'): CloudBuildJob
    {
        $this->seedClient();
        $job = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => $buildId]))->job;
        $this->claimer->transition($job, 'building', ['started_at' => now()]);
        $this->claimer->transition($job->fresh(), 'artifact_pending', ['finished_at' => now()]);
        $url = 'https://api.github.com/assets/' . substr($buildId, -3);
        CloudBuildArtifact::query()->create([
            'build_id' => $buildId,
            'filename' => $filename,
            'role' => 'primary',
            'size' => strlen($body),
            'sha256' => hash('sha256', $body),
        ]);
        $job->release_assets = [[
            'filename' => $filename,
            'asset_url' => $url,
            'role' => 'primary',
            'size' => strlen($body),
            'sha256' => hash('sha256', $body),
        ]];
        $job->save();
        return $job->fresh();
    }

    private function rmTree(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }
        foreach (scandir($dir) ?: [] as $name) {
            if ($name === '.' || $name === '..') {
                continue;
            }
            $path = $dir . DIRECTORY_SEPARATOR . $name;
            is_dir($path) ? $this->rmTree($path) : @unlink($path);
        }
        @rmdir($dir);
    }
}
