<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildJob;
use App\Models\CloudBuildTemplate;
use App\Models\SystemSetting;
use Carbon\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * 本地执行后端。入队/状态/取消/鉴权读云控账本，不请求授权端。
 */
class CloudBuildLocalBackend implements CloudBuildBackend
{
    public function __construct(
        private CloudBuildEnqueueService $enqueue,
        private CloudBuildLocalSiteIdentity $site,
        private CloudBuildQuotaService $quota,
        private CloudBuildJobClaimer $claimer,
        private CloudBuildFrontendStatusProjector $projector,
        private CloudBuildGitHubGateway $github,
        private CloudBuildLocalDispatchService $dispatch,
        private CloudBuildProjectionSynchronizer $sync,
        private ?CloudBuildCutoverStore $cutover = null,
    ) {
    }

    public function driver(): string
    {
        return 'local';
    }

    public function isConfigured(): bool
    {
        return true;
    }

    public function currentOrigin(): string
    {
        return $this->site->origin();
    }

    public function checkAuth(): array
    {
        $client = $this->site->ensureClient();
        $today = Carbon::now()->toDateString();
        $used = $this->quota->getDailyCount(CloudBuildLocalSiteIdentity::CLIENT_REF, $today);
        $limit = (int) $client->daily_limit;
        $authorized = (string) $client->status === 'active'
            && ($client->expires_at === null || $client->expires_at->gte(Carbon::now()));

        $frozen = $this->cutover?->newRequestsFrozen() ?? false;

        return [
            '_status' => 200,
            'authorized' => $authorized,
            'reason' => $authorized ? null : ((string) $client->status === 'active' ? 'client_expired' : 'client_inactive'),
            'client_id' => CloudBuildLocalSiteIdentity::CLIENT_REF,
            'domain' => (string) ($client->domain ?: $this->site->origin()),
            'origin' => $this->site->origin(),
            'status' => (string) $client->status,
            'expires_at' => $client->expires_at?->toDateTimeString(),
            'daily_limit' => $limit,
            'daily_used' => $used,
            'daily_remaining' => max(0, $limit - $used),
            'monthly_limit' => (int) $client->monthly_limit,
            'maintenance' => $frozen,
            'maintenance_message' => $frozen ? CloudBuildCutoverService::FREEZE_MESSAGE : null,
            'maintenance_active' => $frozen,
            'maintenance_exempt' => (bool) $client->maintenance_exempt,
            'min_admin_version' => null,
            'current_admin_version' => $this->adminVersion(),
            'admin_version_too_low' => false,
            'can_use_ewei_shop' => false,
            'mall_authorizations' => ['ewei' => false, 'dianda' => false, 'qdyun' => false],
            'can_use_github_packaging' => PackagingLicense::canUseGithub(),
            'can_use_mac_packaging' => PackagingLicense::canUseMac(),
            'backend' => 'local',
        ];
    }

    public function requestBuild(string $appName, string $platform, ?string $iconUrl = null): array
    {
        $deny = PackagingLicense::denyReason($platform);
        if ($deny !== null) {
            return ['_status' => 403, 'error' => $deny];
        }
        return $this->enqueueAndKick([
            'client_ref' => CloudBuildLocalSiteIdentity::CLIENT_REF,
            'platform' => $platform,
            'app_name' => $appName,
            'app_version' => $this->currentTemplateVersion(),
            'icon_path' => $iconUrl,
            'build_mode' => 'normal',
        ]);
    }

    public function requestOemBuild(
        string $appName,
        string $platform,
        string $iconUrl,
        string $projectKey,
        string $appId,
        string $updatePath,
        ?string $appVersion = null,
        array $buildOptions = []
    ): array {
        $deny = PackagingLicense::denyReason($platform);
        if ($deny !== null) {
            return ['_status' => 403, 'error' => $deny];
        }
        return $this->enqueueAndKick([
            'client_ref' => CloudBuildLocalSiteIdentity::CLIENT_REF,
            'platform' => $platform,
            'app_name' => $appName,
            'app_version' => $appVersion ?: $this->currentTemplateVersion(),
            'icon_path' => $iconUrl,
            'build_mode' => 'oem',
            'oem_project_key' => $projectKey,
            'app_id' => $appId,
            'update_path' => $updatePath,
            'build_options' => $buildOptions,
        ]);
    }

    public function getStatus(string $buildId): array
    {
        $job = CloudBuildJob::query()->where('build_id', $buildId)->first();
        if ($job === null) {
            return ['_status' => 404, 'error' => 'build_not_found'];
        }

        $this->sync->syncByBuildId($buildId);

        $frontend = $this->projector->fromPhase((string) $job->phase);
        $estimated = null;
        if ($frontend === 'building' && $job->started_at) {
            $elapsed = Carbon::now()->diffInSeconds($job->started_at);
            $avg = $job->platform === 'mac' ? 600 : 300;
            $estimated = max(0, $avg - $elapsed);
        }

        return [
            '_status' => 200,
            'build_id' => $job->build_id,
            'platform' => $job->platform,
            'status' => $frontend,
            'queue_position' => $frontend === 'queued' ? 1 : null,
            'started_at' => $job->started_at?->toDateTimeString(),
            'finished_at' => $job->finished_at?->toDateTimeString(),
            'estimated_remaining_seconds' => $estimated,
            'error_message' => $job->error_message,
            'backend' => 'local',
        ];
    }

    public function cancel(string $buildId, bool $force = false): array
    {
        $job = CloudBuildJob::query()->where('build_id', $buildId)->first();
        if ($job === null) {
            return ['_status' => 404, 'error' => 'build_not_found'];
        }

        $phase = (string) $job->phase;
        if (in_array($phase, CloudBuildStateMachine::TERMINAL, true)
            || $phase === CloudBuildPhaseNormalizer::PHASE_DELIVERED
            || $phase === CloudBuildPhaseNormalizer::PHASE_PURGED) {
            return ['_status' => 200, 'status' => $this->projector->fromPhase($phase), 'already_terminal' => true];
        }

        if (!in_array($phase, [
            CloudBuildPhaseNormalizer::PHASE_QUEUED,
            CloudBuildPhaseNormalizer::PHASE_BUILDING,
        ], true)) {
            return ['_status' => 409, 'error' => 'not_cancellable', 'phase' => $phase];
        }

        if (!$force && $job->executor_run_id && $this->github->isConfigured()) {
            try {
                $this->github->cancelRun((int) $job->executor_run_id);
            } catch (\Throwable $e) {
                $this->warn('[CloudBuildLocal] github cancel failed', [
                    'build_id' => $buildId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        $this->claimer->transition($job, CloudBuildPhaseNormalizer::PHASE_CANCELLED, [
            'error_message' => $force ? '管理员强制取消' : null,
            'finished_at' => Carbon::now(),
            'claim_owner' => null,
            'claimed_at' => null,
        ]);
        $this->quota->decrDailyCount(
            (string) $job->client_ref,
            CloudBuildQuotaService::quotaDateFrom($job->created_at ?? $job->queued_at)
        );

        return ['_status' => 200, 'status' => 'cancelled'];
    }

    public function templateInfo(): array
    {
        $this->syncTemplateFromAuth();
        $current = CloudBuildTemplate::query()->where('is_current', 1)->orderByDesc('id')->first();
        $last = CloudBuildJob::query()
            ->where('client_ref', CloudBuildLocalSiteIdentity::CLIENT_REF)
            ->whereIn('phase', [
                CloudBuildPhaseNormalizer::PHASE_READY,
                CloudBuildPhaseNormalizer::PHASE_DELIVERED,
                CloudBuildPhaseNormalizer::PHASE_PURGED,
            ])
            ->orderByDesc('created_at')
            ->first();

        return [
            '_status' => 200,
            'current_version' => $current?->version,
            'released_at' => $current?->released_at?->toDateTimeString(),
            'changelog' => $current?->changelog,
            'client_last_version' => $last?->app_version,
            'client_last_build_at' => $last?->created_at?->toDateTimeString(),
            'has_update' => $current && $last
                ? version_compare((string) $current->version, (string) $last->app_version, '>')
                : ($current !== null && $last === null),
            'backend' => 'local',
        ];
    }

    public function getMyInfo(): array
    {
        $profile = $this->readProfile();
        $domain = $this->site->origin();
        $host = parse_url($domain, PHP_URL_HOST);
        if (!is_string($host) || $host === '') {
            $host = $domain;
        }

        return [
            '_status' => 200,
            'domain' => $host,
            'owner_name' => $profile['owner_name'],
            'owner_phone' => $profile['owner_phone'],
            'needs_completion' => false,
            'backend' => 'local',
        ];
    }

    public function updateMyInfo(string $ownerName, ?string $ownerPhone): array
    {
        $this->writeProfile($ownerName, (string) $ownerPhone);
        $info = $this->getMyInfo();
        $info['needs_completion'] = false;
        return $info;
    }

    /**
     * @param array<string, mixed> $input
     */
    private function enqueueAndKick(array $input): array
    {
        $this->site->ensureClient();
        $result = $this->enqueue->enqueue($input);
        if (!$result->ok || $result->job === null) {
            return [
                '_status' => $result->httpStatus,
                'error' => $result->error,
            ] + $result->extra;
        }

        $job = $result->job;
        if ($this->github->isConfigured()) {
            try {
                $this->dispatch->dispatchPending();
                $job = $job->fresh() ?: $job;
            } catch (\Throwable $e) {
                $this->warn('[CloudBuildLocal] dispatch after enqueue failed', [
                    'build_id' => $job->build_id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        $wait = $job->platform === 'mac' ? 600 : 300;

        return [
            '_status' => 200,
            'build_id' => $job->build_id,
            'status' => 'queued',
            'app_version' => (string) ($job->app_version ?: $this->currentTemplateVersion()),
            'estimated_wait_seconds' => $wait,
            'backend' => 'local',
        ];
    }

    private function currentTemplateVersion(): string
    {
        $this->syncTemplateFromAuth();
        $current = CloudBuildTemplate::query()->where('is_current', 1)->orderByDesc('id')->value('version');
        return is_string($current) && $current !== '' ? $current : '0.0.0';
    }

    /**
     * 从授权端拉取当前桌面模板并写入本地 current 行。失败则保持本地值。
     */
    private function syncTemplateFromAuth(): void
    {
        $payload = $this->fetchAuthDesktopTemplate();
        $version = trim((string) ($payload['current_version'] ?? ''));
        if ($version === '') {
            return;
        }
        $local = CloudBuildTemplate::query()->where('is_current', 1)->orderByDesc('id')->value('version');
        if (is_string($local) && $local === $version) {
            return;
        }
        try {
            CloudBuildTemplate::setCurrent($version, (string) ($payload['changelog'] ?? '') ?: null);
        } catch (\Throwable $e) {
            $this->warn('[CloudBuildLocal] sync auth desktop template skipped', ['error' => $e->getMessage()]);
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    private function fetchAuthDesktopTemplate(): ?array
    {
        try {
            if (!function_exists('app') || !app()->bound('config')) {
                return null;
            }
            $base = rtrim((string) config('cloudbuild.agent_build.base_url'), '/');
            if ($base === '') {
                return null;
            }
            $host = parse_url($base, PHP_URL_HOST);
            if (!is_string($host) || $host === '' || str_ends_with($host, 'example.com')) {
                return null;
            }
            $http = Http::timeout((int) config('cloudbuild.agent_build.timeout_seconds', 8))->acceptJson();
            if (!(bool) config('cloudbuild.agent_build.verify_ssl', false)) {
                $http = $http->withoutVerifying();
            }
            $resp = $http->get($base . '/api/license/desktop-template');
            if (!$resp->successful()) {
                return null;
            }
            $json = $resp->json();

            return is_array($json) ? $json : null;
        } catch (\Throwable $e) {
            $this->warn('[CloudBuildLocal] fetch auth desktop template failed', ['error' => $e->getMessage()]);

            return null;
        }
    }

    /**
     * @return array{owner_name:string,owner_phone:string}
     */
    private function readProfile(): array
    {
        try {
            return [
                'owner_name' => (string) SystemSetting::getValue('cloud_build_owner_name', ''),
                'owner_phone' => (string) SystemSetting::getValue('cloud_build_owner_phone', ''),
            ];
        } catch (\Throwable $e) {
            return ['owner_name' => '', 'owner_phone' => ''];
        }
    }

    private function writeProfile(string $ownerName, string $ownerPhone): void
    {
        try {
            SystemSetting::setValue('cloud_build_owner_name', $ownerName);
            SystemSetting::setValue('cloud_build_owner_phone', $ownerPhone);
        } catch (\Throwable $e) {
            $this->warn('[CloudBuildLocal] persist my-info skipped', ['error' => $e->getMessage()]);
        }
    }

    /**
     * @param array<string, mixed> $ctx
     */
    private function warn(string $message, array $ctx = []): void
    {
        try {
            Log::warning($message, $ctx);
        } catch (\Throwable $e) {
            // unit tests without Laravel log container
        }
    }

    private function adminVersion(): ?string
    {
        try {
            if (function_exists('app') && app()->bound('config')) {
                $version = trim((string) (config('version.version') ?: ''));
                return $version !== '' ? $version : null;
            }
        } catch (\Throwable $e) {
        }
        return null;
    }
}
