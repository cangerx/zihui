<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildArtifact;
use App\Models\CloudBuildAttempt;
use App\Models\CloudBuildClient;
use App\Models\CloudBuildJob;
use App\Models\CloudBuildQuota;
use App\Models\CloudBuildTemplate;
use Carbon\Carbon;
use InvalidArgumentException;

/**
 * 幂等导入 ledger v1。终态不得复活为活动态；配额按文件覆盖，避免重复导入双计。
 */
class CloudBuildLedgerImportService
{
    /**
     * @param array<string, mixed> $file
     * @return array{imported:int,updated:int,skipped_terminal:int,clients:int,templates:int,quotas:int,artifacts:int,next_after_build_id:?string,has_more:bool}
     */
    public function import(array $file, string $afterBuildId = '', int $limit = 0): array
    {
        $file = CloudBuildLedgerFile::assertIntact($file);
        $jobs = CloudBuildLedgerFile::sliceByCursor($file['jobs'] ?? [], $afterBuildId, $limit);
        $allJobs = $file['jobs'] ?? [];
        $lastAll = null;
        if ($allJobs !== []) {
            $ids = array_map(fn ($row) => (string) ($row['build_id'] ?? ''), $allJobs);
            sort($ids);
            $lastAll = $ids[count($ids) - 1];
        }

        $stats = [
            'imported' => 0,
            'updated' => 0,
            'skipped_terminal' => 0,
            'clients' => 0,
            'templates' => 0,
            'quotas' => 0,
            'artifacts' => 0,
            'next_after_build_id' => null,
            'has_more' => false,
        ];

        foreach (($file['clients'] ?? []) as $client) {
            if (!is_array($client)) {
                continue;
            }
            $this->upsertClient($client);
            $stats['clients']++;
        }
        foreach (($file['templates'] ?? []) as $template) {
            if (!is_array($template)) {
                continue;
            }
            $this->upsertTemplate($template);
            $stats['templates']++;
        }
        foreach (($file['quotas'] ?? []) as $quota) {
            if (!is_array($quota)) {
                continue;
            }
            $this->upsertQuota($quota);
            $stats['quotas']++;
        }

        $lastImported = $afterBuildId !== '' ? $afterBuildId : null;
        foreach ($jobs as $row) {
            $result = $this->upsertJob($row);
            $stats[$result]++;
            $lastImported = (string) ($row['build_id'] ?? $lastImported);
            $stats['artifacts'] += $this->upsertArtifacts($row);
            $this->upsertAttempts($row);
        }

        $stats['next_after_build_id'] = $lastImported;
        if ($lastImported && $lastAll && strcmp($lastImported, $lastAll) < 0) {
            $stats['has_more'] = true;
        }

        return $stats;
    }

    public function importPath(string $path, string $afterBuildId = '', int $limit = 0): array
    {
        if (!is_file($path)) {
            throw new InvalidArgumentException('ledger_file_not_found');
        }
        $decoded = json_decode((string) file_get_contents($path), true);
        if (!is_array($decoded)) {
            throw new InvalidArgumentException('ledger_file_invalid_json');
        }
        return $this->import($decoded, $afterBuildId, $limit);
    }

    /**
     * @param array<string, mixed> $client
     */
    private function upsertClient(array $client): void
    {
        $ref = trim((string) ($client['client_ref'] ?? $client['client_id'] ?? ''));
        if ($ref === '') {
            return;
        }
        $attrs = [
            'domain' => (string) ($client['domain'] ?? ''),
            'daily_limit' => (int) ($client['daily_limit'] ?? 0),
            'monthly_limit' => (int) ($client['monthly_limit'] ?? 0),
            'status' => (string) ($client['status'] ?? 'active'),
            'expires_at' => $client['expires_at'] ?? null,
            'maintenance_exempt' => (int) ($client['maintenance_exempt'] ?? 0),
        ];
        $existing = CloudBuildClient::query()->where('client_ref', $ref)->first();
        if ($existing) {
            $existing->fill($attrs)->save();
            return;
        }
        CloudBuildClient::query()->create(['client_ref' => $ref] + $attrs);
    }

    /**
     * @param array<string, mixed> $template
     */
    private function upsertTemplate(array $template): void
    {
        $version = trim((string) ($template['version'] ?? ''));
        if ($version === '') {
            return;
        }
        $isCurrent = (int) ($template['is_current'] ?? 0) === 1;
        if ($isCurrent) {
            CloudBuildTemplate::query()->where('is_current', 1)->update(['is_current' => 0]);
        }
        CloudBuildTemplate::query()->updateOrCreate(
            ['version' => $version],
            [
                'released_at' => $template['released_at'] ?? Carbon::now(),
                'changelog' => $template['changelog'] ?? null,
                'is_current' => $isCurrent ? 1 : 0,
                'released_by' => $template['released_by'] ?? 'ledger-import',
            ]
        );
    }

    /**
     * @param array<string, mixed> $quota
     */
    private function upsertQuota(array $quota): void
    {
        $ref = trim((string) ($quota['client_ref'] ?? ''));
        $dateRaw = (string) ($quota['quota_date'] ?? $quota['date'] ?? '');
        if ($ref === '' || $dateRaw === '') {
            return;
        }
        $date = Carbon::parse($dateRaw)->toDateString();
        $consumed = max(0, (int) ($quota['consumed'] ?? $quota['count'] ?? 0));
        $row = CloudBuildQuota::query()
            ->where('client_ref', $ref)
            ->whereDate('quota_date', $date)
            ->first();
        if ($row) {
            $row->consumed = $consumed;
            $row->save();
            return;
        }
        CloudBuildQuota::query()->create([
            'client_ref' => $ref,
            'quota_date' => $date,
            'consumed' => $consumed,
        ]);
    }

    /**
     * @param array<string, mixed> $row
     */
    private function upsertJob(array $row): string
    {
        $canonical = CloudBuildLedgerCanonical::canonicalJob($row, true);
        $buildId = $canonical['build_id'];
        if ($buildId === '') {
            throw new InvalidArgumentException('job_build_id_required');
        }

        $existing = CloudBuildJob::query()->where('build_id', $buildId)->first();
        $incomingPhase = $canonical['phase'];
        if ($existing) {
            $current = (string) $existing->phase;
            if (in_array($current, CloudBuildLedgerCanonical::TERMINAL, true)
                && in_array($incomingPhase, CloudBuildLedgerCanonical::ACTIVE, true)) {
                return 'skipped_terminal';
            }
        }

        $attrs = [
            'client_ref' => $canonical['client_ref'],
            'build_mode' => $canonical['build_mode'] ?: 'normal',
            'oem_project_key' => $canonical['oem_project_key'],
            'platform' => $canonical['platform'],
            'app_name' => (string) ($row['app_name'] ?? ''),
            'app_version' => (string) ($row['app_version'] ?? ''),
            'app_id' => $row['app_id'] ?? null,
            'update_path' => $row['update_path'] ?? null,
            'phase' => $incomingPhase,
            'source_status' => $row['status'] ?? $row['source_status'] ?? null,
            'source_mirror_status' => array_key_exists('mirror_status', $row) ? $row['mirror_status'] : ($row['source_mirror_status'] ?? null),
            'dispatch_attempts' => $canonical['attempt_count'],
            'executor_id' => $row['executor_id'] ?? null,
            'executor_run_id' => $canonical['executor_run_id'],
            'error_message' => isset($row['error_message']) ? mb_substr((string) $row['error_message'], 0, 500) : null,
            'queued_at' => $row['queued_at'] ?? null,
            'dispatched_at' => $row['dispatched_at'] ?? null,
            'started_at' => $row['started_at'] ?? null,
            'finished_at' => $row['finished_at'] ?? null,
            'delivered_at' => $row['delivered_at'] ?? null,
            'purged_at' => $row['purged_at'] ?? null,
            'release_tag' => $row['release_tag'] ?? null,
        ];

        if ($existing) {
            $existing->fill($attrs);
            if (empty($existing->callback_token) && in_array($incomingPhase, CloudBuildLedgerCanonical::ACTIVE, true)) {
                $existing->callback_token = bin2hex(random_bytes(32));
            }
            $existing->save();
            return 'updated';
        }

        $create = $attrs + [
            'build_id' => $buildId,
            'callback_token' => in_array($incomingPhase, CloudBuildLedgerCanonical::ACTIVE, true)
                ? bin2hex(random_bytes(32))
                : null,
        ];
        CloudBuildJob::query()->create($create);
        return 'imported';
    }

    /**
     * @param array<string, mixed> $row
     */
    private function upsertArtifacts(array $row): int
    {
        $buildId = (string) ($row['build_id'] ?? '');
        $count = 0;
        foreach (($row['artifacts'] ?? []) as $artifact) {
            if (!is_array($artifact)) {
                continue;
            }
            $filename = basename((string) ($artifact['filename'] ?? ''));
            $sha = (string) ($artifact['sha256'] ?? '');
            if ($buildId === '' || $filename === '' || $sha === '') {
                continue;
            }
            CloudBuildArtifact::query()->updateOrCreate(
                [
                    'build_id' => $buildId,
                    'role' => (string) ($artifact['role'] ?? 'primary'),
                    'filename' => $filename,
                ],
                [
                    'size' => (int) ($artifact['size'] ?? 0),
                    'sha256' => $sha,
                ]
            );
            $count++;
        }
        return $count;
    }

    /**
     * @param array<string, mixed> $row
     */
    private function upsertAttempts(array $row): void
    {
        $canonical = CloudBuildLedgerCanonical::canonicalJob($row, true);
        $buildId = $canonical['build_id'];
        $n = $canonical['attempt_count'];
        if ($buildId === '' || $n <= 0) {
            return;
        }
        $lastOutcome = in_array($canonical['phase'], ['failed', 'cancelled'], true) ? 'failed' : 'dispatched';
        for ($i = 1; $i <= $n; $i++) {
            CloudBuildAttempt::query()->updateOrCreate(
                ['build_id' => $buildId, 'attempt_no' => $i],
                [
                    'outcome' => $i === $n ? $lastOutcome : 'retried',
                    'executor_run_id' => $canonical['executor_run_id'],
                ]
            );
        }
    }
}
