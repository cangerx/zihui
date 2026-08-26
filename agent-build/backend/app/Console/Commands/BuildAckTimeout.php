<?php

namespace App\Console\Commands;

use App\Services\Build\ArtifactPurgeService;
use App\Services\Build\BuildAlertService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * 24h 兜底处理 status=success 但迟迟未达终态的 build。
 *
 * 旧实现对所有「success 超 24h」一刀切 purge + expired，存在两个问题：
 *   1) mirror 从未完成（worker 长期故障）的产物根本没落到 mirror 站点，purge 无意义；
 *   2) 把这类静默清成 expired，客户的包凭空消失且无人知情（正是本次事故的次生伤害）。
 *
 * 新实现按 mirror_status 分流：
 *   A. mirror_status='mirrored'（产物已在国内站点，纯粹是云控端 24h 没来 ACK）
 *      → 维持原 purge + expired，释放 mirror 占用，属云控端侧问题。
 *   B. mirror_status IN (pending,mirroring,failed) 或 NULL（中转从未完成）
 *      → 不做无意义 purge；标 failed（语义=交付失败，前端红色醒目、支持重试），
 *        error_message 写明根因，并推送一条告警让运维知道「这些包被自动判失败了」。
 */
class BuildAckTimeout extends Command
{
    protected $signature = 'build:ack-timeout';
    protected $description = '24h 兜底：mirrored 未ACK → purge+expired；中转未完成 → failed+告警';

    public function handle(ArtifactPurgeService $purge, BuildAlertService $alert): int
    {
        if (\App\Services\Build\BuildPackaging::retired()) {
            $this->warn('[BuildPackaging] retired, skip');
            return 0;
        }

        $cutoff = now()->subHours(24);
        $now = now();

        // A. mirror 已就绪但云控端 24h 未 ACK → purge + expired（原行为，仅收窄到 mirrored 子集）
        $staleDelivered = DB::table('build_requests')
            ->where('status', 'success')
            ->where('mirror_status', 'mirrored')
            ->where('finished_at', '<', $cutoff)
            ->get(['build_id']);

        foreach ($staleDelivered as $b) {
            $purge->purgeForBuild($b->build_id);
            DB::table('build_requests')->where('build_id', $b->build_id)->update([
                'status' => 'expired',
                'error_message' => 'admin_ack_timeout_24h',
                'updated_at' => $now,
            ]);
        }

        // B. mirror 从未完成超过 24h → failed（不 purge，保留根因，告警）
        $stuckMirror = DB::table('build_requests as br')
            ->leftJoin('authorized_clients as ac', 'ac.client_id', '=', 'br.client_id')
            ->where('br.status', 'success')
            ->where('br.finished_at', '<', $cutoff)
            ->where(function ($q) {
                $q->whereIn('br.mirror_status', ['pending', 'mirroring', 'failed'])
                    ->orWhereNull('br.mirror_status');
            })
            ->get(['br.build_id', 'br.app_name', 'ac.domain']);

        foreach ($stuckMirror as $b) {
            DB::table('build_requests')->where('build_id', $b->build_id)->update([
                'status' => 'failed',
                'error_message' => 'mirror_incomplete_24h_worker_likely_down',
                'updated_at' => $now,
            ]);
        }

        $this->info('[BuildAckTimeout] delivered_stale=' . $staleDelivered->count() . ' mirror_stuck=' . $stuckMirror->count());

        if ($stuckMirror->count() > 0) {
            $lines = [
                "时间：{$now}",
                '以下打包因家庭电脑中转 24 小时未完成，已自动标记为「失败」（可在后台重试）：',
                '',
            ];
            foreach ($stuckMirror->take(20) as $b) {
                $dom = $b->domain ?: '（授权已删）';
                $lines[] = "  - {$b->app_name} / {$dom} / {$b->build_id}";
            }
            if ($stuckMirror->count() > 20) {
                $lines[] = '  ...另有 ' . ($stuckMirror->count() - 20) . ' 条';
            }
            $lines[] = '';
            $lines[] = '根因多为 agent-mirror-worker 长期未运行，请尽快恢复中转进程。';
            $alert->notify('打包中转 24h 超时自动失败', implode("\n", $lines));
        }

        return 0;
    }
}
