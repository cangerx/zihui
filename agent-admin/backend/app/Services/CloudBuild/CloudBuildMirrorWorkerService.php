<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildArtifact;
use App\Models\CloudBuildJob;
use Carbon\Carbon;

class CloudBuildMirrorWorkerService
{
    public const PAGE_LIMIT = 10;

    public function __construct(
        private CloudBuildJobClaimer $claimer,
        private CloudBuildQuotaService $quota,
        private CloudBuildPurgeService $purge,
        private CloudBuildExecutionSettings $settings,
        private ?CloudBuildCutoverStore $cutover = null,
    ) {
    }

    /**
     * @return array{status:int,body:array<string,mixed>}
     */
    public function pending(): array
    {
        if ($this->cutover?->workersPaused()) {
            return ['status' => 200, 'body' => ['items' => [], 'paused' => true]];
        }

        $cutoff = Carbon::now()->subMinutes($this->settings->mirrorAssignmentMinutes);
        $candidates = CloudBuildJob::query()
            ->where('phase', CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING)
            ->where(function ($q) use ($cutoff) {
                $q->whereNull('mirror_assigned_at')
                    ->orWhere('mirror_assigned_at', '<', $cutoff);
            })
            ->orderBy('finished_at')
            ->limit(self::PAGE_LIMIT)
            ->get();

        $items = [];
        $now = Carbon::now();
        foreach ($candidates as $job) {
            $affected = CloudBuildJob::query()
                ->where('build_id', $job->build_id)
                ->where('phase', CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING)
                ->where(function ($q) use ($cutoff) {
                    $q->whereNull('mirror_assigned_at')
                        ->orWhere('mirror_assigned_at', '<', $cutoff);
                })
                ->update([
                    'mirror_assigned_at' => $now,
                    'claim_owner' => 'mirror-worker',
                    'claimed_at' => $now,
                ]);
            if ($affected !== 1) {
                continue;
            }
            $fresh = $job->fresh();
            $items[] = [
                'build_id' => $fresh->build_id,
                'app_name' => $fresh->app_name,
                'platform' => $fresh->platform,
                'app_version' => $fresh->app_version,
                'release_tag' => $fresh->release_tag,
                'release_assets' => $fresh->release_assets,
                'finished_at' => $fresh->finished_at ? $fresh->finished_at->toDateTimeString() : null,
                'assigned_at' => $fresh->mirror_assigned_at ? $fresh->mirror_assigned_at->toDateTimeString() : null,
            ];
        }

        return ['status' => 200, 'body' => ['items' => $items]];
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status:int,body:array<string,mixed>}
     */
    public function ack(string $buildId, array $payload): array
    {
        $job = CloudBuildJob::query()->where('build_id', $buildId)->first();
        if ($job === null) {
            return ['status' => 404, 'body' => ['error' => 'build_not_found']];
        }
        if ($job->phase === CloudBuildPhaseNormalizer::PHASE_READY
            || $job->phase === CloudBuildPhaseNormalizer::PHASE_DELIVERED) {
            return ['status' => 200, 'body' => ['status' => 'ready', 'idempotent' => true]];
        }
        if ($job->phase !== CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING) {
            return ['status' => 409, 'body' => ['error' => 'invalid_state_for_ack', 'phase' => $job->phase]];
        }

        $primaryUrl = (string) ($payload['mirror_url_primary'] ?? '');
        if ($primaryUrl === '') {
            return ['status' => 422, 'body' => ['error' => 'validation_failed']];
        }

        $this->claimer->transition($job, CloudBuildPhaseNormalizer::PHASE_READY, [
            'mirror_url_primary' => $primaryUrl,
            'mirror_assigned_at' => null,
            'claim_owner' => null,
            'claimed_at' => null,
            'error_message' => null,
        ]);

        $supp = $payload['mirror_supplementary'] ?? [];
        if (is_array($supp)) {
            foreach ($supp as $row) {
                if (!is_array($row) || empty($row['filename'])) {
                    continue;
                }
                CloudBuildArtifact::query()
                    ->where('build_id', $buildId)
                    ->where('filename', $row['filename'])
                    ->update(['mirror_url' => (string) ($row['url'] ?? '')]);
            }
        }

        return ['status' => 200, 'body' => ['status' => 'ready']];
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status:int,body:array<string,mixed>}
     */
    public function fail(string $buildId, array $payload): array
    {
        $job = CloudBuildJob::query()->where('build_id', $buildId)->first();
        if ($job === null) {
            return ['status' => 404, 'body' => ['error' => 'build_not_found']];
        }
        if ($job->phase === CloudBuildPhaseNormalizer::PHASE_FAILED) {
            return ['status' => 200, 'body' => ['status' => 'failed', 'idempotent' => true]];
        }
        if ($job->phase !== CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING) {
            return ['status' => 409, 'body' => ['error' => 'invalid_state_for_fail', 'phase' => $job->phase]];
        }

        $wasFailed = false;
        $this->claimer->transition($job, CloudBuildPhaseNormalizer::PHASE_FAILED, [
            'error_message' => 'mirror_failed: ' . mb_substr((string) ($payload['error'] ?? 'mirror_worker_failed'), 0, 480),
            'finished_at' => Carbon::now(),
        ]);
        $this->purge->purgeFiles($buildId);
        if (!$wasFailed) {
            $this->quota->decrDailyCount(
                (string) $job->client_ref,
                CloudBuildQuotaService::quotaDateFrom($job->created_at ?? $job->queued_at)
            );
        }

        return ['status' => 200, 'body' => ['status' => 'failed']];
    }

    /**
     * @return array{status:int,body:array<string,mixed>}
     */
    public function purgeable(): array
    {
        $cutoff = Carbon::now()->subMinutes($this->settings->mirrorAssignmentMinutes);
        $candidates = CloudBuildJob::query()
            ->where('phase', CloudBuildPhaseNormalizer::PHASE_DELIVERED)
            ->where(function ($q) use ($cutoff) {
                $q->whereNull('mirror_assigned_at')
                    ->orWhere('mirror_assigned_at', '<', $cutoff);
            })
            ->orderBy('delivered_at')
            ->limit(self::PAGE_LIMIT)
            ->get();

        $items = [];
        $now = Carbon::now();
        foreach ($candidates as $job) {
            $affected = CloudBuildJob::query()
                ->where('build_id', $job->build_id)
                ->where('phase', CloudBuildPhaseNormalizer::PHASE_DELIVERED)
                ->where(function ($q) use ($cutoff) {
                    $q->whereNull('mirror_assigned_at')
                        ->orWhere('mirror_assigned_at', '<', $cutoff);
                })
                ->update(['mirror_assigned_at' => $now]);
            if ($affected !== 1) {
                continue;
            }
            $fresh = $job->fresh();
            $items[] = [
                'build_id' => $fresh->build_id,
                'mirror_url_primary' => $fresh->mirror_url_primary,
                'delivered_at' => $fresh->delivered_at ? $fresh->delivered_at->toDateTimeString() : null,
            ];
        }

        return ['status' => 200, 'body' => ['items' => $items]];
    }

    /**
     * @return array{status:int,body:array<string,mixed>}
     */
    public function purgeAck(string $buildId): array
    {
        $job = CloudBuildJob::query()->where('build_id', $buildId)->first();
        if ($job === null) {
            return ['status' => 404, 'body' => ['error' => 'build_not_found']];
        }
        if ($job->phase === CloudBuildPhaseNormalizer::PHASE_PURGED) {
            return ['status' => 200, 'body' => ['status' => 'purged', 'idempotent' => true]];
        }
        if ($job->phase !== CloudBuildPhaseNormalizer::PHASE_DELIVERED) {
            return ['status' => 409, 'body' => ['error' => 'invalid_state_for_purge_ack', 'phase' => $job->phase]];
        }

        $this->purge->markPurged($job);
        return ['status' => 200, 'body' => ['status' => 'purged']];
    }
}
