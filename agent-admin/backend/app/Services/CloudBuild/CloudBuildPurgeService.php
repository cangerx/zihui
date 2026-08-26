<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildJob;
use Carbon\Carbon;

class CloudBuildPurgeService
{
    public function __construct(
        private CloudBuildJobClaimer $claimer,
        private CloudBuildArtifactStore $store,
    ) {
    }

    public function purgeFiles(string $buildId): int
    {
        return $this->store->purgeBuild($buildId);
    }

    public function markPurged(CloudBuildJob $job): CloudBuildJob
    {
        $this->store->purgeBuild((string) $job->build_id);
        return $this->claimer->transition($job, CloudBuildPhaseNormalizer::PHASE_PURGED, [
            'purged_at' => Carbon::now(),
        ]);
    }

    public function markDelivered(CloudBuildJob $job): CloudBuildJob
    {
        return $this->claimer->transition($job, CloudBuildPhaseNormalizer::PHASE_DELIVERED, [
            'delivered_at' => Carbon::now(),
        ]);
    }

    /**
     * 删除没有对应活动/就绪任务的目录，以及终态超过保留期的目录。
     * 不得删除 queued/building/artifact_pending/ready 的目录。
     *
     * @return array{purged_dirs:int,skipped_active:int}
     */
    public function cleanupOrphans(int $retentionDays): array
    {
        $purged = 0;
        $skipped = 0;
        $cutoff = Carbon::now()->subDays($retentionDays);
        $protected = [
            CloudBuildPhaseNormalizer::PHASE_QUEUED,
            CloudBuildPhaseNormalizer::PHASE_BUILDING,
            CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING,
            CloudBuildPhaseNormalizer::PHASE_READY,
        ];

        foreach ($this->store->directoryBuildIds() as $buildId) {
            $job = CloudBuildJob::query()->where('build_id', $buildId)->first();
            if ($job === null) {
                $this->store->purgeBuild($buildId);
                $purged++;
                continue;
            }
            if (in_array((string) $job->phase, $protected, true)) {
                $skipped++;
                continue;
            }
            $stamp = $job->purged_at ?: $job->finished_at ?: $job->updated_at;
            if ($stamp && Carbon::parse($stamp)->lt($cutoff)) {
                $this->store->purgeBuild($buildId);
                $purged++;
            } else {
                $skipped++;
            }
        }

        return ['purged_dirs' => $purged, 'skipped_active' => $skipped];
    }
}
