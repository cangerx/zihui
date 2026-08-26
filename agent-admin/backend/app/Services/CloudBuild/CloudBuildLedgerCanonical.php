<?php

namespace App\Services\CloudBuild;

/**
 * 与 docs/contracts/cloud-build-migration/verify-fixture.cjs 同源的 canonical 摘要。
 * 只含稳定业务字段：排除自增 ID、URL、路径、密钥和更新时间。
 */
class CloudBuildLedgerCanonical
{
    public const FORMAT = 'cloud-build-ledger-v1';

    public const TERMINAL = ['delivered', 'failed', 'cancelled', 'expired', 'purged'];

    public const ACTIVE = [
        CloudBuildPhaseNormalizer::PHASE_QUEUED,
        CloudBuildPhaseNormalizer::PHASE_BUILDING,
        CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING,
        CloudBuildPhaseNormalizer::PHASE_READY,
        CloudBuildPhaseNormalizer::PHASE_LEGACY,
    ];

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function canonicalJob(array $row, bool $fromSource): array
    {
        $artifacts = [];
        foreach (($row['artifacts'] ?? []) as $artifact) {
            if (!is_array($artifact)) {
                continue;
            }
            $artifacts[] = [
                'filename' => (string) ($artifact['filename'] ?? ''),
                'role' => (string) ($artifact['role'] ?? 'primary'),
                'size' => (int) ($artifact['size'] ?? 0),
                'sha256' => (string) ($artifact['sha256'] ?? ''),
            ];
        }
        usort($artifacts, function ($a, $b) {
            return strcmp($a['role'] . ':' . $a['filename'], $b['role'] . ':' . $b['filename']);
        });

        $runId = $row['executor_run_id'] ?? null;
        $runId = $runId ? (int) $runId : null;

        $attempt = $fromSource
            ? (int) ($row['dispatch_attempts'] ?? $row['attempt_count'] ?? 0)
            : (int) ($row['attempt_count'] ?? $row['dispatch_attempts'] ?? 0);

        $phase = $fromSource
            ? CloudBuildPhaseNormalizer::fromSource(
                (string) ($row['status'] ?? $row['phase'] ?? ''),
                array_key_exists('mirror_status', $row) ? ($row['mirror_status'] !== null ? (string) $row['mirror_status'] : null) : null
            )
            : (string) ($row['phase'] ?? '');

        return [
            'build_id' => (string) ($row['build_id'] ?? ''),
            'client_ref' => (string) ($row['client_ref'] ?? $row['client_id'] ?? ''),
            'platform' => (string) ($row['platform'] ?? ''),
            'build_mode' => (string) ($row['build_mode'] ?? 'normal'),
            'oem_project_key' => ($row['oem_project_key'] ?? null) ?: null,
            'phase' => $phase,
            'attempt_count' => $attempt,
            'executor_run_id' => $runId,
            'artifacts' => array_values($artifacts),
        ];
    }

    /**
     * @param list<array<string, mixed>> $rows
     */
    public static function digest(array $rows, bool $fromSource): string
    {
        $normalized = [];
        foreach ($rows as $row) {
            $normalized[] = self::canonicalJob($row, $fromSource);
        }
        usort($normalized, fn ($a, $b) => strcmp($a['build_id'], $b['build_id']));

        return hash('sha256', json_encode($normalized, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    /**
     * @param array<string, mixed> $payload
     */
    public static function payloadSha256(array $payload): string
    {
        $copy = $payload;
        unset($copy['manifest'], $copy['exported_at'], $copy['cursor']);
        return hash('sha256', json_encode(self::ksortRecursive($copy), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    /**
     * @param mixed $value
     * @return mixed
     */
    public static function ksortRecursive($value)
    {
        if (!is_array($value)) {
            return $value;
        }
        $isList = self::isList($value);
        foreach ($value as $k => $v) {
            $value[$k] = self::ksortRecursive($v);
        }
        if (!$isList) {
            ksort($value);
        }
        return $value;
    }

    /**
     * @param array<mixed> $value
     */
    private static function isList(array $value): bool
    {
        if ($value === []) {
            return true;
        }
        return array_keys($value) === range(0, count($value) - 1);
    }

    /**
     * @param mixed $value
     * @return mixed
     */
    public static function redact($value)
    {
        $drop = [
            'url', 'download_url', 'preferred_url', 'asset_url', 'mirror_url',
            'mirror_url_primary', 'artifact_path', 'storage_path', 'relative_path',
            'callback_token', 'client_secret', 'owner_phone', 'owner_name', 'notify_url',
            'contact', 'token', 'secret', 'icon_path', 'cos_object_prefix',
        ];
        if (!is_array($value)) {
            return $value;
        }
        $out = [];
        foreach ($value as $k => $v) {
            if (is_string($k) && in_array($k, $drop, true)) {
                continue;
            }
            $out[$k] = self::redact($v);
        }
        return $out;
    }
}
