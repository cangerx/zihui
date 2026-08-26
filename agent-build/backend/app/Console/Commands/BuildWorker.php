<?php

namespace App\Console\Commands;

use App\Services\Build\BuildWakeService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * 0.4.0 重构：BuildWorker 不再下载 artifact。
 *
 * 旧职责（已搬走）：
 *   - 从 GitHub Actions artifact 拉 zip 到 storage/app/build-artifacts/，解压、落库 artifact_files
 *     → 由 GitHub Actions workflow 直接 push 到 COS + BuildCallbackController 直接处理 callback 完成
 *
 * 新职责（本类目前仅做这三件事）：
 *   1. 清理超时 build：queued/building 状态卡超过 2 小时强转 failed（防 GitHub workflow 失联永远不退出）
 *   2. 清理本地残留：storage/app/build-artifacts/ 下没对应 DB 行的孤儿目录 / 终态超过 2 天的目录
 *   3. wake 兜底：5 分钟内 success 但 client 还没 ack delivered 的，重发 wake 信号
 */
class BuildWorker extends Command
{
    protected $signature = 'build:worker {--once : run a single pass then exit}';
    protected $description = '清理超时任务 + 清理本地残留 + wake 兜底（0.4.0 起不再下载 GitHub artifact）';

    /** queued/building 超过此时长强转 failed */
    private const STALE_TIMEOUT_MINUTES = 120;

    /** 本地残留 artifact 目录保留时长（终态后） */
    private const ORPHAN_RETENTION_DAYS = 2;

    /** wake 兜底回看窗口 */
    private const WAKE_LOOKBACK_MINUTES = 5;

    public function handle(BuildWakeService $wake): int
    {
        if (\App\Services\Build\BuildPackaging::retired()) {
            $this->warn('[BuildPackaging] retired, skip');
            return 0;
        }

        $once = (bool) $this->option('once');
        $mode = $once ? '(once mode)' : '(loop mode)';
        $this->info('[BuildWorker] started at ' . now()->toDateTimeString() . ' ' . $mode);

        do {
            $stale = $this->cleanupStaleBuilds();
            $orphan = $this->cleanupOrphanArtifacts();
            $woken = $this->wakeRecentSuccess($wake);

            $line = "[BuildWorker] tick stale={$stale} orphan={$orphan} woken={$woken}";
            if (($stale + $orphan + $woken) > 0) {
                $this->info($line);
            } else {
                $this->line($line);
            }

            if ($once) {
                return 0;
            }

            sleep(60);
        } while (true);
    }

    /**
     * 把 queued/building 状态卡 STALE_TIMEOUT_MINUTES 没动的 build 强转 failed。
     */
    private function cleanupStaleBuilds(): int
    {
        $cutoff = now()->subMinutes(self::STALE_TIMEOUT_MINUTES);
        return (int) DB::table('build_requests')
            ->whereIn('status', ['queued', 'building'])
            ->where('updated_at', '<', $cutoff)
            ->update([
                'status' => 'failed',
                'error_message' => 'stale_timeout_exceeded',
                'finished_at' => now(),
                'updated_at' => now(),
            ]);
    }

    /**
     * 清掉 storage/app/build-artifacts/ 下的残留目录：
     *   - DB 已无该 build_id 的行
     *   - 或对应 build 已是终态且超过 ORPHAN_RETENTION_DAYS
     *
     * 进行中状态（pending/queued/building/success-未交付）保留，避免误删。
     */
    private function cleanupOrphanArtifacts(): int
    {
        $base = storage_path(config('build.storage.subdir'));
        if (!is_dir($base)) return 0;

        $dirs = glob($base . DIRECTORY_SEPARATOR . '*', GLOB_ONLYDIR);
        if (!$dirs) return 0;

        $cutoff = now()->subDays(self::ORPHAN_RETENTION_DAYS);
        $cutoffStr = $cutoff->toDateTimeString();
        $count = 0;
        foreach ($dirs as $dir) {
            $buildId = basename($dir);
            $build = DB::table('build_requests')->where('build_id', $buildId)->first();

            if (!$build) {
                $this->deleteDir($dir);
                $count++;
                continue;
            }

            // 进行中状态、刚 success 待交付的，保留
            if (in_array($build->status, ['pending', 'queued', 'building', 'success'], true)) {
                continue;
            }

            // 终态（delivered/failed/cancelled/expired/purged）且超过保留期，清掉
            $updatedAt = $build->updated_at ?? null;
            if ($updatedAt && $updatedAt < $cutoffStr) {
                $this->deleteDir($dir);
                $count++;
            }
        }
        return $count;
    }

    /**
     * 兜底 wake：BuildCallbackController 在 success 时已经发过一次 wake（best-effort）。
     * 这里捞 5 分钟内 finished_at 但还没 delivered 的，每分钟再唤醒一次，覆盖 callback 时云控端短暂离线场景。
     */
    private function wakeRecentSuccess(BuildWakeService $wake): int
    {
        $candidates = DB::table('build_requests')
            ->where('status', 'success')
            ->where('finished_at', '>=', now()->subMinutes(self::WAKE_LOOKBACK_MINUTES))
            ->limit(20)
            ->get(['build_id', 'client_id']);

        if ($candidates->isEmpty()) return 0;

        $count = 0;
        foreach ($candidates as $b) {
            $client = DB::table('authorized_clients')->where('client_id', $b->client_id)->first();
            if ($client && $wake->wakeClient($client, $b->build_id)) {
                $count++;
            }
        }
        return $count;
    }

    private function deleteDir(string $dir): void
    {
        if (!is_dir($dir)) return;
        $items = scandir($dir);
        if ($items === false) return;
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            $path = $dir . DIRECTORY_SEPARATOR . $item;
            if (is_dir($path) && !is_link($path)) {
                $this->deleteDir($path);
            } else {
                @unlink($path);
            }
        }
        @rmdir($dir);
    }
}
