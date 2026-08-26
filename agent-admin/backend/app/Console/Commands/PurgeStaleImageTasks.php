<?php

namespace App\Console\Commands;

use App\Models\ImageTask;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * 图片任务兜底清理：处理「僵尸任务」+「历史记录膨胀」。
 *
 * 背景：sync 队列模式下，生图任务由 GatewayController 的 app()->terminating 寄生在
 * PHP-FPM 进程内同步执行。若进程被 PHP-FPM request_terminate_timeout / OOM / 重启强杀，
 * ProcessImageTaskJob 来不及把 task 翻 failed（SIGKILL 不进 catch），task 会永久卡在
 * pending/processing，桌面端只能轮询到 15min 超时。视频侧有 video:settle-pending 兜底，
 * 图片侧原本缺失，本命令补齐。
 *
 * 由 Kernel 每 5 分钟调度（cron 驱动 schedule:run，不依赖 queue worker）：
 *   1. 把 pending/processing 且 updated_at 静默超过 --stalled 秒的任务标 failed
 *      （阈值默认 > image timeout，避免误杀正在正常跑的长任务）
 *   2. --keep-days>0 时删除该天数之前的 completed/failed 历史记录，防表无限膨胀
 *      （image_tasks 仅作任务流转 + 短期审计；长期计费审计在 usage_records，二者独立）
 */
class PurgeStaleImageTasks extends Command
{
    protected $signature = 'image:purge-stale
        {--limit=200 : 单次最多处理的任务数}
        {--stalled= : 视为僵尸的最小静默秒数（默认 image timeout + 300s 余量）}
        {--keep-days=0 : >0 时删除该天数之前的 completed/failed 记录}';

    protected $description = '兜底清理僵尸图片任务（卡 pending/processing）并按需清理历史记录';

    public function handle(): int
    {
        $limit = max(1, min(1000, (int) $this->option('limit')));

        // 僵尸判定阈值必须 > 单任务真实最大时长（image timeout，默认 900s），否则会误杀
        // 正在正常跑的长任务（4K / 多米排队）。默认在 image timeout 基础上再留 300s 余量。
        $defaultStalled = (int) config('gateway.timeouts.image', 900) + 300;
        $stalled = max(300, (int) ($this->option('stalled') ?: $defaultStalled));
        $cutoff = now()->subSeconds($stalled);

        $stuck = ImageTask::whereIn('status', ['pending', 'processing'])
            ->where('updated_at', '<=', $cutoff)
            ->orderBy('updated_at')
            ->limit($limit)
            ->get();

        $markedFailed = 0;
        foreach ($stuck as $task) {
            try {
                // 二次确认仍是非终态再翻（并发下可能刚被 Job 改成 completed）
                $affected = ImageTask::where('id', $task->id)
                    ->whereIn('status', ['pending', 'processing'])
                    ->update([
                        'status' => 'failed',
                        'error' => '任务超时未完成（疑似执行进程异常退出），已自动标记失败',
                    ]);
                if ($affected > 0) {
                    $markedFailed++;
                }
            } catch (\Throwable $e) {
                Log::warning('[image:purge-stale] mark failed error task=' . $task->id . ': ' . $e->getMessage());
            }
        }

        // 历史记录清理（可选）：删 keep-days 之前的终态记录
        $deletedOld = 0;
        $keepDays = (int) $this->option('keep-days');
        if ($keepDays > 0) {
            $deleteCutoff = now()->subDays($keepDays);
            $deletedOld = ImageTask::whereIn('status', ['completed', 'failed'])
                ->where('created_at', '<', $deleteCutoff)
                ->limit($limit)
                ->delete();
        }

        $this->info("image purge: scanned={$stuck->count()} marked_failed={$markedFailed} deleted_old={$deletedOld}");

        return self::SUCCESS;
    }
}
