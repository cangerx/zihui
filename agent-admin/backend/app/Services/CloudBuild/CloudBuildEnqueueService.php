<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildClient;
use App\Models\CloudBuildJob;
use Carbon\Carbon;

class CloudBuildEnqueueService
{
    public const ACTIVE_PHASES = [
        CloudBuildPhaseNormalizer::PHASE_QUEUED,
        CloudBuildPhaseNormalizer::PHASE_BUILDING,
    ];

    public function __construct(
        private CloudBuildQuotaService $quota,
        private CloudBuildExecutionSettings $settings,
        private ?CloudBuildCutoverStore $cutover = null,
    ) {
    }

    /**
     * @param array{
     *   client_ref:string,
     *   platform:string,
     *   app_name?:string,
     *   app_version?:string,
     *   app_id?:?string,
     *   update_path?:?string,
     *   icon_path?:?string,
     *   build_mode?:string,
     *   oem_project_key?:?string,
     *   build_options?:mixed,
     *   build_id?:string
     * } $input
     */
    public function enqueue(array $input): CloudBuildEnqueueResult
    {
        $clientRef = trim((string) ($input['client_ref'] ?? ''));
        $platform = (string) ($input['platform'] ?? '');
        if ($clientRef === '' || !in_array($platform, ['win', 'mac'], true)) {
            return CloudBuildEnqueueResult::fail('invalid_request', 422);
        }

        if ($this->cutover?->newRequestsFrozen()) {
            return CloudBuildEnqueueResult::fail('maintenance_mode', 503, [
                'maintenance' => true,
                'maintenance_message' => CloudBuildCutoverService::FREEZE_MESSAGE,
            ]);
        }

        if ($this->settings->queuePaused) {
            return CloudBuildEnqueueResult::fail('queue_paused', 503);
        }

        return CloudBuildJob::query()->getConnection()->transaction(function () use ($input, $clientRef, $platform) {
            /** @var CloudBuildClient|null $client */
            $client = CloudBuildClient::query()
                ->where('client_ref', $clientRef)
                ->lockForUpdate()
                ->first();

            if ($client === null) {
                return CloudBuildEnqueueResult::fail('client_not_found', 404);
            }
            if ($client->status !== 'active') {
                return CloudBuildEnqueueResult::fail('client_inactive', 403, ['status' => $client->status]);
            }
            if ($client->expires_at && $client->expires_at->lt(Carbon::now())) {
                return CloudBuildEnqueueResult::fail('client_expired', 403);
            }

            $buildMode = (string) ($input['build_mode'] ?? 'normal');
            if (!in_array($buildMode, ['normal', 'oem'], true)) {
                $buildMode = 'normal';
            }
            $oemKey = $buildMode === 'oem' ? (string) ($input['oem_project_key'] ?? '') : null;
            if ($buildMode === 'oem' && ($oemKey === null || $oemKey === '')) {
                return CloudBuildEnqueueResult::fail('oem_project_key_required', 422);
            }

            $busy = CloudBuildJob::query()
                ->where('client_ref', $clientRef)
                ->whereIn('phase', self::ACTIVE_PHASES)
                ->where(function ($q) use ($buildMode, $oemKey) {
                    if ($buildMode === 'oem') {
                        $q->where('build_mode', 'oem')->where('oem_project_key', $oemKey);
                    } else {
                        $q->where(function ($qq) {
                            $qq->whereNull('build_mode')->orWhere('build_mode', 'normal');
                        });
                    }
                })
                ->first();
            if ($busy) {
                return CloudBuildEnqueueResult::fail('client_busy', 409, [
                    'build_id' => $busy->build_id,
                    'phase' => $busy->phase,
                ]);
            }

            $depth = CloudBuildJob::query()->whereIn('phase', self::ACTIVE_PHASES)->count();
            if ($depth >= $this->settings->queueMaxDepth) {
                return CloudBuildEnqueueResult::fail('queue_full', 429, [
                    'queue_depth' => $depth,
                    'max_depth' => $this->settings->queueMaxDepth,
                ]);
            }

            $today = Carbon::now()->toDateString();
            $used = $this->quota->getDailyCount($clientRef, $today);
            $limit = (int) $client->daily_limit;
            if ($limit > 0 && $used >= $limit) {
                return CloudBuildEnqueueResult::fail('quota_exceeded', 429, [
                    'daily_used' => $used,
                    'daily_limit' => $limit,
                ]);
            }

            $now = Carbon::now();
            $buildId = (string) ($input['build_id'] ?? $this->newBuildId());
            $options = $input['build_options'] ?? null;
            if (is_array($options)) {
                $options = json_encode($options, JSON_UNESCAPED_SLASHES);
            }

            $job = CloudBuildJob::query()->create([
                'build_id' => $buildId,
                'client_ref' => $clientRef,
                'build_mode' => $buildMode,
                'oem_project_key' => $oemKey,
                'platform' => $platform,
                'app_name' => (string) ($input['app_name'] ?? ''),
                'app_version' => (string) ($input['app_version'] ?? ''),
                'app_id' => $input['app_id'] ?? null,
                'update_path' => $input['update_path'] ?? null,
                'build_options' => $options,
                'callback_token' => bin2hex(random_bytes(32)),
                'icon_path' => $input['icon_path'] ?? null,
                'phase' => CloudBuildPhaseNormalizer::PHASE_QUEUED,
                'dispatch_attempts' => 0,
                'queued_at' => $now,
            ]);

            $this->quota->incrDailyCount($clientRef, $today);

            return CloudBuildEnqueueResult::ok($job->fresh());
        });
    }

    private function newBuildId(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);
        return sprintf(
            '%s-%s-%s-%s-%s',
            substr($hex, 0, 8),
            substr($hex, 8, 4),
            substr($hex, 12, 4),
            substr($hex, 16, 4),
            substr($hex, 20, 12)
        );
    }
}
