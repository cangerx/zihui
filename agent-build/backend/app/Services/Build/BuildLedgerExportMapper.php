<?php

namespace App\Services\Build;

/**
 * 把授权端 build_requests / clients / quotas / templates 映成 ledger v1 行。
 * 去敏规则与云控导入端一致。
 */
class BuildLedgerExportMapper
{
    /**
     * @param object|array<string, mixed> $row
     * @return array<string, mixed>
     */
    public function mapRequest($row): array
    {
        $row = (array) $row;
        $files = $row['artifact_files'] ?? [];
        if (is_string($files)) {
            $decoded = json_decode($files, true);
            $files = is_array($decoded) ? $decoded : [];
        }
        $artifacts = [];
        foreach ($files as $file) {
            if (!is_array($file)) {
                continue;
            }
            $filename = basename((string) ($file['filename'] ?? ''));
            $sha = (string) ($file['sha256'] ?? '');
            if ($filename === '' || $sha === '') {
                continue;
            }
            $artifacts[] = [
                'filename' => $filename,
                'role' => (string) ($file['role'] ?? 'primary'),
                'size' => (int) ($file['size'] ?? 0),
                'sha256' => $sha,
            ];
        }
        if ($artifacts === [] && !empty($row['artifact_sha256'])) {
            $artifacts[] = [
                'filename' => basename((string) ($row['artifact_path'] ?? 'artifact.bin')) ?: 'artifact.bin',
                'role' => 'primary',
                'size' => (int) ($row['artifact_size'] ?? 0),
                'sha256' => (string) $row['artifact_sha256'],
            ];
        }

        return BuildLedgerCanonical::redact([
            'build_id' => (string) ($row['build_id'] ?? ''),
            'client_ref' => (string) ($row['client_id'] ?? $row['client_ref'] ?? ''),
            'platform' => (string) ($row['platform'] ?? ''),
            'build_mode' => (string) ($row['build_mode'] ?? 'normal'),
            'oem_project_key' => $row['oem_project_key'] ?? null,
            'status' => (string) ($row['status'] ?? ''),
            'mirror_status' => $row['mirror_status'] ?? null,
            'dispatch_attempts' => (int) ($row['dispatch_attempts'] ?? 0),
            'executor_id' => $row['executor_id'] ?? null,
            'executor_run_id' => $row['executor_run_id'] ?? null,
            'app_name' => (string) ($row['app_name'] ?? ''),
            'app_version' => (string) ($row['app_version'] ?? ''),
            'app_id' => $row['app_id'] ?? null,
            'update_path' => $row['update_path'] ?? null,
            'queued_at' => $row['queued_at'] ?? null,
            'dispatched_at' => $row['dispatched_at'] ?? null,
            'started_at' => $row['started_at'] ?? null,
            'finished_at' => $row['finished_at'] ?? null,
            'delivered_at' => $row['delivered_at'] ?? null,
            'purged_at' => $row['purged_at'] ?? null,
            'error_message' => $row['error_message'] ?? null,
            'release_tag' => $row['release_tag'] ?? null,
            'artifacts' => $artifacts,
        ]);
    }

    /**
     * @param object|array<string, mixed> $row
     * @return array<string, mixed>
     */
    public function mapClient($row): array
    {
        $row = (array) $row;
        return BuildLedgerCanonical::redact([
            'client_ref' => (string) ($row['client_id'] ?? $row['client_ref'] ?? ''),
            'domain' => (string) ($row['domain'] ?? ''),
            'daily_limit' => (int) ($row['daily_limit'] ?? 0),
            'monthly_limit' => (int) ($row['monthly_limit'] ?? 0),
            'status' => (string) ($row['status'] ?? 'active'),
            'expires_at' => $row['expires_at'] ?? null,
            'maintenance_exempt' => (int) ($row['maintenance_exempt'] ?? 0),
        ]);
    }

    /**
     * @param object|array<string, mixed> $row
     * @return array<string, mixed>
     */
    public function mapQuota($row): array
    {
        $row = (array) $row;
        return [
            'client_ref' => (string) ($row['client_id'] ?? $row['client_ref'] ?? ''),
            'quota_date' => (string) ($row['date'] ?? $row['quota_date'] ?? ''),
            'consumed' => (int) ($row['count'] ?? $row['consumed'] ?? 0),
        ];
    }

    /**
     * @param object|array<string, mixed> $row
     * @return array<string, mixed>
     */
    public function mapTemplate($row): array
    {
        $row = (array) $row;
        return [
            'version' => (string) ($row['version'] ?? ''),
            'released_at' => $row['released_at'] ?? null,
            'changelog' => $row['changelog'] ?? null,
            'is_current' => (int) ($row['is_current'] ?? 0),
            'released_by' => $row['released_by'] ?? null,
        ];
    }

    /**
     * @param list<array<string, mixed>> $jobs
     * @param list<array<string, mixed>> $clients
     * @param list<array<string, mixed>> $templates
     * @param list<array<string, mixed>> $quotas
     * @param array<string, mixed> $cursor
     * @return array<string, mixed>
     */
    public function pack(array $jobs, array $clients, array $templates, array $quotas, array $cursor = [], ?string $snapshotUntil = null): array
    {
        $jobs = array_values($jobs);
        usort($jobs, fn ($a, $b) => strcmp((string) ($a['build_id'] ?? ''), (string) ($b['build_id'] ?? '')));
        $ids = array_map(fn ($row) => (string) ($row['build_id'] ?? ''), $jobs);
        $modes = array_values(array_unique(array_map(fn ($row) => (string) ($row['build_mode'] ?? 'normal'), $jobs)));
        sort($modes);

        $body = [
            'format' => BuildLedgerCanonical::FORMAT,
            'snapshot_until' => $snapshotUntil ?: gmdate('c'),
            'range' => [
                'build_id_min' => $ids[0] ?? null,
                'build_id_max' => $ids ? $ids[count($ids) - 1] : null,
                'created_from' => null,
                'created_to' => null,
                'build_modes' => $modes,
            ],
            'clients' => array_values($clients),
            'templates' => array_values($templates),
            'quotas' => array_values($quotas),
            'jobs' => $jobs,
        ];

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
                'canonical_sha256' => BuildLedgerCanonical::digest($jobs, true),
                'payload_sha256' => BuildLedgerCanonical::payloadSha256($body),
            ],
        ];
    }
}
