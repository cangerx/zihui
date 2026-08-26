<?php

namespace App\Services\CloudBuild;

use InvalidArgumentException;

/**
 * ledger v1 文件的打包、校验与切片（build_id 游标，禁止 offset）。
 */
class CloudBuildLedgerFile
{
    /**
     * @param list<array<string, mixed>> $jobs source-shaped rows
     * @param list<array<string, mixed>> $clients
     * @param list<array<string, mixed>> $templates
     * @param list<array<string, mixed>> $quotas
     * @return array<string, mixed>
     */
    public static function pack(
        array $jobs,
        array $clients = [],
        array $templates = [],
        array $quotas = [],
        ?string $snapshotUntil = null,
        array $cursor = []
    ): array {
        $jobs = array_values(CloudBuildLedgerCanonical::redact($jobs));
        usort($jobs, fn ($a, $b) => strcmp((string) ($a['build_id'] ?? ''), (string) ($b['build_id'] ?? '')));

        $ids = array_map(fn ($row) => (string) ($row['build_id'] ?? ''), $jobs);
        $modes = array_values(array_unique(array_map(fn ($row) => (string) ($row['build_mode'] ?? 'normal'), $jobs)));
        sort($modes);

        $body = [
            'format' => CloudBuildLedgerCanonical::FORMAT,
            'snapshot_until' => $snapshotUntil ?: gmdate('c'),
            'range' => [
                'build_id_min' => $ids[0] ?? null,
                'build_id_max' => $ids ? $ids[count($ids) - 1] : null,
                'created_from' => null,
                'created_to' => null,
                'build_modes' => $modes,
            ],
            'clients' => array_values(CloudBuildLedgerCanonical::redact($clients)),
            'templates' => array_values($templates),
            'quotas' => array_values($quotas),
            'jobs' => $jobs,
        ];

        $canonical = CloudBuildLedgerCanonical::digest($jobs, true);
        $payloadSha = CloudBuildLedgerCanonical::payloadSha256($body);

        return $body + [
            'exported_at' => gmdate('c'),
            'cursor' => [
                'after_build_id' => (string) ($cursor['after_build_id'] ?? ''),
                'limit' => (int) ($cursor['limit'] ?? 0),
                'has_more' => (bool) ($cursor['has_more'] ?? false),
                'next_after_build_id' => $cursor['next_after_build_id'] ?? ($ids ? $ids[count($ids) - 1] : null),
            ],
            'manifest' => [
                'job_count' => count($jobs),
                'client_count' => count($clients),
                'canonical_sha256' => $canonical,
                'payload_sha256' => $payloadSha,
            ],
        ];
    }

    /**
     * @param array<string, mixed> $file
     * @return array<string, mixed>
     */
    public static function assertIntact(array $file): array
    {
        if (($file['format'] ?? '') !== CloudBuildLedgerCanonical::FORMAT) {
            throw new InvalidArgumentException('unsupported_ledger_format');
        }
        $jobs = $file['jobs'] ?? null;
        if (!is_array($jobs)) {
            throw new InvalidArgumentException('ledger_jobs_required');
        }
        $buildIds = array_map(fn ($row) => (string) ($row['build_id'] ?? ''), $jobs);
        if (count($buildIds) !== count(array_unique($buildIds))) {
            throw new InvalidArgumentException('duplicate_build_id');
        }

        $canonical = CloudBuildLedgerCanonical::digest($jobs, true);
        $expectedCanonical = (string) ($file['manifest']['canonical_sha256'] ?? '');
        if ($expectedCanonical === '' || !hash_equals($expectedCanonical, $canonical)) {
            throw new InvalidArgumentException('canonical_sha256_mismatch');
        }

        $expectedPayload = (string) ($file['manifest']['payload_sha256'] ?? '');
        $actualPayload = CloudBuildLedgerCanonical::payloadSha256($file);
        if ($expectedPayload === '' || !hash_equals($expectedPayload, $actualPayload)) {
            throw new InvalidArgumentException('payload_sha256_mismatch');
        }

        return $file;
    }

    /**
     * @param list<array<string, mixed>> $jobs
     * @return list<array<string, mixed>>
     */
    public static function sliceByCursor(array $jobs, string $afterBuildId, int $limit): array
    {
        usort($jobs, fn ($a, $b) => strcmp((string) ($a['build_id'] ?? ''), (string) ($b['build_id'] ?? '')));
        $out = [];
        foreach ($jobs as $job) {
            $id = (string) ($job['build_id'] ?? '');
            if ($afterBuildId !== '' && strcmp($id, $afterBuildId) <= 0) {
                continue;
            }
            $out[] = $job;
            if ($limit > 0 && count($out) >= $limit) {
                break;
            }
        }
        return $out;
    }

    /**
     * @param list<array<string, mixed>> $jobs
     * @return list<array<string, mixed>>
     */
    public static function quotasFromJobs(array $jobs, string $quotaDate): array
    {
        $counts = [];
        foreach ($jobs as $job) {
            $phase = CloudBuildLedgerCanonical::canonicalJob($job, true)['phase'];
            if (in_array($phase, ['failed', 'cancelled'], true)) {
                continue;
            }
            $ref = (string) ($job['client_ref'] ?? $job['client_id'] ?? '');
            if ($ref === '') {
                continue;
            }
            $counts[$ref] = ($counts[$ref] ?? 0) + 1;
        }
        $rows = [];
        foreach ($counts as $ref => $consumed) {
            $rows[] = [
                'client_ref' => $ref,
                'quota_date' => $quotaDate,
                'consumed' => $consumed,
            ];
        }
        usort($rows, fn ($a, $b) => strcmp($a['client_ref'], $b['client_ref']));
        return $rows;
    }

    /**
     * @param list<array<string, mixed>> $jobs
     * @return list<array<string, mixed>>
     */
    public static function clientsFromJobs(array $jobs): array
    {
        $seen = [];
        foreach ($jobs as $job) {
            $ref = (string) ($job['client_ref'] ?? $job['client_id'] ?? '');
            if ($ref === '' || isset($seen[$ref])) {
                continue;
            }
            $seen[$ref] = [
                'client_ref' => $ref,
                'domain' => (string) ($job['domain'] ?? ''),
                'daily_limit' => 10,
                'monthly_limit' => 0,
                'status' => 'active',
                'expires_at' => null,
                'maintenance_exempt' => 0,
            ];
        }
        ksort($seen);
        return array_values($seen);
    }
}
