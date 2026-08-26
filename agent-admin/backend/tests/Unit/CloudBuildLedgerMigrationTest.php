<?php

namespace Tests\Unit;

use App\Models\CloudBuildJob;
use App\Models\CloudBuildQuota;
use App\Services\CloudBuild\CloudBuildLedgerCanonical;
use App\Services\CloudBuild\CloudBuildLedgerFile;
use App\Services\CloudBuild\CloudBuildLedgerImportService;
use App\Services\CloudBuild\CloudBuildLedgerReconcileService;
use InvalidArgumentException;

class CloudBuildLedgerMigrationTest extends CloudBuildExecutionTestCase
{
    public function test_canonical_digest_matches_contract_fixture(): void
    {
        $fixture = $this->contractFixture();
        $digest = CloudBuildLedgerCanonical::digest($fixture['source'], true);
        $this->assertSame(
            CloudBuildLedgerCanonical::digest($fixture['target'], false),
            $digest
        );
        $this->assertSame(
            '4e93e4f0e827f30669f86bbc90910571bbaef4c80c8e7bddecdb2aa3830add05',
            $digest
        );
    }

    public function test_import_is_idempotent_and_reconcile_has_zero_hard_diff(): void
    {
        $file = $this->packedLedger();
        $import = new CloudBuildLedgerImportService();
        $first = $import->import($file);
        $second = $import->import($file);

        $this->assertSame(6, $first['imported']);
        $this->assertSame(0, $second['imported']);
        $this->assertSame(6, $second['updated']);
        $this->assertSame(6, CloudBuildJob::query()->count());
        $this->assertSame(3, (int) CloudBuildQuota::query()->where('client_ref', 'client-a')->value('consumed'));
        $this->assertSame(2, (int) CloudBuildQuota::query()->where('client_ref', 'client-b')->value('consumed'));

        $report = (new CloudBuildLedgerReconcileService())->reconcile($file);
        $this->assertTrue($report['ok'], json_encode($report['hard_diffs']));
        $this->assertSame([], $report['hard_diffs']);
        $this->assertSame(2, $report['source_terminal']);
    }

    public function test_interrupted_import_resumes_from_build_id_cursor(): void
    {
        $file = $this->packedLedger();
        $import = new CloudBuildLedgerImportService();
        $batch1 = $import->import($file, '', 3);
        $this->assertTrue($batch1['has_more']);
        $this->assertSame(3, CloudBuildJob::query()->count());

        $batch2 = $import->import($file, (string) $batch1['next_after_build_id'], 3);
        $this->assertFalse($batch2['has_more']);
        $this->assertSame(6, CloudBuildJob::query()->count());

        $report = (new CloudBuildLedgerReconcileService())->reconcile($file);
        $this->assertTrue($report['ok'], json_encode($report['hard_diffs']));
    }

    public function test_tampered_payload_is_rejected(): void
    {
        $file = $this->packedLedger();
        $file['jobs'][2]['artifacts'][0]['sha256'] = str_repeat('ee', 32);
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('canonical_sha256_mismatch');
        (new CloudBuildLedgerImportService())->import($file);
    }

    public function test_missing_row_is_hard_diff(): void
    {
        $file = $this->packedLedger();
        (new CloudBuildLedgerImportService())->import($file);
        CloudBuildJob::query()->where('build_id', '00000000-0000-4000-8000-000000000004')->delete();

        $report = (new CloudBuildLedgerReconcileService())->reconcile($file);
        $this->assertFalse($report['ok']);
        $this->assertContains('missing_build_ids', $report['hard_diffs']);
    }

    public function test_terminal_job_is_not_resurrected_on_reimport(): void
    {
        $file = $this->packedLedger();
        (new CloudBuildLedgerImportService())->import($file);

        $tamper = $file;
        foreach ($tamper['jobs'] as &$job) {
            if ($job['build_id'] === '00000000-0000-4000-8000-000000000006') {
                $job['status'] = 'queued';
                $job['mirror_status'] = null;
            }
        }
        unset($job);
        $tamper['manifest']['canonical_sha256'] = CloudBuildLedgerCanonical::digest($tamper['jobs'], true);
        $tamper['manifest']['payload_sha256'] = CloudBuildLedgerCanonical::payloadSha256($tamper);

        $stats = (new CloudBuildLedgerImportService())->import($tamper);
        $this->assertGreaterThan(0, $stats['skipped_terminal']);
        $this->assertSame('failed', CloudBuildJob::query()->where('build_id', '00000000-0000-4000-8000-000000000006')->value('phase'));
    }

    public function test_large_batch_cursor_imports_all_rows(): void
    {
        $jobs = [];
        for ($i = 1; $i <= 25; $i++) {
            $jobs[] = [
                'build_id' => sprintf('00000000-0000-4000-8000-%012d', $i),
                'client_ref' => 'client-batch',
                'platform' => 'win',
                'build_mode' => 'normal',
                'status' => 'delivered',
                'mirror_status' => 'mirrored',
                'dispatch_attempts' => 1,
                'executor_run_id' => 3000 + $i,
                'artifacts' => [[
                    'filename' => 'app.exe',
                    'role' => 'primary',
                    'size' => $i,
                    'sha256' => str_repeat('ab', 32),
                ]],
            ];
        }
        $clients = CloudBuildLedgerFile::clientsFromJobs($jobs);
        $quotas = CloudBuildLedgerFile::quotasFromJobs($jobs, '2026-08-22');
        $file = CloudBuildLedgerFile::pack($jobs, $clients, [], $quotas);

        $import = new CloudBuildLedgerImportService();
        $after = '';
        $seen = 0;
        for ($round = 0; $round < 10; $round++) {
            $stats = $import->import($file, $after, 7);
            $seen += $stats['imported'] + $stats['updated'];
            if (!$stats['has_more']) {
                break;
            }
            $after = (string) $stats['next_after_build_id'];
        }
        $this->assertSame(25, CloudBuildJob::query()->count());
        $report = (new CloudBuildLedgerReconcileService())->reconcile($file);
        $this->assertTrue($report['ok'], json_encode($report['hard_diffs']));
    }

    public function test_redact_drops_urls_and_tokens(): void
    {
        $redacted = CloudBuildLedgerCanonical::redact([
            'build_id' => 'x',
            'callback_token' => 'secret-token',
            'mirror_url_primary' => 'https://cdn.example/file.exe',
            'artifacts' => [[
                'filename' => 'app.exe',
                'role' => 'primary',
                'size' => 1,
                'sha256' => str_repeat('aa', 32),
                'download_url' => 'https://cdn.example/app.exe',
            ]],
        ]);
        $this->assertArrayNotHasKey('callback_token', $redacted);
        $this->assertArrayNotHasKey('mirror_url_primary', $redacted);
        $this->assertArrayNotHasKey('download_url', $redacted['artifacts'][0]);
    }

    /**
     * @return array<string, mixed>
     */
    private function contractFixture(): array
    {
        $path = dirname(__DIR__, 2) . '/../docs/contracts/cloud-build-migration/fixture.json';
        $decoded = json_decode((string) file_get_contents($path), true);
        $this->assertIsArray($decoded);
        return $decoded;
    }

    /**
     * @return array<string, mixed>
     */
    private function packedLedger(): array
    {
        $source = $this->contractFixture()['source'];
        $clients = [
            [
                'client_ref' => 'client-a',
                'domain' => 'admin-a.example.test',
                'daily_limit' => 10,
                'monthly_limit' => 0,
                'status' => 'active',
                'expires_at' => null,
                'maintenance_exempt' => 0,
            ],
            [
                'client_ref' => 'client-b',
                'domain' => 'admin-b.example.test',
                'daily_limit' => 10,
                'monthly_limit' => 0,
                'status' => 'active',
                'expires_at' => null,
                'maintenance_exempt' => 0,
            ],
        ];
        $quotas = CloudBuildLedgerFile::quotasFromJobs($source, '2026-08-22');
        return CloudBuildLedgerFile::pack($source, $clients, [], $quotas);
    }
}
