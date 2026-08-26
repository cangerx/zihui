<?php

namespace Tests\Unit;

use App\Services\CloudBuild\CloudBuildArtifactStore;
use App\Services\CloudBuild\CloudBuildDownloadCatalogService;
use App\Services\CloudBuild\CloudBuildExecutionSettings;
use App\Services\CloudBuild\CloudBuildPurgeService;
use App\Services\CloudBuild\CloudBuildSignatureService;
use App\Models\CloudBuildArtifact;
use App\Models\CloudBuildJob;

class CloudBuildSignatureAndPurgeTest extends CloudBuildExecutionTestCase
{
    private string $root;

    protected function setUp(): void
    {
        parent::setUp();
        $this->root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cb-sig-' . bin2hex(random_bytes(4));
        mkdir($this->root, 0755, true);
        $this->settings = new CloudBuildExecutionSettings(
            storageRoot: $this->root,
            signSecret: 'test-sign-secret',
            downloadTtlSeconds: 1800,
            downloadBaseUrl: 'https://example.test/api/cloud-build/dl',
        );
    }

    protected function tearDown(): void
    {
        foreach (['00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000902'] as $id) {
            (new CloudBuildArtifactStore($this->root))->purgeBuild($id);
        }
        @rmdir($this->root);
        parent::tearDown();
    }

    public function test_expired_and_tampered_signatures_are_rejected(): void
    {
        $sig = new CloudBuildSignatureService($this->settings);
        $ok = $sig->generate('00000000-0000-4000-8000-000000000901', 'client-a', 'app.exe');
        $this->assertNotNull($ok);
        $this->assertNotNull($sig->verify($ok['token']));

        $short = new CloudBuildSignatureService(new CloudBuildExecutionSettings(
            signSecret: 'test-sign-secret',
            downloadTtlSeconds: 1,
        ));
        $soon = $short->generate('00000000-0000-4000-8000-000000000901', 'client-a', 'app.exe');
        $this->assertNotNull($soon);
        $payload = json_decode(base64_decode(strtr($soon['token'], '-_', '+/')), true);
        $payload['exp'] = time() - 10;
        $payload['sig'] = hash_hmac('sha256', $payload['bid'] . $payload['cid'] . $payload['exp'] . $payload['fn'], 'test-sign-secret');
        $expired = rtrim(strtr(base64_encode(json_encode($payload)), '+/', '-_'), '=');
        $this->assertNull($sig->verify($expired));

        $tampered = $ok['token'] . 'x';
        $this->assertNull($sig->verify($tampered));
    }

    public function test_token_cannot_read_another_build_file(): void
    {
        $this->seedClient();
        $store = new CloudBuildArtifactStore($this->root);
        $a = '00000000-0000-4000-8000-000000000901';
        $b = '00000000-0000-4000-8000-000000000902';
        $this->readyJob($a, 'alpha-bytes', $store);
        $this->readyJob($b, 'beta-bytes-xx', $store);

        $catalog = new CloudBuildDownloadCatalogService(new CloudBuildSignatureService($this->settings), $store);
        $tokenA = $catalog->catalog($a)['body']['primary']['url'];
        $tokenA = basename($tokenA);
        $resolved = $catalog->resolveFile($tokenA);
        $this->assertSame(200, $resolved['status']);
        $this->assertSame('alpha-bytes', file_get_contents($resolved['path']));
        $this->assertStringContainsString($a, $resolved['path']);
        $this->assertStringNotContainsString($b, $resolved['path']);
    }

    public function test_purge_one_build_does_not_delete_another(): void
    {
        $this->seedClient();
        $store = new CloudBuildArtifactStore($this->root);
        $a = '00000000-0000-4000-8000-000000000901';
        $b = '00000000-0000-4000-8000-000000000902';
        $jobA = $this->readyJob($a, 'aaa', $store);
        $jobB = $this->readyJob($b, 'bbb', $store);
        $purge = new CloudBuildPurgeService($this->claimer, $store);
        $this->claimer->transition($jobA->fresh(), 'delivered', ['delivered_at' => now()]);
        $purge->markPurged($jobA->fresh());

        $this->assertFalse(is_dir($store->buildDir($a)));
        $this->assertFileExists($store->finalPath($b, 'app.exe'));
        $this->assertSame('ready', $jobB->fresh()->phase);
    }

    public function test_orphan_cleanup_skips_ready_dirs(): void
    {
        $this->seedClient();
        $store = new CloudBuildArtifactStore($this->root);
        $readyId = '00000000-0000-4000-8000-000000000901';
        $this->readyJob($readyId, 'keep-me', $store);
        $orphan = '00000000-0000-4000-8000-000000000999';
        $store->ensureBuildDir($orphan);
        file_put_contents($store->finalPath($orphan, 'junk.bin'), 'x');

        $purge = new CloudBuildPurgeService($this->claimer, $store);
        $stats = $purge->cleanupOrphans(2);
        $this->assertGreaterThanOrEqual(1, $stats['purged_dirs']);
        $this->assertFileExists($store->finalPath($readyId, 'app.exe'));
        $this->assertFalse(is_dir($store->buildDir($orphan)));
    }

    private function readyJob(string $buildId, string $body, CloudBuildArtifactStore $store): CloudBuildJob
    {
        $job = $this->enqueueService()->enqueue($this->enqueueInput(['build_id' => $buildId]))->job;
        $this->claimer->transition($job, 'building', ['started_at' => now()]);
        $this->claimer->transition($job->fresh(), 'artifact_pending', ['finished_at' => now()]);
        $path = $store->finalPath($buildId, 'app.exe');
        $store->ensureBuildDir($buildId);
        file_put_contents($path, $body);
        CloudBuildArtifact::query()->create([
            'build_id' => $buildId,
            'filename' => 'app.exe',
            'role' => 'primary',
            'size' => strlen($body),
            'sha256' => hash('sha256', $body),
            'storage_path' => $path,
        ]);
        $this->claimer->transition($job->fresh(), 'ready', ['mirror_url_primary' => $path]);
        return $job->fresh();
    }
}
