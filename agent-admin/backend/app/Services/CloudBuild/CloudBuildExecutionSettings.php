<?php

namespace App\Services\CloudBuild;

/**
 * 本地执行调度参数。测试直接构造；生产由 fromConfig() 读取 cloudbuild.execution。
 */
class CloudBuildExecutionSettings
{
    public function __construct(
        public int $maxDispatchAttempts = 3,
        public int $dispatchBatchSize = 5,
        public int $queueMaxDepth = 100,
        public int $ackTimeoutHours = 24,
        public int $stuckMinutes = 20,
        public int $stuckRunMinutes = 90,
        public int $stuckObserveMinutes = 2,
        public int $staleClaimMinutes = 10,
        public string $callbackUrl = 'https://example.test/api/cloud-build/callback',
        public bool $queuePaused = false,
        public string $storageRoot = '',
        public int $fetchMaxAttempts = 3,
        public int $mirrorAssignmentMinutes = 90,
        public int $orphanRetentionDays = 2,
        public string $signSecret = '',
        public int $downloadTtlSeconds = 1800,
        public string $downloadBaseUrl = 'https://example.test/api/cloud-build/dl',
        public string $workerToken = '',
    ) {
    }

    public static function fromConfig(): self
    {
        $exec = (array) config('cloudbuild.execution', []);
        $callback = (string) (config('cloudbuild.github.callback_url') ?: '');
        if ($callback === '') {
            $callback = rtrim((string) (config('app.url') ?: ''), '/') . '/api/cloud-build/callback';
        }

        return new self(
            maxDispatchAttempts: max(1, (int) ($exec['max_dispatch_attempts'] ?? 3)),
            dispatchBatchSize: max(1, (int) ($exec['dispatch_batch_size'] ?? 5)),
            queueMaxDepth: max(1, (int) ($exec['queue']['max_depth'] ?? 100)),
            ackTimeoutHours: max(1, (int) ($exec['ack_timeout_hours'] ?? 24)),
            stuckMinutes: max(1, (int) ($exec['stuck_minutes'] ?? 20)),
            stuckRunMinutes: max(1, (int) ($exec['stuck_run_minutes'] ?? 90)),
            stuckObserveMinutes: max(1, (int) ($exec['stuck_observe_minutes'] ?? 2)),
            staleClaimMinutes: max(1, (int) ($exec['stale_claim_minutes'] ?? 10)),
            callbackUrl: $callback,
            queuePaused: (bool) ($exec['queue_paused'] ?? false),
            storageRoot: (string) (config('cloudbuild.storage.root') ?: config('cloudbuild.storage.subdir') ?: ''),
            fetchMaxAttempts: max(1, (int) ($exec['fetch_max_attempts'] ?? 3)),
            mirrorAssignmentMinutes: max(1, (int) ($exec['mirror_assignment_minutes'] ?? 90)),
            orphanRetentionDays: max(1, (int) ($exec['orphan_retention_days'] ?? 2)),
            signSecret: (string) (config('cloudbuild.download.sign_secret') ?: ''),
            downloadTtlSeconds: max(60, (int) (config('cloudbuild.download.ttl_seconds') ?: 1800)),
            downloadBaseUrl: (string) (config('cloudbuild.download.base_url') ?: rtrim((string) (config('app.url') ?: ''), '/') . '/api/cloud-build/dl'),
            workerToken: (string) (config('cloudbuild.mirror.worker_token') ?: ''),
        );
    }
}
