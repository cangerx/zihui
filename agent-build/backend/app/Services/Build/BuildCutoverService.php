<?php

namespace App\Services\Build;

use App\Http\Controllers\Admin\BuildMaintenanceController;
use App\Services\SystemSetting\SettingService;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * 授权端冻结、排空、暂停 worker 与回滚。不改绑 callback，不写凭据。
 */
class BuildCutoverService
{
    public const FREEZE_MESSAGE = '客户端打包迁移维护中，暂停新任务。';

    public function __construct(private SettingService $settings)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function freeze(?string $message = null): array
    {
        $this->settings->setGroup(BuildMaintenanceController::GROUP, [
            BuildMaintenanceController::KEY_MODE => '1',
            BuildMaintenanceController::KEY_MESSAGE => $message ?: self::FREEZE_MESSAGE,
        ]);
        return [
            'ok' => true,
            'maintenance' => true,
            'workers_paused' => BuildDispatchPause::paused(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function unfreeze(): array
    {
        $this->settings->setGroup(BuildMaintenanceController::GROUP, [
            BuildMaintenanceController::KEY_MODE => '0',
        ]);
        return [
            'ok' => true,
            'maintenance' => false,
            'workers_paused' => BuildDispatchPause::paused(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function pauseWorkers(): array
    {
        BuildDispatchPause::pause();
        return ['ok' => true, 'workers_paused' => true];
    }

    /**
     * @return array<string, mixed>
     */
    public function resumeWorkers(): array
    {
        BuildDispatchPause::resume();
        return ['ok' => true, 'workers_paused' => false];
    }

    /**
     * @return array{ok:bool,count:int,by_status:array<string,int>,build_ids:string[]}
     */
    public function drainSnapshot(): array
    {
        $rows = DB::table('build_requests')
            ->where(function ($q) {
                $q->whereIn('status', ['pending', 'queued', 'building'])
                    ->orWhere(function ($q2) {
                        $q2->where('status', 'success')
                            ->whereIn('mirror_status', ['pending', 'mirroring']);
                    });
            })
            ->orderBy('build_id')
            ->get(['build_id', 'status', 'mirror_status']);

        $byStatus = [];
        $ids = [];
        foreach ($rows as $row) {
            $status = (string) $row->status;
            $mirror = $row->mirror_status !== null ? (string) $row->mirror_status : '';
            $key = $mirror !== '' ? $status . '+' . $mirror : $status;
            $byStatus[$key] = ($byStatus[$key] ?? 0) + 1;
            $ids[] = (string) $row->build_id;
        }

        return [
            'ok' => count($ids) === 0,
            'count' => count($ids),
            'by_status' => $byStatus,
            'build_ids' => $ids,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function drain(int $timeoutSeconds = 0, int $pollSeconds = 2): array
    {
        $deadline = $timeoutSeconds > 0 ? time() + $timeoutSeconds : time();
        do {
            $snap = $this->drainSnapshot();
            if ($snap['ok']) {
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
     * 回滚旧端：解除维护并恢复 dispatch/mirror 领取。不删除任务。
     *
     * @return array<string, mixed>
     */
    public function rollback(): array
    {
        $leftover = $this->drainSnapshot();
        $this->resumeWorkers();
        $unfrozen = $this->unfreeze();
        return [
            'ok' => true,
            'maintenance' => false,
            'workers_paused' => false,
            'leftover' => $leftover,
            'note' => 'in_flight_must_finish_on_this_backend_do_not_rebind_callback',
        ] + $unfrozen;
    }

    /**
     * @param array{github_token?:bool,github_repo?:bool} $present
     * @return array<string, mixed>
     */
    public function health(string $for = 'status', array $present = []): array
    {
        $allowed = ['status', 'pre-switch', 'post-rollback'];
        if (!in_array($for, $allowed, true)) {
            throw new InvalidArgumentException('unknown health profile');
        }

        $maintenance = (string) $this->settings->get(
            BuildMaintenanceController::GROUP,
            BuildMaintenanceController::KEY_MODE,
            '0'
        ) === '1';
        $paused = BuildDispatchPause::paused();
        $drain = $this->drainSnapshot();
        $secrets = [
            'github_token' => !empty($present['github_token']),
            'github_repo' => !empty($present['github_repo']),
        ];

        $stops = [];
        if ($for === 'pre-switch') {
            if (!$maintenance) {
                $stops[] = 'not_frozen';
            }
            if (!$paused) {
                $stops[] = 'workers_not_paused';
            }
            if (!$drain['ok']) {
                $stops[] = 'not_drained';
            }
        }
        if ($for === 'post-rollback') {
            if ($maintenance) {
                $stops[] = 'still_frozen';
            }
            if ($paused) {
                $stops[] = 'workers_still_paused';
            }
        }

        return [
            'ok' => $for === 'status' ? true : $stops === [],
            'for' => $for,
            'maintenance' => $maintenance,
            'workers_paused' => $paused,
            'in_flight' => $drain,
            'secrets_present' => $secrets,
            'stop_conditions' => $stops,
            'metrics' => [
                'in_flight_count' => $drain['count'],
                'in_flight_by_status' => $drain['by_status'],
            ],
        ];
    }
}
