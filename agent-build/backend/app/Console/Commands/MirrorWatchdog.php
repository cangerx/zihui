<?php

namespace App\Console\Commands;

use App\Services\Build\BuildAlertService;
use App\Services\SystemSetting\SettingService;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * mirror 中转链路看门狗（每 5 分钟）。
 *
 * 设计要点：用「业务结果」而非「worker 心跳」作为主告警触发，天然适配 mac 大包跨境下载
 * 极慢的现实——单个 mac build（arm64 + x64 两个 100MB+ zip）跨境可能要 mirror 40-60 分钟，
 * 期间 worker 串行卡在下载、不轮询、心跳停更。如果按「卡 X 分钟」或「心跳停更」一刀切，
 * 会把「正在慢慢下大包」误报成故障。
 *
 * 改为两个业务信号判定：
 *   - pending 超 PENDING_TIMEOUT 仍没被领取 → worker 没在轮询领活（真·失联信号）
 *   - mirroring 超 MIRRORING_TIMEOUT 仍没 ack → 下载卡死 / 跨境过慢（异常信号）
 *
 * worker 正常下大包时：build 处于 mirroring 且 mirror_assigned_at 在 MIRRORING_TIMEOUT 窗口内，
 * 既不算 pending 堆积、也不算 mirroring 超时 → 不告警。心跳仅作为告警内的辅助诊断信息。
 */
class MirrorWatchdog extends Command
{
    protected $signature = 'build:mirror-watchdog';
    protected $description = '检测 mirror 中转异常（排队未领取 / 中转超时），按冷却推送告警';

    /** pending（已完成、等 worker 领取镜像）超过这么久仍没被领走 → worker 疑似未在轮询。 */
    private const PENDING_TIMEOUT_MINUTES = 30;
    /**
     * mirroring（worker 已领取、正在下载 + SFTP 推送）超过这么久仍没 ack → 下载卡死 / 跨境过慢。
     * 取 90 分钟以覆盖 mac 双 100MB+ 包跨境下载的最坏耗时，把「慢」与「卡」区分开，避免误报。
     * 必须与 MirrorWorkerController::ASSIGNMENT_TIMEOUT_MINUTES 协调（领取超时 >= 此值，防重领）。
     */
    private const MIRRORING_TIMEOUT_MINUTES = 90;
    /** worker 心跳静默阈值：仅用于告警内的辅助说明（下大包会停更，不单独作为告警触发）。 */
    private const HEARTBEAT_SILENT_MINUTES = 10;
    /** 同一持续故障最多每这么久提醒一次。 */
    private const COOLDOWN_MINUTES = 30;

    public function handle(BuildAlertService $alert, SettingService $settings): int
    {
        if (\App\Services\Build\BuildPackaging::retired()) {
            $this->warn('[BuildPackaging] retired, skip');
            return 0;
        }

        $now = now();

        // 1) pending 排队超时：已完成但长时间没被 worker 领取 → worker 没在领活
        $pendingStuck = DB::table('build_requests as br')
            ->leftJoin('authorized_clients as ac', 'ac.client_id', '=', 'br.client_id')
            ->where('br.status', 'success')
            ->where('br.mirror_status', 'pending')
            ->where('br.finished_at', '<', $now->copy()->subMinutes(self::PENDING_TIMEOUT_MINUTES))
            ->orderBy('br.finished_at')
            ->get(['br.build_id', 'br.app_name', 'br.finished_at', 'ac.domain']);

        // 2) mirroring 处理超时：已领取但长时间没完成 → 下载卡死 / 跨境过慢
        $mirroringStuck = DB::table('build_requests as br')
            ->leftJoin('authorized_clients as ac', 'ac.client_id', '=', 'br.client_id')
            ->where('br.status', 'success')
            ->where('br.mirror_status', 'mirroring')
            ->where('br.mirror_assigned_at', '<', $now->copy()->subMinutes(self::MIRRORING_TIMEOUT_MINUTES))
            ->orderBy('br.mirror_assigned_at')
            ->get(['br.build_id', 'br.app_name', 'br.mirror_assigned_at', 'ac.domain']);

        $hasProblem = $pendingStuck->count() > 0 || $mirroringStuck->count() > 0;

        $lastState = (string) $settings->get(BuildAlertService::GROUP, BuildAlertService::KEY_LAST_STATE, 'ok');
        $lastNotifiedRaw = (string) $settings->get(BuildAlertService::GROUP, BuildAlertService::KEY_LAST_NOTIFIED_AT, '');
        $lastNotified = $lastNotifiedRaw !== '' ? Carbon::parse($lastNotifiedRaw) : null;

        if (!$hasProblem) {
            if ($lastState === 'alerting') {
                $alert->notify('mirror 中转已恢复', "时间：{$now}\n打包产物中转链路已恢复正常。");
                $settings->setGroup(BuildAlertService::GROUP, [BuildAlertService::KEY_LAST_STATE => 'ok']);
                $this->info('[MirrorWatchdog] recovered, sent recovery notice');
            } else {
                $this->info('[MirrorWatchdog] healthy');
            }
            return 0;
        }

        // 冷却：仍在告警态且距上次通知不足 COOLDOWN_MINUTES → 跳过
        $withinCooldown = $lastNotified !== null && $lastNotified->gt($now->copy()->subMinutes(self::COOLDOWN_MINUTES));
        if ($lastState === 'alerting' && $withinCooldown) {
            $this->info('[MirrorWatchdog] problem persists but within cooldown, skip');
            return 0;
        }

        // worker 心跳（仅作辅助诊断，不作为触发条件）
        $lastPollRaw = (string) $settings->get('mirror', 'worker_last_poll_at', '');
        if ($lastPollRaw === '') {
            $heartbeat = 'worker 从未上报心跳（可能从未启动）';
        } else {
            $silent = Carbon::parse($lastPollRaw)->lt($now->copy()->subMinutes(self::HEARTBEAT_SILENT_MINUTES));
            $heartbeat = 'worker 最后心跳 ' . $lastPollRaw
                . ($silent ? '（已静默；若正在下载大包属正常）' : '（活跃）');
        }

        $lines = ["时间：{$now}", $heartbeat, ''];

        if ($pendingStuck->count() > 0) {
            $lines[] = "【排队未领取】{$pendingStuck->count()} 个打包已完成但超过 "
                . self::PENDING_TIMEOUT_MINUTES . " 分钟未被 worker 领取（worker 疑似未在轮询 / 已离线）：";
            foreach ($pendingStuck->take(8) as $b) {
                $min = $b->finished_at ? Carbon::parse($b->finished_at)->diffInMinutes($now) : '?';
                $lines[] = '  - ' . $b->app_name . ' / ' . ($b->domain ?: '（授权已删）') . " / 排队 {$min} 分钟 / " . $b->build_id;
            }
            if ($pendingStuck->count() > 8) {
                $lines[] = '  ...另有 ' . ($pendingStuck->count() - 8) . ' 条';
            }
            $lines[] = '';
        }

        if ($mirroringStuck->count() > 0) {
            $lines[] = "【中转超时】{$mirroringStuck->count()} 个打包已被领取但中转超过 "
                . self::MIRRORING_TIMEOUT_MINUTES . " 分钟未完成（下载卡死 / 跨境过慢）：";
            foreach ($mirroringStuck->take(8) as $b) {
                $min = $b->mirror_assigned_at ? Carbon::parse($b->mirror_assigned_at)->diffInMinutes($now) : '?';
                $lines[] = '  - ' . $b->app_name . ' / ' . ($b->domain ?: '（授权已删）') . " / 处理 {$min} 分钟 / " . $b->build_id;
            }
            if ($mirroringStuck->count() > 8) {
                $lines[] = '  ...另有 ' . ($mirroringStuck->count() - 8) . ' 条';
            }
            $lines[] = '';
        }

        $lines[] = '处置：检查家庭电脑 agent-mirror-worker 进程 / 日志 / 梯子带宽 / SFTP / worker_token。';

        $res = $alert->notify('mirror 中转告警', implode("\n", $lines));
        $settings->setGroup(BuildAlertService::GROUP, [
            BuildAlertService::KEY_LAST_STATE => 'alerting',
            BuildAlertService::KEY_LAST_NOTIFIED_AT => (string) $now,
        ]);

        if ($res['ok']) {
            $this->warn('[MirrorWatchdog] alert sent: pending_stuck=' . $pendingStuck->count() . ' mirroring_stuck=' . $mirroringStuck->count());
        } else {
            $this->error('[MirrorWatchdog] alert NOT delivered (' . $res['msg'] . '): pending_stuck=' . $pendingStuck->count() . ' mirroring_stuck=' . $mirroringStuck->count());
        }
        return 0;
    }
}
