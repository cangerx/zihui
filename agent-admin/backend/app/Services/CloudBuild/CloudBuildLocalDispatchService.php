<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildAttempt;
use App\Models\CloudBuildClient;
use App\Models\CloudBuildJob;
use Carbon\Carbon;

class CloudBuildLocalDispatchService
{
    public const OUTCOME_DISPATCHED = 'dispatched';
    public const OUTCOME_RETRIED = 'retried';
    public const OUTCOME_FAILED = 'failed';
    public const OUTCOME_SKIPPED = 'skipped';

    public function __construct(
        private CloudBuildGitHubGateway $github,
        private CloudBuildJobClaimer $claimer,
        private CloudBuildQuotaService $quota,
        private CloudBuildExecutionSettings $settings,
        private ?CloudBuildCutoverStore $cutover = null,
    ) {
    }

    /**
     * @return array{dispatched:int,retried:int,failed:int,skipped:int}
     */
    public function dispatchPending(): array
    {
        $stats = ['dispatched' => 0, 'retried' => 0, 'failed' => 0, 'skipped' => 0];
        if ($this->cutover?->workersPaused()) {
            return $stats;
        }
        if (!PackagingLicense::canUseGithub()) {
            return $stats;
        }
        if (!$this->github->isConfigured()) {
            return $stats;
        }

        $owner = 'dispatch:' . gethostname() . ':' . getmypid();
        $staleBefore = Carbon::now()->subMinutes($this->settings->staleClaimMinutes);

        $candidates = CloudBuildJob::query()
            ->where('phase', CloudBuildPhaseNormalizer::PHASE_QUEUED)
            ->where('dispatch_attempts', '<', $this->settings->maxDispatchAttempts)
            ->where(function ($q) use ($staleBefore) {
                $q->whereNull('claim_owner')
                    ->orWhere('claimed_at', '<', $staleBefore);
            })
            ->orderBy('queued_at')
            ->limit($this->settings->dispatchBatchSize)
            ->get();

        foreach ($candidates as $job) {
            $outcome = $this->dispatchOne($job->build_id, $owner);
            $stats[$outcome] = ($stats[$outcome] ?? 0) + 1;
        }

        return $stats;
    }

    public function dispatchOne(string $buildId, string $owner): string
    {
        $this->releaseStaleClaim($buildId);

        $claimed = $this->claimer->claim($buildId, $owner, CloudBuildPhaseNormalizer::PHASE_QUEUED);
        if ($claimed === null) {
            return self::OUTCOME_SKIPPED;
        }

        if ((string) $claimed->platform === 'mac' && !PackagingLicense::canUseMac()) {
            $this->claimer->transition($claimed, CloudBuildPhaseNormalizer::PHASE_QUEUED, [
                'claim_owner' => null,
                'claimed_at' => null,
            ]);
            return self::OUTCOME_SKIPPED;
        }

        $attempts = (int) $claimed->dispatch_attempts + 1;
        $claimed = $this->claimer->transition($claimed, CloudBuildPhaseNormalizer::PHASE_QUEUED, [
            'dispatch_attempts' => $attempts,
        ]);

        try {
            $client = CloudBuildClient::query()->where('client_ref', $claimed->client_ref)->first();
            if ($client === null) {
                $this->failJob($claimed, 'client_not_found_at_dispatch', $attempts);
                return self::OUTCOME_FAILED;
            }

            $inputs = $this->dispatchInputs($claimed, $client);
            $ok = $this->github->dispatch((string) $claimed->platform, $inputs);
            $dispatchError = $ok ? null : ($this->github->lastDispatchError() ?: 'github_dispatch_failed');
            $permanent = in_array($dispatchError, [
                CloudBuildGitHubDispatchService::ERR_WORKFLOW_NOT_FOUND,
                CloudBuildGitHubDispatchService::ERR_FORBIDDEN,
            ], true);
            $this->recordAttempt(
                $claimed,
                $attempts,
                $ok ? 'dispatched' : ($permanent ? 'failed' : 'retried'),
                $ok ? null : $dispatchError
            );

            if ($ok) {
                $now = Carbon::now();
                $run = $this->github->findRecentWorkflowRun(
                    (string) $claimed->platform,
                    $now->copy()->subSeconds(15)->toIso8601String(),
                    $this->assignedRunIds((string) $claimed->build_id)
                );
                $building = [
                    'dispatched_at' => $now,
                    'started_at' => $now,
                    'claim_owner' => null,
                    'claimed_at' => null,
                    'error_message' => null,
                ];
                if ($run !== null) {
                    $building['executor_run_id'] = (int) $run['id'];
                }
                $this->claimer->transition($claimed, CloudBuildPhaseNormalizer::PHASE_BUILDING, $building);
                return self::OUTCOME_DISPATCHED;
            }

            if ($permanent || $attempts >= $this->settings->maxDispatchAttempts) {
                $failMessage = $permanent
                    ? $dispatchError
                    : 'github_dispatch_failed_after_' . $this->settings->maxDispatchAttempts . '_attempts';
                $this->failJob($claimed, $failMessage, $attempts);
                return self::OUTCOME_FAILED;
            }

            $this->claimer->transition($claimed, CloudBuildPhaseNormalizer::PHASE_QUEUED, [
                'claim_owner' => null,
                'claimed_at' => null,
            ]);
            return self::OUTCOME_RETRIED;
        } catch (\Throwable $e) {
            if ($attempts >= $this->settings->maxDispatchAttempts) {
                $this->failJob(
                    $claimed,
                    'dispatch_exception_after_' . $this->settings->maxDispatchAttempts . '_attempts: ' . mb_substr($e->getMessage(), 0, 180),
                    $attempts
                );
                return self::OUTCOME_FAILED;
            }
            $this->claimer->transition($claimed, CloudBuildPhaseNormalizer::PHASE_QUEUED, [
                'claim_owner' => null,
                'claimed_at' => null,
                'error_message' => mb_substr($e->getMessage(), 0, 500),
            ]);
            return self::OUTCOME_RETRIED;
        }
    }

    private function failJob(CloudBuildJob $job, string $error, int $attempts): void
    {
        $this->claimer->transition($job, CloudBuildPhaseNormalizer::PHASE_FAILED, [
            'error_message' => $error,
            'finished_at' => Carbon::now(),
            'claim_owner' => null,
            'claimed_at' => null,
        ]);
        $this->recordAttempt($job, $attempts, 'failed', $error);
        $this->quota->decrDailyCount(
            (string) $job->client_ref,
            CloudBuildQuotaService::quotaDateFrom($job->created_at ?? $job->queued_at)
        );
    }

    private function releaseStaleClaim(string $buildId): void
    {
        $staleBefore = Carbon::now()->subMinutes($this->settings->staleClaimMinutes);
        CloudBuildJob::query()
            ->where('build_id', $buildId)
            ->where('phase', CloudBuildPhaseNormalizer::PHASE_QUEUED)
            ->whereNotNull('claim_owner')
            ->where('claimed_at', '<', $staleBefore)
            ->update([
                'claim_owner' => null,
                'claimed_at' => null,
            ]);
    }

    /**
     * @return array<string, scalar>
     */
    private function dispatchInputs(CloudBuildJob $job, CloudBuildClient $client): array
    {
        $domain = (string) ($client->domain ?: '');
        if (\App\Support\RetiredPublicHosts::contains($domain)) {
            $domain = (new CloudBuildLocalSiteIdentity())->origin();
        }
        $storedIcon = trim((string) ($job->icon_path ?: ''));
        $storedIcon = \App\Support\RetiredPublicHosts::rewrite($storedIcon, $domain);
        $iconIsUrl = preg_match('#^https?://#i', $storedIcon) === 1;
        // workflow 把 icon_path 标成 required；空串会被 GitHub 当成未提供（422）。
        // 本地执行不再往构建仓 commit 图标，占位路径给 API 过门，真正图标走 icon_url。
        $inputs = [
            'build_id' => (string) $job->build_id,
            'app_name' => (string) $job->app_name,
            'domain' => $domain,
            'api_domain' => $domain,
            'icon_path' => ($iconIsUrl || $storedIcon === '')
                ? ('.build-icons/' . $job->build_id . '.png')
                : $storedIcon,
            'icon_url' => $iconIsUrl ? $storedIcon : '',
            'callback_url' => $this->settings->callbackUrl,
            'callback_token' => (string) $job->callback_token,
        ];

        if ($job->build_mode === 'oem') {
            $inputs['app_id'] = (string) $job->app_id;
            $inputs['update_url'] = rtrim($domain, '/') . (string) $job->update_path;
            $inputs['app_version'] = (string) $job->app_version;
            $inputs['build_mode'] = 'oem';
            $inputs['oem_project_key'] = (string) $job->oem_project_key;
            if (!empty($job->build_options)) {
                $inputs['build_options'] = is_string($job->build_options)
                    ? $job->build_options
                    : json_encode($job->build_options, JSON_UNESCAPED_SLASHES);
            }
        }

        return $inputs;
    }

    /**
     * @return list<int>
     */
    private function assignedRunIds(string $exceptBuildId): array
    {
        return CloudBuildJob::query()
            ->whereNotNull('executor_run_id')
            ->where('build_id', '!=', $exceptBuildId)
            ->pluck('executor_run_id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    private function recordAttempt(CloudBuildJob $job, int $attemptNo, string $outcome, ?string $error): void
    {
        CloudBuildAttempt::query()->updateOrCreate(
            ['build_id' => $job->build_id, 'attempt_no' => $attemptNo],
            [
                'outcome' => $outcome,
                'queued_at' => $job->queued_at,
                'started_at' => Carbon::now(),
                'finished_at' => in_array($outcome, ['dispatched', 'failed'], true) ? Carbon::now() : null,
                'error_message' => $error,
            ]
        );
    }
}
