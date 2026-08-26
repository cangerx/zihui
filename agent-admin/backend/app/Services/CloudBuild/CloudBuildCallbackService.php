<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildArtifact;
use App\Models\CloudBuildJob;

/**
 * GitHub Actions 回调：Bearer per-job token，成功停在 artifact_pending。
 *
 * @phpstan-type CallbackResult array{status:int,body:array<string,mixed>}
 */
class CloudBuildCallbackService
{
    private const ALLOWED_ROLES = ['primary', 'blockmap', 'metadata'];

    private const IDEMPOTENT_PHASES = [
        CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING,
        CloudBuildPhaseNormalizer::PHASE_READY,
        CloudBuildPhaseNormalizer::PHASE_DELIVERED,
        CloudBuildPhaseNormalizer::PHASE_PURGED,
        CloudBuildPhaseNormalizer::PHASE_FAILED,
        CloudBuildPhaseNormalizer::PHASE_CANCELLED,
        CloudBuildPhaseNormalizer::PHASE_EXPIRED,
    ];

    public function __construct(
        private CloudBuildQuotaService $quota,
        private CloudBuildStateMachine $stateMachine,
    ) {
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status:int,body:array<string,mixed>}
     */
    public function handle(string $token, array $payload): array
    {
        if ($token === '') {
            return $this->json(401, ['error' => 'missing_bearer']);
        }

        $buildId = (string) ($payload['build_id'] ?? '');
        if ($buildId === '') {
            return $this->json(400, ['error' => 'build_id_required']);
        }

        return CloudBuildJob::query()->getConnection()->transaction(function () use ($token, $payload, $buildId) {
            /** @var CloudBuildJob|null $job */
            $job = CloudBuildJob::query()->where('build_id', $buildId)->lockForUpdate()->first();
            if ($job === null) {
                return $this->json(404, ['error' => 'build_not_found']);
            }

            $stored = (string) ($job->callback_token ?? '');
            if ($stored === '' || !hash_equals($stored, $token)) {
                return $this->json(401, ['error' => 'invalid_callback_token']);
            }

            $phase = (string) $job->phase;
            if (in_array($phase, self::IDEMPOTENT_PHASES, true)) {
                return $this->json(200, ['ack' => true, 'idempotent' => true]);
            }

            $status = (string) ($payload['status'] ?? '');
            $runId = $payload['run_id'] ?? null;

            if ($status !== 'success') {
                $error = trim((string) ($payload['error'] ?? ''));
                $this->markFailed($job, $runId, $error !== '' ? $error : 'github_job_failed');
                return $this->json(200, ['ack' => true]);
            }

            $storage = (string) ($payload['artifact_storage'] ?? '');
            if ($storage !== 'github_release') {
                $this->markFailed($job, $runId, 'unsupported_artifact_storage:' . $storage);
                return $this->json(422, ['error' => 'unsupported_artifact_storage', 'received' => $storage]);
            }

            return $this->handleSuccess($job, $payload, $runId);
        });
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status:int,body:array<string,mixed>}
     */
    private function handleSuccess(CloudBuildJob $job, array $payload, mixed $runId): array
    {
        $buildId = (string) $job->build_id;
        $releaseTag = (string) ($payload['release_tag'] ?? '');
        $expectedTag = 'build-' . $buildId;
        if ($releaseTag !== $expectedTag) {
            $this->markFailed($job, $runId, 'release_tag_mismatch');
            return $this->json(422, ['error' => 'release_tag_mismatch']);
        }

        $files = $payload['files'] ?? null;
        if (!is_array($files) || $files === []) {
            $this->markFailed($job, $runId, 'release_files_empty');
            return $this->json(422, ['error' => 'release_files_empty']);
        }

        $primary = null;
        $releaseAssets = [];
        foreach ($files as $file) {
            if (!is_array($file) || empty($file['filename']) || empty($file['role'])) {
                $this->markFailed($job, $runId, 'release_files_malformed');
                return $this->json(422, ['error' => 'release_files_malformed']);
            }
            $role = (string) $file['role'];
            if (!in_array($role, self::ALLOWED_ROLES, true)) {
                $this->markFailed($job, $runId, 'release_files_invalid_role');
                return $this->json(422, ['error' => 'release_files_invalid_role']);
            }
            $filename = (string) $file['filename'];
            if (str_contains($filename, '/') || str_contains($filename, '..')) {
                $this->markFailed($job, $runId, 'release_filename_invalid');
                return $this->json(422, ['error' => 'release_filename_invalid']);
            }

            $assetIdRaw = $file['asset_id'] ?? null;
            $assetUrl = (string) ($file['asset_url'] ?? '');
            $assetIdValid = (is_int($assetIdRaw) && $assetIdRaw > 0)
                || (is_string($assetIdRaw) && $assetIdRaw !== '');
            if (!$assetIdValid || $assetUrl === '') {
                $this->markFailed($job, $runId, 'release_asset_missing');
                return $this->json(422, ['error' => 'release_asset_missing', 'filename' => $filename]);
            }

            $sha = (string) ($file['sha256'] ?? '');
            if ($sha !== '' && !preg_match('/^[a-fA-F0-9]{64}$/', $sha)) {
                $this->markFailed($job, $runId, 'release_sha256_invalid');
                return $this->json(422, ['error' => 'release_sha256_invalid']);
            }
            if ($sha === '') {
                $sha = str_repeat('0', 64);
            }

            $row = [
                'filename' => $filename,
                'asset_id' => $assetIdRaw,
                'asset_url' => $assetUrl,
                'size' => (int) ($file['size'] ?? 0),
                'sha256' => strtolower($sha),
                'role' => $role,
            ];
            $releaseAssets[] = $row;
            if ($role === 'primary' && $primary === null) {
                $primary = $row;
            }
        }

        if ($primary === null) {
            $this->markFailed($job, $runId, 'release_primary_not_found');
            return $this->json(422, ['error' => 'release_primary_not_found']);
        }

        $from = (string) $job->phase;
        if ($from === CloudBuildPhaseNormalizer::PHASE_QUEUED) {
            $this->stateMachine->assertCanTransition($from, CloudBuildPhaseNormalizer::PHASE_BUILDING);
            $job->phase = CloudBuildPhaseNormalizer::PHASE_BUILDING;
            $job->started_at = $job->started_at ?: now();
            $job->save();
            $from = CloudBuildPhaseNormalizer::PHASE_BUILDING;
        }

        $this->stateMachine->assertCanTransition($from, CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING);

        foreach ($releaseAssets as $asset) {
            CloudBuildArtifact::query()->updateOrCreate(
                [
                    'build_id' => $buildId,
                    'role' => $asset['role'],
                    'filename' => $asset['filename'],
                ],
                [
                    'size' => $asset['size'],
                    'sha256' => $asset['sha256'],
                ]
            );
        }

        $job->phase = CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING;
        $job->executor_run_id = is_numeric($runId) ? (int) $runId : $job->executor_run_id;
        $job->release_tag = $releaseTag;
        $job->release_assets = $releaseAssets;
        $job->finished_at = now();
        $job->error_message = null;
        $job->claim_owner = null;
        $job->claimed_at = null;
        $job->save();

        return $this->json(200, ['ack' => true]);
    }

    private function markFailed(CloudBuildJob $job, mixed $runId, string $error): void
    {
        $wasFailed = $job->phase === CloudBuildPhaseNormalizer::PHASE_FAILED;
        $from = (string) $job->phase;
        if ($from !== CloudBuildPhaseNormalizer::PHASE_FAILED) {
            $this->stateMachine->assertCanTransition($from, CloudBuildPhaseNormalizer::PHASE_FAILED);
        }

        $job->phase = CloudBuildPhaseNormalizer::PHASE_FAILED;
        $job->finished_at = now();
        $job->error_message = mb_substr($error, 0, 500);
        $job->claim_owner = null;
        $job->claimed_at = null;
        if (is_numeric($runId)) {
            $job->executor_run_id = (int) $runId;
        }
        $job->save();

        if (!$wasFailed) {
            $this->quota->decrDailyCount(
                (string) $job->client_ref,
                CloudBuildQuotaService::quotaDateFrom($job->created_at ?? $job->queued_at)
            );
        }
    }

    /**
     * @param array<string, mixed> $body
     * @return array{status:int,body:array<string,mixed>}
     */
    private function json(int $status, array $body): array
    {
        return ['status' => $status, 'body' => $body];
    }
}
