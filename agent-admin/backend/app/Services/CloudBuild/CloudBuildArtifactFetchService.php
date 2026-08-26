<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildArtifact;
use App\Models\CloudBuildJob;
use Carbon\Carbon;
use Illuminate\Support\Facades\Log;

class CloudBuildArtifactFetchService
{
    public function __construct(
        private CloudBuildGitHubGateway $github,
        private CloudBuildJobClaimer $claimer,
        private CloudBuildQuotaService $quota,
        private CloudBuildArtifactStore $store,
        private CloudBuildExecutionSettings $settings,
        private ?CloudBuildCutoverStore $cutover = null,
    ) {
    }

    /**
     * @return array{fetched:int,retried:int,failed:int,skipped:int}
     */
    public function fetchPending(): array
    {
        $stats = ['fetched' => 0, 'retried' => 0, 'failed' => 0, 'skipped' => 0];
        if ($this->cutover?->workersPaused()) {
            return $stats;
        }
        if ($this->settings->workerToken !== '') {
            return $stats;
        }
        if (!$this->github->isConfigured()) {
            return $stats;
        }

        $jobs = CloudBuildJob::query()
            ->where('phase', CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING)
            ->orderBy('finished_at')
            ->limit(3)
            ->get();

        $owner = 'fetch:' . gethostname() . ':' . getmypid();
        foreach ($jobs as $job) {
            $outcome = $this->fetchOne($job->build_id, $owner);
            $stats[$outcome] = ($stats[$outcome] ?? 0) + 1;
        }
        return $stats;
    }

    public function fetchOne(string $buildId, string $owner): string
    {
        $claimed = $this->claimer->claim($buildId, $owner, CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING);
        if ($claimed === null) {
            return 'skipped';
        }

        try {
            $assetsByName = [];
            foreach ((array) ($claimed->release_assets ?? []) as $asset) {
                if (is_array($asset) && !empty($asset['filename'])) {
                    $assetsByName[(string) $asset['filename']] = $asset;
                }
            }

            $artifacts = CloudBuildArtifact::query()->where('build_id', $buildId)->get();
            if ($artifacts->isEmpty()) {
                $this->failJob($claimed, 'no_artifacts');
                return 'failed';
            }

            foreach ($artifacts as $artifact) {
                if (!empty($artifact->storage_path) && is_file($artifact->storage_path)) {
                    continue;
                }
                $filename = $this->store->safeFilename((string) $artifact->filename);
                $meta = $assetsByName[$filename] ?? $assetsByName[(string) $artifact->filename] ?? null;
                $url = is_array($meta) ? (string) ($meta['asset_url'] ?? '') : '';
                if ($url === '') {
                    $this->failJob($claimed, 'asset_url_missing:' . $filename);
                    return 'failed';
                }

                $this->store->ensureBuildDir($buildId);
                $part = $this->store->partPath($buildId, $filename);
                $final = $this->store->finalPath($buildId, $filename);
                $resumeFrom = is_file($part) ? (int) filesize($part) : 0;
                $result = $this->github->downloadTo($url, $part, $resumeFrom);

                if (!($result['ok'] ?? false)) {
                    if ((int) ($result['bytes'] ?? 0) > 0) {
                        $this->releaseClaim($claimed);
                        return 'retried';
                    }
                    return $this->bumpOrFail($claimed, $artifact, 'download_failed:' . (string) ($result['error'] ?? ''));
                }

                $actualSize = is_file($part) ? (int) filesize($part) : 0;
                $expectedSize = (int) $artifact->size;
                if ($expectedSize > 1024 && $actualSize < (int) floor($expectedSize * 0.5)) {
                    @unlink($part);
                    return $this->bumpOrFail($claimed, $artifact, 'size_mismatch');
                }

                $actual = hash_file('sha256', $part) ?: '';
                $expected = strtolower((string) $artifact->sha256);
                if ($expected !== '' && $expected !== str_repeat('0', 64) && !hash_equals($expected, strtolower($actual))) {
                    try {
                        Log::warning('[CloudBuildFetch] sha256 mismatch', [
                            'build_id' => $buildId,
                            'filename' => $filename,
                            'expected' => $expected,
                            'actual' => strtolower($actual),
                            'bytes' => $actualSize,
                        ]);
                    } catch (\Throwable $ignored) {
                    }
                    @unlink($part);
                    return $this->bumpOrFail($claimed, $artifact, 'sha256_mismatch');
                }

                if (!$this->store->atomicPlace($part, $final)) {
                    return $this->bumpOrFail($claimed, $artifact, 'atomic_place_failed');
                }

                $artifact->storage_path = $final;
                $artifact->size = is_file($final) ? (int) filesize($final) : (int) $artifact->size;
                $artifact->sha256 = strtolower($actual);
                $artifact->save();
            }

            $primary = CloudBuildArtifact::query()
                ->where('build_id', $buildId)
                ->where('role', 'primary')
                ->first();
            $this->claimer->transition($claimed, CloudBuildPhaseNormalizer::PHASE_READY, [
                'mirror_url_primary' => $primary ? $primary->storage_path : null,
                'mirror_assigned_at' => null,
                'claim_owner' => null,
                'claimed_at' => null,
                'error_message' => null,
            ]);
            return 'fetched';
        } catch (\Throwable $e) {
            return $this->bumpOrFail($claimed, null, 'fetch_exception:' . mb_substr($e->getMessage(), 0, 180));
        }
    }

    private function bumpOrFail(CloudBuildJob $job, ?CloudBuildArtifact $artifact, string $error): string
    {
        $attempts = $artifact ? (int) $artifact->fetch_attempts + 1 : $this->settings->fetchMaxAttempts;
        if ($artifact) {
            $artifact->fetch_attempts = $attempts;
            $artifact->save();
        }
        if ($attempts >= $this->settings->fetchMaxAttempts) {
            $this->failJob($job, $error . '_after_' . $attempts . '_attempts');
            return 'failed';
        }
        $this->releaseClaim($job);
        return 'retried';
    }

    private function failJob(CloudBuildJob $job, string $error): void
    {
        $this->claimer->transition($job, CloudBuildPhaseNormalizer::PHASE_FAILED, [
            'error_message' => mb_substr($error, 0, 500),
            'finished_at' => Carbon::now(),
            'claim_owner' => null,
            'claimed_at' => null,
        ]);
        $this->store->purgeBuild((string) $job->build_id);
        $this->quota->decrDailyCount(
            (string) $job->client_ref,
            CloudBuildQuotaService::quotaDateFrom($job->created_at ?? $job->queued_at)
        );
    }

    private function releaseClaim(CloudBuildJob $job): void
    {
        $this->claimer->transition($job, CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING, [
            'claim_owner' => null,
            'claimed_at' => null,
        ]);
    }
}
