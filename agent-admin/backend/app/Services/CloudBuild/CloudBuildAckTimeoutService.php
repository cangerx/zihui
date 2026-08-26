<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildJob;
use Carbon\Carbon;

class CloudBuildAckTimeoutService
{
    public function __construct(
        private CloudBuildJobClaimer $claimer,
        private CloudBuildExecutionSettings $settings,
        private ?CloudBuildArtifactStore $store = null,
    ) {
    }

    /**
     * @return array{failed:int,expired:int}
     */
    public function run(): array
    {
        $cutoff = Carbon::now()->subHours($this->settings->ackTimeoutHours);
        $failed = 0;
        $expired = 0;

        $pending = CloudBuildJob::query()
            ->where('phase', CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING)
            ->where('finished_at', '<', $cutoff)
            ->get();

        foreach ($pending as $job) {
            $this->claimer->transition($job, CloudBuildPhaseNormalizer::PHASE_FAILED, [
                'error_message' => 'mirror_incomplete_24h_worker_likely_down',
            ]);
            if ($this->store) {
                $this->store->purgeBuild((string) $job->build_id);
            }
            $failed++;
        }

        $ready = CloudBuildJob::query()
            ->where('phase', CloudBuildPhaseNormalizer::PHASE_READY)
            ->where('finished_at', '<', $cutoff)
            ->get();

        foreach ($ready as $job) {
            $this->claimer->transition($job, CloudBuildPhaseNormalizer::PHASE_EXPIRED, [
                'error_message' => 'admin_ack_timeout_24h',
            ]);
            if ($this->store) {
                $this->store->purgeBuild((string) $job->build_id);
            }
            $expired++;
        }

        return ['failed' => $failed, 'expired' => $expired];
    }
}
