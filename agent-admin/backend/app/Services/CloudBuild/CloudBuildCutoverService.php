<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildJob;
use Carbon\Carbon;
use InvalidArgumentException;

/**
 * 云控侧冻结、排空、backend 切换与回滚。不改绑 callback，不写凭据。
 */
class CloudBuildCutoverService
{
    public const IN_FLIGHT_PHASES = [
        CloudBuildPhaseNormalizer::PHASE_QUEUED,
        CloudBuildPhaseNormalizer::PHASE_BUILDING,
        CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING,
    ];

    public const FREEZE_MESSAGE = '客户端打包迁移维护中，暂停新任务。';

    public function __construct(private CloudBuildCutoverStore $store)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function status(): array
    {
        return $this->health('status');
    }

    /**
     * @return array<string, mixed>
     */
    public function freeze(): array
    {
        $state = $this->store->patch([
            'new_requests_frozen' => true,
            'frozen_at' => Carbon::now()->toDateTimeString(),
            'last_step' => 'frozen',
        ]);
        return ['ok' => true, 'state' => $state];
    }

    /**
     * @return array<string, mixed>
     */
    public function unfreeze(): array
    {
        $state = $this->store->patch([
            'new_requests_frozen' => false,
            'last_step' => 'unfrozen',
        ]);
        return ['ok' => true, 'state' => $state];
    }

    /**
     * @return array<string, mixed>
     */
    public function pauseWorkers(): array
    {
        $state = $this->store->patch([
            'workers_paused' => true,
            'workers_paused_at' => Carbon::now()->toDateTimeString(),
            'last_step' => 'workers_paused',
        ]);
        return ['ok' => true, 'state' => $state];
    }

    /**
     * @return array<string, mixed>
     */
    public function resumeWorkers(): array
    {
        $state = $this->store->patch([
            'workers_paused' => false,
            'last_step' => 'workers_resumed',
        ]);
        return ['ok' => true, 'state' => $state];
    }

    /**
     * @return array<string, mixed>
     */
    public function recordCursor(?string $buildId, ?string $until = null): array
    {
        $state = $this->store->patch([
            'last_cursor' => $buildId !== null && $buildId !== '' ? $buildId : null,
            'last_until' => $until !== null && $until !== '' ? $until : null,
            'last_step' => 'cursor_recorded',
        ]);
        return ['ok' => true, 'state' => $state];
    }

    /**
     * @return array{ok:bool,count:int,by_phase:array<string,int>,build_ids:string[]}
     */
    public function drainSnapshot(): array
    {
        $rows = CloudBuildJob::query()
            ->whereIn('phase', self::IN_FLIGHT_PHASES)
            ->orderBy('build_id')
            ->get(['build_id', 'phase']);

        $byPhase = [];
        $ids = [];
        foreach ($rows as $row) {
            $phase = (string) $row->phase;
            $byPhase[$phase] = ($byPhase[$phase] ?? 0) + 1;
            $ids[] = (string) $row->build_id;
        }

        return [
            'ok' => $rows->count() === 0,
            'count' => $rows->count(),
            'by_phase' => $byPhase,
            'build_ids' => $ids,
        ];
    }

    /**
     * timeout=0：只检查一次。不取消任务、不改绑 callback。
     *
     * @return array<string, mixed>
     */
    public function drain(int $timeoutSeconds = 0, int $pollSeconds = 2): array
    {
        $deadline = $timeoutSeconds > 0 ? time() + $timeoutSeconds : time();
        do {
            $snap = $this->drainSnapshot();
            if ($snap['ok']) {
                $this->store->patch(['last_step' => 'drained']);
                return $snap + ['timed_out' => false];
            }
            if ($timeoutSeconds <= 0 || time() >= $deadline) {
                break;
            }
            sleep(max(1, $pollSeconds));
        } while (time() < $deadline);

        $snap = $this->drainSnapshot();
        return $snap + ['timed_out' => !$snap['ok']];
    }

    /**
     * auto 模式下写入 backend_override。显式 CLOUDBUILD_BACKEND=local|remote 视为运维锁。
     *
     * @return array<string, mixed>
     */
    public function switchBackend(string $target, ?string $configured = null, ?string $appEnv = null): array
    {
        if ($target !== 'local' && $target !== 'remote') {
            throw new InvalidArgumentException('backend must be local or remote');
        }

        $configured = strtolower(trim((string) ($configured ?? $this->configuredBackend())));
        if (($configured === 'local' || $configured === 'remote') && $configured !== $target) {
            return [
                'ok' => false,
                'stop' => 'explicit_env_locks_backend',
                'configured' => $configured,
                'requested' => $target,
            ];
        }

        $state = $this->store->patch([
            'backend_override' => $target,
            'switched_at' => Carbon::now()->toDateTimeString(),
            'last_step' => $target === 'local' ? 'switched_local' : 'switched_remote',
        ]);
        $mode = (new CloudBuildBackendSelector($configured, $appEnv, $this->store))->mode();

        return [
            'ok' => true,
            'state' => $state,
            'mode' => $mode,
        ];
    }

    /**
     * 回滚：backend 回 remote，保持冻结新本地任务，恢复 pull（workers_paused=false）。
     * 已在新端创建的在途任务留在报告里，禁止改绑 callback。
     *
     * @return array<string, mixed>
     */
    public function rollback(?string $configured = null, ?string $appEnv = null): array
    {
        $leftover = $this->drainSnapshot();
        $switched = $this->switchBackend('remote', $configured, $appEnv);
        if (!$switched['ok']) {
            return $switched + ['leftover' => $leftover];
        }

        $state = $this->store->patch([
            'new_requests_frozen' => true,
            'workers_paused' => false,
            'frozen_at' => $this->store->read()['frozen_at'] ?: Carbon::now()->toDateTimeString(),
            'last_step' => 'rolled_back',
        ]);

        return [
            'ok' => true,
            'state' => $state,
            'mode' => $switched['mode'],
            'leftover' => $leftover,
            'note' => 'local_in_flight_must_finish_or_cancel_on_new_backend',
        ];
    }

    /**
     * @param array{github_token?:bool,github_repo?:bool,callback_url?:bool,sign_secret?:bool,worker_token?:bool} $present
     * @return array<string, mixed>
     */
    public function health(string $for = 'status', array $present = [], ?string $configured = null, ?string $appEnv = null): array
    {
        $allowed = ['status', 'pre-switch', 'post-switch', 'post-rollback'];
        if (!in_array($for, $allowed, true)) {
            throw new InvalidArgumentException('unknown health profile');
        }

        $state = $this->store->read();
        $drain = $this->drainSnapshot();
        $configured = strtolower(trim((string) ($configured ?? $this->configuredBackend())));
        $mode = (new CloudBuildBackendSelector($configured, $appEnv, $this->store))->mode();
        $secrets = [
            'github_token' => !empty($present['github_token']),
            'github_repo' => !empty($present['github_repo']),
            'callback_url' => !empty($present['callback_url']),
            'sign_secret' => !empty($present['sign_secret']),
            'worker_token' => !empty($present['worker_token']),
        ];

        $stops = [];
        if ($for === 'pre-switch') {
            if (!$state['new_requests_frozen']) {
                $stops[] = 'not_frozen';
            }
            if (!$state['workers_paused']) {
                $stops[] = 'workers_not_paused';
            }
            if (!$drain['ok']) {
                $stops[] = 'not_drained';
            }
            if (!$secrets['github_token'] || !$secrets['github_repo']) {
                $stops[] = 'github_not_configured';
            }
            if (!$secrets['callback_url']) {
                $stops[] = 'callback_url_missing';
            }
        }
        if ($for === 'post-switch') {
            if ($mode !== 'local') {
                $stops[] = 'backend_not_local';
            }
            if ($state['workers_paused']) {
                $stops[] = 'workers_still_paused';
            }
            if (!$secrets['github_token'] || !$secrets['github_repo']) {
                $stops[] = 'github_not_configured';
            }
        }
        if ($for === 'post-rollback') {
            if ($mode !== 'remote') {
                $stops[] = 'backend_not_remote';
            }
        }

        $ok = $for === 'status' ? true : $stops === [];

        return [
            'ok' => $ok,
            'for' => $for,
            'mode' => $mode,
            'configured' => $configured,
            'state' => $state,
            'in_flight' => $drain,
            'secrets_present' => $secrets,
            'stop_conditions' => $stops,
            'metrics' => [
                'in_flight_count' => $drain['count'],
                'in_flight_by_phase' => $drain['by_phase'],
                'new_requests_frozen' => (bool) $state['new_requests_frozen'],
                'workers_paused' => (bool) $state['workers_paused'],
            ],
        ];
    }

    private function configuredBackend(): string
    {
        try {
            if (function_exists('app') && app()->bound('config')) {
                return (string) (config('cloudbuild.backend') ?: 'auto');
            }
        } catch (\Throwable $e) {
            // fall through
        }
        return (string) (getenv('CLOUDBUILD_BACKEND') ?: 'auto');
    }
}
