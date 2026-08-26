<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildJob;
use Carbon\Carbon;

class CloudBuildStuckDetectorService
{
    public function __construct(
        private CloudBuildGitHubGateway $github,
        private CloudBuildJobClaimer $claimer,
        private CloudBuildQuotaService $quota,
        private CloudBuildExecutionSettings $settings,
    ) {
    }

    /**
     * @return array{failed:int,cancelled:int,attached:int,skipped:int}
     */
    public function run(): array
    {
        $observeBefore = Carbon::now()->subMinutes($this->settings->stuckObserveMinutes);
        $stats = ['failed' => 0, 'cancelled' => 0, 'attached' => 0, 'skipped' => 0];

        $stuck = CloudBuildJob::query()
            ->where('phase', CloudBuildPhaseNormalizer::PHASE_BUILDING)
            ->where('started_at', '<', $observeBefore)
            ->get();

        foreach ($stuck as $job) {
            $outcome = $this->reconcileOne($job);
            $stats[$outcome] = ($stats[$outcome] ?? 0) + 1;
        }

        return $stats;
    }

    private function reconcileOne(CloudBuildJob $job): string
    {
        $runId = (int) ($job->executor_run_id ?? 0);
        $run = $runId > 0
            ? $this->github->getWorkflowRun($runId)
            : $this->lookupUnassignedRun($job);
        $attachedNow = false;

        if ($runId <= 0 && $run !== null) {
            $job = $this->claimer->transition($job, CloudBuildPhaseNormalizer::PHASE_BUILDING, [
                'executor_run_id' => (int) $run['id'],
            ]);
            $runId = (int) $run['id'];
            $attachedNow = true;
        }

        $status = (string) ($run['status'] ?? '');
        $conclusion = (string) ($run['conclusion'] ?? '');

        if ($status === 'completed') {
            if ($conclusion === 'success') {
                // 产物回调可能 500；成功 run 不能当卡住去 cancel。
                return 'skipped';
            }

            $cancelled = $conclusion === 'cancelled';
            $this->finishJob(
                $job,
                $cancelled ? CloudBuildPhaseNormalizer::PHASE_CANCELLED : CloudBuildPhaseNormalizer::PHASE_FAILED,
                $cancelled ? 'github_run_cancelled' : 'github_run_failure'
            );
            return $cancelled ? 'cancelled' : 'failed';
        }

        if ($runId > 0) {
            $runCutoff = Carbon::now()->subMinutes($this->settings->stuckRunMinutes);
            if ($job->started_at === null || $job->started_at->gte($runCutoff)) {
                return $attachedNow ? 'attached' : 'skipped';
            }

            $cancelled = $this->github->cancelRun($runId);
            $this->finishJob(
                $job,
                $cancelled ? CloudBuildPhaseNormalizer::PHASE_CANCELLED : CloudBuildPhaseNormalizer::PHASE_FAILED,
                $cancelled ? 'stuck_cancelled_by_cron' : 'stuck_cancel_failed'
            );
            return $cancelled ? 'cancelled' : 'failed';
        }

        $noRunCutoff = Carbon::now()->subMinutes($this->settings->stuckMinutes);
        if ($job->started_at !== null && $job->started_at->gte($noRunCutoff)) {
            return 'skipped';
        }

        $this->finishJob($job, CloudBuildPhaseNormalizer::PHASE_FAILED, 'stuck_no_run_id');
        return 'failed';
    }

    /**
     * @return array{id:int,status:string,conclusion:?string,html_url:string}|null
     */
    private function lookupUnassignedRun(CloudBuildJob $job): ?array
    {
        $since = $job->dispatched_at ?? $job->started_at ?? $job->queued_at ?? $job->created_at;
        if ($since === null) {
            return null;
        }

        $exclude = CloudBuildJob::query()
            ->whereNotNull('executor_run_id')
            ->where('build_id', '!=', $job->build_id)
            ->pluck('executor_run_id')
            ->all();

        return $this->github->findRecentWorkflowRun(
            (string) $job->platform,
            Carbon::parse($since)->subSeconds(15)->toIso8601String(),
            array_map('intval', $exclude)
        );
    }

    private function finishJob(CloudBuildJob $job, string $to, string $error): void
    {
        $this->claimer->transition($job, $to, [
            'error_message' => $error,
            'finished_at' => Carbon::now(),
        ]);
        $this->quota->decrDailyCount(
            (string) $job->client_ref,
            CloudBuildQuotaService::quotaDateFrom($job->created_at ?? $job->queued_at)
        );
    }
}
